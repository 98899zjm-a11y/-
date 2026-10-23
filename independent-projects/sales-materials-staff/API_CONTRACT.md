# 员工素材0.2接口

仅127.0.0.1:21964，原认证代码+内存虚构账号。无真实backend会话映射时不声称正式身份接通。正式接入须由可信主服务器提供resolveAuthority，不能用浏览器自报userId/role。私有D测试口令不公开。

GET /staff-auth/status 建立随机HttpOnly/SameSite=Strict会话，返回登录CSRF。POST /staff-auth/login/logout要求精确Origin与X-Auth-CSRF-Token；登录轮换cookie/CSRF，退出作废旧身份。

GET /api/bootstrap 登录且sales至少view，返回绑定员工/会话的素材csrfToken、权限、图片限制、品类及供货枚举。写API精确Origin+X-CSRF-Token，服务侧每次查当前权限/会话；异步完成后真实事务前再check。

- view：GET assets/search/image，只有imported可展示；不返回原名/来源/摘要/原因/依据等管理字段，不得看到待复核图片。
- operate：可POST assets（二进制20MiB，JPG/PNG/WebP，两个接收并发）、PATCH分类/款式标签/来源、POST id/retry（仅awaiting_model/needs_review）。不能供货/人工复核。
- manage：以上及PATCH availability/evidence/reviewDecision。供货必须confirmed:true和非空evidence，人工复核confirmed:true；混合字段分别检查。所有skipped禁retry，恢复必须管理者显式确认首饰。

供货值unknown/in_stock/order_only/reference_only，不能从图片/数量推出。默认AI建议经review-first变needs_review，人工核图才可用。分类/检索不是完整语义/材质鉴定，精细标签仍未达全自动。

GET /api/health只给候选/认证要求/固定本地模型就绪，不返回业务资料。图片发出前同步重查最新actor与asset状态，无await后才发送已校验Buffer。公开资源仅固定三个前端文件；无CORS、不允许模型指定URL/SQL/权限。

重要接口返回401/403时客户端清空图片/选择/编辑和晚到请求，回登录；权限或会话变化同样清空。客户选图仅展示已确认素材及供货标识，不是独立客户账户。

库存库独立登记runtimeEnabled=false，只读approved授权快照且quantity保持字符串。没有实时库存或OpenClaw工具激活，不改变生产账号/业务库/安装源。
