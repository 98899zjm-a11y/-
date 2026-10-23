"""Data-only V1.6 source inventory/copy; never imports product modules."""
from pathlib import Path
import hashlib, json, os, shutil, stat, struct
from datetime import datetime, timezone

SOURCE=Path('E:/codex/2026-10-13/work/xjy-web-stage1')
ROOT=Path(__file__).resolve().parent.parent
EXPECTED_ROOT=Path('E:/codex/2026-10-15/work/xjy-v16-deep-audit')
SKIP_DIRS={'node_modules','.git','__pycache__','.legacy-build','.release-build','.wrangler','.next',
           'fake-external-files','data','runtime','logs','backups','cache','config','private',
           'uploads','attachments','erp-attachments','build','dist','renderer-dist','generated',
           'legacy-modules','tools','release','release-modules'}
SKIP_SUFFIXES={'.db','.sqlite','.sqlite3','.xjybak','.key','.pem','.pfx','.p12','.xlsx','.xls','.csv',
               '.exe','.dll','.pyd','.pyc','.pyz','.pkg','.asar','.zip','.bin','.blob','.toc',
               '.png','.jpg','.jpeg','.webp','.gif','.ico','.ttf','.pfb','.afm','.sfd'}
TEXT_SUFFIXES={'.py','.cjs','.mjs','.js','.ts','.tsx','.mts','.css','.html','.json','.md','.txt',
               '.sql','.ps1','.cmd','.spec','.svg','.toml','.yml','.yaml','.xml','.lock'}
TOPS=['project','stage1','tests','delivery-approval','delivery-installer','delivery-tools','docs']

def check(p, root):
    p.relative_to(root)
    if os.path.normcase(os.path.realpath(p))!=os.path.normcase(str(p)):
        raise RuntimeError('Noncanonical input/output')
    walk=p
    while True:
        s=walk.lstat()
        if stat.S_ISLNK(s.st_mode) or os.path.isjunction(walk) or getattr(s,'st_file_attributes',0)&0x400:
            raise RuntimeError('Reparse point refused')
        if stat.S_ISREG(s.st_mode) and s.st_nlink!=1:
            raise RuntimeError('Hardlink refused: '+str(walk))
        if walk==root: break
        walk=walk.parent

def sha(p):
    check(p,SOURCE if p.is_relative_to(SOURCE) else ROOT)
    h=hashlib.sha256()
    with p.open('rb') as f:
        for b in iter(lambda:f.read(4194304),b''):h.update(b)
    return h.hexdigest()

def copy(p, destination):
    check(p,SOURCE)
    before=p.stat()
    h=sha(p)
    destination.parent.mkdir(parents=True,exist_ok=True)
    check(destination.parent,ROOT)
    if destination.exists():
        check(destination,ROOT)
        if sha(destination)!=h:raise RuntimeError('Existing partial snapshot differs')
    else:
        with p.open('rb') as i,destination.open('xb') as o:
            shutil.copyfileobj(i,o,4194304)
    after=p.stat()
    if (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns) or sha(destination)!=h:
        raise RuntimeError('Source changed during copy')
    return {'path':p.relative_to(SOURCE).as_posix(),'size':after.st_size,'sha256':h}

