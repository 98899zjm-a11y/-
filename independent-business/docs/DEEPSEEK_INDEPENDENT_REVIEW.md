# 独立工程审查（DeepSeek 本人执行，只读）

审查对象：D:/Codex/xjy-business-standalone-20261023（独立开发版，不并入生产）。
审查方式：只读源码 + 只读 artifacts 日志 + 只读已存在的 docs。**未启动服务、未运行测试、未打开 Electron、未连接任何数据库**。所有“测试通过”均来自仓库里 Root 生成的 artifacts 日志，我核对了日志内容、用例数与其对应源码路径，但不等于我复跑。
范围：host/*.py、desktop/main.cjs、ui/*、tests/*.py、vendor/ledger 的 cashier_engine.py、erp_suppliers.py、erp_documents.py、erp_settlement.py、erp_common.py、erp_values.py、erp.py、cashier.py、cashier_schema.py、erp_schema.py、erp_ocr.py、erp_attachments.py、cashier_numbers.py、erp_numbers.py、vendor 前端 erp.js/cashier.js、vendor-agent 的 FEATURE_INVENTORY.md。

一条重要的过程事实：审查期间 host/app.py 从 319 行（revision cd1297…）变成 320 行（revision 29b524ef…），FEATURE_INVENTORY.md 与 test_values_review.py 也在变。下面所有行号对应我最后一次读到的版本；如果文件继续被改，行号需要重新核对。

## 结论先说

在已读范围内**没有找到 P0**：没有一个可被外部利用的绕过、没有能让资金总额变错、账目对不平、跨账套串库的缺陷。安全骨架（Host/Origin/CSRF/会话/角色注入/账套身份/路径纪律）经逐条核对是自洽的，不是靠前端隐藏按钮实现的权限。

阻断验收的**不是**上面那些，而是交付链路，定为 P1：ERP 端没有“发布收付依据”的界面入口，界面流程走不到出纳付款；Electron 冒烟三次都没有跑成功，脚本里“关闭后子服务退出、端口可重绑”两步一次都没执行；仓库没有任何提交，测试通过针对的是不断变动的瞬时快照。

所以：

- 对“仅虚构本地开发版、交付口径限定为 API 数据层”的验收：**不阻断**，但要附三条限定（见文末）。
- 对“可以演示的桌面/界面开发版”的验收：**阻断**，证据见 P1-1、P1-3。

## P0

无。

这不是安全背书：本次没有攻击复现，没有在真实 Electron 进程里跑页面，也没有做恶意 junction/硬链接的实际投放。P0 为空的范围仅限“源码层面能判定”的那部分。

## P1（阻断界面级验收，或使某条测试结论不成立）

**P1-1　ERP 端没有发布/撤回收付依据的界面入口，界面流程断在第 3 步。**
vendor/ledger/app/static/erp.js 全文没有出现 `cashier-source`；发布与撤回的接口只存在于 vendor/ledger/cashier_engine.py:339-341 与 vendor/ledger/erp.py 的路由表，前端没有调用点。cashier.js:41 只读 `/cashier/api/sources`，自己不能产生来源。docs/FEATURE_INVENTORY.md:157 也写了同一件事（那份文档写于 tests/ 出现之前，属独立发现，非抄它）。
最小复现：以 finance_reviewer 登录，复核一张采购单使应付成立，在 ERP 页找“发布到出纳”——没有；只能手工 `POST /erp/api/cashier-source-releases` 才能让出纳侧看到来源。
性质：功能缺口，不是越权。它让“11 条业务流程”只能在 API/测试层成立，不能作为界面可用的证据。

**P1-2　`/cashier/api/sources` 不按账户 scope、也不按单位过滤，与本项目其余范围隔离自相矛盾。**
cashier_engine.py:363-367 只做 `require('cashier.sources.read')` 与 `require('cashier.amounts.sensitive')`，然后 `SELECT ... FROM cashier_source_releases r JOIN erp_bills b ... WHERE r.status='published' ... LIMIT 200`，返回含 `outstanding_cents` 的全量已发布来源，payable 与 receivable 一起出。对照：单据列表是逐行按 scope 过滤的（cashier_engine.py:691-701），余额在无 `amounts.sensitive` 时不返回（:388-399），ERP 端对无敏感权限者直接隐藏 payable 行（erp_common.py:83）。
最小复现：建账户 A、B；只给 cashier_maker 授予 A 的 operate；用 finance_reviewer 给 B 相关账单发布收付依据；cashier_maker 请求 `/cashier/api/sources`，能读到 B 的未结金额。
定性：这是数据范围口径不一致。付款确实需要看到应付，所以不能直接判成漏洞；但它绕开了本项目自己确立的“按账户隔离”纪律，且与 ERP 侧隐藏策略相反，至少需要一条显式说明或按 scope 过滤。无对应测试。

**P1-3　桌面端与“父进程 EOF 后子服务退出”没有执行证据。**
三份 artifacts（desktop-smoke-first-failure.json、desktop-smoke-second-fixture-failure.json、desktop-smoke-report.json）记录了真实 Electron 的成功与失败：第一份已经通过“真实桌面登录页面”“真实表单登录与工作台”两项检查，然后停在 `locator('#erp-actor').filter({hasText:'admin'})` 30 秒超时，`pageErrors` 为空——说明窗口、登录、工作台都真渲染过，卡在 ERP 页身份条；第二份与最新一份都停在 `page.waitForURL('**/login')` 超时，原因是 Electron userData 持久化让第二次启动直接落在 `/`，脚本的“必须从 /login 起步”前置不成立。
后果：脚本后面两步（关闭应用、断言子进程退出与 31841 端口可重绑）**一次都没跑到**。实现本身是有的——desktop/main.cjs:11 先 `stdin.end()` 再等 exit、15 秒后才弹框且不强制杀；host/__main__.py:98-111 在 stdin EOF 后停 dispatcher、关 socket，:133-141 在 shutdown_errors 非空时 exit 3——但“实现存在”不能写成“已验证退出”。
另外 cashier 页与 ERP 页的启动失败成因，仅靠阅读无法定论：erp.js:169 在 bootstrap 失败时把身份条写成“请重新登录”，而冒烟卡在“没出现 admin”，pageErrors 又是空的，两种情况都符合现象。

