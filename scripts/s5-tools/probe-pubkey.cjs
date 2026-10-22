const crypto=require('node:crypto'),fs=require('node:fs');
const pemPath=process.argv[2];
const pem=fs.readFileSync(pemPath,'utf8');
const k=crypto.createPublicKey(pem);
const der=k.export({type:'spki',format:'der'});
console.log(JSON.stringify({type:k.asymmetricKeyType,spkiSha256:crypto.createHash('sha256').update(der).digest('hex'),derBytes:der.length}));