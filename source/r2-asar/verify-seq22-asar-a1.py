#!/usr/bin/env python3
"""seq22 app.asar proof (self-contained, pure data; never executes app code).

Same discipline as verify-r2-asar-a1.py, but the changed set is *declared* on the
command line instead of being hard-coded:

  --changed a.cjs,b.cjs,...   the only members allowed to differ from the baseline

Checks:
  * baseline file hashes to the pinned shipped 1.7.0 digest
  * both archives have exactly 149 members with identical member sets
  * the set of members whose bytes changed is exactly the declared set
  * every non-declared member is byte-identical to the baseline
  * native-update-handoff.cjs is still 2d972ed4...
  * renderer-dist/assets/main-7etXIfP0.js is still c08a94f2... (UI untouched)
  * programExecuted=false (this script only reads bytes)
  * ASAR shared data ranges (dedupe) are allowed: every member is verified by its
    own hash, and members that share a range are additionally proven to hold the
    same bytes, so sharing can never hide a change.

Optional cross-check modes (used by the seq22 repack task):
  --extract-dir DIR     require DIR to be an `asar extract` of --asar and compare
                        every extracted file byte-for-byte with its member
  --source-map a=b,...  require extract-dir files to equal these source files
  --expect-sha a=b,...  pin the post-change sha256 of named members
"""
import argparse
import hashlib
import json
import struct
import sys
from pathlib import Path

BASELINE_SHA = 'd017ceb9947ec3ead43de68a2da1e9aac928c56129bb5c2abafa36238026141d'
EXPECTED_MEMBERS = 149
HANDOFF = 'native-update-handoff.cjs'
HANDOFF_SHA = '2d972ed47f0e58601a9a91a958fdb596ee5f9be754e5df55081a98f9de21a42d'
RENDERER = 'renderer-dist/assets/main-7etXIfP0.js'
RENDERER_SHA = 'c08a94f2a32ef935c492f86b582da8f7cda364dac61ac1277406d51185285282'


def sha(buf):
    return hashlib.sha256(buf).hexdigest()


def parse(buf, label):
    """Return (members{path: bytes}, shared_ranges[(offset, size, paths)], total_size)."""
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
    ranges = {}

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
            if data_start + offset + size > len(buf):
                raise ValueError('BAD_MEMBER_RANGE: %s:%s' % (label, path))
            members[path] = buf[data_start + offset:data_start + offset + size]
            ranges.setdefault((offset, size), []).append(path)

    walk(header, '')
    shared = sorted((o, s, p) for (o, s), p in ranges.items() if len(p) > 1)
    return members, shared, len(buf)


