"""Current inventory, precise platinum conversion, alert settings and live home."""
import collections
import contextlib
import csv
import datetime
from decimal import Decimal, InvalidOperation
import json
import io
import math
import re
import sqlite3

from flask import Blueprint, Response, abort, flash, jsonify, redirect, render_template, request, url_for
from app import auth, db
import repairs as r
import finance
from presentation import fmt2
import rule_engine as rules

bp = Blueprint('inventory_dashboard', __name__)
SCHEMA = '''CREATE TABLE IF NOT EXISTS inventory_alert_settings(
    id INTEGER PRIMARY KEY CHECK(id=1),lower_limit REAL,upper_limit REAL,
    revision INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL,actor TEXT NOT NULL)'''
STATES = ('在库', '在途', '已售', '待确认')


def inventory_state(row):
    """A recorded sale date wins over a stale or blank inventory remark."""
    if str(row.get('sell_date') or '').strip(): return '已售'
    remark = str(row.get('remark') or '').strip()
    if not remark: return '在库'

    def field_state(value):
        if value in ('在库', '现货', '已入库'): return '在库'
        if value in ('在途', '途中', '待到货', '未到货'): return '在途'
        if value == '待确认': return '待确认'
        date = r'\d{4}[.\-/年]\d{1,2}[.\-/月]\d{1,2}日?'
        if re.fullmatch(r'(?:已售|售出|已卖)(?:\s*' + date + r')?', value): return '已售'
        return None

    # _remark() writes a complete leading state, then a semicolon and notes.
    # Whitespace or an arbitrary suffix is not a state-field boundary.
    lines = re.split(r'[\r\n]+', remark)
    state = field_state(re.split(r'[；;|，,]+', lines[0])[0].strip())
    if state is None: return '待确认'
    for line_index, line in enumerate(lines):
        for field_index, field in enumerate(re.split(r'[；;|，,]+', line)):
            value = field.strip()
            if not value or (line_index == 0 and field_index == 0): continue
            # A labelled appendix covers this line only. A following line may
            # contain an independent conflicting state that still needs review.
            if re.match(r'^(?:备注|说明|附注|附加备注)\s*[:：]', value): break
            other = field_state(value)
            if other is not None:
                if other != state: return '待确认'
            else:
                denied = re.fullmatch(r'(?:不(?:是)?|并非|非|没有|尚未|还未|并未|未)\s*(.+)', value)
                if denied:
                    target = denied.group(1)
                    if field_state(target) == state: return '待确认'
                    if state == '在库' and target == '入库': return '待确认'
                    if state == '已售' and target in ('卖出', '出售'): return '待确认'
    return state


def platinum_identity(row):
    """Apply the operator's board x1 rule, then identify other platinum purity."""
    category = str(row.get('category') or '')
    product = str(row.get('product') or '')
    text = category + ' ' + product
    platinum = '铂' in text or '白金' in text or bool(re.search(r'(?i)(?<![A-Z0-9])PT\s*\d', text))
    if not platinum: return 'other', None
    # Conflicting metal labels are left for the operator rather than guessed.
    if '银' in category or re.search(r'黄金|足金|白银|纯银|足银|银饰|(?i:AU\s*\d|AG\s*\d|S\s*(?:925|999))', text):
        return 'unknown_pt', None
    board = '板料' in text
    # The final operator instruction counts every explicitly platinum board
    # at x1.  Board classification therefore wins over a PT950 name.
    if board: return 'fine_board', Decimal('1')
    pt950 = bool(re.search(r'(?i)(?<![A-Z0-9])PT\s*950(?![\d.])', text) or
                 re.search(r'(?:铂金|白金|铂)\s*950(?![\d.])|(?<![\d.])950\s*(?:铂金|白金|铂)', text))
    if pt950: return 'pt950', Decimal('0.95')
    pure = '足铂' in text or bool(re.search(r'(?i)(?<![A-Z0-9])PT\s*999(?:\.5)?(?![\d.])', text) or
              re.search(r'(?:铂金|白金|铂)\s*999(?:\.5)?(?![\d.])|(?<![\d.])999(?:\.5)?\s*(?:铂金|白金|铂)', text))
    # The original confirmed PT999.5 platinum beans also count at x1.
    if '金豆' in text and pure: return 'fine_board', Decimal('1')
    return 'unknown_pt', None


