"""PySceneDetect AdaptiveDetector 기반 쇼트(컷) 감지."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

from ..domain import events
from ..domain.errors import JobCancelled, SceneDetectionError
from ..domain.models import DetectParams
from ..jobs.progress import JobContext

log = logging.getLogger(__name__)


@dataclass
class DetectionResult:
    cuts_ms: list[int]  # 내부 컷 시각(0과 끝은 제외)
    frames_processed: int


def detect_cuts(
    video: Path,
    params: DetectParams,
    duration_ms: int,
    ctx: JobContext | None = None,
) -> DetectionResult:
    """영상에서 컷 시각(ms, 원본 시간 기준)을 찾는다.

    플래시/디졸브는 오검출될 수 있으므로 결과는 '후보'이며 UI에서 수정한다.
    짧은 쇼트를 자동으로 합치지 않는다.
    """
    ctx = ctx or JobContext()
    try:
        from scenedetect import AdaptiveDetector, SceneManager, open_video
    except ImportError as exc:  # pragma: no cover - 설치 문제
        raise SceneDetectionError(f"PySceneDetect를 불러올 수 없습니다: {exc}") from exc

    manager_ref: list = []

    class _ReportingDetector(AdaptiveDetector):
        """프레임마다 진행률을 보고하고 취소 요청 시 감지를 멈춘다."""

        _count = 0

        def process_frame(self, timecode, frame_img):
            self._count += 1
            if ctx.cancel.cancelled:
                if manager_ref:
                    manager_ref[0].stop()
                return []
            if self._count % 15 == 0 and duration_ms > 0:
                ctx.emit(
                    events.DETECT_PROGRESS,
                    fraction=min(1.0, timecode.seconds * 1000 / duration_ms),
                )
            cuts = super().process_frame(timecode, frame_img)
            for cut in cuts:
                ctx.emit(events.SHOT_DETECTED, cut_ms=int(round(cut.seconds * 1000)))
            return cuts

    stream = None
    try:
        stream = open_video(str(video), backend="opencv")
        manager = SceneManager()
        manager_ref.append(manager)
        manager.add_detector(
            _ReportingDetector(
                adaptive_threshold=params.adaptive_threshold,
                min_scene_len=max(1, params.min_scene_len_frames),
                min_content_val=params.min_content_val,
                window_width=max(1, params.window_width),
            )
        )
        frames = manager.detect_scenes(stream, show_progress=False)
        ctx.check()
        scenes = manager.get_scene_list(start_in_scene=True)
    except JobCancelled:
        raise
    except Exception as exc:  # scenedetect/OpenCV의 다양한 예외를 사용자 메시지로 통일
        log.exception("scene detection failed")
        raise SceneDetectionError(f"쇼트 감지 실패: {exc}") from exc
    finally:
        closer = getattr(stream, "close", None)
        if callable(closer):
            try:
                closer()
            except Exception:  # noqa: BLE001
                pass
    if frames <= 0:
        raise SceneDetectionError("영상 프레임을 하나도 읽지 못했습니다 (지원하지 않는 코덱일 수 있음)")
    cuts = sorted(
        {
            ms
            for ms in (int(round(start.seconds * 1000)) for start, _ in scenes[1:])
            if 0 < ms < duration_ms
        }
    )
    return DetectionResult(cuts_ms=cuts, frames_processed=frames)
