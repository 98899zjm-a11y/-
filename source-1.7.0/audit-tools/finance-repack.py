"""Fixed actual-Guest finance404 -> finance56 archive repack; Root runs/reviews.

No business/PyInstaller import, Analysis/hooks/provider/EXE.build, payload exec,
production data, signing, installation, or original-input writes. The only exec
targets are the pinned original admission tool and three complete official AST
definitions. Unknown code is decoded solely for the exact 18-field comparison.

Official definitions are read from PyInstaller 6.22.3 commit
ecd7993d65c43b254f4e3f718e36d5b4a70a3ed5, without executing their modules.
Copyright (c) 2005-2023, PyInstaller Development Team.
Distributed under the GNU General Public License (version 2 or later), with
the exception for distributing the bootloader. Full COPYING is retained in
each owned output; the exception is not extended to these tool definitions.
SPDX-License-Identifier: (GPL-2.0-or-later WITH Bootloader-exception)
Adaptation: bounded data readers, fixed inputs, raw-payload CArchive subclass,
exclusive owned file descriptors, and post-write structural verification.
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
import zlib

SELF = ROOT / 'audit-tools/finance-repack.py'
ORIGINAL = ROOT / 'project/desktop/release-modules'
MANIFEST = ORIGINAL / 'manifest.json'
SOURCE = ROOT / 'project/desktop/legacy-source/ledger/finance.py'
PROBE = ROOT / 'audit-tools/finance-archive-readonly-probe.py'
GUARD = ROOT / 'stage1/sandbox-context.py'
VALIDATOR = ROOT / 'stage1/validate-sandbox-context.py'
SITE = Path('C:/Python314/Lib/site-packages')
LICENSE = SITE / 'pyinstaller-6.22.3.dist-info/licenses/COPYING.txt'
UPSTREAM_COMMIT = 'ecd7993d65c43b254f4e3f718e36d5b4a70a3ed5'
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
SEGMENTS = {
    'ZlibArchiveWriter': '12cb4028c2a7ade1ea3145739e443e93c6470a1d68d48526e787e97d21281af5',
    'CArchiveWriter': '353a7640961ebef96e468b41de2a77af44401ba6cbbb2b8f1a7ccef25ba78cfd',
    'replace_filename_in_code_object': 'e77b4b40c1cbb0868cd152f709f7c271728e8101c40f2f1fc3c4e6e047e935ce',
}
INIT_SHA = '0c4f49f4d627c054780d6d36238dfdcf5637da6f2fba9e9e6b796f8b869d1a5f'
FIELDS = ('co_argcount', 'co_posonlyargcount', 'co_kwonlyargcount', 'co_nlocals', 'co_stacksize',
          'co_flags', 'co_code', 'co_consts', 'co_names', 'co_varnames', 'co_freevars', 'co_cellvars',
          'co_name', 'co_qualname', 'co_filename', 'co_firstlineno', 'co_linetable', 'co_exceptiontable')
COOKIE = struct.Struct('!8sIIII64s')
ENTRY = struct.Struct('!IIIIBc')
MAX_FILE = 32 * 1024 * 1024
MAX_TOC = 4 * 1024 * 1024
MAX_CODE = 8 * 1024 * 1024
MODULES = {'inventory': ('xjy-inventory', 143, 30045212), 'ledger': ('xjy-ledger', 353, 41689880)}


class RepackError(RuntimeError):
    pass


def require(value, code):
    if not value:
        raise RepackError(code)


def sha(body):
    return hashlib.sha256(body).hexdigest()


def ordinary(file, boundary=ROOT):
    file, boundary = Path(file), Path(boundary)
    require(file.is_absolute() and file.is_relative_to(boundary), 'PATH_BOUNDARY_REFUSED')
    for item in (file, *file.parents):
        info = item.lstat()
        require(not stat.S_ISLNK(info.st_mode) and not getattr(info, 'st_file_attributes', 0) & 0x400, 'LINK_REFUSED')
        require(not stat.S_ISREG(info.st_mode) or info.st_nlink == 1, 'HARDLINK_REFUSED')
        if item == boundary:
            return file
    raise RepackError('PHYSICAL_BOUNDARY_MISSING')


def identity(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns,
            info.st_nlink, getattr(info, 'st_birthtime_ns', None))


def stable(file, boundary=ROOT, limit=MAX_FILE):
    file = ordinary(file, boundary)
    before = file.stat()
    require(stat.S_ISREG(before.st_mode) and before.st_size <= limit, 'BOUNDED_FILE_REQUIRED')
    with file.open('rb') as stream:
        opened = os.fstat(stream.fileno())
        shared = ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_nlink')
        births = getattr(before, 'st_birthtime_ns', None), getattr(opened, 'st_birthtime_ns', None)
        require(all(getattr(before, name) == getattr(opened, name) for name in shared) and
                (None in births or births[0] == births[1]), 'FILE_CHANGED_BEFORE_READ')
        body = stream.read(limit + 1)
        require(len(body) == before.st_size and identity(opened) == identity(os.fstat(stream.fileno())), 'FILE_CHANGED_DURING_READ')
    require(identity(before) == identity(ordinary(file, boundary).stat()), 'FILE_CHANGED_AFTER_READ')
    return body


def pinned(file, expected, boundary=ROOT):
    body = stable(file, boundary)
    require(sha(body) == expected, 'INPUT_SHA_MISMATCH:' + Path(file).name)
    return body


def unique_object(pairs):
    result = {}
    for name, value in pairs:
        require(name not in result, 'DUPLICATE_JSON_KEY')
        result[name] = value
    return result


def relative(name):
    require(type(name) is str and 0 < len(name) <= 512 and '\\' not in name and ':' not in name and
            not any(ord(char) < 32 for char in name), 'MANIFEST_PATH_REFUSED')
    require(all(part not in ('', '.', '..') and part.rstrip(' .') == part and
                not re.fullmatch(r'(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?', part, re.I)
                for part in name.split('/')), 'MANIFEST_PATH_ALIAS')
    require(not re.search(r'\.(?:db|sqlite3?|key|pem)$', name, re.I), 'NON_PROGRAM_MANIFEST_INPUT')
    return name


def tree(base):
    ordinary(base)
    found, directories = {}, set()
    for file in base.rglob('*'):
        ordinary(file)
        if file.is_file():
            body = stable(file)
            found[file.relative_to(base).as_posix()] = (len(body), sha(body))
        else:
            require(file.is_dir(), 'UNEXPECTED_PROGRAM_NODE')
            directories.add(file.relative_to(base).as_posix())
    implied = {str(Path(name).parent).replace('\\', '/') for name in found}
    implied.discard('.')
    for name in tuple(implied):
        implied.update(str(parent).replace('\\', '/') for parent in Path(name).parents if str(parent) != '.')
    require(directories == implied, 'UNEXPECTED_PROGRAM_DIRECTORY')
    return found


def manifest_inputs():
    body = pinned(MANIFEST, PINS['manifest'])
    manifest = json.loads(body, object_pairs_hook=unique_object)
    require(manifest.get('version') == 1 and type(manifest.get('modules')) is list and len(manifest['modules']) == 2,
            'MODULE_MANIFEST_SCHEMA')
    result = {}
    for module in manifest['modules']:
        module_id = module.get('id')
        require(module_id in MODULES and module_id not in result, 'EXACT_TWO_MODULES_REQUIRED')
        directory, count, total = MODULES[module_id]
        require(module.get('runtimeMode') == 'onedir' and module.get('purpose') == 'desktop-release', 'FIXED_MODULE_MODE')
        require(module.get('version') == ('1.3.0' if module_id == 'ledger' else '1.9.0') and
                module.get('file') == directory + '.exe', 'FIXED_MODULE_IDENTITY')
        files = module.get('files')
        require(type(files) is list and len(files) == count, 'COMPLETE_MODULE_FILE_COUNT')
        rows, aliases = {}, set()
        for row in files:
            require(type(row) is dict and set(row) == {'path', 'size', 'sha256'}, 'FILE_ROW_SCHEMA')
            name = relative(row['path'])
            require(name.casefold() not in aliases and type(row['size']) is int and 0 <= row['size'] <= MAX_FILE and
                    type(row['sha256']) is str and re.fullmatch('[0-9a-f]{64}', row['sha256']), 'FILE_ROW_IDENTITY')
            aliases.add(name.casefold())
            rows[name] = (row['size'], row['sha256'])
        require(sum(size for size, digest in rows.values()) == total, 'COMPLETE_MODULE_BYTE_SUM')
        require(rows[module['file']] == (module['size'], module['sha256']), 'MODULE_EXE_ROW_IDENTITY')
        require(tree(ORIGINAL / directory) == rows, 'ORIGINAL_COMPLETE_MODULE_DRIFT:' + module_id)
        result[module_id] = rows
    return result


def source_inputs():
    new_source = pinned(SOURCE, PINS['finance'])
    probe_source = pinned(PROBE, PINS['probe'])
    syntax = ast.parse(probe_source)
    matches = [node for node in syntax.body if isinstance(node, ast.Assign) and
               any(isinstance(target, ast.Name) and target.id == 'OLD_FINANCE_B64' for target in node.targets)]
    require(len(matches) == 1, 'FIXED_OLD_SOURCE_LITERAL_REQUIRED')
    old_source = base64.b64decode(ast.literal_eval(matches[0].value), validate=True)
    require(sha(old_source) == PINS['oldFinance'] and len(old_source) == 16846 and
            hashlib.sha1(b'blob 16846\0' + old_source).hexdigest() == 'b541c40f5facf984d9116a2e1e9d693147efc59e',
            'FIXED_OLD_SOURCE_IDENTITY')
    return old_source, new_source


def code_tree(value, budget=None, depth=0):
    budget = [0] if budget is None else budget
    require(depth <= 100 and budget[0] < 200000, 'CODE_STRUCTURE_LIMIT')
    budget[0] += 1
    kind = type(value)
    if kind is types.CodeType:
        return ['code', [[name, code_tree(getattr(value, name), budget, depth + 1)] for name in FIELDS]]
    if value is None or value is Ellipsis:
        return ['none' if value is None else 'ellipsis']
    if kind in (bool, int, str):
        return [kind.__name__, str(value)]
    if kind is bytes:
        return ['bytes', value.hex()]
    if kind is float:
        return ['float', struct.pack('!d', value).hex()]
    if kind is complex:
        return ['complex', struct.pack('!dd', value.real, value.imag).hex()]
    if kind in (tuple, frozenset):
        items = [code_tree(item, budget, depth + 1) for item in value]
        if kind is frozenset:
            items.sort(key=lambda item: json.dumps(item, ensure_ascii=True, separators=(',', ':')))
        return [kind.__name__, items]
    if kind is slice:
        return ['slice', code_tree((value.start, value.stop, value.step), budget, depth + 1)]
    raise RepackError('UNSUPPORTED_CODE_CONSTANT_TYPE')


def fingerprint(code):
    return sha(json.dumps(code_tree(code), ensure_ascii=True, separators=(',', ':')).encode())


def assert_same_code(left_code, right_code):
    require(type(left_code) is types.CodeType and type(right_code) is types.CodeType, 'CODE_OBJECTS_REQUIRED')
    require(code_tree(left_code) == code_tree(right_code), 'CODE_18_FIELDS_DIFFER')


def checksum(body):
    total = 0
    for offset in range(0, len(body), 2):
        if 352 <= offset < 356:
            continue
        total += body[offset] | ((body[offset + 1] if offset + 1 < len(body) else 0) << 8)
        total = (total & 0xffff) + (total >> 16)
    total = (total & 0xffff) + (total >> 16)
    return (total + len(body)) & 0xffffffff


def pe(body):
    require(type(body) is bytes and 512 <= len(body) <= MAX_FILE and body[:2] == b'MZ', 'BOUNDED_PE_BYTES_REQUIRED')
    at = struct.unpack_from('<I', body, 60)[0]
    require(at == 264 and body[at:at + 4] == b'PE\0\0', 'FIXED_PE_HEADER_REQUIRED')
    machine, count, stamp = struct.unpack_from('<HHI', body, at + 4)
    optional_size = struct.unpack_from('<H', body, at + 20)[0]
    optional = at + 24
    require(machine == 0x8664 and 0 < count <= 96 and optional_size >= 240 and
            optional + optional_size + count * 40 <= len(body), 'AMD64_PE32_HEADER_REQUIRED')
    require(struct.unpack_from('<H', body, optional)[0] == 0x20b and optional + 64 == 352, 'FIXED_PE32_PLUS_REQUIRED')
    require(struct.unpack_from('<I', body, optional + 108)[0] >= 5 and
            struct.unpack_from('<II', body, optional + 144) == (0, 0), 'EMPTY_CERTIFICATE_DIRECTORY_REQUIRED')
    ends = [optional + optional_size + count * 40, struct.unpack_from('<I', body, optional + 60)[0]]
    for index in range(count):
        section = optional + optional_size + index * 40
        size, offset = struct.unpack_from('<II', body, section + 16)
        require(offset + size <= 373248, 'ARCHIVE_OVERLAPS_PE_SECTION')
        ends.append(offset + size)
    require(max(ends) <= 373248 and stamp == 1791982132, 'FIXED_PE_PREFIX_REQUIRED')
    return {'checksumOffset': 352, 'checksum': struct.unpack_from('<I', body, 352)[0], 'timestamp': stamp}


def inflate(body):
    decoder = zlib.decompressobj()
    result = decoder.decompress(body, MAX_CODE + 1)
    require(len(result) <= MAX_CODE and decoder.eof and not decoder.unused_data and not decoder.unconsumed_tail,
            'BOUNDED_COMPLETE_DECOMPRESSION_REQUIRED')
    return result


def load_marshaled(body, allow_code):
    stream = io.BytesIO(body)
    value = marshal.load(stream, allow_code=allow_code)
    require(stream.tell() == len(body), 'MARSHAL_TRAILING_BYTES')
    return value


def archive(body):
    pe_info = pe(body)
    magic, length, toc_at, toc_size, version, library = COOKIE.unpack(body[-COOKIE.size:])
    require(magic == b'MEI\014\013\012\013\016' and COOKIE.size <= length <= len(body) and
            toc_at + toc_size + COOKIE.size == length and 0 < toc_size <= MAX_TOC, 'EOF_COOKIE_BOUNDS_REQUIRED')
    start = len(body) - length
    require(start == 373248 and version == 314 and library == b'python314.dll' + b'\0' * 51, 'FIXED_ARCHIVE_IDENTITY')
    toc = body[start + toc_at:start + toc_at + toc_size]
    rows, ranges, names, cursor = [], [], set(), 0
    while cursor < len(toc):
        require(len(rows) < 16384 and cursor + ENTRY.size <= len(toc), 'CARCHIVE_TOC_LIMIT')
        size, offset, packed, unpacked, flag, typecode = ENTRY.unpack_from(toc, cursor)
        require(size >= ENTRY.size + 1 and size % 16 == 0 and cursor + size <= len(toc), 'CARCHIVE_TOC_ENTRY_BOUNDS')
        raw_name = toc[cursor + ENTRY.size:cursor + size]
        require(b'\0' in raw_name, 'CARCHIVE_NAME_TERMINATOR')
        name_bytes, padding = raw_name.split(b'\0', 1)
        require(not any(padding), 'CARCHIVE_NAME_PADDING')
        name, kind = name_bytes.decode('utf-8'), typecode.decode('ascii')
        require(0 < len(name) <= 1024 and '\0' not in name and kind in 'bdzZMmsxolna' and flag in (0, 1) and
                offset <= toc_at and packed <= toc_at - offset and (flag or packed == unpacked), 'CARCHIVE_MEMBER_REFUSED')
        require(kind == 'o' or name not in names, 'CARCHIVE_DUPLICATE_MEMBER')
        if kind != 'o':
            names.add(name)
        if packed:
            ranges.append((offset, offset + packed))
        raw = body[start + offset:start + offset + packed]
        payload = inflate(raw) if flag else raw
        require(len(payload) == unpacked, 'CARCHIVE_PAYLOAD_LENGTH')
        require(kind != 'o' or (not payload and flag == 0), 'CARCHIVE_OPTION_PAYLOAD_REFUSED')
        rows.append({'name': name, 'type': kind, 'flag': flag, 'payload': payload})
        cursor += size
    ranges.sort()
    require(cursor == len(toc) and len(rows) == 14 and ranges and ranges[0][0] == 0 and ranges[-1][1] == toc_at and
            all(left[1] == right[0] for left, right in zip(ranges, ranges[1:])), 'COMPLETE_CARCHIVE_LAYOUT_REQUIRED')
    pyzs = [row for row in rows if row['type'] == 'z']
    require(len(pyzs) == 1 and pyzs[0]['name'] == 'PYZ.pyz' and pyzs[0]['flag'] == 0, 'ONE_UNCOMPRESSED_PYZ_REQUIRED')
    return {'prefix': body[:start], 'rows': rows, 'version': version, 'library': library,
            'pyz': pyzs[0]['payload'], 'pe': pe_info}


def pyz(body):
    require(type(body) is bytes and 17 <= len(body) <= MAX_FILE and body[:4] == b'PYZ\0' and
            body[4:8] == importlib.util.MAGIC_NUMBER == bytes.fromhex('2b0e0d0a') and body[12:17] == b'\0' * 5,
            'FIXED_PYZ_HEADER_REQUIRED')
    toc_at = struct.unpack_from('!i', body, 8)[0]
    require(17 <= toc_at <= len(body) and len(body) - toc_at <= MAX_TOC, 'PYZ_TOC_BOUNDS')
    toc = load_marshaled(body[toc_at:], False)
    require(type(toc) in (dict, list, tuple), 'PYZ_TOC_TYPE')
    entries = list(toc.items()) if type(toc) is dict else list(toc)
    require(len(entries) == 933, 'EXACT_933_PYZ_MEMBERS_REQUIRED')
    rows, ranges, names, total = [], [], set(), 0
    counts = {0: 0, 1: 0, 3: 0}
    for entry in entries:
        require(type(entry) in (tuple, list) and len(entry) == 2, 'PYZ_TOC_ROW')
        name, fields = entry
        require(type(name) is str and 0 < len(name) <= 512 and '\0' not in name and name not in names and
                type(fields) in (tuple, list) and len(fields) == 3 and all(type(value) is int for value in fields), 'PYZ_MEMBER_SCHEMA')
        kind, offset, length = fields
        require(kind in counts and 17 <= offset <= toc_at and 0 <= length <= toc_at - offset and
                (length == 0 if kind == 3 else length > 0), 'PYZ_MEMBER_TYPE_OR_BOUNDS')
        names.add(name)
        counts[kind] += 1
        code = None
        if length:
            ranges.append((offset, offset + length))
            payload = inflate(body[offset:offset + length])
            total += len(payload)
            require(total <= 128 * 1024 * 1024, 'PYZ_TOTAL_DECODE_LIMIT')
            code = load_marshaled(payload, True)  # Code data only; never exec/import.
            require(type(code) is types.CodeType, 'PYZ_CODE_OBJECT_REQUIRED')
        rows.append({'name': name, 'type': kind, 'code': code})
    ranges.sort()
    require(ranges and ranges[0][0] == 17 and ranges[-1][1] == toc_at and
            all(left[1] == right[0] for left, right in zip(ranges, ranges[1:])), 'COMPLETE_PYZ_LAYOUT_REQUIRED')
    require(counts == {0: 821, 1: 106, 3: 6} and
            len([row for row in rows if row['name'] == 'finance' and row['type'] == 0]) == 1, 'FIXED_PYZ_MEMBER_TYPES')
    return rows


def verify_candidate(original_exe_bytes, candidate_exe_bytes):
    try:
        require(type(original_exe_bytes) is bytes and len(original_exe_bytes) == 8520018 and
                sha(original_exe_bytes) == PINS['exe'], 'PINNED_ORIGINAL_EXE_REQUIRED')
        before, after = archive(original_exe_bytes), archive(candidate_exe_bytes)
        require(before['prefix'][:352] + before['prefix'][356:] == after['prefix'][:352] + after['prefix'][356:],
                'PE_PREFIX_EXCEPT_CHECKSUM_CHANGED')
        require(after['pe']['checksum'] == checksum(candidate_exe_bytes), 'CANDIDATE_CHECKSUM_MISMATCH')
        require(before['version'] == after['version'] and before['library'] == after['library'], 'COOKIE_IDENTITY_CHANGED')
        meta = lambda row: (row['name'], row['type'], row['flag'])
        require([meta(row) for row in before['rows']] == [meta(row) for row in after['rows']], 'ORDERED_CARCHIVE_METADATA_CHANGED')
        for left, right in zip(before['rows'], after['rows']):
            if left['type'] != 'z':
                require(left['payload'] == right['payload'], 'NON_PYZ_CARCHIVE_PAYLOAD_CHANGED:' + left['name'])
        old_rows, new_rows = pyz(before['pyz']), pyz(after['pyz'])
        require([(row['name'], row['type']) for row in old_rows] == [(row['name'], row['type']) for row in new_rows],
                'ORDERED_PYZ_METADATA_CHANGED')
        old_source, new_source = source_inputs()
        old_known = compile(old_source, 'finance.py', 'exec', dont_inherit=True, optimize=0)
        new_known = compile(new_source, 'finance.py', 'exec', dont_inherit=True, optimize=0)
        unknown, namespaces, finance, code_proof = 0, 0, None, []
        for left, right in zip(old_rows, new_rows):
            name = left['name']
            if left['type'] == 3:
                require(left['code'] is None and right['code'] is None, 'NAMESPACE_PAYLOAD_CHANGED')
                namespaces += 1
            elif name == 'finance':
                assert_same_code(left['code'], old_known)
                assert_same_code(right['code'], new_known)
                finance = {'oldSourceSha256': PINS['oldFinance'], 'newSourceSha256': PINS['finance'],
                           'oldStructureSha256': fingerprint(left['code']), 'newStructureSha256': fingerprint(right['code']),
                           'optimization': 0, 'filename': 'finance.py', 'dontInherit': True}
                require(finance['oldStructureSha256'] != finance['newStructureSha256'], 'FINANCE_REPLACEMENT_REQUIRED')
            else:
                assert_same_code(left['code'], right['code'])
                code_proof.append({'name': name, 'type': left['type'], 'structureSha256': fingerprint(left['code'])})
                unknown += 1
        require(finance is not None and unknown == 926 and namespaces == 6, 'ALL_PYZ_MEMBERS_NOT_VERIFIED')
        return {'passed': True, 'originalExeSha256': sha(original_exe_bytes), 'candidateExeSha256': sha(candidate_exe_bytes),
                'candidateSize': len(candidate_exe_bytes), 'prefixLength': 373248, 'checksumOffset': 352,
                'checksum': after['pe']['checksum'], 'prefixExceptChecksumIdentical': True,
                'carchiveEntries': [{'name': row['name'], 'type': row['type'], 'compressionFlag': row['flag'],
                                     'payloadSha256': sha(row['payload'])} for row in after['rows']],
                'pyzEntries': 933, 'unknownCodeObjectsVerified': unknown, 'namespacesVerified': namespaces,
                'codeFields': list(FIELDS), 'unknownCodeProof': code_proof, 'finance': finance,
                'archivePayloadExecuted': False, 'businessModulesImported': False, 'formalReleaseAuthorized': False}
    except RepackError:
        raise
    except Exception as error:
        raise RepackError('CANDIDATE_VERIFICATION_FAILED:' + type(error).__name__) from error


def writer_sources():
    result = {relative: pinned(SITE / relative, expected, Path('C:/')) for relative, expected in UPSTREAM.items()
              if relative != 'COPYING.txt'}
    result['COPYING.txt'] = pinned(LICENSE, UPSTREAM['COPYING.txt'], Path('C:/'))
    pinned(SITE / 'PyInstaller/__init__.py', INIT_SHA, Path('C:/'))
    return result


def selected_definitions(body, names):
    source = body.decode('utf-8')
    parsed = ast.parse(source)
    result = []
    for name in names:
        matches = [node for node in parsed.body if isinstance(node, (ast.ClassDef, ast.FunctionDef)) and node.name == name]
        require(len(matches) == 1, 'ONE_OFFICIAL_DEFINITION_REQUIRED:' + name)
        node = matches[0]
        require(not node.decorator_list and sha(ast.get_source_segment(source, node).encode('utf-8')) == SEGMENTS[name],
                'OFFICIAL_DEFINITION_SEGMENT_CHANGED:' + name)
        result.append(node)  # The original complete node, with no method/AST edits.
    return ast.Module(body=result, type_ignores=[])


def load_writers():
    require('PYINSTALLER_ZLIB_COMPRESSION_LEVEL' not in os.environ, 'FIXED_STOCK_COMPRESSION_DEFAULTS_REQUIRED')
    bodies = writer_sources()
    namespace = {'__name__': 'finance_repack_pinned_official_definitions', 'os': os, 'marshal': marshal, 'struct': struct,
                 'sys': sys, 'zlib': zlib, 'types': types, 'BYTECODE_MAGIC': importlib.util.MAGIC_NUMBER,
                 'PYZ_ITEM_MODULE': 0, 'PYZ_ITEM_PKG': 1, 'PYZ_ITEM_NSPKG': 3}
    helper_path = SITE / 'PyInstaller/building/utils.py'
    writers_path = SITE / 'PyInstaller/archive/writers.py'
    helper = selected_definitions(bodies['PyInstaller/building/utils.py'], ['replace_filename_in_code_object'])
    writers = selected_definitions(bodies['PyInstaller/archive/writers.py'], ['ZlibArchiveWriter', 'CArchiveWriter'])
    exec(compile(helper, str(helper_path), 'exec', dont_inherit=True, optimize=0), namespace)
    exec(compile(writers, str(writers_path), 'exec', dont_inherit=True, optimize=0), namespace)
    zlib_writer, carchive_writer = namespace['ZlibArchiveWriter'], namespace['CArchiveWriter']
    require(zlib_writer._COMPRESSION_LEVEL == 6 and carchive_writer._COMPRESSION_LEVEL == 9, 'WRITER_COMPRESSION_DEFAULTS_CHANGED')

    class PayloadCArchiveWriter(carchive_writer):
        def _write_entry(self, fp, entry):
            name, payload, flag, kind = entry
            return self._write_blob(fp, payload, name, kind, compress=bool(flag))

    evidence = {'upstreamCommit': UPSTREAM_COMMIT, 'method': 'ast-selected-definitions', 'sourceSha256': dict(UPSTREAM),
                'definitions': ['ZlibArchiveWriter', 'CArchiveWriter', 'replace_filename_in_code_object'],
                'segmentSha256': dict(SEGMENTS), 'compressionLevels': {'PYZ': 6, 'CArchive': 9},
                'wholeUpstreamModuleExecuted': False, 'pyinstallerImported': False,
                'originalCArchiveWriteEntryUsed': False, 'licensePath': str(LICENSE)}
    return zlib_writer, PayloadCArchiveWriter, evidence, bodies


def mkdir_new(directory):
    ordinary(directory.parent)
    directory.mkdir(exist_ok=False)
    ordinary(directory)
    require(directory.is_dir(), 'OWNED_DIRECTORY_REQUIRED')


def parents_for(file, run):
    require(file.is_relative_to(run) and file != run, 'OWNED_OUTPUT_REQUIRED')
    ordinary(run)
    current = run
    for part in file.parent.relative_to(run).parts:
        current = current / part
        if current.exists():
            ordinary(current)
            require(current.is_dir(), 'OUTPUT_PARENT_DIRECTORY_REQUIRED')
        else:
            mkdir_new(current)


def write_new(file, body, run):
    require(type(body) is bytes and len(body) <= MAX_FILE, 'BOUNDED_OUTPUT_BYTES_REQUIRED')
    parents_for(file, run)
    with file.open('xb') as stream:
        require(stream.write(body) == len(body), 'OUTPUT_WRITE_INCOMPLETE')
        stream.flush()
        os.fsync(stream.fileno())
    require(stable(file) == body, 'OUTPUT_READBACK_MISMATCH')


def write_json(file, value, run):
    write_new(file, (json.dumps(value, ensure_ascii=True, indent=2) + '\n').encode(), run)


def writer_new(writer, file, run, *arguments):
    parents_for(file, run)
    # The official constructor uses open(filename, 'wb'). Passing our exclusive
    # file's duplicate descriptor preserves the complete official definition,
    # while preventing its wb mode from reopening or overwriting an output path.
    with file.open('xb') as stream:
        duplicate = os.dup(stream.fileno())
        writer(duplicate, *arguments)  # Official with-open closes the duplicate.
        stream.flush()
        os.fsync(stream.fileno())
    ordinary(file)


def admit(source_sha256):
    require(re.fullmatch('[0-9a-f]{64}', source_sha256 or '') is not None, 'ROOT_BUILDER_SOURCE_SHA_REQUIRED')
    pinned(SELF, source_sha256)
    pinned(PYTHON, PINS['python'], Path('C:/'))
    require(sys.version_info[:3] == (3, 14, 8) and importlib.util.MAGIC_NUMBER.hex() == '2b0e0d0a', 'FIXED_PYTHON_VERSION_MAGIC_REQUIRED')
    checked_guard = pinned(GUARD, PINS['guard'])
    pinned(VALIDATOR, PINS['validator'])
    guard = types.ModuleType('finance_repack_actual_context')
    guard.__file__ = str(GUARD)
    exec(compile(checked_guard, str(GUARD), 'exec', dont_inherit=True, optimize=0), guard.__dict__)
    return guard.read_context(ROOT)  # Unchanged guard's metadata helper only.


def build_candidate(run_id, *, source_sha256, optimize=0):
    run = None
    created = False
    try:
        require(type(run_id) is str and re.fullmatch('finance-repack-[a-z0-9][a-z0-9-]{0,39}', run_id), 'FIXED_OWNED_RUN_ID_REQUIRED')
        require(type(optimize) is int and optimize == 0, 'ROOT_FIXED_OPTIMIZE_ZERO_REQUIRED')
        run = ROOT / 'release-work' / run_id
        ordinary(run.parent)
        require(not run.exists() and not run.is_symlink() and not os.path.isjunction(run), 'OUTPUT_RUN_ALREADY_EXISTS')
        admission = admit(source_sha256)
        inputs = manifest_inputs()
        old_source, new_source = source_inputs()
        original_exe = pinned(ORIGINAL / 'xjy-ledger/xjy-ledger.exe', PINS['exe'])
        original_archive = archive(original_exe)
        original_rows = pyz(original_archive['pyz'])
        old_known = compile(old_source, 'finance.py', 'exec', dont_inherit=True, optimize=0)
        new_known = compile(new_source, 'finance.py', 'exec', dont_inherit=True, optimize=0)
        old_finance = next(row['code'] for row in original_rows if row['name'] == 'finance')
        assert_same_code(old_finance, old_known)
        zlib_writer, payload_writer, writer_evidence, tool_bodies = load_writers()
        mkdir_new(run)
        created = True
        write_json(run / '.owner.json', {'version': 1, 'purpose': 'finance-minimal-repack', 'runId': run_id,
                                        'sourceSha256': source_sha256}, run)
        write_new(run / 'PyInstaller-COPYING.txt', tool_bodies['COPYING.txt'], run)
        notices = ['PyInstaller 6.22.3; commit ' + UPSTREAM_COMMIT,
                   'Complete definitions selected into memory only; no whole module imports or AST edits.',
                   'Payload CArchive subclass and exclusive output descriptors are finance-repack adaptations.']
        for name in ('PyInstaller/archive/writers.py', 'PyInstaller/building/utils.py'):
            notices.extend(['', name, *tool_bodies[name].decode('utf-8').splitlines()[:10]])
        write_new(run / 'PyInstaller-source-notice.txt', ('\n'.join(notices) + '\n').encode(), run)
        entries, code_dict = [], {}
        for row in original_rows:
            name, kind = row['name'], row['type']
            metadata_name = None if kind == 3 else ('__init__.py' if kind == 1 else 'module.py')
            entries.append((name, metadata_name, 'PYMODULE'))
            if kind != 3:
                code_dict[name] = new_known if name == 'finance' else row['code']
        writer_new(zlib_writer, run / 'finance.pyz', run, entries, code_dict)
        new_pyz = stable(run / 'finance.pyz')
        # Before building the EXE, prove official filename rewriting changed no
        # unknown code fields. No exception or fallback is admitted.
        rewritten_rows = pyz(new_pyz)
        require([(row['name'], row['type']) for row in original_rows] == [(row['name'], row['type']) for row in rewritten_rows],
                'WRITER_CHANGED_ORDERED_PYZ_METADATA')
        for left, right in zip(original_rows, rewritten_rows):
            if left['type'] != 3:
                assert_same_code(new_known if left['name'] == 'finance' else left['code'], right['code'])
        payload_entries = [(row['name'], new_pyz if row['type'] == 'z' else row['payload'], row['flag'], row['type'])
                           for row in original_archive['rows']]
        writer_new(payload_writer, run / 'finance.pkg', run, payload_entries, 'python314.dll')
        candidate_exe = bytearray(original_archive['prefix'] + stable(run / 'finance.pkg'))
        require(len(candidate_exe) <= MAX_FILE, 'CANDIDATE_EXE_BYTE_LIMIT')
        struct.pack_into('<I', candidate_exe, 352, checksum(candidate_exe))
        candidate_exe = bytes(candidate_exe)
        proof = verify_candidate(original_exe, candidate_exe)
        modules_input = run / 'modules-input'
        mkdir_new(modules_input)
        expected_output = {}
        for module_id, (directory, count, total) in MODULES.items():
            expected_output[module_id] = dict(inputs[module_id])
            for name, (size, digest) in inputs[module_id].items():
                original_bytes = stable(ORIGINAL / directory / name)
                require((len(original_bytes), sha(original_bytes)) == (size, digest), 'COPY_INPUT_DRIFT:' + name)
                body = candidate_exe if module_id == 'ledger' and name == 'xjy-ledger.exe' else original_bytes
                write_new(modules_input / directory / name, body, run)
                expected_output[module_id][name] = (len(body), sha(body))
        copied = []
        for module_id, (directory, count, total) in MODULES.items():
            require(tree(modules_input / directory) == expected_output[module_id], 'COMPLETE_COPY_READBACK_MISMATCH:' + module_id)
            copied.extend({'module': module_id, 'path': name, 'size': size, 'sha256': digest}
                          for name, (size, digest) in expected_output[module_id].items())
        reopened = stable(modules_input / 'xjy-ledger/xjy-ledger.exe')
        require(verify_candidate(original_exe, reopened) == proof, 'REOPENED_CANDIDATE_PROOF_CHANGED')
        require(manifest_inputs() == inputs and source_inputs() == (old_source, new_source), 'ORIGINAL_INPUTS_CHANGED_DURING_BUILD')
        require(writer_sources() == tool_bodies, 'OFFICIAL_TOOLS_CHANGED_DURING_BUILD')
        pinned(SELF, source_sha256)
        pinned(GUARD, PINS['guard'])
        pinned(VALIDATOR, PINS['validator'])
        for module_id, (directory, count, total) in MODULES.items():
            require(tree(modules_input / directory) == expected_output[module_id], 'FINAL_COMPLETE_COPY_CHANGED:' + module_id)
        result = {'purpose': 'finance-minimal-repack', 'state': 'ACTUAL_GUEST_CANDIDATE', 'passed': True,
                  'runId': run_id, 'sourceSha256': source_sha256, 'admission': admission, 'modulesInput': str(modules_input),
                  'pythonVersion': sys.version, 'pythonMagic': importlib.util.MAGIC_NUMBER.hex(),
                  'selectedOptimizationLevel': 0, 'writerEvidence': writer_evidence, 'sourcePins': dict(PINS),
                  'proof': proof, 'copiedFiles': copied, 'originalInputsUnchanged': True,
                  'repackPerformed': True, 'archivePayloadExecuted': False, 'businessModulesImported': False,
                  'pyinstallerImported': False, 'analysisOrHooksRun': False, 'executableLaunched': False,
                  'productionDataAccessed': False, 'formalReleaseAuthorized': False}
        write_json(run / 'result.json', result, run)
        return result
    except Exception as error:
        failure = error if isinstance(error, RepackError) else RepackError('BUILD_FAILED:' + type(error).__name__)
        if created:
            write_json(run / 'result.json', {'purpose': 'finance-minimal-repack', 'passed': False, 'runId': run_id,
                                            'sourceSha256': source_sha256, 'error': str(failure),
                                            'failedOutputRetained': True, 'formalReleaseAuthorized': False}, run)
        raise failure from error


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--source-sha256', required=True)
    parser.add_argument('--run-id', required=True)
    args = parser.parse_args()
    try:
        outcome = build_candidate(args.run_id, source_sha256=args.source_sha256, optimize=0)
        print(json.dumps({'purpose': outcome['purpose'], 'passed': True, 'modulesInput': outcome['modulesInput'],
                          'result': str(Path(outcome['modulesInput']).parent / 'result.json'),
                          'formalReleaseAuthorized': False}), flush=True)
    except RepackError as error:
        print(json.dumps({'purpose': 'finance-minimal-repack', 'passed': False, 'error': str(error)}), file=sys.stderr, flush=True)
        raise SystemExit(1)
