"""SOURCE_ONLY scope-B collector candidate. Never import/run on Host.

One fixed readonly Windows PowerShell literal, private pipes, single-caller
sequential FIFO list requests. No product, old model, A2 registration bypass,
arbitrary script/remote host/command, kill, restart or ownership abandonment.
Original admission retains its separately documented metadata timeout policy.
Root must seal actual PowerShell SHA/link count and this literal SHA first.
"""

from pathlib import Path
import os

ROOT = Path(__file__).resolve().parents[1]
GUEST = Path('C:/xjy-work/xjy-web-stage1')
if os.name != 'nt' or os.path.normcase(str(ROOT)) != os.path.normcase(str(GUEST)):
    raise RuntimeError('Fixed actual Guest required before collector import')

import base64
import copy
import hashlib
import importlib.util
import ipaddress
import json
import queue
import re
import stat
import subprocess
import sys
import threading
import time

POWERSHELL = Path('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe')
GUARD_PINS = {
    'stage1/sandbox-context.py': '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
    'stage1/validate-sandbox-context.py': '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207',
}
MAX_FRAME = 8 * 1024 * 1024
SOURCE_CONTRACT_STATE = 'SOURCE_ONLY'
# Root's actual readonly capability diagnostic found CDXML function sources,
# not the outer NetTCPIP module name. These are exact public command records.
MODULE_SEARCH_REQUESTED = r'C:\Windows\System32\WindowsPowerShell\v1.0\Modules'
MODULE_SEARCH_EFFECTIVE = [r'C:\Program Files\WindowsPowerShell\Modules', MODULE_SEARCH_REQUESTED]
EXPECTED_COMMANDS = [
    {'qualifiedName': r'Microsoft.PowerShell.Management\Get-WmiObject', 'name': 'Get-WmiObject', 'commandType': 'Cmdlet',
     'source': 'Microsoft.PowerShell.Management', 'moduleName': 'Microsoft.PowerShell.Management',
     'modulePath': MODULE_SEARCH_REQUESTED + r'\Microsoft.PowerShell.Management\Microsoft.PowerShell.Management.psd1',
     'moduleBase': str(POWERSHELL.parent)},
    {'qualifiedName': r'NetTCPIP\Get-NetTCPConnection', 'name': 'Get-NetTCPConnection', 'commandType': 'Function',
     'source': 'MSFT_NetTCPConnection', 'moduleName': 'MSFT_NetTCPConnection',
     'modulePath': MODULE_SEARCH_REQUESTED + r'\NetTCPIP\MSFT_NetTCPConnection.cdxml',
     'moduleBase': MODULE_SEARCH_REQUESTED + r'\NetTCPIP'},
    {'qualifiedName': r'NetTCPIP\Get-NetUDPEndpoint', 'name': 'Get-NetUDPEndpoint', 'commandType': 'Function',
     'source': 'MSFT_NetUDPEndpoint', 'moduleName': 'MSFT_NetUDPEndpoint',
     'modulePath': MODULE_SEARCH_REQUESTED + r'\NetTCPIP\MSFT_NetUDPEndpoint.cdxml',
     'moduleBase': MODULE_SEARCH_REQUESTED + r'\NetTCPIP'},
]
WORKER_SOURCE = r"""
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$WarningPreference='Stop'
$collectorStage='capability'
try {
  if($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1){throw 'Fixed PowerShell5.1 required'}
  function SameFixedPath($actual,$expected) {
    return $actual -is [string] -and $actual.Replace('/','\').ToLowerInvariant() -ceq $expected.Replace('/','\').ToLowerInvariant()
  }
  $moduleSearchRequested='C:\Windows\System32\WindowsPowerShell\v1.0\Modules'
  $moduleSearchEffective=@($env:PSModulePath.Split(';'))
  if($moduleSearchEffective.Count -ne 2 -or -not (SameFixedPath $moduleSearchEffective[0] 'C:\Program Files\WindowsPowerShell\Modules') -or -not (SameFixedPath $moduleSearchEffective[1] $moduleSearchRequested)){throw 'Exact effective module paths required'}
  $expectedCommands=@(
    [ordered]@{qualifiedName='Microsoft.PowerShell.Management\Get-WmiObject';name='Get-WmiObject';commandType='Cmdlet';source='Microsoft.PowerShell.Management';moduleName='Microsoft.PowerShell.Management';modulePath='C:\Windows\System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Management\Microsoft.PowerShell.Management.psd1';moduleBase='C:\Windows\System32\WindowsPowerShell\v1.0'},
    [ordered]@{qualifiedName='NetTCPIP\Get-NetTCPConnection';name='Get-NetTCPConnection';commandType='Function';source='MSFT_NetTCPConnection';moduleName='MSFT_NetTCPConnection';modulePath='C:\Windows\System32\WindowsPowerShell\v1.0\Modules\NetTCPIP\MSFT_NetTCPConnection.cdxml';moduleBase='C:\Windows\System32\WindowsPowerShell\v1.0\Modules\NetTCPIP'},
    [ordered]@{qualifiedName='NetTCPIP\Get-NetUDPEndpoint';name='Get-NetUDPEndpoint';commandType='Function';source='MSFT_NetUDPEndpoint';moduleName='MSFT_NetUDPEndpoint';modulePath='C:\Windows\System32\WindowsPowerShell\v1.0\Modules\NetTCPIP\MSFT_NetUDPEndpoint.cdxml';moduleBase='C:\Windows\System32\WindowsPowerShell\v1.0\Modules\NetTCPIP'}
  )
  $commandRecords=@()
  foreach($expectedCommand in $expectedCommands) {
    $resolved=@(Get-Command -Name $expectedCommand.qualifiedName -ErrorAction Stop)
    if($resolved.Count -ne 1){throw 'One exact qualified command required'}
    $command=$resolved[0]
    $actualCommand=[ordered]@{qualifiedName=$expectedCommand.qualifiedName;name=$command.Name;commandType=([string]$command.CommandType);source=$command.Source;moduleName=$command.ModuleName;modulePath=$command.Module.Path;moduleBase=$command.Module.ModuleBase}
    foreach($field in @('qualifiedName','name','commandType','source','moduleName')) {
      if($actualCommand[$field] -cne $expectedCommand[$field]){throw 'Exact command record required'}
    }
    if(-not (SameFixedPath $actualCommand.modulePath $expectedCommand.modulePath) -or -not (SameFixedPath $actualCommand.moduleBase $expectedCommand.moduleBase)){throw 'Exact system module path required'}
    $commandRecords+=,$actualCommand
  }
  $capabilities=[ordered]@{powershellMajor=[int]$PSVersionTable.PSVersion.Major;powershellMinor=[int]$PSVersionTable.PSVersion.Minor;requestedModuleSearchPath=$moduleSearchRequested;effectiveModuleSearchPath=$moduleSearchEffective;commands=$commandRecords}
  [long]$collectorSeq=0
  while($null -ne ($requestLine=[Console]::In.ReadLine())) {
    $collectorStage='request'
    if($requestLine -cne 'list'){throw 'Only fixed list request accepted'}
    $startTicks=([Diagnostics.Stopwatch]::GetTimestamp()).ToString([Globalization.CultureInfo]::InvariantCulture)
    $collectorStage='processes'
    $processRows=@(Microsoft.PowerShell.Management\Get-WmiObject -Class Win32_Process -Property ProcessId,ParentProcessId,ExecutablePath,CreationDate -ErrorAction Stop | ForEach-Object {
      $processRow=$_
      $rawCreation=$processRow.Properties['CreationDate'].Value
      $rawType=$null
      if($null -ne $rawCreation) {
        $rawType=$rawCreation.GetType().FullName
        if($rawCreation -isnot [string]){$collectorStage='raw-dmtf-type';throw 'Unconverted DMTF string required'}
      }
      [ordered]@{processId=[long]$processRow.ProcessId;parentProcessId=[long]$processRow.ParentProcessId;wmiExecutablePath=$processRow.ExecutablePath;cimCreationDmtfRaw=$rawCreation;cimCreationValueType=$rawType}
    })
    $collectorStage='tcp'
    $tcpRows=@(NetTCPIP\Get-NetTCPConnection -ErrorAction Stop | Where-Object {$_.State -eq 'Listen'} | ForEach-Object {
      [ordered]@{localAddress=[string]$_.LocalAddress;localPort=[int]$_.LocalPort;owningProcess=[long]$_.OwningProcess;state=[string]$_.State}
    })
    $collectorStage='udp'
    $udpRows=@(NetTCPIP\Get-NetUDPEndpoint -ErrorAction Stop | ForEach-Object {
      [ordered]@{localAddress=[string]$_.LocalAddress;localPort=[int]$_.LocalPort;owningProcess=[long]$_.OwningProcess}
    })
    $collectorStage='frame'
    if($processRows.Count -gt 65536 -or $tcpRows.Count -gt 65536 -or $udpRows.Count -gt 65536){throw 'Metadata row limit'}
    $collectorSeq++
    $frame=[ordered]@{schemaVersion=1;sequence=$collectorSeq;capabilities=$capabilities;processes=$processRows;tcpListeners=$tcpRows;udpEndpoints=$udpRows;queryWindow=[ordered]@{startMonotonicTicks=$startTicks;endMonotonicTicks=([Diagnostics.Stopwatch]::GetTimestamp()).ToString([Globalization.CultureInfo]::InvariantCulture);frequency=([Diagnostics.Stopwatch]::Frequency).ToString([Globalization.CultureInfo]::InvariantCulture)}}
    $json=Microsoft.PowerShell.Utility\ConvertTo-Json -InputObject $frame -Compress -Depth 6
    if([Text.Encoding]::UTF8.GetByteCount($json) -gt 8388608){throw 'Metadata byte limit'}
    [Console]::Out.WriteLine($json)
    [Console]::Out.Flush()
  }
  exit 0
} catch {
  [Console]::Error.WriteLine('COLLECTOR_FAILED:'+$collectorStage)
  exit 1
}
""".strip()


