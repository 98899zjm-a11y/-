"""Two fixed actual-Guest controls/counterexamples; not a real-ledger diagnosis.

Only five reviewed definitions are selected from inventory_dashboard.py. No
business import/app factory/pyc/EXE/file database or original schema is used.
Root runs after the unchanged actual Guest guard admits this environment.
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
import contextlib
from decimal import Decimal, InvalidOperation
import hashlib
import importlib.util
import json
import re
import sqlite3
import stat
import types
import unittest

SELF = ROOT / 'audit-tools/platinum-state-readonly-test.py'
SOURCE = ROOT / 'project/desktop/legacy-source/ledger/inventory_dashboard.py'
GUARD = ROOT / 'stage1/sandbox-context.py'
VALIDATOR = ROOT / 'stage1/validate-sandbox-context.py'
GUARD_SHA = '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249'
VALIDATOR_SHA = '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207'
PYTHON_SHA = '434b361fe0c5960d404974feed493db47f2603a1ace2574312104fbed0182c6f'
BASELINE_SOURCE_SHA = 'e65660926f866f476603426dcbc28135c2fdb557a0c23f4e70b2dd3027620ac7'
SELECTED = ('inventory_state', 'platinum_identity', '_grams', '_thresholds', 'snapshot')
SUBJECT = None


def sha(body):
    return hashlib.sha256(body).hexdigest()


def read(file, limit=1024 * 1024):
    for parent in (file, *file.parents):
        info = parent.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
            raise RuntimeError('Reviewed source/runtime path cannot be a link')
        if stat.S_ISREG(info.st_mode) and info.st_nlink != 1:
            raise RuntimeError('Reviewed source/runtime cannot be hardlinked')
    if not file.is_file() or file.stat().st_size > limit:
        raise RuntimeError('Bounded ordinary source/runtime required')
    body = file.read_bytes()
    if len(body) > limit:
        raise RuntimeError('Source/runtime read limit exceeded')
    return body


def forbidden_database_connect(*args, **kwargs):
    raise AssertionError('Subject may only read the explicitly passed memory connection')


def extract(body):
    parsed = ast.parse(body, filename=str(SOURCE))
    definitions = []
    for name in SELECTED:
        matches = [node for node in parsed.body if isinstance(node, ast.FunctionDef) and node.name == name]
        if len(matches) != 1 or matches[0].decorator_list:
            raise RuntimeError('One undecorated reviewed definition required: ' + name)
        definitions.append(matches[0])
    selected = ast.Module(body=definitions, type_ignores=[])
    for node in ast.walk(selected):
        if isinstance(node, (ast.Import, ast.ImportFrom, ast.ClassDef, ast.AsyncFunctionDef)):
            raise RuntimeError('Only the fixed pure definitions may be selected')
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in ('exec', 'eval', 'compile', '__import__', 'open', 'input'):
            raise RuntimeError('Unreviewed executable/IO port in selected definitions')
    namespace = {'__name__': 'platinum_state_reviewed_definitions', 'Decimal': Decimal,
                 'InvalidOperation': InvalidOperation, 're': re, 'contextlib': contextlib,
                 'db': types.SimpleNamespace(now_str=lambda: '2026-10-18T12:00:00', connect=forbidden_database_connect)}
    # Execute only these AST definitions. No original imports/decorators/routes,
    # app initialization, SQL writer or opaque pyc is compiled/executed.
    exec(compile(selected, str(SOURCE), 'exec', dont_inherit=True, optimize=0), namespace)
    return namespace


def row(identifier, *, product='PT950合成链', category='铂金', weight='1.00', remark='在库', sell_date=''):
    return (identifier, category, product, weight, remark, sell_date, '虚构供货商')


def snapshot(records):
    # Deliberately simplified memory fixture: TEXT weight preserves literal
    # inputs for the selected read path. This is NOT the original app/db DDL,
    # does not prove the original schema permits any particular write, and does
    # not use even a copied real customer's data.
    with contextlib.closing(sqlite3.connect(':memory:')) as connection:
        connection.row_factory = sqlite3.Row
        connection.execute('CREATE TABLE stock_items(id INTEGER PRIMARY KEY,category TEXT NOT NULL,product TEXT NOT NULL,weight TEXT NOT NULL,remark TEXT NOT NULL,sell_date TEXT NOT NULL,supplier TEXT NOT NULL)')
        connection.executemany('INSERT INTO stock_items VALUES(?,?,?,?,?,?,?)', records)
        connection.commit()
        before = [tuple(item) for item in connection.execute('SELECT * FROM stock_items ORDER BY id')]
        connection.execute('PRAGMA query_only=ON')
        result = SUBJECT['snapshot'](connection)
        after = [tuple(item) for item in connection.execute('SELECT * FROM stock_items ORDER BY id')]
        if after != before:
            raise AssertionError('Selected snapshot changed the synthetic input rows')
        return result


class PlatinumState(unittest.TestCase):
    def test_S00_literal_pt950_control_and_existing_state_and_conversion_rules(self):
        result = snapshot([
            row(1, weight='3.12'), row(2, weight='4.88'),
            row(3, product='AU999合成金戒', category='黄金', weight='2.00'),
            row(4, weight='5.00', remark='在途'),
            row(5, weight='6.00', remark='已售2026.10.18'),
            row(6, weight='7.00', remark='在库', sell_date='2026-10-18'),
        ])
        # Independent literal expectations, not sums/factors derived from the
        # implementation under test. Exactly two in-stock PT950 records.
        self.assertEqual(result['in_stock']['pt950'], {'count': 2, 'grams': 8.00, 'fine_grams': 7.60})
        self.assertEqual(result['in_stock']['fine_grams'], 7.60)
        self.assertEqual(result['transit']['pt950'], {'count': 1, 'grams': 5.00, 'fine_grams': 4.75})
        self.assertEqual(result['overall'], {
            'in_stock': {'count': 3, 'grams': 10.00}, 'transit': {'count': 1, 'grams': 5.00},
            'sold': {'count': 2, 'grams': 13.00}, 'unknown': {'count': 0, 'grams': 0.00},
        })
        actual = {item['id']: item for item in result['rows']}
        self.assertEqual(actual[3]['platinum_bucket'], 'other')
        self.assertIsNone(actual[3]['fine_grams'])
        self.assertEqual(actual[4]['inventory_state'], '在途')
        self.assertEqual(actual[5]['inventory_state'], '已售')
        self.assertEqual(actual[6]['inventory_state'], '已售', 'An actual recorded sale date must still win over an in-stock remark')
        self.assertEqual(SUBJECT['platinum_identity']({'category': '铂金板料', 'product': 'PT950合成板料'}), ('fine_board', Decimal('1')))
        self.assertEqual(SUBJECT['platinum_identity']({'category': '铂金', 'product': 'PT999.5合成金豆'}), ('fine_board', Decimal('1')))

    def test_S01_negation_and_appendix_are_not_effective_sale_or_transit_events(self):
        # These are code-level counterexamples only. No statement is made that
        # any of these strings occurs in the user's actual inventory records.
        remarks = ('未售出', '不是在途，已入库', '在库；备注：该款有已售样品')
        result = snapshot([row(index + 1, remark=remark) for index, remark in enumerate(remarks)] + [
            row(4, remark='在库；备注：该款有已售样品', sell_date='2026-10-18')])
        actual = {item['id']: item['inventory_state'] for item in result['rows']}
        # A real, valid nonempty sale-date field still controls the node. This
        # counterexample must not "fix" stock by changing that existing rule.
        self.assertEqual(actual[4], '已售')
        violations = [{'remark': remark, 'actual': actual[index + 1], 'allowed': ['在库', '待确认']}
                      for index, remark in enumerate(remarks) if actual[index + 1] not in ('在库', '待确认')]
        self.assertEqual(violations, [], 'Negated words or appendix examples cannot assert an effective stock sale/transit; 待确认 is allowed')


def main():
    global SUBJECT
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--source-sha256', required=True, help='Root-pinned test source SHA256')
    parser.add_argument('--subject-sha256', required=True, help='Root-pinned currently reviewed inventory_dashboard.py SHA256')
    args = parser.parse_args()
    if not all(re.fullmatch('[0-9a-f]{64}', value) for value in (args.source_sha256, args.subject_sha256)):
        raise RuntimeError('Root test and subject SHA256 required')
    if sha(read(SELF)) != args.source_sha256 or sha(read(PYTHON)) != PYTHON_SHA:
        raise RuntimeError('Pinned test/public runtime changed')
    if sha(read(GUARD)) != GUARD_SHA or sha(read(VALIDATOR)) != VALIDATOR_SHA:
        raise RuntimeError('Original actual Guest guard changed')
    if sys.version_info[:3] != (3, 14, 8) or importlib.util.MAGIC_NUMBER.hex() != '2b0e0d0a':
        raise RuntimeError('Fixed public Guest Python 3.14.8 required')
    guard = types.ModuleType('platinum_state_actual_context')
    guard.__file__ = str(GUARD)
    exec(compile(read(GUARD), str(GUARD), 'exec', dont_inherit=True, optimize=0), guard.__dict__)
    admission = guard.read_context(ROOT)
    body = read(SOURCE)
    if sha(body) != args.subject_sha256:
        raise RuntimeError('Reviewed inventory source changed')
    SUBJECT = extract(body)
    print(json.dumps({'purpose': 'platinum-state-control-and-counterexample', 'scope': 'actual-Guest-five-AST-definitions-memory-fixture',
                      'admission': admission, 'testSourceSha256': args.source_sha256, 'subjectSourceSha256': sha(body),
                      'baselineSubjectSha256': BASELINE_SOURCE_SHA, 'definitions': list(SELECTED), 'tests': 2,
                      'originalDdlVerified': False, 'businessImported': False, 'realLedgerReadOrChanged': False,
                      'actualInventoryCauseEstablished': False}), flush=True)
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(PlatinumState))
    print(json.dumps({'testsRun': result.testsRun, 'failures': len(result.failures), 'errors': len(result.errors),
                      'passed': result.wasSuccessful(), 'actualInventoryCauseEstablished': False}), flush=True)
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    raise SystemExit(main())
