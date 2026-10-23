"""Guest public-data staging only. No approvals, profile, engine or program run."""
from pathlib import Path, PurePosixPath
import argparse, base64, hashlib, importlib.util, json, os, re, stat, sys
sys.dont_write_bytecode=True

ROOT=Path('C:/xjy-work/xjy-web-stage1'); SELF=ROOT/'audit-tools/stage-employee162-a4-native-materials.py'
HELPER=ROOT/'audit-tools/prepare-guest-audit.py'; HELPER_SHA='07cc5f28953e3b3ff2bd46be7275947a04c50885014bcff94544870ec6311b06'
SOURCE=Path('C:/xjy-input/employee162-a4-native-materials-a1'); TARGET=ROOT/'runtime/employee162-a4-native-materials-a1'; REPORT=Path('C:/xjy-results/employee162-a4-native-materials-stage-a1.json')
NS='36fcbe9c-ece1-4be3-af35-309a2ee19e05'; PURPOSE='employee162-a4-native-public-materials'; SHA=re.compile(r'[a-f0-9]{64}')
CONTEXT_SHA='09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249'; VALIDATOR_SHA='867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207'
POLICY='2d1bd5ed113ca0bff2e1d3ddea9a40e1fde82ffd1d22c35709cf52f1b4e7e439'; CATALOG='898e15209abeddd038eeb353a27dd1cb3526148419558ea6f1d53c298a3aa9a8'
META={'source-policy-envelope.json':'2823d0281097691aa326c00d6e6ebdb430671ba43d7c5b00284acd868ac76422','catalog-envelope.json':'89585e466348105d38f65417a8dca10f002b548ac10974bb2d818257c3350307','publisher-public.pem':'bc6c3d2b42871e42d3eb91371034b410d507a228eeccb1d714acca60e8141b30'}
ZIP_SHA='752d780b2a460ecb10bb1dbeee53187dd8486f697d0d9c9f082c8408888e866a'; ZIP_BYTES=163521799
SEAL_SHA='36497298eef0853e7adfcb4881dd969d691cfc496a4e7070cae4e871b5b9a232'; ARTIFACT_TREE='27eef1fe6d4bef6149fd76251d9779022aba918da69b3461d28f9962d46e633d'
TOOLS=['delivery-tools/initial-patch-core.cjs','delivery-tools/initial-patch-backup.cjs','delivery-tools/initial-patch-entry.cjs','delivery-tools/Initial-Full-Upgrade.ps1','delivery-tools/Initial-Path-Guard.ps1','delivery-tools/Initial-Source-Lock.ps1','delivery-tools/initial-source-lease.cjs','一键完整升级.cmd','project/desktop/employee-update-cache.cjs','project/desktop/employee-update-installer.cjs']
SECRET=re.compile(rb'(?m)^-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/=]+|\bsk-[A-Za-z0-9_-]{24,}')

def need(v,c):
    if not v: raise RuntimeError(c)
def sha(b): return hashlib.sha256(b).hexdigest()
def encoded(v): return (json.dumps(v,ensure_ascii=False,indent=2)+'\n').encode('utf-8')
def relative(name):
    need(isinstance(name,str) and 0<len(name.encode('utf-8'))<=300 and not re.search(r'[\\:\x00-\x1f<>"|?*]',name) and all(p not in ('','.','..') and not p.endswith((' ','.')) and not re.match(r'^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)',p,re.I) for p in name.split('/')),'CANONICAL_RELATIVE_PATH_REQUIRED'); return name
def plain(p):
    need(p.is_absolute() and (p.is_relative_to(SOURCE) or p.is_relative_to(ROOT)),'FIXED_INPUT_OR_ROOT_REQUIRED'); m.ordinary(p)
    # SOURCE is the intentional RO mapped folder, authenticated by manifest SHA.
    # Owned local ROOT/target paths must still be physically canonical.
    if not p.is_relative_to(SOURCE): need(os.path.normcase(os.path.realpath(p))==os.path.normcase(str(p)),'LOCAL_ROOT_ALIAS_REFUSED')
    return p
