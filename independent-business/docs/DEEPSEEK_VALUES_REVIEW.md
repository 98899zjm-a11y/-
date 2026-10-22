# 数值边界回归测评（ERP / 出纳纯校验函数）

日期：2026-10-23
工作目录：`D:/Codex/xjy-business-standalone-20261023`
执行者：DeepSeek 数值测试执行者（只写 `tests/test_values_review.py`、`docs/DEEPSEEK_VALUES_REVIEW.md`）

## 范围与做法

只对两处纯校验函数做边界回归，不读数据库、不建连接、不启动服务、不碰 F 盘和正式账套。

- `vendor/ledger/erp_values.py`：`money`、`positive_money`、`weight`、`quantity`
- `vendor/ledger/cashier_engine.py`：`cents`、常量 `MAX_CENTS`

预期值全部按业务规格手算后写成字面常量（元→分、四位定点字符串、件数区间、整数分文本），不调用被测函数生成预期，也不放宽任何断言。测试文件对被测模块只读，通过 `sys.path` 指向 `vendor/ledger` 后直接 import，不复制、不重写算法。

## 环境与运行

Python：`C:/Python314/python.exe`，版本 3.14.8（MSC v.1944 64-bit）。
`-B` 运行，`PYTHONDONTWRITEBYTECODE=1`，`TEMP`/`TMP` 指向 `runtime/test-values-review/tmp`，未在工作树落 `.pyc`。

```
TEMP/TMP=runtime/test-values-review/tmp C:/Python314/python.exe -B tests/test_values_review.py -v
C:/Python314/python.exe -B -m unittest discover -s tests -p "test_values_review.py" -v
```

两种入口都实际执行过，结果一致。日志：`runtime/test-values-review/evidence/run1_utf8.log`（控制台首次运行还有一份 `run1.log`）。

## 实测结果

23 个测试方法，317 次真实断言执行（计数来自测试基类对每次 `assert*` 调用的记录，不是按行数估算），失败 0、错误 0、跳过 0，退出码 0。

分类覆盖与断言数：

- `ErpMoneyTests`：9 个方法、123 次断言。0.10/0.20/0.05/0.01/0.99 元→分；浮点舍入陷阱 0.29→29、1.15→115、2.35→235、4.35→435（二进制浮点会算成 28.999…、114.999…）；整数与一位小数 12→1200、12.3→1230；0 与 0.00→0；上限 90000000000.00→9000000000000 分、89999999999.99 合法、90000000000.01 与 999999999999.99 拒绝并核对错误文案与 `status=400`；前后空白 strip；拒绝 `True`/`False`/`0.1`/`1.0`/`nan`/`inf`/`b'0.10'`/`None`/列表；拒绝负号、科学记数、`nan`/`NaN`/`Infinity` 文本、三位小数、`1.`、`.5`、千分位、空串、纯空白、`0x10`、`+5`。
- `ErpPositiveMoneyTests`：2 个方法、12 次断言。0.01→1、1→100 通过；0 与 0.00 报"金额必须大于零"；负值、`True`、`0.5` 拒绝。
- `ErpWeightTests`：4 个方法、64 次断言。四位定点 0→"0.0000"、1.2→"1.2000"、0.0001、1.2345、12.5→"12.5000"；上限 100000000 与 100000000.0000 通过、100000000.0001 拒绝并核文案、99999999.9999 通过、123456789 因数值超 1e8 拒绝；五位小数 1.23456、0.00001、1.2345.6 拒绝；错误类型与 `.5`、`5.`、科学记数、千分位、空串拒绝。
- `ErpQuantityTests`：3 个方法、30 次断言。1、2、1000000 通过；0、-1、1000001、2**40 拒绝并核文案；`True`/`False`（bool 是 int 子类）、3.0、"3"、None、列表、字典拒绝。
- `CashierCentsTests`：5 个方法、88 次断言。整数分文本 "1"/"29"/"100" 与 int 1/100 通过；`MAX_CENTS` 等于 9_000_000_000_000，边界文本 9000000000000 通过、9000000000001 拒绝并核文案与 `status=400`、9999999999999（13 位超限）与 10000000000000（14 位词法拒绝）拒绝；默认拒绝 0 与 "0"，`zero=True` 下 0/"0"/1 通过；拒绝 `1.00`、"0.10"、"00"、"01"、`+1`、`-1`、前后空格、"1e3"、千分位、空串；拒绝 `True`/`False`/`1.0`/`0.0`/`nan`/`inf`/None/bytes/列表。

失败证据：本轮没有失败条目可留。为证明断言不是空转，另做了负向对照（仅在 `runtime/` 内，不属于交付物）：把 `money`/`weight`/`quantity` 替换成故意错误实现后重跑 4 个用例，得 `FAILED (failures=4)`，证明断言确实能咬住错误行为。日志：`runtime/test-values-review/evidence/negative_control.log`。

## 未运行与未覆盖

- 未启动任何服务，未做 HTTP/UI/宿主适配验证；`host/`、`ui/`、`desktop/` 本轮未触及。
- 未运行 `tests/test_workflows.py`（属主执行者范围，本目录当前也不存在该文件）。
- 未覆盖权限与身份校验（`require`、`permitted`、`finance_authority`、`scope`）、`erp_settlement` 核销数学、`erp_values` 的 `text`/`identifier`/`date`/`encoded`/`digest`、数据库事务与幂等；本轮任务只要求数值边界。
- 未在 pytest 下跑过（未验证本机 pytest 可用，不作为通过证据）。

## 既有行为记录（不改业务，仅记录）

- `erp_values.money` 的正则 `\d{1,12}` 允许前导零，"00.10" 会被接受并得 10 分；而出纳 `cents` 的正则 `(?:0|[1-9]\d{0,12})` 明确拒绝 "00" 和 "01"。两处口径不一致，未在断言中锁定前导零行为，留待业务确认。
- 两处上限 9_000_000_000_000 各自硬编码（`erp_values.money` 内联、`cashier_engine.MAX_CENTS`），未断言两者必须相等，避免把实现耦合写死。
- `money`/`weight` 对输入做 `strip()`，因此前后空白可接受；`cents` 不 strip，`" 1"` 直接拒绝。

结论：这组测试可以在本目录重复运行，用于拦住金额/克重/件数/整数分的边界回退；未发现被测函数与手算预期不符的情况，因此没有需要修改的业务代码，也没有放宽的断言。
