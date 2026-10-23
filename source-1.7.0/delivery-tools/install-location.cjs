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

function normalizeCandidateResult(row, supportedVersions) {
  if (!row || typeof row !== 'object' || !SOURCES.has(row.source) || !['valid', 'needs-role', 'invalid'].includes(row.outcome)) return { error: 'BAD_CANDIDATE_RESULT' };
  const installPath = canonicalWindowsPath(row.path);
  if (!installPath) return row.outcome === 'valid' ? { error: 'BAD_CANDIDATE_RESULT', source: row.source } : row.knownProduct === true ? { error: 'KNOWN_INSTALL_INVALID', source: row.source } : null;
  if (row.outcome === 'invalid') return row.knownProduct === true ? { error: 'KNOWN_INSTALL_INVALID', source: row.source, path: installPath, reason: typeof row.code === 'string' ? row.code : 'CANDIDATE_INVALID' } : null;
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

function resolveInstallLocation({ mode = 'maintenance', candidateResults, supportedVersions, requestedRole, selectedIdentity, legacyRoleConfirmation, osUser, defaultEmployeeDirectory, defaultDirectoryExists } = {}) {
  if (!MODE.has(mode) || requestedRole !== undefined && !ROLE.has(requestedRole) || !Array.isArray(candidateResults) || candidateResults.length > 256 || !Array.isArray(supportedVersions) || !supportedVersions.length || supportedVersions.length > 128 || new Set(supportedVersions).size !== supportedVersions.length || supportedVersions.some(version => !validVersion(version))) return blocked('BAD_RESOLUTION_INPUT', '无法核验安装位置输入。');
  const allowed = new Set(supportedVersions);
  const normalized = [];
  for (const row of candidateResults) {
    const item = normalizeCandidateResult(row, allowed);
    if (item?.error) return blocked(item.error, '发现无法核验的鑫金源程序位置；已停止，未修改程序或资料。', { source: item.source, path: item.path, reason: item.reason });
    if (item) normalized.push(item);
  }

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

  let candidates = [...byIdentity.values()].map(candidate => ({ ...candidate, sources: candidate.sources.sort((a, b) => sourceRank(a) - sourceRank(b)) }));
  candidates.sort((a, b) => sourceRank(a.sources[0]) - sourceRank(b.sources[0]) || (a.role || 'legacy').localeCompare(b.role || 'legacy') || b.version.localeCompare(a.version, 'en', { numeric: true }) || a.installationDir.localeCompare(b.installationDir, 'en', { sensitivity: 'base' }));
  const needsRole = candidates.filter(candidate => candidate.requiresRoleConfirmation);
  if (legacyRoleConfirmation !== undefined) {
    if (!legacyRoleConfirmation || typeof legacyRoleConfirmation !== 'object' || legacyRoleConfirmation.confirmed !== true || !validIdentity(legacyRoleConfirmation.installationIdentity) || !ROLE.has(legacyRoleConfirmation.role) || typeof osUser !== 'string' || !SID.test(osUser) || legacyRoleConfirmation.osUser !== osUser) return blocked('LEGACY_ROLE_CONFIRMATION_INVALID', '旧版安装角色确认记录无效；未写入审定。');
    const selected = needsRole.find(candidate => candidate.identity === legacyRoleConfirmation.installationIdentity.toLowerCase());
    if (!selected || legacyRoleConfirmation.installationDir && canonicalWindowsPath(legacyRoleConfirmation.installationDir)?.toLowerCase() !== selected.installationDir.toLowerCase()) return blocked('LEGACY_ROLE_CONFIRMATION_MISMATCH', '角色确认与选定的旧版安装目录不一致。');
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
    if (!matching.length && candidates.length) return blocked('ROLE_MISMATCH', '找到的程序角色与本次更新目标不符；没有改用其他角色或新建副本。', { requestedRole, foundRoles: [...new Set(candidates.map(candidate => candidate.role))] });
    candidates = matching;
  }

  if (candidates.length === 1) return { kind: 'existing', candidate: candidates[0] };
  if (candidates.length > 1) return { kind: 'choose', candidates };
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
