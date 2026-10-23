"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// project/desktop/renderer/browser-bridge.ts
var browser_bridge_exports = {};
__export(browser_bridge_exports, {
  installBrowserBridge: () => installBrowserBridge
});
module.exports = __toCommonJS(browser_bridge_exports);
var MAX_BYTES = 32 * 1024 * 1024;
var USERNAME_KEY = "xjy-browser-username-v1";
var CSRF = /^[a-f0-9]{64}$/;
var usernameValid = (value) => typeof value === "string" && /^[\p{L}\p{N}._-]{2,48}$/u.test(value);
var deny = (error) => ({ ok: false, error });
var plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
var knownKeys = (value, keys) => plain(value) && Object.keys(value).every((key) => keys.includes(key));
function installBrowserBridge(options = {}) {
  const target = options.target || window;
  if (target.jewelryDesktop && target.jewelryDesktop.surface !== "browser") throw new Error("\u4E0D\u80FD\u8986\u76D6\u7535\u8111\u7A0B\u5E8F\u7684\u672C\u673A\u8FDE\u63A5\u3002");
  const location = options.location || window.location, browserFetch = options.fetch || window.fetch.bind(window);
  const nav = options.navigator || window.navigator, storage = options.storage || window.localStorage;
  const secure = options.isSecureContext ?? window.isSecureContext;
  const FileType = options.File || File, BlobType = options.Blob || Blob;
  const ClipboardType = options.ClipboardItem || (typeof ClipboardItem !== "undefined" ? ClipboardItem : void 0);
  const originUrl = new URL(location.origin), origin = originUrl.origin;
  if (!["http:", "https:"].includes(originUrl.protocol) || origin !== location.origin || originUrl.username || originUrl.password || originUrl.pathname !== "/" || originUrl.search || originUrl.hash) throw new Error("\u624B\u673A\u9875\u9762\u7684\u8FDE\u63A5\u5730\u5740\u4E0D\u6B63\u786E\u3002");
  let csrf = "", sessionEpoch = 0, pendingSession = null;
  let writeQueue = Promise.resolve();
  const destroySession = () => {
    csrf = "";
    pendingSession = null;
    sessionEpoch++;
  };
  const hasGesture = () => options.gesture ? options.gesture() : nav.userActivation ? nav.userActivation.isActive : true;
  const phoneOnly = () => deny("\u6B64\u64CD\u4F5C\u8BF7\u7531\u7BA1\u7406\u5458\u5728\u516C\u53F8\u7535\u8111\u4E3B\u673A\u5B8C\u6210\uFF0C\u624B\u673A\u4E0D\u80FD\u66F4\u6539\u4E3B\u673A\u8D44\u6599\u6216\u5B89\u88C5 Windows \u7A0B\u5E8F\u3002");
  const fetchOptions = (method = "GET") => ({ method, credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "same-origin" });
  async function boundedBytes(response) {
    const declared = response.headers.get("content-length");
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BYTES)) throw new Error("\u4E3B\u673A\u8FD4\u56DE\u5185\u5BB9\u8FC7\u5927\uFF0C\u8BF7\u7F29\u5C0F\u67E5\u8BE2\u8303\u56F4\u3002");
    if (!response.body?.getReader) throw new Error("\u5F53\u524D\u6D4F\u89C8\u5668\u65E0\u6CD5\u5B89\u5168\u8BFB\u53D6\u6570\u636E\uFF0C\u8BF7\u5347\u7EA7\u6D4F\u89C8\u5668\u540E\u91CD\u8BD5\u3002");
    const reader = response.body.getReader(), chunks = [];
    let total = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        total += part.value.byteLength;
        if (total > MAX_BYTES) {
          await reader.cancel();
          throw new Error("\u4E3B\u673A\u8FD4\u56DE\u5185\u5BB9\u8FC7\u5927\uFF0C\u8BF7\u7F29\u5C0F\u67E5\u8BE2\u8303\u56F4\u3002");
        }
        chunks.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }
  async function readJson(response) {
    if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new Error("\u4E3B\u673A\u672A\u8FD4\u56DE\u4E1A\u52A1\u6570\u636E\uFF0C\u8BF7\u68C0\u67E5\u767B\u5F55\u548C\u8FDE\u63A5\u3002");
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await boundedBytes(response)));
  }
  async function session() {
    if (pendingSession) return pendingSession;
    const epoch = sessionEpoch;
    const pending = (async () => {
      const response = await browserFetch(origin + "/session", fetchOptions());
      const data = await readJson(response);
      if (!response.ok || !plain(data) || typeof data.csrf !== "string" || !CSRF.test(data.csrf)) throw new Error("\u4E3B\u673A\u4F1A\u8BDD\u9A8C\u8BC1\u5931\u8D25\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55\u3002");
      if (epoch !== sessionEpoch) throw new Error("\u767B\u5F55\u72B6\u6001\u5DF2\u6539\u53D8\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55\u3002");
      csrf = data.csrf;
      return data;
    })();
    pendingSession = pending;
    try {
      return await pending;
    } finally {
      if (pendingSession === pending) pendingSession = null;
    }
  }
  function validatePath(value) {
    if (typeof value !== "string" || value.length > 4096 || !value.startsWith("/") || value.startsWith("//") || /[\\\x00-\x20]/.test(value) || value.includes("#")) throw new Error("\u53EA\u80FD\u8BBF\u95EE\u5F53\u524D\u5DE5\u4F5C\u5BA4\u7684\u4E1A\u52A1\u9875\u9762\u3002");
    const rawPath = value.split("?")[0], url = new URL(value, origin);
    if (url.origin !== origin || url.pathname !== rawPath || rawPath.includes("%") || rawPath.split("/").some((segment) => segment === "." || segment === "..") || !/^\/(api|auth)(\/|$)/.test(rawPath)) throw new Error("\u4E1A\u52A1\u8BF7\u6C42\u5730\u5740\u4E0D\u6B63\u786E\u3002");
    if (rawPath === "/auth/setup" || /^\/api\/(local|windows|native|employee-update|desktop-update|connection|backup|restore)(\/|$)/.test(rawPath) || /^\/api\/internal-modules\/(configure|create)(\/|$)/.test(rawPath)) throw new Error("\u6B64\u64CD\u4F5C\u53EA\u80FD\u5728\u516C\u53F8\u7535\u8111\u4E3B\u673A\u5B8C\u6210\u3002");
    return { path: rawPath, url: url.href };
  }
  async function execute(input) {
    let logoutRequested = false;
    try {
      if (!knownKeys(input, ["path", "method", "body"])) throw new Error("\u4E1A\u52A1\u8BF7\u6C42\u5305\u542B\u4E0D\u652F\u6301\u7684\u53C2\u6570\u3002");
      const destination = validatePath(input.path), method = input.method || "GET";
      if (!["GET", "POST", "PATCH", "PUT", "DELETE"].includes(method) || method === "GET" && input.body !== void 0) throw new Error("\u4E1A\u52A1\u8BF7\u6C42\u65B9\u5F0F\u4E0D\u6B63\u786E\u3002");
      if (["/auth/login", "/auth/logout"].includes(destination.path) && method !== "POST" || destination.path === "/auth/status" && method !== "GET") throw new Error("\u767B\u5F55\u8BF7\u6C42\u65B9\u5F0F\u4E0D\u6B63\u786E\u3002");
      logoutRequested = destination.path === "/auth/logout";
      if (destination.path === "/auth/status" && method === "GET") {
        const data2 = await session();
        if (data2.needsSetup === true) return { ok: false, status: 503, data: { error: "\u8BF7\u5148\u7531\u7BA1\u7406\u5458\u5728\u516C\u53F8\u7535\u8111\u4E3B\u673A\u5EFA\u7ACB\u5458\u5DE5\u8D26\u53F7\u3002\u624B\u673A\u4E0D\u80FD\u521B\u5EFA\u5DE5\u4F5C\u5BA4\u3002" } };
        const { csrf: _token, ...status } = data2;
        return { ok: true, status: 200, data: status };
      }
      if (!csrf) await session();
      const epoch = sessionEpoch, token = csrf, init = fetchOptions(method);
      if (method !== "GET") {
        const body = JSON.stringify(input.body ?? {});
        if (new TextEncoder().encode(body).byteLength > MAX_BYTES) throw new Error("\u672C\u6B21\u4E0A\u4F20\u8FC7\u5927\uFF0C\u8BF7\u5206\u6279\u5904\u7406\u3002");
        init.headers = { "content-type": "application/json", "x-xjy-csrf": token };
        init.body = body;
      }
      const response = await browserFetch(destination.url, init), result = await readJson(response);
      if (epoch !== sessionEpoch) return { ok: false, status: 401, data: { error: "\u767B\u5F55\u72B6\u6001\u5DF2\u6539\u53D8\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55\u3002" } };
      if (!logoutRequested && destination.path === "/auth/login" && response.ok) {
        if (plain(result) && typeof result.csrf === "string" && CSRF.test(result.csrf) && result.csrf !== token) {
          csrf = result.csrf;
          pendingSession = null;
          sessionEpoch++;
        } else {
          csrf = "";
          const refreshed = await session();
          if (csrf === token || refreshed.authenticated !== true) {
            destroySession();
            throw new Error("\u4E3B\u673A\u672A\u5B8C\u6210\u767B\u5F55\u4F1A\u8BDD\u66F4\u65B0\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55\u3002");
          }
        }
      } else if (!logoutRequested && (response.status === 401 || response.status === 403)) destroySession();
      const data = plain(result) ? Object.fromEntries(Object.entries(result).filter(([key]) => key !== "csrf")) : result;
      return { ok: response.ok, status: response.status, data };
    } catch (error) {
      return { ok: false, status: 400, data: { error: error instanceof Error ? error.message : "\u8FDE\u63A5\u4E3B\u673A\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\u540E\u91CD\u8BD5\u3002" } };
    } finally {
      if (logoutRequested) destroySession();
    }
  }
  function request(input) {
    if ((input?.method || "GET") === "GET") return execute(input);
    const pending = writeQueue.then(() => execute(input));
    writeQueue = pending.then(() => void 0, () => void 0);
    return pending;
  }
  function filename(value, extension = "png") {
    let name = typeof value === "string" ? value.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").replace(/^[. ]+|[. ]+$/g, "").slice(0, 120) : "";
    if (!name) name = "\u946B\u91D1\u6E90\u62A5\u4EF7";
    if (!name.toLowerCase().endsWith("." + extension)) name += "." + extension;
    return name;
  }
  async function image(input) {
    if (!knownKeys(input, ["src", "name"]) || typeof input.src !== "string") throw new Error("\u56FE\u7247\u53C2\u6570\u4E0D\u6B63\u786E\u3002");
    let blob;
    const data = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(input.src);
    if (data) {
      if (data[2].length > Math.ceil(MAX_BYTES / 3) * 4) throw new Error("\u56FE\u7247\u8FC7\u5927\uFF0C\u8BF7\u51CF\u5C0F\u5C3A\u5BF8\u540E\u91CD\u8BD5\u3002");
      const decoded = atob(data[2]), bytes = new Uint8Array(decoded.length);
      for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
      blob = new BlobType([bytes], { type: "image/" + data[1] });
    } else {
      const url = new URL(input.src, origin);
      if (url.origin !== origin || !/^\/api\/images\/[a-f0-9-]{36}$/.test(url.pathname) || url.search || url.hash || url.username || url.password) throw new Error("\u53EA\u80FD\u4FDD\u5B58\u5F53\u524D\u5DE5\u4F5C\u5BA4\u7684\u56FE\u7247\u6216\u5DF2\u751F\u6210\u62A5\u4EF7\u56FE\u7247\u3002");
      const response = await browserFetch(url.href, fetchOptions());
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "\u56FE\u7247\u672A\u83B7\u51C6\u8BBF\u95EE\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55\u6216\u8054\u7CFB\u7BA1\u7406\u5458\u3002" : "\u4E3B\u673A\u56FE\u7247\u672A\u80FD\u8BFB\u53D6\u3002");
      const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(type)) throw new Error("\u6B64\u6587\u4EF6\u4E0D\u662F\u53EF\u4FDD\u5B58\u7684\u56FE\u7247\u3002");
      blob = new BlobType([await boundedBytes(response)], { type });
    }
    if (blob.size < 8 || blob.size > MAX_BYTES) throw new Error("\u56FE\u7247\u4E3A\u7A7A\u6216\u8D85\u51FA\u5141\u8BB8\u5927\u5C0F\u3002");
    const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer()), ascii = String.fromCharCode(...head);
    const valid = blob.type === "image/png" ? [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => head[index] === byte) : blob.type === "image/jpeg" ? head[0] === 255 && head[1] === 216 && head[2] === 255 : blob.type === "image/gif" ? ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a") : ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP";
    if (!valid) throw new Error("\u56FE\u7247\u5185\u5BB9\u4E0E\u6587\u4EF6\u7C7B\u578B\u4E0D\u4E00\u81F4\u3002");
    return blob;
  }
  async function downloadBlob(blob, name) {
    if (options.download) return options.download(blob, name);
    const href = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = href;
    link.download = name;
    link.rel = "noopener";
    try {
      document.body.appendChild(link);
      link.click();
      return true;
    } finally {
      link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 6e4);
    }
  }
  async function saveImage(input) {
    try {
      const blob = await image(input), name = filename(input.name, blob.type === "image/jpeg" ? "jpg" : blob.type.split("/")[1]);
      if (!await downloadBlob(blob, name)) return deny("\u6D4F\u89C8\u5668\u672A\u63A5\u6536\u4E0B\u8F7D\uFF0C\u8BF7\u91CD\u8BD5\u3002");
      return { ok: true, downloadStarted: true, message: "\u5DF2\u53D1\u8D77\u56FE\u7247\u4E0B\u8F7D\uFF0C\u8BF7\u5230\u6D4F\u89C8\u5668\u4E0B\u8F7D\u6216\u201C\u6587\u4EF6\u201D\u4E2D\u786E\u8BA4\u3002" };
    } catch (error) {
      return deny(error instanceof Error ? error.message : "\u56FE\u7247\u4E0B\u8F7D\u672A\u5B8C\u6210\u3002");
    }
  }
  async function copyImage(input) {
    if (!secure) return deny("\u56FE\u7247\u590D\u5236\u9700\u8981\u5B89\u5168\u8FDE\u63A5\uFF0C\u8BF7\u4F7F\u7528\u7BA1\u7406\u5458\u63D0\u4F9B\u7684 HTTPS \u5730\u5740\uFF0C\u6216\u5148\u4FDD\u5B58\u56FE\u7247\u3002");
    if (!hasGesture()) return deny("\u8BF7\u70B9\u51FB\u590D\u5236\u6309\u94AE\u518D\u64CD\u4F5C\uFF0C\u6D4F\u89C8\u5668\u4E0D\u5141\u8BB8\u81EA\u52A8\u590D\u5236\u56FE\u7247\u3002");
    if (!ClipboardType || !nav.clipboard?.write) return deny("\u5F53\u524D\u6D4F\u89C8\u5668\u4E0D\u652F\u6301\u771F\u5B9E\u56FE\u7247\u590D\u5236\uFF0C\u8BF7\u4F7F\u7528\u7CFB\u7EDF\u5206\u4EAB\u6216\u4FDD\u5B58\u56FE\u7247\u3002");
    const pending = image(input).then((blob) => {
      if (blob.type !== "image/png") throw new Error("\u6B64\u6D4F\u89C8\u5668\u53EA\u80FD\u590D\u5236 PNG \u56FE\u7247\uFF0C\u8BF7\u4F7F\u7528\u7CFB\u7EDF\u5206\u4EAB\u6216\u4FDD\u5B58\u56FE\u7247\u3002");
      return blob;
    });
    void pending.catch(() => {
    });
    try {
      const item = new ClipboardType({ "image/png": pending });
      await nav.clipboard.write([item]);
      await pending;
      return { ok: true, clipboard: true, message: "\u62A5\u4EF7\u56FE\u7247\u5DF2\u590D\u5236\uFF0C\u8BF7\u5207\u6362\u5230\u5FAE\u4FE1\u7C98\u8D34\u3002" };
    } catch {
      return deny("\u56FE\u7247\u590D\u5236\u88AB\u6D4F\u89C8\u5668\u62D2\u7EDD\uFF0C\u8BF7\u518D\u6B21\u70B9\u51FB\uFF0C\u6216\u4F7F\u7528\u7CFB\u7EDF\u5206\u4EAB\u3001\u4FDD\u5B58\u56FE\u7247\u3002");
    }
  }
  async function shareImage(input) {
    if (!secure) return deny("\u7CFB\u7EDF\u5206\u4EAB\u9700\u8981\u5B89\u5168\u8FDE\u63A5\uFF0C\u8BF7\u4F7F\u7528 HTTPS \u5730\u5740\uFF1B\u4E5F\u53EF\u5148\u4FDD\u5B58\u56FE\u7247\u540E\u4ECE\u76F8\u518C\u6216\u6587\u4EF6\u53D1\u9001\u3002");
    if (!hasGesture()) return deny("\u8BF7\u70B9\u51FB\u5206\u4EAB\u6309\u94AE\u540E\u518D\u64CD\u4F5C\uFF0C\u6D4F\u89C8\u5668\u9700\u8981\u4F60\u7684\u4E3B\u52A8\u70B9\u51FB\u3002");
    if (!nav.share || !nav.canShare) return copyImage(input);
    try {
      const blob = await image(input), file = new FileType([blob], filename(input.name, blob.type === "image/jpeg" ? "jpg" : blob.type.split("/")[1]), { type: blob.type });
      const payload = { files: [file] };
      if (!nav.canShare(payload)) return copyImage(input);
      await nav.share(payload);
      return { ok: true, message: "\u7CFB\u7EDF\u5206\u4EAB\u5DF2\u5B8C\u6210\uFF0C\u8BF7\u6838\u5BF9\u6240\u9009\u5E94\u7528\u548C\u63A5\u6536\u4EBA\u3002" };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return { ok: false, canceled: true };
      return deny("\u7CFB\u7EDF\u5206\u4EAB\u672A\u5B8C\u6210\uFF0C\u8BF7\u518D\u6B21\u70B9\u51FB\uFF0C\u6216\u4FDD\u5B58\u56FE\u7247\u540E\u53D1\u9001\u3002");
    }
  }
  function rememberUsername(input) {
    if (!usernameValid(input.username)) return deny("\u7528\u6237\u540D\u683C\u5F0F\u4E0D\u6B63\u786E\u3002");
    try {
      storage.setItem(USERNAME_KEY, input.username);
      return { ok: true };
    } catch {
      return deny("\u6D4F\u89C8\u5668\u4E0D\u5141\u8BB8\u8BB0\u4F4F\u7528\u6237\u540D\uFF0C\u53EF\u6B63\u5E38\u624B\u52A8\u767B\u5F55\u3002");
    }
  }
  const browserUpdate = { phase: "idle", currentVersion: "", message: "\u624B\u673A\u4F7F\u7528\u7F51\u9875\u7248\u672C\uFF0C\u5237\u65B0\u9875\u9762\u5373\u53EF\u8BFB\u53D6\u66F4\u65B0\uFF0C\u4E0D\u5B89\u88C5 Windows \u7A0B\u5E8F\u3002" };
  const bridge = {
    surface: "browser",
    request,
    destroySession,
    getConnection: async () => ({ mode: "client", host: originUrl.hostname, port: Number(originUrl.port || (originUrl.protocol === "https:" ? 443 : 80)), addresses: [], running: true, error: "", clientOnly: false }),
    setConnection: async () => phoneOnly(),
    getModuleStatus: async () => {
      const result = await request({ path: "/api/internal-modules/status" });
      if (!result.ok || !plain(result.data) || !Array.isArray(result.data.modules)) throw new Error("\u4E3B\u673A\u6A21\u5757\u72B6\u6001\u6682\u65F6\u65E0\u6CD5\u8BFB\u53D6\u3002");
      return { ...result.data, hostMode: false };
    },
    openModule: async (input) => {
      if (!knownKeys(input, ["id"]) || !["ledger", "inventory"].includes(input.id)) return deny("\u8BF7\u9009\u62E9\u8D22\u52A1\u7CFB\u7EDF\u6216\u5E93\u7BA1\u7BA1\u7406\u3002");
      location.assign("/modules/" + input.id + "/");
      return { ok: true };
    },
    closeModule: async () => ({ ok: true }),
    configureModule: async () => phoneOnly(),
    createModuleData: async () => phoneOnly(),
    readLoginMemory: async (input) => {
      let remembered = "";
      try {
        remembered = storage.getItem(USERNAME_KEY) || "";
      } catch {
      }
      const username = input?.username !== void 0 ? input.username : remembered;
      return { ok: true, username: usernameValid(username) ? username : "", password: "", hasPassword: false, available: true, scopeKey: origin };
    },
    rememberLoginUsername: async (input) => rememberUsername(input),
    rememberLogin: async (input) => rememberUsername(input),
    forgetLoginPassword: async () => ({ ok: true, message: "\u7F51\u9875\u4E0D\u4FDD\u5B58\u5BC6\u7801\uFF0C\u8BF7\u5728\u624B\u673A\u7CFB\u7EDF\u5BC6\u7801\u7BA1\u7406\u5668\u4E2D\u7BA1\u7406\u3002" }),
    print: async () => {
      throw new Error("\u624B\u673A\u8BF7\u4F7F\u7528\u62A5\u4EF7\u9875\u9762\u7684\u201C\u4E3B\u673A\u6253\u5370\u201D\uFF0C\u4E0D\u80FD\u76F4\u63A5\u8C03\u7528 Windows \u6253\u5370\u673A\u3002");
    },
    saveImage,
    saveImageAs: saveImage,
    shareImage,
    copyImage,
    getImageSaveSettings: async () => ({ path: "\u7531\u624B\u673A\u6D4F\u89C8\u5668\u6216\u7CFB\u7EDF\u201C\u6587\u4EF6\u201D\u9009\u62E9\uFF0C\u7F51\u9875\u4E0D\u8BFB\u53D6\u4F60\u7684\u672C\u5730\u76EE\u5F55", mobile: true }),
    chooseImageSaveFolder: async () => deny("\u624B\u673A\u7531\u6D4F\u89C8\u5668\u6216\u7CFB\u7EDF\u201C\u6587\u4EF6\u201D\u7BA1\u7406\u4FDD\u5B58\u4F4D\u7F6E\uFF0C\u4E0D\u80FD\u8BBE\u7F6E Windows \u6587\u4EF6\u5939\u3002"),
    saveTextFile: async (input) => {
      try {
        if (!knownKeys(input, ["text", "name", "extension"]) || typeof input.text !== "string" || !["csv", "txt"].includes(input.extension) || new TextEncoder().encode(input.text).length > MAX_BYTES) return deny("\u5BFC\u51FA\u6587\u4EF6\u53C2\u6570\u4E0D\u6B63\u786E\u6216\u5185\u5BB9\u8FC7\u5927\u3002");
        const blob = new BlobType(["\uFEFF", input.text], { type: input.extension === "csv" ? "text/csv;charset=utf-8" : "text/plain;charset=utf-8" });
        if (!await downloadBlob(blob, filename(input.name, input.extension))) return deny("\u6D4F\u89C8\u5668\u672A\u63A5\u6536\u4E0B\u8F7D\u3002");
        return { ok: true, message: "\u5DF2\u53D1\u8D77\u6587\u4EF6\u4E0B\u8F7D\uFF0C\u8BF7\u5230\u6D4F\u89C8\u5668\u4E0B\u8F7D\u6216\u201C\u6587\u4EF6\u201D\u4E2D\u786E\u8BA4\u3002" };
      } catch {
        return deny("\u6587\u4EF6\u5BFC\u51FA\u672A\u5B8C\u6210\uFF0C\u8BF7\u91CD\u8BD5\u3002");
      }
    },
    backup: async () => phoneOnly(),
    restore: async () => phoneOnly(),
    exportPdf: async () => deny("\u624B\u673A\u8BF7\u4F7F\u7528\u4E3B\u673A\u6253\u5370\u6216\u5DF2\u751F\u6210\u7684\u6587\u4EF6\u5BFC\u51FA\u5165\u53E3\u3002"),
    getDataInfo: async () => ({ path: "\u516C\u53F8\u4E3B\u673A\u8D44\u6599\uFF0C\u624B\u673A\u4E0D\u76F4\u63A5\u8BBF\u95EE\u6570\u636E\u5E93\u6587\u4EF6" }),
    getPrinters: async () => [],
    getPrintSettings: async () => {
      throw new Error("\u6253\u5370\u8BBE\u7F6E\u7531\u516C\u53F8\u4E3B\u673A\u7BA1\u7406\u5458\u7BA1\u7406\uFF0C\u624B\u673A\u8BF7\u4F7F\u7528\u4E3B\u673A\u6253\u5370\u3002");
    },
    savePrintSettings: async () => phoneOnly(),
    printWarranty: async () => phoneOnly(),
    exportWarrantyPdf: async () => phoneOnly(),
    exportWarrantyDocx: async () => phoneOnly(),
    getEmployeeUpdateCapability: async () => ({ supported: true, canInstall: false, currentVersion: "", message: browserUpdate.message, code: "BROWSER_ONLY" }),
    getEmployeeUpdateState: async () => ({ ...browserUpdate }),
    employeeUpdate: async () => ({ ok: false, state: { ...browserUpdate }, error: browserUpdate.message, code: "BROWSER_ONLY" })
  };
  target.jewelryDesktop = Object.freeze(bridge);
  return bridge;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  installBrowserBridge
});
