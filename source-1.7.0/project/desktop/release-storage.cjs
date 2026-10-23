'use strict';
const fs=require('node:fs'),path=require('node:path');
const {createOwnedPathGuard}=require('./managed-print-worker.cjs');
function resolveReleaseStorage({admission,legacyProfile,portableDirectory,fixedHostRoot='F:\\鑫金源珠宝资料',employeeStorage,employeeClient=false}){
 if(!admission||!Object.isFrozen(admission)||admission.publicAccess!==false||!['installed','sandbox'].includes(admission.mode))throw Error('资料目录必须在发布准入后核验');
 if(admission.mode==='installed'&&admission.role==='employee'){
  const result=(employeeStorage||require('./storage-locations.cjs').prepareStorage)({legacyProfile,portableDirectory,employeeClient:true,autoEmployee:false});
  if(result.employeeClient!==true||result.dataDir!==null)throw Error('员工端不得建立本地业务库');return result;
 }
 if(admission.mode==='installed'&&admission.role!=='host')throw Error('安装角色无效');
 const sandbox=admission.mode==='sandbox',guard=createOwnedPathGuard(sandbox?admission.root:fixedHostRoot),root=guard.root;
 if(sandbox&&employeeClient){const profileDir=guard.check(path.join(root,'config','employee-profile'));fs.mkdirSync(profileDir,{recursive:true});guard.check(profileDir);return{root,profileDir,dataDir:null,employeeClient:true,role:'employee',imageDir:guard.check(path.join(profileDir,'报价图片')),migration:{migrated:false,reason:'独立测试员工端'}};}
 const dataDir=guard.check(path.join(root,...(sandbox?['data','sales']:['工作室数据'])));
 if(sandbox&&dataDir.toLowerCase()!==path.resolve(admission.dataDir).toLowerCase())throw Error('Sandbox 数据路径与准入路径不一致');
 const db=guard.check(path.join(dataDir,'jewelry.sqlite'));
 const profileDir=guard.check(path.join(root,...(sandbox?['config','desktop-profile']:['程序设置'])));
 if(!fs.existsSync(db)){
  // A crash between live->previous and staged->live leaves this slot absent.
  // The owned runtime must validate and recover the transaction before opening
  // SQLite; the entry must neither create an empty DB nor block that recovery.
  const journal=guard.check(path.join(root,'后台运行','restore-transaction.json'));
  if(!fs.existsSync(profileDir)||!fs.lstatSync(profileDir).isDirectory()||!fs.existsSync(journal)||!fs.lstatSync(journal).isFile()||fs.statSync(journal).size>1048576)throw Error('现有销售数据库缺失，升级入口不会新建或迁移工作室');
 }else if(!fs.lstatSync(db).isFile())throw Error('现有销售数据库不是普通文件');
 fs.mkdirSync(profileDir,{recursive:true});guard.check(profileDir);
 return{root,profileDir,dataDir,employeeClient:false,role:'host',imageDir:guard.check(path.join(root,'报价图片')),migration:{migrated:false,reason:'继续使用已有业务资料，升级入口不迁移数据'}};
}
module.exports={resolveReleaseStorage};
