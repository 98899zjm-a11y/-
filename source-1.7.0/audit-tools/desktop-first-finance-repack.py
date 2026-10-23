"""Root-only actual-Guest adapter of the frozen d630/platinum repack workflow.

Fixed 162 base, three known PYZ sources, one sidecar main, two templates.
No business/EXE execution, DB, PyInstaller imports/hooks, global helper patches,
new dependencies, signing, release publication or input overwrite.
Official writer definitions retain GPL-2.0-or-later WITH Bootloader-exception;
complete COPYING and the original source notices are retained in the output.
"""
import os, sys
from pathlib import Path
ROOT=Path('C:/xjy-work/xjy-web-stage1')
INPUT=Path('C:/xjy-input/desktop-first-finance-input-a1')
SELF=INPUT/'audit-tools/desktop-first-finance-repack.py'
if (os.name!='nt' or os.path.normcase(os.path.abspath(__file__))!=os.path.normcase(str(SELF)) or
    os.path.normcase(sys.executable)!=os.path.normcase('C:/Python314/python.exe') or
    not sys.flags.isolated or not sys.flags.no_site or not sys.flags.dont_write_bytecode or sys.flags.optimize):
    raise RuntimeError('Fixed mapped tool and actual Guest Python -I -B -S required')
import argparse, hashlib, importlib.util, json, re, stat, struct, types
HELPER=ROOT/'audit-tools/finance-repack.py'
HELPER_SHA='d630f373911715b3ef5ee80e6fbaeaae838c1469ab53f44759813bc066cf69a7'
BASE=INPUT/'base-modules'
BASE_MANIFEST_SHA='a32e4fd6ffa7da5842b5e5364396736c6b80d4775d3b5ebd10a9d78465418d16'
BASE_EXE_SHA='58a654849f11bc7e8bdd12e1b48a24f4cef0b6cacef89be307c95d238e557945'
MODULES={'inventory':('xjy-inventory',143,30045212),'ledger':('xjy-ledger',353,41692353)}
SOURCES={
 'finance':('sources/ledger/finance.py','71eefa6b6b5779298c1d688298c1ca9432e28c069172046513b709750bcf0926'),
 'inventory_dashboard':('sources/ledger/inventory_dashboard.py','c0fb94c47410b3520e9326f722ba791d51a98e26a75576e568cb7e958ecda35d'),
 'reports':('sources/ledger/reports.py','6d43ddcb140cda914e8519733405b09a14673985e4370806d4ecdf7c86cf3287'),
 'sidecar':('sources/sidecar_release.py','0903a8335b656991cbe2f4028f1a4740b2f7915c4a40e5d13dfc41f76d803784')}
TEMPLATES={
 '_internal/app/templates/home.html':('sources/ledger/app/templates/home.html','035c088eb26e943aab31414c8eb0f4b52265874ac1883df6d402457c108d50ad'),
 '_internal/app/templates/stock.html':('sources/ledger/app/templates/stock.html','7a3c4b65ae4a05d4b7de7610c1ccddd970483b08639e059fcd63515f2a1b7447')}


def bootstrap(file,pin):
    for p in (file,*file.parents):
        s=p.lstat()
        if stat.S_ISLNK(s.st_mode) or getattr(s,'st_file_attributes',0)&0x400 or stat.S_ISREG(s.st_mode) and s.st_nlink!=1:
            raise RuntimeError('Linked bootstrap input refused')
    if not file.is_file() or not 0<file.stat().st_size<=1024*1024 or hashlib.sha256(file.read_bytes()).hexdigest()!=pin:
        raise RuntimeError('Root-pinned bootstrap input required')


def tree(m,base,boundary):
    m.ordinary(base,boundary); rows={}; directories=set()
    for item in base.rglob('*'):
        m.ordinary(item,boundary)
        name=m.relative(item.relative_to(base).as_posix())
        if item.is_file():
            body=m.stable(item,boundary);rows[name]=(len(body),m.sha(body))
        else:
            m.require(item.is_dir(),'UNEXPECTED_INPUT_NODE');directories.add(name)
    implied=set()
    for name in rows:
        implied.update(p.as_posix() for p in Path(name).parents if p.as_posix()!='.')
    m.require(directories==implied,'EXTRA_OR_EMPTY_INPUT_DIRECTORY')
    return rows


def namespace(m,expected):
    actual=m.admit(HELPER_SHA)
    identity=json.loads(m.stable(ROOT/'isolation-identity.json'),object_pairs_hook=m.unique_object)
    m.require(identity.get('namespace')==expected,'ACTUAL_NAMESPACE_CHANGED')
    return actual


