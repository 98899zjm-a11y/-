"""Unexecuted draft: separately authorized 2026-10 ledger aggregates only.

Fixed saved-ledger selection; no arbitrary DB/month, business import, rule
evaluation, row output, file output, backup/checkpoint or historical totals.
Payroll outputs_json is parsed locally; only its wage aggregate may leave.
"""
import argparse, datetime, hashlib, json, math, os, re, sqlite3, stat, sys, time, types
from pathlib import Path

W = Path('E:/codex/2026-10-15/work/xjy-v16-deep-audit')
SELF = W / 'audit-tools/read-current-overview-summary.py'
HELPER = W / 'audit-tools/read-current-ledger-paths.py'
HELPER_SHA = 'cee5ea3fedab9d880ddbc0ee60533ff16d334df18a05cc937d60c06324b11139'
REFERENCE = W / 'audit-tools/read-current-platinum-summary.py'
REFERENCE_SHA = 'ae6c514a354366cef19cfa5a1a504b33874f57d3be6c4cdedeeef9e76360fe01'
DIRECTORY = Path('F:/鑫金源珠宝资料/内帐')
DATABASE = DIRECTORY / 'ledger.db'
CFG_SHA = 'f672957f6b469feec68b278ad283a6254973e805ae7da451bb10e671fa401a57'
MONTH, START, END = '2026-10', '2026-10-01', '2026-10-31'
ROW_LIMIT, STDOUT_LIMIT = 50000, 16 * 1024
JSON_LIMIT, PAYLOAD_LIMIT, DATABASE_LIMIT = 64 * 1024, 16 * 1024 * 1024, 256 * 1024 * 1024
NUMBER_LIMIT, TOTAL_LIMIT = 10 ** 15, 10 ** 18
SQL_STEPS, SQL_SECONDS = 2000000, 20
SALES = ('amount_c', 'received', 'cost', 'profit_c', 'comm_c', 'comm_profit_c', 'weight')
FIELDS = {'sales': ('date',) + SALES, 'payroll_records': ('month', 'status', 'outputs_json'),
          'expenses': ('date', 'status', 'amount'), 'formula_sets': ('id', 'domain', 'formulas')}
SALES_WHERE = 'date>=? AND date<=?'
PAYROLL_WHERE = "month=? AND status IN ('已确认','已发放')"
EXPENSE_WHERE = "date>=? AND date<=? AND status IN ('已审核','已支付')"
FUNCTIONS = frozenset(('count', 'sum', 'coalesce', 'typeof', 'length', 'glob'))

class Refused(Exception):
    pass

def need(value, code):
    if not value:
        raise Refused(code)

def utc_now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def bootstrap(file, pin):
    need(file.is_relative_to(W), 'OWNED_SOURCE_REQUIRED')
    for item in (file, *file.parents):
        info = item.lstat()
        need(not stat.S_ISLNK(info.st_mode) and not getattr(info, 'st_file_attributes', 0) & 0x400, 'SOURCE_REPARSE_REFUSED')
        need(not stat.S_ISREG(info.st_mode) or info.st_nlink == 1, 'SOURCE_HARDLINK_REFUSED')
    need(file.is_file() and file.stat().st_size <= 256 * 1024, 'BOUNDED_SOURCE_REQUIRED')
    body = file.read_bytes()
    need(len(body) <= 256 * 1024 and hashlib.sha256(body).hexdigest() == pin, 'SOURCE_PIN_MISMATCH')
    return body

def config_gate(helper):
    settings, selection = helper.inspect_settings()
    need(settings.get('exists') is True and settings.get('version') == 1, 'EXISTING_VERSION_ONE_CONFIG_REQUIRED')
    need(settings.get('sha256Before') == CFG_SHA and settings.get('sha256After') == CFG_SHA, 'FIXED_CONFIG_SHA_REQUIRED')
    need(selection.get('source') == 'saved-ledger-dataDir' and helper.norm(selection.get('dataDir')) == helper.norm(DIRECTORY), 'EXACT_SAVED_LEDGER_DIRECTORY_REQUIRED')
    return settings['sha256After']

