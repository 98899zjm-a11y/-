'use strict';
// Root-only actual Guest diagnostic/regression. All DBs below are tiny new
// synthetic fixtures; no existing DB, EXE, DLL, business module or service.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
if(process.platform!=='win32'||ROOT.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')throw Error('Actual fixed Guest required before SQLite');
const guard=path.join(ROOT,'stage1/guest-candidate-cdp.cjs');
if(sha(fs.readFileSync(guard))!=='59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32')throw Error('Original Guest guard changed');
require(guard).actualGuard();
const test=require('node:test'),assert=require('node:assert/strict'),sqlite=require('node:sqlite');
function plain(file,directory){for(let p=file;;p=path.dirname(p)){const s=fs.lstatSync(p);assert(!s.isSymbolicLink());assert.equal(fs.realpathSync.native(p).toLowerCase(),p.toLowerCase());if(p===file)assert(directory?s.isDirectory():s.isFile()&&s.nlink===1);else assert(s.isDirectory());if(p===path.dirname(p))break;}return file;}
function fixture(t){const runtime=path.join(ROOT,'runtime');plain(ROOT,true);if(!fs.existsSync(runtime))fs.mkdirSync(runtime);plain(runtime,true);const parent=path.join(runtime,'initial-patch-tests');if(!fs.existsSync(parent))fs.mkdirSync(parent);plain(parent,true);const root=path.join(parent,'sqlite-long-'+crypto.randomUUID());fs.mkdirSync(root);plain(root,true);fs.writeFileSync(path.join(root,'owner.json'),JSON.stringify({purpose:'sqlite-long-path-guest-fixture',synthetic:true,root}),{flag:'wx'});t.diagnostic('New synthetic fixture retained: '+root);return root;}
function target(root,label,length){let dir=path.join(root,label),file=path.join(dir,'snapshot.sqlite');while(file.length<length){const remaining=length-file.length;if(remaining===1)dir=path.join(path.dirname(dir),path.basename(dir)+'d');else dir=path.join(dir,'d'.repeat(Math.min(50,remaining-1)));file=path.join(dir,'snapshot.sqlite');}assert.equal(file.length,length);const rel=path.relative(root,file);assert(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel));fs.mkdirSync(dir,{recursive:true});plain(dir,true);assert(!fs.existsSync(file));return file;}
function readProof(file,argument){plain(file,false);const db=new sqlite.DatabaseSync(argument,{readOnly:true,allowExtension:false});try{assert.equal(db.prepare('SELECT value FROM path_fixture').get().value,'literal synthetic value');assert.equal(Object.values(db.prepare('PRAGMA quick_check(1)').get())[0],'ok');return true;}finally{db.close();}}
async function rawProbe(source,file,native){const argument=native?path.toNamespacedPath(file):file,result={path:file,canonicalCharacters:file.length,canonicalUtf8Bytes:Buffer.byteLength(file),argumentCharacters:argument.length,native,backup:false,readback:false};try{await sqlite.backup(source,argument);result.backup=true;result.readback=readProof(file,argument);}catch(error){result.error={code:error.code||null,message:String(error.message).slice(0,500)};}return result;}

test('D00 short control and long plain/native SQLite observations',async t=>{
 const root=fixture(t),db=new sqlite.DatabaseSync(':memory:',{allowExtension:false});try{
  db.exec('CREATE TABLE path_fixture(value TEXT NOT NULL)');db.prepare('INSERT INTO path_fixture VALUES(?)').run('literal synthetic value');
  const short=path.join(root,'short.sqlite'),rows=[await rawProbe(db,short,false)];
  for(const length of [260,320]){const normal=target(root,'plain-'+length+'-\u5de5\u4f5c\u5ba4\u6570\u636e',length),native=target(root,'native-'+length+'-\u5de5\u4f5c\u5ba4\u6570\u636e',length);rows.push(await rawProbe(db,normal,false),await rawProbe(db,native,true));}
  t.diagnostic(JSON.stringify({node:process.versions.node,electron:process.versions.electron||null,sqlite:db.prepare('SELECT sqlite_version() AS version').get().version,backupSourceSha256:sha(fs.readFileSync(path.join(ROOT,'delivery-tools/initial-patch-backup.cjs'))),rows}));
  assert.equal(rows[0].backup,true,'Short plain control must succeed');assert.equal(rows[0].readback,true);
  assert.equal(rows[1].canonicalCharacters,260);assert.equal(rows[2].canonicalCharacters,260);assert.equal(rows[3].canonicalCharacters,320);assert.equal(rows[4].canonicalCharacters,320);
  // Long observations are deliberately not assumed: Root reads actual results
  // before choosing a product fix or admitting the separate L01 regression.
  assert.equal(db.prepare('SELECT value FROM path_fixture').get().value,'literal synthetic value');
 }finally{db.close();}
});

test('L01 production snapshotter preserves guarded canonical paths beyond MAX_PATH',async t=>{
 const root=fixture(t),backup=require('../delivery-tools/initial-patch-backup.cjs');
 // Run only after Root reviews D00 native backup + readback. Fixture creation
 // uses the observed native representation; production receives plain local
 // canonical paths and must retain its unchanged physical guards.
 for(const longSource of [false,true]){
  const databases=[];for(const module of ['sales','ledger','inventory']){
   const source=longSource?target(root,'source-'+module,320):path.join(root,'source-short-'+module+'.sqlite'),snapshot=target(root,'dest-'+longSource+'-'+module,340);
   const db=new sqlite.DatabaseSync(path.toNamespacedPath(source),{allowExtension:false});try{db.exec('CREATE TABLE path_fixture(value TEXT NOT NULL)');db.prepare('INSERT INTO path_fixture VALUES(?)').run('literal synthetic value');}finally{db.close();}
   plain(source,false);databases.push({module,source,snapshot});
  }
  const snapshot=backup.createNodeSqliteSnapshotter({sqlite,assertEngineApproved:()=>true}),proof=await snapshot({databases});assert.equal(proof.length,3);
  for(let i=0;i<databases.length;i++){const d=databases[i],p=proof[i];assert.equal(p.source,d.source);assert.equal(p.snapshot,d.snapshot);assert(!p.source.startsWith('\\\\'));assert(!p.snapshot.startsWith('\\\\'));assert.equal(p.readOnly,true);assert.equal(p.walConsistent,true);assert.equal(p.integrity,'ok');assert.equal(p.foreignKeyCount,0);readProof(d.snapshot,path.toNamespacedPath(d.snapshot));}
 }
});
