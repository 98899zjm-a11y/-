"""Fresh V9 input sealing source; running tests/importing it creates no snapshot.

Only Root may call seal after reviewing an exact before/after program delta.
This tool never starts a VM, business runtime, original EXE or compiled pyc.
"""
from pathlib import Path
from datetime import datetime, timezone
import argparse
import base64
import hashlib
from types import ModuleType
import json
import os
import re
import stat
import subprocess
import xml.etree.ElementTree as ET

ROOT=Path('E:/codex/2026-10-13/work/xjy-web-stage1')
PACKAGE=ROOT/'sandbox/input/package-v10'
HELPER=ROOT/'sandbox/input/guest-bootstrap-v10-desktop.ps1'
WSB=ROOT/'sandbox/desktop-verify-v10.wsb'
OUTPUT=ROOT/'sandbox/results/desktop-verify-v10'
PROOF=ROOT/'reports/desktop-verify-v10-preparation.json'
BASE_MANIFEST_SHA='f59b67e35f5ded71686c810a516d7e72a367aaf730d45af5341eea7d07f6bde8'
BASE_HELPER_SHA='85d25e621542685d55dbf65a53f15140940bd415ad5f30d376f9f4121831dbc3'
BASE_WSB_SHA='2083316b4f9a1715e4e6543d47cf6ecba8ff87b16ae61ebc0b515bbe4aeb233a'
V7_RESOURCE_SHA='c82426dc5463f2b5f0b366dd7c7e0ac09ec9d542bc9b81866997ecbc0cf9efd9'
V7_ROOT='release/资源补丁-1.6.0-v7'
V7_MANIFEST='release-work/full-f1d38862-eeac-4c73-ae48-6b8e2e2e877f/release-manifest.json'
REVIEWER_FILES=frozenset('delivery-approval/'+name for name in (
    'Prepare-Initial-Approval.ps1','approval-core.cjs','approval-archive.cjs',
    'approval-io.cjs','负责人首次审定.cmd','README.md'))
QA_VENDOR_FILES=frozenset({'stage1/test-tools/renderer-build-dependencies.blob',
                           'stage1/test-tools/renderer-build-tool-manifest.json'})
REQUIRED_FILES=REVIEWER_FILES|QA_VENDOR_FILES|frozenset({
    'stage1/sandbox-package.py','stage1/sandbox-release-inclusion.py','stage1/sandbox-engine-inclusion.py',
    'tests/delivery-approval.test.cjs','tests/delivery-approval-archive.test.cjs',
    'tests/delivery-approval-ps-paths.test.ps1','tests/delivery-approval-ps-acl.test.ps1',
    'tests/renderer-build-resolution.test.cjs','stage1/prepare-desktop-v9-helper.py',
    'stage1/seal-desktop-safe-v9.py','stage1/seal-desktop-safe-v10.py','stage1/candidate-delivery-approval-pure-ps-tests.ps1'})
FIXED_INPUTS={
    'stage1/io-guard.cjs':'28d25feb5340273806823d41e5e0bd95b5120086920711cc80101b85e6074f2c',
    'project/desktop/legacy-modules/manifest.json':'5f0e8d919c541ac07d305544bb1c7036e7cb4ced8c5c4ee8cf262c927bc373d2',
    'project/desktop/legacy-modules/xjy-ledger/xjy-ledger.exe':'214843e59dcb107b45e508542227311c8a2aaa62c8839df992795d5a78b9e191',
    'project/desktop/legacy-modules/xjy-ledger/_internal/base_library.zip':'af7f4a10a2c7777ef0830ce0323c92034596a7d31d81a0f429f078a67bd27e3c',
    'delivery-tools/Initial-Full-Upgrade.ps1':'a7ce0ccf4bd539aef002d5f18823a37cab73d44ea8553bbdd457d24019d4d651',
    'release-candidate/release-manifest.json':V7_RESOURCE_SHA}
DENIED_PARTS=frozenset({'data','config','configs','profiles','profile','cache','logs','backups','private','uploads','attachments','erp-attachments','__pycache__','node_modules'})
SHA=re.compile('[a-f0-9]{64}')


def _fail(message):raise RuntimeError('V9 PROGRAM SEAL: '+message)


