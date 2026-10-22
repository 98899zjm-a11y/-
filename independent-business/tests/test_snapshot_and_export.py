"""Technical recovery rehearsal only; never writes an existing active ledger."""
from contextlib import closing
import hashlib
from io import BytesIO
from pathlib import Path
import shutil
import sqlite3
import unittest
import uuid

from host import create_app, seed_demo_users

BASE = Path(__file__).absolute().parent.parent


class SnapshotAndExport(unittest.TestCase):
    def test_wal_snapshot_restore_keeps_document_and_retained_numbers(self):
        root = BASE / 'runtime' / ('snapshot-source-' + str(uuid.uuid4()))
        application = create_app(root)
        seed_demo_users(application, {'demo': {'role': 'admin', 'password': 'Fictional-snapshot-2026!'}})
        client = application.test_client()
        login = client.post('/auth/login', json={'username': 'demo', 'password': 'Fictional-snapshot-2026!'}, headers={'Origin': 'http://localhost'}).get_json()
        headers = {'Origin': 'http://localhost', 'X-CSRF-Token': login['csrfToken']}
        party = client.post('/erp/api/parties', json={'requestId': str(uuid.uuid4()), 'kind': 'supplier', 'name': '虚构快照单位'}, headers=headers).get_json()['party']
        result = client.post('/erp/api/documents', json={'requestId': str(uuid.uuid4()), 'kind': 'opening_payable',
            'partyId': party['id'], 'date': '2026-10-23', 'amount': '0.29', 'evidence': '虚构期初'}, headers=headers)
        self.assertEqual(result.status_code, 200, result.get_json())
        document = result.get_json()['document']
        archive = BASE / 'runtime' / ('snapshot-rehearsal-' + str(uuid.uuid4()))
        archive.mkdir()
        source_db = root / 'data/demo.sqlite3'
        writer = sqlite3.connect(source_db, isolation_level=None)
        try:
            self.assertEqual(writer.execute('PRAGMA journal_mode=WAL').fetchone()[0], 'wal')
            writer.execute('BEGIN IMMEDIATE')
            # A reserved writer barrier blocks competing financial writers;
            # a separate backup reader includes the committed WAL contents.
            with closing(sqlite3.connect(source_db.as_uri() + '?mode=ro', uri=True)) as source:
                with closing(sqlite3.connect(archive / 'snapshot.sqlite3')) as target:
                    source.backup(target)
                    self.assertEqual(target.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
                    self.assertEqual(target.execute('PRAGMA foreign_key_check').fetchall(), [])
                    row = target.execute('SELECT number,amount_cents FROM erp_documents WHERE id=?', (document['id'],)).fetchone()
                    self.assertEqual(row, (document['number'], 29))
            retained = root / 'config/erp-number-reservations.json'
            shutil.copyfile(retained, archive / retained.name)
            self.assertEqual(hashlib.sha256(retained.read_bytes()).digest(), hashlib.sha256((archive / retained.name).read_bytes()).digest())
            self.assertTrue((root / '.standalone-demo.json').exists())
        finally:
            if writer.in_transaction:
                writer.rollback()
            writer.close()
        # Restore to a NEW disconnected file and read it independently.
        restored = archive / 'restored.sqlite3'
        shutil.copyfile(archive / 'snapshot.sqlite3', restored)
        with closing(sqlite3.connect(restored)) as connection:
            self.assertEqual(connection.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
            self.assertEqual(connection.execute('SELECT amount_cents FROM erp_documents WHERE id=?', (document['id'],)).fetchone()[0], 29)
        later = client.post('/erp/api/documents', json={'requestId': str(uuid.uuid4()), 'kind': 'opening_payable',
            'partyId': party['id'], 'date': '2026-10-23', 'amount': '0.30', 'evidence': '虚构快照后单据'}, headers=headers).get_json()['document']
        # Rehearsal restores into a NEW disconnected runtime. Retain the live
        # numbering high-water knowledge, never rewind it with the old DB.
        restored_root = BASE / 'runtime' / ('reopened-' + str(uuid.uuid4()))
        restored_root.mkdir()
        shutil.copyfile(root / '.standalone-demo.json', restored_root / '.standalone-demo.json')
        (restored_root / 'data').mkdir()
        shutil.copyfile(archive / 'snapshot.sqlite3', restored_root / 'data/demo.sqlite3')
        shutil.copytree(root / 'config', restored_root / 'config')
        reopened = create_app(restored_root)
        new_client = reopened.test_client()
        new_login = new_client.post('/auth/login', json={'username': 'demo', 'password': 'Fictional-snapshot-2026!'}, headers={'Origin': 'http://localhost'}).get_json()
        documents = new_client.get('/erp/api/bootstrap').get_json()['documents']
        self.assertIn(document['id'], [row['id'] for row in documents])
        self.assertNotIn(later['id'], [row['id'] for row in documents])
        created = new_client.post('/erp/api/documents', json={'requestId': str(uuid.uuid4()), 'kind': 'opening_payable',
            'partyId': party['id'], 'date': '2026-10-23', 'amount': '0.31', 'evidence': '虚构恢复后新单据'},
            headers={'Origin': 'http://localhost', 'X-CSRF-Token': new_login['csrfToken']})
        self.assertEqual(created.status_code, 200, created.get_json())
        self.assertEqual(int(created.get_json()['document']['number'].rsplit('-', 1)[1]), 3)

    def test_xlsx_export_is_a_real_workbook(self):
        root = BASE / 'runtime' / ('export-' + str(uuid.uuid4()))
        application = create_app(root)
        seed_demo_users(application, {'auditor': {'role': 'finance_reviewer', 'password': 'Fictional-export-2026!'}})
        client = application.test_client()
        client.post('/auth/login', json={'username': 'auditor', 'password': 'Fictional-export-2026!'}, headers={'Origin': 'http://localhost'})
        response = client.get('/erp/api/export.xlsx?asOf=2026-10-23')
        try:
            self.assertEqual(response.status_code, 200, response.get_data(as_text=True)[:200] if response.mimetype == 'application/json' else '')
            self.assertTrue(response.data.startswith(b'PK'))
            import openpyxl
            with BytesIO(response.data) as payload:
                book = openpyxl.load_workbook(payload, read_only=True)
                self.assertGreaterEqual(len(book.sheetnames), 1)
                book.close()
        finally:
            response.close()


if __name__ == '__main__':
    unittest.main(verbosity=2)
