import type { Bootstrap, StaffUser } from "@/lib/domain";

export type ModuleAccess='disabled'|'view'|'operate'|'manage';
export type DesktopUser = StaffUser & { username: string; moduleAccess?:Partial<Record<'sales'|'ledger'|'inventory'|'cashier',ModuleAccess>>; grantRevision?:number };
export type DesktopBootstrap = Omit<Bootstrap, "user" | "users"> & { user: DesktopUser; users: DesktopUser[] };
export type AuthStatus = { needsSetup: boolean; authenticated: boolean; user?: DesktopUser };
export type NativeResult = { ok: boolean; path?: string; canceled?: boolean; error?: string; message?: string };
export type AppInfo = { appVersion: string };
export type ConnectionMode = "standalone" | "host" | "client";
export type ConnectionInfo = { mode: ConnectionMode; host: string; port: number; addresses: { name: string; address: string }[]; running: boolean; error: string; code?: string; clientOnly?: boolean };
export type ConnectionInput = { mode: ConnectionMode; host?: string; port?: number; code?: string };
export type ConnectionResult = { ok: boolean; error?: string } & Partial<ConnectionInfo>;
export type PrinterSettings = { deviceName: string; mode: "full" | "fields"; widthMm: number; heightMm: number; offsetXmm: number; offsetYmm: number; scalePercent: number; copies: number; phone: string; standard: string; afterSalesWechat: string; layoutOffsets?: Record<string, { xMm: number; yMm: number }>; fontSizes?:Record<string,number> };
export type NativePrinter = { name: string; displayName: string; isDefault: boolean };
export type ModuleId='ledger'|'inventory'|'cashier';
export type ModuleStatus={modules:{id:ModuleId;label:string;version:string;configured:boolean;running:boolean;access?:ModuleAccess;error?:string}[];hostMode:boolean;error?:string};
export type LoginMemory = { ok?: boolean; username: string; password: string; hasPassword: boolean; available: boolean; scopeKey: string; error?: string };
export type EmployeeUpdatePhase = 'idle'|'checking'|'available'|'latest'|'downloading'|'verifying'|'ready'|'installing'|'handoff'|'error'|'unavailable';
export type EmployeeUpdateState = { phase: EmployeeUpdatePhase; currentVersion: string; message: string; targetVersion?: string; received?: number; total?: number; code?: string };
export type EmployeeUpdateCapability = { supported: boolean; canInstall: boolean; currentVersion: string; message: string; code?: string };
export type EmployeeUpdateResult = { ok: boolean; state: EmployeeUpdateState; error?: string; code?: string };
export type HostRestoreSelection = 'sales'|'ledger'|'inventory'|'documents'|'allBusiness';
export type HostMaintenanceWarning = { code: string; message: string };
export type HostMaintenanceResult = NativeResult & { jobId?: string; status?: 'queued'|'running'|'completed'|'failed'; reloadRequired?: boolean; warnings?: HostMaintenanceWarning[] };
export type DailyBackupHealth = { version: 1; state: 'running'|'verified-today'|'failed'|'unverified'; day: string; lastAttemptAt: string|null; lastVerifiedAt: string|null; lastError: { at: string; code: string; message: string }|null };
export type HostMaintenanceInfo = { ok: boolean; available: boolean; backups: { name: string; createdAt: string; kind: string }[]; jobs: { id: string; kind: string; status: string; at?: string; error?: string; warnings?: HostMaintenanceWarning[]; result?: { warnings?: HostMaintenanceWarning[] } }[]; retentionDays: 7; encrypted: true; reason?: string; error?: string; dailyBackup?: DailyBackupHealth };

declare global {
  interface Window {
    jewelryDesktop: {
      surface?: 'desktop'|'browser';
      getAppInfo?: () => Promise<AppInfo>;
      copyImage?: (input: { src: string; name: string }) => Promise<NativeResult>;
      getHostPrintRouting?: () => Promise<import('./host-print-settings').HostPrintOptions | { ok: boolean; options?: import('./host-print-settings').HostPrintOptions; error?: string; auditWarning?: string }>;
      saveHostPrintRouting?: (input: { expectedRevision: number; warrantyDeviceName: string; a4DeviceName: string }) => Promise<import('./host-print-settings').HostPrintOptions | { ok: boolean; options?: import('./host-print-settings').HostPrintOptions; error?: string; auditWarning?: string }>;
      getHostMaintenance?: () => Promise<HostMaintenanceInfo>;
      exitHost?: () => Promise<NativeResult>;
      getEmployeeUpdateCapability?: () => Promise<EmployeeUpdateCapability>;
      getEmployeeUpdateState?: () => Promise<EmployeeUpdateState>;
      employeeUpdate?: (input: { intent: 'check'|'download'|'install' }) => Promise<EmployeeUpdateResult>;
      getModuleStatus?:()=>Promise<ModuleStatus>;
      openModule?:(input:{id:ModuleId})=>Promise<NativeResult>;
      closeModule?:()=>Promise<NativeResult>;
      configureModule?:(input:{id:ModuleId})=>Promise<NativeResult>;
      createModuleData?:(input:{id:ModuleId})=>Promise<NativeResult>;
      getModuleActivity?:()=>Promise<{module:ModuleId|null;lastActivityAt:number;visible:boolean}>;
      request: (request: { path: string; method?: string; body?: unknown }) => Promise<{ ok: boolean; status: number; data: unknown }>;
      readLoginMemory?: (input?: { username?: string }) => Promise<LoginMemory>;
      rememberLoginUsername?: (input: { username: string; scopeKey?: string }) => Promise<NativeResult>;
      rememberLogin?: (input: { username: string; password: string; rememberPassword: boolean; userId?: string; scopeKey?: string }) => Promise<NativeResult>;
      forgetLoginPassword?: (input: { username?: string; scopeKey?: string }) => Promise<NativeResult>;
      print: () => Promise<void>;
      saveImage: (request: { src: string; name: string }) => Promise<NativeResult>;
      saveImageAs?: (request: { src: string; name: string }) => Promise<NativeResult>;
      shareImage?: (request: { src: string; name: string }) => Promise<NativeResult>;
      getImageSaveSettings?: () => Promise<{ path: string; mobile?: boolean }>;
      chooseImageSaveFolder?: () => Promise<NativeResult>;
      saveTextFile?: (request: { text: string; name: string; extension: 'csv' | 'txt' }) => Promise<NativeResult>;
      backup: () => Promise<HostMaintenanceResult>;
      restore: (input?: { name: string; selection: HostRestoreSelection }) => Promise<HostMaintenanceResult>;
      exportPdf: () => Promise<NativeResult>;
      getDataInfo?: () => Promise<{ path: string }>;
      getConnection: () => Promise<ConnectionInfo>;
      setConnection: (request: ConnectionInput) => Promise<ConnectionResult>;
      getPrinters: () => Promise<NativePrinter[]>;
      getPrintSettings: () => Promise<PrinterSettings>;
      savePrintSettings: (input: PrinterSettings) => Promise<{ ok: boolean; settings?: PrinterSettings; error?: string }>;
      printWarranty: (request: { showDialog?: boolean }) => Promise<NativeResult>;
      exportWarrantyPdf: () => Promise<NativeResult>;
      exportWarrantyDocx?: (request: { sheets: import("./warranty-data").WarrantySheet[]; number?: string; settings: Pick<PrinterSettings, "mode" | "widthMm" | "heightMm" | "offsetXmm" | "offsetYmm" | "scalePercent" | "layoutOffsets" | "fontSizes"> }) => Promise<NativeResult>;
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
