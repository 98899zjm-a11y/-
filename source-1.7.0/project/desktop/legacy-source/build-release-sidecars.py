"""Build a separate desktop-release variant; never replace guarded stage bundles.

Only program assets from the isolated maintenance copy are inputs. This file is
a compiler driver, not a business launcher. Unknown pyc calculations are reused.
"""
from pathlib import Path
import argparse
import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parent
DESKTOP = ROOT.parent
STAGE_ROOT = DESKTOP.parent.parent
VERSIONS = {'ledger':'1.3.0','inventory':'1.9.0'}

def is_program_input(relative):
    parts = relative.parts
    if any(x in ('__pycache__','data','backups','logs','cache') or x.startswith('.') for x in parts):
        return False
    return relative.suffix.lower() in {'.py','.pyc','.html','.css','.js','.png','.jpg','.jpeg','.svg','.ico','.ttf','.otf','.woff','.woff2','.txt','.pfb','.afm','.enc','.t1','.cmap','.sfd'}

def build_command(module, source, work, dist):
    command = [sys.executable,'-B','-m','PyInstaller','--noconfirm','--clean','--onedir','--console',
               '--name','xjy-'+module,'--distpath',str(dist),'--workpath',str(work/'work'),
               '--specpath',str(work),'--paths',str(source),'--hidden-import','waitress',
               '--hidden-import','openpyxl','--hidden-import','desktop_runtime_context',
               '--add-data',str(source/'app/templates')+';app/templates',
               '--add-data',str(source/'app/static')+';app/static']
    if module == 'ledger':
        command += ['--paths',str(source/'pdf_vendor'),'--add-data',str(source/'assets')+';assets',
                    '--add-data',str(source/'pdf_vendor')+';pdf_vendor','--hidden-import','reportlab.pdfbase.cidfonts',
                    '--hidden-import','reportlab.platypus','--hidden-import','tkinter.messagebox',
                    '--hidden-import','erp_runtime']
    return command+[str(source/'sidecar.py')]

def bundle_entry(module, dist):
    directory = dist/('xjy-'+module)
    files = []
    for file in sorted(directory.rglob('*')):
        if file.is_symlink():
            raise RuntimeError('Linked build output refused')
        if not file.is_file():
            continue
        stat = file.stat()
        if stat.st_nlink != 1:
            raise RuntimeError('Hardlinked build output refused')
        files.append({'path':file.relative_to(directory).as_posix(),'size':stat.st_size,
                      'sha256':hashlib.sha256(file.read_bytes()).hexdigest()})
    exe = next(x for x in files if x['path']=='xjy-'+module+'.exe')
    return {'id':module,'version':VERSIONS[module],'file':exe['path'],'size':exe['size'],
            'sha256':exe['sha256'],'runtimeMode':'onedir','purpose':'desktop-release','files':files}

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('module',choices=list(VERSIONS))
    args=parser.parse_args()
    spec=importlib.util.spec_from_file_location('release_build_paths',STAGE_ROOT/'stage1/run-restricted.py')
    launcher=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(launcher)
    launcher.assert_owned(ROOT)
    launcher.validate_identity(json.loads(launcher.assert_owned(STAGE_ROOT/'isolation-identity.json').read_text('utf-8')))
    work=launcher.assert_owned(DESKTOP/'.release-build'/args.module/str(uuid.uuid4()))
    source=launcher.assert_owned(work/'source')
    dist=launcher.assert_owned(DESKTOP/'release-modules')
    source.mkdir(parents=True,exist_ok=False)
    (work/'.owner.json').write_text(json.dumps({'version':1,'purpose':'release-module-build','module':args.module}),encoding='utf-8')
    dist.mkdir(parents=True,exist_ok=True)
    for file in (ROOT/args.module).rglob('*'):
        launcher.assert_owned(file)
        if file.is_dir() and not any(x in ('__pycache__','data','backups','logs','cache') or x.startswith('.') for x in file.relative_to(ROOT/args.module).parts):
            launcher.assert_owned(source/file.relative_to(ROOT/args.module)).mkdir(parents=True,exist_ok=True)
        if file.is_file() and is_program_input(file.relative_to(ROOT/args.module)):
            target=launcher.assert_owned(source/file.relative_to(ROOT/args.module))
            target.parent.mkdir(parents=True,exist_ok=True)
            shutil.copyfile(file,target)
    replacements={ROOT/'sidecar_release.py':source/'sidecar.py',
                  ROOT/'desktop_runtime_context.py':source/'desktop_runtime_context.py',
                  ROOT/'collaboration.py':source/'collaboration.py',
                  ROOT/'inventory_report_window.py':source/'inventory_report_window.py',
                  ROOT/'collaboration.html':source/'app/templates/xjy-collaboration.html',
                  ROOT/'xjy-theme.css':source/'app/static/xjy-theme.css',
                  ROOT/'xjy-shell.js':source/'app/static/xjy-shell.js'}
    for original,target in replacements.items():
        launcher.assert_owned(original)
        launcher.assert_owned(target)
        target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(original,target)
    environment={k:v for k,v in os.environ.items() if k.upper() not in
                 ('PYTHONPATH','PYTHONHOME','PYTHONSTARTUP','NODE_OPTIONS','NODE_PATH','LEDGER_DATA','STOCKCHECK_DATA','XJY_STAGE1_ROOT','XJY_MODULE_TOKEN')}
    temp=launcher.assert_owned(work/'temp')
    temp.mkdir(exist_ok=True)
    environment.update(PYTHONDONTWRITEBYTECODE='1',PYTHONNOUSERSITE='1',PYTHONUTF8='1',
                       PYINSTALLER_CONFIG_DIR=str(work/'cache'),TEMP=str(temp),TMP=str(temp))
    subprocess.run(build_command(args.module,source,work,dist),cwd=source,env=environment,check=True)
    manifest_file=launcher.assert_owned(dist/'manifest.json')
    manifest={'version':1,'modules':[]}
    if manifest_file.exists():
        manifest=json.loads(manifest_file.read_text('utf-8'))
    entry=bundle_entry(args.module,dist)
    manifest['modules']=[x for x in manifest['modules'] if x['id']!=args.module]+[entry]
    temporary=launcher.assert_owned(dist/('.manifest-'+args.module+'.tmp'))
    with temporary.open('x',encoding='utf-8') as handle:
        json.dump(manifest,handle,ensure_ascii=False,indent=2)
        handle.flush()
        os.fsync(handle.fileno())
    temporary.replace(manifest_file)
    print(json.dumps({'module':args.module,'purpose':entry['purpose'],'files':len(entry['files']),'sha256':entry['sha256']}))

if __name__ == '__main__':
    main()
