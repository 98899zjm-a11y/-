"""Fixed first financial RED batch; Root alone executes in the handed-back Guest.

No overlay application, arbitrary command, timeout, process termination, DB export,
installation or policy change. A nonzero test exit is retained without calling it
an assertion failure. Compiler failure blocks only its dependent algorithm group.
No timeout is approved: a stalled child is left running for Root to inspect.
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PYTHON = Path('C:/Python314/python.exe')
if (os.name != 'nt' or os.path.normcase(str(ROOT)) != os.path.normcase('C:/xjy-work/xjy-web-stage1') or
        os.path.normcase(sys.executable) != os.path.normcase(str(PYTHON)) or
        not sys.flags.isolated or not sys.flags.no_site or not sys.flags.dont_write_bytecode or sys.flags.optimize):
    raise RuntimeError('Fixed actual Guest Python314 -I -B -S required before any write or child')

import argparse
import contextlib
import hashlib
import json
import re
import stat
import subprocess
import types
from datetime import datetime, timezone

SELF = 'audit-tools/run-finance-erp170-red-a1.py'
NODE = ROOT / 'stage1/tools/node.exe'
DEPS = ROOT / 'audit-tools/dependencies/node_modules'
OUTPUT = Path('C:/xjy-results')
RUNTIMES = {str(PYTHON): '434b361fe0c5960d404974feed493db47f2603a1ace2574312104fbed0182c6f',
            str(NODE): 'ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32'}
GUARDS = {
    'stage1/sandbox-context.py': '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
    'stage1/validate-sandbox-context.py': '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207',
    'stage1/isolation.cjs': 'dd1eea05233607ca20bf19d931e4a5bd10dccd2cbe80ef4697685b6a4fdf759a',
    'stage1/guest-candidate-cdp.cjs': '59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32',
}
MATERIALS = (
    ('finance-strict170-source-a1', 52, 'f77e3eed65973bb4e0d22c7c96b3875bc97861df675f0fc58cbabfa0db4a1771'),
    ('finance-strict170-profile-dependencies-a1', 8, 'cfc23dadbc2d228d4576da510c48822ad33cbe7ed078fa7327424d0e6ce50123'),
)
TEST_PINS = {
    'audit-tools/finance-erp-170-accuracy.test.py': 'db13aeb68a8eb42beb0528be714aa3a319bfdd77e89df7fe9422a417e540cf7a',
    'audit-tools/finance-erp-170-algorithms.test.cjs': 'f7f12b7cf12f3e3b9c3f22ea358377f3e2c97c962de390fa26fcbfbf6e9a3432',
    'audit-tools/strict-170-restore.test.cjs': 'bd491f87afacdd7030a9c5627eb330f2313088e248772482d100205e36b9e0dd',
}


def stamp():
    return datetime.now(timezone.utc).isoformat()


def ordinary(file, directory=False):
    for item in (file, *file.parents):
        info = item.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
            raise RuntimeError('Ordinary non-reparse path required: ' + str(item))
        if stat.S_ISREG(info.st_mode) and info.st_nlink != 1:
            raise RuntimeError('Hardlinked file refused: ' + str(item))
        if not (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode)):
            raise RuntimeError('Ordinary file/directory required: ' + str(item))
    info = file.stat()
    if not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)):
        raise RuntimeError('Wrong path kind: ' + str(file))
    return info


def identity(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns, info.st_nlink)


def read(file, limit=4 * 1024 * 1024):
    before = ordinary(file)
    if not 0 < before.st_size <= limit:
        raise RuntimeError('Bounded nonempty file required: ' + str(file))
    with file.open('rb') as stream:
        opened = os.fstat(stream.fileno())
        # Windows ctime presentation may differ between path and handle APIs.
        if any(getattr(before, key) != getattr(opened, key) for key in ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_nlink')):
            raise RuntimeError('File changed before open: ' + str(file))
        body = stream.read(limit + 1)
        if len(body) != before.st_size or identity(os.fstat(stream.fileno())) != identity(opened):
            raise RuntimeError('File changed while read: ' + str(file))
    if identity(ordinary(file)) != identity(before):
        raise RuntimeError('File changed after read: ' + str(file))
    return body


def pinned(file, expected, size=None, limit=4 * 1024 * 1024):
    body = read(file, limit)
    if hashlib.sha256(body).hexdigest() != expected or size is not None and len(body) != size:
        raise RuntimeError('Exact source/runtime pin mismatch: ' + str(file))
    return body


def relative(value):
    if (not isinstance(value, str) or len(value) > 240 or
            not re.fullmatch(r'(?:project|audit-tools)/[A-Za-z0-9_./-]+', value) or
            any(part in ('', '.', '..') or part.endswith('.') for part in value.split('/'))):
        raise RuntimeError('Unsafe material source path')
    return value


def inventory():
    sources, manifests = {}, {}
    for name, count, expected in MATERIALS:
        package = Path('C:/xjy-input') / name
        file = package / 'manifest.json'
        body = pinned(file, expected, limit=128 * 1024)
        manifest = json.loads(body.decode('utf-8-sig'))
        if (set(manifest) != {'version', 'purpose', 'files'} or manifest['version'] != 1 or
                manifest['purpose'] != 'data-free isolated audit code and public compiler' or
                not isinstance(manifest['files'], list) or len(manifest['files']) != count):
            raise RuntimeError('Fixed source manifest schema/count changed')
        for item in manifest['files']:
            if (not isinstance(item, dict) or set(item) != {'path', 'size', 'sha256'} or
                    type(item['size']) is not int or not 0 < item['size'] <= 4 * 1024 * 1024 or
                    not isinstance(item['sha256'], str) or not re.fullmatch('[a-f0-9]{64}', item['sha256'])):
                raise RuntimeError('Invalid source manifest entry')
            key = relative(item['path'])
            if key in sources:
                raise RuntimeError('Duplicate material source: ' + key)
            pinned(package / key, item['sha256'], item['size'])
            pinned(ROOT / key, item['sha256'], item['size'])
            sources[key] = {'size': item['size'], 'sha256': item['sha256']}
        manifests[str(file)] = expected
    if len(sources) != 60 or any(sources.get(key, {}).get('sha256') != pin for key, pin in TEST_PINS.items()):
        raise RuntimeError('Exact 60 source files and 35 frozen methods required')
    return sources, manifests


def verify_fixed(self_pin, expected_namespace):
    pinned(ROOT / SELF, self_pin)
    if sys.version_info[:3] != (3, 14, 8):
        raise RuntimeError('Fixed Python 3.14.8 required')
    for file, pin in RUNTIMES.items():
        pinned(Path(file), pin, limit=256 * 1024 * 1024)
    for file, pin in GUARDS.items():
        pinned(ROOT / file, pin)
    identity_record = json.loads(read(ROOT / 'isolation-identity.json', 64 * 1024).decode('utf-8-sig'))
    if identity_record.get('namespace') != expected_namespace:
        raise RuntimeError('Actual handed-back namespace changed')
    ordinary(DEPS, directory=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--expected-namespace', required=True)
    parser.add_argument('--self-sha256', required=True)
    parser.add_argument('--run-id', required=True)
    args = parser.parse_args()
    if (not re.fullmatch('[a-f0-9]{64}', args.self_sha256) or
            not re.fullmatch(r'[A-Za-z0-9_.-]{8,160}', args.expected_namespace) or
            not re.fullmatch(r'finance-erp170-red-a1(?:-[a-z0-9][a-z0-9-]{0,31})?', args.run_id)):
        raise RuntimeError('Exact reviewed self SHA, actual namespace and bounded new run ID required')
    verify_fixed(args.self_sha256, args.expected_namespace)
    module = types.ModuleType('finance_erp170_actual_context')
    module.__file__ = str(ROOT / 'stage1/sandbox-context.py')
    exec(compile(pinned(Path(module.__file__), GUARDS['stage1/sandbox-context.py']), module.__file__, 'exec', dont_inherit=True, optimize=0), module.__dict__)
    proof = module.read_context(ROOT)  # Real original WMI/user/network/marker admission.
    verify_fixed(args.self_sha256, args.expected_namespace)
    output_identity = ordinary(OUTPUT, directory=True)
    out = OUTPUT / args.run_id
    out.mkdir(exist_ok=False)  # A prior result is never reused or overwritten.
    run_identity = ordinary(out, directory=True)

    def output_check():
        for file, original in ((OUTPUT, output_identity), (out, run_identity)):
            current = ordinary(file, directory=True)
            if (current.st_dev, current.st_ino) != (original.st_dev, original.st_ino):
                raise RuntimeError('Owned result directory identity changed')

    def create_json(name, value):
        output_check()
        with (out / name).open('xb') as stream:  # Windows CREATE_NEW / exclusive.
            stream.write((json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n').encode('utf-8'))
            stream.flush()
            os.fsync(stream.fileno())

    env = os.environ.copy()
    for name in ('NODE_OPTIONS', 'NODE_PATH', 'NODE_V8_COVERAGE', 'ESBUILD_BINARY_PATH'):
        env.pop(name, None)
    env.update({'XJY_HISTORY_GUEST': '1', 'XJY_HISTORY_DEPS': str(DEPS), 'XJY_DIRECTORY_DEPS': str(DEPS)})
    commands = [
        ('build-finance', [str(NODE), 'audit-tools/finance-guards-build.cjs', '--dependencies-root', str(DEPS)], 0),
        ('accuracy', [str(PYTHON), '-I', '-B', '-S', 'audit-tools/finance-erp-170-accuracy.test.py', '--test-sha256', TEST_PINS['audit-tools/finance-erp-170-accuracy.test.py'], '--expected-namespace', args.expected_namespace], 23),
        ('algorithms', [str(NODE), 'audit-tools/finance-erp-170-algorithms.test.cjs', '--expected-namespace', args.expected_namespace], 9),
        ('restore', [str(NODE), '--test', '--test-reporter=tap', 'audit-tools/strict-170-restore.test.cjs'], 3),
    ]
    result = {'purpose': 'fixed-finance-erp170-first-red-batch-a1', 'runId': args.run_id,
              'startedAt': stamp(), 'endedAt': None, 'namespace': args.expected_namespace, 'actualProof': proof,
              'selfSha256': args.self_sha256, 'runtimePins': RUNTIMES, 'guardPins': GUARDS, 'testPins': TEST_PINS,
              'sourcePins': {}, 'materialManifestPins': {}, 'preflightVerified': False, 'postflightVerified': False,
              'checks': [{'name': name, 'command': command, 'methods': methods, 'startedAt': None,
                          'endedAt': None, 'exitCode': None, 'status': 'not-started',
                          'stdout': name + '.stdout.bin', 'stderr': name + '.stderr.bin'}
                         for name, command, methods in commands],
              'allRequestedChecksPassed': False, 'timeoutPolicy': 'No timeout or termination is implemented; Root must inspect any stalled child.',
              'productionDataRead': False, 'databaseExported': False, 'overlayApplied': False,
              'actualUiVerified': False, 'fullWorkflowAcceptance': False, 'errors': []}
    try:
        with contextlib.ExitStack() as stack:
            logs = {}
            for name, command, methods in commands:
                output_check()
                logs[name] = (stack.enter_context((out / (name + '.stdout.bin')).open('xb')),
                              stack.enter_context((out / (name + '.stderr.bin')).open('xb')))
            sources, manifests = inventory()
            result.update(sourcePins=sources, materialManifestPins=manifests, preflightVerified=True)
            create_json('plan.json', result)
            build_ok = False
            for step in result['checks']:
                if step['name'] == 'algorithms' and not build_ok:
                    step['status'] = 'blocked-by-compiler-failure'
                    continue
                verify_fixed(args.self_sha256, args.expected_namespace)
                step['actualProof'] = module.read_context(ROOT)
                verify_fixed(args.self_sha256, args.expected_namespace)
                if inventory() != (sources, manifests):
                    raise RuntimeError('Frozen source/material inventory changed between groups')
                output_check()
                child_env = env.copy()
                if step['name'] == 'restore':
                    child_env['XJY_STRICT_170_TEST_SHA256'] = TEST_PINS['audit-tools/strict-170-restore.test.cjs']
                step.update(startedAt=stamp(), status='running')
                create_json(step['name'] + '.started.json', {**step, 'namespace': args.expected_namespace})
                # Deliberately no timeout, kill, terminate, shell or free-form command.
                child = subprocess.Popen(step['command'], cwd=str(ROOT), env=child_env, stdin=subprocess.DEVNULL,
                                         stdout=logs[step['name']][0], stderr=logs[step['name']][1],
                                         shell=False, close_fds=True, creationflags=0x08000000)
                step['exitCode'] = child.wait()
                step.update(endedAt=stamp(), status='exit-zero' if step['exitCode'] == 0 else 'exit-nonzero-unclassified')
                for stream in logs[step['name']]:
                    stream.flush()
                    os.fsync(stream.fileno())
                create_json(step['name'] + '.result.json', step)
                if step['name'] == 'build-finance':
                    build_ok = step['exitCode'] == 0
    except Exception as error:
        result['errors'].append({'phase': 'admission-or-execution', 'type': type(error).__name__, 'message': str(error)})
        for step in result['checks']:
            if step['status'] == 'not-started':
                step['status'] = 'blocked-by-precondition'
            elif step['status'] == 'running':
                step.update(endedAt=stamp(), status='launch-or-wait-error')
    finally:
        try:
            verify_fixed(args.self_sha256, args.expected_namespace)
            result['postflightActualProof'] = module.read_context(ROOT)
            verify_fixed(args.self_sha256, args.expected_namespace)
            after_sources, after_manifests = inventory()
            if not result['preflightVerified'] or (after_sources, after_manifests) != (result['sourcePins'], result['materialManifestPins']):
                raise RuntimeError('Before/after exact 60 sources were not both verified')
            result['postflightVerified'] = True
            result['postflightSourcePins'] = after_sources
        except Exception as error:
            result['errors'].append({'phase': 'postflight', 'type': type(error).__name__, 'message': str(error)})
        result['endedAt'] = stamp()
        result['allRequestedChecksPassed'] = (result['preflightVerified'] and result['postflightVerified'] and not result['errors'] and
                                              len(result['checks']) == 4 and all(step['exitCode'] == 0 for step in result['checks']))
        create_json('results.json', result)
    print(json.dumps({'results': str(out / 'results.json'), 'allRequestedChecksPassed': result['allRequestedChecksPassed'],
                      'preflightVerified': result['preflightVerified'], 'postflightVerified': result['postflightVerified'],
                      'checks': [{'name': step['name'], 'status': step['status'], 'exitCode': step['exitCode']} for step in result['checks']]}, ensure_ascii=False), flush=True)
    return 0 if result['allRequestedChecksPassed'] else 2 if result['errors'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
