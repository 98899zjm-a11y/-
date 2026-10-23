'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const id = '46b24d66-14a8-4ec0-9f89-2b9e10673c1b';
const grants = (keys, level='manage') => ({moduleAccess:{ledger:level},capabilities:Object.fromEntries(keys.map(k=>[k,true]))});

test('ERP canonical allowlist rejects aliases, unknown queries and unsupported writes', () => {
  const {routeFor} = require('../project/desktop/erp-policy.cjs');
  assert.equal(routeFor('/erp/api/reports?asOf=2026-10-14&partyId=SUP%3A2', 'GET').operation, 'report');
  assert.equal(routeFor('/erp/api/documents/'+id+'/review', 'POST').operation, 'review');
  for(const uri of ['/erp','/erp//api/bootstrap','/erp/%61pi/bootstrap','/erp/api/../api/bootstrap','/erp/api/bootstrap?actor=admin','/erp/api/reports?asOf=a&asOf=b','/erp/static/../secret.key','/erp/static/a%2f.js']) assert.throws(()=>routeFor(uri,'GET'));
  assert.throws(()=>routeFor('/erp/api/documents/'+id,'DELETE'));
  assert.throws(()=>routeFor('/erp/static/erp.js','POST'));
});

test('ERP write permissions require live fine grants and sensitive access without admin browser claims', () => {
  const {authorizeRequest,capabilitiesFor} = require('../project/desktop/erp-policy.cjs');
  const input={module:'ledger',path:'/erp/api/documents',method:'POST',bodyBase64:Buffer.from(JSON.stringify({kind:'purchase'})).toString('base64'),headers:{'content-type':'application/json'}};
  assert.throws(()=>authorizeRequest(input,grants(['erp.read','erp.purchase.prepare'])),e=>e.status===403);
  assert.doesNotThrow(()=>authorizeRequest(input,grants(['erp.read','erp.purchase.prepare','erp.reports.sensitive'],'operate')));
  assert.throws(()=>authorizeRequest(input,grants(['erp.read','erp.purchase.prepare','erp.reports.sensitive'],'view')),e=>e.status===403);
  assert.throws(()=>authorizeRequest({...input,module:'inventory'},grants(['erp.read','erp.purchase.prepare','erp.reports.sensitive'])),e=>e.status===403);
  assert.throws(()=>authorizeRequest({...input,headers:{},bodyBase64:''},grants(['erp.read','erp.purchase.prepare','erp.reports.sensitive'])));
  assert.deepEqual(capabilitiesFor(grants(['erp.read','erp.purchase.review','erp.reports.sensitive'],'operate')),['erp.read','erp.reports.sensitive']);
  assert.throws(()=>authorizeRequest({module:'ledger',path:'/erp/api/documents/'+id+'/review',method:'POST',headers:{'content-type':'application/json'},bodyBase64:Buffer.from('{}').toString('base64')},grants(['erp.read','erp.purchase.prepare'])),e=>e.status===403);
});

test('ERP capability catalog defaults employees to no grants and fixes the module minimums', () => {
  const {CAPABILITIES}=require('../project/desktop/administration.cjs');
  const erp=CAPABILITIES.filter(item=>item.key.startsWith('erp.'));
  assert.equal(erp.length,15);assert.equal(new Set(erp.map(item=>item.key)).size,15);
  assert.ok(erp.every(item=>item.module==='ledger'&&item.default===false));
  assert.ok(erp.filter(item=>item.key.endsWith('.review')).every(item=>item.level==='manage'));
});

test('only ERP principals carry strictly validated signed protocol version 2 capabilities', () => {
  const {signPrincipal} = require('../project/desktop/legacy-modules.cjs');
  const actor={module:'ledger',staffId:'staff-a',userId:'user-a',name:'Synthetic preparer',role:'employee',access:'operate',grantRevision:3,protocolVersion:2,capabilities:['erp.read','erp.purchase.prepare','erp.reports.sensitive']};
  const headers=signPrincipal('fake-token-not-a-secret',actor,'/erp/api/documents','POST',Buffer.from('{}'),1000);
  const principal=JSON.parse(Buffer.from(headers['x-xjy-principal'],'base64url'));
  assert.equal(principal.protocolVersion,2);
  assert.deepEqual(principal.capabilities,actor.capabilities);
  assert.equal(headers['x-xjy-principal-signature'],crypto.createHmac('sha256','fake-token-not-a-secret').update(headers['x-xjy-principal']).digest('hex'));
  const ordinary=JSON.parse(Buffer.from(signPrincipal('fake-token-not-a-secret',actor,'/sales','GET',Buffer.alloc(0),1000)['x-xjy-principal'],'base64url'));
  assert.equal(ordinary.v,1);assert.equal(ordinary.protocolVersion,undefined);assert.equal(ordinary.capabilities,undefined);
  assert.throws(()=>signPrincipal('fake', {...actor,capabilities:['erp.read','shell.execute']},'/erp/','GET',Buffer.alloc(0)),e=>e.status===403);
  assert.throws(()=>signPrincipal('fake', {...actor,protocolVersion:undefined},'/erp/','GET',Buffer.alloc(0)),e=>e.status===403);
});

