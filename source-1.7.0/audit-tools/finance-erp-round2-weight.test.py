"""Root-only offline Guest weight accuracy supplement; source candidate unrun.

The unchanged first-round helper supplies bounded AST selection and its original
Guest/read guards. No app, pyc, EXE, rule engine or real database is imported.
All assertions are identical in red/candidate phases; only Root-frozen source
pins differ. Synthetic memory SQLite / route ports do not prove original HTTP,
Jinja rendering or persisted legacy schema. Existing 32/16 tests stay untouched.
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if (os.name != 'nt' or os.path.normcase(str(ROOT)) != os.path.normcase('C:/xjy-work/xjy-web-stage1') or
        os.path.normcase(sys.executable) != os.path.normcase('C:/Python314/python.exe') or
        not sys.flags.isolated or not sys.flags.no_site or not sys.flags.dont_write_bytecode or sys.flags.optimize):
    raise RuntimeError('Fixed actual offline Guest Python -I -B -S required; Host execution refused')

import argparse
import ast
import contextlib
import copy
from decimal import Decimal
import hashlib
import importlib.util
import json
import math
import re
import stat
import types
import unittest
import uuid

SELF = 'audit-tools/finance-erp-round2-weight.test.py'
HELPER = 'audit-tools/finance-erp-170-accuracy.test.py'
HELPER_SHA = 'db13aeb68a8eb42beb0528be714aa3a319bfdd77e89df7fe9422a417e540cf7a'
PIN_FILE = 'audit-tools/finance-erp-round2-weight-pins.json'
FILES = ('inventory_dashboard.py', 'reports.py', 'app/templates/stock.html', 'app/templates/home.html')
PREFIX = 'project/desktop/legacy-source/ledger/'
GUARDS = {'stage1/sandbox-context.py': '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
          'stage1/validate-sandbox-context.py': '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207'}
BASE = None


def read(file, maximum=1024 * 1024):
    for parent in (file, *file.parents):
        info = parent.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400 or stat.S_ISREG(info.st_mode) and info.st_nlink != 1:
            raise RuntimeError('Ordinary non-reparse single-link file required')
    identity = lambda v: (v.st_dev, v.st_ino, v.st_size, v.st_mtime_ns, v.st_ctime_ns, v.st_nlink)
    before = file.lstat()
    if not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= maximum: raise RuntimeError('Bounded ordinary file required')
    with file.open('rb') as stream:
        opened = os.fstat(stream.fileno())
        if any(getattr(before, key) != getattr(opened, key) for key in ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_nlink')):
            raise RuntimeError('File changed before open')
        body = stream.read(maximum + 1)
        if len(body) != before.st_size or identity(os.fstat(stream.fileno())) != identity(opened): raise RuntimeError('File changed during read')
    if identity(file.lstat()) != identity(before): raise RuntimeError('File changed after read')
    return body


@contextlib.contextmanager
def fixture(rows):
    connection = BASE.sqlite3.connect(':memory:'); connection.row_factory = BASE.sqlite3.Row
    connection.execute('''CREATE TABLE stock_items(id INTEGER,seq INTEGER,in_date TEXT,order_no TEXT,category TEXT,product TEXT,
        weight,cost REAL,sell_price REAL,profit_c REAL,remark TEXT,sell_date TEXT,supplier TEXT,seller TEXT)''')
    originals = []
    for index, values in enumerate(rows, 1):
        row = {'id': index, 'seq': index, 'in_date': '2025-01-01', 'order_no': 'SYNTHETIC-' + str(index),
               'category': '铂金', 'product': 'PT950虚构链', 'weight': 8, 'cost': 100, 'sell_price': 120, 'profit_c': 20,
               'remark': '在库', 'sell_date': '', 'supplier': '虚构供应商', 'seller': '', **values}
        connection.execute('INSERT INTO stock_items(' + ','.join(row) + ') VALUES(' + ','.join('?' for _ in row) + ')', tuple(row.values()))
        originals.append(row)
    connection.commit()
    try: yield connection, originals
    finally: connection.close()


def snapshot(connection): return BASE.inventory(connection).snapshot(connection, '2026-10')


def page(inventory, args=None):
    signed = []
    repairs = types.SimpleNamespace(row_token=lambda table, row: signed.append((table, copy.deepcopy(row))) or 'issued-route-token',
                                    preserve_choices=lambda first, second: list(dict.fromkeys([*first, *second])))
    api = BASE.selected('inventory_dashboard.py', ('_grams', '_stock_rows', 'stock_index'),
                        {'Decimal': BASE.Decimal, 'InvalidOperation': BASE.InvalidOperation, 'math': math, 'STATES': ('在库', '在途', '已售', '待确认'),
                         'request': types.SimpleNamespace(args=args or {}), '_month': lambda: '2026-10', 'snapshot': lambda **kw: inventory,
                         'r': repairs, 'db': types.SimpleNamespace(query=lambda *a: []),
                         'auth': types.SimpleNamespace(current_user=lambda: {'role': 'admin'}),
                         'render_template': lambda name, **context: context})
    return api.stock_index(), signed


def save_new(weight):
    writes, calculations, messages = [], [], []
    @contextlib.contextmanager
    def transaction(): yield object()
    def calculate(record): calculations.append(copy.deepcopy(record)); return {'profit': 9.99}
    repairs = types.SimpleNamespace(transaction=transaction,
                                    stock=types.SimpleNamespace(FIELDS=('product', 'weight', 'cost', 'sell_price', 'in_date', 'sell_date', 'remark')),
                                    number=lambda value: float(value or 0), validate_date=lambda value, default: value or default,
                                    calc=types.SimpleNamespace(calc_stock=calculate), write_row=lambda c, table, row: writes.append((table, copy.deepcopy(row))))
    form = {'product': '虚构新增商品', 'weight': weight, 'cost': '100', 'sell_price': '120', 'in_date': '2026-10-01',
            'sell_date': '', 'remark': '', 'inventory_state': '在库', 'back_month': '2026-10'}
    if weight is None: form.pop('weight')
    api = BASE.selected('inventory_dashboard.py', ('_grams', '_remark', 'save_stock'),
                        {'Decimal': BASE.Decimal, 'InvalidOperation': BASE.InvalidOperation, 're': re, 'datetime': BASE.datetime,
                         'sqlite3': BASE.sqlite3, 'r': repairs, 'STATES': ('在库', '在途', '已售', '待确认'), '_write_allowed': lambda: None,
                         'request': types.SimpleNamespace(form=form), 'flash': lambda message, kind: messages.append((kind, message)),
                         'redirect': lambda location: location, 'url_for': lambda endpoint, **values: (endpoint, values)})
    api.save_stock()
    return writes, calculations, messages


class WeightAccuracy(unittest.TestCase):
    def test_W01_explicit_zero_and_positive_weight_keep_exact_platinum_control(self):
        with fixture([{'weight': 0}, {'weight': '0'}, {'weight': 3.12}, {'weight': 4.88}]) as (c, _):
            data = snapshot(c)
            self.assertEqual(data['invalid_rows'], [])
            self.assertTrue(data['overall']['in_stock']['weight_complete']); self.assertTrue(data['in_stock']['fine_complete'])
            self.assertEqual((data['overall']['in_stock']['count'], data['overall']['in_stock']['grams'], data['in_stock']['fine_grams']), (4, 8, 7.6))
            values = BASE.report_source().prepare('platinum', data['rows'])
            self.assertEqual(BASE.report_source().total(values, ['fine_grams'])['fine_grams'], Decimal('7.600'))

    def test_W02_missing_and_bad_weight_keep_raw_rows_and_mark_incomplete_state(self):
        for bad in (None, '', '  ', -1, 'not-weight', 'NaN', 'Infinity'):
            with self.subTest(bad=bad), fixture([{'weight': 8}, {'weight': bad}]) as (c, originals):
                data = snapshot(c)
                self.assertEqual(len(data['rows']), 2); self.assertEqual(data['rows'][1]['weight'], originals[1]['weight'])
                self.assertEqual(data['overall']['in_stock']['invalid_count'], 1)
                self.assertFalse(data['overall']['in_stock']['weight_complete']); self.assertFalse(data['in_stock']['fine_complete'])
                self.assertEqual(data['alert']['status'], 'incomplete'); self.assertIn('克重', data['alert']['text']); self.assertIn('核对', data['alert']['text'])
                self.assertTrue(data['rows'][1]['weight_issue'])

    def test_W03_sold_bad_weight_does_not_disable_valid_in_stock_platinum(self):
        with fixture([{'weight': 8}, {'weight': -1, 'sell_date': '2026-10-01'}]) as (c, _):
            data = snapshot(c)
            self.assertEqual(data['overall']['sold']['invalid_count'], 1); self.assertFalse(data['overall']['sold']['weight_complete'])
            self.assertTrue(data['overall']['in_stock']['weight_complete']); self.assertTrue(data['in_stock']['fine_complete'])
            self.assertEqual(data['in_stock']['fine_grams'], 7.6); self.assertEqual(data['alert']['status'], 'unset')
            rows = BASE.report_source().prepare('stock', data['rows']); self.assertEqual(len(rows), 1)

    def test_W04_transit_bad_weight_disables_only_transit_totals(self):
        with fixture([{'weight': 8}, {'weight': -1, 'remark': '在途'}]) as (c, _):
            data = snapshot(c)
            self.assertFalse(data['overall']['transit']['weight_complete']); self.assertFalse(data['transit']['fine_complete'])
            self.assertTrue(data['in_stock']['fine_complete']); self.assertEqual(data['alert']['status'], 'unset')

    def test_W05_filtered_page_refuses_partial_grams_preserves_rows_and_database_only_token(self):
        with fixture([{'weight': 8}, {'weight': -1}]) as (c, originals):
            context, signed = page(snapshot(c))
            self.assertEqual(context['sumr']['cnt'], 2); self.assertIsNone(context['sumr']['gram'])
            self.assertEqual(context['sumr']['invalid_weight_count'], 1); self.assertFalse(context['sumr']['weight_complete'])
            self.assertEqual([row['weight'] for row in context['rows']], [-1, 8])
            self.assertEqual(len(signed), 2)
            for table, row in signed:
                self.assertEqual(table, 'stock_items'); self.assertEqual(set(row), set(originals[0]))
                self.assertNotIn('weight_issue', row)

    def test_W06_filter_excluding_bad_row_retains_complete_zero_and_positive_summary(self):
        with fixture([{'weight': 0, 'supplier': '虚构有效'}, {'weight': '3.1200', 'supplier': '虚构有效'}, {'weight': -1}]) as (c, _):
            context, _ = page(snapshot(c), {'sup': '虚构有效'})
            self.assertTrue(context['sumr']['weight_complete']); self.assertEqual(context['sumr']['invalid_weight_count'], 0)
            self.assertEqual((context['sumr']['cnt'], context['sumr']['gram']), (2, 3.12))

    def test_W07_stock_report_invalid_weight_refuses_for_explicit_weight_reason(self):
        for bad in (None, '', -1, 'bad', 'NaN'):
            with self.subTest(bad=bad), fixture([{'weight': bad}]) as (c, _):
                with self.assertRaisesRegex(ValueError, r'库存.*克重.*核对'): BASE.report_source().prepare('stock', snapshot(c)['rows'])

    def test_W08_platinum_report_invalid_relevant_weight_refuses_for_explicit_reason(self):
        for bad in (None, '', -1, 'bad', 'Infinity'):
            with self.subTest(bad=bad), fixture([{'weight': bad}]) as (c, _):
                with self.assertRaisesRegex(ValueError, r'足铂.*克重.*核对'): BASE.report_source().prepare('platinum', snapshot(c)['rows'])

    def test_W09_unused_stock_weight_metric_does_not_block_count_and_cost(self):
        with fixture([{'weight': -1}]) as (c, _):
            rows = BASE.report_source().prepare('stock', snapshot(c)['rows'], selected_metrics=['count', 'cost'])
            self.assertEqual(rows[0]['_metrics'], {'count': Decimal(1), 'cost': Decimal(100)})

    def test_W10_unrelated_material_does_not_block_selected_platinum_metric(self):
        with fixture([{'weight': 8}, {'weight': 'bad', 'category': '黄金', 'product': '足金虚构链'}]) as (c, _):
            data = snapshot(c); self.assertFalse(data['overall']['in_stock']['weight_complete']); self.assertTrue(data['in_stock']['fine_complete'])
            rows = BASE.report_source().prepare('platinum', data['rows'], selected_metrics=['fine_grams'])
            self.assertEqual(BASE.report_source().total(rows, ['fine_grams'])['fine_grams'], Decimal('7.600'))

    def test_W11_unknown_purity_weight_blocks_only_selected_unknown_grams(self):
        with fixture([{'weight': None, 'product': '铂金成色待核对'}]) as (c, _):
            rows = snapshot(c)['rows']; api = BASE.report_source()
            self.assertEqual(api.prepare('platinum', rows, selected_metrics=['fine_grams'])[0]['_metrics'], {'fine_grams': Decimal(0)})
            with self.assertRaisesRegex(ValueError, r'足铂.*克重.*核对'): api.prepare('platinum', rows, selected_metrics=['unknown_grams'])

    def test_W12_nonweight_errors_are_not_swallowed_or_relabelled_as_weight(self):
        with fixture([{'weight': 8, 'cost': 'broken-cost'}]) as (c, _):
            with self.assertRaisesRegex(ValueError, '不能识别的数值') as caught: BASE.report_source().prepare('stock', snapshot(c)['rows'])
            self.assertNotIn('克重', str(caught.exception))

    def test_W13_missing_bad_or_negative_new_weight_never_reaches_calculator_or_writer(self):
        for value in (None, '', '  ', '-1', 'NaN', 'Infinity', 'bad'):
            with self.subTest(value=value):
                writes, calculations, messages = save_new(value)
                self.assertEqual(writes, []); self.assertEqual(calculations, [])
                self.assertTrue(any(kind == 'error' and '克重' in message and '核对' in message for kind, message in messages))

    def test_W14_explicit_zero_and_positive_new_weight_preserve_original_amount_inputs(self):
        for value, expected in [('0', 0), ('0.0000', 0), ('3.1200', 3.12)]:
            with self.subTest(value=value):
                writes, calculations, messages = save_new(value)
                self.assertEqual(len(writes), 1); self.assertEqual(len(calculations), 1)
                self.assertEqual((writes[0][1]['weight'], writes[0][1]['cost'], writes[0][1]['sell_price']), (expected, 100, 120))
                self.assertFalse(any(kind == 'error' for kind, message in messages))


def main():
    parser = argparse.ArgumentParser(allow_abbrev=False)
    parser.add_argument('--test-sha256', required=True); parser.add_argument('--pins-sha256', required=True)
    parser.add_argument('--expected-namespace', required=True); parser.add_argument('--phase', choices=('red', 'candidate'), required=True)
    args = parser.parse_args()
    if any(not re.fullmatch('[a-f0-9]{64}', value) for value in (args.test_sha256, args.pins_sha256)) or str(uuid.UUID(args.expected_namespace)) != args.expected_namespace:
        raise RuntimeError('Exact source hashes and actual handed-back namespace required')
    if hashlib.sha256(read(ROOT / SELF)).hexdigest() != args.test_sha256: raise RuntimeError('Frozen supplemental test changed')
    if hashlib.sha256(read(Path('C:/Python314/python.exe'))).hexdigest() != '434b361fe0c5960d404974feed493db47f2603a1ace2574312104fbed0182c6f' or sys.version_info[:3] != (3, 14, 8) or importlib.util.MAGIC_NUMBER.hex() != '2b0e0d0a': raise RuntimeError('Fixed Python runtime changed')
    guards = {}
    for relative, pin in GUARDS.items():
        guards[relative] = read(ROOT / relative)
        if hashlib.sha256(guards[relative]).hexdigest() != pin: raise RuntimeError('Original admission changed')
    guard = types.ModuleType('weight_round2_actual_context'); guard.__file__ = str(ROOT / 'stage1/sandbox-context.py')
    exec(compile(guards['stage1/sandbox-context.py'], guard.__file__, 'exec'), guard.__dict__)
    proof = guard.read_context(ROOT)
    if json.loads(read(ROOT / 'isolation-identity.json').decode('utf-8-sig')).get('namespace') != args.expected_namespace: raise RuntimeError('Handed-back namespace mismatch')
    manifest_body = read(ROOT / PIN_FILE)
    if hashlib.sha256(manifest_body).hexdigest() != args.pins_sha256: raise RuntimeError('Root-frozen source pin manifest changed')
    manifest = json.loads(manifest_body)
    if manifest.get('purpose') != 'finance-erp-round2-weight-source-pins' or set(manifest.get('phases', {})) != {'red', 'candidate'}: raise RuntimeError('Exact weight source pin manifest required')
    pins = manifest['phases'][args.phase]
    if not isinstance(pins, dict) or set(pins) != set(FILES): raise RuntimeError('All four source/template pins required')
    bodies = {}
    for name, pin in pins.items():
        if not re.fullmatch('[a-f0-9]{64}', pin): raise RuntimeError('Exact source SHA required')
        bodies[name] = read(ROOT / PREFIX / name)
        if hashlib.sha256(bodies[name]).hexdigest() != pin: raise RuntimeError('Phase source changed: ' + name)
    helper_body = read(ROOT / HELPER)
    if hashlib.sha256(helper_body).hexdigest() != HELPER_SHA: raise RuntimeError('Frozen original helper changed')
    global BASE
    BASE = types.ModuleType('weight_round2_frozen_helpers'); BASE.__file__ = str(ROOT / HELPER)
    exec(compile(helper_body, str(ROOT / HELPER), 'exec', dont_inherit=True, optimize=0), BASE.__dict__)
    BASE.BODIES.update({name: bodies[name] for name in ('inventory_dashboard.py', 'reports.py')})
    sys.addaudithook(BASE.audit_boundary)
    print(json.dumps({'purpose': 'finance-erp-round2-weight-supplement', 'phase': args.phase, 'namespace': args.expected_namespace,
                      'actualContext': proof, 'sourcePins': pins, 'testSha256': args.test_sha256, 'pinsSha256': args.pins_sha256,
                      'originalHelperSha256': HELPER_SHA, 'methods': 14, 'originalHttpVerified': False, 'realDataReadOrChanged': False}), flush=True)
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(WeightAccuracy))
    for name, pin in pins.items():
        if hashlib.sha256(read(ROOT / PREFIX / name)).hexdigest() != pin: raise RuntimeError('Phase source changed during tests')
    print(json.dumps({'testsRun': result.testsRun, 'failures': len(result.failures), 'errors': len(result.errors), 'passed': result.wasSuccessful(),
                      'originalHttpVerified': False, 'templatesRendered': False, 'realDataReadOrChanged': False}), flush=True)
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__': raise SystemExit(main())
