#!/usr/bin/env python3
"""Pure-data warranty3 overlay on frozen application10. No APP execution/signing."""
import argparse
import copy
import json
from pathlib import Path
import sys
import types

ROOT = Path('E:/codex/2026-10-15/work/xjy-v16-deep-audit')
RW = ROOT / 'release-work'
OUT = RW / 'native170-package-closure-a10/final-asar'
DATA_TOOL = ROOT / 'delivery-tools/repack-native170-app-asar-a7.py'
DATA_TOOL_PIN = '8b01b5f361e041c3c048c269af88f489e8755647e88055fd6cdf16123be1654e'
APP = RW / 'native170-package-closure-a7/final-asar/app.asar'
APP_PIN = 'f71429a04c51cbca1f66e991dc0d8637738d63647fa3a79532e02f798c4082b4'
APP_REPORT = RW / 'native170-package-closure-a7/final-asar/report.json'
APP_REPORT_PIN = '26feadef0b10959b2a37a9840a1fcd633558c51f19321cc1aa4eb119bd7e8e37'
PATCH = Path('E:/软件制作/鑫金源质保单仅去背景-20261020/待整合补丁')
PATCH_PIN = '31c72555da33168a69f30dd8d846c4951d32da2db4882355d03d13764c19e843'
RENDERER = 'renderer-dist/assets/main-7etXIfP0.js'
RENDERER_AFTER = 'c08a94f2a32ef935c492f86b582da8f7cda364dac61ac1277406d51185285282'
UPGRADE_ENTRY_TAIL_BYTES = 839479  # Frozen870a:1542584 minus original renderer prefix703105.
WARRANTY = {
    'renderer-dist/assets/warranty-document-CcBHseIj.js': ('7027f13242a13bd94d0aa92ef5e0d92d7b22bfa6314d39ed486c7ed2b939973f', '1583d49ffb53494a8dc67b0614d44398877c81715e695c9bd5421d59187ea536', 117905),
    RENDERER: ('870a724e04c030ec2bf3e3050b4adcf227c076cfc660a7e3d2421ba7b0db1ef7', RENDERER_AFTER, 1542620),
    'warranty-docx.cjs': ('547af5547000c5473ca1036fbb3758de14a747063876ea3c5f5bcb23433e1320', '74ddb6bf8fb32f13c86ade745b6a3faf736d137be267ef706d0c0b43640bad95', 13461),
}


def load_data_tool():
    # Hold/hash exact reviewed pure-data source, never import/execute APP members.
    import hashlib
    import os
    import stat
    file = str(DATA_TOOL)
    for item in [DATA_TOOL] + list(DATA_TOOL.parents):
        item_state = os.lstat(item)
        if stat.S_ISLNK(item_state.st_mode) or os.path.normcase(os.path.realpath(item)) != os.path.normcase(str(item)):
            raise ValueError('DATA_TOOL_ALIAS: Fixed ordinary data helper required')
        if item == DATA_TOOL and (not stat.S_ISREG(item_state.st_mode) or item_state.st_nlink != 1):
            raise ValueError('DATA_TOOL_KIND: Ordinary single-link data helper required')
    with open(file, 'rb') as handle:
        before = os.fstat(handle.fileno())
        code = handle.read(1048577)
        after = os.fstat(handle.fileno())
        with open(file, 'rb') as reopened:
            current = os.fstat(reopened.fileno())
    fields = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns, s.st_nlink)
    if len(code) > 1048576 or fields(before) != fields(after) or fields(before) != fields(current) or before.st_nlink != 1 or hashlib.sha256(code).hexdigest() != DATA_TOOL_PIN:
        raise ValueError('DATA_TOOL_PIN: Frozen data helper changed')
    module = types.ModuleType('frozen_a7_asar_data')
    exec(compile(code, file, 'exec'), module.__dict__)
    module.ordinary(DATA_TOOL, scope=ROOT / 'delivery-tools')
    return module


def validate_warranty_manifest(value):
    if not isinstance(value, dict) or not isinstance(value.get('members'), list) or len(value['members']) != 3 or value.get('productionInstalled') is not False or value.get('signed') is not False:
        raise ValueError('WARRANTY_MANIFEST: Exact unsigned three-member patch required')
    seen = set()
    for row in value['members']:
        if not isinstance(row, dict) or set(row) != {'member', 'beforeSha256', 'afterSha256', 'bytes'} or row['member'] in seen or row['member'] not in WARRANTY:
            raise ValueError('WARRANTY_MEMBER: Unknown/duplicate warranty member')
        seen.add(row['member'])
        if (row['beforeSha256'], row['afterSha256'], row['bytes']) != WARRANTY[row['member']]:
            raise ValueError('WARRANTY_PIN: Warranty before/after/size must match handoff')
    if seen != set(WARRANTY):
        raise ValueError('WARRANTY_MEMBER: All three fixed members required')
    return value


