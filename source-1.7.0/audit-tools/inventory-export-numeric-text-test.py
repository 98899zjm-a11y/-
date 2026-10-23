"""One Guest-only numeric/text CSV boundary using the fixed v2 test harness.

The actual Guest guard runs first. Load only pinned known test-module bytes
under a non-main name; never invoke its main or old test suite. The harness
selects the actual three inventory definitions, csv_export_cell and fmt2.
No real DB, HTTP, opaque handler, business import or EXE runs.
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
import copy
import hashlib
import importlib.util
import json
import re
import stat
import types
import unittest

SELF = ROOT / 'audit-tools/inventory-export-numeric-text-test.py'
HARNESS = ROOT / 'audit-tools/inventory-filter-export-v2-test.py'
GUARD = ROOT / 'stage1/sandbox-context.py'
VALIDATOR = ROOT / 'stage1/validate-sandbox-context.py'
GUARD_SHA = '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249'
VALIDATOR_SHA = '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207'
PYTHON_SHA = '434b361fe0c5960d404974feed493db47f2603a1ace2574312104fbed0182c6f'
HARNESS_SHA = '49ede737abae840900d2652083a0dc50535ebb9a52588c2e6dbae32451112e45'
BASELINE_SOURCE_SHA = 'fc98dcf15da4a1e2a2849b957470f76f5c71b9fca0c71bf088ad677e983e4ee9'
H = None


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


class InventoryExportNumericText(unittest.TestCase):
    def test_N01_finite_negative_scientific_number_stays_numeric_and_formulas_stay_text(self):
        # Literal expectations do not call the subject, fmt2 or a mirror regex.
        # Broadening to arbitrary -/+ expressions must fail the same contract.
        controls = [(-1e30, '-1e+30'), (-12.5, '-12.50'),
                    ('-1+2', "'-1+2"), ('=1+1', "'=1+1"), ('@SUM(1,2)', "'@SUM(1,2)")]
        for value, expected in controls:
            with self.subTest(value=value, expected=expected):
                record = H.row(71, 701, '在库', weight=2.0)
                record.update(cost=value, sell_price=value, profit_c=value)
                data = H.configure_ports([record], {'state': '全部'}); before = copy.deepcopy(data)
                parsed = H.decode_csv(H.SUBJECT['export_stock']())
                self.assertEqual(parsed[0], H.HEADERS)
                self.assertEqual(len(parsed), 2)
                self.assertEqual(len(parsed[1]), 13)
                self.assertEqual(parsed[1][0], '701')
                self.assertEqual(parsed[1][5], '2.0')
                self.assertEqual(parsed[1][6:9], [expected, expected, expected],
                                 'Finite scientific money is numeric; invalid formula text still requires its prefix')
                self.assertEqual(data, before, 'CSV formatting cannot change the synthetic snapshot')


def main():
    global H
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--source-sha256', required=True, help='Root-pinned new test source SHA256')
    parser.add_argument('--subject-sha256', required=True, help='Root-pinned reviewed inventory source SHA256')
    args = parser.parse_args()
    if not all(re.fullmatch('[0-9a-f]{64}', value) for value in (args.source_sha256, args.subject_sha256)):
        raise RuntimeError('Root test and subject SHA256 required')
    if sha(read(SELF)) != args.source_sha256 or sha(read(PYTHON)) != PYTHON_SHA:
        raise RuntimeError('Pinned test/public runtime changed')
    if sha(read(GUARD)) != GUARD_SHA or sha(read(VALIDATOR)) != VALIDATOR_SHA:
        raise RuntimeError('Original actual Guest guard changed')
    if sys.version_info[:3] != (3, 14, 8) or importlib.util.MAGIC_NUMBER.hex() != '2b0e0d0a':
        raise RuntimeError('Fixed public Guest Python 3.14.8 required')
    guard = types.ModuleType('inventory_export_numeric_actual_context')
    guard.__file__ = str(GUARD)
    exec(compile(read(GUARD), str(GUARD), 'exec', dont_inherit=True, optimize=0), guard.__dict__)
    admission = guard.read_context(ROOT)
    harness_body = read(HARNESS)
    if sha(harness_body) != HARNESS_SHA:
        raise RuntimeError('Frozen v2 harness changed')
    H = types.ModuleType('inventory_export_numeric_fixed_v2_harness')
    H.__file__ = str(HARNESS)
    # Load exactly the pinned known test bytes; non-main name avoids its main.
    # No sys.modules substitute, business module import or old tests are used.
    exec(compile(harness_body, str(HARNESS), 'exec', dont_inherit=True, optimize=0), H.__dict__)
    body, finance_body, presentation_body = read(H.SOURCE), read(H.FINANCE), read(H.PRESENTATION)
    if (sha(body) != args.subject_sha256 or sha(finance_body) != H.FINANCE_SHA or
            sha(presentation_body) != H.PRESENTATION_SHA):
        raise RuntimeError('Reviewed inventory/finance/presentation source changed')
    H.SUBJECT, H.DEFINITIONS = H.extract(body, finance_body, presentation_body)
    if any(name not in H.SUBJECT for name in H.SELECTED):
        raise RuntimeError('Previously delivered export definitions required for this narrow regression')
    print(json.dumps({'purpose': 'inventory-export-numeric-versus-text', 'scope': 'actual-Guest-fixed-v2-harness-explicit-ports',
                      'admission': admission, 'testSourceSha256': args.source_sha256, 'harnessSourceSha256': HARNESS_SHA,
                      'subjectSourceSha256': sha(body), 'baselineSubjectSha256': BASELINE_SOURCE_SHA,
                      'financeSourceSha256': sha(finance_body), 'presentationSourceSha256': sha(presentation_body),
                      'tests': 1, 'harnessMainCalled': False, 'oldTestsRun': False,
                      'liveHttpVerified': False, 'databaseUsed': False, 'businessImported': False}), flush=True)
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(InventoryExportNumericText))
    print(json.dumps({'testsRun': result.testsRun, 'failures': len(result.failures), 'errors': len(result.errors),
                      'passed': result.wasSuccessful(), 'liveHttpVerified': False}), flush=True)
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    raise SystemExit(main())
