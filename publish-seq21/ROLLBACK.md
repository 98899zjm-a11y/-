# ROLLBACK — 生产发布点「员工升级」目录备份与回滚

> 生产目录（只读对待，**本文件中的命令是给人执行的**，脚本本身不会写这里）：
> `F:\鑫金源珠宝资料\程序设置\员工升级\`
>
> 备份落到 **D 盘**（不在生产盘、不在生产目录内）：`D:\Codex\xjy-release-20261022\publish-seq21\backup\<时间戳>\`

---

## 0. 现场清单（发布前实测，2026-10-22）

| 文件 | 大小 (B) | SHA-256 |
|---|---:|---|
| `catalog.json` | 205,209 | `3878062426c6ee85e7fbca0e9813ff91c80193d9a99d3db3ce307dacb1b999e8` |
| `native-manifest.json` | 806,881 | `0ebf732cac77e24fd32f28924dd8c88d4c152d7a3fe5d5932a4ba1e8adc34a7d` |
| `package.zip` | 164,878,024 | `b1a7b12029208994d0431101660368d22c8d887384485aff432765c380730dc9` |
| `native-package.zip` | 781,517,156 | `06ceef98b0dc05dcac5f554c1bccf91e18c31a626bc662cf5acd45e17c69d848` |

现网序号（回滚要回到的位置）：
- `catalog.json` → **sequence = 4**，version `1.7.0`
- `native-manifest.json` → **sequence = 20**，targetVersion `1.7.0`，engineVersion `44.9.0`

---

## 1. 发布前：只读核对（不改任何东西）

```powershell
$P = 'F:\鑫金源珠宝资料\程序设置\员工升级'
$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
$B  = "D:\Codex\xjy-release-20261022\publish-seq21\backup\$ts"
"时间戳: $ts"
"备份目录: $B"
Get-ChildItem -LiteralPath $P -File | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize
Get-FileHash -LiteralPath (Join-Path $P 'catalog.json')          -Algorithm SHA256 | Select-Object Hash
Get-FileHash -LiteralPath (Join-Path $P 'native-manifest.json')  -Algorithm SHA256 | Select-Object Hash
```

把得到的两个 Hash 与第 0 节的表对一遍。**不一致就先停下来**：说明现场已被人动过，回滚点不可信。

---

## 2. 备份（带时间戳，永不覆盖历史备份）

```powershell
$P = 'F:\鑫金源珠宝资料\程序设置\员工升级'
$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
$B  = "D:\Codex\xjy-release-20261022\publish-seq21\backup\$ts"
New-Item -ItemType Directory -Path $B -Force | Out-Null

# 方式 A（推荐）：robocopy 整目录镜像到备份目录，只读源、不删源
#   /E 含空目录  /COPY:DAT 属主+属性+时间  /R:1 /W:1 失败快速返回  /NFL /NDL /NP 精简日志
robocopy $P $B /E /COPY:DAT /R:1 /W:1 /NFL /NDL /NP
# robocopy 退出码 0-7 都算成功；>=8 才是失败
if ($LASTEXITCODE -ge 8) { throw "robocopy 失败，退出码 $LASTEXITCODE" }
$LASTEXITCODE = 0

# 方式 B（等价，逐文件 Copy-Item；中文路径必须用 -LiteralPath）
# New-Item -ItemType Directory -Path $B -Force | Out-Null
# foreach ($n in 'catalog.json','native-manifest.json','package.zip','native-package.zip') {
#   Copy-Item -LiteralPath (Join-Path $P $n) -Destination (Join-Path $B $n) -Force
# }
```

### 2.1 备份完整性校验（必须做，别跳）

```powershell
$P = 'F:\鑫金源珠宝资料\程序设置\员工升级'
$B = "D:\Codex\xjy-release-20261022\publish-seq21\backup\<上一步的 $ts>"

foreach ($n in 'catalog.json','native-manifest.json','package.zip','native-package.zip') {
  $a = (Get-FileHash -LiteralPath (Join-Path $P $n) -Algorithm SHA256).Hash
  $b = (Get-FileHash -LiteralPath (Join-Path $B $n) -Algorithm SHA256).Hash
  "{0,-22} {1}  {2}" -f $n, $(if ($a -eq $b) { 'OK  ' } else { 'FAIL' }), $a
}
```

四项全部 `OK` 才继续发布。另把清单落盘留证：

```powershell
Get-ChildItem -LiteralPath $B -File |
  ForEach-Object { "{0}  {1}  {2}" -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash, $_.Length, $_.Name } |
  Set-Content -LiteralPath (Join-Path $B 'SHA256SUMS.backup.txt') -Encoding utf8
```

---

## 3. 发布（写入生产；只在确认要发时执行）

```powershell
$P  = 'F:\鑫金源珠宝资料\程序设置\员工升级'
$S  = 'D:\Codex\xjy-release-20261022\publish-seq21\out'   # publish-seq21.cjs 的 --out

