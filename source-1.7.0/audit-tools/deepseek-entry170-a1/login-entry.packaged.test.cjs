'use strict';
// project/desktop/login-entry.packaged.test.cjs
// 覆盖：① 修补前登录页无入口（缺陷复现）② 修补后入口存在且不改安全模块 ③ 打包 asar 里确有新标记，
//       且旧包无该标记（差分，防止把既有字符串误当修复证据）。
// 用法：
//   复现缺陷： node login-entry.packaged.test.cjs --before-patch
//   修补之后： node login-entry.packaged.test.cjs
//   打包之后： node login-entry.packaged.test.cjs --built <新app.asar> --frozen <现网app.asar>
// 只读：不写文件、不联网、不启动进程。
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PINNED_SECURITY = 'c7d97d1a411395da8b7f379768ca9f921c43ddaa171932bac4d7b3d92a607e1b';
const LABEL = '版本与更新';
let pass = 0, fail = 0;
const info = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log('[PASS] ' + name + (detail ? ' ' + detail : '')); }
  else { fail++; console.log('[FAIL] ' + name + (detail ? ' ' + detail : '')); }
}
function note(name, detail) { console.log('[INFO] ' + name + ' ' + detail); info.push(name); }

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : ''; };
const mainPath = value('--main') || path.join(__dirname, 'renderer', 'main.tsx');
const securityPath = value('--security') || path.join(__dirname, 'employee-update.cjs');
const builtPath = value('--built');
const frozenPath = value('--frozen');
const beforePatch = flag('--before-patch');

// 打包态标记匹配：兼容原文 UTF-8，也兼容压缩器把中文转成 \uXXXX 转义
const labelUtf8 = Buffer.from(LABEL, 'utf8');
const labelEscaped = /\\u7248\\u672[cC]\\u4[eE]0[eE]\\u66[fF]4\\u65[bB]0/;
function hasLabel(buffer) {
  if (buffer.includes(labelUtf8)) return true;
  return labelEscaped.test(buffer.toString('latin1'));
}

// ---- 1. 源码结构 ----
const source = fs.readFileSync(mainPath, 'utf8');
const loginStart = source.indexOf('<main className="desktop-auth">');
const loginEnd = source.indexOf('</main>');
const loginRegion = loginStart >= 0 && loginEnd > loginStart ? source.slice(loginStart, loginEnd) : '';
const globalRegion = source.slice(loginEnd > 0 ? loginEnd : 0);
const hasImport = source.includes('import EmployeeUpdate from "./employee-update";');
const hasState = source.includes('const [updateOpen, setUpdateOpen] = useState(false);');
const hasButton = loginRegion.includes(LABEL) && loginRegion.includes('setUpdateOpen(true)');
const hasPanel = globalRegion.includes('{updateOpen && <EmployeeUpdate onClose={() => setUpdateOpen(false)} />}');
const dirty = /child_process|node:fs|node:net|\bfetch\s*\(/.test(loginRegion);

note('源码', mainPath + ' 长度=' + source.length);
check('S1 定位登录/连接页渲染区', loginStart >= 0 && loginEnd > loginStart, 'login=' + loginStart + '..' + loginEnd);

if (beforePatch) {
  check('S2[缺陷复现] 修补前登录页没有更新入口', !hasButton, 'button=' + hasButton);
  check('S3[缺陷复现] 修补前未引入面板状态与渲染', !hasState && !hasPanel, 'state=' + hasState + ' panel=' + hasPanel);
} else {
  check('S2 登录页存在可见更新入口', hasButton, 'button=' + hasButton);
  check('S3 入口只打开既有面板（状态+渲染+导入齐备）', hasState && hasPanel && hasImport, 'state=' + hasState + ' panel=' + hasPanel + ' import=' + hasImport);
}
check('S4 登录页补丁区未新增网络/文件/进程调用', !dirty, 'region=' + loginRegion.length);
check('S5 employee-update.cjs 保持原 SHA（authorize 未改）',
  crypto.createHash('sha256').update(fs.readFileSync(securityPath)).digest('hex') === PINNED_SECURITY);

// ---- 2. 打包态（asar 差分） ----
if (!builtPath) {
  note('打包态', '未提供 --built，跳过（打包后必须补跑）');
} else {
  const built = fs.readFileSync(builtPath);
  const builtSha = crypto.createHash('sha256').update(built).digest('hex');
  note('新包', builtPath + ' 大小=' + built.length + ' sha256=' + builtSha);
  check('B1 新包 asar 含更新入口标记', hasLabel(built), 'label=' + LABEL);
  if (frozenPath) {
    const frozen = fs.readFileSync(frozenPath);
    note('旧包', frozenPath + ' 大小=' + frozen.length + ' sha256=' + crypto.createHash('sha256').update(frozen).digest('hex'));
    check('B2 旧包不含该标记（证明标记属本次修复，非既有字符串）', !hasLabel(frozen), '旧包含标记=' + hasLabel(frozen));
  } else {
    note('差分', '未提供 --frozen，B2 跳过');
  }
  note('安全模块', '新包内是否含 LOGIN_REQUIRED 字符串：' + built.includes(Buffer.from('LOGIN_REQUIRED', 'utf8')) + '（仅参考，不作判定）');
}

// ---- 3. 与安全模块相关的行为验证入口说明 ----
note('鉴权测试', '请同时运行 employee-update.authorize.test.cjs（T1-T10）');

console.log('合计 ' + (pass + fail) + ' 项：PASS ' + pass + '，FAIL ' + fail);
process.exitCode = fail === 0 ? 0 : 1;