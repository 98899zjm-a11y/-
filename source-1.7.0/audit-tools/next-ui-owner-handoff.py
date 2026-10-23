"""Guest QA marker preflight/CAS. No product launch, DB access or profile scan.

Source only until Root separately reviews real contract/materials/package SHA.
The runtime evidence below is independently read, never accepted from a caller.
"""
from pathlib import Path
import argparse
import base64
import ctypes
import hashlib
import json
import os
import time
import types
import uuid

ROOT = Path(__file__).resolve().parent.parent
HISTORY = [
 ('current-ui-ui-a1-attempt01', '0d4d49a97d524c3f5bafba96d543ed1afb03a025cfdca44027b252c08a7d4eca', '2cf0979167e138f9380e0f83664f4204fb326f4e743e1c88732b233e14456983', 'stop-result-attempt01.json'),
 ('current-ui-ui-a1', '8782ea33537a8228e1fb6c2b3e6ecc6fa1a465e5dedb7300731f99de770a96d0', 'de7d8aabbd622f268e580f90c13ff1d052ed4523dd32fa4879e982954ca3ba2e', 'stop-result.json'),
]


def load_package(materials_sha):
    if os.name != 'nt' or os.path.normcase(str(ROOT)) != os.path.normcase('C:/xjy-work/xjy-web-stage1'):
        raise RuntimeError('Actual fixed Guest required before QA handoff')
    raw = (ROOT/'audit-tools/next-ui-materials.json').read_bytes()
    if hashlib.sha256(raw).hexdigest() != materials_sha:
        raise RuntimeError('Root-reviewed materials required before helper import')
    pins = json.loads(raw).get('harnessPins') or {}
    filename = ROOT/'audit-tools/next-ui-package.py'
    data = filename.read_bytes()
    if hashlib.sha256(data).hexdigest() != pins.get('audit-tools/next-ui-package.py'):
        raise RuntimeError('Root-reviewed next packager bytes required')
    package = types.ModuleType('next_ui_handoff_package')
    package.__file__ = str(filename)
    exec(compile(data, str(filename), 'exec'), package.__dict__)
    return package


def historical(common, contract):
    known = {}
    for folder, result_sha, probe_sha, stop_name in HISTORY:
        report = common.sealed(common.RESULTS/folder/'result.json', result_sha, common.RESULTS)
        probe = common.sealed(common.RESULTS/folder/'probe-result.json', probe_sha, common.RESULTS)
        stop = report.get('normalStop', {})
        actual_stop = common.read_json(ROOT/'runtime/current-ui-ui-a1'/stop_name)
        if (report.get('purpose') != 'current-source-ui-qa' or report.get('runId') != 'ui-a1'
                or report.get('packageEvidenceSha256') != contract['oldPackageSha256']
                or stop != actual_stop or stop.get('passed') is not True or stop.get('forcedStop') is not False
                or stop.get('exitCode') != 0 or stop.get('cleanSnapshots', 0) < 2
                or any(stop.get(k) != [] for k in ('ownedStillAlive', 'ownedListeners', 'remainingFixedListeners'))
                or probe.get('edgeNormalExit') is not True or probe.get('cleanupErrors') != []):
            raise RuntimeError('Both exact previous normal stops/proofs required')
        for row in stop.get('observedOwnedTree', []):
            key = row.get('ProcessId'), row.get('CreationUtc')
            known[key] = row
    if not known:
        raise RuntimeError('Historical process identities unavailable')
    return list(known.values())


