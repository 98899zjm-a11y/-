"""Actual-guest-only candidate driver; imports no business or Electron modules."""
from pathlib import Path
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
import stat
import subprocess
import socket
import time
import urllib.request
import re
import traceback

ROOT=Path(__file__).resolve().parent.parent
GUEST=Path('C:/xjy-work/xjy-web-stage1')
CHECKS=('engine-capabilities','candidate-host-startup','candidate-offline-fullmodules',
        'candidate-fakehardware-worker','candidate-updater-toy-recovery',
        'candidate-three-database-attachments-restore')
ENGINE_SHA='db3ad2066a55546f9b6737da3c7f011370e4856fb36888055b544d45653e4f40'
ENGINE_SIZE=246302720
ALLOWLIST_SHA='6893a279e6ab2ccaae36c9c66fd8c840ef4dacddc9cd9c78c24f87dd3f311ea4'
RESOURCE_SHA='c82426dc5463f2b5f0b366dd7c7e0ac09ec9d542bc9b81866997ecbc0cf9efd9'


def parse_zero_skip_tap(stdout):
    counts={}
    for key in ('tests','pass','fail','cancelled','skipped','todo'):
        matches=re.findall(r'^# '+key+r' (\d+)\s*$',stdout,re.M)
        if len(matches)!=1:raise RuntimeError('One complete TAP summary required: '+key)
        counts[key]=int(matches[0])
    if counts['tests']<1 or counts['pass']!=counts['tests'] or any(counts[key]!=0 for key in ('fail','cancelled','skipped','todo')):
        raise RuntimeError('TAP suite must pass every test without skips')
    return counts


def validate_proof(proof):
    if not isinstance(proof,dict) or proof.get('model')!='Virtual Machine' or not str(proof.get('userName','')).lower().endswith('\\wdagutilityaccount') or proof.get('productionDrivePresent') is not False or type(proof.get('nonLoopbackAddressCount')) is not int or proof['nonLoopbackAddressCount']!=0 or proof.get('inputMarkerPresent') is not True:
        raise RuntimeError('Actual Windows Sandbox guest context required')
    return proof


def run_sequence(runner, *, desktop_only=False):
    if type(desktop_only) is not bool:raise TypeError('Trusted CLI desktop scope selector must be boolean')
    results=[];stopped=False;capable=False
    deferred=('candidate-offline-fullmodules',) if desktop_only else ()
    for name in CHECKS:
        if name in deferred:
            results.append({'name':name,'status':'deferred','passed':None,'exitCode':None,
                            'reason':'Trusted --desktop-only scope: mobile/browser full-module verification is deferred.'})
            continue
        if stopped:
            results.append({'name':name,'status':'not-run','exitCode':None,'passed':False,'reason':'earlier actual check failed'})
            continue
        try:
            result=runner(name)
            code=result.get('exitCode');evidence=result.get('evidence',{})
            good=type(code) is int and code==0 and result.get('timedOut') is not True
            if name=='engine-capabilities':
                good=good and evidence.get('runAsNodeObserved') is True and evidence.get('backupSupported') is True and evidence.get('backupIntegrity')=='ok'
                capable=good
            else:
                good=good and evidence.get('actualCheckPassed') is True
            if name=='candidate-fakehardware-worker':
                good=good and evidence.get('realPassiveHtmlPrepared') is True and evidence.get('realPassivePdfPrepared') is True and type(evidence.get('deviceApiCalls')) is int and evidence['deviceApiCalls']==0 and type(evidence.get('nativeDelegations')) is int and evidence['nativeDelegations']==0
            results.append({'name':name,'status':'passed' if good else 'failed','exitCode':code,'passed':good,'evidence':evidence,**{key:result[key] for key in ('stdout','stderr','artifact','timedOut','process') if key in result}})
            stopped=not good
        except Exception as error:
            results.append({'name':name,'status':'failed','exitCode':None,'passed':False,'error':str(error)})
            stopped=True
    executed=sum(row['status'] in ('passed','failed') for row in results)
    expected=[name for name in CHECKS if name not in deferred]
    return {'passed':not stopped and len(results)==len(CHECKS) and executed==len(expected),'checks':results,
            'scope':'desktop' if desktop_only else 'full','mode':'desktop-only' if desktop_only else 'full',
            'scopeDesktop':desktop_only,'expectedGroups':list(CHECKS),'expectedExecutedGroups':expected,
            'actualExecutedGroups':executed,'deferredGroups':list(deferred),
            'desktopAcceptancePassed':False,'fullAcceptancePassed':False,
            'sourcePolicyCapabilitiesEligible':capable,'baseline20Plus2NaIsSeparate':True}


