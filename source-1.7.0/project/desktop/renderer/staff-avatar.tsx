import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { api } from "./bridge";
import { createStaffAvatarStore, type StaffAvatarStore } from "./staff-avatar-store";
import type { CollaborationUser } from "./collaboration-types";

const AvatarContext = createContext<StaffAvatarStore | null>(null);
const emptySnapshot = Object.freeze({ avatarId: "", source: "", state: "idle" as const });
const noopSubscribe = () => () => {};

export function StaffAvatarProvider({ actor, scopeKey, children }: { actor: CollaborationUser; scopeKey: string; children: ReactNode }) {
  const store = useMemo(() => createStaffAvatarStore(api), [scopeKey, actor.id, actor.grantRevision]);
  useEffect(() => {
    store.resume();
    const refresh = () => { if (document.visibilityState !== "hidden") void store.refresh(); };
    const revoke = () => store.suspend();
    refresh(); const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh); window.addEventListener("desktop-auth-lost", revoke);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); window.removeEventListener("desktop-auth-lost", revoke); store.suspend(); };
  }, [store]);
  return <AvatarContext.Provider value={store}>{children}</AvatarContext.Provider>;
}

export function useStaffAvatarStore() { return useContext(AvatarContext); }

// Keeping one wrapper class preserves the existing layout at every avatar size.
// Only validated, authenticated image data supplied by the scoped store is used.
export function StaffAvatar({ staffId, name, className = "" }: { staffId: string; name: string; className?: string }) {
  const store = useStaffAvatarStore();
  const snapshot = useSyncExternalStore(store ? listener => store.subscribe(staffId, listener) : noopSubscribe, () => store?.get(staffId) || emptySnapshot, () => emptySnapshot);
  useEffect(() => { if (store) void store.ensure(staffId); }, [store, staffId, snapshot.avatarId]);
  return <span className={className} aria-label={!snapshot.source ? `${name || "同事"}的默认头像` : undefined}>
    {snapshot.source ? <img src={snapshot.source} alt={`${name || "同事"}的头像`} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit", display: "block" }}/> : <span aria-hidden="true">{Array.from(name || "顾")[0]}</span>}
  </span>;
}
