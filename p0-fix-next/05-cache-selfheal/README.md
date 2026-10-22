# 05-cache-selfheal 交付说明（P0-5）

给主理人的一页纸：改了什么、为什么安全、签名影响、员工机还要不要人工清缓存。

## 一、改了哪几个文件、哪几行

所有行号都是 **after/** 文件里的行号。

### 1) `employee-update-cache.cjs`（出厂补丁副本，5cb70079 → 4fd6d74）
| 位置 | 改动 |
|---|---|
| `after/employee-update-cache.cjs:5` | `fail(code,message,detail)` 增加第三参数：detail 写进 `error.detail`，只加可观测性，不改任何判定 |
| `:21-37` | `assertPath` 判定重写：`nlink<1n` 仍拒；`nlink===1n` 走原逻辑（一行未变）；`nlink>1n` 改走新函数；新增同卷判定（`target.dev!==parent.dev` → UNSAFE_PATH） |
| `:47-53` | 新函数 `assertExclusiveRegularFile`：普通文件 + 非符号链接 + 同卷 + 以 `r+` 独占打开 + `fsync` 成功 + 开完复核 `statIdentity` 未换文件 |
| `:54-56` | `openChecked` 里 `opened.nlink!==1n` → `opened.nlink<1n`（否则硬链接文件照样进不来） |
| `:97-145` | 新增自愈块：`healStamp/healEvent/healExists/healMove/healFlush/selfHeal/mkdirFresh` |
| `:144` | `init()`：`mkdir(root)` 报 `EEXIST` 时先 `selfHeal()` 再往下走；`integrityKey` 建好 key 之后才 `healFlush()` |
| `:149` | `begin()` 的 `io.mkdir(dir)` 换成 `mkdirFresh(dir,0o700,'duplicate stage')`：EEXIST → 自愈 → 只重试一次 |
| `:158` | `api.selfHeal` 对外暴露（**没有**动 `module.exports` 那一行，见第三节与 04 的冲突分析） |

`employee-update-cache.app.cjs` 是同一份代码的 asar 变体（只差 `module.exports` 里多一个 `integrityKey,`），
改动与上面完全一致（同样的 9 个 patch 点，`node --check` 通过）。

### 2) `native-employee-update.cjs`（asar 内，57a9b16a → df63067）
| 位置 | 改动 |
|---|---|
| `:22` | `messages` 增加 `UNSAFE_PATH` / `BAD_METADATA` / `BAD_STAGE` / `FILE_CHANGED` 四条人话 |
| `:24` | 新增 `RECOVERABLE` 集合（这四个码代表"本机缓存坏了，清一下就好"） |
| `:25-26` | `fault(code,detail)` 与 `unavailable(code,detail)` 透传 detail |
| `:48-49` | `run()`：失败且 `lastFault.code` 属于 RECOVERABLE 时，`cancelOwned()` → `storage.selfHeal()` → 重跑**一次**（`healed` 标记保证最多一次，不会死循环）；`storage.selfHeal` 不存在时自动退化为老行为（补丁分批落地时不会 TypeError）；错误态 `visible.detail` 带上取证信息 |

### 3) `native-publication-update.cjs`（asar 内，da751dd → 2047cc9）
| 位置 | 改动 |
|---|---|
| `:58-59` | 新增 `humanMessages` / `human()`：界面拿人话 + 原 `code`，原始英文 message 进 `detail` |
| `:60` | `getCapability` 的 catch 不再把 `e.message`（英文）直接给界面 |
| `:61` | `run` 的 catch 同上，`{ok:false,code,error,detail}` |

> 这一处是**现网英文文案的真正来源**：1.7.0 机器走 `native-publication-update.cjs`，
> 它把 `e.message` 原样塞进界面。只改 `native-employee-update.cjs` 是修不到现场的。

## 二、为什么安全（没有放宽可信任集合）

1. **旧代码的 `nlink===1n` 本来就是代理指标，不是安全边界。** 缓存文件的真实性由
   `hashHandle`（seal 时的 sha256）、`authenticatedRead` 的 HMAC、以及 `assertHandle` 的
   `statState` 快照共同保证。nlink 只说明"这个 inode 还有没有别的名字"，对内容真实性没有贡献。
   把"硬链接数量"换成"能不能被独占写开 + 同卷 + 非重解析点"，是把代理指标换成了更直接的性质。
2. **放宽是单向收紧，不是放开。** `nlink===1n` 走的是原来那一行（逐字节未变）；
   `nlink<1n`（删除挂起）仍然拒绝；`nlink>1n` 多了一道旧代码没有的检查（独占打开 + fsync +
   dev 同卷 + 开完复核 inode 未换）。旧代码对 nlink=2 只有一个"拒"字，新代码对它是"五项全过才放行"。
3. **没动任何别的断言。** 路径前缀（`within`）、`safeAbsolute`、逐级 `lstat` + `realpath` 比对、
   catalog 签名、`allowedFiles`、序号防回滚、`sealed.json` 的 HMAC 锚——一行没动。
   单测 05.5 用"改前/改后同一份 catalog 跑完整生命周期，proof 逐字节一致 + 路径逃逸仍 UNSAFE_PATH"钉住这一点。
4. **自愈只隔离、不删除。** 坏对象整体搬到 `<profile>/employee-update-cache.repair-<ts>/`
   （root 本身坏了就改名 `<root>.broken-<ts>`），原件都在，可取证、可回滚。
   自愈**完全不碰** `.native-integrity-key`、`accepted-sequence.json`、`native-sequence.json`。

### 一个必须知道的坑（写代码时踩到的）
`integrityKey()`（before 版 `:48`）在 key 缺失时有一句
`if((await io.readdir(root)).length) fail('BAD_METADATA','Native integrity key missing from retained cache')`
——**root 必须为空才能建新 key**。所以：
- 隔离对象不能就地改名留在 root 里（否则 key 永远建不出来，"自愈"等于没做）→ 搬到 root 外面；
- `self-heal.log` 不能在建 key 之前写进 root（否则自己那行日志把"root 必须为空"卡死）→
  日志先缓存在内存，`integrityKey(create:true)` 成功之后才 flush（`after:...:144`）。

### 已知局限（如实记录，别当成没有）
- Windows 上 `fs.open(path,'r+')` 走 CRT `_wopen`，共享模式是 `_SH_DENYNO`，所以它**不能**通用地
  检测"别的进程正开着这个文件"；它真正拦得住的是**只读属性 / 权限不足 / 删除挂起 / 被锁**。
  实测（`E:/node/node.exe` v24.21.0）：`chmod 444` 后 `fsp.open(f,'r+')` 报 `EPERM`（单测 05.3 依赖这个）。
  换句话说：独占打开这一环是"多一道闸"，不是"万能锁"；内容真实性仍然靠 hash + HMAC。
- key 丢失但 `native-sequence.json` / `accepted-sequence.json` 还在时，**故意不自愈**，
  继续报 `BAD_METADATA`。理由：那个 key 同时是原生发布序号记录的 MAC 锚，把它当"可重置"
  等于送一个防回滚的重置口子。这类机器仍需人工处理（预计不会出现在现网这批机器上）。
- `native-publication-update.cjs` **只做了错误码人话，没有做结构自愈**。它自己也往同一个
  cache root 写 `native-sequence.json`，在那里做隔离 + 写日志会同时踩上面那个"root 必须为空"的坑，
  风险大于收益 → 记为后续项（见 notes.md 第四节）。

## 三、签名 / 完整性影响（必须并入下一轮重签）

两个 cache 文件、两个 native 文件都破了既有 hash：

| 文件 | 落点 | 破了什么 |
|---|---|---|
| `employee-update-cache.cjs` | `补丁文件/project/desktop/`、`受信助手/project/desktop/` | `source-policy.tools[]` 的 sha256、`publication.treeSha256` |
| `employee-update-cache.app.cjs` | app 源码树 → 打进 `app.asar` | `app.asar` 的 sha256、asar 内清单 |
| `native-employee-update.cjs` | 只在 `app.asar` | `app.asar` 的 sha256 |
| `native-publication-update.cjs` | 只在 `app.asar` | `app.asar` 的 sha256 |

结论：**本轮产出不能直接上线**，要并进下一轮"重打包 asar + 重签发布清单"。
本机没有 `@electron/asar`（`E:/node/node_modules` 只有 corepack/npm），按你的规矩也没有构建，
所以 `app.asar` 的重打包必须在发布机上做。落地清单写在 `notes.md` 第五节。

## 四、5 条单测结果（全绿）

`tests/05-cache-selfheal.test.cjs`（夹具 `tests/lib/cache05-{before,after}/`），
原始输出存证在 `tests/outputs/05-run.txt`：

```
PASS  05.1 nlink=2 的普通文件：改前 UNSAFE_PATH，改后通过且 openChecked 可开
PASS  05.2 stage 里 archive.zip 是目录：改名隔离后 begin 成功
PASS  05.3 只读文件仍报 UNSAFE_PATH 且 detail 记录 exclusive-open（不放宽可信任集合）
PASS  05.4 root 变成普通文件：改名 <root>.broken-<ts> 并把动作写进 self-heal.log
PASS  05.5 回归：改前/改后 begin→write→seal→install→remove 的 proof 与产出一致
----- 5/5 passed, 0 failed -----
```

全量回归（01-04 未被影响）：`01` 6/6、`02` 9/9、`03` 8/8、`04` 8/8、`05` 5/5 = **36/36**。

复跑（纯源码，不构建、不签名）：
```
E:/node/node.exe 05-cache-selfheal/tools/build.cjs        # 由 before/ 重新派生 after/ + diff.patch + 夹具
E:/node/node.exe 05-cache-selfheal/tests/05-cache-selfheal.test.cjs
```

## 五、结论：员工机还需要人工清缓存吗？

**这批 nlink 报错的机器，不需要了。**

链路完整：点"检查更新" → 命中硬链接文件 → 新判定放行（不再报英文错）→ 若缓存真坏了，
`run()` 自动 `selfHeal()` 隔离残留并**自己再试一次**，界面显示的就是中文人话 +
"已自动重置，请再点一次"。整个过程不需要人进 `%APPDATA%` 删目录。

**唯一的例外**（如前所述）：`.native-integrity-key` 已丢失、但 root 里还留着
`native-sequence.json` 或 `accepted-sequence.json`。这种机器会继续报
`BAD_METADATA`，需要人工处理——这是为了不送防回滚的重置口子，属**故意保留**的保守行为。

> 注意：以上结论成立的前提是**这一轮改动真的发出去了**（重打包 asar + 重签 +
> 补丁文件重发）。目前只到源码副本这一步。

## 六、与 04 的关系（能不能一起打）

05 的 patch 点在 cache 文件的 **2-5 / 18-35 / 70-81 / 83-88** 行区，
04 在 **49-70 / 90**（`createTrustedUpdatePolicy`、`verifySignedCatalog`、`module.exports`）。
两者**没有重叠的改动行**，05 唯一贴着 04 的地方是 `@@ -70,12` 这个 hunk 的上下文头
（都是 `createEmployeeUpdateCache` 开头那两行，只当上下文用）。
先打 04 再打 05（或反之）都能干净应用；合并后建议跑一次 04+05 两套测试再重签。
