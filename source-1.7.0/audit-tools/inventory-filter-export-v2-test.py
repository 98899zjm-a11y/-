"""V2: three unchanged contracts plus one literal money-precision contract.

Run only after the unchanged actual Guest guard admits the fixed runtime.
Only three inventory definitions, finance.csv_export_cell and presentation.fmt2 execute.
Request/render/Response ports are synthetic; csv/io and selected bodies are real.
No business import, database, opaque handler, app factory, EXE or browser runs.
"""

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PYTHON = Path('C:/Python314/python.exe')
if (os.name != 'nt' or os.path.normcase(str(ROOT)) != os.path.normcase('C:/xjy-work/xjy-web-stage1') or
        os.path.normcase(sys.executable) != os.path.normcase(str(PYTHON)) or
        not sys.flags.isolated or not sys.flags.no_site or not sys.flags.dont_write_bytecode or sys.flags.optimize):
    raise RuntimeError('Fixed actual Guest Python -I -B -S required; no Host import/run')

import argparse
import ast
import copy
import csv
import datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import hashlib
import importlib.util
import io
import json
import math
import re
import stat
import types
import unittest

SELF = ROOT / 'audit-tools/inventory-filter-export-v2-test.py'
SOURCE = ROOT / 'project/desktop/legacy-source/ledger/inventory_dashboard.py'
TEMPLATE = ROOT / 'project/desktop/legacy-source/ledger/app/templates/stock.html'
FINANCE = ROOT / 'project/desktop/legacy-source/ledger/finance.py'
PRESENTATION = ROOT / 'project/desktop/legacy-source/ledger/presentation.py'
GUARD = ROOT / 'stage1/sandbox-context.py'
VALIDATOR = ROOT / 'stage1/validate-sandbox-context.py'
GUARD_SHA = '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249'
VALIDATOR_SHA = '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207'
PYTHON_SHA = '434b361fe0c5960d404974feed493db47f2603a1ace2574312104fbed0182c6f'
FINANCE_SHA = '56bcb389a21ada8c5d650e6f7ea1e81781b446f3af0a4e9b19e019930df63096'
PRESENTATION_SHA = '07eedd042e8eb76ac720e9eb2b7375b73c5122b0865e13d80abd96bd2d4b070d'
V1_TEST_SHA = '556309548af7bf2a247e1c80ed62f81980190ea6a5017d6da0ce926aad7e63d8'
BASELINE_SOURCE_SHA = 'af351a9753f5dc7e953d7f4f5fe70c7fc813f0720aca7188a789da089a9fede4'
BASELINE_TEMPLATE_SHA = '73f237bf615ba7628769ac2f3a93feb3ed259c7fc82d56d764282487a0108d51'
SELECTED = ('_stock_rows', 'stock_index', 'export_stock')
STATES = ('在库', '在途', '已售', '待确认')
HEADERS = ['序号', '入柜时间', '销售单号', '商品类别', '商品', '规格/克', '成本', '实际售价', '毛利', '销售时间', '售货签名', '备注', '商家']
SUBJECT = None
DEFINITIONS = None
TEMPLATE_TEXT = None


def sha(body):
    return hashlib.sha256(body).hexdigest()


def read(file, limit=1024 * 1024):
    for parent in (file, *file.parents):
        info = parent.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
            raise RuntimeError('Reviewed source/runtime path cannot be a link')
        if stat.S_ISREG(info.st_mode) and info.st_nlink != 1:
            raise RuntimeError('Reviewed source/runtime cannot be hardlinked')
    if not file.is_file() or file.stat().st_size > limit:
        raise RuntimeError('Bounded ordinary source/runtime required')
    body = file.read_bytes()
    if len(body) > limit:
        raise RuntimeError('Source/runtime read limit exceeded')
    return body


def forbidden(*args, **kwargs):
    raise AssertionError('No database/write/token port is available to helper/export')


class ResponsePort:
    """Capture the Response boundary only; this is not Flask or an HTTP server."""
    def __init__(self, response=None, status=200, headers=None, mimetype=None, content_type=None):
        self.data = response.encode('utf-8') if isinstance(response, str) else bytes(response or b'')
        self.status_code = status
        self.headers = dict(headers or {})
        if content_type or mimetype:
            self.headers['Content-Type'] = content_type or mimetype


