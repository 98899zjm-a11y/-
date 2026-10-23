'use strict';
// Pure layout tests. Every mutable target is an owned fixture below tests/.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const tests=fs.realpathSync.native(__dirname),source=path.join(tests,'../project/desktop/release-layout.cjs');
const fixtures=path.join(tests,'release-layout-fixtures');
const hostId='4f846a11-78fc-4fc2-bef5-2b7e2d6d31ee',token='0123456789abcdef'.repeat(4);
function owned(p){const r=path.relative(tests,path.resolve(p));assert.ok(r&&!r.startsWith('..')&&!path.isAbsolute(r));for(let x=path.resolve(p);;x=path.dirname(x)){if(fs.existsSync(x))assert.equal(fs.lstatSync(x).isSymbolicLink(),false);if(x===tests)break;assert.notEqual(x,path.dirname(x));}return p;}
function cleanup(root){
 const absolute=path.resolve(root),base=fs.realpathSync.native(owned(fixtures));assert.ok(absolute.startsWith(base+path.sep)&&/^case-[A-Za-z0-9]+$/.test(path.basename(absolute)));assert.equal(fs.realpathSync.native(owned(absolute)),absolute);const marker=JSON.parse(fs.readFileSync(path.join(absolute,'.test-owner.json'),'utf8'));assert.equal(marker.purpose,'release-layout-test');
 function remove(entry){assert.ok(entry===absolute||entry.startsWith(absolute+path.sep));const info=fs.lstatSync(entry);if(info.isSymbolicLink()){fs.unlinkSync(entry);return;}if(info.isDirectory()){for(const name of fs.readdirSync(entry))remove(path.join(entry,name));fs.rmdirSync(entry);}else{assert.ok(info.isFile());fs.unlinkSync(entry);}}
 remove(absolute);
}
function fixture(t){owned(fixtures);fs.mkdirSync(fixtures,{recursive:true});const root=fs.mkdtempSync(path.join(fixtures,'case-'));owned(root);fs.writeFileSync(path.join(root,'.test-owner.json'),JSON.stringify({version:1,purpose:'release-layout-test'}));t.after(()=>cleanup(root));const dataDir=path.join(root,'销售以外的虚构账套'),profileDir=path.join(root,'profile'),runtimeDir=path.join(profileDir,'module-runtime'),codeDir=path.join(root,'code');for(const p of [dataDir,profileDir,runtimeDir,codeDir]){owned(p);fs.mkdirSync(p,{recursive:true});}return{root,moduleId:'ledger',hostId,dataDir,profileDir,runtimeDir,codeDir,token};}
function api(){assert.ok(fs.existsSync(source),'release layout interface is missing');return require(source);}
function create(f){const{root,...args}=f;return api().createDesktopModuleContext(args);}
function python(mode,payload){const script=path.join(tests,'desktop_runtime_context_test.py');const result=spawnSync('C:\\Python314\\python.exe',['-I','-B',script,mode],{input:JSON.stringify(payload),encoding:'utf8',cwd:tests,windowsHide:true});assert.equal(result.status,0,result.stderr||result.stdout);return JSON.parse(result.stdout);}

test('creating signed context has no file/database/account side effects and uses canonical UTF8',t=>{
 const f=fixture(t),signed=create(f);assert.equal(signed.contextFile,path.join(f.runtimeDir,'module-runtime-context.json'));
 assert.equal(fs.existsSync(signed.contextFile),false);assert.deepEqual(fs.readdirSync(f.dataDir),[]);assert.deepEqual(fs.readdirSync(f.runtimeDir),[]);
 const context=JSON.parse(signed.canonicalJson);assert.deepEqual(Object.keys(context),['codeDir','dataDir','hostId','module','profileDir','purpose','retainedDir','runtimeDir','version']);assert.equal(context.module,'ledger');assert.equal(context.purpose,'xjy-desktop-module');assert.equal(context.retainedDir,path.join(f.profileDir,'retained'));assert.equal(context.version,1);
 assert.equal(signed.signature,crypto.createHmac('sha256',token).update('xjy-module-runtime-v1\0'+signed.canonicalJson,'utf8').digest('hex'));assert.ok(!signed.canonicalJson.includes(token));
});

test('explicit writer atomically publishes only bounded context and retains no token',t=>{
 const f=fixture(t),signed=create(f);assert.equal(api().writeSignedContext(signed,token),signed.contextFile);assert.equal(fs.readFileSync(signed.contextFile,'utf8'),signed.canonicalJson);assert.ok(fs.statSync(signed.contextFile).size<=16384);assert.deepEqual(fs.readdirSync(f.runtimeDir),['module-runtime-context.json']);
 api().writeSignedContext(signed,token);assert.deepEqual(fs.readdirSync(f.runtimeDir),['module-runtime-context.json']);
 assert.throws(()=>api().writeSignedContext({...signed,signature:'0'.repeat(64)},token));assert.throws(()=>api().writeSignedContext({...signed,contextFile:path.join(f.root,'other.json')},token));
});

