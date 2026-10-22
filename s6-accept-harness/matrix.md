# 判定矩阵（真实输出）

本表每一行都是 `node accept-harness.cjs …` 的**实际输出**，由 `node make-matrix.cjs` 自动生成。
判定权在现网 app.asar 里的 `native-update-manifest.cjs` / `native-publication-update.cjs`，本工具没有重写任何一条规则。

- 现网已装（sequence 20）完整目录摘要 `4d78cbbac07b05f267fabb870a10376a2c1158a8b4623ba4ea35d3334cb828ef`（来源：现网发布清单 sequence=20）
- 本次候选发布的完整目录摘要 `0ac6a0b0c8131a8082f04cfa98e3459e2fbde7bd4ec2b945b61ecbc4ee80ad95`，即夹具里的「新 sha」
- 「已装 21」一行组按定义把已装摘要设为新 sha（= 这台机器已经装过 seq21 那一版）
- 夹具清单 64 字节占位包：`TEST-archive-ok.bin`（摘要与清单一致）/ `TEST-archive-wrong.bin`（同尺寸、不同摘要）

## 1. 四维网格（installed 20/21 × sequence 19/20/21 × targetVersion 1.7.0/1.7.1 × archive 匹配/不匹配）

| # | 已装 seq | 清单 seq | targetVersion | archive | 退出码 | manifestOk | signatureOk | identityOk | 序号门 verdict | decision | reason 代码 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 20 | 19 | 1.7.0 | 匹配 | 2 | true | true | true | null | REJECT | `STALE_NATIVE_MANIFEST` |
| 2 | 20 | 19 | 1.7.0 | 同尺寸错摘要 | 2 | true | true | true | null | REJECT | `STALE_NATIVE_MANIFEST` |
| 3 | 20 | 19 | 1.7.1 | 匹配 | 2 | false | true | false | null | REJECT | `BAD_NATIVE_IDENTITY` |
| 4 | 20 | 19 | 1.7.1 | 同尺寸错摘要 | 2 | false | true | false | null | REJECT | `BAD_NATIVE_IDENTITY` |
| 5 | 20 | 20 | 1.7.0 | 匹配 | 2 | true | true | true | null | REJECT | `STALE_NATIVE_MANIFEST` |
| 6 | 20 | 20 | 1.7.0 | 同尺寸错摘要 | 2 | true | true | true | null | REJECT | `STALE_NATIVE_MANIFEST` |
| 7 | 20 | 20 | 1.7.1 | 匹配 | 2 | false | true | false | null | REJECT | `BAD_NATIVE_IDENTITY` |
| 8 | 20 | 20 | 1.7.1 | 同尺寸错摘要 | 2 | false | true | false | null | REJECT | `BAD_NATIVE_IDENTITY` |
| 9 | 20 | 21 | 1.7.0 | 匹配 | 0 | true | true | true | available | ACCEPT | `AVAILABLE` |
| 10 | 20 | 21 | 1.7.0 | 同尺寸错摘要 | 2 | true | true | true | available | REJECT | `ARCHIVE_MISMATCH` |
| 11 | 20 | 21 | 1.7.1 | 匹配 | 2 | false | true | false | null | REJECT | `BAD_NATIVE_IDENTITY` |
| 12 | 20 | 21 | 1.7.1 | 同尺寸错摘要 | 2 | false | true | false | null | REJECT | `BAD_NATIVE_IDENTITY` |
| 13 | 21 | 19 | 1.7.0 | 匹配 | 2 | true | true | true | null | REJECT | `STALE_NATIVE_MANIFEST` |
| 14 | 21 | 19 | 1.7.0 | 同尺寸错摘要 | 2 | true | true | true | null | REJECT | `STALE_NATIVE_MANIFEST` |
| 15 | 21 | 19 | 1.7.1 | 匹配 | 2 | false | true | false | null | REJECT | `BAD_NATIVE_IDENTITY` |
| 16 | 21 | 19 | 1.7.1 | 同尺寸错摘要 | 2 | false | true | false | null | REJECT | `BAD_NATIVE_IDENTITY` |
| 17 | 21 | 20 | 1.7.0 | 匹配 | 2 | true | true | true | null | REJECT | `STALE_NATIVE_MANIFEST` |
| 18 | 21 | 20 | 1.7.0 | 同尺寸错摘要 | 2 | true | true | true | null | REJECT | `STALE_NATIVE_MANIFEST` |
| 19 | 21 | 20 | 1.7.1 | 匹配 | 2 | false | true | false | null | REJECT | `BAD_NATIVE_IDENTITY` |
| 20 | 21 | 20 | 1.7.1 | 同尺寸错摘要 | 2 | false | true | false | null | REJECT | `BAD_NATIVE_IDENTITY` |
| 21 | 21 | 21 | 1.7.0 | 匹配 | 0 | true | true | true | latest | ACCEPT | `LATEST_ALREADY_INSTALLED` |
| 22 | 21 | 21 | 1.7.0 | 同尺寸错摘要 | 2 | true | true | true | latest | REJECT | `ARCHIVE_MISMATCH` |
| 23 | 21 | 21 | 1.7.1 | 匹配 | 2 | false | true | false | null | REJECT | `BAD_NATIVE_IDENTITY` |
| 24 | 21 | 21 | 1.7.1 | 同尺寸错摘要 | 2 | false | true | false | null | REJECT | `BAD_NATIVE_IDENTITY` |

