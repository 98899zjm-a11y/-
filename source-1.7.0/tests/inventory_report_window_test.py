from pathlib import Path
import importlib.util
import types
import unittest
from flask import Flask

ROOT=Path(__file__).resolve().parent.parent
def api():
    spec=importlib.util.spec_from_file_location('inventory_report_window',ROOT/'project/desktop/legacy-source/inventory_report_window.py')
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

class ReportWindowTests(unittest.TestCase):
    def app(self):
        app=Flask('synthetic_report_adapter')
        namespace={'__name__':'app.views_report','_range_args':lambda:('30','2099-01-01 00:00','近30天')}
        exec('def index():\n return _range_args()',namespace)
        app.view_functions['report.index']=namespace['index']
        return app,namespace

    def test_original_flow_without_since_preserves_opaque_algorithm(self):
        app,namespace=self.app();original=namespace['_range_args'];api().install_report_window(app)
        with app.test_request_context('/reports?r=30'):
            self.assertEqual(namespace['_range_args'](),original())

    def test_frozen_range_changes_only_original_date_input(self):
        app,namespace=self.app();api().install_report_window(app)
        with app.test_request_context('/reports?r=30&since=2026-09-15'):
            self.assertEqual(namespace['_range_args'](),('30','2026-09-15 00:00','近30天'))

    def test_all_time_and_bad_or_duplicate_dates_fail_closed(self):
        app,namespace=self.app();api().install_report_window(app)
        for url in ['/reports?r=30&since=2026-02-30','/reports?r=30&since=2026-09-15&since=2026-09-16','/reports?r=all&since=2026-09-15','/reports?r=foo&since=2026-09-15']:
            with app.test_request_context(url):
                with self.assertRaises(Exception):
                    namespace['_range_args']()

    def test_wrapped_view_is_supported_and_unknown_function_shape_is_refused(self):
        app,namespace=self.app();view=app.view_functions['report.index']
        def wrapper():
            return view()
        wrapper.__wrapped__=view;app.view_functions['report.index']=wrapper
        api().install_report_window(app)
        with app.test_request_context('/reports?r=30&since=2026-09-15'):
            self.assertEqual(wrapper(),('30','2026-09-15 00:00','近30天'))
        with self.assertRaises(RuntimeError):
            api().install_report_window(Flask('unknown'))

if __name__=='__main__':
    unittest.main()
