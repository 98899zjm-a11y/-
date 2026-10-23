"""Three actual-Guest controls for the frozen overview reader; no Host run.
Only selected complete AST functions/entry run, on fresh owned C SQLite/WAL.
The metadata helper is an explicit synthetic port, not a real-helper proof.
"""
import os, sys
from pathlib import Path
ROOT = Path(__file__).absolute().parents[1]
PYTHON = Path('C:/Python314/python.exe')
if (os.name != 'nt' or os.path.normcase(str(ROOT)) != os.path.normcase('C:/xjy-work/xjy-web-stage1') or
        os.path.normcase(sys.executable) != os.path.normcase(str(PYTHON)) or not sys.flags.isolated or
        not sys.flags.no_site or not sys.flags.dont_write_bytecode or sys.flags.optimize):
    raise RuntimeError('Fixed actual Guest Python -I -B -S required; no Host run')
import argparse, ast, contextlib, datetime, hashlib, importlib.util, io, json, math, re, sqlite3, stat, time, types, unittest, uuid
from unittest import mock
SELF = ROOT/'audit-tools/overview-summary-readonly-test.py'
DIAG = ROOT/'audit-tools/read-current-overview-summary.py'
HELPER = ROOT/'audit-tools/read-current-ledger-paths.py'
REFERENCE = ROOT/'audit-tools/read-current-platinum-summary.py'
GUARD, VALIDATOR = ROOT/'stage1/sandbox-context.py', ROOT/'stage1/validate-sandbox-context.py'
DIAG_SHA = '4a280e4d3ab62d8b0ba57c4fda297639521fb10e1920146d96631ba632a2afd4'
GUARD_SHA = '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249'
VALIDATOR_SHA = '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207'
PYTHON_SHA = '434b361fe0c5960d404974feed493db47f2603a1ace2574312104fbed0182c6f'
FUNCTIONS = ('need','utc_now','bootstrap','config_gate','authorize','schema_gate','count_rows','number','aggregate','unique_object','reject_constant','parse_json','payroll_total','overview_rule','read_summary','main')
CONSTANTS = {'HELPER_SHA','REFERENCE_SHA','CFG_SHA','MONTH','START','END','ROW_LIMIT','STDOUT_LIMIT','JSON_LIMIT','PAYLOAD_LIMIT','DATABASE_LIMIT','NUMBER_LIMIT','TOTAL_LIMIT','SQL_STEPS','SQL_SECONDS','SALES','FIELDS','SALES_WHERE','PAYROLL_WHERE','EXPENSE_WHERE','FUNCTIONS'}
RULE = '[["经营结余","销售利润 - 工资成本 - 报销费用"]]'
SECRET = 'SYNTHETIC_PERSONAL_ROW_DO_NOT_OUTPUT'
BASE = BODY = TREE = HELPER_BODY = None

def sha(body): return hashlib.sha256(body).hexdigest()
def plain(file):
    for item in (file,*file.parents):
        info=item.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info,'st_file_attributes',0)&0x400 or stat.S_ISREG(info.st_mode) and info.st_nlink!=1:
            raise RuntimeError('Ordinary unlinked Guest input/fixture required')
def read(file,limit=1024*1024):
    plain(file)
    if not file.is_file() or file.stat().st_size>limit: raise RuntimeError('Bounded ordinary input required')
    value=file.read_bytes()
    if len(value)>limit: raise RuntimeError('Read bound exceeded')
    return value
def pinned(file,pin):
    body=read(file)
    if sha(body)!=pin: raise RuntimeError('Frozen synthetic input changed')
    return body
def no_f_open(event,args):
    if event=='open' and args and isinstance(args[0],(str,bytes,os.PathLike)) and re.search(r'(^|[/?:])f:',os.fsdecode(args[0]).replace('\\','/').lower()):
        raise RuntimeError('F content open forbidden in synthetic validation')

