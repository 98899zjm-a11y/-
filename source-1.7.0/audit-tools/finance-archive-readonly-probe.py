"""SOURCE_ONLY, fixed Guest-only readonly archive/known-finance baseline probe.

No PyInstaller import, Analysis, archive-code exec, business import or repack.
The bounded data formats follow fixed official6.22.3 readers e5cf8/38d2c.
Only the original sandbox-context guard is compiled/executed as trusted tool
code. Only known finance source is compiled, never executed. Root runs/reviews.
"""

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GUEST = Path('C:/xjy-work/xjy-web-stage1')
PYTHON = Path('C:/Python314/python.exe')
if (os.name != 'nt' or os.path.normcase(str(ROOT)) != os.path.normcase(str(GUEST)) or
        os.path.normcase(sys.executable) != os.path.normcase(str(PYTHON)) or
        not sys.flags.isolated or not sys.flags.dont_write_bytecode or not sys.flags.no_site or sys.flags.optimize):
    raise RuntimeError('Fixed actual Guest Python -I -B -S required; no Host import/run')

import argparse
import base64
import hashlib
import importlib.util
import io
import json
import marshal
import re
import stat
import struct
import types
import zlib


SELF = 'audit-tools/finance-archive-readonly-probe.py'
RESULTS = Path('C:/xjy-results')
MANIFEST = 'project/desktop/release-modules/manifest.json'
LEDGER = 'project/desktop/release-modules/xjy-ledger'
FINANCE = 'project/desktop/legacy-source/ledger/finance.py'
PINS = {
    'stage1/sandbox-context.py': '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
    'stage1/validate-sandbox-context.py': '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207',
    MANIFEST: 'f58df7830fe5ba96ccdc36eb1e990c4b27880de7ea2c14c3c3b050617322f441',
    FINANCE: '56bcb389a21ada8c5d650e6f7ea1e81781b446f3af0a4e9b19e019930df63096',
}
EXE_SHA = 'e3b15aa649f26c927dd90360458f7bd7ecbaa405c75a4ef241fae15c5360ff5c'
PYTHON_SHA = '434b361fe0c5960d404974feed493db47f2603a1ace2574312104fbed0182c6f'
OLD_SHA = '4048318fe44ef7fc321653f31cc80807390da356fa854607070858dd8f112c76'
OLD_GIT_BLOB = 'b541c40f5facf984d9116a2e1e9d693147efc59e'
OLD_FINANCE_B64 = (
    'aW1wb3J0IGpzb24sZGF0ZXRpbWUsY2FsZW5kYXIsc3FsaXRlMyxjc3YsaW8scGF0aGxpYix1dWlkCmZyb20gZmxhc2sgaW1w'
    'b3J0IEJsdWVwcmludCxyZXF1ZXN0LHJlbmRlcl90ZW1wbGF0ZSxyZWRpcmVjdCx1cmxfZm9yLGZsYXNoLHNlbmRfZmlsZSxS'
    'ZXNwb25zZQpmcm9tIGFwcCBpbXBvcnQgZGIsYXV0aAppbXBvcnQgcmVwYWlycyBhcyByCmltcG9ydCBydWxlX2VuZ2luZSBh'
    'cyBydWxlcwoKYnA9Qmx1ZXByaW50KCdmaW5hbmNlJyxfX25hbWVfXykKRklFTERTPXsnYmFzZSc6J+W6leiWqicsJ2RheV9y'
    'YXRlJzon5pel6JaqJywnZGF5cyc6J+WHuuWLpOWkqeaVsCcsJ3BlcmNlbnQnOifmj5DmiJDmr5TkvosnLCdncmFtX3JhdGUn'
    'Oifmr4/lhYvmj5DmiJAnLCdvdmVydGltZV9ob3Vycyc6J+WKoOePreWwj+aXticsJ292ZXJ0aW1lX3JhdGUnOifliqDnj63l'
    'jZXku7cnLCdib251cyc6J+WllumHkScsJ2FsbG93YW5jZSc6J+ihpei0tCcsJ2RlZHVjdGlvbnMnOifmiaPmrL4nLCdzb2Np'
    'YWwnOifnpL7kv50nLCd0YXgnOifkuKrnqI4nfQpERUZBVUxUX0lOUFVUUz17azowLjAgZm9yIGsgaW4gRklFTERTfQpERUZB'
    'VUxUX0lOUFVUUy51cGRhdGUoZGF5cz0yNixtb2RlPSflupXolqor5Y6f5o+Q5oiQJykKU0NIRU1BPScnJwpDUkVBVEUgVEFC'
    'TEUgSUYgTk9UIEVYSVNUUyBlbXBsb3llZV9wYXlfcHJvZmlsZXMoZW1wbG95ZWUgVEVYVCBQUklNQVJZIEtFWSxpbnB1dHNf'
    'anNvbiBURVhUIE5PVCBOVUxMLHVwZGF0ZWRfYXQgVEVYVCBOT1QgTlVMTCk7CkNSRUFURSBUQUJMRSBJRiBOT1QgRVhJU1RT'
    'IHBheXJvbGxfcmVjb3JkcyhpZCBJTlRFR0VSIFBSSU1BUlkgS0VZLGVtcGxveWVlIFRFWFQgTk9UIE5VTEwsbW9udGggVEVY'
    'VCBOT1QgTlVMTCxpbnB1dHNfanNvbiBURVhUIE5PVCBOVUxMLG91dHB1dHNfanNvbiBURVhUIE5PVCBOVUxMLGJhc2lzX2pz'
    'b24gVEVYVCBOT1QgTlVMTCxiYXNpc19oYXNoIFRFWFQgTk9UIE5VTEwscnVsZV92ZXJzaW9uIElOVEVHRVIgTk9UIE5VTEws'
    'c3RhdHVzIFRFWFQgTk9UIE5VTEwgREVGQVVMVCAn6I2J56i/Jyxub3RlIFRFWFQgTk9UIE5VTEwgREVGQVVMVCAnJyxjcmVh'
    'dGVkX2F0IFRFWFQgTk9UIE5VTEwsdXBkYXRlZF9hdCBURVhUIE5PVCBOVUxMLFVOSVFVRShlbXBsb3llZSxtb250aCkpOwpD'
    'UkVBVEUgVEFCTEUgSUYgTk9UIEVYSVNUUyBleHBlbnNlcyhpZCBJTlRFR0VSIFBSSU1BUlkgS0VZLGRhdGUgVEVYVCBOT1Qg'
    'TlVMTCxlbXBsb3llZSBURVhUIE5PVCBOVUxMLGNhdGVnb3J5IFRFWFQgTk9UIE5VTEwscHVycG9zZSBURVhUIE5PVCBOVUxM'
    'LHRpY2tldCBSRUFMIE5PVCBOVUxMLGFsbG93YW5jZSBSRUFMIE5PVCBOVUxMLHBlcnNvbmFsIFJFQUwgTk9UIE5VTEwsYW1v'
    'dW50IFJFQUwgTk9UIE5VTEwscnVsZV92ZXJzaW9uIElOVEVHRVIgTk9UIE5VTEwscGF5b3V0IFRFWFQgTk9UIE5VTEwsc3Rh'
    'dHVzIFRFWFQgTk9UIE5VTEwgREVGQVVMVCAn6I2J56i/JyxyZWNlaXB0X3BhdGggVEVYVCBOT1QgTlVMTCBERUZBVUxUICcn'
    'LG5vdGUgVEVYVCBOT1QgTlVMTCBERUZBVUxUICcnLGNyZWF0ZWRfYXQgVEVYVCBOT1QgTlVMTCx1cGRhdGVkX2F0IFRFWFQg'
    'Tk9UIE5VTEwpOwpDUkVBVEUgVEFCTEUgSUYgTk9UIEVYSVNUUyBwYXlyb2xsX2V4cGVuc2VzKHBheXJvbGxfaWQgSU5URUdF'
    'UiBOT1QgTlVMTCxleHBlbnNlX2lkIElOVEVHRVIgVU5JUVVFIE5PVCBOVUxMLFBSSU1BUlkgS0VZKHBheXJvbGxfaWQsZXhw'
    'ZW5zZV9pZCkpOwonJycKVFJBTlNJVElPTlM9eyfojYnnqL8nOlsn5bey5o+Q5LqkJ10sJ+W3suaPkOS6pCc6Wyflt7LlrqHm'
    'oLgnLCflt7LpgIDlm54nXSwn5bey6YCA5ZueJzpbJ+iNieeovyddLCflt7LlrqHmoLgnOlsn5bey5pSv5LuYJywn5bey6YCA'
    '5ZueJ10sJ+W3suaUr+S7mCc6W119CgpkZWYgbW9udGhfYm91bmRzKG1vbnRoKToKICAgIHRyeTp5LG09bWFwKGludCxtb250'
    'aC5zcGxpdCgnLScpKTtzdGFydD1kYXRldGltZS5kYXRlKHksbSwxKQogICAgZXhjZXB0IChWYWx1ZUVycm9yLFR5cGVFcnJv'
    'cik6cmFpc2UgVmFsdWVFcnJvcign6K+36YCJ5oup5pyJ5pWI5pyI5Lu944CCJykKICAgIGVuZD1kYXRldGltZS5kYXRlKHks'
    'bSxjYWxlbmRhci5tb250aHJhbmdlKHksbSlbMV0pO3JldHVybiBzdGFydC5pc29mb3JtYXQoKSxlbmQuaXNvZm9ybWF0KCkK'
    'CmRlZiBwYXlyb2xsX2Jhc2lzKGMsZW1wbG95ZWUsbW9udGgscGlkPU5vbmUpOgogICAgc3RhcnQsZW5kPW1vbnRoX2JvdW5k'
    'cyhtb250aCkKICAgIHJvd3M9W2RpY3QoeCkgZm9yIHggaW4gYy5leGVjdXRlKCJTRUxFQ1QgaWQsZGF0ZSxyZWNlaXZlZCxh'
    'bW91bnRfYyxwcm9maXRfYyxjb21tX2Msd2VpZ2h0LHN0YXR1cyBGUk9NIHNhbGVzIFdIRVJFIHN0YWZmPT8gQU5EIGRhdGU+'
    'PT8gQU5EIGRhdGU8PT8gQU5EIHN0YXR1cz0n5bey5a6M5oiQJyBPUkRFUiBCWSBpZCIsKGVtcGxveWVlLHN0YXJ0LGVuZCkp'
    'XQogICAgZXhwZW5zZXM9W2RpY3QoeCkgZm9yIHggaW4gYy5leGVjdXRlKCJTRUxFQ1QgaWQsYW1vdW50LHN0YXR1cyxwYXlv'
    'dXQsZGF0ZSBGUk9NIGV4cGVuc2VzIFdIRVJFIGVtcGxveWVlPT8gQU5EIGRhdGU+PT8gQU5EIGRhdGU8PT8gQU5EIHBheW91'
    'dD0n6ZqP5bel6LWEJyBBTkQgc3RhdHVzPSflt7LlrqHmoLgnIEFORCBpZCBOT1QgSU4gKFNFTEVDVCBleHBlbnNlX2lkIEZS'
    'T00gcGF5cm9sbF9leHBlbnNlcyBXSEVSRSBwYXlyb2xsX2lkIT0/KSBPUkRFUiBCWSBpZCIsKGVtcGxveWVlLHN0YXJ0LGVu'
    'ZCxwaWQgb3IgLTEpKV0KICAgIHJldHVybiBkaWN0KHNhbGVzPXJvd3MsZXhwZW5zZXM9ZXhwZW5zZXMpCgpkZWYgc2FsYXJ5'
    'X2NvbXB1dGUoaW5wdXRzLGJhc2lzLHJ1bGVfaWQpOgogICAgdmFyaWFibGVzPXtsYWJlbDppbnB1dHNba2V5XSBmb3Iga2V5'
    'LGxhYmVsIGluIEZJRUxEUy5pdGVtcygpfQogICAgdmFyaWFibGVzLnVwZGF0ZSjorqHolqrmlrnlvI89aW5wdXRzWydtb2Rl'
    'J10s6ZSA5ZSu6YeR6aKdPXN1bSh4WydhbW91bnRfYyddIGZvciB4IGluIGJhc2lzWydzYWxlcyddKSzplIDllK7liKnmtqY9'
    'c3VtKHhbJ3Byb2ZpdF9jJ10gZm9yIHggaW4gYmFzaXNbJ3NhbGVzJ10pLAogICAgICAgICAgICAgICAgICAgICDplIDllK7l'
    'hYvph409c3VtKHhbJ3dlaWdodCddIGZvciB4IGluIGJhc2lzWydzYWxlcyddKSzljp/mj5DmiJA9c3VtKHhbJ2NvbW1fYydd'
    'IGZvciB4IGluIGJhc2lzWydzYWxlcyddKSzlt6XotYTmiqXplIA9c3VtKHhbJ2Ftb3VudCddIGZvciB4IGluIGJhc2lzWydl'
    'eHBlbnNlcyddKSkKICAgIHZhbHVlcyx2ZXJzaW9uPXJ1bGVzLmNvbXB1dGUoJ3BheXJvbGwnLHZhcmlhYmxlcyxydWxlX2lk'
    'KQogICAgcmV0dXJuIHtrOnJvdW5kKHYsMikgZm9yIGssdiBpbiB2YWx1ZXMuaXRlbXMoKX0sdmFyaWFibGVzLHZlcnNpb24K'
    'CmRlZiBzbmFwc2hvdChlbXBsb3llZSxtb250aCxiYXNpcyxyZWNvcmQpOgogICAgcmV0dXJuIHIuc2lnbmVyKCkuZHVtcHMo'
    'eydlbXBsb3llZSc6ZW1wbG95ZWUsJ21vbnRoJzptb250aCwnYmFzaXMnOnIuZGlnZXN0KGJhc2lzKSwncmVjb3JkJzpyLmRp'
    'Z2VzdChyZWNvcmQpIGlmIHJlY29yZCBlbHNlIE5vbmV9KQoKQGJwLnJvdXRlKCcvcGF5cm9sbCcsbWV0aG9kcz1bJ0dFVCcs'
    'J1BPU1QnXSkKQGF1dGgubG9naW5fcmVxdWlyZWQKZGVmIHBheXJvbGwoKToKICAgIGVtcGxveWVlPXJlcXVlc3QudmFsdWVz'
    'LmdldCgnZW1wbG95ZWUnLCcnKTttb250aD1yZXF1ZXN0LnZhbHVlcy5nZXQoJ21vbnRoJyxkYXRldGltZS5kYXRlLnRvZGF5'
    'KCkuc3RyZnRpbWUoJyVZLSVtJykpCiAgICBuYW1lcz1kYi5uYW1lc19vZignc3RhZmYnKTtlbXBsb3llZT1lbXBsb3llZSBv'
    'ciAobmFtZXNbMF0gaWYgbmFtZXMgZWxzZSAnJykKICAgIGlucHV0cz1kaWN0KERFRkFVTFRfSU5QVVRTKTtyZWNvcmQ9Tm9u'
    'ZTtvdXRwdXRzPXt9O3ZhcmlhYmxlcz17fTtiYXNpcz17fTt2ZXJzaW9uPXJ1bGVzLnJ1bGUoJ3BheXJvbGwnKVsnaWQnXTt0'
    'b2tlbj0nJwogICAgdHJ5OgogICAgICAgIHdpdGggci50cmFuc2FjdGlvbigpIGFzIGM6CiAgICAgICAgICAgIGZvdW5kPWMu'
    'ZXhlY3V0ZSgnU0VMRUNUICogRlJPTSBwYXlyb2xsX3JlY29yZHMgV0hFUkUgZW1wbG95ZWU9PyBBTkQgbW9udGg9PycsKGVt'
    'cGxveWVlLG1vbnRoKSkuZmV0Y2hvbmUoKQogICAgICAgICAgICByZWNvcmQ9ZGljdChmb3VuZCkgaWYgZm91bmQgZWxzZSBO'
    'b25lCiAgICAgICAgICAgIHByb2ZpbGU9Yy5leGVjdXRlKCdTRUxFQ1QgaW5wdXRzX2pzb24gRlJPTSBlbXBsb3llZV9wYXlf'
    'cHJvZmlsZXMgV0hFUkUgZW1wbG95ZWU9PycsKGVtcGxveWVlLCkpLmZldGNob25lKCkKICAgICAgICAgICAgaWYgcHJvZmls'
    'ZTppbnB1dHMudXBkYXRlKGpzb24ubG9hZHMocHJvZmlsZVswXSkpCiAgICAgICAgICAgIGlmIHJlY29yZDppbnB1dHMudXBk'
    'YXRlKGpzb24ubG9hZHMocmVjb3JkWydpbnB1dHNfanNvbiddKSk7dmVyc2lvbj1yZWNvcmRbJ3J1bGVfdmVyc2lvbiddCiAg'
    'ICAgICAgICAgIGJhc2lzPXBheXJvbGxfYmFzaXMoYyxlbXBsb3llZSxtb250aCxyZWNvcmRbJ2lkJ10gaWYgcmVjb3JkIGVs'
    'c2UgTm9uZSkKICAgICAgICAgICAgaWYgcmVxdWVzdC5tZXRob2Q9PSdQT1NUJzoKICAgICAgICAgICAgICAgIGlmIG5vdCBl'
    'bXBsb3llZSBvciBlbXBsb3llZSBub3QgaW4gci5wcmVzZXJ2ZV9jaG9pY2VzKG5hbWVzLFtyZWNvcmRbJ2VtcGxveWVlJ11d'
    'IGlmIHJlY29yZCBlbHNlIFtdKTpyYWlzZSBWYWx1ZUVycm9yKCfor7fpgInmi6nlt7LnmbvorrDnmoTkurrlkZjjgIInKQog'
    'ICAgICAgICAgICAgICAgaWYgcmVjb3JkIGFuZCByZWNvcmRbJ3N0YXR1cyddIT0n6I2J56i/JzpyYWlzZSBWYWx1ZUVycm9y'
    'KCflt7Lnoa7orqTmiJblt7Llj5HmlL7nmoTlt6XotYTkuI3og73nm7TmjqXmlLnliqjvvIzlhYjlsIblt7Lnoa7orqTlt6Xo'
    'tYTpgIDlm57ojYnnqL/jgIInKQogICAgICAgICAgICAgICAgaW5wdXRzPXtrZXk6ci5udW1iZXIocmVxdWVzdC5mb3JtLmdl'
    'dChrZXkpKSBmb3Iga2V5IGluIEZJRUxEU307aW5wdXRzWydtb2RlJ109cmVxdWVzdC5mb3JtLmdldCgnbW9kZScsJycpCiAg'
    'ICAgICAgICAgICAgICBpZiBpbnB1dHNbJ21vZGUnXSBub3QgaW4gcnVsZXMuTU9ERVM6cmFpc2UgVmFsdWVFcnJvcign6K+3'
    '6YCJ5oup6K6h6Jaq5pa55byP44CCJykKICAgICAgICAgICAgICAgIGlmIGlucHV0c1snZGF5cyddPDAgb3IgaW5wdXRzWydv'
    'dmVydGltZV9ob3VycyddPDA6cmFpc2UgVmFsdWVFcnJvcign5Ye65Yuk5aSp5pWw5ZKM5Yqg54+t5bCP5pe25LiN6IO95Li6'
    '6LSf5pWw44CCJykKICAgICAgICAgICAgICAgIGlmIHJlcXVlc3QuZm9ybS5nZXQoJ2N1cnJlbnRfcnVsZXMnKSBvciBub3Qg'
    'cmVjb3JkOnZlcnNpb249cnVsZXMucnVsZSgncGF5cm9sbCcsYz1jKVsnaWQnXQogICAgICAgICAgICAgICAgYWN0aW9uPXJl'
    'cXVlc3QuZm9ybS5nZXQoJ2FjdCcsJ3ByZXZpZXcnKQogICAgICAgICAgICAgICAgaWYgYWN0aW9uPT0nc2F2ZSc6CiAgICAg'
    'ICAgICAgICAgICAgICAgdHJ5OnByZXZpb3VzPXIuc2lnbmVyKCkubG9hZHMocmVxdWVzdC5mb3JtLmdldCgnc25hcHNob3Qn'
    'LCcnKSkKICAgICAgICAgICAgICAgICAgICBleGNlcHQgRXhjZXB0aW9uOnJhaXNlIHIuQ29uZmxpY3QoJ+ivt+WFiOmAieaL'
    'qeS6uuWRmOWSjOaciOS7veOAgeivleeul++8jOWGjeS/neWtmOW3pei1hOOAgicpCiAgICAgICAgICAgICAgICAgICAgZXhw'
    'ZWN0ZWQ9eydlbXBsb3llZSc6ZW1wbG95ZWUsJ21vbnRoJzptb250aCwnYmFzaXMnOnIuZGlnZXN0KGJhc2lzKSwncmVjb3Jk'
    'JzpyLmRpZ2VzdChyZWNvcmQpIGlmIHJlY29yZCBlbHNlIE5vbmV9CiAgICAgICAgICAgICAgICAgICAgaWYgcHJldmlvdXMh'
    'PWV4cGVjdGVkOnJhaXNlIHIuQ29uZmxpY3QoJ+mUgOWUruOAgeaKpemUgOaIluW3pei1hOiusOW9leW3suacieWPmOWMlu+8'
    'jOivt+mHjeaWsOivleeul+WQjuS/neWtmOOAgicpCiAgICAgICAgICAgICAgICBvdXRwdXRzLHZhcmlhYmxlcyx2ZXJzaW9u'
    'PXNhbGFyeV9jb21wdXRlKGlucHV0cyxiYXNpcyx2ZXJzaW9uKQogICAgICAgICAgICAgICAgaWYgYWN0aW9uPT0nc2F2ZSc6'
    'CiAgICAgICAgICAgICAgICAgICAgdmFscz1kaWN0KGVtcGxveWVlPWVtcGxveWVlLG1vbnRoPW1vbnRoLGlucHV0c19qc29u'
    'PWpzb24uZHVtcHMoaW5wdXRzLGVuc3VyZV9hc2NpaT1GYWxzZSksb3V0cHV0c19qc29uPWpzb24uZHVtcHMob3V0cHV0cyxl'
    'bnN1cmVfYXNjaWk9RmFsc2UpLGJhc2lzX2pzb249anNvbi5kdW1wcyhiYXNpcyxlbnN1cmVfYXNjaWk9RmFsc2UpLGJhc2lz'
    'X2hhc2g9ci5kaWdlc3QoYmFzaXMpLHJ1bGVfdmVyc2lvbj12ZXJzaW9uLHN0YXR1cz0n6I2J56i/Jyxub3RlPXJlcXVlc3Qu'
    'Zm9ybS5nZXQoJ25vdGUnLCcnKSx1cGRhdGVkX2F0PWRiLm5vd19zdHIoKSkKICAgICAgICAgICAgICAgICAgICBwaWQ9ci53'
    'cml0ZV9yb3coYywncGF5cm9sbF9yZWNvcmRzJyx2YWxzLHJlY29yZCkKICAgICAgICAgICAgICAgICAgICBjLmV4ZWN1dGUo'
    'J0RFTEVURSBGUk9NIHBheXJvbGxfZXhwZW5zZXMgV0hFUkUgcGF5cm9sbF9pZD0/JywocGlkLCkpCiAgICAgICAgICAgICAg'
    'ICAgICAgZm9yIGV4cCBpbiBiYXNpc1snZXhwZW5zZXMnXTpjLmV4ZWN1dGUoJ0lOU0VSVCBJTlRPIHBheXJvbGxfZXhwZW5z'
    'ZXMocGF5cm9sbF9pZCxleHBlbnNlX2lkKSBWQUxVRVMoPyw/KScsKHBpZCxleHBbJ2lkJ10pKQogICAgICAgICAgICAgICAg'
    'ICAgIGlmIHJlcXVlc3QuZm9ybS5nZXQoJ3NhdmVfcHJvZmlsZScpOmMuZXhlY3V0ZSgnSU5TRVJUIElOVE8gZW1wbG95ZWVf'
    'cGF5X3Byb2ZpbGVzKGVtcGxveWVlLGlucHV0c19qc29uLHVwZGF0ZWRfYXQpIFZBTFVFUyg/LD8sPykgT04gQ09ORkxJQ1Qo'
    'ZW1wbG95ZWUpIERPIFVQREFURSBTRVQgaW5wdXRzX2pzb249ZXhjbHVkZWQuaW5wdXRzX2pzb24sdXBkYXRlZF9hdD1leGNs'
    'dWRlZC51cGRhdGVkX2F0JywoZW1wbG95ZWUsanNvbi5kdW1wcyhpbnB1dHMsZW5zdXJlX2FzY2lpPUZhbHNlKSxkYi5ub3df'
    'c3RyKCkpKQogICAgICAgICAgICAgICAgICAgIGZsYXNoKCflt6XotYTojYnnqL/lt7Lkv53lrZjvvIzlt7Llm7rlrprplIDl'
    'lK7kvp3mja7lj4rop4TliJnniYjmnKzjgIInLCdvaycpCiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHJlZGlyZWN0KHVy'
    'bF9mb3IoJ2ZpbmFuY2UucGF5cm9sbCcsZW1wbG95ZWU9ZW1wbG95ZWUsbW9udGg9bW9udGgpKQogICAgICAgICAgICBpZiBy'
    'ZWNvcmQgYW5kIHJlY29yZFsnc3RhdHVzJ10hPSfojYnnqL8nOgogICAgICAgICAgICAgICAgb3V0cHV0cz1qc29uLmxvYWRz'
    'KHJlY29yZFsnb3V0cHV0c19qc29uJ10pCiAgICAgICAgICAgICAgICBiYXNpcz1qc29uLmxvYWRzKHJlY29yZFsnYmFzaXNf'
    'anNvbiddKQogICAgICAgICAgICAgICAgXyx2YXJpYWJsZXMsXz1zYWxhcnlfY29tcHV0ZShqc29uLmxvYWRzKHJlY29yZFsn'
    'aW5wdXRzX2pzb24nXSksYmFzaXMscmVjb3JkWydydWxlX3ZlcnNpb24nXSkKICAgICAgICAgICAgZWxpZiBub3Qgb3V0cHV0'
    'czpvdXRwdXRzLHZhcmlhYmxlcyx2ZXJzaW9uPXNhbGFyeV9jb21wdXRlKGlucHV0cyxiYXNpcyx2ZXJzaW9uKQogICAgICAg'
    'ICAgICB0b2tlbj1zbmFwc2hvdChlbXBsb3llZSxtb250aCxiYXNpcyxyZWNvcmQpCiAgICBleGNlcHQgKFZhbHVlRXJyb3Is'
    'c3FsaXRlMy5FcnJvcikgYXMgZTpmbGFzaChzdHIoZSksJ2Vycm9yJykKICAgIHJvd3M9W2RpY3QoeCkgZm9yIHggaW4gZGIu'
    'cXVlcnkoJ1NFTEVDVCAqIEZST00gcGF5cm9sbF9yZWNvcmRzIFdIRVJFIG1vbnRoPT8gT1JERVIgQlkgZW1wbG95ZWUnLCht'
    'b250aCwpKV0KICAgIGZvciB4IGluIHJvd3M6eFsnb3V0cHV0cyddPWpzb24ubG9hZHMoeFsnb3V0cHV0c19qc29uJ10pCiAg'
    'ICByZXR1cm4gcmVuZGVyX3RlbXBsYXRlKCdwYXlyb2xsLmh0bWwnLG5hbWVzPXIucHJlc2VydmVfY2hvaWNlcyhuYW1lcyxb'
    'ZW1wbG95ZWVdKSxlbXBsb3llZT1lbXBsb3llZSxtb250aD1tb250aCxpbnB1dHM9aW5wdXRzLGZpZWxkcz1GSUVMRFMsCiAg'
    'ICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVzPXJ1bGVzLk1PREVTLHJlY29yZD1yZWNvcmQsb3V0cHV0cz1vdXRwdXRz'
    'LHZhcmlhYmxlcz12YXJpYWJsZXMsYmFzaXM9YmFzaXMsdmVyc2lvbj12ZXJzaW9uLHNuYXBzaG90PXRva2VuLHJvd3M9cm93'
    'cykKCkBicC5wb3N0KCcvcGF5cm9sbC88aW50OnJpZD4vc3RhdHVzJykKQGF1dGgubG9naW5fcmVxdWlyZWQKZGVmIHBheXJv'
    'bGxfc3RhdHVzKHJpZCk6CiAgICBvbGQ9e30KICAgIHRyeToKICAgICAgICB3aXRoIHIudHJhbnNhY3Rpb24oKSBhcyBjOgog'
    'ICAgICAgICAgICBvbGQ9ci5leGlzdGluZyhjLCdwYXlyb2xsX3JlY29yZHMnLHJpZCk7ci5jaGVja190b2tlbigncGF5cm9s'
    'bF9yZWNvcmRzJyxvbGQscmVxdWVzdC5mb3JtLmdldCgnc25hcHNob3QnKSkKICAgICAgICAgICAgdGFyZ2V0PXJlcXVlc3Qu'
    'Zm9ybS5nZXQoJ3N0YXR1cycpCiAgICAgICAgICAgIGFsbG93ZWQ9eyfojYnnqL8nOlsn5bey56Gu6K6kJ10sJ+W3suehruiu'
    'pCc6WyfojYnnqL8nLCflt7Llj5HmlL4nXSwn5bey5Y+R5pS+JzpbXX0KICAgICAgICAgICAgaWYgdGFyZ2V0IG5vdCBpbiBh'
    'bGxvd2VkW29sZFsnc3RhdHVzJ11dOnJhaXNlIFZhbHVlRXJyb3IoJ+S4jeWFgeiuuOi/meS4quW3pei1hOeKtuaAgeWPmOab'
    'tOOAgicpCiAgICAgICAgICAgIGlmIHRhcmdldCBpbiBbJ+W3suehruiupCcsJ+W3suWPkeaUviddOgogICAgICAgICAgICAg'
    'ICAgYmFzaXM9cGF5cm9sbF9iYXNpcyhjLG9sZFsnZW1wbG95ZWUnXSxvbGRbJ21vbnRoJ10scmlkKQogICAgICAgICAgICAg'
    'ICAgaWYgci5kaWdlc3QoYmFzaXMpIT1vbGRbJ2Jhc2lzX2hhc2gnXTpyYWlzZSByLkNvbmZsaWN0KCfplIDllK7miJbmiqXp'
    'lIDlt7Llj5jljJbvvIzlhYjpgIDlm57ojYnnqL/ph43mlrDor5Xnrpflubbkv53lrZjjgIInKQogICAgICAgICAgICBpZiB0'
    'YXJnZXQ9PSflt7Llj5HmlL4nOgogICAgICAgICAgICAgICAgaWYganNvbi5sb2FkcyhvbGRbJ291dHB1dHNfanNvbiddKVsn'
    '5pys5qyh5pSv5LuYJ108MDpyYWlzZSBWYWx1ZUVycm9yKCfmlK/ku5jph5Hpop3kuLrotJ/vvIzor7flhYjmoLjlr7nmiaPm'
    'rL7lkozop4TliJnjgIInKQogICAgICAgICAgICAgICAgZXhwZW5zZXM9W2RpY3QoeCkgZm9yIHggaW4gYy5leGVjdXRlKCdT'
    'RUxFQ1QgZS4qIEZST00gZXhwZW5zZXMgZSBKT0lOIHBheXJvbGxfZXhwZW5zZXMgcCBPTiBwLmV4cGVuc2VfaWQ9ZS5pZCBX'
    'SEVSRSBwLnBheXJvbGxfaWQ9PycsKHJpZCwpKV0KICAgICAgICAgICAgICAgIGZvciBleHBlbnNlIGluIGV4cGVuc2VzOgog'
    'ICAgICAgICAgICAgICAgICAgIGlmIGV4cGVuc2VbJ3N0YXR1cyddIT0n5bey5a6h5qC4JzpyYWlzZSByLkNvbmZsaWN0KCfp'
    'mo/lt6XotYTmiqXplIDnirbmgIHlj5HnlJ/lj5jljJbvvIzor7fph43mlrDmoLjlr7njgIInKQogICAgICAgICAgICAgICAg'
    'ICAgIHIud3JpdGVfcm93KGMsJ2V4cGVuc2VzJyxkaWN0KHN0YXR1cz0n5bey5pSv5LuYJyx1cGRhdGVkX2F0PWRiLm5vd19z'
    'dHIoKSksZXhwZW5zZSkKICAgICAgICAgICAgci53cml0ZV9yb3coYywncGF5cm9sbF9yZWNvcmRzJyxkaWN0KHN0YXR1cz10'
    'YXJnZXQsdXBkYXRlZF9hdD1kYi5ub3dfc3RyKCkpLG9sZCkKICAgICAgICBmbGFzaCgn5bel6LWE54q25oCB5bey5pu05paw'
    '44CCJywnb2snKQogICAgZXhjZXB0IChWYWx1ZUVycm9yLHNxbGl0ZTMuRXJyb3IpIGFzIGU6Zmxhc2goc3RyKGUpLCdlcnJv'
    'cicpCiAgICByZXR1cm4gcmVkaXJlY3QodXJsX2ZvcignZmluYW5jZS5wYXlyb2xsJyxlbXBsb3llZT1vbGQuZ2V0KCdlbXBs'
    'b3llZScsJycpLG1vbnRoPW9sZC5nZXQoJ21vbnRoJyxkYXRldGltZS5kYXRlLnRvZGF5KCkuc3RyZnRpbWUoJyVZLSVtJykp'
    'KSkKCkBicC5nZXQoJy9wYXlyb2xsL2V4cG9ydC5jc3YnKQpAYXV0aC5sb2dpbl9yZXF1aXJlZApkZWYgcGF5cm9sbF9leHBv'
    'cnQoKToKICAgIG1vbnRoPXJlcXVlc3QuYXJncy5nZXQoJ21vbnRoJyxkYXRldGltZS5kYXRlLnRvZGF5KCkuc3RyZnRpbWUo'
    'JyVZLSVtJykpO3Jvd3M9ZGIucXVlcnkoJ1NFTEVDVCAqIEZST00gcGF5cm9sbF9yZWNvcmRzIFdIRVJFIG1vbnRoPT8gT1JE'
    'RVIgQlkgZW1wbG95ZWUnLChtb250aCwpKQogICAgZGF0YT1pby5TdHJpbmdJTygpO3dyaXRlcj1jc3Yud3JpdGVyKGRhdGEp'
    'O3dyaXRlci53cml0ZXJvdyhbJ+aciOS7vScsJ+S6uuWRmCcsJ+iuoeiWquaWueW8jycsJ+W6lOWPkeW3pei1hCcsJ+aJo+as'
    'vicsJ+WunuWPkeW3pei1hCcsJ+W3pei1hOaKpemUgCcsJ+acrOasoeaUr+S7mCcsJ+eKtuaAgScsJ+inhOWImeeJiOacrCdd'
    'KQogICAgZm9yIHJvdyBpbiByb3dzOgogICAgICAgIGlucHV0cz1qc29uLmxvYWRzKHJvd1snaW5wdXRzX2pzb24nXSk7b3V0'
    'cHV0cz1qc29uLmxvYWRzKHJvd1snb3V0cHV0c19qc29uJ10pO3dyaXRlci53cml0ZXJvdyhbbW9udGgscm93WydlbXBsb3ll'
    'ZSddLGlucHV0c1snbW9kZSddLG91dHB1dHNbJ+W6lOWPkeW3pei1hCddLG91dHB1dHNbJ+W3pei1hOaJo+asviddLG91dHB1'
    'dHNbJ+WunuWPkeW3pei1hCddLG91dHB1dHNbJ+acrOasoeaUr+S7mCddLW91dHB1dHNbJ+WunuWPkeW3pei1hCddLG91dHB1'
    'dHNbJ+acrOasoeaUr+S7mCddLHJvd1snc3RhdHVzJ10scm93WydydWxlX3ZlcnNpb24nXV0pCiAgICByZXR1cm4gUmVzcG9u'
    'c2UoJ1x1ZmVmZicrZGF0YS5nZXR2YWx1ZSgpLG1pbWV0eXBlPSd0ZXh0L2NzdjsgY2hhcnNldD11dGYtOCcsaGVhZGVycz17'
    'J0NvbnRlbnQtRGlzcG9zaXRpb24nOidhdHRhY2htZW50OyBmaWxlbmFtZT1wYXlyb2xsXycrbW9udGgrJy5jc3YnfSkKCkBi'
    'cC5yb3V0ZSgnL2V4cGVuc2VzJyxtZXRob2RzPVsnR0VUJywnUE9TVCddKQpAYXV0aC5sb2dpbl9yZXF1aXJlZApkZWYgZXhw'
    'ZW5zZXMoKToKICAgIGVkaXQ9Tm9uZTtjcmVhdGVkX3JlY2VpcHQ9Tm9uZQogICAgdHJ5OgogICAgICAgIGlmIHJlcXVlc3Qu'
    'bWV0aG9kPT0nUE9TVCc6CiAgICAgICAgICAgIHdpdGggci50cmFuc2FjdGlvbigpIGFzIGM6CiAgICAgICAgICAgICAgICBy'
    'aWQ9cmVxdWVzdC5mb3JtLmdldCgnaWQnKTtlZGl0PXIuZXhpc3RpbmcoYywnZXhwZW5zZXMnLGludChyaWQpKSBpZiByaWQg'
    'ZWxzZSBOb25lCiAgICAgICAgICAgICAgICBpZiBlZGl0OgogICAgICAgICAgICAgICAgICAgIHIuY2hlY2tfdG9rZW4oJ2V4'
    'cGVuc2VzJyxlZGl0LHJlcXVlc3QuZm9ybS5nZXQoJ3NuYXBzaG90JykpCiAgICAgICAgICAgICAgICAgICAgaWYgZWRpdFsn'
    'c3RhdHVzJ10gbm90IGluIFsn6I2J56i/Jywn5bey6YCA5ZueJ106cmFpc2UgVmFsdWVFcnJvcign5bey5o+Q5Lqk44CB5bey'
    '5a6h5qC45oiW5bey5pSv5LuY55qE5oql6ZSA5LiN6IO955u05o6l5L+u5pS544CCJykKICAgICAgICAgICAgICAgICAgICBp'
    'ZiBjLmV4ZWN1dGUoJ1NFTEVDVCBwYXlyb2xsX2lkIEZST00gcGF5cm9sbF9leHBlbnNlcyBXSEVSRSBleHBlbnNlX2lkPT8n'
    'LChlZGl0WydpZCddLCkpLmZldGNob25lKCk6cmFpc2UgVmFsdWVFcnJvcign5q2k5oql6ZSA5bey5YWz6IGU5bel6LWE77yM'
    '6K+35YWI5Zyo5bel6LWE6I2J56i/6YeN5paw6K+V566X5Y+W5raI5YWz6IGU44CCJykKICAgICAgICAgICAgICAgIG51bXM9'
    'e2tleTpyLm51bWJlcihyZXF1ZXN0LmZvcm0uZ2V0KGtleSkpIGZvciBrZXkgaW4gWyd0aWNrZXQnLCdhbGxvd2FuY2UnLCdw'
    'ZXJzb25hbCddfQogICAgICAgICAgICAgICAgaWYgbWluKG51bXMudmFsdWVzKCkpPDA6cmFpc2UgVmFsdWVFcnJvcign56Wo'
    '5o2u6YeR6aKd44CB6KGl6LS05ZKM5Liq5Lq65om/5ouF5LiN6IO95Li66LSf5pWw44CCJykKICAgICAgICAgICAgICAgIHZl'
    'cnNpb249ZWRpdFsncnVsZV92ZXJzaW9uJ10gaWYgZWRpdCBhbmQgbm90IHJlcXVlc3QuZm9ybS5nZXQoJ2N1cnJlbnRfcnVs'
    'ZXMnKSBlbHNlIE5vbmUKICAgICAgICAgICAgICAgIHJlc3VsdCx2ZXJzaW9uPXJ1bGVzLmNvbXB1dGUoJ2V4cGVuc2UnLHsn'
    '56Wo5o2u6YeR6aKdJzpudW1zWyd0aWNrZXQnXSwn6KGl6LS0JzpudW1zWydhbGxvd2FuY2UnXSwn5Liq5Lq65om/5ouFJzpu'
    'dW1zWydwZXJzb25hbCddfSx2ZXJzaW9uKQogICAgICAgICAgICAgICAgaWYgcmVzdWx0WyfmiqXplIDph5Hpop0nXTwwOnJh'
    'aXNlIFZhbHVlRXJyb3IoJ+aKpemUgOmHkemineS4jeiDveS4uui0n++8jOivt+aguOWvueS4quS6uuaJv+aLheaIluinhOWI'
    'meOAgicpCiAgICAgICAgICAgICAgICBlbXBsb3llZT1yZXF1ZXN0LmZvcm0uZ2V0KCdlbXBsb3llZScsJycpLnN0cmlwKCk7'
    'cHVycG9zZT1yZXF1ZXN0LmZvcm0uZ2V0KCdwdXJwb3NlJywnJykuc3RyaXAoKQogICAgICAgICAgICAgICAgaWYgbm90IGVt'
    'cGxveWVlIG9yIG5vdCBwdXJwb3NlOnJhaXNlIFZhbHVlRXJyb3IoJ+S6uuWRmOWSjOaKpemUgOS6i+eUseS4jeiDveS4uuep'
    'uuOAgicpCiAgICAgICAgICAgICAgICBwYXlvdXQ9cmVxdWVzdC5mb3JtLmdldCgncGF5b3V0Jywn5Y2V54us5pSv5LuYJykK'
    'ICAgICAgICAgICAgICAgIGlmIHBheW91dCBub3QgaW4gWyfljZXni6zmlK/ku5gnLCfpmo/lt6XotYQnXTpyYWlzZSBWYWx1'
    'ZUVycm9yKCfor7fpgInmi6nmlK/ku5jmlrnlvI/jgIInKQogICAgICAgICAgICAgICAgcmVjZWlwdD1lZGl0WydyZWNlaXB0'
    'X3BhdGgnXSBpZiBlZGl0IGVsc2UgJyc7dXBsb2FkPXJlcXVlc3QuZmlsZXMuZ2V0KCdyZWNlaXB0JykKICAgICAgICAgICAg'
    'ICAgIGlmIHVwbG9hZCBhbmQgdXBsb2FkLmZpbGVuYW1lOgogICAgICAgICAgICAgICAgICAgIHN1ZmZpeD1wYXRobGliLlBh'
    'dGgodXBsb2FkLmZpbGVuYW1lKS5zdWZmaXgubG93ZXIoKQogICAgICAgICAgICAgICAgICAgIGlmIHN1ZmZpeCBub3QgaW4g'
    'WycucGRmJywnLnBuZycsJy5qcGcnLCcuanBlZyddOnJhaXNlIFZhbHVlRXJyb3IoJ+WHreivgeS7heaUr+aMgSBQREbjgIFQ'
    'Tkcg5oiWIEpQR+OAgicpCiAgICAgICAgICAgICAgICAgICAgZm9sZGVyPXIuY29uZmlnLmRhdGFfZGlyKCkvJ+aKpemUgOWH'
    'reivgSc7Zm9sZGVyLm1rZGlyKGV4aXN0X29rPVRydWUpO2NyZWF0ZWRfcmVjZWlwdD1mb2xkZXIvKHV1aWQudXVpZDQoKS5o'
    'ZXgrc3VmZml4KQogICAgICAgICAgICAgICAgICAgIHVwbG9hZC5zYXZlKGNyZWF0ZWRfcmVjZWlwdCkKICAgICAgICAgICAg'
    'ICAgICAgICBpZiBjcmVhdGVkX3JlY2VpcHQuc3RhdCgpLnN0X3NpemU+MTIqMTAyNCoxMDI0OnJhaXNlIFZhbHVlRXJyb3Io'
    'J+WHreivgeS4jeiDvei2hei/hyAxMk1C44CCJykKICAgICAgICAgICAgICAgICAgICByZWNlaXB0PXN0cihjcmVhdGVkX3Jl'
    'Y2VpcHQucmVsYXRpdmVfdG8oci5jb25maWcuZGF0YV9kaXIoKSkpCiAgICAgICAgICAgICAgICB2YWxzPWRpY3QoZGF0ZT1y'
    'LnZhbGlkYXRlX2RhdGUocmVxdWVzdC5mb3JtLmdldCgnZGF0ZScpKSxlbXBsb3llZT1lbXBsb3llZSxjYXRlZ29yeT1yZXF1'
    'ZXN0LmZvcm0uZ2V0KCdjYXRlZ29yeScsJ+WFtuS7licpLHB1cnBvc2U9cHVycG9zZSwqKm51bXMsYW1vdW50PXJvdW5kKHJl'
    'c3VsdFsn5oql6ZSA6YeR6aKdJ10sMikscnVsZV92ZXJzaW9uPXZlcnNpb24scGF5b3V0PXBheW91dCxzdGF0dXM9J+iNieeo'
    'vycscmVjZWlwdF9wYXRoPXJlY2VpcHQsbm90ZT1yZXF1ZXN0LmZvcm0uZ2V0KCdub3RlJywnJyksdXBkYXRlZF9hdD1kYi5u'
    'b3dfc3RyKCkpCiAgICAgICAgICAgICAgICByLndyaXRlX3JvdyhjLCdleHBlbnNlcycsdmFscyxlZGl0KQogICAgICAgICAg'
    'ICBmbGFzaCgn5oql6ZSA6I2J56i/5bey5L+d5a2Y44CCJywnb2snKTtyZXR1cm4gcmVkaXJlY3QodXJsX2ZvcignZmluYW5j'
    'ZS5leHBlbnNlcycpKQogICAgICAgIGlmIHJlcXVlc3QuYXJncy5nZXQoJ2VkaXQnKTplZGl0PWRpY3QoZGIucXVlcnkoJ1NF'
    'TEVDVCAqIEZST00gZXhwZW5zZXMgV0hFUkUgaWQ9PycsKHJlcXVlc3QuYXJnc1snZWRpdCddLCksb25lPVRydWUpIG9yIHt9'
    'KSBvciBOb25lCiAgICBleGNlcHQgKFZhbHVlRXJyb3Isc3FsaXRlMy5FcnJvcikgYXMgZToKICAgICAgICBpZiBjcmVhdGVk'
    'X3JlY2VpcHQgYW5kIGNyZWF0ZWRfcmVjZWlwdC5leGlzdHMoKTpjcmVhdGVkX3JlY2VpcHQudW5saW5rKCkKICAgICAgICBm'
    'bGFzaChzdHIoZSksJ2Vycm9yJykKICAgIHdoZXJlPScnO2FyZ3M9W10KICAgIGZvciBmaWVsZCBpbiBbJ2VtcGxveWVlJywn'
    'c3RhdHVzJ106CiAgICAgICAgaWYgcmVxdWVzdC5hcmdzLmdldChmaWVsZCk6d2hlcmUrPSgnIEFORCAnIGlmIHdoZXJlIGVs'
    'c2UgJyBXSEVSRSAnKStmaWVsZCsnPT8nO2FyZ3MuYXBwZW5kKHJlcXVlc3QuYXJnc1tmaWVsZF0pCiAgICByb3dzPVtkaWN0'
    'KHgpIGZvciB4IGluIGRiLnF1ZXJ5KCdTRUxFQ1QgKiBGUk9NIGV4cGVuc2VzJyt3aGVyZSsnIE9SREVSIEJZIGRhdGUgREVT'
    'QyxpZCBERVNDJyx0dXBsZShhcmdzKSldCiAgICByZXR1cm4gcmVuZGVyX3RlbXBsYXRlKCdleHBlbnNlcy5odG1sJyxyb3dz'
    'PXJvd3MsZWRpdD1lZGl0LG5hbWVzPXIucHJlc2VydmVfY2hvaWNlcyhkYi5uYW1lc19vZignc3RhZmYnKSxbZWRpdFsnZW1w'
    'bG95ZWUnXV0gaWYgZWRpdCBlbHNlIFtdKSwKICAgICAgICAgICAgICAgICAgICAgICAgICAgY2F0ZWdvcmllcz1bJ+S6pOmA'
    'micsJ+mkkOmlricsJ+S9j+WuvycsJ+WKnuWFrCcsJ+mHh+i0rScsJ+W3ruaXhScsJ+WFtuS7liddLHRvdGFsPXN1bSh4Wydh'
    'bW91bnQnXSBmb3IgeCBpbiByb3dzKSx0b2RheT1kYXRldGltZS5kYXRlLnRvZGF5KCkuaXNvZm9ybWF0KCksdHJhbnNpdGlv'
    'bnM9VFJBTlNJVElPTlMpCgpAYnAucG9zdCgnL2V4cGVuc2VzLzxpbnQ6cmlkPi9zdGF0dXMnKQpAYXV0aC5sb2dpbl9yZXF1'
    'aXJlZApkZWYgZXhwZW5zZV9zdGF0dXMocmlkKToKICAgIHRyeToKICAgICAgICB3aXRoIHIudHJhbnNhY3Rpb24oKSBhcyBj'
    'OgogICAgICAgICAgICBvbGQ9ci5leGlzdGluZyhjLCdleHBlbnNlcycscmlkKTtyLmNoZWNrX3Rva2VuKCdleHBlbnNlcycs'
    'b2xkLHJlcXVlc3QuZm9ybS5nZXQoJ3NuYXBzaG90JykpO3RhcmdldD1yZXF1ZXN0LmZvcm0uZ2V0KCdzdGF0dXMnKQogICAg'
    'ICAgICAgICBpZiB0YXJnZXQgbm90IGluIFRSQU5TSVRJT05TW29sZFsnc3RhdHVzJ11dOnJhaXNlIFZhbHVlRXJyb3IoJ+S4'
    'jeWFgeiuuOi/meS4quaKpemUgOeKtuaAgeWPmOabtOOAgicpCiAgICAgICAgICAgIGlmIGMuZXhlY3V0ZSgnU0VMRUNUIHBh'
    'eXJvbGxfaWQgRlJPTSBwYXlyb2xsX2V4cGVuc2VzIFdIRVJFIGV4cGVuc2VfaWQ9PycsKHJpZCwpKS5mZXRjaG9uZSgpOnJh'
    'aXNlIFZhbHVlRXJyb3IoJ+atpOi0ueeUqOW3suWFs+iBlOW3pei1hO+8jOeKtuaAgeeUseW3pei1hOWPkeaUvuabtOaWsO+8'
    'm+ivt+WFiOaguOWvueW3pei1hOiNieeov+OAgicpCiAgICAgICAgICAgIGlmIHRhcmdldD09J+W3suaUr+S7mCcgYW5kIG9s'
    'ZFsncGF5b3V0J109PSfpmo/lt6XotYQnOnJhaXNlIFZhbHVlRXJyb3IoJ+maj+W3pei1hOaUr+S7mOeahOaKpemUgO+8jOiv'
    't+WIsOS6uuWRmOW3pei1hOS4reWPkeaUvuOAgicpCiAgICAgICAgICAgIHIud3JpdGVfcm93KGMsJ2V4cGVuc2VzJyxkaWN0'
    'KHN0YXR1cz10YXJnZXQsdXBkYXRlZF9hdD1kYi5ub3dfc3RyKCkpLG9sZCkKICAgICAgICBmbGFzaCgn5oql6ZSA54q25oCB'
    '5bey5pu05paw44CCJywnb2snKQogICAgZXhjZXB0IChWYWx1ZUVycm9yLHNxbGl0ZTMuRXJyb3IpIGFzIGU6Zmxhc2goc3Ry'
    'KGUpLCdlcnJvcicpCiAgICByZXR1cm4gcmVkaXJlY3QodXJsX2ZvcignZmluYW5jZS5leHBlbnNlcycpKQoKQGJwLmdldCgn'
    'L2V4cGVuc2VzLzxpbnQ6cmlkPi9yZWNlaXB0JykKQGF1dGgubG9naW5fcmVxdWlyZWQKZGVmIGV4cGVuc2VfcmVjZWlwdChy'
    'aWQpOgogICAgcm93PWRiLnF1ZXJ5KCdTRUxFQ1QgcmVjZWlwdF9wYXRoIEZST00gZXhwZW5zZXMgV0hFUkUgaWQ9PycsKHJp'
    'ZCwpLG9uZT1UcnVlKQogICAgaWYgbm90IHJvdyBvciBub3Qgcm93WydyZWNlaXB0X3BhdGgnXTpyZXR1cm4gJ+acquS4iuS8'
    'oOWHreivgScsNDA0CiAgICByb290PShyLmNvbmZpZy5kYXRhX2RpcigpLyfmiqXplIDlh63or4EnKS5yZXNvbHZlKCk7cGF0'
    'aD0oci5jb25maWcuZGF0YV9kaXIoKS9yb3dbJ3JlY2VpcHRfcGF0aCddKS5yZXNvbHZlKCkKICAgIGlmIG5vdCBwYXRoLmlz'
    'X3JlbGF0aXZlX3RvKHJvb3QpIG9yIG5vdCBwYXRoLmlzX2ZpbGUoKTpyZXR1cm4gJ+WHreivgeaWh+S7tuS4jeWtmOWcqCcs'
    'NDA0CiAgICByZXR1cm4gc2VuZF9maWxlKHBhdGgsYXNfYXR0YWNobWVudD1UcnVlLGRvd25sb2FkX25hbWU9J+WHreivgV8n'
    'K3N0cihyaWQpK3BhdGguc3VmZml4KQoKQGJwLmdldCgnL2V4cGVuc2VzL2V4cG9ydC5jc3YnKQpAYXV0aC5sb2dpbl9yZXF1'
    'aXJlZApkZWYgZXhwZW5zZXNfZXhwb3J0KCk6CiAgICBkYXRhPWlvLlN0cmluZ0lPKCk7dz1jc3Yud3JpdGVyKGRhdGEpO3cu'
    'd3JpdGVyb3coWyfml6XmnJ8nLCfkurrlkZgnLCfnsbvliKsnLCfkuovnlLEnLCfnpajmja7ph5Hpop0nLCfooaXotLQnLCfk'
    'uKrkurrmib/mi4UnLCfmiqXplIDph5Hpop0nLCfmlK/ku5jmlrnlvI8nLCfnirbmgIEnLCfop4TliJnniYjmnKwnXSkKICAg'
    'IGZvciByb3cgaW4gZGIucXVlcnkoJ1NFTEVDVCAqIEZST00gZXhwZW5zZXMgT1JERVIgQlkgZGF0ZSxpZCcpOncud3JpdGVy'
    'b3coW3Jvd1t4XSBmb3IgeCBpbiBbJ2RhdGUnLCdlbXBsb3llZScsJ2NhdGVnb3J5JywncHVycG9zZScsJ3RpY2tldCcsJ2Fs'
    'bG93YW5jZScsJ3BlcnNvbmFsJywnYW1vdW50JywncGF5b3V0Jywnc3RhdHVzJywncnVsZV92ZXJzaW9uJ11dKQogICAgcmV0'
    'dXJuIFJlc3BvbnNlKCdcdWZlZmYnK2RhdGEuZ2V0dmFsdWUoKSxtaW1ldHlwZT0ndGV4dC9jc3Y7IGNoYXJzZXQ9dXRmLTgn'
    'LGhlYWRlcnM9eydDb250ZW50LURpc3Bvc2l0aW9uJzonYXR0YWNobWVudDsgZmlsZW5hbWU9ZXhwZW5zZXMuY3N2J30pCg=='
)
UPSTREAM = 'ecd7993d65c43b254f4e3f718e36d5b4a70a3ed5'
READER_PINS = {
    'PyInstaller/__init__.py': '0c4f49f4d627c054780d6d36238dfdcf5637da6f2fba9e9e6b796f8b869d1a5f',
    'PyInstaller/archive/readers.py': 'e5cf8a33bc68ed2c94d52da68780094b5c359f4c38cf35af004edc90016a3613',
    'PyInstaller/loader/pyimod01_archive.py': '38d2c8b801b6c2165d44bc40f47bc1e230110272003da67d4d4eaa59af4ff397',
}
SITE = Path('C:/Python314/Lib/site-packages')
MAX_EXE = 16 * 1024 * 1024
MAX_METADATA = 4 * 1024 * 1024
MAX_FINANCE_CODE = 2 * 1024 * 1024
MAX_MEMBERS = 16384
COOKIE = struct.Struct('!8sIIII64s')
ENTRY = struct.Struct('!IIIIBc')
MAGIC = b'MEI\014\013\012\013\016'
CODE_FIELDS = ('co_argcount', 'co_posonlyargcount', 'co_kwonlyargcount', 'co_nlocals', 'co_stacksize',
               'co_flags', 'co_code', 'co_consts', 'co_names', 'co_varnames', 'co_freevars', 'co_cellvars',
               'co_name', 'co_qualname', 'co_filename', 'co_firstlineno', 'co_linetable', 'co_exceptiontable')


