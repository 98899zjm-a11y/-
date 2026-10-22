"""Independent cashier authority, atomic cash/ERP entries in one ledger.

Public constructors are trusted bootstrap dependencies, never HTTP parameters.
ERP settlement mathematics stays in erp_settlement.accept_settlement.
"""
import base64
import binascii
import csv
import datetime as dt
import hashlib
import io
import json
import re
import sqlite3
import uuid
from urllib.parse import parse_qsl

MAX_CENTS = 9_000_000_000_000
CAPABILITIES = (
    'cashier.read','cashier.amounts.sensitive','cashier.sources.read','cashier.accounts.manage',
    'cashier.documents.prepare','cashier.documents.review','cashier.refunds.prepare','cashier.refunds.review',
    'cashier.transfers.prepare','cashier.transfers.review','cashier.opening.prepare','cashier.opening.review',
    'cashier.reversals.prepare','cashier.reversals.review','cashier.reconcile.import','cashier.reconcile.match',
    'cashier.reconcile.review','cashier.reports.view','cashier.reports.export')
MANAGE = {x for x in CAPABILITIES if x.endswith('.review')} | {'cashier.accounts.manage','cashier.opening.prepare'}
WRITE = MANAGE | {x for x in CAPABILITIES if x.endswith('.prepare')} | {'cashier.reconcile.import','cashier.reconcile.match'}
KINDS = {'opening':'opening','receive':'documents','pay':'documents','refund':'refunds','transfer':'transfers','reversal':'reversals'}


class CashierError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def digest(value):
    return hashlib.sha256(encoded(value).encode('utf-8')).hexdigest()


def uid(value):
    if not isinstance(value,str):
        raise CashierError('标识格式无效。')
    try:
        valid = str(uuid.UUID(value)) == value
    except (ValueError, AttributeError):
        valid = False
    if not valid:
        raise CashierError('标识格式无效。')
    return value


def party_id(value):
    """Accept the ERP's canonical party identities, never arbitrary text/paths.

    Supplier identities preserve their legacy integer source; customers use a
    namespaced UUID. Bare UUIDs remain valid for existing cashier fixtures and
    previously published sources. Database source comparison still authorizes
    the specific party, direction and outstanding obligation in the transaction.
    """
    if isinstance(value, str) and re.fullmatch(r'SUP:[1-9][0-9]{0,18}', value):
        if int(value[4:]) <= 9223372036854775807:
            return value
    if isinstance(value, str) and value.startswith('CUS:'):
        uid(value[4:])
        return value
    return uid(value)


def text(value, maximum=500, required=False):
    if not isinstance(value,str) or len(value) > maximum or re.search(r'[\x00-\x1f]',value) or required and not value.strip():
        raise CashierError('文字字段为空、过长或含控制字符。')
    return value.strip()


