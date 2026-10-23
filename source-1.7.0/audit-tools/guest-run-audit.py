"""Actual offline Sandbox audit runner. Exports logs/results, never DBs or secrets."""
from pathlib import Path
import importlib.util, json, os, re, subprocess, sys
from datetime import datetime, timezone

ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('actual_sandbox_context',ROOT/'stage1/sandbox-context.py')
context=importlib.util.module_from_spec(spec);spec.loader.exec_module(context)
context.read_context(ROOT)
OUTPUT=Path('C:/xjy-results')
if OUTPUT.is_symlink() or os.path.isjunction(OUTPUT):raise RuntimeError('Output boundary rejected')
mode=sys.argv[1]
if not re.fullmatch(r'[a-z][a-z0-9-]{0,63}',mode):raise RuntimeError('Bounded audit result name required')
out=OUTPUT/mode
out.mkdir(exist_ok=False)
node=str(ROOT/'stage1/tools/node.exe');python=sys.executable
deps=ROOT/'audit-tools/dependencies/node_modules'
env=os.environ.copy();env.update({'XJY_HISTORY_GUEST':'1','XJY_HISTORY_DEPS':str(deps),'XJY_DIRECTORY_DEPS':str(deps)})
auth_tests=['tests/gateway-expiry.test.cjs','tests/browser-gateway.test.cjs','tests/browser-bridge.test.cjs','tests/desktop-host-runtime.test.cjs','tests/network-maintenance-freeze.test.cjs','audit-tools/freeze-auth-boundary.test.cjs','audit-tools/stale-status-cookie.test.cjs','audit-tools/browser-cookie-separation.test.cjs','audit-tools/login-scope-limiter.test.cjs','audit-tools/browser-bridge-epoch-window.test.cjs','audit-tools/gateway-session-budget.test.cjs','audit-tools/gateway-cleanup-fence.test.cjs']
if mode=='baseline' or mode.startswith('regression-current'):
    tests=json.loads((ROOT/'audit-tools/baseline-node-tests.json').read_text('utf-8')) if mode=='baseline' else [p.relative_to(ROOT).as_posix() for p in sorted((ROOT/'tests').glob('*.test.cjs'))]+['audit-tools/finance-guards.test.cjs','audit-tools/finance-guards-history-api.test.cjs','audit-tools/composer-draft.test.cjs','audit-tools/freeze-auth-boundary.test.cjs','audit-tools/stale-status-cookie.test.cjs','audit-tools/browser-cookie-separation.test.cjs','audit-tools/login-scope-limiter.test.cjs','audit-tools/browser-bridge-epoch-window.test.cjs','audit-tools/gateway-session-budget.test.cjs','audit-tools/gateway-cleanup-fence.test.cjs','tests/customer-directory.cjs','audit-tools/customer-directory-ui.test.cjs','tests/repair-history-f4.cjs','audit-tools/repair-history-f4-ui.test.cjs','audit-tools/history-filters-ui.test.cjs','audit-tools/finance-cent-boundary.test.cjs']
    if mode!='baseline':tests.extend(['audit-tools/customer-activity-c1-compat.test.cjs','audit-tools/browser-relogin-audit-records.test.cjs','audit-tools/dialog-focus.test.cjs','audit-tools/dialog-focus-preferred.test.cjs','audit-tools/auth-usage-durability-supplement.test.cjs','audit-tools/auth-usage-savepoint-controls.test.cjs','audit-tools/typescript-auth-boundary.test.cjs','audit-tools/window-close-tray.test.cjs','audit-tools/customer-style-data-path-p2.test.cjs'])
    checks=[] if mode=='baseline' else [('build-finance',[node,'audit-tools/finance-guards-build.cjs','--dependencies-root',str(deps)])]
    checks.append(('node-unit',[node,'--test','--test-reporter=tap',*tests]))
    checks.extend((n,[python,'-I','-B',f'tests/{f}.py']) for n,f in [('python-guard','python_guard_test'),('launcher-boundaries','launcher_boundaries_test'),('os-access-gate','os_access_gate_test'),('sandbox-context','sandbox_context_test'),('erp-values','erp_values_test'),('erp-reports-pure','erp_reports_pure_test'),('erp-attachments','erp_attachments_test')])
    if mode!='baseline':checks.append(('finance-csv-export',[python,'-I','-B','-X','utf8','audit-tools/finance-csv-export-test.py']))
    checks.extend((m,[python,'-I','-B','stage1/run-restricted.py','--sandbox-guest','--script','stage1/host.cjs','--mode',m]) for m in ['smoke','finance-test','backup-test','daily-test','lan-test','numbers-test','collaboration-test','customers-test','export-test','security-test','restore-test','erp-test'])
elif mode.startswith('protocol-startup-'):
    import hashlib
    if len(sys.argv)!=4 or any(not re.fullmatch(r'[a-f0-9]{64}',value) for value in sys.argv[2:]):raise RuntimeError('Exact entry and app source pins required')
    protocol_test=ROOT/'audit-tools/release-protocol-startup.test.cjs'
    protocol_pin='a94870d148e93395f29095ee18693eb822eb8dc7fe0150190f16b666f3d17ec6'
    if hashlib.sha256(protocol_test.read_bytes()).hexdigest()!=protocol_pin:raise RuntimeError('Protocol startup regression source changed')
    env.update({'XJY_PROTOCOL_STARTUP_TEST_SHA256':protocol_pin,'XJY_PROTOCOL_ENTRY_SHA256':sys.argv[2],'XJY_PROTOCOL_APP_SHA256':sys.argv[3]})
    checks=[('protocol-startup',[node,'--test','--test-reporter=tap',str(protocol_test)])]
elif mode.startswith('protocol-related-'):
    checks=[('protocol-related',[node,'--test','--test-reporter=tap','tests/release-entry-recovery.test.cjs','tests/release-app-wiring.test.cjs','tests/release-admission.test.cjs','tests/release-storage.test.cjs','tests/print-worker-entry.test.cjs','tests/employee-recovery-entry.test.cjs','audit-tools/window-close-tray.test.cjs'])]
elif mode in {'postcommit-program-restore-a1','postcommit-program-restore-a2','postcommit-program-restore-a3'}:
    postcommit_tests=['audit-tools/postcommit-program-restore-contract-a2.test.cjs'] if mode.endswith('-a3') else ['audit-tools/repeat-program-patch.test.cjs','audit-tools/postcommit-program-restore-contract.test.cjs']
    for relative in postcommit_tests:
        if not (ROOT/relative).is_file():raise RuntimeError('Required explicit postcommit test file missing: '+relative)
    checks=[('postcommit-and-existing-repeat',[node,'--test','--test-reporter=tap',*postcommit_tests])]
elif mode.startswith('employee-real161-offline-'):
    checks=[('real-employee-161',[node,'audit-tools/employee-real161-offline.cjs'])]
