#!/usr/bin/env python3
"""Root-only data/source binding for internal native acceptance, never release evidence.
Reads fixed program metadata and frozen sources. No subprocess, services, keys,
production path discovery, signing, installation, or existing-file replacement.
"""
import argparse, base64, hashlib, json, os, pathlib, re, stat
ROOT=pathlib.Path(r'E:\codex\2026-10-15\work\xjy-v16-deep-audit')
SEAL=ROOT/'reports/release-162-host-seal-a5.json'
PINS={'audit-tools/employee160-rescue-preflight.cjs': 'ed3684d26bcb74f9a9e3591427a0cf14cbd58dcf45430ac4bd64fd7dfba45c71', 'audit-tools/employee161-rescue-preflight-a4.cjs': '980441c0f7972cbd3d53ac0d8daae54d3c6130514f3600f79abb7d6badba4374', 'audit-tools/employee160-rescue-controller-persistent-a1.cjs': '51d100dfd5f06e8ddca11201ae3d637bf0b1e923aef6819196a7add307cfcad9', 'audit-tools/employee161-rescue-controller-persistent-a1.cjs': '868771c183b41c5e9bd8fc53484ef0b0c05d8448a6b044a3ec88d054a474c83c', 'audit-tools/employee160-utf8-compat-helper-persistent-a1.cjs': 'bda07ec4bc3b09a05872cc2687073ace62d022f406ed28dedd191d1f19a59b5c', 'audit-tools/employee161-utf8-compat-helper-persistent-a1.cjs': '0795ccdef13d2a62b2473c9722ba418be15feb7c88996758d3027ee32cbf4ce4', 'audit-tools/updater-helper-persistent-a2.cjs': 'd7c7c877dc8bcec3bb07250a252485d8f81b943ed9fb5ddb73f7364912bc2e5c', 'audit-tools/employee160-oneclick-worker.cjs': '3ff31f04ac12ecaeef44b2e347623869b672624a6324cee4a9a5af79349ba7e7', 'audit-tools/employee161-oneclick-worker-a2.cjs': '40e588f4ba16c38218317e8aa6d369b3dea20890ac9239a56fa116e8c46f947d', 'audit-tools/employee160-oneclick-launcher.cs': '1f8fcfb9243bce91e1834fb62173ce4b35a2a083202fa6e88f773b6a44e549af', 'audit-tools/employee161-oneclick-launcher-a2.cs': 'fe5a8dd17c019bee1e832eaacac53426d7898ca7f166c7f3d1fcb5940a97e3a4', 'delivery-tools/initial-patch-core.cjs': '0f9de31c8ad8ec7e1b870a92d025909f4606363801a31ee3582b903c5704bbce', 'delivery-tools/initial-patch-entry.cjs': '4c0008c6f070c22255f3a2819ac82e9be774fbaf631030bb414c95bbcac6b161', 'delivery-tools/initial-patch-backup.cjs': 'f2d7262eae5ba3b3048e42753f96e49cd53746940ea22bbe32b0b1f93f3de8e0', 'delivery-tools/initial-source-lease.cjs': '5a6a84eaaae2e10c11c1473a2da8ef6b9ba70f41378094e83054ee67ae7d6ce2', 'delivery-tools/Initial-Source-Lock.ps1': '6a61a66f873ff92646c3a01064619fc3aff405a2d9161edea66fa57c2856b211', 'delivery-tools/Initial-Path-Guard.ps1': '4b51ba8e7300e0ce8875dcb2a3b060622d84f81459b8cc758d16c4f94eb3f8d7', 'project/desktop/employee-update-cache.cjs': '5cb70079bf161a002a2701694e4774c2a11bf8d54efc6674ccb5c7b2c6729815', 'project/desktop/employee-update-installer.cjs': '96ba3df08a0f706e599da7d452374b1f894d401c0a6ff605fc01255d01445bd0', 'project/desktop/employee-recovery-entry.cjs': 'd984126ad08263aa4ae6be3bc547db758e4d75b6b94bd3346ead21f8121f6fce', 'project/desktop/updater-helper.cjs': 'e60b4c84413e215f06f50f3320b5621ba5d1b439ab0167e2a1d4ab810a6bcb90', 'project/desktop/initial-upgrade-gate.cjs': 'b74a80b83dfaf78f493671bf4bc339f68eeec4f2f89a71410e6cd7d7f78a1980', 'project/desktop/launch-role.cjs': '22b6c570574c154208181a4c4fb6bad3963408f321aa319047b465fb8cb8d248'}
CATALOG='230b9825c9c05749d193d9fdcb30906b084186fe7fdee3a22884085399001000'
POLICY='848927d754427c7b6017233d63327ab6799bf08221b33b98522e8d5db879c3f5'
ENVELOPE='3def76cbdab9f83696c8af4a56e5e4673d045b514b5ed1e0069ba9db7a9a7817'
PUB='6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c'
SHA=re.compile(r'^[a-f0-9]{64}$')
def need(value,message):
 if not value:raise ValueError(message)
