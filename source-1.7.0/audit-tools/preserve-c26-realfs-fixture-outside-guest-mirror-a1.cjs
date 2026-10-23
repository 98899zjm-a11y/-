'use strict';
// Retain this synthetic long-path fixture outside the bridge's PowerShell copy.
// Same-volume directory rename only; no recursive delete, source editing or DB.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const W=String.raw`E:\codex\2026-10-15\work\xjy-v16-deep-audit`;
const from=path.join(W,'release-work/deepseek-stage1-development-a1/handoff-output/c26-realfs-a2-aRsHcH'),to=path.join(W,'reports/native170-c26-realfs-evidence-a3');
const within=p=>assert(path.resolve(p).toLowerCase().startsWith(path.resolve(W).toLowerCase()+path.sep));
for(const p of [from,to])within(p);
function plainChain(p){for(let cur=path.resolve(p);;cur=path.dirname(cur)){const s=fs.lstatSync(cur);assert(!s.isSymbolicLink());assert.equal(fs.realpathSync.native(cur).toLowerCase(),cur.toLowerCase());if(cur===path.dirname(cur))break;}}
plainChain(from);plainChain(path.dirname(to));assert(!fs.existsSync(to));
const before=fs.lstatSync(from,{bigint:true}),report=fs.readFileSync(path.join(from,'last-run.json')),parsed=JSON.parse(report);
assert.equal(parsed.ok,true);assert.equal(parsed.fixtureKept,true);assert.equal(parsed.checks.length,6);assert.equal(path.resolve(parsed.outputDir),path.resolve(from));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const publicEvidence=path.join(W,'release-work/deepseek-stage1-development-a1/handoff-output/c26-realfs-a3-actual-result.json');
fs.writeFileSync(publicEvidence,report,{flag:'wx'});
fs.renameSync(from,to);plainChain(to);assert(!fs.existsSync(from));const after=fs.lstatSync(to,{bigint:true});
for(const k of ['dev','ino','birthtimeNs'])assert.equal(after[k],before[k]);assert.equal(sha(fs.readFileSync(path.join(to,'last-run.json'))),sha(report));
const note={syntheticFixtureOnly:true,from,to,reason:'Avoid copying >MAX_PATH synthetic test files through the existing PowerShell Guest mirror; preserve evidence rather than deleting or weakening guards.',samePhysicalDirectory:true,reportSha256:sha(report),noFormalTouched:true,guestMirrorFailureRun:'1edbb92b-786f-436e-82a5-96fd55ed54b3',guestEntryStarted:false};
fs.writeFileSync(path.join(W,'reports/native170-c26-realfs-evidence-relocation-a1.json'),JSON.stringify(note,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(note));
