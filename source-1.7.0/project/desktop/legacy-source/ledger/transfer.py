"""Read-only original-workbook preview and explicit import/export entry points."""
import collections
import json

from flask import Blueprint, abort, render_template, request
from app import auth, db
import source_sync as sync


bp = Blueprint('transfer', __name__)
FIELD_LABELS = {
    'date': '销售日期', 'order_no': '销售单号', 'template': '模板',
    'channel': '销售渠道', 'product': '商品', 'weight': '规格／克重',
    'sell_gram_price': '销售克价', 'labor': '工费', 'received': '实际到账',
    'status': '订单状态', 'cost': '成本', 'remit_date': '汇款日期',
    'staff': '销售人员', 'xhs_repeat': '小红书复购', 'note': '补充备注',
    'amount_c': '销售金额', 'cost_gram_c': '成本金价', 'profit_c': '公司利润',
    'gross_rate_c': '毛利率', 'comm_cost_c': '提成成本', 'comm_c': '销售提成',
    'comm_profit_c': '提成利润', 'spread': '点差', 'seq': '序号',
    'in_date': '入柜时间', 'category': '商品类别', 'sell_price': '实际售价',
    'sell_date': '销售时间', 'seller': '售货签名', 'remark': '在库／售出状态',
    'supplier': '供货商',
}
PENDING_CLASSES = {'待选择单位', '待核对', '现有账目待匹配', '未识别'}


def column_letter(index):
    """Convert a one-based column number without depending on Excel authoring."""
    result = ''
    while index:
        index, remainder = divmod(index - 1, 26)
        result = chr(65 + remainder) + result
    return result


def column_index(letter):
    result = 0
    for character in str(letter).upper():
        if not ('A' <= character <= 'Z'):
            return 0
        result = result * 26 + ord(character) - 64
    return result


def decode(value, fallback):
    try:
        return json.loads(value) if value else fallback
    except (TypeError, ValueError):
        return fallback


def display_value(value):
    if value is None:
        return ''
    if isinstance(value, bool):
        return '是' if value else '否'
    if isinstance(value,(int,float)):
        from presentation import fmt2
        return fmt2(value)
    return str(value)


def header_for(rows, kind):
    """Use the same header criteria as source_sync; do not invent mappings."""
    for row in rows[:20]:
        values = row['raw']
        normalized = [sync.norm(value) for value in values]
        if kind == 'sales' and '商品' in normalized and (
                '销售克价' in normalized or '实际到账' in normalized):
            return row['row_no'], values
        if kind == 'stock' and '商品' in normalized and '成本' in normalized:
            return row['row_no'], values
        if kind == 'material' and len(normalized) > 1 and (
                '日期' in normalized and normalized[1] == '商品'):
            return row['row_no'], values
    return 0, []


def mapping_for(header, kind, column_count):
    mapping = {}
    if kind == 'sales':
        mapping = sync.map_headers(header, sync.SALE_HEADERS)
        if header:
            mapping.setdefault('date', 0)
    elif kind == 'stock':
        mapping = sync.map_headers(header, sync.STOCK_HEADERS)
        notes = [i for i, value in enumerate(header) if sync.norm(value) == '备注']
        if len(notes) > 1:
            mapping['note'] = notes[1]
    reverse = collections.defaultdict(list)
    for field, index in mapping.items():
        label = FIELD_LABELS.get(field, field)
        if field == 'profit_c' and kind == 'stock':
            label = '毛利'
        reverse[index].append(label)
    columns = []
    for index in range(column_count):
        original = header[index] if index < len(header) else None
        target = '、'.join(reverse.get(index, []))
        if kind == 'material':
            if index == 0:
                target = '日期'
            elif index == 1:
                target = '板料／金额单位'
            elif original and str(original) not in ['汇总', '备注'] and not str(original).startswith('列'):
                target = '供货商：' + str(original) + '（按克／元分别对应）'
        columns.append({
            'letter': column_letter(index + 1),
            'name': display_value(original) or '未命名列',
            'target': target or '仅保留在原表',
            'mapped': bool(target),
        })
    return columns


def row_pending(row, parts):
    if row['classification'] in PENDING_CLASSES:
        return True
    if row['kind'] != 'material':
        return False
    normalized = row['normalized']
    for cell in normalized.get('cells', []):
        unit = cell.get('unit') or normalized.get('unit')
        if unit != 'ignore' and str(cell['column']) not in parts:
            return True
    return False


def sheet_model(name, rows, parts_by_row):
    kind = rows[0]['kind'] if rows else 'other'
    header_row, header = header_for(rows, kind)
    formula_columns = [column_index(letter) for row in rows for letter in row['formulas']]
    column_count = max([len(row['raw']) for row in rows] + formula_columns + [len(header), 1])
    columns = mapping_for(header, kind, column_count)
    pending = [row for row in rows if row_pending(row, parts_by_row.get(row['id'], set()))]
    preview = []
    for row in rows[:20]:
        cells = []
        for index in range(column_count):
            letter = column_letter(index + 1)
            value = row['raw'][index] if index < len(row['raw']) else None
            formula = row['formulas'].get(letter, '')
            cells.append({
                'address': letter + str(row['row_no']), 'value': display_value(value),
                'formula': formula, 'missing_cache': bool(formula and value is None),
            })
        preview.append({'row_no': row['row_no'], 'classification': row['classification'],
                        'warning': row['warning'], 'cells': cells})
    linked = sum(bool(parts_by_row.get(row['id'])) for row in rows)
    return {
        'name': name, 'kind': kind, 'title': sync.TITLES.get(kind, '未识别'),
        'row_count': len(rows), 'header_row': header_row, 'columns': columns,
        'business_count': sum(row['classification'] == '业务明细' for row in rows),
        'linked_count': linked, 'pending_count': len(pending), 'pending': pending[:12],
        'preview': preview,
    }


@bp.get('/transfer')
@auth.login_required
def index():
    docs = [dict(row) for row in db.query('SELECT * FROM source_documents ORDER BY id DESC')]
    requested_doc = request.args.get('doc')
    doc = next((item for item in docs if str(item['id']) == requested_doc), None) if requested_doc else (docs[0] if docs else None)
    if requested_doc and doc is None:
        abort(404)
    sheets = []
    current = None
    if doc:
        stored = db.query('SELECT * FROM source_rows WHERE document_id=? ORDER BY id', (doc['id'],))
        groups = collections.OrderedDict()
        for stored_row in stored:
            row = dict(stored_row)
            row['raw'] = decode(row.get('raw_json'), [])
            row['formulas'] = decode(row.get('formula_json'), {})
            row['normalized'] = decode(row.get('normalized_json'), {})
            groups.setdefault(row['sheet'], []).append(row)
        parts = collections.defaultdict(set)
        for link in db.query('SELECT l.source_row_id,l.part FROM source_links l JOIN source_rows s ON s.id=l.source_row_id WHERE s.document_id=?', (doc['id'],)):
            parts[link['source_row_id']].add(link['part'])
        sheets = [sheet_model(name, rows, parts) for name, rows in groups.items()]
        requested_sheet = request.args.get('sheet')
        current = next((item for item in sheets if item['name'] == requested_sheet), None) if requested_sheet else (sheets[0] if sheets else None)
        if requested_sheet and current is None:
            abort(404)
    user = auth.current_user()
    return render_template('transfer.html', docs=docs, doc=doc, sheets=sheets,
                           current=current, can_import=bool(user and user['role'] == 'admin'),
                           total_pending=sum(sheet['pending_count'] for sheet in sheets),
                           total_linked=sum(sheet['linked_count'] for sheet in sheets))
