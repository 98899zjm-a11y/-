"""Editable workbook working copies; the archived upload is immutable."""
import collections, contextlib, contextvars, csv, datetime, io, json, math, pathlib, re, sqlite3, zipfile,copy
import xml.etree.ElementTree as ET
from openpyxl.styles.numbers import is_date_format,BUILTIN_FORMATS
from flask import Blueprint, abort, jsonify, render_template, request, send_file,has_request_context
from app import auth, config, db, importer
import repairs as r
import source_sync as sync
import enhancements as enhanced
from excel_formula import ExcelEngine
from presentation import fmt2

bp=Blueprint('workbooks',__name__)
SCHEMA='''
CREATE TABLE IF NOT EXISTS workbook_state(document_id INTEGER PRIMARY KEY,revision INTEGER NOT NULL DEFAULT 0,algorithm TEXT NOT NULL DEFAULT 'excel',updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS workbook_rows(source_row_id INTEGER PRIMARY KEY,cells_json TEXT NOT NULL,formulas_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS workbook_changes(id INTEGER PRIMARY KEY,document_id INTEGER NOT NULL,revision INTEGER NOT NULL,actor TEXT NOT NULL,at TEXT NOT NULL,detail TEXT NOT NULL);
'''
M='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
NS={'m':M}
ET.register_namespace('',M)
_write=None
_delete=None
_importing=contextvars.ContextVar('workbook_importing',default=False)

def dump(x):return json.dumps(x,ensure_ascii=False,allow_nan=False)
def letter(col):
    result=''
    while col:col,n=divmod(col-1,26);result=chr(n+65)+result
    return result
def coord(text):
    m=re.fullmatch(r'([A-Z]{1,3})([1-9][0-9]*)',text.upper())
    if not m:raise ValueError('单元格地址不正确。')
    col=0
    for ch in m[1]:col=col*26+ord(ch)-64
    return int(m[2]),col
def getdoc(c,doc):
    row=c.execute('SELECT * FROM source_documents WHERE id=?',(doc,)).fetchone()
    if not row:abort(404)
    return dict(row)

def ensure(c,doc):
    if c.execute('SELECT 1 FROM workbook_state WHERE document_id=?',(doc,)).fetchone():return
    getdoc(c,doc)
    c.execute('INSERT INTO workbook_state(document_id,updated_at) VALUES(?,?)',(doc,db.now_str()))
    for row in c.execute('SELECT * FROM source_rows WHERE document_id=?',(doc,)):
        formulas={str(coord(k+str(row['row_no']))[1]):v for k,v in json.loads(row['formula_json']).items()}
        values=json.loads(row['raw_json'])
        if row['sheet']=='黄白铂板料9月' and row['row_no'] in (21,43) and len(values)>9 and values[9]=='万德福':values[9]=None
        c.execute('INSERT INTO workbook_rows VALUES(?,?,?)',(row['id'],dump(values),dump(formulas)))
    # User-approved correction applies to the editable copy only.
    for row in c.execute("SELECT s.*,w.cells_json,w.formulas_json FROM source_rows s JOIN workbook_rows w ON w.source_row_id=s.id WHERE s.document_id=? AND s.kind='material'",(doc,)):
        values=json.loads(row['cells_json']);fm=json.loads(row['formulas_json'])
        if row['classification']=='说明/汇总' and '15' in fm:
            corrected=re.sub(r'(?i)(SUM\(\$?C\$?\d+:\$?)M(\$?\d+\))',r'\1N\2',fm['15'])
            if corrected!=fm['15']:
                fm['15']=corrected;c.execute('UPDATE workbook_rows SET formulas_json=? WHERE source_row_id=?',(dump(fm),row['id']))
    # Recalculate only the approved corrected subtotal cells.
    rows,cells,formulas,index=load(c,doc)
    corrected={key for key in formulas if index[key[:2]]['kind']=='material' and key[2]==15 and formulas[key]!=json.loads(index[key[:2]]['formula_json']).get('O')}
    if corrected:
        touched=apply_recalc(cells,formulas,corrected)
        persist(c,doc,index,cells,formulas,{key[:2] for key in touched},{'来源':'已确认的原表汇总修正','说明':'合计包含大润发'})

def load(c,doc):
    ensure(c,doc)
    rows=[dict(x) for x in c.execute('SELECT s.*,w.cells_json,w.formulas_json FROM source_rows s JOIN workbook_rows w ON w.source_row_id=s.id WHERE s.document_id=? ORDER BY s.id',(doc,))]
    cells={};formulas={};index={}
    for row in rows:
        row['cells']=json.loads(row['cells_json']);row['formulas']=json.loads(row['formulas_json']);index[(row['sheet'],row['row_no'])]=row
        for col,value in enumerate(row['cells'],1):cells[(row['sheet'],row['row_no'],col)]=value
        for col,value in row['formulas'].items():formulas[(row['sheet'],row['row_no'],int(col))]=value
    return rows,cells,formulas,index

