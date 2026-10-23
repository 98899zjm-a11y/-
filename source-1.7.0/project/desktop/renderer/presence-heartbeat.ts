import { useEffect, useRef } from "react";
import { api, type AuthStatus, type DesktopUser } from "./bridge";
import { normalizedAccess } from "./module-access";

type ModuleActivity = { module: "ledger" | "inventory" | null; lastActivityAt: number; visible: boolean };
type ActivityBridge = Window["jewelryDesktop"] & { getModuleActivity?: () => Promise<ModuleActivity>; getAppInfo?: () => Promise<{ appVersion?: unknown }> };
type PresenceBody = { module: string; active: boolean; client?: { schemaVersion: 1; deviceId: string; kind: "desktop"|"web"; clientVersion: string; versionSource: "local-app"|"host-web" } };
type PresenceReply = { accepted?: boolean; clientMetadataVersion?: number; clientMetadataAccepted?: boolean };
type ClientStorage = Pick<Storage, "getItem"|"setItem">;
const DEVICE_KEY = "xjy-client-device-id-v1", DEVICE_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function newClientDeviceId(): string|null {
  const source = globalThis.crypto;
  try { if (typeof source?.randomUUID === "function") return source.randomUUID(); } catch { /* Insecure HTTP can still provide getRandomValues. */ }
  if (typeof source?.getRandomValues !== "function") return null;
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createPresenceClientReporter({ request, getAppInfo, storage, surface, createDeviceId = newClientDeviceId }: {
  request: (body: PresenceBody) => Promise<PresenceReply>; getAppInfo?: () => Promise<{ appVersion?: unknown }>;
  storage?: ClientStorage|null; surface: "desktop"|"web"; createDeviceId?: () => string|null;
}) {
  let alive = true, sending = false, supported = false;
  let metadataInFlight: Promise<void>|null = null, cachedClient: PresenceBody["client"], metadataEpoch = 0;
  function deviceId(): string|null {
    if (!storage) return null;
    try {
      const saved = storage.getItem(DEVICE_KEY);
      if (saved && saved.length === 36 && DEVICE_UUID.test(saved)) return saved.toLowerCase();
      const created = createDeviceId();
      if (typeof created !== "string" || created.length !== 36 || !DEVICE_UUID.test(created)) return null;
      const value = created.toLowerCase(); storage.setItem(DEVICE_KEY, value);
      return storage.getItem(DEVICE_KEY)?.toLowerCase() === value ? value : null;
    } catch { return null; }
  }
  function clearMetadata() { cachedClient = undefined; metadataEpoch++; metadataInFlight = null; }
  function loadMetadata() {
    if (!alive || !supported || !getAppInfo || metadataInFlight) return;
    const epoch = metadataEpoch;
    const discard = () => { if (alive && supported && epoch === metadataEpoch) clearMetadata(); };
    let pending: Promise<{ appVersion?: unknown }>;
    try { pending = getAppInfo(); } catch { discard(); return; }
    const task: Promise<void> = Promise.resolve(pending).then(info => {
      if (!alive || !supported || epoch !== metadataEpoch) return;
      const version = info?.appVersion;
      if (typeof version === "string" && version.trim() === version && /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/.test(version)) {
        const id = deviceId();
        if (id) {
          cachedClient = { schemaVersion: 1, deviceId: id, kind: surface, clientVersion: version, versionSource: surface === "web" ? "host-web" : "local-app" };
          return;
        }
      }
      clearMetadata();
    }).catch(discard)
      .finally(() => { if (metadataInFlight === task) metadataInFlight = null; });
    metadataInFlight = task;
  }
  return {
    async send(input: { module: string; active: boolean }) {
      if (!alive || sending) return;
      sending = true;
      const body: PresenceBody = { module: input.module, active: input.active };
      try {
        loadMetadata();
        await Promise.resolve();
        if (!alive) return;
        if (supported && cachedClient) body.client = { ...cachedClient };
        const reply = await request(body);
        if (alive) {
          const wasSupported = supported;
          supported = reply?.clientMetadataVersion === 1;
          if (!supported) clearMetadata();
          else if (!wasSupported) loadMetadata();
        }
        return reply;
      } catch (error) { supported = false; clearMetadata(); throw error; }
      finally { sending = false; }
    },
    dispose() { alive = false; supported = false; clearMetadata(); },
  };
}

export function usePresenceHeartbeat({ userId, scope, page, onAuthUser }: { userId: string; scope: string; page: string; onAuthUser: (user: DesktopUser) => Promise<void> }) {
  const lastActivity = useRef(Date.now()), pageRef = useRef(page), callback = useRef(onAuthUser);
  pageRef.current = page; callback.current = onAuthUser;
  useEffect(() => {
    let alive = true, sending = false;
    let storage: ClientStorage|null = null;
    try { storage = window.localStorage; } catch { /* Keep legacy presence when storage is unavailable. */ }
    const clientBridge = window.jewelryDesktop as ActivityBridge|undefined;
    const clientReporter = createPresenceClientReporter({ request: body => api<PresenceReply>("/api/presence/heartbeat", "POST", body),
      getAppInfo: typeof clientBridge?.getAppInfo === "function" ? () => clientBridge.getAppInfo!() : undefined,
      storage, surface: clientBridge?.surface === "browser" ? "web" : "desktop" });
    const mark = () => { lastActivity.current = Date.now(); };
    for (const event of ["pointerdown", "keydown", "scroll"] as const) window.addEventListener(event, mark, { capture: true, passive: true });
    const send = async () => {
      if (!alive || sending) return;
      sending = true;
      try {
        const status = await api<AuthStatus>("/auth/status");
        if (!alive) return;
        if (!status.authenticated || !status.user || status.user.id !== userId) { window.dispatchEvent(new CustomEvent("desktop-auth-lost")); return; }
        await callback.current(status.user);
        if (!alive) return;
        const native = window.jewelryDesktop as ActivityBridge;
        const activity = native.getModuleActivity ? await native.getModuleActivity() : null;
        if (!alive) return;
        const candidate = activity?.module || (["sales", "custom", "tradein", "recycling", "repairs", "gallery", "customers", "history", "reports"].includes(pageRef.current) ? "sales" : "home");
        const module = candidate !== "home" && normalizedAccess(status.user)[candidate] === "disabled" ? "home" : candidate;
        const active = activity?.module ? activity.visible && Date.now() - activity.lastActivityAt < 300000 : !document.hidden && document.hasFocus() && Date.now() - lastActivity.current < 300000;
        await clientReporter.send({ module, active });
      } catch { /* A disconnected device is marked offline by the server timeout. No input content is recorded or queued. */ }
      finally { sending = false; }
    };
    void send(); const timer = setInterval(() => void send(), 30000);
    return () => { alive = false; clientReporter.dispose(); clearInterval(timer); for (const event of ["pointerdown", "keydown", "scroll"] as const) window.removeEventListener(event, mark, { capture: true }); };
  }, [userId, scope]);
}
