'use strict';
// Offline verification primitive only. No Tunnel installation, key fetch,
// public listener or first-layer bypass is enabled by importing this module.
const crypto=require('node:crypto'),verifiedIdentities=new WeakSet();
const fail=()=>{const error=new Error('Access identity verification or employee binding failed');error.status=403;throw error;};
function verifyAccessJwt(token,{issuer,audience,keys,now=Math.floor(Date.now()/1000)}={}){
 try{
  if(typeof token!=='string'||token.length>16384||!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer||'')||!audience||!(keys instanceof Map)||!Number.isFinite(now))fail();
  const parts=token.split('.');if(parts.length!==3||parts.some(x=>!x||!/^[A-Za-z0-9_-]+$/.test(x)))fail();
  const header=JSON.parse(Buffer.from(parts[0],'base64url')),claims=JSON.parse(Buffer.from(parts[1],'base64url'));
  if(header.alg!=='RS256'||typeof header.kid!=='string'||header.crit!==undefined||!keys.has(header.kid))fail();
  const key=keys.get(header.kid);if(key.type!=='public'||key.asymmetricKeyType!=='rsa'||key.asymmetricKeyDetails.modulusLength<2048||!crypto.verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),key,Buffer.from(parts[2],'base64url')))fail();
  if(claims.iss!==issuer||!Array.isArray(claims.aud)||!claims.aud.includes(audience)||!Number.isFinite(claims.exp)||claims.exp<=now||!Number.isFinite(claims.iat)||claims.iat>now+30||claims.nbf!==undefined&&(!Number.isFinite(claims.nbf)||claims.nbf>now+30)||typeof claims.sub!=='string'||!claims.sub||claims.sub.length>256||typeof claims.email!=='string'||claims.email.length>254||!/^[^\s@]+@[^\s@]+$/.test(claims.email))fail();
  const identity=Object.freeze({subject:claims.sub,verifiedEmail:claims.email.trim().toLowerCase(),issuer,audience,expiresAt:claims.exp});verifiedIdentities.add(identity);return identity;
 }catch{fail();}
}
function bindEmployee(identity,actor,mapping,{now=Math.floor(Date.now()/1000)}={}){
 // actor and mapping must come from the live software account/mapping store,
 // never from submitted JSON or an unsigned email header.
 if(!verifiedIdentities.has(identity)||!Number.isFinite(now)||identity.expiresAt<=now||!actor?.active||!mapping||mapping.subject!==identity.subject||mapping.email?.trim().toLowerCase()!==identity.verifiedEmail||mapping.staffId!==actor.id)fail();
 return actor;
}
module.exports={verifyAccessJwt,bindEmployee};
