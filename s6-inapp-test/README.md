# 员工机「软件内一键升级」验收工具包

只读工具，不修改发布点、不修改员工机、不杀进程。三件产出：

| 文件 | 跑在哪 | 作用 |
| --- | --- | --- |
| `主机-核对.ps1` | 生产主机 | 核对发布点四个文件（大小/sha256）、catalog 与 native-manifest 字段、Ed25519 签名、以及四条绑定链 |
| `员工机-采集.ps1` | 员工机 | 只读采集：SID、安装根 marker、version 文件、exe 版本、进程说明、已接受发布序号证据、31831 连通性、应用日志尾部 → 桌面 `xjy-inapp-diag.json` |
| `verify-sig.cjs` | 生产主机 | 被 `主机-核对.ps1` 调用的验签器（Node，Ed25519）。也可单独跑 |

两个 ps1 都是纯 ASCII 脚本（中文全部用 `[char]0xXXXX` 拼），可以直接走邮件/U 盘/聊天软件传，不会被代码页搞坏。

---

## 0. 先看这三条硬约束（不看会白跑一轮）

1. **现网 1.7.0 员工端只认一个身份**：`purpose=xjy-native-employee-update-v1`、`app=xjy-jewelry-offline`、`role=employee`、`targetVersion=1.7.0`、`engineVersion=44.9.0`。任何一项不符 → 直接 `BAD_NATIVE_MANIFEST`，不看序号。
2. **序号比较不是「必须大于」，而是「同目录 + 不小于」**（`native-update-manifest.cjs` 实测逻辑）：
   - `manifest.sequence < installed.sequence` → `STALE_NATIVE_MANIFEST`
   - `manifest.fullTargetCatalogSha256 === installed.fullTargetCatalogSha256` → 判 `latest`（**已是最新，不会升级**），并要求 `sequence` 相同，否则 `BAD_NATIVE_MANIFEST`
   - `manifest.sequence <= installed.sequence` → `STALE_NATIVE_MANIFEST`（同序号不能换整套程序）
3. **所以：员工机已装 1.7.0 / 序号 20，而当前发布点就是 seq 20 + 同一个 target 目录 → 点「检查更新」只会得到「已是最新」。这是正确行为，不是故障。** 想真正验收「软件内一键升级」，必须发 **seq 21 且换 target catalog**（见 `..\SEQ21_PLAN.md`）。本轮验收的目标因此是：**证明整条链路可判定**（该给「已是最新」时给「已是最新」，该报码时报对码），而不是硬等一次覆盖安装。

---

## 1. 主机侧：发布点与「服务副本」不是同一个目录