elif mode=='employee-real162-process-a1':
    env.update({'XJY_REAL162_PROCESS_TEST_SHA256':'ed265343bf1cda1730c9916dda7cae4ab41ff3e84c4e43d002440fe59e9f2cd0','XJY_REAL162_PROCESS_NODE_SHA256':'ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32'})
    checks=[('real162-independent-process-recovery',[node,'audit-tools/employee-real162-process-recovery.cjs','--source-sha256','3d738c15818abf548741d4534182c64e5e854c29f88d64109b013beede37f80e'])]
elif mode=='release162-selfcheck-a1':
    checks=[('release162-selfcheck',[python,'-I','-B','-S','-X','utf8','audit-tools/release162-selfcheck.py','--source-sha256','4c2b65fb9cb47d115e02a7222bdf7e28bc9ca34c53b7eeee945722837a9a46dd'])]
elif mode=='release162-selfcheck-a2':
    checks=[('release162-selfcheck',[python,'-I','-B','-S','-X','utf8','audit-tools/release162-selfcheck-a2.py','--source-sha256','d1f28a7aa53ffb7391e91caf3e213feca2461ef7b9a7a3b048e7fa93a6f2360b'])]
elif mode=='release162-selfcheck-a3':
    checks=[('release162-selfcheck',[python,'-I','-B','-S','-X','utf8','audit-tools/release162-selfcheck-a3.py','--source-sha256','164a6c3a539ceaa072fd674b50a04846e2a5c9dc1b29f1df9a6a6ef7d809896b'])]
elif mode=='release162-selfcheck-a4':
    checks=[('release162-selfcheck',[python,'-I','-B','-S','-X','utf8','audit-tools/release162-selfcheck-a4.py','--source-sha256','1b79de0e260a71a4e86901f39aae06dbc7b9676f65e5bbd14ae4d4325736b889'])]
elif mode=='release162-preserve-a4-profile-a1':
    checks=[('preserve-proven-profile',[python,'-I','-B','-S','-X','utf8','audit-tools/preserve-native162-a4-profile.py','--source-sha256','714d267bc9b14f43fbf89884b55c99add6c40ec82d21b00ce11b5485ffea35b7'])]
elif mode=='release162-selfcheck-a5':
    checks=[('release162-selfcheck',[python,'-I','-B','-S','-X','utf8','audit-tools/release162-selfcheck-a5.py','--source-sha256','4989d09dd1d4e3a2e7b36bdf0054c3a08dda6f14a597ff72f87962507c9d3a32'])]
elif mode=='signed162-public-contract-a1':
    import hashlib
    test_file=ROOT/'audit-tools/signed162-public-contract.test.cjs'
    if hashlib.sha256(test_file.read_bytes()).hexdigest()!='616256601dcf34fda4a7da45996542336d9121bc7a5b75136d16b2ccfdd10c13':raise RuntimeError('Original issuer162 public contract changed')
    checks=[('original-issuer162-public-signatures',[node,'--test','--test-reporter=tap',str(test_file)])]
elif mode in {'publish162-contract-red-a1','publish162-contract-green-a1'}:
    import hashlib
    test_file=ROOT/'audit-tools/publish-162-feed.test.cjs'
    test_pin='505d5a9d6ce197e7ceefb40bee75a101bbe7c9a6f167df9a6c607fbfd37ee473'
    if hashlib.sha256(test_file.read_bytes()).hexdigest()!=test_pin:raise RuntimeError('162 publication test changed')
    env['XJY_PUBLISH162_TEST_SHA256']=test_pin
    if mode=='publish162-contract-green-a1':
        if len(sys.argv)!=3 or not re.fullmatch(r'[a-f0-9]{64}',sys.argv[2]):raise RuntimeError('Root-reviewed162 publisher SHA required')
        env['XJY_PUBLISH162_SUBJECT_SHA256']=sys.argv[2]
    elif len(sys.argv)!=2:raise RuntimeError('No subject pin before162 publisher exists')
    checks=[('publish162-contract',[node,'--test','--test-reporter=tap',str(test_file)])]
elif mode=='public161-baseline-place-a1':
    checks=[('place-public-baseline',[python,'-I','-B','-S','-X','utf8','audit-tools/place-public161-baseline.py','--source-sha256','2707fd1b566d979f175778078c6563ed328255b977a6fe8f2f71b267a21d40f4'])]
elif mode in {'host-repeat162-source-red-a1','host-repeat162-source-green-a1'}:
    import hashlib
    test_file=ROOT/'audit-tools/host-repeat-162-contract.test.cjs'
    if hashlib.sha256(test_file.read_bytes()).hexdigest()!='2d12080b5f877f832514a823a12b6e65fca07ad78489b9057423f2f243d0833e':raise RuntimeError('Host repeat contract changed')
    if mode=='host-repeat162-source-green-a1':
        for name,pin in [('seal-host-patch-162.cjs','19b7aa7a79313dd5490ec87ec77be924771e6d7ab036082f4b17304168245726'),('host-repeat-162.ps1.in','01955f595241ec7afc503e2ac9e92b33eb320485657f3a3b1ea98141118d511a')]:
            if hashlib.sha256((ROOT/'audit-tools'/name).read_bytes()).hexdigest()!=pin:raise RuntimeError('Host repeat source changed')
    checks=[('host-repeat-contract',[node,'--test','--test-reporter=tap',str(test_file)])]
elif mode=='release162-seed-a2':
    checks=[('seed-empty',[python,'-I','-B','-S','-X','utf8','audit-tools/release162-seed-empty.py','--expect-self-sha256','a3ef4c19471fe38863b4aac8ef51dbfddbb24ce98b198ee742bdec8f447a0bb8','--a2-manifest-sha256','fe20ea7d83f2e2200624bf81364078ca8b206d1efcc8dbad03b1841d0fab9da2','--seed-empty-synthetic-slots'])]
elif mode=='release162-seed-a3':
    checks=[('seed-empty',[python,'-I','-B','-S','-X','utf8','audit-tools/release162-seed-empty.py','--expect-self-sha256','cfcebca8854e4298a291389a299e1e37c79c593386e300920668aa13ec4f608b','--a2-manifest-sha256','fe20ea7d83f2e2200624bf81364078ca8b206d1efcc8dbad03b1841d0fab9da2','--seed-empty-synthetic-slots'])]
elif mode in {'release162-seed-preflight-a4','release162-seed-a4'}:
    checks=[('seed-empty',[python,'-I','-B','-S','-X','utf8','audit-tools/release162-seed-empty.py','--expect-self-sha256','b2d2d8b35828d32efa46d681ff17c52fb4f7288687c882eafc0a8930c50e5029','--a2-manifest-sha256','fe20ea7d83f2e2200624bf81364078ca8b206d1efcc8dbad03b1841d0fab9da2','--seed-empty-synthetic-slots',*(['--check-only'] if mode=='release162-seed-preflight-a4' else [])])]
