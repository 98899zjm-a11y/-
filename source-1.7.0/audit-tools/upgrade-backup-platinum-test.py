"""Actual Guest synthetic immutable-backup contracts; never a live/F read.

Only test composition replaces the backup root/pin and reviewed reader source
locations. SQLite, pinned old/new rule ASTs and original authorizer are real.
"""
import os, sys
from pathlib import Path
ROOT=Path(__file__).absolute().parents[1]
if (os.name!='nt' or os.path.normcase(str(ROOT))!=os.path.normcase('C:/xjy-work/xjy-web-stage1') or
        os.path.normcase(sys.executable)!=os.path.normcase('C:/Python314/python.exe') or
        not sys.flags.isolated or not sys.flags.no_site or not sys.flags.dont_write_bytecode or sys.flags.optimize):
    raise RuntimeError('Fixed actual Guest Python -I -B -S required')
import argparse, ast, base64, contextlib, hashlib, importlib.util, io, json, re, sqlite3, stat, unittest, uuid
from unittest import mock
SELF=ROOT/'audit-tools/upgrade-backup-platinum-test.py'
SUBJECT=ROOT/'audit-tools/read-upgrade-backup-platinum.py'
READER=ROOT/'audit-tools/read-current-platinum-summary.py'
READER_SHA='ae6c514a354366cef19cfa5a1a504b33874f57d3be6c4cdedeeef9e76360fe01'
REPACK=ROOT/'audit-tools/platinum-ledger-repack.py'
REPACK_SHA='9a2560b5c4eeb7db88bef57b2ade056f7d1802a628825996c2bc50d3be28b971'
GUARD=ROOT/'stage1/sandbox-context.py'; GUARD_SHA='09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249'
VALIDATOR=ROOT/'stage1/validate-sandbox-context.py'; VALIDATOR_SHA='867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207'
PYTHON=Path('C:/Python314/python.exe'); PYTHON_SHA='434b361fe0c5960d404974feed493db47f2603a1ace2574312104fbed0182c6f'
BASE=REVIEWED=None
def digest(body): return hashlib.sha256(body).hexdigest()
def read(file,pin=None):
    for item in (file,*file.parents):
        s=item.lstat()
        if stat.S_ISLNK(s.st_mode) or getattr(s,'st_file_attributes',0)&0x400 or stat.S_ISREG(s.st_mode) and s.st_nlink!=1: raise RuntimeError('Ordinary synthetic input required')
    b=file.read_bytes()
    if pin is not None and digest(b)!=pin: raise RuntimeError('Frozen test dependency changed: '+file.name)
    return b
def no_f(event,args):
    if event=='open' and args and isinstance(args[0],(str,bytes,os.PathLike)) and re.search(r'(^|[/?:])f:',os.fsdecode(args[0]).replace('\\','/').lower()):
        raise AssertionError('Production content read forbidden in synthetic contracts')
def load(file,name):
    spec=importlib.util.spec_from_file_location(name,file); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module
def subject(case):
    assert SUBJECT.exists(),'UPGRADE_BACKUP_PLATINUM_FEATURE_REQUIRED: fixed backup reader is absent'
    pin=os.environ.get('XJY_UPGRADE_BACKUP_SOURCE_SHA256','')
    assert re.fullmatch('[a-f0-9]{64}',pin),'Root must freeze subject source'
    read(SUBJECT,pin); tool=load(SUBJECT,'synthetic_backup_reader_'+uuid.uuid4().hex)
    tool.BACKUP_ROOT=case['root']; tool.MANIFEST_SHA=case['pin']; tool.W=ROOT; tool.SELF=SUBJECT
    tool.load_reader=lambda: REVIEWED  # Source-location composition only, no calculation/SQL replacement.
    return tool
