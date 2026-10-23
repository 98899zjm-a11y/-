"""Guest-only daily-cache comparison; prepared, never scheduled automatically.

Usage AFTER Root admits an otherwise idle sealed Sandbox:
  python -I -B audit-tools/daily-cache-perf.py --execute-benchmark --run-name p2perf1
Only metrics/logs go to the mapped result folder. Toy DBs/archives/keys stay Guest-local.
"""
from pathlib import Path
import argparse, importlib.util, json, os, statistics, subprocess, sys, uuid
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute-benchmark', action='store_true')
    parser.add_argument('--run-name', default='')
    parser.add_argument('--pairs', type=int, choices=[1, 4], default=4)
    parser.add_argument('--ticks', type=int, choices=range(1, 11), default=3)
    args = parser.parse_args()
    if not args.execute_benchmark:
        print('Prepared only. Root must admit an idle sealed Guest before --execute-benchmark.')
        return 0
    if not args.run_name or len(args.run_name) > 48 or not args.run_name.replace('-', '').isalnum():
        raise RuntimeError('Explicit simple run name is required')
    spec = importlib.util.spec_from_file_location('daily_cache_actual_guest_context', ROOT/'stage1/sandbox-context.py')
    context = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(context)
    context.read_context(ROOT)  # Must reject Host before creating any benchmark file.
    output_root = Path('C:/xjy-results')
    if output_root.is_symlink() or os.path.isjunction(output_root):
        raise RuntimeError('Output boundary rejected')
    output = output_root/('daily-cache-perf-'+args.run_name)
    output.mkdir(exist_ok=False)
    node = str(ROOT/'stage1/tools/node.exe')
    script = str(ROOT/'audit-tools/daily-cache-perf.cjs')
    run = str(uuid.uuid4())
    report = {'version': 1, 'run': run, 'runName': args.run_name, 'pairs': args.pairs, 'steadyTicksPerWorker': args.ticks,
              'startedAt': datetime.now(timezone.utc).isoformat(), 'setups': [], 'samples': [],
              'executionState': 'running', 'diskCold': False, 'physicalDiskIOBytesMeasured': False,
              'timingScope': 'instrumented elapsed/CPU; observer overhead is included, not uninstrumented production speed'}

    def save():
        (output/'results.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')

    def call(label, command):
        try:
            proof = context.read_context(ROOT)  # Fresh actual metadata for EVERY child.
            env = os.environ.copy()
            env['XJY_DAILY_PERF_GUEST_CONTEXT'] = json.dumps(proof)
            print(json.dumps({'starting': label, 'at': datetime.now(timezone.utc).isoformat()}), flush=True)
            result = subprocess.run([node, script, *command], cwd=ROOT, env=env, capture_output=True, text=True, encoding='utf-8',
                                    creationflags=0x08000000)
            (output/(label+'.stdout.log')).write_text(result.stdout, encoding='utf-8')
            (output/(label+'.stderr.log')).write_text(result.stderr, encoding='utf-8')
            if result.returncode:
                report['exitCode'] = result.returncode
                raise RuntimeError('Guest benchmark worker failed; retain logs and exclude failed samples: '+label)
            row = json.loads(result.stdout)
            row['worker'] = label
            print(json.dumps({'finished': label, 'at': datetime.now(timezone.utc).isoformat()}), flush=True)
            return row
        except BaseException as error:
            report.update({'executionState': 'failed', 'failedWorker': label, 'failureType': type(error).__name__})
            (output/(label+'.orchestration-error.log')).write_text(type(error).__name__+': '+str(error)+'\n', encoding='utf-8')
            save()
            raise

    save()
    for mib in [1, 64]:
        report['setups'].append(call(f'setup-{mib}MiB', ['setup', run, str(mib)]))
        save()
        orders = [('baseline', 'current'), ('current', 'baseline'), ('current', 'baseline'), ('baseline', 'current')]
        for pair, order in enumerate(orders[:args.pairs]):
            for arm in order:
                sample = call(f'{mib}MiB-pair{pair+1}-{arm}', ['measure', run, str(mib), arm, str(args.ticks)])
                sample.update({'pair': pair+1, 'orderWithinPair': order.index(arm)+1})
                report['samples'].append(sample)
                save()
    summary = []
    for mib in [1, 64]:
        for arm in ['baseline', 'current']:
            workers = [row for row in report['samples'] if row['payloadMiB'] == mib and row['arm'] == arm]
            for phase in ['firstProcessTick', 'steadyTick']:
                rows = [row for worker in workers for row in worker['rows'] if row['phase'] == phase]
                elapsed = [row['elapsedMs'] for row in rows]
                cpu_ms = [(row['cpuMicroseconds']['user']+row['cpuMicroseconds']['system'])/1000 for row in rows]
                summary.append({'payloadMiB': mib, 'arm': arm, 'phase': phase, 'observations': len(rows),
                                'elapsedMs': {'median': statistics.median(elapsed), 'min': min(elapsed), 'max': max(elapsed)},
                                'cpuMs': {'median': statistics.median(cpu_ms), 'min': min(cpu_ms), 'max': max(cpu_ms)},
                                'probeCalls': sum(row['logicalNodeIO']['probe'] for row in rows),
                                'archiveLogicalReadBytes': sum(row['logicalNodeIO']['archiveReadBytes'] for row in rows),
                                'stagePayloadLogicalWriteBytes': sum(row['logicalNodeIO']['stagePayloadWriteBytes'] for row in rows),
                                'workerLifetimeMaxRSSKiB': max((row['maxRSSKiB'] for row in rows if row['maxRSSMeasured']), default=None)})
    report.update({'executionState': 'complete', 'endedAt': datetime.now(timezone.utc).isoformat(), 'summary': summary,
                   'summaryLimits': ['No p95 or significance claim from four paired workers.',
                                     'Steady ticks in a worker are correlated; all raw rows and worker identity retained.',
                                     'maxRSS is child lifetime including import/startup/first tick, not phase peak.',
                                     'Node API I/O excludes SQLite native I/O and does not measure physical disk I/O.',
                                     'Fixed toy schemas/attachments and quiescent toy fence do not measure production drain/pyc shutdown.',
                                     'One-pair runs are exploratory admission checks, not balanced performance conclusions.']})
    save()
    print(json.dumps({'complete': True, 'metrics': str(output/'results.json'), 'run': run}), flush=True)
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
