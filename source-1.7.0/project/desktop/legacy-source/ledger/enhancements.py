import pathlib,json,datetime,sqlite3,hashlib,shutil,csv,io,uuid
from flask import Blueprint,request,render_template,redirect,url_for,flash,jsonify,Response,send_file,abort
from app import db,auth,config,calc,views_source
import repairs as r
import rule_engine as rules
import source_sync as sync
import finance

bp=Blueprint('enhanced',__name__)
_legacy_sale=r.calculate_sale

def formula_sale(rec):
    rec=dict(rec);version=rec.get('_rule_id',rec.get('rule_version'))
    if version==0:
        value=_legacy_sale(rec);value['_rule_id']=0;return value
    values={'克重':r.number(rec.get('weight')),'销售克价':r.number(rec.get('sell_gram_price')),'工费':r.number(rec.get('labor')),
            '成本':r.number(rec.get('cost')),'实际到账':r.number(rec.get('received')),'点差':r.number(rec.get('spread'),r.new_spread(rec))}
    computed,version=rules.compute('sales',values,version)
    mapping={'amount':'销售金额','cost_gram_price':'成本金价','profit':'公司利润','gross_rate':'毛利率','comm_cost':'提成成本','comm':'提成','comm_profit':'提成利润'}
    result={key:round(computed[name],6 if key=='gross_rate' else 4 if key=='cost_gram_price' else 2) for key,name in mapping.items()}
    result['gram_price']=round(result['amount']/values['克重'],6) if values['克重'] else 0;result['_rule_id']=version;return result

def financial_values(rec,old=None):
    rec=dict(rec);force=bool(request.form.get('current_rules')) if request else False
    if old and not force and not any(r.number(rec.get(k))!=r.number(old.get(k)) for k in r.FINANCIAL-{'spread'}) and ('spread' not in rec or r.number(rec['spread'])==r.old_spread(old)):
        return {k:old[k] for k in r.SALE_DERIVED}
    if not r.has_value(rec,'spread'):rec['spread']=r.old_spread(old) if old else r.new_spread(rec)
    rec['_rule_id']=None if force or not old else old.get('rule_version',0)
    computed=formula_sale(rec)
    return {**{col:computed[src] for col,src in r.SALE_DERIVED.items()},'rule_version':computed['_rule_id']}

def formula_stock(item):
    values=dict(item);computed,version=rules.compute('stock',{'售价':r.number(values.get('sell_price')),'成本':r.number(values.get('cost')),'克重':r.number(values.get('weight'))},values.get('rule_version'))
    if isinstance(item,dict):item['rule_version']=version
    return {'profit':round(computed['毛利'],2)}

def archive(path):
    path=pathlib.Path(path);sha=hashlib.sha256(path.read_bytes()).hexdigest();folder=config.data_dir()/'原表归档';folder.mkdir(exist_ok=True)
    target=folder/(sha+path.suffix.lower())
    if not target.exists():shutil.copy2(path,target)
    return target

def doc_path(doc):
    path=pathlib.Path(doc['path']);return path if path.is_absolute() else config.data_dir()/path

def register_file(path,name,c):
    target=archive(path);doc=sync.register(target,name,c)
    c.execute('UPDATE source_documents SET path=? WHERE id=?',(str(target.relative_to(config.data_dir())),doc));return doc

