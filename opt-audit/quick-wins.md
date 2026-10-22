# 快速收益清单（Quick Wins）— 一天内可做，且**不破签名**

> 前提：本项目签名链极严。改 `delivery-tools\*.cjs` 或 `desktop\*.cjs` 都会触发
> `worker catalog(seq 28) → workerCatalogSha256 → engine-native170-binding.json → artifact zip(artifactSha256) → publicationId → 全部 approvals → outer 骨架` 的**全链重签**。
> 因此以下 5 条**全部落在签名 zip 之外**：只碰运维配置、新增外部脚本、文档与签名工具侧的辅助工具。
> 每条都给出：做什么 → 怎么做（可直接交给现场工程师）→ 预期收益 → 怎么验证 → 残留风险。

---

## QW-1　给安装目录加 Defender 排除项（收益最大，零代码）

**为什么**：安装过程要读 **6.33 GB**（`publicProof` 5 次 × 1.265 GB）+ `layout()` 约 38 GB 逻辑读。Defender 实时防护下顺序读只有 **100–400 MB/s**，排除后回到 **1–3 GB/s**。这是唯一"改配置就拿走一半时间"的点。

```powershell
# 需管理员。路径以现场实际安装盘符为准（下面用 <安装根> 占位，勿盲抄）。
$install = '<安装根>'                      # 例：D:\受信助手（禁止写死到 F:\自制软件 等禁区）
Add-MpPreference -ExclusionPath $install
Add-MpPreference -ExclusionPath (Join-Path $install '受信助手')
Add-MpPreference -ExclusionPath (Join-Path $install 'data')      # 若存在
Add-MpPreference -ExclusionProcess '受信助手.exe'
# 复核
Get-MpPreference | Select-Object -ExpandProperty ExclusionPath
```

**预期**：install 墙钟 **300–500 s → 120–200 s（−50~65%）**。
**验证**：`Measure-Command { .\一键升级.cmd }` 前后各 3 次取中位数；同时用 Process Monitor 确认 `CreateFile` 的 `Detail` 里不再出现 `Desired Access: ...` 后跟 Defender 扫描线程。
**残留风险（必须写进交付说明）**：
- 排除实时扫描会削弱"安装后被植入恶意文件"的检测。缓解：①仅在**单用途 POS 收银机**上排除；②排除范围限于`<安装根>`，**不要排除整个盘**；③引擎自带的 sha256 树证明仍是主防线（排除只影响杀软，不影响签名校验）；④定期用 `Start-MpScan -ScanType CustomScan -ScanPath $install` 做离线全扫。
- 若现场有集中式杀软策略（域控/SCCM），排除项可能被策略覆盖 → 需 IT 侧同步下发。

---

## QW-2　安装前"体检 + 预期耗时"前置脚本（新增文件，zip 外）

**为什么**：现场最大的痛点不是"慢"，而是"不知道是在慢还是卡死"，往往 300 s 后人工中断，留下半完成事务。用一个只读脚本把"磁盘类型 / 剩余空间 / Defender 状态 / 补丁包摘要"一次说清，并给出 ETA。

```powershell
# 保存为 <补丁包同级目录>\安装前体检.cmd 或 .ps1，只读，不修改任何被审文件
$ErrorActionPreference = 'Continue'
$pkg = Split-Path -Parent $MyInvocation.MyCommand.Path
$zip = Get-ChildItem $pkg -Filter '*.zip' | Sort-Object Length -Descending | Select-Object -First 1

Write-Host '== 1. 补丁包摘要（与发布单核对，只读）=='
if ($zip) {
  $h = (Get-FileHash $zip.FullName -Algorithm SHA256).Hash
  Write-Host ("{0}  {1}  {2:N0} bytes" -f $h.ToLower(), $zip.Name, $zip.Length)
  Write-Host '把上面的值抄到发布单的 artifactSha256 一栏做人工比对。'
}

Write-Host '== 2. 目标盘类型（决定 ETA）=='
$drive = (Get-Item $pkg).PSDrive.Name
Get-PhysicalDisk | Select-Object FriendlyName, MediaType, Size | Format-Table -AutoSize
Write-Host "目标盘: ${drive}:"
Get-Volume -DriveLetter $drive | Select-Object DriveLetter, FileSystemType, SizeRemaining, Size | Format-List

Write-Host '== 3. 剩余空间（需 ≥ 3× 补丁包 + 2 GB 余量）=='
if ($zip) { Write-Host ("建议剩余 ≥ {0:N0} MB" -f ($zip.Length * 3 / 1MB + 2048)) }

Write-Host '== 4. Defender 实时防护状态 =='
Get-MpComputerStatus | Select-Object RealTimeProtectionEnabled, AntivirusEnabled | Format-List

Write-Host '== 5. 预期耗时（经验值，供现场沟通）=='
Write-Host '  SSD + 已排除实时扫描 : 2–4 分钟'
Write-Host '  SSD + 实时扫描开启   : 5–8 分钟'
Write-Host '  机械盘              : 8–15 分钟'
Write-Host '  超过 20 分钟无进度   : 停止等待，收集 受信助手\state 日志后再判断'
```

**预期**：把"误判卡死 → 中断 → 半完成事务 → 二次排障"的工单量显著压低；不减少 I/O。
**验证**：在两种机器（SSD/机械盘）上各跑一次，确认第 5 段提示与实测区间一致（不一致就改文案，不改代码）。
**风险**：极低。脚本只读；`Get-PhysicalDisk` 在部分精简系统上可能不存在 → 用 `try/catch` 包住即可。

---