def specs(rows):
    groups=collections.defaultdict(list)
    for row in rows:groups[row['sheet']].append(row)
    result={}
    for name,group in groups.items():
        kind=group[0]['kind'];header=None;mapping={}
        for row in group[:20]:
            h=[sync.norm(x) for x in row['cells']]
            if kind=='sales' and '商品' in h and ('销售克价' in h or '实际到账' in h):header=row;break
            if kind=='stock' and '商品' in h and '成本' in h:header=row;break
            if kind=='material' and '日期' in h and len(h)>1 and h[1]=='商品':header=row;break
        if header:
            headers=header['cells']
            if kind=='sales':mapping=sync.map_headers(headers,sync.SALE_HEADERS);mapping.setdefault('date',0)
            if kind=='stock':
                mapping=sync.map_headers(headers,sync.STOCK_HEADERS)
                notes=[i for i,x in enumerate(headers) if sync.norm(x)=='备注']
                if len(notes)>1:mapping['note']=notes[1]
        else:headers=[]
        maxcol=max([len(x['cells']) for x in group]+[1])
        result[name]={'name':name,'kind':kind,'header':header['row_no'] if header else 0,'headers':headers,'mapping':mapping,'columns':maxcol,'rows':max(x['row_no'] for x in group)}
    return result

def persist(c,doc,index,cells,formulas,touched,action):
    for key,row in index.items():
        if key not in touched:continue
        used=max([col for sheet,rn,col in cells if (sheet,rn)==key]+[col for sheet,rn,col in formulas if (sheet,rn)==key]+[0])
        values=[cells.get((key[0],key[1],i)) for i in range(1,used+1)]
        fm={str(col):value for (sheet,rn,col),value in formulas.items() if (sheet,rn)==key}
        c.execute('UPDATE workbook_rows SET cells_json=?,formulas_json=? WHERE source_row_id=?',(dump(values),dump(fm),row['id']))
        row['cells']=values;row['formulas']=fm
    c.execute('UPDATE workbook_state SET revision=revision+1,updated_at=? WHERE document_id=?',(db.now_str(),doc))
    rev=c.execute('SELECT revision FROM workbook_state WHERE document_id=?',(doc,)).fetchone()[0]
    user=auth.current_user()
    c.execute('INSERT INTO workbook_changes(document_id,revision,actor,at,detail) VALUES(?,?,?,?,?)',(doc,rev,user['username'] if user else 'system',db.now_str(),dump(action)))
    return rev

def apply_recalc(cells,formulas,changed):
    engine=ExcelEngine(cells,formulas)
    result=engine.recalculate(changed)
    updates,errors=result['updates'],result['errors']
    if errors:
        first=next(iter(errors.items()))
        key,error=first
        raise ValueError(str(key[0])+'!'+letter(key[2])+str(key[1])+'：'+str(error)+'。未保存，请修正公式或数据。')
    cells.update(updates)
    return set(changed)|set(updates)

def normal_row(row,spec,cells):
    values={};key=(row['sheet'],row['row_no'])
    for field,col in spec['mapping'].items():
        value=cells.get((key[0],key[1],col+1))
        if value in (None,''):
            values[field]=0.0 if field in sync.NUMERIC else '';continue
        if isinstance(value,str) and value.startswith('#'):raise ValueError('原表 '+row['sheet']+'!'+letter(col+1)+str(row['row_no'])+' 有公式错误。')
        if field in sync.NUMERIC:values[field]=sync.numeric(value)
        elif field in sync.DATES:
            value=importer.ymd(value)
            if not value:raise ValueError('日期不能识别：'+str(cells.get((key[0],key[1],col+1))))
            values[field]=value
        else:values[field]=str(value).strip()
    return values

def sync_to_ledger(c,doc,index,cells,touched):
    meta=specs(list(index.values()));affected_material=set();updated=0
    for key in touched:
        row=index.get(key)
        if not row:continue
        links=[dict(x) for x in c.execute('SELECT * FROM source_links WHERE source_row_id=?',(row['id'],))]
        if not links:continue
        if row['kind']=='material':
            affected_material.update(x['ledger_id'] for x in links if x['ledger_table']=='material_stock');continue
        if row['kind'] not in ('sales','stock'):continue
        normalized=normal_row(row,meta[row['sheet']],cells)
        if not normalized.get('product'):raise ValueError('已入账的商品不可清空；删除账目请使用系统删除功能。')
        if row['kind']=='sales' and not normalized.get('date'):raise ValueError('销售日期不可清空。')
        values=sync.ledger_values(row['kind'],normalized)
        for link in links:
            table=link['ledger_table'];old=r.existing(c,table,link['ledger_id'])
            # Only columns represented by the template drive the linked record.
            fields={**normalized}
            if row['kind']=='sales':
                for field in ('spread','labor','comm_c'):
                    if field not in normalized:fields[field]=values[field]
            if row['kind']=='stock' and 'profit_c' not in normalized:fields['profit_c']=values['profit_c']
            fields={k:v for k,v in fields.items() if k in old}
            if any(old[k]!=v for k,v in fields.items()):_write(c,table,fields,old);updated+=1
    for rid in affected_material:
        links=[dict(x) for x in c.execute('SELECT l.*,s.sheet,s.row_no,s.document_id FROM source_links l JOIN source_rows s ON s.id=l.source_row_id WHERE l.ledger_table=? AND l.ledger_id=?',('material_stock',rid))]
        if any(x['document_id']!=doc for x in links):raise ValueError('该存料记录关联多个原表，需先核对来源再修改。')
        old=r.existing(c,'material_stock',rid);values={'grams':0.0,'amount':0.0}
        # Retain any manually recorded balance outside the associated atoms.
        before={'grams':0.0,'amount':0.0}
        dates=set();suppliers=set()
        for link in links:
            expected=json.loads(link['expected_json']);unit='grams' if 'grams' in expected else 'amount'
            before[unit]+=expected.get(unit,0)
            row=index[(link['sheet'],link['row_no'])];original=json.loads(row['raw_json'])
            stored=json.loads(c.execute('SELECT cells_json FROM workbook_rows WHERE source_row_id=?',(row['id'],)).fetchone()[0])
            if cells.get((link['sheet'],link['row_no'],1))!=(stored[0] if stored else None):raise ValueError('存料日期会影响上下行对应，确认单位和日期规则后再修改。')
            current=cells.get((link['sheet'],link['row_no'],int(link['part'])))
            values[unit]+=sync.numeric(current) if current not in (None,'') else 0
            sourcecol=int(link['part'])
            orig=original[sourcecol-1] if sourcecol<=len(original) else None
            # expected_json is the immutable imported baseline, not the live copy.
            dates.add(expected.get('date',old['date']));suppliers.add(expected.get('supplier',old['supplier']))
        for unit in values:values[unit]+=old[unit]-before[unit]
        # The offset must use the previous live atoms, not original cached atoms.
        previous={'grams':0.0,'amount':0.0}
        for link in links:
            expected=json.loads(link['expected_json']);unit='grams' if 'grams' in expected else 'amount'
            live=json.loads(c.execute('SELECT cells_json FROM workbook_rows WHERE source_row_id=?',(link['source_row_id'],)).fetchone()[0]);col=int(link['part'])
            previous[unit]+=sync.numeric(live[col-1]) if col<=len(live) and live[col-1] not in (None,'') else 0
        for unit in values:values[unit]+=before[unit]-previous[unit]
        _write(c,'material_stock',values,old);updated+=1
    return updated