class ProbeError(RuntimeError):
    pass


def require(value, code):
    if not value:
        raise ProbeError(code)


def sha(body):
    return hashlib.sha256(body).hexdigest()


def ordinary(file, boundary):
    file, boundary = Path(file), Path(boundary)
    require(file.is_absolute() and file.is_relative_to(boundary), 'PATH_BOUNDARY_REFUSED')
    for item in (file, *file.parents):
        info = item.lstat()
        require(not stat.S_ISLNK(info.st_mode) and not getattr(info, 'st_file_attributes', 0) & 0x400, 'LINK_REFUSED')
        require(not stat.S_ISREG(info.st_mode) or info.st_nlink == 1, 'HARDLINK_REFUSED')
        if item == boundary:
            return file
    raise ProbeError('PHYSICAL_BOUNDARY_MISSING')


def key(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns,
            info.st_nlink, getattr(info, 'st_birthtime_ns', None))


def stable(file, boundary=ROOT, limit=MAX_EXE):
    file = ordinary(file, boundary)
    before = file.stat()
    require(stat.S_ISREG(before.st_mode) and before.st_size <= limit, 'BOUNDED_FILE_REQUIRED')
    with file.open('rb') as stream:
        opened = os.fstat(stream.fileno())
        shared = ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_nlink')
        births = getattr(before, 'st_birthtime_ns', None), getattr(opened, 'st_birthtime_ns', None)
        require(all(getattr(before, name) == getattr(opened, name) for name in shared) and
                (None in births or births[0] == births[1]), 'FILE_CHANGED_BEFORE_READ')
        body = stream.read(limit + 1)
        require(len(body) == before.st_size and key(opened) == key(os.fstat(stream.fileno())), 'FILE_CHANGED_DURING_READ')
    require(key(before) == key(ordinary(file, boundary).stat()), 'FILE_CHANGED_AFTER_READ')
    return body


