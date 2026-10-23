"""Copy exactly three approved public verification documents; no key access."""
import hashlib
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
assert os.path.normcase(str(ROOT)) == os.path.normcase(r"E:\codex\2026-10-15\work\xjy-v16-deep-audit")
OUTPUT = ROOT / "sandbox/input/signed162-public-a1"
ROWS = (
    ("release-work/initial-162-feed-a1/catalog.json", "catalog.json", "1b40a19c9ba5ba9f5fded9123173682246a12d0982287fc4c34db1ce68db3fc8"),
    ("release-work/initial-162-feed-a1/publisher-public.pem", "publisher-public.pem", "bc6c3d2b42871e42d3eb91371034b410d507a228eeccb1d714acca60e8141b30"),
    ("release-work/initial-162-host-source-policy-envelope-a1.json", "source-policy-envelope.json", "0b4e2648ca69487a0c05cc595f0927282dc935c25806d942ff706d0da4111a49"),
)

def plain(target):
    assert target.resolve(strict=True).is_relative_to(ROOT), "Outside isolated root"
    for item in (target, *target.parents):
        assert not item.is_symlink() and not item.is_junction(), "Alias refused"
        if item == ROOT:
            break
    stat = target.stat()
    if target.is_file():
        assert stat.st_nlink == 1 and stat.st_size <= 2097152

plain(OUTPUT.parent)
assert not os.path.lexists(OUTPUT), "CreateNew public batch required"
buffers = []
for source, name, pin in ROWS:
    file = ROOT / source
    plain(file)
    body = file.read_bytes()
    assert hashlib.sha256(body).hexdigest() == pin
    assert b"PRIVATE KEY" not in body
    buffers.append((file, name, pin, body))
OUTPUT.mkdir()
for source, name, pin, body in buffers:
    target = OUTPUT / name
    with target.open("xb") as stream:
        stream.write(body)
    plain(target)
    assert target.read_bytes() == body and source.read_bytes() == body
manifest = {"purpose": "original-issuer-162-public-verification-only", "files": [{"name": name, "size": len(body), "sha256": pin} for _, name, pin, body in buffers], "privateKeyIncluded": False, "published": False, "installed": False}
with (OUTPUT / "manifest.json").open("x", encoding="utf-8", newline="\n") as stream:
    stream.write(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"prepared": True, "publicFiles": 3, "privateKeyIncluded": False, "directory": str(OUTPUT), "manifestSha256": hashlib.sha256((OUTPUT / "manifest.json").read_bytes()).hexdigest()}))
