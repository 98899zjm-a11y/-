'use strict';
/*
 * C28 internal-test worker28 signing step (user-authorized this round).
 * - Verifies the prepared proposal, the exact 2/99 worker delta, the 6 reused
 *   original-publisher envelopes and the 2 typed envelopes against the publisher.
 * - Reads the frozen issuer private key READ-ONLY, never copies/prints it, zeroes it.
 * - Signs ONLY requests/worker.catalog.json and writes the 7 envelope files that
 *   the frozen builder requires. No scope/approval record is minted beyond this
 *   signing act; report explicitly marks internal-test only and release=false.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('node:assert/strict');

const D = 'D:\\Codex\\xjy-1.7.0';
const P = "D:/Codex/xjy-release-20261022/candidate/proposal";
const OLD_APPROVALS = path.join(D, 'c27-candidate', 'approvals');
const OUT = "D:/Codex/xjy-release-20261022/candidate/approvals";
const RESULT = "D:/Codex/xjy-release-20261022/source";
const REPORT = path.join(RESULT, 'worker-signing-report.json');
const KEY = 'E:\\codex\\2026-10-13\\work\\xjy-web-stage1\\config\\release-signing\\issuer-private.pem';
const PUB = '6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c';
const PROPOSAL_SHA = "aaa9fac4c855ea8afbc8ad5780dddf66163caafb05584a99ffcdbd532cf3f3ef";
const INDEX_SHA = "dad8906373244cd88df02b75c147c0107891fb185c7749480b49f774753d5ce3";
const BUILDER_SHA = "21f6664596e91505944687c6ec0ba72f8c7f1376da63cfcb927c62d06d11537b";
const REVIEWED_SHA = "f2a4d5806ff09f6aff4ff4f0b66365bd100c0838a0be1f7c4951a5722121b8a8";
const OLD_WORKER_SHA = '9fdcb5d5c32c9976e36d7911a730bcce1af9478e3d6921576b7f5b97dfd68862';
const RUNTIME = { path: 'delivery-tools/engine-tree-runtime170.cjs', size: 199034, sha256: 'b856fc516b0e97fa99951fb2bb1880c8f4bd86cf4481bd2199fba2ad5531e0fa' };
const SLOT = { path: 'delivery-tools/native-employee-slot170.cjs', size: 70201, sha256: '553aab48981c4b8de9080faa16cb1bb9caf5ff416ff04ab84aa230ab9ead934f' };
const OLD_ENVELOPES = {
  'source-1.6.0.catalog-envelope.json': 'cde82451fb53ece189f15b513e2d1fa9c50098295921fa6635ebf7376a84b4b2',
  'source-1.6.1.catalog-envelope.json': '71f19964c429b06da6870c218ddf30cb125f4e2d371e4fb7136cd18d68339d99',
  'source-1.6.2.catalog-envelope.json': '7bd59deb9b90b3ca0f55af433e54404f40e060ea507dc8f905b1cc7a6d83237e',
  'resource.catalog-envelope.json': '5195eaf598946dfcdf672e4886254978b27e681f2c8733992f1cb584c03c1d79',
  'source-policy-envelope.json': '6bdfe409f352d65247d68860961e52c8805d583e45d3305ab252002e76340be2',
  'target.catalog-envelope.json': '6abc30889f4f79cd9313cf4480d805742d695b51da0846ad129b9fbaff6f10cf'
};
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const order = x => [...x].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

const report = { schemaVersion: 1, purpose: 'c28-internal-worker28-signing-report', asOf: new Date().toISOString(), internalTestOnly: true, nativePending: true, productionReady: false, releaseQualified: false, published: false, installed: false, programExecuted: false, privateKeyIncluded: false, outerSignatureNotIncluded: true };
function must(cond, msg) { if (!cond) throw new Error('SIGN_REFUSED: ' + msg); }

try {
  // 0) proposal + index identity
  const manifestRaw = fs.readFileSync(path.join(P, 'proposal-manifest.json'));
  const indexRaw = fs.readFileSync(path.join(P, 'signing-requests.json'));
  assert.equal(sha(manifestRaw), PROPOSAL_SHA, 'proposal manifest changed');
  assert.equal(sha(indexRaw), INDEX_SHA, 'request index changed');
  const manifest = JSON.parse(manifestRaw.toString('utf8'));
  const index = JSON.parse(indexRaw.toString('utf8'));
  assert.equal(manifest.round, 'known14and19to20worker28');
  assert.equal(index.round, 'known14and19to20worker28');
  assert.equal(index.signed, false);
  assert.equal(index.preparationToolSha256, BUILDER_SHA);
  assert.equal(index.reviewedInputsManifestSha256, REVIEWED_SHA);
  assert.equal(index.totalSignatureObjectsRequired, 9);
  assert.equal(index.newInternalSignatureCount, 1);
  assert.equal(index.reusedSignatureObjectCount, 8);

  const publisherPem = fs.readFileSync(path.join(P, 'worker-draft', 'publisher-public.pem'));
  assert(!publisherPem.toString('utf8').includes('PRIVATE KEY'));
  const pubKey = crypto.createPublicKey(publisherPem);
  assert.equal(pubKey.asymmetricKeyType, 'ed25519');
  assert.equal(sha(pubKey.export({ type: 'spki', format: 'der' })), PUB, 'publisher key changed');

  // 1) request payloads + reused envelopes + typed envelopes
  const requests = index.requests;
  assert.equal(requests.length, 7);
  const envelopePlan = [];
  for (const r of requests) {
    const field = r.id === 'source-policy' ? 'policy' : 'catalog';
    assert.equal(r.field, field);
    const payload = fs.readFileSync(path.join(P, ...r.path.split('/')));
    assert.equal(payload.length, r.size, 'payload size ' + r.id);
    assert.equal(sha(payload), r.payloadSha256, 'payload sha ' + r.id);
    if (r.id === 'worker.catalog') continue;
    const envFile = path.join(OLD_APPROVALS, r.expectedEnvelopeFile);
    const envBytes = fs.readFileSync(envFile);
    assert.equal(sha(envBytes), OLD_ENVELOPES[r.expectedEnvelopeFile], 'old envelope pin ' + r.expectedEnvelopeFile);
    const e = JSON.parse(envBytes.toString('utf8'));
    assert.deepEqual(Object.keys(e).sort(), [field, 'signature'].sort());
    assert.equal(e[field], payload.toString('utf8'));
    assert(crypto.verify(null, payload, pubKey, Buffer.from(e.signature, 'base64')), 'old signature ' + r.id);
    envelopePlan.push({ name: r.expectedEnvelopeFile, bytes: envBytes, reused: true, payloadSha256: r.payloadSha256 });
  }
  assert.equal(envelopePlan.length, 6);

  for (const [file, payloadFile, field] of [
    ['slot-source.catalog-envelope.json', 'slot-source.catalog.json', 'catalog'],
    ['slot-default-source.catalog-envelope.json', 'slot-default-source.catalog.json', 'catalog']
  ]) {
    const payload = fs.readFileSync(path.join(P, payloadFile));
    const envBytes = fs.readFileSync(path.join(P, file));
    const e = JSON.parse(envBytes.toString('utf8'));
    assert.deepEqual(Object.keys(e).sort(), ['catalog', 'signature']);
    assert.equal(e.catalog, payload.toString('utf8'));
    assert(crypto.verify(null, payload, pubKey, Buffer.from(e.signature, 'base64')), 'typed signature ' + file);
  }

  // 2) exact 2/99 worker delta vs frozen C27 worker27 payload
  const oldWorkerRaw = fs.readFileSync(path.join(D, 'c27-candidate', 'proposal', 'requests', 'worker.catalog.json'));
  assert.equal(sha(oldWorkerRaw), OLD_WORKER_SHA, 'C27 worker27 payload changed');
  const oldWorker = JSON.parse(oldWorkerRaw.toString('utf8'));
  const workerReq = requests.find(r => r.id === 'worker.catalog');
  const newWorkerRaw = fs.readFileSync(path.join(P, ...workerReq.path.split('/')));
  assert.equal(sha(newWorkerRaw), workerReq.payloadSha256);
  const newWorker = JSON.parse(newWorkerRaw.toString('utf8'));
  assert.equal(newWorker.sequence, 28);
  const a = order(oldWorker.files), b = order(newWorker.files);
  assert.equal(a.length, 101); assert.equal(b.length, 101);
  assert.deepEqual(a.map(f => f.path), b.map(f => f.path));
  const changed = b.filter((r, i) => JSON.stringify(r) !== JSON.stringify(a[i]));
  assert.deepEqual(changed, [{"path":"delivery-tools/delivery-native-170.cjs","size":11527,"sha256":"c962f1c314866be0a57d7aef819954f47a389998e6eb78dd30562d99b0cb52fc"},{"path":"delivery-tools/engine-tree-runtime170.cjs","size":200809,"sha256":"a294ec51027e2dff4aaff5d23cfa0e39d15531c4c51f6d5ae8d773d920b53ecf"},{"path":"delivery-tools/install-location.cjs","size":17214,"sha256":"3e4698f282d521ea9456375f1948ca5032db79783fb5e9b486b8c68fc5f24cba"},{"path":"delivery-tools/native-employee-slot170.cjs","size":70201,"sha256":"553aab48981c4b8de9080faa16cb1bb9caf5ff416ff04ab84aa230ab9ead934f"}], 'exact four reviewed delta rows');
  const io = b.find(f => f.path === 'delivery-approval/approval-io-170.cjs');
  assert(io && io.size === 20487 && io.sha256 === '927c46182f1943ce29889fdedcbdd49c69bc372b9ebe99be3eba8aa7e11cd0b7', 'approval-io mirror changed');
  const core = b.find(f => f.path === 'delivery-tools/initial-patch-core.cjs');
  assert(core && core.size === 41689 && core.sha256 === 'cbda18fd8d447610ed5a686c66d1d1bc904c889ace6f83b44b70fba573023d53', 'core changed');

  // 3) read-only issuer key, sign only worker.catalog, verify, zero
  let keyReads = 0;
  const keyBuf = fs.readFileSync(KEY);
  keyReads++;
  let privateKey = null, signature = null;
  try {
    assert(keyBuf.length > 0 && keyBuf.length <= 4096);
    privateKey = crypto.createPrivateKey(keyBuf);
    assert.equal(privateKey.asymmetricKeyType, 'ed25519');
    assert.equal(sha(crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' })), PUB, 'issuer key does not match publisher');
    signature = crypto.sign(null, newWorkerRaw, privateKey).toString('base64');
    assert(crypto.verify(null, newWorkerRaw, pubKey, Buffer.from(signature, 'base64')), 'new signature self-verify failed');
  } finally { keyBuf.fill(0); privateKey = null; }
  const newEnvelope = { catalog: newWorkerRaw.toString('utf8'), signature };
  const newEnvelopeBytes = Buffer.from(JSON.stringify(newEnvelope));
  assert(Buffer.from(newEnvelope.catalog).equals(newWorkerRaw));
  envelopePlan.push({ name: workerReq.expectedEnvelopeFile, bytes: newEnvelopeBytes, reused: false, payloadSha256: workerReq.payloadSha256 });

  // 4) CreateNew approvals closure
  assert(!fs.existsSync(OUT), 'approvals output already exists');
  fs.mkdirSync(OUT, { recursive: false, mode: 0o700 });
  const written = [];
  for (const item of envelopePlan) {
    const file = path.join(OUT, item.name);
    fs.writeFileSync(file, item.bytes, { flag: 'wx', mode: 0o600 });
    const back = fs.readFileSync(file);
    assert(back.equals(item.bytes), 'readback mismatch ' + item.name);
    written.push({ name: item.name, size: item.bytes.length, sha256: sha(item.bytes), payloadSha256: item.payloadSha256, reused: item.reused });
  }
  const expectedNames = requests.map(r => r.expectedEnvelopeFile).sort();
  assert.deepEqual(fs.readdirSync(OUT).sort(), expectedNames, 'approvals set mismatch');

  report.proposalManifestSha256 = PROPOSAL_SHA;
  report.requestIndexSha256 = INDEX_SHA;
  report.builderSha256 = BUILDER_SHA;
  report.reviewedInputsSha256 = REVIEWED_SHA;
  report.workerPayloadSha256 = workerReq.payloadSha256;
  report.workerPayloadSize = workerReq.size;
  report.workerSequence = 28;
  report.oldWorker27PayloadSha256 = OLD_WORKER_SHA;
  report.changedWorkerRows = [{"path":"delivery-tools/delivery-native-170.cjs","size":11527,"sha256":"c962f1c314866be0a57d7aef819954f47a389998e6eb78dd30562d99b0cb52fc"},{"path":"delivery-tools/engine-tree-runtime170.cjs","size":200809,"sha256":"a294ec51027e2dff4aaff5d23cfa0e39d15531c4c51f6d5ae8d773d920b53ecf"},{"path":"delivery-tools/install-location.cjs","size":17214,"sha256":"3e4698f282d521ea9456375f1948ca5032db79783fb5e9b486b8c68fc5f24cba"},{"path":"delivery-tools/native-employee-slot170.cjs","size":70201,"sha256":"553aab48981c4b8de9080faa16cb1bb9caf5ff416ff04ab84aa230ab9ead934f"}];
  report.unchangedWorkerRows = 97;
  report.reusedPublicSignatures = 6;
  report.newInternalSignatures = 1;
  report.typedSignaturesVerified = 2;
  report.signatureObjects = 9;
  report.files = written;
  report.keyReads = keyReads;
  report.privateKeyIncluded = false;
  report.authority = 'user instruction in this session: C28 internal worker28 signing authorized; Codex confirms after completion';
  report.scopeNote = 'Internal-test signing only; no Root production approval record minted, no feed, no install, release qualification false';
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), { encoding: 'utf8', flag: 'wx' });
  console.log(JSON.stringify({ signed: true, envelopes: written.length, newSignatures: 1, reused: 6, keyReads, report: REPORT }));
} catch (e) {
  process.stderr.write('SIGN_FAILED: ' + String((e && e.message) || e) + '\n' + String(e && e.stack) + '\n');
  process.exitCode = 1;
}
