"""Data-only evidence. Keeps native FAIL separate from actual P2 supplement PASS."""
from pathlib import Path
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[1]
def sha(name):
    return hashlib.sha256((ROOT / name).read_bytes()).hexdigest()

native_result = 'sandbox/results/ui-observer-v2-native-v2-pair-a1/result.json'
native_run = 'sandbox/results/observer-v2-native-a1/'
native = json.loads((ROOT / native_result).read_text('utf-8'))
native_rows = json.loads((ROOT / (native_run + 'results.json')).read_text('utf-8'))
assert len(native_rows) == 1 and native_rows[0]['exitCode'] == 1 and native_rows[0]['passed'] is False
assert native['passed'] is False and native['uiAdmissionGranted'] is False
assert sum(value is True for value in native['checks'].values()) == 5
assert sum(value is None for value in native['checks'].values()) == 9
assert native['modelFailure'] == {'code': 'GLOBAL_HISTORY_BUDGET_EXHAUSTED'}
assert native['adapterFailure'] is None and native['samples'] == []
assert native['sequenceEvidence']['lastSourceSequence'] == 3
assert native['sequenceEvidence']['modelFrames'] == 1
assert native['normalStop']['passed'] is False and native['normalStop']['parentPopenExitCode'] == 0
assert native['normalStop']['parentEofSent'] is True and native['normalStop']['ownedHandlesRemaining'] == 0
assert native['normalStop']['newCapturedProcessForcedStop'] is False
assert native['collector']['requests'] == native['collector']['responses'] == 3
assert native['collector']['popenExitCode'] == 0 and native['collector']['eofSent'] is True
assert native['collector']['stderrBytes'] == 0 and native['collector']['failure'] is None
native_files = [native_result, native_run + 'results.json', native_run + 'observer-v2-parent-child.log',
                'sandbox/results/observer-v2-native-a1-applied.json',
                'audit-tools/ui-observer-v2-native-contract.json',
                'reports/ui-observer-v2-native-independent-review.md']
evidence = {
    'version': 1, 'purpose': 'v2 fixed parent child actual native a1 failure preserved',
    'actualOfflineGuest': True, 'actualExitCode': 1, 'passed': False,
    'checksTrue': 5, 'checksNotExecuted': 9, 'modelFailure': native['modelFailure'],
    'normalStop': native['normalStop'], 'collector': native['collector'],
    'sources': native['sources'], 'dependencies': native['dependencies'],
    'sourceSequence': 3, 'pureSequence': 1,
    'rawFailingFrameSaved': False, 'preciseExtraReachableProcessKnown': False,
    'noAutomaticBudgetIncreaseOrRetry': True, 'uiAdmissionGranted': False,
    'productionChanged': False, 'hashes': {name: sha(name) for name in native_files},
    'limits': ['do not infer which process or API caused budget pressure without raw frame',
               'captured EOF and exit0 facts do not replace failed normalStop or full closure'],
}
with (ROOT / 'audit-evidence/ui-observer-v2-native-a1-failure-20261016.json').open('x', encoding='utf-8', newline='\n') as stream:
    json.dump(evidence, stream, ensure_ascii=False, indent=2)
    stream.write('\n')

run = 'sandbox/results/p2-state-supplement-a1/'
rows = json.loads((ROOT / (run + 'results.json')).read_text('utf-8'))
assert len(rows) == 1 and rows[0]['exitCode'] == 0 and rows[0]['passed'] is True
assert sha('audit-tools/customer-style-p2-state-supplement.test.cjs') == '4fa4c0bf36187d40a713fddbe493607e72c6b436814b7d0f2c16e9a397331f91'
assert sha('audit-tools/customer-style-data-path-p2.test.cjs') == 'd7dfd7281dae9c99e0f76e6f2cadc4d2c895ab7c7aa3a8f9d4ffee37078e13cb'
assert sha('reports/customer-style-p2-state-supplement-independent-review.md') == 'aba0f41eb9c80d54aaddf9f5758af480f4d18ef505bb9664c7df1cbac48c9006'
log = (ROOT / (run + 'p2-state-supplement.log')).read_text('utf-8')
counts = {'tests': 4, 'pass': 4, 'fail': 0, 'skipped': 0, 'cancelled': 0}
for key, expected in counts.items():
    found = re.findall(r'^# ' + key + r' (\d+)\s*$', log, re.M)
    assert found and int(found[-1]) == expected, key
