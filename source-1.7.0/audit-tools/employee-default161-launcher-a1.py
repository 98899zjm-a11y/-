"""Fixed Guest161 employee GUI parent launcher; Root operates UI. Never kill."""
import argparse, datetime, hashlib, json, os, stat, subprocess, sys
from pathlib import Path
ROOT=Path('C:/xjy-work/xjy-web-stage1'); WORK=ROOT/'runtime/native-employee162-a1'; EMP=Path('C:/xjy-native-installed-a1')
SELF=ROOT/'audit-tools/employee-default161-launcher-a1.py'; PREP=WORK/'preparation.json'; NODE=ROOT/'stage1/tools/node.exe'
A2=ROOT/'audit-tools/employee-native162-e2e-a2.cjs'; GUARD=ROOT/'stage1/guest-candidate-cdp.cjs'; EXE=EMP/'鑫金源珠宝报价.exe'
A2_SHA='7245732383b8da1bbaa1781eaa026e4f4c8327a5dc156fbd2c084437df08b796'
NODE_SHA='ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32'; GUARD_SHA='59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32'
EXE_SHA='db3ad2066a55546f9b6737da3c7f011370e4856fb36888055b544d45653e4f40'; ASAR_SHA='7e4b04ef51c741f7da66da7e55cd5a280b792f32cd0a0fe8d19606f0996de07d'
ARGS=['--employee-client','--remote-debugging-address=127.0.0.1','--remote-debugging-port=42792']
# Control: original employee restart arguments; no debugger or rendering override.
RUN_ARGS=['--employee-client']
def need(value,code):
    if not value: raise RuntimeError(code)
def plain(file):
    for item in (file,*file.parents):
        s=item.lstat(); need(not stat.S_ISLNK(s.st_mode) and not getattr(s,'st_file_attributes',0)&0x400 and os.path.normcase(os.path.realpath(item))==os.path.normcase(str(item)),'ORDINARY_PATH_REQUIRED')
    need(file.is_file() and file.stat().st_nlink==1,'ORDINARY_SINGLE_LINK_FILE'); return file
def checked(file,pin=None,collect=False):
    before=plain(file).stat(); h=hashlib.sha256(); chunks=[]
    with file.open('rb') as source:
        opened=os.fstat(source.fileno())
        while block:=source.read(1048576):
            h.update(block)
            if collect: chunks.append(block)
        ended=os.fstat(source.fileno())
    after=plain(file).stat(); stamp=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_nlink)
    common=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_nlink)
    need(stamp(before)==stamp(after) and stamp(opened)==stamp(ended) and common(before)==common(opened),'FILE_CHANGED'); need(pin is None or h.hexdigest()==pin,'SHA_MISMATCH')
    return b''.join(chunks) if collect else h.hexdigest()
