"""프로젝트 상태 변경을 한곳에 모은 서비스 (UI와 CLI가 공유, Qt 비의존)."""

from __future__ import annotations

import logging
import math
from pathlib import Path
from typing import Any

from ..analysis.pipeline import KeyframeJob
from ..domain import shot_ops
from ..domain.errors import ProjectError, ShotEditError
from ..domain.models import AnalysisStatus, DetectParams, Project, ReferenceMedia, Shot
from .repository import ProjectRepository

log = logging.getLogger(__name__)
SHORT_SHOT_MS = 300  # 이보다 짧으면 UI에 검토 경고(자동 병합은 하지 않음)


class ProjectService:
    def __init__(self, repo: ProjectRepository):
        self.repo = repo
        self.paths = repo.paths
        self.project: Project = repo.get_project()
        self.reference: ReferenceMedia | None = repo.get_reference()
        self.shots: list[Shot] = repo.list_shots()
        self._job_log = logging.getLogger(f"adclone.jobs.{self.project.id}")
        self._job_log.setLevel(logging.INFO)
        self._job_log.propagate = False
        self._handler: logging.Handler | None = None
        try:
            self._handler = logging.FileHandler(self.paths.jobs_log, encoding="utf-8")
            self._handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
            self._job_log.addHandler(self._handler)
        except OSError as exc:
            log.warning("jobs.log를 열 수 없습니다: %s", exc)

    def close(self) -> None:
        if self._handler:
            self._job_log.removeHandler(self._handler)
            self._handler.close()
            self._handler = None
        self.repo.close()

    def log_job(self, message: str, error: bool = False) -> None:
        (self._job_log.error if error else self._job_log.info)(message)

    # ---------- 조회 ----------
    @property
    def root(self) -> Path:
        return self.paths.root

    @property
    def duration_ms(self) -> int:
        return self.reference.info.duration_ms if self.reference else 0

    @property
    def min_shot_ms(self) -> int:
        """쇼트 최소 길이: 원본 1프레임."""
        return max(1, math.ceil(self.reference.info.frame_duration_ms)) if self.reference else 1

    def reference_path(self) -> Path | None:
        return self.paths.from_stored_path(self.reference.path) if self.reference else None

    def require_reference_file(self) -> Path:
        path = self.reference_path()
        if path is None:
            raise ProjectError("먼저 원본 영상을 가져오세요")
        if not path.is_file():
            raise ProjectError(
                f"원본 영상 파일을 찾을 수 없습니다: {path}\n파일을 원래 위치로 되돌리거나 영상을 다시 가져오세요."
            )
        return path

    def keyframe_path(self, shot: Shot, name: str = "middle") -> Path | None:
        entry = shot.keyframes.get(name)
        if not entry:
            return None
        path = self.paths.shot_dir(shot.id) / entry["file"]
        return path if path.is_file() else None

    def keyframe_jobs(self, only_missing: bool = True) -> list[KeyframeJob]:
        jobs = []
        for shot in self.shots:
            complete = all(self.keyframe_path(shot, n) for n in ("start", "middle", "end"))
            if not (only_missing and complete):
                jobs.append(KeyframeJob(shot.id, shot.start_ms, shot.end_ms))
        return jobs

    def is_short(self, shot: Shot) -> bool:
        return shot.duration_ms < SHORT_SHOT_MS

    # ---------- 상태 ----------
    def set_status(self, status: AnalysisStatus, error: str | None = None) -> None:
        self.repo.set_status(status, error)
        self.project = self.repo.get_project()
        self.log_job(f"status -> {status.value}" + (f" ({error})" if error else ""), error=bool(error))

    def set_detect_params(self, params: DetectParams) -> None:
        self.repo.set_detect_params(params)
        self.project = self.repo.get_project()

    # ---------- 분석 결과 반영 ----------
    def apply_reference(self, ref: ReferenceMedia) -> None:
        self.repo.set_reference(ref)
        self.reference = self.repo.get_reference()
        self.shots = []
        self.project = self.repo.get_project()
        self.log_job(f"reference imported: {ref.original_name} sha256={ref.sha256[:12]} ({ref.storage})")

    def apply_detection(self, cuts_ms: list[int]) -> list[Shot]:
        """자동 감지 결과로 쇼트 목록을 새로 만든다(수동 편집은 대체됨 - 호출 전 확인 필요)."""
        if not self.reference:
            raise ProjectError("원본 영상이 없습니다")
        shots = shot_ops.shots_from_cuts(cuts_ms, self.duration_ms, self.repo.allocate_shot_id)
        self.repo.set_detected_cuts([s.start_ms for s in shots[1:]])
        self.repo.replace_shots(shots)
        self.reference = self.repo.get_reference()
        self.shots = self.repo.list_shots()
        self.log_job(f"detection applied: {len(shots)} shots")
        return self.shots

    def apply_keyframes(
        self, shot_id: str, start_ms: int, end_ms: int, keyframes: dict[str, dict[str, Any]]
    ) -> bool:
        """키프레임 결과 반영. 그 사이 경계가 바뀐 쇼트의 결과는 버린다."""
        for shot in self.shots:
            if shot.id == shot_id and shot.start_ms == start_ms and shot.end_ms == end_ms:
                shot.keyframes = keyframes
                self.repo.set_shot_keyframes(shot_id, keyframes)
                return True
        return False

    # ---------- 수동 편집 ----------
    def _commit_edit(self, shots: list[Shot], touched: list[str]) -> list[str]:
        shot_ops.validate(shots, self.duration_ms)
        self.repo.replace_shots(shots, mark_edited=set(touched))
        self.shots = self.repo.list_shots()
        return touched

    def split(self, at_ms: int) -> list[str]:
        if not self.shots:
            raise ShotEditError("분할할 쇼트가 없습니다. 먼저 분석을 실행하세요.")
        shots, touched = shot_ops.split(
            self.shots, int(at_ms), self.min_shot_ms, self.repo.allocate_shot_id
        )
        self.log_job(f"split at {at_ms}ms")
        return self._commit_edit(shots, touched)

    def merge(self, index: int) -> list[str]:
        shots, touched, _removed = shot_ops.merge(self.shots, index)
        self.log_job(f"merge shots {index + 1}+{index + 2}")
        return self._commit_edit(shots, touched)

    def move_boundary(self, index: int, new_ms: int) -> list[str]:
        shots, touched = shot_ops.move_boundary(self.shots, index, int(new_ms), self.min_shot_ms)
        if touched:
            self.log_job(f"boundary {index + 1}|{index + 2} -> {new_ms}ms")
            self._commit_edit(shots, touched)
        return touched

    def restore_detected(self) -> list[Shot]:
        """저장해 둔 자동 감지 결과로 되돌린다(재분석 없이)."""
        if not self.reference or self.reference.detected_cuts_ms is None:
            raise ProjectError("저장된 자동 감지 결과가 없습니다. 분석을 먼저 실행하세요.")
        return self.apply_detection(self.reference.detected_cuts_ms)
