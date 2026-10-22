# 首装验收引导脚本（Windows Sandbox 内部）

给 **全新首次安装** 用的三件套：在沙盒里建 F: 卷 → 跑安装器 → 只读采集结果。
所有脚本都不含启动沙盒、安装器或改宿主仓库的逻辑，**只由你在沙盒内部手动依次执行**。

脚本正文全部 7-bit ASCII（中文路径一律用 `[char]0xXXXX` 码点拼），原因：Windows PowerShell 5.1
会把无 BOM 的 UTF-8 当 ANSI 解码，字面中文会直接触发语法错误。本 README 是纯文档，所以用中文写。

---

## 0. 生效前提（别跳过）

| 项 | 要求 |
| --- | --- |
| 沙盒配置 | `D:\Codex\xjy-accept-170\accept-fresh-170.wsb`（宿主双击 / `Start-Process` 启动，脚本不代劳） |
| 映射 | `candidate\build\package` → `C:\XjyPackage`（只读）、`public` → `C:\XjyReleaseControl`（只读）、`guest-results` → `C:\XjyResults`（可写） |
| 脚本落位 | 本目录三个文件要出现在 **guest 的 `C:\XjyResults\`**；也就是说先把它们放进宿主的 `guest-results\` 再启动沙盒 |
| 盘符 | 沙盒内没有 F:，由 `01` 建真实 VHDX 并挂成 F:（安装器把安装根写死为 `F:\自制软件\xjy-jewelry-offline`，数据根 `F:\鑫金源珠宝资料`） |
| 首装禁令 | **不要手工创建 `F:\鑫金源珠宝资料`**。它一旦存在（哪怕空目录），安装器直接报 `EXISTING_HOST_DATA 已存在主机资料，首次安装停止`。让安装器自己建 |

---

## 1. 执行顺序

沙盒内开 **管理员 PowerShell**（沙盒账号本身就是管理员，无需再提权）。

```bat
powershell -NoProfile -ExecutionPolicy Bypass -File C:\XjyResults\01-bootstrap.ps1
```

```bat
cmd /c C:\XjyResults\02-freshhost.cmd
```

```bat
powershell -NoProfile -ExecutionPolicy Bypass -File C:\XjyResults\03-status.ps1
```

顺序不能换：`02` 依赖 `01` 建好的 `C:\XjyLocal`，`03` 依赖 `02` 留下的日志和退出码。
三个脚本都可重复执行（幂等）：F: 已挂载就跳过建卷、`C:\XjyLocal` 用 robocopy 覆盖、ACL 重放、日志覆盖写。

### 1.1 `01-bootstrap.ps1` —— 建卷 + ACL + 复制

内部步骤（每一步都记进 `bootstrap.json` 的 `steps[]`，带耗时和退出码）：

1. `vhd-create-and-mount-F`：`diskpart /s` 跑内嵌生成的 `C:\XjyResults\mkf-bootstrap.txt`
   （`create vdisk file=C:\XjyF.vhdx maximum=8192 type=expandable` → `select` → `attach`
   → `create partition primary` → `format fs=ntfs quick label=XjyF` → `assign letter=F`）。
   **已存在 F: 固定卷则整步跳过**；`C:\XjyF.vhdx` 已存在（上次残留）只 `attach`、**不重新格式化**。
2. `acl-remove-world-from-C-root`：`icacls C:\ /remove:g *S-1-5-11`
3. `acl-remove-world-from-F-root`：`icacls F:\ /remove:g *S-1-5-11 /T /C /Q`
   （必须排在建卷/格式化之后，`format` 会把默认 ACL 还回来）
4. `robocopy-package-to-local`：`robocopy C:\XjyPackage C:\XjyLocal /E /MT:16 /R:1 /W:1`
   （包不能从映射目录直接跑，安装器会判 `Path changed or alias used`）
5. `acl-harden-local-inherit-and-grant`：`icacls C:\XjyLocal /inheritance:r /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F *<当前SID>:(OI)(CI)F /T /C /Q`
6. `acl-harden-local-explicit-file-grants`：**紧接的第二次授权**，不带继承标志：
   `icacls C:\XjyLocal /grant:r *S-1-5-18:F *S-1-5-32-544:F *<当前SID>:F /T /C /Q`
   （只做 `(OI)(CI)` 会把已有文件清成空 DACL，随后一切报 `Access is denied`）
7. `selfcheck`：`fsutil fsinfo drivetype F:`、`Test-Path C:\XjyLocal\首次安装主机.cmd`，
   然后对受保护对象跑 `Get-Acl`：`C:\XjyLocal`、入口 `.cmd` 本身、`F:\`（作为**祖先**看），
   存在时再加安装根与数据根。每个对象不仅查自身，还查**整条祖先链**
   （`C:\XjyLocal` 与入口 `.cmd` 的链就只剩 `C:\`）。
   判定**完整复刻**安装器的 `Assert-AclPolicy`（包内 `审批工具\Prepare-Repeat-Approval-170.ps1`）：
   - 允许身份只有 `{当前 SID, S-1-5-18, S-1-5-32-544}`；`C:\` 作为祖先时额外允许
     TrustedInstaller `S-1-5-80-956008885-…-2271478464`；**对象所有者本身也必须在这个集合里**；
   - 危险位 = `Delete` / `DeleteSubdirectoriesAndFiles` / `ChangePermissions` / `TakeOwnership`，
     **对象自身**再加 `Write`；
   - **祖先层不看 `Write`，并跳过 `InheritOnly`（只作用于子项）的规则** —— 所以卷根默认的
     `CREATOR OWNER (OI)(CI)(IO)F`、`Users` 的 `CreateDirectories` 都不会被误判；
   - 空 DACL（规则数 0）与 `Get-Acl` 读取失败同样记为问题：后者常是「文件 DACL 被清空」或
     权限不足的现场。

**预期输出**（`C:\XjyResults\bootstrap.json`）：

```json
{
  "ok": true,
  "failedStep": null,
  "fDrive": { "letter": "F:", "fsutil": "F: - Fixed Drive", "isFixed": true, "ready": true },
  "packageCopied": true,
  "aclProblems": [],
  "dataRootPresent": false,
  "warnings": [],
  "steps": [ { "name": "vhd-create-and-mount-F", "ok": true, "exitCode": null, "ms": 8123 }, "..." ]
}
```

控制台末行是 `BOOTSTRAP-OK`；失败时末行是 `BOOTSTRAP-FAILED step=<步骤名>`，进程退出码 1，
且 JSON 里 `ok=false`、`failedStep`、`error` 都会写实（异常不会被吞）。
伴随日志：`bootstrap-diskpart.log`、`bootstrap-robocopy.log`、`bootstrap-acl.log`、`mkf-bootstrap.txt`。

判读要点：

- `aclProblems[]` 非空 → 先看 `reason`：`world-write` = `S-1-5-11` 还留着（第 2/3 步没生效）；
  `other-principal-write` = 其它身份带危险位，`label` 末尾有 `:ancestor` 说明命中的是祖先链上的路径，
  按 `path` 字段用 `icacls <path>` 核对；`no-allow-rules` = 该对象 DACL 空了（第 6 步没生效）；
  `owner-not-trusted` = 所有者不在可信集合里；`acl-read-error` = 连 ACL 都读不出来。
- `aclChecks[]` 是同一份 JSON 里的逐路径取证：`label`、`path`、`ancestor`、`owner`、`ownerTrusted`、
  `ruleCount`、`worldSidRules`、`badRuleCount`、`error`。排查一律先看它再看 `aclProblems[]`。
- `dataRootPresent=true` → 这次不是干净首装，`02` 一定会撞 `EXISTING_HOST_DATA`，别继续。
- `fDrive.fsutil` 里必须是 `Fixed Drive`；`No Root Directory` 说明卷没挂上。
- `bootstrap.json` / `status.json` 都由脚本内置的**确定性 JSON 写入器**产出，不调用 `ConvertTo-Json`：
  PS 5.1 的那个 cmdlet 在本环境把一条裸字符串从 136 字符放大到 31031 字符并会挂住整脚本（实测）。
  所以不要「顺手」把脚本改回 `ConvertTo-Json`。

### 1.2 `02-freshhost.cmd` —— 跑首装

做的事情只有三行实质内容：`chcp 65001` → 解析出 `C:\XjyLocal\首次安装主机.cmd` 的完整路径 →
`cmd /c "… > C:\XjyResults\fresh-host-local.log 2>&1"`，然后**单独一行**读 `%ERRORLEVEL%` 写进
`C:\XjyResults\fresh-host-exit.txt`（同一行 `&` 链里读 errorlevel 会拿到链上上一条的错误码）。

入口文件名是中文，而本文件必须保持 ASCII，所以路径不是写死的，而是用 PowerShell 按码点重建
（`0x9996 0x6B21 0x5B89 0x88C5 0x4E3B 0x673A` + `.cmd`）再 `if exist` 校验，校验不过就报
`ENTRY-MISSING` 并把 `C:\XjyLocal` 下实际有哪些 `*.cmd` 写进 `entry-resolve-fail.txt`。

**预期输出**：

- 控制台：`FRESH-HOST-EXIT=0`（失败为 `FRESH-HOST-FAILED exit=<非0>`，退出码原样透传）
- `fresh-host-exit.txt`：单行数字，成功是 `0`
- `fresh-host-local.log`：安装器全程 stdout+stderr。**注意里面会夹杂 CLIXML**（`#< CLIXML` 和
  `<Objs …>`），那是 `powershell.exe` 写 stderr 的进度流，不代表失败
