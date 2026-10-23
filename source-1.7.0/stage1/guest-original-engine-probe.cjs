'use strict';
// Runs only after the Python driver actual-context gate. Rechecks before SQLite.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),EXPECTED=path.resolve('C:/xjy-work/xjy-web-stage1');
function guard(){
 if(process.platform!=='win32'||ROOT.toLowerCase()!==EXPECTED.toLowerCase())throw Error('Actual Sandbox fixed guest root required before SQLite probe');
 const p=spawnSync('C:/Python314/python.exe',['-I','-B',path.join(ROOT,'stage1/validate-sandbox-context.py')],{cwd:ROOT,encoding:'utf8',windowsHide:true,shell:false,timeout:30000});
 if(p.error||p.status!==0)throw Error('Actual Sandbox context refused before engine capability probe');
 const proof=JSON.parse(p.stdout);if(proof.model!=='Virtual Machine'||proof.productionDrivePresent!==false||proof.nonLoopbackAddressCount!==0||!proof.userName.toLowerCase().endsWith('\\wdagutilityaccount'))throw Error('Actual guest proof invalid');return proof;
}
async function main(){
 const actualContext=guard(),dir=path.resolve(process.argv[2]||'');
 if(dir!==path.join(ROOT,'runtime/candidate-engine-probe'))throw Error('Only fixed fake scratch accepted');
 for(let p=dir;;p=path.dirname(p)){if(fs.existsSync(p)&&fs.lstatSync(p).isSymbolicLink())throw Error('Fake scratch link refused');if(p===ROOT)break;if(p===path.dirname(p))throw Error('Fake scratch owned root unavailable');}
 const result={actualContext,nodeVersion:process.versions.node,electronVersion:process.versions.electron||null,runAsNodeObserved:process.env.ELECTRON_RUN_AS_NODE==='1'&&process.type===undefined,backupSupported:false,backupIntegrity:null,sourcePolicyCapabilitiesEligible:false};
 if(!result.runAsNodeObserved){console.log(JSON.stringify(result));return 1;}
 let sqlite;try{sqlite=require('node:sqlite');}catch(error){result.error=error.message;console.log(JSON.stringify(result));return 1;}
 result.sqliteVersion=process.versions.sqlite||null;
 if(typeof sqlite.DatabaseSync!=='function'||typeof sqlite.backup!=='function'){result.error='Original engine node:sqlite backup API unavailable';console.log(JSON.stringify(result));return 1;}
 const source=path.join(dir,'source-fictitious.sqlite'),target=path.join(dir,'backup-fictitious.sqlite');
 if(fs.existsSync(source)||fs.existsSync(target))throw Error('Fresh fake SQLite files required');
 const database=new sqlite.DatabaseSync(source);let copy;
 try{database.exec('CREATE TABLE engine_probe(id INTEGER PRIMARY KEY,value TEXT NOT NULL)');database.prepare('INSERT INTO engine_probe(value) VALUES(?)').run('fictitious engine capability row');await sqlite.backup(database,target);copy=new sqlite.DatabaseSync(target);const integrity=copy.prepare('PRAGMA integrity_check').get();result.backupIntegrity=Object.values(integrity)[0];result.backupSupported=copy.prepare('SELECT value FROM engine_probe WHERE id=1').get().value==='fictitious engine capability row'&&result.backupIntegrity==='ok';result.sourcePolicyCapabilitiesEligible=result.backupSupported;}finally{copy?.close();database.close();}
 console.log(JSON.stringify(result));return result.backupSupported?0:1;
}
if(require.main===module)main().then(code=>{process.exitCode=code;}).catch(error=>{console.error(error.stack||String(error));process.exitCode=1;});
module.exports={guard};
