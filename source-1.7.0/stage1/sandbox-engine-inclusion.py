"""Read-only inclusion of the exact reviewed owned original engine copy.

No F-drive path from provenance metadata is resolved or opened. No engine is
executed by this module. Capability flags require later actual guest evidence.
"""
from types import MappingProxyType
import hashlib
import os
from pathlib import Path
import re

KNOWN_ENGINE_SEAL = MappingProxyType({
    'manifestRelative': 'reports/original-engine-copy-manifest.json',
    'manifestSha256': '6893a279e6ab2ccaae36c9c66fd8c840ef4dacddc9cd9c78c24f87dd3f311ea4',
    'rootRelative': 'engine-work/original-40bebb87-ac8d-433d-a982-4e8bf97844d8',
    'executableName': '鑫金源珠宝报价.exe',
    'executableSha256': 'db3ad2066a55546f9b6737da3c7f011370e4856fb36888055b544d45653e4f40',
    'executableSize': 246302720, 'fileCount': 72, 'totalBytes': 385404497,
    'nativeTools': (
        ('delivery-tools/Initial-Path-Guard.ps1',2456,'4b51ba8e7300e0ce8875dcb2a3b060622d84f81459b8cc758d16c4f94eb3f8d7'),
        ('delivery-tools/Initial-Source-Lock.ps1',2726,'6a61a66f873ff92646c3a01064619fc3aff405a2d9161edea66fa57c2856b211'),
        ('delivery-tools/initial-patch-entry.cjs',11214,'b256d68fe32b2672cc9e850320870e67efe3e3da8fb935a2b63cc40f5968d1de'),
        ('delivery-tools/initial-patch-core.cjs',30422,'a86cfdd7ac7110f0fb428e954adb542e2b84533efc6e0448c686dd5a5e0d372a'),
        ('delivery-tools/initial-patch-backup.cjs',33217,'f3d6076ccfc01a572935beefe6ed79b4f3ea46153407b4d23f63029a14801413'),
        ('delivery-tools/initial-source-lease.cjs',3713,'5a6a84eaaae2e10c11c1473a2da8ef6b9ba70f41378094e83054ee67ae7d6ce2'),
        ('delivery-tools/Initial-Full-Upgrade.ps1',12815,'a7ce0ccf4bd539aef002d5f18823a37cab73d44ea8553bbdd457d24019d4d651'),
        ('delivery-tools/一键完整升级.cmd',196,'60616223a5cb4158d22de4033e956a89e5464520e4a0e6b12e132d0d76b145f6'),
        ('delivery-approval/Prepare-Initial-Approval.ps1',19760,'638480e6a7e393220d6b702df8a44b447394b84d4d29257d00377425210ee129'),
        ('delivery-approval/approval-core.cjs',12454,'498182be933fdf0e02ef7de75db0d553d76ffc7b6811675a987cf0868bb40593'),
        ('delivery-approval/approval-archive.cjs',5354,'5f31cbaba0b9668fa7592a3a190b09c86ad81f03ae08d55b39973b1449ba3ada'),
        ('delivery-approval/approval-io.cjs',7447,'4525eed03a81145e0d1b7ec14b6587d0036cc2e647643d5316c2c401db9d8aef'),
        ('delivery-approval/负责人首次审定.cmd',189,'fa55fd8c0c11b30adec58e03fd7f7d70362246c6eb0ca6883ae4e26acd74f398'),
        ('delivery-approval/README.md',6158,'596465aaa52d4e24f93ad760f54b2845e9f2f15659316c5d340a85ee7f94e93b'),
    ),
})
INDEPENDENT_REVIEWER_FILES = frozenset({
    'delivery-approval/Prepare-Initial-Approval.ps1',
    'delivery-approval/approval-core.cjs',
    'delivery-approval/approval-archive.cjs',
    'delivery-approval/approval-io.cjs',
    'delivery-approval/负责人首次审定.cmd',
    'delivery-approval/README.md',
})
TOP_FILES = frozenset({'chrome_100_percent.pak','chrome_200_percent.pak','d3dcompiler_47.dll',
    'dxcompiler.dll','dxil.dll','ffmpeg.dll','icudtl.dat','LICENSE.electron.txt',
    'LICENSES.chromium.html','resources.pak','snapshot_blob.bin','v8_context_snapshot.bin',
    'version','vk_swiftshader.dll','vk_swiftshader_icd.json','vulkan-1.dll'})


def _fail(message):
    raise RuntimeError('SANDBOX ENGINE INCLUSION: ' + message)


def _hash_ordinary(path, boundary, packaging):
    path=boundary.path(path)
    before=packaging._source_file(path,boundary.root)
    fd=os.open(path,os.O_RDONLY|getattr(os,'O_BINARY',0)|getattr(os,'O_NOFOLLOW',0))
    digest=hashlib.sha256();size=0
    try:
        if packaging._identity(os.fstat(fd))!=packaging._identity(before):
            _fail('engine file identity changed before hash')
        while block:=os.read(fd,1024*1024):
            if size==0 and block.startswith(b'SQLite format 3\0'):
                _fail('engine tree contains renamed database')
            digest.update(block);size+=len(block)
        after=packaging._source_file(path,boundary.root)
        if (packaging._identity(after),after.st_size,after.st_mtime_ns,after.st_nlink)!=(packaging._identity(before),before.st_size,before.st_mtime_ns,before.st_nlink):
            _fail('engine file changed during hash')
    finally:
        os.close(fd)
    return {'size':size,'sha256':digest.hexdigest()}


