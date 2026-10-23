"""Preserve only fictional Guest worktree before any proposed environment reset.
No shutdown, deletion, ACL change, key import, database open or product execution.
"""
import os,sys,json,hashlib,importlib.util,stat,zipfile,time
from pathlib import Path
ROOT=Path('C:/xjy-work/xjy-web-stage1');INPUT=Path('C:/xjy-input/guest170-workstate-export-a3')
assert os.name=='nt' and sys.flags.isolated and sys.flags.no_site and sys.flags.dont_write_bytecode and Path(__file__).resolve()==INPUT/'export-guest170-workstate-a3.py'
pin='d630f373911715b3ef5ee80e6fbaeaae838c1469ab53f44759813bc066cf69a7';helper=ROOT/'audit-tools/finance-repack.py'
assert hashlib.sha256(helper.read_bytes()).hexdigest()==pin
spec=importlib.util.spec_from_file_location('fixed',helper);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);proof=m.admit(pin)
assert json.loads(m.stable(ROOT/'isolation-identity.json'))['namespace']=='36fcbe9c-ece1-4be3-af35-309a2ee19e05'
out=Path('C:/xjy-results/guest170-workstate-export-a3');m.ordinary(out.parent,out.parent);out.mkdir(exist_ok=False)
files=[];directories=[];special=[]
def walk(parent):
 for e in os.scandir(parent):
  p=Path(e.path);s=p.lstat();rel=p.relative_to(ROOT).as_posix()
  if stat.S_ISLNK(s.st_mode) or getattr(s,'st_file_attributes',0)&0x400:
   special.append({'path':rel,'kind':'reparse-not-followed','attributes':getattr(s,'st_file_attributes',0)});continue
  if stat.S_ISDIR(s.st_mode):directories.append(rel);walk(p)
  elif stat.S_ISREG(s.st_mode) and s.st_nlink==1:files.append((rel,p,s))
  else:special.append({'path':rel,'kind':'nonordinary-or-hardlink-not-read','links':s.st_nlink})
walk(ROOT)
assert len(files)>0 and {'isolation-identity.json','project/desktop/package.json'}.issubset({r[0] for r in files}),'Required source and identity missing; not a usable archive'
total=sum(s.st_size for _,_,s in files);assert len(files)<=200000 and total<=107374182400
records=[];archive=out/'fictional-workstate.zip'
with zipfile.ZipFile(archive,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=1,allowZip64=True) as z:
 for index,(rel,p,before) in enumerate(files):
  assert m.identity(p.lstat())==m.identity(before),'changed before snapshot: '+rel
  h=hashlib.sha256();size=0
  with p.open('rb') as src,z.open(rel,'w',force_zip64=True) as dst:
   opened=os.fstat(src.fileno());assert all(getattr(opened,k)==getattr(before,k) for k in ('st_dev','st_ino','st_size','st_mtime_ns','st_nlink'))
   while block:=src.read(4194304):h.update(block);size+=len(block);dst.write(block)
   assert m.identity(os.fstat(src.fileno()))==m.identity(opened)
  assert size==before.st_size and m.identity(p.lstat())==m.identity(before),'changed during snapshot: '+rel
  records.append({'path':rel,'size':size,'sha256':h.hexdigest()})
  if index%250==0:(out/'progress.json').write_text(json.dumps({'stage':'archiving','completed':index+1,'total':len(files),'sourceBytes':total}),'utf-8')
 manifest={'purpose':'fictional-guest-workstate-preservation','namespace':'36fcbe9c-ece1-4be3-af35-309a2ee19e05','actualContext':proof,'sourceRoot':str(ROOT),'files':records,'directories':directories,'notFollowed':special,'productionDataRead':False,'databaseOpened':False,'databaseRestoreVerified':False,'limitations':'file-level snapshot of this virtual worktree; special/reparse entries recorded without reading targets; not a production backup'}
 body=json.dumps(manifest,ensure_ascii=False,indent=2).encode();z.writestr('snapshot-manifest.json',body)
for rel,p,before in files:
 assert m.identity(p.lstat())==m.identity(before),'Source changed across snapshot: '+rel
verify=[]
with zipfile.ZipFile(archive) as z:
 assert len(z.infolist())==len(records)+1
 for index,r in enumerate(records):
  h=hashlib.sha256();size=0
  with z.open(r['path']) as src:
   while block:=src.read(4194304):h.update(block);size+=len(block)
  assert size==r['size'] and h.hexdigest()==r['sha256']
  if index%250==0:(out/'progress.json').write_text(json.dumps({'stage':'verifying','completed':index+1,'total':len(records)}),'utf-8')
 assert z.read('snapshot-manifest.json')==body
m.admit(pin);h=hashlib.sha256()
with archive.open('rb') as src:
 while block:=src.read(4194304):h.update(block)
result={'complete':True,'files':len(records),'sourceBytes':total,'archiveBytes':archive.stat().st_size,'archiveSha256':h.hexdigest(),'manifestSha256':hashlib.sha256(body).hexdigest(),'skippedSpecialEntries':len(special),'allArchivedFileCrcShaVerified':True,'databaseRestoreVerified':False,'existingFictionalEmployeeProcessRetained':6360,'sourceFileMetadataUnchangedAcrossSnapshot':True,'guestStopped':False,'formalSystemChanged':False}
(out/'snapshot-manifest.json').write_bytes(body);(out/'result.json').write_text(json.dumps(result,indent=2),'utf-8');print(json.dumps(result))