@bp.get('/overview')
@auth.login_required
def overview():
    month=request.args.get('month',datetime.date.today().strftime('%Y-%m'))
    try:start,end=finance.month_bounds(month)
    except ValueError:start,end=finance.month_bounds(datetime.date.today().strftime('%Y-%m'))
    sales=dict(db.query('SELECT COUNT(*) count,COALESCE(SUM(amount_c),0) amount,COALESCE(SUM(received),0) received,COALESCE(SUM(profit_c),0) profit,COALESCE(SUM(comm_c),0) commission FROM sales WHERE date>=? AND date<=?',(start,end),one=True))
    wages=[dict(x) for x in db.query("SELECT outputs_json FROM payroll_records WHERE month=? AND status IN ('已确认','已发放')",(month,))]
    wage_cost=sum(json.loads(x['outputs_json'])['应发工资'] for x in wages)
    expense_cost=db.query("SELECT COALESCE(SUM(amount),0) value FROM expenses WHERE date>=? AND date<=? AND status IN ('已审核','已支付')",(start,end),one=True)['value']
    result,version=rules.compute('overview',{'销售利润':sales['profit'],'工资成本':wage_cost,'报销费用':expense_cost})
    inventory=db.query('SELECT remark FROM stock_items');inventory_count=sum(r.stock.is_in_stock(x['remark']) for x in inventory)
    source_counts=db.query('SELECT COUNT(*) count FROM source_documents',one=True)['count']
    pending=db.query("SELECT COUNT(*) count FROM source_rows WHERE classification IN ('待核对','待选择单位','未识别','现有账目待匹配') OR normalized_json LIKE '%existing_ids%'",one=True)['count']
    return render_template('overview.html',month=month,sales=sales,wage_cost=wage_cost,expense_cost=expense_cost,net=result['经营结余'],version=version,
                           inventory_count=inventory_count,total_inventory=len(inventory),source_counts=source_counts,pending=pending,
                           recent=db.query('SELECT * FROM sales ORDER BY id DESC LIMIT 8'))

@bp.route('/rules',methods=['GET','POST'])
@auth.login_required
def rule_page():
    domain=request.values.get('domain','sales')
    if domain not in rules.DEFAULTS:abort(404)
    selected=rules.rule(domain);trial={};inputs={k:'固定月薪' if k=='计薪方式' else 1 for k in rules.INPUTS[domain]}
    if request.method=='POST':
        steps=[(name,request.form.get('formula_'+name,'')) for name,_ in rules.DEFAULTS[domain]]
        try:
            rules.validate(domain,steps)
            inputs={k:request.form.get('input_'+k,'固定月薪') if k=='计薪方式' else r.number(request.form.get('input_'+k),1) for k in rules.INPUTS[domain]}
            allowed=set(inputs);env=dict(inputs)
            for name,text in steps:
                value=rules.evaluate(rules.parse(text,allowed),env)
                if not isinstance(value,(int,float)):raise ValueError(name+' 的结果不是数字。')
                trial[name]=value;env[name]=value;allowed.add(name)
            if request.form.get('act')=='save':
                reason=request.form.get('reason','').strip()
                if not reason:raise ValueError('请填写本次规则调整说明。')
                with r.transaction() as c:
                    old=dict(c.execute('SELECT * FROM formula_sets WHERE domain=? ORDER BY id DESC LIMIT 1',(domain,)).fetchone())
                    r.check_token('formula_sets',old,request.form.get('snapshot'))
                    rid=c.execute('INSERT INTO formula_sets(domain,formulas,actor,created_at,reason) VALUES(?,?,?,?,?)',(domain,json.dumps(steps,ensure_ascii=False),auth.current_user()['username'],db.now_str(),reason)).lastrowid
                    after=dict(c.execute('SELECT * FROM formula_sets WHERE id=?',(rid,)).fetchone());r.audit(c,'修改计算规则','formula_sets',rid,old,after)
                flash('规则版本已保存。新记录使用新规则；历史记录保留原版本。','ok');return redirect(url_for('enhanced.rule_page',domain=domain))
            selected['formulas']=steps
        except (ValueError,sqlite3.Error) as e:flash(str(e),'error');selected['formulas']=steps
    row=db.query('SELECT * FROM formula_sets WHERE id=?',(selected['id'],),one=True)
    history=db.query('SELECT id,actor,created_at,reason FROM formula_sets WHERE domain=? ORDER BY id DESC LIMIT 12',(domain,))
    return render_template('rules.html',domain=domain,titles=rules.TITLES,selected=selected,inputs=inputs,trial=trial,history=history,snapshot=r.row_token('formula_sets',row),modes=rules.MODES)