def finish_acceptance(report, shutdown):
    closed=isinstance(shutdown,dict) and shutdown.get('required') is True and shutdown.get('passed') is True and shutdown.get('forcedStop') is False and shutdown.get('listenersClosed') is True and shutdown.get('observedOwnDescendantsExited') is True
    passed=report.get('passed') is True and closed
    return {**report,'normalDefaultHostShutdown':shutdown,'passed':passed,
            'desktopAcceptancePassed':passed and report.get('scope')=='desktop',
            'fullAcceptancePassed':passed and report.get('scope')=='full'}


def validate_startup_evidence(record, *, png_header):
    state=record.get('state',{})
    images=state.get('images')
    if record.get('ok') is not True or state.get('ready') is not True or state.get('bridge') is not True or not isinstance(state.get('text'),str) or '登录' not in state['text'] or '建立你的珠宝工作室' in state['text'] or not isinstance(images,list) or any(not isinstance(row,dict) or row.get('loaded') is not True for row in images) or record.get('rendererErrors')!=[] or record.get('blockedNetwork')!=[] or png_header!=b'\x89PNG\r\n\x1a\n':
        raise RuntimeError('Actual candidate startup login/asset/error/screenshot evidence failed')
    return {**record,'actualCheckPassed':True,'realProductionDefaultEntry':True,
            'crossProcessNativeApiCounterObserved':False}


def ordinary(path,boundary=ROOT):
    path=Path(path)
    if not path.is_absolute() or not path.is_relative_to(boundary):
        raise RuntimeError('Driver path outside owned guest work root')
    for item in (path,*path.parents):
        if item.exists():
            info=item.lstat()
            if stat.S_ISLNK(info.st_mode) or getattr(info,'st_file_attributes',0)&0x400 or stat.S_ISREG(info.st_mode) and info.st_nlink!=1:
                raise RuntimeError('Driver path link/reparse/hardlink refused')
        if item==boundary:return path
    raise RuntimeError('Driver owned ancestry missing')


def checked_hash(path,expected=None):
    path=ordinary(path)
    if not path.is_file():raise RuntimeError('Driver required ordinary file absent: '+str(path))
    before=path.stat();body=path.read_bytes();after=path.stat()
    if (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns):
        raise RuntimeError('Driver file changed while hashing')
    actual=hashlib.sha256(body).hexdigest()
    if expected and actual!=expected:raise RuntimeError('Driver sealed hash mismatch: '+str(path))
    return actual


def load_evidence(result,file):
    saved={**result,'artifact':str(file)}
    try:
        checked_hash(file)
        evidence=json.loads(Path(file).read_text('utf-8-sig'))
        if not isinstance(evidence,dict):raise RuntimeError('Actual helper evidence must be a JSON object')
        saved['evidence']=evidence
    except Exception:
        saved['artifactError']=traceback.format_exc()
        saved['evidence']={'actualCheckPassed':False,'artifactError':saved['artifactError']}
    return saved


def verify_exact_tree(candidate, expected, *, boundary=ROOT):
    candidate=ordinary(candidate,boundary)
    actual=set();folded=set()
    def walk(directory):
        for child in directory.iterdir():
            ordinary(child,boundary)
            if child.is_dir():walk(child)
            elif child.is_file():
                name=child.relative_to(candidate).as_posix()
                if name.casefold() in folded:raise RuntimeError('Ambiguous candidate tree case collision')
                folded.add(name.casefold());actual.add(name)
            else:raise RuntimeError('Nonordinary candidate tree object')
    walk(candidate)
    if actual!=set(expected):raise RuntimeError('Candidate exact tree has extra or missing file: '+repr(sorted(actual.symmetric_difference(expected))))


