# 鑫金源珠宝 1.7.0 · r2 / sequence-21 阶段成果快照

本仓库分支 `release/1.7.0-r2-seq21-20261022` 是 **1.7.0 桌面版 r2（sequence 21）阶段的源码级归档快照**。

- 快照日期：2026-10-22（Asia/Shanghai）
- 基线阶段：`release/1.7.0-staging-20261022`（`e5def1b6f1a882ff38f66d9fcf4bd72011feb33f`）之后的 r2 工作
- 分支性质：**独立提交（orphan，无父提交）**，仅含本阶段源码与文档；`main` 与本分支无共同历史，本分支不引用、不影响 `main`
- 内容规模：71 个文件，全部为文本源码/文档，**不含任何二进制分发包**

> ⚠️ **本快照不含发布资格声明。** 据 `DELIVERY_STATUS.json`：
> `status = SIGNED_INTERNAL_VERIFIED_HOST_UPGRADED`、
> `secondaryStatus = EMPLOYEE_ACCEPTANCE_PENDING`、
> `releaseQualified = false`、`finalAcceptancePassed = false`。
> 即：生产主机已升级并核验通过，**员工机验收尚未通过**。本分支是阶段归档，不是可发布结论。

---

## 1. 为什么是「源码级」

1.7.0 的完整发布物是 `package.zip`（164,878,024 B）与 `native-package.zip`（781,517,156 B），
连同员工补丁包等合计约 1.8 GB。这些二进制**一律不入库**（见 `.gitignore`），
本分支只保留可以审阅、可以重放、可以 `diff` 的那部分：审计报告、修复补丁、
改动前后的源码副本、发布/校验工具、以及验收工具包。

因此本分支上**不存在**任何可直接安装的成品包。要复现验证，必须自备对应阶段的
`candidate\build` 目录与发布物 zip（见第 5 节）。

---

## 2. 目录结构

```
.
├── README.md                     # 本文件
├── .gitignore                    # 二进制/临时/凭据排除规则
├── .gitattributes                # `* -text`：禁止换行转换，保证入库字节与源文件逐一相同
│                                 # （本机 core.autocrlf=true，不加此文件会破坏 SHA256SUMS 校验）
├── DELIVERY_STATUS.json          # 阶段交付状态机（权威状态来源，含逐轮缺陷与证据）
│
├── audit-20261022/               # 只读审计
│   ├── FULL_AUDIT.md             #   全盘审计：5 条 P0 + 若干 P1，每条给出 文件:行号 + 原文 + 触发条件 + 影响 + 最小修复
│   └── FRESH_INSTALL_FIX.md      #   首装可用性：ACL 断言误收 Delete 位为根因；零重签的运维解法与需重签的产品解法
│
├── opt-audit/                    # 只读优化审计
│   ├── OPTIMIZATION_REPORT.md    #   总体优化报告
│   ├── oss-candidates.md         #   可外置/可替换的开源候选
│   ├── quick-wins.md             #   低风险速赢项
│   ├── CLIENT_OPTIMIZATION.md    #   客户端侧优化
│   ├── client-oss.md             #   客户端开源候选
│   └── client-quick-wins.md      #   客户端速赢项
│
├── p0-fix-next/05-cache-selfheal/    # P0-5「员工机缓存自愈」完整交付
│   ├── before/                   #   改动前源码副本（4 个 .cjs + SHA256SUMS.txt）
│   ├── after/                    #   改动后源码副本（4 个 .cjs + SHA256SUMS.txt）
│   ├── diff.patch                #   统一补丁（全部 9 个改动点）
│   ├── README.md                 #   交付说明：改了哪几行、为什么安全、签名影响
│   ├── notes.md                  #   设计笔记与冲突分析
│   ├── tests/                    #   单测 + harness + before/after 夹具 + 最近一次运行输出
│   └── tools/build.cjs           #   生成 before/after 与 patch 的构建脚本
│
├── s7-employee-cache-fix/        # 员工机缓存现场处置脚本
│   ├── inspect-and-quarantine-cache.ps1
│   └── verify-after-update.ps1
│
├── source/r2-asar/               # asar 层面的重打包与校验
│   ├── repack-r2-asar-a1.py
│   ├── verify-r2-asar-a1.py
│   └── verify-seq22-asar-a1.py
│
├── verify-r2/verify-package.cjs  # 发布包校验器（三重绑定 + 可执行位/进程检查）
│
├── publish-seq21/                # sequence-21 发布与回滚
│   ├── publish-seq21.cjs         #   生成 catalog.json / native-manifest.json（硬断言不写生产目录）
│   ├── accept-check.cjs          #   发布前只读验收：catalog 契约、asar 内规则、生产目录对照
│   └── ROLLBACK.md               #   生产发布点备份 + 回滚手册（命令由人执行）
│
├── s6-accept-harness/            # 离线判定「现网员工机会不会接受这份 native-manifest」
│   ├── accept-harness.cjs        #   直接 require 现网 app.asar 内真实规则，不重写判定
│   ├── make-matrix.cjs           #   生成判定矩阵
│   └── matrix.md                 #   矩阵真实输出
│
├── s6-employee-kit/              # 员工机自测工具包（只读 + 打包日志）
│   ├── 01-check.ps1
│   ├── 02-collect-logs.ps1
│   └── 03-after-click.md
│
├── s6-inapp-test/                # 软件内一键升级验收工具包（主机 + 员工机双端采集）
│   ├── 主机-核对.ps1
│   ├── 员工机-采集.ps1
│   ├── verify-sig.cjs
│   ├── HOST_PUBLISH_PATH.md
│   └── host-check-result.json / last-run.txt / 样例-xjy-inapp-diag-自测输出.json
│
├── recovery-170-drill/           # 升级中途失败/断电恢复演练（Windows Sandbox 方案 + 脚本，不含执行结果）
│   ├── 01-seed.ps1  02-watch-prepared.ps1  03-verify-after.ps1  04-collect.ps1
│   └── recovery-170.wsb / s4-recovery-170-pkgA.wsb
│
├── recovery-170-runbook/         # 断电式真实失败恢复操作手册（准备材料，非执行记录）
│   └── README.md  collect-host.ps1  verify-install.ps1  watch-phase.ps1
│
└── accept-170-scripts/           # 首装验收引导（Windows Sandbox 内手动依次执行）
    ├── 01-bootstrap.ps1  02-freshhost.cmd  03-status.ps1
    └── README.md
```

