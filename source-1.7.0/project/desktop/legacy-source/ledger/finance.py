import json,datetime,calendar,sqlite3,csv,io,pathlib,uuid
from flask import Blueprint,request,render_template,redirect,url_for,flash,send_file,Response
from app import db,auth
import repairs as r
import rule_engine as rules

bp=Blueprint('finance',__name__)
FIELDS={'base':'底薪','day_rate':'日薪','days':'出勤天数','percent':'提成比例','gram_rate':'每克提成','overtime_hours':'加班小时','overtime_rate':'加班单价','bonus':'奖金','allowance':'补贴','deductions':'扣款','social':'社保','tax':'个税'}
DEFAULT_INPUTS={k:0.0 for k in FIELDS}
DEFAULT_INPUTS.update(days=26,mode='底薪+原提成')
SCHEMA='''
CREATE TABLE IF NOT EXISTS employee_pay_profiles(employee TEXT PRIMARY KEY,inputs_json TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS payroll_records(id INTEGER PRIMARY KEY,employee TEXT NOT NULL,month TEXT NOT NULL,inputs_json TEXT NOT NULL,outputs_json TEXT NOT NULL,basis_json TEXT NOT NULL,basis_hash TEXT NOT NULL,rule_version INTEGER NOT NULL,status TEXT NOT NULL DEFAULT '草稿',note TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(employee,month));
CREATE TABLE IF NOT EXISTS expenses(id INTEGER PRIMARY KEY,date TEXT NOT NULL,employee TEXT NOT NULL,category TEXT NOT NULL,purpose TEXT NOT NULL,ticket REAL NOT NULL,allowance REAL NOT NULL,personal REAL NOT NULL,amount REAL NOT NULL,rule_version INTEGER NOT NULL,payout TEXT NOT NULL,status TEXT NOT NULL DEFAULT '草稿',receipt_path TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS payroll_expenses(payroll_id INTEGER NOT NULL,expense_id INTEGER UNIQUE NOT NULL,PRIMARY KEY(payroll_id,expense_id));
'''
TRANSITIONS={'草稿':['已提交'],'已提交':['已审核','已退回'],'已退回':['草稿'],'已审核':['已支付','已退回'],'已支付':[]}

def csv_export_cell(value):
    """Neutralize exported text without changing stored rows or numeric values."""
    if isinstance(value,str) and value.lstrip(' ').startswith(('=','+','-','@','\t','\r','\n')):
        return "'"+value
    return value

def month_bounds(month):
    try:y,m=map(int,month.split('-'));start=datetime.date(y,m,1)
    except (ValueError,TypeError):raise ValueError('请选择有效月份。')
    end=datetime.date(y,m,calendar.monthrange(y,m)[1]);return start.isoformat(),end.isoformat()

def payroll_month_guard(c,employee,month):
    """One canonical write identity; historical text is never rewritten here."""
    message='新增或修改工资必须使用规范 YYYY-MM 月份；历史工资的别名月份仅供查看，请先核对。'
    try:
        if not isinstance(month,str):raise ValueError(message)
        canonical=month_bounds(month)[0][:7]
    except (ValueError,TypeError,AttributeError,OverflowError):raise ValueError(message)
    if month!=canonical:raise ValueError(message)
    same=[]
    for old in c.execute('SELECT id,month FROM payroll_records WHERE employee=?',(employee,)):
        try:period=month_bounds(old['month'])[0][:7]
        except (ValueError,TypeError,AttributeError,OverflowError):
            raise r.Conflict('该员工历史工资第 '+str(old['id'])+' 条的月份无法识别，请先核对；暂不新增、修改、确认或发放工资。')
        if period==canonical:same.append(old)
    if len(same)>1 or any(old['month']!=canonical for old in same):
        raise r.Conflict('该员工在 '+canonical+' 同一自然月存在非规范月份或多份历史工资，请先核对；未新增、修改、确认或发放工资。')
    return canonical

def payroll_basis(c,employee,month,pid=None):
    start,end=month_bounds(month)
    rows=[dict(x) for x in c.execute("SELECT id,date,received,amount_c,profit_c,comm_c,weight,status FROM sales WHERE staff=? AND date>=? AND date<=? AND status='已完成' ORDER BY id",(employee,start,end))]
    expenses=[dict(x) for x in c.execute("SELECT id,amount,status,payout,date FROM expenses WHERE employee=? AND date>=? AND date<=? AND payout='随工资' AND status='已审核' AND id NOT IN (SELECT expense_id FROM payroll_expenses WHERE payroll_id!=?) ORDER BY id",(employee,start,end,pid or -1))]
    return dict(sales=rows,expenses=expenses)