def fixture(name,records):
    root=BASE/name; (root/'files/内帐').mkdir(parents=True)
    database=root/'files/内帐/ledger.db'
    c=sqlite3.connect(database,isolation_level=None)
    try:
        c.execute('PRAGMA journal_mode=DELETE')
        c.execute('CREATE TABLE stock_items(id INTEGER PRIMARY KEY,category TEXT,product TEXT,weight TEXT,remark TEXT,sell_date TEXT,price TEXT)')
        c.execute('CREATE TABLE outside_allowed(secret TEXT)'); c.execute("INSERT INTO outside_allowed VALUES('NEVER_ECHO_PRIVATE_TABLE')")
        c.execute('BEGIN'); c.executemany('INSERT INTO stock_items VALUES(?,?,?,?,?,?,?)',records); c.commit()
    finally: c.close()
    b=read(database)
    manifest={'schemaVersion':1,'application':'xjy-jewelry-offline','kind':'initial-host-pre-update','id':'12121212-1212-4121-8121-121212121212','createdAt':'2026-10-19T07:19:00.000Z','originalRoot':str(BASE/'never-open-live'),'owner':{'schemaVersion':1,'type':'initial-patch-data-backup','id':'12121212-1212-4121-8121-121212121212'},'directories':['内帐'],'databases':[{'module':'ledger','path':'内帐/ledger.db','integrity':'ok','foreignKeyCount':0,'readOnly':True,'walConsistent':True,'busy':False},{'module':'sales','path':'sales/jewelry.sqlite'},{'module':'inventory','path':'inventory/stockcheck.db'}],'files':[{'path':'内帐/ledger.db','size':len(b),'sha256':digest(b)}],'bytes':len(b)}
    body=json.dumps(manifest,ensure_ascii=False).encode('utf-8'); (root/'manifest.json').write_bytes(body)
    return {'root':root,'db':database,'pin':digest(body),'manifest':manifest}
def record(i,weight='1',remark='在库',product='PT950_NEVER_ECHO_PRODUCT',category='铂金',sell_date=''):
    return (i,category,product,weight,remark,sell_date,'NEVER_ECHO_PRICE_987654')
def tree(root): return sorted((str(p.relative_to(root)),len(b:=p.read_bytes()),digest(b)) for p in root.rglob('*') if p.is_file())
class ConnectionTap:
    def __init__(self,raw,owner): self.raw,self.owner=raw,owner; self.closed=False
    @property
    def row_factory(self): return self.raw.row_factory
    @row_factory.setter
    def row_factory(self,v): self.raw.row_factory=v
    @property
    def in_transaction(self): return self.raw.in_transaction
    def set_authorizer(self,fn):
        self.owner.authorizer=fn; self.raw.set_authorizer(fn)
    def execute(self,sql,*args):
        self.owner.sql.append(sql)
        if sql==REVIEWED.SCHEMA_SQL and self.owner.probe:
            self.owner.probe(self.raw); self.owner.probe=None
        return self.raw.execute(sql,*args)
    def rollback(self): return self.raw.rollback()
    def close(self): self.closed=True; return self.raw.close()
class SQLitePort:
    def __init__(self,database): self.database=database; self.sql=[]; self.connections=[]; self.authorizer=None; self.probe=None
    def __getattr__(self,name): return getattr(sqlite3,name)
    def connect(self,target,**kwargs):
        assert target==self.database.as_uri()+'?mode=ro&immutable=1','Only the manifest-selected immutable owned snapshot may connect'
        assert kwargs=={'uri':True,'timeout':5,'isolation_level':None}
        c=ConnectionTap(sqlite3.connect(target,**kwargs),self); self.connections.append(c); return c
