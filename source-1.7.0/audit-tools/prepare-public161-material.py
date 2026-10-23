"""Host-only fixed public161 material preparation. Pure file data; never execute payloads.
CreateNew output is an explicitly named PE/ASAR resource material, not a code overlay.
"""

import argparse
import hashlib
import json
import os
import re
import stat
import sys
from pathlib import Path

OLD_SHA = 'e1ff037d5fdb819561719c44487455c676fb90f8e8c18ff54509fbe155828095'
TRUST_SHA = '03e9a804fd6b34af15e267cac159c839bed791ab735a0a2dfb6f56151310d18f'
TARGET_SHA = 'fe20ea7d83f2e2200624bf81364078ca8b206d1efcc8dbad03b1841d0fab9da2'
TARGET_PROOF_SHA = '1a1e0aa79ec55125c847bb6c4151b24e7807c733397ba7d58b526c420ece26c7'
MAX_FILE, JSON_LIMIT, CHUNK = 805306368, 2097152, 1048576
SHA = re.compile(r'[0-9a-f]{64}')
SECRET = re.compile(rb'-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{24,}')
PURPOSE = 'public161-program-resource-material-v1'

def need(value, message):
    if not value: raise RuntimeError(message)

def sha(body): return hashlib.sha256(body).hexdigest()
def norm(value): return os.path.normcase(os.path.normpath(str(value)))
def stamp(value):
    return tuple(getattr(value, name, None) for name in
                 ('st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns','st_nlink','st_birthtime_ns','st_file_attributes'))
def common_identity(left, right):
    return all(getattr(left, name) == getattr(right, name) for name in
               ('st_dev','st_ino','st_size','st_mtime_ns','st_nlink'))

def ordinary(file, root, directory=False):
    file, root = Path(file).absolute(), Path(root).absolute()
    need(file.is_relative_to(root) and not str(file).startswith(('\\\\','//')), 'FIXED_ROOT_CONTAINMENT_REQUIRED')
    for item in (file, *file.parents):
        value = item.lstat()
        need(value.st_ino != 0, 'FILESYSTEM_IDENTITY_REQUIRED')
        need(not stat.S_ISLNK(value.st_mode) and not getattr(value,'st_file_attributes',0)&0x400, 'REPARSE_POINT_REFUSED')
        need(not stat.S_ISREG(value.st_mode) or value.st_nlink == 1, 'HARDLINK_REFUSED')
        if item != file: need(stat.S_ISDIR(value.st_mode), 'ORDINARY_ANCESTOR_REQUIRED')
    value = file.lstat()
    need(stat.S_ISDIR(value.st_mode) if directory else stat.S_ISREG(value.st_mode), 'ORDINARY_TYPE_REQUIRED')
    need(norm(os.path.realpath(file)) == norm(file) and norm(os.path.realpath(root)) == norm(root), 'CANONICAL_PATH_REQUIRED')
    return file, value

def relative(value):
    need(isinstance(value,str) and value and len(value.encode('utf-8')) <= 240, 'CANONICAL_RELATIVE_PATH_REQUIRED')
    parts = value.split('/')
    need(all(part and part not in ('.','..') and not re.search(r'[\\:\x00-\x1f]',part)
             and not part.endswith(('.',' ')) and not re.match(r'^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)',part,re.I)
             for part in parts), 'UNSAFE_RELATIVE_PATH')
    return value

def program_path(value):
    relative(value)
    need(value.startswith('resources/') and
         (value == 'resources/app.asar' or value == 'resources/app.asar.unpacked/ocr.winrt.ps1'
          or value.startswith(('resources/release-modules/','resources/print-dependencies/node_modules/','resources/update-helper/'))),
         'PROGRAM_RESOURCE_PATH_REQUIRED')
    need(not any(re.fullmatch(r'data|configs?|profiles?|cache|logs?|backups?|private|legacy-source|stage1|\.release-build',p,re.I)
                 for p in value.split('/')) and
         not re.search(r'\.(db(?:-wal|-shm)?|sqlite3?(?:-wal|-shm)?|key|pem|pfx|xjybak)$',value,re.I) and
         not re.search(r'(?:^|/)(accounts?|customers?|credentials|xjy-install-activation|request|recovery-pointer)\.json$',value,re.I),
         'NON_PROGRAM_PATH_REFUSED')
    return value

def parents(file, root):
    ordinary(root, root, True)
    cursor = root
    for part in file.relative_to(root).parts[:-1]:
        cursor /= part
        if not os.path.lexists(cursor): cursor.mkdir()
        ordinary(cursor, root, True)

def mkdir_new(directory, boundary):
    ordinary(directory.parent, boundary, True)
    need(not os.path.lexists(directory), 'CREATE_NEW_DIRECTORY_REQUIRED')
    directory.mkdir()
    ordinary(directory, boundary, True)

