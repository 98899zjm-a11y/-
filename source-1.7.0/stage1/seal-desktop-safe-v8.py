"""Seal a new desktop-only QA snapshot; never launch VM, business or EXE."""
from pathlib import Path
from datetime import datetime, timezone
import argparse
import base64
import hashlib
import importlib.util
import json
import re
import stat
import subprocess
import xml.etree.ElementTree as ET

ROOT=Path('E:/codex/2026-10-13/work/xjy-web-stage1')
PACKAGE=ROOT/'sandbox/input/package-v8'
HELPER=ROOT/'sandbox/input/guest-bootstrap-v8-desktop.ps1'
WSB=ROOT/'sandbox/desktop-verify-v8.wsb'
OUTPUT=ROOT/'sandbox/results/desktop-verify-v8'
PROOF=ROOT/'reports/desktop-verify-v8-preparation.json'
BASE_SEALER_SHA='1bd3eaee2edcf886a258644ae4bf90f50ad51ffabba9296d2a640cf354b07e7b'
BASE_MANIFEST_SHA='3ef63a1ebe59248e63b0e9189be75fa9f6831cb1bac0d0784675f5f0311b3672'
BASE_WSB_SHA='34ecfb323963634a90137731edb82c0804a5e0a2654575ad678319b490c0e04f'
CHANGED=frozenset({'stage1/sandbox-guest-candidate-driver.py','tests/sandbox_guest_driver_test.py'})
ADDED=frozenset({'stage1/guest-result-scope-aggregation.ps1','tests/guest_result_scope_aggregation_test.ps1','stage1/prepare-desktop-guest-helper.py','tests/desktop_guest_helper_test.py','stage1/seal-desktop-safe-v8.py','tests/seal_desktop_safe_v8_test.py'})
FROZEN={
 'stage1/sandbox-guest-candidate-driver.py':'245d3fe67dae64effbb1cb337b4036f3264bcd02ad4c09298ab47d1a94f6075c',
 'tests/sandbox_guest_driver_test.py':'858d3c51b6e349c09b6ae079403922ae2853a4bb61aa142caa1d728886ccfb0a',
 'stage1/guest-result-scope-aggregation.ps1':'93f0bfb9488abd7b6292d80d44b5d8d676c26e9c912097173d2e6e071466e56d',
}


def base_tools():
 file=ROOT/'stage1/seal-result-safe-v7.py'
 for entry in (file,*file.parents):
  info=entry.lstat()
  if stat.S_ISLNK(info.st_mode) or getattr(info,'st_file_attributes',0)&0x400 or stat.S_ISREG(info.st_mode) and info.st_nlink!=1:raise RuntimeError('Nonordinary frozen v7 sealing source')
  if entry==ROOT:break
 if hashlib.sha256(file.read_bytes()).hexdigest()!=BASE_SEALER_SHA:raise RuntimeError('Frozen v7 sealing primitive source changed')
 spec=importlib.util.spec_from_file_location('frozen_full_v7_sealing_primitives',file)
 tool=importlib.util.module_from_spec(spec);spec.loader.exec_module(tool)
 return tool


def validate_delta(previous,current,approved):
 base=base_tools();old=base.rows_of(previous);new=base.rows_of(current)
 if type(approved) is not dict or set(approved)!=CHANGED|ADDED:raise RuntimeError('Exactly two driver QA changes and six desktop scope tool additions required')
 for name,sha in FROZEN.items():
  if approved[name]!=sha:raise RuntimeError('Frozen desktop QA input SHA differs: '+name)
 if any(type(sha) is not str or not re.fullmatch('[a-f0-9]{64}',sha) for sha in approved.values()):raise RuntimeError('Invalid Root-approved delta digest')
 added=set(new)-set(old);removed=set(old)-set(new);changed={name for name in set(new)&set(old) if new[name]!=old[name]}
 if removed or changed!=CHANGED or added!=ADDED:raise RuntimeError('Unexpected/missing desktop-only QA delta: '+repr((added,removed,changed)))
 for name,sha in approved.items():
  if new[name]['sha256']!=sha:raise RuntimeError('Approved desktop delta row digest differs: '+name)
 for key in ('releaseInclusion','engineInclusion'):
  if previous.get(key)!=current.get(key):raise RuntimeError('Original business resources/engine inclusion metadata changed')
 if current['fileCount']!=previous['fileCount']+len(ADDED):raise RuntimeError('Unexpected desktop file count')
 return {'changed':sorted(changed),'added':sorted(added)}


