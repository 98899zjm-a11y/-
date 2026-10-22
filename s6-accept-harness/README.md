# s6-accept-harness — 发布前「现网 1.7.0 员工机会不会接受」离线验收

只回答一个问题：**这台已经装了某个 sequence 的 1.7.0 员工机，会不会接受我们准备发布的这份
`native-manifest.json` + `native-package.zip`。**

判定不是我们重新实现一遍规则，而是**把 `F:\自制软件\xjy-jewelry-offline\resources\app.asar` 里真实的
`native-update-manifest.cjs` / `native-publication-update.cjs` 取出来 require 后直接调用**
（`verifyNativeManifest` / `validateManifestPayload` / `publicationDecision`）。客户端改了规则，
本工具跟着变，不存在抄常量抄漂移的问题。

只读：不写生产目录、不改任何已签文件；解包缓存与临时文件只在 `%TEMP%\xjy-s6-accept-asar`。

---

## 一条命令

发布动作之前跑这一条（PowerShell / cmd 都行，纯 node，零依赖）：

```bat
node accept-harness.cjs ^
  --manifest D:\Codex\xjy-release-20261022\candidate\proposal\worker-draft\native-manifest.json ^
  --archive  D:\Codex\xjy-release-20261022\candidate\build-pre-r2-165953\native-package.zip ^
  --installed-sequence 20
```

