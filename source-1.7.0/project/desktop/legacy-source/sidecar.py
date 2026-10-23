"""Managed loopback entry point; never launches browsers or initializes a database."""
import os as _stage_os
import sys as _stage_sys
from pathlib import Path as _StagePath
_stage_root = _stage_os.environ.get('XJY_STAGE1_ROOT', '')
if not _stage_root:
    raise RuntimeError('ISOLATION: this copy is test-only; use the restricted stage1 launcher')
_stage_sys.path.insert(0, str(_StagePath(_stage_root) / 'stage1'))
from python_guard import install as _install_stage_guard
_cashier_stage_guard = _install_stage_guard(_stage_root, require_restricted=True)
import argparse
import base64
import contextlib
import errno
import hashlib
import hmac
import json
import inspect
import os
from pathlib import Path
import sqlite3
import sys
import threading
import time
import secrets
import re

MODULE = os.environ.get('XJY_MODULE_ID', '')
DEFINITIONS = {
    'ledger': ('LEDGER_DATA', 'ledger.db', '1.3.0', {'users', 'sales', 'stock_items', 'material_stock', 'settings'}),
    'inventory': ('STOCKCHECK_DATA', 'stockcheck.db', '1.9.0', {'users', 'skus', 'stock_moves', 'count_sessions', 'settings'}),
}

# Endpoint names are resolved by Flask, not inferred from a path or GET method.
# Unknown endpoints and unexpected parameters fail closed for read-only grants.
READ_ENDPOINTS = {
    'ledger': {
        'algorithm_approval.page': '', 'algorithm_approval.listing': '',
        'static': '', 'home.index': 'month', 'sales.index': 's e staff channel status edit',
        'sales.export': 's e staff channel status', 'stock.index': 'state cat sup kw',
        'stock.export': 'state cat sup kw', 'material.index': 's e supplier all',
        'material.export': 's e supplier all', 'master.index': '', 'sheet.index': '',
        'sheet.view': 'kw blank', 'sheet.material': '', 'sheet.export': 'kw',
        'sheet.material_export': '', 'source.index': 'doc', 'source.compare': '',
        'enhanced.overview': 'month', 'enhanced.rule_page': 'domain id',
        'enhanced.calculate_api': 'domain id date staff channel status note snapshot _annotation_draft weight sell_gram_price labor received cost spread template product amount amount_c profit cost_gram_price gross_rate comm_cost comm comm_profit current_rules ticket allowance personal base day_rate days percent gram_rate overtime_hours overtime_rate bonus deductions social tax mode 克数 单价 工费 售价 成本 克重 票据金额 补贴 个人承担 底薪 日薪 出勤天数 提成比例 每克提成 加班小时 加班单价 奖金 扣款 社保 个税 计薪方式 销售金额 销售利润 销售克重 原提成 工资报销',
        'enhanced.source_page': 'doc', 'enhanced.reconcile': 'export', 'enhanced.provenance': '',
        'finance.payroll': 'employee month', 'finance.payroll_export': 'month',
        'finance.expenses': 's e employee category status payout edit', 'finance.expense_receipt': '',
        'finance.expenses_export': 's e employee category status payout',
        'workbooks.choose': '', 'workbooks.page': 'sheet row col', 'workbooks.data': 'sheet start count col cols kw field op linked',
        'workbooks.history': 'detail after', 'workbooks.revision': '', 'workbooks.export': 'format sheet',
        'transfer.index': 'doc', 'external_sync.page': 'doc',
        'bundled_source.download': '', 'bundled_source.preview': 'sheet start',
        'inventory_dashboard.live': 'month',
        'annotations.listing': 'scope doc sheet start end table record path form', 'annotations.entry': 'context',
    },
    'inventory': {
        'static': '', 'home.index': '', 'stock.book_list': '', 'stock.book_detail': 'q c',
        'stock.book_export': '', 'stock.sku_list': 'id ret c nocat q page size code active',
        'stock.sku_detail': '', 'stock.sku_export': 'c q ret nocat', 'stock.sku_ledger_export': '', 'stock.sku_template': '',
        'count.session_list': 'q status page size', 'count.session_detail': '', 'count.session_print': 'filter sort blind mode',
        'count.session_sheet_xlsx': 'filter sort blind mode', 'count.session_entry': 'tab q filter',
        'count.session_mobile': '', 'count.session_mobile_find': 'q code', 'count.api_lookup': 'q code',
        'moves.move_list': 'c q code dir user start end s e page size', 'moves.move_stock': 'code', 'moves.move_export': 'c q code dir user start end s e',
        'materials.material_list': 'tab c mq code category unit page size q start end s e direction',
        'materials.material_export_list': 'q c code category unit', 'materials.material_export_moves': 'q c code start end s e direction',
        'review.diff_list': 'q type rstatus sort all page size', 'review.diff_export': 'q type rstatus sort all',
        'review.adjustment_list': 'q status page size', 'review.adjustment_detail': '', 'review.adjustment_export': '',
        'report.index': 'r range since', 'pricing.index': '',
        'stock.excel_preview': 'page q', 'stock.excel_download': '', 'stock.excel_page': '',
        'home.dashboard_data': '', 'report.metal_page': '', 'report.metal_export': '', 'report.metal_data': '',
        'materials.material_lookup': 'code',
    },
}
REPORT_KEYS = 'configured title all_time start end domain details sales_scope payroll_scope expense_scope sales_metric sales_group stock_metric stock_group material_metric material_group payroll_metric payroll_group expenses_metric expenses_group platinum_metric platinum_group'
for endpoint in ('reports.index', 'reports.print_view', 'reports.download_pdf'):
    READ_ENDPOINTS['ledger'][endpoint] = REPORT_KEYS
