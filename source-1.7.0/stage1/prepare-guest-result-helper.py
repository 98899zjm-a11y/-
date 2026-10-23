"""Build an unsealed v7 bootstrap from exact, immutable v6 source.

Only source text is transformed. This tool never launches a VM, service,
business module or EXE. Root must separately seal both remaining SHA256 tokens.
"""
from pathlib import Path
import argparse
import hashlib
import re
import stat

ROOT = Path('E:/codex/2026-10-13/work/xjy-web-stage1')
SOURCE = ROOT / 'sandbox/input/guest-bootstrap-v6.ps1'
MODULE = ROOT / 'stage1/guest-result-aggregation.ps1'
SOURCE_SHA = '84025d7a82b265bf34cb85ccdb432222567d64d05a601818689193b9867d728c'

BASELINE_BLOCK = r""" $guestBaselineJson=''
 if(Test-Path -LiteralPath $guestResultFile){
  Assert-GuestOrdinaryPath $guestResultFile $guestWork
  Copy-Item -LiteralPath $guestResultFile -Destination (Join-Path $guestOutput 'guest-final-test-results.json')
  $guestBaselineJson=[IO.File]::ReadAllText($guestResultFile,[Text.Encoding]::UTF8)
 }
 $guestBaselineSummary=Get-GuestBaselineResultSummary -Json $guestBaselineJson -Process $guestSuite -CheckLog {
  param($guestLogPath)
  Assert-GuestOrdinaryPath $guestLogPath $guestWork
  return [bool](Test-Path -LiteralPath $guestLogPath -PathType Leaf)
 }
 foreach($guestSummaryKey in @('recordedChecks','passedChecks','failedChecks','notApplicableChecks','actualExecutedChecks','recordedCheckNames','failedCheckNames','notRunCheckNames')){$guestProof[$guestSummaryKey]=$guestBaselineSummary.$guestSummaryKey}
 $guestProof.baselineValidationErrors=$guestBaselineSummary.validationErrors
 if(-not $guestBaselineSummary.passed){throw 'Guest regression incomplete or failed; strict counts, real exit code and full streams preserved'}
"""

CANDIDATE_BLOCK = r""" $guestCandidateJson=''
 if(Test-Path -LiteralPath $guestCandidateFile){
  Assert-GuestOrdinaryPath $guestCandidateFile $guestWork
  $guestCandidateJson=[IO.File]::ReadAllText($guestCandidateFile,[Text.Encoding]::UTF8)
 }
 $guestCandidateSummary=Get-GuestCandidateResultSummary -Json $guestCandidateJson -Process $guestCandidate
 foreach($guestSummaryKey in @('candidateGroupsExecuted','candidateGroupsPassed','candidateGroupNames')){$guestProof[$guestSummaryKey]=$guestCandidateSummary.$guestSummaryKey}
 $guestProof.candidateNotRunGroupNames=$guestCandidateSummary.notRunGroupNames
 $guestProof.candidateFailedGroupNames=$guestCandidateSummary.failedGroupNames
 $guestProof.candidateValidationErrors=$guestCandidateSummary.validationErrors
 $guestProof.defaultHostNormalShutdown=$guestCandidateSummary.normalDefaultHostShutdown
 $guestAcceptance=Get-GuestAcceptanceResultSummary -Baseline $guestBaselineSummary -Candidate $guestCandidateSummary
 if(-not $guestAcceptance.passed){throw 'Candidate regression incomplete or failed; all exact groups, real exits and normal shutdown are required'}
"""


def _replace_once(text, old, new):
    if text.count(old) != 1:
        raise RuntimeError('Exact sealed v6 transformation point absent: ' + old[:100])
    return text.replace(old, new, 1)


def _replace_block(text, start, end, replacement):
    if text.count(start) != 1 or text.count(end) != 1:
        raise RuntimeError('Exact sealed v6 result-block boundaries absent')
    begin = text.index(start)
    finish = text.index(end, begin)
    if finish <= begin:
        raise RuntimeError('Sealed result-block boundary order invalid')
    return text[:begin] + replacement + text[finish:]