def pinned(relative):
    body = stable(ROOT / relative)
    require(sha(body) == PINS[relative], 'PIN_CHANGED:' + relative)
    return body


def unique_object(pairs):
    value = {}
    for name, item in pairs:
        require(name not in value, 'DUPLICATE_JSON_KEY')
        value[name] = item
    return value


def write_new(file, value):
    ordinary(file.parent, RESULTS)
    body = (json.dumps(value, ensure_ascii=True, indent=2) + '\n').encode()
    require(len(body) <= 16 * 1024 * 1024, 'RESULT_BYTE_LIMIT')
    with file.open('xb') as stream:
        require(stream.write(body) == len(body), 'RESULT_WRITE_INCOMPLETE')
        stream.flush()
        os.fsync(stream.fileno())


def safe_relative(name):
    require(isinstance(name, str) and 0 < len(name) <= 512 and '\\' not in name and ':' not in name and
            not any(ord(char) < 32 for char in name), 'MANIFEST_PATH_REFUSED')
    parts = name.split('/')
    require(all(part not in ('', '.', '..') and part.rstrip(' .') == part and
                not re.fullmatch(r'(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?', part, re.I) for part in parts), 'MANIFEST_PATH_ALIAS')
    require(not re.search(r'\.(?:db|sqlite3?|key|pem)$', name, re.I), 'NON_PROGRAM_MANIFEST_INPUT')
    return name


