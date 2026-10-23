"""Start only owned test scripts with a Windows access-restricted token.

No accounts, registry, services, tasks, firewall or production ACL are changed.
Production access checks inspect security descriptors only; they never open DBs.
"""
import argparse
import atexit
import base64
import ctypes as C
from ctypes import wintypes as W
import json
import importlib.util
import os
import re
import stat
from pathlib import Path
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parent.parent
ROOT_IDENTITY = ROOT.stat()
def assert_owned(value):
    candidate = Path(os.path.abspath(value))
    if not candidate.is_relative_to(ROOT):
        raise RuntimeError('ISOLATION: launcher target outside new root')
    if ROOT.stat().st_ino != ROOT_IDENTITY.st_ino or ROOT.stat().st_dev != ROOT_IDENTITY.st_dev:
        raise RuntimeError('ISOLATION: launcher root identity changed')
    for parent in (candidate, *candidate.parents):
        try:
            info = parent.lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(info.st_mode) or os.path.isjunction(parent) or stat.S_ISREG(info.st_mode) and info.st_nlink > 1:
            raise RuntimeError('ISOLATION: launcher links rejected before mutation')
    if not candidate.resolve().is_relative_to(ROOT):
        raise RuntimeError('ISOLATION: launcher physical escape')
    return candidate
def validate_identity(value):
    if not isinstance(value, dict) or set(value) != {'namespace', 'sid'} or not re.fullmatch(r'S-1-5-21-\d{10}-\d{10}-\d{10}-9013', str(value.get('sid', ''))):
        raise RuntimeError('ISOLATION: invalid namespace identity')
    try:
        if str(uuid.UUID(value['namespace'])) != value['namespace']:
            raise ValueError()
    except (ValueError, TypeError, KeyError):
        raise RuntimeError('ISOLATION: invalid namespace UUID')
    return value
def clean_environment():
    inherited = {k.upper(): v for k, v in os.environ.items()}
    return {name: inherited[name.upper()] for name in ('SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT') if name.upper() in inherited} | {'PATH': str(Path(inherited['SYSTEMROOT']) / 'System32')}

def require_production_denial(checks):
    if not checks or any(not isinstance(row, dict) or
            type(row.get('readAllowed')) is not bool or
            type(row.get('writeAllowed')) is not bool for row in checks):
        raise RuntimeError('ISOLATION: complete production access proof is required; no test process started')
    if any(row['writeAllowed'] for row in checks):
        raise RuntimeError('ISOLATION: token retains write permission on a formal path; no test process started')
    if any(row['readAllowed'] for row in checks):
        raise RuntimeError('ISOLATION: token retains read permission on a formal path; no test process started')

def scan_formal_objects(roots, required_databases):
    def scan_failed(error):
        raise RuntimeError('ISOLATION: formal scan failed; incomplete proof refused') from error
    found = []
    for base in roots:
        if not base.is_dir() or base.is_symlink() or os.path.isjunction(base):
            raise RuntimeError('ISOLATION: formal dependency boundary unavailable')
        found.append(base)
        for parent, dirs, files in os.walk(base, followlinks=False, onerror=scan_failed):
            for name in dirs + files:
                item = Path(parent) / name
                if item.is_symlink() or os.path.isjunction(item):
                    raise RuntimeError('ISOLATION: formal reparse target requires separate assessment')
                found.append(item)
    observed = {os.path.normcase(os.path.abspath(p)) for p in found}
    if not required_databases or any(not p.is_file() or
            os.path.normcase(os.path.abspath(p)) not in observed for p in required_databases):
        raise RuntimeError('ISOLATION: required production database missing from proof; no test process started')
    return found
if os.name != 'nt':
    raise RuntimeError('This Windows isolation launcher cannot fall back to unrestricted execution')
kernel = C.WinDLL('kernel32', use_last_error=True)
advapi = C.WinDLL('advapi32', use_last_error=True)
class SIDATTR(C.Structure):
    _fields_ = [('Sid', C.c_void_p), ('Attributes', W.DWORD)]
class GENERIC_MAPPING(C.Structure):
    _fields_ = [('GenericRead', W.DWORD), ('GenericWrite', W.DWORD), ('GenericExecute', W.DWORD), ('GenericAll', W.DWORD)]
class DEFAULT_DACL(C.Structure):
    _fields_ = [('DefaultDacl', C.c_void_p)]