def build_draft(source_bytes, module_bytes):
    if hashlib.sha256(source_bytes).hexdigest() != SOURCE_SHA or not source_bytes.startswith(b'\xef\xbb\xbf'):
        raise RuntimeError('Exact sealed v6 source hash/BOM changed')
    module_text = module_bytes.decode('utf-8-sig').replace('\r\n', '\n')
    # Static tripwires supplement (not replace) Root's exact approved module SHA.
    if re.search(r'Get-Content|Set-Content|Start-Process|Set-ExecutionPolicy|Unblock-File|\[IO\.File|\.Kill\(', module_text, re.I):
        raise RuntimeError('Expected pure aggregation module; IO/process/policy text refused')
    for function in ('Get-GuestBaselineResultSummary', 'Get-GuestCandidateResultSummary', 'Get-GuestAcceptanceResultSummary'):
        if module_text.count('function ' + function) != 1:
            raise RuntimeError('Expected pure aggregation API absent or duplicated')
    module_sha = hashlib.sha256(module_bytes).hexdigest()
    text = source_bytes.decode('utf-8-sig').replace('\r\n', '\n')
    text = _replace_once(text, 'function Read-GuestPolicy([string]$Suffix){',
        module_text.rstrip() + "\n$guestProof.resultAggregatorSha256='" + module_sha + "'\n"
        + "$guestProof.candidateNotRunGroupNames=@('engine-capabilities','candidate-host-startup','candidate-offline-fullmodules','candidate-fakehardware-worker','candidate-updater-toy-recovery','candidate-three-database-attachments-restore')\n"
        + 'function Read-GuestPolicy([string]$Suffix){')
    text = _replace_block(text, ' if(Test-Path -LiteralPath $guestResultFile){\n', ' $guestProof.suiteCompleted=$true\n', BASELINE_BLOCK)
    text = _replace_block(text, ' if(Test-Path -LiteralPath $guestCandidateFile){\n', ' $guestProof.candidateCompleted=$true\n', CANDIDATE_BLOCK)
    text = _replace_once(text, "$guestSealedEntries=@('stage1/verify-all.ps1',", "$guestSealedEntries=@('stage1/guest-result-aggregation.ps1','stage1/verify-all.ps1',")
    anchor = " if($guestProof.verifiedEntryHashes['stage1/sandbox-context.py'] -ne '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249'){throw 'Original context guard unexpectedly changed'}"
    text = _replace_once(text, anchor, anchor + "\n if($guestProof.verifiedEntryHashes['stage1/guest-result-aggregation.ps1'] -cne '" + module_sha + "'){throw 'Strict result aggregator source seal mismatch'}")
    text = _replace_once(text, '1b6c9843c7948c7c3a69516062769c5f810384871b21600069aaf5feab3d7fc9', '__V7_MANIFEST_SHA256__')
    text = _replace_once(text, '1963914ae74dccfe35a2998a7ba3bead849dc72bed5c518e06fff5b7d819b397', '__V7_VERIFIER_SHA256__')
    for old, new in (('package-v6', 'package-v7'), ('full-verify-v6', 'full-verify-v7'), ('Sealed v6', 'Sealed v7')):
        if old not in text:
            raise RuntimeError('Exact sealed v6 snapshot label absent: ' + old)
        text = text.replace(old, new)
    if any(token in text for token in ('package-v6', 'full-verify-v6', 'Sealed v6', 'Set-ExecutionPolicy', 'Unblock-File', '.Kill()')):
        raise RuntimeError('Old label or persistent/forced process action in v7 draft')
    return text


def ordinary(path, *, missing=False):
    if not path.is_absolute() or not path.is_relative_to(ROOT):
        raise RuntimeError('Helper path outside isolated owned workspace')
    for item in (path, *path.parents):
        if item.exists():
            info = item.lstat()
            if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400 or stat.S_ISREG(info.st_mode) and info.st_nlink != 1:
                raise RuntimeError('Nonordinary helper path refused')
        elif item == path and not missing:
            raise RuntimeError('Required helper input absent')
        if item == ROOT:
            return
    raise RuntimeError('Helper physical owned ancestry absent')


def stable_bytes(path):
    ordinary(path)
    before = path.stat()
    body = path.read_bytes()
    after = path.stat()
    identity = lambda info: (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_nlink)
    if identity(before) != identity(after):
        raise RuntimeError('Helper source identity changed while reading')
    return body


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--aggregation-sha256', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if not re.fullmatch('[a-f0-9]{64}', args.aggregation_sha256):
        raise RuntimeError('Root-approved aggregation SHA256 required')
    expected_output = ROOT / 'sandbox/input/guest-bootstrap-v7.ps1'
    if args.output != expected_output:
        raise RuntimeError('Only fresh fixed unsealed v7 helper output is allowed')
    ordinary(args.output, missing=True)
    if args.output.exists():
        raise RuntimeError('Fresh v7 helper output already exists')
    module = stable_bytes(MODULE)
    if hashlib.sha256(module).hexdigest() != args.aggregation_sha256:
        raise RuntimeError('Root-approved aggregation module changed')
    result = build_draft(stable_bytes(SOURCE), module)
    with args.output.open('x', encoding='utf-8-sig', newline='\r\n') as stream:
        stream.write(result)
    print('Unsealed v7 helper created; Root sealing and actual Guest verification remain pending: ' + str(args.output))


if __name__ == '__main__':
    main()
