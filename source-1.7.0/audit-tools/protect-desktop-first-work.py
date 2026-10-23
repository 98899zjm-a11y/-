"""Host-only source protection; never imports product code or business data."""
from pathlib import Path
import datetime,hashlib,json,os,re,subprocess,zipfile
ROOT=Path(__file__).resolve().parents[1]
if str(ROOT).lower().replace('\\','/')!='e:/codex/2026-10-15/work/xjy-v16-deep-audit':
    raise RuntimeError('Fixed maintenance source root required')
TOPS=('project','stage1','delivery-tools','delivery-approval','tests','audit-tools','docs','reports')
SKIP={'node_modules','.git','__pycache__','runtime','data','cache','logs','backups','test-tools','dependencies','pdf_vendor'}
SUFFIXES={'.cjs','.mjs','.js','.jsx','.ts','.tsx','.py','.pyc','.cs','.ps1','.cmd','.bat','.html','.css','.scss','.sql','.json','.md','.txt','.toml','.yaml','.yml','.xml','.svg','.png','.jpg','.jpeg','.webp','.ico','.woff','.woff2','.ttf','.otf','.sfd'}
out=ROOT/'audit-evidence/desktop-first-source-protection-20261020-004035'
if out.exists():raise RuntimeError('Protection output already exists; never replace it')
def ordinary(p):
    for q in (p,*p.parents):
        s=q.lstat()
        if q.is_symlink() or q.is_junction() or getattr(s,'st_file_attributes',0)&0x400:
            raise RuntimeError('Source path has a link: '+str(p.relative_to(ROOT)))
        if q==p and p.is_file() and s.st_nlink!=1:raise RuntimeError('Hard-linked source')
    return p.stat()
def signature(s):return (s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns)
selected=[];excluded=[]
for top in TOPS:
    folder=ROOT/top
    if not folder.exists():continue
    ordinary(folder)
    for directory,folders,files in os.walk(folder,followlinks=False):
        parent=Path(directory);ordinary(parent)
        folders[:]=sorted(n for n in folders if n.lower() not in SKIP)
        for name in sorted(files):
            file=parent/name;relative=file.relative_to(ROOT).as_posix()
            if file.suffix.lower() not in SUFFIXES or name.startswith('.env') or re.search(r'(?:credentials|secret|private[-_]?key|session[-_]?cookie)\.(?:json|txt|toml)$',name,re.I):
                continue
            st=ordinary(file)
            if st.st_size>64*1024*1024:
                excluded.append({'path':relative,'reason':'oversized-program-or-report; original retained'});continue
            selected.append(file)
for file in ROOT.glob('*.md'):ordinary(file);selected.append(file)
for name in ('RELEASE_TARGET.json','DESKTOP_FIRST_RELEASE.json'):
    file=ROOT/name
    if file.exists():ordinary(file);selected.append(file)
selected=sorted(set(selected),key=lambda p:p.relative_to(ROOT).as_posix())
out.mkdir(parents=True);archive=out/'源码-测试-文档保护快照.zip';rows=[]
with zipfile.ZipFile(archive,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for file in selected:
        relative=file.relative_to(ROOT).as_posix();before=ordinary(file);body=file.read_bytes();after=ordinary(file)
        if signature(before)!=signature(after) or len(body)!=before.st_size:raise RuntimeError('Source changed while protecting: '+relative)
        if re.search(rb'sk-[A-Za-z0-9]{20,}',body) or re.search(rb'-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----[\r\n]+[A-Za-z0-9+/=\r\n]{80,}',body):
            excluded.append({'path':relative,'reason':'possible embedded credential; original retained, not copied'});continue
        z.writestr(relative,body);rows.append({'path':relative,'size':len(body),'sha256':hashlib.sha256(body).hexdigest()})
with zipfile.ZipFile(archive) as z:
    if z.testzip() is not None or len(z.infolist())!=len(rows):raise RuntimeError('Archive verification failed')
    for row in rows:
        if hashlib.sha256(z.read(row['path'])).hexdigest()!=row['sha256']:raise RuntimeError('Archive entry mismatch')
def git(*args):return subprocess.check_output(['git','-C',str(ROOT),*args])
status=git('status','--porcelain=v1','-z','--untracked-files=all');(out/'git-status-at-protection.bin').write_bytes(status)
manifest={'version':1,'purpose':'preserve-current-development-before-desktop-first-release','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'root':str(ROOT),'branch':git('branch','--show-current').decode().strip(),'commit':git('rev-parse','HEAD').decode().strip(),
          'archive':archive.name,'archiveSha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'fileCount':len(rows),'files':rows,'excluded':excluded,
          'productionDataIncluded':False,'releaseReady':False,'originalFilesChanged':False,
          'limits':'Source and documentation protection only. Dependencies, binaries, business databases, archives and credential candidates remain at their original locations. Existing test evidence and sealed inputs are preserved in place.'}
with (out/'manifest.json').open('x',encoding='utf-8') as stream:json.dump(manifest,stream,ensure_ascii=False,indent=2)
print(json.dumps({'directory':str(out),'fileCount':len(rows),'archiveBytes':archive.stat().st_size,'archiveSha256':manifest['archiveSha256'],'excludedCount':len(excluded)},ensure_ascii=False))
