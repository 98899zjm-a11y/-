'use strict';
const fs = require('fs');
const path = require('path');
const RES = 'C:\\XjyReleaseResults';
const STATE = 'C:\\Users\\WDAGUtilityAccount\\AppData\\Local\\XjyGenuine150Host-a2\\.program.xjy-engine-state';
const PROG = 'C:\\Users\\WDAGUtilityAccount\\AppData\\Local\\XjyGenuine150Host-a2\\program';
const lp = function (p) { return p.startsWith('\\\\?\\') ? p : '\\\\?\\' + p; };
const out = { at: new Date().toISOString(), extraDirs: [], emptyDirs: [], declaredDirs: 0, actualDirs: 0 };
try {
  const env = JSON.parse(fs.readFileSync(lp(path.join(STATE, 'journal.json')), 'utf8'));
  const pay = typeof env.payload === 'string' ? JSON.parse(env.payload) : env.payload;
  const files = pay.targetFiles || [];
  const declared = new Set();
  for (const f of files) {
    const parts = String(f.path).split('/');
    for (let i = 1; i < parts.length; i++) { declared.add(parts.slice(0, i).join('/')); }
  }
  out.declaredDirs = declared.size;
  const actual = [];
  (function walk(rel) {
    let ents;
    try { ents = fs.readdirSync(lp(path.join(PROG, rel)), { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      if (!e.isDirectory()) continue;
      const r = rel ? rel + '/' + e.name : e.name;
      let st = null;
      try { st = fs.statSync(lp(path.join(PROG, r))); } catch (er) { }
      let childCount = 0;
      try { childCount = fs.readdirSync(lp(path.join(PROG, r))).length; } catch (er) { }
      actual.push({ path: r, mtime: st ? st.mtime.toISOString() : null, children: childCount, declared: declared.has(r) });
      walk(r);
    }
  })('');
  out.actualDirs = actual.length;
  out.extraDirs = actual.filter(function (d) { return !d.declared; });
  out.emptyDirs = actual.filter(function (d) { return d.children === 0; });
  fs.writeFileSync(path.join(RES, 'treechange-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.json'), JSON.stringify(out, null, 1), 'utf8');
  fs.appendFileSync(path.join(RES, 'verify2-progress.log'), new Date().toISOString() + ' treechange declared=' + out.declaredDirs + ' actual=' + out.actualDirs + ' extra=' + out.extraDirs.length + ' empty=' + out.emptyDirs.length + '\r\n');
} catch (e) {
  out.error = String(e && e.stack ? e.stack : e);
  fs.writeFileSync(path.join(RES, 'treechange-error.json'), JSON.stringify(out, null, 1), 'utf8');
}
