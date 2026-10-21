import { x25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { gcm } from "@noble/ciphers/aes.js";

export type MobileLanConfig = { host: string; port?: number; code: string; timeoutMs?: number };
export type MobileLanTransport = {
  /** Native adapters must reject redirects and public/DNS destinations too. */
  get(url: string): Promise<string>;
  post(url: string, body: string): Promise<string>;
};
export type MobileRequest = { path: string; method?: string; body?: unknown };
export type MobileReply<T = unknown> = { ok: boolean; status: number; data?: T };
export type MobileEnvelope = { publicKey?: string; iv: string; tag: string; data: string };

const MAX_WIRE_BYTES = 64 * 1024 * 1024;
const encoder = new TextEncoder(), decoder = new TextDecoder("utf-8", { fatal: true });
const PREFIX = Uint8Array.from([48, 42, 48, 5, 6, 3, 43, 101, 110, 3, 33, 0]);
const HKDF_INFO = encoder.encode("xjy-lan-v1-x25519-aes256gcm");
export class MobileLanError extends Error { constructor(public status: number, message: string) { super(message); this.name = "MobileLanError"; } }
const fail = (status: number, message: string): never => { throw new MobileLanError(status, message); };
const badReply = (status: number, message: string): MobileReply<{ error: string }> => ({ ok: false, status, data: { error: message } });
const jsonResponse = (data: unknown, status: number): Response => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" } });
const concat = (...parts: Uint8Array[]): Uint8Array => { const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; } return result; };

export function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
  return btoa(binary);
}
export function encodeBase64url(bytes: Uint8Array): string { return encodeBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
export function decodeBase64url(text: string): Uint8Array {
  if (typeof text !== "string" || !/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) fail(403, "主机通信编码无效");
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - text.length % 4) % 4);
  try { return Uint8Array.from(atob(padded), character => character.charCodeAt(0)); } catch { return fail(403, "主机通信编码无效"); }
}
function decodeBase64(text: string): Uint8Array {
  if (typeof text !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length > MAX_WIRE_BYTES) fail(403, "主机图片编码无效");
  try { return Uint8Array.from(atob(text), character => character.charCodeAt(0)); } catch { return fail(403, "主机图片编码无效"); }
}
export function spkiFromRaw(raw: Uint8Array): Uint8Array { if (raw.length !== 32) fail(403, "主机公钥长度无效"); return concat(PREFIX, raw); }
export function rawFromSpki(spki: Uint8Array): Uint8Array {
  if (spki.length !== 44 || !PREFIX.every((byte, index) => byte === spki[index])) fail(403, "主机公钥格式无效");
  return spki.slice(12);
}
export function identityPin(spki: Uint8Array): string { rawFromSpki(spki); return encodeBase64url(sha256(spki).slice(0, 24)); }
export function deriveMobileKey(secretKey: Uint8Array, serverSpki: Uint8Array, ephemeralSpki: Uint8Array) {
  rawFromSpki(ephemeralSpki);
  const sharedSecret = x25519.getSharedSecret(secretKey, rawFromSpki(serverSpki));
  const salt = sha256(concat(serverSpki, ephemeralSpki));
  return { sharedSecret, salt, key: hkdf(sha256, sharedSecret, salt, HKDF_INFO, 32) };
}
export function encryptMobileEnvelope(key: Uint8Array, plaintext: string, direction: "request" | "response", iv: Uint8Array, publicKey?: string): MobileEnvelope {
  if (key.length !== 32 || iv.length !== 12) fail(403, "通信密钥或随机数长度无效");
  const encrypted = gcm(key, iv, encoder.encode("xjy-lan-v1:" + direction)).encrypt(encoder.encode(plaintext));
  return { ...(publicKey ? { publicKey } : {}), iv: encodeBase64url(iv), tag: encodeBase64url(encrypted.slice(-16)), data: encodeBase64url(encrypted.subarray(0, encrypted.length - 16)) };
}
export function decryptMobileEnvelope(key: Uint8Array, envelope: MobileEnvelope, direction: "request" | "response"): string {
  if (!envelope || typeof envelope !== "object" || typeof envelope.iv !== "string" || typeof envelope.tag !== "string" || typeof envelope.data !== "string" || envelope.data.length > MAX_WIRE_BYTES) fail(403, "主机响应格式无效");
  const iv = decodeBase64url(envelope.iv), tag = decodeBase64url(envelope.tag), data = decodeBase64url(envelope.data);
  if (key.length !== 32 || iv.length !== 12 || tag.length !== 16) fail(403, "主机响应验证失败");
  return decoder.decode(gcm(key, iv, encoder.encode("xjy-lan-v1:" + direction)).decrypt(concat(data, tag)));
}
export function isMobilePrivateIPv4(value: string): boolean {
  if (typeof value !== "string") return false;
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some(part => !/^(?:0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255)) return false;
  const [a, b] = parts.map(Number);
  return a === 10 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31 || a === 127;
}
export function canonicalMobileRequest(input: MobileRequest): MobileRequest {
  if (!input || typeof input !== "object" || Array.isArray(input) || typeof input.path !== "string" || input.path.length > 2500 || input.path.includes("\\") || !/^\/(?:api|auth)(?:\/|$)/.test(input.path)) fail(400, "请求地址无效");
  let address: URL;
  try { address = new URL(input.path, "http://offline.invalid"); } catch { return fail(400, "请求地址无效"); }
  if (address.origin !== "http://offline.invalid" || address.hash || address.pathname + address.search !== input.path) fail(400, "请求地址须为规范地址");
  const method = String(input.method || "GET").toUpperCase();
  if (!["GET", "POST", "PATCH"].includes(method)) fail(405, "不支持此操作方式");
  return { path: input.path, method, ...(input.body !== undefined ? { body: input.body } : {}) };
}
function secureRandom(count: number): Uint8Array {
  try { if (typeof globalThis.crypto?.getRandomValues !== "function") throw new Error(); return globalThis.crypto.getRandomValues(new Uint8Array(count)); }
  catch { return fail(503, "手机安全随机数不可用，无法发送登录信息"); }
}
export function mobileRequestUuid(): string {
  const bytes = secureRandom(16); bytes[6] = bytes[6] & 15 | 64; bytes[8] = bytes[8] & 63 | 128;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
async function timeout<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let handle: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([operation, new Promise<T>((_resolve, reject) => { handle = setTimeout(() => reject(new MobileLanError(503, "局域网主机连接超时")), milliseconds); })]); }
  finally { if (handle !== undefined) clearTimeout(handle); }
}
function parseLimited(text: string, limit = MAX_WIRE_BYTES): unknown {
  if (typeof text !== "string" || text.length > limit || encoder.encode(text).length > limit) fail(413, "局域网内容超过大小限制");
  try { return JSON.parse(text); } catch { return fail(403, "主机响应格式无效"); }
}
type Decoded = { requestId: string; result: MobileReply; token?: string | null; image?: { bytes: string; headers: Record<string, string> } };

