# 销售素材候选 0.1

仅运行 D 盘隔离图库，127.0.0.1:21963。浏览器选择本地文件夹/图片，以二进制逐个上传。不扫描磁盘/微信，不访问正式软件或业务库。本地 Ollama qwen3-vl:4b，21434；无云端上传。先可用的标签/同义词检索，非向量相似度。

## 分工和模块约定

- Root: server.mjs、lib/classifier.mjs、package/start scripts、HTTP测试、集成候选、浏览器验收及 DeepSeek。
- media_intake_parallel: lib/library.mjs、tests/library.test.mjs。导出 async openLibrary({root,classify})。root 是隔离数据目录；classify({bytes,sha256}) 返回 {sha256,decision,category,tags,reason}。复用 vendor 状态机/队列可行时优先使用；不改 vendor。服务返回 enqueue({bytes,sha256,name,sourceLabel}) -> asset，list() -> 全部资产（含未完成/暂存），get(id), file(id) -> {path,mime}或null, update(id,patch), retry(id), idle()（等当前队列）, close()。enqueue 持久化后立即返回，单工作者后台分类，重启恢复未完成。JPEG bytes由Root严格解码/转码后提供，sha256为原始上传内容哈希。只有 imported 可以被搜索；not_jewelry 为 skipped，uncertain 为 needs_review，模型异常为 awaiting_model。未经珠宝确认不可成为 imported。人工复核 update 允许 {reviewDecision:'jewelry'|'not_jewelry',confirmed:true,...}。供货状态更新必须 confirmed:true 且 evidence 非空。枚举 unknown/in_stock/order_only/reference_only。sourceLabel 为来源备注，不能自动证明现货。original name 只作展示，不用于路径。去重按 sha256。所有数据都在 root。
- module_lifecycle_fix: lib/search.mjs、tests/search.test.mjs。导出 searchAssets(assets,{query='',category='',availability='',limit=100,offset=0}) -> {items,total,interpretation}；不做网络/数据库操作。items每项资产加 matchedTerms；只 imported，按自然中文请求解析品类、可见款式及排除词，匹配可解释；不从图片/查询推断真实材质/价格/库存。无匹配返回空，不随意放宽；供货筛选必须 metadata 相等。query最长300。根据全量assets计算total后分页。客户挑样请求默认包括参考款，明确“现货”才过滤。不读取 reason 中的猜测、不把金色当黄金。
- main_integration_candidate: public/index.html、app.js、styles.css（三文件）和UI说明。原生静态JS无打包/CDN。珠宝选样工作台：文件夹/多图上传、进度、图网格、自然描述搜索、分类/供货筛选、暂存/跳过复核入口、资料修正、明确供货标识、客户看图模式（可见所有选中图的供货状态，隐藏本地文件名/来源及管理动作）。不显示虚假样本/统计；空库有可用导入入口。

## asset JSON（禁止绝对磁盘路径）

{id,name,sourceLabel,sha256,status,category,tags:[],reason,availability:'unknown',evidence:'',createdAt,updatedAt,error?}。id为server生成的不透明ID；status=queued/classifying/imported/skipped/needs_review/awaiting_model。图片 URL /api/assets/:id/image（受同源限制，本地管理预览可看暂存；只有 imported 可进客户视图）。人工复核/资料修改在独立候选允许本机操作者，不能声称已继承主系统员工权限。

## HTTP

GET /api/bootstrap -> {csrfToken,model:'qwen3-vl:4b',candidate:true,libraryLabel:'D盘独立候选图库',categories:[戒指,项链,吊坠,耳饰,手链,手镯,胸针,其他首饰],availabilityOptions:[{value,label}],maxFileBytes:20971520,maxBatchFiles:300}

所有POST/PATCH需要 header X-CSRF-Token 和同源 Origin（Origin 缺省只限有token的本机工具）；拒绝跨站/非确切Host，不启用CORS。上传逐个 POST /api/assets?name=URL编码文件名&sourceLabel=URL编码备注，Content-Type application/octet-stream，20MiB上限。返回202 {asset,duplicate:boolean}。客户端最多上传2并发，单次文件选择最多300。上传需要明确点击“开始导入”。

GET /api/assets -> {assets,counts:{all,imported,queued,classifying,needs_review,skipped,awaiting_model}}

GET /api/search?q=&category=&availability=&offset=0&limit=100 -> {items,total,interpretation}

PATCH /api/assets/:id -> {asset}，JSON可改 category/tags/sourceLabel；供货需 availability/evidence/confirmed；人工复核 reviewDecision/confirmed。UI confirm dialog提交，不能静默把建议当事实。

POST /api/assets/:id/retry -> {asset}；GET /api/health -> 模型可用状态（不含凭证）。POST /api/demo 仅 Root测试阶段可选、不属于生产API，默认不实现。

默认未启动时无后台扫描。Start-Candidate.ps1负责独立D运行时启动；候选主页可独立打开，不更改正式系统31831/员工升级源。完成后复制校验模块到主系统候选，真实主系统接入需通过既有模块授权链。
