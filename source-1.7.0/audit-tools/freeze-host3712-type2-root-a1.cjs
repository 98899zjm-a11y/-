'use strict';
// Fixed test maintenance only; no shutdown or product execution here.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const W='E:/codex/2026-10-15/work/xjy-v16-deep-audit',D=path.join(W,'release-work/deepseek-stage1-development-a1'),B=path.join(W,'release-work/native160-host3712-rmtype2-draft-a1'),O=path.join(W,'release-work/native160-host3712-rmtype2-root-bound-a1'),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=(f,p)=>{const b=fs.readFileSync(f);assert.equal(hash(b),p);return b;};
read(path.join(W,'reports/2026-10-20-autonomous-delivery-user-authorization.md'),'7dfc073888846668db2be629a35a23a6db8a52fbcfbb9b934a67b4579cbbc9e0');
const cs=read(path.join(B,'GuestRmCloseHost3712.cs'),'7b849f2229e825e4705e17a3649f340ce707f9f181c12f4f3b4e44cc1582618e').toString('utf8'),a=JSON.parse(read(path.join(B,'root-host3712-type2-approval.TEMPLATE.json'),'13d2cc5b4824204c75032f82023e4e22b6b513768ec0b2f4e73ff88e3a4aae52'));
const actual=read(path.join(B,'inspect3d52-native.stdout.raw'),'c4761ba1181142909f4e7c50467646c1d0f2130fc4490420fb2be976f9dbdb39').toString('utf8').trim().split(/\r?\n/).map(x=>JSON.parse(x)).find(x=>x.phase==='RM-list-actual-fields');
assert.equal(actual.rows.length,1);assert.equal(actual.rows[0].type,2);assert.equal(actual.rows[0].pid,3712);assert.equal(actual.rows[0].nativeFileTime,'134370097562143887');assert.equal(actual.rows[0].session,1);assert.equal(actual.rows[0].service,'');assert.equal(a.approved,false);
a.approved=true;a.creator='Root';a.approvedAt=new Date().toISOString();a.expiresAt=new Date(Date.now()+90*60000).toISOString();a.rootDecision='Only C6 synthetic Host3712, exact observed RmOtherWindow(2), nonforced flags0 test maintenance under 7dfc delegation. Unknown/critical/service types remain refused. No production, F or database access; held actual exit0 and independent quiet required. Not tray or business flush acceptance.';
const raw=Buffer.from(JSON.stringify(a,null,2)+'\n'),pin=hash(raw);assert(cs.includes('ApplyBound=false')&&cs.includes('UNBOUND_ROOT_3712_TYPE2_APPROVAL_RAW_SHA')&&cs.includes('list[0].Type==2'));
const bound=cs.replace('ApplyBound=false','ApplyBound=true').replace('UNBOUND_ROOT_3712_TYPE2_APPROVAL_RAW_SHA',pin);
const controller=read(path.join(W,'release-work/native160-host3712-rm0-root-bound-a1/run-host3712-rm0-close.UNBOUND.cjs'),'6d8dfc95e0094492a244070e9eed6a20134dc97a75411b73e19e4cb403ffee43');
assert(!fs.existsSync(O));fs.mkdirSync(O);for(const [name,b]of[['GuestRmCloseHost3712.cs',bound],['run-host3712-rm0-close.UNBOUND.cjs',controller],['root-host3712-rm0-approval.json',raw]])fs.writeFileSync(path.join(O,name),b,{flag:'wx'});
fs.writeFileSync(path.join(W,'reports/native160-host3712-type2-root-approval-a1.json'),raw,{flag:'wx'});
const control=path.join(D,'control/root-host3712-rm0-approval.json');read(control,'9b5775951384a7dff540ba0a125f9a513c67eca62e4c0f0f27e9b69258997f84');fs.writeFileSync(control,raw);
console.log(JSON.stringify({out:O,approvalSha256:pin,sourceSha256:hash(Buffer.from(bound)),approvedAt:a.approvedAt,expiresAt:a.expiresAt,acceptedRmTypes:[2],rmExecuted:false,productionAccess:false}));