class STARTUPINFO(C.Structure):
    _fields_ = [('cb', W.DWORD), ('lpReserved', W.LPWSTR), ('lpDesktop', W.LPWSTR), ('lpTitle', W.LPWSTR), ('dwX', W.DWORD), ('dwY', W.DWORD), ('dwXSize', W.DWORD), ('dwYSize', W.DWORD), ('dwXCountChars', W.DWORD), ('dwYCountChars', W.DWORD), ('dwFillAttribute', W.DWORD), ('dwFlags', W.DWORD), ('wShowWindow', W.WORD), ('cbReserved2', W.WORD), ('lpReserved2', C.c_void_p), ('hStdInput', W.HANDLE), ('hStdOutput', W.HANDLE), ('hStdError', W.HANDLE)]
class PROCESSINFO(C.Structure):
    _fields_ = [('hProcess', W.HANDLE), ('hThread', W.HANDLE), ('dwProcessId', W.DWORD), ('dwThreadId', W.DWORD)]
class SECURITY_ATTRIBUTES(C.Structure):
    _fields_ = [('nLength', W.DWORD), ('lpSecurityDescriptor', C.c_void_p), ('bInheritHandle', W.BOOL)]
class JOB_BASIC(C.Structure):
    _fields_ = [('PerProcessUserTimeLimit', C.c_longlong), ('PerJobUserTimeLimit', C.c_longlong), ('LimitFlags', W.DWORD), ('MinimumWorkingSetSize', C.c_size_t), ('MaximumWorkingSetSize', C.c_size_t), ('ActiveProcessLimit', W.DWORD), ('Affinity', C.c_size_t), ('PriorityClass', W.DWORD), ('SchedulingClass', W.DWORD)]
class IO_COUNTERS(C.Structure):
    _fields_ = [(name, C.c_ulonglong) for name in ('ReadOperationCount', 'WriteOperationCount', 'OtherOperationCount', 'ReadTransferCount', 'WriteTransferCount', 'OtherTransferCount')]
class JOB_EXTENDED(C.Structure):
    _fields_ = [('BasicLimitInformation', JOB_BASIC), ('IoInfo', IO_COUNTERS), ('ProcessMemoryLimit', C.c_size_t), ('JobMemoryLimit', C.c_size_t), ('PeakProcessMemoryUsed', C.c_size_t), ('PeakJobMemoryUsed', C.c_size_t)]
