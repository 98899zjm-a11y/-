'use strict';

const PRODUCT = 'xjy-jewelry-offline';
const ROLE = new Set(['host', 'employee']);
const MODE = new Set(['maintenance', 'first-install']);
const SOURCE_ORDER = Object.freeze([
  'running-exe', 'remembered', 'legacy-profile', 'approval', 'uninstall-install-location',
  'uninstall-display-icon', 'shortcut', 'manual-exe',
]);
const SOURCES = new Set(SOURCE_ORDER);
const IDENTITY = /^[a-f0-9]{8}:[a-f0-9]{16}$/i;
const SID = /^S-1-\d+(?:-\d+)+$/;

function canonicalWindowsPath(value) {
  if (typeof value !== 'string' || value.length < 4 || value.length > 32767 || !/^[A-Za-z]:\\/.test(value) || value.startsWith('\\\\') || value.slice(2).includes(':')) return null;
  if (/[\x00-\x1f"<>|?*]/.test(value)) return null;
  const normalized = require('node:path').win32.normalize(value);
  if (normalized.toLowerCase() !== value.toLowerCase() || normalized.length === 3) return null;
  const parts = normalized.slice(3).split('\\');
  if (!parts.length || parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) return null;
  return normalized;
}

function validIdentity(value) { return typeof value === 'string' && IDENTITY.test(value); }
function validVersion(value) { return typeof value === 'string' && /^1\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(value) && value.split('.').every(part => Number.isSafeInteger(Number(part))); }
function sourceRank(source) { const rank = SOURCE_ORDER.indexOf(source); return rank < 0 ? SOURCE_ORDER.length : rank; }
function blocked(code, message, details = {}) { return { kind: 'blocked', code, message, ...details }; }
function defaultResolveRealPath(value) { try { return require('node:fs').realpathSync.native(value); } catch (error) { return null; } }
function compareVersions(a, b) { const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number); for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; } return 0; }
function newerThanAll(version, supportedVersions) { return Array.from(supportedVersions).every(v => compareVersions(version, v) > 0); }
function physicalInfo(value, resolver) {
  if (typeof value !== 'string' || !value) return { ok: false, reason: 'EMPTY' };
  let resolved = null;
  try { resolved = typeof resolver === 'function' ? resolver(value) : defaultResolveRealPath(value); } catch (error) { resolved = null; }
  if (typeof resolved === 'string' && resolved.length >= 4) return { ok: true, key: 'P:' + resolved.toLowerCase(), resolved };
  return { ok: false, reason: 'UNRESOLVED' };
}

function normalizeCandidateResult(row, supportedVersions) {
  if (!row || typeof row !== 'object' || !SOURCES.has(row.source) || !['valid', 'needs-role', 'invalid'].includes(row.outcome)) return { error: 'BAD_CANDIDATE_RESULT' };
  const installPath = canonicalWindowsPath(row.path);
  if (!installPath) return row.outcome === 'valid' ? { error: 'BAD_CANDIDATE_RESULT', source: row.source } : row.knownProduct === true ? { error: 'KNOWN_INSTALL_INVALID', source: row.source } : null;
  if (row.outcome === 'invalid') {
    if (row.knownProduct !== true) return null;
    const reason = typeof row.code === 'string' ? row.code : 'CANDIDATE_INVALID';
    const version = typeof row.version === 'string' && validVersion(row.version) ? row.version : null;
    const hasIdentity = row.identity !== undefined && row.identity !== null;
    const identityOk = !hasIdentity || (typeof row.identity === 'string' && validIdentity(row.identity));
    const roleOk = row.role === undefined || row.role === null || ROLE.has(row.role);
    if (reason === 'UNSUPPORTED_SOURCE_VERSION' && version && identityOk && roleOk && newerThanAll(version, supportedVersions)) {
      return { excluded: { source: row.source, path: installPath, reason, version, identity: hasIdentity ? String(row.identity).toLowerCase() : null, role: roleOk ? (row.role || null) : null } };
    }
    return { error: 'KNOWN_INSTALL_INVALID', source: row.source, path: installPath, reason: version ? reason + ':' + version : reason };
  }
  const candidate = row.candidate;
  const roleMissing = row.outcome === 'needs-role';
  if (row.knownProduct !== true || !candidate || typeof candidate !== 'object') return { error: 'BAD_CANDIDATE_RESULT', source: row.source, path: installPath };
  if (roleMissing ? candidate.role !== undefined && candidate.role !== null : !ROLE.has(candidate.role)) return { error: 'BAD_CANDIDATE_RESULT', source: row.source, path: installPath };
  if (!validVersion(candidate.version) || !validIdentity(candidate.identity)) return { error: 'BAD_CANDIDATE_RESULT', source: row.source, path: installPath };
  if (!supportedVersions.has(candidate.version)) return { error: 'KNOWN_INSTALL_INVALID', source: row.source, path: installPath, reason: 'UNSUPPORTED_SOURCE_VERSION' };
  const candidatePath = canonicalWindowsPath(candidate.installationDir);
  if (!candidatePath || candidatePath.toLowerCase() !== installPath.toLowerCase()) return { error: 'PATH_BINDING_MISMATCH', source: row.source, path: installPath };
  return { installationDir: candidatePath, identity: candidate.identity.toLowerCase(), role: roleMissing ? undefined : candidate.role, version: candidate.version, ...(roleMissing ? { requiresRoleConfirmation: true } : {}), sources: [row.source] };
}

