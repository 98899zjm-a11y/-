"""ERP draft/review state machine; only accepted receipts create supplier debt."""
import json
import uuid
from app import db
from erp_values import text,identifier,date,revision,quantity,weight,money,positive_money,object_value,encoded,digest,ErpError,require
from erp_common import transaction,one,party,document,event,authorize_document,authorize_stored_document,public_document,attachments_checked,is_reversed
from erp_numbers import reserve

KINDS={'purchase','receipt','receivable','opening_receivable','opening_payable','settlement','reversal'}
COMMON={'requestId','kind','partyId','date','note','attachments','revision'}
FIELDS={'purchase':{'businessType','dueDate','lines'},'receipt':{'sourceId','dueDate','lines'},'receivable':{'amount','dueDate','sourceSaleId'},'opening_receivable':{'amount','dueDate','evidence'},'opening_payable':{'amount','dueDate','evidence'},'settlement':{'direction','amount','account','allocations'},'reversal':{'targetId'}}

def source_record(c,sid):
    if isinstance(sid,bool) or not isinstance(sid,int) or sid<1:raise ErpError('原财务销售行标识无效。')
    row=one(c,'SELECT * FROM sales WHERE id=?',(sid,))
    if not row:raise ErpError('原财务销售行不存在。',404)
    return row

def source_fingerprint(c,sid):return digest(source_record(c,sid))

def source_snapshot(row):
    keys=('date','product','status','weight','sell_gram_price','labor','received','amount_c')
    return {'id':row['id'],**{key:str(row[key]) if row[key] is not None else '' for key in keys if key in row}}

