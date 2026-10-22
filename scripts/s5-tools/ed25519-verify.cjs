const crypto = require('node:crypto'), fs = require('node:fs');
const pem = fs.readFileSync(process.argv[2], 'utf8');
const catalog = fs.readFileSync(process.argv[3]);
const sig = Buffer.from(fs.readFileSync(process.argv[4], 'utf8').trim(), 'base64');
const key = crypto.createPublicKey(pem);
const der = key.export({ type: 'spki', format: 'der' });
const spkiSha = crypto.createHash('sha256').update(der).digest('hex');
const ok = crypto.verify(null, catalog, key, sig);
process.stdout.write(JSON.stringify({ ok, spkiSha }));