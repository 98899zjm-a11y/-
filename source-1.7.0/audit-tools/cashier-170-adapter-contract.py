"""Four supplemental Guest-only Flask adapter contracts, no application boot.

Root pins this source, the adapter/template/assets and their domain dependencies,
then calls build_suite(base, adapter, flask) after the original Guest admission.
Real Flask test requests and the actual cashier engine/restore hook are used.
Only the already-authenticated sidecar actor injection is a declared boundary;
these tests do not claim MAC, legacy hooks, native UI or complete App coverage.
The original 37 assertions and monetary implementation remain unchanged.
"""
import json
import unittest
import uuid
from unittest import mock


def build_suite(base,adapter,flask):
    if base.RUN_ROOT is None or not base.MODULES:raise RuntimeError('Original admitted Guest cashier fixture required')

    class CashierAdapterContracts(unittest.TestCase):
        def fixture(self):return base.Fixture(self)

        def client(self,f):
            app=flask.Flask('cashier-adapter-'+uuid.uuid4().hex,
                            template_folder=str(base.LEDGER/'app/templates'),static_folder=str(base.LEDGER/'app/static'))
            app.testing=True
            actor={'value':base.A};traces=[]
            @app.before_request
            def signed_actor_boundary():
                # Explicit test port: no pretend sidecar HMAC or legacy login.
                if actor['value'] is not None:flask.g._xjy_cashier_actor=actor['value']
            def connect():
                c=f.connection();statements=[];traces.append(statements);c.set_trace_callback(statements.append);return c
            adapter.register(app,connect=connect,reserve_number=f.reserve,clock=lambda:base.STAMP)
            return app.test_client(),actor,traces,app

        def test_A01_only_two_protected_get_assets_and_template_uses_them(self):
            f=self.fixture();client,actor,traces,app=self.client(f)
            page=client.get('/cashier').get_data(as_text=True)
            self.assertIn('href="/cashier/static/cashier.css"',page)
            self.assertIn('src="/cashier/static/cashier.js"',page)
            self.assertNotIn('href="/static/cashier.css"',page);self.assertNotIn('src="/static/cashier.js"',page)
            rules={str(rule) for rule in app.url_map.iter_rules() if str(rule).startswith('/cashier/static/')}
            self.assertEqual(rules,{'/cashier/static/cashier.css','/cashier/static/cashier.js'})
            for name in ('cashier.css','cashier.js'):
                result=client.get('/cashier/static/'+name)
                self.assertEqual(result.status_code,200)
                self.assertEqual(result.get_data(),(base.LEDGER/'app/static'/name).read_bytes())
                self.assertEqual(client.head('/cashier/static/'+name).status_code,405)
                self.assertEqual(client.options('/cashier/static/'+name).status_code,405)
                self.assertEqual(client.get('/cashier/static/'+name+'?filename=erp.js').status_code,400)
            for path in ('/cashier/static/erp.js','/cashier/static/../erp.js','/cashier/static/%2e%2e/erp.js'):
                self.assertEqual(client.get(path).status_code,404)
            actor['value']=None
            self.assertEqual(client.get('/cashier/static/cashier.css').status_code,403)
            self.assertEqual(client.get('/cashier/static/cashier.js').status_code,403)
            self.assertEqual(traces,[])

        def test_A02_real_restored_receipt_stops_before_domain_dispatch_and_writes_nothing(self):
            f=self.fixture();account=f.account();request_id=str(uuid.uuid4());lost_id=str(uuid.uuid4())
            body={'requestId':request_id,'kind':'receive','accountId':account,'businessDate':base.DAY,'amountCents':'100',
                  'partyId':base.CUSTOMER,'allocations':[{'releaseId':str(uuid.uuid4()),'amountCents':'100'}],'note':'虚构恢复终态原请求'}
            marker={'restoredUnfinished':{'version':1,'originalDocumentId':lost_id,'originalNumber':'CNSK-20261019-000001',
                    'capability':'cashier.documents.prepare','accountIds':[account],'reason':'unfinished_document_not_restored'}}
            f.execute('INSERT INTO cashier_requests VALUES(?,?,?,?,?,?)',(base.A['staffId'],request_id,
                      base.digest({'method':'POST','path':'/cashier/api/documents','body':body}),json.dumps(marker),'POST','/cashier/api/documents'))
            before=f.money_state();client,_,traces,_=self.client(f)
            result=client.post('/cashier/api/documents',json=body)
            self.assertEqual(result.status_code,409);self.assertFalse(result.json['ok'])
            self.assertEqual(result.json['code'],'CASHIER_RESTORED_UNFINISHED')
            self.assertEqual(len(traces),1,'A terminal receipt must stop before the engine opens its transaction')
            self.assertIn('PRAGMA query_only=ON',traces[0]);self.assertIn('BEGIN',traces[0])
            self.assertFalse(any(sql.lstrip().upper().startswith(('INSERT','UPDATE','DELETE','REPLACE')) for sql in traces[0]))
            self.assertEqual(f.money_state(),before)
            self.assertEqual(f.rows('SELECT * FROM cashier_documents WHERE id=?',(lost_id,)),[])
            changed=client.post('/cashier/api/documents',json=dict(body,amountCents='101'))
            self.assertEqual(changed.status_code,409);self.assertEqual(f.money_state(),before)

        def test_A03_get_keeps_one_readonly_engine_connection_and_never_calls_restore_guard(self):
            f=self.fixture();account=f.account();f.opening(account,10000);before=f.money_state()
            client,_,traces,_=self.client(f)
            # Invocation sentinel only; no fake accounting or database result.
            with mock.patch.object(adapter,'reject_restored_request',side_effect=AssertionError('GET must not enter the restore replay guard')):
                result=client.get('/cashier/api/bootstrap')
            self.assertEqual(result.status_code,200);self.assertTrue(result.json['ok']);self.assertEqual(len(traces),1)
            self.assertIn('PRAGMA query_only=ON',traces[0])
            self.assertFalse(any(sql.lstrip().upper().startswith(('INSERT','UPDATE','DELETE','REPLACE')) for sql in traces[0]))
            self.assertEqual(f.money_state(),before)

        def test_A04_normal_cash_draft_passes_real_readonly_guard_then_actual_engine(self):
            f=self.fixture();left=f.account();right=f.account('虚构银行乙','bank');f.opening(left,10000);f.opening(right)
            before=f.money_state();client,_,traces,_=self.client(f)
            result=client.post('/cashier/api/documents',json={'requestId':str(uuid.uuid4()),'kind':'transfer','accountId':left,
                              'toAccountId':right,'businessDate':base.DAY,'amountCents':'1000','note':'虚构正常草稿'})
            self.assertEqual(result.status_code,200);self.assertEqual(result.json['document']['status'],'draft')
            self.assertEqual(len(traces),2);self.assertIn('PRAGMA query_only=ON',traces[0]);self.assertIn('BEGIN IMMEDIATE',traces[1])
            self.assertFalse(any(sql.lstrip().upper().startswith(('INSERT','UPDATE','DELETE','REPLACE')) for sql in traces[0]))
            self.assertEqual(f.money_state(),before)
            self.assertEqual(len(f.rows('SELECT * FROM cashier_documents WHERE id=?',(result.json['document']['id'],))),1)

    return unittest.defaultTestLoader.loadTestsFromTestCase(CashierAdapterContracts)
