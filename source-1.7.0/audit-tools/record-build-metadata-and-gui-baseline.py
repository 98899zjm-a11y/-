"""Data-only receipts for actual metadata and pure feature-gap measurements."""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
def sha(name):
    return hashlib.sha256((ROOT / name).read_bytes()).hexdigest()

source = 'audit-tools/sidecar-build-metadata.py'
assert sha(source) == 'a56859dff310bd50b0633df5b6fa56571eacda7754203217d8edf45406c57be3'
run = 'sandbox/results/sidecar-build-metadata-a1/'
rows = json.loads((ROOT / (run + 'results.json')).read_text('utf-8'))
assert len(rows) == 1 and rows[0]['exitCode'] == 0 and rows[0]['passed'] is True
name = 'sandbox/results/sidecar-build-metadata-a1.json'
metadata = json.loads((ROOT / name).read_text('utf-8'))
assert metadata['actualGuest']['productionDrivePresent'] is False
assert metadata['actualGuest']['nonLoopbackAddressCount'] == 0
assert metadata['architectureBits'] == 64 and metadata['magicNumberHex'] == '2b0e0d0a'
assert metadata['python'].startswith('3.14.8 ')
assert len(metadata['packages']) == 13 and metadata['missingNames'] == ['pillow', 'reportlab']
assert {row['name'] for row in metadata['hookEntryPoints']} == {'pyinstaller-hooks-contrib', 'pythonnet', 'pywebview'}
assert all(metadata[key] is False for key in ['thirdPartyImported', 'businessOrPycImported', 'databaseOpened', 'compilerOrHookExecuted', 'buildStarted', 'hookSourceClosureVerified', 'packagedSidecarRuntimeVersionsVerified'])
files = [source, name, run + 'results.json', run + 'sidecar-build-metadata.log',
         'sandbox/results/sidecar-build-metadata-a1-applied.json',
         'reports/sidecar-build-metadata-independent-review.md', 'reports/finance-sidecar-rebuild-readiness.md']
evidence = {'version': 1, 'purpose': 'actual offline Guest build metadata only; not build admission',
            'actualExitCode': 0, 'selectedPythonFlags': ['-I', '-B', '-S', '-X', 'utf8'],
            'python': metadata['python'], 'magicNumberHex': metadata['magicNumberHex'],
            'packageDeclarations': {row['name']: row['fields'].get('Version') for row in metadata['packages']},
            'missingDistInfoNames': metadata['missingNames'], 'missingModulesProven': False,
            'hookProviderDeclarations': metadata['hookEntryPoints'], 'hookCodeExecutedOrVerified': False,
            'packagedRuntimeVersionsVerified': False, 'buildApprovedOrStarted': False,
            'productionChanged': False, 'hashes': {file: sha(file) for file in files}}
with (ROOT / 'audit-evidence/sidecar-build-metadata-20261016.json').open('x', encoding='utf-8', newline='\n') as stream:
    json.dump(evidence, stream, ensure_ascii=False, indent=2)
    stream.write('\n')

test = 'audit-tools/ui-observer-gui-test.py'
assert sha(test) == '42b71cef6438f55e9fb6ae19bf1b7e62ed2d534077af3421c1923e7c078ca740'
summary_name = 'reports/gui-pure-frozen-a1-results.json'
pure_rows = json.loads((ROOT / summary_name).read_text('utf-8'))
assert [(row['suite'], row['actualExitCode']) for row in pure_rows] == [('regression', 0), ('contract', 2)]
summaries, pure_files = {}, [summary_name, test, 'reports/ui-observer-gui-pure-spec.md']
for row in pure_rows:
    file = 'reports/' + row['log']
    assert sha(file) == row['sha256']
    summaries[row['suite']] = json.loads((ROOT / file).read_text('utf-8').splitlines()[-1])
    pure_files.append(file)
assert summaries['regression']['testsRun'] == 28 and summaries['regression']['outcome'] == 'PASS'
assert summaries['regression']['featureMissing'] == 0
assert summaries['contract']['testsRun'] == 4 and summaries['contract']['featureMissing'] == 7
assert summaries['contract']['outcome'] == 'FEATURE_MISSING'
assert all(value['failures'] == 0 and value['errors'] == 0 and value['guiQualified'] is False for value in summaries.values())
evidence = {'version': 1, 'purpose': 'pure GUI feature-gap baseline; no business defect or GUI qualification claim',
            'hostPureDiOnly': True, 'actualExitCodes': {'regression': 0, 'contract': 2},
            'summaries': summaries, 'newContractPassed': False, 'subtestSkipsNotAdditionalTopLevelTests': True,
            'hashes': {file: sha(file) for file in pure_files}, 'productionChanged': False}
with (ROOT / 'audit-evidence/gui-pure-feature-baseline-20261016.json').open('x', encoding='utf-8', newline='\n') as stream:
    json.dump(evidence, stream, ensure_ascii=False, indent=2)
    stream.write('\n')
section = '''## 2026-10-16 真实构建工具metadata与GUI纯接口基线

metadata脚本a568实际Guest以-I -B -S运行exit0，只读dist-info/RECORD摘要/entry points声明；未import第三方或业务/未知pyc、未build/开DB。真实Python3.14.8 AMD64、magic2b0e0d0a；13包声明含PyInstaller6.22.3/hooks-contrib2026.8/Waitress3.0.2。pillow/reportlab仅此site缺dist-info，不能推导vendor模块缺失。三hook provider声明为contrib/pythonnet/pywebview，均未加载、源码闭包未验；不能据此批准构建或称预制EXE版本已确认。证据audit-evidence/sidecar-build-metadata-20261016.json。

新42b纯测试经Root源审实际只在Host允许的纯DI运行：冻结4c6的原28全部PASS/exit0；新4顶层合同因register_root/controller尚未实现，7个skip records、FEATURE_MISSING/actualExit2、0assert失败0error，**不是4项通过或经营BUG**。证据audit-evidence/gui-pure-feature-baseline-20261016.json。Root现只授权financial新增纯gui model的单一register_root及两个纯controller函数，不写native/GUI/owner/产品接线；原28/4c6/A2/B/guards/owner固定。

Root仍独占Guest，当前metadata/本轮测试均结束；LAN继续只读vendor/官方固定hook源与下一批具体本地读取清单。默认build CLI会覆盖Guest固定模块/manifest，仍不准直接跑。正式EXE/营业数据/配置不动，新财务源码56尚未进入模块EXE；实际双角色GUI、完整新包和真实设备验收继续待证据。
'''
for file in ['PROJECT_CONTEXT.md', 'ARCHITECTURE.md', 'AUDIT_REPORT.md', 'OPTIMIZATION_PLAN.md', 'TEST_REPORT.md', 'HANDOFF.md']:
    target = ROOT / file
    original = target.read_text('utf-8')
    assert section.split('\n')[0] not in original
    title, rest = original.split('\n', 1)
    target.write_bytes((title + '\n\n' + section + '\n' + rest.lstrip('\n')).encode('utf-8'))
print(json.dumps({'metadataReadExit': 0, 'buildStarted': False, 'oldPurePassed': 28, 'newFeatureOutcome': 'FEATURE_MISSING', 'newFeatureExit': 2}))
