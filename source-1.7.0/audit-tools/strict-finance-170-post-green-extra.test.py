"""Independent post-GREEN gap controls; source only until Root runs in Guest.

Reuse the unchanged db13 selected-definition tool and e5f67 synthetic fixtures.
No original main/test suite runs. No template rendering, HTTP, app, pyc or EXE.
These four new methods never modify the original 23 or 14 assertions.
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PYTHON = Path('C:/Python314/python.exe')
if (os.name != 'nt' or os.path.normcase(str(ROOT)) != os.path.normcase('C:/xjy-work/xjy-web-stage1') or
        os.path.normcase(sys.executable) != os.path.normcase(str(PYTHON)) or
        not sys.flags.isolated or not sys.flags.no_site or not sys.flags.dont_write_bytecode or sys.flags.optimize):
    raise RuntimeError('Fixed actual offline Guest Python314 -I -B -S required; Host execution refused')

import argparse
import csv
from decimal import Decimal
import hashlib
import importlib.util
import io
import json
import re
import stat
import types
import unittest

SELF = 'audit-tools/strict-finance-170-post-green-extra.test.py'
ORIGINAL = 'audit-tools/finance-erp-170-accuracy.test.py'
ORIGINAL_SHA = 'db13aeb68a8eb42beb0528be714aa3a319bfdd77e89df7fe9422a417e540cf7a'
WEIGHT = 'audit-tools/finance-erp-round2-weight.test.py'
WEIGHT_SHA = 'e5f67c9316618c1fabbe6a3494fad3da9a10f15927e5edfc063642434d003190'
PYTHON_SHA = '434b361fe0c5960d404974feed493db47f2603a1ace2574312104fbed0182c6f'
PREFIX = 'project/desktop/legacy-source/ledger/'
PINS = {
    'finance.py': 'b33ea7cf1c6bbe19dcc871abcf3937de7bbcf485e9550431b95bf0f066c4fb50',
    'inventory_dashboard.py': '5bccab1515ce45186cfb6d500a8d8061e5985e57228958e0cb35fdee535d7c48',
    'reports.py': '15166bc7739e49fbb1d38cb88fb5893cda41469a0f2db86d2265993138e33e05',
    'app/templates/stock.html': '5bc247a812212118ed194e899b57e628d61ecc0851378d945eaea977b84d79e2',
    'app/templates/home.html': '77caa5fc0a4a1ca60ee070b095df072ae7902ddf5e5faeed31101f348466e131',
}
GUARDS = {
    'stage1/sandbox-context.py': '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
    'stage1/validate-sandbox-context.py': '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207',
}
BASE = WEIGHT_HELPER = None


def read(file, limit=1024*1024):
    for parent in (file, *file.parents):
        info = parent.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400 or stat.S_ISREG(info.st_mode) and info.st_nlink != 1:
            raise RuntimeError('Ordinary non-reparse single-link input required')
    before = file.stat()
    identity = lambda item: (item.st_dev, item.st_ino, item.st_size, item.st_mtime_ns, item.st_ctime_ns, item.st_nlink)
    if not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= limit:
        raise RuntimeError('Bounded ordinary input required')
    with file.open('rb') as stream:
        opened = os.fstat(stream.fileno())
        if any(getattr(before, field) != getattr(opened, field) for field in ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_nlink')):
            raise RuntimeError('Input changed before open')
        body = stream.read(limit+1)
        if len(body) != before.st_size or identity(os.fstat(stream.fileno())) != identity(opened):
            raise RuntimeError('Input changed during read')
    if identity(file.lstat()) != identity(before): raise RuntimeError('Input changed after read')
    return body


def pinned(file, expected):
    body = read(file)
    if hashlib.sha256(body).hexdigest() != expected: raise RuntimeError('Exact post-GREEN input changed: ' + str(file))
    return body


class PostGreenExtra(unittest.TestCase):
    def test_U01_unknown_status_bad_weight_is_visible_without_disabling_known_in_stock(self):
        with WEIGHT_HELPER.fixture([{'weight': 8}, {'weight': None, 'remark': '需要现场核对'}]) as (c, original):
            data = WEIGHT_HELPER.snapshot(c)
            self.assertEqual((data['overall']['unknown']['count'], data['overall']['unknown']['invalid_count']), (1, 1))
            self.assertFalse(data['overall']['unknown']['weight_complete'])
            self.assertEqual(data['rows'][1]['weight'], original[1]['weight']); self.assertTrue(data['rows'][1]['weight_issue'])
            self.assertEqual([row['id'] for row in data['invalid_rows']], [2])
            self.assertTrue(data['in_stock']['fine_complete']); self.assertEqual(data['in_stock']['fine_grams'], 7.6)
            self.assertEqual(data['alert']['status'], 'unset')

    def test_U02_supplier_groups_keep_counts_and_separate_raw_weight_from_relevant_fine_weight(self):
        with WEIGHT_HELPER.fixture([{'weight': 8, 'supplier': '虚构甲'},
                                    {'weight': None, 'supplier': '虚构甲', 'category': '黄金', 'product': '足金虚构链'},
                                    {'weight': -1, 'supplier': '虚构乙'}]) as (c, _):
            data = WEIGHT_HELPER.snapshot(c); groups = {row['name']: row for row in data['by_supplier']}
            self.assertEqual((groups['虚构甲']['count'], groups['虚构甲']['invalid_count']), (2, 1))
            self.assertFalse(groups['虚构甲']['weight_complete']); self.assertTrue(groups['虚构甲']['fine_complete'])
            self.assertEqual(groups['虚构甲']['fine_grams'], 7.6)
            self.assertEqual((groups['虚构乙']['count'], groups['虚构乙']['invalid_count']), (1, 1))
            self.assertFalse(groups['虚构乙']['weight_complete']); self.assertFalse(groups['虚构乙']['fine_complete'])
            categories = {row['name']: row for row in data['by_category']}
            self.assertFalse(categories['铂金']['fine_complete']); self.assertTrue(categories['黄金']['fine_complete'])

    def test_U03_unknown_status_bad_weight_is_counted_but_never_leaks_into_stock_or_platinum_grams(self):
        with WEIGHT_HELPER.fixture([{'weight': 8}, {'weight': 'NaN', 'remark': '在库;在途'}]) as (c, _):
            rows = WEIGHT_HELPER.snapshot(c)['rows']; api = BASE.report_source()
            stock = api.prepare('stock', rows, selected_metrics=['count', 'grams', 'unknown_count'])
            self.assertEqual(api.total(stock, ['count', 'grams', 'unknown_count']), {'count': Decimal(1), 'grams': Decimal(8), 'unknown_count': Decimal(1)})
            platinum = api.prepare('platinum', rows, selected_metrics=['fine_grams'])
            self.assertEqual(api.total(platinum, ['fine_grams'])['fine_grams'], Decimal('7.600'))

    def test_U04_expense_single_filter_empty_result_and_sql_text_keep_exact_bound_scope(self):
        with BASE.ledger_fixture() as c:
            injected = "虚构甲' OR 1=1 --"
            for key, employee, status in [(1, '虚构甲', '已审核'), (2, '虚构甲', '草稿'), (3, '虚构乙', '已审核'), (4, injected, '已审核')]:
                c.execute('INSERT INTO expenses VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', (key, '2026-10-10', employee, '其他', 'SYNTHETIC-' + str(key), 10, 0, 0, 10, 0, '单独支付', status))
            for args, expected in [({}, [1, 2, 3, 4]), ({'employee': '虚构甲'}, [1, 2]), ({'status': '已审核'}, [1, 3, 4]),
                                   ({'employee': '不存在的虚构人'}, []), ({'employee': injected}, [4])]:
                with self.subTest(args=args):
                    response = BASE.finance(c, args).expenses_export()
                    exported = list(csv.reader(io.StringIO(response.data.lstrip('\ufeff'))))
                    self.assertEqual([row[3] for row in exported[1:]], ['SYNTHETIC-' + str(key) for key in expected])


def main():
    parser = argparse.ArgumentParser(allow_abbrev=False)
    parser.add_argument('--test-sha256', required=True); parser.add_argument('--expected-namespace', required=True)
    args = parser.parse_args()
    if not re.fullmatch('[a-f0-9]{64}', args.test_sha256) or not re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', args.expected_namespace):
        raise RuntimeError('Root-frozen self SHA and actual handed-back namespace required')
    self_body = pinned(ROOT/SELF, args.test_sha256)
    pinned(PYTHON, PYTHON_SHA)
    if sys.version_info[:3] != (3, 14, 8) or importlib.util.MAGIC_NUMBER.hex() != '2b0e0d0a': raise RuntimeError('Fixed actual runtime required')
    guards = {name: pinned(ROOT/name, pin) for name, pin in GUARDS.items()}
    guard = types.ModuleType('post_green_extra_actual_context'); guard.__file__ = str(ROOT/'stage1/sandbox-context.py')
    exec(compile(guards['stage1/sandbox-context.py'], guard.__file__, 'exec', dont_inherit=True, optimize=0), guard.__dict__)
    proof = guard.read_context(ROOT)
    identity = read(ROOT/'isolation-identity.json')
    if json.loads(identity.decode('utf-8-sig')).get('namespace') != args.expected_namespace: raise RuntimeError('Actual handback namespace changed')
    original = pinned(ROOT/ORIGINAL, ORIGINAL_SHA); weight = pinned(ROOT/WEIGHT, WEIGHT_SHA)
    bodies = {name: pinned(ROOT/PREFIX/name, pin) for name, pin in PINS.items()}
    global BASE, WEIGHT_HELPER
    BASE = types.ModuleType('post_green_extra_frozen_db13'); BASE.__file__ = str(ROOT/ORIGINAL)
    exec(compile(original, BASE.__file__, 'exec', dont_inherit=True, optimize=0), BASE.__dict__)
    if BASE.BODIES != {} or BASE.GUARDS != GUARDS: raise RuntimeError('Original helper boundary changed')
    BASE.BODIES.update({name: bodies[name] for name in ('finance.py', 'inventory_dashboard.py', 'reports.py')})
    WEIGHT_HELPER = types.ModuleType('post_green_extra_frozen_e5f67'); WEIGHT_HELPER.__file__ = str(ROOT/WEIGHT)
    exec(compile(weight, WEIGHT_HELPER.__file__, 'exec', dont_inherit=True, optimize=0), WEIGHT_HELPER.__dict__)
    WEIGHT_HELPER.BASE = BASE
    sys.addaudithook(BASE.audit_boundary)
    print(json.dumps({'purpose': 'strict-finance170-post-green-four-gap-controls', 'actualContext': proof, 'namespace': args.expected_namespace,
                      'testSha256': args.test_sha256, 'originalHelperSha256': ORIGINAL_SHA, 'weightFixtureSha256': WEIGHT_SHA,
                      'sourcePins': PINS, 'originalSuitesRun': False, 'methods': 4, 'templatesRendered': False,
                      'originalHttpVerified': False, 'fullWorkflowAcceptance': False}), flush=True)
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(PostGreenExtra))
    for name, pin in PINS.items():
        if pinned(ROOT/PREFIX/name, pin) != bodies[name]: raise RuntimeError('Post-GREEN source changed during controls')
    if (pinned(ROOT/SELF, args.test_sha256) != self_body or pinned(ROOT/ORIGINAL, ORIGINAL_SHA) != original or
            pinned(ROOT/WEIGHT, WEIGHT_SHA) != weight or read(ROOT/'isolation-identity.json') != identity):
        raise RuntimeError('Test/helper/actual identity changed during controls')
    for name, pin in GUARDS.items():
        if pinned(ROOT/name, pin) != guards[name]: raise RuntimeError('Original guard changed during controls')
    pinned(PYTHON, PYTHON_SHA)
    print(json.dumps({'testsRun': result.testsRun, 'failures': len(result.failures), 'errors': len(result.errors), 'passed': result.wasSuccessful(),
                      'postflightPinsVerified': True, 'templatesRendered': False, 'originalHttpVerified': False}), flush=True)
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__': raise SystemExit(main())
