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
base.verify_fixed(HELPER_SHA,'36fcbe9c-ece1-4be3-af35-309a2ee19e05');base.pinned(Path(__file__),args.self_sha256)
output=Path('C:/xjy-results/cashier-directory-identity-a1.json');base.ordinary(output.parent,directory=True)
with output.open('x',encoding='utf-8') as stream:json.dump({'readOnlyDirectoryMetadata':True,'databaseOpened':False,'rows':rows},stream,indent=2)
print(json.dumps(rows))