class CollectorError(RuntimeError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def require(value, code):
    if not value:
        raise CollectorError(code)


def ordinary(file, boundary, *, os_links=None):
    file, boundary = Path(file), Path(boundary)
    require(file.is_absolute() and file.is_relative_to(boundary), 'PATH_BOUNDARY_REFUSED')
    for item in (file, *file.parents):
        info = item.lstat()
        require(not stat.S_ISLNK(info.st_mode) and not getattr(info, 'st_file_attributes', 0) & 0x400, 'PATH_LINK_REFUSED')
        if stat.S_ISREG(info.st_mode):
            # Only the exact fixed OS exe may use Root-observed system link count.
            wanted = os_links if item == POWERSHELL and os_links is not None else 1
            require(info.st_nlink == wanted, 'FILE_LINK_COUNT_REFUSED')
        if item == boundary:
            return file
    raise CollectorError('PHYSICAL_BOUNDARY_MISSING')


def identity(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns,
            info.st_ctime_ns, info.st_nlink, getattr(info, 'st_birthtime_ns', None))


def stable_bytes(file, boundary, *, os_links=None):
    file = ordinary(file, boundary, os_links=os_links)
    before = file.stat()
    require(file.is_file() and before.st_size <= MAX_FRAME, 'BOUNDED_FILE_REQUIRED')
    with file.open('rb') as stream:
        opened = os.fstat(stream.fileno())
        shared = ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_nlink')
        births = (getattr(before, 'st_birthtime_ns', None), getattr(opened, 'st_birthtime_ns', None))
        require(all(getattr(before, key) == getattr(opened, key) for key in shared) and (None in births or births[0] == births[1]), 'FILE_CHANGED_BEFORE_OPEN')
        body = stream.read(MAX_FRAME + 1)
        require(len(body) == before.st_size and identity(os.fstat(stream.fileno())) == identity(opened), 'FILE_CHANGED_DURING_READ')
    require(identity(ordinary(file, boundary, os_links=os_links).stat()) == identity(before), 'FILE_CHANGED_AFTER_READ')
    return body


def _actual_admission():
    reviewed = {}
    for relative, sha in GUARD_PINS.items():
        body = stable_bytes(ROOT / relative, ROOT)
        require(hashlib.sha256(body).hexdigest() == sha, 'ORIGINAL_GUARD_CHANGED')
        reviewed[relative] = body
    file = ROOT / 'stage1/sandbox-context.py'
    spec = importlib.util.spec_from_file_location('scope_b_actual_context', file)
    module = importlib.util.module_from_spec(spec)
    exec(compile(reviewed['stage1/sandbox-context.py'], str(file), 'exec'), module.__dict__)
    return module.read_context(ROOT)


def _uint(value, maximum=0xffffffff):
    return type(value) is int and 0 <= value <= maximum


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'DUPLICATE_JSON_KEY')
        result[key] = value
    return result


