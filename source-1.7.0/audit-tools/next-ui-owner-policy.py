"""Pure QA policy. Root confirmed the preceding unimplemented-contract RED.

No filesystem, subprocess, product or actual-context admission occurs here.
Runtime wrappers must collect facts independently; passing a model is not Guest proof.
"""
from copy import deepcopy
import re

ROOT = 'C:/xjy-work/xjy-web-stage1'
NAMESPACE = '36fcbe9c-ece1-4be3-af35-309a2ee19e05'
OLD_OWNER = 'f852f2f2c97f74d1715a31ebf2eb5a9e79d1086ed5eed5ab536eaee5e63b5e90'
OLD_PACKAGE = 'abec0248806c1881ff2057786b594f2528509b8d01b21fa7a1185fe792cb3248'
OLD_BUILD = 'db1df96cd391d3994b020cd41ed57df54a294d814130a41939820a232071bf6d'
ENGINE = {'version': '44.7.0', 'fileCount': 72, 'totalBytes': 385404497,
          'manifestSha256': '6893a279e6ab2ccaae36c9c66fd8c840ef4dacddc9cd9c78c24f87dd3f311ea4',
          'executableSha256': 'db3ad2066a55546f9b6737da3c7f011370e4856fb36888055b544d45653e4f40'}


class PolicyError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise PolicyError(message)


def sha(value):
    return isinstance(value, str) and re.fullmatch('[0-9a-f]{64}', value) is not None


def validate_contract(contract):
    """Return a validated copy; reject unsealed build4, wrong engine or paths."""
    require(isinstance(contract, dict), 'Explicit QA contract required')
    c = contract
    fixed = {'version': 1, 'purpose': 'next-source-ui-qa', 'state': 'ROOT_REVIEWED_BUILD4',
             'runId': 'ui-a2', 'oldRunId': 'ui-a1', 'namespace': NAMESPACE,
             'guestRoot': ROOT, 'profilePath': ROOT+'/config/desktop-profile',
             'ownerPath': ROOT+'/config/desktop-profile/current-ui-owner.json',
             'oldProgram': ROOT+'/runtime/current-ui-ui-a1/program',
             'newProgram': ROOT+'/runtime/next-ui-ui-a2/program',
             'newResults': 'C:/xjy-results/next-ui-ui-a2',
             'oldOwnerSha256': OLD_OWNER, 'oldPackageSha256': OLD_PACKAGE,
             'oldBuildReportSha256': OLD_BUILD}
    require(all(type(c.get(k)) is type(v) and c[k] == v for k, v in fixed.items()), 'Fixed reviewed ui-a1 to ui-a2 contract required')
    require(c.get('engine') == ENGINE, 'Only the reviewed original 72-file engine is admitted')
    for key in ('programExecuted', 'ownerChanged', 'productionDeploymentAuthorized'):
        require(c.get(key) is False, 'Preparation cannot claim execution or production approval')
    build = c.get('build')
    require(isinstance(build, dict) and build.get('name') == 'build-current4'
            and build.get('reportPath') == 'C:/xjy-results/current-code-build-build-current4.json', 'Exact build-current4 report required')
    for key in ('reportSha256', 'newProgramTreeSha256', 'gatewaySourceSha256', 'gatewayOutputSha256', 'webRuntimeBuildReportSha256'):
        require(sha(build.get(key)), 'Root must seal actual build4/source/gateway/program-tree hashes: '+key)
    app = validate_guest_path(build.get('appInput'), ROOT)
    require(re.fullmatch(re.escape(ROOT)+r'/release-work/audit-code-[A-Za-z0-9-]+/app-input', app) is not None,
            'Build4 owned app-input path required')
    require('/audit-code-xur5da/' not in app.lower() and '/audit-code-89mvhj/' not in app.lower(), 'Old app input cannot be renamed as build4')
    return deepcopy(c)


