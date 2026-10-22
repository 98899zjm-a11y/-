"""Local-only fictional ledger host with server-owned identity and storage."""
import datetime as dt
import hashlib
import importlib
import json
import re
import secrets
import sqlite3
import time
import uuid

from flask import Flask, g, jsonify, redirect, render_template, request
from jinja2 import ChoiceLoader, FileSystemLoader
from werkzeug.exceptions import HTTPException
from werkzeug.security import check_password_hash, generate_password_hash

from .paths import BASE, OwnedRuntime
from . import compat

COOKIE = 'xjy_demo_session'
ROLES = frozenset(('finance_maker', 'finance_reviewer', 'cashier_maker', 'cashier_reviewer', 'admin'))
ASSETS = frozenset(('bridge.js', 'shell.css', 'workbench.css', 'home.js', 'login.js', 'source-releases.js'))
SESSION_SECONDS = 8 * 3600


def _digest(value):
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def _audit(connection, action, username='', staff_id=None):
    connection.execute('INSERT INTO standalone_auth_events(action,username,staff_id,at) VALUES(?,?,?,?)',
                       (action, username[:80], staff_id, compat.now_str()))


def _public_user(user):
    return {'staffId': user['staff_id'], 'username': user['username'],
            'name': user['name'], 'role': user['role']}


def _actors(user):
    from erp_values import CAPS
    from cashier_engine import CAPABILITIES, MANAGE
    role = user['role']
    common = {'staffId': user['staff_id'], 'name': user['name'], 'role': role}
    erp = None
    cashier = None
    if role in ('finance_maker', 'finance_reviewer', 'admin'):
        caps = [x for x in CAPS if role == 'admin' or
                (not x.endswith('.review') if role == 'finance_maker' else not x.endswith('.prepare'))]
        if role in ('finance_reviewer', 'admin'):
            caps.append('erp.cashier.release')
        erp = {**common, 'protocolVersion': 2, 'module': 'ledger',
               'access': 'operate' if role == 'finance_maker' else 'manage', 'capabilities': caps}
    if role in ('cashier_maker', 'cashier_reviewer', 'admin'):
        caps = [x for x in CAPABILITIES if role == 'admin' or
                (x not in MANAGE if role == 'cashier_maker' else
                 not x.endswith('.prepare') and x not in ('cashier.reconcile.import', 'cashier.reconcile.match') or x == 'cashier.opening.prepare')]
        cashier = {**common, 'protocolVersion': 3, 'module': 'cashier',
                   'authorityModule': 'cashier', 'storageModule': 'ledger',
                   'access': 'operate' if role == 'cashier_maker' else 'manage', 'capabilities': caps}
    return erp, cashier


def _schema(application):
    owned = application.extensions['standalone_runtime']
    filename = owned.database()
    fresh = not filename.exists()
    if fresh:
        with filename.open('xb'):
            pass
    with application.app_context(), compat.transaction() as connection:
        if not fresh:
            table = connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='standalone_metadata'").fetchone()
            if not table:
                raise ValueError('拒绝加载未知数据库；独立演示不能接管旧库。')
            rows = connection.execute('SELECT version,namespace FROM standalone_metadata').fetchall()
            if len(rows) != 1 or tuple(rows[0]) != (1, owned.namespace):
                raise ValueError('账套身份或版本不匹配。')
        connection.execute('CREATE TABLE IF NOT EXISTS standalone_metadata(version INTEGER NOT NULL,namespace TEXT NOT NULL)')
        if fresh:
            connection.execute('INSERT INTO standalone_metadata VALUES(1,?)', (owned.namespace,))
        connection.execute('''CREATE TABLE IF NOT EXISTS standalone_users(
            staff_id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password_hash TEXT NOT NULL,
            role TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1)''')
        connection.execute('''CREATE TABLE IF NOT EXISTS standalone_sessions(
            token_hash TEXT PRIMARY KEY,staff_id TEXT NOT NULL REFERENCES standalone_users(staff_id),
            csrf TEXT NOT NULL,expires INTEGER NOT NULL)''')
        connection.execute('''CREATE TABLE IF NOT EXISTS standalone_auth_events(
            id INTEGER PRIMARY KEY,action TEXT NOT NULL,username TEXT NOT NULL,staff_id TEXT,at TEXT NOT NULL)''')
        connection.execute('''CREATE TABLE IF NOT EXISTS standalone_login_limits(
            username TEXT PRIMARY KEY,failures INTEGER NOT NULL,until_ts INTEGER NOT NULL)''')
        for verb in ('UPDATE', 'DELETE'):
            connection.execute(f"CREATE TRIGGER IF NOT EXISTS standalone_auth_events_no_{verb.lower()} BEFORE {verb} ON standalone_auth_events BEGIN SELECT RAISE(ABORT,'immutable authentication audit'); END")
        # Original ERP supplier foreign key requires this small shared legacy table.
        # Sales integration is deliberately absent until a future explicit merge.
        connection.execute('''CREATE TABLE IF NOT EXISTS suppliers(
            id INTEGER PRIMARY KEY,name TEXT NOT NULL UNIQUE,sort INTEGER NOT NULL,note TEXT NOT NULL,active INTEGER NOT NULL)''')
        connection.execute('''CREATE TABLE IF NOT EXISTS audit_logs(
            id INTEGER PRIMARY KEY,action TEXT NOT NULL,detail TEXT NOT NULL,at TEXT NOT NULL)''')
        for verb in ('UPDATE', 'DELETE'):
            connection.execute(f"CREATE TRIGGER IF NOT EXISTS standalone_audit_logs_no_{verb.lower()} BEFORE {verb} ON audit_logs BEGIN SELECT RAISE(ABORT,'immutable business audit'); END")


