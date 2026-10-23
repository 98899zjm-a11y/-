"""Data-only recording of already finished typed identity checks."""
from pathlib import Path
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[1]
def sha(relative):
    return hashlib.sha256((ROOT / relative).read_bytes()).hexdigest()

sources = {
    'project/lib/platform/desktop-identity.ts': 'f1fc0650c7ac5364c6186bfb7147b6dc316d0845f0bfc15ac04cd9aea4d72662',
    'project/tsconfig.json': 'a8992fc400e039a2935a683353769528f48c0283414f04cde13e001f166d6a77',
    'project/desktop/build.cjs': '7bb1db255e2a69eb84f684cc49d089eca4946f6f133b3c6b9017a201d9f6a72d',
    'stage1/build-business.cjs': 'd73374f01507eb223e0653394844f71890784ca5f936e0519e69023a9e4b4ac1',
    'stage1/build-full-release.cjs': 'ad053c6502023d6d1a7ba8c48200bc8d9e024293f7586cb393176187b3bda39b',
}
for relative, expected in sources.items():
    assert sha(relative) == expected
test = 'audit-tools/typescript-auth-boundary.test.cjs'
assert sha(test) == 'be25b12b98a1e2f687b4e6adf6bcf48cd7826aa1bb076d9326f8cb783b911304'
log = 'sandbox/results/typed-auth-green-a1/typed-auth-boundary.log'
assert sha(log) == 'e3e88ee59a15ac79da65baea2d8f2ed55b44287727b7b55679130c99814f3c4e'
text = (ROOT / log).read_text('utf-8')
for key, value in [('tests', 12), ('pass', 12), ('fail', 0), ('skipped', 0)]:
    assert re.search(r'^# ' + key + ' ' + str(value) + r'$', text, re.M)
result_name = 'sandbox/results/typed-auth-green-a1/results.json'
results = json.loads((ROOT / result_name).read_text('utf-8'))
assert len(results) == 1 and results[0]['exitCode'] == 0 and results[0]['passed'] is True
types_name = 'reports/static-typecheck-2026-10-15T22-31-04-912Z.json'
assert sha(types_name) == 'e38a2c8a2487dccf0b2ffa1284b9fe5bea5b1e89e50b11eb76d358c1ec4211ba'
types = json.loads((ROOT / types_name).read_text('utf-8'))
assert types['summary']['currentDiagnostics'] == types['summary']['newCurrentDiagnostics'] == 0
assert types['summary']['baselineDiagnostics'] == 8 and types['sourcesChangedDuringCheck'] == []
assert types['current']['rootFileCount'] == 125 and types['current']['programFileCount'] == 1793
assert types['compiler']['version'] == '5.9.3' and types['databasesOpened'] is False and types['businessEntrypointsStarted'] is False
evidence = {
    'version': 1, 'purpose': 'one real typed desktop identity source, unchanged business identity semantics',
    'sources': sources, 'actualOfflineGuest': True, 'tests': {'tests': 12, 'pass': 12, 'fail': 0, 'skip': 0, 'exitCode': 0},
    'testSourceSha256': sha(test), 'logSha256': sha(log), 'runnerResultsSha256': sha(result_name),
    'fullTypecheck': {'report': types_name, 'sha256': sha(types_name), 'actualProcessExitCode': 0, 'summary': types['summary'], 'rootFiles': 125, 'programFiles': 1793, 'sourceChanges': []},
    'redEvidence': 'audit-evidence/typed-auth-red-20261016.json',
    'rulesChanged': False, 'financeFixturePreserved': True, 'old124RootsRetained': True,
    'newFullRegressionFinished': False, 'realGuiOrPhoneVerified': False, 'newExeReleased': False, 'productionChanged': False,
}
with (ROOT / 'audit-evidence/typed-auth-green-20261016.json').open('x', encoding='utf-8', newline='\n') as stream:
    json.dump(evidence, stream, ensure_ascii=False, indent=2)
    stream.write('\n')
section = '''## 2026-10-16 真实typed身份边界与完整类型检查通过

只在五份产品源新增真实DesktopIdentity/getChatGPTUser、精确旧导入映射及三后端builder同文件解析。逐次读取原可信request getter，原身份/ALS/会话/权限/经营公式不改；env文案保留，财务fixture独立。没有ambient假模块、any、身份缓存、默认管理员或缩小include/strict。

先行RED含一项Uint8Array夹具错误，修正表示后原12断言6控制通过/6来源差异；新产品实际12/12 GREEN、0skip/exit0。完整TS5.9.3静态检查实际exit0、0诊断，保留124原roots并新增1为125/1793files、基线8、源检查期间无变化。旧TS exit1及两轮RED原样保留。证据audit-evidence/typed-auth-green-20261016.json。

当前build7已实际成功，合并admin7132/modal e4/typed后的完整regression-current6仍在执行，不能先称全回归通过。真实新UI、iPhone/Android、公网、实体打印、Win10/新引擎及新EXE发布仍另验；正式软件和业务资料不变。
'''
for name in ['PROJECT_CONTEXT.md', 'ARCHITECTURE.md', 'AUDIT_REPORT.md', 'OPTIMIZATION_PLAN.md', 'FINANCIAL_AUDIT.md', 'TEST_REPORT.md', 'HANDOFF.md', 'CHANGELOG.md']:
    file = ROOT / name
    original = file.read_text('utf-8')
    assert section.split('\n')[0] not in original
    title, rest = original.split('\n', 1)
    file.write_bytes((title + '\n\n' + section + '\n' + rest.lstrip('\n')).encode('utf-8'))
print(json.dumps({'typedTestsPassed': 12, 'fullTypecheckDiagnostics': 0, 'fullRegressionStillRunning': True}))
