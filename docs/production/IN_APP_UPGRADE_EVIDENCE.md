# 软件内升级：验收规则实测证据（2026-10-22 17:5x）

## 用现网 1.7.0 客户端自身模块实测（未改生产、未改包）

取证脚本：`seq-acceptance.cjs`、`seq-acceptance2.cjs`、`r2-gate.cjs`
模块来源：`F:\自制软件\xjy-jewelry-offline\resources\app.asar` 解出的 `native-update-manifest.cjs`（原始）与 `_dsh/native-publication-update.patched.cjs`（r2 补丁）
证据文件：`evidence-c6-failed-170/seq-acceptance2.json`、`evidence-c6-failed-170/r2-version-gate.json`

### 1) 发布序号规则（`publicationDecision`，已装 sequence=20）
| 用例 | 结果 |
| --- | --- |
| 同序号 20 + 相同目录摘要 | `latest` |
| 同序号 20 + 新目录摘要 | **`STALE_NATIVE_MANIFEST` 同一发布序号不能替换完整程序** |
| 序号 21 + 新目录摘要 | `available` |
| 序号 19 + 新目录摘要 | `STALE_NATIVE_MANIFEST` 已被较新发布取代 |

结论：**r2 只有抬到 sequence ≥ 21 才能通过软件内下发**；同序号替换被客户端设计性拒绝。

### 2) 版本身份规则（`validateManifestPayload`）
| 用例 | 结果 |
| --- | --- |
| targetVersion = 1.7.0 | 通过身份校验（继续走固定入口检查） |
| targetVersion = 1.7.1 / 1.7.2 | **`BAD_NATIVE_MANIFEST` 原生员工更新身份不符** |

结论：现网 1.7.0 客户端**只接受 targetVersion=1.7.0** 的原生发布，因此"直接发 1.7.1"在 1.7.0 机器上必然失败——必须先让机器装上 r2（版本判定改为"以清单为准"）。

### 3) r2 补丁的版本闸门（已解出的补丁模块实测）
`versionAtLeast(v,'1.7.0')`：`1.6.2=false`、`1.7.0=true`、`1.7.1=true`、`2.0.0=true`

结论：r2 客户端逻辑本身正确——装上 r2 之后，1.7.1/1.7.2… 都能进入升级入口。

## 构建链侧约束（只读确认）
- `source/prepare-release.cjs:108` `verifySlotSourceCatalog` 要求 `c.sequence===19 && c.files.length===1079 && SEQUENCE.target===20`。
- `:138` `SOURCE19` 的 payload/envelope 摘要被硬钉（`53f6fa70…`）。
- `:150` `TARGET20_REUSE` 硬钉 payload `4d78cbba…` / envelope `6abc3088…`。
- `:161` `target.catalog` 的签署状态是 `EXACT_PUBLIC_SIGNATURE_REUSE`（复用既有公开签名）。

结论：把序号抬到 21 等于**新的 target 目录 + 新签名 + 新 typed source 链**，属于一次新的信任链修订，不是常量微调。

## 下一步（下一轮执行）
1. 以现有 target20 目录（1079 行、sequence 20）作为 typed **source20**；
2. 生成 sequence 21 的 target 目录并让 worker 签署（新签名请求 → sign-worker → 新 envelope）；
3. 把这些 pin 固化进新的 prepare 修订（`SOURCE20` / `SEQUENCE.target=21` / 新 `target.catalog` 状态改为新签），跑通第 2 步；
4. 再把 r2 的 `app.asar` 做成新的 proposal 修订（新 manifest + 新 signing requests），完整重建 → 审计 → 外签；
5. 发布 `native-manifest`（sequence 21）→ 1.7.0 员工机实测 → 再发 1.7.1 测试清单。
