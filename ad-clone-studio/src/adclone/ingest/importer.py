"""원본 파일 해시 계산과 프로젝트로의 복사. 원본은 읽기 전용으로만 다룬다."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path

from ..domain import events
from ..jobs.progress import JobContext

_CHUNK = 4 * 1024 * 1024


def sha256_file(path: Path, ctx: JobContext | None = None) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while chunk := handle.read(_CHUNK):
            if ctx:
                ctx.check()
            digest.update(chunk)
    return digest.hexdigest()


def copy_with_hash(src: Path, dst: Path, ctx: JobContext) -> str:
    """src를 dst로 복사하면서 SHA-256을 계산한다. 임시 파일에 쓴 뒤 원자적으로 교체한다."""
    total = max(1, src.stat().st_size)
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_name(dst.name + ".part")
    digest = hashlib.sha256()
    done = 0
    try:
        with open(src, "rb") as fin, open(tmp, "wb") as fout:
            while chunk := fin.read(_CHUNK):
                ctx.check()
                digest.update(chunk)
                fout.write(chunk)
                done += len(chunk)
                ctx.emit(events.IMPORT_PROGRESS, fraction=done / total)
        os.replace(tmp, dst)
    except BaseException:
        try:
            tmp.unlink()
        except OSError:
            pass
        raise
    return digest.hexdigest()