def verify_tree(manifest_body):
    manifest = json.loads(manifest_body, object_pairs_hook=unique_object)
    require(manifest.get('version') == 1 and len(manifest.get('modules', [])) == 2, 'MODULE_MANIFEST_SCHEMA')
    modules = [item for item in manifest['modules'] if item.get('id') == 'ledger']
    require(len(modules) == 1, 'ONE_LEDGER_REQUIRED')
    module = modules[0]
    require(module.get('version') == '1.3.0' and module.get('runtimeMode') == 'onedir' and
            module.get('purpose') == 'desktop-release' and module.get('file') == 'xjy-ledger.exe' and
            module.get('sha256') == EXE_SHA and module.get('size') == 8520018, 'FIXED_LEDGER_REQUIRED')
    files = module.get('files')
    require(isinstance(files, list) and len(files) == 353, 'EXACT_353_FILES_REQUIRED')
    expected = {}
    for row in files:
        require(isinstance(row, dict) and set(row) == {'path', 'size', 'sha256'}, 'FILE_ROW_SCHEMA')
        name = safe_relative(row['path'])
        require(name.casefold() not in {item.casefold() for item in expected} and type(row['size']) is int and
                0 <= row['size'] <= MAX_EXE and re.fullmatch('[0-9a-f]{64}', row['sha256']) is not None, 'FILE_ROW_IDENTITY')
        expected[name] = row
    base = ordinary(ROOT / LEDGER, ROOT)
    found = set()
    for file in base.rglob('*'):
        ordinary(file, ROOT)
        if file.is_file():
            found.add(file.relative_to(base).as_posix())
        else:
            require(file.is_dir(), 'UNEXPECTED_PROGRAM_NODE')
    require(found == set(expected), 'COMPLETE_PROGRAM_TREE_DRIFT')
    verified = []
    for name, row in expected.items():
        body = stable(base / name)
        require(len(body) == row['size'] and sha(body) == row['sha256'], 'PROGRAM_FILE_CHANGED:' + name)
        verified.append({'path': name, 'size': len(body), 'sha256': sha(body)})
    require(sum(row['size'] for row in verified) == 41689880, 'PROGRAM_BYTE_SUM_CHANGED')
    return verified


