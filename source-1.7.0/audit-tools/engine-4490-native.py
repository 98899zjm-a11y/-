"""Fixed Guest seed/packaged Host self-check only. Root runs; never kill/clean up."""
import argparse, hashlib, importlib.util, json, os, stat, subprocess, sys, time
from pathlib import Path

ROOT = Path('C:/xjy-work/xjy-web-stage1')
BASE = ROOT/'release-work/engine-4490-a1'
PROGRAM, PYTHON = BASE/'program', Path('C:/Python314/python.exe')
EXE = PROGRAM/'鑫金源珠宝报价.exe'
PS = Path('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe')
RESULTS = Path('C:/xjy-results')
MANIFEST_SHA = 'c70dab515150a84327f49c032240858741cd97a78c25f714f642b4fc72e2c6d7'
EXE_SHA = 'c99a56d653220a8bf209b0b9ae2424ec1f1580946d1bf3395a968eb211a4f1b5'
PREP_REPORT_SHA = '3afa0e9bf46aece7129f479e16e64468bcdba5e80c1f8a10383cdda47a8d6463'
PREP_SHA = '3b912abc4ce228b69a203959cd598dc224678f41809b35272b925c7c9330a9a0'
PINS = {
 'stage1/sandbox-context.py': '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
 'stage1/validate-sandbox-context.py': '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207',
 'stage1/run-restricted.py': '742e25f5405f69a345c7557e19bfa674a490ae0e57c9d5c957922a9e41b6b1bc',
 'stage1/host.cjs': '887191c81ca04087ac64246ea2422e31305965c7312261504fab8ea341622d5f',
 'stage1/create-fixture.py': 'a8051b880333a988c79e29fb90596563f07af1d8d9b6b5272f1a70bc4580e75a',
}
GENERATED = ('business.cjs', 'print-domain.cjs', 'print-worker-templates.cjs', 'print-worker-preload.cjs')
SLOTS = [ROOT/'data'/d/f for d, f in (('sales','jewelry.sqlite'),('ledger','ledger.db'),('inventory','stockcheck.db'))]
PROFILES = [ROOT/'config'/x for x in ('desktop-profile','employee-profile')]
sha = lambda b: hashlib.sha256(b).hexdigest()

def need(value, message):
    if not value: raise RuntimeError(message)

def ordinary(file):
    file = Path(file)
    need(file.is_absolute() and (file.is_relative_to(ROOT) or file.is_relative_to(RESULTS)), 'Owned path required')
    for p in (file, *file.parents):
        try: s = p.lstat()
        except FileNotFoundError: continue
        need(not stat.S_ISLNK(s.st_mode) and not getattr(s,'st_file_attributes',0)&0x400, 'Reparse path refused')
        need(not stat.S_ISREG(s.st_mode) or s.st_nlink == 1, 'Hardlink refused')
    need(os.path.normcase(str(file.resolve())) == os.path.normcase(str(file)), 'Path alias refused')
    return file

def read(file, pin=None):
    file = ordinary(file); a = file.stat(); need(stat.S_ISREG(a.st_mode) and a.st_size <= 512*1024*1024, 'Bounded regular input required')
    stamp = lambda s: tuple(getattr(s,k,None) for k in ('st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns','st_nlink','st_birthtime_ns'))
    with file.open('rb') as h:
        b = os.fstat(h.fileno()); body = h.read(); c = os.fstat(h.fileno())
    d = ordinary(file).stat()
    need(stamp(a)==stamp(d) and stamp(b)==stamp(c), 'Input changed during read')
    need(all(getattr(a,k)==getattr(b,k) for k in ('st_dev','st_ino','st_size','st_mtime_ns','st_nlink')), 'Input identity changed')
    need(len(body)==a.st_size and (pin is None or sha(body)==pin), 'Input digest mismatch')
    return body

def load(file, pin=None): return json.loads(read(file,pin))

