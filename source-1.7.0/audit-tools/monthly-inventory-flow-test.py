"""Actual offline Guest contracts for inventory period propagation, not UI acceptance."""
import os, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
if (os.name != 'nt' or os.path.normcase(str(ROOT)) != os.path.normcase('C:/xjy-work/xjy-web-stage1') or
        os.path.normcase(sys.executable) != os.path.normcase('C:/Python314/python.exe') or
        not sys.flags.isolated or not sys.flags.no_site or not sys.flags.dont_write_bytecode or sys.flags.optimize):
    raise RuntimeError('Actual fixed offline Guest Python required')
import argparse, ast, contextlib, datetime, hashlib, json, re, sqlite3, stat, types, unittest
GUARD = ROOT/'stage1/sandbox-context.py'
VALIDATOR = ROOT/'stage1/validate-sandbox-context.py'
FILES = {'reports': 'project/desktop/legacy-source/ledger/reports.py',
         'home': 'project/desktop/legacy-source/ledger/app/templates/home.html',
         'stock': 'project/desktop/legacy-source/ledger/app/templates/stock.html',
         'sidecar': 'project/desktop/legacy-source/sidecar_release.py'}
BODIES = {}

def read(p):
    for f in (p,*p.parents):
        s=f.lstat()
        if stat.S_ISLNK(s.st_mode) or getattr(s,'st_file_attributes',0)&0x400:
            raise RuntimeError('Ordinary source required')
    if not p.is_file() or p.stat().st_nlink!=1 or p.stat().st_size>2*1024**2:
        raise RuntimeError('Bounded single-link source required')
    return p.read_bytes()

def digest(b): return hashlib.sha256(b).hexdigest()

class PeriodFlow(unittest.TestCase):
    def test_MF01_report_uses_period_end_and_never_sums_month_snapshots(self):
        tree=ast.parse(BODIES['reports'])
        node=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='fetch_records')
        node.decorator_list=[]
        calls=[]
        def snapshot(c=None,month=None):
            self.assertIsInstance(c,sqlite3.Connection)
            calls.append(month)
            return {'rows':[], 'scope':{'month':month,'complete':True}}
        module=types.ModuleType('inventory_dashboard');module.snapshot=snapshot
        prior=sys.modules.get('inventory_dashboard');sys.modules['inventory_dashboard']=module
        namespace={'contextlib':contextlib, 'datetime':datetime,
                   'db':types.SimpleNamespace(connect=lambda:sqlite3.connect(':memory:'))}
        try:
            exec(compile(ast.fix_missing_locations(ast.Module(body=[node],type_ignores=[])),str(ROOT/FILES['reports']),'exec'),namespace)
            for all_time,start,end,expected in [(False,'2026-09-01','2026-10-31','2026-10'),
                                               (False,'2026-01-01','2026-01-31','2026-01'),
                                               (True,'','',datetime.date.today().strftime('%Y-%m'))]:
                with self.subTest(all_time=all_time,end=end):
                    calls.clear();_,inventory=namespace['fetch_records']({'domains':['stock','platinum'],'start':start,'end':end,'all_time':all_time})
                    self.assertEqual(calls,[expected], 'REPORT_MONTH_SCOPE_REQUIRED: one end-period snapshot, never all historical inventory')
                    self.assertEqual(inventory['scope']['month'],expected)
        finally:
            if prior is None: sys.modules.pop('inventory_dashboard',None)
            else:sys.modules['inventory_dashboard']=prior

    def test_MF02_inventory_links_and_forms_preserve_selected_month(self):
        for key in ('home','stock'):
            expressions=re.findall(r'url_for\((.*?)\)',BODIES[key],re.S)
            stock_links=[x for x in expressions if re.match(r"['\"](?:stock.index|inventory_dashboard.export_stock)['\"]",x)]
            self.assertTrue(stock_links)
            for link in stock_links:
                self.assertRegex(link,r'\bmonth\s*=', 'INVENTORY_LINK_MONTH_REQUIRED: '+key)
        self.assertRegex(BODIES['stock'],r'name=[\"\']month[\"\']', 'INVENTORY_FILTER_MONTH_REQUIRED')
        self.assertRegex(BODIES['stock'],r'name=[\"\']back_month[\"\']', 'INVENTORY_POST_RETURN_MONTH_REQUIRED')

    def test_MF03_readonly_gateway_accepts_only_precise_added_month(self):
        tree=ast.parse(BODIES['sidecar'])
        assignment=next(n for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='READ_ENDPOINTS' for t in n.targets))
        endpoints=ast.literal_eval(assignment.value)['ledger']
        for name in ('stock.index','stock.export','inventory_dashboard.export_stock'):
            self.assertEqual(set(endpoints[name].split()),{'state','cat','sup','kw','month'}, 'READONLY_MONTH_ALLOWLIST_REQUIRED')
            self.assertNotIn('sql',endpoints[name].split())
        self.assertIn("set(request.args) - set(allowed.split())",BODIES['sidecar'])

    def test_MF04_scope_explanations_are_visible_and_reports_label_period(self):
        for key in ('home','stock'):
            self.assertIn('scope.message',BODIES[key], 'VISIBLE_INVENTORY_SCOPE_REQUIRED: '+key)
            self.assertIn('scope.complete',BODIES[key], 'INCOMPLETE_INVENTORY_NOTICE_REQUIRED: '+key)
        self.assertIn('scope',BODIES['reports'], 'REPORT_SCOPE_NOTICE_REQUIRED')
        self.assertIn('期末',BODIES['reports'], 'REPORT_END_PERIOD_LABEL_REQUIRED')

def main():
    p=argparse.ArgumentParser(allow_abbrev=False);p.add_argument('--pins',required=True);a=p.parse_args()
    pins=json.loads(a.pins)
    if set(pins)!={'test',*FILES}:raise RuntimeError('Exact source closure required')
    for k,v in pins.items():
        if not re.fullmatch('[a-f0-9]{64}',v):raise RuntimeError('SHA256 pin required')
    if digest(read(Path(__file__)))!=pins['test']:raise RuntimeError('Test source changed')
    if digest(read(Path(sys.executable)))!='434b361fe0c5960d404974feed493db47f2603a1ace2574312104fbed0182c6f':raise RuntimeError('Python changed')
    if digest(read(GUARD))!='09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249':raise RuntimeError('Guard changed')
    if digest(read(VALIDATOR))!='867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207':raise RuntimeError('Validator changed')
    guard=types.ModuleType('actual_monthly_flow_guard');guard.__file__=str(GUARD)
    exec(compile(read(GUARD),str(GUARD),'exec',dont_inherit=True,optimize=0),guard.__dict__)
    admission=guard.read_context(ROOT)
    for key,rel in FILES.items():
        b=read(ROOT/rel)
        if digest(b)!=pins[key]:raise RuntimeError('Reviewed source changed: '+key)
        BODIES[key]=b.decode('utf-8')
    print(json.dumps({'purpose':'monthly-inventory-period-propagation','admission':admission,'pins':pins,
                      'scope':'selected-AST-real-in-memory-SQLite-and-static-navigation-contracts',
                      'actualHttpVerified':False,'actualUiVerified':False,'productionDataUsed':False}),flush=True)
    r=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(PeriodFlow))
    print(json.dumps({'testsRun':r.testsRun,'failures':len(r.failures),'errors':len(r.errors),'skipped':len(r.skipped),'passed':r.wasSuccessful()}),flush=True)
    return 0 if r.wasSuccessful() else 1
if __name__=='__main__':raise SystemExit(main())
