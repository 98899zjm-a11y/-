# 升级中途断电 / 失败后的真实恢复 —— Windows Sandbox 演练（S4-recovery，1.6.2 → 1.7.0）

本目录是**方案 + 脚本**，不含任何执行结果。演练由人工在 Windows Sandbox 里按本文件逐步执行；
所有脚本只写沙盒盘（VHD）与宿主映射的 `C:\XjyResults`，**不碰** `F:\自制软件`、`F:\鑫金源珠宝资料`
等生产目录，也不执行任何真实安装器。

> **纪律（最高优先级）**
> 1. **只演练、不生产**：全部操作发生在 Windows Sandbox 内部的新建 VHD 上；宿主 `F:` 盘一律不读不写。
> 2. **演练失败也算证据，不得用重装顶替**：一旦断电没落在 `prepared` 窗口、或恢复没回到 1.6.2，
>    必须如实保留现场、如实记录结论（`prepared-missed` / `prepared-timeout` / `RECOVERY-FAILED`），
>    然后重建沙盒**重做一轮**。严禁用「重新首装一遍」「删掉 state 目录再升级」「把 seedclean 直接覆盖
>    回安装根」等方式把结果弄成看起来成功——那会把真实恢复能力的证据换成一次伪造的干净安装。
> 3. **不删生产数据**：本演练不会、也不允许删除任何业务数据；清理只发生在沙盒 VHD 文件
>    `C:\XjyResults\XjyF.vhdx`（宿主侧对应 `guest-results\XjyF.vhdx`）上，且由演练者显式 `-Reset` 触发。

---

## 1. 目标

验证一个具体问题：**1.6.2 在线升级到 1.7.0 的过程中，在「原生事务已 prepared、但还没 commit」这一刻
被强制断电（连同 guest 内存态一起销毁）之后，下一次启动能否真的回到 1.6.2，且业务数据零损坏。**

不是验证「升级能成功」，也不是验证「重装能恢复」。要的是：

- 断电点**必须**落在 `journal.phase == 'prepared'`（prepared 之后还有 `old-renamed`、`new-published`、
  `committed`；到 `committed` 就 `rollbackForbidden: true`，不可回滚，那一轮对本演练**无效**）。
