'use strict';
// ROUND 6 — build fixed3 from SHIPPED install-location.cjs and run the full matrix
// (previous 32 + hardened physical-path fail-closed + real junction test).
// Expectations are hand-written. Writes only D: continuation artifacts.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WORK = "D:/Codex/xjy-release-20261022/tests";
const SHIPPED = 'D:\\Codex\\xjy-1.7.0\\c28-candidate\\build\\package\\受信助手\\delivery-tools\\install-location.cjs';
const FIXED3 = path.join(WORK, 'install-location-fixed5.cjs');
const RESULT = path.join(WORK, 'fixed5-48-results.json');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

const REPL = [];
const rep = (id, from, to) => REPL.push({ id, from, to });
rep('R7-role-mismatch-audit', "    if (!matching.length && candidates.length) return blocked('ROLE_MISMATCH', '找到的程序角色与本次更新目标不符；没有改用其他角色或新建副本。', { requestedRole, foundRoles: [...new Set(candidates.map(candidate => candidate.role))] });", "    if (!matching.length && candidates.length) return blocked('ROLE_MISMATCH', '找到的程序角色与本次更新目标不符；没有改用其他角色或新建副本。', { requestedRole, foundRoles: [...new Set(candidates.map(candidate => candidate.role))], ...(excluded.length ? { excluded } : {}) });");

rep('R7-signature',
  "function resolveInstallLocation({ mode = 'maintenance', candidateResults, supportedVersions, requestedRole, selectedIdentity, legacyRoleConfirmation, osUser, defaultEmployeeDirectory, defaultDirectoryExists } = {}) {",
  "function resolveInstallLocation({ mode = 'maintenance', candidateResults, supportedVersions, requestedRole, selectedIdentity, legacyRoleConfirmation, osUser, defaultEmployeeDirectory, defaultDirectoryExists, resolveRealPath } = {}) {");

rep('R6-helpers',
  "function blocked(code, message, details = {}) { return { kind: 'blocked', code, message, ...details }; }",
  "function blocked(code, message, details = {}) { return { kind: 'blocked', code, message, ...details }; }\nfunction defaultResolveRealPath(value) { try { return require('node:fs').realpathSync.native(value); } catch (error) { return null; } }\nfunction compareVersions(a, b) { const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number); for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; } return 0; }\nfunction newerThanAll(version, supportedVersions) { return Array.from(supportedVersions).every(v => compareVersions(version, v) > 0); }\nfunction physicalInfo(value, resolver) {\n  if (typeof value !== 'string' || !value) return { ok: false, reason: 'EMPTY' };\n  let resolved = null;\n  try { resolved = typeof resolver === 'function' ? resolver(value) : defaultResolveRealPath(value); } catch (error) { resolved = null; }\n  if (typeof resolved === 'string' && resolved.length >= 4) return { ok: true, key: 'P:' + resolved.toLowerCase(), resolved };\n  return { ok: false, reason: 'UNRESOLVED' };\n}");

rep('R1-excluded-evidence',
  "  if (row.outcome === 'invalid') return row.knownProduct === true ? { error: 'KNOWN_INSTALL_INVALID', source: row.source, path: installPath, reason: typeof row.code === 'string' ? row.code : 'CANDIDATE_INVALID' } : null;",
  "  if (row.outcome === 'invalid') {\n    if (row.knownProduct !== true) return null;\n    const reason = typeof row.code === 'string' ? row.code : 'CANDIDATE_INVALID';\n    const version = typeof row.version === 'string' && validVersion(row.version) ? row.version : null;\n    const hasIdentity = row.identity !== undefined && row.identity !== null;\n    const identityOk = !hasIdentity || (typeof row.identity === 'string' && validIdentity(row.identity));\n    const roleOk = row.role === undefined || row.role === null || ROLE.has(row.role);\n    if (reason === 'UNSUPPORTED_SOURCE_VERSION' && version && identityOk && roleOk && newerThanAll(version, supportedVersions)) {\n      return { excluded: { source: row.source, path: installPath, reason, version, identity: hasIdentity ? String(row.identity).toLowerCase() : null, role: roleOk ? (row.role || null) : null } };\n    }\n    return { error: 'KNOWN_INSTALL_INVALID', source: row.source, path: installPath, reason: version ? reason + ':' + version : reason };\n  }");

