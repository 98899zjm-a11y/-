import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { createMobileLanClient } from "./lan-client";
import type { ConnectionInfo, ConnectionInput, NativeResult, PrinterSettings } from "../desktop/renderer/bridge";

const configKey = "xjy-mobile-host-v1";
const emptyPrinter: PrinterSettings = { deviceName: "", mode: "full", widthMm: 210, heightMm: 297, offsetXmm: 0, offsetYmm: 0, scalePercent: 100, copies: 1, phone: "", standard: "", afterSalesWechat: "" };
type HostConfig = { host: string; port: number; code: string };
const maxBytes = 64 * 1024 * 1024;
function hostInput(input: ConnectionInput): HostConfig {
  const host = (input.host || "").trim(), parts = host.split(".").map(Number), port = Number(input.port || 31831), code = (input.code || "").trim();
  if (input.mode !== "client" || !/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || parts.some(value => value < 0 || value > 255) || !(parts[0] === 10 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31 || parts[0] === 192 && parts[1] === 168)) throw new Error("请输入店内电脑主机的局域网IP地址");
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !/^[A-Za-z0-9_-]{32}$/.test(code)) throw new Error("请填写主机端口和完整32位连接码");
  return { host: parts.join("."), port, code };
}
async function httpText(url: string, method: "GET" | "POST", body?: string): Promise<string> {
  if (!Capacitor.isNativePlatform()) throw new Error("请使用手机安装版连接店内主机");
  const address = new URL(url);
  const parts = address.hostname.split(".").map(Number), privateHost = /^\d{1,3}(\.\d{1,3}){3}$/.test(address.hostname) && parts.every(value => value >= 0 && value <= 255) && (parts[0] === 10 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31 || parts[0] === 192 && parts[1] === 168);
  if (address.protocol !== "http:" || !privateHost || address.username || address.password || !["/jewelry-identity", "/jewelry-lan"].includes(address.pathname) || address.search || address.hash) throw new Error("手机连接地址无效");
  const data = await CapacitorHttp.request({ url, method, ...(body ? { data: JSON.parse(body) } : {}), headers: { "Content-Type": "application/json" }, disableRedirects: true, connectTimeout: 10000, readTimeout: 15000, responseType: "text" });
  if (data.url && data.url !== url) throw new Error("主机地址发生跳转，请检查连接设置");
  if (data.status !== 200) throw new Error("主机未能响应，请确认电脑程序已打开");
  const text = typeof data.data === "string" ? data.data : JSON.stringify(data.data);
  if (new TextEncoder().encode(text).length > maxBytes) throw new Error("主机内容过大，请减少图片后重试");
  return text;
}
const transport = { get: (url: string) => httpText(url, "GET"), post: (url: string, body: string) => httpText(url, "POST", body) };
const dataBytes = (src: string) => { const encoded = src.split(",")[1] || ""; const text = atob(encoded); return Uint8Array.from(text, char => char.charCodeAt(0)); };
const bytesBase64 = (bytes: Uint8Array) => { let text = ""; for (let offset = 0; offset < bytes.length; offset += 8192) text += String.fromCharCode(...bytes.subarray(offset, offset + 8192)); return btoa(text); };
const privateId = (source: string) => {
  try {
    const base = new URL(window.location.href), address = new URL(source, base);
    // WKWebView's custom local scheme does not have a portable serialized origin.
    const local = address.protocol === base.protocol && address.hostname === base.hostname && address.port === base.port;
    return local && !address.username && !address.password && !address.search && !address.hash ? /^\/api\/images\/([a-f0-9-]{36})$/.exec(address.pathname)?.[1] : undefined;
  } catch { return undefined; }
};
const safeFileName = (name: string, extension: string) => (name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "").replace(/\.(?:png|jpe?g|webp)$/i, "").slice(0, 90).trim() || "珠宝报价") + "." + extension;

