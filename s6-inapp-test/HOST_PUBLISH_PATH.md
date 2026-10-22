# 主机侧如何把员工升级包提供给员工机 —— 只读取证报告

> 取证对象：`F:\自制软件\xjy-jewelry-offline\resources\app.asar`（13,495,963 B，只读解包）
> 解包命令：`E:\node\npx.cmd --yes @electron/asar extract "F:\自制软件\xjy-jewelry-offline\resources\app.asar" %TEMP%\hostpub`
> 解包根：`C:\Users\Administrator\AppData\Local\Temp\hostpub\`（下文所有 `文件:行号` 均以此为根，即 asar 内同路径同行号）
> 只读声明：未修改任何既有文件、未结束任何进程、未写入 `F:\` 任何内容。本 md 是唯一新建文件。
> 取样时间：2026-10-22 17:34（Asia/Shanghai）

---

## 0. 结论速览（TL;DR）

| 问题 | 结论 |
|---|---|
| **Q1 读时机** | 分发器**对象**在主机进程启动时创建一次（`desktop-host-runtime.cjs:97`）；清单/包的**内容每次都现读**，不做缓存（`update-distribution.cjs:51`、`native-update-distribution.cjs:63`）。**文件缺失 = 静默降级**为 `available:false`（"主机尚未发布员工更新包"）；**校验不过 = 显式报错**（503/409），不静默退回。 |
| **Q2 主机开关** | 要求 `role=host`（`release-app.cjs:308-310` + `managed-print-worker.cjs:9`）✅ 已满足；要求本机**管理员**启用局域网主机并给出 32 位连接码（`lan.cjs:104`、`network-workspace.cjs:72`）；要求员工账号有效（`update-distribution.cjs:93`）。**没有"发布"按钮**（渲染层与 preload/IPC 零命中）。**不校验**主机自身版本与 manifest 的 `targetVersion` 一致。 |
| **Q3 判定序列** | 已装/已见序号读 `<profile>\employee-update-cache\native-sequence.json` 的 `sequence` 字段（`native-publication-update.cjs:42`）；真实安装收据序号来自 `F:\自制软件\.xjy-jewelry-offline.xjy-engine-state\target-catalog-envelope.json`（`engine-startup-gate.cjs:6,32-40`）。过期报 `EXPIRED_NATIVE_MANIFEST`（`native-update-manifest.cjs:17`）。版本比对在 `native-update-manifest.cjs:16`（硬编码字面量）。 |
| **Q4 只放 4 个文件+重启够不够** | **够（可以拿到 sequence=21）**，前提是这 4 个文件由**同一发行私钥**签名、`sequence>=21`、`archive.size/sha256` 自洽、`expiresAt` 未过期、放在发布点目录且非重解析/硬链接。**重启并非必需**（内容每请求现读）；真正缺的不是"发布按钮"，而是**应用内没有签名私钥**——4 个文件必须由外部签名流水线产出。 |

---

## 1. 链路总览

```
主机进程 鑫金源珠宝报价.exe (role=host)
  ├─ createDesktopHostRuntime  desktop-host-runtime.cjs:97   backend=makeBackend()
  │    └─ createBackend        backend.cjs:93                updates=createUpdateDistributionApi({updateServices})
  │         └─ updateServices  release-host-services.cjs:11  ①createUpdateDistribution(旧包) ②createNativeUpdateDistribution(原生包)
  │              ├─ ① F:\鑫金源珠宝资料\程序设置\员工升级\catalog.json + package.zip
  │              └─ ② F:\鑫金源珠宝资料\程序设置\员工升级\native-manifest.json + native-package.zip
  └─ startLanServer            lan.cjs:102                  :31831  ← 员工端 HTTP 转发
                                     ↓ dispatch
            GET /api/employee-updates/native-manifest   → ② getNativeManifest
            GET /api/employee-updates/native-chunk?...  → ② getNativeChunk
            GET /api/employee-updates/catalog           → ① getCatalog
            GET /api/employee-updates/chunk?...         → ① getChunk
