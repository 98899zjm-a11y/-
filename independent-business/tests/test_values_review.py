"""数值边界回归测试（只读被测模块，不改业务）。

被测对象（均为纯校验函数，无 I/O、无数据库、无网络）：
  vendor/ledger/erp_values.py      money / positive_money / weight / quantity
  vendor/ledger/cashier_engine.py  cents

预期值一律由人工按业务规格手算后写成字面常量（元→分、克重四位定点、
件数区间、出纳整数分字符串），不调用被测函数生成任何预期值。
运行：C:/Python314/python.exe -B tests/test_values_review.py -v
"""
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

# Use the same fixed-source loader as the standalone host. Directly importing
# vendor names before installing it makes the deliberate anti-hijack guard
# reject an otherwise valid full-suite run.
from host import compat
compat.install()

import erp_values      # noqa: E402
import cashier_engine  # noqa: E402

# 实际执行的断言计数（用于报告真实断言数，而不是猜）。
EXECUTED_ASSERTIONS = []


class CountedCase(unittest.TestCase):
    """记录每一次真实执行的断言调用。"""

    def __getattribute__(self, name):
        attr = object.__getattribute__(self, name)
        if name.startswith('assert') and callable(attr):
            def counted(*args, **kwargs):
                EXECUTED_ASSERTIONS.append(name)
                return attr(*args, **kwargs)
            return counted
        return attr


class ErpMoneyTests(CountedCase):
    """erp_values.money：Decimal 文本 → 整数分，非负，最多两位小数。"""

    def test_minor_amounts_are_exact_cents(self):
        # 手算：0.10 元 = 10 分；0.20 元 = 20 分；0.05 = 5 分。
        self.assertEqual(erp_values.money('0.10'), 10)
        self.assertEqual(erp_values.money('0.20'), 20)
        self.assertEqual(erp_values.money('0.05'), 5)
        self.assertEqual(erp_values.money('0.01'), 1)
        self.assertEqual(erp_values.money('0.99'), 99)

    def test_float_rounding_edges_stay_exact(self):
        # 二进制浮点会算出 28.999…/114.999…/434.999…，Decimal 必须精确进位。
        # 手算：0.29 元 = 29 分；1.15 元 = 115 分；2.35 元 = 235 分；4.35 元 = 435 分。
        self.assertEqual(erp_values.money('0.29'), 29)
        self.assertEqual(erp_values.money('1.15'), 115)
        self.assertEqual(erp_values.money('2.35'), 235)
        self.assertEqual(erp_values.money('4.35'), 435)

    def test_integer_and_one_decimal_text(self):
        # 手算：12 元 = 1200 分；12.3 元 = 1230 分；7 元 = 700 分。
        self.assertEqual(erp_values.money('12'), 1200)
        self.assertEqual(erp_values.money('12.3'), 1230)
        self.assertEqual(erp_values.money('7'), 700)

    def test_zero_is_allowed_for_money(self):
        self.assertEqual(erp_values.money('0'), 0)
        self.assertEqual(erp_values.money('0.00'), 0)

    def test_large_amount_upper_boundary(self):
        # 上限 = 9_000_000_000_000 分 = 90000000000.00 元。
        self.assertEqual(erp_values.money('90000000000.00'), 9000000000000)
        self.assertEqual(erp_values.money('89999999999.99'), 8999999999999)
        with self.assertRaises(erp_values.ErpError) as ctx:
            erp_values.money('90000000000.01')   # 9_000_000_000_001 分，超一分即拒
        self.assertEqual(str(ctx.exception), '金额超过允许范围。')
        self.assertEqual(ctx.exception.status, 400)
        with self.assertRaises(erp_values.ErpError):
            erp_values.money('999999999999.99')  # 合法 12 位整数部分，但总金额超限
        with self.assertRaises(erp_values.ErpError):
            erp_values.money('999999999999')     # 99_999_999_999_900 分，超限

    def test_surrounding_whitespace_is_stripped(self):
        # 源码对 value.strip() 做匹配，前后空白可接受。
        self.assertEqual(erp_values.money(' 0.10 '), 10)
        self.assertEqual(erp_values.money('\t0.20\t'), 20)

    def test_reject_bool_float_nan_and_non_text(self):
        for bad in (True, False, 0.1, 1.0, float('nan'), float('inf'), b'0.10', None, ['0.10']):
            with self.subTest(value=bad):
                with self.assertRaises(erp_values.ErpError):
                    erp_values.money(bad)

    def test_reject_non_decimal_text_forms(self):
        for bad in ('-1', '-0.01', '1e5', '1E5', 'nan', 'NaN', 'Infinity', '0.100', '1.',
                    '.5', '1,000', '', ' ', '1 0', '0x10', '+5', '1.234'):
            with self.subTest(value=bad):
                with self.assertRaises(erp_values.ErpError) as ctx:
                    erp_values.money(bad)
                self.assertEqual(str(ctx.exception), '金额须为不超过两位小数的非负十进制文本。')

    def test_reject_more_than_two_decimal_places(self):
        self.assertEqual(erp_values.money('0.12'), 12)
        with self.assertRaises(erp_values.ErpError):
            erp_values.money('0.123')
        with self.assertRaises(erp_values.ErpError):
            erp_values.money('12.345')