elif mode=='release-backup-green-a1':
    checks=[('sqlite-long-snapshot',[node,'--test','--test-reporter=tap','--test-name-pattern=L01','audit-tools/sqlite-backup-long-path.test.cjs']),('repeat-program-patch',[node,'--test','--test-reporter=tap','audit-tools/repeat-program-patch.test.cjs']),('related-initial-backup',[node,'--test','--test-reporter=tap','tests/initial-patch-backup.test.cjs','tests/initial-patch-core.test.cjs','tests/initial-patch-entry.test.cjs','tests/initial-source-lease.test.cjs','tests/initial-upgrade-gate.test.cjs','tests/build-initial-patch.test.cjs'])]
elif mode=='sqlite-long-diagnostic-a1':
    checks=[('sqlite-long-observations',[node,'--test','--test-reporter=tap','--test-name-pattern=D00','audit-tools/sqlite-backup-long-path.test.cjs'])]
elif mode.startswith('sqlite-long-'):
    checks=[('sqlite-long-snapshot',[node,'--test','--test-reporter=tap','--test-name-pattern=L01','audit-tools/sqlite-backup-long-path.test.cjs'])]
elif mode=='install162-components-a1':
    checks=[('install162-components',[node,'--test','--test-reporter=tap','tests/employee-update.test.cjs','tests/employee-update-cache.test.cjs','tests/employee-update-installer.test.cjs','tests/native-employee-update.test.cjs','tests/updater-helper.test.cjs'])]
elif mode=='fresh-version-json-a1':
    env.update({'XJY_FRESH_VERSION_JSON_TEST_SHA256':'f7cc2d34befb645a165170445313054df4b848c10903d44c2068ad491af6fece','XJY_FRESH_VERSION_JSON_SOURCE_SHA256':'2b4652f6b0ed33d6ef71e3330e74ce2f083de5aafcbb6f56c2c9b18f3537e65c'})
    checks=[('fresh-version-json',[node,'--test','--test-reporter=tap','audit-tools/fresh-employee-version-json.test.cjs'])]
elif mode=='fresh-real162-a1':
    checks=[('fresh-real162',[node,'audit-tools/fresh-employee-real162.cjs','--source-sha256','58a33db62ec6844546a993015735d832f1c692c21cd4c64e3826a6f3b84508d1'])]
elif mode.startswith('fresh-employee-162-'):
    if len(sys.argv)!=3 or not re.fullmatch(r'[a-f0-9]{64}',sys.argv[2]):raise RuntimeError('Reviewed fresh162 installer source SHA required')
    env.update({'XJY_FRESH162_TEST_SHA256':'0fa4fcdce890cd1369f1b4196a0d0cba9a4da26c97ebee4f40c19be2476baa5c','XJY_FRESH162_SOURCE_SHA256':sys.argv[2]})
    checks=[('fresh-employee-162-contract',[node,'--test','--test-reporter=tap','audit-tools/fresh-employee-162-contract.test.cjs'])]
elif mode.startswith('fresh-employee-'):
    checks=[('fresh-employee-control',[node,'--test','--test-reporter=tap','--test-name-pattern=F01','audit-tools/fresh-employee-install.test.cjs']),('fresh-employee-install',[node,'--test','--test-reporter=tap','audit-tools/fresh-employee-install.test.cjs'])]
elif mode in {'release-162-prepare-a1','release-162-freeze-a1','release-162-public-a1','release-162-seal-a1','release-162-prepare-a2','release-162-freeze-a2','release-162-public-a2','release-162-seal-a2','release-162-seal-wrong-a2'}:
    import hashlib
    helper,pin=('audit-tools/release-162-candidate-a2.cjs','a0cb0e83e2201a26a486ab3457b5b78a958e3bfa1d51dd9a329331c1f53ea23d') if mode.endswith('-a2') else ('audit-tools/release-162-candidate.cjs','3400aa2179eb9a61a32d64158986e1af826431ba1e01e65edf7052a435f9e557')
    if hashlib.sha256((ROOT/helper).read_bytes()).hexdigest() != pin:raise RuntimeError('Reviewed 162 candidate helper changed')
    phase={'prepare':'prepare','freeze':'freeze-only','public':'public-key','seal':'seal'}[mode.split('-')[2]]
    args=[node,helper,phase]
    if phase=='seal':
        if len(sys.argv)!=3 or not re.fullmatch(r'[a-f0-9]{64}',sys.argv[2]):raise RuntimeError('Root-approved saved 162 freeze SHA required')
        args.extend(['--freeze-sha256',sys.argv[2]])
    elif len(sys.argv)!=2:raise RuntimeError('No extra 162 candidate arguments allowed')
    checks=[('release-162-'+phase,args)]
elif mode in {'release-161-prepare-a1','release-161-freeze-a1','release-161-public-a1','release-161-seal-a1'}:
    phase={'release-161-prepare-a1':'prepare','release-161-freeze-a1':'freeze-only','release-161-public-a1':'public-key','release-161-seal-a1':'seal'}[mode]
    args=[node,'audit-tools/release-161-candidate.cjs',phase]
    if phase=='seal':
        if len(sys.argv)!=3 or not re.fullmatch(r'[a-f0-9]{64}',sys.argv[2]):raise RuntimeError('Root-approved saved freeze SHA required')
        args.extend(['--freeze-sha256',sys.argv[2]])
    checks=[('release-161-'+phase,args)]
elif mode.startswith('repeat-patch-'):
    checks=[('repeat-patch-controls',[node,'--test','--test-reporter=tap','--test-name-pattern=H00','audit-tools/repeat-program-patch.test.cjs']),('repeat-program-patch',[node,'--test','--test-reporter=tap','audit-tools/repeat-program-patch.test.cjs'])]
elif mode in {'finance-archive-reader-a1','finance-archive-baseline-a1'}:
    args=[python,'-I','-B','-S','-X','utf8','audit-tools/finance-archive-readonly-probe.py','--source-sha256','2f310d31ca01a61b4169b1d6daa1a64e53ab89f56b86884e8df907ee1c1c6928','--run-id',mode.removeprefix('finance-archive-')]
    if mode=='finance-archive-reader-a1':args.append('--reader-pins-only')
    checks=[('finance-archive-readonly',args)]
elif mode.startswith('update-reminder-'):
    checks=[('update-reminder',[node,'--test','--test-reporter=tap','audit-tools/update-reminder.test.cjs'])]
elif mode.startswith('builder-161-'):
    checks=[('builder-161-controls',[node,'--test','--test-reporter=tap','--test-name-pattern=H00','audit-tools/full-release-161-parameters.test.cjs']),('builder-161-parameters',[node,'--test','--test-reporter=tap','audit-tools/full-release-161-parameters.test.cjs'])]
elif mode.startswith('relogin-native-'):
    checks=[('relogin-records',[node,'--test','--test-reporter=tap','audit-tools/browser-relogin-audit-records.test.cjs']),('auth-regression',[node,'--test','--test-reporter=tap',*auth_tests])]
elif mode.startswith('dialog-focus-'):
    checks=[('dialog-fixture-smoke',[node,'--test','--test-reporter=tap','--test-name-pattern=H00','audit-tools/dialog-focus.test.cjs']),('dialog-focus',[node,'--test','--test-reporter=tap','audit-tools/dialog-focus.test.cjs'])]
