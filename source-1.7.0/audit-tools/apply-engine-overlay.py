"""Release-only overlay: original guard plus two explicitly authorized repeat-upgrade sources."""
from pathlib import Path, PurePosixPath
import hashlib, importlib.util, json, os, stat, sys
ROOT=Path('C:/xjy-work/xjy-web-stage1')
spec=importlib.util.spec_from_file_location('context',ROOT/'stage1/sandbox-context.py');ctx=importlib.util.module_from_spec(spec);spec.loader.exec_module(ctx);ctx.read_context(ROOT)
name,expected=sys.argv[1:]
if not name.replace('-','').isalnum() or len(expected)!=64:raise RuntimeError('Invalid overlay arguments')
source=Path('C:/xjy-input')/name
def ordinary(p):
    for q in (p,*p.parents):
        if not q.exists():continue
        s=q.lstat()
        if q.is_symlink() or os.path.isjunction(q) or getattr(s,'st_file_attributes',0)&0x400 or stat.S_ISREG(s.st_mode) and s.st_nlink!=1:raise RuntimeError('Linked path rejected')
    return p
ordinary(source)
b=(source/'manifest.json').read_bytes()
if hashlib.sha256(b).hexdigest()!=expected:raise RuntimeError('Overlay manifest seal mismatch')
rows=json.loads(b)['files'];seen=set();verified=[]
for row in rows:
    rel=row['path'];parts=PurePosixPath(rel).parts
    # Only the pinned public compiler executable may accompany source updates;
    # never admit a business EXE, database, private key or legacy bytecode here.
    compiler=rel=='audit-tools/dependencies/node_modules/@esbuild/win32-x64/esbuild.exe'
    if not parts or (parts[0] not in {'project','stage1','tests','audit-tools'} and rel not in {'delivery-tools/initial-patch-core.cjs','delivery-tools/initial-patch-entry.cjs','delivery-tools/initial-patch-backup.cjs','delivery-tools/fresh-employee-install.cjs','delivery-tools/engine-tree-candidate.cjs'}) or any(x in {'','.','..'} for x in rel.split('/')) or any(c in rel for c in '\\:') or rel.lower().endswith(('.db','.sqlite','.key','.pem','.dll','.pyc','.asar')) or rel.lower().endswith('.exe') and not compiler or rel.casefold() in seen:raise RuntimeError('Overlay path rejected')
    seen.add(rel.casefold());p=ordinary(source/rel);dest=ordinary(ROOT/rel)
    if not dest.is_relative_to(ROOT):raise RuntimeError('Output escaped')
    b=p.read_bytes()
    if len(b)!=row['size'] or hashlib.sha256(b).hexdigest()!=row['sha256']:raise RuntimeError('Overlay bytes mismatch')
    verified.append((dest,b,rel))
result=[]
for dest,b,rel in verified:
    dest.parent.mkdir(parents=True,exist_ok=True);ordinary(dest.parent)
    before=hashlib.sha256(dest.read_bytes()).hexdigest() if dest.exists() else None
    dest.write_bytes(b);ordinary(dest)
    after=hashlib.sha256(dest.read_bytes()).hexdigest()
    if after!=hashlib.sha256(b).hexdigest():raise RuntimeError('Guest output mismatch')
    result.append({'path':rel,'before':before,'after':after})
report=Path('C:/xjy-results')/(name+'-applied.json')
with report.open('x',encoding='utf-8') as f:json.dump({'actualGuest':True,'manifestSha256':expected,'files':result},f,indent=2)
print(json.dumps({'applied':len(result),'report':str(report)}))