def constant(node,values):
    # Frozen data expressions only; Path/F assignments and imports never run.
    if isinstance(node,ast.Constant): return node.value
    if isinstance(node,ast.Name) and node.id in values: return values[node.id]
    if isinstance(node,ast.Tuple): return tuple(constant(x,values) for x in node.elts)
    if isinstance(node,ast.Dict): return {constant(k,values):constant(v,values) for k,v in zip(node.keys,node.values)}
    if isinstance(node,ast.BinOp):
        a,b=constant(node.left,values),constant(node.right,values)
        if isinstance(node.op,ast.Add): return a+b
        if isinstance(node.op,ast.Mult): return a*b
        if isinstance(node.op,ast.Pow) and type(b) is int and 0<=b<=18: return a**b
    if isinstance(node,ast.Call) and isinstance(node.func,ast.Name) and node.func.id=='frozenset' and len(node.args)==1 and not node.keywords:
        return frozenset(constant(node.args[0],values))
    raise RuntimeError('Unreviewed constant expression')

class Cursor:
    def __init__(self,raw,after=None): self.raw,self.after=raw,after
    def fetchone(self): return self.raw.fetchone()
    def fetchall(self):
        rows=self.raw.fetchall()
        if self.after: self.after()
        return rows
    def __iter__(self): return iter(self.raw)
class Connection:
    def __init__(self,raw,owner): self.raw,self.owner=raw,owner; self.closed=False; self.sql=[]; self.rollbacks=0
    @property
    def row_factory(self): return self.raw.row_factory
    @row_factory.setter
    def row_factory(self,value): self.raw.row_factory=value
    @property
    def in_transaction(self): return self.raw.in_transaction
    def set_authorizer(self,fn): self.raw.set_authorizer(fn)
    def set_progress_handler(self,*args): self.raw.set_progress_handler(*args)
    def execute(self,sql,parameters=()):
        self.sql.append(sql); cursor=self.raw.execute(sql,parameters)
        if sql=='BEGIN':
            if self.raw.execute('PRAGMA query_only').fetchone()[0]!=1: raise AssertionError('Actual query_only required')
            if self.owner.probe: self.owner.probe(self)
        after=None
        if 'FROM sqlite_schema' in sql and self.owner.after:
            after,self.owner.after=self.owner.after,None
        return Cursor(cursor,after)
    def rollback(self): self.rollbacks+=1; self.raw.rollback()
    def close(self):
        try: self.raw.close()
        finally: self.closed=True
class SQLitePort:
    def __init__(self,database): self.database=database; self.connections=[]; self.probe=self.after=None
    def __getattr__(self,name): return getattr(sqlite3,name)
    def connect(self,target,**options):
        if target!=self.database.as_uri()+'?mode=ro' or options!=dict(uri=True,timeout=5,isolation_level=None): raise AssertionError('Exact owned readonly URI/options required')
        plain(self.database); value=Connection(sqlite3.connect(target,**options),self); self.connections.append(value); return value
class Metadata:
    def __init__(self,directory,mode='good'): self.directory,self.mode=directory,mode; self.created=self.compiled=self.inspected=0
    def module(self,name):
        if name!='overview_readonly_metadata_helper': raise AssertionError('One explicit metadata namespace required')
        self.created+=1; value=types.ModuleType(name); value.DATA_ROOT=self.directory
        value.norm=lambda path:os.path.normcase(os.path.normpath(str(path)))
        def inspect():
            self.inspected+=1; pin=CONSTANT_VALUES['CFG_SHA'] if self.mode!='cfg' else '0'*64
            return ({'exists':True,'version':1,'sha256Before':pin,'sha256After':pin},
                    {'source':'fallback' if self.mode=='source' else 'saved-ledger-dataDir','dataDir':str(self.directory/'wrong' if self.mode=='path' else self.directory)})
        value.inspect_settings=inspect
        def checked(file,root,*,kind):
            if file!=self.directory/'ledger.db' or root!=self.directory or kind!='file': raise AssertionError('Only owned fixture metadata')
            plain(file); return file,file.stat(),[(file,file.stat().st_ino)]
        value.checked=checked
        value.recheck=lambda chain:[(plain(file),unittest.TestCase().assertEqual(file.stat().st_ino,inode)) for file,inode in chain]
        return value
    def compile(self,body,filename,mode,**options):
        if body!=HELPER_BODY or filename!=str(HELPER) or mode!='exec' or options!=dict(dont_inherit=True,optimize=0): raise AssertionError('Exact pinned helper-byte port required')
        self.compiled+=1
        return compile('pass',filename,'exec',dont_inherit=True,optimize=0)

