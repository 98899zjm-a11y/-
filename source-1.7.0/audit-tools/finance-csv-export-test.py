"""Guest-only, six source-function CSV tests. Root alone executes this file.

The real expenses_export/payroll_export bodies are extracted by AST; only their
route/auth decorators are omitted. No finance/app/repairs/config/pyc import, SQL, file DB, server, Excel
or product process is used. Query rows and Response are explicit pure boundaries.
This does not test HTTP authentication, actual saving or Office formula execution.
"""

import ast
import copy
import csv
import datetime
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import stat
import sys
from types import SimpleNamespace
import unittest


ROOT = Path(__file__).resolve().parents[1]
if (os.name != 'nt' or os.path.normcase(str(ROOT)) != os.path.normcase('C:/xjy-work/xjy-web-stage1') or
        os.path.normcase(sys.executable) != os.path.normcase('C:/Python314/python.exe') or
        not sys.flags.isolated or not sys.flags.dont_write_bytecode or sys.flags.optimize):
    raise RuntimeError('CSV source tests require the fixed isolated actual Windows Sandbox')

GUARD_PINS = {
    'stage1/sandbox-context.py': '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
    'stage1/validate-sandbox-context.py': '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207',
}


def checked_bytes(relative, limit=1024 * 1024):
    file = ROOT / relative
    if not file.is_absolute() or not file.is_relative_to(ROOT):
        raise RuntimeError('CSV test source boundary refused')
    for current in (file, *file.parents):
        info = current.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
            raise RuntimeError('CSV test source link refused')
        if stat.S_ISREG(info.st_mode) and info.st_nlink != 1:
            raise RuntimeError('CSV test source hardlink refused')
        if current == ROOT:
            break
    before = file.stat()
    if not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= limit:
        raise RuntimeError('CSV test requires bounded ordinary source')
    identity = lambda value: (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns,
                              value.st_ctime_ns, value.st_nlink, getattr(value, 'st_birthtime_ns', None))
    with file.open('rb') as stream:
        opened = os.fstat(stream.fileno())
        common = ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_nlink')
        birth = (getattr(before, 'st_birthtime_ns', None), getattr(opened, 'st_birthtime_ns', None))
        if any(getattr(before, key) != getattr(opened, key) for key in common) or None not in birth and birth[0] != birth[1]:
            raise RuntimeError('CSV test source changed before open')
        body = stream.read(limit + 1)
        if len(body) != before.st_size or identity(os.fstat(stream.fileno())) != identity(opened):
            raise RuntimeError('CSV test source changed during read')
    after = file.lstat()
    if identity(after) != identity(before) or stat.S_ISLNK(after.st_mode) or getattr(after, 'st_file_attributes', 0) & 0x400:
        raise RuntimeError('CSV test source changed after read')
    return body


# Original actual admission precedes every business source parse/compile/eval.
# Its existing metadata subprocess.run(timeout=20) exception is unchanged; this
# test adds no subprocess, timeout-kill or alternate Host admission path.
reviewed_guards = {}
for relative, expected in GUARD_PINS.items():
    body = checked_bytes(relative)
    if hashlib.sha256(body).hexdigest() != expected:
        raise RuntimeError('Original actual Guest guard changed')
    reviewed_guards[relative] = body
guard_file = ROOT / 'stage1/sandbox-context.py'
guard_spec = importlib.util.spec_from_file_location('csv_source_actual_guard', guard_file)
guard_module = importlib.util.module_from_spec(guard_spec)
exec(compile(reviewed_guards['stage1/sandbox-context.py'], str(guard_file), 'exec'), guard_module.__dict__)
ACTUAL_GUEST = guard_module.read_context(ROOT)

SOURCE_RELATIVE = 'project/desktop/legacy-source/ledger/finance.py'
SOURCE_BODY = checked_bytes(SOURCE_RELATIVE)
SOURCE_SHA256 = hashlib.sha256(SOURCE_BODY).hexdigest()
SOURCE_TREE = ast.parse(SOURCE_BODY, filename=SOURCE_RELATIVE)
TARGETS = ('expenses_export', 'payroll_export')


