"""Route newly entered ledger records to monthly workbook working-copy sheets.

The uploaded/archive file is never changed.  A new month records its original
template sheet for the exporter's XML/style clone.  Existing source links are
stable and are returned unchanged, even if the record's date/category changes.
Call route_new only for a user-created record, after its ledger insert; imports
must use the original ledger writer before attaching their own source links.
"""
import datetime
import json
import re


SCHEMA = '''CREATE TABLE IF NOT EXISTS workbook_extra_sheets(
    document_id INTEGER NOT NULL, sheet TEXT NOT NULL, template_sheet TEXT NOT NULL,
    PRIMARY KEY(document_id,sheet))'''


def _dump(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False)


def _date(value):
    if isinstance(value, datetime.datetime): value = value.date()
    if isinstance(value, datetime.date): return value
    try: return datetime.date.fromisoformat(str(value)[:10])
    except (ValueError, TypeError): return None


def _month_of(spec, rows, fallback_year):
    name = spec['name']
    month = re.search(r'(\d{1,2})月', name)
    if not month: return None
    year = re.search(r'(\d{4})年', name)
    if year: return int(year[1]), int(month[1])
    same = [row for row in rows if row['sheet'] == name]
    for row in same:
        if row['row_no'] <= spec['header']:
            for text in row['cells']:
                found = re.search(r'(\d{4})年', str(text or ''))
                if found: return int(found[1]), int(month[1])
    datecol = spec['mapping'].get('date', spec['mapping'].get('in_date'))
    if datecol is not None:
        for row in same:
            if row['row_no'] <= spec['header'] or datecol >= len(row['cells']): continue
            d = _date(row['cells'][datecol])
            if d: return d.year, int(month[1])
    return fallback_year, int(month[1])


def _new_name(template, date, existing):
    name = re.sub(r'\d{1,2}月', str(date.month) + '月', template, count=1)
    if re.search(r'\d{4}年', name): name = re.sub(r'\d{4}年', str(date.year) + '年', name, count=1)
    else: name = str(date.year) + '年' + name
    if name == template and name in existing: name += '新增'
    name = name[:31]
    candidate = name; serial = 2
    while candidate in existing:
        suffix = ' (' + str(serial) + ')'; candidate = name[:31-len(suffix)] + suffix; serial += 1
    return candidate


def _translated(formula, old_sheet, new_sheet):
    """Summary formulas keep coordinates and reference their new owner sheet."""
    if old_sheet == new_sheet: return formula
    quoted = "'" + old_sheet.replace("'", "''") + "'!"
    target = "'" + new_sheet.replace("'", "''") + "'!"
    formula = formula.replace(quoted, target)
    return re.sub(r'(?<![\w.])' + re.escape(old_sheet) + r'!', lambda _: target, formula)


def _source_row(c, doc, sheet, row, kind, classification, warning):
    rid = c.execute('''INSERT INTO source_rows(document_id,sheet,row_no,kind,
        raw_json,formula_json,normalized_json,classification,warning)
        VALUES(?,?,?,?,?,?,?,?,?)''',
        (doc, sheet, row, kind, '[]', '{}', '{}', classification, warning)).lastrowid
    c.execute('INSERT INTO workbook_rows(source_row_id,cells_json,formulas_json) VALUES(?,?,?)',
              (rid, '[]', '{}'))
    return rid


