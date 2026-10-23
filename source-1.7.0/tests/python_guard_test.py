import os
import sys
import unittest
import threading
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'stage1'))

class GuardTest(unittest.TestCase):
    def test_before_opaque_business_imports(self):
        import python_guard
        policy = python_guard.install(ROOT)
        import sqlite3
        with self.assertRaisesRegex(RuntimeError, 'ISOLATION'):
            open('F:/鑫金源珠宝资料/工作室数据/jewelry.sqlite', 'rb')
        with self.assertRaisesRegex(RuntimeError, 'ISOLATION'):
            sqlite3.connect('F:/鑫金源珠宝资料/内帐/ledger.db')
        with self.assertRaisesRegex(RuntimeError, 'ISOLATION'):
            open(ROOT / 'project' / 'unsafe.txt', 'w')
        with sqlite3.connect(ROOT / 'data' / 'guard-tests' / 'python.sqlite') as db:
            db.execute('CREATE TABLE IF NOT EXISTS t(value INTEGER)')
            db.execute('INSERT INTO t VALUES(43)')
            self.assertEqual(db.execute('SELECT max(value) FROM t').fetchone()[0], 43)
            with self.assertRaises(sqlite3.DatabaseError):
                db.execute("ATTACH DATABASE 'F:/forbidden.sqlite' AS other")
            db.set_authorizer(lambda *a: sqlite3.SQLITE_OK)
            with self.assertRaises(sqlite3.DatabaseError):
                db.execute("ATTACH DATABASE 'F:/forbidden.sqlite' AS other")
            with self.assertRaisesRegex(RuntimeError, 'ISOLATION'):
                db.execute('VACUUM INTO ?', (str(ROOT / 'tests' / 'escaped.sqlite'),))
        import subprocess
        with self.assertRaisesRegex(RuntimeError, 'ISOLATION'):
            subprocess.run(['cmd', '/c', 'echo', 'unsafe'])
        import socket
        with socket.socket() as sock:
            with self.assertRaisesRegex(RuntimeError, 'ISOLATION'):
                sock.bind(('0.0.0.0', 0))
            sock.bind(('127.0.0.1', 0))
        self.assertTrue(policy)
        ready, release = threading.Event(), threading.Event()
        original_stat = Path.stat
        errors = []
        def paused_stat(value, *args, **kwargs):
            if value == ROOT and threading.current_thread().name == 'guard-inspection':
                ready.set()
                if not release.wait(5):
                    raise RuntimeError('thread test timed out')
            return original_stat(value, *args, **kwargs)
        def inspect():
            try: policy['check'](ROOT/'data'/'sales')
            except Exception as error: errors.append(error)
        Path.stat = paused_stat
        worker = threading.Thread(target=inspect, name='guard-inspection')
        try:
            worker.start()
            self.assertTrue(ready.wait(5))
            # Emit only the audit event. No forbidden file is ever opened.
            with self.assertRaisesRegex(RuntimeError, 'ISOLATION'):
                sys.audit('open', str(ROOT/'project'/'thread-probe.txt'), 'w', os.O_WRONLY)
        finally:
            release.set()
            worker.join(5)
            Path.stat = original_stat
        self.assertFalse(errors)
        import tempfile
        with tempfile.TemporaryDirectory(dir=ROOT / 'runtime') as temporary:
            sample = Path(temporary) / 'fixture.txt'
            sample.write_text('SYNTHETIC', encoding='utf-8')
            self.assertEqual(sample.read_text('utf-8'), 'SYNTHETIC')

if __name__ == '__main__':
    unittest.main()
