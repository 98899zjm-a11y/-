"""One admitted Guest runner for unchanged cashier 17 + extra 10 + restore 10.

baseline: exact original missing-feature 17 (nonzero RED is preserved).
candidate: same original main plus both supplemental suites, using actual ERP
settlement/reversal functions and only the three original read-query AST nodes
from erp_common. No app/repairs stub, no replacement monetary algorithm, no HTTP.
Root alone executes this. There is no arbitrary command/path or cleanup option.
"""
import os
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
PYTHON=Path('C:/Python314/python.exe')
if (os.name!='nt' or os.path.normcase(str(ROOT))!=os.path.normcase('C:/xjy-work/xjy-web-stage1') or
        os.path.normcase(sys.executable)!=os.path.normcase(str(PYTHON)) or
        not sys.flags.isolated or not sys.flags.no_site or not sys.flags.dont_write_bytecode or sys.flags.optimize):
    raise RuntimeError('Fixed actual offline Guest Python314 -I -B -S required before any product load/write')

import argparse
import ast
import contextlib
import hashlib
import importlib.util
import io
import json
import re
import stat
import traceback
import types
import unittest
from datetime import datetime,timezone

SELF='audit-tools/run-cashier-170-domain.py'
OUTPUT=Path('C:/xjy-results')
PYTHON_SHA='434b361fe0c5960d404974feed493db47f2603a1ace2574312104fbed0182c6f'
GUARDS={'stage1/sandbox-context.py':'09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
        'stage1/validate-sandbox-context.py':'867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207'}
LEDGER='project/desktop/legacy-source/ledger/'
BASE='audit-tools/cashier-170-ledger-contract.py'
EXTRA='audit-tools/cashier-170-domain-extra-contract.py'
RESTORE_TEST='audit-tools/cashier-170-restore-contract.py'
RED_PINS='audit-tools/cashier-170-ledger-red-pins.json'
CANDIDATE_PINS='audit-tools/cashier-170-ledger-candidate-a1.json'
COMMON_FILES=(BASE,RED_PINS,LEDGER+'erp_schema.py')
CANDIDATE_FILES=(EXTRA,RESTORE_TEST,CANDIDATE_PINS,LEDGER+'erp_values.py',LEDGER+'erp_common.py',
                 LEDGER+'erp_settlement.py',LEDGER+'cashier_schema.py',LEDGER+'cashier_numbers.py',
                 LEDGER+'cashier_engine.py',LEDGER+'cashier_restore.py')
SUBJECTS=('cashier_schema.py','cashier_numbers.py','cashier_engine.py')
QUERY_NAMES=('one','document','is_reversed')


def stamp():return datetime.now(timezone.utc).isoformat()


def ordinary(file,directory=False):
    file=Path(file)
    for item in (file,*file.parents):
        info=item.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info,'st_file_attributes',0)&0x400:
            raise RuntimeError('Non-reparse ordinary path required: '+str(item))
        if stat.S_ISREG(info.st_mode) and info.st_nlink!=1:
            raise RuntimeError('Hardlinked source/output refused: '+str(item))
        if not (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode)):
            raise RuntimeError('Ordinary file/directory required: '+str(item))
    info=file.stat()
    if not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)):
        raise RuntimeError('Wrong source/output path kind: '+str(file))
    return info


def identity(info):return (info.st_dev,info.st_ino,info.st_size,info.st_mtime_ns,info.st_ctime_ns,info.st_nlink)


def read(file,limit=4*1024*1024):
    before=ordinary(file)
    if not 0<before.st_size<=limit:raise RuntimeError('Bounded nonempty source required: '+str(file))
    with file.open('rb') as stream:
        opened=os.fstat(stream.fileno())
        if any(getattr(before,k)!=getattr(opened,k) for k in ('st_dev','st_ino','st_size','st_mtime_ns','st_nlink')):
            raise RuntimeError('Source changed before open')
        body=stream.read(limit+1)
        if len(body)!=before.st_size or identity(os.fstat(stream.fileno()))!=identity(opened):
            raise RuntimeError('Source changed during read')
    if identity(ordinary(file))!=identity(before):raise RuntimeError('Source changed after read')
    return body


