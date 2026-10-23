"""Pure cross-language RPC fixture; no ERP/app/database imports."""
import importlib.util,json
from pathlib import Path
file=Path(__file__).resolve().parent.parent/'project/desktop/legacy-source/ledger/ocr.py'
spec=importlib.util.spec_from_file_location('ocr_rpc_pure',file);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
print(json.dumps(module.call_broker({'version':1,'op':'probe'}),ensure_ascii=True))
