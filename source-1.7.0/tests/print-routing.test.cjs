'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const moduleFile = path.join(root, 'project', 'desktop', 'print-routing.cjs');
const testRoot = path.join(root, 'runtime', 'print-routing-tests');
const warrantyName = '\\\\192.168.1.196\\EPSON LQ-630K ESC/P2';
const a4Name = 'Deli M2500ADW-35J04Y(WLAN)';
const admin = () => ({ id: 'test-admin', role: 'admin', local: true, active: true });
const employee = () => ({ id: 'test-employee', role: 'employee', local: false, active: true });
const device = (name, extras = {}) => ({ name, displayName: name, description: 'Test physical printer', options: {}, status: 0, isDefault: false, ...extras });
const devices = () => [device(warrantyName), device(a4Name, { isDefault: true })];
const profiles = () => ({ revision: 7, warranty: { deviceName: warrantyName, paper: { widthMm: 215.9, heightMm: 139.7 } }, a4: { deviceName: a4Name, paper: 'A4' } });

function api() {
  // Missing implementation is an explicit first TDD failure, rather than an
  // import exception that might hide a broken fixture or syntax error.
  if (!fs.existsSync(moduleFile)) assert.fail('The fixed printer-routing implementation is missing');
  return require(moduleFile);
}

function expectedId(name) {
  return 'p_' + crypto.createHash('sha256').update('xjy-native-printer:' + name).digest('hex').slice(0, 32);
}

function fixture(t, extra = {}) {
  const dir = path.join(testRoot, crypto.randomUUID());
  fs.mkdirSync(dir, { recursive: true });
  t.after(() => {
    const resolved = fs.realpathSync(dir);
    assert.equal(path.relative(fs.realpathSync(testRoot), resolved).split(path.sep).length, 1);
    fs.rmSync(resolved, { recursive: true });
  });
  const file = path.join(dir, 'print-routing.json');
  return { dir, file, routing: api().createPrintRouting({ file, enumerate: async () => devices(), ...extra }) };
}

test('warranty and every allowed A4 source use their exact bound queue and revision', () => {
  const { resolvePrintRoute } = api();
  assert.deepEqual(resolvePrintRoute('warranty', profiles(), devices()), {
    printerId: expectedId(warrantyName), deviceName: warrantyName, label: warrantyName,
    routingRevision: 7, paper: { widthMm: 215.9, heightMm: 139.7 },
  });
  for (const kind of ['quotation-a4', 'erp-document-a4', 'erp-report-a4', 'ledger-report-a4', 'inventory-count-a4', 'inventory-report-a4', 'inventory-metal-a4']) {
    assert.deepEqual(resolvePrintRoute(kind, profiles(), devices()), {
      printerId: expectedId(a4Name), deviceName: a4Name, label: a4Name, routingRevision: 7, paper: 'A4',
    });
  }
});

test('an unbound A4 profile rejects even when an OS default physical device exists', () => {
  const { resolvePrintRoute } = api();
  const value = profiles(); value.a4.deviceName = '';
  assert.throws(() => resolvePrintRoute('quotation-a4', value, devices()), error => error.code === 'PRINTER_UNBOUND');
  assert.equal(resolvePrintRoute('warranty', value, devices()).deviceName, warrantyName);
});

test('unknown source types and malformed routing profiles cannot select a device', () => {
  const { resolvePrintRoute } = api();
  for (const kind of ['invoice-a4', 'file:///example.pdf', '', null, {}, 'WARRANTY']) {
    assert.throws(() => resolvePrintRoute(kind, profiles(), devices()), error => error.code === 'PRINT_KIND_INVALID');
  }
  assert.throws(() => resolvePrintRoute('warranty', { ...profiles(), revision: -1 }, devices()), error => error.code === 'ROUTING_CONFIG_INVALID');
});

test('an offline warranty printer does not prevent the independent A4 route', () => {
  const { resolvePrintRoute } = api();
  const list = [device(warrantyName, { status: 128 }), device(a4Name)];
  assert.throws(() => resolvePrintRoute('warranty', profiles(), list), error => error.code === 'PRINTER_OFFLINE');
  assert.equal(resolvePrintRoute('quotation-a4', profiles(), list).deviceName, a4Name);
  const second = [device(warrantyName), device(a4Name, { offline: true })];
  assert.throws(() => resolvePrintRoute('erp-document-a4', profiles(), second), error => error.code === 'PRINTER_OFFLINE');
  assert.equal(resolvePrintRoute('warranty', profiles(), second).deviceName, warrantyName);
});

