"""Retained cashier identifiers. Caller holds the ledger BEGIN IMMEDIATE lock.

The trusted bootstrap binds this file outside the ledger restoration slot.
Unused reservations survive transaction rollback; they are never recycled.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import uuid

PREFIX = {'opening': 'CNQC', 'receive': 'CNSK', 'pay': 'CNFK', 'refund': 'CNTK',
          'transfer': 'CNDB', 'reversal': 'CNCX'}


def ordinary(path, *, missing=False):
    path = Path(path)
    for item in (path, *path.parents):
        if item == path and missing and not item.exists():
            continue
        info = item.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
            raise ValueError('编号路径不可为链接或重解析点。')
        if item == path and (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1):
            raise ValueError('编号记录必须是独立普通文件。')
        if item != path and not stat.S_ISDIR(info.st_mode):
            raise ValueError('编号上级路径无效。')
    return path


def create_reserver(*, path, namespace):
    filename = Path(path).absolute()
    if not isinstance(namespace, str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,160}', namespace):
        raise ValueError('Invalid trusted cashier number namespace')
    ordinary(filename, missing=True)

    def reserve(kind, day, doc_id):
        ordinary(filename, missing=True)
        if kind not in PREFIX or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', day) or str(uuid.UUID(doc_id)) != doc_id:
            raise ValueError('Invalid cashier number reservation')
        state = {'version': 1, 'namespace': namespace, 'sequences': {}, 'numbers': {}}
        previous = None
        if filename.exists():
            if filename.stat().st_size > 64 * 1024 * 1024:
                raise ValueError('编号保留记录过大，停止制单。')
            previous = filename.read_bytes()
            state = json.loads(previous)
        if set(state) != {'version','namespace','sequences','numbers'} or state['version'] != 1 or state['namespace'] != namespace or not isinstance(state['sequences'],dict) or not isinstance(state['numbers'],dict):
            raise ValueError('出纳编号保留记录无效。')
        scope = PREFIX[kind] + '-' + day.replace('-', '')
        prior = state['sequences'].get(scope, 0)
        if type(prior) is not int or not 0 <= prior < 999999:
            raise ValueError('出纳编号超限或记录异常。')
        number = scope + '-' + str(prior + 1).zfill(6)
        if number in state['numbers']:
            raise ValueError('出纳编号冲突。')
        state['sequences'][scope] = prior + 1
        state['numbers'][number] = {'docId':doc_id,'kind':kind,'date':day}
        temporary = filename.with_name(filename.name + '.' + str(uuid.uuid4()) + '.tmp')
        with temporary.open('x', encoding='utf-8', newline='\n') as out:
            json.dump(state, out, ensure_ascii=False, sort_keys=True, separators=(',',':'))
            out.flush()
            os.fsync(out.fileno())
        ordinary(filename, missing=True)
        if (filename.read_bytes() if filename.exists() else None) != previous:
            raise ValueError('编号保留记录并发变化，停止制单。')
        os.replace(temporary, filename)
        return number

    return reserve
