'use strict';
// One-use build-time edit of the owned acceptance runner, no runtime imports.
const fs=require('node:fs'),path=require('node:path'),g=require('./isolation.cjs').createIsolationGuard(path.resolve(__dirname,'..'));
const file=g.assertPath(path.join(__dirname,'candidate-maintenance-probe.cjs'));let body=fs.readFileSync(file,'utf8');
const changes=[
 ["const before='owned-before-'", "const quote=await ensurePrintQuote(request);const before='owned-before-'"],
 ["markers(files,after);", "evidence.postBackupPrint=await submitFictitiousPrint(request,quote.id);markers(files,after);"],
 ["printing=retained(files),browser=await browserSession();", "printing=retained(files),browser=await browserSession();if(!Object.entries(printing).some(([name,digest])=>name.endsWith('.central-print-ledger.json')&&typeof digest==='string'))throw Error('Real post-backup central printing knowledge was not observed');"],
 ["evidence.printingRetained=printing;", "evidence.printingRetained=Object.fromEntries(Object.entries(printing).map(([name,sha256])=>[name,{present:sha256!==null,sha256}]));evidence.postBackupCentralPrintRecordPreserved=true;"]
];
for(const [before,after]of changes){if(body.split(before).length!==2)throw Error('Exact owned edit precondition absent');body=body.replace(before,after);}fs.writeFileSync(file,body);process.stdout.write('Owned acceptance runner fixture/output/policy adjustment completed\n');
