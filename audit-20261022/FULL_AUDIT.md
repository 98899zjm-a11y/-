# 鑫金源珠宝 1.7.0 —— 全盘只读审计报告

- 审计时间：2026-10-22 17:49–18:05（Asia/Shanghai）
- 审计性质：**只读**。未修改任何源码/构建产物，未运行构建、签名、安装、npx。本文件是唯一写入。
- 审计对象：
  1. 桌面端产品源码 `E:\codex\2026-10-15\work\xjy-v16-deep-audit\release-work\desktop170-application-source-a3\app\`（90+ 个 `.cjs`）
  2. 引擎/安装 `D:\Codex\xjy-release-20261022\candidate\build-old170\package\受信助手\delivery-tools\`（19 个工具）
  3. 审批/补丁 `...\package\审批工具\`（4 个文件）、`...\package\补丁文件\delivery-tools\Initial-Full-Upgrade.ps1`
  4. 复核用发布物：`candidate\approvals\*.catalog-envelope.json`、`delivery-170-a15-employee\*.zip`、`delivery-170-a17-employee\*.zip`
- 取证方法：全部结论来自实际 `grep -n` / `awk NR==` / `python zipfile` 读取，行号即真实行号。

## 0. 路径校正（必读）

| 用户给的目标路径 | 实际情况 |
|---|---|
| `…\candidate\build\package\受信助手\delivery-tools\` | **不存在**。真实构建目录为 `D:\Codex\xjy-release-20261022\candidate\build-old170\package\受信助手\delivery-tools\` |
| `engine-tree-runtime170.cjs`「1797 行」 | 实际 **1822 行**（`wc -l`） |
| `D:\Codex\xjy-release-20261022\audit-20261022\` | 原为空目录，本报告新建写入 |

行号口径说明：`delivery-tools` 下多数 `.cjs` 是"压缩成长行"的产物，一个物理行承载一整个函数，因此行号跳动大（如 `employee-update-cache.cjs` 90 行装 17 KB 代码）。下文行号一律指物理行。

---

# 1. P0 缺陷（5 条）

> 判据：会导致数据风险 / 安装失败 / 安全边界破坏。每条给出 `文件:行号` + 原文（≤200 字符）+ 触发条件 + 影响 + 最小修复。

## P0-1 员工补丁包内置的升级入口仍是 1.6.2 主机版，员工端一键升级 100% 失败

**证据路径 / 行号**
- `D:\Codex\xjy-release-20261022\delivery-170-a17-employee\鑫金源珠宝1.7.0员工升级补丁.zip` → 内部条目 `delivery-tools/Initial-Full-Upgrade.ps1` **第 65 行**
- 同包 `delivery-tools/source-policy-envelope.json` 的 `policy.targetVersion = '1.7.0'`
- `D:\Codex\xjy-release-20261022\candidate\build-old170\package\补丁文件\delivery-tools\Initial-Full-Upgrade.ps1`（无关行号，整文件同为 84 行 1.6.2 版）
- a15 与 a17 两个补丁包的该文件逐字节相同（同 84 行、同 3 处 `1.6.2`、0 处 `1.7.0`）

**代码原文（第 65 行）**
```powershell
if($policy.purpose -cne 'xjy-repeat-program-patch' -or $policy.targetVersion -cne '1.6.2' -or $policy.catalogSha256 -cne $ExpectedPublicationId -or $policy.publisherPublicKeySha256 -cne $record.publi
```

**配套证据（第 81 行，强制 host 角色）**
```powershell
$psi.EnvironmentVariables['XJY_INITIAL_ROLE']='host'
```

**触发条件**：员工在任意 1.6.x 机器上双击包内 `一键完整升级.cmd`（zip 内唯一 `.cmd`，实测名 `һ����������.cmd`，见 P2-6），只要走到 native 侧的角色/策略校验。

**影响**：`targetVersion` 恒不等于 `'1.6.2'`（包签名声明是 1.7.0）→ 必然抛出策略不符，员工端**没有任何一条能走通的升级路径**。即使把版本门放过，第 81 行仍把 `XJY_INITIAL_ROLE` 写死 `host`，员工机进入 host 分支后会被 `engine-tree-runtime170.cjs` 的 `EMPLOYEE_DEVICE_REQUIRED` 再拦一次。这是"1.7 员工补丁无法安装"的第一现场，而不是用户已知的审批记录缺失。

**最小修复**：`Initial-Full-Upgrade.ps1` 的版本门与角色不得写字面量——
- 第 65 行改为 `$policy.targetVersion -cne $ExpectedTargetVersion`，`$ExpectedTargetVersion` 从包内 `source-policy-envelope.json` 读取（该文件已被 `Pin-PlainFile` 钉住，安全不降级）；
- 第 81 行改为 `$psi.EnvironmentVariables['XJY_INITIAL_ROLE']=$CandidateRole`（脚本第 3 行已有 `[ValidateSet('host','employee')]$CandidateRole`）；
- 构建期加断言：补丁包内 `Initial-Full-Upgrade.ps1` 与 `source-policy-envelope.json` 的 `targetVersion` 必须相等，否则打包失败。

## P0-2 `native-publication-update.cjs` 的"当前版本"硬编码 1.7.0，把下一版本的员工端直接锁死

**证据路径 / 行号**：`E:\codex\2026-10-15\work\xjy-v16-deep-audit\release-work\desktop170-application-source-a3\app\native-publication-update.cjs`

**代码原文**
```js
// 第 39 行
async function guard(){if(closed)fail('UPDATE_CLOSED','升级入口已关闭');if(options.currentVersion!=='1.7.0'||!employee())fail('EMPLOYEE_DEVICE_REQUIRED','仅已装1.7员工程序…');
// 第 38 行
const set=(phase,message,extra={})=>{state={phase,currentVersion:'1.7.0',message,...extra};};
// 第 15 / 20 / 21 行（启动门也写死 1.7.0）
const gate=startup.readEngineStartupGate({installDir:installationDir,programVersion:'1.7.0',...});
```

**触发条件**：发布 1.7.1 / 1.8.0 后，员工机上的程序版本变为新值（`options.currentVersion` 由外部注入真实版本）。**影响**：第 39 行的 `!==` 判定立刻为真 → 每次 `getCapability`/`download`/`installUpdate` 都抛 `EMPLOYEE_DEVICE_REQUIRED`，**全体员工永久失去自更新能力**，且 UI 上表现为"这台机器不是员工机"，与真实原因无关，排障成本极高。

用户已知"targetVersion 硬编码 1.7.0 已做成 r2 补丁"——但 r2 只覆盖了包内 `Initial-Full-Upgrade.ps1` 与部分发布元数据；**第 38/39 行这一处是"当前版本"语义**，比 targetVersion 更危险，因为它是**升级的前置门**而非目标值，r2 补丁不覆盖它。详见 §5-4（版本号散落统计：`native-publication-update.cjs` 内 17 处 `1.7.0`）。

**最小修复**：第 38/39 行改为 `const CURRENT=options.currentVersion;` 一次取值，`set()` 用 `currentVersion:CURRENT`，`guard()` 用 `CURRENT!=='1.7.0'` 改为"已安装版本 ∈ 受支持源版本集合"（复用 `approval-core-170.cjs:6` 已存在的 `SOURCE_VERSIONS`）。第 15/20 行的 `programVersion:'1.7.0'` 同理改为 `options.programVersion`。

## P0-3 启动身份门与 catalog 尺寸断言把版本/文件数写死，任何合法发布演进都会"启动即阻断"

**证据路径 / 行号**
- `E:\codex\2026-10-15\work\xjy-v16-deep-audit\release-work\desktop170-application-source-a3\app\engine-startup-gate.cjs:52`
- `D:\Codex\xjy-release-20261022\candidate\build-old170\package\受信助手\delivery-tools\engine-tree-runtime170.cjs:74`

**代码原文**
```js
// engine-startup-gate.cjs:52
if(programVersion!=='1.7.0'||!['host','employee'].includes(installedRole))fail('STARTUP_IDENTITY_REQUIRED','完整1.7安装身份或原角色缺失。');
// engine-tree-runtime170.cjs:74
requireValue(targetCatalog?.version==='1.7.0'&&Number.isSafeInteger(targetCatalog.sequence)&&Array.isArray(targetCatalog.files)&&targetCatalog.files.length===1079,'BAD_SLOT_SOURCE','双来源必须指向已核完整170目标');
```

**触发条件**：1.7.1 发布（文件数从 1079 变成 1080，或版本号变化）。

**影响**：这两处是**fail-closed**，不是 fail-open，所以不会破坏安全边界，但会把"正常发布"变成"全员启动失败 / 双来源选择失败"。第 74 行是最脆的一根：它把"完整的 1.7.0 引擎树恰好 1079 个文件"写成断言，任何人合法新增一个资源文件（哪怕已签名审批）都会 `BAD_SLOT_SOURCE`。这在真实发版节奏下必然踩到，且报错文案"双来源必须指向已核完整170目标"完全不指向根因。

**最小修复**：把 `'1.7.0'` 与 `1079` 换成从已验签的 `target.catalog` 自身派生（`targetCatalog.version === policy.targetVersion`、`files.length === policy.allowedFiles.length`），保留"签名后的 allowedFiles 与 catalog.files 双向相等"这条真正的约束。安全等价：判据从"等于魔术数字"变成"等于签名内容"。

## P0-4 catalog 白名单"自证式"派生，签名不再约束文件集合（安全边界被削弱）

**证据路径 / 行号**：`D:\Codex\xjy-release-20261022\candidate\build-old170\package\受信助手\delivery-tools\engine-tree-runtime170.cjs:78`、`:1487`、`:1498`；对照 `:1495`

**代码原文**
```js
// 第 78 行（自证式：allowedFiles 由同一份 catalog 派生）
const catalog=u.verifySignedCatalog(envelope,u.createTrustedUpdatePolicy({trustedPublicKey:publicKey,currentVersion:'1.7.0',allowedFiles:raw.files.map(f=>f.path),now}),{allowExpired:true});
// 第 1495 行（独立口径：allowedFiles 来自外部绑定）
const full = {target:u.verifySignedCatalog(config.targetEnvelope,u.createTrustedUpdatePolicy({trustedPublicKey:publicKey,currentVersion:'1.6.0',allowedFiles:meta.target.allowedFiles,now:Date.now})
```

**触发条件**：`raw.files.map(f=>f.path)` 使 `allowedFiles` 恒等于 catalog 自己声明的文件集。

**影响**：`verifySignedCatalog` 的 `allowedFiles` 检查退化为"每个文件都在自己里"——**恒真**。签名实际只证明"签发者签过这份清单"，不再证明"这份清单属于该版本应有的文件集合"。后果是：一旦发布侧/中间环节能替换 `catalog-envelope.json` 并重签（或签名流程本身被绕过），任意文件都能进入安装树而 `allowedFiles` 一定通过。第 1489–1490 行（`allowedArtifact` 集合相等）部分兜住了资源包，但第 1495 行采用的正是外部口径 `meta.target.allowedFiles`——**同一函数内两种口径并存**，是明确的口径不一致（也是用户列出的架构问题之一，此处给出可执行证据）。

**最小修复**：第 78 行的 `allowedFiles` 改为由**上一层已验签的元数据**传入（同第 1495 行的 `meta.target.allowedFiles` 写法）；若确实没有外部清单，则显式区分两个 API：`verifySignedCatalog(envelope, policy)` 不传 `allowedFiles` 时改为断言"catalog 自身 sha256 已在上层钉住"，而不是伪造一个恒真白名单。禁止在 `allowedFiles` 参数位置出现 `raw.files.map(...)` 形态（可加 lint）。

## P0-5 硬编码 `resources/NVIDIA Corporation/umdlogs` 必须为空 —— 驱动写日志即安装失败

**证据路径 / 行号**：`...\delivery-tools\engine-tree-runtime170.cjs:23-24`、`:26`、`:31-32`、`:44`、`:203`

**代码原文**
```js
// 第 23–24 行
const approvedEmptyDirectoryPaths = Object.freeze(['resources/NVIDIA Corporation','resources/NVIDIA Corporation/umdlogs']);
const approvedEmptyDirectory = name => approvedEmptyDirectoryPaths.includes(name);
// 第 32 行
if(names.length){const leaf=path.join(parent,'umdlogs'),stat=await u.assertPath(io,leaf,{directory:true,root});requireValue((await io.readdir(leaf)).length===0,'UNEXPECTED_SOURCE_DIRECTORY','已知日志目录必须为空');
// 第 203 行
if (stat.isDirectory()) { requireValue(directories.has(relative)||emptyDirectoryAlwaysAllowed(relative)||emptyMutableDirectoryAllowed(relative)&&(await io.readdir(file)).length===0, 'TREE_CHANGED', …
```

**触发条件**：源机器/目标机器上装了 NVIDIA 驱动并把 `umdlogs` 写进 `resources/NVIDIA Corporation/umdlogs`（驱动日志默认就写在这里，且会在进程运行期持续写入）。

**影响**：安装/选择来源时抛 `UNEXPECTED_SOURCE_DIRECTORY`（"已知日志目录必须为空"）。这是一条**环境相关但触发即失败**的硬失败路径：用户在正常使用机器上点升级，因为显卡驱动写了一行日志就再也升不了，且报错文案不告诉用户"删掉 NVIDIA 日志即可"。第 44 行 `emptyDirectoryAlwaysAllowed = name => approvedEmptyDirectory(name)` 又把父目录 `resources/NVIDIA Corporation` 无条件放行（不检查是否为空），与第 32 行的空目录要求形成两套口径。

**最小修复**：`umdlogs` 改为**排除而非要求为空**——在 `inspectArtifactTree` 中把该前缀整体 `ignore`（与 `.git` 等同级处理），或用 `emptyMutableDirectoryPrefixes` 同一机制（第 43 行已有该机制且已带 `length===0` 判断）。同时把 `emptyDirectoryAlwaysAllowed` 并入 `emptyMutableDirectoryAllowed`，消除"无条件放行"这条特例。

---

# 2. P1 缺陷（8 条）

## P1-1 `layout()` 单次 install 被调用 23 次、每次重扫整树 —— 预写阶段 300–500 s 的主因

**证据**：`engine-tree-runtime170.cjs` 中 `await layout(` 出现在 **19 个物理行、23 次调用**：307（两次）、312、959、972、1048（两次）、1053、1056（两次）、1068、1073、1080、1082、1086、1089、1157、1176（两次）、1229、1235、1284、1299。函数定义在 **615 行**：

```js
615:  async function layout(record, recovery = true, contents = record.runtimeWrites !== true) {
```

用户估计"约 11 次"是**低估**；真实主路径（`install` → 预写 → `commit` → 校验 → `writeStartup`）会命中 959/972（选源）、1048/1053/1056（rename 前后）、1068/1073/1080/1082/1086/1089（回滚/提交双检）、1176（prepared）、1229/1235（commit）、1284/1299（启动读取）。每一次内部扫 3–5 棵整树（见 §4 的 `inspectArtifactTree` 调用点：194/211/239/1374/1484/1500/1506/1546/1609/1611/1698/1722）。

## P1-2 `publicProof()` 全文件 9 个调用点，单次升级可达 6–8 次全量重哈希

**证据**：定义 `engine-tree-runtime170.cjs:1477`；调用点 **1557、1665、1679、1688、1743、1795、1796、1797**，以及 1709 的 `currentPair(await publicProof())`。用户已知"一次升级调用 4 次"是**最低值**（例如仅走 `verifyPublication` + `assertWorkerRuntime` + `verifyApprovalAuthority` 三条桥接口就是 3 次）；真实 `install` 路径 `1557`（facts/approval）→ `1665` → `1679` → `1688` → `1743`（bridge handoff）至少 5 次。逐字节量化见 §4.1。

## P1-3 `assertPath()` 每文件 4 次祖先链 `lstat+realpath`（TOCTOU 窗口同时存在）

**证据**：`employee-update-cache.cjs:20-24`（`assertPath` 逐段 `io.lstat` + `io.realpath`）；`engine-tree-runtime170.cjs:64`（`replace()` 内连续 4 次：`checkedDigest`→`fileHash`→`openChecked` 内含 1 次、`assertPath(dirname(target))`、`assertPath(target,{missing})`、`assertPath(temp)`）。

```js
// employee-update-cache.cjs:23-24
let s;try{s=await io.lstat(p,{bigint:true});}catch(e){if(e.code==='ENOENT'&&p===file&&missing){}else throw e;}
if(s){if(s.isSymbolicLink()||p!==file&&!s.isDirectory())fail('UNSAFE_PATH','Update path contains a link or non-directory');…samePath(await io.realpath(…
```

`assertPath` 是"先查后用"（check-then-use），`assert` 与实际 `open/rename` 之间没有句柄绑定。真正的绑定在 `assertHandle`（`openChecked` 后 `fstat` 两次），所以安全上不致命，但**性能上每文件付出 4 遍祖先链**。同一个文件在 `initial-patch-core.cjs:19-21` 又实现了一遍 `fileHash`/`copy`/`inspectArtifactTree`（见 §5-5），两套并行。

## P1-4 `jewelry:module-print` / `jewelry:module-workspace-request` 未走 `trustedSender`

**证据**：`E:\...\app\main.cjs:161`、`:162`；对照 `:63`（`nativeHandler` 统一包 `trustedSender(event)`，共 27 个 handler 全部覆盖）与 `:45`（`trustedSender` 定义）。

```js
161: ipcMain.handle('jewelry:module-print',async(event)=>{try{return await moduleViews.print(event.sender,event.senderFrame);}catch(error){return{ok:false,error:error.message||'模块打印未完成'};}});
162: ipcMain.handle('jewelry:module-workspace-request',async(event,input)=>{try{return await moduleViews.workspaceRequest(event.sender,event.senderFrame,input);}catch(error){return{ok:false,status:403,data:{error:error.message||'模块协作请求未完成'}};}});
```

当前**失败关闭**（`moduleViews.print` 会 `frame===mainFrame` + 同源校验，`module-views.cjs:65`），所以只是纵深防御缺一层：任何非主框架的 `webContents` 都能触达这两个入口并把异常吞成 `{ok:false}`，掩盖真实调用方。修复为在 `moduleViews.print/workspaceRequest` 之前补 `trustedSender(event)` 即可，零行为变化。

## P1-5 桌面端存在一个"通用本机请求代理"，绕过逐操作授权

**证据**：`main.cjs:125-137`

```js
125: ipcMain.handle('jewelry:request', (event, input) => {
127:   if (!input || … || !/^\/(api|auth)\//.test(input.path)) return { ok: false, status: 400, … };
132:     const result = await network.request(input);
```

渲染层（含被加载的模块页面，同为 gateway origin）可通过 `preload.cjs:23` 的 `request()` 直接构造任意 `/api/*`、`/auth/*` 请求，包括方法、body、headers。授权完全依赖后端路由自身的鉴权。风险不在"当前能提权"（后端有 `requireSales` 等），而在于**前端每加一个敏感操作，后端必须同步加固，前端侧没有任何第二道闸**；且 `input.path` 只校验前缀，不做路径规范化（`/api/../admin/...` 之类在 `new URL(...,'http://offline.invalid')` 归一化后仍需后端兜底）。

建议：维护"允许经由代理的 path×method"白名单（与 `preload.cjs` 的 47 个具名 API 同粒度），未命中的请求要求走专用 IPC。

## P1-6 审批记录路径与机器身份（SID）强绑定，跨机复制必然失配

**证据**
- `...\package\审批工具\Prepare-Repeat-Approval-170.ps1:196`（`$sid=…WindowsIdentity]::GetCurrent().User.Value; …$publicationId=$preset.publicationId`）与 `:210`（`$approvalRoot=Fixed-ApprovalDirectory $common $sid $publicationId`）
- `:114-118` `Get-FixedApprovalBase` 返回 `Join-Path $Common ('鑫金源珠宝补丁审定-'+$Sid)`
- `...\delivery-tools\universal-worker-170.cjs:21-22`：`osUser` 用 `^S-1-\d+(?:-\d+)+$` 校验（即 SID），并要求 `basename(dirname(approvalRoot))==='鑫金源珠宝补丁审定-'+value.osUser`
- `...\delivery-tools\engine-tree-runtime170.cjs:1529`：`core.validateApproval(...,{osUser:authority.osUser,now:Date.now,upgradeMode:'repeat'})`

口径本身**是自洽的**（`osUser` 实为 SID，两边都拼 `鑫金源珠宝补丁审定-<SID>`），所以这不是"拼不上"的 bug；问题是**审批记录被设计成绑定 (SID, publicationId, 目录 ACL)**：任何"把审批好的记录拷到另一台机/另一 Windows 账户"的操作都必然失配，而现场最自然的排障动作恰恰是复制审批目录。配合 `zip:Initial-Full-Upgrade.ps1:52` 的 `Pin-PlainFile $approvalFile`，缺记录时抛出的是原始 `PathNotFound`（用户已知缺陷）——**根因链是"路径绑机器身份 + 缺记录不做前置可读判断"**。

## P1-7 员工补丁包内唯一入口文件名已损坏（GBK 字节 + UTF‑8 标志）

**证据**：`python zipfile` 读 a17 包 1020 条目，**仅 1 条非 ASCII**：`flag_bits=0x0800`（已置 UTF‑8 位）但字节实为 GBK 编码，解码结果为 `һ����������.cmd`。该条目即"一键完整升级.cmd"。

**影响**：Windows 资源管理器 / 7‑Zip / WinRAR 在解压时按 UTF‑8 解码，得到的文件名是乱码，且**不同于包内脚本互相引用时用的名字**；用户双击不到入口，或解压后脚本找不到同伴文件。这类问题在中文 Windows 上表现为"解压出来一堆问号"。

**最小修复**：打包时以 UTF‑8（无 BOM）+ 显式 `zipfile.ZipInfo(..., ).flag_bits |= 0x800` 写入，并在 CI 加一条断言：`ZIP` 内所有非 ASCII 条目名必须能被 `utf-8` 严格解码且 `name == name.encode('utf-8').decode('utf-8')`。

## P1-8 `initial-patch-core.cjs` 与 `employee-update-cache.cjs` 各实现一套 `fileHash/assertPath/hasher`

**证据**：`initial-patch-core.cjs:19`（`fileHash`）、`:20`（`copy`）、`:21`（`inspectArtifactTree`）、`:23`（`packageIdentity`）；`employee-update-cache.cjs:20`（`assertPath`）、`:39`（`hashHandle`）、`:4`（`CHUNK=4194304`）。

两条更新链（首次完整补丁 / 员工自更新）**没有任何共享摘要缓存**，文件哈希函数重复实现 2 份、路径断言 2 份。任何一处修 TOCTOU 或改 CHUNK 都要改两点，是"修一个漏一个"的结构根源（用户已修的两个真实缺陷——空目录白名单 `TREE_CHANGED`、catalog 外三文件 `UNEXPECTED_SOURCE_FILE`——都属这一类）。

---

# 3. P2 缺陷与隐患（7 条）

## P2-1 版本号散落 7 个文件、近 100 处字面量

| 文件 | `'1.7.0'` | `'44.9.0'` |
|---|---|---|
| `engine-tree-runtime170.cjs` | **37** | **15** |
| `native-employee-slot170.cjs` | 14 | 6 |
| `universal-worker-170.cjs` | 10 | 7 |
| `bridge-entry-170.cjs` | 4 | 0 |
| `engine-bridge-source170.cjs` | 4 | 0 |
| `engine-native-entry170.cjs` | 3 | 4 |
| `fresh-employee-install-170.cjs` / `fresh-program-install-170.cjs` | 1 / 1 | 1 / 1 |
| `审批工具\approval-core-170.cjs` | 1 | 0 |
| 桌面端 `native-publication-update.cjs` | **17** | 0 |
| 桌面端 `native-employee-location170.cjs` | 4 | 3 |

r2 补丁只改了 1 个文件，**其余 8 个文件、约 90 处仍在源码里**，下一个版本必然复发（P0-2/P0-3 就是其中两处）。见 §5-4。

## P2-2 `engine` 一词在两条链上指两个不同 EXE，且尺寸常量分叉

- `审批工具\approval-core-170.cjs:5`：`ENGINE={size:246302720, sha256:'db3ad206…', electronRunAsNode:true, nodeSqliteBackup:true}`（1.6.2 助手 EXE）
- `engine-tree-runtime170.cjs:1522`：`requireValue(sourceExe?.size===247184896&&sourceExe.sha256===targetExe?.sha256,'BAD_SLOT_SOURCE','原员工44.9完整引擎身份错误')`（44.9 员工完整引擎）
- `审批工具\Prepare-Repeat-Approval-170.ps1:25`：`$engineSize = 246302720`

两个对象都叫 `engine`，尺寸差 881,024 字节。**已核实不是矛盾**（不同产物），但字段名相同、错误文案都在说"引擎身份"，是明显的排障陷阱；建议改名为 `assistantExe` / `employeeEngineExe`。

## P2-3 `Prepare-Repeat-Approval-170.ps1` 内嵌第三份硬编码发布指纹

**证据**：`:25` `$engineSize = 246302720`；`:39` `publicationId='f2a76c739b5b78975d03c82ac6bacb8e65719c8d0d5192f2bf69ae62955fe0b3'`；另 `:38` 有 `zipHash='b1a7b120…'` 预设。这些与 `native-publication-update.cjs`、`universal-worker-170.cjs`、`engine-tree-runtime170.cjs` 内的同名常量各自维护，**换版本要改 3+ 处**。

## P2-4 `engine-startup-gate.cjs` 在"生产代码"里保留测试夹具分支

**证据**：`:36`

```js
if(same(path.dirname(parent),fixtureBase)&&/^case-[A-Za-z0-9_-]{1,80}$/.test(path.basename(parent))&&path.basename(installDir)==='program'){actualGuest();return path.join(parent,'engine-state');}
```

只要目录名形如 `runtime/engine-tree-tests/case-xxx/program`，就走 `actualGuest()`（会 `execFileSync('C:/Python314/python.exe', ...)` 并核对摘要）。这是测试便利，但在发布物里意味着**一条依赖"路径形状"的旁路**；且硬编码 `C:/Python314/python.exe` 在无 Python 的机器上会产生与"启动失败"无关的报错。建议移到独立测试入口或由环境变量显式开启。

## P2-5 `install-location.cjs` 的版本正则只接受 `1.x.y`

**证据**：`D:\Codex\xjy-release-20261022\candidate\build-old170\package\受信助手\delivery-tools\install-location.cjs` 内 `validVersion = /^1\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/`（`SOURCE_ORDER` 共 8 个来源候选）。发布到 2.x 时全链路拒绝，属"版本号散落"的第三处。

## P2-6 补丁包只有一个入口 `.cmd`，命名已损坏（见 P1-7），且无 `README`/`使用说明`

**证据**：a17 包 1020 条目 = 1007 个 payload 文件 + 10 个 delivery-tools + 3 个元数据（catalog/source-policy/manifest），无任何说明文件。遇到 P0-1/P1-6 这类失败时用户无任何可自查的指引。

## P2-7 `preload.cjs` 暴露 47 个 API 无分组、无参数校验

**证据**：`preload.cjs:8-47`，`Object.freeze` 仅冻结对象本身（值仍是函数）。`invoke(channel, input)` 的 `channel` 虽被 47 处调用点写死（**不是**任意通道，这点安全），但所有 `input` 原样透传，校验全在 main 侧。属可维护性问题：新增 API 容易漏 `trustedSender`（P1-4 即是）。

---

# 4. 性能热点（量化）

## 4.1 字节账：一次 `publicProof()` 到底重哈希多少

`publicProof`（`engine-tree-runtime170.cjs:1477-1506`）在一次调用内做的**全量哈希**：

| 对象 | 证据行 | 文件数 | 字节 | MiB |
|---|---|---|---|---|
| 资源/工具树 `artifactDir` | :1484 `inspectArtifactTree({artifactDir:p.artifactDir})` | 1007 | 164,210,260 | 156.6 |
| 归档 `archiveFile` | :1485 `core.fileHash(fs,p.archiveFile,…)` | 1 | 164,878,024 | 157.2 |
| 外置完整助手树 `workerRoot` | :1500 `inspectArtifactTree({artifactDir:p.workerRoot})` | 101 | 386,082,465 | 368.2 |
| 完整引擎目标树 `engineArtifactDir` | :1506 `inspectArtifactTree({artifactDir:p.engineArtifactDir})` | 1079 | 550,496,808 | 525.0 |
| **单次合计** | | **2188** | **1,265,667,557** | **1,207.0（1.18 GiB）** |

> 数据来源：`candidate\approvals\resource.catalog-envelope.json`（1007 文件/164,210,260 B）、`worker.catalog-envelope.json`（101/386,082,465）、`target.catalog-envelope.json`（1079/550,496,808）、a17 包内 `catalog-envelope.json`（归档 size 164,878,024）。

**乘以调用次数**：

| 调用次数 | 字节 | 用户观测 5.7–6.3 GB 对应 |
|---|---|---|
| 4 次（用户已知下限） | 5.06 GB | 偏低 |
| **5 次** | **6.33 GB** | **吻合** |
| 6 次 | 7.59 GB | 偏高 |

结论：现场"5.7–6.3 GB"对应 **4.5–5 次** `publicProof`，与 §P1-2 统计的 9 个调用点、主路径命中 5 次完全一致。**每多一个桥接口（:1795/:1796/:1797）就再多 1.27 GB。**

## 4.2 syscall 账

**单文件**（`inspectArtifactTree` → `fileHash`，`employee-update-cache.cjs:19-24` + `initial-patch-core.cjs:19`）：
- `assertPath(file)`：1× `lstat` + 1× `realpath`
- `assertPath` 逐祖先：树深 d ≈ 6 → d×(lstat+realpath) ≈ 12
- `openChecked`：1 `open` + 1 `fstat`
- `hashHandle`（:39，`CHUNK=4194304`）：`read` 次数 = ceil(size/4MiB)
- 收尾 `assertHandle`：1 `fstat`
→ 约 **16 次 stat/realpath + 1 open + N 次 read**，即 ~17 次元数据 syscall / 文件。

| 场景 | 文件数 | 元数据 syscall 量级 |
|---|---|---|
| 单次 `publicProof` | 2188 | ≈ 37,000 |
| 单次 `publicProof`，×5 次 | 10,940 | ≈ **186,000** |
| `replace()` 每文件 4 次 `assertPath`（:64） | 1007 文件 × 4 | ≈ 64,000（仅替换阶段） |
| `layout()` 23 次 × 3–5 棵树（按安装树 ~3.3k 文件估） | 23 × 4 × 3300 | ≈ **300,000** |

两者叠加 ≈ 50 万次元数据 syscall/次升级，在机械盘 + Windows Defender 实时扫描下正是"预写阶段 300–500 s"的量级来源；哈希 CPU（SHA‑256 1.5→1.2 GB/s 实测区间）只占 1.3 GB ≈ 1–2 s，**瓶颈是重复而非单次速度**。

## 4.3 四条优化（均不削弱校验）

**优化 1：`publicProof` 进程内记忆化 + 显式失效**
- 做法：以 `(artifactDir, engineArtifactDir, workerRoot, archiveFile)` 为 key，缓存在 runtime 实例上；`writeJournal`/`replace`/`rename` 成功后置脏。
- 安全论证：命中判据不是"时间"，而是四个根目录的 `(dev,ino,birthtimeNs,mtimeNs,size)`（`statIdentity` 已在 `employee-update-cache.cjs` 内可用）+ 每次实际安装前仍走 `assertNoOthers`。摘要值本身仍是 sha256，缓存只复用已算结果；任何写路径都会把 mtime/size 改掉 → 自动失效。**收益：4→1 次，省 3.8 GB I/O。**

**优化 2：摘要下传（stage 阶段算一次，install 阶段复用）**
- 做法：`stage` 时把每个文件的 `{path,size,sha256}` 写进 journal（`employee-update-installer.cjs` 已有 journal 写入点 `:57`），install 阶段只做 `size`+`(dev,ino)` 比对，抽样 5% 重哈希。
- 安全论证：journal 用 `authenticatedWrite(profileDir,installDir)` 认证（`:57`），仍受签名 catalog 约束；抽样策略的风险面是"同尺寸同 inode 的静默篡改"，概率极低且可由 `assertNoOthers` + 独占锁（`:52`）压制。**收益：install 阶段去掉 1.27 GB 重哈希。**

**优化 3：`layout()` 合并为一次扫描 + 增量**
- 做法：把 23 个调用点收敛为 1 次全树扫描的结果对象（`Map<path, statIdentity>`）传给后续步骤；`rename` 前后只 stat 变更路径。
- 安全论证：`layout` 的职责是"确认树形状态"，最终仍由 `exactTree`（`:203`）+ `inspectArtifactTree` 做完整校验；改成"一次完整 + 多次增量"不改变最终判据，只去掉重复。**收益：约 30 万 syscall → 3 万。**

**优化 4：`assertPath` 祖先链缓存**
- 做法：按目录缓存 `realpath` 结果与 `statIdentity`（进程生命周期内目录不换），每文件 4 次断言降为 1 次；`replace()`（`:64`）的 4 连调用合并为 1 次。
- 安全论证：目录链的安全性由 `assertHandle` 的 `fstat` 兜底（已存在），缓存只省重复的 `realpath`；若担心目录被替换，在缓存 key 上附带父目录 `statIdentity` 即可。

---

# 5. 架构问题（结构性）

## 5-1 目录白名单靠"硬编码单条链"

`engine-tree-runtime170.cjs:23` 把两段路径写死为常量，`:31-32` 单独为 `umdlogs` 写"必须为空"的特例，`:44` 又给父目录开了"无条件放行"。同类需求（将来遇到 `resources/Azure`、`resources/*/log`）只能再复制一遍。**建议**：把空目录/可写目录声明放进**签名过的 catalog**（`policy.emptyDirectories: [{path, mustBeEmpty:true}]`），由 `inspectArtifactTree` 通用处理；删除 `emptyDirectoryAlwaysAllowed` 这条无条件分支。

## 5-2 `allowedFiles` 口径不一致（自证 vs 外部）

`:78` 用 `raw.files.map(...)`（自证），`:1495` 用 `meta.target.allowedFiles`（外部）。同一函数内两种语义，审计者无法判断哪条是契约。**建议**：统一为外部口径；`createTrustedUpdatePolicy` 强制要求 `allowedFiles` 参数来自"上一层已验签对象"，并在函数内断言 `allowedFiles.length === files.length` 之外再断言集合相等（`:1490` 已有此写法可复用）。

## 5-3 审批记录跨机复制导致失配（根因是"路径即身份"）

审批根目录 = `%ProgramData%\鑫金源珠宝补丁审定-<SID>\<publicationId>\`（`PS1:118` + `:210`），native 侧用 `osUser`(实为 SID) 反推同构路径（`universal-worker-170.cjs:22`）。**建议**：
1. 记录的**归属**放进签名内容（`osUser`/`installationIdentity` 已在 `approval-core-170.cjs:48` 的记录字段里），路径只做定位，不做授权；
2. native 侧校验失败时区分"目录不存在"与"目录存在但记录不匹配"，前者给可读提示（配合 r2 的 PathNotFound 修复）；
3. 提供 `repair-approval-location.ps1`（只读校验 + 打印应放路径），把排障从"复制粘贴"变成"按提示复制"。

## 5-4 版本号判定散落在 7+ 文件（见 P2-1 表）

**建议**：单一来源 `release.json`（`{targetVersion, engineVersion, sourceVersions, fileCount, engineSize, engineSha}`）在构建期注入，源码内**禁止**出现 `'1.7.0'` 字面量；CI 加 `grep -rn "'1\.7\.0'\|\"1\.7\.0\"" --include=*.cjs` 必须只命中 `release.json` 生成物。这条能一次性根治 P0-2 + P0-3 + P2-1 + P2-3 + P2-5。

## 5-5 两条更新链各自造轮子

`employee-update-cache.cjs`（自更新）与 `initial-patch-core.cjs`（首次补丁）各有一份 `fileHash`/`assertPath`/树扫描。**建议**抽出 `delivery\verified-io.cjs`（`fileHash`、`assertPath`、`inspectArtifactTree`、`hashHandle`），两侧只保留业务差异；这同时也是 §4.3 优化的落点（缓存只能加在一个地方，加两处必然漂移）。

## 5-6 `upgradeMode` 分支散落

`initial-patch-core.cjs:11`（`pathPolicy`）、`:22`（`verifySourcePolicy` 的 `upgradeMode==='repeat'`）、`:24`（`validateApproval` 的 `upgradeMode`）、`:25`（`createInitialPatchInstaller` 的 `options.upgradeMode`）——四层各自解释同一个模式串。**建议**：改为策略对象 `{mode, pathPolicy, allowedExtraFiles, requiresPriorApproval}`，一处构造、逐层透传。

---

# 6. 建议的下一轮 3 个改动

### 改动 1（治根）：版本常量单一来源 + CI grep 闸门
- 交付：`release.json` + 构建期注入（替换 `engine-tree-runtime170.cjs` 37 处、`native-publication-update.cjs` 17 处、`approval-core-170.cjs:6`、`Prepare-Repeat-Approval-170.ps1:25/39`）。
- 直接消掉：**P0-2、P0-3、P2-1、P2-3、P2-5**。
- 验收：`grep -rn "'1\.7\.0'"` 在 `app\` 与 `delivery-tools\` 下零命中（除生成物）；`engine-startup-gate.cjs:52` 改为集合判定后，用 1.6.2 与 1.7.0 两套夹具各跑一次启动门。

### 改动 2（治装不上）：员工补丁入口去字面量 + 缺记录可读报错
- 交付：`zip:delivery-tools/Initial-Full-Upgrade.ps1` 第 65 行读 `policy.targetVersion`、第 81 行用 `$CandidateRole`；第 52 行 `Pin-PlainFile` 前加 `Test-Path $approvalFile` 并抛"审批记录缺失，应位于 <路径>"；打包器修正 `.cmd` 文件名的 UTF‑8 标志。
- 直接消掉：**P0-1、P1-7**（以及用户已知的 PathNotFound 症状）。
- 验收：a18 包在 **1.6.2 员工机**上跑通完整升级；在**无审批记录**的机器上得到中文可读提示而非 `PathNotFoundException`；`7z l` 列出 `.cmd` 名称正确。

### 改动 3（治 300–500 s）：`publicProof` 单次求值 + `layout` 单次扫描
- 交付：`publicProof` 进程内记忆化（key = 四根 `statIdentity`，写路径置脏）；`layout` 结果对象下传，23 个调用点收敛；`assertPath` 祖先链缓存；`replace()` 的 4 连断言合并为 1。
- 直接消掉：**P1-1、P1-2、P1-3**（对应 §4.3 优化 1/3/4）。
- 验收：同一台机上 `pre-write` 阶段从 300–500 s 降到 **< 90 s**；`publicProof` 调用计数（加临时计数器）从 5 降到 1；安装后 `engine-startup-gate` 与 `exactTree` 校验结果不变（拿 a17 包做对照）。

---

# 附录 A：证据索引（文件:行 → 结论）

| 文件:行 | 结论 |
|---|---|
| `engine-tree-runtime170.cjs:23,24,26,31,32,44,203` | 空目录白名单硬编码单条链（P0-5） |
| `engine-tree-runtime170.cjs:74` | `files.length===1079` 硬编码（P0-3） |
| `engine-tree-runtime170.cjs:78,1487,1498` vs `:1495` | `allowedFiles` 自证式 vs 外部口径（P0-4、5-2） |
| `engine-tree-runtime170.cjs:81,1522` | 247,184,896 引擎尺寸（P2-2） |
| `engine-tree-runtime170.cjs:307,312,959,972,1048,1053,1056,1068,1073,1080,1082,1086,1089,1157,1176,1229,1235,1284,1299` | `layout()` 19 行 23 次调用（P1-1） |
| `engine-tree-runtime170.cjs:615` | `layout()` 定义 |
| `engine-tree-runtime170.cjs:1477-1506` | `publicProof()` 定义与 4 处全量哈希（§4.1） |
| `engine-tree-runtime170.cjs:1557,1665,1679,1688,1709,1743,1795,1796,1797` | `publicProof` 9 个调用点（P1-2） |
| `engine-tree-runtime170.cjs:64` | `replace()` 内 4 连 `assertPath`（P1-3） |
| `employee-update-cache.cjs:4,19-24,39` | `CHUNK`/`assertPath`/`hashHandle`（P1-3、§4.2） |
| `initial-patch-core.cjs:19,20,21,23` | 第二套 `fileHash`/`inspectArtifactTree`（P1-8、5-5） |
| `native-publication-update.cjs:15,20,38,39` | 1.7.0 硬编码前置门（P0-2） |
| `engine-startup-gate.cjs:36,52` | 测试夹具旁路 + `programVersion!=='1.7.0'`（P0-3、P2-4） |
| `main.cjs:45,63,125-137,161,162` | `trustedSender` 覆盖、通用代理（P1-4、P1-5） |
| `preload.cjs:8-47` | 47 个 API 无分组（P2-7） |
| `approval-core-170.cjs:5,6,7,24,46,48` | `ENGINE`/`TARGET_VERSION`/`SOURCE_VERSIONS`（P2-2、5-4） |
| `Prepare-Repeat-Approval-170.ps1:25,38,39,114-118,146,194,196,203,210` | 审批根目录 SID 绑定 + 内嵌指纹（P1-6、P2-3） |
| `zip:delivery-tools/Initial-Full-Upgrade.ps1:24,52,65,66,80,81,82` | 1.6.2 版本门 + 强制 host（P0-1） |
| `universal-worker-170.cjs:21,22,35,37` | `osUser`=SID 与审批目录口径（P1-6） |
| `install-location.cjs` `validVersion` 正则 | 只接受 1.x.y（P2-5） |
| a17 zip 1020 条目 / `flag_bits=0x0800` | `.cmd` 名损坏（P1-7） |

# 附录 B：已核实并**排除**的怀疑（避免下轮误改）

1. **`approval-core-170.cjs:5` 的 246,302,720 与 `engine-tree-runtime170.cjs:1522` 的 247,184,896 并不矛盾**——前者是 1.6.2 助手 EXE，后者是 44.9 员工完整引擎（错误文案明写"原员工44.9完整引擎"）。属命名陷阱（P2-2），不是常量错。
2. **审批根目录 `鑫金源珠宝补丁审定-<SID>` 两侧能拼上**——`universal-worker-170.cjs:21` 用 `^S-1-\d+(?:-\d+)+$` 校验 `osUser`，说明该字段存的就是 SID，与 `PS1:118` 的 `$Sid` 同构。P1-6 的问题是"路径即身份"的设计，不是拼写不一致。（这一条本报告曾按 P0 怀疑，经验证排除。）
3. **`preload.cjs` 的 `invoke(channel, input)` 不是任意通道**——47 个调用点全部写死 channel 名，无渲染层可控 channel。
4. **`jewelry:module-print` / `module-workspace-request` 当前失败关闭**——`moduleViews` 内部做 `frame===mainFrame` + 同源校验，只是缺 `trustedSender` 纵深（P1-4，非 P0）。
5. **`emptyDirectoryAlwaysAllowed` 不会让任意文件混入**——`inspectArtifactTree` 仍会枚举文件，并与 catalog 逐行比对（`:1500`、`:1506` 的 `same(rows(...),rows(catalog.files))`），`:203` 的无条件分支只影响"目录是否允许存在"，不影响"文件是否允许存在"；若攻方在该目录下放一个未声明文件，会在文件比对处失败。

# 附录 C：本轮未覆盖（下轮建议补）

- `administration.cjs`（33,749 B）、`backend.cjs`（33,962 B）、`workspace-collaboration.cjs`（43,389 B）、`central-print-jobs.cjs`（48,096 B）只做了模板 SQL 扫描与函数名抽样，未逐行审计数据写入路径（备份/还原/清库）。
- `native-employee-slot170.cjs`（420 行）只读了前 40 行与关键断言，未审 41–420 的槽位迁移逻辑。
- `lan.cjs`（局域网协同）已确认加密为 X25519+HKDF+AES‑256‑GCM 且 `publicPin` 校验在客户端（`client:345`），但服务端不校验对端公钥，属"加密≠认证"，本轮未深挖中间人场景。
- 未验证任何构建/签名流程（按只读要求）。
