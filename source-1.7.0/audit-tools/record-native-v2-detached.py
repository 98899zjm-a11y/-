"""Data-only native evidence from completed Guest outputs; no process access."""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
def sha(name):
    return hashlib.sha256((ROOT / name).read_bytes()).hexdigest()

def result_set(directory, run, expected_exit):
    result_file = directory + '/result.json'
    result = json.loads((ROOT / result_file).read_text('utf-8'))
    rows = json.loads((ROOT / (run + '/results.json')).read_text('utf-8'))
    assert len(rows) == 1 and rows[0]['exitCode'] == expected_exit
    files = [result_file, run + '/results.json', run + '/' + rows[0]['log']]
    frames = []
    for item in result['diagnosticFrames']:
        name = directory + '/' + item['file']
        assert sha(name) == item['sha256'] and (ROOT / name).stat().st_size == item['bytes']
        frame = json.loads((ROOT / name).read_text('utf-8'))
        assert frame['sourceSequence'] == item['sourceSequence']
        assert len(frame['processRows']) == item['rowCount']
        frames.append(frame)
        files.append(name)
    return result, frames, files

diagnostic, failed_frames, failed_files = result_set('sandbox/results/ui-observer-v2-native-diagnostic-v2-frame-a1', 'sandbox/results/observer-v2-frame-a1', 1)
assert diagnostic['passed'] is False and diagnostic['modelFailure'] == {'code': 'GLOBAL_HISTORY_BUDGET_EXHAUSTED'}
assert [frame['sourceSequence'] for frame in failed_frames] == [1, 2, 3]
old = {row['processId'] for row in failed_frames[0]['processRows']}
new_rows = [row for row in failed_frames[1]['processRows'] if row['processId'] not in old]
assert {row['processId'] for row in new_rows} == {4484, 2992, 4148, 2016}
assert {row['processId']: row['parentProcessId'] for row in new_rows} == {4484: 1448, 2992: 4484, 4148: 4484, 2016: 4148}
assert diagnostic['normalStop']['parentPopenExitCode'] == 0 and diagnostic['collector']['popenExitCode'] == 0
assert diagnostic['normalStop']['ownedHandlesRemaining'] == 0 and diagnostic['normalStop']['passed'] is False
evidence = {'version': 1, 'purpose': 'native v2 actual raw-frame diagnostic failure, no ownership inference for console hosts',
            'actualOfflineGuest': True, 'actualExitCode': 1, 'passed': False, 'sourceFrames': 3,
            'newAtRootFrame': new_rows, 'modelFailure': diagnostic['modelFailure'],
            'unmeasuredOriginalF777RowsNotBackfilled': True, 'consoleHostKernelOwnershipVerified': False,
            'normalStop': diagnostic['normalStop'], 'productionChanged': False,
            'hashes': {name: sha(name) for name in failed_files}}
with (ROOT / 'audit-evidence/ui-observer-v2-frame-diagnostic-20261016.json').open('x', encoding='utf-8', newline='\n') as stream:
    json.dump(evidence, stream, ensure_ascii=False, indent=2)
    stream.write('\n')

current, frames, files = result_set('sandbox/results/ui-observer-v2-detached-v2-detached-a1', 'sandbox/results/observer-v2-detached-a1', 0)
assert current['passed'] is True and len(current['checks']) == 14 and all(value is True for value in current['checks'].values())
assert current['normalStop']['passed'] is True and current['normalStop']['ownedHandlesRemaining'] == 0
assert current['normalStop']['newCapturedProcessForcedStop'] is False
assert current['parentFinal']['childExitCode'] == 0 and current['parentFinal']['childEofSent'] is True
assert current['collector']['popenExitCode'] == 0 and current['collector']['stderrBytes'] == 0
assert current['adapterFailure'] is None and current['modelFailure'] is None
assert current['uiAdmissionGranted'] is False and len(frames) == 8
assert current['sequenceEvidence']['sourceOffset'] == 2 and current['sequenceEvidence']['modelFrames'] == 6
assert current['collector']['requests'] == current['collector']['responses'] == 8
live = current['samples'][0]['verifiedLive']
assert len(live) == 2
root_pid = next(value['pid'] for value in live if value['handleOwnership'] == 'borrowed')
reachable = {root_pid}
while True:
    before = len(reachable)
    reachable.update(row['processId'] for row in frames[2]['processRows'] if row['parentProcessId'] in reachable)
    if len(reachable) == before:
        break
