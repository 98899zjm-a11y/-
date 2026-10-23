'use strict';
// Fixed public CLI negative controls. No successful sign call is present.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),cp=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
assert.equal(ROOT.toLowerCase(),'e:\\codex\\2026-10-15\\work\\xjy-v16-deep-audit');
const script='audit-tools/sign-host-policy-162.cjs',pin='e278cd38676ab25bb58aa742c8e88ae7db70262ed7eb84ca86687c6e25f7ff70';
assert.equal(sha(fs.readFileSync(path.join(ROOT,script))),pin);
assert.equal(sha(fs.readFileSync(process.execPath)),'ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32');
const report=path.join(ROOT,'audit-evidence/host162-signing-negative-controls-20261019.json');
assert(!fs.existsSync(report),'CreateNew evidence only');
const outputs=['release-work/initial-162-host-source-policy-envelope-a1.json','reports/release-162-host-policy-sign-a1.json'];
for(const file of outputs)assert(!fs.existsSync(path.join(ROOT,file)),'Must run negative controls before signing');
const prep='97805ecb0443a4cd7052f11feee3879d17a53708a47eec17df061f8b88d9e8fd',policy='40abc3aeb5fb954c3aa52f4d443f07a00957476b1a51c0ea09ece9e73f7e8b17';
const common=['--source-sha256',pin,'--approved-preparation-report-sha256',prep,'--expected-policy-sha256',policy];
const cases=[['default',[]],['missing_authority',['sign',...common]],['wrong_policy',['sign',...common.slice(0,-1),'0'.repeat(64),'--authorized-original-issuer-signing']],['wrong_self',['sign','--source-sha256','0'.repeat(64),...common.slice(2),'--authorized-original-issuer-signing']],['unknown_key_override',['sign',...common,'--authorized-original-issuer-signing','--key','F:/not-allowed']],['duplicate_authority',['sign',...common,'--authorized-original-issuer-signing','--authorized-original-issuer-signing']]];
const env={};for(const name of ['SystemRoot','WINDIR','TEMP','TMP','PATH','PATHEXT','COMSPEC','USERNAME','USERPROFILE','LOCALAPPDATA','APPDATA'])if(process.env[name])env[name]=process.env[name];
const results=[];
for(const [name,args]of cases){const result=cp.spawnSync(process.execPath,[script,...args],{cwd:ROOT,env,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:262144});assert(!result.error,result.error?.message);assert.equal(result.signal,null);assert.equal(result.status,1,name+' must reject');assert.equal(result.stdout.trim(),'');const value=JSON.parse(result.stderr.trim());for(const key of ['privateKeyReadAttempted','privateKeyRead','signatureCreated','signingCompleted','published','installed','programExecuted'])assert.equal(value[key],false,name+':'+key);for(const file of outputs)assert(!fs.existsSync(path.join(ROOT,file)));results.push({name,exitCode:result.status,privateKeyRead:false,signatureCreated:false,error:value.error});}
assert.equal(sha(fs.readFileSync(path.join(ROOT,script))),pin);
const evidence={purpose:'host162-signing-public-negative-controls',passed:true,tests:results.length,failures:0,signerSha256:pin,successfulSigningInvoked:false,privateKeyRead:false,results};
fs.writeFileSync(report,JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({passed:true,tests:results.length,failures:0,privateKeyRead:false,report,reportSha256:sha(fs.readFileSync(report))}));
