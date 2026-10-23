'use strict';
// Verification primitive only; no production key or installer is configured.
const crypto=require('node:crypto');
function verifyManifest(envelope,trusted){
 const error=message=>{throw new Error('Patch '+message);};
 const{bytes,signature,keyId}=envelope||{};
 if(!(trusted instanceof Map)||!trusted.has(keyId)||!Buffer.isBuffer(bytes)||bytes.length>1024*1024||typeof signature!=='string'||! /^[A-Za-z0-9_-]{86}$/.test(signature))error('signature trust failed');
 const key=trusted.get(keyId);if(key.type!=='public'||key.asymmetricKeyType!=='ed25519'||!crypto.verify(null,bytes,key,Buffer.from(signature,'base64url')))error('signature trust failed');
 const value=JSON.parse(bytes.toString('utf8'));if(value.schema!==1||value.application!=='xjy-jewelry'||! /^\d+\.\d+\.\d+$/.test(value.version)||!Array.isArray(value.fromVersions)||!value.fromVersions.length||value.fromVersions.some(x=>! /^\d+\.\d+\.\d+$/.test(x))||!Array.isArray(value.files)||!value.files.length||value.files.length>10000)error('manifest invalid');
 const seen=new Set();for(const file of value.files){
  const p=file.path;if(typeof p!=='string'||p.length>500||p.startsWith('/')||p.split('/').some(x=>!x||x==='.'||x==='..'||/[\\:\x00-\x1f]/.test(x)||/[. ]$/.test(x)||/^(CON|PRN|AUX|NUL|COM\d|LPT\d)(\.|$)/i.test(x))||/^(data|config|程序设置|工作室数据)(\/|$)/i.test(p)||seen.has(p.toLowerCase())||! /^[a-f0-9]{64}$/.test(file.sha256)||!Number.isSafeInteger(file.size)||file.size<0)error('file path or integrity invalid');seen.add(p.toLowerCase());
 }
 return value;
}
module.exports={verifyManifest};
