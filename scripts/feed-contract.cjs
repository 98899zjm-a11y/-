'use strict';
const fs = require('node:fs');
const p = 'F:\\自制软件\\xjy-jewelry-offline\\resources\\app.asar';
const buf = fs.readFileSync(p);
const text = buf.toString('utf8');
const marks = ['UPDATE_NOT_PUBLISHED', 'startLanServer', 'createLanClient', 'fetchCatalog', 'acceptedSequence', 'EMPLOYEE_DEVICE_REQUIRED', 'update/catalog', 'catalog.json', 'xjy-update'];
for (const m of marks) {
  const i = text.indexOf(m);
  console.log('=== ' + m + ' @ ' + i + ' ===');
  if (i >= 0) {
    const s = Math.max(0, i - 700);
    console.log(text.slice(s, i + 700).replace(/\s+/g, ' '));
  }
}
