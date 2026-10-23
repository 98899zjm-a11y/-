"""Fixed public CMD stat contracts for two read-only QA modules; no verifier main."""
import sys
sys.dont_write_bytecode = True

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import argparse
import ast
import hashlib
import importlib.util
import json
import os
import stat
from datetime import datetime, timezone

ROOT = Path(r'E:\codex\2026-10-15\work\xjy-v16-deep-audit')
SELF = ROOT / 'audit-tools/fresh162-stat-contract.py'
OLD = ROOT / 'audit-tools/verify-fresh162-zip-public.py'
NEW = ROOT / 'audit-tools/verify-fresh162-zip-public-a2.py'
CMD = ROOT / 'release-work/initial-fresh-employee-162-package-a1/安装员工端.cmd'
RESULT = ROOT / 'reports/fresh162-stat-contract-20261019.json'
PINS = {OLD: '991a1f749c10d6d54d1ae4a46b28191c1c92660fc26704eb6683885b01f3fdb9',
        NEW: 'a089d7c39ee24ceb9ef43dd7f0a6ef867991ee1200144aeaf69487f56cd66fbd'}
FIELDS = ('st_dev', 'st_ino', 'st_mode', 'st_size', 'st_mtime_ns', 'st_ctime_ns', 'st_nlink')


def need(value, message):
    if not value:
        raise AssertionError(message)


def sha(body):
    return hashlib.sha256(body).hexdigest()


def values(info):
    return {name: getattr(info, name) for name in FIELDS}


def changed(info, **replacement):
    return SimpleNamespace(**{**values(info), **replacement})


def source_bytes(file, pin):
    before = file.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1
         and not getattr(before, 'st_file_attributes', 0) & 0x400, 'SOURCE_NOT_PLAIN')
    with file.open('rb') as stream:
        opened = os.fstat(stream.fileno())
        body = stream.read()
        need(values(os.fstat(stream.fileno())) == values(opened), 'SOURCE_FD_CHANGED')
    need(values(file.lstat()) == values(before) and sha(body) == pin, 'SOURCE_CHANGED')
    return body


