"""Guest-only CreateNew placement of one pinned public manifest, no business."""
from pathlib import Path
import argparse,ast,hashlib,json,os,stat,sys,types

ROOT=Path('C:/xjy-work/xjy-web-stage1')
INPUT=Path('C:/xjy-input')
RESULTS=Path('C:/xjy-results')
HELPER=ROOT/'audit-tools/place-native162-public-inputs.py'
HELPER_SHA='00f2523dd52b79509ef37328f9a41934bfb2ed493cd32bbc5c993f9b6d329536'
SOURCE=INPUT/'public161-material-a1/baseline161-manifest.json'
TARGET=ROOT/'release-work/employee-real162-a1/baseline161-manifest.json'
PIN='e1ff037d5fdb819561719c44487455c676fb90f8e8c18ff54509fbe155828095'
REPORT=RESULTS/'public161-baseline-placement-a1.json'

def main():
    if os.name!='nt' or Path(__file__).absolute()!=ROOT/'audit-tools/place-public161-baseline.py':
        raise RuntimeError('Fixed actual Guest script required')
    if Path(sys.executable)!=Path('C:/Python314/python.exe') or not (sys.flags.isolated and sys.flags.no_site and sys.dont_write_bytecode) or sys.flags.optimize:
        raise RuntimeError('Pinned public Python -I -B -S required')
    parser=argparse.ArgumentParser(allow_abbrev=False)
    parser.add_argument('--source-sha256',required=True)
    args=parser.parse_args()
    source_body=Path(__file__).read_bytes()
    if len(args.source_sha256)!=64 or hashlib.sha256(source_body).hexdigest()!=args.source_sha256:
        raise RuntimeError('Reviewed source SHA required')
    helper=HELPER.read_bytes()
    if hashlib.sha256(helper).hexdigest()!=HELPER_SHA:raise RuntimeError('Public placement helper changed')
    wanted={'need','sha','stamp','same_object','ordinary','stable_bytes','absent','write_new'}
    definitions=[node for node in ast.parse(helper).body if isinstance(node,ast.FunctionDef) and node.name in wanted]
    if len(definitions)!=len(wanted) or {node.name for node in definitions}!=wanted:raise RuntimeError('Exact pure helpers required')
    ns={'Path':Path,'os':os,'stat':stat,'hashlib':hashlib}
    exec(compile(ast.Module(body=definitions,type_ignores=[]),str(HELPER),'exec',dont_inherit=True),ns)
    need,read,put=ns['need'],ns['stable_bytes'],ns['write_new']
    read(HELPER,ROOT,expected_sha=HELPER_SHA)
    read(Path(__file__),ROOT,expected_sha=args.source_sha256)
    read(Path(sys.executable),Path('C:/Python314'),expected_sha='434b361fe0c5960d404974feed493db47f2603a1ace2574312104fbed0182c6f')
    guard_file=ROOT/'stage1/sandbox-context.py'
    guard_body=read(guard_file,ROOT,expected_sha='09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249')
    read(ROOT/'stage1/validate-sandbox-context.py',ROOT,expected_sha='867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207')
    guard=types.ModuleType('public161_manifest_actual_context');guard.__file__=str(guard_file)
    exec(compile(guard_body,str(guard_file),'exec',dont_inherit=True),guard.__dict__)
    proof=guard.read_context(ROOT)
    body=read(SOURCE,INPUT,332242,PIN)
    value=json.loads(body)
    need(value['product']=='xjy-jewelry-offline' and value['programVersion']=='1.6.1' and value['fileCount']==1007,'Exact public manifest required')
    ns['absent'](TARGET,ROOT);ns['absent'](REPORT,RESULTS)
    put(TARGET,body,ROOT)
    need(read(SOURCE,INPUT,332242,PIN)==read(TARGET,ROOT,332242,PIN),'Source/target mismatch')
    read(Path(__file__),ROOT,expected_sha=args.source_sha256)
    report={'passed':True,'fileCount':1,'sha256':PIN,'actualGuest':proof,'sourceSha256':args.source_sha256,'databaseOpened':False,'programExecuted':False}
    put(REPORT,(json.dumps(report,indent=2)+'\n').encode('utf-8'),RESULTS)
    print(json.dumps(report))

if __name__=='__main__':main()