def normalized(c,actor,value):
    if not isinstance(value,dict) or not isinstance(value.get('kind'),str) or value['kind'] not in KINDS:raise ErpError('ERP单据类型无效。')
    kind=value['kind'];v=object_value(value,COMMON|FIELDS[kind],('requestId','kind','partyId','date'))
    identifier(v['requestId']);p=party(c,v['partyId']);day=date(v['date'])
    result={'kind':kind,'partyId':p['id'],'date':day,'note':text(v.get('note',''),2000),'attachments':attachments_checked(c,actor,v.get('attachments',[]))}
    due=date(v.get('dueDate',day))
    if due<day:raise ErpError('到期日不能早于业务日期。')
    result['dueDate']=due;lines=[]
    if kind=='purchase':
        if p['kind']!='supplier' or v.get('businessType') not in ('own','consignment'):raise ErpError('采购须选择供应商和明确业务类型。')
        result['businessType']=v['businessType']
        if not isinstance(v.get('lines'),list) or not 1<=len(v['lines'])<=100:raise ErpError('采购须有1至100项商品。')
        for raw in v['lines']:
            line=object_value(raw,('description','material','purity','quantity','estimatedWeight','amount'),('description','quantity','estimatedWeight','amount'))
            lines.append({'description':text(line['description'],300,True),'material':text(line.get('material',''),80),'purity':text(line.get('purity',''),80),'quantity':quantity(line['quantity']),'estimatedWeight':weight(line['estimatedWeight']),'actualWeight':'0.0000','amountCents':money(line['amount']),'purchaseLineId':None})
    elif kind=='receipt':
        source=document(c,identifier(v.get('sourceId')))
        if source['party_id']!=p['id']:raise ErpError('收货来源不属于该供应商。')
        if source['kind']!='purchase' or source['status']!='confirmed' or is_reversed(c,source['id']):raise ErpError('收货只能关联尚有效的已确认采购单。',409)
        if day<source['date']:raise ErpError('收货日期不能早于采购日期。')
        if not isinstance(v.get('lines'),list) or not 1<=len(v['lines'])<=100:raise ErpError('收货须有1至100项商品。')
        result['sourceId']=source['id'];seen=set()
        for raw in v['lines']:
            line=object_value(raw,('purchaseLineId','quantity','actualWeight','amount'),('purchaseLineId','quantity','actualWeight','amount'))
            lid=identifier(line['purchaseLineId']);original=one(c,'SELECT * FROM erp_lines WHERE id=? AND doc_id=?',(lid,source['id']))
            if not original or lid in seen:raise ErpError('收货商品来源无效或重复。')
            seen.add(lid);q=quantity(line['quantity'])
            if q>original['quantity']:raise ErpError('收货件数超过原订单件数。',409)
            lines.append({'description':original['description'],'material':original['material'],'purity':original['purity'],'quantity':q,'estimatedWeight':original['estimated_weight'],'actualWeight':weight(line['actualWeight']),'amountCents':money(line['amount']),'purchaseLineId':lid})
    elif kind in ('receivable','opening_receivable','opening_payable'):
        if p['kind']!=('supplier' if kind=='opening_payable' else 'customer'):raise ErpError('欠款方向与往来单位不一致。')
        result['amountCents']=positive_money(v.get('amount'))
        if kind.startswith('opening_'):result['evidence']=text(v.get('evidence',''),2000,True)
        if kind=='receivable' and 'sourceSaleId' in v:
            source=source_record(c,v['sourceSaleId']);result['sourceSaleId']=v['sourceSaleId'];result['sourceFingerprint']=digest(source);result['sourceSnapshot']=source_snapshot(source)
    elif kind=='settlement':
        direction=v.get('direction')
        if direction not in ('receive','pay') or p['kind']!=('supplier' if direction=='pay' else 'customer'):raise ErpError('收付款方向与往来单位不一致。')
        result.update(direction=direction,amountCents=positive_money(v.get('amount')),account=text(v.get('account',''),120,True))
        if not isinstance(v.get('allocations'),list) or not 1<=len(v['allocations'])<=100:raise ErpError('请选择1至100张需要核销的往来单。')
        allocations=[];seen=set()
        for raw in v['allocations']:
            item=object_value(raw,('billId','amount'),('billId','amount'));bid=identifier(item['billId'])
            if bid in seen:raise ErpError('同一往来单不能重复分配。')
            seen.add(bid);bill=one(c,'SELECT * FROM erp_bills WHERE id=?',(bid,))
            if not bill or bill['party_id']!=p['id'] or bill['kind']!=('payable' if direction=='pay' else 'receivable'):raise ErpError('核销对象不属于该单位或收付款方向错误。')
            if day<bill['date']:raise ErpError('资金日期不能早于欠款确认日期。')
            allocations.append({'billId':bid,'amountCents':positive_money(item['amount'])})
        if sum(x['amountCents'] for x in allocations)!=result['amountCents']:raise ErpError('收付款金额必须等于本次分配核销的合计。')
        result['allocations']=allocations
    else:
        target=document(c,identifier(v.get('targetId')))
        if target['status']!='confirmed' or target['kind']=='reversal' or target['party_id']!=p['id'] or is_reversed(c,target['id']):raise ErpError('冲销目标不是该单位的有效确认单据。',409)
        if day<target['date']:raise ErpError('冲销日期不能早于原单日期。')
        if not result['note']:raise ErpError('冲销必须填写原因。')
        # Request has no direction hint: authorize the actual stored target.
        if target['kind'] in ('purchase','receipt','opening_payable') or target['kind']=='settlement' and json.loads(target['payload']).get('direction')=='pay':require(actor,'erp.reports.sensitive')
        result.update(targetId=target['id'],amountCents=target['amount_cents'])
    if lines:result['lines']=lines;result['amountCents']=sum(x['amountCents'] for x in lines)
    if result.get('amountCents',0)>9_000_000_000_000:raise ErpError('单据合计金额超过范围。')
    authorize_document(actor,kind,'prepare',result)
    return result,p

def insert_lines(c,doc_id,payload):
    for item in payload.get('lines',[]):
        c.execute('INSERT INTO erp_lines(id,doc_id,source_line_id,description,material,purity,quantity,estimated_weight,actual_weight,amount_cents) VALUES(?,?,?,?,?,?,?,?,?,?)',(str(uuid.uuid4()),doc_id,item['purchaseLineId'],item['description'],item['material'],item['purity'],item['quantity'],item['estimatedWeight'],item['actualWeight'],item['amountCents']))

