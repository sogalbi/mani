"""공용 픽스처. 테스트 영상은 FFmpeg로 직접 합성한다(저장소에 영상 파일 없음)."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")  # GUI 테스트를 창 없이 실행

from adclone.devtools.make_sample import PROFILES, make_sample
from adclone.domain.errors import FFmpegNotFoundError
from adclone.ingest.ffmpeg import locate_ffmpeg


@pytest.fixture(autouse=True)
def _isolated_home(tmp_path, monkeypatch):
    """설정/로그가 실제 사용자 폴더를 건드리지 않게 한다."""
    monkeypatch.setenv("ADCLONE_HOME", str(tmp_path / "_home"))


@pytest.fixture(scope="session")
def tools():
    try:
        return locate_ffmpeg()
    except FFmpegNotFoundError:
        pytest.skip("ffmpeg/ffprobe가 설치되어 있지 않습니다")


@pytest.fixture(scope="session")
def samples(tools, tmp_path_factory) -> dict[str, Path]:
    root = tmp_path_factory.mktemp("samples")
    result = {}
    for name in PROFILES:
        path = root / f"{name}.{'mov' if name == 'rotated' else 'mp4'}"
        make_sample(path, name, tools)
        result[name] = path
    return result


@pytest.fixture
def bad_files(tmp_path) -> dict[str, Path]:
    text = tmp_path / "not_video.mp4"
    text.write_text("이것은 영상이 아닙니다", encoding="utf-8")
    empty = tmp_path / "empty.mp4"
    empty.write_bytes(b"")
    return {"text": text, "empty": empty, "missing": tmp_path / "missing.mp4"}
