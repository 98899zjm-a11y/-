"""Additional fictional SQLite contracts for the admitted original fixture.

Root loads this explicitly pinned source only after the unchanged original
cashier-170-ledger-contract.py admission and fixture initialization. Call
build_suite(base_module). Do not run this on Host. The existing 17 assertions
remain untouched. ERP-using tests require the real admitted ERP bridge.
"""
import base64
import hashlib
import json
import unittest
import uuid


def build_suite(base):
    if base.RUN_ROOT is None or not base.MODULES:
        raise RuntimeError('Original admitted Guest cashier fixture must be initialized first')

    class CashierExtraContracts(unittest.TestCase):
        def fixture(self):
            return base.Fixture(self)

        def import_statement(self,f,account,content):
            body={'requestId':str(uuid.uuid4()),'accountId':account,'csvBase64':base64.b64encode(content).decode('ascii'),
                  'encoding':'utf-8','mapping':{'date':'date','amount':'amount','externalId':'reference'}}
            preview=f.call(base.A,'/cashier/api/statement-imports/preview','POST',body)
            return f.call(base.A,'/cashier/api/statement-imports','POST',dict(body,previewHash=preview['previewHash']))['import']

        def test_X01_scope_management_is_admin_only_cas_and_immediately_restricts_reads(self):
            f=self.fixture();account=f.account();f.opening(account,10000)
            body={'requestId':str(uuid.uuid4()),'staffId':base.A['staffId'],'level':'disabled','revision':1,'note':'虚构撤权'}
            f.rejected(base.B,'/cashier/api/accounts/'+account+'/scopes','POST',body,(403,))
            f.call(base.ADMIN,'/cashier/api/accounts/'+account+'/scopes','POST',body)
            f.rejected(base.A,'/cashier/api/reports/balances?accountId='+account,'GET',{},(403,))
            f.rejected(base.ADMIN,'/cashier/api/accounts/'+account+'/scopes','POST',dict(body,requestId=str(uuid.uuid4())),(409,))
            self.assertEqual(f.balance(account),10000)

        def test_X02_backdated_transfer_cannot_make_an_intervening_balance_negative(self):
            f=self.fixture();left=f.account();right=f.account('虚构银行乙','bank');f.opening(left,10000);f.opening(right)
            f.post('transfer',left,9000,toAccountId=right,businessDate='2026-10-10')
            f.post('transfer',right,9000,toAccountId=left,businessDate='2026-10-20')
            before=f.money_state()
            f.refuse_post('transfer',left,2000,toAccountId=right,businessDate='2026-10-15')
            self.assertEqual(f.money_state(),before)

        def test_X03_refund_history_cannot_exceed_original_before_a_later_refund_reversal(self):
            f=self.fixture();account=f.account();f.opening(account);_,release,_=f.source(10000)
            original=f.receipt(account,release,10000)
            refund=f.post('refund_out',account,8000,partyId=base.CUSTOMER,originalCashDocId=original['id'],refundBasis='虚构依据',businessDate='2026-10-20')
            f.post('reversal',account,8000,targetId=refund['id'],businessDate='2026-10-25')
            before=f.money_state()
            f.refuse_post('refund_out',account,5000,partyId=base.CUSTOMER,originalCashDocId=original['id'],refundBasis='虚构倒填依据',businessDate='2026-10-22')
            self.assertEqual(f.money_state(),before)

        def test_X04_original_bytes_survive_and_duplicate_hash_or_external_id_is_not_reimported(self):
            f=self.fixture();account=f.account('虚构银行','bank');f.opening(account)
            content=b'date,amount,reference\n2026-10-19,12.34,FICT-X1\n'
            imported=self.import_statement(f,account,content)
            original=f.call(base.A,'/cashier/api/statement-imports/'+imported['id']+'/original')['original']
            self.assertEqual(base64.b64decode(original['base64']),content)
            self.assertEqual(original['sha256'],hashlib.sha256(content).hexdigest())
            before=f.money_state()
            for attempted in (content,b'date,amount,reference\n2026-10-19,99.99,FICT-X1\n'):
                with self.assertRaises(Exception) as caught:self.import_statement(f,account,attempted)
                self.assertEqual(getattr(caught.exception,'status',None),409)
            self.assertEqual(f.money_state(),before)
            c=f.connection()
            try:self.assertEqual(base.MODULES['cashier_engine.py'].verify_originals(c),{'originalCount':1})
            finally:c.close()

        def test_X05_same_day_same_amount_without_external_ids_keeps_two_actual_rows(self):
            f=self.fixture();account=f.account('虚构银行','bank');f.opening(account)
            imported=self.import_statement(f,account,b'date,amount,reference\n2026-10-19,12.34,\n2026-10-19,12.34,\n')
            rows=f.rows('SELECT * FROM cashier_statement_rows WHERE import_id=?',(imported['id'],))
            self.assertEqual(len(rows),2);self.assertNotEqual(rows[0]['id'],rows[1]['id']);self.assertEqual(f.balance(account),0)

        def test_X06_reconciliation_exact_difference_other_reviewer_lock_and_event_preserving_revoke(self):
            f=self.fixture();account=f.account('虚构银行','bank');f.opening(account)
            _,release,_=f.source(10000);cash=f.receipt(account,release,3000)
            imported=self.import_statement(f,account,b'date,amount,reference\n2026-10-19,30.00,FICT-X6\n2026-10-19,31.00,FICT-X7\n')
            rows=f.rows('SELECT * FROM cashier_statement_rows WHERE import_id=? ORDER BY line_number',(imported['id'],))
            posting=f.rows('SELECT * FROM cashier_postings WHERE doc_id=?',(cash['id'],))[0]
            body={'requestId':str(uuid.uuid4()),'accountId':account,'matches':[{'statementRowId':rows[1]['id'],'postingId':posting['id']}],'note':'虚构差额不为零'}
            before=f.money_state();f.rejected(base.A,'/cashier/api/reconciliations','POST',body,(409,))
            body.update(requestId=str(uuid.uuid4()),matches=[{'statementRowId':rows[0]['id'],'postingId':posting['id']}],note='虚构零差额核对')
            r=f.call(base.A,'/cashier/api/reconciliations','POST',body)['reconciliation']
            review={'requestId':str(uuid.uuid4()),'revision':r['revision'],'hash':r['frozenHash'],'decision':'approve','note':'虚构异人复核'}
            f.rejected(base.A,'/cashier/api/reconciliations/'+r['id']+'/review','POST',review,(403,))
            reviewed=f.call(base.B,'/cashier/api/reconciliations/'+r['id']+'/review','POST',review)['reconciliation']
            self.assertEqual(f.money_state(),before)
            f.refuse_post('reversal',account,3000,targetId=cash['id'])
            matches=f.rows('SELECT * FROM cashier_reconciliation_matches')
            f.call(base.C,'/cashier/api/reconciliations/'+r['id']+'/revoke','POST',{'requestId':str(uuid.uuid4()),'revision':reviewed['revision'],'note':'虚构解除核对'})
            self.assertEqual(f.rows('SELECT * FROM cashier_reconciliation_matches'),matches)
            self.assertEqual(f.rows('SELECT * FROM cashier_reconciliation_locks'),[])
            self.assertEqual(f.money_state(),before)

        def test_X07_failure_in_actual_bridge_rolls_back_cash_erp_links_and_review_event(self):
            f=self.fixture();account=f.account();f.opening(account);_,release,_=f.source(10000)
            pending=f.pending(f.draft('receive',account,3000,partyId=base.CUSTOMER,allocations=[{'releaseId':release['id'],'amountCents':'3000'}]))
            # This is a port-boundary negative test, not an ERP algorithm test.
            seen=[]
            def fail_same_connection(c,row,payload):
                seen.append((c.in_transaction,c.execute('SELECT COUNT(*) FROM cashier_erp_links WHERE cash_doc_id=?',(pending['id'],)).fetchone()[0]))
                raise base.MODULES['cashier_engine.py'].CashierError('虚构桥故障',409)
            engine=base.MODULES['cashier_engine.py'].create_engine(connect=f.connection,reserve_number=f.reserve,clock=lambda:base.STAMP,settlement_bridge=fail_same_connection)
            before=f.money_state();events=f.rows('SELECT * FROM cashier_events');erp=f.rows('SELECT * FROM erp_documents')
            f.rejected(base.B,'/cashier/api/documents/'+pending['id']+'/review','POST',f.review_body(pending),(409,),engine)
            self.assertEqual(seen,[(True,1)]);self.assertEqual(f.money_state(),before);self.assertEqual(f.rows('SELECT * FROM cashier_events'),events);self.assertEqual(f.rows('SELECT * FROM erp_documents'),erp)

        def test_X08_cashier_reversal_validator_refuses_no_transaction_fake_erp_link_and_same_author(self):
            f=self.fixture();account=f.account();f.opening(account);_,release,_=f.source(10000);cash=f.receipt(account,release,3000)
            pending=f.pending(f.draft('reversal',account,3000,targetId=cash['id']))
            gate=base.MODULES['cashier_engine.py'].validate_cashier_erp_reversal
            c=f.connection()
            try:
                for actor in (base.A,base.B):
                    with self.assertRaises(Exception) as caught:
                        gate(c,actor,{'id':str(uuid.uuid4())},{'kind':'reversal','targetId':str(uuid.uuid4()),'cashierDocumentId':pending['id'],'note':'虚构假关联'})
                    self.assertIn(getattr(caught.exception,'status',None),(403,409))
                c.execute('BEGIN IMMEDIATE')
                with self.assertRaises(Exception) as caught:
                    gate(c,base.B,{'id':str(uuid.uuid4())},{'kind':'reversal','targetId':str(uuid.uuid4()),'cashierDocumentId':pending['id'],'note':'虚构假关联'})
                self.assertEqual(getattr(caught.exception,'status',None),409)
                c.rollback()
            finally:c.close()
            self.assertEqual(f.balance(account),3000)

        def test_X09_noop_bridge_cannot_commit_cash_without_the_actual_erp_entries(self):
            f=self.fixture();account=f.account();f.opening(account);_,release,_=f.source(10000)
            pending=f.pending(f.draft('receive',account,3000,partyId=base.CUSTOMER,allocations=[{'releaseId':release['id'],'amountCents':'3000'}]))
            engine=base.MODULES['cashier_engine.py'].create_engine(connect=f.connection,reserve_number=f.reserve,clock=lambda:base.STAMP,settlement_bridge=lambda c,row,payload:None)
            before=f.money_state()
            f.rejected(base.B,'/cashier/api/documents/'+pending['id']+'/review','POST',f.review_body(pending),(409,),engine)
            self.assertEqual(f.money_state(),before)

        def test_X10_original_corruption_after_deliberate_fixture_trigger_removal_is_detected(self):
            f=self.fixture();account=f.account('虚构银行','bank');f.opening(account)
            imported=self.import_statement(f,account,b'date,amount,reference\n2026-10-19,12.34,FICT-X10\n')
            f.execute('DROP TRIGGER cashier_statement_originals_no_update')
            original=f.rows('SELECT content FROM cashier_statement_originals WHERE sha256=?',(imported['originalSha256'],))[0]['content']
            f.execute('UPDATE cashier_statement_originals SET content=? WHERE sha256=?',(b'X'+original[1:],imported['originalSha256']))
            c=f.connection()
            try:
                with self.assertRaises(Exception) as caught:base.MODULES['cashier_engine.py'].verify_originals(c)
                self.assertEqual(getattr(caught.exception,'status',None),409)
            finally:c.close()
            f.rejected(base.A,'/cashier/api/statement-imports/'+imported['id']+'/original','GET',{},(409,))

    return unittest.defaultTestLoader.loadTestsFromTestCase(CashierExtraContracts)