def pinned(file,expected):
    body=read(file)
    if hashlib.sha256(body).hexdigest()!=expected:raise RuntimeError('Exact reviewed pin mismatch: '+str(file))
    return body


def load(name,relative,body):
    if name in sys.modules:raise RuntimeError('Unexpected preloaded module: '+name)
    module=types.ModuleType(name);module.__file__=str(ROOT/relative);sys.modules[name]=module
    exec(compile(body,module.__file__,'exec',dont_inherit=True,optimize=0),module.__dict__)
    return module


def load_actual_erp(sources,query_pins):
    values=load('erp_values',LEDGER+'erp_values.py',sources[LEDGER+'erp_values.py'])
    tree=ast.parse(sources[LEDGER+'erp_common.py'],filename=str(ROOT/(LEDGER+'erp_common.py')))
    selected=[]
    for name in QUERY_NAMES:
        matches=[node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name==name]
        if len(matches)!=1:raise RuntimeError('Exact original query function missing: '+name)
        node=matches[0]
        if node.decorator_list:raise RuntimeError('Original query function unexpectedly decorated')
        actual=hashlib.sha256(ast.dump(node,include_attributes=False).encode('utf-8')).hexdigest()
        if actual!=query_pins[name]:raise RuntimeError('Original query function AST changed: '+name)
        selected.append(node)
    # Compile the actual selected AST nodes, preserving every original statement.
    # The two globals below are actual exports from the fully pinned ERP values
    # module. No app, repairs.transaction, cash math or database factory is stubbed.
    common=types.ModuleType('erp_common');common.__file__=str(ROOT/(LEDGER+'erp_common.py'))
    if 'erp_common' in sys.modules:raise RuntimeError('Unexpected preloaded ERP common module')
    common.ErpError=values.ErpError;common.identifier=values.identifier
    sys.modules['erp_common']=common
    selected_tree=ast.Module(body=selected,type_ignores=[])
    exec(compile(selected_tree,common.__file__,'exec',dont_inherit=True,optimize=0),common.__dict__)
    settlement=load('erp_settlement',LEDGER+'erp_settlement.py',sources[LEDGER+'erp_settlement.py'])
    for name in ('accept_settlement','accept_cashier_reversal','accept_reversal','validate_timeline'):
        if not callable(getattr(settlement,name,None)):raise RuntimeError('Actual ERP bridge export missing: '+name)
    return {'erpCommonMode':'exact-original-query-AST','queryFunctions':list(QUERY_NAMES),
            'queryAstSha256':query_pins,'settlementMode':'full-original-source-with-reviewed-cashier-reversal-bridge',
            'appImported':False,'repairsImported':False,'noMonetaryPortReplacement':True}


class Tee:
    def __init__(self,original,log,capture=None):self.original=original;self.log=log;self.capture=capture
    def write(self,value):
        self.original.write(value);self.log.write(value)
        if self.capture is not None:self.capture.write(value)
        self.flush();return len(value)
    def flush(self):self.original.flush();self.log.flush()
    def isatty(self):return False
    @property
    def encoding(self):return 'utf-8'


def suite_result(name,suite,expected):
    if suite.countTestCases()!=expected:raise RuntimeError(name+' changed its reviewed method count')
    print(json.dumps({'stage':name,'startedAt':stamp(),'methods':expected}),flush=True)
    result=unittest.TextTestRunner(verbosity=2,stream=sys.stderr).run(suite)
    return {'name':name,'testsRun':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),
            'skipped':len(result.skipped),'passed':result.wasSuccessful() and not result.skipped,
            'failureIds':[test.id() for test,_ in result.failures],'errorIds':[test.id() for test,_ in result.errors]}


