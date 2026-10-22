"""Narrow source-only adapters for the original ERP/cashier modules."""
from contextlib import contextmanager
import datetime as dt
import importlib.abc
import importlib.util
from pathlib import Path
import sqlite3
import sys
import types

from flask import current_app

from .paths import BASE, ordinary

VENDOR = BASE / 'vendor' / 'ledger'
MODULES = frozenset(('erp', 'erp_values', 'erp_common', 'erp_suppliers', 'erp_documents',
    'erp_schema', 'erp_numbers', 'erp_settlement', 'erp_reports', 'erp_attachments', 'erp_ocr',
    'cashier', 'cashier_engine', 'cashier_schema', 'cashier_numbers', 'cashier_restore', 'ocr'))


def runtime():
    return current_app.extensions['standalone_runtime']


def now_str():
    return dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).strftime('%Y-%m-%d %H:%M:%S')


def connect():
    owned = runtime()
    target = owned.database()
    # rw never creates a missing/replaced DB as an accidental fresh ledger.
    connection = sqlite3.connect(target.as_uri() + '?mode=rw', uri=True, timeout=10, isolation_level=None)
    try:
        owned.database()
        connection.row_factory = sqlite3.Row
        connection.execute('PRAGMA foreign_keys=ON')
        connection.execute('PRAGMA busy_timeout=10000')
        if not current_app.extensions.get('standalone_initializing'):
            identity = connection.execute('SELECT version,namespace FROM standalone_metadata').fetchall()
            if len(identity) != 1 or tuple(identity[0]) != (1, owned.namespace):
                raise ValueError('数据库与当前隔离账套身份不一致。')
    except BaseException:
        connection.close()
        raise
    return connection


@contextmanager
def transaction():
    connection = connect()
    try:
        connection.execute('BEGIN IMMEDIATE')
        yield connection
        runtime().database()
        connection.commit()
    except BaseException:
        connection.rollback()
        raise
    finally:
        connection.close()


def number_store():
    return runtime().checked('config/erp-number-reservations.json', missing=True), runtime().namespace


def release_context():
    # Only truthiness is consumed by erp_attachments: no production context exists.
    return {'standaloneDemo': True}


def attachments_storage(configured_data_dirs, create=False):
    owned = runtime()
    directory = owned.checked('data/erp-attachments')
    for entry in directory.iterdir():
        owned.checked('data/erp-attachments/' + entry.name)
    return owned.root, directory


class VendorLoader(importlib.abc.Loader):
    def __init__(self, path):
        self.path = path

    def create_module(self, spec):
        return None

    def exec_module(self, module):
        ordinary(self.path)
        # Explicit text source compile avoids pyc lookup and pycache writes.
        module.__file__ = str(self.path)
        exec(compile(self.path.read_bytes(), str(self.path), 'exec'), module.__dict__)


class VendorFinder(importlib.abc.MetaPathFinder):
    standalone_vendor_finder = True

    def find_spec(self, fullname, path=None, target=None):
        if fullname in MODULES:
            source = ordinary(VENDOR / (fullname + '.py'))
            return importlib.util.spec_from_loader(fullname, VendorLoader(source), origin=str(source))
        if fullname.startswith(('erp_', 'cashier_')) or fullname in ('desktop_runtime_context', 'desktop_python_guard'):
            raise ImportError('Unapproved legacy module: ' + fullname)
        return None


def install():
    if any(getattr(finder, 'standalone_vendor_finder', False) for finder in sys.meta_path):
        return
    names = MODULES | {'app', 'repairs', 'erp_runtime'}
    if any(name in sys.modules for name in names):
        raise RuntimeError('Legacy names are already imported; start this host in a clean Python process.')
    app = types.ModuleType('app')
    app.db = types.SimpleNamespace(connect=connect, now_str=now_str)
    app.config = types.SimpleNamespace(data_dir=lambda: str(runtime().checked('data')))
    repairs = types.ModuleType('repairs')
    repairs.transaction = transaction
    erp_runtime = types.ModuleType('erp_runtime')
    erp_runtime.number_store = number_store
    erp_runtime.release_context = release_context
    erp_runtime.attachments_storage = attachments_storage
    sys.modules.update(app=app, repairs=repairs, erp_runtime=erp_runtime)
    sys.meta_path.insert(0, VendorFinder())
