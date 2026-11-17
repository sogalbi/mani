"""프로젝트 폴더 레이아웃과 원자적 파일 쓰기."""

from __future__ import annotations

import json
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any

PROJECT_JSON = "project.json"
PROJECT_DB = "project.db"


def atomic_write_text(path: Path, text: str) -> None:
    """임시 파일에 쓴 뒤 교체한다. 쓰는 도중 종료돼도 기존 파일이 깨지지 않는다."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def atomic_write_json(path: Path, data: Any) -> None:
    atomic_write_text(path, json.dumps(data, ensure_ascii=False, indent=2) + "\n")


class ProjectPaths:
    def __init__(self, root: Path):
        self.root = Path(root)

    @property
    def project_json(self) -> Path:
        return self.root / PROJECT_JSON

    @property
    def db(self) -> Path:
        return self.root / PROJECT_DB

    @property
    def reference_dir(self) -> Path:
        return self.root / "reference"

    @property
    def shots_dir(self) -> Path:
        return self.root / "shots"

    @property
    def assets_dir(self) -> Path:
        return self.root / "assets"

    @property
    def exports_dir(self) -> Path:
        return self.root / "exports"

    @property
    def logs_dir(self) -> Path:
        return self.root / "logs"

    @property
    def jobs_log(self) -> Path:
        return self.logs_dir / "jobs.log"

    def shot_dir(self, shot_id: str) -> Path:
        return self.shots_dir / f"shot_{shot_id}"

    def ensure_layout(self) -> None:
        for path in (
            self.root,
            self.reference_dir,
            self.shots_dir,
            self.assets_dir,
            self.exports_dir,
            self.logs_dir,
        ):
            path.mkdir(parents=True, exist_ok=True)

    def remove_shot_dir(self, shot_id: str) -> None:
        shutil.rmtree(self.shot_dir(shot_id), ignore_errors=True)

    def to_stored_path(self, path: Path) -> str:
        """프로젝트 내부 경로는 상대(posix)로, 외부 경로는 절대 경로로 저장한다."""
        path = Path(path)
        try:
            return path.resolve().relative_to(self.root.resolve()).as_posix()
        except ValueError:
            return str(path.resolve())

    def from_stored_path(self, stored: str) -> Path:
        candidate = Path(stored)
        return candidate if candidate.is_absolute() else self.root / candidate


def is_project_dir(root: Path) -> bool:
    return (Path(root) / PROJECT_DB).is_file()
