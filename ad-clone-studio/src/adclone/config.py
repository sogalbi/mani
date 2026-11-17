"""앱 전역 설정(최근 프로젝트, FFmpeg 경로 등)과 로그 설정.

프로젝트 데이터는 여기 저장하지 않는다. 테스트에서는 ADCLONE_HOME으로 위치를 바꾼다.
"""

from __future__ import annotations

import json
import logging
import logging.handlers
import os
import sys
from pathlib import Path
from typing import Any

from . import APP_DIR_NAME
from .project.storage import atomic_write_json

MAX_RECENT = 10
log = logging.getLogger(__name__)


def app_home() -> Path:
    override = os.environ.get("ADCLONE_HOME")
    if override:
        return Path(override)
    if sys.platform == "win32":
        base = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
        return Path(base) / APP_DIR_NAME
    base = os.environ.get("XDG_CONFIG_HOME") or str(Path.home() / ".config")
    return Path(base) / APP_DIR_NAME


def default_projects_root() -> Path:
    docs = Path.home() / "Documents"
    return (docs if docs.is_dir() else Path.home()) / APP_DIR_NAME / "projects"


class Settings:
    """settings.json 래퍼. 파일이 깨져 있으면 기본값으로 시작한다(앱 실행을 막지 않음)."""

    def __init__(self, home: Path | None = None):
        self.home = home or app_home()
        self.path = self.home / "settings.json"
        self.data: dict[str, Any] = {}
        self.load()

    def load(self) -> None:
        try:
            self.data = json.loads(self.path.read_text(encoding="utf-8"))
            if not isinstance(self.data, dict):
                self.data = {}
        except FileNotFoundError:
            self.data = {}
        except (OSError, ValueError) as exc:
            log.warning("settings.json을 읽지 못해 기본값을 사용합니다: %s", exc)
            self.data = {}

    def save(self) -> None:
        self.home.mkdir(parents=True, exist_ok=True)
        atomic_write_json(self.path, self.data)

    # -- 값 접근 --
    @property
    def ffmpeg_dir(self) -> str | None:
        return self.data.get("ffmpeg_dir") or None

    @ffmpeg_dir.setter
    def ffmpeg_dir(self, value: str | None) -> None:
        self.data["ffmpeg_dir"] = value or None
        self.save()

    @property
    def projects_root(self) -> Path:
        return Path(self.data.get("projects_root") or default_projects_root())

    @projects_root.setter
    def projects_root(self, value: Path) -> None:
        self.data["projects_root"] = str(value)
        self.save()

    @property
    def recent_projects(self) -> list[str]:
        items = self.data.get("recent_projects") or []
        return [str(p) for p in items if isinstance(p, str)]

    def add_recent(self, root: Path) -> None:
        key = str(Path(root).resolve())
        items = [p for p in self.recent_projects if p != key]
        self.data["recent_projects"] = [key, *items][:MAX_RECENT]
        self.save()

    def remove_recent(self, root: str) -> None:
        self.data["recent_projects"] = [p for p in self.recent_projects if p != root]
        self.save()


def setup_logging(home: Path | None = None) -> Path:
    """앱 로그를 <home>/logs/app.log 에 회전 저장한다."""
    log_dir = (home or app_home()) / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "app.log"
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    if not any(isinstance(h, logging.handlers.RotatingFileHandler) for h in root.handlers):
        file_handler = logging.handlers.RotatingFileHandler(
            log_path, maxBytes=1_000_000, backupCount=3, encoding="utf-8"
        )
        file_handler.setFormatter(fmt)
        root.addHandler(file_handler)
        stream = logging.StreamHandler()
        stream.setFormatter(fmt)
        root.addHandler(stream)
    logging.getLogger("pyscenedetect").setLevel(logging.WARNING)
    return log_path
