"""Source-only closure probe. Never runs a VM guard, product, DB or subprocess."""
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import socket
import stat
import types

ROOT = Path(__file__).resolve().parents[1]
if os.name != 'nt' or str(ROOT).casefold() != 'e:\\codex\\2026-10-15\\work\\xjy-v16-deep-audit':
    raise RuntimeError('Fixed source-only Host workspace required')
parser = argparse.ArgumentParser(allow_abbrev=False)
parser.add_argument('--subject-sha256', required=True)
args = parser.parse_args()
subject = ROOT/'audit-tools/release162-selfcheck.py'
body = subject.read_bytes()
if hashlib.sha256(body).hexdigest() != args.subject_sha256:
    raise RuntimeError('Reviewed QA source changed')
tree = ast.parse(body)
pins = next(n.value for n in tree.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'PINS' for t in n.targets))
helpers = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in {'need','ordinary','digest','identity','same_object','stable_bytes','pinned_defs'}]
main = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'main')
trial = next(n.body for n in main.body if isinstance(n, ast.Try))
start = next(i for i,n in enumerate(trial) if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'ns' for t in n.targets))
end = next(i for i,n in enumerate(trial) if isinstance(n, ast.Expr) and isinstance(n.value, ast.Call) and isinstance(n.value.func, ast.Subscript) and isinstance(n.value.func.value, ast.Name) and n.value.func.value.id == 'original' and isinstance(n.value.func.slice, ast.Constant) and n.value.func.slice.value == 'validate_proof')

class GuardReached(Exception):
    pass

def deny_guard(root):
    if root != ROOT:
        raise AssertionError('Unexpected closure root')
    raise GuardReached('actual-context-admission-called-first')

class NoProcess:
    def run(self, *a, **kw):
        raise AssertionError('No Host subprocess permitted by source closure probe')

scope = dict(ROOT=ROOT, Path=Path, os=os, stat=stat, hashlib=hashlib, json=json, ast=ast,
             subprocess=NoProcess(), socket=socket, re=__import__('re'),
             guard=types.SimpleNamespace(read_context=deny_guard), PINS=ast.literal_eval(pins))
exec(compile(ast.Module(body=helpers+trial[start:end], type_ignores=[]), str(subject)+'[closure-only]', 'exec'), scope)
try:
    scope['original']['process_snapshot']()
except GuardReached:
    print(json.dumps({'passed':True,'purpose':'source-only-context-closure','subjectSha256':args.subject_sha256,'actualContextPortReachedBeforeProcessApi':True,'realGuardExecuted':False,'processExecuted':False,'productImported':False}))
except NameError as error:
    print(json.dumps({'passed':False,'purpose':'source-only-context-closure','subjectSha256':args.subject_sha256,'missing':error.name,'processExecuted':False,'productImported':False}))
    raise SystemExit(1)
else:
    raise AssertionError('Process snapshot failed to enforce context admission')