test('data stays separate while safe onedir below runtime is allowed',t=>{
 const f=fixture(t),nested=path.join(f.runtimeDir,'modules','ledger','verified-hash');owned(nested);fs.mkdirSync(nested,{recursive:true});assert.equal(JSON.parse(create({...f,codeDir:nested}).canonicalJson).codeDir,nested);
 for(const patch of [{dataDir:f.profileDir},{dataDir:f.codeDir},{codeDir:f.profileDir},{codeDir:f.runtimeDir},{codeDir:f.root},{runtimeDir:f.codeDir},{runtimeDir:f.profileDir}])assert.throws(()=>create({...f,...patch}));
 const retained=path.join(f.profileDir,'retained');owned(retained);fs.mkdirSync(retained);assert.throws(()=>create({...f,codeDir:retained}));assert.throws(()=>create({...f,codeDir:f.dataDir}));
});

test('rejects malformed identity, extra options and nonlocal/ADS/traversal paths before access',t=>{
 api();const f=fixture(t);for(const patch of [{moduleId:'sales'},{hostId:'not-a-uuid'},{token:'short'},{extra:'untrusted'},{dataDir:'relative'},{dataDir:'\\\\fixture-server\\data'},{dataDir:f.dataDir+':stream'},{dataDir:path.join(f.root,'code')+'\\..\\profile'}])assert.throws(()=>create({...f,...patch}));
});

test('real directory junctions are rejected for runtime/data/code and retained',t=>{
 const f=fixture(t),signed=create(f),junction=path.join(f.root,'junction');api().writeSignedContext(signed,token);owned(junction);fs.symlinkSync(f.dataDir,junction,'junction');assert.ok(fs.lstatSync(junction).isSymbolicLink());for(const key of ['dataDir','runtimeDir','codeDir'])assert.throws(()=>create({...f,[key]:junction}));
 const retained=path.join(f.profileDir,'retained');owned(retained);fs.symlinkSync(f.dataDir,retained,'junction');assert.throws(()=>create(f));
 const p=python('--check',{moduleId:'ledger',token,contextFile:signed.contextFile,signature:signed.signature,expectedDataDir:junction});assert.equal(p.rejected,true);
});

test('hardlinked existing context and symlinked file cannot be overwritten',t=>{
 const f=fixture(t),signed=create(f),target=path.join(f.root,'keep.txt');owned(target);fs.writeFileSync(target,'preserved');owned(signed.contextFile);fs.linkSync(target,signed.contextFile);assert.equal(fs.lstatSync(signed.contextFile).nlink,2);assert.throws(()=>create(f));assert.throws(()=>api().writeSignedContext(signed,token));assert.equal(fs.readFileSync(target,'utf8'),'preserved');
 const g=fixture(t),s=create(g),outside=path.join(g.root,'keep.txt');owned(outside);fs.writeFileSync(outside,'preserved');owned(s.contextFile);fs.symlinkSync(outside,s.contextFile,'file');assert.ok(fs.lstatSync(s.contextFile).isSymbolicLink());assert.throws(()=>api().writeSignedContext(s,token));assert.equal(fs.readFileSync(outside,'utf8'),'preserved');
});

test('Node signed unicode context loads in isolated Python and Python canonical signing agrees',t=>{
 const f=fixture(t),signed=create(f);api().writeSignedContext(signed,token);const loaded=python('--load',{moduleId:'ledger',token,contextFile:signed.contextFile,signature:signed.signature,expectedDataDir:f.dataDir});assert.deepEqual(loaded.context,JSON.parse(signed.canonicalJson));assert.equal(loaded.numberFile,path.join(f.profileDir,'retained','erp-number-reservations.json'));assert.equal(loaded.attachmentsDir,path.join(f.dataDir,'erp-attachments'));
 const emitted=python('--emit',{context:loaded.context,token});assert.equal(emitted.canonicalJson,signed.canonicalJson);assert.equal(emitted.signature,signed.signature);
 for(const patch of [{signature:'0'.repeat(64)},{moduleId:'inventory'},{expectedDataDir:f.codeDir}])assert.equal(python('--check',{moduleId:'ledger',token,contextFile:signed.contextFile,signature:signed.signature,expectedDataDir:f.dataDir,...patch}).rejected,true);
 const context={...loaded.context,unexpected:'claim'};fs.writeFileSync(signed.contextFile,JSON.stringify(context));const badSignature=crypto.createHmac('sha256',token).update('xjy-module-runtime-v1\0'+JSON.stringify(context)).digest('hex');assert.equal(python('--check',{moduleId:'ledger',token,contextFile:signed.contextFile,signature:badSignature,expectedDataDir:f.dataDir}).rejected,true);
});

test('inventory context signs independently and writer rejects signed extra envelope fields',t=>{
 const f=fixture(t),signed=create({...f,moduleId:'inventory'});api().writeSignedContext(signed,token);assert.equal(python('--check',{moduleId:'inventory',token,contextFile:signed.contextFile,signature:signed.signature,expectedDataDir:f.dataDir}).rejected,false);
 const raw=JSON.stringify({...JSON.parse(signed.canonicalJson),role:'admin'}),signature=crypto.createHmac('sha256',token).update('xjy-module-runtime-v1\0'+raw).digest('hex');assert.throws(()=>api().writeSignedContext({...signed,canonicalJson:raw,signature},token));assert.equal(fs.readFileSync(signed.contextFile,'utf8'),signed.canonicalJson);
});
