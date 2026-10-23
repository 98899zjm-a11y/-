"""Host pure-data RED: tiny owned files only, no product/SQLite/engine/Popen.

Retains every fixture under fixed W/sandbox; never deletes failed evidence.
Root runs this file before authorizing edits to the frozen transfer primitives.
"""
from pathlib import Path
import hashlib
import importlib.util
import json
import os
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import uuid

ROOT = Path(__file__).resolve().parent.parent
EXPECTED = Path('E:/codex/2026-10-15/work/xjy-v16-deep-audit')


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT/'audit-tools'/filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TransferMetadata(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if ROOT != EXPECTED:
            raise RuntimeError('Only fixed isolated W tiny-data fixtures are authorized')
        cls.host = load('electron4472_transfer_host', 'electron-4472-prepare.py')
        cls.guest = load('electron4472_transfer_guest', 'electron-4472-guest.py')
        cls.work = ROOT/'sandbox'/('qa-electron4472-transfer-'+str(uuid.uuid4()))
        cls.host.ordinary(cls.work, ROOT, missing=True)
        cls.work.mkdir()
        print(json.dumps({'tinyDataFixtureRetained': str(cls.work), 'engineExecuted': False}), flush=True)

    def fixture(self, name):
        directory = self.work/name
        directory.mkdir()
        source = directory/'public-synthetic-input.txt'
        source.write_bytes(b'first tiny public fixture value\n')
        # Windows creation and later change times must be observably distinct.
        time.sleep(.03)
        payload = b'final tiny public fixture value\n'
        source.write_bytes(payload)
        target = directory/'public-synthetic-copy.txt'
        return directory, source, target, payload, {'size': len(payload), 'sha256': hashlib.sha256(payload).hexdigest()}

    def test_host_real_tiny_copy_accepts_different_path_and_handle_ctime(self):
        directory, source, target, payload, spec = self.fixture('host-real')
        with patch.object(self.host, 'OUTPUT', directory):
            result = self.host.transfer(source, spec, target)
        self.assertEqual(result, spec)
        self.assertEqual(target.read_bytes(), payload)

    def test_guest_checked_real_tiny_copy_accepts_different_path_and_handle_ctime(self):
        directory, source, target, payload, spec = self.fixture('guest-real')
        with patch.object(self.guest, 'BASE', directory):
            self.guest.checked(source, spec, directory, target)
        self.assertEqual(target.read_bytes(), payload)

    def handle_change(self, module, name, guest=False):
        directory, source, target, payload, spec = self.fixture(name)
        real_path_stat, real_fstat = Path.stat, os.fstat
        calls = []

        def copied(s, ctime):
            fields = {key: getattr(s, key) for key in
                      ('st_mode', 'st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_nlink', 'st_birthtime_ns')
                      if hasattr(s, key)}
            fields['st_ctime_ns'] = ctime
            return SimpleNamespace(**fields)

        def path_stat(file, *args, **kwargs):
            value = real_path_stat(file, *args, **kwargs)
            return copied(value, 1000) if file == source else value

        def handle_stat(fd):
            value = real_fstat(fd)
            calls.append(fd)
            # Stable separate path baseline, changed handle ctime after reading.
            return copied(value, 2000 if len(calls) == 1 else 3000)

        with patch.object(Path, 'stat', path_stat), patch.object(module.os, 'fstat', handle_stat), \
             patch.object(module, 'BASE' if guest else 'OUTPUT', directory):
            with self.assertRaisesRegex(RuntimeError, 'changed during'):
                if guest:
                    module.checked(source, spec, directory, target)
                else:
                    module.transfer(source, spec, target)
        self.assertGreaterEqual(len(calls), 2, 'Must reach the post-read handle comparison, not reject unrelated initial ctime')
        self.assertEqual(source.read_bytes(), payload)

    def test_host_rejects_handle_metadata_change_even_when_path_metadata_is_stable(self):
        self.handle_change(self.host, 'host-handle-change')

    def test_guest_rejects_handle_metadata_change_even_when_path_metadata_is_stable(self):
        self.handle_change(self.guest, 'guest-handle-change', guest=True)


if __name__ == '__main__':
    unittest.main()
