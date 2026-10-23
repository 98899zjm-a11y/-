"""Host data-only checkpoint: hashes text reports, never imports product code."""
from pathlib import Path
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parent.parent
def sha(file):
    return hashlib.sha256((ROOT / file).read_bytes()).hexdigest()

run = ROOT / 'sandbox/results/relogin-native-green-a1'
rows = json.loads((run / 'results.json').read_text('utf-8'))
assert len(rows) == 2 and all(row['exitCode'] == 0 and row['passed'] for row in rows)
for name, count in [('relogin-records', 22), ('auth-regression', 95)]:
    log = (run / (name + '.log')).read_text('utf-8')
    for key, value in [('tests', count), ('pass', count), ('fail', 0), ('skipped', 0)]:
        assert re.search(r'^# ' + key + ' ' + str(value) + r'$', log, re.M), (name, key)
old = (ROOT / 'sandbox/results/relogin-p1-extra-red-a1-stdout.log').read_text('utf-8')
assert 'tests 22' in old and 'pass 21' in old and 'fail 1' in old
build_path = 'sandbox/results/current-code-build-build-current5.json'
build = json.loads((ROOT / build_path).read_text('utf-8'))
assert build['unsealed'] and not build['installed'] and not build['serviceStarted']
assert len(build['sourceHashes']) == 166
for relative, expected in build['sourceHashes'].items():
    assert sha('project/' + relative) == expected, relative
sources = ['project/desktop/local-auth.cjs', 'project/desktop/backend.cjs',
           'project/desktop/administration.cjs', 'stage1/web-gateway.cjs',
           'project/desktop/web-runtime/web-gateway.cjs',
           'audit-tools/browser-relogin-audit-records.test.cjs', 'project/app/globals.css']
evidence = {
    'version': 1, 'purpose': 'Native session establishment failure and build5 checkpoint',
    'actualOfflineGuest': True, 'sourceHashes': {file: sha(file) for file in sources},
    'results': {'originalExtra22': {'pass': 21, 'fail': 1},
                'nativeGreen22': {'pass': 22, 'fail': 0, 'skip': 0},
                'relatedAuth95': {'pass': 95, 'fail': 0, 'skip': 0}},
    'logs': {file: sha(file) for file in [
        'sandbox/results/relogin-native-green-a1/results.json',
        'sandbox/results/relogin-native-green-a1/relogin-records.log',
        'sandbox/results/relogin-native-green-a1/auth-regression.log', build_path]},
    'build': {'app': build['app'], 'verifiedCurrentSources': 166,
              'unsealed': True, 'installed': False, 'fullExeRelease': False},
    'remainingFaultCoverage': ['silent usage INSERT IGNORE', 'AFTER trigger partial failure',
                              'setup account committed but usage start fails',
                              'post-establishment status exception', 'COMMIT fault'],
    'uiOuterQualified': False, 'phoneHardwareVerified': False,
    'productionDeploymentAuthorized': False, 'productionDataUsed': False,
}
target = ROOT / 'audit-evidence/native-establish-green-build5-20261016.json'
with target.open('x', encoding='utf-8', newline='\n') as stream:
    json.dump(evidence, stream, indent=2, ensure_ascii=False)
    stream.write('\n')