def seed_demo_users(application, credentials):
    """Trusted Python/CLI only: explicit fictional users, once per empty account set."""
    if not isinstance(credentials, dict) or not credentials or len(credentials) > 30:
        raise ValueError('请明确提供1至30个演示账户。')
    prepared = []
    for username, item in credentials.items():
        if not isinstance(username, str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_.-]{1,39}', username):
            raise ValueError('演示用户名格式无效。')
        if not isinstance(item, dict) or set(item) != {'password', 'role'} or item['role'] not in ROLES:
            raise ValueError('账户只允许 password 和固定 role。')
        password = item['password']
        if not isinstance(password, str) or not 12 <= len(password) <= 256:
            raise ValueError('演示口令长度必须为12至256。')
        prepared.append((str(uuid.uuid4()), username, username, generate_password_hash(password), item['role']))
    with application.app_context(), compat.transaction() as connection:
        if connection.execute('SELECT count(*) FROM standalone_users').fetchone()[0]:
            raise ValueError('演示账户已存在，拒绝覆盖。')
        connection.executemany('INSERT INTO standalone_users(staff_id,username,name,password_hash,role) VALUES(?,?,?,?,?)', prepared)
        for row in prepared:
            _audit(connection, 'demo-user-created', row[1], row[0])
    return {row[1]: row[0] for row in prepared}


