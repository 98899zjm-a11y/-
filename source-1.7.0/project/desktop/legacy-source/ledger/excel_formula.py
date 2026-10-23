"""Bounded, non-executable Excel formula calculation for the local workbook editor.

ExcelEngine(cells, formulas) takes {(sheet, row, column): value} dictionaries.
The cells dictionary includes the original cached formula results.  Merely opening
a workbook never recalculates those results.  recalculate(changed) updates only
the changed formula cells and their transitive dependants; recalculate() explicitly
calculates all formulas.  Results contain tuple-keyed updates/errors/details maps.
Unsupported syntax is a visible Excel error, never an assumed zero.
"""
from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation, ROUND_DOWN, ROUND_HALF_UP, ROUND_UP, localcontext
import math
import re


ERROR_CODES = frozenset({'#REF!', '#DIV/0!', '#VALUE!', '#NAME?', '#N/A',
                         '#NUM!', '#NULL!', '#SPILL!', '#CALC!', '#CYCLE!'})
MAX_FORMULA_LENGTH = 8192
MAX_TOKENS = 2048
MAX_DEPTH = 100
MAX_RANGE_CELLS = 100000
MAX_DEPENDENCIES = 2000000
MAX_NUMBER = 1e100
MAX_TEXT = 32767


class ExcelError(Exception):
    def __init__(self, code, detail=''):
        self.code = code
        self.detail = detail or code
        super().__init__(self.detail)


def column_number(label):
    n = 0
    for char in label.upper().replace('$', ''):
        if not 'A' <= char <= 'Z':
            raise ExcelError('#REF!', '无效的列引用')
        n = n * 26 + ord(char) - 64
    if not 1 <= n <= 16384:
        raise ExcelError('#REF!', '列引用超过 Excel 范围')
    return n


def column_label(number):
    if not 1 <= number <= 16384:
        raise ExcelError('#REF!', '列引用超过 Excel 范围')
    out = ''
    while number:
        number, rem = divmod(number - 1, 26)
        out = chr(65 + rem) + out
    return out


def cell_address(row, column):
    return column_label(column) + str(row)


def _finite(value):
    if not math.isfinite(value) or abs(value) > MAX_NUMBER:
        raise ExcelError('#NUM!', '数值超过允许的计算范围')
    return value


def _check_error(value):
    if isinstance(value, str) and value in ERROR_CODES:
        raise ExcelError(value, '引用的单元格包含 ' + value)
    return value


def _number(value, text=True):
    _check_error(value)
    if value is None or value == '':
        return 0.0
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, (int, float, Decimal)):
        return _finite(float(value))
    if isinstance(value, (datetime, date)):
        day = value.date() if isinstance(value, datetime) else value
        return float((day - date(1899, 12, 30)).days)
    if text and isinstance(value, str):
        s = value.strip()
        try:
            return _finite(float(s[:-1]) / 100 if s.endswith('%') else float(s))
        except ValueError:
            pass
    raise ExcelError('#VALUE!', '文本不能用于此数值计算')


def _text(value):
    _check_error(value)
    if value is None:
        return ''
    if isinstance(value, bool):
        return 'TRUE' if value else 'FALSE'
    if isinstance(value, float):
        return str(int(value)) if value.is_integer() else format(value, '.15g')
    return str(value)


def _truth(value):
    _check_error(value)
    if value is None or value == '':
        return False
    if isinstance(value, str):
        if value.upper() == 'TRUE': return True
        if value.upper() == 'FALSE': return False
        raise ExcelError('#VALUE!', '条件需要逻辑值或数字')
    return bool(_number(value))


