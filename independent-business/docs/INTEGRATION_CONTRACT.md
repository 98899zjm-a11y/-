# ERP 与出纳合并接口契约（独立版现状 → 销售宿主）

本文说明 `D:/Codex/xjy-business-standalone-20261023` 当前实际暴露的 HTTP 契约、身份字段、审核状态、金额口径、幂等规则与角色权限，并给出未来并入销售宿主时的接口要求。

写法约定：
- **现状**部分由源码静态阅读得出，行号可复核；全部接口尚未实际调用，见第 9 节。
- **【合并要求】**标记的是宿主侧必须具备、当前尚未实现的部分，属于未来约定，不是现有能力。
- 本文不新增代码、不引入依赖；仅描述契约。

---

## 1. 通用约定

### 1.1 传输与包络

- 仅本机回环：请求来源必须是 `127.0.0.1` 或 `::1`，否则 403（`host/app.py:176-177`）。
- `Host` 白名单 `127.0.0.1`、`localhost`（`host/app.py` 创建应用处）。
- 成功：`{"ok": true, ...业务字段}`（`vendor/ledger/cashier.py:83`；`vendor/ledger/erp.py` 各路由直接 `jsonify(ok=True, ...)`）。
- 失败：`{"ok": false, "error": "中文说明"}`，个别错误附 `code`（恢复未完成时为 `CASHIER_RESTORED_UNFINISHED`）。
- 出纳路由强制 `Content-Type: application/json`（`cashier.py:61`），JSON 重复字段直接拒绝（`cashier.py:13-18`）；请求体上限 15 MiB（`cashier.py:63`）。ERP 侧走 Flask 全局 16 MiB。
- 非 GET 必须携带 `X-CSRF-Token`，与会话内 csrf 做 `compare_digest`，否则 403 "操作校验已过期，请刷新后重试。"（`host/app.py:207-211`）。
- 会话 Cookie `xjy_demo_session`（HttpOnly、SameSite=Strict、8 小时），库内只存 sha256。

### 1.2 身份字段

| 字段 | ERP actor（v2） | 出纳 actor（v3） |
| --- | --- | --- |
| `protocolVersion` | `2` | `3` |
| `module` | `ledger` | `cashier` |
| `authorityModule` | 无 | `cashier` |
| `storageModule` | 无 | `ledger` |
| `access` | `view` / `operate` / `manage` | 同左 |
| `capabilities` | 15 项（`vendor/ledger/erp_values.py:61`） | 19 项（`vendor/ledger/cashier_engine.py:19-24`） |
| `staffId` | 必填非空 | 必填非空 |
| `name`、`role` | 展示与管理员判断 | 同左 |

- 出纳 `require()` 校验 `authorityModule`/`storageModule`，并**禁止** actor 带 `accountIds`、`scopeRevision`（`cashier_engine.py:101-115`）。
- 请求体递归禁止出现 `actor`、`staffId`、`capabilities`、`protocolVersion`、`db`、`dbPath`、`database`、`root`、`dataDir`，否则 400 "请求不能指定操作者身份、权限或数据库路径。"（`host/app.py:212-225`）。唯一例外：`.../scopes` 允许 `staffId`，语义是"被授权人"，不是操作者。

**【合并要求】身份由销售宿主签发。**
- 宿主应注入 `g._xjy_actor` / `g._xjy_cashier_actor`（业务层只读这两个位置），独立版不复刻登录，也不接受浏览器自报身份。
- 断言内容至少包含：`staffId`、`name`、`role`、两套 `protocolVersion` 与 `capabilities`、`access`、`module`/`authorityModule`/`storageModule`、签发方、签发时间、过期时间、防重放标识。
- 校验必须在宿主边界完成，且不可由请求头、查询串或请求体覆盖。
- **不得**把数据库路径、账套目录、`dataDir` 作为参数传给业务层；数据归属只用 `storageModule` 表达。

### 1.3 幂等