# 3.1 catalog.json（sequence 21）
Copy-Item -LiteralPath (Join-Path $S 'catalog.json') -Destination (Join-Path $P 'catalog.json') -Force

# 3.2 package.zip（员工补丁；本次与现网同内容，可跳过）
Copy-Item -LiteralPath (Join-Path $S 'package.zip')  -Destination (Join-Path $P 'package.zip')  -Force

# 3.3 native-manifest.json —— 不由本脚本生成！
#     必须先由 audit-release 产出候选原生清单，再拷进生产目录。
#     Copy-Item -LiteralPath '<audit-release 产出的 native-manifest.json>' -Destination (Join-Path $P 'native-manifest.json') -Force
#     要求：manifest.sequence = 21、targetVersion = 1.7.0、engineVersion = 44.9.0，
#           且 fullTargetCatalogSha256 必须是**新构建**的值（不能沿用 4d78cbba…）

# 3.4 native-package.zip（新原生包，781,517,180 B）
#     Copy-Item -LiteralPath (Join-Path $S 'native-package.zip') -Destination (Join-Path $P 'native-package.zip') -Force
```

> `out\` 里没有 `native-manifest.json`，是**故意的**：它的结构必须由审计器产出（见 `out\native-manifest-SOURCE.txt`）。

---

## 4. 回滚（出问题立刻执行）

目标是**内容回到第 0 节**：catalog sequence=4、native sequence=20、两个 zip 原字节。

```powershell
$P = 'F:\鑫金源珠宝资料\程序设置\员工升级'
$B = 'D:\Codex\xjy-release-20261022\publish-seq21\backup\<备份时的时间戳>'

# 4.1 先确认备份还在、且完整
Test-Path -LiteralPath $B
Get-ChildItem -LiteralPath $B -File | Select-Object Name, Length | Format-Table -AutoSize

# 4.2 回滚（覆盖写回；不删除生产目录里任何其它文件）
foreach ($n in 'catalog.json','native-manifest.json','package.zip','native-package.zip') {
  Copy-Item -LiteralPath (Join-Path $B $n) -Destination (Join-Path $P $n) -Force
}

# 4.3 逐字节验证回到原点
foreach ($n in 'catalog.json','native-manifest.json','package.zip','native-package.zip') {
  $a = (Get-FileHash -LiteralPath (Join-Path $P $n) -Algorithm SHA256).Hash
  $b = (Get-FileHash -LiteralPath (Join-Path $B $n) -Algorithm SHA256).Hash
  "{0,-22} {1}  {2}" -f $n, $(if ($a -eq $b) { 'RESTORED' } else { 'MISMATCH' }), $a
}
```

期望：四项全部 `RESTORED`，且 `catalog.json` 的 Hash 回到 `38780624…`、`native-manifest.json` 回到 `0ebf732c…`。

### 4.1 备选：robocopy 反向镜像

```powershell
robocopy $B $P /E /COPY:DAT /R:1 /W:1 /NFL /NDL /NP
if ($LASTEXITCODE -ge 8) { throw "robocopy 回滚失败，退出码 $LASTEXITCODE" }
```

`/E` 只做覆盖+补齐，**不带 `/MIR`**——`/MIR` 会删除生产目录里备份中没有的文件，属于破坏性操作，回滚场景禁止使用。

---

## 5. 回滚后的线上状态校验（可选，用我们自己的工具）

```powershell
# 只读：确认 catalog 已回到 sequence 4，且原生清单回到 sequence 20 并能被客户端 pin 验过
& 'E:\node\node.exe' 'D:\Codex\xjy-release-20261022\publish-seq21\_diag.cjs'   # 打印现网 catalog/native 的 sequence
```

或直接用 `accept-check.cjs` 的差分区（它会把生产 catalog 也过一遍真实客户端校验）：

```powershell
& 'E:\node\node.exe' 'D:\Codex\xjy-release-20261022\publish-seq21\accept-check.cjs'
# 看 checks.differentialVsProduction.sequence.prod 是否回到 4
```

---

## 6. 铁律

1. **不删生产文件**：本节所有操作都是覆盖写，没有任何 `Remove-Item` / `/MIR` / `/PURGE`。
2. **不在生产盘落备份**：备份一律写到 `D:\Codex\xjy-release-20261022\publish-seq21\backup\`，避免「备份把生产盘占满」引发新故障。
3. **备份先验、再发布**：第 2.1 节四项 `OK` 之前不许进第 3 节。
4. **native-manifest.json 必须来自 audit-release**，不要手写、不要改 `fullTargetCatalogSha256` 去凑序号——客户端 `publicationDecision` 会用
   `BAD_NATIVE_MANIFEST`（序号与目标目录矛盾）或 `STALE_NATIVE_MANIFEST`（同一序号换包）拦下。
5. **同一 sequence 不能换内容**：`update-distribution.cjs` 会以 409「同一发布序号不能改换更新内容」拒绝；回滚要连序号一起回。
