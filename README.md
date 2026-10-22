# 鑫金源珠宝报价（离线桌面版）1.7.0 —— 阶段成果归档

> 一句话背景：这是"鑫金源珠宝报价"离线桌面版（Electron 外壳 + Python 业务模块）从 1.6.2 升级到 1.7.0 的构建、签名、原子升级与验收工程的工作快照，目的是让"一台装着 1.6.2 的机器，在保全部业务数据的前提下，确定性、可复核、可回滚地升到 1.7.0"。

本仓库只做**归档**：收录脚本、交付文档与小型文本证据；不含二进制分发包、不含第三方内置代码、不含生产数据。

---

## 一、本阶段做了什么

### 1. 修复 TREE_CHANGED（完整树含未声明空目录）

**现象**：1.6.2 → 1.7.0 升级在引擎已提交、文件逐字节一致之后，仍被判失败并弹出"安装或升级未完成"。

**根因**：提交后 `verifyInstalled` 复查用 `allowMutable=false`，而"可放行目录"集合是从**备份之前**的采集里重建的；备份阶段 `nativeContext.prepare()` 会在安装树里新建一批空目录 ——
`.xjy-initial-upgrade/<uuid>/data-backup/files/…`、`.xjy-patches/<hash>/<uuid>/data-backup/files/…`（工作室数据/images、工作文档、报价图片、程序设置/Dictionaries、程序设置/blob_storage/…），外加 `resources/NVIDIA Corporation(/umdlogs)` 这条 GPU 日志空链。这些目录在采集时还不存在，复查时就被当成"未知多出目录"。

**修复**：`exactTree` 的目录判定改为两条**受控**放行 ——
- `emptyDirectoryAlwaysAllowed`：已批准的 GPU 路径链；
- `emptyMutableDirectoryAllowed`：可写历史前缀下的**空**目录。

文件级 rows 比较一行未动：未知目录、非空可变目录、任何多出/缺失/摘要变化的文件仍然拒绝。

### 2. 修复 UNEXPECTED_SOURCE_FILE（旧程序有未知可变资料）

**现象**：真实 1.6.2 安装树里有三个签名目录之外的文件，升级直接停在 `UNEXPECTED_SOURCE_FILE`：

```
resources/default_app.asar
resources/elevate.exe
Uninstall 鑫金源珠宝报价.exe
```

生产树同样带这三个文件，所以修复前**生产环境根本升不上去**。

**修复**：a16 增加**确切路径**白名单（无前缀、无通配、只有这三条固定名），把它们容忍为"旧程序携带的源侧多余文件"；它们**不会**被复制进新程序目录。

### 3. 生产主机升级（已完成并独立复核）

| 项目 | 值 |
| --- | --- |
| 安装目录 | `F:\自制软件\xjy-jewelry-offline` |
| 版本迁移 | 1.6.2 / engine 44.7.0 → **1.7.0 / engine 44.9.0** |
| 引擎 journal | `phase=committed`、`businessReleased=true` |
| 事务号 | `b983439a-11ae-46d3-a555-822a25aac0c4` |
| 目标文件数 | 3525 |

独立复核结论：安装树 **3525/3525 逐文件哈希零差异**；业务数据 1149 个文件字节一致，19 处差异与 8 处缺失**全部**是 Electron/Chromium 运行缓存（GPU 缓存、ShaderCache、Local Storage leveldb、记住登录等），业务库未变。

升级前完整备份：`D:\Codex\xjy-private-backups\pre170-a15-20261022-130238`（4708 文件 / 4,066,959,857 字节，逐文件回读一致；三个数据库副本 `integrity_check=ok`、外键 0）。

> 诚实说明：安装器**自身**的最终成功弹窗没有被捕获 —— 操作者在复核阶段终止了安装器 worker（worker exit -1）。因此最终验收未判通过。

### 4. r2 客户端（软件内升级的版本闸门）

r2 是对发布客户端做的一次**纯数据**修订 —— 只改 `app.asar` 里两个成员，不改渲染层、不执行程序代码：

| 项目 | 值 |
| --- | --- |
| 成员数 | 149（前后一致） |
| 变化成员 | 仅 `native-update-handoff.cjs`、`native-publication-update.cjs` 两个 |
| 其余成员 | 147 个逐字节相同（含渲染层 `main-7etXIfP0.js`） |
| r2 产物 | `9593b161…`，13,493,619 字节 |
| 基线产物 | `d017ceb9…`，13,495,963 字节 |