class ErpPositiveMoneyTests(CountedCase):
    """erp_values.positive_money：先过 money，再要求严格大于零。"""

    def test_positive_amounts_pass_through(self):
        self.assertEqual(erp_values.positive_money('0.01'), 1)
        self.assertEqual(erp_values.positive_money('1'), 100)
        self.assertEqual(erp_values.positive_money('90000000000.00'), 9000000000000)

    def test_zero_and_bad_forms_rejected(self):
        with self.assertRaises(erp_values.ErpError) as ctx:
            erp_values.positive_money('0')
        self.assertEqual(str(ctx.exception), '金额必须大于零。')
        with self.assertRaises(erp_values.ErpError):
            erp_values.positive_money('0.00')
        with self.assertRaises(erp_values.ErpError):
            erp_values.positive_money('-0.01')
        with self.assertRaises(erp_values.ErpError):
            erp_values.positive_money(True)
        with self.assertRaises(erp_values.ErpError):
            erp_values.positive_money(0.5)


class ErpWeightTests(CountedCase):
    """erp_values.weight：克重文本 → 四位定点字符串，上限 100000000。"""

    def test_four_decimal_places_exact(self):
        self.assertEqual(erp_values.weight('0'), '0.0000')
        self.assertEqual(erp_values.weight('1'), '1.0000')
        self.assertEqual(erp_values.weight('1.2'), '1.2000')
        self.assertEqual(erp_values.weight('0.0001'), '0.0001')
        self.assertEqual(erp_values.weight('1.2345'), '1.2345')
        self.assertEqual(erp_values.weight('12.5'), '12.5000')

    def test_upper_boundary(self):
        # 上限 = 100000000（含）；多 0.0001 即拒。
        self.assertEqual(erp_values.weight('100000000'), '100000000.0000')
        self.assertEqual(erp_values.weight('100000000.0000'), '100000000.0000')
        self.assertEqual(erp_values.weight('99999999.9999'), '99999999.9999')
        with self.assertRaises(erp_values.ErpError) as ctx:
            erp_values.weight('100000000.0001')
        self.assertEqual(str(ctx.exception), '克重超过允许范围。')
        with self.assertRaises(erp_values.ErpError):
            erp_values.weight('123456789')        # 9 位整数合法，但数值 1.23e8 超限

    def test_five_decimal_places_rejected(self):
        with self.assertRaises(erp_values.ErpError) as ctx:
            erp_values.weight('1.23456')
        self.assertEqual(str(ctx.exception), '克重须为不超过四位小数的非负十进制文本。')
        with self.assertRaises(erp_values.ErpError):
            erp_values.weight('0.00001')
        with self.assertRaises(erp_values.ErpError):
            erp_values.weight('1.2345.6')

    def test_reject_wrong_types_and_forms(self):
        for bad in (True, False, 1.2345, 12, None, b'1.20'):
            with self.subTest(value=bad):
                with self.assertRaises(erp_values.ErpError):
                    erp_values.weight(bad)
        for bad in ('-1', '-0.0001', '.5', '5.', '1e2', '1,000', '', ' ', '1.2.3'):
            with self.subTest(value=bad):
                with self.assertRaises(erp_values.ErpError):
                    erp_values.weight(bad)