def preview_sale(rid,inputs):
    with r.transaction() as c:
        link=c.execute("SELECT l.*,s.document_id,s.sheet,s.row_no FROM source_links l JOIN source_rows s ON s.id=l.source_row_id WHERE l.ledger_table='sales' AND l.ledger_id=? LIMIT 1",(rid,)).fetchone()
        if not link:return None
        rows,cells,formulas,index=load(c,link['document_id']);spec=specs(rows)[link['sheet']];changed=set()
        for field,col in spec['mapping'].items():
            if field not in inputs:continue
            key=(link['sheet'],link['row_no'],col+1)
            if key in formulas and field not in ('cost','received','amount_c'):continue
            value=inputs[field]
            if value in (None,''):continue
            value=sync.numeric(value) if field in sync.NUMERIC else value
            if value==cells.get(key):continue
            formulas.pop(key,None);cells[key]=value;changed.add(key)
        if changed:apply_recalc(cells,formulas,changed)
        normalized=normal_row(index[(link['sheet'],link['row_no'])],spec,cells);record=sync.ledger_values('sales',normalized)
        return {**{target:record[source] for source,target in r.SALE_DERIVED.items()},'_rule_id':-1,'gram_price':record['amount_c']/record['weight'] if record['weight'] else 0}

def calculate_preview():
    if request.args.get('domain','sales')=='sales' and request.args.get('id'):
        try:
            result=preview_sale(int(request.args['id']),dict(request.args))
            if result:return jsonify(ok=True,values=result,algorithm='原 Excel 单元格公式')
        except (ValueError,TypeError) as e:return jsonify(ok=False,error=str(e)),400
    response=enhanced.calculate_api()
    if request.args.get('domain','sales')=='sales' and request.args.get('amount_c','').strip():
        try:
            data=response.get_json()
            if data.get('ok'):data['values']['amount']=r.number(request.args['amount_c']);return jsonify(data)
        except ValueError as e:return jsonify(ok=False,error=str(e)),400
    return response

def system_write(c,table,values,old=None):
    rid=_write(c,table,values,old)
    if not old and not _importing.get():
        import workbook_routing
        workbook_routing.route_new(c,table,rid)
        if table=='material_stock':route_material(c,rid)
    if old and table in ('sales','stock_items','material_stock'):
        links=[dict(x) for x in c.execute('SELECT l.*,s.document_id,s.sheet,s.row_no FROM source_links l JOIN source_rows s ON s.id=l.source_row_id WHERE l.ledger_table=? AND l.ledger_id=?',(table,rid))]
        bydoc=collections.defaultdict(list)
        for link in links:bydoc[link['document_id']].append(link)
        if len(bydoc)>1:raise ValueError('这笔账关联多个原表，请先在原表核对后修改。')
        for doc,owned in bydoc.items():
            rows,cells,formulas,index=load(c,doc);meta=specs(rows);changed=set()
            if table=='material_stock':
                for field in ('date','supplier'):
                    if field in values and old[field]!=values[field]:raise ValueError('已关联存料的日期和供货商请在原表核对后调整。')
                for field in ('grams','amount'):
                    if field not in values or values[field]==old[field]:continue
                    atoms=[link for link in owned if field in json.loads(link['expected_json'])]
                    if len(atoms)!=1:raise ValueError('该存料合计对应多个单元格，请在电子表格中修改明细。')
                    link=atoms[0];key=(link['sheet'],link['row_no'],int(link['part']))
                    if key in formulas:raise ValueError('该存料格是公式，请在电子表格修改公式或它的输入。')
                    cells[key]=sync.numeric(cells.get(key) or 0)+values[field]-old[field];changed.add(key)
            else:
                for link in owned:
                    spec=meta[link['sheet']]
                    for field,col in spec['mapping'].items():
                        if field not in values or values[field]==old[field]:continue
                        if field in r.SALE_DERIVED or field=='profit_c':
                            explicit_amount=field=='amount_c' and (set(values)=={'amount_c'} or (has_request_context() and 'amount_c' in request.form))
                            if not explicit_amount:continue
                        key=(link['sheet'],link['row_no'],col+1)
                        if key in formulas:
                            if field in ('cost','received','amount_c'):
                                formulas.pop(key,None)
                            else:continue
                        cells[key]=values[field];changed.add(key)
                    # Labor/spread have no column in this Excel; changing them here
                    # would create a second algorithm instead of changing its formula.
                    for field in ('labor','spread'):
                        if field in values and field not in spec['mapping'] and values[field]!=old.get(field):raise ValueError('原表没有“工费/点差”独立列，请在电子表格修改对应公式。')
            if changed:
                touched=apply_recalc(cells,formulas,changed)
                sync_to_ledger(c,doc,index,cells,{key[:2] for key in touched})
                persist(c,doc,index,cells,formulas,{key[:2] for key in touched},{'来源':'系统记账','系统表':table,'编号':rid,'单元格':[x[0]+'!'+letter(x[2])+str(x[1]) for x in changed]})
            elif table!='material_stock':
                sync_to_ledger(c,doc,index,cells,{(link['sheet'],link['row_no']) for link in owned})
    return rid

