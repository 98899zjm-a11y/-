"""Three Guest-only synthetic controls; no real data/config, no SQLite open.

Root alone runs after the unchanged actual Guest guard. Original new-tool
function bodies are selected by AST; the helper exec port is explicitly fake.
"""
import os, sys
from pathlib import Path
ROOT = Path(__file__).absolute().parents[1]
PYTHON = Path('C:/Python314/python.exe')
if (os.name != 'nt' or os.path.normcase(str(ROOT)) != os.path.normcase('C:/xjy-work/xjy-web-stage1') or
        os.path.normcase(sys.executable) != os.path.normcase(str(PYTHON)) or not sys.flags.isolated or
        not sys.flags.no_site or not sys.flags.dont_write_bytecode or sys.flags.optimize):
    raise RuntimeError('Fixed actual Guest Python -I -B -S required; no Host import/run')
import argparse, ast, base64, builtins, contextlib, datetime, hashlib, importlib.util, io, json, re, sqlite3, stat, struct, types, unicodedata, unittest, uuid
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP, getcontext
from unittest import mock

SELF = ROOT / 'audit-tools/platinum-unknown-groups-test.py'
TOOL = ROOT / 'audit-tools/read-current-platinum-unknown-groups.py'
READER = ROOT / 'audit-tools/read-current-platinum-summary.py'
HELPER = ROOT / 'audit-tools/read-current-ledger-paths.py'
NEW = ROOT / 'project/desktop/legacy-source/ledger/inventory_dashboard.py'
PRESENTATION = ROOT / 'project/desktop/legacy-source/ledger/presentation.py'
REPACK = ROOT / 'audit-tools/platinum-ledger-repack.py'
FINANCE = ROOT / 'audit-tools/finance-repack.py'
GUARD = ROOT / 'stage1/sandbox-context.py'
VALIDATOR = ROOT / 'stage1/validate-sandbox-context.py'
TOOL_SHA = 'a4e30040e9a3137a4fe0002a25fefd3122a10758a5cbff3f46b4cde534d3fe54'
READER_SHA = 'ae6c514a354366cef19cfa5a1a504b33874f57d3be6c4cdedeeef9e76360fe01'
REPACK_SHA = '9a2560b5c4eeb7db88bef57b2ade056f7d1802a628825996c2bc50d3be28b971'
FINANCE_SHA = 'd630f373911715b3ef5ee80e6fbaeaae838c1469ab53f44759813bc066cf69a7'
GUARD_SHA = '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249'
VALIDATOR_SHA = '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207'
PYTHON_SHA = '434b361fe0c5960d404974feed493db47f2603a1ace2574312104fbed0182c6f'
BASE = OLD = BODY = None
F_OPENS = []


def read(file, pin=None):
    for item in (file, *file.parents):
        info = item.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400 or (stat.S_ISREG(info.st_mode) and info.st_nlink != 1):
            raise RuntimeError('Ordinary nonlinked Guest input required')
    if not file.is_file() or file.stat().st_size > 1024 * 1024: raise RuntimeError('Bounded input required')
    body = file.read_bytes()
    if len(body) > 1024 * 1024 or (pin is not None and hashlib.sha256(body).hexdigest() != pin):
        raise RuntimeError('Frozen input pin/size mismatch')
    return body


def no_f(event, args):
    if event == 'open' and args and isinstance(args[0], (str, bytes, os.PathLike)):
        if re.search(r'(^|[/?:])f:', os.fsdecode(args[0]).replace('\\', '/').lower()):
            F_OPENS.append('denied'); raise AssertionError('No production content open in Guest test')


class SQLitePort:
    def __init__(self): self.calls = 0
    def __getattr__(self, name): return getattr(sqlite3, name)
    def connect(self, *args, **kwargs):
        self.calls += 1; raise AssertionError('These new controls must stop before any SQLite open')


class MetadataExecPort:
    """Only replace the known helper exec with labelled synthetic metadata."""
    def __init__(self): self.calls = 0
    def __call__(self, code, namespace):
        if code.co_filename == str(HELPER):
            self.calls += 1
            def forbidden(*args, **kwargs): raise AssertionError('Bad config pin must precede checked/connect')
            namespace.update(inspect_settings=lambda: (
                {'exists': True, 'version': 1, 'sha256Before': '0' * 64, 'sha256After': '0' * 64},
                {'source': 'saved-ledger-dataDir', 'dataDir': str(BASE)}),
                norm=lambda value: os.path.normcase(str(value)), checked=forbidden, DATA_ROOT=BASE)
        elif code.co_filename == str(READER) and namespace.get('__name__') == 'platinum_unknown_reviewed_reader':
            builtins.exec(code, namespace)
        else: raise AssertionError('Unexpected exec port')