def authorize(action, arg1, arg2, database, source):
    if action == sqlite3.SQLITE_SELECT:
        return sqlite3.SQLITE_OK
    if action == sqlite3.SQLITE_TRANSACTION and arg1 in ('BEGIN', 'ROLLBACK'):
        return sqlite3.SQLITE_OK
    if action == sqlite3.SQLITE_FUNCTION and str(arg2 or arg1).lower() in FUNCTIONS:
        return sqlite3.SQLITE_OK
    if action == sqlite3.SQLITE_PRAGMA:
        if arg1 == 'query_only' and arg2 in (None, 'ON', '1'):
            return sqlite3.SQLITE_OK
        if arg1 == 'table_info' and arg2 in FIELDS:
            return sqlite3.SQLITE_OK
    if action == sqlite3.SQLITE_READ and database == 'main' and source is None:
        if arg1 in FIELDS and arg2 in ('', *FIELDS[arg1]):
            return sqlite3.SQLITE_OK
        if arg1 in ('sqlite_master', 'sqlite_schema') and arg2 in ('type', 'name', 'sql'):
            return sqlite3.SQLITE_OK
    return sqlite3.SQLITE_DENY

def schema_gate(connection):
    for table, fields in FIELDS.items():
        row = connection.execute("SELECT type,CASE WHEN length(CAST(sql AS BLOB))<=65536 THEN sql ELSE NULL END AS sql FROM sqlite_schema WHERE name=? AND type='table'", (table,)).fetchall()
        need(len(row) == 1 and isinstance(row[0]['sql'], str) and re.match(r'^\s*CREATE\s+TABLE\b', row[0]['sql'], re.I), 'ORDINARY_APPROVED_TABLES_REQUIRED')
        columns = connection.execute('PRAGMA table_info(' + table + ')').fetchall()
        need(set(fields).issubset({item['name'] for item in columns}), 'APPROVED_COLUMNS_REQUIRED')

def count_rows(connection, table, where, parameters):
    number = connection.execute('SELECT COUNT(*) FROM ' + table + ' WHERE ' + where, parameters).fetchone()[0]
    need(type(number) is int and 0 <= number < ROW_LIMIT, 'ROW_LIMIT_REACHED_NO_TOTALS')
    return number

def number(value, limit=NUMBER_LIMIT):
    need(type(value) in (int, float) and math.isfinite(value) and abs(value) <= limit, 'DIRTY_OR_OVERLIMIT_NUMBER_NO_TOTALS')
    return value

def aggregate(connection, table, fields, where, parameters):
    count = count_rows(connection, table, where, parameters)
    bad_dates = connection.execute('SELECT COUNT(*) FROM ' + table + ' WHERE (' + where + ") AND NOT(typeof(date)='text' AND length(date)=10 AND date GLOB '2026-10-[0-3][0-9]')", parameters).fetchone()[0]
    need(bad_dates == 0, 'DIRTY_SELECTED_DATE_NO_TOTALS')
    checks = ['SUM(CASE WHEN typeof(' + field + ") IN ('integer','real') AND " + field + '>=-1000000000000000 AND ' + field + '<=1000000000000000 THEN 0 ELSE 1 END)' for field in fields]
    dirty = connection.execute('SELECT ' + ','.join('COALESCE(' + check + ',0)' for check in checks) + ' FROM ' + table + ' WHERE ' + where, parameters).fetchone()
    need(all(type(value) is int and value == 0 for value in dirty), 'DIRTY_OR_OVERLIMIT_NUMBER_NO_TOTALS')
    row = connection.execute('SELECT ' + ','.join('COALESCE(SUM(' + field + '),0) AS ' + field for field in fields) + ' FROM ' + table + ' WHERE ' + where, parameters).fetchone()
    return {'count': count, **{field: number(row[field], TOTAL_LIMIT) for field in fields}}

def unique_object(pairs):
    result = {}
    for key, value in pairs:
        need(key not in result, 'DUPLICATE_JSON_KEY_NO_TOTALS')
        result[key] = value
    return result

def reject_constant(_value):
    raise Refused('NONSTANDARD_JSON_NUMBER_NO_TOTALS')

def parse_json(payload):
    need(type(payload) is str and 0 < len(payload.encode('utf-8')) <= JSON_LIMIT, 'DIRTY_OR_OVERLIMIT_JSON_NO_TOTALS')
    return json.loads(payload, object_pairs_hook=unique_object, parse_constant=reject_constant)

