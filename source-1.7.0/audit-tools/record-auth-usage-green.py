"""Data-only checkpoint for already finished Guest tests. No product imports."""
from pathlib import Path
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[1]
def sha(relative):
    return hashlib.sha256((ROOT / relative).read_bytes()).hexdigest()

runs = [('auth-usage-green-a1', 'auth-usage-durability', 3),
        ('auth-usage-green-a1', 'relogin-records', 22),
        ('auth-usage-green-a1', 'auth-regression', 95),
        ('auth-usage-controls-a1', 'auth-savepoint-controls', 5)]
for run, name, count in runs:
    log = (ROOT / f'sandbox/results/{run}/{name}.log').read_text('utf-8')
    for key, value in [('tests', count), ('pass', count), ('fail', 0), ('skipped', 0)]:
        assert re.search(r'^# ' + key + ' ' + str(value) + r'$', log, re.M), (run, name, key)
assert sha('project/desktop/administration.cjs') == '7132a5a253dcafa57aba570f6aa491969a7204157c15e14f3ccf94757f232ea6'
files = ['project/desktop/administration.cjs',
         'audit-tools/auth-usage-durability-supplement.test.cjs',
         'audit-tools/auth-usage-savepoint-controls.test.cjs',
         'sandbox/results/auth-usage-red-a1/auth-usage-durability.log',
         'sandbox/results/auth-usage-green-a1-applied.json']
files.extend(f'sandbox/results/{run}/{name}.log' for run, name, count in runs)
evidence = {
    'version': 1, 'purpose': 'usage-start local atomicity after real fault-injection RED',
    'actualOfflineGuest': True,
    'sourceSHA256': sha('project/desktop/administration.cjs'),
    'hashes': {file: sha(file) for file in files},
    'red3': {'pass': 1, 'fail': 2}, 'green3': {'pass': 3, 'fail': 0},
    'olderRelogin22': {'pass': 22, 'fail': 0},
    'relatedSession95': {'pass': 95, 'fail': 0},
    'normalAndNestedControls5': {'pass': 5, 'fail': 0},
    'databases': 'fictitious real SQLite RAM only',
    'setupAccountCommittedTransactionPreserved': True,
    'partialUsageFailureRolledBack': True, 'correctExistingIdempotent': True,
    'outerCommitNotCancelled': True, 'innerReleaseDoesNotCommitOuter': True,
    'schemaOrPricingChanged': False, 'passwordOrLimiterChanged': False,
    'cleanupAndReleaseFaultsInjected': False,
    'physicalPowerLossDurabilityVerified': False, 'productionDataUsed': False,
    'newFullRegressionRequired': True,
}
target = ROOT / 'audit-evidence/auth-usage-durability-green-20261016.json'
with target.open('x', encoding='utf-8', newline='\n') as stream:
    json.dump(evidence, stream, indent=2, ensure_ascii=False)
    stream.write('\n')

section = '''## 2026-10-16 使用记录局部原子性补测与修复

新增3个真实SQLite RAM故障样本先1通过/2失败：BEFORE IGNORE仍200，AFTER FAIL留下open usage；fresh setup ABORT后已提交账号/审计保留且可正常登录控制通过。startSession仅增加独立SAVEPOINT、changes和实存id/staff/open核验，错误仅回退自身，不回退setup账号事务或复活旧身份。正确existing同行幂等保留，错staff/ended拒绝；未改密码/限流/权限/公式/数据库结构。

实际修复后3/3、原22/22、会话95/95各0skip通过；独立正向/嵌套5/5通过，证明外层marker/COMMIT不被取消、inner RELEASE不提前提交outer。这些是RAM真实SQL故障/事务验证，不等于文件DB断电耐久或cleanup失败已注入。证据audit-evidence/auth-usage-durability-green-20261016.json。新CJS源7132…尚需下一轮完整回归；不复用之前build6的21组通过冒称新源全套通过。
'''
for name in ['AUDIT_REPORT.md', 'TEST_REPORT.md', 'PROJECT_CONTEXT.md', 'ARCHITECTURE.md',
             'OPTIMIZATION_PLAN.md', 'HANDOFF.md', 'CHANGELOG.md']:
    file = ROOT / name
    text = file.read_text('utf-8')
    assert section.split('\n')[0] not in text, name
    title, rest = text.split('\n', 1)
    file.write_bytes((title + '\n\n' + section + '\n' + rest.lstrip('\n')).encode('utf-8'))
file = ROOT / 'OPEN_SOURCE_REFERENCES.md'
text = file.read_text('utf-8')
title, rest = text.split('\n', 1)
reference = '''## 2026-10-16 SQLite使用记录局部事务

按[SQLite SAVEPOINT](https://www.sqlite.org/lang_savepoint.html)与[冲突算法](https://www.sqlite.org/lang_conflict.html)保留局部回退/外层提交语义；FAIL不保证撤销语句先前变更、IGNORE可不抛错，因此核实存行。内部RELEASE不能宣称外层已持久提交，当前5项真实嵌套控制已覆盖基本行为；不新增外部依赖。
'''
assert reference.split('\n')[0] not in text
file.write_bytes((title + '\n\n' + reference + '\n' + rest.lstrip('\n')).encode('utf-8'))
print(json.dumps({'newFaultSamplesGreen': 3, 'originalReloginGreen': 22,
                  'relatedAuthGreen': 95, 'additionalControlsGreen': 5,
                  'newestFullRegressionFinished': False}))
