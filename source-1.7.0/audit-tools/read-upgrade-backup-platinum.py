"""One separately authorized immutable six-column read of a fixed completed backup.

No live config, app/pyc import, database writes, file output or guessed purity.
Only the pinned ae6 reader's reviewed models/calculation/authorizer are reused.
"""
import argparse, ctypes, hashlib, importlib.util, json, msvcrt, os, re, sqlite3, stat, sys
from pathlib import Path
W=Path('E:/codex/2026-10-15/work/xjy-v16-deep-audit')
SELF=W/'audit-tools/read-upgrade-backup-platinum.py'
READER=W/'audit-tools/read-current-platinum-summary.py'
READER_SHA='ae6c514a354366cef19cfa5a1a504b33874f57d3be6c4cdedeeef9e76360fe01'
BACKUP_ROOT=Path('F:/自制软件/xjy-jewelry-offline/.xjy-patches/898e15209abeddd038eeb353a27dd1cb3526148419558ea6f1d53c298a3aa9a8/9e717609-7598-4a8d-8b4c-f0dbdd7b6172/data-backup')
MANIFEST_SHA='46a6be408522ea01a4185c3e5ccaa5225368a4b50c4372eff2b544b196d8b2f7'
STDOUT_LIMIT=64*1024
class Refused(Exception): pass
def need(value,code):
    if not value: raise Refused(code)
def ordinary(file):
    need(file.is_absolute() and not str(file).startswith(('\\\\','//')),'ABSOLUTE_LOCAL_PATH_REQUIRED')
    for part in file.parts[1:]:
        need(part not in ('.','..') and not part.endswith((' ','.')) and not re.search(r'[<>:"|?*\x00-\x1f]',part),'CANONICAL_PATH_REQUIRED')
    for p in (file,*file.parents):
        s=p.lstat(); need(not stat.S_ISLNK(s.st_mode) and not getattr(s,'st_file_attributes',0)&0x400,'REPARSE_REFUSED')
        need(os.path.normcase(os.path.realpath(p,strict=True))==os.path.normcase(str(p)),'PATH_ALIAS_REFUSED')
        need(stat.S_ISDIR(s.st_mode) if p!=file else stat.S_ISREG(s.st_mode) and s.st_nlink==1,'ORDINARY_SINGLE_LINK_FILE_REQUIRED')
    return file.lstat()
def hold_read(file):
    ordinary(file); k=ctypes.WinDLL('kernel32',use_last_error=True)
    k.CreateFileW.argtypes=(ctypes.c_wchar_p,ctypes.c_uint32,ctypes.c_uint32,ctypes.c_void_p,ctypes.c_uint32,ctypes.c_uint32,ctypes.c_void_p); k.CreateFileW.restype=ctypes.c_void_p
    h=k.CreateFileW(str(file),0x80000000,1,None,3,0x80,None)  # GENERIC_READ, FILE_SHARE_READ only, OPEN_EXISTING.
    need(h not in (None,ctypes.c_void_p(-1).value),'SHARE_READ_HANDLE_REQUIRED')
    try: descriptor=msvcrt.open_osfhandle(h,os.O_RDONLY|os.O_BINARY)
    except BaseException:
        k.CloseHandle.argtypes=(ctypes.c_void_p,); k.CloseHandle(h); raise
    return os.fdopen(descriptor,'rb',closefd=True)
def stamp(s): return (s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_nlink)
def common(s): return (s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_nlink)
def proof(file,stream,limit,collect=False):
    before=ordinary(file); opened=os.fstat(stream.fileno()); need(opened.st_size<=limit,'BOUNDED_READ_REQUIRED')
    stream.seek(0); h=hashlib.sha256(); chunks=[]; size=0
    while block:=stream.read(1024*1024):
        size+=len(block); need(size<=limit,'BOUNDED_READ_REQUIRED'); h.update(block)
        if collect: chunks.append(block)
    ended=os.fstat(stream.fileno()); after=ordinary(file)
    need(stamp(before)==stamp(after) and stamp(opened)==stamp(ended) and common(before)==common(opened) and size==opened.st_size,'INPUT_CHANGED')
    return {'size':size,'sha256':h.hexdigest(),'bytes':b''.join(chunks) if collect else None}