test('virtual PDF, XPS, Fax and renamed virtual drivers cannot receive physical print tasks', () => {
  const { resolvePrintRoute } = api();
  for (const virtual of ['Microsoft Print to PDF', 'Microsoft XPS Document Writer', 'Fax', 'Send to OneNote']) {
    const value = profiles(); value.a4.deviceName = virtual;
    assert.throws(() => resolvePrintRoute('quotation-a4', value, [device(virtual)]), error => error.code === 'PRINTER_VIRTUAL');
  }
  assert.throws(() => resolvePrintRoute('quotation-a4', profiles(), [device(a4Name, { description: 'Microsoft Print to PDF' })]), error => error.code === 'PRINTER_VIRTUAL');
});

test('queue selection is exact and rejects a missing or ambiguous bound queue', () => {
  const { resolvePrintRoute } = api();
  for (const name of [a4Name.toLowerCase(), a4Name + ' copy', ' ' + a4Name]) {
    assert.throws(() => resolvePrintRoute('quotation-a4', profiles(), [device(name, { isDefault: true })]), error => error.code === 'PRINTER_UNAVAILABLE');
  }
  assert.throws(() => resolvePrintRoute('quotation-a4', profiles(), [device(a4Name), device(a4Name)]), error => error.code === 'PRINTER_AMBIGUOUS');
});

test('legacy warranty binding and paper migrate read-only without inventing an A4 binding', async t => {
  const original = { deviceName: warrantyName, mode: 'fields', widthMm: 215.9, heightMm: 139.7,
    offsetXmm: 3, offsetYmm: -2, scalePercent: 97, layoutOffsets: { productName: { xMm: 1, yMm: 2 } }, fontSizes: { title: 13 } };
  const before = JSON.stringify(original);
  const { file, routing } = fixture(t, { legacySettingsProvider: () => original });
  const options = await routing.getOptions(admin());
  assert.equal(options.routingRevision, 0);
  assert.equal(options.profiles.warranty.available, true);
  assert.equal(options.profiles.warranty.deviceName, warrantyName);
  assert.deepEqual(options.profiles.warranty.paper, { widthMm: 215.9, heightMm: 139.7 });
  assert.equal(options.profiles.a4.available, false);
  assert.equal(options.profiles.a4.printerId, '');
  assert.equal(options.profiles.a4.code, 'PRINTER_UNBOUND');
  assert.equal(fs.existsSync(file), false);
  assert.equal(JSON.stringify(original), before);
});

test('employees receive labels and IDs but not editable physical bindings', async t => {
  const { routing } = fixture(t, { legacySettingsProvider: () => ({ deviceName: warrantyName, widthMm: 210, heightMm: 297 }) });
  const options = await routing.getOptions(employee());
  assert.equal(options.canManage, false);
  assert.equal(options.profiles.warranty.printerId, expectedId(warrantyName));
  assert.equal(Object.hasOwn(options.profiles.warranty, 'deviceName'), false);
  assert.ok(options.printers.every(value => !Object.hasOwn(value, 'deviceName')));
  await assert.rejects(routing.getOptions(null), error => error.status === 401);
});

test('corrupt saved routing JSON fails closed instead of loading legacy or default binding', async t => {
  const { file, routing } = fixture(t, { legacySettingsProvider: () => ({ deviceName: warrantyName, widthMm: 210, heightMm: 297 }) });
  fs.writeFileSync(file, '{broken');
  await assert.rejects(routing.getOptions(admin()), error => error.code === 'ROUTING_CONFIG_INVALID');
  assert.throws(() => routing.getProfiles(), error => error.code === 'ROUTING_CONFIG_INVALID');
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
});

test('a valid A4 route remains usable when warranty paper has not been configured', () => {
  const { resolvePrintRoute } = api();
  const value = profiles(); value.warranty.paper = null;
  assert.equal(resolvePrintRoute('inventory-report-a4', value, devices()).deviceName, a4Name);
  assert.throws(() => resolvePrintRoute('warranty', value, devices()), error => error.code === 'WARRANTY_PAPER_UNCONFIGURED');
});

const updateInput = revision => ({ expectedRevision: revision, warrantyDeviceName: warrantyName, a4DeviceName: a4Name });

test('only an active local host admin can persist printer bindings', async t => {
  const { file, routing } = fixture(t);
  for (const actor of [employee(), { ...admin(), local: false }, { ...admin(), local: 'true' }, { ...admin(), active: false }]) {
    await assert.rejects(routing.update(actor, updateInput(0)), error => error.status === 401 || error.status === 403);
    assert.equal(fs.existsSync(file), false);
  }
  const options = await routing.update(admin(), updateInput(0));
  assert.equal(options.routingRevision, 1);
  assert.equal(options.profiles.a4.available, true);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).a4DeviceName, a4Name);
});

