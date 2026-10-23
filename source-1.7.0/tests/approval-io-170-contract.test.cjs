'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const io170 = require('../delivery-approval/approval-io-170.cjs');

test('170 read-only reviewer is bound to its versioned approval core and keeps the fixed review-only CLI', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../delivery-approval/approval-io-170.cjs'), 'utf8');
  assert(source.includes("require('./approval-core-170.cjs')"));
  assert(source.includes("require('./approval-archive-170.cjs')"));
  assert(!source.includes("require('./approval-core.cjs')") && !source.includes("require('./approval-archive.cjs')"));
  assert(source.includes("process.argv[2]!=='--review'"));
  assert(!/process\.argv\.slice\(2\).*--installation-dir|Set-ExecutionPolicy|Start-Process|\.kill\(/s.test(source));
  assert.equal(typeof io170.runReadonlyReview, 'function');
});

test('170 reviewer rejects an unknown operation before reading package or installation paths', async () => {
  await assert.rejects(io170.runReadonlyReview({ operation: 'discover-and-write', osUser: 'S-1-5-21-100-200-300-1001' }), error => error.code === 'BAD_REQUEST');
});

test('170 reviewer requires a SID before any path access', async () => {
  await assert.rejects(io170.runReadonlyReview({ operation: 'initial', osUser: 'Administrator', role: 'employee' }), error => error.code === 'BAD_REQUEST');
});

test('170 reviewer requires an exact activation tied to the selected physical path, role, and source version', () => {
  const path = 'C:\\Users\\Employee\\AppData\\Local\\鑫金源珠宝\\员工程序';
  const activation = { version: 1, product: 'xjy-jewelry-offline', programVersion: '1.6.2', role: 'employee', installationDir: path };
  assert.equal(io170.validateActivationRecord(activation, { installationDir: path, role: 'employee', sourceVersion: '1.6.2', operation: 'initial' }), true);
  for (const bad of [{ ...activation, role: 'host' }, { ...activation, installationDir: 'C:\\Other' }, { ...activation, programVersion: '1.9.9' }, { ...activation, extra: true }]) {
    assert.throws(() => io170.validateActivationRecord(bad, { installationDir: path, role: 'employee', sourceVersion: '1.6.2', operation: 'initial' }), error => error.code === 'BAD_ACTIVATION');
  }
  assert.throws(() => io170.validateActivationRecord(activation, { installationDir: path, role: 'employee', sourceVersion: '1.6.1', operation: 'initial' }), error => error.code === 'BAD_ACTIVATION');
});

test('170 recovery accepts only a supported previous or target version and keeps the same role/path binding', () => {
  const path = 'C:\\Users\\Employee\\AppData\\Local\\鑫金源珠宝\\员工程序';
  const activation = { version: 1, product: 'xjy-jewelry-offline', programVersion: '1.7.0', role: 'employee', installationDir: path };
  assert.equal(io170.validateActivationRecord(activation, { installationDir: path, role: 'employee', operation: 'reapprove-original' }), true);
  assert.throws(() => io170.validateActivationRecord({ ...activation, programVersion: '1.9.9' }, { installationDir: path, role: 'employee', operation: 'reapprove-original' }), error => error.code === 'BAD_ACTIVATION');
});

test('legacy 1.6 source without activation requires a one-time role confirmation bound to SID, path, identity and source version', () => {
  const installationDir = 'C:\\Users\\Employee\\AppData\\Local\\鑫金源珠宝\\员工程序', osUser = 'S-1-5-21-100-200-300-1001', installationIdentity = '00000001:0000000000000001';
  const confirmation = { confirmed: true, source: 'explicit', role: 'employee', osUser, installationDir, installationIdentity, sourceVersion: '1.6.0' };
  assert.equal(io170.validateActivationRecord(null, { installationDir, installationIdentity, role: 'employee', sourceVersion: '1.6.0', osUser, legacyRoleConfirmation: confirmation }), true);
  for (const bad of [
    { ...confirmation, confirmed: false },
    { ...confirmation, role: 'host' },
    { ...confirmation, osUser: 'S-1-5-21-999' },
    { ...confirmation, installationDir: 'C:\\Other' },
    { ...confirmation, installationIdentity: '00000001:0000000000000002' },
    { ...confirmation, sourceVersion: '1.6.9' },
  ]) assert.throws(() => io170.validateActivationRecord(null, { installationDir, installationIdentity, role: 'employee', sourceVersion: '1.6.0', osUser, legacyRoleConfirmation: bad }), error => error.code === 'LEGACY_ROLE_CONFIRMATION_REQUIRED');
});

test('validated legacy employee profile marker can substitute for a one-time role prompt, but marker conflicts cannot', () => {
  const installationDir = 'C:\\Users\\Employee\\AppData\\Local\\鑫金源珠宝\\员工程序', osUser = 'S-1-5-21-100-200-300-1001', installationIdentity = '00000001:0000000000000001';
  const confirmation = { confirmed: true, source: 'employee-profile-marker', role: 'employee', osUser, installationDir, installationIdentity, sourceVersion: '1.6.1' };
  assert.equal(io170.validateActivationRecord(null, { installationDir, installationIdentity, role: 'employee', sourceVersion: '1.6.1', osUser, legacyRoleConfirmation: confirmation, profileMarkerValidated: true }), true);
  assert.throws(() => io170.validateActivationRecord(null, { installationDir, installationIdentity, role: 'employee', sourceVersion: '1.6.1', osUser, legacyRoleConfirmation: confirmation, profileMarkerValidated: false }), error => error.code === 'LEGACY_ROLE_CONFIRMATION_REQUIRED');
  assert.throws(() => io170.validateActivationRecord({ version: 1, product: 'xjy-jewelry-offline', programVersion: '1.6.1', role: 'host', installationDir }, { installationDir, role: 'employee', sourceVersion: '1.6.1', osUser, legacyRoleConfirmation: confirmation, profileMarkerValidated: true }), error => error.code === 'BAD_ACTIVATION');
});
