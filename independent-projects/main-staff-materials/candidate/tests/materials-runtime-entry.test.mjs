import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import sharp from '../materials/node_modules/sharp/dist/index.mjs';
import {createMaterialRuntimeSuite} from '../materials-runtime-entry.mjs';
const require=createRequire(import.meta.url),{createBackend}=require('../project/desktop/backend.cjs');
const root=path.resolve(import.meta.dirname,'..');
const data=value=>JSON.parse(Buffer.from(value.bodyBase64,'base64').toString('utf8'));
test('profile runtime suite persists review-first material through same main session and rejects after close',async t=>{
 const dir=await fs.mkdtemp(path.join(root,'runtime','material-suite-')),dataRoot=path.join(dir,'销售素材');
 const backend=createBackend({dataDir:path.join(dir,'main'),migrationDir:path.join(root,'project/desktop/migrations')});backend.auth.setup({username:'synthetic_suite_admin',name:'虚构管理员',password:'Synthetic-suite-only-pass!'});t.after(()=>backend.close());
 const context={session:{auth:backend.auth},administration:backend.administration,isLive:()=>true,gatewayCsrf:'b'.repeat(64)},options={origin:'http://127.0.0.1:21965',dataRoot,classify:async({sha256})=>({sha256,decision:'jewelry',category:'吊坠',tags:['心形'],reason:'虚构可见结构'})};
 const suite=await createMaterialRuntimeSuite(options);assert.ok(Object.isFrozen(suite));assert.equal(typeof suite.handle,'function');assert.equal(typeof suite.sessionRequest,'function');
 const boot=data(await suite.sessionRequest({path:'/materials/api/bootstrap',method:'GET'},context));
 const bytes=await sharp({create:{width:18,height:18,channels:3,background:'#bbb'}}).jpeg().toBuffer();
 const upload=await suite.sessionRequest({path:'/materials/api/assets?name=synthetic.jpg',method:'POST',headers:{'content-type':'application/octet-stream','x-xjy-csrf':context.gatewayCsrf,'x-csrf-token':boot.csrfToken},bodyBase64:bytes.toString('base64')},context);assert.equal(upload.status,202);
 await suite.close();assert.equal((await suite.sessionRequest({path:'/materials/staff-auth/status',method:'GET'},context)).status,401);
 const reopened=await createMaterialRuntimeSuite(options);try{const response=await reopened.sessionRequest({path:'/materials/api/assets',method:'GET'},context);assert.equal(response.status,200);const assets=data(response).assets;assert.equal(assets.length,1);assert.notEqual(assets[0].status,'imported');assert.equal(assets[0].availability,'unknown');}finally{await reopened.close();}
});
test('invalid runtime origin fails before creating any profile files',async()=>{
 const dir=await fs.mkdtemp(path.join(root,'runtime','invalid-material-suite-')),dataRoot=path.join(dir,'销售素材');
 await assert.rejects(createMaterialRuntimeSuite({origin:'http://attacker.invalid',dataRoot,classify:async()=>({})}));assert.deepEqual(await fs.readdir(dir),[]);
});
