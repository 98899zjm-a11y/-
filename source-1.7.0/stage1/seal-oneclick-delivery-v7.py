"""Data-only ZIP closure for Root's separately pinned one-click build report."""
from pathlib import Path
import argparse, hashlib, json, os, stat, zipfile

R = Path(__file__).resolve().parent.parent

def digest(data):
    return hashlib.sha256(data).hexdigest()

def ordinary(p, root=R):
    if not p.is_relative_to(root) or p.resolve() != p:
        raise RuntimeError('Packaging path escaped or is aliased')
    walk = p
    while True:
        s = walk.lstat()
        if stat.S_ISLNK(s.st_mode) or os.path.isjunction(walk) or getattr(s, 'st_file_attributes', 0) & 0x400:
            raise RuntimeError('Packaging link refused')
        if walk.is_file() and s.st_nlink != 1:
            raise RuntimeError('Packaging hardlink refused')
        if walk == root:
            break
        walk = walk.parent
    return p

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--report-sha256', required=True)
    args = parser.parse_args()
    manifest_file = ordinary(R / 'reports/oneclick-delivery-build-v7.json')
    raw = manifest_file.read_bytes()
    if digest(raw) != args.report_sha256:
        raise RuntimeError('Root approved build report changed')
    manifest = json.loads(raw.decode('utf-8-sig'))
    folder = ordinary(Path(manifest['directory']))
    if folder != R / 'release/initial-1.6.0-一键安装-v7' or manifest['fileCount'] != 1028:
        raise RuntimeError('Fixed new release tree required')
    expected = {f['path']: f for f in manifest['files']}
    actual = {p.relative_to(folder).as_posix() for p in folder.rglob('*') if ordinary(p).is_file()}
    if len(expected) != 1028 or set(expected) != actual:
        raise RuntimeError('Release closure differs')
    archive = R / 'release/鑫金源珠宝1.6.0-一键升级-20261015.zip'
    if archive.exists():
        raise RuntimeError('Fresh archive required')
    with zipfile.ZipFile(archive, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as z:
        for name in sorted(expected):
            if ':' in name or '\\' in name or name.startswith('/') or '..' in name.split('/'):
                raise RuntimeError('Unsafe member')
            f = ordinary(folder / name)
            before = f.stat()
            data = f.read_bytes()
            after = f.stat()
            if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
                raise RuntimeError('Release file changed during read')
            if len(data) != expected[name]['size'] or digest(data) != expected[name]['sha256']:
                raise RuntimeError('Release member differs')
            z.writestr(name, data)
    ordinary(archive)
    with zipfile.ZipFile(archive) as z:
        if len(z.infolist()) != 1028 or {i.filename for i in z.infolist()} != set(expected) or z.testzip() is not None:
            raise RuntimeError('ZIP closure/CRC failed')
        for name, f in expected.items():
            data = z.read(name)
            if len(data) != f['size'] or digest(data) != f['sha256']:
                raise RuntimeError('ZIP member SHA differs')
    out = {'purpose': 'Complete ZIP member SHA and CRC verification of Root approved one-click build',
           'archive': str(archive), 'size': archive.stat().st_size, 'sha256': digest(archive.read_bytes()),
           'buildReportSha256': args.report_sha256, 'members': 1028, 'allMemberSha256Verified': True,
           'crcVerified': True, 'installerExecuted': False, 'productionTouched': False}
    with (R / 'reports/oneclick-delivery-zip-v7.json').open('x', encoding='utf-8') as s:
        json.dump(out, s, ensure_ascii=False, indent=2)
    print(json.dumps(out, ensure_ascii=False))

if __name__ == '__main__':
    main()
