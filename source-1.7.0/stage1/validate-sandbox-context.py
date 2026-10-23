"""File entry point for the unchanged actual Sandbox admission checks.

Windows PowerShell 5.1 can remove embedded quotes from native -c arguments.
Passing this file avoids shell interpretation of the Python source.
"""
import importlib.util
import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('sandbox_context', root / 'stage1' / 'sandbox-context.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
proof = module.read_context(root)
print(json.dumps(proof, ensure_ascii=True))
