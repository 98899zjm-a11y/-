"""Archive only the closed, known ui-a1 failed attempt; never launch or delete."""
from pathlib import Path
import argparse
import importlib.util
import json
import os
import stat
import subprocess
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('current_ui_archive_package', ROOT/'audit-tools/current-ui-package.py')
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)
RUN_ID = 'ui-a1'
ATTEMPT = 'attempt01'
RESULT_SHA = '0d4d49a97d524c3f5bafba96d543ed1afb03a025cfdca44027b252c08a7d4eca'
PROBE_SHA = '2cf0979167e138f9380e0f83664f4204fb326f4e743e1c88732b233e14456983'
PACKAGE_SHA = 'abec0248806c1881ff2057786b594f2528509b8d01b21fa7a1185fe792cb3248'


def utc():
    return datetime.now(timezone.utc).isoformat()


def content_tree(path, boundary):
    """Opaque file hashes and empty-directory names; never query a database."""
    path = package.ordinary(path, boundary)
    rows = []
    def walk(directory, prefix):
        package.ordinary(directory, boundary)
        with os.scandir(directory) as listing:
            entries = sorted(listing, key=lambda entry: entry.name)
        for entry in entries:
            file = Path(entry.path)
            package.ordinary(file, boundary)
            info = file.lstat()
            if getattr(info, 'st_file_attributes', 0) & 0x400 or stat.S_ISLNK(info.st_mode):
                raise RuntimeError('Archive refuses any reparse/link object')
            name = prefix+entry.name
            if stat.S_ISDIR(info.st_mode):
                rows.append({'path': name+'/', 'kind': 'directory'})
                walk(file, name+'/')
            elif stat.S_ISREG(info.st_mode) and info.st_nlink == 1:
                body = package.stable_bytes(file, boundary)
                rows.append({'path': name, 'kind': 'file', 'size': len(body), 'sha256': package.digest(body)})
            else:
                raise RuntimeError('Archive source is not an ordinary unique file/directory')
    if path.is_dir():
        walk(path, '')
    else:
        body = package.stable_bytes(path, boundary)
        rows.append({'path': '.', 'kind': 'file', 'size': len(body), 'sha256': package.digest(body)})
    if len({row['path'].lower() for row in rows}) != len(rows):
        raise RuntimeError('Archive Windows case collision refused')
    return rows


def identity(path, boundary):
    file = package.ordinary(path, boundary)
    info = file.lstat()
    return {'device': info.st_dev, 'inode': info.st_ino, 'size': info.st_size, 'mtimeNs': info.st_mtime_ns, 'links': info.st_nlink, 'directory': file.is_dir()}


def assert_protected_exclusion(path, protected):
    target = os.path.normcase(str(path.resolve()))
    for item in protected:
        guard = os.path.normcase(str(item.resolve()))
        if target == guard or target.startswith(guard+os.sep) or guard.startswith(target+os.sep):
            raise RuntimeError('Archive must not move a program/native-profile/business-data path')