- 断电必须是**真实断电语义**：`wsb stop --id <id>`，连 guest 内存态一起销毁；因此所有需要跨断电存活的
  东西（VHD、种子、交付包、监视线索）都必须先落在 `C:\XjyResults\`（宿主映射）或 VHD 上。
- 恢复**必须**走引擎自己的恢复分支（`engine-tree-runtime170.cjs` 的 `recoverCandidate()` /
  `native-delivery-170.ps1 -Action Recover`），而不是人工搬文件。

## 2. 本轮必须按这些事实写，不得臆造

| 事实 | 值 / 出处 |
| --- | --- |
| 引擎 state 目录名 | `.<安装目录名>.xjy-engine-state`，实测为 `.xjy-jewelry-offline.xjy-engine-state` |
| state 目录位置 | **与安装根同级**（`F:\自制软件\`），**不在** install 目录内；由 `engine-startup-gate.cjs:37` 的 `path.join(path.dirname(installDir), '.' + path.basename(installDir) + '.xjy-engine-state')` 决定 |
| journal | `<state>\journal.json`，磁盘格式是 HMAC 信封 `{"payload":"<json>","mac":"<hex>"}`（`engine-tree-runtime170.cjs:243/251`，原子写） |
| state 目录内固定文件 | `journal.json`、`journal-key.bin`、`install.lock`、`engine-startup-status.json`、`target-catalog-envelope.json` |
| stage / backup / failed 目录 | `F:\自制软件\.xjy-jewelry-offline.engine-stage-<uuid>` / `.engine-backup-<uuid>` / `.engine-failed-<uuid>`（`transactionPaths()`，`:291`） |
| 恢复入口 | `engine-tree-runtime170.cjs:473` `recoverCandidate()`；`phase==='prepared'`（及 `old-renamed`/`new-published`）→ `rollback()` → `{recovered:true, rolledBack:true, phase:'rolledback', version:'1.6.2'}`；`phase==='committed'` → `{completed:true, phase:'committed', version:'1.7.0', rollbackForbidden:true}`，**不可回滚** |
| 显式恢复命令 | `powershell -File <包根>\安装组件\native-delivery-170.ps1 -PackageRoot <包根> -Action Recover`（`一键升级.cmd` 只会 `-Action Upgrade`，不会自动恢复） |
| `wsb` | `C:\Users\Administrator\AppData\Local\Microsoft\WindowsApps\wsb.exe`；`stop --id` 销毁内存态；`exec` 不回传 stdout，证据靠 guest 写文件 |
| 沙盒映射（4 个） | `C:\XjyPackage`(ro)、`C:\XjySeedRoot`(ro)、`C:\XjySeedData`(ro)、`C:\XjyResults`(rw, → 宿主 `D:\Codex\xjy-release-20261022\guest-results`) |
| guest 用户 | `WDAGUtilityAccount` |
| 基线种子 | `seedclean`：1083 文件 / 549,067,265 字节，`version` = `44.7.0`，marker `programVersion` = `1.6.2` |
| 数据种子 | 1176 文件 / 2,394,718,644 字节（顶层 `内帐`、`后台运行`、`工作室数据`、`库管`、`报价图片`、`程序更新备份`、`程序设置` 等） |
| 1.7.0 侧 | `version` = `44.9.0`，engine 44.9.0 |

### 2.1 prepared 窗口为什么能被抓住（推断，不是承诺）

`installCandidate()` 在 `phase='prepared'` 落盘之后、把 install 目录改名为 backup 之前，要跑两次
`layout()`：对 install 树（549 MB）、stage 树（549 MB）、数据根（2.39 GB）、profile 树逐文件算 sha256。
量级是**数秒到数十秒**。因此 500 ms 轮询 + 宿主立刻 `wsb stop` 有很高命中率，但**不承诺**一定命中；
没命中就按第 3 节判无效、重建重做。

### 2.2 两个必须预先知道的「不是 bug」

1. **回滚成功后再点一次升级，会报 `RECOVERY_REQUIRED`。** 因为 journal 残留 `rolledback`、并且 stage 目录
   被有意保留作为证据，`installCandidate()` 会用 `RECOVERY_REQUIRED` 拒绝覆盖失败现场。这是设计。
2. **回滚后 `engine-startup-status.json` 可能仍描述那次被中止的事务。** 该文件只由 1.7.0 的启动路径写，
   1.6.2 不会更新它。03 脚本会原样采集并标注，这是证据而不是异常。

## 3. 判定标准

### 3.1 本轮是否**有效**（先判这个，再看恢复）

有效 ⇔ 以下全部成立：

| # | 条件 | 证据 |
| --- | --- | --- |
| V1 | 监视器命中了 `phase === 'prepared'` | `prepared-hit.json` 存在且 `kind='prepared'` |
| V2 | 抓到的 journal 与线上 journal 逐字节一致 | `prepared-hit.json` 的 `journalCopyExact === true` |
| V3 | 断电发生在 hit 之后（时间戳可对） | `prepared-hit.json.hitAtUtc` < 宿主记录的 `wsb stop` 时间 |
| V4 | 断电即刻现场仍是 prepared（重启后 journal 不是 `committed`） | `recover-verify.json.journal.phase` |

`prepared-missed.json`（窗口在 `prepared` 之前/之后被别的 phase 越过）或 `prepared-timeout.json`（40 分钟
内没出现 journal）⇒ **本轮无效**，不是「恢复失败」，也不是「恢复成功」；必须重建 VHD 重做，并在报告里
保留这两个文件作为「这一轮为什么无效」的证据。

### 3.2 什么算「恢复成功」

有效轮次的前提下，**同时**满足 A / B / C：

| # | 条件 | 判定字段（`recover-verify.json`） |
| --- | --- | --- |
| A | journal 回到 `rolledback`，程序身份回到 1.6.2 | `verdict.verdict == 'ROLLED-BACK-162'`，即 `journal.phase=='rolledback'` 且 `marker.programVersion=='1.6.2'` 且 `version.raw=='44.7.0'` |
| B | 安装根与 1.6.2 基线等量 | `installRoot.matchesSeed == true`（文件数 1083 / 字节数 549,067,265 与 `seedclean` 一致） |
| C | 业务数据根完好 | `dataRoot.matchesSeed == true`（文件数 1176 / 字节数 2,394,718,644 与数据种子一致） |

参考项（不单独决定成败，但必须如实写进结论）：

- `installRoot.exists`、`dataRoot.topLevel` 是否合理（数据根顶层应有 10 项左右）。
- `transactionDirs` 是否残留 `stage`（prepared 回滚**保留** stage 是预期行为，因为它是证据）。
- `recoveryLogs` 里是否有恢复输出（无日志不等于失败，但要在报告中说明）。
- `runningFromInstall`：恢复分支会重启 1.6.2；若进程还在跑，记录其 pid 作为「已由恢复拉起来」的旁证。
- `startupStatus` 的原样内容（见 2.2 第 2 条）。

**明确不算成功**的情形：

- `COMMITTED-170`（断电点太晚，已 commit）→ 该轮无效，不可回滚是设计行为，不得宣称「恢复成功」。
- `ROLLBACK-FAILED`（恢复过程自己失败，`phase='rollback-failed'`，错码 `ROLLBACK_FAILED`）→ 恢复失败，保留现场。
- `OTHER:...` → 现象超出预期，按失败处理并原样保留。
- 人工修复后的状态（例如手工把 seedclean 覆盖回去、手工删 state 目录后重跑升级）**一律不算**；
  出现这种情况必须在报告里写明「本轮被人为干预，不作为恢复能力证据」。

## 4. 前置条件

**宿主（Windows 11 / Administrator）**

1. `wsb.exe` 可用：`C:\Users\Administrator\AppData\Local\Microsoft\WindowsApps\wsb.exe`。
2. 交付包已构建在 `D:\Codex\xjy-1.7.0\c28-candidate\build\package`（约 1.75 GB，含
   `安装组件\native-delivery-170.ps1`、`受信助手\`、`engine-native170-binding.json`）。
3. 基线种子 `D:\Codex\xjy-release-20261022\guest-results\seedclean\`（1083 文件 / 549,067,265 字节）。
4. 数据种子 `D:\Codex\xjy-accept-170\legacy-data\`（1176 文件 / 2,394,718,644 字节）。
5. 宿主证据目录 `D:\Codex\xjy-release-20261022\evidence-s4-recovery\`（04 脚本会创建）。
6. 宿主磁盘剩余 ≥ 15 GB（VHD 10 GB + 证据）。

**沙盒（`.wsb` 配置要点）**　—— 本目录已附带可用配置 `recovery-170.wsb`，内容如下，可按需改路径：

```xml
<Configuration>
  <Networking>Disable</Networking>
  <MappedFolders>
    <MappedFolder><HostFolder>D:\Codex\xjy-1.7.0\c28-candidate\build\package</HostFolder><SandboxFolder>C:\XjyPackage</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>D:\Codex\xjy-accept-170\legacy-root</HostFolder><SandboxFolder>C:\XjySeedRoot</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>D:\Codex\xjy-accept-170\legacy-data</HostFolder><SandboxFolder>C:\XjySeedData</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>D:\Codex\xjy-release-20261022\guest-results</HostFolder><SandboxFolder>C:\XjyResults</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
  <MemoryInMB>8192</MemoryInMB>