def subject():
    namespace = dict(globals(), __name__='synthetic_unknown_tool', __file__=str(TOOL), W=ROOT, SELF=TOOL,
                     READER=READER, HELPER=HELPER, OLD_SOURCE=OLD, NEW_SOURCE=NEW, PRESENTATION=PRESENTATION,
                     DIRECTORY=BASE, DATABASE=BASE / 'ledger.db', sqlite3=SQLitePort(), exec=MetadataExecPort())
    tree = ast.parse(BODY, filename=str(TOOL))
    for name in ('READER_SHA', 'FUNCTIONS', 'CONSTANTS', 'TOKENS', 'ID_LIMIT'):
        found = [n.value for n in tree.body if isinstance(n, ast.Assign) and len(n.targets) == 1 and
                 isinstance(n.targets[0], ast.Name) and n.targets[0].id == name]
        if len(found) != 1: raise RuntimeError('One frozen literal required')
        namespace[name] = ast.literal_eval(found[0])
    namespace['STDOUT_LIMIT'] = 64 * 1024
    nodes = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.ClassDef))]
    if any(getattr(n, 'decorator_list', ()) for n in nodes): raise RuntimeError('No decorators')
    builtins.exec(compile(ast.Module(body=nodes, type_ignores=[]), str(TOOL), 'exec', dont_inherit=True, optimize=0), namespace)
    return namespace


def row(i, weight='1.25', product='铂金无成色 PRIVATE_PRODUCT', category='铂金', remark='在库', sell_date=''):
    return dict(id=i, category=category, product=product, weight=weight, remark=remark, sell_date=sell_date)


def code_comparator():
    # Frozen builder is text only. Reuse its complete recursive 18-field
    # comparison, not marshal stream/reference flags; never execute code data.
    tree = ast.parse(read(FINANCE, FINANCE_SHA), filename=str(FINANCE))
    fields = [n.value for n in tree.body if isinstance(n, ast.Assign) and len(n.targets) == 1
              and isinstance(n.targets[0], ast.Name) and n.targets[0].id == 'FIELDS']
    if len(fields) != 1: raise RuntimeError('One original code field tuple required')
    fields = ast.literal_eval(fields[0])
    if len(fields) != 18 or 'co_filename' not in fields or 'co_firstlineno' not in fields:
        raise RuntimeError('All original 18 fields including filename/line required')
    class RepackError(RuntimeError): pass
    namespace = {'FIELDS': fields, 'RepackError': RepackError, 'struct': struct, 'types': types, 'json': json}
    definitions = []
    for name in ('require', 'code_tree', 'assert_same_code'):
        found = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name]
        if len(found) != 1 or found[0].decorator_list: raise RuntimeError('One complete comparator definition required')
        definitions.append(found[0])
    builtins.exec(compile(ast.Module(body=definitions, type_ignores=[]), str(FINANCE), 'exec',
                          dont_inherit=True, optimize=0), namespace)
    return namespace