- 失败时日志末尾通常是：`安装或升级未确认完成…` / `worker 退出码为 N，不等于 0` / 具体停止原因
  （`EXISTING_HOST_DATA …`、`NATIVE_ACL_REFUSED`、`审定路径允许其他 Windows 身份替换或修改受保护对象`、
  `Path changed or alias used`、`Access is denied`）

### 1.3 `03-status.ps1` —— 只读采集

不改任何东西，只读四类信息写 `C:\XjyResults\status.json`（UTF-8 无 BOM，宿主可直接 `JSON.parse`；
同样由内置确定性写入器产出，见 1.1 末条）：

| 字段 | 内容 |
| --- | --- |
| `localAppDataXjy[]` | `%LOCALAPPDATA%` 下所有 `Xjy*` 目录的 `fileCount` / `bytes` / `lastWrite` |
| `installRoot` | `F:\自制软件\xjy-jewelry-offline` 是否存在、`topLevel[]`（名/是否目录/大小/时间）、`xjy-install-activation.json` 的 `activationJson`（解析结果）+ `activationRaw`（原文） + `activationError` |
| `engineState` | `.program.xjy-engine-state` 是否存在（`found`）、扫描过的 `searchedRoots[]`、每个命中的 `files[]`（相对路径 + 大小，超过 500 条置 `truncated`） |
| `freshHostLog` | `fresh-host-local.log` 的 `length` / `lastWrite` / `tail40[]`（末 40 行），以及 `fresh-host-exit.txt` 解析出的 `exitCode` |
| `errors[]` | 某一节采集失败时的 `where` + `message`（脚本照常写完 JSON，退出码 0） |

