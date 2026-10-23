"""Guest-only QA of the unchanged one-click installer against an owned fixture.

Never run this on the host. Actual Sandbox admission precedes any output write,
Win32 GUI API, fixture mutation or installer launch. No global input is used and
no process is killed. Root supplies and separately verifies the complete bundle.
"""
from __future__ import annotations

import argparse
import base64
import ctypes as C
from ctypes import wintypes as W
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import time
import traceback

R = Path('C:/xjy-work/xjy-web-stage1')
PYTHON = Path('C:/Python314/python.exe')
POWERSHELL = Path('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe')
FIXTURE = R / 'runtime/oneclick-native-v1'
BUNDLE = FIXTURE / 'bundle'
INSTALL = FIXTURE / 'original-install'
OUTPUT = Path('C:/xjy-results/oneclick-native-v1')
EXE_NAME = '鑫金源珠宝报价.exe'
ENGINE_SHA = 'db3ad2066a55546f9b6737da3c7f011370e4856fb36888055b544d45653e4f40'
OLD_ASAR_SHA = 'c6f2b998a0b6dc65ea22a5027c7843918a692eedc53a813f9f5c83910d7a60fb'
NEW_ASAR_SHA = 'ea677d9ea14583a01161ac9b27eba2e0d490ab28d1cb24ebbff42c7fa7afc9ef'
ARTIFACT_SHA = '16d12c14cd8ed16bb08dd61c946c3d8739af9231d7928942543f5eb1da3f979d'
PUBLIC_PIN = '6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c'
NO_WINDOW = 0x08000000


def canonical(value):
    return os.path.normcase(os.path.abspath(str(value)))


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def actual_admission():
    if os.name != 'nt':
        raise RuntimeError('Fixed actual Guest QA entry required; no installer or GUI action occurred')
    result = subprocess.run(
        [str(PYTHON), '-I', '-B', '-X', 'utf8', str(R / 'stage1/validate-sandbox-context.py')],
        capture_output=True, text=True, encoding='utf-8', timeout=40,
        creationflags=NO_WINDOW,
        env={'SystemRoot': 'C:\\Windows', 'WINDIR': 'C:\\Windows',
             'SystemDrive': 'C:', 'PSModulePath': str(POWERSHELL.parent / 'Modules')})
    if result.returncode:
        raise RuntimeError('Actual Sandbox admission refused: ' + result.stderr[-2000:])
    proof = json.loads(result.stdout.lstrip('\ufeff'))
    if (proof.get('model') != 'Virtual Machine'
            or not str(proof.get('userName', '')).lower().endswith('\\wdagutilityaccount')
            or proof.get('productionDrivePresent') is not False
            or type(proof.get('nonLoopbackAddressCount')) is not int
            or proof['nonLoopbackAddressCount'] != 0
            or proof.get('inputMarkerPresent') is not True):
        raise RuntimeError('Actual WDAG/F-absence/network evidence required')
    return proof


def ordinary(path, *, base=None, directory=False, missing=False):
    path = Path(path)
    if not path.is_absolute() or canonical(path) != os.path.normcase(str(path)):
        raise RuntimeError('Ordinary canonical absolute QA path required: ' + str(path))
    if base is not None:
        boundary = canonical(base)
        if canonical(path) != boundary and not canonical(path).startswith(boundary + os.sep):
            raise RuntimeError('QA path escaped its fixed boundary: ' + str(path))
    for item in (path, *path.parents):
        try:
            info = item.lstat()
        except FileNotFoundError:
            if missing and item == path:
                continue
            raise
        if stat.S_ISLNK(info.st_mode) or os.path.isjunction(item):
            raise RuntimeError('QA link/reparse path refused: ' + str(item))
        if item != path and not stat.S_ISDIR(info.st_mode):
            raise RuntimeError('QA parent is not an ordinary directory')
        if item == path:
            if directory != stat.S_ISDIR(info.st_mode):
                raise RuntimeError('QA file/directory type differs: ' + str(item))
            if not directory and (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1):
                raise RuntimeError('QA requires a single-link ordinary file')
    return path