user32 = C.WinDLL('user32', use_last_error=True)
user32.GetProcessWindowStation.restype = W.HANDLE
user32.SetProcessWindowStation.argtypes = [W.HANDLE]
user32.CreateWindowStationW.argtypes = [W.LPCWSTR, W.DWORD, W.DWORD, C.POINTER(SECURITY_ATTRIBUTES)]
user32.CreateWindowStationW.restype = W.HANDLE
user32.CreateDesktopW.argtypes = [W.LPCWSTR, W.LPCWSTR, C.c_void_p, W.DWORD, W.DWORD, C.POINTER(SECURITY_ATTRIBUTES)]
user32.CreateDesktopW.restype = W.HANDLE
user32.CloseWindowStation.argtypes = [W.HANDLE]
user32.CloseDesktop.argtypes = [W.HANDLE]
kernel.GetCurrentProcess.restype = W.HANDLE
kernel.CloseHandle.argtypes = [W.HANDLE]
kernel.CreateMutexW.argtypes = [C.c_void_p, W.BOOL, W.LPCWSTR]
kernel.CreateMutexW.restype = W.HANDLE
kernel.ReleaseMutex.argtypes = [W.HANDLE]
kernel.WaitForSingleObject.argtypes = [W.HANDLE, W.DWORD]
kernel.GetExitCodeProcess.argtypes = [W.HANDLE, C.POINTER(W.DWORD)]
kernel.CreateJobObjectW.argtypes = [C.c_void_p, W.LPCWSTR]
kernel.CreateJobObjectW.restype = W.HANDLE
kernel.SetInformationJobObject.argtypes = [W.HANDLE, C.c_int, C.c_void_p, W.DWORD]
kernel.AssignProcessToJobObject.argtypes = [W.HANDLE, W.HANDLE]
kernel.ResumeThread.argtypes = [W.HANDLE]
kernel.TerminateProcess.argtypes = [W.HANDLE, W.UINT]
advapi.OpenProcessToken.argtypes = [W.HANDLE, W.DWORD, C.POINTER(W.HANDLE)]
advapi.ConvertStringSidToSidW.argtypes = [W.LPCWSTR, C.POINTER(C.c_void_p)]
advapi.CreateRestrictedToken.argtypes = [W.HANDLE, W.DWORD, W.DWORD, C.c_void_p, W.DWORD, C.c_void_p, W.DWORD, C.POINTER(SIDATTR), C.POINTER(W.HANDLE)]
advapi.DuplicateToken.argtypes = [W.HANDLE, C.c_int, C.POINTER(W.HANDLE)]
advapi.GetTokenInformation.argtypes = [W.HANDLE, C.c_int, C.c_void_p, W.DWORD, C.POINTER(W.DWORD)]
advapi.ConvertSidToStringSidW.argtypes = [C.c_void_p, C.POINTER(W.LPWSTR)]
advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW.argtypes = [W.LPCWSTR, W.DWORD, C.POINTER(C.c_void_p), C.c_void_p]
advapi.GetSecurityDescriptorDacl.argtypes = [C.c_void_p, C.POINTER(W.BOOL), C.POINTER(C.c_void_p), C.POINTER(W.BOOL)]
advapi.SetTokenInformation.argtypes = [W.HANDLE, C.c_int, C.c_void_p, W.DWORD]
advapi.GetNamedSecurityInfoW.argtypes = [W.LPWSTR, C.c_int, W.DWORD, C.c_void_p, C.c_void_p, C.c_void_p, C.c_void_p, C.POINTER(C.c_void_p)]
advapi.AccessCheck.argtypes = [C.c_void_p, W.HANDLE, W.DWORD, C.POINTER(GENERIC_MAPPING), C.c_void_p, C.POINTER(W.DWORD), C.POINTER(W.DWORD), C.POINTER(W.BOOL)]
advapi.CreateProcessAsUserW.argtypes = [W.HANDLE, W.LPCWSTR, W.LPWSTR, C.c_void_p, C.c_void_p, W.BOOL, W.DWORD, C.c_void_p, W.LPCWSTR, C.POINTER(STARTUPINFO), C.POINTER(PROCESSINFO)]
kernel.LocalFree.argtypes = [C.c_void_p]
def checked(result, label):
    if not result:
        raise OSError(C.get_last_error(), label)
    return result
def sid(value):
    output = C.c_void_p()
    checked(advapi.ConvertStringSidToSidW(value, C.byref(output)), 'ConvertStringSidToSid')
    return output
def owner_sid(token):
    size = W.DWORD()
    advapi.GetTokenInformation(token, 1, None, 0, C.byref(size))
    buffer = C.create_string_buffer(size.value)
    checked(advapi.GetTokenInformation(token, 1, buffer, size.value, C.byref(size)), 'TokenUser')
    value = C.cast(buffer, C.POINTER(SIDATTR)).contents.Sid
    text = W.LPWSTR()
    checked(advapi.ConvertSidToStringSidW(value, C.byref(text)), 'ConvertSidToStringSid')
    try:
        return text.value
    finally:
        kernel.LocalFree(C.cast(text, C.c_void_p))
def allowed_rights(token, target, rights):
    sd = C.c_void_p()
    result = advapi.GetNamedSecurityInfoW(str(target), 1, 7, None, None, None, None, C.byref(sd))
    if result:
        raise OSError(result, 'security descriptor unavailable; startup refused')
    impersonation = W.HANDLE()
    checked(advapi.DuplicateToken(token, 2, C.byref(impersonation)), 'DuplicateToken')
    try:
        mapping = GENERIC_MAPPING(0x120089, 0x120116, 0x1200A0, 0x1F01FF)
        allowed = []
        for right in rights:
            privileges = C.create_string_buffer(8192)
            length = W.DWORD(len(privileges))
            granted = W.DWORD()
            status = W.BOOL()
            checked(advapi.AccessCheck(sd, impersonation, right, C.byref(mapping), privileges, C.byref(length), C.byref(granted), C.byref(status)), 'AccessCheck')
            if status.value:
                allowed.append(right)
        return allowed
    finally:
        kernel.CloseHandle(impersonation)
        kernel.LocalFree(sd)
