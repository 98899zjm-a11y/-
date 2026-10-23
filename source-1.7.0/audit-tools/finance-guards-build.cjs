'use strict';
// Static compiler only. This file never imports the generated business code.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const guard = require('../stage1/isolation.cjs').createIsolationGuard(root);
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--dependencies-root' || !path.isAbsolute(args[1])) throw Error('Usage: node audit-tools/finance-guards-build.cjs --dependencies-root <absolute approved node_modules>');
const deps = fs.realpathSync.native(args[1]);
const inside = (base, file) => { const rel = path.relative(base, file); return rel === '' || rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel); };
const project = guard.assertPath(path.join(root, 'project'));
const output = guard.assertPath(path.join(__dirname, 'finance-guards-generated'));
const sourceFiles = ['project/lib/domain.ts', 'project/lib/server.ts', 'project/components/quote-card.tsx', 'project/desktop/customer-identity.cjs', 'project/tsconfig.json'];
const sourceHashes = new Map(sourceFiles.map(file => [file, digest(fs.readFileSync(guard.assertPath(path.join(root, file))))]));
const esbuild = require(path.join(deps, 'esbuild'));
const zod = JSON.parse(fs.readFileSync(path.join(deps, 'zod/package.json'), 'utf8'));
if (zod.version !== '3.25.76' || zod.license !== 'MIT') throw Error('Reviewed existing Zod 3.25.76 MIT dependency required');
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const modules = {};
  for (const [name, source] of [['domain', 'lib/domain.ts'], ['server', 'lib/server.ts'], ['preview', 'components/quote-card.tsx']]) {
    const result = await esbuild.build({
      absWorkingDir: project, entryPoints: [guard.assertPath(path.join(project, source))],
      bundle: true, write: false, metafile: true, platform: 'node', format: 'cjs',
      target: 'node22', jsx: 'automatic', loader: { '.css': 'empty' },
      tsconfig: guard.assertPath(path.join(project, 'tsconfig.json')), nodePaths: [deps], logLevel: 'warning',
      plugins: [{ name: 'finance-synthetic-context', setup(build) {
        build.onLoad({ filter: /.*/, namespace: 'file' }, entry => {
          if (!inside(project, entry.path)) return;
          const file = guard.assertPath(entry.path), bytes = fs.readFileSync(file);
          const relative = path.relative(root, file).replaceAll('\\', '/'), sha256 = digest(bytes);
          if (sourceHashes.has(relative) && sourceHashes.get(relative) !== sha256) throw Error('Source changed during static compilation: ' + relative);
          sourceHashes.set(relative, sha256);
          const loader = { '.ts': 'ts', '.tsx': 'tsx', '.js': 'js', '.mjs': 'js', '.cjs': 'js', '.json': 'json', '.css': 'empty' }[path.extname(file).toLowerCase()];
          if (!loader) throw Error('Unreviewed project source type: ' + relative);
          // Supply exactly the hashed bytes; do not let a later read race the
          // source provenance, including new helper imports and empty CSS.
          return { contents: bytes, loader, resolveDir: path.dirname(file) };
        });
        build.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'env', namespace: 'finance-fixture' }));
        build.onResolve({ filter: /^@\/app\/chatgpt-auth$/ }, () => ({ path: 'identity', namespace: 'finance-fixture' }));
        build.onLoad({ filter: /.*/, namespace: 'finance-fixture' }, entry => ({
          contents: entry.path === 'env'
            ? 'export const env = new Proxy({}, { get(_target,key) { if (!globalThis.__financeGuardFixture) throw Error("Synthetic context missing"); return globalThis.__financeGuardFixture.env[key]; } });'
            : 'export async function getChatGPTUser() { if (!globalThis.__financeGuardFixture) throw Error("Synthetic context missing"); return globalThis.__financeGuardFixture.identity; }',
          loader: 'js',
        }));
      } }],
    });
    for (const input of Object.keys(result.metafile.inputs)) {
      if (input.startsWith('finance-fixture:')) continue;
      const file = path.resolve(project, input);
      if (inside(project, file)) {
        guard.assertPath(file);
        if (!sourceHashes.has(path.relative(root, file).replaceAll('\\', '/'))) throw Error('Compiler consumed an unproven project input: ' + input);
      } else if (!inside(deps, fs.realpathSync.native(file))) throw Error('Compiler input escaped approved source/dependencies: ' + input);
    }
    if (result.outputFiles.length !== 1) throw Error('Unexpected compiler output count');
    const file = name + '.cjs';
    const destination = guard.assertPath(path.join(output, file));
    fs.writeFileSync(destination, result.outputFiles[0].contents);
    modules[name] = { file, sha256: digest(result.outputFiles[0].contents) };
  }
  const sources = [...sourceHashes].sort(([left], [right]) => left.localeCompare(right)).map(([file, sha256]) => ({ file, sha256 }));
  for (const item of sources) if (digest(fs.readFileSync(guard.assertPath(path.join(root, item.file)))) !== item.sha256) throw Error('Source changed during static compilation');
  const manifest = { version: 1, purpose: 'finance-guards-synthetic-only', compiler: { esbuild: esbuild.version, zod: zod.version }, sources, modules, businessExecuted: false, databaseOpened: false, servicesStarted: false };
  fs.writeFileSync(guard.assertPath(path.join(output, 'manifest.json')), JSON.stringify(manifest, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ output, modules, businessExecuted: false, databaseOpened: false, servicesStarted: false }) + '\n');
})().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
