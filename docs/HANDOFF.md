# 1.7.0 电脑版发布接管

用户于2026-10-22授权Codex接管构建、签名、隔离安装/升级/恢复及最终发布，DeepSeek继续修复和独立审查。测试通过后正式主机升级与员工补丁已授权；原数据必须保留，运行中的正式业务不得强杀。

工作目录：D:/Codex/xjy-release-20261022。旧签名包和D:/Codex/xjy-1.7.0的历史产物保留。当前候选代码fixed4 (7efed34a...)、delivery-native patch (c962f1c3...)尚未进入新签名包。DeepSeek最终独立审查已派发，报告目标为旧continuation目录的INDEPENDENT_REVIEW_FIXED4_FINAL.md。

顺序：核实来源与哈希→新建发布副本/manifest→使用本机真实Python与PowerShell校验→受信签名与整包审计→干净沙盒首次安装/升级/失败恢复→正常退出正式程序/一致备份/恢复验证→正式程序更新→员工同版本补丁与说明。任何未执行项不得标通过。

## Root执行进展
- 用户已确认正式程序保存并从托盘退出；进程检查无正式业务进程。
- 原程序与资料备份 D:/Codex/xjy-private-backups/pre170-20261022-a1：4701文件，4015026383字节，逐文件hash回读一致；三个数据库恢复副本integrity_check=ok、foreign_key_check=0。未打开原业务数据库。
- fixed5原代码回归50/50（含真实junction），混合角色额外5/5；DeepSeek独立签核17用例通过，允许内部构建。审计详情日志、其他P2与ERP/手机/社交等下一批，不声称已修。
- 真实本机Python ASAR验证通过；严格UTF8 ParseInput旧wrapper语法0错误。新构建3293成员、9签名、7 PS AST均通过；archive 212aabdfbd4698274cabe5468cb80634e9ba24ff1458abc5547466ec403e8c8d / 781516427字节。
- 外层绑定辅助器接入中修正：C27 preimage引用、auditor-vs-builder身份、签名元数据大小限制、exact APPROVALS只读root。全量check已通过且KeyReads=0；用户正人工运行Sign170.cmd完成唯一外层签名。后续需读取outer-finalize-status.json。
- 用户负责本地UI/命令启动，Root只给一次短命令并读取结果；目前尚未实装正式程序，releaseQualified=false。待外签完成让用户运行Test170.cmd，C6仅共享D候选/public/results，无生产F映射。C6实例只能一个，新clean guest要在保全当前测试现场后创建，不能直接停掉其测试资料。

## 2026-10-22 09:55 更新
- 外层签名完成，outer-finalize-status=SIGNED_INTERNAL_VERIFIED；9内部签名+外层签名真实校验。仍为内部候选，不等于正式发布。
- C6真实升级已由用户点“是”，目标XjyGenuine150Host-a2/program；助手PID3516持续CPU执行（09:53约269s，09:55约325s）。目标仍1.6.2，journal尚未出现。不得误把旁边已运行的员工1.7.0窗口当作本轮升级通过。
- 手动StartUpgrade.cmd解决测试驱动cmd引号失败；首次驱动错误保留，不计产品测试通过。
- DeepSeek延迟只读诊断已派发，结果ROOT_NATIVE_LATENCY_REVIEW.md尚未收到。主机正式数据/程序未动。