class FixedDateValue:
    def strftime(self, pattern):
        # Keep C strftime in this test module's standard Python frame. Calling
        # date.strftime directly from the restricted source namespace makes its
        # internal import consult that namespace's intentionally absent hook.
        return datetime.date(2026, 10, 16).strftime(pattern)


class FixedDate:
    @staticmethod
    def today():
        return FixedDateValue()


# payroll_export evaluates the default month even when request.args supplies it.
# This explicit clock boundary prevents any real clock dependency in these tests.
MODULE_PORTS = {'csv': csv, 'io': io, 're': re, 'json': json,
                'datetime': SimpleNamespace(date=FixedDate)}
BUILTINS = {'str': str, 'isinstance': isinstance, 'type': type, 'object': object,
            'tuple': tuple, 'list': list, 'dict': dict, 'bool': bool, 'int': int,
            'float': float, 'len': len, 'enumerate': enumerate, 'range': range,
            'ValueError': ValueError, 'TypeError': TypeError}
PURE_ATTRIBUTES = {'writerow', 'writerows', 'getvalue', 'startswith', 'lstrip', 'strip',
                   'replace', 'casefold', 'lower', 'upper', 'append', 'get', 'items',
                   'keys', 'values', 'match', 'fullmatch', 'search', 'compile', 'escape',
                   'today', 'strftime'}


def extracted_code():
    """Resolve actual called helpers/literal constants without a required name.

    This supplemental allowlist is not an arbitrary-Python security sandbox.
    Root must still review the exact source and freeze its SHA before executing.
    """
    functions = {node.name: node for node in SOURCE_TREE.body if isinstance(node, ast.FunctionDef)}
    for target in TARGETS:
        if sum(isinstance(node, ast.FunctionDef) and node.name == target for node in SOURCE_TREE.body) != 1:
            raise RuntimeError('Unique actual export definition required: ' + target)
    imported = set()
    constants = {}
    for node in SOURCE_TREE.body:
        if isinstance(node, ast.Import):
            imported.update(alias.asname or alias.name for alias in node.names if alias.name in MODULE_PORTS)
        elif isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            constants[node.targets[0].id] = node
    selected, selected_constants, queue = {}, {}, list(TARGETS)
    while queue:
        name = queue.pop()
        if name in selected:
            continue
        original = functions[name]
        if name not in TARGETS and original.decorator_list:
            raise RuntimeError('Export helper must be a plain pure definition')
        node = copy.deepcopy(original)
        node.decorator_list = []
        selected[name] = node
        for item in ast.walk(node):
            if isinstance(item, (ast.Import, ast.ImportFrom, ast.Global, ast.Nonlocal,
                                 ast.With, ast.AsyncWith, ast.ClassDef, ast.AsyncFunctionDef)):
                raise RuntimeError('Business/import/IO scope in extracted export refused')
            if isinstance(item, ast.Attribute) and item.attr.startswith('__'):
                raise RuntimeError('Dunder reflection in extracted export refused')
            if isinstance(item, ast.Name) and item.id.startswith('__'):
                raise RuntimeError('Dunder namespace in extracted export refused')
            if isinstance(item, ast.Name) and isinstance(item.ctx, ast.Load):
                if item.id in functions and item.id not in selected:
                    queue.append(item.id)
                elif item.id in constants and item.id not in selected_constants:
                    value = ast.literal_eval(constants[item.id].value)
                    if not isinstance(value, (str, bytes, int, float, bool, tuple, list, dict, set, type(None))):
                        raise RuntimeError('Only literal export constants are admitted')
                    selected_constants[item.id] = copy.deepcopy(constants[item.id])
        if len(selected) > 8 or len(selected_constants) > 16:
            raise RuntimeError('Export pure dependency closure exceeded its fixed budget')
    for node in selected.values():
        for item in ast.walk(node):
            if not isinstance(item, ast.Call):
                continue
            if isinstance(item.func, ast.Name):
                if item.func.id not in selected and item.func.id not in BUILTINS and item.func.id != 'Response':
                    raise RuntimeError('Unreviewed export callable: ' + item.func.id)
            elif isinstance(item.func, ast.Attribute):
                owner = item.func.value.id if isinstance(item.func.value, ast.Name) else None
                if owner in ('io', 'csv', 'db', 're', 'json'):
                    allowed = {'io': {'StringIO'}, 'csv': {'writer'}, 'db': {'query'},
                               're': {'match', 'fullmatch', 'search', 'compile', 'escape'},
                               'json': {'loads'}}[owner]
                    if item.func.attr not in allowed or owner in MODULE_PORTS and owner not in imported:
                        raise RuntimeError('Export module IO/callable refused')
                elif item.func.attr not in PURE_ATTRIBUTES:
                    raise RuntimeError('Unreviewed export attribute call: ' + item.func.attr)
            else:
                raise RuntimeError('Indirect export callable refused')
    body = [*selected_constants.values(), *selected.values()]
    module = ast.fix_missing_locations(ast.Module(body=body, type_ignores=[]))
    return compile(module, str(ROOT / SOURCE_RELATIVE), 'exec'), {name: MODULE_PORTS[name] for name in imported}


