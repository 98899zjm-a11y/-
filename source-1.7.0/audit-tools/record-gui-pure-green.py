"""Data-only record of completed pure candidate checks; no native invocation."""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
def sha(name):
    return hashlib.sha256((ROOT / name).read_bytes()).hexdigest()

pins = {'audit-tools/ui-observer-gui-test.py': '42b71cef6438f55e9fb6ae19bf1b7e62ed2d534077af3421c1923e7c078ca740',
        'audit-tools/ui-observer-gui.py': 'e70d3f27c54f049dbb9d0169bbb293e3000dfba31eda474b3ca68fce9162b02e',
        'audit-tools/observer-ui-driver.py': '4cdb09c3f1302d2d14662b394c2514c87f4568dbb2857a02709d7122b16b050f'}
assert all(sha(file) == expected for file, expected in pins.items())
name = 'reports/gui-pure-candidate-a1-results.json'
rows = json.loads((ROOT / name).read_text('utf-8'))
assert [(row['suite'], row['actualExitCode']) for row in rows] == [('regression', 0), ('contract', 0)]
files = [name, 'reports/gui-pure-implementation-review.md', 'reports/ui-observer-gui-pure-spec.md']
summaries = {}
for row in rows:
    file = 'reports/' + row['log']
    assert sha(file) == row['sha256']
    summary = json.loads((ROOT / file).read_text('utf-8').splitlines()[-1])
    assert summary['outcome'] == 'PASS' and summary['featureMissing'] == summary['failures'] == summary['errors'] == 0
    assert summary['nativeOrBusinessExecution'] is False and summary['guiQualified'] is False
    summaries[row['suite']] = summary
    files.append(file)
assert summaries['regression']['testsRun'] == 28 and summaries['contract']['testsRun'] == 4
evidence = {'version': 1, 'purpose': 'pure single late-root API and real pure controller definitions GREEN',
            'hostPureDiOnly': True, 'sourcePins': pins, 'actualExitCodes': [0, 0], 'passedTopLevelCases': 32,
            'summaries': summaries, 'hashes': {file: sha(file) for file in files},
            'frozenFeatureMissingBaselinePreserved': 'audit-evidence/gui-pure-feature-baseline-20261016.json',
            'nativeGuiOrOwnerImplemented': False, 'realGuiQualified': False, 'productionChanged': False,
            'limits': ['pure DI cannot prove real Popen/EOF/finally integration',
                       'registration transitions and pre-gate descendants have static review, no separate dynamic fault case']}
with (ROOT / 'audit-evidence/gui-pure-green-20261016.json').open('x', encoding='utf-8', newline='\n') as stream:
    json.dump(evidence, stream, ensure_ascii=False, indent=2)
    stream.write('\n')
section = '''## 2026-10-16 GUI纯接线32项GREEN，原生界面仍未复验

单一register_root与两个实际纯controller定义已完成：e70 model/4cdb controller，原42b测试不改。Root和独立只读源审后，Host允许的纯DI实际旧28/28＋新4/4分别exit0、0fail/0error/0skip；原feature-missing/exit2基线保持，不改成历史PASS。证据audit-evidence/gui-pure-green-20261016.json。

这不是Native/Edge/Popen/EOF/driver finally的运行验证。observer-ui-driver.py当前仅两个纯函数、无真正GUI入口；新capsule/原CAS/I/O交接尚未实现或运行，原UI-a2整体FAIL仍保留。新增transition队列/未commit root已有后代拒绝仅静态复核，不冒称分支已注入。下一步只可按cf86计划的窄角色/共享帧/READY屏障接线，先源审封定再实际双角色GUI。

财务source56的6CSV＋8ERP已通过但预制EXE未更新。已读到PyInstaller provider加载、内部进程参数不继承及Windows依赖分析import Package三个实际门槛；只读报告e6c28…给出后续具体PUBLIC源码/RECORD清单。默认构建CLI仍不能直接跑。Root捕获的本轮runner均已返回，不宣称基础设施全树清空；正式软件/数据/配置未动，用户无需重复安装旧包。
'''
for file in ['PROJECT_CONTEXT.md', 'ARCHITECTURE.md', 'AUDIT_REPORT.md', 'OPTIMIZATION_PLAN.md', 'TEST_REPORT.md', 'HANDOFF.md', 'CHANGELOG.md', 'UI_AUDIT.md']:
    target = ROOT / file
    original = target.read_text('utf-8')
    assert section.split('\n')[0] not in original
    title, rest = original.split('\n', 1)
    target.write_bytes((title + '\n\n' + section + '\n' + rest.lstrip('\n')).encode('utf-8'))
print(json.dumps({'oldPurePassed': 28, 'newPurePassed': 4, 'nativeGuiQualified': False, 'productionChanged': False}))