def _valid_name(name):
    if type(name) is not str or not name or re.search(r'[\\:\x00-\x1f]',name) or any(p in ('','.','..') or p.endswith((' ','.')) for p in name.split('/')):return False
    if name.startswith('delivery-approval/'):return name in REVIEWER_FILES
    if not (name=='isolation-identity.json' or name.split('/')[0] in {'project','stage1','tests','PythonRuntime','release-candidate','delivery-tools'}):return False
    denied=DENIED_PARTS
    # These are code directories already sealed in V8. Python's complete
    # membership/hashes stay immutable; print dependencies stay bound to the
    # exact Root-sealed resource manifest and current source plan below.
    if name.startswith('PythonRuntime/Lib/site-packages/setuptools/config/'):denied=denied-{'config'}
    if name.startswith('release-candidate/resources/print-dependencies/node_modules/'):denied=denied-{'node_modules'}
    if any(p.casefold() in denied for p in name.split('/')):return False
    if re.search(r'\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm|journal))?$',name,re.I):return False
    if name.split('/')[-1].casefold() in {'initial-upgrade-approval.json','xjy-install-activation.json'}:return False
    return True


def rows_of(manifest):
    if type(manifest) is not dict or type(manifest.get('version')) is not int or manifest['version']!=1 or type(manifest.get('files')) is not list:_fail('exact manifest schema required')
    rows={};folded=set();total=0
    for row in manifest['files']:
        if type(row) is not dict or set(row)!={'path','size','sha256'} or not _valid_name(row.get('path')):_fail('manifest row path/schema refused')
        name=row['path']
        if name.casefold() in folded or type(row['size']) is not int or row['size']<0 or type(row['sha256']) is not str or not SHA.fullmatch(row['sha256']):_fail('manifest alias/size/hash refused')
        folded.add(name.casefold());rows[name]=dict(row);total+=row['size']
    if type(manifest.get('fileCount')) is not int or manifest['fileCount']!=len(rows) or type(manifest.get('totalBytes')) is not int or manifest['totalBytes']!=total:_fail('manifest totals disagree')
    return rows


def describe_delta(previous,current):
    """Return an explicitly unapproved exact draft; confers no sealing authority."""
    old=rows_of(previous);new=rows_of(current)
    if set(old)-set(new):_fail('removed original input rows are not allowed')
    return {'version':1,'purpose':'xjy-v9-program-input-delta','approved':False,
            'baselineManifestSha256':BASE_MANIFEST_SHA,'resourceManifestSha256':V7_RESOURCE_SHA,
            'changed':{n:{'before':old[n],'after':new[n]} for n in sorted(set(old)&set(new)) if old[n]!=new[n]},
            'added':{n:new[n] for n in sorted(set(new)-set(old))}}


def _original_pyc(name):
    return name.startswith('project/desktop/legacy-source/') and '/pdf_vendor/' not in name and name.endswith('.pyc')


def _engine_member(name):
    return name.startswith('release-candidate/') and not name.startswith('release-candidate/resources/') and name!='release-candidate/release-manifest.json'