- 所有写请求必须带 `requestId`（标准 UUID 字符串）。
- ERP：`UNIQUE(author_id, request_id)` + `request_hash = digest(整个请求体)`。同号同内容返回原单据；同号不同内容 409 "同一请求的单据内容已变化，已拒绝重复制单。"（`erp_documents.py:94-103`；`erp_schema.py:19`）。
- 出纳：`cashier_requests` 主键 `(actor_id, request_id)`，`hash = digest({method, path, body})`；命中后先重跑授权 `authorize_cached` 再返回缓存（`cashier_engine.py:239-257,277-298`）；同号异内容 409 "同一请求编号的内容不同。"。
- 出纳另有查询入口：`GET /cashier/api/requests/<uuid>` → `{requestId, result}`；无记录 404。
- 锁冲突（`database is locked`）→ 503 "账套正在处理另一笔操作，请用原请求编号重试。"（`cashier_engine.py:263-266`）。
- 已知例外：ERP `update_draft` 不更新 `request_hash`（`erp_documents.py:130`），改稿后用原 `requestId` 重放会被判"内容已变化"。

**【合并要求】**重试必须复用原 `requestId` 与原请求体；收到 409 不得换号重试；幂等表必须与业务数据同库同事务。

### 1.4 金额

- 一律整数分：`amountCents`、`amount_cents`、`face_cents`、`settled_cents`、`balanceCents`、`openingCents`、`closingCents`、`revenueCents` 等。
- ERP 入参是十进制字符串，正则 `\d{1,12}(?:\.\d{1,2})?`，内部 `Decimal*100` 取整（`erp_values.py:15-20`）。
- 出纳入参接受 int 或纯数字串（`cashier_engine.py:72-81`），拒绝 bool 与浮点；账单 CSV 中的金额按 `×100 + 补位` 转分（`cashier_engine.py:729-732`）。
- 上限 9_000_000_000_000 分；报表汇总再限制在 9_007_199_254_740_991（浏览器安全整数）。
- 展示层才转元；导出 XLSX 写两位小数文本以保证 Excel 精度。

**【合并要求】**跨系统边界只传整数分；禁止浮点、禁止元为单位；金额为 0 或负数的校验留在各业务入口，不在传输层做。

### 1.5 乐观锁与审核快照

- `revision` 为整数，每次内容或状态变化 +1；`UPDATE ... WHERE revision=?` 失配即 409。
- ERP 提交时冻结 `frozen_hash = digest({id, payload, revision, lines})`（`erp_documents.py:139`）；审核时用 `revision + hash + decision + note` 复核。
- 出纳提交时冻结 `digest({id, revision, payload})`（`cashier_engine.py:509`）；审核时比对 `hash`、`frozen_hash` 与重算值三者。
- 财务来源发布时记录 `erp_revision` 与 `erp_hash` 快照，核销前重新校验（`cashier_engine.py:532-535,660`）。

### 1.6 审核状态机

```
ERP 单据:   draft --submit--> pending --review(approve)--> confirmed
                              pending --review(reject)--> rejected --edit--> draft
出纳凭证:   同上，另有 pending --withdraw--> draft
出纳对账:   pending --review(approve)--> confirmed --revoke--> revoked
           pending --review(reject)--> rejected
来源发布:   published --revoke--> revoked
派生展示:   reversed（存在 reversal 记录时由查询派生，不是库内状态）
```

- 审核人必须与制单人不同（ERP `erp_documents.py:165`；出纳 `cashier_engine.py:496,815`）。
- 审核需要 `manage` 级 access；出纳还需要账户级 `manage` scope。
- 冲销不改原单状态：另建 `reversal` 单据并写入 `erp_reversals` / `cashier_reversals`。

**【合并要求】**保留作者回避、`frozen_hash` 校验与 `revision` 递增；不得为了"合并方便"放宽为单人审核。

### 1.7 分页

- ERP：无服务端分页。`bootstrap` 全量返回，>50000 单或 >20MB 直接 413；报表上限 5 万行；出纳导出上限 1 万行。
- 出纳：`limit`（1..200，默认 50）、`after` 游标，返回 `nextAfter`。`documents` 用 rowid 游标，`report` 用行下标。