def main():
    parser=argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    parser.add_argument('--phase',required=True,choices=('baseline','candidate'))
    parser.add_argument('--expected-namespace',required=True)
    parser.add_argument('--self-sha256',required=True)
    parser.add_argument('--pins',required=True)
    parser.add_argument('--pins-sha256',required=True)
    parser.add_argument('--run-id',required=True)
    args=parser.parse_args()
    if (not re.fullmatch('[0-9a-f]{64}',args.self_sha256) or not re.fullmatch('[0-9a-f]{64}',args.pins_sha256) or
            not re.fullmatch(r'[A-Za-z0-9_.-]{8,160}',args.expected_namespace) or
            not re.fullmatch(r'cashier-domain170-'+args.phase+r'-[a-z0-9][a-z0-9-]{0,39}',args.run_id) or
            not re.fullmatch(r'cashier-170-domain-runner-pins-[a-z0-9-]+\.json',args.pins)):
        raise RuntimeError('Reviewed hashes, namespace, phase-specific new run ID and fixed pins basename required')
    pinned(ROOT/SELF,args.self_sha256);pinned(PYTHON,PYTHON_SHA)
    if sys.version_info[:3]!=(3,14,8) or importlib.util.MAGIC_NUMBER.hex()!='2b0e0d0a':
        raise RuntimeError('Actual fixed Python 3.14.8 required')
    guard_sources={name:pinned(ROOT/name,sha) for name,sha in GUARDS.items()}
    identity_record=json.loads(read(ROOT/'isolation-identity.json',64*1024).decode('utf-8-sig'))
    if identity_record.get('namespace')!=args.expected_namespace:raise RuntimeError('Actual Guest namespace differs')
    guard=load('cashier_domain_runner_actual_guard','stage1/sandbox-context.py',guard_sources['stage1/sandbox-context.py'])
    admission=guard.read_context(ROOT)
    pinned(ROOT/SELF,args.self_sha256)
    manifest_path=ROOT/'audit-tools'/args.pins
    manifest=json.loads(pinned(manifest_path,args.pins_sha256).decode('utf-8-sig'))
    if (set(manifest)!={'version','files','erpCommonQueryAstSha256'} or manifest['version']!=1 or
            set(manifest['files'])!=set(COMMON_FILES+CANDIDATE_FILES) or
            set(manifest['erpCommonQueryAstSha256'])!=set(QUERY_NAMES) or
            any(not isinstance(v,str) or not re.fullmatch('[0-9a-f]{64}',v) for v in list(manifest['files'].values())+list(manifest['erpCommonQueryAstSha256'].values()))):
        raise RuntimeError('Exact reviewed source closure/pin schema required')
    required=COMMON_FILES+(CANDIDATE_FILES if args.phase=='candidate' else ())
    sources={name:pinned(ROOT/name,manifest['files'][name]) for name in required}
    if args.phase=='baseline':
        for name in SUBJECTS:
            file=ROOT/(LEDGER+name)
            if file.exists() or file.is_symlink():raise RuntimeError('Baseline requires genuinely absent cashier subjects; never delete them through this runner')
    else:
        candidate=json.loads(sources[CANDIDATE_PINS])
        if (candidate!={'version':1,'erpSchemaSha256':manifest['files'][LEDGER+'erp_schema.py'],
                        'subjects':{name:manifest['files'][LEDGER+name] for name in SUBJECTS}}):
            raise RuntimeError('Original fixture candidate pins disagree with full closure')
    ordinary(ROOT/'runtime',directory=True);ordinary(OUTPUT,directory=True)
    out=OUTPUT/args.run_id;out.mkdir(exist_ok=False);out_info=ordinary(out,directory=True)
    def output_check():
        current=ordinary(out,directory=True)
        if (current.st_dev,current.st_ino)!=(out_info.st_dev,out_info.st_ino):raise RuntimeError('Output directory identity changed')
    report={'version':1,'phase':args.phase,'namespace':args.expected_namespace,'startedAt':stamp(),'admission':admission,
            'runnerSha256':args.self_sha256,'pinsSha256':args.pins_sha256,'sources':{name:manifest['files'][name] for name in required},
            'stages':[],'passed':False,'exitCode':1,'actualAppVerified':False,'httpOrHmacVerified':False,
            'productionDataUsed':False,'productionRestoreVerified':False}
    stdout_capture=io.StringIO()
    with (out/'stdout.log').open('x',encoding='utf-8',newline='\n') as stdout_log,(out/'stderr.log').open('x',encoding='utf-8',newline='\n') as stderr_log:
        with contextlib.redirect_stdout(Tee(sys.stdout,stdout_log,stdout_capture)),contextlib.redirect_stderr(Tee(sys.stderr,stderr_log)):
            try:
                if args.phase=='candidate':report['erpBridge']=load_actual_erp(sources,manifest['erpCommonQueryAstSha256'])
                base=load('cashier_original_17_contract',BASE,sources[BASE])
                saved_argv=sys.argv[:]
                try:
                    sys.argv=[str(ROOT/BASE),'--source-sha256',manifest['files'][BASE],'--pins',str(ROOT/(CANDIDATE_PINS if args.phase=='candidate' else RED_PINS))]
                    base_exit=base.main()  # Unchanged original admission, loader, 17 tests and assertions.
                finally:sys.argv=saved_argv
                summaries=[]
                for line in stdout_capture.getvalue().splitlines():
                    try:value=json.loads(line)
                    except ValueError:continue
                    if isinstance(value,dict) and {'testsRun','failures','errors','passed'}<=set(value):summaries.append(value)
                if not summaries or summaries[-1]['testsRun']!=17:raise RuntimeError('Original 17 test result footer missing or method count changed')
                original=dict(summaries[-1],name='original-17',exitCode=base_exit)
                if original['passed']!=(base_exit==0):raise RuntimeError('Original result and exit code disagree')
                report['stages'].append(original);report['fictionalRuntime']=str(base.RUN_ROOT)
                if args.phase=='candidate':
                    extra=load('cashier_extra_10_contract',EXTRA,sources[EXTRA])
                    report['stages'].append(suite_result('extra-10',extra.build_suite(base),10))
                    restore=load('cashier_restore',LEDGER+'cashier_restore.py',sources[LEDGER+'cashier_restore.py'])
                    restore_test=load('cashier_restore_10_contract',RESTORE_TEST,sources[RESTORE_TEST])
                    report['stages'].append(suite_result('restore-10',restore_test.build_suite(base,restore),10))
                else:
                    report['notRun']=['extra-10: candidate implementation required','restore-10: candidate implementation required']
                    report['observedExpectedFeatureAbsence']=(original['failures']==17 and original['errors']==0 and base_exit==1)
                for name in ('app','repairs'):
                    if name in sys.modules:raise RuntimeError('Unexpected application/transaction dependency was imported: '+name)
                for name in required:pinned(ROOT/name,manifest['files'][name])
                for name,sha in GUARDS.items():pinned(ROOT/name,sha)
                pinned(ROOT/SELF,args.self_sha256);pinned(manifest_path,args.pins_sha256)
                report['sourcePinsStable']=True
                report['passed']=args.phase=='candidate' and len(report['stages'])==3 and all(stage['passed'] for stage in report['stages'])
                report['exitCode']=0 if report['passed'] else 1
            except Exception as exc:
                report['runnerError']={'type':type(exc).__name__,'message':str(exc)}
                traceback.print_exc()
            finally:
                report['finishedAt']=stamp();output_check()
                print(json.dumps({'purpose':'cashier-domain-actual-sqlite-results','phase':args.phase,'passed':report['passed'],
                                  'exitCode':report['exitCode'],'resultFile':str(out/'results.json')},ensure_ascii=False),flush=True)
    output_check()
    with (out/'results.json').open('x',encoding='utf-8',newline='\n') as stream:
        json.dump(report,stream,ensure_ascii=False,indent=2);stream.write('\n');stream.flush();os.fsync(stream.fileno())
    return report['exitCode']


if __name__=='__main__':raise SystemExit(main())
