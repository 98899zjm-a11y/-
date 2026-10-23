"""Reviewed Guest-only memory probe driver. No business imports, DB files, pyc or forced stops."""
from pathlib import Path
import argparse
import base64
import hashlib
import importlib.util
import json
import os
import re
import stat
import subprocess
import time
from datetime import datetime, timezone

ROOT = Path('C:/xjy-work/xjy-web-stage1')
INPUT = Path('C:/xjy-input/electron-4472-capability-a1')
BASE = ROOT/'runtime/electron-4472-capability-a1'
RESULTS = Path('C:/xjy-results/electron-4472-capability-a1')
POWERSHELL = 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'
PURPOSE = 'electron-4472-memory-capability-only'
EXE_SHA = '1f41127064012c5e74422b2e0dfc35ff0b0fe8d7908b97d01503becd1b7fa9e1'
INPUT_SEAL = '590049ad903dfb340716d910d9f4b3958b3d793d61a3455e853b8cf789d5f7cb'
SUPPORT = {'tools/electron-4472-guest.py', 'tools/electron-4472-probe.cjs',
           'support/sandbox-context.py', 'support/guest-owned-process-proof.py',
           'evidence/electron-4472-manifest.json', 'evidence/probe-contract.json'}


def now():
    return datetime.now(timezone.utc).isoformat()


def ordinary(file, boundary, missing=False):
    if not file.is_relative_to(boundary):
        raise RuntimeError('Guest capsule boundary escaped')
    for part in (file, *file.parents):
        try:
            s = part.lstat()
        except FileNotFoundError:
            if missing:
                continue
            raise
        if stat.S_ISLNK(s.st_mode) or getattr(s, 'st_file_attributes', 0) & 0x400:
            raise RuntimeError('Guest capsule reparse path refused')
        if stat.S_ISREG(s.st_mode) and s.st_nlink != 1:
            raise RuntimeError('Guest capsule hardlink refused')
    return file


def stamp(s):
    return s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns, s.st_nlink


def same_open_file(before, opened):
    # Compare shared identity fields across APIs; keep each ctime baseline below.
    shared = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_nlink)
    birth = (getattr(before, 'st_birthtime_ns', None), getattr(opened, 'st_birthtime_ns', None))
    return shared(before) == shared(opened) and (None in birth or birth[0] == birth[1])


def checked(file, spec, boundary, target=None):
    before = ordinary(file, boundary).stat()
    if not file.is_file() or before.st_size != spec['size']:
        raise RuntimeError('Guest input type/size drift')
    digest = hashlib.sha256()
    with file.open('rb') as incoming:
        opened = os.fstat(incoming.fileno())
        if not same_open_file(before, opened):
            raise RuntimeError('Guest input changed before open')
        outgoing = None
        try:
            if target is not None:
                ordinary(target, BASE, missing=True)
                target.parent.mkdir(parents=True, exist_ok=True)
                ordinary(target.parent, BASE)
                outgoing = target.open('xb')
            while block := incoming.read(1024*1024):
                digest.update(block)
                if outgoing:
                    outgoing.write(block)
            if outgoing:
                outgoing.flush()
                os.fsync(outgoing.fileno())
        finally:
            if outgoing:
                outgoing.close()
        if stamp(os.fstat(incoming.fileno())) != stamp(opened) or stamp(ordinary(file, boundary).stat()) != stamp(before):
            raise RuntimeError('Guest input changed during read')
    if digest.hexdigest() != spec['sha256']:
        raise RuntimeError('Guest input SHA drift')


def read_json(file, boundary):
    return json.loads(ordinary(file, boundary).read_text('utf-8'))


def write_new(file, data, boundary):
    ordinary(file, boundary, missing=True)
    ordinary(file.parent, boundary)
    with file.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(data, stream, ensure_ascii=True, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())


