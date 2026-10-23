"""Cashier Flask adapter. The signed sidecar gate supplies the exact actor.

Registration never binds legacy users/sessions and never opens a new database.
Bootstrap initializes schema explicitly inside the existing ledger transaction.
"""
import json
import sqlite3
from flask import Blueprint, g, jsonify, render_template, request
from cashier_engine import CashierError, create_engine, require, finance_authority
from cashier_restore import reject_restored_request


def _unique_object(pairs):
    result={}
    for key,value in pairs:
        if key in result:raise CashierError('JSON字段不可重复。')
        result[key]=value
    return result


def register(app, *, connect, reserve_number, clock, settlement_bridge=None, reversal_bridge=None):
    engine=create_engine(connect=connect,reserve_number=reserve_number,clock=clock,
                         settlement_bridge=settlement_bridge,reversal_bridge=reversal_bridge)
    blueprint=Blueprint('cashier',__name__)

    @blueprint.route('/cashier',methods=['GET'])
    @blueprint.route('/cashier/',methods=['GET'])
    def page():
        actor=getattr(g,'_xjy_cashier_actor',None)
        try:require(actor,'cashier.read')
        except CashierError as exc:return jsonify(ok=False,error=str(exc)),exc.status
        return render_template('cashier.html')

    def asset(filename):
        actor=getattr(g,'_xjy_cashier_actor',None)
        try:
            require(actor,'cashier.read')
            if request.method!='GET':raise CashierError('出纳资源仅接受GET请求。',405)
            if request.query_string or request.get_data(cache=True):raise CashierError('出纳资源不接受附加参数或正文。')
            return app.send_static_file(filename)
        except CashierError as exc:return jsonify(ok=False,error=str(exc)),exc.status

    @blueprint.route('/cashier/static/cashier.css',methods=['GET'],provide_automatic_options=False)
    def cashier_css():
        return asset('cashier.css')

    @blueprint.route('/cashier/static/cashier.js',methods=['GET'],provide_automatic_options=False)
    def cashier_js():
        return asset('cashier.js')

    def execute():
        is_finance=request.path.startswith('/erp/api/cashier-source-releases')
        actor=getattr(g,'_xjy_actor',None) if is_finance else getattr(g,'_xjy_cashier_actor',None)
        try:
            if is_finance:finance_authority(actor)
            else:require(actor,'cashier.read')
            if request.method=='GET':
                if request.get_data(cache=True):raise CashierError('GET请求不可携带正文。')
                body={}
            else:
                if request.mimetype!='application/json':raise CashierError('仅接受JSON请求。')
                raw=request.get_data(cache=True)
                if len(raw)>15*1024*1024:raise CashierError('请求超过允许大小。',413)
                try:body=json.loads(raw.decode('utf-8'),object_pairs_hook=_unique_object,
                                    parse_constant=lambda _: (_ for _ in ()).throw(CashierError('JSON数值无效。')))
                except (UnicodeError,json.JSONDecodeError):raise CashierError('JSON格式无效。') from None
            path=request.path+('?' + request.query_string.decode('ascii') if request.query_string else '')
            if not is_finance and request.method in ('POST','PATCH') and request.path!='/cashier/api/statement-imports/preview':
                # Sidecar already authenticated this exact actor and request.
                # This receipt-only read never starts a business write, and GET
                # keeps the original engine's single read-only connection.
                connection=connect()
                try:
                    connection.row_factory=sqlite3.Row
                    connection.execute('PRAGMA query_only=ON')
                    connection.execute('BEGIN')
                    reject_restored_request(connection,actor,request.method,path,body)
                finally:
                    try:
                        if connection.in_transaction:connection.rollback()
                    finally:connection.close()
            result=engine.dispatch(actor=actor,method=request.method,path=path,body=body)
            return jsonify(ok=True,**result)
        except (CashierError,ValueError) as exc:
            failure={'ok':False,'error':str(exc)}
            if getattr(exc,'code',None)=='CASHIER_RESTORED_UNFINISHED':failure['code']=exc.code
            return jsonify(**failure),getattr(exc,'status',400)

    # Exact route list; no wildcard bypass of legacy authentication hooks.
    routes=[
        ('/cashier/api/bootstrap',['GET']),('/cashier/api/accounts',['GET','POST']),
        ('/cashier/api/requests/<uuid:identifier>',['GET']),
        ('/cashier/api/accounts/<uuid:identifier>',['PATCH']),
        ('/cashier/api/accounts/<uuid:identifier>/scopes',['POST']),
        ('/cashier/api/documents',['GET','POST']),('/cashier/api/documents/<uuid:identifier>',['GET','PATCH']),
        ('/cashier/api/documents/<uuid:identifier>/submit',['POST']),
        ('/cashier/api/documents/<uuid:identifier>/withdraw',['POST']),
        ('/cashier/api/documents/<uuid:identifier>/review',['POST']),
        ('/cashier/api/sources',['GET']),('/cashier/api/postings',['GET']),
        ('/cashier/api/flows',['GET']),('/cashier/api/export.csv',['GET']),('/cashier/api/reports/daily',['GET']),
        ('/cashier/api/reports/balances',['GET']),('/cashier/api/reports/export',['GET']),
        ('/cashier/api/statement-imports',['GET','POST']),('/cashier/api/statement-imports/preview',['POST']),
        ('/cashier/api/statement-imports/<uuid:identifier>',['GET']),
        ('/cashier/api/statement-imports/<uuid:identifier>/original',['GET']),
        ('/cashier/api/reconciliations',['GET','POST']),
        ('/cashier/api/reconciliations/<uuid:identifier>/review',['POST']),
        ('/cashier/api/reconciliations/<uuid:identifier>/revoke',['POST']),
        ('/erp/api/cashier-source-releases',['POST']),
        ('/erp/api/cashier-source-releases/<uuid:identifier>/revoke',['POST']),
    ]
    for index,(route,methods) in enumerate(routes):
        endpoint = 'source_release' if route == '/erp/api/cashier-source-releases' else 'source_revoke' if route.startswith('/erp/api/cashier-source-releases/') else 'dispatch_' + str(index)
        blueprint.add_url_rule(route,endpoint,lambda **ignored:execute(),methods=methods)
    app.register_blueprint(blueprint)
    return engine
