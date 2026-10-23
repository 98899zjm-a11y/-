# 复用与依赖

先前已对比 Immich / PhotoPrism（完整图库服务，AGPL及独立部署成本）和 Transformers.js / SigLIP2（本地向量检索，额外模型及转换来源核验）。本阶段复用已验证本地 Ollama/Qwen3-VL，使用现有 Node 内置 SQLite 和经审查状态机，不引入整套图库服务。

像素解码和重编码采用 [lovell/sharp](https://github.com/lovell/sharp)，固定 npm 0.35.5，Apache-2.0；官方 npm registry 安装，使用 lockfile integrity，--ignore-scripts，无全局安装，缓存/原生依赖都在本项目 D 盘。运行时仅安装当前平台依赖。传递依赖 libvips 的许可按上游 NOTICE 保留在 node_modules，未生成向外分发包。官方发布记录：https://github.com/lovell/sharp/releases/tag/v0.35.5 。未执行 npm 自带升级提示。

Node 24.22.1 复用 D 盘已校验官方发行。vendor/intake-state 是之前经过 DeepSeek 审查的本项目状态机，保持原字节。sqlite-queue 是外部独立目录中保留的历史已审组件，未复制到本项目或此次源码清单；当前图库的元数据/人工复核模式使用单独 SQLite schema，未同时创建两套持久队列。图库和界面的本轮审查见REVIEW_STATUS.md。

本阶段中文搜索是名称、品类和可见标签的规则/同义词检索。没有向量模型，没有训练，没有宣称通用语义相似度或真实材质识别。现有看图模型仍可能误标/漏判，提供已跳过图片复核和资料修正入口。

2026-10-23员工候选补充：复用本项目1.7.0的真实认证与员工管理代码（4个CJS、3个SQL），在独立内存账号库内运行；保留来源及校验记录，不连接正式员工数据。auth/lib/access-adapter.mjs把销售模块的view/operate/manage接到原requireAccess和服务端会话检查。该代码归属沿用本项目既有规则，复制不新增对第三方的许可授权。

按用户批准，在D盘另增官方Ollama [qwen3-vl:4b-instruct](https://ollama.com/library/qwen3-vl:4b-instruct)，保留原qwen3-vl:4b；仅本员工候选显式选用Instruct。模型来源为[Qwen3-VL官方代码与模型说明](https://github.com/QwenLM/Qwen3-VL)，4B许可为Apache-2.0；模型文件不随源码仓库或本次交付包发布。实际16图对比未达到无人复核的细分类及找图要求，因此新候选默认把珠宝分类结果保留为待管理复核，已淘汰图片只能经管理者明确复核恢复，员工不能直接重试绕过。
