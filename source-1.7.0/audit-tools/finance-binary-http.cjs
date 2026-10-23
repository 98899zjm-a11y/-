'use strict';
// Root alone executes this Guest-only tool. No production profile/data or GUI.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
if(process.platform!=='win32'||ROOT.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1'||process.versions.electron!=='44.7.0'||process.env.ELECTRON_RUN_AS_NODE!=='1')throw Error('Fixed actual Guest and original Electron Node mode required');
const PINS={
 'stage1/guest-candidate-cdp.cjs':'59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32',
 'stage1/sandbox-context.py':'09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
 'stage1/validate-sandbox-context.py':'867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207',
 'project/desktop/legacy-modules.cjs':'6a47e0bfacbfca1bacc59e92b67cee0599b3010777a66eaa191c793a6ede1375',
 'project/desktop/legacy-release-context.cjs':'f23bde2322d06cd8a3d5b09761239d52e7cd79301bdcaafa66cbb9bacc50f0c1',
 'project/desktop/module-bundle.cjs':'a347f252accfb8f47bc09cd0070ce18a0a7ee250cbb9818f177f5d29ec247178',
 'project/desktop/release-layout.cjs':'480e6fa347ef7276b0b7a88c10dfcba32d64de44d6bfa6529c1fef12a7dd57b8',
 'project/desktop/erp-policy.cjs':'e2b12960405ac0f39a3bc8d8dec1c689972d12f89de2e8387d1cea6c968880e2',
 'project/desktop/module-ocr-lifecycle.cjs':'60f32f970be8cf9a4cfe19dc4b2a2b70e38630fc7d53f0b276aadae082eeeded',
};
function ordinary(file,{directory=false,missing=false}={}){
 assert(path.isAbsolute(file)&&!/^[/\\]{2}/.test(file)&&!/[\x00-\x1f]/.test(file));
 const absolute=path.resolve(file);assert(!absolute.slice(3).includes(':'));
 for(let p=absolute;;p=path.dirname(p)){if(fs.existsSync(p)){const s=fs.lstatSync(p);assert(!s.isSymbolicLink(),'Links refused');assert(!s.isFile()||s.nlink===1,'Hardlinks refused');if(p!==absolute)assert(s.isDirectory());}if(p===path.dirname(p))break;}
 if(!missing)assert(fs.existsSync(absolute),'Input missing');
 if(fs.existsSync(absolute)){const s=fs.lstatSync(absolute);assert(directory?s.isDirectory():s.isFile());assert.equal(fs.realpathSync.native(absolute).toLowerCase(),absolute.toLowerCase());}
 return absolute;
}
function read(file,max=4*1024*1024){ordinary(file);const a=fs.lstatSync(file,{bigint:true});assert(a.size<=BigInt(max));const fd=fs.openSync(file,'r');let bytes;try{const b=fs.fstatSync(fd,{bigint:true});bytes=fs.readFileSync(fd);const c=fs.fstatSync(fd,{bigint:true}),d=fs.lstatSync(file,{bigint:true});for(const k of ['dev','ino','size','mtimeNs','nlink']){assert.equal(a[k],b[k]);assert.equal(b[k],c[k]);assert.equal(c[k],d[k]);}for(const k of ['ctimeNs','birthtimeNs']){assert.equal(a[k],d[k]);assert.equal(b[k],c[k]);}assert.equal(BigInt(bytes.length),a.size);}finally{fs.closeSync(fd);}return bytes;}
for(const name of ['stage1/guest-candidate-cdp.cjs','stage1/sandbox-context.py','stage1/validate-sandbox-context.py'])assert.equal(sha(read(path.join(ROOT,name))),PINS[name]);
// Original actual-Guest proof precedes product imports, SQLite and all writes.
const actualContext=require(path.join(ROOT,'stage1/guest-candidate-cdp.cjs')).actualGuard();
assert.equal(globalThis.__xjyStage1Guard,undefined,'Release context must not bypass a Stage sandbox guard');
assert.equal(sha(read(process.execPath,256*1024*1024)),'db3ad2066a55546f9b6737da3c7f011370e4856fb36888055b544d45653e4f40','Original owned Electron executable required');
const argv=process.argv.slice(2),opts={};assert.equal(argv.length,6,'Three fixed option/value pairs required');
for(let i=0;i<argv.length;i+=2){assert(['--source-sha256','--candidate-run','--candidate-manifest-sha256'].includes(argv[i]));assert(!Object.hasOwn(opts,argv[i]));opts[argv[i]]=argv[i+1];}
assert(/^[a-f0-9]{64}$/.test(opts['--source-sha256']||''));assert.equal(sha(read(__filename)),opts['--source-sha256']);
assert(/^finance-repack-[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(opts['--candidate-run']||''));assert(/^[a-f0-9]{64}$/.test(opts['--candidate-manifest-sha256']||''));
const sourceBytes=new Map();for(const [name,pin]of Object.entries(PINS)){if(name.endsWith('.cjs')&&name.startsWith('project/')){const file=path.join(ROOT,name),body=read(file);assert.equal(sha(body),pin);sourceBytes.set(file,body);}}
const ORIGINAL=path.join(ROOT,'project/desktop/release-modules'),CANDIDATE=path.join(ROOT,'release-work',opts['--candidate-run'],'modules-input');
function input(directory,pin){ordinary(directory,{directory:true});const bytes=read(path.join(directory,'manifest.json'));assert.equal(sha(bytes),pin);const m=JSON.parse(bytes);assert.equal(m.version,1);assert(Array.isArray(m.modules));const ledger=m.modules.find(x=>x.id==='ledger');assert(ledger&&ledger.version==='1.3.0'&&ledger.runtimeMode==='onedir'&&ledger.purpose==='desktop-release'&&ledger.file==='xjy-ledger.exe');assert.equal(ledger.files.length,353);assert(/^[a-f0-9]{64}$/.test(ledger.sha256));return{directory,manifestSha256:pin,ledger};}
const original=input(ORIGINAL,'f58df7830fe5ba96ccdc36eb1e990c4b27880de7ea2c14c3c3b050617322f441'),candidate=input(CANDIDATE,opts['--candidate-manifest-sha256']);
assert.equal(original.ledger.sha256,'e3b15aa649f26c927dd90360458f7bd7ecbaa405c75a4ef241fae15c5360ff5c');assert.notEqual(candidate.ledger.sha256,original.ledger.sha256,'Candidate must be a distinct rebuilt EXE');
const cp=require('node:child_process'),http=require('node:http'),vm=require('node:vm'),Module=require('node:module'),{DatabaseSync}=require('node:sqlite');
const runRoot=ordinary(path.join(ROOT,'runtime','finance-http-'+crypto.randomUUID()),{directory:true,missing:true});assert(!fs.existsSync(runRoot));fs.mkdirSync(runRoot,{recursive:true});
const result={version:1,purpose:'finance-rebuilt-binary-real-http-only',passed:false,actualContext,runtime:{electron:process.versions.electron,node:process.versions.node,sqlite:process.versions.sqlite},fixtureRoot:runRoot,sourceSha256:opts['--source-sha256'],phases:[],violations:[],failures:[],productionFilesAccessed:false,physicalPrintingAssessed:false,engineUpgradeAssessed:false};
const actor=Object.freeze({module:'ledger',staffId:'fixture-finance-http',userId:'fixture-finance-http-admin',name:'虚构财务测试员',role:'admin',access:'manage',grantRevision:1});
const MONTH='2026-10',STAMP='2026-10-18 12:00:00';
const DANGER=[['=1+1',"'=1+1"],['+1+1',"'+1+1"],['-2+3',"'-2+3"],['@SUM(1,2)',"'@SUM(1,2)"],['\t=1+1',"'\t=1+1"],['\r=1+1',"'\r=1+1"],['\n=1+1',"'\n=1+1"],['  =1+1',"'  =1+1"]];
const NORMAL=['虚构员工甲','虚构员工甲'];
const expenseColumns=['date','employee','category','purpose','ticket','allowance','personal','amount','rule_version','payout','status','receipt_path','note','created_at','updated_at'];
const payrollColumns=['employee','month','inputs_json','outputs_json','basis_json','basis_hash','rule_version','status','note','created_at','updated_at'];
const expenseHeader=['日期','人员','类别','事由','票据金额','补贴','个人承担','报销金额','支付方式','状态','规则版本'];
const payrollHeader=['月份','人员','计薪方式','应发工资','扣款','实发工资','工资报销','本次支付','状态','规则版本'];
const originalCsv=new Map();
function database(data,fn){const file=ordinary(path.join(data,'ledger.db'));assert(path.relative(runRoot,file).startsWith('..')===false);const db=new DatabaseSync(file);try{return fn(db);}finally{db.close();}}
function snapshot(data){return database(data,db=>({expenses:db.prepare('SELECT * FROM expenses ORDER BY date,id').all(),payroll:db.prepare('SELECT * FROM payroll_records WHERE month=? ORDER BY employee').all(MONTH)}));}
function seed(data,danger){database(data,db=>{for(const [table,columns]of [['expenses',expenseColumns],['payroll_records',payrollColumns]]){const actual=new Set(db.prepare('PRAGMA table_info('+table+')').all().map(x=>x.name));for(const name of columns)assert(actual.has(name));assert.equal(db.prepare('SELECT count(*) AS n FROM '+table).get().n,0,'Factory-created finance table must be empty');}
 const e=db.prepare('INSERT INTO expenses('+expenseColumns.join(',')+') VALUES('+expenseColumns.map(()=>'?').join(',')+')'),p=db.prepare('INSERT INTO payroll_records('+payrollColumns.join(',')+') VALUES('+payrollColumns.map(()=>'?').join(',')+')');
 db.exec('BEGIN IMMEDIATE');try{for(const [raw]of [NORMAL,...(danger?DANGER:[])]){const plain=raw===NORMAL[0],purpose=plain?'普通中文,"引号"\n第二行':raw,inputs=JSON.stringify({mode:plain?'底薪+原提成':raw}),outputs=JSON.stringify({'应发工资':-123.5,'工资扣款':-2.25,'实发工资':-121.25,'本次支付':-116.75});e.run('2026-10-18',raw,'交通,餐饮',purpose,-12.5,1.25,2.5,-13.75,1,'单独支付','草稿','','',STAMP,STAMP);p.run(raw,MONTH,inputs,outputs,'{}','fixture-only-basis',1,'草稿','',STAMP,STAMP);}db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');});return snapshot(data);}
// Independent RFC4180-style assertion reader; no CSV export/sanitizer is copied.
function csv(bytes){assert(bytes.subarray(0,3).equals(Buffer.from([239,187,191])),'UTF-8 BOM required');const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes.subarray(3));assert(!text.startsWith('\ufeff'));const rows=[];let row=[],cell='',quoted=false,closed=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}if(c==='"'){assert(!cell&&!closed);quoted=true;}else if(c===','){row.push(cell);cell='';closed=false;}else if(c==='\r'||c==='\n'){if(c==='\r'){assert.equal(text[++i],'\n');}row.push(cell);rows.push(row);row=[];cell='';closed=false;}else{assert(!closed);cell+=c;}}
 assert(!quoted);assert(!row.length&&!cell&&!closed,'Complete CSV newline required');return rows;}
function expectedText(value){const found=DANGER.find(([raw])=>raw===value);return found?found[1]:value;}
function expected(before,kind,neutralized){const text=neutralized?expectedText:value=>value;if(kind==='expenses')return[expenseHeader,...before.expenses.map(x=>[x.date,text(x.employee),x.category,text(x.purpose),String(x.ticket),String(x.allowance),String(x.personal),String(x.amount),x.payout,x.status,String(x.rule_version)])];return[payrollHeader,...before.payroll.map(x=>{const a=JSON.parse(x.inputs_json),b=JSON.parse(x.outputs_json);return[MONTH,text(x.employee),text(a.mode),String(b['应发工资']),String(b['工资扣款']),String(b['实发工资']),'4.5',String(b['本次支付']),x.status,String(x.rule_version)];})];}
function exactDecimal(value,canonical){
 function rational(input){assert(typeof input==='string'&&input.length<=64);const m=/^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/.exec(input);assert(m,'Complete ordinary decimal string required; no trim, exponent or prefix parsing');return{n:BigInt(m[1]+m[2]+(m[3]||'')),scale:10n**BigInt((m[3]||'').length)};}
 const a=rational(value),b=rational(canonical);assert.equal(a.n*b.scale,b.n*a.scale,'CSV numeric value changed');
}
function assertRows(parsed,before,kind,neutralized,baseline){
 const wanted=expected(before,kind,neutralized),numeric=kind==='expenses'?[4,5,6,7]:[3,4,5,6,7];assert.equal(parsed.length,wanted.length);assert.equal(parsed.length,10,'One ordinary and eight dangerous fixture rows required');
 for(let r=0;r<wanted.length;r++){assert.equal(parsed[r].length,wanted[r].length);for(let c=0;c<wanted[r].length;c++){
  if(r>0&&numeric.includes(c))exactDecimal(parsed[r][c],wanted[r][c]);else assert.equal(parsed[r][c],wanted[r][c]);
  if(baseline){assert.equal(baseline[r].length,parsed[r].length);const explicitDanger=DANGER.some(([raw,escaped])=>baseline[r][c]===raw&&wanted[r][c]===escaped);if(!explicitDanger)assert.equal(parsed[r][c],baseline[r][c],'Unchanged CSV cell or original numeric format changed');}
 }}
 if(baseline){const ordinary=parsed.find(row=>row[1]===NORMAL[0]),old=baseline.find(row=>row[1]===NORMAL[0]);assert(ordinary&&old);assert.deepEqual(ordinary,old,'Ordinary CSV row must match original cell for cell');}
}
function direct(port,requestedPath,headers={}){return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port,path:requestedPath,method:'GET',headers,agent:false},response=>{let size=0;response.on('data',b=>{size+=b.length;if(size>65536)response.destroy(Error('Bounded negative-response limit'));});response.once('error',reject);response.once('end',()=>resolve(response.statusCode));});req.once('error',reject);req.setTimeout(3000,()=>req.destroy(Error('HTTP control timeout')));req.end();});}
async function phase(name,selected,danger){
 const root=path.join(runRoot,name);fs.mkdirSync(root);const profile=path.join(root,'profile'),runtimeDir=path.join(root,'module-code'),data=path.join(root,'data');fs.mkdirSync(profile);fs.mkdirSync(runtimeDir);
 const hostId=crypto.randomUUID(),entry=selected.ledger,seal=sha(Buffer.from(JSON.stringify(entry.files.slice().sort((a,b)=>a.path.localeCompare(b.path))))),executable=path.join(runtimeDir,'ledger-1.3.0-'+seal.slice(0,24),'xjy-ledger.exe');
 const phaseResult={name,passed:false,manifestSha256:selected.manifestSha256,exeSha256:entry.sha256,children:[],exports:[],checks:[],closeReturned:false,normalClose:false};result.phases.push(phaseResult);let server=null,api,before,phaseFailure=null;
 function failSpawn(reason){result.violations.push({phase:name,reason});throw Error(reason);}
 function spawn(file,args,options){
  if(typeof file!=='string'||path.resolve(file).toLowerCase()!==executable.toLowerCase())return failSpawn('Only the selected owned ledger EXE may spawn; taskkill refused');
  ordinary(file);assert.equal(sha(read(file,32*1024*1024)),entry.sha256);assert.deepEqual(options&&{windowsHide:options.windowsHide,shell:options.shell,stdio:options.stdio,cwd:options.cwd},{windowsHide:true,shell:false,stdio:'ignore',cwd:path.dirname(executable)});
  const init=JSON.stringify(args)===JSON.stringify(['--module','ledger','--initialize-only']);
  assert(init||args.length===6&&args[0]==='--module'&&args[1]==='ledger'&&args[2]==='--host'&&args[3]==='127.0.0.1'&&args[4]==='--port'&&/^\d+$/.test(args[5])&&Number(args[5])>=1024&&Number(args[5])<=65535&&Number(args[5])!==31831,'Only original fixed ledger arguments allowed');
  const env=options.env;assert(env&&typeof env.XJY_MODULE_TOKEN==='string'&&env.XJY_MODULE_TOKEN.length>=32);assert.equal(env.XJY_MODULE_CONTEXT_FILE,path.join(profile,'module-runtime','ledger','module-runtime-context.json'));
  assert(init?new RegExp('^\\.data\\.xjy-init-[a-f0-9-]{36}$').test(path.basename(env.LEDGER_DATA)):env.LEDGER_DATA===data);assert.equal(path.dirname(env.LEDGER_DATA),root);assert.equal(env.STOCKCHECK_DATA,undefined);
  for(const key of Object.keys(env))assert(!/^(NODE_OPTIONS|NODE_PATH|PYTHONPATH|PYTHONHOME|XJY_STAGE1_ROOT|XJY_STAGE1_NAMESPACE|XJY_DATA_DIR|NAPI_RS_NATIVE_LIBRARY_PATH)$/i.test(key));
  const child=cp.spawn(file,args,options),row={kind:init?'initialize':'server',pid:child.pid||null,exitCode:null,signal:null,exited:false};phaseResult.children.push(row);
  child.kill=()=>failSpawn('child.kill refused; preserve the owned failure');child.once('error',error=>{row.error=error.code||error.name;});child.once('exit',(code,signal)=>{row.exitCode=code;row.signal=signal;row.exited=true;});
  if(!init)server={port:Number(args[5]),token:env.XJY_MODULE_TOKEN,child};return child;
 }
 // Evaluate unmodified, hash-checked product bytes. Only child_process is DI.
 const cache=new Map(),builtins=new Set(['node:fs','node:path','node:crypto','node:http','node:net','node:sqlite']);
 function load(file){assert(sourceBytes.has(file),'Unreviewed product import refused');if(cache.has(file))return cache.get(file).exports;const m={exports:{}};cache.set(file,m);const req=id=>{if(id==='node:child_process')return Object.freeze({spawn});if(builtins.has(id))return require(id);assert(id.startsWith('./'));return load(path.resolve(path.dirname(file),id));};vm.runInThisContext(Module.wrap(sourceBytes.get(file).toString('utf8')),{filename:file})(m.exports,req,m,file,path.dirname(file));return m.exports;}
 const factory=load(path.join(ROOT,'project/desktop/legacy-modules.cjs'));api=factory.createLegacyModules({settingsFile:path.join(profile,'module-settings.json'),runtimeDir,packagedDir:selected.directory,releaseContext:{hostId,profileDir:profile}});
 try{
  await api.createData('ledger',data,{actor});assert.equal(phaseResult.children.length,1);assert(phaseResult.children[0].exited&&phaseResult.children[0].exitCode===0);phaseResult.checks.push('original-factory-initialize-exit0');before=seed(data,true);
  for(const [kind,url,filename]of [['expenses','/expenses/export.csv','expenses.csv'],['payroll','/payroll/export.csv?month='+MONTH,'payroll_'+MONTH+'.csv']]){
   const response=await api.proxy({module:'ledger',path:url,method:'GET'},{actor,getActor:async()=>actor});assert.equal(response.status,200);assert(/^text\/csv(?:;|$)/i.test(response.headers['content-type']));assert(/charset=utf-8/i.test(response.headers['content-type']));assert.equal(response.headers['content-disposition'],'attachment; filename='+filename);
   const bytes=Buffer.from(response.bodyBase64,'base64'),csvFile=path.join(root,kind+'-actual.csv');fs.writeFileSync(csvFile,bytes,{flag:'wx'});const exported={kind,status:response.status,contentType:response.headers['content-type'],contentDisposition:response.headers['content-disposition'],csvFile,bytes:bytes.length,sha256:sha(bytes)};phaseResult.exports.push(exported);
   const parsed=csv(bytes);exported.cells=parsed;const baseline=originalCsv.get(kind);if(danger)assert(baseline,'Original actual CSV baseline required');assertRows(parsed,before,kind,danger,baseline?.cells);if(!danger)originalCsv.set(kind,{sha256:sha(bytes),cells:parsed.map(row=>[...row])});else exported.originalCsvSha256=baseline.sha256;
   phaseResult.checks.push(kind+(danger?'-explicit-apostrophe-and-unchanged-cells-original-numeric-format':'-original-raw-danger-control-and-exact-decimal-semantics'));
   assert(server&&server.child.exitCode===null);assert.equal(await direct(server.port,url),403);assert.equal(await direct(server.port,url,{'x-xjy-module-token':server.token}),403);
   const signed=factory.signPrincipal(server.token,actor,url,'GET',Buffer.alloc(0));signed['x-xjy-principal-signature']='0'.repeat(64);assert.equal(await direct(server.port,url,{'x-xjy-module-token':server.token,...signed}),403);phaseResult.checks.push(kind+'-missing-token-missing-principal-bad-signature-403');
  }
  await assert.rejects(api.proxy({module:'ledger',path:'/expenses/export.csv',method:'GET'},{actor:{...actor,role:'employee',access:'disabled'}}),e=>e.status===403);phaseResult.checks.push('disabled-primary-actor-rejected');
 }catch(error){phaseFailure=error;phaseResult.firstFailure={message:error.message,status:api.status()};}finally{
  // Strict=true requests the real /_xjy/shutdown; it never authorizes force.
  try{await api.close({strict:true});phaseResult.closeReturned=true;}catch(error){result.failures.push({phase:name,stage:'strict-close',message:error.message});if(!phaseFailure)phaseFailure=error;}
 }
 if(phaseFailure)throw phaseFailure;
 assert.equal(phaseResult.children.length,2);for(const child of phaseResult.children){assert.equal(child.exited,true);assert.equal(child.exitCode,0);assert.equal(child.signal,null);}
 assert.deepEqual(snapshot(data),before,'CSV export must not modify stored finance values');assert(server);let closedPort=false;try{await direct(server.port,'/_xjy/health');}catch(error){assert.equal(error.code,'ECONNREFUSED');closedPort=true;}assert(closedPort,'Former owned service port must refuse connections');
 phaseResult.checks.push('finance-rows-unchanged-and-normal-server-exit0-port-refused');phaseResult.normalClose=true;phaseResult.passed=true;
}
async function main(){try{await phase('original-control',original,false);await phase('rebuilt-candidate',candidate,true);assert.equal(result.violations.length,0);result.passed=true;}catch(error){result.failures.push({stage:'main',message:error.message});process.exitCode=1;}finally{const file=path.join(runRoot,'result.json');fs.writeFileSync(file,JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify({passed:result.passed,resultFile:file,sha256:sha(fs.readFileSync(file)),phases:result.phases.map(x=>({name:x.name,passed:x.passed,normalClose:x.normalClose})),violationCount:result.violations.length,failureCount:result.failures.length}));}}
main().catch(error=>{process.exitCode=1;console.error('Finance HTTP tool failed:',error.name);});