def digest(data):return hashlib.sha256(data).hexdigest()
def ordinary(p,missing=False):
 p=pathlib.Path(os.path.abspath(p));need(p.is_relative_to(ROOT),'Fixed workspace only')
 for q in [p,*p.parents]:
  if missing and q==p and not q.exists():continue
  s=q.lstat();need(not stat.S_ISLNK(s.st_mode) and not (getattr(s,'st_file_attributes',0)&0x400),'Alias/reparse point refused')
  need(q.resolve()==q,'Canonical ordinary path required')
  if stat.S_ISREG(s.st_mode):need(s.st_nlink==1,'Hardlink refused')
  else:need(stat.S_ISDIR(s.st_mode),'Ordinary file/directory required')
 return p
def identity(s):return tuple(getattr(s,k) for k in ['st_dev','st_ino','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns'])
def read(p,pin=None,limit=2097152):
 p=ordinary(p);before=p.stat();need(stat.S_ISREG(before.st_mode) and before.st_size<=limit,'Bounded ordinary file required')
 with p.open('rb') as f:
  opened=os.fstat(f.fileno());need(identity(opened)[:-1]==identity(before)[:-1],'Named input changed');data=f.read(limit+1);need(identity(os.fstat(f.fileno()))==identity(opened),'Input handle changed')
 need(identity(p.lstat())==identity(before),'Input name changed');need(len(data)<=limit,'Input oversized')
 if pin is not None:need(digest(data)==pin,'Input SHA mismatch: '+str(p))
 return data
def unique(pairs):
 result={}
 for k,v in pairs:need(k not in result,'Duplicate JSON key');result[k]=v
 return result
