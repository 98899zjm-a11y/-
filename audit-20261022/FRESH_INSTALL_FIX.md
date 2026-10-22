# 首装可用性方案：让「全新主机 / 新员工机」一次装得上

- 报告日期：2026-10-22
- 范围：**只读分析 + 方案设计**。未修改任何产品文件，未运行安装，未接触 `F:\自制软件`、`F:\鑫金源珠宝资料`。
- 代码基线：`candidate/proposal/worker-draft`（工作副本）+ 现成包 `candidate/build-pre-r2-165953/package`（`candidate\build` 不存在；`build-status.json` = FAILED @ 5/7）。
- 配套只读工具：`audit-20261022/acl-preflight-fresh.ps1`（本次新建，只获取 ACL，不写 ACL、不建目录）。
- 相邻报告：`audit-20261022/FULL_AUDIT.md`（全盘审计）。本文只处理首装准入，不重复其缺陷编号。

---

## 0. 结论先给（TL;DR）

1. **首装真正的杀手只有一处：ACL 断言把「包所在的整条路径」也算进去了，而它用的危险位把 `Delete` 也算进去。** 现代 Windows 上「盘根 / 用户配置目录 / 镜像克隆遗留」普遍存在一个显式的 `Authenticated Users:(M)` 或孤儿 SID `(M)`，`Modify` 与危险位一与就命中 `0x10000(Delete)` → 必然被拒。与代码作者在 `Prepare-Repeat-Approval-170.ps1:98-99` 写下的设计意图（"父目录的创建权不能替换已固定的子对象"）并不一致 —— `Delete` 打在父目录上同样**不能**替换子对象，它是错收的位。
2. **最重要、零重签的发现**：把包放到 **`%LOCALAPPDATA%` 下自建的专用目录**，在**当前未修改的产品代码**上，整条 ACL 断言链 **0 失败**（本文附录 A 实测 `VERDICT=PASS`）。所以「干净 Win11 新员工机」**只靠运维步骤就能装上**，不需要改产品。
3. 需要改产品的场景是：**Windows Sandbox / 克隆镜像 / 非系统盘盘根带显式 `AU:(M)`**，或该机 `%LOCALAPPDATA%` 里也带了孤儿 SID `(M)`。这两类只需放宽**祖先层**的 `Delete` 一位（A1），目标层（包目录、程序目录、状态目录）一位都不放宽。
4. 除 ACL 外，首装还有 3 个「必然失败或不可重试」的坑，且**第一次失败后会自锁**（留下空目录），必须按 B4 清理才能重试。
5. 重签判断（第 4 节）：**任何 A 类改动都必须进新签名候选**（三重硬绑哈希 + PS 正文摘要 + workerEnvelope 四层联动，没有"只改一行不重签"的可能）；**B 类全部只是运维步骤，签名链零影响**。

推荐组合：**B1+B2+B4 立刻做（今天就能用）→ A1+A3 并入本轮 target-21 重签**。

---

## 1. 首装会撞上哪些断言（按执行顺序，含 `文件:行号` 与错误码）

首装入口链（已核实）：

```
首次安装主机.cmd :4                    (SHA256 硬绑 ae7a65…afa → native-delivery-170.ps1)
  └ 安装组件\native-delivery-170.ps1 :398  (FreshHost → --fresh-host)
      :400/:404                         (SHA256 硬绑 cb3bb4ce…2fd → engine-native170-binding.json, 作为 argv 下传)
    └ 受信助手\鑫金源珠宝报价.exe (ELECTRON_RUN_AS_NODE=1) :406
        └ engine-native-entry170.cjs :49-63
            └ engine-tree-runtime170.cjs freshDestination :1663-1676
                └ nativeAcl :1437-1460  →  PowerShell 子进程内 Assert-ApprovalAcl
            └ fresh-program-install-170.cjs :81-146 installFreshProgram
            └ engine-tree-runtime170.cjs initializeFreshInstalled :1811-1815 → initializeFreshEngineReceipt170 :1345-…
```

### 1.1 入口与哈希链（与机器无关，包被动过就必失败）

| # | 断言 | 位置 | 错误码 / 文案 | 分类 |
|---|---|---|---|---|
| 1 | `native-delivery-170.ps1` 尺寸 1..4194304 + SHA256 `ae7a6519cbbe01e81988313192600f030ad96512bd0134dc54195e2df45249f8` | `首次安装主机.cmd:4` | `Bootstrap SHA256 mismatch`（PS throw） | 必然（包被改） |
| 2 | `engine-native170-binding.json` SHA256 `cb3bb4ce2702adba4d1dfd918c812299ba07eb7e7b306cc7f1d393eb7a09d2fd` | `安装组件\native-delivery-170.ps1:400` | `固定发布绑定校验失败，未启动维护助手。` | 必然（包被改） |
| 3 | Electron 44.7.0 / `ELECTRON_RUN_AS_NODE=1` / 无 `NODE_OPTIONS`/`NODE_PATH` | `engine-native-entry170.cjs:49` | `UNTRUSTED_NATIVE_RUNTIME` | 必然（启动方式错） |
| 4 | binding 摘要二次校验 | `engine-native-entry170.cjs:52` | `BINDING_CHANGED` | 必然（包被改） |
| 5 | PS 两段正文摘要 `9e4c6488…` / `dbf4b7e5…` | `engine-tree-runtime170.cjs:1443` | `BAD_ACL_TOOL 原审定ACL策略正文已变化` | 必然（PS 被改而摘要没跟上） |

> 这 5 条是「防篡改链」，不是环境问题。它们一旦触发，说明包不完整或被改过 —— 处置是**换回原包**，不是修机器。

### 1.2 目标路径与状态前置（与机器状态强相关）

