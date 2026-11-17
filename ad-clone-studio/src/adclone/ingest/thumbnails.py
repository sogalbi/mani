"""쇼트별 키프레임(시작/중간/끝) 추출."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from ..domain.errors import FFmpegError
from ..domain.models import KEYFRAME_NAMES
from ..jobs.progress import CancelToken
from .ffmpeg import FFmpegTools, run_tool

THUMB_WIDTH = 480


def keyframe_times(start_ms: int, end_ms: int, frame_ms: float) -> dict[str, int]:
    """쇼트 안쪽에 확실히 들어가는 세 시각. 끝 프레임은 마지막 프레임의 중간쯤을 노린다."""
    last = max(start_ms, int(end_ms - frame_ms * 1.5))
    first = min(last, int(start_ms + frame_ms * 0.5)) if end_ms - start_ms > frame_ms else start_ms
    middle = min(last, max(first, (start_ms + end_ms) // 2))
    return {"start": first, "middle": middle, "end": last}


def extract_frame(
    tools: FFmpegTools,
    video: Path,
    time_ms: int,
    out_path: Path,
    width: int = THUMB_WIDTH,
    cancel: CancelToken | None = None,
) -> int:
    """time_ms 위치의 프레임을 JPG로 저장하고 실제 사용한 시각을 돌려준다.

    파일 끝 근처에서는 프레임이 나오지 않을 수 있어 조금씩 앞으로 당겨 재시도한다.
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = out_path.with_name(out_path.stem + ".tmp.jpg")
    last_error: Exception | None = None
    for attempt in range(4):
        t = max(0, time_ms - attempt * 120)
        try:
            run_tool(
                [
                    str(tools.ffmpeg),
                    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
                    "-ss", f"{t / 1000:.3f}",
                    "-i", str(video),
                    "-frames:v", "1",
                    "-an",
                    "-vf", f"scale={width}:-2",
                    "-q:v", "3",
                    str(tmp),
                ],
                cancel=cancel,
                timeout=60,
            )
        except FFmpegError as exc:
            last_error = exc
            continue
        if tmp.is_file() and tmp.stat().st_size > 0:
            os.replace(tmp, out_path)
            return t
        if t == 0:
            break
    try:
        tmp.unlink()
    except OSError:
        pass
    raise FFmpegError(
        f"{time_ms}ms 위치의 프레임을 추출하지 못했습니다" + (f": {last_error}" if last_error else "")
    )


def generate_shot_keyframes(
    tools: FFmpegTools,
    video: Path,
    shot_dir: Path,
    start_ms: int,
    end_ms: int,
    frame_ms: float,
    cancel: CancelToken | None = None,
) -> dict[str, dict[str, Any]]:
    times = keyframe_times(start_ms, end_ms, frame_ms)
    result: dict[str, dict[str, Any]] = {}
    for name in KEYFRAME_NAMES:
        filename = f"keyframe_{name}.jpg"
        used = extract_frame(tools, video, times[name], shot_dir / filename, cancel=cancel)
        result[name] = {"file": filename, "time_ms": used}
    return result
