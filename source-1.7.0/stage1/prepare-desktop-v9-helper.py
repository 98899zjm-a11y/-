"""Pure conversion of exact sealed V8 helper bytes to an unsealed V9 draft.

This module deliberately has no CLI, file IO, process launch, or output writer.
The V9 sealer owns admission, fresh destinations, and replacement of the two
seal placeholders after the complete V9 package has been reviewed.
"""
import hashlib
import re


SOURCE_SHA = '85d25e621542685d55dbf65a53f15140940bd415ad5f30d376f9f4121831dbc3'
V7_RESOURCE_SHA = 'c82426dc5463f2b5f0b366dd7c7e0ac09ec9d542bc9b81866997ecbc0cf9efd9'
V7_ROOT = 'release/资源补丁-1.6.0-v7'
V7_RESOURCE_FILES = 1007
REVIEWER_FILES = (
    'delivery-approval/Prepare-Initial-Approval.ps1',
    'delivery-approval/approval-core.cjs',
    'delivery-approval/approval-archive.cjs',
    'delivery-approval/approval-io.cjs',
    'delivery-approval/负责人首次审定.cmd',
    'delivery-approval/README.md',
)
PURE_PS_FILES = (
    'tests/delivery-approval-ps-paths.test.ps1',
    'tests/delivery-approval-ps-acl.test.ps1',
    'stage1/candidate-delivery-approval-pure-ps-tests.ps1',
)

# Data-only PS5 function. Tests execute only this pure parser against in-memory
# synthetic logs; the generated Guest helper itself is never executed on Host.
NODE_TAP_FUNCTION = r"""function Get-GuestNodeTapSummary {
 param([AllowEmptyString()][string]$Text)
 $errors=[Collections.Generic.List[string]]::new();$counts=[ordered]@{}
 if([string]::IsNullOrWhiteSpace($Text) -or $Text.Length -gt 16777216){$errors.Add('Node TAP log absent or oversized')}
 else{
  $text=$Text.TrimStart([char]0xfeff)
  if([regex]::Matches($text,'(?m)^TAP version 13\r?$').Count -ne 1){$errors.Add('Exactly one TAP version 13 header required')}
  $plans=[regex]::Matches($text,'(?m)^1\.\.([0-9]+)\r?$');$planCount=[long]0
  if($plans.Count -ne 1 -or -not [long]::TryParse($plans[0].Groups[1].Value,[ref]$planCount) -or $planCount -le 0){$errors.Add('Exactly one positive top-level TAP plan required')}
  foreach($key in @('tests','pass','fail','cancelled','skipped','todo')){
   $anyField=[regex]::Matches($text,'(?m)^# '+$key+'(?:[ \t]|$)[^\r\n]*\r?$')
   $numericField=[regex]::Matches($text,'(?m)^# '+$key+' ([0-9]+)\r?$');$value=[long]0
   if($anyField.Count -ne 1 -or $numericField.Count -ne 1 -or -not [long]::TryParse($numericField[0].Groups[1].Value,[ref]$value)){$errors.Add('Node TAP field missing, duplicated or invalid: '+$key)}
   else{$counts[$key]=$value}
  }
  if($errors.Count -eq 0){
   if($counts.tests -le 0 -or $counts.pass -ne $counts.tests){$errors.Add('Node TAP requires positive tests and pass equal to tests')}
   foreach($key in @('fail','cancelled','skipped','todo')){if($counts[$key] -ne 0){$errors.Add('Node TAP requires zero '+$key)}}
  }
 }
 return [pscustomobject]@{passed=($errors.Count -eq 0);counts=[pscustomobject]$counts;validationErrors=$errors.ToArray()}
}"""

