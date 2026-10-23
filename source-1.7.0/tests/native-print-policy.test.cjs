'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
function api(){return require('../project/desktop/native-print-policy.cjs');}
test('ordinary template editing cannot change the physical device binding',()=>{let writes=0;const store={read:()=>({deviceName:'bound-device'}),write:()=>{writes++;}};assert.throws(()=>api().saveEditablePrintSettings(store,{deviceName:'other-device',phone:'123'}),/管理员|绑定/);assert.equal(writes,0);});
test('template editing preserves the existing device and forwards layout and contacts',()=>{let saved;const store={read:()=>({deviceName:'bound-device'}),write:value=>{saved=value;return value;}};const r=api().saveEditablePrintSettings(store,{phone:'123',fontSizes:{phone:12},layoutOffsets:{phone:{xMm:1,yMm:2}}});assert.equal(r.deviceName,'bound-device');assert.equal(saved.phone,'123');assert.deepEqual(saved.fontSizes,{phone:12});});
test('native legacy printing has no physical submit path',()=>{assert.throws(()=>api().rejectLegacyNativePrint(),/主机统一打印/);});
