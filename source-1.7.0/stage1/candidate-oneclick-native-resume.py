"""One-off Guest QA continuation of the exact still-running run3 installer.

No installer is launched, no approval is repeated, and no process is killed.
Only the pinned Root's exact current direct shipping child may receive messages.
Historical reviewer/worker PIDs are deliberately not part of this observer.
"""
import ctypes as C
from ctypes import wintypes as W
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import traceback

R = Path('C:/xjy-work/xjy-web-stage1')
PYTHON = Path('C:/Python314/python.exe')
PS = Path('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe')
INPUT_PROBE = Path('C:/xjy-input/oneclick-native-v3/candidate-oneclick-native-probe.py')
INPUT_SHA = '3c100a443bc606d79e4995222638af04458b648d16f0ee753bb6fffdfd3ebcd9'
FIXTURE = R / 'runtime/oneclick-native-v3'
BUNDLE = FIXTURE / 'bundle'
INSTALL = FIXTURE / 'original-install'
OUTPUT = Path('C:/xjy-results/oneclick-native-v3/run4-resume')
ROOT_PID = 7844
ROOT_CREATED = 639276651215962060
ROOT_PARENT = 16076
LAUNCHER = BUNDLE / '安装组件/Start-Install.ps1'
LAUNCHER_SHA = 'cf7c879c17fb577c855f16555f5dc6ea25b2fd7893a26f9772ff5698e97a926f'
SHIPPING = BUNDLE / '安装组件/补丁文件/delivery-tools/Initial-Full-Upgrade.ps1'
SHIPPING_SHA = '41b2aebb424f118a150786b911787e465e1aa410ec1cbad09b54b636196fcdf5'
NO_WINDOW = 0x08000000


def now():
    return datetime.now(timezone.utc).isoformat()


def admission():
    if os.name != 'nt':
        raise RuntimeError('Actual Windows Sandbox Guest required')
    done = subprocess.run(
        [str(PYTHON), '-I', '-B', '-X', 'utf8', str(R / 'stage1/validate-sandbox-context.py')],
        capture_output=True, text=True, encoding='utf-8', timeout=40, creationflags=NO_WINDOW,
        env={'SystemRoot': 'C:\\Windows', 'WINDIR': 'C:\\Windows', 'SystemDrive': 'C:',
             'PSModulePath': str(PS.parent / 'Modules')})
    if done.returncode:
        raise RuntimeError('Actual Guest admission refused: ' + done.stderr[-2000:])
    proof = json.loads(done.stdout.lstrip('\ufeff'))
    if (proof.get('model') != 'Virtual Machine'
            or not str(proof.get('userName', '')).lower().endswith('\\wdagutilityaccount')
            or proof.get('productionDrivePresent') is not False
            or type(proof.get('nonLoopbackAddressCount')) is not int
            or proof['nonLoopbackAddressCount'] != 0 or proof.get('inputMarkerPresent') is not True):
        raise RuntimeError('Actual WDAG/F-absence/network evidence required')
    return proof


