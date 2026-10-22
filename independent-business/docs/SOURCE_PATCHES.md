# 已复现的领域源码最小补丁

源：cashier_engine.py
原SHA256：f97d326ef79c255ca6899c51d2930d9213c76e60237b3c80619c1fbc7d6891a1
现SHA256：cc77625bdb7bf817bcd901730469c5c4e88077ad4750c2056e83ec1f35cb8c44

根因：ERP原供应商id为SUP:整数，财务客户id为CUS:UUID；出纳归一化却把partyId当成单据UUID。真实采购收货起应付、发布收付依据后，合法付款被拒绝“标识格式无效”。
失败：artifacts/workflows-fourth-run.log，付款及并发付款两项失败。
最小修复：增加严格party_id校验，只允许规范SUP:1..SQLite正整数上限、CUS:规范UUID，以及既有纯UUID兼容身份；只替换收付及退款partyId两处，不改变单据、账户、来源和请求UUID校验。后续仍按事务内已发布来源核对单位、方向、权限与余额。
修复后：15项真实业务流程通过，含供应商付款、客户收款退款、资金/ERP同事务冲销、调拨、银行对账及并发拒绝超付。原E源码完全未修改。

另有宿主适配缺口已修复：audit_logs最小兼容表、固定admin角色映射、旧ERP受保护/session兼容、首页异步加载期间退出按钮提前绑定。测试夹具遗漏currency/frozenHash以及全量测试预导入模块的问题也已纠正；原失败日志保留，未放宽业务断言。

独立复查后的第二项差异：cashier_engine来源读取强制accountId及账户scope；app/static/cashier.js读取来源使用当前账户query。新收付交接页面走原财务发布API；金额算法未改。