def _clone_sheet(c, doc, template, name, meta, rows, cells, formulas, index, date):
    import workbooks as wb
    spec = meta[template]
    original = c.execute('SELECT template_sheet FROM workbook_extra_sheets WHERE document_id=? AND sheet=?',
                         (doc, template)).fetchone()
    original = original[0] if original else template
    c.execute('INSERT INTO workbook_extra_sheets(document_id,sheet,template_sheet) VALUES(?,?,?)',
              (doc, name, original))
    changed = set()
    for row in [x for x in rows if x['sheet'] == template and x['row_no'] <= spec['header']]:
        rid = _source_row(c, doc, name, row['row_no'], spec['kind'], '表头/说明', '系统按原表模板创建的新月份；原归档不变。')
        newvalues = list(row['cells'])
        newformulas = {col: _translated(value, template, name) for col, value in row['formulas'].items()}
        # Empty monthly summaries have a zero denominator.  Guard only this
        # known simple ratio; unrelated formula errors remain visible/rejected.
        for col, formula in list(newformulas.items()):
            ratio = re.fullmatch(r'=\s*(\$?[A-Za-z]{1,3}\$?\d+)\s*/\s*(\$?[A-Za-z]{1,3}\$?\d+)\s*',formula)
            if ratio:
                newformulas[col]='=IF('+ratio[2]+'=0,0,'+ratio[1]+'/'+ratio[2]+')'
        for pos, value in enumerate(newvalues, 1):
            if str(pos) in newformulas: value = None
            elif row['row_no'] < spec['header'] and isinstance(value, (int, float)): value = 0
            elif isinstance(value, str) and re.search(r'\d{4}年[-－]?\d{1,2}月', value):
                value = re.sub(r'\d{4}年([-－]?)\d{1,2}月', lambda m: str(date.year)+'年'+m[1]+str(date.month)+'月', value)
            newvalues[pos - 1] = value; cells[(name, row['row_no'], pos)] = value
        for col, value in newformulas.items():
            key = (name, row['row_no'], int(col)); formulas[key] = value; changed.add(key)
        c.execute('UPDATE workbook_rows SET cells_json=?,formulas_json=? WHERE source_row_id=?',
                  (_dump(newvalues), _dump(newformulas), rid))
        clone = dict(row, id=rid, sheet=name, raw_json='[]', formula_json='{}', normalized_json='{}',
                     cells_json=_dump(newvalues), formulas_json=_dump(newformulas), cells=newvalues,
                     formulas=newformulas, classification='表头/说明', warning='系统按原表模板创建的新月份；原归档不变。')
        rows.append(clone); index[(name, row['row_no'])] = clone
    meta[name] = dict(spec, name=name, rows=spec['header'])
    return changed


def _append_row(c, doc, spec, rows, cells, formulas, index):
    sheet = spec['name']; group = sorted((x for x in rows if x['sheet'] == sheet), key=lambda x: x['row_no'])
    product_col = spec['mapping'].get('product')
    last_business = spec['header']
    for row in group:
        if row['row_no'] <= spec['header']: continue
        product = row['cells'][product_col] if product_col is not None and product_col < len(row['cells']) else None
        if product not in (None, '') or c.execute('SELECT 1 FROM source_links WHERE source_row_id=? LIMIT 1',(row['id'],)).fetchone():
            last_business = max(last_business, row['row_no'])
    for row in group:
        if row['row_no'] <= last_business: continue
        if c.execute('SELECT 1 FROM source_links WHERE source_row_id=? LIMIT 1',(row['id'],)).fetchone(): continue
        meaningful = [value for col, value in enumerate(row['cells'],1)
                      if str(col) not in row['formulas'] and col-1 != spec['mapping'].get('seq')]
        if any(value not in (None, '') for value in meaningful): continue
        # A genuinely empty tail row can be reused without renumbering any row.
        c.execute('UPDATE source_rows SET classification=?,warning=? WHERE id=?',
                  ('业务明细','系统新增记录，原归档中的空行保持不变。',row['id']))
        row['classification']='业务明细';row['warning']='系统新增记录，原归档中的空行保持不变。'
        return row
    row_no = max([x['row_no'] for x in group] + [spec['header']]) + 1
    rid = _source_row(c, doc, sheet, row_no, spec['kind'], '业务明细', '系统新增记录，原归档不变。')
    row = dict(id=rid, document_id=doc, sheet=sheet, row_no=row_no, kind=spec['kind'],
               raw_json='[]', formula_json='{}', normalized_json='{}', classification='业务明细',
               warning='系统新增记录，原归档不变。', cells_json='[]', formulas_json='{}', cells=[], formulas={})
    rows.append(row);index[(sheet,row_no)]=row
    return row


def _business_formulas(spec, row, record):
    import workbooks as wb
    mapping = spec['mapping']; rn = str(row['row_no']); out = {}
    def ref(field): return wb.letter(mapping[field]+1)+rn
    def put(field, text):
        if field in mapping: out[mapping[field]+1] = text
    if spec['kind'] == 'sales':
        if all(k in mapping for k in ('cost_gram_c','sell_gram_price')):
            spread = float(record.get('spread') or 0)
            put('cost_gram_c', '='+ref('sell_gram_price')+'-'+format(spread,'.15g'))
        if all(k in mapping for k in ('profit_c','received','cost')):
            put('profit_c', '='+ref('received')+'-'+ref('cost'))
        if all(k in mapping for k in ('gross_rate_c','profit_c','received')):
            put('gross_rate_c', '=IF('+ref('received')+'=0,0,'+ref('profit_c')+'/'+ref('received')+')')
        if all(k in mapping for k in ('comm_cost_c','cost_gram_c','weight')):
            put('comm_cost_c', '='+ref('cost_gram_c')+'*'+ref('weight'))
        if all(k in mapping for k in ('comm_profit_c','received','comm_cost_c')):
            put('comm_profit_c', '='+ref('received')+'-'+ref('comm_cost_c'))
    else:
        put('seq', '=ROW()-'+str(spec['header']))
        if all(k in mapping for k in ('profit_c','sell_price','cost')):
            put('profit_c', '='+ref('sell_price')+'-'+ref('cost'))
    return out


