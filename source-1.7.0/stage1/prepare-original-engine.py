"""Read-only program-engine snapshot, excluding all business/config data.

Only the exact third-party Electron file inventory and the original branded
EXE are inputs. This compiler/test tool never executes the copied engine.
"""
from pathlib import Path
import hashlib
import importlib.util
import json
import os
import re
import uuid

ROOT=Path(__file__).resolve().parent.parent
SOURCE=Path('F:/自制软件/xjy-jewelry-offline')
SDK=Path('E:/珠宝销售软件/desktop/node_modules/electron/dist')
EXE='鑫金源珠宝报价.exe'
BASELINE_ASAR='c6f2b998a0b6dc65ea22a5027c7843918a692eedc53a813f9f5c83910d7a60fb'
spec=importlib.util.spec_from_file_location('engine_owned_paths',ROOT/'stage1/run-restricted.py')
guard=importlib.util.module_from_spec(spec);spec.loader.exec_module(guard)
guard.validate_identity(json.loads(guard.assert_owned(ROOT/'isolation-identity.json').read_text('utf-8')))

def ordinary(file,directory=False):
    for item in (file,*file.parents):
        stat=item.lstat()
        if item.is_symlink() or getattr(stat,'st_file_attributes',0)&0x400:
            raise RuntimeError('Engine paths must not contain reparse points')
    stat=file.stat()
    if directory and not file.is_dir() or not directory and (not file.is_file() or stat.st_nlink!=1):
        raise RuntimeError('Ordinary single-link program input required')
    return stat

def transfer(source,target=None):
    before=ordinary(source);digest=hashlib.sha256();written=0
    with source.open('rb') as incoming:
        opened=os.fstat(incoming.fileno())
        if (before.st_dev,before.st_ino,before.st_size)!=(opened.st_dev,opened.st_ino,opened.st_size):
            raise RuntimeError('Engine input changed before open')
        outgoing=None
        try:
            if target:
                guard.assert_owned(target);target.parent.mkdir(parents=True,exist_ok=True)
                outgoing=target.open('xb')
            while data:=incoming.read(1024*1024):
                digest.update(data);written+=len(data)
                if outgoing:outgoing.write(data)
            if outgoing:outgoing.flush();os.fsync(outgoing.fileno())
        finally:
            if outgoing:outgoing.close()
        after=ordinary(source)
        if (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns) or written!=before.st_size:
            raise RuntimeError('Engine input changed during read')
    return {'size':written,'sha256':digest.hexdigest()}

ordinary(SOURCE,directory=True);ordinary(SDK,directory=True)
asar=transfer(SOURCE/'resources/app.asar')
if asar['sha256']!=BASELINE_ASAR:
    raise RuntimeError('Verified original program has changed; no engine snapshot built')
out=guard.assert_owned(ROOT/'engine-work'/('original-'+str(uuid.uuid4())))
out.mkdir(parents=True,exist_ok=False)
entries=[]
for template in sorted(SDK.iterdir()):
    if not template.is_file():continue
    if template.name=='electron.exe':name=EXE
    elif template.name=='LICENSE':name='LICENSE.electron.txt'
    elif template.name=='LICENSES.chromium.html' or template.name=='version' or template.name in ('vk_swiftshader_icd.json','icudtl.dat','resources.pak','chrome_100_percent.pak','chrome_200_percent.pak','snapshot_blob.bin','v8_context_snapshot.bin') or template.suffix=='.dll':name=template.name
    else:raise RuntimeError('Unreviewed Electron engine file: '+template.name)
    source=SOURCE/name
    current=transfer(source,out/name)
    expected=transfer(template)
    if template.name!='electron.exe' and current!=expected:
        raise RuntimeError('Original engine dependency differs from approved SDK: '+name)
    entries.append({'path':name,**current,'matchesThirdPartySdk':template.name!='electron.exe'})
locales=SDK/'locales';ordinary(locales,directory=True)
for template in sorted(locales.iterdir()):
    if not re.fullmatch(r'[A-Za-z0-9_-]+\.pak',template.name):raise RuntimeError('Unexpected engine locale file')
    name='locales/'+template.name;current=transfer(SOURCE/name,out/name)
    if current!=transfer(template):raise RuntimeError('Original locale differs from approved SDK')
    entries.append({'path':name,**current,'matchesThirdPartySdk':True})
manifest={'version':1,'purpose':'reviewed-original-electron-engine','sourceRoot':str(SOURCE),'root':str(out),'executableName':EXE,'sourceProgram':{'version':'1.5.0','main':'main.cjs','asarSize':asar['size'],'asarSha256':asar['sha256']},'files':entries,'engineExecuted':False,'businessDatabasesRead':False,'productionFilesModified':False,'capabilitiesVerified':False}
file=guard.assert_owned(ROOT/'reports/original-engine-copy-manifest.json')
with file.open('x',encoding='utf-8') as handle:json.dump(manifest,handle,ensure_ascii=False,indent=2)
print(json.dumps({'root':str(out),'files':len(entries),'bytes':sum(x['size'] for x in entries),'engine':next(x for x in entries if x['path']==EXE),'engineExecuted':False,'businessDatabasesRead':False,'productionFilesModified':False},ensure_ascii=False))