def main():
    if ROOT!=EXPECTED_ROOT:raise RuntimeError('Fixed isolated workspace required')
    check(ROOT,ROOT);check(SOURCE,SOURCE)
    manifest_file=SOURCE/'release-work/full-f1d38862-eeac-4c73-ae48-6b8e2e2e877f/release-manifest.json'
    if sha(manifest_file)!='c82426dc5463f2b5f0b366dd7c7e0ac09ec9d542bc9b81866997ecbc0cf9efd9':raise RuntimeError('V1.6 resource manifest changed')
    release=json.loads(manifest_file.read_text(encoding='utf8'))
    if release['programVersion']!='1.6.0' or release['main']!='release-entry.cjs':raise RuntimeError('Wrong release baseline')
    mismatches=[]
    for n,h in release['freeze']['files'].items():
        if sha(SOURCE/'project/desktop'/n)!=h:mismatches.append(n)
    if mismatches:raise RuntimeError('Runtime source differs from V1.6 signed freeze: '+','.join(mismatches))
    archive=SOURCE/'release/资源补丁-1.6.0-v7/resources/app.asar'
    if sha(archive)!='ea677d9ea14583a01161ac9b27eba2e0d490ab28d1cb24ebbff42c7fa7afc9ef':raise RuntimeError('V1.6 ASAR changed')
    with archive.open('rb') as f:
        first=f.read(8);marker,header_size=struct.unpack('<II',first)
        if marker!=4 or not 8<header_size<33554432:raise RuntimeError('ASAR header invalid')
        header=f.read(header_size);n=struct.unpack('<I',header[4:8])[0];tree=json.loads(header[8:8+n])
        pkg=tree['files']['package.json'];f.seek(8+header_size+int(pkg['offset']));actual=json.loads(f.read(pkg['size']))
    if actual['version']!='1.6.0' or actual['main']!='release-entry.cjs':raise RuntimeError('Actual packaged version mismatch')
    rows=[];excluded=[];partial_verified=[]
    for top in TOPS:
        base=SOURCE/top
        for dirpath,dirs,files in os.walk(base,followlinks=False):
            directory=Path(dirpath);check(directory,SOURCE)
            kept=[]
            for name in sorted(dirs):
                child=directory/name;check(child,SOURCE)
                if name.lower() in SKIP_DIRS:
                    excluded.append({'path':child.relative_to(SOURCE).as_posix()+'/',
                                     'reason':'generated, runtime, private or data directory excluded'})
                else:kept.append(name)
            dirs[:]=kept
            for name in sorted(files):
                p=directory/name;relative=p.relative_to(SOURCE).as_posix()
                check(p,SOURCE)
                lower=name.lower()
                if p.suffix.lower() in SKIP_SUFFIXES or lower.startswith('.env') or lower in {'accounts.json','credentials.json','launch-role.json','workspace-connection.json'} or lower.endswith(('-wal','-shm','-journal')) or (p.suffix.lower()=='.json' and any(x in lower for x in ('secret','private','credential','backup-key','issuer-key'))):
                    excluded.append({'path':relative,'reason':'data/key/env/binary file excluded'});continue
                if p.suffix.lower() not in TEXT_SUFFIXES and name not in {'.gitignore','.gitattributes','LICENSE','COPYING'}:
                    excluded.append({'path':relative,'reason':'not an approved source-text format'});continue
                with p.open('rb') as i: magic=i.read(16)
                if magic==b'SQLite format 3\0':
                    raise RuntimeError('SQLite content in selected source refused: '+relative)
                with p.open('rb') as i:
                    try:i.read().decode('utf-8-sig')
                    except UnicodeDecodeError:raise RuntimeError('Non-UTF8 source refused: '+relative)
                if (ROOT/relative).exists():partial_verified.append(relative)
                rows.append(copy(p,ROOT/relative))
    out=ROOT/'baseline';out.mkdir(exist_ok=True);check(out,ROOT)
    copy(manifest_file,out/'release-manifest-v16.json')
    copy(SOURCE/'reports/oneclick-v7-final-handoff.json',out/'oneclick-v16-handoff.json')
    copy(SOURCE/'reports/root-initial-common-store-v7.json',out/'initial-tools-v16-manifest.json')
    copy(archive,out/'app-v16.asar')
    result={'version':'1.6.0','capturedAtUtc':datetime.now(timezone.utc).isoformat(),'actualPackagedVersion':actual,'sourceRoot':str(SOURCE),'isolatedRoot':str(ROOT),'sourceHadGit':(SOURCE/'.git').exists(),
            'signedRuntimeFreezeVerified':True,'signedRuntimeSourceFiles':len(release['freeze']['files']),
            'packageMetadataNotes':['project/package.json is framework scaffold0.1.0','desktop/package.json retains1.5.0 base; release builder emits actual1.6.0 package'],
            'files':rows,'fileCount':len(rows),'bytes':sum(r['size'] for r in rows),'excluded':excluded,
            'existingPartialFilesShaVerified':len(partial_verified),
            'copyScope':'UTF-8 source text only; release ASAR retained separately as read-only evidence, not tracked source',
            'sourceModified':False,'productionDatabaseOrConfigurationRead':False,'releaseKeysCopied':False,'productExecuted':False}
    (out/'source-snapshot.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps({k:v for k,v in result.items() if k not in {'files','excluded'}},ensure_ascii=False))

if __name__=='__main__':main()
