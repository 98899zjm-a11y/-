'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const RES = 'C:\\XjyReleaseResults';
const LOG = path.join(RES, 'verify2-progress.log');
function note(m) { try { fs.appendFileSync(LOG, new Date().toISOString() + ' ' + m + '\r\n'); } catch (e) { } }
const lp = function (p) { return p.startsWith('\\\\?\\') ? p : '\\\\?\\' + p; };
function hashFile(p) {
  return new Promise(function (resolve) {
    let size = 0; const h = crypto.createHash('sha256'); let s;
    try { s = fs.createReadStream(lp(p), { highWaterMark: 1 << 20 }); } catch (e) { resolve({ error: String(e.message) }); return; }
    s.on('data', function (b) { size += b.length; h.update(b); });
    s.on('error', function (e) { resolve({ error: String(e.message) }); });
    s.on('end', function () { resolve({ size: size, sha: h.digest('hex') }); });
  });
}
(async function () {
  const before = JSON.parse(fs.readFileSync(lp(path.join(RES, 'before.json')), 'utf8'));
  const root = before.data.root;
  const re = /\.(db|db-wal|db-shm|sqlite3?|sqlite3?-wal|sqlite3?-shm)$/i;
  const business = before.data.files.filter(function (f) { return re.test(String(f.path)); });
  note('business candidates=' + business.length);
  const rows = [];
  let same = 0, diff = 0, err = 0;
  for (let i = 0; i < business.length; i++) {
    const f = business[i];
    const p = path.join(root, f.path);
    if (!fs.existsSync(lp(p))) { rows.push({ path: f.path, state: 'MISSING' }); continue; }
    const d = await hashFile(p);
    if (d.error) { err++; rows.push({ path: f.path, state: 'ERROR', error: d.error }); continue; }
    const ok = String(d.sha) === String(f.sha256) && Number(d.size) === Number(f.size);
    if (ok) same++; else diff++;
    rows.push({ path: f.path, state: ok ? 'SAME' : 'DIFF', expectedSize: f.size, actualSize: d.size });
  }
  const out = { at: new Date().toISOString(), root: root, total: business.length, same: same, diff: diff, error: err, rows: rows };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const p2 = path.join(RES, 'verify-business-' + stamp + '.json');
  fs.writeFileSync(p2, JSON.stringify(out, null, 1), 'utf8');
  note('business done same=' + same + ' diff=' + diff + ' err=' + err + ' wrote=' + p2);
})().catch(function (e) { note('CATCH2 ' + (e && e.stack ? e.stack : e)); process.exit(9); });
