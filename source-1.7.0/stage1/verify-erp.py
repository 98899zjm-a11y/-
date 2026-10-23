"""ERP contract checks against the owned synthetic account only.

The restricted launcher registers fixed modes, never a caller-supplied path.
Imports and any SQLite connection occur only after the namespace guard installs.
"""
from pathlib import Path
import json
import os
import sys

ROOT = Path(__file__).resolve().parent.parent
from python_guard import install
policy = install(ROOT, require_restricted=True)
mode = sys.argv[1] if len(sys.argv) == 2 else 'values' if len(sys.argv) == 1 else ''
if mode not in ('values', 'baseline', 'check', 'exports', 'volume'):
    raise RuntimeError('ISOLATION: fixed ERP verification mode required')
os.environ['LEDGER_DATA'] = str(ROOT / 'data' / 'ledger')
os.environ['STOCKCHECK_DATA'] = str(ROOT / 'data' / 'inventory')
os.environ['LEDGER_DISABLE_BACKUP_THREAD'] = '1'
os.environ['LEDGER_DISABLE_EXTERNAL_THREAD'] = '1'
sys.path.insert(0, str(ROOT / 'project' / 'desktop' / 'legacy-source' / 'ledger'))

from repairs import install as install_repairs
install_repairs()
from app import create_app, db
app = create_app()
import erp
import erp_values

LEGACY_TABLES = ('sales', 'stock_items', 'material_stock', 'settings', 'formula_sets')
BASELINE = ROOT / 'data' / 'documents' / 'erp-legacy-baseline.json'
EXPORT = ROOT / 'data' / 'documents' / 'erp-report-fixture.xlsx'

def snapshot():
    import sqlite3
    result = {}
    with db.connect() as connection:
        for table in LEGACY_TABLES:
            # These are fixed identifiers, never external SQL input.
            result['ledger.' + table] = [dict(row) for row in connection.execute('SELECT * FROM ' + table + ' ORDER BY rowid')]
    for relative, tables in (
        ('data/inventory/stockcheck.db', ('skus', 'stock_moves', 'count_sessions')),
        ('data/sales/jewelry.sqlite', ('quotes',)),
    ):
        target = ROOT / relative
        policy['check'](target, False)
        with sqlite3.connect(target) as connection:
            connection.row_factory = sqlite3.Row
            for table in tables:
                result[relative + ':' + table] = [dict(row) for row in connection.execute('SELECT * FROM ' + table + ' ORDER BY rowid')]
    return result

def configure_without_rewriting_legacy():
    with app.app_context():
        before = snapshot()
        erp.configure(app)
        after = snapshot()
        assert before == after, 'ERP initialization must preserve original financial rows and algorithms'

def values():
    import unittest
    from decimal import Decimal
    class Numbers(unittest.TestCase):
        def test_exact_money_does_not_accumulate_binary_rounding(self):
            self.assertEqual(erp_values.money('0.10'), 10)
            self.assertEqual(erp_values.money('2.35'), 235)
            self.assertEqual(sum(erp_values.money('0.10') for _ in range(10)), 100)
            self.assertEqual(erp_values.money('123456.78'), 12345678)
        def test_unsafe_money_classes_are_rejected(self):
            for value in (True, False, 'NaN', 'Infinity', '-Infinity', '-1.00', '0.001', '9' * 40, None, [], {}):
                with self.subTest(value=repr(value)):
                    with self.assertRaises((ValueError, TypeError)):
                        erp_values.money(value)
        def test_weight_is_fixed_decimal_and_not_money(self):
            self.assertEqual(Decimal(str(erp_values.weight('1.2345'))), Decimal('1.2345'))
            for value in (True, 'NaN', 'Infinity', '-1', '0.00001', '9' * 40):
                with self.subTest(value=repr(value)):
                    with self.assertRaises((ValueError, TypeError)):
                        erp_values.weight(value)
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(Numbers)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if not result.wasSuccessful():
        raise RuntimeError('ERP Decimal validation failed')
    print(json.dumps({'passed': result.testsRun, 'scope': 'owned synthetic values and unchanged legacy initialization'}))

