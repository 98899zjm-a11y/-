"""Host data-only version/hash observation. No DB/config/account/key or program execution."""
from pathlib import Path
import hashlib,json,os,stat,struct
ROOT=Path(__file__).resolve().parents[1]
INSTALL=Path('F:/自制软件/xjy-jewelry-offline')
FILES={'asar':INSTALL/'resources/app.asar','engine':INSTALL/'鑫金源珠宝报价.exe',
       'runningLedger':Path('F:/鑫金源珠宝资料/后台运行/内部模块/ledger-1.3.0-b9a5d4fd9c6cb408c509589f/xjy-ledger.exe')}
def ordinary(file):
    for part in (file,*file.parents):
        s=part.lstat()
        assert not stat.S_ISLNK(s.st_mode) and not os.path.isjunction(part) and not getattr(s,'st_file_attributes',0)&0x400
        assert not stat.S_ISREG(s.st_mode) or s.st_nlink==1
def signature(s):return(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
rows={};identities={}
for label,file in FILES.items():
    ordinary(file);before=file.stat()
    with file.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
    assert signature(before)==signature(file.stat())
    identities[label]=signature(before)
    rows[label]={'file':str(file),'bytes':before.st_size,'sha256':digest}
archive=FILES['asar']
with archive.open('rb') as stream:
    marker,size=struct.unpack('<II',stream.read(8));assert marker==4 and 8<size<16*1024*1024
    header=stream.read(size);length=struct.unpack('<I',header[4:8])[0];assert 0<length<=size-8
    tree=json.loads(header[8:8+length]);package=tree['files']['package.json'];assert 0<package['size']<65536
    stream.seek(8+size+int(package['offset']));pkg=json.loads(stream.read(package['size']))
assert signature(FILES['asar'].stat())==identities['asar']
result={'purpose':'current-program-public-metadata-only','package':{k:pkg.get(k) for k in ('name','version','main')},'files':rows,'productionDatabaseRead':False,'configurationRead':False,'productionWrites':False}
target=ROOT/'reports/current-program-metadata-20261018-a1.json'
with target.open('x',encoding='utf8') as stream:json.dump(result,stream,ensure_ascii=False,indent=2)
print(json.dumps({'version':result['package']['version'],'main':result['package']['main'],'hashes':{k:v['sha256'] for k,v in rows.items()},'report':str(target)},ensure_ascii=False))
