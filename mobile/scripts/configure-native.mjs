import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

// These parsers are installed with the pinned Capacitor CLI; no global tools,
// macOS commands, package installation or network calls are made here.
const require = createRequire(import.meta.url);
const plist = require('plist');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const tar = require('tar');
const xcode = require('xcode');
const PbxFile = require('xcode/lib/pbxFile');
const androidNS = 'http://schemas.android.com/apk/res/android';
const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const privateRanges = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'];

function inside(root, file) { const relative = path.relative(root, file); return relative === '' || !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative); }
function safePath(root, ...parts) {
  const result = path.resolve(root, ...parts);
  if (!inside(root, result)) throw new Error('原生配置目标超出手机工程');
  let current = result;
  while (inside(root, current)) {
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error('原生配置不能写入符号链接'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (current === root) break;
    current = path.dirname(current);
  }
  return result;
}
function xml(text) {
  const errors = [];
  const document = new DOMParser({ onError: (level, message) => errors.push(level + ': ' + message) }).parseFromString(text, 'application/xml');
  if (errors.length || !document.documentElement) throw new Error('原生XML格式无效，已停止配置');
  return document;
}
function elements(parent, tag) { return [...Array.from(parent.childNodes)].filter(node => node.nodeType === 1 && (!tag || node.tagName === tag)); }
function serialize(document) { return new XMLSerializer().serializeToString(document) + '\n'; }
function writeChanged(root, target, content, changed) {
  safePath(root, target);
  const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
  if (fs.existsSync(target) && fs.readFileSync(target).equals(bytes)) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
  changed.push(path.relative(root, target).replaceAll('\\', '/'));
}
function copyTree(root, source, target, changed) {
  if (!fs.existsSync(source)) return;
  if (!fs.statSync(source).isDirectory() || fs.lstatSync(source).isSymbolicLink()) throw new Error('原生资源目录无效');
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('原生资源不接受符号链接');
    const nextSource = path.join(source, entry.name), nextTarget = safePath(root, target, entry.name);
    if (entry.isDirectory()) copyTree(root, nextSource, nextTarget, changed);
    else if (entry.isFile()) writeChanged(root, nextTarget, fs.readFileSync(nextSource), changed);
  }
}

