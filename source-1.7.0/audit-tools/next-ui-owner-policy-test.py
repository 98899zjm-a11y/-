"""Root-reviewed pure QA RED. No IO mutation, subprocess, DB, product or engine.

Synthetic build4 hashes below are model vectors only. The actual source-only
contract deliberately has no build4 hashes and must remain rejected.
"""
import importlib.util
import json
from pathlib import Path
import unittest

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location('next_ui_owner_policy', HERE/'next-ui-owner-policy.py')
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)
ROOT = 'C:/xjy-work/xjy-web-stage1'
OLD = 'f852f2f2c97f74d1715a31ebf2eb5a9e79d1086ed5eed5ab536eaee5e63b5e90'
NEW = 'e'*64  # Fictitious target digest; no file is written.


def contract():
    value = json.loads((HERE/'next-ui-contract.json').read_text('utf-8'))
    value['state'] = 'ROOT_REVIEWED_BUILD4'  # Only a synthetic positive model, never an admitted capsule.
    value['build'].update(reportSha256='1'*64,
                          appInput=ROOT+'/release-work/audit-code-MODEL-BUILD4/app-input',
                          newProgramTreeSha256='2'*64, gatewaySourceSha256='3'*64,
                          gatewayOutputSha256='4'*64, webRuntimeBuildReportSha256='5'*64)
    return value


def evidence():
    return {
        'actualContext': {'userName': 'MODEL\\WDAGUtilityAccount', 'model': 'Virtual Machine',
                          'productionDrivePresent': False, 'nonLoopbackAddressCount': 0,
                          'inputMarkerPresent': True},
        'namespace': '36fcbe9c-ece1-4be3-af35-309a2ee19e05',
        'transactionId': '00000000-0000-4000-8000-000000000002',
        'owner': {'version': 1, 'purpose': 'current-source-ui-qa',
                  'namespace': '36fcbe9c-ece1-4be3-af35-309a2ee19e05', 'runId': 'ui-a1'},
        'ownerSha256': OLD, 'ownerOrdinary': True, 'profileIdentityStable': True,
        'oldPackageSha256': 'abec0248806c1881ff2057786b594f2528509b8d01b21fa7a1185fe792cb3248',
        'oldProgramTreeVerified': True, 'oldHistoricalStopsVerified': 2,
        'newProgramTreeSha256': '2'*64, 'newProgramReady': True, 'newProgramExecuted': False,
        'currentObservations': [
            {'fresh': True, 'knownOwnedAlive': [], 'namespaceProcesses': [], 'profileProcesses': [],
             'activeQaRunners': [], 'listeners': []},
            {'fresh': True, 'knownOwnedAlive': [], 'namespaceProcesses': [], 'profileProcesses': [],
             'activeQaRunners': [], 'listeners': []},
        ],
        'exclusiveRootWindow': True,
    }