def require_closed(original, known, base):
    package.actual_guard()
    rows = original.process_snapshot()
    old = {(row['ProcessId'], row['CreationUtc']) for row in known}
    program = os.path.normcase(str(base/'program'))+os.sep
    edge = os.path.normcase(str(base/'edge-profile'))
    for row in rows:
        if (row.get('ProcessId'), row.get('CreationUtc')) in old:
            raise RuntimeError('An exact previous owned process is still alive; archive refused')
        executable = os.path.normcase(str(row.get('ExecutablePath') or ''))
        command = os.path.normcase(str(row.get('CommandLine') or ''))
        if executable.startswith(program) or edge in command:
            raise RuntimeError('A process still occupies the unique UI program/profile namespace')
    command = "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $t=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object {$_.LocalPort -in @(31831,42791,42792,42793,42831)} | Select-Object LocalAddress,LocalPort,OwningProcess); $u=@(Get-NetUDPEndpoint -ErrorAction SilentlyContinue | Where-Object {$_.LocalPort -in @(31831,42791,42792,42793,42831)} | Select-Object LocalAddress,LocalPort,OwningProcess); @($t+$u) | ConvertTo-Json -Compress"
    status = subprocess.run(['C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], cwd=ROOT, capture_output=True, encoding='utf-8', timeout=25, creationflags=0x08000000)
    if status.returncode:
        raise RuntimeError('Archive cannot establish current UI port closure')
    listeners = json.loads(status.stdout) if status.stdout.strip() else []
    if listeners:
        raise RuntimeError('A UI/LAN test listener is still present; archive refused')
    return {'at': utc(), 'previousExactOwnedAlive': 0, 'namespaceProcesses': 0, 'fixedListeners': []}


def preflight():
    proof = package.actual_guard()
    base = package.run_root(RUN_ID)
    output = package.ordinary(package.RESULTS/'current-ui-ui-a1', package.RESULTS)
    report_body = package.stable_bytes(output/'result.json', package.RESULTS)
    probe_body = package.stable_bytes(output/'probe-result.json', package.RESULTS)
    if package.digest(report_body) != RESULT_SHA or package.digest(probe_body) != PROBE_SHA:
        raise RuntimeError('Only the exact reviewed failed ui-a1 evidence may be archived')
    report, probe = json.loads(report_body), json.loads(probe_body)
    stop = package.read_json(base/'stop-result.json')
    normal = report.get('normalStop', {})
    if report.get('purpose') != 'current-source-ui-qa' or report.get('runId') != RUN_ID or report.get('status') != 'FAIL' or report.get('passed') is not False or stop != normal:
        raise RuntimeError('Known failed UI attempt and identical normal-stop record required')
    if normal.get('required') is not True or normal.get('passed') is not True or normal.get('forcedStop') is not False or normal.get('exitCode') != 0 or normal.get('cleanSnapshots', 0) < 2 or any(normal.get(key) != [] for key in ('ownedStillAlive', 'ownedListeners', 'remainingFixedListeners')):
        raise RuntimeError('Previously verified normal stop/empty owned tree/ports required')
    known = normal.get('observedOwnedTree')
    if not isinstance(known, list) or not known or probe.get('edgeNormalExit') is not True or probe.get('cleanupErrors') != []:
        raise RuntimeError('Actual previous owned identities and Edge normal exit required')
    package_evidence = package.verify(RUN_ID)
    if package.digest(package.stable_bytes(base/'package-evidence.json')) != PACKAGE_SHA or report.get('packageEvidenceSha256') != PACKAGE_SHA:
        raise RuntimeError('Exact reviewed current UI package proof required')
    identity_record = package.read_json(ROOT/'isolation-identity.json')
    owner_file = ROOT/'config/desktop-profile/current-ui-owner.json'
    expected_owner = {'version': 1, 'purpose': 'current-source-ui-qa', 'namespace': identity_record['namespace'], 'runId': RUN_ID}
    if package.read_json(owner_file) != expected_owner:
        raise RuntimeError('Known same-run synthetic native profile owner required')
    original = package.load_module('current_ui_archive_original_driver', ROOT/'stage1/sandbox-guest-candidate-driver.py')
    original.require_synthetic_data()
    observations = [require_closed(original, known, base), require_closed(original, known, base)]
    filenames = {'result.json', 'probe-result.json', 'native-stdout.log', 'native-stderr.log', 'probe-stdout.log', 'probe-stderr.log', 'current-ui-normal-exit-stdout.log', 'current-ui-normal-exit-stderr.log'}
    for row in probe['pages']:
        name = package.safe_relative(row['screenshotFile'])
        if '/' in name or package.digest(package.stable_bytes(output/name, package.RESULTS)) != row['screenshotSha256']:
            raise RuntimeError('Known first-attempt PNG source changed')
        filenames.add(name)
    if {file.name for file in output.iterdir()} != filenames:
        raise RuntimeError('Known failed result directory has extra/missing files')
    protected = [base/'program', ROOT/'config/desktop-profile', ROOT/'data']
    operations = [
        (output, package.RESULTS/'current-ui-ui-a1-attempt01', package.RESULTS),
        (base/'scratch', base/'scratch-attempt01', ROOT),
        (base/'edge-profile', base/'edge-profile-attempt01', ROOT),
        (base/'stop-result.json', base/'stop-result-attempt01.json', ROOT),
    ]
    moves = []
    for source, destination, boundary in operations:
        package.ordinary(source, boundary)
        package.ordinary(destination, boundary, missing=True)
        assert_protected_exclusion(source, protected)
        assert_protected_exclusion(destination, protected)
        if destination.exists():
            raise RuntimeError('Archive attempt01 destination already exists; no overwrite')
        moves.append({'source': str(source), 'destination': str(destination), 'boundary': str(boundary), 'identity': identity(source, boundary), 'contents': content_tree(source, boundary), 'moved': False})
    protected_state = {'packageEvidenceSha256': PACKAGE_SHA, 'nativeOwnerSha256': package.digest(package.stable_bytes(owner_file)), 'businessFiles': [dict(path=str(ROOT/'data'/folder/name), **identity(ROOT/'data'/folder/name, ROOT)) for folder, name in [('sales', 'jewelry.sqlite'), ('ledger', 'ledger.db'), ('inventory', 'stockcheck.db')]]}
    return {'version': 1, 'purpose': 'current-ui-failed-attempt-archive', 'runId': RUN_ID, 'attempt': ATTEMPT, 'actualContext': proof, 'reviewedResultSha256': RESULT_SHA, 'reviewedProbeSha256': PROBE_SHA, 'uiPassed': False, 'deleted': False, 'programLaunched': False, 'protectedState': protected_state, 'closedObservations': observations, 'moves': moves, 'archiveCompleted': False}, original, known, base


def write_journal(file, record, *, fresh=False):
    package.ordinary(file, package.RESULTS, missing=True)
    if fresh:
        with file.open('x', encoding='utf-8') as stream:
            json.dump(record, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
        return
    temporary = file.with_name(file.name+'.tmp')
    package.ordinary(temporary, package.RESULTS, missing=True)
    with temporary.open('x', encoding='utf-8') as stream:
        json.dump(record, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
    os.replace(temporary, file)


def archive():
    record, original, known, base = preflight()
    journal = package.RESULTS/'current-ui-ui-a1-attempt01-archive.json'
    record['startedAt'] = utc()
    write_journal(journal, record, fresh=True)
    try:
        for row in record['moves']:
            source, destination, boundary = Path(row['source']), Path(row['destination']), Path(row['boundary'])
            require_closed(original, known, base)
            package.ordinary(source, boundary)
            package.ordinary(destination, boundary, missing=True)
            if destination.exists() or identity(source, boundary) != row['identity'] or content_tree(source, boundary) != row['contents']:
                raise RuntimeError('Archive source/destination changed immediately before rename')
            os.rename(source, destination)  # Same-boundary sibling rename; no copy/delete fallback.
            if identity(destination, boundary) != row['identity'] or content_tree(destination, boundary) != row['contents']:
                raise RuntimeError('Archived attempt identity/content verification failed')
            row['moved'] = True
            row['verifiedAt'] = utc()
            write_journal(journal, record)
        package.verify(RUN_ID)
        if package.digest(package.stable_bytes(ROOT/'config/desktop-profile/current-ui-owner.json')) != record['protectedState']['nativeOwnerSha256']:
            raise RuntimeError('Protected native profile owner changed')
        for row in record['protectedState']['businessFiles']:
            if identity(Path(row['path']), ROOT) != {key: value for key, value in row.items() if key != 'path'}:
                raise RuntimeError('Protected synthetic business file identity changed')
        archived = package.RESULTS/'current-ui-ui-a1-attempt01'
        if package.digest(package.stable_bytes(archived/'result.json', package.RESULTS)) != RESULT_SHA or package.digest(package.stable_bytes(archived/'probe-result.json', package.RESULTS)) != PROBE_SHA:
            raise RuntimeError('Failed first-attempt evidence changed after archive')
        record['archiveCompleted'] = True
        record['nextSameRunMayBePreflighted'] = True
    except Exception as error:
        record['error'] = str(error)
        # A partial rename keeps every object; never delete or silently undo it.
        raise
    finally:
        record['finishedAt'] = utc()
        write_journal(journal, record)
    return record


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    choice = parser.add_mutually_exclusive_group(required=True)
    choice.add_argument('--check-only', action='store_true')
    choice.add_argument('--archive', action='store_true')
    args = parser.parse_args()
    report = preflight()[0] if args.check_only else archive()
    print(json.dumps({'purpose': report['purpose'], 'runId': RUN_ID, 'attempt': ATTEMPT, 'checkOnly': args.check_only, 'archiveCompleted': report['archiveCompleted'], 'moveCount': len(report['moves']), 'uiPassed': False, 'deleted': False, 'programLaunched': False}))