def transfer(file, root, expected=None, destination=None, output_root=None, collect=False, limit=MAX_FILE):
    file, before = ordinary(file, root)
    need(0 <= before.st_size <= limit, 'BOUNDED_PROGRAM_FILE_REQUIRED')
    source = os.open(file, os.O_RDONLY | getattr(os,'O_BINARY',0) | getattr(os,'O_NOFOLLOW',0))
    target = None
    try:
        opened = os.fstat(source)
        need(stat.S_ISREG(opened.st_mode) and opened.st_nlink == 1 and common_identity(before,opened), 'SOURCE_IDENTITY_CHANGED')
        if destination is not None:
            parents(destination,output_root)
            need(not os.path.lexists(destination), 'CREATE_NEW_FILE_REQUIRED')
            target = os.open(destination,os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,'O_BINARY',0),0o600)
            created = os.fstat(target)
            need(stat.S_ISREG(created.st_mode) and created.st_nlink == 1 and created.st_size == 0, 'NEW_OUTPUT_IDENTITY_REQUIRED')
        digest, total, head, tail, pieces = hashlib.sha256(), 0, b'', b'', []
        while True:
            body = os.read(source, CHUNK)
            if not body: break
            if not head: head = body[:16]
            total += len(body); need(total <= limit, 'PROGRAM_FILE_SIZE_LIMIT')
            need(not SECRET.search(tail+body), 'PRIVATE_OR_API_KEY_CONTENT_REFUSED')
            tail = (tail+body)[-160:]
            digest.update(body)
            if collect: pieces.append(body)
            if target is not None:
                offset = 0
                while offset < len(body):
                    count = os.write(target,body[offset:])
                    need(count > 0, 'SHORT_COPY_WRITE')
                    offset += count
        need(head != b'SQLite format 3\x00', 'SQLITE_HEADER_REFUSED')
        record = {'size':total,'sha256':digest.hexdigest()}
        need(total == before.st_size and stamp(os.fstat(source)) == stamp(opened), 'SOURCE_CHANGED_DURING_READ')
        _, after = ordinary(file,root)
        need(stamp(before) == stamp(after), 'SOURCE_CHANGED_AFTER_READ')
        if expected is not None:
            need(record == {'size':expected['size'],'sha256':expected['sha256']}, 'PROGRAM_SIZE_OR_SHA_MISMATCH')
        if target is not None:
            os.fsync(target)
            current = os.fstat(target); _, named = ordinary(destination,output_root)
            need(current.st_dev == created.st_dev and current.st_ino == created.st_ino and
                 current.st_nlink == 1 and current.st_size == total and common_identity(current,named), 'OUTPUT_IDENTITY_CHANGED')
    finally:
        os.close(source)
        if target is not None: os.close(target)
    if destination is not None: transfer(destination,output_root,record,limit=limit)
    return (record,b''.join(pieces)) if collect else record

def bytes_pinned(file, root, pin, limit=JSON_LIMIT):
    need(isinstance(pin,str) and SHA.fullmatch(pin), 'FULL_SHA_REQUIRED')
    record, body = transfer(file,root,collect=True,limit=limit)
    need(record['sha256'] == pin, 'SOURCE_PIN_MISMATCH')
    return body

def write_new(file, body, root):
    parents(file,root)
    need(not os.path.lexists(file), 'CREATE_NEW_FILE_REQUIRED')
    fd = os.open(file,os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,'O_BINARY',0),0o600)
    try:
        initial = os.fstat(fd); need(stat.S_ISREG(initial.st_mode) and initial.st_nlink == 1, 'NEW_FILE_REQUIRED')
        offset = 0
        while offset < len(body):
            count = os.write(fd,body[offset:]); need(count > 0,'SHORT_METADATA_WRITE'); offset += count
        os.fsync(fd); current = os.fstat(fd); _, named = ordinary(file,root)
        need(current.st_dev == initial.st_dev and current.st_ino == initial.st_ino and common_identity(current,named), 'METADATA_OUTPUT_CHANGED')
    finally: os.close(fd)
    transfer(file,root,{'size':len(body),'sha256':sha(body)})

def unique(pairs):
    result = {}
    for key,value in pairs:
        need(key not in result,'DUPLICATE_JSON_KEY'); result[key] = value
    return result
def reject_constant(value): raise RuntimeError('NONFINITE_JSON_REFUSED')
def json_value(body): return json.loads(body,object_pairs_hook=unique,parse_constant=reject_constant)
def json_bytes(value): return (json.dumps(value,ensure_ascii=False,sort_keys=True,indent=2)+'\n').encode('utf-8')