def load_module(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_capsule(seal):
    if os.path.normcase(str(Path(__file__).absolute())) != os.path.normcase(str(INPUT/'tools/electron-4472-guest.py')):
        raise RuntimeError('Only the fixed reviewed read-only capsule driver entry is accepted')
    if not re.fullmatch('[0-9a-f]{64}', seal):
        raise RuntimeError('Explicit Root-reviewed capsule SHA required')
    file = ordinary(INPUT/'capsule-manifest.json', INPUT)
    data = file.read_bytes()
    if hashlib.sha256(data).hexdigest() != seal:
        raise RuntimeError('Guest capsule seal mismatch')
    m = json.loads(data)
    if (m.get('version') != 1 or m.get('purpose') != PURPOSE or m.get('runId') != 'a1'
            or m.get('engineVersion') != '44.7.2' or m.get('engineExecutableSha256') != EXE_SHA
            or m.get('officialInputManifestSha256') != INPUT_SEAL
            or m.get('engineExecuted') is not False or m.get('productionDeploymentAuthorized') is not False
            or m.get('independentArtifactSignatureVerified') is not False or m.get('electronAuthenticode') != 'NotSigned'
            or m.get('vendorDemoAsarIncluded') is not False or m.get('businessResourcesIncluded') is not False):
        raise RuntimeError('Guest capsule purpose/source boundaries invalid')
    rows = m.get('files', [])
    names = [r.get('path', '') for r in rows]
    if len(rows) != 78 or len(set(n.casefold() for n in names)) != 78:
        raise RuntimeError('Exact capsule file count required')
    for row in rows:
        name = row['path']
        if (set(row) != {'path', 'size', 'sha256'} or '\\' in name or ':' in name
                or any(p in ('', '.', '..') or p.rstrip(' .') != p for p in name.split('/'))
                or type(row['size']) is not int or not 0 <= row['size'] <= 512*1024*1024
                or not re.fullmatch('[0-9a-f]{64}', str(row['sha256']))):
            raise RuntimeError('Guest capsule row rejected')
        if name not in SUPPORT and not name.startswith('engine/'):
            raise RuntimeError('Guest capsule extra non-engine source')
    if {n for n in names if not n.startswith('engine/')} != SUPPORT:
        raise RuntimeError('Exact reviewed probe/support inventory required')
    engine = [r for r in rows if r['path'].startswith('engine/')]
    if len(engine) != 72 or sum(r['size'] for r in engine) != 384691764:
        raise RuntimeError('Exact official engine count/bytes required')
    source = read_json(INPUT/'evidence/electron-4472-manifest.json', INPUT)
    expected = {'engine/'+r['path']: (r['size'], r['sha256']) for r in source['files'] if r['path'] != 'resources/default_app.asar'}
    if {r['path']: (r['size'], r['sha256']) for r in engine} != expected:
        raise RuntimeError('Engine inventory differs from pinned official input')
    for row in rows:
        if row['path'] in SUPPORT:
            checked(INPUT/row['path'], row, INPUT)
    if hashlib.sha256((INPUT/'evidence/electron-4472-manifest.json').read_bytes()).hexdigest() != m['officialInputManifestSha256']:
        raise RuntimeError('Official input evidence seal mismatch')
    expected_files = set(names) | {'capsule-manifest.json'}
    actual_files = set()
    for folder, dirs, files in os.walk(INPUT, followlinks=False):
        for name in dirs+files:
            ordinary(Path(folder)/name, INPUT)
        actual_files.update((Path(folder)/name).relative_to(INPUT).as_posix() for name in files)
    if actual_files != expected_files:
        raise RuntimeError('Capsule contains an extra/missing file')
    return m


def actual(m):
    # Helper bytes were checked against the externally supplied capsule seal first.
    context = load_module('electron4472_actual_guest', INPUT/'support/sandbox-context.py')
    return context.read_context(ROOT)


def system_json(m, script):
    actual(m)
    prefix = "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); "
    encoded = base64.b64encode((prefix+script).encode('utf-16le')).decode('ascii')
    result = subprocess.run([POWERSHELL, '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
                            cwd=ROOT, capture_output=True, encoding='utf-8', timeout=25, creationflags=0x08000000)
    if result.returncode:
        raise RuntimeError('Guest read-only system observation failed: '+result.stderr[:300])
    return json.loads(result.stdout) if result.stdout.strip() else []


def snapshot(m):
    rows = system_json(m, "@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine,@{n='CreationUtc';e={if($_.CreationDate){$_.CreationDate.ToUniversalTime().ToString('o')}}}) | ConvertTo-Json -Compress")
    if not isinstance(rows, list):
        raise RuntimeError('Guest process snapshot must be an array')
    return rows


def listeners(m):
    rows = system_json(m, "$tcp=@(Get-NetTCPConnection -ErrorAction Stop | Where-Object State -eq Listen | Select-Object @{n='Protocol';e={'TCP'}},LocalAddress,LocalPort,OwningProcess); $udp=@(Get-NetUDPEndpoint -ErrorAction Stop | Select-Object @{n='Protocol';e={'UDP'}},LocalAddress,LocalPort,OwningProcess); @($tcp+$udp) | ConvertTo-Json -Compress")
    return rows if isinstance(rows, list) else [rows]


def policy(m):
    rows = system_json(m, "@(Get-ExecutionPolicy -List | ForEach-Object {[pscustomobject]@{scope=$_.Scope.ToString();policy=$_.ExecutionPolicy.ToString()}}) | ConvertTo-Json -Compress")
    if {r['scope'] for r in rows} != {'MachinePolicy', 'UserPolicy', 'Process', 'CurrentUser', 'LocalMachine'} or any(r['policy'] != 'Undefined' for r in rows):
        raise RuntimeError('Guest execution policy differs; no policy changes are allowed')
    return rows


def owner(m, seal):
    identity = read_json(ROOT/'isolation-identity.json', ROOT)
    return {'version': 1, 'purpose': PURPOSE, 'runId': 'a1', 'namespace': identity['namespace'], 'capsuleSha256': seal}


def stage(seal):
    m = load_capsule(seal)
    proof = actual(m)  # MUST precede every Guest mutation.
    policy(m)
    for row in m['files']:
        checked(INPUT/row['path'], row, INPUT)
    ordinary(BASE, ROOT, missing=True).mkdir(parents=True, exist_ok=False)
    ordinary(RESULTS, Path('C:/xjy-results'), missing=True).mkdir(exist_ok=False)
    record = owner(m, seal)
    write_new(BASE/'owner.json', record, BASE)
    write_new(RESULTS/'owner.json', record, RESULTS)
    for row in m['files']:
        if row['path'].startswith('engine/'):
            checked(INPUT/row['path'], row, INPUT, BASE/row['path'])
            checked(BASE/row['path'], row, BASE)
    for folder in ['control', 'scratch']:
        ordinary(BASE/folder, BASE, missing=True).mkdir()
    result = {'stage': 'data-copy-only', 'at': now(), 'actualContext': proof, 'owner': record,
              'engineFileCount': 72, 'engineBytes': 384691764, 'engineExecuted': False,
              'electronAuthenticode': 'NotSigned', 'independentArtifactSignatureVerified': False}
    write_new(RESULTS/'stage-result.json', result, RESULTS)
    return result


def normal_complete(cim_observed, code, clean, alive, endpoints):
    return cim_observed and code == 0 and clean >= 2 and not alive and not endpoints


def verify_staged_engine(m):
    expected = {r['path'] for r in m['files'] if r['path'].startswith('engine/')}
    observed = set()
    for folder, dirs, files in os.walk(ordinary(BASE/'engine', BASE), followlinks=False):
        for name in dirs+files:
            ordinary(Path(folder)/name, BASE)
        observed.update((Path(folder)/name).relative_to(BASE).as_posix() for name in files)
    if observed != expected:
        raise RuntimeError('Staged new-engine tree contains extra/missing files')
    for row in m['files']:
        if row['path'] in expected:
            checked(BASE/row['path'], row, BASE)


def run(seal):
    m = load_capsule(seal)
    proof = actual(m)  # MUST precede output mutation, process launch, and SQLite.
    policy_rows = policy(m)
    expected_owner = owner(m, seal)
    if read_json(BASE/'owner.json', BASE) != expected_owner or read_json(RESULTS/'owner.json', RESULTS) != expected_owner:
        raise RuntimeError('New engine namespace owner mismatch; preserve existing files')
    verify_staged_engine(m)
    active = snapshot(m)
    prefix = str(ROOT).lower()+'\\'
    if any(str(r.get('ExecutablePath') or '').lower().startswith(prefix) for r in active):
        raise RuntimeError('Another Guest work-root executable is active; no engine launched')
    if any(r.get('LocalPort') in (31831, 42791, 42792, 42793, 42831) for r in listeners(m)):
        raise RuntimeError('Guest business/UI listener conflict; no engine launched')
    for name in ['run-result.json', 'probe.stdout.log', 'probe.stderr.log']:
        if (RESULTS/name).exists():
            raise RuntimeError('Fresh probe result names required; no rerun over prior evidence')
    if any((BASE/'control').iterdir()) or any((BASE/'scratch').iterdir()):
        raise RuntimeError('Fresh owned probe control/scratch required')
    exe = BASE/'engine/electron.exe'
    script = INPUT/'tools/electron-4472-probe.cjs'
    env = {'SystemRoot': 'C:\\Windows', 'WINDIR': 'C:\\Windows', 'PATH': 'C:\\Windows\\System32',
           'TEMP': str(BASE/'scratch'), 'TMP': str(BASE/'scratch'), 'ELECTRON_RUN_AS_NODE': '1'}
    report = {'version': 1, 'purpose': PURPOSE, 'startedAt': now(), 'actualContext': proof,
              'owner': expected_owner, 'executionPolicy': policy_rows, 'engineExecuted': False, 'passed': False,
              'businessLoaded': False, 'databaseFilesOpened': False, 'backupExercised': False,
              'sourcePolicyCapabilitiesEligible': False, 'productionDeploymentAuthorized': False}
    child = None
    known = []
    tracker = load_module('electron4472_owned_process', INPUT/'support/guest-owned-process-proof.py')
    with (RESULTS/'probe.stdout.log').open('xb') as out, (RESULTS/'probe.stderr.log').open('xb') as err:
        try:
            actual(m)
            child = subprocess.Popen([str(exe), str(script), seal], cwd=ROOT, env=env, stdin=subprocess.DEVNULL,
                                     stdout=out, stderr=err, creationflags=0x08000000)
            report['engineExecuted'] = True
            rows = snapshot(m)
            meta = next((r for r in rows if r.get('ProcessId') == child.pid), None)
            if (not meta or meta.get('ParentProcessId') != os.getpid()
                    or os.path.normcase(meta.get('ExecutablePath', '')) != os.path.normcase(str(exe))
                    or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z', meta.get('CreationUtc', ''))):
                raise RuntimeError('Exact new-engine CIM ownership was not captured; no admission')
            known = [meta]
            report['process'] = meta
            write_new(BASE/'control/admitted.json', {'version': 1, 'purpose': PURPOSE, 'pid': child.pid,
                      'driverPid': os.getpid(), 'creationUtc': meta['CreationUtc'], 'capsuleSha256': seal}, BASE)
            deadline = time.monotonic()+75
            while child.poll() is None and time.monotonic() < deadline:
                known, alive = tracker.update_owned(known, snapshot(m))
                endpoints = [r for r in listeners(m) if r.get('OwningProcess') in {p['ProcessId'] for p in alive}]
                if endpoints:
                    raise RuntimeError('Memory capability probe opened a listener; requesting natural stop')
                time.sleep(.15)
            if child.poll() is None:
                report['timedOut'] = True
                raise RuntimeError('Probe time budget exceeded; no forced termination')
            out.flush()
            probe = read_json(RESULTS/'probe.stdout.log', RESULTS)
            report['probe'] = probe
            report['passed'] = child.returncode == 0 and probe.get('passed') is True and probe.get('databaseFilesOpened') is False and probe.get('sourcePolicyCapabilitiesEligible') is False
        except Exception as error:
            report['error'] = str(error)
            report['passed'] = False
        finally:
            stop = {'forcedStop': False, 'cimObserved': bool(known), 'cleanSnapshots': 0, 'passed': False}
            try:
                if child is not None and child.poll() is None:
                    write_new(BASE/'control/stop-request.json', {'purpose': PURPOSE, 'pid': child.pid}, BASE)
                deadline = time.monotonic()+20
                alive, endpoints = [], []
                while child is not None and time.monotonic() < deadline:
                    rows = snapshot(m)
                    if known:
                        known, alive = tracker.update_owned(known, rows)
                    else:
                        alive = [r for r in rows if r.get('ProcessId') == child.pid]
                    unknown = [r for r in rows if str(r.get('ExecutablePath') or '').lower().startswith(str(BASE).lower()+'\\') and r.get('ProcessId') not in {p['ProcessId'] for p in known}]
                    if unknown:
                        raise RuntimeError('Unattributed process in unique engine namespace; cannot claim clean stop')
                    endpoints = [r for r in listeners(m) if r.get('OwningProcess') in {p['ProcessId'] for p in known}]
                    stop['cleanSnapshots'] = stop['cleanSnapshots']+1 if child.poll() is not None and not alive and not endpoints else 0
                    if stop['cleanSnapshots'] >= 2:
                        break
                    time.sleep(.3)
                stop.update({'exitCode': child.poll() if child is not None else None, 'ownedStillAlive': alive,
                             'ownedListeners': endpoints, 'observedOwnedTree': known})
                stop['passed'] = normal_complete(bool(known), stop['exitCode'], stop['cleanSnapshots'], alive, endpoints)
            except Exception as error:
                stop['error'] = str(error)
            report['normalStop'] = stop
            report['passed'] = report['passed'] and stop['passed']
            report['finishedAt'] = now()
            write_new(RESULTS/'run-result.json', report, RESULTS)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('operation', choices=['stage', 'run', 'context'])
    parser.add_argument('--manifest-sha256', required=True)
    parser.add_argument('--execute-reviewed-probe', action='store_true')
    args = parser.parse_args(argv)
    if args.operation == 'run' and not args.execute_reviewed_probe:
        parser.error('run requires Root review and --execute-reviewed-probe')
    if args.operation == 'context':
        result = actual(load_capsule(args.manifest_sha256))
    else:
        result = stage(args.manifest_sha256) if args.operation == 'stage' else run(args.manifest_sha256)
    print(json.dumps(result, ensure_ascii=True))
    return 0 if args.operation != 'run' or result['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
