"""Conservative cashier preservation gate for whole-ledger restoration.

Only current/staged SQLite handles are accepted; no paths or bank actions.
The restore owner must freeze business writers for the complete preflight,
staged migration/preservation, replacement and post-restore verification.
These functions never commit, restore a database, or recreate cash/ERP entries.
"""
import contextlib
import hashlib
import json
import os
import re
import sqlite3

from cashier_schema import STATEMENTS, IMMUTABLE
from cashier_engine import CashierError, digest, encoded, fields, require, scope, uid, verify_originals

RECEIPT_KEY = 'restoredUnfinished'
ACCOUNT_PATH = re.compile(r'/cashier/api/accounts(?:/[0-9a-f-]{36}(?:/scopes)?)?\Z')
DOCUMENT_PATH = re.compile(r'/cashier/api/documents(?:/[0-9a-f-]{36}(?:/(?:submit|withdraw|review))?)?\Z')
KINDS = {'opening':'opening','receive':'documents','pay':'documents','refund':'refunds','transfer':'transfers','reversal':'reversals'}
MUTABLE = {'cashier_accounts','cashier_account_scopes','cashier_documents','cashier_events','cashier_requests'}


def fail(message):
    raise CashierError('恢复已停止：'+message+'；请先由财务核对，当前资金与授权未自动改写。',409)


def _rows(c,sql,args=()):
    cursor=c.execute(sql,args)
    columns=[x[0] for x in cursor.description]
    return [dict(row) if isinstance(row,dict) else dict(zip(columns,row)) for row in cursor.fetchall()]


def _normalize(sql):
    return ' '.join(re.sub(r'\bIF\s+NOT\s+EXISTS\s+','',sql,flags=re.I).split()).rstrip(';')


def _schema(c):
    _main_identity(c)
    actual={r['name']:r for r in _rows(c,"SELECT type,name,sql FROM sqlite_master WHERE name LIKE 'cashier_%'")}
    if not actual:return 'absent'
    expected={}
    for sql in STATEMENTS:
        match=re.match(r'CREATE (?:UNIQUE )?(TABLE|INDEX|TRIGGER) IF NOT EXISTS (\w+)',sql)
        if not match:fail('受审出纳v1定义格式异常')
        expected[match[2]]={'type':match[1].lower(),'sql':_normalize(sql)}
    for table in IMMUTABLE:
        for action in ('UPDATE','DELETE'):
            name=table+'_no_'+action.lower()
            sql=f"CREATE TRIGGER IF NOT EXISTS {name} BEFORE {action} ON {table} BEGIN SELECT RAISE(ABORT,'immutable cash evidence'); END"
            expected[name]={'type':'trigger','sql':_normalize(sql)}
    if set(actual)!=set(expected):fail('出纳表、索引或不可变保护不完整，或不是受审v1结构')
    for name,definition in expected.items():
        if actual[name]['type']!=definition['type'] or _normalize(actual[name]['sql'] or '')!=definition['sql']:
            fail('出纳v1结构或不可变保护已变化')
    versions=_rows(c,'SELECT version FROM cashier_metadata')
    if versions!=[{'version':1}]:fail('出纳领域版本未知')
    if c.execute('PRAGMA foreign_key_check').fetchone():fail('账套存在外键断链')
    old_factory=c.row_factory
    try:
        c.row_factory=sqlite3.Row
        verify_originals(c)
    finally:c.row_factory=old_factory
    return 'v1'


def _serial(value):
    if isinstance(value,bytes):return {'blobSha256':hashlib.sha256(value).hexdigest(),'size':len(value)}
    if isinstance(value,dict):return {k:_serial(v) for k,v in value.items()}
    if isinstance(value,list):return [_serial(v) for v in value]
    return value


def _snapshot(c):
    version=_schema(c)
    if version=='absent':return {'schema':'absent','tables':{},'erp':{},'hash':digest({'schema':'absent'})}
    names=sorted(r['name'] for r in _rows(c,"SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'cashier_%'"))
    tables={name:sorted(_rows(c,('SELECT sha256,size,created_at FROM ' if name=='cashier_statement_originals' else 'SELECT * FROM ')+name),key=lambda x:encoded(_serial(x))) for name in names}
    erp=_erp_closure(c,tables)
    value={'schema':'v1','tables':tables,'erp':erp}
    return dict(value,hash=digest(_serial(value)))


