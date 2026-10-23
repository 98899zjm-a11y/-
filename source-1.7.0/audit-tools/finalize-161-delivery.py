"""Data-only delivery copies and archive verification. Never installs software."""
from pathlib import Path
import hashlib
import json
import shutil
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'release/鑫金源珠宝1.6.1交付'
SOURCE = ROOT / 'release/initial-fresh-employee-161-a1.zip'
FEED = ROOT / 'release-work/initial-161-feed-a1'
if OUT.exists():
    raise RuntimeError('Delivery already exists; preserve and inspect it instead of overwriting')
for target in (SOURCE, FEED, OUT.parent):
    for current in (target, *target.parents):
        if current.is_symlink() or current.is_junction():
            raise RuntimeError('Delivery path link refused')
OUT.mkdir()
full = OUT / '鑫金源珠宝1.6.1-完整员工安装包.zip'
with SOURCE.open('rb') as source, full.open('xb') as destination:
    shutil.copyfileobj(source, destination, 4 * 1024 * 1024)
patch = OUT / '鑫金源珠宝1.6.1-软件内升级补丁.zip'
with zipfile.ZipFile(patch, 'x', compression=zipfile.ZIP_STORED) as archive:
    for name in ('catalog.json', 'package.zip'):
        archive.write(FEED / name, name)
notes = '''鑫金源珠宝 1.6.1

主机已升级，原资料已备份并保留。

已安装1.6.0的员工：
连接原公司主机并登录，在首页点击“一键升级”，保存当前单据后点击“开始升级”。软件会自动下载、校验、备份并升级，完成后重新打开。原主机地址和连接信息沿用。
升级到1.6.1后，登录时及使用期间会检查新版本并提醒。

新员工电脑：
将完整员工安装包全部解压到普通本地目录，再双击“安装员工端.cmd”。不要在压缩包里直接运行。安装后自动打开员工端；填写公司主机连接信息并登录。已有程序目录不会被覆盖。

软件内升级补丁：
本次发布文件的备份，包含catalog.json和package.zip。主机已经发布本次更新，员工无须手动复制或覆盖这些文件。

范围：Windows x64电脑版1.6.1。完整包为ZIP加一键安装入口，并非单文件Setup.exe。
程序资源使用原发布者签名校验，未新增Windows代码签名证书。
财务CSV二进制重组、主机内自动升级、手机及其余ERP审计优化留后续，本次没有将其标为完成。
'''
(OUT / '使用说明.txt').write_text(notes, encoding='utf-8-sig')
rows = []
for file in (full, patch):
    with file.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    with zipfile.ZipFile(file) as archive:
        if archive.testzip() is not None:
            raise RuntimeError('Delivery ZIP CRC mismatch')
    rows.append({'name': file.name, 'size': file.stat().st_size, 'sha256': digest})
if rows[0]['sha256'] != '770e10744e3115a36b2dce01b6971bba676e8149d58a14faa986a3ae2a4d9532':
    raise RuntimeError('Full package differs from the reviewed original')
(OUT / 'SHA256.txt').write_text('\n'.join(row['sha256'] + '  ' + row['name'] for row in rows) + '\n', encoding='utf-8')
result = {'directory': str(OUT), 'files': rows, 'archiveCrcVerified': True, 'privateKeyIncluded': False}
with (ROOT / 'reports/release-161-delivery-a1.json').open('x', encoding='utf-8') as stream:
    json.dump(result, stream, ensure_ascii=False, indent=2)
print(json.dumps(result, ensure_ascii=True))