rep('R2-collect',
  "  const normalized = [];\n  for (const row of candidateResults) {\n    const item = normalizeCandidateResult(row, allowed);\n    if (item?.error) return blocked(item.error, '发现无法核验的鑫金源程序位置；已停止，未修改程序或资料。', { source: item.source, path: item.path, reason: item.reason });\n    if (item) normalized.push(item);\n  }",
  "  const normalized = [], excluded = [];\n  for (const row of candidateResults) {\n    const item = normalizeCandidateResult(row, allowed);\n    if (item?.error) return blocked(item.error, '发现无法核验的鑫金源程序位置；已停止，未修改程序或资料。', { source: item.source, path: item.path, reason: item.reason, ...(excluded.length ? { excluded } : {}) });\n    if (item?.excluded) { excluded.push(item.excluded); continue; }\n    if (item) normalized.push(item);\n  }\n  if (excluded.length && !normalized.length) return blocked('KNOWN_INSTALL_INVALID', '发现无法核验的鑫金源程序位置；已停止，未修改程序或资料。', { source: excluded[0].source, path: excluded[0].path, reason: excluded[0].reason, excluded });");

rep('R3-hardened-physical', "  let candidates = [...byIdentity.values()].map(candidate => ({ ...candidate, sources: candidate.sources.sort((a, b) => sourceRank(a) - sourceRank(b)) }));", "  const resolvePath = typeof resolveRealPath === 'function' ? resolveRealPath : defaultResolveRealPath;\n  const merged = [...byIdentity.values()];\n  const infoOf = new Map();\n  const phys = p => { if (!infoOf.has(p)) infoOf.set(p, physicalInfo(p, resolvePath)); return infoOf.get(p); };\n  const conflicts = (a, b) => a.identity !== b.identity || a.version !== b.version || (a.role || null) !== (b.role || null);\n  for (const item of merged) for (const row of excluded) {\n    const literal = row.path.toLowerCase() === item.installationDir.toLowerCase();\n    if (literal || (row.identity && row.identity === item.identity)) return blocked('CONFLICTING_IDENTITY', '同一个物理目录出现互相冲突的程序身份；已停止。', { path: item.installationDir, reason: row.reason, excluded });\n  }\n  for (let i = 0; i < merged.length; i++) for (let j = i + 1; j < merged.length; j++) {\n    const a = merged[i], b = merged[j];\n    const literal = a.installationDir.toLowerCase() === b.installationDir.toLowerCase();\n    const ai = phys(a.installationDir), bi = phys(b.installationDir);\n    const samePhysical = ai.ok && bi.ok && ai.key === bi.key;\n    if ((literal || samePhysical) && conflicts(a, b)) return blocked('CONFLICTING_IDENTITY', '同一个物理目录出现互相冲突的程序身份；已停止。', { path: a.installationDir, ...(excluded.length ? { excluded } : {}) });\n  }\n  for (const row of excluded) {\n    const info = phys(row.path);\n    if (!info.ok) return blocked('PATH_UNRESOLVED', '无法解析同一物理目录，已停止，未修改程序或资料。', { source: row.source, path: row.path, reason: row.reason, excluded });\n  }\n  if (merged.length > 1 || excluded.length) for (const item of merged) {\n    const info = phys(item.installationDir);\n    if (!info.ok) return blocked('PATH_UNRESOLVED', '无法解析安装目录的物理路径，已停止，未修改程序或资料。', { path: item.installationDir, ...(excluded.length ? { excluded } : {}) });\n  }\n  for (const item of merged) for (const row of excluded) {\n    const a = phys(item.installationDir), b = phys(row.path);\n    if (a.ok && b.ok && a.key === b.key) return blocked('CONFLICTING_IDENTITY', '同一个物理目录出现互相冲突的程序身份；已停止。', { path: item.installationDir, reason: row.reason, excluded });\n  }\n  let candidates = [...byIdentity.values()].map(candidate => ({ ...candidate, sources: candidate.sources.sort((a, b) => sourceRank(a) - sourceRank(b)) }));");
rep('R5-total-order',
  "  candidates.sort((a, b) => sourceRank(a.sources[0]) - sourceRank(b.sources[0]) || (a.role || 'legacy').localeCompare(b.role || 'legacy') || b.version.localeCompare(a.version, 'en', { numeric: true }) || a.installationDir.localeCompare(b.installationDir, 'en', { sensitivity: 'base' }));",
  "  candidates.sort((a, b) => sourceRank(a.sources[0]) - sourceRank(b.sources[0]) || (a.role || 'legacy').localeCompare(b.role || 'legacy') || compareVersions(b.version, a.version) || (a.installationDir < b.installationDir ? -1 : a.installationDir > b.installationDir ? 1 : 0) || (a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0));");

