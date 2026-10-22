'use strict';
/*
 * ROOT_DERIVE_NEW_OUTER.cjs  (Root-side derivation for D:/Codex/xjy-release-20261022)
 *
 * Reads ONLY the new release artifacts under R and writes ONLY these new files:
 *   R/source/root-outer-signing-scope-20261022-ROOT.json
 *   R/source/sign-native170-ROOT-20261022-outer-a1.cjs
 *   R/source/root-derive-new-outer-report.json
 *
 * It never reads a private key, never signs, never runs product/install/feed code,
 * never touches the ZIP, and never modifies any already-signed artifact.
 * The generated signer is modelled on the frozen C28 outer signer and keeps the
 * source/FD validation, check mode, sign-approved mode, publisher identity check,
 * read-only + zeroized key handling, ZIP-immutability and signature read-back.
 *
 * Usage:  node ROOT_DERIVE_NEW_OUTER.cjs [--check]
 *   --check  verify every input and render both outputs in memory without writing.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const R = 'D:/Codex/xjy-release-20261022';
const SOURCE = path.join(R, 'source');
const PROPOSAL = path.join(R, 'candidate', 'proposal');
const BUILD = path.join(R, 'candidate', 'build');
const DIR = path.join(SOURCE, 'c28-native-publication');

const PURPOSE = 'native170-xjy-release-20261022-single-outer-root-signing';
const SCOPE_NAME = 'root-outer-signing-scope-20261022-ROOT.json';
const SIGNER_NAME = 'sign-native170-ROOT-20261022-outer-a1.cjs';
const DERIVE_REPORT_NAME = 'root-derive-new-outer-report.json';
const AUTH_TOKEN = '--authorized-root-release-20261022-exact-outer-payload';

const NODE = 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe';
const NODE_SHA = '3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237';
const KEY = 'E:/codex/2026-10-13/work/xjy-web-stage1/config/release-signing/issuer-private.pem';
const PUBLISHER = '6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c';
const OLD_E_AUTHORITY = [
  '7dfc073888846668db2be629a35a23a6db8a52fbcfbb9b934a67b4579cbbc9e0',
  'ad6af9171e0c15c95253182842e01199282c08cf06f3844072817ff20d385a9c'
];
/* Exact signed C27 worker27 preimage; the current manifest changes four rows. */
const C28_WORKER_SHA = '9fdcb5d5c32c9976e36d7911a730bcce1af9478e3d6921576b7f5b97dfd68862';
const C28_ROWS = {
  'delivery-tools/engine-tree-runtime170.cjs': '67cf3275f00c65150f784e92e8628b1896eb674b752b6e9bfc893c41273ebb8b',
  'delivery-tools/native-employee-slot170.cjs': '48f6da518d83192fd9641c01100fba50689abbe8925b061d3ba8505c896ddd6c'
};
/* The two required patch deltas named by the task (SHA is authoritative). */
const FIXED_SHA = {
  'delivery-tools/install-location.cjs': '3e4698f282d521ea9456375f1948ca5032db79783fb5e9b486b8c68fc5f24cba',
  'delivery-tools/delivery-native-170.cjs': 'c962f1c314866be0a57d7aef819954f47a389998e6eb78dd30562d99b0cb52fc'
};
const DELTA_PATHS = [
  'delivery-tools/delivery-native-170.cjs',
  'delivery-tools/engine-tree-runtime170.cjs',
  'delivery-tools/install-location.cjs',
  'delivery-tools/native-employee-slot170.cjs'
];
const ZIP_ROWS = 3293;
const ASAR_MEMBERS = 149;
const WORKER_FILES = 101;
const WORKER_UNCHANGED = 97;
const MAX_ZIP = 1610612736;

