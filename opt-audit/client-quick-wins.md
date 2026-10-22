# 鑫金源珠宝 1.7.0 · 客户端快速收益（一天内可做 5 项）

**范围**：只改 `renderer/`、`vite.config.ts`、`runtime.cjs`、`release-app.cjs`、`package.json` 的 `files[]`。
**不碰**：`engine/`（引擎树白名单 1079 文件，另一条审计线）、`generated/release-pins.cjs`、任何数据格式/迁移、任何联网依赖。
**签名影响**：本项目 exe **没有 Authenticode 签名**（`package.json` `build.signExecutable: false`），引擎树也不动，所以这 5 项**都不需要为 exe 重签**。唯一注意：若通过**差分补丁通道**发布，`desktop/package-update.cjs:18-20` 会对 asar 算 `sha256` 并进 `payload`，**asar 字节一变，补丁清单必须重新出并重签**（走全量 portable/nsis 包则无此动作）。

---

## 速览

| # | 改动 | 主要收益 | 工时 | 风险 | 需重签 |
|---|---|---|---|---|---|
| 1 | 两张 PNG 重编码为 WebP + 缩放 | 安装包 13.5MB → **≈7.1MB**；首屏少搬 6.6MB | 2–3 h | 低（需同步 3 处断言 + 1 处兼容） | exe 否；补丁清单是 |
| 2 | CSS 合并去重（`cssCodeSplit:false`） | CSS 523KB → **≈316KB**；首屏 CSS 320KB → ≈110KB | 1 h | 极低 | 同上 |
| 3 | 登录页懒加载 Workspace | 首屏 JS 1,865,723 B → **≈500–700KB**，解析时间降 60–70% | 1–2 h | 低 | 同上 |
| 4 | 静态资源缓存分级 + 窗口提前显示 | 二次开窗秒开；窗口出现早 0.5–2 s | 1 h | 极低 | 同上 |
| 5 | 数据层三个小修（并发/防崩/减文件） | 写延迟下降；杜绝"metadata.json 坏了程序起不来" | 1–2 h | 低 | 同上 |

一天排得下的顺序：**4 → 2 → 2.5（顺手）→ 3 → 1 → 5**（先做零风险的，把图片放最后，因为它要重跑断言）。

---

## 1. 两张 PNG 重编码（最大单项收益）

### 现状（实测）

| 文件 | 尺寸 | 字节 | 实际被画到 | gzip 比 |
|---|---|---:|---|---:|
| `public/home-necklace.png` → `renderer-dist/home-necklace.png` | 1536×2048 | 4,150,568 | 登录页 `.auth-image` ≈600×800 CSS px（`renderer/main.tsx:114`） | **1.000** |
| `public/quote-stationery-v2.png` → `renderer-dist/quote-stationery-v2.png` | 941×1672 | 2,455,511 | `ctx.drawImage(...,0,0,360,640)`（`lib/quote-image.ts:33`） | **0.948** |

gzip 比 1.000/0.948 = 这两张图**无法通过任何压缩手段变小**（`electron-builder` 的 `compression: maximum` 只压安装器，asar 内是原样字节）。合计 **6,606,079 B = 载荷的 49.1%**。

### 做法（分两步，先低风险后高收益）

**步骤 A（零行为风险，先做）—— `quote-stationery-v2.png`**

它没有 schema、没有用户设置引用，只有 3 个引用点：

```bash
sharp quote-stationery-v2.png -resize 480x853 -webp -q 85 quote-stationery-v2.webp
# 941×1672 / 2,455,511 B  →  480×853 / 约 50–90 KB
```

改动 3 处：
1. `lib/quote-image.ts:5` `quoteStationery = { src: "/quote-stationery-v2.webp", ... }`
2. `components/quote-paper.css:1` `url("/quote-stationery-v2.webp")`
3. `desktop/package-update.cjs:18` 的 required 清单：`/renderer-dist/quote-stationery-v2.png` → `.webp`

**步骤 B —— `home-necklace.png`**（引用更多，多花 1 小时）

```bash
sharp home-necklace.png -resize 1024x1365 -webp -q 82 home-necklace.webp
# 1536×2048 / 4,150,568 B  →  1024×1365 / 约 90–150 KB
```

必须同步的 4 处（**漏一处构建就红**）：
1. `renderer/main.tsx:114` `<img src="/home-necklace.png">` → `.webp`
2. `renderer/resource-audit.mjs:25`：PNG 魔数断言（`89504e47…`）→ 改成 WebP 头 `RIFF` + `WEBP` 断言
3. `lib/domain.ts` 的 `homeImageSchema` 若把 `.png` 写死（`resource-audit.mjs:46` 断言它接受 `"/home-necklace.png"`）→ 同时接受 `.webp`
4. **现场兼容（关键）**：门店的 `F:\鑫金源珠宝资料\程序设置\settings.json` 里 `home.image` 存的是旧字符串 `"/home-necklace.png"`。**不要直接让旧值失效**——在读取设置处加 3 行映射：

```ts
if (home.image === '/home-necklace.png') home.image = '/home-necklace.webp';
```

