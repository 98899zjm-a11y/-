# S4 · 断电式真实失败恢复 —— 操作手册（只读准备材料）

本文是**准备材料**，不是执行记录。目录里的三个 PowerShell 脚本 + 本手册，是为了让"升级到一半真断电、
再从同一现场恢复"这一轮验收（下称 S4）可以被重复执行、并且证据链可判读。

**本目录在准备阶段没有启动沙盒、没有执行任何安装或升级、没有改动任何既有文件。**
三个 `.ps1` 只在 `%TEMP%` 的假树（人工造的安装根 / 数据根 / journal.json）上跑过 smoke test。

`.ps1` 正文强制 7-bit ASCII、中文一律用 `[char]0xXXXX` 码点拼，原因与既有脚本一致：Windows PowerShell 5.1
会把无 BOM 的 UTF-8 当 ANSI 解码，字面中文会直接语法错误。本 README 是文档，所以照常用中文写。

---

## 1. 前提事实（这些是实测结论，不要凭印象改）

| 项 | 事实 |
| --- | --- |
| 沙盒配置 | `D:\Codex\xjy-accept-170\accept-upgrade-170.wsb`，宿主侧用 `Start-Process` 关联启动（或直接双击 `.wsb`） |
| 映射 | `candidate\build\package` → `C:\XjyPackage`（只读）、`public` → `C:\XjyReleaseControl`（只读）、`guest-results` → `C:\XjyResults`（可写）、`legacy-root` → `C:\XjySeedRoot`（只读）、`legacy-data` → `C:\XjySeedData`（只读） |
| 宿主证据目录 | `D:\Codex\xjy-release-20261022\guest-results\`（= guest 的 `C:\XjyResults`，双向可见） |
| CLI | `C:\Users\Administrator\AppData\Local\Microsoft\WindowsApps\wsb.exe`，子命令 `start -c <wsb> [--id <id>]`、`list --raw`、`exec --id <id> -c "<cmd>" -r ExistingLogin --raw`、`stop --id <id>` |
| `exec` 的坑 | **不回传 stdout**。任何 guest 结果都必须写进 `C:\XjyResults\`，宿主再从 `guest-results\` 读 |
| 单实例纪律 | 同一时刻只允许一个实例写 `guest-results\`。动任何东西之前先 `wsb.exe list --raw` |
| guest 内必做 | 建 F: 卷（8GB vhdx，NTFS）、`icacls C:\ /remove:g *S-1-5-11`、`icacls F:\ /remove:g *S-1-5-11 /T /C /Q`、把干净 1.6.2 树 robocopy 到 `F:\自制软件\xjy-jewelry-offline`、数据 robocopy 到 `F:\鑫金源珠宝资料`、`C:\XjyPackage` → `C:\XjyLocal` 后做 `icacls /inheritance:r` + 三个 SID 显式 `F`（**必须再做一次不带 `(OI)(CI)` 的文件级授权**，否则文件 DACL 被清空 → 后续 `Access is denied`） |
| 升级入口 | `C:\XjyLocal\一键升级.cmd`（内部 PowerShell 隐藏窗口 + 模态审批：先"鑫金源珠宝 1.7.0 重复升级审定"窗体点"开始核验并安装"，再"负责人最终确认" `#32770` 点"是"） |
| 事务记录 | `<安装根>\.program.xjy-engine-state\journal.json`，`phase` 依次 `prepared` → `old-renamed` → `new-published` → `committed`；`prepared` 阶段会建 `.program.engine-stage-<uuid>` 目录 |
| 恢复语义 | 同一 `一键升级.cmd` → 引擎走 `recoverCandidate()`；worker 返回 `recovered:true`，并伴随 `completed:true`（停在 1.7.0）或 `rolledBack:true`（回到 1.6.2） |

---

## 2. 文件清单

