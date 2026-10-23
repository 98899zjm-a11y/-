import type { AppInfo, EmployeeUpdateState, LoginMemory, ModuleId, ModuleStatus, NativeResult } from './bridge';

type JsonReply = { ok: boolean; status: number; data: unknown };
type BrowserNavigator = { share?: (data: ShareData) => Promise<void>; canShare?: (data: ShareData) => boolean; clipboard?: Pick<Clipboard, 'write'>; userActivation?: { isActive: boolean } };
type BrowserOptions = {
  target?: { jewelryDesktop?: unknown };
  fetch?: typeof fetch;
  location?: { origin: string; href?: string; assign: (url: string) => void };
  storage?: Pick<Storage, 'getItem'|'setItem'|'removeItem'>;
  navigator?: BrowserNavigator;
  isSecureContext?: boolean;
  gesture?: () => boolean;
  ClipboardItem?: typeof ClipboardItem;
  File?: typeof File;
  Blob?: typeof Blob;
  download?: (blob: Blob, name: string) => Promise<boolean>;
};
const MAX_BYTES = 32 * 1024 * 1024;
const USERNAME_KEY = 'xjy-browser-username-v1';
const CSRF = /^[a-f0-9]{64}$/;
const usernameValid = (value: unknown): value is string => typeof value === 'string' && /^[\p{L}\p{N}._-]{2,48}$/u.test(value);
const deny = (error: string): NativeResult => ({ ok: false, error });
const plain = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const knownKeys = (value: unknown, keys: string[]): value is Record<string, unknown> => plain(value) && Object.keys(value).every(key => keys.includes(key));

