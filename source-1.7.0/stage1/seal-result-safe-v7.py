"""Seal only the explicit v6-to-v7 test-code delta; never launch a VM/EXE.

The original candidate resources, 72 engine files, six candidate runners and
compiled renderer/packaging tools must remain byte-for-byte identical to v6.
"""
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
PACKAGE=ROOT/'sandbox/input/package-v7'
HELPER=ROOT/'sandbox/input/guest-bootstrap-v7.ps1'
WSB=ROOT/'sandbox/full-verify-v7.wsb'
OUTPUT=ROOT/'sandbox/results/full-verify-v7'
PROOF=ROOT/'reports/full-verify-v7-preparation.json'
V6_MANIFEST_SHA='1b6c9843c7948c7c3a69516062769c5f810384871b21600069aaf5feab3d7fc9'
V6_WSB_SHA='3a10557214b3c3b7819437808059fe315ff247df7cd09d2b8a7b4643e354076a'
V6_SEALER_SHA='805a7759b5ac820069ab5924133cb38a2f38fa7be94a1b6de5f4de57a53de43c'
SUMMARY_SHA='cb6d9cfd59899e9ec2527d3d42d4ab6e3684dbf5da6b77f7010fa8519f9c9b46'
CHANGED={
 'stage1/io-guard.cjs':'28d25feb5340273806823d41e5e0bd95b5120086920711cc80101b85e6074f2c',
 'tests/employee-update-fixtures.cjs':'410ab2b44ed579d5b99c363811a0d5b8386fbfaeb465df0f7fd1260768a96470',
}
ADDED=frozenset({
 'tests/io-guard-ancestor-metadata.test.cjs',
 'tests/employee-update-fixture-clock.test.cjs',
 'stage1/guest-result-aggregation.ps1',
 'stage1/prepare-guest-result-helper.py',
 'tests/guest_result_aggregation_test.ps1',
 'tests/guest_result_helper_test.py',
 'stage1/seal-result-safe-v7.py',
 'tests/seal_result_safe_v7_test.py',
})
FROZEN_ADDITIONS={
 'tests/io-guard-ancestor-metadata.test.cjs':'89995f65335290caddef24324983588913d4b0f7c05cab770a0a6fba4d3e96f5',
 'tests/employee-update-fixture-clock.test.cjs':'67898dfd0979478444ba5412e73e0945d7c6771b94358a417dc0f279e35231ed',
 'stage1/guest-result-aggregation.ps1':SUMMARY_SHA,
}


def rows_of(manifest):
 if type(manifest) is not dict or manifest.get('version')!=1 or type(manifest.get('files')) is not list:
  raise RuntimeError('Exact manifest schema required')
 rows={};folded=set();total=0
 for row in manifest['files']:
  if type(row) is not dict or set(row)!={'path','size','sha256'}:
   raise RuntimeError('Exact manifest row schema required')
  name=row['path']
  if type(name) is not str or not re.fullmatch(r'(?:PythonRuntime|project|stage1|tests|release-candidate|delivery-tools)/[^\\:\x00-\x1f]+|isolation-identity\.json',name) or any(part in ('','.','..') for part in name.split('/')) or name.casefold() in folded:
   raise RuntimeError('Manifest path invalid/aliased/duplicated')
  if type(row['size']) is not int or row['size']<0 or type(row['sha256']) is not str or not re.fullmatch('[a-f0-9]{64}',row['sha256']):
   raise RuntimeError('Manifest row size/digest invalid')
  folded.add(name.casefold());rows[name]=row;total+=row['size']
 if type(manifest.get('fileCount')) is not int or manifest['fileCount']!=len(rows) or type(manifest.get('totalBytes')) is not int or manifest['totalBytes']!=total:
  raise RuntimeError('Manifest totals disagree')
 return rows