def split_pairs(text, label):
    out = {}
    if not text:
        return out
    for item in text.split(','):
        item = item.strip()
        if not item:
            continue
        if '=' not in item:
            raise ValueError('BAD_%s: %s' % (label, item))
        name, value = item.split('=', 1)
        out[name.strip()] = value.strip()
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--baseline', required=True)
    ap.add_argument('--asar', required=True)
    ap.add_argument('--changed', required=True, help='comma separated member paths')
    ap.add_argument('--report', required=True)
    ap.add_argument('--extract-dir')
    ap.add_argument('--source-map', default='')
    ap.add_argument('--expect-sha', default='')
    args = ap.parse_args()

    declared = sorted(m.strip() for m in args.changed.split(',') if m.strip())
    if not declared:
        raise ValueError('EMPTY_CHANGED_SET')
    expect_sha = split_pairs(args.expect_sha, 'EXPECT_SHA')
    source_map = split_pairs(args.source_map, 'SOURCE_MAP')

    base_bytes = Path(args.baseline).read_bytes()
    asar_bytes = Path(args.asar).read_bytes()
    if sha(base_bytes) != BASELINE_SHA:
        raise ValueError('BASELINE_PIN')
    base, base_shared, base_len = parse(base_bytes, 'baseline')
    new, new_shared, new_len = parse(asar_bytes, 'seq22')
    if len(base) != EXPECTED_MEMBERS or len(new) != EXPECTED_MEMBERS:
        raise ValueError('MEMBER_COUNT: %d/%d' % (len(base), len(new)))
    if set(base) != set(new):
        missing = sorted(set(base) - set(new))[:3]
        extra = sorted(set(new) - set(base))[:3]
        raise ValueError('MEMBER_SET: missing=%s extra=%s' % (missing, extra))

    # every shared range must really hold one identical payload for all its members
    for offset, size, paths in new_shared:
        hashes = {sha(new[p]) for p in paths}
        if len(hashes) != 1:
            raise ValueError('SHARED_RANGE_MISMATCH: offset=%d size=%d %s' % (offset, size, ','.join(paths)))

    changed = [p for p in sorted(base) if base[p] != new[p]]
    if changed != declared:
        undeclared = sorted(set(changed) - set(declared))
        absent = sorted(set(declared) - set(changed))
        raise ValueError('CHANGED_SET: changed=%s undeclared=%s not-changed=%s'
                         % (','.join(changed), ','.join(undeclared), ','.join(absent)))

    for name in declared:
        if name not in new:
            raise ValueError('DECLARED_MISSING: ' + name)
    for name, want in expect_sha.items():
        if name not in new:
            raise ValueError('EXPECT_SHA_UNKNOWN: ' + name)
        if sha(new[name]) != want:
            raise ValueError('EXPECT_SHA: %s got=%s want=%s' % (name, sha(new[name]), want))
    if sha(new[HANDOFF]) != HANDOFF_SHA:
        raise ValueError('HANDOFF_PIN')
    if sha(new[RENDERER]) != RENDERER_SHA:
        raise ValueError('RENDERER_CHANGED')

    extract = None
    if args.extract_dir:
        root = Path(args.extract_dir)
        if not root.is_dir():
            raise ValueError('EXTRACT_DIR_MISSING: ' + str(root))
        seen = {}
        for file in sorted(p for p in root.rglob('*') if p.is_file()):
            seen[file.relative_to(root).as_posix()] = file.read_bytes()
        if set(seen) != set(new):
            raise ValueError('EXTRACT_SET: missing=%s extra=%s'
                             % (sorted(set(new) - set(seen))[:3], sorted(set(seen) - set(new))[:3]))
        mismatched = [p for p in sorted(new) if seen[p] != new[p]]
        if mismatched:
            raise ValueError('EXTRACT_BYTES: ' + ','.join(mismatched[:5]))
        for name, path in source_map.items():
            if name not in seen:
                raise ValueError('SOURCE_MAP_UNKNOWN: ' + name)
            if seen[name] != Path(path).read_bytes():
                raise ValueError('SOURCE_MISMATCH: %s <- %s' % (name, path))
        extract = {
            'dir': str(root.resolve()),
            'files': len(seen),
            'mismatchedMembers': [],
            'sourceCompared': {name: {'path': str(Path(path).resolve()), 'sha256': sha(Path(path).read_bytes())}
                               for name, path in sorted(source_map.items())},
            'allExtractedFilesMatchMembers': True,
            'allSourceFilesMatchExtracted': True,
        }

    preserved = [p for p in sorted(base) if p not in changed]
    report = {
        'verified': True,
        'pureDataOnly': True,
        'programExecuted': False,
        'originalMembers': len(base),
        'finalMembers': len(new),
        'declaredChangedSet': declared,
        'changedMembers': changed,
        'preservedMembers': len(preserved),
        'unchangedButPinned': [HANDOFF, RENDERER],
        'rendererSha256': RENDERER_SHA,
        'handoffSha256': HANDOFF_SHA,
        'baselineAsarSha256': BASELINE_SHA,
        'baselineSize': base_len,
        'asarSha256': sha(asar_bytes),
        'asarSize': new_len,
        'changedPins': {p: sha(new[p]) for p in declared},
        'changedBefore': {p: {'sha256': sha(base[p]), 'size': len(base[p])} for p in declared},
        'changedAfter': {p: {'sha256': sha(new[p]), 'size': len(new[p])} for p in declared},
        'preservedSha256': sha(json.dumps({p: sha(new[p]) for p in preserved}, sort_keys=True).encode('utf8')),
        'sharedDataRanges': [{'offset': o, 'size': s, 'members': p} for o, s, p in new_shared],
        'sharedDataRangesBaseline': len(base_shared),
        'extract': extract,
    }
    report['proof'] = {
        'verified': True,
        'pureDataOnly': True,
        'programExecuted': False,
        'originalMembers': len(base),
        'finalMembers': len(new),
        'changedMembers': changed,
        'preservedMembers': len(preserved),
        'asarSha256': sha(asar_bytes),
        'asarSize': new_len,
        'baselineAsarSha256': BASELINE_SHA,
        'rendererSha256': RENDERER_SHA,
        'handoffSha256': HANDOFF_SHA,
        'sharedDataRangesAllowed': True,
        'perMemberHashVerified': True,
    }
    report['output'] = {
        'path': str(Path(args.asar).resolve()),
        'sha256': sha(asar_bytes),
        'size': new_len,
    }
    body = json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + '\n'
    with open(args.report, 'w', encoding='utf8', newline='') as handle:  # newline='': no CRLF translation
        handle.write(body)
    print(body, end='')
    print('reportSha256=' + sha(body.encode('utf8')))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, json.JSONDecodeError, struct.error) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
