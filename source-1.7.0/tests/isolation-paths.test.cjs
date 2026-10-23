'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const project=path.resolve(__dirname,'..'),fixture=path.join(project,'data','path-guard-fixture');fs.mkdirSync(fixture,{recursive:true});
let api;try{api=require('../stage1/isolation.cjs');}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}
test('isolation guard exists before any database initialization',()=>assert.equal(typeof api?.createIsolationGuard,'function'));
test('canonical boundary rejects production, URI, device, drive-relative and sibling-prefix paths',()=>{
 assert.ok(api?.createIsolationGuard,'isolation entry missing');const guard=api.createIsolationGuard(fixture);
 for(const target of ['F:\\鑫金源珠宝资料\\工作室数据\\jewelry.sqlite','f:\\鑫金源珠宝资料\\内帐\\ledger.db','file:///F:/鑫金源珠宝资料/库管/stockcheck.db','F:ledger.db','\\\\server\\share\\data.db','\\\\?\\F:\\data.db',fixture+'-other\\data.db',path.join(fixture,'stream.db')+':hidden'])assert.throws(()=>guard.assertPath(target),/ISOLATION/);
 assert.equal(guard.assertPath(path.join(fixture,'new','owned.sqlite')),path.join(fixture,'new','owned.sqlite'));
 assert.equal(guard.assertPath(fixture.toUpperCase()),fs.realpathSync.native(fixture));
});
test('a junction within the root and hard-linked files are refused before data IO',()=>{
 assert.ok(api?.createIsolationGuard,'isolation entry missing');const guard=api.createIsolationGuard(fixture),outside=path.join(project,'tests','fake-external-files');fs.mkdirSync(outside,{recursive:true});
 const external=path.join(outside,'fake.txt');fs.writeFileSync(external,'synthetic sentinel');const junction=path.join(fixture,'junction');if(!fs.existsSync(junction))fs.symlinkSync(outside,junction,'junction');assert.throws(()=>guard.assertPath(path.join(junction,'fake.txt')),/ISOLATION/);
 const link=path.join(fixture,'hardlink.txt');if(!fs.existsSync(link))fs.linkSync(external,link);assert.throws(()=>guard.assertPath(link),/ISOLATION/);assert.equal(fs.readFileSync(external,'utf8'),'synthetic sentinel');
});
test('all environment/config data roots are checked and unsafe input never falls back to F drive',()=>{
 assert.ok(api?.createIsolationGuard,'isolation entry missing');const guard=api.createIsolationGuard(fixture);
 assert.throws(()=>guard.validateLayout({dataDir:path.join(fixture,'sales'),ledgerDir:'F:\\鑫金源珠宝资料\\内帐',inventoryDir:path.join(fixture,'inventory')}),/ISOLATION/);
 assert.throws(()=>guard.validateLayout({dataDir:path.join(fixture,'sales')}),/ISOLATION/);
 assert.throws(()=>guard.validatePort(31831,'127.0.0.1'),/ISOLATION/);assert.throws(()=>guard.validatePort(31881,'0.0.0.0'),/ISOLATION/);assert.equal(guard.validatePort(0,'127.0.0.1'),0);
});
