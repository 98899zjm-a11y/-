'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { fixture } = require('./employee-update-fixtures.cjs');
const { createTrustedUpdatePolicy, verifySignedCatalog, createEmployeeUpdateCache } = require('../project/desktop/employee-update-cache.cjs');

test('default fixture captures the current time once without extending the one-day catalog lifetime', async t => {
  const before = Date.now(), f = await fixture(t), after = Date.now();
  assert.ok(f.now >= before && f.now <= after, 'fixture must not retain a calendar-date expiry');
  assert.equal(f.cacheOptions.now(), f.now);
  assert.equal(Date.parse(f.catalog.publishedAt), f.now - 1000);
  assert.equal(Date.parse(f.catalog.expiresAt), f.now + 86400000);
  assert.equal(verifySignedCatalog(f.envelope, createTrustedUpdatePolicy({ ...f.cacheOptions, now: () => after })).version, f.catalog.version);
});

test('trusted tests can choose one explicit clock, including zero, and all fixture timestamps use it', async t => {
  for (const now of [0, Date.UTC(2026, 9, 14), Date.UTC(2030, 0, 1)]) {
    const f = await fixture(t, { now });
    assert.equal(f.now, now);
    assert.equal(f.cacheOptions.now(), now);
    assert.equal(Date.parse(f.catalog.publishedAt), now - 1000);
    assert.equal(Date.parse(f.catalog.expiresAt), now + 86400000);
    assert.equal(verifySignedCatalog(f.envelope, createTrustedUpdatePolicy(f.cacheOptions)).version, f.catalog.version);
  }
});

test('a valid signed fixture catalog still expires at its exact deadline before any cache stage is accepted', async t => {
  const f = await fixture(t, { now: Date.UTC(2026, 9, 14) }), expires = Date.parse(f.catalog.expiresAt);
  assert.equal(verifySignedCatalog(f.envelope, createTrustedUpdatePolicy({ ...f.cacheOptions, now: () => expires - 1 })).version, f.catalog.version);
  for (const now of [expires, expires + 1]) {
    const options = { ...f.cacheOptions, now: () => now };
    assert.throws(() => verifySignedCatalog(f.envelope, createTrustedUpdatePolicy(options)), e => e.code === 'EXPIRED_CATALOG');
    const cache = createEmployeeUpdateCache(options);
    try { await assert.rejects(cache.begin(f.catalog), e => e.code === 'EXPIRED_CATALOG'); }
    finally { await cache.close(); }
  }
});
