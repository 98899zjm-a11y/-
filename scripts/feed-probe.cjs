'use strict';
// Feasibility probe only: sign a throwaway update catalog with the existing
// release signing key and verify it against the published public key.
// Reads the key READ-ONLY, never copies or prints it, writes nothing to release artifacts.
const fs = require('node:fs');
const crypto = require('node:crypto');
const KEY = 'E:\\codex\\2026-10-13\\work\\xjy-web-stage1\\config\\release-signing\\issuer-private.pem';
const PUB = 'D:\\Codex\\xjy-release-20261022\\candidate\\proposal\\worker-draft\\publisher-public.pem';
const keyBytes = fs.readFileSync(KEY);
let priv;
try { priv = crypto.createPrivateKey(keyBytes); } finally { keyBytes.fill(0); }
const pub = crypto.createPublicKey(fs.readFileSync(PUB));
const derived = crypto.createPublicKey(priv);
const same = derived.export({ type: 'spki', format: 'der' }).equals(pub.export({ type: 'spki', format: 'der' }));
const catalog = {
  schemaVersion: 1,
  app: 'xjy-jewelry-offline',
  channel: 'stable',
  version: '1.7.0',
  sourceVersions: ['1.6.2'],
  platform: 'win32',
  arch: 'x64',
  sequence: 1,
  publishedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
  archive: { size: 786451126, sha256: '306967c393167467c23108985b87ae1fce509cbf6e2577516c95783162384830' },
  files: [{ path: 'resources/app.asar', size: 1, sha256: '0'.repeat(64) }]
};
const raw = Buffer.from(JSON.stringify(catalog), 'utf8');
const sig = crypto.sign(null, raw, priv);
const envelope = { catalog: raw.toString('utf8'), signature: sig.toString('base64') };
const ok = crypto.verify(null, Buffer.from(envelope.catalog, 'utf8'), pub, Buffer.from(envelope.signature, 'base64'));
const sigB64Ok = /^[A-Za-z0-9+/]{86}==$/.test(envelope.signature);
const pubSha = crypto.createHash('sha256').update(fs.readFileSync(PUB)).digest('hex');
const pubDerSha = crypto.createHash('sha256').update(pub.export({ type: 'spki', format: 'der' })).digest('hex');
console.log(JSON.stringify({
  keyIsSameKeypair: same,
  catalogSignatureVerifies: ok,
  signatureMatchesClientFormat: sigB64Ok,
  signatureB64Length: envelope.signature.length,
  publicPemSha256: pubSha,
  publicDerSha256: pubDerSha,
  keyType: priv.asymmetricKeyType
}, null, 2));
