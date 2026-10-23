"""Guest-only additional restore contracts; no Host execution entry point.

Root pins this source and cashier_restore.py, initializes the original admitted
cashier fixture, then runs build_suite(base, helper). Original 17 tests stay
unchanged. All handles refer to newly created fictional files in that fixture.
"""
import base64
import json
import sqlite3
import unittest
import uuid


def build_suite(base,helper):
    if base.RUN_ROOT is None or not base.MODULES:raise RuntimeError('Original admitted Guest fixture required')

    class CashierRestoreContracts(unittest.TestCase):
        def fixture(self):return base.Fixture(self)

        def clone(self,f,name='fictional-staged.db'):
            filename=f.directory/name
            source=f.connection();staged=sqlite3.connect(filename,isolation_level=None)
            staged.row_factory=sqlite3.Row;staged.execute('PRAGMA foreign_keys=ON')
            try:source.backup(staged)
            finally:source.close()
            return staged,filename

        def legacy(self,f,name):
            c=sqlite3.connect(f.directory/name,isolation_level=None);c.row_factory=sqlite3.Row
            c.execute('CREATE TABLE suppliers(id INTEGER PRIMARY KEY)');c.execute('CREATE TABLE sales(id INTEGER PRIMARY KEY)')
            for sql in base.OLD_DDL:c.execute(sql)
            return c

        def staged_engine(self,f,path):
            def connect():
                c=sqlite3.connect(path,isolation_level=None);c.row_factory=sqlite3.Row;c.execute('PRAGMA foreign_keys=ON');return c
            return base.MODULES['cashier_engine.py'].create_engine(connect=connect,reserve_number=f.reserve,clock=lambda:base.STAMP)

        def test_R01_account_revocation_survives_old_snapshot_without_changing_money(self):
            f=self.fixture();account=f.account();f.opening(account,10000)
            staged,path=self.clone(f);current=f.connection()
            try:
                f.call(base.ADMIN,'/cashier/api/accounts/'+account+'/scopes','POST',{'requestId':str(uuid.uuid4()),'staffId':base.A['staffId'],'level':'disabled','revision':1,'note':'虚构撤销账户范围'})
                before=f.money_state();plan=helper.preflight(current,staged)
                staged.execute('BEGIN IMMEDIATE');receipt=helper.preserve_current_authority(current,staged,plan);staged.commit()
                self.assertTrue(helper.verify_restored(staged,receipt)['verified'])
                row=staged.execute('SELECT level,revision FROM cashier_account_scopes WHERE staff_id=? AND account_id=?',(base.A['staffId'],account)).fetchone()
                self.assertEqual(tuple(row),('disabled',2));self.assertEqual(f.money_state(),before)
                f.rejected(base.A,'/cashier/api/reports/balances?accountId='+account,'GET',{},(403,),self.staged_engine(f,path))
            finally:current.close();staged.close()

        def test_R02_snapshot_after_confirmed_money_is_required_no_compensating_insert(self):
            f=self.fixture();account=f.account();staged,_=self.clone(f);current=f.connection()
            try:
                f.opening(account,10000);before=f.money_state();old_count=staged.execute('SELECT COUNT(*) FROM cashier_postings').fetchone()[0]
                with self.assertRaises(Exception) as caught:helper.preflight(current,staged)
                self.assertEqual(getattr(caught.exception,'status',None),409)
                self.assertEqual(f.money_state(),before);self.assertEqual(staged.execute('SELECT COUNT(*) FROM cashier_postings').fetchone()[0],old_count)
            finally:current.close();staged.close()

        def test_R03_lost_unfinished_draft_becomes_terminal_receipt_and_number_is_not_reissued(self):
            f=self.fixture();left=f.account();right=f.account('虚构银行乙','bank');f.opening(left,10000);f.opening(right)
            staged,path=self.clone(f);request_id=str(uuid.uuid4())
            lost=f.draft('transfer',left,1000,request_id=request_id,toAccountId=right);current=f.connection()
            body={'requestId':request_id,'kind':'transfer','accountId':left,'businessDate':base.DAY,'amountCents':'1000','note':'虚构资金凭证','toAccountId':right}
            try:
                plan=helper.preflight(current,staged);self.assertTrue(plan['requiredDispatchGuard'])
                staged.execute('BEGIN IMMEDIATE');receipt=helper.preserve_current_authority(current,staged,plan);staged.commit()
                self.assertTrue(helper.verify_restored(staged,receipt)['verified'])
                self.assertIsNone(staged.execute('SELECT id FROM cashier_documents WHERE id=?',(lost['id'],)).fetchone())
                with self.assertRaises(Exception) as caught:helper.reject_restored_request(staged,base.A,'POST','/cashier/api/documents',body)
                self.assertEqual(getattr(caught.exception,'code',None),'CASHIER_RESTORED_UNFINISHED')
                with self.assertRaises(Exception) as conflict:helper.reject_restored_request(staged,base.A,'POST','/cashier/api/documents',dict(body,amountCents='1001'))
                self.assertEqual(getattr(conflict.exception,'status',None),409)
                engine=self.staged_engine(f,path)
                fresh=f.call(base.A,'/cashier/api/documents','POST',dict(body,requestId=str(uuid.uuid4())),engine)['document']
                self.assertNotEqual(fresh['number'],lost['number'])
                self.assertEqual(staged.execute('SELECT SUM(signed_amount_cents) FROM cashier_postings WHERE account_id=?',(left,)).fetchone()[0],10000)
            finally:current.close();staged.close()

        def test_R04_legacy_both_absent_is_noop_and_empty_v1_allows_explicit_initialization(self):
            f=self.fixture();first=self.legacy(f,'legacy-first.db');second=self.legacy(f,'legacy-second.db');current=f.connection()
            try:
                self.assertEqual(helper.preflight(first,second)['mode'],'legacy-noop')
                plan=helper.preflight(current,first);self.assertTrue(plan['needsInitialization'])
                first.execute('BEGIN IMMEDIATE');base.MODULES['cashier_schema.py'].initialize(first)
                receipt=helper.preserve_current_authority(current,first,plan);first.commit()
                self.assertTrue(helper.verify_restored(first,receipt)['verified'])
                self.assertEqual(first.execute('SELECT COUNT(*) FROM cashier_postings').fetchone()[0],0)
            finally:first.close();second.close();current.close()

        def test_R05_partial_schema_is_not_treated_as_an_empty_legacy_backup(self):
            f=self.fixture();partial=self.legacy(f,'legacy-partial.db');partial.execute('CREATE TABLE cashier_metadata(version INTEGER NOT NULL)');partial.execute('INSERT INTO cashier_metadata VALUES(1)');current=f.connection()
            try:
                with self.assertRaises(Exception) as caught:helper.preflight(current,partial)
                self.assertEqual(getattr(caught.exception,'status',None),409)
            finally:partial.close();current.close()

        def test_R06_archive_only_account_and_old_employee_grant_are_disabled(self):
            f=self.fixture();f.account();staged,path=self.clone(f);engine=self.staged_engine(f,path);current=f.connection()
            try:
                account=f.call(base.ADMIN,'/cashier/api/accounts','POST',{'requestId':str(uuid.uuid4()),'code':str(uuid.uuid4()),'name':'仅归档存在的虚构银行','kind':'bank','currency':'CNY','maskedReference':'','note':'虚构归档账户'},engine)['account']
                f.call(base.ADMIN,'/cashier/api/accounts/'+account['id']+'/scopes','POST',{'requestId':str(uuid.uuid4()),'staffId':base.A['staffId'],'level':'manage','revision':0,'note':'虚构旧授权'},engine)
                plan=helper.preflight(current,staged);staged.execute('BEGIN IMMEDIATE');receipt=helper.preserve_current_authority(current,staged,plan);staged.commit()
                helper.verify_restored(staged,receipt)
                self.assertEqual(staged.execute('SELECT active FROM cashier_accounts WHERE id=?',(account['id'],)).fetchone()[0],0)
                self.assertEqual({x[0] for x in staged.execute('SELECT level FROM cashier_account_scopes WHERE account_id=?',(account['id'],))},{'disabled'})
                self.assertIsNone(current.execute('SELECT id FROM cashier_accounts WHERE id=?',(account['id'],)).fetchone())
            finally:staged.close();current.close()

        def test_R07_authority_change_after_preflight_rejects_without_partial_staged_changes(self):
            f=self.fixture();account=f.account();staged,_=self.clone(f);current=f.connection()
            try:
                plan=helper.preflight(current,staged)
                f.call(base.ADMIN,'/cashier/api/accounts/'+account+'/scopes','POST',{'requestId':str(uuid.uuid4()),'staffId':base.A['staffId'],'level':'disabled','revision':1,'note':'虚构预检后撤权'})
                staged.execute('BEGIN IMMEDIATE')
                with self.assertRaises(Exception) as caught:helper.preserve_current_authority(current,staged,plan)
                self.assertEqual(getattr(caught.exception,'status',None),409);staged.rollback()
                self.assertEqual(staged.execute('SELECT level FROM cashier_account_scopes WHERE staff_id=? AND account_id=?',(base.A['staffId'],account)).fetchone()[0],'manage')
            finally:staged.close();current.close()

        def test_R08_original_blob_integrity_is_checked_before_and_after_restore(self):
            f=self.fixture();account=f.account('虚构银行','bank');f.opening(account)
            body={'requestId':str(uuid.uuid4()),'accountId':account,'csvBase64':base64.b64encode(b'date,amount\n2026-10-19,1.00\n').decode(),'encoding':'utf-8','mapping':{'date':'date','amount':'amount'}}
            preview=f.call(base.A,'/cashier/api/statement-imports/preview','POST',body)
            f.call(base.A,'/cashier/api/statement-imports','POST',dict(body,previewHash=preview['previewHash']))
            staged,_=self.clone(f);current=f.connection()
            try:
                plan=helper.preflight(current,staged);staged.execute('BEGIN IMMEDIATE');receipt=helper.preserve_current_authority(current,staged,plan);staged.commit();helper.verify_restored(staged,receipt)
                trigger=staged.execute("SELECT sql FROM sqlite_master WHERE name='cashier_statement_originals_no_update'").fetchone()[0]
                staged.execute('DROP TRIGGER cashier_statement_originals_no_update')
                raw=staged.execute('SELECT sha256,content FROM cashier_statement_originals').fetchone()
                staged.execute('UPDATE cashier_statement_originals SET content=? WHERE sha256=?',(b'X'+bytes(raw['content'])[1:],raw['sha256']))
                staged.execute(trigger)
                with self.assertRaises(Exception) as caught:helper.verify_restored(staged,receipt)
                self.assertEqual(getattr(caught.exception,'status',None),409)
                with self.assertRaises(Exception) as before:helper.preflight(current,staged)
                self.assertEqual(getattr(before.exception,'status',None),409)
            finally:staged.close();current.close()

        def test_R10_account_disabled_after_snapshot_stays_disabled_without_reviving_access(self):
            f=self.fixture();account=f.account();staged,_=self.clone(f);current=f.connection()
            try:
                original=f.rows('SELECT * FROM cashier_accounts WHERE id=?',(account,))[0]
                f.call(base.ADMIN,'/cashier/api/accounts/'+account,'PATCH',{'requestId':str(uuid.uuid4()),'revision':original['revision'],
                       'name':original['name'],'maskedReference':original['masked_reference'],'note':original['note'],'active':False})
                plan=helper.preflight(current,staged);staged.execute('BEGIN IMMEDIATE');receipt=helper.preserve_current_authority(current,staged,plan);staged.commit()
                helper.verify_restored(staged,receipt)
                self.assertEqual(staged.execute('SELECT active,revision FROM cashier_accounts WHERE id=?',(account,)).fetchone()[:],(0,2))
                self.assertEqual(current.execute('SELECT active FROM cashier_accounts WHERE id=?',(account,)).fetchone()[0],0)
            finally:staged.close();current.close()

        def test_R09_linked_erp_history_conflict_cannot_pass_even_with_equal_cash_balances(self):
            f=self.fixture();account=f.account();f.opening(account);bill,release,_=f.source(10000);f.receipt(account,release,3000)
            staged,_=self.clone(f);current=f.connection()
            try:
                staged.execute('DROP TRIGGER erp_postings_no_update')
                staged.execute('UPDATE erp_postings SET settled_cents=settled_cents+1 WHERE bill_id=? AND settled_cents>0',(bill,))
                with self.assertRaises(Exception) as caught:helper.preflight(current,staged)
                self.assertEqual(getattr(caught.exception,'status',None),409)
                self.assertEqual(f.balance(account),3000);self.assertEqual(f.outstanding(bill),7000)
            finally:staged.close();current.close()

    return unittest.defaultTestLoader.loadTestsFromTestCase(CashierRestoreContracts)