**【合并要求】**大账套合并前必须补 ERP 服务端分页或增量同步；当前契约不足以承载正式数据量。

---

## 2. 角色与能力矩阵（现状）

角色由登录用户决定，能力由 `host/app.py:40-61` 组装。

| 角色 | ERP access / 能力 | 出纳 access / 能力 |
| --- | --- | --- |
| `finance_maker` | `operate`；CAPS 去掉全部 `.review` | 无 actor |
| `finance_reviewer` | `manage`；CAPS 去掉全部 `.prepare`，加 `erp.cashier.release` | 无 actor |
| `cashier_maker` | 无 actor | `operate`；CAPABILITIES 去掉 MANAGE 集合（全部 `.review`、`cashier.accounts.manage`、`cashier.opening.prepare`） |
| `cashier_reviewer` | 无 actor | `manage`；CAPABILITIES 去掉 `.prepare`、`cashier.reconcile.import`、`cashier.reconcile.match`，因运算符优先级额外保留 `cashier.opening.prepare` |
| `admin` | 两套全量 + `erp.cashier.release`，`manage` | 两套全量，`manage` |

补充约束：
- ERP 写需 `access ∈ {operate, manage}`；审核还需 `access == manage`（`erp_values.py:66-69`）。
- 敏感单据（采购、收货、期初应付、付款方向的核销）额外需要 `erp.reports.sensitive`；无此能力时返回的金额被移除并置 `redacted=true`。
- 出纳写需 `access ∈ {operate, manage}`；账户级 scope 为 `disabled`/`view`/`operate`/`manage`，账户 `active=0` 时拒绝。
- 财务发布写出纳来源用的是 **ERP actor**（`finance_authority`：`erp.read` + `erp.cashier.release` + `access==manage`），不是出纳 actor。

**【合并要求】**宿主传入的 `role` 只是展示与管理员判断依据，真正的闸门是 `capabilities`；合并后不得出现"宿主管理员 = 出纳管理员"的隐含提权，`accountIds` 仍不得由客户端提供。

---

## 3. ERP 接口