**P1-4　WAL 快照测试名不副实，“恢复”没有经过账套重开。**
tests/test_snapshot_and_export.py:17-58 做的是：对活动库 `PRAGMA journal_mode=WAL`、BEGIN IMMEDIATE 当屏障、`source.backup(target)`、integrity_check/foreign_key_check、读一行金额、把编号保留文件复制并比较“复制件与原件 sha256 相等”、断言标识文件存在。:53-58 的“restore”只是把快照再 copy 成 restored.sqlite3，然后裸 sqlite3 读一行 29。
缺的正是最关键的三条：没有经 OwnedRuntime/create_app 重开、没有验 standalone_metadata 的 namespace 与 version、没有验编号续用。所以它证明的是“SQLite backup API 在 WAL 下能产出完整文件”，不是“账套可恢复”。这条不能作为恢复能力证据。

**P1-5　“23 方法 317 断言”这个数不可机器复核，且 unittest 正常运行不经过打印分支。**
tests/test_values_review.py:249-256 在 `if __name__ == '__main__'` 下打印 testsRun 与 `len(EXECUTED_ASSERTIONS)`，然后 `sys.exit(0 if result.wasSuccessful() else 1)`——断言条数只打印不断言；用 `python -m unittest` 跑时这段根本不执行。23 个 test_ 方法与 84 行含 assert 是我 grep 到的，可复核；317 这个数是作者自述。结论“全部通过”成立（artifacts/all-tests-second.log 里 36 tests OK 包含它们），但“317 断言”不能当证据用。

**P1-6　仓库没有任何提交，测试通过对应的是变动中的快照。**
分支 codex/erp-cashier-standalone 无提交，git status 全是未跟踪文件；.gitignore 排除了 runtime/、artifacts/、*.sqlite*、*.py[cod]、.env*、node_modules/、dist/、*.log（这一条本身是对的）。加上 P1-5 开头说的 app.py 在审查期间 319→320 行，意味着“36 tests OK”绑定的是一个无法复现的瞬时状态。要作为验收依据，至少需要一个提交号。

**P1-7　兼容层的安全守卫没有专门测试，只靠 import 顺序偶然触发（而它已经真的失败过一次）。**
host/compat.py:95-104 对未批准模块抛 `ImportError('Unapproved legacy module: …')`，:107-112 在 sys.modules 已含 legacy 名时抛 `RuntimeError('Legacy names are already imported; start this host in a clean Python process.')`。这正是此前“纯值测试提前导入 vendor 触发守卫、全测失败”的机制。手册式验证需要两条断言：干净进程 import 未批准模块必须被拒；已污染进程 install() 必须报错。现在一条都没有，只验证了“在正确顺序下能跑通”。