export function createMobileLanClient(config: MobileLanConfig, transport: MobileLanTransport) {
  const host = typeof config?.host === "string" ? config.host.trim() : "", port = config?.port ?? 31831, code = typeof config?.code === "string" ? config.code.trim() : "", duration = config?.timeoutMs ?? 30000;
  if (!isMobilePrivateIPv4(host)) fail(400, "只支持店内局域网 IPv4 地址，不能填写互联网地址或域名");
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail(400, "主机端口须为1至65535");
  if (!/^[A-Za-z0-9_-]{32}$/.test(code)) fail(400, "请填写主机显示的完整连接码");
  if (!Number.isFinite(duration) || duration < 100 || duration > 120000) fail(400, "主机连接超时时间无效");
  if (typeof transport?.get !== "function" || typeof transport?.post !== "function") fail(400, "手机通信组件未连接");
  const base = `http://${host}:${port}`;
  let token: string | null = null, closed = false, connected = false, revision = 0, queue: Promise<unknown> = Promise.resolve();
  let serverSpki: Uint8Array | null = null, pendingIdentity: Promise<Uint8Array> | null = null;
  const enqueue = <T>(action: () => Promise<T>): Promise<T> => { const pending = queue.then(action); queue = pending.catch(() => {}); return pending; };
  async function verifiedIdentity(): Promise<Uint8Array> {
    if (serverSpki) return serverSpki;
    if (pendingIdentity) return pendingIdentity;
    pendingIdentity = (async () => {
      const value = parseLimited(await timeout(transport.get(base + "/jewelry-identity"), duration), 8192) as { version?: unknown; publicKey?: unknown };
      if (!value || value.version !== 1 || typeof value.publicKey !== "string") return fail(403, "主机公开身份无效");
      const spki = decodeBase64url(value.publicKey);
      if (identityPin(spki) !== code) fail(403, "连接码与主机身份不一致，请重新核对连接码");
      serverSpki = spki; return spki;
    })().finally(() => { pendingIdentity = null; });
    return pendingIdentity;
  }
  async function send(op: "request" | "image", input: MobileRequest | string, actorToken: string | null, requestDuration = duration, allowClosed = false): Promise<Decoded> {
    if (closed && !allowClosed) fail(503, "手机连接已关闭");
    const identity = await verifiedIdentity();
    if (closed && !allowClosed) fail(503, "手机连接已关闭");
    secureRandom(1); // Fail closed on platforms without a secure RNG.
    const secretKey = x25519.utils.randomSecretKey();
    let key: Uint8Array | undefined;
    try {
      const ephemeral = spkiFromRaw(x25519.getPublicKey(secretKey)), derived = deriveMobileKey(secretKey, identity, ephemeral);
      key = derived.key; derived.sharedSecret.fill(0); secretKey.fill(0);
      const packet = { id: mobileRequestUuid(), timestamp: Date.now(), token: actorToken, op, ...(op === "image" ? { imageId: input } : { input }) };
      let plaintext: string;
      try { plaintext = JSON.stringify(packet); } catch { return fail(400, "请求内容须为有效JSON数据"); }
      if (encoder.encode(plaintext).length > Math.floor(MAX_WIRE_BYTES * 3 / 4) - 1024) fail(413, "局域网内容超过64MB，请减少图片");
      const body = JSON.stringify(encryptMobileEnvelope(key, plaintext, "request", secureRandom(12), encodeBase64url(ephemeral)));
      if (encoder.encode(body).length > MAX_WIRE_BYTES) fail(413, "局域网内容超过64MB，请减少图片");
      const raw = parseLimited(await timeout(transport.post(base + "/jewelry-lan", body), requestDuration)) as MobileEnvelope;
      let decoded: Decoded;
      try { decoded = JSON.parse(decryptMobileEnvelope(key, raw, "response")) as Decoded; }
      catch { return fail(403, "主机响应验证失败，请核对连接码及主机身份"); }
      if (!decoded || decoded.requestId !== packet.id || !decoded.result || typeof decoded.result.ok !== "boolean" || !Number.isInteger(decoded.result.status) || decoded.result.status < 100 || decoded.result.status > 599 || "token" in decoded && decoded.token !== null && typeof decoded.token !== "string") fail(403, "主机响应与本次请求不匹配");
      return decoded;
    } finally { secretKey.fill(0); key?.fill(0); }
  }
  async function perform(op: "request" | "image", input: MobileRequest | string, expected: number): Promise<Decoded> {
    if (closed || expected !== revision) return { requestId: "", result: badReply(401, "登录请求已取消，请重新登录") };
    try {
      const previousToken = token;
      if (op === "request" && (input as MobileRequest).path.split("?")[0] === "/auth/login") token = null;
      const result = await send(op, input, previousToken);
      if (closed || expected !== revision) return { requestId: "", result: badReply(401, "登录请求已取消，请重新登录") };
      connected = true;
      if ("token" in result) token = result.token ?? null;
      if (result.result.status === 401 || op === "request" && (input as MobileRequest).path.split("?")[0] === "/auth/login" && !result.result.ok) token = null;
      return result;
    } catch (error) {
      connected = false;
      if (error instanceof MobileLanError) { if (error.status === 403) token = null; return { requestId: "", result: badReply(error.status, error.message) }; }
      return { requestId: "", result: badReply(503, "无法连接店内主机，请确认主机程序已打开且手机连接同一局域网") };
    }
  }
  async function bestEffortLogout(oldToken: string | null, allowClosed = false): Promise<MobileReply> {
    if (oldToken && serverSpki) { try { await send("request", { path: "/auth/logout", method: "POST" }, oldToken, 1000, allowClosed); } catch { /* Local credentials are already cleared. */ } }
    return { ok: true, status: 200, data: { needsSetup: false, authenticated: false } };
  }
  function logout(): Promise<MobileReply> {
    const oldToken = token; token = null; revision++; connected = false;
    return enqueue(() => bestEffortLogout(oldToken));
  }
  return {
    get connected() { return connected && !closed; },
    dispatch(input: MobileRequest): Promise<MobileReply> {
      let request: MobileRequest;
      try { request = canonicalMobileRequest(input); } catch (error) { return Promise.resolve(badReply(error instanceof MobileLanError ? error.status : 400, error instanceof Error ? error.message : "请求无效")); }
      if (request.path.split("?")[0] === "/auth/logout" && request.method === "POST") return logout();
      const expected = revision;
      return enqueue(async () => (await perform("request", request, expected)).result);
    },
    imageResponse(id: string): Promise<Response> {
      const expected = revision;
      return enqueue(async () => {
        if (typeof id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) return jsonResponse({ error: "图片编号无效" }, 404);
        const decoded = await perform("image", id, expected);
        try {
          if (decoded.image) {
            const bytes = decodeBase64(decoded.image.bytes), contentType = decoded.image.headers?.["content-type"] || "application/octet-stream";
            return new Response(new Uint8Array(bytes).buffer, { status: decoded.result.status, headers: { "Content-Type": contentType, "Cache-Control": "private, no-store" } });
          }
        } catch { return jsonResponse({ error: "主机图片响应无效" }, 403); }
        return jsonResponse(decoded.result.data || { error: "图片暂时不可读取" }, decoded.result.status);
      });
    },
    logout,
    async close(): Promise<void> {
      if (closed) return;
      const oldToken = token; closed = true; token = null; revision++; connected = false;
      await bestEffortLogout(oldToken, true); serverSpki = null;
    },
  };
}