def baseline(data):
    helper = data.load_parser()
    c378 = data.read(data.BASE)
    app = data.read(APP)
    report_bytes = data.read(APP_REPORT, 4194304)
    if data.sha(c378) != data.BASE_PIN or data.sha(app) != APP_PIN or data.sha(report_bytes) != APP_REPORT_PIN:
        raise ValueError('APP_PREIMAGE_PIN: Frozen application10 or c378 changed')
    report = helper.loads_strict(report_bytes.decode('utf8'), 'frozen application10 report')
    data.verify_pair(helper, c378, app, {row['path']: row for row in report['changes']})
    return helper, c378, app


def verify_warranty_only(data, helper, before, after):
    old, _ = data.checked_parsed(helper, before, 'f714 application preimage')
    new, _ = data.checked_parsed(helper, after, 'warranty candidate')
    old_members = {m['path']: m for m in old['members']}
    new_members = {m['path']: m for m in new['members']}
    if len(old_members) != 149 or set(old_members) != set(new_members):
        raise ValueError('WARRANTY_SET: Same149 existing application members required')
    old_entries, new_entries = helper.entry_map(old['files_root']), helper.entry_map(new['files_root'])
    for name, member in old_members.items():
        previous = helper.read_range(old, member)
        current = helper.read_range(new, new_members[name])
        if name in WARRANTY:
            before_pin, after_pin, size = WARRANTY[name]
            if data.sha(previous) != before_pin or data.sha(current) != after_pin or len(current) != size:
                raise ValueError('WARRANTY_BYTES: ' + name)
            if name == RENDERER and previous[-UPGRADE_ENTRY_TAIL_BYTES:] != current[-UPGRADE_ENTRY_TAIL_BYTES:]:
                raise ValueError('UPGRADE_ENTRY_TAIL: Existing upgrade entry must remain byte-identical')
            skip = {'offset', 'size', 'integrity'}
            if {k: v for k, v in old_entries[name].items() if k not in skip} != {k: v for k, v in new_entries[name].items() if k not in skip}:
                raise ValueError('WARRANTY_FLAGS: ' + name)
            old_integrity, new_integrity = old_entries[name].get('integrity'), new_entries[name].get('integrity')
            if (old_integrity is None) != (new_integrity is None) or (old_integrity is not None and {k: v for k, v in old_integrity.items() if k not in {'hash', 'blocks'}} != {k: v for k, v in new_integrity.items() if k not in {'hash', 'blocks'}}):
                raise ValueError('WARRANTY_INTEGRITY_POLICY: ' + name)
        elif previous != current or {k: v for k, v in old_entries[name].items() if k != 'offset'} != {k: v for k, v in new_entries[name].items() if k != 'offset'}:
            raise ValueError('NON_WARRANTY_CHANGED: ' + name)
    for name, entry in old_entries.items():
        if 'files' in entry and {k: v for k, v in entry.items() if k != 'files'} != {k: v for k, v in new_entries[name].items() if k != 'files'}:
            raise ValueError('DIRECTORY_METADATA: ' + name)


def changes_from_c378(data, helper, c378, after):
    before, _ = data.checked_parsed(helper, c378, 'c378')
    final, _ = data.checked_parsed(helper, after, 'final')
    original = {m['path']: m for m in before['members']}
    final_members = {m['path']: m for m in final['members']}
    changes = []
    for name, member in final_members.items():
        current = helper.read_range(final, member)
        previous = helper.read_range(before, original[name]) if name in original else None
        if previous != current:
            changes.append({'path': name, 'size': len(current), 'sha256': data.sha(current), 'beforeSha256': data.sha(previous) if previous is not None else None})
    if len(changes) != 13 or {row['path'] for row in changes} != data.ALLOWED | set(WARRANTY):
        raise ValueError('THIRTEEN_REQUIRED: Original10 plus exact warranty3 required')
    return sorted(changes, key=lambda row: row['path'])


