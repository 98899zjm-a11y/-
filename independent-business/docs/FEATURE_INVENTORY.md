# 鑫金源独立业务工作台 · ERP 与出纳功能盘点

盘点对象：`D:/Codex/xjy-business-standalone-20261023`。
编写方式：只读静态阅读 `AGENTS.md`、`PROJECT_CONTEXT.md`、`host/*.py`、`vendor/ledger/*.py`（19 个模块、3436 行）、`vendor/ledger/app/templates`、`vendor/ledger/app/static`、`ui/*`、`vendor-manifest.json`、`artifacts/deepseek-tasks.json`。

边界声明：
- 未启动应用、未连接数据库、未运行任何测试、未访问 F 盘、未读取任何真实业务数据；`runtime/` 只看到目录结构，未打开其中的 sqlite3 与口令文件。
- 本文的"已实现"只表示代码路径完整可读，不表示运行通过。第 9 节集中列出未实际测试的项目。
- 行号对应 2026-10-23 工作副本，后续改动需重新核对。

---

## 1. 工程构成

| 路径 | 内容 | 规模 / 说明 |
| --- | --- | --- |
| `host/app.py` | Flask 宿主：登录、会话、CSRF、本机限制、身份组装、路由装配 | 约 320 行，17933 字节 |
| `host/compat.py` | 源码级适配：`app`/`repairs`/`erp_runtime` 替身模块、vendor 导入器、`connect`、`transaction` | 123 行 |
| `host/paths.py` | 路径归属与隔离：禁止符号链接、目录联接、硬链接、大小写别名、路径重定向 | 87 行 |
| `host/__main__.py` | `--demo-init` 显式建虚构人员、`--init-only`、waitress 仅监听 127.0.0.1 | 59 行 |
| `vendor/ledger/erp*.py` | ERP 领域层（11 个模块） | 见第 4 节 |
| `vendor/ledger/cashier*.py` | 出纳领域层（7 个模块） | 见第 5 节 |
| `vendor/ledger/ocr.py`、`erp_ocr.py` | OCR 导入服务与 ERP 适配 | 309 + 30 行 |
| `vendor/ledger/app/templates` | `erp.html`（29051 字节）、`cashier.html`（5231 字节） | 原领域页面，未改动 |
| `vendor/ledger/app/static` | `erp.js` 64517 字节、`cashier.js` 21585 字节、`app.css`、`erp.css`、`cashier.css`、`workspace.css`、`xjy-shell.js`、`xjy-theme.css` | 原领域前端，未改动 |
| `ui/` | `login.html`、`login.js`、`home.html`、`home.js`、`bridge.js`、`workbench.css` | 独立工作台外壳 |
| `tests/`、`scripts/`、`docs/` | 编写本文前为空 | 无自动化测试、无脚本 |
| `desktop/` | 不存在 | `AGENTS.md` 提到的目录尚未建立 |
| `artifacts/deepseek-tasks.json` | docs 与 values 两个子会话的受理记录 | 非业务数据 |
| `runtime/` | `host-smoke`、`host-cli-smoke-*`、`host-isolation-*`、`host-db-swap-*` 等隔离试运行残留 | 目录名提示做过隔离/库替换手工试验，无断言与报告留档 |

`vendor-manifest.json` 记录来源：销售维护源码 `E:/codex/2026-10-15/work/xjy-v16-deep-audit`，`sourceHead=1e63eb8`，仅选取源码，不含数据库、正式配置、客户资料。

---

## 2. 运行方式（读代码得出，未执行）