@bp.get('/api/calculate')
@auth.login_required
def calculate_api():
    try:
        domain=request.args.get('domain','sales')
        if domain=='sales':
            rec={key:r.number(request.args.get(key)) for key in r.SALE_NUMBERS}
            rec['template']=request.args.get('template','');rec['product']=request.args.get('product','')
            if not request.args.get('spread') or rec['spread']==0:rec['spread']=r.new_spread(rec)
            if request.args.get('id'):
                old=db.query('SELECT * FROM sales WHERE id=?',(request.args['id'],),one=True)
                if old and not request.args.get('current_rules'):
                    rec['_rule_id']=old['rule_version']
                    if not request.args.get('spread') or rec['spread']==0:rec['spread']=r.old_spread(old)
            result=formula_sale(rec);return jsonify(ok=True,values=result)
        if domain=='material':
            result,version=rules.compute(domain,{key:r.number(request.args.get(key)) for key in rules.INPUTS[domain]})
            return jsonify(ok=True,values=result,version=version)
        return jsonify(ok=False,error='没有这个计算类目。'),400
    except ValueError as e:return jsonify(ok=False,error=str(e)),400

@bp.route('/rules/recalculate',methods=['GET','POST'])
@auth.login_required
def recalculate():
    domain=request.values.get('domain','sales')
    if domain not in ['sales','stock']:abort(404)
    table='sales' if domain=='sales' else 'stock_items';datefield='date' if domain=='sales' else 'in_date'
    start=request.values.get('start','');end=request.values.get('end','');where=' WHERE 1=1';args=[]
    for operator,value in [('>=',start),('<=',end)]:
        if value:r.validate_date(value);where+=' AND '+datefield+operator+'?';args.append(value)
    current=rules.rule(domain);rows=[dict(x) for x in db.query('SELECT * FROM '+table+where+' ORDER BY id LIMIT 500',tuple(args))];preview=[]
    for old in rows:
        if domain=='sales':
            rec=dict(old,spread=r.old_spread(old),_rule_id=current['id']);calcvals=formula_sale(rec);new={col:calcvals[key] for col,key in r.SALE_DERIVED.items()}
        else:new={'profit_c':rules.compute('stock',{'售价':old['sell_price'],'成本':old['cost'],'克重':old['weight']},current['id'])[0]['毛利']}
        preview.append({'old':old,'new':new,'token':r.row_token(table,old)})
    if request.method=='POST':
        try:
            chosen=request.form.getlist('ids')
            if not chosen:raise ValueError('请勾选需要重算的记录。')
            reason=request.form.get('reason','').strip()
            if not reason:raise ValueError('请填写重算原因。')
            if int(request.form.get('rule_id',0))!=current['id']:raise r.Conflict('当前规则已更新，请重新预览。')
            allowed={str(x['old']['id']):x for x in preview}
            with r.transaction() as c:
                latest=rules.rule(domain,c=c)
                if latest['id']!=current['id']:raise r.Conflict('规则已被修改，请重新预览。')
                for rid in chosen:
                    if rid not in allowed:raise ValueError('记录不在当前筛选范围内。')
                    old=r.existing(c,table,int(rid));r.check_token(table,old,request.form.get('snapshot_'+rid))
                    values=dict(allowed[rid]['new'],rule_version=current['id']);r.write_row(c,table,values,old)
                r.audit(c,'按新规则重算',table,None,{'记录':chosen},{'规则版本':current['id'],'原因':reason})
            flash('所选记录已重算；原表仍保留，差异可在来源对账查看。','ok');return redirect(url_for('enhanced.recalculate',domain=domain,start=start,end=end))
        except (ValueError,sqlite3.Error) as e:flash(str(e)+' 整批没有写入。','error')
    return render_template('recalculate.html',domain=domain,start=start,end=end,preview=preview,version=current['id'],title=rules.TITLES[domain])

def documents():return [dict(x) for x in db.query('SELECT * FROM source_documents ORDER BY id DESC')]

