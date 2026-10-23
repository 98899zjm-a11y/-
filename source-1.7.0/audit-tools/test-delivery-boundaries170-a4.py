"""Actual Guest tests of the unchanged PS preflight and owned-cache extractor."""
import os,sys,json,hashlib,importlib.util,base64,subprocess,zipfile
from pathlib import Path
ROOT=Path('C:/xjy-work/xjy-web-stage1'); INPUT=Path('C:/xjy-input/delivery-boundaries170-a4')
assert os.name=='nt' and sys.flags.isolated and sys.flags.no_site and sys.flags.dont_write_bytecode
assert Path(__file__).resolve()==INPUT/'audit-tools/test-delivery-boundaries170-a4.py'
helper=ROOT/'audit-tools/finance-repack.py';pin='d630f373911715b3ef5ee80e6fbaeaae838c1469ab53f44759813bc066cf69a7'
assert hashlib.sha256(helper.read_bytes()).hexdigest()==pin
spec=importlib.util.spec_from_file_location('fixed',helper);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);proof=m.admit(pin)
assert json.loads(m.stable(ROOT/'isolation-identity.json'))['namespace']=='36fcbe9c-ece1-4be3-af35-309a2ee19e05'
PINS={'delivery-tools/UpdateProgressView170.ps1':'9b872b4ced9f9d915a7e39a95a6e35b7914745d6865295fb17428b26a79856ab','delivery-tools/Native-Delivery-170.ps1.in':'358c1c2074d62fb9fab23f9dd6755c2902ecf22aea9200dd54cc4e70b133ecb4','delivery-tools/Initial-Path-Guard.ps1':'4b51ba8e7300e0ce8875dcb2a3b060622d84f81459b8cc758d16c4f94eb3f8d7','delivery-tools/Extract-Bridge170.ps1':'38f18d30a658c9477ae43332319a28627332b2593b6b64cdd41cc12d24e4862f'}
bodies={p:m.pinned(INPUT/p,h,INPUT) for p,h in PINS.items()}
work=ROOT/'runtime/delivery-boundaries170-a4';m.mkdir_new(work)
out=Path('C:/xjy-results/delivery-boundaries170-a4');m.ordinary(out.parent,out.parent);out.mkdir(exist_ok=False)
def sha(b):return hashlib.sha256(b).hexdigest()
def put(p,b):p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b)
def q(s):return "'"+str(s).replace("'","''")+"'"
def invoke(label,source,parameters):
    # Keep the encoded command short; Windows has a command-line length limit.
    # The generated preflight is stored only in this owned synthetic run.
    script=work/(label+'-harness.ps1');body=b'\xef\xbb\xbf'+source.encode();put(script,body)
    code="$ErrorActionPreference='Stop';$file="+q(script)+";$h=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant();if($h -cne "+q(sha(body))+"){throw 'Harness changed'};$s=[IO.File]::ReadAllText($file,[Text.Encoding]::UTF8);$p=@{"+';'.join(k+'='+q(v) for k,v in parameters.items())+"};& ([ScriptBlock]::Create($s)) @p"
    command=['C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe','-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',base64.b64encode(code.encode('utf-16le')).decode()]
    with (out/(label+'.stdout')).open('xb') as stdout,(out/(label+'.stderr')).open('xb') as stderr:
        r=subprocess.run(command,cwd=work,stdin=subprocess.DEVNULL,stdout=stdout,stderr=stderr,creationflags=0x08000000,shell=False)
    return r.returncode
