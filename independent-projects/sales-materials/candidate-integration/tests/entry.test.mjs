import test from 'node:test';
import assert from 'node:assert/strict';
import {readRegistry,validateRegistry,startCandidate} from '../entry.mjs';
import {allowedFiles,buildManifest} from '../freeze-manifest.mjs';
const registry=await readRegistry();
test('registry points to local module without production permissions',()=>{assert.equal(registry.entry,'entry.mjs');assert.equal(registry.url,'http://127.0.0.1:21963');assert.equal(registry.permissionBoundary,'local-candidate');assert.equal(registry.inheritsProductionEmployeePermissions,false);assert.equal(registry.productionRegistered,false);});
test('address port and source changes fail before any import',async()=>{let calls=0;for(const patch of [{host:'0.0.0.0'},{port:31831},{url:'http://localhost:21963'},{sourceModule:'E:/other.mjs'},{dataRoot:'E:/production'},{permissionBoundary:'admin'},{inheritsProductionEmployeePermissions:true},{productionRegistered:true},{extra:'override'}])await assert.rejects(startCandidate({registry:{...registry,...patch},loadModule:async()=>{calls++;}}));assert.equal(calls,0);});
test('bridge actually invokes createApplication with fixed data root and port',async()=>{let imported,options;const expected={origin:registry.url,close:async()=>{}};const app=await startCandidate({registry,loadModule:async url=>{imported=url;return{createApplication:async args=>{options=args;return expected;}}}});assert.equal(imported,'file:///D:/Codex/xjy-sales-materials-20261023/server.mjs');assert.deepEqual(options,{dataRoot:registry.dataRoot,port:21963});assert.equal(app,expected);});
test('unexpected origin is closed and rejected',async()=>{let closed=0;await assert.rejects(startCandidate({registry,loadModule:async()=>({createApplication:async()=>({origin:'http://0.0.0.0:21963',close:async()=>{closed++;}})})}),/origin/);assert.equal(closed,1);});
test('missing createApplication rejected',async()=>{await assert.rejects(startCandidate({registry,loadModule:async()=>({})}),/createApplication/);});
test('manifest only enumerates source and hashes without runtime traversal',async()=>{assert.equal(allowedFiles.length,14);for(const file of allowedFiles){assert.ok(!/\/runtime\/|\/node_modules\/|\.(db|jpg|png|sqlite|env)$/i.test(file.replaceAll('\\','/')));}const manifest=await buildManifest();assert.equal(manifest.files.length,14);assert.ok(manifest.files.every(x=>/^[a-f0-9]{64}$/.test(x.sha256)));});

test('manifest includes the complete local import graph including intake state machine',async()=>{
  const fs=await import('node:fs/promises');
  const path=await import('node:path');
  const seen=new Set();
  const allowed=new Set(allowedFiles.map(file=>path.resolve(file)));
  async function inspect(file){
    file=path.resolve(file);if(seen.has(file))return;seen.add(file);
    assert.ok(allowed.has(file),'Missing runtime source from manifest: '+file);
    const source=await fs.readFile(file,'utf8');
    const imports=[...source.matchAll(/\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"](\.[^'"]+)['"]/g),...source.matchAll(/\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g)];
    for(const match of imports)await inspect(path.resolve(path.dirname(file),match[1]));
  }
  await inspect(registry.sourceModule);
  assert.ok([...seen].some(file=>file.replaceAll('\\','/').endsWith('/vendor/intake-state/intake-state.mjs')));
});