WRITE_RIGHTS = (0x2, 0x4, 0x10, 0x100, 0x10000, 0x40000, 0x80000)
def allowed_write(token, target):
    return bool(allowed_rights(token, target, WRITE_RIGHTS + ((0x40,) if Path(target).is_dir() else ())))
def lock_namespace(namespace):
    handle = checked(kernel.CreateMutexW(None, False, 'Global\\xjy_stage1_' + namespace), 'Create namespace mutex')
    state = kernel.WaitForSingleObject(handle, 0)
    if state not in (0, 0x80):
        kernel.CloseHandle(handle)
        raise RuntimeError('ISOLATION: another host owns this namespace; no database or configuration initialized')
    def release():
        kernel.ReleaseMutex(handle)
        kernel.CloseHandle(handle)
    atexit.register(release)
    return handle

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--script', default='stage1/token-canary.cjs')
    parser.add_argument('--check-only', action='store_true')
    parser.add_argument('--sandbox-guest', action='store_true')
    parser.add_argument('--mode', choices=['smoke', 'serve', 'finance-test', 'backup-test', 'daily-test', 'lan-test', 'numbers-test', 'collaboration-test', 'customers-test', 'restore-test', 'security-test', 'export-test', 'erp-test', 'erp-reset-fixture'], default='smoke')
    args = parser.parse_args()
    permitted = {'stage1/token-canary.cjs', 'stage1/host.cjs', 'stage1/token-probe.py'}
    if args.script not in permitted:
        raise RuntimeError('Unregistered child program rejected')
    marker = assert_owned(ROOT / 'isolation-identity.json')
    if marker.exists():
        identity = json.loads(marker.read_text('utf-8'))
    else:
        raise RuntimeError('ISOLATION: preconfigured namespace identity missing')
    validate_identity(identity)
    sandbox_context = None
    if args.sandbox_guest:
        context_spec = importlib.util.spec_from_file_location('stage1_sandbox_context', assert_owned(ROOT/'stage1/sandbox-context.py'))
        context_module = importlib.util.module_from_spec(context_spec)
        context_spec.loader.exec_module(context_module)
        sandbox_context = context_module.read_context(ROOT)
    lock_namespace(identity['namespace'])
    relatives = ['', 'data', 'config', 'cache', 'logs', 'runtime', 'backups']
    legacy_test_temporaries = assert_owned(ROOT / 'data' / 'ledger' / '备份')
    if legacy_test_temporaries.is_dir():
        for folder in legacy_test_temporaries.iterdir():
            if folder.name.startswith('ledger-backup-') and folder.is_dir():
                relatives.append(str(assert_owned(folder).relative_to(ROOT)))
    for relative in relatives:
        folder = assert_owned(ROOT / relative)
        # A raw SecurityIdentifier avoids icacls trying to resolve this private
        # restricting SID as an installed Windows account (error 1332).
        literal = str(folder).replace("'", "''")
        rights = 'ReadAndExecute' if not relative else 'Modify'
        script = "$ErrorActionPreference='Stop'; $stageFolder='" + literal + "'; $stageAcl=Get-Acl -LiteralPath $stageFolder; $stageIdentity=New-Object System.Security.Principal.SecurityIdentifier('" + identity['sid'] + "'); $stageRule=New-Object System.Security.AccessControl.FileSystemAccessRule($stageIdentity,[System.Security.AccessControl.FileSystemRights]::" + rights + ",[System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',[System.Security.AccessControl.PropagationFlags]::None,[System.Security.AccessControl.AccessControlType]::Allow); $stageAcl.SetAccessRule($stageRule); Set-Acl -LiteralPath $stageFolder -AclObject $stageAcl;"
        encoded = base64.b64encode(script.encode('utf-16le')).decode('ascii')
        powershell = Path(os.environ['SystemRoot']) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
        helper_env = dict(clean_environment(), PSModulePath=str(powershell.parent / 'Modules'))
        assert_owned(folder)
        result = subprocess.run([str(powershell), '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], env=helper_env, capture_output=True, creationflags=0x08000000)
        if result.returncode:
            (ROOT / 'reports' / 'acl-helper-error.log').write_bytes(result.stdout + b'\n' + result.stderr)
            raise RuntimeError('Unable to restrict test workspace ACL')
    original = W.HANDLE()
    checked(advapi.OpenProcessToken(kernel.GetCurrentProcess(), 0xF01FF, C.byref(original)), 'OpenProcessToken')
    restricted = W.HANDLE()
    custom, everyone = sid(identity['sid']), sid('S-1-1-0')
    guest_libraries = sid('S-1-5-32-545') if sandbox_context is not None else None
    restrictions = ((SIDATTR * 3)(SIDATTR(custom, 0), SIDATTR(everyone, 0), SIDATTR(guest_libraries, 0))
                    if guest_libraries else (SIDATTR * 2)(SIDATTR(custom, 0), SIDATTR(everyone, 0)))
    # Users/AU would grant production reads. Every formal destination is
    # checked against this exact token before any child may be created.
    # Apply restricting SIDs to ALL access checks. WRITE_RESTRICTED misses
    # FILE_DELETE_CHILD, allowing deletion via the directory's permission.
    checked(advapi.CreateRestrictedToken(original, 0x1, 0, None, 0, None, len(restrictions), restrictions, C.byref(restricted)), 'CreateRestrictedToken')
    private_sd = C.c_void_p()
    station = desktop = None
    try:
        formal_roots = [Path('F:/鑫金源珠宝资料'), Path('F:/自制软件/xjy-jewelry-offline')]
        required_databases = [formal_roots[0] / relative for relative in
                              ('工作室数据/jewelry.sqlite', '内帐/ledger.db', '库管/stockcheck.db')]
        formal = scan_formal_objects(formal_roots, required_databases) if sandbox_context is None else []
        checks = []
        for target in formal:
            rights = allowed_rights(restricted, target, WRITE_RIGHTS + ((0x40,) if target.is_dir() else ()))
            read_allowed = bool(allowed_rights(restricted, target, (0x1,)))
            checks.append({'target': str(target), 'writeAllowed': bool(rights), 'allowedRights': rights, 'readAllowed': read_allowed})
        (ROOT / 'reports' / 'restricted-token-precheck.json').write_text(json.dumps(checks, ensure_ascii=False, indent=2), encoding='utf-8')
        code_write = allowed_write(restricted, ROOT / 'stage1')
        data_write = allowed_write(restricted, ROOT / 'runtime')
        if code_write or not data_write:
            raise RuntimeError('Isolated code/data ACL separation failed')
        report = {'isolationMethod': 'windows-sandbox' if sandbox_context else 'host-access-check',
                  'actualHostAclChecked': sandbox_context is None,
                  'formalWritesDenied': not any(row['writeAllowed'] for row in checks),
                  'formalReadsDenied': not any(row['readAllowed'] for row in checks),
                  'codeWritesDenied': True, 'dataWritesAllowed': True, 'checks': checks,
                  **({'sandboxContext': sandbox_context, 'productionDriveVisible': False} if sandbox_context else {})}
        (ROOT / 'reports' / 'restricted-token-check.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        if sandbox_context is None:
            require_production_denial(checks)
        else:
            # Refresh actual guest admission immediately before process creation.
            context_module.read_context(ROOT)
        if args.check_only:
            print(json.dumps({'checkOnly': True, 'formalWritesDenied': True, 'formalReadsDenied': report['formalReadsDenied'], 'codeWritesDenied': True}))
            return
        # A private, noninteractive station avoids changing the real desktop's
        # ACL or clipboard. User32 DLL initialization otherwise fails for the
        # restricted token on WinSta0 (0xC0000142).
        descriptor = 'D:(A;;GA;;;' + owner_sid(original) + ')(A;;GA;;;SY)(A;;GA;;;' + identity['sid'] + ')'
        checked(advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW(descriptor, 1, C.byref(private_sd), None), 'Private security descriptor')
        attributes = SECURITY_ATTRIBUTES(C.sizeof(SECURITY_ATTRIBUTES), private_sd, False)
        dacl, present, defaulted = C.c_void_p(), W.BOOL(), W.BOOL()
        checked(advapi.GetSecurityDescriptorDacl(private_sd, C.byref(present), C.byref(dacl), C.byref(defaulted)), 'Default DACL')
        default_acl = DEFAULT_DACL(dacl)
        checked(advapi.SetTokenInformation(restricted, 6, C.byref(default_acl), C.sizeof(default_acl)), 'Token default DACL')
        station_name = 'xjy_stage1_' + identity['namespace'].replace('-', '')
        station = user32.CreateWindowStationW(station_name, 0, 0x37F, C.byref(attributes))
        checked(station, 'Create private window station')
        previous_station = user32.GetProcessWindowStation()
        checked(user32.SetProcessWindowStation(station), 'Use private station for creation')
        try:
            desktop = user32.CreateDesktopW('headless', None, None, 0, 0x1FF, C.byref(attributes))
            checked(desktop, 'Create private desktop')
        finally:
            checked(user32.SetProcessWindowStation(previous_station), 'Restore launcher window station')
        script = ROOT / args.script
        if not script.is_file():
            raise RuntimeError('Registered script missing')
        node = str(assert_owned(ROOT / 'stage1' / 'tools' / 'node.exe'))
        if not Path(node).is_file():
            raise RuntimeError('Protected local Node runtime is missing')
        arguments = [node, str(script), '--mode', args.mode]
        if args.script == 'stage1/token-probe.py':
            node = 'C:\\Python314\\python.exe'
            arguments = [node, '-B', str(script)]
        assert_owned(script)
        command = C.create_unicode_buffer(subprocess.list2cmdline(arguments))
        env = clean_environment()
        for key, relative in [('TEMP', 'runtime/tmp'), ('TMP', 'runtime/tmp'), ('APPDATA', 'cache/roaming'), ('LOCALAPPDATA', 'cache/local')]:
            folder = assert_owned(ROOT / relative)
            folder.mkdir(parents=True, exist_ok=True)
            env[key] = str(folder)
        env['USERPROFILE'] = str(ROOT / 'cache')
        env['PYTHONNOUSERSITE'] = '1'
        env['PYTHONDONTWRITEBYTECODE'] = '1'
        env['PYTHONIOENCODING'] = 'utf-8'
        env['PYTHONUTF8'] = '1'
        env.update(XJY_STAGE1_ROOT=str(ROOT), XJY_STAGE1_NAMESPACE=identity['namespace'])
        environment = C.create_unicode_buffer('\0'.join(key + '=' + value for key, value in sorted(env.items(), key=lambda pair: pair[0].upper())) + '\0\0')
        startup = STARTUPINFO()
        startup.cb = C.sizeof(startup)
        startup.lpDesktop = station_name + '\\headless'
        process = PROCESSINFO()
        job = checked(kernel.CreateJobObjectW(None, None), 'Create owned job')
        limits = JOB_EXTENDED()
        limits.BasicLimitInformation.LimitFlags = 0x2000 | 0x400
        checked(kernel.SetInformationJobObject(job, 9, C.byref(limits), C.sizeof(limits)), 'Configure owned job')
        checked(advapi.CreateProcessAsUserW(restricted, node, command, None, None, False, 0x08000404, environment, str(ROOT), C.byref(startup), C.byref(process)), 'CreateProcessAsUser')
        try:
            if not kernel.AssignProcessToJobObject(job, process.hProcess):
                kernel.TerminateProcess(process.hProcess, 1)
                raise RuntimeError('Unable to contain owned test process tree')
            if kernel.ResumeThread(process.hThread) == 0xFFFFFFFF:
                raise RuntimeError('Unable to resume owned process')
            if args.mode == 'serve':
                while kernel.WaitForSingleObject(process.hProcess, 500) == 0x102:
                    pass
                result = 0
            else:
                result = kernel.WaitForSingleObject(process.hProcess, 60000)
            if result != 0:
                raise RuntimeError('Owned test process did not finish within its test timeout')
            code = W.DWORD()
            checked(kernel.GetExitCodeProcess(process.hProcess, C.byref(code)), 'GetExitCodeProcess')
            if code.value:
                raise RuntimeError('Restricted test process failed: ' + str(code.value))
            print(json.dumps({'restrictedProcessExited': True, 'exitCode': code.value}))
        finally:
            kernel.CloseHandle(job)
            kernel.CloseHandle(process.hThread)
            kernel.CloseHandle(process.hProcess)
    finally:
        if desktop:
            user32.CloseDesktop(desktop)
        if station:
            user32.CloseWindowStation(station)
        if private_sd:
            kernel.LocalFree(private_sd)
        kernel.CloseHandle(restricted)
        kernel.CloseHandle(original)
        kernel.LocalFree(custom)
        kernel.LocalFree(everyone)
        if guest_libraries:
            kernel.LocalFree(guest_libraries)
if __name__ == '__main__':
    main()
