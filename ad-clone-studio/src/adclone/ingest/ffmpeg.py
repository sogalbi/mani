"""FFmpeg/ffprobe 탐지와 실행. 인수는 항상 배열로 전달한다(shell 문자열 금지)."""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from ..domain.errors import FFmpegError, FFmpegNotFoundError
from ..jobs.progress import CancelToken

log = logging.getLogger(__name__)
ENV_FFMPEG_DIR = "ADCLONE_FFMPEG_DIR"
_EXE = ".exe" if sys.platform == "win32" else ""


@dataclass(frozen=True)
class FFmpegTools:
    ffmpeg: Path
    ffprobe: Path


def _popen_kwargs() -> dict:
    if sys.platform == "win32":
        # GUI 앱에서 콘솔 창이 깜빡이지 않게 한다
        return {"creationflags": subprocess.CREATE_NO_WINDOW}  # type: ignore[attr-defined]
    return {}


def _candidates(configured_dir: str | None) -> list[Path]:
    dirs: list[Path] = []
    if configured_dir:
        dirs.append(Path(configured_dir))
    if os.environ.get(ENV_FFMPEG_DIR):
        dirs.append(Path(os.environ[ENV_FFMPEG_DIR]))
    if getattr(sys, "frozen", False):
        # 패키징된 실행 파일(M5)에서는 실행 파일 옆 ffmpeg 폴더를 번들 위치로 사용
        dirs.append(Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent)) / "ffmpeg")
    expanded = []
    for d in dirs:
        expanded += [d, d / "bin"]
    return expanded


def locate_ffmpeg(configured_dir: str | None = None) -> FFmpegTools:
    """설정 경로 -> 환경변수 -> 번들 -> PATH 순으로 ffmpeg와 ffprobe를 찾는다."""
    for directory in _candidates(configured_dir):
        ffmpeg, ffprobe = directory / f"ffmpeg{_EXE}", directory / f"ffprobe{_EXE}"
        if ffmpeg.is_file() and ffprobe.is_file():
            return FFmpegTools(ffmpeg, ffprobe)
    ffmpeg_path, ffprobe_path = shutil.which("ffmpeg"), shutil.which("ffprobe")
    if ffmpeg_path and ffprobe_path:
        return FFmpegTools(Path(ffmpeg_path), Path(ffprobe_path))
    missing = [n for n, p in (("ffmpeg", ffmpeg_path), ("ffprobe", ffprobe_path)) if not p]
    raise FFmpegNotFoundError(
        f"{', '.join(missing)} 실행 파일을 찾을 수 없습니다. FFmpeg를 설치해 PATH에 추가하거나 "
        "[도구 > 환경 진단]에서 FFmpeg 폴더를 지정하세요."
    )


def tool_version(executable: Path) -> str:
    """'ffmpeg version 6.1.1 ...' 첫 줄. 실패하면 예외 대신 설명 문자열."""
    try:
        out = subprocess.run(
            [str(executable), "-version"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=10,
            **_popen_kwargs(),
        )
        return out.stdout.splitlines()[0] if out.stdout else f"(출력 없음, code {out.returncode})"
    except (OSError, subprocess.SubprocessError) as exc:
        return f"(실행 실패: {exc})"


def run_tool(
    args: list[str],
    cancel: CancelToken | None = None,
    timeout: float = 300.0,
) -> subprocess.CompletedProcess:
    """프로세스를 실행해 stdout/stderr/종료 코드를 수집한다. 취소되면 프로세스를 종료한다."""
    log.debug("run: %s", args)
    if cancel is not None:
        cancel.raise_if_cancelled()  # 이미 취소된 작업은 프로세스를 띄우지 않는다
    try:
        proc = subprocess.Popen(
            args,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            **_popen_kwargs(),
        )
    except OSError as exc:
        raise FFmpegNotFoundError(f"{Path(args[0]).name} 을(를) 실행할 수 없습니다: {exc}") from exc
    waited = 0.0
    step = 0.1
    while True:
        try:
            stdout, stderr = proc.communicate(timeout=step)
            break
        except subprocess.TimeoutExpired:
            waited += step
            if cancel is not None and cancel.cancelled:
                proc.kill()
                proc.communicate()
                cancel.raise_if_cancelled()
            if waited >= timeout:
                proc.kill()
                proc.communicate()
                raise FFmpegError(f"{Path(args[0]).name} 실행 시간 초과 ({timeout:.0f}초)")
    text_out = stdout.decode("utf-8", errors="replace")
    text_err = stderr.decode("utf-8", errors="replace")
    if proc.returncode != 0:
        tail = "\n".join(text_err.strip().splitlines()[-6:])
        raise FFmpegError(
            f"{Path(args[0]).name} 오류 (code {proc.returncode}): {tail or '(메시지 없음)'}",
            returncode=proc.returncode,
            stderr=text_err,
        )
    return subprocess.CompletedProcess(args, proc.returncode, text_out, text_err)