def sha_file(path, *, base=None):
    path = ordinary(path, base=base)
    before = path.stat()
    digest = hashlib.sha256()
    stable = lambda row: (row.st_dev, row.st_ino, row.st_size, row.st_mtime_ns, row.st_ctime_ns, row.st_nlink)
    shared = lambda row: (row.st_dev, row.st_ino, row.st_size, row.st_mtime_ns, row.st_nlink)
    with path.open('rb') as stream:
        opened_before = os.fstat(stream.fileno())
        if shared(before) != shared(opened_before):
            raise RuntimeError('QA path/handle identity differs before hashing: ' + str(path))
        while chunk := stream.read(4 * 1024 * 1024):
            digest.update(chunk)
        opened_after = os.fstat(stream.fileno())
        if stable(opened_before) != stable(opened_after):
            raise RuntimeError('QA handle metadata changed while hashing: ' + str(path))
    after = ordinary(path, base=base).stat()
    # Actual Guest evidence shows Windows path.stat and os.fstat expose different
    # ctime meanings. Keep full stability checks within each API, and bind both
    # views with the observed common volume/file identity, size, mtime and links.
    if stable(before) != stable(after) or shared(opened_after) != shared(after):
        raise RuntimeError('QA input changed while hashing: ' + str(path))
    return {'path': str(path), 'size': after.st_size, 'sha256': digest.hexdigest()}