results=[]
def record(name,actual,expected,detail=None):
    passed=(actual==0)==expected
    results.append({'name':name,'exitCode':actual,'expectedSuccess':expected,'passed':passed,'detail':detail})
    (out/'progress.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),'utf-8')

# Execute the original preflight prefix, stopping before mode selection/spawn.
template=bodies['delivery-tools/Native-Delivery-170.ps1.in'].decode('utf-8-sig')
assert template.count(' $mode=switch($Action)')==1
prefix=template.split(' $mode=switch($Action)')[0]
prefix=prefix.replace('@@PROGRESS_VIEW@@',bodies['delivery-tools/UpdateProgressView170.ps1'].decode('utf-8-sig'))
prefix=prefix.replace('@@PATH_GUARD@@',bodies['delivery-tools/Initial-Path-Guard.ps1'].decode('utf-8-sig'))
suffix="[Console]::WriteLine('PREFLIGHT_OK');exit 0}catch{[Console]::Error.WriteLine($_.Exception.Message);exit 1}finally{Close-XjyProgressView -View $progressView;for($i=$held.Count-1;$i -ge 0;$i--){$held[$i].Dispose()}}"
for name,action,dynamic,extra,missing,expected in [('P1','Upgrade',0,False,False,True),('P2','Bridge',1,False,False,True),('P3','Bridge',2,False,False,True),('P4','Bridge',1,True,False,False),('P5','Bridge',1,False,True,False)]:
    case=work/name;case.mkdir()
    for rel in ['一键升级.cmd','首次安装主机.cmd','首次安装员工.cmd','安装组件/native-delivery-170.ps1']:put(case/rel,b'SYNTHETIC; NOT EXECUTED')
    body=b'SYNTHETIC EXPECTED FILE';rows=[{'path':'fixed.txt','size':len(body),'sha256':sha(body)}]
    if not missing:put(case/'fixed.txt',body)
    if dynamic:put(case/'engine-bridge-handoff.json',b'{}')
    if dynamic==2:put(case/'engine-bridge-accepted.json',b'{}')
    if extra:put(case/'unexpected.txt',b'EXTRA')
    script=prefix.replace('@@FILES_BASE64@@',base64.b64encode(json.dumps(rows).encode()).decode())+suffix
    record(name,invoke(name,script,{'PackageRoot':case,'Action':action}),expected)

extractor=bodies['delivery-tools/Extract-Bridge170.ps1'].decode('utf-8-sig')
def extract_case(name,mode):
    case=work/name;case.mkdir();files={'完整程序/readme.txt':b'SYNTHETIC PROGRAM','受信助手/tool.cjs':b'// SYNTHETIC NOT EXECUTED'}
    if mode=='traversal':files={'../escaped.txt':b'ESCAPE'}
    rows=[{'path':k,'size':len(v),'sha256':sha(v)} for k,v in files.items()]
    if mode=='bad-hash':rows[0]['sha256']='0'*64
    manifest=json.dumps({'version':1,'purpose':'xjy-native-bridge-bundle170','files':rows},ensure_ascii=False).encode()
    put(case/'payload-manifest.json',manifest)
    with zipfile.ZipFile(case/'payload.zip','w',compression=zipfile.ZIP_DEFLATED) as z:
        for rel,b in files.items():z.writestr(rel,b)
    if mode=='partial':put(case/'bundle/完整程序/readme.txt',b'PARTIAL')
    argv={'OperationRoot':case,'ArchiveSha256':sha((case/'payload.zip').read_bytes()),'ManifestSha256':sha(manifest)}
    code=invoke(name,extractor,argv)
    if mode in ('normal','partial') and code==0:
        assert all((case/'bundle'/rel).read_bytes()==b for rel,b in files.items())
        if mode=='partial':assert [p.read_bytes() for p in (case/'retained-partials').iterdir()]==[b'PARTIAL']
    if mode=='traversal':assert not (case/'escaped.txt').exists() and not (work/'escaped.txt').exists()
    record(name,code,mode in ('normal','partial'))
    if mode=='normal':record(name+'-repeat',invoke(name+'-repeat',extractor,argv),True)
for label,mode in [('X1','normal'),('X2','partial'),('X3','traversal'),('X4','bad-hash')]:extract_case(label,mode)
m.admit(pin)
result={'complete':True,'passed':all(r['passed'] for r in results),'tests':results,'actualContext':proof,'sourcePins':PINS,'preflightOnly':True,'nativeInstallerExecuted':False,'businessExecuted':False,'productionAccessed':False}
(out/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),'utf-8')
print(json.dumps({'passed':result['passed'],'cases':len(results),'resultSha256':sha((out/'result.json').read_bytes())}))
raise SystemExit(0 if result['passed'] else 1)