function resolveInstallLocation({ mode = 'maintenance', candidateResults, supportedVersions, requestedRole, selectedIdentity, legacyRoleConfirmation, osUser, defaultEmployeeDirectory, defaultDirectoryExists, resolveRealPath } = {}) {
  if (!MODE.has(mode) || requestedRole !== undefined && !ROLE.has(requestedRole) || !Array.isArray(candidateResults) || candidateResults.length > 256 || !Array.isArray(supportedVersions) || !supportedVersions.length || supportedVersions.length > 128 || new Set(supportedVersions).size !== supportedVersions.length || supportedVersions.some(version => !validVersion(version))) return blocked('BAD_RESOLUTION_INPUT', '无法核验安装位置输入。');
  const allowed = new Set(supportedVersions);
  const normalized = [], excluded = [];
  for (const row of candidateResults) {
    const item = normalizeCandidateResult(row, allowed);
    if (item?.error) return blocked(item.error, '发现无法核验的鑫金源程序位置；已停止，未修改程序或资料。', { source: item.source, path: item.path, reason: item.reason, ...(excluded.length ? { excluded } : {}) });
    if (item?.excluded) { excluded.push(item.excluded); continue; }
    if (item) normalized.push(item);
  }
  if (excluded.length && !normalized.length) return blocked('KNOWN_INSTALL_INVALID', '发现无法核验的鑫金源程序位置；已停止，未修改程序或资料。', { source: excluded[0].source, path: excluded[0].path, reason: excluded[0].reason, excluded });

  const byIdentity = new Map();
  for (const item of normalized) {
    const prior = byIdentity.get(item.identity);
    if (!prior) {
      byIdentity.set(item.identity, { ...item });
      continue;
    }
    if (prior.installationDir.toLowerCase() !== item.installationDir.toLowerCase() || prior.version !== item.version || prior.role && item.role && prior.role !== item.role) return blocked('CONFLICTING_IDENTITY', '同一个物理目录出现互相冲突的程序身份；已停止。', { identity: item.identity });
    if (prior.requiresRoleConfirmation && !item.requiresRoleConfirmation) { prior.role = item.role; prior.requiresRoleConfirmation = false; }
    else if (!prior.requiresRoleConfirmation && item.requiresRoleConfirmation) { /* a verified activation/legacy marker is stronger than a missing marker from another discovery source */ }
    else if (prior.requiresRoleConfirmation && item.requiresRoleConfirmation && prior.role !== item.role) return blocked('CONFLICTING_IDENTITY', '同一个物理目录的角色信息不一致；已停止。', { identity: item.identity });
    for (const source of item.sources) if (!prior.sources.includes(source)) prior.sources.push(source);
  }

  const resolvePath = typeof resolveRealPath === 'function' ? resolveRealPath : defaultResolveRealPath;
  const merged = [...byIdentity.values()];
  const infoOf = new Map();
  const phys = p => { if (!infoOf.has(p)) infoOf.set(p, physicalInfo(p, resolvePath)); return infoOf.get(p); };
  const conflicts = (a, b) => a.identity !== b.identity || a.version !== b.version || (a.role || null) !== (b.role || null);
  for (const item of merged) for (const row of excluded) {
    const literal = row.path.toLowerCase() === item.installationDir.toLowerCase();
    if (literal || (row.identity && row.identity === item.identity)) return blocked('CONFLICTING_IDENTITY', '同一个物理目录出现互相冲突的程序身份；已停止。', { path: item.installationDir, reason: row.reason, excluded });
  }
  for (let i = 0; i < merged.length; i++) for (let j = i + 1; j < merged.length; j++) {
    const a = merged[i], b = merged[j];
    const literal = a.installationDir.toLowerCase() === b.installationDir.toLowerCase();
    const ai = phys(a.installationDir), bi = phys(b.installationDir);
    const samePhysical = ai.ok && bi.ok && ai.key === bi.key;
    if ((literal || samePhysical) && conflicts(a, b)) return blocked('CONFLICTING_IDENTITY', '同一个物理目录出现互相冲突的程序身份；已停止。', { path: a.installationDir, ...(excluded.length ? { excluded } : {}) });
  }
  for (const row of excluded) {
    const info = phys(row.path);
    if (!info.ok) return blocked('PATH_UNRESOLVED', '无法解析同一物理目录，已停止，未修改程序或资料。', { source: row.source, path: row.path, reason: row.reason, excluded });
  }
  if (merged.length > 1 || excluded.length) for (const item of merged) {
    const info = phys(item.installationDir);
    if (!info.ok) return blocked('PATH_UNRESOLVED', '无法解析安装目录的物理路径，已停止，未修改程序或资料。', { path: item.installationDir, ...(excluded.length ? { excluded } : {}) });
  }
  for (const item of merged) for (const row of excluded) {
    const a = phys(item.installationDir), b = phys(row.path);
    if (a.ok && b.ok && a.key === b.key) return blocked('CONFLICTING_IDENTITY', '同一个物理目录出现互相冲突的程序身份；已停止。', { path: item.installationDir, reason: row.reason, excluded });
  }
  let candidates = [...byIdentity.values()].map(candidate => ({ ...candidate, sources: candidate.sources.sort((a, b) => sourceRank(a) - sourceRank(b)) }));
  candidates.sort((a, b) => sourceRank(a.sources[0]) - sourceRank(b.sources[0]) || (a.role || 'legacy').localeCompare(b.role || 'legacy') || compareVersions(b.version, a.version) || (a.installationDir < b.installationDir ? -1 : a.installationDir > b.installationDir ? 1 : 0) || (a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0));
  const needsRole = candidates.filter(candidate => candidate.requiresRoleConfirmation);
  if (legacyRoleConfirmation !== undefined) {
    if (!legacyRoleConfirmation || typeof legacyRoleConfirmation !== 'object' || legacyRoleConfirmation.confirmed !== true || !validIdentity(legacyRoleConfirmation.installationIdentity) || !ROLE.has(legacyRoleConfirmation.role) || typeof osUser !== 'string' || !SID.test(osUser) || legacyRoleConfirmation.osUser !== osUser) return blocked('LEGACY_ROLE_CONFIRMATION_INVALID', '旧版安装角色确认记录无效；未写入审定。');
    const selected = needsRole.find(candidate => candidate.identity === legacyRoleConfirmation.installationIdentity.toLowerCase());
    const hasConfirmedDir = Object.prototype.hasOwnProperty.call(legacyRoleConfirmation, 'installationDir');
    const confirmedDir = hasConfirmedDir ? canonicalWindowsPath(legacyRoleConfirmation.installationDir) : null;
    if (hasConfirmedDir && !confirmedDir) return blocked('LEGACY_ROLE_CONFIRMATION_INVALID', '旧版安装角色确认记录无效；未写入审定。');
    if (!selected || (hasConfirmedDir && confirmedDir.toLowerCase() !== selected.installationDir.toLowerCase())) return blocked('LEGACY_ROLE_CONFIRMATION_MISMATCH', '角色确认与选定的旧版安装目录不一致。');
    if (requestedRole && requestedRole !== legacyRoleConfirmation.role) return blocked('LEGACY_ROLE_CONFIRMATION_MISMATCH', '角色确认与更新目标不一致。');
    selected.role = legacyRoleConfirmation.role;
    selected.requiresRoleConfirmation = false;
    candidates = [selected];
  }
  const rolePending = candidates.filter(candidate => candidate.requiresRoleConfirmation);
  if (rolePending.length) {
    if (selectedIdentity !== undefined) {
      if (!validIdentity(selectedIdentity)) return blocked('CANDIDATE_SELECTION_INVALID', '候选选择身份无效。');
      const selected = candidates.find(candidate => candidate.identity === selectedIdentity.toLowerCase());
      if (!selected) return blocked('CANDIDATE_SELECTION_MISMATCH', '候选已变化，请重新检查安装位置。');
      candidates = [selected];
      if (selected.requiresRoleConfirmation) return { kind: 'confirm-role', candidate: selected };
    } else if (candidates.length === 1) return { kind: 'confirm-role', candidate: rolePending[0] };
    else return { kind: 'choose', candidates, requiresRoleConfirmation: true };
  }
  if (selectedIdentity !== undefined && !legacyRoleConfirmation) {
    if (!validIdentity(selectedIdentity)) return blocked('CANDIDATE_SELECTION_INVALID', '候选选择身份无效。');
    const selected = candidates.find(candidate => candidate.identity === selectedIdentity.toLowerCase());
    if (!selected) return blocked('CANDIDATE_SELECTION_MISMATCH', '候选已变化，请重新检查安装位置。');
    candidates = [selected];
  }
  if (requestedRole) {
    const matching = candidates.filter(candidate => candidate.role === requestedRole);
    if (!matching.length && candidates.length) return blocked('ROLE_MISMATCH', '找到的程序角色与本次更新目标不符；没有改用其他角色或新建副本。', { requestedRole, foundRoles: [...new Set(candidates.map(candidate => candidate.role))], ...(excluded.length ? { excluded } : {}) });
    candidates = matching;
  }

  if (excluded.some(row => row.role && candidates.length && candidates.every(candidate => candidate.role === row.role))) return blocked('SAME_ROLE_UPDATE_PRESENT', '同机已存在同角色的更新安装，不会在旧目录上升级。', { excluded });
  if (candidates.length === 1) return { kind: 'existing', candidate: candidates[0], ...(excluded.length ? { excluded } : {}) };
  if (candidates.length > 1) return { kind: 'choose', candidates, ...(excluded.length ? { excluded } : {}) };
  if (mode !== 'first-install') return blocked('NO_INSTALLATION', '没有找到可核验的现有程序；补丁未运行。');
  if (requestedRole !== 'employee') return blocked('HOST_FIRST_INSTALL_UNSUPPORTED', '首次安装包只提供员工端默认位置，请使用主机专用安装流程。');
  const defaultPath = canonicalWindowsPath(defaultEmployeeDirectory);
  if (!defaultPath) return blocked('BAD_DEFAULT_TARGET', '员工首次安装默认目录无效，已停止。');
  if (typeof defaultDirectoryExists !== 'boolean') return blocked('DEFAULT_TARGET_UNKNOWN', '无法确认员工安装目录是否已存在，已停止。');
  if (defaultDirectoryExists) return blocked('DEFAULT_TARGET_OCCUPIED', '首次安装目录已存在但身份未核验；不会覆盖，请先联系负责人。', { path: defaultPath });
  return { kind: 'first-install', role: 'employee', installationDir: defaultPath };
}

