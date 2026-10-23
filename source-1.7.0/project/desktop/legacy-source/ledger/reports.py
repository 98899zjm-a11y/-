"""Selectable local summaries, printable HTML and offline downloadable PDFs."""
import collections
import contextlib
import copy
import datetime
import io
import json
import pathlib
import sys
import threading
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from urllib.parse import parse_qsl
from xml.sax.saxutils import escape

from flask import Blueprint, jsonify, render_template, request, send_file
from werkzeug.datastructures import MultiDict
from app import auth, db
import repairs as r


bp = Blueprint('reports', __name__)
SCHEMA = '''CREATE TABLE IF NOT EXISTS report_preferences(
 username TEXT PRIMARY KEY,options_json TEXT NOT NULL,updated_at TEXT NOT NULL)'''
TITLES = collections.OrderedDict([
    ('sales', '销售汇报'), ('stock', '库存快照'), ('material', '存料汇报'),
    ('payroll', '人员工资'), ('expenses', '费用报销'), ('platinum', '足铂预警'),
])
# Each metric reads stored values; formatting never writes rounded values back.
METRICS = {
    'sales': [('count', '销售笔数', '笔'), ('amount', '销售金额', '元'), ('received', '实际到账', '元'),
              ('cost', '成本', '元'), ('profit', '公司利润', '元'), ('commission', '销售提成', '元'),
              ('commission_profit', '提成利润', '元'), ('grams', '销售克重', '克')],
    'stock': [('count', '在库笔数', '笔'), ('grams', '在库克重', '克'), ('cost', '在库成本', '元'),
              ('transit_count', '在途笔数', '笔'), ('transit_grams', '在途克重', '克'),
              ('unknown_count', '状态待确认', '笔')],
    'material': [('count', '存料记录', '笔'), ('grams', '存料克数', '克'), ('amount', '存料金额', '元')],
    'payroll': [('count', '工资记录', '笔'), ('gross', '应发工资', '元'), ('deduction', '工资扣款', '元'),
                ('net', '实发工资', '元'), ('payment', '本次支付', '元')],
    'expenses': [('count', '报销记录', '笔'), ('amount', '报销金额', '元'), ('paid', '已支付', '元'),
                 ('pending', '已审核待支付', '元')],
    'platinum': [('fine_grams', '在库折足铂', '克'), ('pt950_grams', '在库PT950', '克'),
                 ('board_grams', '在库板料与足铂金豆', '克'), ('transit_fine', '在途折足铂', '克'),
                 ('unknown_grams', '铂金成色待确认', '克')],
}
GROUPS = {
    'sales': [('staff', '销售员'), ('channel', '销售渠道'), ('template', '商品模板'), ('status', '订单状态')],
    'stock': [('supplier', '供货商'), ('category', '商品类别'), ('inventory_state', '库存状态')],
    'material': [('supplier', '供货商')],
    'payroll': [('employee', '人员'), ('status', '工资状态')],
    'expenses': [('employee', '人员'), ('category', '费用类别'), ('status', '报销状态'), ('payout', '支付方式')],
    'platinum': [('supplier', '供货商'), ('category', '商品类别'), ('platinum_bucket', '铂金类别')],
}
DEFAULT_METRICS = {
    'sales': ['count', 'received', 'profit'], 'stock': ['count', 'grams', 'cost'],
    'material': ['grams', 'amount'], 'payroll': ['net', 'payment'],
    'expenses': ['amount', 'paid'], 'platinum': ['fine_grams', 'transit_fine', 'unknown_grams'],
}
STATE_LABELS = {'in_stock': '在库', 'transit': '在途', 'sold': '已售出', 'unknown': '待确认'}
BUCKET_LABELS = {'pt950': 'PT950', 'fine_board': '铂金板料／足铂金豆', 'unknown_pt': '铂金成色待确认', 'other': '其他商品'}
_pdf_lock = threading.Lock()


def decimal(value):
    try:
        number = Decimal(str(0 if value is None or value == '' else value))
        if not number.is_finite():
            raise InvalidOperation
        return number
    except (InvalidOperation, ValueError):
        raise ValueError('汇报发现不能识别的数值，请先核对原记录。')


def format2(value):
    result = decimal(value).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    return '0.00' if result == 0 else format(result, '.2f')


