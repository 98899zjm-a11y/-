# 生产升级前安全备份报告（PROD BACKUP REPORT）

- 生成时间：2026-10-22 13:07 (+08:00)
- 执行人：DSH 代理（pwsh 7.6.6 / Windows 10.0.26200）
- 主机：张晋铭（用户 Administrator）
- 任务：1.6.2 → 1.7.0 升级前的只读源备份与校验
- 日志：`D:\Codex\xjy-release-20261022\evidence-c6-failed-170\prod-backup-20261022-130238.log`

## 结论（先看这里）

**可以进入正式升级。**

判定依据（硬门槛全部满足）：

| 门槛 | 要求 | 实测 | 结论 |
| --- | --- | --- | --- |
| 逐文件 SHA-256 diff | = 0 | **0** | 通过 |
| missingInBackup | = 0 | **0** | 通过 |
| missingInSource | = 0 | **0** | 通过 |
| robocopy 退出码 | 0–7 | **1 / 1** | 通过 |
| 三库 integrity_check + foreign_key_check | 全 ok | **3/3 PASS** | 通过 |
| 生产进程占用 | 无 | **无** | 通过 |

---

## 1. 备份根

```
D:\Codex\xjy-private-backups\pre170-a15-20261022-130238
├─ program\            3,525 个文件   1,620,307,739 B (1.51 GB)
├─ data\               1,176 个文件   2,394,718,644 B (2.23 GB)
├─ restore-validation\ 数据库副本 + 校验脚本/结果
├─ verify.json         逐文件校验结果（权威）
└─ verify.v1-defective.json  作废的首次校验输出（见第 8 节）
```

**合计：4,701 个文件 / 4,015,026,383 B（3.74 GB）**

## 2. 前置事实