def extract(body, finance_body, presentation_body):
    parsed = ast.parse(body, filename=str(SOURCE))
    definitions = {}
    for name in SELECTED:
        matches = [node for node in parsed.body if isinstance(node, ast.FunctionDef) and node.name == name]
        if len(matches) > 1:
            raise RuntimeError('Duplicate reviewed definition: ' + name)
        if matches:
            definitions[name] = matches[0]
    finance_tree = ast.parse(finance_body, filename=str(FINANCE))
    cells = [node for node in finance_tree.body if isinstance(node, ast.FunctionDef) and node.name == 'csv_export_cell']
    if len(cells) != 1 or cells[0].decorator_list:
        raise RuntimeError('Exactly one undecorated real csv_export_cell required')
    presentation_tree = ast.parse(presentation_body, filename=str(PRESENTATION))
    formats = [node for node in presentation_tree.body if isinstance(node, ast.FunctionDef) and node.name == 'fmt2']
    if len(formats) != 1 or formats[0].decorator_list:
        raise RuntimeError('Exactly one undecorated real presentation.fmt2 required')
    selected = copy.deepcopy([cells[0], formats[0], *definitions.values()])
    # Decorator contracts are checked separately as AST. The actual functions
    # run undecorated through explicit request/render/Response ports, never auth.
    for node in selected:
        node.decorator_list = []
    module = ast.Module(body=selected, type_ignores=[])
    for node in ast.walk(module):
        if isinstance(node, (ast.Import, ast.ImportFrom, ast.ClassDef, ast.AsyncFunctionDef)):
            raise RuntimeError('Only fixed reviewed definitions may be selected')
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in ('exec', 'eval', 'compile', '__import__', 'open', 'input'):
            raise RuntimeError('Unreviewed executable/IO port in selected definitions')
    namespace = {'__name__': 'inventory_filter_export_reviewed_definitions', 'csv': csv, 'io': io,
                 'datetime': datetime, 'math': math, 're': re, 'STATES': STATES,
                 'Decimal': Decimal, 'InvalidOperation': InvalidOperation, 'ROUND_HALF_UP': ROUND_HALF_UP,
                 'Response': ResponsePort, 'db': types.SimpleNamespace(connect=forbidden, query=forbidden),
                 'r': types.SimpleNamespace(row_token=forbidden), 'auth': types.SimpleNamespace(current_user=lambda: {'role': 'admin'})}
    exec(compile(module, str(SOURCE), 'exec', dont_inherit=True, optimize=0), namespace)
    namespace['finance'] = types.SimpleNamespace(csv_export_cell=namespace['csv_export_cell'])
    return namespace, definitions


def row(identifier, sequence, state, *, category='饰品', supplier='A/B', product='PT950 合成链', order_no='SO', weight=1.0, remark=None, sell_date=''):
    # Complete known stock/read fields plus snapshot-derived columns. No original
    # DDL or persisted row is claimed; no SQL is used in these contracts.
    return {'id': identifier, 'seq': sequence, 'in_date': '2026-10-18', 'order_no': order_no,
            'category': category, 'product': product, 'weight': weight, 'cost': 12.5,
            'sell_price': 15.0, 'profit_c': 2.5, 'sell_date': sell_date, 'seller': '虚构经手人',
            'remark': state if remark is None else remark, 'supplier': supplier,
            'note': '仅虚构读取夹具', 'created_at': '2026-10-18 12:00:00', 'updated_at': '2026-10-18 12:00:00',
            'rule_version': 0, 'inventory_state': state, 'platinum_bucket': 'pt950',
            'purity_factor': 0.95, 'fine_grams': 0.95}


ROWS = [
    row(14, 104, '已售', product='已售合成件', order_no='SOLD', sell_date='2026-10-17'),
    row(11, 101, '在库', product='PT950 Straße 链', order_no='SO-A1', weight=3.12),
    row(17, 107, '在库', category='其它', supplier='A/B1', product='另一合成件', order_no='OTHER'),
    row(13, 103, '在途', category='板料', product='在途合成件', order_no='TRANSIT', weight=2.0),
    row(16, 106, '在库', product='空格_100%,"合成件"\n第二行', order_no='LITERAL'),
    row(12, 102, '在库', supplier='A', product='PT950 ring', order_no='CaseΩ', weight=4.88),
    row(15, 105, '待确认', product='待确认合成件', order_no='PENDING', remark='未售出'),
]