def pe_metadata(body):
    require(len(body) >= 512 and body[:2] == b'MZ', 'MZ_REQUIRED')
    offset = struct.unpack_from('<I', body, 60)[0]
    require(64 <= offset <= 4096 and body[offset:offset + 4] == b'PE\0\0', 'PE_HEADER_REQUIRED')
    machine, count, stamp = struct.unpack_from('<HHI', body, offset + 4)
    optional_size = struct.unpack_from('<H', body, offset + 20)[0]
    optional = offset + 24
    require(machine == 0x8664 and 0 < count <= 96 and optional_size >= 240 and
            optional + optional_size + count * 40 <= len(body), 'AMD64_PE32_HEADER_REQUIRED')
    require(struct.unpack_from('<H', body, optional)[0] == 0x20b, 'PE32_PLUS_REQUIRED')
    require(struct.unpack_from('<I', body, optional + 108)[0] >= 5, 'PE_SECURITY_DIRECTORY_HEADER_MISSING')
    security = struct.unpack_from('<II', body, optional + 144)
    require(security == (0, 0), 'ORIGINAL_CERTIFICATE_DIRECTORY_NOT_EMPTY')
    sections = []
    for index in range(count):
        at = optional + optional_size + index * 40
        raw_size, raw_at = struct.unpack_from('<II', body, at + 16)
        require(raw_at + raw_size <= len(body), 'PE_SECTION_OUT_OF_FILE')
        sections.append({'rawOffset': raw_at, 'rawSize': raw_size})
    return {'peOffset': offset, 'machine': machine, 'optionalMagic': 0x20b, 'timestamp': stamp,
            'checksumOffset': optional + 64, 'checksum': struct.unpack_from('<I', body, optional + 64)[0],
            'certificateFileOffset': security[0], 'certificateSize': security[1], 'sections': sections,
            'sectionTableEnd': optional + optional_size + count * 40,
            'sizeOfHeaders': struct.unpack_from('<I', body, optional + 60)[0],
            'authenticodeAssessed': False}