- 入口：`python -m host --demo-init [--init-only] [--root runtime/<账套>] [--port 31841]`。
- 默认账套 `runtime/demo`，必须在 `runtime/` 之下且不等于 `runtime`（`host/paths.py:42-43`）；首次运行写入 `.standalone-demo.json`（`version/purpose/namespace`），拒绝接管非空或未标识目录（`host/paths.py:49-54`）。
- 初始口令随机生成，写入 `runtime/<账套>/demo-credentials.json`，已存在则拒绝覆盖（`host/__main__.py:36-42`）。
- 未显式 `--demo-init` 且无账户时直接报错退出（`host/__main__.py:47-48`）。
- 服务仅绑定 `127.0.0.1`，waitress 4 线程（`host/__main__.py:53-55`）。
- `TEMP`/`TMP`/`tempfile.tempdir` 指向账套内 `temp/`（`host/__main__.py:27-31`）。
- 数据库固定为 `runtime/<账套>/data/demo.sqlite3`，以 `mode=rw` 打开，缺库不会被当成新账套（`host/compat.py:29-46`）。

---

## 3. 身份、角色与权限现状

### 3.1 会话

- Cookie `xjy_demo_session`，43 字符 urlsafe token，库内只存 sha256；会话 8 小时（`host/app.py:20,23`）。
- 登录：`POST /auth/login {username,password}`，返回 `{ok,user{staffId,username,name,role},csrfToken}`；失败次数 5 次/300 秒触发 429。
- 身份只来自 Cookie，不从请求头、查询串或请求体读取。

### 3.2 两类 actor

`_actors(user)`（`host/app.py:40-61`）同时组装两套身份：

```
ERP   : {protocolVersion:2, module:'ledger', access:'operate'|'manage', capabilities:[...], staffId, name, role}
出纳  : {protocolVersion:3, module:'cashier', authorityModule:'cashier', storageModule:'ledger',
         access:'operate'|'manage', capabilities:[...], staffId, name, role}
```

- ERP 能力清单 15 项，定义在 `vendor/ledger/erp_values.py:61`。
- 出纳能力清单 19 项，定义在 `vendor/ledger/cashier_engine.py:19-24`。
- 出纳 `require()` 额外要求 `authorityModule=='cashier'`、`storageModule=='ledger'`，并明确禁止 actor 携带 `accountIds` / `scopeRevision`（管理员不等于出纳，`cashier_engine.py:101-115`）。

### 3.3 五个角色实际拿到的能力

| 角色 | ERP | 出纳 |
| --- | --- | --- |
| `finance_maker` | `operate`；CAPS 去掉所有 `.review` | 无 actor |
| `finance_reviewer` | `manage`；CAPS 去掉所有 `.prepare`，并追加 `erp.cashier.release` | 无 actor |
| `cashier_maker` | 无 actor | `operate`；CAPABILITIES 去掉 MANAGE 集合（即去掉全部 `.review`、`cashier.accounts.manage`、`cashier.opening.prepare`） |
| `cashier_reviewer` | 无 actor | `manage`；CAPABILITIES 去掉 `.prepare` 与 `cashier.reconcile.import`/`cashier.reconcile.match`，但因布尔优先级额外保留 `cashier.opening.prepare`（`host/app.py:55-57`） |
| `admin` | 两套全量 + `erp.cashier.release`，`manage` | 两套全量，`manage` |

由此产生一个需要业务确认的行为：**期初资金凭证只能由出纳复核角色制单**（`cashier_maker` 没有 `cashier.opening.prepare`），再由另一名具备 `cashier.opening.review` 的人审核。是否符合预期未确认。

### 3.4 双人复核是真实约束

- ERP：`review()` 判断 `old['author_id']==actor['staffId']` 直接 403 "不能复核自己编制的单据"（`vendor/ledger/erp_documents.py:165`）。
- 出纳：资金凭证审核同样按作者回避（`cashier_engine.py:496`），对账复核/解除同样（`:815`）。
- 审核前必须重算 `frozen_hash` 并与库内值比对（ERP `erp_documents.py:167-168`；出纳 `cashier_engine.py:497-498`）。
- 前端隐藏按钮不构成权限，后端 `require()` 是唯一闸门；`erp.js` / `cashier.html` 的 `data-requires` 只是展示控制。