def _main_identity(c):
    databases=_rows(c,'PRAGMA database_list')
    if len(databases)!=1 or databases[0]['name']!='main':fail('恢复连接不可带附加或临时账套')
    filename=databases[0]['file']
    return os.path.normcase(os.path.abspath(filename)) if filename else None


def _erp_closure(c,tables):
    doc_ids={r['erp_doc_id'] for r in tables['cashier_erp_links']}
    bill_ids={r['bill_id'] for r in tables['cashier_source_releases']}|{r['bill_id'] for r in tables['cashier_allocations']}
    if not doc_ids and not bill_ids:return {}
    def selected(table,key,values):
        # identifiers here are fixed source literals, never request fields.
        out=[]
        for value in sorted(values):out.extend(_rows(c,'SELECT * FROM '+table+' WHERE '+key+'=?',(value,)))
        unique={encoded(_serial(r)):r for r in out}
        return [unique[k] for k in sorted(unique)]
    try:
        postings=selected('erp_postings','doc_id',doc_ids)
        bill_ids.update(r['bill_id'] for r in postings)
        postings=selected('erp_postings','bill_id',bill_ids)
        doc_ids.update(r['doc_id'] for r in postings)
        doc_ids.update(bill_ids)
        documents=selected('erp_documents','id',doc_ids)
        if len(documents)!=len(doc_ids):fail('出纳关联财务单据缺失')
        bills=selected('erp_bills','id',bill_ids)
        if len(bills)!=len(bill_ids):fail('出纳关联应收应付来源缺失')
        party_ids={r['party_id'] for r in documents}|{r['party_id'] for r in bills}
        return {'documents':documents,'bills':bills,'postings':postings,
                'allocations':selected('erp_allocations','doc_id',doc_ids),
                'reversalsTarget':selected('erp_reversals','target_id',doc_ids),
                'reversalsEntry':selected('erp_reversals','reversal_id',doc_ids),
                'parties':selected('erp_parties','id',party_ids),
                'lines':selected('erp_lines','doc_id',doc_ids),
                'events':selected('erp_events','doc_id',doc_ids)}
    except sqlite3.DatabaseError as exc:
        raise CashierError('恢复已停止：出纳关联财务结构不可读取，请先财务核对。',409) from exc


@contextlib.contextmanager
def _read_snapshots(*connections):
    owned=[]
    try:
        for c in connections:
            if not c.in_transaction:c.execute('BEGIN');owned.append(c)
        yield
    finally:
        for c in reversed(owned):c.rollback()


def _index(rows,keys):
    result={tuple(r[k] for k in keys):r for r in rows}
    if len(result)!=len(rows):fail('出纳记录身份重复')
    return result


def _account_request(row):
    return bool(ACCOUNT_PATH.fullmatch(row['path'])) and row['method'] in ('POST','PATCH')


def _receipt(request,lost_documents):
    try:response=json.loads(request['response_json'])
    except (ValueError,TypeError):fail('出纳请求回执损坏')
    if RECEIPT_KEY in response:
        _validate_receipt(response)
        return request
    document=response.get('document')
    if (not DOCUMENT_PATH.fullmatch(request['path']) or request['method'] not in ('POST','PATCH') or
            not isinstance(document,dict) or document.get('id') not in lost_documents):
        fail('归档缺少已保存出纳请求事实，且它不是遗失的未完成草稿')
    original=lost_documents[document['id']]
    p=json.loads(original['payload'])
    kind=original['kind']
    if kind not in KINDS:fail('未完成草稿类型未知')
    stage='review' if request['path'].endswith('/review') else 'prepare'
    marker={RECEIPT_KEY:{'version':1,'originalDocumentId':original['id'],'originalNumber':original['number'],
            'capability':'cashier.'+KINDS[kind]+'.'+stage,
            'accountIds':[p['accountId']]+([p['toAccountId']] if p.get('toAccountId') else []),
            'reason':'unfinished_document_not_restored'}}
    _validate_receipt(marker)
    return dict(request,response_json=encoded(marker))