def archive_metadata(body, pe):
    require(len(body) == 8520018 and body[-COOKIE.size:-COOKIE.size + 8] == MAGIC, 'COOKIE_AT_EOF_REQUIRED')
    magic, size, toc_at, toc_size, pyvers, library = COOKIE.unpack(body[-COOKIE.size:])
    require(magic == MAGIC and COOKIE.size <= size <= len(body) and
            toc_at + toc_size + COOKIE.size == size and 0 < toc_size <= MAX_METADATA, 'COOKIE_BOUNDS_REFUSED')
    start = len(body) - size
    require(start >= max(pe['sectionTableEnd'], pe['sizeOfHeaders'],
                         *(item['rawOffset'] + item['rawSize'] for item in pe['sections'])), 'ARCHIVE_OVERLAPS_PE_SECTION')
    require(pyvers == 314 and library.rstrip(b'\0') == b'python314.dll' and
            library == b'python314.dll' + b'\0' * (64 - len(b'python314.dll')), 'COOKIE_PYTHON_IDENTITY')
    toc = body[start + toc_at:start + toc_at + toc_size]
    entries, ranges, names = [], [], set()
    cursor = 0
    while cursor < len(toc):
        require(len(entries) < MAX_MEMBERS and cursor + ENTRY.size <= len(toc), 'CARCHIVE_TOC_LIMIT')
        length, data_at, compressed, uncompressed, flag, typecode = ENTRY.unpack_from(toc, cursor)
        require(length >= ENTRY.size + 1 and length % 16 == 0 and cursor + length <= len(toc), 'CARCHIVE_TOC_ENTRY_BOUNDS')
        raw_name = toc[cursor + ENTRY.size:cursor + length]
        require(b'\0' in raw_name, 'CARCHIVE_NAME_TERMINATOR')
        name_bytes, padding = raw_name.split(b'\0', 1)
        require(not any(padding), 'CARCHIVE_NAME_PADDING')
        name, kind = name_bytes.decode('utf-8'), typecode.decode('ascii')
        require(0 < len(name) <= 1024 and '\0' not in name and flag in (0, 1) and
                kind in 'bdzZMmsxolna' and data_at <= toc_at and compressed <= toc_at - data_at and
                (flag == 1 or compressed == uncompressed), 'CARCHIVE_MEMBER_REFUSED')
        require(kind == 'o' or name not in names, 'CARCHIVE_DUPLICATE_MEMBER')
        if kind != 'o':
            names.add(name)
        if compressed:
            ranges.append((data_at, data_at + compressed))
        entries.append({'index': len(entries), 'name': name, 'type': kind, 'offset': data_at,
                        'compressedLength': compressed, 'uncompressedLength': uncompressed, 'compressionFlag': flag})
        cursor += length
    require(cursor == len(toc), 'CARCHIVE_TOC_TRAILING_BYTES')
    ranges.sort()
    require(all(left[1] <= right[0] for left, right in zip(ranges, ranges[1:])), 'CARCHIVE_MEMBER_OVERLAP')
    pyz = [item for item in entries if item['type'] == 'z']
    require(len(pyz) == 1 and pyz[0]['compressionFlag'] == 0, 'ONE_UNCOMPRESSED_PYZ_REQUIRED')
    member = pyz[0]
    absolute = start + member['offset']
    return {'startOffset': start, 'archiveLength': size, 'tocOffset': toc_at, 'tocLength': toc_size,
            'pythonVersion': pyvers, 'pythonLibrary': 'python314.dll', 'prefixSha256': sha(body[:start]),
            'tocSha256': sha(toc), 'entries': entries, 'pyzMember': member}, body[absolute:absolute + member['compressedLength']]