def read(p,pin=None):
    plain(p); before=p.stat(); need(p.is_file() and before.st_nlink==1 and before.st_size<=268435456,'BOUNDED_SINGLE_LINK_FILE_REQUIRED')
    with p.open('rb') as f: opened=os.fstat(f.fileno()); b=f.read(); ended=os.fstat(f.fileno())
    after=plain(p).stat(); common=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_nlink); stamp=lambda s:common(s)+(s.st_ctime_ns,)
    need(common(before)==common(opened) and stamp(before)==stamp(after) and stamp(opened)==stamp(ended) and len(b)==before.st_size,'INPUT_CHANGED'); need(pin is None or sha(b)==pin,'INPUT_PIN_CHANGED'); need(not b.startswith(b'SQLite format 3\0') and not SECRET.search(b),'PRIVATE_DATA_REFUSED'); return b
def exact_tree(root,rows):
    wanted={r['path']:r for r in rows}; need(len(wanted)==len(rows) and len({n.casefold() for n in wanted})==len(rows),'DUPLICATE_ROWS'); dirs=set(); seen=set()
    for name,row in wanted.items():
        relative(name); need(type(row['size']) is int and row['size']>=0 and SHA.fullmatch(row['sha256']),'ROW_IDENTITY_REQUIRED'); p=PurePosixPath(name).parent
        while str(p)!='.': dirs.add(str(p)); p=p.parent
    plain(root)
    for base,subdirs,files in os.walk(root,followlinks=False):
        for name in subdirs: p=plain(Path(base)/name); need(p.is_dir() and p.relative_to(root).as_posix() in dirs,'EXTRA_DIRECTORY')
        for name in files:
            p=Path(base)/name; rel=p.relative_to(root).as_posix(); need(rel in wanted,'EXTRA_FILE'); b=read(p,wanted[rel]['sha256']); need(len(b)==wanted[rel]['size'],'SIZE_MISMATCH'); seen.add(rel)
    need(seen==set(wanted),'MISSING_FILE')
def tree_sha(rows): return sha(''.join(r['path']+'\0'+str(r['size'])+'\0'+r['sha256']+'\n' for r in sorted(rows,key=lambda r:r['path'])).encode('utf-8'))
def signed(raw,field,pin):
    x=json.loads(raw); need(set(x)=={field,'signature'} and isinstance(x[field],str) and sha(x[field].encode())==pin,'SIGNED_METADATA_IDENTITY_REQUIRED'); b=base64.b64decode(x['signature'],validate=True); need(len(b)==64 and base64.b64encode(b).decode()==x['signature'],'SIGNATURE_ENCODING_REQUIRED'); return json.loads(x[field])
def actual():
    read(ROOT/'stage1/sandbox-context.py',CONTEXT_SHA); read(ROOT/'stage1/validate-sandbox-context.py',VALIDATOR_SHA); proof=ctx.read_context(ROOT); need(json.loads(read(ROOT/'isolation-identity.json'))['namespace']==NS,'ROOT36_NAMESPACE_REQUIRED'); return proof