def defaults():
    today = datetime.date.today()
    return {'title': '鑫金源珠宝经营汇报', 'all_time': False,
            'start': today.replace(day=1).isoformat(), 'end': today.isoformat(),
            'domains': ['sales', 'stock', 'platinum'], 'metrics': copy.deepcopy(DEFAULT_METRICS),
            'groups': {key: [] for key in TITLES}, 'details': [],
            'sales_scope': 'completed', 'payroll_scope': 'confirmed', 'expense_scope': 'approved'}


def selected(values, allowed):
    return list(dict.fromkeys(value for value in values if value in allowed))


def parse_options(args, initial=None):
    options = copy.deepcopy(initial or defaults())
    if not args.get('configured'):
        return options
    options['title'] = (args.get('title', '').strip() or '鑫金源珠宝经营汇报')[:60]
    options['all_time'] = args.get('all_time') == '1'
    options['start'], options['end'] = args.get('start', ''), args.get('end', '')
    if not options['all_time']:
        try:
            start, end = datetime.date.fromisoformat(options['start']), datetime.date.fromisoformat(options['end'])
        except ValueError:
            raise ValueError('请选择有效的开始和结束日期，或勾选全部时间。')
        if start > end:
            raise ValueError('开始日期不能晚于结束日期。')
    options['domains'] = selected(args.getlist('domain'), TITLES)
    if not options['domains']:
        raise ValueError('请至少勾选一个业务类目。')
    options['details'] = selected(args.getlist('details'), options['domains'])
    for domain in TITLES:
        options['metrics'][domain] = selected(args.getlist(domain + '_metric'), {x[0] for x in METRICS[domain]})
        options['groups'][domain] = selected(args.getlist(domain + '_group'), {x[0] for x in GROUPS[domain]})
        if domain in options['domains'] and not options['metrics'][domain]:
            raise ValueError('请为“' + TITLES[domain] + '”至少勾选一个指标。')
    for key, allowed in [('sales_scope', ('completed', 'all')), ('payroll_scope', ('confirmed', 'all')),
                         ('expense_scope', ('approved', 'all'))]:
        value = args.get(key, options[key])
        options[key] = value if value in allowed else allowed[0]
    return options


def saved_options():
    user = auth.current_user()
    record = db.query('SELECT options_json FROM report_preferences WHERE username=?', (user['username'],), one=True)
    if record:
        try:
            value = json.loads(record['options_json'])
            # Persisted settings are written only after the same option validation.
            return value
        except (ValueError, TypeError):
            pass
    return defaults()


def date_clause(column, options, monthly=False):
    if options['all_time']:
        return '', []
    start, end = options['start'], options['end']
    if monthly:
        start, end = start[:7], end[:7]
    return ' AND ' + column + '>=? AND ' + column + '<=?', [start, end]


def fetch_records(options):
    records, inventory = {}, None
    with contextlib.closing(db.connect()) as c:
        c.execute('BEGIN')
        if any(domain in options['domains'] for domain in ('stock', 'platinum')):
            import inventory_dashboard
            # Inventory is a balance at the report end period, not the sum of
            # each monthly observation. An all-time report uses this month.
            inventory_month = datetime.date.today().strftime('%Y-%m') if options['all_time'] else options['end'][:7]
            inventory = inventory_dashboard.snapshot(c, month=inventory_month)
        for domain in options['domains']:
            if domain in ('stock', 'platinum'):
                continue
            table = {'sales': 'sales', 'material': 'material_stock', 'payroll': 'payroll_records', 'expenses': 'expenses'}[domain]
            column = 'month' if domain == 'payroll' else 'date'
            clause, params = date_clause(column, options, domain == 'payroll')
            scope = ''
            if domain == 'sales' and options['sales_scope'] == 'completed':
                scope = " AND status='已完成'"
            elif domain == 'payroll' and options['payroll_scope'] == 'confirmed':
                scope = " AND status IN ('已确认','已发放')"
            elif domain == 'expenses' and options['expense_scope'] == 'approved':
                scope = " AND status IN ('已审核','已支付')"
            records[domain] = [dict(row) for row in c.execute('SELECT * FROM ' + table + ' WHERE 1=1' + clause + scope + ' ORDER BY ' + column + ',id', params)]
    return records, inventory


