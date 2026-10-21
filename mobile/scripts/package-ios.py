"""Package an Xcode source project, not an IPA, without customer data or keys."""
from pathlib import Path
import json
import re
import sys
import zipfile

mobile = Path(__file__).resolve().parent.parent
destination = Path(sys.argv[1]) if len(sys.argv) > 1 else mobile.parent
destination.mkdir(parents=True, exist_ok=True)
target = destination / '鑫金源珠宝-苹果项目待签名.zip'
excluded = {'Pods', 'build', 'xcuserdata', '.DS_Store', '.build', '.swiftpm'}
entries = {}

def add_tree(source, prefix, exclude_public=False):
    for item in sorted(source.rglob('*')):
        relative = item.relative_to(source)
        if excluded.intersection(relative.parts) or exclude_public and relative.parts[:3] == ('App', 'App', 'public'):
            continue
        if item.is_symlink():
            raise RuntimeError('不打包符号链接: ' + str(relative))
        if item.is_file():
            entries[(prefix / relative).as_posix()] = item

project = mobile / 'ios'
if not (project / 'App/App.xcodeproj/project.pbxproj').is_file():
    raise RuntimeError('请先生成完整苹果工程')
add_tree(project, Path('mobile/ios'), exclude_public=True)
# Replace generated public assets in the archive with only the current build.
add_tree(mobile / 'dist', Path('mobile/ios/App/App/public'))
for plugin in ['filesystem', 'share']:
    add_tree(mobile / 'node_modules/@capacitor' / plugin, Path('mobile/node_modules/@capacitor') / plugin)
for filename in ['手机端使用说明.txt', 'capacitor.config.ts', 'package.json', 'package-lock.json']:
    entries['mobile/' + filename] = mobile / filename

instructions = '''鑫金源珠宝 · 苹果工程交付说明

这是完整的 Xcode 工程，不是可以直接安装到 iPhone 的 IPA。
已包含当前界面、所有报价功能、品牌图标、离线资源、局域网权限、图片保存／分享插件。
适用 iOS 15.4 及以上。

在 Mac 上打包：
1. 安装 Xcode 26 或更新版本及其命令行工具。
2. 完整解压；保留 mobile/ios 与 mobile/node_modules 的相对位置。
3. 打开 mobile/ios/App/App.xcodeproj。
4. 第一次由 Xcode 获取固定版本的 Capacitor 8.5.3 框架依赖。此下载只用于开发打包。
5. 在 App → Signing & Capabilities 中选择自己的 Apple 开发团队，按设备或分发方式完成签名。
6. 连接 iPhone 进行编译安装，或使用 Product → Archive 按授权分发方式导出签名安装包。
7. 首次打开时允许连接本地网络，再按手机端使用说明连接店内电脑。

日常使用不依赖互联网；店内电脑主机须保持运行。
此工程尚未在 Mac / iPhone 编译或真机测试，需完成上面的签名安装和实际连接验证。
打印目前仍在 Windows 主机操作。无默认账号、客户资料、密码或签名私钥。
'''
with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED, compresslevel=9, strict_timestamps=False) as archive:
    for name, item in entries.items():
        if re.search(r'(?:\.p12|\.jks|\.keystore|\.db|\.sqlite|signing\.local\.json)$', name, re.I):
            raise RuntimeError('拒绝打包私有资料: ' + name)
        archive.write(item, name)
    archive.writestr('苹果工程打包说明.txt', instructions.encode('utf-8'))
with zipfile.ZipFile(target) as archive:
    if archive.testzip() is not None:
        raise RuntimeError('苹果工程压缩包损坏')
    data = json.loads(archive.read('mobile/ios/App/App/capacitor.config.json'))
    assert data['appId'] == 'cn.xjy.jewelry.mobile' and 'FilesystemPlugin' in data['packageClassList'] and 'SharePlugin' in data['packageClassList']
    index = archive.read('mobile/ios/App/App/public/index.html').decode()
    for asset in re.findall(r'(?:src|href)="(/[^\"]+)"', index):
        assert 'mobile/ios/App/App/public' + asset in archive.namelist(), asset
print(json.dumps({'path': str(target), 'bytes': target.stat().st_size, 'files': len(entries) + 1, 'compiled_ipa': False}, ensure_ascii=False))
