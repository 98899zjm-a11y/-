"""Immutable confirmed allocation and compensating entries, under writer lock."""
import json
import uuid
from erp_values import ErpError,require
from erp_common import one,document,is_reversed

def validate_timeline(c,bill_id):
    face=settled=0
    for item in c.execute('SELECT date,SUM(face_cents) face,SUM(settled_cents) settled FROM erp_postings WHERE bill_id=? GROUP BY date ORDER BY date',(bill_id,)):
        face+=item['face'];settled+=item['settled']
        if face<0 or settled<0 or settled>face:raise ErpError('该日期的冲销会破坏历史欠款或核销余额，请调整业务日期。',409)

def validate_receipt_timeline(c,line_id):
    source=one(c,'SELECT quantity FROM erp_lines WHERE id=?',(line_id,));received=0
    for item in c.execute('SELECT date,SUM(quantity) quantity FROM erp_receipt_quantities WHERE source_line_id=? GROUP BY date ORDER BY date',(line_id,)):
        received+=item['quantity']
        if received<0 or received>source['quantity']:raise ErpError('该日期会造成历史验收超量或负数，请核对来源与业务日期。',409)

def accept_settlement(c,row,payload):
    for allocation in payload['allocations']:
        bill=one(c,'SELECT * FROM erp_bills WHERE id=?',(allocation['billId'],))
        if not bill or bill['party_id']!=row['party_id'] or bill['kind']!=('payable' if payload['direction']=='pay' else 'receivable'):raise ErpError('核销单位或方向已变化。',409)
        current=c.execute('SELECT COALESCE(SUM(face_cents-settled_cents),0) FROM erp_postings WHERE bill_id=?',(bill['id'],)).fetchone()[0]
        if allocation['amountCents']>current:raise ErpError('核销金额超过最新未结余额，请重新分配。',409)
        # Backdated payments may not overdraw any intervening historic balance.
        running=0
        for value in c.execute('SELECT date,SUM(face_cents-settled_cents) delta FROM erp_postings WHERE bill_id=? GROUP BY date ORDER BY date',(bill['id'],)):
            running+=value['delta']
            if value['date']>=row['date'] and running<allocation['amountCents']:raise ErpError('该业务日期之后的历史余额不足，不能倒填超额核销。',409)
        at_date=c.execute('SELECT COALESCE(SUM(face_cents-settled_cents),0) FROM erp_postings WHERE bill_id=? AND date<=?',(bill['id'],row['date'])).fetchone()[0]
        if at_date<allocation['amountCents']:raise ErpError('核销日期的应收应付余额不足。',409)
        c.execute('INSERT INTO erp_allocations VALUES(?,?,?,?)',(str(uuid.uuid4()),row['id'],bill['id'],allocation['amountCents']))
        c.execute('INSERT INTO erp_postings(doc_id,bill_id,date,settled_cents) VALUES(?,?,?,?)',(row['id'],bill['id'],row['date'],allocation['amountCents']))
        validate_timeline(c,bill['id'])

def _reversal_target(c,payload):
    target=document(c,payload['targetId']);p=json.loads(target['payload'])
    if target['status']!='confirmed' or target['kind']=='reversal' or is_reversed(c,target['id']):raise ErpError('原单已经失效或被冲销。',409)
    return target,p

def accept_reversal(c,actor,row,payload):
    target,p=_reversal_target(c,payload)
    if target['kind'] in ('purchase','receipt','opening_payable') or target['kind']=='settlement' and p.get('direction')=='pay':require(actor,'erp.reports.sensitive')
    from cashier_engine import assert_erp_reversal_allowed
    assert_erp_reversal_allowed(c,target['id'])
    return _apply_reversal(c,row,target,p)

def accept_cashier_reversal(c,actor,row,payload):
    from cashier_engine import validate_cashier_erp_reversal
    validate_cashier_erp_reversal(c,actor,row,payload)
    target,p=_reversal_target(c,payload)
    if target['kind']!='settlement':raise ErpError('出纳冲销只允许已关联的收付款核销单。',409)
    return _apply_reversal(c,row,target,p)

def _apply_reversal(c,row,target,p):
    if target['kind']=='purchase':
        lines=c.execute('SELECT id FROM erp_lines WHERE doc_id=?',(target['id'],)).fetchall()
        if any(c.execute('SELECT COALESCE(SUM(quantity),0) FROM erp_receipt_quantities WHERE source_line_id=?',(x[0],)).fetchone()[0] for x in lines):raise ErpError('采购还有有效收货，须先处理收货。',409)
        for line in lines:
            if c.execute('SELECT COALESCE(SUM(quantity),0) FROM erp_receipt_quantities WHERE source_line_id=? AND date<=?',(line[0],row['date'])).fetchone()[0]:raise ErpError('采购冲销当日仍有有效验收，请调整日期。',409)
            running=0
            for item in c.execute('SELECT date,SUM(quantity) quantity FROM erp_receipt_quantities WHERE source_line_id=? GROUP BY date ORDER BY date',(line[0],)):
                running+=item['quantity']
                if item['date']>=row['date'] and running:raise ErpError('采购冲销日期之后仍有历史有效验收，请调整日期。',409)
    postings=[dict(x) for x in c.execute('SELECT * FROM erp_postings WHERE doc_id=?',(target['id'],))]
    if target['kind']!='settlement':
        for item in postings:
            balances=one(c,'SELECT COALESCE(SUM(face_cents),0) face,COALESCE(SUM(settled_cents),0) settled FROM erp_postings WHERE bill_id=?',(item['bill_id'],))
            if balances['settled']!=0:raise ErpError('原欠款已有有效核销，请先处理关联收付款。',409)
    else:
        # Undoing a receipt of funds restores debt; it cannot precede any
        # later actual payment allocation in the same reversal chain.
        if row['date']<target['date']:raise ErpError('冲销日期早于原资金日期。',409)
    for item in postings:
        c.execute('INSERT INTO erp_postings(doc_id,bill_id,date,face_cents,settled_cents) VALUES(?,?,?,?,?)',(row['id'],item['bill_id'],row['date'],-item['face_cents'],-item['settled_cents']))
        validate_timeline(c,item['bill_id'])
    if target['kind']=='receipt':
        for item in c.execute('SELECT * FROM erp_receipt_quantities WHERE doc_id=?',(target['id'],)).fetchall():
            c.execute('INSERT INTO erp_receipt_quantities VALUES(?,?,?,?)',(row['id'],item['source_line_id'],-item['quantity'],row['date']))
            validate_receipt_timeline(c,item['source_line_id'])
    c.execute('INSERT INTO erp_reversals VALUES(?,?)',(target['id'],row['id']))
