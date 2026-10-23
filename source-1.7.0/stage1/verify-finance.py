from pathlib import Path
import os
import sys
ROOT=Path(__file__).resolve().parent.parent
from python_guard import install
install(ROOT,require_restricted=True)
os.environ['LEDGER_DATA']=str(ROOT/'data'/'ledger')
os.environ['STOCKCHECK_DATA']=str(ROOT/'data'/'inventory')
os.environ['LEDGER_DISABLE_BACKUP_THREAD']='1'
os.environ['LEDGER_DISABLE_EXTERNAL_THREAD']='1'
sys.path.insert(0,str(ROOT/'project'/'desktop'/'legacy-source'/'ledger'))
from repairs import install as install_repairs
install_repairs()
from app import create_app
app=create_app()
import algorithm_approval
algorithm_approval.configure(app)
import unittest
import uuid
import rule_engine as rules
import algorithm_approval as approval
from app import db

class ApprovalTest(unittest.TestCase):
 def test_reviewed_version_only_changes_new_calculations(self):
  author={'staffId':'test-author','name':'虚构编制人','access':'manage'}
  reviewer={'staffId':'test-reviewer','name':'虚构审批人','access':'manage'}
  with app.app_context():
   before=rules.rule('sales');steps=[list(x) for x in before['formulas']]
   steps[0][1]='('+steps[0][1]+') + 1'
   inputs={'克重':2,'销售克价':500,'工费':20,'成本':900,'实际到账':1020,'点差':40}
   proposal=approval.submit(author,{'requestId':str(uuid.uuid4()),'domain':'sales','baseId':before['id'],'formulas':steps,'samples':[inputs],'reason':'虚构算法修正验证'})
   self.assertEqual(rules.rule('sales')['id'],before['id'])
   with self.assertRaisesRegex(ValueError,'自己'):
    approval.review(author,proposal['id'],{'decision':'approve','hash':proposal['hash'],'note':'自己审批应拒绝'})
   with self.assertRaisesRegex(ValueError,'版本'):
    approval.review(reviewer,proposal['id'],{'decision':'approve','hash':'0'*64,'note':'错误版本应拒绝'})
   original=rules.compute('sales',inputs,before['id'])[0]
   accepted=approval.review(reviewer,proposal['id'],{'decision':'approve','hash':proposal['hash'],'note':'已核对同一版本的试算变化'})
   self.assertEqual(accepted['status'],'approved')
   self.assertEqual(rules.compute('sales',inputs,before['id'])[0],original,'historical rule values must remain identical')
   self.assertEqual(rules.compute('sales',inputs)[0]['销售金额'],original['销售金额']+1)
   with self.assertRaisesRegex(ValueError,'处理'):
    approval.review(reviewer,proposal['id'],{'decision':'approve','hash':proposal['hash'],'note':'重复审批应拒绝'})
   self.assertGreaterEqual(len(approval.events(proposal['id'])),2)
 def test_sql_and_python_injection_cannot_be_proposed(self):
  actor={'staffId':'test-author','name':'虚构编制人','access':'manage'}
  with app.app_context():
   before=rules.rule('material');steps=[['金额',"__import__('os').system('unsafe')"]]
   with self.assertRaises(ValueError):
    approval.submit(actor,{'requestId':str(uuid.uuid4()),'domain':'material','baseId':before['id'],'formulas':steps,'samples':[{'克数':1,'单价':2,'工费':3}],'reason':'必须拒绝代码'})
 def test_rejected_proposal_does_not_become_rule(self):
  a={'staffId':'test-author','name':'虚构编制人','access':'manage'};b={'staffId':'test-reviewer','name':'虚构审批人','access':'manage'}
  with app.app_context():
   before=rules.rule('material');p=approval.submit(a,{'requestId':str(uuid.uuid4()),'domain':'material','baseId':before['id'],'formulas':[['金额','克数 * 单价 + 工费 + 2']],'samples':[{'克数':1,'单价':2,'工费':3}],'reason':'虚构退回测试'})
   approval.review(b,p['id'],{'decision':'reject','hash':p['hash'],'note':'试算与业务要求不符'})
   self.assertEqual(rules.rule('material')['id'],before['id'])
 def test_outdated_pending_proposal_can_be_returned(self):
  author={'staffId':'test-author','name':'虚构编制人','access':'manage'};reviewer={'staffId':'test-reviewer','name':'虚构审批人','access':'manage'}
  with app.app_context():
   before=rules.rule('stock')
   def draft(reason,addition):return approval.submit(author,{'requestId':str(uuid.uuid4()),'domain':'stock','baseId':before['id'],'formulas':[['毛利','('+before['formulas'][0][1]+') + '+str(addition)]],'samples':[{'售价':10,'成本':8,'克重':1}],'reason':reason})
   stale=draft('虚构待退回的旧申请',2);active=draft('虚构先获批的申请',1)
   approval.review(reviewer,active['id'],{'decision':'approve','hash':active['hash'],'note':'核对第一版本'})
   returned=approval.review(reviewer,stale['id'],{'decision':'reject','hash':stale['hash'],'note':'旧基线已过期，请按新版本重新编制'})
   self.assertEqual(returned['status'],'rejected')
if __name__=='__main__':
 unittest.main()
