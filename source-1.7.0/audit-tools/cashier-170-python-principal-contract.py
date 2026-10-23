"""15 pure-principal/request contracts, repeated against three actual AST sources.

No App, Flask, SQLite, HTTP server or business execution. Request is an explicit
already-decoded request port. HMAC and actual source functions are not mocked.
The runner alone admits the real Guest and loads the exact pinned source AST.
"""
import base64
import hashlib
import hmac
import json
import threading
import unittest
import uuid
from urllib.parse import parse_qsl

TOKEN='cashier-python-principal-fictional-token-not-production'
NOW=1792396800
STAMP=NOW*1000
ID='50000000-0000-4000-8000-000000000001'
RELEASE='60000000-0000-4000-8000-000000000001'
PREFIX=b'xjy-cashier-principal-v1\0'
CAPS=['cashier.read','cashier.amounts.sensitive','cashier.sources.read','cashier.accounts.manage',
      'cashier.documents.prepare','cashier.documents.review','cashier.refunds.prepare','cashier.refunds.review',
      'cashier.transfers.prepare','cashier.transfers.review','cashier.opening.prepare','cashier.opening.review',
      'cashier.reversals.prepare','cashier.reversals.review','cashier.reconcile.import','cashier.reconcile.match',
      'cashier.reconcile.review','cashier.reports.view','cashier.reports.export']


class Arguments:
    def __init__(self,query):self.pairs=parse_qsl(query.decode('ascii'),keep_blank_values=True)
    def __iter__(self):return iter(dict(self.pairs))
    def getlist(self,key):return [v for k,v in self.pairs if k==key]


class Request:
    def __init__(self,path='/cashier/api/bootstrap',method='GET',body=b'',query=b'',endpoint='cashier.dispatch_0',content_type='application/json'):
        self.path=path;self.method=method;self.body=body;self.query_string=query
        self.endpoint=endpoint;self.content_type=content_type;self.headers={};self.args=Arguments(query)
    def get_data(self,cache=True):return self.body


def claims(request,*,cashier=True,erp=False,**patch):
    actor={'v':1,'module':'cashier' if cashier else 'ledger','staffId':ID,'userId':ID,'name':'虚构已授权员工',
           'role':'employee','access':'manage' if cashier else 'view','grantRevision':3,'issuedAt':STAMP,'expiresAt':STAMP+30000,
           'nonce':str(uuid.uuid4()),'method':request.method,'decodedPath':request.path,'query':request.query_string.decode('ascii'),
           'bodySha256':hashlib.sha256(request.body).hexdigest()}
    if cashier:actor.update(protocolVersion=3,authorityModule='cashier',storageModule='ledger',capabilities=list(CAPS))
    elif erp:actor.update(protocolVersion=2,capabilities=['erp.read'])
    actor.update(patch)
    return actor


