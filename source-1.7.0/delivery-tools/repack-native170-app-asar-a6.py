#!/usr/bin/env python3
"""Pure-data ten-member ASAR overlay/verification. No product execution or signing."""
import argparse
import copy
import hashlib
import json
import os
import re
from pathlib import Path
import stat
import sys
import types

ROOT = Path('E:/codex/2026-10-15/work/xjy-v16-deep-audit')
RW = ROOT / 'release-work'
OUT = RW / 'native170-package-closure-a6/final-asar'
BASE = RW / 'entry170-ui-asar-candidate-a2/app.asar'
BASE_PIN = 'c37887dca5a4fe8dcda94b41de10e41634ad04d3ace799e7c4be4748cf9bf723'
PARSER = ROOT / 'audit-tools/deepseek-entry170-a6/xjy_asar_repack_a2.py'
PARSER_PIN = '5f0f1a8ef71d4e1cd6df81ad6c920daaad7eb6f0ad4a7953d4c8fb541bd8d9fd'
RENDERER = 'renderer-dist/assets/main-7etXIfP0.js'
RENDERER_PIN = '870a724e04c030ec2bf3e3050b4adcf227c076cfc660a7e3d2421ba7b0db1ef7'
OLD = frozenset(['native-employee-update.cjs', 'update-distribution.cjs', 'release-host-services.cjs', 'employee-update-cache.cjs'])
NEW = frozenset(['native-publication-update.cjs', 'native-update-manifest.cjs', 'native-update-package.cjs', 'native-update-handoff.cjs', 'native-employee-location170.cjs', 'native-update-distribution.cjs'])
ALLOWED = OLD | NEW


def cache_export_only(before, after):
    pattern = re.compile(rb'\Amodule\.exports=\{([A-Za-z0-9_,\s]+)\};\s*\Z')
    marker = b'module.exports='
    if before.count(marker) != 1 or after.count(marker) != 1:
        fail('CACHE_EXPORT_ONLY', 'Unique existing export object required')
    prefix, old_export = before.split(marker)
    new_prefix, new_export = after.split(marker)
    old_match = pattern.match(marker + old_export)
    new_match = pattern.match(marker + new_export)
    if prefix != new_prefix or not old_match or not new_match:
        fail('CACHE_EXPORT_ONLY', 'Cache implementation must remain byte-identical')
    old_names = [x.strip() for x in old_match.group(1).split(b',')]
    new_names = [x.strip() for x in new_match.group(1).split(b',')]
    if b'integrityKey' in old_names or new_names.count(b'integrityKey') != 1 or [x for x in new_names if x != b'integrityKey'] != old_names:
        fail('CACHE_EXPORT_ONLY', 'Only existing integrityKey export addition is allowed')


def fail(code, text):
    raise ValueError(code + ': ' + text)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def is_sha(value):
    return isinstance(value, str) and len(value) == 64 and all(c in '0123456789abcdef' for c in value)


def ordinary(file, scope=RW):
    file = Path(os.path.abspath(file))
    scope = Path(os.path.abspath(scope))
    if not str(file).lower().startswith(str(scope).lower() + os.sep):
        fail('INPUT_SCOPE', 'Only fixed isolated source scope')
    for item in [file] + list(file.parents):
        value = os.lstat(item)
        if stat.S_ISLNK(value.st_mode) or os.path.normcase(os.path.realpath(item)) != os.path.normcase(str(item)):
            fail('ALIAS_REJECTED', str(item))
        if item == file and (not stat.S_ISREG(value.st_mode) or value.st_nlink != 1):
            fail('ORDINARY_FILE_REQUIRED', str(file))
    return file


def directory(value):
    value = Path(os.path.abspath(value))
    if value != RW and not str(value).lower().startswith(str(RW).lower() + os.sep):
        fail('OUTPUT_SCOPE', 'Only owned isolated output directory')
    for item in [value] + list(value.parents):
        state = os.lstat(item)
        if not stat.S_ISDIR(state.st_mode) or stat.S_ISLNK(state.st_mode) or os.path.normcase(os.path.realpath(item)) != os.path.normcase(str(item)):
            fail('OUTPUT_DIRECTORY_ALIAS', str(item))
    return value


