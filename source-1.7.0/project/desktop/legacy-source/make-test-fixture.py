"""Test-only: create fresh isolated module data, never use a selected production root."""
import os
from pathlib import Path
import sqlite3
import sys

module, destination = sys.argv[1:]
data = Path(destination).resolve()
scratch = Path(__file__).resolve().parent.parent / 'tests' / '.legacy-fixtures'
if scratch.resolve() not in data.parents or data.exists():
    raise RuntimeError('Fixture must be a new directory below the isolated test scratch root.')
os.environ['LEDGER_DISABLE_BACKUP_THREAD'] = '1'
os.environ['LEDGER_DISABLE_EXTERNAL_THREAD'] = '1'
os.environ['LEDGER_DATA' if module == 'ledger' else 'STOCKCHECK_DATA'] = str(data)
sys.path.insert(0, str(Path(__file__).resolve().parent / module))
if module == 'ledger':
    from repairs import install
    install()
from app import create_app
app = create_app()
from werkzeug.security import generate_password_hash
connection = sqlite3.connect(data / ('ledger.db' if module == 'ledger' else 'stockcheck.db'))
columns = {row[1] for row in connection.execute('PRAGMA table_info(users)')}
changes = {'username': 'fixture-admin', 'password_hash': generate_password_hash('Fixture-Only-Password-2026')}
for name, value in [('must_change_pw', 0), ('enabled', 1), ('role', 'admin')]:
    if name in columns: changes[name] = value
connection.execute('UPDATE users SET ' + ','.join(name+'=?' for name in changes) + ' WHERE id=(SELECT min(id) FROM users)', list(changes.values()))
connection.commit()
connection.close()
print('Isolated module fixture ready:', module)
