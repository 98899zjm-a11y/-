# 复用与依赖

先前已对比 Immich / PhotoPrism（完整图库服务，AGPL及独立部署成本）和 Transformers.js / SigLIP2（本地向量检索，额外模型及转换来源核验）。本阶段复用已验证本地 Ollama/Qwen3-VL，使用现有 Node 内置 SQLite 和经审查状态机，不引入整套图库服务。

像素解码和重编码采用 [lovell/sharp](https://github.com/lovell/sharp)，固定 npm 0.35.5，Apache-2.0；官方 npm registry 安装，使用 lockfile integrity，--ignore-scripts，无全局安装，缓存/原生依赖都在本项目 D 盘。运行时仅安装当前平台依赖。传递依赖 libvips 的许可按上游 NOTICE 保留在 node_modules，未生成向外分发包。官方发布记录：https://github.com/lovell/sharp/releases/tag/v0.35.5 。未执行 npm 自带升级提示。

Node 24.22.1 复用 D 盘已校验官方发行。vendor/intake-state 是之前经过 DeepSeek 审查的本项目状态机，保持原字节。vendor/sqlite-queue 作为已审组件保留，当前图库的元数据/人工复核模式使用单独 SQLite schema，未同时创建两套持久队列。新图库和界面须单独审查。

本阶段中文搜索是名称、品类和可见标签的规则/同义词检索。没有向量模型，没有训练，没有宣称通用语义相似度或真实材质识别。现有看图模型仍可能误标/漏判，提供已跳过图片复核和资料修正入口。
