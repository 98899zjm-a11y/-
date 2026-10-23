"""Data-only recorder for completed P2 Guest and static compiler evidence."""
from pathlib import Path
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[1]
PINS = {
    'project/lib/server.ts': '5cb99376e1ed0ab13cbce23b55b3c4ee737c91734bb0bd0bdb7d5d9609212c98',
    'project/desktop/renderer/workspace.tsx': 'f9d09655e0fe3c6f061391bc7a442bd029ccbc4323fbe50e23a9ca461f03c83f',
    'project/desktop/renderer/customer-picker.tsx': '4705168e39b2c1c2feaf24abbaf4bd47f085081334ba019ac40e7f5506cf76d8',
    'project/desktop/renderer/style-management.tsx': '5bbaa0a70b629ba1355451437ff2efe136343f4be68ec0823902a3fec44a0f19',
    'audit-tools/customer-style-data-path-p2.test.cjs': 'd7dfd7281dae9c99e0f76e6f2cadc4d2c895ab7c7aa3a8f9d4ffee37078e13cb',
    'reports/customer-style-data-path-p2-implementation-independent-review.md': 'e6065406fdb6dbb4a4d4b59186c238e87ec71b200bcc85304b9771f3e33cf697',
}

def sha(name):
    return hashlib.sha256((ROOT / name).read_bytes()).hexdigest()

assert all(sha(name) == value for name, value in PINS.items())
run = 'sandbox/results/p2-data-green-a1/'
rows = json.loads((ROOT / (run + 'results.json')).read_text('utf-8'))
assert [row['name'] for row in rows] == ['build-finance', 'p2-data-paths', 'related-customer-history']
assert all(row['exitCode'] == 0 and row['passed'] is True for row in rows)
counts = {}
for name, count in [('p2-data-paths', 10), ('related-customer-history', 68)]:
    body = (ROOT / (run + name + '.log')).read_text('utf-8')
    observed = {}
    for key, expected in {'tests': count, 'pass': count, 'fail': 0, 'skipped': 0, 'cancelled': 0}.items():
        found = re.findall(r'^# ' + key + r' (\d+)\s*$', body, re.M)
        assert found and int(found[-1]) == expected, (name, key)
        observed[key] = expected
    counts[name] = observed
types_name = 'reports/static-typecheck-2026-10-15T23-43-20-383Z.json'
types = json.loads((ROOT / types_name).read_text('utf-8'))
assert types['summary']['currentDiagnostics'] == 0 and types['sourcesChangedDuringCheck'] == []
assert types['current']['rootFileCount'] == 126
type_inputs = [row for row in types['current']['readInputs'] if row['file'].startswith('project/')]
assert all(sha(row['file']) == row['sha256'] for row in type_inputs)
files = [run + 'results.json', *[run + row['log'] for row in rows], types_name,
         'reports/static-typecheck-2026-10-15T23-43-20-383Z.current.log',
         'reports/static-typecheck-2026-10-15T23-43-20-383Z.baseline.log',
         'sandbox/results/p2-data-green-a1-applied.json']
evidence = {
    'version': 1, 'purpose': 'customer preview and complete admin style directory P2 minimum fix',
    'actualOfflineGuest': True, 'sourceAndTestPins': PINS, 'groups': rows, 'counts': counts,
    'hashes': {name: sha(name) for name in files},
    'typecheck': {'report': types_name, 'actualExitCode': 0, 'compiler': '5.9.3', 'rootFiles': 126,
                  'programFiles': 1794, 'currentDiagnostics': 0, 'projectInputsRechecked': len(type_inputs)},
    'preservedRedEvidence': 'audit-evidence/customer-style-p2-red-20261016.json',
    'limits': ['trusted finance identity fixture, not HTTP or request ALS verification',
               'real RAM SQLite and actual workspace/component extraction, not real React browser GUI',
               'fixed ten do not exhaustively schedule async races or canonical POST response',
               'full new-source build and complete regression still pending'],
    'productionDatabaseRead': False, 'productionChanged': False, 'installed': False,
}
with (ROOT / 'audit-evidence/customer-style-p2-green-20261016.json').open('x', encoding='utf-8', newline='\n') as stream:
    json.dump(evidence, stream, ensure_ascii=False, indent=2)
    stream.write('\n')
section = '''## 2026-10-16 客户预览及款式管理P2专项GREEN

四份产品源最小修复已实际验证：旧客户搜选/refresh与普通/新版本复制的当前纸张保留姓名；UI简档只供同ID显示，保存前剥离、后台仍重读真实客户。管理员款式管理改走真实分页/搜索，可见停用旧款；includeInactive=1先验管理员，普通开单仍只看启用款。经营公式、数据库结构、历史行和原款式保存权限未改。

实际离线Guest build-finance0、固定d7df十项10/10通过、客户/历史相关68/68通过，均0失败0跳过/exit0。完整TypeScript5.9.3本轮真实exit0/0诊断、126 roots/1794 files、sourcesChanged[]；输入SHA复核一致。独立四源复审未发现阻塞。证据audit-evidence/customer-style-p2-green-20261016.json，原4通过6失败RED原样保留。

这是实际RAM SQL和受控实际UI代码路径专项，不是新源码完整回归或真实React/手机验收。清换客户/保存回包与迟到Promise补充测试正在独立编写；新完整构建/整轮回归、真实GUI及新EXE封签安装仍待。正式软件及营业资料没有被本轮测试修改。
'''
for name in ['PROJECT_CONTEXT.md', 'ARCHITECTURE.md', 'AUDIT_REPORT.md', 'OPTIMIZATION_PLAN.md', 'TEST_REPORT.md', 'HANDOFF.md', 'CHANGELOG.md', 'UI_DESIGN_SPEC.md', 'UI_AUDIT.md']:
    file = ROOT / name
    original = file.read_text('utf-8')
    assert section.split('\n')[0] not in original
    title, rest = original.split('\n', 1)
    file.write_bytes((title + '\n\n' + section + '\n' + rest.lstrip('\n')).encode('utf-8'))
print(json.dumps({'counts': counts, 'typecheckDiagnostics': 0, 'productionChanged': False}))
