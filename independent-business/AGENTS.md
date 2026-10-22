# 独立 ERP / 出纳开发边界

本目录独立于销售正式版，禁止连接或写入 F 盘正式程序、账套、配置及升级分发目录。与正在进行的1.7.x发布无文件共享写入。

- vendor/ledger 是从维护源码选取的已存在业务模块，来源见 vendor-manifest.json；不要用未知 pyc 重写算法。
- 运行、数据、编号保留、附件、缓存和日志仅在本目录 runtime 内；构建产物仅 artifacts。拒绝 symlink/junction、路径逃逸和外部数据库路径。
- host/ 由宿主适配执行者负责；ui/、tests/test_workflows.py、desktop/ 由主执行者负责。
- DeepSeek 文档执行者只写 docs/FEATURE_INVENTORY.md 和 docs/INTEGRATION_CONTRACT.md。
- DeepSeek 数值测试执行者只写 tests/test_values_review.py 和 docs/DEEPSEEK_VALUES_REVIEW.md。
- 确认单保留原双人审核、原金额精度、原幂等与事务，不放宽断言，不把隐藏按钮当权限。
- 只用虚构账号；真实凭据、数据库、附件与日志不可提交到公开Git。
- 此版本是独立开发工作台；不声称正式桌面安装、员工更新或移动端交付已完成。
