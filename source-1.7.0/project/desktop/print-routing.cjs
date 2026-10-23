'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const A4_KINDS = new Set([
  'quotation-a4', 'erp-document-a4', 'erp-report-a4', 'ledger-report-a4',
  'inventory-count-a4', 'inventory-report-a4', 'inventory-metal-a4',
]);

function fail(code, message, status = 400) {
  const error = new Error(message); error.code = code; error.status = status; throw error;
}

function printerId(name) {
  return 'p_' + createHash('sha256').update('xjy-native-printer:' + name).digest('hex').slice(0, 32);
}

function isPhysicalDevice(device) {
  if (!device || typeof device.name !== 'string' || !device.name || device.name.length > 240 || /[\x00-\x1f\x7f]/.test(device.name)) return false;
  const words = [device.name, device.displayName, device.description, device.driverName, device.options?.['printer-make-and-model']];
  return !words.some(value => typeof value === 'string' && /pdf|xps|onenote|fax|print to file/i.test(value));
}

function isOfflineDevice(device) {
  // The trusted Windows enumerator supplements Electron 36+'s PrinterInfo,
  // which no longer guarantees a status field. These are Winspool flags.
  return device.offline === true || (Number.isSafeInteger(device.status) && (device.status & 0x1080) !== 0) ||
    (typeof device.status === 'string' && /^(offline|not available)$/i.test(device.status));
}

function queueName(value) {
  if (typeof value !== 'string' || value.length > 240 || /[\x00-\x1f\x7f]/.test(value)) {
    fail('ROUTING_CONFIG_INVALID', '打印设备绑定格式无效', 503);
  }
  return value;
}

function validateProfiles(value) {
  if (!value || typeof value !== 'object' || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
      !value.warranty || typeof value.warranty !== 'object' || !value.a4 || typeof value.a4 !== 'object') {
    fail('ROUTING_CONFIG_INVALID', '主机打印路由配置无效', 503);
  }
  queueName(value.warranty.deviceName); queueName(value.a4.deviceName);
  if (value.a4.paper !== 'A4') {
    fail('ROUTING_CONFIG_INVALID', '主机打印纸张配置无效', 503);
  }
  return value;
}

function resolvePrintRoute(kind, profiles, devices) {
  const key = kind === 'warranty' ? 'warranty' : A4_KINDS.has(kind) ? 'a4' : null;
  if (!key) fail('PRINT_KIND_INVALID', '此来源不支持主机打印');
  validateProfiles(profiles);
  const binding = profiles[key];
  if (!binding.deviceName) fail('PRINTER_UNBOUND', key === 'warranty' ? '主机尚未绑定质保单打印机' : '主机尚未绑定 A4 打印机', 503);
  const paper = binding.paper;
  if (key === 'warranty' && (!paper || typeof paper !== 'object' || !Number.isFinite(paper.widthMm) || paper.widthMm < 60 || paper.widthMm > 420 ||
      !Number.isFinite(paper.heightMm) || paper.heightMm < 60 || paper.heightMm > 500)) {
    fail('WARRANTY_PAPER_UNCONFIGURED', '请先在主机保存质保单纸张尺寸和套打设置', 503);
  }
  const matches = Array.isArray(devices) ? devices.filter(device => device?.name === binding.deviceName) : [];
  if (!matches.length) fail('PRINTER_UNAVAILABLE', '绑定的打印机未在主机上找到，请检查连接', 503);
  if (matches.length !== 1) fail('PRINTER_AMBIGUOUS', '主机返回了重复打印设备，请检查队列名称', 503);
  const selected = matches[0];
  if (!isPhysicalDevice(selected)) fail('PRINTER_VIRTUAL', '主机打印只允许已绑定的实体打印机', 503);
  if (isOfflineDevice(selected)) fail('PRINTER_OFFLINE', '绑定的打印机当前离线，请恢复连接后再打印', 503);
  return {
    printerId: printerId(selected.name), deviceName: selected.name,
    label: typeof selected.displayName === 'string' && selected.displayName ? selected.displayName : selected.name,
    routingRevision: profiles.revision,
    paper: key === 'a4' ? 'A4' : { widthMm: binding.paper.widthMm, heightMm: binding.paper.heightMm },
  };
}

function actorId(actor) {
  return actor?.staffId || actor?.id || actor?.userId;
}

function assertActor(actor) {
  const id = actorId(actor);
  if (!actor || typeof id !== 'string' || !id || id.length > 120 || actor.active === false || !['admin', 'employee'].includes(actor.role)) {
    fail('PRINT_AUTH_REQUIRED', '请登录后查看主机打印设备', 401);
  }
}