def actual_context():
    if os.path.normcase(str(ROOT))!=os.path.normcase(str(GUEST)):
        raise RuntimeError('Actual Windows Sandbox fixed guest root required before any launch or mutation')
    file=ordinary(ROOT/'stage1/sandbox-context.py')
    spec=importlib.util.spec_from_file_location('actual_guest_context_driver',file)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return validate_proof(module.read_context(ROOT))


def verify_candidate():
    candidate=ordinary(ROOT/'release-candidate')
    allow=candidate/'engine-allowlist.json';checked_hash(allow,ALLOWLIST_SHA)
    engine=json.loads(allow.read_text('utf-8-sig'))
    if len(engine['files'])!=72 or sum(row['size'] for row in engine['files'])!=385404497:
        raise RuntimeError('Actual reviewed engine count/size seal mismatch')
    resources=candidate/'release-manifest.json';checked_hash(resources,RESOURCE_SHA)
    resource=json.loads(resources.read_text('utf-8-sig'))
    expected={}
    for row in engine['files']+resource['files']:
        name=row['path']
        if '\\' in name or ':' in name or any(part in ('','.','..') for part in name.split('/')):
            raise RuntimeError('Candidate manifest path rejected')
        key=name.casefold()
        if key in expected:raise RuntimeError('Engine/resource path overlap')
        file=ordinary(candidate/name);checked_hash(file,row['sha256'])
        if file.stat().st_size!=row['size']:raise RuntimeError('Candidate manifest size drift')
        expected[key]=name
    exe=ordinary(candidate/'鑫金源珠宝报价.exe');checked_hash(exe,ENGINE_SHA)
    if exe.stat().st_size!=ENGINE_SIZE:raise RuntimeError('Branded original engine size drift')
    verify_exact_tree(candidate,{*expected.values(),'engine-allowlist.json','release-manifest.json'})
    return candidate,exe


def process_metadata(pid):
    if type(pid) is not int or pid<1:raise RuntimeError('Owned process PID invalid')
    command=f"$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); Get-CimInstance Win32_Process -Filter 'ProcessId={pid}' | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine,@{{Name='CreationUtc';Expression={{$_.CreationDate.ToUniversalTime().ToString('o')}}}} | ConvertTo-Json -Compress"
    child=subprocess.run(['C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe','-NoProfile','-Command',command],cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=20,creationflags=0x08000000)
    if child.returncode:raise RuntimeError('Owned actual process metadata unavailable: '+child.stderr)
    result=json.loads(child.stdout)
    if result.get('ProcessId')!=pid or result.get('ParentProcessId')!=os.getpid():raise RuntimeError('Owned process parent/PID mismatch')
    return result


def process_snapshot():
    actual_context()
    command="[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine,@{Name='CreationUtc';Expression={if($_.CreationDate){$_.CreationDate.ToUniversalTime().ToString('o')}}}) | ConvertTo-Json -Compress"
    result=subprocess.run(['C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe','-NoProfile','-Command',command],cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=20,creationflags=0x08000000)
    if result.returncode:raise RuntimeError('Actual own process closure snapshot failed: '+result.stderr)
    rows=json.loads(result.stdout)
    if not isinstance(rows,list):raise RuntimeError('Actual guest process snapshot malformed')
    return rows


def owned_descendants(rows,root):
    pid=root['ProcessId'];created=root['CreationUtc']
    current=next((row for row in rows if row.get('ProcessId')==pid),None)
    if not current or current.get('CreationUtc')!=created:raise RuntimeError('Actual default host PID/creation ownership changed')
    owned={pid:current}
    while True:
        added=[row for row in rows if row.get('ProcessId') not in owned and row.get('ParentProcessId') in owned and isinstance(row.get('CreationUtc'),str) and row['CreationUtc']>=owned[row['ParentProcessId']]['CreationUtc']]
        if not added:break
        owned.update({row['ProcessId']:row for row in added})
    return list(owned.values())


def ownership_proof_module():
    file=ordinary(ROOT/'stage1/guest-owned-process-proof.py')
    spec=importlib.util.spec_from_file_location('actual_guest_owned_process_proof',file)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module


