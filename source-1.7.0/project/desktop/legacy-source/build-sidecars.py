"""Build actual standalone managed modules with Python 3.14/PyInstaller."""
from pathlib import Path
import argparse
import os
import shutil
import subprocess
import sys
import importlib.util

ROOT = Path(__file__).resolve().parent
DESKTOP = ROOT.parent
STAGE_ROOT = DESKTOP.parent.parent
launcher_spec = importlib.util.spec_from_file_location('stage1_build_paths', STAGE_ROOT / 'stage1' / 'run-restricted.py')
launcher = importlib.util.module_from_spec(launcher_spec)
launcher_spec.loader.exec_module(launcher)
launcher.assert_owned(ROOT)
launcher.validate_identity(__import__('json').loads(launcher.assert_owned(STAGE_ROOT / 'isolation-identity.json').read_text('utf-8')))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('module', choices=['ledger', 'inventory'])
    args = parser.parse_args()
    source = ROOT / args.module
    for target in (source, ROOT / 'sidecar.py', ROOT / 'collaboration.py', ROOT / 'collaboration.html', source / 'sidecar.py', source / 'collaboration.py', source / 'app/templates/xjy-collaboration.html'):
        launcher.assert_owned(target)
    for asset in ('xjy-theme.css','xjy-shell.js'):
        launcher.assert_owned(ROOT / asset)
        launcher.assert_owned(source / 'app/static' / asset)
        shutil.copy2(ROOT / asset, source / 'app/static' / asset)
    shutil.copy2(ROOT / 'sidecar.py', source / 'sidecar.py')
    shutil.copy2(ROOT / 'collaboration.py', source / 'collaboration.py')
    shutil.copy2(ROOT / 'inventory_report_window.py', source / 'inventory_report_window.py')
    shutil.copy2(ROOT / 'collaboration.html', source / 'app/templates/xjy-collaboration.html')
    build = DESKTOP / '.legacy-build' / args.module
    output = DESKTOP / 'legacy-modules'
    launcher.assert_owned(build)
    launcher.assert_owned(output)
    build.mkdir(parents=True, exist_ok=True)
    output.mkdir(parents=True, exist_ok=True)
    command = [sys.executable, '-B', '-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir', '--console',
               '--name', 'xjy-' + args.module, '--distpath', str(output), '--workpath', str(build / 'work'),
               '--specpath', str(build), '--paths', str(source), '--hidden-import', 'waitress',
               '--hidden-import', 'openpyxl', '--add-data', str(source / 'app/templates') + ';app/templates',
               '--add-data', str(source / 'app/static') + ';app/static']
    if args.module == 'ledger':
        command += ['--paths', str(source / 'pdf_vendor'), '--add-data', str(source / 'assets') + ';assets',
                    '--add-data', str(source / 'pdf_vendor') + ';pdf_vendor', '--hidden-import', 'reportlab.pdfbase.cidfonts',
                    '--hidden-import', 'reportlab.platypus', '--hidden-import', 'tkinter.messagebox']
    command += ['--paths', str(ROOT), '--hidden-import', 'desktop_runtime_context',
                '--paths', str(DESKTOP.parent.parent / 'stage1'), '--hidden-import', 'python_guard', '--hidden-import', 'ctypes']
    command.append(str(source / 'sidecar.py'))
    environment = os.environ.copy()
    for name in list(environment):
        if name.upper() in ('PYTHONPATH','PYTHONHOME','PYTHONSTARTUP','NODE_OPTIONS','NODE_PATH'):
            del environment[name]
    environment['PYTHONDONTWRITEBYTECODE'] = '1'
    environment['PYINSTALLER_CONFIG_DIR'] = str(build / 'cache')
    environment['TEMP'] = str(build / 'temp')
    environment['TMP'] = str(build / 'temp')
    (build / 'temp').mkdir(exist_ok=True)
    subprocess.run(command, cwd=source, env=environment, check=True)
    print('Compiled', output / ('xjy-' + args.module + '.exe'))

if __name__ == '__main__':
    main()