def salary_compute(inputs,basis,rule_id):
    variables={label:inputs[key] for key,label in FIELDS.items()}
    variables.update(计薪方式=inputs['mode'],销售金额=sum(x['amount_c'] for x in basis['sales']),销售利润=sum(x['profit_c'] for x in basis['sales']),
                     销售克重=sum(x['weight'] for x in basis['sales']),原提成=sum(x['comm_c'] for x in basis['sales']),工资报销=sum(x['amount'] for x in basis['expenses']))
    values,version=rules.compute('payroll',variables,rule_id)
    return {k:round(v,2) for k,v in values.items()},variables,version

def snapshot(employee,month,basis,record):
    return r.signer().dumps({'employee':employee,'month':month,'basis':r.digest(basis),'record':r.digest(record) if record else None})

@bp.route('/payroll',methods=['GET','POST'])
@auth.login_required
def payroll():
    employee=request.values.get('employee','');month=request.values.get('month',datetime.date.today().strftime('%Y-%m'))
    names=db.names_of('staff');employee=employee or (names[0] if names else '')
    inputs=dict(DEFAULT_INPUTS);record=None;outputs={};variables={};basis={};version=rules.rule('payroll')['id'];token=''
    try:
        with r.transaction() as c:
            found=c.execute('SELECT * FROM payroll_records WHERE employee=? AND month=?',(employee,month)).fetchone()
            record=dict(found) if found else None
            profile=c.execute('SELECT inputs_json FROM employee_pay_profiles WHERE employee=?',(employee,)).fetchone()
            if profile:inputs.update(json.loads(profile[0]))
            if record:inputs.update(json.loads(record['inputs_json']));version=record['rule_version']
            month_issue=''
            try:payroll_month_guard(c,employee,month)
            except ValueError as problem:
                if request.method=='POST':raise
                month_issue=str(problem);flash(month_issue,'error')
            if record and (record['status']!='草稿' or month_issue):basis=json.loads(record['basis_json'])
            elif not month_issue:basis=payroll_basis(c,employee,month,record['id'] if record else None)
            if request.method=='POST':
                if not employee or employee not in r.preserve_choices(names,[record['employee']] if record else []):raise ValueError('请选择已登记的人员。')
                if record and record['status']!='草稿':raise ValueError('已确认或已发放的工资不能直接改动，先将已确认工资退回草稿。')
                inputs={key:r.number(request.form.get(key)) for key in FIELDS};inputs['mode']=request.form.get('mode','')
                if inputs['mode'] not in rules.MODES:raise ValueError('请选择计薪方式。')
                if inputs['days']<0 or inputs['overtime_hours']<0:raise ValueError('出勤天数和加班小时不能为负数。')
                if request.form.get('current_rules') or not record:version=rules.rule('payroll',c=c)['id']
                action=request.form.get('act','preview')
                if action=='save':
                    try:previous=r.signer().loads(request.form.get('snapshot',''))
                    except Exception:raise r.Conflict('请先选择人员和月份、试算，再保存工资。')
                    expected={'employee':employee,'month':month,'basis':r.digest(basis),'record':r.digest(record) if record else None}
                    if previous!=expected:raise r.Conflict('销售、报销或工资记录已有变化，请重新试算后保存。')
                outputs,variables,version=salary_compute(inputs,basis,version)
                if action=='save':
                    vals=dict(employee=employee,month=month,inputs_json=json.dumps(inputs,ensure_ascii=False),outputs_json=json.dumps(outputs,ensure_ascii=False),basis_json=json.dumps(basis,ensure_ascii=False),basis_hash=r.digest(basis),rule_version=version,status='草稿',note=request.form.get('note',''),updated_at=db.now_str())
                    pid=r.write_row(c,'payroll_records',vals,record)
                    c.execute('DELETE FROM payroll_expenses WHERE payroll_id=?',(pid,))
                    for exp in basis['expenses']:c.execute('INSERT INTO payroll_expenses(payroll_id,expense_id) VALUES(?,?)',(pid,exp['id']))
                    if request.form.get('save_profile'):c.execute('INSERT INTO employee_pay_profiles(employee,inputs_json,updated_at) VALUES(?,?,?) ON CONFLICT(employee) DO UPDATE SET inputs_json=excluded.inputs_json,updated_at=excluded.updated_at',(employee,json.dumps(inputs,ensure_ascii=False),db.now_str()))
                    flash('工资草稿已保存，已固定销售依据及规则版本。','ok')
                    return redirect(url_for('finance.payroll',employee=employee,month=month))
            if record and (record['status']!='草稿' or month_issue):
                outputs=json.loads(record['outputs_json'])
                basis=json.loads(record['basis_json'])
            elif not outputs and not month_issue:outputs,variables,version=salary_compute(inputs,basis,version)
            if not month_issue:token=snapshot(employee,month,basis,record)
    except (ValueError,sqlite3.Error) as e:flash(str(e),'error')
    rows=[dict(x) for x in db.query('SELECT * FROM payroll_records WHERE month=? ORDER BY employee',(month,))]
    for x in rows:x['outputs']=json.loads(x['outputs_json'])
    return render_template('payroll.html',names=r.preserve_choices(names,[employee]),employee=employee,month=month,inputs=inputs,fields=FIELDS,
                           modes=rules.MODES,record=record,outputs=outputs,variables=variables,basis=basis,version=version,snapshot=token,rows=rows)