# Independent hand-checked IDs. No expected result calls the selected filter.
CASES = [
    ({}, [17, 16, 12, 11]),
    ({'state': '全部'}, [17, 16, 15, 14, 13, 12, 11]),
    ({'state': '已售'}, [14]), ({'state': '在途'}, [13]), ({'state': '待确认'}, [15]),
    ({'state': '在库', 'sup': 'A/B'}, [16, 11]),
    ({'state': '全部', 'cat': '饰品'}, [16, 15, 14, 12, 11]),
    ({'state': '全部', 'sup': 'A'}, [12]),
    ({'state': '全部', 'sup': 'A/B'}, [16, 15, 14, 13, 11]),
    ({'state': '全部', 'kw': 'STRASSE'}, [11]),
    ({'state': '全部', 'kw': 'CASEω'}, [12]),
    ({'state': '全部', 'kw': '_100%'}, [16]),
    ({'state': '在库', 'cat': '饰品', 'sup': 'A/B', 'kw': 'STRASSE'}, [11]),
    ({'state': '全部', 'cat': '不存在'}, []),
    ({'state': '在库', 'sup': 'A/B', 'kw': 'NONE'}, []),
]
SEQUENCES = {11: '101', 12: '102', 13: '103', 14: '104', 15: '105', 16: '106', 17: '107'}


def inventory(records):
    return {'rows': copy.deepcopy(records), 'overall': {'in_stock': {'count': 4}}}


def configure_ports(records, args, *, page=False):
    data = inventory(records)
    SUBJECT['request'] = types.SimpleNamespace(args=dict(args))
    SUBJECT['snapshot'] = lambda: data
    SUBJECT['r'] = types.SimpleNamespace(row_token=forbidden)
    SUBJECT['db'] = types.SimpleNamespace(connect=forbidden, query=forbidden)
    if page:
        def token(table, plain):
            if table != 'stock_items' or set(plain) & {'inventory_state', 'platinum_bucket', 'purity_factor', 'fine_grams', 'snapshot_token'}:
                raise AssertionError('Page token must cover only actual stock columns')
            return 'private-token-' + str(plain['id'])
        def choices(current, extra):
            return list(dict.fromkeys([*current, *extra]))
        SUBJECT['r'] = types.SimpleNamespace(row_token=token, preserve_choices=choices)
        def query(sql):
            if sql not in ('SELECT name FROM categories WHERE active=1 ORDER BY sort,id', 'SELECT name FROM suppliers WHERE active=1 ORDER BY sort,id'):
                raise AssertionError('Only existing page choice reads allowed')
            return []
        SUBJECT['db'] = types.SimpleNamespace(connect=forbidden, query=query)
        SUBJECT['render_template'] = lambda name, **context: (name, context)
    return data


def decode_csv(response):
    if not isinstance(response, ResponsePort):
        raise AssertionError('Actual export must return the Response boundary')
    if response.status_code != 200 or not response.data.startswith(b'\xef\xbb\xbf'):
        raise AssertionError('Successful UTF-8 BOM CSV required')
    if not str(response.headers.get('Content-Type', '')).startswith('text/csv'):
        raise AssertionError('CSV response type required')
    if not str(response.headers.get('Content-Disposition', '')).startswith('attachment;'):
        raise AssertionError('CSV attachment disposition required')
    return list(csv.reader(io.StringIO(response.data.decode('utf-8-sig'), newline='')))