function canManage(actor) {
  return actor?.role === 'admin' && actor.local === true && actor.active !== false;
}

function createPrintRouting({ file, enumerate, audit, reauthorizeManage, legacySettingsProvider, warrantySettingsProvider }) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || typeof enumerate !== 'function') throw new TypeError('A trusted absolute config path and device enumerator are required');
  function assertConfigParent() {
    let parent = path.dirname(file);
    for (;;) {
      try {
        const stat = fs.lstatSync(parent);
        if (stat.isSymbolicLink() || !stat.isDirectory()) fail('ROUTING_CONFIG_INVALID', '打印配置目录不能使用符号链接或目录联接', 503);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      const next = path.dirname(parent);
      if (next === parent) break;
      parent = next;
    }
  }
  function read() {
    try {
      assertConfigParent();
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 65536) fail('ROUTING_CONFIG_INVALID', '打印路由配置文件无效', 503);
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!value || typeof value !== 'object' || value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0) fail('ROUTING_CONFIG_INVALID', '打印路由配置版本无效', 503);
      queueName(value.warrantyDeviceName); queueName(value.a4DeviceName);
      if (!Array.isArray(value.history) || value.history.length > 128 ||
          (value.revision > 0 && value.history.at(-1)?.revision !== value.revision)) fail('ROUTING_CONFIG_INVALID', '打印路由修改记录无效', 503);
      return value;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      if (error.code === 'ROUTING_CONFIG_INVALID') throw error;
      fail('ROUTING_CONFIG_INVALID', '打印路由配置不能读取，请由主机管理员检查', 503);
    }
  }
  function getProfiles() {
    const saved = read();
    let legacy = {}, settings = {};
    try {
      legacy = typeof legacySettingsProvider === 'function' ? legacySettingsProvider() : {};
      settings = typeof warrantySettingsProvider === 'function' ? warrantySettingsProvider() : legacy;
      if (!legacy || typeof legacy !== 'object' || !settings || typeof settings !== 'object') throw new TypeError('Invalid warranty settings');
    } catch {
      fail('ROUTING_CONFIG_INVALID', '质保单原设置不能读取，请由主机管理员检查', 503);
    }
    return {
      revision: saved?.revision || 0,
      warranty: { deviceName: queueName(saved ? saved.warrantyDeviceName : legacy.deviceName ?? ''),
        paper: Number.isFinite(settings.widthMm) && Number.isFinite(settings.heightMm) ? { widthMm: settings.widthMm, heightMm: settings.heightMm } : null },
      a4: { deviceName: saved?.a4DeviceName ?? '', paper: 'A4' },
    };
  }
  function formatOptions(actor, profiles, devices, changes = []) {
    const managed = canManage(actor);
    const publicProfile = (key, kind) => {
      const binding = profiles[key];
      let route;
      try { route = resolvePrintRoute(kind, profiles, devices); }
      catch (error) {
        return { printerId: binding.deviceName ? printerId(binding.deviceName) : '', label: binding.deviceName,
          paper: binding.paper, available: false, code: error.code, reason: error.message,
          ...(managed ? { deviceName: binding.deviceName } : {}) };
      }
      return { printerId: route.printerId, label: route.label, paper: route.paper, available: true,
        ...(managed ? { deviceName: route.deviceName } : {}) };
    };
    return {
      routingRevision: profiles.revision, canManage: managed,
      profiles: { warranty: publicProfile('warranty', 'warranty'), a4: publicProfile('a4', 'quotation-a4') },
      printers: devices.filter(isPhysicalDevice).map(device => ({ id: printerId(device.name),
        label: typeof device.displayName === 'string' && device.displayName ? device.displayName : device.name,
        ...(managed ? { deviceName: device.name } : {}) })),
      ...(managed ? { changes } : {}),
    };
  }
  async function getOptions(actor) {
    assertActor(actor);
    const profiles = getProfiles();
    let devices;
    try { devices = await enumerate(); } catch { fail('PRINTER_ENUMERATION_FAILED', '主机暂时不能读取打印设备', 503); }
    if (!Array.isArray(devices)) fail('PRINTER_ENUMERATION_FAILED', '主机打印设备列表无效', 503);
    assertActor(actor);
    return formatOptions(actor, profiles, devices, read()?.history || []);
  }
  async function assertManage(actor) {
    assertActor(actor);
    if (!canManage(actor)) fail('PRINT_MANAGE_FORBIDDEN', '只有本机主机管理员可以修改打印设备绑定', 403);
    if (typeof reauthorizeManage === 'function' && await reauthorizeManage(actor) === false) {
      fail('PRINT_MANAGE_FORBIDDEN', '主机管理员权限已经失效，请重新登录', 403);
    }
    assertActor(actor);
    if (!canManage(actor)) fail('PRINT_MANAGE_FORBIDDEN', '主机管理员权限已经失效，请重新登录', 403);
  }
  function validateUpdate(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 3 ||
        Object.keys(input).some(key => !['expectedRevision', 'warrantyDeviceName', 'a4DeviceName'].includes(key)) ||
        !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 ||
        typeof input.warrantyDeviceName !== 'string' || typeof input.a4DeviceName !== 'string' ||
        [input.warrantyDeviceName, input.a4DeviceName].some(value => value.length > 240 || /[\x00-\x1f\x7f]/.test(value))) {
      fail('ROUTING_UPDATE_INVALID', '打印绑定只接受当前修订和两个已枚举的队列名称');
    }
    return Object.freeze({ expectedRevision: input.expectedRevision, warrantyDeviceName: input.warrantyDeviceName, a4DeviceName: input.a4DeviceName });
  }
  function assertBindable(name, devices) {
    if (!name) return; // Explicitly clearing a binding leaves that type unavailable.
    const matches = devices.filter(device => device?.name === name);
    if (!matches.length) fail('PRINTER_UNAVAILABLE', '选择的打印机未在主机枚举中找到', 400);
    if (matches.length !== 1) fail('PRINTER_AMBIGUOUS', '选择的打印机名称重复，请检查 Windows 队列', 400);
    if (!isPhysicalDevice(matches[0])) fail('PRINTER_VIRTUAL', '不能将虚拟打印机绑定为实体打印目标', 400);
  }
  function atomicWrite(value) {
    const temporary = file + '.' + randomUUID() + '.tmp';
    let descriptor;
    try {
      descriptor = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(descriptor, JSON.stringify(value, null, 2));
      fs.fsyncSync(descriptor); fs.closeSync(descriptor); descriptor = undefined;
      fs.renameSync(temporary, file);
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
  async function update(actor, input) {
    const requested = validateUpdate(input);
    await assertManage(actor);
    let devices;
    try { devices = await enumerate(); } catch { fail('PRINTER_ENUMERATION_FAILED', '主机暂时不能读取打印设备', 503); }
    if (!Array.isArray(devices)) fail('PRINTER_ENUMERATION_FAILED', '主机打印设备列表无效', 503);
    await assertManage(actor);
    assertBindable(requested.warrantyDeviceName, devices); assertBindable(requested.a4DeviceName, devices);
    assertConfigParent();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let lock;
    try { lock = fs.openSync(file + '.lock', 'wx', 0o600); }
    catch (error) {
      if (error.code === 'EEXIST') fail('ROUTING_BUSY', '另一项打印绑定修改正在处理，请刷新后再试', 409);
      throw error;
    }
    let options, record;
    try {
      await assertManage(actor);
      const saved = read(), before = getProfiles();
      if (before.revision !== requested.expectedRevision) fail('ROUTING_REVISION_CONFLICT', '打印绑定已被修改，请刷新后重新选择', 409);
      if (before.revision === Number.MAX_SAFE_INTEGER) fail('ROUTING_CONFIG_INVALID', '打印绑定修订超出范围', 503);
      record = { action: 'print-routing.update', revision: before.revision + 1, actorId: actorId(actor), at: new Date().toISOString(),
        before: { warrantyDeviceName: before.warranty.deviceName, a4DeviceName: before.a4.deviceName },
        after: { warrantyDeviceName: requested.warrantyDeviceName, a4DeviceName: requested.a4DeviceName } };
      const next = { version: 1, revision: record.revision, ...record.after, history: [...(saved?.history || []), record].slice(-128) };
      while (Buffer.byteLength(JSON.stringify(next, null, 2), 'utf8') > 65536 && next.history.length > 1) next.history.shift();
      atomicWrite(next);
      const after = { revision: next.revision, warranty: { ...before.warranty, deviceName: next.warrantyDeviceName }, a4: { deviceName: next.a4DeviceName, paper: 'A4' } };
      options = formatOptions(actor, after, devices, next.history);
    } finally {
      fs.closeSync(lock); fs.unlinkSync(file + '.lock');
    }
    // A committed change always has its durable local history. The central
    // audit sink is supplementary, so its failure cannot erase that record or
    // tell the caller the binding was not saved when it actually was.
    if (typeof audit === 'function') {
      try { await audit(record); }
      catch { options.auditWarning = '绑定已保存并保留本机修改记录；中心日志暂未同步，请管理员检查。'; }
    }
    return options;
  }
  return { getProfiles, getOptions, update };
}

module.exports = { resolvePrintRoute, createPrintRouting, printerId };