NODE_TAP_GATE = r"""
 $guestProof.stage='node-unit-tap-validation'
 $guestNodeLog='C:\xjy-work\xjy-web-stage1\reports\final-node-unit.log'
 Assert-GuestOrdinaryPath $guestNodeLog $guestWork
 if((Get-Item -LiteralPath $guestNodeLog -Force).Length -gt 16777216){throw 'Node TAP log exceeds bounded report size'}
 $guestNodeTap=Get-GuestNodeTapSummary -Text ([IO.File]::ReadAllText($guestNodeLog,[Text.Encoding]::UTF8))
 $guestProof.nodeUnitTap=$guestNodeTap
 if($guestNodeTap.passed -isnot [bool] -or -not $guestNodeTap.passed){throw ('Node unit TAP totals rejected: '+($guestNodeTap.validationErrors -join '; '))}
"""


def _once(text, old, new):
    if text.count(old) != 1:
        raise RuntimeError('Exact sealed V8 helper transformation point absent: ' + old[:100])
    return text.replace(old, new, 1)


def build_draft(source_bytes):
    """Return an LF-normalized, unsealed V9 string from frozen V8 bytes only."""
    if not isinstance(source_bytes, bytes) or not source_bytes.startswith(b'\xef\xbb\xbf') or hashlib.sha256(source_bytes).hexdigest() != SOURCE_SHA:
        raise RuntimeError('Exact sealed V8 helper hash/BOM changed')
    text = source_bytes.decode('utf-8-sig').replace('\r\n', '\n')
    text = _once(text, 'f59b67e35f5ded71686c810a516d7e72a367aaf730d45af5341eea7d07f6bde8', '__V9_MANIFEST_SHA256__')
    text = _once(text, '1963914ae74dccfe35a2998a7ba3bead849dc72bed5c518e06fff5b7d819b397', '__V9_VERIFIER_SHA256__')
    text = _once(text, '83c2cdbc10e6551e65ff072f48f42c78546688a683fc939ab4b1500c3c1bc668', V7_RESOURCE_SHA)
    text = _once(text, 'release/资源补丁-1.6.0-v2', V7_ROOT)
    text = _once(text, "throw 'Fixed complete v2 resource inclusion required'", "throw 'Fixed complete v7 resource inclusion required'")
    text = _once(text, 'function Read-GuestPolicy([string]$Suffix){', NODE_TAP_FUNCTION+'\nfunction Read-GuestPolicy([string]$Suffix){')
    baseline_gate=" if(-not $guestBaselineSummary.passed){throw 'Guest regression incomplete or failed; strict counts, real exit code and full streams preserved'}"
    text = _once(text, baseline_gate, baseline_gate+NODE_TAP_GATE)
    text = _once(text, 'nativeProgramToolCount -ne 8', 'nativeProgramToolCount -ne 14')
    text = _once(text, 'Fixed original engine and eight exact native program inputs required', 'Fixed original engine and fourteen exact native program inputs required')
    exact_reviewer_paths = '|'.join(re.escape(path) for path in REVIEWER_FILES)
    text = _once(text, r'|isolation-identity\.json$)', '|(?:' + exact_reviewer_paths + r')$|isolation-identity\.json$)')
    matches = re.findall(r'(?m)^ \$guestSealedEntries=@\(([^\n]+)\)$', text)
    if len(matches) != 1:
        raise RuntimeError('Exact sealed V8 helper sealed-entry declaration absent')
    old_entries = ' $guestSealedEntries=@(' + matches[0] + ')'
    new_entries = old_entries[:-1] + ',' + ','.join("'" + path + "'" for path in (*REVIEWER_FILES, *PURE_PS_FILES)) + ')'
    text = _once(text, old_entries, new_entries)
    for old, new in (('package-v8', 'package-v9'), ('desktop-verify-v8', 'desktop-verify-v9'), ('Sealed v8-desktop', 'Sealed v9-desktop')):
        if old not in text:
            raise RuntimeError('Exact sealed V8 helper snapshot label absent: ' + old)
        text = text.replace(old, new)
    if text.count('__V9_MANIFEST_SHA256__') != 1 or text.count('__V9_VERIFIER_SHA256__') != 1:
        raise RuntimeError('V9 draft must contain exactly two distinct unsealed placeholders')
    return text
