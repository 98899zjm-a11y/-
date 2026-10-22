"""Fail-closed path ownership for the standalone, disposable demonstration."""
import json
import os
from pathlib import Path
import stat
import uuid

BASE = Path(__file__).absolute().parent.parent
RUNTIME = BASE / 'runtime'


def ordinary(path, *, missing=False):
    path = Path(path)
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('必须提供独立开发目录内的绝对规范路径。')
    for item in reversed((path, *path.parents)):
        try:
            info = item.lstat()
        except FileNotFoundError:
            if missing:
                continue
            raise ValueError('独立运行路径缺失。') from None
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
            raise ValueError('独立运行路径禁止符号链接或目录联接。')
        if stat.S_ISREG(info.st_mode) and info.st_nlink != 1:
            raise ValueError('独立运行文件禁止硬链接。')
        if item.parent != item:
            exact = [entry.name for entry in item.parent.iterdir() if entry.name.casefold() == item.name.casefold()]
            if exact != [item.name]:
                raise ValueError('路径大小写或路径别名与实际目录不符。')
        if item != path and not stat.S_ISDIR(info.st_mode):
            raise ValueError('路径上级必须是普通目录。')
    # resolve is never used to silently accept a link or a different spelling.
    if os.path.normcase(str(path.resolve())) != os.path.normcase(str(path)):
        raise ValueError('运行路径不能重定向。')
    return path


class OwnedRuntime:
    def __init__(self, root):
        self.root = Path(root)
        if not self.root.is_absolute() or '..' in self.root.parts or not self.root.is_relative_to(RUNTIME) or self.root == RUNTIME:
            raise ValueError('账套必须是本独立工程 runtime 中的专用子目录。')
        ordinary(BASE)
        ordinary(self.root, missing=True)
        self.root.mkdir(parents=True, exist_ok=True)
        ordinary(self.root)
        owner = self.root / '.standalone-demo.json'
        if not owner.exists():
            if any(self.root.iterdir()):
                raise ValueError('拒绝接管非空或未标识的目录。')
            self.namespace = str(uuid.uuid4())
            with owner.open('x', encoding='utf-8') as output:
                json.dump({'version': 1, 'purpose': 'fictional-demo-only', 'namespace': self.namespace}, output)
                output.flush()
                os.fsync(output.fileno())
        ordinary(owner)
        if owner.stat().st_size > 2048:
            raise ValueError('运行目录标识无效。')
        identity = json.loads(owner.read_text('utf-8'))
        if set(identity) != {'version', 'purpose', 'namespace'} or type(identity['version']) is not int or identity['version'] != 1 or identity['purpose'] != 'fictional-demo-only' or str(uuid.UUID(identity['namespace'])) != identity['namespace']:
            raise ValueError('运行目录标识无效。')
        self.namespace = identity['namespace']
        self.identity = identity
        for name in ('config', 'data', 'data/erp-attachments', 'temp'):
            target = self.checked(name, missing=True)
            target.mkdir(exist_ok=True)
            self.checked(name)

    def validate(self):
        ordinary(self.root)
        owner = ordinary(self.root / '.standalone-demo.json')
        if owner.stat().st_size > 2048 or json.loads(owner.read_text('utf-8')) != self.identity:
            raise ValueError('运行目录身份发生变化，停止访问。')

    def checked(self, relative, *, missing=False):
        self.validate()
        target = self.root / relative
        if not target.is_relative_to(self.root) or '..' in target.parts:
            raise ValueError('文件越出隔离账套。')
        return ordinary(target, missing=missing)

    def database(self):
        target = self.checked('data/demo.sqlite3', missing=True)
        for suffix in ('-journal', '-wal', '-shm'):
            self.checked('data/demo.sqlite3' + suffix, missing=True)
        return target