---

## 4. ERP 功能盘点

### 4.1 已实现

| 功能 | 结论 | 关键位置 |
| --- | --- | --- |
| 往来单位（供应商/客户）建档、修改、停用 | 已实现；无删除，只能 `active=0` | `erp_suppliers.py:11-47`；供应商同时回写宿主 `suppliers` 表，ID 为 `SUP:<id>` |
| 采购单 | 已实现；`businessType` 为 `own`/`consignment` | `erp_documents.py:33-39,92-111` |
| 多商品明细 | 已实现；每单 1-100 行 | `erp_documents.py:36` |
| 分批收货 | 已实现；按采购行累计件数校验，不超订购量 | `erp_documents.py:40-53,148-156`；时间线校验 `erp_settlement.py:13-17` |
| 应付生成 | 部分实现：仅 `own` 采购的收货复核通过后生成 payable；consignment 不生成；采购单本身不生成 | `erp_documents.py:157` |
| 应收、期初应收、期初应付 | 已实现；复核通过生成 bill | `erp_documents.py:54-59,173-179` |
| 应收关联原销售行 | 代码存在，但独立版宿主显式拒绝（见 6.2） | `erp_documents.py:58-59,176-178`；`host/app.py:218-219` |
| 收付款与分次核销 | 已实现；1-100 张 bill，可部分核销，合计必须等于单据金额，含倒填日期校验 | `erp_documents.py:60-74`；`erp_settlement.py:19-34` |
| 冲销 | 已实现；另建 reversal 单据，不改原单状态，展示层派生 `reversed` | `erp_settlement.py:41-81`；`erp_common.py:53,56` |
| 报表 | 已实现；截至日余额、5 段账龄、收付款流水、采购列表 | `erp_reports.py:94-191` |
| XLSX 导出 | 已实现；金额写两位小数精确文本，≤5 万行 | `erp_reports.py:201-258` |
| 附件 | 已实现；单文件 ≤2MiB，仅 PNG/JPEG/PDF 且校验真实签名 | `erp_attachments.py:24-25,42-121` |
| OCR 识别入口 | 路由与流水线完整，但宿主把 broker 换成恒 503（见 6.5） | `erp.py:118-136`；`ocr.py`；`host/app.py:167-169` |
| 审计事件 | 已实现；`erp_events` + 宿主 `audit_logs` 双写 | `erp_common.py:26-30` |
| 不变量保护 | 已确认单据、可确认单据的明细、bills/postings/allocations/receipt_quantities/reversals/sale_sources 均由触发器禁止改删 | `erp_schema.py:55-72` |

### 4.2 缺失或受限

- 无结账/期间关账；无多币种（人民币单一）；无税票、发票、申报。
- 无自动收入确认、无库存扣减、无银行直连、无付费 AI。
- 无采购关闭/结案状态；剩余可验收量只在单据详情临时计算（`erp_common.py:61-64`）。
- 无草稿删除、无 `pending` 撤回、无已确认单据更正（只能冲销）。
- 无列表分页：`bootstrap` 全量返回，超过 50000 单或 20MB 直接 413（`erp.py:59-71`），源码注释自认需要服务端分页。
- 收货只校验累计件数，不校验本次收货金额是否超过采购单剩余金额（`erp_documents.py:52,153`）；该约束是否需要收紧未经业务确认。
- 无打印/PDF 单据、无供应商对账单、无付款计划。
- 审批只有单人复核（作者回避），无多级、无会签。

---

## 5. 出纳功能盘点

### 5.1 已实现