def load_marshaled(body, allow_code):
    stream = io.BytesIO(body)
    value = marshal.load(stream, allow_code=allow_code)
    require(stream.tell() == len(body), 'MARSHAL_TRAILING_BYTES')
    return value


def pyz_metadata(body):
    require(len(body) >= 12 and body[:4] == b'PYZ\0', 'PYZ_HEADER_REQUIRED')
    require(body[4:8] == importlib.util.MAGIC_NUMBER == bytes.fromhex('2b0e0d0a'), 'PYZ_MAGIC_RUNTIME_MISMATCH')
    toc_at = struct.unpack_from('!i', body, 8)[0]
    require(12 <= toc_at <= len(body) and len(body) - toc_at <= MAX_METADATA, 'PYZ_TOC_BOUNDS')
    toc = load_marshaled(body[toc_at:], False)  # No code object is allowed in metadata.
    require(type(toc) in (dict, list, tuple), 'PYZ_TOC_TYPE')
    rows = list(toc.items()) if type(toc) is dict else toc
    require(0 < len(rows) <= MAX_MEMBERS, 'PYZ_MEMBER_LIMIT')
    entries, ranges, names = [], [], set()
    for row in rows:
        require(type(row) in (tuple, list) and len(row) == 2, 'PYZ_TOC_ROW')
        name, entry = row
        require(type(name) is str and 0 < len(name) <= 512 and name not in names and
                type(entry) in (tuple, list) and len(entry) == 3 and all(type(item) is int for item in entry), 'PYZ_MEMBER_SCHEMA')
        kind, offset, length = entry
        require(kind in (0, 1, 3) and 12 <= offset <= toc_at and 0 <= length <= toc_at - offset and
                (length == 0 if kind == 3 else length > 0), 'PYZ_MEMBER_TYPE_OR_BOUNDS')
        names.add(name)
        if length:
            ranges.append((offset, offset + length))
        entries.append({'index': len(entries), 'name': name, 'type': kind, 'offset': offset, 'compressedLength': length,
                        'compressedSha256': sha(body[offset:offset + length])})
    ranges.sort()
    require(all(left[1] <= right[0] for left, right in zip(ranges, ranges[1:])), 'PYZ_MEMBER_OVERLAP')
    finance = [item for item in entries if item['name'] == 'finance']
    require(len(finance) == 1 and finance[0]['type'] == 0, 'ONE_FINANCE_MODULE_REQUIRED')
    first_blob = min(item[0] for item in ranges)
    return {'sha256': sha(body), 'size': len(body), 'magic': body[4:8].hex(), 'tocOffset': toc_at,
            'tocSha256': sha(body[toc_at:]), 'headerExtraHex': body[12:first_blob].hex(),
            'stockWriter17ByteHeader': first_blob == 17 and body[12:17] == b'\0' * 5,
            'entries': entries, 'financeMember': finance[0]}