export function configureAndroid(root, changed = []) {
  const manifest = safePath(root, 'android/app/src/main/AndroidManifest.xml');
  if (!fs.existsSync(manifest)) return { skipped: true };
  const document = xml(fs.readFileSync(manifest, 'utf8')), top = document.documentElement;
  if (top.tagName !== 'manifest') throw new Error('AndroidManifest根节点无效');
  const application = elements(top, 'application')[0];
  if (!application) throw new Error('AndroidManifest缺少application');
  const variables = safePath(root, 'android/variables.gradle');
  const targetSdk = Number(fs.existsSync(variables) ? /targetSdkVersion\s*=\s*(\d+)/.exec(fs.readFileSync(variables, 'utf8'))?.[1] || 36 : 36);
  if (targetSdk > 36) throw new Error('目标SDK高于36，请先按新版Android局域网权限规则更新配置脚本');
  const permissions = elements(top, 'uses-permission');
  const internet = permissions.filter(node => node.getAttributeNS(androidNS, 'name') === 'android.permission.INTERNET');
  if (!internet.length) { const permission = document.createElement('uses-permission'); permission.setAttributeNS(androidNS, 'android:name', 'android.permission.INTERNET'); top.appendChild(permission); }
  for (const duplicate of internet.slice(1)) top.removeChild(duplicate);
  for (const permission of permissions) if (permission.getAttributeNS(androidNS, 'name') === 'android.permission.ACCESS_LOCAL_NETWORK') top.removeChild(permission);
  application.setAttributeNS(androidNS, 'android:usesCleartextTraffic', 'true');
  application.setAttributeNS(androidNS, 'android:networkSecurityConfig', '@xml/network_security_config');
  application.setAttributeNS(androidNS, 'android:allowBackup', 'false');
  application.setAttributeNS(androidNS, 'android:fullBackupContent', 'false');
  writeChanged(root, manifest, serialize(document), changed);
  // Android domain rules cannot express a user-configurable RFC1918 CIDR host.
  // The native bridge rejects non-private IPs and redirects before native HTTP;
  // all business payloads additionally use pinned X25519 + AES-256-GCM.
  writeChanged(root, safePath(root, 'android/app/src/main/res/xml/network_security_config.xml'), '<?xml version="1.0" encoding="utf-8"?>\n<network-security-config>\n    <base-config cleartextTrafficPermitted="true" />\n</network-security-config>\n', changed);
  // Export only explicit quote shares and app-private camera capture files.
  // No shared external-storage root is exposed by the FileProvider.
  writeChanged(root, safePath(root, 'android/app/src/main/res/xml/file_paths.xml'), '<?xml version="1.0" encoding="utf-8"?>\n<paths xmlns:android="http://schemas.android.com/apk/res/android">\n    <cache-path name="quote_images" path="quotes/" />\n    <external-files-path name="capture_images" path="Pictures/" />\n</paths>\n', changed);
  const stylesFile = safePath(root, 'android/app/src/main/res/values/styles.xml');
  if (fs.existsSync(stylesFile)) {
    const styles = xml(fs.readFileSync(stylesFile, 'utf8')), launch = elements(styles.documentElement, 'style').find(style => style.getAttribute('name') === 'AppTheme.NoActionBarLaunch');
    if (launch) {
      for (const [name, value] of [['windowSplashScreenBackground', '#FFFFFF'], ['windowSplashScreenAnimatedIcon', '@drawable/ic_launcher_foreground'], ['postSplashScreenTheme', '@style/AppTheme.NoActionBar']]) {
        let item = elements(launch, 'item').find(node => node.getAttribute('name') === name);
        if (!item) { item = styles.createElement('item'); item.setAttribute('name', name); launch.appendChild(item); }
        while (item.firstChild) item.removeChild(item.firstChild); item.appendChild(styles.createTextNode(value));
      }
      writeChanged(root, stylesFile, serialize(styles), changed);
    }
  }
  copyTree(root, safePath(root, 'assets/android/res'), safePath(root, 'android/app/src/main/res'), changed);
  return { skipped: false, targetSdk };
}

export async function createIosSource(root, { templateArchive } = {}) {
  const ios = safePath(root, 'ios');
  if (fs.existsSync(ios)) {
    if (!fs.existsSync(safePath(root, 'ios/App/App/Info.plist'))) throw new Error('已有iOS目录不完整，请先检查；不会覆盖现有工程');
    return false;
  }
  const archive = templateArchive || path.join(defaultRoot, 'node_modules/@capacitor/cli/assets/ios-spm-template.tar.gz');
  let unsafe = '', total = 0, count = 0;
  await tar.t({ file: archive, strict: true, onReadEntry(entry) {
    const value = entry.path;
    if (/[\\:\x00-\x1f]/.test(value) || path.posix.isAbsolute(value) || value.split('/').includes('..') || !['File', 'OldFile', 'Directory'].includes(entry.type)) unsafe = value;
    total += entry.size || 0; count++;
  } });
  if (unsafe || total > 300 * 1024 * 1024 || count > 10000) throw new Error('iOS模板含越界路径/链接或体积异常，已拒绝解包');
  const stage = fs.mkdtempSync(safePath(root, '.ios-stage-'));
  await tar.x({ file: archive, cwd: stage, strict: true, preservePaths: false });
  if (!fs.existsSync(safePath(root, stage, 'App/App/Info.plist'))) throw new Error('iOS模板缺少完整App工程');
  // Both resolved move targets are verified to stay inside the mobile workspace.
  safePath(root, stage); safePath(root, ios); fs.renameSync(stage, ios);
  return true;
}