- 发布点（交接副本）：`F:\鑫金源珠宝资料\程序设置\员工升级\`
  `catalog.json` `package.zip` `native-manifest.json` `native-package.zip`
- 员工机真正读的是**主机账号 profile 里的服务副本**：`%APPDATA%\xjy-jewelry-offline\员工升级\`（同一套四个文件）。
  员工端点「检查更新」时，主机必须已经把四个文件**发布**到那里；只把文件拷到 F: 盘发布点是不够的。
- 本机实测状态（2026-10-22 18:07）：`主机-核对.ps1` 给出 **S-1 WARN：三个 profile 根下都没有 `员工升级` 目录**。也就是说主机还没向服务目录发布，员工机此刻连上来只能看到旧发布 —— 这条必须先修，否则后面全部无意义。

主机服务端口实测（2026-10-22 18:06）：

```
192.168.1.98:31831  OPEN      （Get-NetTCPConnection: 192.168.1.98:31831  OwningProcess 6344）
127.0.0.1:31831     CLOSED    （只绑 LAN IP，不绑回环 —— 员工机必须用 LAN IP，主机自己用 127.0.0.1 测会误判）
防火墙              Domain/Private/Public 全部 Enabled=False
未带凭证的 GET      /  /api  /health  /api/employee-updates/catalog  /api/employee-updates/native-manifest  全部 404
```

**结论：不要用 HTTP 探针判断「发布是否就绪」。** 404 既可能是鉴权拒绝，也可能是该实例还没挂这两个路由；判定要以「主机服务副本是否存在 + 员工端点检查更新时的真实提示」为准。

---

## 2. 验收步骤 1–8

> 全程只读。主机侧不要点「重新发布」以外的写操作；员工机侧只点界面上本来就有的按钮。

**步骤 1｜主机：确认发布点自洽（必做，先跑）**

```powershell
cd D:\Codex\xjy-release-20261022\s6-inapp-test
powershell -NoProfile -ExecutionPolicy Bypass -File .\主机-核对.ps1
```

期望：`PASS 15 WARN 1 FAIL 0`，退出码 0。唯一 WARN 应是 S-1（服务副本未发布）。
本机实测输出见 `last-run.txt`（同目录），JSON 明细见 `host-check-result.json`。

可选参数：

| 参数 | 说明 |
| --- | --- |
| `-ReleaseDir` | 换发布点目录（默认 `F:\鑫金源珠宝资料\程序设置\员工升级`） |
| `-PublicPem` | 换公钥（默认扫 `candidate\*\worker-draft\publisher-public.pem` 等） |
| `-ServedDir` | **服务副本目录**，直接指到 `...\xjy-jewelry-offline\员工升级` 可把 S-1 从 WARN 变 PASS，并逐个比对四个文件的 sha256 |
| `-JsonOut` | JSON 输出路径 |
| `-NodeExe` | node 路径（默认 `E:\node\node.exe`） |

**步骤 2｜主机：让四个文件真正落到服务副本**

在应用里点「发布/检查更新」走正常发布流程（**不要手工拷文件进 profile**，会破坏校验）。发布后再跑一次步骤 1，并加 `-ServedDir`：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\主机-核对.ps1 -ServedDir "$env:APPDATA\xjy-jewelry-offline\员工升级"
```

期望 S-1 变 PASS：四个文件在服务副本里的 sha256 与发布点一致。

**步骤 3｜主机：确认监听**

```powershell
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -ge 31830 -and $_.LocalPort -le 31840 }
```

记下 `LocalAddress`（实测 `192.168.1.98`）——员工机采集脚本要用这个 IP。

**步骤 4｜员工机：采集基线（升级前先采一次）**

把 `员工机-采集.ps1` 拷到员工机，右键「使用 PowerShell 运行」，或：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\员工机-采集.ps1 -HostAddress 192.168.1.98
```

产出：`%USERPROFILE%\Desktop\xjy-inapp-diag.json`（约 50 KB）。

关键参数：

| 参数 | 说明 |
| --- | --- |
| `-HostAddress` | 主机 LAN IP（必填才有端口/HTTP 探针） |
| `-Port` | 默认 31831，可加 `-ExtraPorts 31832,31833` 一起测 |
| `-InstallRoot` | 安装根不唯一时指定。**路径里不要带中文**（嵌套 powershell 传参会按代码页转换） |
| `-LogLines` | 日志尾部行数，默认 200 |
| `-OutFile` | 默认桌面 `xjy-inapp-diag.json` |
| `-SkipNet` / `-SkipLogs` | 跳过网络 / 日志段（离线排障时用） |

**步骤 5｜员工机：启动 1.7.0 并用员工账号登录**

必须是**员工**身份登录。`LOGIN_REQUIRED` 就是这一步没做。

**步骤 6｜员工机：点「检查更新」，把提示原文记下来**

四种可接受的结果（都算「链路可判定」）：
- `已是最新`（当前 seq 20 场景下的**预期**结果）
- 开始下载并安装 → 成功（需要主机发 seq 21）
- 某个失败码（见第 3 节判定表）
- 无反应/转圈 → 采一次诊断，看 `network.ports[0].tcpOk`

**步骤 7｜员工机：升级后立刻再采一次**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\员工机-采集.ps1 -HostAddress 192.168.1.98 -OutFile "$env:USERPROFILE\Desktop\xjy-inapp-diag-after.json"
```