def run_owned_process(name,program,args,environment,output,timeout=180,allow_force_stop=True):
    stdout=output/(name+'-stdout.log');stderr=output/(name+'-stderr.log')
    if stdout.exists() or stderr.exists():raise RuntimeError('Driver log destination not fresh')
    with stdout.open('xb') as out,stderr.open('xb') as err:
        out.write(b'\xef\xbb\xbf');err.write(b'\xef\xbb\xbf');out.flush();err.flush()
        child=subprocess.Popen([str(program),*args],cwd=ROOT,env=environment,stdin=subprocess.DEVNULL,stdout=out,stderr=err,creationflags=0x08000000)
        process={'pid':child.pid,'parentPid':os.getpid(),'program':str(program),'argv':args,'startedAt':datetime.now(timezone.utc).isoformat()}
        # A short capability probe may finish before CIM; never fabricate metadata.
        if child.poll() is None:
            try:process['actualCim']=process_metadata(child.pid)
            except (RuntimeError,ValueError):
                if child.poll() is None:raise
                process['actualCimObserved']=False
        try:code=child.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            if allow_force_stop:child.kill();child.wait(timeout=10)
            return {'exitCode':child.returncode,'evidence':{},'stdout':str(stdout),'stderr':str(stderr),'timedOut':True,'process':process,'forcedStop':allow_force_stop}
    return {'exitCode':code,'evidence':{},'stdout':str(stdout),'stderr':str(stderr),'process':process}


def require_synthetic_data():
    identity=json.loads(ordinary(ROOT/'isolation-identity.json').read_text('utf-8-sig'))
    for name,database in (('sales','jewelry.sqlite'),('ledger','ledger.db'),('inventory','stockcheck.db')):
        marker=ordinary(ROOT/'data'/name/'synthetic-fixture.json')
        record=json.loads(marker.read_text('utf-8-sig'))
        if record.get('synthetic') is not True or record.get('namespace')!=identity['namespace']:
            raise RuntimeError('Owned fictitious three-database fixture prerequisite missing')
        file=ordinary(ROOT/'data'/name/database)
        with file.open('rb') as handle:
            if handle.read(16)!=b'SQLite format 3\0':raise RuntimeError('Owned synthetic database header missing')


def guest_environment(scratch, *, as_node):
    env={key:value for key,value in os.environ.items() if key.upper() in ('SYSTEMROOT','WINDIR','PATH','PATHEXT','COMSPEC')}
    env.update({'TEMP':str(scratch),'TMP':str(scratch),'APPDATA':str(scratch),'LOCALAPPDATA':str(scratch),
                'XJY_RELEASE_TEST_ROOT':str(ROOT),'XJY_DATA_DIR':str(ROOT/'data/sales'),
                'PSModulePath':'C:/Windows/System32/WindowsPowerShell/v1.0/Modules'})
    if as_node:env['ELECTRON_RUN_AS_NODE']='1'
    return env


def fresh_directory(relative):
    output=ordinary(ROOT/relative)
    if output.exists():raise RuntimeError('Fresh guest result/scratch path required: '+str(output))
    output.mkdir(parents=True);return ordinary(output)


def observer_bootstrap(cdp_sha='UNSEALED',worker_sha='UNSEALED'):
    package={'name':'xjy-guest-worker-observer','version':'0.0.0-guest','main':'index.cjs','private':True}
    entry="""'use strict';
const root='C:/xjy-work/xjy-web-stage1';
const {spawnSync}=require('node:child_process');
const gate=spawnSync('C:/Python314/python.exe',['-I','-B',root+'/stage1/validate-sandbox-context.py'],{cwd:root,shell:false,windowsHide:true,encoding:'utf8',timeout:30000});
if(gate.error||gate.status!==0)throw Error('Actual Sandbox required before observer imports');
const fs=require('node:fs'),crypto=require('node:crypto');
function sealed(file,digest){if(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==digest)throw Error('Sealed observer program changed');}
sealed(root+'/stage1/guest-candidate-cdp.cjs','__CDP_SHA__');
require(root+'/stage1/guest-candidate-cdp.cjs').actualGuard();
sealed(root+'/stage1/guest-candidate-worker.cjs','__WORKER_SHA__');
require(root+'/stage1/guest-candidate-worker.cjs').run();
""".replace('__CDP_SHA__',cdp_sha).replace('__WORKER_SHA__',worker_sha)
    return package,entry


