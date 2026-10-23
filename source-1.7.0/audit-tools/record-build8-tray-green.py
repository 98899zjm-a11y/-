"""Data-only evidence from completed Guest runs; refuses partial success."""
from pathlib import Path
from datetime import datetime
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[1]
def sha(relative):
    return hashlib.sha256((ROOT / relative).read_bytes()).hexdigest()

source = 'project/desktop/release-app.cjs'
assert sha(source) == '80f805aa69f3de620ef81441971dc2652715ec54961d2d7db42a7f996231605a'
assert sha('audit-tools/window-close-tray.test.cjs') == 'a1f2e8ef3d771c4ffb7e4d79f3478d31bfed3c9ee72c8a9a5661c699083d2d79'
def node_counts(relative, expected):
    text = (ROOT / relative).read_text('utf-8')
    values = {}
    for key, value in expected.items():
        found = re.findall(r'^# ' + key + r' (\d+)\s*$', text, re.M)
        assert found and int(found[-1]) == value, (relative, key)
        values[key] = value
    return values, text

for name, count, digest in [('tray-lifecycle', 12, '3b03fbcd6f7cc26bb565382ef1703d4636d76f501e1760c9cb2e144f7d372866'), ('related-lifecycle', 76, 'd34752cfce9c59cd9e11c103ceec6bd87dc52049b1f90cfdd005d3e58bbb78d3')]:
    relative = 'sandbox/results/tray-green-a1/' + name + '.log'
    assert sha(relative) == digest
    node_counts(relative, {'tests': count, 'pass': count, 'fail': 0, 'skipped': 0})
assert all(row['passed'] and row['exitCode'] == 0 for row in json.loads((ROOT / 'sandbox/results/tray-green-a1/results.json').read_text('utf-8')))
build_name = 'sandbox/results/current-code-build-build-current8.json'
assert sha(build_name) == 'eb21496ef7d30afbf65f544edb0255d43074327a13c6d2e41e80c4b8efa6b0b1'
build = json.loads((ROOT / build_name).read_text('utf-8'))
assert build['unsealed'] is True and build['installed'] is False and build['dataIncluded'] is False
assert len(build['sourceHashes']) == 170
for relative, expected in build['sourceHashes'].items():
    assert sha('project/' + relative) == expected, relative
run = 'sandbox/results/regression-current7/'
rows = json.loads((ROOT / (run + 'results.json')).read_text('utf-8'))
names = ['build-finance', 'node-unit', 'python-guard', 'launcher-boundaries', 'os-access-gate', 'sandbox-context', 'erp-values', 'erp-reports-pure', 'erp-attachments', 'smoke', 'finance-test', 'backup-test', 'daily-test', 'lan-test', 'numbers-test', 'collaboration-test', 'customers-test', 'export-test', 'security-test', 'restore-test', 'erp-test']
assert [row['name'] for row in rows] == names and all(row['exitCode'] == 0 and row['passed'] is True for row in rows)
counts, log = node_counts(run + 'node-unit.log', {'tests': 1008, 'pass': 1006, 'fail': 0, 'skipped': 2, 'cancelled': 0})
skips = re.findall(r'^ok \d+ - (.*# SKIP[^\n]*)$', log, re.M)
previous = (ROOT / 'sandbox/results/regression-current6/node-unit.log').read_text('utf-8')
assert len(skips) == 2 and skips == re.findall(r'^ok \d+ - (.*# SKIP[^\n]*)$', previous, re.M)
types_name = 'reports/static-typecheck-2026-10-15T22-31-04-912Z.json'
assert sha(types_name) == 'e38a2c8a2487dccf0b2ffa1284b9fe5bea5b1e89e50b11eb76d358c1ec4211ba'
types = json.loads((ROOT / types_name).read_text('utf-8'))
type_inputs = [row for row in types['current']['readInputs'] if row['file'].startswith('project/')]
assert len(type_inputs) >= 125 and all(sha(row['file']) == row['sha256'] for row in type_inputs), 'A reused typecheck must have unchanged project input bytes'
assert types['summary']['currentDiagnostics'] == 0 and types['sourcesChangedDuringCheck'] == []
duration = (datetime.fromisoformat(rows[-1]['endedAt']) - datetime.fromisoformat(rows[0]['startedAt'])).total_seconds()
evidence = {
    'version': 1, 'purpose': 'employee tray lifecycle minimum fix plus build8 full regression',
    'actualOfflineGuest': True, 'source': source, 'sourceSha256': sha(source),
    'targetedTrayCases': 12, 'oldRelatedCases': 76, 'targetedFailedOrSkipped': 0,
    'buildReport': build_name, 'buildReportSha256': sha(build_name), 'app': build['app'],
    'sourceFilesMatched': 170, 'generated': build['generated'], 'groups': rows, 'nodeCounts': counts,
    'originalSkipTitles': skips, 'durationIncludingOrchestrationSeconds': duration,
    'hashes': {name: sha(name) for name in [run + 'results.json', *[run + row['log'] for row in rows]]},
    'typecheck': {'report': types_name, 'sha256': sha(types_name), 'previousActualExitCode': 0, 'projectInputHashesRechecked': len(type_inputs), 'compilerRerunInThisBatch': False},
    'realSystemTrayVerified': False, 'realGuiOrPhoneVerified': False,
    'unsealed': True, 'installed': False, 'productionChanged': False,
}
with (ROOT / 'audit-evidence/build8-tray-green-20261016.json').open('x', encoding='utf-8', newline='\n') as stream:
    json.dump(evidence, stream, ensure_ascii=False, indent=2)
    stream.write('\n')
section = f'''## 2026-10-16 员工托盘最小修复与build8完整回归

release-app仅6增6删：两角色普通X取消close并hide，员工Tray可恢复/显式退出；Host原本地/管理员/确认再验证回调保留。before-quit、taskQueue、升级当前PID/normalExit和角色来源不改。实际事件fixture12/12及旧相关76/76均0skip/exit0，原RED7/5保持；这些专项已包含在本轮全套，不重复加总。

实际build8成功、170编译源SHA逐一相符；regression-current7的21组全部exit0，Node1008=1006通过/0失败/2原skip，含编排{duration:.3f}秒。此前完整TS实际0诊断报告的{len(type_inputs)}份项目输入本轮逐一SHA复核无变化，未重复运行TSC，不能称又跑了一次。证据audit-evidence/build8-tray-green-20261016.json。

事件fixture使用FakeElectron，不证明真实系统通知区、系统关机/Alt+F4、Win10/Win11双平台或实际升级跨进程；原模型额外window-all-closed限制仍适用。真实双角色GUI和新程序封签/安装仍待验，正式EXE及数据未替换。
'''
for name in ['PROJECT_CONTEXT.md', 'ARCHITECTURE.md', 'AUDIT_REPORT.md', 'OPTIMIZATION_PLAN.md', 'TEST_REPORT.md', 'HANDOFF.md', 'CHANGELOG.md', 'UI_DESIGN_SPEC.md', 'UI_AUDIT.md']:
    file = ROOT / name
    original = file.read_text('utf-8')
    assert section.split('\n')[0] not in original
    title, rest = original.split('\n', 1)
    file.write_bytes((title + '\n\n' + section + '\n' + rest.lstrip('\n')).encode('utf-8'))
print(json.dumps({'groupsPassed': 21, 'node': counts, 'seconds': duration, 'typedInputsRechecked': len(type_inputs), 'realSystemTrayVerified': False}))
