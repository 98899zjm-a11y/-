"""Known ERP adapter: protected attachment bytes and original draft creator."""
import base64
from flask import current_app
from erp_common import transaction,one
from erp_values import ErpError,require
import erp_attachments
import erp_documents
import ocr

def _attachment(actor,aid,connection=None):
    if connection is None:target,metadata=erp_attachments.download(actor,aid)
    else:
        row=one(connection,'SELECT * FROM erp_attachments WHERE id=?',(aid,))
        if not row:raise ErpError('原图凭证不存在，不能生成采购草稿',404)
        erp_attachments.authorize_download(connection,actor,row)
        target,metadata=erp_attachments._file(row),erp_attachments._public(row)
    # The pure service re-hashes these exact bytes against immutable metadata.
    with target.open('rb')as source:body=source.read(2097153)
    return {**metadata,'body':body}
def _recognize(source):
    return ocr.call_broker({'version':1,'op':'recognize','mime':source['mime'],'sha256':source['sha256'],'bodyBase64':base64.b64encode(source['body']).decode('ascii')})
def configure(application):
    application.extensions['xjy_ocr_imports']=ocr.OcrImports(transaction=transaction,load_attachment=_attachment,recognize=_recognize,create_purchase=erp_documents.create_purchase)
def service():return current_app.extensions['xjy_ocr_imports']
def capability(actor):
    require(actor,'erp.read')
    try:
        result=ocr.call_broker({'version':1,'op':'probe'})
        return {'available':result.get('available')is True,'engine':'windows.media.ocr','language':result.get('language'),'confidence':None,'reason':''}
    except ocr.OcrError as error:return {'available':False,'engine':'windows.media.ocr','language':None,'confidence':None,'reason':str(error)}
