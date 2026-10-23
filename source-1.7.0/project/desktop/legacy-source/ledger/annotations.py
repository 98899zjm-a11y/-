"""Persistent field and cell notes, independently versioned from business values."""
import json,re,uuid,sqlite3,datetime
from flask import Blueprint,request,jsonify,abort,has_request_context
from app import auth,db
import repairs as r
bp=Blueprint('annotations',__name__)
SCHEMA='''CREATE TABLE IF NOT EXISTS entry_annotations(context TEXT PRIMARY KEY,note TEXT NOT NULL,revision INTEGER NOT NULL,actor TEXT NOT NULL,updated_at TEXT NOT NULL);'''
TABLES={'sales','stock_items','material_stock','payroll_records','expenses'}
def canonical(c,context):
    if not isinstance(context,dict):raise ValueError('插注位置不正确。')
    scope=context.get('scope');field=str(context.get('field',''))
    if not field or len(field)>100:raise ValueError('插注字段不正确。')
    if scope=='record':
        table=context.get('table')
        if table not in TABLES:raise ValueError('插注类目不正确。')
        record=str(context.get('record',''))
        if record.startswith('draft:'):
            if not re.fullmatch(r'draft:[0-9a-f]{32}',record):raise ValueError('草稿位置不正确。')
            value={'scope':scope,'table':table,'record':record,'owner':auth.current_user()['id'],'field':field}
        else:
            if not record.isdigit() or not c.execute('SELECT 1 FROM '+table+' WHERE id=?',(record,)).fetchone():raise ValueError('对应记录不存在。')
            value={'scope':scope,'table':table,'record':record,'field':field}
    elif scope=='workbook':
        doc=int(context.get('doc',0));sheet=str(context.get('sheet',''));row=int(context.get('row',0));col=int(context.get('col',0))
        source=c.execute('SELECT id FROM source_rows WHERE document_id=? AND sheet=? AND row_no=?',(doc,sheet,row)).fetchone()
        if not source or not 1<=col<=16384:raise ValueError('对应原表位置不存在。')
        value={'scope':scope,'doc':doc,'sheet':sheet,'row':row,'col':col,'field':field}
    elif scope=='form':
        path=str(context.get('path',''))
        if not path.startswith('/') or len(path)>200 or any(x in path for x in ('://','..','\x00')):raise ValueError('表单位置不正确。')
        value={'scope':scope,'path':path,'form':str(context.get('form',''))[:100],'field':field}
    else:raise ValueError('插注位置不正确。')
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'))
@bp.get('/annotations/list')
@auth.login_required
def listing():
    scope=request.args.get('scope');results=[]
    for row in db.query('SELECT * FROM entry_annotations'):
        position=json.loads(row['context'])
        if position.get('scope')!=scope:continue
        if scope=='workbook':
            if str(position.get('doc'))!=request.args.get('doc') or position.get('sheet')!=request.args.get('sheet'):continue
            if not int(request.args.get('start',1))<=position.get('row',0)<=int(request.args.get('end',1048576)):continue
        elif scope=='record':
            if position.get('table')!=request.args.get('table') or position.get('record')!=request.args.get('record'):continue
            if position.get('record','').startswith('draft:') and position.get('owner')!=auth.current_user()['id']:continue
        elif scope=='form':
            if position.get('path')!=request.args.get('path') or position.get('form')!=request.args.get('form'):continue
        else:continue
        if row['note']:results.append({'context':position,'note':row['note'],'revision':row['revision']})
    return jsonify(ok=True,rows=results)
@bp.route('/annotations',methods=['GET','POST'])
@auth.login_required
def entry():
    try:
        payload=request.get_json(silent=True) or {} if request.method=='POST' else {'context':json.loads(request.args.get('context','{}'))}
        with r.transaction() as c:
            key=canonical(c,payload.get('context'));old=c.execute('SELECT * FROM entry_annotations WHERE context=?',(key,)).fetchone()
            if request.method=='POST':
                if auth.current_user()['role'] not in ('admin','bookkeeper'):abort(403)
                note=payload.get('note','')
                if not isinstance(note,str) or len(note)>4000:raise ValueError('插注最多4000字。')
                expected=old['revision'] if old else 0
                if payload.get('revision')!=expected:raise r.Conflict('插注已被修改，请重新打开后核对。')
                revision=expected+1
                c.execute('INSERT INTO entry_annotations VALUES(?,?,?,?,?) ON CONFLICT(context) DO UPDATE SET note=excluded.note,revision=excluded.revision,actor=excluded.actor,updated_at=excluded.updated_at',(key,note,revision,auth.current_user()['username'],db.now_str()))
                r.audit(c,'保存插注','entry_annotations',None,dict(old) if old else None,{'context':json.loads(key),'note':note,'revision':revision})
                return jsonify(ok=True,note=note,revision=revision)
            return jsonify(ok=True,note=old['note'] if old else '',revision=old['revision'] if old else 0,actor=old['actor'] if old else '',updated_at=old['updated_at'] if old else '')
    except r.Conflict as e:return jsonify(ok=False,error=str(e)),409
    except (ValueError,TypeError,sqlite3.Error) as e:return jsonify(ok=False,error=str(e)),400
def promote(c,table,rid):
    if not has_request_context() or request.method!='POST' or table not in TABLES:return
    draft=request.form.get('_annotation_draft','')
    if not re.fullmatch(r'draft:[0-9a-f]{32}',draft):return
    user=auth.current_user()
    if not user:return
    for row in c.execute('SELECT * FROM entry_annotations').fetchall():
        position=json.loads(row['context'])
        if position.get('scope')!='record' or position.get('table')!=table or position.get('record')!=draft or position.get('owner')!=user['id']:continue
        position.pop('owner',None);position['record']=str(rid);key=canonical(c,position)
        prior=c.execute('SELECT * FROM entry_annotations WHERE context=?',(key,)).fetchone()
        note=row['note'] if not prior or not prior['note'] else prior['note']+'\n'+row['note']
        c.execute('INSERT INTO entry_annotations VALUES(?,?,?,?,?) ON CONFLICT(context) DO UPDATE SET note=excluded.note,revision=excluded.revision,actor=excluded.actor,updated_at=excluded.updated_at',(key,note,(prior['revision'] if prior else 0)+1,user['username'],db.now_str()))
        c.execute('DELETE FROM entry_annotations WHERE context=?',(row['context'],))
def configure(app):
    with r.transaction() as c:c.executescript(SCHEMA)
    previous=r.write_row
    def noted_write(c,table,values,old=None):
        rid=previous(c,table,values,old)
        promote(c,table,rid)
        return rid
    r.write_row=noted_write;app.register_blueprint(bp)
    @app.context_processor
    def annotation_boot():
        record=None
        if request.path=='/payroll':
            names=db.names_of('staff')
            employee=request.values.get('employee','') or (names[0] if names else '')
            month=request.values.get('month',datetime.date.today().strftime('%Y-%m'))
            if employee and month:record=db.query('SELECT id FROM payroll_records WHERE employee=? AND month=?',(employee,month),one=True)
        return {'annotation_boot':{'draft':'draft:'+uuid.uuid4().hex,'payroll_id':record['id'] if record else None,'readonly':bool(auth.current_user() and auth.current_user()['role']=='viewer')}}
