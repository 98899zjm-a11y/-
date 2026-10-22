'use strict';
// Builds source/prepare-release-r2.cjs: the sequence-21 / r2-asar trust-chain fork.
// Every replacement is asserted to occur exactly once; any mismatch aborts.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SRC = process.argv[2] || 'D:/Codex/xjy-release-20261022/source/prepare-release.cjs';
const OUT = process.argv[3] || 'D:/Codex/xjy-release-20261022/source/prepare-release-r2.cjs';
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

let text = fs.readFileSync(SRC, 'utf8');
const log = [];
function sub(label, search, replace) {
  const parts = text.split(search);
  if (parts.length !== 2) throw new Error(`COUNT_MISMATCH ${label} expected 1 got ${parts.length - 1}`);
  text = parts.join(replace);
  log.push(label);
}
function resub(label, re, replace) {
  const matches = text.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'));
  const count = matches ? matches.length : 0;
  if (count !== 1) throw new Error(`COUNT_MISMATCH ${label} expected 1 got ${count}`);
  text = text.replace(re, replace);
  log.push(label);
}

// 1. sequence target 20 -> 21
sub('SEQUENCE.target', 'const SEQUENCE=Object.freeze({bridge:12,resource:17,target:20,worker:28});',
  'const SEQUENCE=Object.freeze({bridge:12,resource:17,target:21,worker:28});');
// 2. typed source pin: source19 payload -> source20 payload
sub('SLOT_SOURCE_PIN', "const SLOT_SOURCE_PIN='c049bc4d886a1aefd4100e0e397fb12a94293838609712ce6404d6227c294535';",
  "const SLOT_SOURCE_PIN='4d78cbbac07b05f267fabb870a10376a2c1158a8b4623ba4ea35d3334cb828ef';");
// 3. verifySlotSourceCatalog contract
resub('verifySlotSourceCatalog', /c\.sequence!==19\|\|c\.files\.length!==1079\|\|SEQUENCE\.target!==20/,
  'c.sequence!==20||c.files.length!==1079||SEQUENCE.target!==21');
sub('verifySlotSourceCatalog.msg', "'Exact typed source19 and target20 required'", "'Exact typed source20 and target21 required'");
// 4. verifySource19Envelope identity -> source20
resub('verifySource19Envelope', /if\(c\.sequence!==19\|\|c\.version!=='1\.7\.0'\|\|c\.files\.length!==1079\)fail\('SOURCE19_CONTRACT','Typed source19 identity'\)/,
  "if(c.sequence!==20||c.version!=='1.7.0'||c.files.length!==1079)fail('SOURCE19_CONTRACT','Typed source20 identity')");
// 5. SOURCE19 envelope source/pin/sequence
sub('SOURCE19.envelopeSource', "envelopeSource:path.join(RW,'native170-target19-worker20-repair-a1/approvals/target.catalog-envelope.json')",
  "envelopeSource:path.join(SOURCE_ROOT,'seq21-inputs/source20.envelope.json')");
sub('SOURCE19.envelopeSha256', "envelopeSha256:'53f6fa7017185acd9c25b7139b558db0daf923e0d72bece4e6a34d1e7820bc03'",
  "envelopeSha256:'6abc30889f4f79cd9313cf4480d805742d695b51da0846ad129b9fbaff6f10cf'");
sub('SOURCE19.sequence', 'sequence:19,files:1079',
  'sequence:20,files:1079');
// 6. TARGET20_REUSE -> TARGET21
sub('TARGET20_REUSE', "const TARGET20_REUSE=Object.freeze({payloadSha256:'4d78cbbac07b05f267fabb870a10376a2c1158a8b4623ba4ea35d3334cb828ef',payloadSize:230255,envelopeSha256:'6abc30889f4f79cd9313cf4480d805742d695b51da0846ad129b9fbaff6f10cf',envelopeSize:246632});",
  "const TARGET21_REUSE=Object.freeze({payloadSha256:'b415a4e96c321dca805aca3eae429a9821dc5eb660a3b504ebbbeebd49264d98',payloadSize:230254,envelopeSha256:'59f6e0ede1f710a9edae74f4150ae0c1db2739481cf80ec3c17ee0a18a9a87b6',envelopeSize:246639});");