---

## 3. 逐项要点

| 目录 | 它回答的问题 |
|---|---|
| `audit-20261022/FULL_AUDIT.md` | 现网 1.7.0 到底有哪些 P0/P1 缺陷，每条能否定位到 `文件:行号` |
| `audit-20261022/FRESH_INSTALL_FIX.md` | 全新机器/新员工机为什么装不上，哪一处是唯一杀手，哪些改法必须重签 |
| `opt-audit/*` | 体积/启动/依赖层面的可优化项与开源替换候选 |
| `p0-fix-next/05-cache-selfheal/` | 员工机缓存被同步盘加硬链接（`nlink=2`）后界面只剩英文报错、只能人工删目录 —— 如何在不放宽可信任集合的前提下自愈 |
| `verify-r2/verify-package.cjs` | 这份候选构建是不是我们签名的那份（asar sha、引擎 `size:sha256`、可执行位） |
| `publish-seq21/` | 如何生成 sequence-21 发布清单，以及出错怎么回滚 |
| `s6-accept-harness/` | 已装某 sequence 的员工机**会不会**接受新 manifest（判定权在现网 asar 内） |
| `s6-employee-kit/` `s6-inapp-test/` | 在员工机上取证而不是猜：点不动升级时留下什么证据 |
| `recovery-170-drill/` `recovery-170-runbook/` | 升级到一半断电/失败后，同一现场如何恢复到可用 |
| `accept-170-scripts/` | 干净沙盒里首装能不能一次装上 |

### 一处关键设计约束

`s6-accept-harness/accept-harness.cjs` 与 `publish-seq21/accept-check.cjs` 都**不重新实现**升级判定规则，
而是从现网 `app.asar` 里取出真实的 `native-update-manifest.cjs` / `native-publication-update.cjs` 后直接调用。
这是刻意的：判定权必须留在客户端那份代码上，工具只做取证。因此这两个工具在缺少现网 `app.asar` 时无法给出结论。

---

## 4. 依赖与前置

- **Node.js**：`verify-package.cjs`、`accept-harness.cjs`、`accept-check.cjs`、`publish-seq21.cjs`、`05-cache-selfheal` 单测均需 Node（脚本内使用 `node:` 前缀内置模块，建议 ≥ 18）
- **PowerShell**：`*.ps1` 面向 Windows PowerShell 5.1 编写；`accept-170-scripts/*.ps1` 正文全部 7-bit ASCII（中文路径用 `[char]0xXXXX` 拼接），以免 5.1 把无 BOM UTF-8 当 ANSI 解码
- **零第三方依赖**：本快照内脚本不 `npm install`，不使用 `node_modules`
- **不接触生产**：`publish-seq21.cjs` 内置 `assertNotProduction(out)` 硬断言；`verify-r2`、`s6-*` 一律只读；
  `recovery-170-*`、`accept-170-scripts` 只在 Windows Sandbox 的 VHD 内操作

---

## 5. 如何复现验证

以下命令均在本仓库根目录执行。尖括号内为需要自备的路径 —— 二进制与 `candidate\build` **不在本分支**。

### 5.1 校验发布包三重绑定

```bash
node verify-r2/verify-package.cjs \
  --build "<candidate/build 目录>" \
  --expect-asar <64位sha256> \
  --expect-engine <size>:<sha256> \
  --executable 0
```

退出码非 0 即视为该构建不是目标候选（参数解析失败报 `BAD_ARGS`，校验失败报对应错误码）。

### 5.2 跑 P0-5 缓存自愈单测

