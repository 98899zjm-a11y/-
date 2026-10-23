"""v1.0.1 repairs, applied to the original packaged v1.0.0 modules.

Historical financial fields are never migrated/recalculated on startup.
All ledger writes are authorized, version checked and committed with their audit.
"""
import contextlib
import datetime as dt
import hashlib
import json
import math
import os
import pathlib
import sqlite3
import tempfile
import threading
import time
import zipfile
from collections import OrderedDict

from flask import abort, current_app, flash, redirect, render_template, request, url_for
from itsdangerous import BadSignature, URLSafeSerializer
import app as original
from app import auth, calc, config, db
from app import views_home as home, views_master as master, views_material as material
from app import views_sales as sales, views_sheet as sheet, views_stock as stock

VERSION = '1.3.0'
TABLES = {'sales', 'stock_items', 'material_stock'}
SALE_DERIVED = dict(amount_c='amount', cost_gram_c='cost_gram_price', profit_c='profit',
                    gross_rate_c='gross_rate', comm_cost_c='comm_cost', comm_c='comm',
                    comm_profit_c='comm_profit')
SALE_NUMBERS = {'weight', 'sell_gram_price', 'labor', 'received', 'cost', 'spread'}
SALE_COLUMNS = [x for x in sales.COLS if x not in SALE_DERIVED and x != 'amount']
FINANCIAL = SALE_NUMBERS
_backup_lock = threading.Lock()
_installed = False


class Conflict(ValueError):
    pass


def number(value, default=0):
    if value is None or str(value).strip() == '':
        return float(default)
    try:
        n = float(value)
    except (ValueError, TypeError):
        raise ValueError('请输入有效数字。')
    if not math.isfinite(n):
        raise ValueError('金额和克重必须是有限数字。')
    return n


def has_value(rec, key):
    try:
        value = rec[key]
    except (KeyError, IndexError, TypeError):
        return False
    return value is not None and str(value).strip() != ''


def category_spread(rec):
    rec = dict(rec)
    product = str(rec.get('product', ''))
    template = str(rec.get('template', ''))
    return 'spread_bullion' if '投资金' in template or '金条' in product or '金豆' in product else 'spread'


def new_spread(rec):
    key = category_spread(rec)
    return number(db.setting(key, '8.2' if key == 'spread_bullion' else '40'))


def old_spread(rec):
    rec = dict(rec)
    if rec.get('rule_version',0)>0:
        return number(rec.get('spread'))
    # 0 meant "default" in v1.0.0; recover the actual saved basis, not today's setting.
    if number(rec.get('spread')) != 0:
        return number(rec['spread'])
    if number(rec.get('sell_gram_price')) != 0 or number(rec.get('cost_gram_c')) != 0:
        return round(number(rec.get('sell_gram_price')) - number(rec.get('cost_gram_c')), 4)
    return 8.2 if category_spread(rec) == 'spread_bullion' else 40.0


def calculate_sale(rec):
    """Explicit overrides, including 0, are preserved. New forms omit overrides."""
    r = dict(rec)
    w = calc.n(r.get('weight')); sgp = calc.n(r.get('sell_gram_price'))
    cost = calc.n(r.get('cost')); received = calc.n(r.get('received'))
    spread = calc.n(r['spread']) if has_value(r, 'spread') else new_spread(r)
    amount = calc.n(r['amount']) if has_value(r, 'amount') else sgp * w + calc.n(r.get('labor'))
    cgp = calc.n(r['cost_gram_price']) if has_value(r, 'cost_gram_price') else sgp - spread
    profit = calc.n(r['profit']) if has_value(r, 'profit') else received - cost
    rate = calc.n(r['gross_rate']) if has_value(r, 'gross_rate') else (profit / received if received else 0)
    cc = calc.n(r['comm_cost']) if has_value(r, 'comm_cost') else cgp * w
    comm = calc.n(r['comm']) if has_value(r, 'comm') else cc - cost
    cp = calc.n(r['comm_profit']) if has_value(r, 'comm_profit') else profit - comm
    return {'amount': calc.money(amount), 'cost_gram_price': round(cgp, 4),
            'profit': calc.money(profit), 'gross_rate': round(rate, 6),
            'comm_cost': calc.money(cc), 'comm': calc.money(comm),
            'comm_profit': calc.money(cp), 'gram_price': round(amount / w, 6) if w else 0}


