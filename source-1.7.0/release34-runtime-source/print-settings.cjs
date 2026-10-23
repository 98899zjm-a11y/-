'use strict';

const fs = require('node:fs');
const path = require('node:path');
const defaults = Object.freeze({ deviceName: '', mode: 'full', widthMm: 210, heightMm: 297, offsetXmm: 0, offsetYmm: 0, scalePercent: 100, copies: 1, phone: '', standard: '', afterSalesWechat: '', layoutOffsets: Object.freeze({}), fontSizes: Object.freeze({}) });
function validatePrintSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('打印设置格式无效');
  const result = { ...defaults, ...input };
  const text = (key, maximum) => { if (typeof result[key] !== 'string' || result[key].length > maximum || /[\x00-\x1f]/.test(result[key])) throw new Error('打印设置中的文字无效'); result[key] = result[key].trim(); };
  for (const [key, maximum] of [['deviceName', 240], ['phone', 50], ['standard', 100], ['afterSalesWechat', 50]]) text(key, maximum);
  if (!['full', 'fields'].includes(result.mode)) throw new Error('请选择完整模板或预印纸套打');
  for (const [key, min, max] of [['widthMm', 60, 420], ['heightMm', 60, 500], ['offsetXmm', -30, 30], ['offsetYmm', -30, 30], ['scalePercent', 60, 140], ['copies', 1, 10]]) {
    if (typeof result[key] !== 'number' || !Number.isFinite(result[key]) || result[key] < min || result[key] > max || (key === 'copies' && !Number.isInteger(result[key]))) throw new Error('纸张、份数或打印位置设置超出范围');
  }
  result.layoutOffsets = require('./generated/print-domain.cjs').normalizeWarrantyLayoutOffsets(result.layoutOffsets);
  result.fontSizes = require('./generated/print-domain.cjs').normalizeWarrantyFontSizes(result.fontSizes);
  return Object.fromEntries(Object.keys(defaults).map(key => [key, result[key]]));
}
function createPrintSettings(file) {
  return {
    read() { try { return validatePrintSettings(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { return { ...defaults }; } },
    write(input) {
      const result = validatePrintSettings(input);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temporary = file + '.tmp'; fs.writeFileSync(temporary, JSON.stringify(result, null, 2), { mode: 0o600 }); fs.renameSync(temporary, file);
      return result;
    },
  };
}
module.exports = { defaults, validatePrintSettings, createPrintSettings };