def observe(common, original, known, profile_identity):
    common.actual_guard()
    rows = original.process_snapshot()
    for previous in known:
        current = next((r for r in rows if r.get('ProcessId') == previous.get('ProcessId')), None)
        if current and current.get('CreationUtc') != previous.get('CreationUtc'):
            raise RuntimeError('Historical PID reused; independent review required, no ownership guess')
    by_pid = {}
    for row in known:
        pid = row.get('ProcessId')
        if pid in by_pid and by_pid[pid].get('CreationUtc') != row.get('CreationUtc'):
            raise RuntimeError('Historical ownership contains reused PIDs; review required')
        by_pid[pid] = row
    tracker = common.load_module('next_ui_owned_forest', ROOT/'stage1/guest-owned-process-proof.py')
    expanded, alive = {}, {}
    for root in [row for row in by_pid.values() if row.get('ParentProcessId') not in by_pid]:
        ids = {root['ProcessId']}
        while True:
            children = {row['ProcessId'] for row in by_pid.values() if row.get('ParentProcessId') in ids}
            if children <= ids:
                break
            ids |= children
        forest = [root]+[row for row in by_pid.values() if row['ProcessId'] in ids and row['ProcessId'] != root['ProcessId']]
        history, living = tracker.update_owned(forest, rows)
        expanded.update({row['ProcessId']: row for row in history})
        alive.update({row['ProcessId']: row for row in living})
    if set(by_pid)-set(expanded):
        raise RuntimeError('Historical owned forest is disconnected or cyclic')
    known[:] = list(expanded.values())  # Keep newly observed descendants for the next snapshot.
    normalize = lambda value: str(value or '').lower().replace('\\', '/')
    old, new = normalize(ROOT/'runtime/current-ui-ui-a1'), normalize(common.BASE)
    profile = normalize(common.PROFILE)
    alive = list(alive.values())
    namespace = [r for r in rows if any(normalize(r.get('ExecutablePath')).startswith(p+'/program/') for p in (old, new))]
    namespace += [r for r in rows if r.get('Name') in ('鑫金源珠宝报价.exe', 'electron.exe', 'msedge.exe') and not r.get('ExecutablePath')]
    profile_rows = [r for r in rows if any(p in normalize(r.get('CommandLine')) for p in (profile, old+'/edge-profile', new+'/edge-profile', normalize(ROOT/'后台运行/打印缓存')))]
    runners = [r for r in rows if r.get('ProcessId') != os.getpid() and normalize(ROOT)+'/' in normalize(r.get('CommandLine')) and any(p in normalize(r.get('CommandLine')) for p in ('/audit-tools/', '/stage1/host.cjs', '/stage1/run-restricted.py'))]
    endpoints = common.listeners()
    related = {r['ProcessId'] for r in alive+namespace+profile_rows+runners}
    endpoints = [r for r in endpoints if r.get('LocalPort') in (31831, 42791, 42792, 42793, 42831) or r.get('OwningProcess') in related]
    current_profile = common.ordinary(common.PROFILE).stat()
    if (current_profile.st_dev, current_profile.st_ino) != profile_identity:
        raise RuntimeError('Native QA profile object changed')
    if alive or namespace or profile_rows or runners or endpoints:
        raise RuntimeError('Current QA processes/listeners are not clean; no owner write')
    return {'fresh': True, 'observedAtNs': time.time_ns(), 'knownOwnedAlive': alive, 'namespaceProcesses': namespace,
            'profileProcesses': profile_rows, 'activeQaRunners': runners, 'listeners': endpoints}


def save_journal(common, record, fresh=False):
    file = common.JOURNAL_ROOT/'journal.json'
    body = (json.dumps(record, ensure_ascii=True, indent=2)+'\n').encode()
    if fresh:
        common.put(file, body)
        return
    previous = common.stable_bytes(file)
    history = common.JOURNAL_ROOT/('journal-history-'+common.digest(previous)+'.json')
    if history.exists():
        if common.stable_bytes(history) != previous:
            raise RuntimeError('Journal history changed')
    else:
        common.put(history, previous)
    temporary = common.JOURNAL_ROOT/('journal-next-'+str(uuid.uuid4())+'.json')
    common.put(temporary, body)
    common.ordinary(file)
    os.replace(temporary, file)
    if common.stable_bytes(file) != body:
        raise RuntimeError('Journal commit byte mismatch')


