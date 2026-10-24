'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {readMaterialsRuntimeCapability}=require('../project/desktop/materials-capability.cjs');
const {createReleaseHostServices}=require('../project/desktop/release-host-services.cjs');
const base=path.resolve(__dirname,'../runtime');
test('material runtime capability defaults disabled and requires a strict immutable program-side record',()=>{
 const dir=fs.mkdtempSync(path.join(base,'material-cap-')),file=path.join(dir,'materials-runtime-capability.json');assert.equal(readMaterialsRuntimeCapability({codeDir:dir}),false);assert.equal(fs.readdirSync(dir).length,0);
 fs.writeFileSync(file,JSON.stringify({version:1,enabled:true}));assert.equal(readMaterialsRuntimeCapability({codeDir:dir}),true);
 for(const object of [{version:1,enabled:'yes'},{version:2,enabled:true},{version:1,enabled:true,dataRoot:'F:/not-allowed'},{enabled:true}]){fs.writeFileSync(file,JSON.stringify(object));assert.throws(()=>readMaterialsRuntimeCapability({codeDir:dir}));}
});
test('material capability refuses file aliases without reading or writing the external record',()=>{
 for(const kind of ['symlink','hardlink']){const dir=fs.mkdtempSync(path.join(base,'material-cap-alias-')),outside=path.join(dir,'outside.json'),code=path.join(dir,'code'),file=path.join(code,'materials-runtime-capability.json');fs.mkdirSync(code);fs.writeFileSync(outside,'{"version":1,"enabled":true}');if(kind==='symlink')fs.symlinkSync(outside,file);else fs.linkSync(outside,file);const before=fs.readFileSync(outside);assert.throws(()=>readMaterialsRuntimeCapability({codeDir:code}));assert.deepEqual(fs.readFileSync(outside),before);}
});
test('release host composition forwards explicit trusted material factory without opening a profile itself',async()=>{
 const root=fs.mkdtempSync(path.join(base,'material-host-compose-')),storage={root,profileDir:path.join(root,'config')};fs.mkdirSync(storage.profileDir);const admission=Object.freeze({mode:'sandbox',root,publicAccess:false});let captured;
 const factory=async()=>({handle(){},close(){}}),marker=Object.freeze({fixture:true});const response=await createReleaseHostServices({storage,admission,assertAdmission:()=>true,materialsServiceFactory:factory,runtimeFactory:async options=>{captured=options;return marker;}});
 assert.equal(response,marker);assert.equal(captured.materialsServiceFactory,factory);assert.equal(fs.existsSync(path.join(root,'销售素材')),false);
});
