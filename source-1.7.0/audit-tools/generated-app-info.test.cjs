'use strict';
// Fixed Guest, actual bundled gateway, only in-memory HTTP ports. No listener/DB.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..'),sha=body=>crypto.createHash('sha256').update(body).digest('hex');
if(process.platform!=='win32'||ROOT.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')throw Error('Actual isolated Guest required');
for(const [file,pin]of Object.entries({'stage1/guest-candidate-cdp.cjs':'59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32','stage1/sandbox-context.py':'09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249','stage1/validate-sandbox-context.py':'867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207'}))if(sha(fs.readFileSync(path.join(ROOT,file)))!==pin)throw Error('Original Guest guard changed');
require('../stage1/guest-candidate-cdp.cjs').actualGuard();
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),{EventEmitter}=require('node:events');
assert.equal(sha(fs.readFileSync(__filename)),process.env.XJY_GENERATED_APP_INFO_TEST_SHA256);
const source=fs.readFileSync(path.join(ROOT,'project/desktop/web-runtime/web-gateway.cjs'));assert.equal(sha(source),'c2b39f3aab0c9a3b42ef87b9dc81de8b9b7196e5ba5f33019976b2c14dc7fa08');
const forbidden=()=>{throw Error('Bundled metadata cannot call a business or filesystem port');},moduleRecord={exports:{}};
vm.runInNewContext(source.toString('utf8'),{module:moduleRecord,exports:moduleRecord.exports,__dirname:path.join(ROOT,'project/desktop/web-runtime'),console,Buffer,URL,URLSearchParams,TextEncoder,TextDecoder,Headers,Response,Request,AbortController,process:{platform:'win32',versions:process.versions,env:{}},setTimeout,clearTimeout,require(id){if(id==='node:crypto')return crypto;if(id==='node:path')return path;if(id==='node:fs')return new Proxy({}, {get:()=>forbidden});throw Error('Unreviewed bundled import '+id);}},{filename:'actual-bundled-web-gateway.cjs'});
async function request(appVersion,method='GET',url='/app-info'){
 const server=new EventEmitter();server.address=()=>({port:42831});const gateway=moduleRecord.exports.createGateway({appVersion,backend:{createSession:forbidden},server,root:path.join(ROOT,'runtime/generated-version-memory-only'),allowLocalControls:false});
 const req=new EventEmitter(),res=new EventEmitter(),headers={};Object.assign(req,{method,url,headers:{host:'127.0.0.1:42831'},socket:{remoteAddress:'127.0.0.1'},resume(){}});let finish;const done=new Promise(resolve=>{finish=resolve;});
 Object.assign(res,{setHeader:(name,value)=>{headers[name.toLowerCase()]=value;},writeHead(code,values={}){this.statusCode=code;for(const [name,value]of Object.entries(values))headers[name.toLowerCase()]=value;return this;},end(body=''){finish({status:this.statusCode,headers,body:Buffer.from(body).toString('utf8')});this.emit('finish');return this;}});
 try{server.emit('request',req,res);return await done;}finally{await gateway.close();}
}
test('G01 the actual portable gateway retains trusted version-only metadata without opening business sessions',async()=>{
 const reply=await request('1.6.2');assert.equal(reply.status,200);assert.equal(reply.headers['cache-control'],'no-store');assert.deepEqual(JSON.parse(reply.body),{appVersion:'1.6.2'});
 assert.equal((await request(undefined)).status,503);assert.equal((await request('bad-version')).status,503);assert.equal((await request('1.6.2','POST')).status,405);const injected=await request('1.6.2','GET','/app-info?appVersion=9.9.9');assert.equal(injected.status,400);assert(!injected.body.includes('9.9.9'));
});