| 文件 | 运行侧 | 作用 |
| --- | --- | --- |
| `watch-phase.ps1` | guest | 轮询 journal.json；第一次见到 `phase=prepared` 就把 journal 逐字节复制成 `journal-prepared.json`、把 stage 目录清单写进 `phase-prepared.json`，然后退出（**不关机、不 kill**）。超时写 `phase-timeout.json`（退出码 2），越过 `prepared` 写 `phase-missed.json`（退出码 3） |
| `verify-install.ps1` | guest | 只读采集：激活文件、`version`、安装根/文件数/字节、`.program.xjy-engine-state` 的 phase、`F:\鑫金源珠宝资料` 文件数/字节、`C:\XjyResults\*.log` 末 30 行、worker 输出里的 `recovered/completed/rolledBack`，写 `verify-install.json`，退出码恒 0 |
| `collect-host.ps1` | 宿主 | 把 `guest-results\` 里与恢复相关的 json/log 复制到 `evidence-s4-recovery\`，并按 21 条清单生成 `INDEX.md`（含 sha256 前 16 位、缺失项、判读要点） |
| `README.md` | — | 本文件 |

复用既有 guest 助手（都在 `guest-results\` = `C:\XjyResults\`）：`01-bootstrap.ps1`（建卷/ACL/铺 `C:\XjyLocal`/自检）、
`ClickApprove2.ps1`（点"开始核验并安装"）、`ClickYes.ps1`（点 `#32770` 的"是"）、`DialogRead.ps1` / `DumpWins.ps1`（窗口取证）、
`S3ProbeB.ps1`（进程 / `LOCALAPPDATA\Xjy*` / F: 空间探针）。

---

## 3. 必须先解决的物理问题：F: 卷活不过 `wsb stop`

**这是本轮 S4 的头号风险，先读再动手。**

`C:\XjyF.vhdx` 落在 guest 的 `C:` 上，而 `C:` 是沙盒实例的临时盘。`wsb stop` 会销毁实例，
`C:` 连同 vhdx 一起消失 —— F: 卷、安装根、数据根、以及 `.program.xjy-engine-state\journal.json` 全部随之消失。
**在默认铺法下，"重启后直接复用上次断电后的 F: 卷"是不成立的**，那时既没有 F:，也没有 journal。

所以要让 S4 成立，必须先让 vhdx 落到**断电后仍然存在**的位置。两条路径，任选其一，但必须在前置校验里证明它成立。

### 路径 A（推荐，确定性最高）：把 vhdx 预置在持久映射里

`C:\XjyResults` 映射到宿主 `guest-results\`（可写、宿主可见、实例销毁后仍在）。把 vhdx 建在这里，
断电重启后从同一文件 attach 即可拿回同一个卷。

铺基线时**先**在 guest 里建持久卷（早于 `01-bootstrap.ps1`）：

```bat
:: C:\XjyResults\mkf-persist.txt
create vdisk file=C:\XjyResults\XjyF.vhdx maximum=8192 type=expandable
select vdisk file=C:\XjyResults\XjyF.vhdx
attach vdisk
create partition primary
format fs=ntfs quick label=XjyF
assign letter=F
exit
```

```bat
diskpart /s C:\XjyResults\mkf-persist.txt
fsutil fsinfo drivetype F:
```

看到 `F: - Fixed Drive` 之后再跑 `01-bootstrap.ps1`：它检测到 F: 已存在会**整步跳过建卷**，
只做 ACL 去世界可写、robocopy 铺 `C:\XjyLocal`、两步 ACL 硬化与自检。

重启后要找回 F: 时，**只 attach、不 format**：

```bat
:: C:\XjyResults\attach-persist.txt
select vdisk file=C:\XjyResults\XjyF.vhdx
attach vdisk
select partition 1
assign letter=F
exit
```

```bat
diskpart /s C:\XjyResults\attach-persist.txt
fsutil fsinfo drivetype F:
```

**预演（做 S4 之前先做这一步，5 分钟）**：建好持久卷后，`diskpart` 里 `detach vdisk`，再跑一次
`attach-persist.txt`，确认 `F:` 还是 `Fixed Drive` 且安装根/数据根都在。预演不过就地停住，
不要继续 S4（否则断电后必然没有现场）。

风险（未验证）：diskpart 可能不接受"映射目录里的 vhdx 路径"。若 `create vdisk` / `select vdisk` 报错，
**停在这一步**，不要退回去把 vhdx 建在 `C:` 上再继续跑升级 —— 那样断电后一定丢现场。

### 路径 B（未验证）：`wsb start --id <同一个 id>` 是否恢复同一实例

CLI 的 `start` 带 `--id`，但它是否等于"恢复上次那个实例"取决于实现，本轮没有启动沙盒，无法验证。
如果它能恢复，`C:` 与 F: 都还在，S4 可以完全按本文时序走。**用第 3.1 节的前置校验判定**：
校验不过就立刻转路径 A，不要猜。

### 3.1 前置校验（每次重启后、点升级前必跑，并留证据）

```bat
powershell -NoProfile -ExecutionPolicy Bypass -File C:\XjyResults\verify-install.ps1
copy /y C:\XjyResults\verify-install.json C:\XjyResults\verify-preflight.json
```

| 检查项 | 期望 | 不通过说明 |
| --- | --- | --- |
| `hints.installRootExists` | `true` | 安装根没了 → F: 没找回来 |
| `hints.journalPhase` | `prepared` | 不是 `prepared` → 断电时机不对（已 `committed`/`rolledback`），本轮不成立 |
| `hints.dataFileCount` / `dataBytes` | 与 `verify-baseline.json` 一致 | 数据面已受损，先查数据根再说 |
| `hints.stageDirCount` | `> 0`（断电时正在建 stage） | `0` 说明现场不是断电那一刻，判读要重新解释 |
| `engineState.journalBytes` | `> 0` | journal 读不到 = 现场已丢 |

`verify-preflight.json` 里任意一项不达标，本轮 S4 **不成立**。不得用"重新铺一遍再升级成功"顶替恢复证据。

---

## 4. 操作时序

`<ID>` 为 `wsb.exe list --raw` 给出的实例 Id。下文宿主命令都在普通 PowerShell 里跑，guest 命令都在沙盒内的管理员控制台跑。

### S4-0 宿主准备（一次性）

```bat
wsb.exe list --raw
:: 只应看到 0 个，或本轮自己那个实例
```

把 `watch-phase.ps1`、`verify-install.ps1`、`01-bootstrap.ps1`、`ClickApprove2.ps1`、`ClickYes.ps1`
放进宿主 `D:\Codex\xjy-release-20261022\guest-results\`（= guest `C:\XjyResults\`）。

### S4-1 启动沙盒（宿主）

```powershell
Start-Process "C:\Users\Administrator\AppData\Local\Microsoft\WindowsApps\wsb.exe" `
  -ArgumentList '-c','D:\Codex\xjy-accept-170\accept-upgrade-170.wsb'
wsb.exe list --raw
```

