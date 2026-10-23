"""Guest-only native QA of Root's final Common/broker bundle in a fresh fixture.

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
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import time
import traceback
import zipfile

R = Path('C:/xjy-work/xjy-web-stage1')
PYTHON = Path('C:/Python314/python.exe')
POWERSHELL = Path('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe')
FIXTURE = R / 'runtime/oneclick-native-v7'
BUNDLE = FIXTURE / 'bundle'
INSTALL = FIXTURE / 'original-install'
OUTPUT = Path('C:/xjy-results/oneclick-native-v7')
EXE_NAME = '鑫金源珠宝报价.exe'
ENGINE_SHA = 'db3ad2066a55546f9b6737da3c7f011370e4856fb36888055b544d45653e4f40'
OLD_ASAR_SHA = 'c6f2b998a0b6dc65ea22a5027c7843918a692eedc53a813f9f5c83910d7a60fb'
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


def load_qa_fixture(config_file):
    """QA evidence pins only; none of these values is passed as product trust."""
    config_file = ordinary(config_file, base=FIXTURE)
    if config_file.stat().st_size > 65536:
        raise RuntimeError('Bounded explicit QA fixture JSON required')
    config = json.loads(config_file.read_text(encoding='utf-8-sig'))
    required = {'schemaVersion', 'purpose', 'bundleManifestFile', 'bundleManifestSha256',
                'deliveryZipFile', 'deliveryZipSha256', 'artifactSha256',
                'publisherPublicKeySha256', 'sourcePolicySha256', 'targetAsarSha256',
                'scriptSha256'}
    if (not isinstance(config, dict) or set(config) != required
            or config['schemaVersion'] != 1 or config['purpose'] != 'oneclick-native-qa-fixture'):
        raise RuntimeError('Explicit complete QA fixture schema required')
    for key in required - {'schemaVersion', 'purpose', 'bundleManifestFile', 'deliveryZipFile', 'scriptSha256'}:
        if not isinstance(config[key], str) or re.fullmatch(r'[a-f0-9]{64}', config[key]) is None:
            raise RuntimeError('Independent QA SHA256 missing: ' + key)
    for key in ('bundleManifestFile', 'deliveryZipFile'):
        name = config[key]
        if (not isinstance(name, str) or Path(name).name != name or not name
                or re.search(r'[\\/:\x00-\x1f]', name) or name in {'.', '..'}):
            raise RuntimeError('QA input must be one ordinary fixture file: ' + key)
    if (not isinstance(config['scriptSha256'], dict)
            or set(config['scriptSha256']) != {'launcher', 'reviewer', 'shipping'}
            or any(not isinstance(value, str) or re.fullmatch(r'[a-f0-9]{64}', value) is None
                   for value in config['scriptSha256'].values())):
        raise RuntimeError('All three independently pinned GUI script hashes required')
    return config, sha_file(config_file, base=FIXTURE)


def verify_bundle(config):
    manifest_file = ordinary(FIXTURE / config['bundleManifestFile'], base=FIXTURE)
    if sha_file(manifest_file, base=FIXTURE)['sha256'] != config['bundleManifestSha256']:
        raise RuntimeError('Final Root bundle manifest SHA256 differs')
    manifest = json.loads(manifest_file.read_text(encoding='utf-8-sig'))
    rows = manifest.get('files') if isinstance(manifest, dict) else None
    if not isinstance(rows, list) or len(rows) != 1028:
        raise RuntimeError('Exactly 1028 final bundle manifest rows required')
    expected, folded = {}, set()
    for row in rows:
        if (not isinstance(row, dict) or set(row) != {'path', 'size', 'sha256'}
                or not isinstance(row['path'], str) or not row['path']
                or any(not part or part in {'.', '..'} or re.search(r'[\\:\x00-\x1f]', part)
                       or re.search(r'[. ]$', part)
                       or re.match(r'^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)', part, re.I)
                       for part in row['path'].split('/'))
                or row['path'].casefold() in folded or type(row['size']) is not int or row['size'] < 0
                or not isinstance(row['sha256'], str) or re.fullmatch(r'[a-f0-9]{64}', row['sha256']) is None):
            raise RuntimeError('Unsafe or duplicate final bundle manifest row')
        expected[row['path']] = row
        folded.add(row['path'].casefold())
    seen, total = set(), 0
    stack = [ordinary(BUNDLE, base=FIXTURE, directory=True)]
    expected_dirs = set()
    for relative in expected:
        parts = relative.split('/')[:-1]
        while parts:
            expected_dirs.add('/'.join(parts))
            parts.pop()
    seen_dirs = set()
    while stack:
        directory = stack.pop()
        for item in directory.iterdir():
            info = item.lstat()
            if stat.S_ISDIR(info.st_mode):
                ordinary(item, base=BUNDLE, directory=True)
                relative = item.relative_to(BUNDLE).as_posix()
                if relative not in expected_dirs:
                    raise RuntimeError('Extra bundle directory: ' + relative)
                seen_dirs.add(relative)
                stack.append(item)
                continue
            ordinary(item, base=BUNDLE)
            relative = item.relative_to(BUNDLE).as_posix()
            row = expected.get(relative)
            if row is None or relative in seen:
                raise RuntimeError('Unexpected bundle file: ' + relative)
            actual = sha_file(item, base=BUNDLE)
            if actual['size'] != row['size'] or actual['sha256'] != row['sha256']:
                raise RuntimeError('Bundle file differs from independent Root manifest: ' + relative)
            seen.add(relative)
            total += actual['size']
    if seen != set(expected) or seen_dirs != expected_dirs:
        raise RuntimeError('Final bundle file/directory closure differs')
    delivery_file = ordinary(FIXTURE / config['deliveryZipFile'], base=FIXTURE)
    delivery_proof = sha_file(delivery_file, base=FIXTURE)
    if delivery_proof['sha256'] != config['deliveryZipSha256']:
        raise RuntimeError('Final delivery ZIP SHA differs')
    zip_seen = set()
    with zipfile.ZipFile(delivery_file, 'r') as archive:
        entries = archive.infolist()
        if len(entries) != 1028:
            raise RuntimeError('Final delivery ZIP must contain exactly 1028 file members')
        for entry in entries:
            row = expected.get(entry.filename)
            if (row is None or entry.filename in zip_seen or entry.is_dir()
                    or not entry.flag_bits & 0x800 or entry.flag_bits & 1
                    or entry.file_size != row['size']):
                raise RuntimeError('Final delivery ZIP member closure/encoding differs')
            digest, size = hashlib.sha256(), 0
            with archive.open(entry) as stream:
                while chunk := stream.read(4 * 1024 * 1024):
                    digest.update(chunk)
                    size += len(chunk)
            # zipfile checks each CRC32 when its actual member stream reaches EOF.
            if size != row['size'] or digest.hexdigest() != row['sha256']:
                raise RuntimeError('Final delivery ZIP member bytes differ: ' + entry.filename)
            zip_seen.add(entry.filename)
    if zip_seen != seen:
        raise RuntimeError('Final ZIP and extracted bundle differ')
    inner_zip = '安装组件/鑫金源珠宝1.6.0完整升级补丁.zip'
    target_asar = '安装组件/补丁文件/payload/resources/app.asar'
    for relative, digest in ((inner_zip, config['artifactSha256']), (target_asar, config['targetAsarSha256'])):
        if expected.get(relative, {}).get('sha256') != digest:
            raise RuntimeError('Final QA artifact pin differs from manifest: ' + relative)
    policy_file = ordinary(BUNDLE / '安装组件/补丁文件/source-policy-envelope.json', base=BUNDLE)
    policy = json.loads(policy_file.read_text(encoding='utf-8-sig'))
    if (not isinstance(policy.get('policy'), str)
            or hashlib.sha256(policy['policy'].encode('utf-8')).hexdigest() != config['sourcePolicySha256']):
        raise RuntimeError('Final independent source-policy SHA differs')
    return {'fileCount': len(seen), 'bytes': total, 'exactDirectories': len(seen_dirs),
            'allFilesSha256': True, 'allFilesSingleLink': True, 'noReparsePoints': True,
            'deliveryZip': delivery_proof, 'deliveryZipMembersSha256AndCrc32': True,
            'bundleManifest': sha_file(manifest_file, base=FIXTURE)}


def guest_approval_metadata(bundle, reviewer_sha):
    reviewer = ordinary(bundle / '安装组件/审定工具/Prepare-Initial-Approval.ps1', base=bundle)
    if sha_file(reviewer, base=bundle)['sha256'] != reviewer_sha:
        raise RuntimeError('Pinned reviewer source changed before Common metadata probe')
    quoted = str(reviewer).replace("'", "''")
    result = ps_json(r"""$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$source=[IO.File]::ReadAllText('__REVIEWER__',[Text.Encoding]::UTF8);$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors);if($errors.Count){throw 'Pinned reviewer parse failed'}