@bp.post('/payroll/<int:rid>/status')
@auth.login_required
def payroll_status(rid):
    old={}
    try:
        with r.transaction() as c:
            old=r.existing(c,'payroll_records',rid);r.check_token('payroll_records',old,request.form.get('snapshot'))
            payroll_month_guard(c,old['employee'],old['month'])
            target=request.form.get('status')
            allowed={'草稿':['已确认'],'已确认':['草稿','已发放'],'已发放':[]}
            if target not in allowed[old['status']]:raise ValueError('不允许这个工资状态变更。')
            if target in ['已确认','已发放']:
                basis=payroll_basis(c,old['employee'],old['month'],rid)
                if r.digest(basis)!=old['basis_hash']:raise r.Conflict('销售或报销已变化，先退回草稿重新试算并保存。')
            if target=='已发放':
                if json.loads(old['outputs_json'])['本次支付']<0:raise ValueError('支付金额为负，请先核对扣款和规则。')
                expenses=[dict(x) for x in c.execute('SELECT e.* FROM expenses e JOIN payroll_expenses p ON p.expense_id=e.id WHERE p.payroll_id=?',(rid,))]
                for expense in expenses:
                    if expense['status']!='已审核':raise r.Conflict('随工资报销状态发生变化，请重新核对。')
                    r.write_row(c,'expenses',dict(status='已支付',updated_at=db.now_str()),expense)
            r.write_row(c,'payroll_records',dict(status=target,updated_at=db.now_str()),old)
        flash('工资状态已更新。','ok')
    except (ValueError,sqlite3.Error) as e:flash(str(e),'error')
    return redirect(url_for('finance.payroll',employee=old.get('employee',''),month=old.get('month',datetime.date.today().strftime('%Y-%m'))))

@bp.get('/payroll/export.csv')
@auth.login_required
def payroll_export():
    month=request.args.get('month',datetime.date.today().strftime('%Y-%m'));rows=db.query('SELECT * FROM payroll_records WHERE month=? ORDER BY employee',(month,))
    data=io.StringIO();writer=csv.writer(data);writer.writerow(['月份','人员','计薪方式','应发工资','扣款','实发工资','工资报销','本次支付','状态','规则版本'])
    for row in rows:
        inputs=json.loads(row['inputs_json']);outputs=json.loads(row['outputs_json']);writer.writerow([csv_export_cell(value) for value in [month,row['employee'],inputs['mode'],outputs['应发工资'],outputs['工资扣款'],outputs['实发工资'],outputs['本次支付']-outputs['实发工资'],outputs['本次支付'],row['status'],row['rule_version']]])
    return Response('\ufeff'+data.getvalue(),mimetype='text/csv; charset=utf-8',headers={'Content-Disposition':'attachment; filename=payroll_'+month+'.csv'})