`--manifest` 是审计器产出的**签名**清单（当前 `publish-seq21\out\` 里还没有这一份，见文末「现状提醒」），
`--archive` 必须和它出自同一次构建；两个路径按实际发布件替换即可，其余全有默认值。

看两处就够：

- **退出码 0 且 `reason` 以 `AVAILABLE:` 开头** → 现网 1.7.0 员工机会把它判成 `available` 并开始下载，可以发布。
- **退出码 0 但 `reason` 是 `LATEST_ALREADY_INSTALLED:`** → 客户端接受清单，但认为「已经是最新」，不会下发。
  对已装同 sequence 的机器这是空操作，不是失败，但也**不构成发布成功**。
- **退出码 2** → 客户端真的会拒（或被本工具在发布前拦下），`reason` 第一段就是拒绝码，`nextAction` 是改法。
- **退出码 1** → 工具自己没法判定（参数错、公钥不是 pin、asar 读不出来），**不是**「客户端会拒」。

`--installed-catalog-sha` 是可选参数：不给时本工具读现网发布清单
`F:\鑫金源珠宝资料\程序设置\员工升级\native-manifest.json` 推断「已装收据」的完整目录摘要，
**且只在它的 sequence 与 `--installed-sequence` 相同时才采信**，否则要求显式传（避免拿错版本的摘要冒充已装状态）。

发行公钥按顺序找：`--public-key-pem` 指定的文件 → 默认路径
`…\candidate\proposal\worker-draft\publisher-public.pem` → **清单同目录 / 上一级目录的 `publisher-public.pem`**。
找到后必须与客户端 pin（SPKI-DER `sha256=6e8b9cad…458c`）一致，否则工具错误。
两处都没有 → 退出码 1 的 `PUBLIC_KEY_MISSING`（`nextAction` 会提示用 `--public-key-pem` 指过去）。
回退到非默认路径时会在 **stderr** 说一句（stdout 始终只有那一个 JSON），例如：

```
[accept-harness] 默认公钥路径不可用，已按清单目录找到：D:\...\publisher-public.pem
```

---

## 参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `--manifest <path>` | 无（必填） | 要发布的 `native-manifest.json`，外层 `{manifest, signature}` |
| `--archive <path>` | 无 | `native-package.zip`，核对 `manifest.archive.size` / `sha256` |
| `--installed-sequence <n>` | `20` | 目标机器已装序号 |
| `--installed-catalog-sha <64hex>` | 无 | 已装收据的 `fullTargetCatalogSha256`；不给则按现网清单推断 |
| `--app-asar <path>` | `F:\自制软件\xjy-jewelry-offline\resources\app.asar` | 现网 asar，客户端规则的唯一权威 |
| `--public-key-pem <path>` | `…\candidate\proposal\worker-draft\publisher-public.pem` | 发行公钥；必须与客户端 pin 一致，否则直接工具错误 |
| `--high-water-sequence <n>` | `0` | 客户端本机记录的最高已见序号（`profile/employee-update-cache/native-sequence.json`） |
| `--now <iso\|ms>` | 当前时间 | 想验「过期」时用 |
| `--live-manifest <path>` | 现网发布清单 | 只读，用来推断已装摘要 |
| `--asar-cache-dir <dir>` | `%TEMP%\xjy-s6-accept-asar` | 解包缓存（同尺寸/mtime 复用，第二次起约 1 秒） |

首次运行会调用 `E:\node\node_modules\npm\bin\npx-cli.js --yes @electron/asar extract-file` 把两个模块取到缓存目录
（`native-update-manifest.cjs` 零依赖可直接用；`native-publication-update.cjs` 依赖同目录多个模块，会自动整包解到
缓存子目录再 require，用于交叉核对）。本机已确认 @electron/asar 可离线用。

## 输出

单个 JSON，字段固定：

```json
{
  "manifestOk": true,          // 清单结构/身份/文件表通过 validateManifestPayload
  "signatureOk": true,         // node:crypto 与客户端模块两边验签结论一致且通过
  "identityOk": true,          // targetVersion/engineVersion 等与 asar 里硬编码一致
  "sequenceGate": { … },       // 客户端 publicationDecision 的输入与结论（verdict: available/latest/null）
  "archiveMatches": true,      // 磁盘上的 zip 与 manifest.archive 的大小+sha256 逐位一致
  "decision": "ACCEPT",        // ACCEPT / REJECT / ERROR
  "reason": "AVAILABLE: …",    // <拒绝码>: <说明>
  "nextAction": "…"            // 人话改法
}
```

`reason` 里的码来自客户端（`BAD_NATIVE_SIGNATURE` / `BAD_NATIVE_MANIFEST` / `EXPIRED_NATIVE_MANIFEST` /
`STALE_NATIVE_MANIFEST`），外加本工具的两个发布前检查项：`BAD_NATIVE_IDENTITY`（身份不符，指出哪个字段）、
`ARCHIVE_MISMATCH`（包对不上）、`ARCHIVE_NOT_PROVIDED`（没给 `--archive`，不算验过）。
两个客户端模块对同一输入判定不一致时抛工具错误 `ASAR_DECISION_INCONSISTENT`（exit 1），不给判定。

## 判定链（与客户端同序）

1. **签名门** — 客户端 `verifyNativeManifest` 先验签名再验正文（`native-update-manifest.cjs:29-31`）。
   本工具用 `node:crypto` 独立再验一次并与客户端对账，不一致直接 exit 1。
2. **清单门** — 直接调 `validateManifestPayload`：键集必须恰好 15 个、`schemaVersion=1`、
   `purpose=xjy-native-employee-update-v1`、`app/platform/arch/role=xjy-jewelry-offline/win32/x64/employee`、
   `sequence≥1`、两个 64hex、`archive.size` 在 22…1610612736、`files` 1…8192 且路径规范不重复、
   合计 ≤3221225472、5 个固定入口齐全、worker 必须 `246302720` / `db3ad206…`、binding 摘要自洽。
3. **身份门** — `targetVersion==='1.7.0'` 且 `engineVersion==='44.9.0'`（`:16`）。这两个值本工具不抄常量，
   而是从**被 require 的那个模块源码**里读出来再比对，所以 asar 换了版本时它会自动跟着变。
4. **序号门** — `publicationDecision`（`:33-37`）：`sequence < 已装` 或 `< highWater` → `STALE`；
   `sequence == 已装` 且目录摘要不同 → `BAD_NATIVE_MANIFEST`（同一序号不许换整包）；摘要相同 → `latest`；
   `sequence < 已装` 之外不升序 → `STALE`；`>` → `available`。
5. **整包摘要门** — 发布前就能拦：磁盘 zip 的 `size`/`sha256` 与清单声明不一致 → `ARCHIVE_MISMATCH`
   （客户端要等 780MB 下载完才在这一步失败）。

## 现网硬约束（都已在真实 asar 上验证）

- 客户端**只认 1.7.0**：`targetVersion`/`engineVersion` 是 `native-update-manifest.cjs:16` 的硬编码。
  发 1.7.1 改清单没用，必须先换客户端那两处，否则任何 1.7.0 员工机都在**序号门之前**就拒（`BAD_NATIVE_IDENTITY`）。
- **序号必须严格递增**，且升序号时 `fullTargetCatalogSha256` 必须换新；只换序号不换摘要 →
  `BAD_NATIVE_MANIFEST`（目标目录与发布序号矛盾）。
- `expiresAt` 必须晚于 `now` 和 `publishedAt`；`publishedAt` 最多超前 5 分钟。没有最大有效期限制
  （现网那份是 90 天：2026-10-22 → 2027-01-20）。
- worker 是写死的 44.7.0 构建（`246302720` 字节 / `db3ad206…`），换引擎要先改客户端。
- 发行公钥被 pin 成 SPKI-DER `sha256=6e8b9cad…458c`；换签名密钥 = 换客户端。

## 局限（重要）

本工具**不打开 zip**。它只核对 zip 整体的 `size`/`sha256`，外加清单自洽（文件表、worker、binding 摘要），
**没有**验证包里每个文件是否真的等于 `files[]` 里声明的摘要 —— 那是打包/审计环节的责任，客户端要等下载完
才逐文件校验。所以本工具通过 ≠ 包内容正确；它保证的是「这份清单+这个包，现网 1.7.0 会不会接受」。
同理它不跑 PowerShell 安装流程，也不验证 binding 里声明的引擎是否真能跑。

## 现状提醒（2026-10-22）

- `candidate\build\` 与 `source\c28-native-publication\` 当前**不存在**（任务描述里的路径）；
  候选包实际在 `candidate\build-pre-r2-165953\native-package.zip`（781517156 字节）。
- `publish-seq21\out\` 里**没有**签名后的 `native-manifest.json`（只有 `catalog.json`、两个 zip、
  `native-manifest-SOURCE.txt`、`SHA256SUMS.txt`）。真正下发前必须先用审计器产出签名清单，
  然后用本工具跑一遍；`--manifest` 指向的就是那个文件。
- `candidate\proposal\worker-draft\` 在 2026-10-22 17:56 被重建掉了（整个 `proposal\` 换成新的
  冻结副本 + `archives\`），所以默认的 `publisher-public.pem` 路径可能暂时不存在 —— 这就是上面
  公钥回退逻辑存在的原因；重建后的提案会把公钥放在清单旁边，回退能自动找到。
- 现网生产清单（sequence=20，目录摘要 `4d78cbba…`）与生产目录里的 `native-package.zip`
  用本工具核对是**全绿 + `latest`**：那份就是当前线上状态，属于「已装即最新」的空操作。

## 已验证（本机实跑）

| 输入 | 结果 |
|---|---|
| 现网清单 seq20 + 生产 `native-package.zip`（781517156 字节，全 3293 文件表）+ 已装 20 | `ACCEPT` / `LATEST_ALREADY_INSTALLED`，exit 0，`archiveMatches=true` |
| 同一 3293 文件表改 seq=21、换目录摘要（模拟值）、发行私钥重签 + 真包 + 已装 20 | `ACCEPT` / `AVAILABLE`，exit 0 —— 说明真实体量的清单能过全部道门 |
| seq19 / seq20 / 1.7.1 / 包摘要错 / 签名被改 | 各自 `STALE` / `STALE` / `BAD_NATIVE_IDENTITY` / `ARCHIVE_MISMATCH` / `BAD_NATIVE_SIGNATURE`，exit 2 |

780MB 包摘要核对约 1~2 秒（热缓存）；asar 解包有缓存，第二次起整次运行约 1 秒。

## matrix.md

`matrix.md` 是判定矩阵，每行都是**实际输出**，分七节：

1. 24 行四维网格（已装 20/21 × 清单 19/20/21 × 1.7.0/1.7.1 × 包匹配/不匹配）
2. 2 行「换序号不换摘要」陷阱
3. 5 行工具边界（签名被改、过期、缺包、公钥非 pin、缺参数）
4. 2 行**真实形态自检**（真 3293 文件表 + 真 781MB 包 + 真 app.asar）
5. 读表要点
6. 代表性完整 JSON
7. 夹具清单与复跑方法

前 26 行用的是**合成**夹具（`TEST-` 前缀，64 字节占位包，用发行私钥真签名），只用于压各道门，
不能替代真实包；第 4 节才是真实体量。
重跑：`node make-matrix.cjs`（需要发行私钥；其公钥必须等于现网 pin，否则脚本拒跑。公钥由私钥现导，
不依赖提案目录的落点）。

## 退出码

| 码 | 含义 |
|---|---|
| 0 | 客户端接受这份清单（`reason` 区分 `AVAILABLE` 能下发 / `LATEST_ALREADY_INSTALLED` 无需下发） |
| 2 | 客户端会拒（或发布前被拦：`ARCHIVE_MISMATCH` / `ARCHIVE_NOT_PROVIDED` / `BAD_NATIVE_IDENTITY`） |
| 1 | 工具错误（参数、公钥不是 pin、asar 缺失/解不出、两个客户端模块判定不一致） |