## 2. 补充：换 sequence 却不换完整目录摘要（真实陷阱）

| # | 已装 seq | 清单 seq | targetVersion | archive | 退出码 | 序号门 verdict | decision | reason 代码 |
|---|---|---|---|---|---|---|---|---|
| T1 | 20 | 21 | 1.7.0 + 旧 sha | 匹配 | 2 | null | REJECT | `BAD_NATIVE_MANIFEST` |
| T2 | 21 | 21 | 1.7.0 + 旧 sha | 匹配 | 2 | null | REJECT | `STALE_NATIVE_MANIFEST` |

## 3. 工具自身边界（拒绝码能不能分清，以及工具错误长什么样）

| 场景 | 退出码 | decision | 实际 reason 代码 | 期望 |
|---|---|---|---|---|
| 签名被改一个字符 | 2 | REJECT | `BAD_NATIVE_SIGNATURE` | ✅ `BAD_NATIVE_SIGNATURE` / exit 2 |
| 清单已过期（--now 2028） | 2 | REJECT | `EXPIRED_NATIVE_MANIFEST` | ✅ `EXPIRED_NATIVE_MANIFEST` / exit 2 |
| 没给 --archive | 2 | REJECT | `ARCHIVE_NOT_PROVIDED` | ✅ `ARCHIVE_NOT_PROVIDED` / exit 2 |
| 公钥不是客户端 pin 的那把 | 1 | ERROR | `BAD_PUBLIC_KEY` | ✅ `BAD_PUBLIC_KEY` / exit 1 |
| 缺 --manifest（工具错误） | 1 | ERROR | `BAD_ARGS` | ✅ `BAD_ARGS` / exit 1 |

退出码 1 = 工具自己没法判定（参数/公钥/asar 读不出来），**不是**「客户端会拒」；退出码 2 才是客户端真会拒。

## 4. 真实形态自检（真清单 3293 个文件 + 真 781MB 包 + 真 app.asar）

| # | 清单 | 已装 seq | 退出码 | 序号门 verdict | archiveMatches | decision | reason 代码 |
|---|---|---|---|---|---|---|---|
| R1 | 现网清单 seq20 + 真实包 | 20 | 0 | latest | true | ACCEPT | `LATEST_ALREADY_INSTALLED` |
| R2 | 模拟 seq21（真实 3293 文件表 + 新目录摘要）+ 真实包 | 20 | 0 | available | true | ACCEPT | `AVAILABLE` |

R1 是**现在线上那份**：把生产清单拿去问生产已装状态，答案必然是 `latest`（同序号同目录摘要），
它的价值是证明「整条链在真 781MB 包上跑通、摘要逐位对上」，而不是证明有更新可下。
R2 是**发布形态**：现网 3293 个文件的清单、序号改 21、目录摘要换成新的、用发行私钥重签，
配真实 781MB 包 → `available`。它证明的是清单结构与各道门本身没问题；
R2 里那个新目录摘要（`0835174da0ab7e1b5a650719d6946131c53c12e93a5ed4fe947c77e93fca4b6c`）是**模拟值**，真实发布必须由审计器算出真实的完整目标目录摘要。

