'use strict';
// Separate release entry admission. The original isolated main.cjs stays blocked.
const fs=require('node:fs'),path=require('node:path');
function fail(message){throw new Error('发布程序隔离验证：'+message);}
function ownedPath(root,value,{archiveCodeTarget=false}={}){
 if(typeof value!=='string'||!path.isAbsolute(value)||/^[\\/]{2}/.test(value)||/[\x00-\x1f]/.test(value)||process.platform==='win32'&&value.slice(3).includes(':'))fail('目录必须是普通本地绝对路径');
 const target=path.resolve(value),relative=path.relative(root,target);if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))fail('目标目录不在隔离根内');
 for(let current=target;;current=path.dirname(current)){if(fs.existsSync(current)){const stat=fs.lstatSync(current),archive=archiveCodeTarget&&current===target&&path.basename(target)==='app.asar'&&stat.isFile()&&stat.nlink===1;if(stat.isSymbolicLink()||!stat.isDirectory()&&!archive)fail('目录含链接或不是普通目录');}if(current===path.dirname(current))break;}
 let ancestor=target;while(!fs.existsSync(ancestor))ancestor=path.dirname(ancestor);const real=path.resolve(fs.realpathSync.native(ancestor),path.relative(ancestor,target)),r=path.relative(fs.realpathSync.native(root),real);if(r==='..'||r.startsWith('..'+path.sep)||path.isAbsolute(r))fail('实际目录越过隔离范围');return real;
}
function isolationAncestor(codeDir){for(let p=path.resolve(codeDir);;p=path.dirname(p)){if(fs.existsSync(path.join(p,'isolation-identity.json')))return p;if(p===path.dirname(p))return null;}}
function admitRelease({isPackaged,codeDir,environment=process.env,validateSandbox,activation,programVersion='1.6.0'}){
 const ancestor=isolationAncestor(codeDir),testRoot=environment.XJY_RELEASE_TEST_ROOT;
 if(ancestor||testRoot||!isPackaged){
  if(typeof testRoot!=='string'||!path.isAbsolute(testRoot)||typeof validateSandbox!=='function')fail('开发副本仅可经实际 Windows Sandbox 验证启动');
  const root=path.resolve(testRoot);ownedPath(root,codeDir,{archiveCodeTarget:isPackaged===true});if(ancestor&&path.resolve(ancestor).toLowerCase()!==root.toLowerCase())fail('Sandbox 根与程序身份不一致');
  const dataDir=ownedPath(root,environment.XJY_DATA_DIR);if(dataDir===root)fail('数据目录必须与隔离根分开');
  const proof=validateSandbox(root);if(!proof||proof.sandbox!==true)fail('实际 Sandbox 验证未通过');
  return Object.freeze({mode:'sandbox',root,dataDir,publicAccess:false});
 }
 if(environment.XJY_DATA_DIR||environment.XJY_STAGE1_ROOT||environment.XJY_STAGE1_NAMESPACE)fail('正式发布入口不接受遗留测试环境路径');
 if(!/^1\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(programVersion)||!activation||activation.version!==1||activation.product!=='xjy-jewelry-offline'||activation.programVersion!==programVersion||!['host','employee'].includes(activation.role))fail('此候选包尚未通过一键升级安装，禁止直接连接正式资料');
 return Object.freeze({mode:'installed',role:activation.role,publicAccess:false});
}
module.exports={admitRelease};