def serial(row):
    return json.dumps(dict(row), ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def digest(row):
    return hashlib.sha256(serial(row).encode('utf-8')).hexdigest()


def signer():
    return URLSafeSerializer(current_app.secret_key, salt='ledger-record-v1')


def row_token(table, row):
    return signer().dumps({'table': table, 'id': row['id'], 'hash': digest(row)})


def check_token(table, row, token):
    try:
        value = signer().loads(token or '')
    except BadSignature:
        raise Conflict('页面已过期，请重新载入后再操作。')
    if value != {'table': table, 'id': row['id'], 'hash': digest(row)}:
        raise Conflict('这笔账已被其他人修改，本次没有保存。请重新载入并核对后再修改。')


def validate_date(value, default=None):
    value = str(value or default or '').strip()
    try:
        return dt.date.fromisoformat(value).isoformat()
    except ValueError:
        raise ValueError('日期格式不正确，请重新选择日期。')


@contextlib.contextmanager
def transaction():
    c = db.connect()
    try:
        c.execute('BEGIN IMMEDIATE')
        yield c
        c.commit()
    except Exception:
        c.rollback()
        raise
    finally:
        c.close()


def write_row(c, table, values, old=None):
    assert table in TABLES
    if old:
        fields = list(values)
        c.execute('UPDATE ' + table + ' SET ' + ','.join(f + '=?' for f in fields) + ' WHERE id=?',
                  [values[f] for f in fields] + [old['id']])
        rid = old['id']
    else:
        values = dict(values, created_at=db.now_str())
        if table == 'stock_items' and 'seq' not in values:
            values['seq'] = c.execute('SELECT COALESCE(MAX(seq),0)+1 FROM stock_items').fetchone()[0]
        fields = list(values)
        rid = c.execute('INSERT INTO ' + table + '(' + ','.join(fields) + ') VALUES(' +
                        ','.join('?' for _ in fields) + ')', [values[f] for f in fields]).lastrowid
    new = dict(c.execute('SELECT * FROM ' + table + ' WHERE id=?', (rid,)).fetchone())
    audit(c, '修改账目' if old else '新增账目', table, rid, old, new)
    return rid


def audit(c, action, table, rid, before, after):
    user = auth.current_user()
    detail = {'actor': user['username'] if user else 'system', 'table': table, 'id': rid,
              'before': dict(before) if before else None, 'after': dict(after) if after else None}
    c.execute('INSERT INTO audit_logs(action,detail,at) VALUES(?,?,?)',
              (action, json.dumps(detail, ensure_ascii=False), db.now_str()))


def delete_row(c, table, old):
    c.execute('DELETE FROM ' + table + ' WHERE id=?', (old['id'],))
    audit(c, '删除账目', table, old['id'], old, None)


def existing(c, table, rid):
    row = c.execute('SELECT * FROM ' + table + ' WHERE id=?', (rid,)).fetchone()
    if not row:
        raise Conflict('这笔账已被删除，请重新载入页面。')
    return dict(row)


def financial_values(rec, old=None):
    rec = dict(rec)
    if old:
        if not any(number(rec.get(k)) != number(old.get(k)) for k in FINANCIAL - {'spread'}) and (
                'spread' not in rec or number(rec['spread']) == old_spread(old)):
            # Only descriptive fields changed: retain all original amounts, including zeros.
            return {k: old[k] for k in SALE_DERIVED}
    if not has_value(rec, 'spread'):
        rec['spread'] = old_spread(old) if old else new_spread(rec)
    values = calculate_sale(rec)
    return {col: values[src] for col, src in SALE_DERIVED.items()}


def incoming_sale(old=None):
    rec = {k: str(request.form.get(k, old.get(k, '') if old else '')).strip() for k in SALE_COLUMNS}
    for k in SALE_NUMBERS:
        raw = request.form.get(k)
        if k == 'spread':
            rec[k] = number(raw) if raw not in (None, '') and number(raw) != 0 else (
                old_spread(old) if old else new_spread(rec))
        else:
            rec[k] = number(raw, old.get(k, 0) if old else db.setting('labor', '10') if k == 'labor' else 0)
    rec['date'] = validate_date(rec.get('date'), dt.date.today().isoformat())
    if rec.get('remit_date'):
        rec['remit_date'] = validate_date(rec['remit_date'])
    if not rec.get('product'):
        raise ValueError('商品不能为空。')
    rec['status'] = rec.get('status') or '已完成'
    return rec


def save_sale():
    try:
        with transaction() as c:
            rid = request.form.get('id', '')
            old = existing(c, 'sales', int(rid)) if rid else None
            if old:
                check_token('sales', old, request.form.get('snapshot'))
            rec = incoming_sale(old)
            rec.update(financial_values(rec, old))
            if request.form.get('amount_c','').strip():rec['amount_c']=number(request.form['amount_c'])
            write_row(c, 'sales', rec, old)
        flash('已保存。', 'ok')
    except (ValueError, sqlite3.Error) as e:
        flash(str(e), 'error')
    return redirect(url_for('sales.index', **({'edit': request.form['id']} if request.form.get('id') else {})))


def preserve_choices(names, values):
    return list(dict.fromkeys(list(names) + [v for v in values if v]))


def sales_index():
    start = request.args.get('s', ''); end = request.args.get('e', '')
    filters = {k: request.args.get(k, '') for k in ('staff', 'channel', 'status')}
    where = ' WHERE 1=1'; args = []
    for field, op, value in [('date', '>=', start), ('date', '<=', end)] + [(k, '=', v) for k, v in filters.items()]:
        if value:
            where += ' AND ' + field + op + '?'; args.append(value)
    rows = db.query('SELECT * FROM sales' + where + ' ORDER BY date DESC,id DESC LIMIT 800', tuple(args))
    sums = db.query('SELECT COUNT(*) cnt,' + ','.join('COALESCE(SUM(' + col + '),0) ' + key for key, col in
                    [('amount','amount_c'),('received','received'),('cost','cost'),('profit','profit_c'),
                     ('comm','comm_c'),('comm_profit','comm_profit_c'),('weight','weight')]) + ' FROM sales' + where,
                    tuple(args), one=True)
    tot = {k: calc.money(sums[k]) if k != 'weight' else round(sums[k], 4) for k in sums.keys() if k != 'cnt'}
    edit = db.query('SELECT * FROM sales WHERE id=?', (request.args['edit'],), one=True) if request.args.get('edit') else None
    history = db.query('SELECT COUNT(*) cnt,MIN(date) first_date,MAX(date) last_date FROM sales',one=True)
    source_sales = db.query("SELECT COUNT(*) cnt FROM source_rows WHERE kind='sales' AND classification IN ('业务明细','待核对','现有账目待匹配')",one=True)['cnt']
    source_links = db.query("SELECT COUNT(*) cnt FROM source_links WHERE ledger_table='sales'",one=True)['cnt']
    empty_reason = ''
    if not sums['cnt']:
        if history['cnt']:
            empty_reason = '当前筛选没有匹配记录。账本共有 '+str(history['cnt'])+' 笔销售，日期从 '+str(history['first_date'])+' 到 '+str(history['last_date'])+'。清除筛选可查看全部历史。'
        elif source_sales and not source_links:
            empty_reason = '原表已保存，但销售明细尚未导入账本。请确认导入原表，完成后这里会显示历史销售。'
        elif source_links:
            empty_reason = '销售账本目前为空，原表曾建立入账对应。请到原表对账核对记录和删除情况，或继续记一笔新销售。'
        else:
            empty_reason = '账本还没有销售记录。可以先确认导入原表，或直接记一笔销售。'
    return render_template('sales.html', rows=rows, total_count=sums['cnt'], s=start, e=end, **filters,
                           tot=tot, rate=round(tot['profit']/tot['received']*100,2) if tot['received'] else 0,
                           edit=edit, staffs=preserve_choices(db.names_of('staff'), [edit['staff']] if edit else []),
                           channels=preserve_choices(db.names_of('channels'), [edit['channel']] if edit else []),
                           statuses=preserve_choices(sheet.STATUSES, [edit['status']] if edit else []),
                           default_labor=number(db.setting('labor','10')), spread=number(db.setting('spread','40')),
                           bullion_spread=number(db.setting('spread_bullion','8.2')),
                           effective_spread=old_spread(edit) if edit else None,
                           history_count=history['cnt'],empty_reason=empty_reason,
                           source_sales_count=source_sales,source_sales_link_count=source_links)


def sheet_view(name):
    if name not in sheet.SHEETS:
        return redirect(url_for('sheet.index'))
    spec = sheet.SHEETS[name]; kw = request.args.get('kw', '').strip()
    where = ' WHERE (product LIKE ? OR order_no LIKE ?)' if kw else ''
    args = ('%' + kw + '%',) * 2 if kw else ()
    rows = [dict(x) for x in db.query('SELECT * FROM ' + spec['table'] + where + ' ORDER BY ' + spec['order'] + ' LIMIT 600', args)]
    opts = sheet._meta()
    blank = max(0, min(30, int(request.args.get('blank',0))))
    return render_template('sheet.html', name=name, spec=spec, rows=rows, totals=sheet._totals(spec,rows),
                           kw=kw, opts=opts, blank=blank, default_labor=number(db.setting('labor','10')),
                           default_spread=number(db.setting('spread','40')))


def save_sheet(name):
    if name not in sheet.SHEETS:
        return redirect(url_for('sheet.index'))
    spec = sheet.SHEETS[name]; table = spec['table']; changes = 0
    try:
        with transaction() as c:
            for rid in dict.fromkeys(request.form.getlist('rowids')):
                old = None
                if rid.isdigit():
                    if not request.form.get('dirty_' + rid) and not request.form.get('del_' + rid):
                        continue
                    old = existing(c, table, int(rid))
                    check_token(table, old, request.form.get('snapshot_' + rid))
                    if request.form.get('del_' + rid):
                        delete_row(c,table,old); changes += 1; continue
                elif not rid.startswith('n'):
                    raise ValueError('无效的行号。')
                rec = {}
                for field, _label, kind, is_calc in spec['cols']:
                    if is_calc:
                        continue
                    key = 'c_' + rid + '_' + field
                    raw = request.form.get(key, old.get(field,'') if old else '')
                    if kind == 'num':
                        rec[field] = number(raw, db.setting('labor','10') if field=='labor' and not old else 0)
                    else:
                        rec[field] = str(raw or '').strip()
                if not old and not rec.get('product'):
                    continue
                if not rec.get('product'):
                    raise ValueError('商品不能为空；删除请勾选“删”。')
                if name == 'sales':
                    rec['date'] = validate_date(rec.get('date'),dt.date.today().isoformat())
                    if rec.get('remit_date'):rec['remit_date']=validate_date(rec['remit_date'])
                    rec['spread'] = old_spread(old) if old else new_spread(rec)
                    rec['status'] = rec.get('status') or '已完成'
                    rec.update(financial_values(rec,old))
                else:
                    if old:rec['rule_version']=old.get('rule_version',0)
                    rec['in_date'] = validate_date(rec.get('in_date'),dt.date.today().isoformat())
                    if rec.get('sell_date'):rec['sell_date']=validate_date(rec['sell_date'])
                    rec['remark'] = rec.get('remark') or (old['remark'] if old else '在库')
                    rec['profit_c'] = old['profit_c'] if old and all(number(rec[k])==number(old[k]) for k in ['cost','sell_price']) else calc.calc_stock(rec)['profit']
                write_row(c,table,rec,old); changes += 1
        flash('已保存 %d 行修改。' % changes,'ok')
    except (ValueError,sqlite3.Error) as e:
        flash(str(e) + ' 本次整批修改未写入。','error')
    return redirect(url_for('sheet.view',name=name))


def add_sheet(name):
    # Adding rows must not discard unsaved edits.
    result = save_sheet(name)
    if any(category == 'error' for category, _message in __import__('flask').session.get('_flashes', [])):
        return result
    return redirect(url_for('sheet.view',name=name,blank=max(1,min(30,int(request.form.get('n','3'))))))


def material_rows(c, date):
    return [dict(x) for x in c.execute('SELECT * FROM material_stock WHERE date=? ORDER BY id',(date,))]


def day_token(date, rows):
    return signer().dumps({'date':date,'rows':rows})


def material_page():
    rows = [dict(x) for x in db.query('SELECT * FROM material_stock ORDER BY date DESC,supplier,id')]
    suppliers = preserve_choices(db.names_of('suppliers'),[x['supplier'] for x in rows])
    dates = OrderedDict()
    for row in rows:
        dates.setdefault(row['date'],[]).append(row)
    today = dt.date.today().isoformat()
    if request.args.get('newday') and today not in dates:
        dates[today]=[]
    day_rows=[]
    for date, group in dates.items():
        cells={}
        for row in group:
            cell=cells.setdefault(row['supplier'],dict(grams=0.0,amount=0.0))
            cell['grams']+=row['grams'];cell['amount']+=row['amount']
        ordered=sorted(group,key=lambda x:x['id'])
        day_rows.append(dict(date=date,cells=cells,grams=sum(x['grams'] for x in cells.values()),
                             amount=sum(x['amount'] for x in cells.values()),snapshot=day_token(date,ordered)))
    return render_template('sheet_material.html',sups=suppliers,day_rows=day_rows,totals={
        '板料合计(g)':round(sum(x['grams'] for x in rows),4), '金额合计':calc.money(sum(x['amount'] for x in rows))},
        today=today,newday=False)


def save_material_sheet():
    changed=0
    try:
        with transaction() as c:
            for date in dict.fromkeys(request.form.getlist('dates')):
                validate_date(date)
                try: snapshot=signer().loads(request.form.get('snapshot_'+date,''))
                except BadSignature:raise Conflict('存料费页面已过期，请重新载入。')
                if snapshot.get('date') != date:raise Conflict('存料费日期不一致，请重新载入。')
                oldrows=snapshot['rows'];actual=material_rows(c,date)
                suppliers=preserve_choices(db.names_of('suppliers'),[x['supplier'] for x in oldrows])
                cells={}
                for row in oldrows:
                    cell=cells.setdefault(row['supplier'],[0.0,0.0]);cell[0]+=row['grams'];cell[1]+=row['amount']
                modifications=[]
                for supplier in suppliers:
                    gkey='g_'+date+'_'+supplier;akey='a_'+date+'_'+supplier
                    if gkey not in request.form or akey not in request.form:continue
                    grams=number(request.form[gkey]);amount=number(request.form[akey])
                    oldvalue=cells.get(supplier,[0.0,0.0])
                    if grams!=oldvalue[0] or amount!=oldvalue[1]:modifications.append((supplier,grams,amount))
                delete=bool(request.form.get('deldate_'+date))
                if not modifications and not delete:continue
                if serial({'rows':actual})!=serial({'rows':oldrows}):
                    raise Conflict('这一天的存料费已被其他人修改，请重新载入。')
                if delete:
                    for row in actual:delete_row(c,'material_stock',row);changed+=1
                else:
                    for supplier,grams,amount in modifications:
                        matches=[x for x in actual if x['supplier']==supplier]
                        # Consolidate any legacy duplicates only when this cell is edited.
                        for duplicate in matches[1:]:delete_row(c,'material_stock',duplicate)
                        values=dict(date=date,supplier=supplier,grams=grams,amount=amount,
                                    note=matches[0]['note'] if matches else '')
                        if grams==0 and amount==0:
                            for row in matches[:1]:delete_row(c,'material_stock',row)
                        else:write_row(c,'material_stock',values,matches[0] if matches else None)
                        changed+=1
        flash('存料费已保存 %d 格修改。' % changed,'ok')
    except (ValueError,sqlite3.Error) as e:
        flash(str(e)+' 本次整批修改未写入。','error')
        return redirect(url_for('sheet.material'))
    return redirect(url_for('sheet.material',**({'newday':1} if request.form.get('newday') else {})))


def save_material():
    try:
        date=validate_date(request.form.get('date'),dt.date.today().isoformat())
        supplier=request.form.get('supplier','').strip()
        if not supplier:raise ValueError('供货商不能为空。')
        with transaction() as c:
            matches=[dict(x) for x in c.execute('SELECT * FROM material_stock WHERE date=? AND supplier=? ORDER BY id',(date,supplier))]
            # For overwrite, require the page snapshot for that existing day/supplier.
            if matches:
                try:baseline=signer().loads(request.form.get('material_snapshot',''))
                except BadSignature:raise Conflict('页面已过期，请重新载入。')
                keyed=baseline.get(date+'\n'+supplier)
                if keyed != [digest(x) for x in matches]:raise Conflict('存料费已被其他人修改，请重新载入。')
            for row in matches[1:]:delete_row(c,'material_stock',row)
            write_row(c,'material_stock',dict(date=date,supplier=supplier,grams=number(request.form.get('grams')),
                      amount=number(request.form.get('amount')),note=request.form.get('note','').strip()),matches[0] if matches else None)
        flash('存料费已保存。','ok')
    except (ValueError,sqlite3.Error) as e:flash(str(e),'error')
    return redirect(url_for('material.index'))


def save_stock():
    try:
        with transaction() as c:
            rid=request.form.get('id');old=existing(c,'stock_items',int(rid)) if rid else None
            if old:check_token('stock_items',old,request.form.get('snapshot'))
            rec={k:request.form.get(k,old.get(k,'') if old else '').strip() for k in stock.FIELDS}
            if not rec['product']:raise ValueError('商品不能为空。')
            for k in ['weight','cost','sell_price']:rec[k]=number(rec[k])
            rec['in_date']=validate_date(rec['in_date'],dt.date.today().isoformat())
            rec['remark']=rec['remark'] or '在库'
            if old:rec['rule_version']=old.get('rule_version',0)
            if rec['sell_date']:rec['sell_date']=validate_date(rec['sell_date'])
            rec['profit_c']=old['profit_c'] if old and all(number(rec[k])==number(old[k]) for k in ['cost','sell_price']) else calc.calc_stock(rec)['profit']
            write_row(c,'stock_items',rec,old)
        flash('库存已保存。','ok')
    except (ValueError,sqlite3.Error) as e:flash(str(e),'error')
    return redirect(url_for('stock.index',state=request.form.get('back_state','在库')))


def mark_stock(rid):
    try:
        with transaction() as c:
            old=existing(c,'stock_items',rid);check_token('stock_items',old,request.form.get('snapshot'))
            date=validate_date(request.form.get('sell_date'),dt.date.today().isoformat())
            write_row(c,'stock_items',dict(remark='已售'+date.replace('-','.'),sell_date=date),old)
        flash('已标记为已售。','ok')
    except (ValueError,sqlite3.Error) as e:flash(str(e),'error')
    return redirect(url_for('stock.index',state=request.args.get('state','在库')))


def delete_view(table,endpoint):
    def delete(rid):
        try:
            with transaction() as c:
                old=existing(c,table,rid);check_token(table,old,request.form.get('snapshot'))
                delete_row(c,table,old)
            flash('已删除。','ok')
        except (ValueError,sqlite3.Error) as e:flash(str(e),'error')
        return redirect(url_for(endpoint))
    return delete


def master_index():
    if request.method=='POST' and request.form.get('act')=='settings':
        try:
            values={k:number(request.form.get(k)) for k in ['labor','spread','spread_bullion']}
            if any(v<0 for v in values.values()):raise ValueError('默认工费和点差不能为负数。')
            with transaction() as c:
                before=dict(c.execute('SELECT k,v FROM settings WHERE k IN (?,?,?)',tuple(values)).fetchall())
                for k,v in values.items():c.execute('INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v',(k,str(v)))
                audit(c,'修改算法参数','settings',None,before,values)
            flash('参数已保存。新单使用新参数，历史单据保留原值。','ok')
        except (ValueError,sqlite3.Error) as e:flash(str(e),'error')
        return redirect(url_for('master.index'))
    return _original_master()


def backup(label='每日',force=False,refresh=False):
    """SQLite consistent snapshot plus original workbooks and session secret, atomically zipped."""
    with _backup_lock:
        directory=config.data_dir();source=config.db_path()
        if not source.exists():return None
        folder=config.backup_dir();day=dt.date.today().strftime('%Y%m%d')
        target=folder/(label+'_'+day+('_'+dt.datetime.now().strftime('%H%M%S_%f') if force else '')+'.zip')
        if target.exists() and not force and not refresh:return target
        with tempfile.TemporaryDirectory(prefix='ledger-backup-',dir=folder) as temp:
            temp=pathlib.Path(temp);snapshot=temp/'ledger.db';archive=temp/'backup.zip'
            with contextlib.closing(sqlite3.connect(source,timeout=30)) as src,contextlib.closing(sqlite3.connect(snapshot)) as dest:
                src.backup(dest,pages=200,sleep=0.05)
            with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
                z.write(snapshot,'ledger.db')
                secret=directory/'secret.key'
                if secret.exists():z.write(secret,'secret.key')
                for name in ['上传的原表','原表归档','报销凭证','联动表格']:
                    upload=directory/name
                    if upload.exists():
                        for p in upload.rglob('*'):
                            if p.is_file():z.write(p,p.relative_to(directory).as_posix())
                z.writestr('备份信息.txt','版本 '+VERSION+'\n时间 '+db.now_str()+'\n恢复前请关闭软件，保留当前 data 副本，再将备份文件解压到 data。\n')
            os.replace(archive,target)
        return target


def run_backup(app):
    try:
        path=backup(refresh=True)
        if path:app.config['BACKUP_STATUS']='最近备份：'+path.name+'（'+dt.datetime.now().strftime('%H:%M:%S')+'）'
        app.config['BACKUP_ERROR']=''
    except Exception as e:
        app.config['BACKUP_ERROR']='自动备份失败：'+str(e)
        app.logger.exception('自动备份失败')


def create_app():
    # Upgrade snapshot is taken before the original initialization can alter anything.
    source=config.db_path()
    if source.exists():
        with contextlib.closing(sqlite3.connect(source)) as c:
            try:version=c.execute('SELECT v FROM settings WHERE k=?',('repairs_version',)).fetchone()
            except sqlite3.Error:version=None
        if not version or version[0]!=VERSION:backup('升级前',force=True)
    app=_original_create()
    app.config.update(MAX_FORM_MEMORY_SIZE=16*1024*1024,MAX_FORM_PARTS=50000,BACKUP_STATUS='',BACKUP_ERROR='')
    app.jinja_env.globals.update(row_token=row_token)
    @app.context_processor
    def backup_info():
        return dict(backup_status=app.config.get('BACKUP_STATUS',''),backup_error=app.config.get('BACKUP_ERROR',''))
    @app.before_request
    def authorize_writes():
        if request.method in ['POST','PUT','PATCH','DELETE'] and request.endpoint not in ['auth.login','auth.password']:
            user=auth.current_user()
            if not user:return redirect(url_for('auth.login'))
            if user['must_change_pw']:return redirect(url_for('auth.password'))
            if user['role'] not in ['admin','bookkeeper']:abort(403)
            if request.endpoint in ['auth.users','master.users','source.upload','enhanced.source_upload','enhanced.source_import'] and user['role']!='admin':abort(403)
    endpoints={'sales.index':sales_index,'sales.save':save_sale,'sheet.view':sheet_view,'sheet.save':save_sheet,
               'sheet.add':add_sheet,'sheet.material':material_page,'sheet.material_save':save_material_sheet,
               'material.save':save_material,'stock.save':save_stock,'stock.mark':mark_stock,'master.index':master_index,
               'sales.delete':delete_view('sales','sales.index'),'stock.delete':delete_view('stock_items','stock.index'),
               'material.delete':delete_view('material_stock','material.index')}
    for name,fn in endpoints.items():app.view_functions[name]=auth.login_required(fn)
    with app.app_context():
        db.execute('INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v',('repairs_version',VERSION))
    import enhancements
    enhancements.configure(app)
    run_backup(app)
    if not os.environ.get('LEDGER_DISABLE_BACKUP_THREAD'):
        pending=threading.Event()
        @app.after_request
        def schedule_backup(response):
            if request.method=='POST' and response.status_code<400:
                pending.set()
            return response
        def worker():
            while True:
                pending.wait(60);pending.clear();run_backup(app)
        threading.Thread(target=worker,name='daily-backup',daemon=True).start()
    return app


def home_render(template,**kw):
    if template=='home.html':
        kw['stock_in']=sum(stock.is_in_stock(x['remark']) for x in db.query('SELECT remark FROM stock_items'))
    return render_template(template,**kw)


def material_render(template,**kw):
    if template=='material.html':
        groups={}
        for row in db.query('SELECT * FROM material_stock ORDER BY id'):
            groups.setdefault(row['date']+'\n'+row['supplier'],[]).append(digest(row))
        kw['material_snapshot']=signer().dumps(groups)
    return render_template(template,**kw)


_original_create=original.create_app
_original_master=master.index


def install():
    global _installed
    if _installed:return
    _installed=True
    config.APP_VERSION=VERSION
    calc._has=has_value;calc.calc_sale=calculate_sale
    sales.calc_sale=calculate_sale;sheet.calc_sale=calculate_sale
    sheet.SHEETS['sales']['calc']=calculate_sale
    home.render_template=home_render;material.render_template=material_render
    original.create_app=create_app