## 5. 读表要点

- **能真正下发（available）的路只有一条**：`已装 20 + 清单 seq21 + 1.7.0 + 新目录摘要 + 整包匹配` → `ACCEPT` / `AVAILABLE`，退出码 0。
- 序号不升（seq19）→ `STALE_NATIVE_MANIFEST`，退出码 2：客户端连下载都不会开始。
- 序号不升但换了目录摘要（seq20 + 新 sha）→ `STALE_NATIVE_MANIFEST`：同一序号不允许替换完整程序。
- targetVersion 写成 1.7.1 → `BAD_NATIVE_IDENTITY`，**先于**序号门发生：现网客户端硬编码只认 1.7.0，改清单没用，必须换客户端。
- 已装 21 的机器再收到 seq21（同 sha）→ `LATEST_ALREADY_INSTALLED`，退出码 0：**ACCEPT 但不下发**，客户端认为已经装过（工具用它表示"接受清单、无更新可做"）。
- archive 同尺寸但摘要不对 → `ARCHIVE_MISMATCH`，退出码 2：这类错误只有本工具（发布前）能拦，客户端要等整包下载完才发现。
- 1.7.1 的行里 archive 维度不起作用，这是**真实优先级**：payload/身份门在整包摘要门之前。

## 6. 代表性完整输出

### 可以下发（ACCEPT / AVAILABLE）

```json
{
  "manifestOk": true,
  "signatureOk": true,
  "identityOk": true,
  "sequenceGate": {
    "installedSequence": 20,
    "installedCatalogSha256": "4d78cbbac07b05f267fabb870a10376a2c1158a8b4623ba4ea35d3334cb828ef",
    "installedShaSource": "arg",
    "manifestSequence": 21,
    "manifestCatalogSha256": "0ac6a0b0c8131a8082f04cfa98e3459e2fbde7bd4ec2b945b61ecbc4ee80ad95",
    "highWaterSequence": 0,
    "verdict": "available",
    "accepted": true,
    "code": null,
    "message": null
  },
  "archiveMatches": true,
  "decision": "ACCEPT",
  "reason": "AVAILABLE: sequence=21 > 已装 20，且 fullTargetCatalogSha256 已更换：客户端会判 available 并开始下载",
  "nextAction": "可以发布：客户端会把这份清单判为 available 并开始分块下载，交给受信原生助手。"
}
```

### 序号太旧（REJECT / STALE）

```json
{
  "manifestOk": true,
  "signatureOk": true,
  "identityOk": true,
  "sequenceGate": {
    "installedSequence": 20,
    "installedCatalogSha256": "4d78cbbac07b05f267fabb870a10376a2c1158a8b4623ba4ea35d3334cb828ef",
    "installedShaSource": "arg",
    "manifestSequence": 19,
    "manifestCatalogSha256": "0ac6a0b0c8131a8082f04cfa98e3459e2fbde7bd4ec2b945b61ecbc4ee80ad95",
    "highWaterSequence": 0,
    "verdict": null,
    "accepted": false,
    "code": "STALE_NATIVE_MANIFEST",
    "message": "该原生发布已被较新的发布取代"
  },
  "archiveMatches": true,
  "decision": "REJECT",
  "reason": "STALE_NATIVE_MANIFEST: 该原生发布已被较新的发布取代",
  "nextAction": "sequence 必须严格大于已装 sequence（--installed-sequence）：要下发更新就得提升 sequence，并让 fullTargetCatalogSha256 指向真实的完整目标目录。"
}
```

### targetVersion 不是 1.7.0（REJECT / 身份）

