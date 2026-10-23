"""Create only a fresh unsealed desktop QA helper from exact full-v7 bytes."""
from pathlib import Path
import argparse
import hashlib
import importlib.util
import re

ROOT=Path('E:/codex/2026-10-13/work/xjy-web-stage1')
SOURCE=ROOT/'sandbox/input/guest-bootstrap-v7.ps1'
MODULE=ROOT/'stage1/guest-result-scope-aggregation.ps1'
SOURCE_SHA='47332ae0baab76de199e86ce0dd43c071ad6a9e1bcfecf9d5206841bc194c14f'
PRIMITIVE_SHA='0788b394d3ec57ad38b97ab419ba5acc957d6f8ae80240a3769513b09b8b1e33'


def once(text,old,new):
 if text.count(old)!=1:raise RuntimeError('Exact full-v7 transformation point absent: '+old[:120])
 return text.replace(old,new,1)


def build_draft(source_bytes,module_bytes):
 if hashlib.sha256(source_bytes).hexdigest()!=SOURCE_SHA or not source_bytes.startswith(b'\xef\xbb\xbf'):
  raise RuntimeError('Exact sealed full-v7 helper hash/BOM changed')
 module=module_bytes.decode('utf-8-sig').replace('\r\n','\n')
 if re.search(r'Get-Content|Set-Content|Start-Process|Set-ExecutionPolicy|Unblock-File|\[IO\.File|\.Kill\(',module,re.I):raise RuntimeError('Expected pure scope module; IO/process/policy text refused')
 for name in ('Get-GuestScopedCandidateResultSummary','Get-GuestScopedAcceptanceResultSummary'):
  if module.count('function '+name)!=1:raise RuntimeError('Expected pure scope API absent/duplicated')
 sha=hashlib.sha256(module_bytes).hexdigest();text=source_bytes.decode('utf-8-sig').replace('\r\n','\n')
 declarations=(module.rstrip()+"\n$guestProof.scope='desktop'\n$guestProof.expectedCandidateGroups=5\n$guestProof.expectedCandidateRecordedRows=6\n$guestProof.desktopAcceptancePassed=$false\n$guestProof.fullAcceptancePassed=$false\n$guestProof.candidateDeferredGroupNames=@('candidate-offline-fullmodules')\n$guestProof.candidateNotRunGroupNames=@('engine-capabilities','candidate-host-startup','candidate-fakehardware-worker','candidate-updater-toy-recovery','candidate-three-database-attachments-restore')\n$guestProof.scopeAggregatorSha256='"+sha+"'\n")
 text=once(text,'function Read-GuestPolicy([string]$Suffix){',declarations+'function Read-GuestPolicy([string]$Suffix){')
 text=once(text,"$guestSealedEntries=@('stage1/guest-result-aggregation.ps1',","$guestSealedEntries=@('stage1/guest-result-scope-aggregation.ps1','stage1/guest-result-aggregation.ps1',")
 anchor=" if($guestProof.verifiedEntryHashes['stage1/guest-result-aggregation.ps1'] -cne 'cb6d9cfd59899e9ec2527d3d42d4ab6e3684dbf5da6b77f7010fa8519f9c9b46'){throw 'Strict result aggregator source seal mismatch'}"
 text=once(text,anchor,anchor+"\n if($guestProof.verifiedEntryHashes['stage1/guest-result-scope-aggregation.ps1'] -cne '"+sha+"'){throw 'Closed desktop scope aggregator source seal mismatch'}")
 text=once(text,r"'-I -B -X utf8 stage1\sandbox-guest-candidate-driver.py' 1800000",r"'-I -B -X utf8 stage1\sandbox-guest-candidate-driver.py --desktop-only' 1800000")
 text=once(text,'Get-GuestCandidateResultSummary -Json $guestCandidateJson -Process $guestCandidate','Get-GuestScopedCandidateResultSummary -Scope desktop -Json $guestCandidateJson -Process $guestCandidate')
 text=once(text,'Get-GuestAcceptanceResultSummary -Baseline $guestBaselineSummary -Candidate $guestCandidateSummary','Get-GuestScopedAcceptanceResultSummary -Scope desktop -Baseline $guestBaselineSummary -Candidate $guestCandidateSummary')
 text=once(text,' $guestProof.candidateValidationErrors=$guestCandidateSummary.validationErrors',' $guestProof.candidateValidationErrors=$guestCandidateSummary.validationErrors\n $guestProof.candidateRecordedGroupNames=$guestCandidateSummary.recordedGroupNames\n $guestProof.candidateDeferredGroupNames=$guestCandidateSummary.deferredGroupNames')
 text=once(text,' $guestProof.candidateCompleted=$true'," $guestProof.desktopAcceptancePassed=$guestAcceptance.desktopAcceptancePassed\n $guestProof.fullAcceptancePassed=$false\n $guestProof.candidateCompleted=$true")
 text=once(text,'3ef63a1ebe59248e63b0e9189be75fa9f6831cb1bac0d0784675f5f0311b3672','__V8_DESKTOP_MANIFEST_SHA256__')
 text=once(text,'1963914ae74dccfe35a2998a7ba3bead849dc72bed5c518e06fff5b7d819b397','__V8_DESKTOP_VERIFIER_SHA256__')
 for old,new in (('package-v7','package-v8'),('full-verify-v7','desktop-verify-v8'),('Sealed v7','Sealed v8-desktop')):
  if old not in text:raise RuntimeError('Expected full-v7 snapshot label absent: '+old)
  text=text.replace(old,new)
 if any(token in text for token in ('package-v7','full-verify-v7','Sealed v7','Set-ExecutionPolicy','Unblock-File','.Kill()')):raise RuntimeError('Old label or persistent/forced process action in desktop helper')
 return text


def primitives():
 file=ROOT/'stage1/prepare-guest-result-helper.py'
 # Parent/target ordinary-path checks run before reading any primitive bytes.
 import stat
 for entry in (file,*file.parents):
  info=entry.lstat()
  if stat.S_ISLNK(info.st_mode) or getattr(info,'st_file_attributes',0)&0x400 or stat.S_ISREG(info.st_mode) and info.st_nlink!=1:raise RuntimeError('Nonordinary helper source primitive')
  if entry==ROOT:break
 if hashlib.sha256(file.read_bytes()).hexdigest()!=PRIMITIVE_SHA:raise RuntimeError('Frozen helper primitive changed')
 spec=importlib.util.spec_from_file_location('desktop_draft_source_primitives',file)
 tool=importlib.util.module_from_spec(spec);spec.loader.exec_module(tool)
 return tool


if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--scope-sha256',required=True);args=parser.parse_args()
 safe=primitives();output=ROOT/'sandbox/input/guest-bootstrap-v8-desktop.ps1';safe.ordinary(output,missing=True)
 if output.exists():raise RuntimeError('Fresh desktop helper destination already exists')
 module=safe.stable_bytes(MODULE)
 if not re.fullmatch('[a-f0-9]{64}',args.scope_sha256) or hashlib.sha256(module).hexdigest()!=args.scope_sha256:raise RuntimeError('Root-approved scope SHA required and must match')
 result=build_draft(safe.stable_bytes(SOURCE),module)
 with output.open('x',encoding='utf-8-sig',newline='\r\n') as stream:stream.write(result)
 print('Unsealed desktop-only helper created; no Guest/EXE/business launch: '+str(output))
