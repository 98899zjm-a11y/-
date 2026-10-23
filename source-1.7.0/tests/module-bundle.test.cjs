'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const parent=path.join(__dirname,'module-bundle-fixtures');
function fixture(t){
 fs.mkdirSync(parent,{recursive:true}); const root=fs.mkdtempSync(path.join(parent,'case-'));
 const packagedDir=path.join(root,'package'),runtimeDir=path.join(root,'runtime'); fs.mkdirSync(path.join(packagedDir,'xjy-ledger','_internal'),{recursive:true});fs.mkdirSync(runtimeDir);
 const items=[['xjy-ledger.exe',Buffer.from('MZ synthetic executable - do not run')],['_internal/python314.dll',Buffer.from('synthetic runtime bytes')]];
 const files=items.map(([name,bytes])=>{fs.writeFileSync(path.join(packagedDir,'xjy-ledger',...name.split('/')),bytes);return{path:name,size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};});
 const entry={id:'ledger',version:'1.3.0',file:'xjy-ledger.exe',size:files[0].size,sha256:files[0].sha256,runtimeMode:'onedir',purpose:'desktop-release',files};
 const save=()=>fs.writeFileSync(path.join(packagedDir,'manifest.json'),JSON.stringify({version:1,modules:[entry]}));save();
 t.after(()=>{const absolute=path.resolve(root);assert.equal(path.dirname(absolute),path.resolve(parent));assert.match(path.basename(absolute),/^case-/);for(const f of fs.readdirSync(root)){const p=path.join(root,f);if(fs.lstatSync(p).isSymbolicLink())fs.unlinkSync(p);}fs.rmSync(root,{recursive:true});});
 return{root,packagedDir,runtimeDir,entry,save,options:{id:'ledger',version:'1.3.0',packagedDir,runtimeDir}};
}
function api(){return require('../project/desktop/module-bundle.cjs');}
test('release module retains its full runtime and validated cache can be reused',t=>{const f=fixture(t),a=api().materializeModuleBundle(f.options);assert.equal(fs.readFileSync(a.executable).toString(),'MZ synthetic executable - do not run');assert.equal(fs.readFileSync(path.join(a.codeDir,'_internal','python314.dll')).toString(),'synthetic runtime bytes');assert.equal(api().materializeModuleBundle(f.options).executable,a.executable);});
test('a changed runtime dependency fails before publication or execution',t=>{const f=fixture(t);fs.writeFileSync(path.join(f.packagedDir,'xjy-ledger','_internal','python314.dll'),'tampered');assert.throws(()=>api().materializeModuleBundle(f.options),/校验|integrity/i);assert.equal(fs.readdirSync(f.runtimeDir).length,0);});
test('unlisted runtime code is rejected instead of being copied or loaded',t=>{const f=fixture(t);fs.writeFileSync(path.join(f.packagedDir,'xjy-ledger','_internal','extra.dll'),'extra');assert.throws(()=>api().materializeModuleBundle(f.options),/清单|manifest/i);});
test('isolated stage sidecar cannot masquerade as the desktop release',t=>{const f=fixture(t);delete f.entry.purpose;f.save();assert.throws(()=>api().materializeModuleBundle(f.options),/发布|release/i);});
test('traversal, duplicate and Windows path aliases are rejected',t=>{const f=fixture(t);for(const name of ['../escape.dll','_internal/CON.dll','_internal/file.dll.','_internal/file:stream']){f.entry.files[1].path=name;f.save();assert.throws(()=>api().materializeModuleBundle(f.options),/路径|path/i);}f.entry.files[1].path='XJY-LEDGER.EXE';f.save();assert.throws(()=>api().materializeModuleBundle(f.options),/重复|duplicate/i);});
test('a tampered cached runtime fails closed and is never overwritten silently',t=>{const f=fixture(t),a=api().materializeModuleBundle(f.options);fs.writeFileSync(path.join(a.codeDir,'_internal','python314.dll'),'changed cache');assert.throws(()=>api().materializeModuleBundle(f.options),/校验|integrity/i);assert.equal(fs.readFileSync(path.join(a.codeDir,'_internal','python314.dll')).toString(),'changed cache');});
test('linked and hardlinked runtime files are refused',t=>{const f=fixture(t),file=path.join(f.packagedDir,'xjy-ledger','_internal','python314.dll');fs.linkSync(file,path.join(f.root,'hardlink.dll'));assert.throws(()=>api().materializeModuleBundle(f.options),/链接|link/i);});
