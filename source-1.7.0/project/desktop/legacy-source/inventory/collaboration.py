"""Read-only collaboration snapshots from the original module's stored data."""
import contextlib
import datetime
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import sqlite3
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from flask import g, request, jsonify, render_template

MAX_ROWS = 20000
MAX_BYTES = 64 * 1024 * 1024

class SnapshotError(ValueError):
    def __init__(self, message, status=422):
        super().__init__(message)
        self.status = status

def period(start, end):
    try:
        if not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', start or '') or not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', end or ''):
            raise ValueError('Invalid ISO date')
        first, last = datetime.date.fromisoformat(start), datetime.date.fromisoformat(end)
        if first > last or (last-first).days > 365:
            raise ValueError('Invalid period')
    except (ValueError, TypeError):
        raise SnapshotError('请选择不超过366天的有效起止日期。', 400)
    return first.isoformat(), last.isoformat()

def decimal(value, nullable=False):
    if value is None and nullable:
        return None
    if value is None:
        raise SnapshotError('原资料缺少金额或数量，请先核对原资料；没有按0补填。')
    try:
        number = Decimal(str(value))
        if not number.is_finite():
            raise InvalidOperation
        return number
    except (InvalidOperation, ValueError, TypeError):
        raise SnapshotError('原资料中有无法识别的金额或数量，请先核对原资料。')

def raw(value, nullable=False):
    number = decimal(value, nullable)
    return None if number is None else format(number, 'f')

def scaled(value, scale, nullable=False):
    number = decimal(value, nullable)
    return None if number is None else str(int((number*scale).quantize(Decimal('1'), rounding=ROUND_HALF_UP)))

def checked_rows(connection, sql, parameters=()):
    rows = connection.execute(sql + ' LIMIT ?', (*parameters, MAX_ROWS+1)).fetchall()
    if len(rows) > MAX_ROWS:
        raise SnapshotError('所选范围超过20000条，请缩小日期范围或整理资料后再生成；没有截取部分明细。', 413)
    return rows

