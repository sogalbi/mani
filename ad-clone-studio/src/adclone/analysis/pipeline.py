"""워커에서 실행되는 분석 단계. DB에 접근하지 않고 결과만 돌려준다(저장은 호출 측 스레드)."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..domain import events
from ..domain.models import DetectParams, ReferenceMedia, VideoInfo
from ..ingest.ffmpeg import FFmpegTools
from ..ingest.importer import copy_with_hash, sha256_file
from ..ingest.probe import import_warnings, probe
from ..ingest.thumbnails import generate_shot_keyframes
from ..jobs.progress import JobContext
from ..project.storage import ProjectPaths
from .scene_detector import detect_cuts

log = logging.getLogger(__name__)
SUPPORTED_SUFFIXES = (".mp4", ".mov", ".m4v")


@dataclass
class KeyframeJob:
    shot_id: str
    start_ms: int
    end_ms: int


def import_reference(
    src: Path, paths: ProjectPaths, storage: str, tools: FFmpegTools, ctx: JobContext
) -> ReferenceMedia:
    """입력 검증(ffprobe) -> 해시 -> (선택) 프로젝트로 복사. 검증 실패 시 아무것도 바꾸지 않는다."""
    src = Path(src)
    ctx.emit(events.PROBE_STARTED, path=str(src))
    info = probe(src, tools, ctx.cancel)
    ctx.emit(events.PROBE_DONE, info=info.to_dict())
    ctx.check()
    ctx.emit(events.IMPORT_STARTED, storage=storage)
    if storage == "copy":
        suffix = src.suffix.lower() if src.suffix.lower() in SUPPORTED_SUFFIXES else ".mp4"
        dst = paths.reference_dir / f"original{suffix}"
        if dst.exists() and dst.resolve() == src.resolve():
            digest = sha256_file(src, ctx)
        else:
            digest = copy_with_hash(src, dst, ctx)
            for stale in paths.reference_dir.glob("original.*"):
                if stale != dst and stale.suffix.lower() in SUPPORTED_SUFFIXES:
                    stale.unlink(missing_ok=True)
        stored = paths.to_stored_path(dst)
    else:
        digest = sha256_file(src, ctx)
        stored = str(src.resolve())
    return ReferenceMedia(
        path=stored,
        storage=storage,
        original_name=src.name,
        sha256=digest,
        info=info,
        warnings=import_warnings(info),
    )


def detect(video: Path, info: VideoInfo, params: DetectParams, ctx: JobContext) -> list[int]:
    ctx.emit(events.DETECT_STARTED)
    result = detect_cuts(video, params, info.duration_ms, ctx)
    ctx.emit(events.DETECT_DONE, cuts_ms=result.cuts_ms, frames=result.frames_processed)
    return result.cuts_ms


def make_keyframes(
    video: Path,
    jobs: list[KeyframeJob],
    paths: ProjectPaths,
    frame_ms: float,
    tools: FFmpegTools,
    ctx: JobContext,
) -> dict[str, dict[str, Any]]:
    """쇼트별 키프레임 3장 생성. 한 쇼트가 끝날 때마다 ANALYZE_SHOT_DONE을 보낸다."""
    done: dict[str, dict[str, Any]] = {}
    for index, job in enumerate(jobs):
        ctx.check()
        ctx.emit(events.ANALYZE_SHOT_STARTED, shot_id=job.shot_id, index=index, total=len(jobs))
        keyframes = generate_shot_keyframes(
            tools, video, paths.shot_dir(job.shot_id), job.start_ms, job.end_ms, frame_ms, ctx.cancel
        )
        done[job.shot_id] = keyframes
        ctx.emit(
            events.ANALYZE_SHOT_DONE,
            shot_id=job.shot_id,
            start_ms=job.start_ms,
            end_ms=job.end_ms,
            keyframes=keyframes,
            index=index,
            total=len(jobs),
        )
    return done
