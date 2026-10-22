"""ERP endpoints use the original guarded finance service and signed actor.

No browser opens SQLite and no opaque legacy calculation is replaced here.
"""
import json
import sqlite3
from pathlib import Path
from flask import Blueprint, g, request, jsonify, render_template, send_file, current_app
from werkzeug.exceptions import BadRequest, RequestEntityTooLarge
from erp_values import ErpError, require, today
from erp_common import transaction, document as stored_document, public_document, bill_rows, has_sensitive
import erp_documents
import erp_suppliers
import erp_schema
import ocr

bp=Blueprint('erp',__name__)
STATIC={'erp.js','erp.css','app.css','workspace.css','xjy-theme.css','xjy-shell.js'}

def actor():
    return require(getattr(g,'_xjy_actor',None),'erp.read')

def body():
    if not request.is_json:raise ErpError('ERP操作须使用JSON对象。')
    value=request.get_json()
    if not isinstance(value,dict):raise ErpError('ERP正文须为对象。')
    return value

@bp.errorhandler(ErpError)
def invalid(exc):return jsonify(ok=False,error=str(exc)),exc.status

@bp.errorhandler(ocr.OcrError)
def invalid_ocr(exc):return jsonify(ok=False,error=str(exc)),exc.status

@bp.errorhandler(BadRequest)
def bad_json(exc):return jsonify(ok=False,error='请求格式无效。'),400

@bp.errorhandler(RequestEntityTooLarge)
def too_large(exc):return jsonify(ok=False,error='请求超过允许大小。'),413

@bp.errorhandler(sqlite3.IntegrityError)
def conflict(exc):return jsonify(ok=False,error='单据来源或请求重复，操作未提交，请刷新核对。'),409

@bp.errorhandler(sqlite3.OperationalError)
def unavailable(exc):
    current_app.logger.error('ERP database operation refused: %s',type(exc).__name__)
    return jsonify(ok=False,error='财务服务暂不可用，操作未提交，请稍后重试。'),503

@bp.get('/erp/')
def page():
    actor();return render_template('erp.html')

@bp.get('/erp/static/<name>')
def static(name):
    actor()
    if name not in STATIC:raise ErpError('ERP资源不存在。',404)
    return send_file(Path(__file__).parent/'app'/'static'/name,max_age=0)

@bp.get('/erp/api/bootstrap')
def bootstrap():
    user=actor()
    with transaction() as c:
        budget=c.execute('SELECT count(*) count,COALESCE(SUM(length(CAST(payload AS BLOB))*3+4096),0) bytes FROM erp_documents').fetchone()
        if budget['count']>50000 or budget['bytes']>20*1024*1024:raise ErpError('当前测试工作台超过完整加载范围，已停止返回以免静默遗漏；需要启用服务端分页。',413)
        rows=[public_document(c,dict(row),user) for row in c.execute('SELECT * FROM erp_documents ORDER BY created_at DESC,id DESC')]
        bills=bill_rows(c,user,today())
        for kind in ('receivable','payable'):
            if sum(row['balanceCents'] for row in bills if row['kind']==kind)>9007199254740991:raise ErpError('工作台合计超过安全显示精度，需要分组查询，已停止返回。',413)
        funds=[json.loads(row['payload']) for row in c.execute("SELECT payload FROM erp_documents WHERE kind='settlement' AND status='confirmed'")]
        accounts=sorted({row.get('account','') for row in funds if has_sensitive(user) or row.get('direction')=='receive'})
        return jsonify(ok=True,actor={'staffId':user['staffId'],'name':user['name'],'capabilities':user['capabilities']},parties=erp_suppliers.listing(c),documents=rows,bills=bills,accounts=[x for x in accounts if x],asOf=today())

@bp.route('/erp/api/parties',methods=['GET','POST'])
def parties():
    user=actor()
    if request.method=='POST':return jsonify(ok=True,party=erp_suppliers.save_supplier(user,body()))
    with transaction() as c:return jsonify(ok=True,parties=erp_suppliers.listing(c))

@bp.post('/erp/api/documents')
def create():return jsonify(ok=True,document=erp_documents.create_purchase(actor(),body()))

@bp.get('/erp/api/documents/<identifier>')
def document(identifier):
    user=actor()
    with transaction() as c:return jsonify(ok=True,document=public_document(c,stored_document(c,identifier),user,True))

@bp.patch('/erp/api/documents/<identifier>')
def update(identifier):return jsonify(ok=True,document=erp_documents.update_draft(actor(),identifier,body()))

@bp.post('/erp/api/documents/<identifier>/submit')
def submit(identifier):return jsonify(ok=True,document=erp_documents.submit(actor(),identifier,body()))

@bp.post('/erp/api/documents/<identifier>/review')
def review(identifier):return jsonify(ok=True,document=erp_documents.review(actor(),identifier,body()))

@bp.get('/erp/api/reports')
def reports():
    import erp_reports
    return jsonify(ok=True,report=erp_reports.report(actor(),request.args.to_dict()))

@bp.get('/erp/api/export.xlsx')
def export():
    import erp_reports
    user=actor();result=erp_reports.export(user,request.args.to_dict())
    return send_file(result,mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',as_attachment=True,download_name='XJY-ERP-'+today()+'.xlsx',max_age=0)

@bp.post('/erp/api/attachments')
def upload():
    import erp_attachments
    return jsonify(ok=True,attachment=erp_attachments.upload(actor(),body()))

@bp.get('/erp/api/attachments/<identifier>')
def download(identifier):
    import erp_attachments
    target,metadata=erp_attachments.download(actor(),identifier)
    return send_file(target,mimetype=metadata['mime'],as_attachment=True,download_name=metadata['name'],max_age=0)

@bp.get('/erp/api/ocr/capabilities')
def ocr_capabilities():
    import erp_ocr
    return jsonify(ok=True,ocr=erp_ocr.capability(actor()))

@bp.post('/erp/api/ocr/imports')
def ocr_import():
    import erp_ocr
    return jsonify(ok=True,job=erp_ocr.service().start(actor(),body()))

@bp.get('/erp/api/ocr/imports/<identifier>')
def ocr_get(identifier):
    import erp_ocr
    return jsonify(ok=True,job=erp_ocr.service().get(actor(),identifier))

@bp.post('/erp/api/ocr/imports/<identifier>/draft')
def ocr_draft(identifier):
    import erp_ocr
    return jsonify(ok=True,document=erp_ocr.service().save_draft(actor(),identifier,body()))

def configure(app):
    # Caller has already installed python_guard and checked owned data targets.
    with app.app_context(),transaction() as c:erp_schema.initialize(c)
    import erp_ocr
    erp_ocr.configure(app)
    app.register_blueprint(bp)