</Configuration>
```

- `C:\XjyResults` 必须是**读写**映射：它同时承担「VHD 落盘位置」「证据回传通道」「脚本入口」三个职责。
- 4 个映射之外不要加别的映射（尤其不要映射宿主 `F:`）。
- 种子目录 `C:\XjyResults\seedclean` 需在启动沙盒前复制进 `guest-results\seedclean\`（若已存在则跳过）；
  `01-seed.ps1` 找不到 `C:\XjyResults\seedclean` 时会尝试 `C:\XjySeedRoot` 并在日志里写明回退。

**沙盒内**

- 管理员 PowerShell（`WDAGUtilityAccount`）。
- 4 个脚本放在 `C:\XjyResults\`（即直接引用宿主本目录，无需拷贝）。

## 5. 文件清单

| 文件 | 侧 | 作用 |
| --- | --- | --- |
| `README.md` | — | 本文件：目标、判定、前置、逐步操作 |
| `01-seed.ps1` | guest | 建 VHD `F:`、`icacls C:\ /remove:g *S-1-5-11`、格式化、铺 1.6.2 基线、铺数据根、注册 uninstall 键、把交付包铺到 `F:\XjyLocal` |
| `02-watch-prepared.ps1` | guest | 轮询 `journal.json`，命中 `phase==='prepared'` 立即逐字节复制 journal + 统计 stage 目录 + 写 `prepared-hit.json` |
| `03-verify-after.ps1` | guest | 恢复后采集：marker / version / journal / 两棵树 / 恢复日志 / 是否回到 1.6.2，写 `recover-verify.json` |
| `04-collect.ps1` | 宿主 | 把 guest 结果里与本演练相关的文件复制到 `evidence-s4-recovery\`，生成 `INDEX.md` + `collect-manifest.json` |
| `recovery-170.wsb` | 宿主 | 沙盒配置（4 映射 + 断网 + 8 GB 内存），步骤 1 直接引用它 |

脚本约定：

- 纯 ASCII 源码；所有中文路径用 `[char]0xXXXX` 拼接（例：`自制软件` = `0x81EA,0x5236,0x8F6F,0x4EF6`）。
- 自检（0 错误才算可用）：

```powershell
foreach ($f in '01-seed.ps1','02-watch-prepared.ps1','03-verify-after.ps1','04-collect.ps1') {
  $e=$null; $t=$null
  [void][System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $f),[ref]$t,[ref]$e)
  '{0}: {1} error(s)' -f $f, $e.Count
}
```

- 每个脚本最后输出一个 marker 行，宿主据此判读：`SEED-OK` / `SEED-FAIL <原因>`、
  `WATCH-END prepared|missed|timeout`、`VERIFY-DONE <verdict>`、`COLLECT-DONE <copied> <missing>`。

## 6. 逐步操作（含每步预期输出）

> 时间预算：单轮 60–90 分钟（铺种子 10–20 分钟为主）。断电命中失败要重做时，用 `01-seed.ps1 -Mode Fresh -Reset`
> 重建 VHD，**不要**在半残的现场上继续。

### 步骤 0 — 宿主预检

```powershell
$R='D:\Codex\xjy-release-20261022\guest-results'
Test-Path "$R\seedclean\version"; Get-Content "$R\seedclean\version"
Test-Path "$R\seedclean\xjy-install-activation.json"
Test-Path 'D:\Codex\xjy-1.7.0\c28-candidate\build\package\安装组件\native-delivery-170.ps1'
Test-Path 'D:\Codex\xjy-accept-170\legacy-data\工作室数据'
(Get-ChildItem "$R\seedclean" -Recurse -File | Measure-Object Length -Sum).Count, (Get-ChildItem "$R\seedclean" -Recurse -File | Measure-Object Length -Sum).Sum
```

预期：`version` 打印 `44.7.0`；三个 `Test-Path` 全为 `True`；文件数 `1083`、字节 `549067265`。

### 步骤 1 — 启动沙盒（第一次启动）

```powershell
$wsb='C:\Users\Administrator\AppData\Local\Microsoft\WindowsApps\wsb.exe'
& $wsb start -c D:\Codex\xjy-release-20261022\recovery-170-drill\recovery-170.wsb --id s4rec1
& $wsb list --raw
```

预期：沙盒窗口出现；`list --raw` 里出现 `s4rec1` 且状态为 running。
**`--id` 名字记下来**，后面 stop / start 都用同一个 id，VHD 才能被同一沙盒认回。

### 步骤 2 — guest 内铺底（01-seed，Fresh）

```powershell
& $wsb exec --id s4rec1 -c "powershell -NoProfile -ExecutionPolicy Bypass -File C:\XjyResults\01-seed.ps1 -Mode Fresh" -r ExistingLogin --raw
```

`wsb exec` 不回传 stdout，所以**看结果文件**：

```powershell
Start-Sleep -Seconds 5
Get-Content C:\Users\Administrator\...\guest-results\seed.log -Tail 20
Get-Content ...\guest-results\seed-result.json | ConvertFrom-Json | Select-Object ok,error
```

预期（`seed-result.json`）：

- `ok = True`，`error = null`；
- `steps` 里这些为 `ok`：`preflight`、`vhd`（`label=XJYF`）、`seed-program`（`files=1083 bytes=549067265`）、
  `seed-data`（`files=1176 bytes=2394718644`）、`baseline`（`version=44.7.0`）、`uninstall-key`、
  `stage-package`；
- `seed.log` 末行 `SEED-OK`（以 `SEED-` 开头的行）；
- guest 内：`F:\` 可见、`F:\自制软件\xjy-jewelry-offline\version` = `44.7.0`、
  `F:\鑫金源珠宝资料\工作室数据` 存在、`F:\XjyLocal\安装组件\native-delivery-170.ps1` 存在。

关键点：

- VHD 必须建在 `C:\XjyResults\XjyF.vhdx`（宿主侧可见），否则 `wsb stop` 后整个 `F:` 消失，演练无从谈起。
- 交付包必须落在 `F:\XjyLocal`（VHD 上）。原因：交付脚本用句柄级路径校验拒绝 reparse point，
  直接从映射盘 `C:\XjyPackage` 运行会报 `Path changed or alias used`；而 guest `C:` 会随 stop 消失，
  所以不能放 `C:\XjyLocal`。
- ACL：`icacls C:\ /remove:g *S-1-5-11` 之后，`F:\` 还需要 `inheritance:r` + 显式授权，并且**必须再做一遍
  **不带 `(OI)(CI)` 的文件级授权**，否则文件 DACL 为空，会以 `NATIVE_ACL_REFUSED` 失败。01 脚本已按此实现
  （`acl-inherit-*`、`acl-explicit-*` 两步，`acl-check-install-parent` 复核没有 Authenticated Users 残留）。
- 不要用安装器做首装来铺 1.6.2：首装禁止 `F:\鑫金源珠宝资料` 已存在（会报 `EXISTING_HOST_DATA 已存在主机资料，首次安装停止`），
  而本场景必须带业务数据。

### 步骤 3 — 启动监视器（02-watch-prepared）

另开一个 guest PowerShell（或 `Start-Process -WindowStyle Hidden`），先起监视器**再**点升级：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\XjyResults\02-watch-prepared.ps1 -TimeoutMinutes 40 -PollMs 500
```

