# 开源候选清单 — 鑫金源珠宝 1.7.0 优化

> 关联：`OPTIMIZATION_REPORT.md`（问题与量化）、`quick-wins.md`（当天可做）。
> **可信度声明**：本环境 `web_fetch` 对 `github.com` / `api.github.com` 返回 `resolves to a non-public IP address`（出口被拦），**star 与 license 均无法直接核实**。下表 stars 只给量级并统一标注"未核实"；license 取自仓库公开 README / 生态索引（deps.dev、packages.ecosyste.ms、npm、socket.dev）的摘要，**采用前必须人工打开 LICENSE 文件复核**。
> 判定口径：**采纳** = 建议本版本引入；**借思路** = 只参考设计不引入依赖；**排除** = 与红线冲突或性价比不成立。本项目 `desktop\package.json` 的 `dependencies` 为 `[]`（零运行时依赖），任何新增运行时依赖都要按"最高风险"对待。

---

## 1. 大目录树哈希 / 合并摘要

| 问题 | 仓库 | stars 量级 | license | 引入方式 | 风险 |
|---|---|---|---|---|---|
| 逐文件单线程哈希，无并行扇出 | [BLAKE3-team/BLAKE3](https://github.com/BLAKE3-team/BLAKE3) | ~4k（未核实） | CC0-1.0 / Apache-2.0 双许可（未核实） | **借思路**：不替换 sha256；用 `worker_threads` 池 4–8 线程分批跑 `crypto.createHash('sha256')` | 低。真正替换摘要算法会**改变数据格式**（红线）；仅并行化则摘要逐字节不变 |
| 目录遍历两次（files 与 directories 分开收集） | [BurntSushi/walkdir](https://github.com/BurntSushi/walkdir) | ~1.5k（未核实） | MIT / Unlicense（未核实） | **借思路**：`inspectArtifactTree` 单遍同时返回 `files[]` 与 `directories[]` | 极低。新增字段，不改 `sha256` 计算 |
| 需要"哪些文件变了"的快速定位 | [merkletreejs/merkletreejs](https://github.com/merkletreejs/merkletreejs) | ~1.4k（未核实） | MIT（未核实） | **借思路**：做本地**旁路**变更索引（不入签名、不入 journal） | 中。若误当受信摘要会削弱安全性；只能做诊断 |
| 需要独立复核树摘要是否正确 | [dirsum](https://www.npmjs.com/package/dirsum) · [socket 分析](https://socket.dev/npm/package/dirsum) | 极小（未核实） | 未核实 | **采纳（仅审计工具）**：离线复算 `path\0size\0sha256` 拼接摘要，与 `treeSha256` 对照 | 极低。不进入运行时 |
| 大目录树哈希的并发上限 | [nodejs/node `crypto`](https://github.com/nodejs/node) | — | MIT | 直接用内置 | 无 |

---

## 2. 原子目录替换 / 事务式更新

| 问题 | 仓库 | stars 量级 | license | 引入方式 | 风险 |
|---|---|---|---|---|---|
| 单文件原子替换的回滚语义 | [inconshreveable/go-update](https://github.com/inconshreveable/go-update) | ~3.8k（未核实） | Apache-2.0（未核实） | **借思路**：保留旧句柄 + rename + 失败回滚，加固现有 `:1089` 回退路径 | 低。本项目 journal 已是其超集 |
| 版本目录 + 单一指针切换（省一次整树 rename） | [velopack/velopack](https://github.com/velopack/velopack) | ~3k（未核实） | MIT（未核实） | **借思路**：2.0 版本再考虑改布局 | 高。改目录布局 = 破坏现有数据/签名格式（红线） |
| 同上的对照实现（桩 exe 模型） | [Squirrel/Squirrel.Windows](https://github.com/Squirrel/Squirrel.Windows) | ~6k（未核实） | MIT（未核实） | **仅对照** | 项目已停止维护 |
| 差分补丁（165 MB → ~10 MB） | [electron-updater](https://github.com/electron-userland/electron-builder/tree/master/packages/electron-updater) | 随 electron-builder ~13k（未核实） | MIT（未核实） | **排除运行时**（需联网）；**借 `blockmap` 格式**做离线 delta（P2） | 中高。新包格式，需重签与新校验逻辑 |
| 原子写文件（journal/status 小文件） | [npm/write-file-atomic](https://github.com/npm/write-file-atomic) | ~1k（未核实） | ISC（未核实） | **排除**（当前 `openChecked 'wx+'` + `fsync` **更强**） | — |

---

## 3. 签名与验签

| 问题 | 仓库 | stars 量级 | license | 引入方式 | 风险 |
|---|---|---|---|---|---|
| 发布回执 / 审计签名文件格式 | [jedisct1/minisign](https://github.com/jedisct1/minisign) | ~1.2k（未核实） | ISC（未核实） | **采纳（离线外部工具）**：用其四行文本签名格式承载发布记录，与现有 catalog 并存 | 极低。完全离线，不动运行时 |
| 元数据角色分离 / 过期 / 防回滚 | [theupdateframework/specification](https://github.com/theupdateframework/specification) | ~1k（未核实） | MIT（未核实） | **借规范**：补 `expires` + 独立 timestamp 角色 | 中。需引擎改动 → 重签 |
| TUF 的参考实现（校验语义对照） | [theupdateframework/python-tuf](https://github.com/theupdateframework/python-tuf) | ~1.2k（未核实） | MIT / Apache-2.0（未核实） | **仅对照**（Python，不入交付） | 低 |
| 无密钥签名 + 透明日志 | [sigstore/cosign](https://github.com/sigstore/cosign) | ~5k（未核实） | Apache-2.0（未核实） | **排除**：依赖 Fulcio/Rekor 在线服务，违反离线红线 | 高 |
| 高层加密 API | [jedisct1/libsodium](https://github.com/jedisct1/libsodium) | ~13k（未核实） | ISC（未核实） | **排除**：Node 内置 `crypto` 已支持 Ed25519 | 中（徒增体积与重签面） |

---

## 4. Electron 打包 / 体积 / 启动

| 问题 | 仓库 | stars 量级 | license | 引入方式 | 风险 |
|---|---|---|---|---|---|
| asar / 压缩级别 / files 白名单 | [electron-builder](https://github.com/electron-userland/electron-builder) | ~13.7k（未核实） | MIT（未核实） | **采纳（已用，调参）**：核对 [`compression`](https://www.electron.build/docs/api/app-builder-lib.typealias.compressionlevel/) 与 `files` | 低。`maximum` 会拉长首启解压，与"安装快"冲突 → 建议 `normal` |
| asar 内部体积审计 | [electron/asar](https://github.com/electron/asar) | ~1k（未核实） | MIT（未核实） | **采纳（devDependency，仅审计）** | 极低。不随产品发布 |
| V8 编译缓存落盘，二次启动提速 | [zertosh/v8-compile-cache](https://github.com/zertosh/v8-compile-cache) | ~1.4k（未核实） | MIT（未核实） | **可选采纳**：缓存写 `profileDir`（已可写） | 低—中。收益 5–15%（~50–120 ms），需重签（进 asar） |
| JS → V8 bytecode，防源码 + 提速 | [bytenode/bytenode](https://github.com/bytenode/bytenode) | ~2.7k（未核实） | MIT（未核实） | **排除** | 高。bytecode 绑定 Electron/V8 精确版本；`.jsc` 需 `asarUnpack`；破坏代码可审计性 |
| 无头 Chromium 打印/截图 | [puppeteer/puppeteer](https://github.com/puppeteer/puppeteer) | ~89k（未核实） | Apache-2.0（未核实） | **排除**：+150 MB，与 Electron 内置 Chromium 重复 | 高（体积） |
| 安装包体积（NSIS 压缩） | [NSIS](https://sourceforge.net/projects/nsis/) | — | zlib/libpng（未核实） | 已由 electron-builder 使用 | 低 |

---

## 5. SQLite 本地库与备份 / 迁移

> 现状：`desktop\package.json` `dependencies: []`，业务数据为 JSON 文件 + 自带 `business-*-backup` 校验链。**本版本结论：一个都不引入，只借备份思路。**

| 问题 | 仓库 | stars 量级 | license | 引入方式 | 风险 |
|---|---|---|---|---|---|
| 需要真正的关系库（未来） | [WiseLibs/better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | ~12k（未核实） | MIT（未核实） | **仅新增旁路库**（如打印任务历史），**不得迁移既有 JSON** | 高。首个 native 依赖：`electron-rebuild` + ABI 绑 Electron 44 + `asarUnpack` |
| 零依赖 SQLite | [node:sqlite](https://nodejs.org/api/sqlite.html) | — | Node 许可（MIT） | 若 Electron 44 的 Node ≥ 22 可用；**旁路库限定** | 中。API 仍标 experimental，跨 Electron 升级有断裂风险 |
| 持续复制到对象存储 | [benbjohnson/litestream](https://github.com/benbjohnson/litestream) | ~11k（未核实） | Apache-2.0（未核实） | **排除**（需 S3/联网）；**借思路**：本地 `VACUUM INTO` 快照 + checkpoint + 摘要并入 data proof | 低（纯思路） |
| SQLite 绑定横评选型 | [node-sqlite 对比文档](https://photostructure.github.io/node-sqlite/documents/library-comparison.html) | — | — | **仅参考** | 无 |
| 备份一致性（当前方案） | 本项目 `desktop\business-daily-backup.cjs`、`business-erp-backup-integrity.cjs` | — | — | **保持**（与 JSON 单一事实源一致） | 无 |

---

## 6. 打印模板（HTML → PDF）

> 现状：`desktop\main.cjs:196`（自定义纸张）与 `:213`（A4 + `preferCSSPageSize`）已用 Electron `webContents.printToPDF`。**这是正确的技术选型，不要换引擎。**

| 问题 | 仓库 | stars 量级 | license | 引入方式 | 风险 |
|---|---|---|---|---|---|
| 复杂页眉页脚 / 页码 / 跨页表格断行 | [pagedjs/pagedjs](https://github.com/pagedjs/pagedjs) | ~2.6k（未核实） | MIT（未核实） | **可选采纳（P2）**：打包进 renderer，纯离线 | 中。改造 `print-worker-templates.tsx`/`warranty-quotation.tsx`，需重签 |
| `printToPDF` 参数（`scale`/`margins`/`preferCSSPageSize`） | [Electron 文档](https://www.electronjs.org/docs/latest/api/structures/print-to-pdf-options) | — | MIT | **采纳（已用，补参）** | 极低 |
| CSS 分页规范（`break-inside`/`@page`） | [W3C CSS Paged Media](https://www.w3.org/TR/css-page-3/) | — | W3C 文档许可 | **采纳（规范依据）** | 无 |
| 老 Qt WebKit 转 PDF | [wkhtmltopdf/wkhtmltopdf](https://github.com/wkhtmltopdf/wkhtmltopdf) | ~5k（未核实） | LGPLv3（未核实） | **排除**：停更、CJK/分页坑、+60 MB、LGPL 传染 | 高 |
| 独立 Chromium 打印 | [puppeteer/puppeteer](https://github.com/puppeteer/puppeteer) | ~89k（未核实） | Apache-2.0（未核实） | **排除**：与 Electron 内置 Chromium 重复 | 高（体积） |

---

## 7. 结构 / 架构（版本号集中化、单一来源、错误码表）

| 问题 | 方案 / 仓库 | stars 量级 | license | 引入方式 | 风险 |
|---|---|---|---|---|---|
| `'1.7.0'` 硬编码多处 | 构建期 `define` 注入（esbuild 内置） | — | MIT | **采纳**：`desktop\package.json:3` 为唯一源；替换 `cashier-adapter.cjs:39`、`engine-startup-gate.cjs:52` | 低。需重签 |
| 错误码散落（`u.fail('CODE')` / `requireValue(cond,'CODE')`） | 自建 `errors.cjs` 码表 + CI 扫描脚本 | — | — | **采纳**：`CODE → {含义, 严重度, 用户提示, 处置}` | 中。改动面广（引擎全文件），需重签 |
| 错误码可读化 | [sindresorhus/errno](https://github.com/sindresorhus/errno) | ~1.3k（未核实） | MIT（未核实） | **借思路**（不引入，守零依赖） | 极低 |
| 配置 schema 校验 | [mozilla/node-convict](https://github.com/mozilla/node-convict) · [colinhacks/zod](https://github.com/colinhacks/zod) | ~2.4k / ~38k（未核实） | MIT（未核实） | **暂排除**：配置项少，手写校验足够 | 中（破零依赖） |
| 结构化日志 | [pinojs/pino](https://github.com/pinojs/pino) | ~15k（未核实） | MIT（未核实） | **暂排除**：当前控制台同步写不是瓶颈；若引入须先解决"日志落盘与 proof 目录互斥" | 中 |

---

## 8. 汇总：值得动手的与明确不动的

**值得（按性价比）**

1. `dirsum` 类离线复核脚本（零风险，立即可用）——验证现有 `treeSha256` 计算是否符合预期。
2. minisign 发布回执（零风险，纯外部）——给每份交付包一份可离线验证的"谁签的、签了什么"。
3. electron-builder `compression` / `files` 调参 + `@electron/asar` 体积审计（低风险，需重签一次）。
4. paged.js（P2，仅当打印模板继续变复杂）。
5. v8-compile-cache（可选，收益小但成本低）。

**明确不动（并说明为什么，避免以后重复讨论）**

| 排除项 | 理由 |
|---|---|
| BLAKE3 / 任何摘要算法替换 | 改变数据格式 = 破签名链与历史数据 |
| better-sqlite3 / node:sqlite（本版本） | 破零依赖、破"JSON 单一事实源"，数据量级收益不可感知 |
| cosign / TUF 运行时 / electron-updater 运行时 | 需联网，违反离线红线 |
| litestream | 需 S3 |
| bytenode | 绑定 V8 版本 + 破坏可审计性，收益与风险不成比例 |
| puppeteer / wkhtmltopdf | 与 Electron 内置打印重复，体积/LGPL 风险 |
| convict / zod / pino | 收益不足以破零依赖 |
