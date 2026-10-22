# 05-cache-selfheal 工程记录

给后来接手的人：这里记的是**为什么这么改**、踩到的坑、以及没做的事。
目录结构与"改了什么"看 `README.md`，这里只记决策和证据。

## 一、现场事实（先钉住，后面所有结论都建立在这上面）

1. 员工机界面上的英文 `Update object is not an ordinary single-link file` 来自
   `employee-update-cache.cjs:27`（before 版）：
   `if(target){if(directory?!target.isDirectory():!target.isFile()||target.nlink!==1n)fail('UNSAFE_PATH','Update object is not an ordinary single-link file');}`
2. **但 1.7.0 员工机并不是直接把这句 message 显示出去的。** 1.7.0 走的是
   `native-employee-update.cjs:18`：
   `if(options.currentVersion==='1.7.0')return require('./native-publication-update.cjs').createNativePublicationUpdate(options);`
   而 `native-publication-update.cjs`（before 版 `:57`）是
   `catch(e){set('error',e.message,{...});return{ok:false,code:e.code||'NATIVE_UPDATE_FAILED',error:e.message,...}}`
   —— 把英文原始 message 原样塞进界面。所以**只修 cache 不改 publication，界面上还是那句英文**。
   这也是为什么本轮的"修 3"必须落两处。
3. 实测报错的路径不是 `archive.zip`，而是 cache root 里的
   `<profile>/employee-update-cache/native-sequence.json`：
   publication 的 `roots()` / `readHigh()` 用 `authenticatedRead → readSmall → openChecked → assertPath`
   校验它，于是同一个 `assertPath` 把它判成了 UNSAFE_PATH。
   这解释了为什么"只是检查更新也报错"——它连下载都还没开始，先读了防回滚高水位记录。
4. `native-publication-update.cjs:41-42` 还在同一个 cache root 里放 `native-sequence.json`，
   由 `.native-integrity-key` 做 HMAC 锚定。**这个 key 是本轮所有自愈设计的硬约束来源。**

## 二、为什么 nlink 可以放宽（安全论证，供评审用）

`nlink===1n` 从来不是安全边界，是个**成本很低的代理指标**：它想回答"这个文件是不是还有第二个名字"。
判断文件真伪的真正依据在别处：

- `seal()` 里 `hashHandle` 算出整包 sha256，和签名 catalog 里的 `archive.sha256` 比；
- `sealed.json` / `accepted-sequence.json` / `native-sequence.json` 都过 HMAC（key 在 `.native-integrity-key`）；
- `readSmall` / `openChecked` / `assertHandle` 在读写前后比对 `statState`（dev:ino:birthtime:size:mtime:ctime:nlink），
  读一半被换掉会报 `FILE_CHANGED`。

一个被硬链接过的文件，只要内容 hash 对、HMAC 对、读的过程中没被换，它就是真货；
反过来，`nlink===1` 也完全不能保证内容没被改过（同一台机器上有写权限的人直接写就行）。
所以放宽的净效果是：**用"能不能独占写开 + 同卷 + 非重解析点 + 开完复核 inode 没换"替换了"链接计数是不是 1"**，
前者比后者更难伪造，判定成本也只在 `nlink>1` 时才付。

实现上的三个细节：

1. `nlink<1n` 单独判（Windows 删除挂起时 nlink 会归零/异常），仍然拒 —— 这是旧代码 `!==1n` 顺手覆盖到的场景，不能丢。
2. 同卷判定 `target.dev!==parent.dev`：单纯放宽 nlink 之后，唯一还残留的"文件被搬到别处"的攻击是
   **目录联接 / 挂载点**把 cache 目录指到另一个卷；`dev` 不同即拒。父目录 stat 在 `assertPath` 的上溯循环里
   顺手抓（`else if(!parent&&p===path.dirname(file))parent=s;`），不多打一次 syscall。