def code_tree(value, budget, depth=0):
    require(depth <= 100 and budget[0] < 200000, 'CODE_STRUCTURE_LIMIT')
    budget[0] += 1
    kind = type(value)
    if kind is types.CodeType:
        return ['code', [[name, code_tree(getattr(value, name), budget, depth + 1)] for name in CODE_FIELDS]]
    if value is None or value is Ellipsis:
        return ['none' if value is None else 'ellipsis']
    if kind in (bool, int, str):
        return [kind.__name__, str(value)]
    if kind is bytes:
        return ['bytes', value.hex()]
    if kind is float:
        return ['float', struct.pack('!d', value).hex()]
    if kind is complex:
        return ['complex', struct.pack('!dd', value.real, value.imag).hex()]
    if kind in (tuple, frozenset):
        items = [code_tree(item, budget, depth + 1) for item in value]
        if kind is frozenset:
            items.sort(key=lambda item: json.dumps(item, ensure_ascii=True, separators=(',', ':')))
        return [kind.__name__, items]
    if kind is slice:
        return ['slice', code_tree((value.start, value.stop, value.step), budget, depth + 1)]
    raise ProbeError('UNSUPPORTED_CODE_CONSTANT_TYPE')


def fingerprint(tree):
    return sha(json.dumps(tree, ensure_ascii=True, separators=(',', ':')).encode())


def code_filenames(code):
    names = {code.co_filename}
    for item in code.co_consts:
        if type(item) is types.CodeType:
            names.update(code_filenames(item))
    return sorted(names)


def finance_compare(pyz_body, metadata, new_source, report):
    row = metadata['financeMember']
    compressed = pyz_body[row['offset']:row['offset'] + row['compressedLength']]
    decoder = zlib.decompressobj()
    payload = decoder.decompress(compressed, MAX_FINANCE_CODE + 1)
    require(len(payload) <= MAX_FINANCE_CODE and decoder.eof and not decoder.unused_data and
            not decoder.unconsumed_tail, 'FINANCE_DECOMPRESSION_REFUSED')
    original = load_marshaled(payload, True)  # Only this named/typed finance payload is decoded.
    require(type(original) is types.CodeType, 'FINANCE_CODE_OBJECT_REQUIRED')
    report['financeCodeDecoded'] = True
    original_tree = code_tree(original, [0])
    old_source = base64.b64decode(OLD_FINANCE_B64, validate=True)
    require(sha(old_source) == OLD_SHA and hashlib.sha1(b'blob ' + str(len(old_source)).encode() + b'\0' + old_source).hexdigest() == OLD_GIT_BLOB,
            'OLD_SOURCE_DATA_IDENTITY_CHANGED')
    result = {'originalMarshalSha256': sha(payload), 'originalStructureSha256': fingerprint(original_tree),
              'originalFilenames': code_filenames(original), 'filenameNormalizationUsed': False,
              'oldSourceSha256': OLD_SHA, 'oldGitBlob': OLD_GIT_BLOB, 'newSourceSha256': sha(new_source),
              'codeFields': list(CODE_FIELDS), 'comparisons': [], 'matchingOptimizationLevels': [],
              'unknownPyzCodeObjectsDecoded': 0, 'payloadExecuted': False, 'rebuildAuthorized': False}
    report['finance'] = result
    report['financeAssessed'] = True
    for level in (0, 1, 2):
        old_code = compile(old_source, 'finance.py', 'exec', dont_inherit=True, optimize=level)
        new_code = compile(new_source, 'finance.py', 'exec', dont_inherit=True, optimize=level)
        old_tree, new_tree = code_tree(old_code, [0]), code_tree(new_code, [0])
        same = old_tree == original_tree
        result['comparisons'].append({'optimization': level, 'oldMatchesOriginal': same,
                                      'oldDifferentTopLevelFields': [left[0] for left, right in zip(original_tree[1], old_tree[1]) if left != right],
                                      'oldStructureSha256': fingerprint(old_tree), 'newStructureSha256': fingerprint(new_tree),
                                      'oldCompiledFilenames': code_filenames(old_code), 'newEqualsOriginal': new_tree == original_tree,
                                      'newFilenames': code_filenames(new_code), 'newCompiles': True})
        if same:
            result['matchingOptimizationLevels'].append(level)
    result['oldSourceVerified'] = bool(result['matchingOptimizationLevels'])
    result['newSourceCompiledOnly'] = True
    result['selectedOptimizationLevel'] = None  # Root decides; identical levels are not silently selected.
    require(result['oldSourceVerified'], 'ORIGINAL_FINANCE_DOES_NOT_MATCH_404')


def run(args):
    require(re.fullmatch('[0-9a-f]{64}', args.source_sha256 or '') is not None and
            re.fullmatch('[a-z0-9][a-z0-9-]{0,39}', args.run_id or '') is not None, 'ROOT_SOURCE_SHA_AND_RUN_ID_REQUIRED')
    self_body = stable(ROOT / SELF, limit=1024 * 1024)
    require(sha(self_body) == args.source_sha256, 'PROBE_SOURCE_CHANGED')
    require(sha(stable(PYTHON, Path('C:/'), 2 * 1024 * 1024)) == PYTHON_SHA, 'PUBLIC_PYTHON_CHANGED')
    checked = {relative: pinned(relative) for relative in PINS if relative.startswith('stage1/')}
    guard = types.ModuleType('finance_readonly_actual_context')
    guard.__file__ = str(ROOT / 'stage1/sandbox-context.py')
    exec(compile(checked['stage1/sandbox-context.py'], guard.__file__, 'exec'), guard.__dict__)
    admission = guard.read_context(ROOT)  # Existing guard alone may timeout-kill its metadata helper.
    ordinary(RESULTS, RESULTS)
    output = RESULTS / ('finance-archive-readonly-' + args.run_id)
    output.mkdir(exist_ok=False)
    ordinary(output, RESULTS)
    report = {'purpose': 'finance-archive-readonly-baseline', 'state': 'ACTUAL_GUEST_READONLY', 'passed': False,
              'runId': args.run_id, 'sourceSha256': args.source_sha256, 'admission': admission,
              'scope': 'reader-pins-only' if args.reader_pins_only else 'archive-and-known-finance-only',
              'python': {'path': str(PYTHON), 'sha256': PYTHON_SHA, 'version': sys.version, 'magic': importlib.util.MAGIC_NUMBER.hex(),
                         'isolated': bool(sys.flags.isolated), 'noSite': bool(sys.flags.no_site), 'noBytecodeWrites': bool(sys.flags.dont_write_bytecode)},
              'sourcePins': PINS, 'readerUpstreamCommit': UPSTREAM, 'readerSources': [],
              'parserImplementation': 'bounded-stdlib-data-adapter-of-pinned-official-formats',
              'officialReaderExecuted': False, 'pyinstallerImported': False,
              'fullProgramTreeVerified': False, 'carchiveAssessed': False, 'pyzMetadataAssessed': False,
              'archiveParsed': False, 'financeAssessed': False, 'financeCodeDecoded': False,
              'unknownPyzCodeObjectsDecoded': 0, 'archivePayloadExecuted': False, 'businessModulesImported': False,
              'repackPerformed': False, 'executableLaunched': False, 'productionDataAccessed': False,
              'guardDependency': 'Unchanged sandbox-context uses subprocess.run(timeout=20) for its metadata helper; no new business or archive process is started.'}
    try:
        for relative, expected in READER_PINS.items():
            body = stable(SITE / relative, Path('C:/'), 2 * 1024 * 1024)
            report['readerSources'].append({'path': str(SITE / relative), 'size': len(body), 'sha256': sha(body),
                                             'expectedSha256': expected, 'matched': sha(body) == expected})
        require(all(item['matched'] for item in report['readerSources']), 'OFFICIAL_READER_SOURCE_PIN_MISMATCH')
        if not args.reader_pins_only:
            checked.update({relative: pinned(relative) for relative in (MANIFEST, FINANCE)})
            report['verifiedFiles'] = verify_tree(checked[MANIFEST])
            report['fullProgramTreeVerified'] = True
            exe = stable(ROOT / LEDGER / 'xjy-ledger.exe')
            require(len(exe) == 8520018 and sha(exe) == EXE_SHA, 'ORIGINAL_EXE_CHANGED')
            report['pe'] = pe_metadata(exe)
            report['carchive'], pyz = archive_metadata(exe, report['pe'])
            report['carchiveAssessed'] = True
            report['pyz'] = pyz_metadata(pyz)
            report['pyzMetadataAssessed'] = True
            report['archiveParsed'] = True
            finance_compare(pyz, report['pyz'], checked[FINANCE], report)
            # Recheck the complete program tree and source pins after all reads.
            require(verify_tree(pinned(MANIFEST)) == report['verifiedFiles'], 'PROGRAM_TREE_CHANGED_DURING_PROBE')
        for relative in checked:
            require(sha(stable(ROOT / relative)) == PINS[relative], 'INPUT_CHANGED_AFTER_PROBE')
        require(sha(stable(ROOT / SELF, limit=1024 * 1024)) == args.source_sha256, 'PROBE_CHANGED_AFTER_READ')
        report['passed'] = True
    except BaseException as caught:
        report['error'] = {'code': str(caught) if isinstance(caught, ProbeError) else type(caught).__name__}
    write_new(output / 'result.json', report)
    print(json.dumps({'purpose': report['purpose'], 'scope': report['scope'], 'passed': report['passed'],
                      'financeAssessed': report['financeAssessed'], 'repackPerformed': False,
                      'result': str(output / 'result.json')}), flush=True)
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--source-sha256', required=True)
    parser.add_argument('--run-id', required=True)
    parser.add_argument('--reader-pins-only', action='store_true')
    try:
        raise SystemExit(run(parser.parse_args()))
    except Exception as caught:
        print(json.dumps({'purpose': 'finance-archive-readonly-baseline', 'passed': False,
                          'error': str(caught) if isinstance(caught, ProbeError) else type(caught).__name__}), file=sys.stderr, flush=True)
        raise SystemExit(1)