def route_material(c,rid):
    if c.execute("SELECT 1 FROM source_links WHERE ledger_table='material_stock' AND ledger_id=? LIMIT 1",(rid,)).fetchone():return
    doc=c.execute('SELECT id FROM source_documents ORDER BY id DESC LIMIT 1').fetchone()
    if not doc:return
    doc=doc[0];rows,cells,formulas,index=load(c,doc);meta=specs(rows);record=dict(c.execute('SELECT * FROM material_stock WHERE id=?',(rid,)).fetchone())
    sheets=[x for x in meta.values() if x['kind']=='material']
    if len(sheets)!=1:raise ValueError('存料工作表无法唯一对应，请先确认原表类目。')
    spec=sheets[0];sheet=spec['name'];headers=spec['headers']
    vendorcols=[i+1 for i,value in enumerate(headers) if i>=2 and value not in (None,'','汇总','备注') and not str(value).startswith('列')]
    choices=[i for i in vendorcols if headers[i-1]==record['supplier']]
    if len(choices)!=1:raise ValueError('这个供货商尚未唯一对应原表列，请先在原表导入窗口确认供货商列。')
    totals=[i+1 for i,value in enumerate(headers) if value=='汇总']
    if len(totals)!=1:raise ValueError('存料原表需要唯一的汇总列，才能自动对应新记录。')
    col=choices[0];totalcol=totals[0];start=max(x['row_no'] for x in rows if x['sheet']==sheet)+1;changed=set()
    for offset,unit,label in [(0,'grams','板料（克）'),(1,'amount','金额（元）')]:
        rn=start+offset;values=[None]*spec['columns'];values[0]=record['date'];values[1]=label;values[col-1]=record[unit]
        fm={str(totalcol):'=SUM('+','.join(letter(i)+str(rn) for i in vendorcols)+')'}
        normalized={'date':record['date'],'unit':unit,'cells':[{'supplier':record['supplier'],'column':col,'value':record[unit],'unit':unit}]}
        sid=c.execute('INSERT INTO source_rows(document_id,sheet,row_no,kind,raw_json,formula_json,normalized_json,classification,warning) VALUES(?,?,?,?,?,?,?,?,?)',(doc,sheet,rn,'material','[]','{}',dump(normalized),'业务明细','系统新增，原始文件保持不变。')).lastrowid
        c.execute('INSERT INTO workbook_rows VALUES(?,?,?)',(sid,dump(values),dump(fm)))
        row=dict(id=sid,document_id=doc,sheet=sheet,row_no=rn,kind='material',raw_json='[]',formula_json='{}',normalized_json=dump(normalized),classification='业务明细',warning='',cells=values,formulas=fm)
        index[(sheet,rn)]=row;rows.append(row)
        for i,v in enumerate(values,1):cells[(sheet,rn,i)]=v;changed.add((sheet,rn,i))
        formulas[(sheet,rn,totalcol)]=fm[str(totalcol)]
        c.execute('INSERT INTO source_links(source_row_id,part,ledger_table,ledger_id,expected_json) VALUES(?,?,?,?,?)',(sid,str(col),'material_stock',rid,dump({'date':record['date'],'supplier':record['supplier'],unit:record[unit]})))
        # Extend the original supplier subtotal without replacing its formula.
        for summary in [x for x in rows if x['sheet']==sheet and x['classification']=='说明/汇总']:
            text=' '.join(str(x or '') for x in summary['cells'][:2])
            if (unit=='grams' and '料合计' in text) or (unit=='amount' and '费合计' in text):
                key=(sheet,summary['row_no'],col);base=formulas.get(key)
                if base:formulas[key]=base+'+'+letter(col)+str(rn)
                else:
                    value=cells.get(key)
                    initial=sync.numeric(value) if value not in (None,'') else 0
                    formulas[key]=('='+repr(initial)+'+' if initial else '=')+letter(col)+str(rn)
                changed.add(key)
    touched=apply_recalc(cells,formulas,changed)
    persist(c,doc,index,cells,formulas,{key[:2] for key in touched},{'来源':'新增存料对应','系统编号':rid,'供货商':record['supplier']})