def create_app(root):
    owned = OwnedRuntime(root)
    compat.install()
    application = Flask('xjy_standalone', static_folder=None)
    application.config.update(DEBUG=False, TESTING=False, MAX_CONTENT_LENGTH=16 * 1024 * 1024,
                              TRUSTED_HOSTS=['127.0.0.1', 'localhost'], JSON_SORT_KEYS=False)
    application.extensions['standalone_runtime'] = owned
    application.jinja_loader = ChoiceLoader([FileSystemLoader(str(BASE / 'ui')),
        FileSystemLoader(str(compat.VENDOR / 'app' / 'templates'))])
    application.static_folder = str(compat.VENDOR / 'app' / 'static')
    application.extensions['standalone_initializing'] = True
    try:
        _schema(application)
    finally:
        application.extensions.pop('standalone_initializing', None)
    erp = importlib.import_module('erp')
    cashier = importlib.import_module('cashier')
    from cashier_schema import initialize
    from cashier_numbers import create_reserver
    from erp_settlement import accept_settlement, accept_cashier_reversal
    with application.app_context(), compat.transaction() as connection:
        initialize(connection)
    erp.configure(application)
    with application.app_context():
        reserver = create_reserver(path=owned.checked('config/cashier-number-reservations.json', missing=True), namespace=owned.namespace)

    def reserve(kind, day, doc_id):
        # Ensure callbacks cannot accidentally be reused under a different app.
        if compat.runtime() is not owned:
            raise ValueError('编号回调账套不匹配。')
        owned.checked('config/cashier-number-reservations.json', missing=True)
        result = reserver(kind, day, doc_id)
        owned.checked('config/cashier-number-reservations.json')
        return result

    engine = cashier.register(application, connect=compat.connect, reserve_number=reserve,
        clock=compat.now_str, settlement_bridge=accept_settlement, reversal_bridge=accept_cashier_reversal)
    application.extensions['standalone_cashier_engine'] = engine
    # Environment OCR broker credentials must never reach an existing host.
    import ocr
    def unavailable_broker(value):
        raise ocr.OcrError('独立开发版未配置专用OCR服务，可手动录入采购；不会连接正式主机。', 503)
    ocr.call_broker = unavailable_broker

    @application.before_request
    def authenticate():
        # Force trusted-host validation before any authentication/database work.
        request.host
        owned.validate()
        if request.remote_addr not in ('127.0.0.1', '::1'):
            return jsonify(ok=False, error='独立开发版只接受本机访问。'), 403
        asset_name = request.path.rsplit('/', 1)[-1]
        if (request.path.startswith('/erp/static/') and asset_name in erp.STATIC or
                request.path.startswith('/cashier/static/') and asset_name in ('cashier.js', 'cashier.css')):
            from .paths import ordinary
            ordinary(compat.VENDOR / 'app' / 'static' / asset_name)
        if request.headers.get('Sec-Fetch-Site') == 'cross-site':
            return jsonify(ok=False, error='拒绝跨站请求。'), 403
        # Host validation is also performed by Flask TRUSTED_HOSTS.
        origin = request.headers.get('Origin')
        if origin is not None and origin != request.host_url.rstrip('/'):
            return jsonify(ok=False, error='请求来源与当前本机服务不符。'), 403
        mutating = request.method not in ('GET', 'HEAD', 'OPTIONS')
        if mutating and origin != request.host_url.rstrip('/'):
            return jsonify(ok=False, error='操作必须携带当前同源 Origin。'), 403
        g.standalone_user = None
        g.standalone_session = None
        token = request.cookies.get(COOKIE, '')
        if re.fullmatch(r'[A-Za-z0-9_-]{43}', token):
            connection = compat.connect()
            try:
                record = connection.execute('''SELECT u.*,s.csrf,s.token_hash,s.expires FROM standalone_sessions s
                    JOIN standalone_users u ON u.staff_id=s.staff_id WHERE s.token_hash=? AND s.expires>? AND u.active=1''',
                    (_digest(token), int(time.time()))).fetchone()
                if record:
                    g.standalone_user = dict(record)
                    g.standalone_session = {'csrf': record['csrf'], 'token_hash': record['token_hash']}
                    g._xjy_actor, g._xjy_cashier_actor = _actors(g.standalone_user)
            finally:
                connection.close()
        public = request.path in ('/login', '/auth/login') or request.path.startswith('/standalone/')
        if not public and g.standalone_user is None:
            if request.path in ('/', '/erp/', '/cashier', '/cashier/', '/finance-handoff') and request.method == 'GET':
                return redirect('/login')
            return jsonify(ok=False, error='请先登录。'), 401
        if mutating and request.path != '/auth/login':
            supplied = request.headers.get('X-CSRF-Token', '')
            expected = g.standalone_session['csrf'] if g.standalone_session else ''
            if not expected or not secrets.compare_digest(supplied, expected):
                return jsonify(ok=False, error='操作校验已过期，请刷新后重试。'), 403
        if request.is_json:
            # Reject identity/path overrides globally, including nested objects.
            payload = request.get_json(silent=True)
            forbidden = {'actor', 'staffId', 'capabilities', 'protocolVersion', 'db', 'dbPath', 'database', 'root', 'dataDir'}
            def override(value):
                return isinstance(value, dict) and (bool(forbidden & set(value)) or any(override(v) for v in value.values())) or isinstance(value, list) and any(override(v) for v in value)
            if request.path.startswith('/erp/') and isinstance(payload, dict) and 'sourceSaleId' in payload:
                return jsonify(ok=False, error='独立开发版未接入销售来源，请手工建立应收并经复核。'), 400
            # Account scope endpoints legitimately name a target staffId; it
            # selects a grantee, never the authenticated acting user.
            if request.path.endswith('/scopes'):
                forbidden = forbidden - {'staffId'}
            if override(payload):
                return jsonify(ok=False, error='请求不能指定操作者身份、权限或数据库路径。'), 400

    @application.after_request
    def security_headers(response):
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
        if request.path in ('/erp/', '/cashier', '/cashier/') and response.mimetype == 'text/html' and response.status_code == 200:
            response.set_data(response.get_data(as_text=True).replace('<head>', '<head><script src="/standalone/bridge.js"></script><link rel="stylesheet" href="/standalone/shell.css">', 1))
        return response

    @application.errorhandler(Exception)
    def failure(error):
        if isinstance(error, HTTPException):
            return jsonify(ok=False, error=error.description), error.code
        application.logger.error('Standalone request refused: %s', type(error).__name__)
        return jsonify(ok=False, error='独立开发服务拒绝本次操作，数据未确认提交。'), 503

    @application.get('/login')
    def login_page():
        return render_template('login.html')

    @application.get('/')
    def home():
        return render_template('home.html')

    @application.get('/finance-handoff')
    @application.get('/integration/api/releases')
    def finance_handoff():
        from cashier_engine import finance_authority, CashierError
        try:
            finance_authority(getattr(g, '_xjy_actor', None))
        except CashierError as error:
            return jsonify(ok=False, error=str(error)), error.status
        if request.path == '/finance-handoff':
            return render_template('source-releases.html')
        connection = compat.connect()
        try:
            rows = [dict(row) for row in connection.execute('''SELECT r.id,r.bill_id billId,r.status,r.revision,
                d.number,d.party_name partyName FROM cashier_source_releases r
                JOIN erp_documents d ON d.id=r.bill_id ORDER BY r.created_at DESC,r.id LIMIT 501''')]
            if len(rows) > 500:
                return jsonify(ok=False, error='交接记录超过当前页面范围，请先配置分页。'), 413
            owned.database()
            return jsonify(ok=True, releases=rows)
        finally:
            connection.close()

    @application.get('/standalone/<filename>')
    def asset(filename):
        if filename not in ASSETS:
            return jsonify(ok=False, error='资源不存在。'), 404
        from flask import send_file
        from .paths import ordinary
        return send_file(ordinary(BASE / 'ui' / filename), max_age=0)

    @application.post('/auth/login')
    def login():
        body = request.get_json(silent=True)
        if not isinstance(body, dict) or set(body) != {'username', 'password'} or not isinstance(body['username'], str) or not isinstance(body['password'], str) or len(body['username']) > 40 or len(body['password']) > 256:
            return jsonify(ok=False, error='登录格式无效。'), 400
        username, password = body['username'], body['password']
        timestamp = int(time.time())
        token = secrets.token_urlsafe(32)
        csrf = secrets.token_urlsafe(32)
        valid_user = None
        with compat.transaction() as connection:
            limit = connection.execute('SELECT * FROM standalone_login_limits WHERE username=?', (username,)).fetchone()
            if limit and limit['failures'] >= 5 and limit['until_ts'] > timestamp:
                _audit(connection, 'login-rate-limited', username)
                return jsonify(ok=False, error='登录失败次数过多，请稍后重试。'), 429
            user = connection.execute('SELECT * FROM standalone_users WHERE username=? AND active=1', (username,)).fetchone()
            if user and check_password_hash(user['password_hash'], password):
                valid_user = dict(user)
                old_token = request.cookies.get(COOKIE, '')
                connection.execute('DELETE FROM standalone_sessions WHERE token_hash=? OR expires<=?', (_digest(old_token), timestamp))
                connection.execute('INSERT INTO standalone_sessions VALUES(?,?,?,?)', (_digest(token), user['staff_id'], csrf, timestamp + SESSION_SECONDS))
                connection.execute('DELETE FROM standalone_login_limits WHERE username=?', (username,))
                _audit(connection, 'login-success', username, user['staff_id'])
            else:
                failures = limit['failures'] + 1 if limit and limit['until_ts'] > timestamp else 1
                connection.execute('INSERT INTO standalone_login_limits VALUES(?,?,?) ON CONFLICT(username) DO UPDATE SET failures=excluded.failures,until_ts=excluded.until_ts', (username, failures, timestamp + 300))
                _audit(connection, 'login-failure', username)
        if valid_user is None:
            return jsonify(ok=False, error='用户名或口令无效。'), 401
        response = jsonify(ok=True, user=_public_user(valid_user), csrfToken=csrf)
        # Plain HTTP is allowed only on loopback; Secure would break local HTTP.
        response.set_cookie(COOKIE, token, max_age=SESSION_SECONDS, httponly=True, samesite='Strict', secure=request.is_secure, path='/')
        return response

    @application.get('/auth/me')
    @application.get('/session')
    def me():
        user = _public_user(g.standalone_user)
        return jsonify(ok=True, user=user, **user, csrfToken=g.standalone_session['csrf'], csrf=g.standalone_session['csrf'])

    @application.get('/auth/users')
    def users():
        if g.standalone_user['role'] != 'admin':
            return jsonify(ok=False, error='没有人员授权目录权限。'), 403
        connection = compat.connect()
        try:
            return jsonify(ok=True, users=[_public_user(row) for row in connection.execute('SELECT * FROM standalone_users WHERE active=1 ORDER BY username')])
        finally:
            connection.close()

    @application.post('/auth/logout')
    def logout():
        with compat.transaction() as connection:
            connection.execute('DELETE FROM standalone_sessions WHERE token_hash=?', (g.standalone_session['token_hash'],))
            _audit(connection, 'logout', g.standalone_user['username'], g.standalone_user['staff_id'])
        response = jsonify(ok=True)
        response.delete_cookie(COOKIE, path='/', httponly=True, samesite='Strict')
        return response

    return application