EXPORT_CODE, EXPORT_MODULES = extracted_code()
HEADER = ['日期', '人员', '类别', '事由', '票据金额', '补贴', '个人承担', '报销金额', '支付方式', '状态', '规则版本']
SELECT = 'SELECT * FROM expenses ORDER BY date,id'
PAYROLL_HEADER = ['月份', '人员', '计薪方式', '应发工资', '扣款', '实发工资', '工资报销', '本次支付', '状态', '规则版本']
PAYROLL_SELECT = 'SELECT * FROM payroll_records WHERE month=? ORDER BY employee'


class SyntheticQueryFailure(RuntimeError):
    pass


class FixedRows:
    def __init__(self, rows, fail=False, kind='expenses', month='2026-10'):
        self.rows, self.fail, self.calls, self.kind, self.month = rows, fail, [], kind, month

    def query(self, sql, *args, **kwargs):
        expected_sql, expected_args = (SELECT, ()) if self.kind == 'expenses' else (PAYROLL_SELECT, ((self.month,),))
        if sql != expected_sql or args != expected_args or kwargs:
            raise AssertionError('Only the existing readonly export query is admitted')
        self.calls.append(sql)
        if self.fail:
            raise SyntheticQueryFailure('SYNTHETIC_CSV_QUERY_FAILURE')
        return self.rows  # Original dicts; do not hide mutation by returning copies.


class CapturedResponse:
    def __init__(self, body, status=200, headers=None, mimetype=None, **kwargs):
        if not isinstance(body, str) or type(status) is not int or kwargs:
            raise AssertionError('Unexpected Response boundary contract')
        self.body, self.status_code, self.headers, self.mimetype = body, status, dict(headers or {}), mimetype


class Execution:
    def __init__(self, rows, fail=False, kind='expenses', month='2026-10'):
        if kind not in ('expenses', 'payroll'):
            raise AssertionError('Only two actual CSV exports are admitted')
        self.db, self.responses = FixedRows(rows, fail, kind, month), []

        def response(*args, **kwargs):
            value = CapturedResponse(*args, **kwargs)
            self.responses.append(value)
            return value

        namespace = {'__builtins__': BUILTINS, **EXPORT_MODULES, 'db': self.db, 'Response': response,
                     'request': SimpleNamespace(args={'month': month})}
        exec(EXPORT_CODE, namespace)
        self.call = namespace['expenses_export' if kind == 'expenses' else 'payroll_export']


def row(**patch):
    return {'date': '2026-10-16', 'employee': '虚构员工甲', 'category': '交通', 'purpose': '虚构差旅',
            'ticket': 12.34, 'allowance': 0, 'personal': 0, 'amount': 12.34,
            'payout': '单独支付', 'status': '草稿', 'rule_version': 1, **patch}


def payroll_row(*, mode='底薪+原提成', outputs=None, **patch):
    values = {'应发工资': 12.34, '工资扣款': 0, '实发工资': 12.34, '本次支付': 12.34} if outputs is None else outputs
    return {'employee': '虚构员工甲', 'month': '2026-10', 'inputs_json': json.dumps({'mode': mode}, ensure_ascii=False),
            'outputs_json': json.dumps(values, ensure_ascii=False), 'status': '草稿', 'rule_version': 1, **patch}