3. `openChecked` 里那个 `opened.nlink!==1n` 必须一起放宽成 `<1n`。**只改 assertPath 是没用的**——
   硬链接文件在 `openChecked` 的第二道检查上还会被同一句话拒掉。这是本轮最容易漏的一处，单测 05.1 专门钉它。

## 三、自愈设计：三个被现成代码逼出来的决定

### 决定 1：隔离对象搬到 root **外面**
理由见 `integrityKey()`（before `:45-49`）：key 缺失时要求 `readdir(root).length === 0` 才能建新 key。
如果把坏 stage 就地改名成 `<uuid>.quarantine-<ts>` 留在 root 里，root 永远非空 → 新 key 永远建不出来 →
"自愈"之后还是 `BAD_METADATA`。所以隔离落到 `<profile>/employee-update-cache.repair-<ts>/`。
root 本身坏了（变成文件/符号链接）时按你的要求改名 `<root>.broken-<ts>`（root 的父目录就是 profile，天然在 root 外面，没问题）。

### 决定 2：`self-heal.log` 延迟写入
同一句 `readdir(root).length` 的约束：日志文件自己也是一条"额外条目"。
所以日志先攒在 `healLines` 里，等 `integrityKey(create:true)` 成功之后才 `append` 到 `<root>/self-heal.log`
（`healSafeLog` 标记 + `init()` 里 key 建完后的 flush）。代价：如果 init 最终失败且当时没有 key，
这几行日志会丢——但此时隔离目录名 `<…>.repair-<ts>` / `<root>.broken-<ts>` 本身就带了时间戳，取证信息没全丢。

### 决定 3：key 丢失就**不**自愈（保守分支）
如果 `.native-integrity-key` 不在，而 root 里还有 `native-sequence.json` 或 `accepted-sequence.json`，
自愈会把这些也搬走 → root 变空 → 建新 key → **防回滚高水位被静默重置**。
这等于送一个"删 key 就回滚"的口子，不能做。所以 `KEEP_ENTRY` 里的东西一律不动，
这种机器继续报 `BAD_METADATA`，交人工。已在 README §五 明确写成"唯一例外"。

### stage 的合法性判定
一个 `<uuid>` 目录算干净，必须满足：目录名匹配 `UUID` 正则、`lstat` 是目录且**不是**符号链接、
里面只有 `archive.zip` / `sealed.json`、且这两个都是**非符号链接的普通文件**。
任何一条不满足 → 整个 stage 搬到 repair 目录（不删）。注意这里是"整目录搬走"而不是"删掉坏文件"：
`remove()` 里已有 `BAD_STAGE` 的严格检查，我们不改它，只在 `init/begin` 之前把脏东西挪走。

## 四、没做的事（明确记账，别以为漏了）

1. **`native-publication-update.cjs` 只做了错误码人话，没做结构自愈。**
   它自己也在同一个 cache root 写 `native-sequence.json`。在它那里做隔离 + 写日志，
   会同时踩"root 必须为空"和"日志先于 key"两个坑，而且它跑的上下文里
   `integrityKey` 的 create 参数是 false（不会建 key），失败后没有补救路径。
   风险 > 收益 → 记后续项：**等 `native-publication-update.cjs` 也接入 `storage.selfHeal()` 时一起做**。
2. **没有改 `module.exports`。** 04 的 diff 里 `module.exports` 那一行（before `:90`）已经被改过，
   05 再把 `selfHeal` 加进去就必然冲突。所以 `selfHeal` 只挂在 `createEmployeeUpdateCache()` 返回的 api 上
   （`after:...:158`），外部 `require` 拿不到模块级的它——这正好也是我们想要的封装边界。
   如果下一轮合并时想把它提成模块级导出，记得和 04 的 `module.exports` 改动一起改。
