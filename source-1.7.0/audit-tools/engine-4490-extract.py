"""Actual-Guest data-only extraction of one pinned official engine; never launch it."""
import hashlib, importlib.util, json, os, re, stat, zipfile
from pathlib import Path, PurePosixPath

ROOT = Path('C:/xjy-work/xjy-web-stage1')
if Path(__file__).resolve().parents[1] != ROOT or os.name != 'nt':
    raise RuntimeError('Actual fixed Guest required')
guard_path = ROOT / 'stage1/sandbox-context.py'
assert hashlib.sha256(guard_path.read_bytes()).hexdigest() == '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249'
spec = importlib.util.spec_from_file_location('actual_context', guard_path)
guard = importlib.util.module_from_spec(spec); spec.loader.exec_module(guard)
proof = guard.read_context(ROOT)
INPUT = Path('C:/xjy-input/engine-4490-public-a1/electron-v44.9.0-win32-x64.zip')
OUT = ROOT / 'release-work/engine-4490-a1/engine-stock'
EXPECTED = '88e08039d0ef359bab9f674e8051fa103bd8628ea7c5a5e1daaa610a8a0c6931'

def ordinary(file):
    for item in (file, *file.parents):
        if not item.exists(): continue
        value = item.lstat()
        if stat.S_ISLNK(value.st_mode) or os.path.isjunction(item) or getattr(value, 'st_file_attributes', 0) & 0x400 or stat.S_ISREG(value.st_mode) and value.st_nlink != 1:
            raise RuntimeError('Ordinary single-link paths required')
    return file

ordinary(INPUT)
assert INPUT.stat().st_size == 158625558
with INPUT.open('rb') as stream: assert hashlib.file_digest(stream, 'sha256').hexdigest() == EXPECTED
ordinary(OUT); assert not OUT.exists()
ordinary(OUT.parent); assert OUT.parent.is_dir()
with zipfile.ZipFile(INPUT) as archive:
    entries = archive.infolist(); assert 20 <= len(entries) <= 256
    names, total = set(), 0
    for entry in entries:
        name = entry.filename.rstrip('/')
        assert name and '\\' not in name and ':' not in name and not name.startswith('/')
        assert not any(ord(c) < 32 for c in name)
        assert all(p not in ('', '.', '..') and p.rstrip(' .') == p and not re.fullmatch(r'(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?', p, re.I) for p in name.split('/'))
        assert name.casefold() not in names and not entry.flag_bits & 1
        assert not stat.S_ISLNK(entry.external_attr >> 16)
        assert 0 <= entry.file_size <= 300 * 1024 * 1024
        names.add(name.casefold()); total += entry.file_size
    assert total <= 1024 * 1024 * 1024
    OUT.mkdir(exist_ok=False); rows = []
    for entry in entries:
        destination = OUT.joinpath(*PurePosixPath(entry.filename).parts)
        ordinary(destination)
        if entry.is_dir(): destination.mkdir(parents=True, exist_ok=True); continue
        destination.parent.mkdir(parents=True, exist_ok=True); ordinary(destination.parent)
        digest = hashlib.sha256(); length = 0
        with archive.open(entry) as source, destination.open('xb') as target:
            while body := source.read(1024 * 1024):
                length += len(body); assert length <= entry.file_size
                digest.update(body); target.write(body)
            target.flush(); os.fsync(target.fileno())
        assert length == entry.file_size
        with ordinary(destination).open('rb') as target: assert hashlib.file_digest(target, 'sha256').hexdigest() == digest.hexdigest()
        rows.append({'path': entry.filename, 'size': length, 'sha256': digest.hexdigest()})
assert (OUT / 'version').read_text().strip() == '44.9.0'
assert any(row['path'] == 'electron.exe' for row in rows)
result = {'purpose': 'official-engine-4490-data-only-extraction', 'passed': True, 'actualContext': proof, 'zipSha256': EXPECTED, 'root': str(OUT), 'files': rows, 'executableLaunched': False}
body = (json.dumps(result, indent=2) + '\n').encode()
for file in (OUT.parent / 'engine-stock.json', Path('C:/xjy-results/engine-4490-extraction-a1.json')):
    with ordinary(file).open('xb') as stream: stream.write(body)
print(json.dumps({'passed': True, 'files': len(rows), 'exeSha256': next(row['sha256'] for row in rows if row['path'] == 'electron.exe'), 'reportSha256': hashlib.sha256(body).hexdigest()}))
