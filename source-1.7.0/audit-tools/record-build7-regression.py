"""Data-only final recording; refuses partial/failed full-regression results."""
from pathlib import Path
from datetime import datetime
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[1]
def sha(relative):
    return hashlib.sha256((ROOT / relative).read_bytes()).hexdigest()

build_name = 'sandbox/results/current-code-build-build-current7.json'
assert sha(build_name) == '7b927371174e362f5a39dbc4e3e9a92de5dd8b5a5e2039b35a3eafb72e33034e'
build = json.loads((ROOT / build_name).read_text('utf-8'))
assert build['unsealed'] is True and build['installed'] is False and build['dataIncluded'] is False
assert len(build['sourceHashes']) == 170
for relative, expected in build['sourceHashes'].items():
    assert sha('project/' + relative) == expected, relative
assert build['sourceHashes']['lib/platform/desktop-identity.ts'] == 'f1fc0650c7ac5364c6186bfb7147b6dc316d0845f0bfc15ac04cd9aea4d72662'
assert build['sourceHashes']['desktop/renderer/modal-focus.ts'] == 'e4c8413aeba99a6b995182bf04d1f9c7d1b7aabc1887b94166a5fd1940328f91'
assert sha('project/desktop/administration.cjs') == '7132a5a253dcafa57aba570f6aa491969a7204157c15e14f3ccf94757f232ea6'
business = next(row for row in build['evidence'] if row['output'] == 'generated/business.cjs')
assert 'lib/platform/desktop-identity.ts' in business['inputs'] and 'offline-platform:identity' not in business['inputs']
assert business['sha256'] == 'f0e2319cc1dc233db81383cd754b9c71c59d27b4c2ff9239aa9ee558a17d93ee'
run = 'sandbox/results/regression-current6/'
rows = json.loads((ROOT / (run + 'results.json')).read_text('utf-8'))
expected_names = ['build-finance', 'node-unit', 'python-guard', 'launcher-boundaries', 'os-access-gate', 'sandbox-context', 'erp-values', 'erp-reports-pure', 'erp-attachments', 'smoke', 'finance-test', 'backup-test', 'daily-test', 'lan-test', 'numbers-test', 'collaboration-test', 'customers-test', 'export-test', 'security-test', 'restore-test', 'erp-test']
assert [row['name'] for row in rows] == expected_names, 'Do not record a partial run as complete'
assert all(row['exitCode'] == 0 and row['passed'] is True for row in rows)
log = (ROOT / (run + 'node-unit.log')).read_text('utf-8')
counts = {}
for key, expected in [('tests', 996), ('pass', 994), ('fail', 0), ('skipped', 2), ('cancelled', 0)]:
    value = re.findall(r'^# ' + key + r' (\d+)\s*$', log, re.M)
    assert value and int(value[-1]) == expected, (key, value)
    counts[key] = int(value[-1])
skip_titles = re.findall(r'^ok \d+ - (.*# SKIP[^\n]*)$', log, re.M)
previous_log = (ROOT / 'sandbox/results/regression-current5/node-unit.log').read_text('utf-8')
assert len(skip_titles) == 2 and skip_titles == re.findall(r'^ok \d+ - (.*# SKIP[^\n]*)$', previous_log, re.M), 'Keep the exact original skip titles; no hidden new skip'
duration = (datetime.fromisoformat(rows[-1]['endedAt']) - datetime.fromisoformat(rows[0]['startedAt'])).total_seconds()
types_name = 'reports/static-typecheck-2026-10-15T22-31-04-912Z.json'
types = json.loads((ROOT / types_name).read_text('utf-8'))
assert types['summary']['currentDiagnostics'] == 0 and types['sourcesChangedDuringCheck'] == []
evidence = {
    'version': 1, 'purpose': 'build7 actual bounded full regression', 'actualOfflineGuest': True,
    'buildReport': build_name, 'buildReportSha256': sha(build_name), 'app': build['app'],
    'sourceFilesMatched': 170, 'generated': build['generated'], 'groups': rows, 'nodeCounts': counts,
    'durationIncludingOrchestrationSeconds': duration,
    'hashes': {name: sha(name) for name in [run + 'results.json', *[run + row['log'] for row in rows]]},
    'typecheckReport': types_name, 'typecheckSha256': sha(types_name), 'typecheckProcessExitCode': 0,
    'originalTwoSkipsPreserved': True, 'originalSkipTitles': skip_titles, 'newUiOrNativePhoneAcceptance': False,
    'newFullExeReleased': False, 'unsealed': True, 'installed': False, 'productionChanged': False,
}
with (ROOT / 'audit-evidence/build7-regression-current6-20261016.json').open('x', encoding='utf-8', newline='\n') as stream:
    json.dump(evidence, stream, ensure_ascii=False, indent=2)
    stream.write('\n')
section = f'''## 2026-10-16 build7合并完整回归通过

本轮实际regression-current6的21组全部exit0：Node996项=994通过/0失败/2既有skip，含新typed12与usage3+5及原Dialog22，不重复加总；7 Python检查和12业务模式（包括财务、备份恢复、每日备份、局域网、单号、客户、协作、导出、安全、ERP）完整结束。含编排实测{duration:.3f}秒。170编译源与W逐一SHA相同，business f0e231…真实含typed源、无旧virtual identity。

完整TS实际exit0/0诊断/125roots1793files/sourcesChanged[]。新admin7132、modal e4及typed五源已经本轮相关回归覆盖；两个旧skip没有刷绿。build7仍是未封签/未安装编译产物，不是新EXE发布，实际新UI/真机/公网/实体打印/Win10/完整新engine仍未验收。证据audit-evidence/build7-regression-current6-20261016.json；历史各轮FAIL与日志保持。
'''
for name in ['PROJECT_CONTEXT.md', 'ARCHITECTURE.md', 'AUDIT_REPORT.md', 'OPTIMIZATION_PLAN.md', 'FINANCIAL_AUDIT.md', 'TEST_REPORT.md', 'HANDOFF.md', 'CHANGELOG.md']:
    file = ROOT / name
    original = file.read_text('utf-8')
    assert section.split('\n')[0] not in original
    title, rest = original.split('\n', 1)
    file.write_bytes((title + '\n\n' + section + '\n' + rest.lstrip('\n')).encode('utf-8'))
print(json.dumps({'allGroupsPassed': len(rows), 'node': counts, 'seconds': duration, 'sourceFilesMatched': 170, 'newExeReleased': False}))