def validate_delta(previous,current,approved):
 old=rows_of(previous);new=rows_of(current)
 if type(approved) is not dict or set(approved)!=set(CHANGED)|ADDED:
  raise RuntimeError('Root approval must list the exact two changed plus eight added test-code inputs')
 for name,sha in {**CHANGED,**FROZEN_ADDITIONS}.items():
  if approved[name]!=sha:raise RuntimeError('Root frozen input SHA differs: '+name)
 if any(type(sha) is not str or not re.fullmatch('[a-f0-9]{64}',sha) for sha in approved.values()):
  raise RuntimeError('Root approved input SHA invalid')
 added=set(new)-set(old);removed=set(old)-set(new)
 changed={name for name in set(new)&set(old) if new[name]!=old[name]}
 if removed or added!=ADDED or changed!=set(CHANGED):
  raise RuntimeError('Unexpected/missing v7 manifest delta: '+repr((added,removed,changed)))
 for name,sha in approved.items():
  if new[name]['sha256']!=sha:raise RuntimeError('Approved delta row digest mismatch: '+name)
 for key in ('releaseInclusion','engineInclusion'):
  if current.get(key)!=previous.get(key):raise RuntimeError('Original candidate resource/engine inclusion metadata changed: '+key)
 if current['fileCount']!=previous['fileCount']+len(ADDED):raise RuntimeError('Unexpected file-count delta')
 return {'added':sorted(added),'changed':sorted(changed),'removed':[]}


def load_v6_tools():
 # Reuse only reviewed path/hash primitives; importing this code launches nothing.
 file=ROOT/'sandbox/input/seal-v6-helper.py'
 for entry in (file,*file.parents):
  info=entry.lstat()
  if stat.S_ISLNK(info.st_mode) or getattr(info,'st_file_attributes',0)&0x400 or stat.S_ISREG(info.st_mode) and info.st_nlink!=1:
   raise RuntimeError('Nonordinary frozen v6 path/hash tool source')
  if entry==ROOT:break
 body=file.read_bytes()
 if hashlib.sha256(body).hexdigest()!=V6_SEALER_SHA:raise RuntimeError('Frozen v6 path/hash tool source changed')
 spec=importlib.util.spec_from_file_location('reviewed_v6_sealing_primitives',file)
 module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 return module