def _validate_receipt(response):
    fields(response,(RECEIPT_KEY,),(RECEIPT_KEY,))
    r=fields(response[RECEIPT_KEY],('version','originalDocumentId','originalNumber','capability','accountIds','reason'),
             ('version','originalDocumentId','originalNumber','capability','accountIds','reason'))
    if r['version']!=1 or r['reason']!='unfinished_document_not_restored' or r['capability'] not in {'cashier.'+v+'.'+s for v in KINDS.values() for s in ('prepare','review')}:
        fail('恢复终态回执格式未知')
    uid(r['originalDocumentId'])
    if not isinstance(r['originalNumber'],str) or not re.fullmatch(r'CN[A-Z]+-\d{8}-\d{6}',r['originalNumber']):fail('恢复回执凭证编号无效')
    if not isinstance(r['accountIds'],list) or not 1<=len(r['accountIds'])<=2:fail('恢复回执账户引用无效')
    for account in r['accountIds']:uid(account)
    return r


def preflight(current,staged):
    """Return a reviewable preservation plan; read-only, no commit or restore.

    Root must keep its restore/business-writer freeze until verify_restored.
    Hashes are checked again in preserve_current_authority before any write.
    """
    if current is staged:fail('当前与暂存账套必须是两个独立连接')
    current_identity=_main_identity(current);staged_identity=_main_identity(staged)
    if current_identity and current_identity==staged_identity:fail('当前与暂存连接不能指向同一账套文件')
    with _read_snapshots(current,staged):
        now=_snapshot(current);old=_snapshot(staged)
    return _make_plan(now,old)


def _legacy_empty(snapshot):
    tables=snapshot['tables']
    return (not any(rows for name,rows in tables.items() if name not in ('cashier_metadata','cashier_accounts','cashier_account_scopes','cashier_events')) and
            all(row['action'].startswith('account.') for row in tables['cashier_events']))


