"""Fixed independent Guest runner: 15 principal contracts x 3 actual sources.

Reads only pinned pure constants/functions from sidecars; never boots an App.
Loads the actual cashier_engine only for its actual capability validator.
SQLite connection attempts are explicitly forbidden during these pure tests.
Root executes baseline/candidate in the real admitted offline Guest.
"""
import os
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
PYTHON=Path('C:/Python314/python.exe')
if (os.name!='nt' or os.path.normcase(str(ROOT))!=os.path.normcase('C:/xjy-work/xjy-web-stage1') or
        os.path.normcase(sys.executable)!=os.path.normcase(str(PYTHON)) or
        not sys.flags.isolated or not sys.flags.no_site or not sys.flags.dont_write_bytecode or sys.flags.optimize):
    raise RuntimeError('Actual fixed offline Guest Python314 -I -B -S required before source loading')

import argparse
import ast
import base64
import contextlib
import hashlib
import hmac
import importlib.util
import json
import re
import stat
import time
import traceback
import types
import unittest
from datetime import datetime,timezone

SELF='audit-tools/run-cashier-170-python-principal.py'
TEST='audit-tools/cashier-170-python-principal-contract.py'
ENGINE='project/desktop/legacy-source/ledger/cashier_engine.py'
PYTHON_SHA='434b361fe0c5960d404974feed493db47f2603a1ace2574312104fbed0182c6f'
GUARDS={'stage1/sandbox-context.py':'09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
        'stage1/validate-sandbox-context.py':'867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207'}
CURRENT={'generic':'project/desktop/legacy-source/sidecar.py','release':'project/desktop/legacy-source/sidecar_release.py',
         'ledger':'project/desktop/legacy-source/ledger/sidecar.py'}
BASELINE={label:'audit-tools/qa-history/cashier-principal170-before-a1/'+label+'.py.txt' for label in CURRENT}
CONSTANTS=('ERP_LEVELS','ERP_CAPABILITIES','ERP_READ_ENDPOINTS','ERP_STATIC_FILES','ERP_UUID')
FUNCTIONS=('principal_actor','erp_authority')
OUTPUT=Path('C:/xjy-results')


def ordinary(path,directory=False):
    for item in (path,*path.parents):
        st=item.lstat()
        if stat.S_ISLNK(st.st_mode) or getattr(st,'st_file_attributes',0)&0x400 or stat.S_ISREG(st.st_mode) and st.st_nlink!=1:
            raise RuntimeError('Ordinary non-reparse single-link source/output required')
        if not (stat.S_ISREG(st.st_mode) or stat.S_ISDIR(st.st_mode)):raise RuntimeError('Unexpected filesystem object')
    st=path.stat()
    if not (stat.S_ISDIR(st.st_mode) if directory else stat.S_ISREG(st.st_mode)):raise RuntimeError('Wrong file/directory type')
    return st


def identity(st):return (st.st_dev,st.st_ino,st.st_size,st.st_mtime_ns,st.st_ctime_ns,st.st_nlink)


def read(path,limit=4*1024*1024):
    before=ordinary(path)
    if not 0<before.st_size<=limit:raise RuntimeError('Bounded nonempty source required')
    with path.open('rb') as stream:
        opened=os.fstat(stream.fileno())
        if any(getattr(before,key)!=getattr(opened,key) for key in ('st_dev','st_ino','st_size','st_mtime_ns','st_nlink')):
            raise RuntimeError('Source changed before opening')
        body=stream.read(limit+1)
        if len(body)!=before.st_size or identity(os.fstat(stream.fileno()))!=identity(opened):raise RuntimeError('Source changed while reading')
    if identity(ordinary(path))!=identity(before):raise RuntimeError('Source changed after reading')
    return body


def pinned(path,sha):
    body=read(path)
    if hashlib.sha256(body).hexdigest()!=sha:raise RuntimeError('Reviewed SHA differs: '+str(path))
    return body


