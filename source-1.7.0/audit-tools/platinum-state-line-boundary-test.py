"""One finite Guest-only appendix-line boundary contract; no ledger diagnosis.

The admission and five-definition AST boundary match the frozen compat tool.
Only inventory_state is called. No SQLite, writer, app, pyc or EXE is used.
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

SELF = ROOT / 'audit-tools/platinum-state-line-boundary-test.py'
SOURCE = ROOT / 'project/desktop/legacy-source/ledger/inventory_dashboard.py'
GUARD = ROOT / 'stage1/sandbox-context.py'
VALIDATOR = ROOT / 'stage1/validate-sandbox-context.py'
GUARD_SHA = '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249'
VALIDATOR_SHA = '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207'
PYTHON_SHA = '434b361fe0c5960d404974feed493db47f2603a1ace2574312104fbed0182c6f'
REFERENCES = {
    'audit-tools/platinum-state-readonly-test.py': '161cd7df503f92954d65b8f31c9d0e8b60d52fd0e220821c19a015b4329e41d4',
    'audit-tools/platinum-state-compat-test.py': 'c577fe27f7d49940d186a71308a53dc9d1dbb99f455b1c171869cd5ba07fa333',
}
RED_SUBJECT_SHA = 'af351a9753f5dc7e953d7f4f5fe70c7fc813f0720aca7188a789da089a9fede4'
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
    raise AssertionError('Pure state boundary control must not connect a database')


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
    namespace = {'__name__': 'platinum_state_line_boundary_definitions', 'Decimal': Decimal,
                 'InvalidOperation': InvalidOperation, 're': re, 'contextlib': contextlib,
                 'db': types.SimpleNamespace(now_str=lambda: '2026-10-18T12:00:00', connect=forbidden_connect)}
    exec(compile(selected, str(SOURCE), 'exec', dont_inherit=True, optimize=0), namespace)
    return namespace


class PlatinumStateLineBoundary(unittest.TestCase):
    def test_D01_same_line_appendix_cannot_swallow_an_independent_next_line_state(self):
        cases = (
            ('same-line appendix', '在库；附注：另一件在途，仅供参考', '', '在库'),
            ('same-line sold sample', '在库；备注：该款有已售样品', '', '在库'),
            ('independent next-line sale', '在库；备注：虚构样品说明\n已售2026.10.18', '', '待确认'),
            ('independent next-line transit', '在库；附注：另一件在途，仅供参考\n在途', '', '待确认'),
            ('independent CRLF denial', '在库；说明：仅为当前行附注\r\n未在库', '', '待确认'),
            ('independent next-line denial', '在库；备注：虚构说明\n不是在库', '', '待确认'),
            ('recorded sale date wins over transit', '在库；附注：另一件在途，仅供参考\n在途', '2026-10-18', '已售'),
            ('recorded sale date wins over denial', '在库；说明：仅为当前行附注\r\n未在库', '2026-10-18', '已售'),
        )
        observations = []
        for label, remark, sell_date, expected in cases:
            row = {'remark': remark, 'sell_date': sell_date}
            before = dict(row)
            actual = SUBJECT['inventory_state'](row)
            self.assertEqual(row, before, 'State reader must not mutate the fictional row')
            observations.append({'case': label, 'remark': remark, 'sell_date': sell_date,
                                 'expected': expected, 'actual': actual})
        print(json.dumps({'control': 'D01', 'literalCases': observations}, ensure_ascii=False), flush=True)
        self.assertEqual([row for row in observations if row['actual'] != row['expected']], [],
                         'A same-line appendix must not absorb a separate next-line state conflict')


def main():
    global SUBJECT
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--source-sha256', required=True)
    parser.add_argument('--subject-sha256', required=True)
    args = parser.parse_args()
    if not all(re.fullmatch('[0-9a-f]{64}', value) for value in (args.source_sha256, args.subject_sha256)):
        raise RuntimeError('Root-pinned test and subject SHA256 required')
    if sha(read(SELF)) != args.source_sha256 or sha(read(PYTHON)) != PYTHON_SHA:
        raise RuntimeError('Pinned new test or public runtime changed')
    for relative, pin in REFERENCES.items():
        if sha(read(ROOT / relative)) != pin:
            raise RuntimeError('Original frozen 2/3-method tests changed')
    if sha(read(GUARD)) != GUARD_SHA or sha(read(VALIDATOR)) != VALIDATOR_SHA:
        raise RuntimeError('Original actual-Guest guard changed')
    if sys.version_info[:3] != (3, 14, 8) or importlib.util.MAGIC_NUMBER.hex() != '2b0e0d0a':
        raise RuntimeError('Fixed public Guest Python3.14.8 required')
    guard = types.ModuleType('platinum_state_line_boundary_actual_context')
    guard.__file__ = str(GUARD)
    exec(compile(read(GUARD), str(GUARD), 'exec', dont_inherit=True, optimize=0), guard.__dict__)
    admission = guard.read_context(ROOT)
    body = read(SOURCE)
    if sha(body) != args.subject_sha256:
        raise RuntimeError('Reviewed inventory source changed')
    SUBJECT = extract(body)
    print(json.dumps({'purpose': 'platinum-state-one-line-appendix-boundary', 'admission': admission,
                      'testSourceSha256': args.source_sha256, 'subjectSourceSha256': sha(body),
                      'redSubjectSha256': RED_SUBJECT_SHA, 'frozen2And3MethodTestsPreserved': True,
                      'definitionsSelected': list(SELECTED), 'definitionsCalled': ['inventory_state'], 'tests': 1,
                      'sqliteImportedOrOpened': False, 'writerOrPycExecuted': False,
                      'realLedgerReadOrChanged': False, 'actualInventoryCauseEstablished': False}), flush=True)
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(PlatinumStateLineBoundary))
    print(json.dumps({'testsRun': result.testsRun, 'failures': len(result.failures), 'errors': len(result.errors),
                      'passed': result.wasSuccessful(), 'actualInventoryCauseEstablished': False}), flush=True)
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    raise SystemExit(main())