def parse(data):return json.loads(data,object_pairs_hook=unique)
def replace_one(text,pattern,value):
 text,n=re.subn(pattern,lambda m:value,text);need(n==1,'Expected exactly one binding: '+pattern);return text

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--expectedSealSha256',required=True);args=ap.parse_args();need(os.name=='nt' and SHA.fullmatch(args.expectedSealSha256),'Windows and explicit seal SHA required')
 need(pathlib.Path(__file__).resolve()==ROOT/'audit-tools/bind-employee162-a5-candidates-a2.py','Fixed source location required')
 source={k:read(ROOT/k,v) for k,v in PINS.items()};report=parse(read(SEAL,args.expectedSealSha256))
 need(report['purpose']=='host-repeat-162-internal-material' and report['programVersion']=='1.6.2' and report['sealed'] is True,'Exact sealed report required')
 for k in ['published','installed','programExecuted','privateKeyRead','privateKeyIncluded','installable']:need(report[k] is False,'Report state not admitted: '+k)
 need(report['internalOperatorOnly'] is True and report['resourceCatalogSigned'] is True and report['sourcePolicySigned'] is True,'Signed internal material required')
 sealed=ROOT/'release-work/initial-162-host-sealed-a5';need(pathlib.Path(report['directory'])==sealed,'Fixed sealed directory required')
 need(report['sourcePolicySha256']==POLICY and report['sourcePolicyEnvelopeSha256']==ENVELOPE,'Original signed source policy required')
 pe=parse(read(sealed/'source-policy-envelope.json',ENVELOPE));need(digest(pe['policy'].encode())==POLICY,'Exact signed policy bytes required');policy=parse(pe['policy'])
 ce=parse(read(sealed/'catalog-envelope.json'));need(digest(ce['catalog'].encode())==CATALOG,'Exact seq11 catalog required');catalog=parse(ce['catalog'])
 need(policy==report['sourcePolicy'] and policy['catalogSha256']==CATALOG and policy['publisherPublicKeySha256']==PUB,'Report/policy binding differs')
 need(catalog['sequence']==11 and catalog['version']=='1.6.2' and catalog['sourceVersions']==['1.6.0','1.6.1','1.6.2'] and len(catalog['files'])==1007,'Exact target/source catalog required')
 need(len({r['version'] for r in policy['sourcePrograms']})==3,'Unique approved sources required')
 need(catalog['archive']=={'size':163521799,'sha256':'752d780b2a460ecb10bb1dbeee53187dd8486f697d0d9c9f082c8408888e866a'},'Original target ZIP required')
 need(next(x for x in catalog['files'] if x['path']=='resources/app.asar')=={'path':'resources/app.asar','size':12570325,'sha256':'28e24d0dea9416258b67edc2b6fe6aca8683c68d02c9fc305626660dd4c55e6f'},'Original target ASAR required')
 for k in ['treeSha256','artifactSha256']:need(SHA.fullmatch(report[k]) and report[k]!='0'*64,'Bound sealed metadata required')
 need(report['approvalTemplate']['artifactSha256']==report['artifactSha256'] and report['approvalTemplate']['treeSha256']==report['treeSha256'] and report['approvalTemplate']['sourcePolicySha256']==POLICY,'Approval template differs')
 fixed={'publisher':PUB,'catalog':CATALOG,'policy':POLICY,'envelope':ENVELOPE,'tree':report['treeSha256'],'artifact':report['artifactSha256']}
 output={}
 helpers=['audit-tools/employee160-utf8-compat-helper-persistent-a1.cjs','audit-tools/employee161-utf8-compat-helper-persistent-a1.cjs'];adapter='audit-tools/updater-helper-persistent-a2.cjs'
 for version,pre,worker,launcher in [('160','employee160-rescue-preflight.cjs','employee160-oneclick-worker.cjs','employee160-oneclick-launcher.cs'),('161','employee161-rescue-preflight-a4.cjs','employee161-oneclick-worker-a2.cjs','employee161-oneclick-launcher-a2.cs')]:
  def new(kind,ext='cjs'):return 'audit-tools/employee'+version+'-'+kind+'-release-a5.'+ext
  pfile,cfile,wfile,lfile=new('rescue-preflight'),new('rescue-controller'),new('oneclick-worker'),new('oneclick-launcher','cs')
  text=source['audit-tools/'+pre].decode();text=replace_one(text,r'const FIX=Object\.freeze\(\{[^\n]+\}\);','const FIX=Object.freeze('+json.dumps(fixed,separators=(',',':'))+');');text=text.replace('catalog.sequence===10','catalog.sequence===11').replace('sequence 10','sequence 11');output[pfile]=text.encode()
  controller=source['audit-tools/employee'+version+'-rescue-controller-persistent-a1.cjs'].decode();controller=controller.replace('SEQUENCE=10','SEQUENCE=11').replace('sequence 10','sequence 11');output[cfile]=controller.encode()
  text=source['audit-tools/'+worker].decode();m=re.search(r'const RELEASE_JSON = String.raw`([^`]+)`;',text);need(m is not None,'Literal release JSON required');r=parse(m[1]);r.update(bound=True,compatibilityHelperVerified=True,sequence=11,catalogSha256=CATALOG,policySha256=POLICY,treeSha256=report['treeSha256'],preflight=pfile,controller=cfile)
  expected=next(x for x in policy['sourcePrograms'] if x['version']=='1.6.'+version[-1]);need(r['sourceAsar']=={'size':expected['asarSize'],'sha256':expected['asarSha256']},'Exact source tuple differs')
  r['codePins']={k:v for k,v in r['codePins'].items() if not k.startswith('audit-tools/')};r['codePins'].update({pfile:digest(output[pfile]),cfile:digest(output[cfile]),**{k:PINS[k] for k in [*helpers,adapter]}});need(len(r['codePins'])==17,'Exact 17 dependency pins required')
  text=text[:m.start(1)]+json.dumps(r,ensure_ascii=False,separators=(',',':'))+text[m.end(1):];text=text.replace('RELEASE.sequence===10','RELEASE.sequence===11').replace('sequence10','sequence11').replace('a4/sequence10','a5/sequence11');text=text.replace("RELEASE.controller!=='audit-tools/employee161-rescue-controller.cjs'","RELEASE.controller==='"+cfile+"'")
  if version=='160':text=text.replace("RELEASE.controller==='audit-tools/employee160-rescue-controller.cjs'","RELEASE.controller==='"+cfile+"'").replace("RELEASE.preflight==='audit-tools/employee160-rescue-preflight.cjs'","RELEASE.preflight==='"+pfile+"'")
  output[wfile]=text.encode();launch=source['audit-tools/'+launcher].decode();launch=replace_one(launch,r'const string WorkerSha="[^"]+";','const string WorkerSha="'+digest(output[wfile])+'";');launch=launch.replace(worker,pathlib.PurePosixPath(wfile).name)
  need(launch.count('Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory)')==1,'Exact package root declaration required');launch=launch.replace('Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory)','Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"安装组件"))')
  rows=[]
  for k in sorted([wfile,*r['codePins']]):
   b=output[k] if k in output else source[k];rows.append({'path':k,'size':len(b),'sha256':digest(b)})
  need(len(rows)==18,'Exact 18-row dependency closure required');canonical=''.join(x['path']+'\0'+str(x['size'])+'\0'+x['sha256']+'\n' for x in rows).encode()
  launch=replace_one(launch,r'const string ClosureSha="[^"]+";','const string ClosureSha="'+digest(canonical)+'";');launch=replace_one(launch,r'const string ClosureRows="[^"]+";','const string ClosureRows="'+base64.b64encode(json.dumps(rows,separators=(',',':')).encode()).decode()+'";');output[lfile]=launch.encode()
 # Check every target before CreateNew. No existing source is overwritten.
 for name in output:ordinary(ROOT/name,missing=True);need(not (ROOT/name).exists(),'Output already exists: '+name)
 # Recheck frozen sources and report before writing outputs.
 for k,pin in PINS.items():read(ROOT/k,pin)
 read(SEAL,args.expectedSealSha256)
 for name,data in output.items():
  target=ROOT/name;ordinary(target,missing=True)
  with target.open('xb') as f:f.write(data);f.flush();os.fsync(f.fileno())
  read(target,digest(data));print(json.dumps({'file':name,'size':len(data),'sha256':digest(data),'internalNativeAcceptanceCandidate':True,'nativeAccepted':False,'published':False},ensure_ascii=False))
if __name__=='__main__':main()