@bp.get('/sources')
@auth.login_required
def source_page():
    docs=documents();selected=request.args.get('doc',str(docs[0]['id']) if docs else '')
    doc=next((x for x in docs if str(x['id'])==str(selected)),None)
    summary=[];warnings=[]
    if doc:
        summary=[dict(x) for x in db.query('SELECT sheet,kind,classification,COUNT(*) count FROM source_rows WHERE document_id=? GROUP BY sheet,kind,classification ORDER BY sheet',(doc['id'],))]
        warnings=[dict(x) for x in db.query("SELECT * FROM source_rows WHERE document_id=? AND (classification IN ('待选择单位','待核对') OR warning!='') ORDER BY sheet,row_no LIMIT 200",(doc['id'],))]
        for row in warnings:
            row['snapshot']=r.row_token('source_rows',row)
            row['normalized']=json.loads(row['normalized_json']);row['raw']=json.loads(row['raw_json'])
            if row['classification']=='现有账目待匹配':
                table='sales' if row['kind']=='sales' else 'stock_items'
                row['candidates']=[dict(x) for x in db.query('SELECT * FROM '+table+' WHERE product=? AND order_no=?',(row['normalized'].get('product',''),row['normalized'].get('order_no','')))]
    return render_template('sources.html',docs=docs,doc=doc,summary=summary,warnings=warnings,doc_token=r.signer().dumps(doc['sha256']) if doc else '')

@bp.post('/sources/upload')
@auth.login_required
def source_upload():
    temp=None
    try:
        upload=request.files.get('file')
        if not upload or not upload.filename:raise ValueError('请选择原表文件。')
        suffix=pathlib.Path(upload.filename).suffix.lower()
        if suffix not in ['.xlsx','.xlsm']:raise ValueError('导入仅支持 .xlsx 和 .xlsm。')
        folder=config.data_dir()/'原表归档';folder.mkdir(exist_ok=True);temp=folder/(uuid.uuid4().hex+suffix);upload.save(temp)
        with r.transaction() as c:doc=register_file(temp,pathlib.Path(upload.filename).name,c);r.audit(c,'登记原始表格','source_documents',doc,None,{'文件':pathlib.Path(upload.filename).name})
        flash('原表已归档。先检查预览与待核对项，再导入账目。','ok')
        return redirect(url_for('transfer.index' if request.form.get('origin')=='transfer' else 'enhanced.source_page',doc=doc))
    except (ValueError,sqlite3.Error,Exception) as e:flash('原表处理失败：'+str(e),'error')
    finally:
        if temp and temp.exists():temp.unlink()
    return redirect(url_for('enhanced.source_page'))

@bp.post('/sources/<int:doc>/import')
@auth.login_required
def source_import(doc):
    try:
        with r.transaction() as c:
            record=c.execute('SELECT * FROM source_documents WHERE id=?',(doc,)).fetchone()
            if not record or r.signer().loads(request.form.get('doc_token',''))!=record['sha256']:raise r.Conflict('原表预览过期，请重新载入。')
            choices={key[len('unit_'):]:value for key,value in request.form.items() if key.startswith('unit_')}
            selected=request.form.getlist('sheets')
            if not selected:raise ValueError('请勾选需要导入的工作表。')
            counts=sync.import_document(doc,c,choices,selected)
            r.audit(c,'原表导入','source_documents',doc,None,counts)
        flash('导入完成：'+json.dumps(counts,ensure_ascii=False)+'。未明确的单元格保留待核对，不会被默认为 0。','ok')
    except Exception as e:flash('本次没有导入：'+str(e),'error')
    return redirect(url_for('enhanced.source_page',doc=doc))

@bp.post('/sources/row/<int:rid>/confirm')
@auth.login_required
def source_confirm(rid):
    doc=0
    try:
        with r.transaction() as c:
            old=r.existing(c,'source_rows',rid);doc=old['document_id'];r.check_token('source_rows',old,request.form.get('snapshot'))
            normalized=json.loads(old['normalized_json'])
            if '不能识别数字' in old['warning'] or '无限值' in old['warning']:
                raise ValueError('金额或克重不能识别，请先修正原表再上传；不能默认按 0 导入。')
            if request.form.get('ignore_date'):
                normalized.pop('sell_date',None)
            elif request.form.get('sell_date'):normalized['sell_date']=r.validate_date(request.form['sell_date'])
            if not normalized.get('product'):raise ValueError('这一行缺少商品，不能直接确认为业务明细。')
            if old['kind']=='sales' and not normalized.get('date'):raise ValueError('销售日期缺失，请先补充来源映射。')
            c.execute('UPDATE source_rows SET normalized_json=?,classification=?,warning=? WHERE id=?',(sync.j(normalized),'业务明细','操作员已确认映射；原始行保留。',rid))
            r.audit(c,'确认原表映射','source_rows',rid,old,{'规范值':normalized})
        flash('这行映射已确认，可以再次执行导入。','ok')
    except Exception as e:flash(str(e),'error')
    return redirect(url_for('enhanced.source_page',doc=doc))