```

**路径定义**（`release-host-services.cjs:11-14`）—— 发布点 = `profileDir\员工升级\`，而 `profileDir` = `F:\鑫金源珠宝资料\程序设置`（`storage-locations.cjs:60`）：

```js
const updateServices=helperPins?()=>{
  catalogFile:guard.check(path.join(storage.profileDir,'员工升级','catalog.json')),archiveFile:guard.check(path.join(storage.profileDir,'员工升级','package.zip')),
  native=require('./native-update-distribution.cjs').createNativeUpdateDistribution({manifestFile:guard.check(path.join(storage.profileDir,'员工升级','native-manifest.json')),archiveFile:guard.check(path.join(storage.profileDir,'员工升级','native-package.zip')),trustedPublicKey:helperPins.publisherPublicKey})
```

> 路由注册：`update-distribution.cjs:102-104`
> ```js
> if (url.pathname === '/api/employee-updates/catalog' && !url.search) return { operation: 'catalog' };
> if (url.pathname === '/api/employee-updates/native-manifest' && !url.search) return { operation: 'nativeManifest' };
> const operation = url.pathname === '/api/employee-updates/chunk' ? 'chunk' : url.pathname === '/api/employee-updates/native-chunk' ? 'nativeChunk' : null;
> ```

---

## Q1 发布点文件是启动时读一次，还是每次请求现读？读失败会怎样？

### Q1-a 结论：分发器对象"启动时建一次"，文件内容"每次请求现读"

对象创建（进程启动时，一次）：

```js
// desktop-host-runtime.cjs:97
backend=makeBackend();
// backend.cjs:93
const updates = createUpdateDistributionApi({ runtime, administration, enqueue, updateServices });
```

`updateServices` 工厂在这一次调用里被求值（`update-distribution.cjs:89`），工厂内部只构造两个分发器对象、不做文件 IO：

```js
// update-distribution.cjs:89
try { services = typeof updateServices === 'function' ? updateServices({ runtime, administration, enqueue }) : updateServices; if (services?.then || ...
```

内容每次请求现读（**无 TTL、无 fs.watch、无进程级缓存**）：

```js
// update-distribution.cjs:51  （旧包 catalog.json）
try { descriptor = await open(catalogPath, 2097152); } catch (error) { if (error.code === 'ENOENT') { await closeSelected(); return null; } throw error; }
// native-update-distribution.cjs:63  （原生 native-manifest.json）
try { current = await assertFile(manifestPath, MAX_DESCRIPTOR); } catch (error) { if (error.code === 'ENOENT') { await closeSelected(); return null; } throw error; }
```

两个分发器各有一个 `selected` 槽位，但它的命中条件包含"文件 stat 快照未变"（`statKey` 含 `dev/ino/size/nlink/mtimeNs/ctimeNs`，`update-distribution.cjs:10`；native 见 `native-update-distribution.cjs:56,92`）。所以换文件后下一次请求必然重新读取校验，无需重启。

唯一在进程内被"记住"的是**高水位**（`highWater`/`seenManifest`，`update-distribution.cjs:16`、`native-update-distribution.cjs:95`）——它的作用是拒绝旧序号/同序号换包，不影响"是否重读文件"。

### Q1-b 读失败语义：文件缺失 = 静默降级；校验失败 = 显式错误

**文件缺失（ENOENT）→ 静默降级，返回 `available:false`，不是 `UPDATE_NOT_PUBLISHED`：**

```js
// native-update-distribution.cjs:100-102
getNativeManifest() {
  return value ? { available: true, manifest: value.envelope.manifest, signature: value.envelope.signature } : { available: false };
```

```js
// update-distribution.cjs:122
data = !services ? request.operation==='catalog' ? {available:false, reason:'主机尚未发布员工更新包，请继续使用当前程序'} : fail(503,'主机尚未发布员工更新包') : ...
```

员工端 1.7.0 看到的就是那句中文提示，而非 `UPDATE_NOT_PUBLISHED`（见 Q4 附注）：

```js
// native-publication-update.cjs:43
if(exact(data,['available'])&&data.available===false){selection=null;set('unavailable','主机尚未发布完整员工更新。');return false;}
```

**校验不过 → 显式失败（503/409），绝不静默退回：**

```js
// update-distribution.cjs:31 / :34 / :38 / :65
fail(503,'员工更新目录签名校验未通过')        // 签名
fail(503,'员工更新目录与程序身份不符')        // app/channel/platform/arch/sequence
fail(503,'员工更新目录已过期或发布时间无效')  // expiresAt
fail(503,'员工更新包校验未通过')              // archive size/sha256
// update-distribution.cjs:39 / :58
fail(409,'员工更新目录被较新发布取代')        // sequence < highWater
fail(409,'同一发布序号不能改换更新内容')      // 同序号不同内容
```

native 通道同构：

```js
// native-update-distribution.cjs:54  →  native-update-manifest.cjs:16/17/31
function validate(envelope) { return verifyNativeManifest(envelope, { publicKey, now, minimumSequence: highWater }); }
// native-update-distribution.cjs:78-79, :93
fail(409,'NATIVE_SEQUENCE_REUSED','同一更新序号的内容已被替换')        // 同序号换包
fail(409,'NATIVE_PUBLICATION_CHANGED','完整更新清单在准备时改变')      // 读到的文件秒变
```

**分发器本身构造失败（pins 缺失/公钥非法）→ 全局 503，且是唯一会"永久性"失效的情况：**

```js
// update-distribution.cjs:90 / :114
catch { initializationError = true; }
if (initializationError) fail(503, '主机员工更新发布配置无效，已停止分发');
```

**发布文件的安全断言（放文件的方式会影响成败）：**

```js
// update-distribution.cjs:20-22
for (;;) { const stat = await fileSystem.lstat(parent, { bigint: true }); if (!stat.isDirectory() || stat.isSymbolicLink()) fail(503, '员工更新发布目录不允许重解析路径'); ...
if (!stat.isFile() || stat.isSymbolicLink() || BigInt(stat.nlink) !== 1n || BigInt(stat.size) > BigInt(maximum) || path.resolve(await fileSystem.realpath(filename)).toLowerCase() !== filename.toLowerCase()) fail(503, '员工更新发布文件不是受信任的固定文件');
```

即：发布目录及其祖先不能是 junction/符号链接，文件必须是 **nlink=1** 的普通文件，大小写归一后的 realpath 必须与原路径一致。用硬链接或经 junction 中转放置会直接 503（native 侧错误码 `UNSAFE_NATIVE_PUBLICATION`，`native-update-distribution.cjs:24-36`）。

---

## Q2 主机侧是否要求 host 角色 / 再点"发布"按钮 / 校验本机版本与 targetVersion 一致？

### Q2-a 要求 host 角色 —— 是，且是启动准入强制

```js
// release-app.cjs:308-310
if(employeeClient)backend=createClientBackend();
else{ hostRuntime=await createReleaseHostServices({storage,admission:admissionDescriptor.value,...helperPins,getNetwork:()=>network,...
```

```js
// managed-print-worker.cjs:9
if(...||admission.mode==='installed'&&admission.role!=='host'||...)throw Error('主机启动准入无效')
```

### Q2-b 要求"再点一次发布"按钮 —— **不要求，也不存在**

- 主进程只暴露员工侧 IPC，没有任何主机发布入口：
  ```js
  // preload.cjs:16-18
  getEmployeeUpdateCapability:()=>invoke('jewelry:employee-update-capability'),
  getEmployeeUpdateState:()=>invoke('jewelry:employee-update-state'),
  employeeUpdate:input=>invoke('jewelry:employee-update',input),
  ```
  （对应 `release-app.cjs:184-186` 的 `nativeHandler`，全是**员工端自升级**用途。）

- 渲染层打包产物 `renderer-dist/assets/main-7etXIfP0.js` 中检索 `员工升级` / `员工更新` / `native-manifest` / `employee-updates` / `完整员工更新` / `发布更新` —— **命中数全部为 0**；只有员工侧文案如 `本机版本尚未提供自动升级入口`、`发现可升级的新版本`。

结论：**"发布"= 把文件放进 `F:\鑫金源珠宝资料\程序设置\员工升级\`**。程序内没有发布动作、没有发布按钮、没有发布进度状态。

### Q2-c 校验本机版本与 manifest 的 targetVersion 一致 —— **不校验**

主机分发器的构造参数里完全没有"主机版本"这一项：

```js
// update-distribution.cjs:12
function createUpdateDistribution({ catalogFile, archiveFile, trustedPublicKey, allowedFiles, platform = 'win32', arch = 'x64', minimumSequence = 0, fileSystem = fs, now = Date.now }) {
// native-update-distribution.cjs:14
function createNativeUpdateDistribution({ manifestFile, archiveFile, trustedPublicKey, minimumSequence = 0, fileSystem = fs, now = Date.now }) {
```

`appVersion` 只被注入浏览器 gateway，与更新无关：

```js
// desktop-host-runtime.cjs:98
gateway=gatewayFactory({backend,server,root:context.root,appVersion:options.appVersion,...
```

`targetVersion`/`engineVersion` 是**校验收端**的硬编码字面量（见 Q3），不是与主机版本动态比对。

### Q2-d 另外两个真实存在的运行时开关

| 开关 | 证据 | 现状 |
|---|---|---|
| 本机管理员启用局域网主机（host 模式 + 32 位连接码 + 端口 31831） | `network-workspace.cjs:23` 默认 `{mode, host:'', port:31831, code:''}`；`:72` `if ((config.mode === 'host' || next.mode === 'host') && localUser?.role !== 'admin') throw new Error('只有主机管理员可以启用或修改主机服务');`；`lan.cjs:104` `if (resume !== true && backend.auth.status().user?.role !== 'admin') throw new Error('请先由本机管理员登录并启用局域网主机');` | 用户声明已开启（31831 在服务） |
| 员工账号有效（每次请求都验） | `update-distribution.cjs:93` 要求 `user.active===true` 且 staff_id 为 UUID；`:94` 查 `local_accounts` 的 `password_hash`，缺失即 `fail(401,'员工更新账号已失效')` | 员工端能登录即满足 |

另有两道局域网前置门槛：主机与客户端时差超过 5 分钟直接 400（`lan.cjs:148`），请求路径必须落在 `/api` 或 `/auth` 下（`lan.cjs:154`）。

---

## Q3 员工端判定序列

### Q3-a 1.7.0 走的是"原生通道"，不是旧 catalog 通道

```js
// native-employee-update.cjs:18
if(options.currentVersion==='1.7.0')return require('./native-publication-update.cjs').createNativePublicationUpdate(options);
```

> 因此 `UPDATE_NOT_PUBLISHED` / `BAD_HELPER_PINS` / `UPDATE_HELPER_UNAVAILABLE` 这套码属于**旧通道**（`native-employee-update.cjs:22,26,36`）。1.7.0 员工看到的是 `native-publication-update.cjs` 的 `unavailable` / `BAD_NATIVE_MANIFEST` / `STALE_NATIVE_MANIFEST` / `UPDATE_CHANNEL_UNAVAILABLE`。

### Q3-b 已装 / 已见 sequence 从哪个文件哪个字段读 —— **两个来源**

**来源①（员工侧高水位，"已见"）**：`<profile>\employee-update-cache\native-sequence.json` 的 `sequence`

```js
// native-publication-update.cjs:42
readHigh()  // exact(h,['version','sequence','manifestSha256'])，ENOENT → {sequence:0,manifestSha256:null}
```

**来源②（真实已装收据，"已装"）**：引擎启动状态目录的 `target-catalog-envelope.json` 的 `catalog.sequence`

```js
// native-publication-update.cjs:22
return { sequence: c.sequence, fullTargetCatalogSha256: receipt.catalogSha256 };
// engine-startup-gate.cjs:6
const PURPOSE='xjy-engine-startup-v1',...,STATUS='engine-startup-status.json',CATALOG='target-catalog-envelope.json'
// engine-startup-gate.cjs:32-40  stateDirectory = path.dirname(installDir) + '.'+basename(installDir)+'.xjy-engine-state'
```

对生产机（`installDir=F:\自制软件\xjy-jewelry-offline`）即：
`F:\自制软件\.xjy-jewelry-offline.xjy-engine-state\target-catalog-envelope.json`（+ 同目录 `engine-startup-status.json` 与 `journal-key.bin`）。
该目录受 ACL 保护（`native-publication-update.cjs:39` 注释说明失败一律 `NATIVE_SOURCE_UNVERIFIED`）。

> 用户所述"本机已装 sequence 20"对应来源①的 `sequence:20`（也可能②同为 20）。

### Q3-c 完整判定顺序（`native-publication-update.cjs:44-45`）

```js
verifyNativeManifest(envelope,{publicKey:key,now:now()})                      // 44: 签名/形状/过期
const installed=await installedPublication({...}),high=await readHigh(),manifestSha256=u.digest(Buffer.from(envelope.manifest));
if(high.sequence===manifest.sequence&&high.manifestSha256!==manifestSha256)fail('STALE_NATIVE_MANIFEST','同一原生发布序号不能换包');  // 45
const decision=publicationDecision(manifest,installed,high.sequence);         // 45
await u.authenticatedWrite(io,path.join(profile,'employee-update-cache/native-sequence.json'),{version:1,sequence:manifest.sequence,manifestSha256},...); // 45 先写高水位再下载
```

**注意一个易踩的坑**：高水位在 `check` 阶段就已落盘（早于下载）。所以"员工看过一次 20 号清单"之后再重新打一个**同为 20 号但内容不同**的包，员工端必然 `STALE_NATIVE_MANIFEST`——这正是既往 `STALE_NATIVE_MANIFEST` 的最可能成因之一。

`publicationDecision` 的完整逻辑：

```js
// native-update-manifest.cjs:33-38
if(!installed||!Number.isSafeInteger(installed.sequence)||!SHA.test(installed.fullTargetCatalogSha256||''))fail('NATIVE_SOURCE_UNVERIFIED','当前完整安装收据未核验');
if(manifest.sequence<installed.sequence||manifest.sequence<highWater)fail('STALE_NATIVE_MANIFEST','该原生发布已被较新的发布取代');
if(manifest.fullTargetCatalogSha256===installed.fullTargetCatalogSha256){if(manifest.sequence!==installed.sequence)fail('BAD_NATIVE_MANIFEST','目标目录与发布序号矛盾');return'latest';}
if(manifest.sequence<=installed.sequence)fail('STALE_NATIVE_MANIFEST','同一发布序号不能替换完整程序');
return'available';
```

### Q3-d expiresAt 过期报什么

```js
// native-update-manifest.cjs:17
const published=Date.parse(m.publishedAt),expires=Date.parse(m.expiresAt);if(...||published>now+300000||expires<=now||expires<=published)fail('EXPIRED_NATIVE_MANIFEST','原生更新清单已过期或时间无效');
```

→ 过期、或 `publishedAt` 超前当前时间 5 分钟以上 → **`EXPIRED_NATIVE_MANIFEST`**（主机侧同一函数被 `native-update-distribution.cjs:54` 调用，故主机也会以 503 返回它）。

### Q3-e targetVersion / engineVersion 比对的确切位置

```js
// native-update-manifest.cjs:16
if(!exact(m,keys)||m.schemaVersion!==1||m.purpose!=='xjy-native-employee-update-v1'||m.app!=='xjy-jewelry-offline'||m.platform!=='win32'||m.arch!=='x64'||m.role!=='employee'||m.targetVersion!=='1.7.0'||m.engineVersion!=='44.9.0'||!Number.isSafeInteger(m.sequence)||m.sequence<1||...)fail('BAD_NATIVE_MANIFEST','原生员工更新身份不符');
```

两个调用点：
- 员工侧：`native-publication-update.cjs:44` `verifyNativeManifest(envelope,{publicKey:key,now:now()})`
- 主机侧：`native-update-distribution.cjs:54` `verifyNativeManifest(envelope,{publicKey,now,minimumSequence:highWater})`

序号下界（主机侧高水位）：

```js
// native-update-manifest.cjs:31
if(manifest.sequence<minimum)fail('STALE_NATIVE_MANIFEST','原生清单序号已被取代');
```

### Q3-f 员工端其余前置门（顺序上早于契约校验）

```js
// native-publication-update.cjs:39  角色/依赖/登录
options.currentVersion!=='1.7.0'||!employee() → fail('EMPLOYEE_DEVICE_REQUIRED')
依赖缺失                                      → fail('UPDATE_HELPER_UNAVAILABLE')
actor 无效                                    → fail('LOGIN_REQUIRED','请先登录有效的员工账号')
// native-publication-update.cjs:40  通道错误
result?.ok!==true||result.status!==200 → fail(result?.status===401?'LOGIN_REQUIRED':'UPDATE_CHANNEL_UNAVAILABLE')
```

---

## Q4 结论

### (a) 只把正确的 4 个文件放进发布点 + 重启主机程序，员工端能否拿到 sequence=21 的发布？

**能。** 理由与必要条件如下：

| 条件 | 依据 |
|---|---|
| 内容每次请求现读，无需重启 | `update-distribution.cjs:51`、`native-update-distribution.cjs:63` |
| 新序号 > 主机进程已服务过的最高序号时，主机侧无阻碍 | `native-update-manifest.cjs:31`（`sequence<minimum` 才拒）、`native-update-distribution.cjs:78-79`（仅"同序号换包"才拒） |
| 新序号 > 员工侧已装/已见序号 | `native-update-manifest.cjs:35`、`native-publication-update.cjs:45` |
| 4 个文件必须**同一发行私钥**签名 | `release-host-services.cjs:14` 传入 `helperPins.publisherPublicKey`；`native-update-manifest.cjs:5` 另有硬编码公钥指纹 |
| `archive.size` / `archive.sha256` 必须与实际 zip 完全一致 | `native-update-distribution.cjs:85-90` 整包实算 sha256 比对 |
| `expiresAt` 未过期、`publishedAt` 不超前 5 分钟 | `native-update-manifest.cjs:17` |
| 放置方式合规（非 junction、nlink=1、大小写一致） | `update-distribution.cjs:20-22`、`native-update-distribution.cjs:24-36` |
| `targetVersion=1.7.0`、`engineVersion=44.9.0`、`role=employee`、`platform=win32`、`arch=x64`、`schemaVersion=1`、`purpose=xjy-native-employee-update-v1` | `native-update-manifest.cjs:16` |

**"重启主机程序"的必要性要说清楚**：重启不是为了让程序"重新发现文件"（它本来就每次现读），它的唯一作用是**清空进程内的 `highWater` / `seenManifest`**。只有当新包序号 **≤ 本进程历史上服务过的最高序号**（例如把 20 号原地重打）时，才必须重启来绕过 `STALE_NATIVE_MANIFEST` / `NATIVE_SEQUENCE_REUSED`；但那类场景员工端本来就过不去（高水位已落盘）。**正常递增到 21 时，重启与不重启都能分发。**

**当前发布点实况（只读实测）**：`native-manifest.json` 已是 `sequence=20`、`targetVersion=1.7.0`、`engineVersion=44.9.0`、`expiresAt=2027-01-20T07:36:21.987Z`、`archive.size=781,517,156`、`archive.sha256=06ceef98…c69d848`，与 `native-package.zip`（781,517,156 B）一致。**即现有发布点就是员工已装的 20 → `publicationDecision` 命中 `'latest'`（"已安装本次完整员工发布"），永远不会出现"发现可升级"。要交付新包，必须升到 21+ 并重签。**

### (b) 还缺什么主机侧"开关"？

**明确结论：主机侧不缺"发布按钮"这种东西（它根本不存在），也不缺 host 角色开关（已满足）。真正缺的是两件事，一硬一软：**

1. **（硬缺）签名能力——应用内只有公钥，没有私钥。**
   ```js
   // generated/release-pins.cjs  （87862 B，顶层键仅 9 个）
   version / product / programVersion / publisherPublicKey / publisherPublicKeySha256 / bootstrapSha256 / files / allowedFiles
   ```
   全文 `PRIVATE` 出现 **0 次**；`native-update-manifest.cjs:5` 还硬编码了公钥指纹校验。→ **`catalog.json` / `package.zip` / `native-manifest.json` / `native-package.zip` 这 4 个文件必须由外部签名流水线（持有对应 Ed25519 私钥）产出后人工投放**，主机程序内任何操作都无法生成/重签。

2. **（软缺，运行时开关）员工可达性三件套**：本机**管理员**登录并启用"局域网主机"（`network-workspace.cjs:72`）+ 端口 31831 + **32 位连接码**配对（`lan.cjs:104`）；员工账号在 `local_accounts` 中 `active` 且可登录（`update-distribution.cjs:93-94`）。三者任一不满足，员工只会看到 `LOGIN_REQUIRED` / `UPDATE_CHANNEL_UNAVAILABLE`，与包是否正确无关。

3. **（易错点，非开关）两套序号体系互相独立**：旧 `catalog.json` 的 `sequence=4`（`version=1.7.0`、`sourceVersions=['1.6.0','1.6.1','1.6.2']`、1020 文件、`package.zip` 164,878,024 B）与 native 的 `sequence=20`（3293 文件）是两条并行通道。**1.7.0 员工只看 native 通道**（`native-employee-update.cjs:18`），把旧通道的序号改成 21 对 1.7.0 员工毫无作用。

---

## 附：错误码归属速查

| 错误码 | 归属通道 | 触发位置 |
|---|---|---|
| `UPDATE_NOT_PUBLISHED` | 旧通道（≤1.6.x） | `native-employee-update.cjs:26,36` |
| `BAD_HELPER_PINS` | 旧通道 | `native-employee-update.cjs:22` 一带 |
| `UPDATE_HELPER_UNAVAILABLE` | 员工端两通道共用 | `native-publication-update.cjs:39` |
| `EMPLOYEE_DEVICE_REQUIRED` | 员工端 | `native-publication-update.cjs:39` |
| `LOGIN_REQUIRED` | 员工端 / 主机 401 | `native-publication-update.cjs:39-40`、`update-distribution.cjs:93` |
| `EXPIRED_NATIVE_MANIFEST` | 主机+员工 | `native-update-manifest.cjs:17` |
| `STALE_NATIVE_MANIFEST` | 主机+员工 | `native-update-manifest.cjs:31,35`、`native-publication-update.cjs:45` |
| `BAD_NATIVE_MANIFEST` | 主机+员工 | `native-update-manifest.cjs:16,37` |
| `NATIVE_SEQUENCE_REUSED` | 主机 409 | `native-update-distribution.cjs:78-79` |
| `UNSAFE_NATIVE_PUBLICATION` | 主机 503 | `native-update-distribution.cjs:24-36` |
| `NATIVE_SOURCE_UNVERIFIED` | 员工端 | `native-publication-update.cjs:21,39` |
| `UPDATE_CHANNEL_UNAVAILABLE` | 员工端 | `native-publication-update.cjs:40` |

## 附：运维注意

1. 首次把新 `native-package.zip` 放好后，**第一个** `native-manifest` 请求要把整包读一遍算 sha256（约 781 MB），主机侧会明显卡顿数秒；这不是故障。
2. 换包时**必须同时换 `native-manifest.json` 与 `native-package.zip`**，否则会出现 `NATIVE_PUBLICATION_CHANGED`（409）或摘要不符 503。
3. 不要用「复制到 junction/映射盘」「硬链接」方式投放，必须 nlink=1 的实文件。
4. 员工端一旦"检查"过某序号，该序号即被记为已见（`native-publication-update.cjs:45` 先写后下载），**不能复用该序号重打内容**。
