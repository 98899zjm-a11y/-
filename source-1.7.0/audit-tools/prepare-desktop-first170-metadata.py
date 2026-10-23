"""Pure-data version/helper projection. Never imports or executes product code."""
from pathlib import Path
import hashlib, importlib.util, json, os
ROOT=Path(__file__).resolve().parents[1]
tool=ROOT/'audit-tools/prepare-desktop-first170-projection.py'
assert hashlib.sha256(tool.read_bytes()).hexdigest()=='eefdb493fc2b7d9f0347804e60a9db6f75ab7ca53dd20ee3d9ee2f75ce34ecf0'
spec=importlib.util.spec_from_file_location('copy_helpers',tool);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
base=ROOT/'release-work/desktop-first170-source-a1';work=ROOT/'release-work/desktop-first170-work-a1'
m.ordinary(work);m.OUTPUT=work
def stable(rel):return m.read_stable(work/rel)
def compact(obj):return json.dumps(obj,ensure_ascii=False,separators=(',',':')).encode()
changes=[]
def change(rel,old,new):
    assert stable(rel)==old
    m.write_new(rel+'.new-source',new)
    assert stable(rel)==old
    os.replace(work/(rel+'.new-source'),work/rel)
    assert stable(rel)==new
    changes.append({'path':rel,'before':m.sha(old),'after':m.sha(new)})

package='project/desktop/package.json';old=stable(package);pkg=json.loads(old);assert pkg['version']=='1.6.2' and pkg['main']=='release-entry.cjs';pkg['version']='1.7.0'
change(package,old,(json.dumps(pkg,ensure_ascii=False,indent=2)+'\n').encode())
bootstrap=m.read_stable(base/'baseline/resources/update-helper/bootstrap.json')
boot=json.loads(bootstrap);assert boot['programVersion']=='1.6.2' and len(boot['allowedFiles'])==1007
helper=m.read_stable(base/'baseline/resources/update-helper/updater-helper.cjs')
old_sha=m.sha(bootstrap);assert old_sha=='cd7b41fcd9cf276e0cedc31957fc8c53c9248c1d4d25a3b91cf2a53c1efa276a'
assert helper.count(old_sha.encode())==1
boot['programVersion']='1.7.0';next_boot=compact(boot);next_sha=m.sha(next_boot)
next_helper=helper.replace(old_sha.encode(),next_sha.encode())
for name,body in [('bootstrap.json',next_boot),('updater-helper.cjs',next_helper)]:
    m.write_new('resources-overrides/update-helper/'+name,body)
    changes.append({'path':'resources/update-helper/'+name,'before':m.sha(bootstrap if name=='bootstrap.json' else helper),'after':m.sha(body)})
rel='project/desktop/generated/release-pins.cjs';old=stable(rel);prefix=b"'use strict';\nmodule.exports=Object.freeze(";suffix=b');\n'
normalized=old.replace(b'\r\n',b'\n');assert normalized.startswith(prefix) and normalized.endswith(suffix)
pins=json.loads(normalized[len(prefix):-len(suffix)]);assert pins['programVersion']=='1.6.2' and pins['bootstrapSha256']==old_sha and pins['allowedFiles']==boot['allowedFiles']
pins['programVersion']='1.7.0';pins['bootstrapSha256']=next_sha
for row in pins['files']:
    body={'bootstrap.json':next_boot,'updater-helper.cjs':next_helper}.get(row['name'])
    if body is not None:row.update(size=len(body),sha256=m.sha(body))
change(rel,old,prefix+compact(pins)+suffix)
m.write_new('metadata-changes.json',(json.dumps({'version':'1.7.0','originalSourcePreserved':True,'allowedFilesUnchanged':True,'helperLogicChanged':False,'changes':changes},indent=2)+'\n').encode())
print(json.dumps({'metadataPrepared':True,'version':'1.7.0','changes':len(changes),'bootstrapSha256':next_sha,'helperSha256':m.sha(next_helper),'businessExecuted':False}))