def baseline():
    import uuid
    from repairs import transaction, write_row, SALE_COLUMNS, SALE_NUMBERS
    with app.test_request_context('/'):
        with transaction() as connection:
            # Fresh source ID permits deterministic re-runs while preserving every
            # previous run's original financial row in the comparison snapshot.
            columns = {row[1] for row in connection.execute('PRAGMA table_info(sales)')}
            historical = {name: '' for name in SALE_COLUMNS if name in columns}
            historical.update({name: 0 for name in SALE_NUMBERS if name in columns})
            historical.update({
                'date': '2026-10-01', 'product': 'ERP回归保留样本-' + uuid.uuid4().hex[:8], 'status': '已完成',
                'weight': 1.2345, 'sell_gram_price': 456.78, 'labor': 12.34,
                'received': 123.45, 'cost': 0, 'spread': 0,
                'amount_c': 500.37, 'cost_gram_c': 0, 'profit_c': 123.45,
                'gross_rate_c': 1, 'comm_cost_c': 0, 'comm_c': 0, 'comm_profit_c': 123.45,
            })
            historical = {key: value for key, value in historical.items() if key in columns}
            sale_id = write_row(connection, 'sales', historical)
    with app.app_context():
        data = snapshot()
    policy['check'](BASELINE, True)
    BASELINE.write_text(json.dumps(data, ensure_ascii=False, sort_keys=True, default=str), encoding='utf-8')
    print(json.dumps({'legacySaleId': sale_id, 'tables': len(data), 'synthetic': True}))

def check():
    policy['check'](BASELINE, False)
    saved = json.loads(BASELINE.read_text(encoding='utf-8'))
    with app.app_context():
        current = json.loads(json.dumps(snapshot(), default=str))
    assert saved == current, 'ERP changed original sale/calculation/settings/inventory/quote data'
    print(json.dumps({'passed': True, 'tables': len(current), 'scope': 'original financial values and no automatic sales/inventory writes'}))

def exports():
    from openpyxl import load_workbook
    policy['check'](EXPORT, False)
    assert EXPORT.read_bytes()[:2] == b'PK', 'ERP export must be OOXML rather than renamed CSV'
    book = load_workbook(EXPORT, read_only=True, data_only=False)
    try:
        assert book.sheetnames, 'ERP workbook needs a sheet'
        rows = [tuple(cell.value for cell in row) for row in book.active.iter_rows()]
        assert len(rows) > 1, 'ERP export must contain real report rows'
        assert all(cell.data_type != 'f' for sheet in book for row in sheet.iter_rows() for cell in row), 'User-provided party and note text cannot become executable spreadsheet formulas'
        assert any('ERP-EXPORT' in str(value) for row in rows for value in row), 'Report fixture must include the source party text'
    finally:
        book.close()
    print(json.dumps({'passed': True, 'rows': len(rows), 'scope': 'actual XLSX read, source data and no formula cells'}))

def volume():
    """Temporary synthetic ERP-only fixture for the historical 1000-row cutoff.

    The caller must take and restore an owned ledger snapshot around this mode.
    No ordinary finance, sales, stock or supplier table is changed here.
    """
    import uuid
    from erp_common import transaction
    from erp_values import encoded, digest
    party_id = 'CUS:' + str(uuid.uuid4())
    label = uuid.uuid4().hex
    party_name = 'ERP容量测试客户-' + label[:8]
    author_id = 'erp-capacity-test'
    author_name = 'ERP容量测试'
    records = []
    old_id = None
    for index in range(1001):
        doc_id = str(uuid.uuid4())
        request_id = str(uuid.uuid4())
        day = '2020-01-01' if index == 0 else '2021-01-01'
        due = '2020-01-31' if index == 0 else '2021-01-31'
        at = day + ' 00:00:00'
        payload = {'kind': 'receivable', 'partyId': party_id, 'date': day,
                   'dueDate': due, 'amountCents': 1, 'attachments': [],
                   'note': '仅供隔离容量回归，测试结束由快照恢复'}
        request = {'requestId': request_id, 'kind': 'receivable',
                   'partyId': party_id, 'date': day, 'dueDate': due,
                   'amount': '0.01', 'attachments': [], 'note': payload['note']}
        records.append((doc_id, 'TEST-CAPACITY-' + label + '-' + str(index).zfill(4),
                        'receivable', party_id, party_name, day, due, 1,
                        encoded(payload), request_id, digest(request),
                        author_id, author_name, 'draft', 1, at, at))
        if index == 0:
            old_id = doc_id
    with app.app_context():
        with transaction() as connection:
            connection.execute('''INSERT INTO erp_parties(
                id,kind,supplier_id,name,norm_name,contact,phone,terms_days,note,
                active,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                (party_id, 'customer', None, party_name, party_name.casefold(),
                 'ERP容量测试', '000', 30, '纯虚构临时容量样本，不关联销售客户',
                 1, 1, '2020-01-01 00:00:00', '2020-01-01 00:00:00'))
            connection.executemany('''INSERT INTO erp_documents(
                id,number,kind,party_id,party_name,date,due_date,amount_cents,payload,
                request_id,request_hash,author_id,author_name,status,revision,
                created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''', records)
    print(json.dumps({'oldId': old_id, 'createdCount': len(records)}))

if __name__ == '__main__':
    configure_without_rewriting_legacy()
    {'values': values, 'baseline': baseline, 'check': check, 'exports': exports, 'volume': volume}[mode]()
