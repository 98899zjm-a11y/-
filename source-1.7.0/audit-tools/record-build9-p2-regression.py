"""Data-only recorder; refuses partial full-regression or changed source inputs."""
from pathlib import Path
from datetime import datetime
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[1]
def sha(name):
    return hashlib.sha256((ROOT / name).read_bytes()).hexdigest()

build_name = 'sandbox/results/current-code-build-build-current9.json'
build = json.loads((ROOT / build_name).read_text('utf-8'))
assert build['unsealed'] is True and build['installed'] is False and build['dataIncluded'] is False
assert len(build['sourceHashes']) == 171
assert all(sha('project/' + name) == expected for name, expected in build['sourceHashes'].items())
run = 'sandbox/results/regression-current8/'
rows = json.loads((ROOT / (run + 'results.json')).read_text('utf-8'))
names = ['build-finance', 'node-unit', 'python-guard', 'launcher-boundaries', 'os-access-gate', 'sandbox-context', 'erp-values', 'erp-reports-pure', 'erp-attachments', 'smoke', 'finance-test', 'backup-test', 'daily-test', 'lan-test', 'numbers-test', 'collaboration-test', 'customers-test', 'export-test', 'security-test', 'restore-test', 'erp-test']
assert [row['name'] for row in rows] == names
assert all(row['exitCode'] == 0 and row['passed'] is True for row in rows)
log = (ROOT / (run + 'node-unit.log')).read_text('utf-8')
counts = {'tests': 1018, 'pass': 1016, 'fail': 0, 'skipped': 2, 'cancelled': 0}
for key, expected in counts.items():
    found = re.findall(r'^# ' + key + r' (\d+)\s*$', log, re.M)
    assert found and int(found[-1]) == expected, key
skips = re.findall(r'^ok \d+ - (.*# SKIP[^\n]*)$', log, re.M)
prior = (ROOT / 'sandbox/results/regression-current7/node-unit.log').read_text('utf-8')
assert len(skips) == 2 and skips == re.findall(r'^ok \d+ - (.*# SKIP[^\n]*)$', prior, re.M)
types_name = 'reports/static-typecheck-2026-10-15T23-43-20-383Z.json'
types = json.loads((ROOT / types_name).read_text('utf-8'))
assert types['summary']['currentDiagnostics'] == 0 and types['sourcesChangedDuringCheck'] == []
type_inputs = [row for row in types['current']['readInputs'] if row['file'].startswith('project/')]
assert all(sha(row['file']) == row['sha256'] for row in type_inputs)
duration = (datetime.fromisoformat(rows[-1]['endedAt']) - datetime.fromisoformat(rows[0]['startedAt'])).total_seconds()
files = [build_name, run + 'results.json', *[run + row['log'] for row in rows], types_name]
evidence = {
    'version': 1, 'purpose': 'customer/style P2 code build9 and complete bounded regression-current8',
    'actualOfflineGuest': True, 'buildReport': build_name, 'sourceFilesMatched': 171,
    'app': build['app'], 'generated': build['generated'], 'groups': rows, 'nodeCounts': counts,
    'originalSkipTitles': skips, 'durationIncludingOrchestrationSeconds': duration,
    'hashes': {name: sha(name) for name in files},
    'typecheck': {'report': types_name, 'actualExitCode': 0, 'compilerRerunInFullBatch': False,
                  'previousFreshCurrentSourceDiagnostics': 0, 'projectInputsRechecked': len(type_inputs)},
    'p2TenAlreadyIncludedInTotal': True, 'newAsyncSupplementIncluded': False,
    'realGuiVerified': False, 'nativeTrayVerified': False, 'newEngineCompatibilityVerified': False,
    'pythonModulesRebuilt': False, 'unsealed': True, 'installed': False, 'productionChanged': False,
}
with (ROOT / 'audit-evidence/build9-p2-regression-20261016.json').open('x', encoding='utf-8', newline='\n') as stream:
    json.dump(evidence, stream, ensure_ascii=False, indent=2)
    stream.write('\n')
section = f'''## 2026-10-16 build9与客户款式修复合并回归完成

实际build9成功，171份编译源SHA与W逐一一致；当前business生成摘要{build['generated'][0]['sha256']}。实际regression-current8的21组全部exit0：Node1018项=1016通过/0失败/2原skip，7个Python检查及12业务模式完整结束，含编排{duration:.3f}秒。新P2固定十项已经包括在1018内，不重复加总。原两skip标题与build8逐字一致，历史失败不改。

本轮P2四源的完整TS此前已真实0诊断/exit0/126 roots1794 files；本批仅再次复核全部项目输入SHA不变，没有虚称重复运行。证据audit-evidence/build9-p2-regression-20261016.json。新异步补测尚未纳入该固定回归；Python业务模块未因编译JS而被重建。新生成内容仍未封签/安装，不是优化版EXE交付。

真实双角色GUI/系统托盘、全量手机业务、实体打印、Win10/Win11双平台及引擎44.7.2完整兼容/新安装回滚仍需各自验证。本阶段没有部署或访问正式营业数据库；下一步继续真实GUI测试工具接线及新发现导出风险核验，不以整轮通过推定没有BUG。
'''
for name in ['PROJECT_CONTEXT.md', 'ARCHITECTURE.md', 'AUDIT_REPORT.md', 'OPTIMIZATION_PLAN.md', 'TEST_REPORT.md', 'HANDOFF.md', 'CHANGELOG.md', 'UI_DESIGN_SPEC.md', 'UI_AUDIT.md']:
    file = ROOT / name
    original = file.read_text('utf-8')
    assert section.split('\n')[0] not in original
    title, rest = original.split('\n', 1)
    file.write_bytes((title + '\n\n' + section + '\n' + rest.lstrip('\n')).encode('utf-8'))
print(json.dumps({'groups': 21, 'node': counts, 'seconds': duration, 'sourceFiles': 171, 'productionChanged': False}))
