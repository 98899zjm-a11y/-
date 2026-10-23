"""Round 2 selected-source contracts, NOT original HTTP/service acceptance.

Root alone executes after actual offline Guest handback. No app/pyc/business
imports or file-backed SQLite. Original month/payroll/sidecar definitions are
selected from SHA-pinned source. Repairs, rules, signer and rendering are explicit
ports; synthetic rule outputs are markers, not financial formulas. The signer
port only accepts tokens issued by the selected snapshot function in this run.
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PYTHON = Path('C:/Python314/python.exe')
if (os.name != 'nt' or os.path.normcase(str(ROOT)) != os.path.normcase('C:/xjy-work/xjy-web-stage1') or
        os.path.normcase(sys.executable) != os.path.normcase(str(PYTHON)) or
        not sys.flags.isolated or not sys.flags.no_site or not sys.flags.dont_write_bytecode or sys.flags.optimize):
    raise RuntimeError('Fixed actual Guest Python -I -B -S required; Host execution refused')

import argparse
import ast
import calendar
import contextlib
import copy
import datetime
import hashlib
import importlib.util
import json
import re
import sqlite3
import stat
import types
import unittest
import uuid

SELF = 'audit-tools/finance-erp-round2-contract.test.py'
PYTHON_SHA = '434b361fe0c5960d404974feed493db47f2603a1ace2574312104fbed0182c6f'
GUARDS = {
    'stage1/sandbox-context.py': '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
    'stage1/validate-sandbox-context.py': '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207',
}
PINS = {
    'project/desktop/legacy-source/ledger/finance.py': '56bcb389a21ada8c5d650e6f7ea1e81781b446f3af0a4e9b19e019930df63096',
    'project/desktop/legacy-source/ledger/sidecar.py': '9f4dddb973609100fed52e4f3c0ec941186c89644fcf68ad27509c0512bb8d1e',
}
BODIES = {}


def checked_read(file, limit=1024 * 1024):
    for parent in (file, *file.parents):
        info = parent.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
            raise RuntimeError('Ordinary non-reparse source/runtime required')
        if stat.S_ISREG(info.st_mode) and info.st_nlink != 1:
            raise RuntimeError('Hardlinked source/runtime refused')
    before = file.stat()
    identity = lambda v: (v.st_dev, v.st_ino, v.st_size, v.st_mtime_ns, v.st_ctime_ns, v.st_nlink)
    if not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= limit:
        raise RuntimeError('Bounded ordinary source/runtime required')
    with file.open('rb') as stream:
        opened = os.fstat(stream.fileno())
        if any(getattr(before, key) != getattr(opened, key) for key in ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_nlink')):
            raise RuntimeError('Source/runtime changed before open')
        body = stream.read(limit + 1)
        if len(body) != before.st_size or identity(os.fstat(stream.fileno())) != identity(opened):
            raise RuntimeError('Source/runtime changed while reading')
    if identity(file.lstat()) != identity(before):
        raise RuntimeError('Source/runtime changed after read')
    return body


def boundary(event, args):
    if event == 'sqlite3.connect' and args != (':memory:',):
        raise RuntimeError('Only synthetic in-memory SQLite permitted')
    if event == 'open' and args and isinstance(args[0], (str, bytes, os.PathLike)):
        if re.search(r'(^|[/?:])f:', os.fsdecode(args[0]).replace('\\', '/').lower()):
            raise RuntimeError('Production content open forbidden')


def selected(name, functions, ports, constants=()):
    tree = ast.parse(BODIES['project/desktop/legacy-source/ledger/' + name])
    nodes = []
    for key in functions:
        found = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == key]
        if len(found) != 1: raise RuntimeError('One exact source definition required: ' + key)
        node = copy.deepcopy(found[0]); node.decorator_list = []; nodes.append(node)
    for key in constants:
        found = [n for n in tree.body if isinstance(n, ast.Assign) and len(n.targets) == 1 and isinstance(n.targets[0], ast.Name) and n.targets[0].id == key]
        if len(found) != 1: raise RuntimeError('One literal source constant required: ' + key)
        ports[key] = ast.literal_eval(found[0].value)
    module = ast.fix_missing_locations(ast.Module(body=nodes, type_ignores=[]))
    for node in ast.walk(module):
        if isinstance(node, (ast.Import, ast.ImportFrom, ast.AsyncFunctionDef, ast.AsyncWith)):
            raise RuntimeError('Import/IO scope in selected source refused')
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in ('exec', 'eval', 'compile', '__import__', 'open', 'input'):
            raise RuntimeError('Unreviewed IO in selected source refused')
    namespace = {'__name__': 'finance_erp_round2_selected', **ports}
    exec(compile(module, name, 'exec', dont_inherit=True, optimize=0), namespace)
    return types.SimpleNamespace(**namespace)


class Conflict(ValueError): pass


class IssuedSigner:
    def __init__(self): self.tokens = {}
    def dumps(self, value):
        token = 'issued-' + str(len(self.tokens)); self.tokens[token] = copy.deepcopy(value); return token
    def loads(self, token): return copy.deepcopy(self.tokens[token])


@contextlib.contextmanager
def payroll_fixture():
    connection = sqlite3.connect(':memory:'); connection.row_factory = sqlite3.Row
    signer = IssuedSigner(); flashes = []
    digest = lambda value: hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    @contextlib.contextmanager
    def transaction():
        try: yield connection; connection.commit()
        except BaseException: connection.rollback(); raise
    def write(c, table, values, old):
        if table != 'payroll_records': raise AssertionError('Unexpected write port')
        if old:
            c.execute('UPDATE payroll_records SET ' + ','.join(key + '=?' for key in values) + ' WHERE id=?', (*values.values(), old['id']))
            return old['id']
        complete = {'created_at': '2026-10-19 12:00:00', **values}
        return c.execute('INSERT INTO payroll_records(' + ','.join(complete) + ') VALUES(' + ','.join('?' for _ in complete) + ')', tuple(complete.values())).lastrowid
    request = types.SimpleNamespace(values={}, form={}, method='GET')
    rules = types.SimpleNamespace(MODES=('固定月薪',), rule=lambda *a, **k: {'id': 77},
                                  compute=lambda *a: ({'应发工资': 321.09, '工资扣款': 0, '实发工资': 321.09, '本次支付': 321.09}, 77))
    db = types.SimpleNamespace(names_of=lambda *a: ['虚构甲'], now_str=lambda: '2026-10-19 12:00:00',
                               query=lambda sql, args=(): connection.execute(sql, args).fetchall())
    repairs = types.SimpleNamespace(transaction=transaction, signer=lambda: signer, digest=digest, write_row=write,
                                    number=lambda value: float(value or 0), preserve_choices=lambda values, old: list(dict.fromkeys([*values, *old])), Conflict=Conflict)
    api = selected('finance.py', ('month_bounds', 'payroll_basis', 'salary_compute', 'snapshot', 'payroll'),
                   {'json': json, 'datetime': datetime, 'calendar': calendar, 'sqlite3': sqlite3, 'db': db, 'r': repairs,
                    'rules': rules, 'request': request, 'DEFAULT_INPUTS': {**{key: 0 for key in ('base', 'day_rate', 'days', 'percent', 'gram_rate', 'overtime_hours', 'overtime_rate', 'bonus', 'allowance', 'deductions', 'social', 'tax')}, 'mode': '固定月薪'},
                    'flash': lambda message, kind: flashes.append((kind, message)), 'render_template': lambda name, **values: values,
                    'url_for': lambda endpoint, **values: (endpoint, values), 'redirect': lambda location: location}, ('FIELDS', 'SCHEMA'))
    connection.executescript(api.SCHEMA + '''
      CREATE TABLE sales(id INTEGER,date TEXT,staff TEXT,received REAL,amount_c REAL,profit_c REAL,comm_c REAL,weight REAL,status TEXT);
      INSERT INTO sales VALUES(1,'2026-10-10','虚构甲',200,200,80,20,3,'已完成');
    ''')
    def invoke(month, method='GET', token=None):
        request.method = method; request.values = {'employee': '虚构甲', 'month': month}
        request.form = {**request.values, **{key: '0' for key in api.FIELDS}, 'mode': '固定月薪', 'act': 'save', 'snapshot': token or ''}
        return api.payroll()
    def save(month):
        preview = invoke(month)
        if not isinstance(preview, dict) or not preview.get('snapshot'): return preview
        return invoke(month, 'POST', preview['snapshot'])
    try: yield types.SimpleNamespace(c=connection, api=api, invoke=invoke, save=save, flashes=flashes)
    finally: connection.close()


class Multi(dict):
    def __init__(self, pairs):
        self.pairs = list(pairs); super().__init__()
        for key, value in pairs: self.setdefault(key, value)
    def getlist(self, key): return [value for name, value in self.pairs if name == key]


def authority():
    api = selected('sidecar.py', ('erp_authority',), {'re': re}, ('ERP_READ_ENDPOINTS', 'ERP_STATIC_FILES', 'ERP_UUID'))
    actor = {'protocolVersion': 2, 'module': 'ledger', 'capabilities': ['erp.read', 'erp.reports.view'], 'access': 'view'}
    def call(endpoint, pairs):
        request = types.SimpleNamespace(path='/erp/api/reports' if endpoint == 'erp.reports' else '/erp/api/export.xlsx',
                                        method='GET', endpoint=endpoint, args=Multi(pairs), content_type=None)
        return api.erp_authority(request, actor)
    return call


class Round2(unittest.TestCase):
    def test_M01_canonical_month_positive_leap_and_nonleap(self):
        with payroll_fixture() as f:
            for month, bounds in [('2026-01', ('2026-01-01', '2026-01-31')), ('2026-02', ('2026-02-01', '2026-02-28')), ('2028-02', ('2028-02-01', '2028-02-29'))]:
                with self.subTest(month=month): self.assertEqual(f.api.month_bounds(month), bounds)

    def test_M02_invalid_calendar_month_is_rejected(self):
        with payroll_fixture() as f:
            for month in ('2026-00', '2026-13', '2026-10-01'):
                with self.subTest(month=month), self.assertRaises(ValueError): f.api.month_bounds(month)

    def test_M03_canonical_preview_issued_token_and_repeat_save_use_one_record(self):
        with payroll_fixture() as f:
            f.save('2026-10'); first = dict(f.c.execute('SELECT * FROM payroll_records').fetchone())
            f.save('2026-10'); rows = [dict(row) for row in f.c.execute('SELECT * FROM payroll_records')]
            self.assertEqual(len(rows), 1); self.assertEqual(rows[0]['id'], first['id'])
            self.assertEqual(rows[0]['month'], '2026-10'); self.assertEqual(json.loads(rows[0]['basis_json'])['sales'][0]['id'], 1)

    def test_M04_month_alias_cannot_create_second_natural_month_payroll(self):
        for alias in ('2026-010', '02026-10', '+2026-10', '2026-10 '):
            with self.subTest(alias=alias), payroll_fixture() as f:
                f.save('2026-10'); f.save(alias)
                rows = [dict(row) for row in f.c.execute('SELECT * FROM payroll_records')]
                self.assertEqual(len(rows), 1, 'Reject alias or resolve the canonical record before query/snapshot/save')
                self.assertEqual(rows[0]['month'], '2026-10')

    def test_M05_january_unpadded_alias_cannot_create_second_payroll(self):
        with payroll_fixture() as f:
            f.save('2026-01'); f.save('2026-1')
            rows = [dict(row) for row in f.c.execute('SELECT * FROM payroll_records')]
            self.assertEqual(len(rows), 1); self.assertEqual(rows[0]['month'], '2026-01')

    def test_H01_sidecar_allows_single_report_and_export_filters(self):
        call = authority()
        for endpoint in ('erp.reports', 'erp.export'):
            with self.subTest(endpoint=endpoint): self.assertIsNone(call(endpoint, [('asOf', '2026-10-19'), ('status', 'confirmed')]))

    def test_H02_sidecar_rejects_duplicate_values_even_when_identical(self):
        call = authority()
        for endpoint in ('erp.reports', 'erp.export'):
            for key in ('asOf', 'from', 'to', 'partyId', 'kind', 'status', 'creatorId'):
                for values in (('first', 'second'), ('same', 'same')):
                    with self.subTest(endpoint=endpoint, key=key, values=values), self.assertRaises(ValueError): call(endpoint, [(key, values[0]), (key, values[1])])

    def test_H03_sidecar_rejects_unknown_filter(self):
        call = authority()
        for endpoint in ('erp.reports', 'erp.export'):
            with self.subTest(endpoint=endpoint), self.assertRaises(ValueError): call(endpoint, [('unreviewed', '1')])


def main():
    parser = argparse.ArgumentParser(allow_abbrev=False)
    parser.add_argument('--test-sha256', required=True); parser.add_argument('--expected-namespace', required=True)
    args = parser.parse_args()
    if not re.fullmatch('[a-f0-9]{64}', args.test_sha256) or str(uuid.UUID(args.expected_namespace)) != args.expected_namespace:
        raise RuntimeError('Exact Root self SHA and actual handback UUID namespace required')
    if hashlib.sha256(checked_read(ROOT / SELF)).hexdigest() != args.test_sha256: raise RuntimeError('Frozen test changed')
    if hashlib.sha256(checked_read(PYTHON)).hexdigest() != PYTHON_SHA or sys.version_info[:3] != (3, 14, 8) or importlib.util.MAGIC_NUMBER.hex() != '2b0e0d0a':
        raise RuntimeError('Fixed actual Guest runtime changed')
    bodies = {}
    for name, pin in GUARDS.items():
        bodies[name] = checked_read(ROOT / name)
        if hashlib.sha256(bodies[name]).hexdigest() != pin: raise RuntimeError('Original Guest admission changed')
    guard = types.ModuleType('finance_erp_round2_actual_context'); guard.__file__ = str(ROOT / 'stage1/sandbox-context.py')
    exec(compile(bodies['stage1/sandbox-context.py'], guard.__file__, 'exec', dont_inherit=True, optimize=0), guard.__dict__)
    proof = guard.read_context(ROOT)
    identity = json.loads(checked_read(ROOT / 'isolation-identity.json').decode('utf-8-sig'))
    if identity.get('namespace') != args.expected_namespace: raise RuntimeError('Actual handed-back namespace changed')
    for name, pin in PINS.items():
        BODIES[name] = checked_read(ROOT / name)
        if hashlib.sha256(BODIES[name]).hexdigest() != pin: raise RuntimeError('Frozen source changed: ' + name)
    sys.addaudithook(boundary)
    print(json.dumps({'purpose': 'finance-erp-round2-selected-source', 'actualContext': proof, 'namespace': args.expected_namespace,
                      'testSha256': args.test_sha256, 'sourcePins': PINS, 'methods': 8, 'originalHttpVerified': False,
                      'unknownRulesExecuted': False, 'fixture': 'synthetic-memory-sqlite-and-explicit-ports'}, ensure_ascii=False), flush=True)
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Round2))
    for name, pin in PINS.items():
        if hashlib.sha256(checked_read(ROOT / name)).hexdigest() != pin: raise RuntimeError('Source changed during tests')
    print(json.dumps({'testsRun': result.testsRun, 'failures': len(result.failures), 'errors': len(result.errors), 'passed': result.wasSuccessful(),
                      'originalHttpVerified': False, 'realDataReadOrChanged': False}), flush=True)
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__': raise SystemExit(main())
