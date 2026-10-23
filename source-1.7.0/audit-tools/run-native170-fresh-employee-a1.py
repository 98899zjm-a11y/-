"""Root-only actual Guest fresh employee chain; no fake authority or test root.

Copies the exact final ZIP to a new private CROOT runtime directory, extracts
the exact assembly file set and launches its ORIGINAL FreshEmployee CMD.
No process termination, UI automation, private/HMAC key read or DB access.
The original success/error MessageBox remains for Root's normal confirmation.
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if (os.name != 'nt' or str(ROOT).lower().replace('\\', '/') != 'c:/xjy-work/xjy-web-stage1' or
        str(sys.executable).lower().replace('\\', '/') != 'c:/python314/python.exe' or
        not sys.flags.isolated or not sys.flags.no_site or not sys.flags.dont_write_bytecode or sys.flags.optimize):
    raise RuntimeError('Fixed actual Guest Python314 -I -B -S required before any child/write')

import argparse
import hashlib
import json
import re
import stat
import subprocess
import time
import types
import zipfile
from datetime import datetime, timezone

SELF = 'audit-tools/run-native170-fresh-employee-a1.py'
HELPER = 'audit-tools/run-finance-erp170-red-a1.py'
HELPER_SHA = '1f7ab3485de1260db7e0762175b7a15fcafc2d4c942f3adf7d40142a267f1e2e'
NAMESPACE = '36fcbe9c-ece1-4be3-af35-309a2ee19e05'
ASSEMBLY_SHA = '0df3ab745a7d75610a03884ae0d6352f07d357b4560bcc6ccb441ec1af3b12d6'
ZIP_SHA = '0ab28c25b66be79c1b969ab32c19364f6d0f58d941be0a43975ee9e146769561'
ZIP_SIZE = 780322212
PROPOSAL_SHA = 'dd282bfc78d0281c85c89bdec215dc955aba6db237f16ac1ac3f176482ce78d1'
MAPPED = Path('C:/xjy-input/native170-build-a4')
OUTPUT = Path('C:/xjy-results')
PS = 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'
CMD = 'C:/Windows/System32/cmd.exe'
EXE = '鑫金源珠宝报价.exe'


def stamp():
    return datetime.now(timezone.utc).isoformat()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def rel(value):
    if (not isinstance(value, str) or not 0 < len(value) <= 240 or
            re.search(r'[\\:*?"<>|\x00-\x1f]', value) or
            any(not p or p in ('.', '..') or p.endswith((' ', '.')) for p in value.split('/'))):
        raise RuntimeError('Unsafe exact package member')
    return value


def same_path(a, b):
    return os.path.normcase(os.path.abspath(a)) == os.path.normcase(os.path.abspath(b))


def encoded_ps(script, environment=None):
    import base64
    env = {'SystemRoot': 'C:\\Windows', 'WINDIR': 'C:\\Windows', 'SystemDrive': 'C:',
           'PSModulePath': 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules'}
    env.update(environment or {})
    command = [PS, '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
               base64.b64encode(script.encode('utf-16le')).decode('ascii')]
    child = subprocess.run(command, stdin=subprocess.DEVNULL, capture_output=True, shell=False,
                           creationflags=0x08000000, env=env)
    if child.returncode:
        raise RuntimeError('Native OS metadata/private-directory operation refused: ' + child.stderr.decode('utf-8', 'replace')[-4096:])
    return json.loads(child.stdout.decode('utf-8-sig'))


def known_folders():
    return encoded_ps("[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$ErrorActionPreference='Stop';"
                      "@{local=[Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData);"
                      "roaming=[Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData);"
                      "profile=[Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile);"
                      "sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;"
                      "user=[Security.Principal.WindowsIdentity]::GetCurrent().Name}|ConvertTo-Json -Compress")


def private_directory(directory, sid):
    # Same New-ApprovalAcl rule as the reviewed reviewer/native ACL: only this
    # actual OS SID, SYSTEM and Administrators. Only the NEW audit directory.
    script = ("[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$ErrorActionPreference='Stop';"
              "$p=[Environment]::GetEnvironmentVariable('XJY_FRESH_AUDIT_DIR','Process');"
              "$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;"
              "if($sid -cne [Environment]::GetEnvironmentVariable('XJY_FRESH_AUDIT_SID','Process')){throw 'SID changed'};"
              "if(Test-Path -LiteralPath $p){throw 'CopyNew directory already exists'};"
              "$walk=[IO.Path]::GetDirectoryName($p);while($walk){$i=Get-Item -LiteralPath $walk -Force;"
              "if(($i.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Reparse parent'};"
              "$q=[IO.Directory]::GetParent($walk);if(!$q){break};$walk=$q.FullName};"
              "$acl=New-Object Security.AccessControl.DirectorySecurity;$acl.SetAccessRuleProtection($true,$false);"
              "$acl.SetOwner((New-Object Security.Principal.SecurityIdentifier($sid)));"
              "foreach($who in @($sid,'S-1-5-18','S-1-5-32-544')){"
              "$rule=New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($who)),"
              "[Security.AccessControl.FileSystemRights]::FullControl,([Security.AccessControl.InheritanceFlags]::ContainerInherit -bor "
              "[Security.AccessControl.InheritanceFlags]::ObjectInherit),[Security.AccessControl.PropagationFlags]::None,"
              "[Security.AccessControl.AccessControlType]::Allow);$acl.AddAccessRule($rule)};"
              "[void][IO.Directory]::CreateDirectory($p,$acl);"
              "@{created=$true;path=$p;sid=$sid;owner=(Get-Acl -LiteralPath $p).GetOwner([Security.Principal.SecurityIdentifier]).Value}|ConvertTo-Json -Compress")
    proof = encoded_ps(script, {'XJY_FRESH_AUDIT_DIR': str(directory), 'XJY_FRESH_AUDIT_SID': sid})
    if proof.get('created') is not True or proof.get('sid') != sid or proof.get('owner') != sid or not same_path(proof.get('path', ''), directory):
        raise RuntimeError('New private directory receipt differs')
    return proof


def digest_file(base, file, expected=None):
    before = base.ordinary(file)
    h = hashlib.sha256()
    with file.open('rb') as stream:
        opened = os.fstat(stream.fileno())
        if any(getattr(before, k) != getattr(opened, k) for k in ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_nlink')):
            raise RuntimeError('Path/handle changed')
        while block := stream.read(4 * 1024 * 1024):
            h.update(block)
        if base.identity(os.fstat(stream.fileno())) != base.identity(opened):
            raise RuntimeError('File changed during hash')
    if base.identity(base.ordinary(file)) != base.identity(before):
        raise RuntimeError('File changed after hash')
    result = {'size': before.st_size, 'sha256': h.hexdigest()}
    if expected and result != {'size': expected['size'], 'sha256': expected['sha256']}:
        raise RuntimeError('Exact package bytes differ: ' + str(file))
    return result


def members(base, directory):
    result = []
    base.ordinary(directory, directory=True)
    for file in directory.rglob('*'):
        info = file.lstat()
        if stat.S_ISDIR(info.st_mode):
            base.ordinary(file, directory=True)
        else:
            base.ordinary(file)
            result.append(file.relative_to(directory).as_posix())
    return sorted(result)


def main():
    parser = argparse.ArgumentParser(allow_abbrev=False)
    parser.add_argument('--self-sha256', required=True)
    parser.add_argument('--expected-namespace', required=True)
    parser.add_argument('--assembly-sha256', required=True)
    parser.add_argument('--run-id', required=True)
    parser.add_argument('--preflight-only', action='store_true')
    args = parser.parse_args()
    if (not re.fullmatch('[a-f0-9]{64}', args.self_sha256) or args.expected_namespace != NAMESPACE or
            args.assembly_sha256 != ASSEMBLY_SHA or not re.fullmatch(r'native170-fresh-employee-a1(?:-[a-z0-9-]{1,32})?', args.run_id)):
        raise RuntimeError('Exact reviewed self, final assembly, namespace and new bounded run ID required')
    raw = (ROOT / HELPER).read_bytes()
    if sha(raw) != HELPER_SHA:
        raise RuntimeError('Original helpers changed')
    base = types.ModuleType('original_fresh170_helpers'); base.__file__ = str(ROOT / HELPER)
    exec(compile(raw, base.__file__, 'exec', dont_inherit=True), base.__dict__)
    base.verify_fixed(HELPER_SHA, NAMESPACE); base.pinned(ROOT / SELF, args.self_sha256)
    context = types.ModuleType('actual_fresh170_context'); context.__file__ = str(ROOT / 'stage1/sandbox-context.py')
    exec(compile(base.pinned(Path(context.__file__), base.GUARDS['stage1/sandbox-context.py']), context.__file__, 'exec'), context.__dict__)

    def verify():
        base.verify_fixed(HELPER_SHA, NAMESPACE); base.pinned(ROOT / SELF, args.self_sha256)
        return context.read_context(ROOT)

    proof = verify()
    assembly = json.loads(base.pinned(MAPPED / 'assembly.json', ASSEMBLY_SHA))
    if (assembly.get('purpose') != 'native170-built-from-approved-public-signatures' or
            assembly.get('proposalManifestSha256') != PROPOSAL_SHA or assembly.get('signedPayloadsVerified') != 7 or
            assembly.get('archive', {}).get('sha256') != ZIP_SHA or assembly['archive'].get('size') != ZIP_SIZE or
            not assembly.get('wrapperStaticParser', {}).get('ok') or len(assembly.get('files', [])) != 3286):
        raise RuntimeError('Actual final signed-build identity missing; no guessed package accepted')
    rows = {}
    for row in assembly['files']:
        if (set(row) != {'path', 'size', 'sha256'} or type(row['size']) is not int or not 0 <= row['size'] <= 1073741824 or
                not re.fullmatch('[a-f0-9]{64}', row['sha256']) or rel(row['path']).casefold() in rows):
            raise RuntimeError('Invalid final package file table')
        rows[row['path'].casefold()] = row
    if sum(row['size'] for row in rows.values()) > 4294967296:
        raise RuntimeError('Package expanded size exceeds original bounded extraction limit')
    folders = known_folders()
    if (not folders.get('user', '').lower().endswith('\\wdagutilityaccount') or
            not re.fullmatch(r'S-1-\d+(?:-\d+)+', folders.get('sid', '')) or
            Path('C:/Users') not in Path(folders.get('profile', '')).parents):
        raise RuntimeError('Real WDAG KnownFolder/SID required')
    for key in ('profile', 'local', 'roaming'):
        directory = Path(folders[key]); base.ordinary(directory, directory=True)
        if not (same_path(directory, folders['profile']) or Path(folders['profile']) in directory.parents):
            raise RuntimeError('KnownFolder is outside actual WDAG profile')
    install = Path(folders['local']) / '鑫金源珠宝/员工程序'
    state = install.parent / '.员工程序.xjy-engine-state'
    if install.exists() or state.exists():
        raise RuntimeError('Existing actual KnownFolder program/state retained; fresh audit stops without cleanup')
    source_zip = MAPPED / 'native-package.zip'
    digest_file(base, source_zip, {'size': ZIP_SIZE, 'sha256': ZIP_SHA})
    initial = {'namespace': NAMESPACE, 'actualProof': proof, 'assemblySha256': ASSEMBLY_SHA,
               'archiveSha256': ZIP_SHA, 'archiveSize': ZIP_SIZE, 'files': 3286, 'actualKnownFolders': folders,
               'installationDir': str(install), 'stateDir': str(state), 'destinationAbsent': True,
               'readOnly': True, 'installationStarted': False, 'productionRead': False}
    if args.preflight_only:
        print(json.dumps(initial, ensure_ascii=False)); return 0

    out = OUTPUT / args.run_id; base.ordinary(OUTPUT, directory=True); out.mkdir(exist_ok=False)
    def save(name, value):
        base.ordinary(out, directory=True)
        with (out / name).open('xb') as stream:
            stream.write((json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')); stream.flush(); os.fsync(stream.fileno())
    result = {**initial, 'readOnly': False, 'startedAt': stamp(), 'complete': False, 'exitCode': None,
              'nativeInstallAndEmployeeProcessObserved': False, 'actualUiVerified': False,
              'fullWorkflowAcceptance': False, 'privateOrHmacKeyRead': False, 'errors': []}
    save('preflight.json', result)
    try:
        verify(); runtime = ROOT / 'runtime'; base.ordinary(runtime, directory=True)
        private = runtime / args.run_id
        result['privateDirectory'] = private_directory(private, folders['sid']); base.ordinary(private, directory=True)
        copied = private / 'native-package.zip'
        before = base.ordinary(source_zip)
        with source_zip.open('rb') as source, copied.open('xb') as target:
            while block := source.read(4 * 1024 * 1024): target.write(block)
            target.flush(); os.fsync(target.fileno())
        if base.identity(base.ordinary(source_zip)) != base.identity(before): raise RuntimeError('Mapped archive changed while CopyNew')
        digest_file(base, copied, {'size': ZIP_SIZE, 'sha256': ZIP_SHA})
        package = private / 'package'; package.mkdir(exist_ok=False)
        with zipfile.ZipFile(copied) as archive:
            entries = archive.infolist()
            if len(entries) != 3286 or len({e.filename.casefold() for e in entries}) != 3286 or {e.filename.casefold() for e in entries} != set(rows):
                raise RuntimeError('Exact ZIP member set differs')
            for entry in entries:
                row = rows[entry.filename.casefold()]
                if (entry.filename != row['path'] or entry.is_dir() or entry.flag_bits & 1 or entry.compress_type != zipfile.ZIP_DEFLATED or
                        entry.file_size != row['size'] or (entry.external_attr >> 16) & 0xf000 not in (0, stat.S_IFREG)):
                    raise RuntimeError('Unexpected ZIP member type/size/compression')
                file = package / row['path']; file.parent.mkdir(parents=True, exist_ok=True); base.ordinary(file.parent, directory=True)
                h = hashlib.sha256()
                with archive.open(entry) as source, file.open('xb') as target:
                    while block := source.read(4 * 1024 * 1024): h.update(block); target.write(block)
                    target.flush(); os.fsync(target.fileno())
                if h.hexdigest() != row['sha256'] or file.stat().st_size != row['size']: raise RuntimeError('ZIP CRC/hash/size differs')
        if members(base, package) != sorted(row['path'] for row in rows.values()): raise RuntimeError('Extracted package member set differs')
        result['copyNewVerified'] = True; result['actualProofBeforeCommand'] = verify()
        # Every parent is a fixed CROOT name or the restricted ASCII run-id;
        # the CMD leaf contains no space or command metacharacter. Do not
        # embed manual quotes for Python list2cmdline to backslash-escape.
        command = [CMD, '/d', '/c', str(package / '首次安装员工.cmd')]
        env = os.environ.copy()
        for key in ('NODE_OPTIONS', 'NODE_PATH', 'NODE_V8_COVERAGE', 'ELECTRON_RUN_AS_NODE', 'XJY_INITIAL_ROLE', 'XJY_INITIAL_APPROVAL_LAUNCH'):
            env.pop(key, None)
        env.update({'SystemRoot': 'C:\\Windows', 'WINDIR': 'C:\\Windows', 'LOCALAPPDATA': folders['local'],
                    'APPDATA': folders['roaming'], 'USERPROFILE': folders['profile']})
        with (out / 'cmd.stdout.bin').open('xb') as stdout, (out / 'cmd.stderr.bin').open('xb') as stderr:
            child = subprocess.Popen(command, cwd=package, env=env, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr,
                                     shell=False, close_fds=True, creationflags=0x08000000)
            result['installationStarted'] = True
            save('command-started.json', {'command': command, 'cmdPid': child.pid, 'startedAt': stamp(),
                                         'messageBoxPolicy': 'Root confirms original dialog normally. No UI automation, timeout, kill or terminate.'})
            while child.poll() is None:
                print(json.dumps({'status': 'original-cmd-running', 'cmdPid': child.pid, 'rootMayObserveOriginalMessageBox': True}), flush=True)
                time.sleep(15)
            result['exitCode'] = child.returncode
            for stream in (stdout, stderr): stream.flush(); os.fsync(stream.fileno())
        result['actualProofAfterCommand'] = verify()
        if child.returncode: raise RuntimeError('Original fresh CMD returned nonzero; all artifacts retained')
        binding = json.loads(base.read(package / 'engine-native170-binding.json'))
        target = json.loads(binding['native']['targetEnvelope']['catalog'])
        if len(target['files']) != 1079: raise RuntimeError('Signed complete target file count differs')
        for row in target['files']: digest_file(base, install / rel(row['path']), row)
        extras = sorted(set(members(base, install)) - {row['path'] for row in target['files']})
        if extras != ['xjy-install-activation.json']: raise RuntimeError('Installed program contains unexpected members: ' + repr(extras))
        activation = json.loads(base.read(install / 'xjy-install-activation.json', 4096))
        if (set(activation) != {'version', 'product', 'programVersion', 'role', 'installationDir'} or activation['version'] != 1 or
                activation['product'] != 'xjy-jewelry-offline' or activation['programVersion'] != '1.7.0' or activation['role'] != 'employee' or
                not same_path(activation['installationDir'], install)):
            raise RuntimeError('Actual activation identity/role differs')
        receipt = json.loads(base.read(state / 'engine-startup-status.json', 16384)); payload = json.loads(receipt['payload'])
        journal_bytes = base.read(state / 'journal.json', 16777216)
        if (payload.get('version') != 2 or payload.get('phase') != 'committed' or payload.get('mode') != 'fresh' or
                payload.get('role') != 'employee' or payload.get('programVersion') != '1.7.0' or payload.get('engineVersion') != '44.9.0' or
                payload.get('businessReleased') is not True or payload.get('rollbackForbidden') is not True or
                payload.get('journalSha256') != sha(journal_bytes) or payload.get('catalogSha256') != assembly['publication']['engineTreeSha256']):
            raise RuntimeError('Actual persistent commit receipt metadata differs')
        processes = encoded_ps("[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$ErrorActionPreference='Stop';"
                               "$exe=[Environment]::GetEnvironmentVariable('XJY_FRESH_EXPECT_EXE','Process');"
                               "$rows=@(Get-CimInstance Win32_Process|Where-Object{$_.ExecutablePath -ieq $exe}|"
                               "Select-Object ProcessId,ParentProcessId,ExecutablePath,CreationDate,CommandLine);"
                               "@{processes=$rows}|ConvertTo-Json -Compress -Depth 4", {'XJY_FRESH_EXPECT_EXE': str(install / EXE)})['processes']
        if not any('--employee-client' in (p.get('CommandLine') or '') and '--type=' not in (p.get('CommandLine') or '') for p in processes):
            raise RuntimeError('Actual CIM employee main process not observed')
        result.update(complete=True, nativeInstallAndEmployeeProcessObserved=True, activation=activation,
                      receiptMetadata={'transactionId': payload['transactionId'], 'phase': payload['phase'], 'mode': payload['mode'],
                                       'businessReleased': payload['businessReleased'], 'independentlyHmacVerifiedByDriver': False},
                      actualProcesses=processes, signedTargetFilesVerified=1079,
                      note='Original product verifies signatures/HMAC/ACL. Driver never reads keys; UI usability still needs Root observation.')
    except Exception as error:
        result['errors'].append({'type': type(error).__name__, 'message': str(error)})
    finally:
        result['endedAt'] = stamp(); save('results.json', result)
    print(json.dumps({'complete': result['complete'], 'exitCode': result['exitCode'],
                      'nativeInstallAndEmployeeProcessObserved': result['nativeInstallAndEmployeeProcessObserved'], 'errors': result['errors']}, ensure_ascii=False))
    return 0 if result['complete'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