rep('R6-legacy',
  "    if (!selected || legacyRoleConfirmation.installationDir && canonicalWindowsPath(legacyRoleConfirmation.installationDir)?.toLowerCase() !== selected.installationDir.toLowerCase()) return blocked('LEGACY_ROLE_CONFIRMATION_MISMATCH', '角色确认与选定的旧版安装目录不一致。');",
  "    const hasConfirmedDir = Object.prototype.hasOwnProperty.call(legacyRoleConfirmation, 'installationDir');\n    const confirmedDir = hasConfirmedDir ? canonicalWindowsPath(legacyRoleConfirmation.installationDir) : null;\n    if (hasConfirmedDir && !confirmedDir) return blocked('LEGACY_ROLE_CONFIRMATION_INVALID', '旧版安装角色确认记录无效；未写入审定。');\n    if (!selected || (hasConfirmedDir && confirmedDir.toLowerCase() !== selected.installationDir.toLowerCase())) return blocked('LEGACY_ROLE_CONFIRMATION_MISMATCH', '角色确认与选定的旧版安装目录不一致。');");

rep('R4-existing-audit',
  "  if (candidates.length === 1) return { kind: 'existing', candidate: candidates[0] };",
  "  if (excluded.some(row => row.role && candidates.some(candidate => candidate.role === row.role))) return blocked('SAME_ROLE_UPDATE_PRESENT', '同机已存在同角色的更新安装，不会在旧目录上升级。', { excluded });\n  if (candidates.length === 1) return { kind: 'existing', candidate: candidates[0], ...(excluded.length ? { excluded } : {}) };");
rep('R4-choose-audit',
  "  if (candidates.length > 1) return { kind: 'choose', candidates };",
  "  if (candidates.length > 1) return { kind: 'choose', candidates, ...(excluded.length ? { excluded } : {}) };");

const shippedText = fs.readFileSync(SHIPPED, 'utf8');
let text = shippedText;
const anchors = [];
rep("ROOT-cross-role-selection","excluded.some(row => row.role && candidates.some(candidate => candidate.role === row.role))","excluded.some(row => row.role && candidates.length && candidates.every(candidate => candidate.role === row.role))");
for (const r of REPL) {
  const n = text.split(r.from).length - 1;
  anchors.push({ id: r.id, matches: n });
  if (n !== 1) throw Object.assign(new Error('ANCHOR_' + r.id + '_' + n), { code: 'ANCHOR_FAIL' });
  text = text.replace(r.from, r.to);
}
fs.writeFileSync(FIXED3, text, 'utf8');

// real junction alias (D workspace; cleaned afterwards)
const aliasRoot = path.join(WORK, 'junction-alias-r6');
let junctionInfo = { created: false };
try {
  fs.rmSync(aliasRoot, { recursive: true, force: true });
  fs.mkdirSync(path.join(aliasRoot, 'target'), { recursive: true });
  fs.writeFileSync(path.join(aliasRoot, 'target', 'marker.txt'), 'x', 'utf8');
  fs.symlinkSync(path.join(aliasRoot, 'target'), path.join(aliasRoot, 'link'), 'junction');
  junctionInfo = { created: true, target: path.join(aliasRoot, 'target'), link: path.join(aliasRoot, 'link'), realpath: fs.realpathSync.native(path.join(aliasRoot, 'link')) };
} catch (e) { junctionInfo = { created: false, error: String(e.code || e.message) }; }