def row(value):
    need(isinstance(value,dict) and set(value) == {'path','size','sha256'} and type(value['size']) is int
         and 0 <= value['size'] <= MAX_FILE and isinstance(value['sha256'],str) and SHA.fullmatch(value['sha256']), 'EXACT_FILE_RECORD_REQUIRED')
    relative(value['path']); return value

def manifest(body, version):
    value = json_value(body)
    need(value.get('version') == 1 and value.get('product') == 'xjy-jewelry-offline' and
         value.get('programVersion') == version and value.get('resourcesOnly') is True and
         value.get('fileCount') == 1007 and isinstance(value.get('files'),list) and len(value['files']) == 1007, 'FIXED_RESOURCE_MANIFEST_REQUIRED')
    files = [row(item) for item in value['files']]
    for item in files: program_path(item['path'])
    need(len({item['path'].casefold() for item in files}) == 1007, 'DUPLICATE_RESOURCE_PATH')
    need(sum(item['size'] for item in files) <= 1073741824, 'RESOURCE_TOTAL_LIMIT')
    return files

def trust(body, baseline):
    value = json_value(body)
    need(set(value) == {'targetVersion','executableName','publisherPublicKeySha256','engineVersion','engineFiles','allowedResourceFiles'}
         and value['targetVersion'] == '1.6.1' and value['engineVersion'] == '44.7.0'
         and value['executableName'] == '鑫金源珠宝报价.exe'
         and value['publisherPublicKeySha256'] == '6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c'
         and isinstance(value['engineFiles'],list) and len(value['engineFiles']) == 72
         and sorted(value['allowedResourceFiles']) == sorted(item['path'] for item in baseline), 'FIXED_161_ENGINE_TRUST_REQUIRED')
    files = [row(item) for item in value['engineFiles']]
    need(len({item['path'].casefold() for item in files}) == 72 and sum(item['size'] for item in files) <= 1073741824, 'ENGINE_INVENTORY_REQUIRED')
    for item in files:
        need(not any(re.fullmatch(r'resources|data|configs?|profiles?|private|credentials|backups?',p,re.I) for p in item['path'].split('/'))
             and not re.search(r'\.(db|sqlite3?|pem|key|pfx)$',item['path'],re.I) and item['path'] != 'xjy-install-activation.json', 'ENGINE_PATH_REFUSED')
    exe = next((item for item in files if item['path'] == value['executableName']),None)
    need(exe == {'path':'鑫金源珠宝报价.exe','size':246302720,'sha256':'db3ad2066a55546f9b6737da3c7f011370e4856fb36888055b544d45653e4f40'}, 'EXACT_ORIGINAL_ENGINE_REQUIRED')
    return files

def exact_tree(root, expected):
    ordinary(root,root,True)
    wanted, directories = set(expected), set()
    for name in wanted:
        relative(name)
        parts = name.split('/')
        directories.update('/'.join(parts[:i]) for i in range(1,len(parts)))
    actual, seen_dirs = set(), set()
    def walk(directory):
        for name in sorted(os.listdir(directory)):
            file = directory/name; rel = file.relative_to(root).as_posix()
            value = file.lstat()
            ordinary(file,root,stat.S_ISDIR(value.st_mode))
            if stat.S_ISDIR(value.st_mode):
                need(rel in directories, 'EXTRA_DIRECTORY_REFUSED'); seen_dirs.add(rel); walk(file)
            else:
                need(rel in wanted, 'EXTRA_FILE_REFUSED'); actual.add(rel)
    walk(root)
    need(actual == wanted and seen_dirs == directories, 'EXTRA_MISSING_OR_EMPTY_PATH_REFUSED')

def verify_resources(root, rows):
    exact_tree(root/'resources',[item['path'][len('resources/'):] for item in rows])
    for item in rows: transfer(root/item['path'],root,item)

def changed_rows(baseline, target):
    current = {item['path']:item for item in target}
    need(set(current) == {item['path'] for item in baseline}, 'RESOURCE_PATH_SETS_DIFFER')
    return [item for item in baseline if item != current[item['path']]]

def material_metadata(baseline_body, trust_body, baseline, target):
    changed = changed_rows(baseline,target)
    files = [{'path':'baseline161-manifest.json','size':len(baseline_body),'sha256':OLD_SHA},
             {'path':'fresh-employee-trust.json','size':len(trust_body),'sha256':TRUST_SHA},
             *[{**item,'path':'changed/'+item['path']} for item in changed]]
    return {'version':1,'purpose':PURPOSE,'sourceVersion':'1.6.1','targetReferenceVersion':'1.6.2',
            'baselineManifestSha256':OLD_SHA,'targetManifestSha256':TARGET_SHA,'trustSha256':TRUST_SHA,
            'programResourceCount':1007,'changedResourceCount':len(changed),'reusedResourceCount':1007-len(changed),
            'changedResources':changed,'files':files}