assert reachable == {value['pid'] for value in live}
extras = ['audit-tools/ui-observer-v2-detached-contract.json', 'reports/ui-observer-v2-detached-spec.md',
          'reports/ui-observer-v2-detached-independent-review.md']
assert sha(extras[2]) == '3aa1af05b869b7c4388b30ba5e7e441df6b6af8c16b670c34d889aea70dde27a'
evidence = {'version': 1, 'purpose': 'fixed detached Python parent child native v2 scope GREEN',
            'actualOfflineGuest': True, 'actualExitCode': 0, 'passed': True, 'checksPassed': 14,
            'sources': current['sources'], 'dependencies': current['dependencies'],
            'sourceFrames': 8, 'modelFrames': 6, 'observedReachablePids': sorted(reachable),
            'normalStop': current['normalStop'], 'collector': current['collector'],
            'hashes': {name: sha(name) for name in [*files, *extras]},
            'originalFailuresPreserved': True, 'uiAdmissionGranted': False,
            'realGuiOrEngineOrProductQualified': False, 'productionChanged': False}
with (ROOT / 'audit-evidence/ui-observer-v2-detached-green-20261016.json').open('x', encoding='utf-8', newline='\n') as stream:
    json.dump(evidence, stream, ensure_ascii=False, indent=2)
    stream.write('\n')
section = '''## 2026-10-16 固定Python平台14项通过，GUI仍需独立接线

新067原帧诊断实际exit1，保留source1/2/3全processRows及SHA；新source2/3显示parent4484→conhost2992与child4148→conhost2016共4对象，超过原history2，未过滤行/扩budget。该新attempt解释自己的拒绝，未把PID倒填缺raw的原f777；这些console行尚未内核pin，不冒称已验证其ownership/完整退出。证据audit-evidence/ui-observer-v2-frame-diagnostic-20261016.json。

另封30de合同的新detached两副本仅两处Popen flag由CREATE_NO_WINDOW改DETACHED_PROCESS及独立身份标签；原14checks/2history/16model/18request/7API/0x101000/帧留存/EOF/holding不变。Root及独立AST源审后实际Guest14/14 true、exit0/normalStoptrue；8真实source帧映射6模型帧，父子两Python关系与held kernel身份匹配、正常EOF/exit0、owned0/无强杀、collector EOF0/空stderr。证据audit-evidence/ui-observer-v2-detached-green-20261016.json。

此为固定Python parent-child平台通过；uiAdmission=false，未给Electron/Edge/后来的root、旧UI-a2、业务数据或44.7.2发布自动资格。原A1/B1/f777/067失败及其确切清理边界保持。后续一次GUI接线只在新纯late-root API与精确capsule/原CAS/I/O合同内推进，正式系统未变。
'''
for name in ['PROJECT_CONTEXT.md', 'ARCHITECTURE.md', 'AUDIT_REPORT.md', 'OPTIMIZATION_PLAN.md', 'TEST_REPORT.md', 'HANDOFF.md', 'CHANGELOG.md', 'UI_AUDIT.md']:
    file = ROOT / name
    original = file.read_text('utf-8')
    assert section.split('\n')[0] not in original
    title, rest = original.split('\n', 1)
    file.write_bytes((title + '\n\n' + section + '\n' + rest.lstrip('\n')).encode('utf-8'))
print(json.dumps({'frameDiagnosticExit': 1, 'detachedExit': 0, 'checksPassed': 14, 'uiAdmission': False}))
