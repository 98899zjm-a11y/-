'use strict';
/*
 * verify-sig.cjs - Ed25519 signature verifier for xjy release envelopes.
 *
 * Read only. Never writes to the release point, never rewrites the envelope.
 *
 * usage:
 *   node verify-sig.cjs envelope <envelope.json> [public.pem]   # {catalog|manifest, signature}
 *   node verify-sig.cjs binding  <binding.json>  [public.pem]   # engine-native170-binding.json
 *   node verify-sig.cjs key      [public.pem]                   # key fingerprint only
 *
 * exit code: 0 = signature verified, 1 = failed / unreadable, 2 = usage error
 * stdout: one JSON object (ASCII escaped), machine readable by the .ps1 wrapper.
 */

const fs = require('node:fs');
const crypto = require('node:crypto');

const DEFAULT_PEM = 'D:\\Codex\\xjy-release-20261022\\candidate\\proposal-a17-20261022-093618\\worker-draft\\publisher-public.pem';

function emit(o, code) {
  process.stdout.write(JSON.stringify(o) + '\n');
  process.exit(code);
}

function keyInfo(pemPath) {
  const pemBytes = fs.readFileSync(pemPath);
  const key = crypto.createPublicKey(pemBytes);
  const der = key.export({ type: 'spki', format: 'der' });
  return {
    key,
    pemPath,
    keyType: key.asymmetricKeyType,
    pemSha256: crypto.createHash('sha256').update(pemBytes).digest('hex'),
    derSha256: crypto.createHash('sha256').update(der).digest('hex'),
  };
}

function verifyRaw(raw, sigB64, key) {
  const data = Buffer.from(raw, 'utf8');
  const sig = Buffer.from(sigB64, 'base64');
  let ok = false;
  let err = null;
  try {
    ok = crypto.verify(null, data, key, sig);
  } catch (e) {
    err = String(e && e.message ? e.message : e);
  }
  return {
    ok,
    error: err,
    payloadSha256: crypto.createHash('sha256').update(data).digest('hex'),
    payloadBytes: data.length,
    signatureBytes: sig.length,
  };
}

function summarizePayload(raw) {
  const s = { parsable: false };
  let v;
  try {
    v = JSON.parse(raw);
  } catch (e) {
    s.parseError = String(e && e.message ? e.message : e);
    return s;
  }
  s.parsable = true;
  for (const k of ['schemaVersion', 'purpose', 'app', 'role', 'channel',
                   'version', 'targetVersion', 'engineVersion', 'sequence',
                   'publishedAt', 'expiresAt', 'bindingSha256',
                   'fullTargetCatalogSha256', 'workerCatalogSha256']) {
    if (v[k] !== undefined) s[k] = v[k];
  }
  if (v.archive && typeof v.archive === 'object') {
    s.archiveSize = v.archive.size;
    s.archiveSha256 = v.archive.sha256;
  }
  if (Array.isArray(v.files)) s.fileCount = v.files.length;
  return s;
}

function main(argv) {
  const cmd = (argv[2] || '').toLowerCase();
  if (cmd === 'key') {
    const info = keyInfo(argv[3] || DEFAULT_PEM);
    return emit({ ok: true, mode: 'key', keyType: info.keyType,
                  pemPath: info.pemPath, pemSha256: info.pemSha256, derSha256: info.derSha256 }, 0);
  }

  if (cmd === 'envelope' || cmd === 'binding') {
    const file = argv[3];
    if (!file) return emit({ ok: false, mode: cmd, error: 'missing envelope path' }, 2);
    const pemPath = argv[4] || DEFAULT_PEM;

    let info;
    let doc;
    try {
      info = keyInfo(pemPath);
      doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      return emit({ ok: false, mode: cmd, error: 'read failed: ' + String(e && e.message ? e.message : e) }, 1);
    }

    let raw;
    let sigB64;
    let field;
    if (cmd === 'envelope') {
      if (typeof doc.catalog === 'string' && typeof doc.signature === 'string') {
        field = 'catalog'; raw = doc.catalog; sigB64 = doc.signature;
      } else if (typeof doc.manifest === 'string' && typeof doc.signature === 'string') {
        field = 'manifest'; raw = doc.manifest; sigB64 = doc.signature;
      } else {
        return emit({ ok: false, mode: cmd, error: 'envelope has no {catalog|manifest, signature} pair' }, 1);
      }
    } else {
      const te = doc && doc.native && doc.native.targetEnvelope;
      if (!te || typeof te.catalog !== 'string' || typeof te.signature !== 'string') {
        return emit({ ok: false, mode: cmd, error: 'binding has no native.targetEnvelope' }, 1);
      }
      field = 'native.targetEnvelope.catalog'; raw = te.catalog; sigB64 = te.signature;
    }

    const res = verifyRaw(raw, sigB64, info.key);

    // Diagnostic only: does a JSON round trip preserve the signed bytes?
    let canonicalMatch = null;
    try {
      canonicalMatch = crypto.verify(null, Buffer.from(JSON.stringify(JSON.parse(raw)), 'utf8'),
                                     info.key, Buffer.from(sigB64, 'base64'));
    } catch (e) { canonicalMatch = null; }

    return emit({
      ok: res.ok === true,
      mode: cmd,
      field,
      file,
      keyType: info.keyType,
      pemPath: info.pemPath,
      derSha256: info.derSha256,
      payloadSha256: res.payloadSha256,
      payloadBytes: res.payloadBytes,
      signatureBytes: res.signatureBytes,
      canonicallyReparsedStillVerifies: canonicalMatch,
      verifyError: res.error,
      payload: summarizePayload(raw),
    }, res.ok === true ? 0 : 1);
  }

  return emit({
    ok: false,
    usage: 'node verify-sig.cjs envelope <envelope.json> [public.pem] | binding <binding.json> [public.pem] | key [public.pem]',
  }, 2);
}

main(process.argv);
