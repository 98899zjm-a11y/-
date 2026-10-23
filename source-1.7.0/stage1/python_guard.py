"""Install before any Flask app, repairs, config or opaque bytecode import.

This is a fail-closed application guard, backed by the launcher's OS write
restriction. It is not a sandbox for arbitrary adversarial Python programs.
"""
import os
import re
import sys
import stat
from pathlib import Path
import sqlite3
import threading

def install(root, require_restricted=False):
    root = Path(root).resolve(strict=True)
    marker = root / 'isolation-identity.json'
    if not marker.is_file() or root.name != 'xjy-web-stage1':
        raise RuntimeError('ISOLATION: explicit stage1 root identity missing')
    if require_restricted:
        import importlib.util
        import json
        spec = importlib.util.spec_from_file_location('stage1_token_information', root / 'stage1' / 'token-info.py')
        token_module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(token_module)
        info = token_module.information()
        expected = json.loads(marker.read_text('utf-8'))
        if not info['restricted'] or expected['sid'] not in info['restrictingSids']:
            raise RuntimeError('ISOLATION: business import requires the actual restricted OS token')
    writable = [root / name for name in ('data', 'config', 'cache', 'logs', 'runtime', 'backups')]
    read_roots = [root, Path(sys.base_prefix).resolve()]
    identity = root.stat()
    inspection = threading.local()
    def fail(message):
        raise RuntimeError('ISOLATION: ' + message)
    def check(value, write=False):
        if isinstance(value, int):
            fail('unregistered native file descriptor')
        if not isinstance(value, (str, bytes, os.PathLike)):
            fail('explicit path required')
        text = os.fsdecode(value)
        if text.startswith(('\\\\', '//')) or '\0' in text or ':' in text[2:] or re.match(r'^[a-z]:[^\\/]', text, re.I):
            fail('noncanonical local path')
        if any(re.match(r'^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)', part, re.I) or part.endswith((' ', '.')) for part in Path(text).parts[1:]):
            fail('reserved path segment')
        inspection.depth = getattr(inspection, 'depth', 0) + 1
        try:
            candidate = Path(os.path.abspath(text))
            roots = writable if write else read_roots
            if not any(candidate.is_relative_to(parent) for parent in roots):
                fail('path outside isolated data or registered runtime')
            if root.stat().st_ino != identity.st_ino or root.stat().st_dev != identity.st_dev:
                fail('root identity changed')
            for parent in (candidate, *candidate.parents):
                if parent.exists():
                    info = parent.lstat()
                    if parent.is_symlink() or os.path.isjunction(parent) or stat.S_ISREG(info.st_mode) and info.st_nlink > 1:
                        fail('link, junction or hard-linked file rejected')
            canonical = candidate.resolve()
            if not any(canonical.is_relative_to(parent) for parent in roots):
                fail('physical target escaped isolation')
            return canonical
        finally:
            inspection.depth -= 1
    def audit(event, args):
        if getattr(inspection, 'depth', 0):
            return
        if event == 'open':
            mode = args[1] or ''
            flags = args[2] or 0
            check(args[0], bool(set(str(mode)) & set('wa+')) or bool(flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND)))
        elif event in ('os.listdir', 'os.scandir'):
            check(args[0] or os.getcwd())
        elif event in ('os.remove', 'os.rmdir', 'os.mkdir', 'os.chmod', 'os.chown', 'os.utime', 'os.truncate'):
            check(args[0], True)
        elif event in ('os.rename', 'os.replace'):
            check(args[0], True)
            check(args[1], True)
        elif event in ('os.link', 'os.symlink', 'subprocess.Popen', 'os.system', 'os.exec', 'os.spawn'):
            fail('native links, processes and dynamic libraries prohibited')
        elif event == 'ctypes.dlopen':
            if str(args[0]).lower().removesuffix('.dll') not in ('kernel32', 'user32', 'advapi32', 'msvcrt', 'shell32', 'ole32'):
                fail('unregistered dynamic library prohibited')
        elif event == 'sqlite3.connect':
            check(args[0], True)
        elif event in ('socket.bind', 'socket.connect'):
            address = args[1]
            if not isinstance(address, tuple) or address[0] != '127.0.0.1' or address[1] == 31831 or address[1] != 0 and not 1024 <= address[1] <= 65535:
                fail('only independent loopback sockets allowed')
        elif event == 'os.chdir':
            check(args[0])
    class Connection(sqlite3.Connection):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self.set_authorizer(None)
        def set_authorizer(self, custom):
            def authorize(action, a, b, db, trigger):
                if action in (sqlite3.SQLITE_ATTACH, sqlite3.SQLITE_DETACH) or action == sqlite3.SQLITE_FUNCTION and str(b).lower() == 'load_extension':
                    return sqlite3.SQLITE_DENY
                return custom(action, a, b, db, trigger) if custom else sqlite3.SQLITE_OK
            return super().set_authorizer(authorize)
        def execute(self, sql, parameters=()):
            if re.search(r'\bVACUUM\s+INTO\b', sql, re.I):
                fail('native SQL file export prohibited; use SQLite backup')
            return super().execute(sql, parameters)
        def enable_load_extension(self, *args):
            fail('SQLite extension loading prohibited')
        def load_extension(self, *args):
            fail('SQLite extension loading prohibited')
    original_connect = sqlite3.connect
    def connect(database, *args, **kwargs):
        check(database, True)
        if kwargs.get('uri') or kwargs.get('factory') not in (None, Connection):
            fail('URI connections and replacement SQLite factories prohibited')
        kwargs['factory'] = Connection
        return original_connect(database, *args, **kwargs)
    sqlite3.connect = connect
    import _sqlite3
    _sqlite3.connect = connect
    sqlite3.Connection = Connection
    _sqlite3.Connection = Connection
    original_mkdir = os.mkdir
    def mkdir(directory, mode=0o777, *, dir_fd=None):
        check(directory, True)
        if dir_fd is not None:
            fail('relative directory descriptor not registered')
        # Windows 0o700 creates an owner-only ACL which excludes restricting
        # SIDs. Inherit the already private stage1 ACL instead (not a public
        # permission grant). No ACL outside this root is modified.
        return original_mkdir(directory, 0o777 if mode == 0o700 else mode)
    os.mkdir = mkdir
    sys.dont_write_bytecode = True
    sys.addaudithook(audit)
    return {'root': str(root), 'check': check}