现网 1.7.0 客户端实际模块的实测结论（`seq-acceptance2.json`）：

| 用例 | 结果 |
| --- | --- |
| 同序号 20 + 相同目录摘要 | `latest` |
| 同序号 20 + 新目录摘要 | **`STALE_NATIVE_MANIFEST`** —— 同一发布序号不能替换完整程序 |
| 序号 21 + 新目录摘要 | `available` |
| 序号 19 + 新目录摘要 | `STALE_NATIVE_MANIFEST`（已被较新发布取代） |

也就是说：**r2 必须把序号抬到 ≥ 21 才能通过软件内下发**；同序号替换会被客户端设计性拒绝。另外现网 1.7.0 客户端只接受 `targetVersion=1.7.0` 的原生发布，所以"直接发 1.7.1"在 1.7.0 机器上必然失败 —— 必须先让机器装上 r2。

### 5. sequence-21 发布链改造（计划 + 已签输入）

把序号 20 → 21 不是"改个常量"，而是一次**新的信任链修订**：新 target 目录 + 新签名 + 新 typed source 链。本轮已产出并验签两组输入：

| 文件 | 字节 | sha256（前 8） |
| --- | --- | --- |
| `seq21-inputs/source20.catalog.json` | 230,255 | `4d78cbba…` |
| `seq21-inputs/source20.envelope.json` | 246,632 | `6abc3088…` |
| `seq21-inputs/target21.catalog.json` | 230,254 | `b415a4e9…` |
| `seq21-inputs/target21.envelope.json` | 246,639 | `59f6e0ed…` |

改造点在 `scripts/source/prepare-release.cjs`，共 23 处命中（`SEQUENCE.target`、`SLOT_SOURCE_PIN`、`SOURCE19`/`TARGET20_REUSE` 的硬钉摘要、`SIGNATURE_REQUIREMENTS` 复用状态等）。完整清单与执行顺序见 **[docs/SEQ21_PLAN.md](docs/SEQ21_PLAN.md)**。

---

## 二、目录说明

```
.
├── README.md                  ← 本文件
├── skipped.txt                ← 未收录内容清单（含体积与原因）
├── .gitignore
├── docs/                      ← 交付文档与状态
│   ├── DELIVERY_STATUS.json   ← 机器可读的交付状态（唯一权威口径）
│   ├── HANDOFF.md             ← 交接记录（按时间线）
│   ├── SEQ21_PLAN.md          ← sequence-21 改造清单
│   ├── 1.7.0首批交付说明-待验收.md
│   ├── delivery-170-a15/      ← a15/a16 交付说明、更新说明、交付清单
│   ├── delivery-170-a17-employee/  ← 员工机补丁使用说明
│   ├── production/            ← 生产备份报告、软件内升级实测证据说明
│   ├── runbook/               ← 故障恢复 runbook
│   ├── s5/S5-checklist.md     ← S5 升级前/后检查清单
│   ├── acceptance/            ← 干净沙盒首次安装脚本说明
│   └── release/authority-release.md
├── scripts/                   ← 全部 .cjs / .py / .ps1
│   ├── *.cjs                  ← 构建编排：derive-*、run-build-*、run-finalize、
│   │                            make-prepare-r2、make-seq21-inputs、seq-acceptance*、
│   │                            publish-catalog-170、r2-gate …
│   ├── verify-backup.py
│   ├── source/                ← 发布链核心：prepare-release(.r2).cjs、audit-release、
│   │   │                         sign-*、delivery-native-170、install-location
│   │   └── r2-asar/           ← repack / verify r2 app.asar（Python）
│   ├── s5-tools/              ← 只读生产检查/备份/复核（check、backup、verify、
│   │                             acl-preflight、prod-acl、ed25519-verify、hostdump）
│   ├── recovery-170/          ← 现场取证与恢复（collect-host、verify-install、watch-phase）
│   ├── accept-170/            ← 干净沙盒首次安装/升级
│   ├── tests/                 ← 回归用例（fixed5 48 例、install-location）
│   ├── public/                ← 来宾机发布阶段脚本
│   ├── delivery-a17/          ← 员工机诊断脚本
│   └── guest-probes/          ← 来宾机验收期间用过的探针（ACL/窗口/进程/点击）
└── evidence/                  ← 只收 <5MB 的小型文本证据
    ├── root/                  ← 根目录构建/审查报告 JSON
    ├── c6-failed-170/         ← C6 现场证据摘要（构建状态、r2 证明、序号验收、生产复核）
    ├── seq21-inputs/          ← sequence-21 已签输入（双侧 catalog + envelope）
    ├── s5-tools-out/          ← S5 检查/备份/复核的输出 JSON
    ├── delivery-170-a15/      ← 交付清单 JSON
    └── guest-results/         ← 来宾机验收结果 JSON
```