**预期输出**（首装成功后）：`activationExists=true`、`activationJson` 含激活信息、
`engineState.found=true`、`freshHostLog.exitCode=0`、`errors=[]`，控制台末行 `STATUS-OK`。
`engineState.found=false` 或 `activationExists=false` 就是首装没走完的直接证据。

---

## 2. 失败时怎么抓

三个脚本自身的日志已经在 `C:\XjyResults\` 里了。要看**安装器弹窗到底说了什么**，用
`guest-results` 里现成的两个助手（都从 `C:\XjyResults\` 调用，输出也落在那里）：

```bat
powershell -NoProfile -ExecutionPolicy Bypass -File C:\XjyResults\DialogRead.ps1
```
→ 枚举所有可见 `#32770` 对话框，把每次的标题与全部子控件文本写进 `C:\XjyResults\dialog.json`
（字段 `at`、`dialogs[].hwnd/pid/title/texts[]`）。控制台打印 `DIALOGS=<数量>`，`0` 表示当前没有弹窗。

```bat
powershell -NoProfile -ExecutionPolicy Bypass -File C:\XjyResults\DumpWins.ps1
```
→ 更宽的窗口快照（所有可见顶层窗口 + 子控件标题/类名）写进 `C:\XjyResults\wins2.json`，
用来找「弹窗已被点掉但进程挂在某个隐藏窗口」的情况。控制台打印 `DONE`。

