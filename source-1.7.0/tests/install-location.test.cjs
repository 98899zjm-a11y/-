'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveInstallLocation, createLocationHint, validateLocationHint } = require('../delivery-tools/install-location.cjs');

const target = 'C:\\Users\\Staff\\AppData\\Local\\鑫金源珠宝\\员工程序';
const identity1 = '00000001:0000000000000001';
const identity2 = '00000002:0000000000000002';
const supportedVersions = ['1.6.0', '1.6.1', '1.6.2', '1.7.0'];
function valid(installPath, identity, role = 'employee', version = '1.6.2', source = 'remembered') {
  return { source, path: installPath, outcome: 'valid', knownProduct: true, candidate: { installationDir: installPath, identity, role, version } };
}
function invalid(installPath, code, knownProduct = true, source = 'uninstall-install-location') {
  return { source, path: installPath, outcome: 'invalid', knownProduct, code };
}
function legacy(installPath, identity, version = '1.6.0', source = 'shortcut') {
  return { source, path: installPath, outcome: 'needs-role', knownProduct: true, candidate: { installationDir: installPath, identity, version } };
}
function resolve(options) {
  const result = resolveInstallLocation({ mode: 'maintenance', supportedVersions, defaultEmployeeDirectory: target, defaultDirectoryExists: false, ...options });
  assert.ok(result && typeof result === 'object', 'resolver must return an explicit state');
  return result;
}

test('a single verified installation is selected without prompting', () => {
  const result = resolve({ candidateResults: [valid(target, identity1)] });
  assert.deepEqual(result, { kind: 'existing', candidate: { installationDir: target, identity: identity1, role: 'employee', version: '1.6.2', sources: ['remembered'] } });
});

test('same physical installation found in the hint, registry and shortcut is one candidate', () => {
  const result = resolve({ candidateResults: [valid(target, identity1, 'employee', '1.6.2', 'remembered'), valid(target, identity1, 'employee', '1.6.2', 'uninstall-install-location'), valid(target, identity1, 'employee', '1.6.2', 'shortcut')] });
  assert.equal(result.kind, 'existing');
  assert.deepEqual(result.candidate.sources, ['remembered', 'uninstall-install-location', 'shortcut']);
});

test('distinct verified installations require a user choice and are presented in stable order', () => {
  const second = 'D:\\Apps\\XJY';
  const result = resolve({ candidateResults: [valid(second, identity2, 'employee', '1.6.1', 'shortcut'), valid(target, identity1, 'employee', '1.6.2', 'remembered')] });
  assert.equal(result.kind, 'choose');
  assert.deepEqual(result.candidates.map(candidate => candidate.installationDir), [target, second]);
});

test('requested role selects only matching signed candidates', () => {
  const host = valid('C:\\Program Files\\XJY', '00000003:0000000000000003', 'host');
  const employee = valid(target, identity1);
  const result = resolve({ candidateResults: [host, employee], requestedRole: 'employee' });
  assert.equal(result.kind, 'existing');
  assert.equal(result.candidate.role, 'employee');
});

test('host install cannot be selected as an employee target', () => {
  const host = valid('C:\\Program Files\\XJY', '00000003:0000000000000003', 'host');
  const result = resolve({ candidateResults: [host], requestedRole: 'employee' });
  assert.equal(result.kind, 'blocked');
  assert.equal(result.code, 'ROLE_MISMATCH');
});

test('conflicting records for the same physical directory block instead of guessing', () => {
  const result = resolve({ candidateResults: [valid(target, identity1, 'employee', '1.6.2'), valid('D:\\Alias\\XJY', identity1, 'employee', '1.6.1', 'shortcut')] });
  assert.equal(result.kind, 'blocked');
  assert.equal(result.code, 'CONFLICTING_IDENTITY');
});

test('known XJY installation with an unsupported or changed identity blocks fallback and overwrite', () => {
  const result = resolve({ candidateResults: [invalid(target, 'SOURCE_ENGINE_MISMATCH', true)], requestedRole: 'employee', mode: 'first-install', defaultDirectoryExists: true });
  assert.equal(result.kind, 'blocked');
  assert.equal(result.code, 'KNOWN_INSTALL_INVALID');
});

test('a canonical-looking arbitrary version string is rejected unless present in the signed version allowlist', () => {
  const result = resolve({ candidateResults: [valid(target, identity1, 'employee', '1.9.9')] });
  assert.equal(result.kind, 'blocked');
  assert.equal(result.code, 'KNOWN_INSTALL_INVALID');
  assert.equal(result.reason, 'UNSUPPORTED_SOURCE_VERSION');
});