---

## 三、如何验证

> 说明：本仓库**不含**分发包与生产数据，因此下面能用归档文件直接跑的都标注了"可直接跑"；依赖生产树或大包的项目给出"预期输出"，并给出对应的 `evidence/` 归档结果供比对。

### 3.1 生产安装树只读复核（需生产机）

```powershell
powershell -ExecutionPolicy Bypass -File scripts\s5-tools\verify-production.ps1 `
  -InstallDir 'F:\自制软件\xjy-jewelry-offline'
```

**预期**：退出码 `0`（全部通过且 `businessReleased=true`），stdout 打印 JSON，含
`tree.checked = 3525`、`tree.mismatch = 0`、`tree.missing = 0`。
撤销说明：退出码 `2` = 结构/信任链都对但 `businessReleased=false`（引擎已提交、业务还没放行），**不是**损坏；`1` = 有检查未通过，保留现场；`3` = `-Baseline` 模式，升级前状态符合预期。

对应归档结果：[evidence/c6-failed-170/prod-verify-1.json](evidence/c6-failed-170/prod-verify-1.json)（3525/3525、mismatch 0、data 1149/19/8）。

### 3.2 升级前只读检查（需生产机）

```powershell
powershell -ExecutionPolicy Bypass -File scripts\s5-tools\check-production.ps1
```

**预期**：退出码 `0`，并在 `scripts\s5-tools\out\check-<时间戳>.json` 写出检查结果。该脚本对 `F:\` 严格只读，且**不碰**任何微信（Tencent / xwechat / Weixin）路径或进程。
对应归档：[evidence/s5-tools-out/](evidence/s5-tools-out/)。

### 3.3 r2 app.asar 纯数据证明（需基线/ r2 两个 asar）

```bash
python scripts/source/r2-asar/verify-r2-asar-a1.py \
  --baseline <原版 app.asar> --r2 <r2 app.asar> --report <输出 JSON>
