'use strict';
// Verification only: the sole non-builtin module loaded is the existing public
// TypeScript compiler. Project TS/JS files are parsed as text, never executed.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const PROJECT = path.join(ROOT, 'project');
const DEPENDENCIES = path.resolve('E:/珠宝销售软件/node_modules');
const COMPILER = path.join(DEPENDENCIES, 'typescript/lib/typescript.js');
const CONFIG = path.join(PROJECT, 'tsconfig.json');
const REPORTS = path.join(ROOT, 'reports');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const inside = (base, file) => { const rel = path.relative(base, file); return rel === '' || rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel); };
const slash = value => value.replaceAll('\\', '/');
function projectRelative(file) { return slash(path.relative(ROOT, file)); }
function allowed(file) { const absolute = path.resolve(file); return inside(PROJECT, absolute) || inside(DEPENDENCIES, absolute); }
function regularPath(file) {
  const absolute = path.resolve(file);
  if (!allowed(absolute)) return false;
  const boundary = inside(PROJECT, absolute) ? PROJECT : DEPENDENCIES;
  for (let current = absolute; ; current = path.dirname(current)) {
    try { if (fs.lstatSync(current).isSymbolicLink()) return false; } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error; }
    if (path.relative(boundary, current) === '') break;
    if (path.dirname(current) === current) return false;
  }
  return true;
}
for (const root of [ROOT, PROJECT, DEPENDENCIES]) if (!fs.statSync(root).isDirectory() || fs.lstatSync(root).isSymbolicLink()) throw Error('Static checker root must be an ordinary explicit directory');
if (!regularPath(COMPILER)) throw Error('Public compiler path rejected');
const compilerMetadata = JSON.parse(fs.readFileSync(path.join(DEPENDENCIES, 'typescript/package.json'), 'utf8'));
if (compilerMetadata.name !== 'typescript' || compilerMetadata.version !== '5.9.3' || compilerMetadata.license !== 'Apache-2.0') throw Error('Reviewed existing public TypeScript 5.9.3 compiler required');
const ts = require(COMPILER);
const git = args => childProcess.execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
// Keep the original pre-audit comparison after small optimization commits.
const baselineCommit = git(['rev-parse', 'e0b9464^{commit}']).trim();
const tracked = new Set(git(['ls-tree', '-r', '--name-only', baselineCommit, '--', 'project']).trim().split(/\r?\n/).filter(Boolean));
const headText = new Map();
const currentText = new Map();
const publicText = new Map();
let deniedPaths = 0;