def create_purchase(actor,value,provenance=None):
    if not isinstance(value,dict):raise ErpError('单据正文须为对象。')
    identifier(value.get('requestId'));hashed=digest(value)
    with transaction() as c:
        prior=one(c,'SELECT * FROM erp_documents WHERE author_id=? AND request_id=?',(actor['staffId'],value['requestId']))
        if prior:
            if prior['request_hash']!=hashed:raise ErpError('同一请求的单据内容已变化，已拒绝重复制单。',409)
            authorize_stored_document(c,actor,prior,'prepare')
            if provenance is not None:
                if prior['kind']!='purchase' or prior['status']!='draft':raise ErpError('识别请求已关联非草稿单据，请查看原记录。',409)
                provenance(c,prior['id'],json.loads(prior['payload']))
            return public_document(c,prior,actor,True)
        payload,p=normalized(c,actor,value)
        if 'sourceSaleId' in payload and c.execute('SELECT 1 FROM erp_sale_sources WHERE sale_id=?',(payload['sourceSaleId'],)).fetchone():raise ErpError('该原财务销售行已经起账，不能重复建应收。',409)
        did=str(uuid.uuid4());number=reserve(payload['kind'],payload['date'],did);now=db.now_str()
        c.execute('INSERT INTO erp_documents(id,number,kind,party_id,party_name,date,due_date,amount_cents,payload,request_id,request_hash,author_id,author_name,status,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,\'draft\',1,?,?)',(did,number,payload['kind'],p['id'],p['name'],payload['date'],payload['dueDate'],payload['amountCents'],encoded(payload),value['requestId'],hashed,actor['staffId'],actor['name'],now,now))
        insert_lines(c,did,payload)
        if provenance is not None:provenance(c,did,payload)
        event(c,actor,did,'编制单据',None,{'number':number,'kind':payload['kind'],'amountCents':payload['amountCents']})
        return public_document(c,document(c,did),actor,True)

create_receipt=create_purchase
create_bill=create_purchase
create_settlement=create_purchase
create_reversal=create_purchase

def update_draft(actor,did,value):
    with transaction() as c:
        old=document(c,did);payload=json.loads(old['payload']);authorize_stored_document(c,actor,old,'prepare')
        if old['author_id']!=actor['staffId'] or old['status'] not in ('draft','rejected') or old['revision']!=revision(value.get('revision')):raise ErpError('只能修改本人当前版本的草稿或退回单据。',409)
        # Updating a draft supplies the original creation fields, not hidden
        # computed values from a previous response.
        v=dict(value);v.setdefault('requestId',old['request_id']);v.setdefault('kind',old['kind'])
        new,p=normalized(c,actor,v)
        retained_images=[x[0] for x in c.execute("SELECT attachment_id FROM erp_ocr_imports WHERE document_id=? AND status='draft'",(did,))]
        if any(aid not in new['attachments'] for aid in retained_images):raise ErpError('原图是图片识别采购单的核对依据，不能从草稿中移除。',409)
        if new['kind']!=old['kind']:raise ErpError('不能修改单据类别。')
        c.execute('DELETE FROM erp_lines WHERE doc_id=?',(did,));insert_lines(c,did,new)
        c.execute('UPDATE erp_documents SET party_id=?,party_name=?,date=?,due_date=?,amount_cents=?,payload=?,status=\'draft\',revision=revision+1,frozen_hash=NULL,updated_at=? WHERE id=? AND revision=?',(p['id'],p['name'],new['date'],new['dueDate'],new['amountCents'],encoded(new),db.now_str(),did,old['revision']))
        event(c,actor,did,'修改草稿',payload,new)
        return public_document(c,document(c,did),actor,True)

def submit(actor,did,value):
    object_value(value,('revision',),('revision',))
    with transaction() as c:
        old=document(c,did);payload=json.loads(old['payload']);authorize_stored_document(c,actor,old,'prepare')
        if old['author_id']!=actor['staffId'] or old['status'] not in ('draft','rejected') or old['revision']!=revision(value['revision']):raise ErpError('单据版本或状态已变化，请刷新后提交。',409)
        party(c,old['party_id']);hashed=digest({'id':did,'payload':payload,'revision':old['revision']+1,'lines':[dict(x) for x in c.execute('SELECT * FROM erp_lines WHERE doc_id=? ORDER BY rowid',(did,))]})
        c.execute('UPDATE erp_documents SET status=\'pending\',revision=revision+1,frozen_hash=?,updated_at=? WHERE id=? AND revision=?',(hashed,db.now_str(),did,old['revision']))
        event(c,actor,did,'提交复核',{'status':old['status']},{'status':'pending','hash':hashed})
        return public_document(c,document(c,did),actor,True)