// No private API, attachment or login session is cached offline. There is no
// service worker and no renderer-chosen remote host, Windows path or process.
export function installBrowserBridge(options: BrowserOptions = {}) {
  const target = options.target || window;
  if (target.jewelryDesktop && (target.jewelryDesktop as { surface?: string }).surface !== 'browser') throw new Error('不能覆盖电脑程序的本机连接。');
  const location = options.location || window.location, browserFetch = options.fetch || window.fetch.bind(window);
  const nav = options.navigator || window.navigator, storage = options.storage || window.localStorage;
  const secure = options.isSecureContext ?? window.isSecureContext;
  const FileType = options.File || File, BlobType = options.Blob || Blob;
  const ClipboardType = options.ClipboardItem || (typeof ClipboardItem !== 'undefined' ? ClipboardItem : undefined);
  const originUrl = new URL(location.origin), origin = originUrl.origin;
  if (!['http:', 'https:'].includes(originUrl.protocol) || origin !== location.origin || originUrl.username || originUrl.password || originUrl.pathname !== '/' || originUrl.search || originUrl.hash) throw new Error('手机页面的连接地址不正确。');
  let csrf = '', sessionEpoch = 0, pendingSession: Promise<Record<string, unknown>>|null = null;
  let writeQueue: Promise<unknown> = Promise.resolve();
  const destroySession = () => { csrf = ''; pendingSession = null; sessionEpoch++; };
  const hasGesture = () => options.gesture ? options.gesture() : nav.userActivation ? nav.userActivation.isActive : true;
  const phoneOnly = () => deny('此操作请由管理员在公司电脑主机完成，手机不能更改主机资料或安装 Windows 程序。');
  const fetchOptions = (method = 'GET'): RequestInit => ({ method, credentials: 'same-origin', cache: 'no-store', redirect: 'error', referrerPolicy: 'same-origin' });

  async function boundedBytes(response: Response): Promise<Uint8Array<ArrayBuffer>> {
    const declared = response.headers.get('content-length');
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BYTES)) throw new Error('主机返回内容过大，请缩小查询范围。');
    if (!response.body?.getReader) throw new Error('当前浏览器无法安全读取数据，请升级浏览器后重试。');
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let total = 0;
    try {
      while (true) { const part = await reader.read(); if (part.done) break; total += part.value.byteLength; if (total > MAX_BYTES) { await reader.cancel(); throw new Error('主机返回内容过大，请缩小查询范围。'); } chunks.push(part.value); }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } return bytes;
  }
  async function readJson(response: Response) {
    if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new Error('主机未返回业务数据，请检查登录和连接。');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await boundedBytes(response))) as unknown;
  }
  async function getAppInfo(): Promise<AppInfo> {
    const response = await browserFetch(origin + '/app-info', fetchOptions());
    const info = await readJson(response);
    if (!response.ok || !knownKeys(info, ['appVersion']) || typeof info.appVersion !== 'string' || info.appVersion.length > 64 || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(info.appVersion) || !info.appVersion.split('.').every(part => Number.isSafeInteger(Number(part)))) throw new Error('版本信息暂不可用。');
    return { appVersion: info.appVersion };
  }
  async function session(): Promise<Record<string, unknown>> {
    if (pendingSession) return pendingSession;
    const epoch = sessionEpoch;
    const pending = (async () => {
      const response = await browserFetch(origin + '/session', fetchOptions());
      const data = await readJson(response);
      if (!response.ok || !plain(data) || typeof data.csrf !== 'string' || !CSRF.test(data.csrf)) throw new Error('主机会话验证失败，请重新登录。');
      if (epoch !== sessionEpoch) throw new Error('登录状态已改变，请重新登录。');
      csrf = data.csrf; return data;
    })();
    pendingSession = pending;
    try { return await pending; } finally { if (pendingSession === pending) pendingSession = null; }
  }
  function validatePath(value: unknown) {
    if (typeof value !== 'string' || value.length > 4096 || !value.startsWith('/') || value.startsWith('//') || /[\\\x00-\x20]/.test(value) || value.includes('#')) throw new Error('只能访问当前工作室的业务页面。');
    const rawPath = value.split('?')[0], url = new URL(value, origin);
    if (url.origin !== origin || url.pathname !== rawPath || rawPath.includes('%') || rawPath.split('/').some(segment => segment === '.' || segment === '..') || !/^\/(api|auth)(\/|$)/.test(rawPath)) throw new Error('业务请求地址不正确。');
    if (rawPath === '/auth/setup' || /^\/api\/(local|windows|native|employee-update|desktop-update|connection|backup|restore)(\/|$)/.test(rawPath) || /^\/api\/internal-modules\/(configure|create)(\/|$)/.test(rawPath)) throw new Error('此操作只能在公司电脑主机完成。');
    return { path: rawPath, url: url.href };
  }
  async function execute(input: { path: string; method?: string; body?: unknown }): Promise<JsonReply> {
    // Capture before every await, including the outer session() continuation.
    const epoch = sessionEpoch;
    let logoutRequested = false, loginSent = false, loginCompleted = false;
    try {
      if (!knownKeys(input, ['path', 'method', 'body'])) throw new Error('业务请求包含不支持的参数。');
      const destination = validatePath(input.path), method = input.method || 'GET';
      if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(method) || (method === 'GET' && input.body !== undefined)) throw new Error('业务请求方式不正确。');
      if ((['/auth/login', '/auth/logout'].includes(destination.path) && method !== 'POST') || (destination.path === '/auth/status' && method !== 'GET')) throw new Error('登录请求方式不正确。');
      if (['/auth/login', '/auth/logout'].includes(destination.path) && input.path !== destination.path) throw new Error('登录或退出须使用规范地址。');
      logoutRequested = destination.path === '/auth/logout';
      if (destination.path === '/auth/status' && method === 'GET') {
        const data = await session();
        if (epoch !== sessionEpoch) return { ok: false, status: 401, data: { error: '登录状态已改变，请重新登录。' } };
        if (data.needsSetup === true) return { ok: false, status: 503, data: { error: '请先由管理员在公司电脑主机建立员工账号。手机不能创建工作室。' } };
        const { csrf: _token, ...status } = data; return { ok: true, status: 200, data: status };
      }
      if (!csrf) await session();
      if (epoch !== sessionEpoch) return { ok: false, status: 401, data: { error: '登录状态已改变，请重新登录。' } };
      const token = csrf, init = fetchOptions(method);
      if (method !== 'GET') {
        const body = JSON.stringify(input.body ?? {});
        if (new TextEncoder().encode(body).byteLength > MAX_BYTES) throw new Error('本次上传过大，请分批处理。');
        init.headers = { 'content-type': 'application/json', 'x-xjy-csrf': token }; init.body = body;
      }
      loginSent = destination.path === '/auth/login';
      const response = await browserFetch(destination.url, init), result = await readJson(response);
      if (epoch !== sessionEpoch) return { ok: false, status: 401, data: { error: '登录状态已改变，请重新登录。' } };
      if (!logoutRequested && destination.path === '/auth/login' && response.ok) {
        if (plain(result) && typeof result.csrf === 'string' && CSRF.test(result.csrf) && result.csrf !== token) { csrf = result.csrf; pendingSession = null; sessionEpoch++; loginCompleted = true; }
        else {
          destroySession(); const refreshedEpoch = sessionEpoch, refreshed = await session();
          if (refreshedEpoch !== sessionEpoch || csrf === token || refreshed.authenticated !== true) { if (refreshedEpoch === sessionEpoch) destroySession(); throw new Error('主机未完成登录会话更新，请重新登录。'); }
          loginCompleted = true;
        }
      } else if (!logoutRequested && (response.status === 401 || response.status === 403)) destroySession();
      const data = plain(result) ? Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'csrf')) : result;
      return { ok: response.ok, status: response.status, data };
    } catch (error) { return { ok: false, status: 400, data: { error: error instanceof Error ? error.message : '连接主机失败，请检查网络后重试。' } }; }
    finally {
      // A sent relogin may have revoked its previous server identity even when
      // the response is 400/429/500, lost, or cannot be parsed. Retry via the
      // bootstrap instead of keeping the old authority's CSRF. An older
      // continuation must not clear a newer epoch established elsewhere.
      if (logoutRequested || loginSent && !loginCompleted && epoch === sessionEpoch) destroySession();
    }
  }
  function request(input: { path: string; method?: string; body?: unknown }) {
    if ((input?.method || 'GET') === 'GET') return execute(input);
    const pending = writeQueue.then(() => execute(input)); writeQueue = pending.then(() => undefined, () => undefined); return pending;
  }
  function filename(value: unknown, extension = 'png') {
    let name = typeof value === 'string' ? value.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^[. ]+|[. ]+$/g, '').slice(0, 120) : '';
    if (!name) name = '鑫金源报价'; if (!name.toLowerCase().endsWith('.' + extension)) name += '.' + extension; return name;
  }
  async function image(input: { src: string; name: string }): Promise<Blob> {
    if (!knownKeys(input, ['src', 'name']) || typeof input.src !== 'string') throw new Error('图片参数不正确。');
    let blob: Blob;
    const data = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(input.src);
    if (data) {
      if (data[2].length > Math.ceil(MAX_BYTES / 3) * 4) throw new Error('图片过大，请减小尺寸后重试。');
      const decoded = atob(data[2]), bytes = new Uint8Array(decoded.length); for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
      blob = new BlobType([bytes], { type: 'image/' + data[1] });
    } else {
      const url = new URL(input.src, origin);
      if (url.origin !== origin || !/^\/api\/images\/[a-f0-9-]{36}$/.test(url.pathname) || url.search || url.hash || url.username || url.password) throw new Error('只能保存当前工作室的图片或已生成报价图片。');
      const response = await browserFetch(url.href, fetchOptions());
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? '图片未获准访问，请重新登录或联系管理员。' : '主机图片未能读取。');
      const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(type)) throw new Error('此文件不是可保存的图片。');
      blob = new BlobType([await boundedBytes(response)], { type });
    }
    if (blob.size < 8 || blob.size > MAX_BYTES) throw new Error('图片为空或超出允许大小。');
    const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer()), ascii = String.fromCharCode(...head);
    const valid = blob.type === 'image/png' ? [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => head[index] === byte) : blob.type === 'image/jpeg' ? head[0] === 255 && head[1] === 216 && head[2] === 255 : blob.type === 'image/gif' ? ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a') : ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP';
    if (!valid) throw new Error('图片内容与文件类型不一致。'); return blob;
  }
  async function downloadBlob(blob: Blob, name: string) {
    if (options.download) return options.download(blob, name);
    const href = URL.createObjectURL(blob), link = document.createElement('a'); link.href = href; link.download = name; link.rel = 'noopener';
    try { document.body.appendChild(link); link.click(); return true; } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(href), 60000); }
  }
  async function saveImage(input: { src: string; name: string }) {
    try { const blob = await image(input), name = filename(input.name, blob.type === 'image/jpeg' ? 'jpg' : blob.type.split('/')[1]); if (!await downloadBlob(blob, name)) return deny('浏览器未接收下载，请重试。'); return { ok: true, downloadStarted: true, message: '已发起图片下载，请到浏览器下载或“文件”中确认。' }; }
    catch (error) { return deny(error instanceof Error ? error.message : '图片下载未完成。'); }
  }
  async function copyImage(input: { src: string; name: string }) {
    if (!secure) return deny('图片复制需要安全连接，请使用管理员提供的 HTTPS 地址，或先保存图片。');
    if (!hasGesture()) return deny('请点击复制按钮再操作，浏览器不允许自动复制图片。');
    if (!ClipboardType || !nav.clipboard?.write) return deny('当前浏览器不支持真实图片复制，请使用系统分享或保存图片。');
    const pending = image(input).then(blob => { if (blob.type !== 'image/png') throw new Error('此浏览器只能复制 PNG 图片，请使用系统分享或保存图片。'); return blob; });
    void pending.catch(() => {});
    try { const item = new ClipboardType({ 'image/png': pending }); await nav.clipboard.write([item]); await pending; return { ok: true, clipboard: true, message: '报价图片已复制，请切换到微信粘贴。' }; }
    catch { return deny('图片复制被浏览器拒绝，请再次点击，或使用系统分享、保存图片。'); }
  }
  async function shareImage(input: { src: string; name: string }): Promise<NativeResult> {
    if (!secure) return deny('系统分享需要安全连接，请使用 HTTPS 地址；也可先保存图片后从相册或文件发送。');
    if (!hasGesture()) return deny('请点击分享按钮后再操作，浏览器需要你的主动点击。');
    if (!nav.share || !nav.canShare) return copyImage(input);
    try {
      const blob = await image(input), file = new FileType([blob], filename(input.name, blob.type === 'image/jpeg' ? 'jpg' : blob.type.split('/')[1]), { type: blob.type });
      const payload = { files: [file] }; if (!nav.canShare(payload)) return copyImage(input);
      await nav.share(payload); return { ok: true, message: '系统分享已完成，请核对所选应用和接收人。' };
    } catch (error) { if (error instanceof Error && error.name === 'AbortError') return { ok: false, canceled: true }; return deny('系统分享未完成，请再次点击，或保存图片后发送。'); }
  }
  function rememberUsername(input: { username: string }) {
    if (!usernameValid(input.username)) return deny('用户名格式不正确。');
    try { storage.setItem(USERNAME_KEY, input.username); return { ok: true }; } catch { return deny('浏览器不允许记住用户名，可正常手动登录。'); }
  }
  const browserUpdate: EmployeeUpdateState = { phase: 'idle', currentVersion: '', message: '手机使用网页版本，刷新页面即可读取更新，不安装 Windows 程序。' };
  const bridge = {
    surface: 'browser' as const, request, destroySession,
    getAppInfo,
    getConnection: async () => ({ mode: 'client' as const, host: originUrl.hostname, port: Number(originUrl.port || (originUrl.protocol === 'https:' ? 443 : 80)), addresses: [], running: true, error: '', clientOnly: false }),
    setConnection: async () => phoneOnly(),
    getModuleStatus: async (): Promise<ModuleStatus> => { const result = await request({ path: '/api/internal-modules/status' }); if (!result.ok || !plain(result.data) || !Array.isArray(result.data.modules)) throw new Error('主机模块状态暂时无法读取。'); return { ...(result.data as ModuleStatus), hostMode: false }; },
    openModule: async (input: { id: ModuleId }) => { if (!knownKeys(input, ['id']) || !['ledger', 'inventory', 'cashier'].includes(input.id)) return deny('请选择财务、库管或出纳系统。'); location.assign('/modules/' + input.id + (input.id === 'cashier' ? '/cashier/' : '/')); return { ok: true }; },
    closeModule: async () => ({ ok: true }),
    configureModule: async () => phoneOnly(), createModuleData: async () => phoneOnly(),
    readLoginMemory: async (input?: { username?: string }): Promise<LoginMemory> => { let remembered = ''; try { remembered = storage.getItem(USERNAME_KEY) || ''; } catch {} const username = input?.username !== undefined ? input.username : remembered; return { ok: true, username: usernameValid(username) ? username : '', password: '', hasPassword: false, available: true, scopeKey: origin }; },
    rememberLoginUsername: async (input: { username: string }) => rememberUsername(input),
    rememberLogin: async (input: { username: string }) => rememberUsername(input),
    forgetLoginPassword: async () => ({ ok: true, message: '网页不保存密码，请在手机系统密码管理器中管理。' }),
    print: async () => { throw new Error('手机请使用报价页面的“主机打印”，不能直接调用 Windows 打印机。'); },
    saveImage, saveImageAs: saveImage, shareImage, copyImage,
    getImageSaveSettings: async () => ({ path: '由手机浏览器或系统“文件”选择，网页不读取你的本地目录', mobile: true }),
    chooseImageSaveFolder: async () => deny('手机由浏览器或系统“文件”管理保存位置，不能设置 Windows 文件夹。'),
    saveTextFile: async (input: { text: string; name: string; extension: 'csv'|'txt' }) => { try { if (!knownKeys(input, ['text', 'name', 'extension']) || typeof input.text !== 'string' || !['csv', 'txt'].includes(input.extension) || new TextEncoder().encode(input.text).length > MAX_BYTES) return deny('导出文件参数不正确或内容过大。'); const blob = new BlobType(['\ufeff', input.text], { type: input.extension === 'csv' ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8' }); if (!await downloadBlob(blob, filename(input.name, input.extension))) return deny('浏览器未接收下载。'); return { ok: true, message: '已发起文件下载，请到浏览器下载或“文件”中确认。' }; } catch { return deny('文件导出未完成，请重试。'); } },
    backup: async () => phoneOnly(), restore: async () => phoneOnly(), exportPdf: async () => deny('手机请使用主机打印或已生成的文件导出入口。'),
    getDataInfo: async () => ({ path: '公司主机资料，手机不直接访问数据库文件' }), getPrinters: async () => [],
    getPrintSettings: async () => { throw new Error('打印设置由公司主机管理员管理，手机请使用主机打印。'); },
    savePrintSettings: async () => phoneOnly(), printWarranty: async () => phoneOnly(), exportWarrantyPdf: async () => phoneOnly(), exportWarrantyDocx: async () => phoneOnly(),
    getEmployeeUpdateCapability: async () => ({ supported: true, canInstall: false, currentVersion: '', message: browserUpdate.message, code: 'BROWSER_ONLY' }),
    getEmployeeUpdateState: async () => ({ ...browserUpdate }), employeeUpdate: async () => ({ ok: false, state: { ...browserUpdate }, error: browserUpdate.message, code: 'BROWSER_ONLY' })
  };
  target.jewelryDesktop = Object.freeze(bridge); return bridge;
}
