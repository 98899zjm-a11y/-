'use strict';
const fs = require('node:fs');
const path = require('node:path');
const stateDir = process.argv[2];
const out = process.argv[3];
const jp = path.join(stateDir, 'journal.json');
const LONG = p => (p.startsWith('\\\\?\\') ? p : '\\\\?\\' + p);
let last = '';
function tick() {
  try {
    if (fs.existsSync(LONG(jp))) {
      const raw = fs.readFileSync(LONG(jp), 'utf8');
      const env = JSON.parse(raw);
      const m = JSON.parse(env.payload);
      const line = `[${new Date().toISOString()}] phase=${m.phase} tx=${m.transactionId} src=${m.sourceVersion} tgt=${m.targetVersion}\n`;
      if (line !== last) {
        fs.appendFileSync(out, line);
        last = line;
        if (m.phase === 'prepared') {
          fs.copyFileSync(LONG(jp), path.join(path.dirname(out), 'journal-prepared.json'));
        }
      }
    }
  } catch (e) {
    fs.appendFileSync(out, `[${new Date().toISOString()}] err=${e.message}\n`);
  }
}
setInterval(tick, 2000);
tick();
fs.appendFileSync(out, `[${new Date().toISOString()}] watcher started for ${stateDir}\n`);