def _grams(value):
    if value is None or isinstance(value, str) and not value.strip(): return None
    try:
        number = Decimal(str(value))
        return number if number.is_finite() and number >= 0 else None
    except (ValueError, InvalidOperation): return None


def _thresholds(c):
    exists = c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='inventory_alert_settings'").fetchone()
    row = c.execute('SELECT * FROM inventory_alert_settings WHERE id=1').fetchone() if exists else None
    return {'lower': row['lower_limit'] if row else None, 'upper': row['upper_limit'] if row else None,
            'revision': row['revision'] if row else 0, 'updated_at': row['updated_at'] if row else ''}


def snapshot(c=None, month=None):
    """Read one explicit source period; entry dates never determine carryover."""
    if c is None:
        with contextlib.closing(db.connect()) as connection:
            return snapshot(connection, month)
    rows = [dict(row) for row in c.execute('SELECT * FROM stock_items ORDER BY id')]
    month = str(db.now_str())[:7] if month is None else month
    scope = {'mode': 'legacy_flat', 'month': month, 'available_months': [], 'complete': True,
             'excluded_count': 0, 'unassigned_count': 0, 'conflicts': [],
             'message': '旧式平面库存未按来源年月分期，显示完整平面台账，不作为月末历史快照。'}
    # Inspect only links to existing stock records. An archived/reference sheet
    # with no stock link must not choose the period or document for this view.
    source_tables = {row[0] for row in c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('source_rows','source_links')")}
    observations = []
    if source_tables == {'source_rows', 'source_links'}:
        observations = [dict(row) for row in c.execute("""SELECT l.ledger_id,s.document_id,s.sheet
            FROM source_links l JOIN source_rows s ON s.id=l.source_row_id
            JOIN stock_items stock ON stock.id=l.ledger_id
            WHERE l.ledger_table='stock_items' AND s.kind='stock'""")]
    def sheet_period(name):
        matches = re.findall(r'(?<![0-9])([1-9][0-9]{3})(?:年|[./-])([0-9]{1,2})月(?![0-9])', str(name))
        if len(matches) != 1: return None
        year, mon = map(int, matches[0])
        return '%04d-%02d' % (year, mon) if 1 <= mon <= 12 else None
    periods = {}; documents = {}
    month_named = False
    for observation in observations:
        period = sheet_period(observation['sheet'])
        month_named = month_named or bool(re.search(r'[0-9]+\s*月', str(observation['sheet'])))
        if period:
            periods.setdefault(observation['ledger_id'], set()).add(period)
            documents.setdefault(period, set()).add(observation['document_id'])
    scope['available_months'] = sorted(documents)
    all_count = len(rows)
    if documents or month_named:
        scope['unassigned_count'] = sum(row['id'] not in periods for row in rows)
    if not isinstance(month, str) or not re.fullmatch(r'[1-9][0-9]{3}-(?:0[1-9]|1[0-2])', month):
        rows = []; scope.update(mode='invalid_month', complete=False, message='请选择明确的 YYYY-MM 年月，不会改用其他月份。')
    elif source_tables and source_tables != {'source_rows', 'source_links'}:
        rows = []; scope.update(mode='needs_period', complete=False, unassigned_count=all_count,
                                conflicts=['INCOMPLETE_SOURCE_METADATA'], message='库存来源对应不完整，暂不能确认月份和完整合计。')
    elif documents or month_named:
        if not documents:
            rows = []; scope.update(mode='needs_period', complete=False,
                                    message='已关联的库存表缺少明确合法年份和月份，暂不推断归属或合计。')
        elif month not in documents:
            rows = []; scope.update(mode='missing', complete=False,
                                    message='所选月份没有已入账库存来源，不会回落或累计其他月份。')
        elif len(documents[month]) != 1:
            rows = []; scope.update(mode='needs_source', complete=False, conflicts=['MULTIPLE_DOCUMENTS'],
                                    message='所选月份有多个已入账来源文件，需先确认权威来源，暂不作完整合计。')
        else:
            rows = [row for row in rows if month in periods.get(row['id'], set())]
            shared = any(len(periods[row['id']]) > 1 for row in rows)
            complete = not shared and scope['unassigned_count'] == 0
            scope.update(mode='monthly', complete=complete,
                         conflicts=['SHARED_PERIOD_RECORD'] if shared else [],
                         message='按所选年月的已入账库存表统计；其他月份仅作历史参考，不叠加数量或成本。')
            if shared:
                scope['message'] = '部分库存ID关联多个月份，当前值不能证明各月历史快照；本次范围尚不完整。'
            elif scope['unassigned_count']:
                scope['message'] = '仅显示所选月份已确认来源；另有库存未明确归属年月，本次范围尚不完整。'
    scope['excluded_count'] = all_count - len(rows)
    overall = {state: {'count': 0, 'grams': Decimal(0), 'invalid_count': 0} for state in ('in_stock', 'transit', 'sold', 'unknown')}
    states = {'在库': 'in_stock', '在途': 'transit', '已售': 'sold', '待确认': 'unknown'}
    buckets = {state: {kind: {'count': 0, 'grams': Decimal(0), 'fine_grams': Decimal(0), 'invalid_count': 0}
                      for kind in ('pt950', 'fine_board', 'unknown_pt')}
               for state in ('in_stock', 'transit')}
    suppliers = {}; categories = {}; invalid = []
    for row in rows:
        status = inventory_state(row); state = states[status]
        bucket, factor = platinum_identity(row); grams = _grams(row.get('weight'))
        row.update(inventory_state=status, platinum_bucket=bucket,
                   purity_factor=float(factor) if factor is not None else None,
                   fine_grams=float(grams * factor) if grams is not None and factor is not None else None,
                   weight_issue=('克重缺失' if row.get('weight') is None or isinstance(row.get('weight'), str) and not row['weight'].strip()
                                 else '克重无效或为负数') if grams is None else '')
        overall[state]['count'] += 1
        item = buckets[state][bucket] if state in buckets and bucket in buckets[state] else None
        if item is not None: item['count'] += 1
        grouped_items = []
        if status == '在库':
            for grouped, field in ((suppliers, 'supplier'), (categories, 'category')):
                name = str(row.get(field) or '未指定')
                group = grouped.setdefault(name, {'name': name, 'count': 0, 'grams': Decimal(0), 'fine_grams': Decimal(0),
                                                  'invalid_count': 0, 'fine_invalid_count': 0})
                group['count'] += 1; grouped_items.append(group)
        if grams is None:
            overall[state]['invalid_count'] += 1
            if item is not None: item['invalid_count'] += 1
            for group in grouped_items:
                group['invalid_count'] += 1
                if factor is not None: group['fine_invalid_count'] += 1
            invalid.append({'id': row['id'], 'product': row.get('product', ''), 'reason': row['weight_issue']})
            continue
        overall[state]['grams'] += grams
        if item is not None:
            item['grams'] += grams
            if factor is not None: item['fine_grams'] += grams * factor
        for group in grouped_items:
            group['grams'] += grams
            if factor is not None: group['fine_grams'] += grams * factor
    def numeric(item):
        result = {k: float(v) if isinstance(v, Decimal) else v for k, v in item.items()}
        result['weight_complete'] = item['invalid_count'] == 0
        if 'fine_grams' in item: result['fine_complete'] = item.get('fine_invalid_count', item['invalid_count']) == 0
        return result
    overall = {k: numeric(v) for k, v in overall.items()}
    quantities = {}
    for state, items in buckets.items():
        quantities[state] = {k: numeric(v) for k, v in items.items()}
        quantities[state]['fine_grams'] = float(items['pt950']['fine_grams'] + items['fine_board']['fine_grams'])
        quantities[state]['fine_complete'] = items['pt950']['invalid_count'] == 0 and items['fine_board']['invalid_count'] == 0
    limits = _thresholds(c); fine = quantities['in_stock']['fine_grams']
    if not scope['complete']:
        alert = {'status': 'incomplete', 'text': '来源范围未完整确认，暂不作足铂预警比较', 'difference': 0}
    elif not quantities['in_stock']['fine_complete']:
        alert = {'status': 'incomplete', 'text': '在库足铂相关记录存在克重异常，请先核对，暂不作足铂预警比较', 'difference': 0}
    elif limits['lower'] is not None and fine < limits['lower']:
        alert = {'status': 'low', 'text': '低于预警下限', 'difference': limits['lower'] - fine}
    elif limits['upper'] is not None and fine > limits['upper']:
        alert = {'status': 'high', 'text': '高于预警上限', 'difference': fine - limits['upper']}
    elif limits['lower'] is None and limits['upper'] is None:
        alert = {'status': 'unset', 'text': '尚未设置预警上下限', 'difference': 0}
    else:
        alert = {'status': 'normal', 'text': '在预警范围内', 'difference': 0}
    return {'overall': overall, **quantities, 'thresholds': limits, 'alert': alert,
            'by_supplier': [numeric(suppliers[name]) for name in sorted(suppliers)],
            'by_category': [numeric(categories[name]) for name in sorted(categories)],
            'rows': rows, 'invalid_rows': invalid, 'scope': scope, 'updated_at': db.now_str()}


def _sales(c, start=None, end=None):
    where = ' WHERE date>=? AND date<=?' if start is not None else ''
    params = (start, end) if start is not None else ()
    value = dict(c.execute('''SELECT COUNT(*) count,COALESCE(SUM(amount_c),0) amount,
        COALESCE(SUM(received),0) received,COALESCE(SUM(cost),0) cost,
        COALESCE(SUM(profit_c),0) profit,COALESCE(SUM(comm_c),0) commission,
        COALESCE(SUM(comm_profit_c),0) commission_profit,COALESCE(SUM(weight),0) weight
        FROM sales''' + where, params).fetchone())
    value['gross_rate'] = value['profit'] / value['received'] if value['received'] else 0
    return value


def dashboard(month):
    start, end = finance.month_bounds(month)
    with contextlib.closing(db.connect()) as c:
        c.execute('BEGIN')
        current = _sales(c, start, end); cumulative = _sales(c)
        wages = [json.loads(row[0]) for row in c.execute("SELECT outputs_json FROM payroll_records WHERE month=? AND status IN ('已确认','已发放')", (month,))]
        wage_cost = math.fsum(float(item.get('应发工资', 0)) for item in wages)
        expenses = c.execute("SELECT COALESCE(SUM(amount),0) FROM expenses WHERE date>=? AND date<=? AND status IN ('已审核','已支付')", (start, end)).fetchone()[0]
        net, version = rules.compute('overview', {'销售利润': current['profit'], '工资成本': wage_cost, '报销费用': expenses})
        inventory = snapshot(c, month)
        # Stored *_c fields are the spreadsheet's live calculated results.
        recent = [dict(row) for row in c.execute('SELECT * FROM sales ORDER BY id DESC LIMIT 10')]
        staff = [dict(row) for row in c.execute('''SELECT CASE WHEN staff='' THEN '未指定' ELSE staff END name,
            COUNT(*) count,SUM(amount_c) amount,SUM(profit_c) profit,SUM(comm_c) commission FROM sales
            WHERE date>=? AND date<=? GROUP BY staff ORDER BY amount DESC''', (start, end))]
        return {'month': month, 'start': start, 'end': end, 'sales': current, 'cumulative': cumulative,
                'wage_cost': wage_cost, 'expense_cost': expenses, 'net': net['经营结余'], 'rule_version': version,
                'inventory': inventory, 'recent': recent, 'staff': staff, 'updated_at': db.now_str()}


def _month():
    current = datetime.date.today().strftime('%Y-%m')
    month = request.args.get('month', current)
    try: finance.month_bounds(month)
    except ValueError: return current
    return month


@auth.login_required
def home():
    data = dashboard(_month())
    data['default_notice'] = ''
    return render_template('home.html', data=data, readonly=auth.current_user()['role'] == 'viewer')


@bp.get('/api/dashboard')
@auth.login_required
def live():
    response = jsonify(ok=True, data=dashboard(_month()))
    response.headers['Cache-Control'] = 'no-store'
    return response


def _write_allowed():
    if auth.current_user()['role'] not in ('admin', 'bookkeeper'): abort(403)


@bp.post('/inventory/alerts')
@auth.login_required
def set_alerts():
    _write_allowed()
    payload = request.get_json(silent=True) or {} if request.is_json else request.form
    try:
        with r.transaction() as c:
            current = _thresholds(c)
            if int(payload.get('revision', '-1')) != current['revision']:
                raise r.Conflict('预警上下限已被其他窗口修改，请刷新后再保存。')
            def limit(name):
                value = str(payload.get(name, '') if payload.get(name) is not None else '').strip()
                if not value: return None
                number = r.number(value)
                if number < 0: raise ValueError('预警上下限不能为负数。')
                return number
            lower, upper = limit('lower'), limit('upper')
            if lower is not None and upper is not None and lower > upper:
                raise ValueError('预警下限不能大于上限。')
            c.execute('''INSERT INTO inventory_alert_settings(id,lower_limit,upper_limit,revision,updated_at,actor)
                VALUES(1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET lower_limit=excluded.lower_limit,
                upper_limit=excluded.upper_limit,revision=excluded.revision,updated_at=excluded.updated_at,actor=excluded.actor''',
                      (lower, upper, current['revision'] + 1, db.now_str(), auth.current_user()['username']))
            r.audit(c, '修改足铂库存预警', 'inventory_alert_settings', 1, current,
                    {'lower': lower, 'upper': upper, 'revision': current['revision'] + 1})
        flash('足铂库存预警已保存。', 'ok')
        if request.is_json: return jsonify(ok=True, thresholds={'lower': lower, 'upper': upper, 'revision': current['revision'] + 1})
    except (ValueError, sqlite3.Error) as error:
        if request.is_json: return jsonify(ok=False, error=str(error)), 409 if isinstance(error, r.Conflict) else 400
        flash(str(error), 'error')
    return redirect(url_for('home.index', month=request.form.get('month', datetime.date.today().strftime('%Y-%m'))))


def _remark(old, status, sold_date=''):
    text = str(old or '')
    text = re.sub(r'(?:已售|售出|已卖)\s*(?:\d{4}[.\-/年]\d{1,2}[.\-/月]\d{1,2}日?)?', '', text)
    text = re.sub(r'在库|现货|已入库|在途|途中|待到货|未到货', '', text).strip(' ；;,，|')
    prefix = '已售' + sold_date.replace('-', '.') if status == '已售' else status
    return prefix + ('；' + text if text else '')


@bp.post('/inventory/<int:rid>/status')
@auth.login_required
def set_status(rid):
    _write_allowed()
    payload = request.get_json(silent=True) or {} if request.is_json else request.form
    current_month = datetime.date.today().strftime('%Y-%m')
    back_month = payload.get('back_month', current_month)
    valid_month = isinstance(back_month, str) and re.fullmatch(r'[1-9][0-9]{3}-(?:0[1-9]|1[0-2])', back_month)
    try:
        if not valid_month: raise ValueError('返回月份必须是明确的 YYYY-MM，未保存库存状态。')
        with r.transaction() as c:
            old = r.existing(c, 'stock_items', rid)
            r.check_token('stock_items', old, payload.get('snapshot'))
            status = payload.get('inventory_state', '')
            if status not in STATES[:3]: raise ValueError('请选择在库、在途或已售。')
            sold = r.validate_date(payload.get('sell_date'), datetime.date.today().isoformat()) if status == '已售' else ''
            r.write_row(c, 'stock_items', {'remark': _remark(old['remark'], status, sold), 'sell_date': sold}, old)
            saved = r.existing(c, 'stock_items', rid)
            if inventory_state(saved) != status or saved['sell_date'] != sold:
                raise ValueError('关联原表的备注或售出日期由公式计算，请先修改原表对应公式，再调整库存状态。')
        if request.is_json: return jsonify(ok=True, inventory_state=status)
        flash('库存状态已更新，关联原表备注同步更新。', 'ok')
    except (ValueError, sqlite3.Error) as error:
        if request.is_json: return jsonify(ok=False, error=str(error)), 409 if isinstance(error, r.Conflict) else 400
        flash(str(error), 'error')
    return redirect(url_for('stock.index', state=request.form.get('back_state', '全部'), month=back_month if valid_month else current_month))


@bp.post('/inventory/new')
@auth.login_required
def save_stock():
    _write_allowed()
    current_month = datetime.date.today().strftime('%Y-%m')
    back_month = request.form.get('back_month', current_month)
    valid_month = isinstance(back_month, str) and re.fullmatch(r'[1-9][0-9]{3}-(?:0[1-9]|1[0-2])', back_month)
    try:
        if not valid_month: raise ValueError('返回月份必须是明确的 YYYY-MM，未新增库存。')
        with r.transaction() as c:
            record = {key: request.form.get(key, '').strip() for key in r.stock.FIELDS}
            if not record['product']: raise ValueError('商品不能为空。')
            if _grams(record['weight']) is None:
                raise ValueError('克重缺失、非数或为负数，请核对后填写；未填克重不能按 0 保存。')
            for key in ('weight', 'cost', 'sell_price'):
                record[key] = r.number(record[key])
                if record[key] < 0: raise ValueError('克重和金额不能为负数。')
            record['in_date'] = r.validate_date(record['in_date'], datetime.date.today().isoformat())
            status = request.form.get('inventory_state', '在库')
            if status not in STATES[:3]: raise ValueError('请选择在库、在途或已售。')
            record['sell_date'] = r.validate_date(record['sell_date'], datetime.date.today().isoformat()) if status == '已售' else ''
            record['remark'] = _remark(record['remark'], status, record['sell_date'])
            record['profit_c'] = r.calc.calc_stock(record)['profit']
            r.write_row(c, 'stock_items', record)
        flash('库存已保存，已自动对应原表类目和月份。', 'ok')
    except (ValueError, sqlite3.Error) as error: flash(str(error), 'error')
    return redirect(url_for('stock.index', state=request.form.get('back_state', '在库'), month=back_month if valid_month else current_month))


def _stock_rows(inventory, state, category, supplier, keyword):
    """Use the same complete filtered set for the page and its CSV export."""
    rows = []
    for row in inventory['rows']:
        if state != '全部' and row['inventory_state'] != state: continue
        if category and row['category'] != category: continue
        if supplier and row['supplier'] != supplier: continue
        if keyword and keyword.casefold() not in (str(row['product']) + ' ' + str(row['order_no'])).casefold(): continue
        rows.append(row)
    return sorted(rows, key=lambda row: row['id'], reverse=True)


@bp.get('/inventory/export.csv')
@auth.login_required
def export_stock():
    """Export this page's filters; keep the original legacy export untouched."""
    state = request.args.get('state', '在库')
    if state not in STATES + ('全部',): state = '在库'
    category = request.args.get('cat', ''); supplier = request.args.get('sup', ''); keyword = request.args.get('kw', '').strip()
    rows = _stock_rows(snapshot(month=_month()), state, category, supplier, keyword)
    data = io.StringIO(newline=''); writer = csv.writer(data)
    writer.writerow(['序号', '入柜时间', '销售单号', '商品类别', '商品', '规格/克', '成本', '实际售价', '毛利', '销售时间', '售货签名', '备注', '商家'])
    text = finance.csv_export_cell
    def money(value):
        display = fmt2(value)
        # Keep formatted negative numbers numeric; unexpected stored text still
        # needs the same CSV protection as the ordinary text columns.
        return display if re.fullmatch(r'-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?', display) else text(display)
    for row in rows:
        writer.writerow([text(row['seq']), text(row['in_date']), text(row['order_no']), text(row['category']),
                         text(row['product']), text(row['weight']), money(row['cost']),
                         money(row['sell_price']), money(row['profit_c']),
                         text(row['sell_date']), text(row['seller']), text(row['remark']), text(row['supplier'])])
    return Response('\ufeff' + data.getvalue(), content_type='text/csv; charset=utf-8',
                    headers={'Cache-Control': 'no-store', 'Content-Disposition':
                             'attachment; filename="inventory-filtered.csv"; filename*=UTF-8\'\'%E5%BA%93%E5%AD%98%E5%8F%B0%E8%B4%A6_%E7%AD%9B%E9%80%89%E7%BB%93%E6%9E%9C.csv'})


@auth.login_required
def stock_index():
    state = request.args.get('state', '在库')
    if state not in STATES + ('全部',): state = '在库'
    category = request.args.get('cat', ''); supplier = request.args.get('sup', ''); keyword = request.args.get('kw', '').strip()
    month = _month(); inventory = snapshot(month=month); rows = _stock_rows(inventory, state, category, supplier, keyword)
    for row in rows:
        # The signed snapshot must contain only actual database columns.
        plain = {k: v for k, v in row.items() if k not in ('inventory_state', 'platinum_bucket', 'purity_factor', 'fine_grams', 'weight_issue')}
        row['snapshot_token'] = r.row_token('stock_items', plain)
    cats = r.preserve_choices([row['name'] for row in db.query('SELECT name FROM categories WHERE active=1 ORDER BY sort,id')], [row['category'] for row in inventory['rows']])
    sups = r.preserve_choices([row['name'] for row in db.query('SELECT name FROM suppliers WHERE active=1 ORDER BY sort,id')], [row['supplier'] for row in inventory['rows']])
    weights = [_grams(row.get('weight')) for row in rows]
    invalid_weight_count = sum(value is None for value in weights)
    summary = {'cnt': len(rows), 'gram': None if invalid_weight_count else float(sum(weights, Decimal(0))),
               'invalid_weight_count': invalid_weight_count, 'weight_complete': invalid_weight_count == 0,
               'cost': math.fsum(float(row['cost'] or 0) for row in rows),
               'sell': math.fsum(float(row['sell_price'] or 0) for row in rows),
               'profit': math.fsum(float(row['profit_c'] or 0) for row in rows)}
    return render_template('stock.html', rows=rows, state=state, cat=category, sup=supplier, kw=keyword,
                           cats=cats, sups=sups, sumr=summary, inventory=inventory, stock_cnt=inventory['overall']['in_stock']['count'],
                            month=month, readonly=auth.current_user()['role'] == 'viewer')


def configure(app):
    with r.transaction() as c: c.execute(SCHEMA)
    app.register_blueprint(bp)
    app.view_functions['home.index'] = home
    app.view_functions['enhanced.overview'] = home
    app.view_functions['stock.index'] = stock_index
