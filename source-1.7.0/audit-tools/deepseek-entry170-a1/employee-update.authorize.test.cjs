'use strict';
// project/desktop/employee-update.authorize.test.cjs
// 证明：未登录/非员工设备不能执行任何升级动作；authorize 门禁未削弱；
//       无拉清单、无下载、无缓存写入、无安装助手调用。
// 运行：node employee-update.authorize.test.cjs   （在 project/desktop 下）
// 只读：不联网、不写文件、不启动进程，全部依赖为内存桩。
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createEmployeeUpdate } = require('./employee-update.cjs');

const PINNED = 'c7d97d1a411395da8b7f379768ca9f921c43ddaa171932bac4d7b3d92a607e1b';
const SOURCE = path.join(__dirname, 'employee-update.cjs');
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('[PASS] ' + name + (detail ? ' ' + detail : '')); }
  else { fail++; console.log('[FAIL] ' + name + (detail ? ' ' + detail : '')); }
}

check('P0 employee-update.cjs 未被改动（authorize 原样）',
  crypto.createHash('sha256').update(fs.readFileSync(SOURCE)).digest('hex') === PINNED);
const text = fs.readFileSync(SOURCE, 'utf8');
check('P1 authorize 仍同时要求 active 与 authenticated',
  text.includes('actor.active !== true || actor.authenticated !== true'));
check('P2 authorize 仍先要求员工设备', text.includes("fail('EMPLOYEE_DEVICE_REQUIRED'"));
check('P3 install 前仍再次重新授权', (text.match(/await authorize\(\)/g) || []).length >= 4);

const { publicKey } = crypto.generateKeyPairSync('ed25519');
function makeOptions(over) {
  const calls = { catalog: 0, chunk: 0, installer: 0, begin: 0, write: 0, seal: 0 };
  const base = {
    supportedMajor: 1, currentVersion: '1.7.0', trustedPublicKey: publicKey,
    platform: 'win32', arch: 'x64', allowedFiles: ['app.asar'],
    isEmployeeClient: async () => true,
    resolveActor: async () => null,
    fetchCatalog: async () => { calls.catalog++; throw new Error('不得拉清单'); },
    fetchChunk: async () => { calls.chunk++; throw new Error('不得下载'); },
    installer: async () => { calls.installer++; throw new Error('不得安装'); },
    audit: async () => {},
    storage: {
      begin: async () => { calls.begin++; return 'stage-x'; },
      write: async () => { calls.write++; },
      read: async () => Buffer.alloc(0),
      size: async () => 0,
      seal: async () => { calls.seal++; },
      remove: async () => {},
      getAcceptedSequence: async () => 0,
      setAcceptedSequence: async () => {}
    }
  };
  return { options: Object.assign(base, over || {}), calls };
}

(async () => {
  // 1) 未登录（登录页打开面板时走这条）
  const a = makeOptions();
  const ua = createEmployeeUpdate(a.options);
  const capA = await ua.getCapability();
  check('T1 未登录：可打开面板但不可安装',
    capA.supported === true && capA.canInstall === false && capA.code === 'LOGIN_REQUIRED', JSON.stringify(capA));

  const rA1 = await ua.run({ intent: 'install' });
  check('T2 未登录 install 被拒绝', rA1.ok === false && rA1.code === 'LOGIN_REQUIRED', rA1.code);
  check('T3 未登录：状态如实报错，不伪造成 latest/ready',
    rA1.state.phase === 'error' && rA1.state.code === 'LOGIN_REQUIRED', rA1.state.phase + '/' + rA1.state.code);

  const rA2 = await ua.run({ intent: 'check' });
  check('T4 未登录 check 被拒绝且不拉清单',
    rA2.ok === false && rA2.code === 'LOGIN_REQUIRED' && a.calls.catalog === 0, rA2.code + ' catalog=' + a.calls.catalog);

  await ua.run({ intent: 'install' });
  check('T5 重复点击仍拒绝，无缓存写入与安装调用',
    a.calls.catalog === 0 && a.calls.chunk === 0 && a.calls.begin === 0 && a.calls.write === 0 &&
    a.calls.installer === 0 && a.calls.seal === 0, JSON.stringify(a.calls));

  // 2) 非员工设备（主机/网页）
  const b = makeOptions({ resolveActor: async () => ({ id: 'h1', active: true, authenticated: true }), isEmployeeClient: async () => false });
  const ub = createEmployeeUpdate(b.options);
  const capB = await ub.getCapability();
  check('T6 非员工设备：面板可见但不可安装',
    capB.canInstall === false && capB.code === 'EMPLOYEE_DEVICE_REQUIRED', JSON.stringify(capB));
  const rB = await ub.run({ intent: 'install' });
  check('T7 非员工设备 install 被拒绝且无副作用',
    rB.ok === false && rB.code === 'EMPLOYEE_DEVICE_REQUIRED' && b.calls.catalog === 0 && b.calls.installer === 0, rB.code);

  // 3) 已登录员工：门禁因鉴权而开，不因面板出现在登录页而开
  const c = makeOptions({ resolveActor: async () => ({ id: 'e1', active: true, authenticated: true }) });
  const uc = createEmployeeUpdate(c.options);
  const capC = await uc.getCapability();
  check('T8 已登录员工：canInstall=true', capC.canInstall === true, JSON.stringify(capC));
  check('T9 仅取能力不产生副作用', c.calls.catalog === 0 && c.calls.installer === 0, JSON.stringify(c.calls));

  const rD = await uc.run({ intent: 'upgrade-everything' });
  check('T10 非法意图拒绝且无副作用',
    rD.ok === false && rD.code === 'INVALID_INTENT' && c.calls.catalog === 0 && c.calls.installer === 0, rD.code);

  console.log('合计 ' + (pass + fail) + ' 项：PASS ' + pass + '，FAIL ' + fail);
  process.exitCode = fail === 0 ? 0 : 1;
})().catch(err => { console.error('[FAIL] 未预期异常：', err); process.exitCode = 1; });