def _fixed_path_matches(actual, expected):
    # Windows spelling only; no prefix match, environment expansion or .. alias.
    return isinstance(actual, str) and actual.replace('/', '\\').casefold() == expected.replace('/', '\\').casefold()


def _capabilities_match(caps):
    fields = {'powershellMajor', 'powershellMinor', 'requestedModuleSearchPath', 'effectiveModuleSearchPath', 'commands'}
    if not isinstance(caps, dict) or set(caps) != fields or type(caps['powershellMajor']) is not int or caps['powershellMajor'] != 5 or type(caps['powershellMinor']) is not int or caps['powershellMinor'] != 1:
        return False
    if not _fixed_path_matches(caps['requestedModuleSearchPath'], MODULE_SEARCH_REQUESTED):
        return False
    effective = caps['effectiveModuleSearchPath']
    if not isinstance(effective, list) or len(effective) != 2 or not all(_fixed_path_matches(actual, expected) for actual, expected in zip(effective, MODULE_SEARCH_EFFECTIVE)):
        return False
    commands = caps['commands']
    if not isinstance(commands, list) or len(commands) != 3:
        return False
    for actual, expected in zip(commands, EXPECTED_COMMANDS):
        if not isinstance(actual, dict) or set(actual) != set(expected):
            return False
        for field in ('qualifiedName', 'name', 'commandType', 'source', 'moduleName'):
            if not isinstance(actual[field], str) or actual[field] != expected[field]:
                return False
        if not all(_fixed_path_matches(actual[field], expected[field]) for field in ('modulePath', 'moduleBase')):
            return False
    return True


