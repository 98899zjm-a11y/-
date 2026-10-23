export type AccessLevel = "disabled" | "view" | "operate" | "manage";
export type AccessModule = "sales" | "ledger" | "inventory" | "cashier";
export type ModuleAccess = Record<AccessModule, AccessLevel>;
export type AccessUser = { id: string; role: string; moduleAccess?: Partial<ModuleAccess>; grantRevision?: number };
export const accessLabels: Record<AccessLevel, string> = { disabled: "不可用", view: "只查看", operate: "可操作", manage: "业务管理" };
export const accessModules: { id: AccessModule; label: string }[] = [{ id: "sales", label: "销售报价" }, { id: "ledger", label: "财务系统" }, { id: "inventory", label: "库管管理" }, { id: "cashier", label: "出纳系统" }];
export function accessFor(user: AccessUser, module: AccessModule): AccessLevel {
  if (user.role === "admin") return "manage";
  const value = user.moduleAccess?.[module];
  return value && ["disabled", "view", "operate", "manage"].includes(value) ? value : "disabled";
}
export function normalizedAccess(user: AccessUser): ModuleAccess { return Object.fromEntries(accessModules.map(module => [module.id, accessFor(user, module.id)])) as ModuleAccess; }
export const mayRead = (level: AccessLevel) => level !== "disabled";
export const mayOperate = (level: AccessLevel) => level === "operate" || level === "manage";
