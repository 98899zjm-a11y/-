"""Pure-data assembly of the fixed official runtime and audited program resources."""
from pathlib import Path
import hashlib, importlib.util, json, stat, zipfile
ROOT=Path(__file__).resolve().parents[1]
helper=ROOT/'audit-tools/prepare-desktop-first170-projection.py'
assert hashlib.sha256(helper.read_bytes()).hexdigest()=='eefdb493fc2b7d9f0347804e60a9db6f75ab7ca53dd20ee3d9ee2f75ce34ecf0'
spec=importlib.util.spec_from_file_location('copy_helpers',helper);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
archive=ROOT/'sandbox/input/engine-4490-public-a1/electron-v44.9.0-win32-x64.zip'
body=m.read_stable(archive,{'size':158625558,'sha256':'88e08039d0ef359bab9f674e8051fa103bd8628ea7c5a5e1daaa610a8a0c6931'})
resource_root=ROOT/'release-work/desktop-first170-baseline-artifact-a1'
raw=m.read_stable(resource_root/'artifact-manifest.json');assert m.sha(raw)=='f4827d066e39abbc801303c5de938543191e225722d2e0fc0d4e8ee391e6ec4c'
manifest=json.loads(raw);assert manifest['programVersion']=='1.7.0' and len(manifest['resources'])==1007
import io
with zipfile.ZipFile(io.BytesIO(body)) as z:
    rows=[];seen=set()
    for item in z.infolist():
        name=item.filename.rstrip('/')
        m.safe_relative(name)
        assert name.casefold() not in seen;seen.add(name.casefold())
        mode=item.external_attr>>16
        assert stat.S_IFMT(mode) in (0,stat.S_IFREG,stat.S_IFDIR) and not item.flag_bits&1
        if item.is_dir() or name=='resources/default_app.asar':continue
        assert not name.startswith('resources/') and 0<=item.file_size<=512*1024*1024
        rows.append((item,'鑫金源珠宝报价.exe' if name=='electron.exe' else name))
    assert len(rows)==72 and sum(item.file_size for item,_ in rows)<1024*1024*1024
    assert z.read('version').strip()==b'44.9.0'
    m.OUTPUT=ROOT/'release-work/desktop-first170-program-baseline-a1';m.mkdir_new(m.OUTPUT)
    outputs=[]
    for item,target in rows:
        r=m.write_new('program/'+target,z.read(item));r['origin']='official44.9:'+item.filename;outputs.append(r)
    for item in manifest['resources']:
        b=m.read_stable(resource_root/item['path'],item)
        r=m.write_new('program/'+item['path'],b);r['origin']='baseline170:'+item['path'];outputs.append(r)
assert len(outputs)==1079
for row in outputs:m.read_stable(m.OUTPUT/row['path'],row)
m.write_new('assembly.json',(json.dumps({'complete':True,'programVersion':'1.7.0','engineVersion':'44.9.0','publicRuntimeZipSha256':m.sha(body),'resourceManifestSha256':m.sha(raw),'files':outputs,'fileCount':len(outputs),'releaseReady':False,'financialMonthlyFixNotYetIncluded':True,'productionAccessed':False,'programExecuted':False},ensure_ascii=False,indent=2)+'\n').encode())
print(json.dumps({'complete':True,'files':len(outputs),'manifestSha256':m.sha(m.read_stable(m.OUTPUT/'assembly.json')),'releaseReady':False}))