配套的只读证据（同样在 `C:\XjyResults\`）：

- `fresh-host-local.log` 末 40 行 —— 已在 `status.json` 的 `freshHostLog.tail40`
- `bootstrap.json` 的 `aclProblems[]` —— ACL 类失败的根因
- `bootstrap-acl.log` —— 每一次 `icacls` 的原文输出与退出码
- `entry-resolve-fail.txt` —— `02` 没解析到入口脚本时列出 `C:\XjyLocal\*.cmd` 实际名单

`AclFind.ps1` / `AclLocal.ps1` / `AssertProbe.ps1` 那批旧探针仍在 `guest-results` 里，需要更深的
ACL 逐条 dump 可以照旧调用，但它们不属于本流程（`01`/`03` 已覆盖首装所需的自检）。

---

## 3. 已知坑速查

| 现象 | 原因 | 处置 |
| --- | --- | --- |
| `EXISTING_HOST_DATA 已存在主机资料，首次安装停止` | `F:\鑫金源珠宝资料` 已存在（含空目录） | 别手工建它；确认干净首装后换干净沙盒 |
| `NATIVE_ACL_REFUSED` / `审定路径允许其他 Windows 身份替换或修改受保护对象` | `S-1-5-11` 或其它身份在路径/祖先链上有写权 | 重跑 `01`，看 `bootstrap.json` 的 `aclProblems[]` |
| `Access is denied`（`C:\XjyLocal` 下） | 只做了 `(OI)(CI)`，文件 DACL 被清空 | 第 6 步的显式 `F` 二次授权；重跑 `01` 即可修复 |
| `Path changed or alias used` | 直接从 `C:\XjyPackage`（映射盘）跑 | 必须从 `C:\XjyLocal` 跑，`01` 已负责复制 |
| `01` 报 F: 不是 fixed volume | diskpart 失败 / 盘符未分配 | 看 `bootstrap-diskpart.log`；重跑 `01`（会走 attach + assign 重试分支） |
| `02` 报 `ENTRY-MISSING` | `C:\XjyLocal` 里没有入口脚本 | 先跑 `01`；看 `entry-resolve-fail.txt` 的名单 |

---

## 4. 文件清单

| 文件 | 说明 |
| --- | --- |
| `01-bootstrap.ps1` | 建 F: 卷 → 去 `S-1-5-11` → robocopy → 两步 ACL 硬化 → 自检，写 `bootstrap.json` |
| `02-freshhost.cmd` | 跑 `C:\XjyLocal\首次安装主机.cmd`，日志与退出码落 `C:\XjyResults\` |
| `03-status.ps1` | 只读采集，写 `status.json` |
| `README.md` | 本文件 |

三个脚本都不启动沙盒、不修改 `D:\Codex\xjy-release-20261022\` 下的既有文件；运行时只往
`C:\XjyResults\`（= 宿主 `guest-results\`）写新文件，以及在 guest 内创建 `C:\XjyF.vhdx` 和
`C:\XjyLocal`、挂载 F:。
