'use strict';
// Only toy constructors are used. No Electron import or hardware call.
const test=require('node:test'),assert=require('node:assert/strict');
const {createBlockedElectron,minimalPdf,captureObservedPage}=require('../stage1/guest-candidate-worker.cjs');
test('observer retries only the transient Viz snapshot and records every failed observation',async()=>{
 let calls=0,waits=0;const png=Buffer.from([137,80,78,71,13,10,26,10]);
 const r=await captureObservedPage(async()=>{if(++calls<3)throw Error('UnknownVizError');return {toPNG:()=>png};},async()=>{waits++;});
 assert.equal(r.image.toPNG(),png);assert.equal(r.attempts,3);assert.deepEqual(r.transientErrors,['UnknownVizError','UnknownVizError']);assert.equal(waits,2);
});
test('observer cannot hide a permanent screenshot failure or endlessly retry Viz',async()=>{
 let calls=0;await assert.rejects(captureObservedPage(async()=>{calls++;throw Error('unsafe document');},async()=>{}),/unsafe document/);assert.equal(calls,1);
 calls=0;await assert.rejects(captureObservedPage(async()=>{calls++;throw Error('UnknownVizError');},async()=>{}),/UnknownVizError/);assert.equal(calls,8);
});
test('observer defers its worker quit request until evidence is persisted without changing packaged identity',()=>{
 let quits=0;const actualApp={isPackaged:true,quit(){quits++;},whenReady(){assert.equal(this,actualApp);return Promise.resolve();}};
 const {electron,counters}=createBlockedElectron({app:actualApp,BrowserWindow:class{}});
 electron.app.quit();assert.equal(quits,0);assert.equal(counters.deferredWorkerQuitRequests,1);assert.equal(electron.app.isPackaged,true);
 actualApp.isPackaged=false;assert.equal(electron.app.isPackaged,false);electron.app.whenReady();assert.equal(quits,0);
});
test('Rejected actual guest guard exits before every Electron import including failure cleanup',async()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
 const filename=path.resolve(__dirname,'../stage1/guest-candidate-worker.cjs'),source=fs.readFileSync(filename,'utf8');
 const module={exports:{}},errors=[];let imports=0;
 const localRequire=name=>{if(name==='electron'){imports++;throw Error('No Electron import permitted in pure guard refusal probe');}if(name==='./guest-candidate-cdp.cjs')return{actualGuard(){throw Error('pure actual context refused');}};if(name.startsWith('node:'))return require(name);throw Error('Unexpected guard-refusal import '+name);};localRequire.main=module;
 const fakeProcess={versions:{},argv:[],exitCode:undefined};
 vm.runInNewContext(source,{require:localRequire,module,exports:module.exports,__dirname:path.dirname(filename),__filename:filename,process:fakeProcess,Buffer,console:{error:value=>errors.push(String(value)),log(){}}},{filename});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(fakeProcess.exitCode,1);assert.equal(imports,0);assert.ok(errors.some(text=>text.includes('pure actual context refused')));
});
test('Guest wrapper immutably refuses enumeration and submission before native delegation',()=>{
 let delegated=0;
 class ToyWindow{constructor(){this.webContents={print(){delegated++;},async getPrintersAsync(){delegated++;return[];}};}}
 const {electron,counters}=createBlockedElectron({BrowserWindow:ToyWindow});
 const window=new electron.BrowserWindow({});
 assert.throws(()=>window.webContents.print({},()=>{}),/blocked/i);
 assert.throws(()=>window.webContents.getPrintersAsync(),/blocked/i);
 assert.equal(counters.deviceApiCalls,2);assert.equal(counters.nativeDelegations,0);assert.equal(delegated,0);
 assert.throws(()=>{window.webContents.print=()=>delegated++;});
 assert.throws(()=>{delete window.webContents.getPrintersAsync;});
});
test('Guest PDF fixture has actual objects, stream, xref offsets and EOF',()=>{
 const bytes=minimalPdf(),text=bytes.toString('ascii');
 assert.match(text,/^%PDF-1\.4/);assert.match(text,/\/Type \/Page /);assert.match(text,/\(Fictitious candidate print\) Tj/);assert.match(text,/%%EOF\n$/);
 const offset=Number(/startxref\n([0-9]+)/.exec(text)[1]);assert.equal(text.slice(offset,offset+4),'xref');
 const xref=text.slice(offset).split('\n');for(let id=1;id<=5;id++){const position=Number(xref[2+id].slice(0,10));assert.equal(text.slice(position,position+7),id+' 0 obj');}
});
