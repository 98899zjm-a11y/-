"""Read compiled code data only; retain exact original 18-field comparison."""
import os, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
if os.name != 'nt' or str(ROOT).lower().replace('\\','/') != 'c:/xjy-work/xjy-web-stage1' or not sys.flags.isolated or not sys.flags.no_site or not sys.flags.dont_write_bytecode:
    raise RuntimeError('Fixed actual Guest Python -I -B -S required')
import argparse, ast, hashlib, json, marshal, struct, types
HELPER='audit-tools/run-finance-erp170-red-a1.py';HELPER_SHA='1f7ab3485de1260db7e0762175b7a15fcafc2d4c942f3adf7d40142a267f1e2e'
COMPARATOR='audit-tools/finance-repack.py';COMPARATOR_SHA='d630f373911715b3ef5ee80e6fbaeaae838c1469ab53f44759813bc066cf69a7'
PINS='audit-tools/ledger170-guarded-build-source-pins-a3.json';PINS_SHA='0136f3c279923c52a6507e1a16ecf54cf2a75c6d707f7c75be170a2694c46ea7'
OLD=ROOT/'runtime/ledger170-adopt-a1/previous-ledger/xjy-ledger.exe';OLD_SHA='214843e59dcb107b45e508542227311c8a2aaa62c8839df992795d5a78b9e191'
NEW=ROOT/'runtime/ledger170-guarded-build-a3/dist/xjy-ledger/xjy-ledger.exe';NEW_SHA='7dd05a7df096afa5a9be6dc86235a4c26f38b9a65b80688f62fbfc4042ac5969'
KNOWN={'finance','inventory_dashboard','reports','erp_settlement','cashier','cashier_schema','cashier_numbers','cashier_engine','cashier_restore','cashier_runtime','cashier_maintenance'}
p=argparse.ArgumentParser(allow_abbrev=False);p.add_argument('--self-sha256',required=True);p.add_argument('--expected-namespace',required=True);args=p.parse_args()
raw=(ROOT/HELPER).read_bytes()
if hashlib.sha256(raw).hexdigest()!=HELPER_SHA:raise RuntimeError('Original helper changed')
base=types.ModuleType('original_read_helpers');base.__file__=str(ROOT/HELPER);exec(compile(raw,base.__file__,'exec',dont_inherit=True),base.__dict__)
base.pinned(Path(__file__),args.self_sha256);base.verify_fixed(HELPER_SHA,args.expected_namespace)
guard=types.ModuleType('actual_context');guard.__file__=str(ROOT/'stage1/sandbox-context.py');exec(compile(base.pinned(Path(guard.__file__),base.GUARDS['stage1/sandbox-context.py']),guard.__file__,'exec'),guard.__dict__);proof=guard.read_context(ROOT)
source_manifest=json.loads(base.pinned(ROOT/PINS,PINS_SHA))['files']
base.pinned(OLD,OLD_SHA,limit=128*1024*1024);base.pinned(NEW,NEW_SHA,limit=128*1024*1024)
# Import only the existing public compiler's read-only archive API. No archived
# code object is executed or imported; marshal is confined to these pinned EXEs.
site=Path('C:/Python314/Lib/site-packages');base.ordinary(site,directory=True);sys.path.insert(0,str(site))
import importlib.metadata
if importlib.metadata.version('pyinstaller')!='6.22.3':raise RuntimeError('Fixed public archive reader version required')
from PyInstaller.archive.readers import CArchiveReader
tree=ast.parse(base.pinned(ROOT/COMPARATOR,COMPARATOR_SHA));selected=[]
for node in tree.body:
    if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='FIELDS' for t in node.targets):selected.append(node)
    elif isinstance(node,ast.ClassDef) and node.name=='RepackError':selected.append(node)
    elif isinstance(node,ast.FunctionDef) and node.name in ('require','sha','code_tree','fingerprint','assert_same_code'):selected.append(node)
if len(selected)!=7:raise RuntimeError('Exact original comparison definitions required')
compare=types.ModuleType('original_code_comparison');compare.__dict__.update(types=types,json=json,struct=struct,hashlib=hashlib)
exec(compile(ast.Module(body=selected,type_ignores=[]),str(ROOT/COMPARATOR),'exec',dont_inherit=True),compare.__dict__)
out=Path('C:/xjy-results/ledger170-code-equivalence-a3');base.ordinary(out.parent,directory=True);out.mkdir(exist_ok=False)
report={'admission':proof,'oldExeSha256':OLD_SHA,'newExeSha256':NEW_SHA,'originalComparatorSha256':COMPARATOR_SHA,
        'knownSources':{},'unexpectedChanged':[],'missingModules':[],'addedModules':[],'unchangedCount':0,
        'businessExecuted':False,'databaseOpened':False,'passed':False}
try:
    before=CArchiveReader(str(OLD));after=CArchiveReader(str(NEW))
    def pyz(archive):
        names=[name for name,row in archive.toc.items() if row[-1]=='z']
        if len(names)!=1:raise RuntimeError('Single embedded PYZ required')
        return archive.open_embedded_archive(names[0])
    old,new=pyz(before),pyz(after)
    report['missingModules']=sorted(set(old.toc)-set(new.toc));report['addedModules']=sorted(set(new.toc)-set(old.toc))
    for name in sorted(set(old.toc)&set(new.toc)-KNOWN):
        a,b=old.extract(name),new.extract(name)
        if a is None and b is None:report['unchangedCount']+=1;continue
        try:compare.assert_same_code(a,b);report['unchangedCount']+=1
        except Exception:report['unexpectedChanged'].append(name)
    for name in sorted(KNOWN):
        rel='project/desktop/legacy-source/ledger/'+name+'.py';item=source_manifest[rel]
        source=base.pinned(ROOT/rel,item['sha256'],item['size']);actual=new.extract(name)
        compare.assert_same_code(actual,compile(source,actual.co_filename,'exec',dont_inherit=True,optimize=0))
        report['knownSources'][name]={'sourceSha256':item['sha256'],'codeSha256':compare.fingerprint(actual)}
    sidecar=marshal.loads(after.extract('sidecar'));rel='project/desktop/legacy-source/sidecar.py';item=source_manifest[rel]
    compare.assert_same_code(sidecar,compile(base.pinned(ROOT/rel,item['sha256'],item['size']),sidecar.co_filename,'exec',dont_inherit=True,optimize=0))
    report['knownSources']['sidecar']={'sourceSha256':item['sha256'],'codeSha256':compare.fingerprint(sidecar)}
    report['passed']=not report['missingModules'] and not report['unexpectedChanged'] and not(set(report['addedModules'])-KNOWN)
except Exception as error:report['error']={'type':type(error).__name__,'message':str(error)}
base.pinned(OLD,OLD_SHA,limit=128*1024*1024);base.pinned(NEW,NEW_SHA,limit=128*1024*1024)
base.verify_fixed(HELPER_SHA,args.expected_namespace);guard.read_context(ROOT)
with (out/'results.json').open('x',encoding='utf-8') as stream:json.dump(report,stream,indent=2)
print(json.dumps({key:report[key] for key in ('passed','unchangedCount','missingModules','addedModules','unexpectedChanged')}))
raise SystemExit(0 if report['passed'] else 1)
