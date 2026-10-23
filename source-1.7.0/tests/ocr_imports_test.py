"""Pure OCR imports/parser tests; only in-memory toy SQLite, no Flask/real DB."""
import base64,contextlib,hashlib,importlib.util,json,sqlite3,sys,unittest,uuid,types
from pathlib import Path
FILE=Path(__file__).resolve().parent.parent/'project/desktop/legacy-source/ledger/ocr.py'
def api():
    assert FILE.is_file(),'Protected OCR import helper is missing'
    spec=importlib.util.spec_from_file_location('xjy_ocr_pure',FILE);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
def actor():return {'staffId':'toy-staff','protocolVersion':2,'access':'operate','capabilities':['erp.read','erp.purchase.prepare','erp.attachments.write','erp.reports.sensitive']}
def words(text,x,y):return {'text':text,'x':x,'y':y,'width':max(10,len(text)*10),'height':20}
def raw():
    rows=[('供应商：虚构供货商',40,20),('日期：2026-10-14',40,55),('合计：2835.00元',40,200)]
    lines=[{'text':text,'words':[words(text,x,y)]}for text,x,y in rows]
    for y,entries in [(100,[('品名',40),('件数',350),('克重(g)',480),('单价(元/g)',670),('金额(元)',950)]),(140,[('铂金素链',40),('2',350),('6.3000',480),('450.00',670),('2835.00',950)])]:
        for text,x in entries:lines.append({'text':text,'words':[words(text,x,y)]})
    return {'version':1,'engine':'windows.media.ocr','language':'zh-Hans-CN','osBuild':'toy','width':1200,'height':300,'text':' '.join(x['text']for x in lines),'angle':None,'lines':lines,'confidence':None}