const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const SHA = /^[a-f0-9]{64}$/;
const q = s => JSON.stringify(s);
const win = p => p.replace(/\//g, '\\');

function fail(code, message) {
  const error = new Error(code + (message ? ': ' + message : ''));
  error.code = code;
  throw error;
}
function within(file, root) {
  const rel = path.relative(path.resolve(root), path.resolve(file));
  return rel === '' || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep));
}
function readStable(file, max) {
  const p = path.resolve(file);
  if (!within(p, R)) fail('PATH_OUTSIDE_RELEASE_ROOT', p);
  for (let q2 = p; ; q2 = path.dirname(q2)) {
    const s = fs.lstatSync(q2, { bigint: true });
    if (s.isSymbolicLink() || fs.realpathSync.native(q2).toLowerCase() !== q2.toLowerCase()) fail('ALIAS_REJECTED', q2);
    if (q2 === p) {
      if (!s.isFile() || s.nlink !== 1n) fail('ORDINARY_FILE_REQUIRED', p);
    } else if (!s.isDirectory()) fail('ORDINARY_DIR_REQUIRED', q2);
    if (q2 === path.dirname(q2)) break;
  }
  const fd = fs.openSync(p, 'r');
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(max)) fail('INPUT_BOUND', p);
    const bytes = fs.readFileSync(fd);
    if (BigInt(bytes.length) !== before.size) fail('INPUT_TRUNCATED', p);
    const after = fs.fstatSync(fd, { bigint: true });
    for (const k of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'nlink']) {
      if (before[k] !== after[k]) fail('INPUT_CHANGED', p);
    }
    for (let q2 = p; ; q2 = path.dirname(q2)) {
      const s = fs.lstatSync(q2, { bigint: true });
      if (s.isSymbolicLink() || fs.realpathSync.native(q2).toLowerCase() !== q2.toLowerCase()) fail('ALIAS_AFTER_READ', q2);
      if (q2 === path.dirname(q2)) break;
    }
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}
function readJson(file, max) {
  return JSON.parse(readStable(file, max).toString('utf8'));
}
function hashFile(file, max) {
  const p = path.resolve(file);
  if (!within(p, R)) fail('PATH_OUTSIDE_RELEASE_ROOT', p);
  for (let q2 = p; ; q2 = path.dirname(q2)) {
    const s = fs.lstatSync(q2, { bigint: true });
    if (s.isSymbolicLink() || fs.realpathSync.native(q2).toLowerCase() !== q2.toLowerCase()) fail('ALIAS_REJECTED', q2);
    if (q2 === p) {
      if (!s.isFile() || s.nlink !== 1n) fail('ORDINARY_FILE_REQUIRED', p);
    } else if (!s.isDirectory()) fail('ORDINARY_DIR_REQUIRED', q2);
    if (q2 === path.dirname(q2)) break;
  }
  const fd = fs.openSync(p, 'r');
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size < 1n || before.size > BigInt(max)) fail('ARCHIVE_BOUND', p);
    const h = crypto.createHash('sha256');
    const buf = Buffer.alloc(4194304);
    let at = 0;
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, at);
      if (!n) break;
      h.update(buf.subarray(0, n));
      at += n;
    }
    if (BigInt(at) !== before.size) fail('ARCHIVE_TRUNCATED', p);
    const after = fs.fstatSync(fd, { bigint: true });
    for (const k of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'nlink']) {
      if (before[k] !== after[k]) fail('ARCHIVE_CHANGED', p);
    }
    return { size: at, sha256: h.digest('hex') };
  } finally {
    fs.closeSync(fd);
  }
}
function sortRows(rows) {
  return rows.map(r => ({ path: r.path, size: r.size, sha256: r.sha256 }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
function assertArchiveContract(assemblyArchive, manifestArchive, archiveSha, archiveBytes) {
  assert(assemblyArchive && typeof assemblyArchive === 'object' && !Array.isArray(assemblyArchive));
  assert.deepEqual(Object.keys(assemblyArchive).sort(), ['compression', 'maximumBytes', 'sha256', 'size']);
  assert.equal(assemblyArchive.compression, 'DEFLATE');
  assert.equal(assemblyArchive.maximumBytes, 805306368);
  assert.equal(assemblyArchive.size, archiveBytes);
  assert.equal(assemblyArchive.sha256, archiveSha);
  assert(manifestArchive && typeof manifestArchive === 'object' && !Array.isArray(manifestArchive));
  assert.deepEqual(Object.keys(manifestArchive).sort(), ['sha256', 'size']);
  assert.equal(manifestArchive.size, archiveBytes);
  assert.equal(manifestArchive.sha256, archiveSha);
  assert.deepEqual({ size: assemblyArchive.size, sha256: assemblyArchive.sha256 }, manifestArchive);
}
function findEnvelopes(names) {
  for (const rel of ['candidate/approvals', 'candidate/proposal']) {
    const dir = path.join(R, ...rel.split('/'));
    let st;
    try { st = fs.lstatSync(dir); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    if (!st.isDirectory()) continue;
    const have = new Set(fs.readdirSync(dir));
    if (names.every(n => have.has(n))) return rel;
  }
  return fail('ENVELOPE_DIR_MISSING', 'the 7 signed envelopes were not found under candidate/approvals');
}

function buildScope(V) {
  return {
    schemaVersion: 1,
    purpose: V.purpose,
    approved: true,
    templateOnlyNotRootApproval: false,
    rootReleaseAuthorized: true,
    authorityRecordSha256: V.authoritySha,
    authorityRecordNote: 'Hash of the Root release record R/source/authority-release.md actually present on this machine; old E authority records are rejected.',
    internalSignatureReportSha256: V.internalSha,
    rawPayloadSha256: V.payloadSha,
    rawPayloadBytes: V.payloadBytes,
    requestSha256: V.requestSha,
    requestBytes: V.requestBytes,
    archiveSha256: V.archiveSha,
    archiveBytes: V.archiveBytes,
    assemblySha256: V.assemblySha,
    assemblyBytes: V.assemblyBytes,
    bindingSha256: V.bindingSha,
    proposalManifestSha256: V.proposalSha,
    requestIndexSha256: V.indexSha,
    preparationToolSha256: V.prepareSha,
    reviewedInputsSha256: V.reviewSha,
    combinationAuditReportSha256: V.auditSha,
    combinationAuditReportBytes: V.auditBytes,
    internalSignatureReportBytes: V.internalBytes,
    sequence: V.seqManifest,
    targetCatalogSha256: V.targetSha,
    resourceCatalogSha256: V.resourceSha,
    workerCatalogSha256: V.workerSha,
    workerSequence: V.workerSeq,
    workerChangedRows: V.workerDelta,
    workerUnchangedRows: WORKER_UNCHANGED,
    workerFiles: WORKER_FILES,
    sourcePolicySha256: V.policySha,
    nodeSha256: V.nodeSha,
    expectedPaths: ZIP_ROWS,
    actualAsarMembers: ASAR_MEMBERS,
    notHistoricalDigestClick: true,
    authorizedRootRelease20261022Only: true,
    exactNewOuterPayloadOnly: true,
    noFeedPublication: true,
    noArchiveModification: true,
    noPrivateKeyCopy: true,
    noOtherPayloadSigning: true,
    noFormalInstallBySigner: true,
    rootAuthorityRecordBound: true,
    workerDeltaExactlyFourRows: true,
    reviewerPresetAccepted: true,
    historyPathComponentAccepted: true,
    approvalIoMirrorSourceReviewed: true
  };
}

const SIGNER_TEMPLATE = String.raw`'use strict';
// Root-bound D:/Codex/xjy-release-20261022 detached outer signer only; no ZIP writes/feed/install.
const fs0=require('node:fs'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),Module=require('node:module');
const R='D:/Codex/xjy-release-20261022',SOURCE=path.join(R,'source'),PROPOSAL=path.join(R,'candidate','proposal'),BUILD=path.join(R,'candidate','build'),DIR=path.join(SOURCE,'c28-native-publication'),APPROVALS=path.join(R,__ENV_DIR__);
const NODE=__NODE__,NODE_SHA=__NODE_SHA__;
const PUBLISHER=__PUBLISHER__,OLD_E_AUTHORITY=__OLD_E_AUTH__;
const KEY=__KEY__;
const AUTHORITY=path.join(SOURCE,'authority-release.md'),AUTHORITY_SHA=__AUTHORITY_SHA__,AUTHORITY_BYTES=__AUTHORITY_BYTES__;
const PREPARE=path.join(SOURCE,'prepare-release.cjs'),PREPARE_SHA=__PREPARE_SHA__,PREPARE_BYTES=__PREPARE_BYTES__;
const AUDITOR=path.join(SOURCE,'audit-release.cjs'),AUDITOR_SHA=__AUDITOR_SHA__,AUDITOR_BYTES=__AUDITOR_BYTES__;
const REVIEW_INPUT=path.join(SOURCE,'reviewed-inputs-ROOT.json'),REVIEW_INPUT_SHA=__REVIEW_SHA__,REVIEW_INPUT_BYTES=__REVIEW_BYTES__;
const INTERNAL_REPORT=path.join(SOURCE,'worker-signing-report.json'),INTERNAL_SHA=__INTERNAL_SHA__,INTERNAL_BYTES=__INTERNAL_BYTES__,ROOT_SCOPE_REPORT_SHA=__ROOT_SCOPE_SHA__;
const OUTER_SCOPE=path.join(SOURCE,__SCOPE_NAME__),OUTER_SCOPE_SHA=__OUTER_SCOPE_SHA__,OUTER_SCOPE_BYTES=__OUTER_SCOPE_BYTES__;
const PROPOSAL_MANIFEST=path.join(PROPOSAL,'proposal-manifest.json'),PROPOSAL_SHA=__PROPOSAL_SHA__,PROPOSAL_BYTES=__PROPOSAL_BYTES__;
const INDEX=path.join(PROPOSAL,'signing-requests.json'),INDEX_SHA=__INDEX_SHA__,INDEX_BYTES=__INDEX_BYTES__;
const WORKER_PAYLOAD=path.join(PROPOSAL,'requests','worker.catalog.json'),WORKER_SHA=__WORKER_SHA__,WORKER_BYTES=__WORKER_BYTES__,WORKER_SEQ=__WORKER_SEQ__;
const PAYLOAD=path.join(DIR,'native-manifest-payload.json'),PAYLOAD_SHA=__PAYLOAD_SHA__,PAYLOAD_BYTES=__PAYLOAD_BYTES__;
const REQUEST=path.join(DIR,'signing-request.json'),REQUEST_SHA=__REQUEST_SHA__,REQUEST_BYTES=__REQUEST_BYTES__;
const REPORT_AUDIT=path.join(DIR,'package-audit-report.json'),AUDIT_SHA=__AUDIT_SHA__,AUDIT_BYTES=__AUDIT_BYTES__;
const ASSEMBLY=path.join(BUILD,'assembly.json'),ASSEMBLY_SHA=__ASSEMBLY_SHA__,ASSEMBLY_BYTES=__ASSEMBLY_BYTES__;
const ZIP=path.join(BUILD,'native-package.zip'),ARCHIVE_SHA=__ARCHIVE_SHA__,ARCHIVE_BYTES=__ARCHIVE_BYTES__,BINDING_SHA=__BINDING_SHA__;
const OUTPUT=path.join(DIR,'native-manifest.json'),SIGN_REPORT=path.join(SOURCE,'outer-signing-report.json');
const PUB_PEM=path.join(PROPOSAL,'worker-draft','publisher-public.pem'),PUB_PEM_SHA=__PUB_PEM_SHA__;
const ENVELOPE_PINS=__ENVELOPE_PINS__,TYPED_PINS=__TYPED_PINS__,WORKER_DELTA=__WORKER_DELTA__;
const TARGET_SHA=__TARGET_SHA__,RESOURCE_SHA=__RESOURCE_SHA__,POLICY_SHA=__POLICY_SHA__;
const SEQ_MANIFEST=__SEQ_MANIFEST__,SEQ_TARGET=__SEQ_TARGET__,SEQ_RESOURCE=__SEQ_RESOURCE__,TARGET_VERSION=__TARGET_VERSION__,ENGINE_VERSION=__ENGINE_VERSION__;
const PUBLISHED_AT=__PUBLISHED_AT__,EXPIRES_AT=__EXPIRES_AT__;
const ZIP_ROWS=3293,ASAR_MEMBERS=149,WORKER_FILES=101,WORKER_UNCHANGED=97,PURPOSE=__PURPOSE__,AUTH_TOKEN=__AUTH_TOKEN__;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),SHA=/^[a-f0-9]{64}$/;let keyReads=0;
function source(file,pin,max=1048576){assert(path.isAbsolute(file)&&!/^[/\\]{2}/.test(file));let before;for(let p=path.resolve(file);;p=path.dirname(p)){const s=fs0.lstatSync(p,{bigint:true});assert(!s.isSymbolicLink()&&fs0.realpathSync.native(p).toLowerCase()===p.toLowerCase(),'ordinary public input');if(!before){assert(s.isFile()&&s.nlink===1n);before=s;}else assert(s.isDirectory());if(p===path.dirname(p))break;}const fd=fs0.openSync(file,'r');try{const a=fs0.fstatSync(fd,{bigint:true});assert.equal(a.dev,before.dev);assert.equal(a.ino,before.ino);assert(a.nlink===1n&&a.size<=BigInt(max));const b=fs0.readFileSync(fd);for(let p=path.resolve(file);;p=path.dirname(p)){const live=fs0.lstatSync(p,{bigint:true});assert(!live.isSymbolicLink()&&fs0.realpathSync.native(p).toLowerCase()===p.toLowerCase(),'public input alias after read');if(p===path.resolve(file))assert(live.isFile()&&live.nlink===1n);else assert(live.isDirectory());if(p===path.dirname(p))break;}const other=fs0.openSync(file,'r');try{for(const k of['dev','ino','size','mtimeNs','ctimeNs','nlink']){assert.equal(a[k],fs0.fstatSync(fd,{bigint:true})[k]);assert.equal(a[k],fs0.fstatSync(other,{bigint:true})[k]);}}finally{fs0.closeSync(other);}assert.equal(sha(b),pin,'fixed source changed');return b;}finally{fs0.closeSync(fd);}}
function dataModule(file,pin){const b=source(file,pin,1048576),m=new Module(file,module);m.filename=file;m.require=id=>{assert(id.startsWith('node:'),'data-only builtins');return require(id);};m._compile(b.toString('utf8'),file);return m.exports;}
function assertArchiveContract(assemblyArchive,manifestArchive){assert(assemblyArchive&&typeof assemblyArchive==='object'&&!Array.isArray(assemblyArchive));assert.deepEqual(Object.keys(assemblyArchive).sort(),['compression','maximumBytes','sha256','size']);assert.equal(assemblyArchive.compression,'DEFLATE');assert.equal(assemblyArchive.maximumBytes,805306368);assert.equal(assemblyArchive.size,ARCHIVE_BYTES);assert.equal(assemblyArchive.sha256,ARCHIVE_SHA);assert(manifestArchive&&typeof manifestArchive==='object'&&!Array.isArray(manifestArchive));assert.deepEqual(Object.keys(manifestArchive).sort(),['sha256','size']);assert.equal(manifestArchive.size,ARCHIVE_BYTES);assert.equal(manifestArchive.sha256,ARCHIVE_SHA);assert.deepEqual({size:assemblyArchive.size,sha256:assemblyArchive.sha256},manifestArchive);}
function within(file,root){const rel=path.relative(path.resolve(root),path.resolve(file));return rel===''||(!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep));}
function samePath(a,b){return path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();}
function inputRoot(file){for(const root of[SOURCE,PROPOSAL,BUILD,DIR,APPROVALS])if(within(file,root))return root;if(samePath(file,NODE))return path.dirname(NODE);for(const exact of[__filename,PREPARE,AUDITOR,REVIEW_INPUT,INTERNAL_REPORT,OUTER_SCOPE,AUTHORITY,PROPOSAL_MANIFEST,INDEX,WORKER_PAYLOAD])if(samePath(file,exact))return SOURCE;throw Error('XJY_EXACT_PUBLIC_INPUT_SCOPE');}
function outputRoot(file){if(samePath(file,OUTPUT))return DIR;if(samePath(file,SIGN_REPORT))return SOURCE;throw Error('XJY_EXACT_OUTPUT_SCOPE');}
function sortRows(rows){return rows.map(r=>({path:r.path,size:r.size,sha256:r.sha256})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);}
function bindingsReady(){const pins=[NODE_SHA,PUBLISHER,AUTHORITY_SHA,PREPARE_SHA,AUDITOR_SHA,REVIEW_INPUT_SHA,INTERNAL_SHA,ROOT_SCOPE_REPORT_SHA,OUTER_SCOPE_SHA,PROPOSAL_SHA,INDEX_SHA,WORKER_SHA,PAYLOAD_SHA,REQUEST_SHA,AUDIT_SHA,ASSEMBLY_SHA,ARCHIVE_SHA,BINDING_SHA,PUB_PEM_SHA,TARGET_SHA,RESOURCE_SHA,POLICY_SHA];assert(pins.every(s=>SHA.test(s)),'UNBOUND_NEW_ROOT_OUTER_SCOPE_BEFORE_IO');assert(OLD_E_AUTHORITY.length===2&&OLD_E_AUTHORITY.every(s=>SHA.test(s))&&!OLD_E_AUTHORITY.includes(AUTHORITY_SHA),'NEW_ROOT_AUTHORITY_REQUIRED');const nums=[AUTHORITY_BYTES,PREPARE_BYTES,AUDITOR_BYTES,REVIEW_INPUT_BYTES,INTERNAL_BYTES,OUTER_SCOPE_BYTES,PROPOSAL_BYTES,INDEX_BYTES,WORKER_BYTES,PAYLOAD_BYTES,REQUEST_BYTES,AUDIT_BYTES,ASSEMBLY_BYTES,ARCHIVE_BYTES];assert(nums.every(n=>Number.isSafeInteger(n)&&n>0),'UNBOUND_NEW_ROOT_OUTER_SCOPE_BEFORE_IO');assert(Number.isFinite(Date.parse(PUBLISHED_AT))&&Number.isFinite(Date.parse(EXPIRES_AT)));assert.equal(WORKER_DELTA.length,4);assert.equal(new Set(WORKER_DELTA.map(x=>x.path)).size,4);assert(WORKER_DELTA.every(x=>typeof x.path==='string'&&Number.isSafeInteger(x.size)&&x.size>0&&SHA.test(x.sha256)));assert.equal(Object.keys(ENVELOPE_PINS).length,7);assert.equal(Object.keys(TYPED_PINS).length,2);}
async function main(){
 bindingsReady();
 assert.equal(path.resolve(__dirname).toLowerCase(),path.resolve(SOURCE).toLowerCase(),'signer must live in R/source');
 assert.equal(process.platform,'win32');
 assert.equal(process.execPath.replace(/\\/g,'/').toLowerCase(),NODE.toLowerCase(),'fixed plain Host Node');
 assert(!process.env.NODE_OPTIONS&&!process.env.NODE_PATH&&!process.env.ELECTRON_RUN_AS_NODE,'fixed plain Host Node env');
 source(NODE,NODE_SHA,134217728);
 const [mode,selfPin,authorization,...extra]=process.argv.slice(2);assert.equal(extra.length,0);assert(['check','sign-approved'].includes(mode));assert(SHA.test(selfPin||''));source(__filename,selfPin);
 if(mode==='sign-approved')assert.equal(authorization,AUTH_TOKEN);else assert.equal(authorization,undefined);
 const auditor=dataModule(AUDITOR,AUDITOR_SHA),held=[];
 function assertPath(file,root,directory){assert(within(file,root),'input outside declared root');for(let p=path.resolve(file);;p=path.dirname(p)){const s=fs0.lstatSync(p,{bigint:true});assert(!s.isSymbolicLink()&&fs0.realpathSync.native(p).toLowerCase()===p.toLowerCase(),'ordinary path');if(p===path.resolve(file))assert(directory?s.isDirectory():s.isFile()&&s.nlink===1n,'ordinary file');if(p===path.dirname(p))break;}}
 function snapState(s){return[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs,s.nlink].join(':');}
 async function hold(file,pin,max){const root=inputRoot(file);assertPath(file,root,false);const fh=await fs.open(file,'r');try{const st=await fh.stat({bigint:true});assert(st.isFile()&&st.nlink===1n&&st.size<=BigInt(max),'bounded input');const h=crypto.createHash('sha256'),buf=Buffer.alloc(1048576);let at=0;for(;;){const r=await fh.read(buf,0,buf.length,at);if(!r.bytesRead)break;h.update(buf.subarray(0,r.bytesRead));at+=r.bytesRead;}assert.equal(BigInt(at),st.size,'input length');assert.equal(h.digest('hex'),pin,'fixed input changed');held.push({fh,file:path.resolve(file),root,pin,snap:snapState(st)});}catch(e){await fh.close();throw e;}}
 async function recheckHeld(){for(const x of held){assertPath(x.file,x.root,false);const st=await x.fh.stat({bigint:true});assert.equal(snapState(st),x.snap,'held input changed');}}
 async function absent(file){const root=outputRoot(file);assertPath(path.dirname(file),root,true);try{await fs.lstat(file);throw Error('CreateNew output already exists');}catch(e){if(e.code!=='ENOENT')throw e;}}
 async function read(file,pin,size,max){const root=inputRoot(file);assertPath(file,root,false);const b=await fs.readFile(file);assert(b.length<=max,'bounded read');assert.equal(sha(b),pin);if(size!==null)assert.equal(b.length,size);assertPath(file,root,false);return b;}
 async function inputs(){
  await recheckHeld();
  const payloadBytes=await read(PAYLOAD,PAYLOAD_SHA,PAYLOAD_BYTES,2097152),m=JSON.parse(payloadBytes.toString('utf8')),rawRequest=JSON.parse((await read(REQUEST,REQUEST_SHA,REQUEST_BYTES,65536)).toString('utf8')),assembly=JSON.parse((await read(ASSEMBLY,ASSEMBLY_SHA,ASSEMBLY_BYTES,2097152)).toString('utf8')),audit=JSON.parse((await read(REPORT_AUDIT,AUDIT_SHA,AUDIT_BYTES,65536)).toString('utf8')),report=JSON.parse((await read(INTERNAL_REPORT,INTERNAL_SHA,INTERNAL_BYTES,65536)).toString('utf8')),scope=JSON.parse((await read(OUTER_SCOPE,OUTER_SCOPE_SHA,OUTER_SCOPE_BYTES,65536)).toString('utf8')),manifest=JSON.parse((await read(PROPOSAL_MANIFEST,PROPOSAL_SHA,PROPOSAL_BYTES,4194304)).toString('utf8')),index=JSON.parse((await read(INDEX,INDEX_SHA,INDEX_BYTES,1048576)).toString('utf8')),worker=JSON.parse((await read(WORKER_PAYLOAD,WORKER_SHA,WORKER_BYTES,65536)).toString('utf8')),reviewed=JSON.parse((await read(REVIEW_INPUT,REVIEW_INPUT_SHA,REVIEW_INPUT_BYTES,65536)).toString('utf8')),authority=await read(AUTHORITY,AUTHORITY_SHA,AUTHORITY_BYTES,65536),pem=await read(PUB_PEM,PUB_PEM_SHA,null,4096);
  assert(authority.length===AUTHORITY_BYTES&&!/\u0000/.test(authority.toString('utf8')),'authority record bytes');
  const publisher=crypto.createPublicKey(pem);assert.equal(publisher.asymmetricKeyType,'ed25519');assert.equal(sha(publisher.export({type:'spki',format:'der'})),PUBLISHER,'publisher key changed');
  assert.equal(scope.schemaVersion,1);assert.equal(scope.purpose,PURPOSE);assert.equal(scope.approved,true);assert.equal(scope.templateOnlyNotRootApproval,false);assert.equal(scope.rootReleaseAuthorized,true);assert.equal(scope.authorityRecordSha256,AUTHORITY_SHA);assert.equal(scope.internalSignatureReportSha256,INTERNAL_SHA);
  for(const[k,v]of Object.entries({rawPayloadSha256:PAYLOAD_SHA,rawPayloadBytes:PAYLOAD_BYTES,requestSha256:REQUEST_SHA,requestBytes:REQUEST_BYTES,archiveSha256:ARCHIVE_SHA,archiveBytes:ARCHIVE_BYTES,assemblySha256:ASSEMBLY_SHA,assemblyBytes:ASSEMBLY_BYTES,bindingSha256:BINDING_SHA,proposalManifestSha256:PROPOSAL_SHA,requestIndexSha256:INDEX_SHA,preparationToolSha256:PREPARE_SHA,reviewedInputsSha256:REVIEW_INPUT_SHA,combinationAuditReportSha256:AUDIT_SHA,combinationAuditReportBytes:AUDIT_BYTES,internalSignatureReportBytes:INTERNAL_BYTES,sequence:SEQ_MANIFEST,targetCatalogSha256:TARGET_SHA,resourceCatalogSha256:RESOURCE_SHA,workerCatalogSha256:WORKER_SHA,workerSequence:WORKER_SEQ,workerFiles:WORKER_FILES,workerUnchangedRows:WORKER_UNCHANGED,sourcePolicySha256:POLICY_SHA,nodeSha256:NODE_SHA,expectedPaths:ZIP_ROWS,actualAsarMembers:ASAR_MEMBERS}))assert.equal(scope[k],v,k);
  assert.deepEqual(sortRows(scope.workerChangedRows),WORKER_DELTA);
  for(const flag of['notHistoricalDigestClick','authorizedRootRelease20261022Only','exactNewOuterPayloadOnly','noFeedPublication','noArchiveModification','noPrivateKeyCopy','noOtherPayloadSigning','noFormalInstallBySigner','rootAuthorityRecordBound','workerDeltaExactlyFourRows','reviewerPresetAccepted','historyPathComponentAccepted','approvalIoMirrorSourceReviewed'])assert.equal(scope[flag],true,flag);
  assert.equal(m.purpose,'xjy-native-employee-update-v1');assert.equal(m.role,'employee');assert.equal(m.sequence,SEQ_MANIFEST);assert.equal(m.targetVersion,TARGET_VERSION);assert.equal(m.engineVersion,ENGINE_VERSION);assert.equal(m.publishedAt,PUBLISHED_AT);assert.equal(m.expiresAt,EXPIRES_AT);assert(Date.parse(m.publishedAt)<=Date.now()+300000&&Date.parse(m.expiresAt)>Date.now(),'manifest validity window');assert.equal(m.files.length,ZIP_ROWS);assert.deepEqual(m.archive,{size:ARCHIVE_BYTES,sha256:ARCHIVE_SHA});assert.equal(m.bindingSha256,BINDING_SHA);assert.equal(m.fullTargetCatalogSha256,TARGET_SHA);
  assert.equal(rawRequest.schemaVersion,1);assert.equal(rawRequest.field,'manifest');assert.equal(rawRequest.payloadFile,'native-manifest-payload.json');assert.equal(rawRequest.payloadSha256,PAYLOAD_SHA);assert.equal(rawRequest.payloadSize,PAYLOAD_BYTES);assert.equal(rawRequest.sequence,SEQ_MANIFEST);assert.equal(rawRequest.signed,false);assert.equal(rawRequest.preparationToolSha256,AUDITOR_SHA);assert.equal(rawRequest.assemblySha256,ASSEMBLY_SHA);assert.equal(rawRequest.bindingSha256,BINDING_SHA);assert.equal(rawRequest.expectedEnvelopeFile,'native-manifest.json');assert.equal(rawRequest.independentNewAuthorizationRequired,true);assert.equal(rawRequest.detachedFromZip,true);assert.equal(rawRequest.archiveMustRemainUnchanged,true);assert.equal(rawRequest.archiveRebuildRequired,false);assert.deepEqual(rawRequest.archive,m.archive);
  assert.equal(assembly.proposalManifestSha256,PROPOSAL_SHA);assert.equal(assembly.bindingSha256,BINDING_SHA);assert.equal(assembly.signedPayloadsVerified,7);assert.equal(assembly.typedHistoricalSignaturesVerified,2);assert.equal(assembly.totalSignatureObjectsVerified,9);assert.equal(assembly.oldSignatureObjectsReused,8);assert.equal(assembly.newInternalSignatures,1);assert.equal(assembly.files.length,ZIP_ROWS);assert.deepEqual(assembly.files,m.files);assertArchiveContract(assembly.archive,m.archive);
  assert.equal(index.schemaVersion,1);assert.equal(index.signed,false);assert.equal(index.preparationToolSha256,PREPARE_SHA);assert.equal(index.reviewedInputsManifestSha256,REVIEW_INPUT_SHA);assert.equal(index.totalSignatureObjectsRequired,9);assert.equal(index.newInternalSignatureCount,1);assert.equal(index.reusedSignatureObjectCount,8);assert.equal(index.workerCatalogSha256,WORKER_SHA);assert.equal(index.targetCatalogSha256,TARGET_SHA);assert.equal(index.resourceCatalogSha256,RESOURCE_SHA);assert.equal(index.workerFiles,WORKER_FILES);assert.equal(index.sequenceProposal.target,SEQ_TARGET);assert.equal(index.sequenceProposal.resource,SEQ_RESOURCE);assert.equal(index.sequenceProposal.worker,WORKER_SEQ);
  assert.equal(index.requests.length,7);const byName=new Map(index.requests.map(r=>[r.expectedEnvelopeFile,r]));assert.equal(byName.size,7);assert.deepEqual(Object.keys(ENVELOPE_PINS).sort(),[...byName.keys()].sort());assert.deepEqual(report.files.map(f=>f.name).sort(),[...byName.keys()].sort());
  for(const r of index.requests){assert.equal(typeof r.path,'string');await read(path.join(PROPOSAL,...r.path.split('/')),r.payloadSha256,r.size,4194304);}
  assert(Array.isArray(manifest.files)&&manifest.files.length>0,'proposal manifest rows');const mrow=name=>manifest.files.find(f=>f.path===name);for(const[name,pin]of[['signing-requests.json',INDEX_SHA],['requests/worker.catalog.json',WORKER_SHA],['worker-draft/publisher-public.pem',PUB_PEM_SHA],['requests/target.catalog.json',TARGET_SHA],['requests/resource.catalog.json',RESOURCE_SHA],['requests/source-policy.json',POLICY_SHA]]){const row=mrow(name);assert(row&&row.sha256===pin,'proposal manifest row '+name);}
  assert.equal(worker.files.length,WORKER_FILES);assert.equal(worker.sequence,WORKER_SEQ);const wrows=new Map(worker.files.map(f=>[f.path,f]));for(const d of WORKER_DELTA){const row=wrows.get(d.path);assert(row&&row.size===d.size&&row.sha256===d.sha256,'worker delta row '+d.path);}
  assert.equal(report.newInternalSignatures,1);assert.equal(report.reusedPublicSignatures,6);assert.equal(report.typedSignaturesVerified,2);assert.equal(report.signatureObjects,9);assert.equal(report.workerPayloadSha256,WORKER_SHA);assert.equal(report.workerPayloadSize,WORKER_BYTES);assert.equal(report.workerSequence,WORKER_SEQ);assert.equal(report.proposalManifestSha256,PROPOSAL_SHA);assert.equal(report.requestIndexSha256,INDEX_SHA);assert.equal(report.builderSha256,PREPARE_SHA);assert.equal(report.reviewedInputsSha256,REVIEW_INPUT_SHA);assert.equal(report.unchangedWorkerRows,WORKER_UNCHANGED);assert.deepEqual(sortRows(report.changedWorkerRows),WORKER_DELTA);assert.equal(report.files.length,7);assert.equal(report.files.filter(f=>f.reused===true).length,6);assert.equal(report.files.filter(f=>f.reused===false).length,1);assert.equal(report.privateKeyIncluded,false);assert.equal(report.outerSignatureNotIncluded,true);
  let newSig=0,reusedSig=0;for(const f of report.files){const req=byName.get(f.name);assert(req);assert(Number.isSafeInteger(f.size)&&f.size>0&&SHA.test(f.sha256)&&SHA.test(f.payloadSha256));assert.equal(ENVELOPE_PINS[f.name],f.sha256,'envelope pin '+f.name);const envBytes=await read(path.join(APPROVALS,f.name),f.sha256,f.size,1048576),env=JSON.parse(envBytes.toString('utf8')),field=req.id==='source-policy'?'policy':'catalog';assert.deepEqual(Object.keys(env).sort(),[field,'signature'].sort());const value=Buffer.from(env[field]);assert.equal(sha(value),f.payloadSha256);assert.equal(sha(value),req.payloadSha256);assert(crypto.verify(null,value,publisher,Buffer.from(env.signature,'base64')),'envelope signature '+f.name);if(f.reused===true)reusedSig++;else{newSig++;assert.equal(req.id,'worker.catalog');assert.equal(f.payloadSha256,WORKER_SHA);}}
  assert.equal(newSig,1);assert.equal(reusedSig,6);
  let typedSig=0;for(const name of Object.keys(TYPED_PINS)){const env=JSON.parse((await read(path.join(PROPOSAL,name),TYPED_PINS[name],null,1048576)).toString('utf8'));assert.deepEqual(Object.keys(env).sort(),['catalog','signature']);assert(crypto.verify(null,Buffer.from(env.catalog),publisher,Buffer.from(env.signature,'base64')),'typed signature '+name);typedSig++;}
  assert.equal(typedSig,2);
  const scan=await auditor.scanZip(ZIP,ARCHIVE_SHA),internal=auditor.validateInternals(scan);
  assert.deepEqual(scan.archive,m.archive);assert.deepEqual(scan.files,m.files);assert.equal(scan.files.length,ZIP_ROWS);
  assert.equal(internal.signatureObjectsVerified,9);assert.equal(internal.typedOriginalSignaturesVerified,2);assert.equal(internal.internalSignaturesVerified,9);assert.equal(internal.workerFiles,WORKER_FILES);assert.equal(internal.workerUnchangedRows,WORKER_UNCHANGED);assert.equal(internal.actualAsarMembers,ASAR_MEMBERS);assert.equal(internal.bindingSha256,BINDING_SHA);assert.equal(internal.workerCatalogSha256,WORKER_SHA);assert.equal(internal.fullTargetCatalogSha256,TARGET_SHA);assert.equal(internal.resourceCatalogSha256,RESOURCE_SHA);assert.equal(internal.sourcePolicySha256,POLICY_SHA);assert.deepEqual(sortRows(internal.workerChangedRows),WORKER_DELTA);
  assert.deepEqual(rawRequest.internalVerification,audit.internal);assert.deepEqual(audit.internal,internal);assert.equal(audit.sourceOnlyToolSha256,AUDITOR_SHA);assert.deepEqual(audit.archive,m.archive);assert.equal(audit.files,ZIP_ROWS);assert.equal(audit.zipRawCrcAndShaVerified,true);assert.deepEqual(audit.entryParsing,{cmdBootstraps:4,powerShellAstParsed:7,powerShellAstErrors:0,productExecuted:false,parserOnly:true});
  const mapped={newSignatures:report.newInternalSignatures,reusedPublicSignatures:report.reusedPublicSignatures,typedPublicSignaturesVerified:report.typedSignaturesVerified,totalInternalSignatureObjectsVerified:report.signatureObjects,signaturesVerified:true,privateKeyIncluded:false,outerSignatureNotIncluded:true,proposalSha256:report.proposalManifestSha256,rootScopeReportSha256:report.rootScopeReportSha256===undefined?INTERNAL_SHA:report.rootScopeReportSha256};
  assert.equal(mapped.rootScopeReportSha256,ROOT_SCOPE_REPORT_SHA,'mapped root scope report sha');assert.equal(mapped.newSignatures,1);assert.equal(mapped.reusedPublicSignatures,6);assert.equal(mapped.typedPublicSignaturesVerified,2);assert.equal(mapped.totalInternalSignatureObjectsVerified,9);
  await recheckHeld();return{payloadBytes,publisher,mapped};
 }
 const checked=await inputs();
 if(mode==='check'){console.log(JSON.stringify({verified:true,payloadSha256:PAYLOAD_SHA,archiveSha256:ARCHIVE_SHA,privateKeyRead:false,KeyReads:keyReads,signed:false,authorityRecordSha256:AUTHORITY_SHA,rootScopeReportSha256:ROOT_SCOPE_REPORT_SHA,newSignatures:checked.mapped.newSignatures,reusedPublicSignatures:checked.mapped.reusedPublicSignatures,internalSignaturesIndependentlyVerified:9,typedOriginalSignaturesVerified:2,actualAsarMembers:ASAR_MEMBERS,zipRows:ZIP_ROWS,workerUnchangedRows:WORKER_UNCHANGED,feedPublicationForbidden:true,formalInstallForbidden:true}));return;}
 await absent(OUTPUT);await absent(SIGN_REPORT);await recheckHeld();keyReads++;
 const keyFh=await fs.open(KEY,'r');let keyBytes,privateKey,envelope;
 try{const st=await keyFh.stat();assert(st.isFile()&&st.nlink===1&&st.size>0&&st.size<=4096,'issuer key metadata');keyBytes=await keyFh.readFile();try{privateKey=crypto.createPrivateKey(keyBytes);}finally{keyBytes.fill(0);keyBytes=null;}assert.equal(privateKey.asymmetricKeyType,'ed25519');assert.equal(sha(crypto.createPublicKey(privateKey).export({type:'spki',format:'der'})),PUBLISHER,'issuer key does not match publisher');const signature=crypto.sign(null,checked.payloadBytes,privateKey).toString('base64');assert(crypto.verify(null,checked.payloadBytes,checked.publisher,Buffer.from(signature,'base64')),'new signature self-verify failed');envelope=Buffer.from(JSON.stringify({manifest:checked.payloadBytes.toString('utf8'),signature}));privateKey=null;await recheckHeld();await inputs();}finally{if(keyBytes)keyBytes.fill(0);privateKey=null;await keyFh.close();}
 await absent(OUTPUT);await absent(SIGN_REPORT);await recheckHeld();
 const out=await fs.open(OUTPUT,'wx');try{await out.writeFile(envelope);await out.sync();}finally{await out.close();}
 const raw=await fs.readFile(OUTPUT);assert(raw.equals(envelope),'outer envelope readback');const final=JSON.parse(raw.toString('utf8'));assert.equal(sha(Buffer.from(final.manifest)),PAYLOAD_SHA,'manifest payload inside envelope');assert(crypto.verify(null,Buffer.from(final.manifest),checked.publisher,Buffer.from(final.signature,'base64')),'outer signature readback');await recheckHeld();
 const report={signed:true,newSignatures:1,reusedPublicSignatures:6,payloadSha256:PAYLOAD_SHA,archiveSha256:ARCHIVE_SHA,envelopeSha256:sha(envelope),sourceSha256:selfPin,privateKeyIncluded:false,zipModified:false,published:false,installed:false,KeyReads:keyReads,nodeSha256:NODE_SHA,authorityRecordSha256:AUTHORITY_SHA,rootScopeReportSha256:ROOT_SCOPE_REPORT_SHA,requestSha256:REQUEST_SHA,assemblySha256:ASSEMBLY_SHA,bindingSha256:BINDING_SHA,combinationAuditReportSha256:AUDIT_SHA,internalSignatureReportSha256:INTERNAL_SHA,internalSignaturesIndependentlyVerified:9,typedOriginalSignaturesVerified:2,actualAsarMembers:ASAR_MEMBERS,workerUnchangedRows:WORKER_UNCHANGED,workerChangedRows:WORKER_DELTA,feedPublicationForbidden:true,formalInstallForbidden:true,scope:'Only the exact new xjy-release-20261022 outer payload; no feed/formal install/ZIP rebuild/other payload'};
 await absent(SIGN_REPORT);const rf=await fs.open(SIGN_REPORT,'wx',0o600);try{await rf.writeFile(JSON.stringify(report,null,2)+'\n');await rf.sync();}finally{await rf.close();}
 console.log(JSON.stringify(report));
}
if(require.main===module)main().catch(error=>{console.error('xjy-release-20261022 outer signing stopped: '+error.message);process.exitCode=1;});
module.exports={bindingsReady,inputRoot,outputRoot,source,dataModule,assertArchiveContract,R,SOURCE,PROPOSAL,BUILD,DIR,OUTPUT,SIGN_REPORT,AUTHORITY,ROOT_SCOPE_REPORT_SHA};
`;

function buildSigner(V) {
  const tokens = {
    __ENV_DIR__: q(V.envDir),
    __NODE__: q(V.node),
    __NODE_SHA__: q(V.nodeSha),
    __PUBLISHER__: q(V.publisher),
    __OLD_E_AUTH__: JSON.stringify(V.oldEAuth),
    __KEY__: q(V.key),
    __AUTHORITY_SHA__: q(V.authoritySha),
    __AUTHORITY_BYTES__: String(V.authorityBytes),
    __PREPARE_SHA__: q(V.prepareSha),
    __PREPARE_BYTES__: String(V.prepareBytes),
    __AUDITOR_SHA__: q(V.auditorSha),
    __AUDITOR_BYTES__: String(V.auditorBytes),
    __REVIEW_SHA__: q(V.reviewSha),
    __REVIEW_BYTES__: String(V.reviewBytes),
    __INTERNAL_SHA__: q(V.internalSha),
    __INTERNAL_BYTES__: String(V.internalBytes),
    __ROOT_SCOPE_SHA__: q(V.rootScopeSha),
    __SCOPE_NAME__: q(V.scopeName),
    __OUTER_SCOPE_SHA__: q(V.outerScopeSha),
    __OUTER_SCOPE_BYTES__: String(V.outerScopeBytes),
    __PROPOSAL_SHA__: q(V.proposalSha),
    __PROPOSAL_BYTES__: String(V.proposalBytes),
    __INDEX_SHA__: q(V.indexSha),
    __INDEX_BYTES__: String(V.indexBytes),
    __WORKER_SHA__: q(V.workerSha),
    __WORKER_BYTES__: String(V.workerBytes),
    __WORKER_SEQ__: String(V.workerSeq),
    __PAYLOAD_SHA__: q(V.payloadSha),
    __PAYLOAD_BYTES__: String(V.payloadBytes),
    __REQUEST_SHA__: q(V.requestSha),
    __REQUEST_BYTES__: String(V.requestBytes),
    __AUDIT_SHA__: q(V.auditSha),
    __AUDIT_BYTES__: String(V.auditBytes),
    __ASSEMBLY_SHA__: q(V.assemblySha),
    __ASSEMBLY_BYTES__: String(V.assemblyBytes),
    __ARCHIVE_SHA__: q(V.archiveSha),
    __ARCHIVE_BYTES__: String(V.archiveBytes),
    __BINDING_SHA__: q(V.bindingSha),
    __PUB_PEM_SHA__: q(V.pubPemSha),
    __ENVELOPE_PINS__: JSON.stringify(V.envelopePins),
    __TYPED_PINS__: JSON.stringify(V.typedPins),
    __WORKER_DELTA__: JSON.stringify(V.workerDelta),
    __TARGET_SHA__: q(V.targetSha),
    __RESOURCE_SHA__: q(V.resourceSha),
    __POLICY_SHA__: q(V.policySha),
    __SEQ_MANIFEST__: String(V.seqManifest),
    __SEQ_TARGET__: String(V.seqTarget),
    __SEQ_RESOURCE__: String(V.seqResource),
    __TARGET_VERSION__: q(V.targetVersion),
    __ENGINE_VERSION__: q(V.engineVersion),
    __PUBLISHED_AT__: q(V.publishedAt),
    __EXPIRES_AT__: q(V.expiresAt),
    __PURPOSE__: q(V.purpose),
    __AUTH_TOKEN__: q(V.authToken)
  };
  let text = SIGNER_TEMPLATE;
  for (const [token, value] of Object.entries(tokens)) {
    if (!text.includes(token)) fail('SIGNER_TOKEN_MISSING', token);
    text = text.split(token).join(value);
  }
  if (/__[A-Z0-9_]+__/.test(text)) fail('SIGNER_TOKEN_UNREPLACED', String(text.match(/__[A-Z0-9_]+__/)));
  new vm.Script(text, { filename: V.signerName });
  return text;
}

function writeNew(file, bytes) {
  const fd = fs.openSync(file, 'wx', 0o644);
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  const back = fs.readFileSync(file);
  if (!back.equals(bytes)) fail('OUTPUT_READBACK_MISMATCH', file);
}

async function main() {
  const args = process.argv.slice(2);
  assert(args.every(a => a === '--check'), 'USAGE: ROOT_DERIVE_NEW_OUTER.cjs [--check]');
  const check = args.includes('--check');
  assert.equal(process.platform, 'win32');
  if (!fs.existsSync(R)) fail('RELEASE_ROOT_MISSING', R);

  const authorityPath = path.join(SOURCE, 'authority-release.md');
  let authorityBytes;
  try {
    authorityBytes = readStable(authorityPath, 65536);
  } catch (error) {
    fail('AUTHORITY_RECORD_MISSING', 'R/source/authority-release.md must be provided by Root; refusing to mint approval (' + error.message + ')');
  }
  const authoritySha = sha(authorityBytes);
  const authorityText = authorityBytes.toString('utf8');
  if (authorityBytes.length < 64 || /\u0000/.test(authorityText) || !/(授权|authori[sz]ed)/i.test(authorityText) || !/(root|根)/i.test(authorityText)) {
    fail('AUTHORITY_RECORD_UNUSABLE', authorityPath);
  }
  if (OLD_E_AUTHORITY.includes(authoritySha)) fail('AUTHORITY_RECORD_REUSES_OLD_E', authoritySha);
  const authorityRel = path.relative(R, authorityPath).replace(/\\/g, '/');

  const preparePath = path.join(SOURCE, 'prepare-release.cjs');
  const auditPath = path.join(SOURCE, 'audit-release.cjs');
  const prepareBytes = readStable(preparePath, 2097152);
  const auditBytes = readStable(auditPath, 4194304);
  if (prepareBytes.length < 256) fail('PREPARE_TOOL_TOO_SMALL', preparePath);
  const auditText = auditBytes.toString('utf8');
  for (const token of ['function scanZip', 'function validateInternals', 'module.exports']) {
    if (!auditText.includes(token)) fail('AUDIT_TOOL_CONTRACT', token);
  }

  const reviewPath = path.join(SOURCE, 'reviewed-inputs-ROOT.json');
  const reportPath = path.join(SOURCE, 'worker-signing-report.json');
  const reviewBytes = readStable(reviewPath, 65536);
  const reportBytes = readStable(reportPath, 65536);
  const proposalPath = path.join(PROPOSAL, 'proposal-manifest.json');
  const indexPath = path.join(PROPOSAL, 'signing-requests.json');
  const workerPath = path.join(PROPOSAL, 'requests', 'worker.catalog.json');
  const pubPemPath = path.join(PROPOSAL, 'worker-draft', 'publisher-public.pem');
  const payloadPath = path.join(DIR, 'native-manifest-payload.json');
  const requestPath = path.join(DIR, 'signing-request.json');
  const auditReportPath = path.join(DIR, 'package-audit-report.json');
  const assemblyPath = path.join(BUILD, 'assembly.json');
  const zipPath = path.join(BUILD, 'native-package.zip');
  const proposalBytes = readStable(proposalPath, 4194304);
  const indexBytes = readStable(indexPath, 1048576);
  const workerBytes = readStable(workerPath, 65536);
  const pubPemBytes = readStable(pubPemPath, 4096);
  const payloadBytes = readStable(payloadPath, 2097152);
  const requestBytes = readStable(requestPath, 65536);
  const auditReportBytes = readStable(auditReportPath, 65536);
  const assemblyBytes = readStable(assemblyPath, 2097152);
  const archive = hashFile(zipPath, MAX_ZIP);

  const review = JSON.parse(reviewBytes.toString('utf8'));
  const report = JSON.parse(reportBytes.toString('utf8'));
  const proposal = JSON.parse(proposalBytes.toString('utf8'));
  const index = JSON.parse(indexBytes.toString('utf8'));
  const worker = JSON.parse(workerBytes.toString('utf8'));
  const payload = JSON.parse(payloadBytes.toString('utf8'));
  const request = JSON.parse(requestBytes.toString('utf8'));
  const auditReport = JSON.parse(auditReportBytes.toString('utf8'));
  const assembly = JSON.parse(assemblyBytes.toString('utf8'));
  const publisher = crypto.createPublicKey(pubPemBytes);
  assert.equal(publisher.asymmetricKeyType, 'ed25519');
  assert.equal(sha(publisher.export({ type: 'spki', format: 'der' })), PUBLISHER, 'publisher key changed');

  const proposalSha = sha(proposalBytes);
  const indexSha = sha(indexBytes);
  const workerSha = sha(workerBytes);
  const payloadSha = sha(payloadBytes);
  const requestSha = sha(requestBytes);
  const auditReportSha = sha(auditReportBytes);
  const assemblySha = sha(assemblyBytes);
  const reviewSha = sha(reviewBytes);
  const reportSha = sha(reportBytes);
  const prepareSha = sha(prepareBytes);
  const auditorSha = sha(auditBytes);
  const pubPemSha = sha(pubPemBytes);

  assert(Array.isArray(worker.files) && worker.files.length === WORKER_FILES, 'worker rows 101');
  const workerRows = new Map(worker.files.map(f => [f.path, f]));
  const WORKER_DELTA = DELTA_PATHS.map(p => {
    const row = workerRows.get(p);
    if (!row) fail('WORKER_DELTA_ROW_MISSING', p);
    return { path: p, size: row.size, sha256: row.sha256 };
  });
  assert.equal(WORKER_DELTA.length, 4);
  for (const [p, s] of Object.entries(FIXED_SHA)) {
    const row = WORKER_DELTA.find(x => x.path === p);
    if (!row || row.sha256 !== s) fail('WORKER_FIXED_DELTA_SHA_MISMATCH', p);
  }
  for (const [p, s] of Object.entries(C28_ROWS)) {
    const row = WORKER_DELTA.find(x => x.path === p);
    if (!row || row.sha256 === s) fail('WORKER_DELTA_NOT_CHANGED_FROM_C28', p);
  }
  assert.deepEqual(sortRows(report.changedWorkerRows), WORKER_DELTA, 'worker report delta rows');
  assert.equal(report.unchangedWorkerRows, WORKER_UNCHANGED);
  if (report.workerFiles !== undefined) assert.equal(report.workerFiles, WORKER_FILES);
  if (report.oldWorkerPayloadSha256 !== undefined) assert.equal(report.oldWorkerPayloadSha256, C28_WORKER_SHA, 'worker report baseline is not c28');
  if (report.oldWorker27PayloadSha256 !== undefined) assert.equal(report.oldWorker27PayloadSha256, C28_WORKER_SHA, 'worker report baseline is not c28');
  assert.deepEqual(sortRows(auditReport.internal.workerChangedRows), WORKER_DELTA, 'audit report delta rows');

  assert.equal(review.reviewed, true, 'reviewed inputs not approved');
  assert(Array.isArray(review.files) && review.files.length > 0, 'reviewed inputs files');
  const reviewedRows = new Map(review.files.map(f => [String(f.path || '').replace(/^worker-draft\//, ''), f]));
  for (const d of WORKER_DELTA) {
    const row = reviewedRows.get(d.path);
    if (!row || row.size !== d.size || row.sha256 !== d.sha256) fail('REVIEWED_INPUT_DELTA_MISMATCH', d.path);
  }

  assert.equal(proposal.schemaVersion, 1);
  assert(Array.isArray(proposal.files) && proposal.files.length > 0, 'proposal manifest rows');
  const proposalRow = name => proposal.files.find(f => f.path === name);
  for (const [name, pin] of [
    ['signing-requests.json', indexSha],
    ['requests/worker.catalog.json', workerSha],
    ['worker-draft/publisher-public.pem', pubPemSha]
  ]) {
    const row = proposalRow(name);
    if (!row || row.sha256 !== pin) fail('PROPOSAL_MANIFEST_ROW_MISMATCH', name);
  }

  assert.equal(index.schemaVersion, 1);
  assert.equal(index.signed, false);
  assert.equal(index.preparationToolSha256, prepareSha, 'request index prepare tool');
  assert.equal(index.reviewedInputsManifestSha256, reviewSha, 'request index reviewed inputs');
  assert.equal(index.totalSignatureObjectsRequired, 9);
  assert.equal(index.newInternalSignatureCount, 1);
  assert.equal(index.reusedSignatureObjectCount, 8);
  assert.equal(index.workerFiles, WORKER_FILES);
  assert.equal(index.workerCatalogSha256, workerSha);
  assert.equal(index.sequenceProposal.worker, worker.sequence, 'worker sequence');
  assert.equal(index.requests.length, 7);
  for (const r of index.requests) {
    if (typeof r.path !== 'string') fail('REQUEST_PATH', r.id);
    const bytes = readStable(path.join(PROPOSAL, ...r.path.split('/')), 4194304);
    if (sha(bytes) !== r.payloadSha256 || bytes.length !== r.size) fail('REQUEST_PAYLOAD_MISMATCH', r.id);
  }
  const targetRequest = index.requests.find(r => r.id === 'target.catalog');
  const resourceRequest = index.requests.find(r => r.id === 'resource.catalog');
  const policyRequest = index.requests.find(r => r.id === 'source-policy');
  if (!targetRequest || !resourceRequest || !policyRequest) fail('REQUEST_SET_INCOMPLETE', 'target/resource/policy');
  const TARGET_SHA = targetRequest.payloadSha256;
  const RESOURCE_SHA = resourceRequest.payloadSha256;
  const POLICY_SHA = policyRequest.payloadSha256;
  assert.equal(index.targetCatalogSha256, TARGET_SHA);
  assert.equal(index.resourceCatalogSha256, RESOURCE_SHA);
  assert.equal(payload.fullTargetCatalogSha256, TARGET_SHA);
  const SEQ_TARGET = targetRequest.sequence;
  const SEQ_RESOURCE = resourceRequest.sequence;
  assert.equal(targetRequest.sequence, payload.sequence);
  assert.equal(proposalRow('requests/target.catalog.json').sha256, TARGET_SHA);
  assert.equal(proposalRow('requests/resource.catalog.json').sha256, RESOURCE_SHA);
  assert.equal(proposalRow('requests/source-policy.json').sha256, POLICY_SHA);

  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.purpose, 'xjy-native-employee-update-v1');
  assert.equal(payload.role, 'employee');
  assert.equal(payload.files.length, ZIP_ROWS);
  assert.deepEqual(payload.archive, { size: archive.size, sha256: archive.sha256 }, 'archive payload pin');
  assert.equal(payload.bindingSha256, request.bindingSha256, 'binding payload/request');
  assert.equal(assembly.bindingSha256, request.bindingSha256, 'binding assembly/request');
  const BINDING_SHA = payload.bindingSha256;
  assert.equal(payload.fullTargetCatalogSha256, TARGET_SHA);
  assert.equal(payload.sequence, request.sequence);
  const SEQ_MANIFEST = payload.sequence;
  const PUBLISHED_AT = payload.publishedAt;
  const EXPIRES_AT = payload.expiresAt;
  const TARGET_VERSION = payload.targetVersion;
  const ENGINE_VERSION = payload.engineVersion;
  assert(Number.isFinite(Date.parse(PUBLISHED_AT)) && Number.isFinite(Date.parse(EXPIRES_AT)));

  assert.equal(request.schemaVersion, 1);
  assert.equal(request.field, 'manifest');
  assert.equal(request.payloadFile, 'native-manifest-payload.json');
  assert.equal(request.payloadSha256, payloadSha);
  assert.equal(request.payloadSize, payloadBytes.length);
  assert.equal(request.sequence, SEQ_MANIFEST);
  assert.equal(request.signed, false);
  assert.equal(request.preparationToolSha256, auditorSha);
  assert.equal(request.assemblySha256, assemblySha);
  assert.equal(request.bindingSha256, BINDING_SHA);
  assert.equal(request.expectedEnvelopeFile, 'native-manifest.json');
  assert.equal(request.independentNewAuthorizationRequired, true);
  assert.equal(request.detachedFromZip, true);
  assert.equal(request.archiveMustRemainUnchanged, true);
  assert.equal(request.archiveRebuildRequired, false);
  assert.deepEqual(request.archive, payload.archive);

  assert.equal(assembly.proposalManifestSha256, proposalSha);
  assert.equal(assembly.files.length, ZIP_ROWS);
  assert.deepEqual(assembly.files, payload.files);
  assert.equal(assembly.signedPayloadsVerified, 7);
  assert.equal(assembly.typedHistoricalSignaturesVerified, 2);
  assert.equal(assembly.totalSignatureObjectsVerified, 9);
  assert.equal(assembly.oldSignatureObjectsReused, 8);
  assert.equal(assembly.newInternalSignatures, 1);
  assertArchiveContract(assembly.archive, payload.archive, archive.sha256, archive.size);

  assert.equal(auditReport.sourceOnlyToolSha256, auditorSha);
  assert.deepEqual(auditReport.archive, payload.archive);
  assert.equal(auditReport.files, ZIP_ROWS);
  assert.equal(auditReport.zipRawCrcAndShaVerified, true);
  assert.deepEqual(auditReport.entryParsing, { cmdBootstraps: 4, powerShellAstParsed: 7, powerShellAstErrors: 0, productExecuted: false, parserOnly: true });
  const ai = auditReport.internal;
  assert.equal(ai.signatureObjectsVerified, 9);
  assert.equal(ai.typedOriginalSignaturesVerified, 2);
  assert.equal(ai.internalSignaturesVerified, 9);
  assert.equal(ai.workerFiles, WORKER_FILES);
  assert.equal(ai.workerUnchangedRows, WORKER_UNCHANGED);
  assert.equal(ai.actualAsarMembers, ASAR_MEMBERS);
  assert.equal(ai.bindingSha256, BINDING_SHA);
  assert.equal(ai.workerCatalogSha256, workerSha);
  assert.equal(ai.fullTargetCatalogSha256, TARGET_SHA);
  assert.equal(ai.resourceCatalogSha256, RESOURCE_SHA);
  assert.equal(ai.sourcePolicySha256, POLICY_SHA);
  assert.deepEqual(sortRows(ai.workerChangedRows), WORKER_DELTA);
  assert.deepEqual(request.internalVerification, ai);

  assert.equal(report.newInternalSignatures, 1, 'worker report newInternalSignatures');
  if (report.newSignatures !== undefined) assert.equal(report.newSignatures, 1);
  assert.equal(report.reusedPublicSignatures, 6);
  assert.equal(report.typedSignaturesVerified, 2);
  assert.equal(report.signatureObjects, 9);
  assert.equal(report.workerPayloadSha256, workerSha);
  assert.equal(report.workerPayloadSize, workerBytes.length);
  assert.equal(report.workerSequence, worker.sequence);
  assert.equal(report.proposalManifestSha256, proposalSha);
  assert.equal(report.requestIndexSha256, indexSha);
  assert.equal(report.builderSha256, prepareSha);
  assert.equal(report.reviewedInputsSha256, reviewSha);
  assert.equal(report.privateKeyIncluded, false);
  assert.equal(report.outerSignatureNotIncluded, true);
  if (report.installed !== undefined) assert.equal(report.installed, false);
  if (report.published !== undefined) assert.equal(report.published, false);
  if (report.programExecuted !== undefined) assert.equal(report.programExecuted, false);
  assert.equal(report.files.length, 7);
  assert.equal(report.files.filter(f => f.reused === true).length, 6);
  assert.equal(report.files.filter(f => f.reused === false).length, 1);

  const envelopeNames = index.requests.map(r => r.expectedEnvelopeFile);
  assert.equal(new Set(envelopeNames).size, 7);
  const ENV_DIR = findEnvelopes(envelopeNames);
  const byName = new Map(index.requests.map(r => [r.expectedEnvelopeFile, r]));
  assert.deepEqual(report.files.map(f => f.name).sort(), [...byName.keys()].sort());
  const envelopePins = {};
  let newSignatureCount = 0;
  let reusedSignatureCount = 0;
  for (const f of report.files) {
    const req = byName.get(f.name);
    if (!req) fail('ENVELOPE_NAME_UNKNOWN', f.name);
    if (!Number.isSafeInteger(f.size) || f.size <= 0 || !SHA.test(f.sha256) || !SHA.test(f.payloadSha256)) fail('ENVELOPE_ROW_BAD', f.name);
    const envBytes = readStable(path.join(R, ...ENV_DIR.split('/'), f.name), 1048576);
    if (sha(envBytes) !== f.sha256) fail('ENVELOPE_SHA_MISMATCH', f.name);
    const env = JSON.parse(envBytes.toString('utf8'));
    const field = req.id === 'source-policy' ? 'policy' : 'catalog';
    assert.deepEqual(Object.keys(env).sort(), [field, 'signature'].sort());
    const value = Buffer.from(env[field]);
    assert.equal(sha(value), f.payloadSha256, 'envelope payload sha ' + f.name);
    assert.equal(sha(value), req.payloadSha256, 'envelope request sha ' + f.name);
    assert(crypto.verify(null, value, publisher, Buffer.from(env.signature, 'base64')), 'envelope signature ' + f.name);
    if (f.reused === true) reusedSignatureCount++;
    else {
      newSignatureCount++;
      assert.equal(req.id, 'worker.catalog');
      assert.equal(f.payloadSha256, workerSha);
    }
    envelopePins[f.name] = f.sha256;
  }
  assert.equal(newSignatureCount, 1);
  assert.equal(reusedSignatureCount, 6);
  assert.deepEqual(Object.keys(envelopePins).sort(), [...byName.keys()].sort());

  const typedPins = {};
  for (const [file, payloadFile] of [
    ['slot-source.catalog-envelope.json', 'slot-source.catalog.json'],
    ['slot-default-source.catalog-envelope.json', 'slot-default-source.catalog.json']
  ]) {
    const envBytes = readStable(path.join(PROPOSAL, file), 1048576);
    const env = JSON.parse(envBytes.toString('utf8'));
    const typedPayload = readStable(path.join(PROPOSAL, payloadFile), 4194304);
    assert.deepEqual(Object.keys(env).sort(), ['catalog', 'signature']);
    assert.equal(env.catalog, typedPayload.toString('utf8'), 'typed payload text ' + file);
    assert(crypto.verify(null, Buffer.from(env.catalog), publisher, Buffer.from(env.signature, 'base64')), 'typed signature ' + file);
    typedPins[file] = sha(envBytes);
  }
  assert.equal(Object.keys(typedPins).length, 2);

  const rootScopeSha = (() => {
    if (report.rootScopeReportSha256 === undefined) return reportSha;
    if (!SHA.test(report.rootScopeReportSha256)) fail('ROOT_SCOPE_REPORT_SHA_FORMAT', 'worker-signing-report.rootScopeReportSha256');
    if (report.rootScopeReportSha256 === reportSha) return report.rootScopeReportSha256;
    const candidates = [report.rootScopeReportPath, report.rootScopeReportFile, report.workerScopeReportPath].filter(x => typeof x === 'string');
    for (const rel of candidates) {
      const file = path.resolve(R, rel);
      if (!within(file, R) || !fs.existsSync(file)) continue;
      if (sha(readStable(file, 65536)) === report.rootScopeReportSha256) return report.rootScopeReportSha256;
    }
    return fail('ROOT_SCOPE_REPORT_UNVERIFIABLE', 'report.rootScopeReportSha256 must match a shipped scope file or the report itself');
  })();

  const V = {
    node: NODE, nodeSha: NODE_SHA, publisher: PUBLISHER, oldEAuth: OLD_E_AUTHORITY, key: KEY,
    authoritySha, authorityBytes: authorityBytes.length,
    prepareSha, prepareBytes: prepareBytes.length, auditorSha, auditorBytes: auditBytes.length,
    reviewSha, reviewBytes: reviewBytes.length, internalSha: reportSha, internalBytes: reportBytes.length,
    rootScopeSha, scopeName: SCOPE_NAME, outerScopeSha: '', outerScopeBytes: 0,
    proposalSha, proposalBytes: proposalBytes.length, indexSha, indexBytes: indexBytes.length,
    workerSha, workerBytes: workerBytes.length, workerSeq: worker.sequence,
    payloadSha, payloadBytes: payloadBytes.length, requestSha, requestBytes: requestBytes.length,
    auditSha: auditReportSha, auditBytes: auditReportBytes.length,
    assemblySha, assemblyBytes: assemblyBytes.length,
    archiveSha: archive.sha256, archiveBytes: archive.size, bindingSha: BINDING_SHA, pubPemSha,
    envelopePins, typedPins, workerDelta: WORKER_DELTA,
    targetSha: TARGET_SHA, resourceSha: RESOURCE_SHA, policySha: POLICY_SHA,
    seqManifest: SEQ_MANIFEST, seqTarget: SEQ_TARGET, seqResource: SEQ_RESOURCE,
    targetVersion: TARGET_VERSION, engineVersion: ENGINE_VERSION,
    publishedAt: PUBLISHED_AT, expiresAt: EXPIRES_AT,
    purpose: PURPOSE, authToken: AUTH_TOKEN, envDir: ENV_DIR, signerName: SIGNER_NAME
  };

  const scopeBuffer = Buffer.from(JSON.stringify(buildScope(V), null, 2) + '\n', 'utf8');
  V.outerScopeSha = sha(scopeBuffer);
  V.outerScopeBytes = scopeBuffer.length;
  const signerText = buildSigner(V);
  const signerSha = sha(Buffer.from(signerText, 'utf8'));

  const scopePath = path.join(SOURCE, SCOPE_NAME);
  const signerPath = path.join(SOURCE, SIGNER_NAME);
  const deriveReportPath = path.join(SOURCE, DERIVE_REPORT_NAME);
  for (const file of [scopePath, signerPath, deriveReportPath]) {
    if (fs.existsSync(file)) fail('OUTPUT_EXISTS', file + ' (refusing to overwrite; remove the unsigned derivation first)');
  }

  const nodeCommand = '"' + win(NODE) + '" "' + win(signerPath) + '"';
  const checkCommand = nodeCommand + ' check ' + signerSha;
  const signCommand = nodeCommand + ' sign-approved ' + signerSha + ' "' + AUTH_TOKEN + '"';

  const deriveReport = {
    schemaVersion: 1,
    purpose: 'root-derive-new-outer-20261022',
    asOf: new Date().toISOString(),
    releaseRoot: R,
    releaseAuthorized: true,
    authorityRecord: { file: authorityRel, bytes: authorityBytes.length, sha256: authoritySha },
    readsOnlyNewArtifacts: true,
    privateKeyRead: false,
    signed: false,
    productExecuted: false,
    installed: false,
    published: false,
    zipModified: false,
    oldSignedArtifactsModified: false,
    workerDelta: WORKER_DELTA,
    workerUnchangedRows: WORKER_UNCHANGED,
    workerFiles: WORKER_FILES,
    mapping: {
      'report.newInternalSignatures': 'newSignatures',
      'report.reusedPublicSignatures': 'reusedPublicSignatures',
      'report.typedSignaturesVerified': 'typedPublicSignaturesVerified',
      'report.signatureObjects': 'totalInternalSignatureObjectsVerified (9 = 7 envelopes + 2 typed)',
      'report.proposalManifestSha256': 'proposalSha256',
      'report.rootScopeReportSha256 or report sha when absent': 'rootScopeReportSha256',
      'authority-release.md actual sha256': 'scope.authorityRecordSha256'
    },
    checks: [
      'authority-release.md exists, non-empty, root-authorized wording, not an old E authority sha',
      'prepare-release.cjs / audit-release.cjs pinned; audit exports scanZip+validateInternals',
      'reviewed-inputs-ROOT.json reviewed=true and carries all 4 worker delta rows',
      'proposal manifest rows bind index/worker/publisher/target/resource/policy shas',
      'request index 7 requests: 9 objects, 1 new + 8 reused, each payload sha/size verified',
      'worker catalog 101 rows; exactly the 4 delta rows bound (runtime a14, slot a1, install-location fixed5, delivery-native)',
      'c28 baseline rows runtime/slot proven changed; workerUnchangedRows=97',
      '7 envelopes verified with publisher key; 6 reused + 1 new; 2 typed signatures verified',
      'package-audit-report: 3293 rows, CRC/SHA verified, 149 ASAR members, 7 PowerShell AST parses',
      'assembly/request/payload archive+binding cross-checked'
    ],
    inputs: {
      authority: { file: authorityRel, bytes: authorityBytes.length, sha256: authoritySha },
      prepare: { bytes: prepareBytes.length, sha256: prepareSha },
      audit: { bytes: auditBytes.length, sha256: auditorSha },
      reviewedInputs: { bytes: reviewBytes.length, sha256: reviewSha },
      workerReport: { bytes: reportBytes.length, sha256: reportSha },
      proposalManifest: { bytes: proposalBytes.length, sha256: proposalSha },
      requestIndex: { bytes: indexBytes.length, sha256: indexSha },
      workerCatalog: { bytes: workerBytes.length, sha256: workerSha, sequence: worker.sequence },
      manifestPayload: { bytes: payloadBytes.length, sha256: payloadSha, sequence: SEQ_MANIFEST },
      signingRequest: { bytes: requestBytes.length, sha256: requestSha },
      auditReport: { bytes: auditReportBytes.length, sha256: auditReportSha },
      assembly: { bytes: assemblyBytes.length, sha256: assemblySha },
      archive: { bytes: archive.size, sha256: archive.sha256 },
      publisherPublicKeySha256: PUBLISHER,
      envelopeDir: ENV_DIR,
      envelopePins,
      typedPins,
      targetCatalogSha256: TARGET_SHA,
      resourceCatalogSha256: RESOURCE_SHA,
      sourcePolicySha256: POLICY_SHA,
      bindingSha256: BINDING_SHA,
      publishedAt: PUBLISHED_AT,
      expiresAt: EXPIRES_AT
    },
    outputs: {
      scope: { file: SCOPE_NAME, bytes: scopeBuffer.length, sha256: V.outerScopeSha },
      signer: { file: SIGNER_NAME, bytes: Buffer.byteLength(signerText), sha256: signerSha },
      report: { file: DERIVE_REPORT_NAME }
    },
    nodeCommand,
    checkCommand,
    signCommand
  };

  if (check) {
    console.log(JSON.stringify({ ...deriveReport, written: false }, null, 2));
    return;
  }

  const created = [];
  try {
    writeNew(scopePath, scopeBuffer);
    created.push(scopePath);
    writeNew(signerPath, Buffer.from(signerText, 'utf8'));
    created.push(signerPath);
    writeNew(deriveReportPath, Buffer.from(JSON.stringify(deriveReport, null, 2) + '\n', 'utf8'));
    created.push(deriveReportPath);
  } catch (error) {
    for (const file of created) {
      try { fs.unlinkSync(file); } catch (e) { /* keep original error */ }
    }
    throw error;
  }
  console.log(JSON.stringify({ ...deriveReport, written: true }, null, 2));
  console.log('\nNODE CHECK COMMAND:\n' + checkCommand);
  console.log('\nNODE SIGN COMMAND (authorized Root run):\n' + signCommand);
}

if (require.main === module) {
  main().catch(error => {
    console.error('ROOT_DERIVE_NEW_OUTER stopped: ' + (error && error.message ? error.message : String(error)));
    process.exitCode = 1;
  });
}

module.exports = { R, SOURCE, PURPOSE, SCOPE_NAME, SIGNER_NAME, DERIVE_REPORT_NAME, AUTH_TOKEN, buildScope, buildSigner, main };