def inputs(m,args):
    body=m.pinned(INPUT/'input-manifest.json',args.input_manifest_sha256,INPUT)
    manifest=json.loads(body,object_pairs_hook=m.unique_object)
    m.require(manifest.get('purpose')=='desktop-first-finance-fixed-inputs' and manifest.get('productionDataIncluded') is False,
              'FIXED_DATA_FREE_INPUT_MANIFEST_REQUIRED')
    expected={}
    for row in manifest['files']:
        name=m.relative(row['path'])
        m.require(set(row)=={'path','size','sha256'} and name.casefold() not in {x.casefold() for x in expected} and
                  type(row['size']) is int and row['size']>=0 and re.fullmatch('[a-f0-9]{64}',row['sha256']), 'INPUT_RECORD_REFUSED')
        expected[name]=(row['size'],row['sha256'])
    actual=tree(m,INPUT,INPUT);actual.pop('input-manifest.json',None)
    m.require(actual==expected,'FULL_MAPPED_INPUT_TREE_CHANGED')
    baseline=json.loads(m.pinned(BASE/'manifest.json',BASE_MANIFEST_SHA,INPUT),object_pairs_hook=m.unique_object)
    m.require(baseline.get('version')==1 and len(baseline['modules'])==2,'EXACT_BASE_TWO_MODULES_REQUIRED')
    rows={}
    for module in baseline['modules']:
        name=module['id'];m.require(name in MODULES and name not in rows,'BASE_MODULE_ID')
        directory,count,total=MODULES[name]
        m.require(module['runtimeMode']=='onedir' and module['purpose']=='desktop-release' and
                  module['version']==('1.3.0' if name=='ledger' else '1.9.0') and module['file']==directory+'.exe','BASE_MODULE_METADATA')
        records={m.relative(x['path']):(x['size'],x['sha256']) for x in module['files']}
        m.require(len(records)==len(module['files'])==count and sum(x[0] for x in records.values())==total and
                  records[module['file']]==(module['size'],module['sha256']) and tree(m,BASE/directory,INPUT)==records,'BASE_COMPLETE_TREE_MISMATCH')
        rows[name]=records
    original=m.pinned(BASE/'xjy-ledger/xjy-ledger.exe',BASE_EXE_SHA,INPUT)
    source={name:m.pinned(INPUT/path,pin,INPUT) for name,(path,pin) in SOURCES.items()}
    templates={name:m.pinned(INPUT/path,pin,INPUT) for name,(path,pin) in TEMPLATES.items()}
    return body,baseline,rows,original,source,templates


def verify_pyz(m,before,after,replacements):
    m.require([(r['name'],r['type']) for r in before]==[(r['name'],r['type']) for r in after],'ORDERED_PYZ_METADATA_CHANGED')
    preserved=[];known=[];namespaces=0
    for left,right in zip(before,after):
        name=left['name']
        if left['type']==3:
            m.require(left['code'] is None and right['code'] is None,'NAMESPACE_CHANGED');namespaces+=1
        else:
            m.assert_same_code(replacements.get(name,left['code']),right['code'])
            record={'name':name,'type':left['type'],'oldStructureSha256':m.fingerprint(left['code']),
                    'newStructureSha256':m.fingerprint(right['code'])}
            (known if name in replacements else preserved).append(record)
    m.require(len(before)==933 and len(preserved)==924 and namespaces==6 and len(known)==3,'ALL_933_PYZ_MEMBERS_REQUIRED')
    return {'pyzEntries':933,'preservedCodeObjects':preserved,'preservedNamespaces':6,'knownPyz':known,'codeFields':list(m.FIELDS)}


def verify_exe(m,original,candidate,replacements,main_code):
    m.require(m.sha(original)==BASE_EXE_SHA,'FIXED_BASE_EXE_REQUIRED')
    before,after=m.archive(original),m.archive(candidate)
    m.require(before['prefix'][:352]+before['prefix'][356:]==after['prefix'][:352]+after['prefix'][356:] and
              after['pe']['checksum']==m.checksum(candidate),'PE_PREFIX_OR_CHECKSUM_CHANGED')
    m.require(before['version']==after['version'] and before['library']==after['library'],'COOKIE_IDENTITY_CHANGED')
    meta=lambda r:(r['name'],r['type'],r['flag'])
    m.require([meta(r) for r in before['rows']]==[meta(r) for r in after['rows']],'ORDERED_CARCHIVE_METADATA_CHANGED')
    retained=[];mains=0
    for left,right in zip(before['rows'],after['rows']):
        if left['name']=='sidecar' and left['type']=='s':
            m.assert_same_code(main_code,m.load_marshaled(right['payload'],True));mains+=1
        elif left['type']!='z':
            m.require(left['payload']==right['payload'],'UNSELECTED_CARCHIVE_PAYLOAD_CHANGED:'+left['name'])
            retained.append({'name':left['name'],'type':left['type'],'payloadSha256':m.sha(left['payload'])})
    m.require(mains==1,'EXACT_ONE_SIDECAR_MAIN_REQUIRED')
    proof=verify_pyz(m,m.pyz(before['pyz']),m.pyz(after['pyz']),replacements)
    proof.update(originalExeSha256=BASE_EXE_SHA,candidateExeSha256=m.sha(candidate),candidateSize=len(candidate),
                 retainedCarchivePayloads=retained,mainStructureSha256=m.fingerprint(main_code),prefixExceptChecksumIdentical=True)
    return proof


