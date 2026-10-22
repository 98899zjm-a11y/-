# target-21 发布链改造：现成输入与改动清单

## 已产出并验签的输入（本轮完成）
| 文件 | 用途 | 字节 | sha256 | 签名 |
| --- | --- | --- | --- | --- |
| `seq21-inputs/source20.catalog.json` | 新源目录（复用已签 target20 的 1079 行，sequence 20） | 230,255 | `4d78cbbac07b05f267fabb870a10376a2c1158a8b4623ba4ea35d3334cb828ef` | 自带 envelope |
| `seq21-inputs/source20.envelope.json` | 对应签名信封 | 246,632 | `6abc30889f4f79cd9313cf4480d805742d695b51da0846ad129b9fbaff6f10cf` | 已用 publisher 公钥验证 = true |
| `seq21-inputs/target21.catalog.json` | 新目标目录（同 1079 行，sequence 21，新时间戳） | 230,254 | `b415a4e96c321dca805aca3eae429a9821dc5eb660a3b504ebbbeebd49264d98` | 现场用 issuer 私钥签 |
| `seq21-inputs/target21.envelope.json` | 对应签名信封 | 246,639 | `59f6e0ede1f710a9edae74f4150ae0c1db2739481cf80ec3c17ee0a18a9a87b6` | 已用 publisher 公钥验证 = true |

生成脚本：`make-seq21-inputs.cjs`（读 `candidate/proposal/requests/target.catalog.json` 与 `candidate/approvals/target.catalog-envelope.json`，只改 `sequence/publishedAt/expiresAt` 后重新签）。

## 需要改的代码点（`source/prepare-release.cjs`，共 23 处命中）
- `:24 const SLOT_SOURCE_PIN` → source20 的 payload sha `4d78cbba…`
- `:108 verifySlotSourceCatalog` → `c.sequence===19` 改 `===20`、`SEQUENCE.target!==20` 改 `!==21`、报错文案
- `:138 const SOURCE19{payloadSha256:SLOT_SOURCE_PIN, envelopeSha256:'53f6fa70…'}` → 换成 source20 的 `4d78cbba…` / `6abc3088…`
- `:144 verifySource19Envelope` 的 pin 与 `sequence:19,files:1079` 元数据
- `:150 const TARGET20_REUSE{payloadSha256:'4d78cbba…', envelopeSha256:'6abc3088…'}` → 换成 target21 的 `b415a4e9…` / `59f6e0ed…`
- `:156-165 SIGNATURE_REQUIREMENTS`：`target.catalog` 从 `EXACT_PUBLIC_SIGNATURE_REUSE` 改为“新签名”；`typed-source19` → `typed-source20`
- `:15 const SEQUENCE{target:20}` → `21`
- `:116 verifyA11TargetReuse` 已是“只允许 sequence/publishedAt/expiresAt 变化”的先例，可照抄该形状写 `verifySource20Reuse`

## 执行顺序（下一轮）
1. 改上述 23 处 → 跑 `prepare`（第 2 步）直到通过；
2. 让 derive-worker-signer 生成的新 `target.catalog` 请求指向 `target21.envelope.json`（该签名已存在，直接绑定）；
3. 把 r2 的 `app.asar` 作为新 proposal 修订注入（新 `proposal-manifest.json` + 新 signing requests）；
4. 完整 `run-build` → 审计（`FINAL_ARCHIVE_SHA` 会随构建重算）→ `run-finalize` 外签；
5. 发布 `native-manifest`（sequence 21）→ 1.7.0 员工机实测 → 再发 1.7.1 测试清单。
