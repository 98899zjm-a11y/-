'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {fixture,asar}=require('./employee-update-fixtures.cjs');
const {admitRelease}=require('../project/desktop/release-admission.cjs');
test('packaged Sandbox admits only its owned ordinary single-link app.asar code target after actual proof',async t=>{
 const f=await fixture(t),archive=path.join(f.install,'resources/app.asar');await fs.writeFile(path.join(f.root,'isolation-identity.json'),'{}');await fs.writeFile(archive,asar('1.6.0'));let calls=0;const result=admitRelease({isPackaged:true,codeDir:archive,environment:{XJY_RELEASE_TEST_ROOT:f.root,XJY_DATA_DIR:path.join(f.root,'data/sales')},validateSandbox:()=>{calls++;return {sandbox:true};}});assert.equal(result.mode,'sandbox');assert.equal(calls,1);
});
test('archive allowance cannot relax data targets, unpackaged files, other names, hardlinks or escaped parents',async t=>{
 const f=await fixture(t),archive=path.join(f.install,'resources/app.asar');await fs.writeFile(path.join(f.root,'isolation-identity.json'),'{}');await fs.writeFile(archive,asar('1.6.0'));const base={isPackaged:true,codeDir:archive,environment:{XJY_RELEASE_TEST_ROOT:f.root,XJY_DATA_DIR:path.join(f.root,'data/sales')},validateSandbox:()=>({sandbox:true})};assert.equal(admitRelease(base).mode,'sandbox');assert.throws(()=>admitRelease({...base,isPackaged:false}));const other=path.join(f.install,'resources/other.asar');await fs.copyFile(archive,other);assert.throws(()=>admitRelease({...base,codeDir:other}));assert.throws(()=>admitRelease({...base,environment:{...base.environment,XJY_DATA_DIR:archive}}));await fs.link(archive,path.join(f.root,'linked-app.asar'));assert.throws(()=>admitRelease(base));
});
