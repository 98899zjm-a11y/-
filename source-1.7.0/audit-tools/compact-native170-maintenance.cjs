'use strict';
// Data-only derivative of the reviewed signed build. No worker or signed payload
// changes. The internal bundle has no first-install entry or first-install data.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),RW=path.join(ROOT,'release-work'),SOURCE=path.join(RW,'native170-bundle-build-a4'),OUT=path.join(RW,'native170-maintenance-bundle-a1');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),read=p=>fs.readFileSync(p);
const BUILDER='8cc37db37a534b53eed40a012366bcbfb56a3e701caf831d2e02eb905bcf7cd6',ASSEMBLY='0df3ab745a7d75610a03884ae0d6352f07d357b4560bcc6ccb441ec1af3b12d6';
async function main(){
 assert.equal(ROOT.toLowerCase(),'e:\\codex\\2026-10-15\\work\\xjy-v16-deep-audit');assert.deepEqual(process.argv.slice(2),['build']);
 const parser=path.join(ROOT,'audit-tools/pack-bridge170-resource.cjs');assert.equal(sha(read(parser)),'7c997c625b00b20faffad57bffa8c69b8ea80a1900b101f47a8aaa9b2fd39dab');const {scanFile}=require(parser);
 const builder=path.join(ROOT,'delivery-tools/prepare-native170-bundle-a1.cjs');assert.equal(sha(read(builder)),BUILDER);const {compressedZip,assertWindowsPowerShellSyntax}=require(builder);
 assert.equal(sha(read(path.join(SOURCE,'assembly.json'))),ASSEMBLY);const original=JSON.parse(read(path.join(SOURCE,'assembly.json')));assert.equal(original.signedPayloadsVerified,7);assert.equal(original.files.length,3286);
 const exempt=new Set(['一键升级.cmd','首次安装主机.cmd','首次安装员工.cmd','安装组件/native-delivery-170.ps1']);
 const omit=original.files.filter(r=>r.path.startsWith('首次安装材料/'));assert.equal(omit.length,1081);
 const keep=original.files.filter(r=>!r.path.startsWith('首次安装材料/')&&!exempt.has(r.path));assert.equal(keep.length,2201);
 for(const r of original.files){const actual=scanFile(path.join(SOURCE,'package',...r.path.split('/')));assert.equal(actual.size,r.size);assert.equal(actual.sha256,r.sha256);}
 assert(!fs.existsSync(OUT),'CreateNew derivative required');fs.mkdirSync(OUT);const bundle=path.join(OUT,'package');fs.mkdirSync(bundle);
 function put(rel,bytes){const p=path.join(bundle,...rel.split('/'));fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,bytes,{flag:'wx',mode:0o600});return{path:rel,...scanFile(p)};}
 const rows=[];for(const r of keep){const p=path.join(bundle,...r.path.split('/'));fs.mkdirSync(path.dirname(p),{recursive:true});fs.copyFileSync(path.join(SOURCE,'package',...r.path.split('/')),p,fs.constants.COPYFILE_EXCL);const actual=scanFile(p);assert.equal(actual.size,r.size);assert.equal(actual.sha256,r.sha256);rows.push({path:r.path,...actual});}
 const proposal=path.join(RW,'native170-bundle-proposal-a4'),template=read(path.join(proposal,'wrapper-template.ps1.in'));assert.equal(sha(template),'358c1c2074d62fb9fab23f9dd6755c2902ecf22aea9200dd54cc4e70b133ecb4');
 const fullHeader="[ValidateSet('Upgrade','FreshHost','FreshEmployee','Recover','RecoverStart','Bridge')][string]$Action='Upgrade'";
 let ps=template.toString('utf8');assert.equal(ps.split(fullHeader).length,2);ps=ps.replace(fullHeader,"[ValidateSet('Recover','RecoverStart','Bridge')][string]$Action='Bridge'");
 const brief=rs=>rs.map(({path,size,sha256})=>({path,size,sha256})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 ps=ps.replace('@@PATH_GUARD@@',read(path.join(proposal,'wrapper-path-guard.ps1')).toString('utf8').replace(/^\uFEFF/,''))
  .replace('@@PROGRESS_VIEW@@',read(path.join(proposal,'wrapper-progress-view.ps1')).toString('utf8').replace(/^\uFEFF/,''))
  .replace('@@FILES_BASE64@@',Buffer.from(JSON.stringify(brief(rows))).toString('base64')).replaceAll('@@BINDING_SHA256@@',original.bindingSha256);
 assert(!/@@[A-Z_]+@@/.test(ps));rows.push(put('安装组件/native-delivery-170.ps1',Buffer.from(ps)));const syntax=assertWindowsPowerShellSyntax(path.join(bundle,'安装组件/native-delivery-170.ps1'));
 const stub=Buffer.from('@echo off\r\necho Internal maintenance data only. Use Update inside the installed employee application.\r\nexit /b 1\r\n');for(const name of ['一键升级.cmd','首次安装主机.cmd','首次安装员工.cmd'])rows.push(put(name,stub));
 assert.equal(rows.length,2205);assert.equal(scanFile(path.join(bundle,'engine-native170-binding.json')).sha256,original.bindingSha256);
 for(const r of rows.filter(r=>!exempt.has(r.path))){const old=keep.find(x=>x.path===r.path);assert(old&&old.sha256===r.sha256&&old.size===r.size);}
 const archive=await compressedZip(path.join(OUT,'native-package.zip'),rows);
 const result={...original,purpose:'native170-maintenance-bundle-from-reviewed-build',sourceNativeAssemblySha256:ASSEMBLY,files:brief(rows),archive:{size:archive.size,sha256:archive.sha256,compression:'DEFLATE',maximumBytes:805306368},omittedFreshFiles:1081,firstInstallEntryDisabled:true,allowedActions:['Bridge','Recover','RecoverStart'],wrapperSyntax:syntax,programExecuted:false,installed:false};delete result.treeSha256;
 fs.writeFileSync(path.join(OUT,'assembly.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({files:rows.length,archiveBytes:archive.size,assemblySha256:sha(read(path.join(OUT,'assembly.json'))),archiveSha256:archive.sha256,programExecuted:false}));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