foreach($name in @('Get-FixedApprovalRoot','Test-TrustedWindowsRoot','Assert-AclPolicy')){
 $f=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true));if($f.Count -ne 1){throw ('Missing pinned data function '+$name)};. ([ScriptBlock]::Create($f[0].Extent.Text))
}
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$common=[Environment]::GetFolderPath([Environment+SpecialFolder]::CommonApplicationData)
$dir=Get-FixedApprovalRoot $common $sid;$file=Join-Path $dir 'initial-upgrade-approval.json'
function No-Reparse([string]$Name){$walk=$Name;while($walk){$i=Get-Item -LiteralPath $walk -Force;if(($i.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $i.LinkType){throw 'Guest Common approval reparse point refused'};$p=[IO.Directory]::GetParent($walk);if(!$p){break};$walk=$p.FullName}}
function AclProof([string]$Name,[bool]$Ancestor){
 No-Reparse $Name;$acl=Get-Acl -LiteralPath $Name;$owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value;$rules=@()
 foreach($r in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){$rules+=@{sid=$r.IdentityReference.Value;rights=$r.FileSystemRights;allow=($r.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow);inheritOnly=(($r.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0)}}
 Assert-AclPolicy $owner $rules $sid $Ancestor (Test-TrustedWindowsRoot $Name $Ancestor)
 return @{path=$Name;owner=$owner;ownerAllowed=$true;unsafeAllowRules=0;inheritanceProtected=$acl.AreAccessRulesProtected;ancestor=$Ancestor;rules=$rules}
}
$parents=@();$walk=$common
while($walk){$parents+=@(AclProof $walk $true);$p=[IO.Directory]::GetParent($walk);if(!$p){break};$walk=$p.FullName}
$exists=Test-Path -LiteralPath $file -PathType Leaf;$directoryAcl=$null;$fileAcl=$null
if(Test-Path -LiteralPath $dir){$directoryAcl=AclProof $dir $false}
if($exists){$fileAcl=AclProof $file $false}
$policies=@(Get-ExecutionPolicy -List | ForEach-Object {@{scope=[string]$_.Scope;policy=[string]$_.ExecutionPolicy}})
@{osUser=$sid;common=$common;directory=$dir;file=$file;exists=$exists;directoryAcl=$directoryAcl;fileAcl=$fileAcl;ancestorAcls=$parents;executionPolicies=$policies;legacyLocalProbed=$false}|ConvertTo-Json -Depth 12 -Compress
""".replace('__REVIEWER__', quoted))
    common, directory, file = Path(result['common']), Path(result['directory']), Path(result['file'])
    ordinary(common, directory=True)
    if (canonical(directory.parent) != canonical(common)
            or directory.name != '鑫金源珠宝初次升级审定-' + result['osUser']
            or canonical(file.parent) != canonical(directory) or file.name != 'initial-upgrade-approval.json'):
        raise RuntimeError('Actual Native Common/SID approval metadata path differs')
    result['record'] = None
    if result['exists']:
        ordinary(directory, directory=True)
        record_proof = sha_file(file)
        if record_proof['size'] > 8192:
            raise RuntimeError('Bounded actual Common approval record required')
        result['record'] = json.loads(ordinary(file).read_text(encoding='utf-8-sig'))
        if sha_file(file) != record_proof:
            raise RuntimeError('Common approval changed while reading actual metadata')
        result['recordFile'] = record_proof
    return result


class ProcessPin:
    def __init__(self, kernel, row):
        self.kernel, self.pid, self.created = kernel, row['ProcessId'], row['CreationTicks']
        self.row, self.native_created = dict(row), None
        self.handle = kernel.OpenProcess(0x1000 | 0x100000, False, self.pid)
        if not self.handle:
            raise RuntimeError('Cannot retain exact critical GUI process handle')
        try:
            self.check(active=True)
        except Exception:
            self.close()
            raise

    def check(self, *, active=False):
        creation, exited, kernel_time, user_time = W.FILETIME(), W.FILETIME(), W.FILETIME(), W.FILETIME()
        if (self.kernel.GetProcessId(self.handle) != self.pid
                or not self.kernel.GetProcessTimes(self.handle, C.byref(creation), C.byref(exited), C.byref(kernel_time), C.byref(user_time))):
            raise RuntimeError('Critical GUI process handle identity unavailable')
        ticks = (creation.dwLowDateTime | creation.dwHighDateTime << 32) + 504911232000000000
        if self.native_created is None:
            if not self.created <= ticks <= self.created + 9:
                raise RuntimeError('Native process creation differs from the observed CIM microsecond')
            self.native_created = ticks
        if self.native_created != ticks:
            raise RuntimeError('Retained native GUI process creation changed')
        code = W.DWORD()
        if not self.kernel.GetExitCodeProcess(self.handle, C.byref(code)):
            raise RuntimeError('Actual critical process exit status unavailable')
        if active:
            size, image = W.DWORD(32768), C.create_unicode_buffer(32768)
            if (not self.kernel.QueryFullProcessImageNameW(self.handle, 0, image, C.byref(size))
                    or canonical(image.value) != canonical(POWERSHELL)
                    or self.kernel.WaitForSingleObject(self.handle, 0) != 0x102):
                raise RuntimeError('Critical GUI handle is not the active fixed PowerShell image')
        return code.value

    def active(self):
        status = self.kernel.WaitForSingleObject(self.handle, 0)
        if status not in (0, 0x102):
            raise RuntimeError('Critical process signal status unavailable')
        self.check(active=status == 0x102)
        return status == 0x102

    def wait_exit(self, timeout=60):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.kernel.WaitForSingleObject(self.handle, 500) == 0:
                return self.check()
        raise RuntimeError('Critical process did not exit normally; left running for Root')

    def close(self):
        if self.handle:
            self.kernel.CloseHandle(self.handle)
            self.handle = None


class Probe:
    def __init__(self, context, output, config):
        self.context, self.output, self.config = context, output, config
        self.scripts = {'launcher': BUNDLE / '安装组件/Start-Install.ps1',
                        'reviewer': BUNDLE / '安装组件/审定工具/Prepare-Initial-Approval.ps1',
                        'shipping': BUNDLE / '安装组件/补丁文件/delivery-tools/Initial-Full-Upgrade.ps1'}
        self.script_hashes = config['scriptSha256']
        for name, script in self.scripts.items():
            if sha_file(script, base=BUNDLE)['sha256'] != self.script_hashes[name]:
                raise RuntimeError('Final independent GUI source pin differs: ' + name)
        self.win = Windows()
        kernel = self.win.kernel
        kernel.OpenProcess.argtypes, kernel.OpenProcess.restype = [W.DWORD, W.BOOL, W.DWORD], W.HANDLE
        kernel.GetProcessId.argtypes, kernel.GetProcessId.restype = [W.HANDLE], W.DWORD
        kernel.GetProcessTimes.argtypes = [W.HANDLE, C.POINTER(W.FILETIME), C.POINTER(W.FILETIME), C.POINTER(W.FILETIME), C.POINTER(W.FILETIME)]
        kernel.GetProcessTimes.restype = W.BOOL
        kernel.QueryFullProcessImageNameW.argtypes = [W.HANDLE, W.DWORD, W.LPWSTR, C.POINTER(W.DWORD)]
        kernel.QueryFullProcessImageNameW.restype = W.BOOL
        kernel.GetExitCodeProcess.argtypes, kernel.GetExitCodeProcess.restype = [W.HANDLE, C.POINTER(W.DWORD)], W.BOOL
        kernel.WaitForSingleObject.argtypes, kernel.WaitForSingleObject.restype = [W.HANDLE, W.DWORD], W.DWORD
        kernel.CloseHandle.argtypes, kernel.CloseHandle.restype = [W.HANDLE], W.BOOL
        self.pins, self.alive, self.process, self.actions = {}, {}, None, []
        self.observed_exits = {}
        self.log = ordinary(output / 'actions.jsonl', base=output, missing=True).open('x', encoding='utf-8', newline='\n')

    def event(self, action, **fields):
        row = {'at': utc_now(), 'action': action, **fields}
        self.actions.append(row)
        self.log.write(json.dumps(row, ensure_ascii=False) + '\n')
        self.log.flush()
        os.fsync(self.log.fileno())

    def expected_args(self, role):
        args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', str(self.scripts[role])]
        return args + ['-OneClick'] if role == 'reviewer' else args

    def script_identity(self, row, role):
        arguments = self.win.arguments(row.get('CommandLine') or '')
        parent = os.getpid() if role == 'launcher' else self.process.pid
        if (row.get('ParentProcessId') != parent
                or canonical(row.get('ExecutablePath') or '') != canonical(POWERSHELL)
                or len(arguments) != len(self.expected_args(role)) + 1
                or canonical(arguments[0]) != canonical(POWERSHELL)
                or arguments[1:] != self.expected_args(role)
                or sha_file(self.scripts[role], base=BUNDLE)['sha256'] != self.script_hashes[role]):
            raise RuntimeError('Critical GUI process parent/argv/source identity differs: ' + role)
        if role != 'launcher' and row['CreationTicks'] < self.pins['launcher'].created:
            raise RuntimeError('Critical child was created before this actual Root')

    def snapshot(self, *, first=False):
        # Short-lived inventory/review/broker workers never enter this query or
        # an enduring ownership history. Only retained critical GUI handles do.
        active_pids = []
        for role, pin in self.pins.items():
            if pin.active():
                active_pids.append(pin.pid)
            elif role not in self.observed_exits:
                self.observed_exits[role] = pin.check()
                self.event('critical-process-signaled', role=role, pid=pin.pid, exitCode=self.observed_exits[role])
        condition = 'ProcessId={0} OR ParentProcessId={0}'.format(self.process.pid)
        for pid in active_pids:
            if pid != self.process.pid:
                condition += ' OR ProcessId=' + str(pid)
        rows = ps_json("$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);"
                       "$rows=@(Get-CimInstance Win32_Process -Filter '" + condition + "'|ForEach-Object {"
                       "@{ProcessId=[int]$_.ProcessId;ParentProcessId=[int]$_.ParentProcessId;"
                       "CreationTicks=$_.CreationDate.ToUniversalTime().Ticks;ExecutablePath=$_.ExecutablePath;"
                       "CommandLine=$_.CommandLine;Name=$_.Name}});@{rows=$rows}|ConvertTo-Json -Depth 5 -Compress")['rows']
        if first:
            roots = [row for row in rows if row['ProcessId'] == self.process.pid]
            if len(roots) != 1:
                raise RuntimeError('New Root cannot be independently identified')
            self.script_identity(roots[0], 'launcher')
            self.pins['launcher'] = ProcessPin(self.win.kernel, roots[0])
        self.alive = {}
        for role, pin in list(self.pins.items()):
            if not pin.active():
                continue
            current = [row for row in rows if row['ProcessId'] == pin.pid]
            if len(current) != 1 or current[0]['CreationTicks'] != pin.created:
                # A process that signaled while CIM was running is retired, not
                # confused with a subsequently reused numeric PID.
                if not pin.active():
                    continue
                raise RuntimeError('Current critical handle and CIM identity disagree')
            self.script_identity(current[0], role)
            pin.check(active=True)
            self.alive[pin.pid] = current[0]
        for role in ('reviewer', 'shipping'):
            if role in self.pins:
                continue
            candidates = []
            for row in rows:
                if row.get('ParentProcessId') != self.process.pid:
                    continue
                arguments = self.win.arguments(row.get('CommandLine') or '')
                if len(arguments) > 1 and arguments[1:] == self.expected_args(role):
                    self.script_identity(row, role)
                    candidates.append(row)
            if len(candidates) > 1:
                raise RuntimeError('Multiple current exact GUI children: ' + role)
            if candidates:
                pin = ProcessPin(self.win.kernel, candidates[0])
                self.pins[role] = pin
                self.alive[pin.pid] = candidates[0]
                self.event('critical-GUI-handle-pinned', role=role, process=candidates[0],
                           nativeCreationTicks=pin.native_created, historicalLeafPidsTracked=0)
        return self.alive

    def actor(self, window, role, *, pid=None):
        self.snapshot()
        root, pin = self.pins.get('launcher'), self.pins.get(role)
        if root is None or pin is None or not root.active() or not pin.active():
            raise RuntimeError('Actual Root and critical GUI actor must remain active')
        row = self.alive.get(pin.pid)
        if row is None or window['pid'] != pin.pid or pid is not None and pin.pid != pid:
            raise RuntimeError('Window is not owned by the pinned current GUI actor')
        self.script_identity(row, role)
        if self.win.pid(window['hwnd']) != pin.pid or self.win.text(window['hwnd']) != window['title']:
            raise RuntimeError('Owned HWND/PID/title changed before action')
        pin.check(active=True)
        return row

    def control(self, window, role, predicate, *, pid=None):
        self.actor(window, role, pid=pid)
        choices = [row for row in self.win.children(window['hwnd'], window['pid']) if predicate(row)]
        if len(choices) != 1 or not self.win.user.IsChild(window['hwnd'], choices[0]['hwnd']):
            raise RuntimeError('One visible owned child control required')
        self.actor(window, role, pid=pid)
        current = self.win.row(choices[0]['hwnd'], control=True)
        if (any(current[key] != choices[0][key] for key in ('pid', 'title', 'class', 'controlId'))
                or current['pid'] != window['pid']):
            raise RuntimeError('Owned control identity changed immediately before action')
        return current

    def click(self, window, role, predicate, action, *, pid=None):
        control = self.control(window, role, predicate, pid=pid)
        self.win.post(control['hwnd'], 0x00F5)
        self.event(action, window=window, control=control)

    def body(self, window):
        return '\n'.join(row['title'] for row in self.win.children(window['hwnd'], window['pid'])
                         if row['title'] and 'STATIC' in row['class'].upper())

    def wait_window(self, titles, role, timeout, *, pid=None):
        titles = {titles} if isinstance(titles, str) else set(titles)
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            self.snapshot()
            windows = self.win.top_windows(self.alive)
            for window in windows:
                if window['title'] in {'审定未完成', '升级未开始或未完成', '安装更新未完成', '已恢复'}:
                    self.event('owned-error-dialog', window=window, body=self.body(window))
                    raise RuntimeError('Actual owned error/recovery dialog observed')
            pin = self.pins.get(role)
            matches = [window for window in windows if pin and window['pid'] == pin.pid and window['title'] in titles]
            if len(matches) > 1:
                raise RuntimeError('Ambiguous owned GUI dialog')
            if matches:
                self.actor(matches[0], role, pid=pid)
                return matches[0]
            if self.process.poll() is not None:
                raise RuntimeError('Actual Root exited before expected GUI dialog')
            time.sleep(0.6)
        self.event('dialog-timeout', expectedTitles=sorted(titles), currentCriticalProcesses=list(self.alive.values()))
        raise RuntimeError('Actual GUI deadline exceeded; no process was stopped')

    def run_gui(self):
        environment = dict(os.environ)
        for key in list(environment):
            if key.startswith('XJY_') or key in ('NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE'):
                environment.pop(key, None)
        environment.update({'SystemRoot': 'C:\\Windows', 'WINDIR': 'C:\\Windows', 'SystemDrive': 'C:',
                            'PATHEXT': '.EXE', 'TEMP': str(R / 'cache'), 'TMP': str(R / 'cache'),
                            'PSModulePath': str(POWERSHELL.parent / 'Modules')})
        with ordinary(self.output / 'launcher.stdout.log', base=self.output, missing=True).open('xb') as stdout, \
                ordinary(self.output / 'launcher.stderr.log', base=self.output, missing=True).open('xb') as stderr:
            self.process = subprocess.Popen([str(POWERSHELL), *self.expected_args('launcher')], cwd=BUNDLE,
                                            env=environment, stdin=subprocess.DEVNULL, stdout=stdout,
                                            stderr=stderr, creationflags=NO_WINDOW)
            self.snapshot(first=True)
            self.event('actual-Root-started', process=self.pins['launcher'].row,
                       nativeCreationTicks=self.pins['launcher'].native_created, scripts=self.script_hashes)
            form = self.wait_window('鑫金源珠宝一键完整安装', 'reviewer', 180)
            reviewer_pid = form['pid']
            edit = self.control(form, 'reviewer', lambda row: row['class'] == 'Edit' or row['class'].startswith('WindowsForms10.EDIT.'))
            buffer = C.create_unicode_buffer(str(INSTALL / EXE_NAME))
            self.win.send(edit['hwnd'], 0x000C, 0, C.cast(buffer, C.c_void_p).value)
            if self.win.text(edit['hwnd'], control=True) != str(INSTALL / EXE_NAME):
                raise RuntimeError('Actual fixture EXE field did not retain its exact path')
            self.event('set-owned-fixture-exe', window=form, control=edit, value=str(INSTALL / EXE_NAME))
            combo = self.control(form, 'reviewer', lambda row: row['class'] == 'ComboBox' or row['class'].startswith('WindowsForms10.COMBOBOX.'))
            if self.win.send(combo['hwnd'], 0x014E, 2) != 2 or self.win.send(combo['hwnd'], 0x0147) != 2:
                raise RuntimeError('Actual explicit employee role selection failed')
            self.event('explicit-employee-role-selected', window=form, control=combo)
            self.click(form, 'reviewer', lambda row: row['title'] == '开始核验并安装', 'begin-review', pid=reviewer_pid)
            confirm = self.wait_window('负责人最终确认', 'reviewer', 600, pid=reviewer_pid)
            body = self.body(confirm)
            if str(INSTALL) not in body or '员工' not in body:
                raise RuntimeError('Actual final confirmation does not bind this employee fixture')
            self.event('read-actual-final-confirmation', window=confirm, body=body)
            self.click(confirm, 'reviewer', lambda row: row['controlId'] == 6, 'confirm-reviewed-fixture-IDYES', pid=reviewer_pid)
            shipping = self.wait_window('鑫金源珠宝完整升级', 'shipping', 420)
            if self.pins['reviewer'].wait_exit(30) != 0:
                raise RuntimeError('Actual reviewer did not exit zero before shipping')
            approval_written = guest_approval_metadata(BUNDLE, self.script_hashes['reviewer'])
            validate_approval(approval_written, self.config)
            self.event('actual-protected-Common-approval-written', record=approval_written['record'],
                       file=approval_written['recordFile'], reviewerExited=True)
            if str(INSTALL) not in self.body(shipping):
                raise RuntimeError('Actual shipping role dialog does not bind the fixture path')
            self.click(shipping, 'shipping', lambda row: row['title'] == '这是员工电脑', 'explicit-shipping-employee-confirmed', pid=shipping['pid'])
            completion = self.wait_window({'完成', '已核验'}, 'shipping', 900, pid=shipping['pid'])
            body = self.body(completion)
            if completion['class'] != '#32770' or not any(value in body for value in ('完整程序资源已升级', '已核验完整升级完成记录')):
                raise RuntimeError('Actual unique shipping completion MessageBox/body differs')
            self.event('read-actual-shipping-completion', window=completion, body=body)
            self.actor(completion, 'shipping', pid=shipping['pid'])
            self.win.post(completion['hwnd'], 0x0010)
            self.event('dismiss-only-owned-completion-MessageBox-WM_CLOSE', window=completion)
            shipping_exit = self.pins['shipping'].wait_exit(60)
            root_exit = self.pins['launcher'].wait_exit(60)
            if root_exit != 0 or shipping_exit != 0 or self.process.wait(timeout=5) != 0:
                raise RuntimeError('Actual retained Root/shipping handles did not both exit zero')
            self.event('actual-critical-exits-observed', rootExitCode=root_exit, shippingExitCode=shipping_exit,
                       reviewerExitCode=self.pins['reviewer'].check(), exitCodesFromRetainedNativeHandles=True)
            stdout.flush()
            stderr.flush()
            return {'completionObserved': True, 'launcherExitCode': root_exit, 'shippingExitCode': shipping_exit,
                    'reviewerExitCode': self.pins['reviewer'].check(), 'exitCodesFromRetainedNativeHandles': True,
                    'criticalProcesses': {role: {'cim': pin.row, 'nativeCreationTicks': pin.native_created}
                                          for role, pin in self.pins.items()},
                    'approvalFileBeforeShipping': approval_written['recordFile'],
                    'reviewerStdoutReceiptObserved': False,
                    'receiptObservationReason': 'The unchanged product outer launcher consumes the actual reviewer receipt; QA checks the protected Common record independently.'}

    def close(self):
        for pin in self.pins.values():
            pin.close()
        self.log.close()


def validate_approval(approval, config):
    record = approval.get('record') or {}
    if (approval.get('exists') is not True or record.get('artifactSha256') != config['artifactSha256']
            or record.get('publisherPublicKeySha256') != config['publisherPublicKeySha256']
            or record.get('sourcePolicySha256') != config['sourcePolicySha256']
            or record.get('role') != 'employee' or record.get('osUser') != approval['osUser']
            or canonical(record.get('installationDir', '')) != canonical(INSTALL)):
        raise RuntimeError('Actual Common approval artifact/publisher/source-policy/SID/role/path differs')
    for key in ('directoryAcl', 'fileAcl'):
        if approval[key]['ownerAllowed'] is not True or approval[key]['unsafeAllowRules'] != 0:
            raise RuntimeError('Actual Common approval ACL protection is unsafe')
    if approval['directoryAcl']['inheritanceProtected'] is not True:
        raise RuntimeError('Actual Common SID approval leaf lacks its protected DACL')


def verify_actual_install(config, before):
    executable = sha_file(INSTALL / EXE_NAME, base=INSTALL)
    target = sha_file(INSTALL / 'resources/app.asar', base=INSTALL)
    if executable != before['engine'] or executable['sha256'] != ENGINE_SHA:
        raise RuntimeError('Actual admitted original EXE changed')
    if target['sha256'] != config['targetAsarSha256']:
        raise RuntimeError('Actual installed ASAR differs from the final independent QA pin')
    marker = json.loads(ordinary(INSTALL / 'xjy-install-activation.json', base=INSTALL).read_text(encoding='utf-8-sig'))
    if (marker.get('role') != 'employee' or marker.get('programVersion') != '1.6.0'
            or marker.get('product') != 'xjy-jewelry-offline'
            or canonical(marker.get('installationDir', '')) != canonical(INSTALL)):
        raise RuntimeError('Actual employee activation path/version/product differs')
    status = json.loads(ordinary(INSTALL / '.xjy-initial-upgrade/recovery-status.json', base=INSTALL).read_text(encoding='utf-8-sig'))
    completion = json.loads(status['payload'])
    if (completion.get('phase') != 'committed' or completion.get('role') != 'employee'
            or completion.get('targetVersion') != '1.6.0'
            or canonical(completion.get('installationDir', '')) != canonical(INSTALL)):
        raise RuntimeError('Actual employee completion record is not committed for this fixture')
    transaction = completion.get('transactionId', '')
    if re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}', transaction) is None:
        raise RuntimeError('Actual transaction UUID is unsafe or absent')
    backup = sha_file(INSTALL / '.xjy-initial-upgrade' / transaction / 'program-backup/resources/app.asar', base=INSTALL)
    if backup['sha256'] != OLD_ASAR_SHA:
        raise RuntimeError('Actual original ASAR backup differs from admitted 1.5.0 bytes')
    approval = guest_approval_metadata(BUNDLE, config['scriptSha256']['reviewer'])
    validate_approval(approval, config)
    return {'engineUnchanged': executable, 'installedAsar': target, 'oldAsarBackup': backup,
            'activation': marker, 'completionStatus': completion, 'completionMacIndependentlyVerified': False,
            'approvalFile': approval['recordFile'], 'protectedApprovalRecord': approval['record'],
            'approvalDirectoryAcl': approval['directoryAcl'], 'approvalFileAcl': approval['fileAcl'],
            'approvalAncestorAcls': approval['ancestorAcls'], 'legacyLocalProbed': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--qa-config', default=str(FIXTURE / 'qa-fixture.json'),
                        help='QA-only independent final pins; never passed as product authority')
    parser.add_argument('--output', default=str(OUTPUT))
    args = parser.parse_args()
    context = actual_admission()
    ordinary(FIXTURE, base=R / 'runtime', directory=True)
    ordinary(BUNDLE, base=FIXTURE, directory=True)
    ordinary(INSTALL, base=FIXTURE, directory=True)
    ordinary(R / 'cache', base=R, directory=True)
    output = Path(args.output)
    allowed_output = (canonical(output) == canonical(OUTPUT)
                      or canonical(output.parent) == canonical(OUTPUT)
                      and re.fullmatch(r'run[1-9][0-9]*', output.name) is not None)
    if not allowed_output:
        raise RuntimeError('Only the fixed v6 QA output or its fresh runN child is permitted')
    ordinary(output, base=Path('C:/xjy-results'), directory=True, missing=True)
    output.mkdir(exist_ok=True)
    for name in ('actions.jsonl', 'launcher.stdout.log', 'launcher.stderr.log', 'probe-result.json'):
        if (output / name).exists():
            raise RuntimeError('Fresh v6 QA outputs required; prior evidence retained')
    result = {'version': 1, 'purpose': 'actual-common-broker-oneclick-native-v7-qa', 'startedAt': utc_now(),
              'passed': False, 'actualContext': context, 'fictitiousOnly': True, 'productionRead': False,
              'productionWrite': False, 'realPrinterUsed': False, 'globalInputEvents': 0, 'forcedStops': 0,
              'historicalLeafPidsTracked': 0, 'generalOwnedProcessHelperModified': False,
              'bundle': str(BUNDLE), 'install': str(INSTALL), 'legacyLocalProbed': False,
              'employeeLifecycleVerified': False, 'employeeLifecycleLeftForRoot': True,
              'brokerExitIndependentlyObserved': False}
    probe = None
    try:
        config, config_proof = load_qa_fixture(Path(args.qa_config))
        result['qaConfiguration'] = {'file': config_proof, 'pins': config, 'productTrustOverrides': False}
        result['finalBundleVerification'] = verify_bundle(config)
        before = {'engine': sha_file(INSTALL / EXE_NAME, base=INSTALL),
                  'asar': sha_file(INSTALL / 'resources/app.asar', base=INSTALL)}
        if (before['engine']['sha256'] != ENGINE_SHA or before['engine']['size'] != 246302720
                or before['asar']['sha256'] != OLD_ASAR_SHA
                or (INSTALL / '.xjy-initial-upgrade').exists()
                or (INSTALL / 'xjy-install-activation.json').exists()):
            raise RuntimeError('Fresh untouched admitted 1.5.0 QA fixture required')
        approval = guest_approval_metadata(BUNDLE, config['scriptSha256']['reviewer'])
        if approval['exists']:
            raise RuntimeError('Fresh Guest Common approval record required; no record is removed or migrated')
        for policy in approval['executionPolicies']:
            if policy['scope'] in {'MachinePolicy', 'UserPolicy'} and policy['policy'] != 'Undefined':
                raise RuntimeError('Managed execution policy cannot be bypassed by QA')
        result['before'], result['approvalBefore'] = before, approval
        probe = Probe(context, output, config)
        result['gui'] = probe.run_gui()
        result['actualInstallation'] = verify_actual_install(config, before)
        if result['actualInstallation']['approvalFile'] != result['gui']['approvalFileBeforeShipping']:
            raise RuntimeError('Actual approval record changed during shipping installation')
        result['passed'] = True
        probe.event('actual-installed-bytes-backup-committed-status-and-Common-approval-verified',
                    targetAsarSha256=config['targetAsarSha256'], engineUnchanged=True,
                    oldAsarBackupSha256=OLD_ASAR_SHA, protectedApprovalRecordVerified=True, role='employee')
    except Exception as error:
        result['error'], result['traceback'] = str(error), traceback.format_exc()
        result['passed'] = False
    finally:
        if probe is not None:
            result['actions'] = probe.actions
            result['currentCriticalProcesses'] = list(probe.alive.values())
            result['observedCriticalExits'] = probe.observed_exits
            probe.close()
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