function nativeIdentity(root, options) {
  const configFile = safePath(root, 'capacitor.config.ts');
  const source = fs.existsSync(configFile) ? fs.readFileSync(configFile, 'utf8') : '';
  const appId = options.appId || /appId:\s*["']([^"']+)["']/.exec(source)?.[1] || 'cn.xjy.jewelry.mobile';
  const appName = options.appName || /appName:\s*["']([^"']+)["']/.exec(source)?.[1] || '鑫金源珠宝';
  if (!/^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*)+$/.test(appId) || appName.length > 80 || /[\x00-\x1f]/.test(appName)) throw new Error('应用名称或bundle标识无效');
  return { appId, appName };
}
export function configureIos(root, changed = [], options = {}) {
  const infoFile = safePath(root, 'ios/App/App/Info.plist');
  if (!fs.existsSync(infoFile)) return { skipped: true };
  const identity = nativeIdentity(root, options), info = plist.parse(fs.readFileSync(infoFile, 'utf8'));
  info.CFBundleDisplayName = identity.appName;
  info.NSLocalNetworkUsageDescription = '用于连接店内珠宝报价电脑主机，读取和保存你有权限的客户、报价和图片。';
  info.NSCameraUsageDescription ||= '用于拍摄珠宝商品或客户确认图片。';
  info.NSPhotoLibraryUsageDescription ||= '用于选择珠宝商品图片和客户确认截图。';
  info.NSPhotoLibraryAddUsageDescription ||= '用于把你选择的珠宝报价图片保存到相册。';
  // Apple documents IP/CIDR ATS exceptions from iOS 17. Older supported iOS
  // versions already permit local IP connections; no global arbitrary loads.
  info.NSAppTransportSecurity = {
    NSAllowsArbitraryLoads: false, NSAllowsLocalNetworking: true,
    NSExceptionDomains: Object.fromEntries(privateRanges.map(range => [range, { NSExceptionAllowsInsecureHTTPLoads: true }])),
  };
  writeChanged(root, infoFile, plist.build(info) + '\n', changed);
  const privacyFile = safePath(root, 'ios/App/App/PrivacyInfo.xcprivacy');
  const privacy = fs.existsSync(privacyFile) ? plist.parse(fs.readFileSync(privacyFile, 'utf8')) : {};
  privacy.NSPrivacyAccessedAPITypes ||= [];
  let timestamps = privacy.NSPrivacyAccessedAPITypes.find(entry => entry.NSPrivacyAccessedAPIType === 'NSPrivacyAccessedAPICategoryFileTimestamp');
  if (!timestamps) { timestamps = { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp', NSPrivacyAccessedAPITypeReasons: [] }; privacy.NSPrivacyAccessedAPITypes.push(timestamps); }
  timestamps.NSPrivacyAccessedAPITypeReasons ||= []; if (!timestamps.NSPrivacyAccessedAPITypeReasons.includes('C617.1')) timestamps.NSPrivacyAccessedAPITypeReasons.push('C617.1');
  writeChanged(root, privacyFile, plist.build(privacy) + '\n', changed);
  const projectFile = safePath(root, 'ios/App/App.xcodeproj/project.pbxproj');
  if (fs.existsSync(projectFile)) {
    const original = fs.readFileSync(projectFile, 'utf8'), project = xcode.project(projectFile); project.parseSync();
    const group = project.findPBXGroupKey({ path: 'App' }) || project.findPBXGroupKey({ name: 'App' });
    if (!group) throw new Error('Xcode项目缺少App资源组');
    if (!project.hasFile('PrivacyInfo.xcprivacy')) {
      // Capacitor's template has an App group but no Resources group; the xcode
      // helper's addResourceFile assumes a Resources group and cannot be used.
      const file = new PbxFile('PrivacyInfo.xcprivacy', {});
      file.uuid = project.generateUuid(); file.fileRef = project.generateUuid(); file.target = project.getFirstTarget().uuid; file.lastKnownFileType = 'text.xml';
      project.addToPbxBuildFileSection(file); project.addToPbxResourcesBuildPhase(file); project.addToPbxFileReferenceSection(file); project.addToPbxGroup(file, group);
    }
    for (const [id, config] of Object.entries(project.pbxXCBuildConfigurationSection())) if (!id.endsWith('_comment') && config.buildSettings) {
      if (config.buildSettings.PRODUCT_BUNDLE_IDENTIFIER) { config.buildSettings.PRODUCT_BUNDLE_IDENTIFIER = identity.appId; config.buildSettings.MARKETING_VERSION = '1.0.0'; }
      if (config.buildSettings.IPHONEOS_DEPLOYMENT_TARGET) config.buildSettings.IPHONEOS_DEPLOYMENT_TARGET = '15.4';
    }
    for (const [id, reference] of Object.entries(project.pbxFileReferenceSection())) if (!id.endsWith('_comment') && reference && typeof reference === 'object') {
      for (const key of ['fileEncoding', 'explicitFileType']) if (reference[key] === undefined || reference[key] === 'undefined') delete reference[key];
    }
    const text = project.writeSync();
    if (text !== original) writeChanged(root, projectFile, text, changed);
  }
  const iosVersionFile = path.join(defaultRoot, 'node_modules/@capacitor/ios/package.json');
  const iosVersion = JSON.parse(fs.readFileSync(iosVersionFile, 'utf8')).version;
  const packageDir = safePath(root, 'ios/App/CapApp-SPM'), packageFile = safePath(root, packageDir, 'Package.swift');
  if (fs.existsSync(packageFile)) {
    const dependencies = ['.package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "' + iosVersion + '")'], products = ['.product(name: "Capacitor", package: "capacitor-swift-pm")', '.product(name: "Cordova", package: "capacitor-swift-pm")'];
    for (const [folder, name] of [['filesystem', 'CapacitorFilesystem'], ['share', 'CapacitorShare']]) {
      const dependency = safePath(root, 'node_modules/@capacitor/' + folder);
      const relative = path.relative(packageDir, dependency).replaceAll('\\', '/');
      dependencies.push(`.package(name: "${name}", path: "${relative}")`); products.push(`.product(name: "${name}", package: "${name}")`);
    }
    writeChanged(root, packageFile, `// swift-tools-version: 5.9\nimport PackageDescription\n\n// Generated by configure-native.mjs; native packages are build-time only.\nlet package = Package(\n    name: "CapApp-SPM",\n    platforms: [.iOS("15.4")],\n    products: [.library(name: "CapApp-SPM", targets: ["CapApp-SPM"])],\n    dependencies: [\n        ${dependencies.join(',\n        ')}\n    ],\n    targets: [.target(name: "CapApp-SPM", dependencies: [\n        ${products.join(',\n        ')}\n    ])]\n)\n`, changed);
  }
  const nativeConfigFile = safePath(root, 'ios/App/App/capacitor.config.json');
  const nativeConfig = fs.existsSync(nativeConfigFile) ? JSON.parse(fs.readFileSync(nativeConfigFile, 'utf8')) : { appId: identity.appId, appName: identity.appName, webDir: 'dist', server: { hostname: 'localhost', androidScheme: 'https' } };
  nativeConfig.packageClassList = [...new Set([...(nativeConfig.packageClassList || []), 'FilesystemPlugin', 'SharePlugin'])];
  writeChanged(root, nativeConfigFile, JSON.stringify(nativeConfig, null, 2) + '\n', changed);
  const cordovaConfig = safePath(root, 'ios/App/App/config.xml');
  if (!fs.existsSync(cordovaConfig)) writeChanged(root, cordovaConfig, '<?xml version="1.0" encoding="UTF-8"?>\n<widget xmlns="http://www.w3.org/ns/widgets" version="1.0.0"><access origin="*" /></widget>\n', changed);
  copyTree(root, safePath(root, 'dist'), safePath(root, 'ios/App/App/public'), changed);
  copyTree(root, safePath(root, 'assets/ios'), safePath(root, 'ios/App/App/Assets.xcassets'), changed);
  return { skipped: false, ...identity, sdk: iosVersion, privateRanges };
}
export async function configureNative({ root = defaultRoot, createIos = false, ...options } = {}) {
  root = fs.realpathSync(path.resolve(root));
  const changed = [];
  const iosCreated = createIos ? await createIosSource(root, options) : false;
  const android = configureAndroid(root, changed), ios = configureIos(root, changed, options);
  return { root, iosCreated, android, ios, changed };
}
async function main() {
  const args = process.argv.slice(2), value = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const result = await configureNative({ root: value('--root') || defaultRoot, createIos: args.includes('--create-ios') });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
