"""Data-only checkpoint for finished scope-B2 metadata probe; no product imports."""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
def sha(relative):
    return hashlib.sha256((ROOT / relative).read_bytes()).hexdigest()

relative = 'sandbox/results/ui-observer-b-b2/result.json'
assert sha(relative) == '82b67e9aa6be4b157911a2f37b2c38d4b867c2b92b7eccf9afc6cf8491d38b70'
result = json.loads((ROOT / relative).read_text('utf-8'))
assert result['passed'] is True and len(result['checks']) == 12 and all(value is True for value in result['checks'].values())
assert result['normalStop']['passed'] is True and result['normalStop']['newCapturedProcessForcedStop'] is False
assert result['collector']['workerStarts'] == 1 and result['collector']['requests'] == result['collector']['responses'] == result['collector']['lastSequence'] == 10
assert result['collector']['popenExitCode'] == 0 and result['collector']['stderrBytes'] == 0
assert result['normalStop']['childPopenExitCode'] == 0 and result['normalStop']['ownedHandlesRemaining'] == 0
assert result['uiAdmissionGranted'] is False and result['oldModelInstantiated'] is False
assert [item['frame']['sequence'] for item in result['observations']] == list(range(1, 11))
assert all(item['wmiChild']['disposition'] == 'not-enumerated' for item in result['observations'][7:])
for source, expected in result['sources'].items():
    assert sha(source) == expected
assert sha('audit-tools/ui-observer-collector-contract.json') == result['contractSha256'] == 'deddd0c463eebaf479de53e024812a55518ac3d67bc8080347097cd750d37f27'
evidence = {
    'version': 1, 'purpose': 'strict capability correction and actual bounded B2 collector proof',
    'actualOfflineGuest': True, 'result': relative, 'resultSha256': sha(relative),
    'contractSha256': result['contractSha256'], 'sources': result['sources'],
    'literalSha256': result['workerLiteralSha256'], 'checks': result['checks'],
    'collector': result['collector'], 'normalStop': result['normalStop'],
    'observations': [{'sequence': item['frame']['sequence'], 'phase': item['phase'],
                      'processRows': len(item['frame']['processes']), 'tcpRows': len(item['frame']['tcpListeners']),
                      'udpRows': len(item['frame']['udpEndpoints']), 'childDisposition': item['wmiChild']['disposition']}
                     for item in result['observations']],
    'originalB1FailurePreserved': True, 'uiAdmissionGranted': False,
    'workerDescendantClosureVerified': False, 'allListenersClosedClaimed': False,
    'productOrDatabaseExecuted': False, 'productionChanged': False,
}
with (ROOT / 'audit-evidence/ui-observer-scope-b2-green-20261016.json').open('x', encoding='utf-8', newline='\n') as stream:
    json.dump(evidence, stream, ensure_ascii=False, indent=2)
    stream.write('\n')
section = '''## 2026-10-16 B2限定采集器实际通过

原B1能力门禁失败由只读元数据定位为误把CDXML嵌套模块名当NetTCPIP；新B2严格核三个command的name/type/source/module/path/base及实际双模块搜索路径，没有放宽未知来源或吞stderr。Root新封deddd0…并实际Guest运行：12/12 true、单worker 10req/10resp、EOF0/空stderr，child EOF0/owned0，无强杀；原B1 FAIL不改。

前7帧live DMTF与完整held ticks来源投影一致；退出后3帧均未枚举child，post仅held status而非fresh image。自有TCP/UDP各增减1行，原17TCP/6UDP未清零且不作全局clear声明。UI资格/旧model接线/worker完整后代closure仍未验证，不能把这项写成新UI PASS。证据audit-evidence/ui-observer-scope-b2-green-20261016.json。
'''
for name in ['HANDOFF.md', 'TEST_REPORT.md', 'UI_AUDIT.md', 'CHANGELOG.md']:
    file = ROOT / name
    original = file.read_text('utf-8')
    assert section.split('\n')[0] not in original
    title, rest = original.split('\n', 1)
    file.write_bytes((title + '\n\n' + section + '\n' + rest.lstrip('\n')).encode('utf-8'))
print(json.dumps({'scopeB2ChecksPassed': 12, 'uiAdmissionGranted': False}))
