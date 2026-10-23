"""One Guest-only AST policy contract; no sidecar or HTTP execution.

After the unchanged actual Guest guard admits the fixed runtime, inspect only
READ_ENDPOINTS' literal and a digest of the remaining AST. Never execute/import
the subject, its decorators, policy loops, gate, app, pyc, EXE or database.
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
import copy
import hashlib
import importlib.util
import json
import re
import stat
import types
import unittest

SELF = ROOT / 'audit-tools/inventory-export-policy-test.py'
SOURCE = ROOT / 'project/desktop/legacy-source/sidecar_release.py'
GUARD = ROOT / 'stage1/sandbox-context.py'
VALIDATOR = ROOT / 'stage1/validate-sandbox-context.py'
GUARD_SHA = '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249'
VALIDATOR_SHA = '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207'
PYTHON_SHA = '434b361fe0c5960d404974feed493db47f2603a1ace2574312104fbed0182c6f'
BASELINE_SOURCE_SHA = '3fb61be8039ce507fd862643047cb62260ae53eda0d220bec4b434306cdfec81'
BASELINE_LITERAL_SHA = 'd5deaceff60781ba9230fbfba3e4c270faf4979472d444c6742aaa215c3779e2'
BASELINE_OTHER_AST_SHA = '1ca0e285c5556a0abe1b4c1589b502022a948d15d4277adb8de89e2e61be13db'
ENDPOINT = 'inventory_dashboard.export_stock'
PLACEHOLDER = 'READ_ENDPOINTS_LITERAL_REVIEWED_SEPARATELY'
SUBJECT_TREE = None


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


class InventoryExportPolicy(unittest.TestCase):
    def test_P01_exact_export_parameters_leave_original_policy_and_other_ast_intact(self):
        # A missing/wrong new grant, any changed prior endpoint/parameter, or
        # any changed gate/primary_read/SQL-readonly/ERP code must fail here.
        assignments = [(index, node) for index, node in enumerate(SUBJECT_TREE.body)
                       if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'READ_ENDPOINTS' for target in node.targets)]
        self.assertEqual(len(assignments), 1, 'One original READ_ENDPOINTS literal assignment required')
        index, assignment = assignments[0]
        mapping = ast.literal_eval(assignment.value)
        self.assertIsInstance(mapping, dict)
        self.assertEqual(set(mapping), {'ledger', 'inventory'})
        self.assertIsInstance(mapping['ledger'], dict)
        self.assertIsInstance(mapping['inventory'], dict)
        self.assertEqual(mapping['ledger'].get(ENDPOINT), 'state cat sup kw',
                         'INVENTORY_EXPORT_READ_POLICY_REQUIRED: exact new endpoint and four parameters')
        original = copy.deepcopy(mapping)
        del original['ledger'][ENDPOINT]
        canonical = json.dumps(original, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
        self.assertEqual(sha(canonical), BASELINE_LITERAL_SHA,
                         'All original ledger/inventory literal grants and parameters must be unchanged')
        remainder = copy.deepcopy(SUBJECT_TREE)
        remainder.body[index].value = ast.Constant(value=PLACEHOLDER)
        other_ast = ast.dump(remainder, annotate_fields=True, include_attributes=False).encode('utf-8')
        self.assertEqual(sha(other_ast), BASELINE_OTHER_AST_SHA,
                         'Only the reviewed literal entry may change; all other sidecar AST must remain')


def main():
    global SUBJECT_TREE
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--source-sha256', required=True, help='Root-pinned test source SHA256')
    parser.add_argument('--subject-sha256', required=True, help='Root-pinned sidecar_release.py source SHA256')
    args = parser.parse_args()
    if not all(re.fullmatch('[0-9a-f]{64}', value) for value in (args.source_sha256, args.subject_sha256)):
        raise RuntimeError('Root test and subject SHA256 required')
    if sha(read(SELF)) != args.source_sha256 or sha(read(PYTHON)) != PYTHON_SHA:
        raise RuntimeError('Pinned test/public runtime changed')
    if sha(read(GUARD)) != GUARD_SHA or sha(read(VALIDATOR)) != VALIDATOR_SHA:
        raise RuntimeError('Original actual Guest guard changed')
    if sys.version_info[:3] != (3, 14, 8) or importlib.util.MAGIC_NUMBER.hex() != '2b0e0d0a':
        raise RuntimeError('Fixed public Guest Python 3.14.8 required')
    guard = types.ModuleType('inventory_export_policy_actual_context')
    guard.__file__ = str(GUARD)
    exec(compile(read(GUARD), str(GUARD), 'exec', dont_inherit=True, optimize=0), guard.__dict__)
    admission = guard.read_context(ROOT)
    body = read(SOURCE)
    if sha(body) != args.subject_sha256:
        raise RuntimeError('Reviewed sidecar source changed')
    SUBJECT_TREE = ast.parse(body, filename=str(SOURCE))
    print(json.dumps({'purpose': 'inventory-export-exact-read-allowlist', 'scope': 'actual-Guest-AST-literal-only',
                      'admission': admission, 'testSourceSha256': args.source_sha256, 'subjectSourceSha256': sha(body),
                      'baselineSubjectSha256': BASELINE_SOURCE_SHA, 'baselineLiteralCanonicalSha256': BASELINE_LITERAL_SHA,
                      'baselineOtherAstSha256': BASELINE_OTHER_AST_SHA, 'tests': 1,
                      'subjectExecutedOrImported': False, 'liveHttpVerified': False, 'databaseUsed': False}), flush=True)
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(InventoryExportPolicy))
    print(json.dumps({'testsRun': result.testsRun, 'failures': len(result.failures), 'errors': len(result.errors),
                      'passed': result.wasSuccessful(), 'liveHttpVerified': False}), flush=True)
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    raise SystemExit(main())
