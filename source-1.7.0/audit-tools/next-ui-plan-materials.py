"""Guest data-only proposal from an ACTUAL build4. No program/owner writes or launch.

Root must review and explicitly adopt the proposals; their state stays unreviewed.
Old materials supply path inventories only; every current byte is remeasured.
"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import types

ROOT = Path(__file__).resolve().parent.parent


def plan(args):
    if os.name != 'nt' or os.path.normcase(str(ROOT)) != os.path.normcase('C:/xjy-work/xjy-web-stage1'):
        raise RuntimeError('Actual fixed Guest required for read-only material proposal')
    file = ROOT/'audit-tools/next-ui-common.py'
    body = file.read_bytes()
    if hashlib.sha256(body).hexdigest() != args.common_sha256:
        raise RuntimeError('Explicit Root-reviewed common source SHA required')
    common = types.ModuleType('next_ui_plan_common')
    common.__file__ = str(file)
    exec(compile(body, str(file), 'exec'), common.__dict__)
    proof = common.actual_guard()
    if common.read_json(ROOT/'isolation-identity.json').get('namespace') != '36fcbe9c-ece1-4be3-af35-309a2ee19e05':
        raise RuntimeError('Only the known same synthetic namespace may propose ui-a2')
    build = common.sealed(common.RESULTS/'current-code-build-build-current4.json', args.build_report_sha256, common.RESULTS)
    app = common.ordinary(Path(build['app']))
    if app.name != 'app-input' or app.parent.parent != ROOT/'release-work' or app.parent.name in ('audit-code-xur5DA', 'audit-code-89MVHJ') or build.get('unsealed') is not True or build.get('installed') is not False or not build.get('sourceHashes'):
        raise RuntimeError('New actual build4 metadata required; old app inputs forbidden')
    for name, sha in build['sourceHashes'].items():
        if common.hash_file(ROOT/'project'/common.safe_relative(name))['sha256'] != sha:
            raise RuntimeError('Actual current source differs from build4')
    gateway = common.sealed(ROOT/'reports/web-runtime-build.json', args.gateway_report_sha256)
    source_sha = common.hash_file(ROOT/'stage1/web-gateway.cjs')['sha256']
    output_sha = common.hash_file(ROOT/'project/desktop/web-runtime/web-gateway.cjs')['sha256']
    if gateway.get('sourceSha256') != source_sha or gateway.get('sha256') != output_sha:
        raise RuntimeError('Actual recompiled gateway source/output mismatch')
    old_material = common.sealed(ROOT/'audit-tools/current-ui-materials.json', '5c7d55953490ab8bd982fed519a905a8ea2f9961daa1c8fbba176eb5b83e68d0')
    if common.hash_file(ROOT/'stage1/build-full-release.cjs')['sha256'] != old_material['runtimeBuilderSha256']:
        raise RuntimeError('Runtime inventory builder changed; a new explicit inventory review is required')
    candidate, _ = common.original().verify_candidate()
    engine = common.read_json(candidate/'engine-allowlist.json')
    resource = common.read_json(candidate/'release-manifest.json')
    rows = []

    def add(source, target, kind):
        rows.append({'path': common.safe_relative(target), 'source': source, 'kind': kind,
                     **common.hash_file(Path(source) if kind == 'build4' else ROOT/source)})

    for row in engine['files']:
        add('release-candidate/'+row['path'], row['path'], 'original-engine')
    for row in resource['files']:
        if row['path'].startswith(('resources/print-dependencies/', 'resources/release-modules/')) or row['path'] == 'resources/app.asar.unpacked/ocr.winrt.ps1':
            add('release-candidate/'+row['path'], row['path'], 'fixed-resource')
    for row in old_material['runtimeFiles']:
        if row['source'] != 'project/desktop/'+row['target']:
            raise RuntimeError('Old path inventory has a non-current runtime origin')
        add(row['source'], 'resources/app/'+row['target'], 'current-runtime')
    compiled = common.scan(app)
    for row in compiled:
        add(str(app/row['path']), 'resources/app/'+row['path'], 'build4')
    for row in build['generated']:
        actual = next((item for item in compiled if item['path'] == 'generated/'+Path(row['file']).name), None)
        if not actual or actual['sha256'] != row['sha256']:
            raise RuntimeError('Generated file no longer matches actual build4 report')
    package = (json.dumps({'name': 'xjy-next-source-ui-qa', 'version': '1.6.0', 'private': True, 'main': 'release-entry.cjs'}, indent=2)+'\n').encode()
    rows.append({'path': 'resources/app/package.json', 'source': None, 'kind': 'qa-entry', 'size': len(package), 'sha256': common.digest(package)})
    rows.sort(key=lambda row: row['path'])
    if len({row['path'].casefold() for row in rows}) != len(rows):
        raise RuntimeError('Ambiguous complete target inventory')
    names = ['next-ui-owner-policy.py', 'next-ui-common.py', 'next-ui-package.py', 'next-ui-driver.py', 'next-ui-probe.cjs', 'next-ui-owner-handoff.py']
    material = {'version': 1, 'purpose': 'next-source-ui-materials', 'state': 'PROPOSED_MATERIALS_UNREVIEWED',
                'actualContext': proof, 'buildReportSha256': args.build_report_sha256, 'sourceHashes': build['sourceHashes'],
                'harnessPins': {'audit-tools/'+name: common.hash_file(ROOT/'audit-tools'/name)['sha256'] for name in names},
                'buildToolPins': {name: common.hash_file(ROOT/name)['sha256'] for name in ('stage1/build-full-release.cjs', 'stage1/build-web-runtime.cjs')},
                'programFiles': rows, 'programExecuted': False, 'ownerChanged': False}
    contract = common.read_json(ROOT/'audit-tools/next-ui-contract.json')
    contract['state'] = 'PROPOSED_BUILD4_UNREVIEWED'
    contract['build'].update(reportSha256=args.build_report_sha256, appInput=str(app).replace('\\', '/'),
                              newProgramTreeSha256=common.tree_digest(rows), gatewaySourceSha256=source_sha,
                              gatewayOutputSha256=output_sha, webRuntimeBuildReportSha256=args.gateway_report_sha256)
    for filename, value in [('next-ui-ui-a2-materials-proposal.json', material), ('next-ui-ui-a2-contract-proposal.json', contract)]:
        common.put(common.RESULTS/filename, (json.dumps(value, ensure_ascii=True, indent=2)+'\n').encode(), common.RESULTS)
    return {'proposalOnly': True, 'programTreeSha256': contract['build']['newProgramTreeSha256'], 'programFiles': len(rows), 'programExecuted': False, 'ownerChanged': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--common-sha256', required=True)
    parser.add_argument('--build-report-sha256', required=True)
    parser.add_argument('--gateway-report-sha256', required=True)
    print(json.dumps(plan(parser.parse_args())))