class NextUiOwnerPolicy(unittest.TestCase):
    def test_unsealed_actual_build4_contract_and_old_build3_are_refused(self):
        unsealed = json.loads((HERE/'next-ui-contract.json').read_text('utf-8'))
        # The real contract progresses to sealed after Root checks build4.
        # Keep this negative vector explicitly unsealed in either lifecycle.
        unsealed['state'] = 'SOURCE_ONLY_BUILD4_NOT_SEALED'
        unsealed['build']['reportSha256'] = None
        with self.assertRaises(policy.PolicyError):
            policy.validate_contract(unsealed)
        valid = contract()
        self.assertEqual(policy.validate_contract(valid), valid)
        for name, mutate in [
            ('old-report', lambda x: x['build'].update(name='build-current3')),
            ('old-app', lambda x: x['build'].update(appInput=ROOT+'/release-work/audit-code-xur5DA/app-input')),
            ('new-memory-engine', lambda x: x['engine'].update(version='44.7.2', executableSha256='1f41127064012c5e74422b2e0dfc35ff0b0fe8d7908b97d01503becd1b7fa9e1')),
            ('other-run', lambda x: x.update(runId='ui-a3')),
        ]:
            value = contract()
            mutate(value)
            with self.subTest(name=name), self.assertRaises(policy.PolicyError):
                policy.validate_contract(value)

    def test_fixed_paths_reject_escape_alias_and_alternate_streams(self):
        self.assertEqual(policy.validate_guest_path(ROOT+'/runtime/next-ui-ui-a2/program', ROOT), ROOT+'/runtime/next-ui-ui-a2/program')
        for path in ['F:/production/data', ROOT+'-other/file', ROOT+'/runtime/../config',
                     ROOT+'/config/file:stream', ROOT+'/config/NUL', ROOT+'/config/name.',
                     '//server/share/file', 'C:relative', ROOT+'/runtime//alias']:
            with self.subTest(path=path), self.assertRaises(policy.PolicyError):
                policy.validate_guest_path(path, ROOT)

    def test_exact_known_owner_proof_and_namespace_are_required(self):
        plan = policy.plan_owner_handoff(contract(), evidence())
        self.assertEqual(plan['expectedOldOwnerSha256'], OLD)
        self.assertEqual(plan['newOwner'], {'version': 1, 'purpose': 'current-source-ui-qa',
                                          'namespace': contract()['namespace'], 'runId': 'ui-a2'})
        for name, mutate in [
            ('same-json-unknown-bytes', lambda x: x.update(ownerSha256='f'*64)),
            ('other-owner', lambda x: x['owner'].update(runId='ui-unknown')),
            ('other-namespace', lambda x: x.update(namespace='00000000-0000-4000-8000-000000000000')),
            ('other-owner-namespace', lambda x: x['owner'].update(namespace='00000000-0000-4000-8000-000000000000')),
            ('owner-extra-field', lambda x: x['owner'].update(override=True)),
            ('owner-link', lambda x: x.update(ownerOrdinary=False)),
            ('profile-replaced', lambda x: x.update(profileIdentityStable=False)),
        ]:
            item = evidence()
            mutate(item)
            with self.subTest(name=name), self.assertRaises(policy.PolicyError):
                policy.plan_owner_handoff(contract(), item)

    def test_fresh_two_clean_observations_and_exclusive_window_are_required(self):
        policy.plan_owner_handoff(contract(), evidence())
        for name, mutate in [
            ('one-snapshot', lambda x: x.update(currentObservations=x['currentObservations'][:1])),
            ('historical-only', lambda x: x['currentObservations'][0].update(fresh=False)),
            ('owned-alive', lambda x: x['currentObservations'][1].update(knownOwnedAlive=[{'pid': 1}])),
            ('unknown-profile-process', lambda x: x['currentObservations'][0].update(profileProcesses=[{'pid': 2}])),
            ('runner-alive', lambda x: x['currentObservations'][0].update(activeQaRunners=[{'pid': 3}])),
            ('listener', lambda x: x['currentObservations'][1].update(listeners=[{'port': 42831}])),
            ('not-exclusive', lambda x: x.update(exclusiveRootWindow=False)),
            ('production-visible', lambda x: x['actualContext'].update(productionDrivePresent=True)),
            ('not-vm', lambda x: x['actualContext'].update(model='Physical PC')),
        ]:
            item = evidence()
            mutate(item)
            with self.subTest(name=name), self.assertRaises(policy.PolicyError):
                policy.plan_owner_handoff(contract(), item)

    def test_both_program_proofs_are_required_before_marker_only_plan(self):
        plan = policy.plan_owner_handoff(contract(), evidence())
        self.assertEqual(plan['ownerPath'], contract()['ownerPath'])
        self.assertTrue(plan['retainOldOwnerBytes'])
        self.assertFalse(plan['launchProgram'])
        self.assertEqual(set(plan['profileWrites']), {contract()['ownerPath'], plan['temporaryOwnerPath']})
        self.assertTrue(plan['temporaryOwnerPath'].startswith(contract()['ownerPath']+'.ui-a2.'))
        self.assertTrue(plan['temporaryOwnerPath'].endswith('.tmp'))
        self.assertIn(evidence()['transactionId'], plan['temporaryOwnerPath'])
        for key, value in [('oldProgramTreeVerified', False), ('oldHistoricalStopsVerified', 1),
                           ('oldPackageSha256', '9'*64), ('newProgramReady', False),
                           ('newProgramTreeSha256', '9'*64), ('newProgramExecuted', True)]:
            item = evidence()
            item[key] = value
            with self.subTest(key=key), self.assertRaises(policy.PolicyError):
                policy.plan_owner_handoff(contract(), item)

    def test_cas_resume_is_idempotent_and_never_overwrites_unknown_owner(self):
        self.assertEqual(policy.owner_cas_action('prepared', OLD, OLD, NEW), 'write-new')
        self.assertEqual(policy.owner_cas_action('prepared', NEW, OLD, NEW), 'verify-commit')
        self.assertEqual(policy.owner_cas_action('owner-written', NEW, OLD, NEW), 'verify-commit')
        self.assertEqual(policy.owner_cas_action('committed', NEW, OLD, NEW), 'no-write')
        for phase, current in [('prepared', 'd'*64), ('owner-written', OLD), ('committed', OLD), ('unknown', NEW)]:
            with self.subTest(phase=phase, current=current), self.assertRaises(policy.PolicyError):
                policy.owner_cas_action(phase, current, OLD, NEW)

    def test_cas_rejects_malformed_or_identical_owner_digests(self):
        for current, old, new in [(OLD, OLD, OLD), (None, OLD, NEW), (OLD, OLD, 'bad'),
                                   (OLD, 1, NEW), (OLD, OLD, None)]:
            with self.subTest(current=current, old=old, new=new), self.assertRaises(policy.PolicyError):
                policy.owner_cas_action('prepared', current, old, new)


if __name__ == '__main__':
    unittest.main()
