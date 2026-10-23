'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {createBackend}=require('../project/desktop/backend.cjs');
// Creates only an explicitly owned empty directory; all synthetic business SQL and images stay in memory.
async function fixture(t){
  const ownedRoot=path.resolve(__dirname,'../runtime/employee-profile-tests');fs.mkdirSync(ownedRoot,{recursive:true});const directory=fs.mkdtempSync(path.join(ownedRoot,'owned-'));
  const db=new DatabaseSync(':memory:'),migrations=path.resolve(__dirname,'../project/desktop/migrations');for(const file of fs.readdirSync(migrations).filter(file=>/^\d+_[\w-]+\.sql$/.test(file)).sort())db.exec(fs.readFileSync(path.join(migrations,file),'utf8'));
  db.exec('CREATE TABLE local_accounts(staff_id TEXT PRIMARY KEY,username TEXT UNIQUE,password_salt TEXT,password_hash TEXT,created_at TEXT,updated_at TEXT)');
  const runtime={sqlite:db,dataDir:directory,env:{BUCKET:{put:async()=>{},get:async()=>null,delete:async()=>{}}},withIdentity:(_identity,action)=>action(),close:()=>{}},businessCore={};
  const backend=createBackend({dataDir:directory,migrationDir:migrations,runtimeFactory:()=>runtime,businessCore,pollsAdapter:{},aiAdapter:{}});
  t.after(async()=>{await backend.close();db.close();});
  const setup=await backend.dispatch({path:'/auth/setup',method:'POST',body:{username:'fictional-admin',password:'Synthetic-Only-2026!',name:'虚构管理员'}});assert.equal(setup.status,200);
  const staff=await backend.dispatch({path:'/api/users',method:'POST',body:{username:'fictional-employee',password:'Synthetic-Only-2026!',name:'虚构员工'}});assert.equal(staff.status,201);
  const id=staff.data.user.id;db.prepare("INSERT OR REPLACE INTO module_permissions(staff_id,sales,ledger,inventory,revision,updated_at) VALUES(?,'disabled','disabled','disabled',1,?)").run(id,'2026-10-14T00:00:00Z');
  const employee=backend.createSession({sourcePeer:'owned-fixture'});assert.equal((await employee.dispatch({path:'/auth/login',method:'POST',body:{username:'fictional-employee',password:'Synthetic-Only-2026!'}})).status,200);
  return {backend,employee,id,db};
}
test('real backend profile routing works before the sales gate and formats rejected mutations as normal API errors',async t=>{
  const f=await fixture(t);const directory=await f.employee.dispatch({path:'/api/employee-profiles'});assert.equal(directory.status,200);assert.equal(directory.data.profiles.length,2);
  const update=await f.employee.dispatch({path:'/api/employee-profiles/'+f.id,method:'PATCH',body:{revision:0,age:28,bio:'虚构简介'}});assert.equal(update.status,200);assert.equal(update.data.profile.age,28);
  const rejected=await f.employee.dispatch({path:'/api/employee-profiles/'+f.id,method:'PATCH',body:{revision:1,orderCount:999}}).catch(()=>({status:'unhandled rejection'}));assert.equal(rejected.status,400);assert.equal(rejected.ok,false);
  assert.equal((await f.employee.dispatch({path:'/api/employee-profiles/'+f.id,method:'PATCH',body:{revision:0,age:29}})).status,409);
  assert.equal((await f.employee.dispatch({path:'/api/employee-profiles'})).data.profiles.find(p=>p.staffId===f.id).age,28);
  await f.employee.dispatch({path:'/auth/logout',method:'POST'});assert.equal((await f.employee.dispatch({path:'/api/employee-profiles'})).status,401);
});
