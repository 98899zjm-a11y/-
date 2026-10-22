# 架构与未来合并边界

- `vendor/ledger`：既有ERP、出纳领域模块，保留审核、精确分金额、幂等和SQLite事务。原始快照哈希见vendor-manifest.json，最小差异见docs/SOURCE_PATCHES.md。
- `host`：独立测试宿主，固定源码加载、独立SQLite连接、数据库namespace、服务端会话、固定角色授权、CSRF及来源检查。运行路径只允许本工程runtime内的专属账套。
- `ui`：独立首页/登录与轻量导航；bridge只为同源ERP/出纳写请求加会话校验。旧ERP的/session查询由受保护的宿主兼容路由提供，不复用Electron会话。
- `desktop`：本地开发Electron窗口，禁止渲染器Node、禁止新窗口/跨源导航，缓存日志导出落D；通过自己启动的Python进程ready信息核对PID、端口、账套namespace。只关闭自己的开发子服务。
- `tests`：虚构流程、数值边界、并发、导出、WAL快照；`scripts/desktop-smoke.cjs`是真实开发桌面GUI操作，未经测试的完整安装/正式合并不算通过。

未来销售宿主负责当前员工身份和能力查询，服务端映射为原引擎actor；网页不得传actor、任意数据库路径或权限数组。ERP与出纳保留同一个财务存储事务，避免分库双写。销售/库管只通过受审来源投影与幂等命令对接，不直接操作本库表。

本轮没有更改正式服务、端口31831、防火墙、生产密钥或正式升级分发目录。