3. **没有做"多次重试 / 退避"。** 上层 `run()` 只重试 1 次（`healed` 一次性格挡），避免死循环和无限 IO。
4. **没有验证 `app.asar` 内部**。`native-employee-update.cjs` / `native-publication-update.cjs` 只存在于
   `app.asar`（`受信助手/project/desktop/` 下没有），本机也没有 `@electron/asar`，
   所以只改 app 源码树那份，打包留给发布机。

## 五、落地清单（下一轮重签时照做）

1. `after/employee-update-cache.cjs` → `补丁文件/project/desktop/employee-update-cache.cjs`
   与 `受信助手/project/desktop/employee-update-cache.cjs`（两份同实现）。
2. `after/employee-update-cache.app.cjs` → app 源码树 `app/employee-update-cache.cjs`（asar 变体，只差 `module.exports` 里多 `integrityKey,`）。
3. `after/native-employee-update.cjs` → app 源码树同名文件（进 asar）。
4. `after/native-publication-update.cjs` → app 源码树同名文件（进 asar）。
5. 重打包 `app.asar`；重算 `source-policy.tools[]` 的 sha256 与 `publication.treeSha256`；重签发布清单。
6. 合并 04 时：先 04 后 05（或反之）都能干净 apply；合并完跑
   `tests/04-allowedfiles-selfproof.test.cjs` + `tests/05-cache-selfheal.test.cjs` 两套，再重签。
7. 上线后现场验收：找一台 nlink=2 的机器点"检查更新"，应看到中文提示而不是英文
   `Update object is not an ordinary single-link file`；`<profile>/employee-update-cache/self-heal.log`
   若出现内容，说明自愈真的跑过。

## 六、备份与可复现

- 原始文件：`before/*.cjs`，每个都有 `.orig-seq22` 副本，sha256 记在 `before/SHA256SUMS.txt`：
  - `employee-update-cache.cjs` = `5cb70079bf161a002a2701694e4774c2a11bf8d54efc6674ccb5c7b2c6729815`（17326 B）
  - `employee-update-cache.app.cjs` = `4603e609bddb6e0d32cf0f5f8012abf3ba586f9b9666ce4ae026bdad0b991637`（17339 B）
  - `native-employee-update.cjs` = `57a9b16a77bb27aab950f1ce8d90c0f9a5f00cac0a5626ef1adf1b8c751a660f`（12311 B）
  - `native-publication-update.cjs` = `da751ddac6de7cdc7a8c85b0166f35a7e6aa4fbd1192ff0e50565b5600e93174`（14347 B）
- 派生后：`after/*.cjs`，sha256 记在 `after/SHA256SUMS.txt`：
  - `employee-update-cache.cjs` → `4fd6d7494c13bc6c3437d0803205021b266566db5688572cca88b5915d3f35e6`（24324 B）
  - `employee-update-cache.app.cjs` → `f2949d3990779b4e88c0154e7252100df79d208023152bac74bdc55b1a4cc8d3`（24337 B）
  - `native-employee-update.cjs` → `df63067bad857b696b18e9e4cea14e87e4599843d54b3d303286ffebd2fe4c16`（13436 B）
  - `native-publication-update.cjs` → `2047cc92ec2334b7bb6d5346af78243d4b77f4154ba925153b8a4b3a66fb6d6a`（15057 B）
- 复现：`tools/build.cjs` 会先按 sha256 校验 `before/` 与 `.orig-seq22` 一致，再逐个 patch 点
  校验"锚点恰好出现 1 次"，然后 `node --check` 语法校验、断言两个 cache 变体只差第 90 行、最后出 diff。
  任何一步不匹配就整体失败——不会在源文件已经变了的情况下悄悄产出一份错补丁。

## 七、这一轮改动没有碰到的东西（可复核）

- `F:\自制软件`、`F:\鑫金源珠宝资料`：全程只读之外的**零**访问（本轮根本没打开过）。
- 没有构建、没有签名、没有安装、没有写任何发布树。
- 源文件（`E:/codex/...`、`candidate/build/`）只被**复制**到 `before/`，原件 mtime/sha256 未变。
