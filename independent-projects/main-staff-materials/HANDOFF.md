# 本轮交接与真实边界

更新：2026-10-24。D盘独立候选本轮接线与审查修复已验证；正式版未安装、替换或接入。早期阶段记录、失败证据和四份收尾前文档均保留在本机evidence；本文件描述最终范围。

Root复用同仓库a970073/87da677的checked 1.7.0 backend、认证、迁移及stage1网关。主系统createSession持有auth，浏览器entry持有不可由客户端替换的backend session；素材WeakMap只接内部网关context，用auth.sessionId、isLive和administration.requireAccess('sales',level)。同源两层CSRF、事务前同步复验及图片响应前复验保留。同人重登、换员工、退出、停用、改密码、撤权、维护和后端替换的旧请求拒绝均有真实backend或合同测试。

固定21965候选使用独立cookie前缀，原默认网关声明与构建锚点保留。材料库仅位于candidate/materials/runtime/main-session-data，必须带合法synthetic marker；拒绝未知非空目录、别名、硬链接和images普通文件。CLI实例记录使用检查后的同目录临时文件、sync与原子rename。原阶段试验库保留未删，16图迁移仅复制已核对的合成试验数据库与批准的本机小样，逐文件校验，不自动迁移未知库。

最终Root回归root-final-source-regression.log：262/262，0失败/跳过。gateway-build-verification.json记录与最终源码摘要一致的真实esbuild构建、加载及虚构loopback health，通过但不等于原生/安装验收。PowerShell入口保留UTF-8 BOM，Windows PowerShell 5.1/CP936的中文解析修复前后证据均在D；原非BOM字节未改。最终字节候选已正常关闭旧21965实例并重启；final-running-candidate-acceptance.json记录新实例、关键源码摘要、16/15/1及8/8。

真实页面验证：原主系统候选登录后打开素材，无第二次登录；operate资料保存后按当前权限重读，manage有复核/供货依据入口，view无导入编辑入口；客户展示隐藏文件名和内部来源；原/auth/logout立即清除图片/选择。最终截图ui-final-view-search.png、ui-final-manager-permissions.png和ui-final-customer-main-session.png只留D。本轮两次文件选择器自动化均超时，未上传，保留未验证项，不用HTTP批量接收成绩替代该项。

真实小样原图16张保持。模型新Schema观察仍是14/16品类、2/8自动查询、65.886秒；后续纯合同修复没有重跑模型。测试管理角色按冻结参考确认15，S16含混保留，最终8查询8/8，供货全unknown。此结果不是商家审核或自动准确率。首饰正例集不能评价非首饰误收率，S01原始语义矛盾、T形/十字和S16细节问题没有宣称修复。

真实Harness作者会话af7750a8返回分类Schema改动；主审c15c22af与搜索/schema审查7b383c2f均独立实际收到final及增量复查。主审turn3：F1–F4修复/适用性已核验，新增images目录和instance原子写修复closed，findings=[]、blocking=false。搜索turn4：R1–R10及NF1/NF2/尾部否定问题closed，无剩余阻断。最终包与审后源码摘要一致，原回复与处置完整留D，不用作者自审或Codex测试冒充独立审查。

接受限制：授权在JPEG归档后、事务前失败，可留下没有assets行的本机隔离文件；测试证明列表/查询不可见、猜UUID图片404、原图不变。未自动删除；未来清理另做归属、预演和失败保全。日志/实例检查不覆盖恶意本机管理员的检查到打开/rename竞态。OR逻辑和任意自然语言语义尚未实现，不推断供货/材质/真假。

源导出仅明确白名单文本；运行账号、DB/WAL/SHM、真实图、模型、运行日志、截图、原始Harness会话和评估清单均不公开。源码仅进入既有候选分支，提交/推送与逐字节暂存核验另有本机回执；不自动合main或部署。旧21963/21964、正式31831、模型及OpenClaw网关未因本轮替换。

下一阶段：完成正式profile素材存储adapter与原生/LAN的同一服务器会话委托，在隔离完整候选验证后准备可回滚正式方案。当前正在登录的正式员工尚不能使用这个候选会话，不能复制正式凭据补齐。窗口生命周期同人世代失败仍属于另一独立项目；权限UI、SQLite队列、OpenClaw和库存助手进度见D:/Codex/xjy-project-progress-20261023/PROGRESS.md。
