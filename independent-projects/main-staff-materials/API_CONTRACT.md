# 主系统同源素材接口合同

本合同只适用于D盘候选。正式员工账号、正在运行的正式会话、原生/LAN路由或正式profile存储没有因这份合同自动接通。

入口/materials/由原主系统浏览器网关挂载。原/session、/auth/login、/auth/logout及原reloginAudit管理浏览器会话；素材不建立第二份员工身份。候选固定独立cookie前缀，默认网关不传时保持原行为。未登录的精确GET /materials及/materials/返回303 Location:/；API及其它路径仍按认证/规范路径拒绝，不把JSON错误当登录页面。

主网关向内部handler提供不可由请求选择的session、administration、isLive、origin和gatewayCsrf。材料authority读取真正auth.sessionId、active与sales权限。角色view只看imported的公开字段；operate可导入/标签来源维护/允许状态重试；manage才可明确复核和确认供货依据。前端role/id、确认布尔值和单独csrf都不是身份。

POST/PATCH同时要求当前同源主系统x-xjy-csrf和素材x-csrf-token。素材凭证绑定authority、员工和usage session，不能在另一个浏览器、同人重登或退出后复用。关键操作在实际事务前同步复查，读图在实际发送已验证bytes前同步重读当前身份及素材状态。维护、后端替换、停用、改密码和撤权必须失效。

GET /materials/staff-auth/status只是当前主系统会话的素材投影，不执行独立登录；GET /materials/api/bootstrap给当前素材权限和防伪凭证；GET assets/search只返回当前角色允许内容。素材退出按钮调用原/auth/logout。退出/401/403、切号或等级变化清空图片、选择、对话框与晚请求，返回主系统登录。

写入成功回执固定为accepted:true与asset:{id}；上传另有duplicate布尔值。它表示该次已授权接收或保存，不代表已识别、已复核、现货或财务确认。事务成功后不再用新的权限状态把已提交操作答成失败，也不把旧权限下完整资料放入回执。界面随后重新按当前权限读取；若届时撤权，可正确收到拒绝。duplicate路径也必须在返回前执行最终同步授权。

模型输出只作可见结构分类建议，默认管理复核；供货仅由明确记录与依据确认。搜索使用已登记安全标签及供货枚举；未知不证明有无现货，显式无特征需缺失证据。普通排除的未知限制在解释中提示；OR执行尚未实现，不能伪称通用语义检索。

资料保全：上传生成的隔离JPEG若在最终授权/事务前失败，可以留在独立store但没有DB记录、列表/查询不可见、API按ID无法读取；不自动删除未知文件。原图始终保持。候选重启只能打开独立路径、合法synthetic marker和已核schema；拒绝别名/硬链接、未知非空库和日志现场。正式存储/清理策略需另外验收。
