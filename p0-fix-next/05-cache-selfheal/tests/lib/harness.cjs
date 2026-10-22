'use strict';
// Minimal assertion harness shared by the four P0 tests.
const results = [];
function check(name, fn) {
  try {
    const detail = fn();
    results.push({ name, ok: true, detail: detail === undefined ? '' : String(detail) });
  } catch (error) {
    results.push({ name, ok: false, detail: error && error.message ? error.message : String(error) });
  }
}
async function checkAsync(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail === undefined ? '' : String(detail) });
  } catch (error) {
    results.push({ name, ok: false, detail: error && error.message ? error.message : String(error) });
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}
function assertEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message || 'not equal'}: actual=${a} expected=${e}`);
}
function assertCode(error, code, message) {
  assert(error && error.code === code, `${message || 'code'}: actual=${error && error.code} (${error && error.message}) expected=${code}`);
}
function throwsCode(fn, code) {
  try { fn(); } catch (error) { assertCode(error, code, 'unexpected error code'); return error; }
  throw new Error(`expected throw with code ${code}, nothing thrown`);
}
function finish(title) {
  let failed = 0;
  console.log(`\n===== ${title} =====`);
  for (const row of results) {
    console.log(`${row.ok ? 'PASS' : 'FAIL'}  ${row.name}${row.detail ? '  -> ' + row.detail : ''}`);
    if (!row.ok) failed += 1;
  }
  console.log(`----- ${results.length - failed}/${results.length} passed, ${failed} failed -----`);
  process.exitCode = failed === 0 ? 0 : 1;
}
module.exports = { check, checkAsync, assert, assertEqual, assertCode, throwsCode, finish };
