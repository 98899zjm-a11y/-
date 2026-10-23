"""Draft: separately authorized fixed-token grouping of unknown_pt only.

No automatic purity/factor inference, business writes or file output. Do not
run under the earlier six-column read permission. Output contains fixed group
labels, counts, raw grams and at most twenty row IDs; no original text/rows.
"""
import argparse, ast, datetime, hashlib, json, os, re, sqlite3, stat, sys, types, unicodedata
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP, getcontext
from pathlib import Path

W = Path('E:/codex/2026-10-15/work/xjy-v16-deep-audit')
SELF = W / 'audit-tools/read-current-platinum-unknown-groups.py'
READER = W / 'audit-tools/read-current-platinum-summary.py'
READER_SHA = 'ae6c514a354366cef19cfa5a1a504b33874f57d3be6c4cdedeeef9e76360fe01'
HELPER = W / 'audit-tools/read-current-ledger-paths.py'
OLD_SOURCE = W / 'sandbox/input/platinum-diagnosis-a1/project/desktop/legacy-source/ledger/inventory_dashboard.py'
NEW_SOURCE = W / 'project/desktop/legacy-source/ledger/inventory_dashboard.py'
PRESENTATION = W / 'project/desktop/legacy-source/ledger/presentation.py'
DIRECTORY = Path('F:/鑫金源珠宝资料/内帐')
DATABASE = DIRECTORY / 'ledger.db'
FUNCTIONS = ('need', 'now', 'bootstrap', 'selected', 'models', 'config_gate', 'authorize', 'read_rows')
CONSTANTS = ('HELPER_SHA', 'OLD_SHA', 'NEW_SHA', 'PRESENTATION_SHA', 'CFG_SHA', 'ROW_LIMIT',
             'FIELDS', 'DEFINITIONS', 'STATES', 'SCHEMA_SQL', 'ROWS_SQL')
TOKENS = ('950', '999', '999.5', '990', '900')
ID_LIMIT = 20
STDOUT_LIMIT = 64 * 1024


class Refused(Exception): pass


def need(value, code):
    if not value: raise Refused(code)


def source_bytes(file, pin):
    need(file.is_relative_to(W), 'OWNED_SOURCE_REQUIRED')
    for item in (file, *file.parents):
        info = item.lstat()
        need(not stat.S_ISLNK(info.st_mode) and not getattr(info, 'st_file_attributes', 0) & 0x400, 'SOURCE_REPARSE_REFUSED')
        need(not stat.S_ISREG(info.st_mode) or info.st_nlink == 1, 'SOURCE_HARDLINK_REFUSED')
    need(file.is_file() and file.stat().st_size <= 256 * 1024, 'BOUNDED_SOURCE_REQUIRED')
    body = file.read_bytes()
    need(len(body) <= 256 * 1024 and hashlib.sha256(body).hexdigest() == pin, 'SOURCE_PIN_MISMATCH')
    return body


