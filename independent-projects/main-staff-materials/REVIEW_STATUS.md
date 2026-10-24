# 本轮独立审查与验收范围

2026-10-24。本轮五组真正DeepSeek Harness独立审查已收到最终回复，已证实源码问题均处理；这只覆盖给定工程与虚构/聚合证据，不批准正式上线。作者与审查会话分开；Codex执行测试，Harness未声称复跑。

| 板块 | 作者 | 独立审查 | 最终范围结论 |
|---|---|---|---|
| 分类/输出 | 16d94b43 | bcc1b93b三轮 | 阻断为空；负例bucket争议按真实decision→skipped与8类存储合同澄清关闭；空白/不可见词边界已RED/GREEN；P3标点语义有限性接受 |
| profile存储 | a68124b7 | ad885eef三轮 | findings=[]/blocking=false；S1/S2/S3/N1关闭；S4外部marker与S5孤儿JPEG保全接受 |
| native/LAN核心 | ad69112f/852855bc | 8485b316三轮 | remaining/newFindings空、coreBlocking=false；finalAcceptance=false保留完整正式入口与平台验收条件 |
| 构建准备 | 9e502b7d四轮 | ffccc9a6四轮 | findings=[]/blocking=false；B1–B3/NB1/N2/N3关闭，AST/工具/回执顺序有真实RED/GREEN |
| 启动组合 | 6a11e373五轮 | 9eb7e4ca三轮 | findings=[]/blocking=false；B1/B2/B5/B6/B7/B8/N1关闭，B3关键源子集/B4残留/N2 openRequested限制接受 |

作者返稿中被独立核验拒绝的无关退化保留：library SQL括号/删guard、builder跳依赖或缺模块、descriptor字典遗漏__proto__、启动默认端口字段等。没有整文件盲收、删失败断言或放宽阈值制造通过。初次runner权限/路径、Node模式与证据行号偏差也保留，与真实产品RED分开。

最终本机相关集合443/443、0失败/跳过。真实最新准备树Electron44.7验证最终Native729048/LAN581a、原backend+profile SQLite+原加密loopback+remote workspace+原preload：15图加载、同登录、opaque403、退出清空、重开15；32图A/B与e808纯回放的准确率结论分开。实际最终CLI498650启动/重复拒绝/nonce停/新PID重启已控测，实际页面三角色与找图/保存/客户展示已验。详见本阶段各result和final-cli-lifecycle-verification。

接受限制：无DB隔离JPEG不自动清理；未知临时/陈旧owner拒绝保全；外部并发可能留下own marker；关键词守卫不证明任意中文语义；关键9源摘要不是完整闭包，Root另做白名单freeze；openRequested不是页面已显示；不声称对抗恶意本机管理员全部TOCTOU。

仍未验证：完整changed release-app入口、正式44.9与真实ASAR、完整编译/封签/安装/升级/回滚、外机LAN/防火墙、正式员工/生产数据与备份、Windows原生文件/目录对话框、自动采集/微信/OpenClaw业务工具。filechooser工具超时且CDP不支持，未绕过；HTTP/LAN批量接收不能替代该项。材料seal仍硬拒。

所有原final/session/run、处置、RED/GREEN、视觉及源摘要都只在D:/Codex/xjy-main-staff-session-20261023/evidence/storage-client-lan-20261024。外部仅收源码、虚构测试和聚合；真实图片/清单/账号/DB/raw推理/私钥未发送。SOURCE_PROVENANCE与API_CONTRACT描述源码来源/接口，不代替上述验收。
