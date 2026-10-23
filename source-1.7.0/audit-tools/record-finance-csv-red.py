"""Data-only record of the preserved fixture error and subsequent real CSV RED."""
from pathlib import Path
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[1]
def sha(name):
    return hashlib.sha256((ROOT / name).read_bytes()).hexdigest()

assert sha('audit-tools/qa-history/finance-csv-export-test-a1.py') == '55f65e4a010daabdf74987dd2b3b37b114f040c64e8ff60fca89b202ef7ddcac'
assert sha('audit-tools/qa-history/finance-csv-export-spec-a1.md') == '27d0dd6eead6a83a689665c57a9f79cce0710f0095b157cf68d46e169ebf206f'
assert sha('audit-tools/finance-csv-export-test.py') == '799a021af80bd77e4794e6743f0f0ad36eec402b78455fd4015f53b816cbac7e'
assert sha('reports/finance-csv-export-test-independent-review.md') == 'cb39de678e2982d56a29c48c7c6de167401e8def1491a16da751d3b9e5fddaa3'
assert sha('reports/finance-csv-clock-fixture-review.md') == '310301cb4e65e550f4eb4a5b64ad73c0390dda91861c9d97b89950aa110728c3'
first = 'sandbox/results/finance-csv-red-a1/'
rows1 = json.loads((ROOT / (first + 'results.json')).read_text('utf-8'))
assert len(rows1) == 1 and rows1[0]['name'] == 'csv-export-control' and rows1[0]['exitCode'] == 1
log1 = (ROOT / (first + 'csv-export-control.log')).read_text('utf-8')
assert "KeyError: '__import__'" in log1 and 'FAILED (errors=1)' in log1 and 'Ran 1 test' in log1
run = 'sandbox/results/finance-csv-red-a2/'
rows = json.loads((ROOT / (run + 'results.json')).read_text('utf-8'))
assert [(row['name'], row['exitCode']) for row in rows] == [('csv-export-control', 0), ('csv-export-contract', 1)]
control = (ROOT / (run + 'csv-export-control.log')).read_text('utf-8')
full = (ROOT / (run + 'csv-export-contract.log')).read_text('utf-8')
assert 'Ran 1 test' in control and '\nOK\n' in control.replace('\r\n', '\n')
assert 'Ran 6 tests' in full and 'FAILED (failures=83)' in full and not re.search(r'^ERROR:', full, re.M)
failed_names = set(re.findall(r'^FAIL: (test_\w+) ', full, re.M))
assert failed_names == {'test_F01_form_reachable_purpose_is_literal_text_not_formula', 'test_F02_export_text_columns_neutralize_literal_prefix_vectors'}
assert len(re.findall(r'^FAIL:', full, re.M)) == 83
for name in ['test_F03_numeric_negative_zero_and_two_decimal_values_keep_numeric_text', 'test_F04_plain_text_and_original_dict_rows_remain_unchanged', 'test_F05_query_failure_cannot_return_a_successful_csv', 'test_H00_actual_export_normal_unicode_csv_and_response_boundary']:
    assert re.search(r'^' + name + r'.* \.\.\. ok\s*$', full, re.M)
source_line = json.loads(full.splitlines()[0])
assert source_line['sourceSha256'] == '4048318fe44ef7fc321653f31cc80807390da356fa854607070858dd8f112c76'
files = [first + 'results.json', first + 'csv-export-control.log', run + 'results.json', run + 'csv-export-control.log', run + 'csv-export-contract.log',
         'sandbox/results/finance-csv-red-a1-applied.json', 'sandbox/results/finance-csv-red-a2-applied.json',
         'audit-tools/qa-history/finance-csv-export-test-a1.py', 'audit-tools/qa-history/finance-csv-export-spec-a1.md',
         'audit-tools/finance-csv-export-test.py', 'audit-tools/finance-csv-export-spec.md',
         'reports/finance-csv-export-test-independent-review.md', 'reports/finance-csv-clock-fixture-review.md']
evidence = {
    'version': 1, 'purpose': 'two actual source CSV exports RED after clock fixture correction',
    'actualOfflineGuest': True, 'sourceBeforeSha256': source_line['sourceSha256'],
    'firstAttempt': {'scope': 'H00 only', 'actualExitCode': 1, 'tests': 1, 'errors': 1, 'productRed': False, 'fullSixExecuted': False},
    'secondAttempt': {'controlActualExitCode': 0, 'fullActualExitCode': 1, 'topLevelCases': 6, 'passedTopLevelCases': 4,
                      'casesWithFailures': sorted(failed_names), 'subtestAssertionFailures': 83, 'errors': 0},
    'issueCountClaimed': 1, 'sourceExportsAffected': ['expenses_export', 'payroll_export'],
    'realOfficeExecutionOrResaveVerified': False, 'databaseOpenedOrMutated': False, 'productionChanged': False,
    'hashes': {name: sha(name) for name in files},
}
with (ROOT / 'audit-evidence/finance-csv-red-20261016.json').open('x', encoding='utf-8', newline='\n') as stream:
    json.dump(evidence, stream, ensure_ascii=False, indent=2)
    stream.write('\n')
section = '''## 2026-10-16 财务两CSV出口真实RED，最小修复已授权

原55夹具实际a1仅H00=1 ERROR（C date.strftime在受限namespace找__import__），完整6项按门禁未运行；不当产品RED。原55/spec27/cb39独审报告与日志归档保留。新799仅用测试模块Python clock wrapper委托真实固定date.strftime，业务BUILTINS/AST限制/6测试正文/81向量未改，未给业务导入权限。

Root实际a2先H00=1/1 PASS，再完整6：H00/F03/F04/F05四控制通过，F01/F02两目标不符；83条subtest assertion failures、0 error。普通purpose的=1+1及工资同类文本原样进入真实CSV函数正文；不是83个独立BUG，也不是HTTP保存或真实Office攻击测试。原字典/数值/Unicode/列结构/query故障控制保留。证据audit-evidence/finance-csv-red-20261016.json。

Root仅授权finance.py小纯文本出口helper＋两CSV数据行接线，账目原文/经营公式/负数真实数值/权限/查询/模板/数据库不改；原799和旧测试冻结，产品尚待GREEN。预制Python EXE未重建，不能把源码修复或此前build9 JS通过写成正式二进制已更新。所有操作限隔离，正式数据库未打开或修改。
'''
for name in ['PROJECT_CONTEXT.md', 'ARCHITECTURE.md', 'AUDIT_REPORT.md', 'OPTIMIZATION_PLAN.md', 'TEST_REPORT.md', 'HANDOFF.md', 'CHANGELOG.md', 'FINANCIAL_AUDIT.md']:
    file = ROOT / name
    original = file.read_text('utf-8')
    assert section.split('\n')[0] not in original
    title, rest = original.split('\n', 1)
    file.write_bytes((title + '\n\n' + section + '\n' + rest.lstrip('\n')).encode('utf-8'))
print(json.dumps({'control': 'PASS', 'cases': 6, 'topLevelWithFailures': 2, 'subtestFailures': 83, 'errors': 0, 'productionChanged': False}))