def prepare(domain, rows, selected_metrics=None):
    output = []
    for original in rows:
        row = dict(original)
        if domain == 'sales':
            values = {'count': 1, 'amount': row['amount_c'], 'received': row['received'], 'cost': row['cost'],
                      'profit': row['profit_c'], 'commission': row['comm_c'], 'commission_profit': row['comm_profit_c'], 'grams': row['weight']}
        elif domain == 'material':
            values = {'count': 1, 'grams': row['grams'], 'amount': row['amount']}
        elif domain == 'payroll':
            saved = json.loads(row['outputs_json'])
            values = {'count': 1, 'gross': saved.get('应发工资', 0), 'deduction': saved.get('工资扣款', 0),
                      'net': saved.get('实发工资', 0), 'payment': saved.get('本次支付', 0)}
        elif domain == 'expenses':
            values = {'count': 1, 'amount': row['amount'], 'paid': row['amount'] if row['status'] == '已支付' else 0,
                      'pending': row['amount'] if row['status'] == '已审核' else 0}
        else:
            state = {'在库':'in_stock','在途':'transit','已售':'sold','待确认':'unknown'}.get(row['inventory_state'], row['inventory_state'])
            row['inventory_state'] = state
            if state == 'sold':
                continue
            row['state_label'] = STATE_LABELS.get(state, str(state))
            row['bucket_label'] = BUCKET_LABELS.get(row['platinum_bucket'], str(row['platinum_bucket']))
            bucket = row['platinum_bucket']
            if domain == 'stock':
                weight_metrics = {'grams'} if state == 'in_stock' else {'transit_grams'} if state == 'transit' else set()
            else:
                weight_metrics = ({'fine_grams', 'pt950_grams'} if bucket == 'pt950' else
                                  {'fine_grams', 'board_grams'} if bucket == 'fine_board' else
                                  {'unknown_grams'} if bucket == 'unknown_pt' else set()) if state == 'in_stock' else (
                                  {'transit_fine'} if state == 'transit' and bucket in ('pt950', 'fine_board') else set())
            if weight_metrics and (selected_metrics is None or weight_metrics.intersection(selected_metrics)):
                raw = row.get('weight'); reason = ''
                if raw is None or isinstance(raw, str) and not raw.strip():
                    reason = '克重缺失'
                else:
                    try: grams = decimal(raw)
                    except ValueError: reason = '克重不是有限数值'
                    else:
                        if grams < 0: reason = '克重为负数'
                if reason:
                    label = '库存汇报' if domain == 'stock' else '足铂汇报'
                    raise ValueError(label + '第 ' + str(row.get('id', '未知')) + ' 条记录' + reason + '，请先核对原记录后重新生成。')
            if domain == 'stock':
                values = {'count': int(state == 'in_stock'), 'grams': row['weight'] if state == 'in_stock' else 0,
                          'cost': row['cost'] if state == 'in_stock' else 0, 'transit_count': int(state == 'transit'),
                          'transit_grams': row['weight'] if state == 'transit' else 0, 'unknown_count': int(state == 'unknown')}
            else:
                if bucket not in ('pt950', 'fine_board', 'unknown_pt'):
                    continue
                values = {'fine_grams': row['fine_grams'] if state == 'in_stock' else 0,
                          'pt950_grams': row['weight'] if state == 'in_stock' and bucket == 'pt950' else 0,
                          'board_grams': row['weight'] if state == 'in_stock' and bucket == 'fine_board' else 0,
                          'transit_fine': row['fine_grams'] if state == 'transit' else 0,
                          'unknown_grams': row['weight'] if state == 'in_stock' and bucket == 'unknown_pt' else 0}
        row['_metrics'] = {key: decimal(value) for key, value in values.items()
                           if selected_metrics is None or key in selected_metrics}
        output.append(row)
    return output


def group_value(row, field):
    if field == 'inventory_state':
        return row['state_label']
    if field == 'platinum_bucket':
        return row['bucket_label']
    return str(row.get(field) or '未填写')


def total(rows, keys):
    return {key: sum((row['_metrics'][key] for row in rows), Decimal(0)) for key in keys}


def metric_chunks(metrics, size):
    return [metrics[start:start + size] for start in range(0, len(metrics), size)]


