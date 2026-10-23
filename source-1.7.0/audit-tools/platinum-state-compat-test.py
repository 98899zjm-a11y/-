"""Three finite actual-Guest state-compatibility contracts; no ledger diagnosis.

Only the same five reviewed AST definitions are selected. This tool calls only
inventory_state: no SQLite import/connection, writer, app, pyc or EXE is used.
Root alone executes after the unchanged actual-Guest admission.
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
import stat
import types
import unittest

SELF = ROOT / 'audit-tools/platinum-state-compat-test.py'
SOURCE = ROOT / 'project/desktop/legacy-source/ledger/inventory_dashboard.py'
REFERENCE = ROOT / 'audit-tools/platinum-state-readonly-test.py'
GUARD = ROOT / 'stage1/sandbox-context.py'
VALIDATOR = ROOT / 'stage1/validate-sandbox-context.py'
GUARD_SHA = '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249'
VALIDATOR_SHA = '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207'
PYTHON_SHA = '434b361fe0c5960d404974feed493db47f2603a1ace2574312104fbed0182c6f'
REFERENCE_SHA = '161cd7df503f92954d65b8f31c9d0e8b60d52fd0e220821c19a015b4329e41d4'
BASELINE_SOURCE_SHA = 'e65660926f866f476603426dcbc28135c2fdb557a0c23f4e70b2dd3027620ac7'
SELECTED = ('inventory_state', 'platinum_identity', '_grams', '_thresholds', 'snapshot')
SUBJECT = None


def sha(body):
    return hashlib.sha256(body).hexdigest()


def read(file, limit=1024 * 1024):
    for parent in (file, *file.parents):
        info = parent.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
            raise RuntimeError('Reviewed path cannot be a link')
        if stat.S_ISREG(info.st_mode) and info.st_nlink != 1:
            raise RuntimeError('Reviewed file cannot be hardlinked')
    if not file.is_file() or file.stat().st_size > limit:
        raise RuntimeError('Bounded ordinary source/runtime required')
    body = file.read_bytes()
    if len(body) > limit:
        raise RuntimeError('Read limit exceeded')
    return body


def forbidden_connect(*args, **kwargs):
    raise AssertionError('Pure state control must not connect a database')


def extract(body):
    parsed = ast.parse(body, filename=str(SOURCE))
    definitions = []
    for name in SELECTED:
        matches = [node for node in parsed.body if isinstance(node, ast.FunctionDef) and node.name == name]
        if len(matches) != 1 or matches[0].decorator_list:
            raise RuntimeError('One complete undecorated reviewed definition required: ' + name)
        definitions.append(matches[0])
    selected = ast.Module(body=definitions, type_ignores=[])
    for node in ast.walk(selected):
        if isinstance(node, (ast.Import, ast.ImportFrom, ast.ClassDef, ast.AsyncFunctionDef)):
            raise RuntimeError('Only the fixed reviewed definitions are admitted')
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in ('exec', 'eval', 'compile', '__import__', 'open', 'input'):
            raise RuntimeError('Unreviewed execution/IO callable in selected definitions')
    namespace = {'__name__': 'platinum_state_compat_reviewed_definitions', 'Decimal': Decimal,
                 'InvalidOperation': InvalidOperation, 're': re, 'contextlib': contextlib,
                 'db': types.SimpleNamespace(now_str=lambda: '2026-10-18T12:00:00', connect=forbidden_connect)}
    exec(compile(selected, str(SOURCE), 'exec', dont_inherit=True, optimize=0), namespace)
    return namespace


class PlatinumStateCompatibility(unittest.TestCase):
    def check_cases(self, label, cases):
        observations = []
        for remark, sell_date, expected in cases:
            row = {'remark': remark, 'sell_date': sell_date}
            before = dict(row)
            actual = SUBJECT['inventory_state'](row)
            self.assertEqual(row, before, 'State reader must not mutate its input')
            observations.append({'remark': remark, 'sell_date': sell_date, 'expected': expected, 'actual': actual})
        print(json.dumps({'control': label, 'literalCases': observations}, ensure_ascii=False), flush=True)
        self.assertEqual([row for row in observations if row['actual'] != row['expected']], [], label)

    def test_C00_normal_aliases_and_original_generated_date_form_remain_compatible(self):
        # Dot date and semicolon format come from inventory_dashboard._remark
        # and repairs.mark_stock. Neither writer is extracted or executed here.
        self.check_cases('ordinary literal state compatibility', (
            ('', '', '在库'), (None, None, '在库'),
            ('在库', '', '在库'), ('现货', '', '在库'), ('已入库', '', '在库'),
            ('在途', '', '在途'), ('途中', '', '在途'), ('待到货', '', '在途'), ('未到货', '', '在途'),
            ('已售', '', '已售'), ('售出', '', '已售'), ('已卖', '', '已售'),
            ('已售2026.10.18', '', '已售'),
            ('已售2026.10.18；虚构核对说明', '', '已售'),
            ('待确认', '', '待确认'),
        ))

    def test_C01_finite_negation_conflicts_and_nonstate_mentions_require_confirmation(self):
        # Finite ambiguous examples only: no classifier for all freeform prose,
        # dispatch/cancellation events, or a new sale-effective business rule.
        self.check_cases('ambiguous text stays pending rather than guessed in stock', (
            ('未售出', '', '待确认'), ('尚未售出', '', '待确认'),
            ('不是在途，已入库', '', '待确认'),
            ('在库或在途', '', '待确认'), ('已售/在库', '', '待确认'),
            ('在库已售', '', '待确认'), ('已入库在途', '', '待确认'),
            ('备注：该款有已售样品', '', '待确认'),
        ))

    def test_C02_actual_sale_date_wins_and_explicit_prefix_survives_appendix_words(self):
        # Valid recorded sale dates keep their original authority. Invalid or
        # noncanonical dates are outside this contract and are not normalized.
        self.check_cases('recorded ISO sale date has priority', (
            ('', '2026-10-18', '已售'), ('在库', '2026-10-18', '已售'),
            ('未售出', '2026-10-18', '已售'), ('在途', '2026-10-18', '已售'),
            ('在库；备注：该款有已售样品', '2026-10-18', '已售'),
        ))
        self.check_cases('explicit state prefix cannot be replaced by appendix examples', (
            ('在库；备注：该款有已售样品', '', '在库'),
            ('在库；附注：另一件在途，仅供参考', '', '在库'),
            ('在途；备注：同款已售样品另件', '', '在途'),
            ('在途；附注：柜台另有现货样品', '', '在途'),
            ('已售2026.10.18；附注：此前在途', '', '已售'),
        ))


def main():
    global SUBJECT
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--source-sha256', required=True)
    parser.add_argument('--subject-sha256', required=True)
    args = parser.parse_args()
    if not all(re.fullmatch('[0-9a-f]{64}', value) for value in (args.source_sha256, args.subject_sha256)):
        raise RuntimeError('Root-pinned test and subject SHA256 required')
    if sha(read(SELF)) != args.source_sha256 or sha(read(PYTHON)) != PYTHON_SHA or sha(read(REFERENCE)) != REFERENCE_SHA:
        raise RuntimeError('Pinned new test/runtime or original161cd changed')
    if sha(read(GUARD)) != GUARD_SHA or sha(read(VALIDATOR)) != VALIDATOR_SHA:
        raise RuntimeError('Original actual-Guest guard changed')
    if sys.version_info[:3] != (3, 14, 8) or importlib.util.MAGIC_NUMBER.hex() != '2b0e0d0a':
        raise RuntimeError('Fixed public Guest Python3.14.8 required')
    guard = types.ModuleType('platinum_state_compat_actual_context')
    guard.__file__ = str(GUARD)
    exec(compile(read(GUARD), str(GUARD), 'exec', dont_inherit=True, optimize=0), guard.__dict__)
    admission = guard.read_context(ROOT)
    body = read(SOURCE)
    if sha(body) != args.subject_sha256:
        raise RuntimeError('Reviewed inventory source changed')
    SUBJECT = extract(body)
    print(json.dumps({'purpose': 'platinum-state-finite-compatibility', 'admission': admission,
                      'testSourceSha256': args.source_sha256, 'subjectSourceSha256': sha(body),
                      'baselineSubjectSha256': BASELINE_SOURCE_SHA, 'reference161cdPreserved': True,
                      'definitionsSelected': list(SELECTED), 'definitionsCalled': ['inventory_state'], 'tests': 3,
                      'sqliteImportedOrOpened': False, 'writerOrPycExecuted': False,
                      'realLedgerReadOrChanged': False, 'actualInventoryCauseEstablished': False}), flush=True)
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(PlatinumStateCompatibility))
    print(json.dumps({'testsRun': result.testsRun, 'failures': len(result.failures), 'errors': len(result.errors),
                      'passed': result.wasSuccessful(), 'actualInventoryCauseEstablished': False}), flush=True)
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    raise SystemExit(main())