class BackupTests(unittest.TestCase):
    def test_T01_real_immutable_read_preserves_all_bytes_and_emits_only_aggregates_and_twenty_shared_ID_samples(self):
        assert SUBJECT.exists(),'UPGRADE_BACKUP_PLATINUM_FEATURE_REQUIRED: fixed backup reader is absent'
        rows=[record(1,'3.12'),record(2,'4.88'),record(3,'2',product='铂金板料'),record(4,'5','在途'),record(5,'6',product='PT990_NEVER_ECHO_PRODUCT'),record(6,'-1'),record(7,None),record(8,'2','在库；备注：有已售样品')]
        rows += [record(i,'1','未售出',product='PT990_NEVER_ECHO_PRODUCT') for i in range(9,45)]
        case=fixture('t01',rows); before=tree(case['root']); tool=subject(case); port=SQLitePort(case['db']); tool.sqlite3=port
        result=tool.read_backup(); payload=tool.encode_report(result); data=json.loads(payload)
        self.assertEqual(data['old']['cards']['inStockFine'],'9.60'); self.assertEqual(data['new']['cards']['inStockFine'],'11.50')
        self.assertEqual(data['new']['invalidWeights'],1); self.assertEqual(data['new']['missingWeightInputsCountedAsZeroByOriginalRule'],1)
        samples=data['samples']; self.assertLessEqual(len(samples),20); self.assertEqual(len({s['id'] for s in samples}),len(samples)); self.assertTrue(data['samplesTruncated'])
        for sample in samples:
            self.assertEqual(set(sample),{'id','reasons'}); self.assertTrue(set(sample['reasons'])<={'unknown_pt','state_unknown','invalidWeight','oldStateChanges'})
        self.assertNotIn('classificationChanges',data); self.assertNotIn('NEVER_ECHO',payload.decode('utf-8')); self.assertEqual(tree(case['root']),before)
        self.assertEqual(port.authorizer,REVIEWED.authorize); self.assertIn('PRAGMA query_only=ON',port.sql); self.assertIn('BEGIN',port.sql); self.assertTrue(all(c.closed for c in port.connections))
    def test_T02_real_SQLite_original_authorizer_denies_other_tables_price_and_writes_and_snapshot_guards_refuse_before_connect(self):
        assert SUBJECT.exists(),'UPGRADE_BACKUP_PLATINUM_FEATURE_REQUIRED: fixed backup reader is absent'
        case=fixture('t02',[record(1)]); before=tree(case['root']); tool=subject(case); port=SQLitePort(case['db']); tool.sqlite3=port
        def probes(c):
            self.assertEqual(c.execute('PRAGMA query_only').fetchone()[0],1)
            for sql in ['SELECT price FROM stock_items','SELECT secret FROM outside_allowed',"UPDATE stock_items SET weight='999' WHERE id=1",'CREATE TABLE escaped(value)',"ATTACH DATABASE ':memory:' AS escaped"]:
                with self.assertRaises(sqlite3.DatabaseError): c.execute(sql)
        port.probe=probes; tool.read_backup(); self.assertEqual(tree(case['root']),before)
        for suffix in ['-wal','-journal']:
            side=Path(str(case['db'])+suffix); side.write_bytes(b'NONEMPTY_SYNTHETIC_SIDECAR'); p=SQLitePort(case['db']); tool.sqlite3=p
            with self.assertRaises(Exception): tool.read_backup()
            self.assertEqual(len(p.connections),0); side.unlink()  # Only this new test-owned sentinel, never failure evidence.
        tool.MANIFEST_SHA='0'*64; p=SQLitePort(case['db']); tool.sqlite3=p
        with self.assertRaises(Exception): tool.read_backup()
        self.assertEqual(len(p.connections),0)
    def test_T03_fifty_thousand_rows_refuse_whole_totals_and_output_limit_has_no_partial_print(self):
        assert SUBJECT.exists(),'UPGRADE_BACKUP_PLATINUM_FEATURE_REQUIRED: fixed backup reader is absent'
        case=fixture('t03',[record(i) for i in range(1,50001)]); before=tree(case['root']); tool=subject(case)
        out=io.StringIO()
        with contextlib.redirect_stdout(out),self.assertRaises(Exception): tool.read_backup()
        self.assertEqual(out.getvalue(),''); self.assertEqual(tree(case['root']),before)
        small=fixture('t03-small',[record(1)]); tool=subject(small); report=tool.read_backup()
        with mock.patch.object(tool,'STDOUT_LIMIT',32),contextlib.redirect_stdout(out),self.assertRaises(Exception): tool.encode_report(report)
        self.assertEqual(out.getvalue(),'')
def main():
    global BASE,REVIEWED
    p=argparse.ArgumentParser(allow_abbrev=False); p.add_argument('--source-sha256',required=True); args=p.parse_args()
    read(SELF,args.source_sha256); read(PYTHON,PYTHON_SHA); read(GUARD,GUARD_SHA); read(VALIDATOR,VALIDATOR_SHA)
    guard=load(GUARD,'actual_backup_test_guard'); guard.read_context(ROOT); sys.addaudithook(no_f)
    read(READER,READER_SHA); reviewed=load(READER,'frozen_ae6_backup_test_reader')
    repack=ast.parse(read(REPACK,REPACK_SHA)); matches=[n.value for n in repack.body if isinstance(n,ast.Assign) and len(n.targets)==1 and isinstance(n.targets[0],ast.Name) and n.targets[0].id=='OLD_INVENTORY_B64']
    if len(matches)!=1: raise RuntimeError('One frozen old source literal required')
    body=base64.b64decode(ast.literal_eval(matches[0]),validate=True)
    if digest(body)!=reviewed.OLD_SHA: raise RuntimeError('Frozen old source changed')
    BASE=ROOT/'runtime'/('upgrade-backup-platinum-'+uuid.uuid4().hex); BASE.mkdir()
    old=BASE/'old-inventory-dashboard.py'; old.write_bytes(body)
    reviewed.W=ROOT; reviewed.OLD_SOURCE=old; reviewed.NEW_SOURCE=ROOT/'project/desktop/legacy-source/ledger/inventory_dashboard.py'; reviewed.PRESENTATION=ROOT/'project/desktop/legacy-source/ledger/presentation.py'
    read(reviewed.NEW_SOURCE,reviewed.NEW_SHA); read(reviewed.PRESENTATION,reviewed.PRESENTATION_SHA); REVIEWED=reviewed
    result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(BackupTests)); return 0 if result.wasSuccessful() else 1
if __name__=='__main__': raise SystemExit(main())
