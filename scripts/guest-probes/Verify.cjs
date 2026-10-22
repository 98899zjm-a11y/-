'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RES = 'C:\\XjyReleaseResults';
const HOST = 'C:\\Users\\WDAGUtilityAccount\\AppData\\Local\\XjyGenuine150Host-a2';
const INSTALL = path.join(HOST, 'program');
const STATE = path.join(HOST, '.program.xjy-engine-state');
const LOG = path.join(RES, 'verify2-progress.log');

function note(m) { try { fs.appendFileSync(LOG, new Date().toISOString() + ' ' + m + '\r\n'); } catch (e) { } }
process.on('uncaughtException', function (e) { note('FATAL ' + (e && e.stack ? e.stack : e)); process.exit(9); });

const lp = function (p) { return p.startsWith('\\\\?\\') ? p : '\\\\?\\' + p; };

function hashFile(p) {
  return new Promise(function (resolve) {
    let size = 0;
    const h = crypto.createHash('sha256');
    let s;
    try { s = fs.createReadStream(lp(p), { highWaterMark: 1 << 20 }); } catch (e) { resolve({ error: String(e.message) }); return; }
    s.on('data', function (b) { size += b.length; h.update(b); });
    s.on('error', function (e) { resolve({ error: String(e.message) }); });
    s.on('end', function () { resolve({ size: size, sha: h.digest('hex') }); });
  });
}

function walk(root) {
  const out = [];
  const stack = [root];
  let dirs = 0;
  while (stack.length) {
    const d = stack.pop();
    dirs++;
    let ents;
    try { ents = fs.readdirSync(lp(d), { withFileTypes: true }); }
    catch (e) { note('READDIR_FAIL ' + d + ' ' + (e.code || e.message)); continue; }
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      const full = path.join(d, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) out.push(full);
      else if (e.isSymbolicLink()) out.push(full);
    }
  }
  note('walked dirs=' + dirs + ' files=' + out.length);
  return out;
}

function readJson(p) { return JSON.parse(fs.readFileSync(lp(p), 'utf8')); }

