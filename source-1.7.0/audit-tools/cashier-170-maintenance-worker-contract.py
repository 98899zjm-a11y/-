"""Five Guest-only post-auth worker contracts using real SQLite/domain helpers.

Root loads pinned worker and desktop_runtime_context after original admission,
then build_suite(base, worker). This layer does not claim CLI/ticket/bootstrap
coverage; signed native-process integration must additionally be exercised.
"""
import sqlite3
import unittest
import uuid


def build_suite(base,worker):
    if base.RUN_ROOT is None or not base.MODULES:raise RuntimeError('Original admitted Guest fixture required')
    class MaintenanceWorkerContracts(unittest.TestCase):
        def fixture(self):
            f=base.Fixture(self);live=f.directory/'current';live.mkdir();source=f.connection();target=sqlite3.connect(live/'ledger.db')
            try:source.backup(target)
            finally:source.close();target.close()
            f.database=live/'ledger.db';f.reserve=base.MODULES['cashier_numbers.py'].create_reserver(path=f.retained/'cashier-number-reservations.json',namespace='cashier-maintenance-'+uuid.uuid4().hex);f.engine=f.new_engine()
            return f,live

        def snapshot(self,f):
            stage=f.directory/'staged';stage.mkdir();(stage/'ledger').mkdir();source=f.connection();target=sqlite3.connect(stage/'ledger'/'ledger.db')
            try:source.backup(target)
            finally:source.close();target.close()
            return stage

        def test_W01_real_worker_preserves_current_scope_and_verifies_after_directory_swap(self):
            f,live=self.fixture();account=f.account();f.opening(account,10000);stage=self.snapshot(f)
            f.call(base.ADMIN,'/cashier/api/accounts/'+account+'/scopes','POST',{'requestId':str(uuid.uuid4()),'staffId':base.A['staffId'],'level':'disabled','revision':1,'note':'虚构恢复前撤权'})
            before=f.money_state();result=worker.perform({'action':'merge'},live,stage,f.retained)
            self.assertEqual(f.money_state(),before);live.rename(f.directory/'previous-ledger');(stage/'ledger').rename(live)
            verified=worker.perform({'action':'verify','verification':{'receipt':result['receipt'],'numbers':result['numbers']}},live,stage,f.retained)
            self.assertTrue(verified['verified']);self.assertEqual(f.balance(account),10000)
            self.assertEqual(f.rows('SELECT level FROM cashier_account_scopes WHERE staff_id=? AND account_id=?',(base.A['staffId'],account))[0]['level'],'disabled')

        def test_W02_actual_confirmed_funds_missing_from_archive_stop_before_publication(self):
            f,live=self.fixture();account=f.account();stage=self.snapshot(f);f.opening(account,10000);before=f.money_state()
            with self.assertRaises(Exception) as caught:worker.perform({'action':'merge'},live,stage,f.retained)
            self.assertEqual(getattr(caught.exception,'status',None),409);self.assertEqual(f.money_state(),before)
            staged=sqlite3.connect(stage/'ledger'/'ledger.db')
            try:self.assertEqual(staged.execute('SELECT COUNT(*) FROM cashier_postings').fetchone()[0],0)
            finally:staged.close()

        def test_W03_lost_draft_receipt_and_number_witness_survive_real_worker_merge(self):
            f,live=self.fixture();left=f.account();right=f.account('虚构银行乙','bank');f.opening(left,10000);f.opening(right);stage=self.snapshot(f)
            lost=f.draft('transfer',left,1000,toAccountId=right);before=worker.number_witness(f.retained)
            result=worker.perform({'action':'merge'},live,stage,f.retained);self.assertEqual(result['lostCount'],1);self.assertEqual(result['numbers'],before)
            live.rename(f.directory/'previous-ledger');(stage/'ledger').rename(live)
            self.assertTrue(worker.perform({'action':'verify','verification':{'receipt':result['receipt'],'numbers':result['numbers']}},live,stage,f.retained)['verified'])
            self.assertEqual(f.rows('SELECT * FROM cashier_documents WHERE id=?',(lost['id'],)),[])
            self.assertTrue(any('restoredUnfinished' in r['response_json'] for r in f.rows('SELECT * FROM cashier_requests')))
            fresh=f.draft('transfer',left,1000,toAccountId=right);self.assertNotEqual(fresh['number'],lost['number'])

        def test_W04_post_swap_mismatch_fails_then_original_semantic_rollback_verifies(self):
            f,live=self.fixture();account=f.account();f.opening(account,10000);stage=self.snapshot(f)
            result=worker.perform({'action':'merge'},live,stage,f.retained);old=f.directory/'previous-ledger';live.rename(old);(stage/'ledger').rename(live)
            f.execute('UPDATE cashier_account_scopes SET level=? WHERE staff_id=? AND account_id=?',('disabled',base.A['staffId'],account))
            with self.assertRaises(Exception) as caught:worker.perform({'action':'verify','verification':{'receipt':result['receipt'],'numbers':result['numbers']}},live,stage,f.retained)
            self.assertEqual(getattr(caught.exception,'status',None),409)
            live.rename(f.directory/'rejected-ledger');old.rename(live)
            receipt={'version':1,'expectedHash':result['currentHash'],'requiredDispatchGuard':result['receipt']['requiredDispatchGuard']}
            self.assertTrue(worker.perform({'action':'verify-rollback','verification':{'receipt':receipt,'numbers':result['numbers']}},live,stage,f.retained)['verified'])
            self.assertEqual(f.balance(account),10000)

        def test_W05_missing_retained_numbers_cannot_allow_lost_draft_reissue(self):
            f,live=self.fixture();left=f.account();right=f.account('虚构银行乙','bank');f.opening(left,10000);f.opening(right);stage=self.snapshot(f)
            f.draft('transfer',left,1000,toAccountId=right)
            (f.retained/'cashier-number-reservations.json').rename(f.retained/'preserved-number-evidence.json')
            before=f.money_state()
            with self.assertRaisesRegex(ValueError,'编号保留'):worker.perform({'action':'merge'},live,stage,f.retained)
            self.assertEqual(f.money_state(),before)
    return unittest.defaultTestLoader.loadTestsFromTestCase(MaintenanceWorkerContracts)
