"""Copy four existing public compiler packages as sealed data; never install/run them."""
from pathlib import Path
import hashlib
import json
import os
import stat

ROOT = Path('E:/codex/2026-10-15/work/xjy-v16-deep-audit')
PUBLIC = Path('E:/珠宝销售软件/node_modules')
OUT = ROOT/'sandbox/input/finance170-public-deps-a1'
PACKAGES = {
    'esbuild': ('0.28.0', '4316bc9a54bbf659d5760f299910d1824045178557e0aea6a1e3c64148fe8a50'),
    '@esbuild/win32-x64': ('0.28.0', 'c93a604e2f0009a29f93dd8671885586241a155fc5f0264a4d3c89172f83869d'),
    'zod': ('3.25.76', '70eedbe34fd52385a4ae2f3e5759b19682189f0118ea73a6e7c32c677f61668e'),
    'react': ('19.2.6', 'e631b6ac066fa758d9b36f226d96e8fc05425d1e8993ffcc99c6de2d6aa7268c'),
}

def ordinary(file):
    for part in (file, *file.parents):
        if not part.exists():
            continue
        info = part.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400 or stat.S_ISREG(info.st_mode) and info.st_nlink != 1:
            raise RuntimeError('Ordinary, single-link public/input paths required')

def read(file):
    ordinary(file)
    before = file.stat()
    if not stat.S_ISREG(before.st_mode) or before.st_size > 32*1024*1024:
        raise RuntimeError('Bounded public file required')
    body = file.read_bytes()
    after = file.stat()
    if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
        raise RuntimeError('Public input changed')
    return body

def write(file, body):
    ordinary(file)
    file.parent.mkdir(parents=True, exist_ok=True)
    ordinary(file.parent)
    with file.open('xb') as stream:
        stream.write(body)
        stream.flush()
        os.fsync(stream.fileno())
    if file.read_bytes() != body:
        raise RuntimeError('New input copy differs')

if Path(__file__).resolve().parent.parent != ROOT:
    raise RuntimeError('Fixed Host preparation root required')
ordinary(ROOT)
ordinary(PUBLIC)
ordinary(OUT)
if OUT.exists():
    raise RuntimeError('Fresh input directory required')
rows = []
for name, (version, metadata_sha) in PACKAGES.items():
    folder = PUBLIC/name
    metadata = read(folder/'package.json')
    if hashlib.sha256(metadata).hexdigest() != metadata_sha:
        raise RuntimeError('Public package metadata changed')
    info = json.loads(metadata)
    if (info['name'], info['version'], info['license']) != (name, version, 'MIT'):
        raise RuntimeError('Public package identity differs')
    for file in sorted(folder.rglob('*')):
        ordinary(file)
        if file.is_dir():
            continue
        local = file.relative_to(PUBLIC).as_posix()
        if file.suffix.lower() in ('.db', '.sqlite', '.key', '.pem', '.pyc', '.dll', '.node') or file.name.startswith('.env') or file.suffix.lower() == '.exe' and local != '@esbuild/win32-x64/esbuild.exe':
            raise RuntimeError('Not an allowed public compiler input')
        body = read(file)
        relative = 'audit-tools/dependencies/node_modules/'+local
        write(OUT/relative, body)
        rows.append({'path': relative, 'size': len(body), 'sha256': hashlib.sha256(body).hexdigest()})
manifest = (json.dumps({'version': 1, 'purpose': 'data-free isolated audit code and public compiler', 'files': rows}, indent=2)+'\n').encode()
write(OUT/'manifest.json', manifest)
print(json.dumps({'files': len(rows), 'bytes': sum(row['size'] for row in rows), 'manifestSha256': hashlib.sha256(manifest).hexdigest(), 'packagesExecuted': False}))