files = [run + 'results.json', run + 'p2-state-supplement.log', 'sandbox/results/p2-state-supplement-a1-applied.json',
         'audit-tools/customer-style-p2-state-supplement.test.cjs', 'audit-tools/customer-style-p2-state-supplement-spec.md',
         'reports/customer-style-p2-state-supplement-independent-review.md']
supplement = {
    'version': 1, 'purpose': 'P2 state and async supplements actual Guest GREEN',
    'actualOfflineGuest': True, 'actualExitCode': 0, 'counts': counts,
    'alreadyIncludedInBuild9Total1018': False, 'sourceProductChanges': [],
    'realRamServerSave': True, 'realReactBrowserScheduling': False, 'productionChanged': False,
    'hashes': {name: sha(name) for name in files},
    'limits': ['controlled hook phases and 12 setImmediate turns',
               'no real browser, failed save, image transfer or exhaustive React lifecycle claim'],
}
with (ROOT / 'audit-evidence/customer-style-p2-state-green-20261016.json').open('x', encoding='utf-8', newline='\n') as stream:
    json.dump(supplement, stream, ensure_ascii=False, indent=2)
    stream.write('\n')
section = '''## 2026-10-16 P2状态补4通过，原生QA首轮失败如实保留

新4fa4补测经Root/独立源审后在实际Guest4/4通过、0失败0跳过/exit0：切换/清空客户不继承旧brief；实际persist→RAM server.createQuote/SQL/refresh证明POST剥UI字段、同ID canonical姓名回填，金额52000分；实际StyleManagement在合成layout/passive窗口拒迟到结果，旧finally/卸载后不写状态。四产品源不变，此4项未计入此前build9的1018。证据audit-evidence/customer-style-p2-state-green-20261016.json。受控hooks不是真实React/浏览器时序验收。

独立原生QA f777合同在实际Guest首轮exit1：14声明检查仅5true/9未执行，首模型帧sourceSeq3/pureSeq1因GLOBAL_HISTORY_BUDGET_EXHAUSTED停止；raw frame未保存，不能猜额外后代或认定计账错误。parent捕获EOF/exit0、collector3req3resp/EOF0/空stderr、owned0/无强杀均独立记录；overall与normalStop仍FAIL、uiAdmission=false。没有扩budget、忽略未知PID或自动重跑刷绿。原FAIL在audit-evidence/ui-observer-v2-native-a1-failure-20261016.json。

P2补4是后续独立运行，未与失败原生attempt混为一轮PASS。实际GUI仍被工具门禁阻止；继续只在隔离副本诊断。另导入导出只读复审发现财务报销CSV普通文本原样作为公式单元格输出的源风险，待Guest复现/出口最小修复；没有正式Excel执行/泄漏/RCE证据。正式EXE/数据库/配置及员工包未因这些检查被修改或发送。
'''
for name in ['PROJECT_CONTEXT.md', 'ARCHITECTURE.md', 'AUDIT_REPORT.md', 'OPTIMIZATION_PLAN.md', 'TEST_REPORT.md', 'HANDOFF.md', 'CHANGELOG.md', 'UI_DESIGN_SPEC.md', 'UI_AUDIT.md']:
    file = ROOT / name
    original = file.read_text('utf-8')
    assert section.split('\n')[0] not in original
    title, rest = original.split('\n', 1)
    file.write_bytes((title + '\n\n' + section + '\n' + rest.lstrip('\n')).encode('utf-8'))
print(json.dumps({'nativeActualExitCode': 1, 'nativePassed': False, 'supplement': counts, 'productionChanged': False}))
