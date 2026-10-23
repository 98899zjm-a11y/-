"""Create one separate release application source without weakening stage main."""
from pathlib import Path
import importlib.util
import json

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('release_app_paths', ROOT/'stage1/run-restricted.py')
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)
guard.validate_identity(json.loads(guard.assert_owned(ROOT/'isolation-identity.json').read_text('utf-8')))
source = guard.assert_owned(ROOT/'project/desktop/main.cjs')
target = guard.assert_owned(ROOT/'project/desktop/release-app.cjs')
text = source.read_text('utf-8')
blocked = "throw new Error('此隔离副本禁止从正式Electron入口启动，请使用stage1受限测试启动器；正式安装未修改。');"
if text.count(blocked) != 1 or text.splitlines()[1] != blocked:
    raise RuntimeError('Unexpected guarded source; no release copy made')
with target.open('x', encoding='utf-8', newline='\n') as output:
    output.write(text.replace(blocked, '// Loaded only after release-entry admission; original stage main remains blocked.', 1))
print('Separate candidate source created; guarded stage main unchanged.')