elif mode.startswith('dialog-preferred-'):
    checks=[('dialog-preferred',[node,'--test','--test-reporter=tap','audit-tools/dialog-focus-preferred.test.cjs']),('dialog-focus',[node,'--test','--test-reporter=tap','audit-tools/dialog-focus.test.cjs'])]
elif mode.startswith('auth-usage-controls-'):
    checks=[('auth-savepoint-controls',[node,'--test','--test-reporter=tap','audit-tools/auth-usage-savepoint-controls.test.cjs']),('dialog-preferred',[node,'--test','--test-reporter=tap','audit-tools/dialog-focus-preferred.test.cjs']),('dialog-focus',[node,'--test','--test-reporter=tap','audit-tools/dialog-focus.test.cjs'])]
elif mode.startswith('auth-usage-'):
    checks=[('auth-usage-durability',[node,'--test','--test-reporter=tap','audit-tools/auth-usage-durability-supplement.test.cjs']),('relogin-records',[node,'--test','--test-reporter=tap','audit-tools/browser-relogin-audit-records.test.cjs'])]
    if mode.startswith('auth-usage-green-'):checks.append(('auth-regression',[node,'--test','--test-reporter=tap',*auth_tests]))
elif mode in {'native-handles-a1','native-handles-a2'}:
    if len(sys.argv)!=3 or not re.fullmatch(r'[a-f0-9]{64}',sys.argv[2]):raise RuntimeError('Explicit native contract SHA required')
    checks=[('native-handle-probe',[python,'-I','-B','-X','utf8','audit-tools/ui-observer-native-handle-probe.py','--contract-sha256',sys.argv[2]])]
elif mode in {'collector-scope-b1','collector-scope-b2'}:
    if len(sys.argv)!=3 or not re.fullmatch(r'[a-f0-9]{64}',sys.argv[2]):raise RuntimeError('Explicit collector contract SHA required')
    checks=[('collector-tinyprobe',[python,'-I','-B','-X','utf8','audit-tools/ui-observer-collector-probe.py','--contract-sha256',sys.argv[2]])]
elif mode=='observer-v2-native-a1':
    if len(sys.argv)!=3 or not re.fullmatch(r'[a-f0-9]{64}',sys.argv[2]):raise RuntimeError('Explicit v2 parent-child contract SHA required')
    checks=[('observer-v2-parent-child',[python,'-I','-B','-X','utf8','audit-tools/ui-observer-v2-native-probe.py','--contract-sha256',sys.argv[2]])]
elif mode=='observer-v2-frame-a1':
    if len(sys.argv)!=3 or not re.fullmatch(r'[a-f0-9]{64}',sys.argv[2]):raise RuntimeError('Explicit v2 raw-frame diagnostic contract SHA required')
    checks=[('observer-v2-frame-diagnostic',[python,'-I','-B','-X','utf8','audit-tools/ui-observer-v2-native-diagnostic-probe.py','--contract-sha256',sys.argv[2]])]
elif mode=='observer-v2-detached-a1':
    if len(sys.argv)!=3 or not re.fullmatch(r'[a-f0-9]{64}',sys.argv[2]):raise RuntimeError('Explicit detached pair contract SHA required')
    checks=[('observer-v2-detached-pair',[python,'-I','-B','-X','utf8','audit-tools/ui-observer-v2-detached-probe.py','--contract-sha256',sys.argv[2]])]
elif mode in {'typed-auth-red-a1','typed-auth-red-a2','typed-auth-green-a1'}:
    checks=[('typed-auth-boundary',[node,'--test','--test-reporter=tap','audit-tools/typescript-auth-boundary.test.cjs'])]
elif mode=='tray-red-a1':
    checks=[('tray-host-smoke',[node,'--test','--test-reporter=tap','--test-name-pattern=H00','audit-tools/window-close-tray.test.cjs']),('tray-lifecycle',[node,'--test','--test-reporter=tap','audit-tools/window-close-tray.test.cjs'])]
elif mode=='tray-green-a1':
    checks=[('tray-lifecycle',[node,'--test','--test-reporter=tap','audit-tools/window-close-tray.test.cjs']),('related-lifecycle',[node,'--test','--test-reporter=tap','tests/release-app-wiring.test.cjs','tests/release-entry-recovery.test.cjs','tests/release-storage.test.cjs','tests/launch-role.test.cjs','tests/native-employee-update.test.cjs','tests/employee-update-installer.test.cjs','tests/desktop-host-runtime.test.cjs'])]
elif mode=='p2-data-red-a1':
    checks=[('build-finance',[node,'audit-tools/finance-guards-build.cjs','--dependencies-root',str(deps)]),('p2-data-controls',[node,'--test','--test-reporter=tap','--test-name-pattern=H00|C03|C04|S04','audit-tools/customer-style-data-path-p2.test.cjs']),('p2-data-paths',[node,'--test','--test-reporter=tap','audit-tools/customer-style-data-path-p2.test.cjs'])]
elif mode=='p2-data-green-a1':
    checks=[('build-finance',[node,'audit-tools/finance-guards-build.cjs','--dependencies-root',str(deps)]),('p2-data-paths',[node,'--test','--test-reporter=tap','audit-tools/customer-style-data-path-p2.test.cjs']),('related-customer-history',[node,'--test','--test-reporter=tap','tests/customer-directory.cjs','audit-tools/customer-directory-ui.test.cjs','audit-tools/composer-draft.test.cjs','tests/history-snapshot.test.cjs','audit-tools/customer-activity-c1-compat.test.cjs'])]
elif mode=='p2-state-supplement-a1':
    checks=[('p2-state-supplement',[node,'--test','--test-reporter=tap','audit-tools/customer-style-p2-state-supplement.test.cjs'])]
elif mode in {'finance-csv-red-a1','finance-csv-red-a2'}:
    checks=[('csv-export-control',[python,'-I','-B','-X','utf8','audit-tools/finance-csv-export-test.py','-k','H00']),('csv-export-contract',[python,'-I','-B','-X','utf8','audit-tools/finance-csv-export-test.py'])]
elif mode=='finance-csv-green-a1':
    checks=[('csv-export-contract',[python,'-I','-B','-X','utf8','audit-tools/finance-csv-export-test.py']),('erp-report-controls',[python,'-I','-B','-X','utf8','tests/erp_reports_pure_test.py'])]
elif mode=='sidecar-build-metadata-a1':
    checks=[('sidecar-build-metadata',[python,'-I','-B','-S','-X','utf8','audit-tools/sidecar-build-metadata.py'])]