def pinned_bytes(file,pin,limit):
    with hold_read(file) as stream: result=proof(file,stream,limit,True)
    need(result['sha256']==pin,'SOURCE_OR_MANIFEST_PIN_MISMATCH'); return result['bytes']
def load_reader():
    body=pinned_bytes(READER,READER_SHA,256*1024)
    spec=importlib.util.spec_from_file_location('approved_ae6_backup_reader',READER); module=importlib.util.module_from_spec(spec)
    exec(compile(body,str(READER),'exec',dont_inherit=True,optimize=0),module.__dict__)
    return module  # Its __main__, config_gate and live read_rows are never called.
def quiet_sidecars(database):
    for suffix in ('-wal','-journal'):
        file=Path(str(database)+suffix)
        if os.path.lexists(file): need(ordinary(file).st_size==0,'NONEMPTY_SQLITE_SIDECAR_REFUSED')
def snapshot_rows(database,reader):
    c=sqlite3.connect(database.as_uri()+'?mode=ro&immutable=1',uri=True,timeout=5,isolation_level=None)
    try:
        c.row_factory=sqlite3.Row; c.set_authorizer(reader.authorize); c.execute('PRAGMA query_only=ON')
        need(c.execute('PRAGMA query_only').fetchone()[0]==1,'QUERY_ONLY_REQUIRED'); c.execute('BEGIN')
        schema=c.execute(reader.SCHEMA_SQL).fetchall()
        need(len(schema)==1 and isinstance(schema[0]['sql'],str) and re.match(r'^\s*CREATE\s+TABLE\b',schema[0]['sql'],re.I),'ORDINARY_STOCK_TABLE_REQUIRED')
        columns=c.execute('PRAGMA table_info(stock_items)').fetchall(); need(set(reader.FIELDS)<={r['name'] for r in columns},'SIX_COLUMNS_REQUIRED')
        rows=[dict(r) for r in c.execute(reader.ROWS_SQL).fetchall()]
        need(len(rows)<reader.ROW_LIMIT,'ROW_LIMIT_REACHED_NO_TOTALS'); need(all(type(r['id']) is int for r in rows),'INTEGER_IDS_REQUIRED'); return rows
    finally:
        try:
            if c.in_transaction: c.rollback()
        finally: c.close()
