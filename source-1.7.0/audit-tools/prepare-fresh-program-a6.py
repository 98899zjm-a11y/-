"""Data-only repackage: corrected fictional EXE name, no product policy changes."""
from pathlib import Path
import hashlib, importlib.util, json
ROOT=Path(__file__).resolve().parents[1]
helper=ROOT/'audit-tools/prepare-desktop-first170-projection.py'
assert hashlib.sha256(helper.read_bytes()).hexdigest()=='eefdb493fc2b7d9f0347804e60a9db6f75ab7ca53dd20ee3d9ee2f75ce34ecf0'
spec=importlib.util.spec_from_file_location('copy_helpers',helper);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
old=ROOT/'sandbox/input/engine-native170-connection-a5'
raw=m.read_stable(old/'manifest.json');assert m.sha(raw)=='62a98b0118728d43e7ddcaaaa01d01fd6303c4d2b41acff577ff4179dc084bec'
manifest=json.loads(raw);assert len(manifest['files'])==17
test='audit-tools/fresh-program170-role-commit.test.cjs'
test_body=m.read_stable(ROOT/test);test_sha=m.sha(test_body)
m.OUTPUT=ROOT/'sandbox/input/engine-native170-connection-a6';m.mkdir_new(m.OUTPUT)
rows=[]
for row in manifest['files']:
    body=m.read_stable(old/row['path'],row)
    if row['path']==test:body=test_body
    rows.append(m.write_new(row['path'],body))
source=(json.dumps({'version':1,'purpose':'data-free isolated audit code and public compiler','files':rows},indent=2)+'\n').encode()
m.write_new('manifest.json',source);source_sha=m.sha(source)
tools=[]
for kind in ('apply','run'):
    rel=f'audit-tools/{kind}-engine-native170-connection-a5.py'
    text=m.read_stable(ROOT/rel).decode()
    text=text.replace('62a98b0118728d43e7ddcaaaa01d01fd6303c4d2b41acff577ff4179dc084bec',source_sha)
    text=text.replace('engine-native170-connection-a5','engine-native170-connection-a6').replace("r'-a5(","r'-a6(")
    text=text.replace('002aa512907637feac9a52873a1bb56797cef02263e4caf0bb7cbef5a2887f2b',test_sha)
    dest=ROOT/rel.replace('-a5.py','-a6.py')
    with dest.open('xb') as f:f.write(text.encode())
    compile(text,str(dest),'exec')
    tools.append(dest.relative_to(ROOT).as_posix())
m.OUTPUT=ROOT/'sandbox/input/engine-native170-connection-tools-a6';m.mkdir_new(m.OUTPUT)
rows=[m.write_new(rel,m.read_stable(ROOT/rel)) for rel in [*tools,test]]
data=(json.dumps({'version':1,'purpose':'data-free isolated audit code and public compiler','files':rows},indent=2)+'\n').encode()
m.write_new('manifest.json',data)
print(json.dumps({'sourceManifest':source_sha,'toolsManifest':m.sha(data),'tools':rows,'assertionsUnchanged':True,'productFilesUnchanged':True}))