elif mode.startswith('c1-green'):checks=[('build-finance',[node,'audit-tools/finance-guards-build.cjs','--dependencies-root',str(deps)]),('customer-activity-c1',[node,'--test','audit-tools/customer-activity-c1-compat.test.cjs']),('repair-history-f4',[node,'--test','tests/repair-history-f4.cjs','audit-tools/repair-history-f4-ui.test.cjs']),('finance-cent-boundary',[node,'--test','audit-tools/finance-cent-boundary.test.cjs'])]
elif mode.startswith('c1-'):checks=[('build-finance',[node,'audit-tools/finance-guards-build.cjs','--dependencies-root',str(deps)]),('customer-activity-c1',[node,'--test','audit-tools/customer-activity-c1-compat.test.cjs'])]
elif mode.startswith('cent-f5-'):checks=[('build-finance',[node,'audit-tools/finance-guards-build.cjs','--dependencies-root',str(deps)]),('repair-history-f4',[node,'--test','tests/repair-history-f4.cjs','audit-tools/repair-history-f4-ui.test.cjs']),('finance-cent-boundary',[node,'--test','audit-tools/finance-cent-boundary.test.cjs'])]
elif mode.startswith('repair-f4-'):checks=[('build-finance',[node,'audit-tools/finance-guards-build.cjs','--dependencies-root',str(deps)]),('repair-history-f4',[node,'--test','tests/repair-history-f4.cjs','audit-tools/repair-history-f4-ui.test.cjs'])]
elif mode.startswith('composer-'):checks=[('composer-draft',[node,'--test','audit-tools/composer-draft.test.cjs'])]
elif mode.startswith('p0-'):checks=[('build-finance',[node,'audit-tools/finance-guards-build.cjs','--dependencies-root',str(deps)]),('finance-guards',[node,'--test','audit-tools/finance-guards.test.cjs']),('finance-api',[node,'--test','audit-tools/finance-guards-history-api.test.cjs']),('history-snapshot',[node,'--test','tests/history-snapshot.test.cjs']),('lan-stability',[node,'--test','tests/lan-stability.test.cjs'])]
elif mode.startswith('lan-'):checks=[('lan-stability',[node,'--test','tests/lan-stability.test.cjs'])]
elif mode.startswith('finance-api-'):checks=[('build-finance',[node,'audit-tools/finance-guards-build.cjs','--dependencies-root',str(deps)]),('finance-api',[node,'--test','audit-tools/finance-guards-history-api.test.cjs'])]
elif mode=='platinum-source-identity-a1':
    checks=[('platinum-source-identity',[python,'-I','-B','-S','-X','utf8','audit-tools/platinum-source-identity.py'])]
elif mode=='platinum-ledger-repack-a1':
    checks=[('platinum-ledger-repack',[python,'-I','-B','-S','-X','utf8','audit-tools/platinum-ledger-repack.py','--tool-sha256','2c258a5579a3a6a235fc92fb210923005de574c4bdedd509a42ac781c55a79e5','--inventory-sha256','5a2616a55beadf3a4b89c380074e83daa0fb2e99c3b639d01e2df56cf34101ad','--sidecar-sha256','380dd17d8c1eee99faba7fce67ff3eb68326d5bef2e35c329d59784fabb0f9f5','--template-sha256','3b574daa8d6969d87dd2401b09f325f8a6c1ca25f0db21251bae0867831ca57f','--run-id',mode])]
elif mode=='platinum-ledger-repack-a2':
    checks=[('platinum-ledger-repack',[python,'-I','-B','-S','-X','utf8','audit-tools/platinum-ledger-repack.py','--tool-sha256','9a2560b5c4eeb7db88bef57b2ade056f7d1802a628825996c2bc50d3be28b971','--inventory-sha256','5a2616a55beadf3a4b89c380074e83daa0fb2e99c3b639d01e2df56cf34101ad','--sidecar-sha256','380dd17d8c1eee99faba7fce67ff3eb68326d5bef2e35c329d59784fabb0f9f5','--template-sha256','3b574daa8d6969d87dd2401b09f325f8a6c1ca25f0db21251bae0867831ca57f','--run-id',mode])]
elif mode=='platinum-candidate-http-a1':
    env['ELECTRON_RUN_AS_NODE']='1'
    checks=[('platinum-candidate-http',[str(Path('C:/xjy-base/release-candidate/鑫金源珠宝报价.exe')),'audit-tools/platinum-ledger-candidate-http.cjs','--source-sha256','ff96db8bd893a8d44a92245fd3a4d4fea65ee749593741b1889d5b48dd5f979f','--candidate-run','platinum-ledger-repack-a1','--candidate-manifest-sha256','c684b19f17fcd086b02c3feff9a68837362e13f5a2e2bceee73b55d9f320360d'])]
elif mode=='platinum-candidate-http-a2':
    env['ELECTRON_RUN_AS_NODE']='1'
    checks=[('platinum-candidate-http',[str(Path('C:/xjy-base/release-candidate/鑫金源珠宝报价.exe')),'audit-tools/platinum-ledger-candidate-http.cjs','--source-sha256','ff96db8bd893a8d44a92245fd3a4d4fea65ee749593741b1889d5b48dd5f979f','--candidate-run','platinum-ledger-repack-a2','--candidate-manifest-sha256','a32e4fd6ffa7da5842b5e5364396736c6b80d4775d3b5ebd10a9d78465418d16'])]
elif mode=='overview-summary-readonly-a2':
    checks=[('overview-summary-readonly',[python,'-I','-B','-S','-X','utf8','audit-tools/overview-summary-readonly-test.py','--source-sha256','e25ae76766a69de678aa20a39fda692559fc054a696b6b9a9db4325bfd10b29c','--case','all'])]
elif mode=='overview-summary-readonly-a1':
    checks=[('overview-summary-readonly',[python,'-I','-B','-S','-X','utf8','audit-tools/overview-summary-readonly-test.py','--source-sha256','15a15fa22481a532764ce9ac965f308044c1ce9cd08bbe2463f74db8f10885a9','--case','all'])]
elif mode=='platinum-unknown-groups-a2':
    checks=[('platinum-unknown-groups',[python,'-I','-B','-S','-X','utf8','audit-tools/platinum-unknown-groups-test.py','--source-sha256','5a805c428fcae7238019c609d1b680b0970f77911d59353067ae8c5cf504cc0b'])]
elif mode=='platinum-unknown-groups-a1':
    checks=[('platinum-unknown-groups',[python,'-I','-B','-S','-X','utf8','audit-tools/platinum-unknown-groups-test.py','--source-sha256','ff7e9db47a52e6ad4f0fe64896427b5dd03d6f1d635f406d1ae24f8b63a62411'])]
elif mode=='generated-app-info-a1':
    env['XJY_GENERATED_APP_INFO_TEST_SHA256']='9a73a5f0cd30fda32e576102cd31ac0a737e8f768a3775f244455805c56b351f'
    checks=[('generated-app-info',[node,'--test','--test-reporter=tap','audit-tools/generated-app-info.test.cjs'])]