def _compare(left, right, op):
    _check_error(left); _check_error(right)
    # Excel compares text without case sensitivity, and orders numbers before text
    # before logical values.  Blank is zero or empty text according to its peer.
    if left is None: left = '' if isinstance(right, str) else 0
    if right is None: right = '' if isinstance(left, str) else 0
    def sortable(v):
        if isinstance(v, bool): return 2, int(v)
        if isinstance(v, (int, float, Decimal)): return 0, _number(v)
        return 1, _text(v).casefold()
    a, b = sortable(left), sortable(right)
    if op == '=': return a == b
    if op == '<>': return a != b
    if op == '<': return a < b
    if op == '>': return a > b
    if op == '<=': return a <= b
    return a >= b


@dataclass(frozen=True)
class Token:
    kind: str
    value: object


def _tokenize(formula):
    if not isinstance(formula, str) or len(formula) > MAX_FORMULA_LENGTH:
        raise ExcelError('#VALUE!', '公式过长或不是文本')
    s = formula.strip()
    if s.startswith('='): s = s[1:]
    tokens = []
    i = 0
    while i < len(s):
        if s[i].isspace(): i += 1; continue
        c = s[i]
        if c in ('"', "'"):
            quote = c; i += 1; value = ''
            while i < len(s):
                if s[i] == quote:
                    if i + 1 < len(s) and s[i + 1] == quote:
                        value += quote; i += 2; continue
                    i += 1; break
                value += s[i]; i += 1
            else:
                raise ExcelError('#VALUE!', '公式引号没有闭合')
            tokens.append(Token('STRING' if quote == '"' else 'SHEET', value))
        elif c == '#':
            found = next((e for e in sorted(ERROR_CODES, key=len, reverse=True)
                          if s.startswith(e, i)), None)
            if not found: raise ExcelError('#NAME?', '不支持的错误值或动态引用')
            tokens.append(Token('ERROR', found)); i += len(found)
        elif c.isdigit() or (c == '.' and i + 1 < len(s) and s[i + 1].isdigit()):
            m = re.match(r'(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?', s[i:])
            tokens.append(Token('NUMBER', _finite(float(m.group())))); i += len(m.group())
        elif c in '+-*/^&=<>%(),:!;':
            op = s[i:i+2] if s[i:i+2] in ('<=', '>=', '<>') else c
            tokens.append(Token('OP', ',' if op == ';' else op)); i += len(op)
        else:
            m = re.match(r'[\w.$\u0080-\uffff]+', s[i:], re.UNICODE)
            if not m: raise ExcelError('#NAME?', '不支持的公式字符：' + c)
            word = m.group(); i += len(word)
            kind = 'REF' if re.fullmatch(r'\$?[A-Za-z]{1,3}\$?\d+', word) else 'NAME'
            tokens.append(Token(kind, word))
        if len(tokens) > MAX_TOKENS:
            raise ExcelError('#VALUE!', '公式操作数量超过限制')
    tokens.append(Token('EOF', ''))
    return tokens


