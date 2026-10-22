"""Real HTTP-adapter/SQLite workflows, with hand-calculated reference amounts."""
import concurrent.futures
import base64
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import unittest
import uuid

from host import create_app, seed_demo_users

BASE = Path(__file__).absolute().parent.parent
PASSWORD = 'Fictional-only-2026!'
DAY = '2026-10-23'
ORIGIN = 'http://localhost'


class Workflows(unittest.TestCase):
    def setUp(self):
        self.root = BASE / 'runtime' / ('test-' + str(uuid.uuid4()))
        self.app = create_app(self.root)
        self.ids = seed_demo_users(self.app, {name: {'role': role, 'password': PASSWORD} for name, role in (
            ('finance', 'finance_maker'), ('auditor', 'finance_reviewer'),
            ('cashier', 'cashier_maker'), ('cash-reviewer', 'cashier_reviewer'), ('admin', 'admin'))})
        self.clients = {}
        self.tokens = {}
        for name in self.ids:
            client = self.app.test_client()
            response = client.post('/auth/login', json={'username': name, 'password': PASSWORD}, headers={'Origin': ORIGIN})
            self.assertEqual(response.status_code, 200, response.get_json())
            self.clients[name] = client
            self.tokens[name] = response.get_json()['csrfToken']

    def call(self, who, method, path, body=None, status=200):
        response = self.clients[who].open(path, method=method, json=body,
            headers={'Origin': ORIGIN, 'X-CSRF-Token': self.tokens[who]})
        self.assertEqual(response.status_code, status, response.get_data(as_text=True)[:1200])
        return response.get_json()

    def party(self, kind='supplier'):
        return self.call('finance', 'POST', '/erp/api/parties', {'requestId': str(uuid.uuid4()), 'kind': kind,
            'name': '虚构单位-' + str(uuid.uuid4())[:8]})['party']

    def erp_new(self, kind, party, **values):
        return self.call('finance', 'POST', '/erp/api/documents', {'requestId': str(uuid.uuid4()),
            'kind': kind, 'partyId': party['id'], 'date': DAY, **values})['document']

    def erp_confirm(self, document, author='finance', reviewer='auditor'):
        document = self.call(author, 'POST', f"/erp/api/documents/{document['id']}/submit", {'revision': document['revision']})['document']
        return self.call(reviewer, 'POST', f"/erp/api/documents/{document['id']}/review", {
            'revision': document['revision'], 'hash': document['hash'], 'decision': 'approve', 'note': '虚构复核依据'})['document']

    def payable(self, amount='100.01'):
        supplier = self.party()
        purchase = self.erp_confirm(self.erp_new('purchase', supplier, businessType='own', lines=[{
            'description': '虚构Pt950素链', 'material': '铂金', 'purity': 'Pt950', 'quantity': 1,
            'estimatedWeight': '1.2345', 'amount': amount}]))
        receipt = self.erp_confirm(self.erp_new('receipt', supplier, sourceId=purchase['id'], lines=[{
            'purchaseLineId': purchase['lines'][0]['id'], 'quantity': 1, 'actualWeight': '1.2345', 'amount': amount}]))
        return supplier, receipt

    def account(self, kind='cash'):
        account = self.call('admin', 'POST', '/cashier/api/accounts', {'requestId': str(uuid.uuid4()),
            'code': 'TEST-' + str(uuid.uuid4())[:8], 'name': '虚构资金账户', 'kind': kind, 'currency': 'CNY'})['account']
        for who in ('cashier', 'cash-reviewer'):
            self.call('admin', 'POST', f"/cashier/api/accounts/{account['id']}/scopes", {
                'requestId': str(uuid.uuid4()), 'staffId': self.ids[who],
                'level': 'manage' if who == 'cash-reviewer' else 'operate', 'revision': 0, 'note': '虚构账户授权'})
        return account

    def cash_new(self, who, account, kind, amount, **values):
        return self.call(who, 'POST', '/cashier/api/documents', {'requestId': str(uuid.uuid4()),
            'accountId': account['id'], 'kind': kind, 'businessDate': DAY, 'amountCents': str(amount),
            'note': '虚构凭证测试', **values})['document']

    def cash_submit(self, who, document):
        return self.call(who, 'POST', f"/cashier/api/documents/{document['id']}/submit", {
            'requestId': str(uuid.uuid4()), 'revision': document['revision']})['document']

    def cash_review(self, who, document, status=200):
        return self.call(who, 'POST', f"/cashier/api/documents/{document['id']}/review", {
            'requestId': str(uuid.uuid4()), 'revision': document['revision'], 'hash': document['frozenHash'],
            'decision': 'approve', 'note': '虚构异人审核'}, status=status)

    def funded_account(self, kind='cash'):
        account = self.account(kind)
        opening = self.cash_new('cash-reviewer', account, 'opening', 100000, evidence='虚构现金盘点1000.00元')
        self.cash_review('admin', self.cash_submit('cash-reviewer', opening))
        return account

    def publish(self, document):
        return self.call('auditor', 'POST', '/erp/api/cashier-source-releases', {'requestId': str(uuid.uuid4()),
            'billId': document['id'], 'revision': document['revision'], 'hash': document['hash'], 'note': '虚构收付依据'})['release']

    def bill(self, identifier):
        rows = self.call('auditor', 'GET', '/erp/api/bootstrap')['bills']
        return next(row for row in rows if row['id'] == identifier)

    def test_purchase_only_receipt_review_creates_payable(self):
        supplier = self.party()
        purchase = self.erp_confirm(self.erp_new('purchase', supplier, businessType='own', lines=[{
            'description': '虚构手链', 'quantity': 3, 'estimatedWeight': '3.2000', 'amount': '300.03'}]))
        self.assertEqual(self.call('auditor', 'GET', '/erp/api/bootstrap')['bills'], [])
        receipt = self.erp_new('receipt', supplier, sourceId=purchase['id'], lines=[{
            'purchaseLineId': purchase['lines'][0]['id'], 'quantity': 2, 'actualWeight': '2.1000', 'amount': '200.02'}])
        self.assertEqual(self.call('auditor', 'GET', '/erp/api/bootstrap')['bills'], [])
        confirmed = self.erp_confirm(receipt)
        self.assertEqual(self.bill(confirmed['id'])['balanceCents'], 20002)
        self.assertEqual(self.bill(confirmed['id'])['kind'], 'payable')

    def test_pay_and_erp_settlement_commit_atomically(self):
        supplier, receipt = self.payable()
        release = self.publish(receipt)
        account = self.funded_account()
        pending = self.cash_submit('cashier', self.cash_new('cashier', account, 'pay', 5001,
            partyId=supplier['id'], allocations=[{'releaseId': release['id'], 'amountCents': '5001'}]))
        self.cash_review('cash-reviewer', pending)
        self.assertEqual(self.bill(receipt['id'])['balanceCents'], 5000)
        with closing(sqlite3.connect(self.root / 'data/demo.sqlite3')) as connection:
            self.assertEqual(connection.execute('SELECT sum(signed_amount_cents) FROM cashier_postings WHERE account_id=?', (account['id'],)).fetchone()[0], 94999)
            self.assertEqual(connection.execute("SELECT count(*) FROM erp_documents WHERE kind='settlement' AND status='confirmed'").fetchone()[0], 1)

    def test_admin_cannot_review_own_cash_document(self):
        account = self.account()
        pending = self.cash_submit('admin', self.cash_new('admin', account, 'opening', 1000, evidence='虚构盘点'))
        self.cash_review('admin', pending, status=403)

    def test_expired_revision_and_duplicate_request_fail_closed(self):
        supplier = self.party()
        request = {'requestId': str(uuid.uuid4()), 'kind': 'opening_payable', 'partyId': supplier['id'],
            'date': DAY, 'amount': '12.34', 'evidence': '虚构期初依据'}
        document = self.call('finance', 'POST', '/erp/api/documents', request)['document']
        repeated = self.call('finance', 'POST', '/erp/api/documents', request)['document']
        self.assertEqual(document['id'], repeated['id'])
        self.call('finance', 'POST', '/erp/api/documents', {**request, 'amount': '12.35'}, status=409)
        pending = self.call('finance', 'POST', f"/erp/api/documents/{document['id']}/submit", {'revision': document['revision']})['document']
        self.call('finance', 'POST', f"/erp/api/documents/{document['id']}/submit", {'revision': document['revision']}, status=409)
        self.assertEqual(pending['revision'], 2)

    def test_cashier_cannot_publish_finance_source_or_read_erp(self):
        self.call('cashier', 'GET', '/erp/api/bootstrap', status=403)
        self.call('cashier', 'POST', '/erp/api/cashier-source-releases', {'requestId': str(uuid.uuid4())}, status=403)
        self.call('finance', 'GET', '/cashier/api/accounts', status=403)
        self.call('auditor', 'GET', '/auth/users', status=403)
        self.call('cash-reviewer', 'GET', '/auth/users', status=403)
        self.assertEqual(len(self.call('admin', 'GET', '/auth/users')['users']), 5)

    def test_cashier_without_account_scope_cannot_read_account(self):
        account = self.call('admin', 'POST', '/cashier/api/accounts', {'requestId': str(uuid.uuid4()),
            'code': 'PRIVATE', 'name': '未授权虚构账户', 'kind': 'bank', 'currency': 'CNY'})['account']
        data = self.call('cashier', 'GET', '/cashier/api/accounts')
        self.assertEqual(data['accounts'], [])
        self.call('cashier', 'GET', '/cashier/api/postings?accountId=' + account['id'], status=403)
        self.call('cashier', 'GET', '/cashier/api/sources?accountId=' + account['id'], status=403)
        self.call('cashier', 'GET', '/cashier/api/sources', status=400)
        self.call('cashier', 'GET', '/integration/api/releases', status=403)

    def test_finance_handoff_publishes_and_revokes_an_approved_source(self):
        _, source = self.payable()
        release = self.publish(source)
        rows = self.call('auditor', 'GET', '/integration/api/releases')['releases']
        self.assertEqual(rows[0]['id'], release['id'])
        self.assertEqual(rows[0]['status'], 'published')
        self.call('auditor', 'POST', '/erp/api/cashier-source-releases/' + release['id'] + '/revoke',
            {'requestId': str(uuid.uuid4()), 'revision': release['revision'], 'note': '虚构撤回测试'})
        self.assertEqual(self.call('auditor', 'GET', '/integration/api/releases')['releases'][0]['status'], 'revoked')
        self.assertEqual(self.clients['auditor'].get('/finance-handoff').status_code, 200)

    def test_browser_security_and_actor_injection(self):
        self.assertEqual(self.app.test_client().get('/erp/api/bootstrap').status_code, 401)
        client = self.clients['finance']
        self.assertEqual(client.post('/erp/api/parties', json={}, headers={'Origin': ORIGIN}).status_code, 403)
        self.assertEqual(client.post('/erp/api/parties', json={}, headers={'Origin': 'https://outside.invalid', 'X-CSRF-Token': self.tokens['finance']}).status_code, 403)
        self.call('finance', 'POST', '/erp/api/parties', {'requestId': str(uuid.uuid4()), 'kind': 'supplier',
            'name': '虚构测试', 'actor': {'role': 'admin'}}, status=400)

    def test_two_concurrent_reviews_do_not_overpay(self):
        supplier, receipt = self.payable('100.00')
        release, account = self.publish(receipt), self.funded_account()
        pending = [self.cash_submit('cashier', self.cash_new('cashier', account, 'pay', 7000,
            partyId=supplier['id'], allocations=[{'releaseId': release['id'], 'amountCents': '7000'}])) for _ in range(2)]
        def approve(document):
            client = self.app.test_client()
            login = client.post('/auth/login', json={'username': 'cash-reviewer', 'password': PASSWORD}, headers={'Origin': ORIGIN}).get_json()
            return client.post(f"/cashier/api/documents/{document['id']}/review", json={'requestId': str(uuid.uuid4()),
                'revision': document['revision'], 'hash': document['frozenHash'], 'decision': 'approve', 'note': '并发虚构审核'},
                headers={'Origin': ORIGIN, 'X-CSRF-Token': login['csrfToken']}).status_code
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            statuses = list(executor.map(approve, pending))
        self.assertEqual(sorted(statuses), [200, 409])
        self.assertEqual(self.bill(receipt['id'])['balanceCents'], 3000)

    def test_ui_pages_and_scoped_csrf_bridge_are_present(self):
        for path in ('/', '/erp/', '/cashier/'):
            response = self.clients['admin'].get(path)
            self.assertEqual(response.status_code, 200)
            self.assertIn(b'/standalone/bridge.js', response.data)
        asset = self.clients['admin'].get('/standalone/bridge.js')
        self.assertEqual(asset.status_code, 200)
        asset.close()
        self.assertEqual(self.clients['admin'].get('/standalone/../../vendor-manifest.json').status_code, 404)

    def test_existing_sales_source_is_explicitly_not_connected(self):
        customer = self.party('customer')
        self.call('finance', 'POST', '/erp/api/documents', {'requestId': str(uuid.uuid4()),
            'kind': 'receivable', 'partyId': customer['id'], 'date': DAY,
            'amount': '30.00', 'sourceSaleId': 1}, status=400)

    def test_erp_party_identity_has_strict_namespaced_format(self):
        from cashier_engine import party_id, CashierError
        self.assertEqual(party_id('SUP:1'), 'SUP:1')
        self.assertEqual(party_id('CUS:09f22f72-4d45-4b39-8bc7-4db7c41d80af'),
                         'CUS:09f22f72-4d45-4b39-8bc7-4db7c41d80af')
        for bad in ('SUP:01', 'SUP:0', 'SUP:-1', 'SUP:9223372036854775808',
                    'CUS:bad', 'sup:1', '../SUP:1', '', 1, True):
            with self.subTest(value=bad), self.assertRaises(CashierError):
                party_id(bad)

    def test_receipt_and_refund_use_customer_source_and_enforce_refund_limit(self):
        customer = self.party('customer')
        source = self.erp_confirm(self.erp_new('receivable', customer, amount='123.45'))
        release, account = self.publish(source), self.funded_account()
        receive = self.cash_review('cash-reviewer', self.cash_submit('cashier', self.cash_new(
            'cashier', account, 'receive', 12345, partyId=customer['id'],
            allocations=[{'releaseId': release['id'], 'amountCents': '12345'}])))['document']
        self.assertEqual(self.bill(source['id'])['balanceCents'], 0)
        refund = self.cash_new('cashier', account, 'refund', 2345, partyId=customer['id'],
            originalCashDocId=receive['id'], refundBasis='虚构已批准部分退款依据')
        self.cash_review('cash-reviewer', self.cash_submit('cashier', refund))
        with closing(sqlite3.connect(self.root / 'data/demo.sqlite3')) as connection:
            self.assertEqual(connection.execute('SELECT sum(signed_amount_cents) FROM cashier_postings WHERE account_id=?', (account['id'],)).fetchone()[0], 110000)
        # Refund is a cash fact; reopening the original business obligation is
        # a separate controlled business/reversal operation, never guessed here.
        self.assertEqual(self.bill(source['id'])['balanceCents'], 0)
        too_much = self.cash_new('cashier', account, 'refund', 10001, partyId=customer['id'],
            originalCashDocId=receive['id'], refundBasis='虚构超额退款负例')
        pending = self.cash_submit('cashier', too_much)
        self.cash_review('cash-reviewer', pending, status=409)

    def test_transfer_is_balanced_and_audited(self):
        first, second = self.funded_account(), self.funded_account('bank')
        transfer = self.cash_new('cashier', first, 'transfer', 2000, toAccountId=second['id'])
        self.cash_review('cash-reviewer', self.cash_submit('cashier', transfer))
        with closing(sqlite3.connect(self.root / 'data/demo.sqlite3')) as connection:
            self.assertEqual(connection.execute('SELECT sum(signed_amount_cents) FROM cashier_postings WHERE account_id=?', (first['id'],)).fetchone()[0], 98000)
            self.assertEqual(connection.execute('SELECT sum(signed_amount_cents) FROM cashier_postings WHERE account_id=?', (second['id'],)).fetchone()[0], 102000)

    def test_valid_but_wrong_counterparty_cannot_create_a_payment(self):
        _, source = self.payable()
        release, account = self.publish(source), self.funded_account()
        self.call('cashier', 'POST', '/cashier/api/documents', {'requestId': str(uuid.uuid4()),
            'accountId': account['id'], 'kind': 'pay', 'businessDate': DAY, 'amountCents': '1000',
            'note': '虚构错误往来单位负例', 'partyId': 'SUP:777',
            'allocations': [{'releaseId': release['id'], 'amountCents': '1000'}]}, status=409)
        self.assertEqual(self.bill(source['id'])['balanceCents'], 10001)

    def test_cash_reversal_restores_funds_and_erp_obligation_together(self):
        supplier, source = self.payable('100.00')
        release, account = self.publish(source), self.funded_account()
        paid = self.cash_review('cash-reviewer', self.cash_submit('cashier', self.cash_new('cashier', account,
            'pay', 7000, partyId=supplier['id'], allocations=[{'releaseId': release['id'], 'amountCents': '7000'}])))['document']
        self.assertEqual(self.bill(source['id'])['balanceCents'], 3000)
        reversal = self.cash_new('cashier', account, 'reversal', 7000, targetId=paid['id'])
        self.cash_review('cash-reviewer', self.cash_submit('cashier', reversal))
        self.assertEqual(self.bill(source['id'])['balanceCents'], 10000)
        with closing(sqlite3.connect(self.root / 'data/demo.sqlite3')) as connection:
            self.assertEqual(connection.execute('SELECT sum(signed_amount_cents) FROM cashier_postings WHERE account_id=?', (account['id'],)).fetchone()[0], 100000)

    def test_bank_original_import_matching_and_other_person_review(self):
        account = self.funded_account('bank')
        original = b'date,amount,reference\n2026-10-23,1000.00,FICTIONAL-001\n'
        body = {'requestId': str(uuid.uuid4()), 'accountId': account['id'], 'name': 'fictional-bank.csv',
                'csvBase64': base64.b64encode(original).decode(), 'encoding': 'utf-8',
                'mapping': {'date': 'date', 'amount': 'amount', 'externalId': 'reference'}}
        preview = self.call('cashier', 'POST', '/cashier/api/statement-imports/preview', body)
        imported = self.call('cashier', 'POST', '/cashier/api/statement-imports',
            {**body, 'requestId': str(uuid.uuid4()), 'previewHash': preview['previewHash']})['import']
        self.call('cashier', 'POST', '/cashier/api/statement-imports',
            {**body, 'requestId': str(uuid.uuid4()), 'previewHash': preview['previewHash']}, status=409)
        row = self.call('cashier', 'GET', '/cashier/api/statement-imports/' + imported['id'])['rows'][0]
        posting = self.call('cashier', 'GET', '/cashier/api/postings?accountId=' + account['id'])['postings'][0]
        matched = self.call('cashier', 'POST', '/cashier/api/reconciliations', {'requestId': str(uuid.uuid4()),
            'accountId': account['id'], 'matches': [{'statementRowId': row['id'], 'postingId': posting['id']}], 'note': '虚构逐行核对'})['reconciliation']
        review = {'requestId': str(uuid.uuid4()), 'revision': matched['revision'], 'hash': matched['frozenHash'],
                  'decision': 'approve', 'note': '虚构异人核对确认'}
        self.call('cashier', 'POST', f"/cashier/api/reconciliations/{matched['id']}/review", review, status=403)
        self.call('cash-reviewer', 'POST', f"/cashier/api/reconciliations/{matched['id']}/review", {**review, 'requestId': str(uuid.uuid4())})
        with closing(sqlite3.connect(self.root / 'data/demo.sqlite3')) as connection:
            self.assertEqual(connection.execute('SELECT count(*) FROM cashier_reconciliation_locks').fetchone()[0], 1)
            self.assertEqual(connection.execute('SELECT sum(signed_amount_cents) FROM cashier_postings WHERE account_id=?', (account['id'],)).fetchone()[0], 100000)


if __name__ == '__main__':
    unittest.main(verbosity=2)
