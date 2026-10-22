# 独立宿主适配边界

此目录只服务本工程 `runtime` 内带有独立演示标识的新虚构账套。不得用于正式数据库、正式宿主配置或部署。Python 3.14，当前已有 Flask 3.1.3、Werkzeug、Jinja2、Waitress；原 ERP Excel 导出使用已有 openpyxl。未新增第三方依赖。

`create_app(root)` 创建应用，`seed_demo_users(app, credentials)` 是仅供可信 Python/CLI 调用的一次性虚构人员初始化接口，返回用户名到 staffId 的映射。HTTP 不能初始化人员或选择数据库。`python -B -m host --demo-init --init-only` 明确初始化新演示账套；随机口令仅写该账套 runtime 文件。常规 `python -B -m host` 用 Waitress 绑定 `127.0.0.1:31841`，不启用调试。所有宿主新文件、运行数据、编号保留文件及临时文件均在本 D 盘工程中。源码不含演示固定口令。

## 角色与身份

| 角色 | 财务 ERP | 出纳 | 账户管理 |
| --- | --- | --- | --- |
| finance_maker | 读取、往来维护、制单、报表及敏感成本；无复核 | 无 | 无 |
| finance_reviewer | 读取、往来维护、复核、报表及敏感成本；可发布出纳业务来源；无业务制单 | 无 | 无 |
| cashier_maker | 无 | 读取、一般收付/退款/调拨/冲销制单、对账导入匹配、报表；无复核和期初制单 | 无 |
| cashier_reviewer | 无 | 读取、各类复核、期初制单、报表；无一般业务制单和对账导入匹配 | 无；原引擎另要求 admin |
| admin | 财务全部能力，包括来源发布 | 出纳全部能力 | 可开户及显式授予账户范围 |

各出纳账户仍需原引擎的显式人员范围授权。管理员开户时原引擎只向该创建者授予 manage；其他人不会隐式获得账户访问。所有角色均保留原引擎的双人复核和禁止自审规则。`cashier.opening.prepare` 在原引擎属于 manage 能力，因此放在 reviewer/admin；实际期初复核仍由另一有资格人员完成。

服务端由固定用户表构造 ERP 协议 v2 与出纳协议 v3 身份。请求 JSON 无权指定 actor、能力或数据路径；账户范围接口的 staffId 仅指定被授权人。原引擎从 allowlist 中的明确 `.py` 源码加载；不扫描旧 pyc，不导入原 app/repairs/desktop 主机运行时。`app.db/config`、`repairs.transaction`、`erp_runtime` 由窄适配模块提供，通过 `current_app` 取得当前账套；不使用全局环境变量指定账套。

ERP 与出纳复用同一虚构 SQLite；出纳调用原 `erp_settlement.accept_settlement` 与 `accept_cashier_reversal`，保留原子记账、分配、时间线和冲销算法。最小兼容表只有 suppliers/audit_logs；没有 sales 表，不伪造销售来源。ERP 正文带 sourceSaleId 明确返回 400，提示手工建立应收并经复核。未来销售合并需要另行实现和验证。独立 OCR 明确不可用，不读取环境中的正式 OCR broker 凭据。

登录为 `POST /auth/login {username,password}`，返回用户及 csrfToken。`GET /auth/me` 返回当前用户及 csrfToken；`POST /auth/logout` 撤销服务端 session。cookie 仅保存随机 token，数据库保存其 SHA-256；HttpOnly、SameSite=Strict、8 小时有效，HTTPS 时设置 Secure（本地 HTTP 不设置）。登录/注销/失败/限速事件写不可改删的认证审计。写请求要求同源 Origin；登录后还需 X-CSRF-Token。Host 和来源受限，本机外 IP 被拒绝。

## 真实验证记录（2026-10-23）

1. 登录 200，ERP 与出纳 bootstrap 均 200；无 CSRF 注销 403。
2. 17 项隔离检查通过：坏 Origin、缺 Origin、错 CSRF、坏 Host、非回环 IP、错凭据、应用 A/B 身份绑定、嵌套 actor 注入拒绝、往来写入成功、A 写入不影响 B、首页及两个模块页正常、bridge 注入、session 到期拒绝、大小写路径别名拒绝、非空未知目录拒绝、owner 硬链接拒绝。
3. Windows 实际创建 junction 和 symlink，均被拒绝。测试工件均位于本工程 runtime。
4. 运行中将数据库换成另一虚构账套文件，下一次 connect 因 namespace 不匹配拒绝；放回原文件后恢复连接。数据库移走后 `mode=rw` 拒绝，不自动新建空库。
5. 4 项角色回归通过：admin 开户 200；cashier_maker、cashier_reviewer、finance_reviewer 开户均 403。另验证 admin 显式授予 cashier_maker operate 范围 200。
6. CLI `--demo-init --init-only` 已实际建立五个随机口令虚构账户，没有启动后台服务。

## 桌面子进程握手与关闭

CLI 可选 `--parent-watch`，仅供独立开发桌面创建自己的 Python 子进程。Waitress `create_server` 成功绑定并监听 `127.0.0.1` 后，stdout 立即 flush 一行 JSON：`{"type":"ready","port":31841,"namespace":"当前演示账套UUID","pid":1234}`。其中仅含公开进程/账套标识，没有口令或 session；桌面应与其创建的子进程 PID、指定端口和账套 owner namespace 精确匹配后再打开页面。绑定失败不输出 ready，不使用端口轮询或连接已有服务冒充启动成功。

`--parent-watch` 的 stdin 只观察父管道存活，不接受命令；EOF 后工作线程 dispatcher 执行 `shutdown(cancel_pending=False, timeout=10)`，随后通过 Waitress trigger 正常关闭本服务的监听和连接。只操作此次创建的私有 socket map，不查询、终止或接管其他正式进程。普通 CLI 无监控线程，仍可 Ctrl+C 正常停止。退出码：正常关闭为 0，绑定/运行异常为 1，关闭失败或工作线程 10 秒未退出为 3；参数格式错误沿用 argparse 的 2。父管道观察线程为 daemon，EOF 正常路径会结束并 join，异常退出不会因仍打开的父 stdin 挂住子进程。

真实子进程验证：成功 ready 的 port/namespace/pid 与创建参数及 owner 标识完全一致，随后 `/login` HTTP 200；关闭父 stdin 后约 0.03 秒以 0 正常退出，原端口可立即重新绑定。刻意占用端口后再启动同命令，子进程退出 1 且 stdout 没有 ready。没有使用终止进程命令。

保留的失败及修复：第一次往来写入暴露原 ERP 还依赖 audit_logs，已补最小兼容表和不可改删触发器；第一次端到端开户暴露服务端 actor 缺 role，已补固定用户表 role，随后上述账户及范围回归通过；Host 验证最初可能被未登录响应覆盖，已在访问数据库前显式触发 TRUSTED_HOSTS 校验。未改原业务规则、没有放宽断言。完整业务流、并发、恢复和浏览器验收由根任务另行记录；此处组件与接口检查不代表安装、上线或正式业务验收。