否则升级后用户一开首页就是破图（不是崩溃，但足够让人以为是坏包）。

### 验收

```bash
node build.cjs                    # 构建
node renderer/resource-audit.mjs  # 必须仍输出 "result": "PASS"
```

再手工确认：登录页右侧图完整、生成 9:16 报价图纸纹与改前逐像素肉眼一致（`renderer/personal-sales.tsx` 之外还有 A4 版式，两套都要看一眼）。

### 收益

| 项 | 改前 | 改后（预估） |
|---|---:|---:|
| 两张图合计 | 6,606,079 B | **≈140–240 KB** |
| asar | 13,495,963 B | **≈7.0 MB** |
| 首屏阻塞资源 | 6,336,445 B | **≈2.1 MB** |

> 回滚：图片文件与上述 4 处一起回退（都是纯常量替换，`git revert` 一步到位）。

---

## 2. CSS 合并去重

### 现状（实测，按 `}` 切规则做逐字节集合比对）

| 关系 | 重复字节 | 占比 |
|---|---:|---:|
| `print-BMWMhIsv.css` ⊂ `styles-0mKe94QZ.css` | 197,682 / 200,894 | **98.4%** |
| `warranty-document-vn5KZ9Gi.css` ⊂ `styles-0mKe94QZ.css` | 9,599 / 24,563 | 39.1% |
| **合计重复** | **≈207,281 / 523,252** | **39.6%** |

原因：Tailwind v4 在**每个入口**各生成一份 utility，四个入口共享组件 → 同一批规则被写进多个文件。

### 做法

```ts
// desktop/vite.config.ts:24 附近，build 段
build: {
  cssCodeSplit: false,   // 所有入口共用一个 style.css（Electron 本地加载，多请求成本可忽略）
  ...
}
```

改动 1 处，1 分钟。**断言安全性已验证**：`renderer/resource-audit.mjs:27-32` 检查的是"CSS 无远程引用/无 `@font-face`/含 `aspect-ratio:9/16`/含 `@page{size:A4}`/含 `.a4-print-root` 与 `.quote-paper`"，都是**在合并后的 CSS 文本里做 `includes`/正则匹配**——合并只会让它们更容易命中，不会失败。

### 收益

| 项 | 改前 | 改后（预估） |
|---|---:|---:|
| 全部 CSS | 523,252 B | **≈316 KB**（−207KB） |
| 登录页 CSS | 320,154 B | **≈110 KB** |

> 回滚：删掉那一行。
> 注意：若合并后发现某个页面样式缺失，说明有 CSS 只被 `print.html` 的入口图引用——这是**已有的潜在 bug**（样式依赖入口顺序），不是本改动引入的。

---

## 3. 登录页懒加载 Workspace

### 现状（实测）

- `renderer-dist/assets/main-7etXIfP0.js`：**1,542,620 B、94 行、最长单行 633,702 字符、`import(` 出现 0 次**（零代码分割）。
- `renderer/main.tsx:4` `import Workspace from "./workspace"` —— 131,062 B 源码的整个工作区进了首屏。
- `recharts` 全项目只有 `renderer/personal-sales.tsx:3` 一处 import，却因上一条被整体拖进首屏（chunk 内 `recharts` 标识命中 79 次）。
- 登录页 `index.html` 还额外背了 `warranty-document-CcBHseIj.js`（117,905 B）+ `warranty-document-vn5KZ9Gi.css`（24,818 B）——质保单渲染，登录页完全用不到。

### 做法

```tsx
// renderer/main.tsx:1-9
import { lazy, Suspense } from "react";
const Workspace = lazy(() => import("./workspace"));   // 替换第 4 行的静态 import

// 渲染处（用 Workspace 的地方）
<Suspense fallback={<div className="app-loading">正在载入工作台…</div>}>
  <Workspace {...} />
</Suspense>
```

一处改动同时解决两件事：工作区 + `recharts` + `warranty-document`（它经 workspace 静态链进入首屏）全部下沉。

顺手（可选，各 1 行）：

```ts
// vite.config.ts
build: {
  modulePreload: { polyfill: false },   // Chromium 152 原生支持 modulepreload，省 698 B + 1 请求
  target: 'chrome152',                   // Electron 44 = Chromium 152，不做无谓语法降级
}
```

### 收益与验收

- 首屏 JS 1,865,723 B → **≈500–700 KB**（预估，**必须用 visualizer 实测**）。
- 验收：登录 → 输密码 → 进工作台，骨架屏一闪即过；工作台里**逐个点开**报价/A4 预览/质保单/销售报表（`personal-sales` 用 recharts）确认无白屏、无 `Suspense` 卡住。
- 这一步之后接 `rollup-plugin-visualizer`（见 `client-oss.md` #1）复核构成，再决定是否要 vendor 手动分块。

> 回滚：把 `lazy` 换回静态 `import`。
> ⚠️ 别在这里同时改 `electron-vite`（换构建器属 1.8 大版本工程）。

---

## 4. 静态资源缓存分级 + 窗口提前显示

### 现状（实测）

```js
// desktop/release-app.cjs:98  —— 全部资源一律 no-store
const headers = { 'Content-Type': ..., 'Content-Security-Policy': csp,
                  'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };
```