test('ERP browser adapter forwards exact business paths and preserves binary responses safely', async () => {
  const {createErpAdapter} = require('../stage1/erp-web-adapter.cjs');
  const seen=[]; const adapter=createErpAdapter({dispatch:async input=>{seen.push(input);return {ok:true,status:200,data:{status:200,headers:{'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','set-cookie':'legacy-cookie','content-disposition':'attachment; filename=report.xlsx'},bodyBase64:Buffer.from('synthetic-binary').toString('base64')}};}});
  const result=await adapter({path:'/erp/api/export.xlsx?asOf=2026-10-14',method:'GET'});
  assert.equal(seen[0].path,'/api/internal-modules/proxy');assert.equal(seen[0].body.module,'ledger');
  assert.equal(result.bytes.toString(),'synthetic-binary');assert.equal(result.headers['set-cookie'],undefined);
  await assert.rejects(adapter({path:'/erp/api/export.xlsx?unknown=x',method:'GET'}));
  await adapter({path:'/erp/api/parties',method:'POST',body:{requestId:id,kind:'supplier',name:'虚构供应商'}});
  assert.equal(seen[1].body.headers['content-type'],'application/json');
  assert.equal(JSON.parse(Buffer.from(seen[1].body.bodyBase64,'base64')).name,'虚构供应商');
  const unsafe=createErpAdapter({dispatch:async()=>({ok:true,data:{status:200,headers:{'content-type':'application/pdf','content-disposition':'inline; filename=receipt.pdf'},bodyBase64:Buffer.from('fake-pdf').toString('base64')}})});
  assert.match((await unsafe({path:'/erp/api/attachments/'+id,method:'GET'})).headers['content-disposition'],/^attachment/);
});

test('Python signature verifier rejects ERP v1 and capability overclaims before any database access', () => {
  const {spawnSync}=require('node:child_process');
  const code=String.raw`import ast,base64,hashlib,hmac,json,pathlib,re,threading,time
source=pathlib.Path('project/desktop/legacy-source/sidecar.py').read_text(encoding='utf-8')
tree=ast.parse(source)
selected=[node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name in ('principal_actor','erp_authority') or isinstance(node,ast.Assign) and any(isinstance(target,ast.Name) and target.id.startswith('ERP_') for target in node.targets)]
exec(compile(ast.Module(body=selected,type_ignores=[]),'<pure-sidecar-authority>','exec'))
class Args(dict):
    def getlist(self,key):return self[key] if isinstance(self[key],list) else [self[key]]
class Req:
    method='GET';path='/erp/';query_string=b''
    endpoint='erp.page';args=Args();content_type=None
    def get_data(self,cache=True):return b''
req=Req()
base=dict(v=1,module='ledger',staffId='test-a',userId='user-a',name='Synthetic',role='employee',access='view',grantRevision=2,issuedAt=1000000,expiresAt=1030000,nonce='46b24d66-14a8-4ec0-9f89-2b9e10673c1b',method='GET',decodedPath='/erp/',query='',bodySha256=hashlib.sha256(b'').hexdigest())
def run(actor):
    encoded=base64.urlsafe_b64encode(json.dumps(actor).encode()).decode().rstrip('=')
    req.headers={'X-XJY-Principal':encoded,'X-XJY-Principal-Signature':hmac.new(b'test-only-token',encoded.encode(),hashlib.sha256).hexdigest()}
    return principal_actor('test-only-token','ledger',req,{},threading.Lock(),clock=lambda:1000.0)
def rejects(actor):
    try:run(actor)
    except ValueError:return
    raise AssertionError('Unsafe ERP principal accepted')
rejects(base)
valid={**base,'protocolVersion':2,'capabilities':['erp.read']}
assert run(valid)['capabilities']==['erp.read']
assert erp_authority(req,valid) is None
req.path='/erp/api/reports';req.endpoint='erp.reports'
try:erp_authority(req,valid)
except ValueError:pass
else:raise AssertionError('Reports lack capability but passed')
valid_report={**valid,'capabilities':['erp.read','erp.reports.view']}
assert erp_authority(req,valid_report) is None
req.args=Args(asOf=['2026-10-14','2026-10-13'])
try:erp_authority(req,valid_report)
except ValueError:pass
else:raise AssertionError('Repeated query was accepted')
req.path='/erp/';req.endpoint='erp.page';req.args=Args()
for values in (['erp.read','shell.execute'],['erp.read','erp.read'],['erp.read','erp.purchase.review'],[True],[]):rejects({**valid,'capabilities':values})
rejects({**valid,'protocolVersion':True})
req.path='/sales';base['decodedPath']='/sales'
assert run(base)['v']==1
rejects({**base,'protocolVersion':2,'capabilities':['erp.read']})
print('pure Python authority verification passed')`;
  const result=spawnSync('C:\\Python314\\python.exe',['-B','-c',code],{cwd:require('node:path').resolve(__dirname,'..'),encoding:'utf8'});
  assert.equal(result.status,0,result.stderr||result.stdout);
});
