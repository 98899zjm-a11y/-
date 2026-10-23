"""SOURCE_ONLY a2: guarded ERP archive identity, actual Guest only.

layout reads bounded metadata; identity requires the Root-reviewed layout SHA.
No product import, SQLite, writer, hooks, service launch or archive payload exec.
Existing data helpers are pinned and unchanged; their release-only entry points
are never called. Root must review this new guarded metadata adapter before use.
The original a1 and failed layout result remain unchanged. Two frozen legacy
flat EXEs are verified as inert package inputs, never selected or executed.
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PYTHON = Path('C:/Python314/python.exe')
if (os.name != 'nt' or os.path.normcase(str(ROOT)) != os.path.normcase('C:/xjy-work/xjy-web-stage1') or
        os.path.normcase(sys.executable) != os.path.normcase(str(PYTHON)) or
        not sys.flags.isolated or not sys.flags.no_site or not sys.flags.dont_write_bytecode or sys.flags.optimize):
    raise RuntimeError('Fixed actual Guest Python -I -B -S required; Host execution refused')

import argparse
import hashlib
import importlib.util
import json
import re
import stat
import types

SELF = ROOT/'audit-tools/finance-runtime-170-erp-identity-a2.py'
HELPER = ROOT/'audit-tools/finance-repack.py'
HELPER_SHA = 'd630f373911715b3ef5ee80e6fbaeaae838c1469ab53f44759813bc066cf69a7'
READER = ROOT/'audit-tools/finance-archive-readonly-probe.py'
READER_SHA = '2f310d31ca01a61b4169b1d6daa1a64e53ab89f56b86884e8df907ee1c1c6928'
PACKAGED = ROOT/'project/desktop/legacy-modules'
MANIFEST_SHA = '5f0e8d919c541ac07d305544bb1c7036e7cb4ced8c5c4ee8cf262c927bc373d2'
EXE_SHA = '214843e59dcb107b45e508542227311c8a2aaa62c8839df992795d5a78b9e191'
EXE_SIZE = 8599204
MODULES = {
    'ledger': (354, '1.3.0', EXE_SIZE, EXE_SHA),
    'inventory': (143, '1.9.0', 6865579, '5e5532eadae5f7812ad5ec176cdad974f451f1b866a91715e4906fdaa565f351'),
}
FLAT_PROVENANCE_MANIFEST_SHA = '832328a00d26c4e905eb49a1ead21b9b9f1db677d4959cdbcbc8c6d5166dc8a8'
FLAT_PROGRAMS = {
    'xjy-inventory.exe': {'size': 16172975, 'sha256': '714d0b7891cb79f7b5959e55acfe4074839a40b8ad8c3728ea1cd1c02349526f'},
    'xjy-ledger.exe': {'size': 23701534, 'sha256': '5ccac5b7a846ed4a84331e1446640d577ca4d6d944dc2530023790d9f6a91159'},
}
SOURCES = {
    'erp': 'cb3e1c463029e719939f8cf718b2218a99e08831fcb4bc3c4d1199eb8bfc28a0',
    'erp_values': 'e7be9186775fcdf935322d40a7de1757bd1e91b4ad5b69f4090239d1b0a74419',
    'erp_documents': 'fd60ca35b92371092c81654b99697ca5ca151978cd4b8e8b65acecb891c1004f',
    'erp_settlement': '2ee5872aa2ed660c2a41f2326eea6a97e8a4e6c5dd60cf5e6890b59c2d3a32c7',
    'erp_common': '7a682328bb61aecd664a9ae507a30dfbb37c8aa0d551298b5639a926c2f963ab',
    'erp_reports': 'fc316d96468da729438129586deae8c2003f5ae1075757832644cccf3d292a1d',
    'erp_schema': '427dadf39f697e206cbc5b95c16c88048a641232ee85b77e8f8bd008a305fb96',
    'erp_suppliers': 'd5100befc966344fa6d027c88c2feca31c27625d93ca4e30bd9940decf411a17',
    'erp_numbers': '1b9657b3044d20acbec960e4a2b1bf8ba00e5826099416dd72d85a32cb981d7b',
    'erp_runtime': 'cc142c0b7f1537c6bd5ffad37bf437cfd52fbbbd6c1709044c006a8a01cf417a',
    'repairs': 'a54a00506e578b7ded70c78d862a3c8ff3b127c8dddf8c29c67c04aee575eb3b',
    'sidecar': '9f4dddb973609100fed52e4f3c0ec941186c89644fcf68ad27509c0512bb8d1e',
}
RUN_PATTERN = r'finance-runtime-170-erp-[a-z0-9][a-z0-9-]{0,39}'


def initial_pin(file, expected):
    if not file.is_relative_to(ROOT):
        raise RuntimeError('Fixed owned tool source required')
    for entry in (file, *file.parents):
        info = entry.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
            raise RuntimeError('Bootstrap reparse point refused')
        if stat.S_ISREG(info.st_mode) and info.st_nlink != 1:
            raise RuntimeError('Bootstrap hardlink refused')
    before = file.stat()
    if not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= 128*1024:
        raise RuntimeError('Bounded ordinary tool source required')
    identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns, s.st_nlink)
    with file.open('rb') as stream:
        opened = os.fstat(stream.fileno())
        for key in ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_nlink'):
            if getattr(before, key) != getattr(opened, key):
                raise RuntimeError('Bootstrap identity changed')
        body = stream.read(128*1024+1)
        if identity(opened) != identity(os.fstat(stream.fileno())):
            raise RuntimeError('Bootstrap source changed during read')
    if identity(before) != identity(file.stat()) or len(body) != before.st_size:
        raise RuntimeError('Bootstrap source changed after read')
    if hashlib.sha256(body).hexdigest() != expected:
        raise RuntimeError('Bootstrap SHA mismatch')
    return body


def load_tool(name, file, body):
    module = types.ModuleType(name)
    module.__file__ = str(file)
    # Only reviewed tool source bytes, never archive members or product source.
    exec(compile(body, str(file), 'exec', dont_inherit=True, optimize=0), module.__dict__)
    return module


def inputs(m):
    body = m.pinned(PACKAGED/'manifest.json', MANIFEST_SHA)
    manifest = json.loads(body, object_pairs_hook=m.unique_object)
    m.require(manifest.get('version') == 1 and type(manifest.get('modules')) is list and
              len(manifest['modules']) == 2, 'GUARDED_MANIFEST_SCHEMA')
    result = {}
    m.require(sorted(x.name for x in PACKAGED.iterdir()) ==
              ['manifest.json', 'xjy-inventory', 'xjy-inventory.exe', 'xjy-ledger', 'xjy-ledger.exe'],
              'EXACT_GUARDED_ROOT_CONTENTS')
    flat_rows = {}
    for name, expected in FLAT_PROGRAMS.items():
        flat = m.pinned(PACKAGED/name, expected['sha256'])
        m.require(len(flat) == expected['size'], 'FROZEN_LEGACY_FLAT_SIZE:'+name)
        flat_rows[name] = (len(flat), m.sha(flat))
    for entry in manifest['modules']:
        key = entry.get('id')
        m.require(key in MODULES and key not in result, 'EXACT_TWO_MODULES')
        count, version, size, digest = MODULES[key]
        m.require(entry.get('version') == version and entry.get('file') == 'xjy-'+key+'.exe' and
                  entry.get('runtimeMode') == 'onedir' and entry.get('size') == size and
                  entry.get('sha256') == digest and entry.get('purpose') is None, 'FIXED_GUARDED_MODULE')
        m.require(type(entry.get('files')) is list and len(entry['files']) == count, 'FIXED_TREE_COUNT')
        rows, aliases = {}, set()
        for item in entry['files']:
            m.require(type(item) is dict and set(item) == {'path', 'size', 'sha256'}, 'EXACT_FILE_ROW')
            name = m.relative(item['path'])
            m.require(name.casefold() not in aliases and type(item['size']) is int and
                      0 <= item['size'] <= m.MAX_FILE and type(item['sha256']) is str and
                      re.fullmatch('[0-9a-f]{64}', item['sha256']), 'FILE_IDENTITY_OR_ALIAS')
            aliases.add(name.casefold())
            rows[name] = (item['size'], item['sha256'])
        m.require(rows[entry['file']] == (size, digest), 'EXE_MANIFEST_ROW')
        m.require(m.tree(PACKAGED/('xjy-'+key)) == rows, 'COMPLETE_GUARDED_TREE_CHANGED:'+key)
        result[key] = rows
    return {'modules': result, 'flatPrograms': flat_rows}


def guarded_archive(m, reader, body):
    """Narrow guarded-size adapter of reviewed reader.archive_metadata.

    The original release-only reader function remains unchanged and is not
    called. Its PE/PYZ metadata readers and exact 18-field comparator are reused.
    """
    m.require(len(body) == EXE_SIZE and m.sha(body) == EXE_SHA, 'FIXED_GUARDED_EXE')
    pe = reader.pe_metadata(body)
    magic, size, toc_at, toc_size, version, library = reader.COOKIE.unpack(body[-reader.COOKIE.size:])
    m.require(magic == reader.MAGIC and reader.COOKIE.size <= size <= len(body) and
              toc_at+toc_size+reader.COOKIE.size == size and 0 < toc_size <= reader.MAX_METADATA,
              'GUARDED_COOKIE_BOUNDS')
    start = len(body)-size
    m.require(start >= max(pe['sectionTableEnd'], pe['sizeOfHeaders'],
                          *(x['rawOffset']+x['rawSize'] for x in pe['sections'])), 'ARCHIVE_PE_OVERLAP')
    m.require(version == 314 and library == b'python314.dll'+b'\0'*51, 'GUARDED_PYTHON_COOKIE')
    toc = body[start+toc_at:start+toc_at+toc_size]
    rows, ranges, names, cursor = [], [], set(), 0
    while cursor < len(toc):
        m.require(len(rows) < reader.MAX_MEMBERS and cursor+reader.ENTRY.size <= len(toc), 'TOC_LIMIT')
        length, offset, packed, unpacked, flag, typecode = reader.ENTRY.unpack_from(toc, cursor)
        m.require(length >= reader.ENTRY.size+1 and length % 16 == 0 and cursor+length <= len(toc), 'TOC_ROW_BOUNDS')
        raw_name = toc[cursor+reader.ENTRY.size:cursor+length]
        m.require(b'\0' in raw_name, 'TOC_NAME_TERMINATOR')
        name_bytes, padding = raw_name.split(b'\0', 1)
        m.require(not any(padding), 'TOC_NAME_PADDING')
        name, kind = name_bytes.decode('utf-8'), typecode.decode('ascii')
        m.require(0 < len(name) <= 1024 and '\0' not in name and flag in (0, 1) and
                  kind in 'bdzZMmsxolna' and offset <= toc_at and packed <= toc_at-offset and
                  (flag == 1 or packed == unpacked) and 0 <= unpacked <= m.MAX_CODE, 'TOC_MEMBER_BOUNDS')
        m.require(kind == 'o' or name not in names, 'DUPLICATE_CARCHIVE_MEMBER')
        if kind != 'o':
            names.add(name)
        if packed:
            ranges.append((offset, offset+packed))
        raw = body[start+offset:start+offset+packed]
        rows.append({'index': len(rows), 'name': name, 'type': kind, 'offset': offset,
                     'compressedLength': packed, 'uncompressedLength': unpacked,
                     'compressionFlag': flag, 'compressedSha256': m.sha(raw)})
        cursor += length
    ranges.sort()
    m.require(cursor == len(toc) and all(a[1] <= b[0] for a, b in zip(ranges, ranges[1:])), 'TOC_OVERLAP')
    pyzs = [x for x in rows if x['type'] == 'z']
    m.require(len(pyzs) == 1 and pyzs[0]['name'] == 'PYZ.pyz' and pyzs[0]['compressionFlag'] == 0,
              'EXACT_ONE_PYZ')
    mains = [x for x in rows if x['name'] == 'sidecar' and x['type'] == 's']
    m.require(len(mains) == 1, 'EXACT_SIDECAR_SCRIPT')
    pyz_row = pyzs[0]
    pyz = body[start+pyz_row['offset']:start+pyz_row['offset']+pyz_row['compressedLength']]
    pyz_meta = reader.pyz_metadata(pyz)  # allow_code=False for TOC; no payload decoding.
    layout = {'pe': pe, 'archiveStart': start, 'archiveSize': size, 'tocSha256': m.sha(toc),
              'prefixSha256': m.sha(body[:start]), 'carchive': rows, 'pyz': pyz_meta}
    return layout, pyz, mains[0]


def source_path(name):
    return ROOT/'project/desktop/legacy-source/ledger'/(name+'.py')


def compare(m, body, code):
    m.require(type(code) is types.CodeType and len(m.FIELDS) == 18, 'COMPLETE_CODE_OBJECT_REQUIRED')
    original = m.code_tree(code)
    trials = []
    for level in (0, 1, 2):
        candidate = compile(body, code.co_filename, 'exec', dont_inherit=True, optimize=level)
        trials.append({'optimize': level, 'structureSha256': m.fingerprint(candidate),
                       'all18FieldsRecursivelyEqual': m.code_tree(candidate) == original})
    negative = compile(body+b'\n__finance_runtime_identity_negative__ = 1\n', code.co_filename,
                       'exec', dont_inherit=True, optimize=0)
    baseline = compile(body, code.co_filename, 'exec', dont_inherit=True, optimize=0)
    rejected = m.code_tree(negative) != m.code_tree(baseline)
    m.require(rejected, 'SOURCE_CHANGE_NEGATIVE_CONTROL_MUST_DIFFER')
    return {'coFilename': code.co_filename, 'codeStructureSha256': m.fingerprint(code),
            'comparisons': trials, 'matchedOptimizationLevels': [x['optimize'] for x in trials if x['all18FieldsRecursivelyEqual']],
            'inMemorySourceChangeRejectedByComparator': rejected}


def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    for name in ('self-sha256', 'expected-namespace', 'run-id'):
        parser.add_argument('--'+name, required=True)
    parser.add_argument('--phase', choices=('layout', 'identity'), required=True)
    parser.add_argument('--layout-run-id')
    parser.add_argument('--layout-sha256')
    args = parser.parse_args()
    if not re.fullmatch('[0-9a-f]{64}', args.self_sha256) or not re.fullmatch(RUN_PATTERN, args.run_id):
        raise RuntimeError('Root-frozen SHA and bounded fresh run required')
    if not re.fullmatch('[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', args.expected_namespace):
        raise RuntimeError('Actual handback namespace required')
    if args.phase == 'identity':
        if (not re.fullmatch(RUN_PATTERN, args.layout_run_id or '') or
                not re.fullmatch('[0-9a-f]{64}', args.layout_sha256 or '') or args.layout_run_id == args.run_id):
            raise RuntimeError('Identity requires independent reviewed layout run and SHA')
    elif args.layout_run_id is not None or args.layout_sha256 is not None:
        raise RuntimeError('Layout cannot accept a prior result')
    self_body = initial_pin(SELF, args.self_sha256)
    helper_body = initial_pin(HELPER, HELPER_SHA)
    reader_body = initial_pin(READER, READER_SHA)
    m = load_tool('finance_runtime_170_fixed_data_helper', HELPER, helper_body)
    admission = m.admit(HELPER_SHA)  # Unchanged actual Guest admission, before output or archive read.
    reader = load_tool('finance_runtime_170_fixed_readonly_reader', READER, reader_body)
    identity_bytes = m.stable(ROOT/'isolation-identity.json')
    identity = json.loads(identity_bytes.decode('utf-8-sig'), object_pairs_hook=m.unique_object)
    m.require(identity.get('namespace') == args.expected_namespace, 'ACTUAL_NAMESPACE_MISMATCH')
    run = ROOT/'runtime'/args.run_id
    m.mkdir_new(run)
    result = {'purpose': 'finance-runtime-170-guarded-erp-source-identity', 'phase': args.phase,
              'namespace': args.expected_namespace, 'actualContext': admission, 'passed': False,
              'selfSha256': args.self_sha256, 'helperSha256': HELPER_SHA, 'readerSha256': READER_SHA,
              'manifestSha256': MANIFEST_SHA, 'ledgerExeSha256': EXE_SHA, 'sourcePins': SOURCES,
              'flatProvenanceManifestSha256': FLAT_PROVENANCE_MANIFEST_SHA,
              'flatProgramPins': FLAT_PROGRAMS, 'flatProgramsExecuted': False,
              'scope': list(SOURCES), 'codeFields': list(m.FIELDS), 'comparisons': [],
              'compiledSourceEquivalence': False, 'archivePayloadExecuted': False,
              'businessImported': False, 'databaseOpened': False, 'writerLoaded': False,
              'serviceStarted': False, 'currentVersionHttpVerified': False}
    try:
        before = inputs(m)
        exe = m.pinned(PACKAGED/'xjy-ledger/xjy-ledger.exe', EXE_SHA)
        layout, pyz, main_row = guarded_archive(m, reader, exe)
        result['layout'] = layout
        if args.phase == 'identity':
            prior_file = ROOT/'runtime'/args.layout_run_id/'result.json'
            prior = json.loads(m.pinned(prior_file, args.layout_sha256), object_pairs_hook=m.unique_object)
            for key in ('purpose', 'namespace', 'selfSha256', 'helperSha256', 'readerSha256',
                        'manifestSha256', 'ledgerExeSha256', 'sourcePins', 'scope', 'codeFields',
                        'flatProvenanceManifestSha256', 'flatProgramPins', 'flatProgramsExecuted'):
                m.require(prior.get(key) == result[key], 'LAYOUT_BINDING_MISMATCH:'+key)
            m.require(prior.get('phase') == 'layout' and prior.get('passed') is True and
                      prior.get('compiledSourceEquivalence') is False and prior.get('layout') == layout,
                      'REVIEWED_LAYOUT_CHANGED_OR_NOT_LAYOUT_PASS')
            result['reviewedLayout'] = {'runId': args.layout_run_id, 'sha256': args.layout_sha256}
            for name, pin in SOURCES.items():
                body = m.pinned(source_path(name), pin)
                if name == 'sidecar':
                    start = layout['archiveStart']+main_row['offset']
                    payload = exe[start:start+main_row['compressedLength']]
                    if main_row['compressionFlag']:
                        payload = m.inflate(payload)
                    m.require(len(payload) == main_row['uncompressedLength'], 'SIDECAR_LENGTH')
                    location = {'archive': 'CArchive', 'name': 'sidecar', 'type': 's'}
                else:
                    matches = [x for x in layout['pyz']['entries'] if x['name'] == name and x['type'] == 0]
                    m.require(len(matches) == 1, 'EXACT_KNOWN_PYZ_MEMBER_REQUIRED:'+name)
                    row = matches[0]
                    payload = m.inflate(pyz[row['offset']:row['offset']+row['compressedLength']])
                    location = {'archive': 'PYZ', 'name': name, 'type': 0}
                code = m.load_marshaled(payload, True)  # Data only; never exec/import.
                result['comparisons'].append({'module': name, 'sourceSha256': pin,
                                              'payloadSha256': m.sha(payload), **location, **compare(m, body, code)})
            result['compiledSourceEquivalence'] = (len(result['comparisons']) == len(SOURCES) and
                all(x['matchedOptimizationLevels'] for x in result['comparisons']))
            for name, pin in SOURCES.items():
                m.pinned(source_path(name), pin)
        m.require(inputs(m) == before, 'GUARDED_PROGRAM_INPUT_CHANGED')
        m.require(m.pinned(PACKAGED/'xjy-ledger/xjy-ledger.exe', EXE_SHA) == exe, 'EXE_CHANGED')
        m.require(m.stable(ROOT/'isolation-identity.json') == identity_bytes, 'ISOLATION_IDENTITY_CHANGED')
        m.require(m.pinned(SELF, args.self_sha256) == self_body and m.pinned(HELPER, HELPER_SHA) == helper_body and
                  m.pinned(READER, READER_SHA) == reader_body, 'TOOL_INPUT_CHANGED')
        result['originalProgramFilesUnchanged'] = 497
        result['legacyFlatProgramFilesUnchanged'] = 2
        result['passed'] = args.phase == 'layout' or result['compiledSourceEquivalence']
        if not result['passed']:
            result['error'] = 'At least one required source does not match; current-source HTTP claim refused'
    except Exception as error:
        result['errorType'] = type(error).__name__
        result['error'] = str(error)
    finally:
        m.write_json(run/'result.json', result, run)
    print(json.dumps({'phase': args.phase, 'passed': result['passed'],
                      'compiledSourceEquivalence': result['compiledSourceEquivalence'],
                      'result': str(run/'result.json'), 'sha256': m.sha(m.stable(run/'result.json'))}))
    return 0 if result['passed'] else 1


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({'passed': False, 'errorType': type(error).__name__, 'error': str(error)}))
        raise SystemExit(1)