for module_name in ('ledger', 'inventory'):
    READ_ENDPOINTS[module_name]['xjy_collaboration_page'] = ''
PRIMARY_ONLY = {'auth.users', 'auth.user_new', 'auth.user_update', 'auth.user_reset',
                'auth.users_bulk_new', 'auth.users_reset_all', 'auth.logs', 'auth.entry_page', 'master.users'}
BLOCKED_AUTH = {'auth.login', 'auth.logout', 'auth.password'}
MANAGE_ONLY = {'master.index', 'enhanced.rule_page', 'enhanced.recalculate', 'source.upload',
               'enhanced.source_upload', 'enhanced.source_import', 'external_sync.enable',
               'external_sync.pause', 'external_sync.resolve', 'bundled_source.import_book',
               'stock.book_import_upload', 'stock.book_import_map', 'stock.book_activate', 'stock.book_delete'}

ERP_LEVELS = ('disabled', 'view', 'operate', 'manage')
ERP_CAPABILITIES = {
    'erp.read': 'view', 'erp.parties.manage': 'operate',
    'erp.purchase.prepare': 'operate', 'erp.purchase.review': 'manage',
    'erp.receipt.prepare': 'operate', 'erp.receipt.review': 'manage',
    'erp.bill.prepare': 'operate', 'erp.bill.review': 'manage',
    'erp.settlement.prepare': 'operate', 'erp.settlement.review': 'manage',
    'erp.reversal.prepare': 'operate', 'erp.reversal.review': 'manage',
    'erp.reports.view': 'view', 'erp.reports.sensitive': 'view',
    'erp.attachments.write': 'operate', 'erp.cashier.release': 'manage',
}
ERP_READ_ENDPOINTS = {
    'erp.page': '', 'erp.static': '', 'erp.bootstrap': '', 'erp.parties': '',
    'erp.document': '', 'erp.download': '',
    'erp.ocr_capabilities': '', 'erp.ocr_get': '',
    'erp.reports': 'asOf from to partyId kind status creatorId',
    'erp.export': 'asOf from to partyId kind status creatorId',
}
ERP_STATIC_FILES = {'erp.js', 'erp.css', 'app.css', 'workspace.css', 'xjy-theme.css', 'xjy-shell.js'}
ERP_UUID = r'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'