CONSTANT_VALUES={}
def subject(directory,port=None,metadata=None):
    ns={'__name__':'overview_selected_functions','__file__':str(DIAG),'__doc__':__doc__,'argparse':argparse,'datetime':datetime,'hashlib':hashlib,'json':json,'math':math,'os':os,'re':re,'sqlite3':port or sqlite3,'stat':stat,'sys':sys,'time':time,'types':types,'Path':Path,
        'W':ROOT,'SELF':DIAG,'HELPER':HELPER,'REFERENCE':REFERENCE,'DIRECTORY':directory,'DATABASE':directory/'ledger.db',**CONSTANT_VALUES}
    defs=[]
    for name in FUNCTIONS:
        found=[n for n in TREE.body if isinstance(n,ast.FunctionDef) and n.name==name]
        if len(found)!=1 or found[0].decorator_list: raise RuntimeError('One complete frozen function required')
        defs.append(found[0])
    refusal=[n for n in TREE.body if isinstance(n,ast.ClassDef) and n.name=='Refused']
    if len(refusal)!=1 or ast.dump(refusal[0],include_attributes=False)!=ast.dump(ast.parse('class Refused(Exception): pass').body[0],include_attributes=False): raise RuntimeError('Exact refusal class required')
    exec(compile(ast.Module(body=refusal+defs,type_ignores=[]),str(DIAG),'exec',dont_inherit=True,optimize=0),ns)
    if metadata: ns.update(types=types.SimpleNamespace(ModuleType=metadata.module),compile=metadata.compile)
    return ns
def run_main(directory,mode='good',authorized=True,pin=DIAG_SHA):
    port=SQLitePort(directory/'ledger.db'); metadata=Metadata(directory,mode); ns=subject(directory,port,metadata)
    entry=[n for n in TREE.body if isinstance(n,ast.If) and isinstance(n.test,ast.Compare)]
    if len(entry)!=1: raise RuntimeError('One frozen __main__ entry required')
    out,err=io.StringIO(),io.StringIO(); argv=[str(DIAG),'--source-sha256',pin]+(['--authorized-overview-summary'] if authorized else [])
    ns['__name__']='__main__'
    with mock.patch.object(sys,'argv',argv),contextlib.redirect_stdout(out),contextlib.redirect_stderr(err):
        try: exec(compile(ast.Module(body=entry,type_ignores=[]),str(DIAG),'exec',dont_inherit=True,optimize=0),ns)
        except SystemExit as stopped: code=stopped.code
        else: raise AssertionError('Actual reader entry must terminate explicitly')
    return code,out.getvalue(),err.getvalue(),port,metadata

def fixture(tag):
    directory=BASE/tag; directory.mkdir(); plain(directory); db=directory/'ledger.db'
    with db.open('xb'): pass
    writer=sqlite3.connect(db,isolation_level=None,timeout=5)
    if writer.execute('PRAGMA journal_mode=WAL').fetchone()[0].lower()!='wal': raise RuntimeError('Synthetic WAL required')
    writer.executescript('CREATE TABLE sales(date TEXT,amount_c REAL,received REAL,cost REAL,profit_c REAL,comm_c REAL,comm_profit_c REAL,weight REAL,customer TEXT,product TEXT,price REAL);CREATE TABLE payroll_records(month TEXT,status TEXT,outputs_json TEXT,employee TEXT);CREATE TABLE expenses(date TEXT,status TEXT,amount REAL,employee TEXT);CREATE TABLE formula_sets(id INTEGER PRIMARY KEY,domain TEXT,formulas TEXT,actor TEXT);CREATE TABLE forbidden_table(secret TEXT);')
    writer.executemany('INSERT INTO sales VALUES(?,?,?,?,?,?,?,?,?,?,?)',[(d,*values,SECRET,SECRET,123.45) for d,values in [('2026-10-01',(1000,950,600,350,30,320,3.12)),('2026-10-15',(2000,1900,1200,700,60,640,4.88)),('2026-10-31',(-100,-90,-60,-30,-3,-27,-.5)),('2026-09-30',(99999,)*7),('2026-11-01',(99999,)*7)]])
    payroll=[('2026-10','已确认',{'应发工资':1000.25,'private':SECRET}),('2026-10','已发放',{'应发工资':2000.75}),('2026-10','已确认',{'private':SECRET}),('2026-10','已确认',{'应发工资':1e15}),('2026-10','已发放',{'应发工资':.1}),('2026-10','已确认',{'应发工资':-1e15}),('2026-10','草稿',{'应发工资':99999}),('2026-09','已确认',{'应发工资':99999})]
    writer.executemany('INSERT INTO payroll_records VALUES(?,?,?,?)',[(m,s,json.dumps(v,ensure_ascii=False),SECRET) for m,s,v in payroll])
    writer.executemany('INSERT INTO expenses VALUES(?,?,?,?)',[('2026-10-01','已审核',100.25,SECRET),('2026-10-31','已支付',-20.25,SECRET),('2026-10-05','草稿',99999,SECRET),('2026-11-01','已审核',99999,SECRET)])
    writer.execute('INSERT INTO formula_sets VALUES(7,?,?,?)',('overview',RULE,SECRET));writer.execute('INSERT INTO forbidden_table VALUES(?)',(SECRET,))
    return directory,writer
