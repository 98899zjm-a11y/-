"""Root-only Guest stdin keeper for frozen9196 serve. No employee launch/kill."""
import argparse, hashlib, json, os, re, stat, subprocess, sys, time
from pathlib import Path
ROOT = Path('C:/xjy-work/xjy-web-stage1')
WORK = ROOT/'runtime/native-employee162-a1'
SELF, PREP, STOP = WORK/'employee-native162-serve-controller.py', WORK/'preparation.json', WORK/'stop-request.txt'
NODE, SERVE, GUARD = ROOT/'stage1/tools/node.exe', ROOT/'audit-tools/employee-native162-e2e.cjs', ROOT/'stage1/guest-candidate-cdp.cjs'
NODE_SHA='ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32'
SERVE_SHA='9196b3c5d3fe7ff073cdc2b9fbc96e860f4db831e31e57992048fc71ccc6a097'
GUARD_SHA='59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32'
MATERIAL_SHA='c042bbd3548c1edd87b372d6b59524c516d9c980635b623770e17e9da595a24d'
def need(value, code):
    if not value: raise RuntimeError(code)
def plain(file):
    for item in (file, *file.parents):
        s=item.lstat(); need(not stat.S_ISLNK(s.st_mode) and not getattr(s,'st_file_attributes',0)&0x400 and os.path.normcase(os.path.realpath(item))==os.path.normcase(str(item)), 'ORDINARY_PATH_REQUIRED')
    need(file.is_file() and file.stat().st_nlink==1, 'SINGLE_LINK_FILE_REQUIRED'); return file
def read(file, pin=None):
    before=plain(file).stat(); body=file.read_bytes(); after=plain(file).stat()
    need((before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns), 'FILE_CHANGED')
    need(pin is None or hashlib.sha256(body).hexdigest()==pin, 'SHA_MISMATCH'); return body
def main():
    p=argparse.ArgumentParser(); p.add_argument('--source-sha256',required=True); p.add_argument('--preparation-sha256',required=True); p.add_argument('--expected-namespace',required=True); a=p.parse_args()
    need(os.name=='nt' and Path(__file__).absolute()==SELF and os.environ.get('USERNAME','').lower()=='wdagutilityaccount', 'ACTUAL_GUEST_FIXED_CONTROLLER_ONLY')
    need(all(re.fullmatch('[0-9a-f]{64}',x) for x in (a.source_sha256,a.preparation_sha256)), 'FULL_SHA_REQUIRED')
    for file,pin in ((SELF,a.source_sha256),(NODE,NODE_SHA),(SERVE,SERVE_SHA),(GUARD,GUARD_SHA)): read(file,pin)
    prepared=json.loads(read(PREP,a.preparation_sha256)); need(prepared['namespace']==a.expected_namespace and prepared['sourceSha256']==SERVE_SHA and prepared['purpose']=='employee-native162-preparation', 'PREPARATION_BINDING_REQUIRED')
    env=prepared['employeeLaunch']['environment']; need(set(env)=={'SystemRoot','WINDIR','PATH','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA'}, 'CLEAN_ENVIRONMENT_REQUIRED')
    guard=subprocess.run([str(NODE),'-e',"console.log(JSON.stringify(require('./stage1/guest-candidate-cdp.cjs').actualGuard()))"],cwd=ROOT,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True)
    proof=json.loads(guard.stdout); need(proof['productionDrivePresent'] is False and proof['nonLoopbackAddressCount']==0 and proof['model']=='Virtual Machine', 'ORIGINAL_ACTUAL_GUARD_REQUIRED')
    for name in ('stop-request.txt','serve-controller.stdout.log','serve-controller.stderr.log','serve-controller-result.json'): need(not os.path.lexists(WORK/name), 'CREATE_NEW_CONTROL_AND_LOGS_REQUIRED')
    result={'purpose':'frozen9196-serve-stdin-controller','sourceSha256':a.source_sha256,'serveSha256':SERVE_SHA,'preparationSha256':a.preparation_sha256,'namespace':a.expected_namespace,'passed':False,'killUsed':False,'employeeLaunched':False,'privateKeyRead':False}; child=None
    with (WORK/'serve-controller.stdout.log').open('xb') as out, (WORK/'serve-controller.stderr.log').open('xb') as err:
        try:
            read(SELF,a.source_sha256); read(SERVE,SERVE_SHA); read(PREP,a.preparation_sha256)
            child=subprocess.Popen([str(NODE),str(SERVE),'--phase','serve','--source-sha256',SERVE_SHA,'--material-manifest-sha256',MATERIAL_SHA,'--expected-namespace',a.expected_namespace,'--preparation-sha256',a.preparation_sha256],cwd=ROOT,env=env,stdin=subprocess.PIPE,stdout=out,stderr=err,creationflags=0x08000000)
            result['pid']=child.pid; print(json.dumps({'event':'SERVE_CONTROLLER_STARTED','pid':child.pid,'stopFile':str(STOP),'preparationSha256':a.preparation_sha256}),flush=True)
            while not os.path.lexists(STOP):
                need(child.poll() is None,'SERVE_EXITED_BEFORE_ROOT_STOP'); time.sleep(0.25)
            need(read(STOP)==('STOP\n'+a.preparation_sha256+'\n').encode('ascii'),'EXACT_STOP_AND_PREPARATION_REQUIRED')
            read(SELF,a.source_sha256); read(SERVE,SERVE_SHA); read(PREP,a.preparation_sha256)
            child.stdin.write(b'STOP\n'); child.stdin.flush(); child.stdin.close(); result['stopForwarded']=True
            result['exitCode']=child.wait(); need(result['exitCode']==0,'REAL_SERVE_EXIT_NONZERO'); result['passed']=True
        except Exception as error:
            result['error']=type(error).__name__+': '+str(error)
        finally:
            if child is not None:
                if not child.stdin.closed: child.stdin.close()
                result['exitCode']=child.wait()  # EOF asks original serve finally to close; never kill/terminate.
    read(SELF,a.source_sha256); read(PREP,a.preparation_sha256)
    with (WORK/'serve-controller-result.json').open('x',encoding='utf-8',newline='\n') as output: json.dump(result,output,ensure_ascii=False,indent=2); output.flush(); os.fsync(output.fileno())
    print(json.dumps(result),flush=True); return 0 if result['passed'] else 1
if __name__=='__main__':
    try: sys.exit(main())
    except Exception as error: print(type(error).__name__+': '+str(error),file=sys.stderr); sys.exit(1)
