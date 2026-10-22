# 测试报告 · 独立 ERP / 出纳开发版

日期：2026-10-23。范围仅为本机虚构开发账套；不是正式商业发布、完整安装包或销售软件合并验收。

## 最新实际结果

| 检查 | 实际结果 | 证据 |
|---|---|---|
| Python 全量自动化 | 44方法，0失败、0错误，41.705秒 | artifacts/all-tests-frozen.log |
| 数值独立参考 | 23方法，计数器实跑317次assert调用，0失败/错误/跳过 | artifacts/values-count-verified.log |
| 真实HTTP并发 | Waitress四线程、多身份；两笔70元收款核销同100元应收，仅一笔成功且另一笔409，余30元；子服务退出0 | artifacts/http-smoke-report.json |
| 真实桌面界面 | 7项通过，页面异常0；包含登录、ERP供应商保存、收付依据发布/撤回、出纳开户、390px截图、正常关闭及端口重绑 | artifacts/desktop-smoke-report.json |
| SQLite恢复演练 | WAL一致快照、integrity_check ok、外键0；在新OwnedRuntime重开，校验namespace；保留快照后2号单的编号知识，恢复后出3号单不重号 | tests/test_snapshot_and_export.py及全量日志 |
| 真实XLSX | HTTP导出、openpyxl打开；目前仅为空表结构冒烟，不冒称所有金额导出已逐格对账 | 同上 |
| 源码静态检查 | Python编译、JSON解析、常见密钥格式扫描通过；30个原始源码资源仅两项领域/前端差异 | artifacts/source-index.json |
| 外部审查 | 实际DeepSeek两轮已回复；第二轮无阻断本机虚构开发版的P0/P1，保留正式版边界 | docs/DEEPSEEK_INDEPENDENT_REVIEW.md、DEEPSEEK_RECHECK.md |

44方法由数值23、业务17、快照/导出2、导入安全守卫2组成。业务测试验证采购/分批验收/起应付、资金与ERP核销原子性、付款/收款/退款/调拨/联动冲销、银行CSV原件与异人对账、幂等、过期revision、自审拒绝、未授权范围及并发超额拒绝。预期金额使用独立手算常量。

## 保留的失败与纠正

早期真实失败均在artifacts保留：宿主未带admin角色、旧ERP的/session缺失、供应商/客户业务编号与纯UUID不兼容，以及首页在加载中退出按钮尚未绑定。均已最小修复并重跑。

测试夹具另有currency字段遗漏、frozenHash误用、纯值模块预导入触发正确安全守卫、持久化登录状态、页面异步加载时机及错误往来单位在“创建”阶段已经拒绝而非“提交”阶段拒绝等问题；没有为此放宽业务校验或把错误接口改成通过。旧日志与最终通过日志分开。

原ResourceWarning来自测试自身把sqlite连接当上下文但未close，已改closing，最新完整日志没有该警告。不是删除警告过滤器。

## 未执行/未交付

完整独立安装包、换机安装与Win10/Win11双机验证、生产数据迁移、正式合并、真实员工账号、7天自动备份/清理、断电故障注入、真实OCR与原打印机、银行多种非UTF8模板、长时间压力与多进程并发均未执行。390px截图不是iPhone/安卓真机兼容验证。WAL演练不是覆盖正式现有账套的一键回滚。

## 冻结后的复跑
代码提交 e8f7d9b62f681cde680bb9e57ac1ad7ea1f30e3c 后，44方法再次实跑通过（46.157秒，all-tests-committed.log）。源码未变，后续仅补文档。DeepSeek第三轮实际回复见docs/DEEPSEEK_FINAL_SIGNOFF.md，判定范围仅为本机虚构开发版，无阻断P0/P1。真实HTTP/桌面也已复跑，不用旧失败结果替代最新结果。