预期：进程挂着，`C:\XjyResults\watch-trace.log` 出现 `watch start journal=F:\自制软件\.xjy-jewelry-offline.xjy-engine-state\journal.json`。
此时还没有 `journal.json`，所以不会立刻结束。

> 一轮只能监视一次。若 state 目录里已有上一轮残留 journal（`rolledback` 等），02 会在第一次轮询就写
> `prepared-missed.json` 并退出——这正好说明「现场没清干净」，该轮作废，用 `-Reset` 重建。

### 步骤 4 — 触发升级（guest 内，`F:\XjyLocal`）

用与现场一致的入口，输出重定向到文件（`wsb exec` 拿不到 stdout）：

```powershell
# C:\XjyResults\StartUpgrade.cmd 由本目录外的手工步骤生成亦可，核心三行：
#   chcp 65001 >nul
#   cd /d F:\XjyLocal
#   call "一键升级.cmd" 1> C:\XjyResults\upgrade-stdout.txt 2> C:\XjyResults\upgrade-stderr.txt
#   echo %errorlevel% > C:\XjyResults\upgrade-exit.txt
cmd /c C:\XjyResults\StartUpgrade.cmd
```

预期：`F:\自制软件\.xjy-jewelry-offline.xjy-engine-state\` 里出现 `journal.json`、`journal-key.bin`；
`watch-trace.log` 依次出现 `phase=prepared`（可能有 `unreadable` 的抖动行）；
`F:\自制软件\.xjy-jewelry-offline.engine-stage-<uuid>\` 被创建并快速长大到约 549 MB。

### 步骤 5 — 断电（宿主侧，`wsb stop`）

在宿主**盯着** `prepared-hit.json`：

```powershell
$R='D:\Codex\xjy-release-20261022\guest-results'
while (-not (Test-Path "$R\prepared-hit.json")) {
  if (Test-Path "$R\prepared-missed.json")   { 'MISSED';   break }
  if (Test-Path "$R\prepared-timeout.json") { 'TIMEOUT'; break }
  Start-Sleep -Milliseconds 200
}
# 命中后立刻断电（记录时间戳）
$stopAt = (Get-Date).ToUniversalTime().ToString('o')
& $wsb stop --id s4rec1
$stopAt | Tee-Object -FilePath "$R\host-stop-at.txt"
```

预期：

- `prepared-hit.json` 里 `kind='prepared'`、`journal.phase='prepared'`、`journalCopyExact=true`、
  `journalBytes > 0`、`transactionDirs` 里至少一条 `kind='stage'` 且 `files`/`bytes` 非零；
- 复制出的 `journal-prepared.json` 与 `journalCopySha256` 一致；
- `wsb stop` 返回后 `list --raw` 里该 id 消失；
- **窗口很短**：从 `phase=prepared` 到 `committed` 只有数秒到数十秒，看到 hit 就 stop，不要先看内容。

若命中 `prepared-missed.json`（断电太晚，已越过 prepared）或 `prepared-timeout.json`：本轮**无效**，
保留文件、按第 3.1 节记录原因，回到步骤 1 用 `-Reset` 重做。**不得**用「反正已升级成功」冒充恢复。

### 步骤 6 — 重新启动沙盒（第二次启动，同一 id）

```powershell
& $wsb start -c D:\Codex\xjy-release-20261022\recovery-170-drill\recovery-170.wsb --id s4rec1
& $wsb exec --id s4rec1 -c "powershell -NoProfile -ExecutionPolicy Bypass -File C:\XjyResults\01-seed.ps1 -Mode Attach" -r ExistingLogin --raw
```

预期：`seed-result.json` 里 `mode='Attach'`、`ok=True`、`steps` 含 `vhd`（`attached label=XJYF`）与
`attach-counts`（program 1083 文件 / 549,067,265 字节，data 1176 / 2,394,718,644）；
`F:` 重新可见且内容还在。**Attach 不会格式化、不会重铺**——这是它与 Fresh 的唯一区别。

同时确认断电现场还在：

```powershell
Get-ChildItem 'F:\自制软件' -Force | Select-Object Name,Mode            # 应能看到 .xjy-jewelry-offline.xjy-engine-state 与 .engine-stage-*
Get-Content 'F:\自制软件\.xjy-jewelry-offline.xjy-engine-state\journal.json' -Raw
```

预期：journal 仍是 `phase=prepared` 的那份（同一个 `transactionId`）；stage 目录仍在。

### 步骤 7 — 执行真实恢复

```powershell
$pkg='F:\XjyLocal'
cmd /c "powershell -NoProfile -ExecutionPolicy Bypass -File %pkg%\安装组件\native-delivery-170.ps1 -PackageRoot %pkg% -Action Recover 1> C:\XjyResults\recover-stdout.txt 2> C:\XjyResults\recover-stderr.txt & echo %errorlevel% > C:\XjyResults\recover-exit.txt"
```

等价写法（避免 `%pkg%` 在 cmd 里的展开问题）：直接在 guest PowerShell 里

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File 'F:\XjyLocal\安装组件\native-delivery-170.ps1' -PackageRoot 'F:\XjyLocal' -Action Recover *> C:\XjyResults\recover-console.txt
$LASTEXITCODE | Set-Content C:\XjyResults\recover-exit.txt
```

