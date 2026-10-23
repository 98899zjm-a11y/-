import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const files=['server.mjs','lib/library.mjs','auth/lib/access-adapter.mjs','auth/candidate-authority-host.mjs','auth/vendor/desktop/local-auth.cjs','public/index.html','public/app.js','tests/server.test.mjs','tests/staff-helper.mjs','tests/staff-http.test.mjs','tests/commit-access.test.mjs'];
let packet='请作为独立DeepSeek审查者审查本次员工权限素材候选的代码；这不是你刚编写的库存模块。不要改文件、不调用工具，不声称执行本机测试。请中文给具体缺陷，优先401/403授权、会话换代、CSRF、异步上传/手工复核提交前撤权、字段泄漏、UI晚到响应。最终限定能否进入本机主系统候选；只给可证实代码路径/复现，不因本机虚构账号不是正式账号就当功能漏洞。不要以主观新规则建议删除已确认资料。\n请返回JSON {findings:[{severity,file,problem,trigger,suggestion}],conclusion:string,limitations:string[]}，1200字以内，不需要大段逐行思考。\n\n用户范围：不影响正式版，不改真实账号/权限/库/升级；全D盘。21963旧候选继续运行，新21964使用原系统createAuth/scrypt和administration代码在独立内存SQLite里建随机口令的虚构view/operate/manage/disabled员工。正式backend闭包hook尚未修改，不能宣称正式员工已接通。本阶段完成同源候选真实认证/权限链和可注入trusted resolveAuthority seam；没有新增正式能力/联网暴露。UI没有口令/自报role，HttpOnly cookie +权限重查；只读员工仅imported与款式/供货白名单，operate可导入/标签修正但不能供货/人工复核，manage重要修改仍必须确认/依据。\n\n所有写路由authorize后，把ticket.check传进library最终事务前；上传入口/排队后/写文件准备后及响应前都检查。准备阶段已留的文件是隔离内部副本，不写目录外；撤权不能创建可见资产或修改业务记录。后台分类是已授权提交任务，不给AI供货权。未启用云端图片发送/微信/正式库存；真实素材16张及其原路径/模型原始图像未给你，下面仅代码与虚构测试。当前自动细分效果仍在诊断，不在本包宣称分类准确率。\n';
const manifest=[];
for(const file of files){const bytes=await fs.readFile(path.join(root,file));manifest.push({file,sha256:createHash('sha256').update(bytes).digest('hex')});packet+='\n===== '+file+' =====\n'+bytes.toString('utf8');}
const admin=await fs.readFile(path.join(root,'auth/vendor/desktop/administration.cjs'),'utf8');
const lines=admin.split('\n');packet+='\n===== 原administration关键上下文（原文件只读复用，其余CRUD未改） =====\n'+lines.filter(line=>/requireAccess|function live|grantRevision|function grants|function getPermissions|function updatePermissions|moduleAccess|function resolve/.test(line)).join('\n');
for(const log of ['staff-http-first-behavior.log','library-commit-green.log','commit-access-red.log'])packet+='\n===== 开发者实际输出 '+log+' =====\n'+await fs.readFile(path.join(root,'evidence',log),'utf8');
packet+='\n===== 原认证模块15项开发者测试 =====\n'+await fs.readFile('D:/Codex/xjy-sales-materials-auth-20261023/evidence/auth-final-tests.log','utf8');
packet+='\n原第三方代码未改变业务规则；admin requireAccess每次重新调用grants(user)，底层live(user)查当前staff_users active，grants含grantRevision。原源文件SHA已逐项比较维护树与最新公开1.7.0源码归档一致。新适配器独立Brand WeakSet防自报authority，同模块导入host/adapter，没有混两个brand副本。\n没有真实业务或正式权限接通，不能用该限定审查替代正式上线批准。请明确有效缺陷，不凭猜测制造阻断。';
await fs.writeFile(path.join(root,'evidence/auth-review-task.txt'),packet);
await fs.writeFile(path.join(root,'evidence/auth-review-manifest.json'),JSON.stringify(manifest,null,2));console.log(JSON.stringify({files:files.length,characters:packet.length}));