def erp_authority(request, actor):
    """Pure request-level gate; stored document/target authority is checked by ERP."""
    if actor.get('protocolVersion') != 2 or actor.get('module') != 'ledger':
        raise ValueError('ERP requires signed version 2 finance authority')
    capabilities = set(actor['capabilities'])
    if 'erp.read' not in capabilities:
        raise ValueError('ERP read capability is required')
    path, method, endpoint = request.path, request.method, request.endpoint
    allowed = None
    if path == '/erp/' and method == 'GET': allowed = 'erp.page'
    elif path.startswith('/erp/static/') and path.removeprefix('/erp/static/') in ERP_STATIC_FILES and method == 'GET': allowed = 'erp.static'
    elif path == '/erp/api/bootstrap' and method == 'GET': allowed = 'erp.bootstrap'
    elif path == '/erp/api/parties' and method in ('GET', 'POST'):
        allowed = 'erp.parties'
        if method == 'POST' and 'erp.parties.manage' not in capabilities: raise ValueError('ERP party capability is required')
    elif path == '/erp/api/documents' and method == 'POST': allowed = 'erp.create'
    elif re.fullmatch('/erp/api/documents/' + ERP_UUID, path) and method in ('GET', 'PATCH'):
        allowed = 'erp.document' if method == 'GET' else 'erp.update'
    elif re.fullmatch('/erp/api/documents/' + ERP_UUID + '/submit', path) and method == 'POST': allowed = 'erp.submit'
    elif re.fullmatch('/erp/api/documents/' + ERP_UUID + '/review', path) and method == 'POST': allowed = 'erp.review'
    elif path in ('/erp/api/reports', '/erp/api/export.xlsx') and method == 'GET':
        allowed = 'erp.reports' if path.endswith('reports') else 'erp.export'
        if 'erp.reports.view' not in capabilities: raise ValueError('ERP report capability is required')
    elif path == '/erp/api/attachments' and method == 'POST':
        allowed = 'erp.upload'
        if 'erp.attachments.write' not in capabilities: raise ValueError('ERP attachment write capability is required')
    elif re.fullmatch('/erp/api/attachments/' + ERP_UUID, path) and method == 'GET': allowed = 'erp.download'
    elif path == '/erp/api/ocr/capabilities' and method == 'GET': allowed = 'erp.ocr_capabilities'
    elif path == '/erp/api/ocr/imports' and method == 'POST': allowed = 'erp.ocr_import'
    elif re.fullmatch('/erp/api/ocr/imports/' + ERP_UUID, path) and method == 'GET': allowed = 'erp.ocr_get'
    elif re.fullmatch('/erp/api/ocr/imports/' + ERP_UUID + '/draft', path) and method == 'POST': allowed = 'erp.ocr_draft'
    elif path == '/erp/api/cashier-source-releases' and method == 'POST': allowed = 'cashier.source_release'
    elif re.fullmatch('/erp/api/cashier-source-releases/' + ERP_UUID + '/revoke', path) and method == 'POST': allowed = 'cashier.source_revoke'
    if allowed in ('cashier.source_release', 'cashier.source_revoke'):
        if actor.get('access') != 'manage' or 'erp.cashier.release' not in capabilities:
            raise ValueError('Finance source publication requires explicit management authority')
    if allowed in ('erp.ocr_import','erp.ocr_get','erp.ocr_draft'):
        if actor.get('access') not in ('operate','manage') or not {'erp.purchase.prepare','erp.attachments.write','erp.reports.sensitive'}.issubset(capabilities):
            raise ValueError('Purchase OCR requires current prepare/upload/sensitive capability')
    if not allowed or endpoint != allowed:
        raise ValueError('ERP endpoint does not match its canonical allowlist')
    parameters = set(ERP_READ_ENDPOINTS.get(endpoint, '').split())
    if set(request.args) - parameters or any(len(request.args.getlist(key)) != 1 for key in request.args):
        raise ValueError('ERP query parameters are invalid')
    if method != 'GET':
        if request.content_type != 'application/json': raise ValueError('ERP writes require JSON')
        if endpoint in ('erp.create', 'erp.update', 'erp.submit', 'erp.review'):
            stage = 'review' if endpoint == 'erp.review' else 'prepare'
            if not any('erp.' + name + '.' + stage in capabilities for name in ('purchase', 'receipt', 'bill', 'settlement', 'reversal')):
                raise ValueError('ERP document capability is required')
    return None

