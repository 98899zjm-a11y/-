"""Fixed Host public-data transport only; never executes product or signing code."""
from pathlib import Path, PurePosixPath
import argparse, base64, hashlib, importlib.util, json, os, re, stat, sys
sys.dont_write_bytecode=True

ROOT=Path('E:/codex/2026-10-15/work/xjy-v16-deep-audit'); SELF=ROOT/'audit-tools/prepare-employee162-a4-native-materials.py'
HELPER=ROOT/'audit-tools/prepare-guest-audit.py'; HELPER_SHA='07cc5f28953e3b3ff2bd46be7275947a04c50885014bcff94544870ec6311b06'
ARTIFACT=ROOT/'release-work/initial-162-host-sealed-a4'; ZIP=ROOT/'release-work/initial-162-feed-a4/package.zip'; SEAL_REPORT=ROOT/'reports/release-162-host-seal-a4.json'
OUT=ROOT/'sandbox/input/employee162-a4-native-materials-a1'; REPORT=ROOT/'reports/employee162-a4-native-materials-prepare-a1.json'
NS='36fcbe9c-ece1-4be3-af35-309a2ee19e05'; PURPOSE='employee162-a4-native-public-materials'; SHA=re.compile(r'[a-f0-9]{64}')
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
def program(name):
    relative(name); need(name=='resources/app.asar' or name=='resources/app.asar.unpacked/ocr.winrt.ps1' or name.startswith(('resources/print-dependencies/','resources/update-helper/','resources/release-modules/')),'PROGRAM_RESOURCE_PATH_REQUIRED')
    need(not re.search(r'\.(?:db(?:-wal|-shm)?|sqlite3?(?:-wal|-shm)?|key|pem|pfx|xjybak)$',name,re.I) and not any(re.fullmatch(r'data|configs?|profiles?|cache|logs?|backups?|private|credentials',p,re.I) for p in name.split('/')),'PRIVATE_RESOURCE_REFUSED')
def plain(p):
    need(p.is_absolute() and p.is_relative_to(ROOT),'FIXED_WORKSPACE_REQUIRED'); m.ordinary(p); need(os.path.normcase(os.path.realpath(p))==os.path.normcase(str(p)),'HOST_ALIAS_REFUSED'); return p
def read(p,pin=None):
    plain(p); before=p.stat(); need(p.is_file() and before.st_nlink==1 and before.st_size<=268435456,'BOUNDED_SINGLE_LINK_FILE_REQUIRED')
    with p.open('rb') as f: opened=os.fstat(f.fileno()); b=f.read(); ended=os.fstat(f.fileno())
    after=plain(p).stat(); common=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_nlink); stamp=lambda s:common(s)+(s.st_ctime_ns,)
    need(common(before)==common(opened) and stamp(before)==stamp(after) and stamp(opened)==stamp(ended) and len(b)==before.st_size,'INPUT_CHANGED'); need(pin is None or sha(b)==pin,'INPUT_PIN_CHANGED')
    need(not b.startswith(b'SQLite format 3\0') and not SECRET.search(b),'PRIVATE_DATA_REFUSED'); return b
def exact_tree(root,rows):
    wanted={r['path']:r for r in rows}; need(len(wanted)==len(rows) and len({n.casefold() for n in wanted})==len(rows),'DUPLICATE_ROW'); dirs=set(); seen=set()
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
    x=json.loads(raw); need(set(x)=={field,'signature'} and isinstance(x[field],str) and sha(x[field].encode())==pin,'SIGNED_METADATA_IDENTITY_REQUIRED'); sig=base64.b64decode(x['signature'],validate=True); need(len(sig)==64 and base64.b64encode(sig).decode()==x['signature'],'SIGNATURE_ENCODING_REQUIRED'); return json.loads(x[field])