@bp.route('/expenses',methods=['GET','POST'])
@auth.login_required
def expenses():
    edit=None;created_receipt=None
    try:
        if request.method=='POST':
            with r.transaction() as c:
                rid=request.form.get('id');edit=r.existing(c,'expenses',int(rid)) if rid else None
                if edit:
                    r.check_token('expenses',edit,request.form.get('snapshot'))
                    if edit['status'] not in ['草稿','已退回']:raise ValueError('已提交、已审核或已支付的报销不能直接修改。')
                    if c.execute('SELECT payroll_id FROM payroll_expenses WHERE expense_id=?',(edit['id'],)).fetchone():raise ValueError('此报销已关联工资，请先在工资草稿重新试算取消关联。')
                nums={key:r.number(request.form.get(key)) for key in ['ticket','allowance','personal']}
                if min(nums.values())<0:raise ValueError('票据金额、补贴和个人承担不能为负数。')
                version=edit['rule_version'] if edit and not request.form.get('current_rules') else None
                result,version=rules.compute('expense',{'票据金额':nums['ticket'],'补贴':nums['allowance'],'个人承担':nums['personal']},version)
                if result['报销金额']<0:raise ValueError('报销金额不能为负，请核对个人承担或规则。')
                employee=request.form.get('employee','').strip();purpose=request.form.get('purpose','').strip()
                if not employee or not purpose:raise ValueError('人员和报销事由不能为空。')
                payout=request.form.get('payout','单独支付')
                if payout not in ['单独支付','随工资']:raise ValueError('请选择支付方式。')
                receipt=edit['receipt_path'] if edit else '';upload=request.files.get('receipt')
                if upload and upload.filename:
                    suffix=pathlib.Path(upload.filename).suffix.lower()
                    if suffix not in ['.pdf','.png','.jpg','.jpeg']:raise ValueError('凭证仅支持 PDF、PNG 或 JPG。')
                    folder=r.config.data_dir()/'报销凭证';folder.mkdir(exist_ok=True);created_receipt=folder/(uuid.uuid4().hex+suffix)
                    upload.save(created_receipt)
                    if created_receipt.stat().st_size>12*1024*1024:raise ValueError('凭证不能超过 12MB。')
                    receipt=str(created_receipt.relative_to(r.config.data_dir()))
                vals=dict(date=r.validate_date(request.form.get('date')),employee=employee,category=request.form.get('category','其他'),purpose=purpose,**nums,amount=round(result['报销金额'],2),rule_version=version,payout=payout,status='草稿',receipt_path=receipt,note=request.form.get('note',''),updated_at=db.now_str())
                r.write_row(c,'expenses',vals,edit)
            flash('报销草稿已保存。','ok');return redirect(url_for('finance.expenses'))
        if request.args.get('edit'):edit=dict(db.query('SELECT * FROM expenses WHERE id=?',(request.args['edit'],),one=True) or {}) or None
    except (ValueError,sqlite3.Error) as e:
        if created_receipt and created_receipt.exists():created_receipt.unlink()
        flash(str(e),'error')
    where='';args=[]
    for field in ['employee','status']:
        if request.args.get(field):where+=(' AND ' if where else ' WHERE ')+field+'=?';args.append(request.args[field])
    rows=[dict(x) for x in db.query('SELECT * FROM expenses'+where+' ORDER BY date DESC,id DESC',tuple(args))]
    return render_template('expenses.html',rows=rows,edit=edit,names=r.preserve_choices(db.names_of('staff'),[edit['employee']] if edit else []),
                           categories=['交通','餐饮','住宿','办公','采购','差旅','其他'],total=sum(x['amount'] for x in rows),today=datetime.date.today().isoformat(),transitions=TRANSITIONS)

@bp.post('/expenses/<int:rid>/status')
@auth.login_required
def expense_status(rid):
    try:
        with r.transaction() as c:
            old=r.existing(c,'expenses',rid);r.check_token('expenses',old,request.form.get('snapshot'));target=request.form.get('status')
            if target not in TRANSITIONS[old['status']]:raise ValueError('不允许这个报销状态变更。')
            if c.execute('SELECT payroll_id FROM payroll_expenses WHERE expense_id=?',(rid,)).fetchone():raise ValueError('此费用已关联工资，状态由工资发放更新；请先核对工资草稿。')
            if target=='已支付' and old['payout']=='随工资':raise ValueError('随工资支付的报销，请到人员工资中发放。')
            r.write_row(c,'expenses',dict(status=target,updated_at=db.now_str()),old)
        flash('报销状态已更新。','ok')
    except (ValueError,sqlite3.Error) as e:flash(str(e),'error')
    return redirect(url_for('finance.expenses'))

@bp.get('/expenses/<int:rid>/receipt')
@auth.login_required
def expense_receipt(rid):
    row=db.query('SELECT receipt_path FROM expenses WHERE id=?',(rid,),one=True)
    if not row or not row['receipt_path']:return '未上传凭证',404
    root=(r.config.data_dir()/'报销凭证').resolve();path=(r.config.data_dir()/row['receipt_path']).resolve()
    if not path.is_relative_to(root) or not path.is_file():return '凭证文件不存在',404
    return send_file(path,as_attachment=True,download_name='凭证_'+str(rid)+path.suffix)

@bp.get('/expenses/export.csv')
@auth.login_required
def expenses_export():
    where='';args=[]
    for field in ['employee','status']:
        if request.args.get(field):where+=(' AND ' if where else ' WHERE ')+field+'=?';args.append(request.args[field])
    data=io.StringIO();w=csv.writer(data);w.writerow(['日期','人员','类别','事由','票据金额','补贴','个人承担','报销金额','支付方式','状态','规则版本'])
    for row in db.query('SELECT * FROM expenses'+where+' ORDER BY date,id',tuple(args)):w.writerow([csv_export_cell(row[x]) for x in ['date','employee','category','purpose','ticket','allowance','personal','amount','payout','status','rule_version']])
    return Response('\ufeff'+data.getvalue(),mimetype='text/csv; charset=utf-8',headers={'Content-Disposition':'attachment; filename=expenses.csv'})
