"""Fresh source-compatible schemas and fictitious users; guarded before pyc."""
from pathlib import Path
import json
import os
import sys
ROOT = Path(__file__).resolve().parent.parent
from python_guard import install
policy = install(ROOT, require_restricted=True)
module = sys.argv[1]
if module not in ('ledger', 'inventory'):
    raise RuntimeError('ISOLATION: unknown module')
directory = ROOT / 'data' / module
policy['check'](directory, True)
database = directory / ('ledger.db' if module == 'ledger' else 'stockcheck.db')
marker = directory / 'synthetic-fixture.json'
if database.exists() and not marker.exists():
    raise RuntimeError('ISOLATION: unmarked database refused')
directory.mkdir(parents=True, exist_ok=True)
os.environ['LEDGER_DATA'] = str(ROOT / 'data' / 'ledger')
os.environ['STOCKCHECK_DATA'] = str(ROOT / 'data' / 'inventory')
os.environ['LEDGER_DISABLE_BACKUP_THREAD'] = '1'
os.environ['LEDGER_DISABLE_EXTERNAL_THREAD'] = '1'
sys.path.insert(0, str(ROOT / 'project' / 'desktop' / 'legacy-source' / module))
if module == 'ledger':
    from repairs import install as install_repairs
    install_repairs()
from app import create_app
app = create_app()
if module == 'ledger':
    import algorithm_approval
    algorithm_approval.configure(app)
    import erp
    erp.configure(app)
import sqlite3
from werkzeug.security import generate_password_hash
with sqlite3.connect(database) as connection:
    columns = {row[1] for row in connection.execute('PRAGMA table_info(users)')}
    if not marker.exists():
        changes = {'username': 'demo-' + module, 'password_hash': generate_password_hash('Synthetic-Only-2026!')}
        for name, value in [('must_change_pw', 0), ('enabled', 1), ('role', 'admin')]:
            if name in columns:
                changes[name] = value
        connection.execute('UPDATE users SET ' + ','.join(name+'=?' for name in changes) + ' WHERE id=(SELECT min(id) FROM users)', list(changes.values()))
    integrity = connection.execute('PRAGMA integrity_check').fetchone()[0]
    tables = [row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
    if integrity != 'ok':
        raise RuntimeError('Fixture integrity failed')
marker.write_text(json.dumps({'synthetic': True, 'namespace': os.environ['XJY_STAGE1_NAMESPACE'], 'module': module, 'tables': tables, 'integrity': integrity}, ensure_ascii=False), encoding='utf-8')
print(json.dumps({'module': module, 'synthetic': True, 'tables': len(tables), 'integrity': integrity}))