class UnknownGroups(unittest.TestCase):
    def test_U01_literal_groups_normalization_and_no_inferred_purity(self):
        ns = subject(); reader = ns['load_reader'](); _, functions, _ = reader['models']()
        rows = [row(1, remark='在库；备注：PRIVATE_REMARK'), row(2, '2.75', 'ＰＴ９５０ PRIVATE_PRODUCT', '铂金银饰'),
                row(3, '3.00', 'PT999.5 PT990 PT900 PRIVATE_PRODUCT', remark='在途'),
                row(4, '-1', 'PT999 950 PRIVATE_PRODUCT', '铂金银', sell_date='2026-10-18'),
                row(5, '999', 'PT950 PRIVATE_PRODUCT'), row(6, '888', 'ＰＴ９５０ PRIVATE_PRODUCT', '合成材质'),
                row(7, None, '铂金9500 999.50 1990 9000 990.0 PRIVATE_PRODUCT', remark='待确认'),
                row(8, 'not-a-weight', 'PT999 PRIVATE_PRODUCT'), row(9, '', '铂金２９５０ PRIVATE_PRODUCT')]
        self.assertEqual(functions['platinum_identity'](rows[1]), ('unknown_pt', None))
        self.assertEqual(functions['platinum_identity'](rows[5]), ('other', None))
        actual = ns['classify'](rows, functions, reader['STATES'])
        self.assertEqual((actual['rowCount'], actual['unknownPtCount'], actual['sampledIds']), (9, 7, 7))
        self.assertEqual(Decimal(actual['unknownPtRawGramsExact']), Decimal('7.00'))
        self.assertEqual((actual['invalidWeights'], actual['missingWeightInputsCountedAsZeroByOriginalRule']), (2, 2))
        self.assertIs(actual['totalsAreComplete'], True); self.assertIs(actual['idSamplesTruncated'], False)
        groups = {(g['state'], tuple(g['listedPurityTokens']), g['otherMetalWordMarker'], g['nfkcChanged']): g for g in actual['groups']}
        expected = {('in_stock', (), False, False): '1.25', ('in_stock', ('950',), True, True): '2.75',
                    ('transit', ('999.5', '990', '900'), False, False): '3.00',
                    ('sold', ('950', '999'), True, False): '0', ('unknown', (), False, False): '0',
                    ('in_stock', ('999',), False, False): '0', ('in_stock', (), False, True): '0'}
        self.assertEqual(set(groups), set(expected))
        for key, grams in expected.items():
            self.assertEqual(groups[key]['count'], 1)
            self.assertEqual(Decimal(groups[key]['rawGramsExact']), Decimal(grams))
            self.assertEqual(groups[key]['noListedPurityToken'], not key[1])
            self.assertEqual(groups[key]['multipleListedPurityTokens'], len(key[1]) > 1)
        text = json.dumps(actual, ensure_ascii=False)
        self.assertNotIn('PRIVATE_PRODUCT', text); self.assertNotIn('PRIVATE_REMARK', text)
        self.assertNotIn('not-a-weight', text); self.assertNotIn('2026-10-18', text)
        self.assertTrue(all('factor' not in key.lower() and 'fine' not in key.lower() for g in actual['groups'] for key in g))
        self.assertEqual(sorted(i for g in actual['groups'] for i in g['sampleIds']), [1, 2, 3, 4, 7, 8, 9])

    def test_U02_twenty_ids_across_all_states_and_groups_without_total_truncation(self):
        ns = subject(); reader = ns['load_reader'](); _, functions, _ = reader['models']()
        rows = [row(i, remark=('在库', '在途', '已售', '待确认')[(i - 1) % 4]) for i in range(1, 26)]
        actual = ns['classify'](rows, functions, reader['STATES'])
        self.assertEqual((actual['unknownPtCount'], actual['sampledIds'], actual['idSampleLimit']), (25, 20, 20))
        self.assertIs(actual['totalsAreComplete'], True); self.assertIs(actual['idSamplesTruncated'], True)
        self.assertEqual(Decimal(actual['unknownPtRawGramsExact']), Decimal('31.25'))
        self.assertEqual(sorted(i for g in actual['groups'] for i in g['sampleIds']), list(range(1, 21)))
        self.assertEqual({g['state']: (g['count'], Decimal(g['rawGramsExact'])) for g in actual['groups']},
                         {'in_stock': (7, Decimal('8.75')), 'transit': (6, Decimal('7.50')),
                          'sold': (6, Decimal('7.50')), 'unknown': (6, Decimal('7.50'))})

    def test_U03_actual_main_new_gates_and_exact_reused_reader_code(self):
        ns = subject(); reader = ns['load_reader']()
        original = ast.parse(read(READER, READER_SHA), filename=str(READER))
        definitions = [next(n for n in original.body if isinstance(n, ast.FunctionDef) and n.name == name) for name in ns['FUNCTIONS']]
        compiled = compile(ast.Module(body=definitions, type_ignores=[]), str(READER), 'exec', dont_inherit=True, optimize=0)
        expected = {value.co_name: value for value in compiled.co_consts if isinstance(value, types.CodeType)}
        comparator = code_comparator()
        for name in ('authorize', 'read_rows'):
            comparator['assert_same_code'](reader[name].__code__, expected[name])
        baseline = reader['read_rows'].__code__
        for changed in (baseline.replace(co_filename=baseline.co_filename + '.synthetic-change'),
                        baseline.replace(co_firstlineno=baseline.co_firstlineno + 1)):
            with self.assertRaises(comparator['RepackError']) as caught:
                comparator['assert_same_code'](baseline, changed)
            self.assertEqual(str(caught.exception), 'CODE_18_FIELDS_DIFFER')
        def call(arguments, code=None, parser_error=False):
            output, errors = io.StringIO(), io.StringIO()
            with mock.patch.object(sys, 'argv', [str(TOOL), *arguments]), contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
                if parser_error:
                    with self.assertRaises(SystemExit) as caught: ns['main']()
                    self.assertEqual(caught.exception.code, 2)
                else:
                    with self.assertRaises(ns['Refused']) as caught: ns['main']()
                    self.assertEqual(str(caught.exception), code)
            self.assertEqual(output.getvalue(), ''); self.assertEqual(ns['sqlite3'].calls, 0); self.assertEqual(F_OPENS, [])
        call(['--source-sha256', TOOL_SHA], 'SEPARATE_CLASSIFICATION_READ_AUTHORIZATION_REQUIRED')
        call(['--authorized-ledger-readonly', '--source-sha256', TOOL_SHA], parser_error=True)
        call(['--authorized-platinum-classification-readonly', '--source-sha256', '0' * 64], 'SOURCE_PIN_MISMATCH')
        wrong = BASE / 'wrong-reader.py'
        with wrong.open('xb') as output: output.write(b'# synthetic wrong pinned reader\n')
        ns['READER'] = wrong
        call(['--authorized-platinum-classification-readonly', '--source-sha256', TOOL_SHA], 'SOURCE_PIN_MISMATCH')
        self.assertEqual(ns['exec'].calls, 0)
        ns['READER'] = READER
        call(['--authorized-platinum-classification-readonly', '--source-sha256', TOOL_SHA], 'FIXED_CONFIG_SHA_REQUIRED')
        self.assertEqual(ns['exec'].calls, 1)


