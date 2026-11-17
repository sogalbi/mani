"""도메인 모델. Qt/DB에 의존하지 않는다."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any

from .timebase import Timebase

SCHEMA_VERSION = "1.0"
KEYFRAME_NAMES = ("start", "middle", "end")


class AnalysisStatus(str, Enum):
    NOT_IMPORTED = "NOT_IMPORTED"
    IMPORTED = "IMPORTED"
    PROBING = "PROBING"
    DETECTING = "DETECTING"
    ANALYZING = "ANALYZING"
    READY = "READY"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"
    INTERRUPTED = "INTERRUPTED"

    @property
    def is_running(self) -> bool:
        return self in (
            AnalysisStatus.PROBING,
            AnalysisStatus.DETECTING,
            AnalysisStatus.ANALYZING,
        )


STATUS_LABELS_KO = {
    AnalysisStatus.NOT_IMPORTED: "영상 없음",
    AnalysisStatus.IMPORTED: "가져옴 (분석 전)",
    AnalysisStatus.PROBING: "메타데이터 분석 중",
    AnalysisStatus.DETECTING: "쇼트 감지 중",
    AnalysisStatus.ANALYZING: "키프레임 생성 중",
    AnalysisStatus.READY: "분석 완료",
    AnalysisStatus.FAILED: "실패",
    AnalysisStatus.CANCELLED: "취소됨",
    AnalysisStatus.INTERRUPTED: "중단됨 (재시도 가능)",
}


@dataclass
class VideoInfo:
    """ffprobe로 얻은 원본 메타데이터."""

    format_name: str
    duration_ms: int
    size_bytes: int | None
    bit_rate: int | None
    video_codec: str
    width: int  # 인코딩된 픽셀
    height: int
    rotation: int  # 0/90/180/270 (시계 방향 표시 회전)
    display_width: int  # 회전 반영
    display_height: int
    avg_frame_rate: str | None  # "30000/1001"
    r_frame_rate: str | None
    fps: float
    nb_frames: int | None
    is_vfr_suspected: bool
    pix_fmt: str | None
    has_audio: bool
    audio_codec: str | None = None
    audio_sample_rate: int | None = None
    audio_channels: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "VideoInfo":
        names = cls.__dataclass_fields__.keys()
        return cls(**{k: data.get(k) for k in names})

    @property
    def frame_duration_ms(self) -> float:
        return 1000.0 / self.fps if self.fps > 0 else 1000.0 / 30


@dataclass
class Shot:
    id: str
    ordinal: int  # 0부터
    start_ms: int
    end_ms: int
    source: str = "auto"  # auto | manual
    # 키프레임: {"start": {"file": "keyframe_start.jpg", "time_ms": 12}, ...}
    keyframes: dict[str, dict[str, Any]] = field(default_factory=dict)
    edited_at: str | None = None

    @property
    def duration_ms(self) -> int:
        return self.end_ms - self.start_ms

    def copy(self) -> "Shot":
        return Shot(
            self.id,
            self.ordinal,
            self.start_ms,
            self.end_ms,
            self.source,
            {k: dict(v) for k, v in self.keyframes.items()},
            self.edited_at,
        )


@dataclass
class TimelineSettings:
    width: int = 1080
    height: int = 1920
    fps_num: int = 30
    fps_den: int = 1

    @property
    def timebase(self) -> Timebase:
        return Timebase(self.fps_num, self.fps_den)

    @property
    def aspect_label(self) -> str:
        return "9:16" if self.height > self.width else "16:9"


@dataclass
class DetectParams:
    """PySceneDetect AdaptiveDetector 파라미터 (UI에서 조정 가능)."""

    adaptive_threshold: float = 3.0
    min_scene_len_frames: int = 8
    min_content_val: float = 15.0
    window_width: int = 2

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "DetectParams":
        base = cls()
        for key, value in (data or {}).items():
            if hasattr(base, key) and value is not None:
                setattr(base, key, type(getattr(base, key))(value))
        return base


@dataclass
class ReferenceMedia:
    path: str  # 프로젝트 내부면 상대(posix), 링크면 절대 경로
    storage: str  # copy | link
    original_name: str
    sha256: str
    info: VideoInfo
    detected_cuts_ms: list[int] | None = None  # 자동 감지 원본(수동 편집과 분리 보관)
    detected_at: str | None = None
    warnings: list[str] = field(default_factory=list)


@dataclass
class Project:
    id: str
    name: str
    created_at: str
    updated_at: str
    timeline: TimelineSettings
    status: AnalysisStatus = AnalysisStatus.NOT_IMPORTED
    last_error: str | None = None
    detect_params: DetectParams = field(default_factory=DetectParams)
    schema_version: str = SCHEMA_VERSION
