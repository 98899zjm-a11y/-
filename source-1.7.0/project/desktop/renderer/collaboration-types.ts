export const capabilityKeys = ["messages.post", "messages.moderate", "notes.use", "inventory.reports.create", "inventory.reports.review", "sales.publications.prepare", "sales.publications.publish", "sales.orders.review", "personal.sales.view", "personal.sales.profit"] as const;
export type CapabilityKey = typeof capabilityKeys[number];
export type Capabilities = Partial<Record<CapabilityKey, boolean>>;
export type CollaborationUser = { id: string; role: string; capabilities?: Capabilities; grantRevision?: number };
export function hasCapability(user: CollaborationUser, key: CapabilityKey): boolean { return user.role === "admin" || user.capabilities?.[key] === true; }
export const collaborationTime = (value?: string | null) => value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "—";
export const collaborationError = (problem: unknown) => problem instanceof Error ? problem.message : "操作未能完成，请重试。";
export type PrivateNote = { id: string; title: string; body: string; color: "cream" | "rose" | "sage" | "blue" | "lilac" | "gray"; tag: string; dueAt: string | null; pinned: boolean; done: boolean; archived: boolean; revision: number; createdAt: string; updatedAt: string };
