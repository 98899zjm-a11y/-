"""Persistent number knowledge outside the ledger restore slot, with gaps retained."""
import json
import os
from pathlib import Path
import uuid
from erp_values import encoded, ErpError

PREFIX={'purchase':'CG','receipt':'SH','receivable':'YS','opening_receivable':'QCYS','opening_payable':'QCYF','settlement':'SKFK','reversal':'CX'}

def store_path():
    from erp_runtime import number_store
    return number_store()[0]

def reserve(kind,day,doc_id):
    # Caller already holds the ledger BEGIN IMMEDIATE writer lock. File audit
    # and restricted token forbid targets outside this isolated configuration.
    from erp_runtime import number_store
    filename,namespace=number_store()
    state=json.loads(filename.read_text('utf-8')) if filename.exists() else {'version':1,'namespace':namespace,'sequences':{},'numbers':{}}
    if state.get('version')!=1 or state.get('namespace')!=namespace or not isinstance(state.get('sequences'),dict) or not isinstance(state.get('numbers'),dict):raise ErpError('ERP编号保留记录无效，已停止制单。',409)
    scope=PREFIX[kind]+'-'+day.replace('-','')
    prior=state['sequences'].get(scope,0)
    if isinstance(prior,bool) or not isinstance(prior,int) or not 0<=prior<999999:raise ErpError('ERP编号已达上限或保留记录异常。',409)
    value=prior+1;number=scope+'-'+str(value).zfill(6)
    if number in state['numbers']:raise ErpError('ERP编号冲突，已停止制单。',409)
    state['sequences'][scope]=value;state['numbers'][number]={'docId':doc_id,'kind':kind,'date':day}
    temporary=filename.with_name(filename.name+'.'+str(uuid.uuid4())+'.tmp')
    try:
        with temporary.open('x',encoding='utf-8') as out:out.write(encoded(state));out.flush();os.fsync(out.fileno())
        os.replace(temporary,filename)
    finally:
        if temporary.exists():temporary.unlink()
    return number

def reservations(c):
    filename=store_path()
    if not filename.exists():return []
    state=json.loads(filename.read_text('utf-8'));present={x[0] for x in c.execute('SELECT id FROM erp_documents')}
    return [{'number':n,**v,'presentInLedger':v['docId'] in present} for n,v in state['numbers'].items()]