@bp.get('/sources/<int:doc>/reconcile')
@auth.login_required
def reconcile(doc):
    record=db.query('SELECT * FROM source_documents WHERE id=?',(doc,),one=True)
    if not record:abort(404)
    with r.transaction() as c:report=sync.reconcile(doc,c)
    if request.args.get('export'):
        data=io.StringIO();w=csv.writer(data);w.writerow(['来源位置','系统表','系统编号','结果','字段','原表值','系统值'])
        for item in report['items']:
            for diff in item['differences'] or [{'field':'','source':'','system':''}]:w.writerow(['；'.join(item['addresses']),item['table'],item['id'],'一致' if item['matched'] else '不一致',diff['field'],diff['source'],diff['system']])
        for item in report['pending']:w.writerow([item['sheet']+' 第'+str(item['row_no'])+'行','','','待对应',item['classification'],item['warning'],''])
        return Response('\ufeff'+data.getvalue(),mimetype='text/csv; charset=utf-8',headers={'Content-Disposition':'attachment; filename=reconciliation.csv'})
    return render_template('reconcile_new.html',doc=record,report=report)

@bp.get('/sources/record/<table>/<int:rid>')
@auth.login_required
def provenance(table,rid):
    if table not in ['sales','stock_items','material_stock']:abort(404)
    rows=db.query('SELECT s.*,l.part,d.name FROM source_links l JOIN source_rows s ON s.id=l.source_row_id JOIN source_documents d ON d.id=s.document_id WHERE l.ledger_table=? AND l.ledger_id=?',(table,rid))
    values=[{**dict(x),'raw':json.loads(x['raw_json']),'formulas':json.loads(x['formula_json'])} for x in rows]
    return render_template('provenance.html',table=table,rid=rid,rows=values)

@bp.post('/sources/row/<int:rid>/link')
@auth.login_required
def source_link_existing(rid):
    doc=0
    try:
        with r.transaction() as c:
            source=r.existing(c,'source_rows',rid);doc=source['document_id'];r.check_token('source_rows',source,request.form.get('snapshot'))
            if source['classification']!='现有账目待匹配' or source['kind'] not in ['sales','stock']:raise ValueError('这一行不是旧账待匹配状态。')
            table='sales' if source['kind']=='sales' else 'stock_items';ledger=r.existing(c,table,int(request.form.get('ledger_id','0')))
            normalized=json.loads(source['normalized_json'])
            if ledger['product']!=normalized.get('product','') or ledger['order_no']!=normalized.get('order_no',''):raise ValueError('所选记录不属于当前候选。')
            if c.execute('SELECT id FROM source_links WHERE source_row_id=?',(rid,)).fetchone():raise r.Conflict('这行已经建立来源对应，请重新载入。')
            if c.execute('SELECT l.id FROM source_links l JOIN source_rows s ON s.id=l.source_row_id WHERE l.ledger_table=? AND l.ledger_id=? AND s.document_id=?',(table,ledger['id'],doc)).fetchone():
                raise r.Conflict('所选旧账已被这份原表的另一行关联，请选择其他记录。')
            expected={k:v for k,v in normalized.items() if k in ledger}
            c.execute('INSERT INTO source_links(source_row_id,part,ledger_table,ledger_id,expected_json) VALUES(?,?,?,?,?)',(rid,'record',table,ledger['id'],sync.j(expected)))
            c.execute('UPDATE source_rows SET classification=?,warning=? WHERE id=?',('业务明细','操作员手动关联旧账；不同字段会在对账页显示。',rid))
            r.audit(c,'手动关联原表旧账','source_rows',rid,None,{'系统表':table,'编号':ledger['id']})
        flash('旧账来源已关联，没有修改原金额。请到对账页核对差异。','ok')
    except Exception as e:flash(str(e),'error')
    return redirect(url_for('enhanced.source_page',doc=doc))