def route_new(c, table, rid):
    """Attach a new sales/stock record to its confirmed monthly template.

    Return None when there is no source workbook, otherwise a routing dictionary.
    Missing dates/templates reject the surrounding transaction visibly.
    """
    if table not in ('sales', 'stock_items'): return None
    import workbooks as wb
    import source_sync as sync
    existing = c.execute('''SELECT s.document_id,s.sheet,s.row_no FROM source_links l
        JOIN source_rows s ON s.id=l.source_row_id WHERE l.ledger_table=? AND l.ledger_id=?
        ORDER BY l.id LIMIT 1''', (table, rid)).fetchone()
    if existing: return dict(existing, new_sheet=False, existing=True)
    latest = c.execute('SELECT id,created_at FROM source_documents ORDER BY id DESC LIMIT 1').fetchone()
    if not latest: return None
    doc = latest['id']; rows, cells, formulas, index = wb.load(c, doc); meta = wb.specs(rows)
    record = c.execute('SELECT * FROM '+table+' WHERE id=?', (rid,)).fetchone()
    if not record: raise ValueError('新增记录不存在，无法对应电子表格。')
    record = dict(record); kind = 'sales' if table == 'sales' else 'stock'
    d = _date(record.get('date' if table == 'sales' else 'in_date'))
    if not d: raise ValueError('新增记录需要正确的'+('销售日期' if table=='sales' else '入柜日期')+'，才能自动对应月份。')
    board = ('板料' in str(record.get('category') or '') or '板料' in str(record.get('product') or '')) if table == 'stock_items' else False
    templates = [s for s in meta.values() if s['kind'] == kind and s['header'] and
                 (kind == 'sales' or ('板料' in s['name']) == board)]
    if not templates: raise ValueError('当前原表缺少'+('销售' if kind=='sales' else '板料' if board else '库存')+'模板，请先导入含对应类目的原始 Excel。')
    fallback_year = int(str(latest['created_at'])[:4])
    matching = [s for s in templates if _month_of(s, rows, fallback_year) == (d.year, d.month)]
    c.execute(SCHEMA)
    changed=set(); created=False
    if matching:
        # Duplicate same-month tabs are ambiguous; never choose one silently.
        if len(matching) > 1: raise ValueError('原表存在多个相同月份和类目的表，请确认新增记录应放入哪张表。')
        spec=matching[0]
    else:
        template=max(templates,key=lambda s:_month_of(s,rows,fallback_year) or (0,0))
        name=_new_name(template['name'],d,meta)
        changed.update(_clone_sheet(c,doc,template['name'],name,meta,rows,cells,formulas,index,d))
        spec=meta[name];created=True
    row=_append_row(c,doc,spec,rows,cells,formulas,index)
    width=max(len(spec['headers']), max(spec['mapping'].values(),default=0)+1)
    # Populate only this new record.  No text/amounts are copied from neighbours.
    for col in range(1,width+1):
        key=(spec['name'],row['row_no'],col);cells[key]=None;formulas.pop(key,None);changed.add(key)
    for field,col in spec['mapping'].items():
        if field in record: cells[(spec['name'],row['row_no'],col+1)]=record[field]
    for col, formula in _business_formulas(spec,row,record).items():
        key=(spec['name'],row['row_no'],col);formulas[key]=formula;changed.add(key)
    c.execute('INSERT INTO source_links(source_row_id,part,ledger_table,ledger_id,expected_json) VALUES(?,?,?,?,?)',
              (row['id'],'record',table,rid,'{}'))
    touched=wb.apply_recalc(cells,formulas,changed)
    affected={key[:2] for key in touched}
    wb.sync_to_ledger(c,doc,index,cells,affected)
    normalized=wb.normal_row(row,spec,cells)
    # Newly created source baseline equals the first calculated working record.
    c.execute('UPDATE source_rows SET normalized_json=? WHERE id=?',(_dump(normalized),row['id']))
    c.execute('UPDATE source_links SET expected_json=? WHERE source_row_id=? AND part=?',(_dump(normalized),row['id'],'record'))
    revision=wb.persist(c,doc,index,cells,formulas,affected,
                        {'来源':'新增账目自动对应','系统表':table,'编号':rid,'工作表':spec['name'],'行':row['row_no'],'新月份':created})
    return {'document_id':doc,'sheet':spec['name'],'row_no':row['row_no'],'new_sheet':created,'existing':False,'revision':revision}
