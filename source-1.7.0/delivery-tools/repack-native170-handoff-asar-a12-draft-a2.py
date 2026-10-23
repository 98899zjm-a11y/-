#!/usr/bin/env python3
"""SOURCE DRAFT. One existing ASAR member only; no APP import/execution."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import sys
import types

ROOT = Path('E:/codex/2026-10-15/work/xjy-v16-deep-audit')
RW = ROOT / 'release-work'
BASE = RW / 'native170-package-closure-a11-r2-candidate/proposal/fresh-material-draft/resources/app.asar'
BASE_SHA = '273b1e98d3afd1cc1a86421657468d02f4a95c557b2574b9daf1bb088742d66b'
MEMBER = 'native-update-handoff.cjs'
BEFORE_SHA = '83e881253142cffa4bed77516154fb9b1d53d39a05f867ef1df7fd50471b21b4'
BEFORE_SIZE = 7166
AFTER_SHA = 'UNBOUND'
AFTER_SIZE = None
AFTER_SOURCE = 'UNBOUND'
HANDOFF_MANIFEST_SHA = 'UNBOUND'
OUT = RW / 'native170-package-closure-a12-candidate-a2/final-asar'
MANIFEST = OUT.parent / 'reviewed-handoff-inputs-ROOT.json'
RENDERER = 'renderer-dist/assets/main-7etXIfP0.js'
RENDERER_SHA = 'c08a94f2a32ef935c492f86b582da8f7cda364dac61ac1277406d51185285282'
FROZEN = ROOT / 'delivery-tools/repack-native170-warranty-asar-a10.py'
FROZEN_SHA = 'fd63f0196e913eaddf8af18cd529f3cdee2a93f4ae4cae64da49ee0fa238b093'


def bindings_ready():
    valid = lambda value: isinstance(value, str) and len(value) == 64 and all(c in '0123456789abcdef' for c in value)
    if not valid(AFTER_SHA) or not valid(HANDOFF_MANIFEST_SHA) or type(AFTER_SIZE) is not int or AFTER_SIZE < 1 or AFTER_SIZE > 1048576 or AFTER_SOURCE == 'UNBOUND':
        raise ValueError('A12_DRAFT_UNBOUND: handoff pins remain unknown; no input reads or output writes allowed')


def member_scope(before, after):
    """Pure149-member content-row scope, used by real verifier and metadata tests."""
    if len(before) != 149 or len(after) != 149:
        raise ValueError('SAME149_REQUIRED')
    a, b = {r['path']: r for r in before}, {r['path']: r for r in after}
    if len(a) != 149 or len(b) != 149 or set(a) != set(b):
        raise ValueError('SAME149_REQUIRED')
    if [name for name in sorted(a) if a[name] != b[name]] != [MEMBER]:
        raise ValueError('ONLY_HANDOFF_MEMBER_CHANGED')


def load_frozen_data():
    # Future only: reuse pinned pure-data parser chain. Never load APP members.
    # Read/identity rules are the frozen a7 loader rules, including same-API
    # held/reopened fstat comparisons rather than Path.stat/fstat ctime mixing.
    import os
    import stat
    for file in [FROZEN] + list(FROZEN.parents):
        s = os.lstat(file)
        if stat.S_ISLNK(s.st_mode) or os.path.normcase(os.path.realpath(file)) != os.path.normcase(str(file)):
            raise ValueError('FROZEN_HELPER_ALIAS')
    with open(str(FROZEN), 'rb') as held:
        before = os.fstat(held.fileno())
        source = held.read(1048577)
        after = os.fstat(held.fileno())
        with open(str(FROZEN), 'rb') as reopened:
            live = os.fstat(reopened.fileno())
    fields = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns, s.st_nlink)
    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or len(source) > 1048576 or fields(before) != fields(after) or fields(before) != fields(live) or hashlib.sha256(source).hexdigest() != FROZEN_SHA:
        raise ValueError('FROZEN_HELPER_CHANGED')
    module = types.ModuleType('frozen_warranty_data_only')
    exec(compile(source, str(FROZEN), 'exec'), module.__dict__)
    data = module.load_data_tool()
    return data, data.load_parser()


def verified_pair(data, helper, before, after):
    if data.sha(before) != BASE_SHA:
        raise ValueError('A11_ASAR_BASE_CHANGED')
    old, _ = data.checked_parsed(helper, before, 'a11 frozen149')
    new, _ = data.checked_parsed(helper, after, 'a12 handoff149')
    a = {m['path']: m for m in old['members']}
    b = {m['path']: m for m in new['members']}
    if len(a) != 149 or set(a) != set(b):
        raise ValueError('SAME149_REQUIRED')
    ae, be = helper.entry_map(old['files_root']), helper.entry_map(new['files_root'])
    if set(ae) != set(be) or {k: v for k, v in old['header'].items() if k != 'files'} != {k: v for k, v in new['header'].items() if k != 'files'}:
        raise ValueError('DIRECTORY_OR_HEADER_MEMBER_SET_CHANGED')
    member_scope(
        [{'path': name, 'size': a[name]['size'], 'sha256': data.sha(helper.read_range(old, a[name]))} for name in a],
        [{'path': name, 'size': b[name]['size'], 'sha256': data.sha(helper.read_range(new, b[name]))} for name in b],
    )
    for name in a:
        previous, current = helper.read_range(old, a[name]), helper.read_range(new, b[name])
        skip = {'offset'}
        if name == MEMBER:
            if data.sha(previous) != BEFORE_SHA or len(previous) != BEFORE_SIZE or data.sha(current) != AFTER_SHA or len(current) != AFTER_SIZE or previous == current:
                raise ValueError('EXACT_HANDOFF_PINS_REQUIRED')
            skip |= {'size', 'integrity'}
            x, y = ae[name].get('integrity'), be[name].get('integrity')
            if (x is None) != (y is None) or (x is not None and {k: v for k, v in x.items() if k not in {'hash', 'blocks'}} != {k: v for k, v in y.items() if k not in {'hash', 'blocks'}}):
                raise ValueError('HANDOFF_INTEGRITY_POLICY_CHANGED')
        elif previous != current:
            raise ValueError('UNCHANGED148_BYTES_REQUIRED: ' + name)
        if {k: v for k, v in ae[name].items() if k not in skip} != {k: v for k, v in be[name].items() if k not in skip}:
            raise ValueError('MEMBER_METADATA_CHANGED: ' + name)
    for name, entry in ae.items():
        if 'files' in entry and {k: v for k, v in entry.items() if k != 'files'} != {k: v for k, v in be[name].items() if k != 'files'}:
            raise ValueError('DIRECTORY_METADATA_CHANGED')
    if data.sha(helper.read_range(new, b[RENDERER])) != RENDERER_SHA:
        raise ValueError('RENDERER_CHANGED')
    return {'verified': True, 'originalMembers': 149, 'finalMembers': 149, 'changedMembers': [MEMBER], 'preservedMembers': 148, 'sourceAsarSha256': BASE_SHA, 'asarSha256': data.sha(after), 'programExecuted': False}


def repack_one(data, helper, before, replacement):
    # Pure in-memory algorithm, inherited from the verified warranty repacker.
    if data.sha(before) != BASE_SHA or data.sha(replacement) != AFTER_SHA or len(replacement) != AFTER_SIZE:
        raise ValueError('A12_HANDOFF_UNBOUND_OR_CHANGED')
    parsed, ordered = data.checked_parsed(helper, before, 'a11 handoff preimage')
    header = copy.deepcopy(parsed['header'])
    entries = helper.entry_map(header['files'])
    parts, cursor, delta = [], 0, 0
    for member in ordered:
        name, offset, size = member['path'], member['offset'], member['size']
        parts.append(before[parsed['data_start'] + cursor:parsed['data_start'] + offset])
        content = replacement if name == MEMBER else helper.read_range(parsed, member)
        entry = entries[name]
        entry['offset'] = str(offset + delta) if isinstance(entry['offset'], str) else offset + delta
        if name == MEMBER:
            if data.sha(helper.read_range(parsed, member)) != BEFORE_SHA or size != BEFORE_SIZE:
                raise ValueError('HANDOFF_BEFORE_CHANGED')
            entry['size'] = str(len(content)) if isinstance(entry['size'], str) else len(content)
            if entry.get('integrity') is not None:
                block = helper.validate_integrity(member['integrity'], helper.read_range(parsed, member), name)
                entry['integrity']['hash'] = data.sha(content)
                entry['integrity']['blocks'] = [data.sha(content[i:i + block]) for i in range(0, len(content), block)]
        parts.append(content)
        cursor = offset + size
        delta += len(content) - size
    parts.append(before[parsed['data_start'] + cursor:])
    output = helper.serialize_header(header) + b''.join(parts)
    verified_pair(data, helper, before, output)
    return output


def write_new(data, file, content):
    if file.parent != OUT or file.name not in {'app.asar', 'report.json'}:
        raise ValueError('FIXED_OUTPUT_FILE_REQUIRED')
    data.directory(file.parent)
    with open(str(file), 'xb') as handle:
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())
    if data.read(file, max(len(content), 1)) != content:
        raise ValueError('OUTPUT_READBACK_CHANGED')


def cli(argv=None):
    parser = argparse.ArgumentParser(description='Pure-data one-handoff ASAR repack/verification; UNBOUND source refuses')
    parser.add_argument('--handoff-manifest-sha256')
    parser.add_argument('--verify-asar')
    parser.add_argument('--asar-sha256')
    parser.add_argument('--report')
    parser.add_argument('--report-sha256')
    args = parser.parse_args(argv)
    if args.verify_asar:
        if args.handoff_manifest_sha256 or not all([args.asar_sha256, args.report, args.report_sha256]):
            parser.error('verify requires exact ASAR/report and both SHA pins')
    elif not args.handoff_manifest_sha256 or any([args.asar_sha256, args.report, args.report_sha256]):
        parser.error('repack requires only --handoff-manifest-sha256')
    # Parse/help is available, but all data operations refuse before helper/input
    # reads until Root freezes the actual handoff in a NEW source revision.
    bindings_ready()
    data, helper = load_frozen_data()
    before = data.read(BASE)
    if data.sha(before) != BASE_SHA:
        raise ValueError('A11_ASAR_BASE_CHANGED')
    if args.verify_asar:
        asar, report_file = Path(args.verify_asar), Path(args.report)
        data.ordinary(asar, scope=OUT)
        data.ordinary(report_file, scope=OUT)
        after, report_raw = data.read(asar), data.read(report_file, 4194304)
        if data.sha(after) != args.asar_sha256 or data.sha(report_raw) != args.report_sha256:
            raise ValueError('ASAR_OR_REPORT_SHA_CHANGED')
        report = helper.loads_strict(report_raw.decode('utf8'), 'a12 report')
        proof = verified_pair(data, helper, before, after)
        expected = {'schemaVersion', 'purpose', 'sourceAsarSha256', 'member', 'beforeSha256', 'afterSha256', 'afterSize', 'output', 'proof', 'programExecuted', 'signed'}
        if not isinstance(report, dict) or set(report) != expected or report['schemaVersion'] != 1 or report['purpose'] != 'native170-one-handoff-asar-verification' or report['sourceAsarSha256'] != BASE_SHA or report['member'] != MEMBER or report['beforeSha256'] != BEFORE_SHA or report['afterSha256'] != AFTER_SHA or report['afterSize'] != AFTER_SIZE or report['proof'] != proof or report['programExecuted'] is not False or report['signed'] is not False:
            raise ValueError('REPORT_CONTRACT_CHANGED')
        if report['output'] != {'source': str(asar), 'size': len(after), 'sha256': args.asar_sha256}:
            raise ValueError('REPORT_OUTPUT_CHANGED')
        print(json.dumps({**proof, 'reportSha256': args.report_sha256, 'outputWritten': False}, sort_keys=True))
        return
    if args.handoff_manifest_sha256 != HANDOFF_MANIFEST_SHA:
        raise ValueError('HANDOFF_MANIFEST_SHA_REQUIRED')
    raw = data.read(MANIFEST, 4194304)
    if data.sha(raw) != HANDOFF_MANIFEST_SHA:
        raise ValueError('HANDOFF_MANIFEST_CHANGED')
    manifest = helper.loads_strict(raw.decode('utf8'), 'reviewed a12 handoff')
    expected = {'schemaVersion', 'purpose', 'reviewed', 'member', 'source', 'size', 'sha256', 'beforeSha256'}
    if not isinstance(manifest, dict) or set(manifest) != expected or manifest['schemaVersion'] != 1 or manifest['purpose'] != 'native170-reviewed-single-handoff' or manifest['reviewed'] is not True or manifest['member'] != MEMBER or manifest['source'] != AFTER_SOURCE or manifest['size'] != AFTER_SIZE or manifest['sha256'] != AFTER_SHA or manifest['beforeSha256'] != BEFORE_SHA:
        raise ValueError('HANDOFF_REVIEWED_INPUT_REQUIRED')
    replacement = data.read(Path(AFTER_SOURCE), 1048576)
    after = repack_one(data, helper, before, replacement)
    proof = verified_pair(data, helper, before, after)
    if OUT.exists():
        raise ValueError('CREATENEW_OUTPUT_REQUIRED')
    data.directory(OUT.parent)
    OUT.mkdir()
    asar, report_file = OUT / 'app.asar', OUT / 'report.json'
    report = {'schemaVersion': 1, 'purpose': 'native170-one-handoff-asar-verification', 'sourceAsarSha256': BASE_SHA, 'member': MEMBER, 'beforeSha256': BEFORE_SHA, 'afterSha256': AFTER_SHA, 'afterSize': AFTER_SIZE, 'output': {'source': str(asar), 'size': len(after), 'sha256': data.sha(after)}, 'proof': proof, 'programExecuted': False, 'signed': False}
    report_raw = (json.dumps(report, ensure_ascii=False, indent=2) + '\n').encode('utf8')
    write_new(data, asar, after)
    write_new(data, report_file, report_raw)
    print(json.dumps({**proof, 'reportSha256': data.sha(report_raw), 'outputWritten': True}, sort_keys=True))


if __name__ == '__main__':
    try:
        cli()
    except (ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
