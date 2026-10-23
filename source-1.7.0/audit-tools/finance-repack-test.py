"""Six fixed actual-Guest contracts for the not-yet-implemented finance repacker.

Root alone runs this file. Host review is text/AST/hash only. Archive payloads
are decoded only after exact original input pins; no payload is executed.
The first RED intentionally fails MISSING_IMPLEMENTATION, without a builder.
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
import base64
import hashlib
import importlib.util
import io
import json
import marshal
import re
import stat
import struct
import types
import unittest
import zlib

SELF = ROOT / 'audit-tools/finance-repack-test.py'
BUILDER = ROOT / 'audit-tools/finance-repack.py'
ORIGINAL = ROOT / 'project/desktop/release-modules'
MANIFEST = ORIGINAL / 'manifest.json'
SOURCE = ROOT / 'project/desktop/legacy-source/ledger/finance.py'
PROBE = ROOT / 'audit-tools/finance-archive-readonly-probe.py'
GUARD = ROOT / 'stage1/sandbox-context.py'
PINS = {
    'python': '434b361fe0c5960d404974feed493db47f2603a1ace2574312104fbed0182c6f',
    'manifest': 'f58df7830fe5ba96ccdc36eb1e990c4b27880de7ea2c14c3c3b050617322f441',
    'finance': '56bcb389a21ada8c5d650e6f7ea1e81781b446f3af0a4e9b19e019930df63096',
    'oldFinance': '4048318fe44ef7fc321653f31cc80807390da356fa854607070858dd8f112c76',
    'exe': 'e3b15aa649f26c927dd90360458f7bd7ecbaa405c75a4ef241fae15c5360ff5c',
    'probe': '2f310d31ca01a61b4169b1d6daa1a64e53ab89f56b86884e8df907ee1c1c6928',
    'guard': '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
    'validator': '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207',
}
UPSTREAM = {
    'PyInstaller/archive/writers.py': 'cc82056869995c1012b08c8f0bf7eecef6b5ec8bc6e28e9e8b548e40b0d92e61',
    'PyInstaller/building/utils.py': 'a6ebe3ebed9433a60fa62f188a290ddfbecadb76b9b2e6d3bf8104559472568c',
    'COPYING.txt': '0598064c7d2718e38d7914a7d08343b2fa008e3bea9ebba2aa7a6ffa5900dd64',
}
FIELDS = ('co_argcount', 'co_posonlyargcount', 'co_kwonlyargcount', 'co_nlocals', 'co_stacksize',
          'co_flags', 'co_code', 'co_consts', 'co_names', 'co_varnames', 'co_freevars', 'co_cellvars',
          'co_name', 'co_qualname', 'co_filename', 'co_firstlineno', 'co_linetable', 'co_exceptiontable')
COOKIE = struct.Struct('!8sIIII64s')
ENTRY = struct.Struct('!IIIIBc')
MAX = 32 * 1024 * 1024
MODULES = {'inventory': ('xjy-inventory', 143), 'ledger': ('xjy-ledger', 353)}
ARGS = None
TOOL = None
CANDIDATE = None
EXECUTIONS = []
VIOLATIONS = []


def sha(body):
    return hashlib.sha256(body).hexdigest()


def read(file, limit=MAX):
    file = Path(file)
    for parent in (file, *file.parents):
        info = parent.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
            raise AssertionError('Test input/output cannot be a link')
        if stat.S_ISREG(info.st_mode) and info.st_nlink != 1:
            raise AssertionError('Test input/output cannot be a hardlink')
    if not file.is_file() or file.stat().st_size > limit:
        raise AssertionError('Bounded ordinary test file required')
    body = file.read_bytes()
    if len(body) > limit:
        raise AssertionError('Test read limit exceeded')
    return body


def tree(directory):
    result = {}
    for file in sorted(Path(directory).rglob('*')):
        if file.is_file():
            body = read(file)
            result[file.relative_to(directory).as_posix()] = (len(body), sha(body))
        elif not file.is_dir() or file.is_symlink() or os.path.isjunction(file):
            raise AssertionError('Unexpected output node')
    return result


def inflate(body):
    decoder = zlib.decompressobj()
    result = decoder.decompress(body, 8 * 1024 * 1024 + 1)
    if len(result) > 8 * 1024 * 1024 or not decoder.eof or decoder.unused_data or decoder.unconsumed_tail:
        raise AssertionError('Bounded complete compressed test payload required')
    return result


def archive(body):
    """Independent assertion reader; never used on Host or to build a product."""
    if not 512 <= len(body) <= MAX:
        raise AssertionError('Archive byte budget')
    magic, size, toc_at, toc_size, version, library = COOKIE.unpack(body[-COOKIE.size:])
    if magic != b'MEI\014\013\012\013\016' or toc_at + toc_size + COOKIE.size != size:
        raise AssertionError('EOF cookie required')
    start, rows, cursor = len(body) - size, [], 0
    if start != 373248 or not 0 < toc_size <= 4 * 1024 * 1024:
        raise AssertionError('Fixed archive prefix and bounded TOC required')
    toc = body[start + toc_at:start + toc_at + toc_size]
    while cursor < len(toc):
        length, at, packed, unpacked, flag, kind = ENTRY.unpack_from(toc, cursor)
        if (len(rows) >= 16384 or length < ENTRY.size + 1 or length % 16 or
                cursor + length > len(toc) or at > toc_at or packed > toc_at - at or flag not in (0, 1)):
            raise AssertionError('CArchive assertion bounds')
        name = toc[cursor + ENTRY.size:cursor + length].split(b'\0', 1)[0].decode('utf-8')
        raw = body[start + at:start + at + packed]
        payload = inflate(raw) if flag else raw
        if len(payload) != unpacked:
            raise AssertionError('CArchive payload length')
        rows.append({'name': name, 'type': kind.decode('ascii'), 'flag': flag, 'payload': payload,
                     'at': start + at, 'packed': packed, 'tocAt': start + toc_at + cursor, 'rowSize': length})
        cursor += length
    if cursor != len(toc):
        raise AssertionError('CArchive TOC exhaustion')
    return {'prefix': body[:start], 'rows': rows, 'version': version, 'library': library,
            'tocAt': start + toc_at, 'tocSize': toc_size}


def decoded_pyz(container):
    matches = [row for row in container['rows'] if row['type'] == 'z']
    if len(matches) != 1 or matches[0]['flag']:
        raise AssertionError('One uncompressed PYZ')
    body = matches[0]['payload']
    if body[:8] != b'PYZ\0' + bytes.fromhex('2b0e0d0a'):
        raise AssertionError('Fixed PYZ magic')
    toc_at = struct.unpack_from('!i', body, 8)[0]
    if not 17 <= toc_at <= len(body) or len(body) - toc_at > 4 * 1024 * 1024:
        raise AssertionError('PYZ assertion bounds')
    stream = io.BytesIO(body[toc_at:])
    toc = marshal.load(stream, allow_code=False)
    if stream.tell() != len(body) - toc_at or type(toc) not in (dict, list, tuple):
        raise AssertionError('PYZ metadata only')
    rows = list(toc.items()) if type(toc) is dict else list(toc)
    if len(rows) != 933 or len({row[0] for row in rows}) != 933:
        raise AssertionError('Exactly 933 unique PYZ entries')
    result = []
    for name, (kind, at, length) in rows:
        if kind not in (0, 1, 3) or not 17 <= at <= toc_at or not 0 <= length <= toc_at - at:
            raise AssertionError('PYZ entry bounds')
        if kind == 3:
            if length:
                raise AssertionError('Namespace must have no payload')
            code = None
        else:
            stream = io.BytesIO(inflate(body[at:at + length]))
            code = marshal.load(stream, allow_code=True)  # Data decode only; never exec/import.
            if type(code) is not types.CodeType or stream.tell() != len(stream.getvalue()):
                raise AssertionError('Complete PYZ code object required')
        result.append((name, kind, code))
    return result


def code_tree(value, budget=None, depth=0):
    budget = [0] if budget is None else budget
    budget[0] += 1
    if depth > 100 or budget[0] > 200000:
        raise AssertionError('Code assertion budget')
    kind = type(value)
    if kind is types.CodeType:
        return ('code', tuple((name, code_tree(getattr(value, name), budget, depth + 1)) for name in FIELDS))
    if value is None or value is Ellipsis:
        return ('none' if value is None else 'ellipsis',)
    if kind in (bool, int, str, bytes):
        return (kind.__name__, value)
    if kind is float:
        return ('float', struct.pack('!d', value))
    if kind is complex:
        return ('complex', struct.pack('!dd', value.real, value.imag))
    if kind in (tuple, frozenset):
        result = tuple(code_tree(item, budget, depth + 1) for item in value)
        return (kind.__name__, frozenset(result) if kind is frozenset else result)
    if kind is slice:
        return ('slice', code_tree((value.start, value.stop, value.step), budget, depth + 1))
    raise AssertionError('Unexpected constant type')


def checksum(body):
    total = 0
    for offset in range(0, len(body), 2):
        if 352 <= offset < 356:
            continue
        total += body[offset] | ((body[offset + 1] if offset + 1 < len(body) else 0) << 8)
        total = (total & 0xffff) + (total >> 16)
    total = (total & 0xffff) + (total >> 16)
    return (total + len(body)) & 0xffffffff


def rechecksum(body):
    body = bytearray(body)
    struct.pack_into('<I', body, 352, checksum(body))
    return bytes(body)


def audit(event, args):
    """Assertions observe trusted tool execution, while refusing payload execution."""
    violation = None
    if event == 'import' and (str(args[0]).split('.')[0] == 'PyInstaller' or
                              str(args[0]) in {'finance', 'app', 'repairs', 'rule_engine', 'sidecar', 'sidecar_release'}):
        violation = 'BUSINESS_OR_PYINSTALLER_IMPORT:' + str(args[0])
    if event == 'exec':
        code = args[0]
        filename = os.path.normcase(os.path.abspath(code.co_filename))
        standard = os.path.normcase('C:/Python314/Lib') + os.sep
        tools = {os.path.normcase(str(path)) for path in (BUILDER, GUARD)}
        official = {os.path.normcase(str(Path('C:/Python314/Lib/site-packages') / relative))
                    for relative in UPSTREAM if relative.endswith('.py')}
        if filename in official:
            if not set(code.co_names) <= {'ZlibArchiveWriter', 'CArchiveWriter', 'replace_filename_in_code_object'}:
                violation = 'WHOLE_UPSTREAM_SOURCE_EXECUTION'
            EXECUTIONS.append({'filename': code.co_filename, 'names': list(code.co_names)})
        elif filename not in tools and not (filename.startswith(standard) and 'site-packages' not in filename):
            if not code.co_filename.startswith('<frozen '):
                violation = 'UNAPPROVED_CODE_EXECUTION:' + code.co_filename
    if event in {'os.system', 'os.spawn', 'os.exec', 'socket.connect'}:
        violation = 'UNAPPROVED_PORT:' + event
    if event == 'subprocess.Popen':
        frame, allowed = sys._getframe(), False
        while frame:
            allowed = allowed or os.path.normcase(os.path.abspath(frame.f_code.co_filename)) == os.path.normcase(str(GUARD))
            frame = frame.f_back
        if not allowed:
            violation = 'NON_GUARD_SUBPROCESS'
    if violation:
        VIOLATIONS.append(violation)
        raise AssertionError(violation)


def tool(test):
    global TOOL
    test.assertTrue(BUILDER.is_file(), 'MISSING_IMPLEMENTATION: audit-tools/finance-repack.py')
    test.assertRegex(ARGS.builder_sha256 or '', '^[0-9a-f]{64}$', 'Root must pin builder bytes for GREEN')
    test.assertEqual(sha(read(BUILDER)), ARGS.builder_sha256)
    if TOOL is None:
        namespace = {'__file__': str(BUILDER), '__name__': 'finance_repack_contract_target'}
        exec(compile(read(BUILDER), str(BUILDER), 'exec'), namespace)  # Pinned trusted tool only.
        TOOL = namespace
    for name in ('build_candidate', 'verify_candidate', 'assert_same_code', 'RepackError'):
        test.assertIn(name, TOOL, 'Missing fixed contract port: ' + name)
    return TOOL


def candidate(test):
    global CANDIDATE
    target = tool(test)
    if CANDIDATE is None:
        CANDIDATE = target['build_candidate'](ARGS.run_id, source_sha256=ARGS.builder_sha256, optimize=0)
    expected = ROOT / 'release-work' / ARGS.run_id / 'modules-input'
    test.assertEqual(os.path.normcase(str(Path(CANDIDATE['modulesInput']))), os.path.normcase(str(expected)))
    return target, expected


class FinanceRepack(unittest.TestCase):
    def test_R01_actual_owned_candidate_copies_both_modules_and_only_ledger_exe_changes(self):
        target, output = candidate(self)
        manifest = json.loads(read(MANIFEST))
        self.assertEqual(sha(read(MANIFEST)), PINS['manifest'])
        self.assertEqual(sha(read(SOURCE)), PINS['finance'])
        self.assertEqual({path.name for path in output.iterdir()}, {'xjy-inventory', 'xjy-ledger'})
        for module in manifest['modules']:
            directory, count = MODULES[module['id']]
            expected = {row['path']: (row['size'], row['sha256']) for row in module['files']}
            original, actual = tree(ORIGINAL / directory), tree(output / directory)
            self.assertEqual(original, expected)
            self.assertEqual(len(actual), count)
            self.assertEqual(set(actual), set(expected))
            changed = [name for name in expected if actual[name] != expected[name]]
            self.assertEqual(changed, ['xjy-ledger.exe'] if module['id'] == 'ledger' else [])
        before, after = read(ORIGINAL / 'xjy-ledger/xjy-ledger.exe'), read(output / 'xjy-ledger/xjy-ledger.exe')
        self.assertEqual(sha(before), PINS['exe'])
        self.assertTrue(target['verify_candidate'](before, after)['passed'])

    def test_R02_existing_owned_output_and_invalid_run_ids_fail_without_overwrite(self):
        target, output = candidate(self)
        saved = tree(output.parent)
        for run_id in (ARGS.run_id, '..', '../outside', 'x/y', 'C:/xjy-results', '', 'CON'):
            with self.subTest(run_id=run_id):
                with self.assertRaises(target['RepackError']):
                    target['build_candidate'](run_id, source_sha256=ARGS.builder_sha256, optimize=0)
                self.assertEqual(tree(output.parent), saved)
        self.assertEqual(sha(read(MANIFEST)), PINS['manifest'])

    def test_R03_pe_prefix_and_valid_checksum_are_both_enforced(self):
        target, output = candidate(self)
        before, after = read(ORIGINAL / 'xjy-ledger/xjy-ledger.exe'), read(output / 'xjy-ledger/xjy-ledger.exe')
        self.assertEqual(before[:352] + before[356:373248], after[:352] + after[356:373248])
        self.assertEqual(struct.unpack_from('<I', after, 352)[0], checksum(after))
        changed = bytearray(after)
        changed[64] ^= 1
        with self.assertRaises(target['RepackError']):
            target['verify_candidate'](before, rechecksum(changed))
        changed = bytearray(after)
        changed[352] ^= 1
        with self.assertRaises(target['RepackError']):
            target['verify_candidate'](before, bytes(changed))

    def test_R04_carchive_order_options_cookie_and_non_pyz_payload_are_preserved(self):
        target, output = candidate(self)
        before, after = read(ORIGINAL / 'xjy-ledger/xjy-ledger.exe'), read(output / 'xjy-ledger/xjy-ledger.exe')
        left, right = archive(before), archive(after)
        self.assertEqual(len(right['rows']), 14)
        self.assertEqual((right['version'], right['library']), (314, b'python314.dll' + b'\0' * 51))
        identity = lambda row: (row['name'], row['type'], row['flag'])
        self.assertEqual([identity(row) for row in left['rows']], [identity(row) for row in right['rows']])
        for old, new in zip(left['rows'], right['rows']):
            if old['type'] != 'z':
                self.assertEqual(old['payload'], new['payload'])
        first, second = right['rows'][:2]
        option = next(row for row in right['rows'] if row['type'] == 'o')
        mutations = []
        changed = bytearray(after)
        changed[first['at'] + first['packed'] - 1] ^= 1
        mutations.append(changed)
        changed = bytearray(after)
        changed[option['tocAt'] + ENTRY.size] ^= 1
        mutations.append(changed)
        changed = bytearray(after)
        start, end = first['tocAt'], second['tocAt'] + second['rowSize']
        changed[start:end] = after[second['tocAt']:end] + after[start:second['tocAt']]
        mutations.append(changed)
        changed = bytearray(after)
        struct.pack_into('!I', changed, len(changed) - COOKIE.size + 20, 313)
        mutations.append(changed)
        for index, changed in enumerate(mutations):
            with self.subTest(mutation=index):
                with self.assertRaises(target['RepackError']):
                    target['verify_candidate'](before, rechecksum(changed))

    def test_R05_actual_pyz_has_only_404_to_56_change_and_comparator_checks_all_fields(self):
        target, output = candidate(self)
        left = decoded_pyz(archive(read(ORIGINAL / 'xjy-ledger/xjy-ledger.exe')))
        right = decoded_pyz(archive(read(output / 'xjy-ledger/xjy-ledger.exe')))
        self.assertEqual([(name, kind) for name, kind, code in left], [(name, kind) for name, kind, code in right])
        changed, unknown, namespaces = [], 0, 0
        for (name, kind, old), (_, _, new) in zip(left, right):
            if name == 'finance':
                changed.append(name)
                expected = compile(read(SOURCE), 'finance.py', 'exec', dont_inherit=True, optimize=0)
                self.assertNotEqual(code_tree(old), code_tree(new))
                self.assertEqual(code_tree(new), code_tree(expected))
                nodes = ast.parse(read(PROBE))
                encoded = next(ast.literal_eval(node.value) for node in nodes.body if isinstance(node, ast.Assign)
                               and any(isinstance(item, ast.Name) and item.id == 'OLD_FINANCE_B64' for item in node.targets))
                old_source = base64.b64decode(encoded, validate=True)
                self.assertEqual(sha(old_source), PINS['oldFinance'])
                self.assertEqual(code_tree(old), code_tree(compile(old_source, 'finance.py', 'exec', dont_inherit=True, optimize=0)))
            elif kind == 3:
                self.assertIsNone(old)
                self.assertIsNone(new)
                namespaces += 1
            else:
                self.assertEqual(code_tree(old), code_tree(new), 'Unknown code changed: ' + name)
                unknown += 1
        self.assertEqual((changed, unknown, namespaces), (['finance'], 926, 6))
        module = compile('def outer(a,b,/,c=0,*args,k=0,**kw):\n x=1\n y=2\n return lambda: (a,x)\n',
                         'contract-synthetic.py', 'exec', dont_inherit=True, optimize=0)
        code = next(value for value in module.co_consts if type(value) is types.CodeType)
        changes = {
            'co_argcount': {'co_argcount': code.co_argcount + 1},
            'co_posonlyargcount': {'co_posonlyargcount': code.co_posonlyargcount + 1},
            'co_kwonlyargcount': {'co_kwonlyargcount': code.co_kwonlyargcount + 1},
            'co_nlocals': {'co_nlocals': code.co_nlocals + 1, 'co_varnames': code.co_varnames + ('extra',)},
            'co_stacksize': {'co_stacksize': code.co_stacksize + 1}, 'co_flags': {'co_flags': code.co_flags ^ 0x10},
            'co_code': {'co_code': code.co_code + b'\x09\x00'}, 'co_consts': {'co_consts': code.co_consts + ('changed',)},
            'co_names': {'co_names': code.co_names + ('changed',)},
            'co_varnames': {'co_nlocals': code.co_nlocals + 1, 'co_varnames': code.co_varnames + ('changed',)},
            'co_freevars': {'co_freevars': code.co_freevars + ('changed',)}, 'co_cellvars': {'co_cellvars': code.co_cellvars + ('changed',)},
            'co_name': {'co_name': code.co_name + '_changed'}, 'co_qualname': {'co_qualname': code.co_qualname + '_changed'},
            'co_filename': {'co_filename': 'changed.py'}, 'co_firstlineno': {'co_firstlineno': code.co_firstlineno + 1},
            'co_linetable': {'co_linetable': code.co_linetable + b'\0'}, 'co_exceptiontable': {'co_exceptiontable': code.co_exceptiontable + b'\0'},
        }
        self.assertEqual(set(changes), set(FIELDS))
        target['assert_same_code'](code, code)
        for field, patch in changes.items():
            with self.subTest(field=field):
                with self.assertRaises(target['RepackError']):
                    target['assert_same_code'](code, code.replace(**patch))
        nested = next(value for value in code.co_consts if type(value) is types.CodeType)
        altered = code.replace(co_consts=tuple(nested.replace(co_filename='nested-changed.py') if value is nested else value for value in code.co_consts))
        with self.assertRaises(target['RepackError']):
            target['assert_same_code'](code, altered)
        literal = compile('value=0.0\n', 'contract-literal.py', 'exec', dont_inherit=True, optimize=0)
        for value in (-0.0, complex(-0.0, 0.0), True, 0):
            with self.subTest(constant=repr(value)):
                altered = literal.replace(co_consts=tuple(value if type(item) is float else item for item in literal.co_consts))
                with self.assertRaises(target['RepackError']):
                    target['assert_same_code'](literal, altered)
        literal = compile('value=0j\n', 'contract-complex.py', 'exec', dont_inherit=True, optimize=0)
        for value in (complex(-0.0, 0.0), complex(0.0, -0.0)):
            with self.subTest(complexBits=struct.pack('!dd', value.real, value.imag).hex()):
                altered = literal.replace(co_consts=tuple(value if type(item) is complex else item for item in literal.co_consts))
                with self.assertRaises(target['RepackError']):
                    target['assert_same_code'](literal, altered)

    def test_R06_pinned_official_definitions_only_and_no_archive_or_business_execution(self):
        target, output = candidate(self)
        evidence = CANDIDATE['writerEvidence']
        self.assertEqual(evidence['upstreamCommit'], 'ecd7993d65c43b254f4e3f718e36d5b4a70a3ed5')
        self.assertEqual(evidence['method'], 'ast-selected-definitions')
        self.assertEqual(evidence['sourceSha256'], UPSTREAM)
        self.assertEqual(evidence['definitions'], ['ZlibArchiveWriter', 'CArchiveWriter', 'replace_filename_in_code_object'])
        self.assertEqual(evidence['segmentSha256'], {
            'ZlibArchiveWriter': '12cb4028c2a7ade1ea3145739e443e93c6470a1d68d48526e787e97d21281af5',
            'CArchiveWriter': '353a7640961ebef96e468b41de2a77af44401ba6cbbb2b8f1a7ccef25ba78cfd',
            'replace_filename_in_code_object': 'e77b4b40c1cbb0868cd152f709f7c271728e8101c40f2f1fc3c4e6e047e935ce',
        })
        self.assertEqual(evidence['compressionLevels'], {'PYZ': 6, 'CArchive': 9})
        self.assertTrue(EXECUTIONS, 'Actual official extracted definition execution must be observed')
        self.assertEqual(VIOLATIONS, [])
        self.assertFalse(any(name == 'PyInstaller' or name.startswith('PyInstaller.') for name in sys.modules))
        self.assertFalse({'finance', 'app', 'repairs', 'rule_engine', 'sidecar', 'sidecar_release'} & set(sys.modules))
        self.assertEqual(sha(read(output.parent / 'PyInstaller-COPYING.txt')), UPSTREAM['COPYING.txt'])
        self.assertEqual(sha(read(MANIFEST)), PINS['manifest'])
        self.assertEqual(sha(read(SOURCE)), PINS['finance'])


def main():
    global ARGS
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--source-sha256', required=True)
    parser.add_argument('--builder-sha256')  # Omit only for the first missing-implementation RED.
    parser.add_argument('--run-id', required=True)
    ARGS = parser.parse_args()
    if not re.fullmatch('[0-9a-f]{64}', ARGS.source_sha256) or sha(read(SELF)) != ARGS.source_sha256:
        raise RuntimeError('Root test source pin required')
    if not re.fullmatch('finance-repack-[a-z0-9][a-z0-9-]{0,39}', ARGS.run_id):
        raise RuntimeError('Fixed finance-repack owned run id required')
    for file, pin in ((PYTHON, 'python'), (GUARD, 'guard'), (ROOT / 'stage1/validate-sandbox-context.py', 'validator'),
                      (MANIFEST, 'manifest'), (SOURCE, 'finance'), (PROBE, 'probe')):
        if sha(read(file)) != PINS[pin]:
            raise RuntimeError('Fixed input changed: ' + pin)
    if sys.version_info[:3] != (3, 14, 8) or importlib.util.MAGIC_NUMBER.hex() != '2b0e0d0a':
        raise RuntimeError('Python 3.14.8 / magic 2b0e0d0a required')
    if 'PYINSTALLER_ZLIB_COMPRESSION_LEVEL' in os.environ:
        raise RuntimeError('Fixed stock writer compression defaults required')
    guard = types.ModuleType('finance_repack_test_actual_context')
    guard.__file__ = str(GUARD)
    exec(compile(read(GUARD), str(GUARD), 'exec'), guard.__dict__)
    admission = guard.read_context(ROOT)
    sys.addaudithook(audit)
    print(json.dumps({'purpose': 'finance-minimal-repack-contract', 'scope': 'actual-Guest-only',
                      'admission': admission, 'tests': 6, 'runId': ARGS.run_id,
                      'selectedOptimizationLevel': 0, 'formalReleaseAuthorized': False}), flush=True)
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(FinanceRepack))
    print(json.dumps({'testsRun': result.testsRun, 'failures': len(result.failures), 'errors': len(result.errors),
                      'passed': result.wasSuccessful(), 'violations': VIOLATIONS,
                      'formalReleaseAuthorized': False}), flush=True)
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    raise SystemExit(main())