elif mode.startswith('presence-metadata-recovery-'):
    if len(sys.argv)!=3 or not re.fullmatch(r'[a-f0-9]{64}',sys.argv[2]):raise RuntimeError('Reviewed reporter source SHA required')
    env.update({'XJY_PRESENCE_RECOVERY_TEST_SHA256':'93285b4467fcdd223f7473b913234ca75cde03db67427db8024326ea2f49e70c','XJY_PRESENCE_PENDING_TEST_SHA256':'71cc66a05d75f3348a1f6902b16e7ffd112f1cdad39b2df086c9e18aa92b4203','XJY_PRESENCE_PENDING_SOURCE_SHA256':sys.argv[2]})
    checks=[('presence-metadata-recovery',[node,'--test','--test-reporter=tap','audit-tools/presence-metadata-recovery.test.cjs'])]
elif mode.startswith('presence-fresh-host-'):
    if len(sys.argv)!=3 or not re.fullmatch(r'[a-f0-9]{64}',sys.argv[2]):raise RuntimeError('Root-reviewed presence reporter SHA required')
    env.update({'XJY_PRESENCE_FRESH_HOST_TEST_SHA256':'84e92c4210e4f7decb3147e8e296e550cbf29a5c1fce32d8a245014b43dfa36a','XJY_PRESENCE_PENDING_TEST_SHA256':'71cc66a05d75f3348a1f6902b16e7ffd112f1cdad39b2df086c9e18aa92b4203','XJY_PRESENCE_PENDING_SOURCE_SHA256':sys.argv[2]})
    checks=[('presence-fresh-host',[node,'--test','--test-reporter=tap','audit-tools/presence-fresh-host.test.cjs'])]
elif mode.startswith('presence-pending-'):
    if len(sys.argv)!=3 or not re.fullmatch(r'[a-f0-9]{64}',sys.argv[2]):raise RuntimeError('Root-reviewed presence reporter SHA required')
    env.update({'XJY_PRESENCE_PENDING_TEST_SHA256':'71cc66a05d75f3348a1f6902b16e7ffd112f1cdad39b2df086c9e18aa92b4203','XJY_PRESENCE_PENDING_SOURCE_SHA256':sys.argv[2]})
    checks=[('presence-pending',[node,'--test','--test-reporter=tap','audit-tools/presence-metadata-pending.test.cjs'])]
elif mode in {'version-related-a1','version-related-a2','version-related-a3','version-related-a4','version-related-a5'}:
    env['XJY_BUILD_DEPENDENCIES_ROOT']=str(deps)
    checks=[('build-version-gateway',[node,'stage1/build-web-runtime.cjs']),('build-version-renderer-tests',[node,'stage1/build-ui-tests.cjs']),('version-related',[node,'--test','--test-reporter=tap','tests/release-host-services.test.cjs','tests/release-app-wiring.test.cjs','tests/gateway-expiry.test.cjs','tests/full-release-builder.test.cjs','tests/desktop-host-runtime.test.cjs','tests/business-authority-preserve.test.cjs','tests/browser-module-proxy.test.cjs','tests/browser-gateway.test.cjs','tests/browser-bridge.test.cjs','tests/central-backend.test.cjs','tests/business-maintenance.test.cjs','tests/employee-profile.test.cjs','audit-tools/auth-usage-savepoint-controls.test.cjs','audit-tools/auth-usage-durability-supplement.test.cjs','audit-tools/browser-bridge-epoch-window.test.cjs','audit-tools/full-release-161-parameters.test.cjs','audit-tools/gateway-cleanup-fence.test.cjs','audit-tools/gateway-session-budget.test.cjs'])]
elif mode=='platinum-summary-readonly-a1':
    checks=[('platinum-summary-readonly',[python,'-I','-B','-S','-X','utf8','audit-tools/platinum-summary-readonly-test.py','--source-sha256','c4b8e289d518e81f7a7e6d076ea58cbf3861802819b5062eb9688568c4e21732','--case','all'])]
elif mode.startswith('employee-client-version-'):
    if len(sys.argv)!=3 or not re.fullmatch(r'[a-f0-9]{64}',sys.argv[2]):raise RuntimeError('Root-reviewed employee version source pins SHA required')
    import hashlib
    pin_file=ROOT/'audit-tools/employee-client-version-source-pins.json'
    if pin_file.is_symlink() or os.path.isjunction(pin_file) or pin_file.stat().st_nlink!=1 or pin_file.stat().st_size>8192:raise RuntimeError('Ordinary bounded source pin data required')
    pin_body=pin_file.read_bytes()
    if hashlib.sha256(pin_body).hexdigest()!=sys.argv[2]:raise RuntimeError('Employee version source pins changed')
    env.update({'XJY_CLIENT_VERSION_TEST_SHA256':'55d67432de85d1749d6fe2de38053a491746d1207083fb5b74a98830f695595d','XJY_CLIENT_VERSION_SOURCE_PINS':pin_body.decode('utf-8')})
    checks=[('employee-client-version',[node,'--test','--test-reporter=tap','audit-tools/employee-client-version.test.cjs'])]
elif mode.startswith('app-version-contract-'):
    if len(sys.argv)!=3 or not re.fullmatch(r'[a-f0-9]{64}',sys.argv[2]):raise RuntimeError('Root-reviewed app-version source pins SHA required')
    import hashlib
    pin_file=ROOT/'audit-tools/app-version-source-pins.json'
    if pin_file.is_symlink() or os.path.isjunction(pin_file) or pin_file.stat().st_nlink!=1 or pin_file.stat().st_size>8192:raise RuntimeError('Ordinary bounded source pin data required')
    pin_body=pin_file.read_bytes()
    if hashlib.sha256(pin_body).hexdigest()!=sys.argv[2]:raise RuntimeError('App-version source pins changed')
    env.update({'XJY_APP_VERSION_TEST_SHA256':'80125bffe49e011b979f0476011653b839c3f4ba18b2eace1696c2ffd4c1c74f','XJY_APP_VERSION_TYPESCRIPT_SHA256':'3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675','XJY_APP_VERSION_SOURCE_PINS':pin_body.decode('utf-8')})
    checks=[('app-version-contract',[node,'--test','--test-reporter=tap','audit-tools/app-version-contract.test.cjs'])]
elif mode.startswith('release162-parameters-'):
    if len(sys.argv)!=3 or not re.fullmatch(r'[a-f0-9]{64}',sys.argv[2]):raise RuntimeError('Root-reviewed 162 builder SHA required')
    env.update({'XJY_RELEASE162_TEST_SHA256':'4affac2bb5e67b3f92d4d0f3e0065bab1f14c7e3f3732e04509f39c053a43780','XJY_RELEASE162_BUILDER_SHA256':sys.argv[2]})
    checks=[('release162-parameters',[node,'--test','--test-reporter=tap','audit-tools/full-release-162-parameters.test.cjs'])]
elif mode.startswith('version-badge-'):
    if len(sys.argv)!=4 or not all(value=='absent' and mode=='version-badge-red-a1' or re.fullmatch(r'[a-f0-9]{64}',value) for value in sys.argv[2:]):raise RuntimeError('Root-reviewed badge source/style SHA required')
    env.update({'XJY_VERSION_BADGE_TEST_SHA256':'021f6732d6b986b88d26b44e07067b5d1324f909a69c9d6fcd581bf9c5f83aa6','XJY_VERSION_BADGE_SOURCE_SHA256':sys.argv[2],'XJY_VERSION_BADGE_CSS_SHA256':sys.argv[3]})
    checks=[('app-version-badge',[node,'--test','--test-reporter=tap','audit-tools/app-version-badge.test.cjs'])]
