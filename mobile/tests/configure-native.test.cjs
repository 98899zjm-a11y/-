'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createRequire } = require('node:module');
const pluginRequire = createRequire(path.resolve(__dirname, '../package.json'));
const plist = pluginRequire('plist'), tar = pluginRequire('tar');
const { DOMParser } = pluginRequire('@xmldom/xmldom');
const loaded = import(pathToFileURL(path.resolve(__dirname, '../scripts/configure-native.mjs')).href);
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'xjy-native-config-'));
const temporary = name => fs.mkdtempSync(path.join(base, name + '-'));
const write = (root, filename, contents) => { const target = path.join(root, filename); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, contents); return target; };
const parseXml = file => new DOMParser().parseFromString(fs.readFileSync(file, 'utf8'), 'application/xml');
const androidNS = 'http://schemas.android.com/apk/res/android';

function androidFixture(root) {
  write(root, 'android/variables.gradle', 'ext { targetSdkVersion = 36 }');
  write(root, 'android/app/src/main/AndroidManifest.xml', `<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="${androidNS}"><uses-permission android:name="android.permission.INTERNET"/><uses-permission android:name="android.permission.INTERNET"/><uses-permission android:name="android.permission.ACCESS_LOCAL_NETWORK"/><uses-permission android:name="fixture.PERMISSION"/><application android:allowBackup="true" android:theme="@style/AppTheme"><activity android:name=".MainActivity" android:exported="true"/></application></manifest>`);
  write(root, 'android/app/src/main/res/values/styles.xml', '<resources><style name="AppTheme.NoActionBar"/><style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen"/></resources>');
}
test('Android36局域网配置幂等，权限/备份/文件分享范围正确且不动Gradle签名', async () => {
  const module = await loaded, root = temporary('android'); androidFixture(root);
  const gradle = write(root, 'android/app/build.gradle', 'versionName "1.0.0"\nsigningConfigs { release { storeFile file("fixture-keystore") } }');
  const originalGradle = fs.readFileSync(gradle, 'utf8');
  const first = await module.configureNative({ root }); assert.equal(first.android.targetSdk, 36);
  const manifestFile = path.join(root, 'android/app/src/main/AndroidManifest.xml'), document = parseXml(manifestFile);
  const permissions = Array.from(document.getElementsByTagName('uses-permission')).map(node => node.getAttributeNS(androidNS, 'name'));
  assert.equal(permissions.filter(name => name === 'android.permission.INTERNET').length, 1); assert.ok(!permissions.includes('android.permission.ACCESS_LOCAL_NETWORK')); assert.ok(permissions.includes('fixture.PERMISSION'));
  assert.ok(!permissions.includes('android.permission.READ_EXTERNAL_STORAGE')); assert.ok(!permissions.includes('android.permission.WRITE_EXTERNAL_STORAGE'));
  const application = document.getElementsByTagName('application')[0];
  assert.equal(application.getAttributeNS(androidNS, 'usesCleartextTraffic'), 'true'); assert.equal(application.getAttributeNS(androidNS, 'allowBackup'), 'false'); assert.equal(application.getAttributeNS(androidNS, 'fullBackupContent'), 'false');
  assert.equal(application.getAttributeNS(androidNS, 'networkSecurityConfig'), '@xml/network_security_config');
  assert.equal(document.getElementsByTagName('activity')[0].getAttributeNS(androidNS, 'exported'), 'true');
  const shares = parseXml(path.join(root, 'android/app/src/main/res/xml/file_paths.xml'));
  assert.equal(shares.getElementsByTagName('external-path').length, 0); assert.equal(shares.getElementsByTagName('cache-path')[0].getAttribute('path'), 'quotes/'); assert.equal(shares.getElementsByTagName('external-files-path')[0].getAttribute('path'), 'Pictures/');
  const second = await module.configureNative({ root }); assert.deepEqual(second.changed, []); assert.equal(fs.readFileSync(gradle, 'utf8'), originalGradle);
  assert.match(fs.readFileSync(path.join(root, 'android/app/src/main/res/values/styles.xml'), 'utf8'), /windowSplashScreenAnimatedIcon/);
});
test('不猜SDK37的新权限，不覆盖不完整iOS工程或坏XML', async () => {
  const module = await loaded, root = temporary('guards'); androidFixture(root);
  write(root, 'android/variables.gradle', 'targetSdkVersion = 37');
  const before = fs.readFileSync(path.join(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
  await assert.rejects(module.configureNative({ root }), /高于36/); assert.equal(fs.readFileSync(path.join(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8'), before);
  const other = temporary('badxml'), invalid = write(other, 'android/app/src/main/AndroidManifest.xml', '<manifest><application>');
  await assert.rejects(module.configureNative({ root: other })); assert.equal(fs.readFileSync(invalid, 'utf8'), '<manifest><application>');
  fs.mkdirSync(path.join(other, 'ios')); write(other, 'ios/my-existing-source.txt', 'keep this source');
  await assert.rejects(module.createIosSource(other), /不会覆盖/); assert.equal(fs.readFileSync(path.join(other, 'ios/my-existing-source.txt'), 'utf8'), 'keep this source');
});
test('仅安全解官方iOS SPM源码，ATS仅私网CIDR、插件/隐私manifest入target并保持幂等', async () => {
  const module = await loaded, root = temporary('ios');
  write(root, 'capacitor.config.ts', 'const config = {appId:"cn.fixture.mobile",appName:"测试珠宝"};');
  write(root, 'dist/index.html', '<html>offline fixture</html>');
  const first = await module.configureNative({ root, createIos: true }); assert.equal(first.iosCreated, true);
  const info = plist.parse(fs.readFileSync(path.join(root, 'ios/App/App/Info.plist'), 'utf8'));
  assert.equal(info.CFBundleDisplayName, '测试珠宝'); assert.ok(info.NSLocalNetworkUsageDescription.includes('店内'));
  assert.equal(info.NSAppTransportSecurity.NSAllowsArbitraryLoads, false); assert.equal(info.NSAppTransportSecurity.NSAllowsLocalNetworking, true);
  assert.deepEqual(Object.keys(info.NSAppTransportSecurity.NSExceptionDomains).sort(), ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'].sort());
  for (const value of Object.values(info.NSAppTransportSecurity.NSExceptionDomains)) assert.equal(value.NSExceptionAllowsInsecureHTTPLoads, true);
  assert.equal(info.UILaunchStoryboardName, 'LaunchScreen');
  const privacy = plist.parse(fs.readFileSync(path.join(root, 'ios/App/App/PrivacyInfo.xcprivacy'), 'utf8'));
  assert.deepEqual(privacy.NSPrivacyAccessedAPITypes[0].NSPrivacyAccessedAPITypeReasons, ['C617.1']);
  const project = fs.readFileSync(path.join(root, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8');
  assert.match(project, /PrivacyInfo\.xcprivacy in Resources/); assert.match(project, /PRODUCT_BUNDLE_IDENTIFIER = cn\.fixture\.mobile/);
  assert.ok(!project.includes('= undefined;')); assert.match(project, /MARKETING_VERSION = 1\.0\.0/);
  assert.ok(!project.includes('IPHONEOS_DEPLOYMENT_TARGET = 15.0')); assert.equal((project.match(/IPHONEOS_DEPLOYMENT_TARGET = 15\.4/g) || []).length, 4);
  const native = JSON.parse(fs.readFileSync(path.join(root, 'ios/App/App/capacitor.config.json'), 'utf8')); assert.deepEqual(native.packageClassList.sort(), ['FilesystemPlugin', 'SharePlugin'].sort());
  const swift = fs.readFileSync(path.join(root, 'ios/App/CapApp-SPM/Package.swift'), 'utf8'); assert.match(swift, /exact: "8\.5\.3"/); assert.ok(swift.includes('../../../node_modules/@capacitor/filesystem')); assert.ok(swift.includes('CapacitorShare'));
  assert.ok(swift.includes('platforms: [.iOS("15.4")]'));
  assert.equal(fs.readFileSync(path.join(root, 'ios/App/App/public/index.html'), 'utf8'), '<html>offline fixture</html>');
  const again = await module.configureNative({ root, createIos: true }); assert.equal(again.iosCreated, false); assert.deepEqual(again.changed, []);
});
test('iOS已有Info/隐私其他声明保留，宽松公网ATS被收窄，不生成签名或调用Mac工具', async () => {
  const module = await loaded, root = temporary('preserve'); await module.createIosSource(root);
  const infoFile = path.join(root, 'ios/App/App/Info.plist'), original = plist.parse(fs.readFileSync(infoFile, 'utf8'));
  original.CustomFixture = { nested: 'kept' }; original.NSAppTransportSecurity = { NSAllowsArbitraryLoads: true, NSExceptionDomains: { 'evil.example': { NSExceptionAllowsInsecureHTTPLoads: true } } }; fs.writeFileSync(infoFile, plist.build(original));
  write(root, 'ios/App/App/PrivacyInfo.xcprivacy', plist.build({ NSPrivacyAccessedAPITypes: [{ NSPrivacyAccessedAPIType: 'FixtureCategory', NSPrivacyAccessedAPITypeReasons: ['fixture'] }] }));
  await module.configureNative({ root });
  const info = plist.parse(fs.readFileSync(infoFile, 'utf8')); assert.deepEqual(info.CustomFixture, { nested: 'kept' }); assert.equal(info.NSAppTransportSecurity.NSExceptionDomains['evil.example'], undefined);
  const privacy = plist.parse(fs.readFileSync(path.join(root, 'ios/App/App/PrivacyInfo.xcprivacy'), 'utf8')); assert.equal(privacy.NSPrivacyAccessedAPITypes[0].NSPrivacyAccessedAPIType, 'FixtureCategory'); assert.equal(privacy.NSPrivacyAccessedAPITypes.length, 2);
  assert.ok(!fs.existsSync(path.join(root, 'ios/App/Podfile'))); assert.ok(!fs.existsSync(path.join(root, 'ios/App/App.xcarchive')));
});
test('拒绝tar路径穿越与符号链接，且不解包到工程以外', async () => {
  const module = await loaded, root = temporary('tar-guard'), files = path.join(root, 'fixture'); fs.mkdirSync(files); fs.writeFileSync(path.join(files, 'file.txt'), 'fixture');
  const archive = path.join(root, 'evil.tar.gz'); await tar.c({ cwd: files, file: archive, gzip: true, preservePaths: true, prefix: '../outside' }, ['file.txt']);
  await assert.rejects(module.createIosSource(root, { templateArchive: archive }), /越界/); assert.ok(!fs.existsSync(path.join(root, 'ios'))); assert.ok(!fs.existsSync(path.join(root, 'outside')));
});
test('原生目标目录junction不能把配置写到别的目录', async t => {
  const module = await loaded, root = temporary('link-guard'), external = temporary('external');
  fs.mkdirSync(path.join(root, 'android/app/src/main'), { recursive: true });
  write(external, 'AndroidManifest.xml', `<manifest xmlns:android="${androidNS}"><application/></manifest>`);
  try { fs.symlinkSync(external, path.join(root, 'android/app/src/main/res'), 'junction'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('当前系统不允许建立junction测试'); return; } throw error; }
  write(root, 'android/app/src/main/AndroidManifest.xml', `<manifest xmlns:android="${androidNS}"><application/></manifest>`);
  await assert.rejects(module.configureNative({ root }), /符号链接/); assert.ok(!fs.existsSync(path.join(external, 'xml/network_security_config.xml')));
});
