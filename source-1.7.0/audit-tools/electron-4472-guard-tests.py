"""Prepared pure harness tests. Root reviews before running; never launches Electron."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, HERE/file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class HarnessGuards(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.host = load('electron4472_host_prepare', 'electron-4472-prepare.py')
        cls.guest = load('electron4472_guest_driver', 'electron-4472-guest.py')

    def test_relative_path_rejects_aliases_and_data_paths(self):
        for value in ['../electron.exe', '/electron.exe', 'C:/electron.exe', 'locales\\zh-CN.pak',
                      'locales//en.pak', 'a:stream', 'NUL', 'a.', 'a ', 'x/../y']:
            with self.subTest(value=value), self.assertRaises(RuntimeError):
                self.host.relative(value)

    def test_host_copy_requires_exact_program_rows(self):
        for value in ['resources/app.asar', 'data/sales.sqlite', 'config/key.json', 'ui-a1/program/electron.exe']:
            with self.subTest(value=value), self.assertRaises(RuntimeError):
                self.host.engine_name(value)
        self.assertEqual(self.host.engine_name('locales/zh-CN.pak'), 'locales/zh-CN.pak')

    def test_bad_actual_context_precedes_guest_mutation_or_launch(self):
        for operation in [self.guest.stage, self.guest.run]:
            with self.subTest(operation=operation.__name__), \
                 patch.object(self.guest, 'load_capsule', return_value={}), \
                 patch.object(self.guest, 'actual', side_effect=RuntimeError('actual Guest denied')), \
                 patch.object(Path, 'mkdir') as mkdir, \
                 patch.object(self.guest.subprocess, 'Popen') as popen:
                with self.assertRaisesRegex(RuntimeError, 'actual Guest denied'):
                    operation('a'*64)
                mkdir.assert_not_called()
                popen.assert_not_called()

    def test_clean_stop_needs_cim_zero_exit_two_snapshots_and_no_resources(self):
        self.assertTrue(self.guest.normal_complete(True, 0, 2, [], []))
        for values in [(False, 0, 2, [], []), (True, 1, 2, [], []), (True, None, 2, [], []),
                       (True, 0, 1, [], []), (True, 0, 2, [{'ProcessId': 1}], []),
                       (True, 0, 2, [], [{'LocalPort': 1}])]:
            self.assertFalse(self.guest.normal_complete(*values))

    def test_cli_requires_explicit_execution_switch(self):
        with patch.object(self.guest, 'run') as run:
            with self.assertRaises(SystemExit):
                self.guest.main(['run', '--manifest-sha256', 'a'*64])
            run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
