"""Driver protocol tests use deterministic callbacks; no process is launched."""
from pathlib import Path
import importlib.util
import tempfile
import unittest
import hashlib
import os

ROOT=Path(__file__).resolve().parent.parent
FILE=ROOT/'stage1/sandbox-guest-candidate-driver.py'


class DriverProtocol(unittest.TestCase):
    def driver(self):
        self.assertTrue(FILE.is_file(),'guarded actual guest driver is missing')
        spec=importlib.util.spec_from_file_location('guest_driver_protocol',FILE)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        return module

    def test_helper_tap_requires_one_complete_zero_skip_summary(self):
        driver=self.driver()
        good='\n'.join('# '+name+' '+str(value) for name,value in [('tests',25),('pass',25),('fail',0),('cancelled',0),('skipped',0),('todo',0)])+'\n'
        self.assertEqual(driver.parse_zero_skip_tap(good)['tests'],25)
        for bad in (good+'# tests 25\n',good.replace('# skipped 0\n',''),good.replace('# tests 25','# tests 0'),good.replace('# pass 25','# pass 24'),good.replace('# skipped 0','# skipped 1')):
            with self.subTest(bad=bad):
                with self.assertRaises(RuntimeError):driver.parse_zero_skip_tap(bad)

    def test_windows_51_native_probe_preserves_chinese_paths(self):
        raw=(ROOT/'stage1/candidate-initial-native-probe.ps1').read_bytes()
        self.assertTrue(raw.startswith(b'\xef\xbb\xbf'),'Windows PowerShell 5.1 requires a UTF-8 BOM for this non-ASCII script')
        text=raw.decode('utf-8-sig')
        self.assertIn('鑫金源珠宝报价.exe',text)
        self.assertIn('工作室数据',text)

    def test_host_or_unproved_context_stops_before_runner(self):
        driver=self.driver();calls=[]
        with self.assertRaisesRegex(RuntimeError,'Sandbox|context|guest'):
            driver.validate_proof({'model':'Desktop','userName':'Administrator','productionDrivePresent':False,'nonLoopbackAddressCount':0})
        self.assertEqual(calls,[])

    def test_exact_actual_context_is_required(self):
        driver=self.driver();proof={'model':'Virtual Machine','userName':'FAKE\\WDAGUtilityAccount','productionDrivePresent':False,'nonLoopbackAddressCount':0,'inputMarkerPresent':True}
        self.assertEqual(driver.validate_proof(proof),proof)
        for key,value in [('productionDrivePresent',True),('nonLoopbackAddressCount',1),('inputMarkerPresent',False),('userName','FAKE\\Administrator')]:
            with self.subTest(key=key):
                with self.assertRaises(RuntimeError):driver.validate_proof({**proof,key:value})

    def test_failed_engine_probe_cannot_enable_policy_or_run_later_groups(self):
        driver=self.driver();calls=[]
        def runner(name):
            calls.append(name);return {'exitCode':1,'evidence':{'backupSupported':False}}
        results=driver.run_sequence(runner)
        self.assertEqual(calls,['engine-capabilities'])
        self.assertFalse(results['passed']);self.assertFalse(results['sourcePolicyCapabilitiesEligible'])
        self.assertTrue(all(row['status']=='not-run' for row in results['checks'][1:]))

    def test_first_candidate_failure_marks_later_not_run_and_keeps_real_code(self):
        driver=self.driver();calls=[]
        def runner(name):
            calls.append(name)
            if name=='engine-capabilities':return {'exitCode':0,'evidence':{'runAsNodeObserved':True,'backupSupported':True,'backupIntegrity':'ok'}}
            return {'exitCode':7 if name=='candidate-offline-fullmodules' else 0,'evidence':{'actualCheckPassed':True}}
        results=driver.run_sequence(runner)
        self.assertFalse(results['passed']);self.assertEqual(results['checks'][2]['exitCode'],7)
        self.assertEqual(len(calls),3);self.assertTrue(all(row['status']=='not-run' for row in results['checks'][3:]))

    def test_zero_exit_without_actual_evidence_is_never_pass(self):
        driver=self.driver();results=driver.run_sequence(lambda name:{'exitCode':0,'evidence':{}})
        self.assertFalse(results['passed']);self.assertEqual(results['checks'][0]['status'],'failed')

    def test_timeout_cannot_be_hidden_by_zero_exit_and_valid_json(self):
        driver=self.driver()
        results=driver.run_sequence(lambda name:{'exitCode':0,'timedOut':True,'evidence':{'runAsNodeObserved':True,'backupSupported':True,'backupIntegrity':'ok'}})
        self.assertFalse(results['passed']);self.assertEqual(results['checks'][0]['status'],'failed')

    def test_startup_requires_actual_login_assets_and_zero_errors(self):
        driver=self.driver()
        valid={'ok':True,'state':{'ready':True,'bridge':True,'text':'虚构资料 登录','images':[{'src':'/logo.png','loaded':True}]},'rendererErrors':[],'blockedNetwork':[]}
        self.assertTrue(driver.validate_startup_evidence(valid,png_header=b'\x89PNG\r\n\x1a\n')['actualCheckPassed'])
        for changed in ({'ok':False},{'rendererErrors':['real renderer error']},{'blockedNetwork':['https://invalid.example']},{'state':{**valid['state'],'text':'建立你的珠宝工作室 登录'}},{'state':{**valid['state'],'images':[{'loaded':False}]}}):
            with self.subTest(changed=changed):
                with self.assertRaises(RuntimeError):driver.validate_startup_evidence({**valid,**changed},png_header=b'\x89PNG\r\n\x1a\n')
        with self.assertRaises(RuntimeError):driver.validate_startup_evidence(valid,png_header=b'fake capture')

    def test_candidate_tree_rejects_extra_symlink_and_missing_file(self):
        driver=self.driver()
        with tempfile.TemporaryDirectory(dir=ROOT/'cache') as tmp:
            base=Path(tmp);candidate=base/'release-candidate';candidate.mkdir()
            (candidate/'fixed.cjs').write_text('pure fixture',encoding='utf-8')
            driver.verify_exact_tree(candidate,{'fixed.cjs'},boundary=base)
            (candidate/'extra.json').write_text('{}',encoding='utf-8')
            with self.assertRaisesRegex(RuntimeError,'extra|tree'):driver.verify_exact_tree(candidate,{'fixed.cjs'},boundary=base)
            (candidate/'extra.json').unlink()
            with self.assertRaisesRegex(RuntimeError,'missing|tree'):driver.verify_exact_tree(candidate,{'fixed.cjs','absent.cjs'},boundary=base)
            (candidate/'linked.cjs').symlink_to(candidate/'fixed.cjs')
            with self.assertRaisesRegex(RuntimeError,'link|reparse'):driver.verify_exact_tree(candidate,{'fixed.cjs','linked.cjs'},boundary=base)

    def test_owned_descendant_snapshot_uses_parent_chain_and_creation_not_names(self):
        driver=self.driver();root={'ProcessId':10,'ParentProcessId':1,'CreationUtc':'2026-10-15T00:00:00.0000000Z'}
        rows=[root,{'ProcessId':20,'ParentProcessId':10,'CreationUtc':'2026-10-15T00:00:01.0000000Z'},
              {'ProcessId':30,'ParentProcessId':20,'CreationUtc':'2026-10-15T00:00:02.0000000Z'},
              {'ProcessId':40,'ParentProcessId':2,'CreationUtc':'2026-10-15T00:00:03.0000000Z'},
              {'ProcessId':50,'ParentProcessId':10,'CreationUtc':'2026-10-14T00:00:03.0000000Z'}]
        self.assertEqual({row['ProcessId'] for row in driver.owned_descendants(rows,root)},{10,20,30})
        with self.assertRaises(RuntimeError):driver.owned_descendants([{**root,'CreationUtc':'different'}],root)

    def test_observer_bootstrap_is_a_separate_guarded_app_not_a_default_host_override(self):
        driver=self.driver();package,entry=driver.observer_bootstrap()
        self.assertEqual(package['name'],'xjy-guest-worker-observer')
        self.assertEqual(package['main'],'index.cjs')
        self.assertLess(entry.index('.actualGuard()'),entry.index('.run()'))
        self.assertNotIn("require('electron')",entry)
        self.assertNotIn('app.isPackaged',entry)
        self.assertNotIn('release-entry',entry)

    def test_missing_artifact_retains_real_failure_code_streams_and_timeout(self):
        driver=self.driver()
        with tempfile.TemporaryDirectory(dir=ROOT/'cache') as tmp:
            record={'exitCode':7,'stdout':'complete stdout log','stderr':'complete stderr log','timedOut':True,'process':{'pid':123}}
            result=driver.load_evidence(record,Path(tmp)/'absent.json')
            self.assertEqual(result['exitCode'],7);self.assertEqual(result['stdout'],record['stdout']);self.assertEqual(result['stderr'],record['stderr']);self.assertTrue(result['timedOut'])
            self.assertEqual(result['process'],record['process']);self.assertFalse(result['evidence']['actualCheckPassed']);self.assertIn('artifactError',result)
            bad=Path(tmp)/'bad.json';bad.write_text('malformed JSON',encoding='utf-8')
            result=driver.load_evidence({**record,'exitCode':0},bad)
            self.assertEqual(result['exitCode'],0);self.assertFalse(result['evidence']['actualCheckPassed'])

    def test_observer_engine_copy_is_create_new_with_complete_byte_closure(self):
        driver=self.driver()
        with tempfile.TemporaryDirectory(dir=ROOT/'cache') as tmp:
            base=Path(tmp);source=base/'toy-engine.exe';target=base/'copied-toy-engine.exe'
            content=b'MZ fictitious engine bytes - never executed';source.write_bytes(content)
            row={'size':len(content),'sha256':hashlib.sha256(content).hexdigest()}
            driver.copy_engine_row(source,target,row)
            self.assertEqual(target.read_bytes(),content)
            with self.assertRaisesRegex(RuntimeError,'fresh'):driver.copy_engine_row(source,target,row)
            source.write_bytes(b'changed toy source')
            with self.assertRaisesRegex(RuntimeError,'drift'):driver.copy_engine_row(source,base/'changed-copy.exe',row)

    def test_observer_engine_copy_rejects_aliases_before_target_content(self):
        driver=self.driver()
        with tempfile.TemporaryDirectory(dir=ROOT/'cache') as tmp:
            base=Path(tmp);source=base/'toy.exe';source.write_bytes(b'MZ toy')
            row={'size':6,'sha256':hashlib.sha256(b'MZ toy').hexdigest()}
            alias=base/'alias.exe';alias.symlink_to(source)
            with self.assertRaisesRegex(RuntimeError,'link|reparse'):driver.copy_engine_row(alias,base/'not-created.exe',row)
            self.assertFalse((base/'not-created.exe').exists())
            alias.unlink();os.link(source,alias)
            with self.assertRaisesRegex(RuntimeError,'link'):driver.copy_engine_row(source,base/'not-created.exe',row)
            self.assertFalse((base/'not-created.exe').exists())

    def test_complete_specific_sequence_can_pass_only_real_evidence(self):
        driver=self.driver()
        def runner(name):
            evidence={'runAsNodeObserved':True,'backupSupported':True,'backupIntegrity':'ok'} if name=='engine-capabilities' else {'actualCheckPassed':True}
            if name=='candidate-fakehardware-worker':evidence.update({'realPassiveHtmlPrepared':True,'realPassivePdfPrepared':True,'deviceApiCalls':0,'nativeDelegations':0})
            return {'exitCode':0,'evidence':evidence}
        results=driver.run_sequence(runner)
        self.assertTrue(results['passed']);self.assertEqual(len(results['checks']),6)
        self.assertTrue(results['sourcePolicyCapabilitiesEligible'])

    def good_result(self,name):
        evidence={'runAsNodeObserved':True,'backupSupported':True,'backupIntegrity':'ok'} if name=='engine-capabilities' else {'actualCheckPassed':True}
        if name=='candidate-fakehardware-worker':evidence.update({'realPassiveHtmlPrepared':True,'realPassivePdfPrepared':True,'deviceApiCalls':0,'nativeDelegations':0})
        return {'exitCode':0,'evidence':evidence}

    def test_desktop_cli_is_explicit_mutually_exclusive_and_no_implicit_scope(self):
        driver=self.driver()
        self.assertFalse(driver.parse_arguments([]).desktop_only)
        self.assertTrue(driver.parse_arguments(['--desktop-only']).desktop_only)
        self.assertTrue(driver.parse_arguments(['--probe-only']).probe_only)
        with self.assertRaises(SystemExit):driver.parse_arguments(['--probe-only','--desktop-only'])
        with self.assertRaises(SystemExit):driver.parse_arguments(['--desktop-only=true'])
        with self.assertRaises(SystemExit):driver.parse_arguments(['--desktop'])
        with self.assertRaises(SystemExit):driver.parse_arguments(['--ignore-errors'])

    def test_desktop_cli_cannot_bypass_actual_guest_gate(self):
        driver=self.driver();driver.ROOT=Path('Q:/unregistered-fictional-test-root')
        with self.assertRaisesRegex(RuntimeError,'Actual Windows Sandbox fixed guest root required'):
            driver.main(['--desktop-only'])

    def test_desktop_scope_records_fixed_six_rows_and_never_runs_browser(self):
        driver=self.driver();calls=[]
        def runner(name):calls.append(name);return self.good_result(name)
        result=driver.run_sequence(runner,desktop_only=True)
        wanted=['engine-capabilities','candidate-host-startup','candidate-fakehardware-worker','candidate-updater-toy-recovery','candidate-three-database-attachments-restore']
        self.assertEqual(calls,wanted)
        self.assertEqual([row['name'] for row in result['checks']],list(driver.CHECKS))
        self.assertEqual(result['checks'][2],{'name':'candidate-offline-fullmodules','status':'deferred','passed':None,'exitCode':None,'reason':'Trusted --desktop-only scope: mobile/browser full-module verification is deferred.'})
        self.assertEqual(result['scope'],'desktop');self.assertEqual(result['mode'],'desktop-only')
        self.assertEqual(result['actualExecutedGroups'],5);self.assertEqual(result['expectedGroups'],list(driver.CHECKS));self.assertEqual(result['expectedExecutedGroups'],wanted)
        self.assertEqual(result['deferredGroups'],['candidate-offline-fullmodules'])
        self.assertTrue(result['passed']);self.assertFalse(result['desktopAcceptancePassed']);self.assertFalse(result['fullAcceptancePassed'])

    def test_desktop_scope_preserves_engine_failure_and_skips_later_real_groups(self):
        driver=self.driver();calls=[]
        def runner(name):calls.append(name);return {'exitCode':9,'evidence':{'backupSupported':False}}
        result=driver.run_sequence(runner,desktop_only=True)
        self.assertEqual(calls,['engine-capabilities']);self.assertFalse(result['passed']);self.assertFalse(result['sourcePolicyCapabilitiesEligible']);self.assertEqual(result['actualExecutedGroups'],1)
        self.assertEqual(result['checks'][0]['exitCode'],9);self.assertEqual(result['checks'][0]['status'],'failed');self.assertEqual(result['checks'][2]['status'],'deferred')
        self.assertTrue(all(result['checks'][i]['status']=='not-run' for i in [1,3,4,5]))

    def test_desktop_failure_after_deferred_browser_is_never_reclassified(self):
        driver=self.driver();calls=[]
        def runner(name):
            calls.append(name)
            if name=='candidate-updater-toy-recovery':return {'exitCode':7,'evidence':{'actualCheckPassed':True},'stdout':'real failure stdout','stderr':'real failure stderr'}
            return self.good_result(name)
        result=driver.run_sequence(runner,desktop_only=True)
        self.assertFalse(result['passed']);self.assertEqual(result['actualExecutedGroups'],4);self.assertEqual(calls[-1],'candidate-updater-toy-recovery')
        failed=result['checks'][4];self.assertEqual(failed['status'],'failed');self.assertEqual(failed['exitCode'],7);self.assertEqual(failed['stdout'],'real failure stdout');self.assertEqual(failed['stderr'],'real failure stderr')
        self.assertEqual(result['checks'][5]['status'],'not-run')

    def test_desktop_keeps_worker_native_hardware_blocker_and_timeouts(self):
        driver=self.driver()
        for changed in [{'timedOut':True},{'evidence':{'actualCheckPassed':True,'realPassiveHtmlPrepared':True,'realPassivePdfPrepared':True,'deviceApiCalls':1,'nativeDelegations':0}}]:
            with self.subTest(changed=changed):
                result=driver.run_sequence(lambda name:{**self.good_result(name),**changed} if name=='candidate-fakehardware-worker' else self.good_result(name),desktop_only=True)
                self.assertFalse(result['passed']);self.assertEqual(result['checks'][3]['status'],'failed');self.assertEqual(result['checks'][4]['status'],'not-run')

    def test_desktop_scope_requires_boolean_selector_not_body_or_env_values(self):
        driver=self.driver()
        for value in ['desktop','true',1,None,{'desktopOnly':True}]:
            with self.subTest(value=value):
                with self.assertRaises(TypeError):driver.run_sequence(lambda name:self.fail('invalid scope cannot run checks'),desktop_only=value)

    def test_desktop_acceptance_requires_all_five_checks_and_normal_owned_shutdown(self):
        driver=self.driver();sequence=driver.run_sequence(self.good_result,desktop_only=True)
        shutdown={'required':True,'passed':True,'forcedStop':False,'listenersClosed':True,'observedOwnDescendantsExited':True}
        result=driver.finish_acceptance(sequence,shutdown)
        self.assertTrue(result['passed']);self.assertTrue(result['desktopAcceptancePassed']);self.assertFalse(result['fullAcceptancePassed']);self.assertTrue(result['scopeDesktop'])
        for changed in [{'passed':False},{'forcedStop':True},{'listenersClosed':False},{'observedOwnDescendantsExited':False},{'passed':1},{'required':False}]:
            with self.subTest(changed=changed):
                result=driver.finish_acceptance(sequence,{**shutdown,**changed});self.assertFalse(result['passed']);self.assertFalse(result['desktopAcceptancePassed']);self.assertFalse(result['fullAcceptancePassed'])
        failed=driver.run_sequence(lambda name:{'exitCode':8,'evidence':{}} if name=='candidate-host-startup' else self.good_result(name),desktop_only=True)
        self.assertFalse(driver.finish_acceptance(failed,shutdown)['desktopAcceptancePassed'])

    def test_full_scope_remains_six_actual_checks_and_never_defers_failed_browser(self):
        driver=self.driver();result=driver.run_sequence(self.good_result)
        self.assertEqual(result['scope'],'full');self.assertEqual(result['actualExecutedGroups'],6);self.assertEqual(result['deferredGroups'],[])
        self.assertTrue(all(row['status']=='passed' for row in result['checks']))
        shutdown={'required':True,'passed':True,'forcedStop':False,'listenersClosed':True,'observedOwnDescendantsExited':True}
        complete=driver.finish_acceptance(result,shutdown);self.assertTrue(complete['fullAcceptancePassed']);self.assertFalse(complete['desktopAcceptancePassed'])
        failed=driver.run_sequence(lambda name:{'exitCode':7,'evidence':{'actualCheckPassed':True}} if name=='candidate-offline-fullmodules' else self.good_result(name))
        self.assertFalse(failed['passed']);self.assertEqual(failed['checks'][2]['status'],'failed');self.assertEqual(failed['deferredGroups'],[])


if __name__=='__main__':unittest.main()
