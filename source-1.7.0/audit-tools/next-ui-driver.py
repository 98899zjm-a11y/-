"""Launch only a reviewed current-source UI capsule in the actual offline Guest."""
from pathlib import Path
import argparse
import ctypes
import importlib.util
import json
import os
import subprocess
import time
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent
package = None  # Loaded from Root-pinned bytes in the explicit main entry.


def save(file, data):
    package.ordinary(file, package.RESULTS if file.is_relative_to(package.RESULTS) else ROOT, missing=True)
    temporary = file.with_name(file.name+'.tmp')
    package.ordinary(temporary, package.RESULTS if file.is_relative_to(package.RESULTS) else ROOT, missing=True)
    with temporary.open('x', encoding='utf-8') as stream:
        json.dump(data, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
    os.replace(temporary, file)


def system_json(command):
    package.actual_guard()
    result = subprocess.run(['C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); "+command], cwd=ROOT, capture_output=True, encoding='utf-8', timeout=25, creationflags=0x08000000)
    if result.returncode:
        raise RuntimeError('Owned UI system observation failed: '+result.stderr[:500])
    return json.loads(result.stdout) if result.stdout.strip() else []


def listeners():
    return package.context()[0].listeners()  # A failed observation must never report clean.


def require_closed_data_files():
    # This only probes unique OS file handles, never imports SQLite or queries DB.
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateFileW.argtypes = [ctypes.c_wchar_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p]
    kernel.CreateFileW.restype = ctypes.c_void_p
    kernel.CloseHandle.argtypes = [ctypes.c_void_p]
    for folder, filename in [('sales', 'jewelry.sqlite'), ('ledger', 'ledger.db'), ('inventory', 'stockcheck.db')]:
        file = package.ordinary(ROOT/'data'/folder/filename)
        handle = kernel.CreateFileW(str(file), 0x80000000, 0, None, 3, 0x80, None)
        if handle == ctypes.c_void_p(-1).value:
            raise RuntimeError('Synthetic database is still held; no UI launch: '+folder)
        kernel.CloseHandle(handle)


def preflight(run_id, original):
    proof = package.actual_guard()
    original.require_synthetic_data()
    if (ROOT/'runtime/host-ready.json').exists():
        raise RuntimeError('A restricted host-ready marker still exists; no UI launch')
    active = original.process_snapshot()
    for row in active:
        command = str(row.get('CommandLine') or '').lower().replace('\\', '/')
        if row.get('ProcessId') != os.getpid() and any(name in command for name in ('stage1/host.cjs', 'audit-tools/guest-run-audit.py')):
            raise RuntimeError('An audit/business runner is still active; no UI launch')
    busy = [row for row in listeners() if row.get('LocalPort') in (31831, 42791, 42792, 42793, 42831)]
    if busy:
        raise RuntimeError('UI/LAN test listener conflict; no process started')
    require_closed_data_files()
    profile = package.ordinary(ROOT/'config/desktop-profile', missing=True)
    connection = profile/'workspace-connection.json'
    network = {'mode': 'standalone', 'persisted': False, 'lanListenerPlanned': False}
    if connection.exists():
        value = package.read_json(connection)
        # Local mode never calls startLanServer, even though its dormant default
        # numeric port is 31831. Host/client modes are refused before startup.
        if value.get('version') != 1 or value.get('mode') != 'standalone':
            raise RuntimeError('Existing synthetic network configuration would enable LAN/client mode; refused before launch')
        network = {'mode': 'standalone', 'persisted': True, 'lanListenerPlanned': False}
    identity = package.read_json(ROOT/'isolation-identity.json')
    owner = {'version': 1, 'purpose': 'current-source-ui-qa', 'namespace': identity['namespace'], 'runId': run_id}
    owner_file = profile/'current-ui-owner.json'
    if not profile.exists() or not owner_file.exists() or package.read_json(owner_file) != owner:
        raise RuntimeError('Exact committed ui-a2 QA owner required; no automatic adoption')
    package.verify_handoff()
    return {'actualContext': proof, 'syntheticNamespace': identity['namespace'], 'network': network, 'profile': str(profile), 'exclusiveDatabaseProbe': True}


def run(run_id):
    evidence = package.verify(run_id)
    original = package.load_module('current_ui_existing_driver', ROOT/'stage1/sandbox-guest-candidate-driver.py')
    admission = preflight(run_id, original)
    base = package.run_root(run_id)
    output = package.ordinary(package.RESULTS/('next-ui-'+run_id), package.RESULTS, missing=True)
    if output.exists():
        raise RuntimeError('Fresh current UI result directory required')
    output.mkdir()
    scratch = base/'scratch'
    package.ordinary(scratch, missing=True).mkdir()
    env = original.guest_environment(scratch, as_node=False)
    env.pop('ELECTRON_RUN_AS_NODE', None)
    node_env = original.guest_environment(scratch, as_node=True)
    native = probe = None
    forests = []
    tracker = original.ownership_proof_module()
    result = {'version': 1, 'purpose': 'next-source-ui-qa', 'scope': 'desktop-and-mobile-navigation', 'runId': run_id, 'startedAt': datetime.now(timezone.utc).isoformat(), 'preflight': admission, 'buildReportSha256': evidence['buildReportSha256'], 'packageEvidenceSha256': package.digest(package.stable_bytes(base/'package-evidence.json')), 'status': 'NOT_RUN', 'passed': False, 'nativeProgramLaunched': False, 'serviceStarted': False, 'productionTouched': False, 'externalServiceConfigured': False, 'listenerObservations': [], 'normalStop': {'required': False, 'passed': False}, 'frozenCandidateAcceptanceReused': False}
    exe = base/'program'/ '鑫金源珠宝报价.exe'
    handles = []

    def captured(name, command, environment, cwd):
        out = (output/(name+'-stdout.log')).open('xb')
        err = (output/(name+'-stderr.log')).open('xb')
        handles.extend([out, err])
        child = subprocess.Popen(command, cwd=cwd, env=environment, stdin=subprocess.DEVNULL, stdout=out, stderr=err, creationflags=0x08000000)
        return child

    def owned_snapshot():
        snapshot = original.process_snapshot()
        history, alive_all = {}, {}
        # Native and Node probe are sibling owned roots; the existing proof is
        # intentionally single-root and must never be given disconnected roots.
        for index, known in enumerate(forests):
            expanded, alive = tracker.update_owned(known, snapshot)
            forests[index] = expanded
            for row in expanded:
                previous = history.get(row['ProcessId'])
                if previous and previous['CreationUtc'] != row['CreationUtc']:
                    raise RuntimeError('Owned UI PID reuse between observed roots')
                history[row['ProcessId']] = row
            alive_all.update({row['ProcessId']: row for row in alive})
        prefix = str(base/'program').lower()+'\\'
        unknown = [row for row in snapshot if isinstance(row.get('ExecutablePath'), str) and row['ExecutablePath'].lower().startswith(prefix) and row.get('ProcessId') not in history]
        if unknown:
            raise RuntimeError('Unattributed process remains in the unique UI program namespace; no clean ownership claim')
        return list(history.values()), list(alive_all.values())

    def observe():
        _, alive = owned_snapshot()
        ids = {row['ProcessId'] for row in alive}
        current = [row for row in listeners() if row.get('OwningProcess') in ids]
        result['listenerObservations'].append({'at': datetime.now(timezone.utc).isoformat(), 'listeners': current})
        for row in current:
            if row.get('Protocol') != 'TCP' or row.get('LocalAddress') != '127.0.0.1' or row.get('LocalPort') not in (42791, 42792, 42831):
                raise RuntimeError('Owned UI process opened an unexpected/non-loopback/LAN listener; requesting normal shutdown')
        return current, alive

    try:
        package.actual_guard()
        native = captured('native', [str(exe), '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=42791'], env, exe.parent)
        result['nativeProgramLaunched'] = True
        metadata = original.process_metadata(native.pid)
        forests.append([metadata])
        result['nativeProcess'] = metadata
        save(output/'result.json', result)
        deadline = time.monotonic()+100
        while time.monotonic() < deadline:
            current, _ = observe()
            if native.poll() is not None:
                raise RuntimeError('Current native UI exited during startup: '+str(native.returncode))
            if all(any(row['LocalPort'] == port and row['OwningProcess'] == native.pid for row in current) for port in (42791, 42831)):
                result['serviceStarted'] = True
                break
            time.sleep(.3)
        else:
            raise RuntimeError('Current UI native debugger/gateway startup timeout')
        probe = captured('probe', [str(exe), str(ROOT/'audit-tools/next-ui-probe.cjs'), run_id, str(native.pid), package._seals[0], package._seals[2], package._seals[1]], node_env, ROOT)
        probe_meta = original.process_metadata(probe.pid)
        forests.append([probe_meta])
        result['probeProcess'] = probe_meta
        deadline = time.monotonic()+300
        while probe.poll() is None and time.monotonic() < deadline:
            observe()
            time.sleep(.5)
        if probe.poll() is None:
            raise RuntimeError('UI probe exceeded its observation budget; no forced stop issued')
        result['probeExitCode'] = probe.returncode
        probe_result = package.read_json(output/'probe-result.json', package.RESULTS)
        result['probe'] = probe_result
        result['passed'] = probe.returncode == 0 and probe_result.get('passed') is True
        result['status'] = 'PASS' if result['passed'] else 'FAIL'
    except Exception as error:
        result['error'] = str(error)
        result['status'] = 'FAIL'
        result['passed'] = False
    finally:
        stop = {'required': native is not None, 'passed': False, 'forcedStop': False}
        try:
            if native is not None:
                if native.poll() is None:
                    package.actual_guard()
                    if not result.get('nativeProcess'):
                        raise RuntimeError('Exact native PID/creation proof unavailable; no shutdown action issued')
                    close_record = original.run_owned_process('current-ui-normal-exit', exe, [str(ROOT/'stage1/guest-candidate-cdp.cjs'), str(native.pid)], node_env, output, timeout=45, allow_force_stop=False)
                    stop['nativeExitRequest'] = close_record
                    if close_record.get('process', {}).get('actualCim'):
                        forests.append([close_record['process']['actualCim']])
                    if close_record['exitCode'] != 0 or close_record.get('timedOut'):
                        raise RuntimeError('Current UI normal exitHost request failed')
                deadline = time.monotonic()+70
                clean = 0
                while time.monotonic() < deadline:
                    observed, alive = owned_snapshot()
                    current = [row for row in listeners() if row.get('OwningProcess') in {p['ProcessId'] for p in alive}]
                    if not alive and native.poll() is not None:
                        clean += 1
                    else:
                        clean = 0
                    if clean >= 2:
                        break
                    time.sleep(.5)
                remaining_fixed = [row for row in listeners() if row.get('LocalPort') in (42791, 42792, 42831)]
                stop.update({'exitCode': native.poll(), 'cleanSnapshots': clean, 'ownedStillAlive': alive, 'ownedListeners': current, 'remainingFixedListeners': remaining_fixed, 'observedOwnedTree': observed})
                stop['passed'] = native.returncode == 0 and clean >= 2 and not alive and not current and not remaining_fixed
                if not stop['passed']:
                    raise RuntimeError('Current UI owned descendants did not exit normally')
        except Exception as error:
            stop['error'] = str(error)
        if not stop['passed']:
            result['passed'] = False
            result['status'] = 'FAIL'
        result['normalStop'] = stop
        result['finishedAt'] = datetime.now(timezone.utc).isoformat()
        for handle in handles:
            handle.close()
        save(output/'result.json', result)
        save(base/'stop-result.json', stop)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--contract-sha256', required=True)
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
    record = run('ui-a2')
    print(json.dumps({'purpose': record['purpose'], 'status': record['status'], 'passed': record['passed']}))
    raise SystemExit(0 if record['passed'] else 1)
