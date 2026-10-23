"""Publish one verified code-only bundle inside the admitted offline Guest.

Preserve the old bundle and manifest. No database, registry, formal program,
network settings, application launch or recursive deletion is performed.
"""
import os, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
if os.name!='nt' or str(ROOT).lower().replace('\\','/')!='c:/xjy-work/xjy-web-stage1' or not sys.flags.isolated or not sys.flags.no_site or not sys.flags.dont_write_bytecode:
    raise RuntimeError('Actual fixed Guest Python -I -B -S required')
import argparse, hashlib, json, socket, subprocess, types, uuid
HELPER='audit-tools/run-finance-erp170-red-a1.py';HELPER_SHA='1f7ab3485de1260db7e0762175b7a15fcafc2d4c942f3adf7d40142a267f1e2e'
OLD_MANIFEST='5f0e8d919c541ac07d305544bb1c7036e7cb4ced8c5c4ee8cf262c927bc373d2'
BUILD_SHA='079a226975d65c668ca1ca9d6d080a223b44a12b4f8cd2f861ee8cb0d01ae95b'
PROOF_SHA='f0675943d10a3300dfea9659f8fb9aaff800d489c2fb628256c8ca37ca009139'
p=argparse.ArgumentParser(allow_abbrev=False);p.add_argument('--self-sha256',required=True);p.add_argument('--expected-namespace',required=True);args=p.parse_args()
raw=(ROOT/HELPER).read_bytes()
if hashlib.sha256(raw).hexdigest()!=HELPER_SHA:raise RuntimeError('Original helper changed')
base=types.ModuleType('adopt_original_helpers');base.__file__=str(ROOT/HELPER);exec(compile(raw,base.__file__,'exec',dont_inherit=True),base.__dict__)
base.pinned(Path(__file__),args.self_sha256);base.verify_fixed(HELPER_SHA,args.expected_namespace)
guard=types.ModuleType('adopt_actual_context');guard.__file__=str(ROOT/'stage1/sandbox-context.py');exec(compile(base.pinned(Path(guard.__file__),base.GUARDS['stage1/sandbox-context.py']),guard.__file__,'exec'),guard.__dict__);proof=guard.read_context(ROOT)
results=Path('C:/xjy-results');base.ordinary(results,directory=True)
build=json.loads(base.pinned(results/'ledger170-guarded-build-a2/results.json',BUILD_SHA))
identity=json.loads(base.pinned(results/'ledger170-code-equivalence-a2/results.json',PROOF_SHA))
entry=build.get('entry',{})
if not build.get('complete') or build.get('exitCode')!=0 or identity.get('passed') is not True or identity.get('missingModules') or identity.get('unexpectedChanged') or entry.get('sha256')!='a7dd90f4b0e293ecb928f94a118fc237911caf5099c1b012cae378fea72e4202':raise RuntimeError('Exact successful build/code proof required')
packaged=ROOT/'project/desktop/legacy-modules';manifest_file=packaged/'manifest.json';old_bytes=base.pinned(manifest_file,OLD_MANIFEST)
manifest=json.loads(old_bytes);old=next(x for x in manifest['modules'] if x['id']=='ledger')
source=ROOT/'runtime/ledger170-guarded-build-a2/dist/xjy-ledger';target=packaged/'xjy-ledger'
work=ROOT/'runtime/ledger170-adopt-a1';out=results/'ledger170-adopt-a1'
def tree(directory,files):
    base.ordinary(directory,directory=True);expected={row['path'] for row in files};actual=set()
    for file in directory.rglob('*'):
        base.ordinary(file,directory=file.is_dir())
        if file.is_file():actual.add(file.relative_to(directory).as_posix())
    if actual!=expected:raise RuntimeError('Bundle file set differs')
    for row in files:
        rel=row['path']
        if not isinstance(rel,str) or any(x in ('','.','..') for x in rel.split('/')) or '\\' in rel or ':' in rel:raise RuntimeError('Unsafe bundle path')
        base.pinned(directory/rel,row['sha256'],row['size'],limit=128*1024*1024)
tree(target,old['files']);tree(source,entry['files'])
ps='[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); @(Get-CimInstance Win32_Process -Filter "Name=\'xjy-ledger.exe\'").Count'
active=subprocess.check_output(['C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe','-NoProfile','-NonInteractive','-Command',ps],encoding='utf-8',creationflags=0x08000000).strip()
if active!='0' or (ROOT/'runtime/host-ready.json').exists():raise RuntimeError('A ledger/host may still be active; do not replace it')
with socket.socket() as check:
    check.settimeout(1)
    if check.connect_ex(('127.0.0.1',41831))==0:raise RuntimeError('Actual test Host port is still occupied')
base.ordinary(work.parent,directory=True);work.mkdir(exist_ok=False);out.mkdir(exist_ok=False)
backup=work/'previous-ledger';incoming=work/'incoming-ledger';incoming.mkdir()
if any(not path.absolute().is_relative_to(ROOT) for path in (source,target,work,backup,incoming)):
    raise RuntimeError('All rename/copy targets must remain inside the fixed Guest workspace')
(out/'previous-manifest.json').write_bytes(old_bytes)
report={'admission':proof,'oldManifestSha256':OLD_MANIFEST,'buildSha256':BUILD_SHA,'codeProofSha256':PROOF_SHA,
        'oldExeSha256':old['sha256'],'newExeSha256':entry['sha256'],'oldBundlePreservedAt':str(backup),
        'complete':False,'databaseOpened':False,'formalEnvironmentTouched':False}
try:
    for row in entry['files']:
        file=incoming/row['path'];file.parent.mkdir(parents=True,exist_ok=True);base.ordinary(file.parent,directory=True)
        with file.open('xb') as stream:stream.write(base.pinned(source/row['path'],row['sha256'],row['size'],limit=128*1024*1024))
    tree(incoming,entry['files']);base.pinned(manifest_file,OLD_MANIFEST);tree(target,old['files'])
    base.ordinary(target,directory=True);base.ordinary(work,directory=True)
    target.rename(backup);incoming.rename(target)
    manifest['modules']=[entry if item['id']=='ledger' else item for item in manifest['modules']]
    new_bytes=(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n').encode('utf-8')
    temp=packaged/('.manifest-ledger170-'+str(uuid.uuid4())+'.tmp')
    with temp.open('xb') as stream:stream.write(new_bytes);stream.flush();os.fsync(stream.fileno())
    temp.replace(manifest_file);tree(target,entry['files']);tree(backup,old['files'])
    report['newManifestSha256']=hashlib.sha256(new_bytes).hexdigest();report['complete']=True
except Exception as error:
    report['error']={'type':type(error).__name__,'message':str(error)}
    if backup.exists():
        if target.exists():target.rename(work/'rejected-ledger')
        backup.rename(target);manifest_file.write_bytes(old_bytes);tree(target,old['files'])
        report['oldBundleRestored']=True
finally:
    with (out/'results.json').open('x',encoding='utf-8') as stream:json.dump(report,stream,indent=2)
print(json.dumps(report))
raise SystemExit(0 if report['complete'] else 1)