### 3.1 页面与静态

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/erp/` | 返回 `erp.html`，要求 `erp.read` |
| GET | `/erp/static/<name>` | 白名单静态资源 |

### 3.2 数据接口

| 方法 | 路径 | 请求 | 响应关键字段 | 权限 |
| --- | --- | --- | --- | --- |
| GET | `/erp/api/bootstrap` | 无 | `actor{staffId,name,capabilities}`、`parties`、`documents`、`bills`、`accounts`、`asOf` | `erp.read` |
| GET | `/erp/api/parties` | 无 | `parties[]` | `erp.read` |
| POST | `/erp/api/parties` | `requestId`、`kind`(supplier/customer)、`name` 必填；`contact`、`phone`、`termsDays`(0..3650)、`note`、`id`、`revision`、`active` 可选 | `party{id,code,kind,name,contact,phone,termsDays,note,active,revision}` | `erp.parties.manage` + 写 |
| POST | `/erp/api/documents` | 见 3.3 | `document` | `erp.<domain>.prepare` + 写，敏感单据加 `erp.reports.sensitive` |
| GET | `/erp/api/documents/<uuid>` | 无 | `document`（含 `lines`、`events`、`billId`） | `erp.read` |
| PATCH | `/erp/api/documents/<uuid>` | 同建单字段 + `revision` | `document` | `prepare` + 写；仅作者、`draft`/`rejected` |
| POST | `/erp/api/documents/<uuid>/submit` | 仅 `revision` | `document` | `prepare` + 写；仅作者 |
| POST | `/erp/api/documents/<uuid>/review` | `revision`、`hash`、`decision`(approve/reject)、`note`（必填非空） | `document` | `erp.<domain>.review` + `manage` |
| GET | `/erp/api/reports` | 查询 `asOf`、`from`、`to`、`partyId`、`kind`、`status`、`creatorId` | `report{asOf,filters,rows,totals,aging,cash,purchase,sensitiveAccess}` | `erp.reports.view` |
| GET | `/erp/api/export.xlsx` | 同上 | XLSX 二进制 | `erp.reports.view` |
| POST | `/erp/api/attachments` | `requestId`、`name`、`mime`、`bodyBase64` | `attachment` | `erp.attachments.write` |
| GET | `/erp/api/attachments/<uuid>` | 无 | 文件二进制 | owner 或被单据引用；敏感单据引用时另需 `erp.reports.sensitive` |
| GET | `/erp/api/ocr/capabilities` | 无 | `ocr{available,engine,language,confidence,reason}` | `erp.read` |
| POST | `/erp/api/ocr/imports` | `requestId`、`attachmentId` | `job` | `erp.read` + OCR 相关能力 |
| GET | `/erp/api/ocr/imports/<uuid>` | 无 | `job` | 同上 |
| POST | `/erp/api/ocr/imports/<uuid>/draft` | `requestId`、`imageHash`、`resultHash`、`document`、`review` | `document` | 同上 |

### 3.3 建单请求体（按 `kind` 展开）

公共字段：`requestId`、`kind`、`partyId`、`date`，可选 `note`、`attachments`(≤10)、`revision`（仅改单）。

| kind | 追加字段 |
| --- | --- |
| `purchase` | `businessType`(own/consignment)、`dueDate`、`lines[{description,material,purity,quantity,estimatedWeight,amount}]`（1-100 行） |
| `receipt` | `sourceId`、`dueDate`、`lines[{purchaseLineId,quantity,actualWeight,amount}]` |
| `receivable` | `amount`、`dueDate`、`sourceSaleId`（独立版被宿主 400 拒绝） |
| `opening_receivable` / `opening_payable` | `amount`、`dueDate`、`evidence`（必填） |
| `settlement` | `direction`(receive/pay)、`amount`、`account`、`allocations[{billId,amount}]`（1-100 张，合计必须等于 `amount`） |
| `reversal` | `targetId`、`note`（必填） |

响应 `document` 结构（`erp_common.py:55-75`）：`id`、`number`、`kind`、`partyId`、`partyName`、`date`、`dueDate`、`amountCents`、`status`、`revision`、`hash`、`authorId`、`authorName`、`reviewerId`、`reviewerName`、`note`、`payload`、`lines[]`、`billId`、可选 `events[]`、`redacted`、`ocrEvidence`。

---

## 4. 出纳接口

### 4.1 页面

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/cashier`、`/cashier/` | 返回 `cashier.html`，要求 `cashier.read` |
| GET | `/cashier/static/cashier.css`、`/cashier/static/cashier.js` | 仅 GET，拒绝查询串与正文 |

### 4.2 数据接口（登记于 `vendor/ledger/cashier.py:90-110`）