def _make_plan(now,old):
    base={'version':1,'currentHash':now['hash'],'stagedHash':old['hash'],'currentSchema':now['schema'],
          'stagedSchema':old['schema'],'needsInitialization':False,'requiredDispatchGuard':False,
          'scopeRows':[],'accountUpdates':[],'requestRows':[],'eventRows':[],'lostUnfinishedDocumentIds':[]}
    if now['schema']=='absent' and old['schema']=='absent':return dict(base,mode='legacy-noop')
    if now['schema']=='absent':
        # A pre-cashier installation must not activate a populated cashier archive.
        if not _legacy_empty(old):
            fail('当前尚无出纳领域，但归档含出纳业务或请求事实')
        return dict(base,mode='preserve-authority',accountUpdates=[dict(r,active=0,revision=r['revision']+1) for r in old['tables']['cashier_accounts']],
                    scopeRows=[dict(r,level='disabled',revision=r['revision']+1) for r in old['tables']['cashier_account_scopes']])
    if old['schema']=='absent':
        if not _legacy_empty(now):
            fail('旧版备份不含当前已保存的出纳业务或请求事实')
        return dict(base,mode='initialize-empty',needsInitialization=True)
    nt,ot=now['tables'],old['tables']
    for table in set(nt)-MUTABLE:
        if nt[table]!=ot[table]:fail('归档会丢失或引入出纳已确认资金、财务来源、账单或核对事实：'+table)
    if now['erp']!=old['erp']:fail('归档中的出纳关联ERP核销、来源或审核证据不一致')
    nd=_index(nt['cashier_documents'],('id',));od=_index(ot['cashier_documents'],('id',))
    lost={}
    for key,row in nd.items():
        if key in od:
            if row!=od[key]:fail('归档中的资金凭证内容、状态或版本冲突')
        else:
            if row['status'] not in ('draft','pending','rejected') or any(p['doc_id']==row['id'] for p in nt['cashier_postings']):fail('归档缺少已确认资金凭证')
            lost[row['id']]=row
    if set(od)-set(nd):fail('归档会重新引入当前不存在的资金凭证')
    na=_index(nt['cashier_accounts'],('id',));oa=_index(ot['cashier_accounts'],('id',));account_updates=[]
    for key,row in oa.items():
        if key in na:
            actual=na[key]
            if any(actual[k]!=row[k] for k in ('id','code','kind','currency','created_at')):fail('相同账户身份对应的代码、类型、币种或创建事实冲突')
            account_updates.append(actual)
        else:account_updates.append(dict(row,active=0,revision=row['revision']+1))
    ns=_index(nt['cashier_account_scopes'],('staff_id','account_id'));os=_index(ot['cashier_account_scopes'],('staff_id','account_id'));scopes=[]
    for key in sorted(set(ns)|set(os)):
        if (key[1],) not in oa:continue  # Never recreate a missing account to satisfy a grant FK.
        if key in ns:scopes.append(ns[key])
        else:scopes.append(dict(os[key],level='disabled',revision=os[key]['revision']+1))
    nr=_index(nt['cashier_requests'],('actor_id','request_id'));orr=_index(ot['cashier_requests'],('actor_id','request_id'));requests=[]
    receipt_ids=set()
    unfinished_request_ids=set()
    for row in nr.values():
        response=json.loads(row['response_json'])
        if RECEIPT_KEY in response:receipt_ids.add(_validate_receipt(response)['originalDocumentId'])
        if row['path']=='/cashier/api/documents' and row['method']=='POST' and isinstance(response.get('document'),dict):
            unfinished_request_ids.add(response['document'].get('id'))
    if set(lost)-unfinished_request_ids:fail('遗失草稿没有对应已保存的制单请求，不能安全确定恢复终态')
    for key,row in nr.items():
        if key in orr:
            if row!=orr[key]:fail('同一出纳请求编号在当前账套与归档中的事实冲突')
        elif _account_request(row):
            response=json.loads(row['response_json']);account=response.get('account',{}).get('id') or response.get('scope',{}).get('account_id')
            if (account,) not in oa:fail('遗失账户管理请求引用了归档不存在的账户，不自动重建账户')
            requests.append(row)
        else:requests.append(_receipt(row,lost))
    for key in set(orr)-set(nr):
        if not _account_request(orr[key]):fail('归档含当前无法核实的已保存出纳请求')
        response=json.loads(orr[key]['response_json']);account=response.get('account',{}).get('id') or response.get('scope',{}).get('account_id')
        if (account,) not in oa or (account,) in na:fail('归档独有请求不是归档独有账户的管理记录')
    ne=_index(nt['cashier_events'],('id',));oe=_index(ot['cashier_events'],('id',));events=[]
    def preservable_event(row,archive=False):
        if row['action'].startswith('account.'):
            return (row['entity_id'],) in oa and (row['entity_id'],) not in na if archive else (row['entity_id'],) in na
        return not archive and row['entity_id'] in (set(lost)|receipt_ids) and row['action'].startswith('document.')
    for key,row in ne.items():
        if key in oe:
            if row!=oe[key]:fail('不可变出纳审计事件编号冲突')
        elif preservable_event(row):events.append(row)
        else:fail('归档缺少无法安全保留的出纳审计事实')
    for key in set(oe)-set(ne):
        if not preservable_event(oe[key],True):fail('归档含当前无法核实的出纳审计事实')
    return dict(base,mode='preserve-authority',scopeRows=scopes,accountUpdates=account_updates,requestRows=requests,eventRows=events,
                lostUnfinishedDocumentIds=sorted(lost),requiredDispatchGuard=bool(lost) or any(RECEIPT_KEY in json.loads(r['response_json']) for r in nr.values()))


