"""Root-only actual Guest selected-source payroll identity candidate contracts.

Reuses the frozen 93d0 original eight assertion methods unchanged. Additional
contracts use original finance SCHEMA, synthetic :memory: SQLite, issued-token,
render, repairs and explicit rule-result ports. No production/opaque formulas,
app/pyc/business imports, original service HTTP or real payroll data execute.
Red/candidate phases change only Root-pinned source bytes, never assertions.
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PYTHON = Path('C:/Python314/python.exe')
if (os.name != 'nt' or os.path.normcase(str(ROOT)) != os.path.normcase('C:/xjy-work/xjy-web-stage1') or
        os.path.normcase(sys.executable) != os.path.normcase(str(PYTHON)) or
        not sys.flags.isolated or not sys.flags.no_site or not sys.flags.dont_write_bytecode or sys.flags.optimize):
    raise RuntimeError('Fixed actual offline Guest Python -I -B -S required; Host execution refused')

import argparse
import ast
import contextlib
import copy
import hashlib
import importlib.util
import json
import re
import stat
import types
import unittest
import uuid

SELF = 'audit-tools/finance-erp170-payroll-month.test.py'
PIN_FILE = 'audit-tools/finance-erp170-payroll-month-pins.json'
ORIGINAL = 'audit-tools/finance-erp-round2-contract.test.py'
ORIGINAL_SHA = '93d0f83ae5e171b12544a412dd894da0fef0eb550455dcf10ce4fd099bed41fe'
GUARDS = {'stage1/sandbox-context.py': '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
          'stage1/validate-sandbox-context.py': '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207'}
FILES = ('project/desktop/legacy-source/ledger/finance.py', 'project/desktop/legacy-source/ledger/sidecar.py')
BASE = None


def read(file, maximum=1024 * 1024):
    for parent in (file, *file.parents):
        info = parent.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400 or stat.S_ISREG(info.st_mode) and info.st_nlink != 1:
            raise RuntimeError('Ordinary non-reparse single-link file required')
    identity = lambda v: (v.st_dev, v.st_ino, v.st_size, v.st_mtime_ns, v.st_ctime_ns, v.st_nlink)
    before = file.lstat()
    if not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= maximum: raise RuntimeError('Bounded ordinary file required')
    with file.open('rb') as stream:
        opened = os.fstat(stream.fileno())
        if any(getattr(before, key) != getattr(opened, key) for key in ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_nlink')):
            raise RuntimeError('File changed before open')
        body = stream.read(maximum + 1)
        if len(body) != before.st_size or identity(os.fstat(stream.fileno())) != identity(opened): raise RuntimeError('File changed during read')
    if identity(file.lstat()) != identity(before): raise RuntimeError('File changed after read')
    return body


@contextlib.contextmanager
def fixture():
    with BASE.payroll_fixture() as f:
        calls = []
        def compute(domain, variables, version):
            calls.append((domain, copy.deepcopy(variables), version))
            return {'应发工资': 0, '工资扣款': 0, '实发工资': 0, '本次支付': 0}, 77
        f.api.rules.compute = compute
        def existing(c, table, rid):
            if table not in ('payroll_records', 'expenses'): raise AssertionError('Unreviewed fixture table')
            row = c.execute('SELECT * FROM ' + table + ' WHERE id=?', (rid,)).fetchone()
            if not row: raise ValueError('虚构记录不存在')
            return dict(row)
        def check_token(table, row, token):
            if f.api.r.signer().loads(token) != {'table': table, 'record': f.api.r.digest(row)}:
                raise BASE.Conflict('状态快照已变化')
        original_write = f.api.r.write_row
        def write(c, table, values, old=None):
            if table == 'payroll_records': return original_write(c, table, values, old)
            if table != 'expenses' or old is None: raise AssertionError('Unreviewed fixture write')
            c.execute('UPDATE expenses SET ' + ','.join(key + '=?' for key in values) + ' WHERE id=?', (*values.values(), old['id']))
            return old['id']
        f.api.r.existing = existing; f.api.r.check_token = check_token; f.api.r.write_row = write
        def seed(month, status='草稿', employee='虚构甲', amount=4321.09):
            inputs = {**{key: 0 for key in f.api.FIELDS}, 'mode': '固定月薪'}
            try: basis = f.api.payroll_basis(f.c, employee, month)
            except (ValueError, TypeError, AttributeError, OverflowError): basis = {'sales': [], 'expenses': []}
            outputs = {'应发工资': amount, '工资扣款': 0, '实发工资': amount, '本次支付': amount}
            row = {'employee': employee, 'month': month, 'inputs_json': json.dumps(inputs), 'outputs_json': json.dumps(outputs),
                   'basis_json': json.dumps(basis), 'basis_hash': f.api.r.digest(basis), 'rule_version': 77, 'status': status,
                   'note': '原历史保持', 'created_at': '2026-10-19 12:00:00', 'updated_at': '2026-10-19 12:00:00'}
            rid = f.c.execute('INSERT INTO payroll_records(' + ','.join(row) + ') VALUES(' + ','.join('?' for _ in row) + ')', tuple(row.values())).lastrowid
            f.c.commit(); return rid
        def state():
            return {table: [dict(row) for row in f.c.execute('SELECT * FROM ' + table + ' ORDER BY rowid')]
                    for table in ('payroll_records', 'employee_pay_profiles', 'payroll_expenses', 'expenses')}
        def status(rid, target, bad_token=False):
            row = existing(f.c, 'payroll_records', rid)
            token = f.api.r.signer().dumps({'table': 'payroll_records', 'record': f.api.r.digest(row) if not bad_token else 'changed'})
            f.api.request.form = {'status': target, 'snapshot': token}; f.api.request.method = 'POST'
            api = BASE.selected('finance.py', ('payroll_status',), dict(vars(f.api)))
            return api.payroll_status(rid)
        yield types.SimpleNamespace(**vars(f), seed=seed, state=state, status=status, calls=calls)


class HistoryIdentity(unittest.TestCase):
    def assert_history_stopped(self, f, before):
        self.assertEqual(f.state(), before, 'No historical rename/merge/delete, payroll or expense write is permitted')
        self.assertTrue(any(kind == 'error' and '历史工资' in message and '核对' in message for kind, message in f.flashes))

    def test_P01_all_twelve_canonical_months_keep_separate_single_records(self):
        with fixture() as f:
            months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12']
            for month in months: f.save(month)
            rows = f.state()['payroll_records']
            self.assertEqual([row['month'] for row in rows], months); self.assertEqual(len({row['id'] for row in rows}), 12)
            self.assertFalse(any(kind == 'error' for kind, message in f.flashes))

    def test_P02_new_alias_post_is_explicitly_rejected_even_with_an_issued_preview_token(self):
        pairs = [('2026-010', '2026-10'), ('02026-10', '2026-10'), ('+2026-10', '2026-10'), ('2026-10 ', '2026-10'), ('2026-1', '2026-01')]
        for alias, canonical in pairs:
            with self.subTest(alias=alias), fixture() as f:
                f.save(canonical); before = f.state()
                preview = f.invoke(alias); normal = f.invoke(canonical)
                token = preview.get('snapshot') or normal['snapshot']
                f.invoke(alias, 'POST', token)
                self.assertEqual(f.state(), before)
                self.assertTrue(any(kind == 'error' and '规范' in message and 'YYYY-MM' in message for kind, message in f.flashes))

    def test_P03_existing_single_alias_blocks_new_canonical_preview_and_save(self):
        for alias, canonical in [('2026-010', '2026-10'), ('2026-1', '2026-01'), ('02026-10', '2026-10')]:
            with self.subTest(alias=alias), fixture() as f:
                f.seed(alias); before = f.state(); viewed = f.invoke(canonical)
                self.assertEqual(viewed['snapshot'], '')
                f.invoke(canonical, 'POST', '')
                self.assert_history_stopped(f, before)

    def test_P04_history_alias_get_keeps_original_record_basis_and_amount_without_rule_compute(self):
        with fixture() as f:
            rid = f.seed('2026-010', '已确认'); before = f.state()
            viewed = f.invoke('2026-010')
            self.assertEqual(viewed['record']['id'], rid); self.assertEqual(viewed['record']['month'], '2026-010')
            self.assertEqual(viewed['outputs']['本次支付'], 4321.09); self.assertEqual(viewed['basis'], json.loads(before['payroll_records'][0]['basis_json']))
            self.assertEqual(viewed['snapshot'], ''); self.assertEqual(f.calls, [])
            self.assert_history_stopped(f, before)

    def test_P05_canonical_and_alias_history_blocks_canonical_overwrite(self):
        with fixture() as f:
            f.seed('2026-10'); f.seed('2026-010'); before = f.state()
            f.save('2026-10'); f.invoke('2026-10', 'POST', '')
            self.assert_history_stopped(f, before)

    def test_P06_multiple_aliases_without_canonical_do_not_allow_a_third_record(self):
        with fixture() as f:
            f.seed('2026-010'); f.seed('+2026-10'); before = f.state()
            f.save('2026-10'); self.assert_history_stopped(f, before)

    def test_P07_alias_record_cannot_confirm_or_pay(self):
        for initial, target in [('草稿', '已确认'), ('已确认', '已发放')]:
            with self.subTest(initial=initial), fixture() as f:
                rid = f.seed('2026-010', initial); before = f.state()
                f.status(rid, target); self.assert_history_stopped(f, before)

    def test_P08_canonical_record_with_alias_history_cannot_confirm_or_pay(self):
        for initial, target in [('草稿', '已确认'), ('已确认', '已发放')]:
            with self.subTest(initial=initial), fixture() as f:
                rid = f.seed('2026-10', initial); f.seed('2026-010'); before = f.state()
                f.status(rid, target); self.assert_history_stopped(f, before)

    def test_P09_single_canonical_zero_payroll_retains_save_confirm_and_paid_flow(self):
        with fixture() as f:
            f.save('2026-10'); f.save('2026-10'); rows = f.state()['payroll_records']; self.assertEqual(len(rows), 1)
            rid = rows[0]['id']; f.status(rid, '已确认'); self.assertEqual(f.state()['payroll_records'][0]['status'], '已确认')
            f.status(rid, '已发放'); saved = f.state()['payroll_records'][0]
            self.assertEqual(saved['status'], '已发放'); self.assertEqual(json.loads(saved['outputs_json'])['本次支付'], 0)
            self.assertFalse(any(kind == 'error' for kind, message in f.flashes))

    def test_P10_other_employee_or_other_known_natural_month_alias_does_not_block(self):
        with fixture() as f:
            f.seed('2026-010', employee='虚构乙'); f.seed('2026-011'); f.save('2026-10')
            own = [row for row in f.state()['payroll_records'] if row['employee'] == '虚构甲' and row['month'] == '2026-10']
            self.assertEqual(len(own), 1); self.assertFalse(any(kind == 'error' for kind, message in f.flashes))

    def test_P11_unparseable_history_fails_closed_instead_of_guessing_its_period(self):
        for malformed in ('年份月份待核对', '999999999999999999999999-10'):
            with self.subTest(malformed=malformed), fixture() as f:
                f.seed(malformed); before = f.state(); f.save('2026-10')
                self.assert_history_stopped(f, before)

    def test_P12_confirmed_canonical_get_uses_saved_values_without_recomputing(self):
        with fixture() as f:
            f.seed('2026-10', '已确认', amount=7654.32); before = f.state(); viewed = f.invoke('2026-10')
            self.assertEqual(viewed['outputs']['本次支付'], 7654.32); self.assertEqual(f.calls, []); self.assertEqual(f.state(), before)
            self.assertFalse(any(kind == 'error' for kind, message in f.flashes))

    def test_P13_status_still_checks_original_row_token_before_month_history(self):
        with fixture() as f:
            rid = f.seed('2026-10'); f.seed('2026-010'); before = f.state(); f.status(rid, '已确认', bad_token=True)
            self.assertEqual(f.state(), before); self.assertTrue(any('状态快照已变化' in message for kind, message in f.flashes))

    def test_P14_invalid_and_overflowing_new_months_fail_with_controlled_identity_reason(self):
        for malformed in (None, '2026-00', '2026-13', '2026-10-01', '999999999999999999999999-10'):
            with self.subTest(malformed=malformed), fixture() as f:
                before = f.state(); f.invoke(malformed, 'POST', '')
                self.assertEqual(f.state(), before); self.assertEqual(f.calls, [])
                self.assertTrue(any(kind == 'error' and '规范' in message and 'YYYY-MM' in message for kind, message in f.flashes))


def main():
    parser = argparse.ArgumentParser(allow_abbrev=False)
    parser.add_argument('--test-sha256', required=True); parser.add_argument('--pins-sha256', required=True)
    parser.add_argument('--expected-namespace', required=True); parser.add_argument('--phase', choices=('red', 'candidate'), required=True)
    args = parser.parse_args()
    if any(not re.fullmatch('[a-f0-9]{64}', value) for value in (args.test_sha256, args.pins_sha256)) or str(uuid.UUID(args.expected_namespace)) != args.expected_namespace:
        raise RuntimeError('Exact self/pins hashes and actual namespace required')
    if hashlib.sha256(read(ROOT / SELF)).hexdigest() != args.test_sha256: raise RuntimeError('Frozen payroll identity test changed')
    if hashlib.sha256(read(PYTHON)).hexdigest() != '434b361fe0c5960d404974feed493db47f2603a1ace2574312104fbed0182c6f' or sys.version_info[:3] != (3, 14, 8) or importlib.util.MAGIC_NUMBER.hex() != '2b0e0d0a': raise RuntimeError('Fixed Python runtime changed')
    guards = {}
    for name, pin in GUARDS.items():
        guards[name] = read(ROOT / name)
        if hashlib.sha256(guards[name]).hexdigest() != pin: raise RuntimeError('Original admission changed')
    guard = types.ModuleType('payroll_month_actual_context'); guard.__file__ = str(ROOT / 'stage1/sandbox-context.py')
    exec(compile(guards['stage1/sandbox-context.py'], guard.__file__, 'exec'), guard.__dict__)
    proof = guard.read_context(ROOT)
    if json.loads(read(ROOT / 'isolation-identity.json').decode('utf-8-sig')).get('namespace') != args.expected_namespace: raise RuntimeError('Actual namespace mismatch')
    pin_body = read(ROOT / PIN_FILE)
    if hashlib.sha256(pin_body).hexdigest() != args.pins_sha256: raise RuntimeError('Source pin manifest changed')
    manifest = json.loads(pin_body)
    if manifest.get('purpose') != 'finance-erp170-payroll-month-source-pins' or set(manifest.get('phases', {})) != {'red', 'candidate'}: raise RuntimeError('Exact payroll source manifest required')
    pins = manifest['phases'][args.phase]
    if not isinstance(pins, dict) or set(pins) != set(FILES): raise RuntimeError('Exact finance and sidecar source closure required')
    bodies = {}
    for name, pin in pins.items():
        if not re.fullmatch('[a-f0-9]{64}', pin): raise RuntimeError('Exact source SHA required')
        bodies[name] = read(ROOT / name)
        if hashlib.sha256(bodies[name]).hexdigest() != pin: raise RuntimeError('Phase source changed: ' + name)
    original_body = read(ROOT / ORIGINAL)
    if hashlib.sha256(original_body).hexdigest() != ORIGINAL_SHA: raise RuntimeError('Original eight-method contract changed')
    global BASE
    BASE = types.ModuleType('payroll_month_original_contract'); BASE.__file__ = str(ROOT / ORIGINAL)
    exec(compile(original_body, str(ROOT / ORIGINAL), 'exec', dont_inherit=True, optimize=0), BASE.__dict__)
    BASE.BODIES.update(bodies)
    original_selected = BASE.selected
    available = {node.name for node in ast.parse(bodies[FILES[0]]).body if isinstance(node, ast.FunctionDef)}
    def select(name, functions, ports, constants=()):
        requested = tuple(functions)
        if name == 'finance.py' and ('payroll' in requested or 'payroll_status' in requested) and 'payroll_month_guard' in available:
            requested += ('payroll_month_guard',)
        return original_selected(name, requested, ports, constants)
    BASE.selected = select
    sys.addaudithook(BASE.boundary)
    print(json.dumps({'purpose': 'finance-erp170-payroll-natural-month', 'phase': args.phase, 'actualContext': proof,
                      'namespace': args.expected_namespace, 'testSha256': args.test_sha256, 'pinsSha256': args.pins_sha256, 'sourcePins': pins,
                      'originalEightSha256': ORIGINAL_SHA, 'originalAssertionsModified': False, 'originalMethods': 8, 'additionalMethods': 14,
                      'originalHttpVerified': False, 'opaqueRulesExecuted': False, 'realDataReadOrChanged': False}), flush=True)
    suite = unittest.TestSuite([unittest.defaultTestLoader.loadTestsFromTestCase(BASE.Round2), unittest.defaultTestLoader.loadTestsFromTestCase(HistoryIdentity)])
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    for name, pin in pins.items():
        if hashlib.sha256(read(ROOT / name)).hexdigest() != pin: raise RuntimeError('Source changed during payroll tests')
    print(json.dumps({'testsRun': result.testsRun, 'failures': len(result.failures), 'errors': len(result.errors), 'passed': result.wasSuccessful(),
                      'originalHttpVerified': False, 'opaqueRulesExecuted': False, 'realDataReadOrChanged': False}), flush=True)
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__': raise SystemExit(main())
