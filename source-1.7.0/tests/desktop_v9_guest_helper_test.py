"""Pure V9 helper-source tests; never execute helper or Guest-only scripts."""
from pathlib import Path
import hashlib
import importlib.util
import re
import base64
import json
import subprocess
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parent.parent
FILE = ROOT / 'stage1/prepare-desktop-v9-helper.py'
V8_HELPER = ROOT / 'sandbox/input/guest-bootstrap-v8-desktop.ps1'
WRAPPER = ROOT / 'stage1/candidate-delivery-approval-pure-ps-tests.ps1'
REVIEWER_FILES = (
    'delivery-approval/Prepare-Initial-Approval.ps1',
    'delivery-approval/approval-core.cjs',
    'delivery-approval/approval-archive.cjs',
    'delivery-approval/approval-io.cjs',
    'delivery-approval/负责人首次审定.cmd',
    'delivery-approval/README.md',
)
NEW_SEALED_ENTRIES = (*REVIEWER_FILES,
    'tests/delivery-approval-ps-paths.test.ps1',
    'tests/delivery-approval-ps-acl.test.ps1',
    'stage1/candidate-delivery-approval-pure-ps-tests.ps1',
)


class DesktopV9Helper(unittest.TestCase):
    def module(self):
        self.assertTrue(FILE.is_file(), 'Pure V9 helper source transformer absent')
        spec = importlib.util.spec_from_file_location('desktop_v9_helper_transform', FILE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def draft(self):
        source = V8_HELPER.read_bytes()
        tool = self.module()
        # The conversion API must not read a path, create output, or launch anything.
        with patch('builtins.open', side_effect=AssertionError('Conversion attempted file IO')):
            result = tool.build_draft(source)
        self.assertEqual(V8_HELPER.read_bytes(), source)
        return source.decode('utf-8-sig').replace('\r\n', '\n'), result

    def test_exact_v8_source_becomes_unsealed_v9_without_io(self):
        original, result = self.draft()
        self.assertIsInstance(result, str)
        self.assertEqual(result.count('__V9_MANIFEST_SHA256__'), 1)
        self.assertEqual(result.count('__V9_VERIFIER_SHA256__'), 1)
        for old in ('package-v8', 'desktop-verify-v8', 'Sealed v8-desktop',
                    'f59b67e35f5ded71686c810a516d7e72a367aaf730d45af5341eea7d07f6bde8',
                    '1963914ae74dccfe35a2998a7ba3bead849dc72bed5c518e06fff5b7d819b397'):
            self.assertNotIn(old, result)
        self.assertIn("$guestPackage='C:\\xjy-input\\package-v9'", result)
        self.assertIn("$guestOutput='C:\\xjy-results\\desktop-verify-v9'", result)
        self.assertEqual(original.count('package-v8'), result.count('package-v9'))
        self.assertEqual(original.count('desktop-verify-v8'), result.count('desktop-verify-v9'))

    def test_only_complete_v6_resources_and_fourteen_original_tools_are_admitted(self):
        _, result = self.draft()
        resource = next(line for line in result.splitlines()
                        if line.startswith(' if($guestManifest.releaseInclusion.'))
        self.assertIn("releaseManifestSha256 -cne 'c82426dc5463f2b5f0b366dd7c7e0ac09ec9d542bc9b81866997ecbc0cf9efd9'", resource)
        self.assertIn('resourceFileCount -ne 1007', resource)
        self.assertIn("sourceRoot -cne 'release/资源补丁-1.6.0-v7'", resource)
        engine = next(line for line in result.splitlines()
                      if line.startswith(' if($guestManifest.engineInclusion.'))
        for unchanged in ("manifestSha256 -cne '6893a279e6ab2ccaae36c9c66fd8c840ef4dacddc9cd9c78c24f87dd3f311ea4'",
                          'engineFileCount -ne 72', 'engineBytes -ne 385404497',
                          "executableSha256 -cne 'db3ad2066a55546f9b6737da3c7f011370e4856fb36888055b544d45653e4f40'",
                          'engineExecuted -ne $false', 'capabilitiesVerified -ne $false'):
            self.assertIn(unchanged, engine)
        self.assertIn('nativeProgramToolCount -ne 14', engine)
        self.assertNotIn('nativeProgramToolCount -ne 8', engine)

    def test_manifest_whitelist_admits_six_exact_reviewer_files_and_refuses_siblings(self):
        _, result = self.draft()
        expression = re.search(r"\$guestRelative -notmatch '([^']+)'", result).group(1)
        for name in REVIEWER_FILES:
            with self.subTest(admitted=name):
                self.assertIsNotNone(re.search(expression, name))
        for name in ('delivery-approval/extra.cjs', 'delivery-approval/README.md/child',
                     'delivery-approval/nested/approval-core.cjs',
                     'delivery-approval/Prepare-Initial-Approval.ps1.bak',
                     'delivery-approval/README.md.bak', 'delivery-approval/README-Xmd'):
            with self.subTest(refused=name):
                self.assertIsNone(re.search(expression, name))

    def test_required_sealed_entries_preserve_old_set_and_add_pure_reviewer_closure(self):
        original, result = self.draft()
        def entries(text):
            line = re.search(r'(?m)^ \$guestSealedEntries=@\(([^\n]+)\)$', text).group(1)
            return re.findall(r"'([^']+)'", line)
        before, after = entries(original), entries(result)
        self.assertEqual(after, before + list(NEW_SEALED_ENTRIES))
        self.assertEqual(len(after), len(set(after)))

    def test_baseline_scoped_desktop_validation_and_normal_exit_are_preserved(self):
        original, result = self.draft()
        tool=self.module()
        # Only the new independent TAP gate may surround the unchanged original
        # baseline callback and scoped aggregation; remove it for byte comparison.
        self.assertEqual(result.count(tool.NODE_TAP_FUNCTION+'\n'),1)
        self.assertEqual(result.count(tool.NODE_TAP_GATE),1)
        result=result.replace(tool.NODE_TAP_FUNCTION+'\n','').replace(tool.NODE_TAP_GATE,'')
        # These are emitted script boundaries, compared as data without evaluation.
        start = '# Data-free Windows PowerShell 5.1 result validation.'
        end = 'function Read-GuestPolicy([string]$Suffix){'
        self.assertEqual(result.split(start, 1)[1].split(end, 1)[0],
                         original.split(start, 1)[1].split(end, 1)[0])
        self.assertEqual(result.split(" $guestProof.stage='business-regression'", 1)[1],
                         original.split(" $guestProof.stage='business-regression'", 1)[1])
        for required in ('expectedExecutableChecks=20', 'expectedGuestNotApplicableChecks=2',
                         '$guestProof.expectedCandidateGroups=5',
                         'sandbox-guest-candidate-driver.py --desktop-only',
                         'normalDefaultHostShutdown', '$guestProof.fullAcceptancePassed=$false'):
            self.assertIn(required, result)

    def test_any_changed_v8_bytes_are_refused_before_transformation(self):
        tool = self.module()
        source = V8_HELPER.read_bytes()
        for changed in (b'', source[3:], source + b'\n', source.replace(b'package-v8', b'package-v9', 1)):
            with self.subTest(length=len(changed)):
                with self.assertRaisesRegex(RuntimeError, 'Exact sealed V8 helper'):
                    tool.build_draft(changed)

    def test_public_pins_match_actual_frozen_input_and_emitted_resource_contract(self):
        tool = self.module()
        self.assertEqual(hashlib.sha256(V8_HELPER.read_bytes()).hexdigest(), tool.SOURCE_SHA)
        self.assertEqual(tool.V7_RESOURCE_SHA, 'c82426dc5463f2b5f0b366dd7c7e0ac09ec9d542bc9b81866997ecbc0cf9efd9')
        self.assertEqual(tool.V7_ROOT, 'release/资源补丁-1.6.0-v7')
        self.assertEqual(tool.V7_RESOURCE_FILES, 1007)
        self.assertEqual(tuple(tool.REVIEWER_FILES), REVIEWER_FILES)

    def test_wrapper_artifact_guards_actual_guest_before_three_pure_child_tests(self):
        self.assertTrue(WRAPPER.is_file(), 'Guest-only pure PS wrapper absent')
        text = WRAPPER.read_text('utf-8-sig')
        root_guard = text.index("if($PSScriptRoot -cne ($guestRoot+'\\stage1'))")
        context = text.index("'validate-sandbox-context.py'")
        first_test = text.index("Invoke-PureTest 'reviewer-paths'")
        self.assertLess(root_guard, context)
        self.assertLess(context, first_test)
        self.assertEqual(text.count("Invoke-PureTest '"), 3)
        self.assertIn("Invoke-PureTest 'installer-plain' 'delivery-approval-ps-paths.test.ps1' @('-SourceRelativePath','..\\delivery-tools\\Initial-Full-Upgrade.ps1','-PlainOnly')", text)
        self.assertIn("Invoke-PureTest 'reviewer-acl-policy' 'delivery-approval-ps-acl.test.ps1'", text)
        self.assertIn('actualCheckPassed=$false', text)
        self.assertIn('$record.actualCheckPassed=$true', text)
        self.assertNotRegex(text, r'(?i)Set-ExecutionPolicy|Set-Acl|SetAccessControl|Add-Type|\.Kill\(')

    def test_actual_ps5_tap_parser_requires_dynamic_positive_complete_unique_zero_skip_totals(self):
        tool=self.module();source=getattr(tool,'NODE_TAP_FUNCTION',None)
        self.assertIsInstance(source,str,'Strict TAP parser source is absent')
        def tap(count=731):return 'TAP version 13\n1..1\n'+''.join('# '+k+' '+str(v)+'\n' for k,v in [('tests',count),('pass',count),('fail',0),('cancelled',0),('skipped',0),('todo',0)])
        valid=tap();cases=[{'name':'dynamic','text':valid,'want':True},{'name':'another-count','text':tap(1733),'want':True},
                          {'name':'bom-crlf','text':'\ufeff'+valid.replace('\n','\r\n'),'want':True},
                          {'name':'zero','text':tap(0),'want':False},{'name':'spec-is-not-tap','text':valid.replace('# ','ℹ '),'want':False},
                          {'name':'wrong-pass','text':valid.replace('# pass 731','# pass 730'),'want':False},
                          {'name':'missing-version','text':valid.replace('TAP version 13\n',''),'want':False},
                          {'name':'missing-plan','text':valid.replace('1..1\n',''),'want':False},
                          {'name':'overflow','text':valid.replace('# tests 731','# tests 9223372036854775808'),'want':False}]
        for key in ('tests','pass','fail','cancelled','skipped','todo'):
            line=next(line for line in valid.splitlines() if line.startswith('# '+key+' '))+'\n'
            cases += [{'name':'missing-'+key,'text':valid.replace(line,''),'want':False},
                      {'name':'duplicate-'+key,'text':valid+line,'want':False},
                      {'name':'duplicate-malformed-'+key,'text':valid+'# '+key+' invalid\n','want':False}]
        for key in ('fail','cancelled','skipped','todo'):cases.append({'name':'nonzero-'+key,'text':valid.replace('# '+key+' 0','# '+key+' 1'),'want':False})
        payload=base64.b64encode(json.dumps({'cases':cases},ensure_ascii=True).encode()).decode()
        script=source+"\n$inputData=ConvertFrom-Json -InputObject ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('"+payload+"')));$rows=@();foreach($case in $inputData.cases){$r=Get-GuestNodeTapSummary -Text $case.text;$rows+=@([pscustomobject]@{name=$case.name;passed=$r.passed;counts=$r.counts})};ConvertTo-Json -InputObject @($rows) -Depth 6 -Compress"
        result=subprocess.run(['C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe','-NoLogo','-NoProfile','-NonInteractive','-Command',script],capture_output=True,text=True,encoding='utf8',timeout=30,creationflags=0x08000000)
        self.assertEqual(result.returncode,0,result.stderr)
        rows=json.loads(result.stdout.lstrip('\ufeff'));self.assertEqual(len(rows),len(cases))
        self.assertEqual([(r['name'],r['passed']) for r in rows],[(c['name'],c['want']) for c in cases])
        self.assertEqual(rows[0]['counts']['tests'],731);self.assertEqual(rows[1]['counts']['tests'],1733)


if __name__ == '__main__':
    unittest.main()