def put(file, body):
    file = ordinary(file); ordinary(file.parent).mkdir(parents=True,exist_ok=True); ordinary(file.parent)
    with file.open('xb') as h: h.write(body); h.flush(); os.fsync(h.fileno())
    need(read(file)==body, 'CreateNew verification failed')

def save(file, value): put(file,(json.dumps(value,ensure_ascii=True,indent=2)+'\n').encode())

def actual():
    need(os.name=='nt' and Path(__file__).absolute()==ROOT/'audit-tools/engine-4490-native.py', 'Fixed actual Guest script required')
    for name,pin in PINS.items(): read(ROOT/name,pin)
    spec=importlib.util.spec_from_file_location('original_native_guest',ROOT/'stage1/sandbox-context.py')
    module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    proof=module.read_context(ROOT)
    need(load(ROOT/'isolation-identity.json')['namespace']=='2c48091c-c205-41b4-88a9-5ebdd24b24a9','This actual Guest namespace required')
    return proof

def verify_inputs():
    m=load(BASE/'runtime-manifest.json',MANIFEST_SHA)
    need(m['purpose']=='xjy-engine-4490-isolated-runtime' and m['engineVersion']=='44.9.0' and Path(m['engineRoot'])==PROGRAM,'Runtime identity differs')
    need(m['sourceCommit']=='175b5aa1c7ff24dc84ce709ec10efe1c19a0b5d8' and m['signedForProduction'] is False and m['publicAccess'] is False and m['defaultAppRemoved'] is True,'Runtime scope differs')
    rows=m['programFiles']; names=[]
    for row in rows:
        name=row['path']; need(isinstance(name,str) and not any(c in name for c in '\\:\x00') and all(x and x not in ('.','..') and x.rstrip('. ')==x for x in name.split('/')),'Unsafe runtime row')
        body=read(PROGRAM/name,row['sha256']); need(len(body)==row['size'],'Runtime size differs'); names.append(name)
    found=[]
    for parent,dirs,files in os.walk(ordinary(PROGRAM),followlinks=False):
        for name in dirs+files: ordinary(Path(parent)/name)
        found.extend((Path(parent)/name).relative_to(PROGRAM).as_posix() for name in files)
    need(len(set(x.casefold() for x in names))==len(names) and sorted(names)==sorted(found),'Runtime tree differs')
    need('resources/default_app.asar' not in names,'Default app forbidden'); read(EXE,EXE_SHA)
    freeze=load(BASE/'source-freeze.json',m['sourceFreezeSha256'])
    for name,pin in freeze['files'].items(): read(ROOT/'project/desktop'/name,pin)
    report=load(RESULTS/'engine-4490-preparation-a1.json',PREP_REPORT_SHA)
    prep=load(BASE/'build/preparation.json',PREP_SHA)
    need(report['phase']=='prepare' and report['prepared'] is True and report['savedPreparation']['sha256']==PREP_SHA and report['preparation']==prep,'Preparation evidence differs')
    need(prep['programVersion']=='1.6.1' and Path(prep['app'])==BASE/'build/app-input' and prep['dataIncluded'] is False and prep['serviceStarted'] is False,'Preparation scope differs')
    for name,pin in prep['sourceHashes'].items(): read(ROOT/'project'/name,pin)
    return prep

def environment(scratch, native=False):
    ordinary(scratch).mkdir(parents=True,exist_ok=True)
    env={'SystemRoot':'C:\\Windows','WINDIR':'C:\\Windows','COMSPEC':'C:\\Windows\\System32\\cmd.exe','PATHEXT':'.COM;.EXE;.BAT;.CMD','PATH':'C:\\Windows\\System32','PSModulePath':'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules'}
    env.update({key:str(scratch) for key in ('TEMP','TMP','APPDATA','LOCALAPPDATA','USERPROFILE')})
    if native: env.update(XJY_RELEASE_TEST_ROOT=str(ROOT),XJY_DATA_DIR=str(ROOT/'data/sales'))
    return env

