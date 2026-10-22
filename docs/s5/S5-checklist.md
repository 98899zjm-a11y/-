# 鑫金源珠宝 1.7.0 正式主机升级 S5 核对清单

> 适用范围：正式主机（生产机）从 **程序 1.6.2 / 引擎 44.7.0** 升级到 **程序 1.7.0 / 引擎 44.9.0**。
> 工具目录：`D:\Codex\xjy-release-20261022\s5-tools\`（本次新增，唯一允许写入的位置）。
> 候选包：`D:\Codex\xjy-release-20261022\candidate\build\package`。
> **本清单不授权执行升级**：每一步的 `-Apply` / 安装器启动都必须由用户或主控在确认后手动签发。

---

## 0. 一句话结论（执行前必读）

- 四个脚本都已在 PowerShell 5.1 下实测通过；`verify-production.ps1` 用**真实 catalog 信封 + 真实 Ed25519 签名 + 真实 1079 文件树**做过完整预演（62 项检查全过）。
- 候选包是**内部候选**，不是正式发布件：`DELIVERY_STATUS.json` 里 `releaseQualified=false`、`internalTestPreparation=true`、`nativePending=true`、`installAuthorization.state="RECORDED_GATES_NOT_MET"`。**必须先拿到主控/用户的明确批准**，才可以走第 4 步。
- 任务书里提到的「候选包 sha256 = ce434a87…」**无法对磁盘上任何文件复核**：它是构建器**内存中间归档**的摘要（`assembly.json` 内 `archive.sha256`，781,516,834 字节，磁盘上不存在该归档）。脚本因此改用 5 个可复核 pin（见 1.4）。

---

## 1. 前置条件（全部满足才允许进入第 4 步）

### 1.1 程序已完全退出
- 用户从托盘「退出」正式程序，**不是最小化、不是关闭窗口**。
- `check-production.ps1` 报告 `processes.count = 0`。
- 若仍有 `鑫金源珠宝报价.exe` 残留在跑：**等它自己退出或让用户在界面里退出**，不要强杀正在运行且未提交的业务。
- 严禁触碰任何微信目录/进程（全局铁律，与本次升级无关但必须守住）。

### 1.2 备份已完成且回读一致
- 备份目录：`D:\Codex\xjy-private-backups\pre170-a15-<stamp>\{program,data}`。
- `manifest.json` 中 `verify.mismatch = 0`、`verify.verified = 4701`（program 3525 + data 1176）。
- 参考基线：a1 备份为 **4701 文件 / 4,015,026,383 字节**，逐文件哈希回读一致，三库 integrity_check=ok。
- 实测生产现状与 a1 基线**逐字节同量**：program 3525 文件 / 1,620,307,739 B；data 1176 文件 / 2,394,718,644 B。数量或字节数对不上就必须先解释清楚再升级。
- **备份是唯一能让你回退的东西。没有 `-Apply` 跑完并校验通过的备份，绝不进入第 4 步。**

### 1.3 磁盘空间（实测：C 74.9GB / D 427.8GB / F 803.8GB 可用）
| 用途 | 需要 | 说明 |
| --- | --- | --- |
| C: `%LOCALAPPDATA%\xjy-170-local` | ≥ 2.3 GB | 本地包副本（包 1,819,804,223 B + robocopy 余量） |
| C: 安装器临时 | ≥ 1.0 GB | 解包/暂存 |
| D: `pre170-a15-<stamp>` | ≥ 5.0 GB | program 1.62GB + data 2.39GB + manifest 余量 |
| F: 程序/数据盘 | ≥ 2.0 GB | 引擎树切换需要同盘暂存（stage/backup 都在 F 盘） |

### 1.4 候选包完整性（只读）
运行 `run-upgrade.ps1 -Preflight`，必须 `PREFLIGHT RESULT: READY`（exit 0）。它校验：

| 项 | 值 |
| --- | --- |
| `一键升级.cmd` | `7a6e182cea080f704b1dd53f4a6672949af9aeedf708229c6ddd28cfeede436b` |
| `安装组件\native-delivery-170.ps1` | `15352a02337e4bae4db93f66b3255f23b997363bd17f80736db8d18cbc46480b` |
| `engine-native170-binding.json` | `6552569b5f743c0aaf1f0a0afa59949626e93867cda0cd392b035578f4afc507` |
| `受信助手\publisher-public.pem` | `bc6c3d2b42871e42d3eb91371034b410d507a228eeccb1d714acca60e8141b30` |
| 包内 3288 条签名清单 | 逐文件 size + sha256 全部一致（实测已过，多出 5 个不在清单内的文件属正常附加件） |

另外两个关键锚点（已实测一致，用于后置核验）：
- 发布公钥 SPKI DER 的 sha256 = `6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c`；
- 目标目录 catalog 的 sha256 = `4d78cbbac07b05f267fabb870a10376a2c1158a8b4623ba4ea35d3334cb828ef`（1079 个文件）。

### 1.5 基线状态（只读）
`verify-production.ps1 -Baseline` 必须 **exit 3**（表示「还没升级、状态正常」）：
`version`=44.7.0、activation=1.6.2/host、无 engine state 目录、数据目录存在。
若返回 exit 1，先解释差异，不要升级。

### 1.6 现场条件
- 营业/使用低峰，明确告知用户「升级期间不要打开程序」。
- **不要同时升级员工端**：旁边已开着的员工 1.7.0 窗口不能当作本次升级成功的证据。
- 记录一次现场快照（`check-production.ps1` 输出的 JSON），并确认没有杀毒/同步软件正在锁 `F:\自制软件\xjy-jewelry-offline`。
- 安装器失败时会弹**模态框**（标题「安装或升级未完成」）：必须有人点「确定」，否则脚本会一直等——这是设计行为（不得 kill）。

---

## 2. 执行顺序

| 步 | 动作 | 命令 | 期望结果 |
| --- | --- | --- | --- |
| 0 | 体检 | `powershell -NoProfile -File .\check-production.ps1` | exit 0，processes=0，version=44.7.0 |
| 1 | 基线核验 | `powershell -NoProfile -File .\verify-production.ps1 -Baseline` | exit 3 |
| 2 | 备份（**需明确授权**） | 先 `.\backup-production.ps1`（只打印计划）→ 授权后 `.\backup-production.ps1 -Apply` | exit 0，`verify.verified=4701`、`mismatch=0` |
| 3 | 备份复核（可选但推荐） | `.\backup-production.ps1 -VerifyOnly -TargetRoot D:\Codex\xjy-private-backups\pre170-a15-<stamp>` | exit 0 |
| 4 | 包预检 | `.\run-upgrade.ps1 -Preflight` | `PREFLIGHT RESULT: READY` |
| 5 | 升级（**需明确授权**） | 先 `.\run-upgrade.ps1` 看计划 → 授权后 `.\run-upgrade.ps1 -Apply` | 安装器自己退出，exit 0 |
| 6 | 后置核验 | `.\verify-production.ps1` | exit 0 = PASS；exit 2 = 已提交但业务未放行 |
| 7 | 首次启动 | 正常启动 1.7.0 程序一次，确认界面/数据/打印正常 | 业务可用；再跑 `verify-production.ps1` 应变 exit 0 |

第 5 步细节（`run-upgrade.ps1 -Apply` 会做什么）：
1. 4 个 pin + 3288 条包清单全量校验（约 1–3 分钟）；
2. `robocopy` 把包复制到 `%LOCALAPPDATA%\xjy-170-local`（`/MIR`）；
3. 在**本地副本**上再校验 4 个 pin；
4. 以本地副本为工作目录、设 `XJY_DELIVERY_ROOT`，执行 `「一键升级.cmd」`；
5. 安装器内部：备份 → 切换 → committed → 复查；成功才 exit 0；
6. 脚本把 stdout/stderr/退出码写入 `out\upgrade-<stamp>.stdout.log|stderr.log|log|exit.txt|json`；
7. **脚本不设超时、绝不 kill**：安装器跑多久就等多久。

---

## 3. 失败处理（按顺序做，不要即兴操作）

### 3.1 铁律
1. **不要 kill 安装器 / 不要 kill `powershell.exe` / 不要点进度窗的 X 后强杀**（窗口关闭按钮只最小化，不终止）。
2. **不要删除** `F:\自制软件\.xjy-jewelry-offline.xjy-engine-state\`、`journal.json`、`journal-key.bin`、`install.lock`。删了等于毁掉恢复所需的账本。
3. **不要重跑升级**。重跑会把现场搅得更乱。
4. **保留现场**：`out\` 下的日志、安装器弹窗内容（截图/抄写）、`check-production.ps1` 与 `verify-production.ps1` 的 JSON 全部留存。
5. 微信目录/进程全程不碰。

### 3.2 退出码含义
| 来源 | 退出码 | 含义 | 下一步 |
| --- | --- | --- | --- |
| `run-upgrade.ps1` | 0 | 安装器报告成功 | 进第 6 步 |
| | 1 | 前置条件不满足 / 包校验失败 / 复制失败，安装器**未启动** | 修前置，现场无变化 |
| | 2 | 安装器非零退出（失败或用户取消） | 按 3.3 处理 |
| | 3 | dry-run，什么都没做 | 正常 |
| `verify-production.ps1` | 0 | 全部通过且 businessReleased=true | 完成 |
| | 2 | 结构/签名链全对，但 `businessReleased=false`（ENGINE_STARTUP_HELD） | **正常中间态**：启动 1.7.0 一次后重跑 |
| | 1 | 有硬性检查失败 | 按 3.3 处理，不要回滚前先读 journal |
| | 3 | `-Baseline` 模式：未升级状态正常 | 可以升级 |

### 3.3 安装器返回非零
1. 记下弹窗文案（通常含 `RECOVERY_REQUIRED` / `SLOT_ALREADY_COMMITTED` / 校验失败原因）与时间点。
2. 跑 `verify-production.ps1`，看 `journal.phase` 与失败项：
   - `phase=committed` 且 `rollbackForbidden=true` → **已经提交，禁止回退**；此时程序应能启动，按「首次启动」流程走，业务异常另案排查。
   - `phase` 为 `prepared/old-renamed/new-published/rolling-back/rolledback/rollback-failed` → 走安装器 **Recover**。
3. Recover 动作（只读计划 → 授权执行）：
   ```
   powershell -NoProfile -File .\安装组件\native-delivery-170.ps1 -PackageRoot <包根> -Action Recover
   ```
   成功判据：worker 输出 `recovered === true`；`RecoverStart` 用于「恢复后重启业务」场景。注意 `-PackageRoot` 指向**已复制到本地的包根**（即 `%LOCALAPPDATA%\xjy-170-local`），不要指向 `D:\` 原包以免路径混淆。
4. 若 Recover 也失败：**停手**，保留全部现场，把 `out\` 日志 + state 目录清单 + 弹窗文案交给主控做人工判断。

### 3.4 最后手段：整目录回滚（仅在明确授权后）
用第 2 步的备份恢复：
```
robocopy "D:\Codex\xjy-private-backups\pre170-a15-<stamp>\program" "F:\自制软件\xjy-jewelry-offline" /MIR /E /MT:16 /R:1 /W:1 /COPY:DAT /DCOPY:DAT /XJ
robocopy "D:\Codex\xjy-private-backups\pre170-a15-<stamp>\data"    "F:\鑫金源珠宝资料"          /MIR /E /MT:16 /R:1 /W:1 /COPY:DAT /DCOPY:DAT /XJ
```
- 只在 `phase` 未 committed（或已回滚）时使用；已 committed 且 `rollbackForbidden=true` 时禁止用备份覆盖，必须走 Recover/人工。
- 回滚同样**不得 kill 任何进程**，先把程序正常退出。
- 回滚后必须重新 `Robocopy + 逐文件哈希` 校验，并重跑 `verify-production.ps1 -Baseline`（应回到 exit 3）。

---

## 4. 核验项与「通过」判据

`verify-production.ps1` 输出 JSON 中的 `checks[]`，全部 fatal 项必须 `ok=true`：

| 类别 | 检查 | 通过判据 |
| --- | --- | --- |
| 位置 | `install-dir-exists` / `state-dir-found` | 安装目录存在；state 目录按门槛规则=`F:\自制软件\.xjy-jewelry-offline.xjy-engine-state` |
| 账本 | `journal-exists` / `receipt-exists` / `catalog-envelope-exists` / `journal-key-exists` / `journal-key-length` | 四件齐全，key 恰 32 字节 |
| 回执 | `receipt-hmac` | HMAC-SHA256(key, `"xjy-engine-startup-v1\0"+payload`) == mac |
| | `receipt-payload-keys` / `receipt-version-native` | 键集合**完全相等**；version=2 |
| | `receipt-phase-committed` / `receipt-rollbackForbidden` | committed + true |
| | `receipt-programVersion` / `receipt-engineVersion` | 1.7.0 / 44.9.0 |
| | `receipt-role-host` / `receipt-mode` | host / upgrade（或 fresh） |
| | `receipt-publisher` / `receipt-catalog-pin` | `6e8b9cad…` / `4d78cbba…` |
| | `receipt-installationDir` / `receipt-stateDir` | 与实机路径一致（忽略末尾斜杠/大小写） |
| | `receipt-osUserNamespace` | 等于 `(主机名\用户名).ToLower()` |
| 账本 journal | `journal-hmac` | HMAC-SHA256(key, UTF8(payload)) == mac（**无** domain 前缀） |
| | `receipt-journalSha256-binding` | 回执里的 journalSha256 == journal.json 字节的 sha256 |
| | `journal-phase-committed` / `journal-rollbackForbidden` | committed / true |
| | `journal-transactionId-binding` | journal 与回执 transactionId 一致 |
| | `journal-targetVersion` / `journal-targetEngineVersion` | 1.7.0 / 44.9.0 |
| | `journal-targetCatalog-binding` | journal 与回执 catalogSha256 一致 |
| 目录签名 | `catalog-sha-matches-receipt` / `catalog-sha-pin` | catalog 字符串 sha256 双绑一致 |
| | `catalog-signature-ed25519` | 用 `publisher-public.pem` 验签 **true** |
| | `publisher-key-spki-pin` | PEM 的 SPKI DER sha256 == `6e8b9cad…` |
| 程序树 | `version-value` / `version-size-in-catalog` / `version-sha-in-catalog` | `version` 文件=44.9.0，且已登记在 catalog 中且 size/sha256 匹配 |
| | `journal-targetFiles-match` | journal 的 `targetFiles` **逐文件** size+sha256 全部匹配（生产约 1079+ 条） |
| 激活 | `activation-*` | 五键完全匹配：1 / xjy-jewelry-offline / 1.7.0 / host / 安装目录 |
| 放行 | `receipt-businessReleased` | true → exit 0；false → exit 2（只差「首次启动」） |

console 尾行判据：`RESULT: PASS`（exit 0）/ `RESULT: HELD`（exit 2）/ `RESULT: FAILED`（exit 1）。

**关于 exit 2（HELD）**：这是正常中间态，不是故障。引擎已在 deferred 模式下提交，`businessReleased` 由首次成功启动 1.7.0 时的 `startCommitted` 写 true。此时正确动作是**正常启动程序一次**，然后重跑 `verify-production.ps1`；错误动作是删 state 目录或重跑安装器。

---

## 5. 现场必须留存的东西

- `s5-tools\out\check-<stamp>.json`（升级前快照，含进程/文件数/字节数/磁盘）
- `s5-tools\out\verify-baseline-<stamp>.json`（基线，exit 3）
- `s5-tools\out\backup-<stamp>.json` + `pre170-a15-<stamp>\manifest.json`（备份与回读结论）
- `s5-tools\out\upgrade-<stamp>.stdout.log|stderr.log|log|exit.txt|json`（安装器全过程 + 退出码）
- `s5-tools\out\verify-<stamp>.json`（后置核验，全量 checks）
- 安装器失败弹窗的截图/文案与时间

---

## 6. 已知风险点（写清楚，避免误判）

1. **`ce434a87…` 不可复核**：它是构建器内存归档摘要（`assembly.json → archive.sha256`），磁盘无此文件。禁止把它写成「zip 的 sha256」；包完整性以 4 pins + 3288 清单为准。zip 本体 sha256 实测 `b1a7b12029208994d0431101660368d22c8d887384485aff432765c380730dc9`。
2. **state 目录位置容易搞错**：Runtime 规则是 `<安装目录的父目录>\.<安装目录名>.xjy-engine-state`，生产实机为 `F:\自制软件\.xjy-jewelry-offline.xjy-engine-state`。`.program.xjy-engine-state` 只在「安装目录名恰好是 `program`」的测试夹具布局下成立；若真机上出现 `.program.xjy-engine-state`，说明布局被改动，必须先解释。
3. **businessReleased 时序**：安装器 deferred 提交后**不会**立刻置 true，`一键升级.cmd` 退出 0 后立刻核验通常会得到 exit 2。不要据此判定失败。
4. **员工端窗口干扰**：旁边已运行的员工 1.7.0 窗口 ≠ 本机升级成功；且升级期间不要同时升级员工端。
5. **安装器弹窗会阻塞**：失败模态框需要人工点确定；脚本不设超时是刻意的，任何「等太久了就杀掉」的冲动都必须压住。
6. **长路径**：安装目录下最深路径曾达 344 字符，脚本已用 `\\?\` 前缀；手工命令（robocopy/资源管理器）也可能踩 MAX_PATH，用脚本而不是手点。
7. **杀毒/同步软件**：可能锁文件导致切换失败；升级前确认没有第三方在扫 `F:\自制软件`，失败日志里若出现 sharing violation 优先怀疑它。
8. **备份是唯一退路**：`-Apply` 备份没跑完/校验没通过时，升级一律不得开始。
9. **本工具不写 F:\**：`check/verify` 纯只读；改动生产目录的是安装器本身。任何手工操作都不要直接动 `F:\自制软件` 与 `F:\鑫金源珠宝资料` 里的文件。
