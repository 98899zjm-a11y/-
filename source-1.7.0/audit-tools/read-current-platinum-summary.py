"""Draft for separately authorized six-column ledger read; do not run yet.

One fixed SQLite mode=ro/query_only transaction, no business writes or file
output. Only reviewed AST definitions run; no app imports/pyc/EXE/service.
Normal SQLite WAL/SHM locking may occur; this is not a physical stock count.
"""
import argparse, ast, datetime, hashlib, importlib.util, json, os, re, sqlite3, stat, sys
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP, getcontext
from pathlib import Path

W=Path('E:/codex/2026-10-15/work/xjy-v16-deep-audit')
SELF=W/'audit-tools/read-current-platinum-summary.py'
HELPER=W/'audit-tools/read-current-ledger-paths.py'
HELPER_SHA='cee5ea3fedab9d880ddbc0ee60533ff16d334df18a05cc937d60c06324b11139'
OLD_SOURCE=W/'sandbox/input/platinum-diagnosis-a1/project/desktop/legacy-source/ledger/inventory_dashboard.py'
OLD_SHA='e65660926f866f476603426dcbc28135c2fdb557a0c23f4e70b2dd3027620ac7'
NEW_SOURCE=W/'project/desktop/legacy-source/ledger/inventory_dashboard.py'
NEW_SHA='5a2616a55beadf3a4b89c380074e83daa0fb2e99c3b639d01e2df56cf34101ad'
PRESENTATION=W/'project/desktop/legacy-source/ledger/presentation.py'
PRESENTATION_SHA='07eedd042e8eb76ac720e9eb2b7375b73c5122b0865e13d80abd96bd2d4b070d'
DIRECTORY=Path('F:/鑫金源珠宝资料/内帐')
DATABASE=DIRECTORY/'ledger.db'
CFG_SHA='f672957f6b469feec68b278ad283a6254973e805ae7da451bb10e671fa401a57'
ROW_LIMIT=50000
CHANGE_LIMIT=100
STDOUT_LIMIT=64*1024
FIELDS=('id','category','product','weight','remark','sell_date')
DEFINITIONS=('inventory_state','platinum_identity','_grams')
STATES={'在库':'in_stock','在途':'transit','已售':'sold','待确认':'unknown'}
SCHEMA_SQL="SELECT type,sql FROM sqlite_schema WHERE name='stock_items' AND type='table'"
ROWS_SQL='SELECT id,category,product,weight,remark,sell_date FROM stock_items ORDER BY id LIMIT 50000'

class Refused(Exception): pass
def need(value,code):
    if not value: raise Refused(code)
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()

def bootstrap(file,pin):
    need(file.is_relative_to(W),'OWNED_SOURCE_REQUIRED')
    for item in (file,*file.parents):
        s=item.lstat()
        need(not stat.S_ISLNK(s.st_mode) and not getattr(s,'st_file_attributes',0)&0x400,'SOURCE_REPARSE_REFUSED')
        need(not stat.S_ISREG(s.st_mode) or s.st_nlink==1,'SOURCE_HARDLINK_REFUSED')
    need(file.is_file() and file.stat().st_size<=256*1024,'BOUNDED_SOURCE_REQUIRED')
    body=file.read_bytes(); need(len(body)<=256*1024 and hashlib.sha256(body).hexdigest()==pin,'SOURCE_PIN_MISMATCH')
    return body

