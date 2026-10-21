import type { Bootstrap, StaffUser } from "@/lib/domain";

export type DesktopUser = StaffUser & { username: string };
export type DesktopBootstrap = Omit<Bootstrap, "user" | "users"> & { user: DesktopUser; users: DesktopUser[] };
export type AuthStatus = { needsSetup: boolean; authenticated: boolean; user?: DesktopUser };
export type NativeResult = { ok: boolean; path?: string; canceled?: boolean; error?: string };
export type ConnectionMode = "standalone" | "host" | "client";
export type ConnectionInfo = { mode: ConnectionMode; host: string; port: number; addresses: { name: string; address: string }[]; running: boolean; error: string; code?: string };
export type ConnectionInput = { mode: ConnectionMode; host?: string; port?: number; code?: string };
export type ConnectionResult = { ok: boolean; error?: string } & Partial<ConnectionInfo>;
export type PrinterSettings = { deviceName: string; mode: "full" | "fields"; widthMm: number; heightMm: number; offsetXmm: number; offsetYmm: number; scalePercent: number; copies: number; phone: string; standard: string; afterSalesWechat: string };
export type NativePrinter = { name: string; displayName: string; isDefault: boolean };

declare global {
  interface Window {
    jewelryDesktop: {
      request: (request: { path: string; method?: string; body?: unknown }) => Promise<{ ok: boolean; status: number; data: unknown }>;
      print: () => Promise<void>;
      saveImage: (request: { src: string; name: string }) => Promise<NativeResult>;
      backup: () => Promise<NativeResult>;
      restore: () => Promise<NativeResult & { reloadRequired?: boolean }>;
      exportPdf: () => Promise<NativeResult>;
      getDataInfo?: () => Promise<{ path: string }>;
      getConnection: () => Promise<ConnectionInfo>;
      setConnection: (request: ConnectionInput) => Promise<ConnectionResult>;
      getPrinters: () => Promise<NativePrinter[]>;
      getPrintSettings: () => Promise<PrinterSettings>;
      savePrintSettings: (input: PrinterSettings) => Promise<{ ok: boolean; settings?: PrinterSettings; error?: string }>;
      printWarranty: (request: { showDialog?: boolean }) => Promise<NativeResult>;
      exportWarrantyPdf: () => Promise<NativeResult>;
    };
  }
}

export async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  if (!window.jewelryDesktop?.request) throw new Error("本机服务未就绪，请关闭程序后重新打开。");
  const response = await window.jewelryDesktop.request({ path, method, body });
  const result = response.data as { error?: string | { message?: string }; message?: string } | null;
  if (!response.ok) {
    if (response.status === 401 && path.startsWith("/api/")) window.dispatchEvent(new CustomEvent("desktop-auth-lost", { detail: { path } }));
    throw new Error((typeof result?.error === "string" ? result.error : result?.error?.message) || result?.message || `工作室操作失败（${response.status}）`);
  }
  return response.data as T;
}
