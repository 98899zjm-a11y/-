"""Fixed, readonly Guest capability metadata; no product or process queries."""
from pathlib import Path
import os
import sys

ROOT = Path(__file__).resolve().parents[1]
if os.name != 'nt' or str(ROOT).lower() != 'c:\\xjy-work\\xjy-web-stage1' or str(Path(sys.executable)).lower() != 'c:\\python314\\python.exe' or not sys.flags.isolated or not sys.flags.dont_write_bytecode:
    raise RuntimeError('Fixed isolated actual Guest required')

import base64
import hashlib
import importlib.util
import json
import stat
import subprocess
import time

def read_fixed(relative, expected):
    file = ROOT / relative
    for current in (file, *file.parents):
        info = current.lstat()
        if info.st_file_attributes & 0x400 or current.is_symlink() or current.is_junction():
            raise RuntimeError('Source reparse refused')
        if current == ROOT:
            break
    before = file.lstat()
    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > 8 * 1024 * 1024:
        raise RuntimeError('Bounded ordinary source required before read')
    with file.open('rb') as stream:
        opened = os.fstat(stream.fileno())
        body = stream.read(8 * 1024 * 1024 + 1)
        after = os.fstat(stream.fileno())
    current = file.lstat()
    keys = lambda value: (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_nlink, value.st_birthtime_ns)
    if len(body) > 8 * 1024 * 1024 or not (keys(before) == keys(opened) == keys(after) == keys(current)) or before.st_ctime_ns != current.st_ctime_ns or opened.st_ctime_ns != after.st_ctime_ns or hashlib.sha256(body).hexdigest() != expected:
        raise RuntimeError('Fixed source identity/hash refused')
    return body

def load_bytes(name, relative, body):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    exec(compile(body, str(ROOT / relative), 'exec'), module.__dict__)
    return module

guard_body = read_fixed('stage1/sandbox-context.py', '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249')
read_fixed('stage1/validate-sandbox-context.py', '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207')
context = load_bytes('actual_context', 'stage1/sandbox-context.py', guard_body)
context.read_context(ROOT)
collector = load_bytes('fixed_collector_metadata_helpers', 'audit-tools/ui-observer-collector.py', read_fixed('audit-tools/ui-observer-collector.py', '0b9e3ab746d1f117ee12b76ac13a44bbbe3cc215585decbddbb0600eb66dfd1d'))
body = read_fixed('audit-tools/ui-observer-capability-diagnostic.ps1', '658da63e7e0374cda6d91f6cc16b0fcc76067cf3b51afd1a2c7960b596f1519e')
if hashlib.sha256(collector.stable_bytes(collector.POWERSHELL, Path('C:/'), os_links=1)).hexdigest() != '60c9b29843624dd8af6b6a7b26147753be6aeef65098b9a503cc50850afe410f':
    raise RuntimeError('Actual public PowerShell changed')
results = collector.ordinary(Path('C:/xjy-results'), Path('C:/xjy-results'))
output = results / 'collector-capability-diagnostic-a1'
output.mkdir()
collector.ordinary(output, results)
encoded = base64.b64encode(body.decode('utf-8', errors='strict').encode('utf-16le')).decode('ascii')
env = {'SystemRoot': 'C:\\Windows', 'WINDIR': 'C:\\Windows', 'SystemDrive': 'C:', 'PATHEXT': '.EXE', 'PSModulePath': str(collector.POWERSHELL.parent / 'Modules'), 'TEMP': str(output), 'TMP': str(output)}
process = None
code = None
first_wait_failure = None
with (output / 'stdout.json').open('xb') as stdout, (output / 'stderr.log').open('xb') as stderr:
    process = subprocess.Popen([str(collector.POWERSHELL), '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], cwd=ROOT, env=env, shell=False, close_fds=True, creationflags=0x08000000, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr)
    while code is None:
        try:
            code = process.wait()  # Keep exactly the original capture until natural exit.
        except BaseException as error:
            if first_wait_failure is None:
                first_wait_failure = type(error).__name__
                try:
                    with (output / 'first-wait-failure.json').open('x', encoding='utf-8') as stream:
                        json.dump({'passed': False, 'errorType': first_wait_failure, 'holdingOriginalCapture': True, 'forcedStop': False}, stream)
                except BaseException:
                    pass  # Output failure cannot abandon ownership.
            try:
                time.sleep(0.5)
            except BaseException:
                pass
with (output / 'transport-result.json').open('x', encoding='utf-8') as stream:
    json.dump({'purpose': 'fixed capability metadata transport', 'exitCode': code, 'firstWaitFailure': first_wait_failure, 'capturedPid': process.pid, 'forcedStop': False, 'candidateQualified': False, 'productExecuted': False}, stream, indent=2)
raise SystemExit(code if first_wait_failure is None else 1)
