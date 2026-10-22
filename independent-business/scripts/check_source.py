"""Bounded source-only validation; never scans runtime, credentials or databases."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

BASE = Path(__file__).absolute().parent.parent


def main():
    files = subprocess.check_output(['git', '-C', str(BASE), 'ls-files', '--cached', '--others', '--exclude-standard', '-z']).decode('utf-8').split('\0')
    files = sorted(set(name for name in files if name))
    forbidden = re.compile(r'(-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{25,}|\bsk-[a-zA-Z0-9]{24,})')
    rows = []
    for relative in files:
        target = BASE / relative
        if target.is_symlink() or not target.is_file():
            raise ValueError('Unexpected source object: ' + relative)
        if target.suffix.lower() in ('.db', '.sqlite', '.sqlite3', '.pem', '.pfx', '.exe', '.zip') or target.name in ('demo-credentials.json', '.env'):
            raise ValueError('Private/runtime material in source scope: ' + relative)
        body = target.read_bytes()
        if target.suffix.lower() in ('.py', '.cjs', '.js', '.json', '.md', '.html', '.css', '.cmd', '.txt'):
            text = body.decode('utf-8-sig', errors='strict')
            if forbidden.search(text):
                raise ValueError('Potential credential in ' + relative)
            if target.suffix == '.py':
                compile(text, str(target), 'exec')
            if target.suffix == '.json':
                json.loads(text)
        rows.append({'path': relative, 'size': len(body), 'sha256': hashlib.sha256(body).hexdigest()})
    expected = json.loads((BASE / 'vendor-manifest.json').read_text('utf-8-sig'))['files']
    changed = []
    for row in expected:
        target = BASE / 'vendor' / 'ledger' / row['path']
        actual = hashlib.sha256(target.read_bytes()).hexdigest()
        if actual != row['sha256']:
            changed.append(row['path'])
    if set(changed) != {'cashier_engine.py', 'app/static/cashier.js'}:
        raise ValueError('Unexpected vendor diff: ' + str(changed))
    report = {'sourceFiles': len(rows), 'pythonSyntax': 'PASS', 'secretPatternScan': 'PASS',
              'vendorFilesCompared': len(expected), 'vendorModifiedOnly': changed, 'files': rows}
    output = BASE / 'artifacts' / 'source-index.json'
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({key: value for key, value in report.items() if key != 'files'}, ensure_ascii=False))


if __name__ == '__main__':
    main()