| # | 断言 | 位置 | 错误码 / 文案 | 分类 |
|---|---|---|---|---|
| 6 | 角色 ∈ {host, employee} | `engine-tree-runtime170.cjs:1664` | `BAD_FRESH_ROLE` | 必然（内部调用错） |
| 7 | 安装目录**必须**是 `%LOCALAPPDATA%\鑫金源珠宝\{主机程序\|员工程序}` | `:1665-1666` | `BAD_FRESH_DESTINATION 首次安装仅使用本机用户的固定新程序目录；已有程序请用升级入口` | 必然（不按此路径） |
| 8 | **仅 host**：`F:\` 必须存在且是真目录（`assertPath`，拒绝符号链接/网络/别名） | `:1668` | `HOST_DATA_LOCATION_UNAVAILABLE 主机固定资料盘不可用，首次安装停止；不自动改资料位置或创建替代账套` | 必然（无 F: 盘的机器）/ 视环境（subst、映射盘） |
| 9 | **仅 host**：`F:\鑫金源珠宝资料` **必须不存在**（`lstat` 存在性，**空目录也算**） | `:1669-1670` | `EXISTING_HOST_DATA 已存在主机资料，首次安装停止；请使用经验证的原程序升级，不创建或覆盖账套` | 必然（老机器/F: 盘已建过资料）/ 视环境（有人手工建过） |
| 10 | 安装目录必须不存在 | `:1673`、`fresh-program-install-170.cjs:16/88` | `EXISTING_INSTALLATION 程序目录已存在，请使用升级入口，不覆盖` | 必然（重装/上次失败留残） |
| 11 | 状态目录必须不存在（`createPaths=[state]`） | `:1814` → `:1454` | `NATIVE_ACL_REFUSED`（内层 `Owned directory already exists`） | 必然（残留） |

**关键纠正**：`F:\鑫金源珠宝资料` 在**首装链里只做"存在性禁止"，从不做 ACL 断言**（ACL 断言只出现在升级链：`:1592`、`initial-patch-core.cjs:85`、`initial-source-lease.cjs:43`、`Initial-Source-Lock.ps1:8`）。所以「首装要过 `F:\` 的 AU 写权限」这个前提**不成立**；`F:\` 的首装门槛是"盘在、资料根不在"。

### 1.3 ACL 层（首装真正的失败源）

判定口径（`Prepare-Repeat-Approval-170.ps1`）：

- `:90` 只有**盘符恰好是 `C:\`** 的祖先才给 `TrustedInstaller` 豁免（`Test-TrustedWindowsRoot`）。
- `:92` owner ∈ {当前 SID, `S-1-5-18`, `S-1-5-32-544`}（+ `C:\` 祖先加 TrustedInstaller）。
- `:100` 危险位基集 = `DeleteSubdirectoriesAndFiles(0x40) | Delete(0x10000) | ChangePermissions(0x40000) | TakeOwnership(0x80000)` = **`0xD0040`**
- `:101` 非祖先再加 `Write(0x116)` → **`0xD0156`**
- `:102` 只判 Allow 规则；`$Ancestor -and $rule.inheritOnly` 跳过。

被检查的对象集合（`engine-tree-runtime170.cjs:1674` 与 `:1814`，逐 target 展开整条祖先链，`:1444-1445`）：

| target 来源 | 参与阶段 | 自身按什么判 |
|---|---|---|
| 包内 `受信助手`（= `p.workerRoot`，引擎就地运行） | `:1674`、`:1814` | **非祖先**（含 Write） |
| 其整条祖先链（含盘根、含 `D:\Codex\…`、含 `…\package`） | 同上 | 祖先（不含 Write，**含 Delete**） |
| `%LOCALAPPDATA%` | `:1674` | **非祖先**（含 Write） |
| 安装目录 + 其父目录 `…\鑫金源珠宝` | `:1814`（存在时才判） | 非祖先 / 祖先 |
| 状态目录（createPaths） | `:1814` | 建后立即非祖先判定 |

失败统一包装（`engine-tree-runtime170.cjs:1456`）：

```js
Object.assign(Error('Windows权限核验/专属目录创建失败，未改变原有ACL'),{code:'NATIVE_ACL_REFUSED',cause:error})
```

内层真实文案只有三条，且**都不会传到用户界面**：

- `:97` `审定路径所有者不属于当前用户或允许的受信 Windows 系统身份。`
- `:102` `审定路径允许其他 Windows 身份替换或修改受保护对象，停止；不会修改现有 ACL。`
- `:1454` `Owned directory already exists`
- （`:1451` `SID changed`、`:1457` `回执不完整`、`JSON.parse` 失败、powershell 无法启动、AppLocker 拦截、15s 超时 —— **全部**归并成同一个 `NATIVE_ACL_REFUSED`）

| # | 断言 | 位置 | 错误码 | 分类 |
|---|---|---|---|---|
| 12 | 每个已存在祖先的 owner 合法 | `:97` | `NATIVE_ACL_REFUSED` | 视环境（owner=TrustedInstaller 且非 `C:\`；FAT32 无 owner） |
| 13 | 祖先链上"其他身份"不带 `0xD0040` | `:100/:102` | `NATIVE_ACL_REFUSED` | **必然（沙盒/克隆/非系统盘）/ 视环境（干净系统盘）** |
| 14 | 包目录自身"其他身份"不带 `0xD0156` | `:101/:102` | `NATIVE_ACL_REFUSED` | **必然（包放桌面/下载/盘根/U 盘/共享盘）** |
| 15 | `%LOCALAPPDATA%` 自身"其他身份"不带 `0xD0156` | `:1674` | `NATIVE_ACL_REFUSED` | 视环境（企业策略给 Users 写 `LocalAppData`） |
| 16 | 无残留目录（createPaths 必须不存在） | `:1454` | `NATIVE_ACL_REFUSED` | 必然（重试） |
| 17 | 15s 内完成 + powershell.exe 可启动 + 可解析回执 | `:1456-1457`、`:1420` 硬编码 `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe` | `NATIVE_ACL_REFUSED`（伪装） | 视环境（AppLocker/WDAC、杀软、Windows 不在 C:、冷启动慢） |

### 1.4 复制 / 提交 / 启动层

| # | 断言 | 位置 | 错误码 / 文案 | 分类 |
|---|---|---|---|---|
| 18 | `local`、`artifact` 必须真目录且非链接/别名 | `fresh-program-install-170.cjs:87`、`employee-update-cache.cjs:20-27` | `UNSAFE_PATH Update path alias rejected`（旧文案 `Path changed or alias used`） | 视环境（映射盘/subst/junction/UNC/直接从压缩包内运行） |
| 19 | 64 位、`%LOCALAPPDATA%` 规范化、仅 ASCII 盘符 | `:82` | `BAD_INSTALL / 仅支持六十四位 Windows 进程` | 必然（32 位/异常环境变量） |
| 20 | 目标路径不含 data/profiles/private/credentials/backups/员工本地设置/员工客户端缓存/鑫金源珠宝员工端，且不在 `F:\自制软件`、`F:\鑫金源珠宝资料` 内 | `:86` | `UNSAFE_PATH` | 必然（路径设计错） |
| 21 | 存在"可核验的普通父目录" | `:89`、`:36` | `UNSAFE_PATH 安装目录没有可核验的普通父目录` | 视环境（`%LOCALAPPDATA%` 本身异常） |
| 22 | 同目录无其他写者 | `:96` | `EXISTING_INSTALLATION 目标目录已经存在。…` | 视环境（并发/残留） |
| 23 | 引擎树与 catalog 完全一致；`resources/NVIDIA Corporation/umdlogs` **必须为空** | `engine-tree-runtime170.cjs:23/30/32`、`fresh-program-install-170.cjs:115/120` | `UNEXPECTED_SOURCE_DIRECTORY 已知日志目录必须为空` / `FILE_CHANGED` / `BAD_PROGRAM` | 视环境（**包被跑过**：GPU 驱动往包内写日志；见 FULL_AUDIT P0-5） |
| 24 | 安装标记 5 键精确 | `:121-131`、`engine-tree-runtime170.cjs:1345+` | `BAD_ACTIVATION` | 必然（实现错） |
| 25 | 受信提交回执 | `:139-140` | `FRESH_COMMIT_REQUIRED` | 必然（实现错） |
| 26 | 提交后启动成功（`launched===true`） | `:141-145`、`engine-native-entry170.cjs:63` | `COMPLETED=false`，`launchError: LAUNCH_NOT_CONFIRMED / LAUNCH_FAILED`（**不抛错**） | 视环境（策略禁止启动/被 AV 拦） |
| 27 | 启动门 | `engine-startup-gate.cjs:32`、`engine-tree-runtime170.cjs:1414` | `ENGINE_STARTUP_BLOCKED` | 必然/视环境（见 FULL_AUDIT P0-3） |

### 1.5 分类汇总

**必然失败（不看运气，任何机器都会撞）**

1. `：13` 祖先层 `Delete` 收错位 —— 只要包所在卷/上级目录带**显式** `AU:(M)`（沙盒 `C:\` 实测有，本机 `D:\` 实测有，生产 `F:\` 曾经有）→ 现状必拒。
2. `：14` 包目录自身被其他身份可写 —— 放桌面 / 下载 / 盘根 / U 盘 / `C:\XjyLocal` 未硬化 → 现状必拒（`0xD0156`）。
3. `：10/:11/:16` 残留即锁死 —— 且 `fresh-program-install-170.cjs:102` 用 exclusive mkdir 建目标目录，**之后任何一步失败都留下空目录**；`initializeFreshInstalled` 的 `createPaths=[state]` 在 `commit` 前就已创建。**第一次失败 = 第二次必然 `EXISTING_INSTALLATION`**，用户会以为"重装也没用"。
4. `：9` host 角色 + `F:\鑫金源珠宝资料` 已存在（**空目录也算**）→ 必拒。
5. `：1/:2/:5/:24/:25` 包被动过或实现错 → 必拒。

**视环境而定**

| 触发条件 | 命中项 | 实测/推断 |
|---|---|---|
| Sandbox / 克隆镜像 / 非系统盘盘根有显式 `AU:(M)` | 13 | 沙盒 `C:\`：`S-1-5-11 rights=Modify, Synchronize inheritOnly=False → bits=0x10000`（`guest-results/assertprobe.txt`）；本机 `D:\`：同形同值 |
| `%LOCALAPPDATA%\Temp` 之类目录带**孤儿 SID** `(M)`（换机/镜像克隆遗留，不可解析） | 13 | 本机实测：`%LOCALAPPDATA%\Temp` `protect=True`，显式 `S-1-5-21-934562737-2343261917-3534364317-542586113 | Modify | inh=False` → 其下整棵子树永远过不了 |
| 企业策略给 Users/`Authenticated Users` 写 `LocalAppData` | 15 | 未实测；预检脚本已覆盖 |
| 无 `F:` 盘（笔记本单盘） | 8 | 必然，属角色/硬件问题 |
| `F:\` 是 `subst`/映射盘/共享 | 8 | `assertPath` 先拒（`Path changed or alias used`） |
| 包从 U 盘（FAT32/exFAT）直接跑 | 12/18/19 | `Get-Acl` 对无 ACL 卷抛错 → 变 `NATIVE_ACL_REFUSED`；`realpath` 也可能不等 |
| AppLocker/WDAC/杀软拦 powershell.exe；Windows 装在非 `C:` | 17 | `:1420` 硬编码 `C:\Windows\…\powershell.exe`，`:1456` 硬编码 `SystemRoot=C:\Windows` |
| 包被运行过一次（驱动往包内写 umdlogs） | 23 | `UNEXPECTED_SOURCE_DIRECTORY` |
| 启动被策略拦 | 26 | `installed:true, launched:false` —— 装好了但报未完成 |

---

## 2. 两个方案

### 方案 A：产品侧放宽 / 改造

#### A1（推荐，最小）—— 祖先层不再把 `Delete` 当危险位

```diff
--- a/delivery-approval/Prepare-Repeat-Approval-170.ps1
+++ b/delivery-approval/Prepare-Repeat-Approval-170.ps1
@@ -100,2 +100,2 @@
- $danger=[Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
- if(!$Ancestor){$danger=$danger -bor [Security.AccessControl.FileSystemRights]::Write}
+ $danger=[Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
+ if(!$Ancestor){$danger=$danger -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::Write}
```

（净效果：`Delete` 从基集移到"仅非祖先"分支。`:102` 的循环体**不需要改**。）

- 效果：祖先危险位 `0xD0040 → 0xC0040`；**目标层 `0xD0156` 一位不变**。
- 为什么这不算"放宽安全边界"：`Delete(0x10000)` 打在**父目录**上，只能删/改名**父目录自身**，不能替换已固定（protected DACL、owner=用户）的子对象 —— 这正是 `:98-99` 注释声明的设计意图（"Parent creation rights alone cannot replace an existing pinned child"）。真正的反替换位是 `DeleteSubdirectoriesAndFiles(0x40)`、`ChangePermissions(0x40000)`、`TakeOwnership(0x80000)`，**全部保留**。
- 残余风险（老实说）：其他本机身份可以把包所在**中间目录**改名/搬走 → 路径漂移、安装中断（fail-closed，`assertPath` 会拒）。是 DoS，不是篡改。包内每个文件另有 `engineFiles` 摘要 + workerEnvelope 签名 + 三重哈希链兜底，改不了就跑不起来。
- 覆盖：沙盒 `C:\`、本机 `D:\`、孤儿 SID 在 `%LOCALAPPDATA%\Temp` 一类场景（附录 A 实测 `aclFailures 7→1`、`4→1`）。
- **不动**：包目录自身仍要求"其他身份零写权" —— 这是反篡改底线，不该放宽。

#### A2（可选，建议同批）——`%LOCALAPPDATA%` 只按祖先判

`engine-tree-runtime170.cjs:1674` 把 `authority.local` 当独立 target（非祖先，含 Write）。但它是**父目录**，最终保护由 `New-ApprovalAcl`（protected DACL，`Prepare-Repeat-Approval-170.ps1:109-111`）保证。

```diff
-  await nativeAcl(p.workerRoot,authority,[p.workerRoot,authority.local,...(exists?[install]:[])]);
+  await nativeAcl(p.workerRoot,authority,[p.workerRoot,...(exists?[install]:[])]);
```
（祖先链由 `:1444-1445` 自动补出 `%LOCALAPPDATA%`，但它会以 **ancestor** 身份被判 —— 这正是我们想要的语义。）

- 收益：修企业策略机（Users 可写 `LocalAppData`）的误拒，且不降低任何实际保护。
- 代价：`engine-tree-runtime170.cjs` 一变 → 绑定重算 + 重签（与 A1 同批，边际成本≈0）。
- 判定边界：如果不想动 runtime，就**别做 A2**，靠预检脚本报 `15` 让运维换落点。二选一，不要半做。

#### A3（强烈建议，同批）—— 让 `NATIVE_ACL_REFUSED` 说人话

现在 `:1456` 把 powershell 起不来、AppLocker、15s 超时、SID 变化、真实 ACL 违规**全部**压成一句 `Windows权限核验/专属目录创建失败，未改变原有ACL`。新员工机现场无法自查，只能整机寄回。

最小改法（不改变任何判定）：

1. 让违规可见：`Assert-AclPolicy` 拿不到路径（`:91` 形参里没有），所以最小改法是在**调用方** `Assert-ApprovalAcl`（`:104-108`）里包一层：

   ```powershell
   try { Assert-AclPolicy $owner $rules $Sid $Ancestor (Test-TrustedWindowsRoot $Name $Ancestor) }
   catch { throw ('ACL_REJECT ' + $Name + ' ancestor=' + $Ancestor + ' :: ' + $_.Exception.Message) }
   ```

   同时 `:102` 的 throw 里拼上 `$rule.sid` 与十六进制 `('0x{0:X}' -f ($rule.rights -band $danger))`，这样一行就能看出"谁、在哪、碰了哪几位"。
2. `:1456` 区分三类 `code`：`NATIVE_ACL_TOOL_MISSING`（ENOENT）、`NATIVE_ACL_TIMEOUT`（`error.killed`/`ETIMEDOUT`）、其余保留 `NATIVE_ACL_REFUSED`，并把 `cause.stderr` 前 512 字节放进 `detail`。
3. `:1420` 改用 `process.env.SystemRoot`（`native-delivery-170.ps1:406` 已透传）而非硬编码 `C:\Windows`。

- **这是首装可运维性的分水岭**：有了它，第 3 节 checklist 的"失败对照"才真正可执行。
- 注意：`engine-tree-runtime170.cjs` 的改动会让 `:19` reviewerPins / workerEnvelope 覆盖的四份文件摘要需要重签（`delivery-approval/*` 未变，但 runtime 本身在 delivery-tools 里，被 envelope 覆盖）。**必须进新签名候选。**

#### A4（不推荐"把 createPaths 改到 `%LOCALAPPDATA%` 下"）

首装**已经**把安装目录放在 `%LOCALAPPDATA%\鑫金源珠宝\{主机程序|员工程序}`（`:1665`），程序目录本来就是 owned 目录。真正的矛盾不是"装到哪"，而是**"包在哪执行"**——引擎就地从包内 `受信助手` 运行（`native-delivery-170.ps1:404` `WorkingDirectory=$root`），所以包必须在无他人写权的路径上。

要让它"放哪都能装"，只能：先把 worker 树复制/解包到 owned 临时目录 → 校验 → 再执行。这会新增一段"自我复制 + 二次信任"的代码，扩大攻击面并在首装链上再加一层可失败点。**收益（省一步运维复制）远小于成本（新增签名边界）**，列为 C 级备选，不建议本轮做。

### 方案 B：运维侧前置（零产品改动、零重签）

| 步骤 | 内容 | 判定命令 | 失败处置 |
|---|---|---|---|
| **B1** 包落点 | 解压/复制到 **`%LOCALAPPDATA%` 下自建专用目录**，例如 `%LOCALAPPDATA%\XjyPkg\1.7.0\`。**禁止**：桌面、下载、盘根、`C:\XjyLocal`（未硬化）、U 盘、网络盘、`subst`/映射/junction、`%LOCALAPPDATA%\Temp` | `$p="$env:LOCALAPPDATA\XjyPkg\1.7.0"; Test-Path "$p\首次安装主机.cmd"` | 重放到合规位置 |
| **B2** 预检 | 跑只读预检，`VERDICT=PASS` 才继续 | `powershell -NoProfile -ExecutionPolicy Bypass -File audit-20261022\acl-preflight-fresh.ps1 -Role host -PackageRoot "$p"` | 看 `CHK` 行定位首个违规路径 |
| **B3** host 前置 | `F:\` 存在；`F:\鑫金源珠宝资料` **不存在**（绝不手工建）；`%LOCALAPPDATA%\鑫金源珠宝\主机程序` 不存在；`.主机程序.xjy-engine-state` 不存在 | 见 checklist 第 4-6 步 | 无 F: 盘 → 该机不能当主机（改员工机或加盘）；资料根已存在 → 走升级，别首装 |
| **B4** 残留清理 | 上次失败后**必须**清：`…\鑫金源珠宝\主机程序`、`…\鑫金源珠宝\.主机程序.xjy-engine-state`（员工：`员工程序` / `.员工程序.xjy-engine-state`） | `Test-Path` 两个路径均 False | 先关掉所有 `鑫金源珠宝报价.exe` 再删 |
| **B5** 记录 | 把预检输出存档（`VERDICT=`、`CHK` 行）作为交付证据 | 打印/截图附在交付单 | — |

B 类脚本现状：
- `D:\Codex\xjy-release-20261022\audit-20261022\acl-preflight-fresh.ps1` —— 本次新建，复刻 `Assert-AclPolicy` + 祖先链去重（`:1444-1445`），一次输出 `now / a1 / a1a2` 三模式，只读。
- 已有 `D:\Codex\xjy-release-20261022\s5-tools\acl-preflight.ps1` 只查 6 条固定路径（`C:\`、`C:\ProgramData`、`F:\`、`F:\自制软件`、`F:\自制软件\xjy-jewelry-offline`、`F:\鑫金源珠宝资料`），**不查包所在路径、不查 `%LOCALAPPDATA%` 祖先链**，因此不足以判定首装（它判定的是"生产机升级链"）。首装请用新脚本。
- `s5-tools\prod-acl.ps1`（`-Phase export|tighten|rollback`）是**F: 盘升级链**的收紧/回滚工具，与首装无关；首装不需要跑它。

### 2.1 比较矩阵

| 维度 | A1 祖先放宽 | A1+A2+A3 | B1..B5 |
|---|---|---|---|
| 改动文件 | `Prepare-Repeat-Approval-170.ps1`（2 行） | + `engine-tree-runtime170.cjs`（3 处） | 无（新增 1 个只读脚本） |
| 干净 Win11 新员工机能否装上 | B1 单独就够；A1 非必需 | 够 | **够（已实测 PASS）** |
| Windows Sandbox | 能（消 `0x10000`） | 能 | **不能**（`C:\` 显式 `AU:(M)` 必须要么 A1 要么 `icacls C:\ /remove:g *S-1-5-11`） |
| 克隆镜像/孤儿 SID | 能 | 能 | 需逐个目录 icacls 清理（不可枚举） |
| 安全性 | 仅放弃"父目录可被改名"这一 DoS 面；反替换位全保留 | 同 A1，且不加宽 | 无变化（甚至更严：强制用户私有落点） |
| 审计链 / 重签 | **必须重签**（四层哈希联动） | **必须重签**（同批） | **零影响** |
| 落地时间 | 下一轮出包 | 下一轮出包 | **今天** |
| 失败半径 | 一次策略变更，需发布说明 | 同 | 依赖人工照 checklist 做；漏做则现场失败 |

### 2.2 安全性影响（直说）

- **A1**：只影响"祖先目录"判定。它允许某个非受信身份对**包的上级目录**拥有 `Modify`。结合保留的 `0x40`，该身份**不能**批量删除子项；结合子项的 protected DACL（`先 SetAccessRuleProtection($true,$false)` 再建，`:110`），该身份对包内 `受信助手` 及其下**无任何权限**。残余 = 可改名/搬动中间目录 → 安装失败（fail-closed）。
- **A2**：把 `%LOCALAPPDATA%` 从"目标"降为"父目录"。实际保护来自 `New-ApprovalAcl`，不来自对 `%LOCALAPPDATA%` 的检查；不降低任何东西。
- **A3**：纯文案/分类，无判定变化。
- **B**：无行为变化；B1 反而**提升**安全（强制包落在用户私有目录，比现状"放 F:\自制软件 再靠 icacls 收紧"更简单可控）。
- **共性底线（三案都不放宽）**：`受信助手`（workerRoot）自身、安装目录、状态目录，对任何非 {当前用户, SYSTEM, Administrators} 的写/删/改 ACL/夺所有权 **一律拒绝**。这条不要动。

### 2.3 审计链影响 / 是否需要重签

四层硬绑（任何一层变，整包作废）：

| 层 | 绑定值 | 位置 | 改动触发 |
|---|---|---|---|
| L1 | `ae7a6519…afa`（`native-delivery-170.ps1` 摘要） | `首次安装主机.cmd:4` | 改 `native-delivery-170.ps1` |
| L2 | `cb3bb4ce…2fd`（`engine-native170-binding.json` 摘要） | `安装组件\native-delivery-170.ps1:400`、`:404` | 改任何 engineFiles（含全部 `delivery-tools/*.cjs`） |
| L3 | 运行时二次校验 L2 | `engine-native-entry170.cjs:52` | 同上 |
| L4 | `9e4c6488…` + `dbf4b7e5…`（PS 两段正文） | `engine-tree-runtime170.cjs:1443` | 改 `Prepare-Repeat-Approval-170.ps1` 的策略/创建段 |
| L5 | `reviewerPins`（四个 `delivery-approval/*` 的 sha256，来自**已签** `workerEnvelope.catalog`） | `engine-native-entry170.cjs:19` | 改这四个文件任一 |

⇒ **A 类改动 100% 需要新签名**：

- A1 → 改 PS 策略段 → 破 L4 **且** L5（该 PS 在 reviewerPins 里）→ 必须同时更新两个摘要常量 + `workerEnvelope` 重签。
- A2/A3 → 改 `engine-tree-runtime170.cjs` → 破 L2/L3（engineFiles 摘要变）+ L5（`delivery-tools/*` 在 envelope 内）→ 重算 binding + 重签。
- 也就是说：**没有"只改一行、不重签"的 A 类路径**。这也说明为什么应该把 A1/A2/A3 **一次并进本轮 target-21 重签**（见 `SEQ21_PLAN.md`），而不是分三次出包。

⇒ **B 类零签名影响**：`acl-preflight-fresh.ps1`、checklist、`prod-acl.ps1` 都不在任何哈希/签名覆盖范围内（它们不在包内、不在 engineFiles、不在 workerEnvelope）。审计记录只需附 `VERDICT` 输出。

⇒ **A/B 并行的审计口径建议**：发布说明里明确写"祖先层放宽了 `Delete`，目标层未变"，并把 `acl-preflight-fresh.ps1` 的 `now`/`a1` 两列对照输出作为"放宽前后差异"的存档证据。这样重签审阅看到的是**可复核的位级差异**，而不是一句"修了 ACL 问题"。

---

## 3. 新员工机首装 checklist（一页纸，可打印）

```
================================================================================
        鑫金源珠宝 1.7.0  首次安装 · 新机核对单        （A4 一页，逐项打勾）
        机器：______________  角色：□主机(Host)  □员工(Employee)  日期：______
================================================================================
 0. 前提
   [ ] 已拿到完整安装包（含 首次安装主机.cmd / 首次安装员工.cmd / 安装组件 / 受信助手）
   [ ] 全程用「本机当前登录用户」操作；不要用「以其他用户身份运行」、不要用管理员提权
   [ ] 主机角色：本机确实有 F: 盘（不是映射盘、不是 subst）

 1. 包放到哪里（最关键，占失败原因的 8 成）
   [ ] 复制到 %LOCALAPPDATA%\XjyPkg\1.7.0\       ← 只放这里
   [ ] 没有放在：桌面 / 下载 / C:\ 根 / D:\ 根 / U 盘 / 网络盘 / Temp / 直接双击压缩包
   判定：  $p="$env:LOCALAPPDATA\XjyPkg\1.7.0"; Test-Path "$p\首次安装主机.cmd"
   期望：  True

 2. 一键只读预检（不改任何 ACL，不装任何东西）
   判定：  powershell -NoProfile -ExecutionPolicy Bypass -File ^
             "<本单所在目录>\acl-preflight-fresh.ps1" -Role host -PackageRoot "$p"
   期望：  最后一行 VERDICT=PASS   （角色改成 employee 再跑一次也行）
   失败：  看 CHK 行里第一个 now=ACE_REJECT 的路径 → 对照第 7 节

 3. 安装目录必须是空的
   判定：  Test-Path "$env:LOCALAPPDATA\鑫金源珠宝\主机程序"         期望：False
           Test-Path "$env:LOCALAPPDATA\鑫金源珠宝\员工程序"         期望：False
   失败：  True → 这机器已经装过 / 上次失败留残 → 走第 6 步清理，不要硬装

 4. 引擎状态目录必须是空的（易忽略，残留会让首次安装直接拒）
   判定：  Test-Path "$env:LOCALAPPDATA\鑫金源珠宝\.主机程序.xjy-engine-state"   期望：False
           Test-Path "$env:LOCALAPPDATA\鑫金源珠宝\.员工程序.xjy-engine-state"   期望：False

 5. 主机专用：F: 盘在、资料根不在
   判定：  Test-Path F:\                             期望：True
           Test-Path 'F:\鑫金源珠宝资料'               期望：False   ← 绝不手工新建！
   说明：  资料根哪怕是个空目录，安装器都会判「已存在主机资料」并停止。
   （员工角色可跳过本节）

 6. 上次失败后的清理（只在第 3/4 步为 True 时做）
   [ ] 关闭所有 鑫金源珠宝报价.exe（任务管理器确认无残留）
   [ ] 删除这两个（仅这两个）：
         %LOCALAPPDATA%\鑫金源珠宝\主机程序
         %LOCALAPPDATA%\鑫金源珠宝\.主机程序.xjy-engine-state
       （员工机换成 员工程序 / .员工程序.xjy-engine-state）
   [ ] 删完再跑第 3、4 步，均 False 才继续
   注意： 不要删 %LOCALAPPDATA%\鑫金源珠宝 本身，也不要删日志目录。

 7. 失败对照（现场只看到一句「Windows权限核验/专属目录创建失败」时按此排查）
   ┌────────────────────────────────┬──────────────────────────────────────────┐
   │ NATIVE_ACL_REFUSED             │ ①包不在 %LOCALAPPDATA%\XjyPkg ②包目录或上级 │
   │ 「Windows权限核验/专属目录创建  │ 给 Authenticated Users 写权限 ③盘根带显式   │
   │   失败，未改变原有ACL」        │ AU:(M)（沙盒/克隆镜像/非系统盘）④杀软或     │
   │                                │ AppLocker 拦 powershell.exe ⑤系统卡顿超 15s │
   │                                │ ⑥Windows 装在非 C:                          │
   │                                │ 处置：先做第 1、2、6 步；仍失败 → 记录      │
   │                                │ acl-preflight-fresh.ps1 的 CHK 行整段上报   │
   ├────────────────────────────────┼──────────────────────────────────────────┤
   │ EXISTING_INSTALLATION          │ 安装目录已存在（含上次失败留下的空目录）    │
   │ 「程序目录已存在…」            │ 处置：第 6 步清理，别重试                   │
   ├────────────────────────────────┼──────────────────────────────────────────┤
   │ EXISTING_HOST_DATA             │ F:\鑫金源珠宝资料 已存在（空目录也算）        │
   │ 「已存在主机资料…」            │ 处置：该机改走升级，或换一台干净主机         │
   ├────────────────────────────────┼──────────────────────────────────────────┤
   │ HOST_DATA_LOCATION_UNAVAILABLE │ 没有 F: 盘 / F: 是映射盘或 subst             │
   │ 「主机固定资料盘不可用…」      │ 处置：接实体盘；或改用员工机                │
   ├────────────────────────────────┼──────────────────────────────────────────┤
   │ UNSAFE_PATH                    │ 包放在 U 盘/网络盘/替代盘符/链接目录，或     │
   │ 「…alias rejected」            │ 安装路径含 data/private/credentials 等字样   │
   │ 「安装目录没有可核验的普通父目录」│ 处置：第 1 步重放                            │
   ├────────────────────────────────┼──────────────────────────────────────────┤
   │ UNEXPECTED_SOURCE_DIRECTORY    │ 包被运行过（GPU 驱动往 resources\NVIDIA     │
   │ 「已知日志目录必须为空」       │ Corporation\umdlogs 写了日志）              │
   │                                │ 处置：重新解压一份干净包，不要装跑过的包     │
   ├────────────────────────────────┼──────────────────────────────────────────┤
   │ UNTRUSTED_NATIVE_RUNTIME       │ 不是用包内 .cmd 启动的（被手工改命令行/缺    │
   │                                │ ELECTRON_RUN_AS_NODE）                      │
   │                                │ 处置：只用 首次安装主机.cmd 启动            │
   ├────────────────────────────────┼──────────────────────────────────────────┤
   │ Bootstrap SHA256 mismatch      │ 包不完整/被杀软改动                          │
   │ 固定发布绑定校验失败           │ 处置：换回原始包，不要"修一下再试"           │
   │ BAD_ACL_TOOL                   │                                            │
   ├────────────────────────────────┼──────────────────────────────────────────┤
   │ 安装完成但提示「启动未确认」    │ 程序已装好，只是被策略/AV 拦了首次启动       │
   │ LAUNCH_NOT_CONFIRMED           │ 处置：手动从开始菜单启动一次；               │
   │                                │ 千万不要重跑首装（会报目录已存在）           │
   └────────────────────────────────┴──────────────────────────────────────────┘

 8. 收尾
   [ ] 主机：确认 F:\鑫金源珠宝资料 已被安装器创建，且内部有账套
   [ ] 员工：确认能打开并连上主机
   [ ] 把第 2 步的 VERDICT 输出（或截图）钉在交付单上
   执行人：__________   复核人：__________   结果：□通过  □失败(附记录)
================================================================================
```

---

## 4. 哪些必须进新签名候选，哪些只是运维步骤

### 4.1 必须进新签名候选（改一次就得重签一次，没有例外）

| 改动 | 文件 | 破坏的绑定 | 连带必须做 |
|---|---|---|---|
| **A1** 祖先层去掉 `Delete` | `delivery-approval/Prepare-Repeat-Approval-170.ps1:100-101` | L4（两段正文摘要）、L5（reviewerPins） | 更新 `engine-tree-runtime170.cjs:1443` 两个摘要常量；`workerEnvelope` 重签；binding 重算；`首次安装主机.cmd:4` 的 `ae7a65…` 重写 |
| **A2** `%LOCALAPPDATA%` 降为祖先 | `delivery-tools/engine-tree-runtime170.cjs:1674` | L2/L3（engineFiles 摘要）、L5 | binding 重算 + envelope 重签 + `.cmd` 摘要重写 |
| **A3** 错误可诊断 | `delivery-tools/engine-tree-runtime170.cjs:1420/1451/1453/1456`、`delivery-tools/engine-native-entry170.cjs`（如需改 code 映射） | 同上 | 同上 |
| （任一 A 类） | `安装组件\native-delivery-170.ps1` | L1 | `首次安装主机.cmd:4` 的 sha256 必须重算 |

结论：**A1+A2+A3 打包进本轮 target-21 重签，一次出包**；不要拆成三轮，因为每一轮都要重算五层摘要且要让审计复核一遍放松理由。

### 4.2 只是运维步骤（签名链零影响，今天就能用）

| 项 | 归属 | 说明 |
|---|---|---|
| B1 包落点规范（`%LOCALAPPDATA%\XjyPkg\<ver>\`） | 安装说明 / checklist | 不改任何被哈希文件 |
| B2 `acl-preflight-fresh.ps1` 预检 | `audit-20261022/`（本次新建） | 只读，逐台执行；建议随包外附 |
| B3 host 前置（F: 在、资料根不在） | checklist | 存在性检查，非 ACL |
| B4 失败后清理两个目录 | checklist 第 6 步 | **必须写进安装说明**，否则"重试无效"会反复发生 |
| B5 预检输出存档 | 交付记录 | 审计证据 |
| `s5-tools\prod-acl.ps1 -Phase tighten/rollback` | 生产机升级链 | 与首装无关；首装不要跑 |
| `s5-tools\acl-preflight.ps1` | 生产机升级链 | 不覆盖首装路径，不要拿它判定首装 |

### 4.3 一句话判据

> 改到 `candidate/proposal/worker-draft/**` 里任何一个 `.ps1/.cjs` → 进新签名候选；
> 只新增/修改 `audit-20261022/**`、`s5-tools/**`、安装说明、checklist → 运维步骤，不重签。

---

## 附录 A：实测证据（本机 2026-10-22，只读）

工具：`audit-20261022/acl-preflight-fresh.ps1`（三模式：`now` 现状 / `a1` 祖先去掉 Delete / `a1a2` 再加 A2）

| 包落点 | `now`（现状代码） | `a1` | `a1a2` | 结论 |
|---|---|---|---|---|
| `D:\Codex\xjy-release-20261022\candidate\build-pre-r2-165953\package` | **7 失败**（`D:\`…`…\package` 六层祖先各命中 `sid=S-1-5-11 rights=Modify, Synchronize bits=0x10000`；`受信助手` 自身 `bits=0x10116`） | **1 失败**（仅 `受信助手` `bits=0x116`） | 1 失败 | 现状在"包放 D 盘"必然失败；A1 清掉祖先层，但包目录自身仍须无 AU 写权 |
| `%LOCALAPPDATA%\Temp\xjy-acl-probe\pkg` | **4 失败**（`Temp` 及其下各层命中孤儿 SID `S-1-5-21-934562737-2343261917-3534364317-542586113 rights=Modify, Synchronize bits=0x10000`；`受信助手` 自身 `bits=0x10116`） | 1 失败 | 1 失败 | `Temp` 不可用：普通目录也可能带不可解析的孤儿 SID |
| `%LOCALAPPDATA%\XjyPkg-probe\pkg` | **0 失败 · VERDICT=PASS** | 0 失败 | 0 失败 | **现状代码即可首装**——这是 B1 的直接依据 |

其它实测事实：

- 本机 `C:\`：`owner=TrustedInstaller, protect=True`；`AU: CreateDirectories`（非 IO）+ `AU: -536805376 (OI)(CI) (IO)` → 祖先判定 **0 危险位**（标准 Win11 系统盘现状就过）。
- Windows Sandbox `C:\`（`guest-results/assertprobe.txt`）：`owner=S-1-5-18`，**`AU: Modify, Synchronize, inheritOnly=False → bits=65536(0x10000)`** —— 与本机 `D:\` 同形，现状必拒；`A1` 后为 0。
- 沙盒 `C:\ProgramData`：`Users: Write`（非 IO）→ 祖先判定 **0 危险位**（因祖先不判 `Write`），与真实机同形。**顺带证明 `Modify` 不含 `0x40`**：`bits` 只有 `0x10000`。
- 本机 `%LOCALAPPDATA%`：`owner=当前用户, protect=False`，仅 `SYSTEM/BA/当前用户 FullControl`（3 条继承）→ 非祖先判定 **0 危险位**。
- 本机 `F:\`：`owner=S-1-5-18`，`SYSTEM/BA FullControl + Users RX`，**无 AU**。
- 本机 `F:\鑫金源珠宝资料` **存在** → 本机首发会正确报 `EXISTING_HOST_DATA`（预检也如实 `BLOCK EXISTING_HOST_DATA`）；这也说明**生产机不能用来验证首装**。
- 首装失败的历史现场（`guest-results/fresh-host-local3.log`）：只留下 `NATIVE_ACL_REFUSED Windows权限核验/专属目录创建失败，未改变原有ACL` + `安装或升级未确认完成` —— 无法定位到具体路径。这正是 A3 要解决的。

## 附录 B：复现命令（全部只读）

```powershell
# 1) 三模式预检（host）
powershell -NoProfile -ExecutionPolicy Bypass -File `
  'D:\Codex\xjy-release-20261022\audit-20261022\acl-preflight-fresh.ps1' `
  -Role host -PackageRoot 'D:\Codex\xjy-release-20261022\candidate\build-pre-r2-165953\package'

# 2) 单点 ACL 观察
(Get-Acl 'D:\').Access | ForEach-Object {
  '{0} | {1} | inh={2} | {3}' -f $_.IdentityReference,$_.FileSystemRights,$_.IsInherited,$_.AccessControlType }

# 3) 首装状态前置（三条都应为 False，host 再加 F: 两条）
$b="$env:LOCALAPPDATA\鑫金源珠宝"
Test-Path "$b\主机程序"; Test-Path "$b\.主机程序.xjy-engine-state"
Test-Path 'F:\'; Test-Path 'F:\鑫金源珠宝资料'
```

---

## 附：未做 / 需要授权的事

1. 没有在 Windows Sandbox 里重跑一遍验证 A1 补丁 —— 需要真机/沙盒执行安装（用户已明确禁止跑安装）。A1 的证据目前是"位级推演 + 真实 ACL 三模式实测"，**不是**端到端首装成功。
2. 没有修改任何产品文件（含 `Prepare-Repeat-Approval-170.ps1`）—— 补丁以 diff 形式给出，等授权与重签批次。
3. `s5-tools\prod-acl.ps1` 的 `tighten` 只删**非继承**的 `AU` ACE；若生产机 `F:\` 的 `AU:(M)` 是继承来的，`tighten` 会静默无效 —— 建议在下一轮把它改成"删不掉就报错退出"，否则运维会以为已收紧。（不在本次改动范围。）
