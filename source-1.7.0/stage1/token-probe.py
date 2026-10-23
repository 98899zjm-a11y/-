"""Probe only token/process creation; no business imports or DB operations."""
from pathlib import Path
import json
import os
import subprocess
from importlib.util import spec_from_file_location, module_from_spec
ROOT=Path(__file__).resolve().parent.parent
report={}
try:
    spec=spec_from_file_location('token_info',ROOT/'stage1'/'token-info.py')
    module=module_from_spec(spec)
    spec.loader.exec_module(module)
    report['token']=module.information()
except Exception as exc:
    report['tokenError']={'class':type(exc).__name__,'error':str(exc)}
try:
    result=subprocess.run([str(ROOT/'stage1'/'tools'/'node.exe'),'--version'],cwd=ROOT,capture_output=True,creationflags=0x08000000)
    report['child']={'code':result.returncode,'stdout':result.stdout.decode(errors='replace'),'stderr':result.stderr.decode(errors='replace')}
except Exception as exc:
    report['childError']={'class':type(exc).__name__,'winerror':getattr(exc,'winerror',None),'error':str(exc)}
(ROOT/'logs'/'token-probe.json').write_text(json.dumps(report),encoding='utf-8')