def principal_actor(token, module, request, consumed, replay_lock, clock=time.time):
    encoded = request.headers.get('X-XJY-Principal', '')
    signature = request.headers.get('X-XJY-Principal-Signature', '')
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,8192}', encoded) or not re.fullmatch(r'[a-f0-9]{64}', signature):
        raise ValueError('Missing primary-account authority')
    is_cashier = request.path == '/cashier' or request.path.startswith('/cashier/')
    domain = b'xjy-cashier-principal-v1\0' if is_cashier else b''
    expected = hmac.new(token.encode(), domain + encoded.encode('ascii'), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise ValueError('Invalid primary-account signature')
    raw = base64.urlsafe_b64decode(encoded + '=' * (-len(encoded) % 4))
    actor = json.loads(raw)
    keys = {'v', 'module', 'staffId', 'userId', 'name', 'role', 'access', 'grantRevision', 'issuedAt',
            'expiresAt', 'nonce', 'method', 'decodedPath', 'query', 'bodySha256'}
    is_erp = request.path == '/erp' or request.path.startswith('/erp/')
    if is_erp:
        keys |= {'protocolVersion', 'capabilities'}
    if is_cashier:
        keys |= {'protocolVersion', 'capabilities', 'authorityModule', 'storageModule'}
    expected_module = 'cashier' if is_cashier else module
    if not isinstance(actor, dict) or set(actor) != keys or type(actor['v']) is not int or actor['v'] != 1 or actor['module'] != expected_module:
        raise ValueError('Invalid primary-account audience')
    if actor['role'] not in ('admin', 'employee') or actor['access'] not in ('view', 'operate', 'manage'):
        raise ValueError('Primary-account access denied')
    if actor['role'] == 'admin' and actor['access'] != 'manage':
        raise ValueError('Invalid administrator authority')
    if is_cashier:
        if module != 'ledger' or type(actor['protocolVersion']) is not int or actor['protocolVersion'] != 3:
            raise ValueError('Cashier requires signed independent version 3 authority')
        from cashier_engine import require
        require(actor, 'cashier.read')
    if is_erp:
        capabilities = actor['capabilities']
        if module != 'ledger' or type(actor['protocolVersion']) is not int or actor['protocolVersion'] != 2 or not isinstance(capabilities, list) or len(capabilities) > len(ERP_CAPABILITIES):
            raise ValueError('ERP requires signed version 2 authority')
        if any(not isinstance(key, str) or key not in ERP_CAPABILITIES for key in capabilities) or len(set(capabilities)) != len(capabilities) or 'erp.read' not in capabilities:
            raise ValueError('Invalid ERP capabilities')
        if any(ERP_LEVELS.index(actor['access']) < ERP_LEVELS.index(ERP_CAPABILITIES[key]) for key in capabilities):
            raise ValueError('ERP capabilities exceed module authority')
    for key in ('staffId', 'userId'):
        if not isinstance(actor[key], str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', actor[key]):
            raise ValueError('Invalid primary-account identifier')
    if not isinstance(actor['name'], str) or not actor['name'].strip() or len(actor['name']) > 100 or re.search(r'[\x00-\x1f\x7f]', actor['name']):
        raise ValueError('Invalid primary-account name')
    if type(actor['grantRevision']) is not int or actor['grantRevision'] < 0:
        raise ValueError('Invalid grant revision')
    if any(type(actor[k]) is not int for k in ('issuedAt', 'expiresAt')) or not 0 < actor['expiresAt'] - actor['issuedAt'] <= 30000:
        raise ValueError('Invalid authority lifetime')
    now = int(clock() * 1000)
    if actor['issuedAt'] > now + 2000 or actor['expiresAt'] <= now or actor['issuedAt'] < now - 30000:
        raise ValueError('Expired primary-account authority')
    if actor['method'] != request.method or actor['decodedPath'] != request.path or actor['query'] != request.query_string.decode('ascii'):
        raise ValueError('Request does not match its authority')
    if actor['bodySha256'] != hashlib.sha256(request.get_data(cache=True)).hexdigest():
        raise ValueError('Request body does not match its authority')
    if not isinstance(actor['nonce'], str) or not re.fullmatch(r'[a-f0-9-]{36}', actor['nonce']):
        raise ValueError('Invalid authority nonce')
    with replay_lock:
        for nonce, expiry in list(consumed.items()):
            if expiry <= now:
                del consumed[nonce]
        if actor['nonce'] in consumed or len(consumed) >= 4096:
            raise ValueError('Replayed authority or authority capacity exceeded')
        consumed[actor['nonce']] = actor['expiresAt']
    return actor

def bind_primary_account(module, actor, directory):
    from werkzeug.security import generate_password_hash
    filename = DEFINITIONS[module][1]
    with contextlib.closing(sqlite3.connect(str(Path(directory) / filename), timeout=30)) as connection, connection:
        connection.row_factory = sqlite3.Row
        connection.execute('BEGIN IMMEDIATE')
        connection.execute('CREATE TABLE IF NOT EXISTS xjy_primary_users(staff_id TEXT PRIMARY KEY, legacy_user_id INTEGER UNIQUE NOT NULL)')
        mapped = connection.execute('SELECT legacy_user_id FROM xjy_primary_users WHERE staff_id=?', (actor['staffId'],)).fetchone()
        role = {'ledger': {'view': 'viewer', 'operate': 'bookkeeper', 'manage': 'admin'},
                'inventory': {'view': 'reviewer', 'operate': 'reviewer', 'manage': 'admin'}}[module][actor['access']]
        if mapped:
            user = connection.execute('SELECT * FROM users WHERE id=?', (mapped[0],)).fetchone()
            if not user:
                raise RuntimeError('Primary-account mapping is incomplete')
            if user['role'] != role or user['display_name'] != actor['name'] or not user['active'] or user['must_change_pw']:
                connection.execute('UPDATE users SET role=?,display_name=?,active=1,must_change_pw=0 WHERE id=?', (role, actor['name'], user['id']))
        else:
            username = 'xjy_' + actor['staffId']
            if connection.execute('SELECT 1 FROM users WHERE username=?', (username,)).fetchone():
                username += '_' + secrets.token_hex(6)
            cursor = connection.execute('INSERT INTO users(username,display_name,password_hash,role,active,must_change_pw,created_at) VALUES(?,?,?,?,1,0,?)',
                                        (username, actor['name'], generate_password_hash(secrets.token_urlsafe(48)), role, time.strftime('%Y-%m-%d %H:%M:%S')))
            connection.execute('INSERT INTO xjy_primary_users VALUES(?,?)', (actor['staffId'], cursor.lastrowid))
            mapped = (cursor.lastrowid,)
        return connection.execute('SELECT * FROM users WHERE id=?', (mapped[0],)).fetchone()

def install_primary_gate(application, module, token, directory, stopping):
    from flask import request, jsonify, session, g, has_request_context, abort
    consumed, replay_lock = {}, threading.Lock()
    application.config.update(MAX_CONTENT_LENGTH=48*1024*1024, SESSION_COOKIE_NAME='xjy_' + module + '_session',
                              SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE='Lax')
    # Read-only authority also constrains nested helpers/connections, so an
    # ostensibly read endpoint cannot commit a hidden historical recalculation.
    original_connect = sqlite3.connect
    def guarded_connect(*args, **kwargs):
        connection = original_connect(*args, **kwargs)
        cash_read = has_request_context() and bool(getattr(g, '_xjy_cashier_actor', None)) and (request.method in ('GET', 'HEAD') or getattr(g, '_xjy_cashier_actor', {}).get('access') == 'view' or request.path == '/cashier/api/statement-imports/preview')
        if cash_read or (has_request_context() and getattr(g, '_xjy_actor', {}).get('access') == 'view'):
            writes = {sqlite3.SQLITE_INSERT, sqlite3.SQLITE_UPDATE, sqlite3.SQLITE_DELETE,
                      sqlite3.SQLITE_CREATE_TABLE, sqlite3.SQLITE_DROP_TABLE, sqlite3.SQLITE_ALTER_TABLE,
                      sqlite3.SQLITE_CREATE_INDEX, sqlite3.SQLITE_DROP_INDEX, sqlite3.SQLITE_ATTACH,
                      sqlite3.SQLITE_DETACH, sqlite3.SQLITE_CREATE_TRIGGER, sqlite3.SQLITE_DROP_TRIGGER,
                      sqlite3.SQLITE_CREATE_VIEW, sqlite3.SQLITE_DROP_VIEW, sqlite3.SQLITE_CREATE_VTABLE,
                      sqlite3.SQLITE_DROP_VTABLE, sqlite3.SQLITE_REINDEX, sqlite3.SQLITE_ANALYZE}
            def authorize(action, name, arg, dbname, source):
                if action in writes and not (not cash_read and action == sqlite3.SQLITE_INSERT and name == 'audit_logs'):
                    g._xjy_denied_write = True
                    return sqlite3.SQLITE_DENY
                return sqlite3.SQLITE_OK
            connection.set_authorizer(authorize)
        return connection
    sqlite3.connect = guarded_connect
    def gate():
        if not hmac.compare_digest(request.headers.get('X-XJY-Module-Token', ''), token) or request.remote_addr != '127.0.0.1':
            return jsonify(error='仅允许主程序的本机受控连接。'), 403
        if request.path in ('/_xjy/health', '/_xjy/shutdown'):
            return None
        if stopping.is_set():
            return jsonify(error='业务模块正在关闭。'), 503
        try:
            actor = principal_actor(token, module, request, consumed, replay_lock)
        except (ValueError, TypeError, KeyError, UnicodeError, json.JSONDecodeError):
            return jsonify(error='主账号验证失效，请重新进入模块。'), 403
        endpoint = request.endpoint
        if request.path == '/cashier' or request.path.startswith('/cashier/'):
            if module != 'ledger' or not isinstance(endpoint, str) or not endpoint.startswith('cashier.') or request.method not in ('GET', 'POST', 'PATCH'):
                return jsonify(ok=False, error='出纳请求地址或方法无效。'), 403
            # No legacy login, user binding, account creation or session sharing.
            g._xjy_cashier_actor = actor
            g._xjy_denied_write = False
            g._xjy_initial_flashes = []
            return None
        is_erp = request.path == '/erp' or request.path.startswith('/erp/')
        if is_erp:
            try:
                erp_authority(request, actor)
            except (ValueError, TypeError, KeyError):
                return jsonify(ok=False, error='财务 ERP 权限或请求地址无效。'), 403
        if endpoint in BLOCKED_AUTH:
            return jsonify(error='请使用主程序账号登录和修改密码，旧模块账号不可直接登录。'), 403
        if endpoint in PRIMARY_ONLY and actor['role'] != 'admin':
            return jsonify(error='只有主程序管理员可以管理账号和权限。'), 403
        if endpoint in MANAGE_ONLY and request.method not in ('GET', 'HEAD') and actor['access'] != 'manage':
            return jsonify(error='此操作需要模块管理权限。'), 403
        if actor['access'] == 'view':
            allowed = ERP_READ_ENDPOINTS.get(endpoint) if is_erp else READ_ENDPOINTS[module].get(endpoint)
            if request.method not in ('GET', 'HEAD') or allowed is None or set(request.args) - set(allowed.split()):
                return jsonify(error='当前为只读权限，此页面或操作不允许执行。'), 403
            if request.path.endswith('/') and request.path not in ('/', '/erp/'):
                return jsonify(error='请使用规范的模块页面地址。'), 403
            if endpoint == 'annotations.entry':
                try:
                    context = json.loads(request.args.get('context', '{}'))
                    if not isinstance(context, dict) or set(context) - {'scope', 'doc', 'sheet', 'row', 'col', 'table', 'record', 'path', 'form', 'field'}:
                        raise ValueError('Invalid annotation context')
                except (ValueError, TypeError):
                    return jsonify(error='只读批注参数无效。'), 403
        if endpoint in ('xjy_collaboration_source', 'cashier.source_release', 'cashier.source_revoke'):
            # Dedicated trusted export needs authority, never an old-app login.
            # Do not create/update users, mappings or a legacy session while
            # reading the immutable business snapshot.
            g._xjy_actor = actor
            g._xjy_denied_write = False
            g._xjy_initial_flashes = []
            return None
        user = bind_primary_account(module, actor, directory)
        if session.get('uid') != user['id']:
            session.clear()
        session['uid'] = user['id']
        g._user = user
        g._xjy_actor = actor
        g._xjy_denied_write = False
        g._xjy_initial_flashes = list(session.get('_flashes', []))
    original_hooks = application.before_request_funcs.get(None, [])
    application.before_request_funcs[None] = [gate] + [
        (lambda hook: lambda: None if request.path in ('/_xjy/health', '/_xjy/shutdown', '/xjy/collaboration/source') or getattr(g, '_xjy_cashier_actor', None) is not None or request.endpoint in ('cashier.source_release', 'cashier.source_revoke') or
         (getattr(g, '_xjy_actor', {}).get('access') == 'view' and hook.__name__ == '_auto_backup') else hook())(hook)
        for hook in original_hooks
    ]
    # Original inventory restricts even several harmless exports to its local
    # admin role. The audited read endpoints use primary ACL while retaining
    # the original handler, SQL read-only guard, and all non-view role checks.
    for endpoint in READ_ENDPOINTS[module]:
        original = application.view_functions.get(endpoint)
        if original is None or endpoint == 'static':
            continue
        def primary_read(*args, _original=original, **kwargs):
            handler = inspect.unwrap(_original) if getattr(g, '_xjy_actor', {}).get('access') == 'view' else _original
            return handler(*args, **kwargs)
        application.view_functions[endpoint] = primary_read
    @application.after_request
    def outcome(response):
        if getattr(g, '_xjy_denied_write', False):
            rejected = jsonify(error='此预览需要初始化工作副本，请由有管理权限的员工先打开；原账目没有改动。')
            rejected.status_code = 403
            rejected.headers['X-XJY-Outcome'] = 'rejected'
            return rejected
        if response.status_code >= 400:
            response.headers['X-XJY-Outcome'] = 'rejected'
        elif request.method in ('POST', 'PUT', 'PATCH', 'DELETE'):
            # Original handlers flash validation failures and redirect with 302.
            # A success+error combination denotes saved business plus follow-up
            # warning (for example Excel synchronization), never a false failure.
            from flask.ctx import _cv_request
            flashes = list(_cv_request.get().flashes or session.get('_flashes', []))
            old = getattr(g, '_xjy_initial_flashes', [])
            if flashes[:len(old)] == old:
                flashes = flashes[len(old):]
            categories = [category for category, message in flashes]
            data = response.get_json(silent=True) if response.is_json else None
            rejected = isinstance(data, dict) and data.get('ok') is False
            accepted = (isinstance(data, dict) and data.get('ok') is True) or any(category in ('ok', 'success') for category in categories)
            response.headers['X-XJY-Outcome'] = 'warning' if 'error' in categories and accepted else 'rejected' if 'error' in categories or rejected else 'success' if accepted else 'warning'
        return response
    return gate

def validate_data(module):
    environment, filename, _, required = DEFINITIONS[module]
    configured = os.environ.get(environment, '')
    if not configured or not Path(configured).is_absolute():
        raise RuntimeError('An explicit existing module data directory is required.')
    directory = Path(configured)
    # The parent performs the same checks before spawning. Reject links here too,
    # before original create_app can create a new empty database/default account.
    for entry in [directory, *directory.parents]:
        if entry.is_symlink() or (hasattr(entry, 'is_junction') and entry.is_junction()):
            raise RuntimeError('Module data paths cannot contain symbolic links or junctions.')
    database = directory / filename
    secret = directory / 'secret.key'
    if not directory.is_dir() or not database.is_file() or not secret.is_file():
        raise RuntimeError('The existing database and session key are both required.')
    if database.is_symlink() or secret.is_symlink():
        raise RuntimeError('Module data files must be regular files.')
    if not secret.read_text(encoding='utf-8').strip():
        raise RuntimeError('The existing session key is empty.')
    connection = sqlite3.connect(database)
    connection.execute('PRAGMA query_only=ON')
    try:
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not required.issubset(tables):
            raise RuntimeError('The selected database belongs to another application.')
        if not connection.execute('SELECT 1 FROM users LIMIT 1').fetchone():
            raise RuntimeError('The selected database has no existing module accounts.')
    finally:
        connection.close()
    return os.path.normcase(os.path.abspath(directory))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--module', choices=DEFINITIONS, required=True)
    parser.add_argument('--host', choices=['127.0.0.1'], default='127.0.0.1')
    parser.add_argument('--port', type=int)
    parser.add_argument('--initialize-only', action='store_true')
    parser.add_argument('--cashier-maintenance', choices=('merge', 'verify', 'verify-rollback'))
    arguments = parser.parse_args()
    if not arguments.initialize_only and not arguments.cashier_maintenance and (arguments.port is None or not 1024 <= arguments.port <= 65535):
        raise RuntimeError('An unprivileged loopback port is required.')
    token = os.environ.get('XJY_MODULE_TOKEN', '')
    if len(token) < 32 or len(token) > 256 or any(c not in 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_' for c in token):
        raise RuntimeError('A valid private startup token is required.')
    if arguments.cashier_maintenance:
        if arguments.module != 'ledger' or arguments.initialize_only or arguments.port is not None:
            raise RuntimeError('Maintenance cannot initialize data or open an HTTP listener')
        from cashier_maintenance import run
        return run(arguments.cashier_maintenance, stage_guard=_cashier_stage_guard)
    if arguments.initialize_only:
        configured = os.environ.get(DEFINITIONS[arguments.module][0], '')
        directory = Path(configured)
        if not configured or not directory.is_absolute() or not directory.is_dir() or any(directory.iterdir()):
            raise RuntimeError('Initialization requires an explicit empty staging directory')
        for entry in (directory, *directory.parents):
            if entry.is_symlink() or (hasattr(entry, 'is_junction') and entry.is_junction()):
                raise RuntimeError('Initialization paths cannot contain links')
        class InitializationRequest:
            method = 'INIT'
            path = '/_xjy/initialize'
            query_string = b''
            headers = {'X-XJY-Principal': os.environ.get('XJY_INITIAL_PRINCIPAL', ''),
                       'X-XJY-Principal-Signature': os.environ.get('XJY_INITIAL_SIGNATURE', '')}
            def get_data(self, cache=True): return b''
        actor = principal_actor(token, arguments.module, InitializationRequest(), {}, threading.Lock())
        if actor['role'] != 'admin' or actor['access'] != 'manage':
            raise RuntimeError('Only a primary administrator may initialize module data')
        os.environ['LEDGER_DISABLE_BACKUP_THREAD'] = '1'
        os.environ['LEDGER_DISABLE_EXTERNAL_THREAD'] = '1'
        if arguments.module == 'ledger':
            from repairs import install
            install()
        from app import create_app
        application = create_app()
        if arguments.module == 'ledger':
            import erp
            erp.configure(application)
            import cashier_runtime
            cashier_runtime.configure(application)
        from werkzeug.security import generate_password_hash
        with contextlib.closing(sqlite3.connect(directory / DEFINITIONS[arguments.module][1])) as connection, connection:
            connection.execute('UPDATE users SET active=0,password_hash=?,must_change_pw=0',
                               (generate_password_hash(secrets.token_urlsafe(48)),))
        bind_primary_account(arguments.module, actor, str(directory))
        validate_data(arguments.module)
        return 0
    data_identity = validate_data(arguments.module)
    stopping = threading.Event()
    shutdown_drained = threading.Event()
    background_threads = []
    pending_backup = threading.Event()
    enable_backup = False
    if arguments.module == 'ledger':
        from repairs import install
        install()
        import repairs
        import external_sync
        # The original worker's current synchronization logic is retained. A
        # stop event changes only the idle loop and lets in-flight files finish.
        def cooperative_external_worker(app):
            background_threads.append(threading.current_thread())
            while not stopping.is_set():
                try:
                    with app.app_context(), app.test_request_context('/__external_excel_worker'):
                        documents = external_sync.db.query('SELECT document_id FROM external_workbook_sync WHERE enabled=1')
                        for item in documents:
                            if stopping.is_set():
                                break
                            try:
                                external_sync.synchronize(item['document_id'])
                            except Exception:
                                app.logger.exception('External Excel synchronization failed')
                except Exception:
                    app.logger.exception('External Excel worker failed')
                stopping.wait(2)
        external_sync.worker = cooperative_external_worker
        enable_backup = not os.environ.get('LEDGER_DISABLE_BACKUP_THREAD')
        if enable_backup:
            os.environ['LEDGER_DISABLE_BACKUP_THREAD'] = '1'
    from app import create_app
    from flask import request, jsonify
    from waitress import create_server
    application = create_app()
    if arguments.module == 'inventory':
        from inventory_report_window import install_report_window
        install_report_window(application)
    if arguments.module == 'ledger':
        import algorithm_approval
        algorithm_approval.configure(application)
        import erp
        erp.configure(application)
        import cashier_runtime
        cashier_runtime.configure(application)
    if enable_backup:
        os.environ.pop('LEDGER_DISABLE_BACKUP_THREAD', None)
        def cooperative_backup_worker():
            while not stopping.is_set():
                pending_backup.wait(60)
                pending_backup.clear()
                if stopping.is_set():
                    break
                repairs.run_backup(application)
        backup_thread = threading.Thread(target=cooperative_backup_worker, name='daily-backup', daemon=True)
        background_threads.append(backup_thread)
        backup_thread.start()
        @application.after_request
        def schedule_backup(response):
            if request.method == 'POST' and response.status_code < 400 and not request.path.startswith('/_xjy/'):
                pending_backup.set()
            return response
    from collaboration import install_collaboration
    install_collaboration(application, arguments.module, token, data_identity, DEFINITIONS[arguments.module][2])
    install_primary_gate(application, arguments.module, token, data_identity, stopping)

    def health():
        return jsonify(module=arguments.module, version=DEFINITIONS[arguments.module][2],
                       nonce=token, instance=hashlib.sha256(data_identity.encode('utf-8')).hexdigest())
    application.add_url_rule('/_xjy/health', endpoint='_xjy_health', view_func=health, methods=['GET'])
    activity = threading.Condition()
    active_requests = [0]
    shutdown_started = [False]
    server_holder = []
    def shutdown_worker():
        pending_backup.set()
        deadline = time.monotonic() + 20
        with activity:
            while active_requests[0] and time.monotonic() < deadline:
                activity.wait(0.1)
        for thread in list(background_threads):
            thread.join(max(0, deadline - time.monotonic()))
        if active_requests[0] or any(thread.is_alive() for thread in background_threads):
            # The supervisor owns timeout escalation; do not close SQLite/files
            # under a request which is still writing.
            return
        server = server_holder[0]
        server.task_dispatcher.shutdown(cancel_pending=False, timeout=5)
        # WSGI iteration can finish before Waitress flushes the socket. Keep the
        # loop alive until response buffers drain so downloads/POST replies are
        # not truncated merely because the application work has completed.
        def output_pending():
            return any(channel.requests or channel.total_outbufs_len
                       for channel in list(server.active_channels.values()))
        while output_pending() and time.monotonic() < deadline:
            time.sleep(0.05)
        if output_pending():
            return
        # Only after business requests, background work and outgoing response
        # buffers have drained can Windows select's concurrent socket-close
        # error represent a completed shutdown rather than a startup failure.
        shutdown_drained.set()
        for channel in list(server._map.values()):
            channel.close()
        server.close()
    def shutdown():
        if not shutdown_started[0]:
            shutdown_started[0] = True
            stopping.set()
            threading.Thread(target=shutdown_worker, name='managed-shutdown', daemon=True).start()
        return jsonify(stopping=True), 202
    application.add_url_rule('/_xjy/shutdown', endpoint='_xjy_shutdown', view_func=shutdown, methods=['POST'])
    def tracked_application(environ, start_response):
        with activity:
            active_requests[0] += 1
        response = None
        try:
            response = application(environ, start_response)
            yield from response
        finally:
            try:
                if response is not None and hasattr(response, 'close'):
                    response.close()
            finally:
                with activity:
                    active_requests[0] -= 1
                    activity.notify_all()
    server = create_server(tracked_application, host='127.0.0.1', port=arguments.port, threads=8,
                           ident='XJYManaged/' + arguments.module, clear_untrusted_proxy_headers=True,
                           asyncore_loop_timeout=0.1)
    server_holder.append(server)
    try:
        server.run()
    except OSError as error:
        expected_close = error.errno in (errno.EBADF, 10038) or getattr(error, 'winerror', None) == 10038
        if not (stopping.is_set() and shutdown_drained.is_set() and expected_close):
            raise
    return 0

if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        # Avoid recording credentials, session cookies, token, or full data paths.
        if sys.stderr is not None:
            print('Managed module could not start:', type(error).__name__, file=sys.stderr)
        raise SystemExit(1)