def copy_engine_row(source,target,row):
    ordinary(source);ordinary(target.parent)
    if target.exists():raise RuntimeError('Observer engine copy destination must be fresh')
    before=source.stat();digest=hashlib.sha256();size=0
    with source.open('rb') as read,target.open('xb') as write:
        opened=os.fstat(read.fileno())
        if (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_nlink)!=(opened.st_dev,opened.st_ino,opened.st_size,opened.st_mtime_ns,opened.st_nlink):
            raise RuntimeError('Observer source engine identity changed')
        while block:=read.read(1024*1024):digest.update(block);size+=len(block);write.write(block)
        write.flush();os.fsync(write.fileno())
    after=source.stat()
    if (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_nlink)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_nlink) or size!=row['size'] or digest.hexdigest()!=row['sha256']:
        raise RuntimeError('Observer copied engine source size/hash drift')
    checked_hash(target,row['sha256'])
    if target.stat().st_size!=row['size']:raise RuntimeError('Observer engine target size drift')


def prepare_worker_observer():
    actual_context();candidate,_=verify_candidate()
    root=fresh_directory('runtime/candidate-worker-observer')
    engine=json.loads(ordinary(candidate/'engine-allowlist.json').read_text('utf-8-sig'))
    for row in engine['files']:
        target=ordinary(root/row['path']);target.parent.mkdir(parents=True,exist_ok=True);ordinary(target.parent)
        copy_engine_row(candidate/row['path'],target,row)
    cdp_sha=checked_hash(ROOT/'stage1/guest-candidate-cdp.cjs');worker_sha=checked_hash(ROOT/'stage1/guest-candidate-worker.cjs')
    package,entry=observer_bootstrap(cdp_sha,worker_sha)
    app=ordinary(root/'resources/app');app.mkdir(parents=True);ordinary(app)
    with (app/'package.json').open('x',encoding='utf-8',newline='\n') as handle:handle.write(json.dumps(package,ensure_ascii=True)+'\n')
    with (app/'index.cjs').open('x',encoding='utf-8',newline='\n') as handle:handle.write(entry)
    verify_exact_tree(root,{*(row['path'] for row in engine['files']),'resources/app/package.json','resources/app/index.cjs'})
    proof={'purpose':'independent actual guest worker observer app','engineSource':str(candidate),'sourceEngineAllowlistSha256':ALLOWLIST_SHA,
        'engineRows':engine['files'],'engineFileCount':72,'candidateAppAsarCopied':False,'generatedAppFiles':[{'path':str(path.relative_to(root)).replace('\\','/'),'size':path.stat().st_size,'sha256':checked_hash(path)} for path in (app/'package.json',app/'index.cjs')],
        'productionDefaultHostEntryChanged':False,'productionAppIsPackagedOverridden':False,'observerProgramSha256':worker_sha,'observerGuardSha256':cdp_sha}
    return ordinary(root/'鑫金源珠宝报价.exe'),proof


def require_process_policy():
    command="[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); Get-ExecutionPolicy -List | ForEach-Object { [pscustomobject]@{scope=$_.Scope.ToString();policy=$_.ExecutionPolicy.ToString()} } | ConvertTo-Json -Compress"
    result=subprocess.run(['C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe','-NoProfile','-Command',command],cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=20,creationflags=0x08000000)
    if result.returncode:raise RuntimeError('Actual PowerShell policy diagnostic failed: '+result.stderr)
    rows=json.loads(result.stdout)
    if {row.get('scope') for row in rows}!={'MachinePolicy','UserPolicy','Process','CurrentUser','LocalMachine'} or any(row.get('policy')!='Undefined' for row in rows):
        raise RuntimeError('Guest parent policy scopes changed; stop without changing any execution policy')
    return rows


def port_open(port):
    with socket.socket(socket.AF_INET,socket.SOCK_STREAM) as connection:
        connection.settimeout(0.5);return connection.connect_ex(('127.0.0.1',port))==0