```

**预期**：打印 `{"verified": true, "pureDataOnly": true, "programExecuted": false, "originalMembers": 149, "finalMembers": 149, "changedMembers": ["native-publication-update.cjs"], "preservedMembers": 148, …}`。
失败模式：成员集合不一致 → `MEMBER_SET_CHANGED`；非白名单成员被改 → 报出该成员名；退出码 `1`。

对应归档结果：[evidence/c6-failed-170/r2-asar-proof.json](evidence/c6-failed-170/r2-asar-proof.json) 与 [source/r2-asar-report.json 的溯源见 docs](docs/production/IN_APP_UPGRADE_EVIDENCE.md)。

### 3.4 发布序号 / 版本闸门规则实测

```bash
node scripts/seq-acceptance2.cjs
```

**预期**：输出 4 条用例，`decision` 依次为
`latest`、`STALE_NATIVE_MANIFEST`、`available`、`STALE_NATIVE_MANIFEST`。

⚠️ **可重现性限制（如实说明）**：该脚本从本机工作副本
`_dsh/r2asar/app/native-update-manifest.cjs`（从生产 `app.asar` 解出）与
`_dsh/native-publication-update.patched.cjs` 读取模块，这两个文件**未随本仓库分发**（属于产品二进制内容）。因此在本仓库内直接运行会因缺文件而报错；请把它当作**记录在案的实测脚本**，结果以归档 JSON 为准：

- [evidence/c6-failed-170/seq-acceptance2.json](evidence/c6-failed-170/seq-acceptance2.json) —— 4 条用例 + 版本闸门统计
- [evidence/c6-failed-170/seq-acceptance.json](evidence/c6-failed-170/seq-acceptance.json)

### 3.5 Ed25519 签名校验

```bash
node scripts/s5-tools/ed25519-verify.cjs <public.pem> <catalog.json> <signature.b64>
```

**预期**：stdout 输出 `{"ok":true,"spkiSha":"<公钥 SPKI 的 sha256>"}`。`ok=false` 表示签名与目录内容不匹配。

可用于校验 `evidence/seq21-inputs/*.envelope.json` 里的 catalog+signature 对（这两个信封已用 publisher 公钥验证为 `true`）。

### 3.6 备份完整性复核

```bash
python scripts/verify-backup.py <备份目录>
```

**预期**：逐文件哈希回读一致、退出码 `0`。生产备份的实际统计见 [docs/production/PROD_BACKUP_REPORT.md](docs/production/PROD_BACKUP_REPORT.md)（4708 文件 / 4,066,959,857 字节）。

### 3.7 交付件摘要比对

`docs/delivery-170-a15/` 中原有 `SHA256SUMS.txt`（及 `SHA256SUMS-a16.txt`），因扩展名不在本次收录范围未随仓库分发，但在交付说明中已登记关键摘要，例如 a16 候选包：

```
candidate/build/native-package.zip
  781,517,174 字节  sha256 85fb98813f2adfb72652ab3b9ff2ff3e4ebed106b42756cd39f00b04de425fff
```

本地若有该 zip，可直接 `sha256sum -c` 比对。

---

## 四、已知限制（不隐瞒）

1. **软件内升级尚未打通。** r2 客户端逻辑本身已验证正确（`versionAtLeast` 对 1.6.2=false、1.7.0=true、1.7.1=true、2.0.0=true），但"发布 `native-manifest` sequence 21 → 1.7.0 员工机实际收到并升级成功"这条端到端链路**尚未验证**：sequence-21 的 target 目录与新签名已产出，发布链路（第 2 步 prepare → 重建 → 审计 → 外签 → 发布）还没跑完。
2. **图标未内嵌。** 1.7.0 可执行文件仍是通用 Electron 图标，尚未做品牌图标嵌入（会改动可执行文件资源，需与外层签名一起重做）。
3. **断电恢复未验收。** 引擎侧有 journal + 回滚禁用（`rollbackForbidden`）设计，但"升级过程中断电/强杀后能自动或半自动恢复到一致状态"没有做过真机实测。
4. **员工侧验收未通过。** `DELIVERY_STATUS.json` 中 `releaseQualified=false`、`secondaryStatus=EMPLOYEE_ACCEPTANCE_PENDING`：主机侧升级 + 独立复核已完成，员工机补丁的实测验收仍待做。
5. **安装器最终成功弹窗未捕获**（操作者在复核阶段终止了 worker，exit -1），因此不以"弹窗出现过"作为通过依据；结论全部来自安装树逐文件哈希复核。
6. `seq-acceptance*.cjs` 依赖未分发的产品模块（见 3.4），在本仓库内不能独立复跑。

---

## 五、收录与排除口径

收录：`docs/` 全部交付文档、`scripts/` 全部 `.cjs`/`.py`/`.ps1`、`evidence/` 下**单文件 <5MB** 的 `.json`/`.md` 文本证据。

排除并逐条登记在 **[skipped.txt](skipped.txt)**（含路径、体积、原因），主要是：二进制分发包（`.zip`/`.asar`/`.exe`/`.dll`）、构建产物镜像（`candidate/`、`a15-build/`、`build-failed/`，合计约 14.8GB）、第三方内置代码（`reportlab`/`pdf_vendor`、`app.asar.unpacked`）、单文件 >5MB 的证据（如 108MB 的 `probe-*.json`）、流式事件日志（`*.events.jsonl`）。

**源目录 `D:\Codex\xjy-release-20261022\` 未被修改或删除任何文件**；本仓库是在其下新建 `github-staging/` 后从源树复制生成。

---

## 六、声明

本阶段成果由 **AI 助手（DeepSeek Harness）** 在用户授权与实时指挥下完成：构建编排、缺陷定位与修复、生产升级执行、独立复核与证据归档。所有"通过"结论均以逐文件哈希、签名校验或客户端模块实测为准；未执行项一律不标记为通过，见第四节。

> 状态口径以 `docs/DELIVERY_STATUS.json` 为准：`SIGNED_INTERNAL_VERIFIED_HOST_UPGRADED` / `EMPLOYEE_ACCEPTANCE_PENDING`，`releaseQualified=false`。