def system_delete(c,table,old):
    links=[dict(x) for x in c.execute('SELECT l.*,s.document_id,s.sheet,s.row_no FROM source_links l JOIN source_rows s ON s.id=l.source_row_id WHERE l.ledger_table=? AND l.ledger_id=?',(table,old['id']))]
    _delete(c,table,old)
    for doc in {x['document_id'] for x in links}:
        rows,cells,formulas,index=load(c,doc);changed=set()
        for link in [x for x in links if x['document_id']==doc]:
            if table=='material_stock':columns=[int(link['part'])]
            else:columns=range(1,len(index[(link['sheet'],link['row_no'])]['cells'])+1)
            for col in columns:
                key=(link['sheet'],link['row_no'],col);cells[key]=None;formulas.pop(key,None);changed.add(key)
        # Removing a row can leave an original ratio unavailable; retain visible
        # Excel errors in summary cells rather than inventing zero values.
        result=ExcelEngine(cells,formulas).recalculate(changed);cells.update(result['updates'])
        touched=changed|set(result['updates']);persist(c,doc,index,cells,formulas,{key[:2] for key in touched},{'来源':'系统删除账目','系统表':table,'编号':old['id']})

@bp.get('/workbooks')
@auth.login_required
def choose():
    docs=enhanced.documents()
    return render_template('workbook_choose.html',docs=docs)

@bp.get('/workbooks/<int:doc>')
@auth.login_required
def page(doc):
    with r.transaction() as c:
        record=getdoc(c,doc);rows,cells,formulas,index=load(c,doc);meta=specs(rows)
    sheet=request.args.get('sheet',next(iter(meta)))
    if sheet not in meta:abort(404)
    return render_template('workbook.html',doc=record,sheets=meta,sheet=sheet,readonly=auth.current_user()['role']=='viewer')

@bp.get('/workbooks/<int:doc>/data')
@auth.login_required
def data(doc):
    with r.transaction() as c:
        record=getdoc(c,doc);rows,cells,formulas,index=load(c,doc);meta=specs(rows);state=dict(c.execute('SELECT * FROM workbook_state WHERE document_id=?',(doc,)).fetchone())
        sheet=request.args.get('sheet',next(iter(meta)))
        if sheet not in meta:abort(404)
        start=max(1,int(request.args.get('start',1)));count=min(100,max(1,int(request.args.get('count',50))));colstart=max(1,int(request.args.get('col',1)));cols=min(40,max(1,int(request.args.get('cols',20))))
        selected=[];matched=[];kw=request.args.get('kw','').casefold();filtercol=int(request.args.get('field','0'));operator=request.args.get('op','contains');linkfilter=request.args.get('linked','')
        for row in rows:
            if row['sheet']!=sheet:continue
            linked=c.execute('SELECT COUNT(*) FROM source_links WHERE source_row_id=?',(row['id'],)).fetchone()[0]
            if linkfilter=='yes' and not linked:continue
            if linkfilter=='pending' and (linked or row['classification'] in ('空行','表头/说明','说明/汇总')):continue
            candidates=[cells.get((sheet,row['row_no'],filtercol))] if filtercol else row['cells']
            if kw:
                if operator in ('gt','lt','eq'):
                    try:target=float(kw)
                    except ValueError:target=None
                    def match(v):
                        try:n=float(v)
                        except (TypeError,ValueError):return False
                        return target is not None and (n>target if operator=='gt' else n<target if operator=='lt' else n==target)
                    if not any(match(v) for v in candidates):continue
                elif not any(kw in str(v or '').casefold() for v in candidates):continue
            matched.append((row,linked))
        filtered=bool(kw or linkfilter)
        visible=matched[start-1:start-1+count] if filtered else [(row,linked) for row,linked in matched if start<=row['row_no']<start+count]
        def shown(col,value):
            if not isinstance(value,(int,float)):return value
            if col==meta[sheet]['mapping'].get('gross_rate_c',-2)+1:return fmt2(value*100)+'%'
            return fmt2(value)
        for row,linked in visible:
            selected.append({'row':row['row_no'],'classification':row['classification'],'warning':row['warning'],'linked':linked,
                             'cells':[{'col':col,'value':cells.get((sheet,row['row_no'],col)),'display':shown(col,cells.get((sheet,row['row_no'],col))),'formula':formulas.get((sheet,row['row_no'],col),'')} for col in range(colstart,min(colstart+cols,meta[sheet]['columns']+1)) if not (meta[sheet]['kind']=='sales' and col<=len(meta[sheet]['headers']) and sync.norm(meta[sheet]['headers'][col-1]) in ('模板','工费','加工费'))]})
        return jsonify(ok=True,revision=state['revision'],algorithm=state['algorithm'],sheet=meta[sheet],rows=selected,matched=len(matched),readonly=auth.current_user()['role']=='viewer')

@bp.get('/workbooks/<int:doc>/history')
@auth.login_required
def history(doc):
    rows=[dict(x) for x in db.query('SELECT revision,actor,at,detail FROM workbook_changes WHERE document_id=? ORDER BY id DESC LIMIT 100',(doc,))]
    for row in rows:row['detail']=json.loads(row['detail'])
    return jsonify(ok=True,rows=rows)