```json
{
  "manifestOk": false,
  "signatureOk": true,
  "identityOk": false,
  "sequenceGate": {
    "installedSequence": 20,
    "installedCatalogSha256": "4d78cbbac07b05f267fabb870a10376a2c1158a8b4623ba4ea35d3334cb828ef",
    "installedShaSource": "arg",
    "manifestSequence": 21,
    "manifestCatalogSha256": "0ac6a0b0c8131a8082f04cfa98e3459e2fbde7bd4ec2b945b61ecbc4ee80ad95",
    "highWaterSequence": 0,
    "verdict": null,
    "accepted": false,
    "code": null,
    "message": null
  },
  "archiveMatches": true,
  "decision": "REJECT",
  "reason": "BAD_NATIVE_IDENTITY: 原生员工更新身份不符｜targetVersion: 清单是 \"1.7.1\"，客户端要求 \"1.7.0\"",
  "nextAction": "现网 1.7.0 客户端硬校验 targetVersion=1.7.0 且 engineVersion=44.9.0（native-update-manifest.cjs:16）。要发布 1.7.1 必须先用新的客户端替换这两处硬编码，否则任何 1.7.0 员工机都会拒绝这份清单。"
}
```

### 陷阱：seq21 沿用旧目录摘要（REJECT）

```json
{
  "manifestOk": true,
  "signatureOk": true,
  "identityOk": true,
  "sequenceGate": {
    "installedSequence": 20,
    "installedCatalogSha256": "4d78cbbac07b05f267fabb870a10376a2c1158a8b4623ba4ea35d3334cb828ef",
    "installedShaSource": "arg",
    "manifestSequence": 21,
    "manifestCatalogSha256": "4d78cbbac07b05f267fabb870a10376a2c1158a8b4623ba4ea35d3334cb828ef",
    "highWaterSequence": 0,
    "verdict": null,
    "accepted": false,
    "code": "BAD_NATIVE_MANIFEST",
    "message": "目标目录与发布序号矛盾"
  },
  "archiveMatches": true,
  "decision": "REJECT",
  "reason": "BAD_NATIVE_MANIFEST: 目标目录与发布序号矛盾",
  "nextAction": "按现网契约修正清单结构：schemaVersion=1、purpose=xjy-native-employee-update-v1、app/platform/arch/role=xjy-jewelry-offline/win32/x64/employee，文件表须含固定维护入口，worker 必须是 246302720 / db3ad206…，bindingSha256 必须等于 engine-native170-binding.json 的摘要。"
}
```

## 7. 夹具与复跑

夹具目录：`C:\Users\ADMINI~1\AppData\Local\Temp\xjy-s6-accept-fixtures`

| 夹具 | 说明 |
|---|---|
| `TEST-seq19-1.7.0.json` | sequence=19, targetVersion=1.7.0, 新目录摘要 |
| `TEST-seq19-1.7.1.json` | sequence=19, targetVersion=1.7.1, 新目录摘要 |
| `TEST-seq20-1.7.0.json` | sequence=20, targetVersion=1.7.0, 新目录摘要 |
| `TEST-seq20-1.7.1.json` | sequence=20, targetVersion=1.7.1, 新目录摘要 |
| `TEST-seq21-1.7.0.json` | sequence=21, targetVersion=1.7.0, 新目录摘要 |
| `TEST-seq21-1.7.1.json` | sequence=21, targetVersion=1.7.1, 新目录摘要 |
| `TEST-seq21-1.7.0-oldsha.json` | sequence=21, targetVersion=1.7.0, 沿用旧目录摘要 |

另有几个配套文件（不是清单，别拿去发布）：

| 文件 | 用途 |
|---|---|
| `TEST-issuer-public.pem` | 由发行私钥现导的公钥（等于现网 pin），矩阵所有行都用它验签 |
| `TEST-tampered-signature.json` | 签名被改一个字符，用来确认签名门单独可辨（第 3 节） |
| `TEST-throwaway-public.pem` | 随机新生成的公钥，用来确认「公钥非 pin」是工具错误而非拒绝（第 3 节） |
| `TEST-archive-ok.bin` / `TEST-archive-wrong.bin` | 64 字节占位包，同尺寸不同摘要（第 1、2 节） |
| `simulated-seq21-manifest.json` | 现网真清单改 seq=21 + 换目录摘要后重签，配真实 781MB 包（第 4 节 R2） |

复跑：`node make-matrix.cjs`（需要发行私钥；夹具与 matrix.md 都会重新生成）。
夹具是**合成**的：`files[]` 里只有 worker/binding/固定入口的声明，archive 是 64 字节占位包。
它们只能证明各道门的判定，不能替代真实 780MB 包的摘要核对——那一步用 README 里的真实命令。
