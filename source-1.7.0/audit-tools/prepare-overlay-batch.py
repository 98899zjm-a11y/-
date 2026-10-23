"""Host-only data packaging for explicit isolated source/public compiler paths."""
from pathlib import Path
import importlib.util, hashlib, json, sys
ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('prepare',ROOT/'audit-tools/prepare-guest-audit.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
name=sys.argv[1]
if not name.replace('-','').isalnum():raise RuntimeError('Batch name rejected')
out=ROOT/'sandbox/input'/name
if out.exists():raise RuntimeError('Fresh output required')
rows=[];seen=set()
def add(p,rel):
    m.ordinary(p)
    if rel.casefold() in seen:raise RuntimeError('Duplicate input')
    seen.add(rel.casefold());b=p.read_bytes();m.write_new(out/rel,b);rows.append({'path':rel,'size':len(b),'sha256':m.sha(b)})
for rel in sys.argv[2:]:
    p=ROOT/rel
    if not p.is_relative_to(ROOT) or '..' in Path(rel).parts:raise RuntimeError('Input escaped')
    add(p,rel.replace('\\','/'))
if name in {'supplement-b2','post161-public-build-a1'}:
    vendor=Path('E:/珠宝销售软件/node_modules')
    for package in ['esbuild','@esbuild/win32-x64']:
        info=json.loads((vendor/package/'package.json').read_text('utf-8'))
        if info['name']!=package or info['license']!='MIT' or info['version']!='0.28.0':raise RuntimeError('Public compiler identity changed: '+package+' '+info['version'])
        for p in sorted((vendor/package).rglob('*')):
            m.ordinary(p)
            if p.is_file():add(p,'audit-tools/dependencies/node_modules/'+p.relative_to(vendor).as_posix())
if name in {'public-ui-g1','post161-public-build-a1'}:
    vendor=Path('E:/珠宝销售软件/node_modules');package='lucide-react'
    info=json.loads((vendor/package/'package.json').read_text('utf-8'))
    if info['name']!=package or info['version']!='1.31.0' or info['license']!='ISC':raise RuntimeError('Existing public UI dependency changed')
    for p in sorted((vendor/package).rglob('*')):
        m.ordinary(p)
        if p.is_file():add(p,'audit-tools/dependencies/node_modules/'+p.relative_to(vendor).as_posix())
manifest=(json.dumps({'version':1,'purpose':'data-free isolated audit code and public compiler','files':rows},indent=2)+'\n').encode()
m.write_new(out/'manifest.json',manifest)
script=ROOT/'sandbox/input/apply-guest-overlay.py'
if not script.exists():m.write_new(script,(ROOT/'audit-tools/apply-guest-overlay.py').read_bytes())
elif script.read_bytes()!=(ROOT/'audit-tools/apply-guest-overlay.py').read_bytes():raise RuntimeError('Mapped helper frozen; use a new name for a helper revision')
print(json.dumps({'batch':name,'files':len(rows),'manifestSha256':m.sha(manifest),'applySha256':m.sha(script.read_bytes())}))