@bp.post('/workbooks/<int:doc>/cells')
@auth.login_required
def save(doc):
    try:
        payload=request.get_json(silent=True) or {}
        with r.transaction() as c:
            result=apply_changes(c,doc,payload.get('changes',[]),payload.get('revision'))
        return jsonify(ok=True,**result,message='已保存，相关公式已更新，系统记录同步 '+str(result['updated'])+' 笔。')
    except r.Conflict as e:return jsonify(ok=False,error=str(e)),409
    except (ValueError,TypeError,KeyError,sqlite3.Error) as e:return jsonify(ok=False,error=str(e)),400

def apply_changes(c,doc,changes,expected_revision,origin='表格编辑'):
    if not 1<=len(changes)<=5000:raise ValueError('一次可修改 1 至 5000 个单元格。')
    rows,cells,formulas,index=load(c,doc);meta=specs(rows);revision=c.execute('SELECT revision FROM workbook_state WHERE document_id=?',(doc,)).fetchone()[0]
    if expected_revision!=revision:raise r.Conflict('表格已被其他窗口修改，请重新载入后核对。')
    changed=set();detail=[]
    for item in changes:
        sheet=item.get('sheet');row=int(item.get('row',0));col=int(item.get('col',0));value=item.get('input','')
        if sheet not in meta or (sheet,row) not in index or not 1<=col<=meta[sheet]['columns']:raise ValueError('单元格超出当前原表范围。')
        if row<=meta[sheet]['header']:raise ValueError('表头是类目和字段对应依据；修改表头前需要先确认新的对应规则。')
        if value is None:value=''
        if not isinstance(value,(str,int,float)) or isinstance(value,bool):raise ValueError('请输入文字、数字或以 = 开头的公式。')
        key=(sheet,row,col);old={'value':cells.get(key),'formula':formulas.get(key,'')}
        if isinstance(value,str) and value.lstrip().startswith('='):formulas[key]=value.lstrip()
        else:
            formulas.pop(key,None)
            if isinstance(value,str):
                value=value.strip()
                if value=='':value=None
                elif re.fullmatch(r'-?(?:\d+(?:\.\d*)?|\.\d+)%',value):value=float(value[:-1])/100
                elif re.fullmatch(r'-?(?:\d+(?:\.\d*)?|\.\d+)',value):
                    field=next((k for k,i in meta[sheet]['mapping'].items() if i+1==col),None)
                    if field in sync.NUMERIC or field is None:
                        value=float(value)
                        if not math.isfinite(value):raise ValueError('数字必须有限。')
            cells[key]=value
        changed.add(key);detail.append({'sheet':sheet,'cell':letter(col)+str(row),'before':old,'input':item.get('input')})
    touched=apply_recalc(cells,formulas,changed)
    affected={key[:2] for key in touched};count=sync_to_ledger(c,doc,index,cells,affected)
    revision=persist(c,doc,index,cells,formulas,affected,{'来源':origin,'修改':detail,'更新系统记录':count})
    return {'revision':revision,'updated':count}

@bp.get('/workbooks/<int:doc>/revision')
@auth.login_required
def revision(doc):
    with r.transaction() as c:ensure(c,doc);row=c.execute('SELECT revision,updated_at FROM workbook_state WHERE document_id=?',(doc,)).fetchone()
    return jsonify(revision=row['revision'],updated_at=row['updated_at'])

