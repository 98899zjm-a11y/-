"""Three actual-Guest synthetic controls for the frozen six-column diagnosis.

No Host import/run. No real configuration/database, app module, pyc or EXE.
The diagnostic function bodies are unchanged AST selections; only Guest-owned
C paths and a labelled synthetic metadata import port are injected for tests.
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).absolute().parents[1]
PYTHON = Path('C:/Python314/python.exe')
if (os.name != 'nt' or os.path.normcase(str(ROOT)) != os.path.normcase('C:/xjy-work/xjy-web-stage1') or
        os.path.normcase(sys.executable) != os.path.normcase(str(PYTHON)) or
        not sys.flags.isolated or not sys.flags.no_site or not sys.flags.dont_write_bytecode or sys.flags.optimize):
    raise RuntimeError('Fixed actual Guest Python -I -B -S required; no Host import/run')

import argparse
import ast
import base64
import contextlib
import datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP, getcontext
import hashlib
import importlib.util
import io
import json
import re
import sqlite3
import stat
import types
import unittest
from unittest import mock
import uuid

SELF = ROOT / 'audit-tools/platinum-summary-readonly-test.py'
DIAG = ROOT / 'audit-tools/read-current-platinum-summary.py'
HELPER = ROOT / 'audit-tools/read-current-ledger-paths.py'
NEW_SOURCE = ROOT / 'project/desktop/legacy-source/ledger/inventory_dashboard.py'
PRESENTATION = ROOT / 'project/desktop/legacy-source/ledger/presentation.py'
REPACK = ROOT / 'audit-tools/platinum-ledger-repack.py'
GUARD = ROOT / 'stage1/sandbox-context.py'
VALIDATOR = ROOT / 'stage1/validate-sandbox-context.py'
DIAG_SHA = 'ae6c514a354366cef19cfa5a1a504b33874f57d3be6c4cdedeeef9e76360fe01'
REPACK_SHA = '9a2560b5c4eeb7db88bef57b2ade056f7d1802a628825996c2bc50d3be28b971'
GUARD_SHA = '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249'
VALIDATOR_SHA = '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207'
PYTHON_SHA = '434b361fe0c5960d404974feed493db47f2603a1ace2574312104fbed0182c6f'
FUNCTIONS = ('need', 'now', 'bootstrap', 'selected', 'models', 'config_gate', 'authorize', 'read_rows',
             'empty_totals', 'add', 'fine_total', 'render', 'calculate', 'main')
CONSTANTS = ('HELPER_SHA', 'OLD_SHA', 'NEW_SHA', 'PRESENTATION_SHA', 'CFG_SHA', 'ROW_LIMIT',
             'CHANGE_LIMIT', 'FIELDS', 'DEFINITIONS', 'STATES', 'SCHEMA_SQL', 'ROWS_SQL')
BASE = None
OLD_SOURCE = None
SUBJECT_BODY = None


def sha(body):
    return hashlib.sha256(body).hexdigest()


def plain(file):
    for item in (file, *file.parents):
        info = item.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
            raise RuntimeError('Ordinary non-reparse Guest path required')
        if stat.S_ISREG(info.st_mode) and info.st_nlink != 1:
            raise RuntimeError('No hardlinked input/runtime/fixture')


def read(file, limit=1024 * 1024):
    plain(file)
    if not file.is_file() or file.stat().st_size > limit:
        raise RuntimeError('Bounded ordinary input required')
    body = file.read_bytes()
    if len(body) > limit:
        raise RuntimeError('Bounded input exceeded')
    return body


def pinned(file, expected):
    body = read(file)
    if sha(body) != expected:
        raise RuntimeError('Frozen synthetic test input changed: ' + file.name)
    return body


def no_f_open(event, arguments):
    # Additional fail-closed content-open audit. Operational paths are also
    # injected to owned C below; this hook alone does not claim to trap lstat.
    if event == 'open' and arguments and isinstance(arguments[0], (str, bytes, os.PathLike)):
        value = os.fsdecode(arguments[0]).replace('\\', '/').lower()
        if re.search(r'(^|[/?:])f:', value):
            raise RuntimeError('Production drive content open forbidden in synthetic tests')


def subject(directory, proxy=None, metadata=None):
    tree = ast.parse(SUBJECT_BODY, filename=str(DIAG))
    definitions = []
    namespace = {'__name__': 'platinum_summary_synthetic_selected', '__file__': str(DIAG), '__doc__': __doc__,
                 'argparse': argparse, 'ast': ast, 'datetime': datetime, 'hashlib': hashlib,
                 'importlib': metadata or importlib, 'json': json, 'os': os, 're': re,
                 'sqlite3': proxy or sqlite3, 'stat': stat, 'sys': sys, 'Path': Path,
                 'Decimal': Decimal, 'InvalidOperation': InvalidOperation, 'ROUND_HALF_UP': ROUND_HALF_UP,
                 'getcontext': getcontext, 'W': ROOT, 'SELF': DIAG, 'HELPER': HELPER,
                 'OLD_SOURCE': OLD_SOURCE, 'NEW_SOURCE': NEW_SOURCE, 'PRESENTATION': PRESENTATION,
                 'DIRECTORY': directory, 'DATABASE': directory / 'ledger.db', 'STDOUT_LIMIT': 64 * 1024}
    for name in CONSTANTS:
        found = [node.value for node in tree.body if isinstance(node, ast.Assign) and
                 len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and node.targets[0].id == name]
        if len(found) != 1:
            raise RuntimeError('One literal diagnostic constant required: ' + name)
        namespace[name] = ast.literal_eval(found[0])
    if namespace['ROW_LIMIT'] != 50000 or namespace['CHANGE_LIMIT'] != 100:
        raise RuntimeError('Original bounded limits required')
    for name in FUNCTIONS:
        found = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == name]
        if len(found) != 1 or found[0].decorator_list or found[0].args.defaults or found[0].args.kw_defaults:
            raise RuntimeError('One unchanged undecorated diagnostic function required: ' + name)
        definitions.append(found[0])
    errors = [node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == 'Refused']
    if len(errors) != 1 or ast.dump(errors[0], include_attributes=False) != ast.dump(
            ast.parse('class Refused(Exception): pass').body[0], include_attributes=False):
        raise RuntimeError('Exact simple diagnostic refusal class required')
    # No diagnostic top-level assignment, import or __main__ block is executed.
    exec(compile(ast.Module(body=errors + definitions, type_ignores=[]), str(DIAG), 'exec',
                 dont_inherit=True, optimize=0), namespace)
    return namespace


def row(identifier, weight='1.00', remark='在库', product='PT950合成链', category='铂金', sell_date=''):
    return dict(id=identifier, category=category, product=product, weight=weight, remark=remark, sell_date=sell_date)


def fixture(name, records):
    directory = BASE / name
    directory.mkdir()  # CreateNew; artifacts are retained even on failure.
    plain(directory)
    database = directory / 'ledger.db'
    with database.open('xb'):
        pass
    writer = sqlite3.connect(database, isolation_level=None, timeout=5)
    try:
        if writer.execute('PRAGMA journal_mode=WAL').fetchone()[0].lower() != 'wal':
            raise RuntimeError('Actual synthetic WAL required')
        writer.execute('CREATE TABLE stock_items(id INTEGER PRIMARY KEY,category TEXT,product TEXT,weight TEXT,remark TEXT,sell_date TEXT,private_note TEXT)')
        writer.execute('CREATE TABLE outside_allowed(secret TEXT)')
        writer.execute("INSERT INTO outside_allowed VALUES('SYNTHETIC_PRIVATE_OTHER_TABLE')")
        writer.execute('BEGIN')
        writer.executemany('INSERT INTO stock_items VALUES(?,?,?,?,?,?,?)',
                           ((r['id'], r['category'], r['product'], r['weight'], r['remark'], r['sell_date'],
                             'SYNTHETIC_PRIVATE_COLUMN') for r in records))
        writer.commit()
        if not Path(str(database) + '-wal').is_file():
            raise RuntimeError('Synthetic WAL file must actually exist while writer remains open')
        return directory, writer
    except BaseException:
        writer.close()
        raise


class CursorTap:
    def __init__(self, cursor, after=None):
        self.cursor, self.after = cursor, after

    def fetchone(self):
        return self.cursor.fetchone()

    def fetchall(self):
        values = self.cursor.fetchall()
        if self.after is not None:
            self.after()
        return values


class ConnectionTap:
    def __init__(self, raw, owner):
        self.raw, self.owner = raw, owner
        self.closed = False
        self.sql = []
        self.decisions = []
        self.rollbacks = 0
        self.query_only = None

    @property
    def row_factory(self):
        return self.raw.row_factory

    @row_factory.setter
    def row_factory(self, value):
        self.raw.row_factory = value

    @property
    def in_transaction(self):
        return self.raw.in_transaction

    def set_authorizer(self, actual):
        def observed(*arguments):
            result = actual(*arguments)
            self.decisions.append((arguments, result))
            return result
        self.raw.set_authorizer(observed)

    def execute(self, sql):
        self.sql.append(sql)
        if sql == self.owner.schema_sql and self.owner.probe is not None:
            self.owner.probe(self)
        cursor = self.raw.execute(sql)
        if sql == 'BEGIN':
            self.query_only = self.raw.execute('PRAGMA query_only').fetchone()[0]
        return CursorTap(cursor, self.owner.after_schema if sql == self.owner.schema_sql else None)

    def rollback(self):
        self.rollbacks += 1
        return self.raw.rollback()

    def close(self):
        try:
            return self.raw.close()
        finally:
            self.closed = True


class SQLitePort:
    """Actual SQLite; only the exact owned synthetic mode=ro URI can connect."""
    def __init__(self, database):
        self.database = database
        self.connections = []
        self.probe = None
        self.after_schema = None
        self.schema_sql = None

    def __getattr__(self, name):
        return getattr(sqlite3, name)

    def connect(self, target, **keywords):
        if target != self.database.as_uri() + '?mode=ro' or keywords != dict(uri=True, timeout=5, isolation_level=None):
            raise AssertionError('Only exact owned synthetic URI and original readonly connect options are allowed')
        plain(self.database)
        connection = ConnectionTap(sqlite3.connect(target, **keywords), self)
        self.connections.append(connection)
        return connection


class SyntheticMetadata:
    """Explicit composition port: no real metadata helper/config is executed."""
    def __init__(self, directory, cfg_sha, good=True):
        self.DATA_ROOT = directory
        self.directory, self.cfg_sha, self.good = directory, cfg_sha, good
        self.imports = 0
        self.checked_calls = 0
        self.rechecks = 0
        self.util = types.SimpleNamespace(spec_from_file_location=self.spec, module_from_spec=lambda spec: self)

    def spec(self, name, file):
        if name != 'platinum_readonly_metadata_helper' or file != HELPER:
            raise AssertionError('Unexpected metadata import')
        self.imports += 1
        return types.SimpleNamespace(loader=types.SimpleNamespace(exec_module=lambda module: None))

    def inspect_settings(self):
        pin = self.cfg_sha if self.good else '0' * 64
        return ({'exists': True, 'version': 1, 'sha256Before': pin, 'sha256After': pin},
                {'source': 'saved-ledger-dataDir', 'dataDir': str(self.directory)})

    def norm(self, value):
        return os.path.normcase(os.path.abspath(value))

    def checked(self, file, root, *, kind):
        self.checked_calls += 1
        if root != self.directory or file != self.directory / 'ledger.db' or kind != 'file':
            raise AssertionError('Only owned synthetic file metadata is allowed')
        plain(file)
        return file, file.lstat(), (file,)

    def recheck(self, chain):
        self.rechecks += 1
        if chain != (self.directory / 'ledger.db',):
            raise AssertionError('Unexpected synthetic chain')
        plain(chain[0])


class PlatinumSummary(unittest.TestCase):
    def assert_closed(self, port, count):
        self.assertEqual(len(port.connections), count)
        for connection in port.connections:
            self.assertTrue(connection.closed)
            self.assertEqual(connection.query_only, 1)
            self.assertEqual(connection.sql.count('BEGIN'), 1)
            self.assertEqual(connection.rollbacks, 1)
            with self.assertRaises(sqlite3.ProgrammingError):
                connection.raw.execute('SELECT 1')

    def test_T01_literal_decimal_totals_state_delta_and_complete_truncation(self):
        ns = subject(BASE / 'unused-calculation-path')
        old, new, fmt2 = ns['models']()
        records = [row(1, '3.12'), row(2, '4.88'),
                   row(3, '2.675', product='PT950合成板料'), row(4, '1.00', product='PT999.5合成金豆'),
                   row(5, '2.00', '在途'), row(6, '1.00', sell_date='2026-10-18'),
                   row(7, '4.00', product='铂金合成未知成色'), row(8, '-1'), row(9, None),
                   row(10, '2.00', product='AU999合成戒', category='黄金'), row(11, '20.00', '不是在途，已入库')]
        records += [row(i, remark='在库；备注：该款有已售样品 PRIVATE_APPENDIX_DO_NOT_RENDER',
                        product='PT950 PRIVATE_PRODUCT_DO_NOT_RENDER') for i in range(101, 203)]
        actual = ns['calculate'](records, old, new, fmt2)
        self.assertEqual(actual['rowCount'], 113)
        self.assertIs(actual['totalsAreComplete'], True)
        # Independent fixed Decimal literals, not the implementation's factors
        # reused to derive expectations. The final three omitted changes still
        # contribute to the full new total and to totalChanges.
        for version, fine, transit, pt_count, pt_raw, pt_fine in (
                ('old', '11.275', '20.90', 3, '8.00', '7.60'),
                ('new', '108.175', '1.90', 105, '110.00', '104.50')):
            output = actual[version]
            self.assertEqual(Decimal(output['platinum']['in_stock']['fine_grams']), Decimal(fine))
            self.assertEqual(Decimal(output['platinum']['transit']['fine_grams']), Decimal(transit))
            pt = output['platinum']['in_stock']['pt950']
            self.assertEqual(pt['count'], pt_count)
            self.assertEqual(Decimal(pt['grams']), Decimal(pt_raw))
            self.assertEqual(Decimal(pt['fine_grams']), Decimal(pt_fine))
            self.assertEqual(output['platinum']['in_stock']['unknown_pt']['count'], 1)
            self.assertEqual(output['invalidWeights'], 1)
            self.assertEqual(output['missingWeightInputsCountedAsZeroByOriginalRule'], 1)
            self.assertEqual(output['cards']['boardAndBeansRaw'], '3.68')
        self.assertEqual(actual['old']['cards']['inStockFine'], '11.28')
        self.assertEqual(actual['new']['cards']['inStockFine'], '108.18')
        self.assertEqual(Decimal(actual['inStockFineDeltaExact']), Decimal('96.90'))
        changes = actual['classificationChanges']
        self.assertEqual((changes['totalChanges'], changes['reportedChanges'], changes['truncated']), (103, 100, True))
        self.assertEqual([r['id'] for r in changes['rows']], [11] + list(range(101, 200)))
        self.assertEqual(changes['rows'][0], dict(id=11, oldState='在途', newState='待确认',
                                               inStockFineDeltaExact='0', transitFineDeltaExact='-19.0000'))
        self.assertEqual((changes['rows'][1]['oldState'], changes['rows'][1]['newState']), ('已售', '在库'))
        self.assertEqual(Decimal(changes['rows'][1]['inStockFineDeltaExact']), Decimal('0.95'))
        self.assertEqual((fmt2(2.675), fmt2(-2.675)), ('2.68', '-2.68'))
        serialized = json.dumps(actual, ensure_ascii=False)
        self.assertNotIn('PRIVATE_APPENDIX_DO_NOT_RENDER', serialized)
        self.assertNotIn('PRIVATE_PRODUCT_DO_NOT_RENDER', serialized)
        self.assertTrue(all(set(r) == {'id', 'oldState', 'newState', 'inStockFineDeltaExact', 'transitFineDeltaExact'}
                            for r in changes['rows']))

    def test_T02_actual_wal_authorizer_snapshot_and_no_unexpected_row_change(self):
        directory, writer = fixture('wal', [row(1)])
        port = SQLitePort(directory / 'ledger.db')
        ns = subject(directory, port)
        port.schema_sql = ns['SCHEMA_SQL']
        forbidden = [
            ('SELECT secret FROM outside_allowed', sqlite3.SQLITE_READ, 'outside_allowed', 'secret'),
            ('SELECT private_note FROM stock_items', sqlite3.SQLITE_READ, 'stock_items', 'private_note'),
            ("UPDATE stock_items SET weight='999'", sqlite3.SQLITE_UPDATE, 'stock_items', 'weight'),
            ('DELETE FROM stock_items', sqlite3.SQLITE_DELETE, 'stock_items', None),
            ('CREATE TABLE escaped(value)', sqlite3.SQLITE_INSERT, 'sqlite_master', None),
            ("ATTACH DATABASE '" + (directory / 'escaped.db').as_posix() + "' AS escaped", sqlite3.SQLITE_ATTACH, None, None),
            ('PRAGMA writable_schema=ON', sqlite3.SQLITE_PRAGMA, 'writable_schema', 'ON')]
        def probe(connection):
            for sql, action, arg1, arg2 in forbidden:
                self.assertEqual(ns['authorize'](action, arg1, arg2, 'main', None), sqlite3.SQLITE_DENY)
                start = len(connection.decisions)
                with self.assertRaises(sqlite3.DatabaseError):
                    connection.raw.execute(sql)
                self.assertTrue(any(result == sqlite3.SQLITE_DENY for _, result in connection.decisions[start:]), sql)
        port.probe = probe
        try:
            before = writer.execute('SELECT * FROM stock_items ORDER BY id').fetchall()
            first = ns['read_rows']()
            self.assertEqual(first, [row(1)])
            self.assertEqual(writer.execute('SELECT * FROM stock_items ORDER BY id').fetchall(), before)
            self.assertEqual(writer.execute('SELECT secret FROM outside_allowed').fetchall(), [('SYNTHETIC_PRIVATE_OTHER_TABLE',)])
            self.assertFalse((directory / 'escaped.db').exists())
            self.assertEqual(writer.execute("SELECT name FROM sqlite_schema WHERE name='escaped'").fetchall(), [])
            port.probe = None
            def overlapping_commit():
                # The reader's schema fetch has established its real snapshot.
                # This is the sole permitted concurrent fixture mutation.
                writer.execute('BEGIN')
                writer.execute("UPDATE stock_items SET weight='2.00' WHERE id=1")
                r = row(2, '3.00')
                writer.execute('INSERT INTO stock_items VALUES(?,?,?,?,?,?,?)',
                               (*r.values(), 'SYNTHETIC_PRIVATE_COLUMN'))
                writer.commit()
            port.after_schema = overlapping_commit
            snapshot = ns['read_rows']()
            self.assertEqual(snapshot, [row(1)], 'One real read transaction must not mix the later writer commit')
            port.after_schema = None
            self.assertEqual(ns['read_rows'](), [row(1, '2.00'), row(2, '3.00')])
            expected = [(1, '铂金', 'PT950合成链', '2.00', '在库', '', 'SYNTHETIC_PRIVATE_COLUMN'),
                        (2, '铂金', 'PT950合成链', '3.00', '在库', '', 'SYNTHETIC_PRIVATE_COLUMN')]
            self.assertEqual(writer.execute('SELECT * FROM stock_items ORDER BY id').fetchall(), expected)
            self.assert_closed(port, 3)
        finally:
            writer.close()

    def test_T03_exclusive_row_limit_and_actual_main_gates_before_connect(self):
        directory, writer = fixture('cap', (row(i) for i in range(1, 50001)))
        port = SQLitePort(directory / 'ledger.db')
        provisional = subject(directory, port)
        metadata = SyntheticMetadata(directory, provisional['CFG_SHA'])
        ns = subject(directory, port, metadata)
        port.schema_sql = ns['SCHEMA_SQL']
        def refuse(arguments, code):
            output = io.StringIO()
            with mock.patch.object(sys, 'argv', [str(DIAG), *arguments]), contextlib.redirect_stdout(output):
                with self.assertRaises(ns['Refused']) as caught:
                    ns['main']()
            self.assertEqual(str(caught.exception), code)
            self.assertEqual(output.getvalue(), '', 'No partial totals may be printed on refusal')
        try:
            refuse(['--source-sha256', DIAG_SHA], 'SEPARATE_LEDGER_READ_AUTHORIZATION_REQUIRED')
            self.assertEqual((len(port.connections), metadata.imports, metadata.checked_calls), (0, 0, 0))
            refuse(['--authorized-ledger-readonly', '--source-sha256', '0' * 64], 'SOURCE_PIN_MISMATCH')
            self.assertEqual((len(port.connections), metadata.imports, metadata.checked_calls), (0, 0, 0))
            metadata.good = False
            refuse(['--authorized-ledger-readonly', '--source-sha256', DIAG_SHA], 'FIXED_CONFIG_SHA_REQUIRED')
            self.assertEqual((len(port.connections), metadata.imports, metadata.checked_calls), (0, 1, 0))
            metadata.good = True
            before = writer.execute('SELECT * FROM stock_items ORDER BY id').fetchall()
            refuse(['--authorized-ledger-readonly', '--source-sha256', DIAG_SHA], 'ROW_LIMIT_REACHED_NO_TOTALS')
            self.assertEqual(metadata.checked_calls, 1)
            self.assertEqual(metadata.rechecks, 0)
            self.assert_closed(port, 1)
            self.assertEqual(len(before), 50000)
            self.assertEqual(writer.execute('SELECT * FROM stock_items ORDER BY id').fetchall(), before)
        finally:
            writer.close()


def main():
    global BASE, OLD_SOURCE, SUBJECT_BODY
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--source-sha256', required=True)
    parser.add_argument('--case', choices=('all', 'T01', 'T02', 'T03'), default='all')
    args = parser.parse_args()
    if (Path(__file__).absolute() != SELF or not re.fullmatch('[0-9a-f]{64}', args.source_sha256) or
            sha(read(SELF)) != args.source_sha256):
        raise RuntimeError('Root-pinned test source SHA256 required')
    pinned(PYTHON, PYTHON_SHA)
    pinned(GUARD, GUARD_SHA)
    pinned(VALIDATOR, VALIDATOR_SHA)
    if sys.version_info[:3] != (3, 14, 8) or importlib.util.MAGIC_NUMBER.hex() != '2b0e0d0a':
        raise RuntimeError('Fixed public Guest Python 3.14.8 required')
    guard = types.ModuleType('platinum_summary_actual_guest_context')
    guard.__file__ = str(GUARD)
    exec(compile(read(GUARD), str(GUARD), 'exec', dont_inherit=True, optimize=0), guard.__dict__)
    admission = guard.read_context(ROOT)
    sys.addaudithook(no_f_open)
    SUBJECT_BODY = pinned(DIAG, DIAG_SHA)
    constants = {n.targets[0].id: ast.literal_eval(n.value) for n in ast.parse(SUBJECT_BODY).body
                 if isinstance(n, ast.Assign) and len(n.targets) == 1 and isinstance(n.targets[0], ast.Name)
                 and n.targets[0].id in ('HELPER_SHA', 'OLD_SHA', 'NEW_SHA', 'PRESENTATION_SHA')}
    pinned(HELPER, constants['HELPER_SHA'])
    pinned(NEW_SOURCE, constants['NEW_SHA'])
    pinned(PRESENTATION, constants['PRESENTATION_SHA'])
    repack_tree = ast.parse(pinned(REPACK, REPACK_SHA), filename=str(REPACK))
    old = [n.value for n in repack_tree.body if isinstance(n, ast.Assign) and len(n.targets) == 1
           and isinstance(n.targets[0], ast.Name) and n.targets[0].id == 'OLD_INVENTORY_B64']
    if len(old) != 1:
        raise RuntimeError('One frozen old inventory source literal required; builder is never imported')
    old_body = base64.b64decode(ast.literal_eval(old[0]), validate=True)
    if sha(old_body) != constants['OLD_SHA']:
        raise RuntimeError('Frozen old inventory source identity mismatch')
    runtime = ROOT / 'runtime'
    if runtime.exists():
        plain(runtime)
    else:
        plain(ROOT)
        runtime.mkdir()
    BASE = runtime / ('platinum-summary-readonly-' + str(uuid.uuid4()))
    BASE.mkdir()
    plain(BASE)
    OLD_SOURCE = BASE / 'old-inventory.py'
    with OLD_SOURCE.open('xb') as output:
        output.write(old_body)
    if getcontext().prec != 28:
        raise RuntimeError('Unmodified default Decimal precision required')
    tests = unittest.defaultTestLoader.loadTestsFromTestCase(PlatinumSummary)
    if args.case != 'all':
        tests = unittest.TestSuite(test for test in tests if test._testMethodName.startswith('test_' + args.case + '_'))
    result = unittest.TextTestRunner(verbosity=2).run(tests)
    report = dict(purpose='synthetic-platinum-summary-readonly-controls', case=args.case,
                  testSourceSha256=args.source_sha256, diagnosticSourceSha256=DIAG_SHA,
                  testsRun=result.testsRun, failures=len(result.failures), errors=len(result.errors),
                  skipped=len(result.skipped), passed=result.wasSuccessful(), admission=admission,
                  ownedFixtureRoot=str(BASE), realLedgerReadOrChanged=False, realConfigurationRead=False,
                  metadataPort='synthetic import port only; actual configuration helper not executed',
                  productionConnectionVerified=False, actualInventoryCauseEstablished=False)
    with (BASE / 'result.json').open('x', encoding='utf-8') as output:
        json.dump(report, output, ensure_ascii=False, indent=2)
        output.write('\n')
    print(json.dumps(report, ensure_ascii=False), flush=True)
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    raise SystemExit(main())