def validate_frame(body, expected_sequence):
    require(body.endswith(b'\n') and len(body) <= MAX_FRAME + 2, 'INCOMPLETE_OR_OVERSIZE_FRAME')
    payload = body[:-2] if body.endswith(b'\r\n') else body[:-1]
    require(len(payload) <= MAX_FRAME, 'OVERSIZE_FRAME_PAYLOAD')
    frame = json.loads(payload.decode('utf-8', errors='strict'), object_pairs_hook=_unique_object)
    require(isinstance(frame, dict) and set(frame) == {'schemaVersion', 'sequence', 'capabilities', 'processes', 'tcpListeners', 'udpEndpoints', 'queryWindow'}, 'FRAME_SCHEMA_REFUSED')
    require(type(frame['schemaVersion']) is int and frame['schemaVersion'] == 1 and type(frame['sequence']) is int and frame['sequence'] == expected_sequence, 'FRAME_SEQUENCE_OR_VERSION_REFUSED')
    require(_capabilities_match(frame['capabilities']), 'FIRST_FRAME_CAPABILITY_REFUSED')
    seen = set()
    for name in ('processes', 'tcpListeners', 'udpEndpoints'):
        require(isinstance(frame[name], list) and len(frame[name]) <= 65536, 'FRAME_ROWS_REFUSED')
    for row in frame['processes']:
        require(isinstance(row, dict) and set(row) == {'processId', 'parentProcessId', 'wmiExecutablePath', 'cimCreationDmtfRaw', 'cimCreationValueType'}, 'PROCESS_ROW_SCHEMA_REFUSED')
        pid, parent = row['processId'], row['parentProcessId']
        require(_uint(pid) and _uint(parent) and pid not in seen and not (pid == parent and pid != 0) and not (pid == 0 and parent != 0), 'PROCESS_PID_REFUSED')
        seen.add(pid)
        for key, limit in (('wmiExecutablePath', 32768), ('cimCreationDmtfRaw', 128)):
            value = row[key]
            require(value is None or isinstance(value, str) and len(value) <= limit and '\x00' not in value, 'PROCESS_OBSERVATION_TYPE_REFUSED')
        require(row['cimCreationValueType'] == ('System.String' if row['cimCreationDmtfRaw'] is not None else None), 'RAW_DMTF_VALUE_TYPE_REFUSED')
    for name in ('tcpListeners', 'udpEndpoints'):
        fields = {'localAddress', 'localPort', 'owningProcess'} | ({'state'} if name == 'tcpListeners' else set())
        for row in frame[name]:
            require(isinstance(row, dict) and set(row) == fields and _uint(row['localPort'], 65535) and row['localPort'] > 0 and _uint(row['owningProcess']), 'ENDPOINT_SCHEMA_REFUSED')
            require(isinstance(row['localAddress'], str) and len(row['localAddress']) <= 256, 'ENDPOINT_ADDRESS_REFUSED')
            ipaddress.ip_address(row['localAddress'])
            if name == 'tcpListeners':
                require(row['state'] == 'Listen', 'TCP_STATE_REFUSED')
    window = frame['queryWindow']
    require(isinstance(window, dict) and set(window) == {'startMonotonicTicks', 'endMonotonicTicks', 'frequency'}, 'QUERY_WINDOW_REFUSED')
    require(all(isinstance(value, str) and re.fullmatch(r'[0-9]{1,20}', value) is not None for value in window.values()), 'QUERY_WINDOW_TYPE_REFUSED')
    require(int(window['endMonotonicTicks']) >= int(window['startMonotonicTicks']) and int(window['frequency']) > 0, 'QUERY_WINDOW_ORDER_REFUSED')
    return frame


