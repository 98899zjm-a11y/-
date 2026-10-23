from pathlib import Path
import importlib.util
import tempfile
import unittest

ROOT=Path(__file__).resolve().parent.parent

class ProgramInventory(unittest.TestCase):
    def load(self):
        spec=importlib.util.spec_from_file_location('module_program_inventory',ROOT/'stage1/module_program_inventory.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        return module

    def test_only_paired_standard_python_cache_is_excluded_not_original_business_pyc(self):
        module=self.load()
        with tempfile.TemporaryDirectory(dir=ROOT/'runtime') as temp:
            root=Path(temp);(root/'pdf_vendor/reportlab/__pycache__').mkdir(parents=True)
            (root/'pdf_vendor/reportlab/__init__.py').write_text('value=1')
            (root/'pdf_vendor/reportlab/__pycache__/__init__.cpython-314.pyc').write_bytes(b'compiled cache fixture')
            (root/'original_algorithm.pyc').write_bytes(b'opaque original fixture')
            rows=module.collect_program_inventory(root,lambda p:p)
            self.assertEqual({r['path'] for r in rows},{'pdf_vendor/reportlab/__init__.py','original_algorithm.pyc'})

    def test_missing_source_or_nonstandard_cache_is_not_silently_dropped(self):
        module=self.load()
        for name in ('unknown.cpython-314.pyc','secret.bin'):
            with tempfile.TemporaryDirectory(dir=ROOT/'runtime') as temp:
                root=Path(temp);(root/'__pycache__').mkdir();(root/'__pycache__'/name).write_bytes(b'fixture')
                with self.assertRaises(RuntimeError):module.collect_program_inventory(root,lambda p:p)

    def test_hardlinked_files_and_disguised_databases_are_rejected(self):
        module=self.load();import os
        for mode in ('hardlink','sqlite'):
            with tempfile.TemporaryDirectory(dir=ROOT/'runtime') as temp:
                root=Path(temp);(root/'program.bin').write_bytes(b'SQLite format 3\0fixture' if mode=='sqlite' else b'fixture')
                if mode=='hardlink':os.link(root/'program.bin',root/'alias.bin')
                with self.assertRaises(RuntimeError):module.collect_program_inventory(root,lambda p:p)

if __name__=='__main__':unittest.main()