function createLocationHint({ candidate, osUser } = {}) {
  if (!candidate || !ROLE.has(candidate.role) || !validIdentity(candidate.identity) || typeof osUser !== 'string' || !SID.test(osUser)) return null;
  const installationDir = canonicalWindowsPath(candidate.installationDir);
  if (!installationDir) return null;
  return { version: 1, product: PRODUCT, role: candidate.role, osUser, installationDir, installationIdentity: candidate.identity.toLowerCase() };
}

function validateLocationHint(value, { osUser, currentIdentity } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = ['version', 'product', 'role', 'osUser', 'installationDir', 'installationIdentity'];
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(value, key))) return null;
  if (value.version !== 1 || value.product !== PRODUCT || !ROLE.has(value.role) || typeof osUser !== 'string' || !SID.test(osUser) || value.osUser !== osUser || !validIdentity(value.installationIdentity) || !validIdentity(currentIdentity) || value.installationIdentity.toLowerCase() !== currentIdentity.toLowerCase()) return null;
  const installationDir = canonicalWindowsPath(value.installationDir);
  if (!installationDir) return null;
  return { version: 1, product: PRODUCT, role: value.role, osUser, installationDir, installationIdentity: value.installationIdentity.toLowerCase() };
}

module.exports = { resolveInstallLocation, createLocationHint, validateLocationHint, normalizeInstallPath: canonicalWindowsPath };