class DefaultHost:
    def __init__(self,exe,environment):
        self.exe=exe;self.environment=environment;self.child=None;self.handles=[];self.metadata=None

    def start(self):
        actual_context();verify_candidate();require_synthetic_data()
        if any(port_open(port) for port in (42791,42831)):
            raise RuntimeError('Guest debugger/gateway port conflict: no candidate process was started')
        self.output=fresh_directory('reports/candidate-default-host')
        for name in ('stdout.log','stderr.log'):
            handle=(self.output/name).open('xb');handle.write(b'\xef\xbb\xbf');handle.flush();self.handles.append(handle)
        args=['--remote-debugging-address=127.0.0.1','--remote-debugging-port=42791']
        self.child=subprocess.Popen([str(self.exe),*args],cwd=self.exe.parent,env=self.environment,stdin=subprocess.DEVNULL,stdout=self.handles[0],stderr=self.handles[1],creationflags=0x08000000)
        self.metadata={'actualCim':process_metadata(self.child.pid),'argv':args,'expectedExecutableSha256':ENGINE_SHA,
                       'startedAt':datetime.now(timezone.utc).isoformat(),'productionAppIsPackagedOverridden':False}
        (self.output/'process.json').write_text(json.dumps(self.metadata,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        deadline=time.monotonic()+90
        while time.monotonic()<deadline:
            if self.child.poll() is not None:raise RuntimeError('Actual default candidate exited during startup: '+str(self.child.returncode))
            if port_open(42791) and port_open(42831):
                with urllib.request.urlopen('http://127.0.0.1:42791/json/list',timeout=3) as response:targets=json.load(response)
                if any(row.get('type')=='page' and str(row.get('url')).startswith('jewelry://app/') for row in targets):return self.child.pid
            time.sleep(.25)
        raise RuntimeError('Actual default candidate debugger/gateway startup timed out; actual process retained for evidence')

    def close(self,probe_environment):
        if self.child is None:return {'required':False,'passed':True,'forcedStop':False}
        result={'required':True,'passed':False,'forcedStop':False,'pid':self.child.pid}
        try:
            if self.child.poll() is None:
                # Only the existing trusted native bridge authorizes normal quit.
                actual_context()
                if not self.metadata or not self.metadata.get('actualCim'):raise RuntimeError('Exact owned main PID/creation unavailable: no closure action issued')
                tracker=ownership_proof_module()
                observed,alive=tracker.update_owned([self.metadata['actualCim']],process_snapshot())
                result['observedOwnTreeBeforeClose']=observed
                record=run_owned_process('normal-exit',self.exe,[str(ROOT/'stage1/guest-candidate-cdp.cjs'),str(self.child.pid)],probe_environment,self.output,timeout=45)
                result['nativeExitRequest']=record
                if record['exitCode']!=0 or record.get('timedOut'):raise RuntimeError('Actual native exitHost request failed')
                deadline=time.monotonic()+60
                clean_snapshots=0
                while True:
                    rows=process_snapshot()
                    observed,alive=tracker.update_owned(observed,rows)
                    # A missed short-lived parent cannot conceal a retained
                    # program child in our unique candidate/observer roots.
                    roots=[str(ROOT/'release-candidate').casefold()+'\\',str(ROOT/'runtime/candidate-worker-observer').casefold()+'\\']
                    unknown=[row for row in rows if isinstance(row.get('ExecutablePath'),str) and any(row['ExecutablePath'].casefold().startswith(root) for root in roots) and row.get('ProcessId') not in {entry['ProcessId'] for entry in observed}]
                    if unknown:raise RuntimeError('Unattributed owned candidate/observer program remains; clean shutdown not proved: '+json.dumps(unknown,ensure_ascii=True))
                    if not alive and self.child.poll() is not None:clean_snapshots+=1
                    else:clean_snapshots=0
                    if clean_snapshots>=2 or time.monotonic()>=deadline:break
                    time.sleep(.5)
                result['expandedOwnTreeDuringClose']=observed
                result['cleanSnapshots']=clean_snapshots
                result['observedOwnDescendantsExited']=not alive and clean_snapshots>=2
                result['observedOwnDescendantsStillPresent']=alive
            result['exitCode']=self.child.returncode
            deadline=time.monotonic()+20
            while time.monotonic()<deadline and any(port_open(port) for port in (42791,42831)):time.sleep(.25)
            result['listenersClosed']=not any(port_open(port) for port in (42791,42831))
            result['passed']=self.child.returncode==0 and result['listenersClosed'] and result.get('observedOwnDescendantsExited') is True
            if not result['passed']:result['error']='Default host exit code or own listeners did not close normally'
        except Exception as error:result['error']=str(error)
        finally:
            for handle in self.handles:handle.close()
            (self.output/'close.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        return result


def parse_arguments(argv=None):
    parser=argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    scope=parser.add_mutually_exclusive_group()
    scope.add_argument('--probe-only',action='store_true')
    scope.add_argument('--desktop-only',action='store_true',help='Run five desktop checks; explicitly defer browser full-module verification without marking it passed.')
    return parser.parse_args(argv)


def main(argv=None):
    args=parse_arguments(argv)
    proof=actual_context()  # Always before any engine launch, Electron import or write.
    candidate,exe=verify_candidate()
    output=fresh_directory('reports/candidate-engine-probe')
    scratch=fresh_directory('runtime/candidate-engine-probe')
    env=guest_environment(scratch,as_node=True)
    app_env=guest_environment(scratch,as_node=False)
    host=DefaultHost(exe,app_env)
    def runner(name):
        print(json.dumps({'phase':'candidate-check-start','name':name,'at':datetime.now(timezone.utc).isoformat()},ensure_ascii=True),flush=True)
        actual_context();verify_candidate()
        if name=='candidate-host-startup':
            require_synthetic_data()
            group=fresh_directory('reports/candidate-startup')
            local={**app_env,'XJY_SELF_CHECK_OUTPUT':str(group)}
            result=run_owned_process(name,exe,['--self-check'],local,group,timeout=150,allow_force_stop=False)
            if result['exitCode']!=0 or result.get('timedOut'):return result
            file=group/'startup-check.json';result=load_evidence(result,file)
            try:
                png=ordinary(group/'离线程序-首次启动.png')
                with png.open('rb') as handle:header=handle.read(8)
                result['evidence']=validate_startup_evidence(result['evidence'],png_header=header)
            except Exception:result['artifactError']=traceback.format_exc();result['evidence']={**result['evidence'],'actualCheckPassed':False,'artifactError':result['artifactError']}
            return result
        if name=='candidate-offline-fullmodules':
            pid=host.start()
            group=fresh_directory('reports/candidate-offline-fullmodules')
            entry=ordinary(ROOT/'stage1/candidate-browser-probe.cjs');checked_hash(entry)
            result=run_owned_process(name,exe,[str(entry),str(pid)],env,group,timeout=240,allow_force_stop=False)
            return load_evidence(result,group/'result.json')
        if name=='candidate-fakehardware-worker':
            group=fresh_directory('reports/candidate-fakehardware-worker')
            entry=ordinary(ROOT/'stage1/guest-candidate-worker.cjs');checked_hash(entry)
            observer,observer_proof=prepare_worker_observer()
            (group/'observer-launcher.json').write_text(json.dumps(observer_proof,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
            result=run_owned_process(name,observer,[],app_env,group,timeout=180,allow_force_stop=False)
            result=load_evidence(result,group/'result.json');result['evidence']['observerLauncher']=observer_proof
            return result
        if name=='candidate-updater-toy-recovery':
            group=fresh_directory('reports/candidate-updater-toy-recovery')
            # These real disk transactions exercise exactly the shipped helpers;
            # process adapters in unit fixtures remain explicitly labelled toys.
            parity={}
            for module in ('employee-update-cache.cjs','employee-update-installer.cjs'):
                shipped=candidate/'resources/update-helper'/module;source=ROOT/'project/desktop'/module
                digest=checked_hash(shipped)
                if checked_hash(source)!=digest:raise RuntimeError('Signed toy tests differ from actual candidate helper code')
                parity[module]=digest
            tests=['tests/employee-update-cache.test.cjs','tests/employee-update-installer.test.cjs']
            unit=run_owned_process('actual-original-engine-toy-helper-tests',exe,['--test','--test-reporter=tap',*tests],env,group,timeout=240,allow_force_stop=False)
            stdout=Path(unit['stdout']).read_text('utf-8-sig',errors='strict')
            try:unit['testCounts']=parse_zero_skip_tap(stdout)
            except RuntimeError as error:unit['tapError']=str(error)
            if unit['exitCode']!=0 or unit.get('timedOut') or 'tapError' in unit:
                return {**unit,'evidence':{'actualCheckPassed':False,'helperTests':unit,'candidateHelperParity':parity}}
            policies=require_process_policy()
            pure_ps=run_owned_process('actual-delivery-approval-pure-ps','C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',str(ROOT/'stage1/candidate-delivery-approval-pure-ps-tests.ps1')],app_env,group,timeout=90,allow_force_stop=False)
            pure_ps['evidence']=json.loads(Path(pure_ps['stdout']).read_text('utf-8-sig'))
            if pure_ps['exitCode']!=0 or pure_ps.get('timedOut') or pure_ps['evidence'].get('actualCheckPassed') is not True:
                return {**pure_ps,'evidence':{'actualCheckPassed':False,'helperTests':unit,'approvalPurePowerShell':pure_ps,'candidateHelperParity':parity}}
            native=run_owned_process('actual-initial-native-probe','C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',str(ROOT/'stage1/candidate-initial-native-probe.ps1')],app_env,group,timeout=300,allow_force_stop=False)
            native=load_evidence(native,ROOT/'reports/candidate-initial-native-probe/result.json')
            good=native['exitCode']==0 and not native.get('timedOut') and native['evidence'].get('actualCheckPassed') is True
            evidence={'actualCheckPassed':good,'helperTests':unit,'approvalPurePowerShell':pure_ps,'nativeBoundaryProbe':native,'candidateHelperParity':parity,'parentExecutionPolicies':policies,
                'toyInstallerProcessAdapter':True,'signedToyDiskInstallAndRollbackObserved':True,
                'shippingLiteralFPositiveVerified':False,'shippingInitialInstallerFullyVerified':False,'formalApproval':False}
            file=group/'result.json';file.write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
            return {**native,'evidence':evidence,'artifact':str(file)}
        if name=='candidate-three-database-attachments-restore':
            # The native updater check requires a closed installation. Desktop
            # maintenance starts the ordinary host only after that check ends.
            if args.desktop_only and host.child is None:host.start()
            if not host.child or host.child.poll() is not None:raise RuntimeError('Owned actual candidate host required for maintenance')
            policies=require_process_policy()
            group=fresh_directory('reports/candidate-three-database-attachments-restore')
            entry=ordinary(ROOT/'stage1/candidate-maintenance-probe.cjs');checked_hash(entry)
            result=run_owned_process(name,exe,[str(entry),str(host.child.pid)],env,group,timeout=300,allow_force_stop=False)
            result=load_evidence(result,group/'result.json')
            result['evidence']['parentExecutionPoliciesBeforeConfirmation']=policies
            return result
        if name!='engine-capabilities':raise RuntimeError('Unexpected candidate check name')
        entry=ordinary(ROOT/'stage1/guest-original-engine-probe.cjs');checked_hash(entry)
        result=run_owned_process(name,exe,[str(entry),str(scratch)],env,output,timeout=90)
        text=Path(result['stdout']).read_text('utf-8-sig',errors='strict')
        rows=[line for line in text.splitlines() if line.strip().startswith('{')]
        if rows:result['evidence']=json.loads(rows[-1])
        evidence={**result['evidence'],'actualContext':proof,'sourceEngineSha256':ENGINE_SHA,'sourceEngineSize':ENGINE_SIZE,'engineAllowlistSha256':ALLOWLIST_SHA}
        evidence['passed']=result['exitCode']==0 and not result.get('timedOut') and evidence.get('runAsNodeObserved') is True and evidence.get('backupSupported') is True and evidence.get('backupIntegrity')=='ok'
        (output/'result.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        result['evidence']=evidence
        return result
    if args.probe_only:
        result=runner('engine-capabilities');combined={'probeOnly':True,'passed':result['evidence']['passed'],'checks':[result],'candidateGroupsExecuted':0}
    else:
        try:combined=run_sequence(runner,desktop_only=args.desktop_only)
        finally:closed=host.close(env)
        combined=finish_acceptance(combined,closed)
    combined.update({'at':datetime.now(timezone.utc).isoformat(),'actualContext':proof,'crossProcessDefaultHostNativeApiCounterObserved':False})
    (output/'driver-result.json').write_text(json.dumps(combined,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(combined,ensure_ascii=True))
    return 0 if combined['passed'] else 1


if __name__=='__main__':raise SystemExit(main())
