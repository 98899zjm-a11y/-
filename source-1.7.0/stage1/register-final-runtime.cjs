'use strict';
// Explicitly register the two reviewed final runtime modules; no dynamic glob.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),guard=require('./isolation.cjs').createIsolationGuard(root),file=guard.assertPath(path.join(__dirname,'build-full-release.cjs'));
let source=fs.readFileSync(file,'utf8');
for(const [name,anchor]of [['business-authority-preserve','business-backups'],['initial-upgrade-gate','lan']]){
 const target=guard.assertPath(path.join(root,'project','desktop',name+'.cjs'));
 if(!fs.existsSync(target)||!fs.lstatSync(target).isFile()||fs.lstatSync(target).nlink!==1)throw Error('Reviewed runtime module absent: '+name);
 if(!source.includes("'"+name+"'")){
  const needle="'"+anchor+"'";if(source.split(needle).length!==2)throw Error('Explicit runtime registry anchor changed');
  source=source.replace(needle,"'"+name+"',"+needle);
 }
}
fs.writeFileSync(file,source);
console.log(JSON.stringify({registered:['business-authority-preserve','initial-upgrade-gate'],businessExecuted:false}));
