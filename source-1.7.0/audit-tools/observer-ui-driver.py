"""SOURCE_ONLY controller pure DI functions; no OS/driver/native entry exists.

Root must separately review any future actual lifecycle/ready/EOF integration.
These functions do not launch, observe, wait, close or control a process.
"""


def admit_gated_root(observer, role, capture_root, send_gate):
    receipt = observer.register_root(role=role, capture_root=capture_root)
    if (not isinstance(receipt, dict) or set(receipt) != {'role', 'pid', 'creationFileTime', 'sequence'} or
            receipt['role'] != role or type(receipt['pid']) is not int or not 1 <= receipt['pid'] <= 0xffffffff or
            not isinstance(receipt['creationFileTime'], str) or not receipt['creationFileTime'] or
            type(receipt['sequence']) is not int or receipt['sequence'] < 1):
        raise RuntimeError('REGISTERED_ROOT_RECEIPT_REQUIRED_BEFORE_GATE')
    send_gate(b'RUN\n')
    return receipt


def collect_probe_fact(read_exit):
    try:
        code = read_exit()
    except BaseException as caught:
        return {'probeExitCode': None, 'probeExitObservation': 'read-error', 'probeExitError': type(caught).__name__}
    if code is None:
        return {'probeExitCode': None, 'probeExitObservation': 'still-running'}
    if type(code) is not int:
        raise RuntimeError('CAPTURED_INTEGER_EXIT_OR_UNKNOWN_REQUIRED')
    return {'probeExitCode': code, 'probeExitObservation': 'captured-exit'}