class Tests(unittest.TestCase):
    def setUp(self):self.m=api()
    def test_parser_preserves_raw_and_extracts_spatial_columns_without_confidence(self):
        original=raw();value=self.m.extract_candidates(original);self.assertEqual(value['supplierName'],'虚构供货商');self.assertEqual(value['date'],'2026-10-14');self.assertEqual(value['invoiceTotal'],'2835.00');self.assertEqual(value['rows'][0]['quantity'],2);self.assertEqual(value['rows'][0]['estimatedWeight'],'6.3000');self.assertEqual(value['rows'][0]['unitPrice'],'450.00');self.assertEqual(value['rows'][0]['amount'],'2835.00');self.assertIsNone(value['confidence']);self.assertEqual(original,raw())
    def test_ambiguous_digits_and_dates_are_null_and_never_silently_repaired(self):
        value=raw();value['lines'][1]['text']='日期：2026一10一14';value['lines'][1]['words'][0]['text']='日期：2026一10一14';value['lines'][-1]['text']='28O5.OO';value['lines'][-1]['words'][0]['text']='28O5.OO';result=self.m.extract_candidates(value);self.assertIsNone(result['date']);self.assertIsNone(result['rows'][0]['amount']);self.assertIn('amount',result['rows'][0]['uncertain'])
    def test_explicit_kilograms_are_not_misrepresented_as_ERP_grams_due_to_another_column(self):
        value=raw()
        for line in value['lines']:
            if line['text']=='克重(g)':line['text']='重量(kg)';line['words'][0]['text']='重量(kg)'
        result=self.m.extract_candidates(value);self.assertIsNone(result['rows'][0]['estimatedWeight']);self.assertEqual(result['rows'][0]['sourceCells']['estimatedWeight'],'6.3000')
    def test_command_text_is_inert_and_out_of_bounds_boxes_are_rejected(self):
        value=raw();value['lines'][-5]['words'][0]['text']='$(Remove-Item F:/)';result=self.m.extract_candidates(value);self.assertIn('Remove-Item',result['rows'][0]['description']);value['lines'][0]['words'][0]['x']=2000;self.assertRaises(self.m.OcrError,self.m.extract_candidates,value)
    def fixture(self):
        db=sqlite3.connect(':memory:');db.row_factory=sqlite3.Row;self.addCleanup(db.close);self.m.initialize(db);db.executescript('CREATE TABLE erp_parties(id TEXT PRIMARY KEY,name TEXT,kind TEXT,active INTEGER);CREATE TABLE draft_only(id TEXT,payload TEXT,status TEXT);');party='SUP:1';db.execute('INSERT INTO erp_parties VALUES(?,?,?,1)',(party,'虚构供货商','supplier'));db.commit();image=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6rAAAAABJRU5ErkJggg==');aid=str(uuid.uuid4());state={'missing':False,'changed':False,'runs':0,'actor':actor()}
        @contextlib.contextmanager
        def transaction():
            db.execute('BEGIN IMMEDIATE')
            try:yield db;db.commit()
            except BaseException:db.rollback();raise
        def load(who,identifier,connection=None):
            if identifier!=aid or state['missing']:raise self.m.OcrError('original attachment missing',404)
            body=image+(b'changed'if state['changed']else b'');return {'id':aid,'mime':'image/png','sha256':hashlib.sha256(body).hexdigest(),'body':body,'name':'toy.png'}
        def provider(value):state['runs']+=1;return raw()
        # Side-effect boundary is injected; parser, source guards, durable import
        # state, idempotency and review validation are production helper code.
        def create(who,value,provenance=None):
            with transaction()as c:
                did=str(uuid.uuid4());c.execute('INSERT INTO draft_only VALUES(?,?,?)',(did,json.dumps(value),'draft'));provenance(c,did,value);return {'id':did,'status':'draft','kind':value['kind']}
        service=self.m.OcrImports(transaction=transaction,load_attachment=load,recognize=provider,create_purchase=create);return db,service,aid,party,state
    def test_same_image_and_request_are_idempotent_while_changed_source_conflicts(self):
        db,s,aid,party,state=self.fixture();request={'requestId':str(uuid.uuid4()),'attachmentId':aid};first=s.start(actor(),request);self.assertEqual(s.start(actor(),request)['jobId'],first['jobId']);self.assertEqual(s.start(actor(),{'requestId':str(uuid.uuid4()),'attachmentId':aid})['jobId'],first['jobId']);self.assertEqual(state['runs'],1);state['changed']=True;self.assertRaises(self.m.OcrError,s.start,actor(),request)
    def test_revoked_or_logged_out_users_cannot_read_ready_sensitive_results(self):
        db,s,aid,party,state=self.fixture();job=s.start(actor(),{'requestId':str(uuid.uuid4()),'attachmentId':aid});who=actor();who['capabilities'].remove('erp.reports.sensitive');self.assertRaises(self.m.OcrError,s.get,who,job['jobId']);self.assertRaises(self.m.OcrError,s.get,None,job['jobId']);state['missing']=True;self.assertRaises(self.m.OcrError,s.get,actor(),job['jobId'])
    def test_revocation_during_recognition_never_returns_cost_text_or_creates_a_document(self):
        db,s,aid,party,state=self.fixture();who=actor()
        def provider(value):who['capabilities'].remove('erp.reports.sensitive');return raw()
        s.recognize=provider;result=s.start(who,{'requestId':str(uuid.uuid4()),'attachmentId':aid});self.assertEqual(set(result),{'jobId','status','reused'});self.assertRaises(self.m.OcrError,s.get,who,result['jobId']);self.assertRaises(self.m.OcrError,s.save_draft,who,result['jobId'],{'reviewed':True});self.assertEqual(db.execute('SELECT count(*)FROM draft_only').fetchone()[0],0)
    def review(self,s,jid,party):
        job=s.get(actor(),jid);row=job['candidates']['rows'][0];doc={'partyId':party,'businessType':'own','date':'2026-10-14','dueDate':'2026-10-14','note':'','lines':[{'rowId':row['id'],'description':row['description'],'material':'铂金','purity':'','quantity':2,'estimatedWeight':'6.3000','amount':'2835.00'}]};decisions=[]
        for key in ['description','material','purity','quantity','estimatedWeight','amount']:decisions.append({'path':'rows.'+row['id']+'.'+key,'action':'accept'if row.get(key)==doc['lines'][0][key]else'manual','reason':'核对原图后确认'})
        for key in ['supplier','date','businessType','total']:decisions.append({'path':key,'action':'manual','reason':'核对原图后确认'})
        return {'requestId':str(uuid.uuid4()),'imageHash':job['imageHash'],'resultHash':job['resultHash'],'document':doc,'review':{'decisions':decisions,'confirmedTotal':'2835.00','totalDifferenceReason':''}}
    def test_checkbox_alone_cannot_create_a_draft_or_change_financial_amounts(self):
        db,s,aid,party,state=self.fixture();jid=s.start(actor(),{'requestId':str(uuid.uuid4()),'attachmentId':aid})['jobId'];value=self.review(s,jid,party);value['review']={'reviewed':True};self.assertRaises(self.m.OcrError,s.save_draft,actor(),jid,value);self.assertEqual(db.execute('SELECT count(*)FROM draft_only').fetchone()[0],0)
    def test_supplier_identifier_matches_real_SUP_contract_and_requires_current_active_supplier(self):
        db,s,aid,party,state=self.fixture();jid=s.start(actor(),{'requestId':str(uuid.uuid4()),'attachmentId':aid})['jobId']
        for identifier in ['CUS:'+str(uuid.uuid4()),str(uuid.uuid4()),'SUP:0','SUP:01','SUP:-1','SUP:1/secret','https://remote.invalid','SUP:'+'9'*20,'SUP:999']:
            value=self.review(s,jid,party);value['document']['partyId']=identifier;self.assertRaises(self.m.OcrError,s.save_draft,actor(),jid,value)
        for field,value in [('active',0),('kind','customer')]:
            db.execute('UPDATE erp_parties SET '+field+'=? WHERE id=?',(value,party));db.commit();review=self.review(s,jid,party);self.assertRaises(self.m.OcrError,s.save_draft,actor(),jid,review);db.execute("UPDATE erp_parties SET active=1,kind='supplier' WHERE id=?",(party,));db.commit()
        self.assertEqual(db.execute('SELECT count(*)FROM draft_only').fetchone()[0],0)
    def test_all_one_hundred_allowed_lines_accept_complete_price_and_business_field_review(self):
        db,s,aid,party,state=self.fixture();jid=s.start(actor(),{'requestId':str(uuid.uuid4()),'attachmentId':aid})['jobId'];value=self.review(s,jid,party);value['document']['lines']=[];value['review']['decisions']=[{'path':key,'action':'manual','reason':'对照原图手工确认'}for key in ['supplier','date','businessType','total']]
        for i in range(100):
            ref='r1'if i==0 else'manual-'+str(i);line={'rowId':ref,'description':'虚构手工明细','material':'铂金','purity':'','quantity':1,'estimatedWeight':'1.0000','amount':'1.00','unitPrice':'1.00','priceBasis':'per_gram'};value['document']['lines'].append(line)
            value['review']['decisions'].extend({'path':'rows.'+ref+'.'+key,'action':'manual','reason':'对照原图手工确认'}for key in line if key!='rowId')
        value['review']['confirmedTotal']='100.00';value['review']['totalDifferenceReason']='测试逐行与原图差额已核对';document=s.save_draft(actor(),jid,value);self.assertEqual(document['status'],'draft');payload=json.loads(db.execute('SELECT payload FROM draft_only').fetchone()[0]);self.assertEqual(len(payload['lines']),100);self.assertNotIn('unitPrice',payload['lines'][99])
    def test_full_server_review_creates_only_purchase_draft_with_original_attachment_and_audit(self):
        db,s,aid,party,state=self.fixture();jid=s.start(actor(),{'requestId':str(uuid.uuid4()),'attachmentId':aid})['jobId'];value=self.review(s,jid,party);document=s.save_draft(actor(),jid,value);self.assertEqual(document['status'],'draft');saved=json.loads(db.execute('SELECT payload FROM draft_only').fetchone()[0]);self.assertEqual(saved['kind'],'purchase');self.assertEqual(saved['attachments'],[aid]);self.assertNotIn('unitPrice',saved['lines'][0]);proof=db.execute('SELECT accepted_json FROM erp_ocr_imports WHERE id=?',(jid,)).fetchone()[0];self.assertIn('核对原图后确认',proof);self.assertEqual(s.get(actor(),jid)['documentId'],document['id'])
    def test_total_mismatch_and_missing_original_image_cannot_commit(self):
        db,s,aid,party,state=self.fixture();jid=s.start(actor(),{'requestId':str(uuid.uuid4()),'attachmentId':aid})['jobId'];value=self.review(s,jid,party);value['document']['lines'][0]['amount']='1.00';self.assertRaises(self.m.OcrError,s.save_draft,actor(),jid,value);value=self.review(s,jid,party);state['missing']=True;self.assertRaises(self.m.OcrError,s.save_draft,actor(),jid,value);self.assertEqual(db.execute('SELECT count(*)FROM draft_only').fetchone()[0],0)
    def test_raw_or_candidate_tampering_cannot_be_accepted_as_the_original_extraction(self):
        for target in ['raw_json','candidates_json']:
            db,s,aid,party,state=self.fixture();jid=s.start(actor(),{'requestId':str(uuid.uuid4()),'attachmentId':aid})['jobId'];record=db.execute('SELECT '+target+' FROM erp_ocr_imports WHERE id=?',(jid,)).fetchone()[0];value=json.loads(record)
            if target=='raw_json':value['text']='changed original text'
            else:value['rows'][0]['amount']='1.00'
            db.execute('UPDATE erp_ocr_imports SET '+target+'=? WHERE id=?',(json.dumps(value),jid));db.commit();self.assertRaises(self.m.OcrError,s.get,actor(),jid)
    def test_real_original_purchase_creator_binds_provenance_atomically_and_never_posts_payable_or_stock(self):
        db=sqlite3.connect(':memory:');db.row_factory=sqlite3.Row;self.addCleanup(db.close)
        @contextlib.contextmanager
        def transaction():
            db.execute('BEGIN IMMEDIATE')
            try:yield db;db.commit()
            except BaseException:db.rollback();raise
        prior={name:sys.modules.get(name)for name in ['app','repairs','erp_numbers','erp_values','erp_common','erp_schema','erp_suppliers','ocr']}
        def restore_modules():
            for name,value in prior.items():
                if value is None:sys.modules.pop(name,None)
                else:sys.modules[name]=value
        self.addCleanup(restore_modules);app=types.ModuleType('app');app.db=types.SimpleNamespace(now_str=lambda:'2026-10-14T00:00:00');sys.modules['app']=app;repairs=types.ModuleType('repairs');repairs.transaction=transaction;sys.modules['repairs']=repairs;nums=types.ModuleType('erp_numbers');nums.reserve=lambda kind,day,did:'CG-TOY-'+did;sys.modules['erp_numbers']=nums;sys.modules['ocr']=self.m
        def load(name):
            spec=importlib.util.spec_from_file_location(name,FILE.parent/(name+'.py'));module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module);return module
        values=load('erp_values');common=load('erp_common');schema=load('erp_schema');documents=load('erp_documents');suppliers=load('erp_suppliers');self.addCleanup(lambda:sys.modules.pop('erp_documents',None));db.executescript('CREATE TABLE suppliers(id INTEGER PRIMARY KEY,name TEXT,sort INTEGER,note TEXT,active INTEGER);CREATE TABLE audit_logs(action TEXT,detail TEXT,at TEXT);CREATE TABLE toy_stock(quantity INTEGER);INSERT INTO toy_stock VALUES(10);');schema.initialize(db);db.commit();supplier_actor=actor();supplier_actor['name']='虚构供应商维护员';supplier_actor['capabilities'].append('erp.parties.manage');party=suppliers.save_supplier(supplier_actor,{'requestId':str(uuid.uuid4()),'kind':'supplier','name':'虚构供货商'})['id'];self.assertEqual(party,'SUP:1');aid=str(uuid.uuid4());image=b'owned fake image metadata only';sha=hashlib.sha256(image).hexdigest();db.execute('INSERT INTO erp_attachments VALUES(?,?,?,?,?,?,?,?,?)',(aid,str(uuid.uuid4()),'0'*64,'toy-staff','toy.png','image/png',len(image),sha,'2026-10-14'));db.commit();who=actor();who['name']='虚构制单人'
        loader=lambda a,i,connection=None:{'id':aid,'mime':'image/png','sha256':sha,'body':image};service=self.m.OcrImports(transaction=transaction,load_attachment=loader,recognize=lambda value:raw(),create_purchase=documents.create_purchase);jid=service.start(who,{'requestId':str(uuid.uuid4()),'attachmentId':aid})['jobId'];value=self.review(service,jid,party);made=service.save_draft(who,jid,value);self.assertEqual(made['status'],'draft');self.assertEqual(made['amountCents'],283500);self.assertEqual(db.execute('SELECT status FROM erp_ocr_imports WHERE id=?',(jid,)).fetchone()[0],'draft');self.assertEqual(db.execute('SELECT count(*)FROM erp_bills').fetchone()[0],0);self.assertEqual(db.execute('SELECT count(*)FROM erp_postings').fetchone()[0],0);self.assertEqual(db.execute('SELECT quantity FROM toy_stock').fetchone()[0],10)
        proof=common.public_document(db,common.document(db,made['id']),who,True);self.assertEqual(proof['ocrEvidence'][0]['imageHash'],sha);self.assertEqual(proof['ocrEvidence'][0]['rawText'],raw()['text']);masked=actor();masked['capabilities'].remove('erp.reports.sensitive');self.assertNotIn('ocrEvidence',common.public_document(db,common.document(db,made['id']),masked,True))
        repeated=service.save_draft(who,jid,value);self.assertEqual(repeated['id'],made['id']);self.assertEqual(db.execute('SELECT count(*)FROM erp_documents').fetchone()[0],1)
        edited={**value['document'],'requestId':str(uuid.uuid4()),'kind':'purchase','attachments':[],'revision':made['revision']};edited['lines']=[{k:v for k,v in line.items()if k!='rowId'}for line in edited['lines']];self.assertRaises(values.ErpError,documents.update_draft,who,made['id'],edited)
    def test_corrected_unit_price_and_basis_are_audited_without_becoming_unknown_ERP_amount_fields(self):
        db,s,aid,party,state=self.fixture();jid=s.start(actor(),{'requestId':str(uuid.uuid4()),'attachmentId':aid})['jobId'];value=self.review(s,jid,party);value['document']['lines'][0].update(unitPrice='451.00',priceBasis='per_gram');value['review']['decisions'] += [{'path':'rows.r1.unitPrice','action':'manual','reason':'对照原图修正单价，行合计另核对'},{'path':'rows.r1.priceBasis','action':'accept','reason':''}];made=s.save_draft(actor(),jid,value);proof=json.loads(db.execute('SELECT accepted_json FROM erp_ocr_imports WHERE id=?',(jid,)).fetchone()[0]);self.assertEqual(proof['priceReview'][0]['unitPrice'],'451.00');saved=json.loads(db.execute('SELECT payload FROM draft_only').fetchone()[0]);self.assertEqual(saved['lines'][0]['amount'],'2835.00');self.assertNotIn('unitPrice',saved['lines'][0])
if __name__=='__main__':unittest.main()