def verify_read_states(before, after, reopened, length, label):
    # Compare fstat with fstat only. Windows Path-stat can report birthtime as
    # ctime, while handle fstat reports the actual change-time; ctime remains
    # part of the full identity/state check on all three live-handle samples.
    state = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns, s.st_nlink)
    if any(not stat.S_ISREG(s.st_mode) or s.st_nlink != 1 for s in [before, after, reopened]):
        fail('ORDINARY_FILE_REQUIRED', label)
    if state(before) != state(after) or state(before) != state(reopened) or length != before.st_size:
        fail('INPUT_CHANGED', label)


def read(file, limit=33554432, scope=RW):
    file = ordinary(file, scope)
    with open(file, 'rb') as handle:
        before = os.fstat(handle.fileno())
        if before.st_size > limit:
            fail('SIZE_BOUND', str(file))
        data = handle.read(limit + 1)
        after = os.fstat(handle.fileno())
        ordinary(file, scope)
        with open(file, 'rb') as current_handle:
            current = os.fstat(current_handle.fileno())
            ordinary(file, scope)
            verify_read_states(before, after, current, len(data), str(file))
    return data


def load_parser():
    code = read(PARSER, scope=ROOT / 'audit-tools')
    if sha(code) != PARSER_PIN:
        fail('PARSER_PIN', 'Reviewed data-only parser changed')
    module = types.ModuleType('xjy_fixed_data_asar')
    # Evaluate only held, hashed data-helper bytes; no import cache writes or __main__.
    exec(compile(code, str(PARSER), 'exec'), module.__dict__)
    return module


def validate_manifest(value):
    if not isinstance(value, dict) or set(value) != {'schemaVersion', 'purpose', 'files'} or value.get('schemaVersion') != 1 or value.get('purpose') != 'native170-app-asar-ten-overlay' or not isinstance(value.get('files'), list):
        fail('BAD_MANIFEST', 'Exact ten-member overlay schema required')
    seen = set()
    for row in value['files']:
        if not isinstance(row, dict) or set(row) != {'path', 'source', 'size', 'sha256'} or row.get('path') not in ALLOWED or row['path'] in seen or type(row.get('size')) is not int or row['size'] < 1 or not is_sha(row.get('sha256')) or not isinstance(row.get('source'), str):
            fail('BAD_MEMBER', 'Only exact ten reviewed member rows')
        seen.add(row['path'])
        resolved = os.path.abspath(row['source'])
        if not resolved.lower().startswith(str(RW).lower() + os.sep):
            fail('INPUT_SCOPE', 'Overlay outside release-work')
    if seen != ALLOWED:
        fail('TEN_REQUIRED', 'All four existing and six new members required')
    return value


def checked_parsed(helper, data, label):
    parsed = helper.parse_asar(data, label)
    ordered = helper.layout_ranges(parsed)
    helper.verify_shared_regions(parsed, ordered)
    previous_end = 0
    for member in ordered:
        if member['kind'] != 'file' or member['unpacked']:
            fail('PACKED_ONLY', 'Fixed app archive must contain packed ordinary files')
        if member['size'] and member['offset'] < previous_end:
            fail('SHARED_RANGE', member['path'])
        previous_end = max(previous_end, member['offset'] + member['size'])
        if member['integrity'] is not None:
            helper.validate_integrity(member['integrity'], helper.read_range(parsed, member), member['path'])
    if len(ordered) != len(parsed['members']):
        fail('PACKED_ONLY', 'Links or unpacked members rejected')
    return parsed, ordered