def snapshot(writer): return {name:writer.execute('SELECT * FROM '+name).fetchall() if writer.execute("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?",(name,)).fetchone() else None for name in ('sales','payroll_records','expenses','formula_sets','forbidden_table')}
def closed(test,port):
    test.assertEqual(len(port.connections),1,'Exactly one readonly connection per invocation')
    for connection in port.connections:
        test.assertTrue(connection.closed);test.assertEqual(connection.sql.count('BEGIN'),1);test.assertEqual(connection.rollbacks,1)
        with test.assertRaises(sqlite3.ProgrammingError): connection.raw.execute('SELECT 1')

class OverviewSummary(unittest.TestCase):
    def test_O01_real_wal_month_aggregates_and_single_snapshot_authority(self):
        directory,writer=fixture('O01');self.addCleanup(writer.close);before=snapshot(writer);port=SQLitePort(directory/'ledger.db');ns=subject(directory,port)
        def probe(connection):
            for action in (sqlite3.SQLITE_UPDATE,sqlite3.SQLITE_INSERT,sqlite3.SQLITE_DELETE,sqlite3.SQLITE_ATTACH): self.assertEqual(ns['authorize'](action,'sales','received','main',None),sqlite3.SQLITE_DENY)
            for sql in ('SELECT customer FROM sales','SELECT price FROM sales','SELECT employee FROM payroll_records','SELECT * FROM forbidden_table','UPDATE sales SET amount_c=0','DELETE FROM expenses',"ATTACH DATABASE '"+str(directory/'escape.db').replace("'","''")+"' AS escape"):
                with self.assertRaises(sqlite3.DatabaseError): connection.raw.execute(sql)
        port.probe=probe
        def writer_only():
            writer.execute('BEGIN');writer.execute("UPDATE sales SET amount_c=1010 WHERE date='2026-10-01'");writer.execute("UPDATE expenses SET amount=110.25 WHERE date='2026-10-01'");writer.execute('INSERT INTO formula_sets VALUES(8,?,?,?)',('overview','[["经营结余","销售利润"]]',SECRET));writer.commit()
        port.after=writer_only;result=ns['read_summary']();closed(self,port)
        self.assertEqual(result['sales'],{'count':3,'amount_c':2900.0,'received':2760.0,'cost':1740.0,'profit_c':1020.0,'comm_c':87.0,'comm_profit_c':933.0,'weight':7.5})
        self.assertEqual(result['payroll']['count'],6);self.assertEqual(result['payroll']['wageCost'],3001.1);self.assertEqual(result['expenses'],{'count':2,'amount':80.0});self.assertEqual(result['grossRate'],0.3695652173913043)
        self.assertEqual(result['overviewRule']['id'],7);self.assertEqual(result['overviewRule']['expressionCharacters'],18);self.assertEqual(result['overviewRule']['expressionSha256'],'71d4ec66b664ce62e4abd51015f4306fe98cd69c34522cbb269708a969130dbc');self.assertEqual(result['overviewRule']['storedPayloadSha256'],'c93301b8f8da528104a2826d8f317f7364441c01992fd7affb30d2a275a091ce')
        self.assertIsNone(result['computedNet']);self.assertFalse(result['overviewRule']['evaluated']);self.assertFalse(result['overviewRule']['identityVerified']);self.assertNotIn(SECRET,json.dumps(result,ensure_ascii=False));self.assertFalse((directory/'escape.db').exists())
        changed=snapshot(writer);self.assertNotEqual(before,changed);code,out,err,again,meta=run_main(directory);self.assertEqual((code,err),(0,''));closed(self,again);report=json.loads(out);self.assertEqual(report['sales']['amount_c'],2910);self.assertEqual(report['expenses']['amount'],90);self.assertEqual(report['overviewRule']['id'],8);self.assertEqual(report['overviewRule']['expressionCharacters'],4);self.assertEqual(report['overviewRule']['expressionSha256'],'faab9397abf0504cabbd8bcedd57a18722045bc69f77a84ac54bde316abbe3b6');self.assertIsNone(report['computedNet']);self.assertEqual(snapshot(writer),changed)
        for forbidden in (SECRET,'outputs_json','销售利润 - 工资成本 - 报销费用','销售利润"'): self.assertNotIn(forbidden,out)
        self.assertEqual((meta.created,meta.compiled,meta.inspected),(1,1,2));self.assertEqual(report['month'],'2026-10');self.assertFalse(report['uiSelectedMonthVerified'])

    def test_O02_dirty_missing_and_real_limits_refuse_without_partial_stdout(self):
        expected={'json':'OVERVIEW_READONLY_FAILED_NO_TOTALS','duplicate':'DUPLICATE_JSON_KEY_NO_TOTALS','wage-text':'DIRTY_OR_OVERLIMIT_NUMBER_NO_TOTALS','wage-null':'DIRTY_OR_OVERLIMIT_NUMBER_NO_TOTALS','wage-inf':'DIRTY_OR_OVERLIMIT_NUMBER_NO_TOTALS','date':'DIRTY_SELECTED_DATE_NO_TOTALS','number':'DIRTY_OR_OVERLIMIT_NUMBER_NO_TOTALS','missing-table':'ORDINARY_APPROVED_TABLES_REQUIRED','missing-column':'APPROVED_COLUMNS_REQUIRED','json-limit':'DIRTY_OR_OVERLIMIT_JSON_NO_TOTALS','row-limit':'ROW_LIMIT_REACHED_NO_TOTALS'}
        cases=[('json','UPDATE payroll_records SET outputs_json=? WHERE rowid=1',('{bad',)),('duplicate','UPDATE payroll_records SET outputs_json=? WHERE rowid=1',('{"应发工资":1,"应发工资":2}',)),('wage-text','UPDATE payroll_records SET outputs_json=? WHERE rowid=1',('{"应发工资":"12.50"}',)),('wage-null','UPDATE payroll_records SET outputs_json=? WHERE rowid=1',('{"应发工资":null}',)),('wage-inf','UPDATE payroll_records SET outputs_json=? WHERE rowid=1',('{"应发工资":1e999}',)),('date',"UPDATE sales SET date='2026-10-15 trailing' WHERE date='2026-10-15'",()),('number',"UPDATE sales SET amount_c='not-a-number' WHERE date='2026-10-01'",()),('missing-table','DROP TABLE expenses',()),('missing-column','ALTER TABLE sales DROP COLUMN comm_profit_c',()),('json-limit','UPDATE payroll_records SET outputs_json=? WHERE rowid=1',(json.dumps({'应发工资':1,'x':'a'*65536}),)),('row-limit',None,())]
        for tag,sql,args in cases:
            with self.subTest(case=tag):
                directory,writer=fixture('O02-'+tag)
                try:
                    if sql: writer.execute(sql,args)
                    else:
                        writer.execute('BEGIN')
                        writer.executemany('INSERT INTO sales(date,amount_c,received,cost,profit_c,comm_c,comm_profit_c,weight) VALUES(?,?,?,?,?,?,?,?)',(('2026-10-01',0,0,0,0,0,0,0) for _ in range(49997)))
                        writer.commit()
                    before=snapshot(writer);code,out,err,port,_=run_main(directory);self.assertEqual(code,1);self.assertEqual(out,'');failure=json.loads(err);self.assertFalse(failure['ok']);self.assertEqual(failure['code'],expected[tag]);self.assertNotIn(SECRET,err);closed(self,port);self.assertEqual(snapshot(writer),before)
                finally: writer.close()

    def test_O03_separate_authorization_source_and_configuration_gates_precede_connect(self):
        directory,writer=fixture('O03');self.addCleanup(writer.close);before=snapshot(writer)
        for tag,kwargs,imports in [('authorization',{'authorized':False},0),('source-pin',{'pin':'0'*64},0),('cfg-pin',{'mode':'cfg'},1),('source-flag',{'mode':'source'},1),('fixed-path',{'mode':'path'},1)]:
            with self.subTest(case=tag):
                code,out,err,port,meta=run_main(directory,**kwargs);self.assertEqual(code,1);self.assertEqual(out,'');self.assertEqual(port.connections,[]);self.assertEqual(meta.compiled,imports);self.assertTrue(json.loads(err)['code'])
        self.assertEqual(snapshot(writer),before)