def parsed(response):
    if not isinstance(response, CapturedResponse) or response.status_code != 200:
        raise AssertionError('Successful source export must use the declared Response boundary')
    if not response.body.startswith('\ufeff') or response.body.startswith('\ufeff\ufeff'):
        raise AssertionError('Exactly one UTF-8 BOM required')
    return list(csv.reader(io.StringIO(response.body[1:], newline='')))


class CsvExport(unittest.TestCase):
    def test_H00_actual_export_normal_unicode_csv_and_response_boundary(self):
        value = '中文，逗号,双引号"与换行\n下一行 Ω'
        record = row(purpose=value)
        execution = Execution([record])
        response = execution.call()
        data = parsed(response)
        self.assertEqual(response.mimetype, 'text/csv; charset=utf-8')
        self.assertEqual(response.headers, {'Content-Disposition': 'attachment; filename=expenses.csv'})
        self.assertEqual(response.body.encode('utf-8')[:3], b'\xef\xbb\xbf')
        self.assertEqual(data[0], HEADER)
        self.assertEqual(len(data), 2)
        self.assertEqual(len(data[1]), 11)
        self.assertEqual(data[1][1:4], ['虚构员工甲', '交通', value])
        self.assertEqual(execution.db.calls, [SELECT])
        self.assertEqual(len(execution.responses), 1)
        payroll_name = '虚构工资员工 Ω,双引号"'
        payroll = Execution([payroll_row(employee=payroll_name)], kind='payroll')
        payroll_response = payroll.call()
        salary = parsed(payroll_response)
        self.assertEqual(salary[0], PAYROLL_HEADER)
        self.assertEqual(len(salary[1]), 10)
        self.assertEqual(salary[1][:3], ['2026-10', payroll_name, '底薪+原提成'])
        self.assertEqual(payroll_response.mimetype, 'text/csv; charset=utf-8')
        self.assertEqual(payroll_response.headers, {'Content-Disposition': 'attachment; filename=payroll_2026-10.csv'})
        self.assertEqual(payroll.db.calls, [PAYROLL_SELECT])
        self.assertEqual(len(payroll.responses), 1)

    def test_F01_form_reachable_purpose_is_literal_text_not_formula(self):
        with self.subTest(kind='expenses'):
            data = parsed(Execution([row(purpose='=1+1')]).call())
            self.assertEqual(data[1][3], "'=1+1", 'CSV quoting alone does not neutralize the actual purpose field')
        with self.subTest(kind='payroll'):
            salary = parsed(Execution([payroll_row(employee='=1+1')], kind='payroll').call())
            self.assertEqual(salary[1][1], "'=1+1", 'The known second CSV export must not retain the same text defect')

    def test_F02_export_text_columns_neutralize_literal_prefix_vectors(self):
        # Literal expected values, independent of any proposed product helper.
        # Leading ASCII spaces are preserved after the one apostrophe prefix.
        vectors = [('=1+1', "'=1+1"), ('+1+1', "'+1+1"), ('-1+1', "'-1+1"),
                   ('@SUM(1,1)', "'@SUM(1,1)"), ('\t=1+1', "'\t=1+1"),
                   ('\r=1+1', "'\r=1+1"), ('\n=1+1', "'\n=1+1"),
                   (' =1+1', "' =1+1"), ('  +1+1', "'  +1+1"),
                   (' \t=1+1', "' \t=1+1")]
        for field, column in [('employee', 1), ('category', 2), ('purpose', 3), ('payout', 8), ('status', 9)]:
            for value, expected in vectors:
                with self.subTest(field=field, value=repr(value)):
                    self.assertEqual(parsed(Execution([row(**{field: value})]).call())[1][column], expected)
        for field, column in [('employee', 1), ('mode', 2), ('status', 8)]:
            for value, expected in vectors:
                with self.subTest(kind='payroll', field=field, value=repr(value)):
                    record = payroll_row(mode=value) if field == 'mode' else payroll_row(**{field: value})
                    self.assertEqual(parsed(Execution([record], kind='payroll').call())[1][column], expected)
        with self.subTest(kind='payroll', field='month'):
            # Export-only type contract. It does not assert that normal payroll
            # saving permits a non-calendar month, or pass CR/LF into a header.
            salary = parsed(Execution([payroll_row(month='=1+1')], kind='payroll', month='=1+1').call())
            self.assertEqual(salary[1][0], "'=1+1")

    def test_F03_numeric_negative_zero_and_two_decimal_values_keep_numeric_text(self):
        record = row(ticket=0, allowance=0.29, personal=12.34, amount=-12.34)
        data = parsed(Execution([record]).call())
        self.assertEqual(data[1][4:8], ['0', '0.29', '12.34', '-12.34'])
        self.assertEqual(data[1][10], '1')
        self.assertTrue(all(not value.startswith("'") for value in data[1][4:8]))
        # This is an export-type control, not approval to save negative expenses.
        salary = parsed(Execution([payroll_row(outputs={'应发工资': 0.29, '工资扣款': 0, '实发工资': 0, '本次支付': -12.34})], kind='payroll').call())
        self.assertEqual(salary[1][3:8], ['0.29', '0', '0', '-12.34', '-12.34'])
        self.assertEqual(salary[1][9], '1')
        self.assertTrue(all(not value.startswith("'") for value in salary[1][3:8]))

    def test_F04_plain_text_and_original_dict_rows_remain_unchanged(self):
        records = [row(employee='虚构乙 Ω', category='普通中文', purpose='普通,文字"\n下一行'),
                   row(employee=' -1+1', purpose='=1+1')]
        before = copy.deepcopy(records)
        raw_before = json.dumps(records, ensure_ascii=False, sort_keys=True, allow_nan=False)
        execution = Execution(records)
        first, second = parsed(execution.call()), parsed(execution.call())
        self.assertEqual(first, second)
        self.assertEqual(first[1][1:4], ['虚构乙 Ω', '普通中文', '普通,文字"\n下一行'])
        self.assertEqual(records, before)
        self.assertEqual(json.dumps(records, ensure_ascii=False, sort_keys=True, allow_nan=False), raw_before)
        self.assertEqual(execution.db.calls, [SELECT, SELECT])
        salary_records = [payroll_row(employee='普通工资员工 Ω'), payroll_row(employee='=1+1', mode='@SUM(1,1)')]
        salary_before = copy.deepcopy(salary_records)
        salary_raw = json.dumps(salary_records, ensure_ascii=False, sort_keys=True, allow_nan=False)
        payroll = Execution(salary_records, kind='payroll')
        first_salary, second_salary = parsed(payroll.call()), parsed(payroll.call())
        self.assertEqual(first_salary, second_salary)
        self.assertEqual(first_salary[1][1:3], ['普通工资员工 Ω', '底薪+原提成'])
        self.assertEqual(salary_records, salary_before)
        self.assertEqual(json.dumps(salary_records, ensure_ascii=False, sort_keys=True, allow_nan=False), salary_raw)
        self.assertEqual(payroll.db.calls, [PAYROLL_SELECT, PAYROLL_SELECT])

    def test_F05_query_failure_cannot_return_a_successful_csv(self):
        for kind, record, query in [('expenses', row(), SELECT), ('payroll', payroll_row(), PAYROLL_SELECT)]:
            with self.subTest(kind=kind):
                execution = Execution([record], fail=True, kind=kind)
                try:
                    response = execution.call()
                except SyntheticQueryFailure:
                    self.assertEqual(execution.responses, [])
                else:
                    self.assertIsInstance(response, CapturedResponse)
                    self.assertGreaterEqual(response.status_code, 400)
                self.assertEqual(execution.db.calls, [query])
                self.assertFalse(any(value.status_code < 400 for value in execution.responses))


if __name__ == '__main__':
    print(json.dumps({'scope': 'actual-Guest-source-function-only', 'sourceSha256': SOURCE_SHA256,
                      'databaseOrBusinessModuleImported': False, 'httpOrExcelVerified': False}), flush=True)
    unittest.main(verbosity=2)