def verify_pair(helper, before, after, expected):
    old, _ = checked_parsed(helper, before, 'fixed c378')
    new, _ = checked_parsed(helper, after, 'new candidate')
    old_members = {m['path']: m for m in old['members']}
    new_members = {m['path']: m for m in new['members']}
    if len(old_members) != 143 or set(new_members) != set(old_members) | NEW or not OLD <= set(old_members) or NEW & set(old_members):
        fail('MEMBER_SET', 'Expected original143 plus exact six new members')
    old_entries = helper.entry_map(old['files_root'])
    new_entries = helper.entry_map(new['files_root'])
    changes = []
    for name in sorted(new_members):
        data = helper.read_range(new, new_members[name])
        if name in ALLOWED:
            row = expected[name]
            if len(data) != row['size'] or sha(data) != row['sha256']:
                fail('OVERLAY_BYTES', name)
            if name in OLD and helper.read_range(old, old_members[name]) == data:
                fail('UNCHANGED_APPROVED_MEMBER', name)
            if name == 'employee-update-cache.cjs':
                cache_export_only(helper.read_range(old, old_members[name]), data)
            changes.append({'path': name, 'size': len(data), 'sha256': sha(data), 'beforeSha256': sha(helper.read_range(old, old_members[name])) if name in OLD else None})
        else:
            if helper.read_range(old, old_members[name]) != data:
                fail('UNEXPECTED_MEMBER_BYTES', name)
            old_attrs = {k: v for k, v in old_entries[name].items() if k != 'offset'}
            new_attrs = {k: v for k, v in new_entries[name].items() if k != 'offset'}
            if old_attrs != new_attrs:
                fail('UNEXPECTED_MEMBER_METADATA', name)
        if name in OLD:
            allowed = {'size', 'offset', 'integrity'}
            old_attrs = {k: v for k, v in old_entries[name].items() if k not in allowed}
            new_attrs = {k: v for k, v in new_entries[name].items() if k not in allowed}
            if old_attrs != new_attrs:
                fail('CHANGED_MEMBER_FLAGS', name)
            old_integrity = old_entries[name].get('integrity')
            new_integrity = new_entries[name].get('integrity')
            if (old_integrity is None) != (new_integrity is None) or (old_integrity is not None and {k: v for k, v in old_integrity.items() if k not in {'hash', 'blocks'}} != {k: v for k, v in new_integrity.items() if k not in {'hash', 'blocks'}}):
                fail('CHANGED_INTEGRITY_POLICY', name)
        if name in NEW:
            entry = new_entries[name]
            if set(entry) != {'size', 'offset', 'integrity'} or type(entry['size']) is not int or not isinstance(entry['offset'], str) or not isinstance(entry['integrity'], dict) or set(entry['integrity']) != {'algorithm', 'hash', 'blockSize', 'blocks'} or entry['integrity']['algorithm'] != 'SHA256' or type(entry['integrity']['blockSize']) is not int or entry['integrity']['blockSize'] != 4194304:
                fail('NEW_MEMBER_METADATA', name)
    for name, entry in old_entries.items():
        if 'files' in entry and ({k: v for k, v in entry.items() if k != 'files'} != {k: v for k, v in new_entries[name].items() if k != 'files'}):
            fail('DIRECTORY_METADATA', name)
    if sha(helper.read_range(new, new_members[RENDERER])) != RENDERER_PIN:
        fail('RENDERER_PIN', 'Renderer870a must remain unchanged')
    return changes


def repack(helper, before, rows, replacements):
    parsed, ordered = checked_parsed(helper, before, 'fixed c378')
    header = copy.deepcopy(parsed['header'])
    entries = helper.entry_map(header['files'])
    if len(ordered) != 143 or not OLD <= set(entries) or NEW & set(entries):
        fail('PREIMAGE_MEMBERS', 'Fixed original143/four old/six absent')
    body, cursor, delta = [], 0, 0
    for member in ordered:
        name, offset, size = member['path'], member['offset'], member['size']
        body.append(before[parsed['data_start'] + cursor:parsed['data_start'] + offset])
        data = replacements.get(name, helper.read_range(parsed, member))
        entry = entries[name]
        entry['offset'] = str(offset + delta) if isinstance(entry['offset'], str) else offset + delta
        if name in OLD:
            entry['size'] = str(len(data)) if isinstance(entry['size'], str) else len(data)
            if entry.get('integrity') is not None:
                block_size = helper.validate_integrity(member['integrity'], helper.read_range(parsed, member), name)
                entry['integrity']['hash'] = sha(data)
                entry['integrity']['blocks'] = [sha(data[i:i + block_size]) for i in range(0, len(data), block_size)]
        body.append(data)
        cursor = offset + size
        delta += len(data) - size
    body.append(before[parsed['data_start'] + cursor:])
    offset = parsed['data_size'] + delta
    for name in sorted(NEW):
        data = replacements[name]
        block = 4194304
        header['files'][name] = {'size': len(data), 'offset': str(offset), 'integrity': {'algorithm': 'SHA256', 'hash': sha(data), 'blockSize': block, 'blocks': [sha(data[i:i + block]) for i in range(0, len(data), block)]}}
        body.append(data)
        offset += len(data)
    output = helper.serialize_header(header) + b''.join(body)
    changes = verify_pair(helper, before, output, rows)
    return output, changes


def create(file, data):
    directory(Path(file).parent)
    with open(file, 'xb') as handle:
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())
    if read(file) != data:
        fail('READBACK', str(file))