| 功能 | 结论 | 关键位置 |
| --- | --- | --- |
| 账户 | 已实现；仅 `cash`/`bank`，币种硬锁 `CNY`；仅管理员可建 | `cashier_engine.py:384-421`；`cashier_schema.py:9-13` |
| 账户级授权 | 已实现；`disabled`/`view`/`operate`/`manage` 四级，带 revision 乐观锁 | `cashier_engine.py:400-421,400`；`cashier_schema.py:14-17` |
| 期初余额 | 已实现；只能由两人确认，且账户已有流水时不可再设 | `cashier_engine.py:524-530`；`validate_references` |
| 收款 / 付款 | 已实现；必须核销已发布的财务来源，分配合计等于资金金额 | `cashier_engine.py:443-450,550-567` |
| 退款 | 已实现；校验原单已确认、同账户同单位、未被冲销、不早于原单、累计不超可退金额 | `cashier_engine.py:570-580,629-644` |
| 调拨 | 已实现；两个不同账户，一负一正 | `cashier_engine.py:568-569` |
| 资金冲销 | 已实现；原单须已确认、无退款、未对账锁定；连带冲销 ERP 侧核销 | `cashier_engine.py:598-627` |
| 流水与余额报表 | 已实现；日 opening/closing/收/付/已对账 | `cashier_engine.py:686-710` |
| CSV 导出 | 已实现；≤1 万行，含 UTF-8 BOM | `cashier_engine.py:703-707` |
| 银行账单导入 | 已实现；原件按 sha256 存 BLOB 去重，外部流水号唯一，预览哈希复核，≤10MiB/1 万行/50 列 | `cashier_engine.py:712-760` |
| 对账 | 已实现；同账户、同符号金额、差额必须为零；复核后写锁，可撤销 | `cashier_engine.py:781-828` |
| 幂等结果查询 | 已实现；`GET /cashier/api/requests/<uuid>` | `cashier_engine.py:316-321` |

### 5.2 缺失或受限

- 无结账/期间关账；无多币种；无出纳附件；无票据/支票管理；无发票；无预算。
- 账户无删除，只能 `active=0`；账单导入无删除；对账单无导出（只能下载原始件）。
- `statement-imports/preview` 不写入幂等记录（`cashier_engine.py:238`），只靠 `previewHash` 复核。
- 分页语义不一致：`documents` 用 rowid 游标，`report` 用行下标（`cashier_engine.py:676,709`）。
- `documents` 的 `status`/`kind` 过滤是裸字符串比较，未做枚举校验（`:679`）。

---

## 6. 跨模块与已知断点

