# 交接说明

范围：本候选仅通过宿主注入的 authorize 与 loadReport 读取已批准库存汇报快照，返回白名单字段。不接生产库，不实现或绕过真实鉴权、SQL、HTTP，不缓存跨用户结果，不把快照称为实时库存，不从正库存推断供货状态，也不把 moves/countDiffs 计入余额。

实现：输入白名单与分页校验、同步 check、approved 与时效/一致性校验、20000 条及 truncated 拒绝、product/material 分离、code 精确匹配、q 的 NFKC 忽略大小写匹配、quantity 原字符串输出、字段投影、取消传播、不修改输入与加载结果。

未验证：本候选未运行真实测试，未连接真实系统，未验证真实数据的时间格式、sourceVersion 类型或宿主授权语义。请主执行者在隔离环境用 Node 24 执行测试并复核宿主回调契约。