const F = require(FIXED3);
const S = require(SHIPPED);
const HOST = 'C:\\Users\\WDAGUtilityAccount\\AppData\\Local\\XjyGenuine150Host-a2\\program';
const HOST83 = 'C:\\Users\\WDAGUT~1\\AppData\\Local\\XjyGenuine150Host-a2\\program';
const EMP = 'C:\\Users\\WDAGUtilityAccount\\AppData\\Local\\鑫金源珠宝\\员工程序-slot-4d78cbbac07b05f267fabb870a10376a2c1158a8b4623ba4ea35d3334cb828ef';
const SUP = ['1.6.0', '1.6.1', '1.6.2'];
const V = (p, id, role, version, source) => ({ source: source || 'shortcut', path: p, outcome: role ? 'valid' : 'needs-role', knownProduct: true, candidate: { installationDir: p, identity: id, version: version || '1.6.2', ...(role ? { role } : {}) } });
const X = (p, code, extra) => ({ source: (extra && extra.source) || 'remembered', path: p, outcome: 'invalid', knownProduct: true, code: code || 'UNSUPPORTED_SOURCE_VERSION', ...(extra || {}) });
const ident = p => p; // resolver: path -> itself (already canonical in fixtures)
const R = (p) => (p === HOST83 ? HOST : p);
const NULL = () => null;
const THROW = () => { throw new Error('fs error'); };

