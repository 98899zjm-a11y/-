"""Host pure source-data preparation; never starts a VM or business service."""
from pathlib import Path
import hashlib,json,os,stat,subprocess

ROOT=Path('E:/codex/2026-10-15/work/xjy-v16-deep-audit')
INPUT=ROOT/'sandbox/input'
OLD=INPUT/'overlay-a2'
OUT=INPUT/'overlay-native162-a1'
RESULTS=ROOT/'sandbox/results/post162-session-a1'

def need(value,message):
    if not value:raise RuntimeError(message)

def ordinary(file):
    file=Path(file)
    need(file.is_absolute() and file.is_relative_to(ROOT),'Fixed isolated path required')
    for item in (file,*file.parents):
        if not os.path.lexists(item):continue
        info=item.lstat()
        need(not stat.S_ISLNK(info.st_mode) and not getattr(info,'st_file_attributes',0)&0x400,'Linked path refused')
        need(not stat.S_ISREG(info.st_mode) or info.st_nlink==1,'Hardlink refused')
    return file

def sha(body):return hashlib.sha256(body).hexdigest()

def read(file,pin=None):
    file=ordinary(file);before=file.stat();body=file.read_bytes();after=file.stat()
    need((before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns),'Source changed')
    need(len(body)==before.st_size and (pin is None or sha(body)==pin),'Source hash changed')
    return body

def put(file,body):
    file=ordinary(file);file.parent.mkdir(parents=True,exist_ok=True);ordinary(file.parent)
    with file.open('xb') as stream:stream.write(body)
    need(read(file)==body,'CreateNew readback failed')

def main():
    need(Path(__file__).resolve()==ROOT/'audit-tools/prepare-native162-sandbox.py','Fixed source required')
    need(not OUT.exists() and not RESULTS.exists(),'Fresh source/result directories required')
    old=json.loads(read(OLD/'overlay-manifest.json','f3d0ce1b9283c9d2f1bd5085d73629b352b27cb2cca28a9f8e8fd04ce9c66359'))
    rows={}
    for row in old['files']:
        body=read(OLD/row['path'],row['sha256']);need(len(body)==row['size'],'Old source size changed')
        need(row['path'].casefold() not in rows,'Duplicate old source')
        rows[row['path'].casefold()]=(row['path'],body)
    previous=ROOT/'sandbox/results/post161-session-a1'
    prep=json.loads(read(previous/'release-162-preparation-a2.json','3577e9ee4984752215465b29564a11343dd425a31916d6947d7fe99780b99c8b'))
    manifest=json.loads(read(previous/'release-162-artifact-a2/release-manifest.json','fe20ea7d83f2e2200624bf81364078ca8b206d1efcc8dbad03b1841d0fab9da2'))
    selected={'project/'+name for name in prep['preparation']['sourceHashes']}
    selected.update('project/desktop/'+name for name in manifest['freeze']['files'])
    tracked=subprocess.check_output(['git','ls-files','-z','stage1','delivery-tools'],cwd=ROOT).decode('utf-8').split('\0')
    selected.update(name for name in tracked if name and Path(name).suffix in {'.py','.cjs','.json','.ps1','.cmd'})
    selected.update('project/desktop/legacy-source/'+name for name in ('ledger/app/templates/stock.html','ledger/finance.py','ledger/inventory_dashboard.py','sidecar_release.py'))
    selected.update('audit-tools/'+name for name in ('guest-run-audit.py','release162-seed-empty.py','release162-selfcheck-a4.py','current-ui-driver.py','host-repeat-162-contract.test.cjs'))
    for name in sorted(selected):
        need(name.split('/')[0] in {'project','stage1','tests','delivery-tools','audit-tools'} and all(p not in ('','.','..') for p in name.split('/')) and not any(c in name for c in '\\:'),'Noncanonical source path')
        need(Path(name).suffix.lower() not in {'.db','.sqlite','.key','.pem','.dll','.pyc','.exe','.asar'},'Binary/secret source refused')
        body=read(ROOT/name);need(not body.startswith(b'SQLite format 3'),'Database refused')
        rows[name.casefold()]=(name,body)
    files=[]
    for name,body in sorted(rows.values()):
        put(OUT/name,body);files.append({'path':name,'size':len(body),'sha256':sha(body)})
    encoded=(json.dumps({'version':1,'purpose':'public source only, native162 isolated reproduction','files':files},ensure_ascii=False,indent=2)+'\n').encode('utf-8')
    put(OUT/'overlay-manifest.json',encoded)
    boot=read(INPUT/'guest-audit-bootstrap-a3.ps1','e6e0c9bc2a166d1da164f067199aaba1a3e4687aa4b7b90fad71ee24f94cafee')
    changes=[(b"$guestOutput='C:\\xjy-results\\bootstrap-a3'",b"$guestOutput='C:\\xjy-results\\bootstrap-a4'"),(b"$overlay='C:\\xjy-input\\overlay-a2'",b"$overlay='C:\\xjy-input\\overlay-native162-a1'"),(b'f3d0ce1b9283c9d2f1bd5085d73629b352b27cb2cca28a9f8e8fd04ce9c66359',sha(encoded).encode())]
    for old_value,new_value in changes:
        need(boot.count(old_value)==(2 if old_value.startswith(b'f3d0') else 1),'Unexpected original boot binding count')
        boot=boot.replace(old_value,new_value)
    put(INPUT/'guest-audit-bootstrap-a4.ps1',boot)
    config=read(ROOT/'sandbox/post161-finance-a1.wsb','08922533844ab1b46641ca41e81928b9fb8def20b104b6e4d130be70d9285bd9')
    needle=b'sandbox\\results\\post161-session-a1';need(config.count(needle)==1,'Unexpected config output binding')
    config=config.replace(needle,b'sandbox\\results\\post162-session-a1')
    need(b'LogonCommand' not in config and b'<Networking>Disable</Networking>' in config,'No automatic business/Internet admission')
    put(ROOT/'sandbox/native162-reproduce-a1.wsb',config)
    ordinary(RESULTS/'bootstrap-a4').mkdir(parents=True,exist_ok=False)
    print(json.dumps({'sourceFiles':len(files),'overlaySha256':sha(encoded),'bootstrapSha256':sha(boot),'configSha256':sha(config),'vmStarted':False,'businessStarted':False}))

if __name__=='__main__':main()