def payroll_total(connection):
    count = count_rows(connection, 'payroll_records', PAYROLL_WHERE, (MONTH,))
    # CAST measures JSON byte size only. No wage value is CAST/coerced to zero.
    sql = "SELECT CASE WHEN typeof(outputs_json)='text' AND length(CAST(outputs_json AS BLOB))<=65536 THEN outputs_json ELSE NULL END AS payload FROM payroll_records WHERE " + PAYROLL_WHERE + ' LIMIT 50000'
    wages, size = [], 0
    for row in connection.execute(sql, (MONTH,)):
        payload = row['payload']
        need(type(payload) is str, 'DIRTY_OR_OVERLIMIT_JSON_NO_TOTALS')
        size += len(payload.encode('utf-8'))
        need(size <= PAYLOAD_LIMIT, 'PAYROLL_PAYLOAD_LIMIT_NO_TOTALS')
        value = parse_json(payload)
        need(type(value) is dict, 'PAYROLL_OBJECT_REQUIRED_NO_TOTALS')
        # Original dashboard uses missing-key zero; null/bool/text are refused.
        wages.append(float(number(value.get('应发工资', 0))))
    need(len(wages) == count, 'PAYROLL_COUNT_CHANGED_NO_TOTALS')
    return {'count': count, 'wageCost': number(math.fsum(wages), TOTAL_LIMIT), 'basis': '应发工资', 'missingKeyPolicy': 'original-default-zero'}

def overview_rule(connection):
    sql = "SELECT id,CASE WHEN typeof(formulas)='text' AND length(CAST(formulas AS BLOB))<=65536 THEN formulas ELSE NULL END AS payload FROM formula_sets WHERE domain='overview' ORDER BY id DESC LIMIT 1"
    rows = connection.execute(sql).fetchall()
    need(len(rows) == 1 and type(rows[0]['id']) is int and rows[0]['id'] > 0, 'OVERVIEW_RULE_REQUIRED_NO_TOTALS')
    payload = rows[0]['payload']
    formulas = parse_json(payload)
    need(type(formulas) is list and len(formulas) == 1 and type(formulas[0]) is list and len(formulas[0]) == 2 and formulas[0][0] == '经营结余', 'OVERVIEW_RULE_SHAPE_REQUIRED_NO_TOTALS')
    expression = formulas[0][1]
    need(type(expression) is str and 0 < len(expression) <= 4096 and '\x00' not in expression, 'BOUNDED_RULE_EXPRESSION_REQUIRED_NO_TOTALS')
    return {'id': rows[0]['id'], 'domain': 'overview', 'stepCount': 1,
            'storedPayloadSha256': hashlib.sha256(payload.encode('utf-8')).hexdigest(),
            'expressionSha256': hashlib.sha256(expression.encode('utf-8')).hexdigest(),
            'expressionCharacters': len(expression), 'identityVerified': False, 'evaluated': False}

def read_summary():
    connection = sqlite3.connect(DATABASE.as_uri() + '?mode=ro', uri=True, timeout=5, isolation_level=None)
    ticks, started, exhausted = 0, time.monotonic(), False
    def progress():
        nonlocal ticks, exhausted
        ticks += 1000
        exhausted = ticks > SQL_STEPS or time.monotonic() - started > SQL_SECONDS
        return int(exhausted)
    try:
        connection.row_factory = sqlite3.Row
        connection.set_authorizer(authorize)
        connection.set_progress_handler(progress, 1000)
        connection.execute('PRAGMA query_only=ON')
        need(connection.execute('PRAGMA query_only').fetchone()[0] == 1, 'QUERY_ONLY_REQUIRED')
        connection.execute('BEGIN')
        schema_gate(connection)
        sales = aggregate(connection, 'sales', SALES, SALES_WHERE, (START, END))
        payroll = payroll_total(connection)
        expenses = aggregate(connection, 'expenses', ('amount',), EXPENSE_WHERE, (START, END))
        rule = overview_rule(connection)
        gross_rate = sales['profit_c'] / sales['received'] if sales['received'] else 0
        number(gross_rate, TOTAL_LIMIT)
        return {'sales': sales, 'payroll': payroll, 'expenses': expenses, 'grossRate': gross_rate,
                'overviewRule': rule, 'computedNet': None, 'computedNetReason': 'RULE_IDENTITY_NOT_VERIFIED_NO_EVALUATION'}
    except sqlite3.DatabaseError:
        if exhausted:
            raise Refused('SQL_BUDGET_REACHED_NO_TOTALS') from None
        raise
    finally:
        connection.set_progress_handler(None, 0)
        try:
            if connection.in_transaction:
                connection.rollback()
        finally:
            connection.close()