def main():
    global BASE, OLD, BODY
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--source-sha256', required=True); args = parser.parse_args()
    if Path(__file__).absolute() != SELF or not re.fullmatch('[0-9a-f]{64}', args.source_sha256): raise RuntimeError('Exact self path/pin required')
    read(SELF, args.source_sha256); read(PYTHON, PYTHON_SHA); read(GUARD, GUARD_SHA); read(VALIDATOR, VALIDATOR_SHA)
    if sys.version_info[:3] != (3, 14, 8) or importlib.util.MAGIC_NUMBER.hex() != '2b0e0d0a': raise RuntimeError('Fixed public Python required')
    guard = types.ModuleType('unknown_groups_actual_guard'); guard.__file__ = str(GUARD)
    builtins.exec(compile(read(GUARD), str(GUARD), 'exec', dont_inherit=True, optimize=0), guard.__dict__)
    admission = guard.read_context(ROOT); sys.addaudithook(no_f)
    BODY = read(TOOL, TOOL_SHA); reader_tree = ast.parse(read(READER, READER_SHA))
    pins = {n.targets[0].id: ast.literal_eval(n.value) for n in reader_tree.body if isinstance(n, ast.Assign) and len(n.targets) == 1
            and isinstance(n.targets[0], ast.Name) and n.targets[0].id in ('HELPER_SHA', 'OLD_SHA', 'NEW_SHA', 'PRESENTATION_SHA')}
    read(HELPER, pins['HELPER_SHA']); read(NEW, pins['NEW_SHA']); read(PRESENTATION, pins['PRESENTATION_SHA'])
    tree = ast.parse(read(REPACK, REPACK_SHA))
    encoded = [n.value for n in tree.body if isinstance(n, ast.Assign) and len(n.targets) == 1
               and isinstance(n.targets[0], ast.Name) and n.targets[0].id == 'OLD_INVENTORY_B64']
    if len(encoded) != 1: raise RuntimeError('One frozen old source literal required')
    old = base64.b64decode(ast.literal_eval(encoded[0]), validate=True)
    if hashlib.sha256(old).hexdigest() != pins['OLD_SHA']: raise RuntimeError('Old source pin mismatch')
    # ROOT itself was checked by the original actual guard. Exclusive child;
    # no shared runtime parent mutation and no cleanup of failed artifacts.
    BASE = ROOT / ('platinum-unknown-test-' + str(uuid.uuid4())); BASE.mkdir()
    OLD = BASE / 'old-inventory.py'
    with OLD.open('xb') as output: output.write(old)
    if getcontext().prec != 28: raise RuntimeError('Default Decimal precision required')
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(UnknownGroups))
    print(json.dumps({'testsRun': result.testsRun, 'failures': len(result.failures), 'errors': len(result.errors), 'skipped': len(result.skipped),
                      'passed': result.wasSuccessful(), 'testSourceSha256': args.source_sha256, 'toolSourceSha256': TOOL_SHA,
                      'readerSourceSha256': READER_SHA, 'admission': admission, 'ownedSyntheticRoot': str(BASE),
                      'realDataOrConfigRead': False, 'sqliteOpened': False, 'metadataPort': 'explicit synthetic helper exec'}, ensure_ascii=False))
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__': raise SystemExit(main())