def ps_json(command, *, timeout=35):
    encoded = base64.b64encode(command.encode('utf-16-le')).decode('ascii')
    result = subprocess.run(
        [str(POWERSHELL), '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
        capture_output=True, text=True, encoding='utf-8', timeout=timeout,
        creationflags=NO_WINDOW,
        env={'SystemRoot': 'C:\\Windows', 'WINDIR': 'C:\\Windows', 'SystemDrive': 'C:',
             'PATHEXT': '.EXE', 'PSModulePath': str(POWERSHELL.parent / 'Modules')})
    if result.returncode:
        raise RuntimeError('Scoped Guest metadata probe failed: ' + result.stderr[-3000:])
    return json.loads(result.stdout.lstrip('\ufeff'))


def guest_approval_metadata():
    # The only KnownFolder read is this verified WDAG user's one fixed approval
    # record and its ACLs. No business configuration, database or key is opened.
    return ps_json(r"""$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$local=[Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
$dir=Join-Path $local '鑫金源珠宝\初次升级审定';$file=Join-Path $dir 'initial-upgrade-approval.json'
$policies=@(Get-ExecutionPolicy -List | ForEach-Object {@{scope=[string]$_.Scope;policy=[string]$_.ExecutionPolicy}})
function AclProof([string]$Name){
 $acl=Get-Acl -LiteralPath $Name;$owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
 $allowed=@($sid,'S-1-5-18','S-1-5-32-544');$unsafe=0;$rules=@()
 $danger=[Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
 foreach($r in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
  $who=$r.IdentityReference.Value;$allow=$r.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow
  if($allow -and $who -notin $allowed -and ($r.FileSystemRights -band $danger) -ne 0){$unsafe++}
  $rules+=@{sid=$who;allow=$allow;rights=[int]$r.FileSystemRights;inherited=$r.IsInherited}
 }
 return @{owner=$owner;ownerAllowed=($owner -in $allowed);unsafeAllowRules=$unsafe;inheritanceProtected=$acl.AreAccessRulesProtected;rules=$rules}
}
$exists=Test-Path -LiteralPath $file -PathType Leaf
$record=$null;$directoryAcl=$null;$fileAcl=$null
if($exists){$record=[IO.File]::ReadAllText($file,[Text.Encoding]::UTF8)|ConvertFrom-Json;$directoryAcl=AclProof $dir;$fileAcl=AclProof $file}
@{osUser=$sid;directory=$dir;file=$file;exists=$exists;record=$record;directoryAcl=$directoryAcl;fileAcl=$fileAcl;executionPolicies=$policies}|ConvertTo-Json -Depth 12 -Compress
""")


class Windows:
    def __init__(self):
        self.user = C.WinDLL('user32', use_last_error=True)
        self.shell = C.WinDLL('shell32', use_last_error=True)
        self.kernel = C.WinDLL('kernel32', use_last_error=True)
        self.callback = C.WINFUNCTYPE(W.BOOL, W.HWND, W.LPARAM)
        self.user.EnumWindows.argtypes = [self.callback, W.LPARAM]
        self.user.EnumWindows.restype = W.BOOL
        self.user.EnumChildWindows.argtypes = [W.HWND, self.callback, W.LPARAM]
        self.user.EnumChildWindows.restype = W.BOOL
        self.user.GetWindowThreadProcessId.argtypes = [W.HWND, C.POINTER(W.DWORD)]
        self.user.GetWindowThreadProcessId.restype = W.DWORD
        self.user.GetWindowTextW.argtypes = [W.HWND, W.LPWSTR, C.c_int]
        self.user.GetWindowTextW.restype = C.c_int
        self.user.GetClassNameW.argtypes = [W.HWND, W.LPWSTR, C.c_int]
        self.user.GetClassNameW.restype = C.c_int
        self.user.IsWindowVisible.argtypes = [W.HWND]
        self.user.IsWindowVisible.restype = W.BOOL
        self.user.IsWindow.argtypes = [W.HWND]
        self.user.IsWindow.restype = W.BOOL
        self.user.IsChild.argtypes = [W.HWND, W.HWND]
        self.user.IsChild.restype = W.BOOL
        self.user.GetDlgCtrlID.argtypes = [W.HWND]
        self.user.GetDlgCtrlID.restype = C.c_int
        self.user.SendMessageTimeoutW.argtypes = [W.HWND, W.UINT, W.WPARAM, W.LPARAM, W.UINT, W.UINT, C.POINTER(C.c_size_t)]
        self.user.SendMessageTimeoutW.restype = W.LPARAM
        self.user.PostMessageW.argtypes = [W.HWND, W.UINT, W.WPARAM, W.LPARAM]
        self.user.PostMessageW.restype = W.BOOL
        self.shell.CommandLineToArgvW.argtypes = [W.LPCWSTR, C.POINTER(C.c_int)]
        self.shell.CommandLineToArgvW.restype = C.POINTER(W.LPWSTR)
        self.kernel.LocalFree.argtypes = [W.HLOCAL]
        self.kernel.LocalFree.restype = W.HLOCAL

    def arguments(self, command):
        count = C.c_int()
        pointer = self.shell.CommandLineToArgvW(command, C.byref(count))
        if not pointer:
            raise RuntimeError('Cannot parse exact owned process command line')
        try:
            return [pointer[index] for index in range(count.value)]
        finally:
            self.kernel.LocalFree(C.cast(pointer, W.HLOCAL))

    def pid(self, hwnd):
        pid = W.DWORD()
        if not self.user.IsWindow(hwnd) or not self.user.GetWindowThreadProcessId(hwnd, C.byref(pid)):
            raise RuntimeError('Owned window disappeared before identity check')
        return pid.value

    def text(self, hwnd, *, control=False):
        buffer = C.create_unicode_buffer(8192)
        if control:
            self.send(hwnd, 0x000D, len(buffer), C.cast(buffer, C.c_void_p).value)
        else:
            self.user.GetWindowTextW(hwnd, buffer, len(buffer))
        return buffer.value

    def row(self, hwnd, *, control=False):
        cls = C.create_unicode_buffer(512)
        self.user.GetClassNameW(hwnd, cls, len(cls))
        return {'hwnd': int(hwnd), 'pid': self.pid(hwnd), 'title': self.text(hwnd, control=control),
                'class': cls.value, 'visible': bool(self.user.IsWindowVisible(hwnd)),
                'controlId': self.user.GetDlgCtrlID(hwnd)}

    def top_windows(self, allowed):
        rows = []
        @self.callback
        def collect(hwnd, _):
            pid = W.DWORD()
            self.user.GetWindowThreadProcessId(hwnd, C.byref(pid))
            if pid.value in allowed and self.user.IsWindowVisible(hwnd):
                rows.append(self.row(hwnd))
            return True
        self.user.EnumWindows(collect, 0)
        return rows

    def children(self, parent, pid):
        rows = []
        @self.callback
        def collect(hwnd, _):
            current = W.DWORD()
            self.user.GetWindowThreadProcessId(hwnd, C.byref(current))
            if current.value == pid and self.user.IsWindowVisible(hwnd):
                if len(rows) >= 200:
                    return False
                rows.append(self.row(hwnd, control=True))
            return True
        self.user.EnumChildWindows(parent, collect, 0)
        return rows

    def send(self, hwnd, message, wparam=0, lparam=0):
        result = C.c_size_t()
        if not self.user.SendMessageTimeoutW(hwnd, message, wparam, lparam, 0x0002, 2500, C.byref(result)):
            raise RuntimeError('Owned GUI message timed out or was refused')
        return result.value

    def post(self, hwnd, message):
        if not self.user.PostMessageW(hwnd, message, 0, 0):
            raise RuntimeError('Owned GUI action was refused')


class Probe:
    def __init__(self, context, output, bundle, install):
        self.context, self.output, self.bundle, self.install = context, output, bundle, install
        self.scripts = {'launcher': bundle / '安装组件/Start-Install.ps1',
                        'reviewer': bundle / '安装组件/审定工具/Prepare-Initial-Approval.ps1',
                        'shipping': bundle / '安装组件/补丁文件/delivery-tools/Initial-Full-Upgrade.ps1'}
        self.script_hashes = {name: sha_file(file, base=bundle)['sha256'] for name, file in self.scripts.items()}
        self.win = Windows()
        spec = importlib.util.spec_from_file_location('oneclick_owned_proof', R / 'stage1/guest-owned-process-proof.py')
        self.ownership = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.ownership)
        self.known, self.alive, self.process = [], {}, None
        self.actions = []
        self.log = ordinary(output / 'actions.jsonl', base=output, missing=True).open('x', encoding='utf-8', newline='\n')

    def event(self, action, **fields):
        row = {'at': utc_now(), 'action': action, **fields}
        self.actions.append(row)
        self.log.write(json.dumps(row, ensure_ascii=False) + '\n')
        self.log.flush()
        os.fsync(self.log.fileno())

    def snapshot(self, *, first=False):
        pids = [self.process.pid] if first else [row['ProcessId'] for row in self.known]
        if not pids or len(pids) > 128:
            raise RuntimeError('Bounded pinned launcher process scope required')
        condition = ' OR '.join('ProcessId={0} OR ParentProcessId={0}'.format(pid) for pid in pids)
        command = ("$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);"
                   "$rows=@(Get-CimInstance Win32_Process -Filter '" + condition + "' | ForEach-Object {"
                   "@{ProcessId=[int]$_.ProcessId;ParentProcessId=[int]$_.ParentProcessId;"
                   "CreationUtc=$_.CreationDate.ToUniversalTime().ToString('o');"
                   "CreationTicks=$_.CreationDate.ToUniversalTime().Ticks;Name=$_.Name;"
                   "ExecutablePath=$_.ExecutablePath;CommandLine=$_.CommandLine}});"
                   "@{rows=$rows}|ConvertTo-Json -Depth 5 -Compress")
        rows = ps_json(command)['rows']
        if first:
            roots = [row for row in rows if row['ProcessId'] == self.process.pid]
            if len(roots) != 1 or roots[0]['ParentProcessId'] != os.getpid():
                raise RuntimeError('Cannot pin the exact newly launched PowerShell process')
            self.known = [roots[0]]
        previous = {row['ProcessId']: row for row in self.known}
        self.known, alive = self.ownership.update_owned(self.known, rows)
        for row in alive:
            before = previous.get(row['ProcessId'])
            if before and any(row.get(key) != before.get(key) for key in ('ExecutablePath', 'CommandLine', 'CreationTicks')):
                raise RuntimeError('Pinned process path/arguments/creation identity changed')
        self.alive = {row['ProcessId']: row for row in alive}
        if first:
            self.assert_process(self.process.pid, 'launcher', refresh=False)
        return self.alive

    def assert_process(self, pid, role, *, refresh=True):
        if refresh:
            self.snapshot()
        row = self.alive.get(pid)
        if row is None:
            raise RuntimeError('Owned GUI process is no longer alive')
        arguments = self.win.arguments(row.get('CommandLine') or '')
        if role in self.scripts:
            expected = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', str(self.scripts[role])]
            if role == 'reviewer':
                expected.append('-OneClick')
            if (canonical(row.get('ExecutablePath') or '') != canonical(POWERSHELL)
                    or len(arguments) != len(expected) + 1
                    or canonical(arguments[0]) != canonical(POWERSHELL)
                    or arguments[1:] != expected):
                raise RuntimeError('Owned window does not belong to the exact ' + role + ' script command')
            if sha_file(self.scripts[role], base=self.bundle)['sha256'] != self.script_hashes[role]:
                raise RuntimeError('Reviewed GUI script bytes changed')
        elif role == 'employee':
            exe = self.install / EXE_NAME
            if (canonical(row.get('ExecutablePath') or '') != canonical(exe)
                    or len(arguments) != 2 or canonical(arguments[0]) != canonical(exe)
                    or arguments[1] != '--employee-client'):
                raise RuntimeError('Only this fixture employee main process may receive WM_CLOSE')
        else:
            raise RuntimeError('Unknown GUI actor role')
        return row

    def actor(self, window, role, *, pid=None):
        row = self.assert_process(window['pid'], role)
        if pid is not None and row['ProcessId'] != pid:
            raise RuntimeError('A later dialog is not from the confirmed reviewer/shipping process')
        if self.win.pid(window['hwnd']) != window['pid'] or self.win.text(window['hwnd']) != window['title']:
            raise RuntimeError('Window handle or title changed before action')
        return row

    def control(self, window, role, predicate, *, pid=None):
        self.actor(window, role, pid=pid)
        choices = [row for row in self.win.children(window['hwnd'], window['pid']) if predicate(row)]
        if len(choices) != 1 or not self.win.user.IsChild(window['hwnd'], choices[0]['hwnd']):
            raise RuntimeError('Exactly one owned visible GUI control required')
        if self.win.pid(choices[0]['hwnd']) != window['pid']:
            raise RuntimeError('Control ownership changed')
        return choices[0]

    def click(self, window, role, predicate, action, *, pid=None):
        control = self.control(window, role, predicate, pid=pid)
        self.win.post(control['hwnd'], 0x00F5)  # BM_CLICK, no global mouse/keyboard.
        self.event(action, window=window, process=self.alive[window['pid']], control=control)

    def body(self, window):
        return '\n'.join(row['title'] for row in self.win.children(window['hwnd'], window['pid'])
                         if row['title'] and 'STATIC' in row['class'].upper())

    def wait_window(self, title, role, timeout, *, pid=None):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            self.snapshot()
            windows = self.win.top_windows(self.alive)
            for window in windows:
                if window['title'] in {'审定未完成', '升级未开始或未完成', '安装更新未完成'}:
                    # Read only this owned chain's dialog; leave it open for Root.
                    self.event('owned-error-dialog', window=window, body=self.body(window), process=self.alive[window['pid']])
                    raise RuntimeError('Owned installer error dialog: ' + window['title'] + '\n' + self.body(window))
            matches = [window for window in windows if window['title'] == title]
            if len(matches) > 1:
                raise RuntimeError('Ambiguous duplicate owned dialog title: ' + title)
            if matches:
                self.actor(matches[0], role, pid=pid)
                return matches[0]
            if self.process.poll() is not None:
                raise RuntimeError('Launcher exited before expected dialog: ' + title)
            time.sleep(0.6)
        self.event('dialog-timeout', expectedTitle=title, ownedProcesses=list(self.alive.values()))
        raise RuntimeError('Timed out waiting for owned dialog: ' + title)

    def run_gui(self):
        environment = dict(os.environ)
        for key in ('NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE', 'XJY_DATA_DIR', 'XJY_LEDGER_DIR', 'XJY_INVENTORY_DIR'):
            environment.pop(key, None)
        environment.update({'SystemRoot': 'C:\\Windows', 'WINDIR': 'C:\\Windows', 'SystemDrive': 'C:',
                            'PATHEXT': '.EXE', 'TEMP': str(R / 'cache'), 'TMP': str(R / 'cache'),
                            'PSModulePath': str(POWERSHELL.parent / 'Modules')})
        with ordinary(self.output / 'launcher.stdout.log', base=self.output, missing=True).open('xb') as stdout, \
                ordinary(self.output / 'launcher.stderr.log', base=self.output, missing=True).open('xb') as stderr:
            self.process = subprocess.Popen(
                [str(POWERSHELL), '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
                 '-File', str(self.scripts['launcher'])], cwd=self.bundle, env=environment,
                stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr, creationflags=NO_WINDOW)
            self.snapshot(first=True)
            self.event('launcher-started', process=self.alive[self.process.pid], scripts=self.script_hashes)
            form = self.wait_window('鑫金源珠宝一键完整安装', 'reviewer', 180)
            reviewer = form['pid']
            edit = self.control(form, 'reviewer', lambda row: row['class'] == 'Edit' or row['class'].startswith('WindowsForms10.EDIT.'))
            buffer = C.create_unicode_buffer(str(self.install / EXE_NAME))
            self.win.send(edit['hwnd'], 0x000C, 0, C.cast(buffer, C.c_void_p).value)  # WM_SETTEXT.
            if self.win.text(edit['hwnd'], control=True) != str(self.install / EXE_NAME):
                raise RuntimeError('Owned fixture EXE field did not retain the exact path')
            self.event('set-owned-fixture-exe', window=form, control=edit, value=str(self.install / EXE_NAME))
            combo = self.control(form, 'reviewer', lambda row: row['class'] == 'ComboBox' or row['class'].startswith('WindowsForms10.COMBOBOX.'))
            if self.win.send(combo['hwnd'], 0x014E, 2) != 2 or self.win.send(combo['hwnd'], 0x0147) != 2:
                raise RuntimeError('Explicit employee role selection failed')
            self.event('select-employee-role', window=form, control=combo, selectedIndex=2)
            self.click(form, 'reviewer', lambda row: row['title'] == '开始核验并安装', 'begin-review', pid=reviewer)
            confirm = self.wait_window('负责人最终确认', 'reviewer', 600, pid=reviewer)
            body = self.body(confirm)
            if str(self.install) not in body or '员工' not in body:
                raise RuntimeError('Final approval dialog does not display this owned employee installation')
            self.event('read-final-confirmation', window=confirm, body=body)
            self.click(confirm, 'reviewer', lambda row: row['controlId'] == 6, 'confirm-reviewed-fixture-IDYES', pid=reviewer)
            shipping = self.wait_window('鑫金源珠宝完整升级', 'shipping', 420)
            shipping_pid = shipping['pid']
            if str(self.install) not in self.body(shipping):
                raise RuntimeError('Shipping role dialog does not name the owned fixture installation')
            self.click(shipping, 'shipping', lambda row: row['title'] == '这是员工电脑', 'confirm-shipping-employee', pid=shipping_pid)
            deadline = time.monotonic() + 900
            completion = None
            while time.monotonic() < deadline:
                self.snapshot()
                windows = self.win.top_windows(self.alive)
                errors = [window for window in windows if window['title'] in {'审定未完成', '升级未开始或未完成', '安装更新未完成', '已恢复'}]
                if errors:
                    self.event('owned-completion-error', windows=[{**window, 'body': self.body(window)} for window in errors])
                    raise RuntimeError('Installation did not reach a verified completion dialog')
                choices = [window for window in windows if window['pid'] == shipping_pid and window['title'] in {'完成', '已核验'}]
                if len(choices) > 1:
                    raise RuntimeError('Ambiguous completion dialogs')
                if choices:
                    completion = choices[0]
                    self.actor(completion, 'shipping', pid=shipping_pid)
                    text = self.body(completion)
                    if not any(value in text for value in ('完整程序资源已升级', '已核验完整升级完成记录')):
                        raise RuntimeError('Unexpected shipping completion message: ' + text)
                    self.event('read-shipping-completion', window=completion, body=text)
                    self.click(completion, 'shipping', lambda row: row['controlId'] == 1, 'acknowledge-shipping-completion-IDOK', pid=shipping_pid)
                    break
                if self.process.poll() is not None:
                    raise RuntimeError('Launcher exited without an observed verified completion dialog')
                time.sleep(0.7)
            if completion is None:
                raise RuntimeError('Timed out waiting for verified completion; no process was stopped')
            try:
                exit_code = self.process.wait(timeout=60)
            except subprocess.TimeoutExpired as error:
                raise RuntimeError('Launcher did not exit after completion; left running for Root') from error
            self.event('launcher-exited', exitCode=exit_code, completionObserved=True)
            if exit_code != 0:
                raise RuntimeError('Launcher exited with failure after its completion window')
            stdout.flush()
            stderr.flush()
            return {'completionObserved': True, 'launcherExitCode': exit_code, 'reviewerPid': reviewer,
                    'shippingPid': shipping_pid, 'reviewerStdoutReceiptObserved': False,
                    'receiptObservationReason': 'The unchanged outer launcher consumes the reviewer receipt internally; QA verifies the actual protected approval record separately.'}

    def normal_close_employee(self):
        # Cleanup is an observed best effort, never a reason to force-stop an app.
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline:
            self.snapshot()
            candidates = []
            for row in self.alive.values():
                if canonical(row.get('ExecutablePath') or '') != canonical(self.install / EXE_NAME):
                    continue
                args = self.win.arguments(row.get('CommandLine') or '')
                if len(args) == 2 and args[1] == '--employee-client':
                    self.assert_process(row['ProcessId'], 'employee', refresh=False)
                    candidates.append(row)
            if len(candidates) > 1:
                return {'requested': False, 'exited': False, 'reason': 'Multiple owned employee main processes; no close was sent'}
            if candidates:
                pid = candidates[0]['ProcessId']
                windows = [window for window in self.win.top_windows({pid})
                           if window['class'].startswith('Chrome_WidgetWin') and window['title']]
                if len(windows) == 1:
                    self.actor(windows[0], 'employee', pid=pid)
                    self.win.post(windows[0]['hwnd'], 0x0010)  # WM_CLOSE only.
                    self.event('request-owned-employee-normal-close', window=windows[0], process=self.alive[pid])
                    end = time.monotonic() + 25
                    while time.monotonic() < end:
                        self.snapshot()
                        if pid not in self.alive:
                            self.event('owned-employee-normal-exit-observed', pid=pid)
                            return {'requested': True, 'exited': True, 'pid': pid, 'forcedStop': False}
                        time.sleep(0.6)
                    return {'requested': True, 'exited': False, 'pid': pid, 'forcedStop': False,
                            'reason': 'WM_CLOSE did not finish; process left for Root VM management'}
            time.sleep(0.6)
        return {'requested': False, 'exited': False, 'forcedStop': False,
                'reason': 'No unique visible owned employee main window observed'}


