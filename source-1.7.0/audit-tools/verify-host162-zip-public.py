"""Independent stdlib-only verification of the fixed internal Host ZIP.

Does not extract archives, execute programs, open databases or read keys.
"""
import hashlib
import json
import os
import stat
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
assert os.path.normcase(str(ROOT)) == os.path.normcase(r"E:\codex\2026-10-15\work\xjy-v16-deep-audit")
REPORT = ROOT / "reports/release-162-host-seal-a1.json"
REPORT_PIN = "81a53e514885e56f7f2bbe93ca4205a05aef5072c57865f51c9c9b7799d9580f"
OUTPUT = ROOT / "audit-evidence/host162-final-zip-independent-20261019.json"

def check_path(file):
    assert file.resolve(strict=True).is_relative_to(ROOT)
    for item in (file, *file.parents):
        assert not item.is_symlink() and not item.is_junction()
        if item == ROOT:
            break
    if file.is_file():
        assert file.stat().st_nlink == 1

def digest(file):
    check_path(file)
    with file.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()

assert not os.path.lexists(OUTPUT), "CreateNew evidence required"
assert digest(REPORT) == REPORT_PIN
report = json.loads(REPORT.read_text(encoding="utf-8"))
assert report["programVersion"] == "1.6.2" and report["sealed"]
for key in ("published", "installed", "programExecuted", "privateKeyRead", "privateKeyIncluded", "installable"):
    assert report[key] is False
assert report["internalOperatorOnly"] and report["independentHostApprovalRequired"]
archive = ROOT / "release/initial-162-host-internal.zip"
tree = ROOT / "release-work/initial-162-host-sealed-a1"
assert report["archiveFile"] == str(archive) and report["directory"] == str(tree)
expected = {row["path"]: row for row in report["files"]}
assert len(expected) == len(report["files"]) == 1020
assert len({name.casefold() for name in expected}) == 1020
assert digest(archive) == report["artifactSha256"] == "266b53df5930e4062ef7dabd793dc81ac2d4cecfe7521af09a24dbfd6c661446"
assert archive.stat().st_size == report["artifactSize"] == 163904664
actual = set()
for directory, dirs, files in os.walk(tree, followlinks=False, onerror=lambda error: (_ for _ in ()).throw(error)):
    check_path(Path(directory))
    for name in dirs:
        check_path(Path(directory) / name)
    for name in files:
        file = Path(directory) / name
        check_path(file)
        actual.add(file.relative_to(tree).as_posix())
assert actual == set(expected)
members = []
with zipfile.ZipFile(archive) as packed:
    assert packed.comment == b""
    infos = packed.infolist()
    assert len(infos) == len({info.filename.casefold() for info in infos}) == 1020
    assert {info.filename for info in infos} == actual
    for info in infos:
        assert not info.is_dir() and info.compress_type == zipfile.ZIP_STORED
        assert info.flag_bits == 0x800 and not info.extra and not info.comment
        assert stat.S_ISREG(info.external_attr >> 16)
        row = expected[info.filename]
        assert info.file_size == info.compress_size == row["size"]
        result = hashlib.sha256()
        with packed.open(info) as stream:
            while block := stream.read(1024 * 1024):
                result.update(block)
        assert result.hexdigest() == row["sha256"], "ZIP member SHA mismatch"
        file = tree / info.filename
        assert file.stat().st_size == row["size"] and digest(file) == row["sha256"]
        members.append(info.filename)
    # zipfile checks each member's full CRC when the stream reaches EOF.
    policy_bytes = packed.read("source-policy-envelope.json")
    assert hashlib.sha256(policy_bytes).hexdigest() == "0b4e2648ca69487a0c05cc595f0927282dc935c25806d942ff706d0da4111a49"
    policy = json.loads(json.loads(policy_bytes)["policy"])
    assert policy == report["sourcePolicy"] and policy["targetVersion"] == "1.6.2"
    assert [item["version"] for item in policy["sourcePrograms"]] == ["1.6.1", "1.6.2"]
    assert len(policy["tools"]) == 10
    for row in policy["tools"]:
        assert expected[row["path"]] == row
assert digest(REPORT) == REPORT_PIN and digest(archive) == report["artifactSha256"]
result = {"purpose": "independent-host162-final-zip-readonly", "passed": True, "fileCount": len(members), "archiveSize": archive.stat().st_size, "archiveSha256": report["artifactSha256"], "sealReportSha256": REPORT_PIN, "allMembersCrcAndShaVerified": True, "archiveMatchesSealedDirectory": True, "exactPublicPolicyAndToolsVerified": True, "signatureIndependentlyVerifiedByThisTool": False, "archiveExtracted": False, "programExecuted": False, "privateKeyRead": False, "published": False, "installed": False, "nativeInstallationVerified": False}
with OUTPUT.open("x", encoding="utf-8", newline="\n") as stream:
    stream.write(json.dumps(result, indent=2) + "\n")
print(json.dumps({**result, "evidenceSha256": digest(OUTPUT)}))