预期：

- `recover-exit.txt` = `0`；
- `recover-console.txt` 里能看到恢复结果（`recovered: true`、`version: 1.6.2` 一类字段）；
- `journal.json` 的 `phase` 变成 `rolledback`；
- `F:\自制软件\xjy-jewelry-offline\version` 回到 `44.7.0`；
- stage 目录**仍然保留**（回滚不删 stage，它是证据）。

失败处置：若报 `ROLLBACK_FORBIDDEN` / `RECOVERY_REQUIRED` / `恢复未获确认，请保留现场。`——
**保留现场，原样记录**，直接进步骤 8 采集，把失败作为结论；不要手工改 journal、不要删目录重试。

### 步骤 8 — 恢复后采集（03-verify-after）

```powershell
& $wsb exec --id s4rec1 -c "powershell -NoProfile -ExecutionPolicy Bypass -File C:\XjyResults\03-verify-after.ps1" -r ExistingLogin --raw
```

预期（`recover-verify.json`）：

- `verdict.verdict = 'ROLLED-BACK-162'`
- `verdict.recovered = true`、`verdict.backTo162 = true`、`verdict.dataIntact = true`
- `journal.phase = 'rolledback'`、`journal.rollbackForbidden = false`、`journal.runtimeWrites = false`
- `marker.programVersion = '1.6.2'`、`marker.sha256` 与种子一致
- `version.raw = '44.7.0'`
- `installRoot.files = 1083`、`installRoot.bytes = 549067265`、`installRoot.matchesSeed = true`
- `dataRoot.files = 1176`、`dataRoot.bytes = 2394718644`、`dataRoot.matchesSeed = true`
- `transactionDirs` 里 retains 至少一条 `stage`
- `recoveryLogs` 至少含 `recover-stdout.txt` / `recover-console.txt` 中的一份
- `verify.log` 末行 `VERIFY-DONE ROLLED-BACK-162`