test('a stale revision cannot overwrite a newer binding and logs retain before and after', async t => {
  const events = [];
  const settings = { deviceName: warrantyName, widthMm: 215.9, heightMm: 139.7, fontSizes: { title: 17 } };
  const beforeSettings = JSON.stringify(settings);
  const { file, routing } = fixture(t, { audit: event => events.push(event), legacySettingsProvider: () => settings });
  await routing.update(admin(), updateInput(0));
  const beforeFile = fs.readFileSync(file, 'utf8');
  await assert.rejects(routing.update(admin(), { ...updateInput(0), warrantyDeviceName: '' }), error => error.code === 'ROUTING_REVISION_CONFLICT' && error.status === 409);
  assert.equal(fs.readFileSync(file, 'utf8'), beforeFile);
  const saved = JSON.parse(beforeFile);
  assert.equal(saved.history.length, 1);
  assert.equal(saved.history[0].actorId, 'test-admin');
  assert.deepEqual(saved.history[0].before, { warrantyDeviceName: warrantyName, a4DeviceName: '' });
  assert.deepEqual(saved.history[0].after, { warrantyDeviceName: warrantyName, a4DeviceName: a4Name });
  assert.equal(saved.history[0].revision, 1);
  assert.equal(events[0].action, 'print-routing.update');
  assert.equal(JSON.stringify(settings), beforeSettings);
  assert.deepEqual(routing.getProfiles().warranty.paper, { widthMm: 215.9, heightMm: 139.7 });
  assert.equal(Object.hasOwn(saved, 'fontSizes'), false);
});

test('user paths, code and unrecognized configuration fields cannot be persisted', async t => {
  const { file, routing } = fixture(t);
  const invalid = [null, [], { ...updateInput(0), file: 'F:\\do-not-access' }, { ...updateInput(0), role: 'admin' },
    { ...updateInput(0), execute: 'anything' }, { ...updateInput(0), expectedRevision: true },
    { ...updateInput(0), a4DeviceName: 'bad\nqueue' }, { ...updateInput(0), a4DeviceName: 'a'.repeat(241) }];
  for (const input of invalid) {
    await assert.rejects(routing.update(admin(), input), error => error.status === 400);
    assert.equal(fs.existsSync(file), false);
  }
});

test('binding accepts only a precisely enumerated physical device', async t => {
  const { file, routing } = fixture(t, { enumerate: async () => [...devices(), device('Microsoft Print to PDF')] });
  for (const name of [a4Name + ' copy', 'Microsoft Print to PDF']) {
    await assert.rejects(routing.update(admin(), { ...updateInput(0), a4DeviceName: name }), error => error.code === 'PRINTER_UNAVAILABLE' || error.code === 'PRINTER_VIRTUAL');
    assert.equal(fs.existsSync(file), false);
  }
});

test('admins may save an offline enumerated queue while the other printer remains available', async t => {
  const { routing } = fixture(t, { enumerate: async () => [device(warrantyName, { offline: true }), device(a4Name)],
    warrantySettingsProvider: () => ({ widthMm: 215.9, heightMm: 139.7 }) });
  const options = await routing.update(admin(), updateInput(0));
  assert.equal(options.profiles.warranty.available, false);
  assert.equal(options.profiles.warranty.code, 'PRINTER_OFFLINE');
  assert.equal(options.profiles.a4.available, true);
});

test('revoking host admin access during device enumeration prevents the write', async t => {
  let release; let entered;
  const enumeration = new Promise(resolve => { release = resolve; });
  const enumerating = new Promise(resolve => { entered = resolve; });
  let allowed = true;
  const { file, routing } = fixture(t, { enumerate: async () => { entered(); return enumeration; },
    reauthorizeManage: async () => allowed });
  const pending = routing.update(admin(), updateInput(0));
  await enumerating; allowed = false; release(devices());
  await assert.rejects(pending, error => error.status === 403);
  assert.equal(fs.existsSync(file), false);
});

test('a final live admin check immediately before persistence prevents revoked writes', async t => {
  let count = 0;
  const { file, routing } = fixture(t, { reauthorizeManage: async () => ++count < 3 });
  await assert.rejects(routing.update(admin(), updateInput(0)), error => error.status === 403);
  assert.equal(count, 3);
  assert.equal(fs.existsSync(file), false);
});