const IDH = '9814cc2a:000200000002bb8f';
const cases = [
  // previous 32 (resolver injected for multi/excluded cases to model real FS)
  ['O1 host + employee1.7 excluded => host', [V(HOST, IDH, 'host'), X(EMP, 'UNSUPPORTED_SOURCE_VERSION', { version: '1.7.0', identity: 'a1b2c3d4:00000000000000aa', role: 'employee' })], { resolveRealPath: R }, r => r.kind === 'existing' && r.candidate.installationDir === HOST],
  ['O2 duplicate excluded => host', [V(HOST, IDH, 'host'), X(EMP, 'UNSUPPORTED_SOURCE_VERSION', { version: '1.7.0', source: 'shortcut' }), X(EMP, 'UNSUPPORTED_SOURCE_VERSION', { version: '1.7.0', source: 'remembered' })], { resolveRealPath: R }, r => r.kind === 'existing' && r.candidate.installationDir === HOST],
  ['O3 employee1.7 only => blocked', [X(EMP, 'UNSUPPORTED_SOURCE_VERSION', { version: '1.7.0' })], { resolveRealPath: R }, r => r.kind === 'blocked' && r.code === 'KNOWN_INSTALL_INVALID'],
  ['O4 requestedRole host => host', [V(HOST, IDH, 'host'), X(EMP, 'UNSUPPORTED_SOURCE_VERSION', { version: '1.7.0' })], { resolveRealPath: R, requestedRole: 'host' }, r => r.kind === 'existing' && r.candidate.role === 'host'],
  ['O5 requestedRole employee => ROLE_MISMATCH', [V(HOST, IDH, 'host'), X(EMP, 'UNSUPPORTED_SOURCE_VERSION', { version: '1.7.0' })], { resolveRealPath: R, requestedRole: 'employee' }, r => r.kind === 'blocked' && r.code === 'ROLE_MISMATCH'],
  ['O6 corrupt host + excluded => blocked', [X(HOST, 'SOURCE_PROGRAM_MISMATCH', { version: '1.6.2' }), X(EMP, 'UNSUPPORTED_SOURCE_VERSION', { version: '1.7.0' })], { resolveRealPath: R }, r => r.kind === 'blocked' && r.code === 'KNOWN_INSTALL_INVALID'],
  ['O7 corrupt host alone => blocked', [X(HOST, 'SOURCE_PROGRAM_MISMATCH', { version: '1.6.2' })], { resolveRealPath: R }, r => r.kind === 'blocked'],
  ['O8 same path 2 identities => conflict', [V(HOST, IDH, 'host'), V(HOST, 'ffffffff:00000000000000bb', 'employee', '1.6.1')], { resolveRealPath: R }, r => r.kind === 'blocked' && r.code === 'CONFLICTING_IDENTITY'],
  ['O9 order A', [V(HOST, IDH, 'host'), X(EMP, 'UNSUPPORTED_SOURCE_VERSION', { version: '1.7.0' })], { resolveRealPath: R }, r => r.kind === 'existing' && r.candidate.installationDir === HOST],
  ['O10 order B', [X(EMP, 'UNSUPPORTED_SOURCE_VERSION', { version: '1.7.0' }), V(HOST, IDH, 'host')], { resolveRealPath: R }, r => r.kind === 'existing' && r.candidate.installationDir === HOST],
  ['O11 path binding mismatch', [V(HOST, IDH, 'host'), { source: 'shortcut', path: EMP, outcome: 'valid', knownProduct: true, candidate: { installationDir: HOST, identity: 'a1b2c3d4:00000000000000aa', version: '1.6.2', role: 'employee' } }], { resolveRealPath: R }, r => r.kind === 'blocked' && r.code === 'PATH_BINDING_MISMATCH'],
  ['O12 bad identity', [V(HOST, IDH, 'host'), { source: 'shortcut', path: EMP, outcome: 'valid', knownProduct: true, candidate: { installationDir: EMP, identity: 'bad', version: '1.6.2', role: 'employee' } }], { resolveRealPath: R }, r => r.kind === 'blocked' && r.code === 'BAD_CANDIDATE_RESULT'],
  ['O13 unknown product ignored', [V(HOST, IDH, 'host'), { source: 'shortcut', path: 'C:\\Temp\\not-xjy', outcome: 'invalid', knownProduct: false, code: 'NOT_FOUND' }], { resolveRealPath: R }, r => r.kind === 'existing' && r.candidate.installationDir === HOST],
  ['O14 two valid hosts => choose', [V(HOST, IDH, 'host'), V('C:\\Users\\WDAGUtilityAccount\\AppData\\Local\\XjyHost161', '12345678:00000000000000cc', 'host', '1.6.1')], { resolveRealPath: ident }, r => r.kind === 'choose' && r.candidates.length === 2],
  ['O15 requested employee', [V(HOST, IDH, 'host'), V(EMP, 'a1b2c3d4:00000000000000aa', 'employee')], { resolveRealPath: R, requestedRole: 'employee' }, r => r.kind === 'existing' && r.candidate.role === 'employee'],
  ['O16 employee only', [V(EMP, 'a1b2c3d4:00000000000000aa', 'employee')], { resolveRealPath: R }, r => r.kind === 'existing' && r.candidate.role === 'employee'],
  ['N1 excluded 8.3 alias => conflict', [V(HOST, IDH, 'host'), X(HOST83, 'UNSUPPORTED_SOURCE_VERSION', { version: '1.7.0' })], { resolveRealPath: R }, r => r.kind === 'blocked' && r.code === 'CONFLICTING_IDENTITY'],
  ['N2 two identities alias => conflict', [V(HOST, IDH, 'host'), V(HOST83, 'ffffffff:00000000000000bb', 'host')], { resolveRealPath: R }, r => r.kind === 'blocked' && r.code === 'CONFLICTING_IDENTITY'],
  ['N3 needs-role+valid order A', [V(HOST, IDH, null, '1.6.2', 'legacy-profile'), V(HOST, IDH, 'host', '1.6.2', 'approval')], { resolveRealPath: R }, r => r.kind === 'existing' && r.candidate.role === 'host'],
  ['N4 needs-role+valid order B', [V(HOST, IDH, 'host', '1.6.2', 'approval'), V(HOST, IDH, null, '1.6.2', 'legacy-profile')], { resolveRealPath: R }, r => r.kind === 'existing' && r.candidate.role === 'host'],
  ['N5 fake unsupported with older version', [V(HOST, IDH, 'host'), X(EMP, 'UNSUPPORTED_SOURCE_VERSION', { version: '1.6.2' })], { resolveRealPath: R }, r => r.kind === 'blocked' && r.code === 'KNOWN_INSTALL_INVALID'],
  ['N6 unsupported without version', [V(HOST, IDH, 'host'), X(EMP, 'UNSUPPORTED_SOURCE_VERSION')], { resolveRealPath: R }, r => r.kind === 'blocked'],
  ['N7 newer excluded + audit', [V(HOST, IDH, 'host'), X(EMP, 'UNSUPPORTED_SOURCE_VERSION', { version: '1.8.0', identity: 'a1b2c3d4:00000000000000aa', role: 'employee' })], { resolveRealPath: R }, r => r.kind === 'existing' && Array.isArray(r.excluded) && r.excluded.length === 1 && r.excluded[0].version === '1.8.0'],
  ['N8 corrupt identity on excluded', [V(HOST, IDH, 'host'), X(EMP, 'UNSUPPORTED_SOURCE_VERSION', { version: '1.8.0', identity: 'bad' })], { resolveRealPath: R }, r => r.kind === 'blocked'],
  ['N9 target version unsupported', [V(HOST, IDH, 'host', '1.5.0')], { resolveRealPath: R }, r => r.kind === 'blocked' && r.code === 'KNOWN_INSTALL_INVALID'],
  ['N10 first-install clean', [], { mode: 'first-install', requestedRole: 'employee', defaultEmployeeDirectory: EMP, defaultDirectoryExists: false }, r => r.kind === 'first-install' && r.role === 'employee'],
  ['N11 first-install occupied', [], { mode: 'first-install', requestedRole: 'employee', defaultEmployeeDirectory: EMP, defaultDirectoryExists: true }, r => r.kind === 'blocked' && r.code === 'DEFAULT_TARGET_OCCUPIED'],
  ['N12 excluded-only + first-install', [X(EMP, 'UNSUPPORTED_SOURCE_VERSION', { version: '1.7.0' })], { resolveRealPath: R, mode: 'first-install', requestedRole: 'employee', defaultEmployeeDirectory: EMP, defaultDirectoryExists: false }, r => r.kind === 'blocked' && r.code === 'KNOWN_INSTALL_INVALID'],
  ['N13 legacy matching dir', [V(HOST, IDH, null, '1.6.2', 'legacy-profile')], { osUser: 'S-1-5-21-2047949552-857980807-821054962-504', resolveRealPath: R, legacyRoleConfirmation: { confirmed: true, installationIdentity: IDH, role: 'host', osUser: 'S-1-5-21-2047949552-857980807-821054962-504', installationDir: HOST } }, r => r.kind === 'existing' && r.candidate.role === 'host'],
  ['N14 legacy empty dir', [V(HOST, IDH, null, '1.6.2', 'legacy-profile')], { osUser: 'S-1-5-21-2047949552-857980807-821054962-504', resolveRealPath: R, legacyRoleConfirmation: { confirmed: true, installationIdentity: IDH, role: 'host', osUser: 'S-1-5-21-2047949552-857980807-821054962-504', installationDir: '' } }, r => r.kind === 'blocked' && r.code === 'LEGACY_ROLE_CONFIRMATION_INVALID'],
  ['N15 total order', [V('C:\\Xjy\\caf\u00e9', 'aaaaaaaa:00000000000000a1', 'host'), V('C:\\Xjy\\cafe', 'bbbbbbbb:00000000000000a2', 'host', '1.6.1')], { resolveRealPath: ident }, r => r.kind === 'choose' && r.candidates[0].installationDir === 'C:\\Xjy\\caf\u00e9'],
  ['N16 total order reversed', [V('C:\\Xjy\\cafe', 'bbbbbbbb:00000000000000a2', 'host', '1.6.1'), V('C:\\Xjy\\caf\u00e9', 'aaaaaaaa:00000000000000a1', 'host')], { resolveRealPath: ident }, r => r.kind === 'choose' && r.candidates[0].installationDir === 'C:\\Xjy\\caf\u00e9'],
  // R6 new hardening
  ['P1 excluded unresolved => PATH_UNRESOLVED', [V(HOST, IDH, 'host'), X(EMP, 'UNSUPPORTED_SOURCE_VERSION', { version: '1.7.0' })], { resolveRealPath: p => (p === HOST ? HOST : null) }, r => r.kind === 'blocked' && r.code === 'PATH_UNRESOLVED'],
  ['P2 excluded resolver throws => PATH_UNRESOLVED', [V(HOST, IDH, 'host'), X(EMP, 'UNSUPPORTED_SOURCE_VERSION', { version: '1.7.0' })], { resolveRealPath: p => { if (p === HOST) return HOST; throw new Error('boom'); } }, r => r.kind === 'blocked' && r.code === 'PATH_UNRESOLVED'],
  ['P3 two candidates unresolved => PATH_UNRESOLVED', [V(HOST, IDH, 'host'), V(EMP, 'a1b2c3d4:00000000000000aa', 'employee')], { resolveRealPath: NULL }, r => r.kind === 'blocked' && r.code === 'PATH_UNRESOLVED'],
  ['P4 single candidate unresolved, no excluded => existing', [V(HOST, IDH, 'host')], { resolveRealPath: NULL }, r => r.kind === 'existing' && r.candidate.installationDir === HOST],
  ['P5 literal same path, resolver null => conflict', [V(HOST, IDH, 'host'), V(HOST, 'ffffffff:00000000000000bb', 'employee', '1.6.1')], { resolveRealPath: NULL }, r => r.kind === 'blocked' && r.code === 'CONFLICTING_IDENTITY'],
  ['P6 case-only path, resolver null => conflict', [V(HOST, IDH, 'host'), V(HOST.toLowerCase(), 'ffffffff:00000000000000bb', 'employee', '1.6.1')], { resolveRealPath: NULL }, r => r.kind === 'blocked' && r.code === 'CONFLICTING_IDENTITY'],
  ['P7 excluded identity equals candidate but unresolved path => conflict', [V(HOST, IDH, 'host'), X('C:\\Other\\AliasDir', 'UNSUPPORTED_SOURCE_VERSION', { version: '1.7.0', identity: IDH })], { resolveRealPath: p => (p === HOST ? HOST : null) }, r => r.kind === 'blocked' && r.code === 'CONFLICTING_IDENTITY'],
  ['P8 excluded resolvable different dir => existing + audit', [V(HOST, IDH, 'host'), X(EMP, 'UNSUPPORTED_SOURCE_VERSION', { version: '1.8.0', identity: 'a1b2c3d4:00000000000000aa', role: 'employee' })], { resolveRealPath: R }, r => r.kind === 'existing' && Array.isArray(r.excluded) && r.excluded.length === 1],
  ['P9 resolver null, single candidate + no excluded => existing', [V(HOST, IDH, 'host')], { resolveRealPath: THROW }, r => r.kind === 'existing']
];

