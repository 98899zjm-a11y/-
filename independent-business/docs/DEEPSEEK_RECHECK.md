# 第二轮独立复核（DeepSeek 本人执行，只读）

对象：D:/Codex/xjy-business-standalone-20261023，2026-10-23 06:29–06:36 期间的源码状态。
方法：只读源码 + 只读 artifacts 日志 + 只读 tests。未启动服务、未运行测试、未打开 Electron、未连接数据库、未改任何代码。所有“已通过”均为仓库内日志与用例源码的对照，不是我复跑的结果。
范围：第一轮七条 P1、四条 P2 的实修点，以及本轮改动是否引入新缺口。全文只写本文件。

## 一、第一轮 P1 逐条复核

**P1-1 财务发布入口缺失 —— 已解决。**
`host/app.py:258-267` 新增 `/finance-handoff`，先跑 `finance_authority(g._xjy_actor)`（`cashier_engine.py:135-141` 要求 module=ledger、protocolVersion=2、access=manage、caps 含 erp.read 与 erp.cashier.release），失败按 CashierError 的 status 返回。页面 `ui/source-releases.html` 自带 `/standalone/bridge.js`，所以 POST 会走 bridge 的 CSRF 注入（`ui/bridge.js:7-17`）；发布/撤回都打原来的 `/erp/api/cashier-source-releases`，由 `cashier_engine.py:340-342` 进 `release()`（`:665-684`），页面本身不写资金。`ui/home.html:3` 导航已挂“收付交接”。用例 `tests/test_workflows.py:159-169` 断言了真实发布、真实撤回、页面 200。桌面冒烟第 4 项也在真实 Electron 里点过发布与撤回。
残留（P2，不影响验收）：`ui/bridge.js:19-23` 注入到 /erp/ 与 /cashier/ 的导航条仍只有三个入口，`vendor/ledger/app/templates/erp.html` 里也没有去交接页的链接，财务人员从 ERP 页跳不过去，只能经工作台首页。

**P1-2 来源读取的范围 —— 部分解决，残留属业务政策而非缺陷。**
`cashier_engine.py:364-366` 现在先 `require(cashier.sources.read)`、`require(cashier.amounts.sensitive)`，再 `scope(c,a,uid(q.get('accountId')))`：不带 accountId 直接 400（`uid(None)`），无该项 scope 403。`cashier.js:33` 的 `query()` 统一带当前账户，`:41` 读来源。负例在 `tests/test_workflows.py:155-156`。
写入路径没有放宽：`tests/test_workflows.py:249-256` 用格式合法但不存在的 `SUP:777` 制单，得 409 且账单余额保持 10001，说明 party 仍由 `validate_references`（`cashier_engine.py:535-547`）逐条比对已发布来源；`uid()` 仍只用于 releaseId/targetId/originalCashDocId。
我按你给的政策记录结论：来源是财务发布的最小债务池，读取侧只做账户授权，不按单位过滤；这不再算缺陷。有两点留作**待业务决策**，不是现在要改的 bug：一是若要“按单位授权读取”，当前 schema 里没有 source-account 或 party-grant 关系，必须新加模型；二是 `cashier.amounts.sensitive` 现在能让无 `erp.reports.sensitive` 的出纳看到供应商应付的未结金额，而 ERP 侧 `erp_common.py:77-85` 对无该权限者隐藏 payable——出纳要给供应商付款，功能上需要，但双边可见性口径不一致，建议在正式版权限设计里对齐，而不是在开发版改。

**P1-3 桌面链路未验 —— 已解决。**
`artifacts/desktop-smoke-report.json`：`passed:true`，7 项全过（登录页、表单登录与工作台、ERP 供应商保存（走 CSRF 桥）、交接页真实发布与撤回、出纳建户、390px 截图、关闭桌面后子服务退出且端口可重绑），`pageErrors` 为空，22:27:00→22:27:11。前五份失败记录（first / second / third / fourth / before-handoff）都还在 artifacts 里，没有覆盖。第一轮“关停与重绑从未执行”的判断因此作废。
残留：跑的是 `启动独立开发版.cmd` 里 E 盘 node_modules 的开发态 Electron，不是安装包；这点不构成对本机开发版验收的阻断，但安装包依旧未验。

**P1-4 快照“恢复”名不副实 —— 已解决。**
`tests/test_snapshot_and_export.py:63-79` 现在建新账套目录、拷标识与 config、`create_app(restored_root)` 重开（`compat.connect()` 会重验 `standalone_metadata` 与 namespace），断言快照内单据在（:73）、快照后开的 2 号单不在（:74）、恢复后新单编号为 3（:79）。这正是我第一轮指出的三个缺口。
残留（与它自己的说法一致）：:68 拷的是**活动账套**的 config，所以证明的是“旧库配当前编号高水位”这条正确拼法，覆盖不到“只拿归档包恢复”时编号回退的场景。文中 :61-62 和用例名都没宣称一键覆盖恢复，我认可这个边界，不要求它现在实现。

**P1-5 断言口径 —— 已解决（口径），全测已补。**
`artifacts/all-tests-final.log` 已完成：`Ran 44 tests in 43.539s` / `OK`（我 06:32 读到 40 条 ok、尚无 Ran 行，06:33 复读为 44/OK）。构成：2 条导入守卫 + 2 条快照/导出 + 23 个数值方法 + 17 个流程用例。计数以 23 个数值方法为口径、不再把“317 断言”当验收依据，这条我接受。