def selected(body,names,filename):
    tree=ast.parse(body,filename=filename); definitions=[]
    for name in names:
        found=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name==name]
        need(len(found)==1 and not found[0].decorator_list,'ONE_REVIEWED_DEFINITION_REQUIRED')
        definitions.append(found[0])
    module=ast.Module(body=definitions,type_ignores=[])
    for node in ast.walk(module):
        need(not isinstance(node,(ast.Import,ast.ImportFrom,ast.ClassDef,ast.AsyncFunctionDef,ast.Global,ast.Nonlocal)),'UNREVIEWED_SELECTED_AST')
        if isinstance(node,ast.Call) and isinstance(node.func,ast.Name):
            need(node.func.id not in ('exec','eval','compile','__import__','open','input','globals','locals','getattr','setattr'),'SELECTED_IO_PORT_REFUSED')
    safe={'str':str,'bool':bool,'any':any,'enumerate':enumerate,'ValueError':ValueError,'TypeError':TypeError,'abs':abs,'format':format}
    namespace={'__name__':'platinum_reviewed_definitions','__builtins__':safe,'re':re,
               'Decimal':Decimal,'InvalidOperation':InvalidOperation,'ROUND_HALF_UP':ROUND_HALF_UP}
    exec(compile(module,filename,'exec',dont_inherit=True,optimize=0),namespace)
    return {name:namespace[name] for name in names},{n.name:ast.dump(n,include_attributes=False) for n in definitions}

def models():
    old,old_ast=selected(bootstrap(OLD_SOURCE,OLD_SHA),DEFINITIONS,str(OLD_SOURCE))
    new,new_ast=selected(bootstrap(NEW_SOURCE,NEW_SHA),DEFINITIONS,str(NEW_SOURCE))
    need(all(old_ast[name]==new_ast[name] for name in ('platinum_identity','_grams')),'PURITY_OR_WEIGHT_RULE_CHANGED')
    formatter,_=selected(bootstrap(PRESENTATION,PRESENTATION_SHA),('fmt2',),str(PRESENTATION))
    return old,new,formatter['fmt2']

def config_gate(helper):
    settings,selection=helper.inspect_settings()
    need(settings.get('exists') is True and settings.get('version')==1,'EXISTING_VERSION_ONE_CONFIG_REQUIRED')
    need(settings.get('sha256Before')==CFG_SHA and settings.get('sha256After')==CFG_SHA,'FIXED_CONFIG_SHA_REQUIRED')
    need(selection.get('source')=='saved-ledger-dataDir' and helper.norm(selection.get('dataDir'))==helper.norm(DIRECTORY),'EXACT_SAVED_LEDGER_DIRECTORY_REQUIRED')
    return settings['sha256After']

def authorize(action,arg1,arg2,database,source):
    if action==sqlite3.SQLITE_SELECT: return sqlite3.SQLITE_OK
    if action==sqlite3.SQLITE_TRANSACTION and arg1 in ('BEGIN','ROLLBACK'): return sqlite3.SQLITE_OK
    if action==sqlite3.SQLITE_PRAGMA:
        if arg1=='query_only' and arg2 in (None,'ON','1'): return sqlite3.SQLITE_OK
        if arg1=='table_info' and arg2=='stock_items': return sqlite3.SQLITE_OK
    if action==sqlite3.SQLITE_READ and database=='main' and source is None:
        if arg1=='stock_items' and arg2 in FIELDS: return sqlite3.SQLITE_OK
        if arg1 in ('sqlite_master','sqlite_schema') and arg2 in ('type','name','sql'): return sqlite3.SQLITE_OK
    return sqlite3.SQLITE_DENY

def read_rows():
    connection=sqlite3.connect(DATABASE.as_uri()+'?mode=ro',uri=True,timeout=5,isolation_level=None)
    try:
        connection.row_factory=sqlite3.Row; connection.set_authorizer(authorize)
        connection.execute('PRAGMA query_only=ON')
        need(connection.execute('PRAGMA query_only').fetchone()[0]==1,'QUERY_ONLY_REQUIRED')
        connection.execute('BEGIN')
        schema=connection.execute(SCHEMA_SQL).fetchall()
        need(len(schema)==1 and isinstance(schema[0]['sql'],str) and re.match(r'^\s*CREATE\s+TABLE\b',schema[0]['sql'],re.I),'ORDINARY_STOCK_ITEMS_TABLE_REQUIRED')
        columns=connection.execute('PRAGMA table_info(stock_items)').fetchall()
        need(set(FIELDS).issubset({r['name'] for r in columns}),'SIX_STOCK_COLUMNS_REQUIRED')
        rows=[dict(row) for row in connection.execute(ROWS_SQL).fetchall()]
        need(len(rows)<ROW_LIMIT,'ROW_LIMIT_REACHED_NO_TOTALS')
        need(all(type(row['id']) is int for row in rows),'INTEGER_STOCK_IDS_REQUIRED')
        return rows
    finally:
        try:
            if connection.in_transaction: connection.rollback()
        finally: connection.close()