def read_backup():
    need(re.fullmatch('[a-f0-9]{64}',MANIFEST_SHA) and MANIFEST_SHA!='0'*64,'PINNED_COMPLETED_BACKUP_REQUIRED')
    manifest_file=BACKUP_ROOT/'manifest.json'; raw=pinned_bytes(manifest_file,MANIFEST_SHA,16*1024*1024); manifest=json.loads(raw)
    need(manifest.get('schemaVersion')==1 and manifest.get('application')=='xjy-jewelry-offline' and manifest.get('kind')=='initial-host-pre-update','COMPLETED_BACKUP_MANIFEST_REQUIRED')
    ledger=[r for r in manifest.get('databases',[]) if r.get('module')=='ledger']
    need(len(ledger)==1 and ledger[0].get('path')=='内帐/ledger.db' and ledger[0].get('integrity')=='ok' and ledger[0].get('readOnly') is True and ledger[0].get('walConsistent') is True and ledger[0].get('busy') is False,'PINNED_LEDGER_SNAPSHOT_REQUIRED')
    relative=ledger[0]['path']; entry=[r for r in manifest.get('files',[]) if r.get('path')==relative]
    need(len(entry)==1 and set(entry[0])=={'path','size','sha256'} and type(entry[0]['size']) is int and 0<entry[0]['size']<=1024**3 and re.fullmatch('[a-f0-9]{64}',entry[0]['sha256']),'LEDGER_FILE_PROOF_REQUIRED')
    database=BACKUP_ROOT/'files'/Path(*relative.split('/')); quiet_sidecars(database); reader=load_reader()
    old,new,fmt2=reader.models(); need(reader.getcontext().prec==28,'ORIGINAL_DECIMAL_CONTEXT_REQUIRED')
    with hold_read(database) as held:
        before=proof(database,held,1024**3); need(all(before[k]==entry[0][k] for k in ('size','sha256')),'BACKUP_DATABASE_HASH_MISMATCH')
        rows=snapshot_rows(database,reader); after=proof(database,held,1024**3)
        need(all(after[k]==before[k] for k in ('size','sha256')),'BACKUP_DATABASE_CHANGED'); quiet_sidecars(database)
    need(pinned_bytes(manifest_file,MANIFEST_SHA,16*1024*1024)==raw,'BACKUP_MANIFEST_CHANGED')
    result=reader.calculate(rows,old,new,fmt2); samples=[]; candidates=0
    for row in rows:
        reasons=[]; new_state=new['inventory_state'](row)
        if new['platinum_identity'](row)[0]=='unknown_pt': reasons.append('unknown_pt')
        if new_state=='待确认': reasons.append('state_unknown')
        if new['_grams'](row.get('weight')) is None: reasons.append('invalidWeight')
        if old['inventory_state'](row)!=new_state: reasons.append('oldStateChanges')
        if reasons:
            candidates+=1
            if len(samples)<20: samples.append({'id':row['id'],'reasons':reasons})
    need(len({s['id'] for s in samples})==len(samples),'UNIQUE_SAMPLE_IDS_REQUIRED')
    return {'version':1,'purpose':'fixed-upgrade-backup-platinum-readonly','manifestSha256':MANIFEST_SHA,'immutable':True,'queryOnly':True,'singleReadTransaction':True,'backupHashBefore':before['sha256'],'backupHashAfter':after['sha256'],'rowCount':result['rowCount'],'totalsAreComplete':result['totalsAreComplete'],'old':result['old'],'new':result['new'],'inStockFineDeltaExact':result['inStockFineDeltaExact'],'oldStateChangesCount':result['classificationChanges']['totalChanges'],'sampleCandidateCount':candidates,'samples':samples,'samplesTruncated':candidates>len(samples),'businessRowsOrSchemaModified':False,'physicalStockVerified':False}
def encode_report(report):
    payload=(json.dumps(report,ensure_ascii=False,indent=2,allow_nan=False)+'\n').encode('utf-8')
    need(len(payload)<=STDOUT_LIMIT,'STDOUT_LIMIT_EXCEEDED_NO_PARTIAL_TOTALS'); return payload
def main():
    p=argparse.ArgumentParser(description=__doc__,allow_abbrev=False); p.add_argument('--authorized-upgrade-backup-platinum-readonly',action='store_true'); p.add_argument('--source-sha256',required=True); args=p.parse_args()
    need(os.name=='nt' and os.path.normcase(sys.executable)==os.path.normcase('C:/Python314/python.exe') and sys.flags.isolated and sys.flags.no_site and sys.flags.dont_write_bytecode and not sys.flags.optimize,'FIXED_ISOLATED_PYTHON_REQUIRED')
    need(Path(__file__).absolute()==SELF and args.authorized_upgrade_backup_platinum_readonly,'EXPLICIT_FIXED_BACKUP_READ_AUTHORIZATION_REQUIRED')
    need(re.fullmatch('[a-f0-9]{64}',args.source_sha256),'ROOT_TOOL_SHA_REQUIRED'); pinned_bytes(SELF,args.source_sha256,256*1024)
    payload=encode_report(read_backup()); sys.stdout.write(payload.decode('utf-8')); return 0
if __name__=='__main__':
    try: raise SystemExit(main())
    except Refused as error: print(json.dumps({'ok':False,'code':str(error)}),file=sys.stderr); raise SystemExit(1)
    except Exception as error: print(json.dumps({'ok':False,'code':'BACKUP_READ_FAILED','type':type(error).__name__}),file=sys.stderr); raise SystemExit(1)