记下 Id 作为 `<ID>`。

### S4-2 铺基线（guest）

1. 路径 A：先建持久卷（`mkf-persist.txt`）+ 预演 detach/attach（见第 3 节）。路径 B：跳过，交给 `01-bootstrap.ps1` 建卷。
2. 跑 `01-bootstrap.ps1`，末行必须是 `BOOTSTRAP-OK`：

```bat
powershell -NoProfile -ExecutionPolicy Bypass -File C:\XjyResults\01-bootstrap.ps1
```

3. 采基线（这一步定义后面"业务数据不变"的基准）：

```bat
powershell -NoProfile -ExecutionPolicy Bypass -File C:\XjyResults\verify-install.ps1
copy /y C:\XjyResults\verify-install.json C:\XjyResults\verify-baseline.json
```

末行 `VERIFY-OK`，且 `hints.installRootExists=true`、`hints.journalPhase` 为 `none`（还没有升级事务）。

4. 可选：`powershell -File C:\XjyResults\S3ProbeB.ps1` 留一份 F: 空间/进程快照。

### S4-3 并行：先起 watcher，再起升级

guest 管理员控制台，**先**把 watcher 挂成独立隐藏进程（它只读 journal，不会干扰升级）：

```bat
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File C:\XjyResults\watch-phase.ps1'"
```

等 2 秒，确认 `C:\XjyResults\phase-watch.log` 出现 `watcher start` 行（`type C:\XjyResults\phase-watch.log`）。
如果 journal 变化很快，可加 `-PollSeconds 1` 提高命中率。

然后启动升级（**它自己会弹审批窗口，不要提前点**）：

```bat
C:\XjyLocal\一键升级.cmd
```

`一键升级.cmd` 的文件名是中文，直接在 guest 控制台粘贴路径回车即可。

### S4-4 审批（guest，两段）

等 5–10 秒，出现"鑫金源珠宝 1.7.0 重复升级审定"窗口后：

```bat
powershell -NoProfile -ExecutionPolicy Bypass -File C:\XjyResults\ClickApprove2.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File C:\XjyResults\ClickYes.ps1
```