## P2

测试质量：
- tests/test_snapshot_and_export.py:60-76 的 XLSX 只断言 200、`startswith(b'PK')`、openpyxl 能打开且 sheetnames 非空。表头、金额、行数、合计都没验，属冒烟。
- tests/test_workflows.py:176-184 的页面断言只检查响应体里出现 `b'/standalone/bridge.js'`。ERP 页 JS 崩掉、身份条永远停在“请重新登录”，该断言照样通过。
- tests/ 无 `__init__.py`，`from host import …` 依赖当前工作目录为项目根；换目录跑 discover 会失败。
- artifacts/workflows-party-fix.log 里有一条 `vendor/ledger/cashier_schema.py:117: ResourceWarning: unclosed database`，触发器创建处连接未关，无功能影响但会污染日志。

出纳域细节：
- cashier_engine.py:663-683 的撤回分支只校验 `published` + revision，**不检查该来源是否已被资金单据引用**。已付款/已核销的来源也能撤回，结果是 revoked 来源 + 已确认付款并存。无资金错误（posting 已落、核销已落），但审计口径断裂，且 schema 层的 release 快照触发器只能挡 UPDATE/DELETE，挡不住这条业务路径。
- cashier_numbers.py:33-70 有“写前重读比较 previous 再 os.replace”的并发保护，erp_numbers.py:14-33 没有，只依赖调用方持有 BEGIN IMMEDIATE 且路径已由 `number_store()`→`checked()` 验过。当前调用链安全，但两个编号族的纪律不对称，后续有人直接调 ERP reserve 就会丢号。
- host/app.py:40-61 的 cashier_reviewer 能力用了一个嵌套条件表达式，布尔优先级导致它额外保留 `cashier.opening.prepare`（即期初资金由复核岗制单）。这可能是故意的，但表达式可读性差且无注释，容易被后来人“修”掉。
- vendor/ledger/cashier_runtime.py:9-30 自己 `from app import db` 建了一套 register，不在 host/compat.py 的 MODULES 里，host/app.py 也不用它（host 自己带 bridge 装配 engine）。属并行死代码，留着会误导“存在两套出纳装配”。

宿主与桌面：
- host/app.py:22 的 ASSETS 含 `standalone.css`，ui/ 下并不存在（实际有 shell.css）。死条目，无页面引用，跟 FEATURE_INVENTORY.md:160 的描述对不上。
- vendor/ledger/erp.py:53-57 的静态资源用 `send_file` 直出，没走 host 的 `ordinary()`；`/standalone/<file>`（host/app.py:245-259）走了。vendor 目录受版本控制且只读，风险低，但纪律不统一。
- host/app.py:301-309 的 `/auth/users` 允许 admin、finance_reviewer、cashier_reviewer 列出全部 active 用户（staffId/username/name/role）。这是“跨模块人员目录”，出纳复核能看到财务全员。无测试，也无界面调用。
- desktop/main.cjs:6-9 把 Python 解释器硬编码成 `C:\Python314\python.exe`；`启动独立开发版.cmd` 指向 `E:\珠宝销售软件\desktop\node_modules\electron\dist\electron.exe`。两者都是本机开发态，换机即失败——属未交付，不是缺陷，但不能当安装包能力。
- desktop/main.cjs:11 的 stop() 在 15 秒后弹框且明确不强制结束进程；如果用户忽略弹框，可能留下占用 31841 和 DB 锁的孤儿进程。
- waitress 通过 `create_server` 直接使用，没有钉版本（该包也没有可读的 `__version__`），复现性依赖环境。
- host/paths.py:28-30 的 ordinary() 每次调用都枚举父目录做大小写别名比对，并逐级 lstat/resolve；每个请求都走一遍，属性能债，未压测。

## 对你点名的问题，逐条回答

登录/CSRF/Origin/Host：Host 由 host/app.py:131-132 的 `TRUSTED_HOSTS=['127.0.0.1','localhost']` 约束（实测 Flask 3.1.3，该配置生效，且 :174 主动读 `request.host` 强制触发校验）；来源地址只允许回环（:176）；`Sec-Fetch-Site: cross-site` 直接拒（:178）；Origin 必须等于 `request.host_url.rstrip('/')`（:181-183），且**所有非 GET/HEAD/OPTIONS 必须带同源 Origin**（:184-186）；CSRF 仅认 `X-CSRF-Token`、`compare_digest` 比较、`/auth/login` 除外（:207-211，登录由 Origin + SameSite=Strict 覆盖）。未发现绕过。

