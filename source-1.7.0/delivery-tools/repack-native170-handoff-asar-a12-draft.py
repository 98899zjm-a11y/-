#!/usr/bin/env python3
"""SOURCE DRAFT. One existing ASAR member only; no APP import/execution."""
import copy
import hashlib
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
RENDERER = 'renderer-dist/assets/main-7etXIfP0.js'
RENDERER_SHA = 'c08a94f2a32ef935c492f86b582da8f7cda364dac61ac1277406d51185285282'
FROZEN = ROOT / 'delivery-tools/repack-native170-warranty-asar-a10.py'
FROZEN_SHA = 'fd63f0196e913eaddf8af18cd529f3cdee2a93f4ae4cae64da49ee0fa238b093'


def draft_only():
    raise ValueError('A12_DRAFT_UNBOUND: reviewed:false; no CLI/repack/verify mode yet; handoff/source/ASAR/report pins unbound')


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


if __name__ == '__main__':
    # Deliberately before argparse, input reads, helper load or CreateNew output.
    try:
        draft_only()
    except ValueError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
