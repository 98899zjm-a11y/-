"""Thin admitted runner: repeat the frozen 37, then run five new worker tests.

Uses the unchanged domain runner's admission, loader, path/hash and unittest
helpers. The 37 are repeated regression, not new coverage. Worker tests are
post-auth actual SQLite/helper tests, not native CLI/HMAC integration.
"""
import os
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
if (os.name!='nt' or os.path.normcase(str(ROOT))!=os.path.normcase('C:/xjy-work/xjy-web-stage1') or
        os.path.normcase(sys.executable)!=os.path.normcase('C:/Python314/python.exe') or
        not sys.flags.isolated or not sys.flags.no_site or not sys.flags.dont_write_bytecode or sys.flags.optimize):
    raise RuntimeError('Fixed actual Guest Python314 -I -B -S required before source loading')

import argparse
import contextlib
import hashlib
import json
import re
import stat
import traceback
import types

SELF='audit-tools/run-cashier-170-maintenance-worker.py'
DOMAIN='audit-tools/run-cashier-170-domain.py'
DOMAIN_SHA='b3027662c0f91130f1b021f9b734865abe9536dc720ee289d6ce12c8ec4015c3'
DOMAIN_PINS='audit-tools/cashier-170-domain-runner-pins-a1.json'
DOMAIN_PINS_SHA='c8ee3a73da678823fff56697ed45f5ee740463f4bd6d3522ffb883eabc275efa'
CANDIDATE='audit-tools/cashier-170-maintenance-candidate-a1.json'
CANDIDATE_SHA='8d9eeee3d472edff06f5dd452aea49e53013408efc57773daf4d96e395091921'
PINS='audit-tools/cashier-170-maintenance-worker-runner-pins-a1.json'
CONTEXT='project/desktop/legacy-source/desktop_runtime_context.py'
WORKER='project/desktop/legacy-source/ledger/cashier_maintenance.py'
TEST='audit-tools/cashier-170-maintenance-worker-contract.py'


def bootstrap_domain():
    file=ROOT/DOMAIN
    for item in (file,*file.parents):
        st=item.lstat()
        if stat.S_ISLNK(st.st_mode) or getattr(st,'st_file_attributes',0)&0x400 or stat.S_ISREG(st.st_mode) and st.st_nlink!=1:
            raise RuntimeError('Original runner must be an ordinary non-reparse source')
    before=file.stat()
    if not 0<before.st_size<=4*1024*1024:raise RuntimeError('Original runner size invalid')
    raw=file.read_bytes();after=file.stat()
    if (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns) or hashlib.sha256(raw).hexdigest()!=DOMAIN_SHA:
        raise RuntimeError('Original domain runner source changed')
    module=types.ModuleType('cashier_reused_domain_runner');module.__file__=str(file)
    exec(compile(raw,str(file),'exec',dont_inherit=True,optimize=0),module.__dict__)
    return module


