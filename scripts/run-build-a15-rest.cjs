'use strict';
// run-build-a15-rest.cjs —— 承接 run-build-a15.cjs 的第 1、2 步（已手工完成），执行第 3-6 步与整包审计。
const fs=require('node:fs'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const R='D:/Codex/xjy-release-20261022',S=R+'/source',C=R+'/candidate',NODE='E:/node/node.exe';
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const stateFile=R+'/build-status.json',log=R+'/build-a15-rest.log';
if(fs.existsSync(stateFile)){console.error('已有运行记录');process.exit(2);}
let stage='start';const write=(status,extra={})=>fs.writeFileSync(stateFile,JSON.stringify({status,stage,updated:new Date().toISOString(),...extra},null,2));
function run(name,file,args=[]){stage=name;write('WORKING');console.log(name);const r=spawnSync(NODE,[file,...args],{cwd:R,windowsHide:true,shell:false,encoding:'utf8',maxBuffer:8*1024*1024,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',TEMP:R+'/tmp',TMP:R+'/tmp'}});fs.appendFileSync(log,'\n'+name+'\n'+(r.stdout||'')+(r.stderr||''));if(r.error||r.status!==0)throw Error(name+'失败；退出码='+r.status+'；详见 build-a15-rest.log');}
try{
 const fsx=require('node:fs');
 const arch=R+'/evidence-c6-failed-170/rerun-'+Date.now();
 const moveIf=(p)=>{if(fsx.existsSync(p)){fsx.mkdirSync(arch,{recursive:true});fsx.renameSync(p,arch+'/'+require('node:path').basename(p));}};
 moveIf(S+'/sign-worker-release.cjs');moveIf(S+'/worker-scope.json');moveIf(S+'/worker-signing-report.json');moveIf(C+'/approvals');moveIf(C+'/build');
 run('3/6 绑定唯一内部签署范围',R+'/derive-worker-signer.cjs');
 run('4/6 签署并验证新工作程序清单',S+'/sign-worker-release.cjs');
 run('5/6 制作完整程序和员工补丁',S+'/prepare-release.cjs',['build','--proposal-sha256',hash(C+'/proposal/proposal-manifest.json')]);
 run('6/6 绑定整包独立校验器',R+'/derive-auditor.cjs');
 const a=JSON.parse(fs.readFileSync(C+'/build/assembly.json'));
 run('整包校验、脚本语法和签名检查',S+'/audit-release.cjs',['--archive-sha256',a.archive.sha256,'--assembly-sha256',hash(C+'/build/assembly.json'),'--published-at',new Date().toISOString(),'--expires-at',new Date(Date.now()+90*86400000).toISOString()]);
 stage='complete';write('BUILT_INTERNAL_AUDITED',{archive:a.archive,productionInstalled:false,finalAcceptancePassed:false});console.log('内部构建与整包校验完成。');
}catch(e){write('FAILED',{error:e.message});console.error(e.message);process.exitCode=1;}
