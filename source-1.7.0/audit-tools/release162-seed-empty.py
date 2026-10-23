"""Root-only Guest seed through the unchanged restricted smoke launcher.

This wrapper does not implement a schema, import a business module, connect to
SQLite, launch a release EXE, kill a process, or repair/relabel an existing slot.
The ORIGINAL launcher/supervisor may terminate owned children; see the spec.
"""
from pathlib import Path
import argparse
import hashlib
import importlib.util
import json
import os
import stat
import subprocess
import sys
import time

ROOT = Path('C:/xjy-work/xjy-web-stage1')
RESULTS = Path('C:/xjy-results')
WORK = ROOT / 'release-work/release162-seed-a1'
PYTHON = Path('C:/Python314/python.exe')
POWERSHELL = Path('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe')
NAMESPACE = '36fcbe9c-ece1-4be3-af35-309a2ee19e05'
PREPARATION_SHA = '50a3b6fc130fbfab22abeb72bd9f7aceb5a015e0c9d7ab5f49002099f16a80e0'
PREP_REPORT_SHA = '3577e9ee4984752215465b29564a11343dd425a31916d6947d7fe99780b99c8b'
CANDIDATE_SHA = '664073e355f594d01642131aa8ee20e33bcca89bd172110b90c3e7105bba5413'
MANIFEST_SHA = 'fe20ea7d83f2e2200624bf81364078ca8b206d1efcc8dbad03b1841d0fab9da2'
SOURCE_TREE_SHA = 'ce4d7acab44235688a841c9b70e546897b8c8bc63058d3a3c34fbcf4fe20175b'
PYTHON_SHA = '434b361fe0c5960d404974feed493db47f2603a1ace2574312104fbed0182c6f'
PINS = {
    'stage1/run-restricted.py': '742e25f5405f69a345c7557e19bfa674a490ae0e57c9d5c957922a9e41b6b1bc',
    'stage1/sandbox-context.py': '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
    'stage1/validate-sandbox-context.py': '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207',
    'stage1/host.cjs': '887191c81ca04087ac64246ea2422e31305965c7312261504fab8ea341622d5f',
    'stage1/create-fixture.py': 'a8051b880333a988c79e29fb90596563f07af1d8d9b6b5272f1a70bc4580e75a',
    'stage1/token-info.py': 'cc3d9fb3a99dc249754fa2ef35afc16ad0597bf96a89ef665b60bb01032a84ce',
    'stage1/io-guard.cjs': '28d25feb5340273806823d41e5e0bd95b5120086920711cc80101b85e6074f2c',
    'stage1/isolation.cjs': 'dd1eea05233607ca20bf19d931e4a5bd10dccd2cbe80ef4697685b6a4fdf759a',
    'stage1/python_guard.py': '1774ebe7a94fd6f7bbc9a363181497e63dd7eb466316259b5f662277287604db',
    'stage1/restore-service.cjs': 'a8f9a91cd08b9aef27507e44eed02fbece9cd431ae4294e20bd425769453cbc0',
    'stage1/web-gateway.cjs': '3fb5521a94ff5e8fcac514a48d3cfccaf293017c43b54c43b6c26b0041c0a515',
    'stage1/backups.cjs': '7ef7693ef0085f57f64a15d72bac3b45b919c875a4e53d2ae3f8be76cddeb8a7',
    'stage1/local-maintenance.cjs': 'ea42461ece44bfd29cd9089dcb27636480a303d3a605ad106f9b460415d27875',
    'stage1/daily-backup.cjs': 'ad0d9fcf11ea0dc283bb41a034fb888d7e76624bf6f795e2e59b61a103f6e5e2',
    'stage1/ai-bridge.cjs': '65f6b556740fd761ee313b8dbf21b0c45ab286abd23d78f66bfb24f17d2537eb',
    'stage1/browser-module-proxy.cjs': 'e08a6e6ef5bed07bf43d4a22eabbe46437add234fd2aec40cc37231ffd904fb0',
    'stage1/erp-web-adapter.cjs': 'eda0fc55a3bd59e976cc429bc679440727aa4758e0ab8dc6e67f76e7daa8140b',
    'stage1/native-preview.cjs': 'ef896751d2c259cacc962fc9e315b9a2a0efeb3286345eaf4229f72e8c5ae2ce',
    'tests/host-smoke.cjs': '58a5edbeb56ec55b24168d3125150554b4000a6b693b1080d0f77ce35314296a',
    'project/desktop/legacy-modules/manifest.json': '5f0e8d919c541ac07d305544bb1c7036e7cb4ced8c5c4ee8cf262c927bc373d2',
    'stage1/tools/node.exe': 'ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32',
}
GENERATED = {
    'business.cjs': (251856, '67ba1ea58142ea46492a9a5ff0f516287370ae709f97f8d317c1b1523a92aaf3'),
    'print-domain.cjs': (178903, 'a71eeb67e3af314ea849c4e50708a056f1d6f65fb1d0c585b8f705369155de35'),
    'print-worker-templates.cjs': (1977839, 'a02bb9ac21e777beec6797623964ec660c6cf7578a3f48e9e2355b3141defbfd'),
    'print-worker-preload.cjs': (9228, 'dabe6ccc11be733834d94f10aff3e588de8867f283d0dd359fdd35f5b8a9777c'),
}
SLOTS = {'sales': 'jewelry.sqlite', 'ledger': 'ledger.db', 'inventory': 'stockcheck.db'}
PROFILES = ('config/desktop-profile', 'config/employee-profile')
RESIDUE_FILES = ('runtime/host-ready.json', 'runtime/restore-transaction.json',
                 'runtime/stop-request.json', 'config/document-number-reservations.json',
                 'config/isolated-layout.json', 'config/internal-modules.json', 'config/backup-key.bin')
