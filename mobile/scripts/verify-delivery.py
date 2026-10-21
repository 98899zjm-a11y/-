"""Inspect packaged offline assets, never open or alter the business database."""
from pathlib import Path
import hashlib
import json
import re
import zipfile

mobile = Path(__file__).resolve().parent.parent
root = mobile.parent
apk = root / '鑫金源珠宝-安卓手机版.apk'
ios = root / '鑫金源珠宝-苹果项目待签名.zip'
build = mobile / 'dist'
index = (build / 'index.html').read_bytes()
assets = re.findall(r'(?:src|href)="(/[^\"]+)"', index.decode())
with zipfile.ZipFile(apk) as archive:
    assert archive.testzip() is None
    assert archive.read('assets/public/index.html') == index
    for asset in assets:
        assert archive.read('assets/public' + asset) == (build / asset[1:]).read_bytes(), asset
    assert archive.read('assets/public/home-necklace.png') == (root / 'public/home-necklace.png').read_bytes()
    config = json.loads(archive.read('assets/capacitor.config.json'))
    assert config['appId'] == 'cn.xjy.jewelry.mobile' and 'url' not in config.get('server', {})
    plugins = json.loads(archive.read('assets/capacitor.plugins.json'))
    assert {p['pkg'] for p in plugins} >= {'@capacitor/filesystem', '@capacitor/share'}
    assert not any(re.search(r'(?:\.p12|\.jks|\.keystore|\.db|\.sqlite|signing\.local\.json)$', name, re.I) for name in archive.namelist())
with zipfile.ZipFile(ios) as archive:
    assert archive.testzip() is None
    assert archive.read('mobile/ios/App/App/public/index.html') == index
    for asset in assets:
        assert archive.read('mobile/ios/App/App/public' + asset) == (build / asset[1:]).read_bytes(), asset
    project = archive.read('mobile/ios/App/App.xcodeproj/project.pbxproj').decode()
    assert 'undefined;' not in project and 'IPHONEOS_DEPLOYMENT_TARGET = 15.4;' in project
    assert 'PrivacyInfo.xcprivacy in Resources' in project
    spm = archive.read('mobile/ios/App/CapApp-SPM/Package.swift').decode()
    assert '.iOS("15.4")' in spm and 'exact: "8.5.3"' in spm
    assert all('mobile/node_modules/@capacitor/' + plugin + '/Package.swift' in archive.namelist() for plugin in ['filesystem', 'share'])
report = {
    'android': {'file': apk.name, 'bytes': apk.stat().st_size, 'sha256': hashlib.sha256(apk.read_bytes()).hexdigest(), 'compiled_signed_release': True},
    'ios': {'file': ios.name, 'bytes': ios.stat().st_size, 'sha256': hashlib.sha256(ios.read_bytes()).hexdigest(), 'compiled_ipa': False},
    'packaged_assets_match_current_build': True,
    'customer_data_or_signing_secrets_in_packages': False,
    'physical_phone_tested': False,
}
(root / '手机端安装包校验.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))