export async function installMobileBridge(): Promise<void> {
  if (!globalThis.crypto?.getRandomValues) throw new Error("手机系统暂不支持安全连接，请更新系统组件后重试");
  let config: HostConfig | null = null;
  try { const saved = JSON.parse(localStorage.getItem(configKey) || "null"); if (saved) config = hostInput({ mode: "client", ...saved }); } catch { localStorage.removeItem(configKey); }
  let client = config ? createMobileLanClient(config, transport) : null;
  let actor = "", epoch = 0, lastError = "";
  const imageCache = new Map<string, Promise<string>>(), objectUrls = new Set<string>();
  const clearImages = () => { epoch++; imageCache.clear(); objectUrls.forEach(url => URL.revokeObjectURL(url)); objectUrls.clear(); };
  const info = (): ConnectionInfo => ({ mode: "client", host: config?.host || "", port: config?.port || 31831, addresses: [], running: client?.connected || false, error: lastError });
  const imageResponse = async (id: string) => {
    if (!client) throw new Error("请先连接电脑主机");
    const current = client, revision = epoch, response = await current.imageResponse(id);
    if (current !== client || revision !== epoch) throw new Error("登录已切换");
    lastError = current.connected ? "" : "主机暂时无法连接，请检查店内网络";
    if (response.status === 401 || response.status === 403 && !current.connected) window.dispatchEvent(new Event("desktop-auth-lost"));
    return response;
  };
  const resolveImage = (source: string): Promise<string> => {
    const id = privateId(source); if (!id) return Promise.resolve(source);
    const key = actor + ":" + id;
    let task = imageCache.get(key);
    if (!task) {
      const revision = epoch;
      task = imageResponse(id).then(async response => {
        if (!response.ok) throw new Error("图片暂时不可读取");
        const type = response.headers.get("content-type") || "";
        if (!["image/png", "image/jpeg", "image/webp"].includes(type)) throw new Error("图片格式不支持");
        const bytes = await response.arrayBuffer(); if (revision !== epoch) throw new Error("登录已切换");
        const result = URL.createObjectURL(new Blob([bytes], { type })); objectUrls.add(result); return result;
      }).catch(error => { if (imageCache.get(key) === task) imageCache.delete(key); throw error; });
      imageCache.set(key, task);
    }
    return task;
  };
  // The React state retains canonical private image URLs. Only native image
  // loading resolves them to session-scoped local blobs, so saves keep IDs.
  const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src")!;
  const resolveFor = (image: HTMLImageElement, source: string) => {
    const revision = epoch;
    image.dataset.xjyPrivateSource = source;
    void resolveImage(source).then(url => { if (revision === epoch && image.dataset.xjyPrivateSource === source) descriptor.set!.call(image, url); }).catch(() => { if (revision === epoch) image.dispatchEvent(new Event("error")); });
  };
  const lazy = new IntersectionObserver(entries => entries.forEach(entry => {
    const image = entry.target as HTMLImageElement, source = image.dataset.xjyPrivateSource;
    if (entry.isIntersecting && source) { lazy.unobserve(image); resolveFor(image, source); }
  }), { rootMargin: "240px" });
  const scheduleImage = (image: HTMLImageElement, source: string) => {
    if (image.loading === "lazy") { image.dataset.xjyPrivateSource = source; descriptor.set!.call(image, "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"); lazy.observe(image); }
    else resolveFor(image, source);
  };
  Object.defineProperty(HTMLImageElement.prototype, "src", { ...descriptor, set(value: string) { const source = String(value); if (privateId(source)) scheduleImage(this, source); else { delete this.dataset.xjyPrivateSource; descriptor.set!.call(this, value); } } });
  const inspectImage = (image: HTMLImageElement) => { const source = image.getAttribute("src"); if (source && privateId(source)) scheduleImage(image, source); };
  new MutationObserver(records => records.forEach(record => {
    if (record.type === "attributes" && record.target instanceof HTMLImageElement) inspectImage(record.target);
    record.addedNodes.forEach(node => { if (node instanceof HTMLImageElement) inspectImage(node); if (node instanceof Element) node.querySelectorAll("img").forEach(inspectImage); });
    record.removedNodes.forEach(node => { if (node instanceof HTMLImageElement) lazy.unobserve(node); if (node instanceof Element) node.querySelectorAll("img").forEach(image => lazy.unobserve(image)); });
  })).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
  window.addEventListener("desktop-auth-lost", () => { actor = ""; clearImages(); });
  if (!crypto.randomUUID) Object.defineProperty(crypto, "randomUUID", { value: () => { const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = bytes[6] & 15 | 64; bytes[8] = bytes[8] & 63 | 128; const hex = [...bytes].map(value => value.toString(16).padStart(2, "0")).join(""); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`; } });
  const computerOnly = async (): Promise<NativeResult> => ({ ok: false, error: "请在保存资料的电脑主机上操作" });
  window.jewelryDesktop = {
    async request(input) {
      if (!client) return input.path === "/auth/status" ? { ok: true, status: 200, data: { needsSetup: false, authenticated: false } } : { ok: false, status: 503, data: { error: "请先连接电脑主机" } };
      const current = client, result = await current.dispatch(input);
      if (current !== client) return { ok: false, status: 401, data: { error: "连接已切换，请重新登录" } };
      lastError = current.connected || result.ok ? "" : (result.data as { error?: string })?.error || "主机暂时无法连接";
      if (input.path === "/auth/logout" || input.path === "/auth/login") { actor = result.ok ? (result.data as { user?: { id: string } }).user?.id || "" : ""; clearImages(); }
      if (result.status === 401 || result.status === 403 && !current.connected) window.dispatchEvent(new Event("desktop-auth-lost"));
      return { ...result, data: result.data ?? null };
    },
    getConnection: async () => info(),
    async setConnection(input) {
      try {
        const next = hostInput(input), candidate = createMobileLanClient(next, transport), status = await candidate.dispatch({ path: "/auth/status" });
        if (!status.ok) { await candidate.close(); throw new Error((status.data as { error?: string }).error || "主机验证失败"); }
        try { localStorage.setItem(configKey, JSON.stringify(next)); }
        catch { await candidate.close(); throw new Error("手机连接设置未能保存，请清理存储空间后重试"); }
        if (client) await client.close(); config = next; client = candidate; actor = ""; lastError = ""; clearImages();
        return { ok: true, ...info() };
      } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "主机连接失败" }; }
    },
    async saveImage(input) {
      try {
        if (!Capacitor.isNativePlatform()) throw new Error("请在手机安装版保存图片");
        const revision = epoch, current = client;
        const stillCurrent = () => { if (revision !== epoch || current !== client) throw new Error("登录已切换，请重新选择图片"); };
        const id = privateId(input.src);
        const original = id ? await imageResponse(id) : null;
        if (original && !original.ok) throw new Error("该截图暂时不可读取，请重新登录后再试");
        const bytes = original ? new Uint8Array(await original.arrayBuffer()) : /^data:image\/(png|jpeg|webp);base64,/.test(input.src) ? dataBytes(input.src) : null;
        stillCurrent();
        if (!bytes?.length) throw new Error("图片不存在");
        const extension = bytes[0] === 137 && bytes[1] === 80 ? "png" : bytes[0] === 255 && bytes[1] === 216 ? "jpg" : new TextDecoder().decode(bytes.subarray(8, 12)) === "WEBP" ? "webp" : "";
        if (!extension) throw new Error("图片格式不支持");
        const name = safeFileName(input.name, extension), result = await Filesystem.writeFile({ path: "quotes/" + name, directory: Directory.Cache, data: bytesBase64(bytes), recursive: true });
        stillCurrent();
        await Share.share({ title: "珠宝报价", files: [result.uri], dialogTitle: "保存或发送给客户" }); return { ok: true, path: "已打开系统保存与分享" };
      } catch (error) { return { ok: false, error: error instanceof Error ? error.message === "Share canceled" ? "已取消分享" : error.message : "图片保存失败" }; }
    },
    print: async () => { throw new Error("请在电脑主机打印报价单"); },
    exportPdf: computerOnly, backup: computerOnly, restore: computerOnly,
    getPrinters: async () => [], getPrintSettings: async () => ({ ...emptyPrinter }), savePrintSettings: async () => ({ ok: false, error: "请在电脑主机设置打印机" }),
    printWarranty: computerOnly, exportWarrantyPdf: computerOnly,
  };
}