def validate_delta(previous,current,approved):
    old=rows_of(previous);new=rows_of(current);draft=describe_delta(previous,current)
    if type(approved) is not dict or set(approved)!=set(draft) or approved.get('approved') is not True:_fail('Root must explicitly approve the complete exact delta')
    expected={**draft,'approved':True}
    if approved!=expected:_fail('Root review has incomplete/extra before-after rows or wrong baseline/resource pin')
    for label,member in (('Python runtime',lambda n:n.startswith('PythonRuntime/')),('Node runtime',lambda n:n.startswith('stage1/tools/')),('original engine',_engine_member)):
        if {n for n in old if member(n)}!={n for n in new if member(n)}:_fail('immutable '+label+' closure membership changed')
    for name,row in old.items():
        immutable=name.startswith('PythonRuntime/') or name.startswith('stage1/tools/') or _original_pyc(name) or _engine_member(name)
        if immutable and new[name]!=row:_fail('immutable original engine/runtime/pyc input changed: '+name)
    original={n for n in old if _original_pyc(n)}
    if len(original)!=34 or {n for n in new if _original_pyc(n)}!=original:_fail('exact 34 original business pyc rows must remain unchanged')
    if not REQUIRED_FILES.issubset(new):_fail('required independent reviewer/tests/V9 programs missing')
    if any(name.startswith('stage1/test-tools/') and name not in QA_VENDOR_FILES for name in draft['added']):_fail('only two exact new semantic vendor test-tool inputs are allowed')
    if any(name.startswith('delivery-tools/') for name in draft['added']):_fail('original native delivery-tool closure cannot expand')
    for name,pin in FIXED_INPUTS.items():
        if new.get(name,{}).get('sha256')!=pin:_fail('fixed Stage repair/source pin differs: '+name)
    engine=current.get('engineInclusion',{});before=previous.get('engineInclusion',{})
    for field in ('sourceRoot','manifestRelative','manifestSha256','executableName','executableSha256','engineFileCount','engineBytes'):
        if field not in engine or engine[field]!=before.get(field):_fail('original engine inclusion binding changed: '+field)
    if engine.get('engineFileCount')!=72 or engine.get('engineBytes')!=385404497 or engine.get('nativeProgramToolCount')!=14 or engine.get('engineExecuted') is not False or engine.get('capabilitiesVerified') is not False:_fail('exact unchanged 72-file engine and 14 program tools required')
    resource=current.get('releaseInclusion',{})
    if resource.get('sourceRoot')!=V7_ROOT or resource.get('releaseManifestSha256')!=V7_RESOURCE_SHA or resource.get('resourceFileCount')!=1007:_fail('Root-sealed complete V7 resource inclusion required')
    return {'changed':sorted(draft['changed']),'added':sorted(draft['added']),'removed':[],
            'preservedOriginalBusinessPycCount':34,'originalEngineAndPythonRuntimeUnchanged':True}


def validate_qa_approval(record,rows):
    expected={'purpose':'Root reviewed QA-only compiler closure','approved':True,
              'packages':80,'files':7234,'programBytes':88240285,'allFramesVerified':True,
              'noBusinessDataIncluded':True,'enteredProductRelease':False,'vendorEntryExecuted':False,
              'previous7225FilesUnchanged':True,'approvedAddedPeer':{'name':'react-is','version':'16.13.1','files':9,'bytes':23954},
              'react19FragmentCompatibilityFullyVerified':False}
    if type(record) is not dict or set(record)!=set(expected)|{'manifestSha256','blobSha256'} or any(type(record[k]) is not type(v) or record[k]!=v for k,v in expected.items()):_fail('independent Root QA closure approval differs or was not completed before vendor execution')
    for name,field in (('stage1/test-tools/renderer-build-tool-manifest.json','manifestSha256'),('stage1/test-tools/renderer-build-dependencies.blob','blobSha256')):
        if type(record[field]) is not str or not SHA.fullmatch(record[field]) or rows.get(name,{}).get('sha256')!=record[field]:_fail('Root approved QA artifact hash differs from final package row')
    return True


def ordinary(file,*,missing=False):
    file=Path(file)
    if not file.is_absolute() or not file.is_relative_to(ROOT) or any(p in ('.','..') or p.endswith((' ','.')) for p in file.parts[1:]):_fail('path outside fixed owned root or ambiguous')
    for p in (file,*file.parents):
        try:info=p.lstat()
        except FileNotFoundError:
            if p==file and missing:continue
            raise
        if stat.S_ISLNK(info.st_mode) or getattr(info,'st_file_attributes',0)&0x400 or stat.S_ISREG(info.st_mode) and info.st_nlink!=1:_fail('link/reparse/hardlink refused')
        if p!=file and not stat.S_ISDIR(info.st_mode):_fail('non-directory ancestor')
        if p==ROOT:return file
    _fail('physical owned root ancestry missing')


def stable(file):
    file=ordinary(file);before=file.stat();body=file.read_bytes();after=file.stat()
    key=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_nlink)
    if key(before)!=key(after):_fail('source changed while reading')
    return body


def digest(file):return hashlib.sha256(stable(file)).hexdigest()