// 7. verifyDefaultSource14 target sequence 20 -> 21
resub('verifyDefaultSource14.target', /target\.sequence!==20/, 'target.sequence!==21');
sub('verifyDefaultSource14.msg', "'Only original14/nonASAR1078 match unchanged target20'", "'Only original14/nonASAR1078 match unchanged target21'");
// 8. signature requirements: new target21 signature, typed source20
sub('SIGNATURE.target', "{id:'target.catalog',kind:'request',status:'EXACT_PUBLIC_SIGNATURE_REUSE'}",
  "{id:'target.catalog',kind:'request',status:'UNSIGNED_NEW_TARGET21'}");
sub('SIGNATURE.typed-source19', "{id:'typed-source19',kind:'binding',field:'slotSourceEnvelope',status:'EXACT_PUBLIC_SIGNATURE_REUSE'}",
  "{id:'typed-source20',kind:'binding',field:'slotSourceEnvelope',status:'EXACT_PUBLIC_SIGNATURE_REUSE'}");
// 9. reviewed manifest purpose
sub('purpose.1', "value.purpose!=='native170-known14-and19-target20-worker28'", "value.purpose!=='native170-known14-and20-target21-worker28'");
// 10. asar draft pins -> r2 asar + r2 report
sub('A12_DRAFT.asarSha256', "asarSha256:'d017ceb9947ec3ead43de68a2da1e9aac928c56129bb5c2abafa36238026141d'",
  "asarSha256:'9593b161f7091f5b471ce4918afee480097105b5668abbe154eb60075b1025a4'");
sub('A12_DRAFT.asarReportSha256', "asarReportSha256:'d9e98563eeb6c48bc6536a9816c9acc2365a493e531c84ea75577e129f4877a5'",
  "asarReportSha256:'139fd30e9afc4324e76a4e571c9bba5b043ddd4fd43bf7cbef004b9c51541c2f'");
// 11. replace the A12 asar verifier with the r2 pure-data verifier
const startMarker = 'function a12VerifyAsar(value){';
const endMarker = 'const REVIEWER_PRESET=Object.freeze(';
const start = text.indexOf(startMarker);
const end = text.indexOf(endMarker);
if (start < 0 || end < 0 || end < start) throw new Error('ASAR_FN_ANCHOR');
const body = text.slice(start, end);
if (!body.includes('repack-native170-handoff-asar-a12-final-a1.py')) throw new Error('ASAR_FN_UNEXPECTED');
const replacement = `function a12VerifyAsar(value){
 const verifier=path.join(SOURCE_ROOT,'r2-asar/verify-r2-asar-a1.py'),verifierPin='${hash('D:/Codex/xjy-release-20261022/source/r2-asar/verify-r2-asar-a1.py')}';
 pinned(verifier,verifierPin);
 const result=require('node:child_process').execFileSync('C:/Python314/python.exe',['-B',verifier,'--baseline',value.baseline,'--r2',value.source,'--report',value.reportSource],{windowsHide:true,shell:false,encoding:'utf8',timeout:120000,maxBuffer:262144,env:{SystemRoot:'C:/Windows',WINDIR:'C:/Windows',SystemDrive:'C:',PYTHONDONTWRITEBYTECODE:'1'}});
 const proof=JSON.parse(result);
 if(proof.verified!==true||proof.pureDataOnly!==true||proof.programExecuted!==false||proof.originalMembers!==149||proof.finalMembers!==149||proof.changedMembers.length!==1||proof.changedMembers[0]!=='native-publication-update.cjs'||proof.preservedMembers!==148||proof.asarSha256!==value.sha256||proof.rendererSha256!=='c08a94f2a32ef935c492f86b582da8f7cda364dac61ac1277406d51185285282')fail('R2_ASAR_PROOF','Only the version-agnostic client member may change');
 const reportSha=hash(fs.readFileSync(value.reportSource));if(reportSha!==value.reportSha256)fail('R2_ASAR_REPORT','Exact r2 asar report required');
 return proof;
}
`;
text = text.slice(0, start) + replacement + text.slice(end);
log.push('a12VerifyAsar');

fs.writeFileSync(OUT, text);
console.log(JSON.stringify({ ok: true, out: OUT, bytes: Buffer.byteLength(text), sha256: hash(OUT), edits: log }, null, 2));
