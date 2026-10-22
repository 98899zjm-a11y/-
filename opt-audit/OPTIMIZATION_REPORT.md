# 鑫金源珠宝 1.7.0 — 性能热点审计与优化建议（只读）

> 审计日期：2026-10-22　审计方式：**纯只读静态分析 + 本机微基准 + 联网公开资料调研**
> 未执行：构建 / 签名 / 安装 / 任何写入被审目录的操作。
> 未访问：`F:\自制软件`、`F:\鑫金源珠宝资料`、微信相关目录。
> 关联既有审计：`D:\Codex\xjy-release-20261022\audit-20261022\FULL_AUDIT.md`（424 行，P0×5/P1×8/P2×7）。
> **本文不重复缺陷清单**，只做三件增量工作：①把"慢"拆成可算的乘法；②每类问题给具体开源件选型；③按"是否破坏签名链"给落地排序。

---

## 0. 结论摘要（TL;DR）

**三个最快的收益点**（都不需要重签，一天内可做完）：

1. **给安装目录加 Windows Defender 排除项**（运维动作，零代码）。现场 300–500 s 的安装耗时里，6.3 GB 的重复读盘在实时防护下按 100–400 MB/s 走，这是唯一"改一行配置就拿走一半时间"的点。预计 **−50% ~ −65%**。
2. **`assertPath` 作用域记忆化**（`delivery-tools\employee-update-cache.cjs:19`）。实测单次祖先链断言 **661 µs**，每文件被调 **4 次**（`openChecked` 2 次 + `assertHandle` 前后各 1 次），单次 `publicProof` 光走路径就 **5.8 s**，整个安装走 **~260 s**。记忆化后 **~3 s**。⚠ 需重签。
3. **把 `publicProof()` 的多处调用折成 1 次**（`engine-tree-runtime170.cjs:1557/1665/1679/1688/1709/1743/1796/1797`，共 **8 个调用点**，其中 `:1665/:1679/:1688/:1709/:1743` **5 处是安装事务必经**）。同一棵树被重复证明 5 次 → 读盘 **6.33 GB → 1.27 GB（−80%）**。⚠ 需重签。

**最值得引入的三个开源件**：