def sign(request,actor,prefix=PREFIX):
    raw=json.dumps(actor,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode('utf-8')
    encoded=base64.urlsafe_b64encode(raw).decode('ascii').rstrip('=')
    request.headers={'X-XJY-Principal':encoded,'X-XJY-Principal-Signature':hmac.new(TOKEN.encode(),prefix+encoded.encode('ascii'),hashlib.sha256).hexdigest()}
    return request


def build_suite(subjects,admitted=False):
    if admitted is not True or set(subjects)!= {'generic','release','ledger'}:raise RuntimeError('Exact three admitted AST subjects required')
    suite=unittest.TestSuite()
    for label,subject in subjects.items():
        def make_case(label,subject):
            class PrincipalContracts(unittest.TestCase):
                def accept(self,request,consumed=None,module='ledger'):
                    return subject.principal_actor(TOKEN,module,request,{} if consumed is None else consumed,threading.Lock(),clock=lambda:NOW)

                def reject(self,request,**kwargs):
                    with self.assertRaises(ValueError):self.accept(request,**kwargs)

                def test_P01_real_cashier_v3_prefix_all_19_caps_and_ledger_storage(self):
                    req=Request();actor=claims(req);consumed={}
                    self.assertEqual(len(actor['capabilities']),19)
                    self.assertEqual(self.accept(sign(req,actor),consumed),actor)
                    self.assertEqual(consumed,{actor['nonce']:actor['expiresAt']})

                def test_P02_generic_or_wrong_domain_mac_cannot_authenticate_cashier(self):
                    for prefix in (b'',b'xjy-cashier-principal-v1',b'xjy-cashier-principal-v2\0'):
                        with self.subTest(prefix=prefix):
                            req=Request();self.reject(sign(req,claims(req),prefix))

                def test_P03_exact_claim_keys_protocol_authority_and_storage_are_required(self):
                    patches=[{'module':'ledger'},{'authorityModule':'ledger'},{'storageModule':'inventory'},
                             {'protocolVersion':2},{'protocolVersion':True},{'accountIds':[ID]},{'scopeRevision':1},
                             {'actor':{'role':'admin'}},{'staffId':'not-a-canonical-uuid'},{'v':True}]
                    for patch in patches:
                        with self.subTest(patch=patch):
                            req=Request();self.reject(sign(req,claims(req,**patch)))
                    for missing in ('authorityModule','storageModule','capabilities','protocolVersion'):
                        req=Request();actor=claims(req);del actor[missing]
                        with self.subTest(missing=missing):self.reject(sign(req,actor))

                def test_P04_body_bytes_are_bound_and_tampered_claim_is_not_resigned(self):
                    req=Request('/cashier/api/documents','POST',b'{"amountCents":"100"}')
                    sign(req,claims(req));req.body=b'{"amountCents":"101"}';self.reject(req)
                    req=Request();actor=claims(req);sign(req,actor)
                    raw=json.loads(base64.urlsafe_b64decode(req.headers['X-XJY-Principal']+'='*(-len(req.headers['X-XJY-Principal'])%4)))
                    raw['name']='虚构篡改名称';req.headers['X-XJY-Principal']=base64.urlsafe_b64encode(json.dumps(raw).encode()).decode().rstrip('=')
                    self.reject(req)

                def test_P05_exact_path_method_and_query_are_signed(self):
                    for field,value in [('path','/cashier/api/accounts'),('method','POST'),('query_string',b'limit=2')]:
                        req=Request('/cashier/api/documents',query=b'limit=1');sign(req,claims(req));setattr(req,field,value)
                        with self.subTest(field=field):self.reject(req)

                def test_P06_expired_future_overlong_and_noninteger_lifetimes_are_rejected(self):
                    for patch in ({'issuedAt':STAMP-30000,'expiresAt':STAMP},{'issuedAt':STAMP+2001,'expiresAt':STAMP+32001},
                                  {'expiresAt':STAMP+30001},{'issuedAt':True},{'expiresAt':float(STAMP+30000)},
                                  {'issuedAt':STAMP-30001,'expiresAt':STAMP-1}):
                        req=Request()
                        with self.subTest(patch=patch):self.reject(sign(req,claims(req,**patch)))

                def test_P07_nonce_replay_expired_cache_cleanup_and_capacity_are_enforced(self):
                    req=Request();actor=claims(req);sign(req,actor);expired=str(uuid.uuid4());consumed={expired:STAMP-1}
                    self.accept(req,consumed);self.assertNotIn(expired,consumed);self.reject(req,consumed=consumed)
                    req=Request();self.reject(sign(req,claims(req,nonce='not-a-nonce')))
                    full={str(uuid.uuid4()):STAMP+1000 for _ in range(4096)};req=Request()
                    self.reject(sign(req,claims(req)),consumed=full);self.assertEqual(len(full),4096)

                def test_P08_real_cashier_capability_validator_rejects_unknown_duplicate_and_over_level(self):
                    for access,caps in [('manage',['cashier.read','erp.read']),('manage',['cashier.read','cashier.unknown']),
                                        ('manage',['cashier.read','cashier.read']),('manage',['cashier.documents.prepare']),
                                        ('operate',['cashier.read','cashier.documents.review']),('operate',['cashier.read','cashier.opening.prepare']),
                                        ('view',['cashier.read','cashier.documents.prepare']),('manage','cashier.read')]:
                        req=Request()
                        with self.subTest(access=access,caps=caps):self.reject(sign(req,claims(req,access=access,capabilities=caps)))

                def test_P09_old_ledger_v1_keeps_generic_mac_and_existing_validation(self):
                    req=Request('/');actor=claims(req,cashier=False)
                    self.assertEqual(self.accept(sign(req,actor,b'')),actor)
                    for patch in ({'role':'admin','access':'view'},{'grantRevision':True},{'name':'bad\x00name'},{'expiresAt':STAMP}):
                        req=Request()
                        req.path='/'
                        with self.subTest(patch=patch):self.reject(sign(req,claims(req,cashier=False,**patch),b''))

                def test_P10_old_erp_v2_keeps_generic_mac_and_erp_capability_validation(self):
                    req=Request('/erp/api/bootstrap',endpoint='erp.bootstrap');actor=claims(req,cashier=False,erp=True)
                    accepted=self.accept(sign(req,actor,b''));self.assertEqual(accepted,actor);self.assertIsNone(subject.erp_authority(req,accepted))
                    for patch in ({'capabilities':['erp.read','cashier.read']},{'access':'view','capabilities':['erp.read','erp.bill.review']},
                                  {'protocolVersion':3},{'capabilities':['erp.read','erp.read']}):
                        req=Request('/erp/api/bootstrap')
                        with self.subTest(patch=patch):self.reject(sign(req,claims(req,cashier=False,erp=True,**patch),b''))
                    req=Request('/erp/api/bootstrap');self.reject(sign(req,claims(req,cashier=False,erp=True),PREFIX))

                def test_P11_cashier_never_becomes_initialize_shutdown_or_finance_authority(self):
                    for path in ('/_xjy/initialize','/_xjy/shutdown','/erp/api/bootstrap','/erp/api/cashier-source-releases','/'):
                        for prefix in (PREFIX,b''):
                            req=Request(path)
                            with self.subTest(path=path,prefix=prefix):self.reject(sign(req,claims(req),prefix))

                def test_P12_legacy_principals_and_nonledger_process_cannot_enter_cashier(self):
                    for erp in (False,True):
                        for prefix in (b'',PREFIX):
                            req=Request()
                            with self.subTest(erp=erp,prefix=prefix):self.reject(sign(req,claims(req,cashier=False,erp=erp),prefix))
                    for module in ('cashier','inventory'):
                        req=Request()
                        with self.subTest(module=module):self.reject(sign(req,claims(req)),module=module)

                def source_request(self,revoke=False,**kwargs):
                    return Request('/erp/api/cashier-source-releases'+('/'+RELEASE+'/revoke' if revoke else ''),
                                   method=kwargs.pop('method','POST'),body=b'{}',
                                   endpoint=kwargs.pop('endpoint','cashier.source_revoke' if revoke else 'cashier.source_release'),**kwargs)

                def test_E13_finance_v2_manage_explicit_release_can_publish_and_revoke(self):
                    for revoke in (False,True):
                        req=self.source_request(revoke);actor=claims(req,cashier=False,erp=True,access='manage',capabilities=['erp.read','erp.cashier.release'])
                        with self.subTest(revoke=revoke):
                            accepted=self.accept(sign(req,actor,b''));self.assertIsNone(subject.erp_authority(req,accepted))

                def test_E14_source_release_rechecks_manage_explicit_capability_and_finance_identity(self):
                    for revoke in (False,True):
                        req=self.source_request(revoke)
                        actors=[claims(req),claims(req,cashier=False,erp=True,access='manage',capabilities=['erp.read']),
                                claims(req,cashier=False,erp=True,access='operate',capabilities=['erp.read','erp.cashier.release']),
                                claims(req,cashier=False,erp=True,access='view',capabilities=['erp.read','erp.cashier.release'])]
                        for actor in actors:
                            with self.subTest(revoke=revoke,access=actor['access'],module=actor['module']):
                                with self.assertRaises(ValueError):subject.erp_authority(req,actor)

                def test_E15_source_release_rejects_wrong_method_endpoint_query_and_content_type(self):
                    for revoke in (False,True):
                        for patch in ({'method':'GET'},{'endpoint':'erp.create'},{'query':b'x=1'},{'query':b'x=1&x=2'},{'content_type':'text/plain'}):
                            req=self.source_request(revoke,**patch);actor=claims(req,cashier=False,erp=True,access='manage',capabilities=['erp.read','erp.cashier.release'])
                            with self.subTest(revoke=revoke,patch=patch):
                                with self.assertRaises(ValueError):subject.erp_authority(req,actor)
            PrincipalContracts.__name__='CashierPrincipal_'+label
            PrincipalContracts.__qualname__=PrincipalContracts.__name__
            return PrincipalContracts
        suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(make_case(label,subject)))
    return suite