| 方法 | 路径 | 请求 | 响应关键字段 | 权限 |
| --- | --- | --- | --- | --- |
| GET | `/cashier/api/bootstrap` | 无 | `accounts[]`、`capabilities`、`currency`、`actor{staffId,name,role}` | `cashier.read` |
| GET | `/cashier/api/accounts` | 无 | 同上 | `cashier.read`；金额需 `cashier.amounts.sensitive` |
| POST | `/cashier/api/accounts` | `requestId`、`code`、`name`、`kind`(cash/bank)、`currency`(CNY)、可选 `maskedReference`、`note` | `account` | `cashier.accounts.manage` + `role==admin` |
| PATCH | `/cashier/api/accounts/<uuid>` | `requestId`、`revision`、`name`、`maskedReference`、`note`、`active` | `account` | 同上 |
| POST | `/cashier/api/accounts/<uuid>/scopes` | `requestId`、`staffId`、`level`(disabled/view/operate/manage)、`revision`、`note` | `scope` | 同上 |
| GET | `/cashier/api/documents` | `limit`、`after`、`accountId`、`status`、`kind` | `documents[]`、`nextAfter` | `cashier.amounts.sensitive` |
| POST | `/cashier/api/documents` | 见 4.3 | `document` | `cashier.<KINDS[kind]>.prepare` + sensitive + 账户 `operate` |
| GET | `/cashier/api/documents/<uuid>` | 无 | `document`、`events[]` | `cashier.read` + 账户 scope |
| PATCH | `/cashier/api/documents/<uuid>` | 同建单 + `revision` | `document` | `prepare` + 作者 + 账户 `operate` |
| POST | `/cashier/api/documents/<uuid>/submit` | `requestId`、`revision` | `document` | `prepare` + 作者 |
| POST | `/cashier/api/documents/<uuid>/withdraw` | `requestId`、`revision`、`note`（必填） | `document` | `prepare` + 作者 |
| POST | `/cashier/api/documents/<uuid>/review` | `requestId`、`revision`、`hash`、`decision`、`note` | `document` | `<KINDS[kind]>.review` + `manage` + 账户 `manage`，非作者 |
| GET | `/cashier/api/sources` | 无 | `sources[]`（含 `outstanding_cents`） | `cashier.sources.read` + sensitive |
| GET | `/cashier/api/postings`、`/cashier/api/flows`(别名) | `limit`、`after`、`accountId`、`from`、`to`、`asOf` | 见 4.4 | `cashier.reports.view` + sensitive + 账户 `view` |
| GET | `/cashier/api/reports/balances` | 同上 | 见 4.4 | 同上 |
| GET | `/cashier/api/reports/daily` | `accountId`、`date`、`limit`、`after` | 见 4.4 | 同上 |
| GET | `/cashier/api/reports/export`、`/cashier/api/export.csv`(别名) | `accountId`、`from`、`to`、`asOf` | 见 4.4 + `csvBase64` | `cashier.reports.export` + sensitive |
| POST | `/cashier/api/statement-imports/preview` | `requestId`、`accountId`、`csvBase64`、`encoding`(utf-8/gb18030)、`mapping{date,amount,externalId?,description?}` | `rows[]`、`previewHash`、`originalSha256`、`rowCount` | `cashier.reconcile.import` + sensitive + 账户 `operate`；不写幂等记录 |
| POST | `/cashier/api/statement-imports` | 同上 + `previewHash`、可选 `name` | `import{id,accountId,rowCount,originalSha256,previewHash}` | 同上 |
| GET | `/cashier/api/statement-imports` | `accountId`、`limit`、`after` | `imports[]` | `cashier.reports.view` + sensitive + 账户 `view` |
| GET | `/cashier/api/statement-imports/<uuid>` | 无 | `import`、`rows[]` | 同上 |
| GET | `/cashier/api/statement-imports/<uuid>/original` | 无 | `original{name,sha256,size,base64}` | `cashier.reports.export` + sensitive |
| GET | `/cashier/api/reconciliations` | `accountId` | `reconciliations[]` | `cashier.reports.view` + sensitive + 账户 `view` |
| POST | `/cashier/api/reconciliations` | `requestId`、`accountId`、`matches[{statementRowId,postingId}]`、`note` | `reconciliation` | `cashier.reconcile.match` + sensitive + 账户 `operate` |
| POST | `/cashier/api/reconciliations/<uuid>/review` | `requestId`、`revision`、`hash`、`decision`、`note` | `reconciliation` | `cashier.reconcile.review` + sensitive + 账户 `manage`，非作者 |
| POST | `/cashier/api/reconciliations/<uuid>/revoke` | `requestId`、`revision`、`note` | `reconciliation` | 同上 |
| GET | `/cashier/api/requests/<uuid>` | 无 | `requestId`、`result` | `cashier.read` + 账户 scope |
| POST | `/erp/api/cashier-source-releases` | `requestId`、`billId`、`revision`、`hash`、`note` | `release{id,billId,revision,status,direction,partyId}` | **ERP actor** 的 `finance_authority` |
| POST | `/erp/api/cashier-source-releases/<uuid>/revoke` | `requestId`、`revision`、`note` | 同上 | 同上 |

注意：最后两条路径在 `/erp/` 下，但由出纳蓝图注册、使用 ERP actor；合并时不要按路径前缀推断身份类型。

### 4.3 凭证请求体

公共字段：`requestId`、`kind`、`accountId`、`businessDate`、`amountCents`、`note`（必填非空）。

