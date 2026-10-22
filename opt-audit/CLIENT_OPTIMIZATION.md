# 鑫金源珠宝 1.7.0 · 客户端与数据层优化审计

- **审计对象**：`鑫金源珠宝` 1.7.0（Electron 44.7.0 + Node 24.21.0 + Chromium 152.0.7977.130，本地 SQLite，Windows 离线部署）
- **源码根**：`E:\codex\2026-10-15\work\xjy-v16-deep-audit\project\desktop\`
- **产物口径**：`F:\自制软件\xjy-jewelry-offline\resources\app.asar`（archive 13,495,963 B / payload 13,456,455 B / 149 文件 / unpacked 0）
- **方法**：全程只读。asar 未解包，索引与文件内容均在内存中按 header 偏移读取；未执行构建、未安装依赖、未写入任何被审计目录。所有体积为 asar 内实际字节数，gzip/规则重合度为本次实测（`zlib.gzipSync(level 9)`）。
- **不在本文范围**：引擎/签名链/升级包签名（由另一位审计者负责）。凡本文建议触及该链路的，均在「是否需重签」列显式标注。

> 口径校正（重要）：`project\desktop\` 下**没有** `app\` 子目录，也没有 `renderer-dist\`；用户描述的 `app/*.cjs` 即 desktop 根目录本身，`renderer-dist` 只在打包产物中。另外 `main.cjs` 在发布包里是**死代码**（见 §2.7），本报告的所有行号均以真实入口 `release-app.cjs` 为准。

---

## 0. 结论速览

**最值得先做的 3 项**

1. **重编码两张 PNG** —— 它们是 13.5MB 单包里的 **49.1%（6,606,079 B）**，且 gzip 压缩比 **1.000 / 0.948**（完全不可压缩），任何打包器都救不了；重编码后可让安装体积直接砍半，首屏不再等一张 4.15MB 的图。
2. **首屏拆分** —— 登录页现在要下载并解析 **1,865,723 B JS + 320,154 B CSS**，其中整个工作区（`workspace.tsx`，131KB 源码）与只在一个页面用的 `recharts` 都在首屏包里，且 **0 个动态 import**。把 Workspace 改成 `React.lazy` 即可让首屏少解析数百 KB。
3. **CSS 去重 + 缓存头分级** —— `print-BMWMhIsv.css` 有 **98.4%** 的规则与 `styles-0mKe94QZ.css` 逐字节重复（重复量 ≈ 207KB，占全部 CSS 的 39.6%）；同时 `release-app.cjs:98` 对所有静态资源发 `Cache-Control: no-store`，导致每次开窗都是冷启动。

**最值得引入的 3 个开源件**

| 开源件 | 用途 | license | 引入成本 |
|---|---|---|---|
| [`rollup-plugin-visualizer`](https://github.com/btd/rollup-plugin-visualizer) | 先量后改：拿到 1.54MB chunk 的真实构成（recharts/应用代码各占多少），否则分包是盲改 | MIT | 极低（1 个 devDependency + 2 行配置）|
| [`@electron/fuses`](https://github.com/electron/fuses) | 关掉 `runAsNode`、`EnableNodeCliInspectArguments`，打开 `OnlyLoadAppFromAsar` + asar 完整性校验，把"换 asar 就能改程序"这条路堵死 | MIT | 低（build 阶段 1 个脚本），**会改 exe → 需重签** |
| [`sharp`](https://github.com/lovell/sharp) | 图片流水线：PNG→WebP/AVIF + 尺寸裁剪，是上面第 1 项能落地的工具 | Apache-2.0 | 低（只做构建期资源处理，不进运行时）|

> 明确**不建议**引入：`better-sqlite3`（见 §3.7）、`electron-trpc`（见 §2.6）、`@squoosh/lib`（见 §4.5）。

---

## 1. 渲染层性能

### 1.1 体积账：一半的包是两张图

| 文件（asar 内） | 字节 | 占 payload | gzip 后 | 压缩比 |
|---|---:|---:|---:|---:|
| `renderer-dist/home-necklace.png` | 4,150,568 | 30.8% | 4,151,753 | **1.000** |
| `renderer-dist/quote-stationery-v2.png` | 2,455,511 | 18.2% | 2,327,847 | **0.948** |
| `renderer-dist/assets/main-7etXIfP0.js` | 1,542,620 | 11.5% | 433,844 | 0.281 |
| `renderer-dist/assets/styles-0mKe94QZ.css` | 208,103 | 1.5% | 33,950 | 0.163 |
| `renderer-dist/assets/print-BMWMhIsv.css` | 203,102 | 1.5% | 32,630 | 0.161 |
| `renderer-dist/assets/jsx-runtime-P_2-XgaS.js` | 190,275 | 1.4% | — | — |
| `renderer-dist/ring.jpg` | 138,515 | 1.0% | — | — |
| `renderer-dist/assets/warranty-document-CcBHseIj.js` | 117,905 | 0.9% | — | — |
| `renderer-dist/warranty-template.jpg` | 111,915 | 0.8% | — | — |
| `renderer-dist/assets/main-DJlJqWxN.css` | 87,233 | 0.6% | — | — |
| 其余 139 个文件 | 4,170,713 | 31.0% | — | — |

**结论一**：两张 PNG 合计 **6,606,079 B = 49.1%**。gzip 比 1.000/0.948 说明它们已经是"压过的随机数据"——`electron-builder` 的 `compression: "maximum"` 只压缩**安装器**（7z），`asar` 内部是**原样字节**，所以这 6.6MB 既压不小、也无法通过任何打包选项规避。唯一出路是重编码。

**结论二**：`generated/` 目录另有 3,037,190 B（其中 `print-worker-templates.cjs` 单文件 1,977,839 B，是内联 SVG/HTML 打印模板）。它属于主进程侧资源，压缩空间在"模板转资源文件 + 构建期 gzip"，不在本节范围，但值得让引擎侧注意。

**图像具体改法（可量化）**

| 文件 | 现状 | 使用位置 | 实际渲染尺寸 | 建议 | 预估体积 |
|---|---|---|---|---|---|
| `home-necklace.png` | 1536×2048 PNG，4,150,568 B（≈2.9 B/像素，照片存成 PNG） | `renderer/main.tsx:114` 登录页右侧 `<img>` | `.auth-image` 约 600×800 CSS px | 缩到 768×1024 + WebP q82（或 AVIF q60） | **80–140 KB（↓97%）** |
| `quote-stationery-v2.png` | 941×1672 PNG，2,455,511 B | `lib/quote-image.ts:33` `ctx.drawImage(stationery, 0, 0, 360, 640)`；`components/quote-paper.css:1` 背景 | **只被画到 360×640**（230K 像素） | 缩到 480×853（2× 余量）+ WebP q85 | **50–90 KB（↓97%）** |
| `ring.jpg` | 1536×1024 JPEG 138,515 B | 默认款式图，多处以缩略图出现 | 列表卡片 ~200px | mozjpeg q78 + 缩到 800×533 | 45–60 KB |
| `warranty-template.jpg` | 794×1123 JPEG 111,915 B | `renderer/warranty-document.tsx:112` 按 210×297mm 排版 | A4 满幅 | 保持尺寸，mozjpeg q80 | 70–90 KB |

> 关键发现：`quote-stationery-v2.png` 是 1.57M 像素的图，代码只用它的 **230K 像素**（360×640）——**6.8 倍冗余**。这一张就能降 2.4MB。

### 1.2 首屏阻塞链：窗口要等 6MB 才出现

`app.asar/renderer-dist/index.html:9-16` 一次性引入 **5 个 module script + 3 个 stylesheet**：

```
:9  modulepreload-polyfill-BxR_cmXS.js   698 B
:10 jsx-runtime-P_2-XgaS.js            190,275 B   ← react/react-dom
:11 styles-ylDQnXzN.js                  14,225 B
:12 warranty-document-CcBHseIj.js      117,905 B   ← 质保单渲染，登录页完全用不到
:13 main-7etXIfP0.js                 1,542,620 B   ← 整个应用（含 workspace + recharts）
:14 styles-0mKe94QZ.css                208,103 B
:15 warranty-document-vn5KZ9Gi.css      24,818 B   ← 同上，登录页用不到
:16 main-DJlJqWxN.css                   87,233 B
```

- 首屏 JS 合计 **1,865,723 B**，CSS 合计 **320,154 B**。
- 叠加登录图：**1,865,723 + 320,154 + 4,150,568 = 6,336,445 B（≈6.04 MiB）** 全部走完才到"用户看到登录框"。

窗口可见时机由三行决定：

```js
// desktop/release-app.cjs:329
window = new BrowserWindow({ ..., show: false, backgroundColor: '#f7f6f3', webPreferences: {...} });
// :344
await window.loadURL(localOrigin + '/home');
// :345
if (selfCheck) await diagnostics(); else { window.show(); ... }
```

`webContents.loadURL()` 的 Promise 在 `did-finish-load`（`load` 事件）后 resolve——**包含所有图片**。也就是说：**4.15MB 的登录图解码完，窗口才第一次出现**。在机械盘/杀毒扫描的办公机上，这段是 1–3 秒的"点了没反应"。

**改法（一天内，零风险）**

```js
// release-app.cjs:344-345 附近
window.once('ready-to-show', () => window.show());   // 首帧即可见，背景色已是 #f7f6f3
await window.loadURL(localOrigin + '/home');
if (selfCheck) await diagnostics();
```

配合 §1.1 的图片重编码，首屏可感知等待从秒级降到几百毫秒。

### 1.3 没有分包：1.54MB 单 chunk，0 个动态 import

实测 `main-7etXIfP0.js`：**94 行、最长单行 633,702 字符、`import(` 出现 0 次**（即没有任何代码分割点；`warranty-document` 那个 chunk 是入口共享块，不是懒加载）。

根因在 `desktop/renderer/main.tsx:4`：

```ts
import Workspace from "./workspace";   // 131,062 B 源码，静态导入 → 进首屏
```

而 `recharts` 全项目只有一处 import：

```ts
// desktop/renderer/personal-sales.tsx:3
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
```

`main` chunk 内 `recharts` 标识命中 **79 次**——它整个被拖进了首屏。`lucide-react` 只有 4 次命中（命名导入被 tree-shake 掉了，这块不用管）。

`desktop/vite.config.ts` 全文 30 行，**没有任何分包配置**：无 `manualChunks`/`advancedChunks`、无 `chunkSizeWarningLimit`、无 `build.target`、无 `assetsInlineLimit` 调整、无 visualizer。

**改法（按收益排序）**

1. **先量**：接 `rollup-plugin-visualizer`（MIT），拿到真实构成再改；rolldown-vite 兼容 rollup 插件生态，配置写在 `vite.config.ts` 的 `build.rolldownOptions.plugins`。
2. **懒加载工作区**：`main.tsx:4` 改 `const Workspace = lazy(() => import("./workspace"))` + `<Suspense>`。工作区（含 `recharts`、十万行级业务组件）移出登录路径。
3. **`recharts` 单独成块**：`personal-sales` 已经是独立页面组件，随第 2 步自然下沉；如需固定 vendor 块，用 rolldown 的 `output.advancedChunks`（等价于 rollup 的 `manualChunks`）。
4. **`build.target: 'chrome152'`**：Electron 44 = Chromium 152（见 §4 的版本核实），默认 target 会为更老的浏览器做降级转换，锁定 chrome152 可省掉无谓的语法降级产物。
5. **`warranty-document` 移出登录页**：它由 `warranty-document.tsx` 提供，登录页不需要；把它挂到打印/质保单入口后，`index.html` 少 117,905 B JS + 24,818 B CSS。

预估：首屏 JS 从 1,865,723 B 降到 **≈500–700 KB**（jsx-runtime 190KB + 应用首屏代码 + polyfill），解析时间按 Chromium 实测量级降 60–70%。**具体数值必须由 visualizer 实测确认**，本报告不编造。

### 1.4 CSS 重复 207KB（39.6%）

四个 CSS 的规则级逐字节比对（按 `}` 切分后做集合比较）：

| 关系 | 重复字节 | 占比 |
|---|---:|---:|
| `print-BMWMhIsv.css` ⊂ `styles-0mKe94QZ.css` | 197,682 / 200,894 | **98.4%** |
| `warranty-document-vn5KZ9Gi.css` ⊂ `styles-0mKe94QZ.css` | 9,599 / 24,563 | 39.1% |
| `warranty-document-vn5KZ9Gi.css` ⊂ `print-BMWMhIsv.css` | 12,070 / 24,563 | 49.1% |
| 全部 CSS 合计 | 523,252 B | 重复 ≈ **207,281 B（39.6%）** |

原因：Tailwind v4 在**每个入口**各生成一份工具类，多入口共享组件 → 同一批 utility 被写进 4 个文件。`@font-face` 0 个、远程 `url()` 0 个、`@media` 130 个——离线合规没问题（`renderer/resource-audit.mjs:27-32` 已对"禁远程 CSS/禁 @font-face/aspect-ratio:9/16/A4 @page"设了断言）。

**改法**：`vite.config.ts` 设 `build.cssCodeSplit: false` → 所有入口共用一个 CSS（Electron 本地加载，多请求成本可忽略）。预估 523,252 → **≈316 KB（−207KB）**，`index.html` 首屏 CSS 320,154 → ≈110 KB。

### 1.5 没有缓存：所有资源 `no-store`

```js
// desktop/release-app.cjs:98
const headers = { 'Content-Type': ..., 'Content-Security-Policy': csp,
                  'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };
```

`jewelry://` 自定义协议对 html/js/css/png **一律 `no-store`**。而构建产物已经是内容哈希命名（`main-7etXIfP0.js`）——这正是可以 `immutable` 的形态。

**改法（分级，零风险）**

```js
const immutable = /\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.(js|css)$/.test(pathname);
headers['Cache-Control'] = immutable ? 'public, max-age=31536000, immutable' : 'no-cache';
```

图片同理（`/home-necklace.png` 无哈希 → `no-cache` + ETag）。收益：二次开窗/刷新不再重读 13.5MB，主进程同步读盘次数下降。

### 1.6 无维护的 polyfill / deprecated API 盘点（结论：很干净）

对 1.54MB chunk 做模式扫描，结果如下（这些是常见"僵尸代码"）：

| 检查项 | 命中 | 判断 |
|---|---:|---|
| `react-dom.development` / `Warning: React` | 0 / 0 | 生产构建，无 dev 版 React |
| `core-js` | 0 | 无 core-js polyfill |
| `regeneratorRuntime` | 0 | 无 async 降级产物 |
| `process.env.NODE_ENV` 残留 | 0 | 已静态替换 |
| `moment` / `lodash` / `axios` / `date-fns` | 0 / 0 / 0 / 0 | 无历史包袱 |
| `sourceMappingURL` | 0 | 无 sourcemap（体积友好，但线上排障无映射）|
| `ReactDOM.render`（已废弃） | 0 | 已用 `createRoot`（命中 3）|
| `Object.hasOwn` / `structuredClone` / `.at()` | 8 / 6 / 2 | 现代 API，Chromium 152 原生支持 |
| `modulepreload-polyfill` | 698 B 独立文件 | **唯一可删的 polyfill**：Chromium 152 原生支持 `modulepreload`，该 shim 是 Vite 为旧浏览器的兜底 |

两个"技术上过时但不是体积问题"的点：

1. **`modulepreload-polyfill`（698 B）** 可以安全移除：`vite.config.ts` 加 `build.modulePreload: { polyfill: false }`。收益只有 698 B + 一个请求，价值在"少一个没人维护的兼容层"。
2. **`node:sqlite` 的 `DatabaseSync` 已是过渡别名**：Node 官方文档现称 `DatabaseSync` 为 `Database` 的 deprecated alias（[nodejs.org/api/sqlite.html](https://nodejs.org/api/sqlite.html)，v25.7 文档口径）。本项目在 `runtime.cjs:6/126`、`backup.cjs:6`、`business-backups.cjs:2`、`business-restore.cjs:3`、`legacy-modules.cjs:9` 都用的 `DatabaseSync`。**不要立刻改名**——Electron 44 的 Node 24.21 是否已导出 `Database` 尚未核实，改名有启动即崩的风险；知道它是过渡名即可，等升到确认导出的版本再动。

### 1.7 渲染层还有两处"主线程同步 IO"（性能，非安全）

`jewelry://` 协议处理器运行在主进程事件循环：

```js
// desktop/release-app.cjs:99  —— 每个静态文件一次同步读
return new Response(request.method === 'HEAD' ? null : fs.readFileSync(file), { headers });
```

```js
// desktop/runtime.cjs:89  —— 每张图片一次同步读（上限 45MB）
const buffer = fs.readFileSync(this.filename(key));
```

`fs.readFileSync` 会**阻塞主进程**：读 4.15MB 登录图、读 20MB 报价图时，同一时刻的 IPC、托盘、定时器、窗口消息全部排队。改 `await fs.promises.readFile(...)`（或 `Readable.toWeb(createReadStream(...))`）即可，改动量 <10 行，行为不变。

---

## 2. 主进程与 IPC

### 2.1 安全基线：比常见 Electron 应用好，先给正面结论

`desktop/release-app.cjs:329`：

```js
webPreferences: { preload: path.join(__dirname,'preload.cjs'), contextIsolation: true,
                  nodeIntegration: false, sandbox: true, spellcheck: false,
                  devTools: !app.isPackaged }
```

逐项对照 [Electron 官方 security 清单](https://www.electronjs.org/docs/latest/tutorial/security)：

| 检查项 | 实现 | 位置 | 评价 |
|---|---|---|---|
| `contextIsolation: true` | ✅ | `release-app.cjs:329` | 达标 |
| `sandbox: true` | ✅ | `release-app.cjs:329`（`release-entry.cjs:26` 也算了一个值，但这里硬编码 true） | 达标 |
| `nodeIntegration: false` | ✅ | 同上 | 达标 |
| `devTools` 生产关闭 | ✅ | `:329` `!app.isPackaged` | 达标 |
| CSP | ✅ 强策略 | `:44` `default-src 'self'; script-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'` | 达标（`style-src 'unsafe-inline'` 是 Tailwind 需要，可接受）|
| 权限全拒 | ✅ | `:320-321` `setPermissionRequestHandler(()=>callback(false))` + `setPermissionCheckHandler(()=>false)` | 达标 |
| 出站请求白名单 | ✅ 强制 | `:322-326` `onBeforeRequest` → `callback({cancel: !allowed})`，只放行 `jewelry://app` + `data:`/`blob:`/`devtools:` | **达标且是硬拦截**（不只是 selfCheck 记录）|
| 新窗口/导航 | ✅ | `:332` `setWindowOpenHandler(()=>({action:'deny'}))`、`:333/:334` `will-navigate`/`will-redirect`、`:335` `will-attach-webview` preventDefault | 达标 |
| 发送方校验 | ⚠️ 有但漏 2 处 | `:52-54` 校验 `sender` + `senderFrame === mainFrame` + `trustedUrl(senderFrame.url)`，**很严格** | 见 §2.3 |

> 注意 `:324` `if (!allowed && selfCheck) blockedNetwork.push(details.url)` —— 记录只在 selfCheck 生效，但**拦截始终生效**（`:325`）。这一点比早期审计记录更准确。

### 2.2 `jewelry:request` 通用代理：一个通道承载整个 `/api/**`

```js
// desktop/release-app.cjs:132-145
ipcMain.handle('jewelry:request', (event, input) => {
  trustedSender(event);
  if (closing) return { ok:false, status:503, data:{ error:'程序正在正常关闭' } };
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      typeof input.path !== 'string' || !/^\/(api|auth)\//.test(input.path))
    return { ok:false, status:400, data:{ error:'本机请求无效' } };
  return businessRequest(()=>exclusive(async () => {
    const pathname = new URL(input.path, 'http://offline.invalid').pathname,
          method = String(input.method || 'GET').toUpperCase();
    ...
    const result = await network.request(input);   // ← 原样透传
    ...
  }));
});
```

判断（与"逐操作授权"的关系要说清楚）：

1. **它不是"绕过逐操作授权"**——授权确实存在，但**全部下沉到了业务层**（`lib/server.ts` → `generated/business.cjs`）。主进程这一层只能看到"一个 `/api/...` 路径"，无法表达"这个操作需要什么角色"。
2. **真正的缺口是粒度与契约**：`preload.cjs:23` 把这个通道直接暴露成 `request(input)`，等于把整个 `/api/**` 表面交给渲染层；主进程没有 `(method, path) → 所需权限` 的映射表。
3. **路径校验/记账/分发三者不一致**（`:135` vs `:137` vs `:140`）：校验用**原始串**正则、记账用 `new URL()` 规范化后的 `pathname`、实际分发又用**原始 `input`**。`/api/../auth/login` 能通过 `:135` 的前缀检查、在 `:137` 被识别成 `/auth/login` 参与登录埋点、在 `:140` 又以原始串发给后端。当前后端是进程内路由器，**未构成本地越权**，但这是一处"三处各说各话"的隐患，运维排查时会误导人。
4. **没有参数形状校验**：`input.body` / `input.headers` 原样透传，zod 只用在 `lib/domain.ts` 的领域模型（如 `homeImageSchema`），不在 IPC 边界。

**改法（按性价比）**

- **立刻（10 行）**：`release-app.cjs:137` 规范化后，把 `input` 的 `path` 覆写为 `pathname` 再分发，让校验=记账=分发三处同源。
- **短期（半天）**：在 `release-app.cjs` 加一张显式表 `const ROUTE_POLICY = { 'GET /api/bootstrap': null, 'POST /api/styles': 'manage', ... }`，未列出的路径直接 `400`。这张表就是"逐操作授权"在主进程侧的落地形式，不需要重写业务层。
- **中期**：共享 zod schema 做 IPC 入参校验（见 §4.6 的 `zod`），错误在边界暴露而不是打穿到业务层。

### 2.3 漏 `trustedSender` 的两处（已校正为活文件行号）

早期审计（`FULL_AUDIT.md` P1-4）记的是 `main.cjs:161/162`——那两行在发布包里是**死代码**（§2.7）。真实位置：

```js
// desktop/release-app.cjs:169
ipcMain.handle('jewelry:module-print', async (event, input) => {
  try { return await moduleViews.print(event.sender, event.senderFrame, input); }
  catch (error) { return { ok:false, error: error.message || '模块打印未完成' }; }
});
// desktop/release-app.cjs:170
ipcMain.handle('jewelry:module-workspace-request', async (event, input) => {
  try { return await moduleViews.workspaceRequest(event.sender, event.senderFrame, input); }
  catch (error) { return { ok:false, status:403, data:{ error: error.message || '模块协作请求未完成' } }; }
});
```

对比同文件里所有其他注册点的统一形态 `nativeHandler`（`release-app.cjs:68-74`，第一件事就是 `trustedSender(event)`），这两个是**手工裸写**的，因此漏掉了：

- 发送方校验（尽管 `moduleViews.print/workspaceRequest` 内部还会按 `senderFrame` 反查视图，属"下游兜底"，不是"边界校验"）；
- `closing` 关闭期保护；
- 统一的 `businessRequest`（`hostRuntime.withRequest`）调用包装。

**严重度**：中（纵深防御缺口，不是可直接利用的越权）。CSP 已是 `script-src 'self'` + `frame-src 'none'`，渲染层没有可注入的远程代码面；但"任何渲染层异常都不得绕过边界校验"这条原则不应有例外。

**改法**：把这两处改成 `nativeHandler('jewelry:module-print', input => moduleViews.print(window.webContents, window.webContents.mainFrame, input))`，或者最省事：在裸 `ipcMain.handle` 的第一行补 `trustedSender(event)`。

> 另有一个语义差：`main.cjs:161` 的死代码版本还**丢掉了 `input` 参数**（只传了 2 个参数给 `moduleViews.print`），活版本 `:169` 传了 3 个。两份实现已经漂移，这也是"双主进程副本"的危害实证（§2.7）。

### 2.4 通道规模与命名

实测（`release-app.cjs` 全文抽取，含 `nativeHandler` 与裸 `ipcMain.*` 两种写法）：

- **41 个唯一通道，41 个注册点**：34 个经 `nativeHandler`、6 个裸 `ipcMain.handle`（`:132` `jewelry:request`、`:169` `module-print`、`:170` `module-workspace-request`、`:183` `app-info`、`:188` `get-print-settings`、`:207` `print`）、1 个 `ipcMain.on`（`:151` `module-activity`，单向）。
- **命名 100% 使用 `jewelry:` 前缀 + kebab-case**，这一点很规范，无 `send`/`invoke` 混用、无驼峰蛇形混排。
- 但有 **3 处动宾顺序不一致**（同一语义两种写法）：`jewelry:get-print-settings`（动词在前）vs `jewelry:host-print-routing-save`（动词在后）；`jewelry:get-modules` vs `jewelry:module-activity-info`。
- `preload.cjs:8-46` 暴露 **38 个**方法（`Object.freeze`）。差集 = `module-print`、`module-workspace-request`、`module-activity` 三个通道**不经主窗口 preload**，由模块页的 `module-preload.cjs` 使用——合理。**已双向核对：无"暴露但未注册"的孤儿通道**。
- `preload.cjs:30` `print: () => invoke('jewelry:print')` 与 `:38` `printWarranty` 指向的处理器已改为 `require('./native-print-policy.cjs').rejectLegacyNativePrint()`（`release-app.cjs:195`、`:208`）——**这两个 API 现在调用必抛**，属于残留表面，建议从 preload 删除（减少攻击面和误用）。

**对照最佳实践**：41 个通道对一个多模块 ERP 桌面端属正常量级；问题不在数量，在 `jewelry:request` 这一个通道内部承载了多少语义（§2.2）。

### 2.5 错误处理与日志：生产环境没有日志落盘

这是本节最值得改的一条。

```js
// desktop/release-app.cjs:48-49
const blockedNetwork = [];
const rendererErrors = [];
// :336
window.webContents.on('console-message', (_event, details) => { if (selfCheck && details.level === 'error') rendererErrors.push(details.message); });
// :300-301
const ok = Boolean(... && !rendererErrors.length && !blockedNetwork.length);
fs.writeFileSync(path.join(output, 'startup-check.json'), JSON.stringify({ ..., rendererErrors, blockedNetwork }, null, 2));
```

实测结论：

| 能力 | 现状 |
|---|---|
| 渲染层错误落盘 | **仅 selfCheck 模式**（`XJY_SELF_CHECK_OUTPUT`）；正式运行时不写入任何文件，数组仅在内存里增长 |
| 主进程未捕获异常 | **无** `process.on('uncaughtException')` / `unhandledRejection`；全局兜底只有 `:346` 的 `app.whenReady().then(...).catch()`（只覆盖启动期）|
| 主窗口渲染进程崩溃 | **无** `render-process-gone` / `unresponsive` / `preload-error` 监听（只有打印窗口有：`print-worker-renderer.cjs:42`）→ 白屏且无提示、无自恢复 |
| 启动失败 | `:346` 走 `dialog.showErrorBox`，**不落盘**（selfCheck 时写 `startup-error.txt`）|
| 已有日志基建 | 有，但只服务备份/维护：`business-maintenance.cjs:14`、`business-daily-backup.cjs:127`、`business-restore.cjs:98/105`、`web-runtime/web-gateway.cjs:1468` 都在写 `layout.logDir` |

**改法（半天，纯增量）**

```js
// 建议插在 release-app.cjs:307 之前
const logFile = path.join(storage.profileDir, '日志', `app-${new Date().toISOString().slice(0,10)}.jsonl`);
const log = (level, msg, extra) => { try { fs.appendFileSync(logFile, JSON.stringify({ t:new Date().toISOString(), level, msg, ...extra })+'\n'); } catch {} };
process.on('uncaughtException', e => log('fatal', String(e.stack||e)));
process.on('unhandledRejection', e => log('fatal', String(e?.stack||e)));
// 与 :336 平级新增
window.webContents.on('render-process-gone', (_e, d) => { log('crash', d.reason, d); });
window.webContents.on('preload-error', (_e, p, err) => log('preload', String(err?.stack||err), { p }));
window.webContents.on('unresponsive', () => log('hang', 'renderer unresponsive'));
window.webContents.on('console-message', (_e, d) => { if (d.level === 'error') log('renderer', d.message); });  // 去掉 selfCheck 门槛
```

并给 `app.log` 类需求加**滚动 + 上限**（按天分文件、保留 30 天、单文件 >5MB 截断）。若想直接引库，[`electron-log`](https://github.com/megalojack/electron-log)（MIT，v5.4.4）已内置主/渲染进程统一入口与文件滚动，纯本地、无联网行为，符合离线红线。

> 附带一处小泄漏：`nativeHandler` 的 `catch` 把 `error.message` 原样回给渲染层（`:72`）。本地单机应用可接受，但 `dialog.showErrorBox('程序未能打开', error.message + ...)`（`:346`）会把内部错误文本展示给最终用户。

### 2.6 Electron fuses：没配，等于留着"换 asar 就换程序"

`desktop/package.json` 的 `build` 段有 `asar: true`、`win.target=[portable, nsis]`、`signExecutable: false`，**没有 `electronFuses` 配置**。这意味着打包后的 exe 仍保持 Electron 默认 fuse 状态，其中危险项：

| fuse | 默认 | 风险 |
|---|---|---|
| `RunAsNode` | **enabled** | 设 `ELECTRON_RUN_AS_NODE=1` 就能把 `鑫金源珠宝报价.exe` 当 node 解释器用，绕过应用逻辑执行任意脚本 |
| `EnableNodeCliInspectArguments` | **enabled** | 可挂调试器注入 |
| `OnlyLoadAppFromAsar` | **disabled** | 可在 `resources/` 放一个 `app/` 目录顶替 asar |
| `EnableEmbeddedAsarIntegrityValidation` | **disabled** | asar 内容可被替换后继续运行 |

对本项目尤其要紧：程序里有 `signExecutable: false`（无 Authenticode），一旦 asar 可替换，任何拿到写权限的人都能改业务代码而系统层面毫无痕迹。

**改法**：用 [`@electron/fuses`](https://github.com/electron/fuses)（MIT，v2.1.3）在打包后置位：

```js
// build 后置步骤
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
await flipFuses(exePath, {
  version: FuseVersion.V1,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
});
```

⚠️ **两条硬约束**：① fuse 写在 **exe 头部**，flip 会改 exe 字节 → **必须重签**（本项目当前 `signExecutable: false`，所以"重签"指的是重算发布清单哈希，见 §5）；② `EnableEmbeddedAsarIntegrityValidation` 会把 asar 的哈希钉进 exe，**此后任何 asar 内改动（包括换一张图片）都必须重新 flip + 重新出包**。建议 1.8.0 一次性做，别在补丁流程里做。

### 2.7 结构风险：包里躺着一份"启动即抛"的旧主进程

```
app.asar/package.json   → { "main": "release-entry.cjs" }   // 190 B
project/desktop/package.json:7 → "main": "main.cjs"          // 源码默认值
```

打包时 `main` 被改写为 `release-entry.cjs`，所以：

```js
// app.asar/main.cjs:2（源码树同文件同样第 2 行，33,554 B）
throw new Error('此隔离副本禁止从正式Electron入口启动，请使用stage1受限测试启动器；正式安装未修改。');
```

**一份 33KB、含完整 IPC 注册逻辑（`main.cjs:343/346/347` 的 webPreferences 与 `release-app.cjs:329` 同构）但入口第 2 行就抛异常的主进程副本，被原样打进安装包。** 危害：

1. 它已经与活实现**漂移**（`:161` 丢参数、`:169` 活版本传 3 个参数）；
2. 任何按 `main.cjs` 做的审计/修复都会作用在死代码上（这正是 `FULL_AUDIT.md` P1-4/P1-5 行号失真的原因）；
3. 增加 33KB 体积与阅读噪音，也给了"误改错文件"的机会。

**改法**：从 `package.json` 的 `files[]` 里删掉 `main.cjs`（`files` 是白名单，删一行即可），或在构建脚本里显式排除。**这是本次审计里改动最小、收益最确定的一条**。

---

## 3. 数据层

### 3.1 三个库与打开参数

| 库 | 路径 | 打开方式 | 用途 |
|---|---|---|---|
| `jewelry.sqlite` | `F:\鑫金源珠宝资料\工作室数据\jewelry.sqlite`（`storage-locations.cjs:60/155`） | `runtime.cjs:126` `new DatabaseSync(...)` 读写 | 主业务（报价、客户、销售、协作） |
| `ledger.db` | 同根下 `内帐`（`desktop-host-runtime.cjs:6`） | `legacy-modules.cjs:61` **`readOnly: true`** | 遗留内帐（由 `legacy-modules/xjy-ledger.exe` 写入） |
| `stockcheck.db` | 同根下 `库管` | 同上 | 遗留库管（`xjy-inventory.exe`） |

```js
// desktop/runtime.cjs:128
sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
// :137
close() { ... sqlite.exec('PRAGMA wal_checkpoint(TRUNCATE)'); sqlite.close(); }
```

**已达标**：WAL 已开、外键已开、`busy_timeout=5000`、关闭时 checkpoint(TRUNCATE)。这比多数 Electron+SQLite 项目规范。

**缺的参数与取舍**：

| PRAGMA | 现值 | 建议 | 理由 |
|---|---|---|---|
| `journal_mode` | WAL ✅ | 保持 | 读写并发、崩溃恢复好 |
| `synchronous` | 默认 **FULL** | `NORMAL` | WAL 模式下 `NORMAL` 仍是崩溃安全（只会丢最后一次未 checkpoint 的事务），但把每次提交的 fsync 拿掉。**每个 `BEGIN IMMEDIATE...COMMIT` 在机械盘/杀毒环境下可省 1–5ms**，这对"每次点击都开一个事务"的业务层是实打实的延迟 |
| `wal_autocheckpoint` | 默认 1000 页 | 可保持 | 桌面单机够用 |
| `mmap_size` | 未设 | 可选 `268435456` | 只读查询走内存映射，减少 syscall |
| `temp_store` | 默认 file | 可选 `MEMORY` | 报表类排序/临时表提速 |

⚠️ `synchronous=NORMAL` 是**取舍**：若门店在意"停电丢最后一笔"，保持 FULL。建议先在收银/销售高峰场景实测，不改默认值也能接受。

### 3.2 没有语句缓存：每次查询都重新编译 SQL

```js
// desktop/runtime.cjs:18-41
class LocalD1 {
  prepare(sql) {
    let bindings = [];
    const execute = () => {
      const statement = sqlite.prepare(sql);          // ← 每次 all()/run() 都重新 prepare
      if (statement.columns().length) {               // ← 再多一次元数据调用
        return { success:true, results: statement.all(...bindings).map(r=>({...r})), meta:{changes:0} };
      }
      const result = statement.run(...bindings);
      ...
    };
    return { bind(str...), async first(), async all(){return execute()}, async run(){return execute()} };
  }
}
```

`LocalD1` 每次 `all()/run()/first()` 都会走一遍 `sqlite.prepare(sql)`（SQL 编译 + 语句对象分配），并且多一次 `statement.columns()` 判断。业务层是 D1 风格（`env.DB.prepare(...).bind(...).all()`），一个 `/api/bootstrap` 就有几十条查询 → 几十次重复编译。

**改法（~40 行，零行为变化）**：在 `LocalD1` 里加 `Map<sql, StatementSync>` LRU（上限 200 条），`execute()` 复用；`columns()` 结果按语句缓存。这是最"纯"的性能改动——不碰数据格式、不碰业务逻辑。

> 注意：这不是"bug"。`node:sqlite` 的 `prepare` 本身很快（微秒级），收益在"高频 + 多语句"路径上累积。**先加 `performance.now()` 打点实测再决定是否合入**，别为 1% 改代码。

### 3.3 `LocalBucket`：图片元数据是单个 JSON，每次写全量重写

```js
// desktop/runtime.cjs:55-98
this.metadataFile = path.join(this.directory, 'metadata.json');
this.metadata = fs.existsSync(this.metadataFile) ? JSON.parse(fs.readFileSync(this.metadataFile,'utf8')) : {};   // :60 启动时无保护解析
saveMetadata() { ... fs.writeFileSync(temporary, JSON.stringify(this.metadata), {mode:0o600}); fs.renameSync(...); }  // :66-70
async put(key, value) { ...; this.metadata[key] = {...}; this.saveMetadata(); }   // :77-78 每次上传重写全量
async delete(key) { ...; delete this.metadata[key]; this.saveMetadata(); }        // :95-96 每次删除重写全量
```

三个问题，按严重度：

1. **启动即崩风险（高）**：`:60` 的 `JSON.parse` 无 try/catch。这张表里存的是**每一张报价图片的元数据**，随门店使用只增不减（`metadata.json` 会到 MB 级）。一旦文件被写坏（磁盘满、断电恰好落在 rename 前的写入、外部工具动过），`createRuntime()` 直接抛异常 → **程序完全起不来，且没有任何自救路径**。写入侧有"临时文件 + rename"保护写入完整性，但**读取侧没有任何兜底**。
   改法：`try { ... } catch { metadata = {}; rebuildFromDirectory(); log(...) }`——文件名是 UUID，`fs.readdirSync` 足以重建 `{key → size}` 骨架。
2. **写放大（中）**：每次 `put`/`delete` 全量 `JSON.stringify` + 写盘。5000 张图时每次上传要序列化并写 ~1–2MB。改法：迁移到 SQLite 表（`media_metadata(key PRIMARY KEY, size, http_metadata JSON, ...)`）——但**这会改数据格式**，属"需要版本迁移"的事，不能算快速改动。
3. **同步 IO（中低）**：`:89` `fs.readFileSync(this.filename(key))` 在主进程读图片（上限 45MB），见 §1.7。

> 另：`metadata.json` 与 `images/` 下的文件**不在同一个事务里**，二者必然存在漂移窗口（文件写成功、metadata 未写）。当前靠 `head()` 里 `metadata && fs.existsSync(filename)` 双重判断兜住，属可接受。

### 3.4 索引覆盖：良好，不是问题点

`desktop/migrations/` 共 14 个文件（`0000_productive_gabe_jones.sql` … `0013_sales_request_facts.sql`），索引数按迁移分布：`0000`:8、`0001`:2、`0002`:3、`0004`:4、`0005`:5、`0007`:3、`0008`:1、`0009`:1、`0010`:5、`0011`:3、`0013`:1（`0003`/`0006`/`0012` 为 0）。

实测到的索引质量明显高于平均水准——有复合索引、有 DESC 排序索引、还有**部分索引**（partial index）：

```sql
-- 0000
CREATE INDEX audit_entity_idx ON audit_logs(entity_type, entity_id, created_at);
CREATE UNIQUE INDEX quote_number_unique ON quotes(number);
CREATE INDEX quote_owner_date_idx ON quotes(owner_id, created_at);
-- 0008
CREATE UNIQUE INDEX customer_active_phone_key ON customers(phone_key) WHERE deleted_at IS NULL AND phone_key IS NOT NULL;
-- 0010
CREATE INDEX sales_orders_review_queue ON sales_orders(status, submitted_at DESC, id);
CREATE INDEX sales_orders_effective_root ON sales_orders(source_root_id) WHERE status IN (...);
-- 0007
CREATE INDEX sales_publications_version ON sales_publications(month, version) WHERE status ...;
```

**结论**：不需要"补索引"这条泛泛建议。真要抠，唯一值得量的是 `audit_logs`——它有 `(entity_type, entity_id, created_at)`，但操作日志页面是按 `created_at DESC, id DESC` 翻页（已有 `operation_logs_time` 覆盖同名表），`audit_logs` 侧若也有全表倒序翻页则缺 `(created_at DESC, id DESC)`。**先用 `EXPLAIN QUERY PLAN` 实测再改**，不要凭猜测加索引。

### 3.5 迁移：有框架，缺校验和

```js
// desktop/runtime.cjs:100-121
function migrate(sqlite, migrationDir) {
  const migrations = fs.readdirSync(migrationDir).filter(n => /^\d+_[\w-]+\.sql$/.test(n)).sort();
  if (!migrations.length) throw new Error('程序数据库结构文件缺失，请重新安装');
  sqlite.exec('CREATE TABLE IF NOT EXISTS desktop_migrations(name TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL)');
  for (const name of migrations) {
    if (sqlite.prepare('SELECT name FROM desktop_migrations WHERE name=?').get(name)) continue;
    sqlite.exec('BEGIN IMMEDIATE');
    try { sqlite.exec(fs.readFileSync(path.join(migrationDir, name), 'utf8')); sqlite.prepare('INSERT INTO desktop_migrations(name,applied_at) VALUES(?,?)').run(name, new Date().toISOString()); sqlite.exec('COMMIT'); }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  }
  sqlite.exec(`CREATE TABLE IF NOT EXISTS local_accounts (...)`);   // :113-120 ← 在版本化之外
}
```

做得对的：文件排序稳定、逐文件事务、失败 ROLLBACK、有 `desktop_migrations` 记账。

两个缺口：

1. **没有内容校验和**：只记 `name`，不记 `sha256`。若有人改了一个**已发布**的迁移文件（哪怕只改一个索引），老库不会重跑、新库按新内容建 —— 两种库结构静默分叉，且事后无法判断现场是哪一版。改法：`desktop_migrations` 加 `checksum TEXT`，启动时对已记录的迁移比对 `sha256`，不一致就明确报错（而不是继续跑）。
2. **`local_accounts` 建表在迁移体系之外**（`:113`）：这张表的 schema 变更没有版本号，将来改它只能靠 `ALTER TABLE` 硬塞。

### 3.6 备份/迁移策略：三套并存，缺异地与演练

| 实现 | 位置 | 机制 | 产物 |
|---|---|---|---|
| `backup.cjs` | `:32` | `VACUUM INTO ?` + JSON 清单 + `PRAGMA integrity_check`/`foreign_key_check`（`:73/:76`） | 手工/界面触发的备份包 |
| `business-backups.cjs` | `:38` | `sqlite.backup(db, snapshot)`（`node:sqlite` 原生备份 API）逐库快照，`:39/:82` 校验 ERP 附件 | `AUTO-YYYY-MM-DD-<uuid>.xjybak` |
| `business-daily-backup.cjs` | 全文 | 独立日备调度，错误写 `daily-backup-errors.log`（`:127`） | 每日快照 |
| 恢复 | `business-restore.cjs:18` | journal 状态机 `PREPARED/SWAPPING/PUBLISHED/COMMITTED/ROLLED_BACK/ROLLBACK_VERIFY_REQUIRED` + `restore-transaction.json`（`business-backups.cjs:67`） | 可回滚的恢复流程 |

**优点**：`VACUUM INTO` 与 `sqlite.backup()` 都是**事务一致**的快照方式（不会拷到半截 WAL），比"直接复制 .db"高一个档次；恢复有 journal 状态机，断电后可判态——这块设计是合格的。

**缺口**：

1. **两套备份实现并存**（`VACUUM INTO` 与 `sqlite.backup`），各自的校验/保留策略不同 → 长期会漂移。建议留一套（`sqlite.backup()` 更省空间、可增量分页，且 `node:sqlite` 原生）。
2. **保留期只有 7 天**（`business-backups.cjs:89`：`now - stamp < 7*86400000` 才保留）且**同盘**。门店常见事故是"硬盘坏了/勒索软件加密"——同盘 7 天备份等于没有备份。
3. **无异地**：离线环境下不需要云，但完全可以做"第二块盘 / U 盘 / 局域网 NAS 目录"的 `file://` 目标。[`litestream`](https://github.com/benbjohnson/litestream)（Apache-2.0）的 WAL 持续复制模型正是为这个场景设计的，且**支持 `file://` 副本目标**，不需要任何联网。代价：它是独立 Go 二进制（给 Windows 离线包 +10–20MB），对一个已经 247MB 的安装包不算大，但要额外做"随包分发 + 服务化 + 启停编排"。
   **更务实的替代**：现成的 `sqlite.backup()` 已经能出快照，加 30 行"快照完成后 copy 到 `\\NAS\share` 或 `E:\` 第二块盘 + 校验 sha256"即可拿到 80% 的收益，无需引入 Go 二进制。
4. **无恢复演练**：没有任何"月度自动恢复到一个临时目录并跑 integrity_check"的机制。备份没验证过 = 不知道能不能用。
5. **附件不在同一个快照里**：`工作室数据/images/`（含 `images/metadata.json`）与 `jewelry.sqlite` 是两套存储，`business-backups.cjs:39/:82` 对 ERP 附件有校验，但**报价图片目录与 DB 的一致性没有事务保证**。备份要么漏图、要么图比记录多。

### 3.7 技术选型对照（结论：留在 `node:sqlite`）

| 方案 | 结论 | 理由 |
|---|---|---|
| **`node:sqlite`（现状）** | **保持** | 内置模块，**无需 native 编译、无需 per-Electron-ABI 预编译包下载**——这对"离线部署 + 每次升 Electron 都要重建 native 模块"的场景是决定性优势。当前状态：Node 22.5 引入，22.13/23.4 起不再需要 `--experimental-sqlite`，现行文档标 **Stability 1.2 – Release candidate**（[nodejs.org/api/sqlite.html](https://nodejs.org/api/sqlite.html)）。`sqlite.backup()`（v23.8/22.16 起）已在本项目使用；Electron 44 携带 **Node 24.21.0**，API 面足够 |
| [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3)（MIT） | **不引入** | 更快（C++ 直连、语句缓存成熟），但代价是：① 每个 Electron 版本都要 rebuild/换预编译二进制 → 离线打包链变复杂（本项目已经为了离线把依赖锁得很死）；② 安装包 +2–3MB；③ 当前瓶颈在 §3.2 的重复 prepare 与 §3.3 的 JSON 全量重写，**不在驱动层**。真到了需要它的性能点（>10 万行报表查询），再评估 |
| [`litestream`](https://github.com/benbjohnson/litestream)（Apache-2.0） | **借思路，不整套引入** | 借"WAL 持续复制到第二个目标"的思想（见 §3.6-3），用现成 `sqlite.backup()` + 异地 copy 落地；引入整套 Go 二进制需要额外分发/服务化成本 |
| [`sqlite-utils`](https://github.com/simonw/sqlite-utils)（Apache-2.0） | **只用于运维/诊断** | Python CLI，适合"现场排障时把 .db 拉出来查/导出"，**不进产品包**。注意：门店电脑不一定有 Python，所以只能作为技术支持侧工具 |

---

## 4. 开源参考（每类问题 2–3 个仓库）

> license 与版本经 npm registry（`registry.npmjs.org`）与各仓库 `LICENSE` 原文核对（2026-10-22 实测）；周下载量为当日 npm 实测值。**GitHub stars 未核实**（本环境无法直连 GitHub API），一律写"未核实"。

### 4.1 Electron 安全加固

| 仓库 | 解决什么 | 如何嵌入 | license | 引入成本 |
|---|---|---|---|---|
| [`@electron/fuses`](https://github.com/electron/fuses) | 关闭 `RunAsNode`/`EnableNodeCliInspectArguments`，启用 `OnlyLoadAppFromAsar` + asar 完整性校验，阻断"换 asar 即改程序" | build 后置脚本 `flipFuses(exePath, {...})`（v2.1.3，周下载 4,052,798） | MIT | 低；**改 exe → 需重签 + 后续每次改 asar 都要重新 flip** |
| [`electron/security-warnings`](https://github.com/electron/security-warnings) | 官方 Electron 安全检查清单的可执行版本：用 AST 扫描主进程代码，报 `nodeIntegration`/`webSecurity`/CSP 等反模式 | `npx @electron/security-warnings .` 加进 CI（无运行时依赖） | MIT（未核实 LICENSE 文件，npm/仓库口径） | 极低；只读扫描，无副作用 |
| [Electron 官方 Security 文档](https://www.electronjs.org/docs/latest/tutorial/security) | 权威检查清单（本文 §2.1 的对照基准） | 人工核对 + 落成 review checklist | CC-BY-4.0（文档） | 零 |

> 本项目已有 CSP、`sandbox`、权限全拒、出站硬拦截——**fuses 是唯一还缺的一块**。

### 4.2 构建体积

| 仓库 | 解决什么 | 如何嵌入 | license | 引入成本 |
|---|---|---|---|---|
| [`rollup-plugin-visualizer`](https://github.com/btd/rollup-plugin-visualizer) | 出 chunk 构成图，量化"recharts 到底占多少" | `vite.config.ts` 的 `build.rolldownOptions.plugins` 加 `visualizer({ filename:'dist/stats.html' })`（v7.1.1） | MIT | 极低（devDependency，不进包） |
| [`electron-builder` 的 `compression`/`asar`](https://github.com/electron-userland/electron-builder) | 澄清两件事：`compression: 'maximum'` 只压**安装器**，asar 内是原样字节；`asarUnpack` 只对 native 模块有意义（本项目无 native 模块，不需要） | `package.json build` 段加 `"compression": "maximum"`（默认已是 normal→maximum 可省安装包 5–15%） | MIT | 极低 |
| [`electron-vite`](https://github.com/alex8088/electron-vite) | 一体化主/预加载/渲染三端构建 + 热更新，替代手写 `build.cjs`（esbuild + vite 双轨） | 换构建器属**大改**：需重排 `build.cjs`/`vite.config.ts`/`package.json` 脚本 | MIT | 中高；**不建议在 1.7.x 补丁里做**，留给 1.8 |

### 4.3 SQLite

| 仓库 | 解决什么 | 如何嵌入 | license | 引入成本 |
|---|---|---|---|---|
| [`node:sqlite`（Node 内置）](https://nodejs.org/api/sqlite.html) | 当前方案；`sqlite.backup()` 做一致性快照 | 已在用（`runtime.cjs:6`） | MIT（Node） | 零 |
| [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) | 更快的同步驱动 + 语句缓存 | 替换 `DatabaseSync`；需 per-ABI 预编译包 | MIT | 中高（重建离线打包链）；**不建议** |
| [`litestream`](https://github.com/benbjohnson/litestream) | WAL 持续复制到异地副本（支持 `file://`） | 独立进程 + 配置文件；随包分发 | Apache-2.0（LICENSE 原文核对） | 中 |
| [`sqlite-utils`](https://github.com/simonw/sqlite-utils) | 现场排障/导出 CLI | 只在技术支持机器上用 | Apache-2.0（LICENSE 原文核对） | 零（不进产品） |

### 4.4 图片优化

| 仓库 | 解决什么 | 如何嵌入 | license | 引入成本 |
|---|---|---|---|---|
| [`sharp`](https://github.com/lovell/sharp) | PNG/JPEG → WebP/AVIF + 缩放，构建期一条命令处理 `public/` | `node scripts/optimize-images.mjs`，产物仍放 `public/`（文件名不变） | Apache-2.0（v0.35.5，LICENSE 原文核对） | 低；**只装构建机**，进包体积为 0 |
| [`svgo`](https://github.com/svg/svgo) | 4 个 SVG 图标（当前合计 2,049 B）——收益极小，但顺手 | 同脚本内 | MIT（v4.1.0） | 极低 |
| [`vite-plugin-image-optimizer`](https://github.com/FatehAK/vite-plugin-image-optimizer) | 把 sharp/svgo 接进 vite 构建管线，无需单独脚本 | `vite.config.ts` 加一个插件 | MIT（v2.0.3） | 低；但会让构建产物哈希变化→`resource-audit.mjs:25` 的 PNG 魔数断言需同步改 |
| [`@squoosh/lib`](https://github.com/GoogleChromeLabs/squoosh) | 曾经的主流方案 | — | Apache-2.0（v0.5.3） | **不推荐**：Squoosh 系列维护状态停滞，且 `sharp` 覆盖同样能力（AVIF/WebP/尺寸），生态与预编译支持都更好 |

> ⚠️ 本项目有构建期硬断言：`renderer/resource-audit.mjs:25` 断言 `home-necklace.png` 的魔数必须是 `89504e47…`（PNG），`:26` 断言 `ring.jpg` 是 JPEG，`:46` 断言 `homeImageSchema` 接受 `"/home-necklace.png"`。**改扩展名/改格式必须同步改这三处**，否则构建直接失败——反过来说，这是一个很好的"防呆"设计，别删它。

### 4.5 IPC 契约

| 仓库 | 解决什么 | 如何嵌入 | license | 引入成本 |
|---|---|---|---|---|
| [`zod`](https://github.com/colinhacks/zod) | 在 IPC 边界做入参 schema 校验（项目已在 renderer 侧使用，bundle 内命中 14 次） | `nativeHandler` 增加可选 schema 参数，校验失败直接 400 | MIT（v4.6.7） | 低（已是依赖） |
| [`electron-trpc`](https://github.com/jsonnull/electron-trpc) | 端到端类型安全 IPC（renderer 直接调 main 的类型化 router） | 需要**重写 41 个通道**为 router | MIT（v0.7.1，周下载仅 10,291） | **高，不建议**：收益是类型安全，代价是全部 IPC 面重写 + 引入 tRPC 运行时；`contextBridge` 手动契约已经够用 |
| [Electron `ipcMain` 官方文档](https://www.electronjs.org/docs/latest/api/ipc-main) | 通道命名/校验 best practice | 对照检查 | CC-BY-4.0 | 零 |

### 4.6 日志（本节额外补充）

| 仓库 | 解决什么 | 如何嵌入 | license | 引入成本 |
|---|---|---|---|---|
| [`electron-log`](https://github.com/megalojack/electron-log) | 主/渲染进程统一日志、按大小/日期滚动、纯本地 | `require('electron-log')` + `transports.file.resolvePathFn` 指到 `程序设置\日志` | MIT（v5.4.4，周下载 907,556） | 低（可选：也可用 §2.5 的 8 行自写方案） |

---

## 5. 红线核对与"需重签"清单

### 5.1 红线核对

| 红线 | 本文所有建议是否触碰 |
|---|---|
| 离线部署不能引入运行时联网依赖 | **未触碰**。所有推荐件均为构建期工具（visualizer/sharp/fuses）或纯本地运行时（electron-log，仅写文件）；`litestream` 只用 `file://` 副本目标，不联网 |
| 不改数据格式 | **未触碰**（唯一涉及格式的是 §3.3-2"metadata.json → SQLite 表"，已明确标注为**需要版本迁移**、不属快速改动） |
| 不碰微信目录 / `F:\自制软件` / `F:\鑫金源珠宝资料` 写入 | 本次全程只读，未写入上述任一路径 |
| 触及签名链必须标明"需重签" | 见 §5.2 |

### 5.2 改动 → 是否需重签

本项目的"签名"有三层，必须分开说：

1. **exe 的 Authenticode**：`package.json` `build.signExecutable: false` → **当前根本不签 exe**，所以改代码不"破"任何已有 exe 签名。
2. **差分补丁清单**：`desktop/package-update.cjs:18-20` 生成 `payload = { file:'app.asar', sha256, size }`，`build-update-helper.cjs` 校验的是 **Ed25519 发布公钥**。**asar 内任何字节变化（含换一张图片）都会改变 sha256 → 走补丁通道就必须重新出清单并重签**。
3. **引擎树完整性**：`engine-tree-runtime170.cjs`（1079 文件白名单）由另一条审计线负责，本文的改动**都不触及 `engine/`**。

| 建议 | 改哪里 | 是否需重签 | 说明 |
|---|---|---|---|
| 图片重编码 | `public/` 源图 → `renderer-dist/*.png/jpg` | 全量包：**否**；补丁通道：**是** | 不碰 exe、不碰 engine；仅 asar 哈希变 |
| Vite 分包 / 懒加载 / CSS 合并 / 删 polyfill | `renderer/*`、`vite.config.ts` | 同上 | 同上 |
| `Cache-Control` 分级、`ready-to-show` | `release-app.cjs:98/344` | 同上 | 主进程代码在 asar 内 |
| `synchronous=NORMAL`、语句缓存、`LocalBucket` 异步读 | `runtime.cjs:18/60/89/128` | 同上 | **不碰数据格式**（PRAGMA 不写库结构） |
| 删掉死代码 `main.cjs` | `package.json` `files[]` | 同上 | 纯减文件 |
| 补 `trustedSender`、错误日志落盘 | `release-app.cjs:169/170/307` | 同上 | — |
| **`@electron/fuses`** | 打包后 exe | **是（改 exe 头）** | 且启用 asar 完整性校验后，**此后每次改 asar 都要重新 flip+出包**，建议只在 1.8.0 大版本做 |
| `electron-vite` 换构建器 | 整个构建链 | **是**（产物结构变） | 建议 1.8 规划 |

---

## 附：本次实测数据可复现性

所有数字均来自只读 asar 内存解析脚本（未解包、未安装依赖）：

- asar 索引与体积：读取 header（`buf.readUInt32LE(12)` 取 header size，`buf.readUInt32LE(4)` 取 data offset），按 entry 的 `offset`/`size` 定位。
- gzip 比：`zlib.gzipSync(bytes, { level: 9 })`，与原始字节比。
- CSS 重复：按 `}` 切分规则、`Set` 比对、累计重合字节。
- JS 模式扫描：对整块文本做正则计数（`dynamic import()` = `/\bimport\(/g`，`recharts` = `/recharts/g` 等）。
- 图像尺寸：直接读 PNG `IHDR`（`readUInt32BE(16/20)`）与 JPEG `SOFn` 段。
- Electron/Node/Chromium 版本：`releases.electronjs.org/releases.json` 中 `44.7.0` 条目实测 `node=24.21.0`、`chrome=152.0.7977.130`。