EMPTY_DIRS = ('runtime/restorations', 'runtime/restore-stage', 'runtime/snapshots',
              'runtime/modules', 'data/documents', 'backups')
OLD_EVIDENCE = ('logs/host-smoke-result.json', 'logs/host-error.log',
                'logs/ledger-fixture-result.json', 'logs/inventory-fixture-result.json',
                'logs/python-create-fixture.py.log', 'reports/restricted-token-precheck.json',
                'reports/restricted-token-check.json', 'reports/acl-helper-error.log')


def need(value, message):
    if not value:
        raise RuntimeError(message)


def ordinary(value):
    file = Path(value)
    need(file.is_absolute() and (file.is_relative_to(ROOT) or file.is_relative_to(RESULTS)
         or file in (PYTHON, POWERSHELL)), 'FIXED_OWNED_PATH_REQUIRED')
    for item in (file, *file.parents):
        try:
            info = item.lstat()
        except FileNotFoundError:
            continue
        need(not stat.S_ISLNK(info.st_mode) and not getattr(info, 'st_file_attributes', 0) & 0x400,
             'REPARSE_PATH_REFUSED')
        need(not stat.S_ISREG(info.st_mode) or info.st_nlink == 1, 'HARDLINK_REFUSED')
    need(os.path.normcase(str(file.resolve())) == os.path.normcase(str(file)), 'PATH_ALIAS_REFUSED')
    return file


