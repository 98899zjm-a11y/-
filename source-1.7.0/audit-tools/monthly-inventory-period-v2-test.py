"""Guest-only synthetic monthly inventory projection contracts.

Root owns execution. Only named inventory AST definitions execute, with a
query-only in-memory SQLite fixture and explicit render/request ports. No app,
opaque pyc, EXE, original workbook, production path or business import runs.
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PYTHON = Path('C:/Python314/python.exe')
if (os.name != 'nt' or os.path.normcase(str(ROOT)) != os.path.normcase('C:/xjy-work/xjy-web-stage1') or
        os.path.normcase(sys.executable) != os.path.normcase(str(PYTHON)) or
        not sys.flags.isolated or not sys.flags.no_site or not sys.flags.dont_write_bytecode or sys.flags.optimize):
    raise RuntimeError('Fixed actual Guest Python -I -B -S required; no Host import/run')

import argparse
import ast
import calendar
import contextlib
import copy
import csv
import datetime
from decimal import Decimal, InvalidOperation
import hashlib
import importlib.util
import inspect
import io
import json
import math
import re
import sqlite3
import stat
import types
import unittest

SELF = ROOT / 'audit-tools/monthly-inventory-period-v2-test.py'
SOURCE = ROOT / 'project/desktop/legacy-source/ledger/inventory_dashboard.py'
GUARD = ROOT / 'stage1/sandbox-context.py'
VALIDATOR = ROOT / 'stage1/validate-sandbox-context.py'
GUARD_SHA = '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249'
VALIDATOR_SHA = '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207'
PYTHON_SHA = '434b361fe0c5960d404974feed493db47f2603a1ace2574312104fbed0182c6f'
BASELINE_SOURCE_SHA = '5a2616a55beadf3a4b89c380074e83daa0fb2e99c3b639d01e2df56cf34101ad'
SELECTED = ('inventory_state', 'platinum_identity', '_grams', '_thresholds', 'snapshot',
            '_sales', 'dashboard', '_month', '_stock_rows', 'stock_index', 'export_stock')
SCOPE_FIELDS = {'mode', 'month', 'available_months', 'complete', 'excluded_count',
                'unassigned_count', 'conflicts', 'message'}
BODY = None


def sha(body):
    return hashlib.sha256(body).hexdigest()


def read(file, limit=1024 * 1024):
    for parent in (file, *file.parents):
        info = parent.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
            raise RuntimeError('Ordinary non-reparse source/runtime required')
        if stat.S_ISREG(info.st_mode) and info.st_nlink != 1:
            raise RuntimeError('No hardlinked source/runtime')
    if not file.is_file() or file.stat().st_size > limit:
        raise RuntimeError('Bounded ordinary source/runtime required')
    return file.read_bytes()


def no_f_open(event, arguments):
    if event == 'open' and arguments and isinstance(arguments[0], (str, bytes, os.PathLike)):
        if re.search(r'(^|[/?:])f:', os.fsdecode(arguments[0]).replace('\\', '/').lower()):
            raise RuntimeError('Production content open forbidden')


class FrozenDate(datetime.date):
    @classmethod
    def today(cls):
        return cls(2026, 10, 20)


class ResponsePort:
    def __init__(self, data, content_type=None, headers=None):
        self.data, self.content_type, self.headers = data, content_type, headers or {}


def bounds(month):
    if not isinstance(month, str) or not re.fullmatch(r'[1-9]\d{3}-(?:0[1-9]|1[0-2])', month):
        raise ValueError('Explicit YYYY-MM required')
    year, mon = map(int, month.split('-'))
    return month + '-01', month + '-' + str(calendar.monthrange(year, mon)[1])


class ConnectionPort:
    """Preserve one owned fixture across contextlib.closing calls."""
    def __init__(self, connection):
        self.connection = connection

    def execute(self, *args, **kwargs):
        return self.connection.execute(*args, **kwargs)

    def close(self):
        pass


def subject(connection, args=None):
    tree = ast.parse(BODY, filename=str(SOURCE))
    definitions = []
    for name in SELECTED:
        found = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == name]
        if len(found) != 1:
            raise RuntimeError('One named source definition required: ' + name)
        node = copy.deepcopy(found[0])
        node.decorator_list = []  # Select function behavior, never route registration.
        definitions.append(node)
    module = ast.fix_missing_locations(ast.Module(body=definitions, type_ignores=[]))
    for node in ast.walk(module):
        if isinstance(node, (ast.Import, ast.ImportFrom, ast.ClassDef, ast.AsyncFunctionDef)):
            raise RuntimeError('Only selected definitions may execute')
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in ('exec', 'eval', 'compile', '__import__', 'open', 'input'):
            raise RuntimeError('Executable or unreviewed IO port in selected behavior')
    port = ConnectionPort(connection)
    query = lambda sql, values=(), one=False: connection.execute(sql, values).fetchone() if one else connection.execute(sql, values).fetchall()
    namespace = {'__name__': 'monthly_inventory_selected', 'contextlib': contextlib, 'Decimal': Decimal,
                 'InvalidOperation': InvalidOperation, 're': re, 'sqlite3': sqlite3, 'json': json,
                 'csv': csv, 'io': io, 'math': math,
                 'datetime': types.SimpleNamespace(date=FrozenDate), 'STATES': ('在库', '在途', '已售', '待确认'),
                 'db': types.SimpleNamespace(now_str=lambda: '2026-10-20 12:00:00', connect=lambda: port, query=query),
                 'finance': types.SimpleNamespace(month_bounds=bounds, csv_export_cell=lambda value: str(value)),
                 'rules': types.SimpleNamespace(compute=lambda domain, values: ({'经营结余': values['销售利润'] - values['工资成本'] - values['报销费用']}, 0)),
                 'request': types.SimpleNamespace(args=args or {}), 'Response': ResponsePort,
                 'fmt2': lambda value: format(Decimal(str(value)).quantize(Decimal('0.01')), 'f'),
                 'auth': types.SimpleNamespace(current_user=lambda: {'role': 'admin'}),
                 'r': types.SimpleNamespace(row_token=lambda table, row: 'SYNTHETIC_TOKEN', preserve_choices=lambda first, second: first),
                 'render_template': lambda name, **values: {'template': name, **values}}
    exec(compile(module, str(SOURCE), 'exec', dont_inherit=True, optimize=0), namespace)
    return namespace


def item(identifier, *, weight=10, remark='在库', sell_date='', in_date='2023-01-02', cost=100,
         product='PT950合成链', order_no='SYNTHETIC-SAME'):
    return {'id': identifier, 'seq': identifier, 'in_date': in_date, 'order_no': order_no,
            'category': '铂金', 'product': product, 'weight': weight, 'cost': cost,
            'sell_price': 120, 'profit_c': 20, 'sell_date': sell_date, 'seller': '虚构员工',
            'remark': remark, 'supplier': '虚构供应商', 'note': '', 'rule_version': 0}


@contextlib.contextmanager
def fixture(records, observations=(), metadata=True):
    """Observations: (ledger_id or None, document_id, explicit sheet)."""
    connection = sqlite3.connect(':memory:')
    connection.row_factory = sqlite3.Row
    connection.execute('CREATE TABLE stock_items(id INTEGER PRIMARY KEY,seq INTEGER,in_date TEXT,order_no TEXT,category TEXT,product TEXT,weight REAL,cost REAL,sell_price REAL,profit_c REAL,sell_date TEXT,seller TEXT,remark TEXT,supplier TEXT,note TEXT,rule_version INTEGER)')
    columns = list(item(1))
    connection.executemany('INSERT INTO stock_items VALUES(' + ','.join('?' for _ in columns) + ')',
                           ([record[key] for key in columns] for record in records))
    connection.execute('CREATE TABLE categories(id INTEGER PRIMARY KEY,name TEXT,active INTEGER,sort INTEGER)')
    connection.execute('CREATE TABLE suppliers(id INTEGER PRIMARY KEY,name TEXT,active INTEGER,sort INTEGER)')
    connection.execute('CREATE TABLE sales(id INTEGER,date TEXT,staff TEXT,amount_c REAL,received REAL,cost REAL,profit_c REAL,comm_c REAL,comm_profit_c REAL,weight REAL)')
    connection.executemany('INSERT INTO sales VALUES(?,?,?,?,?,?,?,?,?,?)', [
        (1, '2026-09-03', '虚构员工', 100, 100, 80, 20, 1, 19, 1),
        (2, '2026-10-03', '虚构员工', 120, 120, 90, 30, 2, 28, 2)])
    connection.execute('CREATE TABLE payroll_records(month TEXT,status TEXT,outputs_json TEXT)')
    connection.execute('CREATE TABLE expenses(date TEXT,status TEXT,amount REAL)')
    if metadata:
        connection.execute('CREATE TABLE source_rows(id INTEGER PRIMARY KEY,document_id INTEGER,sheet TEXT,row_no INTEGER,kind TEXT)')
        connection.execute('CREATE TABLE source_links(id INTEGER PRIMARY KEY,source_row_id INTEGER,part TEXT,ledger_table TEXT,ledger_id INTEGER,expected_json TEXT)')
        for sid, (rid, doc, sheet) in enumerate(observations, 1):
            connection.execute('INSERT INTO source_rows VALUES(?,?,?,?,?)', (sid, doc, sheet, sid + 2, 'stock'))
            if rid is not None:
                connection.execute('INSERT INTO source_links VALUES(?,?,?,?,?,?)', (sid, sid, 'record', 'stock_items', rid, '{}'))
    connection.commit()
    before = tuple(connection.iterdump())
    changes = connection.total_changes
    connection.execute('PRAGMA query_only=ON')
    allowed = {sqlite3.SQLITE_SELECT, sqlite3.SQLITE_READ, sqlite3.SQLITE_FUNCTION,
               sqlite3.SQLITE_TRANSACTION, sqlite3.SQLITE_RECURSIVE}
    connection.set_authorizer(lambda action, *unused: sqlite3.SQLITE_OK if action in allowed else sqlite3.SQLITE_DENY)
    try:
        yield connection
    finally:
        connection.set_authorizer(None)
        if connection.total_changes != changes or tuple(connection.iterdump()) != before:
            raise AssertionError('Read-only projection changed the synthetic database')
        connection.close()


class MonthlyInventory(unittest.TestCase):
    def api(self, connection, args=None):
        api = subject(connection, args)
        self.assertIn('month', inspect.signature(api['snapshot']).parameters,
                      'MONTHLY_PROJECTION_REQUIRED: snapshot still has no explicit month')
        return api

    def scope(self, result, mode, month):
        self.assertEqual(set(result['scope']), SCOPE_FIELDS)
        self.assertEqual(result['scope']['mode'], mode)
        self.assertEqual(result['scope']['month'], month)
        self.assertIsInstance(result['scope']['message'], str)
        return result['scope']

    def test_M01_selected_month_does_not_add_previous_snapshot_or_cost(self):
        with fixture([item(1), item(2)], [(1, 1, '2026年9月库存'), (2, 1, '2026年10月库存')]) as c:
            api = self.api(c); result = api['snapshot'](c, '2026-10')
            self.assertEqual([row['id'] for row in result['rows']], [2])
            self.assertEqual(result['in_stock']['fine_grams'], 9.5)
            self.assertEqual(sum(row['cost'] for row in result['rows']), 100)
            scope = self.scope(result, 'monthly', '2026-10')
            self.assertEqual(scope['available_months'], ['2026-09', '2026-10'])
            self.assertEqual((scope['complete'], scope['excluded_count'], scope['unassigned_count']), (True, 1, 0))
            self.assertEqual([row['id'] for row in api['snapshot'](c, '2026-09')['rows']], [1])

    def test_M02_old_entry_date_is_kept_but_previous_in_stock_copy_does_not_survive_sale(self):
        rows = [item(1), item(2, remark='已售；未完结', sell_date='2026-10-02'), item(3, weight=20, in_date='2021-12-01')]
        with fixture(rows, [(1, 1, '2026年9月'), (2, 1, '2026年10月'), (3, 1, '2026年10月')]) as c:
            result = self.api(c)['snapshot'](c, '2026-10')
            self.assertEqual([row['id'] for row in result['rows']], [2, 3])
            self.assertEqual((result['overall']['in_stock']['count'], result['overall']['sold']['count']), (1, 1))
            self.assertEqual(result['in_stock']['fine_grams'], 19)
            self.assertEqual(result['rows'][1]['in_date'], '2021-12-01')
            self.assertEqual(result['rows'][0]['cost'], 100, 'Projection cannot rewrite a sold/unsettled record or its original cost')

    def test_M03_explicit_sheet_year_and_dot_month_are_authoritative(self):
        with fixture([item(1), item(2), item(3)], [(1, 1, '2025年12月库存'), (2, 1, '2026.1月库存'), (3, 1, '2026.2月库存')]) as c:
            result = self.api(c)['snapshot'](c, '2026-01')
            self.assertEqual([row['id'] for row in result['rows']], [2])
            self.assertEqual(result['scope']['available_months'], ['2025-12', '2026-01', '2026-02'])

    def test_M04_default_is_current_month_and_never_latest_sales_month(self):
        with fixture([item(1), item(2)], [(1, 1, '2026年9月库存'), (2, 1, '2026年10月库存')]) as c:
            api = self.api(c)
            self.assertEqual([row['id'] for row in api['snapshot'](c)['rows']], [2])
            api['db'].query = lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError('Default inventory period cannot query sales history'))
            self.assertEqual(api['_month'](), '2026-10')

    def test_M05_identical_product_and_blank_order_do_not_merge_distinct_items(self):
        with fixture([item(1, order_no=''), item(2, order_no='')], [(1, 1, '2026年10月饰品'), (2, 1, '2026年10月板料')]) as c:
            result = self.api(c)['snapshot'](c, '2026-10')
            self.assertEqual([row['id'] for row in result['rows']], [1, 2])
            self.assertEqual(result['overall']['in_stock']['count'], 2)
            self.assertTrue(result['scope']['complete'])

    def test_M06_unimported_reference_sheet_does_not_enter_scope_and_unassigned_rows_are_visible(self):
        with fixture([item(1), item(2), item(3)], [(1, 1, '2026年10月库存'), (None, 2, '2026年11月参考'), (3, 1, '库存平面参考')]) as c:
            result = self.api(c)['snapshot'](c, '2026-10')
            self.assertEqual([row['id'] for row in result['rows']], [1])
            scope = self.scope(result, 'monthly', '2026-10')
            self.assertEqual(scope['available_months'], ['2026-10'])
            self.assertEqual((scope['unassigned_count'], scope['excluded_count'], scope['complete']), (2, 2, False))

    def test_M07_missing_month_is_empty_and_does_not_fall_back_to_older_inventory(self):
        with fixture([item(1)], [(1, 1, '2026年9月库存')]) as c:
            result = self.api(c)['snapshot'](c, '2026-10')
            self.assertEqual(result['rows'], [])
            self.assertFalse(self.scope(result, 'missing', '2026-10')['complete'])
            self.assertEqual(result['scope']['available_months'], ['2026-09'])

    def test_M08_two_booked_documents_for_one_month_fail_closed(self):
        with fixture([item(1), item(2)], [(1, 1, '2026年10月库存'), (2, 2, '2026年10月库存')]) as c:
            result = self.api(c)['snapshot'](c, '2026-10')
            self.assertEqual(result['rows'], [])
            scope = self.scope(result, 'needs_source', '2026-10')
            self.assertFalse(scope['complete']); self.assertIn('MULTIPLE_DOCUMENTS', scope['conflicts'])

    def test_M09_shared_ledger_id_is_counted_once_but_not_claimed_as_complete_history(self):
        with fixture([item(1)], [(1, 1, '2026年9月库存'), (1, 1, '2026年10月库存')]) as c:
            result = self.api(c)['snapshot'](c, '2026-10')
            self.assertEqual([row['id'] for row in result['rows']], [1])
            self.assertFalse(result['scope']['complete'])
            self.assertIn('SHARED_PERIOD_RECORD', result['scope']['conflicts'])

    def test_M10_legacy_stock_only_database_and_plain_sources_keep_flat_mode(self):
        for metadata, observations in [(False, []), (True, [(1, 1, '库存台账')])]:
            with self.subTest(metadata=metadata), fixture([item(1), item(2)], observations, metadata) as c:
                result = self.api(c)['snapshot'](c, '2026-10')
                self.assertEqual([row['id'] for row in result['rows']], [1, 2])
                self.assertTrue(self.scope(result, 'legacy_flat', '2026-10')['complete'])

    def test_M11_invalid_or_yearless_periods_cannot_invent_a_year_or_month(self):
        for sheet in ['库存10月', '2026年13月库存', '2026年0月库存']:
            with self.subTest(sheet=sheet), fixture([item(1)], [(1, 1, sheet)]) as c:
                result = self.api(c)['snapshot'](c, '2026-10')
                self.assertEqual(result['rows'], [])
                self.assertFalse(self.scope(result, 'needs_period', '2026-10')['complete'])
                self.assertEqual(result['scope']['unassigned_count'], 1)
        with fixture([item(1)], [(1, 1, '2026年10月库存')]) as c:
            result = self.api(c)['snapshot'](c, '2026-13')
            self.assertEqual(result['rows'], [])
            self.assertFalse(self.scope(result, 'invalid_month', '2026-13')['complete'])

    def test_M12_dashboard_page_and_csv_use_the_same_explicit_month_without_changing_sales_cost(self):
        with fixture([item(1, cost=50), item(2, cost=100)], [(1, 1, '2026年9月库存'), (2, 1, '2026年10月库存')]) as c:
            api = self.api(c, {'month': '2026-10', 'state': '在库'})
            dashboard = api['dashboard']('2026-10')
            self.assertEqual([row['id'] for row in dashboard['inventory']['rows']], [2])
            self.assertEqual((dashboard['sales']['cost'], dashboard['sales']['profit']), (90, 30))
            page = api['stock_index']()
            self.assertEqual([row['id'] for row in page['rows']], [2])
            self.assertEqual(page['sumr']['cost'], 100)
            response = api['export_stock']()
            exported = list(csv.reader(io.StringIO(response.data.lstrip('\ufeff'))))
            self.assertEqual(len(exported), 2)
            self.assertEqual(exported[1][0], '2')
            self.assertEqual(exported[1][6], '100.00')


def main():
    global BODY
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--source-sha256', required=True)
    parser.add_argument('--subject-sha256', required=True)
    args = parser.parse_args()
    if not all(re.fullmatch('[a-f0-9]{64}', value) for value in (args.source_sha256, args.subject_sha256)):
        raise RuntimeError('Explicit Root test/subject pins required')
    if sha(read(SELF)) != args.source_sha256 or sha(read(PYTHON)) != PYTHON_SHA:
        raise RuntimeError('Pinned test or public runtime changed')
    if sha(read(GUARD)) != GUARD_SHA or sha(read(VALIDATOR)) != VALIDATOR_SHA:
        raise RuntimeError('Original actual Guest admission changed')
    if sys.version_info[:3] != (3, 14, 8) or importlib.util.MAGIC_NUMBER.hex() != '2b0e0d0a':
        raise RuntimeError('Fixed actual Guest Python 3.14.8 required')
    guard = types.ModuleType('monthly_inventory_actual_context')
    guard.__file__ = str(GUARD)
    exec(compile(read(GUARD), str(GUARD), 'exec', dont_inherit=True, optimize=0), guard.__dict__)
    admission = guard.read_context(ROOT)
    BODY = read(SOURCE)
    if sha(BODY) != args.subject_sha256:
        raise RuntimeError('Root-pinned inventory source changed')
    sys.addaudithook(no_f_open)
    print(json.dumps({'purpose': 'monthly-inventory-period-contracts', 'admission': admission,
                      'testSourceSha256': args.source_sha256, 'subjectSourceSha256': args.subject_sha256,
                      'baselineSourceSha256': BASELINE_SOURCE_SHA, 'tests': 12,
                      'businessImported': False, 'originalDdlVerified': False,
                      'realDataReadOrChanged': False, 'fixture': 'query-only-memory-sqlite'}, ensure_ascii=False), flush=True)
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(MonthlyInventory))
    print(json.dumps({'testsRun': result.testsRun, 'failures': len(result.failures), 'errors': len(result.errors),
                      'passed': result.wasSuccessful(), 'realDataReadOrChanged': False}), flush=True)
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    raise SystemExit(main())