| 开源件 | 用途 | 为什么是它 |
|---|---|---|
| [BLAKE3](https://github.com/BLAKE3-team/BLAKE3) + [walkdir](https://github.com/BurntSushi/walkdir)（思路移植，不引依赖） | 并行遍历 + 多线程哈希，把"单线程逐文件 sha256"变成"线程池扇出" | 实测本机 sha256 已有 2840 MB/s，**瓶颈不是哈希算法而是系统调用**；借它的**并行遍历模型**，不改摘要格式 |
| [python-tuf / TUF 规范](https://github.com/theupdateframework/specification)（借规范，不引库） | 元数据角色分离 + 快照/时间戳 + 防回滚 | 本项目已有 `sequence`/`STALE_CATALOG`，缺的正是**过期时间与独立时间戳角色**，属于"设计对齐"而非"换实现" |
| [paged.js](https://github.com/pagedjs/pagedjs)（可选，P2） | CSS Paged Media 分页：页眉页脚、页码、跨页表格断行 | 纯前端、离线可打包、MIT；且本项目已用 `preferCSSPageSize`（`desktop\main.cjs:213`），接入零冲突 |

---

## 1. 方法与边界

### 1.1 审计边界（用户红线，逐条遵守）

| 红线 | 本次执行情况 |
|---|---|
| 不改任何被审文件 | 只读：`read`/`grep`/`sed -n`；产出只写入 `opt-audit\` |
| 不跑构建/签名/安装 | 未执行 `build.cjs`、`Sign170.cmd`、`一键升级.cmd` |
| 不碰 `F:\自制软件` / `F:\鑫金源珠宝资料` / 微信目录 | 未访问；安装现场数据取自既有审计与构建包编目 |
| 建议不得绕过签名验证 | §7 逐条复核；所有 P0 项均在签名 zip 之外 |
| 建议不得引入联网运行时依赖 | §4 每个候选带"离线可行性"列；cosign/S3/云端更新器明确排除 |
| 建议不得改变数据格式 | 树摘要算法、catalog 结构、journal 字段均不改；§4 SQLite 仅允许"新增旁路库" |

### 1.2 实测环境（结果与机器强相关，报告中标注为"本机实测"）

- 文件系统：NTFS，热页缓存；Python 3 微基准。
- SHA-256 吞吐：**2840 MB/s**（256 MB 缓冲，单线程）。
- `os.path.realpath`：**69 µs/次**；`os.lstat`：**2.9 µs/次**。
- 模拟 `assertPath`（深度 9 祖先链：9×lstat + 9×realpath）：**661 µs/次**。
- 顺序读 256 MB（页缓存命中）：3929 MB/s。
- ⚠ 现场若为机械盘或 Defender 实时防护开启，冷读只有 **100–400 MB/s**，本文所有 I/O 时间按此区间给上下界。

### 1.3 stars/license 可信度声明

本环境 `web_fetch` 对 `github.com` 与 `api.github.com` 均返回 `resolves to a non-public IP address`（出口被拦），**无法直接核实 star 数与 license 文本**。因此 `oss-candidates.md` 中 stars 一律标注"**未核实**"并给出量级区间；license 以仓库 README/生态索引（deps.dev、packages.ecosyste.ms、npm/socket）的公开摘要为准，**上线前必须人工复核 LICENSE 文件**。

---

## 2. 性能基线：为什么慢

### 2.1 数据编目（已实测求和，与 FULL_AUDIT §4.1 一致）

| 对象 | 文件数 | 字节 |
|---|---|---|
| `resource`（审定器 + 资源） | 1007 | 164,210,260 |
| `worker`（受信助手） | 101 | 386,082,465 |
| `target`（完整程序树） | 1079 | 550,494,464 |
| `archiveFile`（补丁 zip） | 1 | 164,878,024 |
| **单次 `publicProof` 合计** | **2188** | **1,265,665,213 ≈ 1.266 GB** |
| **install 主路径 ×5** | 10940 | **6.33 GB** |

`app.asar` = 13,495,963 B（12.9 MB，`candidate\build-old170\package\完整程序\resources\app.asar`）。
`generated\print-worker-templates.cjs` = 1,966,389 B（esbuild 生成物，占 asar 约 15%）。

### 2.2 成本模型：三个乘数

慢不是单点造成的，是**三个乘数叠乘**：

```
总耗时 ≈ (单文件断言次数 4) × (文件数 2188) × (单次断言 661µs) × (publicProof 次数 5)
       + (整树扫描次数 23×3.5) × (每棵树 1079 文件) × (4 次断言 + 1 次哈希)
```

| 乘数 | 当前值 | 代码位置 | 单次成本 |
|---|---|---|---|
| 每文件 `assertPath` 次数 | **4** | `employee-update-cache.cjs:19`（被 `openChecked` 调 2 次、`assertHandle` 前后各 1 次） | 4 × 661 µs = **2.64 ms/文件** |
| `publicProof` 调用次数 | **5（install 事务必经）**，全文件共 8 个调用点 | `engine-tree-runtime170.cjs:1665,1679,1688,1709,1743`（必经）+ `:1557,1796,1797`（可短路） | 2188 × 2.64 ms = **5.8 s + 1.27 GB 读** |
| `layout()` 调用次数 | **23** | 见 §3.2 行号表 | 每次 3–4 棵 1079 文件树 = **9–12 s（热）** |

**乘出来的量级**：

- `assertPath` 纯 CPU/系统调用：5.8 s + 23 × 3.5 × 2.85 s ≈ **260 s**
- `publicProof` 读盘：**6.33 GB**；`layout` 读盘（首轮后多为页缓存命中）：**~38 GB 逻辑读**
- 与现场实测 **300–500 s** 完全吻合 → 结论：**瓶颈是"路径断言 × 次数"，不是哈希算法，也不是磁盘本身**。

> 反证：1.27 GB 的哈希在本机只需 **0.45 s**。任何"换更快哈希算法"的建议都是错药。

### 2.3 当前 vs 目标（量化）

| 指标 | 当前 | 目标 | 倍数 | 改动面 |
|---|---|---|---|---|
| 单次 `publicProof`（热缓存） | 6–8 s | 0.9–1.5 s | **5×** | 引擎（重签） |
| 单次 `publicProof` 读盘 | 1.266 GB | 1.266 GB（哈希必须读满） | 1× | 不可降（红线） |
| install 全程 `publicProof` 次数 | 5 | 1 | **5×** | 引擎（重签） |
| install 全程 `publicProof` 读盘 | 6.33 GB | 1.27 GB | **−80%** | 引擎（重签） |
| install 全程整树 `exactTree` 次数（1079 文件/次） | ~70–92 | ~6 | **12×** | 引擎（重签） |
| 每文件 `assertPath` 实际系统调用 | 4 次真实遍历 | 首次 1 次 + 命中 ~2 µs | **~330×** | `delivery-tools`（重签） |
| `assertPath` 累计耗时 | ~260 s | ~3 s | **~85×** | 同上 |
| install 墙钟（SSD + 无 Defender） | 300–500 s | **40–70 s** | 4–8× | 引擎 + 运维 |
| install 墙钟（SSD + Defender 开） | 300–500 s | **120–180 s** | 2–3× | 运维（零改码） |

---

## 3. 热点逐一拆解

### 3.1 `publicProof()` — 单次 1.27 GB、8 个调用点（安装事务必经 5 次）

**位置**：`D:\Codex\xjy-1.7.0\c28-repair-source\retry-integrated-a16\engine-tree-runtime170.cjs:1477-1525`

```js
// :1484
const artifact = await core.inspectArtifactTree({ artifactDir: p.artifactDir });   // 1007 文件
// :1485
const archive  = await core.fileHash(fs, p.archiveFile, ...);                     // 164 MB
// :1500
const worker   = await ...exactTree(p.workerRoot ...);                            // 101 文件
// :1503  4 个审定器逐个哈希
for (const name of reviewers) ... core.fileHash(fs, path.join(approvalDir, name), ...)
// :1505
const self = await core.fileHash(fs, process.execPath, p.workerRoot);              // 247 MB EXE
// :1506
const engine = await ...inspectArtifactTree(p.engineArtifactDir ...);
```

**问题**：

1. **重复证明同一棵树**：全文件 8 个调用点（`:1557,1665,1679,1688,1709,1743,1796,1797`），其中 `:1665`（initial 授权）、`:1679`（slot 校验）、`:1688`、`:1709`（`currentPair(await publicProof())` 再校验）、`:1743`（bridge 交接）**在一个安装事务里必然各触发一次** → 同一棵树被证明 5 次，每次重读 1.27 GB。
2. **哈希本身不慢**，慢在 `inspectArtifactTree`（`initial-patch-core.cjs:21`）对每个文件走 `u.assertPath` + `fileHash`，而 `fileHash` 内部又 4 次 `assertPath`。
3. **`process.execPath`（247 MB）在 :1505 被再哈希**，而它是**当前正在运行的 EXE**——运行中的文件内容不可能被替换（Windows 文件锁），这一步的安全收益接近零，成本却是 247 MB 读 + 101 文件路径断言。

**目标**：安装全程 1 次全量证明 + 4 次"仅身份复核"。

**最小改法**（按收益排序，全部可合并成一次重签）：

```js
// A. 单次化：在 install 主路径开头取一次，之后全部下传
const proof = await publicProof();                 // 1 次
// :1557/:1665/:1679/:1688/:1709/:1743/:1796/:1797 改为引用 proof（:1795 只是 publication 字段校验，非调用）
```
```js
// B. 摘要下传：inspectArtifactTree 已返回 files[{path,size,sha256}]，
//    后面所有 exactTree 只需比对 rows，不必重算摘要（把 files 当 expected 传下去）
```
```js
// C. 自我 EXE 免哈希：用 openChecked + 文件锁 + 本进程 execPath 即可
//    （:1505 改 statIdentity 比对，247 MB 读 → 0）
```

**语义等价性**：A 等价（同一事务内同一 root 的证明结果，结尾 `directory(dir, identity)` 仍复检根身份）；C 等价（运行中的 EXE 被独占锁定，且 `openChecked` 已断言路径与句柄身份）。
**风险**：B 若被误用到 `runtimeWrites` 树，会漏检业务写入——必须只在 `contents === false` 时下传（`layout(record, recovery, contents)` 第三参已有此开关，:615）。

---

### 3.2 `layout()` — 23 次调用，每次 3–4 棵全树

**位置**：`engine-tree-runtime170.cjs:615-632`

```js
async function layout(record, recovery = true, contents = record.runtimeWrites !== true) {
  // :616  catalogs(recovery)  → 2 次 Ed25519 验签（ms 级，非热点）
  // :617  protectedTrees(record, contents) → dataDir + profileDir 两棵 exactTree
  // :617  artifactTree(catalog.target, record.identities.artifact) → 1 棵 1079 文件 exactTree
  // :619-631  遍历 {live, stage, backup, failed, retired}
  //          命中 → program(file, 'target'|'source', ...) → 每个命中位置再 1 棵 1079 文件 exactTree
}
```

**每次 `layout()` 的扫描账**：

| 步骤 | 代码 | 树规模 |
|---|---|---|
| `protectedTrees` → `exactTree(dataDir)` | `:611` | 用户数据树 |
| `protectedTrees` → `exactTree(profileDir)` | `:612` | 配置树 |
| `artifactTree` → `program()` → `exactTree` | `:256` → `:237` | **1079** |
| `live` 命中 → `program()`（含 :239 `allowMutable` 时**再跑一次 `inspectArtifactTree`**） | `:625-627` | **1079 + 1079** |
| `stage`/`backup`/`failed`/`retired` 命中 → 各 1 次 `program()` | `:623-631` | 1079 × 命中数 |

安装事务典型命中 `live` + `stage`（2 个）→ **每次 layout ≈ 3 棵 1079 文件树**；`committed` 阶段 `runtimeWrites===true` 且 `released` 时 `allowMutable` 为真 → **4 棵**。

**23 个调用点**（全部行号）：

```
307, 312, 959, 972, 1048, 1053, 1056, 1068, 1073, 1080, 1082, 1086,
1089, 1157, 1176, 1229, 1235, 1284, 1299   （19 处直接调用，其中 4 处一行内两次 → 计 23 次）
```
典型重复：`:307` 与 `:312` 各两次（`await layout(...); await closed(); await layout(...)`）、`:1048`、`:1089`。

**目标**：同一 `(root 目录身份, 签名目录摘要)` 只能被完整证明一次，后续只比根身份。

**最小改法**：

```js
// 1) 进程内树证明缓存：键 = statIdentity(root) + catalogSha256 + (contents?'c':'m')
//    rename 不改变目录 fileId → 搬动后的同一棵树仍命中缓存（这正是本项目身份设计的初衷）
const treeProof = new Map();          // key -> { files, digest, dirIdentity }
// 2) 失效：命中前先 directory(dir) 比对身份；不同则丢弃并重证明
// 3) runtimeWrites 树：只重算 targetMutableFiles + marker（:239 已经有这套逻辑）
```

**语义等价性**：目录 fileId 不变 = 同一物理目录对象；`runtimeWrites` 树仍走可变子集重算；**结尾 `layout` 仍做全量证明**（建议只对最终 `committed` 状态强制全量）。中间态跳过全量哈希，等于把"防止事务中途被第三方篡改"的保证，换成"状态机每步根身份 + 终态全量"——在独占锁 + 程序已关闭 + 同卷 rename 的前提下是可接受的取舍，但**必须由签名链的审核人显式接受**（建议写进 REVIEW 记录）。

**预期**：23 × 3.5 ≈ 80 次整树扫描 → **6 次**（3 个不同身份 × 首末两次），`assertPath` 从 ~229 s → ~3 s。

---

### 3.3 `exactTree()` — 每棵树被扫两遍

**位置**：`engine-tree-runtime170.cjs:192-209`

```js
async function exactTree(dir, expected, expectedIdentity, extraDirectories = [], pathPolicy = 'program') {
  const before = await directory(dir);                       // 第 1 次根断言
  const tree   = await core.inspectArtifactTree({ artifactDir: dir, pathPolicy });  // 第 1 遍：逐文件 断言+哈希
  ... 
  // :203  第 2 遍 walk：逐目录 io.lstat + u.assertPath（只为收集目录身份）
  // :20x  await directory(dir, before.identity);             // 第 3 次根断言
}
```

**问题**：`inspectArtifactTree`（`initial-patch-core.cjs:21`）在 walk 过程中**已经 lstat 过每个目录**，但返回值只有 `files`，没有 `directories` → `exactTree` 为了拿目录身份只能再走一遍。

**成本**：树内目录数约 100–200（`delivery-tools` 19 文件 + 55 locales + project/desktop 等），第二遍 ≈ 150 × 661 µs ≈ **0.1 s/棵**，×80 棵 ≈ **8 s**。不是最大头，但**是白捡的**。

**最小改法**：让 `inspectArtifactTree` 多返回 `directories[{path, identity}]`（它在 walk 里已经 `lstat` 过），`exactTree` 直接消费，删掉 `:203` 的第二遍。

**注意**：这会改变 `inspectArtifactTree` 的返回形状 → 所有调用方（`:1484`、`:1500`、`:1506`、`program():239`）需同步；建议加字段而非改字段，保持 `sha256` 计算逻辑**逐字节不变**（红线：不改数据格式）。

---

### 3.4 `assertPath()` — 每文件 4 次祖先链遍历（**最大单点**）

**位置**：`delivery-tools\employee-update-cache.cjs:19-40`

```js
async function assertPath(io, file, { directory, missing, root } = {}) {
  // :22  从 file 一路向上到盘根（或 root）
  //      每层 io.lstat(...)  → 2.9 µs
  //      每层 io.realpath(...) → 69 µs   ← 成本主体
  // :23  发现符号链接/重解析点即拒绝
}
```

**调用放大**（`initial-patch-core.cjs` 的 `fileHash`）：

```
fileHash(file)
├── openChecked(file)            → assertPath ×1（打开前）
│                                → assertPath ×1（打开后复检）
├── assertHandle(handle, before) → assertPath ×1
└── assertHandle(handle, after)  → assertPath ×1
                                  = 4 次 × 661 µs = 2.64 ms/文件
```

**实测账单**：

| 场景 | 文件数 | 断言次数 | 耗时 |
|---|---|---|---|
| 单次 `publicProof` | 2188 | 8752 | **5.79 s** |
| 单棵 1079 文件树 | 1079 | 4316 | **2.85 s** |
| install 全程（5×proof + ~80 棵树） | — | ~395k | **~260 s** |

**最小改法：作用域记忆化**

```js
// employee-update-cache.cjs 增加
let pathCache = null;                                   // Map<normPath, {stat, realpath, identity}>
function beginPathScope() { pathCache = new Map(); }
function endPathScope()   { pathCache = null; }

// assertPath 内：
const key = norm(file);
if (pathCache?.has(key)) return pathCache.get(key).stat;  // 命中 ~2 µs
// 未命中：逐层向上，**每层都写缓存**（祖先链一次走完，兄弟文件全命中）
```

**为什么这是 330×**：一棵 1079 文件树只有 ~150 个目录、~9 层深，所以完整遍历只需 **~1350 次 lstat/realpath**，而不是 4316 × 9 = **38,844 次**。命中后单次断言从 661 µs 降到 **~2 µs**（一次 Map 查找）。

**语义等价性论证**（审核人需要看的核心）：

1. `assertPath` 是**只读校验**：确认祖先链无重解析点 + 目标 stat 身份。缓存命中的前提是"同一作用域内同一路径"。
2. 作用域边界处已有复检：`exactTree` 结尾 `directory(dir, before.identity)`（`:20x`）、`program` 结尾 `directory(dir, identity)`（`:255`）、`layout` 开头 `fixedDirectories()`（`:608`）都会重新 lstat 根并比对 —— **任何根级替换都会被捕获**。
3. 残留 TOCTOU 窗口：作用域时长内（毫秒~秒级）祖先目录被第三方 rename 换掉。**原实现同样挡不住**（检查与使用之间恒有窗口），缓存只是把窗口从 µs 放大到作用域长度；而在本场景（独占锁 + 程序已关闭 + 同卷 rename + 事务 journal）该窗口不具备可利用性。
4. 建议保留一个"**每棵树首次进入时清空缓存**"的保守变体，把窗口压到单棵树扫描期（~0.3 s），收益仍在 100× 以上。

**风险标注**：这是**语义上有取舍**的改动，不能写成"纯等价优化"。建议在重签审核记录里明确写"assertPath 作用域缓存，边界复检保留，窗口 ≤ 单棵树扫描期"。

---

### 3.5 其他可量化的小热点

| 热点 | 位置 | 现状 | 建议 |
|---|---|---|---|
| `program()` 可变预扫描与主扫描重复 | `:239` → `:240-255` | `allowMutable` 时先 `inspectArtifactTree` 一次，再 `exactTree` 又一次 | 把预扫描结果直接传给 `exactTree` 当 `expected`，省 1 遍 1079 文件 |
| `packageIdentity(asar)` 每棵 target 树都解析 | `:244` | 12.9 MB asar 头解析 × ~80 次 | 与树证明缓存同键缓存 |
| `readKey()` 每操作重读 | `:257`+ | 小文件，但调用密集 | 进程内缓存 + 文件身份失效（同 3.4 思路） |
| 硬编码策略摘要 | `:1443` `digest(policy)==='9e4c6488…'` | 改策略常量即破签名 | 迁移到 binding.json 字段（P2，需重签） |
| `print-worker-templates.cjs` 1.97 MB | `desktop\generated\` | esbuild 未 minify | `--minify` 后约 −55%，asar 12.9 MB → ~11.9 MB，冷启动 −30~60 ms（P2，需重签） |

---

## 4. 开源参考（按问题分类）

> 每类给"**本项目结论**"：采纳 / 借思路 / 排除。完整表格见 `oss-candidates.md`。
> ⚠ stars 因出口限制**未核实**，仅给量级；license 需上线前复核 LICENSE 文件。

### 4.1 大目录树哈希 / 合并摘要

| 仓库 | 解决什么 | 怎么嵌到本项目 | license | 成本 |
|---|---|---|---|---|
| [BLAKE3-team/BLAKE3](https://github.com/BLAKE3-team/BLAKE3) | 多线程并行哈希，单核 1–3 GB/s、多核 10 GB/s+；支持 `update_mmap` 与树式增量 | **不替换 sha256**（会破签名与数据格式）。用其**并行扇出模型**：`worker_threads` 池 4–8 线程，每线程 `crypto.createHash('sha256')` 处理一批文件 | CC0/Apache-2.0 双许可（未核实） | 低（~150 行，可无依赖手写） |
| [BurntSushi/walkdir](https://github.com/BurntSushi/walkdir) | Rust 目录遍历：单遍产出文件+目录、迭代器式、无重复 stat | 移植其"**单遍遍历同时产出 files 与 directories**"到 `initial-patch-core.cjs:21`，正好解 3.3 的双遍扫描 | MIT/Unlicense（未核实） | 极低（改返回值） |
| [merkletreejs/merkletreejs](https://github.com/merkletreejs/merkletreejs) | 内存 Merkle 树、增量证明、O(log n) 校验 | 仅作**旁路变更检测索引**（本地缓存，不进签名、不进 journal），用于"哪些文件变了"的快速定位 | MIT（未核实） | 中（需自建持久化） |
| [dirsum](https://www.npmjs.com/package/dirsum) / [hashdir 类工具](https://socket.dev/npm/package/dirsum) | 目录校验和 CLI，语义与 `inspectArtifactTree` 的 `path\0size\0sha256` 拼接几乎一致 | **只用来做交叉验证**：离线复算一遍树摘要，与 `treeSha256` 对照，作为审计工具而非运行时依赖 | 未核实 | 极低（外部脚本） |

**本项目结论**：**借思路不引依赖**。真正的 8× 来自 assertPath 缓存，不来自哈希库；引入 BLAKE3 反而会改变摘要格式（违反红线）。

### 4.2 原子目录替换 / 事务式更新

| 仓库 | 解决什么 | 怎么嵌到本项目 | license | 成本 |
|---|---|---|---|---|
| [inconshreveable/go-update](https://github.com/inconshreveable/go-update) | 单文件原子替换：临时文件 → rename → 失败回滚（保留旧句柄） | 本项目的 journal + 整树 rename 已是它的超集；可借其"**rollback 句柄保留**"细节加固 `:1089` 回退路径 | Apache-2.0（未核实） | 低（只读参考） |
| [velopack/velopack](https://github.com/velopack/velopack) | 现代 Squirrel 替代：版本目录 + 指针切换 + delta 包 | 借"**版本目录 + 单一指针**"布局：比"整树 rename"少一次 1079 文件元数据搬运 | MIT（未核实） | 高（改目录布局 = 破数据格式，**红线内不可做**，仅列为 2.0 方向） |
| [Squirrel/Squirrel.Windows](https://github.com/Squirrel/Squirrel.Windows) | `app-<version>` + 桩 exe，Update.exe 原子切换 | 仅作对照：本项目已用等价思路（live/stage/backup/failed/retired 五位置 + 身份比对） | MIT（未核实） | — |
| [electron-userland/electron-updater](https://github.com/electron-userland/electron-builder/tree/master/packages/electron-updater) | 差分（blockmap）下载 + 校验 + 重启 | **运行时依赖联网 → 排除**。仅借 `blockmap` 格式做**离线 delta 补丁**（补丁包内自带 delta，不联网） | MIT（未核实） | 中高（新格式，P2） |

**本项目结论**：架构上已经领先于 go-update / Squirrel；唯一值得吸收的是 **delta 补丁**（把 165 MB 补丁降到 ~10 MB），但属于新数据格式，**只能随大版本走**。

### 4.3 签名与验签

| 仓库 | 解决什么 | 怎么嵌到本项目 | license | 成本 |
|---|---|---|---|---|
| [jedisct1/minisign](https://github.com/jedisct1/minisign) | Ed25519 单文件签名，四行文本格式，无依赖 CLI，完全离线 | 本项目的 publisher 已是 Ed25519。用 minisign 的**签名文件格式**承载"发布记录/审计回执"，与现有 catalog 并存，不动运行时 | ISC（未核实） | 极低（外部工具） |
| [theupdateframework/specification](https://github.com/theupdateframework/specification) / [python-tuf](https://github.com/theupdateframework/python-tuf) | 角色分离（root/targets/snapshot/timestamp）+ 版本防回滚 + 过期时间 | **借规范不引库**：本项目已有 `sequence` 与 `STALE_CATALOG`；缺"**过期时间**"与"**独立时间戳角色**"。建议在 binding 增加 `expires` 字段并在引擎校验（P2，需重签） | MIT / Apache-2.0（未核实） | 中（引擎改动） |
| [sigstore/cosign](https://github.com/sigstore/cosign) | 无密钥签名 + 透明日志 | **排除**：依赖 Fulcio/Rekor 在线服务，直接违反"离线部署"红线 | Apache-2.0（未核实） | — |
| [libsodium](https://github.com/jedisct1/libsodium) / node-sodium | 高层签名 API | **排除**：Node 内置 `crypto` 已支持 Ed25519，引入只为"库的便利"，徒增体积与重签面 | ISC（未核实） | — |

**本项目结论**：签名栈本身**不是瓶颈也不是短板**，不要换实现；只补 TUF 的"过期 + 时间戳"两个元数据字段。

### 4.4 Electron 打包 / 体积 / 启动

| 仓库 | 解决什么 | 怎么嵌到本项目 | license | 成本 |
|---|---|---|---|---|
| [electron-userland/electron-builder](https://github.com/electron-userland/electron-builder) | `asar`、[`compression: store\|normal\|maximum`](https://www.electron.build/docs/api/app-builder-lib.typealias.compressionlevel/)、`files` 白名单、`asarUnpack` | 本项目已用。检查点：①`compression` 是否 `maximum`（代价是安装时解压慢，与"安装快"目标冲突 → 建议 `normal`）；②`files` 是否漏配导致把 `renderer` 源文件也打进 asar | MIT（未核实） | 极低 |
| [electron/asar](https://github.com/electron/asar)（`@electron/asar`） | 读写 asar、列出清单 | **只读体积审计**：`asar list --is-pack` 列出最大文件，定位 `generated\print-worker-templates.cjs`(1.97 MB) 这类生成物 | MIT（未核实） | 极低（devDependency） |
| [zertosh/v8-compile-cache](https://github.com/zertosh/v8-compile-cache) | 把 V8 编译缓存落到磁盘，二次启动省去解析 | 本项目 `profileDir` 可写 → 可行；预计 main 进程冷启动 **−5~15%**（绝对 ~50–120 ms） | MIT（未核实） | 低（需重签：进 asar） |
| [bytenode/bytenode](https://github.com/bytenode/bytenode) | 把 JS 编译成 V8 bytecode（`.jsc`），防源码 + 提速 | **不建议**：①bytecode 绑定 Electron/V8 精确版本（44.x 升级即全废）；②`.jsc` 在 asar 内需 `asarUnpack`，反而增加安装期文件数；③破坏"代码可审计"这一安全属性。收益（30–50% 冷启动）在 3 s 级启动上只值 ~0.5 s，不值这个风险 | MIT（未核实） | 高 |
| [puppeteer/puppeteer](https://github.com/puppeteer/puppeteer) | 无头 Chromium | **排除**：自带 Chromium +150 MB，且本项目已有 Electron 44 的 `printToPDF`（`desktop\main.cjs:196/213`） | Apache-2.0（未核实） | — |

**本项目结论**：打包侧唯一确定收益是 **esbuild `--minify` + asar 清单审计**；启动优化优先级最低（当前启动痛点不是 JS 解析）。

### 4.5 SQLite 本地库与备份 / 迁移

**现状关键事实**：`desktop\package.json` 的 `dependencies` 为 **`[]`** —— 全项目**零运行时依赖**，业务数据是 JSON 文件（`business-*.cjs` 一整套备份/校验模块）。这是极强的资产：任何 native 模块都会打破"免安装、免 rebuild、可审计"。

| 仓库 | 解决什么 | 怎么嵌到本项目 | license | 成本 |
|---|---|---|---|---|
| [WiseLibs/better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | 同步 API、最快的 Node SQLite 绑定 | **仅允许新增旁路库**（如打印任务历史、检索索引），**不得迁移既有 JSON 数据**（红线）。需 `electron-rebuild` + ABI 绑定 Electron 44 + `asarUnpack` 原生 .node | MIT（未核实） | 高（首个 native 依赖，破零依赖） |
| [node:sqlite](https://nodejs.org/api/sqlite.html)（Node 22 内置） | 零依赖 SQLite | Electron 44 内置 Node 版本若 ≥22 则可用；但 API 仍标注 experimental，跨 Electron 升级有断裂风险 | Node 许可（MIT） | 低—中 |
| [benbjohnson/litestream](https://github.com/benbjohnson/litestream) | 持续把 WAL 复制到对象存储，秒级 RPO | **排除**（需 S3/联网）。**借思路**：`VACUUM INTO` / `.backup` 做本地快照 + 定期 checkpoint，再把快照摘要并入现有 data proof | Apache-2.0（未核实） | 低（纯思路） |
| [photostructure/node-sqlite 对比](https://photostructure.github.io/node-sqlite/documents/library-comparison.html) | 各 SQLite 绑定横评 | 选型依据：性能/维护活跃度/ABI 风险三维对照 | — | — |

**本项目结论**：**当前不建议引入任何 SQLite**。理由：零依赖 + JSON 文件 + 自带完整性校验，正好匹配"离线、可审计、易备份"三条硬需求；SQLite 的收益（查询性能）在珠宝零售的数据量级（万级单据）上几乎不可感知。若将来要做全文检索，用 `node:sqlite` 新建**旁路索引库**，原 JSON 保持唯一事实源。

### 4.6 打印模板（HTML → PDF）

**现状**：`desktop\main.cjs:196` 与 `:213` 已用 Electron `webContents.printToPDF`，且 `:213` 带 `preferCSSPageSize: true` —— **打印管线本身已是正确选择**。

| 仓库 | 解决什么 | 怎么嵌到本项目 | license | 成本 |
|---|---|---|---|---|
| [pagedjs/pagedjs](https://github.com/pagedjs/pagedjs) | 浏览器内实现 CSS Paged Media：`@page` 边距框、页眉页脚、页码、`break-inside` | 纯前端 JS，可打包进 renderer，**离线可用**；解决"手写分页 + 页码"的重复逻辑（现在散在 `renderer/print-worker-templates.tsx` 与 `warranty-quotation.tsx`） | MIT（未核实） | 中（~1 周改造 + 重签） |
| [electron/electron `printToPDF` 文档](https://www.electronjs.org/docs/latest/api/structures/print-to-pdf-options) | `pageSize`/`margins`/`printBackground`/`preferCSSPageSize` | **已在用**；建议补 `scale`、`generateTaggedPDF`（无障碍）与 `pagesPerSheet` 的显式配置 | MIT | 极低 |
| [wkhtmltopdf/wkhtmltopdf](https://github.com/wkhtmltopdf/wkhtmltopdf) | 老 Qt WebKit 转 PDF | **排除**：已停更、CJK 字体与分页坑多、LGPLv3 传染性、额外 60 MB 二进制 | LGPLv3（未核实） | — |
| [puppeteer/puppeteer](https://github.com/puppeteer/puppeteer) | `page.pdf()` | **排除**：与 Electron 内置 Chromium 重复，+150 MB | Apache-2.0 | — |

**本项目结论**：**保留 Electron `printToPDF`**；仅在"需要复杂页眉页脚/跨页表格"时引入 paged.js（P2，需重签）。

### 4.7 结构 / 架构（版本号集中化、单一来源配置、错误码表）

| 方案 / 仓库 | 解决什么 | 怎么嵌到本项目 | license | 成本 |
|---|---|---|---|---|
| 单一版本源（构建期注入） | 版本号散落：`desktop\package.json:3`、`desktop\cashier-adapter.cjs:39`、`desktop\engine-startup-gate.cjs:52`（硬编码 `'1.7.0'`）、`engine-native170-binding.json` | 用 esbuild `define` 在构建期注入 `__APP_VERSION__`，运行时只读一处；`engine-startup-gate.cjs:52` 改为与 catalog 的 `programVersion` 比对（本就已经有 meta） | — | 低（需重签） |
| 错误码表（`errno` 风格） | 引擎里 `u.fail('CODE')` / `requireValue(cond,'CODE')` 的码值**散落各处**（`engine-tree-runtime170.cjs` 内 `u.fail` 24 处、10 个直接码值，其余经 `requireValue` 传入） | 抽 `errors.cjs`：`CODE → {含义, 严重度, 用户提示, 处置建议}`；构建期用脚本扫出未登记码值并 fail CI | — | 中 |
| [sindresorhus/errno](https://github.com/sindresorhus/errno) | 错误码可读化 | 只借"码表 + 消息分离"的形态，不需引入（零依赖原则） | MIT（未核实） | 极低 |
| [convict](https://github.com/mozilla/node-convict) / [zod](https://github.com/colinhacks/zod) | 配置 schema 校验 | **暂不引入**：配置项少，手写校验已足够；引入会破零依赖 | MIT | — |

---

## 5. 落地排序（P0 / P1 / P2）

排序依据：**收益 ÷ (风险 × 改动面)**，并以"是否破坏签名链"作为硬分界。

### P0 — 零重签、今天可做（全部在签名 zip 之外）

| # | 动作 | 文件:行号 | 改法 | 预期收益 | 重签 |
|---|---|---|---|---|---|
| P0-1 | Defender 排除安装目录 + 引擎 EXE + stage 临时目录 | 无（运维） | 部署手册 + `部署前检查.cmd`（新增，zip 外） | install **−50~65%**（300–500 s → 120–200 s） | **否** |
| P0-2 | 安装前外部只读预检 | 新增 `预检.cmd`（zip 外，调用现有 `delivery-tools` 的 CLI 只读模式） | 先算 archive/树摘要，不匹配立即退出 | 避免"卡 400 s 后才报错"，现场体感大幅改善；不减少总 I/O | **否** |
| P0-3 | 磁盘/索引体检 | 新增 `体检.cmd`（zip 外） | `winsat disk`、`fsutil fsinfo`、检查 Windows Search 是否索引安装盘 | 判定"是 I/O 慢还是代码慢"，避免把机械盘问题当软件 bug | **否** |
| P0-4 | 构建期树摘要缓存 | 新增 `tools\tree-digest-cache.ps1`（签名工具侧，不进受信 payload） | 以 `(path,size,mtime)` 为键缓存 sha256 | 重签流程 **8 min → 1–2 min**（约 5×），直接降低后续 P1 重签的迭代成本 | **否** |
| P0-5 | 升级说明补"预期耗时" | 文档 | 写明"完整校验会读 ~6.3 GB，SSD 2–4 min / 机械盘 8–15 min 属正常" | 消除"以为卡死"的误报工单 | **否** |

### P1 — 需**一次**重签（建议合并为 1.7.1 的单一 reseal）

> 全部四项一起改、一次重签，把重签成本摊到一次。改后 worker catalog seq 28 → 29，需走完整 `Sign170.cmd` → `record-signed.cjs` 流程。

| # | 动作 | 文件:行号 | 改法 | 预期收益 | 重签 |
|---|---|---|---|---|---|
| P1-1 | `assertPath` 作用域记忆化 | `delivery-tools\employee-update-cache.cjs:19-40`（+ `initial-patch-core.cjs` 内的 `fileHash` 进入作用域） | 见 §3.4 代码骨架；保留"每棵树进入时清缓存"的保守变体 | `assertPath` **260 s → 3 s（~85×）**；整体 install 最大单点 | **是（全链）** |
| P1-2 | 树证明缓存（按根身份 + catalogSha） | `engine-tree-runtime170.cjs:615-632`、`:607-614`、`:256` | 见 §3.2；rename 不改 fileId → 缓存天然跨位置有效 | 整树扫描 **~80 次 → 6 次（12×）** | **是（全链）** |
| P1-3 | `publicProof` 单次化 + 摘要下传 | `:1477-1525` + 调用点 `:1557,1665,1679,1688,1709,1743,1796,1797` | 见 §3.1；另含 `:1505` 自我 EXE 免哈希 | 读盘 **6.33 GB → 1.27 GB（−80%）**，耗时 **5×** | **是（全链）** |
| P1-4 | `exactTree` 单遍 + `program` 复用预扫描 | `:192-209`（删 `:203` 第二遍）、`initial-patch-core.cjs:21`（返回 `directories`）、`:239` | 见 §3.3/§3.5 | 省 ~8 s（白捡，随 P1-1 一起落地成本近零） | **是（全链）** |

**重签成本模型**（严格按现有链路，来自 `engine-native170-binding.json` 与 `Sign170.cmd`）：

```
改 engine/delivery-tools 任一 .cjs
  → workerEnvelope.catalog[101 文件] 中该文件 sha256 变
  → workerCatalogSha256 变 → 重签 worker envelope（seq 28 → 29）
  → engine-native170-binding.json 变
  → artifact zip 逐字节变 → artifactSha256 变（b1a7b120…）
  → publicationId 变（f2a76c73…）
  → approvals 全部失效（resource seq 17 / target seq 21 / worker seq 28 / source ×3）
  → proposal + outer 骨架（sign-native170-ROOT-...-outer-a1.cjs）需重出
```

**结论：任何 P1 项都等于"一次完整发布会"。** 因此建议：**P0 先做（当天见效），P1 打包成 1.7.1 一次性重签**，并在重签前用 P0-4 的摘要缓存把迭代周期压到 1–2 min。

### P2 — 结构改善 / 长期（需重签，收益中低）

| # | 动作 | 文件:行号 | 收益 | 重签 |
|---|---|---|---|---|
| P2-1 | 版本号单一来源 | `desktop\package.json:3`、`cashier-adapter.cjs:39`、`engine-startup-gate.cjs:52` | 消除"改版本漏改一处"的发布事故 | 是 |
| P2-2 | 错误码表 `errors.cjs` | `engine-tree-runtime170.cjs` 全文件（10 个直接码值 + `requireValue` 调用） | 现场排障从"猜码"变"查表"；CI 拦截未登记码 | 是 |
| P2-3 | `print-worker-templates.cjs` minify | `desktop\print-worker-build.cjs`（esbuild 参数） | asar −1 MB，冷启动 −30~60 ms | 是 |
| P2-4 | 策略摘要常量外置 | `engine-tree-runtime170.cjs:1443` | 换策略不必改代码 | 是 |
| P2-5 | 打印模板迁移 paged.js | `desktop\renderer\print-worker-templates.tsx`、`warranty-quotation.tsx` | 页眉页脚/跨页表格可维护性 | 是 |
| P2-6 | 离线 delta 补丁 | 新增（blockmap 思路） | 165 MB → ~10 MB 补丁 | 是（新格式） |
| P2-7 | SQLite 旁路索引 | 新增 | 仅当数据量增长到 10 万级再考虑 | 是 |

---

## 6. 验证方案（改前 / 改后怎么量）

1. **同机对照**：记录 `Measure-Command { .\一键升级.cmd }` 三次取中位数；固定同一补丁包、同一磁盘、Defender 状态一致。
2. **分项计时**：临时用 `XJY_PROFILE=1` 环境变量在 `publicProof`/`layout` 首尾打点（仅测量构建，不进发布包）。
3. **系统调用计数**：Process Monitor 过滤 `Path` 含安装目录、`Operation` 为 `CreateFile`/`QueryOpen`，对比 P1-1 前后的调用数（预期 38,844 → ~1,350 每棵树）。
4. **正确性**：改后必须重跑既有审计里的"篡改注入"用例（改一个文件字节 / 换一个目录 / 改名一个文件），确认仍全部拒绝——这是"不得绕过签名验证"的实测证据。
5. **回归基线**：`treeSha256`、`engineTreeSha256`、`workerCatalogSha256` 在"仅优化不换版本"的重签里**必须逐字节一致**（除被改文件的 sha256 外），否则说明改坏了解析逻辑。

---

## 7. 红线复核

| 红线 | 本报告的所有建议如何满足 |
|---|---|
| **不得绕过签名验证** | P1-1/P1-2 是**缓存**而非**跳过**：边界处仍有 `directory(dir, identity)` 复检，终态 `committed` 仍做全量证明；P1-3 把 5 次证明变 1 次，**证明强度不变**；P1-4 只删"重复收集目录身份"，不动摘要计算。§6-4 要求提供篡改注入实测证据 |
| **不得引入联网运行时依赖** | P0 全部是本地脚本/配置；§4 中 cosign（Fulcio/Rekor）、electron-updater 运行时、litestream（S3）**明确排除**；paged.js/v8-compile-cache 均为本地文件 |
| **不得改变现有数据格式** | 树摘要算法（`path\0size\0sha256`）、catalog 字段、journal 字段、`sequence` 语义**一律不变**；§4 SQLite 仅允许"新增旁路库"，原 JSON 仍是唯一事实源；delta 补丁（P2-6）标注为新格式且只在大版本引入 |

---

## 附录 A：行号索引（便于 review 时逐条跳转）

| 符号 | 位置 |
|---|---|
| `publicProof` | `engine-tree-runtime170.cjs:1477-1525`（:1484 artifact / :1485 archive / :1500 worker / :1503 审定器 / :1505 自我 EXE / :1506 engine） |
| `publicProof` 调用点（8 个） | `:1557, :1665, :1679, :1688, :1709, :1743, :1796, :1797`（安装事务必经：`:1665/:1679/:1688/:1709/:1743`） |
| `layout` | `:615-632`（`:616 catalogs` / `:617 protectedTrees+artifactTree` / `:619-631 locations`） |
| `layout` 调用点 | `:307, :312, :959, :972, :1048, :1053, :1056, :1068, :1073, :1080, :1082, :1086, :1089, :1157, :1176, :1229, :1235, :1284, :1299` |
| `protectedTrees` | `:607-614`（`:611 data` / `:612 profile`） |
| `program` | `:237-255`（`:239 mutable 预扫描` / `:244 packageIdentity` / `:245 version` / `:246-249 EXE 头` / `:255 directory 复检`） |
| `artifactTree` | `:256` |
| `exactTree` | `:192-209`（`:203 第二遍 walk`） |
| `directory` | `:174-179` |
| 策略摘要常量 | `:1443` |
| `inspectArtifactTree` | `delivery-tools\initial-patch-core.cjs:21` |
| `assertPath` | `delivery-tools\employee-update-cache.cjs:19-40`（`:23` 拒符号链接） |
| `CHUNK` | `delivery-tools\employee-update-cache.cjs:4`（4194304） |
| `printToPDF` | `desktop\main.cjs:196`、`:213` |
| 版本硬编码 | `desktop\package.json:3`、`desktop\cashier-adapter.cjs:39`、`desktop\engine-startup-gate.cjs:52` |
