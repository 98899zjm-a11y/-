"""Seal freshly compiled guarded program assets; no program or DB is run."""
from pathlib import Path
import hashlib
import importlib.util
import json
import os
root=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('owned_build_paths',root/'stage1/run-restricted.py')
guard=importlib.util.module_from_spec(spec);spec.loader.exec_module(guard)
guard.validate_identity(json.loads(guard.assert_owned(root/'isolation-identity.json').read_text('utf-8')))
inventory_spec=importlib.util.spec_from_file_location('owned_program_inventory',guard.assert_owned(root/'stage1/module_program_inventory.py'))
inventory=importlib.util.module_from_spec(inventory_spec);inventory_spec.loader.exec_module(inventory)
collect_program_inventory=inventory.collect_program_inventory
directory=guard.assert_owned(root/'project/desktop/legacy-modules')
manifest={'version':1,'modules':[]}
for name,version,label in [('ledger','1.3.0','财务系统'),('inventory','1.9.0','库管')]:
    bundle=guard.assert_owned(directory/('xjy-'+name))
    files=collect_program_inventory(bundle,guard.assert_owned)
    exe=next(x for x in files if x['path']=='xjy-'+name+'.exe')
    manifest['modules'].append({'id':name,'label':label,'version':version,'file':exe['path'],'runtimeMode':'onedir','files':files,'size':exe['size'],'sha256':exe['sha256']})
temporary=guard.assert_owned(directory/'manifest-final-build.tmp')
with temporary.open('x',encoding='utf-8') as handle:
    json.dump(manifest,handle,ensure_ascii=False,indent=2);handle.flush();os.fsync(handle.fileno())
temporary.replace(guard.assert_owned(directory/'manifest.json'))
print(json.dumps({'sealedGuardedModules':[{'id':m['id'],'files':len(m['files']),'sha256':m['sha256']} for m in manifest['modules']],'businessExecuted':False,'databaseOpened':False}))
