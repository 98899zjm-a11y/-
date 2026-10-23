# 复用与来源

继续使用已有GitHub调研结论：本阶段复用既有1.7.0主系统backend/会话/权限、Node24内置SQLite和sharp0.35.5；不重写认证、库存算法或整套图库，也未新装全局依赖。

主系统源来自同仓库source-1.7.0，基准a970073；素材基准87da677的independent-projects/sales-materials-staff。本轮stage1/web-gateway与desktop-host-runtime是明确源级改动，原backend、local-auth和administration保持checked来源字节。stage1网关会经既有build-web-runtime进入浏览器正式构建链，但本轮只在D候选运行，未生成/安装正式更新。

[sharp](https://github.com/lovell/sharp)固定0.35.5、Apache-2.0，沿原lockfile及126份已核依赖逐字节复制到D候选，无重新下载或安装脚本。传递依赖有MIT/ISC/0BSD/LGPL等各自许可，不把所有依赖统称Apache。本次不分发node_modules/原生二进制，许可与NOTICE保留本地安装中；未来二进制分发另核完整义务。

已有官方[Qwen3-VL 4B Instruct](https://ollama.com/library/qwen3-vl:4b-instruct)仍在D盘，模型不随源码发布，原模型保留。依[Ollama结构化输出文档](https://docs.ollama.com/capabilities/structured-outputs)，本轮只给原本机视觉调用增加format JSON Schema，保持think:false/keep_alive:0/固定端点/4线程和安全门禁；不把输出格式约束宣称视觉识别事实更准。

分类Schema最小改动由真实DeepSeek Harness作者返回，Codex核验/测试与后续边界修复；主系统接线和搜索修正由Codex实现，另以不同Harness会话审查。该事实记录不新增对第三方项目的许可授权。所有实际账号、真实素材、模型和运行数据仍私有本地D盘。
