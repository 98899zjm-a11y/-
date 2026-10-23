'use strict';
function rejectLegacyNativePrint(){throw new Error('请使用“主机统一打印”提交单据，所有员工及本机都通过同一队列；此入口不会直接出纸。');}
function saveEditablePrintSettings(store,input){
 if(!store||typeof store.read!=='function'||typeof store.write!=='function'||!input||typeof input!=='object'||Array.isArray(input))throw new Error('打印设置格式无效');
 const old=store.read();if(Object.hasOwn(input,'deviceName')&&input.deviceName!==old.deviceName)throw new Error('设备绑定由主机管理员统一管理，请在主机打印设置中调整');
 return store.write({...old,...input,deviceName:old.deviceName});
}
module.exports={rejectLegacyNativePrint,saveEditablePrintSettings};