`ClickYes.ps1` 可能要连跑几次（`#32770` 弹窗出现有先后）。不确定当前有没有弹窗就先：

```bat
powershell -NoProfile -ExecutionPolicy Bypass -File C:\XjyResults\DialogRead.ps1
```

`DIALOGS=0` 表示当前没有弹窗。

### S4-5 断电（宿主侧，本轮最关键的一步）

宿主上轮询等待 `phase-prepared.json` 出现，**一出现立刻**停实例：

```powershell
$src = 'D:\Codex\xjy-release-20261022\guest-results'
while (-not (Test-Path (Join-Path $src 'phase-prepared.json'))) { Start-Sleep -Milliseconds 200 }
$stopAt = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss.fffzzz')
wsb.exe stop --id <ID>
$p = Get-Content (Join-Path $src 'phase-prepared.json') -Raw | ConvertFrom-Json
@{ event = 'wsb-stop'; at = $stopAt; sandboxId = '<ID>'; preparedAt = $p.at; note = 'power-cut at prepared' } |
  ConvertTo-Json | Set-Content (Join-Path $src 's4-host-stop.json') -Encoding UTF8
```

**纪律（违反则本轮证据作废）**：

- 只在**宿主侧** `wsb stop` 模拟断电；**绝不在 guest 内** `taskkill` / `Stop-Process` / `shutdown` 杀升级进程。
- 不要先点完所有确认再断电 —— 断电必须发生在 `prepared` 之后、`committed` 之前。
- `stop` 之后不要再对 guest 做任何操作（不要 `exec` 进去补命令），现场就此冻结。

### S4-6 记录断电前一刻的 journal 副本

`journal-prepared.json` 已经是 watcher 在 `prepared` 瞬间对 journal 的**逐字节复制**（已用 `cmp` 验过一致）。
判读时只用它，**不要**用恢复后的 journal 当断电证据（恢复会改写 journal）。

### S4-7 重启沙盒

```powershell
# 路径 A：用同一个 .wsb 重新起一个实例
Start-Process "C:\Users\Administrator\AppData\Local\Microsoft\WindowsApps\wsb.exe" `
  -ArgumentList '-c','D:\Codex\xjy-accept-170\accept-upgrade-170.wsb'
wsb.exe list --raw

# 路径 B（待验证）：尝试恢复同一实例
wsb.exe start --id <同一个ID> -c D:\Codex\xjy-accept-170\accept-upgrade-170.wsb
```

记下新 Id（下称 `<ID2>`）。

### S4-8 重新引导（F: 不重新格式化，直接复用）

1. 路径 A：把持久卷 attach 回 F:（**只 attach + assign，不 format**）：

```bat
diskpart /s C:\XjyResults\attach-persist.txt
fsutil fsinfo drivetype F:
```

2. 重新铺 `C:\XjyLocal`（映射盘直接跑会被判 `Path changed or alias used`，必须重新 copy 一份）：

```bat
powershell -NoProfile -ExecutionPolicy Bypass -File C:\XjyResults\01-bootstrap.ps1
```

F: 已存在 → 脚本跳过建卷分支，只做 ACL 与 `C:\XjyLocal` 的 robocopy + 两步 ACL。末行仍须 `BOOTSTRAP-OK`。

3. **前置校验**（决定这一轮能不能继续，见 3.1 节）：

```bat
powershell -NoProfile -ExecutionPolicy Bypass -File C:\XjyResults\verify-install.ps1
copy /y C:\XjyResults\verify-install.json C:\XjyResults\verify-preflight.json
```

`hints.journalPhase` 必须仍是 `prepared`、`stageDirCount > 0`、数据数/字节与 `verify-baseline.json` 一致。
任何一项不达标 → **停**，本轮不成立，不要继续点升级。

### S4-9 跑恢复升级

```bat
C:\XjyLocal\一键升级.cmd
```

同样两段审批（`ClickApprove2.ps1` → `ClickYes.ps1`）。引擎这次走 `recoverCandidate()`，
结束后 `C:\XjyResults\` 会出现 `upgrade-*.log` 与 worker 的结构化输出。

预期：worker 返回 `recovered:true`，并带 `completed:true`（停在 1.7.0）或 `rolledBack:true`（回到 1.6.2）。

### S4-10 取结果 + 收证据

guest：

```bat
powershell -NoProfile -ExecutionPolicy Bypass -File C:\XjyResults\verify-install.ps1
```

宿主：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:\Codex\xjy-release-20261022\recovery-170-runbook\collect-host.ps1
```