class ErpQuantityTests(CountedCase):
    """erp_values.quantity：件数只接受 1..1000000 的真实整数。"""

    def test_boundaries_accepted(self):
        self.assertEqual(erp_values.quantity(1), 1)
        self.assertEqual(erp_values.quantity(2), 2)
        self.assertEqual(erp_values.quantity(1000000), 1000000)

    def test_boundaries_rejected(self):
        for bad in (0, -1, 1000001, 2 ** 40):
            with self.subTest(value=bad):
                with self.assertRaises(erp_values.ErpError) as ctx:
                    erp_values.quantity(bad)
                self.assertEqual(str(ctx.exception), '件数须为1至1000000的整数。')

    def test_bool_and_non_int_rejected(self):
        # bool 是 int 子类，必须显式排除。
        for bad in (True, False, 3.0, '3', None, [3], {'n': 3}):
            with self.subTest(value=bad):
                with self.assertRaises(erp_values.ErpError):
                    erp_values.quantity(bad)


class CashierCentsTests(CountedCase):
    """cashier_engine.cents：出纳金额只接受整数分（int 或纯数字文本）。"""

    def test_integer_cents_text_accepted(self):
        self.assertEqual(cashier_engine.cents('1'), 1)
        self.assertEqual(cashier_engine.cents('29'), 29)
        self.assertEqual(cashier_engine.cents('100'), 100)
        self.assertEqual(cashier_engine.cents(1), 1)
        self.assertEqual(cashier_engine.cents(100), 100)

    def test_max_cents_boundary(self):
        # cashier_engine.MAX_CENTS 必须等于 9_000_000_000_000 分。
        self.assertEqual(cashier_engine.MAX_CENTS, 9000000000000)
        self.assertEqual(cashier_engine.cents('9000000000000'), 9000000000000)
        with self.assertRaises(cashier_engine.CashierError) as ctx:
            cashier_engine.cents('9000000000001')
        self.assertEqual(str(ctx.exception), '金额超出允许范围。')
        self.assertEqual(ctx.exception.status, 400)
        with self.assertRaises(cashier_engine.CashierError):
            cashier_engine.cents('9999999999999')      # 13 位文本合法，数值超限
        with self.assertRaises(cashier_engine.CashierError):
            cashier_engine.cents('10000000000000')     # 14 位文本，词法即拒

    def test_zero_flag(self):
        with self.assertRaises(cashier_engine.CashierError) as ctx:
            cashier_engine.cents('0')
        self.assertEqual(str(ctx.exception), '金额超出允许范围。')
        with self.assertRaises(cashier_engine.CashierError):
            cashier_engine.cents(0)
        self.assertEqual(cashier_engine.cents('0', zero=True), 0)
        self.assertEqual(cashier_engine.cents(0, zero=True), 0)
        self.assertEqual(cashier_engine.cents('1', zero=True), 1)

    def test_reject_decimal_and_signed_text(self):
        for bad in ('1.00', '0.10', '00', '01', '+1', '-1', ' 1', '1 ', '1e3', '1,000', ''):
            with self.subTest(value=bad):
                with self.assertRaises(cashier_engine.CashierError) as ctx:
                    cashier_engine.cents(bad)
                self.assertEqual(str(ctx.exception), '金额须为整数分。')

    def test_reject_bool_float_nan(self):
        # type(value) is int 判定，bool/float/NaN 均不在接受范围。
        for bad in (True, False, 1.0, 0.0, float('nan'), float('inf'), None, b'1', ['1']):
            with self.subTest(value=bad):
                with self.assertRaises(cashier_engine.CashierError):
                    cashier_engine.cents(bad)


if __name__ == '__main__':
    program = unittest.main(exit=False, verbosity=2)
    result = program.result
    print('\n---- 实际运行统计 ----')
    print('测试方法数: %d' % result.testsRun)
    print('断言实际执行次数: %d' % len(EXECUTED_ASSERTIONS))
    print('失败: %d  错误: %d  跳过: %d' % (len(result.failures), len(result.errors), len(result.skipped)))
    sys.exit(0 if result.wasSuccessful() else 1)
