"""Data-only note for the two-line modal owner reference cleanup."""
from pathlib import Path
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[1]
def sha(relative):
    return hashlib.sha256((ROOT / relative).read_bytes()).hexdigest()

source = 'project/desktop/renderer/modal-focus.ts'
assert sha(source) == 'e4c8413aeba99a6b995182bf04d1f9c7d1b7aabc1887b94166a5fd1940328f91'
logs = ['sandbox/results/auth-usage-controls-a1/results.json']
for name, count in [('dialog-preferred', 3), ('dialog-focus', 19)]:
    relative = f'sandbox/results/auth-usage-controls-a1/{name}.log'
    log = (ROOT / relative).read_text('utf-8')
    for key, value in [('tests', count), ('pass', count), ('fail', 0), ('skipped', 0)]:
        assert re.search(r'^# ' + key + ' ' + str(value) + r'$', log, re.M)
    logs.append(relative)
evidence = {
    'version': 1, 'purpose': 'remove bounded direct modal owner retention',
    'source': source, 'sourceSha256': sha(source),
    'oldSourceSha256': 'a9e8443cf30d7d6776c22928d43c167e0a959e2271bd2d7f7b096c5be968afce',
    'change': 'clear lastOwner on release; empty refresh clears it and returns',
    'actualGuestBehaviorRegression': {'original': 19, 'supplement': 3, 'fail': 0, 'skip': 0},
    'hashes': {file: sha(file) for file in logs},
    'heapOrGcMeasured': False, 'unboundedLeakClaimed': False,
    'realBrowserInteractionVerified': False, 'newFullRegressionRequired': True,
    'productionChanged': False,
}
with (ROOT / 'audit-evidence/modal-owner-cleanup-20261016.json').open('x', encoding='utf-8', newline='\n') as stream:
    json.dump(evidence, stream, indent=2, ensure_ascii=False)
    stream.write('\n')
section = '''## 2026-10-16 关闭弹窗后清理直接owner引用

源审发现每个存活Document的manager可能通过lastOwner延迟保留最后一层DOM；这是至多一个直接owner引用的有界保留，不是已测得的无界泄漏。仅两行修复：release清null，empty refresh清null后return，避免再记录已注销或外部owner。未改restoreFocus/revision/高外层判断/业务回调。

新helper e4c841…已在实际Guest回归原19/19及补3/3，0fail/0skip；没有新增镜像实现测试，没有测heap/GC或宣称内存减少多少。证据audit-evidence/modal-owner-cleanup-20261016.json。新源尚需后续完整构建/回归及真实GUI验证，不套用旧a9/build6通过结论。
'''
for name in ['UI_DESIGN_SPEC.md', 'UI_AUDIT.md', 'TEST_REPORT.md', 'HANDOFF.md', 'CHANGELOG.md']:
    file = ROOT / name
    text = file.read_text('utf-8')
    assert section.split('\n')[0] not in text
    title, rest = text.split('\n', 1)
    file.write_bytes((title + '\n\n' + section + '\n' + rest.lstrip('\n')).encode('utf-8'))
print(json.dumps({'changedProductLines': 2, 'existingRegressionPassed': [19, 3],
                  'heapMeasured': False, 'realBrowserVerified': False}))