def build(m,args):
    admission=namespace(m,args.expected_namespace)
    frozen=inputs(m,args);manifest_body,baseline,records,original,source,templates=frozen
    archive=m.archive(original);rows=m.pyz(archive['pyz']);replacements={}
    for name in ('finance','inventory_dashboard','reports'):
        found=[r for r in rows if r['name']==name and r['type']==0]
        m.require(len(found)==1,'FIXED_KNOWN_MODULE_REQUIRED:'+name)
        replacements[name]=compile(source[name],found[0]['code'].co_filename,'exec',dont_inherit=True,optimize=0)
    mains=[r for r in archive['rows'] if r['name']=='sidecar' and r['type']=='s']
    m.require(len(mains)==1,'EXACT_BASE_SIDECAR_MAIN_REQUIRED')
    old_main=m.load_marshaled(mains[0]['payload'],True)
    m.require(old_main.co_filename=='sidecar.py','FIXED_MAIN_FILENAME_REQUIRED')
    main_code=compile(source['sidecar'],old_main.co_filename,'exec',dont_inherit=True,optimize=0)
    writers,payload_writer,writer_evidence,bodies=m.load_writers()
    run=ROOT/'release-work'/args.run_id
    m.require(not run.exists() and not run.is_symlink() and not os.path.isjunction(run),'CREATE_NEW_RUN_REQUIRED')
    m.mkdir_new(run)
    m.write_json(run/'.owner.json',{'purpose':'desktop-first-finance-repack','namespace':args.expected_namespace,'toolSha256':args.tool_sha256},run)
    try:
        m.write_new(run/'PyInstaller-COPYING.txt',bodies['COPYING.txt'],run)
        notices=['PyInstaller 6.22.3 commit '+m.UPSTREAM_COMMIT,'Reuse d630 complete AST definitions; no Analysis/hooks/whole-module import.']
        for name in ('PyInstaller/archive/writers.py','PyInstaller/building/utils.py'):
            notices.extend(['',name,*bodies[name].decode('utf-8').splitlines()[:10]])
        m.write_new(run/'PyInstaller-source-notice.txt',('\n'.join(notices)+'\n').encode(),run)
        entries=[];code_dict={}
        for row in rows:
            name,kind=row['name'],row['type'];entries.append((name,None if kind==3 else '__init__.py' if kind==1 else 'module.py','PYMODULE'))
            if kind!=3:code_dict[name]=replacements.get(name,row['code'])
        m.writer_new(writers,run/'candidate.pyz',run,entries,code_dict)
        pyz=m.stable(run/'candidate.pyz');verify_pyz(m,rows,m.pyz(pyz),replacements)
        payloads=[(r['name'],pyz if r['type']=='z' else m.marshal.dumps(main_code) if r['name']=='sidecar' and r['type']=='s' else r['payload'],r['flag'],r['type']) for r in archive['rows']]
        m.writer_new(payload_writer,run/'candidate.pkg',run,payloads,'python314.dll')
        candidate=bytearray(archive['prefix']+m.stable(run/'candidate.pkg'))
        m.require(len(candidate)<=m.MAX_FILE,'CANDIDATE_SIZE_LIMIT');struct.pack_into('<I',candidate,352,m.checksum(candidate));candidate=bytes(candidate)
        proof=verify_exe(m,original,candidate,replacements,main_code)
        modules=run/'modules-input';m.mkdir_new(modules);expected={};changed=[]
        for module_id,(directory,count,total) in MODULES.items():
            expected[module_id]={}
            for name,(size,digest) in records[module_id].items():
                old=m.pinned(BASE/directory/name,digest,INPUT);m.require(len(old)==size,'COPY_SIZE_CHANGED')
                body=candidate if module_id=='ledger' and name=='xjy-ledger.exe' else templates.get(name,old) if module_id=='ledger' else old
                m.write_new(modules/directory/name,body,run);expected[module_id][name]=(len(body),m.sha(body))
                if body!=old:changed.append({'module':module_id,'path':name,'oldSha256':digest,'newSha256':m.sha(body)})
            m.require(tree(m,modules/directory,ROOT)==expected[module_id],'COPIED_MODULE_TREE_CHANGED')
        m.require({(r['module'],r['path']) for r in changed}=={('ledger','xjy-ledger.exe'),*[('ledger',name) for name in TEMPLATES]},'ONLY_EXE_AND_TWO_TEMPLATES_MAY_CHANGE')
        output_manifest=json.loads(m.pinned(BASE/'manifest.json',BASE_MANIFEST_SHA,INPUT),object_pairs_hook=m.unique_object)
        for module in output_manifest['modules']:
            actual=expected[module['id']]
            for row in module['files']:row['size'],row['sha256']=actual[row['path']]
            module['size'],module['sha256']=actual[module['file']]
        m.write_json(modules/'manifest.json',output_manifest,run)
        expected_flat={'manifest.json':(len(m.stable(modules/'manifest.json')),m.sha(m.stable(modules/'manifest.json')))}
        for module_id,(directory,count,total) in MODULES.items():expected_flat.update({directory+'/'+name:pair for name,pair in expected[module_id].items()})
        m.require(tree(m,modules,ROOT)==expected_flat,'FINAL_COMPLETE_OUTPUT_TREE_CHANGED')
        m.require(verify_exe(m,original,m.stable(modules/'xjy-ledger/xjy-ledger.exe'),replacements,main_code)==proof,'REOPENED_EXE_PROOF_CHANGED')
        # Re-evaluate all fixed inputs, including the baseline manifest and public programs.
        m.require(inputs(m,args)==frozen,'FIXED_INPUTS_CHANGED_DURING_BUILD')
        m.require(m.writer_sources()==bodies,'OFFICIAL_WRITERS_CHANGED')
        namespace(m,args.expected_namespace);m.pinned(SELF,args.tool_sha256,INPUT);m.pinned(HELPER,HELPER_SHA)
        proof.update(sourcePins=SOURCES,templatePins=TEMPLATES,changedProgramFiles=changed,programFiles=496,
                     unselectedProgramFilesByteIdentical=493,archivePayloadExecuted=False,businessModulesImported=False)
        m.write_json(run/'candidate-proof.json',proof,run)
        result={'passed':True,'purpose':'desktop-first-finance-repack','namespace':args.expected_namespace,'actualContext':admission,
                'toolSha256':args.tool_sha256,'inputManifestSha256':args.input_manifest_sha256,'helperSha256':HELPER_SHA,
                'modulesInput':str(modules),'manifestSha256':m.sha(m.stable(modules/'manifest.json')),
                'proofSha256':m.sha(m.stable(run/'candidate-proof.json')),'changedProgramFiles':changed,'writerEvidence':writer_evidence,
                'originalInputsUnchanged':True,'businessExecuted':False,'httpVerified':False,'executableLaunched':False,
                'productionDataAccessed':False,'releaseReady':False,'sourceVersion':'1.6.2'}
        m.write_json(run/'result.json',result,run);return result
    except Exception as error:
        m.write_json(run/'failure.json',{'passed':False,'errorType':type(error).__name__,'error':str(error),'failedOutputRetained':True},run)
        raise


def main():
    p=argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    for name in ('tool-sha256','input-manifest-sha256','expected-namespace','run-id'):p.add_argument('--'+name,required=True)
    args=p.parse_args()
    if not all(re.fullmatch('[a-f0-9]{64}',value) for value in (args.tool_sha256,args.input_manifest_sha256)) or not re.fullmatch(r'[a-f0-9-]{36}',args.expected_namespace) or not re.fullmatch(r'desktop-first-finance-repack-[a-z0-9][a-z0-9-]{0,35}',args.run_id):
        raise RuntimeError('Exact reviewed SHA, namespace and fresh bounded run ID required')
    bootstrap(SELF,args.tool_sha256);bootstrap(HELPER,HELPER_SHA)
    spec=importlib.util.spec_from_file_location('desktop_first_frozen_repacker',HELPER)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    result=build(m,args);print(json.dumps(result));return 0


if __name__=='__main__':
    try:raise SystemExit(main())
    except Exception as error:
        print(json.dumps({'passed':False,'errorType':type(error).__name__,'error':str(error),'releaseReady':False}));raise SystemExit(1)