def main():
    parser=argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    parser.add_argument('--expected-namespace',required=True)
    parser.add_argument('--self-sha256',required=True)
    parser.add_argument('--pins-sha256',required=True)
    parser.add_argument('--run-id',required=True)
    args=parser.parse_args()
    if (not re.fullmatch('[a-f0-9]{64}',args.self_sha256) or not re.fullmatch('[a-f0-9]{64}',args.pins_sha256) or
            not re.fullmatch(r'[A-Za-z0-9_.-]{8,160}',args.expected_namespace) or not re.fullmatch(r'cashier-worker170-[a-z0-9][a-z0-9-]{0,23}',args.run_id)):
        raise RuntimeError('Reviewed hashes, actual namespace and new worker run ID required')
    domain=bootstrap_domain();domain.pinned(ROOT/SELF,args.self_sha256)
    original_pins=json.loads(domain.pinned(ROOT/DOMAIN_PINS,DOMAIN_PINS_SHA))
    candidate=json.loads(domain.pinned(ROOT/CANDIDATE,CANDIDATE_SHA))
    manifest=json.loads(domain.pinned(ROOT/PINS,args.pins_sha256))
    required=set(original_pins['files'])|{DOMAIN,DOMAIN_PINS,CANDIDATE,CONTEXT,WORKER,TEST}
    if set(manifest)!={'version','files'} or manifest['version']!=1 or set(manifest['files'])!=required:
        raise RuntimeError('Exact old regression plus worker source closure required')
    for name,sha in original_pins['files'].items():
        if manifest['files'][name]!=sha:raise RuntimeError('Frozen original regression dependency changed')
    for name in (WORKER,TEST):
        if manifest['files'][name]!=candidate['subjects'][name]:raise RuntimeError('Frozen 8d9eeee maintenance candidate changed')
    sources={name:domain.pinned(ROOT/name,sha) for name,sha in manifest['files'].items()}
    suffix=args.run_id.removeprefix('cashier-worker170-');inner_id='cashier-domain170-candidate-worker-'+suffix
    saved=sys.argv[:]
    try:
        sys.argv=[str(ROOT/DOMAIN),'--phase','candidate','--expected-namespace',args.expected_namespace,
                  '--self-sha256',DOMAIN_SHA,'--pins',Path(DOMAIN_PINS).name,'--pins-sha256',DOMAIN_PINS_SHA,'--run-id',inner_id]
        repeated_exit=domain.main()  # Original real Guest admission and all 37 unchanged assertions.
    finally:sys.argv=saved
    repeated_path=domain.OUTPUT/inner_id/'results.json'
    repeated=json.loads(domain.read(repeated_path))
    if repeated.get('namespace')!=args.expected_namespace:raise RuntimeError('Repeated regression namespace differs')
    domain.ordinary(domain.OUTPUT,directory=True);out=domain.OUTPUT/args.run_id;out.mkdir(exist_ok=False);created=domain.ordinary(out,directory=True)
    report={'version':1,'purpose':'cashier-maintenance-worker-post-auth-tests','namespace':args.expected_namespace,
            'repeatedRegressionMethods':37,'newMethods':5,'expectedTotalMethods':42,'repeatedResult':str(repeated_path),
            'repeatedExitCode':repeated_exit,'runnerSha256':args.self_sha256,'pinsSha256':args.pins_sha256,
            'sources':manifest['files'],'passed':False,'exitCode':1,'nativeCliVerified':False,'ticketAdmissionVerified':False,
            'productionDataUsed':False,'startedAt':domain.stamp()}
    with (out/'stdout.log').open('x',encoding='utf-8',newline='\n') as stdout_log,(out/'stderr.log').open('x',encoding='utf-8',newline='\n') as stderr_log:
        with contextlib.redirect_stdout(domain.Tee(sys.stdout,stdout_log)),contextlib.redirect_stderr(domain.Tee(sys.stderr,stderr_log)):
            try:
                if repeated_exit!=0 or repeated.get('passed') is not True:raise RuntimeError('New worker tests blocked by failed repeated 37 regression; see retained inner result')
                base=sys.modules.get('cashier_original_17_contract')
                if base is None or base.RUN_ROOT is None:raise RuntimeError('Original admitted fixture not initialized')
                domain.load('desktop_runtime_context',CONTEXT,sources[CONTEXT])
                worker=domain.load('cashier_maintenance',WORKER,sources[WORKER])
                test=domain.load('cashier_maintenance_worker_contract',TEST,sources[TEST])
                report['workerResult']=domain.suite_result('worker-post-auth-5',test.build_suite(base,worker),5)
                for name,sha in manifest['files'].items():domain.pinned(ROOT/name,sha)
                domain.pinned(ROOT/SELF,args.self_sha256);domain.pinned(ROOT/PINS,args.pins_sha256)
                report['sourcePinsStable']=True;report['passed']=report['workerResult']['passed'];report['exitCode']=0 if report['passed'] else 1
            except Exception as exc:
                report['runnerError']={'type':type(exc).__name__,'message':str(exc)};traceback.print_exc()
            finally:report['finishedAt']=domain.stamp()
    final=domain.ordinary(out,directory=True)
    if (final.st_dev,final.st_ino)!=(created.st_dev,created.st_ino):raise RuntimeError('Worker result directory changed')
    with (out/'results.json').open('x',encoding='utf-8',newline='\n') as stream:
        json.dump(report,stream,ensure_ascii=False,indent=2);stream.write('\n');stream.flush();os.fsync(stream.fileno())
    print(json.dumps({'passed':report['passed'],'exitCode':report['exitCode'],'repeatedMethods':37,'newMethods':5,'results':str(out/'results.json')}),flush=True)
    return report['exitCode']


if __name__=='__main__':raise SystemExit(main())