def observe(output, sequence, root_pid=0):
    script="$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $p=@(Get-CimInstance Win32_Process | Where-Object {($_.ExecutablePath -and $_.ExecutablePath.StartsWith('"+str(PROGRAM).replace("'","''")+"\\',[StringComparison]::OrdinalIgnoreCase)) -or ("+str(root_pid)+" -gt 0 -and $_.ProcessId -eq "+str(root_pid)+")} | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine,@{n='CreationUtc';e={$_.CreationDate.ToUniversalTime().ToString('o')}}); $ids=@($p.ProcessId); $t=@(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object {$_.OwningProcess -in $ids -or $_.LocalPort -in @(42791,42831,42841)} | Select-Object @{n='Protocol';e={'TCP'}},LocalAddress,LocalPort,OwningProcess); $u=@(Get-NetUDPEndpoint -ErrorAction Stop | Where-Object {$_.OwningProcess -in $ids} | Select-Object @{n='Protocol';e={'UDP'}},LocalAddress,LocalPort,OwningProcess); [ordered]@{processes=$p;listeners=@($t+$u)} | ConvertTo-Json -Depth 4 -Compress"
    import base64
    files=[ordinary(output/(sequence+'.stdout.log')),ordinary(output/(sequence+'.stderr.log'))]
    with files[0].open('xb') as out,files[1].open('xb') as err:
        proc=subprocess.Popen([str(PS),'-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',base64.b64encode(script.encode('utf-16le')).decode()],cwd=ROOT,env=environment(output/'scratch'),stdin=subprocess.DEVNULL,stdout=out,stderr=err,creationflags=0x08000000)
        code=proc.wait(timeout=30)
    need(code==0,'Read-only observation failed'); value=load(files[0]); save(output/(sequence+'.json'),value)
    return value

def clean_samples(output, label):
    values=[]
    for index in range(2):
        value=observe(output,label+'-'+str(index+1)); values.append(value)
        if index==0: time.sleep(.6)
    need(all(not x['processes'] and not x['listeners'] for x in values),'Candidate-path or fixed-port residue; preserve scene')
    return values

def launch(output, command, env, report):
    actual()
    with ordinary(output/'stdout.log').open('xb') as out,ordinary(output/'stderr.log').open('xb') as err:
        proc=subprocess.Popen(command,cwd=ROOT,env=env,stdin=subprocess.DEVNULL,stdout=out,stderr=err,creationflags=0x08000000)
        report['root']={'pid':proc.pid,'argv':command,'exitCode':None,'harnessForcedStop':False}; save(output/'launch.json',report['root'])
        try:
            sample=observe(output,'root-start',proc.pid); matches=[x for x in sample['processes'] if x['ProcessId']==proc.pid]
            need(len(matches)==1 and matches[0].get('ExecutablePath') and matches[0].get('CreationUtc'),'Actual root CIM identity unavailable')
            report['root']['actualCim']=matches[0]; report['root']['exitCode']=proc.wait(timeout=150)
        finally:
            report['root']['exitCode']=proc.poll(); save(output/'root-exit.json',report['root'])
    need(report['root']['exitCode']==0,'Root did not naturally exit zero; no termination issued')