cases.push(['R7-1 single candidate unresolved + excluded resolved => PATH_UNRESOLVED', [V(HOST, IDH, 'host'), X(EMP, 'UNSUPPORTED_SOURCE_VERSION', { version: '1.7.0' })], { resolveRealPath: p => (p === HOST ? null : EMP) }, r => r.kind === 'blocked' && r.code === 'PATH_UNRESOLVED']);
cases.push(['R7-2 candidate unresolved + excluded alias of it => PATH_UNRESOLVED', [V(HOST, IDH, 'host'), X(HOST83, 'UNSUPPORTED_SOURCE_VERSION', { version: '1.7.0' })], { resolveRealPath: p => (p === HOST ? null : HOST) }, r => r.kind === 'blocked' && r.code === 'PATH_UNRESOLVED']);
cases.push(['R7-3 same-role newer host install => blocked', [V(HOST, IDH, 'host'), X('C:\\Users\\WDAGUtilityAccount\\AppData\\Local\\XjyHost170-new', 'UNSUPPORTED_SOURCE_VERSION', { version: '1.8.0', role: 'host', identity: 'cccccccc:00000000000000c1' })], { resolveRealPath: R }, r => r.kind === 'blocked' && r.code === 'SAME_ROLE_UPDATE_PRESENT']);
cases.push(['R7-4 same-role newer employee install => blocked', [V(EMP, 'a1b2c3d4:00000000000000aa', 'employee'), X('C:\\Users\\WDAGUtilityAccount\\AppData\\Local\\Employee170-new', 'UNSUPPORTED_SOURCE_VERSION', { version: '1.8.0', role: 'employee', identity: 'dddddddd:00000000000000d1' })], { resolveRealPath: R }, r => r.kind === 'blocked' && r.code === 'SAME_ROLE_UPDATE_PRESENT']);
cases.push(['R7-5 ROLE_MISMATCH carries excluded audit', [V(HOST, IDH, 'host'), X(EMP, 'UNSUPPORTED_SOURCE_VERSION', { version: '1.7.0', role: 'employee', identity: 'a1b2c3d4:00000000000000aa' })], { resolveRealPath: R, requestedRole: 'employee' }, r => r.kind === 'blocked' && r.code === 'ROLE_MISMATCH' && Array.isArray(r.excluded) && r.excluded.length >= 1]);
cases.push(['R7-6 path tiebreak same version/role/order', [V('C:\\Xjy\\caf\u00e9', 'aaaaaaaa:00000000000000a1', 'host'), V('C:\\Xjy\\cafe', 'bbbbbbbb:00000000000000a2', 'host')], { resolveRealPath: ident }, r => r.kind === 'choose' && r.candidates[0].installationDir === 'C:\\Xjy\\cafe']);
cases.push(['R7-7 path tiebreak reversed input', [V('C:\\Xjy\\cafe', 'bbbbbbbb:00000000000000a2', 'host'), V('C:\\Xjy\\caf\u00e9', 'aaaaaaaa:00000000000000a1', 'host')], { resolveRealPath: ident }, r => r.kind === 'choose' && r.candidates[0].installationDir === 'C:\\Xjy\\cafe']);

