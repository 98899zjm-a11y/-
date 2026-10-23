"""Host data-only packaging of already installed public release dependencies."""
from pathlib import Path
import hashlib, importlib.util, json

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('data_preparation', ROOT / 'audit-tools/prepare-guest-audit.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
OUT = ROOT / 'sandbox/input/release-tooling-a1'
if OUT.exists():
    raise RuntimeError('Fresh input directory required')
ASAR = Path('E:/珠宝销售软件/desktop/node_modules')
PDF = Path('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')
PREFIX = 'audit-tools/dependencies/node_modules/'
rows, seen, packages = [], set(), []

def add(file, relative):
    m.ordinary(file)
    if relative.casefold() in seen:
        raise RuntimeError('Duplicate public dependency path')
    body = file.read_bytes()
    if b'-----BEGIN PRIVATE KEY-----' in body or body[:16] == b'SQLite format 3\0':
        raise RuntimeError('Non-program input refused')
    seen.add(relative.casefold())
    m.write_new(OUT / relative, body)
    rows.append({'path': relative, 'size': len(body), 'sha256': m.sha(body)})

def resolve(name, source):
    for ancestor in (source, *source.parents):
        candidate = ancestor / 'node_modules' / name
        if (candidate / 'package.json').is_file():
            return candidate
    raise RuntimeError('Public package dependency missing: ' + name)

def package(source, destination, chain=()):
    m.ordinary(source)
    info = json.loads((source / 'package.json').read_text('utf-8'))
    name = info['name']
    if name in chain or len(chain) > 24:
        raise RuntimeError('Dependency cycle/depth refused')
    packages.append({'name': name, 'version': info['version'], 'license': info.get('license'), 'destination': destination})
    for file in sorted(source.rglob('*')):
        rel = file.relative_to(source)
        if 'node_modules' in rel.parts:
            continue
        m.ordinary(file)
        if file.is_file():
            add(file, destination + '/' + rel.as_posix())
    for dependency in sorted(info.get('dependencies', {})):
        package(resolve(dependency, source), destination + '/node_modules/' + dependency, chain + (name,))

asar = json.loads((ASAR / '@electron/asar/package.json').read_text('utf-8'))
if (asar['name'], asar['version'], asar['license']) != ('@electron/asar', '3.4.1', 'MIT'):
    raise RuntimeError('Reviewed ASAR package identity changed')
package(ASAR / '@electron/asar', PREFIX + '@electron/asar')
for name in ('pdfjs-dist', '@napi-rs/canvas', '@napi-rs/canvas-win32-x64-msvc'):
    source = PDF / name
    info = json.loads((source / 'package.json').read_text('utf-8'))
    if info['name'] != name or info.get('dependencies'):
        raise RuntimeError('Reviewed leaf PDF package shape changed')
    package(source, PREFIX + name)
manifest = (json.dumps({'version': 1, 'purpose': 'data-free isolated audit code and public compiler', 'files': rows}, indent=2) + '\n').encode()
m.write_new(OUT / 'manifest.json', manifest)
m.write_new(ROOT / 'reports/release-tooling-a1.json', (json.dumps({'publicPackages': packages, 'files': len(rows), 'bytes': sum(row['size'] for row in rows), 'manifestSha256': m.sha(manifest), 'executedThirdParty': False}, indent=2) + '\n').encode())
print(json.dumps({'files': len(rows), 'manifestSha256': m.sha(manifest), 'packages': len(packages)}))