def add_bill(c,row,payload,kind,source_type,source_id):
    c.execute('INSERT INTO erp_bills(id,kind,party_id,party_name,date,due_date,amount_cents,source_type,source_id) VALUES(?,?,?,?,?,?,?,?,?)',(row['id'],kind,row['party_id'],row['party_name'],row['date'],row['due_date'],row['amount_cents'],source_type,source_id))
    c.execute('INSERT INTO erp_postings(doc_id,bill_id,date,face_cents) VALUES(?,?,?,?)',(row['id'],row['id'],row['date'],row['amount_cents']))

def accept_receipt(c,row,payload):
    source=document(c,payload['sourceId'])
    if source['status']!='confirmed' or is_reversed(c,source['id']):raise ErpError('原采购单已失效。',409)
    for line in c.execute('SELECT * FROM erp_lines WHERE doc_id=?',(row['id'],)):
        original=one(c,'SELECT * FROM erp_lines WHERE id=?',(line['source_line_id'],));received=c.execute('SELECT COALESCE(SUM(quantity),0) FROM erp_receipt_quantities WHERE source_line_id=?',(original['id'],)).fetchone()[0]
        if received+line['quantity']>original['quantity']:raise ErpError('本批超出剩余可验收件数，请重新核对。',409)
        c.execute('INSERT INTO erp_receipt_quantities VALUES(?,?,?,?)',(row['id'],original['id'],line['quantity'],row['date']))
        from erp_settlement import validate_receipt_timeline
        validate_receipt_timeline(c,original['id'])
    if json.loads(source['payload'])['businessType']=='own':add_bill(c,row,payload,'payable','receipt',row['id'])

def review(actor,did,value):
    v=object_value(value,('revision','hash','decision','note'),('revision','hash','decision','note'))
    if v['decision'] not in ('approve','reject'):raise ErpError('复核决定无效。')
    note=text(v['note'],2000,True)
    with transaction() as c:
        old=document(c,did);payload=json.loads(old['payload']);authorize_stored_document(c,actor,old,'review')
        if old['author_id']==actor['staffId']:raise ErpError('不能复核自己编制的单据，请另一名获授权人员复核。',403)
        if old['status']!='pending' or old['revision']!=revision(v['revision']) or v['hash']!=old['frozen_hash']:raise ErpError('单据版本、内容或状态已变化，请刷新。',409)
        expected=digest({'id':did,'payload':payload,'revision':old['revision'],'lines':[dict(x) for x in c.execute('SELECT * FROM erp_lines WHERE doc_id=? ORDER BY rowid',(did,))]})
        if expected!=old['frozen_hash']:raise ErpError('待复核单据完整性检查失败。',409)
        if v['decision']=='approve':
            party(c,old['party_id'])
            kind=old['kind']
            if kind=='receipt':accept_receipt(c,old,payload)
            elif kind in ('receivable','opening_receivable','opening_payable'):
                if 'sourceSaleId' in payload:
                    sid=payload['sourceSaleId']
                    if source_fingerprint(c,sid)!=payload['sourceFingerprint']:raise ErpError('原财务销售行已变化，请重新核对。',409)
                    if c.execute('SELECT 1 FROM erp_sale_sources WHERE sale_id=?',(sid,)).fetchone():raise ErpError('该原财务销售行已经起账，不能重复建应收。',409)
                    c.execute('INSERT INTO erp_sale_sources VALUES(?,?,?)',(sid,did,payload['sourceFingerprint']))
                add_bill(c,old,payload,'payable' if kind=='opening_payable' else 'receivable','legacy-sale' if 'sourceSaleId' in payload else kind,str(payload.get('sourceSaleId',did)))
            elif kind=='settlement':
                from erp_settlement import accept_settlement
                accept_settlement(c,old,payload)
            elif kind=='reversal':
                from erp_settlement import accept_reversal
                accept_reversal(c,actor,old,payload)
        status='confirmed' if v['decision']=='approve' else 'rejected'
        c.execute('UPDATE erp_documents SET status=?,revision=revision+1,reviewer_id=?,reviewer_name=?,updated_at=? WHERE id=? AND revision=?',(status,actor['staffId'],actor['name'],db.now_str(),did,old['revision']))
        event(c,actor,did,'通过复核' if status=='confirmed' else '退回修改',{'status':'pending'},{'status':status,'note':note,'hash':old['frozen_hash']})
        return public_document(c,document(c,did),actor,True)