def load(file, name, pin):
    source_bytes(file, pin)
    spec = importlib.util.spec_from_file_location(name, file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # __name__ is deliberately not __main__.
    source_bytes(file, pin)
    return module


def main():
    parser = argparse.ArgumentParser(allow_abbrev=False)
    parser.add_argument('--source-sha256', required=True)
    args = parser.parse_args()
    need(len(sys.argv) == 3 and sys.argv[1] == '--source-sha256'
         and len(args.source_sha256) == 64, 'EXPLICIT_SELF_SHA_REQUIRED')
    need(os.name == 'nt' and Path(__file__).absolute() == SELF and Path.cwd() == ROOT
         and sys.flags.isolated and sys.flags.no_site and sys.flags.dont_write_bytecode,
         'FIXED_PYTHON_I_B_S_HOST_REQUIRED')
    source_bytes(SELF, args.source_sha256)
    bodies = {file: source_bytes(file, pin) for file, pin in PINS.items()}
    trees = {file: ast.parse(body) for file, body in bodies.items()}
    old_nodes, new_nodes = trees[OLD].body, trees[NEW].body
    need(len(old_nodes) == len(new_nodes), 'UNEXPECTED_QA_TOPLEVEL_CHANGE')
    allowed = []
    for old, new in zip(old_nodes, new_nodes):
        if ast.dump(old) == ast.dump(new):
            continue
        name = old.targets[0].id if isinstance(old, ast.Assign) and isinstance(old.targets[0], ast.Name) else getattr(old, 'name', None)
        need(name in ('SELF', 'RESULT', 'common_identity'), 'CHANGE_OUTSIDE_APPROVED_THREE_NODES')
        allowed.append(name)
    need(allowed == ['SELF', 'RESULT', 'common_identity'], 'EXPECTED_MINIMAL_QA_CHANGE_REQUIRED')
    old = load(OLD, 'fresh162_stat_qa_original', PINS[OLD])
    new = load(NEW, 'fresh162_stat_qa_a2', PINS[NEW])
    new.ordinary(CMD)
    named = CMD.lstat()
    with CMD.open('rb') as stream:
        opened = os.fstat(stream.fileno())  # Never read CMD bytes.
    need(old.common_identity(named) != old.common_identity(opened), 'REAL_ORIGINAL_MISMATCH_REQUIRED')
    need(new.common_identity(named) == new.common_identity(opened), 'REAL_A2_MATCH_REQUIRED')
    cases = [{'name': 'Q01 only SELF RESULT common_identity AST nodes differ', 'passed': True,
              'evidence': 'Full same-API identity and all other QA AST nodes are identical.'}]

    def refusal(name, operation, expected, evidence):
        try:
            operation()
        except RuntimeError as error:
            need(str(error) == expected, name + ': wrong refusal ' + str(error))
            cases.append({'name': name, 'passed': True, 'refusal': str(error), 'evidence': evidence})
        else:
            raise AssertionError(name + ': required refusal missing')

    def enter(module):
        with module.stable_reader(CMD):
            pass

    refusal('Q02 original rejects real unchanged public CMD', lambda: enter(old), 'INPUT_OPEN_CHANGED',
            'Actual lstat versus fstat; real readonly handle, no stat injection and no file content read.')
    enter(new)
    cases.append({'name': 'Q03 a2 accepts real unchanged public CMD', 'passed': True,
                  'evidence': 'Actual lstat/fstat and full same-API before/after checks, no stat injection.'})
    actual_fstat = os.fstat
    variants = [
        ('device', lambda s: {'st_dev': s.st_dev + 1}),
        ('inode', lambda s: {'st_ino': s.st_ino + 1}),
        ('filetype', lambda s: {'st_mode': stat.S_IFDIR | stat.S_IMODE(s.st_mode)}),
        ('size', lambda s: {'st_size': s.st_size + 1}),
        ('mtime', lambda s: {'st_mtime_ns': s.st_mtime_ns + 1}),
        ('nlink', lambda s: {'st_nlink': s.st_nlink + 1}),
        ('readonly', lambda s: {'st_mode': s.st_mode & ~0o222}),
        ('read_permission', lambda s: {'st_mode': s.st_mode & ~0o444}),
    ]
    for field, mutation in variants:
        def injected(fd, mutate=mutation):
            info = actual_fstat(fd)
            return changed(info, **mutate(info))
        with patch.object(new.os, 'fstat', injected):
            refusal('Q04 cross-API still rejects ' + field, lambda: enter(new), 'INPUT_OPEN_CHANGED',
                    'Synthetic fstat metadata variant on a real readonly CMD FD; disk file never mutated.')

    calls = 0
    def same_api_changed(fd):
        nonlocal calls
        calls += 1
        info = actual_fstat(fd)
        return info if calls == 1 else changed(info, st_mode=info.st_mode | 0o111)
    with patch.object(new.os, 'fstat', same_api_changed):
        refusal('Q05 same-API FD execute-bit change remains detected', lambda: enter(new), 'INPUT_HANDLE_CHANGED',
                'Synthetic second-fstat execute-bit mutation only; real FD and file unchanged.')
    need(calls == 2, 'TWO_SAME_API_FSTAT_CALLS_REQUIRED')

    actual_lstat, path_calls = Path.lstat, 0
    def path_changed(file, *args, **kwargs):
        nonlocal path_calls
        info = actual_lstat(file, *args, **kwargs)
        if file == CMD:
            path_calls += 1
            if path_calls == 4:
                return changed(info, st_mode=info.st_mode ^ 0o111)
        return info
    with patch.object(Path, 'lstat', path_changed):
        refusal('Q06 same-API path execute-bit change remains detected', lambda: enter(new), 'INPUT_PATH_CHANGED',
                'Synthetic final-lstat execute-bit mutation only; real path/file unchanged.')
    need(path_calls == 4, 'FOUR_EXPECTED_PATH_LSTAT_CALLS_REQUIRED')
    real_os = new.os
    try:
        new.os = SimpleNamespace(name='posix')
        need(new.common_identity(named) != new.common_identity(opened), 'NON_WINDOWS_MODE_MUST_REMAIN_EXACT')
    finally:
        new.os = real_os
    cases.append({'name': 'Q07 non-Windows common identity preserves full mode', 'passed': True,
                  'evidence': 'Pure identity call with local QA os.name adapter; no filesystem call under adapter.'})
    need(values(CMD.lstat()) == values(named), 'REAL_CMD_PATH_CHANGED')
    with CMD.open('rb') as stream:
        need(values(os.fstat(stream.fileno())) == values(opened), 'REAL_CMD_FD_CHANGED')
    for file, pin in PINS.items():
        source_bytes(file, pin)
    source_bytes(SELF, args.source_sha256)
    result = {'version': 1, 'purpose': 'fresh162-narrow-stat-guard-contract', 'passed': True,
              'createdAt': datetime.now(timezone.utc).isoformat(), 'sourceSha256': args.source_sha256,
              'python': sys.version, 'modulePins': {str(file): pin for file, pin in PINS.items()},
              'realPublicCmd': str(CMD), 'realPathStat': values(named), 'realFdStat': values(opened),
              'approvedSourceChanges': allowed, 'cases': cases, 'passedCases': len(cases),
              'realFileMutated': False, 'injectedMetadataCasesExplicit': True,
              'verifierMainExecuted': False, 'fullVerifierRerun': False, 'programContentRead': False,
              'businessModuleImported': False, 'privateKeyRead': False, 'databaseRead': False,
              'productExecuted': False, 'guestAccessed': False, 'existingFileModified': False}
    new.ordinary(RESULT.parent, directory=True)
    new.ordinary(RESULT, missing=True)
    need(not os.path.lexists(RESULT), 'CREATE_NEW_EVIDENCE_REQUIRED')
    body = (json.dumps(result, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    with RESULT.open('xb') as stream:
        need(stream.write(body) == len(body), 'EVIDENCE_WRITE_INCOMPLETE')
        stream.flush()
        os.fsync(stream.fileno())
    need(RESULT.read_bytes() == body, 'EVIDENCE_READBACK_REQUIRED')
    print(json.dumps({'file': str(RESULT), 'size': len(body), 'sha256': sha(body), 'passed': True,
                      'passedCases': len(cases), 'fullVerifierRerun': False, 'existingFileModified': False}, ensure_ascii=False))


if __name__ == '__main__':
    main()