elif mode.startswith('update-ui-build-'):
    env['XJY_BUILD_DEPENDENCIES_ROOT']=str(deps)
    checks=[('build-update-renderer',[node,'stage1/build-ui-tests.cjs'])]
elif mode=='update-ui-related-a1':
    checks=[('update-ui-related',[node,'--test','--test-reporter=tap','tests/employee-update.test.cjs','tests/native-employee-update.test.cjs','tests/employee-update-installer.test.cjs','audit-tools/update-reminder.test.cjs'])]
elif mode.startswith('update-ui-test-'):
    if len(sys.argv)!=4 or not all(re.fullmatch(r'[a-f0-9]{64}',value) for value in sys.argv[2:]):raise RuntimeError('Root-reviewed update renderer and compiled manifest SHA required')
    env.update({'XJY_UPDATE_UI_TEST_SHA256':'a4426b942f617d3f9acb201a6dcadcec6700a7f05166bec67afab6d4f58d15ca','XJY_UPDATE_UI_SOURCE_SHA256':sys.argv[2],'XJY_UPDATE_UI_MANIFEST_SHA256':sys.argv[3]})
    checks=[('update-ui-presentation',[node,'--test','--test-reporter=tap','audit-tools/employee-update-presentation.test.cjs'])]
elif mode.startswith('update-ui-view-'):
    if len(sys.argv)!=3 or not re.fullmatch(r'[a-f0-9]{64}',sys.argv[2]):raise RuntimeError('Root-reviewed update view source SHA required')
    env.update({'XJY_UPDATE_VIEW_TEST_SHA256':'e8ad71ceff1ddb1dcac90e464a2d26014c71eaef82a3483466489eb117621f4a','XJY_UPDATE_VIEW_SOURCE_SHA256':sys.argv[2],'XJY_UPDATE_VIEW_TYPESCRIPT_SHA256':'3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675'})
    checks=[('update-ui-view',[node,'--test','--test-reporter=tap','audit-tools/employee-update-view.test.cjs'])]
elif mode=='platinum-sidecar-identity-a1':
    checks=[('platinum-sidecar-identity',[python,'-I','-B','-S','-X','utf8','audit-tools/platinum-sidecar-source-identity.py','--probe-sha256','d4252a8881f2b8b8e468330050f2f11c742389beb36963db29b54b1fac2ad3b7','--run-id',mode])]
elif mode.startswith('inventory-numeric-'):
    if len(sys.argv)!=3 or not re.fullmatch(r'[a-f0-9]{64}',sys.argv[2]):raise RuntimeError('Root-reviewed inventory source SHA required')
    checks=[('inventory-numeric-text',[python,'-I','-B','-S','-X','utf8','audit-tools/inventory-export-numeric-text-test.py','--source-sha256','939699699e621e86c26a98f6fd70697ce72004422ef1dc263ad1841eb0a59de9','--subject-sha256',sys.argv[2]])]
elif mode.startswith('inventory-policy-'):
    if len(sys.argv)!=3 or not re.fullmatch(r'[a-f0-9]{64}',sys.argv[2]):raise RuntimeError('Root-reviewed sidecar source SHA required')
    checks=[('inventory-export-policy',[python,'-I','-B','-S','-X','utf8','audit-tools/inventory-export-policy-test.py','--source-sha256','4be59e7a26788535d439819e82b6eed5a0753c3bc3d0b4c721650f941f18f1c9','--subject-sha256',sys.argv[2]])]
elif mode.startswith('inventory-export-v2-'):
    if len(sys.argv)!=4 or not all(re.fullmatch(r'[a-f0-9]{64}',value) for value in sys.argv[2:]):raise RuntimeError('Root-reviewed inventory and template SHA required')
    checks=[('inventory-filter-export-v2',[python,'-I','-B','-S','-X','utf8','audit-tools/inventory-filter-export-v2-test.py','--source-sha256','49ede737abae840900d2652083a0dc50535ebb9a52588c2e6dbae32451112e45','--subject-sha256',sys.argv[2],'--template-sha256',sys.argv[3]])]
elif mode.startswith('inventory-export-'):
    if len(sys.argv)!=4 or not all(re.fullmatch(r'[a-f0-9]{64}',value) for value in sys.argv[2:]):raise RuntimeError('Root-reviewed inventory and template SHA required')
    checks=[('inventory-filter-export',[python,'-I','-B','-S','-X','utf8','audit-tools/inventory-filter-export-test.py','--source-sha256','556309548af7bf2a247e1c80ed62f81980190ea6a5017d6da0ce926aad7e63d8','--subject-sha256',sys.argv[2],'--template-sha256',sys.argv[3]])]
elif mode.startswith('platinum-line-'):
    if len(sys.argv)!=3 or not re.fullmatch(r'[a-f0-9]{64}',sys.argv[2]):raise RuntimeError('Root-reviewed inventory source SHA required')
    checks=[('platinum-line-boundary',[python,'-I','-B','-S','-X','utf8','audit-tools/platinum-state-line-boundary-test.py','--source-sha256','7e41d68d499c714da011b87a3217b058480f2a1860486f01860e47cd7ed09cdd','--subject-sha256',sys.argv[2]])]
elif mode.startswith('platinum-state-'):
    if len(sys.argv)!=3 or not re.fullmatch(r'[a-f0-9]{64}',sys.argv[2]):raise RuntimeError('Root-reviewed inventory source SHA required')
    checks=[('platinum-state',[python,'-I','-B','-S','-X','utf8','audit-tools/platinum-state-readonly-test.py','--source-sha256','161cd7df503f92954d65b8f31c9d0e8b60d52fd0e220821c19a015b4329e41d4','--subject-sha256',sys.argv[2]])]
    if mode.startswith('platinum-state-green-'):
        checks.append(('platinum-state-compat',[python,'-I','-B','-S','-X','utf8','audit-tools/platinum-state-compat-test.py','--source-sha256','c577fe27f7d49940d186a71308a53dc9d1dbb99f455b1c171869cd5ba07fa333','--subject-sha256',sys.argv[2]]))
elif mode=='platinum-http-original-a1':
    env['ELECTRON_RUN_AS_NODE']='1'
    checks=[('platinum-http',[str(Path('C:/xjy-base/release-candidate/鑫金源珠宝报价.exe')),'audit-tools/platinum-ledger-http.cjs','--source-sha256','ee4385916cdc2beeaaf221eaf452aad12549251ce3e6ecdf5103d14fad8ee430'])]
elif mode=='platinum-http-parameters-a1':
    env['ELECTRON_RUN_AS_NODE']='1'
    checks=[('platinum-http-parameters',[str(Path('C:/xjy-base/release-candidate/鑫金源珠宝报价.exe')),'audit-tools/platinum-ledger-http-parameters.cjs','--source-sha256','1a0e1860dc1db01feeab8d933dadeb40270b25231a7e0240a5b1ece3cb53d9ae'])]
