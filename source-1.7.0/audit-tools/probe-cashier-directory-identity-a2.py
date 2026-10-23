"""Read only directory identity metadata in the one admitted fictional case."""
import os,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
if os.name!='nt' or str(ROOT).lower().replace('\\','/')!='c:/xjy-work/xjy-web-stage1' or not sys.flags.isolated or not sys.flags.no_site or not sys.flags.dont_write_bytecode:
    raise RuntimeError('Only fixed offline Guest Python -I -B -S')
import hashlib,json,subprocess,types,argparse
HELPER='audit-tools/run-finance-erp170-red-a1.py';HELPER_SHA='1f7ab3485de1260db7e0762175b7a15fcafc2d4c942f3adf7d40142a267f1e2e'
p=argparse.ArgumentParser();p.add_argument('--self-sha256',required=True);args=p.parse_args()
raw=(ROOT/HELPER).read_bytes()
if hashlib.sha256(raw).hexdigest()!=HELPER_SHA:raise RuntimeError('Original helper changed')
base=types.ModuleType('identity_probe_guard');base.__file__=str(ROOT/HELPER);exec(compile(raw,base.__file__,'exec',dont_inherit=True),base.__dict__)
base.pinned(Path(__file__),args.self_sha256);base.verify_fixed(HELPER_SHA,'36fcbe9c-ece1-4be3-af35-309a2ee19e05')
case=ROOT/'runtime/cashier-native-maintenance170/7f125473-b7f7-42ea-9f56-985b9ed3dda2'
base.ordinary(case,directory=True)
targets={'ledger':case/'ledger'}
for label,folder in [('stageRoot',case/'runtime/restore-stage'),('job',case/'runtime/restorations')]:
    base.ordinary(folder,directory=True);items=list(folder.iterdir())
    if len(items)!=1:raise RuntimeError('Expected exact failed case directory')
    base.ordinary(items[0],directory=True);targets[label]=items[0]
targets['stageLedger']=targets['stageRoot']/'ledger'
before={name:base.ordinary(file,directory=True) for name,file in targets.items()}
javascript="const fs=require('node:fs');const p=JSON.parse(process.argv[1]);console.log(JSON.stringify(Object.fromEntries(Object.entries(p).map(([k,v])=>{const s=fs.statSync(v,{bigint:true});if(!s.isDirectory())throw Error('Expected directory');return[k,{dev:String(s.dev),ino:String(s.ino)}];}))));"
node=base.pinned(base.NODE,base.NODE_SHA) if hasattr(base,'NODE_SHA') else None
result=subprocess.run([str(base.NODE),'-e',javascript,json.dumps({k:str(v) for k,v in targets.items()})],cwd=ROOT,capture_output=True,encoding='utf-8',check=True,creationflags=0x08000000)
nodes=json.loads(result.stdout);rows={}
for name,file in targets.items():
    after=base.ordinary(file,directory=True);first=before[name]
    if (first.st_dev,first.st_ino)!=(after.st_dev,after.st_ino):raise RuntimeError('Directory changed during observation')
    rows[name]={'node':nodes[name],'python':{'dev':str(after.st_dev),'ino':str(after.st_ino)}}
import ast,uuid
context_source=base.pinned(ROOT/'project/desktop/legacy-source/desktop_runtime_context.py','6aeea452965d1b198a779cde81a06faee7baf861e020315b364663ceb32e4744')
context_module=types.ModuleType('desktop_runtime_context');context_module.__file__=str(ROOT/'project/desktop/legacy-source/desktop_runtime_context.py')
exec(compile(context_source,context_module.__file__,'exec',dont_inherit=True),context_module.__dict__);sys.modules['desktop_runtime_context']=context_module
worker=base.pinned(ROOT/'project/desktop/legacy-source/ledger/cashier_maintenance.py','9a48976469dc72105cd30149b8a85848e1dec6048ad896584e4a58a6fa6b1839')
function=[n for n in ast.parse(worker).body if isinstance(n,ast.FunctionDef) and n.name=='node_directory_identity']
if len(function)!=1:raise RuntimeError('Exact current identity function required')
namespace={'os':os};exec(compile(ast.Module(body=function,type_ignores=[]),'<exact-current-node-directory-identity>','exec',dont_inherit=True),namespace)
for name,file in targets.items():
    actual=namespace['node_directory_identity'](file)
    if actual!=nodes[name]:raise AssertionError('Current native identity differs from actual Node bigint stat: '+name)
    rows[name]['native']=actual
private=ROOT/'runtime'/('cashier-identity-negative-'+str(uuid.uuid4()));base.ordinary(private.parent,directory=True);private.mkdir();original=private/'original';original.mkdir()
first=namespace['node_directory_identity'](original);original.rename(private/'retained');original.mkdir()
if namespace['node_directory_identity'](original)==first:raise AssertionError('Replacement directory reused identity')
if namespace['node_directory_identity'](private/'retained')!=first:raise AssertionError('Renamed original lost identity')
base.verify_fixed(HELPER_SHA,'36fcbe9c-ece1-4be3-af35-309a2ee19e05');base.pinned(Path(__file__),args.self_sha256)
output=Path('C:/xjy-results/cashier-directory-identity-a2.json');base.ordinary(output.parent,directory=True)
with output.open('x',encoding='utf-8') as stream:json.dump({'existingCaseReadOnly':True,'databaseOpened':False,'nativeMatchesNode':True,'replacementRejectedByIdentity':True,'originalRenamePreservesIdentity':True,'rows':rows},stream,indent=2)
print(json.dumps(rows))
