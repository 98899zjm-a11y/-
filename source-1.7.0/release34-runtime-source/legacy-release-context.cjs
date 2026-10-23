'use strict';
const fs=require('node:fs'),path=require('node:path');
const {createDesktopModuleContext,writeSignedContext}=require('./release-layout.cjs');
const ENVIRONMENT=new Set(['PATH','SYSTEMROOT','WINDIR','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','PROGRAMFILES','PROGRAMFILES(X86)','PROGRAMDATA','HOMEDRIVE','HOMEPATH','SYSTEMDRIVE','COMSPEC','USERNAME']);
function prepareReleaseEnvironment({moduleId,dataDir,codeDir,token,releaseContext,environment=process.env}){
 if(globalThis.__xjyStage1Guard)throw new Error('隔离模块不能切换成发布模式');
 if(!releaseContext||Object.keys(releaseContext).sort().join(',')!=='hostId,profileDir'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(releaseContext.hostId)||!['ledger','inventory'].includes(moduleId))throw new Error('发布模块身份 identity 无效');
 const profileDir=path.resolve(releaseContext.profileDir),runtimeDir=path.join(profileDir,'module-runtime',moduleId);
 // Reject links before mkdir. The signed-layout validator repeats all checks
 // after directory creation and immediately before context publication.
 for(let p=runtimeDir;;p=path.dirname(p)){if(fs.existsSync(p)&&fs.lstatSync(p).isSymbolicLink())throw new Error('发布运行目录不能使用链接');if(p===path.dirname(p))break;}
 fs.mkdirSync(runtimeDir,{recursive:true});
 const context=createDesktopModuleContext({moduleId,hostId:releaseContext.hostId,dataDir,profileDir,runtimeDir,codeDir,token});writeSignedContext(context,token);
 const env={};for(const [name,value]of Object.entries(environment).sort(([a],[b])=>a.localeCompare(b))){const key=name.toUpperCase();if(ENVIRONMENT.has(key)&&!Object.hasOwn(env,key)&&typeof value==='string')env[key]=value;}
 Object.assign(env,{PYTHONDONTWRITEBYTECODE:'1',PYTHONNOUSERSITE:'1',PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',XJY_MODULE_TOKEN:token,XJY_MODULE_CONTEXT_FILE:context.contextFile,XJY_MODULE_CONTEXT_SIGNATURE:context.signature,[moduleId==='ledger'?'LEDGER_DATA':'STOCKCHECK_DATA']:JSON.parse(context.canonicalJson).dataDir});
 return env;
}
module.exports={prepareReleaseEnvironment};
