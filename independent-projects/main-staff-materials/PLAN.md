# 员工会话素材候选实施计划

> 执行方式：Root负责同源素材handler、候选启动和整合；main_integration_candidate负责可选网关hook；search_review_fixes负责搜索修复及隐私检查；module_lifecycle_fix负责独立项目证据与搜索增量复查。互不并改，Root集中Harness协作与源同步。

目标：在同一个真正主系统backend会话中使用销售素材，重要生产变更仍保留审批。

架构：D盘固定新候选；checked 1.7.0 backend/认证/迁移不改；可选网关hook以服务器上下文挂载素材，保留两层CSRF、事务前最终权限和响应前检查。技术：既有Node24.22.1、SQLite、CJS/ESM、sharp、原网关与Harness CLI，不新增依赖/模型/网络配置。

规格：DESIGN.md。

- [x] 保存checked source基准、复制白名单到candidate并校验；仅固定D运行目录、21965与虚构数据。
- [x] 网关先真实HTTP RED：匿名/伪造上下文/CSRF与写入格式/晚请求；实现可选materialsHandler，原默认无变化。
- [x] Root先RED：真正createBackend+原createSession登录后material共用authority、无单独账号、各级权限/原系统退出/切号/撤权/停用/改密生效；实现mounted-materials。
- [x] 接入搜索候选：先负极性/附件角色测试RED，保留材质/价格/库存防线和固定评估基准；回归原相关测试，不重复GPU。
- [x] Harness实际开发分类输出合同最小修正或审查接线，保存原reply与run；真实复现有效问题、最小修复、回归、实际复查。
- [x] 启动真实同源候选并走主系统登录→素材→客户展示→原系统退出；截图与非敏感测试摘要。
- [ ] 检查白名单实际字节、Git diff、密钥/财务形状、暂存blob与新提交；只推候选分支并核对远程，更新各项目交接与进展/剩余项。

重点负例：网关维护时已开始上传不得落库；同一员工重登录也使旧会话令牌失效；不同浏览器同一员工的材料凭证不互用；binary分支不绕过主系统CSRF；无特征证据的搜索不宣称满足显式缺失条件。

最终相关回归262通过，两组Harness独立增量复查已实际完成，无剩余阻断；新字节候选正常重启并验证16/15/1及复核后8/8，实际页面截图仅留D。本轮文件选择器自动化未成功，保留未验证。最后的源码同步以D盘source-sync-receipt.json为准，不预先宣称提交/推送；正式profile、原生/LAN和正式员工启用是下一阶段。