def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--authorized-overview-summary', action='store_true')
    parser.add_argument('--source-sha256', required=True)
    args = parser.parse_args()
    need(os.name == 'nt' and os.path.normcase(sys.executable) == os.path.normcase('C:/Python314/python.exe') and sys.flags.isolated and sys.flags.no_site and sys.flags.dont_write_bytecode and not sys.flags.optimize, 'FIXED_ISOLATED_PUBLIC_PYTHON_REQUIRED')
    need(Path(__file__).absolute() == SELF, 'FIXED_TOOL_PATH_REQUIRED')
    need(args.authorized_overview_summary, 'SEPARATE_OVERVIEW_SUMMARY_AUTHORIZATION_REQUIRED')
    need(re.fullmatch('[0-9a-f]{64}', args.source_sha256), 'ROOT_TOOL_SHA_REQUIRED')
    bodies = {file: bootstrap(file, pin) for file, pin in ((SELF, args.source_sha256), (HELPER, HELPER_SHA), (REFERENCE, REFERENCE_SHA))}
    helper = types.ModuleType('overview_readonly_metadata_helper')
    helper.__file__ = str(HELPER)
    # Compile only the already-hashed bytes; never let a loader consult pyc.
    exec(compile(bodies[HELPER], str(HELPER), 'exec', dont_inherit=True, optimize=0), helper.__dict__)
    started = utc_now()
    config_before = config_gate(helper)
    _, info, chain = helper.checked(DATABASE, helper.DATA_ROOT, kind='file')
    need(0 < info.st_size <= DATABASE_LIMIT, 'DATABASE_SIZE_LIMIT_NO_TOTALS')
    summary = read_summary()
    helper.recheck(chain)
    config_after = config_gate(helper)
    for file, pin in ((SELF, args.source_sha256), (HELPER, HELPER_SHA), (REFERENCE, REFERENCE_SHA)):
        bootstrap(file, pin)
    report = {'version': 1, 'purpose': 'explicit-2026-10-overview-readonly-aggregates',
              'readStartedAtUtc': started, 'readCompletedAtUtc': utc_now(), 'toolSourceSha256': args.source_sha256,
              'metadataHelperSha256': HELPER_SHA, 'referenceBoundarySourceSha256': REFERENCE_SHA,
              'fixedLedgerPath': str(DATABASE), 'configSha256Before': config_before, 'configSha256After': config_after,
              'month': MONTH, 'periodStartInclusive': START, 'periodEndInclusive': END, 'uiSelectedMonthVerified': False,
              'singleReadTransaction': True, 'queryOnly': True, 'totalsAreComplete': True,
              'allHistorySalesTotalsRead': False, 'businessRowsOrSchemaModified': False, 'liveProcessConnectionVerified': False,
              'rulesExecuted': False, 'personalRowsOutput': False, 'consistentCopyCreated': False,
              'limits': {'rowLimitExclusivePerSelectedTable': ROW_LIMIT, 'jsonBytesPerRow': JSON_LIMIT,
                         'payrollPayloadBytes': PAYLOAD_LIMIT, 'numberAbsolute': NUMBER_LIMIT,
                         'aggregateAbsolute': TOTAL_LIMIT, 'databaseBytes': DATABASE_LIMIT}, **summary}
    payload = (json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + '\n').encode('utf-8')
    need(len(payload) <= STDOUT_LIMIT, 'STDOUT_LIMIT_EXCEEDED_NO_TOTALS')
    print(payload.decode('utf-8'), end='')
    return 0

if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Refused as error:
        print(json.dumps({'ok': False, 'code': str(error)}), file=sys.stderr)
        raise SystemExit(1)
    except Exception as error:
        print(json.dumps({'ok': False, 'code': 'OVERVIEW_READONLY_FAILED_NO_TOTALS', 'type': type(error).__name__}), file=sys.stderr)
        raise SystemExit(1)
