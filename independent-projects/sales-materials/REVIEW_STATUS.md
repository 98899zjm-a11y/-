# 本机素材候选的独立审查

2026-10-23，结论：**DeepSeek 实际复查完成，限定本机隔离候选可移交。** 不代表正式主系统、员工权限、安装升级或真实图库准确率通过。

实际会话：https://chat.deepseek.com/a/chat/s/87d3a7b4-ab49-40a2-93f6-40d9f63f9998 。由 Codex 经内置浏览器发送本阶段最小源码、约束、虚构测试及实际输出；没有发送真实客户、库存账目、图片或密钥。首份附件约120KB；首轮长输出达到生成上限，尚无可用最终结论，另发精简结论请求后才收到最终意见；没有把“材料已发”当“审查通过”。随后提交修复和核验证据，实际收到复查。

## 意见处置

- “reviewDecision重置供货依据”：原代码已保留，新增精确回归首次即通过。非首饰判定后保留原供货资料，仅status=skipped，搜索/展示只取imported；恢复仍须确认。没有根据误读删除已确认资料。DeepSeek 最终明确撤回。
- “不要戒指 简约会再次加入正literal”：源码不支持该机制，精确负例修前即通过。无分界时否定范围延续属于已声明的简化解析。DeepSeek 最终撤回，没有据猜测重写。
- 源码清单漏vendor状态机：真实失败6通过1失败，补入后7通过；已冻结并校验14源文件。另记录Node二进制及126个实际安装依赖文件摘要、SQLite实际版本、sharp和lockfile摘要。此清单是源码检查，非防本机管理员的安装签名，不重复做大包启动检查。
- Root额外发现并先失败后修复：正斜UNC漏拒绝、HTTP丢弃已验图片Buffer再读路径、否定材质删除后错误排除整类。复查接受三项修复。审查者关于HTTP字样的一处附带解释未作为验证结论；实际字段校验以源码和测试为准。

## 当前可复核证据

- evidence/full-suite-final.log：**50通过、0失败、0跳过**，包含像素转码4、图库22、检索21、真实HTTP3；Node24.22.1退出0。测试由开发者执行，DeepSeek只评估代码与证据。
- 主候选 sales-materials-integration/evidence/entry-parent-final.log：7通过；source-manifest.json：14文件，实际--verify返回ok。
- evidence/entry-runtime-acceptance.json：实际从主候选启动桥启动21963，重启前后资产JSON一致，2资产=1首饰/1跳过，正式31831仍原进程29764。
- evidence/live-classifier-samples.json：公开CC0两图实际本地推理，戒指进入首饰、杯子跳过；戒指标签“珠饰”错误已真实观察后手工修正，未冒充自动标签准确率通过。
- evidence/ui-final-workbench.png、ui-customer.png：真实选择多图/开始导入、标签/供货确认、客户描述找图与客户展示；实际整文件夹含2图1txt过滤txt、再导入2duplicate。
- evidence/deepseek-review-packet.txt、deepseek-concise-request.txt、deepseek-recheck-packet.txt：实发材料；deepseek-first-reply.txt、deepseek-recheck-reply.txt、deepseek-recheck.png：实际回复和原页截图。
- evidence/gitleaks-final-source.json及gitleaks-staged-tree.json：白名单源码树及实际暂存导出树未检出密钥；29项暂存文件与审查源码逐字节一致，未检出16—19位财务形状数字。证据、数据库、图片、依赖及运行目录不进入公开Git。

首轮/边界修复失败记录均保留。尚未验证：大规模图库与故障恢复矩阵、真实业务分类效果、员工多用户权限、微信采集、实时库存、正式Electron安装/升级、OpenClaw工具修改软件或业务数据。模型建议不是材质、价格或供货事实。
