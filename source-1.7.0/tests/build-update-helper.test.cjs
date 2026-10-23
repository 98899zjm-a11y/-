'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {fixture,hash}=require('./employee-update-fixtures.cjs');
const {buildUpdateHelper}=require('../project/desktop/build-update-helper.cjs');
async function input(t){const f=await fixture(t);f.publicFile=path.join(f.root,'test-public.pem');await fs.writeFile(f.publicFile,f.keys.publicKey.export({type:'spki',format:'pem'}));f.output=path.join(f.root,'built-helper');f.input={outputDir:f.output,programVersion:'1.6.0',executableName:'Toy Jewelry.exe',publicKeyFile:f.publicFile,allowedFiles:f.allowedFiles};return f;}
test('helper build creates exactly four program files with a bound raw bootstrap and public-only pins',async t=>{
 const f=await input(t),pins=await buildUpdateHelper(f.input);assert.deepEqual((await fs.readdir(f.output)).sort(),['bootstrap.json','employee-update-cache.cjs','employee-update-installer.cjs','updater-helper.cjs']);assert.equal(pins.publisherPublicKeySha256,hash(f.keys.publicKey.export({type:'spki',format:'der'})));assert.equal(pins.files.length,4);
 const bootstrap=await fs.readFile(path.join(f.output,'bootstrap.json')),body=await fs.readFile(path.join(f.output,'updater-helper.cjs'),'utf8');assert.equal(hash(bootstrap),pins.bootstrapSha256);assert.ok(body.includes("BUILD_BOOTSTRAP_SHA256='"+pins.bootstrapSha256+"'"));assert.ok(!body.includes('__XJY_UPDATE_BOOTSTRAP_SHA256__'));assert.equal(JSON.parse(bootstrap).publisherPublicKey,pins.publisherPublicKey);assert.equal(JSON.parse(bootstrap).programVersion,'1.6.0');for(const file of pins.files)assert.equal(hash(await fs.readFile(path.join(f.output,file.name))),file.sha256);assert.ok(!JSON.stringify(pins).includes('PRIVATE'));
});
test('build refuses an existing output, unsafe whitelist or private-key input without overwriting old files',async t=>{
 const f=await input(t);await fs.mkdir(f.output);await fs.writeFile(path.join(f.output,'preserved.txt'),'old');await assert.rejects(buildUpdateHelper(f.input));assert.equal(await fs.readFile(path.join(f.output,'preserved.txt'),'utf8'),'old');
 for(const allowedFiles of [['../app.asar'],['resources/print-dependencies/customer.sqlite'],['resources/app.asar','resources/APP.ASAR']])await assert.rejects(buildUpdateHelper({...f.input,outputDir:path.join(f.root,crypto.randomUUID()),allowedFiles}));
 await fs.writeFile(f.publicFile,f.keys.privateKey.export({type:'pkcs8',format:'pem'}));const target=path.join(f.root,'private-refused');await assert.rejects(buildUpdateHelper({...f.input,outputDir:target}));await assert.rejects(fs.access(target));
});
test('build rejects junction and dot-segment aliases before creating a payload tree',async t=>{
 const f=await input(t),outside=path.join(f.root,'outside'),alias=path.join(f.root,'alias');await fs.mkdir(outside);await fs.symlink(outside,alias,'junction');await assert.rejects(buildUpdateHelper({...f.input,outputDir:path.join(alias,'payload')}));assert.deepEqual(await fs.readdir(outside),[]);await assert.rejects(buildUpdateHelper({...f.input,outputDir:f.root+path.sep+'..'+path.sep+path.basename(f.root)+path.sep+'unsafe'}));
});
test('build refuses reserved executable aliases and unsafe semantic version integers',async t=>{
 const f=await input(t);for(const override of [{executableName:'CON.exe'},{programVersion:'1.999999999999999999999.0'}]){const target=path.join(f.root,crypto.randomUUID());await assert.rejects(buildUpdateHelper({...f.input,...override,outputDir:target}));await assert.rejects(fs.access(target));}
});
