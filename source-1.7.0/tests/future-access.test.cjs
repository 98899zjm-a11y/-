'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
test('future Access verifies signature/audience/expiry and binds actual software employee',()=>{
 const{verifyAccessJwt,bindEmployee}=require('../stage1/future-access.cjs'),pair=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
 const now=1800000000,options={issuer:'https://fictional.cloudflareaccess.com',audience:'test-app',keys:new Map([['test-key',pair.publicKey]]),now};
 const sign=(claims,header={alg:'RS256',kid:'test-key'})=>{const parts=[header,claims].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url'));const signature=crypto.sign('RSA-SHA256',Buffer.from(parts.join('.')),pair.privateKey).toString('base64url');return parts.join('.')+'.'+signature;};
 const claims={iss:options.issuer,aud:['test-app'],iat:now-30,exp:now+300,sub:'fictional-subject',email:'fictional@example.invalid'};
 const identity=verifyAccessJwt(sign(claims),options);assert.equal(identity.verifiedEmail,claims.email);
 assert.throws(()=>verifyAccessJwt(sign({...claims,exp:now-100}),options),/Access/);
 assert.throws(()=>verifyAccessJwt(sign({...claims,aud:['other-app']}),options),/Access/);
 assert.throws(()=>verifyAccessJwt(sign(claims,{alg:'none',kid:'test-key'}),options),/Access/);
 const broken=sign(claims).split('.');broken[1]=Buffer.from(JSON.stringify({...claims,email:'attacker@example.invalid'})).toString('base64url');assert.throws(()=>verifyAccessJwt(broken.join('.'),options),/Access/);
 const actor={id:'fictional-employee',active:true,role:'employee'},mapping={subject:claims.sub,email:claims.email,staffId:actor.id};
 assert.equal(bindEmployee(identity,actor,mapping).id,actor.id);
 assert.throws(()=>bindEmployee(identity,actor,mapping,{now:now+301}),/Access/,'a once-verified expired token must not bind later');
 assert.throws(()=>bindEmployee(identity,{...actor,id:'other-employee'},mapping),/Access/);
 assert.throws(()=>bindEmployee(identity,{...actor,active:false},mapping),/Access/);
 assert.throws(()=>bindEmployee({verifiedEmail:claims.email},actor,mapping),/Access/,'a plain email header must not establish identity');
});