common = (
    'C1旧端维修金额兼容15/15、维修历史20/20及金额边界18/18已在实际隔离环境通过。'
    'P1重登录原15项通过后，追加22项曾21通过1失败；本机使用记录INSERT异常后仍保留身份的问题'
    '经最小修复，现固定22项及原会话95项均全部通过。原RED不覆盖。'
    '只在startSession成功后发布身份和usage UUID；setup已提交账号不删除，原密码/限流/退出顺序不变。\n\n'
    'build-current5实际成功，166份当前源摘要全部匹配；该目录只是不封签的编译产物，尚无新的完整EXE升级包、'
    '安装或部署。完整回归尚需对新源重跑。旧build4的21组/917项不得套用到新构建。'
    '手机导航CSS已编入build5，但未真实UI复验；UI-a2外层PID身份歧义FAIL仍未关闭。'
    '真实iPhone/Android、公网、实体打印、财务/库管全业务UI及完整新引擎升级仍未验收。\n\n'
    '当前并行准备十员工真实业务会话测试及QA观察器原生句柄方案。纯观察器21项模型通过和原broker'
    '实际18项通过只证明各自范围，不能提升GUI验收资格。silent IGNORE、AFTER部分写、setup建立失败'
    '等故障仍未由本轮22项覆盖，已登记。正式数据库/配置/密钥未用于测试，员工包由用户自行发送。'
    '精确证据见audit-evidence/native-establish-green-build5-20261016.json。\n'
)
sections = {
    'PROJECT_CONTEXT.md': common,
    'AUDIT_REPORT.md': common,
    'OPTIMIZATION_PLAN.md': common,
    'TEST_REPORT.md': common,
    'HANDOFF.md': common + '\n下一执行点：W为xjy-v16-deep-audit；实际Guest '
        'ed25d385-d344-4bfa-8878-cd088dc2c0ea，Root独占Guest；先审十员工固定源及fresh '
        'concurrency-business-a1报告/材料，再封源执行，不能用身份/SQL模拟替代真实runtime。'
        'Native候选SHA9ed8c328…，产品源待独立review后提交；globals.css尚未UI验收。\n',
    'FINANCIAL_AUDIT.md': 'C1兼容15/15、F4维修20/20、F5金额18/18保持实际通过。'
        '本批Native身份建立修复不改金额、数据库结构、经营公式或历史重算口径。'
        '即将测试10员工真实SQL开单的literal52000分、编号与成交幂等；当前尚无该项通过结论。\n',
    'ARCHITECTURE.md': '本机auth身份/密码hash/usage UUID/活动时间四字段，现仅在原startSession返回后共同发布。'
        '建立抛错清空四字段，不恢复原账号，不回滚setup已提交账号。浏览器独立T/内部不透明审计ticket协议不变。'
        '现有串行backend队列与真实runtime AsyncLocalStorage保持；十会话测试将分别验证在途请求与跨await身份，'
        '不把串行后端描述成十个SQLite并行写事务。\n',
    'UI_DESIGN_SPEC.md': 'build5包含C1旧端兼容与手机底栏72px最小宽/44px最小高候选；尚未新GUI复验。'
        '原首页不改。旧UI-a2内部探针范围通过、外层PID身份歧义FAIL和正常退出证据继续并列保存。'
        '通用Dialog焦点仅在设计复审，不标已实现。\n',
    'OPEN_SOURCE_REFERENCES.md': '继续参考固定版本CPython v3.14.0 '
        '[subprocess实现](https://github.com/python/cpython/blob/v3.14.0/Lib/subprocess.py)、'
        '[Microsoft进程句柄](https://learn.microsoft.com/en-us/windows/win32/procthread/process-handles-and-identifiers)'
        '及[GetProcessTimes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes)。'
        '仅借鉴保留句柄与原始64位FILETIME身份比较，不复制新依赖；CIM仅发现，不能声称6微秒位来源有内核100ns精度。'
        '原生适配器尚未实现或验收，不能因纯模型通过弱化原guard。\n',
    'CHANGELOG.md': '- 本机auth使用记录写入失败时不再发布残留身份；固定22及旧95实际全部通过。\n'
        '- build5重新编译并核验166当前源；未封签、未安装，非完整EXE发布。\n'
        '- C1兼容与P1审计原RED/故障证据保留；UI外层FAIL、实际手机/打印/完整回归仍待关闭。\n',
}
marker = '## 2026-10-16 第七批：Native故障GREEN与build5检查点'
for name, section in sections.items():
    file = ROOT / name
    text = file.read_text('utf-8')
    assert marker not in text, name
    title, remainder = text.split('\n', 1)
    file.write_bytes((title + '\n\n' + marker + '\n\n' + section + '\n' + remainder.lstrip('\n')).encode('utf-8'))
print(json.dumps({'actualGuestResultsVerified': [22, 95], 'buildCurrentSourcesVerified': 166,
                  'evidenceSha256': sha(target.relative_to(ROOT)), 'documentsUpdated': len(sections)}))
