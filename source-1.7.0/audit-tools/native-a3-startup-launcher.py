"""Fixed Guest a3 packaged employee parent; Root observes UI and exits normally."""
import argparse, datetime, hashlib, json, os, re, stat, subprocess, sys
from pathlib import Path

ROOT=Path('C:/xjy-work/xjy-web-stage1'); WORK=ROOT/'runtime/native-startup162-a3-a1'; EMP=Path('C:/xjy-native-startup162-a3-a1')
SELF=ROOT/'audit-tools/native-a3-startup-launcher.py'; FIXTURE=ROOT/'audit-tools/native-a3-startup-fixture.cjs'; PREP=WORK/'preparation.json'; NODE=ROOT/'stage1/tools/node.exe'; EXE=EMP/'鑫金源珠宝报价.exe'
NS='36fcbe9c-ece1-4be3-af35-309a2ee19e05'; SHA=re.compile(r'[a-f0-9]{64}')
PINS={'stage1/tools/node.exe':'ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32',
      'stage1/guest-candidate-cdp.cjs':'59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32',
      'stage1/sandbox-context.py':'09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
      'stage1/validate-sandbox-context.py':'867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207'}
ENTRY='9946587c65aa2c79bdfd6aaae85e10e5ede14d32f9ce6b2c6dfc8f48fd079773'; APP='928bba879b13f6e45d9f3b582f115a47f793ff98270f4b204c57bd0ce0b6ad70'

def need(value,code):
    if not value: raise RuntimeError(code)
def plain(file):
    need(file.is_absolute(),'ABSOLUTE_LOCAL_PATH_REQUIRED')
    for item in (file,*file.parents):
        s=item.lstat(); need(not stat.S_ISLNK(s.st_mode) and not getattr(s,'st_file_attributes',0)&0x400 and os.path.normcase(os.path.realpath(item))==os.path.normcase(str(item)),'ORDINARY_PATH_REQUIRED')
    need(file.is_file() and file.stat().st_nlink==1,'ORDINARY_SINGLE_LINK_FILE_REQUIRED'); return file
def checked(file,pin=None,collect=False):
    before=plain(file).stat(); h=hashlib.sha256(); chunks=[]
    need(not collect or before.st_size<=4194304,'BOUNDED_METADATA_REQUIRED')
    with file.open('rb') as source:
        opened=os.fstat(source.fileno())
        while block:=source.read(1048576):
            h.update(block)
            if collect: chunks.append(block)
        ended=os.fstat(source.fileno())
    after=plain(file).stat(); stamp=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_nlink); common=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_nlink)
    need(stamp(before)==stamp(after) and stamp(opened)==stamp(ended) and common(before)==common(opened),'FILE_CHANGED'); need(pin is None or h.hexdigest()==pin,'SHA_MISMATCH')
    return b''.join(chunks) if collect else h.hexdigest()
def data(file,pin=None): return json.loads(checked(file,pin,True))
def write_new(file,body):
    with file.open('xb') as out: out.write(body); out.flush(); os.fsync(out.fileno())
def save(file,value): write_new(file,(json.dumps(value,ensure_ascii=False,indent=2)+'\n').encode('utf-8'))
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def environment():
    local=WORK/'本地'
    return {'SystemRoot':'C:\\Windows','WINDIR':'C:\\Windows','PATH':'C:\\Windows\\System32;C:\\Windows','TEMP':str(local/'Temp'),'TMP':str(local/'Temp'),'USERPROFILE':str(local/'User'),'APPDATA':str(local/'Roaming'),'LOCALAPPDATA':str(local/'Local')}
def program_tree(rows):
    need(len(rows)==1080 and len({r['path'].casefold() for r in rows})==1080,'EXACT_PROGRAM_ROWS_REQUIRED'); wanted={r['path']:r for r in rows}; dirs=set(); actual=set()
    for name,row in wanted.items():
        need(isinstance(name,str) and '\\' not in name and ':' not in name and all(p not in ('','.','..') for p in name.split('/')) and isinstance(row['size'],int) and row['size']>=0 and SHA.fullmatch(row['sha256']),'CANONICAL_PROGRAM_ROW_REQUIRED')
        parent=Path(name).parent
        while parent!=Path('.'): dirs.add(parent.as_posix()); parent=parent.parent
    for base,subdirs,files in os.walk(EMP,followlinks=False):
        for name in subdirs:
            file=Path(base)/name; s=file.lstat(); need(not stat.S_ISLNK(s.st_mode) and not getattr(s,'st_file_attributes',0)&0x400 and file.relative_to(EMP).as_posix() in dirs,'EXTRA_OR_LINKED_DIRECTORY')
        for name in files:
            file=Path(base)/name; relative=file.relative_to(EMP).as_posix(); need(relative in wanted,'EXTRA_PROGRAM_FILE'); row=wanted[relative]; need(file.stat().st_size==row['size'],'PROGRAM_SIZE_CHANGED'); checked(file,row['sha256']); actual.add(relative)
    need(actual==set(wanted),'PROGRAM_FILES_MISSING')