| kind | 追加字段 |
| --- | --- |
| `opening` | `evidence`（必填） |
| `receive` / `pay` | `partyId`、`allocations[{releaseId,amountCents}]`（1-100 条，合计等于 `amountCents`） |
| `transfer` | `toAccountId`（必须不同于 `accountId`） |
| `refund` | `partyId`、`originalCashDocId`、`refundBasis`；`kind` 允许 `refund_out`/`refund_in` 别名 |
| `reversal` | `targetId` |

响应 `document`：`id`、`number`、`kind`、`accountId`、`businessDate`、`amountCents`、`payload`、`status`、`revision`、`frozenHash`、`authorId`、`authorName`、`reviewerId`、`reviewerName`、`reversed`。

### 4.4 资金报表响应

`accountId`、`from`、`to`、`openingCents`、`closingCents`、`receiptCents`、`paymentCents`、`reconciledCents`；非导出时另有 `postings[]`、`totalRows`、`nextAfter`，导出时另有 `csvBase64`。

---

## 5. 跨模块契约

### 5.1 财务发布出来源

- 前置：ERP 单据 `confirmed`、未冲销、无已发布记录；请求里的 `revision` 与 `hash` 必须等于该单据当前值（`cashier_engine.py:646-666`）。
- 方向由单据类型推导：应收 → `receive`，应付 → `pay`。
- 撤销：仅 `published` 可撤，需 `revision` 匹配，状态转 `revoked`，历史保留。

### 5.2 出纳核销（同事务写 ERP）

1. 出纳 `receive`/`pay` 审核通过时，先逐条核对来源仍为 `published` 且快照未变。
2. 同连接同事务内插 `cashier_allocations`。
3. 造 ERP `settlement` 单据：单号 `CASH-<出纳凭证号>`、`request_id=cashier:<出纳凭证 id>`、`status=confirmed`、审核人为出纳审核人、`frozen_hash=digest({cashierDocumentId,payload})`。
4. 调用注入的 `settlement_bridge`，或默认 `erp_settlement.accept_settlement`。
5. 回读 `erp_postings` 与 `erp_allocations`，与预期逐条比对，不一致即 409 "财务桥未写入完整同事务核销，已停止资金记账。" 整笔回滚。
6. 通过后才写资金流水。

### 5.3 出纳冲销（连锁 ERP 冲销）

1. 原单须 `confirmed`、非 `reversal`/`opening`、同账户、金额一致、未被冲销、无退款证据、未对账锁定。
2. 生成反向流水；若原单有 ERP 关联，造 ERP `reversal` 单据并调用 `reversal_bridge` 或 `erp_settlement.accept_cashier_reversal`。
3. 校验补偿流水逐条取反、`erp_reversals` 记录存在，否则整笔停止。
4. 最后写 `cashier_reversals`。

### 5.4 数据归属

- 出纳数据存放在同一个 ledger 库里（`cashier_*` 表），`storageModule='ledger'` 表达这一事实。
- 出纳与 ERP 是**两个独立页面、两套独立能力、各自独立 actor**，只是共用账套与事务。
- 合并后仍应保留这条边界：出纳侧不得自行铸造 ERP actor（`cashier_engine.py:612-618` 注释明确要求使用真实出纳 actor 让 ERP 桥复核）。

---

## 6. 存储与路径契约

| 项目 | 现状 | 合并要求 |
| --- | --- | --- |
| 数据库 | 固定 `runtime/<账套>/data/demo.sqlite3`，`mode=rw` 打开，校验 `standalone_metadata(version=1, namespace)` | 宿主决定数据目录与 `storageModule`；业务层不得接收任意路径 |
| 账套标识 | `runtime/<账套>/.standalone-demo.json`（version/purpose/namespace），拒绝接管非空未标识目录 | 正式版应有等价的身份与归属校验，不沿用 demo 语义 |
| 编号保留 | 账套 `config/` 下的 JSON，临时文件 + fsync + os.replace，作废号不回收，每类每日上限 999999 | 保留原子性与缺口语义；迁移时编号文件需随账套走 |
| 附件 | `data/erp-attachments`，单文件 ≤2MiB | 出纳无附件；合并后附件目录必须由宿主签名确定 |
| 临时目录 | 账套内 `temp/`，`TEMP`/`TMP`/`tempfile.tempdir` 均指向它 | 保持进程级隔离，禁止落到系统临时目录 |
| 凭证文件 | `demo-credentials.json`，只写一次 | 正式版不适用；口令不得进入业务库或日志 |
| 会话 | Cookie `xjy_demo_session` | 合并后应由宿主 SSO 接管，避免双登录 |