class InventoryFilterExport(unittest.TestCase):
    def require_feature(self):
        missing = [name for name in SELECTED if name not in SUBJECT]
        self.assertEqual(missing, [], 'INVENTORY_FILTER_EXPORT_REQUIRED: missing reviewed definitions')

    def test_E01_shared_filter_preserves_literal_scope_order_and_input(self):
        # Missing predicate, OR instead of AND, SQL-like wildcards, lower()
        # instead of casefold(), wrong state, or ascending order must fail here.
        self.require_feature()
        for args, expected in CASES:
            with self.subTest(args=args):
                data = inventory(ROWS); before = copy.deepcopy(data)
                actual = SUBJECT['_stock_rows'](data, args.get('state', '在库'), args.get('cat', ''), args.get('sup', ''), args.get('kw', ''))
                self.assertEqual([item['id'] for item in actual], expected)
                self.assertEqual(data, before, 'Pure shared filter cannot mutate snapshot/order or mint tokens')
                self.assertTrue(all('snapshot_token' not in item for item in actual))

    def test_E02_page_uses_same_scope_and_template_exports_explicit_filters(self):
        # Page/export divergence or a button still targeting opaque stock.export
        # must fail. The template assertion is static, not browser acceptance.
        self.require_feature()
        for args, expected in [*CASES, ({'state': 'invalid', 'kw': '  STRASSE  '}, [11])]:
            with self.subTest(args=args):
                configure_ports(ROWS, args, page=True)
                template, context = SUBJECT['stock_index']()
                self.assertEqual(template, 'stock.html')
                self.assertEqual([item['id'] for item in context['rows']], expected)
                self.assertTrue(all(item.get('snapshot_token') == 'private-token-' + str(item['id']) for item in context['rows']))
                self.assertEqual(context['state'], args.get('state', '在库') if args.get('state', '在库') in STATES + ('全部',) else '在库')
                self.assertEqual((context['cat'], context['sup'], context['kw']), (args.get('cat', ''), args.get('sup', ''), args.get('kw', '').strip()))
        for name in ('stock_index', 'export_stock'):
            self.assertTrue(any(isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == '_stock_rows' for node in ast.walk(DEFINITIONS[name])), name + ' must share the actual filter')
        auth_node = lambda node: isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) and node.value.id == 'auth' and node.attr == 'login_required'
        self.assertTrue(any(auth_node(node) for node in DEFINITIONS['stock_index'].decorator_list))
        decorators = DEFINITIONS['export_stock'].decorator_list
        self.assertTrue(any(auth_node(node) for node in decorators), 'New endpoint must retain original login policy')
        self.assertTrue(any(isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and isinstance(node.func.value, ast.Name) and node.func.value.id == 'bp' and node.func.attr == 'get' and len(node.args) == 1 and isinstance(node.args[0], ast.Constant) and node.args[0].value == '/inventory/export.csv' for node in decorators))
        links = [(href, re.sub('<[^>]*>', '', label)) for _, href, label in re.findall(r'<a\b[^>]*\bhref=([\"\'])(.*?)\1[^>]*>(.*?)</a>', TEMPLATE_TEXT, re.S)]
        exports = [href for href, label in links if '导出' in label and 'CSV' in label]
        self.assertEqual(len(exports), 1, 'Exactly one current-filter export link required')
        expression = re.fullmatch(r'\{\{\s*(.*?)\s*\}\}', exports[0], re.S)
        self.assertIsNotNone(expression)
        call = ast.parse(expression.group(1), mode='eval').body
        self.assertIsInstance(call, ast.Call)
        self.assertEqual(ast.dump(call.func), ast.dump(ast.Name(id='url_for', ctx=ast.Load())))
        self.assertEqual([ast.literal_eval(arg) for arg in call.args], ['inventory_dashboard.export_stock'])
        self.assertEqual({item.arg: ast.dump(item.value) for item in call.keywords}, {name: ast.dump(ast.Name(id=name, ctx=ast.Load())) for name in ('state', 'cat', 'sup', 'kw')})

    def test_E03_real_csv_body_has_exact_13_columns_safe_text_and_numeric_values(self):
        # Unfiltered export, extra derived/token columns, reformatted weights,
        # lost quoting, unsafe text or apostrophes on negative money must fail.
        self.require_feature()
        for args, expected in [*CASES, ({'state': 'invalid', 'kw': '  STRASSE  '}, [11])]:
            with self.subTest(args=args):
                configure_ports(ROWS, args)
                parsed = decode_csv(SUBJECT['export_stock']())
                self.assertEqual(parsed[0], HEADERS)
                self.assertTrue(all(len(cells) == 13 for cells in parsed))
                self.assertEqual([cells[0] for cells in parsed[1:]], [SEQUENCES[value] for value in expected])
        configure_ports([ROWS[1]], {'state': '全部'})
        parsed = decode_csv(SUBJECT['export_stock']())
        self.assertEqual(parsed, [HEADERS, ['101', '2026-10-18', 'SO-A1', '饰品', 'PT950 Straße 链', '3.12', '12.50', '15.00', '2.50', '', '虚构经手人', '在库', 'A/B']])
        danger = row(51, 501, '已售', weight=2.0)
        danger.update(in_date='=DATE(2026,10,18)', order_no='+SO-A', category='-PT', product='@SUM(1,2)\n"quoted"',
                      cost=-12.5, sell_price=1234.5, profit_c=1247.0, sell_date='\t2026-10-18',
                      seller='\r签名', remark='\n注释', supplier='  =SUP')
        data = configure_ports([danger], {'state': '全部'}); before = copy.deepcopy(data)
        response = SUBJECT['export_stock']()
        parsed = decode_csv(response)
        self.assertEqual(parsed, [HEADERS, ['501', "'=DATE(2026,10,18)", "'+SO-A", "'-PT", "'@SUM(1,2)\n\"quoted\"", '2.0', '-12.50', '1234.50', '1247.00', "'\t2026-10-18", "'\r签名", "'\n注释", "'  =SUP"]])
        self.assertEqual(data, before, 'Export cannot change the actual synthetic snapshot it received')
        self.assertNotIn(b'private-token-', response.data)

    def test_E04_money_precision_matches_literal_half_up_and_keeps_weight_numeric(self):
        # Formatting a binary float before the real fmt2 loses half-cent input.
        # Expectations are independent literals, never computed with fmt2.
        self.require_feature()
        controls = [(2.675, '2.68'), (0.005, '0.01'), (-2.675, '-2.68'),
                    (-0.005, '-0.01'), (0.0049, '0.00'), (-0.0, '0.00')]
        for value, expected in controls:
            with self.subTest(value=value, expected=expected):
                record = row(61, 601, '在库', weight=2.675)
                record.update(cost=value, sell_price=value, profit_c=value)
                data = configure_ports([record], {'state': '全部'}); before = copy.deepcopy(data)
                parsed = decode_csv(SUBJECT['export_stock']())
                self.assertEqual(parsed[0], HEADERS)
                self.assertEqual(len(parsed), 2)
                self.assertEqual(len(parsed[1]), 13)
                self.assertEqual(parsed[1][0], '601')
                self.assertEqual(parsed[1][5], '2.675', 'Presentation cannot round stored weight')
                self.assertEqual(parsed[1][6:9], [expected, expected, expected],
                                 'Three stored money values need fmt2 half-up; negative numbers must not gain a text prefix')
                self.assertEqual(data, before, 'Formatting must not change stored synthetic values')