class Parser:
    BP = {'=': 10, '<>': 10, '<': 10, '>': 10, '<=': 10, '>=': 10,
          '&': 20, '+': 30, '-': 30, '*': 40, '/': 40, '^': 50, '%': 60}

    def __init__(self, formula, sheet):
        self.tokens = _tokenize(formula); self.pos = 0; self.sheet = sheet

    def peek(self, value=None):
        t = self.tokens[self.pos]
        return t.value == value if value is not None else t

    def take(self, value=None):
        t = self.peek()
        if value is not None and t.value != value:
            raise ExcelError('#VALUE!', '公式语法错误，需要 ' + value)
        self.pos += 1
        return t

    def reference(self, token, sheet, qualified=False):
        if token.kind != 'REF': raise ExcelError('#REF!', '需要 A1 格式的单元格引用')
        m = re.fullmatch(r'\$?([A-Za-z]+)\$?(\d+)', token.value)
        if len(m[2]) > 7: raise ExcelError('#REF!', '行引用超过 Excel 范围')
        row = int(m[2]); col = column_number(m[1])
        if not 1 <= row <= 1048576: raise ExcelError('#REF!', '行引用超过 Excel 范围')
        return ('ref', sheet, row, col, qualified)

    def atom(self, depth):
        if depth > MAX_DEPTH: raise ExcelError('#VALUE!', '公式嵌套超过限制')
        token = self.take()
        if token.kind in ('NUMBER', 'STRING', 'ERROR'):
            return ('literal', token.value)
        if token.value in ('+', '-'):
            return ('unary', token.value, self.expression(70, depth + 1))
        if token.value == '(':
            out = self.expression(0, depth + 1); self.take(')'); return out
        if token.kind in ('SHEET', 'NAME', 'REF'):
            if self.peek('!'):
                self.take('!'); return self.reference(self.take(), token.value, True)
            if token.kind == 'REF': return self.reference(token, self.sheet)
            if token.kind == 'SHEET': raise ExcelError('#REF!', '工作表名称后需要 ! 引用')
            name = str(token.value).upper()
            if self.peek('('):
                self.take('('); args = []
                if not self.peek(')'):
                    while True:
                        args.append(('literal', None) if self.peek(',') or self.peek(')')
                                    else self.expression(0, depth + 1))
                        if not self.peek(','): break
                        self.take(',')
                self.take(')'); return ('call', name, args)
            if name in ('TRUE', 'FALSE'): return ('literal', name == 'TRUE')
            raise ExcelError('#NAME?', '不支持命名区域：' + str(token.value))
        raise ExcelError('#VALUE!', '公式缺少有效表达式')

    def expression(self, minimum=0, depth=0):
        left = self.atom(depth)
        if self.peek(':'):
            if left[0] != 'ref': raise ExcelError('#REF!', '范围起点需要单元格引用')
            self.take(':'); right = self.atom(depth + 1)
            if right[0] != 'ref': raise ExcelError('#REF!', '范围终点需要单元格引用')
            # An unqualified range endpoint inherits its first endpoint's sheet.
            if not right[4]: right = ('ref', left[1], right[2], right[3], False)
            if left[1].casefold() != right[1].casefold():
                raise ExcelError('#REF!', '不支持三维跨工作表范围')
            left = ('range', left, right)
        while self.peek().value in self.BP and self.BP[self.peek().value] >= minimum:
            op = self.take().value; bp = self.BP[op]
            if op == '%': left = ('unary', '%', left); continue
            # Excel operators with equal priority calculate from left to right.
            right = self.expression(bp + 1, depth + 1)
            left = ('binary', op, left, right)
        return left

    def parse(self):
        node = self.expression()
        if self.peek().kind != 'EOF': raise ExcelError('#VALUE!', '公式中有未支持的内容')
        return node


@dataclass(frozen=True)
class Range:
    engine: object
    sheet: str
    row1: int
    col1: int
    row2: int
    col2: int

    @property
    def shape(self): return self.row2 - self.row1 + 1, self.col2 - self.col1 + 1

    def keys(self):
        for row in range(self.row1, self.row2 + 1):
            for col in range(self.col1, self.col2 + 1):
                yield (self.sheet, row, col)

    def values(self):
        for key in self.keys(): yield self.engine._read(key)

    def at(self, offset):
        width = self.shape[1]
        return self.engine._read((self.sheet, self.row1 + offset // width,
                                 self.col1 + offset % width))