def seal(approval):
 if not __debug__:raise RuntimeError('Assertions must remain enabled')
 base=base_tools();safe=base.load_v6_tools();ordinary=safe.ordinary;digest=safe.digest
 ordinary(approval)
 if not approval.is_relative_to(ROOT/'reports'):raise RuntimeError('Root approval must be an ordinary owned report')
 approved=json.loads(approval.read_text('utf-8-sig'))
 for path in (WSB,OUTPUT,PROOF):
  ordinary(path,missing=True)
  if path.exists():raise RuntimeError('Fresh desktop output already exists: '+str(path))
 previous_file=ROOT/'sandbox/input/package-v7/package-manifest.json'
 if digest(previous_file)!=BASE_MANIFEST_SHA:raise RuntimeError('Frozen full-v7 manifest changed')
 previous=json.loads(previous_file.read_text('utf-8-sig'));manifest_file=PACKAGE/'package-manifest.json';manifest_sha=digest(manifest_file)
 manifest=json.loads(manifest_file.read_text('utf-8-sig'));delta=validate_delta(previous,manifest,approved);old=base.rows_of(previous);rows=base.rows_of(manifest)
 for name,sha in approved.items():
  if digest(ROOT/name)!=sha:raise RuntimeError('Current desktop QA input changed: '+name)
 spec=importlib.util.spec_from_file_location('strict_desktop_package_source_plan',ROOT/'stage1/sandbox-package.py')
 pack=importlib.util.module_from_spec(spec);spec.loader.exec_module(pack)
 release=pack.plan_release_inclusion(ROOT,ROOT/'stage1/sandbox-release-inclusion.json');engine=pack.plan_engine_inclusion(ROOT)
 if manifest['releaseInclusion']!={key:value for key,value in release.items() if key!='files'} or manifest['engineInclusion']!={key:value for key,value in engine.items() if key!='files'}:raise RuntimeError('Current original resource/engine plan differs')
 origins={row['destination']:Path(row['source']) for row in release['files']+engine['files']};program=[];sections={}
 for row in manifest['files']:
  name=row['path'];file=PACKAGE/name
  if digest(file)!=row['sha256'] or file.stat().st_size!=row['size']:raise RuntimeError('Desktop copied file changed: '+name)
  if re.search(r'\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm|journal))?$',name,re.I):raise RuntimeError('Business database entered program-only input')
  section=name.split('/')[0];totals=sections.setdefault(section,{'files':0,'bytes':0});totals['files']+=1;totals['bytes']+=row['size']
  if section!='PythonRuntime':
   source=origins.get(name,ROOT/name)
   if digest(source)!=row['sha256'] or source.stat().st_size!=row['size']:raise RuntimeError('Current source differs from desktop copy: '+name)
   if name not in origins and any(part.casefold() in {'node_modules','data','config','cache','logs','runtime','backups','__pycache__'} for part in name.split('/')):raise RuntimeError('Unexpected runtime/data input source')
   program.append(row)
 actual=[]
 def walk(folder):
  ordinary(folder)
  for child in folder.iterdir():
   ordinary(child)
   if child.is_dir():walk(child)
   elif child.is_file():actual.append(child.relative_to(PACKAGE).as_posix())
   else:raise RuntimeError('Nonordinary desktop input object')
 walk(PACKAGE)
 if set(actual)!=set(rows)|{'package-manifest.json'}:raise RuntimeError('Extra or missing desktop snapshot file')
 for name in old:
  if name not in CHANGED and old[name]!=rows[name]:raise RuntimeError('Original full-v7 non-QA source changed: '+name)
 generator=ROOT/'stage1/prepare-desktop-guest-helper.py'
 spec=importlib.util.spec_from_file_location('sealed_desktop_helper_draft',generator)
 make=importlib.util.module_from_spec(spec);spec.loader.exec_module(make);source_safe=make.primitives()
 draft=make.build_draft(source_safe.stable_bytes(ROOT/'sandbox/input/guest-bootstrap-v7.ps1'),source_safe.stable_bytes(ROOT/'stage1/guest-result-scope-aggregation.ps1'))
 ordinary(HELPER)
 if not HELPER.read_bytes().startswith(b'\xef\xbb\xbf') or HELPER.read_text('utf-8-sig').replace('\r\n','\n')!=draft:raise RuntimeError('Desktop helper differs from exact approved transformation')
 parse="$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$t=$null;$e=$null;[void][Management.Automation.Language.Parser]::ParseFile('"+str(HELPER)+"',[ref]$t,[ref]$e);if(@($e).Count){$e|ForEach-Object {[Console]::Error.WriteLine($_.Message)};exit 1};[Console]::WriteLine('PowerShell 5.1 desktop helper parser: 0 errors')"
 parsed=subprocess.run(['C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe','-NoLogo','-NoProfile','-NonInteractive','-Command',parse],cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=30,creationflags=0x08000000)
 if parsed.returncode or parsed.stderr:raise RuntimeError('Pure desktop helper parser failed: '+parsed.stderr)
 helper=draft
 for token,value in [('__V8_DESKTOP_MANIFEST_SHA256__',manifest_sha),('__V8_DESKTOP_VERIFIER_SHA256__',rows['stage1/verify-all.ps1']['sha256'])]:
  if helper.count(token)!=1:raise RuntimeError('Desktop helper seal token missing/duplicated')
  helper=helper.replace(token,value)
 original_wsb=ROOT/'sandbox/full-verify-v7.wsb'
 if digest(original_wsb)!=BASE_WSB_SHA:raise RuntimeError('Frozen full-v7 WSB changed')
 config=ET.parse(original_wsb).getroot();loader="&([scriptblock]::Create([IO.File]::ReadAllText('C:\\xjy-input\\guest-bootstrap-v8-desktop.ps1',[Text.Encoding]::UTF8)))"
 command='powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand '+base64.b64encode(loader.encode('utf-16-le')).decode('ascii');config.find('./LogonCommand/Command').text=command
 if len(list(config))!=len({item.tag for item in config}):raise RuntimeError('Duplicate desktop WSB option')
 for name in ('vGPU','Networking','AudioInput','VideoInput','PrinterRedirection','ClipboardRedirection'):
  if config.findtext(name)!='Disable':raise RuntimeError('Unsafe desktop WSB option')
 if config.findtext('ProtectedClient')!='Enable' or config.findtext('MemoryInMB')!='4096':raise RuntimeError('Unexpected desktop client/memory policy')
 expected=[(str(ROOT/'sandbox/input'),'C:\\xjy-input','true'),(str(ROOT/'sandbox/results'),'C:\\xjy-results','false')]
 if [(row.findtext('HostFolder'),row.findtext('SandboxFolder'),row.findtext('ReadOnly')) for row in config.findall('./MappedFolders/MappedFolder')]!=expected:raise RuntimeError('Exactly two owned desktop WSB mappings required')
 for name,sha in approved.items():
  if digest(ROOT/name)!=sha:raise RuntimeError('Desktop QA source drifted before seal')
 if pack.plan_release_inclusion(ROOT,ROOT/'stage1/sandbox-release-inclusion.json')!=release or pack.plan_engine_inclusion(ROOT)!=engine:raise RuntimeError('Original resource/engine plan drifted before desktop seal')
 HELPER.write_text(helper,encoding='utf-8-sig',newline='\r\n')
 with WSB.open('xb') as stream:stream.write(ET.tostring(config,encoding='utf-8'))
 OUTPUT.mkdir();program.sort(key=lambda row:row['path']);program_seal=hashlib.sha256(('\n'.join(row['path']+'\0'+str(row['size'])+'\0'+row['sha256'] for row in program)+'\n').encode('utf-8')).hexdigest()
 proof={'version':1,'at':datetime.now(timezone.utc).isoformat(),'scope':'desktop','package':'package-v8','manifestSha256':manifest_sha,'baselinePackage':'package-v7','baselineManifestSha256':BASE_MANIFEST_SHA,'authorizedInputDeltaClosed':True,'allowedInputChanges':{name:{'before':old[name],'after':rows[name]} for name in delta['changed']},'allowedInputAdditions':[rows[name] for name in delta['added']],'fileCount':manifest['fileCount'],'totalBytes':manifest['totalBytes'],'programFileCount':len(program),'programSealSha256':program_seal,'sections':sections,'allPackageFilesAndCurrentSourcesMatch':True,'packageTreeHasNoExtraFiles':True,'allFilesPhysicalOrdinarySingleLinks':True,'originalBusinessResourcesEngineAndCompiledToolsUnchanged':True,'releaseInclusion':manifest['releaseInclusion'],'engineInclusion':manifest['engineInclusion'],'helper':str(HELPER),'helperSha256':digest(HELPER),'helperUtf8Bom':True,'wsb':str(WSB),'wsbSha256':digest(WSB),'strictWsbStaticCheckPassed':True,'purePowerShellParserExitCode':parsed.returncode,'purePowerShellParserStdout':parsed.stdout.strip(),'outputDirectory':str(OUTPUT),'expectedExecutableChecks':20,'expectedNotApplicableChecks':2,'expectedActuallyExecutedCandidateGroups':5,'expectedRecordedCandidateRows':6,'deferredCandidateGroups':['candidate-offline-fullmodules'],'actualGuestChecksExecuted':0,'actualCandidateChecksExecuted':0,'desktopAcceptancePassed':False,'fullAcceptancePassed':False,'hostBusinessStarted':False,'hostEngineStarted':False,'productionBusinessDataRead':False,'privateKeysRead':False,'persistentPolicyWillChange':False,'formalApproval':False}
 with PROOF.open('x',encoding='utf-8',newline='\n') as stream:json.dump(proof,stream,ensure_ascii=False,indent=2);stream.write('\n')
 print(json.dumps({key:proof[key] for key in ('package','scope','manifestSha256','programSealSha256','fileCount','totalBytes','helperSha256','wsbSha256','actualGuestChecksExecuted','desktopAcceptancePassed','fullAcceptancePassed')},ensure_ascii=False,indent=2))


if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--approved-delta',type=Path,required=True);seal(parser.parse_args().approved_delta)