### 步骤 9 — 停机 + 宿主归档（04-collect）

```powershell
& $wsb stop --id s4rec1
cd D:\Codex\xjy-release-20261022\recovery-170-drill
powershell -NoProfile -ExecutionPolicy Bypass -File .\04-collect.ps1
```

预期：

- 输出 `COLLECT-DONE <n> <m> verdict=ROLLED-BACK-162 watch=prepared-hit`；
- `D:\Codex\xjy-release-20261022\evidence-s4-recovery\` 下出现：`seed-result.json`、`seed.log`、
  `watch-trace.log`、`journal-prepared.json`、`prepared-hit.json`、`recover-verify.json`、`verify.log`、
  `recover-*.txt`、`scripts\`（4 个脚本 + README）、`collect-manifest.json`、`INDEX.md`；
- `INDEX.md` 的 Outcome 表里 `recovered=true`、`back to 1.6.2=true`、`business data equals seed=true`；
- `INDEX.md` 的 "Expected but not present" 段为空。

## 7. 结论怎么写（唯一允许的三种措辞）

1. **恢复成功**：V1–V4 全成立且 A、B、C 全成立。写「断电落在 prepared，恢复分支把装机回滚到 1.6.2，
   程序树与业务数据均与断电前等量」。
2. **恢复失败**（有效轮次，但 A/B/C 有任一不成立，或出现 `ROLLBACK-FAILED` / `OTHER:*`）：写清断点 phase、
   journal 内容、两棵树差异、恢复日志原文。**这是本次演练最有价值的产出**。
3. **本轮无效**（`prepared-missed` / `prepared-timeout` / 已 `COMMITTED-170` / 有人工干预）：写清为什么无效，
   保留证据，重建后重做。**不得**把无效轮次改写为成功。

任何情况下都不允许：重装顶替、手工搬文件顶替、删除 state/stage 后重跑顶替、修改判定标准顶替。

## 8. 故障对照表

| 现象 | 含义 | 处置 |
| --- | --- | --- |
| `SEED-FAIL vhd did not appear` | diskpart 建/挂/分配盘符失败 | 看 `seed.log` 里 `diskpart output`；确认 `C:\XjyResults` 可写；用 `-Mode Fresh -Reset` 重来 |
| `NATIVE_ACL_REFUSED` | 文件 DACL 被清空 | 01 的 `acl-explicit-*` 段没跑到；按日志确认两步 icacls 都 exit=0 |
| `Path changed or alias used` | 交付脚本从映射盘启动（reparse） | 必须从 `F:\XjyLocal` 启动 |
| `EXISTING_HOST_DATA` | 误用了首装流程 | 本演练不使用首装；检查是否点错入口 |
| `PROGRAM_IN_USE` | 程序没关，prepared 之后卡在 `closed()` | 关掉 1.6.2 窗口；本轮作废须知：窗口会一直停在 prepared，此时断电仍属有效 prepared 断电 |
| `RECOVERY_REQUIRED` | 已有未收尾事务 | 先按步骤 7 恢复；恢复成功后再点升级仍会报，属正常 |
| `ROLLBACK_FORBIDDEN` | 断电点在 `committed` 之后 | 该轮无效；`COMMITTED-170`，重建重做 |
| `F: did not appear after diskpart attach` | VHD 被占用，或已被 Windows 自动挂成别的盘符 | 先用同一 `--id` 跑一次 `wsb stop`；01 的 Attach 会先 `detach vdisk` 再 `attach vdisk` + `assign letter=F`；确认没有任何进程打开 `C:\XjyResults\XjyF.vhdx` |
| `prepared-timeout.json` | 40 分钟内没出现 journal | 升级没真正启动（看 `upgrade-stderr.txt`）；确认 state 路径与实测一致 |
| `prepared-missed.json` | 窗口被越过 | 断电太晚；重建重做 |

## 9. 参考出处（便于复核）

- `D:\Codex\xjy-1.7.0\c28-repair-source\engine-tree-runtime170.cjs`
  - `:243` `pack()` journal 信封；`:251` `save()` 原子写
  - `:291` `transactionPaths()`（`.xjy-jewelry-offline.engine-stage-<uuid>` 等）
  - `:382-403` `rollback()`（`ROLLBACK_FORBIDDEN` 条件、prepared 现场的 no-op move、最后重启 source）
  - `:424-457` `installCandidate()`（prepared → old-renamed → new-published → committed；`RECOVERY_REQUIRED` 守卫）
  - `:473-497` `recoverCandidate()`（各 phase 的返回码）
- `D:\Codex\xjy-1.7.0\c28-repair-source\受信助手\project\desktop\engine-startup-gate.cjs:37`
  （state 目录命名规则）与 `readEngineStartupGate`（1.7.0 启动门、`ENGINE_RECOVERY_REQUIRED`）
- `D:\Codex\xjy-1.7.0\c28-candidate\build\package\安装组件\native-delivery-170.ps1`
  （`-Action Recover` → `--recover`；要求 `result.recovered -eq $true`）

## 10. 交付前自检（编写本目录时已做，如实记录）

| 项目 | 结果 |
| --- | --- |
| [System.Management.Automation.Language.Parser]::ParseFile | 4 个脚本均 **0 错误** |
| 纯 ASCII 校验（逐字节 > 127 计数） | 4 个脚本均 **0**，无 BOM |
|  2-watch-prepared.ps1 冒烟 | 用临时目录伪造 {payload,mac} 信封 journal（phase=prepared）+ 一个 .engine-stage-* 目录：命中并写出 prepared-hit.json，journalCopyExact=true，	ransactionDirs 为数组且统计到 iles=2 bytes=3；-TimeoutMinutes 0 分支正确写出 prepared-timeout.json（journalPresent=false、phases=[]） |
|  3-verify-after.ps1 冒烟 | 用临时目录伪造「rolledback journal + marker 1.6.2 + version 44.7.0 + 与种子等量的两棵树」：判出 ROLLED-BACK-162、ecovered=true、installMatchesSeed=true、dataMatchesSeed=true、ecoveryLogs 收到日志 |
|  4-collect.ps1 冒烟 | 用临时目录（不写 vidence-s4-recovery）跑通：输出 COLLECT-DONE 8 0，生成 INDEX.md + collect-manifest.json，必选/可选文件区分正确 |
|  1-seed.ps1 | **未执行**。它要建 VHD、改 ACL、注册表键，属于「安装类操作」；按本次任务约定只写不跑。首次真跑前请先做步骤 0 预检 |

冒烟测试只在 %TEMP%\s4smoke* 下进行，未创建任何 VHD、未改任何 ACL/注册表、未触碰 vidence-s4-recovery\，也未接触任何生产目录。