def data(file,pin=None): return json.loads(checked(file,pin,True))
def write_new(file,value):
    with file.open('x',encoding='utf-8',newline='\n') as out: json.dump(value,out,ensure_ascii=False,indent=2); out.flush(); os.fsync(out.fileno())
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def main():
    p=argparse.ArgumentParser(); p.add_argument('--source-sha256',required=True); p.add_argument('--preparation-sha256',required=True); a=p.parse_args()
    need(os.name=='nt' and Path(__file__).absolute()==SELF and os.environ.get('USERNAME','').lower()=='wdagutilityaccount','FIXED_ACTUAL_GUEST_LAUNCHER_ONLY')
    for file,pin in ((SELF,a.source_sha256),(A2,A2_SHA),(NODE,NODE_SHA),(GUARD,GUARD_SHA)): checked(file,pin)
    prep=data(PREP,a.preparation_sha256); owner=data(WORK/'owner.json'); launch=prep['employeeLaunch']; namespace=prep['namespace']
    need(prep['purpose']=='employee-native162-preparation' and owner['purpose']=='employee-native162-e2e-fixture' and prep['sourceSha256']==A2_SHA and owner['sourceSha256']==A2_SHA and owner['namespace']==namespace and owner.get('synthetic') is True and Path(prep['work'])==WORK and Path(prep['employee'])==EMP and Path(owner['root'])==WORK and Path(owner['employeeInstallation'])==EMP,'OWNER_PREPARATION_BINDING')
    need(prep.get('resumedFrom')==owner.get('resumedFrom') and prep['resumedFrom']['sourceSha256']=='9196b3c5d3fe7ff073cdc2b9fbc96e860f4db831e31e57992048fc71ccc6a097','A2_RESUME_REQUIRED'); checked(WORK/'owner-9196-preserved.json',prep['resumedFrom']['ownerSha256'])
    need(data(ROOT/'isolation-identity.json')['namespace']==namespace,'ACTUAL_NAMESPACE_BINDING')
    # The pinned actualGuard below validates the intentionally mapped RO input marker.
    local=WORK/'本地'; env={'SystemRoot':'C:\\Windows','WINDIR':'C:\\Windows','PATH':'C:\\Windows\\System32;C:\\Windows','TEMP':str(local/'Temp'),'TMP':str(local/'Temp'),'USERPROFILE':str(local/'User'),'APPDATA':str(local/'Roaming'),'LOCALAPPDATA':str(local/'Local')}
    need(launch['environment']==env and launch['args']==ARGS and Path(launch['executablePath'])==EXE and Path(launch['cwd'])==EMP and launch['normalRestartArgs']==['--employee-client'] and launch['selfCheck'] is False,'EXACT_CLEAN_LAUNCH_REQUIRED')
    role=WORK/'host-code/launch-role.cjs'; row=next(r for r in prep['hostCode']['rows'] if r['path']=='launch-role.cjs'); checked(role,row['sha256'])
    expression="const p=require('./stage1/guest-candidate-cdp.cjs').actualGuard(); console.log(JSON.stringify({proof:p,identity:require('./runtime/native-employee162-a1/host-code/launch-role.cjs').employeeIdentity()}));"
    guard=subprocess.run([str(NODE),'-e',expression],cwd=ROOT,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True)
    info=json.loads(guard.stdout); proof=info['proof']; expected_profile=local/'Local/鑫金源珠宝员工端'/info['identity']
    need(proof['productionDrivePresent'] is False and proof['nonLoopbackAddressCount']==0 and proof['model']=='Virtual Machine' and Path(launch['expectedProfile'])==expected_profile,'ORIGINAL_ACTUAL_GUARD_AND_PROFILE_REQUIRED')
    checked(EXE,EXE_SHA); checked(EMP/'resources/app.asar',ASAR_SHA); activation=data(EMP/'xjy-install-activation.json',prep['activationSha256'])
    need(activation=={'version':1,'product':'xjy-jewelry-offline','programVersion':'1.6.1','role':'employee','installationDir':str(EMP)},'ACTUAL_EMPLOYEE161_REQUIRED')
    for name in ('employee161-default-a1-preflight.stdout.bin','employee161-default-a1-preflight.stderr.bin','employee161-default-a1.stdout.bin','employee161-default-a1.stderr.bin','employee161-default-a1-launched.json','employee161-default-a1-exit.json'): need(not os.path.lexists(WORK/name),'CREATE_NEW_LAUNCH_EVIDENCE_REQUIRED')
    script="$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$p=@(Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -and $_.ExecutablePath.StartsWith('C:\\xjy-native-installed-a1\\',[StringComparison]::OrdinalIgnoreCase)} | Select-Object ProcessId,ExecutablePath);$t=@(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object {$_.LocalPort -eq 42792} | Select-Object LocalAddress,LocalPort,OwningProcess);[ordered]@{processes=$p;listeners=$t}|ConvertTo-Json -Compress"
    probe=subprocess.run(['C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe','-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',__import__('base64').b64encode(script.encode('utf-16le')).decode('ascii')],cwd=ROOT,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    for name,body in [('employee161-default-a1-preflight.stdout.bin',probe.stdout),('employee161-default-a1-preflight.stderr.bin',probe.stderr)]:
        with (WORK/name).open('xb') as out: out.write(body)
    need(probe.returncode==0,'EMPLOYEE_ONLY_PROCESS_PROBE_FAILED'); quiet=json.loads(probe.stdout.decode('utf-8-sig')); need(quiet['processes']==[] and quiet['listeners']==[],'STALE_EMPLOYEE_GUI_OR42792')
    checked(SELF,a.source_sha256); checked(PREP,a.preparation_sha256); child=None; result={'purpose':'real-employee161-default-a1-parent-lifecycle','launcherSha256':a.source_sha256,'preparationSha256':a.preparation_sha256,'employeeUpgradeAccepted':False,'killUsed':False,'privateKeyRead':False}
    with (WORK/'employee161-default-a1.stdout.bin').open('xb') as out,(WORK/'employee161-default-a1.stderr.bin').open('xb') as err:
        try:
            started=now(); child=subprocess.Popen([str(EXE),*RUN_ARGS],cwd=EMP,env=env,stdin=subprocess.DEVNULL,stdout=out,stderr=err,creationflags=0x08000000)
            launched={**result,'event':'EMPLOYEE161_LAUNCHED','pid':child.pid,'launcherPid':os.getpid(),'startedAtUtc':started,'expectedProfile':str(expected_profile),'argv':[str(EXE),*RUN_ARGS]}; write_new(WORK/'employee161-default-a1-launched.json',launched); print(json.dumps(launched,ensure_ascii=False),flush=True)
            result.update(pid=child.pid,startedAtUtc=started,exitCode=child.wait(),exitedAtUtc=now())
        except Exception as error: result['error']=type(error).__name__+': '+str(error)
        finally:
            if child is not None: result['exitCode']=child.wait()  # Root UI/real updater owns normal exit; no timeout-kill.
    result['parentExited']=child is not None and child.returncode is not None; write_new(WORK/'employee161-default-a1-exit.json',result); print(json.dumps(result),flush=True)
    return 0 if result.get('parentExited') and result.get('exitCode')==0 and 'error' not in result else 1
if __name__=='__main__':
    try: sys.exit(main())
    except Exception as error: print(type(error).__name__+': '+str(error),file=sys.stderr); sys.exit(1)