def validate_guest_path(value, boundary):
    """Return canonical fixed-boundary path; reject aliases/ADS/escape, no IO."""
    def canonical(raw):
        require(isinstance(raw, str) and re.match(r'^[A-Za-z]:[\\/]', raw) is not None,
                'Canonical absolute local Guest path required')
        require(not re.search(r'[\x00-\x1f]', raw) and ':' not in raw[2:], 'Control/ADS path refused')
        parts = raw[3:].replace('\\', '/').split('/')
        for part in parts:
            require(part not in ('', '.', '..') and part.rstrip(' .') == part
                    and re.fullmatch(r'(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?', part, re.I) is None,
                    'Guest path aliases/reserved names refused')
        return raw[0].upper()+':/'+'/'.join(parts)
    base, target = canonical(boundary), canonical(value)
    require(target.lower() == base.lower() or target.lower().startswith(base.lower()+'/'), 'Guest path escaped its boundary')
    return target


def plan_owner_handoff(contract, evidence):
    """Validate all public QA evidence, return marker-only write intent, no IO."""
    c = validate_contract(contract)
    require(isinstance(evidence, dict), 'Independently collected runtime evidence required')
    e = evidence
    proof = e.get('actualContext', {})
    require(isinstance(proof, dict) and isinstance(proof.get('userName'), str)
            and proof['userName'].lower().endswith('\\wdagutilityaccount') and proof.get('model') == 'Virtual Machine'
            and proof.get('productionDrivePresent') is False and proof.get('inputMarkerPresent') is True
            and type(proof.get('nonLoopbackAddressCount')) is int and proof['nonLoopbackAddressCount'] == 0,
            'Actual Guest facts required; the model itself grants no admission')
    expected_owner = {'version': 1, 'purpose': 'current-source-ui-qa', 'namespace': NAMESPACE, 'runId': 'ui-a1'}
    require(e.get('namespace') == NAMESPACE and e.get('owner') == expected_owner
            and e.get('ownerSha256') == OLD_OWNER and e.get('ownerOrdinary') is True
            and e.get('profileIdentityStable') is True, 'Exact known old owner/physical profile required')
    require(e.get('oldPackageSha256') == OLD_PACKAGE and e.get('oldProgramTreeVerified') is True
            and type(e.get('oldHistoricalStopsVerified')) is int and e['oldHistoricalStopsVerified'] == 2,
            'Both historical stops and complete old program proof required')
    require(e.get('newProgramTreeSha256') == c['build']['newProgramTreeSha256'] and e.get('newProgramReady') is True
            and e.get('newProgramExecuted') is False, 'Fresh complete new program proof required')
    require(e.get('exclusiveRootWindow') is True, 'Root exclusive QA window required')
    observations = e.get('currentObservations')
    require(isinstance(observations, list) and len(observations) == 2, 'Two current clean observations required')
    for row in observations:
        require(isinstance(row, dict) and row.get('fresh') is True
                and all(row.get(key) == [] for key in ('knownOwnedAlive', 'namespaceProcesses', 'profileProcesses', 'activeQaRunners', 'listeners')),
                'A current process/listener observation is not clean')
    transaction = e.get('transactionId')
    require(isinstance(transaction, str) and re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}', transaction) is not None,
            'Unique server-generated QA transaction UUID required')
    temporary = c['ownerPath']+'.ui-a2.'+transaction+'.tmp'
    return {'expectedOldOwnerSha256': OLD_OWNER, 'ownerPath': c['ownerPath'],
            'newOwner': {**expected_owner, 'runId': 'ui-a2'}, 'retainOldOwnerBytes': True,
            'launchProgram': False, 'temporaryOwnerPath': temporary,
            'profileWrites': [c['ownerPath'], temporary], 'transactionId': transaction}


def owner_cas_action(phase, current_sha256, old_sha256, new_sha256):
    """Return write-new/verify-commit/no-write or reject unknown state, no IO."""
    require(all(sha(x) for x in (current_sha256, old_sha256, new_sha256)) and old_sha256 != new_sha256,
            'Distinct exact owner byte digests required')
    if phase == 'prepared' and current_sha256 == old_sha256:
        return 'write-new'
    if phase in ('prepared', 'owner-written') and current_sha256 == new_sha256:
        return 'verify-commit'
    if phase == 'committed' and current_sha256 == new_sha256:
        return 'no-write'
    raise PolicyError('Unknown owner or inconsistent journal; never overwrite')