def main():
    global m
    need(os.name=='nt' and Path(__file__).absolute()==SELF,'FIXED_HOST_SOURCE_REQUIRED'); a=argparse.ArgumentParser(allow_abbrev=False); a.add_argument('--source-sha256',required=True); args=a.parse_args(); need(SHA.fullmatch(args.source_sha256) and set(args.source_sha256)!={'0'},'EXPLICIT_NONZERO_SOURCE_PIN_REQUIRED')
    for p in (SELF,HELPER):
        for q in (p,*p.parents): s=q.lstat(); need(not stat.S_ISLNK(s.st_mode) and not getattr(s,'st_file_attributes',0)&0x400 and (not stat.S_ISREG(s.st_mode) or s.st_nlink==1),'SOURCE_LINK_REFUSED')
    need(sha(SELF.read_bytes())==args.source_sha256 and sha(HELPER.read_bytes())==HELPER_SHA,'SOURCE_SHA_CHANGED'); spec=importlib.util.spec_from_file_location('pinned_public_preparation',HELPER); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    need(not os.path.lexists(OUT) and not os.path.lexists(REPORT),'CREATE_NEW_OUTPUT_REQUIRED'); report=json.loads(read(SEAL_REPORT,SEAL_SHA))
    need(report['sealed'] is True and report['programVersion']=='1.6.2' and Path(report['directory'])==ARTIFACT and report['sourcePolicySha256']==POLICY and report['sourcePolicyEnvelopeSha256']==META['source-policy-envelope.json'],'EXACT_A4_SEAL_REPORT_REQUIRED')
    for k in ('published','installed','programExecuted','privateKeyRead','privateKeyIncluded','installable'): need(report[k] is False,'NONPUBLIC_SEAL_STATE')
    template=report['approvalTemplate']; need(len(template)==14 and all(template[k] is None for k in ('approvalId','verifiedPublisherName','role','installationDir','osUser','approvedAt','expiresAt')),'REAL_APPROVAL_REFUSED')
    mb={name:read(ARTIFACT/name,pin) for name,pin in META.items()}; policy=signed(mb['source-policy-envelope.json'],'policy',POLICY); catalog=signed(mb['catalog-envelope.json'],'catalog',CATALOG)
    need(policy['purpose']=='xjy-repeat-program-patch' and policy['targetVersion']=='1.6.2' and policy['catalogSha256']==CATALOG and policy['publisherPublicKeySha256']=='6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c' and policy==report['sourcePolicy'],'EXACT_PUBLIC_POLICY_REQUIRED')
    need(catalog['version']=='1.6.2' and catalog['sequence']==10 and catalog['sourceVersions']==['1.6.1','1.6.2'] and catalog['archive']=={'size':ZIP_BYTES,'sha256':ZIP_SHA} and len(catalog['files'])==1007 and [r['path'] for r in policy['tools']]==TOOLS,'EXACT_CATALOG_AND_TEN_TOOLS_REQUIRED')
    for r in catalog['files']: program(r['path'])
    rows=[dict(r) for r in policy['tools']]+[{'path':'payload/'+r['path'],'size':r['size'],'sha256':r['sha256']} for r in catalog['files']]+[{'path':n,'size':len(b),'sha256':META[n]} for n,b in mb.items()]
    need(len(rows)==1020,'EXACT_ARTIFACT_COUNT'); exact_tree(ARTIFACT,rows); need(tree_sha(rows)==report['treeSha256']==ARTIFACT_TREE,'SEALED_TREE_CHANGED'); need(sorted(rows,key=lambda r:r['path'])==sorted(report['files'],key=lambda r:r['path']),'SEAL_REPORT_FILE_SET_CHANGED'); need(len(read(ZIP,ZIP_SHA))==ZIP_BYTES,'RESOURCE_ZIP_SIZE_CHANGED')
    transport=[{'path':'artifact/'+r['path'],'size':r['size'],'sha256':r['sha256']} for r in rows]+[{'path':'package.zip','size':ZIP_BYTES,'sha256':ZIP_SHA}]; need(len({r['path'].casefold() for r in transport})==1021,'DUPLICATE_TRANSPORT_ROW')
    plain(OUT); OUT.mkdir();
    for row in transport:
        source=ZIP if row['path']=='package.zip' else ARTIFACT/row['path'][len('artifact/'):]; body=read(source,row['sha256']); need(len(body)==row['size'],'SOURCE_SIZE_CHANGED'); m.write_new(OUT/row['path'],body)
    exact_tree(ARTIFACT,rows); need(len(read(ZIP,ZIP_SHA))==ZIP_BYTES,'ZIP_CHANGED_AFTER_COPY'); exact_tree(OUT,transport)
    manifest={'version':1,'purpose':PURPOSE,'synthetic':True,'namespace':NS,'sourceSha256':args.source_sha256,'sealReportSha256':SEAL_SHA,'artifactTreeSha256':report['treeSha256'],'materialTreeSha256':tree_sha(transport),'sourcePolicySha256':POLICY,'catalogSha256':CATALOG,'metadataPins':META,'artifactFileCount':1020,'files':sorted(transport,key=lambda r:r['path']),'programExecuted':False,'privateKeyIncluded':False,'approvalIncluded':False,'profileIncluded':False}
    encoded_manifest=encoded(manifest); m.write_new(OUT/'transport-manifest.json',encoded_manifest); allrows=transport+[{'path':'transport-manifest.json','size':len(encoded_manifest),'sha256':sha(encoded_manifest)}]; exact_tree(OUT,allrows)
    need(read(SELF,args.source_sha256) and read(HELPER,HELPER_SHA) and read(SEAL_REPORT,SEAL_SHA),'FINAL_SOURCES_CHANGED'); result={'purpose':PURPOSE,'prepared':True,'directory':str(OUT),'manifestSha256':sha(encoded_manifest),'artifactFileCount':1020,'transportFileCount':1022,'materialTreeSha256':tree_sha(transport),'transportTreeSha256':tree_sha(allrows),'sourceSha256':args.source_sha256,'sealReportSha256':SEAL_SHA,'programExecuted':False,'privateKeyRead':False,'approvalIncluded':False,'profileIncluded':False}; m.write_new(REPORT,encoded(result)); print(json.dumps(result))

if __name__=='__main__': main()