def build_tables(domain, rows, metrics, groups, include_details):
    tables = []
    for field in groups:
        label = dict(GROUPS[domain])[field]
        buckets = collections.defaultdict(list)
        for row in rows:
            buckets[group_value(row, field)].append(row)
        chunks = metric_chunks(metrics, 4)
        for index, chunk in enumerate(chunks, 1):
            table_rows = []
            for name in sorted(buckets):
                sums = total(buckets[name], [item[0] for item in chunk])
                table_rows.append([name] + [format2(sums[item[0]]) for item in chunk])
            tables.append({'title': label + '汇总' + ('（' + str(index) + '/' + str(len(chunks)) + '）' if len(chunks) > 1 else ''),
                           'headers': [label] + [item[1] + '（' + item[2] + '）' for item in chunk],
                           'rows': table_rows, 'identity_columns': 1})
    if include_details:
        identifiers = {
            'sales': [('date', '日期'), ('order_no', '单号'), ('product', '商品')],
            'stock': [('state_label', '状态'), ('product', '商品'), ('supplier', '供货商')],
            'material': [('date', '日期'), ('supplier', '供货商')],
            'payroll': [('month', '月份'), ('employee', '人员'), ('status', '状态')],
            'expenses': [('date', '日期'), ('employee', '人员'), ('category', '费用类别')],
            'platinum': [('state_label', '状态'), ('product', '商品'), ('bucket_label', '铂金类别')],
        }[domain]
        chunks = metric_chunks(metrics, 6 - len(identifiers))
        for index, chunk in enumerate(chunks, 1):
            tables.append({'title': '明细' + ('（指标 ' + str(index) + '/' + str(len(chunks)) + '）' if len(chunks) > 1 else ''),
                           'headers': [label for _key, label in identifiers] + [item[1] + '（' + item[2] + '）' for item in chunk],
                           'rows': [[str(row.get(key) or '') for key, _label in identifiers] + [format2(row['_metrics'][item[0]]) for item in chunk] for row in rows],
                           'identity_columns': len(identifiers)})
    return tables


def build_report(options):
    raw, inventory = fetch_records(options)
    sections = []
    for domain in options['domains']:
        rows = prepare(domain, inventory['rows'] if domain in ('stock', 'platinum') else raw[domain],
                       selected_metrics=options['metrics'][domain] if domain in ('stock', 'platinum') else None)
        metrics = [item for item in METRICS[domain] if item[0] in options['metrics'][domain]]
        sums = total(rows, [item[0] for item in metrics])
        notes = {
            'sales': '按已完成销售统计。' if options['sales_scope'] == 'completed' else '包含所选日期内所有订单状态。',
            'stock': '期末库存快照；只取期末月份台账，上月记录仅供参考、不重复累计成本；在途单列，已售出不计入。',
            'material': '按记录日期统计，克数与金额分别列示。',
            'payroll': '工资按日期范围涉及的月份统计，读取已保存工资结果。' + ('仅已确认和已发放。' if options['payroll_scope'] == 'confirmed' else '含已保存草稿。'),
            'expenses': '按费用日期统计。' + ('仅已审核和已支付。' if options['expense_scope'] == 'approved' else '含所有报销状态。'),
            'platinum': '期末在库折足铂采用同一月份台账，在途单列，不计入在库预警。',
        }
        if domain in ('stock', 'platinum'):
            scope = inventory['scope']
            notes[domain] += ' ' + scope['message']
            if not scope['complete']:
                notes[domain] += ' 统计范围待核对，本节数值不能作为完整库存依据。'
        section = {'domain': domain, 'title': TITLES[domain], 'record_count': len(rows), 'note': notes[domain],
                   'metrics': [{'key': key, 'label': label, 'unit': unit, 'value': sums[key]} for key, label, unit in metrics],
                   'tables': build_tables(domain, rows, metrics, options['groups'][domain], domain in options['details']),
                   'alert': '', 'threshold_text': ''}
        if domain == 'platinum':
            section['alert'] = inventory['alert']['text']
            threshold = inventory['thresholds']
            section['threshold_text'] = '下限 ' + ('未设置' if threshold.get('lower') is None else format2(threshold['lower']) + ' 克') + '；上限 ' + ('未设置' if threshold.get('upper') is None else format2(threshold['upper']) + ' 克')
        sections.append(section)
    period = '全部时间' if options['all_time'] else options['start'] + ' 至 ' + options['end']
    return {'title': options['title'], 'period': period, 'generated_at': db.now_str(), 'sections': sections,
            'note': '销售、存料、工资和报销按所选时间统计；库存与足铂是生成时快照。显示保留两位，汇总使用保存的原值。',
            'payment_note': '工资本次支付可能已含随工资报销，两类金额分别列示，请勿重复相加。' if 'payroll' in options['domains'] and 'expenses' in options['domains'] else ''}


