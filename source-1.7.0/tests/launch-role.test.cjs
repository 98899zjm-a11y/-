'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),guard=require('../stage1/isolation.cjs').createIsolationGuard(root);
const fixture=guard.assertPath(path.join(root,'data','role-fixtures'));fs.mkdirSync(fixture,{recursive:true});
const{resolveLaunchRole}=require('../project/desktop/launch-role.cjs');
test('an available F-like USB drive is not evidence of a host',()=>{
 const result=resolveLaunchRole({preferredRoot:fixture,preferredDriveAvailable:true,clientProfiles:[]});
 assert.equal(result.employeeClient,true);
});
test('saved employee mode wins even when a drive contains a copied workspace file',()=>{
 const target=guard.assertPath(path.join(fixture,'with-file')),profile=guard.assertPath(path.join(fixture,'employee-profile'));fs.mkdirSync(path.join(target,'工作室数据'),{recursive:true});fs.mkdirSync(profile,{recursive:true});
 fs.writeFileSync(guard.assertPath(path.join(target,'工作室数据','jewelry.sqlite')),'SYNTHETIC FILE-EXISTENCE FIXTURE, NOT SQLite');
 fs.writeFileSync(guard.assertPath(path.join(profile,'launch-role.json')),JSON.stringify({role:'employee'}));
 assert.equal(resolveLaunchRole({preferredRoot:target,clientProfiles:[profile]}).employeeClient,true);
});
test('a fresh host requires an explicit host decision',()=>{
 assert.equal(resolveLaunchRole({preferredRoot:fixture,explicitHost:true,clientProfiles:[]}).employeeClient,false);
});