def preserve_current_authority(current,staged,plan):
    """Apply only account metadata/scopes and immutable receipts/audit to staged.

    Caller owns staged BEGIN IMMEDIATE, rollback and commit. Existing cash,
    ERP, bank records, and documents are never inserted, updated or deleted.
    Returns a verification receipt for verify_restored after final replacement.
    """
    if not staged.in_transaction:fail('暂存账套必须由恢复流程先开启写事务')
    with _read_snapshots(current):now=_snapshot(current)
    old=_snapshot(staged)
    if now['hash']!=plan['currentHash']:fail('预检后当前出纳事实或授权发生变化，请重新预检')
    if plan['needsInitialization']:
        if old['schema']!='v1' or any(old['tables'][name] for name in old['tables'] if name!='cashier_metadata'):
            fail('旧版兼容迁移应只初始化空出纳v1结构')
    elif old['hash']!=plan['stagedHash']:fail('预检后暂存账套发生变化，请重新预检')
    # Recompute the plan from the pinned snapshots. Do not trust edited plan grants.
    original_staged={'schema':'absent','tables':{},'erp':{},'hash':digest({'schema':'absent'})} if plan['needsInitialization'] else old
    if _make_plan(now,original_staged)!=plan:fail('恢复保留计划内容不一致')
    if plan['mode']=='legacy-noop':return {'version':1,'expectedHash':old['hash'],'requiredDispatchGuard':False}
    for row in plan['accountUpdates']:
        staged.execute('UPDATE cashier_accounts SET name=?,masked_reference=?,note=?,active=?,revision=?,updated_at=? WHERE id=?',
                       tuple(row[k] for k in ('name','masked_reference','note','active','revision','updated_at','id')))
    # Replace only grants for accounts that actually exist in staged.
    staged.execute('DELETE FROM cashier_account_scopes')
    for row in plan['scopeRows']:
        staged.execute('INSERT INTO cashier_account_scopes(staff_id,account_id,level,revision) VALUES(?,?,?,?)',tuple(row[k] for k in ('staff_id','account_id','level','revision')))
    for table,rows in [('cashier_requests',plan['requestRows']),('cashier_events',plan['eventRows'])]:
        for row in rows:
            columns=list(row)
            staged.execute('INSERT INTO '+table+'('+','.join(columns)+') VALUES('+','.join('?' for _ in columns)+')',tuple(row[k] for k in columns))
    final=_snapshot(staged)
    return {'version':1,'expectedHash':final['hash'],'requiredDispatchGuard':plan['requiredDispatchGuard'],
            'lostUnfinishedDocumentIds':plan['lostUnfinishedDocumentIds']}


def verify_restored(restored,verification_receipt):
    """Run before reopening business access; includes original BLOB verification."""
    with _read_snapshots(restored):snapshot=_snapshot(restored)
    if verification_receipt.get('version')!=1 or snapshot['hash']!=verification_receipt.get('expectedHash'):
        fail('恢复后的出纳资金、原件、授权或请求事实与保留结果不一致')
    return {'verified':True,'requiredDispatchGuard':verification_receipt['requiredDispatchGuard']}


def reject_restored_request(connection,actor,method,path,body):
    """Authenticated, pre-domain replay hook; None for an ordinary request.

    Do not call before MAC/session validation. A matching unfinished terminal
    receipt raises 409 with .code, permitting a deliberate new request after
    review; a changed body under the old request ID also raises 409.
    """
    if method not in ('POST','PATCH') or not isinstance(body,dict) or not isinstance(body.get('requestId'),str):return None
    if not isinstance(actor,dict) or not isinstance(actor.get('staffId'),str):return None
    if not connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cashier_requests'").fetchone():return None
    rows=_rows(connection,'SELECT * FROM cashier_requests WHERE actor_id=? AND request_id=?',(actor['staffId'],body['requestId']))
    if not rows:return None
    row=rows[0];response=json.loads(row['response_json'])
    if RECEIPT_KEY not in response:return None
    marker=_validate_receipt(response)
    require(actor,marker['capability']);require(actor,'cashier.amounts.sensitive')
    for account in marker['accountIds']:
        if connection.execute('SELECT 1 FROM cashier_accounts WHERE id=?',(account,)).fetchone():
            scope(connection,actor,account,'manage' if marker['capability'].endswith('.review') else 'operate')
    if row['method']!=method or row['path']!=path or row['request_hash']!=digest({'method':method,'path':path,'body':body}):
        raise CashierError('该请求编号已有恢复终态记录，不能用于不同内容。',409)
    error=CashierError('该未完成凭证没有随归档恢复，原请求已封存且不会记账。请核对后使用新编号重新制单。',409)
    error.code='CASHIER_RESTORED_UNFINISHED'
    error.original_document_id=marker['originalDocumentId']
    error.original_number=marker['originalNumber']
    raise error
