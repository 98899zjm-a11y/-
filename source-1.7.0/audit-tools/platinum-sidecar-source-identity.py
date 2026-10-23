"""Guest-only original sidecar and presentation identities; data, never payload exec.

The release builder copies sidecar_release.py to sidecar.py. Its fixed original
CArchive member is therefore type 's', name 'sidecar'; this probe never searches
arbitrary members for a convenient match. Root runs before changing that source.
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PYTHON = Path('C:/Python314/python.exe')
if (os.name != 'nt' or os.path.normcase(str(ROOT)) != os.path.normcase('C:/xjy-work/xjy-web-stage1') or
        os.path.normcase(sys.executable) != os.path.normcase(str(PYTHON)) or
        not sys.flags.isolated or not sys.flags.no_site or not sys.flags.dont_write_bytecode or sys.flags.optimize):
    raise RuntimeError('Fixed actual Guest Python -I -B -S required; no Host execution')

import argparse
import hashlib
import importlib.util
import json
import re
import stat
import types

SELF = ROOT/'audit-tools/platinum-sidecar-source-identity.py'
REPACKER = ROOT/'audit-tools/finance-repack.py'
REPACKER_SHA = 'd630f373911715b3ef5ee80e6fbaeaae838c1469ab53f44759813bc066cf69a7'
SOURCE = ROOT/'project/desktop/legacy-source/sidecar_release.py'
SOURCE_SHA = '3fb61be8039ce507fd862643047cb62260ae53eda0d220bec4b434306cdfec81'
PRESENTATION = ROOT/'project/desktop/legacy-source/ledger/presentation.py'
PRESENTATION_SHA = '07eedd042e8eb76ac720e9eb2b7375b73c5122b0865e13d80abd96bd2d4b070d'
ENTRY_NAME = 'sidecar'


def initial_pin(file, pin):
    if not file.is_relative_to(ROOT): raise RuntimeError('Fixed owned bootstrap input required')
    for item in (file, *file.parents):
        info = item.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info,'st_file_attributes',0)&0x400:
            raise RuntimeError('Bootstrap linked input refused')
        if stat.S_ISREG(info.st_mode) and info.st_nlink != 1:
            raise RuntimeError('Bootstrap hardlinked input refused')
    if not file.is_file() or file.stat().st_size > 1024*1024:
        raise RuntimeError('Bounded bootstrap source required')
    body = file.read_bytes()
    if hashlib.sha256(body).hexdigest() != pin: raise RuntimeError('Bootstrap source pin mismatch')


def compare(m, body, code):
    m.require(type(code) is types.CodeType and len(m.FIELDS)==18,'ONE_CODE_OBJECT_AND_18_FIELDS_REQUIRED')
    original_tree = m.code_tree(code); comparisons = []
    for optimize in (0,1,2):
        compiled = compile(body,code.co_filename,'exec',dont_inherit=True,optimize=optimize)
        comparisons.append({'optimize':optimize,'dontInherit':True,'coFilename':compiled.co_filename,
                            'compiledStructureSha256':m.fingerprint(compiled),
                            'all18FieldsRecursivelyEqual':m.code_tree(compiled)==original_tree})
    return {'coFilename':code.co_filename,'coName':code.co_name,'structureSha256':m.fingerprint(code),
            'comparisons':comparisons,'matchedOptimizationLevels':[x['optimize'] for x in comparisons if x['all18FieldsRecursivelyEqual']]}


def main():
    parser = argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    parser.add_argument('--probe-sha256',required=True)
    parser.add_argument('--run-id',required=True)
    args = parser.parse_args()
    if not re.fullmatch('[0-9a-f]{64}',args.probe_sha256): raise RuntimeError('Root probe SHA required')
    if not re.fullmatch('platinum-sidecar-identity-[a-z0-9][a-z0-9-]{0,39}',args.run_id):
        raise RuntimeError('Bounded new identity run name required')
    initial_pin(SELF,args.probe_sha256); initial_pin(REPACKER,REPACKER_SHA)
    spec = importlib.util.spec_from_file_location('platinum_fixed_data_repacker',REPACKER)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    admission = m.admit(REPACKER_SHA)
    m.pinned(SELF,args.probe_sha256)
    source = m.pinned(SOURCE,SOURCE_SHA)
    presentation_source = m.pinned(PRESENTATION,PRESENTATION_SHA)
    original_inputs = m.manifest_inputs()
    original = m.pinned(m.ORIGINAL/'xjy-ledger/xjy-ledger.exe',m.PINS['exe'])
    run = ROOT/'runtime'/args.run_id
    m.require(not run.exists(),'FRESH_IDENTITY_RUN_REQUIRED'); m.mkdir_new(run)
    result = {'purpose':'platinum-original-sidecar-and-presentation-source-identity','runId':args.run_id,'passed':False,
              'actualContext':admission,'probeSha256':args.probe_sha256,'repackerSha256':REPACKER_SHA,
              'originalManifestSha256':m.PINS['manifest'],'originalExeSha256':m.sha(original),
              'source':str(SOURCE),'sourceSha256':SOURCE_SHA,'sourceBytes':len(source),
              'expectedCArchiveName':ENTRY_NAME,'expectedCArchiveType':'s',
              'presentationSource':str(PRESENTATION),'presentationSourceSha256':PRESENTATION_SHA,
              'identitySubjectCount':2,'pythonVersion':sys.version,
              'codeFields':list(m.FIELDS),'optimizationCandidates':[0,1,2],
              'archivePayloadExecuted':False,'businessImported':False,'writerLoaded':False,
              'databaseOpened':False,'productionDataRead':False,'formalReleaseAuthorized':False}
    try:
        archive = m.archive(original)
        result['carchiveEntries'] = [{'name':row['name'],'type':row['type'],'flag':row['flag'],
                                     'payloadBytes':len(row['payload']),'payloadSha256':m.sha(row['payload'])}
                                    for row in archive['rows']]
        matches = [row for row in archive['rows'] if row['name']==ENTRY_NAME and row['type']=='s']
        m.require(len(matches)==1,'EXACT_ORIGINAL_SIDECAR_SCRIPT_REQUIRED')
        row = matches[0]; code = m.load_marshaled(row['payload'],allow_code=True)
        result['entry'] = {'name':row['name'],'type':row['type'],'flag':row['flag'],
                           'payloadSha256':m.sha(row['payload']),**compare(m,source,code)}
        # The unchanged reader validates the fixed PYZ layout as data. Only
        # presentation is selected for source identity; no other source compiles.
        pyz_rows = m.pyz(archive['pyz'])
        presentations = [item for item in pyz_rows if item['name']=='presentation' and item['type']==0]
        m.require(len(presentations)==1,'EXACT_ORIGINAL_PRESENTATION_MODULE_REQUIRED')
        result['presentation'] = {'name':'presentation','type':0,'sourceBytes':len(presentation_source),
                                  **compare(m,presentation_source,presentations[0]['code'])}
        result['originalPyzMemberCount']=len(pyz_rows)
        m.require(m.manifest_inputs()==original_inputs,'ORIGINAL_496_INPUTS_CHANGED')
        m.pinned(SOURCE,SOURCE_SHA); m.pinned(PRESENTATION,PRESENTATION_SHA)
        m.pinned(REPACKER,REPACKER_SHA); m.pinned(SELF,args.probe_sha256)
        m.require(m.pinned(m.ORIGINAL/'xjy-ledger/xjy-ledger.exe',m.PINS['exe'])==original,'ORIGINAL_EXE_CHANGED')
        result['originalInputsUnchanged'] = True
        result['passed'] = bool(result['entry']['matchedOptimizationLevels']) and bool(result['presentation']['matchedOptimizationLevels'])
        if not result['passed']: result['error']='At least one fixed original source does not match its pinned payload at opt0/1/2'
    except Exception as error:
        result['errorType']=type(error).__name__; result['error']=str(error)
    finally:
        m.write_json(run/'result.json',result,run)
    print(json.dumps({'purpose':result['purpose'],'passed':result['passed'],'output':str(run/'result.json'),
                      'sha256':m.sha(m.stable(run/'result.json')),'entry':result.get('entry'),
                      'presentation':result.get('presentation')}))
    return 0 if result['passed'] else 1


if __name__=='__main__':
    try: raise SystemExit(main())
    except Exception as error:
        print(json.dumps({'passed':False,'errorType':type(error).__name__,'error':str(error)})); raise SystemExit(1)
