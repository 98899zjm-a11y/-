# 实际审查与验证

2026-10-23，DeepSeek Harness真实独立审查和复查素材权限，限定本机候选无剩余所报授权阻断；不代表正式上线/真实员工授权通过。

provider/model为deepseek-account/deepseek-flash；只读认证沿既有provider，17个tool入口关闭、无文件/shell/web/subagent。真实图片、商品清单、业务库、口令与密钥未给它。session-c48a54b9-85f7-4bbf-b0d4-df2428e8c639收到final/completed。

首轮指出operate retry绕过管理淘汰、读图期间降权或变skipped仍返回。Codex补真实HTTP三负例得到202/200/200而非403，保留harness-findings-red.log；最小修复为HTTP/library双层禁skipped retry、UI二次防守、图片最终同步重读actor/status后无await响应。相同会话提交实际修复与RED/GREEN，收到findings=[]，原文在evidence/harness-auth-review-final.json和harness-auth-recheck-final.json。测试由Codex执行，未声称DeepSeek跑测试。

最终接线审查另存evidence/harness-integration-review-final.json：没有本机候选移交阻断，保留1项low。启动器若发现21964已监听，只按health的4个字段复用，未把该运行实例绑定到冻结清单摘要；因此不能仅凭复用提示认定已有进程属于本次冻结源码。Codex在本阶段接受这一同机信任限制：本次实际实例由已核对的entry启动，37个源码文件逐字节校验；本候选仅限loopback，不将这种复用判定作为正式部署或其他本机进程可信的证明。正式安装接线前应补实例身份核验。本项未当作已修复，也未把最终接线审查写成findings=[]。

evidence/final-all-tests.log：素材76+原认证15=91通过，0失败/跳过。候选entry-parent-final.log 10通过，覆盖固定边界、冻结先行、相对ESM/CJS/SQL依赖缺失拒绝。原组件/脚手架错误与业务RED保留并区分，未删除失败测试或放宽断言。

evaluation/instruct-result.json是唯一16图/8查询对比：Instruct输出完整更快但有效检索2/8，不是自动达标。evidence/real-folder-acceptance.json记录同SHA真实推理缓存经真实鉴权HTTP导入，先0自动入库、15待复核/1识别错误；测试管理者按冻结视觉基准确认15、含混1保留；8查询8匹配、供货全unknown。这不是新模型成绩或商家审核资料。

Harness库存作者返回代码，Codex独立核验发现非法日期与空来源，实际回作者修复且保留原10断言、新4与独立8，22通过。这是作者开发/修复+Codex独立测试，不冒称作者自审为独立DeepSeek审查。源码无fs/network/process，宿主authorize/loadReport必须承接正式权限；不能当实时库存。

实际页面登录、角色控件/清屏及客户展示证据留D。全部真实图、DB、运行/评估数据、私有测试账号、原始Harness日志排除Git；提交前白名单逐字节、密钥/财务形状/暂存树/新提交扫描。完整Electron/生产账号/backend闭包hook/微信/实时库存/正式安装/大规模恢复不在本阶段通过范围。loopback cookie等附带说明不作为正式远程安全结论。
