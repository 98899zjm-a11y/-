"""Assemble the same HTTP-verified module tree without executing business."""
from pathlib import Path
import hashlib,importlib.util,json
ROOT=Path(__file__).resolve().parents[1]
helper=ROOT/'audit-tools/prepare-desktop-first170-projection.py'
assert hashlib.sha256(helper.read_bytes()).hexdigest()=='eefdb493fc2b7d9f0347804e60a9db6f75ab7ca53dd20ee3d9ee2f75ce34ecf0'
spec=importlib.util.spec_from_file_location('copy_helpers',helper);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
baseline=ROOT/'release-work/desktop-first170-program-baseline-a1'
body=m.read_stable(baseline/'assembly.json');assert m.sha(body)=='2818e0ed26d04a44df7d4d8bd29b89454233419f32cd56b55d81ddf419ca2f3c';plan=json.loads(body);assert plan['fileCount']==1079
evidence=ROOT/'sandbox/results/employee-clean-g3';export=evidence/'desktop-first-finance-repack-a2-export'
export_body=m.read_stable(export/'export.json');assert m.sha(export_body)=='6e9d7b559c749e749bbd1fd590b842f545d0a08529a6b6f6de647264f5c63c57'
export_plan=json.loads(export_body);assert export_plan['complete'] is True and export_plan['files']==501
mapped={r['path']:r for r in export_plan['records']}
for row in mapped.values():m.read_stable(export/row['path'],row)
assert m.sha(m.read_stable(export/'modules-input/manifest.json'))=='89c728d222488e525ee306087ac2a3faa760ba74adcf6cee671f0fd7f1a62b99'
http_body=m.read_stable(evidence/'desktop-first-finance-http-a2-result.json');assert m.sha(http_body)=='ab41bfec02aa86600d71fa6aedc1171bc7ca33c3d26615c23f5f52a2ed500758'
http=json.loads(http_body);assert http['controlsPassed'] and http['normalClose'] and http['financeRowsUnchanged'] and len(http['scenarios'])==4 and all(r['completed'] for r in http['scenarios'])
assert http['runtime']['electron']=='44.9.0' and len(http['children'])==2 and all(r['exited'] and r['exitCode']==0 and r['signal'] is None for r in http['children'])
m.OUTPUT=ROOT/'release-work/desktop-first170-program-candidate-a1';m.mkdir_new(m.OUTPUT)
rows=[];changes=[]
for row in plan['files']:
    rel=row['path'];old=m.read_stable(baseline/rel,row);prefix='program/resources/release-modules/'
    if rel.startswith(prefix):
        key='modules-input/'+rel[len(prefix):];r=mapped[key];data=m.read_stable(export/key,r)
    else:data=old
    saved=m.write_new(rel,data);rows.append(saved)
    if m.sha(data)!=row['sha256']:changes.append({'path':rel,'before':row['sha256'],'after':m.sha(data)})
assert {r['path'] for r in changes}=={'program/resources/release-modules/manifest.json','program/resources/release-modules/xjy-ledger/xjy-ledger.exe','program/resources/release-modules/xjy-ledger/_internal/app/templates/home.html','program/resources/release-modules/xjy-ledger/_internal/app/templates/stock.html'}
for row in rows:m.read_stable(m.OUTPUT/row['path'],row)
record={'complete':True,'programVersion':'1.7.0','engineVersion':'44.9.0','fileCount':len(rows),'files':rows,'changes':changes,'baselineManifestSha256':m.sha(body),'moduleManifestSha256':'89c728d222488e525ee306087ac2a3faa760ba74adcf6cee671f0fd7f1a62b99','financialHttpControls':{'resultSha256':m.sha(http_body),'scenarios':['P01','P02','P03','P04'],'scope':'fictional inventory/month/filter/CSV/permissions/normal-close controls; not all financial formulas'},'programExecutedByAssembly':False,'productionAccessed':False,'nativeInstallVerified':False,'employeeInSoftwareUpgradeVerified':False,'releaseReady':False}
m.write_new('assembly.json',(json.dumps(record,ensure_ascii=False,indent=2)+'\n').encode())
print(json.dumps({'complete':True,'files':len(rows),'changedResources':len(changes),'manifestSha256':m.sha(m.read_stable(m.OUTPUT/'assembly.json')),'releaseReady':False}))