class ExcelEngine:
    def __init__(self, cells, formulas):
        self.cells = dict(cells)
        self.formulas = dict(formulas)
        if len(self.cells) + len(self.formulas) > 1000000:
            raise ExcelError('#VALUE!', '工作簿单元格数量超过限制')
        self._sheets = {str(k[0]).casefold(): str(k[0])
                        for k in list(self.cells) + list(self.formulas)}
        self._trees = {}; self._parse_errors = {}; self.dependencies = {}
        self._active = None; self._done = {}; self._stack = []; self._details = {}
        self._build_dependencies()

    def _canonical(self, key):
        sheet, row, col = key
        canonical = self._sheets.get(str(sheet).casefold())
        if canonical is None: raise ExcelError('#REF!', '工作表不存在：' + str(sheet))
        if not isinstance(row, int) or not isinstance(col, int) or not 1 <= row <= 1048576 or not 1 <= col <= 16384:
            raise ExcelError('#REF!', '单元格地址超出范围')
        return canonical, row, col

    def _range(self, node):
        a, b = node[1], node[2]
        first = self._canonical((a[1], a[2], a[3])); last = self._canonical((b[1], b[2], b[3]))
        r1, r2 = sorted((first[1], last[1])); c1, c2 = sorted((first[2], last[2]))
        if (r2 - r1 + 1) * (c2 - c1 + 1) > MAX_RANGE_CELLS:
            raise ExcelError('#VALUE!', '引用范围超过 100000 个单元格')
        return Range(self, first[0], r1, c1, r2, c2)

    def _references(self, node):
        kind = node[0]
        if kind == 'ref': yield self._canonical((node[1], node[2], node[3]))
        elif kind == 'range': yield from self._range(node).keys()
        elif kind == 'unary': yield from self._references(node[2])
        elif kind == 'binary':
            yield from self._references(node[2]); yield from self._references(node[3])
        elif kind == 'call':
            for arg in node[2]: yield from self._references(arg)

    def _build_dependencies(self):
        self._trees = {}; self._parse_errors = {}; self.dependencies = {}
        total = 0
        for key, formula in self.formulas.items():
            try:
                tree = Parser(formula, key[0]).parse()
                refs = set(self._references(tree))
                total += len(refs)
                if total > MAX_DEPENDENCIES: raise ExcelError('#VALUE!', '工作簿引用数量超过限制')
                self._trees[key] = tree; self.dependencies[key] = refs
            except (ExcelError, RecursionError) as error:
                if not isinstance(error, ExcelError): error = ExcelError('#VALUE!', '公式嵌套超过限制')
                self._parse_errors[key] = error; self.dependencies[key] = set()

    def value(self, sheet, row, col):
        """Read the current result; existing cached formula values are preserved."""
        try: return self._read(self._canonical((sheet, row, col)))
        except ExcelError as error: return error.code

    def set_cell(self, sheet, row, col, value, formula=None):
        """Edit one cell before recalculate({key}); formula=None removes a formula."""
        key = self._canonical((sheet, row, col)); self.cells[key] = value
        if formula is None: self.formulas.pop(key, None)
        else: self.formulas[key] = formula
        return key

    def recalculate(self, changed=None):
        """Return affected formula updates and explicit errors without masking them."""
        self._build_dependencies()
        if changed is None:
            targets = set(self.formulas)
        else:
            changed = {self._canonical(tuple(k)) for k in changed}
            reverse = defaultdict(set)
            for formula, refs in self.dependencies.items():
                for ref in refs: reverse[ref].add(formula)
            targets = set(changed) & self.formulas.keys(); seen = set(changed); todo = deque(changed)
            while todo:
                for key in reverse[todo.popleft()]:
                    targets.add(key)
                    if key not in seen: seen.add(key); todo.append(key)
        self._active = targets; self._done = {}; self._details = {}; self._stack = []
        updates = {}; errors = {}
        for key in sorted(targets):
            value = self._read(key); updates[key] = value
            if isinstance(value, str) and value in ERROR_CODES: errors[key] = value
        self.cells.update(updates)
        self._active = None
        return {'updates': updates, 'errors': errors, 'details': dict(self._details)}

    def _read(self, key):
        key = self._canonical(key)
        if key not in self.formulas: return self.cells.get(key)
        if self._active is None or key not in self._active:
            if key in self.cells: return self.cells[key]
        if key in self._done: return self._done[key]
        if key in self._stack:
            raise ExcelError('#CYCLE!', '公式存在循环引用：' + key[0] + '!' + cell_address(key[1], key[2]))
        if len(self._stack) >= MAX_DEPTH:
            raise ExcelError('#VALUE!', '公式引用链超过 100 层')
        self._stack.append(key)
        try:
            if key in self._parse_errors: raise self._parse_errors[key]
            value = self._eval(self._trees[key], key)
            if isinstance(value, Range): raise ExcelError('#VALUE!', '范围不能直接作为单格结果')
            if value is None: value = 0.0
            _check_error(value)
            if isinstance(value, (int, float)) and not isinstance(value, bool): value = _finite(float(value))
            if isinstance(value, str) and len(value) > MAX_TEXT: raise ExcelError('#VALUE!', '文本计算结果过长')
        except ExcelError as error:
            value = error.code; self._details[key] = error.detail
        except (ValueError, TypeError, OverflowError, InvalidOperation, RecursionError):
            value = '#VALUE!'; self._details[key] = '公式计算失败，请检查参数及数据类型'
        finally:
            self._stack.pop()
        self._done[key] = value
        return value

    def _scalar(self, value):
        if isinstance(value, Range):
            if value.shape != (1, 1): raise ExcelError('#VALUE!', '此位置需要单个值')
            return value.at(0)
        return value

    def _eval(self, node, key, depth=0):
        if depth > MAX_DEPTH: raise ExcelError('#VALUE!', '公式计算嵌套超过限制')
        kind = node[0]
        if kind == 'literal': return _check_error(node[1])
        if kind == 'ref': return _check_error(self._read((node[1], node[2], node[3])))
        if kind == 'range': return self._range(node)
        if kind == 'call': return self._function(node[1], node[2], key, depth + 1)
        if kind == 'unary':
            value = _number(self._scalar(self._eval(node[2], key, depth + 1)))
            return -value if node[1] == '-' else value / 100 if node[1] == '%' else value
        left = self._scalar(self._eval(node[2], key, depth + 1))
        right = self._scalar(self._eval(node[3], key, depth + 1)); op = node[1]
        if op in ('=', '<>', '<', '>', '<=', '>='): return _compare(left, right, op)
        if op == '&':
            value = _text(left) + _text(right)
            if len(value) > MAX_TEXT: raise ExcelError('#VALUE!', '文本计算结果过长')
            return value
        a = _number(left); b = _number(right)
        if op == '+': return _finite(a + b)
        if op == '-': return _finite(a - b)
        if op == '*': return _finite(a * b)
        if op == '/':
            if b == 0: raise ExcelError('#DIV/0!', '除数为 0 或空白')
            return _finite(a / b)
        if abs(b) > 10000: raise ExcelError('#NUM!', '指数超过允许范围')
        try:
            value = a ** b
            if isinstance(value, complex): raise ExcelError('#NUM!', '计算结果不是实数')
            return _finite(value)
        except (OverflowError, ZeroDivisionError): raise ExcelError('#NUM!', '幂运算超出允许范围')

    def _function(self, name, args, key, depth):
        def require(low, high=None):
            if not low <= len(args) <= (low if high is None else high):
                raise ExcelError('#VALUE!', name + ' 参数数量错误')
        def val(index): return self._scalar(self._eval(args[index], key, depth + 1))
        def num(index): return _number(val(index))
        if name == 'IF':
            require(2, 3)
            selected = 1 if _truth(val(0)) else 2
            return val(selected) if selected < len(args) else False
        if name in ('IFERROR', 'IFNA'):
            require(2)
            try: return val(0)
            except ExcelError as error:
                if error.code == '#CYCLE!': raise
                if name == 'IFNA' and error.code != '#N/A': raise
                return val(1)
        if name in ('ISERROR', 'ISERR', 'ISNA'):
            require(1)
            try: val(0); return False
            except ExcelError as error:
                return error.code == '#N/A' if name == 'ISNA' else error.code != '#N/A' if name == 'ISERR' else True
        if name in ('ISBLANK', 'ISNUMBER', 'ISTEXT'):
            require(1); value = val(0)
            return value is None if name == 'ISBLANK' else isinstance(value, (int, float)) and not isinstance(value, bool) if name == 'ISNUMBER' else isinstance(value, str)
        if name in ('ROW', 'COLUMN'):
            require(0, 1)
            if not args: return key[1 if name == 'ROW' else 2]
            ref = args[0]
            if ref[0] == 'range': ref = ref[1]
            if ref[0] != 'ref': raise ExcelError('#VALUE!', name + ' 需要单元格引用')
            self._canonical((ref[1], ref[2], ref[3]))
            return ref[2 if name == 'ROW' else 3]
        if name in ('TRUE', 'FALSE'): require(0); return name == 'TRUE'
        if name == 'NA': require(0); raise ExcelError('#N/A', '公式请求 N/A')
        if name == 'NOT': require(1); return not _truth(val(0))
        if name in ('AND', 'OR'):
            require(1, 255); logical = []
            for arg in args:
                item = self._eval(arg, key, depth + 1)
                if isinstance(item, Range):
                    for v in item.values():
                        _check_error(v)
                        if v is not None and not isinstance(v, str): logical.append(_truth(v))
                else: logical.append(_truth(item))
            if not logical: raise ExcelError('#VALUE!', '没有可用的逻辑值')
            return all(logical) if name == 'AND' else any(logical)
        if name in ('SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'COUNTA', 'PRODUCT'):
            require(1, 255); numbers = []; counta = 0
            for arg in args:
                value = self._eval(arg, key, depth + 1)
                referenced = isinstance(value, Range) or arg[0] == 'ref'
                items = value.values() if isinstance(value, Range) else (value,)
                for item in items:
                    if name not in ('COUNT', 'COUNTA'): _check_error(item)
                    if item is not None: counta += 1
                    if referenced:
                        if isinstance(item, (int, float, Decimal)) and not isinstance(item, bool): numbers.append(_number(item))
                    elif item is not None and item != '':
                        try: numbers.append(_number(item))
                        except ExcelError:
                            if name != 'COUNT': raise
            if name == 'COUNTA': return counta
            if name == 'COUNT': return len(numbers)
            if name == 'SUM': return _finite(math.fsum(numbers))
            if name == 'AVERAGE':
                if not numbers: raise ExcelError('#DIV/0!', '平均值范围没有数字')
                return _finite(math.fsum(numbers) / len(numbers))
            if name == 'MIN': return min(numbers, default=0)
            if name == 'MAX': return max(numbers, default=0)
            return _finite(math.prod(numbers)) if numbers else 0
        if name in ('SUMIFS', 'COUNTIFS', 'SUMIF', 'COUNTIF'):
            return self._conditional(name, args, key, depth)
        if name in ('ROUND', 'ROUNDUP', 'ROUNDDOWN'):
            require(2); digits = int(num(1))
            if abs(digits) > 100: raise ExcelError('#NUM!', '小数位超过允许范围')
            rounding = ROUND_HALF_UP if name == 'ROUND' else ROUND_UP if name == 'ROUNDUP' else ROUND_DOWN
            with localcontext() as context:
                context.prec = 220
                return _finite(float(Decimal(str(num(0))).quantize(Decimal(1).scaleb(-digits), rounding=rounding)))
        if name in ('ABS', 'INT', 'SIGN', 'SQRT'):
            require(1); x = num(0)
            if name == 'ABS': return abs(x)
            if name == 'INT': return math.floor(x)
            if name == 'SIGN': return (x > 0) - (x < 0)
            if x < 0: raise ExcelError('#NUM!', '负数不能求实数平方根')
            return math.sqrt(x)
        if name in ('MOD', 'POWER'):
            require(2); a, b = num(0), num(1)
            if name == 'MOD':
                if b == 0: raise ExcelError('#DIV/0!', '余数运算除数为 0')
                return a % b
            return self._eval(('binary', '^', ('literal', a), ('literal', b)), key, depth + 1)
        if name in ('LEN', 'LEFT', 'RIGHT', 'MID', 'TRIM', 'UPPER', 'LOWER', 'CONCAT', 'CONCATENATE'):
            if name in ('CONCAT', 'CONCATENATE'):
                require(1, 255); parts = []; total_length = 0
                for arg in args:
                    item = self._eval(arg, key, depth + 1)
                    for v in item.values() if isinstance(item, Range) else (item,):
                        part = _text(v); total_length += len(part)
                        if total_length > MAX_TEXT: raise ExcelError('#VALUE!', '文本计算结果过长')
                        parts.append(part)
                output = ''.join(parts)
                if len(output) > MAX_TEXT: raise ExcelError('#VALUE!', '文本计算结果过长')
                return output
            require(3 if name == 'MID' else 1, 3 if name == 'MID' else 2 if name in ('LEFT', 'RIGHT') else 1)
            text = _text(val(0))
            if name == 'LEN': return len(text)
            if name == 'TRIM': return ' '.join(p for p in text.split(' ') if p)
            if name == 'UPPER': return text.upper()
            if name == 'LOWER': return text.lower()
            size = int(num(2 if name == 'MID' else 1)) if len(args) > 1 else 1
            if size < 0: raise ExcelError('#VALUE!', '截取长度不能为负数')
            if name == 'LEFT': return text[:size]
            if name == 'RIGHT': return text[-size:] if size else ''
            start = int(num(1))
            if start < 1: raise ExcelError('#VALUE!', 'MID 起点必须大于 0')
            return text[start - 1:start - 1 + size]
        if name in ('DATE', 'YEAR', 'MONTH', 'DAY'):
            require(3 if name == 'DATE' else 1)
            if name == 'DATE':
                year, month, day = int(num(0)), int(num(1)), int(num(2))
                if 0 <= year < 1900: year += 1900
                year += (month - 1) // 12; month = (month - 1) % 12 + 1
                try: return (date(year, month, 1) + timedelta(days=day - 1)).isoformat()
                except (OverflowError, ValueError): raise ExcelError('#NUM!', '日期超出允许范围')
            value = val(0)
            try:
                if isinstance(value, (int, float)): d = date(1899, 12, 30) + timedelta(days=int(value))
                elif isinstance(value, (date, datetime)): d = value
                else: d = date.fromisoformat(str(value)[:10])
                return d.year if name == 'YEAR' else d.month if name == 'MONTH' else d.day
            except (OverflowError, ValueError): raise ExcelError('#VALUE!', '日期格式无效')
        raise ExcelError('#NAME?', '不支持的函数：' + name)

    def _conditional(self, name, args, key, depth):
        def evaluate(node): return self._eval(node, key, depth + 1)
        def as_range(node):
            value = evaluate(node)
            if not isinstance(value, Range):
                if node[0] == 'ref': value = Range(self, *self._canonical((node[1], node[2], node[3])), node[2], node[3])
                else: raise ExcelError('#VALUE!', name + ' 需要单元格范围')
            return value
        summing = name.startswith('SUM')
        if name in ('SUMIF', 'COUNTIF'):
            if len(args) not in ((2, 3) if summing else (2,)):
                raise ExcelError('#VALUE!', name + ' 参数数量错误')
            ranges = [as_range(args[0])]; criteria = [self._criterion(self._scalar(evaluate(args[1])))]
            sumrange = as_range(args[2]) if len(args) == 3 else ranges[0]
            if sumrange.shape != ranges[0].shape and summing:
                h, w = ranges[0].shape
                sumrange = Range(self, sumrange.sheet, sumrange.row1, sumrange.col1,
                                 sumrange.row1 + h - 1, sumrange.col1 + w - 1)
        else:
            start = 1 if summing else 0
            if len(args) < start + 2 or (len(args) - start) % 2:
                raise ExcelError('#VALUE!', name + ' 参数数量错误')
            sumrange = as_range(args[0]) if summing else None
            ranges = [as_range(args[i]) for i in range(start, len(args), 2)]
            criteria = [self._criterion(self._scalar(evaluate(args[i]))) for i in range(start + 1, len(args), 2)]
            if any(r.shape != ranges[0].shape for r in ranges) or (summing and sumrange.shape != ranges[0].shape):
                raise ExcelError('#VALUE!', name + ' 所有范围必须大小一致')
        results = []; count = 0
        for offset in range(ranges[0].shape[0] * ranges[0].shape[1]):
            if all(test(r.at(offset)) for r, test in zip(ranges, criteria)):
                count += 1
                if summing:
                    value = sumrange.at(offset); _check_error(value)
                    if isinstance(value, (int, float, Decimal)) and not isinstance(value, bool): results.append(_number(value))
        return _finite(math.fsum(results)) if summing else count

    @staticmethod
    def _criterion(criterion):
        _check_error(criterion)
        if criterion is None: criterion = 0
        if not isinstance(criterion, str):
            return lambda value: _compare(0 if value is None else value, criterion, '=')
        match = re.match(r'^(<=|>=|<>|=|<|>)(.*)$', criterion, re.S)
        op, rhs = match.groups() if match else ('=', criterion)
        try:
            target = _number(rhs) if rhs.strip() else rhs
            numeric = isinstance(target, (int, float))
        except ExcelError: target = rhs; numeric = False
        if numeric:
            def numeric_test(value):
                _check_error(value)
                if value is None or value == '': candidate = 0
                else:
                    try: candidate = _number(value)
                    except ExcelError: return op == '<>'
                return _compare(candidate, target, op)
            return numeric_test
        wildcard = []; i = 0
        while i < len(rhs):
            if rhs[i] == '~' and i + 1 < len(rhs):
                i += 1; wildcard.append(('char', rhs[i].casefold()))
            elif rhs[i] == '*':
                if not wildcard or wildcard[-1][0] != 'star': wildcard.append(('star', ''))
            elif rhs[i] == '?': wildcard.append(('any', ''))
            else: wildcard.append(('char', rhs[i].casefold()))
            i += 1
        def wildcard_match(text):
            # Bounded greedy wildcard matching avoids regex backtracking attacks.
            text = text.casefold(); ti = pi = 0; star = -1; restart = 0; steps = 0
            while ti < len(text):
                steps += 1
                if steps > 1000000: raise ExcelError('#VALUE!', '通配符比较过于复杂')
                if pi < len(wildcard) and (wildcard[pi][0] == 'any' or wildcard[pi] == ('char', text[ti])):
                    ti += 1; pi += 1
                elif pi < len(wildcard) and wildcard[pi][0] == 'star':
                    star = pi; restart = ti; pi += 1
                elif star >= 0:
                    restart += 1; ti = restart; pi = star + 1
                else: return False
            while pi < len(wildcard) and wildcard[pi][0] == 'star': pi += 1
            return pi == len(wildcard)
        def text_test(value):
            _check_error(value)
            candidate = '' if value is None else _text(value)
            if op in ('=', '<>'):
                matched = wildcard_match(candidate)
                return matched if op == '=' else not matched
            return _compare(candidate, rhs, op)
        return text_test


SUPPORTED_FUNCTIONS = ('IF', 'IFERROR', 'IFNA', 'ISERROR', 'ISERR', 'ISNA',
    'ISBLANK', 'ISNUMBER', 'ISTEXT', 'ROW', 'COLUMN', 'TRUE', 'FALSE', 'NA',
    'NOT', 'AND', 'OR', 'SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'COUNTA',
    'PRODUCT', 'SUMIFS', 'COUNTIFS', 'SUMIF', 'COUNTIF', 'ROUND', 'ROUNDUP',
    'ROUNDDOWN', 'ABS', 'INT', 'SIGN', 'SQRT', 'MOD', 'POWER', 'LEN', 'LEFT',
    'RIGHT', 'MID', 'TRIM', 'UPPER', 'LOWER', 'CONCAT', 'CONCATENATE',
    'DATE', 'YEAR', 'MONTH', 'DAY')
