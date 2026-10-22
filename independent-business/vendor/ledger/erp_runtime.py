"""Signed desktop path provider. Layout never grants business actor authority.

Unbound callers retain the original Stage path branch. Only an explicit,
verified bootstrap can bind release context; environment flags cannot select it.
"""
import json
import os
from pathlib import Path
from desktop_runtime_context import load_desktop_context as _load
from desktop_runtime_context import retained_number_file, erp_attachments_dir
from desktop_runtime_context import _checked

_release_credentials=None

def configure_release_context(moduleId,token,contextFile,signature,expectedDataDir):
    global _release_credentials
    if moduleId!='ledger' or os.environ.get('XJY_STAGE1_ROOT'):raise ValueError('Release ERP context cannot replace a Stage context')
    context=_load(moduleId,token,contextFile,signature,expectedDataDir)
    candidate=(moduleId,token,str(contextFile),signature,context['dataDir'])
    if _release_credentials is not None and _release_credentials!=candidate:raise ValueError('Release ERP context is already bound')
    _release_credentials=candidate
    return dict(context)

def release_context():
    if _release_credentials is None:return None
    if os.environ.get('XJY_STAGE1_ROOT'):raise ValueError('Stage and release contexts cannot coexist')
    return _load(*_release_credentials)

def number_store():
    context=release_context()
    if context is not None:return retained_number_file(context),context['hostId']
    # Same Stage slot/identity lookup as the original number implementation;
    # Stage sidecar/python_guard supplies its unchanged IO restrictions.
    root=Path(os.environ['XJY_STAGE1_ROOT']);filename=root/'config'/'erp-number-reservations.json'
    identity=json.loads((root/'isolation-identity.json').read_text('utf-8'))
    return filename,identity['namespace']

def _owner_pairs(pairs):
    value={}
    for key,item in pairs:
        if key in value:raise ValueError('Duplicate attachment owner marker field')
        value[key]=item
    return value

def attachments_storage(configuredDataDirs,create=False):
    context=release_context()
    if context is None:return None
    if not isinstance(configuredDataDirs,(list,tuple)) or not configuredDataDirs:raise ValueError('Explicit ledger data configuration required')
    # Reuse the signed loader for each original module data source; aliases,
    # links and a changed LEDGER_DATA/config cannot silently redirect vouchers.
    for configured in configuredDataDirs:
        if not configured:raise ValueError('Explicit ledger data configuration required')
        _load(*_release_credentials[:4],configured)
    root=Path(context['dataDir']);directory=erp_attachments_dir(context)
    if not directory.exists():
        if not create:return root,directory
        directory.mkdir(parents=False,exist_ok=False)
    directory=_checked(directory)
    owner=_checked(directory/'.owner.json',kind='file',allow_missing=True)
    expected={'version':1,'namespace':context['hostId'],'type':'erp-attachments'}
    if not owner.exists():
        if not create or any(directory.iterdir()):raise ValueError('Unowned attachment directory cannot be adopted')
        # Exclusive initial marker, no replacement of unknown historical files.
        with owner.open('x',encoding='utf-8') as output:
            output.write(json.dumps(expected,sort_keys=True,separators=(',',':')));output.flush();os.fsync(output.fileno())
    owner=_checked(owner,kind='file')
    if not 1<=owner.stat().st_size<=16384:raise ValueError('Invalid attachment owner marker size')
    with owner.open('rb') as source:raw=source.read(16385)
    if len(raw)>16384:raise ValueError('Invalid attachment owner marker size')
    saved=json.loads(raw.decode('utf-8'),object_pairs_hook=_owner_pairs)
    if not isinstance(saved,dict) or set(saved)!=set(expected) or type(saved.get('version')) is not int or saved!=expected:raise ValueError('Attachment owner marker does not match signed host')
    _checked(owner,kind='file');erp_attachments_dir(context)
    return root,directory