@bp.post('/sources/row/<int:rid>/material-link')
@auth.login_required
def source_link_material(rid):
    doc=0
    try:
        with r.transaction() as c:
            source=r.existing(c,'source_rows',rid);doc=source['document_id'];r.check_token('source_rows',source,request.form.get('snapshot'))
            value=json.loads(source['normalized_json']);column=int(request.form.get('column','0'))
            cell=next((x for x in value.get('cells',[]) if x['column']==column),None)
            if source['kind']!='material' or not cell or not cell.get('existing_ids'):raise ValueError('这格没有旧存料待匹配项。')
            target=r.existing(c,'material_stock',int(request.form.get('ledger_id','0')))
            if target['date']!=value['date'] or target['supplier']!=cell['supplier']:raise ValueError('请选择同一天、同一家供货商的候选旧记录。')
            count=0
            for row in c.execute("SELECT * FROM source_rows WHERE document_id=? AND kind='material'",(doc,)).fetchall():
                normalized=json.loads(row['normalized_json'])
                if normalized.get('date')!=value['date']:continue
                for atom in normalized.get('cells',[]):
                    unit=atom.get('unit') or normalized.get('unit')
                    if atom['supplier']!=cell['supplier'] or unit not in ['grams','amount']:continue
                    if c.execute('SELECT id FROM source_links WHERE source_row_id=? AND part=?',(row['id'],str(atom['column']))).fetchone():continue
                    expected={'date':value['date'],'supplier':cell['supplier'],unit:atom['value']}
                    c.execute('INSERT INTO source_links(source_row_id,part,ledger_table,ledger_id,expected_json) VALUES(?,?,?,?,?)',(row['id'],str(atom['column']),'material_stock',target['id'],sync.j(expected)));count+=1
                    atom.pop('existing_ids',None);atom.pop('warning',None)
                c.execute('UPDATE source_rows SET normalized_json=?,warning=? WHERE id=?',(sync.j(normalized),'操作员已关联存料旧账；差异在对账页查看。',row['id']))
            if not count:raise r.Conflict('这些格已经关联，请重新载入。')
            r.audit(c,'手动关联原表存料旧账','source_rows',rid,None,{'旧记录':target['id'],'关联格数':count})
        flash('存料来源已关联，未改变旧记录金额。请查看对账差异。','ok')
    except Exception as e:flash(str(e),'error')
    return redirect(url_for('enhanced.source_page',doc=doc))

def configure(app):
    r.TABLES.update(['payroll_records','expenses'])
    with r.transaction() as c:
        rules.initialize(c);c.executescript(sync.SCHEMA+finance.SCHEMA)
        for table in ['sales','stock_items']:
            fields={x[1] for x in c.execute('PRAGMA table_info('+table+')')}
            if 'rule_version' not in fields:c.execute('ALTER TABLE '+table+' ADD COLUMN rule_version INTEGER NOT NULL DEFAULT 0')
        originals=config.data_dir()/'上传的原表'
        if originals.exists():
            for path in originals.iterdir():
                if path.is_file() and path.suffix.lower() in ['.xlsx','.xlsm']:
                    register_file(path,path.name,c)
    r.calculate_sale=formula_sale;r.financial_values=financial_values;calc.calc_sale=formula_sale
    r.sales.calc_sale=formula_sale;r.sheet.calc_sale=formula_sale;r.sheet.SHEETS['sales']['calc']=formula_sale
    calc.calc_stock=formula_stock;r.sheet.calc_stock=formula_stock;r.stock.calc_stock=formula_stock;r.sheet.SHEETS['stock']['calc']=formula_stock
    app.register_blueprint(bp);app.register_blueprint(finance.bp)
    app.view_functions['home.index']=overview
    app.view_functions['source.index']=source_page
    app.view_functions['source.compare']=auth.login_required(lambda:redirect(url_for('enhanced.reconcile',doc=documents()[0]['id'])) if documents() else redirect(url_for('enhanced.source_page')))
    @app.context_processor
    def labels():return dict(rule_titles=rules.TITLES)
    import workbooks,transfer,external_sync
    workbooks.configure(app)
    app.register_blueprint(transfer.bp)
    external_sync.configure(app)
    import presentation,bundled_source,inventory_dashboard,reports,annotations
    presentation.configure(app)
    bundled_source.configure(app)
    inventory_dashboard.configure(app)
    reports.configure(app)
    annotations.configure(app)
