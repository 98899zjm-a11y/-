"""Host text-only adapter writer. Reads two explicit QA sources; executes neither."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def replace(text, old, new):
    if text.count(old) != 1:
        raise RuntimeError('Reviewed QA source layout changed; no adapters written')
    return text.replace(old, new)


def main():
    if ROOT != Path('E:/codex/2026-10-15/work/xjy-v16-deep-audit'):
        raise RuntimeError('Only isolated source text preparation is authorized')
    driver = (ROOT/'audit-tools/current-ui-driver.py').read_text('utf-8')
    probe = (ROOT/'audit-tools/current-ui-probe.cjs').read_text('utf-8')
    driver = replace(driver, "spec = importlib.util.spec_from_file_location('current_ui_package', ROOT/'audit-tools/current-ui-package.py')\npackage = importlib.util.module_from_spec(spec)\nspec.loader.exec_module(package)",
                     'package = None  # Loaded from Root-pinned bytes in the explicit main entry.')
    start = driver.index('def listeners():\n')
    end = driver.index('\n\ndef require_closed_data_files():', start)
    driver = driver[:start]+'''def listeners():
    return package.context()[0].listeners()  # A failed observation must never report clean.
'''+driver[end:]
    driver = driver.replace("'current-ui-'", "'next-ui-'")
    driver = replace(driver, "result = {'version': 1, 'purpose': 'current-source-ui-qa'", "result = {'version': 1, 'purpose': 'next-source-ui-qa'")
    driver = replace(driver, "str(ROOT/'audit-tools/current-ui-probe.cjs'), run_id, str(native.pid)",
                     "str(ROOT/'audit-tools/next-ui-probe.cjs'), run_id, str(native.pid), package._seals[0], package._seals[2], package._seals[1]")
    driver = replace(driver, '''    if profile.exists():
        if not owner_file.exists() or package.read_json(owner_file) != owner:
            raise RuntimeError('Existing native profile is not this reviewed UI run; preserve it and stop')
    else:
        profile.mkdir(parents=True)
        package.put(owner_file, (json.dumps(owner, indent=2)+'\\n').encode())
''', '''    if not profile.exists() or not owner_file.exists() or package.read_json(owner_file) != owner:
        raise RuntimeError('Exact committed ui-a2 QA owner required; no automatic adoption')
    package.verify_handoff()
''')
    driver = replace(driver, "    parser.add_argument('--run-id', required=True)\n    record = run(parser.parse_args().run_id)", '''    parser.add_argument('--contract-sha256', required=True)
    parser.add_argument('--materials-sha256', required=True)
    parser.add_argument('--package-evidence-sha256', required=True)
    args = parser.parse_args()
    import hashlib, types
    if os.name != 'nt' or os.path.normcase(str(ROOT)) != os.path.normcase('C:/xjy-work/xjy-web-stage1'):
        raise RuntimeError('Fixed actual Guest required before next UI setup')
    material_bytes = (ROOT/'audit-tools/next-ui-materials.json').read_bytes()
    if hashlib.sha256(material_bytes).hexdigest() != args.materials_sha256:
        raise RuntimeError('Root-reviewed materials required before helper load')
    pins = json.loads(material_bytes).get('harnessPins') or {}
    filename = ROOT/'audit-tools/next-ui-package.py'
    body = filename.read_bytes()
    if hashlib.sha256(body).hexdigest() != pins.get('audit-tools/next-ui-package.py'):
        raise RuntimeError('Root-reviewed next UI package source required')
    package = types.ModuleType('next_ui_driver_package')
    package.__file__ = str(filename)
    exec(compile(body, str(filename), 'exec'), package.__dict__)
    package.configure(args.contract_sha256, args.materials_sha256, args.package_evidence_sha256)
    record = run('ui-a2')''')
    probe = probe.replace('runtime/current-ui-', 'runtime/next-ui-').replace("'current-ui-'+runId", "'next-ui-'+runId").replace("'current-source-ui-qa'", "'next-source-ui-qa'")
    probe = replace(probe, "if(sha(fs.readFileSync(helperFile))!=='59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32')throw Error('Reviewed actual Guest CDP helper changed');\nconst helper=require(helperFile);helper.actualGuard();", '''const helperBytes=fs.readFileSync(ordinary(helperFile,ROOT));
if(sha(helperBytes)!=='59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32')throw Error('Reviewed actual Guest CDP helper changed');
const Module=require('node:module').Module,helperModule=new Module(helperFile,module);
helperModule.filename=helperFile;helperModule.paths=Module._nodeModulePaths(path.dirname(helperFile));
helperModule._compile(helperBytes.toString('utf8'),helperFile);
const helper=helperModule.exports;helper.actualGuard();''')
    probe = replace(probe, "const runId=process.argv[2],pid=Number(process.argv[3]);\nif(!/^[a-z][a-z0-9-]{0,31}$/.test(runId||'')||!Number.isSafeInteger(pid)||pid<1)throw Error('Bounded UI run ID and exact owned native PID required');", '''const runId=process.argv[2],pid=Number(process.argv[3]),contractSha=process.argv[4],packageEvidenceSha=process.argv[5],materialsSha=process.argv[6];
if(process.argv.length!==7||runId!=='ui-a2'||!Number.isSafeInteger(pid)||pid<1||![contractSha,packageEvidenceSha,materialsSha].every(x=>/^[a-f0-9]{64}$/.test(x||'')))throw Error('Fixed ui-a2 PID and three independent Root seals required');
const contractBytes=fs.readFileSync(ordinary(path.join(ROOT,'audit-tools/next-ui-contract.json'),ROOT)),materialBytes=fs.readFileSync(ordinary(path.join(ROOT,'audit-tools/next-ui-materials.json'),ROOT));
if(sha(contractBytes)!==contractSha||sha(materialBytes)!==materialsSha)throw Error('Root-reviewed next UI inputs changed');
const contract=JSON.parse(contractBytes),materials=JSON.parse(materialBytes);
if(contract.state!=='ROOT_REVIEWED_BUILD4'||contract.runId!=='ui-a2'||contract.build?.name!=='build-current4'||materials.state!=='ROOT_REVIEWED_BUILD4_MATERIALS'||materials.purpose!=='next-source-ui-materials'||materials.buildReportSha256!==contract.build.reportSha256||![contract.build.reportSha256,contract.build.newProgramTreeSha256].every(x=>/^[a-f0-9]{64}$/.test(x||''))||contract.engine?.version!=='44.7.0'||contract.engine?.executableSha256!=='db3ad2066a55546f9b6737da3c7f011370e4856fb36888055b544d45653e4f40'||materials.harnessPins?.['audit-tools/next-ui-probe.cjs']!==sha(fs.readFileSync(__filename)))throw Error('Unsealed actual build4/original-engine probe source refused');''')
    probe = replace(probe, "if(evidence.purpose!=='next-source-ui-qa'||evidence.runId!==runId||evidence.buildReportSha256!=='db1df96cd391d3994b020cd41ed57df54a294d814130a41939820a232071bf6d'||evidence.exactAppInput.toLowerCase()!==path.join(ROOT,'release-work/audit-code-xur5DA/app-input').toLowerCase())throw Error('Current build3 UI provenance required');", '''function exactAppPath(value){if(typeof value!=='string'||!path.isAbsolute(value))throw Error('Absolute build4 app path required');const absolute=ordinary(path.resolve(value),path.join(ROOT,'release-work'));if(!fs.statSync(absolute).isDirectory())throw Error('Ordinary actual build4 app directory required');return absolute;}
if(sha(packageBytes)!==packageEvidenceSha||evidence.purpose!=='next-source-ui-qa'||evidence.runId!==runId||evidence.buildReportSha256!==contract.build.reportSha256||evidence.programTreeSha256!==contract.build.newProgramTreeSha256||exactAppPath(evidence.exactAppInput).toLowerCase()!==exactAppPath(contract.build.appInput).toLowerCase())throw Error('Independent actual build4 package provenance required');
const nativeIdentity=ps(`Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress`);
if(nativeIdentity?.ProcessId!==pid||String(nativeIdentity.ExecutablePath).toLowerCase()!==path.join(base,'program','鑫金源珠宝报价.exe').toLowerCase()||!String(nativeIdentity.CommandLine).includes('--remote-debugging-port=42791'))throw Error('Only the actual new capsule native process may be observed');''')
    probe = replace(probe, 'cookie:tokenEvidence(match?.[1],!!cookie||!!setCookie)',
                    r'cookie:tokenEvidence(match?.[1],!!cookie||!!setCookie),bootstrap:tokenEvidence(/(?:^|[;\s])xjy_stage1_bootstrap=([^;\s]+)/.exec(value)?.[1],!!cookie||!!setCookie)')
    probe = replace(probe, 'Get-NetTCPConnection -State Listen -LocalPort 42792 -ErrorAction SilentlyContinue',
                    'Get-NetTCPConnection -ErrorAction Stop | Where-Object State -eq Listen | Where-Object LocalPort -eq 42792')
    for name, body in [('next-ui-driver.py', driver), ('next-ui-probe.cjs', probe)]:
        with (ROOT/'audit-tools'/name).open('xb') as stream:
            stream.write(body.encode('utf-8'))
    print('Wrote two source-only QA adapters; old sources unmodified; no product executed')


if __name__ == '__main__':
    main()