def _plan_engine(owned_root, seal, packaging):
    boundary=packaging._Boundary(owned_root)
    resource=packaging._release_helper()
    manifest_path=boundary.path(boundary.root/seal['manifestRelative'])
    metadata=resource._read(manifest_path,boundary,packaging,metadata=True)
    if metadata['sha256']!=seal['manifestSha256']:
        _fail('fixed reviewed engine manifest seal mismatch')
    manifest=resource._json(metadata)
    if manifest.get('version')!=1 or type(manifest.get('version')) is not int or manifest.get('purpose')!='reviewed-original-electron-engine':
        _fail('fixed reviewed engine manifest purpose/version required')
    for field in ('engineExecuted','businessDatabasesRead','productionFilesModified','capabilitiesVerified'):
        if manifest.get(field) is not False:
            _fail('reviewed copy flags cannot claim executed or verified capabilities')
    # sourceRoot is informational provenance only. Never pass it to a filesystem API.
    engine=boundary.path(boundary.root/seal['rootRelative'])
    if boundary.path(manifest.get('root',''))!=engine or not engine.is_dir():
        _fail('owned engine root differs from fixed reviewed root')
    if manifest.get('executableName')!=seal['executableName']:
        _fail('fixed reviewed executable name required')
    files=manifest.get('files')
    if not isinstance(files,list) or len(files)!=seal['fileCount']:
        _fail('complete reviewed engine file count required')
    seen=set();declared={}
    for row in files:
        if not isinstance(row,dict) or set(row)!={'path','size','sha256','matchesThirdPartySdk'}:
            _fail('exact engine manifest row required')
        name=resource._relative(row['path'],packaging)
        if name.casefold() in seen:
            _fail('duplicate casefolded engine path')
        seen.add(name.casefold())
        if not (name==seal['executableName'] or name in TOP_FILES or name=='locales/fil.pak' or re.fullmatch(r'locales/[A-Za-z]{2}(?:-[A-Za-z0-9]{2,3})?\.pak',name)):
            _fail('engine file is outside the reviewed runtime allowlist')
        if type(row['size']) is not int or row['size']<0 or not resource.SHA256.fullmatch(str(row['sha256'])):
            _fail('engine manifest size/hash malformed')
        if row['matchesThirdPartySdk'] is not (name!=seal['executableName']):
            _fail('reviewed SDK comparison must differ only for branded executable')
        declared[name]=row
    if sum(row['size'] for row in files)!=seal['totalBytes']:
        _fail('reviewed engine total byte seal mismatch')
    executable=declared.get(seal['executableName'])
    if not executable or executable['size']!=seal['executableSize'] or executable['sha256']!=seal['executableSha256']:
        _fail('reviewed engine executable size/hash seal mismatch')
    actual=resource._actual_tree(engine,boundary,packaging)
    if set(actual)!=set(declared) or len(actual)!=len(declared):
        _fail('complete reviewed engine tree has extra or missing file')
    records=[]
    for name in sorted(declared):
        source=boundary.path(engine/name)
        record=_hash_ordinary(source,boundary,packaging)
        if record['size']!=declared[name]['size'] or record['sha256']!=declared[name]['sha256']:
            _fail('reviewed engine file size/hash drift: '+name)
        records.append({'source':str(source),'destination':'release-candidate/'+name,**record})
    records.append({'source':str(manifest_path),'destination':'release-candidate/engine-allowlist.json',
                    'size':metadata['size'],'sha256':metadata['sha256']})
    # Explicit program files only; never traverse the delivery folder or accept
    # key/data additions by changing the global source exclusion rules.
    tool_bytes=0
    for name,size,digest in seal.get('nativeTools',()):
        if resource._relative(name,packaging)!=name or not (name.startswith('delivery-tools/') or name in INDEPENDENT_REVIEWER_FILES) or type(size) is not int or size<0 or not resource.SHA256.fullmatch(digest):
            _fail('fixed native program tool allowlist malformed')
        source=boundary.path(boundary.root/name);actual_tool=_hash_ordinary(source,boundary,packaging)
        if actual_tool!={'size':size,'sha256':digest}:
            _fail('fixed native program tool size/hash drift: '+name)
        records.append({'source':str(source),'destination':name,**actual_tool});tool_bytes+=size
    return {'version':1,'purpose':'reviewed-original-electron-engine','sourceRoot':seal['rootRelative'],
        'manifestRelative':seal['manifestRelative'],'manifestSha256':metadata['sha256'],
        'destinationRoot':'release-candidate','executableName':seal['executableName'],
        'executableSha256':seal['executableSha256'],'engineFileCount':len(declared),
        'fileCount':len(records),'engineBytes':seal['totalBytes'],'nativeProgramToolCount':len(seal.get('nativeTools',())),
        'totalBytes':seal['totalBytes']+metadata['size']+tool_bytes,
        'files':records,'engineExecuted':False,'capabilitiesVerified':False,'sourcePolicyCapabilitiesEligible':False}


def plan(owned_root, packaging):
    return _plan_engine(owned_root,KNOWN_ENGINE_SEAL,packaging)
