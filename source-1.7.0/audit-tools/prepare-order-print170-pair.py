"""Host data-only preservation of the two exact printing test inputs."""
from pathlib import Path
import hashlib
import json
import stat
ROOT = Path(__file__).resolve().parents[1]
UI = ['project/desktop/renderer/'+n for n in ('remote-print.tsx','workspace.tsx','sales-orders.tsx','warranty-data.ts','warranty-layout.ts')] + ['project/lib/domain.ts','project/lib/quote-presentation.ts']
HOST = ['project/desktop/'+n for n in ('print-sources.cjs','print-agent.cjs','print-routing.cjs','central-print-jobs.cjs','central-print-integration.cjs')]
ADDITIONAL = ['project/desktop/'+n for n in ('print-composition.cjs','desktop-print-services.cjs','backend.cjs','renderer/print-worker-templates.tsx','release-app.cjs')] + ['stage1/web-gateway.cjs']
TESTS = ['audit-tools/remote-print-order-ui-contract.test.cjs','audit-tools/order-print-host170.test.cjs']
def read(p):
    for q in (p,*p.parents):
        s=q.lstat()
        if stat.S_ISLNK(s.st_mode) or getattr(s,'st_file_attributes',0)&0x400 or stat.S_ISREG(s.st_mode) and s.st_nlink!=1: raise RuntimeError('Ordinary source required')
    return p.read_bytes()
def put(p,b):
    p.parent.mkdir(parents=True,exist_ok=True)
    for q in (p.parent,*p.parent.parents):
        if q.is_symlink() or q.is_junction(): raise RuntimeError('Linked output refused')
    with p.open('xb') as f:f.write(b)
def encode(x):return (json.dumps(x,indent=2,ensure_ascii=False)+'\n').encode()
sha=lambda b:hashlib.sha256(b).hexdigest()
ui_before=ROOT/'audit-tools/qa-history/remote-order170-before-a1'
host_before=ROOT/'audit-tools/qa-history/order-print-host-before-a1'
old_pins={}
for p in (ui_before/'source-pins.json',host_before/'source-pins.json',host_before/'additional-source-pins.json'):old_pins.update(json.loads(read(p)))
for phase in ('red','candidate'):
    out=ROOT/'sandbox/input'/('order-print170-'+phase+'-a1')
    if out.exists():raise RuntimeError('Fresh input required')
    rows=[];pins={}
    for rel in UI+HOST+ADDITIONAL+TESTS:
        source=ROOT/rel
        if phase=='red' and rel in old_pins:
            source=(ui_before if rel in UI else host_before)/rel
        body=read(source)
        if phase=='red' and rel in old_pins and sha(body)!=old_pins[rel]:raise RuntimeError('Original preserved source changed: '+rel)
        put(out/rel,body);pins[rel]=sha(body);rows.append({'path':rel,'size':len(body),'sha256':sha(body)})
    if pins[TESTS[0]]!='a2c2a7f70d02c6be850f6b09f6ea91ead0bdc4cb80dd3c588731a511d4ab22c0':raise RuntimeError('Original 17 assertions changed')
    metadata={'version':1,'phase':phase,'uiTest':pins[TESTS[0]],'hostTest':pins[TESTS[1]],'uiSourcePins':{rel:pins[rel] for rel in UI},'hostSourcePins':{rel:pins[rel] for rel in HOST},'compilerSha256':'3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675','zodTreeSha256':'aa22e4ecc602ac6f64808b6f1eec290b735d55ea843b25026ecd36b0ebde9c3e','actualRun':False}
    rel='audit-tools/order-print170-'+phase+'-a1-pins.json';body=encode(metadata);put(out/rel,body);put(ROOT/rel,body);rows.append({'path':rel,'size':len(body),'sha256':sha(body)})
    manifest=encode({'version':1,'purpose':'data-free isolated audit code and public compiler','files':rows});put(out/'manifest.json',manifest)
    print(json.dumps({'phase':phase,'files':len(rows),'manifestSha256':sha(manifest),'metadataSha256':sha(body),'tests':{key:metadata[key] for key in ('uiTest','hostTest')}}))
