"""Program-only inventory; a cache is optional only with its paired source."""
import hashlib
from pathlib import Path
import re
import stat

def collect_program_inventory(bundle,check):
    bundle=check(Path(bundle));files=[]
    for file in sorted(bundle.rglob('*')):
        file=check(file);info=file.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info,'st_file_attributes',0)&0x400:
            raise RuntimeError('Program inventory refuses links/reparse points')
        if file.is_dir():continue
        if not file.is_file() or info.st_nlink!=1:raise RuntimeError('Program inventory requires ordinary single-link files')
        relative=file.relative_to(bundle)
        if '__pycache__' in relative.parts:
            match=re.fullmatch(r'([A-Za-z0-9_]+)\.cpython-314(?:\.opt-[12])?\.pyc',file.name)
            source=check(file.parent.parent/(match.group(1)+'.py')) if match else None
            if source is None or not source.is_file() or source.lstat().st_nlink!=1:
                raise RuntimeError('Unpaired or unknown cache cannot be dropped from program inventory')
            continue
        before=file.stat();body=file.read_bytes();after=file.stat()
        identity=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_nlink)
        if identity(before)!=identity(after):raise RuntimeError('Program changed while inventorying')
        if body.startswith(b'SQLite format 3\0'):raise RuntimeError('A database is not a program dependency')
        files.append({'path':relative.as_posix(),'size':len(body),'sha256':hashlib.sha256(body).hexdigest()})
    return files
