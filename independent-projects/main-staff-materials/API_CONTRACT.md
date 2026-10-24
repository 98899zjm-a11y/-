# 主系统同会话素材合同

本合同适用于本轮D盘候选。正式员工/当前正式会话不因源码合同自动接通；program-side materials-runtime-capability.json须显式{version:1,enabled:true}且受检，缺失默认false。employee只用远端，不加载profile库。

## 视觉协议与检索语义（本轮新增，仍未真实模型验收）

createClassifier的schemaVersion属于受信构造选项，不是客户端权限或HTTP开关；缺省legacy-v1。显式visual-v2的模型内部只接decision/category/features/structure封闭枚举，无自由tags/reason，外部仍投影为原sha256/decision/category/tags/reason。新模式未被当前运行入口选用，mock测试和参考标签成绩不代表真实图像事实。

主类证据不明确/非首饰、未知视图或完整声明与局部视图冲突时弃权。T/十字以旋转镜像无关的三/四方向证据投影；shape unknown仅该形状弃权，不由axis猜标签，也不自动否定仍明确的主类。项链/手链与carrier须双向一致；none不能同时声明完整链身或附件present。unknown carrier/附件不产生无吊坠或挂件标签；absence只在明确完整匹配carrier时生成。

检索两种否定有明确区别：普通“不要/不喜欢/排除”只排除已登记正特征，允许未记录者作为有限候选，但证据必须not_recorded且返回unrecorded_exclusion及“未记录不保证不存在”的说明；“无/没有/不带/不含”必须explicit_absence。不要把普通候选说成保证无特征，也不擅改成更严格产品语义。供货是另一规则：unknown永不证明正反现货状态。

正向独立“吊坠”是商品主类；明确承载链或显式吊坠缺失要求按挂件事实解释，不能仅因类别不是吊坠就满足“没有吊坠”。未核材质正请求只退到类别/可见款式并明确警告，不证明材质；负材质要求无法核实则拒绝，标签材质不能成为literal款式匹配条件。珍珠仅珠饰外观、金/银/玫瑰金色仅可见颜色的既有例外保持。
## 存储与宿主

openProfileLibrary({dataRoot,classify})只给可信本机固定销售素材目录铸内部capability；原openLibrary({root,classify})仍限原runtime。拒未知非空、坏marker、日志残留、别名/多链接、库/图缺失或非文件；不重建未知现场。createMaterialRuntimeSuite({origin,dataRoot,classify})先验loopback origin，默认review-first，返回冻结handle、sessionRequest、close；关闭使原isLive失效，构造失败正常close。

原desktop-host-runtime受信factory先核目录不与业务/配置/日志/备份重叠；同库HTTP与sessionRequest共用。宿主请求绑定当前backend.administration，维护/替换/关闭后旧context拒绝；默认不启factory。release服务只转发内建工厂，不接受HTTP选择目录或角色。

## HTTP与LAN/本机

原网关/session、/auth/login、/auth/logout管理浏览器entry；materialsHandler只接服务器捕获的session/administration/isLive/origin/gatewayCsrf。素材不单建身份。精确匿名/materials文档导航303回主系统；API保留401/403。不同cookie前缀隔离候选。

原加密LAN新增materials op，token映射真正createSession，pin/加密/重放/资源限制保持。客户端只传{path,method,headers?,bodyBase64?}，不能自报user/role/session/Root目录。headers只content-type、x-xjy-csrf、x-csrf-token；规范path总<=4096，query中的编码分隔符作为数据，不能逃出固定路由。上传<=20MiB、LAN PATCH<=16KiB且JSON对象，响应<=24MiB；HTTP原PATCH有自己的64KiB限额。GET规范空body可为缺省或空串，非空拒绝。只有search和upload对应受限query，health不在LAN/native白名单。

network.materialsRequest本机wrapper绑定backend+实际auth.sessionId+generation，remote经原client同登录；两端都用相同envelope{status,headers,bodyBase64}，安全header白名单，无cookie/授权凭据/任意跳转。原request/image/auth语义不作材料工具权限替代。

写同时要求该实际主会话x-xjy-csrf和素材x-csrf-token，素材凭证绑定authority/员工/usage session。view只读imported公开字段，operate导入/标签来源维护，manage才可复核和供货依据确认；关键事务前同步check，异步后不沿用过期票据。成功写回执只accepted:true与asset:{id}（上传另duplicate），不携旧权限私密资料，不因late权限变化误答未保存。

## 原生与最后发送边界

jewelry://app/materials只处理固定3代码资产与上述路由，固定真实根/单链接/FD身份检查。普通来源必须精确jewelry://app；browser自发导航字段缺省按当前合同处理，显式null/空/外站拒绝。真实44.7已观察app200和opaque字符串null403；完整changed release入口/正式44.9仍另验。

成功GET envelope可带仅内部Symbol.for('xjy.materials.finalizeRead')的own同步函数，实际authority快照绑定staff/user/session/level/grantRevision。server encrypt前、native Response前最后同步调用；Promise/thenable/accessor拒绝，wire绝不序列化或接受函数。POST/PATCH剥掉这个read-only seal再严格校验其他字段，成功ACK不依赖它。native epoch在body/read静态/异步响应边界复验，旧图不回填新登录。

素材退出经原preload或原HTTP/auth/logout，页面清图片、选择、弹窗和晚请求。供货unknown不证明有无现货；manager review/evidence/confirmed不由模型替代。OR和任意自然语言语义不保证；显式无特征需要缺失证据。

## 启动保全与范围

新候选仅D合成main-data，不setup缺失业务库；HTTP21965/LAN21966都loopback。CLI无自由路径/账号/端口覆盖，内部fixture仅受检新子目录+port0。后台仅本次私有IPC/nonce adopt，无kill/自动恢复；owner/临时残留保全。9关键源摘要是子集，完整源码/暂存/commit另核。实际--launch/重复拒绝/--stop/重启已测；openRequested不表示浏览器已显示，PS策略未改。正式安装/真实网络与正式账号修改另确认。

## 2026-10-24 有限标签检索边界

搜索只核登记款式标签，不证明化学材质、真假、价格或库存。当前词表在“石和玉”等无分隔单字组合及“大理石”等未覆盖人工标签上仍可能保留literal（P3，已实测留证）；不能把命中证据当材质验证。不为凑命中率硬拆并蒂莲等完整款式词，无分隔未知词连接词可能漏检。显式缺失必须有absence证据，unknown供货保持待核实；新视觉模型精度须另外实测。