(async function main() {
  const res = { at: new Date().toISOString(), install: INSTALL, state: STATE };
  const t0 = Date.now();
  note('start node ' + process.version);

  const envs = readJson(path.join(STATE, 'journal.json'));
  const rec = JSON.parse(envs.payload);
  res.phase = rec.phase;
  res.role = rec.role;
  res.transactionId = rec.transactionId;
  res.sourceVersion = rec.sourceVersion;
  res.targetVersion = rec.targetVersion;
  res.sourceEngineVersion = rec.sourceEngineVersion;
  res.targetEngineVersion = rec.targetEngineVersion;
  res.targetCatalogSha256 = rec.targetCatalogSha256;
  res.publisherPublicKeySha256 = rec.publisherPublicKeySha256;
  res.targetFileCount = Array.isArray(rec.targetFiles) ? rec.targetFiles.length : -1;
  res.dataFileCount = Array.isArray(rec.dataFiles) ? rec.dataFiles.length : -1;
  res.paths = rec.paths || null;
  note('journal phase=' + rec.phase + ' role=' + rec.role + ' src=' + rec.sourceVersion + ' dst=' + rec.targetVersion + ' targetFiles=' + res.targetFileCount);

  try { res.marker = fs.readFileSync(lp(path.join(INSTALL, 'xjy-install-activation.json')), 'utf8'); } catch (e) { res.marker = 'ERR ' + e.message; }
  try { res.startupStatus = fs.readFileSync(lp(path.join(STATE, 'engine-startup-status.json')), 'utf8'); } catch (e) { res.startupStatus = 'ERR ' + e.message; }

  const expected = Object.create(null);
  for (let i = 0; i < rec.targetFiles.length; i++) {
    const f = rec.targetFiles[i];
    expected[String(f.path).replace(/\//g, '\\').toLowerCase()] = f;
  }

  const files = walk(INSTALL);
  const seen = Object.create(null);
  const mismatch = [];
  const extra = [];
  let hashed = 0, bytes = 0, errors = 0;
  for (let i = 0; i < files.length; i++) {
    const full = files[i];
    const rel = full.substring(INSTALL.length).replace(/^\\+/, '');
    const key = rel.toLowerCase();
    seen[key] = true;
    const d = await hashFile(full);
    if (d.error) { errors++; if (mismatch.length < 30) mismatch.push({ path: rel, reason: 'HASH_ERROR', error: d.error }); continue; }
    hashed++; bytes += d.size;
    const exp = expected[key];
    if (!exp) { if (extra.length < 30) extra.push(rel); continue; }
    if (Number(exp.size) !== d.size || String(exp.sha256) !== d.sha) {
      if (mismatch.length < 30) mismatch.push({ path: rel, expectedSize: exp.size, actualSize: d.size, expectedSha: exp.sha256, actualSha: d.sha });
    }
    if (i % 500 === 0) note('hashed ' + i + ' of ' + files.length + ' bytes=' + bytes);
  }
  const missing = [];
  const keys = Object.keys(expected);
  for (let i = 0; i < keys.length; i++) if (!seen[keys[i]] && missing.length < 30) missing.push(keys[i]);
  let missingTotal = 0;
  for (let i = 0; i < keys.length; i++) if (!seen[keys[i]]) missingTotal++;
  const extraTotal = (function () { let n = 0; for (const k in seen) if (!expected[k]) n++; return n; })();

  res.program = {
    hashed: hashed, bytes: bytes, hashErrors: errors,
    expectedCount: keys.length, seenCount: Object.keys(seen).length,
    mismatchCount: mismatch.length, mismatchSamples: mismatch,
    extraCount: extraTotal, extraSamples: extra,
    missingExpectedCount: missingTotal, missingSamples: missing,
    seconds: Math.round((Date.now() - t0) / 100) / 10
  };
  note('program done hashed=' + hashed + ' bytes=' + bytes + ' mismatch=' + mismatch.length + ' extra=' + extraTotal + ' missing=' + missingTotal + ' errors=' + errors);

  const beforePath = path.join(RES, 'before.json');
  const dr = {};
  if (fs.existsSync(lp(beforePath))) {
    const before = readJson(beforePath);
    const root = before.data.root;
    dr.root = root;
    dr.rootExists = fs.existsSync(lp(root));
    dr.expected = before.data.files.length;
    if (dr.rootExists) {
      const dt = Date.now();
      let same = 0;
      const dmis = []; const dmiss = [];
      for (let i = 0; i < before.data.files.length; i++) {
        const f = before.data.files[i];
        const p = path.join(root, f.path);
        if (!fs.existsSync(lp(p))) { if (dmiss.length < 30) dmiss.push(f.path); continue; }
        const d = await hashFile(p);
        if (d.error) { if (dmis.length < 30) dmis.push({ path: f.path, reason: 'HASH_ERROR', error: d.error }); continue; }
        if (String(d.sha) !== String(f.sha256) || Number(d.size) !== Number(f.size)) {
          if (dmis.length < 30) dmis.push({ path: f.path, expectedSize: f.size, actualSize: d.size, expectedSha: f.sha256, actualSha: d.sha });
        } else same++;
      }
      let dmissTotal = 0;
      for (let i = 0; i < before.data.files.length; i++) if (!fs.existsSync(lp(path.join(root, before.data.files[i].path)))) dmissTotal++;
      dr.same = same; dr.mismatchCount = dmis.length; dr.mismatchSamples = dmis;
      dr.missingCount = dmissTotal; dr.missingSamples = dmiss;
      dr.seconds = Math.round((Date.now() - dt) / 100) / 10;
    }
  } else dr.error = 'beforeMissing';
  res.data = dr;
  note('data done same=' + dr.same + ' mismatch=' + dr.mismatchCount + ' missing=' + dr.missingCount + ' err=' + dr.error);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const out = path.join(RES, 'verify-' + stamp + '.json');
  fs.writeFileSync(out, JSON.stringify(res, null, 1), 'utf8');
  note('wrote ' + out);
})().catch(function (e) { note('CATCH ' + (e && e.stack ? e.stack : e)); process.exit(9); });
