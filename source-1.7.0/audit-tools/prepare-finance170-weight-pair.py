"""Host data-only preparation of the frozen before/after weight test inputs."""
from pathlib import Path
import hashlib
import importlib.util
import json

ROOT = Path(__file__).resolve().parents[1]
if ROOT != Path('E:/codex/2026-10-15/work/xjy-v16-deep-audit'):
    raise RuntimeError('Fixed preparation root required')
spec = importlib.util.spec_from_file_location('owned_input_packager', ROOT/'audit-tools/prepare-guest-audit.py')
io = importlib.util.module_from_spec(spec)
spec.loader.exec_module(io)
PIN = 'audit-tools/finance-erp-round2-weight-pins.json'
TEST = 'audit-tools/finance-erp-round2-weight.test.py'
pin_bytes = io.ordinary(ROOT/PIN).read_bytes()
test_bytes = io.ordinary(ROOT/TEST).read_bytes()
if io.sha(pin_bytes) != '9fbbbd2d4546cf0fb6b12822c9fb704dd8f0077598e8ce5d462871709178bc14' or io.sha(test_bytes) != 'e5f67c9316618c1fabbe6a3494fad3da9a10f15927e5edfc063642434d003190':
    raise RuntimeError('Frozen weight contract changed')
pins = json.loads(pin_bytes)
names = {'inventory_dashboard.py', 'reports.py', 'app/templates/stock.html', 'app/templates/home.html'}
for phase in ('red', 'candidate'):
    out = ROOT/'sandbox/input'/('finance170-weight-'+phase+'-a1')
    if out.exists():
        raise RuntimeError('Fresh named input directory required')
    if set(pins['phases'][phase]) != names:
        raise RuntimeError('Exact four source files required')
    rows = []
    payloads = [(PIN, pin_bytes), (TEST, test_bytes)]
    for name in sorted(names):
        destination = 'project/desktop/legacy-source/ledger/'+name
        source = pins['preservedOriginals'][name] if phase == 'red' else destination
        if source.startswith('/') or '..' in Path(source).parts or ':' in source:
            raise RuntimeError('Source path escaped workspace')
        body = io.ordinary(ROOT/source).read_bytes()
        if io.sha(body) != pins['phases'][phase][name]:
            raise RuntimeError('Frozen source changed: '+name)
        payloads.append((destination, body))
    for relative, body in payloads:
        io.write_new(out/relative, body)
        rows.append({'path': relative, 'size': len(body), 'sha256': io.sha(body)})
    manifest = (json.dumps({'version': 1, 'purpose': 'data-free isolated audit code and public compiler', 'files': rows}, indent=2)+'\n').encode()
    io.write_new(out/'manifest.json', manifest)
    print(json.dumps({'phase': phase, 'files': len(rows), 'manifestSha256': hashlib.sha256(manifest).hexdigest(), 'businessExecuted': False}))