def verify_actual_install(install, before):
    executable = sha_file(install / EXE_NAME, base=install)
    new_asar = sha_file(install / 'resources/app.asar', base=install)
    if executable['sha256'] != ENGINE_SHA or executable != before['engine']:
        raise RuntimeError('Original fixture EXE changed during installation')
    if new_asar['sha256'] != NEW_ASAR_SHA:
        raise RuntimeError('Actual installed ASAR is not the fixed complete target')
    marker_file = ordinary(install / 'xjy-install-activation.json', base=install)
    marker = json.loads(marker_file.read_text(encoding='utf-8-sig'))
    if (marker.get('role') != 'employee' or marker.get('programVersion') != '1.6.0'
            or canonical(marker.get('installationDir', '')) != canonical(install)
            or marker.get('product') != 'xjy-jewelry-offline'):
        raise RuntimeError('Actual installation activation is not bound to this employee fixture')
    status = json.loads(ordinary(install / '.xjy-initial-upgrade/recovery-status.json', base=install).read_text(encoding='utf-8-sig'))
    payload = json.loads(status['payload'])
    if (payload.get('phase') != 'committed' or payload.get('role') != 'employee'
            or canonical(payload.get('installationDir', '')) != canonical(install)):
        raise RuntimeError('Actual installation completion record is not committed for this fixture')
    transaction = payload.get('transactionId', '')
    if not re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}', transaction):
        raise RuntimeError('Unsafe or absent actual transaction identifier')
    old_backup = sha_file(install / '.xjy-initial-upgrade' / transaction / 'program-backup/resources/app.asar', base=install)
    if old_backup['sha256'] != OLD_ASAR_SHA:
        raise RuntimeError('Actual original ASAR backup does not match the admitted 1.5.0 fixture')
    approval = guest_approval_metadata()
    if approval.get('exists') is not True:
        raise RuntimeError('Actual protected approval record is missing')
    ordinary(Path(approval['directory']), directory=True)
    file_hash = sha_file(Path(approval['file']))
    record = approval['record']
    if (record.get('artifactSha256') != ARTIFACT_SHA or record.get('publisherPublicKeySha256') != PUBLIC_PIN
            or record.get('role') != 'employee' or record.get('osUser') != approval['osUser']
            or canonical(record.get('installationDir', '')) != canonical(install)):
        raise RuntimeError('Actual approval record has a different artifact/user/path/role binding')
    for name in ('directoryAcl', 'fileAcl'):
        if approval[name]['ownerAllowed'] is not True or approval[name]['unsafeAllowRules'] != 0:
            raise RuntimeError('Actual approval ACL did not preserve the protected identity policy')
    if approval['directoryAcl']['inheritanceProtected'] is not True:
        raise RuntimeError('Actual approval directory did not carry its protected DACL')
    return {'engineUnchanged': executable, 'installedAsar': new_asar, 'oldAsarBackup': old_backup,
            'activation': marker, 'completionStatus': payload, 'completionMacIndependentlyVerified': False,
            'approvalFile': file_hash, 'protectedApprovalRecord': record,
            'approvalDirectoryAcl': approval['directoryAcl'], 'approvalFileAcl': approval['fileAcl']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', default=str(BUNDLE))
    parser.add_argument('--install', default=str(INSTALL))
    parser.add_argument('--output', default=str(OUTPUT))
    args = parser.parse_args()
    context = actual_admission()
    bundle, install, output = Path(args.bundle), Path(args.install), Path(args.output)
    fixture = bundle.parent
    direct_output = (canonical(output.parent) == canonical(Path('C:/xjy-results'))
                     and output.name == fixture.name)
    retry_output = (canonical(output.parent) == canonical(Path('C:/xjy-results') / fixture.name)
                    and re.fullmatch(r'run[1-9][0-9]*', output.name) is not None)
    if (bundle.name != 'bundle' or install.name != 'original-install'
            or canonical(install.parent) != canonical(fixture)
            or canonical(fixture.parent) != canonical(R / 'runtime')
            or not re.fullmatch(r'oneclick-native-v[1-9][0-9]*', fixture.name)
            or not (direct_output or retry_output)):
        raise RuntimeError('Only a matched owned oneclick-native-vN fixture/output pair is accepted')
    ordinary(bundle, base=R / 'runtime', directory=True)
    ordinary(install, base=R / 'runtime', directory=True)
    ordinary(R / 'cache', base=R, directory=True)
    ordinary(output, base=Path('C:/xjy-results'), directory=True, missing=True)
    output.mkdir(exist_ok=True)
    ordinary(output, base=Path('C:/xjy-results'), directory=True)
    for name in ('actions.jsonl', 'launcher.stdout.log', 'launcher.stderr.log', 'probe-result.json'):
        if (output / name).exists():
            raise RuntimeError('Fresh QA artifact paths required; previous evidence was not overwritten')
    result = {'version': 1, 'purpose': 'actual-oneclick-native-fixture-qa', 'startedAt': utc_now(),
              'passed': False, 'actualContext': context, 'fictitiousOnly': True,
              'productionRead': False, 'productionWrite': False, 'realPrinterUsed': False,
              'forcedStops': 0, 'globalInputEvents': 0, 'bundle': str(bundle), 'install': str(install)}
    probe = None
    try:
        before = {'engine': sha_file(install / EXE_NAME, base=install),
                  'asar': sha_file(install / 'resources/app.asar', base=install)}
        if before['engine']['sha256'] != ENGINE_SHA or before['engine']['size'] != 246302720 or before['asar']['sha256'] != OLD_ASAR_SHA:
            raise RuntimeError('The actual owned old-engine/1.5.0-ASAR fixture was not admitted')
        approval_before = guest_approval_metadata()
        for policy in approval_before['executionPolicies']:
            if policy['scope'] in ('MachinePolicy', 'UserPolicy') and policy['policy'] != 'Undefined':
                raise RuntimeError('Managed execution policy cannot be bypassed by this QA helper')
        if approval_before['exists']:
            raise RuntimeError('This first-approval QA requires a fresh Guest approval record')
        result['before'] = before
        result['approvalWasAbsent'] = True
        result['executionPolicies'] = approval_before['executionPolicies']
        probe = Probe(context, output, bundle, install)
        result['gui'] = probe.run_gui()
        result['actualInstallation'] = verify_actual_install(install, before)
        result['passed'] = True
        probe.event('actual-installation-verified', installedAsarSha256=NEW_ASAR_SHA,
                    engineUnchanged=True, oldAsarBackupSha256=OLD_ASAR_SHA,
                    protectedApprovalRecordVerified=True, role='employee')
        try:
            result['employeeNormalClose'] = probe.normal_close_employee()
        except Exception as error:
            result['employeeNormalClose'] = {'requested': False, 'exited': False, 'forcedStop': False,
                                             'reason': str(error), 'leftForRoot': True}
    except Exception as error:
        result['passed'] = False
        result['error'] = str(error)
        result['traceback'] = traceback.format_exc()
    finally:
        if probe is not None:
            result['actions'] = probe.actions
            result['ownedProcessHistory'] = probe.known
            result['lastObservedAliveOwnedProcesses'] = list(probe.alive.values())
            probe.log.close()
        result['finishedAt'] = utc_now()
        with ordinary(output / 'probe-result.json', base=output, missing=True).open('x', encoding='utf-8', newline='\n') as stream:
            json.dump(result, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
    print(json.dumps({'passed': result['passed'], 'result': str(output / 'probe-result.json'),
                      'error': result.get('error')}, ensure_ascii=False))
    return 0 if result['passed'] else 1


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as failure:
        print(str(failure), file=sys.stderr)
        raise SystemExit(1)