def load(name,path,body):
    if name in sys.modules:raise RuntimeError('Unexpected previously loaded source module: '+name)
    module=types.ModuleType(name);module.__file__=str(path);sys.modules[name]=module
    exec(compile(body,str(path),'exec',dont_inherit=True,optimize=0),module.__dict__)
    return module


def pure_subject(label,path,body):
    tree=ast.parse(body,filename=str(path));selected=[];observed={}
    for name in CONSTANTS:
        nodes=[n for n in tree.body if isinstance(n,ast.Assign) and len(n.targets)==1 and isinstance(n.targets[0],ast.Name) and n.targets[0].id==name]
        if len(nodes)!=1:raise RuntimeError('One original literal constant required: '+name)
        ast.literal_eval(nodes[0].value)
        selected.append(nodes[0])
    for name in FUNCTIONS:
        nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name==name]
        if len(nodes)!=1 or nodes[0].decorator_list:raise RuntimeError('One original undecorated function required: '+name)
        selected.append(nodes[0]);observed[name]=hashlib.sha256(ast.dump(nodes[0],include_attributes=False).encode()).hexdigest()
    module=types.ModuleType('cashier_principal_actual_'+label);module.__file__=str(path)
    module.__dict__.update(base64=base64,hashlib=hashlib,hmac=hmac,json=json,re=re,time=time)
    # AST nodes are compiled intact, not regenerated or rewritten.
    exec(compile(ast.Module(body=selected,type_ignores=[]),str(path),'exec',dont_inherit=True,optimize=0),module.__dict__)
    return module,observed


