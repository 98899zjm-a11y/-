"""Host DATA ONLY. Copy an explicit reviewed public inventory; execute no engine/code input."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import re
import stat

ROOT = Path(__file__).resolve().parent.parent
EXPECTED = Path('E:/codex/2026-10-15/work/xjy-v16-deep-audit')
VENDOR = EXPECTED/'vendor-input/electron-v44.7.2-win32-x64-20261016-a86f4934'
OUTPUT = EXPECTED/'sandbox/input/electron-4472-capability-a1'
INPUT_SEAL = '590049ad903dfb340716d910d9f4b3958b3d793d61a3455e853b8cf789d5f7cb'
ZIP_SHA = '10a89447ef64ac5cb9f782af48ffd83734a40ae91681259d1048ca3c9e6c5da4'
EXE_SHA = '1f41127064012c5e74422b2e0dfc35ff0b0fe8d7908b97d01503becd1b7fa9e1'
TOP = frozenset({'electron.exe', 'LICENSE', 'LICENSES.chromium.html', 'version', 'chrome_100_percent.pak',
                 'chrome_200_percent.pak', 'd3dcompiler_47.dll', 'dxcompiler.dll', 'dxil.dll', 'ffmpeg.dll',
                 'icudtl.dat', 'resources.pak', 'snapshot_blob.bin', 'v8_context_snapshot.bin',
                 'vk_swiftshader.dll', 'vk_swiftshader_icd.json', 'vulkan-1.dll'})
TOOLS = {'tools/electron-4472-probe.cjs': 'audit-tools/electron-4472-probe.cjs',
         'tools/electron-4472-guest.py': 'audit-tools/electron-4472-guest.py',
         'support/sandbox-context.py': 'stage1/sandbox-context.py',
         'support/guest-owned-process-proof.py': 'stage1/guest-owned-process-proof.py'}


def relative(value):
    if not isinstance(value, str) or not value or re.search(r'[\\:\x00-\x1f]', value):
        raise RuntimeError('Unsafe public input relative path')
    for part in value.split('/'):
        if part in ('', '.', '..') or part.rstrip(' .') != part or re.fullmatch(r'(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?', part, re.I):
            raise RuntimeError('Unsafe public input path component')
    return value


def engine_name(value):
    relative(value)
    if value not in TOP and not re.fullmatch(r'locales/[A-Za-z0-9_-]+\.pak', value):
        raise RuntimeError('Only the exact official engine inventory is accepted')
    return value


def ordinary(file, boundary=None, missing=False):
    if boundary is not None and not file.is_relative_to(boundary):
        raise RuntimeError('Data-only path escaped its owned boundary')
    for part in (file, *file.parents):
        try:
            s = part.lstat()
        except FileNotFoundError:
            if missing:
                continue
            raise
        if stat.S_ISLNK(s.st_mode) or getattr(s, 'st_file_attributes', 0) & 0x400:
            raise RuntimeError('Reparse/symbolic path refused')
        if stat.S_ISREG(s.st_mode) and s.st_nlink != 1:
            raise RuntimeError('Hardlinked input/output refused')
    return file


def stamp(s):
    return s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns, s.st_nlink


def same_open_file(before, opened):
    # Windows path-stat and handle-stat ctime can have different meanings.
    shared = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_nlink)
    birth = (getattr(before, 'st_birthtime_ns', None), getattr(opened, 'st_birthtime_ns', None))
    return shared(before) == shared(opened) and (None in birth or birth[0] == birth[1])


def transfer(source, expected, target=None):
    before = ordinary(source).stat()
    if not source.is_file() or before.st_size != expected['size']:
        raise RuntimeError('Public input size/type mismatch')
    digest = hashlib.sha256()
    with source.open('rb') as incoming:
        opened = os.fstat(incoming.fileno())
        if not same_open_file(before, opened):
            raise RuntimeError('Public input identity changed before open')
        outgoing = None
        try:
            if target is not None:
                ordinary(target, OUTPUT, missing=True)
                target.parent.mkdir(parents=True, exist_ok=True)
                ordinary(target.parent, OUTPUT)
                outgoing = target.open('xb')
            first = True
            while block := incoming.read(1024*1024):
                if first and block.startswith(b'SQLite format 3\0'):
                    raise RuntimeError('Renamed database refused')
                first = False
                digest.update(block)
                if outgoing:
                    outgoing.write(block)
            if outgoing:
                outgoing.flush()
                os.fsync(outgoing.fileno())
        finally:
            if outgoing:
                outgoing.close()
        if stamp(os.fstat(incoming.fileno())) != stamp(opened) or stamp(ordinary(source).stat()) != stamp(before):
            raise RuntimeError('Public input changed during copy')
    if digest.hexdigest() != expected['sha256']:
        raise RuntimeError('Public input hash mismatch')
    if target is not None:
        transfer(target, expected)  # Verify actual copied bytes, not only the source stream.
    return {'size': before.st_size, 'sha256': digest.hexdigest()}


def read_sealed(file, seal):
    ordinary(file)
    data = file.read_bytes()
    if hashlib.sha256(data).hexdigest() != seal:
        raise RuntimeError('Reviewed text seal mismatch')
    return json.loads(data)


def prepare(contract_sha):
    if ROOT != EXPECTED or not re.fullmatch('[0-9a-f]{64}', contract_sha):
        raise RuntimeError('Fixed isolated Host data root and explicit reviewed contract seal required')
    ordinary(ROOT)
    contract_path = ROOT/'audit-tools/electron-4472-probe-contract.json'
    contract = read_sealed(contract_path, contract_sha)
    if contract.get('purpose') != 'electron-4472-memory-capability-only' or contract.get('engineInputManifestSha256') != INPUT_SEAL:
        raise RuntimeError('Wrong preparation contract')
    expected_tools = {**TOOLS, 'host/electron-4472-prepare.py': 'audit-tools/electron-4472-prepare.py'}
    rows = contract.get('sourceFiles', [])
    if {r['destination']: r['source'] for r in rows} != expected_tools or len(rows) != len(expected_tools):
        raise RuntimeError('Exact probe/support source inventory required')
    for row in rows:
        transfer(ROOT/row['source'], row)
    input_path = ROOT/'audit-tools/electron-4472-manifest.json'
    source = read_sealed(input_path, INPUT_SEAL)
    if source['archive']['sha256'] != ZIP_SHA or source['officialVersionFile'] != '44.7.2' or source['fileCount'] != 73:
        raise RuntimeError('Fixed official public input required')
    transfer(VENDOR/source['archive']['name'], {'size': 157867015, 'sha256': ZIP_SHA})
    engine = []
    for row in source['files']:
        if row['path'] == 'resources/default_app.asar':
            continue
        name = engine_name(row['path'])
        engine.append({'path': 'engine/'+name, 'source': VENDOR/'extracted'/name, 'size': row['size'], 'sha256': row['sha256']})
    if len(engine) != 72 or len({r['path'].casefold() for r in engine}) != 72 or sum(r['size'] for r in engine) != 384691764:
        raise RuntimeError('Exact 72-file official engine required')
    if next(r for r in engine if r['path'] == 'engine/electron.exe')['sha256'] != EXE_SHA:
        raise RuntimeError('Fixed new official EXE required')
    ordinary(OUTPUT, ROOT, missing=True)
    OUTPUT.mkdir(parents=True, exist_ok=False)
    output_rows = []
    sources = engine + [{'path': r['destination'], 'source': ROOT/r['source'], 'size': r['size'], 'sha256': r['sha256']} for r in rows if not r['destination'].startswith('host/')]
    for name, file in [('evidence/electron-4472-manifest.json', input_path), ('evidence/probe-contract.json', contract_path)]:
        sources.append({'path': name, 'source': file, 'size': file.stat().st_size, 'sha256': INPUT_SEAL if file == input_path else contract_sha})
    for row in sources:
        relative(row['path'])
        spec = transfer(row['source'], row, OUTPUT/row['path'])
        output_rows.append({'path': row['path'], **spec})
    manifest = {'version': 1, 'purpose': contract['purpose'], 'runId': 'a1', 'engineVersion': '44.7.2',
                'contractSha256': contract_sha, 'officialInputManifestSha256': INPUT_SEAL,
                'files': sorted(output_rows, key=lambda r: r['path']), 'engineFileCount': 72,
                'engineBytes': 384691764, 'engineExecutableSha256': EXE_SHA,
                'vendorDemoAsarIncluded': False, 'businessResourcesIncluded': False,
                'sourceVerification': 'Official GitHub release SHA and separately fetched same-channel SHASUMS agreement',
                'electronAuthenticode': 'NotSigned', 'independentArtifactSignatureVerified': False,
                'engineExecuted': False, 'productionDeploymentAuthorized': False}
    data = (json.dumps(manifest, ensure_ascii=True, indent=2)+'\n').encode()
    with (OUTPUT/'capsule-manifest.json').open('xb') as stream:
        stream.write(data)
    print(json.dumps({'dataOnlyPrepared': True, 'path': str(OUTPUT), 'manifestSha256': hashlib.sha256(data).hexdigest(),
                      'files': len(output_rows), 'engineExecuted': False, 'electronAuthenticode': 'NotSigned'}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--contract-sha256', required=True)
    prepare(parser.parse_args().contract_sha256)
