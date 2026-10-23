'use strict';
// Public program metadata only. No paths, accounts, settings or business IO.
function appInfoFromVersion(value){
 if(typeof value!=='string'||value.length>64||!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)||!value.split('.').every(part=>Number.isSafeInteger(Number(part))))throw Object.assign(new Error('版本信息暂不可用。'),{code:'APP_VERSION_UNAVAILABLE'});
 return Object.freeze({appVersion:value});
}
function createAppInfoProvider(options){
 if(!options||typeof options.getVersion!=='function'||Object.keys(options).some(name=>name!=='getVersion'))throw new TypeError('A trusted native version getter is required');
 return Object.freeze({getAppInfo(){return appInfoFromVersion(options.getVersion());}});
}
module.exports=Object.freeze({createAppInfoProvider,appInfoFromVersion});