def empty_totals():
    overall={name:{'count':0,'grams':Decimal(0)} for name in STATES.values()}
    buckets={state:{kind:{'count':0,'grams':Decimal(0),'fine_grams':Decimal(0)} for kind in ('pt950','fine_board','unknown_pt')} for state in ('in_stock','transit')}
    return {'overall':overall,'buckets':buckets,'invalidWeights':0,'missingWeightInputs':0}

def add(totals,row,functions):
    state=functions['inventory_state'](row); need(state in STATES,'UNKNOWN_STATE_RESULT')
    key=STATES[state]; bucket,factor=functions['platinum_identity'](row); grams=functions['_grams'](row.get('weight'))
    totals['overall'][key]['count']+=1
    if row.get('weight') is None or row.get('weight')=='': totals['missingWeightInputs']+=1
    if grams is None:
        totals['invalidWeights']+=1; return state,None,None
    totals['overall'][key]['grams']+=grams
    fine=grams*factor if factor is not None else None
    if key in totals['buckets'] and bucket in totals['buckets'][key]:
        item=totals['buckets'][key][bucket]; item['count']+=1; item['grams']+=grams
        if fine is not None: item['fine_grams']+=fine
    contribution=fine if bucket in ('pt950','fine_board') and fine is not None else Decimal(0)
    return state,contribution if state=='在库' else Decimal(0),contribution if state=='在途' else Decimal(0)

def fine_total(totals,state):
    b=totals['buckets'][state]
    return b['pt950']['fine_grams']+b['fine_board']['fine_grams']

def render(totals,fmt2):
    def numbers(item): return {k:format(v,'f') if isinstance(v,Decimal) else v for k,v in item.items()}
    buckets={state:{kind:numbers(item) for kind,item in values.items()} for state,values in totals['buckets'].items()}
    for state in buckets: buckets[state]['fine_grams']=format(fine_total(totals,state),'f')
    stock=totals['buckets']['in_stock']
    # Exactly the original snapshot float conversion followed by original fmt2.
    cards={'inStockFine':fmt2(float(fine_total(totals,'in_stock'))),
           'pt950Fine':fmt2(float(stock['pt950']['fine_grams'])),'pt950Raw':fmt2(float(stock['pt950']['grams'])),
           'boardAndBeansRaw':fmt2(float(stock['fine_board']['grams'])),'transitFine':fmt2(float(fine_total(totals,'transit')))}
    return {'overall':{k:numbers(v) for k,v in totals['overall'].items()},'platinum':buckets,'cards':cards,
            'invalidWeights':totals['invalidWeights'],'missingWeightInputsCountedAsZeroByOriginalRule':totals['missingWeightInputs']}

def calculate(rows,old,new,fmt2):
    before=empty_totals(); after=empty_totals(); changes=[]; total_changes=0
    for row in rows:
        old_state,old_fine,old_transit=add(before,row,old); new_state,new_fine,new_transit=add(after,row,new)
        if old_state!=new_state:
            total_changes+=1
            if len(changes)<CHANGE_LIMIT:
                changes.append({'id':row['id'],'oldState':old_state,'newState':new_state,
                                'inStockFineDeltaExact':format(new_fine-old_fine,'f') if old_fine is not None and new_fine is not None else None,
                                'transitFineDeltaExact':format(new_transit-old_transit,'f') if old_transit is not None and new_transit is not None else None})
    return {'rowCount':len(rows),'totalsAreComplete':True,'old':render(before,fmt2),'new':render(after,fmt2),
            'inStockFineDeltaExact':format(fine_total(after,'in_stock')-fine_total(before,'in_stock'),'f'),
            'classificationChanges':{'totalChanges':total_changes,'reportedChanges':len(changes),
                                     'truncated':total_changes>len(changes),'selection':'first 100 by id','rows':changes}}