def ensure_size(snapshot):
    count = sum(len(snapshot.get(key, [])) for key in ('sales', 'balances', 'moves', 'countDiffs'))
    if count > MAX_ROWS:
        raise SnapshotError('本次汇报超过20000条，请缩小日期范围；没有截取部分明细。', 413)
    if len(json.dumps(snapshot, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode('utf-8')) > MAX_BYTES:
        raise SnapshotError('本次汇报内容超过64MB，请缩小日期范围；没有截取部分明细。', 413)
    return snapshot

def ledger_data(connection, snapshot):
    rows = checked_rows(connection, "SELECT id,date,order_no,product,status,staff,amount_c,received,weight,profit_c FROM sales WHERE date>=? AND date<=? AND status='已完成' ORDER BY date,id", (snapshot['from'], snapshot['to']))
    sales = []
    for row in rows:
        name = row['staff']
        if not isinstance(name, str):
            raise SnapshotError('原销售人员字段不完整，请先核对原资料。')
        entry = {
            'sourceId': 'sales:' + str(row['id']), 'date': row['date'], 'orderNo': row['order_no'],
            'product': row['product'], 'status': row['status'],
            'salespersonKey': 'staff:' + hashlib.sha256(name.encode('utf-8')).hexdigest(),
            'salespersonName': name, 'amountCents': scaled(row['amount_c'], 100),
            'amountRaw': raw(row['amount_c']), 'receivedCents': scaled(row['received'], 100), 'receivedRaw': raw(row['received']),
            'weightMicros': scaled(row['weight'], 1000000), 'weightRaw': raw(row['weight']),
            'itemsCount': 1,
        }
        if snapshot['profitIncluded'] and row['profit_c'] is not None:
            entry['profitCents'] = scaled(row['profit_c'], 100)
            entry['profitRaw'] = raw(row['profit_c'])
        sales.append(entry)
    snapshot['sales'] = sales
    snapshot['sourceMeta'] = {
        'salesBasis': '原sales已完成记录；销售额读取amount_c，实际到账另列received，不重新计算金额。',
        'recordCountBasis': '每条原sales记录为一笔，保留原单号，不猜测合并订单。',
        'moneyBasis': '行级金额按原值取分展示；合计先按原值精确汇总，再末尾ROUND_HALF_UP到分，可能存在行级显示尾差。',
        'weightBasis': '原weight保留；合计先按原值精确汇总，再末尾取微克，不改变原库。',
        'profitBasis': '总管理员明确选择读取原profit_c；员工报表仍由主程序独立利润权限控制。' if snapshot['profitIncluded'] else '本次未导出利润字段。',
    }
    return snapshot

def inventory_data(connection, snapshot):
    from app import views_stock, views_review, views_materials
    # The original helper functions resolve app.db.get_db() through flask.g.
    # All of their queries therefore use this exact read-only transaction.
    skus = checked_rows(connection, 'SELECT * FROM skus ORDER BY id')
    active = views_stock.active_batch()
    bid = int(active['id']) if active else 0
    live = views_stock.live_stock_map(bid)
    if len(live) > MAX_ROWS:
        raise SnapshotError('库存商品超过20000条，请先整理资料；没有截取部分商品。', 413)
    balances = []
    for row in skus:
        if row['id'] not in live:
            continue
        balances.append({
            'sourceId':'sku:' + str(row['id']) + '@batch:' + str(bid), 'sourceKind':'product', 'skuId':str(row['id']), 'batchId':str(bid),
            'code':row['code'], 'name':row['name'], 'category':row['category'],
            'materialType':row['material_type'], 'spec':row['spec'], 'unit':row['unit'],
            'location':row['location'], 'supplier':row['supplier'], 'active':bool(row['active']),
            'returned':bool(row['returned']), 'quantity':raw(live[row['id']]),
        })
    material_rows = checked_rows(connection, 'SELECT * FROM materials ORDER BY id')
    material_live = views_materials.material_stock_map()
    for row in material_rows:
        balances.append({
            'sourceId':'material:' + str(row['id']), 'sourceKind':'material', 'materialId':str(row['id']),
            'code':row['code'], 'name':row['name'], 'category':row['category'], 'materialType':'',
            'spec':row['spec'], 'unit':row['unit'], 'location':'', 'supplier':row['supplier'],
            'active':bool(row['active']), 'returned':False, 'quantity':raw(material_live.get(row['id'],0.0)),
        })
    first, last = snapshot['from'], snapshot['to']
    movements = checked_rows(connection, 'SELECT * FROM stock_moves WHERE substr(move_at,1,10)>=? AND substr(move_at,1,10)<=? ORDER BY move_at,id', (first, last))
    materials = checked_rows(connection, 'SELECT * FROM material_moves WHERE substr(move_at,1,10)>=? AND substr(move_at,1,10)<=? ORDER BY move_at,id', (first, last))
    moves = []
    for source, rows in (('product', movements), ('material', materials)):
        for row in rows:
            if row['direction'] not in ('in', 'out'):
                raise SnapshotError('原出入库方向无法识别，请先核对原资料。')
            product = source == 'product'
            moves.append({
                'sourceId':('stock_moves:' if product else 'material_moves:') + str(row['id']),
                'sourceKind':source, 'itemId':str(row['sku_id'] if product else row['material_id']),
                'dateTime':row['move_at'], 'direction':row['direction'],
                'code':row['sku_code'] if product else row['material_code'],
                'name':row['sku_name'] if product else row['material_name'],
                'category':row['category'], 'materialType':row['material_type'] if product else '',
                'spec':row['spec'] if product else '', 'unit':row['unit'],
                'location':row['location'] if product else '', 'supplier':row['supplier'] if product else '',
                'quantity':raw(row['qty']), 'operator':row['operator'],
                'unitWeightMicros':scaled(row['weight_grams'], 1000000, True) if product else None,
                'amountCents':scaled(row['total_cost'], 100, True) if product else None,
            })
    sessions = checked_rows(connection, "SELECT * FROM count_sessions WHERE substr(coalesce(nullif(finished_at,''),created_at),1,10)>=? AND substr(coalesce(nullif(finished_at,''),created_at),1,10)<=? ORDER BY id", (snapshot['from'], snapshot['to']))
    diffs = []
    for task in sessions:
        # Reject oversized sessions before the original helper builds its list.
        if connection.execute('SELECT count(*) FROM count_records WHERE session_id=?', (task['id'],)).fetchone()[0] > MAX_ROWS:
            raise SnapshotError('盘点记录超过20000条，请先整理资料；没有截取部分差异。', 413)
        for row in views_review.session_sku_rows(task):
            if row['diff_type'] == 'match':
                continue
            diffs.append({
                'sourceId':'session:' + str(task['id']) + ':sku:' + str(row['sku_id']),
                'sessionId':str(task['id']), 'sessionName':task['name'], 'batchId':str(task['batch_id']),
                'dateTime':task['finished_at'] or task['created_at'], 'status':task['status'],
                'skuId':str(row['sku_id']), 'code':row['code'], 'name':row['name'],
                'spec':row['spec'], 'unit':row['unit'], 'location':row['location'],
                'bookQuantity':raw(row['book_qty'], True), 'countedQuantity':raw(row['counted_qty'], True),
                'diffQuantity':raw(row['diff_qty'], True) if row['counted_qty'] is not None else None,
                'originalDiffQuantity':raw(row['diff_qty'], True), 'diffType':row['diff_type'],
                'statusName':row['status_name'], 'reviewStatus':row['review_status'] or 'pending',
                'reason':row['reason'] or '',
            })
            if len(diffs) + len(moves) + len(balances) > MAX_ROWS:
                raise SnapshotError('本次汇报超过20000条，请缩小日期范围；没有截取部分差异。', 413)
    snapshot.update(balances=balances, moves=moves, countDiffs=diffs)
    snapshot['sourceMeta'] = {
        'activeBatchId':str(bid), 'activeBatchLabel':active['label'] if active else '',
        'balancesBasis':'本次生成时当前库存：商品按原active batch/live_stock_map；物料按原material_stock_map全流水口径，单位分开；不是所选期间历史期末库存，未按价格重估。',
        'movementsBasis':'出入库按原move_at前10位日期筛选所选期间，包含T与空格时间及小数秒，不猜测时区；原total_cost读取值，不按金价重估余额。',
        'countDateBasis':'盘点按完成日期筛选，未完成按建单日期；原session_sku_rows口径，仅非match，含未盘。',
        'countDiffBasis':'未盘数量及无法确定的差异保留null，不当作0；originalDiffQuantity保留原模块推算值供核对，原账目未修改。',
    }
    return snapshot

def read_snapshot(module, directory, version, start, end, include_profit=False):
    start, end = period(start, end)
    now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
    snapshot = {'schemaVersion':1, 'module':module, 'version':version,
                'instance':hashlib.sha256(os.path.normcase(os.path.abspath(directory)).encode('utf-8')).hexdigest(),
                'from':start, 'to':end, 'capturedAt':now, 'asOf':now,
                'limits':{'maxRows':MAX_ROWS,'maxBytes':MAX_BYTES}, 'truncated':False}
    if module == 'ledger':
        snapshot['profitIncluded'] = include_profit
    filename = 'ledger.db' if module == 'ledger' else 'stockcheck.db'
    database = Path(directory) / filename
    old = g.pop('db', None)
    try:
        with contextlib.closing(sqlite3.connect(database.resolve().as_uri()+'?mode=ro', uri=True, timeout=30)) as connection:
            connection.row_factory = sqlite3.Row
            connection.execute('PRAGMA query_only=ON')
            connection.execute('BEGIN')
            g.db = connection
            try:
                result = ledger_data(connection,snapshot) if module == 'ledger' else inventory_data(connection,snapshot)
                return ensure_size(result)
            finally:
                connection.rollback()
                g.pop('db', None)
    finally:
        if old is not None:
            g.db = old

def install_collaboration(application, module, token, directory, version):
    @application.context_processor
    def navigation():
        return {'xjy_collaboration_enabled':True}
    def page():
        return render_template('xjy-collaboration.html', module=module)
    def source():
        principal = request.headers.get('X-XJY-Principal','')
        permit = request.headers.get('X-XJY-Source-Permit','')
        expected = hmac.new(token.encode(), ('collaboration-source:'+principal).encode('ascii'), hashlib.sha256).hexdigest()
        if not re.fullmatch(r'[a-f0-9]{64}',permit) or not hmac.compare_digest(expected,permit):
            return jsonify(error='原资料导出只能由主程序协作服务发起。'),403
        if getattr(g,'_xjy_actor',{}).get('access') not in ('operate','manage'):
            return jsonify(error='此导出需要模块操作权限。'),403
        if set(request.args) != {'from','to','includeProfit'} or any(len(request.args.getlist(key)) != 1 for key in request.args) or request.args['includeProfit'] not in ('0','1'):
            return jsonify(error='原资料导出参数无效。'),400
        include_profit = request.args['includeProfit'] == '1'
        if include_profit and (module != 'ledger' or getattr(g,'_xjy_actor',{}).get('role') != 'admin'):
            return jsonify(error='只有总管理员可明确选择导出原利润。'),403
        try:
            return jsonify(read_snapshot(module,directory,version,request.args['from'],request.args['to'],include_profit))
        except SnapshotError as error:
            return jsonify(error=str(error)),error.status
        except sqlite3.Error:
            return jsonify(error='原资料暂时无法一致读取，请核对资料目录后重试。'),503
    application.add_url_rule('/xjy/collaboration',endpoint='xjy_collaboration_page',view_func=page,methods=['GET'])
    application.add_url_rule('/xjy/collaboration/source',endpoint='xjy_collaboration_source',view_func=source,methods=['GET'])