def seal(approved_file):
 if not __debug__:raise RuntimeError('All verification assertions must remain enabled')
 safe=load_v6_tools();ordinary=safe.ordinary;digest=safe.digest
 ordinary(approved_file)
 if not approved_file.is_relative_to(ROOT/'reports'):raise RuntimeError('Root approval must be an ordinary owned report file')
 approved=json.loads(approved_file.read_text('utf-8-sig'))
 for path in (WSB,OUTPUT,PROOF):
  ordinary(path,missing=True)
  if path.exists():raise RuntimeError('Fresh v7 output already exists: '+str(path))
 baseline_file=ROOT/'sandbox/input/package-v6/package-manifest.json'
 if digest(baseline_file)!=V6_MANIFEST_SHA:raise RuntimeError('Frozen v6 manifest changed')
 baseline=json.loads(baseline_file.read_text('utf-8-sig'))
 manifest_file=PACKAGE/'package-manifest.json';manifest_sha=digest(manifest_file)
 manifest=json.loads(manifest_file.read_text('utf-8-sig'))
 delta=validate_delta(baseline,manifest,approved);old=rows_of(baseline);rows=rows_of(manifest)
 for name,sha in approved.items():
  if digest(ROOT/name)!=sha:raise RuntimeError('Current approved source changed: '+name)
 spec=importlib.util.spec_from_file_location('strict_v7_package_source_plan',ROOT/'stage1/sandbox-package.py')
 pack=importlib.util.module_from_spec(spec);spec.loader.exec_module(pack)
 release=pack.plan_release_inclusion(ROOT,ROOT/'stage1/sandbox-release-inclusion.json');engine=pack.plan_engine_inclusion(ROOT)
 if manifest['releaseInclusion']!={key:value for key,value in release.items() if key!='files'} or manifest['engineInclusion']!={key:value for key,value in engine.items() if key!='files'}:
  raise RuntimeError('Current original resource/engine source plan differs')
 origins={row['destination']:Path(row['source']) for row in release['files']+engine['files']}
 actual=[];sections={};program=[]
 for row in manifest['files']:
  name=row['path'];file=PACKAGE/name
  if digest(file)!=row['sha256'] or file.stat().st_size!=row['size']:raise RuntimeError('Copied v7 package file differs: '+name)
  if re.search(r'\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm|journal))?$',name,re.I):raise RuntimeError('Business database entered program-only input')
  section=name.split('/')[0];totals=sections.setdefault(section,{'files':0,'bytes':0});totals['files']+=1;totals['bytes']+=row['size']
  if section!='PythonRuntime':
   source=origins.get(name,ROOT/name)
   if digest(source)!=row['sha256'] or source.stat().st_size!=row['size']:raise RuntimeError('Current source differs from v7 package: '+name)
   if name not in origins and any(part.casefold() in {'node_modules','data','config','cache','logs','runtime','backups','__pycache__'} for part in name.split('/')):raise RuntimeError('Unexpected business/runtime input source: '+name)
   program.append(row)
 def walk(folder):
  ordinary(folder)
  for child in folder.iterdir():
   ordinary(child)
   if child.is_dir():walk(child)
   elif child.is_file():actual.append(child.relative_to(PACKAGE).as_posix())
   else:raise RuntimeError('Nonordinary v7 package object')
 walk(PACKAGE)
 if set(actual)!=set(rows)|{'package-manifest.json'}:raise RuntimeError('Extra or missing v7 package file')
 # All original files outside the two exact changed test inputs, including every
 # candidate runtime/engine/compiled tool byte, are already compared by delta.
 for name in old:
  if name not in CHANGED and rows[name]!=old[name]:raise RuntimeError('Original v6 input changed: '+name)
 generator=ROOT/'stage1/prepare-guest-result-helper.py'
 spec=importlib.util.spec_from_file_location('strict_v7_guest_helper_generator',generator)
 make=importlib.util.module_from_spec(spec);spec.loader.exec_module(make)
 original_helper=ROOT/'sandbox/input/guest-bootstrap-v6.ps1'
 expected_draft=make.build_draft(make.stable_bytes(original_helper),make.stable_bytes(ROOT/'stage1/guest-result-aggregation.ps1'))
 ordinary(HELPER)
 if not HELPER.read_bytes().startswith(b'\xef\xbb\xbf') or HELPER.read_text('utf-8-sig').replace('\r\n','\n')!=expected_draft:
  raise RuntimeError('Unsealed helper differs from exact approved pure transformation')
 # Parsing source is data-free and does not execute it or change any policy.
 parse="$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$tokens=$null;$errors=$null;[void][Management.Automation.Language.Parser]::ParseFile('"+str(HELPER)+"',[ref]$tokens,[ref]$errors);if(@($errors).Count){$errors|ForEach-Object {[Console]::Error.WriteLine($_.Message)};exit 1};[Console]::WriteLine('PowerShell 5.1 helper parser: 0 errors')"
 parsed=subprocess.run(['C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe','-NoLogo','-NoProfile','-NonInteractive','-Command',parse],cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=30,creationflags=0x08000000)
 if parsed.returncode or parsed.stderr:raise RuntimeError('Pure helper parser failed: '+parsed.stderr)
 helper=expected_draft
 for token,value in [('__V7_MANIFEST_SHA256__',manifest_sha),('__V7_VERIFIER_SHA256__',rows['stage1/verify-all.ps1']['sha256'])]:
  if helper.count(token)!=1:raise RuntimeError('Unsealed helper token absent/duplicated')
  helper=helper.replace(token,value)
 original_wsb=ROOT/'sandbox/full-verify-v6.wsb'
 if digest(original_wsb)!=V6_WSB_SHA:raise RuntimeError('Frozen v6 WSB changed')
 config=ET.parse(original_wsb).getroot()
 loader="&([scriptblock]::Create([IO.File]::ReadAllText('C:\\xjy-input\\guest-bootstrap-v7.ps1',[Text.Encoding]::UTF8)))"
 command='powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand '+base64.b64encode(loader.encode('utf-16-le')).decode('ascii')
 config.find('./LogonCommand/Command').text=command
 if len(list(config))!=len({item.tag for item in config}):raise RuntimeError('Duplicate WSB option')
 for name in ('vGPU','Networking','AudioInput','VideoInput','PrinterRedirection','ClipboardRedirection'):
  if config.findtext(name)!='Disable':raise RuntimeError('Unsafe WSB option: '+name)
 if config.findtext('ProtectedClient')!='Enable' or config.findtext('MemoryInMB')!='4096':raise RuntimeError('Unexpected WSB client/memory policy')
 expected_maps=[(str(ROOT/'sandbox/input'),'C:\\xjy-input','true'),(str(ROOT/'sandbox/results'),'C:\\xjy-results','false')]
 if [(item.findtext('HostFolder'),item.findtext('SandboxFolder'),item.findtext('ReadOnly')) for item in config.findall('./MappedFolders/MappedFolder')]!=expected_maps:raise RuntimeError('Exactly two owned WSB maps required')
 # Source drift fails before sealing, rather than blessing the stale snapshot.
 for name,sha in approved.items():
  if digest(ROOT/name)!=sha:raise RuntimeError('Approved source changed before seal')
 if pack.plan_release_inclusion(ROOT,ROOT/'stage1/sandbox-release-inclusion.json')!=release or pack.plan_engine_inclusion(ROOT)!=engine:raise RuntimeError('Original candidate plan changed before seal')
 HELPER.write_text(helper,encoding='utf-8-sig',newline='\r\n')
 with WSB.open('xb') as stream:stream.write(ET.tostring(config,encoding='utf-8'))
 OUTPUT.mkdir()
 program.sort(key=lambda row:row['path'])
 program_seal=hashlib.sha256(('\n'.join(row['path']+'\0'+str(row['size'])+'\0'+row['sha256'] for row in program)+'\n').encode('utf-8')).hexdigest()
 proof={'version':1,'at':datetime.now(timezone.utc).isoformat(),'package':'package-v7','manifestSha256':manifest_sha,'baselinePackage':'package-v6','baselineManifestSha256':V6_MANIFEST_SHA,'allowedInputChanges':{name:{'before':old[name],'after':rows[name]} for name in delta['changed']},'allowedInputAdditions':[rows[name] for name in delta['added']],'authorizedInputDeltaClosed':True,'fileCount':manifest['fileCount'],'totalBytes':manifest['totalBytes'],'programFileCount':len(program),'programSealSha256':program_seal,'sections':sections,'allPackageFilesAndCurrentSourcesMatch':True,'packageTreeHasNoExtraFiles':True,'allFilesPhysicalOrdinarySingleLinks':True,'originalCandidateResourcesEngineRunnersAndCompiledToolsUnchanged':True,'releaseInclusion':manifest['releaseInclusion'],'engineInclusion':manifest['engineInclusion'],'helper':str(HELPER),'helperSha256':digest(HELPER),'helperUtf8Bom':True,'purePowerShellParserExitCode':parsed.returncode,'purePowerShellParserStdout':parsed.stdout.strip(),'wsb':str(WSB),'wsbSha256':digest(WSB),'strictWsbStaticCheckPassed':True,'outputDirectory':str(OUTPUT),'expectedExecutableChecks':20,'expectedNotApplicableChecks':2,'candidateGroups':6,'actualGuestChecksExecuted':0,'actualCandidateChecksExecuted':0,'overallAcceptancePassed':False,'hostBusinessStarted':False,'hostEngineStarted':False,'productionBusinessDataRead':False,'privateKeysRead':False,'persistentPolicyWillChange':False,'formalApproval':False}
 with PROOF.open('x',encoding='utf-8',newline='\n') as stream:json.dump(proof,stream,ensure_ascii=False,indent=2);stream.write('\n')
 print(json.dumps({key:proof[key] for key in ('package','manifestSha256','programSealSha256','fileCount','totalBytes','helperSha256','wsbSha256','actualGuestChecksExecuted','overallAcceptancePassed')},ensure_ascii=False,indent=2))


if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--approved-delta',type=Path,required=True)
 seal(parser.parse_args().approved_delta)
