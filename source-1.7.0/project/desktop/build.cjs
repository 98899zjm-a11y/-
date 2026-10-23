'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));

async function buildDesktop() {
  fs.mkdirSync(path.join(__dirname, 'generated'), { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(root, 'lib', 'server.ts')],
    outfile: path.join(__dirname, 'generated', 'business.cjs'),
    bundle: true, platform: 'node', format: 'cjs', target: 'node22', logLevel: 'warning',
    tsconfig: path.join(root, 'tsconfig.json'),
    plugins: [{
      name: 'offline-platform',
      setup(build) {
        build.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'env', namespace: 'offline-platform' }));
        build.onResolve({ filter: /^@\/app\/chatgpt-auth$/ }, () => ({ path: path.join(root, 'lib/platform/desktop-identity.ts') }));
        build.onLoad({ filter: /^env$/, namespace: 'offline-platform' }, () => ({
          contents: 'export const env = new Proxy({}, {get(_target,key){return globalThis.__xjyDesktopContext().env[key]}});',
          loader: 'js'
        }));
        build.onLoad({ filter: /[\\/]lib[\\/]server\.ts$/ }, args => ({
          contents: fs.readFileSync(args.path, 'utf8').replace('请先使用ChatGPT账号登录', '请先登录本机账号').replace('数据库尚未连接，请完成部署配置', '本机数据库尚未打开').replace('图片存储尚未连接，请完成部署配置', '本机图片目录尚未打开'),
          loader: 'ts', resolveDir: path.dirname(args.path)
        }));
      }
    }]
  });
  fs.mkdirSync(path.join(__dirname, 'migrations'), { recursive: true });
  await esbuild.build({ entryPoints: [path.join(__dirname, 'renderer/warranty-data.ts')], outfile: path.join(__dirname, 'generated/print-domain.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22', logLevel: 'warning', tsconfig: path.join(root, 'tsconfig.json') });
  for (const name of fs.readdirSync(path.join(root, 'drizzle')).filter(name => name.endsWith('.sql'))) fs.copyFileSync(path.join(root, 'drizzle', name), path.join(__dirname, 'migrations', name));
  if (process.argv.includes('--backend-only')) { process.stdout.write('Offline business core built.\n'); return; }
  const vite = await import(pathToFileURL(path.join(root, 'node_modules', 'vite', 'dist', 'node', 'index.js')).href);
  await vite.build({ configFile: path.join(__dirname, 'vite.config.ts') });
  process.stdout.write('Offline desktop assets and business core built.\n');
}
buildDesktop().catch(error => { console.error(error); process.exitCode = 1; });