## QW-3　磁盘与索引体检（判定"是 I/O 慢还是代码慢"）

**为什么**：同一份代码在 SSD 上是 2–4 min，在机械盘 + Windows Search 索引下可以到 15 min。**没有这一步，所有性能优化都会被现场硬件噪声淹没。**

```powershell
# 只读判定，全部安全
winsat disk -drive C            # 顺序读 MB/s（>1000 = SSD/NVMe，<200 = 机械盘）
Get-Service WSearch | Select-Object Status, StartType
# 若安装盘被 Windows Search 索引（对大体积程序目录毫无意义，纯噪声）
Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Windows Search\CrawlScopeManager\Windows\SystemIndex\WorkingSetRules' -ErrorAction SilentlyContinue
# 建议（需管理员，可选）：把安装盘从索引范围移除，或至少排除 <安装根>
#   控制面板 → 索引选项 → 修改 → 取消勾选该盘
```

**预期**：把"性能问题"与"硬件/环境问题"分开；若判定为机械盘，则**结论是换 SSD，而不是改代码**（改代码最多救回 assertPath 那 260 s 的一半）。
**验证**：`winsat disk` 数值与 QW-2 的 ETA 一致性。
**风险**：无（只读）。改索引范围属运维决策，需现场同意。

---

## QW-4　构建期树摘要缓存（把重签周期从 8 min 压到 1–2 min）

**为什么**：P1 的四项优化每次迭代都要走一遍完整重签，而重签的耗时大头是"对同一批文件重复算 sha256"。这个缓存**只服务于签名工具链**，不进入受信 payload，因此零重签风险。

```powershell
# 放在签名工具目录（与 Sign170.cmd 同级），例如 tools\tree-digest-cache.ps1
# 用途：以 (相对路径, 文件大小, 最后写入时间) 为键缓存 sha256，命中即跳过读取。
param([string]$Root, [string]$CacheFile = "$PSScriptRoot\tree-digest-cache.json")

$cache = @{}
if (Test-Path $CacheFile) {
  (Get-Content $CacheFile -Raw | ConvertFrom-Json).PSObject.Properties |
    ForEach-Object { $cache[$_.Name] = $_.Value }
}
$result = @{}
Get-ChildItem $Root -Recurse -File | ForEach-Object {
  $rel = [IO.Path]::GetRelativePath($Root, $_.FullName).Replace('\','/')
  $key = '{0}|{1}|{2}' -f $rel, $_.Length, $_.LastWriteTimeUtc.Ticks
  if ($cache.ContainsKey($key)) { $result[$key] = $cache[$key] }
  else { $result[$key] = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower() }
}
$result | ConvertTo-Json -Compress | Set-Content $CacheFile -Encoding UTF8
Write-Host ("文件数 {0}，命中 {1}" -f $result.Count, ($result.Count - ($result.Keys | Where-Object { -not $cache.ContainsKey($_) }).Count))
```

**预期**：重签流程 **8 min → 1–2 min（~5×）**；后续 P1 重签的每次迭代都受益。
**验证**：连续跑两次，第二次命中率应 ≈100%；把缓存文件删掉再跑，两次数值必须逐字节一致（**这是安全底线：缓存只能提速，不能改变结果**）。
**风险**：低。注意 ①缓存键必须含 `LastWriteTimeUtc`，否则"改了内容但大小相同"会漏算；②`tree-digest-cache.json` 必须 `gitignore` 且**永不进入交付包**；③首次运行无收益。

---

## QW-5　升级说明补"预期耗时 + 进度语义"（文档，零成本）

**为什么**：现场 300–500 s 的等待期没有任何"我在干活"的强反馈，操作员会以为卡死。一句准确的预期能把误报工单砍掉大半。

写进 `受信助手` 的升级说明（或补丁包内的 `升级前必读.txt`，zip 外单独发）：

```
本次升级会做完整性与签名校验，需要读取约 6.3 GB 程序文件：
  · SSD 且已加杀软排除：约 2–4 分钟
  · SSD 未加排除      ：约 5–8 分钟
  · 机械硬盘          ：约 8–15 分钟
期间窗口"看起来不动"属正常，请不要关闭、不要拔电、不要重复双击。
超过 20 分钟无任何进度变化：请停止等待，把 <安装根>\受信助手\state 目录整体打包回传。
```

**预期**：消除"以为卡死 → 强制中断 → 半完成事务 → 人工救场"的连锁故障（这类故障的修复成本远高于优化本身）。
**验证**：统计下一版现场工单里"升级卡死"类目的数量变化。
**风险**：无。

---

## 一天之内怎么排

| 时段 | 动作 | 产出 |
|---|---|---|
| 上午 | QW-1 Defender 排除 + QW-3 体检 | 现场基线数据（改前/改后各 3 次计时） |
| 下午 | QW-2 体检脚本 + QW-4 摘要缓存 | 两个可复用脚本（都在 zip 外） |
| 收尾 | QW-5 文档 | 升级说明一段话 |

**做完这 5 条，不需要任何重签**，install 墙钟预期从 **300–500 s 降到 120–200 s**；剩下的差距（到 40–70 s）必须靠 P1 的引擎改动（`assertPath` 记忆化 + 树证明缓存 + `publicProof` 单次化），那是一次完整的 1.7.1 重签发布。

> ⚠ 再次强调：本清单**不包含**任何修改 `engine-tree-runtime170.cjs` / `delivery-tools\*.cjs` / `desktop\*.cjs` 的动作。凡涉及这些文件的优化，一律归入 `OPTIMIZATION_REPORT.md` 的 P1/P2，必须走完整重签流程。