**P1-6 未提交 —— 未完成，但按你的说明不据此否定已执行证据。**
`git log` 仍报该分支无任何提交，工作区全部 untracked；`docs/` 下没有 HANDOFF/TEST_REPORT。代码侧我按指示不做扣分，只保留一个流程事实：现在所有通过证据绑定的是一个仍在变动、无法用 commit 号固定源码的工作区。要让它成为可复核结论，冻结后跑一次全测并把 commit 号写进 HANDOFF 即可，不需要改代码。

**P1-7 加载器守卫无负控 —— 已解决。**
`tests/test_import_guards.py:12-26` 用 `subprocess` 起真新解释器验证两条：未批准 legacy 模块抛 `Unapproved legacy module`、预载 `sys.modules['app']` 抛 `Legacy names are already imported`。这确实是真负控。残留（P2）：`compat.py:95-104` 里 `desktop_*` 前缀分支、以及 `connect()` 遇到 namespace 不符的拒绝，仍没有新进程级负控，靠流程内用例间接覆盖。

## 二、P2 实修核对

已修且有据：`host/app.py:178-182` 对 `/erp/static/*` 与 `/cashier/static/*` 的允许名逐个跑 `ordinary()`（比 vendor 侧 `erp.py` 的 send_file 更早拦）；`host/app.py:324-331` `/auth/users` 收紧为仅 admin，并有 `tests/test_workflows.py:145-147` 的 403 与 5 人正例；`host/app.py:22` 白名单已去掉不存在的 `standalone.css`、加入 `source-releases.js`；`requirements.txt` 五行钉版，我逐一比对了本机已装版本（Flask 3.1.3 / Werkzeug 3.1.9 / Jinja2 3.1.6 / waitress 3.0.2 / openpyxl 3.1.5），完全一致。未批准 vendor 源码仍留在目录里但不在 allowlist 执行，符合“保留不执行”。

仍存（都不阻断本机开发版）：撤回不检查该来源是否已被资金单据引用（`cashier_engine.py:671-674`），会造成“已撤回来源 + 已确认付款”并存，无资金错误；XLSX 用例仍只验 `PK` 魔数与 sheet 数（`test_snapshot_and_export.py:81-97`），不验表头/金额/行数；UI 用例仍是字符串包含断言（`test_workflows.py:194-202`）；`cashier_schema.py` 建触发器那条连接未关（跑全测时的 ResourceWarning）；`erp_numbers.reserve` 无写前重读比较，与 `cashier_numbers.py:66-69` 不对称；`host/app.py:55-57` 的布尔优先级让 cashier_reviewer 也保留 opening.prepare；`ordinary()` 每请求枚举祖先目录；`desktop/main.cjs` 硬编码 `C:\Python314\python.exe`。

## 三、本轮改动引入的三个新缺口（均 P2）

1. `/finance-handoff` 与 `/integration/api/releases` 共用一个视图（`host/app.py:258-260`）。非财务角色访问**页面**得到的是 JSON 403，而 `:209` 的 GET 重定向清单里没有这个路径，会话过期时页面返回 JSON 401 而不是跳登录。功能不坏，观感与一致性欠一层。
2. `/integration/api/releases` 是纯读，却走 `compat.transaction()`（`host/app.py:268`），即 BEGIN IMMEDIATE。每次打开交接页都抢一次写锁，4 线程 Waitress 下会挤压并发的资金事务。改成只读连接即可。
3. 交接页在 `/erp/` 内不可达（见 P1-1 残留），bridge 导航条少第 4 个入口。

## 四、阻断判定

P0：无。两轮都没找到外部可利用的绕过，也没找到能让金额或账目变错的缺陷。本轮改动没有削弱任何既有校验——`finance_authority` 是新增的更强前置，`sources` 是收紧而非放宽，静态资源校验是新增而非替换。

阻断“本机虚构开发版”验收的 P1：无。前七条里五条已解决，两条落成“策略已说明 + 待业务决策”，都不影响虚构数据下的验收结论。

唯一未闭合项是流程性的，不是代码：源码未提交、无 commit 号可绑定，HANDOFF/TEST_REPORT 尚未写。要么按计划冻结提交后重跑并把 commit 号记进去，要么在结论里始终标注“证据绑定 2026-10-23 06:33 的未提交工作区”。我建议前者，代价是一次重跑。

商业正式版仍然不成立的边界，与上轮一致且不因本轮改动移动：安装包与跨机部署、7 天自动备份、真实员工账号、与销售正式版的合并（来源接入、账套迁移、权限合并）、真实 OCR 服务、多进程（非线程）并发、断电级 WAL 恢复。代码在能拒绝的地方是拒绝的：`sourceSaleId` 400（`host/app.py:223`、`tests/test_workflows.py:204-208`）、OCR 恒 503（`host/app.py:166-169`）、连接只开 `mode=rw` 不建库（`compat.py:29-46`）、只认本机与 localhost。

## 五、更新后的未测项

Electron 安装包与跨机安装；7 天自动备份与清理策略；正式合并所需的销售来源接入与账套迁移；真实员工账号与权限变更流程；真实 OCR 服务（当前必 503）；多进程并发与 SQLite 忙锁 503 路径；429 限流恢复与会话过期重登的界面表现；交接页超过 500 条时的 413 分支；附件上传与原件完整性全链路；非 UTF-8 银行原件；断电级恢复（现有只是 backup 演练）。

一句话：第二轮之后，阻断“本机虚构开发版”的东西已经没有了，剩下的要么是三条 P2 打磨，要么是必须靠冻结提交才能钉住的证据时效。
