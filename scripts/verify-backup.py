from pathlib import Path
import sqlite3, shutil, json, hashlib

root=Path(r'D:\Codex\xjy-private-backups\pre170-20261022-a1')
result=[]
for group,relative in [('sales','工作室数据/jewelry.sqlite'),('finance','内帐/ledger.db'),('inventory','库管/stockcheck.db')]:
    source=root/'data'/relative
    assert source.is_file(),group
    target=root/'restore-validation'/group
    target.mkdir(parents=True,exist_ok=False)
    for suffix in ['', '-wal', '-shm']:
        candidate=Path(str(source)+suffix)
        if candidate.exists(): shutil.copyfile(candidate,target/candidate.name)
    db=target/source.name
    con=sqlite3.connect(db.as_uri()+'?mode=ro',uri=True)
    try:
        integrity=[row[0] for row in con.execute('PRAGMA integrity_check')]
        assert integrity==['ok'],group+' integrity failure'
        foreign_key_violations=sum(1 for _ in con.execute('PRAGMA foreign_key_check'))
        result.append({'database':group,'integrityCheck':'ok','foreignKeyViolations':foreign_key_violations,'restoreCopyOpened':True})
    finally: con.close()
(root/'restore-validation-results.json').write_text(json.dumps({'productionOpened':False,'restoredCopies':result},ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({'productionOpened':False,'restoredCopies':result},ensure_ascii=False))