test('path aliases and malformed signed version allowlists fail closed', () => {
  const aliased = resolve({ candidateResults: [valid('C:\\Apps\\XJY\\..\\Other', identity1)] });
  assert.equal(aliased.kind, 'blocked');
  assert.equal(aliased.code, 'BAD_CANDIDATE_RESULT');
  assert.equal(resolveInstallLocation({ mode: 'maintenance', candidateResults: [], supportedVersions: ['1.6.2', '1.6.2'] }).code, 'BAD_RESOLUTION_INPUT');
});

test('unrelated spoofed display-name candidate is ignored but never treated as a verified install', () => {
  const result = resolve({ candidateResults: [invalid('C:\\Temp\\FakeXJY', 'ACTIVATION_MISSING', false), valid(target, identity1)] });
  assert.equal(result.kind, 'existing');
  assert.equal(result.candidate.installationDir, target);
});

test('first install uses LocalAppData only when no valid or conflicting install exists and the target is absent', () => {
  const fresh = resolve({ candidateResults: [], requestedRole: 'employee', mode: 'first-install' });
  assert.deepEqual(fresh, { kind: 'first-install', role: 'employee', installationDir: target });
  const occupied = resolve({ candidateResults: [], requestedRole: 'employee', mode: 'first-install', defaultDirectoryExists: true });
  assert.equal(occupied.kind, 'blocked');
  assert.equal(occupied.code, 'DEFAULT_TARGET_OCCUPIED');
});

test('first-install mode never invents a host destination', () => {
  const result = resolve({ candidateResults: [], requestedRole: 'host', mode: 'first-install' });
  assert.equal(result.kind, 'blocked');
  assert.equal(result.code, 'HOST_FIRST_INSTALL_UNSUPPORTED');
});

test('remembered location is a minimal advisory record bound to SID, role, and physical directory identity', () => {
  const candidate = { installationDir: target, identity: identity1, role: 'employee', version: '1.6.2' };
  const hint = createLocationHint({ candidate, osUser: 'S-1-5-21-1001' });
  assert.deepEqual(hint, { version: 1, product: 'xjy-jewelry-offline', role: 'employee', osUser: 'S-1-5-21-1001', installationDir: target, installationIdentity: identity1 });
  assert.equal(validateLocationHint(hint, { osUser: 'S-1-5-21-1001', currentIdentity: identity1 }).installationDir, target);
  assert.equal(validateLocationHint(hint, { osUser: 'S-1-5-21-1002', currentIdentity: identity1 }), null);
  assert.equal(validateLocationHint(hint, { osUser: 'S-1-5-21-1001', currentIdentity: identity2 }), null);
  assert.equal(validateLocationHint({ ...hint, extra: 'forged' }, { osUser: 'S-1-5-21-1001', currentIdentity: identity1 }), null);
});

test('a legacy 1.6 install with no activation marker requires one explicit role confirmation', () => {
  const result = resolve({ candidateResults: [legacy(target, identity1)], requestedRole: 'employee' });
  assert.equal(result.kind, 'confirm-role');
  assert.equal(result.candidate.installationDir, target);
  assert.equal(result.candidate.requiresRoleConfirmation, true);
});

test('one-time legacy role confirmation is bound to the same SID and physical installation', () => {
  const sid = 'S-1-5-21-100-200-300-1001';
  const legacyResult = [legacy(target, identity1)];
  const confirmed = resolve({ candidateResults: legacyResult, requestedRole: 'employee', osUser: sid, legacyRoleConfirmation: { confirmed: true, installationIdentity: identity1, role: 'employee', osUser: sid } });
  assert.equal(confirmed.kind, 'existing');
  assert.equal(confirmed.candidate.role, 'employee');
  for (const confirmation of [
    { confirmed: true, installationIdentity: identity2, role: 'employee', osUser: sid },
    { confirmed: true, installationIdentity: identity1, role: 'host', osUser: sid },
    { confirmed: true, installationIdentity: identity1, role: 'employee', osUser: 'S-1-5-21-999' },
  ]) assert.equal(resolve({ candidateResults: legacyResult, requestedRole: 'employee', osUser: sid, legacyRoleConfirmation: confirmation }).kind, 'blocked');
});

test('a validated legacy role marker can resolve an activation-less install, but conflicting markers block', () => {
  const marked = { source: 'legacy-profile', path: target, outcome: 'valid', knownProduct: true, candidate: { installationDir: target, identity: identity1, role: 'employee', version: '1.6.0' } };
  assert.equal(resolve({ candidateResults: [marked], requestedRole: 'employee' }).kind, 'existing');
  const conflict = resolve({ candidateResults: [invalid(target, 'CONFLICTING_LEGACY_ROLE_MARKERS', true, 'legacy-profile')] });
  assert.equal(conflict.kind, 'blocked');
});
