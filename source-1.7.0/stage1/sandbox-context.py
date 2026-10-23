"""Admit guest-only library permissions using actual Windows Sandbox metadata.

This module never opens a business database or changes Windows configuration.
The normal host launcher keeps its stricter token. No environment flag alone
can select the guest policy.
"""
import ctypes as C
from ctypes import wintypes as W
import json
import os
from pathlib import Path
import subprocess

GUEST_ROOT = Path('C:/xjy-work/xjy-web-stage1')

def validate_context(proof, root):
    message = 'ISOLATION: verified Windows Sandbox guest boundary required'
    if os.path.normcase(os.path.abspath(root)) != os.path.normcase(str(GUEST_ROOT)):
        raise RuntimeError(message)
    if not isinstance(proof, dict) or not isinstance(proof.get('userName'), str):
        raise RuntimeError(message)
    if not proof['userName'].lower().endswith('\\wdagutilityaccount') or proof.get('model') != 'Virtual Machine':
        raise RuntimeError(message)
    if proof.get('productionDrivePresent') is not False or proof.get('inputMarkerPresent') is not True:
        raise RuntimeError(message)
    count = proof.get('nonLoopbackAddressCount')
    if type(count) is not int or count != 0:
        raise RuntimeError(message)
    return proof

def read_context(root):
    root = Path(root)
    if os.path.normcase(str(root)) != os.path.normcase(str(GUEST_ROOT)):
        raise RuntimeError('ISOLATION: Windows Sandbox guest work path required before any mutation')
    for item in (root, *root.parents):
        if item.is_symlink() or os.path.isjunction(item):
            raise RuntimeError('ISOLATION: Windows Sandbox work path cannot be a link')
    kernel = C.WinDLL('kernel32', use_last_error=True)
    kernel.GetWindowsDirectoryW.argtypes = [W.LPWSTR, W.UINT]
    buffer = C.create_unicode_buffer(32768)
    size = kernel.GetWindowsDirectoryW(buffer, len(buffer))
    if not size or size >= len(buffer):
        raise RuntimeError('ISOLATION: Windows Sandbox system metadata unavailable')
    powershell = Path(buffer.value) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
    command = r"""$ErrorActionPreference='Stop'; [ordered]@{
userName=[Security.Principal.WindowsIdentity]::GetCurrent().Name;
model=(Get-CimInstance Win32_ComputerSystem).Model;
productionDrivePresent=(Test-Path -LiteralPath 'F:\');
nonLoopbackAddressCount=@(Get-NetIPAddress -ErrorAction Stop | Where-Object {$_.IPAddress -notlike '127.*' -and $_.IPAddress -ne '::1'}).Count;
inputMarkerPresent=(Test-Path -LiteralPath 'C:\xjy-input\synthetic-marker.json')
} | ConvertTo-Json -Compress"""
    result = subprocess.run([str(powershell), '-NoProfile', '-NonInteractive', '-Command', command],
                            capture_output=True, text=True, encoding='utf-8', timeout=20,
                            creationflags=0x08000000,
                            env={'SystemRoot': buffer.value, 'WINDIR': buffer.value,
                                 'PSModulePath': str(powershell.parent/'Modules')})
    if result.returncode:
        raise RuntimeError('ISOLATION: Windows Sandbox metadata probe failed')
    try:
        proof = json.loads(result.stdout.strip())
    except ValueError as error:
        raise RuntimeError('ISOLATION: Windows Sandbox metadata proof invalid') from error
    validate_context(proof, root)
    marker = json.loads((Path('C:/xjy-input')/'synthetic-marker.json').read_text('utf-8-sig'))
    identity = json.loads((root/'isolation-identity.json').read_text('utf-8-sig'))
    if marker.get('synthetic') is not True or marker.get('namespace') != identity.get('namespace'):
        raise RuntimeError('ISOLATION: Windows Sandbox input namespace does not match')
    return proof
