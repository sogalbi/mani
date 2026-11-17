"""ffprobe 기반 메타데이터 추출과 입력 검증. 확장자가 아니라 스트림 실체를 본다."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..domain.errors import FFmpegError, MediaProbeError
from ..domain.models import VideoInfo
from ..domain.timebase import parse_rate
from ..jobs.progress import CancelToken
from .ffmpeg import FFmpegTools, run_tool

MIN_DURATION_MS = 5_000
MAX_DURATION_MS = 60_000


def _to_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _to_float(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if result == result else None  # NaN 제외


def _rotation(stream: dict[str, Any]) -> int:
    """표시 회전(시계 방향, 0/90/180/270). display matrix와 구형 rotate 태그를 모두 본다."""
    for side in stream.get("side_data_list") or []:
        if "rotation" in side:
            value = _to_float(side["rotation"])
            if value is not None:
                # display matrix의 rotation은 반시계 방향 각도
                return int(round(-value)) % 360
    tag = _to_float((stream.get("tags") or {}).get("rotate"))
    return int(round(tag)) % 360 if tag is not None else 0


def parse_probe_json(data: dict[str, Any], source_name: str = "") -> VideoInfo:
    """ffprobe -show_format -show_streams JSON을 VideoInfo로 변환한다."""
    streams = data.get("streams") or []
    fmt = data.get("format") or {}
    # 앨범 아트(attached_pic)는 영상으로 보지 않는다
    videos = [
        s
        for s in streams
        if s.get("codec_type") == "video"
        and not (s.get("disposition") or {}).get("attached_pic")
    ]
    if not videos:
        raise MediaProbeError(f"영상 스트림이 없는 파일입니다: {source_name}".rstrip(": "))
    video = videos[0]
    width, height = _to_int(video.get("width")), _to_int(video.get("height"))
    if not width or not height:
        raise MediaProbeError("영상 해상도를 읽을 수 없습니다 (지원하지 않는 코덱이거나 손상된 파일)")

    duration_s = _to_float(video.get("duration")) or _to_float(fmt.get("duration"))
    if not duration_s or duration_s <= 0:
        raise MediaProbeError("영상 길이를 읽을 수 없습니다 (손상되었거나 스트리밍 전용 파일)")

    avg, real = parse_rate(video.get("avg_frame_rate")), parse_rate(video.get("r_frame_rate"))
    rate = avg or real
    if rate is None:
        raise MediaProbeError("프레임레이트를 읽을 수 없습니다")
    is_vfr = bool(avg and real and abs(float(avg) - float(real)) / float(real) > 0.01)

    rotation = _rotation(video)
    swap = rotation in (90, 270)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    return VideoInfo(
        format_name=str(fmt.get("format_long_name") or fmt.get("format_name") or "unknown"),
        duration_ms=int(round(duration_s * 1000)),
        size_bytes=_to_int(fmt.get("size")),
        bit_rate=_to_int(fmt.get("bit_rate")),
        video_codec=str(video.get("codec_name") or "unknown"),
        width=width,
        height=height,
        rotation=rotation,
        display_width=height if swap else width,
        display_height=width if swap else height,
        avg_frame_rate=video.get("avg_frame_rate"),
        r_frame_rate=video.get("r_frame_rate"),
        fps=float(rate),
        nb_frames=_to_int(video.get("nb_frames")),
        is_vfr_suspected=is_vfr,
        pix_fmt=video.get("pix_fmt"),
        has_audio=audio is not None,
        audio_codec=audio.get("codec_name") if audio else None,
        audio_sample_rate=_to_int(audio.get("sample_rate")) if audio else None,
        audio_channels=_to_int(audio.get("channels")) if audio else None,
    )


def probe(path: Path, tools: FFmpegTools, cancel: CancelToken | None = None) -> VideoInfo:
    path = Path(path)
    if not path.is_file():
        raise MediaProbeError(f"파일을 찾을 수 없습니다: {path}")
    if path.stat().st_size == 0:
        raise MediaProbeError(f"빈 파일입니다: {path.name}")
    try:
        result = run_tool(
            [
                str(tools.ffprobe),
                "-v", "error",
                "-print_format", "json",
                "-show_format",
                "-show_streams",
                str(path),
            ],
            cancel=cancel,
            timeout=60,
        )
    except FFmpegError as exc:
        detail = (exc.stderr or str(exc)).strip().splitlines()
        raise MediaProbeError(
            f"영상 파일로 읽을 수 없습니다: {path.name}\n{detail[-1] if detail else ''}".rstrip()
        ) from exc
    try:
        data = json.loads(result.stdout)
    except ValueError as exc:
        raise MediaProbeError("ffprobe 출력을 해석할 수 없습니다") from exc
    return parse_probe_json(data, path.name)


def import_warnings(info: VideoInfo) -> list[str]:
    """가져오기는 허용하되 사용자에게 알려야 하는 사항."""
    warnings = []
    if info.duration_ms < MIN_DURATION_MS or info.duration_ms > MAX_DURATION_MS:
        warnings.append(
            f"영상 길이 {info.duration_ms / 1000:.1f}초는 v1 권장 범위(5~60초)를 벗어납니다. "
            "분석은 진행하지만 결과 품질/속도를 보장하지 않습니다."
        )
    if info.is_vfr_suspected:
        warnings.append(
            "가변 프레임레이트(VFR)로 보입니다. 타임코드는 원본 시간(ms) 기준으로 저장되며 "
            "프레임 번호 표시는 근사값입니다."
        )
    if info.rotation:
        warnings.append(f"회전 메타데이터 {info.rotation}°가 있어 표시 해상도를 회전 기준으로 계산했습니다.")
    return warnings