def expand_xlsx(path,rows):
    """Clone only layout for new months; no old business cells survive."""
    source=zipfile.ZipFile(path);book=ET.fromstring(source.read('xl/workbook.xml'));rels=ET.fromstring(source.read('xl/_rels/workbook.xml.rels'));ct=ET.fromstring(source.read('[Content_Types].xml'))
    names={x.get('name') for x in book.find('m:sheets',NS)};wanted=list(dict.fromkeys(row['sheet'] for row in rows if row['sheet'] not in names))
    if not wanted:source.close();return path
    doc=rows[0]['document_id'];extras={x['sheet']:x['template_sheet'] for x in db.query('SELECT * FROM workbook_extra_sheets WHERE document_id=?',(doc,))}
    relmap={x.get('Id'):x.get('Target') for x in rels};paths={}
    for sheet in book.find('m:sheets',NS):
        rel=relmap[sheet.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')];paths[sheet.get('name')]='xl/'+rel.lstrip('/') if not rel.startswith('/') else rel.lstrip('/')
    additions={};nextid=max(int(x.get('sheetId')) for x in book.find('m:sheets',NS))+1;ids={x.get('Id') for x in rels}
    for name in wanted:
        template=extras[name];root=ET.fromstring(source.read(paths[template]));sd=root.find('m:sheetData',NS);sd.clear()
        maxrow=max(x['row_no'] for x in rows if x['sheet']==name);maxcol=max([len(x['cells']) for x in rows if x['sheet']==name]+[1]);dimension=root.find('m:dimension',NS)
        if dimension is not None:dimension.set('ref','A1:'+letter(maxcol)+str(maxrow))
        # Copy cell styles and row heights, then blank every template value.
        original=ET.fromstring(source.read(paths[template]));oldrows=list(original.find('m:sheetData',NS))
        meta=specs([x for x in rows if x['sheet']==name])[name]
        for item in [x for x in rows if x['sheet']==name]:
            match=next((x for x in oldrows if int(x.get('r'))==item['row_no']),None)
            if match is None:match=next((x for x in oldrows if int(x.get('r'))>meta['header']),None)
            node=ET.SubElement(sd,'{'+M+'}row',**{**(match.attrib if match is not None else {}),'r':str(item['row_no'])})
            if match is not None:
                for cell in match:
                    if cell.tag!='{'+M+'}c':continue
                    col=coord(cell.get('r'))[1];ET.SubElement(node,'{'+M+'}c',**{k:v for k,v in {**cell.attrib,'r':letter(col)+str(item['row_no'])}.items() if k not in ('t',)})
        for element in list(root):
            if element.tag.rsplit('}',1)[-1] in ('drawing','legacyDrawing','tableParts','hyperlinks'):root.remove(element)
        filename='xl/worksheets/sheet'+str(nextid)+'.xml'
        while filename in source.namelist() or filename in additions:nextid+=1;filename='xl/worksheets/sheet'+str(nextid)+'.xml'
        rid='rIdWorkbook'+str(nextid)
        while rid in ids:rid+='x'
        ids.add(rid);ET.SubElement(rels,'{http://schemas.openxmlformats.org/package/2006/relationships}Relationship',Id=rid,Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet',Target='worksheets/sheet'+str(nextid)+'.xml')
        ET.SubElement(book.find('m:sheets',NS),'{'+M+'}sheet',name=name,sheetId=str(nextid),**{'{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id':rid})
        ET.SubElement(ct,'{http://schemas.openxmlformats.org/package/2006/content-types}Override',PartName='/'+filename,ContentType='application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml')
        additions[filename]=ET.tostring(root,encoding='utf-8',xml_declaration=True);nextid+=1
    output=io.BytesIO();changed={'xl/workbook.xml':ET.tostring(book,encoding='utf-8',xml_declaration=True),'xl/_rels/workbook.xml.rels':ET.tostring(rels,encoding='utf-8',xml_declaration=True),'[Content_Types].xml':ET.tostring(ct,encoding='utf-8',xml_declaration=True)}
    with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as target:
        for info in source.infolist():target.writestr(info,changed.get(info.filename,source.read(info.filename)))
        for name,content in additions.items():target.writestr(name,content)
    source.close();output.seek(0);return output

def patch_xlsx(path,rows):
    path=expand_xlsx(path,rows)
    output=io.BytesIO()
    with zipfile.ZipFile(path) as source,zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as target:
        styles=ET.fromstring(source.read('xl/styles.xml'));custom={int(x.get('numFmtId')):x.get('formatCode') for x in styles.findall('m:numFmts/m:numFmt',NS)}
        dates={i for i,x in enumerate(styles.find('m:cellXfs',NS)) if is_date_format(custom.get(int(x.get('numFmtId','0')),BUILTIN_FORMATS.get(int(x.get('numFmtId','0')),'General')))}
        xfs=styles.find('m:cellXfs',NS);style_cache={}
        def display_style(style):
            if style in dates:return style
            if style not in style_cache:
                base=xfs[style] if style<len(xfs) else xfs[0];cloned=copy.deepcopy(base)
                code=custom.get(int(base.get('numFmtId','0')),BUILTIN_FORMATS.get(int(base.get('numFmtId','0')),'General'))
                cloned.set('numFmtId','10' if '%' in code else '2');cloned.set('applyNumberFormat','1')
                style_cache[style]=len(xfs);xfs.append(cloned);xfs.set('count',str(len(xfs)))
            return style_cache[style]
        book=ET.fromstring(source.read('xl/workbook.xml'));rels=ET.fromstring(source.read('xl/_rels/workbook.xml.rels'))
        relmap={x.get('Id'):x.get('Target') for x in rels};sheetpaths={}
        for sheet in book.find('m:sheets',NS):
            rel=relmap[sheet.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')]
            sheetpaths['xl/'+rel.lstrip('/') if not rel.startswith('/') else rel.lstrip('/')]=sheet.get('name')
        for info in source.infolist():
            content=source.read(info.filename)
            if info.filename in sheetpaths:
                sheet=sheetpaths[info.filename];root=ET.fromstring(content);sd=root.find('m:sheetData',NS);rindex={int(x.get('r')):x for x in sd}
                ownmeta=specs([row for row in rows if row['sheet']==sheet])[sheet]
                number_columns={i+1 for key,i in ownmeta['mapping'].items() if key in sync.NUMERIC and key!='seq'}
                if ownmeta['kind']=='material':number_columns.update(range(3,16))
                for row in rows:
                    if row['sheet']!=sheet:continue
                    rn=row['row_no'];node=rindex.get(rn)
                    if node is None:node=ET.SubElement(sd,'{'+M+'}row',r=str(rn))
                    existing={coord(x.get('r'))[1]:x for x in node if x.tag=='{'+M+'}c'}
                    values=row['cells'];fm=row['formulas']
                    for col in set(existing)|set(range(1,len(values)+1))|{int(k) for k in fm}:
                        cn=existing.get(col)
                        if cn is None:cn=ET.SubElement(node,'{'+M+'}c',r=letter(col)+str(rn))
                        for child in list(cn):
                            if child.tag in ['{'+M+'}f','{'+M+'}v','{'+M+'}is']:cn.remove(child)
                        cn.attrib.pop('t',None);value=values[col-1] if col<=len(values) else None;formula=fm.get(str(col))
                        if formula:ET.SubElement(cn,'{'+M+'}f').text=formula.lstrip('=')
                        if value is None:continue
                        if isinstance(value,(int,float)):
                            if col in number_columns:cn.set('s',str(display_style(int(cn.get('s','0')))))
                            ET.SubElement(cn,'{'+M+'}v').text=str(value)
                        elif isinstance(value,str) and value.startswith('#'):
                            cn.set('t','e');ET.SubElement(cn,'{'+M+'}v').text=value
                        elif formula:
                            cn.set('t','str');ET.SubElement(cn,'{'+M+'}v').text=str(value)
                        else:
                            # Keep dates typed using the existing date style.
                            if int(cn.get('s','0')) in dates and re.fullmatch(r'\d{4}-\d{2}-\d{2}(?:T00:00:00)?',str(value)):
                                date=datetime.date.fromisoformat(str(value)[:10]);serial=(date-datetime.date(1899,12,30)).days
                                ET.SubElement(cn,'{'+M+'}v').text=str(serial)
                            else:
                                cn.set('t','inlineStr');isnode=ET.SubElement(cn,'{'+M+'}is');ET.SubElement(isnode,'{'+M+'}t').text=str(value)
                    node[:]=sorted(node,key=lambda x:coord(x.get('r'))[1])
                sd[:]=sorted(sd,key=lambda x:int(x.get('r')))
                dimension=root.find('m:dimension',NS)
                if dimension is not None:
                    addresses=[coord(cell.get('r')) for node in sd for cell in node if cell.tag=='{'+M+'}c']
                    if addresses:dimension.set('ref','A1:'+letter(max(x[1] for x in addresses))+str(max(x[0] for x in addresses)))
                own=[row for row in rows if row['sheet']==sheet];spec=specs(own)[sheet];productcol=spec['mapping'].get('product')
                if productcol is not None:
                    last=max([row['row_no'] for row in own if row['row_no']>spec['header'] and productcol<len(row['cells']) and row['cells'][productcol] not in (None,'','商品','合计','总计','小计')]+[spec['header']])
                    for el in root.findall('.//m:autoFilter',NS)+root.findall('.//m:sortState',NS):
                        ref=el.get('ref','');match=re.fullmatch(r'([A-Z]+\d+):([A-Z]+)\d+',ref)
                        if match:el.set('ref',match[1]+':'+match[2]+str(last))
                content=ET.tostring(root,encoding='utf-8',xml_declaration=True)
            if info.filename=='xl/calcChain.xml':continue
            # Remove only the obsolete cached calculation chain; keep other parts.
            if info.filename=='xl/_rels/workbook.xml.rels':
                relroot=ET.fromstring(content)
                for child in list(relroot):
                    if child.get('Type','').endswith('/calcChain'):relroot.remove(child)
                content=ET.tostring(relroot,encoding='utf-8',xml_declaration=True)
            if info.filename=='[Content_Types].xml':
                ct=ET.fromstring(content)
                for child in list(ct):
                    if child.get('PartName')=='/xl/calcChain.xml':ct.remove(child)
                content=ET.tostring(ct,encoding='utf-8',xml_declaration=True)
            if info.filename!='xl/styles.xml':target.writestr(info,content)
        target.writestr('xl/styles.xml',ET.tostring(styles,encoding='utf-8',xml_declaration=True))
    output.seek(0);return output

@bp.get('/workbooks/<int:doc>/export')
@auth.login_required
def export(doc):
    with r.transaction() as c:record=getdoc(c,doc);rows,cells,formulas,index=load(c,doc)
    if request.args.get('format')=='csv':
        sheet=request.args.get('sheet');chosen=[x for x in rows if x['sheet']==sheet]
        if not chosen:abort(404)
        text=io.StringIO();writer=csv.writer(text)
        for row in chosen:
            safe=[(fmt2(v) if isinstance(v,(int,float)) else "'"+v if isinstance(v,str) and v.startswith(('=','+','-','@')) else v) for v in row['cells']]
            writer.writerow(safe)
        return send_file(io.BytesIO(('\ufeff'+text.getvalue()).encode('utf-8')),as_attachment=True,download_name=sheet+'.csv',mimetype='text/csv; charset=utf-8')
    data=patch_xlsx(enhanced.doc_path(record),rows)
    suffix=pathlib.Path(record['name']).suffix
    return send_file(data,as_attachment=True,download_name=pathlib.Path(record['name']).stem+'_当前数据'+suffix,mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

def configure(app):
    global _write,_delete
    import workbook_routing
    with r.transaction() as c:c.executescript(SCHEMA+';'+workbook_routing.SCHEMA+';')
    _write=r.write_row;_delete=r.delete_row;r.write_row=system_write;r.delete_row=system_delete
    original_import=sync.import_document
    def source_import(*args,**kwargs):
        token=_importing.set(True)
        try:
            result=original_import(*args,**kwargs)
            doc=args[0];c=args[1]
            if c.execute('SELECT 1 FROM workbook_state WHERE document_id=?',(doc,)).fetchone():
                rows,cells,formulas,index=load(c,doc)
                sync_to_ledger(c,doc,index,cells,set(index))
            return result
        finally:_importing.reset(token)
    sync.import_document=source_import
    app.register_blueprint(bp)
    app.view_functions['sheet.index']=choose
    app.view_functions['enhanced.calculate_api']=auth.login_required(calculate_preview)
    @app.context_processor
    def workbook_navigation():
        docs=enhanced.documents()
        tabs=[]
        if docs:
            tabs=[dict(x) for x in db.query('SELECT sheet,kind,MIN(id) seq FROM source_rows WHERE document_id=? GROUP BY sheet,kind ORDER BY seq',(docs[0]['id'],))]
            for tab in tabs:tab['document_id']=docs[0]['id']
        return {'original_tabs':tabs}