def stamp(info):
    return tuple(getattr(info, key, None) for key in
                 ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns', 'st_nlink', 'st_birthtime_ns'))


def read(file, pin=None, limit=512 * 1024 * 1024):
    file = ordinary(file)
    before = file.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_size <= limit, 'BOUNDED_REGULAR_INPUT_REQUIRED')
    with file.open('rb') as stream:
        opened = os.fstat(stream.fileno())
        body = stream.read(limit + 1)
        need(stamp(opened) == stamp(os.fstat(stream.fileno())), 'INPUT_FD_CHANGED')
    need(stamp(before) == stamp(ordinary(file).lstat()), 'INPUT_PATH_CHANGED')
    need(all(getattr(before, key) == getattr(opened, key) for key in
             ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_nlink')), 'INPUT_OBJECT_CHANGED')
    need(len(body) == before.st_size and (pin is None or hashlib.sha256(body).hexdigest() == pin),
         'INPUT_SIZE_OR_SHA_MISMATCH: ' + str(file))
    return body


def load(file, pin=None):
    return json.loads(read(file, pin, 4 * 1024 * 1024))


def relative(value):
    need(isinstance(value, str) and value and not any(c in value for c in '\\:\0')
         and all(x and x not in ('.', '..') and x.rstrip(' .') == x for x in value.split('/')),
         'UNSAFE_MANIFEST_PATH')
    return value


def put(file, body):
    file = ordinary(file)
    need(file.is_relative_to(WORK) or file == RESULTS / 'release162-seed-a1.json', 'OUTPUT_NOT_OWNED')
    ordinary(file.parent).mkdir(parents=True, exist_ok=True)
    ordinary(file.parent)
    with file.open('xb') as stream:
        stream.write(body)
        stream.flush()
        os.fsync(stream.fileno())
    need(read(file) == body, 'CREATE_NEW_READBACK_MISMATCH')


def save(file, value):
    put(file, (json.dumps(value, ensure_ascii=True, indent=2) + '\n').encode('ascii'))


def actual():
    need(os.name == 'nt' and Path(__file__).absolute() == ROOT / 'audit-tools/release162-seed-empty.py',
         'FIXED_ACTUAL_GUEST_SCRIPT_REQUIRED')
    need(Path(sys.executable) == PYTHON and sys.flags.isolated and sys.flags.no_site and sys.dont_write_bytecode,
         'PUBLIC_PYTHON_I_B_S_REQUIRED')
    read(PYTHON, PYTHON_SHA)
    for name, pin in PINS.items():
        read(ROOT / name, pin)
    spec = importlib.util.spec_from_file_location('original_release162_seed_guest', ROOT / 'stage1/sandbox-context.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    proof = module.read_context(ROOT)
    need(load(ROOT / 'isolation-identity.json')['namespace'] == NAMESPACE, 'EXACT_NAMESPACE_REQUIRED')
    return proof


def verify_inputs():
    report = load(RESULTS / 'release-162-preparation-a2.json', PREP_REPORT_SHA)
    prep = load(ROOT / 'release-work/release-162-a2/preparation.json', PREPARATION_SHA)
    sealed = load(RESULTS / 'release-162-candidate-a2.json', CANDIDATE_SHA)
    manifest = load(RESULTS / 'release-162-artifact-a2/release-manifest.json', MANIFEST_SHA)
    need(report['preparation'] == prep and report['savedPreparation']['sha256'] == PREPARATION_SHA
         and sealed['preparationSha256'] == PREPARATION_SHA and sealed['manifest'] == manifest,
         'CURRENT_A2_EVIDENCE_REQUIRED')
    app = ROOT / 'release-work/release-162-a2/app-input'
    need(prep['programVersion'] == '1.6.2' and Path(prep['app']) == app
         and prep['dataIncluded'] is False and prep['serviceStarted'] is False
         and sealed['sealed'] is True and sealed['signed'] is False,
         'A2_UNSIGNED_SOURCE_SCOPE_REQUIRED')
    for name, pin in prep['sourceHashes'].items():
        read(ROOT / 'project' / relative(name), pin)
    for name, pin in manifest['freeze']['files'].items():
        read(ROOT / 'project/desktop' / relative(name), pin)
    rows = {row['path']: row for row in prep['artifacts']['app']}
    generated = {}
    for name, (size, pin) in GENERATED.items():
        row = rows['generated/' + name]
        need(row['size'] == size and row['sha256'] == pin, 'CURRENT_A2_GENERATED_ROW_REQUIRED')
        body = read(app / 'generated' / name, pin)
        need(len(body) == size and any(x.get('output') == 'generated/' + name and x.get('sha256') == pin
             for x in prep['evidence']), 'ACTUAL_COMPILER_EVIDENCE_REQUIRED')
        generated[name] = body
    source = ROOT / 'project/desktop/legacy-source'
    tree = []
    for folder, dirs, files in os.walk(ordinary(source), followlinks=False):
        for name in dirs + files:
            ordinary(Path(folder) / name)
        for name in files:
            file = Path(folder) / name
            body = read(file)
            tree.append({'path': file.relative_to(source).as_posix(), 'size': len(body),
                         'sha256': hashlib.sha256(body).hexdigest()})
    tree.sort(key=lambda row: row['path'])
    canonical = json.dumps(tree, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode('ascii')
    need(len(tree) == 358 and hashlib.sha256(canonical).hexdigest() == SOURCE_TREE_SHA,
         'EXACT_PUBLIC_LEGACY_SOURCE_TREE_REQUIRED')
    modules = load(ROOT / 'project/desktop/legacy-modules/manifest.json',
                   PINS['project/desktop/legacy-modules/manifest.json'])
    need(modules['version'] == 1 and [m['id'] for m in modules['modules']] == ['ledger', 'inventory'],
         'ORIGINAL_STAGE1_SIDECARS_REQUIRED')
    for module in modules['modules']:
        base = ROOT / 'project/desktop/legacy-modules' / ('xjy-' + module['id'])
        expected = set()
        for row in module['files']:
            name = relative(row['path'])
            need(name.casefold() not in expected, 'DUPLICATE_SIDECAR_PATH')
            expected.add(name.casefold())
            need(len(read(base / name, row['sha256'])) == row['size'], 'SIDECAR_SIZE_MISMATCH')
        found = set()
        for folder, dirs, files in os.walk(ordinary(base), followlinks=False):
            for name in dirs + files:
                ordinary(Path(folder) / name)
            found.update((Path(folder) / name).relative_to(base).as_posix().casefold() for name in files)
        need(found == expected, 'EXTRA_OR_MISSING_STAGE1_SIDECAR_FILES')
    return generated


def empty_slots():
    for name, database in SLOTS.items():
        directory = ordinary(ROOT / 'data' / name)
        for leaf in (database, database + '-wal', database + '-shm', database + '-journal', 'synthetic-fixture.json'):
            need(not os.path.lexists(ordinary(directory / leaf)), 'EXISTING_SLOT_OR_MARKER_REFUSED')
        need(not directory.exists() or directory.is_dir() and not any(directory.iterdir()),
             'NONEMPTY_SLOT_DIRECTORY_REFUSED')
    for name in PROFILES + RESIDUE_FILES:
        need(not os.path.lexists(ordinary(ROOT / name)), 'EXISTING_PROFILE_OR_STATE_REFUSED: ' + name)
    for name in EMPTY_DIRS:
        directory = ordinary(ROOT / name)
        need(not directory.exists() or directory.is_dir() and not any(directory.iterdir()),
             'RESTORE_BACKUP_OR_MODULE_RESIDUE_REFUSED: ' + name)


def environment():
    scratch = ordinary(WORK / 'scratch')
    scratch.mkdir(exist_ok=True)
    env = {'SystemRoot': 'C:\\Windows', 'WINDIR': 'C:\\Windows',
           'COMSPEC': 'C:\\Windows\\System32\\cmd.exe', 'PATHEXT': '.COM;.EXE;.BAT;.CMD',
           'PATH': 'C:\\Windows\\System32',
           'PSModulePath': 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules'}
    env.update({key: str(scratch) for key in ('TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE')})
    return env


def quiet(label):
    # Metadata only; no process is stopped or adopted. The original launcher
    # alone acquires Global\\xjy_stage1_<namespace>; do not double-lock it here.
    command = r"""$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);
$root='C:\xjy-work\xjy-web-stage1'; $p=@(Get-CimInstance Win32_Process | Where-Object {
($_.ExecutablePath -and $_.ExecutablePath.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)) -or
($_.Name -eq 'node.exe' -and $_.CommandLine -and $_.CommandLine.IndexOf($root,[StringComparison]::OrdinalIgnoreCase) -ge 0)
} | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine);
$ports=@(31831,41831,42791,42792,42793,42831,42841);
$tcp=@(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object {$_.LocalPort -in $ports} | Select-Object LocalAddress,LocalPort,OwningProcess);
[ordered]@{processes=$p;listeners=$tcp} | ConvertTo-Json -Depth 4 -Compress"""
    for index in (1, 2):
        actual()
        stdout, stderr = WORK / (label + '-' + str(index) + '.stdout.log'), WORK / (label + '-' + str(index) + '.stderr.log')
        with ordinary(stdout).open('xb') as out, ordinary(stderr).open('xb') as err:
            child = subprocess.Popen([str(ordinary(POWERSHELL)), '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command],
                                     cwd=ROOT, env=environment(), stdin=subprocess.DEVNULL,
                                     stdout=out, stderr=err, creationflags=0x08000000)
            code = child.wait()  # no new timeout/kill policy
        need(code == 0, 'QUIESCENCE_METADATA_FAILED')
        proof = load(stdout)
        save(WORK / (label + '-' + str(index) + '.json'), proof)
        need(not proof['processes'] and not proof['listeners'], 'LIVE_PROCESS_OR_FIXED_PORT_REFUSED')
        if index == 1:
            time.sleep(0.6)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--expect-self-sha256', required=True)
    parser.add_argument('--a2-manifest-sha256', required=True)
    parser.add_argument('--seed-empty-synthetic-slots', action='store_true', required=True)
    parser.add_argument('--check-only', action='store_true')
    args = parser.parse_args()
    need(os.name == 'nt' and Path(__file__).absolute() == ROOT / 'audit-tools/release162-seed-empty.py',
         'FIXED_ACTUAL_GUEST_SCRIPT_REQUIRED')
    need(args.a2_manifest_sha256 == MANIFEST_SHA, 'EXACT_A2_MANIFEST_GATE_REQUIRED')
    read(Path(__file__).absolute(), args.expect_self_sha256)
    proof = actual()
    generated = verify_inputs()
    empty_slots()
    if args.check_only:
        print(json.dumps({'checkedOnly': True, 'actualGuest': proof, 'namespace': NAMESPACE,
                          'verifiedGeneratedFiles': len(generated), 'slotsEmpty': True,
                          'businessStarted': False, 'databaseCreated': False}))
        return
    need(not os.path.lexists(ordinary(WORK)) and not os.path.lexists(ordinary(RESULTS / 'release162-seed-a1.json')),
         'CREATE_NEW_RUN_AND_RESULT_REQUIRED')
    ordinary(WORK.parent)
    WORK.mkdir()
    report = {'version': 1, 'purpose': 'release162-empty-synthetic-slot-seed', 'status': 'REFUSED',
              'passed': False, 'actualGuest': proof, 'namespace': NAMESPACE, 'manifestSha256': MANIFEST_SHA,
              'preparationSha256': PREPARATION_SHA, 'harnessForcedStop': False,
              'originalLauncherTimeoutMs': 60000, 'originalJobKillOnCloseRetained': True,
              'originalAssignFailureTerminationRetained': True, 'originalSupervisorFallbackRetained': True,
              'allSidecarsNaturalExitProven': False, 'nativeStarted': False, 'productionDeployment': False}
    try:
        quiet('before')
        empty_slots()
        for name in OLD_EVIDENCE:
            file = ordinary(ROOT / name)
            if file.exists():
                put(WORK / 'evidence-before' / name, read(file))
        for name, body in generated.items():
            target = ordinary(ROOT / 'project/desktop/generated' / name)
            if target.exists():
                put(WORK / 'generated-before' / name, read(target))
            temporary = ordinary(target.with_name(name + '.release162-seed-a1.tmp'))
            with temporary.open('xb') as stream:
                stream.write(body)
                stream.flush()
                os.fsync(stream.fileno())
            need(read(temporary) == body, 'GENERATED_TEMP_READBACK_FAILED')
            ordinary(target)
            os.replace(temporary, target)
            read(target, GENERATED[name][1])
        empty_slots()
        actual()
        command = [str(PYTHON), '-I', '-B', str(ROOT / 'stage1/run-restricted.py'),
                   '--sandbox-guest', '--script', 'stage1/host.cjs', '--mode', 'smoke']
        report['argv'] = command
        with ordinary(WORK / 'stdout.log').open('xb') as out, ordinary(WORK / 'stderr.log').open('xb') as err:
            child = subprocess.Popen(command, cwd=ROOT, env=environment(), stdin=subprocess.DEVNULL,
                                     stdout=out, stderr=err, creationflags=0x08000000)
            report['launcherPid'] = child.pid
            report['launcherExitCode'] = child.wait()  # original 60s/Job policy remains inside launcher
        need(report['launcherExitCode'] == 0, 'ORIGINAL_RESTRICTED_SMOKE_FAILED_PRESERVE_ALL')
        stdout = read(WORK / 'stdout.log').decode('utf-8-sig')
        need(any(json.loads(line) == {'restrictedProcessExited': True, 'exitCode': 0}
             for line in stdout.splitlines() if line.startswith('{')), 'ORIGINAL_EXIT_PROOF_MISSING')
        smoke_file = ROOT / 'logs/host-smoke-result.json'
        smoke = load(smoke_file)
        need(smoke.get('passed') is True and smoke.get('mode') == 'smoke', 'ORIGINAL_SMOKE_RESULT_MISSING')
        put(WORK / 'host-smoke-result.json', read(smoke_file))
        for name, database in SLOTS.items():
            file = ordinary(ROOT / 'data' / name / database)
            info = file.lstat()
            need(stat.S_ISREG(info.st_mode) and info.st_size > 0, 'FACTORY_DATABASE_MISSING')
            marker = load(file.parent / 'synthetic-fixture.json')
            need(marker.get('synthetic') is True and marker.get('namespace') == NAMESPACE,
                 'FACTORY_SYNTHETIC_MARKER_MISMATCH')
            if name != 'sales':
                need(marker.get('module') == name and marker.get('integrity') == 'ok', 'FACTORY_INTEGRITY_MARKER_MISMATCH')
            put(WORK / 'markers' / name / 'synthetic-fixture.json', read(file.parent / 'synthetic-fixture.json'))
        need(all(not os.path.lexists(ordinary(ROOT / name)) for name in PROFILES)
             and not os.path.lexists(ordinary(ROOT / 'runtime/host-ready.json')), 'NORMAL_CLOSE_OR_PROFILE_SCOPE_FAILED')
        verify_inputs()
        for name, (_, pin) in GENERATED.items():
            read(ROOT / 'project/desktop/generated' / name, pin)
        quiet('after')
        report.update(status='SEEDED', passed=True, originalSmoke=smoke,
                      noObservedRootProcessOrFixedListener=True, legacySourceTreeSha256=SOURCE_TREE_SHA)
    except BaseException as error:
        report['error'] = str(error)
        raise
    finally:
        save(WORK / 'result.json', report)
        save(RESULTS / 'release162-seed-a1.json', report)


if __name__ == '__main__':
    main()