1. **财务发布到出纳没有前端入口**。后端 `POST /erp/api/cashier-source-releases` 与 `.../<uuid>/revoke` 存在（`cashier.py:108-109`），但 `erp.js`、`cashier.js` 均未调用；目前只能靠 API 手工发布。是否可在界面上完成未验证。
2. **销售来源在独立版被宿主拦截**。`host/app.py:218-219` 对 `/erp/` 请求体出现 `sourceSaleId` 直接 400；账套也不建 `sales` 表（`erp_schema.py` 无）。vendor 内的 `source_fingerprint` 查询 `sales` 的分支不会在独立版生效。
3. **首页出纳计数恒为 0**。`ui/home.js:11` 读 `/cashier/api/bootstrap` 的 `documents` 字段，该接口只返回 `accounts/capabilities/currency/actor`（`cashier_engine.py:371-383`）。
4. **样式文件缺失**。`host/app.py:22` 白名单包含 `shell.css`、`standalone.css`，`host/app.py:234-235` 向 `/erp/`、`/cashier` 注入 `/standalone/shell.css`，但 `ui/` 下这两个文件不存在；页面会引用到取不到的资源。具体返回码未运行确认。
5. **OCR 不可用**。`host/app.py:167-169` 用恒抛 `OcrError 503` 的 broker 替换了识别调用，UI 仍保留识别入口与"可手工录入"提示。`ocr.py` 依赖 `XJY_MODULE_OCR_PORT`/`XJY_MODULE_OCR_TOKEN`。
6. **两个出纳模块未接线**。`cashier_runtime.py` 顶部 `from app import db`，而 `vendor/ledger/app/` 只有 templates/static、无 `__init__.py`，它是死代码；`cashier_maintenance.py` 依赖不存在的 `desktop_runtime_context`，`run()` 必然 ImportError。两者都不在 `host/compat.py:16-18` 的模块白名单内。
7. **ERP 正式运行上下文被替身顶替**。`vendor/ledger/erp_runtime.py` 的 `configure_release_context` / `attachments_storage` 正式分支在独立版不执行，`host/compat.py:110,118-121` 注入的是 `number_store`/`release_context`/`attachments_storage` 三个替身。
8. **改稿后原 requestId 重放会被判"内容已变化"**。`update_draft` 不更新 `request_hash`（`erp_documents.py:130`），而重放检查用旧 hash 对比新 body（`:98`）。
9. **报表重复参数检测失效**。路由用 `request.args.to_dict()`（`erp.py:99,104`），重复参数在校验前已被合并，`erp_reports.py:27` 的重复检测走不到。
10. **路径校验每请求枚举祖先目录**。`ordinary()` 对每个祖先做 `iterdir` 大小写核对（`host/paths.py:28`），而 `checked()` 在请求内被多次调用，等于每请求遍历 `D:\` 根目录；性能影响未压测。
11. **`erp_numbers.reservations()` 无调用方**，编号缺口没有查询入口（`erp_numbers.py:35`）。
12. **`/auth/users` 已实现但无界面调用**；账户授权只有 API。

---

## 7. 数据与不变量

### 7.1 金额

- 数据库一律整数分：`amount_cents`、`signed_amount_cents`、`face_cents`、`settled_cents`、`balanceCents`。
- ERP 入参金额是十进制字符串，正则 `\d{1,12}(?:\.\d{1,2})?` 后 `Decimal*100` 取整（`erp_values.py:15-20`）；拒绝浮点。
- 出纳入参接受 int 或纯数字串，拒绝 bool 与浮点（`cashier_engine.py:72-81`）。
- 单据上限 9_000_000_000_000 分（`erp_values.py:19`；`cashier_engine.py:18`）；报表汇总额外限制在 9007199254740991（`erp_reports.py:173`）。
- 数量 1..1_000_000 整数；克重 ≤4 位小数字符串、≤1e8 克；日期 `YYYY-MM-DD`。

### 7.2 状态

- ERP 单据：`draft` → `pending` → `confirmed` / `rejected`；`reversed` 只存在于展示与报表，由 `erp_reversals` 派生。
- 出纳资金凭证与对账：`draft`/`pending`/`confirmed`/`rejected`，对账另有 `revoked`；资金凭证支持 `pending` 撤回为 `draft`。
- 来源发布：`published` → `revoked`。

### 7.3 编号

- ERP：`CG`/`SH`/`YS`/`QCYS`/`QCYF`/`SKFK`/`CX` + `-YYYYMMDD-` + 6 位序号（`erp_numbers.py:8,14-33`）。
- 出纳：`CNQC`/`CNSK`/`CNFK`/`CNTK`/`CNDB`/`CNCX` + `-YYYYMMDD-` + 6 位序号（`cashier_numbers.py:14,52-56`）。
- 序号存账套 `config/` 下的 JSON 文件，临时文件 + fsync + os.replace，作废号不回收，每类每日上限 999999。
- `erp_numbers.reservations(c)` 只定义未调用（`erp_numbers.py:35`），不是运行时依赖。

### 7.4 不变量

- 已确认单据不可改、不可删；证据表不可改删；审计表不可改删（触发器）。
- 往来余额必须满足 `balance = face - settled` 且非负，否则报表拒绝生成（`erp_reports.py:120-121`）。
- 出纳账户逐日余额必须落在 `0..MAX_CENTS`（`cashier_engine.py:540-544`）。
- 同一账户一天内的核销不得造成历史欠款为负或超过面额（`erp_settlement.py:7-12`）。
- 核销、冲销必须与 ERP 侧写入同事务，回读不一致即整笔 409 回滚（`cashier_engine.py:563-566,621-624`）。

---

## 8. 安全与隔离现状

- 仅接受 `127.0.0.1`/`::1`；`Sec-Fetch-Site: cross-site` 拒绝；`Origin` 必须同源（`host/app.py:176-186`）。
- 非 GET 必须带 `X-CSRF-Token`，`secrets.compare_digest` 比对（`host/app.py:207-211`）。
- JSON 请求体内递归禁止 `actor`、`staffId`、`capabilities`、`protocolVersion`、`db`、`dbPath`、`database`、`root`、`dataDir`；仅 `.../scopes` 允许 `staffId` 作为被授权人（`host/app.py:212-225`）。
- 数据库路径不来自请求；连接后校验 `standalone_metadata` 的 `version=1` 与 `namespace` 一致（`host/compat.py:39-42`），无 metadata 的旧库直接拒绝（`host/app.py` 内 `_schema`）。
- 路径校验拒绝符号链接、Windows 目录联接、硬链接、大小写别名、`resolve()` 重定向、上级非目录（`host/paths.py:12-36`）。
- vendor 模块用源码文本编译，不读也不写 pyc；未批准的 `erp_*`/`cashier_*`/`desktop_*` 导入直接 ImportError（`host/compat.py:81-123`）。
- 响应头：`no-store`、`nosniff`、`DENY`、`no-referrer`、CSP 自限（`host/app.py:225-234`）。
- 未实现：宿主签名、JWT、SSO、跨进程调用凭证；`g._xjy_actor` 的注释表明它原本是销售端 sidecar 的注入位，目前由本宿主自己填充。

---

## 9. 未实际测试项（不得当作通过）

以下全部只做了静态阅读，没有任何一次真实调用、断言或日志：

1. `--demo-init` 建号、口令文件写入、未初始化时的拒绝。
2. 登录、会话过期、5 次失败限流 429、退出。
3. CSRF 缺失/错误、跨站 Origin、非本机访问、禁止字段拦截。
4. ERP：供应商建档、采购、分批收货、应付生成、应收/期初、核销、冲销、报表、XLSX、附件、审计事件。
5. 出纳：账户与授权、期初、收付款、退款、调拨、冲销、流水报表、CSV、账单导入、对账与撤销。
6. 财务发布 → 出纳核销的完整链路（含快照 revision/hash 复核）。
7. 核销/冲销与 ERP 的同事务回读比对、失败回滚。
8. `requestId` 重放、同号异内容 409、锁冲突 503、`GET /requests/<uuid>`。
9. 触发器拦截已确认单据修改/删除。
10. 并发（SQLite 写锁、revision 冲突）、大数据量（50000 单、20MB、10 万行报表）。
11. OCR 的 503 降级提示。
12. `cashier_restore` 的恢复预检与回执（`restore` 逻辑完整但无入口）。
13. 路径隔离试运行结论（`runtime/` 里的隔离目录只是残留，无断言可复核）。
14. 前端页面：登录页、工作台、ERP 页签、出纳页签的实际交互与样式（含缺失的 `shell.css`）。

`tests/`、`scripts/` 为空，`AGENTS.md` 指定的 `tests/test_workflows.py`、`tests/test_values_review.py`、`docs/DEEPSEEK_VALUES_REVIEW.md` 均尚未出现。本盘点不构成任何测试通过证明。

---

## 10. 与分工约定的对照

- 本文与 `docs/INTEGRATION_CONTRACT.md` 是文档执行者允许写入的两个文件，未改动其他文件。
- `host/` 属宿主适配执行者；`ui/`、`tests/test_workflows.py`、`desktop/` 属主执行者；数值测试另由数值执行者负责。
- 独立版尚未声称正式桌面安装、员工更新或移动端交付完成。