def pdf_bytes(report):
    vendor = pathlib.Path(__file__).resolve().parent / 'pdf_vendor'
    if str(vendor) not in sys.path:
        sys.path.insert(0, str(vendor))
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_LEFT, TA_RIGHT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.cidfonts import UnicodeCIDFont
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, LongTable, TableStyle, KeepTogether
    font = 'STSong-Light'
    with _pdf_lock:
        if font not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(UnicodeCIDFont(font))
            pdfmetrics.registerFontFamily(font, normal=font, bold=font, italic=font, boldItalic=font)
    palette = {'text': colors.HexColor('#283e32'), 'muted': colors.HexColor('#627368'),
               'green': colors.HexColor('#34684e'), 'line': colors.HexColor('#dce5df')}
    body = ParagraphStyle('ReportBody', fontName=font, fontSize=9, leading=14, textColor=palette['text'], wordWrap='CJK')
    title = ParagraphStyle('ReportTitle', parent=body, fontSize=19, leading=27, spaceAfter=8)
    muted = ParagraphStyle('ReportNote', parent=body, fontSize=8, leading=12, textColor=palette['muted'])
    heading = ParagraphStyle('ReportHeading', parent=body, fontSize=12, leading=18, spaceBefore=12, spaceAfter=5)
    small_heading = ParagraphStyle('ReportSubheading', parent=body, fontSize=10, leading=15, spaceBefore=10, spaceAfter=5, keepWithNext=True)
    cell = ParagraphStyle('ReportCell', parent=body, fontSize=8.5, leading=12)
    numeric = ParagraphStyle('ReportNumber', parent=cell, alignment=TA_RIGHT)
    header = ParagraphStyle('ReportHeader', parent=cell, fontSize=8, textColor=colors.white, leading=11)
    metric_style = ParagraphStyle('ReportMetric', parent=body, fontSize=10, leading=17)
    def text(value, style=body):
        return Paragraph(escape(str(value)).replace('\n', '<br/>'), style)
    output = io.BytesIO()
    width = A4[0] - 28 * mm
    document = SimpleDocTemplate(output, pagesize=A4, rightMargin=14*mm, leftMargin=14*mm,
                                 topMargin=15*mm, bottomMargin=19*mm, title=report['title'], author='鑫金源珠宝',
                                 pageCompression=1)
    story = [text(report['title'], title), text('统计范围：' + report['period'] + '　生成时间：' + report['generated_at'], muted),
             Spacer(1, 7), text(report['note'], muted)]
    if report['payment_note']:
        story.extend([Spacer(1, 4), text(report['payment_note'], muted)])
    for section in report['sections']:
        cards = []
        for metric in section['metrics']:
            cards.append(Paragraph(escape(metric['label']) + '<br/><b>' + format2(metric['value']) + ' ' + escape(metric['unit']) + '</b>', metric_style))
        card_rows = [cards[index:index + 3] + [''] * (3 - len(cards[index:index + 3])) for index in range(0, len(cards), 3)]
        summary = Table(card_rows, colWidths=[width/3]*3)
        summary.setStyle(TableStyle([('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#f2f6f2')),
                                    ('VALIGN', (0,0), (-1,-1), 'TOP'), ('LEFTPADDING', (0,0), (-1,-1), 10),
                                    ('RIGHTPADDING', (0,0), (-1,-1), 10), ('TOPPADDING', (0,0), (-1,-1), 8),
                                    ('BOTTOMPADDING', (0,0), (-1,-1), 8)]))
        opening = [text(section['title'], heading), text(section['note'], muted), Spacer(1, 6), summary]
        if section['alert']:
            opening.extend([Spacer(1, 5), text('预警：' + section['alert'], body), text(section['threshold_text'], muted)])
        story.append(KeepTogether(opening))
        for table in section['tables']:
            story.append(text(table['title'], small_heading))
            if not table['rows']:
                story.append(text('当前范围没有记录。', muted))
                continue
            count, identity = len(table['headers']), table['identity_columns']
            if identity == 1:
                col_widths = [width*.30] + [width*.70/(count-1)]*(count-1)
            elif identity == 2:
                col_widths = [width*.17, width*.28] + [width*.55/(count-2)]*(count-2)
            else:
                col_widths = [width*.13, width*.25, width*.26] + [width*.36/(count-3)]*(count-3)
            matrix = [[text(value, header) for value in table['headers']]]
            matrix.extend([[text(value, cell if index < identity else numeric) for index, value in enumerate(row)] for row in table['rows']])
            rendered = LongTable(matrix, colWidths=col_widths, repeatRows=1, splitByRow=1, splitInRow=1)
            rendered.setStyle(TableStyle([('BACKGROUND', (0,0), (-1,0), palette['green']),
                                         ('VALIGN', (0,0), (-1,-1), 'TOP'), ('LINEBELOW', (0,0), (-1,0), .4, palette['green']),
                                         ('LINEBELOW', (0,1), (-1,-1), .25, palette['line']),
                                         ('LEFTPADDING', (0,0), (-1,-1), 6), ('RIGHTPADDING', (0,0), (-1,-1), 6),
                                         ('TOPPADDING', (0,0), (-1,-1), 6), ('BOTTOMPADDING', (0,0), (-1,-1), 6),
                                         ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor('#fafcf9')])]))
            story.append(rendered)
    def footer(canvas, document):
        canvas.saveState()
        canvas.setStrokeColor(palette['line']);canvas.line(14*mm, 15*mm, A4[0]-14*mm, 15*mm)
        canvas.setFont(font, 8);canvas.setFillColor(palette['muted'])
        canvas.drawString(14*mm, 10*mm, '鑫金源珠宝  本地账目汇报')
        canvas.drawRightString(A4[0]-14*mm, 10*mm, '第 ' + str(document.page) + ' 页')
        canvas.restoreState()
    document.build(story, onFirstPage=footer, onLaterPages=footer)
    return output.getvalue()