def load_reader():
    # Execute only these complete, frozen definitions. No reader top-level
    # imports, F assignments, main, app, pyc or metadata main is executed.
    tree = ast.parse(source_bytes(READER, READER_SHA), filename=str(READER))
    namespace = {'__name__': 'platinum_unknown_reviewed_reader', 'Refused': Refused, 'W': W,
                 'HELPER': HELPER, 'OLD_SOURCE': OLD_SOURCE, 'NEW_SOURCE': NEW_SOURCE,
                 'PRESENTATION': PRESENTATION, 'DIRECTORY': DIRECTORY, 'DATABASE': DATABASE,
                 'ast': ast, 'datetime': datetime, 'hashlib': hashlib, 'json': json, 'os': os,
                 're': re, 'sqlite3': sqlite3, 'stat': stat, 'Path': Path, 'Decimal': Decimal,
                 'InvalidOperation': InvalidOperation, 'ROUND_HALF_UP': ROUND_HALF_UP}
    for name in CONSTANTS:
        found = [n.value for n in tree.body if isinstance(n, ast.Assign) and len(n.targets) == 1
                 and isinstance(n.targets[0], ast.Name) and n.targets[0].id == name]
        need(len(found) == 1, 'ONE_READER_CONSTANT_REQUIRED')
        namespace[name] = ast.literal_eval(found[0])
    need(namespace['ROW_LIMIT'] == 50000 and namespace['FIELDS'] ==
         ('id', 'category', 'product', 'weight', 'remark', 'sell_date'), 'ORIGINAL_READ_SCOPE_REQUIRED')
    definitions = []
    for name in FUNCTIONS:
        found = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name]
        need(len(found) == 1 and not found[0].decorator_list and not found[0].args.defaults
             and not found[0].args.kw_defaults, 'ONE_READER_FUNCTION_REQUIRED')
        definitions.append(found[0])
    exec(compile(ast.Module(body=definitions, type_ignores=[]), str(READER), 'exec',
                 dont_inherit=True, optimize=0), namespace)
    return namespace


def group_key(row, functions, states):
    # NFKC is solely a diagnostic text transformation. It is NOT supplied back
    # to platinum_identity/inventory_state and cannot change their decisions.
    text = str(row.get('category') or '') + ' ' + str(row.get('product') or '')
    normalized = unicodedata.normalize('NFKC', text)
    tokens = tuple(token for token in TOKENS if re.search(r'(?<![\d.])' + re.escape(token) + r'(?![\d.])', normalized))
    category = unicodedata.normalize('NFKC', str(row.get('category') or ''))
    other_metal = '银' in category or bool(re.search(
        r'黄金|足金|白银|纯银|足银|银饰|(?i:AU\s*\d|AG\s*\d|S\s*(?:925|999))', normalized))
    state = functions['inventory_state'](row)
    need(state in states, 'UNKNOWN_STATE_RESULT')
    return states[state], tokens, other_metal, normalized != text


def classify(rows, functions, states):
    groups = {}; unknown_count = 0; sampled = 0; raw_total = Decimal(0); invalid = 0; missing = 0
    for row in rows:
        bucket, _ = functions['platinum_identity'](row)
        if bucket != 'unknown_pt': continue
        unknown_count += 1
        key = group_key(row, functions, states)
        item = groups.setdefault(key, {'count': 0, 'rawGramsExact': Decimal(0), 'invalidWeights': 0,
                                      'missingWeightInputsCountedAsZeroByOriginalRule': 0, 'sampleIds': []})
        item['count'] += 1
        if row.get('weight') is None or row.get('weight') == '':
            item['missingWeightInputsCountedAsZeroByOriginalRule'] += 1; missing += 1
        grams = functions['_grams'](row.get('weight'))
        if grams is None:
            item['invalidWeights'] += 1; invalid += 1
        else:
            item['rawGramsExact'] += grams; raw_total += grams
        if sampled < ID_LIMIT:
            item['sampleIds'].append(row['id']); sampled += 1
    output = []
    for (state, tokens, other_metal, changed), item in sorted(groups.items()):
        output.append({'state': state, 'listedPurityTokens': list(tokens), 'noListedPurityToken': not tokens,
                       'multipleListedPurityTokens': len(tokens) > 1, 'otherMetalWordMarker': other_metal,
                       'nfkcChanged': changed, **item, 'rawGramsExact': format(item['rawGramsExact'], 'f')})
    return {'rowCount': len(rows), 'unknownPtCount': unknown_count, 'totalsAreComplete': True,
            'unknownPtRawGramsExact': format(raw_total, 'f'), 'invalidWeights': invalid,
            'missingWeightInputsCountedAsZeroByOriginalRule': missing,
            'idSampleLimit': ID_LIMIT, 'sampledIds': sampled, 'idSamplesTruncated': unknown_count > sampled,
            'idSelection': 'first 20 unknown_pt rows by id across all groups', 'groups': output}