def main():
    global BASE,BODY,TREE,HELPER_BODY,CONSTANT_VALUES
    parser=argparse.ArgumentParser(allow_abbrev=False);parser.add_argument('--source-sha256',required=True);parser.add_argument('--case',choices=('all','O01','O02','O03'),default='all');args=parser.parse_args()
    if not re.fullmatch('[0-9a-f]{64}',args.source_sha256): raise RuntimeError('Root test SHA required')
    pinned(SELF,args.source_sha256);pinned(PYTHON,PYTHON_SHA);pinned(GUARD,GUARD_SHA);pinned(VALIDATOR,VALIDATOR_SHA)
    if sys.version_info[:3]!=(3,14,8) or importlib.util.MAGIC_NUMBER.hex()!='2b0e0d0a': raise RuntimeError('Fixed public Python 3.14.8 required')
    guard=types.ModuleType('overview_actual_guest_context');guard.__file__=str(GUARD);exec(compile(read(GUARD),str(GUARD),'exec',dont_inherit=True,optimize=0),guard.__dict__);admission=guard.read_context(ROOT);sys.addaudithook(no_f_open)
    BODY=pinned(DIAG,DIAG_SHA);TREE=ast.parse(BODY,filename=str(DIAG));CONSTANT_VALUES={}
    for node in TREE.body:
        if not isinstance(node,ast.Assign) or len(node.targets)!=1: continue
        names=[node.targets[0].id] if isinstance(node.targets[0],ast.Name) else [x.id for x in node.targets[0].elts] if isinstance(node.targets[0],ast.Tuple) and all(isinstance(x,ast.Name) for x in node.targets[0].elts) else []
        if names and set(names).issubset(CONSTANTS):
            value=constant(node.value,CONSTANT_VALUES);CONSTANT_VALUES.update(zip(names,value if len(names)>1 else [value]))
    if set(CONSTANT_VALUES)!=CONSTANTS or CONSTANT_VALUES['ROW_LIMIT']!=50000 or CONSTANT_VALUES['MONTH']!='2026-10': raise RuntimeError('Exact frozen data constants required')
    HELPER_BODY=pinned(HELPER,CONSTANT_VALUES['HELPER_SHA']);pinned(REFERENCE,CONSTANT_VALUES['REFERENCE_SHA'])
    runtime=ROOT/'runtime';plain(ROOT)
    if runtime.exists(): plain(runtime)
    else: runtime.mkdir()
    BASE=runtime/('overview-summary-readonly-'+str(uuid.uuid4()));BASE.mkdir();plain(BASE)
    tests=unittest.defaultTestLoader.loadTestsFromTestCase(OverviewSummary)
    if args.case!='all': tests=unittest.TestSuite(t for t in tests if t._testMethodName.startswith('test_'+args.case+'_'))
    result=unittest.TextTestRunner(verbosity=2).run(tests);report={'purpose':'synthetic-overview-readonly-validation','testSourceSha256':args.source_sha256,'readerSourceSha256':DIAG_SHA,'testsRun':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'skipped':len(result.skipped),'passed':result.wasSuccessful(),'admission':admission,'ownedFixtureRoot':str(BASE),'metadataHelperExecuted':False,'realConfigurationRead':False,'realDatabaseReadOrChanged':False,'guiVerified':False}
    with (BASE/'result.json').open('x',encoding='utf-8') as output: json.dump(report,output,ensure_ascii=False,indent=2);output.write('\n')
    print(json.dumps(report,ensure_ascii=False),flush=True);return 0 if result.wasSuccessful() else 1
if __name__=='__main__': raise SystemExit(main())
