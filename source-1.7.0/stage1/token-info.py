"""Read the current token only; this helper has no business file operations."""
import ctypes as C
from ctypes import wintypes as W
import json
advapi = C.WinDLL('advapi32', use_last_error=True)
kernel = C.WinDLL('kernel32', use_last_error=True)
advapi.OpenProcessToken.argtypes = [W.HANDLE, W.DWORD, C.POINTER(W.HANDLE)]
advapi.IsTokenRestricted.argtypes = [W.HANDLE]
advapi.GetTokenInformation.argtypes = [W.HANDLE, C.c_int, C.c_void_p, W.DWORD, C.POINTER(W.DWORD)]
advapi.ConvertSidToStringSidW.argtypes = [C.c_void_p, C.POINTER(W.LPWSTR)]
kernel.GetCurrentProcess.restype = W.HANDLE
kernel.LocalFree.argtypes = [C.c_void_p]
class SIDATTR(C.Structure):
    _fields_ = [('Sid', C.c_void_p), ('Attributes', W.DWORD)]
def information():
  token = W.HANDLE()
  if not advapi.OpenProcessToken(kernel.GetCurrentProcess(), 8, C.byref(token)):
    raise RuntimeError('Token check failed')
  try:
    length = W.DWORD()
    advapi.GetTokenInformation(token, 11, None, 0, C.byref(length))
    buffer = C.create_string_buffer(length.value)
    if not advapi.GetTokenInformation(token, 11, buffer, length.value, C.byref(length)):
        raise RuntimeError('Restricted SID check failed')
    count = W.DWORD.from_buffer(buffer).value
    # TOKEN_GROUPS has DWORD count followed by pointer-aligned SID_AND_ATTRIBUTES.
    offset = (C.sizeof(W.DWORD) + C.alignment(SIDATTR) - 1) // C.alignment(SIDATTR) * C.alignment(SIDATTR)
    groups = C.cast(C.addressof(buffer) + offset, C.POINTER(SIDATTR))
    values = []
    for index in range(count):
        text = W.LPWSTR()
        if not advapi.ConvertSidToStringSidW(groups[index].Sid, C.byref(text)):
            raise RuntimeError('SID conversion failed')
        values.append(text.value)
        kernel.LocalFree(C.cast(text, C.c_void_p))
    return {'restricted': bool(advapi.IsTokenRestricted(token)), 'restrictingSids': values}
  finally:
    kernel.CloseHandle(token)
if __name__ == '__main__':
    print(json.dumps(information()))
