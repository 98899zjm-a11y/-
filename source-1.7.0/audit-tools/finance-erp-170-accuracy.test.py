"""Independent 1.7.0 financial accuracy contracts. Root alone executes.

FIXED ACTUAL GUEST ONLY: C:/xjy-work/xjy-web-stage1, C:/Python314/python.exe,
Python 3.14.8 -I -B -S, unchanged actual Windows Sandbox admission. Root must
first recover the real VM and namespace from the employee session handback.
--expected-namespace must be that real identity; it cannot admit a Host process.

Only exact pinned readable source definitions execute. No app, legacy pyc,
factory, EXE, business database, original workbook or production formula runs.
SQLite is synthetic :memory: only; there is no replacement of unknown rules.
Payroll/overview tests validate source selection and rule-call inputs, not the
current production formula_sets. Source selection omits route decorators.
Endpoint authorization, original service wiring and XLSX require later actual
service tests; this file must never be presented as full ERP acceptance.
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PYTHON = Path('C:/Python314/python.exe')
if (os.name != 'nt' or os.path.normcase(str(ROOT)) != os.path.normcase('C:/xjy-work/xjy-web-stage1') or
        os.path.normcase(sys.executable) != os.path.normcase(str(PYTHON)) or
        not sys.flags.isolated or not sys.flags.no_site or not sys.flags.dont_write_bytecode or sys.flags.optimize):
    raise RuntimeError('Fixed actual Windows Sandbox Python -I -B -S required; Host execution refused')

import argparse
import ast
import calendar
import contextlib
import copy
import csv
import datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import hashlib
import importlib.util
import io
import json
import math
import operator
import re
import sqlite3
import stat
import types
import unicodedata
import unittest
import uuid

SELF = 'audit-tools/finance-erp-170-accuracy.test.py'
GUARDS = {
    'stage1/sandbox-context.py': '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
    'stage1/validate-sandbox-context.py': '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207',
}
PINS = {
    'finance.py': '56bcb389a21ada8c5d650e6f7ea1e81781b446f3af0a4e9b19e019930df63096',
    'inventory_dashboard.py': 'c0fb94c47410b3520e9326f722ba791d51a98e26a75576e568cb7e958ecda35d',
    'reports.py': '6d43ddcb140cda914e8519733405b09a14673985e4370806d4ecdf7c86cf3287',
    'rule_engine.py': '370320046ac609fc3ac24b138e1cc3a88dddb478e472bf63656fbec254f1847b',
    'erp_values.py': 'e7be9186775fcdf935322d40a7de1757bd1e91b4ad5b69f4090239d1b0a74419',
    'erp_reports.py': 'fc316d96468da729438129586deae8c2003f5ae1075757832644cccf3d292a1d',
    'erp_settlement.py': '2ee5872aa2ed660c2a41f2326eea6a97e8a4e6c5dd60cf5e6890b59c2d3a32c7',
}
PYTHON_SHA = '434b361fe0c5960d404974feed493db47f2603a1ace2574312104fbed0182c6f'
SOURCE_PREFIX = 'project/desktop/legacy-source/ledger/'
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
        common = ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_nlink')
        if any(getattr(before, key) != getattr(opened, key) for key in common):
            raise RuntimeError('Source/runtime changed before open')
        body = stream.read(limit + 1)
        if len(body) != before.st_size or identity(os.fstat(stream.fileno())) != identity(opened):
            raise RuntimeError('Source/runtime changed while reading')
    if identity(file.lstat()) != identity(before):
        raise RuntimeError('Source/runtime changed after read')
    return body


def audit_boundary(event, args):
    if event == 'sqlite3.connect' and args != (':memory:',):
        raise RuntimeError('Only synthetic in-memory SQLite permitted')
    if event == 'open' and args and isinstance(args[0], (str, bytes, os.PathLike)):
        if re.search(r'(^|[/?:])f:', os.fsdecode(args[0]).replace('\\', '/').lower()):
            raise RuntimeError('Production content open forbidden')


def selected(name, names, ports, constants=(), classes=()):
    tree = ast.parse(BODIES[name], filename=SOURCE_PREFIX + name)
    nodes = []
    for key in names:
        found = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == key]
        if len(found) != 1:
            raise RuntimeError('One exact source definition required: ' + key)
        node = copy.deepcopy(found[0]); node.decorator_list = []; nodes.append(node)
    for key in classes:
        found = [n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == key]
        if len(found) != 1:
            raise RuntimeError('One exact source exception required')
        nodes.insert(0, copy.deepcopy(found[0]))
    for key in constants:
        found = [n for n in tree.body if isinstance(n, ast.Assign) and len(n.targets) == 1 and isinstance(n.targets[0], ast.Name) and n.targets[0].id == key]
        if len(found) != 1:
            raise RuntimeError('One literal source constant required: ' + key)
        ports[key] = ast.literal_eval(found[0].value)
    module = ast.fix_missing_locations(ast.Module(body=nodes, type_ignores=[]))
    for node in ast.walk(module):
        if isinstance(node, (ast.Import, ast.ImportFrom, ast.AsyncFunctionDef, ast.AsyncWith)):
            raise RuntimeError('Import/IO scope in selected source refused')
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in ('exec', 'eval', 'compile', '__import__', 'open', 'input'):
            raise RuntimeError('Unreviewed IO in selected source refused')
    namespace = {'__name__': 'independent_finance_erp_source', **ports}
    exec(compile(module, SOURCE_PREFIX + name, 'exec', dont_inherit=True, optimize=0), namespace)
    return types.SimpleNamespace(**namespace)


class ResponsePort:
    def __init__(self, body, **metadata): self.data, self.metadata = body, metadata


class FixedDate(datetime.date):
    @classmethod
    def today(cls): return cls(2026, 10, 19)


def finance(connection, args=None):
    db = types.SimpleNamespace(query=lambda sql, values=(): connection.execute(sql, values).fetchall())
    return selected('finance.py', ('csv_export_cell', 'month_bounds', 'payroll_basis', 'salary_compute', 'expenses_export'),
                    {'json': json, 'datetime': datetime, 'calendar': calendar, 'csv': csv, 'io': io,
                     'db': db, 'request': types.SimpleNamespace(args=args or {}), 'Response': ResponsePort,
                     'rules': types.SimpleNamespace(compute=lambda *a: (_ for _ in ()).throw(AssertionError('Unknown rules must not run')))}, constants=('FIELDS',))


def inventory(connection):
    class OwnedConnection:
        def execute(self, *a, **kw): return connection.execute(*a, **kw)
        def close(self): pass
    db = types.SimpleNamespace(now_str=lambda: '2026-10-19 12:00:00', connect=lambda: OwnedConnection())
    return selected('inventory_dashboard.py', ('inventory_state', 'platinum_identity', '_grams', '_thresholds', 'snapshot'),
                    {'Decimal': Decimal, 'InvalidOperation': InvalidOperation, 're': re, 'contextlib': contextlib, 'db': db})


def report_source():
    return selected('reports.py', ('decimal', 'format2', 'prepare', 'total'),
                    {'Decimal': Decimal, 'InvalidOperation': InvalidOperation, 'ROUND_HALF_UP': ROUND_HALF_UP, 'json': json},
                    constants=('STATE_LABELS', 'BUCKET_LABELS'))


def erp_source():
    values = selected('erp_values.py', ('money', 'weight', 'quantity', 'text', 'identifier', 'date', 'encoded', 'digest', 'object_value', 'permitted', 'require', 'positive_money', 'revision', 'today'),
                      {'dt': datetime, 'hashlib': hashlib, 'json': json, 're': re, 'unicodedata': unicodedata, 'uuid': uuid, 'Decimal': Decimal}, classes=('ErpError',))
    reports = selected('erp_reports.py', ('parse_filters', '_cents', '_eligible', '_sensitive', 'build_report', '_money_text'),
                       {'dt': datetime, 're': re, 'deepcopy': copy.deepcopy, 'ErpError': values.ErpError, 'date': values.date,
                        'identifier': values.identifier, 'permitted': values.permitted, 'require': values.require,
                        'today': lambda: '2026-10-19', 'PARAMETERS': frozenset(('asOf', 'from', 'to', 'partyId', 'kind', 'status', 'creatorId')),
                        'KINDS': frozenset(('purchase', 'receipt', 'receivable', 'payable', 'opening_receivable', 'opening_payable', 'settlement', 'reversal')),
                        'STATUSES': frozenset(('draft', 'pending', 'confirmed', 'rejected', 'reversed'))}, constants=('MAX_ROWS', 'BUCKETS'))
    settlement = selected('erp_settlement.py', ('validate_timeline', 'validate_receipt_timeline', 'accept_settlement'),
                          {'ErpError': values.ErpError, 'uuid': uuid,
                           'one': lambda c, sql, params=(): dict(c.execute(sql, params).fetchone())})
    return values, reports, settlement


@contextlib.contextmanager
def ledger_fixture():
    c = sqlite3.connect(':memory:'); c.row_factory = sqlite3.Row
    c.executescript('''
      CREATE TABLE sales(id INTEGER,date TEXT,staff TEXT,received REAL,amount_c REAL,profit_c REAL,comm_c REAL,weight REAL,status TEXT);
      CREATE TABLE expenses(id INTEGER,date TEXT,employee TEXT,category TEXT,purpose TEXT,ticket REAL,allowance REAL,personal REAL,amount REAL,rule_version INTEGER,payout TEXT,status TEXT);
      CREATE TABLE payroll_expenses(payroll_id INTEGER,expense_id INTEGER);
      CREATE TABLE payroll_records(id INTEGER,employee TEXT,month TEXT,outputs_json TEXT,status TEXT);
      CREATE TABLE stock_items(id INTEGER,product TEXT,category TEXT,weight,remark TEXT,sell_date TEXT,supplier TEXT,cost REAL);
      CREATE TABLE erp_bills(id TEXT,party_id TEXT,kind TEXT);
      CREATE TABLE erp_postings(id INTEGER PRIMARY KEY,doc_id TEXT,bill_id TEXT,date TEXT,face_cents INTEGER DEFAULT 0,settled_cents INTEGER DEFAULT 0);
      CREATE TABLE erp_allocations(id TEXT,doc_id TEXT,bill_id TEXT,amount_cents INTEGER);
    ''')
    try: yield c
    finally: c.close()


def stock_row(c, identifier, weight):
    c.execute('INSERT INTO stock_items VALUES(?,?,?,?,?,?,?,?)', (identifier, 'PT950虚构链', '铂金', weight, '在库', '', '虚构供应商', 100))


PARTY = 'CUS:10000000-0000-4000-8000-000000000001'


def document(key, kind='receivable', day='2026-10-01', amount=10001, status='confirmed', payload=None):
    return {'id': key, 'number': 'SYNTHETIC-' + key, 'kind': kind, 'date': day, 'dueDate': '2026-10-01',
            'partyId': PARTY, 'partyName': '虚构单位', 'amountCents': amount, 'status': status,
            'authorId': 'synthetic-maker', 'authorName': '虚构制单人', 'payload': payload or {}, 'note': ''}


def bill(key, face=10001, settled=4000, day='2026-10-01', due='2026-10-01'):
    return {'id': key, 'number': 'SYNTHETIC-' + key, 'kind': 'receivable', 'date': day, 'dueDate': due,
            'partyId': PARTY, 'partyName': '虚构单位', 'amountCents': face, 'settledCents': settled,
            'balanceCents': face - settled, 'sourceId': key}


def actor(sensitive=True):
    return {'protocolVersion': 2, 'staffId': 'synthetic-reader', 'access': 'view',
            'capabilities': ['erp.read', 'erp.reports.view'] + (['erp.reports.sensitive'] if sensitive else [])}


class Accuracy(unittest.TestCase):
    def test_A01_explicit_zero_weight_is_valid_and_not_missing(self):
        with ledger_fixture() as c:
            api = inventory(c)
            for value in (0, 0.0, '0', '0.0000'):
                with self.subTest(value=value): self.assertEqual(api._grams(value), Decimal('0'))

    def test_A02_missing_weight_is_unknown_rather_than_a_saved_zero(self):
        with ledger_fixture() as c:
            api = inventory(c)
            for value in (None, ''):
                with self.subTest(value=value): self.assertIsNone(api._grams(value), 'A missing weight is not a saved zero')

    def test_A03_negative_nonfinite_and_nonnumeric_weight_are_rejected(self):
        with ledger_fixture() as c:
            api = inventory(c)
            for value in (-1, 'NaN', 'Infinity', 'not-a-weight'):
                with self.subTest(value=value): self.assertIsNone(api._grams(value))

    def test_A04_invalid_weight_cannot_become_a_negative_stock_report_total(self):
        with ledger_fixture() as c:
            stock_row(c, 1, 8); stock_row(c, 2, -1)
            result = inventory(c).snapshot(c, '2026-10')
            self.assertEqual(result['overall']['in_stock']['grams'], 8)
            self.assertEqual([r['id'] for r in result['invalid_rows']], [2])
            api = report_source()
            try: rows = api.prepare('stock', result['rows'])
            except ValueError: return  # A clear refusal is a valid safe contract.
            self.assertFalse(any(r['_metrics']['grams'] < 0 for r in rows), 'Invalid weight must not reduce a normal financial total')

    def test_A05_invalid_pt950_weight_cannot_reduce_raw_platinum_in_report(self):
        with ledger_fixture() as c:
            stock_row(c, 1, 8); stock_row(c, 2, -1)
            api = report_source()
            try: rows = api.prepare('platinum', inventory(c).snapshot(c, '2026-10')['rows'])
            except ValueError: return
            self.assertFalse(any(r['_metrics']['pt950_grams'] < 0 for r in rows), 'Negative invalid platinum is not an ordinary observation')

    def test_A06_pt950_board_bean_and_unknown_purity_keep_distinct_factors(self):
        with ledger_fixture() as c:
            api = inventory(c)
            examples = [({'category': '铂金', 'product': 'PT950虚构链'}, ('pt950', Decimal('.95'))),
                        ({'category': '铂金', 'product': 'PT950铂金板料'}, ('fine_board', Decimal('1'))),
                        ({'category': '铂金', 'product': '足铂金豆'}, ('fine_board', Decimal('1'))),
                        ({'category': '铂金', 'product': '未标成色虚构链'}, ('unknown_pt', None)),
                        ({'category': '银', 'product': 'PT950与银冲突'}, ('unknown_pt', None))]
            for row, expected in examples:
                with self.subTest(row=row): self.assertEqual(api.platinum_identity(row), expected)

    def test_A07_sale_date_precedes_stale_in_stock_remark(self):
        with ledger_fixture() as c:
            self.assertEqual(inventory(c).inventory_state({'sell_date': '2026-10-10', 'remark': '在库'}), '已售')

    def test_A08_payroll_basis_uses_completed_employee_sales_and_approved_unclaimed_expenses(self):
        with ledger_fixture() as c:
            c.executemany('INSERT INTO sales VALUES(?,?,?,?,?,?,?,?,?)', [
                (1, '2026-10-01', '虚构甲', 100, 200, 80, 20, 3, '已完成'),
                (2, '2026-10-31', '虚构甲', 300, 400, 120, 30, 2, '已完成'),
                (3, '2026-09-30', '虚构甲', 9, 9, 9, 9, 9, '已完成'),
                (4, '2026-11-01', '虚构甲', 9, 9, 9, 9, 9, '已完成'),
                (5, '2026-10-15', '虚构甲', 9, 9, 9, 9, 9, '未完成'),
                (6, '2026-10-15', '虚构乙', 9, 9, 9, 9, 9, '已完成')])
            expenses = [(11, '已审核', '随工资'), (12, '已审核', '随工资'), (13, '已支付', '随工资'), (14, '已审核', '单独支付')]
            for key, status, payout in expenses:
                c.execute('INSERT INTO expenses(id,date,employee,amount,status,payout) VALUES(?,?,?,?,?,?)', (key, '2026-10-10', '虚构甲', 10, status, payout))
            c.execute('INSERT INTO payroll_expenses VALUES(2,12)')
            basis = finance(c).payroll_basis(c, '虚构甲', '2026-10', 1)
            self.assertEqual([r['id'] for r in basis['sales']], [1, 2]); self.assertEqual([r['id'] for r in basis['expenses']], [11])
            self.assertEqual((sum(r['amount_c'] for r in basis['sales']), sum(r['profit_c'] for r in basis['sales']), sum(r['comm_c'] for r in basis['sales']), sum(r['weight'] for r in basis['sales'])), (600, 200, 50, 5))

    def test_A09_payroll_same_record_retains_its_own_reserved_reimbursement(self):
        with ledger_fixture() as c:
            c.execute('INSERT INTO expenses(id,date,employee,amount,status,payout) VALUES(1,?,?,?,?,?)', ('2026-10-10', '虚构甲', 12.34, '已审核', '随工资'))
            c.execute('INSERT INTO payroll_expenses VALUES(7,1)')
            api = finance(c)
            self.assertEqual([r['id'] for r in api.payroll_basis(c, '虚构甲', '2026-10', 7)['expenses']], [1])
            self.assertEqual(api.payroll_basis(c, '虚构甲', '2026-10', 8)['expenses'], [])

    def test_A10_expense_export_matches_requested_employee_and_status(self):
        with ledger_fixture() as c:
            for key, employee, status, amount in [(1, '虚构甲', '已审核', 12.34), (2, '虚构乙', '已审核', 56.78), (3, '虚构甲', '草稿', 90.12)]:
                c.execute('INSERT INTO expenses VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', (key, '2026-10-10', employee, '其他', 'SYNTHETIC-' + str(key), amount, 0, 0, amount, 0, '单独支付', status))
            response = finance(c, {'employee': '虚构甲', 'status': '已审核'}).expenses_export()
            rows = list(csv.reader(io.StringIO(response.data.lstrip('\ufeff'))))
            self.assertEqual(len(rows), 2, 'Visible filtered one-record collection must not export three unrelated records')
            self.assertEqual((rows[1][1], rows[1][9], rows[1][7]), ('虚构甲', '已审核', '12.34'))

    def test_A11_saved_payroll_reporting_never_reprices_inputs(self):
        saved = {'employee': '虚构甲', 'outputs_json': json.dumps({'应发工资': 3210.12, '工资扣款': 100.03, '实发工资': 3110.09, '本次支付': 3122.43}), 'inputs_json': '{"base":999999}'}
        row = report_source().prepare('payroll', [saved])[0]
        self.assertEqual(row['_metrics'], {'count': Decimal(1), 'gross': Decimal('3210.12'), 'deduction': Decimal('100.03'), 'net': Decimal('3110.09'), 'payment': Decimal('3122.43')})

    def test_A12_erp_decimal_units_reject_coercion_and_keep_exact_fraction(self):
        values, _, _ = erp_source()
        self.assertEqual((values.money('0.29'), values.money('100.01'), values.weight('1.2345')), (29, 10001, '1.2345'))
        for invalid in (0.29, True, 'NaN', '1.001', '-1'):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError): values.money(invalid)

    def test_A13_erp_partial_settlement_has_literal_remaining_6001_cents(self):
        _, _, api = erp_source()
        with ledger_fixture() as c:
            c.execute('INSERT INTO erp_bills VALUES(?,?,?)', ('b', PARTY, 'receivable'))
            c.execute('INSERT INTO erp_postings(doc_id,bill_id,date,face_cents) VALUES(?,?,?,?)', ('face', 'b', '2026-10-01', 10001))
            api.accept_settlement(c, {'id': 'payment', 'party_id': PARTY, 'date': '2026-10-02'}, {'direction': 'receive', 'allocations': [{'billId': 'b', 'amountCents': 4000}]})
            self.assertEqual(c.execute('SELECT SUM(face_cents-settled_cents) FROM erp_postings').fetchone()[0], 6001)
            self.assertEqual(c.execute('SELECT amount_cents FROM erp_allocations').fetchone()[0], 4000)

    def test_A14_erp_overallocation_rejects_before_any_new_posting(self):
        values, _, api = erp_source()
        with ledger_fixture() as c:
            c.execute('INSERT INTO erp_bills VALUES(?,?,?)', ('b', PARTY, 'receivable'))
            c.execute('INSERT INTO erp_postings(doc_id,bill_id,date,face_cents,settled_cents) VALUES(?,?,?,?,?)', ('face', 'b', '2026-10-01', 10001, 4000))
            with self.assertRaises(values.ErpError): api.accept_settlement(c, {'id': 'over', 'party_id': PARTY, 'date': '2026-10-02'}, {'direction': 'receive', 'allocations': [{'billId': 'b', 'amountCents': 6002}]})
            self.assertEqual(c.execute('SELECT COUNT(*) FROM erp_postings').fetchone()[0], 1)
            self.assertEqual(c.execute('SELECT COUNT(*) FROM erp_allocations').fetchone()[0], 0)

    def test_A15_erp_wrong_party_or_direction_never_allocates(self):
        values, _, api = erp_source()
        with ledger_fixture() as c:
            c.execute('INSERT INTO erp_bills VALUES(?,?,?)', ('b', PARTY, 'receivable'))
            for direction, party in [('pay', PARTY), ('receive', 'CUS:another')]:
                with self.subTest(direction=direction, party=party), self.assertRaises(values.ErpError):
                    api.accept_settlement(c, {'id': 'wrong', 'party_id': party, 'date': '2026-10-02'}, {'direction': direction, 'allocations': [{'billId': 'b', 'amountCents': 1}]})
            self.assertEqual(c.execute('SELECT COUNT(*) FROM erp_allocations').fetchone()[0], 0)

    def test_A16_erp_backdated_payment_cannot_overdraw_an_intervening_balance(self):
        values, _, api = erp_source()
        with ledger_fixture() as c:
            c.execute('INSERT INTO erp_bills VALUES(?,?,?)', ('b', PARTY, 'receivable'))
            c.executemany('INSERT INTO erp_postings(doc_id,bill_id,date,face_cents,settled_cents) VALUES(?,?,?,?,?)', [('face', 'b', '2026-10-01', 10000, 0), ('paid', 'b', '2026-10-05', 0, 8000), ('undo', 'b', '2026-10-10', 0, -8000)])
            with self.assertRaises(values.ErpError): api.accept_settlement(c, {'id': 'backdated', 'party_id': PARTY, 'date': '2026-10-02'}, {'direction': 'receive', 'allocations': [{'billId': 'b', 'amountCents': 3000}]})
            self.assertEqual(c.execute('SELECT COUNT(*) FROM erp_postings').fetchone()[0], 3)

    def test_A17_erp_reports_do_not_cut_old_settlements_out_of_selected_bill(self):
        _, api, _ = erp_source()
        result = api.build_report(actor(), {'asOf': '2026-10-19', 'from': '2026-10-01', 'to': '2026-10-01'}, [bill('b')], [document('b')])
        self.assertEqual(result['totals']['receivableCents'], 6001)
        self.assertEqual(sum(r['receivableCents'] for r in result['aging']), 6001)
        self.assertEqual(result['rows'][0]['settledCents'], 4000)

    def test_A18_erp_asof_reversal_is_positive_before_and_net_zero_after(self):
        _, api, _ = erp_source()
        cash = document('cash', 'settlement', '2026-10-02', 4000, 'reversed', {'direction': 'receive', 'account': '虚构现金'})
        undo = document('undo', 'reversal', '2026-10-10', 4000, 'confirmed', {'targetId': 'cash'})
        before = copy.deepcopy([cash, undo])
        early = api.build_report(actor(), {'asOf': '2026-10-05'}, [], [cash, undo])
        late = api.build_report(actor(), {'asOf': '2026-10-19'}, [], [cash, undo])
        self.assertEqual(early['totals']['receivedCents'], 4000); self.assertEqual(late['totals']['receivedCents'], 0)
        self.assertEqual([r['amountCents'] for r in late['cash']], [4000, -4000]); self.assertEqual([cash, undo], before)

    def test_A19_erp_aging_due_day_and_30_31_60_61_90_91_boundaries(self):
        _, api, _ = erp_source()
        dates = ['2026-10-19', '2026-10-18', '2026-09-19', '2026-09-18', '2026-08-20', '2026-08-19', '2026-07-21', '2026-07-20']
        docs, bills = [], []
        for index, due in enumerate(dates):
            key = str(index); docs.append(document(key, day='2026-07-01')); bills.append(bill(key, face=100, settled=0, day='2026-07-01', due=due))
        result = api.build_report(actor(), {'asOf': '2026-10-19'}, bills, docs)
        self.assertEqual([r['receivableCents'] for r in result['aging']], [100, 200, 200, 200, 100])
        self.assertEqual(result['totals']['receivableCents'], 800)

    def test_A20_erp_duplicate_filters_are_rejected_by_pure_parser(self):
        values, api, _ = erp_source()
        class Duplicate(dict):
            def getlist(self, key): return ['2026-10-19', '2026-10-01']
        with self.assertRaises(values.ErpError): api.parse_filters(Duplicate(asOf='2026-10-19'))

    def test_A21_erp_refuses_noninteger_report_money_and_exports_exact_text(self):
        values, api, _ = erp_source()
        with self.assertRaises(values.ErpError): api.build_report(actor(), {'asOf': '2026-10-19'}, [{**bill('b'), 'settledCents': 4000.0}], [document('b')])
        self.assertEqual([api._money_text(value) for value in (0, 29, 10001, -29, 9000000000000)], ['0.00', '0.29', '100.01', '-0.29', '90000000000.00'])

    def test_A22_salary_rule_receives_saved_sales_basis_and_requested_rule_version(self):
        with ledger_fixture() as c:
            api = finance(c); calls = []
            def compute(domain, variables, version):
                calls.append((domain, variables, version)); return {'本次支付': 3122.43}, 77
            api.salary_compute.__globals__['rules'] = types.SimpleNamespace(compute=compute)
            inputs = {key: 0 for key in api.FIELDS}; inputs.update(base=3000, days=26, mode='底薪+原提成')
            basis = {'sales': [{'amount_c': 200, 'profit_c': 80, 'comm_c': 20, 'weight': 3}, {'amount_c': 400, 'profit_c': 120, 'comm_c': 30, 'weight': 2}], 'expenses': [{'amount': 12.34}]}
            output, variables, version = api.salary_compute(inputs, basis, 77)
            self.assertEqual((calls[0][0], calls[0][2], version, output), ('payroll', 77, 77, {'本次支付': 3122.43}))
            self.assertEqual({key: variables[key] for key in ('底薪', '计薪方式', '销售金额', '销售利润', '销售克重', '原提成', '工资报销')},
                             {'底薪': 3000, '计薪方式': '底薪+原提成', '销售金额': 600, '销售利润': 200, '销售克重': 5, '原提成': 50, '工资报销': 12.34})

    def test_A23_overview_passes_gross_wages_and_expenses_once_to_original_rule(self):
        with ledger_fixture() as c:
            c.execute('ALTER TABLE sales ADD COLUMN cost REAL'); c.execute('ALTER TABLE sales ADD COLUMN comm_profit_c REAL')
            c.execute('INSERT INTO sales(id,date,staff,received,amount_c,profit_c,comm_c,weight,status,cost,comm_profit_c) VALUES(1,?,?,?,?,?,?,?,?,?,?)',
                      ('2026-10-10', '虚构甲', 8000, 9000, 6000, 100, 10, '已完成', 2000, 5900))
            for key, month, status, gross in [(1, '2026-10', '已确认', 3000), (2, '2026-10', '已发放', 1000), (3, '2026-10', '草稿', 999), (4, '2026-09', '已确认', 999)]:
                c.execute('INSERT INTO payroll_records VALUES(?,?,?,?,?)', (key, '虚构甲', month, json.dumps({'应发工资': gross, '本次支付': gross + 99}), status))
            for key, status, amount in [(1, '已审核', 12), (2, '已支付', 34), (3, '草稿', 999)]:
                c.execute('INSERT INTO expenses(id,date,employee,amount,status,payout) VALUES(?,?,?,?,?,?)', (key, '2026-10-10', '虚构甲', amount, status, '随工资'))
            calls = []
            def compute(domain, variables): calls.append((domain, variables)); return {'经营结余': 987.65}, 77
            class OwnedConnection:
                def execute(self, *a): return c.execute(*a)
                def close(self): pass
            api = selected('inventory_dashboard.py', ('_sales', 'dashboard'),
                           {'contextlib': contextlib, 'json': json, 'math': math,
                            'db': types.SimpleNamespace(connect=lambda: OwnedConnection(), now_str=lambda: '2026-10-19 12:00:00'),
                            'finance': finance(c), 'snapshot': lambda connection, month: {'month': month},
                            'rules': types.SimpleNamespace(compute=compute)})
            c.commit()  # dashboard itself starts its read transaction.
            result = api.dashboard('2026-10')
            self.assertEqual(calls, [('overview', {'销售利润': 6000.0, '工资成本': 4000.0, '报销费用': 46.0})])
            self.assertEqual((result['wage_cost'], result['expense_cost'], result['net'], result['rule_version']), (4000, 46, 987.65, 77))


def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--test-sha256', required=True)
    parser.add_argument('--expected-namespace', required=True)
    args = parser.parse_args()
    if not re.fullmatch('[a-f0-9]{64}', args.test_sha256) or not re.fullmatch(r'[A-Za-z0-9_.-]{8,160}', args.expected_namespace):
        raise RuntimeError('Root-pinned self SHA and actual handed-back namespace required')
    if hashlib.sha256(checked_read(ROOT / SELF)).hexdigest() != args.test_sha256:
        raise RuntimeError('Frozen test changed')
    if hashlib.sha256(checked_read(PYTHON)).hexdigest() != PYTHON_SHA or sys.version_info[:3] != (3, 14, 8) or importlib.util.MAGIC_NUMBER.hex() != '2b0e0d0a':
        raise RuntimeError('Fixed actual Guest runtime changed')
    guards = {}
    for relative, expected in GUARDS.items():
        body = checked_read(ROOT / relative)
        if hashlib.sha256(body).hexdigest() != expected: raise RuntimeError('Original actual Guest admission changed')
        guards[relative] = body
    guard = types.ModuleType('finance_erp_170_actual_context'); guard.__file__ = str(ROOT / 'stage1/sandbox-context.py')
    exec(compile(guards['stage1/sandbox-context.py'], guard.__file__, 'exec', dont_inherit=True, optimize=0), guard.__dict__)
    admission = guard.read_context(ROOT)
    identity = json.loads(checked_read(ROOT / 'isolation-identity.json').decode('utf-8-sig'))
    if identity.get('namespace') != args.expected_namespace: raise RuntimeError('Actual handed-back Guest namespace changed')
    for name, expected in PINS.items():
        body = checked_read(ROOT / SOURCE_PREFIX / name)
        if hashlib.sha256(body).hexdigest() != expected: raise RuntimeError('Root source pin changed: ' + name)
        BODIES[name] = body
    sys.addaudithook(audit_boundary)
    print(json.dumps({'purpose': 'finance-erp-170-independent-accuracy', 'admission': admission,
                      'namespace': args.expected_namespace, 'testSha256': args.test_sha256, 'sourcePins': PINS,
                      'businessImported': False, 'opaqueRulesExecuted': False, 'realDataReadOrChanged': False,
                      'fixture': 'synthetic-memory-sqlite-and-selected-source'}, ensure_ascii=False), flush=True)
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Accuracy))
    print(json.dumps({'testsRun': result.testsRun, 'failures': len(result.failures), 'errors': len(result.errors),
                      'passed': result.wasSuccessful(), 'realDataReadOrChanged': False}), flush=True)
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__': raise SystemExit(main())