def _approved_source_bytes(file,row):
    file=Path(file)
    if type(row) is not dict or set(row)!={'path','size','sha256'} or row.get('path')!=file.relative_to(ROOT).as_posix() or type(row.get('size')) is not int or type(row.get('sha256')) is not str or not SHA.fullmatch(row['sha256']):_fail('approved source row missing/invalid before import')
    body=stable(file)
    if len(body)!=row['size'] or hashlib.sha256(body).hexdigest()!=row['sha256']:_fail('approved source size/hash mismatch before import: '+row['path'])
    return body


def _execute_source(name,file,body):
    module=ModuleType(name);module.__file__=str(file);module.__package__=''
    exec(compile(body,str(file),'exec'),module.__dict__)
    return module


def load_verified_source(name,file,row):
    """Execute precisely the approved stable bytes, never reopen a source path."""
    return _execute_source(name,file,_approved_source_bytes(file,row))


def load_verified_packaging(rows):
    files={'pack':'stage1/sandbox-package.py','release':'stage1/sandbox-release-inclusion.py','engine':'stage1/sandbox-engine-inclusion.py'}
    # Verify the complete local-code import closure before executing any of it.
    bodies={role:_approved_source_bytes(ROOT/name,rows.get(name)) for role,name in files.items()}
    modules={role:_execute_source('root_v9_verified_'+role,ROOT/files[role],body) for role,body in bodies.items()}
    pack=modules['pack'];pack._release_helper=lambda:modules['release'];pack._engine_helper=lambda:modules['engine']
    return pack