def day(value):
    if not isinstance(value,str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',value):
        raise CashierError('日期须为年月日。')
    try:
        dt.date.fromisoformat(value)
    except ValueError:
        raise CashierError('日期无效。') from None
    return value


def cents(value, zero=False):
    if type(value) is int:
        result = value
    elif isinstance(value,str) and re.fullmatch(r'(?:0|[1-9]\d{0,12})',value):
        result = int(value)
    else:
        raise CashierError('金额须为整数分。')
    if not (0 if zero else 1) <= result <= MAX_CENTS:
        raise CashierError('金额超出允许范围。')
    return result


def revision(value):
    if type(value) is not int or value < 1:
        raise CashierError('版本无效。')
    return value


def fields(body, allowed, required=()):
    if not isinstance(body,dict) or set(body)-set(allowed) or set(required)-set(body):
        raise CashierError('字段缺失或包含不允许的字段。')
    return body


def one(c, sql, args=()):
    row = c.execute(sql,args).fetchone()
    return dict(row) if row else None


def require(actor, capability):
    if (not isinstance(actor,dict) or actor.get('protocolVersion') != 3 or
            actor.get('module') != 'cashier' or actor.get('authorityModule') != 'cashier' or
            actor.get('storageModule') != 'ledger' or actor.get('access') not in ('view','operate','manage') or
            'accountIds' in actor or 'scopeRevision' in actor):
        raise CashierError('出纳独立身份无效。',403)
    caps = actor.get('capabilities')
    if not isinstance(caps,list) or any(not isinstance(x,str) for x in caps) or len(set(caps)) != len(caps) or set(caps)-set(CAPABILITIES) or 'cashier.read' not in caps or capability not in caps:
        raise CashierError('没有此出纳操作权限。',403)
    if actor['access'] == 'view' and set(caps) & WRITE or actor['access'] == 'operate' and set(caps) & MANAGE:
        raise CashierError('出纳能力与访问级别不符。',403)
    uid(actor.get('staffId'))
    text(actor.get('name'),100,True)
    if capability in MANAGE and actor['access'] != 'manage' or capability in WRITE and actor['access'] not in ('operate','manage'):
        raise CashierError('没有此出纳操作级别。',403)


def finance_authority(actor):
    if (not isinstance(actor,dict) or actor.get('module') != 'ledger' or actor.get('protocolVersion') != 2 or
            actor.get('access') != 'manage' or not isinstance(actor.get('capabilities'),list) or
            not {'erp.read','erp.cashier.release'}.issubset(actor['capabilities'])):
        raise CashierError('只有获授权财务人员可以发布或撤回来源。',403)
    uid(actor.get('staffId'))
    text(actor.get('name'),100,True)


def scope(c, actor, account_id, level='view', active=False):
    account = one(c,'SELECT * FROM cashier_accounts WHERE id=?',(uid(account_id),))
    if not account:
        raise CashierError('账户不存在。',404)
    grant = one(c,'SELECT level FROM cashier_account_scopes WHERE staff_id=? AND account_id=?',(actor['staffId'],account_id))
    # Administration is explicit account management, not implicit cash access.
    ranks = {'disabled':0,'view':1,'operate':2,'manage':3}
    if not grant or ranks[grant['level']] < ranks[level]:
        raise CashierError('没有该账户的操作范围。',403)
    if active and not account['active']:
        raise CashierError('账户已停用。',409)
    return account


def assert_erp_reversal_allowed(connection, target_erp_document_id):
    if connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cashier_erp_links'").fetchone() and connection.execute('SELECT 1 FROM cashier_erp_links WHERE erp_doc_id=?',(target_erp_document_id,)).fetchone():
        raise CashierError('该核销关联出纳资金，请从出纳冲销以同时保留资金与业务核销。',409)


def validate_cashier_erp_reversal(c, actual_actor, erp_row, payload):
    """Read-only gate for the Root-owned, same-transaction ERP reversal bridge.

    The engine has already obtained BEGIN IMMEDIATE and inserted the correlated
    ERP reversal row/link. This function cannot create an actor or post money.
    """
    require(actual_actor,'cashier.reversals.review')
    require(actual_actor,'cashier.amounts.sensitive')
    if not c.in_transaction or c.execute('PRAGMA query_only').fetchone()[0]:
        raise CashierError('资金冲销必须处于同一可写账套事务。',409)
    fields(payload,('kind','targetId','note','cashierDocumentId'),('kind','targetId','note','cashierDocumentId'))
    if payload['kind']!='reversal':raise CashierError('出纳冲销桥只接受冲销。',403)
    cash=one(c,'SELECT * FROM cashier_documents WHERE id=?',(uid(payload['cashierDocumentId']),))
    if not cash or cash['kind']!='reversal' or cash['status']!='pending':raise CashierError('出纳冲销单不处于待审核状态。',409)
    if cash['author_id']==actual_actor['staffId']:raise CashierError('出纳冲销必须异人审核。',403)
    cp=json.loads(cash['payload'])
    if cash['frozen_hash']!=digest({'id':cash['id'],'revision':cash['revision'],'payload':cp}):raise CashierError('出纳审核冻结快照不一致。',409)
    if cp.get('kind')!='reversal' or cp.get('accountId')!=cash['account_id'] or cp.get('amountCents')!=cash['amount_cents'] or cp.get('businessDate')!=cash['business_date'] or payload['note']!=cp.get('note'):
        raise CashierError('出纳冲销正文与已保存凭证不一致。',409)
    target=one(c,'SELECT * FROM cashier_documents WHERE id=?',(uid(cp.get('targetId')),))
    if not target or target['kind'] not in ('receive','pay') or target['status']!='confirmed' or target['account_id']!=cash['account_id'] or target['amount_cents']!=cash['amount_cents'] or cash['business_date']<target['business_date']:
        raise CashierError('出纳冲销原收付款与金额、日期不一致。',409)
    scope(c,actual_actor,cash['account_id'],'manage',True)
    if c.execute('SELECT 1 FROM cashier_reversals WHERE target_doc_id=?',(target['id'],)).fetchone() or c.execute('SELECT 1 FROM cashier_refund_links WHERE original_cash_doc_id=?',(target['id'],)).fetchone():raise CashierError('原收付款已冲销或已有退款。',409)
    if c.execute('''SELECT 1 FROM cashier_postings p JOIN cashier_reconciliation_locks l ON l.posting_id=p.id WHERE p.doc_id=?''',(target['id'],)).fetchone():raise CashierError('原收付款已对账锁定。',409)
    original_postings=[dict(x) for x in c.execute('SELECT account_id,date,signed_amount_cents FROM cashier_postings WHERE doc_id=?',(target['id'],))]
    cash_postings=[dict(x) for x in c.execute('SELECT account_id,date,signed_amount_cents FROM cashier_postings WHERE doc_id=?',(cash['id'],))]
    expected_sign=target['amount_cents'] if target['kind']=='receive' else -target['amount_cents']
    if original_postings!=[{'account_id':target['account_id'],'date':target['business_date'],'signed_amount_cents':expected_sign}] or cash_postings!=[{'account_id':cash['account_id'],'date':cash['business_date'],'signed_amount_cents':-expected_sign}]:
        raise CashierError('同事务内缺少完整资金补偿流水，拒绝单边财务冲销。',409)
    link=one(c,'SELECT * FROM cashier_erp_links WHERE cash_doc_id=?',(cash['id'],))
    original_link=one(c,'SELECT * FROM cashier_erp_links WHERE cash_doc_id=?',(target['id'],))
    actual=one(c,'SELECT * FROM erp_documents WHERE id=?',(uid(erp_row.get('id')),))
    source=one(c,'SELECT * FROM erp_documents WHERE id=?',(uid(payload['targetId']),))
    if (not link or not original_link or link['erp_doc_id']!=erp_row['id'] or original_link['erp_doc_id']!=payload['targetId'] or
            not actual or dict(erp_row)!=actual or actual['kind']!='reversal' or actual['status']!='confirmed' or
            actual['author_id']!=cash['author_id'] or actual['reviewer_id']!=actual_actor['staffId'] or
            actual['request_id']!='cashier:'+cash['id'] or
            actual['date']!=cash['business_date'] or actual['amount_cents']!=cash['amount_cents'] or
            json.loads(actual['payload'])!=payload or not source or source['kind']!='settlement' or source['status']!='confirmed' or
            source['party_id']!=actual['party_id'] or c.execute('SELECT 1 FROM erp_reversals WHERE target_id=?',(source['id'],)).fetchone()):
        raise CashierError('出纳与财务冲销关联不一致。',409)
    return None


def verify_originals(connection):
    """Read-only backup/restore integrity hook; raises before using bad evidence."""
    count = 0
    for row in connection.execute('SELECT sha256,size,content FROM cashier_statement_originals'):
        content = bytes(row['content'])
        if not 0 < len(content) <= 10*1024*1024 or len(content) != row['size'] or hashlib.sha256(content).hexdigest() != row['sha256']:
            raise CashierError('银行账单原件完整性校验失败。',409)
        count += 1
    broken = connection.execute('''SELECT 1 FROM cashier_statement_imports i
      LEFT JOIN cashier_statement_originals o ON o.sha256=i.original_sha256
      WHERE o.sha256 IS NULL OR i.row_count!=(SELECT COUNT(*) FROM cashier_statement_rows r WHERE r.import_id=i.id) LIMIT 1''').fetchone()
    if broken:
        raise CashierError('银行账单引用或行数校验失败。',409)
    return {'originalCount':count}


def create_engine(*, connect, reserve_number, clock, settlement_bridge=None, reversal_bridge=None):
    return CashierEngine(connect, reserve_number, clock, settlement_bridge, reversal_bridge)


class CashierEngine:
    def __init__(self, connect, reserve_number, clock, settlement_bridge=None, reversal_bridge=None):
        self.connect = connect
        self.reserve_number = reserve_number
        self.clock = clock
        self.settlement_bridge = settlement_bridge
        self.reversal_bridge = reversal_bridge

    def event(self,c,a,entity,action,before=None,after=None):
        c.execute('INSERT INTO cashier_events(entity_id,action,actor_id,actor_name,before_json,after_json,at) VALUES(?,?,?,?,?,?,?)',
                  (entity,action,a['staffId'],a['name'],None if before is None else encoded(before),None if after is None else encoded(after),self.clock()))

    def dispatch(self, *, actor, method, path, body):
        if method not in ('GET','POST','PATCH') or not isinstance(path,str) or not path.startswith('/') or any(x in path for x in ('%','\\','#','//','..')) or re.search(r'[\x00-\x20]',path):
            raise CashierError('出纳路径或方法无效。')
        route, sep, query = path.partition('?')
        try:pairs = parse_qsl(query,keep_blank_values=True,strict_parsing=True) if sep else []
        except ValueError:raise CashierError('查询格式无效。') from None
        if len({x[0] for x in pairs}) != len(pairs) or any(k not in ('limit','after','accountId','from','to','asOf','status','kind','date') for k,v in pairs):
            raise CashierError('查询字段重复或不允许。')
        q = dict(pairs)
        if method != 'GET' and q or not isinstance(body,dict) or method == 'GET' and body:
            raise CashierError('请求参数无效。')
        if route.startswith('/erp/api/cashier-source-releases'):
            finance_authority(actor)
        else:
            require(actor,'cashier.read')
        mutating = method != 'GET' and route != '/cashier/api/statement-imports/preview'
        request_hash = digest({'method':method,'path':path,'body':body})
        if method != 'GET':
            uid(body.get('requestId'))
        c = self.connect()
        try:
            c.row_factory = sqlite3.Row
            c.execute('PRAGMA foreign_keys=ON')
            if not mutating:c.execute('PRAGMA query_only=ON')
            c.execute('BEGIN IMMEDIATE' if mutating else 'BEGIN')
            if mutating:
                prior = one(c,'SELECT * FROM cashier_requests WHERE actor_id=? AND request_id=?',(actor['staffId'],body['requestId']))
                if prior:
                    if prior['request_hash'] != request_hash:
                        raise CashierError('同一请求编号的内容不同。',409)
                    # Recheck live account authority even for a cached response.
                    cached = json.loads(prior['response_json'])
                    self.authorize_cached(c,actor,route,cached)
                    c.commit()
                    return cached
            result = self.route(c,actor,method,route,body,q)
            if mutating:
                c.execute('INSERT INTO cashier_requests VALUES(?,?,?,?,?,?)',(actor['staffId'],body['requestId'],request_hash,encoded(result),method,path))
            c.commit()
            return result
        except sqlite3.OperationalError as exc:
            c.rollback()
            if 'locked' in str(exc).lower() or 'busy' in str(exc).lower():
                raise CashierError('账套正在处理另一笔操作，请用原请求编号重试。',503) from exc
            raise
        except sqlite3.IntegrityError as exc:
            c.rollback()
            raise CashierError('账套完整性约束拒绝此操作，整笔未记账。',409) from exc
        except Exception:
            c.rollback()
            raise
        finally:
            c.close()

    def authorize_cached(self,c,a,path,result):
        if path.startswith('/erp/'):
            finance_authority(a)
            return
        entity = result.get('document')
        if entity:
            require(a,'cashier.amounts.sensitive')
            stage = 'review' if path.endswith('/review') else 'prepare'
            require(a,'cashier.'+KINDS[entity['kind']]+'.'+stage)
            payload = entity['payload']
            self.document_scopes(c,a,payload,'manage' if stage=='review' else 'operate',False)
        elif '/accounts' in path:
            require(a,'cashier.accounts.manage')
            if a.get('role') != 'admin':
                raise CashierError('仅管理员可管理账户范围。',403)
        else:
            cap = 'cashier.reconcile.review' if path.endswith(('/review','/revoke')) else 'cashier.reconcile.match' if '/reconciliations' in path else 'cashier.reconcile.import'
            require(a,cap)
            require(a,'cashier.amounts.sensitive')
            entity = result.get('import') or result.get('reconciliation')
            if entity:
                scope(c,a,entity['accountId'],'manage' if cap.endswith('review') else 'operate')

    def route(self,c,a,method,path,b,q):
        if method=='GET':
            path={'/cashier/api/flows':'/cashier/api/postings','/cashier/api/export.csv':'/cashier/api/reports/export'}.get(path,path)
            if path=='/cashier/api/reports/daily':
                if set(q)-{'accountId','date','limit','after'}:raise CashierError('日报查询字段无效。')
                q=dict(q);date=day(q.pop('date',None));q.update({'from':date,'to':date})
                path='/cashier/api/reports/balances'
        query_allowed = {
            '/cashier/api/sources': {'accountId'},
            '/cashier/api/documents': {'limit','after','accountId','status','kind'},
            '/cashier/api/postings': {'limit','after','accountId','from','to','asOf'},
            '/cashier/api/reports/balances': {'limit','after','accountId','from','to','asOf'},
            '/cashier/api/reports/export': {'accountId','from','to','asOf'},
            '/cashier/api/statement-imports': {'accountId','limit','after'},
            '/cashier/api/reconciliations': {'accountId'},
        }
        if set(q)-query_allowed.get(path,set()):raise CashierError('此入口不接受这些查询字段。')
        request_match=re.fullmatch(r'/cashier/api/requests/([0-9a-f-]{36})',path)
        if request_match and method=='GET':
            saved=one(c,'SELECT * FROM cashier_requests WHERE actor_id=? AND request_id=?',(a['staffId'],uid(request_match.group(1))))
            if not saved:raise CashierError('此请求尚无已提交结果，请保留原编号和原内容重试。',404)
            result=json.loads(saved['response_json']);self.authorize_cached(c,a,saved['path'],result)
            return {'requestId':request_match.group(1),'result':result}
        source_match = re.fullmatch(r'/erp/api/cashier-source-releases(?:/([0-9a-f-]{36})/(revoke))?',path)
        if source_match and method == 'POST':
            return self.release(c,a,source_match.group(1),b)
        if path in ('/cashier/api/bootstrap','/cashier/api/accounts') and method=='GET':
            return self.accounts(c,a)
        if path=='/cashier/api/accounts' and method=='POST':
            return self.account_create(c,a,b)
        match = re.fullmatch(r'/cashier/api/accounts/([0-9a-f-]{36})(?:/(scopes))?',path)
        if match and method in ('PATCH','POST'):
            return self.account_update(c,a,match.group(1),match.group(2),b)
        if path=='/cashier/api/documents' and method=='POST':
            return self.document_create(c,a,b)
        match = re.fullmatch(r'/cashier/api/documents/([0-9a-f-]{36})(?:/(submit|withdraw|review))?',path)
        if match:
            if method=='GET' and not match.group(2):
                row = self.document(c,match.group(1)); self.document_scopes(c,a,json.loads(row['payload']))
                require(a,'cashier.amounts.sensitive')
                return {'document':self.public_document(c,row),'events':[dict(x) for x in c.execute('SELECT * FROM cashier_events WHERE entity_id=? ORDER BY id',(row['id'],))]}
            if method=='POST' and match.group(2):
                return self.document_action(c,a,match.group(1),match.group(2),b)
            if method=='PATCH' and not match.group(2):
                return self.document_edit(c,a,match.group(1),b)
        if path=='/cashier/api/documents' and method=='GET':
            return self.documents(c,a,q)
        if path=='/cashier/api/sources' and method=='GET':
            require(a,'cashier.sources.read'); require(a,'cashier.amounts.sensitive')
            scope(c,a,uid(q.get('accountId')))
            return {'sources':[dict(x) for x in c.execute('''SELECT r.*,b.party_name,b.date,b.due_date,
              (SELECT COALESCE(SUM(face_cents-settled_cents),0) FROM erp_postings p WHERE p.bill_id=r.bill_id) outstanding_cents
              FROM cashier_source_releases r JOIN erp_bills b ON b.id=r.bill_id WHERE r.status='published' ORDER BY r.created_at,r.id LIMIT 200''')]}
        if path in ('/cashier/api/postings','/cashier/api/reports/balances','/cashier/api/reports/export') and method=='GET':
            return self.report(c,a,path,q)
        if path in ('/cashier/api/statement-imports/preview','/cashier/api/statement-imports') and method=='POST':
            return self.statement_import(c,a,b,path.endswith('/preview'))
        if path=='/cashier/api/statement-imports' and method=='GET':
            return self.statement_list(c,a,q)
        match = re.fullmatch(r'/cashier/api/statement-imports/([0-9a-f-]{36})(?:/(original))?',path)
        if match and method=='GET':
            return self.statement_get(c,a,match.group(1),bool(match.group(2)))
        if path=='/cashier/api/reconciliations' and method=='POST':
            return self.reconcile_create(c,a,b)
        if path=='/cashier/api/reconciliations' and method=='GET':
            require(a,'cashier.reports.view'); require(a,'cashier.amounts.sensitive')
            account = uid(q.get('accountId')); scope(c,a,account)
            return {'reconciliations':[self.public_reconciliation(dict(x)) for x in c.execute('SELECT * FROM cashier_reconciliations WHERE account_id=? ORDER BY rowid DESC LIMIT 200',(account,))]}
        match = re.fullmatch(r'/cashier/api/reconciliations/([0-9a-f-]{36})/(review|revoke)',path)
        if match and method=='POST':
            return self.reconcile_action(c,a,match.group(1),match.group(2),b)
        raise CashierError('未开放的出纳操作。',404)

    def accounts(self,c,a):
        manager=a.get('role')=='admin' and 'cashier.accounts.manage' in a['capabilities']
        rows = c.execute('''SELECT a.*,COALESCE(s.level,'disabled') level FROM cashier_accounts a
          LEFT JOIN cashier_account_scopes s ON s.account_id=a.id AND s.staff_id=?
          WHERE ? OR COALESCE(s.level,'disabled')!='disabled' ORDER BY a.code''',(a['staffId'],int(manager))).fetchall()
        result=[]
        for raw in rows:
            x=dict(raw)
            if 'cashier.amounts.sensitive' in a['capabilities'] and x['level']!='disabled':
                x['balanceCents']=c.execute('SELECT COALESCE(SUM(signed_amount_cents),0) FROM cashier_postings WHERE account_id=?',(x['id'],)).fetchone()[0]
            result.append(x)
        return {'accounts':result,'capabilities':a['capabilities'],'currency':'CNY','actor':{'staffId':a['staffId'],'name':a['name'],'role':a.get('role')}}

    def account_create(self,c,a,b):
        require(a,'cashier.accounts.manage')
        if a.get('role')!='admin':
            raise CashierError('仅管理员可以建立账户。',403)
        fields(b,('requestId','code','name','kind','currency','maskedReference','note'),('requestId','code','name','kind','currency'))
        if b['kind'] not in ('cash','bank') or b['currency']!='CNY':
            raise CashierError('账户仅支持人民币现金或银行账户。')
        identifier=str(uuid.uuid4()); now=self.clock()
        code=text(b['code'],80,True)
        if c.execute('SELECT 1 FROM cashier_accounts WHERE code=?',(code,)).fetchone():
            raise CashierError('账户代码已存在。',409)
        c.execute('INSERT INTO cashier_accounts VALUES(?,?,?,?,?,?,?,1,1,?,?)',(identifier,code,text(b['name'],100,True),b['kind'],'CNY',text(b.get('maskedReference',''),80),text(b.get('note','')),now,now))
        c.execute('INSERT INTO cashier_account_scopes VALUES(?,?,?,1)',(a['staffId'],identifier,'manage'))
        row=one(c,'SELECT * FROM cashier_accounts WHERE id=?',(identifier,));self.event(c,a,identifier,'account.create',after=row)
        return {'account':row}

    def account_update(self,c,a,identifier,is_scopes,b):
        require(a,'cashier.accounts.manage')
        if a.get('role')!='admin':
            raise CashierError('仅管理员可管理账户和人员范围。',403)
        original=one(c,'SELECT * FROM cashier_accounts WHERE id=?',(uid(identifier),))
        if not original:raise CashierError('账户不存在。',404)
        if is_scopes:
            fields(b,('requestId','staffId','level','revision','note'),('requestId','staffId','level','revision','note'))
            staff=uid(b['staffId']);text(b['note'],500,True)
            if b['level'] not in ('disabled','view','operate','manage') or type(b['revision']) is not int or b['revision']<0:raise CashierError('账户授权无效。')
            old=one(c,'SELECT * FROM cashier_account_scopes WHERE staff_id=? AND account_id=?',(staff,identifier))
            if (old['revision'] if old else 0)!=b['revision']:raise CashierError('账户授权已变化。',409)
            if old:c.execute('UPDATE cashier_account_scopes SET level=?,revision=revision+1 WHERE staff_id=? AND account_id=?',(b['level'],staff,identifier))
            else:c.execute('INSERT INTO cashier_account_scopes VALUES(?,?,?,1)',(staff,identifier,b['level']))
            new=one(c,'SELECT * FROM cashier_account_scopes WHERE staff_id=? AND account_id=?',(staff,identifier));self.event(c,a,identifier,'account.scope',old,new)
            return {'scope':new}
        fields(b,('requestId','revision','name','maskedReference','note','active'),('requestId','revision','name','maskedReference','note','active'))
        if revision(b['revision'])!=original['revision']:raise CashierError('账户已变化。',409)
        if type(b['active']) is not bool:raise CashierError('账户状态无效。')
        c.execute('UPDATE cashier_accounts SET name=?,masked_reference=?,note=?,active=?,revision=revision+1,updated_at=? WHERE id=?',(text(b['name'],100,True),text(b['maskedReference'],80),text(b['note']),int(b['active']),self.clock(),identifier))
        new=one(c,'SELECT * FROM cashier_accounts WHERE id=?',(identifier,));self.event(c,a,identifier,'account.update',original,new)
        return {'account':new}

    def document(self,c,identifier):
        result=one(c,'SELECT * FROM cashier_documents WHERE id=?',(uid(identifier),))
        if not result:raise CashierError('资金凭证不存在。',404)
        return result

    def document_scopes(self,c,a,p,level='view',active=False):
        scope(c,a,p['accountId'],level,active)
        if p.get('toAccountId'):scope(c,a,p['toAccountId'],level,active)

    def normalize_document(self,b,editing=False):
        fields(b,('requestId','revision','kind','accountId','businessDate','amountCents','note','partyId','allocations','toAccountId','originalCashDocId','refundBasis','targetId','evidence'),('requestId','kind','accountId','businessDate','amountCents','note'))
        requested_kind=b['kind']
        if 'revision' in b and not editing:raise CashierError('新建凭证不可指定已有版本。')
        kind='refund' if requested_kind in ('refund_out','refund_in') else requested_kind
        if kind not in KINDS:raise CashierError('资金凭证类型无效。')
        allowed={'requestId','revision','kind','accountId','businessDate','amountCents','note'}
        allowed.update({'opening':{'evidence'},'receive':{'partyId','allocations'},'pay':{'partyId','allocations'},'transfer':{'toAccountId'},'refund':{'partyId','originalCashDocId','refundBasis'},'reversal':{'targetId'}}[kind])
        fields(b,allowed)
        p={'kind':kind,'accountId':uid(b['accountId']),'businessDate':day(b['businessDate']),'amountCents':cents(b['amountCents'],kind=='opening'),'note':text(b['note'],500,True)}
        if kind=='opening':p['evidence']=text(b.get('evidence'),2000,True)
        if kind in ('receive','pay'):
            p['partyId']=party_id(b.get('partyId')); allocations=b.get('allocations')
            if not isinstance(allocations,list) or not 1<=len(allocations)<=100:raise CashierError('请选择需要核销的财务来源。')
            p['allocations']=[]
            for item in allocations:
                fields(item,('releaseId','amountCents'),('releaseId','amountCents'))
                p['allocations'].append({'releaseId':uid(item['releaseId']),'amountCents':cents(item['amountCents'])})
            if len({x['releaseId'] for x in p['allocations']})!=len(p['allocations']) or sum(x['amountCents'] for x in p['allocations'])!=p['amountCents']:raise CashierError('来源重复或分配金额不等于资金金额。')
        if kind=='transfer':
            p['toAccountId']=uid(b.get('toAccountId'))
            if p['toAccountId']==p['accountId']:raise CashierError('调拨必须为两个不同账户。')
        if kind=='refund':
            p.update(partyId=party_id(b.get('partyId')),originalCashDocId=uid(b.get('originalCashDocId')),refundBasis=text(b.get('refundBasis'),2000,True))
            if requested_kind in ('refund_out','refund_in'):p['refundDirection']=requested_kind
        if kind=='reversal':p['targetId']=uid(b.get('targetId'))
        return p

    def public_document(self,c,row):
        return {'id':row['id'],'number':row['number'],'kind':row['kind'],'accountId':row['account_id'],'businessDate':row['business_date'],
                'amountCents':row['amount_cents'],'payload':json.loads(row['payload']),'status':row['status'],'revision':row['revision'],
                'frozenHash':row['frozen_hash'],'authorId':row['author_id'],'authorName':row['author_name'],
                'reviewerId':row['reviewer_id'],'reviewerName':row['reviewer_name'],
                'reversed':bool(c.execute('SELECT 1 FROM cashier_reversals WHERE target_doc_id=?',(row['id'],)).fetchone())}

    def document_create(self,c,a,b):
        p=self.normalize_document(b);require(a,'cashier.'+KINDS[p['kind']]+'.prepare');require(a,'cashier.amounts.sensitive')
        self.document_scopes(c,a,p,'operate',True)
        self.validate_references(c,p)
        identifier=str(uuid.uuid4());now=self.clock()
        number=self.reserve_number(p['kind'],p['businessDate'],identifier)
        c.execute('''INSERT INTO cashier_documents(id,number,kind,account_id,business_date,amount_cents,payload,author_id,author_name,status,revision,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,'draft',1,?,?)''',(identifier,number,p['kind'],p['accountId'],p['businessDate'],p['amountCents'],encoded(p),a['staffId'],a['name'],now,now))
        row=self.document(c,identifier);self.event(c,a,identifier,'document.create',after=p)
        return {'document':self.public_document(c,row)}

    def document_edit(self,c,a,identifier,b):
        row=self.document(c,identifier);p=self.normalize_document(b,True)
        require(a,'cashier.'+KINDS[row['kind']]+'.prepare');require(a,'cashier.amounts.sensitive')
        if row['author_id']!=a['staffId']:raise CashierError('只有制单人可以修改草稿。',403)
        if row['status'] not in ('draft','rejected') or revision(b.get('revision'))!=row['revision']:raise CashierError('凭证状态或版本已变化。',409)
        if p['kind']!=row['kind'] or p['accountId']!=row['account_id'] or p['businessDate']!=row['business_date']:raise CashierError('编号对应类型、账户和日期不可修改，请另建草稿。')
        self.document_scopes(c,a,p,'operate',True)
        c.execute("UPDATE cashier_documents SET amount_cents=?,payload=?,status='draft',frozen_hash=NULL,revision=revision+1,updated_at=? WHERE id=?",(p['amountCents'],encoded(p),self.clock(),identifier))
        self.event(c,a,identifier,'document.edit',json.loads(row['payload']),p)
        return {'document':self.public_document(c,self.document(c,identifier))}

    def document_action(self,c,a,identifier,action,b):
        fields(b,('requestId','revision','hash','decision','note') if action=='review' else ('requestId','revision','note'),('requestId','revision'))
        row=self.document(c,identifier);p=json.loads(row['payload'])
        require(a,'cashier.'+KINDS[row['kind']]+('.review' if action=='review' else '.prepare'));require(a,'cashier.amounts.sensitive')
        self.document_scopes(c,a,p,'manage' if action=='review' else 'operate',True)
        if revision(b['revision'])!=row['revision']:raise CashierError('凭证已被其他操作更新。',409)
        if action=='review':
            if row['author_id']==a['staffId']:raise CashierError('资金凭证必须由另一人审核。',403)
            if row['status']!='pending' or b.get('hash')!=row['frozen_hash']:raise CashierError('审核快照已变化。',409)
            if row['frozen_hash']!=digest({'id':identifier,'revision':row['revision'],'payload':p}):raise CashierError('审核冻结内容不一致。',409)
            if b.get('decision') not in ('approve','reject'):raise CashierError('审核决定无效。')
            note=text(b.get('note'),500,True)
            if b['decision']=='approve':self.post(c,a,row,p)
            status='confirmed' if b['decision']=='approve' else 'rejected'
            c.execute('UPDATE cashier_documents SET status=?,reviewer_id=?,reviewer_name=?,revision=revision+1,updated_at=? WHERE id=?',(status,a['staffId'],a['name'],self.clock(),identifier))
        else:
            if row['author_id']!=a['staffId']:raise CashierError('只有制单人可以提交或撤回。',403)
            if action=='submit':
                if row['status'] not in ('draft','rejected'):raise CashierError('凭证当前不能提交。',409)
                self.validate_references(c,p)
                frozen=digest({'id':identifier,'revision':row['revision']+1,'payload':p})
                c.execute("UPDATE cashier_documents SET status='pending',revision=revision+1,frozen_hash=?,updated_at=? WHERE id=?",(frozen,self.clock(),identifier))
            else:
                if row['status']!='pending':raise CashierError('凭证当前不能撤回。',409)
                text(b.get('note'),500,True)
                c.execute("UPDATE cashier_documents SET status='draft',revision=revision+1,frozen_hash=NULL,updated_at=? WHERE id=?",(self.clock(),identifier))
        updated=self.document(c,identifier);self.event(c,a,identifier,'document.'+action,{'status':row['status'],'revision':row['revision']},{'status':updated['status'],'revision':updated['revision'],'note':b.get('note','')})
        return {'document':self.public_document(c,updated)}

    def validate_references(self,c,p):
        if p['kind'] in ('receive','pay'):
            for item in p['allocations']:
                source=one(c,'SELECT * FROM cashier_source_releases WHERE id=?',(item['releaseId'],))
                if not source or source['status']!='published' or source['direction']!=p['kind'] or source['party_id']!=p['partyId']:raise CashierError('财务来源未发布、已撤回、单位或方向不符。',409)
                self.check_release(c,source)
        if p['kind']=='opening':
            if c.execute('SELECT 1 FROM cashier_postings WHERE account_id=?',(p['accountId'],)).fetchone():raise CashierError('已有流水的账户不能再次设置期初。',409)
        else:
            for account in [p['accountId']]+([p['toAccountId']] if p.get('toAccountId') else []):
                if not c.execute("SELECT 1 FROM cashier_postings p JOIN cashier_documents d ON d.id=p.doc_id WHERE p.account_id=? AND d.kind='opening' AND d.status='confirmed'",(account,)).fetchone():raise CashierError('账户期初尚未由两人确认。',409)
                opening_date=c.execute("SELECT MIN(p.date) FROM cashier_postings p JOIN cashier_documents d ON d.id=p.doc_id WHERE p.account_id=? AND d.kind='opening'",(account,)).fetchone()[0]
                if p['businessDate']<opening_date:raise CashierError('资金业务日期不能早于账户期初。',409)

    def check_release(self,c,r):
        source=one(c,'SELECT * FROM erp_documents WHERE id=?',(r['bill_id'],))
        if not source or source['status']!='confirmed' or source['revision']!=r['erp_revision'] or source['frozen_hash']!=r['erp_hash'] or c.execute('SELECT 1 FROM erp_reversals WHERE target_id=?',(r['bill_id'],)).fetchone():raise CashierError('已发布业务来源的审核快照已失效。',409)
        return source

    def posting(self,c,row,account,amount):
        c.execute('INSERT INTO cashier_postings(doc_id,account_id,date,signed_amount_cents) VALUES(?,?,?,?)',(row['id'],account,row['business_date'],amount))

    def validate_cash_timeline(self,c,account):
        balance=0
        for row in c.execute('SELECT date,SUM(signed_amount_cents) delta FROM cashier_postings WHERE account_id=? GROUP BY date ORDER BY date',(account,)):
            balance+=row['delta']
            if not 0<=balance<=MAX_CENTS:raise CashierError('该日期或后续历史时点的账户余额不足或超限。',409)

    def post(self,c,a,row,p):
        self.validate_references(c,p)
        kind=p['kind'];amount=p['amountCents'];accounts={p['accountId']}
        if kind=='opening':self.posting(c,row,p['accountId'],amount)
        elif kind in ('receive','pay'):
            allocations=[]
            for item in p['allocations']:
                release=one(c,'SELECT * FROM cashier_source_releases WHERE id=?',(item['releaseId'],))
                allocations.append({'billId':release['bill_id'],'amountCents':item['amountCents']})
                c.execute('INSERT INTO cashier_allocations(doc_id,release_id,bill_id,amount_cents) VALUES(?,?,?,?)',(row['id'],release['id'],release['bill_id'],item['amountCents']))
            erp_payload={'kind':'settlement','direction':kind,'partyId':p['partyId'],'amountCents':amount,'date':p['businessDate'],'account':p['accountId'],'allocations':allocations,'note':p['note'],'cashierDocumentId':row['id']}
            erp_row=self.create_erp_document(c,a,row,erp_payload)
            if self.settlement_bridge is None:
                from erp_settlement import accept_settlement
                accept_settlement(c,erp_row,erp_payload)
            else:
                self.settlement_bridge(c,erp_row,erp_payload)
            actual=[dict(x) for x in c.execute('SELECT bill_id,settled_cents,face_cents,date FROM erp_postings WHERE doc_id=? ORDER BY bill_id',(erp_row['id'],))]
            expected=sorted([{'bill_id':x['billId'],'settled_cents':x['amountCents'],'face_cents':0,'date':row['business_date']} for x in allocations],key=lambda x:x['bill_id'])
            assigned=[dict(x) for x in c.execute('SELECT bill_id,amount_cents FROM erp_allocations WHERE doc_id=? ORDER BY bill_id',(erp_row['id'],))]
            if actual!=expected or assigned!=[{'bill_id':x['bill_id'],'amount_cents':x['settled_cents']} for x in expected]:raise CashierError('财务桥未写入完整同事务核销，已停止资金记账。',409)
            self.posting(c,row,p['accountId'],amount if kind=='receive' else -amount)
        elif kind=='transfer':
            self.posting(c,row,p['accountId'],-amount);self.posting(c,row,p['toAccountId'],amount);accounts.add(p['toAccountId'])
        elif kind=='refund':
            original=self.document(c,p['originalCashDocId']);original_p=json.loads(original['payload'])
            if original['status']!='confirmed' or original['kind'] not in ('receive','pay') or original['account_id']!=p['accountId'] or original_p['partyId']!=p['partyId'] or c.execute('SELECT 1 FROM cashier_reversals WHERE target_doc_id=?',(original['id'],)).fetchone():raise CashierError('退款原单无效、账户或单位不符。',409)
            if p.get('refundDirection') and p['refundDirection']!=('refund_out' if original['kind']=='receive' else 'refund_in'):raise CashierError('退款方向与原收付款不符。',409)
            if p['businessDate']<original['business_date']:raise CashierError('退款日期不能早于原收付款。',409)
            refunded=c.execute('''SELECT COALESCE(SUM(r.amount_cents),0) FROM cashier_refund_links r
              WHERE r.original_cash_doc_id=? AND NOT EXISTS(SELECT 1 FROM cashier_reversals v WHERE v.target_doc_id=r.refund_doc_id)''',(original['id'],)).fetchone()[0]
            if refunded+amount>original['amount_cents']:raise CashierError('退款超过原单剩余可退金额。',409)
            c.execute('INSERT INTO cashier_refund_links VALUES(?,?,?)',(row['id'],original['id'],amount))
            self.posting(c,row,p['accountId'],-amount if original['kind']=='receive' else amount)
            self.validate_refund_timeline(c,original['id'])
        else:
            accounts.update(self.post_reversal(c,a,row,p))
        for account in accounts:self.validate_cash_timeline(c,account)

    def create_erp_document(self,c,a,cash,payload):
        identifier=str(uuid.uuid4());kind=payload['kind'];now=self.clock()
        if kind=='settlement':party_id=payload['partyId']
        else:party_id=one(c,'SELECT party_id FROM erp_documents WHERE id=?',(payload['targetId'],))['party_id']
        party=one(c,'SELECT name FROM erp_parties WHERE id=?',(party_id,))
        if not party:raise CashierError('财务单位不存在。',409)
        values=(identifier,'CASH-'+cash['number'],kind,party_id,party['name'],cash['business_date'],cash['business_date'],cash['amount_cents'],encoded(payload),'cashier:'+cash['id'],digest(payload),cash['author_id'],cash['author_name'],'confirmed',1,digest({'cashierDocumentId':cash['id'],'payload':payload}),a['staffId'],a['name'],now,now)
        c.execute('''INSERT INTO erp_documents(id,number,kind,party_id,party_name,date,due_date,amount_cents,payload,request_id,request_hash,author_id,author_name,status,revision,frozen_hash,reviewer_id,reviewer_name,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',values)
        c.execute('INSERT INTO cashier_erp_links VALUES(?,?)',(cash['id'],identifier))
        c.execute('INSERT INTO erp_events(doc_id,action,actor_id,actor_name,before_json,after_json,at) VALUES(?,?,?,?,NULL,?,?)',(identifier,'cashier.'+kind,a['staffId'],a['name'],encoded({'cashierDocumentId':cash['id'],'cashierNumber':cash['number']}),now))
        return one(c,'SELECT * FROM erp_documents WHERE id=?',(identifier,))

    def post_reversal(self,c,a,row,p):
        target=self.document(c,p['targetId']);tp=json.loads(target['payload'])
        self.document_scopes(c,a,tp,'manage',True)
        if target['status']!='confirmed' or target['kind'] in ('reversal','opening') or target['account_id']!=p['accountId'] or target['amount_cents']!=p['amountCents'] or c.execute('SELECT 1 FROM cashier_reversals WHERE target_doc_id=?',(target['id'],)).fetchone():raise CashierError('原单不能冲销或金额不完整。',409)
        if p['businessDate']<target['business_date']:raise CashierError('冲销日期不能早于原单。',409)
        if c.execute('SELECT 1 FROM cashier_refund_links WHERE original_cash_doc_id=?',(target['id'],)).fetchone():raise CashierError('原单已有退款证据，不能作为误记直接冲销。',409)
        postings=[dict(x) for x in c.execute('SELECT * FROM cashier_postings WHERE doc_id=?',(target['id'],))]
        if any(c.execute('SELECT 1 FROM cashier_reconciliation_locks WHERE posting_id=?',(x['id'],)).fetchone() for x in postings):raise CashierError('原单已对账锁定，请先按权限撤销对账。',409)
        for item in postings:self.posting(c,row,item['account_id'],-item['signed_amount_cents'])
        link=one(c,'SELECT * FROM cashier_erp_links WHERE cash_doc_id=?',(target['id'],))
        if link:
            ep={'kind':'reversal','targetId':link['erp_doc_id'],'note':p['note'],'cashierDocumentId':row['id']}
            erp_row=self.create_erp_document(c,a,row,ep)
            if self.reversal_bridge is None:
                # Root-owned narrow ERP bridge must accept the actual cashier
                # actor and recheck its link/reviewer. Never mint a ledger actor.
                try:
                    from erp_settlement import accept_cashier_reversal
                except ImportError:
                    raise CashierError('出纳与原财务的原子冲销桥尚未接入，已整笔停止。',503) from None
                accept_cashier_reversal(c,a,erp_row,ep)
            else:
                self.reversal_bridge(c,a,erp_row,ep)
            erp_original=[dict(x) for x in c.execute('SELECT bill_id,face_cents,settled_cents FROM erp_postings WHERE doc_id=? ORDER BY bill_id',(link['erp_doc_id'],))]
            erp_actual=[dict(x) for x in c.execute('SELECT bill_id,face_cents,settled_cents,date FROM erp_postings WHERE doc_id=? ORDER BY bill_id',(erp_row['id'],))]
            expected=[{'bill_id':x['bill_id'],'face_cents':-x['face_cents'],'settled_cents':-x['settled_cents'],'date':row['business_date']} for x in erp_original]
            if not erp_original or erp_actual!=expected or not c.execute('SELECT 1 FROM erp_reversals WHERE target_id=? AND reversal_id=?',(link['erp_doc_id'],erp_row['id'])).fetchone():raise CashierError('财务桥未完整补偿核销，已整笔停止。',409)
        c.execute('INSERT INTO cashier_reversals VALUES(?,?)',(target['id'],row['id']))
        if target['kind']=='refund':self.validate_refund_timeline(c,tp['originalCashDocId'])
        return {x['account_id'] for x in postings}

    def validate_refund_timeline(self,c,original_id):
        original=self.document(c,original_id);running=0
        movements=[]
        for raw in c.execute('''SELECT r.amount_cents,d.business_date,v.reversal_doc_id,
              rd.business_date reversal_date FROM cashier_refund_links r
              JOIN cashier_documents d ON d.id=r.refund_doc_id
              LEFT JOIN cashier_reversals v ON v.target_doc_id=r.refund_doc_id
              LEFT JOIN cashier_documents rd ON rd.id=v.reversal_doc_id
              WHERE r.original_cash_doc_id=?''',(original_id,)):
            movements.append((raw['business_date'],raw['amount_cents']))
            if raw['reversal_doc_id']:movements.append((raw['reversal_date'],-raw['amount_cents']))
        daily={}
        for date,amount in movements:daily[date]=daily.get(date,0)+amount
        for date in sorted(daily):
            running+=daily[date]
            if not 0<=running<=original['amount_cents']:raise CashierError('此日期或后续历史时点的累计退款超出原单可退金额。',409)

    def release(self,c,a,identifier,b):
        finance_authority(a)
        if identifier:
            fields(b,('requestId','revision','note'),('requestId','revision','note'))
            row=one(c,'SELECT * FROM cashier_source_releases WHERE id=?',(uid(identifier),))
            if not row:raise CashierError('财务发布记录不存在。',404)
            if row['status']!='published' or revision(b['revision'])!=row['revision']:raise CashierError('财务发布状态已变化。',409)
            text(b['note'],500,True)
            c.execute("UPDATE cashier_source_releases SET status='revoked',revision=revision+1 WHERE id=?",(identifier,))
            self.event(c,a,identifier,'source.revoke',row,{'note':b['note']})
        else:
            fields(b,('requestId','billId','revision','hash','note'),('requestId','billId','revision','hash','note'))
            bill=one(c,'SELECT * FROM erp_bills WHERE id=?',(uid(b['billId']),))
            source=one(c,'SELECT * FROM erp_documents WHERE id=?',(b['billId'],))
            if not bill or not source or source['status']!='confirmed' or revision(b['revision'])!=source['revision'] or b['hash']!=source['frozen_hash'] or not isinstance(b['hash'],str) or not re.fullmatch('[0-9a-f]{64}',b['hash']) or c.execute('SELECT 1 FROM erp_reversals WHERE target_id=?',(b['billId'],)).fetchone():raise CashierError('只能发布审核有效且快照一致的业务来源。',409)
            if c.execute("SELECT 1 FROM cashier_source_releases WHERE bill_id=? AND status='published'",(b['billId'],)).fetchone():raise CashierError('该业务来源已经发布。',409)
            identifier=str(uuid.uuid4())
            c.execute("INSERT INTO cashier_source_releases VALUES(?,?,?,?,?,?,'published',1,?,?,?)",(identifier,b['billId'],source['revision'],source['frozen_hash'],bill['party_id'],'receive' if bill['kind']=='receivable' else 'pay',a['staffId'],self.clock(),text(b['note'],500,True)))
            self.event(c,a,identifier,'source.publish',after={'billId':b['billId'],'erpRevision':source['revision'],'erpHash':source['frozen_hash']})
        row=one(c,'SELECT * FROM cashier_source_releases WHERE id=?',(identifier,))
        return {'release':{'id':row['id'],'billId':row['bill_id'],'revision':row['revision'],'status':row['status'],'direction':row['direction'],'partyId':row['party_id']}}

    def pagination(self,q):
        for k,default,maximal in [('limit','50',200),('after','0',2**53-1)]:
            value=q.get(k,default)
            if not re.fullmatch(r'(?:0|[1-9]\d{0,15})',value) or not (1 if k=='limit' else 0)<=int(value)<=maximal:raise CashierError('分页参数无效。')
        return int(q.get('limit','50')),int(q.get('after','0'))

    def documents(self,c,a,q):
        require(a,'cashier.amounts.sensitive');limit,after=self.pagination(q)
        rows=c.execute('SELECT rowid cursor,* FROM cashier_documents WHERE rowid>? ORDER BY rowid LIMIT 10000',(after,)).fetchall();result=[]
        for raw in rows:
            row=dict(raw);p=json.loads(row['payload'])
            if q.get('accountId') and row['account_id']!=uid(q['accountId']) or q.get('status') and row['status']!=q['status'] or q.get('kind') and row['kind']!=q['kind']:continue
            grants=[one(c,'SELECT level FROM cashier_account_scopes WHERE staff_id=? AND account_id=?',(a['staffId'],v)) for v in [p['accountId']]+([p['toAccountId']] if p.get('toAccountId') else [])]
            if not all(x and x['level']!='disabled' for x in grants):continue
            result.append(dict(self.public_document(c,row),cursor=row['cursor']))
            if len(result)==limit:break
        return {'documents':result,'nextAfter':result[-1]['cursor'] if result else after}

    def report(self,c,a,path,q):
        require(a,'cashier.reports.export' if path.endswith('/export') else 'cashier.reports.view');require(a,'cashier.amounts.sensitive')
        account=uid(q.get('accountId'));scope(c,a,account)
        start=day(q.get('from','0001-01-01'));end=day(q.get('asOf',q.get('to','9999-12-31')))
        if start>end:raise CashierError('日期区间无效。')
        opening=c.execute('SELECT COALESCE(SUM(signed_amount_cents),0) FROM cashier_postings WHERE account_id=? AND date<?',(account,start)).fetchone()[0]
        all_rows=c.execute('''SELECT p.*,d.number,d.kind,d.author_name,d.reviewer_name,
          EXISTS(SELECT 1 FROM cashier_reconciliation_locks l WHERE l.posting_id=p.id) reconciled
          FROM cashier_postings p JOIN cashier_documents d ON d.id=p.doc_id
          WHERE p.account_id=? AND p.date>=? AND p.date<=? ORDER BY p.date,p.id''',(account,start,end)).fetchall()
        balance=opening;rows=[]
        for raw in all_rows:
            x=dict(raw);balance+=x['signed_amount_cents'];x['balanceCents']=balance;rows.append(x)
        result={'accountId':account,'from':start,'to':end,'openingCents':opening,'closingCents':balance,
                'receiptCents':sum(x['signed_amount_cents'] for x in rows if x['signed_amount_cents']>0),
                'paymentCents':-sum(x['signed_amount_cents'] for x in rows if x['signed_amount_cents']<0),
                'reconciledCents':sum(x['signed_amount_cents'] for x in rows if x['reconciled'])}
        if path.endswith('/export'):
            if len(rows)>10000:raise CashierError('导出超过一万行，请缩小日期范围。')
            out=io.StringIO(newline='');writer=csv.writer(out);writer.writerow(['日期','凭证号','类型','金额分','余额分','已对账'])
            for x in rows:writer.writerow([x['date'],x['number'],x['kind'],x['signed_amount_cents'],x['balanceCents'],x['reconciled']])
            result['csvBase64']=base64.b64encode(('\ufeff'+out.getvalue()).encode()).decode('ascii')
        else:
            limit,after=self.pagination(q);result['postings']=rows[after:after+limit];result['totalRows']=len(rows);result['nextAfter']=after+len(result['postings'])
        return result

    def parse_statement(self,b):
        fields(b,('requestId','accountId','csvBase64','encoding','mapping','previewHash','name'),('requestId','accountId','csvBase64','encoding','mapping'))
        if b['encoding'] not in ('utf-8','gb18030') or not isinstance(b['csvBase64'],str) or len(b['csvBase64'])>14*1024*1024:raise CashierError('账单编码或大小无效。')
        try:content=base64.b64decode(b['csvBase64'],validate=True)
        except (ValueError,binascii.Error):raise CashierError('账单编码无效。') from None
        if not 0<len(content)<=10*1024*1024:raise CashierError('账单必须为1字节至10MiB。')
        try:decoded=content.decode(b['encoding'],errors='strict').lstrip('\ufeff')
        except UnicodeError:raise CashierError('账单文字无法按所选编码读取。') from None
        if '\x00' in decoded:raise CashierError('账单不可含零字节。')
        mapping=fields(b['mapping'],('date','amount','externalId','description'),('date','amount'))
        if any(not isinstance(v,str) or not v or len(v)>100 for v in mapping.values()) or len(set(mapping.values()))!=len(mapping):raise CashierError('账单字段映射无效。')
        try:
            reader=csv.DictReader(io.StringIO(decoded,newline=''),strict=True)
            if not reader.fieldnames or len(reader.fieldnames)>50 or len(set(reader.fieldnames))!=len(reader.fieldnames) or not set(mapping.values()).issubset(reader.fieldnames):raise CashierError('账单列名重复、缺失或超过上限。')
            rows=[]
            for index,raw in enumerate(reader,2):
                if index>10001 or None in raw or any(v is None or len(v)>4000 for v in raw.values()):raise CashierError('账单行数、字段数量或长度超过限制。')
                value=raw[mapping['amount']].strip()
                if not re.fullmatch(r'-?(?:0|[1-9]\d{0,10})(?:\.\d{1,2})?',value):raise CashierError('账单金额须为至多两位小数的十进制金额。')
                parts=value.lstrip('-').split('.');amount=int(parts[0])*100+int((parts[1] if len(parts)==2 else '').ljust(2,'0'))
                if not 0<amount<=MAX_CENTS:raise CashierError('账单金额为零或超限。')
                external=text(raw[mapping['externalId']],200) if mapping.get('externalId') else ''
                rows.append({'lineNumber':index,'date':day(raw[mapping['date']].strip()),'signedAmountCents':-amount if value.startswith('-') else amount,'externalId':external or None,'description':text(raw[mapping['description']],1000) if mapping.get('description') else ''})
        except csv.Error:raise CashierError('CSV格式无效。') from None
        if not rows:raise CashierError('账单没有数据行。')
        ids=[x['externalId'] for x in rows if x['externalId']]
        if len(ids)!=len(set(ids)):raise CashierError('账单包含重复外部流水号，须先核实。',409)
        original_hash=hashlib.sha256(content).hexdigest()
        preview_hash=digest({'accountId':uid(b['accountId']),'originalSha256':original_hash,'encoding':b['encoding'],'mapping':mapping,'rows':rows})
        return content,original_hash,preview_hash,rows

    def statement_import(self,c,a,b,preview):
        require(a,'cashier.reconcile.import');require(a,'cashier.amounts.sensitive')
        account=scope(c,a,b.get('accountId'),'operate',True)
        if account['kind']!='bank':raise CashierError('银行账单只能导入银行账户。')
        content,original_hash,preview_hash,rows=self.parse_statement(b)
        if preview:return {'rows':rows,'previewHash':preview_hash,'originalSha256':original_hash,'rowCount':len(rows)}
        if b.get('previewHash')!=preview_hash:raise CashierError('预览与提交的原件或映射不一致。',409)
        if c.execute('SELECT 1 FROM cashier_statement_imports WHERE account_id=? AND original_sha256=?',(account['id'],original_hash)).fetchone():raise CashierError('该原件已导入此账户，改名不能重复导入。',409)
        for row in rows:
            if row['externalId'] and c.execute('SELECT 1 FROM cashier_statement_rows WHERE account_id=? AND external_id=?',(account['id'],row['externalId'])).fetchone():raise CashierError('外部流水号已存在，请核实原件，未导入任何行。',409)
        original=one(c,'SELECT size,content FROM cashier_statement_originals WHERE sha256=?',(original_hash,))
        if original and (original['size']!=len(content) or bytes(original['content'])!=content):raise CashierError('原件内容与保留哈希冲突。',409)
        if not original:c.execute('INSERT INTO cashier_statement_originals VALUES(?,?,?,?)',(original_hash,len(content),content,self.clock()))
        identifier=str(uuid.uuid4())
        c.execute('INSERT INTO cashier_statement_imports VALUES(?,?,?,?,?,?,?,?,?,?)',(identifier,account['id'],original_hash,text(b.get('name','银行账单.csv'),200,True),b['encoding'],encoded(b['mapping']),preview_hash,len(rows),a['staffId'],self.clock()))
        for row in rows:c.execute('INSERT INTO cashier_statement_rows VALUES(?,?,?,?,?,?,?,?)',(str(uuid.uuid4()),identifier,account['id'],row['lineNumber'],row['date'],row['signedAmountCents'],row['externalId'],row['description']))
        self.event(c,a,identifier,'statement.import',after={'sha256':original_hash,'rowCount':len(rows),'accountId':account['id']})
        return {'import':{'id':identifier,'accountId':account['id'],'rowCount':len(rows),'originalSha256':original_hash,'previewHash':preview_hash}}

    def statement_list(self,c,a,q):
        require(a,'cashier.amounts.sensitive');require(a,'cashier.reports.view')
        account=uid(q.get('accountId'));scope(c,a,account);limit,after=self.pagination(q)
        return {'imports':[dict(x) for x in c.execute('SELECT rowid cursor,* FROM cashier_statement_imports WHERE account_id=? AND rowid>? ORDER BY rowid LIMIT ?',(account,after,limit))]}

    def statement_get(self,c,a,identifier,original):
        require(a,'cashier.amounts.sensitive');require(a,'cashier.reports.export' if original else 'cashier.reports.view')
        row=one(c,'SELECT * FROM cashier_statement_imports WHERE id=?',(uid(identifier),))
        if not row:raise CashierError('账单不存在。',404)
        scope(c,a,row['account_id'])
        if original:
            raw=one(c,'SELECT * FROM cashier_statement_originals WHERE sha256=?',(row['original_sha256'],))
            if not raw or len(raw['content'])!=raw['size'] or hashlib.sha256(raw['content']).hexdigest()!=raw['sha256']:raise CashierError('账单原件完整性校验失败。',409)
            return {'original':{'name':row['original_name'],'sha256':raw['sha256'],'size':raw['size'],'base64':base64.b64encode(raw['content']).decode('ascii')}}
        return {'import':row,'rows':[dict(x) for x in c.execute('''SELECT r.*,l.reconciliation_id FROM cashier_statement_rows r LEFT JOIN cashier_reconciliation_locks l ON l.statement_row_id=r.id WHERE r.import_id=? ORDER BY r.line_number''',(identifier,))]}

    def public_reconciliation(self,row):
        return {'id':row['id'],'accountId':row['account_id'],'payload':json.loads(row['payload']),'status':row['status'],'revision':row['revision'],'frozenHash':row['frozen_hash'],'authorId':row['author_id'],'reviewerId':row['reviewer_id'],'createdAt':row['created_at'],'updatedAt':row['updated_at']}

    def validate_matches(self,c,account,matches):
        if not isinstance(matches,list) or not 1<=len(matches)<=1000:raise CashierError('对账匹配数量无效。')
        statement_ids=set();posting_ids=set();normalized=[]
        for item in matches:
            fields(item,('statementRowId','postingId'),('statementRowId','postingId'))
            statement_id=uid(item['statementRowId']);posting_id=item['postingId']
            if type(posting_id) is not int or posting_id<1 or statement_id in statement_ids or posting_id in posting_ids:raise CashierError('对账行或资金流水重复。')
            statement_ids.add(statement_id);posting_ids.add(posting_id)
            statement=one(c,'SELECT * FROM cashier_statement_rows WHERE id=?',(statement_id,));posting=one(c,'SELECT * FROM cashier_postings WHERE id=?',(posting_id,))
            if not statement or not posting or statement['account_id']!=account or posting['account_id']!=account or statement['signed_amount_cents']!=posting['signed_amount_cents']:raise CashierError('对账必须同账户、同方向、金额差异为零。',409)
            if c.execute('SELECT 1 FROM cashier_reconciliation_locks WHERE statement_row_id=? OR posting_id=?',(statement_id,posting_id)).fetchone():raise CashierError('账单行或资金流水已经对账。',409)
            if c.execute('SELECT 1 FROM cashier_reversals WHERE target_doc_id=?',(posting['doc_id'],)).fetchone():raise CashierError('原资金凭证已冲销，请核实其完整链。',409)
            normalized.append({'statementRowId':statement_id,'postingId':posting_id})
        return normalized

    def reconcile_create(self,c,a,b):
        require(a,'cashier.reconcile.match');require(a,'cashier.amounts.sensitive')
        fields(b,('requestId','accountId','matches','note'),('requestId','accountId','matches','note'))
        account=scope(c,a,b['accountId'],'operate',True)
        if account['kind']!='bank':raise CashierError('银行对账需要银行账户。')
        matches=self.validate_matches(c,account['id'],b['matches']);p={'matches':matches,'note':text(b['note'],500,True),'differenceCents':0}
        identifier=str(uuid.uuid4());now=self.clock();frozen=digest({'id':identifier,'accountId':account['id'],'payload':p})
        c.execute("INSERT INTO cashier_reconciliations VALUES(?,?,?,'pending',1,?,?,NULL,?,?)",(identifier,account['id'],encoded(p),frozen,a['staffId'],now,now))
        for match in matches:c.execute('INSERT INTO cashier_reconciliation_matches(reconciliation_id,statement_row_id,posting_id) VALUES(?,?,?)',(identifier,match['statementRowId'],match['postingId']))
        row=one(c,'SELECT * FROM cashier_reconciliations WHERE id=?',(identifier,));self.event(c,a,identifier,'reconciliation.create',after=p)
        return {'reconciliation':self.public_reconciliation(row)}

    def reconcile_action(self,c,a,identifier,action,b):
        require(a,'cashier.reconcile.review');require(a,'cashier.amounts.sensitive')
        fields(b,('requestId','revision','hash','decision','note') if action=='review' else ('requestId','revision','note'),('requestId','revision','note'))
        row=one(c,'SELECT * FROM cashier_reconciliations WHERE id=?',(uid(identifier),))
        if not row:raise CashierError('对账记录不存在。',404)
        scope(c,a,row['account_id'],'manage',True)
        if revision(b['revision'])!=row['revision']:raise CashierError('对账版本已变化。',409)
        if row['author_id']==a['staffId']:raise CashierError('对账需要另一人复核或解除。',403)
        note=text(b['note'],500,True)
        if action=='review':
            if row['status']!='pending' or b.get('hash')!=row['frozen_hash'] or b.get('decision') not in ('approve','reject'):raise CashierError('对账审核快照或状态无效。',409)
            status='confirmed' if b['decision']=='approve' else 'rejected'
            if status=='confirmed':
                matches=self.validate_matches(c,row['account_id'],json.loads(row['payload'])['matches'])
                for match in matches:c.execute('INSERT INTO cashier_reconciliation_locks VALUES(?,?,?)',(identifier,match['statementRowId'],match['postingId']))
        else:
            if row['status']!='confirmed':raise CashierError('只能解除已复核对账。',409)
            status='revoked';c.execute('DELETE FROM cashier_reconciliation_locks WHERE reconciliation_id=?',(identifier,))
        c.execute('UPDATE cashier_reconciliations SET status=?,revision=revision+1,reviewer_id=?,updated_at=? WHERE id=?',(status,a['staffId'],self.clock(),identifier))
        self.event(c,a,identifier,'reconciliation.'+action,{'status':row['status'],'revision':row['revision']},{'status':status,'note':note})
        return {'reconciliation':self.public_reconciliation(one(c,'SELECT * FROM cashier_reconciliations WHERE id=?',(identifier,)))}