def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--authorized-platinum-classification-readonly', action='store_true')
    parser.add_argument('--source-sha256', required=True)
    args = parser.parse_args()
    need(os.name == 'nt' and os.path.normcase(sys.executable) == os.path.normcase('C:/Python314/python.exe')
         and sys.flags.isolated and sys.flags.no_site and sys.flags.dont_write_bytecode and not sys.flags.optimize,
         'FIXED_ISOLATED_PUBLIC_PYTHON_REQUIRED')
    need(Path(__file__).absolute() == SELF, 'FIXED_TOOL_PATH_REQUIRED')
    need(args.authorized_platinum_classification_readonly, 'SEPARATE_CLASSIFICATION_READ_AUTHORIZATION_REQUIRED')
    need(re.fullmatch('[0-9a-f]{64}', args.source_sha256), 'ROOT_TOOL_SHA_REQUIRED')
    source_bytes(SELF, args.source_sha256)
    reader = load_reader(); helper_body = reader['bootstrap'](HELPER, reader['HELPER_SHA'])
    _, functions, _ = reader['models']()
    need(getcontext().prec == 28, 'DEFAULT_DECIMAL_PRECISION_REQUIRED')
    # Compile the exact pinned known helper bytes; no import loader/pyc cache.
    helper = types.ModuleType('platinum_unknown_readonly_metadata_helper'); helper.__file__ = str(HELPER)
    exec(compile(helper_body, str(HELPER), 'exec', dont_inherit=True, optimize=0), helper.__dict__)
    started = reader['now'](); config_before = reader['config_gate'](helper)
    _, _, chain = helper.checked(DATABASE, helper.DATA_ROOT, kind='file')
    rows = reader['read_rows'](); helper.recheck(chain)
    result = classify(rows, functions, reader['STATES'])
    config_after = reader['config_gate'](helper)
    for file, pin in ((SELF, args.source_sha256), (READER, READER_SHA), (HELPER, reader['HELPER_SHA']),
                      (OLD_SOURCE, reader['OLD_SHA']), (NEW_SOURCE, reader['NEW_SHA']),
                      (PRESENTATION, reader['PRESENTATION_SHA'])):
        source_bytes(file, pin)
    report = {'version': 1, 'purpose': 'unknown-pt-fixed-token-diagnostic-groups',
              'readStartedAtUtc': started, 'readCompletedAtUtc': reader['now'](),
              'toolSourceSha256': args.source_sha256, 'readerSourceSha256': READER_SHA,
              'ruleSourceSha256': reader['NEW_SHA'], 'configSha256Before': config_before,
              'configSha256After': config_after, 'fixedLedgerPath': str(DATABASE),
              'singleReadTransaction': True, 'queryOnly': True, 'rowLimitExclusive': reader['ROW_LIMIT'],
              'decimalContextPrecision': getcontext().prec, 'normalization': 'NFKC; grouping only',
              'tokenMeaning': 'fixed text markers; not asserted purity or mixed composition',
              'purityFactorInferredOrChanged': False, 'businessRowsOrSchemaModified': False,
              'physicalStockVerified': False, 'liveProcessConnectionVerified': False,
              'consistentCopyCreated': False, **result}
    payload = (json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + '\n').encode('utf-8')
    need(len(payload) <= STDOUT_LIMIT, 'STDOUT_LIMIT_EXCEEDED_NO_PARTIAL_TOTALS')
    print(payload.decode('utf-8'), end=''); return 0


if __name__ == '__main__':
    try: raise SystemExit(main())
    except Refused as error: print(json.dumps({'ok': False, 'code': str(error)}), file=sys.stderr); raise SystemExit(1)
    except Exception as error:
        print(json.dumps({'ok': False, 'code': 'READONLY_CLASSIFICATION_FAILED', 'type': type(error).__name__}), file=sys.stderr)
        raise SystemExit(1)
