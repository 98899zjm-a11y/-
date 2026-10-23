"""Source-copy tool tests only; own fictional files, no product or database imports."""
import importlib.util
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path('E:/codex/2026-10-15/work/xjy-v16-deep-audit')
SOURCE = ROOT / 'audit-tools/prepare-desktop-first170-projection.py'
OUT = ROOT / 'audit-evidence/projection-file-stability' / sys.argv[1]
if len(sys.argv) != 2 or sys.argv[1] not in ('red-a1', 'green-a2'):
    raise RuntimeError('Fixed test run required')
if os.name != 'nt' or not sys.flags.isolated or not sys.flags.no_site:
    raise RuntimeError('Windows isolated source-tool test required')
OUT.mkdir(parents=True, exist_ok=False)
spec = importlib.util.spec_from_file_location('source_copy_tool', SOURCE)
subject = importlib.util.module_from_spec(spec)
spec.loader.exec_module(subject)

class FileStabilityTests(unittest.TestCase):
    def test_01_stable_edited_source(self):
        expected = SOURCE.read_bytes()
        self.assertEqual(subject.read_stable(SOURCE), expected)

    def test_02_executable_extension_is_only_text_and_not_launched(self):
        target = OUT / 'fictional.exe'
        target.write_bytes(b'SYNTHETIC TEXT; NEVER EXECUTED')
        self.assertEqual(subject.read_stable(target), target.read_bytes())

    def test_03_same_bytes_replacement_before_open_rejected(self):
        target = OUT / 'replace.txt'
        target.write_bytes(b'fictional stable bytes')
        retained = OUT / 'retained-replaced.txt'
        original_open = os.open
        replaced = False
        def switch(file, flags, *args, **kwargs):
            nonlocal replaced
            if Path(file) == target and not replaced:
                replaced = True
                target.rename(retained)
                target.write_bytes(retained.read_bytes())
            return original_open(file, flags, *args, **kwargs)
        with patch.object(subject.os, 'open', switch):
            with self.assertRaisesRegex(RuntimeError, 'changed before open'):
                subject.read_stable(target)
        self.assertTrue(replaced)
        self.assertEqual(target.read_bytes(), retained.read_bytes())
        self.assertNotEqual(target.stat().st_ino, retained.stat().st_ino)

    def test_04_write_during_read_rejected(self):
        target = OUT / 'mutated.txt'
        target.write_bytes(b'fictional original')
        fdopen = os.fdopen
        changed = False
        class DuringRead:
            def __init__(self, stream): self.stream = stream
            def __enter__(self): self.stream.__enter__(); return self
            def __exit__(self, *args): return self.stream.__exit__(*args)
            def read(self, count):
                nonlocal changed
                data = self.stream.read(count)
                with target.open('ab') as edit:
                    edit.write(b' changed')
                    edit.flush()
                    os.fsync(edit.fileno())
                changed = True
                return data
        with patch.object(subject.os, 'fdopen', lambda *a, **kw: DuringRead(fdopen(*a, **kw))):
            with self.assertRaisesRegex(RuntimeError, 'changed while reading'):
                subject.read_stable(target)
        self.assertTrue(changed)

stream = io.StringIO()
result = unittest.TextTestRunner(stream=stream, verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(FileStabilityTests))
(OUT / 'tests.txt').write_text(stream.getvalue(), encoding='utf-8')
record = {'sourceSha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(), 'run': sys.argv[1],
          'tests': result.testsRun, 'failures': len(result.failures), 'errors': len(result.errors),
          'passed': result.wasSuccessful(), 'productExecuted': False, 'databaseOpened': False,
          'nativeExecutableLaunched': False}
(OUT / 'result.json').write_text(json.dumps(record, indent=2), encoding='utf-8')
print(stream.getvalue()); print(json.dumps(record))
raise SystemExit(0 if result.wasSuccessful() else 1)
