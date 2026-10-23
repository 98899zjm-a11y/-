'use strict';
// Build-time issuer key; excluded from every program/Sandbox/employee package.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),guard=require('./isolation.cjs').createIsolationGuard(root);
const identity=JSON.parse(fs.readFileSync(guard.assertPath(path.join(root,'isolation-identity.json')),'utf8'));
const folder=guard.assertPath(path.join(root,'config','release-signing')),owner=path.join(folder,'owner.json'),privateFile=path.join(folder,'issuer-private.pem'),publicFile=path.join(folder,'issuer-public.pem');
fs.mkdirSync(folder,{recursive:true});
if(!fs.existsSync(owner)){if(fs.readdirSync(folder).length)throw Error('Unowned signing directory refused');fs.writeFileSync(owner,JSON.stringify({version:1,purpose:'program-update-issuer',namespace:identity.namespace}),{flag:'wx',mode:0o600});}
const saved=JSON.parse(fs.readFileSync(guard.assertPath(owner),'utf8'));if(saved.version!==1||saved.namespace!==identity.namespace||saved.purpose!=='program-update-issuer')throw Error('Signing ownership mismatch');
let privateKey;
if(fs.existsSync(privateFile)){const stat=fs.lstatSync(guard.assertPath(privateFile));if(!stat.isFile()||stat.nlink!==1||stat.size>4096)throw Error('Signing key must be an owned regular file');privateKey=crypto.createPrivateKey(fs.readFileSync(privateFile));}
else{privateKey=crypto.generateKeyPairSync('ed25519').privateKey;fs.writeFileSync(guard.assertPath(privateFile),privateKey.export({format:'pem',type:'pkcs8'}),{flag:'wx',mode:0o600});}
if(privateKey.asymmetricKeyType!=='ed25519')throw Error('Unexpected issuer algorithm');
const publicKey=crypto.createPublicKey(privateKey),publicPem=publicKey.export({format:'pem',type:'spki'});
if(fs.existsSync(publicFile)){const stat=fs.lstatSync(guard.assertPath(publicFile));if(!stat.isFile()||stat.nlink!==1||fs.readFileSync(publicFile,'utf8')!==publicPem)throw Error('Public issuer key changed');}
else fs.writeFileSync(guard.assertPath(publicFile),publicPem,{flag:'wx',mode:0o600});
const test=Buffer.from('xjy-update-issuer-possession-check');if(!crypto.verify(null,test,publicKey,crypto.sign(null,test,privateKey)))throw Error('Issuer key verification failed');
const evidence={version:1,algorithm:'Ed25519',publicKeyFile:path.relative(root,publicFile).replaceAll('\\','/'),publicKeyFingerprint:crypto.createHash('sha256').update(publicKey.export({format:'der',type:'spki'})).digest('hex'),privateKeyIncludedInProgram:false,authenticodeCertificate:false,publicDeployment:false};
fs.writeFileSync(guard.assertPath(path.join(root,'reports','update-issuer-key.json')),JSON.stringify(evidence,null,2));process.stdout.write(JSON.stringify(evidence)+'\n');
