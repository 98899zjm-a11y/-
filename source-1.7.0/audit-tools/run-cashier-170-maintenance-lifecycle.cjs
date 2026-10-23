'use strict';
// Run with the fixed Guest Node --test. Built-in TAP and exit status are the
// actual results. Three real archive/SQLite/swap cases; execute is declared DI.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..'),NODE=path.join(ROOT,'stage1','tools','node.exe');
if(process.platform!=='win32'||os.userInfo().username.toLowerCase()!=='wdagutilityaccount'||ROOT.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1'||path.resolve(process.execPath).toLowerCase()!==NODE.toLowerCase())throw Error('Fixed actual Guest Node required before product imports/writes');
const SELF='audit-tools/run-cashier-170-maintenance-lifecycle.cjs',PINS='audit-tools/cashier-170-maintenance-lifecycle-runner-pins-a1.json';
const GUARDS={'stage1/guest-candidate-cdp.cjs':'59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32','stage1/sandbox-context.py':'09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249','stage1/validate-sandbox-context.py':'867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207'};
const FILES=['project/desktop/business-maintenance-layout.cjs','project/desktop/business-backups.cjs','project/desktop/business-restore.cjs',
 'project/desktop/business-erp-backup-integrity.cjs','project/desktop/cashier-maintenance.cjs','project/desktop/business-authority-preserve.cjs',
 'project/desktop/sales-request-knowledge.cjs','project/desktop/administration.cjs','project/desktop/erp-policy.cjs','project/desktop/cashier-policy.cjs',
 'audit-tools/cashier-170-maintenance-lifecycle-contract.cjs','audit-tools/cashier-170-maintenance-candidate-a1.json'];
function ordinary(file){for(let item=file;;item=path.dirname(item)){const st=fs.lstatSync(item);if(st.isSymbolicLink()||st.isFile()&&st.nlink!==1)throw Error('Ordinary nonlinked source required');if(item===path.dirname(item))break;}const st=fs.statSync(file);if(!st.isFile())throw Error('Regular source required');return st;}
function hashFile(file,max=4*1024*1024){const before=ordinary(file);if(before.size<1||before.size>max)throw Error('Bounded source required');const fd=fs.openSync(file,'r');try{const opened=fs.fstatSync(fd);if(opened.dev!==before.dev||opened.ino!==before.ino||opened.size!==before.size||opened.mtimeMs!==before.mtimeMs)throw Error('Source identity changed');const h=crypto.createHash('sha256'),buffer=Buffer.alloc(65536);let n,size=0;while((n=fs.readSync(fd,buffer,0,buffer.length,null))>0){h.update(buffer.subarray(0,n));size+=n;}const after=fs.fstatSync(fd),named=ordinary(file);if(size!==before.size||after.dev!==opened.dev||after.ino!==opened.ino||after.size!==opened.size||after.mtimeMs!==opened.mtimeMs||named.dev!==after.dev||named.ino!==after.ino||named.size!==after.size||named.mtimeMs!==after.mtimeMs)throw Error('Source changed during read');return h.digest('hex');}finally{fs.closeSync(fd);}}
function pin(relative,expected){const file=path.join(ROOT,...relative.split('/'));if(!/^[a-f0-9]{64}$/.test(expected||'')||hashFile(file)!==expected)throw Error('Exact source pin mismatch: '+relative);return file;}
const self=process.env.XJY_CASHIER_MAINTENANCE_RUNNER_SHA256,pinsSha=process.env.XJY_CASHIER_MAINTENANCE_PINS_SHA256,namespace=process.env.XJY_CASHIER_MAINTENANCE_NAMESPACE;
pin(SELF,self);pin(PINS,pinsSha);if(hashFile(NODE,256*1024*1024)!=='ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32')throw Error('Fixed public Node runtime changed');
for(const[name,sha]of Object.entries(GUARDS))pin(name,sha);
const identityFile=path.join(ROOT,'isolation-identity.json');ordinary(identityFile);if(!/^[A-Za-z0-9_.-]{8,160}$/.test(namespace||'')||JSON.parse(fs.readFileSync(identityFile,'utf8')).namespace!==namespace)throw Error('Actual Guest namespace mismatch');
const admission=require(pin('stage1/guest-candidate-cdp.cjs',GUARDS['stage1/guest-candidate-cdp.cjs'])).actualGuard();
const manifest=JSON.parse(fs.readFileSync(path.join(ROOT,PINS),'utf8'));
if(!manifest||manifest.version!==1||Object.keys(manifest).sort().join(',')!=='files,migrationFiles,migrationReason,version'||Object.keys(manifest.files||{}).sort().join('\n')!==[...FILES].sort().join('\n')||!Array.isArray(manifest.migrationFiles)||manifest.migrationFiles.length||manifest.migrationReason!=='ledger-only lifecycle cases use literal fictional_proof tables; sales reserve/migration path is not exercised')throw Error('Exact require closure and explicit empty migration closure required');
for(const[name,sha]of Object.entries(manifest.files))pin(name,sha);
const candidate=JSON.parse(fs.readFileSync(path.join(ROOT,'audit-tools/cashier-170-maintenance-candidate-a1.json'),'utf8'));
if(manifest.files['audit-tools/cashier-170-maintenance-candidate-a1.json']!=='8d9eeee3d472edff06f5dd452aea49e53013408efc57773daf4d96e395091921')throw Error('Frozen maintenance candidate manifest changed');
for(const name of ['project/desktop/business-restore.cjs','project/desktop/cashier-maintenance.cjs','audit-tools/cashier-170-maintenance-lifecycle-contract.cjs'])if(manifest.files[name]!==candidate.subjects[name])throw Error('Frozen candidate subject changed');
const Module=require('node:module'),originalLoad=Module._load;
const allowed=new Map(Object.entries(manifest.files).filter(([name])=>name.endsWith('.cjs')).map(([name,sha])=>[path.resolve(ROOT,name).toLowerCase(),{name,sha}]));
Module._load=function(request,parent,isMain){if(!Module.isBuiltin(request)){const resolved=Module._resolveFilename(request,parent,isMain),expected=allowed.get(path.resolve(resolved).toLowerCase());if(!expected)throw Error('Unpinned local require refused: '+request);pin(expected.name,expected.sha);}return originalLoad.apply(this,arguments);};
const test=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
const api=name=>require(path.join(ROOT,'project','desktop',name));
console.log(JSON.stringify({purpose:'cashier-maintenance-lifecycle-actual-three-db-archive-swap',admission,namespace,runnerSha256:self,pinsSha256:pinsSha,methods:3,executePort:'explicit non-monetary DI',nativeWorkerVerified:false,migrationFiles:[],sourcePins:manifest.files}));
require(path.join(ROOT,'audit-tools','cashier-170-maintenance-lifecycle-contract.cjs')).registerContracts({root:ROOT,admitted:true,test,assert,DatabaseSync,
 createContext:api('business-maintenance-layout.cjs').createBusinessMaintenanceContext,createBackups:api('business-backups.cjs').createBusinessBackups,
 createRestore:api('business-restore.cjs').createBusinessRestore,createCashierMaintenance:api('cashier-maintenance.cjs').createCashierMaintenance});
test.after(()=>{for(const[name,sha]of Object.entries(manifest.files))pin(name,sha);for(const[name,sha]of Object.entries(GUARDS))pin(name,sha);pin(SELF,self);pin(PINS,pinsSha);console.log(JSON.stringify({sourcePinsStable:true,methods:3,executePort:'DI; no native worker claim'}));});
