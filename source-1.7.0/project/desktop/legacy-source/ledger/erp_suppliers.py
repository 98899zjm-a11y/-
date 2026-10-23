from app import db
from erp_values import require,text,identifier,revision,object_value,digest,ErpError
from erp_common import transaction,one,event
import uuid

def public(row):
    return {'id':row['id'],'code':row['id'].replace(':','-'),'kind':row['kind'],'name':row['name'],'contact':row['contact'],'phone':row['phone'],'termsDays':row['terms_days'],'note':row['note'],'active':bool(row['active']),'revision':row['revision']}

def listing(c):return [public(dict(x)) for x in c.execute('SELECT * FROM erp_parties ORDER BY kind,name,id')]

def save_supplier(actor,value):
    require(actor,'erp.parties.manage',write=True)
    v=object_value(value,('requestId','kind','name','contact','phone','termsDays','note','id','revision','active'),('requestId','kind','name'))
    identifier(v['requestId'])
    if v['kind'] not in ('supplier','customer'):raise ErpError('往来单位类别无效。')
    days=v.get('termsDays',0)
    if isinstance(days,bool) or not isinstance(days,int) or not 0<=days<=3650:raise ErpError('账期须为0至3650天整数。')
    active=v.get('active',True)
    if not isinstance(active,bool):raise ErpError('启停状态无效。')
    fields={'kind':v['kind'],'name':text(v['name'],120,True),'contact':text(v.get('contact',''),120),'phone':text(v.get('phone',''),80),'termsDays':days,'note':text(v.get('note',''),2000),'active':active,'id':v.get('id'),'revision':v.get('revision')}
    hashed=digest(fields)
    with transaction() as c:
        prior=one(c,'SELECT * FROM erp_party_requests WHERE actor_id=? AND request_id=?',(actor['staffId'],v['requestId']))
        if prior:
            if prior['request_hash']!=hashed:raise ErpError('重复请求的内容不一致。',409)
            return public(one(c,'SELECT * FROM erp_parties WHERE id=?',(prior['party_id'],)))
        old=one(c,'SELECT * FROM erp_parties WHERE id=?',(fields['id'],)) if fields['id'] else None
        if fields['id'] and not old:raise ErpError('往来单位不存在。',404)
        if old and (old['kind']!=fields['kind'] or old['revision']!=revision(fields['revision'])):raise ErpError('单位资料已变化，请刷新后修改。',409)
        conflict=one(c,'SELECT id FROM erp_parties WHERE kind=? AND norm_name=?',(fields['kind'],fields['name'].casefold()))
        if conflict and (not old or conflict['id']!=old['id']):raise ErpError('同类别往来单位已存在，请选择原档案。',409)
        now=db.now_str()
        if old:
            c.execute('UPDATE erp_parties SET name=?,norm_name=?,contact=?,phone=?,terms_days=?,note=?,active=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?',(fields['name'],fields['name'].casefold(),fields['contact'],fields['phone'],days,fields['note'],int(active),now,old['id'],old['revision']))
            pid=old['id']
        else:
            sid=None
            if fields['kind']=='supplier':
                supplier=one(c,'SELECT id FROM suppliers WHERE name=?',(fields['name'],))
                if supplier:sid=supplier['id']
                else:sid=c.execute('INSERT INTO suppliers(name,sort,note,active) VALUES(?,?,?,1)',(fields['name'],0,'ERP新增虚构/业务供应商')).lastrowid
                pid='SUP:'+str(sid)
                if one(c,'SELECT id FROM erp_parties WHERE id=?',(pid,)):raise ErpError('该供应商已有ERP档案，请选择原档案。',409)
            else:pid='CUS:'+str(uuid.uuid4())
            c.execute('INSERT INTO erp_parties(id,kind,supplier_id,name,norm_name,contact,phone,terms_days,note,active,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?)',(pid,fields['kind'],sid,fields['name'],fields['name'].casefold(),fields['contact'],fields['phone'],days,fields['note'],int(active),now,now))
        after=one(c,'SELECT * FROM erp_parties WHERE id=?',(pid,));event(c,actor,None,'维护往来单位',old,after)
        c.execute('INSERT INTO erp_party_requests VALUES(?,?,?,?)',(actor['staffId'],v['requestId'],hashed,pid))
        return public(after)
