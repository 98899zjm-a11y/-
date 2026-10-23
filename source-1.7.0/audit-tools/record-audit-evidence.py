"""Host data-only summary of captured synthetic Guest result files."""
from pathlib import Path
import hashlib,json,re
ROOT=Path(__file__).resolve().parent.parent
base=ROOT/'sandbox/results'
summary={'version':1,'date':'2026-10-16','guestId':'ed25d385-d344-4bfa-8878-cd088dc2c0ea','productionModifiedByAudit':False,'releaseInstalled':False,'runs':[]}
for name in ['bootstrap-a2','bootstrap-a3','baseline','lan-red','lan-server-green1','p0-c2','p0-final1','history-red2','history-green2','history-missing-red5','history-missing-red6','history-missing-green1','composer-red','composer-green1','composer-red15','composer-green15','daily-cache-red','daily-cache-green1','daily-diagnose','daily-cache-green2','daily-cache-red14','daily-cache-green14','build-current','build-current2','build-current3','regression-current1','regression-current2']:
    folder=base/name
    if not folder.exists():continue
    row={'name':name,'files':[]}
    for p in sorted(folder.glob('*.json')):
        if p.name not in {'results.json','guest-bootstrap-result.json'}:continue
        b=p.read_bytes();value=json.loads(b.decode('utf-16' if b.startswith(b'\xff\xfe') else 'utf-8-sig'))
        row['files'].append({'path':p.relative_to(ROOT).as_posix(),'sha256':hashlib.sha256(b).hexdigest(),'results':value if isinstance(value,list) else {k:value.get(k) for k in ['passed','stage','error','verifiedManifestFiles','overlayFiles','manifestSha256','overlaySha256']}})
    for p in sorted(folder.glob('*.log')):
        b=p.read_bytes();s=b.decode('utf-16' if b.startswith(b'\xff\xfe') else 'utf-8-sig',errors='replace');stats={}
        for key in ['tests','pass','fail','skipped','cancelled']:
            found=re.findall(r'(?m)^(?:# |ℹ )'+key+r' (\d+)\s*$',s)
            if found:stats[key]=int(found[-1])
        row['files'].append({'path':p.relative_to(ROOT).as_posix(),'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b),'nodeCounts':stats})
    summary['runs'].append(row)
out=ROOT/'audit-evidence';out.mkdir(exist_ok=True)
(out/'p0-20261016.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'capturedRuns':len(summary['runs']),'output':'audit-evidence/p0-20261016.json'}))
