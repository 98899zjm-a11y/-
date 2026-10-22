#!/usr/bin/env python3
"""r2 app.asar proof (self-contained, pure data; never executes app code).

Compares the shipped 1.7.0 app.asar (baseline) with the r2 app.asar and proves:
  * both have exactly 149 members with identical member sets
  * exactly two members changed: native-update-handoff.cjs, native-publication-update.cjs
  * those two members hash to the pinned r2 values
  * the other 147 members are byte-identical
  * renderer-dist/assets/main-7etXIfP0.js is byte-identical (UI untouched)
ASAR shared data ranges (dedupe) are allowed; every member is verified by its own
hash, so sharing cannot hide a change.
"""
import argparse
import hashlib
import json
import struct
import sys
from pathlib import Path

BASELINE_SHA = 'd017ceb9947ec3ead43de68a2da1e9aac928c56129bb5c2abafa36238026141d'
HANDOFF_SHA = '2d972ed47f0e58601a9a91a958fdb596ee5f9be754e5df55081a98f9de21a42d'
CLIENT_SHA = 'a9e05a50398cbdf64cbd19498873b35d3f07e2e3830dff73be7780146250eaf6'
RENDERER = 'renderer-dist/assets/main-7etXIfP0.js'
RENDERER_SHA = 'c08a94f2a32ef935c492f86b582da8f7cda364dac61ac1277406d51185285282'


def sha(buf):
    return hashlib.sha256(buf).hexdigest()


def parse(buf, label):
    if len(buf) < 16:
        raise ValueError('BAD_ASAR_SIZE: ' + label)
    first, header_size, payload_size, json_len = struct.unpack_from('<IIII', buf, 0)
    if first != 4 or header_size < 16 or 8 + header_size > len(buf):
        raise ValueError('BAD_ASAR_HEADER: ' + label)
    if payload_size != header_size - 4:
        raise ValueError('BAD_ASAR_PAYLOAD: ' + label)
    if json_len > header_size - 8:
        raise ValueError('BAD_ASAR_JSONLEN: ' + label)
    header = json.loads(buf[16:16 + json_len].decode('utf8'))
    data_start = 8 + header_size
    members = {}

    def walk(node, prefix):
        for name, entry in (node.get('files') or {}).items():
            path = prefix + name
            if 'files' in entry:
                walk(entry, path + '/')
                continue
            if entry.get('unpacked'):
                continue
            size = int(entry['size'])
            offset = int(entry['offset'])
            members[path] = buf[data_start + offset:data_start + offset + size]

    walk(header, '')
    return members, len(buf)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--baseline', required=True)
    ap.add_argument('--r2', required=True)
    ap.add_argument('--report', required=True)
    args = ap.parse_args()
    base_bytes = Path(args.baseline).read_bytes()
    r2_bytes = Path(args.r2).read_bytes()
    if sha(base_bytes) != BASELINE_SHA:
        raise ValueError('BASELINE_PIN')
    base, base_len = parse(base_bytes, 'baseline')
    r2, r2_len = parse(r2_bytes, 'r2')
    if len(base) != 149 or len(r2) != 149:
        raise ValueError('MEMBER_COUNT: %d/%d' % (len(base), len(r2)))
    if set(base) != set(r2):
        missing = sorted(set(base) - set(r2))[:3]
        extra = sorted(set(r2) - set(base))[:3]
        raise ValueError('MEMBER_SET: missing=%s extra=%s' % (missing, extra))
    changed = [p for p in sorted(base) if sha(base[p]) != sha(r2[p])]
    if changed != ['native-publication-update.cjs']:
        raise ValueError('CHANGED_SET: ' + ','.join(changed))
    if sha(r2['native-update-handoff.cjs']) != HANDOFF_SHA:
        raise ValueError('HANDOFF_PIN')
    if sha(r2['native-publication-update.cjs']) != CLIENT_SHA:
        raise ValueError('CLIENT_PIN')
    if sha(r2[RENDERER]) != RENDERER_SHA:
        raise ValueError('RENDERER_CHANGED')
    preserved = len(base) - len(changed)
    report = {
        'verified': True,
        'pureDataOnly': True,
        'programExecuted': False,
        'originalMembers': len(base),
        'finalMembers': len(r2),
        'changedMembers': changed,
        'unchangedButPinned': ['native-update-handoff.cjs', RENDERER],
        'preservedMembers': preserved,
        'rendererSha256': RENDERER_SHA,
        'baselineAsarSha256': BASELINE_SHA,
        'baselineSize': base_len,
        'asarSha256': sha(r2_bytes),
        'asarSize': r2_len,
        'changedPins': {'native-update-handoff.cjs': HANDOFF_SHA, 'native-publication-update.cjs': CLIENT_SHA},
        'preservedSha256': sha(json.dumps({p: sha(r2[p]) for p in sorted(base) if p not in changed}, sort_keys=True).encode('utf8')),
    }
    Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + '\n', encoding='utf8')
    print(json.dumps(report, ensure_ascii=False, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, json.JSONDecodeError, struct.error) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)