def repack(data, helper, app, replacements):
    parsed, ordered = data.checked_parsed(helper, app, 'f714')
    header = copy.deepcopy(parsed['header'])
    entries = helper.entry_map(header['files'])
    parts, cursor, delta = [], 0, 0
    for member in ordered:
        name, offset, size = member['path'], member['offset'], member['size']
        parts.append(app[parsed['data_start'] + cursor:parsed['data_start'] + offset])
        content = replacements.get(name, helper.read_range(parsed, member))
        entry = entries[name]
        entry['offset'] = str(offset + delta) if isinstance(entry['offset'], str) else offset + delta
        if name in WARRANTY:
            if data.sha(helper.read_range(parsed, member)) != WARRANTY[name][0]:
                raise ValueError('WARRANTY_BEFORE_PIN: ' + name)
            entry['size'] = str(len(content)) if isinstance(entry['size'], str) else len(content)
            if entry.get('integrity') is not None:
                block = helper.validate_integrity(member['integrity'], helper.read_range(parsed, member), name)
                entry['integrity']['hash'] = data.sha(content)
                entry['integrity']['blocks'] = [data.sha(content[i:i + block]) for i in range(0, len(content), block)]
        parts.append(content)
        cursor = offset + size
        delta += len(content) - size
    parts.append(app[parsed['data_start'] + cursor:])
    output = helper.serialize_header(header) + b''.join(parts)
    verify_warranty_only(data, helper, app, output)
    return output


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--warranty-manifest-sha256')
    parser.add_argument('--verify-asar')
    parser.add_argument('--asar-sha256')
    parser.add_argument('--report')
    parser.add_argument('--report-sha256')
    args = parser.parse_args()
    data = load_data_tool()
    helper, c378, app = baseline(data)
    if args.verify_asar:
        if args.warranty_manifest_sha256 or not all([args.asar_sha256, args.report, args.report_sha256]):
            raise ValueError('VERIFY_ARGUMENTS: Exact final ASAR/report pins required')
        after, raw = data.read(args.verify_asar), data.read(args.report, 4194304)
        if data.sha(after) != args.asar_sha256 or data.sha(raw) != args.report_sha256:
            raise ValueError('FINAL_PIN: Final ASAR/report changed')
        report = helper.loads_strict(raw.decode('utf8'), 'a10 report')
        if report.get('purpose') != 'native170-thirteen-app-member-asar-verification' or report.get('sourceAsarSha256') != data.BASE_PIN or report.get('warrantyPreimageAsarSha256') != APP_PIN or report.get('programExecuted') is not False or report.get('installed') is not False:
            raise ValueError('REPORT_CONTRACT: Exact a10 verification report required')
        verify_warranty_only(data, helper, app, after)
        changes = changes_from_c378(data, helper, c378, after)
        if report.get('changes') != changes or report.get('output', {}).get('sha256') != data.sha(after) or report['output'].get('size') != len(after):
            raise ValueError('REPORT_ROWS: Actual final rows differ')
        print(json.dumps({'verified': True, 'sourceAsarSha256': data.BASE_PIN, 'asarSha256': data.sha(after), 'reportSha256': data.sha(raw), 'changedMembers': [r['path'] for r in changes], 'originalMembers': 143, 'finalMembers': 149, 'rendererSha256': RENDERER_AFTER, 'programExecuted': False, 'outputWritten': False}))
        return
    if args.warranty_manifest_sha256 != PATCH_PIN or args.asar_sha256 or args.report or args.report_sha256:
        raise ValueError('WARRANTY_APPROVAL_PIN: Explicit exact supplied warranty manifest pin required')
    raw = data.read(PATCH / 'overlay-manifest.json', 4194304, scope=PATCH)
    if data.sha(raw) != PATCH_PIN:
        raise ValueError('WARRANTY_MANIFEST_PIN: Handoff manifest changed')
    value = validate_warranty_manifest(helper.loads_strict(raw.decode('utf8'), 'warranty handoff'))
    replacements = {}
    for row in value['members']:
        content = data.read(PATCH / row['member'], scope=PATCH)
        if data.sha(content) != row['afterSha256'] or len(content) != row['bytes']:
            raise ValueError('WARRANTY_AFTER_PIN: ' + row['member'])
        replacements[row['member']] = content
    output = repack(data, helper, app, replacements)
    changes = changes_from_c378(data, helper, c378, output)
    data.directory(RW)
    if OUT.parent.exists():
        data.directory(OUT.parent)
    OUT.parent.mkdir(exist_ok=True)
    data.directory(OUT.parent)
    OUT.mkdir(exist_ok=False)
    data.create(OUT / 'app.asar', output)
    verify_warranty_only(data, helper, app, data.read(OUT / 'app.asar'))
    report = {'schemaVersion': 1, 'purpose': 'native170-thirteen-app-member-asar-verification', 'unsigned': True, 'installed': False, 'programExecuted': False, 'sourceAsarSha256': data.BASE_PIN, 'warrantyPreimageAsarSha256': APP_PIN, 'application10ReportSha256': APP_REPORT_PIN, 'warrantyManifestSha256': PATCH_PIN, 'output': {'source': str(OUT / 'app.asar'), 'size': len(output), 'sha256': data.sha(output)}, 'changes': changes, 'originalMembers': 143, 'newMembers': 149, 'unchangedOriginalMembers': 136, 'rendererSha256': RENDERER_AFTER, 'originalUpgradeEntryTailByteIdentical': True, 'warrantyScope': 'background-only; all template text/coordinates unchanged', 'warrantyIndependentDeepseekReview': 'waived by user for this warranty change only', 'integrityValidated': True, 'layoutValidated': True, 'independentReadbackCompared': True}
    data.create(OUT / 'report.json', (json.dumps(report, ensure_ascii=False, indent=2) + '\n').encode('utf8'))
    print(json.dumps({'outputAsarSha256': data.sha(output), 'reportSha256': data.sha(data.read(OUT / 'report.json')), 'installed': False, 'programExecuted': False}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
