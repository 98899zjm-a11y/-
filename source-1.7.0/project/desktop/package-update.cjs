'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const asar=require('@electron/asar');
const desktop=__dirname, app=JSON.parse(fs.readFileSync(path.join(desktop,'package.json'),'utf8'));
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
async function buildAsar(destination) {
 destination=path.resolve(destination);fs.mkdirSync(destination,{recursive:true});
 const stageRoot=path.join(desktop,'patch-stage-work');fs.mkdirSync(stageRoot,{recursive:true});const stage=fs.mkdtempSync(path.join(stageRoot,'asar-stage-'));
 for(const pattern of app.build.files) {
  const name=pattern.replace(/\/\*\*$/,'');const source=path.join(desktop,name),target=path.join(stage,name);
  if(!fs.existsSync(source))throw new Error('Required runtime file absent: '+name);
  if(fs.lstatSync(source).isSymbolicLink())throw new Error('Package source cannot be a link: '+name);
  fs.cpSync(source,target,{recursive:true,dereference:false,filter:(src)=>{if(fs.lstatSync(src).isSymbolicLink())throw new Error('Package link rejected');return true;}});
 }
 const output=path.join(destination,'app.asar');await asar.createPackage(stage,output);
 const entries=asar.listPackage(output).map(item=>item.replaceAll('\\','/'));
 if(JSON.parse(asar.extractFile(output,'package.json').toString()).version!==app.version)throw new Error('Wrong patch version');
 for(const required of ['/storage-locations.cjs','/image-output.cjs','/clipboard-output.cjs','/credentials.cjs','/warranty-docx.cjs','/generated/print-domain.cjs','/renderer-dist/quote-stationery-v2.png','/administration.cjs','/workspace-collaboration.cjs','/module-workspace-policy.cjs','/workplace-polls.cjs','/ai-adapter.cjs','/migrations/0004_module_administration.sql','/migrations/0005_workspace_collaboration.sql','/legacy-modules.cjs','/module-gateway.cjs','/module-views.cjs','/module-preload.cjs','/legacy-modules/manifest.json','/legacy-modules/xjy-ledger.exe','/legacy-modules/xjy-inventory.exe','/assets/integration/ledger-theme.css','/assets/integration/inventory-theme.css','/assets/licenses/recharts-LICENSE.txt'])if(!entries.includes(required))throw new Error('Missing runtime entry '+required);
 if(entries.some(item=>/(?:node_modules|signing|tests|jewelry\.sqlite|legacy-source|\.legacy-build|remembered-login\.json|ledger\.db|stockcheck\.db|secret\.key)/.test(item)))throw new Error('Unexpected private or development package entries');
 return {output,size:fs.statSync(output).size,sha256:sha(output),entries:entries.length};
}
async function packagePatch(destination, installation) {
 destination=path.resolve(destination);const output=await buildAsar(destination);
 for(const name of fs.readdirSync(path.join(desktop,'update-patch'))) {
  const source=path.join(desktop,'update-patch',name);if(!fs.statSync(source).isFile())continue;
  let data=fs.readFileSync(source);if(name.endsWith('.ps1')||name.endsWith('.txt'))data=Buffer.from('\ufeff'+data.toString('utf8').replace(/^\ufeff/,''),'utf8');
  fs.writeFileSync(path.join(destination,name),data);
 }
 const payload={file:'app.asar',sha256:output.sha256,size:output.size};
 const oldAsar=path.join(installation,'resources/app.asar'),engine=path.join(installation,'鑫金源珠宝报价.exe');
 const old=JSON.parse(asar.extractFile(oldAsar,'package.json').toString());
 if(old.name!=='xjy-jewelry-offline'||!['1.2.0','1.3.0','1.3.1','1.3.2','1.3.3','1.4.0','1.4.1'].includes(old.version))throw new Error('Patch baseline must be verified supported version');
 const files=fs.readdirSync(destination).filter(name=>/\.(?:ps1|cmd|txt)$/.test(name)&&!name.endsWith('.sha256.txt')).map(name=>({path:name,sha256:sha(path.join(destination,name)),size:fs.statSync(path.join(destination,name)).size}));
 const manifest={schemaVersion:1,app:{name:old.name,executable:'鑫金源珠宝报价.exe',targetVersion:app.version,engineSha256:sha(engine),engineSize:fs.statSync(engine).size,sourcePackages:[{version:'1.2.0',sha256:'f3354ecb5e67a245e9d80aa431137ed90dadcea0d769a70da98e6159818307bb',size:5772430},{version:'1.3.0',sha256:'cfec6ca8a64415ccb583fe0b3bcd2a4745a42cd269c86b37b76f0ab59ebff468',size:8309130},{version:'1.3.1',sha256:'46c59cba3b37650c58074e8f8e2338605ebf270f3726129ef87639ee0ab8a79b',size:8310285},{version:'1.3.2',sha256:'06927f9a60097569a208fc44ca4cbdf11b6a6dc877faf0e10adc9130a59d90dc',size:8316206},{version:'1.3.3',sha256:'47f9a322c5b14b7041cdc907e771286dd45e06169e9a0cd8d59cf70946fde783',size:8410257},{version:'1.4.0',sha256:'d29210b4d33f6a3ed57309e9287f6b8106fd7336599ad349051cf164464580cc',size:48517332},{version:'1.4.1',sha256:'4982dcd2b987d54b0c3b96da63ef5af0d6e6a687de48914468f4a75da3e58b09',size:48681205}]},payload,files,installer:{file:'鑫金源珠宝-手机打印版-安装程序-1.2.0.exe',sha256:'e9a91c5ee34b436097e2861793b8b9ea73e1535118ba790897fa19998d796528',size:104851591}};
 if(!manifest.app.sourcePackages.some(item=>item.version===old.version&&item.size===fs.statSync(oldAsar).size&&item.sha256===sha(oldAsar)))throw new Error('Selected baseline package has not been verified');
 const file=path.join(destination,'manifest.json');fs.writeFileSync(file,JSON.stringify(manifest,null,2)+'\n');fs.writeFileSync(path.join(destination,'manifest.sha256'),sha(file)+'\n');
 return {destination,payload,files:files.length,baseline:manifest.app.sourcePackages[0]};
}
if(require.main===module)(process.argv.includes('--manifest')?packagePatch(process.argv[2],process.argv[3]):buildAsar(process.argv[2]||path.join(desktop,'patch-build'))).then(r=>process.stdout.write(JSON.stringify(r)+'\n')).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={buildAsar,packagePatch,sha};