def seal(approval):
    """Root-only final action. Does not build an input package or start a VM."""
    if not __debug__:_fail('assertions must remain enabled')
    approval=ordinary(approval)
    if not approval.is_relative_to(ROOT/'reports'):_fail('Root-reviewed delta must be an ordinary reports file')
    for file in (HELPER,WSB,OUTPUT,PROOF):
        ordinary(file,missing=True)
        if file.exists():_fail('fresh V9 output already exists: '+str(file))
    baseline_file=ROOT/'sandbox/input/package-v8/package-manifest.json'
    if digest(baseline_file)!=BASE_MANIFEST_SHA:_fail('immutable V8 baseline manifest changed')
    previous=json.loads(stable(baseline_file).decode('utf-8-sig'));manifest_file=PACKAGE/'package-manifest.json'
    manifest_bytes=stable(manifest_file);manifest_sha=hashlib.sha256(manifest_bytes).hexdigest();manifest=json.loads(manifest_bytes.decode('utf-8-sig'))
    approved_bytes=stable(approval);approved=json.loads(approved_bytes.decode('utf-8-sig'));delta=validate_delta(previous,manifest,approved);rows=rows_of(manifest)
    qa_approval_file=ROOT/'reports/root-approved-renderer-qa-closure.json';qa_approval_bytes=stable(qa_approval_file)
    qa_approval=json.loads(qa_approval_bytes.decode('utf-8-sig'));validate_qa_approval(qa_approval,rows)
    pack=load_verified_packaging(rows)
    descriptor=ROOT/'stage1/sandbox-release-inclusion.json';desc=json.loads(stable(descriptor).decode('utf-8-sig'))
    if desc.get('sourceRoot')!=V7_ROOT or desc.get('releaseManifest')!=V7_MANIFEST or desc.get('releaseManifestSha256')!=V7_RESOURCE_SHA:_fail('final Root V7 descriptor differs')
    release=pack.plan_release_inclusion(ROOT,descriptor);engine=pack.plan_engine_inclusion(ROOT)
    if manifest.get('releaseInclusion')!={k:v for k,v in release.items() if k!='files'} or manifest.get('engineInclusion')!={k:v for k,v in engine.items() if k!='files'}:_fail('package inclusion metadata differs from current exact source plans')
    origins={r['destination']:Path(r['source']) for r in release['files']+engine['files']}
    if len(origins)!=len(release['files'])+len(engine['files']):_fail('duplicate resource/engine origin destination')
    actual=[];program=[];sections={}
    for name,row in rows.items():
        file=PACKAGE/name
        if digest(file)!=row['sha256'] or file.stat().st_size!=row['size']:_fail('copied V9 package size/hash mismatch: '+name)
        section=name.split('/')[0];counts=sections.setdefault(section,{'files':0,'bytes':0});counts['files']+=1;counts['bytes']+=row['size']
        if section!='PythonRuntime':
            source=origins.get(name,ROOT/name)
            if digest(source)!=row['sha256'] or source.stat().st_size!=row['size']:_fail('current program source differs from V9 package: '+name)
            program.append(row)
    def walk(folder):
        ordinary(folder)
        for child in folder.iterdir():
            ordinary(child)
            if child.is_dir():walk(child)
            elif child.is_file():actual.append(child.relative_to(PACKAGE).as_posix())
            else:_fail('nonordinary package object')
    walk(PACKAGE)
    if set(actual)!=set(rows)|{'package-manifest.json'}:_fail('V9 package contains extra/missing files')
    helper_tool=load_verified_source('root_v9_helper_transform',ROOT/'stage1/prepare-desktop-v9-helper.py',rows.get('stage1/prepare-desktop-v9-helper.py'))
    source=ROOT/'sandbox/input/guest-bootstrap-v8-desktop.ps1'
    if digest(source)!=BASE_HELPER_SHA:_fail('immutable V8 helper changed')
    helper=helper_tool.build_draft(stable(source))
    helper=helper.replace('package-v9','package-v10').replace('desktop-verify-v9','desktop-verify-v10').replace('Sealed v9-desktop','Sealed v10-desktop')
    for token,value in (('__V9_MANIFEST_SHA256__',manifest_sha),('__V9_VERIFIER_SHA256__',rows['stage1/verify-all.ps1']['sha256'])):
        if helper.count(token)!=1:_fail('fresh V9 helper token missing or repeated')
        helper=helper.replace(token,value)
    if re.search(r'__V9_[A-Z_]+__',helper):_fail('unsealed V9 helper token remains')
    # AST parsing is the only process launched by this sealer. It does not run
    # the helper, Add-Type, native code, ACLs, business or compiled bytecode.
    parse="$ErrorActionPreference='Stop';[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$t=$null;$e=$null;$s=[Console]::In.ReadToEnd();[void][Management.Automation.Language.Parser]::ParseInput($s,[ref]$t,[ref]$e);if(@($e).Count){$e|ForEach-Object{[Console]::Error.WriteLine($_.Message)};exit 1};[Console]::WriteLine('V9 helper AST: 0 errors')"
    parsed=subprocess.run(['C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe','-NoLogo','-NoProfile','-NonInteractive','-Command',parse],input=helper,cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=30,creationflags=0x08000000)
    if parsed.returncode or parsed.stderr:_fail('V9 helper pure parser failed: '+parsed.stderr)
    base_wsb=ROOT/'sandbox/desktop-verify-v8.wsb'
    if digest(base_wsb)!=BASE_WSB_SHA:_fail('immutable V8 WSB source changed')
    config=ET.fromstring(stable(base_wsb))
    for name in ('vGPU','Networking','AudioInput','VideoInput','PrinterRedirection','ClipboardRedirection'):
        if config.findtext(name)!='Disable':_fail('unsafe original WSB option')
    expected_tags={'vGPU','Networking','AudioInput','VideoInput','PrinterRedirection','ClipboardRedirection','ProtectedClient','MemoryInMB','MappedFolders','LogonCommand'}
    if len(list(config))!=len(expected_tags) or {r.tag for r in config}!=expected_tags or config.findtext('ProtectedClient')!='Enable' or config.findtext('MemoryInMB')!='4096':_fail('WSB fixed option policy differs')
    expected_maps=[(str(ROOT/'sandbox/input'),'C:\\xjy-input','true'),(str(ROOT/'sandbox/results'),'C:\\xjy-results','false')]
    if [(r.findtext('HostFolder'),r.findtext('SandboxFolder'),r.findtext('ReadOnly')) for r in config.findall('./MappedFolders/MappedFolder')]!=expected_maps:_fail('exact original two WSB mappings required')
    loader="&([scriptblock]::Create([IO.File]::ReadAllText('C:\\xjy-input\\guest-bootstrap-v10-desktop.ps1',[Text.Encoding]::UTF8)))"
    config.find('./LogonCommand/Command').text='powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand '+base64.b64encode(loader.encode('utf-16-le')).decode('ascii')
    # Recheck immutable snapshots, approval and every current program source
    # before the first fresh output write; stale/mixed snapshots are refused.
    if digest(baseline_file)!=BASE_MANIFEST_SHA or digest(source)!=BASE_HELPER_SHA or digest(base_wsb)!=BASE_WSB_SHA or stable(approval)!=approved_bytes or stable(qa_approval_file)!=qa_approval_bytes or stable(manifest_file)!=manifest_bytes:_fail('sealing inputs changed before commit')
    if pack.plan_release_inclusion(ROOT,descriptor)!=release or pack.plan_engine_inclusion(ROOT)!=engine:_fail('exact inclusion plans changed before commit')
    for row in program:
        src=origins.get(row['path'],ROOT/row['path'])
        if digest(src)!=row['sha256']:_fail('program source drift before commit: '+row['path'])
    for file in (HELPER,WSB,OUTPUT,PROOF):
        ordinary(file,missing=True)
        if file.exists():_fail('V9 fresh output appeared during preflight')
    with HELPER.open('x',encoding='utf-8-sig',newline='\r\n') as stream:stream.write(helper);stream.flush();os.fsync(stream.fileno())
    with WSB.open('xb') as stream:stream.write(ET.tostring(config,encoding='utf-8'));stream.flush();os.fsync(stream.fileno())
    OUTPUT.mkdir();program.sort(key=lambda r:r['path'])
    program_seal=hashlib.sha256(('\n'.join(r['path']+'\0'+str(r['size'])+'\0'+r['sha256'] for r in program)+'\n').encode()).hexdigest()
    proof={'version':1,'at':datetime.now(timezone.utc).isoformat(),'scope':'desktop','package':'package-v10',
           'baselinePackage':'package-v8','baselineManifestSha256':BASE_MANIFEST_SHA,'manifestSha256':manifest_sha,
           'authorizedInputDeltaClosed':True,'allowedInputChanges':approved['changed'],'allowedInputAdditions':approved['added'],
           **delta,'fileCount':manifest['fileCount'],'totalBytes':manifest['totalBytes'],'programFileCount':len(program),
           'programSealSha256':program_seal,'sections':sections,'allPackageFilesAndCurrentSourcesMatch':True,
           'packageTreeHasNoExtraFiles':True,'releaseInclusion':manifest['releaseInclusion'],'engineInclusion':manifest['engineInclusion'],
           'qaClosureApprovalFile':str(qa_approval_file),'qaClosureApprovalSha256':hashlib.sha256(qa_approval_bytes).hexdigest(),
           'qaManifestSha256':qa_approval['manifestSha256'],'qaBlobSha256':qa_approval['blobSha256'],'qaSemanticTestExecutedBySealer':False,
           'helper':str(HELPER),'helperSha256':digest(HELPER),'helperUtf8Bom':True,'wsb':str(WSB),'wsbSha256':digest(WSB),
           'strictWsbStaticCheckPassed':True,'purePowerShellParserExitCode':parsed.returncode,'expectedExecutableChecks':20,
           'expectedNotApplicableChecks':2,'expectedActuallyExecutedCandidateGroups':5,'expectedRecordedCandidateRows':6,
           'deferredCandidateGroups':['candidate-offline-fullmodules'],'actualGuestChecksExecuted':0,
           'actualCandidateChecksExecuted':0,'desktopAcceptancePassed':False,'fullAcceptancePassed':False,
           'hostBusinessStarted':False,'hostEngineStarted':False,'productionBusinessDataRead':False,'formalApproval':False}
    with PROOF.open('x',encoding='utf-8',newline='\n') as stream:json.dump(proof,stream,ensure_ascii=False,indent=2);stream.write('\n');stream.flush();os.fsync(stream.fileno())
    return proof


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--approved-delta',type=Path,required=True)
    report=seal(parser.parse_args().approved_delta)
    print(json.dumps({k:report[k] for k in ('package','manifestSha256','programSealSha256','helperSha256','wsbSha256','actualGuestChecksExecuted','desktopAcceptancePassed')},ensure_ascii=False,indent=2))
