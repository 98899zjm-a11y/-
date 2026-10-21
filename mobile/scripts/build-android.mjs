import { randomBytes, createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const mobile = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(mobile, '..');
const javaHome = process.env.JAVA_HOME, sdk = process.env.ANDROID_HOME;
if (!javaHome || !sdk) throw new Error('请先设置 JAVA_HOME (Java 21) 和 ANDROID_HOME (Android SDK 36)');
const android = join(mobile, 'android');
const signing = join(mobile, 'signing');
mkdirSync(signing, { recursive: true });
const credentialsFile = join(signing, 'signing.local.json');
const keyFile = join(signing, 'xjy-mobile.p12');
let credentials;
if (existsSync(credentialsFile)) credentials = JSON.parse(readFileSync(credentialsFile, 'utf8'));
else {
  if (existsSync(keyFile)) throw new Error('签名密钥已存在但密码文件缺失，请恢复原密码文件，不能生成替代密钥');
  credentials = { password: randomBytes(36).toString('base64url') };
  writeFileSync(credentialsFile, JSON.stringify(credentials), { mode: 0o600, flag: 'wx' });
}
if (!/^[A-Za-z0-9_-]{48}$/.test(credentials.password)) throw new Error('签名密码文件无效');
const env = { ...process.env, XJY_ANDROID_KEYSTORE: keyFile, XJY_ANDROID_STORE_PASSWORD: credentials.password, PATH: join(javaHome, 'bin') + ';' + process.env.PATH };
function run(executable, args, cwd = mobile) {
  const result = spawnSync(executable, args, { cwd, env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('编译步骤失败: ' + executable);
}
if (!existsSync(keyFile)) {
  run(join(javaHome, 'bin', 'keytool.exe'), ['-genkeypair', '-keystore', keyFile, '-storetype', 'PKCS12', '-storepass:env', 'XJY_ANDROID_STORE_PASSWORD', '-keypass:env', 'XJY_ANDROID_STORE_PASSWORD', '-alias', 'xjy-mobile', '-keyalg', 'RSA', '-keysize', '3072', '-validity', '10000', '-dname', 'CN=XJY Jewelry Mobile, O=XJY, C=CN', '-noprompt']);
}
run(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build', '--config', 'vite.config.ts']);
run(process.execPath, [join(mobile, 'node_modules/@capacitor/cli/bin/capacitor'), 'sync', 'android']);
run(process.execPath, [join(mobile, 'scripts/configure-native.mjs')]);
run(process.execPath, [join(mobile, 'scripts/make-brand-assets.cjs'), '--copy-native']);
writeFileSync(join(android, 'local.properties'), 'sdk.dir=' + sdk.replaceAll('\\', '/') + '\n');
// cmd only executes the trusted Gradle batch file; no user input is interpolated.
// Android tooling on Windows rejects Chinese project paths. Compile an isolated
// copy of native sources; the user's checkout and previous builds stay intact.
const stageParent = process.env.XJY_ANDROID_BUILD_ROOT || join(tmpdir(), 'xjy-mobile-build');
mkdirSync(stageParent, { recursive: true });
const stage = mkdtempSync(join(stageParent, 'release-'));
if (/[^\x00-\x7f]/.test(stage)) throw new Error('请将 XJY_ANDROID_BUILD_ROOT 指向仅含英文的编译目录');
const stageAndroid = join(stage, 'android');
cpSync(android, stageAndroid, { recursive: true, filter: path => !['build', '.gradle'].includes(path.split(/[\\/]/).at(-1)) });
for (const plugin of ['android', 'filesystem', 'share']) cpSync(join(mobile, 'node_modules/@capacitor', plugin), join(stage, 'node_modules/@capacitor', plugin), { recursive: true });
run('cmd.exe', ['/d', '/s', '/c', 'gradlew.bat assembleRelease --no-daemon --console=plain --max-workers=2'], stageAndroid);
const apk = join(stageAndroid, 'app/build/outputs/apk/release/app-release.apk');
if (!existsSync(apk)) throw new Error('未生成带签名的安装包');
run(join(javaHome, 'bin', 'java.exe'), ['-jar', join(sdk, 'build-tools/36.0.0/lib/apksigner.jar'), 'verify', '--verbose', apk]);
const output = resolve(process.env.XJY_MOBILE_OUTPUT || root);
mkdirSync(output, { recursive: true });
const target = join(output, '鑫金源珠宝-安卓手机版.apk');
copyFileSync(apk, target);
writeFileSync(target + '.sha256.txt', createHash('sha256').update(readFileSync(target)).digest('hex') + '  鑫金源珠宝-安卓手机版.apk\n');
console.log('安卓安装包已生成: ' + target);