路径守卫（`host/paths.py:12-36`）拒绝：相对路径、`..`、符号链接、Windows 目录联接、硬链接、大小写别名、`resolve()` 重定向、上级非目录。

---

## 7. 错误语义

| 状态码 | 触发 | 是否可重试 |
| --- | --- | --- |
| 400 | 字段缺失/多余、金额格式、UUID 格式、请求体指定身份或库路径、`sourceSaleId` | 修正请求后重试 |
| 401 | 未登录 | 重新登录 |
| 403 | 能力不足、非管理员、作者自审、账户 scope 不足、CSRF 失败 | 换人或换权限，不可重试 |
| 404 | 单据/账户/请求不存在、未开放的操作路径 | 核对标识 |
| 409 | `revision`/`hash` 失配、同号异内容、重复发布、余额不足、历史超量、完整性冲突 | 刷新后用新内容，或复用原号原内容 |
| 413 | 单据数、行数、请求体、报表超限 | 缩小范围 |
| 429 | 登录失败限流（5 次/300 秒） | 等待 |
| 503 | 数据库锁 / 未接线的桥 / 孤立的路径错误 | 锁冲突可用原号重试；其余需修配置 |

---

## 8. 合并缺口（当前未实现）

1. **没有宿主身份注入通道**。无签名、无 JWT、无 SSO、无 mTLS；`g._xjy_actor` 目前由独立版自己填（`host/app.py:199`）。注释称原设计是 signed sidecar（`cashier.py:1`、`erp_runtime.py:33`），但通道本身不存在。
2. **没有跨进程协议**。当前是同一 Flask 进程内直接调用领域模块；合并若拆服务，需要重新定义事务边界（当前核销/冲销强依赖同连接同事务）。
3. **ERP 无分页/无增量同步**。`bootstrap` 全量拉取，正式账套会直接 413。
4. **发布到出纳无 UI**，且发布需要 ERP 的 `revision` 与 `frozen_hash` 快照，前端目前拿不到发布入口。
5. **销售来源未接入**。`sourceSaleId` 被宿主 400 拒绝，账套无 `sales` 表；销售行 → 应收的字段、指纹、去重口径都还没有契约。
6. **OCR 未配置**。`XJY_MODULE_OCR_PORT`、`XJY_MODULE_OCR_TOKEN` 未提供时恒 503。
7. **恢复与维护未接线**。`cashier_restore` 逻辑完整但无入口；`cashier_maintenance` 依赖不存在的 `desktop_runtime_context`，导入即失败。
8. **无迁移/回滚契约**。只有恢复回执字段（`restoredUnfinished`、`unfinished_document_not_restored`），没有版本迁移、双写校验或灰度方案。
9. **无审计导出**。审计表有触发器保护，但没有只读导出接口。

---

## 9. 未测试声明

本文所有路径、字段、状态与权限均由源码静态阅读推导，**没有实际发起过任何 HTTP 请求**，也没有启动服务或连接数据库。以下项目尤其需要真实验证后再用于合并评估：

- 身份字段在宿主注入路径下的实际校验结果（当前只有 cookie 路径）。
- 发布 → 核销 → 冲销的完整链路与失败回滚。
- 同号重放、异内容 409、锁冲突 503 的真实行为。
- 分页游标在数据变动后的稳定性。
- `redacted` 遮蔽、附件权限、账单原件下载。
- 并发下的 `revision` 冲突与 SQLite 写锁表现。

在 `tests/` 与 `scripts/` 补齐之前，本契约只能作为接口对齐依据，不能作为验收证据。
