# 复用与来源

继续使用已有GitHub调研结论：本阶段复用既有1.7.0主系统backend/会话/权限、Node24内置SQLite和sharp0.35.5；不重写认证、库存算法或整套图库，也未新装全局依赖。

主系统源来自同仓库source-1.7.0，基准a970073；素材基准87da677的independent-projects/sales-materials-staff。本轮stage1/web-gateway与desktop-host-runtime是明确源级改动，原backend、local-auth和administration保持checked来源字节。stage1网关会经既有build-web-runtime进入浏览器正式构建链，但本轮只在D候选运行，未生成/安装正式更新。

[sharp](https://github.com/lovell/sharp)固定0.35.5、Apache-2.0，沿原lockfile及126份已核依赖逐字节复制到D候选，无重新下载或安装脚本。传递依赖有MIT/ISC/0BSD/LGPL等各自许可，不把所有依赖统称Apache。本次不分发node_modules/原生二进制，许可与NOTICE保留本地安装中；未来二进制分发另核完整义务。

已有官方[Qwen3-VL 4B Instruct](https://ollama.com/library/qwen3-vl:4b-instruct)仍在D盘，模型不随源码发布，原模型保留。依[Ollama结构化输出文档](https://docs.ollama.com/capabilities/structured-outputs)，本轮只给原本机视觉调用增加format JSON Schema，保持think:false/keep_alive:0/固定端点/4线程和安全门禁；不把输出格式约束宣称视觉识别事实更准。

分类Schema最小改动由真实DeepSeek Harness作者返回，Codex核验/测试与后续边界修复；主系统接线和搜索修正由Codex实现，另以不同Harness会话审查。该事实记录不新增对第三方项目的许可授权。所有实际账号、真实素材、模型和运行数据仍私有本地D盘。

## 2026-10-24 本轮继续复用

已有正确auth/backend、加密LAN、SQLite/队列及sharp接口继续使用，不另造账号、通信协议或数据库框架。新profile/transport只是可信宿主接线。源码来自同仓库a970073/86ec0ea对应受检源，当前1.7.1活动工作树不混入。

原生协议按官方[Electron v44.9.0 protocol源码文档](https://raw.githubusercontent.com/electron/electron/v44.9.0/docs/api/protocol.md)核对，并参考[v44.4.0发布记录](https://github.com/electron/electron/releases/tag/v44.4.0)的initiatorOrigin来源语义；实际独立工具runtime为44.7.0，正式44.9另验。没有采用main分支新增experimental API，也不降低sandbox/CSP/上下文隔离。

依赖提取用现成[Microsoft TypeScript v5.9.3](https://github.com/microsoft/TypeScript/tree/v5.9.3) AST，Apache-2.0；只读本机已装package/library/LICENSE三文件，固定版本/SHA，noEmit/noLib/noResolve，不执行被审源码、不下载、不进运行树。原手写mask的注释/正则缺陷保留RED后替换，88份原runtime specifier结果与旧受检数组逐项一致。

sharp0.35.5及126原生/依赖文件与许可材料逐字节装配到D准备树，仍不在Git分发。不同传递依赖各自许可不变，不把全部统称Apache。受检prepare只证明闭包和实际图片编码可用，未运行材料ASAR封包或签署安装；原资源白名单/安全门禁保持。

## 2026-10-24 实际44.9隔离验证与上游依据

本轮仅复用本机既有44.9发行纯引擎19文件（336,821,740B，源/目标及源前后摘要一致），保留LICENSE与Chromium许可；来源是本机发行副本，NotSigned不冒称官方验签。没有新下载/全局安装，也不随公开源码分发引擎、模型或原生依赖。

实际D副本实测Electron44.9.0/Node24.22.0/SQLite3.53.4。依据[Electron官方打包布局](https://www.electronjs.org/docs/latest/tutorial/application-distribution)仅在该D引擎resources/app放自有合成fixture，未复制正式app.asar、activation或数据；原preload/加密LAN/15图加载/16参考查询/opaque403/退出/重开已执行。源码或模型修改后的最新组合需按新摘要重新验证，不以旧结果代替。

物理引擎检查采用Electron内建[original-fs](https://www.electronjs.org/docs/latest/tutorial/asar-archives#treating-an-asar-archive-as-a-normal-file)，防止普通fs把不存在app.asar解释成虚拟包；只改检测工具绑定，不全局process.noAsar、不修改fuses、不关闭sandbox/CSP。Node权限模式下fsync禁用由[Node上游说明](https://github.com/nodejs/node/blob/main/doc/api/permissions.md)与本机24.22.1错误共同核实，保留失败现场；工具最终按既有正常受检Node方式执行，路径/单链接/摘要/wx/fsync校验全部保留。

上述是专用fixture，不是完整changed release-app/真实ASAR/签署/安装/真实员工或物理跨机验收。相关198断言在该真实引擎直接node:test模块中通过，未把原CLI启动或汇总器失败删除。