默认源目录 `guest-results\`、目标 `evidence-s4-recovery\`，生成 `INDEX.md`（21 条清单 + 缺失项 + 判读要点）。
想连历史基线一起归档再加 `-IncludeBaseline`。

---

## 5. 判定标准

六条全中才算 S4 通过；任何一条不中都要按第 6 节取证后再判。

| # | 判据 | 通过的样子 | 不通过的含义 |
| --- | --- | --- | --- |
| 1 | 断电证据链完整 | `phase-prepared.json` + `journal-prepared.json`（其中 `phase` 就是 `prepared`）+ `s4-host-stop.json` 的 `at` **晚于** `phase-prepared.json` 的 `at`；`phase-watch.log` 有对应心跳 | `phase-missed.json` / `phase-timeout.json` → 本轮没形成断电窗口，重做 |
| 2 | 恢复确实跑过 | `verify-install.json` 的 `hints.recoveredSeen` 非空，或 `workerOutputs[].recovered=true` | 没有 `recovered` → 引擎没走恢复流程，本轮不是恢复 |
| 3 | 终态明确 | `completed:true` 且 `version=1.7.0`（`phase=committed`）**或** `rolledBack:true` 且 `version=1.6.2`（`phase=rolledback`）；`version` 文件与 `xjy-install-activation.json` 与之相符 | "既没 completed 也没 rolledBack" = 半截事务，本轮判不通过 |
| 4 | 业务数据不变 | `verify-install.json` 的 `hints.dataFileCount` / `dataBytes` 与 `verify-baseline.json` 完全一致 | 数据面受损，无论升级是否成功都判不通过 |
| 5 | 无残留 stage 被当作有效目标 | `journal.paths.installationDir` 仍是 `F:\自制软件\xjy-jewelry-offline`；安装根还是那个目录，**不是** `.program.engine-stage-*` | 有 stage 目录本身可以接受（保留现场），但把它当成新安装目标就是失败 |
| 6 | 现场保真 | 重启后 `verify-preflight.json` 的 `journalPhase` 仍是 `prepared`、`stageDirCount>0` | 断电时已 `committed` → 这轮其实测的是"提交后重启"，不是断电恢复 |

判读口径与 `INDEX.md` 第 4 节保持一致（两处措辞相同，便于交叉核对）。

---

## 6. 失败码含义与取证

| 代码 | 含义（引擎原文口径） | 现场该抓什么 |
| --- | --- | --- |
| `RECOVERY_REQUIRED` | 现有恢复记录未知、不完整或绑定冲突；停止本次审定。另外两种同码情形：补丁事务目录存在但原恢复门禁缺失（不会创建替代门禁）；完成/回退记录与当前安装版本不一致。本质是**引擎拒绝覆盖已保留的失败现场** | `journal.json`（恢复后）+ `journal-prepared.json`（断电时）；`<安装根>\.xjy-initial-upgrade\recovery-status.json`；`upgrade*.log` 全文；`verify-install.json` 的 `engineState` / `initialUpgrade` / `workerOutputs`；必要时 `DialogRead.ps1` 抓弹窗原文 |
| `STAGE_OWNERSHIP_UNPROVEN` | mkdir 窗口内目录出现但无法证明归属（stage 意图无法自证），引擎**停止并保留**，不替你猜 | `phase-prepared.json` 的 stage 清单（目录名 / 文件数 / 字节 / 时间）；断电前 `F:\` 根目录 listing（`dir /a F:\`）；恢复后 `verify-install.json` 的 `stages`；journal 的 `identities.stage` |
| `NATIVE_ACL_REFUSED` | 原生 ACL 写入或校验被拒 —— 路径/祖先链上有其它身份可写，或文件 DACL 被清空（只做 `(OI)(CI)` 的典型后果） | `verify-install.json` 的 `machine.userSid` / `isElevated` / `errors[]`、`installRoot.topLevel`；`upgrade*.log` 与 `fresh-host-local*.log` 尾 30 行；再在 guest 里 `icacls C:\XjyLocal` 与 `icacls F:\` 对照规则 |

其它可能撞到的（不属于本 S4 的三个主码，但判读时会看到）：
`EXISTING_HOST_DATA`（数据根已存在，不是干净基线）、`ROLLBACK_FORBIDDEN`（已 `committed` 还要求回退）、
`Path changed or alias used`（从映射盘直接跑入口）、`审定路径允许其他 Windows 身份替换或修改受保护对象`（ACL 家族）。

---

## 7. 已知坑

| 现象 | 原因 | 处置 |
| --- | --- | --- |
| `verify-install.ps1` 在 guest 里卡住不返回 | PS 5.1 的 `ConvertTo-Json` 对 `Get-Content` 直接返回的字符串实例会**无限循环**（实测：同样内容作为字面量或重建的字符串实例是毫秒级） | 脚本第 7 段已把每行重建为 `[string]::new($ln.ToCharArray())` 再序列化；**不要"顺手"删掉这段规范化**，也不要改回直接塞 `Get-Content` 的结果 |
| `exec` 跑完看不到输出 | `wsb exec` 不回传 stdout | 一切结果写 `C:\XjyResults\`，宿主从 `guest-results\` 读 |
| 两个实例互相覆盖证据 | 沙盒是单实例设计 | 起新实例前先 `wsb stop` 清干净，`wsb list --raw` 确认 |
| 断电后 F: 与 journal 都没了 | vhdx 建在 guest 的 `C:` 临时盘上 | 见第 3 节，改用持久卷（路径 A）；本轮若无现场，不得用重装顶替 |
| `phase-missed.json` | `prepared` 窗口比轮询间隔短 | 用 `-PollSeconds 1` 重跑；本轮证据作废 |
| `phase-timeout.json` | 40 分钟内没见到 `prepared` | 升级根本没走到事务阶段（看 `upgrade*.log` 是不是卡在审批或 ACL） |
| 宿主与 guest 时间对不上 | 两台时钟不同源 | `at` 一律用同一台机器（宿主）的时钟对照；`s4-host-stop.json` 在宿主侧生成 |

---

## 8. 判读要点

- `recovered:true` 只说明**恢复流程跑过**；必须再分 `completed:true`（停在 1.7.0）与 `rolledBack:true`（回到 1.6.2）。
- `RECOVERY_REQUIRED` —— 恢复记录未知/不完整/绑定冲突，或补丁事务目录在而门禁缺失。抓：journal.json、`.xjy-initial-upgrade\recovery-status.json`、`upgrade*.log` 全文。
- `STAGE_OWNERSHIP_UNPROVEN` —— mkdir 窗口内出现目录但无法证明归属。抓：`phase-prepared.json` 的 stageDirs 清单 + 断电后 `F:\` 根目录 listing。
- `NATIVE_ACL_REFUSED` —— 原生 ACL 写入被拒。抓：`verify-install.json` 的 `machine.userSid` / `isElevated`、安装根 `topLevel`、对应日志尾部。
- 业务数据 —— `verify-install.json` 的 `dataFileCount` / `dataBytes` 必须与基线一致；不一致即视为数据面受损，无论升级是否成功。
- 残留 stage —— `hints.stageDirCount > 0` 时，必须确认没有任何 stage 目录被当作新的有效安装目标（安装根仍指向 `xjy-jewelry-offline`，而不是 `.program.engine-stage-*`）。

---

## 9. 边界声明

- 本目录只新增文件：`watch-phase.ps1`、`verify-install.ps1`、`collect-host.ps1`、`README.md`，
  以及 `collect-host.ps1` 运行时写出的 `evidence-s4-recovery\`。
- 准备阶段**没有**启动沙盒、**没有**执行安装/升级、**没有**改动 `D:\Codex\xjy-release-20261022\` 下的任何既有文件。
- 三个 `.ps1` 均通过 PowerShell 5.1 的 `[System.Management.Automation.Language.Parser]::ParseFile` 语法自检，
  并额外在 `%TEMP%` 的人工现场上跑过行为 smoke test（prepared 捕获 / 超时 / 越过窗口 / 带日志采集 / 证据归档）。
- 真跑 S4 时，guest 侧脚本只会往 `C:\XjyResults\` 写新文件；`watch-phase.ps1` 与 `verify-install.ps1` 都是只读采集，
  不会停机器、不会结束时进程、不会格式化卷。