ROOT = Path(__file__).absolute().parents[1]
EXPECTED = Path('E:/codex/2026-10-15/work/xjy-v16-deep-audit')
SELF = ROOT/'audit-tools/prepare-public161-material.py'
BASE = ROOT/'sandbox/results/release-161-artifact-a1'
TRUST = ROOT/'release-work/initial-fresh-employee-input-a1/安装组件/delivery-tools/fresh-employee-trust.json'
TARGET = ROOT/'sandbox/results/post161-session-a1/release-162-artifact-a2'
OUTPUT = ROOT/'sandbox/input/public161-material-a1'

def main():
    parser = argparse.ArgumentParser(allow_abbrev=False)
    for name in ('source-sha256','baseline-manifest-sha256','target-manifest-sha256'): parser.add_argument('--'+name,required=True)
    args = parser.parse_args()
    need(os.name == 'nt' and norm(ROOT) == norm(EXPECTED) and norm(Path(__file__).absolute()) == norm(SELF), 'FIXED_HOST_SOURCE_WORKSPACE_REQUIRED')
    need(args.baseline_manifest_sha256 == OLD_SHA and args.target_manifest_sha256 == TARGET_SHA, 'ROOT_EXPLICIT_FIXED_MANIFEST_PINS_REQUIRED')
    bytes_pinned(SELF,ROOT,args.source_sha256)
    baseline_body = bytes_pinned(BASE/'release-manifest.json',ROOT,OLD_SHA)
    trust_body = bytes_pinned(TRUST,ROOT,TRUST_SHA)
    target_body = bytes_pinned(TARGET/'release-manifest.json',ROOT,TARGET_SHA)
    baseline, target = manifest(baseline_body,'1.6.1'), manifest(target_body,'1.6.2')
    trust(trust_body,baseline)
    target_proof = json_value(bytes_pinned(TARGET/'data-free-proof.json',ROOT,TARGET_PROOF_SHA))
    need(target_proof.get('files') == target and target_proof.get('dataIncluded') is False and target_proof.get('signed') is False, 'FIXED_DATA_FREE_TARGET_PROOF_REQUIRED')
    exact_tree(BASE,[item['path'] for item in baseline]+['release-manifest.json','data-free-proof.json'])
    exact_tree(TARGET,[item['path'] for item in target]+['release-manifest.json','data-free-proof.json'])
    verify_resources(BASE,baseline); verify_resources(TARGET,target)
    material = material_metadata(baseline_body,trust_body,baseline,target)
    mkdir_new(OUTPUT,ROOT)
    write_new(OUTPUT/'baseline161-manifest.json',baseline_body,OUTPUT)
    write_new(OUTPUT/'fresh-employee-trust.json',trust_body,OUTPUT)
    for item in material['changedResources']:
        transfer(BASE/item['path'],ROOT,item,OUTPUT/'changed'/item['path'],OUTPUT)
    # All source program bytes are rechecked, not only the rows transported.
    verify_resources(BASE,baseline); verify_resources(TARGET,target)
    need(bytes_pinned(BASE/'release-manifest.json',ROOT,OLD_SHA) == baseline_body and
         bytes_pinned(TRUST,ROOT,TRUST_SHA) == trust_body and
         bytes_pinned(TARGET/'release-manifest.json',ROOT,TARGET_SHA) == target_body, 'INPUT_METADATA_CHANGED')
    bytes_pinned(TARGET/'data-free-proof.json',ROOT,TARGET_PROOF_SHA); bytes_pinned(SELF,ROOT,args.source_sha256)
    body = json_bytes(material); write_new(OUTPUT/'material-manifest.json',body,OUTPUT)
    exact_tree(OUTPUT,[item['path'] for item in material['files']]+['material-manifest.json'])
    for item in material['files']: transfer(OUTPUT/item['path'],OUTPUT,item)
    print(json.dumps({'purpose':PURPOSE,'prepared':True,'output':str(OUTPUT),'sourceSha256':args.source_sha256,
                      'materialManifestSha256':sha(body),'transportFiles':len(material['files'])+1,
                      'changedResources':material['changedResourceCount'],'reusedResources':material['reusedResourceCount'],
                      'transportBytes':sum(item['size'] for item in material['files'])+len(body),
                      'programExecuted':False,'databaseOpened':False,'privateKeyRead':False,'failedOutputsPreserved':True}))
    return 0

if __name__ == '__main__':
    try: raise SystemExit(main())
    except Exception as error:
        print(json.dumps({'purpose':PURPOSE,'prepared':False,'error':str(error),'programExecuted':False,'failedOutputsPreserved':True}),file=sys.stderr)
        raise SystemExit(1)