function run(mode) {
  const baseline = mode === 'baseline';
  const readInputs = new Map(), packageFallbacks = new Set(), typeFallbacks = new Set();
  const isProject = file => inside(PROJECT, path.resolve(file));
  function fileExists(file) {
    if (!allowed(file)) { deniedPaths++; return false; }
    if (!regularPath(file)) return false;
    if (baseline && isProject(file)) return tracked.has(projectRelative(file));
    try { return fs.statSync(file).isFile(); } catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false; throw error; }
  }
  function readFile(file) {
    file = path.resolve(file);
    if (!fileExists(file)) return undefined;
    let text;
    if (isProject(file)) {
      const relative = projectRelative(file), cache = baseline ? headText : currentText;
      if (!cache.has(relative)) cache.set(relative, baseline ? git(['show', baselineCommit + ':' + relative]) : fs.readFileSync(file, 'utf8'));
      text = cache.get(relative);
    } else {
      if (!publicText.has(file)) publicText.set(file, fs.readFileSync(file, 'utf8'));
      text = publicText.get(file);
    }
    readInputs.set(file, sha(text));
    return text;
  }
  const directoryExists = file => {
    if (!allowed(file) || !regularPath(file)) return false;
    if (baseline && isProject(file)) { const prefix = projectRelative(file) + '/'; return [...tracked].some(name => name.startsWith(prefix)); }
    try { return fs.statSync(file).isDirectory(); } catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false; throw error; }
  };
  const getDirectories = file => {
    if (!directoryExists(file)) return [];
    return fs.readdirSync(file, { withFileTypes: true }).filter(item => item.isDirectory() && directoryExists(path.join(file, item.name))).map(item => item.name);
  };
  const readDirectory = (file, extensions, excludes, includes, depth) => {
    if (!directoryExists(file)) return [];
    return ts.sys.readDirectory(file, extensions, excludes, includes, depth).filter(candidate => fileExists(candidate));
  };
  const resolutionHost = { fileExists, readFile, directoryExists, getDirectories, realpath: file => regularPath(file) ? path.resolve(file) : file, useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames, getCurrentDirectory: () => PROJECT };
  const rawConfig = ts.readConfigFile(CONFIG, readFile);
  if (rawConfig.error) throw Error(ts.flattenDiagnosticMessageText(rawConfig.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(rawConfig.config, { ...resolutionHost, readDirectory }, PROJECT, { noEmit: true, incremental: false }, CONFIG);
  const options = { ...parsed.options, noEmit: true, incremental: false };
  delete options.tsBuildInfoFile;
  const host = ts.createCompilerHost(options, true);
  Object.assign(host, resolutionHost, {
    readDirectory,
    getSourceFile(file, languageVersion, onError) {
      try { const text = readFile(file); return text === undefined ? undefined : ts.createSourceFile(file, text, languageVersion, true); }
      catch (error) { if (onError) onError(error.message); return undefined; }
    },
    getDefaultLibFileName: compilerOptions => ts.getDefaultLibFilePath(compilerOptions),
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    getCanonicalFileName: file => ts.sys.useCaseSensitiveFileNames ? file : file.toLowerCase(),
    getCurrentDirectory: () => PROJECT,
    getNewLine: () => '\n',
    writeFile() { throw Error('Static type checker forbids emit and tsbuildinfo writes'); },
    resolveModuleNames(names, containingFile) {
      return names.map(name => {
        let found = ts.resolveModuleName(name, containingFile, options, resolutionHost).resolvedModule;
        // Alias and relative business sources are resolved only inside W.
        if (!found && !name.startsWith('.') && !name.startsWith('@/') && !path.isAbsolute(name) && !name.startsWith('node:') && name !== 'cloudflare:workers') {
          found = ts.resolveModuleName(name, path.join(DEPENDENCIES, '__static_types__.ts'), options, resolutionHost).resolvedModule;
          if (found) packageFallbacks.add(name);
        }
        if (found && !allowed(found.resolvedFileName)) throw Error('TypeScript resolved outside W/public dependencies');
        return found;
      });
    },
    resolveTypeReferenceDirectives(names, containingFile) {
      return names.map(reference => {
        const name = typeof reference === 'string' ? reference : reference.fileName;
        let found = ts.resolveTypeReferenceDirective(name, containingFile || CONFIG, options, resolutionHost).resolvedTypeReferenceDirective;
        if (!found && !name.startsWith('.') && !name.startsWith('@/') && !path.isAbsolute(name)) {
          found = ts.resolveTypeReferenceDirective(name, path.join(DEPENDENCIES, '__static_types__.ts'), options, resolutionHost).resolvedTypeReferenceDirective;
          if (found) typeFallbacks.add(name);
        }
        if (found && !allowed(found.resolvedFileName)) throw Error('Type reference escaped W/public dependencies');
        return found;
      });
    },
  });
  const program = ts.createProgram({ rootNames: parsed.fileNames, options, host });
  // createProgram/getPreEmitDiagnostics perform compiler parsing and type
  // analysis only. No emit, dynamic imports, app plugins or project require.
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  const normalized = diagnostics.map(diagnostic => {
    const position = diagnostic.file && diagnostic.start !== undefined ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start) : null;
    const absolute = diagnostic.file?.fileName;
    return { code: diagnostic.code, category: ts.DiagnosticCategory[diagnostic.category], file: absolute ? (inside(PROJECT, absolute) ? projectRelative(absolute) : slash(path.relative(DEPENDENCIES, absolute))) : null, line: position ? position.line + 1 : null, column: position ? position.character + 1 : null, message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n') };
  });
  const formatHost = { getCanonicalFileName: name => name, getCurrentDirectory: () => ROOT, getNewLine: () => '\n' };
  return { mode, rootFileCount: parsed.fileNames.length, rootFiles: parsed.fileNames.map(projectRelative), programFileCount: program.getSourceFiles().length, projectProgramFileCount: program.getSourceFiles().filter(file => inside(PROJECT, file.fileName)).length, readInputs: [...readInputs].map(([file, sha256]) => ({ file: inside(PROJECT, file) ? projectRelative(file) : 'public-dependencies/' + slash(path.relative(DEPENDENCIES, file)), sha256 })), options: { strict: options.strict, noEmit: options.noEmit, incremental: options.incremental, allowJs: options.allowJs, skipLibCheck: options.skipLibCheck, module: ts.ModuleKind[options.module], moduleResolution: ts.ModuleResolutionKind[options.moduleResolution], target: ts.ScriptTarget[options.target], pluginsExecuted: false }, packageFallbacks: [...packageFallbacks].sort(), typeFallbacks: [...typeFallbacks].sort(), diagnostics: normalized, diagnosticText: ts.formatDiagnostics(diagnostics, formatHost) };
}

const startedAt = new Date().toISOString();
const current = run('current');
const baseline = run('baseline');
const signature = diagnostic => JSON.stringify([diagnostic.file, diagnostic.code, diagnostic.category, diagnostic.message]);
const baselineCounts = new Map();
for (const diagnostic of baseline.diagnostics) baselineCounts.set(signature(diagnostic), (baselineCounts.get(signature(diagnostic)) || 0) + 1);
for (const diagnostic of current.diagnostics) {
  const key = signature(diagnostic), count = baselineCounts.get(key) || 0;
  diagnostic.classification = count ? 'also-present-at-HEAD' : diagnostic.file?.startsWith('project/') && !tracked.has(diagnostic.file) ? 'new-source-diagnostic' : 'new-current-diagnostic';
  if (count) baselineCounts.set(key, count - 1);
}
const changedDuringCheck = [];
for (const [relative, text] of currentText) if (sha(fs.readFileSync(path.join(ROOT, relative), 'utf8')) !== sha(text)) changedDuringCheck.push(relative);
if (fs.lstatSync(REPORTS).isSymbolicLink()) throw Error('Report directory cannot be a link');
const stamp = startedAt.replaceAll(':', '-').replaceAll('.', '-');
const prefix = path.join(REPORTS, 'static-typecheck-' + stamp);
const { diagnosticText: currentLog, ...currentResult } = current;
const { diagnosticText: baselineLog, ...baselineResult } = baseline;
const report = { version: 1, purpose: 'actual compiler noEmit check, no business execution', startedAt, endedAt: new Date().toISOString(), compiler: { path: COMPILER, version: ts.version, sha256: sha(fs.readFileSync(COMPILER)), packageLicense: compilerMetadata.license }, entry: projectRelative(CONFIG), sourceRoot: PROJECT, readOnlyDependencyFallback: DEPENDENCIES, baselineCommit, businessModulesRequired: false, businessEntrypointsStarted: false, databasesOpened: false, pycExecuted: false, emitCalled: false, tsbuildinfoWritten: false, repositoryWrites: 'only the three reports listed below', deniedOutsideReadAttempts: deniedPaths, sourcesChangedDuringCheck: changedDuringCheck, baselineComparison: 'Same compiler, options and public dependency fallback; tracked project text at fixed pre-audit commit e0b9464 is supplied from git show in memory. New sources are excluded from baseline roots. Diagnostic matching ignores shifted line numbers and compares file/code/category/message counts.', current: currentResult, baseline: baselineResult, summary: { currentDiagnostics: current.diagnostics.length, baselineDiagnostics: baseline.diagnostics.length, alsoPresentAtHead: current.diagnostics.filter(d => d.classification === 'also-present-at-HEAD').length, newCurrentDiagnostics: current.diagnostics.filter(d => d.classification !== 'also-present-at-HEAD').length, removedHeadDiagnostics: [...baselineCounts.values()].reduce((sum, count) => sum + count, 0) }, files: { json: prefix + '.json', currentLog: prefix + '.current.log', baselineLog: prefix + '.baseline.log' } };
fs.writeFileSync(prefix + '.json', JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
fs.writeFileSync(prefix + '.current.log', currentLog || 'No diagnostics.\n', { flag: 'wx' });
fs.writeFileSync(prefix + '.baseline.log', baselineLog || 'No diagnostics.\n', { flag: 'wx' });
process.stdout.write(JSON.stringify({ ...report.summary, compiler: ts.version, roots: current.rootFileCount, programFiles: current.programFileCount, sourcesChangedDuringCheck: changedDuringCheck, reports: report.files }) + '\n');
process.exitCode = current.diagnostics.some(d => d.category === 'Error') || changedDuringCheck.length ? 1 : 0;