def handoff(args):
    package = load_package(args.materials_sha256)
    package.configure(args.contract_sha256, args.materials_sha256, args.package_evidence_sha256)
    common, proof, contract, material, build, policy = package.context()
    package.verify('ui-a2')
    common.verify_old_program()  # Its own tree; never old inputs()/verify().
    known = historical(common, contract)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_bool, ctypes.c_wchar_p]
    kernel.CreateMutexW.restype = ctypes.c_void_p
    ctypes.set_last_error(0)
    handle = kernel.CreateMutexW(None, True, 'Local\\XJY-QA-ui-a1-ui-a2-'+contract['namespace'])
    if not handle or ctypes.get_last_error() == 183:
        if handle:
            kernel.CloseHandle(ctypes.c_void_p(handle))
        raise RuntimeError('Another QA owner coordinator is active')
    try:
        profile = common.ordinary(common.PROFILE).stat()
        profile_identity = profile.st_dev, profile.st_ino
        journal_path = common.JOURNAL_ROOT/'journal.json'
        journal = common.read_json(journal_path) if journal_path.exists() else None
        if journal is not None and (journal.get('purpose') != 'next-ui-owner-handoff' or journal.get('contractSha256') != args.contract_sha256 or journal.get('materialsSha256') != args.materials_sha256 or journal.get('packageEvidenceSha256') != args.package_evidence_sha256):
            raise RuntimeError('Existing handoff journal belongs to different inputs')
        owner_body = common.stable_bytes(common.OWNER)
        owner_identity = common.identity(common.ordinary(common.OWNER).stat())
        original_body = common.stable_bytes(common.JOURNAL_ROOT/'old-owner.json') if journal else owner_body
        if common.digest(original_body) != contract['oldOwnerSha256']:
            raise RuntimeError('Only the precise known old QA owner can be handed off')
        if set(common.BASE.iterdir()) != {common.PROGRAM, common.BASE/'package-evidence.json'} or common.OUTPUT.exists():
            raise RuntimeError('New capsule already has run artifacts; no marker adoption')
        observations = [observe(common, common.original(), known, profile_identity)]
        time.sleep(.3)
        observations.append(observe(common, common.original(), known, profile_identity))
        transaction = journal['transactionId'] if journal else str(uuid.uuid4())
        evidence = {'actualContext': proof, 'namespace': common.read_json(ROOT/'isolation-identity.json')['namespace'],
                    'transactionId': transaction, 'owner': json.loads(original_body), 'ownerSha256': common.digest(original_body),
                    'ownerOrdinary': True, 'profileIdentityStable': True, 'oldPackageSha256': contract['oldPackageSha256'],
                    'oldProgramTreeVerified': True, 'oldHistoricalStopsVerified': 2,
                    'newProgramTreeSha256': contract['build']['newProgramTreeSha256'], 'newProgramReady': True,
                    'newProgramExecuted': False, 'currentObservations': observations, 'exclusiveRootWindow': True}
        plan = policy.plan_owner_handoff(contract, evidence)
        new_body = (json.dumps(plan['newOwner'], indent=2)+'\n').encode()
        new_sha = common.digest(new_body)
        action = policy.owner_cas_action(journal['phase'] if journal else 'prepared', common.digest(owner_body), contract['oldOwnerSha256'], new_sha)
        if not args.commit_reviewed_handoff:
            return {'preflightOnly': True, 'action': action, 'plan': plan, 'observations': observations, 'ownerChanged': False}
        common.actual_guard()
        if journal is None:
            common.ordinary(common.JOURNAL_ROOT, missing=True).mkdir(exist_ok=False)
            common.put(common.JOURNAL_ROOT/'old-owner.json', original_body)
            common.put(common.JOURNAL_ROOT/'new-owner.json', new_body)
            journal = {'version': 1, 'purpose': 'next-ui-owner-handoff', 'phase': 'prepared', 'transactionId': transaction,
                       'contractSha256': args.contract_sha256, 'materialsSha256': args.materials_sha256,
                       'packageEvidenceSha256': args.package_evidence_sha256, 'oldOwnerSha256': contract['oldOwnerSha256'],
                       'newOwnerSha256': new_sha, 'profileIdentity': list(profile_identity), 'plan': plan, 'observations': observations}
            save_journal(common, journal, fresh=True)
        if journal.get('newOwnerSha256') != new_sha or journal.get('profileIdentity') != list(profile_identity) or journal.get('plan') != plan:
            raise RuntimeError('Journal target/physical profile changed')
        if common.stable_bytes(common.JOURNAL_ROOT/'new-owner.json') != new_body:
            raise RuntimeError('Saved exact new owner bytes changed')
        if action != 'write-new' and journal.get('newOwnerIdentity') is not None and journal['newOwnerIdentity'] != list(owner_identity):
            raise RuntimeError('Committed owner physical object changed')
        if action == 'write-new':
            temporary = Path(plan['temporaryOwnerPath'])
            common.put(temporary, new_body)
            observe(common, common.original(), known, profile_identity)
            if common.stable_bytes(common.OWNER) != owner_body or common.digest(owner_body) != contract['oldOwnerSha256'] or common.identity(common.ordinary(common.OWNER).stat()) != owner_identity:
                raise RuntimeError('Old owner changed immediately before CAS')
            os.replace(temporary, common.OWNER)
            if common.stable_bytes(common.OWNER) != new_body:
                raise RuntimeError('New owner write verification failed')
            journal['phase'] = 'owner-written'
            journal['newOwnerIdentity'] = list(common.identity(common.ordinary(common.OWNER).stat()))
            save_journal(common, journal)
        if common.stable_bytes(common.OWNER) != new_body:
            raise RuntimeError('Live owner is not the exact new marker')
        journal['phase'] = 'committed'
        journal['newOwnerIdentity'] = list(common.identity(common.ordinary(common.OWNER).stat()))
        save_journal(common, journal)
        return {'committed': True, 'newOwnerSha256': new_sha, 'journalSha256': common.digest(common.stable_bytes(journal_path)),
                'programLaunched': False, 'profileOtherContentsRead': False}
    finally:
        kernel.ReleaseMutex(ctypes.c_void_p(handle))
        kernel.CloseHandle(ctypes.c_void_p(handle))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--preflight-only', action='store_true')
    group.add_argument('--commit-reviewed-handoff', action='store_true')
    parser.add_argument('--exclusive-root-window', action='store_true', required=True)
    parser.add_argument('--contract-sha256', required=True)
    parser.add_argument('--materials-sha256', required=True)
    parser.add_argument('--package-evidence-sha256', required=True)
    print(json.dumps(handoff(parser.parse_args()), ensure_ascii=True))
