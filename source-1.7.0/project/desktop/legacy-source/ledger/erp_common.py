import json
import uuid
from app import db
import repairs
from erp_values import ErpError,encoded,permitted,require,digest,identifier

transaction=repairs.transaction

def one(c,sql,args=()):
    result=c.execute(sql,args).fetchone()
    return dict(result) if result else None

def party(c,party_id,active=True):
    if not isinstance(party_id,str):raise ErpError('往来单位标识无效。')
    result=one(c,'SELECT * FROM erp_parties WHERE id=?',(party_id,))
    if not result:raise ErpError('往来单位不存在。',404)
    if active and not result['active']:raise ErpError('往来单位已停用。',409)
    return result

def document(c,doc_id):
    identifier(doc_id)
    result=one(c,'SELECT * FROM erp_documents WHERE id=?',(doc_id,))
    if not result:raise ErpError('ERP单据不存在。',404)
    return result

def event(c,actor,doc_id,action,before=None,after=None):
    at=db.now_str();old=encoded(before) if before is not None else None;new=encoded(after) if after is not None else None
    c.execute('INSERT INTO erp_events(doc_id,action,actor_id,actor_name,before_json,after_json,at) VALUES(?,?,?,?,?,?,?)',(doc_id,action,actor['staffId'],actor['name'],old,new,at))
    detail={'actor':actor['staffId'],'actorName':actor['name'],'table':'erp_documents' if doc_id else 'erp_parties','id':doc_id,'before':before,'after':after}
    c.execute('INSERT INTO audit_logs(action,detail,at) VALUES(?,?,?)',('ERP '+action,encoded(detail),at))

def has_sensitive(actor):return permitted(actor,'erp.reports.sensitive')

def domain(kind):
    return {'purchase':'purchase','receipt':'receipt','receivable':'bill','opening_receivable':'bill','opening_payable':'bill','settlement':'settlement','reversal':'reversal'}[kind]

def authorize_document(actor,kind,stage,payload=None):
    require(actor,'erp.'+domain(kind)+'.'+stage,write=True,review=stage=='review')
    if kind in ('purchase','receipt','opening_payable') or kind=='settlement' and (payload or {}).get('direction')=='pay':require(actor,'erp.reports.sensitive')

def sensitive_document(c,row):
    payload=json.loads(row['payload'])
    if row['kind']=='reversal':
        target=document(c,payload['targetId'])
        if target['kind']=='reversal':raise ErpError('冲销目标关联异常，已拒绝操作。',409)
        return sensitive_document(c,target)
    return row['kind'] in ('purchase','receipt','opening_payable') or row['kind']=='settlement' and payload.get('direction')=='pay'

def authorize_stored_document(c,actor,row,stage):
    authorize_document(actor,row['kind'],stage,json.loads(row['payload']))
    if sensitive_document(c,row):require(actor,'erp.reports.sensitive')

def is_reversed(c,doc_id):return bool(c.execute('SELECT 1 FROM erp_reversals WHERE target_id=?',(doc_id,)).fetchone())

def public_document(c,row,actor,details=False,as_of=None):
    payload=json.loads(row['payload']);result={'id':row['id'],'number':row['number'],'kind':row['kind'],'partyId':row['party_id'],'partyName':row['party_name'],'date':row['date'],'dueDate':row['due_date'],'amountCents':row['amount_cents'],'status':'reversed' if is_reversed(c,row['id']) else row['status'],'revision':row['revision'],'hash':row['frozen_hash'],'authorId':row['author_id'],'authorName':row['author_name'],'reviewerId':row['reviewer_id'],'reviewerName':row['reviewer_name'],'note':payload.get('note',''),'payload':payload}
    sensitive=sensitive_document(c,row)
    if row['kind']=='reversal':result['sensitiveTarget']=sensitive
    result['lines']=[{'id':x['id'],'purchaseLineId':x['source_line_id'],'description':x['description'],'material':x['material'],'purity':x['purity'],'quantity':x['quantity'],'estimatedWeight':x['estimated_weight'],'actualWeight':x['actual_weight'],'amountCents':x['amount_cents']} for x in map(dict,c.execute('SELECT * FROM erp_lines WHERE doc_id=? ORDER BY rowid',(row['id'],)))]
    result['billId']=row['id'] if c.execute('SELECT 1 FROM erp_bills WHERE id=?',(row['id'],)).fetchone() else None
    if row['kind']=='purchase':
        for line in result['lines']:
            line['receivedQuantity']=c.execute('SELECT COALESCE(SUM(quantity),0) FROM erp_receipt_quantities WHERE source_line_id=?'+(' AND date<=?' if as_of else ''),(line['id'],as_of) if as_of else (line['id'],)).fetchone()[0]
            line['remainingQuantity']=line['quantity']-line['receivedQuantity']
    if details:result['events']=[{'action':x['action'],'actorId':x['actor_id'],'actorName':x['actor_name'],'at':x['at'],'note':json.loads(x['after_json'] or '{}').get('note','') if not sensitive or has_sensitive(actor) else ''} for x in map(dict,c.execute('SELECT * FROM erp_events WHERE doc_id=? ORDER BY id',(row['id'],)))]
    if sensitive and not has_sensitive(actor):
        result.pop('amountCents',None);result['payload']={k:v for k,v in payload.items() if k not in ('amountCents','lines','allocations','sourceFingerprint','attachments','note','evidence','account')}
        for line in result['lines']:line.pop('amountCents',None)
        result['note']='敏感采购或应付信息未授权';result['redacted']=True;result['billId']=None
    else:result['payload'].pop('sourceFingerprint',None)
    if details and row['kind']=='purchase' and has_sensitive(actor):
        import ocr
        evidence=ocr.evidence_for_document(c,row['id'])
        if evidence:result['ocrEvidence']=evidence
    return result

def bill_rows(c,actor,as_of):
    result=[]
    for raw in c.execute('''SELECT b.*,d.number,COALESCE(SUM(p.face_cents),0) face,COALESCE(SUM(p.settled_cents),0) settled
      FROM erp_bills b JOIN erp_documents d ON d.id=b.id JOIN erp_postings p ON p.bill_id=b.id
      WHERE p.date<=? AND b.date<=? GROUP BY b.id ORDER BY b.date,b.id''',(as_of,as_of)):
        row=dict(raw)
        if row['kind']=='payable' and not has_sensitive(actor):continue
        result.append({'id':row['id'],'number':row['number'],'kind':row['kind'],'partyId':row['party_id'],'partyName':row['party_name'],'date':row['date'],'dueDate':row['due_date'],'amountCents':row['face'],'settledCents':row['settled'],'balanceCents':row['face']-row['settled'],'sourceId':row['source_id']})
    return result

def attachments_checked(c,actor,ids):
    if not isinstance(ids,list) or len(ids)>10 or any(not isinstance(x,str) for x in ids) or len(set(ids))!=len(ids):raise ErpError('凭证列表无效。')
    for value in ids:
        identifier(value);row=one(c,'SELECT * FROM erp_attachments WHERE id=?',(value,))
        if not row:raise ErpError('凭证不存在。',404)
        if row['owner_id']!=actor['staffId'] and not has_sensitive(actor):raise ErpError('没有使用该凭证的权限。',403)
    return ids
