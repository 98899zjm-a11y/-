'use strict';
// Pure archive/data tests on synthetic copies. No application or database run.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),test=require('node:test'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),{scanFile,verifyAsarFile}=require('./pack-bridge170-resource.cjs');
const base=path.join(root,'release-work/desktop-first170-baseline-artifact-a1'),manifest=JSON.parse(fs.readFileSync(path.join(base,'artifact-manifest.json'),'utf8'));
const archive=path.join(base,'resources/app.asar'),out=path.join(root,'audit-evidence/bridge-packager-parser-a1');
assert(!fs.existsSync(out),'CreateNew evidence fixtures required');fs.mkdirSync(out);
const original=fs.readFileSync(archive),originalSha=crypto.createHash('sha256').update(original).digest('hex');
function fixture(name,edit){const b=Buffer.from(original);edit(b);const p=path.join(out,name);fs.writeFileSync(p,b,{flag:'wx'});return p;}
test('P01 existing exact 143-entry ASAR verifies by bounded reads',()=>{assert.deepEqual(verifyAsarFile(archive,manifest.sourceFiles),{entries:143,size:original.length});});
test('P02 one changed payload byte is rejected',()=>{const p=fixture('corrupted.asar',b=>{b[b.length-1]^=1;});assert.throws(()=>verifyAsarFile(p,manifest.sourceFiles),/ASAR member digest/);});
test('P03 undeclared member is rejected',()=>{assert.throws(()=>verifyAsarFile(archive,manifest.sourceFiles.slice(1)),/unexpected ASAR member/);});
test('P04 traversal directory in ASAR index is rejected',()=>{const p=fixture('traversal.asar',b=>{const at=b.indexOf(Buffer.from('"assets":'));assert(at>=0);Buffer.from('"../abc":').copy(b,at);});assert.throws(()=>verifyAsarFile(p,manifest.sourceFiles),/unsafe ASAR member/);});
test('P05 invalid archive framing is rejected',()=>{const p=fixture('invalid.asar',b=>b.writeUInt32LE(0,0));assert.throws(()=>verifyAsarFile(p,manifest.sourceFiles),/ASAR framing/);});
test('P06 CRC32 standard check vector and input preservation',()=>{const p=path.join(out,'crc-vector.txt');fs.writeFileSync(p,'123456789',{flag:'wx'});const r=scanFile(p);assert.equal(r.size,9);assert.equal(r.crc32,0xcbf43926);assert.equal(r.sha256,'15e2b0d3c33891ebb0f1ef609ec419420c20e320ce94c65fbc8c3312448eb225');assert.equal(crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),originalSha);});