def main():
    args = argparse.ArgumentParser()
    args.add_argument('--overlay-manifest')
    args.add_argument('--sha256')
    args.add_argument('--verify-asar')
    args.add_argument('--asar-sha256')
    args.add_argument('--report')
    args.add_argument('--report-sha256')
    options = args.parse_args()
    if options.verify_asar:
        if options.overlay_manifest or options.sha256 or not all([options.asar_sha256, options.report, options.report_sha256]):
            fail('VERIFY_ARGUMENTS', 'Exact ASAR and report pins required, no repack flags')
        helper = load_parser()
        before, after = read(BASE), read(options.verify_asar)
        report_bytes = read(options.report, 4194304)
        if sha(before) != BASE_PIN or not is_sha(options.asar_sha256) or sha(after) != options.asar_sha256 or not is_sha(options.report_sha256) or sha(report_bytes) != options.report_sha256:
            fail('VERIFY_PIN', 'ASAR/report/preimage pin changed')
        report = helper.loads_strict(report_bytes.decode('utf8'), 'Root final report')
        if report.get('purpose') != 'native170-ten-app-member-asar-verification' or report.get('sourceAsarSha256') != BASE_PIN or report.get('programExecuted') is not False or report.get('installed') is not False or report.get('output', {}).get('sha256') != options.asar_sha256 or report['output'].get('size') != len(after):
            fail('VERIFY_REPORT', 'Expected exact unsigned ASAR verification report')
        rows = report.get('changes')
        if not isinstance(rows, list) or len(rows) != 10 or {row.get('path') for row in rows} != ALLOWED:
            fail('VERIFY_REPORT', 'Exact ten change rows required')
        changes = verify_pair(helper, before, after, {row['path']: row for row in rows})
        print(json.dumps({'verified': True, 'sourceAsarSha256': BASE_PIN, 'asarSha256': sha(after), 'reportSha256': sha(report_bytes), 'changedMembers': [row['path'] for row in changes], 'originalMembers': 143, 'finalMembers': 149, 'rendererSha256': RENDERER_PIN, 'programExecuted': False, 'outputWritten': False}))
        return
    if not options.overlay_manifest or not options.sha256 or options.asar_sha256 or options.report or options.report_sha256:
        fail('REPACK_ARGUMENTS', 'Exact overlay manifest and pin required')
    raw = read(options.overlay_manifest, 4194304)
    if not is_sha(options.sha256) or sha(raw) != options.sha256:
        fail('OVERLAY_MANIFEST_PIN', 'Root exact overlay manifest SHA required')
    helper = load_parser()
    value = validate_manifest(helper.loads_strict(raw.decode('utf8'), 'Root overlay'))
    before = read(BASE)
    if sha(before) != BASE_PIN:
        fail('BASE_PIN', 'c378 preimage changed')
    replacements, rows = {}, {}
    for row in value['files']:
        data = read(row['source'])
        if len(data) != row['size'] or sha(data) != row['sha256']:
            fail('OVERLAY_PIN', row['path'])
        replacements[row['path']] = data
        rows[row['path']] = row
    output, changes = repack(helper, before, rows, replacements)
    # Do all semantic validation before claiming the CreateNew output directory.
    directory(RW)
    if OUT.parent.exists():
        directory(OUT.parent)
    OUT.parent.mkdir(exist_ok=True)
    directory(OUT.parent)
    OUT.mkdir(exist_ok=False)
    directory(OUT)
    create(OUT / 'app.asar', output)
    verify_pair(helper, before, read(OUT / 'app.asar'), rows)
    report = {'schemaVersion': 1, 'purpose': 'native170-ten-app-member-asar-verification', 'unsigned': True, 'installed': False, 'programExecuted': False, 'sourceAsarSha256': BASE_PIN, 'overlayManifestSha256': options.sha256, 'parserSha256': PARSER_PIN, 'output': {'source': str(OUT / 'app.asar'), 'size': len(output), 'sha256': sha(output)}, 'changes': changes, 'originalMembers': 143, 'newMembers': 149, 'unchangedOriginalMembers': 139, 'rendererSha256': RENDERER_PIN, 'metadataPolicy': 'Unchanged entries exact except physical offset; changed existing entries only size/offset/integrity hash+blocks; original flags and integrity policy preserved', 'integrityValidated': True, 'layoutValidated': True, 'independentReadbackCompared': True}
    create(OUT / 'report.json', (json.dumps(report, ensure_ascii=False, indent=2) + '\n').encode('utf8'))
    print(json.dumps({'outputAsarSha256': sha(output), 'reportSha256': sha(read(OUT / 'report.json')), 'installed': False, 'programExecuted': False}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
