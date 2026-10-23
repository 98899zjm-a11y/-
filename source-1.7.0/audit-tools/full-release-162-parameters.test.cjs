'use strict';
// Fixed Guest: evaluate two real pure parameter functions, never build/install.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
if(process.platform!=='win32'||ROOT.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')throw Error('Actual Guest required');
for(const [file,pin]of Object.entries({'stage1/guest-candidate-cdp.cjs':'59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32','stage1/sandbox-context.py':'09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249','stage1/validate-sandbox-context.py':'867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207'}))if(sha(fs.readFileSync(path.join(ROOT,file)))!==pin)throw Error('Frozen Guest guard changed');
require('../stage1/guest-candidate-cdp.cjs').actualGuard();
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
assert.equal(sha(fs.readFileSync(__filename)),process.env.XJY_RELEASE162_TEST_SHA256);
const compiler=path.join(ROOT,'audit-tools/dependencies/node_modules/typescript/lib/typescript.js');assert.equal(sha(fs.readFileSync(compiler)),'3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675');const ts=require(compiler);
const file=path.join(ROOT,'stage1/build-full-release.cjs'),source=fs.readFileSync(file,'utf8');assert.equal(sha(Buffer.from(source)),process.env.XJY_RELEASE162_BUILDER_SHA256);const tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);assert.equal(tree.parseDiagnostics.length,0);
const names=['releaseProgramVersion','validateReleaseEvidence'],parts=names.map(name=>{const nodes=tree.statements.filter(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);assert.equal(nodes.length,1);return nodes[0].getText(tree);});
const functions=vm.runInNewContext(parts.join('\n')+';({releaseProgramVersion,validateReleaseEvidence})',{}, {filename:file+':pure-release-parameters'});
test('R162 explicitly selected 1.6.2 preserves old targets and rejects mismatched preparation/freeze or unapproved future versions',()=>{
 for(const value of ['1.6.0','1.6.1','1.6.2'])assert.equal(functions.releaseProgramVersion(value),value);
 for(const value of ['1.6.3','2.0.0','latest','v1.6.2','1.6.2-beta','1.6.2 ','01.6.2',null,{},162])assert.throws(()=>functions.releaseProgramVersion(value));
 const input={programVersion:'1.6.2',preparation:{version:1,programVersion:'1.6.2'},freeze:{version:1,purpose:'xjy-full-release-1.6.2'},savedPreparation:{version:1,programVersion:'1.6.2'}};assert.equal(functions.validateReleaseEvidence(input),'1.6.2');
 for(const key of ['preparation','freeze','savedPreparation']){const invalid=JSON.parse(JSON.stringify(input));if(key==='freeze')invalid[key].purpose='xjy-full-release-1.6.1';else invalid[key].programVersion='1.6.1';assert.throws(()=>functions.validateReleaseEvidence(invalid));}
});
