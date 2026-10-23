"""Execute only the known pure ERP gate AST, never the sidecar/app entry."""
import ast,re,unittest,uuid
from pathlib import Path
source=Path(__file__).resolve().parent.parent/'project/desktop/legacy-source/ledger/sidecar.py'
tree=ast.parse(source.read_text('utf-8'));nodes=[]
for node in tree.body:
    if isinstance(node,ast.Assign)and any(isinstance(t,ast.Name)and t.id in ('ERP_READ_ENDPOINTS','ERP_STATIC_FILES','ERP_UUID')for t in node.targets):nodes.append(node)
    if isinstance(node,ast.FunctionDef)and node.name=='erp_authority':nodes.append(node)
namespace={'re':re};exec(compile(ast.Module(body=nodes,type_ignores=[]),str(source),'exec'),namespace)
class Args(dict):
    def getlist(self,key):return[self[key]]
class Request:
    def __init__(self,path,method,endpoint):self.path=path;self.method=method;self.endpoint=endpoint;self.args=Args();self.content_type='application/json'
def actor():return{'protocolVersion':2,'module':'ledger','access':'operate','capabilities':['erp.read','erp.purchase.prepare','erp.attachments.write','erp.reports.sensitive']}
class Tests(unittest.TestCase):
    def test_exact_ocr_routes_have_matching_endpoint_and_sensitive_live_prepare_scope(self):
        jid=str(uuid.uuid4())
        for path,method,endpoint in [('/erp/api/ocr/imports','POST','erp.ocr_import'),('/erp/api/ocr/imports/'+jid,'GET','erp.ocr_get'),('/erp/api/ocr/imports/'+jid+'/draft','POST','erp.ocr_draft')]:
            request=Request(path,method,endpoint);self.assertIsNone(namespace['erp_authority'](request,actor()))
            for removed in ['erp.purchase.prepare','erp.attachments.write','erp.reports.sensitive']:
                who=actor();who['capabilities'].remove(removed);self.assertRaises(ValueError,namespace['erp_authority'],request,who)
    def test_capabilities_read_has_no_cost_output_but_aliases_queries_and_endpoint_swaps_fail(self):
        who=actor();who['access']='view';who['capabilities']=['erp.read'];request=Request('/erp/api/ocr/capabilities','GET','erp.ocr_capabilities');self.assertIsNone(namespace['erp_authority'](request,who));request.args['actor']='admin';self.assertRaises(ValueError,namespace['erp_authority'],request,who)
        for request in [Request('/erp//api/ocr/imports','POST','erp.ocr_import'),Request('/erp/api/ocr/imports','POST','erp.create'),Request('/erp/api/ocr/imports/'+str(uuid.uuid4()),'DELETE','erp.ocr_get')]:self.assertRaises(ValueError,namespace['erp_authority'],request,actor())
if __name__=='__main__':unittest.main()
