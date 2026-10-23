"""Guest-only source/binary identity evidence; compile/decode code data, never execute it."""
from pathlib import Path
import hashlib, importlib.util, json, sys
ROOT=Path(__file__).resolve().parents[1]
assert str(ROOT).lower()=='c:\\xjy-work\\xjy-web-stage1' and sys.flags.isolated and sys.flags.no_site and sys.flags.dont_write_bytecode
file=ROOT/'audit-tools/finance-repack.py'
assert hashlib.sha256(file.read_bytes()).hexdigest()=='d630f373911715b3ef5ee80e6fbaeaae838c1469ab53f44759813bc066cf69a7'
spec=importlib.util.spec_from_file_location('known_data_repacker',file)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
admission=m.admit('d630f373911715b3ef5ee80e6fbaeaae838c1469ab53f44759813bc066cf69a7')
original=m.pinned(m.ORIGINAL/'xjy-ledger/xjy-ledger.exe',m.PINS['exe'])
modules={row['name']:row for row in m.pyz(m.archive(original)['pyz'])}
rows=[]
for name in ('inventory_dashboard','reports','repairs','enhancements','inventory_report_window'):
    row=modules[name];code=row['code'];source=m.stable(ROOT/'project/desktop/legacy-source/ledger'/f'{name}.py')
    matched=[]
    for optimize in (0,1,2):
        expected=compile(source,code.co_filename,'exec',dont_inherit=True,optimize=optimize)
        if m.code_tree(expected)==m.code_tree(code): matched.append(optimize)
    rows.append({'module':name,'filename':code.co_filename,'sourceSha256':hashlib.sha256(source).hexdigest(),'originalCodeStructureSha256':m.fingerprint(code),'matchedOptimizationLevels':matched,'sourceMatchesOriginalExecutable':bool(matched)})
result={'purpose':'platinum-source-original-binary-identity','actualContext':admission,'originalExeSha256':hashlib.sha256(original).hexdigest(),'modules':rows,'businessExecuted':False,'productionDataRead':False}
out=Path('C:/xjy-results/platinum-source-identity-a1.json')
with out.open('x',encoding='utf8') as stream:json.dump(result,stream,indent=2)
print(json.dumps({'modules':len(rows),'allMatched':all(row['sourceMatchesOriginalExecutable'] for row in rows),'output':str(out)}))
