"""Data-only recording of actual completed CSV and unchanged ERP report checks."""
from pathlib import Path
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[1]
def sha(name):
    return hashlib.sha256((ROOT / name).read_bytes()).hexdigest()

source = 'project/desktop/legacy-source/ledger/finance.py'
assert sha(source) == '56bcb389a21ada8c5d650e6f7ea1e81781b446f3af0a4e9b19e019930df63096'
assert sha('audit-tools/finance-csv-export-test.py') == '799a021af80bd77e4794e6743f0f0ad36eec402b78455fd4015f53b816cbac7e'
review = 'reports/finance-csv-export-implementation-independent-review.md'
assert sha(review) == 'd895f6d630e4d655cdfbbcf11aa0af6ca51563117cd4183f34839f65dbb31d8d'
run = 'sandbox/results/finance-csv-green-a1/'
rows = json.loads((ROOT / (run + 'results.json')).read_text('utf-8'))
assert [row['name'] for row in rows] == ['csv-export-contract', 'erp-report-controls']
assert all(row['exitCode'] == 0 and row['passed'] is True for row in rows)
for name, count in [('csv-export-contract', 6), ('erp-report-controls', 8)]:
    body = (ROOT / (run + name + '.log')).read_text('utf-8')
    assert re.search(r'^Ran ' + str(count) + r' tests in ', body, re.M)
    assert re.search(r'^OK\s*$', body, re.M) and not re.search(r'^FAILED|^ERROR:|^FAIL:', body, re.M)
body = (ROOT / (run + 'csv-export-contract.log')).read_text('utf-8')
assert json.loads(body.splitlines()[0])['sourceSha256'] == sha(source)
assert len(re.findall(r'^test_\w+ .* \.\.\. ok\s*$', body, re.M)) == 6
files = [run + 'results.json', run + 'csv-export-contract.log', run + 'erp-report-controls.log',
         'sandbox/results/finance-csv-green-a1-applied.json', source,
         'audit-tools/finance-csv-export-test.py', 'audit-tools/finance-csv-export-spec.md', review]
evidence = {
    'version': 1, 'purpose': 'financial expense and payroll CSV source fix GREEN',
    'actualOfflineGuest': True, 'actualExitCode': 0, 'source': source, 'sourceSha256': sha(source),
    'sourceDiff': {'added': 8, 'removed': 2, 'existingChangedFunctions': ['expenses_export', 'payroll_export'],
                   'newHelper': 'csv_export_cell', 'unchangedOtherFunctionAsts': 9},
    'csvTopLevelPassed': 6, 'csvF02PrefixVectorsPassed': 81, 'relatedErpReportCasesPassed': 8,
    'errors': 0, 'databaseOpenedOrModified': False, 'sourceDataAndNumericValuesPreserved': True,
    'originalErrorAndRedPreserved': 'audit-evidence/finance-csv-red-20261016.json',
    'pythonReleaseModuleRebuilt': False, 'realOfficeOpenAndResaveVerified': False,
    'installed': False, 'productionChanged': False, 'hashes': {name: sha(name) for name in files},
    'limits': ['actual extracted source functions and typed query/Response ports, not whole Flask HTTP or saved database flow',
               'ASCII-space and declared prefix contract only, not every Unicode/Office interpretation',
               'no prebuilt module or signed updater has incorporated this Python source change yet'],
}
with (ROOT / 'audit-evidence/finance-csv-green-20261016.json').open('x', encoding='utf-8', newline='\n') as stream:
    json.dump(evidence, stream, ensure_ascii=False, indent=2)
    stream.write('\n')
section = '''## 2026-10-16 财务两CSV出口最小修复专项GREEN

finance.py仅8增2删：纯csv_export_cell对ASCII空格后的=+-@/tab/CR/LF文字加apostrophe＋原值，两CSV数据行复用；真实数值/负数/0/0.29及普通文字原样，原dict不改。独立AST复核另外9函数/imports/decorators/查询/表头/BOM/mime/filename/工资及权限算法均未变，无新依赖。

Root实际离线Guest原799六项6/6通过、F02的81个向量全部通过，相关ERP报表8/8通过，均0error/exit0；source真实打印56bcb389…且SHA复核一致。证据audit-evidence/finance-csv-green-20261016.json。原55夹具ERROR和a2的4控制通过/2目标失败83 subtest RED保留，不删除失败或改断言制造通过。

这只完成已知CSV源码出口合同，未执行全部Office打开/重存、HTTP保存或预制财务EXE更新。现阶段Python模块尚未重建，原build9的JS编译输入不包含Python，不能说完整安装包已带入修复。下一步先核隔离重建的真实工具/缓存/manifest/freeze边界，保留原pyc算法；正式软件、数据库和配置未被本轮修改。
'''
for name in ['PROJECT_CONTEXT.md', 'ARCHITECTURE.md', 'AUDIT_REPORT.md', 'OPTIMIZATION_PLAN.md', 'TEST_REPORT.md', 'HANDOFF.md', 'CHANGELOG.md', 'FINANCIAL_AUDIT.md']:
    file = ROOT / name
    original = file.read_text('utf-8')
    assert section.split('\n')[0] not in original
    title, rest = original.split('\n', 1)
    file.write_bytes((title + '\n\n' + section + '\n' + rest.lstrip('\n')).encode('utf-8'))
print(json.dumps({'csvCasesPassed': 6, 'prefixSubtests': 81, 'erpReportCasesPassed': 8, 'moduleRebuilt': False, 'productionChanged': False}))
