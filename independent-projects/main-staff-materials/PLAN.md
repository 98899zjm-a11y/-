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

## 2026-10-24 存储、客户端与局域网接线：实施记录

Goal：在原D盘候选中补齐profile、原生客户端和原加密LAN同主会话的素材链，为正式员工接入准备。原1.7.1维护未提交成果、正式程序/数据/网络/权限不改。

- [x] profile存储：原guard+capability，未知库/日志/别名/丢图/fatal队列/句柄有真实失败与回归；作者a681、独立ad885三轮结论闭合。
- [x] LAN委托：实际token session/local generation，原加密/重放/资源限制保持；大Base64/中文path/晚撤权与成功ACK边界已修；作者ad691与独立8485闭合给定源码范围。
- [x] native/宿主：共享handler、固定代码资产/最后read seal、原preload退出、默认关闭program capability、employee不加载profile；作者8528及Root整合。最终真实44.7 fixture验证15图、同登录、opaque403、退出清空、重开15。
- [x] 运行时准备：固定原字节ESM/shim、已核sharp126文件、TS5.9.3 AST工具与依赖审计、回执最后发布；作者9e502四轮、独立ffccc四轮完成。完整ASAR/44.9入口/封签安装仍不放行。
- [x] 分类：作者16d、独立bcc1；32次本机A/B14/16→15/16品类但自动仍2/8；最终e808仅纯回放0/16变化，管理复核不变。
- [x] profile启动：作者6a11五轮，独立9eb7三轮；41关键回归。最终实际CLI adopt/父退出常驻、重复拒绝、nonce停/新PID重启已验；普通默认API与网页三角色验证已有16图15/1。
- [x] 最终相关回归443/443、0fail/skip；存储审查9测试机械迁入candidate/tests保留原证据，文件选择器自动化未成功明确保留未验。

源码导出、暂存、密钥/金融形状、新commit扫描与普通推送使用固定白名单机械工具；实际同步结论只以本阶段final-source-sync-receipt.json为准，本计划不复制可变回执状态。不得把源码归档当完整安装验收。

范围外：完整changed release入口、正式44.9/真实ASAR、外机LAN与防火墙、正式员工/生产备份恢复、微信自动扫描/OpenClaw业务工具。下一步先准备这些隔离验收，重要正式变更给具体方案确认，不绕准入/签名或自动清未知现场。
