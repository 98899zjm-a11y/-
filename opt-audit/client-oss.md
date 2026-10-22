# 鑫金源珠宝 1.7.0 · 客户端与数据层 · 开源件对照表

> 面向「客户端与数据层」问题（渲染层性能 / 主进程与 IPC / SQLite 数据层）。引擎与签名链相关的开源件由另一条审计线负责。
>
> **数据来源与核实口径**（2026-10-22 实测）：
> - 版本 / license / 周下载量：`registry.npmjs.org` 与 `api.npmjs.org` 直查；
> - Apache-2.0 / MIT 判定：各仓库 `LICENSE` 原文比对（`raw.githubusercontent.com`）；
> - **GitHub stars：未核实**（本环境无法直连 `api.github.com`，一律不编造数字，用周下载量代替热度参考）；
> - Electron 44.7.0 运行时：`releases.electronjs.org/releases.json` 实测 `node=24.21.0` / `chrome=152.0.7977.130`。

---

## 一、主表（问题 → 开源件）

| # | 问题 | 仓库 / 包 | 版本·热度 | license | 引入方式 | 风险 | 是否需要重签 |
|---|---|---|---|---|---|---|---|
| 1 | 1.54MB 单 chunk、**0 个动态 import**，不知体积构成就分包是盲改（`renderer-dist/assets/main-7etXIfP0.js`；`desktop/vite.config.ts` 全文 30 行无分包配置） | [`rollup-plugin-visualizer`](https://github.com/btd/rollup-plugin-visualizer) | v7.1.1 · 4,623,011 次/周 | MIT | devDependency + `build.rolldownOptions.plugins` 加 `visualizer({ filename:'stats.html' })`；**不进安装包** | 极低：只读构建产物，零运行时影响 | **否**（仅构建期） |
| 2 | 两张 PNG 占 49.1%（6,606,079 B），gzip 比 1.000/0.948，**任何打包器都压不动** | [`sharp`](https://github.com/lovell/sharp) | v0.35.5 · 71,400,664 次/周 | **Apache-2.0**（LICENSE 原文核对） | 构建机脚本 `node scripts/optimize-images.mjs`：PNG→WebP/AVIF + 缩放；产物仍落 `public/` | 低：需同步改 `renderer/resource-audit.mjs:25/26/46` 的格式断言与 `lib/domain.ts` 的 `homeImageSchema`；**只装构建机，进包体积 0** | 全量包**否**；差分补丁**是**（asar 哈希变） |
| 3 | 同上（替代方案，接进 vite 管线，免单独脚本） | [`vite-plugin-image-optimizer`](https://github.com/FatehAK/vite-plugin-image-optimizer) | v2.0.3 · 140,674 次/周 | MIT | `vite.config.ts` 加插件，配 sharp/svgo | 中：产物哈希变化会连带触发 `resource-audit.mjs` 全部断言重验；构建时间 +几秒 | 同 #2 |
| 4 | 4 个 SVG 图标（合计 2,049 B）可再压，顺手项 | [`svgo`](https://github.com/svg/svgo) | v4.1.0 · 22,030,646 次/周 | MIT | 同 #2 脚本内调用 | 极低 | 同 #2 |
| 5 | 无 CSP **不是**问题（`release-app.cjs:44` 已有强策略）；缺的是 **Electron fuses**：`RunAsNode` 默认开启、`OnlyLoadAppFromAsar` 默认关闭、无 asar 完整性校验 → "换个 asar 就能改程序"，而本项目 `signExecutable:false` 无 Authenticode 兜底 | [`@electron/fuses`](https://github.com/electron/fuses) | v2.1.3 · 4,052,798 次/周 | MIT | build 后置脚本 `flipFuses(exePath, {RunAsNode:false, EnableNodeCliInspectArguments:false, OnlyLoadAppFromAsar:true, EnableEmbeddedAsarIntegrityValidation:true})` | **中高**：① 改 exe 字节；② 开启 asar 完整性校验后，**此后每次改 asar 都要重新 flip+出包**（含换图片）→ 建议留到 1.8.0 | **是**（改 exe 头） |
| 6 | 主进程安全基线无自动体检；41 个 IPC 通道 / 3 处命名不一致靠人眼维护 | [`electron/security-warnings`](https://github.com/electron/security-warnings) | 未核实 · CLI 工具 | MIT（未核实 LICENSE 文件，Electron 组织口径） | CI 里跑 `npx @electron/security-warnings .` | 极低：只读 AST 扫描 | **否** |
| 7 | **生产环境零日志落盘**：`release-app.cjs:48-49` 的 `rendererErrors`/`blockedNetwork` 只在 `selfCheck` 写入；无 `uncaughtException`/`unhandledRejection`；主窗口无 `render-process-gone`/`preload-error` → 白屏无痕、无自恢复 | [`electron-log`](https://github.com/megalojack/electron-log) | v5.4.4 · 907,556 次/周 | MIT | `transports.file.resolvePathFn` 指向 `程序设置\日志`，按天滚动 | 低：纯本地写文件、无联网；也可用「8 行自写方案」替代（见 CLIENT_OPTIMIZATION.md §2.5） | 全量包**否**；补丁**是** |
| 8 | 41 个 IPC 通道无入参 schema 校验；`jewelry:request` 用一个通道承载整个 `/api/**`（`release-app.cjs:132-145`），主进程无 `(method,path)→权限` 映射 | [`zod`](https://github.com/colinhacks/zod) | v4.6.7 · 207,048,213 次/周 | MIT | **已是依赖**（renderer bundle 内命中 14 次，`lib/domain.ts` 有 `homeImageSchema`）；只需在 `nativeHandler` 增加可选 schema 参数 | 极低：复用现有依赖 | 全量包**否**；补丁**是** |
| 9 | 想一次性解决 IPC 类型安全 | [`electron-trpc`](https://github.com/jsonnull/electron-trpc) | v0.7.1 · **仅 10,291 次/周** | MIT | 需把 41 个通道改写为 tRPC router | **高**：全量 IPC 重写 + 引入 tRPC 运行时；收益只是类型安全，`contextBridge` 手动契约已够用 | **否**（不建议引入） |
| 10 | 驱动层：当前 `node:sqlite`；考虑换更强驱动 | [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) | v13.0.3 · 7,202,469 次/周 | MIT（LICENSE 原文核对） | 替换 `runtime.cjs:6` 的 `DatabaseSync` | **高**：每个 Electron 版本都要 per-ABI 预编译包/rebuild，**直接破坏当前离线打包链**；安装包 +2–3MB；真正瓶颈在重复 `prepare`（`runtime.cjs:18-41`）不在驱动 | 全量包**否**；补丁**是**（**结论：不引入**） |
| 11 | 备份只有同盘 7 天（`business-backups.cjs:89`），无异地、无恢复演练 | [`litestream`](https://github.com/benbjohnson/litestream) | 未核实 · Go 二进制 | **Apache-2.0**（LICENSE 原文核对） | 支持 `file://` 副本目标（离线可用）；随包分发 + 服务化 | 中：+10–20MB 安装包与启停编排；**务实的 80% 方案**是沿用现成 `sqlite.backup()` + 异地 copy（30 行），先不引 Go 二进制 | **否**（独立进程，不改 asar） |
| 12 | 现场排障：把门店的 `.db` 拉出来查/导出 | [`sqlite-utils`](https://github.com/simonw/sqlite-utils) | 未核实 · Python CLI | **Apache-2.0**（LICENSE 原文核对） | **只装技术支持机器**，不进产品包（门店不一定有 Python） | 零 | **否** |
| 13 | 构建链手写 `build.cjs`（esbuild 打主进程 + vite 打渲染层双轨） | [`electron-vite`](https://github.com/alex8088/electron-vite) | v6.0.0 · 872,544 次/周 | MIT | 替换 `build.cjs` + `vite.config.ts` + `package.json` scripts 三处 | **高**：产物结构变化，需重跑全部构建断言；**1.7.x 补丁不做，留 1.8** | **是**（产物结构变） |
| 14 | 安装包偏大（`compression` 未显式设置） | [`electron-builder`](https://github.com/electron-userland/electron-builder) | v26.15.3（项目已用同版本）· 3,686,274 次/周 | MIT（LICENSE 原文核对） | `build` 段加 `"compression": "maximum"` | 极低：只影响**安装器**（7z）体积 5–15%；**asar 内仍是原样字节**，救不了那 6.6MB 图片 | **否** |
| 15 | 曾想用 Squoosh 做图片管线 | [`@squoosh/lib`](https://github.com/GoogleChromeLabs/squoosh) | v0.5.3 · **仅 9,247 次/周** | Apache-2.0 | — | **不推荐**：维护停滞，能力被 `sharp` 完全覆盖（AVIF/WebP/尺寸/预编译） | — |
| 16 | Electron 安全 checklist 的权威依据 | [Electron Security 文档](https://www.electronjs.org/docs/latest/tutorial/security) · [`ipcMain` 文档](https://www.electronjs.org/docs/latest/api/ipc-main) · [node:sqlite 文档](https://nodejs.org/api/sqlite.html) | — | CC-BY-4.0（文档） | 人工 review checklist | 零 | **否** |

---

## 二、结论：推荐引入（按优先级）

| 优先级 | 开源件 | 一句话理由 | 是否改 exe |
|---|---|---|---|
| P0 | `rollup-plugin-visualizer` | 先量后改；没有它，分包决策全是猜 | 否 |
| P0 | `sharp` | 唯一能把那 49.1%（6.6MB）拿掉的手段 | 否（构建机） |
| P1 | `@electron/fuses` | 补上"程序可被替换"的最后一环；代价是流程变重，建议 1.8.0 一次性做 | **是** |
| P2 | `electron-log`（或 8 行自写） | 生产零日志是当前最影响售后的缺陷 | 否 |
| P3 | `zod`（已存在） | 零成本提升 IPC 边界质量 | 否 |

## 三、结论：明确不引入

| 开源件 | 不引入的理由 |
|---|---|
| `better-sqlite3` | 破坏离线打包链（per-ABI 原生模块），而当前瓶颈不在驱动层 |
| `electron-trpc` | 41 通道全量重写，周下载仅 10,291（生态冷），收益只是类型安全 |
| `@squoosh/lib` | 维护停滞、周下载 9,247，被 `sharp` 完全覆盖 |
| `electron-vite` | 换构建器属 1.8 大版本工程，不应塞进补丁 |

## 四、license 合规提醒

- `sharp` 与 `litestream` 是 **Apache-2.0**：分发时需随包提供 LICENSE 与 NOTICE（本项目已有先例：`package-update.cjs:18` 的 required 清单里就有 `/assets/licenses/recharts-LICENSE.txt`，照同样方式为引入的 Apache-2.0 组件补 `assets/licenses/*-LICENSE.txt`）。
- 其余推荐件均为 **MIT**：保留版权声明即可，通常由 electron-builder 的 `LICENSES.chromium.html` 之外的第三方声明文件覆盖（当前安装目录已有 20,477,229 B 的 `LICENSES.chromium.html`）。
- `electron-log`、`zod`、`rollup-plugin-visualizer`、`svgo` 只在构建期或本地运行，不产生分发义务争议（MIT 仍建议声明）。