test('concurrent routing instances cannot both overwrite the same revision', async t => {
  const { file, routing } = fixture(t);
  const second = api().createPrintRouting({ file, enumerate: async () => devices() });
  const values = await Promise.allSettled([routing.update(admin(), updateInput(0)), second.update(admin(), { ...updateInput(0), warrantyDeviceName: '' })]);
  assert.equal(values.filter(value => value.status === 'fulfilled').length, 1);
  const rejected = values.find(value => value.status === 'rejected');
  assert.equal(rejected.reason.status, 409);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.revision, 1);
  assert.equal(saved.history.length, 1);
});

test('a busy configuration lock fails without changing saved settings', async t => {
  const { file, routing } = fixture(t);
  fs.writeFileSync(file + '.lock', 'other-test-writer');
  await assert.rejects(routing.update(admin(), updateInput(0)), error => error.code === 'ROUTING_BUSY' && error.status === 409);
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.readFileSync(file + '.lock', 'utf8'), 'other-test-writer');
});

test('an external audit failure keeps the committed local change record visible', async t => {
  const { file, routing } = fixture(t, { audit: async () => { throw new Error('Synthetic audit failure'); } });
  const options = await routing.update(admin(), updateInput(0));
  assert.equal(options.routingRevision, 1);
  assert.equal(typeof options.auditWarning, 'string');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.history[0].revision, 1);
  assert.equal(saved.history[0].actorId, 'test-admin');
});

test('pending update parameters are snapshotted and cannot change during asynchronous enumeration', async t => {
  let release; let entered;
  const enumerating = new Promise(resolve => { entered = resolve; });
  const enumeration = new Promise(resolve => { release = resolve; });
  const { file, routing } = fixture(t, { enumerate: async () => { entered(); return enumeration; } });
  const input = updateInput(0);
  const pending = routing.update(admin(), input);
  await enumerating; input.a4DeviceName = ''; release(devices());
  await pending;
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).a4DeviceName, a4Name);
});

test('a hard-linked config is rejected before a valid alternate target can be read or replaced', async t => {
  const { dir, file, routing } = fixture(t);
  const source = path.join(dir, 'fake-protected.json');
  const original = JSON.stringify({ version: 1, revision: 0, warrantyDeviceName: '', a4DeviceName: a4Name, history: [] });
  fs.writeFileSync(source, original); fs.linkSync(source, file);
  await assert.rejects(routing.getOptions(admin()), error => error.code === 'ROUTING_CONFIG_INVALID');
  await assert.rejects(routing.update(admin(), updateInput(0)), error => error.code === 'ROUTING_CONFIG_INVALID');
  assert.equal(fs.readFileSync(source, 'utf8'), original);
  assert.equal(fs.lstatSync(file).nlink, 2);
});

test('a junction parent cannot redirect printer config outside the owned folder', async t => {
  const { dir } = fixture(t);
  const actual = path.join(dir, 'fake-protected-folder');
  const link = path.join(dir, 'redirected-config');
  fs.mkdirSync(actual);
  const original = JSON.stringify({ version: 1, revision: 0, warrantyDeviceName: '', a4DeviceName: a4Name, history: [] });
  fs.writeFileSync(path.join(actual, 'print-routing.json'), original);
  fs.symlinkSync(actual, link, process.platform === 'win32' ? 'junction' : 'dir');
  const routing = api().createPrintRouting({ file: path.join(link, 'print-routing.json'), enumerate: async () => devices() });
  await assert.rejects(routing.getOptions(admin()), error => error.code === 'ROUTING_CONFIG_INVALID');
  await assert.rejects(routing.update(admin(), updateInput(0)), error => error.code === 'ROUTING_CONFIG_INVALID');
  assert.equal(fs.readFileSync(path.join(actual, 'print-routing.json'), 'utf8'), original);
});

test('local committed routing change history is available to host admins only', async t => {
  const { routing } = fixture(t);
  await routing.update(admin(), updateInput(0));
  const hostOptions = await routing.getOptions(admin());
  assert.equal(hostOptions.changes[0].revision, 1);
  assert.equal(hostOptions.changes[0].actorId, 'test-admin');
  const employeeOptions = await routing.getOptions(employee());
  assert.equal(Object.hasOwn(employeeOptions, 'changes'), false);
});

test('router emits only trusted paper dimensions and never forwards arbitrary paper fields', () => {
  const value = profiles(); value.warranty.paper.path = 'F:\\must-not-forward';
  const route = api().resolvePrintRoute('warranty', value, devices());
  assert.deepEqual(route.paper, { widthMm: 215.9, heightMm: 139.7 });
});