```js
// desktop/release-app.cjs:329 / :344 / :345
window = new BrowserWindow({ ..., show: false, backgroundColor: '#f7f6f3', ... });
await window.loadURL(localOrigin + '/home');   // 等 load 事件（含 4.15MB 登录图）
if (selfCheck) await diagnostics(); else { window.show(); }
```

两个后果：
1. 构建产物已经是内容哈希命名（`main-7etXIfP0.js`）却发 `no-store` → **每次开窗都是冷启动**，重读 13.5MB。
2. `show()` 在 `load` 之后 → **4.15MB 登录图解码完窗口才出现**，办公机上就是"点了没反应" 1–3 秒。

### 做法

```js
// :98 替换为分级缓存
const immutable = /\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.(js|css)$/.test(pathname);
headers['Cache-Control'] = immutable ? 'public, max-age=31536000, immutable' : 'no-cache';
```

```js
// :344 之前插入
window.once('ready-to-show', () => { if (!selfCheck) window.show(); });
await window.loadURL(localOrigin + '/home');
if (selfCheck) await diagnostics(); else { /* 已在 ready-to-show 里 show */ }
```

注意保留 `selfCheck` 分支行为不变（自检模式依赖 `loadURL` 完成后再截图，顺序不能动）。

### 收益 / 验收

- 二次开窗：不再重读 13.5MB，首帧即可见。
- 验收：连续开/关窗口 3 次，第 2 次起明显更快；`selfCheck` 模式仍能正常出 `startup-check.json`。

> 回滚：两处都是独立小改，单独 revert 无副作用。

---

## 5. 数据层三个小修（不碰格式）

### 5a. 防"起不来"：`metadata.json` 解析兜底（最重要）

```js
// desktop/runtime.cjs:60
this.metadata = fs.existsSync(this.metadataFile) ? JSON.parse(fs.readFileSync(this.metadataFile,'utf8')) : {};
```

零 try/catch。这张表随门店使用只增不减，一旦被写坏（断电恰落在 rename 前、磁盘满、外部工具动过），`createRuntime()` 直接抛 → **程序完全起不来且无自救路径**。

```js
// 改法（≈6 行）
let metadata = {};
try { metadata = fs.existsSync(this.metadataFile) ? JSON.parse(fs.readFileSync(this.metadataFile,'utf8')) : {}; }
catch (error) {
  fs.renameSync(this.metadataFile, this.metadataFile + '.corrupt-' + Date.now());  // 留证据
  metadata = {};                                                                   // 从目录重建骨架
  for (const name of fs.readdirSync(this.directory)) { if (name !== 'metadata.json') metadata[name] = { size: fs.statSync(path.join(this.directory,name)).size }; }
}
```

### 5b. 写延迟：`synchronous=NORMAL`

```js
// desktop/runtime.cjs:128 现状
sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
```

WAL 模式下 `synchronous` 仍是默认 `FULL`（每次提交 fsync）。加 `PRAGMA synchronous=NORMAL;` 可把每次 `BEGIN IMMEDIATE…COMMIT` 省 1–5ms（机械盘/杀毒环境更明显）。

**取舍要说清**：NORMAL 仍是崩溃安全的（不会损坏库），但**极端断电可能丢最后一次已提交事务**。门店若在乎"最后一笔"，这一项可以不做，或只在非收银时段验证后决定。

### 5c. 减文件：把死代码 `main.cjs` 移出安装包

`app.asar/main.cjs` 第 2 行就是 `throw new Error('此隔离副本禁止从正式Electron入口启动…')`——一份 33,554 B、含完整 IPC 注册逻辑但**永不加载**的旧主进程副本被打进了包（真实入口是 `release-entry.cjs` → `release-app.cjs`）。它已与活实现漂移（死版本 `:161` 丢参数，活版本 `:169` 传 3 个参数），并且是早期审计行号失真的根源。

```json
// desktop/package.json  build.files[]  删掉一行
- "main.cjs",
```

> 验证：删后跑一次 `npm run package`，确认 exe 能启动（`build.files` 是白名单，打包后 `asar` 内不应再有 `main.cjs`）。

---

## 附：这 5 项合起来的账

| 指标 | 现状（实测） | 5 项做完（预估） |
|---|---:|---:|
| app.asar | 13,495,963 B | **≈7.0 MB** |
| 登录页首屏阻塞 | 6,336,445 B | **≈1.4 MB** |
| 登录页 JS | 1,865,723 B | **≈500–700 KB** |
| 登录页 CSS | 320,154 B | **≈110 KB** |
| 二次开窗 | 全量冷读 | 命中缓存 |
| 生产日志 | 无 | （第 6 项，见 CLIENT_OPTIMIZATION.md §2.5，半天） |
| 数据格式 / 引擎树 / 微信目录 | — | **完全未触碰** |

**不建议塞进这一天的事**：`@electron/fuses`（改 exe + 后续每次改 asar 都要重新 flip）、`electron-vite` 换构建器、`metadata.json → SQLite` 迁移（改数据格式）、任何 `engine/` 内改动。