```bash
node p0-fix-next/05-cache-selfheal/tests/05-cache-selfheal.test.cjs
```

预期输出 5 条 `PASS` 与 `----- 5/5 passed, 0 failed -----`；
结果会同时写入 `p0-fix-next/05-cache-selfheal/tests/outputs/05-run.txt`（本分支内即最近一次真实输出）。
该用例钉住三件事：`nlink=2` 的普通文件在放宽后可通过且仍要求独占打开；畸形残留（root 变文件、stage 里 `archive.zip` 变目录）能自愈；
正常路径的 `begin→write→seal→getInstallStage→remove` proof 逐字节等价。

### 5.3 离线判定现网员工机会不会接受新清单

```bash
node s6-accept-harness/accept-harness.cjs \
  --manifest <native-manifest.json> \
  --archive <native-package.zip>
```

需要现网 `resources/app.asar`（脚本内有默认路径，可用参数覆盖）。
`node s6-accept-harness/make-matrix.cjs` 可重生成 `matrix.md`；本分支内 `matrix.md` 是真实输出。

### 5.4 发布前只读验收

```bash
node publish-seq21/accept-check.cjs \
  --catalog <catalog.json> \
  --prod-catalog "<生产发布点>/catalog.json" \
  --archive <package.zip> \
  --asar "<安装根>/resources/app.asar" \
  --installed-sequence 20 \
  --current-version 1.6.2
```

### 5.5 生成 sequence-21 清单（只在本地输出目录写）

```bash
node publish-seq21/publish-seq21.cjs \
  --archive <native-package.zip> \
  --patch "<员工补丁.zip>" \
  --out <本地输出目录> \
  --sequence 21 \
  --target-version 1.7.0 \
  --engine-version 44.9.0
```

`--out` 指向生产目录会被硬断言拒绝。

### 5.6 复核改动本身

```bash
git apply --check p0-fix-next/05-cache-selfheal/diff.patch   # 补丁可应用性
diff -u p0-fix-next/05-cache-selfheal/before/ p0-fix-next/05-cache-selfheal/after/
```

`before/SHA256SUMS.txt` 与 `after/SHA256SUMS.txt` 可用来确认源码副本未被篡改。

### 5.7 回滚

见 `publish-seq21/ROLLBACK.md`：内含发布前现场四个文件的 `size`/`sha256`、现网序号
（`catalog.json` sequence=4、`native-manifest.json` sequence=20 / engine 44.9.0），
以及先只读核对、再备份到 D 盘、最后才动生产目录的分步命令。**该手册中的命令设计为由人执行**，脚本不写生产。

---

## 6. 有意不包含的内容

| 排除项 | 原因 |
|---|---|
| `*.zip`、`*.vhdx`、`*.7z`、`*.iso` | 二进制分发包，合计约 1.8 GB |
| `node_modules/` | 可重建，无归档价值 |
| `*.orig*`、`*.bak*`、`*.pyc`、`__pycache__/` | 编辑器/工具残留 |
| token、密钥、凭据 | 任何情况下不入库 |
| 微信相关路径内容 | 与本项目无关，且属禁区 |
| `publish-seq21/out/`、`dryrun/report-dryrun.json` 等运行产物 | 体量大且可重生成 |
| 未列入清单的中间产物（`_chk`、`_probe.json`、各类 `build*.log`） | 非交付内容 |

### 清单中声明但磁盘上不存在的三项（已核实缺失，未凭空补写）

| 清单项 | 实际情况 |
|---|---|
| `SEQUENCE21-RELEASE-NOTE.md` | 源目录 `D:\Codex\xjy-release-20261022\` 下无此文件 |
| `delivery-170-a17-employee\员工机-打通一键升级.md` | 该目录下只有 `员工一键升级-使用说明.md`、`员工一键升级.cmd`、`诊断-员工机.ps1`、`SHA256SUMS.txt` |
| `p0-bundle\` | 源目录下不存在该目录，也无 `apply-p0.cjs` / `manifest.json` |

---

## 7. 复现时的注意事项

1. **员工机验收仍是未完成项。** 本快照记录的是「生产主机已升级核验通过、员工侧待验收」的状态，
   不要据此宣布 1.7.0 已通过验收。
2. **`s6-*` 与 `publish-seq21/accept-check.cjs` 的默认路径是当时那台机器上的绝对路径**
   （`F:\自制软件\…`、`F:\鑫金源珠宝资料\…`、`D:\Codex\xjy-release-20261022\…`）。
   换机器复现必须显式覆盖参数。
3. **审计与优化报告是只读结论**，其行号指向 `candidate/build-*` 下的产物，不指向本分支里的文件；
   本分支 `before/` `after/` 副本仅对应 P0-5 涉及的 4 个 `.cjs`。
4. 生产目录 `F:\自制软件\xjy-jewelry-offline`、`F:\鑫金源珠宝资料\程序设置\员工升级` 按只读对待。

---

本阶段成果由 AI 助手（DeepSeek Harness）完成
Co-authored-by: DeepSeek Harness (AI assistant) <assistant@local>