def main():
    parser=argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    parser.add_argument('--phase',required=True,choices=('baseline','candidate'))
    parser.add_argument('--expected-namespace',required=True)
    parser.add_argument('--self-sha256',required=True)
    parser.add_argument('--pins',required=True)
    parser.add_argument('--pins-sha256',required=True)
    parser.add_argument('--run-id',required=True)
    args=parser.parse_args()
    if (not re.fullmatch('[a-f0-9]{64}',args.self_sha256) or not re.fullmatch('[a-f0-9]{64}',args.pins_sha256) or
            not re.fullmatch(r'[A-Za-z0-9_.-]{8,160}',args.expected_namespace) or
            not re.fullmatch(r'cashier-principal170-'+args.phase+r'-[a-z0-9][a-z0-9-]{0,39}',args.run_id) or
            not re.fullmatch(r'cashier-170-python-principal-pins-'+args.phase+r'-[a-z0-9-]+\.json',args.pins)):
        raise RuntimeError('Exact reviewed hashes, namespace, phase pins and new run ID required')
    pinned(ROOT/SELF,args.self_sha256);pinned(PYTHON,PYTHON_SHA)
    if sys.version_info[:3]!=(3,14,8) or importlib.util.MAGIC_NUMBER.hex()!='2b0e0d0a':raise RuntimeError('Actual Python 3.14.8 required')
    guard_sources={name:pinned(ROOT/name,sha) for name,sha in GUARDS.items()}
    actual_identity=json.loads(read(ROOT/'isolation-identity.json',64*1024).decode('utf-8-sig'))
    if actual_identity.get('namespace')!=args.expected_namespace:raise RuntimeError('Actual Guest namespace mismatch')
    guard=load('cashier_principal_actual_guest_guard',ROOT/'stage1/sandbox-context.py',guard_sources['stage1/sandbox-context.py'])
    admission=guard.read_context(ROOT)
    manifest_path=ROOT/'audit-tools'/args.pins
    manifest=json.loads(pinned(manifest_path,args.pins_sha256).decode('utf-8-sig'))
    if set(manifest)!={'version','phase','testSha256','engineSha256','subjects'} or manifest['version']!=1 or manifest['phase']!=args.phase or set(manifest['subjects'])!=set(CURRENT):
        raise RuntimeError('Exact principal source manifest required')
    paths=BASELINE if args.phase=='baseline' else CURRENT
    pins={TEST:manifest['testSha256'],ENGINE:manifest['engineSha256']}
    for label,item in manifest['subjects'].items():
        if set(item)!={'path','sha256'} or item['path']!=paths[label]:raise RuntimeError('Only the fixed three actual/baseline sidecar paths are permitted')
        pins[item['path']]=item['sha256']
    if any(not isinstance(v,str) or not re.fullmatch('[a-f0-9]{64}',v) for v in pins.values()):raise RuntimeError('Exact source SHA required')
    sources={name:pinned(ROOT/name,sha) for name,sha in pins.items()}
    ordinary(OUTPUT,directory=True);out=OUTPUT/args.run_id;out.mkdir(exist_ok=False);created=ordinary(out,directory=True)
    report={'version':1,'phase':args.phase,'namespace':args.expected_namespace,'admission':admission,
            'startedAt':datetime.now(timezone.utc).isoformat(),'runnerSha256':args.self_sha256,'pinsSha256':args.pins_sha256,
            'sources':pins,'pureConstants':list(CONSTANTS),'pureFunctions':list(FUNCTIONS),'passed':False,'exitCode':1,
            'actualAppVerified':False,'httpVerified':False,'databaseOpened':False,'productionDataUsed':False}
    database_attempts=[]
    def deny_database(event,values):
        if event.startswith('sqlite3.connect'):
            database_attempts.append(event)
            raise RuntimeError('Principal-only contracts forbid all SQLite connections')
    sys.addaudithook(deny_database)
    with (out/'stdout.log').open('x',encoding='utf-8',newline='\n') as stdout_log,(out/'stderr.log').open('x',encoding='utf-8',newline='\n') as stderr_log:
        with contextlib.redirect_stdout(stdout_log),contextlib.redirect_stderr(stderr_log):
            try:
                load('cashier_engine',ROOT/ENGINE,sources[ENGINE])
                subjects={};report['actualFunctionAstSha256']={}
                for label,path in paths.items():subjects[label],report['actualFunctionAstSha256'][label]=pure_subject(label,ROOT/path,sources[path])
                tests=load('cashier_python_principal_contract',ROOT/TEST,sources[TEST])
                suite=tests.build_suite(subjects,admitted=True)
                if suite.countTestCases()!=45:raise RuntimeError('Exact 15 methods x three source variants required')
                result=unittest.TextTestRunner(verbosity=2,stream=sys.stderr).run(suite)
                report.update(testsRun=result.testsRun,failures=len(result.failures),errors=len(result.errors),skipped=len(result.skipped),
                              failureIds=[test.id() for test,_ in result.failures],errorIds=[test.id() for test,_ in result.errors])
                if database_attempts:raise RuntimeError('A pure principal test attempted a database connection')
                if 'app' in sys.modules or 'repairs' in sys.modules:raise RuntimeError('Unexpected App/repairs import')
                for name,sha in pins.items():pinned(ROOT/name,sha)
                for name,sha in GUARDS.items():pinned(ROOT/name,sha)
                pinned(ROOT/SELF,args.self_sha256);pinned(manifest_path,args.pins_sha256)
                report['sourcePinsStable']=True;report['passed']=result.wasSuccessful() and not result.skipped
                report['exitCode']=0 if report['passed'] else 1
            except Exception as exc:
                report['runnerError']={'type':type(exc).__name__,'message':str(exc)};traceback.print_exc()
            finally:
                report['databaseConnectionAttempts']=len(database_attempts);report['finishedAt']=datetime.now(timezone.utc).isoformat()
    final=ordinary(out,directory=True)
    if (final.st_dev,final.st_ino)!=(created.st_dev,created.st_ino):raise RuntimeError('Output directory identity changed')
    with (out/'results.json').open('x',encoding='utf-8',newline='\n') as stream:
        json.dump(report,stream,ensure_ascii=False,indent=2);stream.write('\n');stream.flush();os.fsync(stream.fileno())
    print(json.dumps({'phase':args.phase,'passed':report['passed'],'testsRun':report.get('testsRun',0),'exitCode':report['exitCode'],
                      'results':str(out/'results.json')},ensure_ascii=False),flush=True)
    return report['exitCode']


if __name__=='__main__':raise SystemExit(main())
