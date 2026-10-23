from pathlib import Path
import hashlib
import json

directory = Path(__file__).resolve().parent.parent / 'legacy-modules'
modules = []
for identity, version, label in [('ledger', '1.3.0', '财务系统'), ('inventory', '1.9.0', '珠宝库管')]:
    filename = 'xjy-' + identity + '.exe'
    bundle = directory / ('xjy-' + identity)
    content = (bundle / filename).read_bytes()
    if not content.startswith(b'MZ'):
        raise RuntimeError('Expected a real compiled Windows executable.')
    files=[dict(path=str(path.relative_to(bundle)).replace('\\','/'),sha256=hashlib.sha256(path.read_bytes()).hexdigest(),size=path.stat().st_size) for path in sorted(bundle.rglob('*')) if path.is_file()]
    modules.append(dict(id=identity, label=label, version=version, file=filename,runtimeMode='onedir',files=files,
                        sha256=hashlib.sha256(content).hexdigest(), size=len(content)))
(directory / 'manifest.json').write_text(json.dumps(dict(version=1, modules=modules), ensure_ascii=False, indent=2), encoding='utf-8')
print('Verified binary manifest written.')