const summary = r => !r ? { kind: 'null' } : r.kind === 'blocked' ? { kind: r.kind, code: r.code } : r.kind === 'existing' ? { kind: r.kind, dir: r.candidate && r.candidate.installationDir, role: r.candidate && r.candidate.role, excluded: Array.isArray(r.excluded) ? r.excluded.length : 0 } : r.kind === 'choose' ? { kind: r.kind, n: r.candidates.length, first: r.candidates[0] && r.candidates[0].installationDir } : r.kind === 'first-install' ? { kind: r.kind, role: r.role } : { kind: r.kind, code: r.code };
const out = { schemaVersion: 1, purpose: 'ds-r7-tests-a1', round: 6, asOf: new Date().toISOString(), shipped: { bytes: Buffer.byteLength(shippedText), sha256: sha(Buffer.from(shippedText, 'utf8')) }, fixed3: { bytes: Buffer.byteLength(text), sha256: sha(Buffer.from(text, 'utf8')), path: FIXED3 }, anchors, junction: junctionInfo, cases: [] };

// real junction case: same physical dir via junction, different identities
if (junctionInfo.created) {
  const T = junctionInfo.target, L = junctionInfo.link;
  cases.push(['P10 real junction alias => conflict (real FS)', [V(T, 'aaaaaaaa:00000000000000a1', 'host'), V(L, 'bbbbbbbb:00000000000000a2', 'host')], {}, r => r.kind === 'blocked' && r.code === 'CONFLICTING_IDENTITY']);
  cases.push(['P11 real junction + supported host only => existing', [V(T, 'aaaaaaaa:00000000000000a1', 'host')], {}, r => r.kind === 'existing' && r.candidate.installationDir === T]);
}
for (const [name, rows, opts, expect] of cases) {
  const run = mod => { try { return mod.resolveInstallLocation({ candidateResults: JSON.parse(JSON.stringify(rows)), supportedVersions: SUP.slice(), ...opts }); } catch (e) { return { kind: 'threw', code: String(e && e.code), message: String(e && e.message) }; } };
  const rf = run(F), rs = run(S);
  out.cases.push({ name, shipped: summary(rs), shippedPass: !!expect(rs), fixed3: summary(rf), fixed3Pass: !!expect(rf) });
}
try { fs.rmSync(aliasRoot, { recursive: true, force: true }); out.junctionCleaned = true; } catch (e) { out.junctionCleaned = false; }
out.summary = { total: out.cases.length, shippedPass: out.cases.filter(c => c.shippedPass).length, shippedFail: out.cases.filter(c => !c.shippedPass).length, fixed3Pass: out.cases.filter(c => c.fixed3Pass).length, fixed3Fail: out.cases.filter(c => !c.fixed3Pass).length, fixed3FailNames: out.cases.filter(c => !c.fixed3Pass).map(c => c.name) };
out.ok = out.summary.fixed3Fail === 0;
fs.writeFileSync(RESULT, JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify({ ok: out.ok, summary: out.summary, junction: junctionInfo, fixed3: out.fixed3 }));
process.exitCode = out.ok ? 0 : 1;
