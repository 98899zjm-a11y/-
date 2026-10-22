# 最终签署（DeepSeek 本人执行，只读）

对象：D:/Codex/xjy-business-standalone-20261023，冻结提交 e8f7d9b62f681cde680bb9e57ac1ad7ea1f30e3c。
范围：只复核第二轮后三处 P2 的最小 diff 与最新 artifacts 日志，不重扫全项目、不调用其他模型、未改任何代码、未触碰 runtime/ 与 F 盘。工作区干净（`git status` 无输出），我读到的字节就是提交里的字节。

## 三处修复的实际确认

1. `host/app.py:209` 的未登录重定向清单已含 `'/finance-handoff'`，与 `'/'`、`'/erp/'`、`'/cashier'`、`'/cashier/'` 并列。会话过期时打开交接页现在跳登录，不再吐 JSON 401。改的是一行字符串集合，没碰认证判定顺序。
2. `/integration/api/releases` 已从 `compat.transaction()`（BEGIN IMMEDIATE）改成 `compat.connect()` + `try/finally: connection.close()`，并在返回前补 `owned.database()` 复验路径。纯读不再抢写锁，同时保留了账套路径的二次校验——这比原来只靠事务更明确，功能等价且更轻。
3. `ui/bridge.js:23` 在 identity() 成功后按 `me.role` 为 `finance_reviewer`/`admin` 插入“收付交接”链接；`ui/home.js` 对其余角色把 `a[href="/finance-handoff"]` 置 hidden。我查了 `ui/workbench.css`：`.side nav a` 只设了 padding/border-radius，没写 display，因此 `hidden` 的原生 `display:none` 生效，不会被样式覆盖掉。服务端 `finance_authority` 仍是唯一权威，前端隐藏只是不给人死路。

三处都没动金钱算法、来源池政策、权限模型与任何 vendor 文件。

## 证据（我逐份打开核对，未复跑）

`artifacts/all-tests-committed.log`：44 条 `... ok`，`Ran 44 tests in 46.157s`，`OK`。`TEST_REPORT.md` 里引的是 `all-tests-frozen.log`（41.705s），是另一次同口径运行，两次都是 44/0 失败。
`artifacts/values-count-verified.log`：`测试方法数: 23`、`断言实际执行次数: 317`、失败/错误/跳过全 0。317 现在是运行器计数器的实跑输出，不再是作者自述；需要说明它的性质——统计的是被插桩拦截的 assert 调用次数，属工具自计数，不是第三方审计，所以它证明“这些断言确实被执行过”，不额外证明断言语义正确（语义由用例本身和我前两轮的逐条阅读负责）。
`artifacts/http-smoke-report.json`：两笔 70 元并发收同 100 元应收，仅一笔成功、另一笔 409、余 30 元，`serverExit: 0`。
`artifacts/desktop-smoke-report.json`：7 项全过，`pageErrors: []`，含关停后端口重绑。
冻结：两个提交，`6919c3d` 功能树 + `e8f7d9b` 字节保真；`.gitattributes` 为 `* -text`，即禁用换行转换，vendor 与启动器按原始字节入库。这解决了第一轮“无 commit 可绑定”的问题。

## 判定

**阻断本机虚构开发版的 P0：无。** 两轮半审查里没有任何一处能让外部绕过身份、跨账套读写、或让资金总额/账目在事务外失配。

**阻断本机虚构开发版的 P1：无。** 第一轮七条已在第二轮五解二降级，本轮三条 P2 修复经 diff 复核成立，且没有引入新的写路径或放宽任何校验。

可以成立的说法（限定在本机、虚构数据、开发态）：11 条业务流程与 44 项自动化在同一提交上通过；并发超额在 HTTP 与线程两层都被拒；付款与 ERP 核销同事务且有落库后复查；桌面端真实 Electron 走完发布/撤回/开户/关停；快照恢复是重开账套而非裸读文件。

不能据此成立的说法：正式商业版。安装包与跨机部署、7 天自动备份、真实员工账号与权限变更、与销售正式版的合并（来源接入、账套迁移、权限合并）、真实 OCR 服务、多进程（非线程）并发、断电级恢复——全部未验，且测试报告与 HANDOFF 的措辞已经守住这条线。

## 保留的 P2（不阻断验收，建议进 BACKLOG 而非现在改）

撤回仍不检查来源是否已被资金单据核销（`vendor/ledger/cashier_engine.py` 的 release 撤回分支），会产生“已撤回来源 + 已确认付款”并存，无资金错误；XLSX 用例只验 `PK` 与 sheet 数，报告已自称“空表结构冒烟”；UI 用例仍以字符串包含为准；`cashier_schema.py` 建触发器那条连接未关，全测时有 ResourceWarning；`erp_numbers.reserve` 无写前重读比较，与 `cashier_numbers.py` 不对称；`cashier_reviewer` 的布尔优先级顺带保留了 `opening.prepare`；`ordinary()` 每请求枚举祖先目录，大数据量下是性能项；`desktop/main.cjs` 硬编码 `C:\Python314\python.exe`，换机即失效。

## 一句话

在 e8f7d9b 上，本机虚构开发版没有未关闭的 P0/P1；剩下的都是打磨项与明确标注未做的正式版边界。签署有效范围仅限本机、虚构数据、提交 e8f7d9b，超出该范围需重新验。
