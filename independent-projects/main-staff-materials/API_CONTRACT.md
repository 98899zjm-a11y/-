# 主系统同会话素材合同

本合同适用于本轮D盘候选。正式员工/当前正式会话不因源码合同自动接通；program-side materials-runtime-capability.json须显式{version:1,enabled:true}且受检，缺失默认false。employee只用远端，不加载profile库。

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