elif mode.startswith('engine-4490-runtime-'):
    env.update({'ELECTRON_RUN_AS_NODE':'1','XJY_ENGINE4490_MANIFEST_SHA256':'c70dab515150a84327f49c032240858741cd97a78c25f714f642b4fc72e2c6d7'})
    checks=[('new-engine-runtime',[str(ROOT/'release-work/engine-4490-a1/program/鑫金源珠宝报价.exe'),'--test','--test-reporter=tap','audit-tools/engine-4490-runtime.test.cjs'])]
elif mode=='engine-4490-extract-a1':
    checks=[('engine-extract',[python,'-I','-B','-S','-X','utf8','audit-tools/engine-4490-extract.py'])]
elif mode=='engine-4490-assemble-a1':
    checks=[('engine-assemble',[node,'audit-tools/engine-4490-assemble.cjs'])]
elif mode.startswith('engine-tree-'):
    checks=[('engine-tree-candidate',[node,'--test','--test-reporter=tap','audit-tools/engine-tree-candidate.test.cjs'])]
elif mode in {'engine-4490-prepare-a1','engine-4490-freeze-a1','engine-4490-seal-a1'}:
    phase={'engine-4490-prepare-a1':'prepare','engine-4490-freeze-a1':'freeze-only','engine-4490-seal-a1':'seal'}[mode]
    args=[node,'audit-tools/engine-4490-candidate.cjs',phase]
    if phase=='seal':
        if len(sys.argv)!=3 or not re.fullmatch(r'[a-f0-9]{64}',sys.argv[2]):raise RuntimeError('Root-approved source freeze SHA required')
        args.extend(['--freeze-sha256',sys.argv[2]])
    checks=[('engine-candidate-'+phase,args)]
elif mode.startswith('backup-log-'):
    if len(sys.argv)!=3 or not re.fullmatch(r'[a-f0-9]{64}',sys.argv[2]):raise RuntimeError('Root-reviewed daily source SHA required')
    env['XJY_DAILY_SOURCE_SHA256']=sys.argv[2]
    checks=[('backup-health-log-failure',[node,'--test','--test-reporter=tap','audit-tools/backup-health-log-failure.test.cjs'])]
elif mode.startswith('backup-health-'):
    checks=[('backup-health-status',[node,'--test','--test-reporter=tap','audit-tools/backup-health-status.test.cjs'])]
    if mode.startswith('backup-health-green-'):
        env['XJY_BUILD_DEPENDENCIES_ROOT']=str(deps)
        checks.insert(0,('build-renderer-tests',[node,'stage1/build-ui-tests.cjs']))
        checks.append(('backup-health-related',[node,'--test','--test-reporter=tap','tests/business-daily-cache.test.cjs','tests/business-maintenance.test.cjs','tests/host-maintenance-panel.test.cjs','tests/desktop-host-runtime.test.cjs','tests/network-maintenance-freeze.test.cjs','tests/release-app-wiring.test.cjs','tests/browser-bridge.test.cjs']))
elif mode.startswith('finance-http-'):
    checks=[('finance-binary-http',[str(Path('C:/xjy-base/release-candidate/鑫金源珠宝报价.exe')),'audit-tools/finance-binary-http.cjs','--source-sha256','55149c351aeec689c394be32107c8790df880f30f1e663b3a7f79a6fc9b6e098','--candidate-run','finance-repack-green-a2','--candidate-manifest-sha256','b249a4d71289246e6c2c1704b64c51e83e3efbe1e41e99e94b505c81a773f12b'])]
    env['ELECTRON_RUN_AS_NODE']='1'
elif mode.startswith('finance-repack-'):
    args=[python,'-I','-B','-S','-X','utf8','audit-tools/finance-repack-test.py','--source-sha256','5666bf5e533ca7897c9a10ae8fb5e12dd94ae681b0d3a53eb2a4f4cb55f8d6eb','--run-id',mode]
    if len(sys.argv)==3:
        if not re.fullmatch(r'[a-f0-9]{64}',sys.argv[2]):raise RuntimeError('Root-reviewed builder SHA required')
        args.extend(['--builder-sha256',sys.argv[2]])
    checks=[('finance-repack-contract',args)]
elif mode.startswith('finance-'):checks=[('build-finance',[node,'audit-tools/finance-guards-build.cjs','--dependencies-root',str(deps)]),('finance-guards',[node,'--test','audit-tools/finance-guards.test.cjs'])]
elif mode.startswith('history-missing-'):checks=[('history-missing-detail',[node,'--test','tests/history-missing-detail.test.cjs'])]
elif mode.startswith('history-'):checks=[('history-snapshot',[node,'--test','tests/history-snapshot.test.cjs'])]
elif mode.startswith('daily-cache-'):checks=[('daily-cache',[node,'--test','tests/business-daily-cache.test.cjs'])]
elif mode=='dependencies':
    checks=[('unpack-verified-dependencies',[node,'audit-tools/guest-dependencies.cjs'])]
elif mode.startswith('build-current'):checks=[('build-current',[node,'audit-tools/build-current-candidate.cjs',mode])]
elif mode=='concurrency-business-build':checks=[('build-current',[node,'audit-tools/build-current-candidate.cjs','concurrency-business-a1'])]
elif mode.startswith('concurrency-business-test-'):
    if len(sys.argv)!=3 or not re.fullmatch(r'[a-f0-9]{64}',sys.argv[2]):raise RuntimeError('Explicit reviewed materials SHA required')
    env['XJY_BROWSER_BUSINESS_MATERIALS_SHA256']=sys.argv[2]
    checks=[('ten-business-sessions',[node,'--test','--test-reporter=tap','audit-tools/browser-business-ten-sessions.test.cjs'])]
elif mode=='daily-diagnose':checks=[('daily-diagnose',[node,'audit-tools/daily-cache-diagnose.cjs'])]
else:raise RuntimeError('Unknown audit mode')
rows=[]
for name,args in checks:
    context.read_context(ROOT)
    start=datetime.now(timezone.utc).isoformat()
    with (out/(name+'.log')).open('xb') as log:
        # No timeout-kill. Parent orchestration observes progress; a stuck owned
        # Guest can be closed without touching the Host or production processes.
        proc=subprocess.Popen(args,cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT)
        code=proc.wait()
    row={'name':name,'startedAt':start,'endedAt':datetime.now(timezone.utc).isoformat(),'exitCode':code,'passed':code==0,'log':name+'.log'}
    rows.append(row)
    (out/'results.json').write_text(json.dumps(rows,indent=2),encoding='utf-8')
    print(json.dumps(row),flush=True)
    if code and (name.startswith('build-') or name in {'dialog-fixture-smoke','tray-host-smoke','p2-data-controls','csv-export-control'}):break
sys.exit(0 if all(r['passed'] for r in rows) else 1)
