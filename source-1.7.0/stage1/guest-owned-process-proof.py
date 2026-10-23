"""Pure, conservative ownership proof for repeated Windows CIM snapshots.

``update_owned(known, rows)`` returns ``(expanded_known, alive_owned)``.
The first known identity is the already pinned root; following identities must
have a proved parent chain to it. Keep the returned known history across every
closing snapshot, even after a parent exits. An absent parent is still a useful
historical anchor, while an observed reuse of its PID makes ownership ambiguous
and raises RuntimeError. This module never reads, launches or stops a process.

CreationUtc must be the canonical UTC ``CreationDate.ToUniversalTime().ToString
('o')`` value emitted by the driver: seven fractional digits followed by Z.
Lexical comparisons preserve Windows' 100 ns precision without rounding ticks.
"""
import copy
from datetime import datetime
import re

_CREATION = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z$')


def _pid(value, *, zero=False):
    if type(value) is not int or value < (0 if zero else 1) or value > 0xffffffff:
        raise RuntimeError('Ambiguous process identity: malformed PID')
    return value


def _creation(value):
    if not isinstance(value, str) or not _CREATION.fullmatch(value):
        raise RuntimeError('Ambiguous process creation identity: canonical UTC ticks required')
    try:
        # Validate the calendar fields; comparisons below retain all seven ticks.
        datetime.strptime(value[:19], '%Y-%m-%dT%H:%M:%S')
    except ValueError as error:
        raise RuntimeError('Ambiguous process creation identity: invalid UTC date') from error
    return value


def _rows_by_pid(rows, *, history):
    if not isinstance(rows, list) or history and not rows:
        raise RuntimeError('Pinned nonempty process ownership history and snapshot list required')
    result = {}
    for row in rows:
        if not isinstance(row, dict):
            raise RuntimeError('Ambiguous process identity: malformed snapshot row')
        pid = _pid(row.get('ProcessId'), zero=not history)
        parent = _pid(row.get('ParentProcessId'), zero=True)
        if pid == 0:
            if parent != 0:
                raise RuntimeError('Ambiguous process identity: impossible idle PID row')
        elif parent == pid:
            raise RuntimeError('Ambiguous process identity: self-parented process')
        if pid in result:
            raise RuntimeError('Ambiguous duplicate process PID in snapshot/history')
        if history:
            _creation(row.get('CreationUtc'))
        result[pid] = copy.deepcopy(row)
    return result


def update_owned(known, rows):
    """Expand pinned ownership; return copied history/alive rows or refuse ambiguity.

    Snapshot rows unrelated by parent chain are ignored even if their executable
    or name matches. Missing/older child creation, altered known parent identity,
    duplicate PIDs and observed PID reuse are never treated as clean shutdown.
    No decision to terminate a process is made here.
    """
    owned = _rows_by_pid(known, history=True)
    current = _rows_by_pid(rows, history=False)
    root = known[0]['ProcessId']

    # Prove every caller-supplied descendant, without depending on list order.
    connected = {root}
    while len(connected) < len(owned):
        added = []
        for pid, row in owned.items():
            parent = row['ParentProcessId']
            if pid not in connected and parent in connected:
                if row['CreationUtc'] < owned[parent]['CreationUtc']:
                    raise RuntimeError('Ambiguous child creation older than pinned parent identity')
                added.append(pid)
        if not added:
            raise RuntimeError('Ambiguous disconnected or cyclic known parent ownership chain')
        connected.update(added)

    # A reused PID is not a valid historical parent for any new orphan. Refuse
    # the whole snapshot rather than attribute descendants to the new process.
    for pid, identity in owned.items():
        observed = current.get(pid)
        if observed is None:
            continue
        if _creation(observed.get('CreationUtc')) != identity['CreationUtc']:
            raise RuntimeError('Ambiguous process identity: observed owned PID reuse')
        if observed['ParentProcessId'] != identity['ParentProcessId']:
            raise RuntimeError('Ambiguous process identity: known parent changed')

    # Keep disappeared parents as anchors. Multiple passes admit a new child
    # and its descendants even when the snapshot lists grandchildren first.
    while True:
        added = []
        for pid, row in current.items():
            parent = row['ParentProcessId']
            if pid in owned or parent not in owned:
                continue
            creation = _creation(row.get('CreationUtc'))
            if creation < owned[parent]['CreationUtc']:
                raise RuntimeError('Ambiguous child creation older than pinned parent identity')
            added.append(pid)
        if not added:
            break
        for pid in added:
            owned[pid] = copy.deepcopy(current[pid])

    history = [copy.deepcopy(row) for row in owned.values()]
    alive = [copy.deepcopy(current[pid]) for pid in owned if pid in current]
    return history, alive