def main():
    p=argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    p.add_argument('--authorized-ledger-readonly',action='store_true'); p.add_argument('--source-sha256',required=True); args=p.parse_args()
    need(os.name=='nt' and os.path.normcase(sys.executable)==os.path.normcase('C:/Python314/python.exe') and
         sys.flags.isolated and sys.flags.no_site and sys.flags.dont_write_bytecode and not sys.flags.optimize,'FIXED_ISOLATED_PUBLIC_PYTHON_REQUIRED')
    need(Path(__file__).absolute()==SELF,'FIXED_TOOL_PATH_REQUIRED')
    need(args.authorized_ledger_readonly,'SEPARATE_LEDGER_READ_AUTHORIZATION_REQUIRED')
    need(re.fullmatch('[0-9a-f]{64}',args.source_sha256),'ROOT_TOOL_SHA_REQUIRED'); bootstrap(SELF,args.source_sha256); bootstrap(HELPER,HELPER_SHA)
    spec=importlib.util.spec_from_file_location('platinum_readonly_metadata_helper',HELPER); helper=importlib.util.module_from_spec(spec); spec.loader.exec_module(helper)
    old,new,fmt2=models(); need(getcontext().prec==28,'DEFAULT_DECIMAL_PRECISION_REQUIRED'); started=now(); config_before=config_gate(helper)
    _,_,chain=helper.checked(DATABASE,helper.DATA_ROOT,kind='file'); rows=read_rows(); helper.recheck(chain)
    result=calculate(rows,old,new,fmt2); config_after=config_gate(helper)
    for file,pin in ((SELF,args.source_sha256),(HELPER,HELPER_SHA),(OLD_SOURCE,OLD_SHA),(NEW_SOURCE,NEW_SHA),(PRESENTATION,PRESENTATION_SHA)): bootstrap(file,pin)
    report={'version':1,'purpose':'six-column-stock-items-readonly-rule-comparison','readStartedAtUtc':started,'readCompletedAtUtc':now(),
            'toolSourceSha256':args.source_sha256,'oldRuleSourceSha256':OLD_SHA,'newRuleSourceSha256':NEW_SHA,'formatterSourceSha256':PRESENTATION_SHA,
            'configSha256Before':config_before,'configSha256After':config_after,'fixedLedgerPath':str(DATABASE),
            'singleReadTransaction':True,'queryOnly':True,'rowLimitExclusive':ROW_LIMIT,'physicalStockVerified':False,
            'decimalContextPrecision':getcontext().prec,
            'liveProcessConnectionVerified':False,'businessRowsOrSchemaModified':False,'consistentCopyCreated':False,**result}
    payload=(json.dumps(report,ensure_ascii=False,indent=2,allow_nan=False)+'\n').encode('utf-8')
    need(len(payload)<=STDOUT_LIMIT,'STDOUT_LIMIT_EXCEEDED_NO_PARTIAL_TOTALS'); print(payload.decode('utf-8'),end=''); return 0

if __name__=='__main__':
    try: raise SystemExit(main())
    except Refused as error: print(json.dumps({'ok':False,'code':str(error)}),file=sys.stderr); raise SystemExit(1)
    except Exception as error: print(json.dumps({'ok':False,'code':'READONLY_DIAGNOSIS_FAILED','type':type(error).__name__}),file=sys.stderr); raise SystemExit(1)