def main():
    global m,ctx
    need(os.name=='nt' and Path(__file__).absolute()==SELF and os.environ.get('USERNAME','').lower()=='wdagutilityaccount','FIXED_ACTUAL_GUEST_SOURCE_REQUIRED'); a=argparse.ArgumentParser(allow_abbrev=False); a.add_argument('--source-sha256',required=True); a.add_argument('--manifest-sha256',required=True); args=a.parse_args(); need(all(SHA.fullmatch(v) and set(v)!={'0'} for v in (args.source_sha256,args.manifest_sha256)),'EXPLICIT_NONZERO_PINS_REQUIRED')
    for p,pin in ((SELF,args.source_sha256),(HELPER,HELPER_SHA),(ROOT/'stage1/sandbox-context.py',CONTEXT_SHA),(ROOT/'stage1/validate-sandbox-context.py',VALIDATOR_SHA)):
        for q in (p,*p.parents): s=q.lstat(); need(not stat.S_ISLNK(s.st_mode) and not getattr(s,'st_file_attributes',0)&0x400 and (not stat.S_ISREG(s.st_mode) or s.st_nlink==1),'LOCAL_SOURCE_LINK_REFUSED')
        need(sha(p.read_bytes())==pin,'LOCAL_SOURCE_SHA_CHANGED')
    spec=importlib.util.spec_from_file_location('pinned_public_preparation',HELPER); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    spec=importlib.util.spec_from_file_location('original_actual_context',ROOT/'stage1/sandbox-context.py'); ctx=importlib.util.module_from_spec(spec); spec.loader.exec_module(ctx); initial=actual()
    need(not os.path.lexists(TARGET) and not os.path.lexists(REPORT),'CREATE_NEW_TARGET_AND_REPORT_REQUIRED'); plain(TARGET); plain(TARGET.parent)
    mb=read(SOURCE/'transport-manifest.json',args.manifest_sha256); manifest=json.loads(mb)
    need(manifest['version']==1 and manifest['purpose']==PURPOSE and manifest['synthetic'] is True and manifest['namespace']==NS and manifest['artifactFileCount']==1020 and manifest['sealReportSha256']==SEAL_SHA and manifest['artifactTreeSha256']==ARTIFACT_TREE and manifest['metadataPins']==META and manifest['sourcePolicySha256']==POLICY and manifest['catalogSha256']==CATALOG,'FIXED_PUBLIC_TRANSPORT_REQUIRED')
    for flag in ('programExecuted','privateKeyIncluded','approvalIncluded','profileIncluded'): need(manifest[flag] is False,'NONPUBLIC_TRANSPORT_REFUSED')
    metadata={name:read(SOURCE/'artifact'/name,pin) for name,pin in META.items()}; policy=signed(metadata['source-policy-envelope.json'],'policy',POLICY); catalog=signed(metadata['catalog-envelope.json'],'catalog',CATALOG)
    need(policy['purpose']=='xjy-repeat-program-patch' and policy['targetVersion']=='1.6.2' and policy['catalogSha256']==CATALOG and [r['path'] for r in policy['tools']]==TOOLS and len(catalog['files'])==1007 and catalog['sequence']==10 and catalog['version']=='1.6.2' and catalog['archive']=={'size':ZIP_BYTES,'sha256':ZIP_SHA},'EXACT_POLICY_CATALOG_AND_TOOLS_REQUIRED')
    artifact=[dict(r) for r in policy['tools']]+[{'path':'payload/'+r['path'],'size':r['size'],'sha256':r['sha256']} for r in catalog['files']]+[{'path':name,'size':len(b),'sha256':META[name]} for name,b in metadata.items()]
    need(len(artifact)==1020 and tree_sha(artifact)==ARTIFACT_TREE,'ARTIFACT_IDENTITY_CHANGED'); rows=[{'path':'artifact/'+r['path'],'size':r['size'],'sha256':r['sha256']} for r in artifact]+[{'path':'package.zip','size':ZIP_BYTES,'sha256':ZIP_SHA}]
    need(sorted(rows,key=lambda r:r['path'])==manifest['files'] and tree_sha(rows)==manifest['materialTreeSha256'],'MANIFEST_FILE_SET_CHANGED'); allrows=rows+[{'path':'transport-manifest.json','size':len(mb),'sha256':args.manifest_sha256}]; exact_tree(SOURCE,allrows); actual(); read(SELF,args.source_sha256); read(HELPER,HELPER_SHA)
    need(not os.path.lexists(TARGET) and not os.path.lexists(REPORT),'CREATE_NEW_REQUIRED'); TARGET.mkdir(); plain(TARGET)
    for row in allrows: body=read(SOURCE/row['path'],row['sha256']); need(len(body)==row['size'],'SOURCE_SIZE_CHANGED'); plain(TARGET/row['path']); m.write_new(TARGET/row['path'],body)
    exact_tree(SOURCE,allrows); exact_tree(TARGET,allrows); final=actual(); read(SELF,args.source_sha256); read(HELPER,HELPER_SHA); need(not os.path.lexists(REPORT),'CREATE_NEW_REPORT_REQUIRED')
    result={'purpose':PURPOSE,'staged':True,'sourceSha256':args.source_sha256,'manifestSha256':args.manifest_sha256,'source':str(SOURCE),'target':str(TARGET),'artifactFileCount':1020,'transportFileCount':1022,'artifactTreeSha256':ARTIFACT_TREE,'materialTreeSha256':tree_sha(rows),'transportTreeSha256':tree_sha(allrows),'initialContext':initial,'finalContext':final,'allSourceAndTargetBytesVerified':True,'programExecuted':False,'privateKeyRead':False,'approvalCreated':False,'profileCreated':False}; m.write_new(REPORT,encoded(result)); need(sha(REPORT.read_bytes())==sha(encoded(result)),'REPORT_READBACK_FAILED'); print(json.dumps(result))

if __name__=='__main__': main()