@bp.get('/reports')
@auth.login_required
def index():
    initial = saved_options()
    error, report = '', None
    try:
        options = parse_options(request.args, initial)
        report = build_report(options)
    except (ValueError, KeyError) as problem:
        error, options = str(problem), initial
    return render_template('reports.html', options=options, report=report, error=error, titles=TITLES,
                           metric_options=METRICS, group_options=GROUPS,
                           can_configure=auth.current_user()['role'] in ('admin','bookkeeper'))


@bp.get('/reports/print')
@auth.login_required
def print_view():
    try:
        report = build_report(parse_options(request.args, saved_options()))
        return render_template('report_print.html', report=report)
    except (ValueError, KeyError) as problem:
        return '无法生成汇报：' + str(problem), 400


@bp.get('/reports/pdf')
@auth.login_required
def download_pdf():
    try:
        report = build_report(parse_options(request.args, saved_options()))
        data = pdf_bytes(report)
        return send_file(io.BytesIO(data), as_attachment=True, download_name='鑫金源珠宝_汇报_' + datetime.date.today().strftime('%Y%m%d') + '.pdf', mimetype='application/pdf')
    except (ValueError, KeyError) as problem:
        return '无法生成汇报：' + str(problem), 400


@bp.post('/reports/preferences')
@auth.login_required
def save_preferences():
    user = auth.current_user()
    if user['role'] not in ('admin', 'bookkeeper'):
        return jsonify(ok=False,error='当前账号只可查看与导出。'), 403
    try:
        args = MultiDict(parse_qsl((request.get_json(silent=True) or {}).get('query',''), keep_blank_values=True))
        options = parse_options(args)
        with r.transaction() as c:
            c.execute('INSERT INTO report_preferences(username,options_json,updated_at) VALUES(?,?,?) ON CONFLICT(username) DO UPDATE SET options_json=excluded.options_json,updated_at=excluded.updated_at',
                      (user['username'],json.dumps(options,ensure_ascii=False),db.now_str()))
            r.audit(c,'保存汇报常用设置','report_preferences',None,None,options)
        return jsonify(ok=True,message='已保存为你的常用汇报设置。')
    except ValueError as problem:
        return jsonify(ok=False,error=str(problem)),400


def configure(app):
    with r.transaction() as c:
        c.executescript(SCHEMA)
    app.register_blueprint(bp)