角色注入：三处防线——actor 只来自数据库会话 JOIN 且 active=1（:191-199，请求体里的 actor 一律拒绝）；JSON 体递归扫描九个禁用键（:212-225），`/scopes` 只放行 staffId（:222-223），`/erp/` 出现 sourceSaleId 直接 400（:218-219）；能力由服务端角色表推导（:40-61），响应里的 user 不带 capabilities（:35-37）。下游还有第二道：出纳引擎 `require()` 自己复核 caps 与 access 的对应关系（cashier_engine.py:118-132），ERP 侧 `erp_values.require` 同构。

多 app 上下文/串库：不串。`compat.runtime()` 走 `current_app.extensions['standalone_runtime']`（compat.py:21-22），不是进程全局；`connect()` 每次重新 `owned.database()` 校验并再比 `standalone_metadata==(1,namespace)`（:29-46）；编号回调闭包里还有 `if compat.runtime() is not owned: raise`（host/app.py:153-160）。OCR 也按 app 分开（erp_ocr.py:22-24）。缺的只是“同进程并存两个账套”的实测。

父进程 EOF 后子服务退出：实现正确但未验证。见 P1-3。源码路径：host/__main__.py:98-111 读到 EOF 后停 dispatcher、`pull_trigger(close_sockets)`，:82-96 用 `shutdown(cancel_pending=False, timeout=10)` 并把残留线程记成 `worker-shutdown-timeout`，:133-141 据此 exit 3；desktop/main.cjs:11 先 `stdin.end()`。设计上不暴力杀、留 10 秒给在途请求，是对的。

symlink/junction/硬链接与 DB namespace：`ordinary()`（host/paths.py:12-36）逐级 lstat，拒 `S_ISLNK` 与 `st_file_attributes & 0x400`（重解析点/junction），普通文件 `nlink != 1` 拒（硬链接），父目录 iterdir 做大小写别名比对，最后要求 `resolve()` 与 normcase 原路径相等；`database()`（:83-87）把 `demo.sqlite3` 连同 `-journal/-wal/-shm` 一起过一遍；`checked()`（:76-81）每次先 validate 再判越界；`connect()` 还用 `?mode=rw` 的 URI，物理上不可能“顺便新建”一个库。缺口只有两处：ERP 编号文件的自查（P2 已列）、以及没有任何恶意 junction/硬链接的实际投放测试。

party_id 本轮最小补丁：正确。
写入侧 vendor/ledger/erp_suppliers.py:38-45 —— 新建供应商复用/插入 legacy `suppliers` 表拿到整数主键，写 `'SUP:'+str(sid)`；客户写 `'CUS:'+str(uuid.uuid4())`；编辑沿用原 id，不会改前缀。
读取侧 vendor/ledger/cashier_engine.py:56-70 —— `SUP:` 用 `re.fullmatch(r'SUP:[1-9][0-9]{0,18}')` 且 `int(...) <= 9223372036854775807`（19 位文本可超 int64，所以必须有这步）；`CUS:` 剥前缀后仍走严格 `uid()`；其余按裸 UUID 兜底，留给旧 fixtures 与已发布来源。
“未知 ID 仍按已发布来源验证”成立：解析只做格式归一化，不做存在性背书；真正的授权在 `validate_references()`（cashier_engine.py:535-547）里逐张比对 `release.status='published'`、`direction`、`party_id` 与单据 partyId 相等，再 `check_release()`（:549-552）比对 ERP 单据 confirmed/revision/frozen_hash/未冲销。格式合法但无来源、或来源属于别家的 partyId，都会在核销比对处被拒。
“不放宽单据 ID 校验”成立：同文件 :462-467 的 `releaseId=uid(...)`、:474 的 `targetId=uid(...)`、退款分支的 `originalCashDocId` 都仍是严格 UUID；`dispatch()` 的路径黑名单（:241）也没动。