def seed(output, prep, report):
    need(all(not os.path.lexists(p) for p in SLOTS+PROFILES),'Fixed database/profile already exists; refuse seed')
    need(all(not os.path.lexists(ROOT/'data'/d/'synthetic-fixture.json') for d in ('sales','ledger','inventory')),'Existing fixture marker refused')
    need(not os.path.lexists(ROOT/'logs/host-smoke-result.json') and not os.path.lexists(ROOT/'runtime/host-ready.json'),'Existing smoke/host evidence refused')
    for name in ('stage1/tools/node.exe','project/desktop/legacy-modules/manifest.json'): ordinary(ROOT/name).stat()
    rows={x['path']:x for x in prep['artifacts']['app']}; report['generated']=[]
    for name in GENERATED:
        key='generated/'+name; row=rows[key]; body=read(BASE/'build/app-input'/key,row['sha256']); need(len(body)==row['size'],'Generated input size differs')
        target=ordinary(ROOT/'project/desktop/generated'/name)
        if target.exists(): put(output/'generated-before'/name,read(target))
        temporary=ordinary(target.with_name(name+'.engine-4490-a1.tmp')); put(temporary,body); ordinary(target); os.replace(temporary,target)
        read(target,row['sha256']); report['generated'].append({'path':key,'sha256':row['sha256']})
    need(all(not os.path.lexists(p) for p in SLOTS+PROFILES),'Fixed slots changed before fixture launch')
    launch(output,[str(PYTHON),'-I','-B',str(ROOT/'stage1/run-restricted.py'),'--sandbox-guest','--script','stage1/host.cjs','--mode','smoke'],environment(output/'scratch'),report)
    need(load(ROOT/'logs/host-smoke-result.json').get('passed') is True and not (ROOT/'runtime/host-ready.json').exists(),'Original smoke/normal close incomplete')
    for file in SLOTS:
        need(ordinary(file).is_file(),'Fixture database absent'); marker=load(file.parent/'synthetic-fixture.json')
        need(marker.get('synthetic') is True and marker.get('namespace')=='2c48091c-c205-41b4-88a9-5ebdd24b24a9','Fixture namespace differs')
    need(all(not p.exists() for p in PROFILES),'Seed unexpectedly created native profiles')

def host_selfcheck(output, report):
    old=load(ROOT/'reports/engine-4490-native-seed-a1/result.json')
    need(old.get('passed') is True and old.get('manifestSha256')==MANIFEST_SHA,'This batch successful seed required')
    need(all(not os.path.lexists(p) for p in PROFILES),'Fresh native profiles required')
    env=environment(output/'scratch',True); env['XJY_SELF_CHECK_OUTPUT']=str(output/'app')
    launch(output,[str(EXE),'--remote-debugging-address=127.0.0.1','--remote-debugging-port=42791','--self-check'],env,report)
    value=load(output/'app/startup-check.json'); report['startup']=value
    need(value.get('ok') is True and value.get('electron')=='44.9.0','Actual packaged startup check failed')
    need(read(output/'app/离线程序-首次启动.png')[:8]==b'\x89PNG\r\n\x1a\n','Actual startup PNG missing')

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('phase',choices=('seed','host-selfcheck','connected')); args=parser.parse_args()
    proof=actual(); prep=verify_inputs(); output=ordinary(ROOT/'reports'/('engine-4490-native-'+args.phase+'-a1'))
    need(not os.path.lexists(output),'CreateNew phase output required'); output.mkdir()
    result={'purpose':'engine-4490-finite-native-qa','phase':args.phase,'manifestSha256':MANIFEST_SHA,'actualContext':proof,'passed':False,'harnessForcedStop':False,'observationScope':'candidate program path plus fixed ports; no global kernel history proof','employeeConnected':'NOT RUN','hardwarePrintingVerified':False}
    try:
        result['preflight']=clean_samples(output,'before')
        if args.phase=='connected': result['status']='NOT RUN'; result['reason']='Connected employee lifecycle requires separate Root completion; no product launched'
        else:
            seed(output,prep,result) if args.phase=='seed' else host_selfcheck(output,result)
            result['status']='PASS'; result['passed']=True
    except Exception as error: result.update(status='FAIL',error=type(error).__name__+': '+str(error))
    finally:
        try: result['postflight']=clean_samples(output,'after')
        except Exception as error: result.update(status='FAIL',passed=False,postflightError=str(error))
        save(output/'result.json',result)
    print(json.dumps({'phase':args.phase,'status':result['status'],'passed':result['passed'],'result':str(output/'result.json')}))
    return 0 if result['passed'] else 2 if result['status']=='NOT RUN' else 1

if __name__=='__main__':
    try: sys.exit(main())
    except Exception as error: print(json.dumps({'passed':False,'error':type(error).__name__+': '+str(error)})); sys.exit(1)
