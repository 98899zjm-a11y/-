import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import path from "node:path";

// Build-only dependency access. Runtime business code always stays in this
// checked-out project; no old desktop source or shared dependency cache is used.
const dependencyRoot = process.env.XJY_BUILD_DEPENDENCIES_ROOT;
if (dependencyRoot && (!path.isAbsolute(dependencyRoot) || path.basename(dependencyRoot).toLowerCase() !== 'node_modules')) throw new Error('Explicit validated node_modules build root required');
const dependencyRequire = dependencyRoot ? createRequire(path.join(dependencyRoot, '__xjy_build__.cjs')) : null;
const dependencyNames = new Set(['react','react-dom','lucide-react','zod','recharts','html2canvas','html-to-image','clsx','tailwind-merge','class-variance-authority','@radix-ui/react-slot']);
const cssAliases = dependencyRequire ? { tailwindcss: dependencyRequire.resolve('tailwindcss/index.css'), 'tw-animate-css': path.join(dependencyRoot!, 'tw-animate-css/dist/tw-animate.css') } : {};

export default {
  root: fileURLToPath(new URL("./renderer", import.meta.url)),
  base: "/",
  publicDir: fileURLToPath(new URL("../public", import.meta.url)),
  plugins: dependencyRequire ? [{
    name: 'xjy-readonly-build-dependencies', enforce: 'pre' as const,
    resolveId(this: { resolve: (id: string, importer: string, options: object) => unknown }, source: string, _importer: string | undefined, options: object) {
      const name=source.startsWith('@')?source.split('/').slice(0,2).join('/'):source.split('/')[0];
      // Keep the approved dependency root while preserving Vite's browser/import
      // conditions. Node require.resolve forces avoidable CommonJS entry points.
      return dependencyNames.has(name) ? this.resolve(source, path.join(dependencyRoot!, '__xjy_build__.mjs'), { ...options, skipSelf: true }) : null;
    },
  }] : [],
  oxc: { jsx: { runtime: 'automatic' as const } },
  resolve: { alias: { "@": fileURLToPath(new URL("..", import.meta.url)), ...cssAliases } },
  css: { postcss: dependencyRequire ? { plugins: [dependencyRequire('@tailwindcss/postcss')({ base: fileURLToPath(new URL('..', import.meta.url)) })] } : fileURLToPath(new URL("..", import.meta.url)) },
  build: { outDir: fileURLToPath(new URL("./renderer-dist", import.meta.url)), emptyOutDir: true, rolldownOptions: { input: { main: fileURLToPath(new URL('./renderer/index.html', import.meta.url)), browser: fileURLToPath(new URL('./renderer/browser.html', import.meta.url)), central: fileURLToPath(new URL('./renderer/central.html', import.meta.url)), print: fileURLToPath(new URL('./renderer/print.html', import.meta.url)) } } },
};