付款与 ERP 核销是否同事务：是。`post()`（cashier_engine.py:563-584）在同一连接、同一 BEGIN IMMEDIATE 内：`create_erp_document()`（:602-613）直接落 ERP 单据、`settlement_bridge=accept_settlement` 落 `erp_allocations`+`erp_postings`，然后 :580-583 用 SQL 复查 `erp_postings`/`erp_allocations` 是否精确等于预期，不等就 409 `'财务桥未写入完整同事务核销，已停止资金记账。'`——失败即整笔回滚，不会留下“钱记了、账没核销”。tests/test_workflows.py:111-121 是这条的真断言（审核后余额 5000，并直连 sqlite 断言 postings 合计 94999、settlement 计数 1）。

并发超付与自审拒绝：自审拒绝有三层，出纳 `author == reviewer` 403（cashier_engine.py:512-520）、ERP 复核同规则（erp_documents.py:165）、对账复核同规则（cashier_engine.py:832），tests/test_workflows.py:123-126 覆盖 admin 审自己。超付在单事务内靠 BEGIN IMMEDIATE 串行 + `accept_settlement` 重读最新未结再判 409（erp_settlement.py:23-24），`validate_cash_timeline`/`validate_timeline` 再逐日卡 0<=余额<=上限。并发测试（test_workflows.py:160-174，两线程同一单据 → [200,409] 且余额 3000）只覆盖“同一单据被两人同时审”，**没有覆盖“两张不同单据同时核销同一张账单导致超付”**，后者靠代码推断，属未测项。

浏览器 bridge 是否漏 CSRF 或泄漏：不漏。ui/bridge.js:7-17 只在同源 + 非 GET/HEAD/OPTIONS + 路径命中 `^/(erp|cashier)/` 或 `/auth/logout` 时注入 `X-CSRF-Token`，token 从同源 `/auth/me` 取（:6，带缓存和失败清缓存），不写 cookie、不跨域、不发到第三方。它救了两处自相矛盾的前端：vendor 的 erp.js:150-151 发的是 `x-xjy-csrf`（宿主不认），cashier.js:21 干脆不发 CSRF 头——两者都必须靠 bridge 才能过校验。bridge 也没有遗漏的写入面：`/auth/login` 是公开路由，其余写操作全在 `/erp/`、`/cashier/`、`/auth/logout` 之下。另外 erp.js/cashier.js 全文没有 innerHTML/insertAdjacentHTML/outerHTML，全走 textContent，加上 CSP `script-src 'self'`，未发现存储型 XSS 汇点。

测试是否空转：主体不空转，也不算扎实。真断言的部分：付款/核销原子性（含直连 sqlite 复核）、幂等与改金额 409、跨模块 403、无 scope 空列表、未登录/无 CSRF/坏 Origin/body 注入 actor、并发双审、路径穿越 404。偏空转或过浅的：UI 只验字符串、XLSX 只验魔数、快照“恢复”不重开、断言计数只打印（P1-4、P1-5、P2 三条）。另外，测试全程用 Flask `test_client`，没有经过真实 waitress 线程模型，“4 线程 + BEGIN IMMEDIATE 忙锁→503”这条路径实际未被覆盖。

## 明确未测（不能写成通过）

Electron 真实界面全链路（三次冒烟无一次跑完，且失败在登录后 ERP 页）；关闭桌面应用后的子进程退出与 31841 端口重绑；完整安装包/安装流程；7 天自动备份；真实员工账号与正式合并；429 登录限流；8 小时会话过期与 active=0 踢出；`/auth/users` 的人员目录；`/cashier/api/sources` 的跨账户可见性；“已付款来源被撤回”的审计结果；两张单据并发核销同一账单的超付；同进程并存两个账套；OCR 503 降级路径（宿主把 `call_broker` 换成恒失败的 unavailable_broker，只验了能力探测返回 false，没验用户侧的失败文案）；附件落盘与 2MiB/扩展名/mime 校验；SQLite busy→503；bootstrap 大数据量 413；恶意 junction/硬链接的实际投放；`party_id` 的“格式合法但无来源”拒绝（现有单元只拒非法格式）。

## 三条限定

1. 说“36 个测试通过”可以，但必须同时说：它们跑在无提交的工作区上，且“317 断言”未经机器校验。
2. 说“安全骨架已核”可以，但必须同时说：这是源码级核对，没有攻击复现，桌面端未验。
3. 说“本地开发版可用”只能限定在 API/数据层；界面不得说成可用——ERP 端没有发布收付依据的入口，出纳侧拿不到新来源，第 3 步在界面上走不通。