def load_base():
    for item in (INPUT_PROBE, *INPUT_PROBE.parents):
        if item.is_symlink() or os.path.isjunction(item):
            raise RuntimeError('Pinned input QA module cannot be a link')
    if hashlib.sha256(INPUT_PROBE.read_bytes()).hexdigest() != INPUT_SHA:
        raise RuntimeError('Pinned 3c QA verification module differs')
    spec = importlib.util.spec_from_file_location('pinned_oneclick_qa_3c', INPUT_PROBE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ProcessPin:
    def __init__(self, kernel, pid, created):
        self.kernel, self.pid, self.created = kernel, pid, created
        self.native_created = None
        self.handle = kernel.OpenProcess(0x1000 | 0x100000, False, pid)
        if not self.handle:
            raise RuntimeError('Cannot pin exact live installer process ' + str(pid))
        try:
            self.check(active=True)
        except Exception:
            self.close()
            raise

    def check(self, *, active=False):
        creation, exit_time, kernel_time, user_time = W.FILETIME(), W.FILETIME(), W.FILETIME(), W.FILETIME()
        if (self.kernel.GetProcessId(self.handle) != self.pid
                or not self.kernel.GetProcessTimes(self.handle, C.byref(creation), C.byref(exit_time), C.byref(kernel_time), C.byref(user_time))):
            raise RuntimeError('Pinned process handle identity could not be read')
        ticks = (creation.dwLowDateTime | (creation.dwHighDateTime << 32)) + 504911232000000000
        # Win32_Process CreationDate is microsecond precision. Bind its exact
        # observed microsecond, then retain all native FILETIME bits forever.
        if self.native_created is None:
            if not self.created <= ticks <= self.created + 9:
                raise RuntimeError('Pinned native creation is outside the exact observed CIM microsecond')
            self.native_created = ticks
        if ticks != self.native_created:
            raise RuntimeError('Pinned process creation identity differs')
        if active:
            size = W.DWORD(32768)
            image = C.create_unicode_buffer(size.value)
            if not self.kernel.QueryFullProcessImageNameW(self.handle, 0, image, C.byref(size)):
                raise RuntimeError('Pinned process image path unavailable')
            if os.path.normcase(image.value) != os.path.normcase(str(PS)):
                raise RuntimeError('Pinned process is not fixed system PowerShell')
        code = W.DWORD()
        if not self.kernel.GetExitCodeProcess(self.handle, C.byref(code)):
            raise RuntimeError('Pinned process exit status unavailable')
        if active and self.kernel.WaitForSingleObject(self.handle, 0) != 0x102:
            raise RuntimeError('Pinned installer process has already exited')
        return code.value

    def wait_exit(self, timeout=60):
        result = self.kernel.WaitForSingleObject(self.handle, int(timeout * 1000))
        if result != 0:
            raise RuntimeError('Pinned process did not exit normally within deadline; left for Root')
        return self.check()

    def close(self):
        if self.handle:
            self.kernel.CloseHandle(self.handle)
            self.handle = None


class Resume:
    def __init__(self, base, output):
        self.base, self.output = base, output
        self.win = base.Windows()
        self.kernel = self.win.kernel
        self.kernel.OpenProcess.argtypes = [W.DWORD, W.BOOL, W.DWORD]
        self.kernel.OpenProcess.restype = W.HANDLE
        self.kernel.GetProcessId.argtypes = [W.HANDLE]
        self.kernel.GetProcessId.restype = W.DWORD
        self.kernel.GetProcessTimes.argtypes = [W.HANDLE, C.POINTER(W.FILETIME), C.POINTER(W.FILETIME), C.POINTER(W.FILETIME), C.POINTER(W.FILETIME)]
        self.kernel.GetProcessTimes.restype = W.BOOL
        self.kernel.QueryFullProcessImageNameW.argtypes = [W.HANDLE, W.DWORD, W.LPWSTR, C.POINTER(W.DWORD)]
        self.kernel.QueryFullProcessImageNameW.restype = W.BOOL
        self.kernel.GetExitCodeProcess.argtypes = [W.HANDLE, C.POINTER(W.DWORD)]
        self.kernel.GetExitCodeProcess.restype = W.BOOL
        self.kernel.WaitForSingleObject.argtypes = [W.HANDLE, W.DWORD]
        self.kernel.WaitForSingleObject.restype = W.DWORD
        self.kernel.CloseHandle.argtypes = [W.HANDLE]
        self.kernel.CloseHandle.restype = W.BOOL
        self.actions, self.root, self.shipping = [], None, None
        self.log = base.ordinary(output / 'actions.jsonl', base=output, missing=True).open('x', encoding='utf-8', newline='\n')

    def event(self, action, **values):
        row = {'at': now(), 'action': action, **values}
        self.actions.append(row)
        self.log.write(json.dumps(row, ensure_ascii=False) + '\n')
        self.log.flush()
        os.fsync(self.log.fileno())

    def rows(self):
        # Only the exact current Root, its current direct children and the pinned
        # shipping PID are queried. No historical leaf identity is retained.
        condition = 'ProcessId={0} OR ParentProcessId={0}'.format(ROOT_PID)
        if self.shipping is not None:
            condition += ' OR ProcessId=' + str(self.shipping.pid)
        return self.base.ps_json(
            "$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);"
            "$rows=@(Get-CimInstance Win32_Process -Filter '" + condition + "'|ForEach-Object {"
            "@{ProcessId=[int]$_.ProcessId;ParentProcessId=[int]$_.ParentProcessId;"
            "CreationTicks=$_.CreationDate.ToUniversalTime().Ticks;ExecutablePath=$_.ExecutablePath;"
            "CommandLine=$_.CommandLine;Name=$_.Name}});@{rows=$rows}|ConvertTo-Json -Depth 5 -Compress")['rows']

    def script_identity(self, row, script, digest, *, parent, created):
        expected = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', str(script)]
        arguments = self.win.arguments(row.get('CommandLine') or '')
        if (row.get('ParentProcessId') != parent or row.get('CreationTicks') != created
                or self.base.canonical(row.get('ExecutablePath') or '') != self.base.canonical(PS)
                or len(arguments) != len(expected) + 1
                or self.base.canonical(arguments[0]) != self.base.canonical(PS)
                or arguments[1:] != expected
                or self.base.sha_file(script, base=BUNDLE)['sha256'] != digest):
            raise RuntimeError('Pinned process argv/path/creation/source identity differs')

    def attach(self):
        self.root = ProcessPin(self.kernel, ROOT_PID, ROOT_CREATED)
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            self.root.check(active=True)
            rows = self.rows()
            roots = [row for row in rows if row['ProcessId'] == ROOT_PID]
            if len(roots) != 1:
                raise RuntimeError('Exact original launcher no longer present')
            self.script_identity(roots[0], LAUNCHER, LAUNCHER_SHA, parent=ROOT_PARENT, created=ROOT_CREATED)
            candidates = []
            for row in rows:
                if row['ParentProcessId'] != ROOT_PID or row['CreationTicks'] < ROOT_CREATED:
                    continue
                arguments = self.win.arguments(row.get('CommandLine') or '')
                if len(arguments) >= 2 and arguments[-2:] == ['-File', str(SHIPPING)]:
                    self.script_identity(row, SHIPPING, SHIPPING_SHA, parent=ROOT_PID, created=row['CreationTicks'])
                    candidates.append(row)
            if len(candidates) > 1:
                raise RuntimeError('Multiple exact direct shipping children; no GUI action was sent')
            if candidates:
                row = candidates[0]
                self.shipping = ProcessPin(self.kernel, row['ProcessId'], row['CreationTicks'])
                self.event('attached-exact-live-processes', root=roots[0], shipping=row,
                           rootNativeCreationTicks=self.root.native_created,
                           shippingNativeCreationTicks=self.shipping.native_created,
                           handles='QUERY_LIMITED_INFORMATION|SYNCHRONIZE', historicalLeafPidsTracked=0)
                return
            time.sleep(0.7)
        raise RuntimeError('No exact direct shipping child observed; nothing was launched')

    def validate(self, window=None):
        self.root.check(active=True)
        self.shipping.check(active=True)
        rows = self.rows()
        for pin, script, digest, parent in ((self.root, LAUNCHER, LAUNCHER_SHA, ROOT_PARENT),
                                           (self.shipping, SHIPPING, SHIPPING_SHA, ROOT_PID)):
            found = [row for row in rows if row['ProcessId'] == pin.pid]
            if len(found) != 1:
                raise RuntimeError('Pinned live process disappeared before GUI action')
            self.script_identity(found[0], script, digest, parent=parent, created=pin.created)
        if window is not None:
            if (window['pid'] != self.shipping.pid or self.win.pid(window['hwnd']) != self.shipping.pid
                    or self.win.text(window['hwnd']) != window['title']):
                raise RuntimeError('Shipping HWND/title/owner changed before GUI action')

    def body(self, window):
        return '\n'.join(row['title'] for row in self.win.children(window['hwnd'], window['pid'])
                         if row['title'] and 'STATIC' in row['class'].upper())

    def wait_dialog(self, titles, timeout):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            self.validate()
            windows = self.win.top_windows({ROOT_PID, self.shipping.pid})
            for window in windows:
                if window['title'] in {'审定未完成', '升级未开始或未完成', '安装更新未完成', '已恢复'}:
                    self.event('owned-error-dialog', window=window, body=self.body(window))
                    raise RuntimeError('Pinned installer error dialog was observed')
            matches = [window for window in windows if window['pid'] == self.shipping.pid and window['title'] in titles]
            if len(matches) > 1:
                raise RuntimeError('Ambiguous pinned shipping dialog')
            if matches:
                self.validate(matches[0])
                return matches[0]
            time.sleep(0.7)
        raise RuntimeError('Pinned shipping dialog deadline exceeded; no process was stopped')

    def continue_shipping(self):
        role = self.wait_dialog({'鑫金源珠宝完整升级'}, 180)
        body = self.body(role)
        if str(INSTALL) not in body:
            raise RuntimeError('Shipping role window does not bind the exact owned fixture')
        self.validate(role)
        buttons = [row for row in self.win.children(role['hwnd'], self.shipping.pid)
                   if row['title'] == '这是员工电脑']
        if len(buttons) != 1 or not self.win.user.IsChild(role['hwnd'], buttons[0]['hwnd']):
            raise RuntimeError('Exactly one owned employee button required')
        self.validate(role)
        if self.win.pid(buttons[0]['hwnd']) != self.shipping.pid:
            raise RuntimeError('Employee button HWND owner changed')
        self.win.post(buttons[0]['hwnd'], 0x00F5)
        self.event('continue-original-shipping-as-employee', window=role, body=body, control=buttons[0])
        completion = self.wait_dialog({'完成', '已核验'}, 900)
        body = self.body(completion)
        if not any(text in body for text in ('完整程序资源已升级', '已核验完整升级完成记录')):
            raise RuntimeError('Unexpected completion message body: ' + body)
        self.event('read-original-shipping-completion', window=completion, body=body)
        self.validate(completion)
        self.win.post(completion['hwnd'], 0x0010)  # WM_CLOSE only dismisses this completion MessageBox.
        self.event('dismiss-completion-messagebox-WM_CLOSE', window=completion)
        shipping_exit = self.shipping.wait_exit(60)
        root_exit = self.root.wait_exit(60)
        self.event('original-process-exits-observed-by-pinned-handles', rootExitCode=root_exit,
                   shippingExitCode=shipping_exit, rootPid=ROOT_PID, shippingPid=self.shipping.pid)
        if root_exit != 0 or shipping_exit != 0:
            raise RuntimeError('Original pinned launcher/shipping did not actually exit zero')
        return {'completionObserved': True, 'rootPid': ROOT_PID, 'rootCreationTicks': ROOT_CREATED,
                'rootNativeCreationTicks': self.root.native_created,
                'rootExitCode': root_exit, 'shippingPid': self.shipping.pid,
                'shippingCreationTicks': self.shipping.created, 'shippingExitCode': shipping_exit,
                'shippingNativeCreationTicks': self.shipping.native_created,
                'exitCodesReadFromPinnedProcessHandles': True, 'newInstallerLaunched': False}

    def close(self):
        if self.shipping:
            self.shipping.close()
        if self.root:
            self.root.close()
        self.log.close()


def main():
    context = admission()
    base = load_base()
    base.ordinary(BUNDLE, base=R / 'runtime', directory=True)
    base.ordinary(INSTALL, base=R / 'runtime', directory=True)
    base.ordinary(OUTPUT, base=Path('C:/xjy-results/oneclick-native-v3'), directory=True, missing=True)
    OUTPUT.mkdir(exist_ok=True)
    for name in ('actions.jsonl', 'resume-result.json'):
        if (OUTPUT / name).exists():
            raise RuntimeError('Fresh resume outputs required; prior evidence was not overwritten')
    result = {'version': 1, 'purpose': 'actual-oneclick-exact-live-root-resume-qa',
              'startedAt': now(), 'passed': False, 'actualContext': context,
              'fictitiousOnly': True, 'productionRead': False, 'productionWrite': False,
              'newInstallerLaunched': False, 'approvalRepeated': False, 'globalInputEvents': 0,
              'forcedStops': 0, 'historicalLeafPidsTracked': 0, 'baseProbeSha256': INPUT_SHA}
    observer = None
    try:
        for script, digest in ((LAUNCHER, LAUNCHER_SHA), (SHIPPING, SHIPPING_SHA)):
            if base.sha_file(script, base=BUNDLE)['sha256'] != digest:
                raise RuntimeError('Exact live-run script bytes differ from captured run3 identity')
        before = {'engine': base.sha_file(INSTALL / base.EXE_NAME, base=INSTALL),
                  'asar': base.sha_file(INSTALL / 'resources/app.asar', base=INSTALL)}
        if before['engine']['sha256'] != base.ENGINE_SHA or before['asar']['sha256'] != base.OLD_ASAR_SHA:
            raise RuntimeError('Resume requires the still-unmodified owned original program')
        approval = base.guest_approval_metadata()
        record = approval.get('record') or {}
        if (approval.get('exists') is not True or record.get('artifactSha256') != base.ARTIFACT_SHA
                or record.get('publisherPublicKeySha256') != base.PUBLIC_PIN
                or record.get('role') != 'employee' or record.get('osUser') != approval['osUser']
                or base.canonical(record.get('installationDir', '')) != base.canonical(INSTALL)):
            raise RuntimeError('Existing actual approval is not bound to this exact employee installation')
        for key in ('directoryAcl', 'fileAcl'):
            if approval[key]['ownerAllowed'] is not True or approval[key]['unsafeAllowRules'] != 0:
                raise RuntimeError('Existing approval protection is unsafe')
        if approval['directoryAcl']['inheritanceProtected'] is not True:
            raise RuntimeError('Existing approval directory lacks its protected DACL')
        prior_approval_hash = base.sha_file(Path(approval['file']))
        result['before'] = before
        result['existingProtectedApprovalRecord'] = record
        result['existingApprovalFile'] = prior_approval_hash
        observer = Resume(base, OUTPUT)
        observer.attach()
        result['gui'] = observer.continue_shipping()
        actual = base.verify_actual_install(INSTALL, before)
        if actual['approvalFile'] != prior_approval_hash:
            raise RuntimeError('Approval record changed during continuation')
        result['actualInstallation'] = actual
        observer.event('actual-installed-bytes-backup-and-protected-approval-verified',
                       targetAsarSha256=base.NEW_ASAR_SHA, engineSha256=base.ENGINE_SHA,
                       originalAsarBackupSha256=base.OLD_ASAR_SHA, role='employee')
        result['passed'] = True
        result['employeeLifecycleLeftForRoot'] = True
        result['reviewerStdoutReceiptObserved'] = False
    except Exception as error:
        result['passed'] = False
        result['error'] = str(error)
        result['traceback'] = traceback.format_exc()
    finally:
        if observer:
            result['actions'] = observer.actions
            observer.close()
        result['finishedAt'] = now()
        with base.ordinary(OUTPUT / 'resume-result.json', base=OUTPUT, missing=True).open('x', encoding='utf-8', newline='\n') as stream:
            json.dump(result, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
    print(json.dumps({'passed': result['passed'], 'result': str(OUTPUT / 'resume-result.json'),
                      'error': result.get('error')}, ensure_ascii=False))
    return 0 if result['passed'] else 1


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as failure:
        print(str(failure), file=sys.stderr)
        raise SystemExit(1)