def main():
    global SUBJECT, DEFINITIONS, TEMPLATE_TEXT
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--source-sha256', required=True, help='Root-pinned test source SHA256')
    parser.add_argument('--subject-sha256', required=True, help='Root-pinned reviewed inventory source SHA256')
    parser.add_argument('--template-sha256', required=True, help='Root-pinned reviewed stock.html SHA256')
    args = parser.parse_args()
    if not all(re.fullmatch('[0-9a-f]{64}', value) for value in (args.source_sha256, args.subject_sha256, args.template_sha256)):
        raise RuntimeError('Root test/subject/template SHA256 required')
    if sha(read(SELF)) != args.source_sha256 or sha(read(PYTHON)) != PYTHON_SHA:
        raise RuntimeError('Pinned test/public runtime changed')
    if sha(read(GUARD)) != GUARD_SHA or sha(read(VALIDATOR)) != VALIDATOR_SHA:
        raise RuntimeError('Original actual Guest guard changed')
    if sys.version_info[:3] != (3, 14, 8) or importlib.util.MAGIC_NUMBER.hex() != '2b0e0d0a':
        raise RuntimeError('Fixed public Guest Python 3.14.8 required')
    guard = types.ModuleType('inventory_filter_export_actual_context')
    guard.__file__ = str(GUARD)
    exec(compile(read(GUARD), str(GUARD), 'exec', dont_inherit=True, optimize=0), guard.__dict__)
    admission = guard.read_context(ROOT)
    body, finance_body, template_body, presentation_body = read(SOURCE), read(FINANCE), read(TEMPLATE), read(PRESENTATION)
    if (sha(body) != args.subject_sha256 or sha(template_body) != args.template_sha256 or
            sha(finance_body) != FINANCE_SHA or sha(presentation_body) != PRESENTATION_SHA):
        raise RuntimeError('Reviewed inventory/template/finance/presentation source changed')
    SUBJECT, DEFINITIONS = extract(body, finance_body, presentation_body)
    TEMPLATE_TEXT = template_body.decode('utf-8')
    print(json.dumps({'purpose': 'inventory-filter-csv-export-v2-precision-contracts', 'scope': 'actual-Guest-selected-AST-explicit-ports',
                      'admission': admission, 'testSourceSha256': args.source_sha256, 'subjectSourceSha256': sha(body),
                      'templateSourceSha256': sha(template_body), 'financeSourceSha256': sha(finance_body),
                      'presentationSourceSha256': sha(presentation_body), 'v1TestSourceSha256': V1_TEST_SHA,
                      'baselineSubjectSha256': BASELINE_SOURCE_SHA, 'baselineTemplateSha256': BASELINE_TEMPLATE_SHA,
                      'definitions': list(DEFINITIONS), 'financeDefinitions': ['csv_export_cell'],
                      'presentationDefinitions': ['fmt2'], 'tests': 4,
                      'liveHttpVerified': False, 'browserVerified': False, 'businessImported': False,
                      'databaseUsed': False, 'opaqueStockExportExecutedOrChanged': False}), flush=True)
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(InventoryFilterExport))
    print(json.dumps({'testsRun': result.testsRun, 'failures': len(result.failures), 'errors': len(result.errors),
                      'passed': result.wasSuccessful(), 'liveHttpVerified': False, 'browserVerified': False}), flush=True)
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    raise SystemExit(main())