class _Collector:
    def __init__(self, ps_sha, ps_links, literal_sha, output_dir):
        require(type(ps_links) is int and 1 <= ps_links <= 1024, 'ROOT_OS_LINK_COUNT_REQUIRED')
        require(isinstance(ps_sha, str) and re.fullmatch(r'[0-9a-f]{64}', ps_sha) is not None and hashlib.sha256(stable_bytes(POWERSHELL, Path('C:/'), os_links=ps_links)).hexdigest() == ps_sha, 'ROOT_POWERSHELL_SHA_MISMATCH')
        require(hashlib.sha256(WORKER_SOURCE.encode('utf-8')).hexdigest() == literal_sha, 'ROOT_WORKER_LITERAL_SHA_MISMATCH')
        self.admission = _actual_admission()
        self.output_dir = ordinary(output_dir, Path('C:/xjy-results'))
        self._owner = threading.get_ident()
        self._lock = threading.RLock()
        self._responses = queue.Queue(maxsize=1)
        self._failure = None
        self.process = None
        self._threads = []
        self._pending = self._response_seen = self._input_closed = self._closing = False
        self._stdout_closed = self._stderr_closed = False
        self._stderr_bytes = 0
        self._stderr_hash = hashlib.sha256()
        self._stderr_prefix = b''
        self.worker_starts = self.requests = self.responses = self.sequence = 0

    @property
    def failure(self):
        with self._lock:
            return copy.deepcopy(self._failure)

    def _fail(self, code):
        with self._lock:
            if self._failure is None:
                self._failure = {'code': code}
        return CollectorError(code)

    def _main(self):
        require(threading.get_ident() == self._owner, 'SINGLE_CALLER_COLLECTOR_REQUIRED')

    def start(self):
        self._main()
        require(self.process is None and self.worker_starts == 0, 'COLLECTOR_RESTART_FORBIDDEN')
        encoded = base64.b64encode(WORKER_SOURCE.encode('utf-16le')).decode('ascii')
        require(len(encoded) < 30000, 'FIXED_LITERAL_COMMAND_TOO_LARGE')
        env = {'SystemRoot': 'C:\\Windows', 'WINDIR': 'C:\\Windows', 'SystemDrive': 'C:', 'PATHEXT': '.EXE',
               'PSModulePath': str(POWERSHELL.parent / 'Modules'), 'TEMP': str(self.output_dir), 'TMP': str(self.output_dir)}
        self.process = subprocess.Popen([str(POWERSHELL), '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
                                        cwd=ROOT, env=env, shell=False, close_fds=True, creationflags=0x08000000,
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.worker_starts = 1
        for target in (self._stdout_reader, self._stderr_reader):
            thread = threading.Thread(target=target, daemon=True)
            self._threads.append(thread)
            thread.start()

    def _stdout_reader(self):
        try:
            while True:
                body = self.process.stdout.readline(MAX_FRAME + 3)
                if not body:
                    with self._lock:
                        self._stdout_closed = True
                        if not self._closing:
                            self._fail('UNEXPECTED_WORKER_STDOUT_EOF')
                    return
                with self._lock:
                    if len(body) > MAX_FRAME + 2 or not body.endswith(b'\n'):
                        self._fail('OVERSIZE_OR_INCOMPLETE_WORKER_FRAME')
                    if self._failure is not None:
                        continue  # drain, not cache: a failing writer must not block EOF
                    if not self._pending or self._response_seen:
                        self._fail('UNSOLICITED_OR_EXTRA_WORKER_FRAME')
                        continue
                    self._response_seen = True
                    self._responses.put_nowait(body)
        except Exception:
            self._fail('WORKER_STDOUT_READ_FAILED')

    def _stderr_reader(self):
        try:
            while True:
                body = self.process.stderr.read1(4096)
                if not body:
                    with self._lock:
                        self._stderr_closed = True
                    return
                with self._lock:
                    self._stderr_bytes += len(body)
                    self._stderr_hash.update(body)
                    self._stderr_prefix = (self._stderr_prefix + body)[:128]
                    self._fail('WORKER_STDERR')
        except Exception:
            self._fail('WORKER_STDERR_READ_FAILED')

    def list(self):
        self._main()
        require(self.process is not None and not self._closing, 'COLLECTOR_NOT_ACCEPTING')
        if self.failure is not None:
            raise CollectorError(self.failure['code'])
        if self.stopped():
            raise self._fail('COLLECTOR_EXITED_BEFORE_REQUEST')
        with self._lock:
            require(not self._pending, 'ONE_OUTSTANDING_REQUEST_REQUIRED')
            self._pending, self._response_seen = True, False
        try:
            self.requests += 1
            self.process.stdin.write(b'list\n')
            self.process.stdin.flush()
            deadline = time.monotonic() + 20
            while True:
                if self.failure is not None:
                    raise CollectorError(self.failure['code'])
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise self._fail('WORKER_REQUEST_TIMEOUT')
                try:
                    body = self._responses.get(timeout=min(0.1, remaining))
                    break
                except queue.Empty:
                    continue
            frame = validate_frame(body, self.sequence + 1)
            if self.failure is not None:
                raise CollectorError(self.failure['code'])
            self.sequence = frame['sequence']
            self.responses += 1
            return frame
        except Exception as error:
            self._fail(getattr(error, 'code', 'WORKER_FRAME_OR_IO_FAILED'))
            raise CollectorError(self.failure['code']) from None
        finally:
            with self._lock:
                self._pending = False

    def close_input(self):
        self._main()
        self._closing = True
        if self.process is None or self._input_closed:
            return
        if self.process.poll() is not None:
            self._fail('WORKER_EXITED_BEFORE_EOF')
        try:
            self.process.stdin.close()
            self._input_closed = True
        except Exception:
            raise self._fail('WORKER_EOF_WRITE_FAILED') from None

    def stopped(self):
        if self.process is None:
            return True
        try:
            return self.process.poll() is not None
        except Exception:
            self._fail('WORKER_CAPTURE_POLL_FAILED')
            return False

    def wait_normal(self):
        self._main()
        if self.process is None:
            return None
        try:
            code = self.process.wait(timeout=10)
        except Exception:
            raise self._fail('WORKER_NORMAL_EXIT_WAIT_FAILED') from None
        for thread in self._threads:
            thread.join(timeout=2)
        if any(thread.is_alive() for thread in self._threads) or not self._stdout_closed or not self._stderr_closed:
            self._fail('WORKER_READERS_NOT_CLOSED')
        if code != 0 or not self._input_closed:
            self._fail('WORKER_NOT_NORMAL_EOF_EXIT_ZERO')
        if self.failure is not None:
            raise CollectorError(self.failure['code'])
        return code

    def close_pipes_after_exit(self):
        require(self.stopped(), 'LIVE_WORKER_CAPTURE_MUST_REMAIN_HELD')
        for thread in self._threads:
            thread.join(timeout=2)
        require(not any(thread.is_alive() for thread in self._threads), 'WORKER_READERS_REMAIN_ACTIVE')
        if self.process is not None:
            self.process.stdout.close()
            self.process.stderr.close()

    def evidence(self):
        with self._lock:
            prefix = self._stderr_prefix.decode('ascii', errors='ignore')
            match = re.fullmatch(r'COLLECTOR_FAILED:(capability|processes|raw-dmtf-type|tcp|udp|frame|request)\s*', prefix)
            return {'workerIdentitySource': 'direct-popen-createprocess-capture', 'workerKernelSnapshotAssessed': False,
                    'workerPid': self.process.pid if self.process is not None else None, 'workerStarts': self.worker_starts,
                    'requests': self.requests, 'responses': self.responses, 'lastSequence': self.sequence,
                    'eofSent': self._input_closed, 'popenExitCode': self.process.returncode if self.process is not None else None,
                    'stdoutClosed': self._stdout_closed, 'stderrClosed': self._stderr_closed,
                    'stderrBytes': self._stderr_bytes, 'stderrSha256': self._stderr_hash.hexdigest(),
                    'workerErrorStage': match.group(1) if match else None, 'failure': copy.deepcopy(self._failure)}


def create_collector(*, powershell_sha256, powershell_link_count, worker_literal_sha256, output_dir):
    require(os.path.normcase(sys.executable) == os.path.normcase('C:\\Python314\\python.exe') and sys.flags.isolated and sys.flags.dont_write_bytecode, 'FIXED_ISOLATED_PYTHON_REQUIRED')
    return _Collector(powershell_sha256, powershell_link_count, worker_literal_sha256, output_dir)
