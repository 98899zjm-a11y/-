export type StaffAvatarProfile = { staffId: string; name: string; revision: number; avatar: { id: string; url: string } | null };
export type StaffAvatarSnapshot = { avatarId: string; source: string; state: "idle" | "loading" | "ready" | "error" };
type Request = <T>(path: string) => Promise<T>;
type Entry = { profile: StaffAvatarProfile; snapshot: StaffAvatarSnapshot; published: number; loaded: number };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const EMPTY: StaffAvatarSnapshot = Object.freeze({ avatarId: "", source: "", state: "idle" });
const IMAGE_LIMIT = Math.ceil(2 * 1024 * 1024 / 3) * 4 + 64, CACHE_LIMIT = 48 * 1024 * 1024;
function acceptedProfile(value: unknown): value is StaffAvatarProfile {
  if (!value || typeof value !== "object") return false;
  const row = value as StaffAvatarProfile;
  return UUID.test(row.staffId) && typeof row.name === "string" && Number.isSafeInteger(row.revision) && row.revision >= 0 && (row.avatar === null || !!row.avatar && UUID.test(row.avatar.id) && row.avatar.url === "/api/employee-profiles/avatars/" + row.avatar.id);
}
function safeImage(value: unknown): value is string {
  if (typeof value !== "string" || value.length > IMAGE_LIMIT) return false;
  const match = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[1].length % 4) return false;
  const bytes = match[1].length / 4 * 3 - (match[1].endsWith("==") ? 2 : match[1].endsWith("=") ? 1 : 0);
  return bytes > 0 && bytes <= 2 * 1024 * 1024;
}

// One instance belongs to one authenticated renderer scope. Image data is never
// persisted, put into bootstrap, or shared between users or host connections.
export function createStaffAvatarStore(request: Request) {
  const entries = new Map<string, Entry>(), listeners = new Map<string, Set<() => void>>(), pending = new Map<string, Promise<void>>();
  let epoch = 0, publication = 0, active = true, directory: Promise<void> | null = null, touched = 0;
  const notify = (id?: string) => { if (id) listeners.get(id)?.forEach(listener => listener()); else listeners.forEach(group => group.forEach(listener => listener())); };
  function apply(value: unknown, published: number, retry = false) {
    if (!active || !acceptedProfile(value)) return false;
    const prior = entries.get(value.staffId);
    if (prior && (prior.profile.revision > value.revision || prior.published > published)) return false;
    const changed = !prior || prior.profile.avatar?.id !== value.avatar?.id;
    const snapshot = changed ? { avatarId: value.avatar?.id || "", source: "", state: "idle" as const } : retry && prior.snapshot.state === "error" ? { ...prior.snapshot, state: "idle" as const } : prior.snapshot;
    entries.set(value.staffId, { profile: { staffId: value.staffId, name: value.name, revision: value.revision, avatar: value.avatar && { ...value.avatar } }, snapshot, published, loaded: changed ? 0 : prior?.loaded || 0 });
    if (changed) pending.delete(value.staffId);
    if (!prior || snapshot !== prior.snapshot) notify(value.staffId);
    return true;
  }
  function trim(retain: string) {
    let size = [...entries.values()].reduce((total, entry) => total + entry.snapshot.source.length * 2, 0);
    for (const [id, entry] of [...entries].filter(([id, row]) => id !== retain && row.snapshot.source).sort((left, right) => left[1].loaded - right[1].loaded)) {
      if (size <= CACHE_LIMIT) break;
      size -= entry.snapshot.source.length * 2; entry.snapshot = { avatarId: entry.snapshot.avatarId, source: "", state: "idle" }; notify(id);
    }
  }
  function reset() { epoch++; entries.clear(); pending.clear(); directory = null; notify(); }
  function refresh() {
    if (!active) return Promise.resolve();
    if (directory) return directory;
    const generation = epoch, started = publication; let invalidDirectory = false;
    const work: Promise<void> = Promise.resolve().then(async () => {
      try {
        const reply = await request<{ profiles: StaffAvatarProfile[] }>("/api/employee-profiles");
        if (!active || generation !== epoch) return;
        if (!Array.isArray(reply?.profiles) || reply.profiles.length > 2048 || reply.profiles.some(row => !acceptedProfile(row)) || new Set(reply.profiles.map(row => row.staffId)).size !== reply.profiles.length) { invalidDirectory = true; throw new Error("员工头像目录无效"); }
        const known = new Set(reply.profiles.map(row => row.staffId));
        for (const [id, entry] of entries) if (!known.has(id) && entry.published <= started) { entries.delete(id); pending.delete(id); notify(id); }
        for (const row of reply.profiles) apply(row, started, true);
        await Promise.all([...listeners.keys()].map(id => ensure(id, false)));
      } catch (problem) {
        // Transient transport failures retain the last authenticated image.
        // The bridge's auth-lost event suspends this scope immediately on 401.
        const status = (problem as { status?: unknown } | null)?.status;
        if (active && generation === epoch && (invalidDirectory || status === 401 || status === 403)) { if (status === 401 || status === 403) active = false; reset(); }
      } finally { if (directory === work) directory = null; }
    });
    directory = work; return work;
  }
  async function ensure(id: string, fetchDirectory = true): Promise<void> {
    if (!active || !UUID.test(id)) return;
    if (!entries.has(id)) { if (fetchDirectory) await refresh(); return; }
    const entry = entries.get(id)!;
    if (!entry.profile.avatar || entry.snapshot.source || entry.snapshot.state === "error") return;
    if (pending.has(id)) return pending.get(id);
    const generation = epoch, avatar = entry.profile.avatar;
    entry.snapshot = { avatarId: avatar.id, source: "", state: "loading" };
    const work: Promise<void> = Promise.resolve().then(async () => {
      try {
        const reply = await request<{ image: string }>(avatar.url);
        const current = entries.get(id);
        if (!active || generation !== epoch || current?.profile.avatar?.id !== avatar.id || pending.get(id) !== work) return;
        if (!safeImage(reply?.image)) throw new Error("员工头像内容无效");
        current.snapshot = { avatarId: avatar.id, source: reply.image, state: "ready" }; current.loaded = ++touched; trim(id); notify(id);
      } catch {
        const current = entries.get(id);
        if (active && generation === epoch && current?.profile.avatar?.id === avatar.id && pending.get(id) === work) { current.snapshot = { avatarId: avatar.id, source: "", state: "error" }; notify(id); }
      } finally { if (pending.get(id) === work) pending.delete(id); }
    });
    pending.set(id, work); notify(id); return work;
  }
  return {
    get: (id: string): StaffAvatarSnapshot => active ? entries.get(id)?.snapshot || EMPTY : EMPTY,
    subscribe(id: string, listener: () => void) { let group = listeners.get(id); if (!group) { group = new Set(); listeners.set(id, group); } group.add(listener); return () => { group!.delete(listener); if (!group!.size) listeners.delete(id); }; },
    refresh, ensure,
    publish(value: unknown) { const revision = ++publication; if (apply(value, revision)) { const id = (value as StaffAvatarProfile).staffId; if (listeners.has(id)) void ensure(id); } },
    seed(values: unknown[]) { if (Array.isArray(values)) for (const value of values) if (apply(value, publication) && listeners.has((value as StaffAvatarProfile).staffId)) void ensure((value as StaffAvatarProfile).staffId); },
    suspend() { active = false; reset(); },
    resume() { active = true; },
  };
}
export type StaffAvatarStore = ReturnType<typeof createStaffAvatarStore>;
