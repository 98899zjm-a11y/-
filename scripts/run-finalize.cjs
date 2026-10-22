'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process'),assert=require('node:assert/strict');
const R='D:/Codex/xjy-release-20261022',S=R+'/source',GEN=R+'/ROOT_DERIVE_NEW_OUTER.cjs',NODE='E:/node/node.exe',SIGN_NODE='C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe',LOG=R+'/outer-finalize.log';
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function run(node,file,args){const r=spawnSync(node,[file,...args],{cwd:R,windowsHide:true,shell:false,encoding:'utf8',maxBuffer:8*1024*1024,env:{...process.env,TEMP:R+'/tmp',TMP:R+'/tmp',NODE_OPTIONS:'',NODE_PATH:'',ELECTRON_RUN_AS_NODE:''}});fs.appendFileSync(LOG,(r.stdout||'')+(r.stderr||''));if(r.error||r.status!==0)throw Error('步骤失败，请保留 outer-finalize.log。退出码='+r.status);}
try{
 console.log('1/4 只读核对当前整包与签署范围');run(NODE,GEN,['--check']);
 console.log('2/4 绑定新包唯一外层签署清单');run(NODE,GEN,[]);
 const g=require(GEN),file=path.join(S,g.SIGNER_NAME),pin=hash(file);
 assert.equal(hash(SIGN_NODE),'3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237');
 console.log('3/4 使用真实校验器再次核对');run(SIGN_NODE,file,['check',pin]);
 console.log('4/4 签署并回读新包外层签名');run(SIGN_NODE,file,['sign-approved',pin,g.AUTH_TOKEN]);
 const env=JSON.parse(fs.readFileSync(S+'/c28-native-publication/native-manifest.json'));const pub=crypto.createPublicKey(fs.readFileSync(R+'/candidate/proposal/worker-draft/publisher-public.pem'));
 assert(crypto.verify(null,Buffer.from(env.manifest),pub,Buffer.from(env.signature,'base64')));const m=JSON.parse(env.manifest);assert.equal(hash(R+'/candidate/build/native-package.zip'),m.archive.sha256);
 fs.writeFileSync(R+'/outer-finalize-status.json',JSON.stringify({status:'SIGNED_INTERNAL_VERIFIED',archive:m.archive,files:m.files.length,productionInstalled:false,nativeAcceptancePassed:false},null,2),{flag:'wx'});console.log('新包签名与整包核验完成，等待沙盒安装验收。');
}catch(e){fs.writeFileSync(R+'/outer-finalize-failure.txt',e.stack);console.error(e.message);process.exitCode=1;}