| 项目 | 值 |
| --- | --- |
| 当前时间 | 2026-10-22 13:02:49 +08:00（UTC 05:02:49Z） |
| `F:\` 总/已用/剩余 | 863.0 GB / 59.30 GB / **803.70 GB 可用**（862,965,108,736 B） |
| `D:\` 可用 | 411.70 GB（442,059,218,944 B） |
| `F:\自制软件\xjy-jewelry-offline` | **3,525 文件 / 1,620,307,739 B** |
| `F:\鑫金源珠宝资料` | **1,176 文件 / 2,394,718,644 B** |
| 主程序 `鑫金源珠宝报价.exe` | 246,302,720 B，LastWriteTime 2026-10-10 22:50:20 |
| 空间余量结论 | 备份 3.74 GB 相对于 803.70 GB 剩余空间，余量充足 |

### activation / version 文件

`F:\自制软件\xjy-jewelry-offline\xjy-install-activation.json`（142 B，存在）：

```json
{"version":1,"product":"xjy-jewelry-offline","programVersion":"1.6.2","role":"host","installationDir":"F:\\自制软件\\xjy-jewelry-offline"}
```

`F:\自制软件\xjy-jewelry-offline\version`（6 B，存在）：

```
44.7.0
```

> 说明：`version` 文件内容 `44.7.0` 是 Electron 运行时版本，**不是**应用版本；应用版本以 activation JSON 的 `programVersion: 1.6.2` 为准。
>
> `F:\鑫金源珠宝资料\xjy-install-activation.json`、`F:\鑫金源珠宝资料\version`、`F:\自制软件\xjy-jewelry-offline\resources\version` 均**不存在**（日志中记 `[absent]`）。

## 3. 生产进程检查（未杀任何进程）

命令：`Get-Process | Where-Object { $_.Path -like 'F:\自制软件\xjy-jewelry-offline\*' }`

- 结果：**0 个进程**从生产程序目录运行（`Get-Process` 全量遍历 + `Path.StartsWith` 前缀匹配，逐进程 try/catch 防 `Path` 访问被拒）。
- 追加核对：名字含 `鑫金源` / `xjy` / `jewelry` 的进程 **0 个**。
- 因此复制期间没有文件被生产程序占用，robocopy 无失败项（`失败 0`、`不匹配 0`）。

## 4. 复制（robocopy）

参数（两组完全一致）：`/E /COPY:DAT /DCOPY:DA /R:2 /W:2 /MT:16 /NFL /NDL /NP`

| 组 | 源 | 目标 | 退出码 | 判定 | 目录/文件/失败 | 耗时 |
| --- | --- | --- | --- | --- | --- | --- |
| program | `F:\自制软件\xjy-jewelry-offline` | `<备份根>\program` | **1** | 成功（0–7） | 413 dirs / 3,525 files / 0 失败 | 1.0 s |
| data | `F:\鑫金源珠宝资料` | `<备份根>\data` | **1** | 成功（0–7） | 184 dirs / 1,176 files / 0 失败 | 0.8 s |

退出码 1 的含义是「已复制文件」，属成功区间。robocopy 原始输出另存于 `robocopy-program.log`、`robocopy-data.log`。

复制后重新枚举备份根：program 3,525 文件 / 1,620,307,739 B、data 1,176 文件 / 2,394,718,644 B —— 与源**逐字节数量级完全一致**。

## 5. 逐文件校验（SHA-256）

方法：两侧独立遍历（`\\?\` 长路径前缀 + `Directory.EnumerateFiles(AllDirectories)`），以「相对路径 → 长度」建表；长度不同直接判 diff，长度相同则两侧各做 **4 MiB 缓冲流式 SHA-256**（`File.Open(..., FileShare.ReadWrite)` + `TransformBlock`），逐条比对。

| 组 | 源文件 | 备份文件 | filesChecked | same | diff | missingInBackup | missingInSource | bytes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| program | 3,525 | 3,525 | 3,525 | **3,525** | **0** | **0** | **0** | 1,620,307,739 |
| data | 1,176 | 1,176 | 1,176 | **1,176** | **0** | **0** | **0** | 2,394,718,644 |
| **合计** | 4,701 | 4,701 | **4,701** | **4,701** | **0** | **0** | **0** | **4,015,026,383** |

- 结果文件：`<备份根>\verify.json`（`verdict: PASS`，`diffDetail` / `missingInBackupDetail` / `missingInSourceDetail` 均为空数组，`errors` 为空）。
- 耗时：program 21.0 s（73.7 MB/s）、data 7.8 s（294.0 MB/s），合计 29.3 s。

## 6. 数据库完整性（在副本上做，备份原件未动）

副本目录 `<备份根>\restore-validation\`，从 `<备份根>\data\` **复制**得到（含 WAL 边车文件），先确认副本与备份原件 SHA-256 一致，再对副本跑 PRAGMA：

- 执行器：`C:\Python314\python.exe`（Python 3.14.8，内置 sqlite3 库版本 **3.50.4**）
- 结果文件：`restore-validation\sqlite-check.json`，脚本：`restore-validation\check_sqlite.py`

| 库 | 文件大小 | integrity_check | foreign_key_check | 附加信息 | 结论 |
| --- | --- | --- | --- | --- | --- |
| `内帐\ledger.db` | 14,860,288 B | `ok` | `ok`（0 行违规） | journal=wal, page 4096×3628, 44 表（audit_logs 5,138 行、categories 7、channels 5） | **PASS** |
| `工作室数据\jewelry.sqlite` | 34,988,032 B | `ok` | `ok`（0 行违规） | journal=wal, page 4096×8542, 39 表（customers 9、audit_logs 140、document_sequences 6、central_print_events 24） | **PASS** |
| `库管\stockcheck.db` | 397,312 B | `ok` | `ok`（0 行违规） | journal=wal, page 4096×97, 16 表（skus 569、book_stock 1,557、book_batches 5、settings 17） | **PASS** |

**三库全部 PASS，无损坏、无外键违规。**

校验用的三份库副本 SHA-256（与备份原件、与生产源文件三方一致）：

| 文件 | SHA-256 |
| --- | --- |
| ledger.db | `59e44642b6edb7e72f3ddfb52aa2dd0565baa42c94d6d6118adda09e9b033a90` |
| jewelry.sqlite | `866c075e7ecb464ba98cffc0d58a3aeea6f44eeb60b1a10b3309918dbdf7103c` |
| stockcheck.db | `ee84bd60d351c1a788c0f1260c409f9764f074a6e31baf124a50536a42e27ad2` |

> 备注：Python/sqlite 打开副本并关闭时，会把 0 字节的 `-wal` 与 `-shm` 边车合并/清理掉，这只发生在 `restore-validation` 的副本上；备份原件 `data\内帐\ledger.db-wal(0 B)`、`-shm(32768 B)`、`data\库管\stockcheck.db-wal/-shm` **均原样保留**（已复核存在且大小不变）。

## 7. 生产侧未被改动（只读证据）

- 备份+校验+db副本操作**全程结束后**重新枚举源目录：
  - `F:\自制软件\xjy-jewelry-offline` = 3,525 文件 / 1,620,307,739 B（与前置事实一致）
  - `F:\鑫金源珠宝资料` = 1,176 文件 / 2,394,718,644 B（与前置事实一致）
  - `F:\` 剩余 = 862,965,108,736 B（与前置事实一致，未向 F: 写入任何字节）
- 未对生产目录/生产数据执行任何 move/rename/delete/attr 写入；robocopy 仅以 `/COPY:DAT /DCOPY:DA` 写目标一侧。
- 未杀任何进程。
- 未访问任何微信相关路径（`%APPDATA%\Tencent`、`%LOCALAPPDATA%\Tencent`、`Documents\WeChat Files`、`D:\微信` 等一律未触碰）。
- 所有写操作只发生在 `D:\Codex\xjy-private-backups\pre170-a15-20261022-130238` 与 `D:\Codex\xjy-release-20261022\evidence-c6-failed-170` 之下。

## 8. 过程异常与已处置事项（如实记录）

1. **首次校验（v1）作废**：`.NET` 的 `FileInfo.FullName` 会保留 `\\?\` 长路径前缀（多 4 字符），导致按 `FullName.Substring(root.Length)` 计算的相对路径整体错位，产出 `line\…` / `gram\…` / `data\…` / `源珠宝资料\…` 之类的伪路径，于是 v1 报出 `same=0、missingInBackup=4701、missingInSource=4701` 的假失败。
   - 这是**校验工具缺陷，不是备份缺陷**：同一时刻 robocopy 的计数/字节与源完全一致，且备份目录结构已人工核对正常（`<备份根>\data\` 下无嵌套 `data\`）。
   - 处置：剥离前缀后重跑（v2），结果见第 5 节；v1 输出保留为 `verify.json` 的同目录 `verify.v1-defective.json` 以便审计，日志中亦保留 v1 原始明细与作废说明。
2. robocopy 退出码为 1（不是 0）：属正常「已复制文件」状态，不是失败。
3. 控制台回显在日志采集层出现过中文乱码，但 `.log` 文件本身按 UTF-8 正常保存（已复核「ROBOCOPY :: Windows 的可靠文件复制」等中文行可读）。

## 9. 交付清单

| 文件 | 说明 |
| --- | --- |
| `D:\Codex\xjy-private-backups\pre170-a15-20261022-130238\program\` | 生产程序完整副本（3,525 文件） |
| `D:\Codex\xjy-private-backups\pre170-a15-20261022-130238\data\` | 生产数据完整副本（1,176 文件） |
| `…\verify.json` | 逐文件 SHA-256 校验结果（PASS） |
| `…\verify.v1-defective.json` | 已作废的 v1 校验输出（留档） |
| `…\restore-validation\` | 三库副本 + `check_sqlite.py` + `sqlite-check.json` |
| `…\evidence-c6-failed-170\prod-backup-20261022-130238.log` | 全流程日志 |
| `…\evidence-c6-failed-170\robocopy-program.log` / `robocopy-data.log` | robocopy 原始输出 |
| `…\evidence-c6-failed-170\PROD_BACKUP_REPORT.md` | 本报告 |

## 10. 最终判断

> **可以进入正式升级。**
>
> 备份完整（4,701 文件 / 3.74 GB）、逐文件 SHA-256 `diff=0`、`missingInBackup=0`、`missingInSource=0`、robocopy 两侧退出码 1（成功）、三库 `integrity_check` 与 `foreign_key_check` 全部通过、复制期间无生产进程占用、生产侧零改动。回滚路径可用：直接以 `<备份根>\program` 覆盖程序目录、以 `<备份根>\data` 还原业务数据即可。
