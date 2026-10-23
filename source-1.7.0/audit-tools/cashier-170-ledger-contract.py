"""Finite Guest-only cashier SQLite contracts, with literal fictional records.

No Host business execution. The unchanged actual Sandbox admission runs before
loading the subject or opening SQLite. Initial null pins require the product
files to be absent and produce FEATURE_REQUIRED failures, not skips. Root must
freeze a separate exact source-pin file before a later GREEN execution.
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PYTHON = Path('C:/Python314/python.exe')
if (os.name != 'nt' or os.path.normcase(str(ROOT)) != os.path.normcase('C:/xjy-work/xjy-web-stage1') or
        os.path.normcase(sys.executable) != os.path.normcase(str(PYTHON)) or
        not sys.flags.isolated or not sys.flags.no_site or not sys.flags.dont_write_bytecode or sys.flags.optimize):
    raise RuntimeError('Fixed actual offline Guest Python -I -B -S required before business imports')

import argparse
import ast
import base64
import contextlib
import hashlib
import importlib.util
import json
import re
import sqlite3
import stat
import threading
import types
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor

SELF = ROOT / 'audit-tools/cashier-170-ledger-contract.py'
LEDGER = ROOT / 'project/desktop/legacy-source/ledger'
GUARD = ROOT / 'stage1/sandbox-context.py'
VALIDATOR = ROOT / 'stage1/validate-sandbox-context.py'
GUARD_SHA = '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249'
VALIDATOR_SHA = '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207'
PYTHON_SHA = '434b361fe0c5960d404974feed493db47f2603a1ace2574312104fbed0182c6f'
SUBJECTS = ('cashier_schema.py', 'cashier_numbers.py', 'cashier_engine.py')
MODULES = {}
OLD_DDL = []
RUN_ROOT = None
STAMP = '2026-10-19T09:05:00.000Z'
DAY = '2026-10-19'
CAPS = [
    'cashier.read', 'cashier.amounts.sensitive', 'cashier.sources.read',
    'cashier.accounts.manage', 'cashier.documents.prepare', 'cashier.documents.review',
    'cashier.refunds.prepare', 'cashier.refunds.review', 'cashier.transfers.prepare', 'cashier.transfers.review',
    'cashier.opening.prepare', 'cashier.opening.review', 'cashier.reversals.prepare', 'cashier.reversals.review',
    'cashier.reconcile.import', 'cashier.reconcile.match', 'cashier.reconcile.review',
    'cashier.reports.view', 'cashier.reports.export',
]


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')).hexdigest()


def ordinary_read(file, limit=2 * 1024 * 1024):
    file = Path(file)
    for item in (file, *file.parents):
        info = item.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
            raise RuntimeError('Reviewed source cannot be a link or reparse point')
        if stat.S_ISREG(info.st_mode) and info.st_nlink != 1:
            raise RuntimeError('Reviewed source cannot be hardlinked')
    body = file.read_bytes()
    if not file.is_file() or len(body) > limit:
        raise RuntimeError('Bounded ordinary reviewed source required')
    return body


def cash_actor(number, role='employee', access='manage'):
    identifier = f'50000000-0000-4000-8000-{number:012d}'
    return {'v': 1, 'module': 'cashier', 'authorityModule': 'cashier', 'storageModule': 'ledger',
            'protocolVersion': 3, 'staffId': identifier, 'userId': identifier, 'name': f'虚构出纳{number}',
            'role': role, 'access': access, 'grantRevision': 3, 'capabilities': list(CAPS)}


A, B, C = cash_actor(1), cash_actor(2), cash_actor(3)
ADMIN = cash_actor(4, 'admin')
FINANCE = {'v': 1, 'module': 'ledger', 'protocolVersion': 2,
           'staffId': '50000000-0000-4000-8000-000000000005', 'userId': '50000000-0000-4000-8000-000000000005',
           'name': '虚构财务发布员', 'role': 'employee', 'access': 'manage', 'grantRevision': 4,
           'capabilities': ['erp.read', 'erp.cashier.release']}
CUSTOMER = '60000000-0000-4000-8000-000000000001'
SUPPLIER = '60000000-0000-4000-8000-000000000002'


class Fixture:
    def __init__(self, case):
        self.case = case
        for name, export in [('cashier_schema.py', 'initialize'), ('cashier_numbers.py', 'create_reserver'), ('cashier_engine.py', 'create_engine')]:
            case.assertTrue(callable(getattr(MODULES.get(name), export, None)), 'FEATURE_REQUIRED: ' + name + '::' + export)
        self.directory = RUN_ROOT / case.id().rsplit('.', 1)[-1]
        self.directory.mkdir(exist_ok=False)
        self.database = self.directory / 'fictional-ledger.db'
        self.retained = self.directory / 'retained'
        self.retained.mkdir(exist_ok=False)
        self.reserve = MODULES['cashier_numbers.py'].create_reserver(path=self.retained / 'cashier-numbers.json', namespace='cashier-contract-' + self.directory.name)
        case.assertTrue(callable(self.reserve), 'FEATURE_REQUIRED: retained cashier number provider')
        with contextlib.closing(self.connection()) as c:
            c.executescript("CREATE TABLE suppliers(id INTEGER PRIMARY KEY); CREATE TABLE sales(id INTEGER PRIMARY KEY,amount_c TEXT); CREATE TABLE stock_items(id INTEGER PRIMARY KEY,weight TEXT); INSERT INTO sales VALUES(1,'71.23'); INSERT INTO stock_items VALUES(1,'3.1200');")
            for sql in OLD_DDL:
                c.execute(sql)
            c.execute('INSERT INTO erp_metadata(version) VALUES(1)')
            for table in ('erp_bills', 'erp_postings', 'erp_allocations', 'erp_receipt_quantities', 'erp_reversals', 'erp_sale_sources'):
                for action in ('UPDATE', 'DELETE'):
                    c.execute(f"CREATE TRIGGER {table}_no_{action.lower()} BEFORE {action} ON {table} BEGIN SELECT RAISE(ABORT,'immutable ERP posting'); END")
            for party, kind, name in [(CUSTOMER, 'customer', '虚构客户甲'), (SUPPLIER, 'supplier', '虚构供应商乙')]:
                c.execute('INSERT INTO erp_parties(id,kind,supplier_id,name,norm_name,contact,phone,terms_days,note,active,revision,created_at,updated_at) VALUES(?,?,NULL,?,?,?,?,0,?,1,1,?,?)', (party, kind, name, name, '', '', '虚构合同', STAMP, STAMP))
            MODULES['cashier_schema.py'].initialize(c)
        self.engine = self.new_engine()

    def connection(self):
        c = sqlite3.connect(self.database, isolation_level=None, timeout=5)
        c.row_factory = sqlite3.Row
        c.execute('PRAGMA foreign_keys=ON')
        c.execute('PRAGMA busy_timeout=5000')
        return c

    def new_engine(self):
        return MODULES['cashier_engine.py'].create_engine(connect=self.connection, reserve_number=self.reserve, clock=lambda: STAMP)

    def call(self, actor, path, method='GET', body=None, engine=None):
        result = (engine or self.engine).dispatch(actor=actor, method=method, path=path, body={} if body is None else body)
        self.case.assertIsInstance(result, dict)
        return result

    def rejected(self, actor, path, method, body, statuses=(403, 409), engine=None):
        with self.case.assertRaises(Exception) as caught:
            self.call(actor, path, method, body, engine)
        self.case.assertIn(getattr(caught.exception, 'status', None), statuses, repr(caught.exception))

    def rows(self, sql, args=()):
        c = self.connection()
        try:
            return [dict(row) for row in c.execute(sql, args)]
        finally:
            c.close()

    def execute(self, sql, args=()):
        c = self.connection()
        try:
            c.execute(sql, args)
        finally:
            c.close()

    def account(self, name='虚构现金柜', kind='cash'):
        result = self.call(ADMIN, '/cashier/api/accounts', 'POST', {'requestId': str(uuid.uuid4()), 'code': str(uuid.uuid4()), 'name': name, 'kind': kind, 'currency': 'CNY', 'maskedReference': '', 'note': '虚构账户'})['account']
        for actor in (A, B, C):
            self.execute('INSERT INTO cashier_account_scopes(staff_id,account_id,level,revision) VALUES(?,?,?,1)', (actor['staffId'], result['id'], 'manage'))
        return result['id']

    def draft(self, kind, account, amount, *, actor=A, request_id=None, **extra):
        body = {'requestId': request_id or str(uuid.uuid4()), 'kind': kind, 'accountId': account, 'businessDate': DAY, 'amountCents': str(amount), 'note': '虚构资金凭证', **extra}
        return self.call(actor, '/cashier/api/documents', 'POST', body)['document']

    def pending(self, document, actor=A):
        return self.call(actor, '/cashier/api/documents/' + document['id'] + '/submit', 'POST', {'requestId': str(uuid.uuid4()), 'revision': document['revision']})['document']

    def review_body(self, document, request_id=None):
        return {'requestId': request_id or str(uuid.uuid4()), 'revision': document['revision'], 'hash': document['frozenHash'], 'decision': 'approve', 'note': '虚构异人复核'}

    def approve(self, document, actor=B, request_id=None, engine=None):
        return self.call(actor, '/cashier/api/documents/' + document['id'] + '/review', 'POST', self.review_body(document, request_id), engine)['document']

    def post(self, kind, account, amount, **extra):
        return self.approve(self.pending(self.draft(kind, account, amount, **extra)))

    def refuse_post(self, kind, account, amount, statuses=(409,), **extra):
        # A safe implementation may reject a known-invalid draft early; the
        # race tests separately prove mandatory revalidation at approval time.
        with self.case.assertRaises(Exception) as caught:
            self.post(kind, account, amount, **extra)
        self.case.assertIn(getattr(caught.exception, 'status', None), statuses, repr(caught.exception))

    def opening(self, account, amount=0):
        return self.post('opening', account, amount, evidence='虚构人工盘点表，不是真实余额', businessDate='2026-10-01')

    def balance(self, account):
        return sum(row['signed_amount_cents'] for row in self.rows('SELECT signed_amount_cents FROM cashier_postings WHERE account_id=?', (account,)))

    def money_state(self):
        tables = ('cashier_postings', 'cashier_allocations', 'cashier_erp_links', 'cashier_refund_links', 'cashier_reversals', 'erp_postings', 'erp_allocations', 'erp_reversals', 'sales', 'stock_items')
        return {table: self.rows('SELECT * FROM ' + table + ' ORDER BY rowid') for table in tables}

    def source(self, amount=10000, kind='receivable', publish=True):
        bill_id, party = str(uuid.uuid4()), CUSTOMER if kind == 'receivable' else SUPPLIER
        doc_kind = 'opening_receivable' if kind == 'receivable' else 'opening_payable'
        payload = {'kind': doc_kind, 'partyId': party, 'date': DAY, 'dueDate': DAY, 'note': '虚构已审核义务', 'attachments': [], 'amountCents': amount, 'evidence': '虚构审核依据'}
        frozen = digest({'id': bill_id, 'payload': payload, 'revision': 2, 'lines': []})
        values = (bill_id, 'FICT-' + bill_id, doc_kind, party, '虚构单位', DAY, DAY, amount, json.dumps(payload, ensure_ascii=False), str(uuid.uuid4()), digest(payload), '50000000-0000-4000-8000-000000000006', '虚构财务制单员', 'confirmed', 3, frozen, FINANCE['staffId'], FINANCE['name'], STAMP, STAMP)
        self.execute('INSERT INTO erp_documents(id,number,kind,party_id,party_name,date,due_date,amount_cents,payload,request_id,request_hash,author_id,author_name,status,revision,frozen_hash,reviewer_id,reviewer_name,created_at,updated_at) VALUES(' + ','.join('?' for _ in values) + ')', values)
        self.execute('INSERT INTO erp_bills(id,kind,party_id,party_name,date,due_date,amount_cents,source_type,source_id) VALUES(?,?,?,?,?,?,?,?,?)', (bill_id, kind, party, '虚构单位', DAY, DAY, amount, doc_kind, bill_id))
        self.execute('INSERT INTO erp_postings(doc_id,bill_id,date,face_cents,settled_cents) VALUES(?,?,?,?,0)', (bill_id, bill_id, DAY, amount))
        body = {'requestId': str(uuid.uuid4()), 'billId': bill_id, 'revision': 3, 'hash': frozen, 'note': '虚构发布到出纳'}
        if not publish:
            return bill_id, None, body
        release = self.call(FINANCE, '/erp/api/cashier-source-releases', 'POST', body)['release']
        return bill_id, release, body

    def receipt(self, account, release, amount, **extra):
        return self.post('receive', account, amount, partyId=CUSTOMER, allocations=[{'releaseId': release['id'], 'amountCents': str(amount)}], **extra)

    def outstanding(self, bill_id):
        return sum(row['face_cents'] - row['settled_cents'] for row in self.rows('SELECT face_cents,settled_cents FROM erp_postings WHERE bill_id=?', (bill_id,)))


class CashierLedgerContracts(unittest.TestCase):
    def fixture(self):
        return Fixture(self)

    def test_L01_opening_requires_distinct_reviewer_and_is_a_single_immutable_posting(self):
        f = self.fixture(); account = f.account()
        pending = f.pending(f.draft('opening', account, 10000, evidence='虚构期初盘点', businessDate='2026-10-01'))
        f.rejected(A, '/cashier/api/documents/' + pending['id'] + '/review', 'POST', f.review_body(pending), (403,))
        self.assertEqual(f.balance(account), 0)
        posted = f.approve(pending)
        self.assertEqual(posted['status'], 'confirmed'); self.assertEqual(f.balance(account), 10000)
        self.assertEqual(len(f.rows('SELECT * FROM cashier_postings WHERE doc_id=?', (posted['id'],))), 1)
        f.refuse_post('opening', account, 20000, evidence='虚构重复期初', businessDate='2026-10-01')
        self.assertEqual(f.balance(account), 10000)

    def test_L02_partial_receipts_change_cash_and_erp_once_without_changing_sales_or_inventory(self):
        f = self.fixture(); account = f.account(); f.opening(account)
        bill, release, _ = f.source(10000)
        original_sales, original_stock = f.rows('SELECT * FROM sales'), f.rows('SELECT * FROM stock_items')
        a = f.receipt(account, release, 3000); b = f.receipt(account, release, 2000)
        self.assertEqual(f.balance(account), 5000); self.assertEqual(f.outstanding(bill), 5000)
        for doc in (a, b):
            self.assertEqual(len(f.rows('SELECT * FROM cashier_erp_links WHERE cash_doc_id=?', (doc['id'],))), 1)
            self.assertEqual(len(f.rows('SELECT * FROM cashier_postings WHERE doc_id=?', (doc['id'],))), 1)
        self.assertEqual(f.rows('SELECT * FROM sales'), original_sales); self.assertEqual(f.rows('SELECT * FROM stock_items'), original_stock)
        before = f.money_state(); f.refuse_post('receive', account, 5001, partyId=CUSTOMER, allocations=[{'releaseId': release['id'], 'amountCents': '5001'}]); self.assertEqual(f.money_state(), before)

    def test_L03_partial_payment_uses_payable_direction_and_cannot_overdraw(self):
        f = self.fixture(); account = f.account(); f.opening(account, 7000)
        bill, release, _ = f.source(9000, 'payable')
        f.post('pay', account, 3000, partyId=SUPPLIER, allocations=[{'releaseId': release['id'], 'amountCents': '3000'}])
        self.assertEqual(f.balance(account), 4000); self.assertEqual(f.outstanding(bill), 6000)
        before = f.money_state(); f.refuse_post('pay', account, 5000, partyId=SUPPLIER, allocations=[{'releaseId': release['id'], 'amountCents': '5000'}]); self.assertEqual(f.money_state(), before)
        f.rejected(A, '/cashier/api/documents', 'POST', {'requestId': str(uuid.uuid4()), 'kind': 'receive', 'accountId': account, 'partyId': SUPPLIER, 'businessDate': DAY, 'amountCents': '1', 'allocations': [{'releaseId': release['id'], 'amountCents': '1'}], 'note': '虚构错误方向'}, (400, 409))

    def test_L04_transfer_second_leg_failure_rolls_back_both_sides_and_retry_posts_exactly_two(self):
        f = self.fixture(); source = f.account(); target = f.account('虚构银行乙', 'bank'); f.opening(source, 10000); f.opening(target, 2000)
        doc = f.pending(f.draft('transfer', source, 4500, toAccountId=target))
        f.execute("CREATE TRIGGER fixture_refuse_credit BEFORE INSERT ON cashier_postings WHEN NEW.account_id='" + target + "' AND NEW.signed_amount_cents>0 BEGIN SELECT RAISE(ABORT,'fixture second leg failure'); END")
        before = f.money_state(); audit_before = f.rows('SELECT * FROM cashier_events ORDER BY rowid'); review_id = str(uuid.uuid4())
        f.rejected(B, '/cashier/api/documents/' + doc['id'] + '/review', 'POST', f.review_body(doc, review_id), (409, 503))
        self.assertEqual(f.money_state(), before); self.assertEqual(f.rows('SELECT * FROM cashier_events ORDER BY rowid'), audit_before)
        f.execute('DROP TRIGGER fixture_refuse_credit'); f.approve(doc, request_id=review_id)
        self.assertEqual((f.balance(source), f.balance(target)), (5500, 6500))
        postings = f.rows('SELECT * FROM cashier_postings WHERE doc_id=?', (doc['id'],))
        self.assertEqual(len(postings), 2); self.assertEqual(sum(x['signed_amount_cents'] for x in postings), 0)

    def test_L05_refund_is_real_cash_and_does_not_implicitly_reopen_debt(self):
        f = self.fixture(); account = f.account(); f.opening(account); bill, release, _ = f.source(10000)
        original = f.receipt(account, release, 7000); f.post('refund_out', account, 2000, partyId=CUSTOMER, originalCashDocId=original['id'], refundBasis='虚构已批准退款依据')
        self.assertEqual(f.balance(account), 5000); self.assertEqual(f.outstanding(bill), 3000)
        self.assertEqual(len(f.rows('SELECT * FROM cashier_refund_links WHERE original_cash_doc_id=?', (original['id'],))), 1)
        before = f.money_state(); f.refuse_post('refund_out', account, 5001, partyId=CUSTOMER, originalCashDocId=original['id'], refundBasis='虚构超额退款依据'); self.assertEqual(f.money_state(), before)

    def test_L06_correction_reversal_restores_cash_and_debt_but_retains_original_rows(self):
        f = self.fixture(); account = f.account(); f.opening(account); bill, release, _ = f.source(10000)
        original = f.receipt(account, release, 7000); original_rows = f.rows('SELECT * FROM cashier_postings WHERE doc_id=?', (original['id'],))
        reversal = f.post('reversal', account, 7000, targetId=original['id'], note='虚构误记冲销，未实际退款')
        self.assertEqual(f.balance(account), 0); self.assertEqual(f.outstanding(bill), 10000)
        self.assertEqual(f.rows('SELECT * FROM cashier_postings WHERE doc_id=?', (original['id'],)), original_rows)
        self.assertEqual(sum(x['signed_amount_cents'] for x in f.rows('SELECT * FROM cashier_postings WHERE doc_id=?', (reversal['id'],))), -7000)
        self.assertEqual(len(f.rows('SELECT * FROM cashier_reversals WHERE target_doc_id=?', (original['id'],))), 1)

    def test_L07_postings_confirmed_documents_and_events_cannot_be_updated_or_deleted(self):
        f = self.fixture(); account = f.account(); doc = f.opening(account, 10000)
        for sql, args in [('UPDATE cashier_postings SET signed_amount_cents=1 WHERE doc_id=?', (doc['id'],)), ('DELETE FROM cashier_postings WHERE doc_id=?', (doc['id'],)), ('UPDATE cashier_documents SET amount_cents=1 WHERE id=?', (doc['id'],)), ('DELETE FROM cashier_events', ())]:
            with self.assertRaises(sqlite3.IntegrityError):
                f.execute(sql, args)
        self.assertEqual(f.balance(account), 10000)

    def test_L08_creation_and_review_retries_are_idempotent_and_payload_changes_conflict(self):
        f = self.fixture(); account = f.account(); f.opening(account); _, release, _ = f.source(10000)
        request_id = str(uuid.uuid4()); args = {'partyId': CUSTOMER, 'allocations': [{'releaseId': release['id'], 'amountCents': '3000'}]}
        first = f.draft('receive', account, 3000, request_id=request_id, **args)
        repeated = f.draft('receive', account, 3000, request_id=request_id, **args); self.assertEqual(repeated['id'], first['id'])
        f.rejected(A, '/cashier/api/documents', 'POST', {'requestId': request_id, 'kind': 'receive', 'accountId': account, 'businessDate': DAY, 'amountCents': '3001', 'partyId': CUSTOMER, 'allocations': [{'releaseId': release['id'], 'amountCents': '3001'}], 'note': '虚构资金凭证'}, (409,))
        pending = f.pending(first); review_id = str(uuid.uuid4()); posted = f.approve(pending, request_id=review_id)
        repeated_review = f.approve(pending, request_id=review_id)
        self.assertEqual(repeated_review['id'], posted['id']); self.assertEqual(f.balance(account), 3000)
        self.assertEqual(len(f.rows('SELECT * FROM cashier_postings WHERE doc_id=?', (posted['id'],))), 1)

    def test_L09_two_sqlite_writers_cannot_overallocate_the_same_source(self):
        f = self.fixture(); account = f.account(); f.opening(account); bill, release, _ = f.source(10000)
        docs = [f.pending(f.draft('receive', account, 6000, partyId=CUSTOMER, allocations=[{'releaseId': release['id'], 'amountCents': '6000'}])) for _ in range(2)]
        barrier = threading.Barrier(2); request_ids = [str(uuid.uuid4()), str(uuid.uuid4())]
        def worker(index):
            engine = f.new_engine(); barrier.wait(timeout=10)
            try:
                return f.approve(docs[index], actor=(B, C)[index], request_id=request_ids[index], engine=engine)
            except Exception as exc:
                return {'errorStatus': getattr(exc, 'status', None), 'errorType': type(exc).__name__}
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(worker, range(2)))
        self.assertEqual(sum(x.get('status') == 'confirmed' for x in results), 1, results)
        for index, result in enumerate(results):
            if 'errorStatus' in result:
                self.assertIn(result['errorStatus'], (409, 503), result)
                f.rejected((B, C)[index], '/cashier/api/documents/' + docs[index]['id'] + '/review', 'POST', f.review_body(docs[index], request_ids[index]), (409,))
        self.assertEqual(f.balance(account), 6000); self.assertEqual(f.outstanding(bill), 4000)

    def test_L10_withdraw_and_review_compete_on_one_revision_without_partial_posting(self):
        f = self.fixture(); account = f.account(); f.opening(account); bill, release, _ = f.source(10000)
        doc = f.pending(f.draft('receive', account, 3000, partyId=CUSTOMER, allocations=[{'releaseId': release['id'], 'amountCents': '3000'}]))
        barrier = threading.Barrier(2)
        def worker(review):
            engine = f.new_engine(); barrier.wait(timeout=10)
            try:
                if review:
                    return f.approve(doc, engine=engine)['status']
                return f.call(A, '/cashier/api/documents/' + doc['id'] + '/withdraw', 'POST', {'requestId': str(uuid.uuid4()), 'revision': doc['revision'], 'note': '虚构撤回'}, engine)['document']['status']
            except Exception as exc:
                self.assertIn(getattr(exc, 'status', None), (409, 503)); return 'conflict'
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(worker, (True, False)))
        self.assertEqual(results.count('conflict'), 1, results)
        if 'confirmed' in results:
            self.assertEqual((f.balance(account), f.outstanding(bill)), (3000, 7000))
        else:
            self.assertIn('draft', results); self.assertEqual((f.balance(account), f.outstanding(bill)), (0, 10000))

    def test_L11_cashier_cannot_publish_sources_and_revoked_or_reversed_sources_cannot_be_paid(self):
        f = self.fixture(); account = f.account(); f.opening(account); bill, _, publish = f.source(10000, publish=False)
        f.rejected(A, '/erp/api/cashier-source-releases', 'POST', publish, (403,))
        release = f.call(FINANCE, '/erp/api/cashier-source-releases', 'POST', publish)['release']
        doc = f.pending(f.draft('receive', account, 3000, partyId=CUSTOMER, allocations=[{'releaseId': release['id'], 'amountCents': '3000'}]))
        revoke = {'requestId': str(uuid.uuid4()), 'revision': release['revision'], 'note': '虚构来源撤回'}
        f.rejected(A, '/erp/api/cashier-source-releases/' + release['id'] + '/revoke', 'POST', revoke, (403,))
        f.call(FINANCE, '/erp/api/cashier-source-releases/' + release['id'] + '/revoke', 'POST', revoke)
        before = f.money_state(); f.rejected(B, '/cashier/api/documents/' + doc['id'] + '/review', 'POST', f.review_body(doc), (409,)); self.assertEqual(f.money_state(), before)
        second, release2, _ = f.source(2000); other = f.pending(f.draft('receive', account, 1000, partyId=CUSTOMER, allocations=[{'releaseId': release2['id'], 'amountCents': '1000'}]))
        reversal_id = str(uuid.uuid4()); original = f.rows('SELECT * FROM erp_documents WHERE id=?', (second,))[0]
        copied = dict(original, id=reversal_id, number='FICT-REV-' + reversal_id, kind='reversal', request_id=str(uuid.uuid4()), payload=json.dumps({'kind': 'reversal', 'targetId': second, 'note': '虚构ERP已冲销'}))
        f.execute('INSERT INTO erp_documents(' + ','.join(copied) + ') VALUES(' + ','.join('?' for _ in copied) + ')', tuple(copied.values()))
        f.execute('INSERT INTO erp_reversals(target_id,reversal_id) VALUES(?,?)', (second, reversal_id))
        f.execute('INSERT INTO erp_postings(doc_id,bill_id,date,face_cents,settled_cents) VALUES(?,?,?,-2000,0)', (reversal_id, second, DAY))
        before = f.money_state(); f.rejected(B, '/cashier/api/documents/' + other['id'] + '/review', 'POST', f.review_body(other), (409,)); self.assertEqual(f.money_state(), before)

    def test_L12_account_scope_revocation_is_checked_inside_review_not_from_actor_claims(self):
        f = self.fixture(); account = f.account(); f.opening(account); _, release, _ = f.source(10000)
        doc = f.pending(f.draft('receive', account, 3000, partyId=CUSTOMER, allocations=[{'releaseId': release['id'], 'amountCents': '3000'}]))
        f.execute("UPDATE cashier_account_scopes SET level='disabled',revision=revision+1 WHERE staff_id=? AND account_id=?", (B['staffId'], account))
        before = f.money_state(); f.rejected(B, '/cashier/api/documents/' + doc['id'] + '/review', 'POST', f.review_body(doc), (403,)); self.assertEqual(f.money_state(), before)
        forged = dict(B, accountIds=[account], scopeRevision=1)
        f.rejected(forged, '/cashier/api/documents/' + doc['id'] + '/review', 'POST', f.review_body(doc), (400, 403)); self.assertEqual(f.money_state(), before)

    def test_L13_restore_keeps_saved_request_idempotence_and_never_reuses_lost_draft_number(self):
        f = self.fixture(); account = f.account(); f.opening(account); _, release, _ = f.source(10000)
        saved_request = str(uuid.uuid4()); original = f.draft('receive', account, 3000, request_id=saved_request, partyId=CUSTOMER, allocations=[{'releaseId': release['id'], 'amountCents': '3000'}]); f.approve(f.pending(original))
        backup_path = f.directory / 'fictional-snapshot.db'; source = f.connection(); backup = sqlite3.connect(backup_path)
        try:
            source.backup(backup)
        finally:
            source.close(); backup.close()
        lost_draft = f.draft('receive', account, 1000, partyId=CUSTOMER, allocations=[{'releaseId': release['id'], 'amountCents': '1000'}])
        backup = sqlite3.connect(backup_path); destination = f.connection()
        try:
            backup.backup(destination)
        finally:
            backup.close(); destination.close()
        f.engine = f.new_engine()
        repeated = f.draft('receive', account, 3000, request_id=saved_request, partyId=CUSTOMER, allocations=[{'releaseId': release['id'], 'amountCents': '3000'}])
        self.assertEqual(repeated['id'], original['id']); self.assertEqual(f.balance(account), 3000)
        fresh = f.draft('receive', account, 1000, partyId=CUSTOMER, allocations=[{'releaseId': release['id'], 'amountCents': '1000'}])
        self.assertNotEqual(fresh['number'], lost_draft['number']); self.assertNotEqual(fresh['number'], original['number'])
        self.assertTrue((f.retained / 'cashier-numbers.json').is_file())

    def test_L14_importing_a_csv_statement_never_creates_money_or_erp_entries(self):
        f = self.fixture(); account = f.account('虚构银行', 'bank'); f.opening(account, 10000)
        csv_bytes = 'date,amount,reference\n2026-10-19,12.34,FICT-BANK-001\n'.encode('utf-8')
        body = {'requestId': str(uuid.uuid4()), 'accountId': account, 'csvBase64': base64.b64encode(csv_bytes).decode('ascii'), 'encoding': 'utf-8', 'mapping': {'date': 'date', 'amount': 'amount', 'externalId': 'reference'}}
        before = f.money_state(); preview = f.call(A, '/cashier/api/statement-imports/preview', 'POST', body)
        self.assertEqual(f.money_state(), before); self.assertEqual(len(preview['rows']), 1)
        imported = f.call(A, '/cashier/api/statement-imports', 'POST', dict(body, previewHash=preview['previewHash']))
        self.assertEqual(f.money_state(), before); self.assertEqual(imported['import']['rowCount'], 1); self.assertEqual(f.balance(account), 10000)

    def test_L15_integer_cent_validation_rejects_float_bool_exponent_negative_and_over_limit(self):
        f = self.fixture(); account = f.account(); f.opening(account); _, release, _ = f.source(10000)
        for amount in (1.01, True, '1.01', '1e2', '-1', '9000000000001'):
            before = f.money_state(); f.rejected(A, '/cashier/api/documents', 'POST', {'requestId': str(uuid.uuid4()), 'kind': 'receive', 'accountId': account, 'businessDate': DAY, 'amountCents': amount, 'partyId': CUSTOMER, 'allocations': [{'releaseId': release['id'], 'amountCents': amount}], 'note': '虚构无效精度'}, (400,)); self.assertEqual(f.money_state(), before)

    def test_L16_existing_confirmed_erp_settlement_is_not_backfilled_as_cash(self):
        f = self.fixture(); bill, _, _ = f.source(10000, publish=False)
        old = f.rows('SELECT * FROM erp_documents WHERE id=?', (bill,))[0]; settlement_id = str(uuid.uuid4())
        copied = dict(old, id=settlement_id, number='FICT-OLD-' + settlement_id, kind='settlement', amount_cents=3000, request_id=str(uuid.uuid4()), payload=json.dumps({'kind': 'settlement', 'direction': 'receive', 'partyId': CUSTOMER, 'amountCents': 3000, 'account': '旧自由文本账户', 'allocations': [{'billId': bill, 'amountCents': 3000}]}))
        f.execute('INSERT INTO erp_documents(' + ','.join(copied) + ') VALUES(' + ','.join('?' for _ in copied) + ')', tuple(copied.values()))
        f.execute('INSERT INTO erp_postings(doc_id,bill_id,date,face_cents,settled_cents) VALUES(?,?,?,0,3000)', (settlement_id, bill, DAY))
        c = f.connection()
        try:
            MODULES['cashier_schema.py'].initialize(c)
        finally:
            c.close()
        f.call(A, '/cashier/api/bootstrap')
        self.assertEqual(f.rows('SELECT * FROM cashier_postings'), []); self.assertEqual(f.outstanding(bill), 7000)

    def test_L17_erp_reversal_guard_refuses_single_sided_reversal_of_a_cash_link(self):
        f = self.fixture(); account = f.account(); f.opening(account); bill, release, _ = f.source(10000)
        original = f.receipt(account, release, 3000)
        links = f.rows('SELECT * FROM cashier_erp_links WHERE cash_doc_id=?', (original['id'],)); self.assertEqual(len(links), 1)
        gate = getattr(MODULES['cashier_engine.py'], 'assert_erp_reversal_allowed', None)
        self.assertTrue(callable(gate), 'FEATURE_REQUIRED: guard that the existing ERP review path must call before reversal')
        before = f.money_state(); c = f.connection()
        try:
            with self.assertRaises(Exception) as caught:
                gate(c, links[0]['erp_doc_id'])
            self.assertEqual(getattr(caught.exception, 'status', None), 409)
        finally:
            c.close()
        self.assertEqual(f.money_state(), before); self.assertEqual((f.balance(account), f.outstanding(bill)), (3000, 7000))


def main():
    global OLD_DDL, RUN_ROOT
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--source-sha256', required=True)
    parser.add_argument('--pins', required=True, help='Root-reviewed JSON under this Guest audit-tools directory')
    args = parser.parse_args()
    if not re.fullmatch('[0-9a-f]{64}', args.source_sha256) or hashlib.sha256(ordinary_read(SELF)).hexdigest() != args.source_sha256:
        raise RuntimeError('Root-pinned test source changed')
    if hashlib.sha256(ordinary_read(PYTHON, 2 * 1024 * 1024)).hexdigest() != PYTHON_SHA:
        raise RuntimeError('Fixed public Python changed')
    if hashlib.sha256(ordinary_read(GUARD)).hexdigest() != GUARD_SHA or hashlib.sha256(ordinary_read(VALIDATOR)).hexdigest() != VALIDATOR_SHA:
        raise RuntimeError('Original Sandbox admission source changed')
    if sys.version_info[:3] != (3, 14, 8) or importlib.util.MAGIC_NUMBER.hex() != '2b0e0d0a':
        raise RuntimeError('Fixed public Guest Python 3.14.8 required')
    guard = types.ModuleType('cashier_ledger_actual_context'); guard.__file__ = str(GUARD)
    exec(compile(ordinary_read(GUARD), str(GUARD), 'exec', dont_inherit=True, optimize=0), guard.__dict__)
    admission = guard.read_context(ROOT)
    pin_path = Path(args.pins).resolve()
    if pin_path.parent != ROOT / 'audit-tools' or not pin_path.name.startswith('cashier-170-ledger-') or pin_path.suffix != '.json':
        raise RuntimeError('Explicit cashier test pins under audit-tools required')
    pins = json.loads(ordinary_read(pin_path))
    if set(pins) != {'version', 'erpSchemaSha256', 'subjects'} or pins['version'] != 1 or set(pins['subjects']) != set(SUBJECTS):
        raise RuntimeError('Exact three-module reviewed cashier closure required')
    old_body = ordinary_read(LEDGER / 'erp_schema.py')
    if hashlib.sha256(old_body).hexdigest() != pins['erpSchemaSha256']:
        raise RuntimeError('Reviewed existing ERP schema changed')
    nodes = [node for node in ast.parse(old_body).body if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'STATEMENTS' for target in node.targets)]
    if len(nodes) != 1:
        raise RuntimeError('One original literal ERP DDL list required')
    OLD_DDL = ast.literal_eval(nodes[0].value)
    if not isinstance(OLD_DDL, list) or not all(isinstance(sql, str) for sql in OLD_DDL):
        raise RuntimeError('Literal ERP DDL only, no old app imports')
    absent = []
    for name in SUBJECTS:
        expected = pins['subjects'][name]; filename = LEDGER / name
        if expected is None:
            if filename.exists():
                raise RuntimeError('Initial RED requires absent product; use a new reviewed pin file for implementation')
            absent.append(name); continue
        if not isinstance(expected, str) or not re.fullmatch('[0-9a-f]{64}', expected) or hashlib.sha256(ordinary_read(filename)).hexdigest() != expected:
            raise RuntimeError('Cashier subject source differs from Root pins')
    if absent and len(absent) != len(SUBJECTS):
        raise RuntimeError('Partial product closure is not an executable cashier test subject')
    runtime_parent = ROOT / 'runtime'
    for item in (runtime_parent, *runtime_parent.parents):
        info = item.lstat()
        if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
            raise RuntimeError('Owned ordinary runtime ancestry required before creating fictional test files')
    RUN_ROOT = runtime_parent / ('cashier-170-contract-' + str(uuid.uuid4()))
    RUN_ROOT.mkdir(exist_ok=False)
    # All artifacts are new fictional test files and are retained for evidence.
    # No recursive cleanup, formal database, app import, sidecar, bank or EXE.
    if not absent:
        for name in SUBJECTS:
            module_name = name[:-3]; module = types.ModuleType(module_name); module.__file__ = str(LEDGER / name)
            sys.modules[module_name] = module; MODULES[name] = module
            exec(compile(ordinary_read(LEDGER / name), str(LEDGER / name), 'exec', dont_inherit=True, optimize=0), module.__dict__)
    print(json.dumps({'purpose': 'cashier-fictional-sqlite-domain-contract', 'admission': admission,
                      'testSourceSha256': args.source_sha256, 'pins': pins, 'absentFeatures': absent,
                      'runtime': str(RUN_ROOT), 'formalDataUsed': False, 'oldApplicationImported': False,
                      'liveHttpVerified': False, 'tests': 17}, ensure_ascii=False), flush=True)
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(CashierLedgerContracts))
    print(json.dumps({'testsRun': result.testsRun, 'failures': len(result.failures), 'errors': len(result.errors),
                      'passed': result.wasSuccessful(), 'liveHttpVerified': False, 'productionRestoreVerified': False}), flush=True)
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    raise SystemExit(main())
