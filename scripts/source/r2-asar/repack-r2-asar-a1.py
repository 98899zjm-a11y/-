#!/usr/bin/env python3
"""DeepSeek r2 ASAR repack/verify (two members changed, pure data, no APP execution).

Builds the 1.7.0-r2 asar from the pinned a11 base asar by replacing:
  member 1: native-update-handoff.cjs      (already shipped in 1.7.0: d017 asar)
  member 2: native-publication-update.cjs  (r2: version-agnostic client)
and emits a proof JSON. Verification mode re-checks a produced asar against the
same pins and byte-compares every preserved member.
"""
import argparse
import copy
import hashlib
import json
import os
import stat
import struct
import sys
import types
from pathlib import Path

ROOT = Path('E:/codex/2026-10-15/work/xjy-v16-deep-audit')
RW = ROOT / 'release-work'
BASE = RW / 'native170-package-closure-a11-r2-candidate/proposal/fresh-material-draft/resources/app.asar'
BASE_SHA = '273b1e98d3afd1cc1a86421657468d02f4a95c557b2574b9daf1bb088742d66b'

M1 = 'native-update-handoff.cjs'
M1_BEFORE_SHA = '83e881253142cffa4bed77516154fb9b1d53d39a05f867ef1df7fd50471b21b4'
M1_BEFORE_SIZE = 7166
M1_AFTER_SHA = '2d972ed47f0e58601a9a91a958fdb596ee5f9be754e5df55081a98f9de21a42d'
M1_AFTER_SIZE = 15475
M1_AFTER_SOURCE = RW / 'native170-handoff-a12-a9/project/desktop/native-update-handoff.cjs'

M2 = 'native-publication-update.cjs'
M2_BEFORE_SHA = 'da751ddac6de7cdc7a8c85b0166f35a7e6aa4fbd1192ff0e50565b5600e93174'
M2_BEFORE_SIZE = 14347
M2_AFTER_SHA = 'a9e05a50398cbdf64cbd19498873b35d3f07e2e3830dff73be7780146250eaf6'
M2_AFTER_SIZE = 15666
M2_AFTER_SOURCE = RW / 'deepseek-r2-a1/native-publication-update.cjs'

RENDERER = 'renderer-dist/assets/main-7etXIfP0.js'
RENDERER_SHA = 'c08a94f2a32ef935c492f86b582da8f7cda364dac61ac1277406d51185285282'
FROZEN = ROOT / 'delivery-tools/repack-native170-warranty-asar-a10.py'
FROZEN_SHA = 'fd63f0196e913eaddf8af18cd529f3cdee2a93f4ae4cae64da49ee0fa238b093'


def load_frozen_data():
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


def repack(data, helper, before, replace1, replace2):
    if data.sha(before) != BASE_SHA:
        raise ValueError('A11_ASAR_BASE_CHANGED')
    parsed, ordered = data.checked_parsed(helper, before, 'a11 base 149')
    header = copy.deepcopy(parsed['header'])
    entries = helper.entry_map(header['files'])
    chunks = []
    for member in ordered:
        name = member['path']
        if name == M1:
            content, pin_sha, pin_size = replace1, M1_BEFORE_SHA, M1_BEFORE_SIZE
        elif name == M2:
            content, pin_sha, pin_size = replace2, M2_BEFORE_SHA, M2_BEFORE_SIZE
        else:
            content, pin_sha, pin_size = None, None, None
        current = helper.read_range(parsed, member)
        if content is None:
            chunks.append((name, current, False))
        else:
            if data.sha(current) != pin_sha or len(current) != pin_size:
                raise ValueError('BEFORE_PIN_CHANGED: ' + name)
            entry = entries[name]
            if entry.get('integrity') is not None:
                helper.validate_integrity(member['integrity'], current, name)
                block = int(entry['integrity'].get('blockSize') or 4194304)
                entry['integrity']['hash'] = data.sha(content)
                entry['integrity']['blocks'] = [data.sha(content[i:i + block]) for i in range(0, len(content), block)]
            chunks.append((name, content, True))
    offset = 0
    for name, content, changed in chunks:
        entry = entries[name]
        entry['offset'] = str(offset) if isinstance(entry.get('offset'), str) else offset
        entry['size'] = str(len(content)) if isinstance(entry.get('size'), str) else len(content)
        offset += len(content)
    header_bytes = json.dumps(header, ensure_ascii=False, separators=(',', ':')).encode('utf8')
    length = len(header_bytes)
    padding = (4 - ((8 + length) % 4)) % 4
    header_size = 8 + length + padding
    payload = b''.join(content for _, content, _ in chunks)
    return (struct.pack('<II', 4, header_size) + struct.pack('<II', header_size - 4, length) + header_bytes + b'\x00' * padding + payload)

def verify(data, helper, before, after):
    if data.sha(before) != BASE_SHA:
        raise ValueError('A11_ASAR_BASE_CHANGED')
    old, _ = data.checked_parsed(helper, before, 'a11 base 149')
    new, _ = data.checked_parsed(helper, after, 'r2 149')
    a = {m['path']: m for m in old['members']}
    b = {m['path']: m for m in new['members']}
    if len(a) != 149 or len(b) != 149 or set(a) != set(b):
        raise ValueError('SAME149_REQUIRED')
    changed = []
    for name in a:
        prev = helper.read_range(old, a[name])
        cur = helper.read_range(new, b[name])
        if prev != cur:
            changed.append(name)
    expected = {M1, M2}
    if set(changed) != expected:
        raise ValueError('ONLY_R2_TWO_MEMBERS_CHANGED: ' + ','.join(sorted(changed)))
    if data.sha(helper.read_range(new, b[M1])) != M1_AFTER_SHA:
        raise ValueError('M1_PIN')
    if data.sha(helper.read_range(new, b[M2])) != M2_AFTER_SHA:
        raise ValueError('M2_PIN')
    if data.sha(helper.read_range(new, b[RENDERER])) != RENDERER_SHA:
        raise ValueError('RENDERER_CHANGED')
    return {
        'verified': True,
        'originalMembers': 149,
        'finalMembers': 149,
        'changedMembers': [M1, M2],
        'preservedMembers': 147,
        'sourceAsarSha256': BASE_SHA,
        'asarSha256': data.sha(after),
        'programExecuted': False,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True)
    parser.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    data, helper = load_frozen_data()
    before = data.read(BASE)
    if data.sha(before) != BASE_SHA:
        raise ValueError('BASE_SHA_CHANGED')
    out = Path(args.out)
    if args.verify_only:
        after = data.read(out)
        proof = verify(data, helper, before, after)
        print(json.dumps(proof, sort_keys=True))
        return
    r1 = data.read(Path(M1_AFTER_SOURCE), 1048576)
    r2 = data.read(Path(M2_AFTER_SOURCE), 1048576)
    if data.sha(r1) != M1_AFTER_SHA or len(r1) != M1_AFTER_SIZE:
        raise ValueError('M1_REPLACEMENT_PIN')
    if data.sha(r2) != M2_AFTER_SHA or len(r2) != M2_AFTER_SIZE:
        raise ValueError('M2_REPLACEMENT_PIN')
    after = repack(data, helper, before, r1, r2)
    proof = verify(data, helper, before, after)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(str(out), 'wb') as handle:
        handle.write(after)
        handle.flush()
        os.fsync(handle.fileno())
    print(json.dumps({**proof, 'size': len(after)}, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)