对比前后两个 JSON：
- `install.marker.programVersion`、`install.versionFiles[0].content`（应为 `44.9.0`）、`install.executables[].fileVersion`
- `sequence.acceptedJsonDirect[].content` 里的 `sequence`（应变成新发布序号）
- `logs.tail` 里有没有安装/校验记录
- `processes` 里旧的 exe 是否已换成新路径/新 pid

**步骤 8｜记录与归档**

把第 4 节列的六个证据文件放到同一个文件夹（建议 `D:\Codex\xjy-release-20261022\s6-inapp-test\run-<日期>\`），并在 `验收记录.md` 里写：主机发布序号、员工机前后序号、点击时间、提示原文、判定结论。判定规则：**只有「提示原文 + 序号变化 + 日志」三者同时成立才算通过**，单看界面文案不算。

---

## 3. 八种失败码的判定

判定顺序：先看员工端提示原文，再回诊断 JSON 找对应字段，最后回主机核对结果找根因。

| 失败码 | 员工端提示（原文） | 诊断 JSON 里的判据 | 主机侧根因 → 处理 |
| --- | --- | --- | --- |
| `UPDATE_NOT_PUBLISHED` | 主机尚未发布员工更新包，请继续使用当前程序。 | 服务端根本没返回清单；`network.endpoints` 为空或 `status` 非 200 | 主机没走发布流程 / 服务副本目录不存在（S-1 WARN）。→ 步骤 2 |
| `UPDATE_HELPER_UNAVAILABLE` | 本机更新助手尚未安装，当前程序继续可用。 | `install.root` 下没有 `resources\update-helper\`（4 个文件） | 员工机是被手工安装/被清理过的，缺更新助手。→ 用 1.7.0 正式包重装 |
| `BAD_HELPER_PINS` | 本机更新配置尚未核验，当前程序继续可用。 | 同上四个文件存在，但 `bootstrap.json` 的 sha256/版本/`executableName` 与已装程序不一致 | 混装：只换了 exe、没换 helper。→ 整包重装，别覆盖单文件 |
| `EMPLOYEE_DEVICE_REQUIRED` | 仅员工电脑可以在这里升级，主机请由管理员更新。 | `install.marker.role` ≠ `employee`（或缺 marker） | 这台机的 marker 写的是主机角色，或 marker 丢失。→ 修复 marker（重装/激活），不要手改 |
| `STALE_NATIVE_MANIFEST` | 原生清单序号已被取代 / 该原生发布已被较新的发布取代 | `sequence.acceptedJsonDirect[].content.sequence` 或安装收据序号 **大于等于** 主机 manifest 的 `sequence` | 主机发了旧序号（或同序号换 target）。→ 发更高序号（seq 21），见第 0 节第 2 条 |
| `BAD_NATIVE_MANIFEST` | 原生员工更新身份不符 | manifest 的 `targetVersion`/`engineVersion`/`role`/`purpose` 任一不符；或 `sequence` 与 `fullTargetCatalogSha256` 矛盾 | manifest 不是给员工机的（比如发成了 worker/host 的），或 target 目录与序号不配套。→ 用 `主机-核对.ps1` 的 N-3 / X-3 定位 |
| `LOGIN_REQUIRED` | 请先使用有效的员工账号登录。 | `identity.userSid` 有值但应用里会话失效 | 员工账号没登录/掉线。→ 重新登录再点 |
| `STALE_CATALOG` | （补丁通道）目录序号已被取代 | `sequence.acceptedJsonDirect[].content.sequence` > catalog `sequence` | 补丁目录序号比员工已接受的小。→ 主机重发更高 `catalog.sequence` |

补充码：`ACCOUNT_CHANGED`（升级中换账号，重启后重点）、`BAD_CHUNK`（下载内容与发布绑定不一致，主机侧重查 `package.zip` sha256）、`BAD_HELPER`（助手校验失败，原程序不变）、`NATIVE_SOURCE_UNVERIFIED` / `BAD_NATIVE_BINDING`（内层 binding 链异常，对应 `主机-核对.ps1` 的 B-1/B-3/B-0）。

---

## 4. 证据要收哪几个文件

一次验收（一台员工机、一轮）收这六个，缺一不可：

1. `主机-核对` 的 **stdout 全文** → `last-run.txt`（或 `... | Tee-Object last-run-<日期>.txt`）
2. `主机-核对-result.json` → 默认 `host-check-result.json`（含每个文件 sha256、每个检查项的 PASS/WARN/FAIL）
3. 主机 **服务副本** 的四文件清单（`Get-ChildItem` 带 Length/LastWriteTime）或带 `-ServedDir` 的那次 stdout
4. 员工机 **升级前** `xjy-inapp-diag.json`
5. 员工机 **升级后** `xjy-inapp-diag-after.json`（同一次点击的对照）
6. 界面提示 **截图或原文**（哪个码、哪句话、几点几分）

可选加分证据：`Get-NetTCPConnection -State Listen` 输出（证明主机监听地址）、员工机点击时刻的主机应用日志尾部（`logs.tail` 已含 200 行）。

存档命名建议：`run-20261022-<员工机主机名>\`，六个文件原名放进去，另加一份 `验收记录.md`。

---

## 5. 本次已跑出的实测结果（可直接引用）

`主机-核对.ps1`（2026-10-22 18:07，发布点 `F:\鑫金源珠宝资料\程序设置\员工升级`）：

```
PASS 15   WARN 1   FAIL 0    exit 0
K-1 公钥指纹 pemSha256 bc6c3d2b42871e42d3eb91371034b410d507a228eeccb1d714acca60e8141b30  PASS
F-1 catalog.json         205,209 B        sha256 3878062426c6ee85e7fbca0e9813ff91c80193d9a99d3db3ce307dacb1b999e8
F-2 package.zip          164,878,024 B    sha256 b1a7b12029208994d0431101660368d22c8d887384485aff432765c380730dc9
F-3 native-manifest.json 806,881 B        sha256 0ebf732cac77e24fd32f28924dd8c88d4c152d7a3fe5d5932a4ba1e8adc34a7d
F-4 native-package.zip   781,517,156 B    sha256 06ceef98b0dc05dcac5f554c1bccf91e18c31a626bc662cf5acd45e17c69d848
C-2 catalog 签名 PASS      payload sha256 f4b2972e7357b1ab73e7c8cd1a4b3e3160c98b10da2c3da35eba481573591d83
N-2 manifest 签名 PASS     payload sha256 a40079f1336220ed30a60ab032298768245be52c575c7a354ec1cf86cfb2e944
B-1 binding sha256 PASS    cb3bb4ce2702adba4d1dfd918c812299ba07eb7e7b306cc7f1d393eb7a09d2fd
B-3 inner catalog sha PASS 4d78cbbac07b05f267fabb870a10376a2c1158a8b4623ba4ea35d3334cb828ef
N-6 worker 钉 PASS         受信助手\鑫金源珠宝报价.exe 246,302,720 B db3ad2066a55546f9b6737da3c7f011370e4856fb36888055b544d45653e4f40
S-1 WARN                   三处 profile 根下都没有「员工升级」目录 → 主机还没发布
```

`员工机-采集.ps1` 自测：用 `%TEMP%\xjy-fake-install` 造假安装点（marker role=employee / version=44.9.0 / accepted-sequence 20）跑通，产出 54 KB JSON，字段齐全；同时在本机实跑得到：7 个 `鑫金源珠宝报价.exe` 进程、`192.168.1.98:31831` 通、`127.0.0.1:31831` 拒连。

---

## 6. 已知限制

- `员工机-采集.ps1` 需要 PowerShell 5.1+（Win10/11 自带）；不需要管理员，但读取 `Win32_Process.CommandLine` 时非管理员可能只拿到部分进程的命令行。
- 自动探测安装根在多个 xjy 目录并存时会选第一个命中的（本机就同时存在 `F:\xjy-install-170` 与产品目录）；结论有疑义时用 `-InstallRoot` 指定，且路径不要含中文。
- 本工具**不判断「升级是否成功」**，只提供证据；最终判定按第 2 节步骤 8 的三条件。
- 采集脚本对每个候选序号文件只保留前 600 字符原文，避免把主机/员工机的整份大 JSON 塞进诊断包。