def original_guard(env):
    for name,pin in PINS.items(): checked(ROOT/name,pin)
    need(data(ROOT/'isolation-identity.json')['namespace']==NS,'ROOT36_NAMESPACE_REQUIRED')
    # The unchanged original guard alone reads the intentionally mapped RO marker.
    expression="console.log(JSON.stringify(require('./stage1/guest-candidate-cdp.cjs').actualGuard()))"
    result=subprocess.run([str(NODE),'-e',expression],cwd=ROOT,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True)
    proof=json.loads(result.stdout); need(proof['model']=='Virtual Machine' and proof['productionDrivePresent'] is False and proof['nonLoopbackAddressCount']==0,'ACTUAL_GUEST_REQUIRED'); return proof
def native_probe(script,env):
    import base64
    return subprocess.run(['C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe','-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',base64.b64encode(script.encode('utf-16le')).decode('ascii')],cwd=ROOT,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
def main():
    need(os.name=='nt' and Path(__file__).absolute()==SELF and os.environ.get('USERNAME','').lower()=='wdagutilityaccount','FIXED_GUEST_LAUNCHER_REQUIRED')
    parser=argparse.ArgumentParser(allow_abbrev=False); parser.add_argument('--source-sha256',required=True); parser.add_argument('--preparation-sha256',required=True); args=parser.parse_args()
    need(all(SHA.fullmatch(v) and set(v)!={'0'} for v in (args.source_sha256,args.preparation_sha256)),'EXPLICIT_NONZERO_SHA_REQUIRED'); checked(SELF,args.source_sha256)
    env=environment(); context=original_guard(env); prep=data(PREP,args.preparation_sha256); owner=data(WORK/'owner.json')
    need(prep['version']==1 and prep['purpose']=='native-a3-startup-preparation' and prep['synthetic'] is True and prep['namespace']==NS and Path(prep['work'])==WORK and Path(prep['employee'])==EMP and prep['preparedCopyIsInstallation'] is False and prep['programExecuted'] is False,'FIXED_STARTUP_PREPARATION_REQUIRED')
    need(owner=={'version':1,'purpose':'native-a3-startup-fixture','synthetic':True,'namespace':NS,'root':str(WORK),'employeeInstallation':str(EMP),'sourceSha256':prep['sourceSha256']},'FIXTURE_OWNER_BINDING_REQUIRED'); checked(FIXTURE,prep['sourceSha256'])
    need(prep['entrySha256']==ENTRY and prep['appSha256']==APP and all(SHA.fullmatch(prep['inputPins'][k]) and set(prep['inputPins'][k])!={'0'} for k in ('--source-sha256','--manifest-sha256','--proof-sha256','--asar-sha256','--source-freeze-sha256')),'EXACT_A3_INPUT_PINS_REQUIRED')
    need(prep['launch']=={'executablePath':str(EXE),'args':['--employee-client'],'cwd':str(EMP),'environment':env},'DEFAULT_EMPLOYEE_ARGUMENTS_AND_EIGHT_ENV_REQUIRED')
    profile=WORK/'本地/Local/鑫金源珠宝员工端'/prep['identity']; need(Path(prep['profileDir'])==profile and profile.is_relative_to(WORK) and len(Path(prep['identity']).parts)==1 and prep['identity'] not in ('.','..'),'FIXED_OWNED_PROFILE_REQUIRED')
    need(list(profile.iterdir())==[profile/'launch-role.json'] and data(profile/'launch-role.json',prep['roleSha256'])=={'version':1,'role':'employee'},'ROLE_ONLY_NEW_PROFILE_REQUIRED')
    need(data(EMP/'xjy-install-activation.json',prep['activationSha256'])=={'version':1,'product':'xjy-jewelry-offline','programVersion':'1.6.2','role':'employee','installationDir':str(EMP)},'EXACT_EMPLOYEE162_ACTIVATION_REQUIRED')
    for ancestor in (EMP,*EMP.parents): need(not os.path.lexists(ancestor/'isolation-identity.json'),'PROGRAM_ISOLATION_MARKER_REFUSED')
    program_tree(prep['programFiles']); expected={r['path']:r for r in prep['programFiles']}; need(expected['resources/app.asar']['sha256']==prep['inputPins']['--asar-sha256'] and expected[EXE.name]['sha256']=='db3ad2066a55546f9b6737da3c7f011370e4856fb36888055b544d45653e4f40','EXACT_A3_ASAR_AND_ENGINE_REQUIRED')
    names=['preflight.stdout.bin','preflight.stderr.bin','postflight.stdout.bin','postflight.stderr.bin','child-identity.stdout.bin','child-identity.stderr.bin','startup.stdout.bin','startup.stderr.bin','startup-launched.json','startup-exit.json']
    for name in names: need(not os.path.lexists(WORK/name),'CREATE_NEW_DIAGNOSTICS_REQUIRED')
    script="$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$p=@(Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -and $_.ExecutablePath.StartsWith('C:\\xjy-native-startup162-a3-a1\\',[StringComparison]::OrdinalIgnoreCase)} | Select-Object ProcessId,ExecutablePath);[ordered]@{processes=$p}|ConvertTo-Json -Compress"
    probe=native_probe(script,env); write_new(WORK/'preflight.stdout.bin',probe.stdout); write_new(WORK/'preflight.stderr.bin',probe.stderr); need(probe.returncode==0 and json.loads(probe.stdout.decode('utf-8-sig'))['processes']==[],'EXISTING_EMPLOYEE_PROCESS_REFUSED')
    checked(SELF,args.source_sha256); checked(PREP,args.preparation_sha256); checked(FIXTURE,prep['sourceSha256']); original_guard(env)
    child=None; result={'purpose':'native-a3-default-employee-parent-lifecycle','launcherSha256':args.source_sha256,'preparationSha256':args.preparation_sha256,'namespace':NS,'expectedProfile':str(profile),'initialContext':context,'guiVerifiedByLauncher':False,'installed':False,'upgradeAccepted':False,'killUsed':False,'privateKeyRead':False}
    with (WORK/'startup.stdout.bin').open('xb') as out,(WORK/'startup.stderr.bin').open('xb') as err:
        try:
            started=now(); child=subprocess.Popen([str(EXE),'--employee-client'],cwd=EMP,env=env,stdin=subprocess.DEVNULL,stdout=out,stderr=err,creationflags=0x08000000)
            result.update(pid=child.pid,launcherPid=os.getpid(),startedAtUtc=started,argv=[str(EXE),'--employee-client'],programLaunched=True)
            identity_script="$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$p=Get-CimInstance Win32_Process -Filter 'ProcessId="+str(child.pid)+"';if(!$p){throw 'Child absent'};[ordered]@{pid=[int]$p.ProcessId;parentPid=[int]$p.ParentProcessId;executablePath=$p.ExecutablePath;creationMarker=$p.CreationDate.ToUniversalTime().ToString('o')}|ConvertTo-Json -Compress"
            identity=native_probe(identity_script,env); write_new(WORK/'child-identity.stdout.bin',identity.stdout); write_new(WORK/'child-identity.stderr.bin',identity.stderr); need(identity.returncode==0,'CHILD_IDENTITY_PROBE_FAILED'); observed=json.loads(identity.stdout.decode('utf-8-sig')); need(observed['pid']==child.pid and observed['parentPid']==os.getpid() and Path(observed['executablePath'])==EXE and observed['creationMarker'],'EXACT_NATIVE_CHILD_IDENTITY_REQUIRED'); result['creationMarker']=observed['creationMarker']
            save(WORK/'startup-launched.json',{**result,'event':'A3_EMPLOYEE_DEFAULT_LAUNCHED'}); print(json.dumps(result,ensure_ascii=False),flush=True)
            result.update(exitCode=child.wait(),exitedAtUtc=now())
        except Exception as error: result['error']=type(error).__name__+': '+str(error)
        finally:
            if child is not None: result['exitCode']=child.wait()  # Root uses the real employee tray Exit; never kill or timeout-kill.
    result['parentExited']=child is not None and child.returncode is not None
    try:
        result['finalContext']=original_guard(env)
        postflight=native_probe(script,env); write_new(WORK/'postflight.stdout.bin',postflight.stdout); write_new(WORK/'postflight.stderr.bin',postflight.stderr)
        need(postflight.returncode==0,'POSTFLIGHT_PROCESS_PROBE_FAILED'); remaining=json.loads(postflight.stdout.decode('utf-8-sig'))['processes']; result['remainingEmployeeProcesses']=remaining; need(remaining==[],'EMPLOYEE_PROCESSES_STILL_PRESENT')
    except Exception as error: result['finalGuardError']=str(error)
    result['lifecycleCompleted']=result['parentExited'] and result.get('exitCode')==0 and 'error' not in result and 'finalGuardError' not in result
    save(WORK/'startup-exit.json',result); print(json.dumps(result,ensure_ascii=False),flush=True); return 0 if result['lifecycleCompleted'] else 1

if __name__=='__main__':
    try: sys.exit(main())
    except Exception as error: print(type(error).__name__+': '+str(error),file=sys.stderr); sys.exit(1)
