"""Root-only candidate admission for the original, unchanged db13 Accuracy class.

All 23 original methods/assertions execute verbatim from the exact frozen helper.
Its main() is never called: its old source PINS are not candidate provenance.
This entry independently admits seven fixed candidate source bytes, then supplies
only those bytes to the original selected-definition tool. No app/pyc/EXE import,
opaque rule execution, file SQLite, production data or HTTP/UI acceptance.
Root captures stdout/stderr externally; this entry creates no result files.
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PYTHON = Path('C:/Python314/python.exe')
if (os.name != 'nt' or os.path.normcase(str(ROOT)) != os.path.normcase('C:/xjy-work/xjy-web-stage1') or
        os.path.normcase(sys.executable) != os.path.normcase(str(PYTHON)) or
        not sys.flags.isolated or not sys.flags.no_site or not sys.flags.dont_write_bytecode or sys.flags.optimize):
    raise RuntimeError('Fixed actual Guest Python314 -I -B -S required; Host execution refused')

import argparse
import hashlib
import importlib.util
import json
import re
import stat
import types
import unittest

SELF = 'audit-tools/finance-erp170-candidate-accuracy.py'
PIN_FILE = 'audit-tools/finance-erp170-candidate-accuracy-pins.json'
HELPER = 'audit-tools/finance-erp-170-accuracy.test.py'
HELPER_SHA = 'db13aeb68a8eb42beb0528be714aa3a319bfdd77e89df7fe9422a417e540cf7a'
PYTHON_SHA = '434b361fe0c5960d404974feed493db47f2603a1ace2574312104fbed0182c6f'
PREFIX = 'project/desktop/legacy-source/ledger/'
GUARDS = {
    'stage1/sandbox-context.py': '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
    'stage1/validate-sandbox-context.py': '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207',
}
CANDIDATE_PINS = {
    'finance.py': 'b33ea7cf1c6bbe19dcc871abcf3937de7bbcf485e9550431b95bf0f066c4fb50',
    'inventory_dashboard.py': '5bccab1515ce45186cfb6d500a8d8061e5985e57228958e0cb35fdee535d7c48',
    'reports.py': '15166bc7739e49fbb1d38cb88fb5893cda41469a0f2db86d2265993138e33e05',
    'rule_engine.py': '370320046ac609fc3ac24b138e1cc3a88dddb478e472bf63656fbec254f1847b',
    'erp_values.py': 'e7be9186775fcdf935322d40a7de1757bd1e91b4ad5b69f4090239d1b0a74419',
    'erp_reports.py': 'fc316d96468da729438129586deae8c2003f5ae1075757832644cccf3d292a1d',
    'erp_settlement.py': '2ee5872aa2ed660c2a41f2326eea6a97e8a4e6c5dd60cf5e6890b59c2d3a32c7',
}


def checked_read(file, limit=1024 * 1024):
    for parent in (file, *file.parents):
        info = parent.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
            raise RuntimeError('Ordinary non-reparse source/runtime required')
        if stat.S_ISREG(info.st_mode) and info.st_nlink != 1:
            raise RuntimeError('Hardlinked source/runtime refused')
    before = file.stat()
    identity = lambda info: (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns, info.st_nlink)
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


def pinned(file, expected):
    body = checked_read(file)
    if hashlib.sha256(body).hexdigest() != expected:
        raise RuntimeError('Exact candidate/tool pin changed: ' + str(file))
    return body


def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--self-sha256', required=True)
    parser.add_argument('--original-test-sha256', required=True)
    parser.add_argument('--pins-sha256', required=True)
    parser.add_argument('--expected-namespace', required=True)
    args = parser.parse_args()
    if (any(not re.fullmatch('[a-f0-9]{64}', value) for value in
            (args.self_sha256, args.original_test_sha256, args.pins_sha256)) or
            not re.fullmatch(r'[A-Za-z0-9_.-]{8,160}', args.expected_namespace) or
            args.original_test_sha256 != HELPER_SHA):
        raise RuntimeError('Exact Root-frozen entry/original/pins SHA and actual namespace required')
    self_body = pinned(ROOT / SELF, args.self_sha256)
    helper_body = pinned(ROOT / HELPER, args.original_test_sha256)
    if (hashlib.sha256(checked_read(PYTHON)).hexdigest() != PYTHON_SHA or
            sys.version_info[:3] != (3, 14, 8) or importlib.util.MAGIC_NUMBER.hex() != '2b0e0d0a'):
        raise RuntimeError('Fixed actual Guest Python 3.14.8 runtime changed')
    guard_bodies = {relative: pinned(ROOT / relative, expected) for relative, expected in GUARDS.items()}
    guard = types.ModuleType('candidate_accuracy_original_actual_context')
    guard.__file__ = str(ROOT / 'stage1/sandbox-context.py')
    exec(compile(guard_bodies['stage1/sandbox-context.py'], guard.__file__, 'exec', dont_inherit=True, optimize=0), guard.__dict__)
    admission = guard.read_context(ROOT)
    identity_body = checked_read(ROOT / 'isolation-identity.json')
    if json.loads(identity_body.decode('utf-8-sig')).get('namespace') != args.expected_namespace:
        raise RuntimeError('Actual handed-back Guest namespace changed')
    pins_body = pinned(ROOT / PIN_FILE, args.pins_sha256)
    manifest = json.loads(pins_body.decode('utf-8-sig'))
    if (not isinstance(manifest, dict) or set(manifest) != {'version', 'purpose', 'originalTestSha256', 'sourcePrefix', 'sourcePins'} or
            type(manifest['version']) is not int or manifest['version'] != 1 or
            manifest['purpose'] != 'finance-erp170-candidate-original-23-source-admission' or
            manifest['originalTestSha256'] != HELPER_SHA or manifest['sourcePrefix'] != PREFIX or
            manifest['sourcePins'] != CANDIDATE_PINS):
        raise RuntimeError('Exact independent seven-source candidate admission required')
    bodies = {name: pinned(ROOT / PREFIX / name, expected) for name, expected in CANDIDATE_PINS.items()}
    base = types.ModuleType('candidate_accuracy_unchanged_original_db13')
    base.__file__ = str(ROOT / HELPER)
    # Exact trusted test/tool definitions only. __name__ differs from __main__,
    # so the original main and its old PINS admission are deliberately not run.
    exec(compile(helper_body, base.__file__, 'exec', dont_inherit=True, optimize=0), base.__dict__)
    if (base.ROOT != ROOT or base.PYTHON != PYTHON or base.PYTHON_SHA != PYTHON_SHA or base.GUARDS != GUARDS or
            base.SOURCE_PREFIX != PREFIX or base.BODIES != {}):
        raise RuntimeError('Frozen original helper boundary changed')
    base.BODIES.update(bodies)  # Independently verified candidate bytes, not old PINS.
    sys.addaudithook(base.audit_boundary)  # Original hook: SQLite :memory: only.
    method_names = unittest.defaultTestLoader.getTestCaseNames(base.Accuracy)
    if len(method_names) != 23:
        raise RuntimeError('All original 23 methods must remain selected')
    print(json.dumps({'purpose': manifest['purpose'], 'namespace': args.expected_namespace, 'actualContext': admission,
                      'entrySha256': args.self_sha256, 'originalTestSha256': HELPER_SHA, 'pinsSha256': args.pins_sha256,
                      'sourcePins': CANDIDATE_PINS, 'methods': method_names, 'originalMainCalled': False,
                      'originalAssertionsReusedVerbatim': True, 'businessImported': False, 'opaqueRulesExecuted': False,
                      'database': 'synthetic-memory-only', 'fullWorkflowAcceptance': False}, ensure_ascii=False), flush=True)
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(base.Accuracy))
    # RED also retains its actual method output; postconditions may never convert
    # failures/errors to success or silently admit a changed candidate.
    if pinned(ROOT / SELF, args.self_sha256) != self_body or pinned(ROOT / HELPER, HELPER_SHA) != helper_body or pinned(ROOT / PIN_FILE, args.pins_sha256) != pins_body:
        raise RuntimeError('Entry/original/pins changed during candidate execution')
    for name, expected in CANDIDATE_PINS.items():
        if pinned(ROOT / PREFIX / name, expected) != bodies[name]:
            raise RuntimeError('Candidate source changed during execution')
    for relative, expected in GUARDS.items():
        if pinned(ROOT / relative, expected) != guard_bodies[relative]:
            raise RuntimeError('Original admission source changed during execution')
    if checked_read(ROOT / 'isolation-identity.json') != identity_body or hashlib.sha256(checked_read(PYTHON)).hexdigest() != PYTHON_SHA:
        raise RuntimeError('Runtime or handed-back identity changed during execution')
    print(json.dumps({'testsRun': result.testsRun, 'failures': len(result.failures), 'errors': len(result.errors),
                      'passed': result.wasSuccessful(), 'postflightPinsVerified': True,
                      'namespace': args.expected_namespace, 'sourcePins': CANDIDATE_PINS,
                      'realDataReadOrChanged': False, 'originalHttpVerified': False, 'fullWorkflowAcceptance': False}, ensure_ascii=False), flush=True)
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({'passed': False, 'phase': 'candidate-admission-or-postflight',
                          'errorType': type(error).__name__, 'error': str(error)}, ensure_ascii=False), flush=True)
        raise SystemExit(2)
