"""프로젝트 영속화: SQLite가 기준 데이터, project.json / analysis.json은 사람이 읽는 미러."""

from __future__ import annotations

import json
import logging
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from ..domain.errors import ProjectError
from ..domain.models import (
    AnalysisStatus,
    DetectParams,
    Project,
    ReferenceMedia,
    Shot,
    TimelineSettings,
    VideoInfo,
)
from ..domain.timebase import boundaries_to_frames
from .migrations import migrate
from .storage import ProjectPaths, atomic_write_json, is_project_dir

log = logging.getLogger(__name__)


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


class ProjectRepository:
    """한 프로젝트 폴더에 대한 저장소. 한 스레드(UI 스레드)에서만 사용한다."""

    def __init__(self, root: Path, conn: sqlite3.Connection):
        self.paths = ProjectPaths(root)
        self._conn = conn
        self._conn.row_factory = sqlite3.Row

    # ---------- 생성 / 열기 ----------
    @classmethod
    def create(cls, root: Path, name: str, timeline: TimelineSettings) -> "ProjectRepository":
        root = Path(root)
        if is_project_dir(root):
            raise ProjectError(f"이미 프로젝트가 있는 폴더입니다: {root}")
        if root.exists() and any(root.iterdir()):
            raise ProjectError(f"비어 있지 않은 폴더에는 프로젝트를 만들 수 없습니다: {root}")
        name = name.strip()
        if not name:
            raise ProjectError("프로젝트 이름을 입력하세요")
        try:
            paths = ProjectPaths(root)
            paths.ensure_layout()
            conn = sqlite3.connect(paths.db)
            migrate(conn)
        except (OSError, sqlite3.Error) as exc:
            raise ProjectError(f"프로젝트 폴더를 만들 수 없습니다: {exc}") from exc
        repo = cls(root, conn)
        stamp = now_iso()
        project_id = "p_" + datetime.now().strftime("%Y%m%d_%H%M%S") + "_" + uuid.uuid4().hex[:6]
        with conn:
            conn.execute(
                "INSERT INTO projects (id, name, created_at, updated_at, schema_version,"
                " timeline_json, status, detect_params_json) VALUES (?,?,?,?,?,?,?,?)",
                (
                    project_id,
                    name,
                    stamp,
                    stamp,
                    Project.__dataclass_fields__["schema_version"].default,
                    json.dumps(timeline.__dict__),
                    AnalysisStatus.NOT_IMPORTED.value,
                    json.dumps(DetectParams().to_dict()),
                ),
            )
        repo.write_json_mirror()
        return repo

    @classmethod
    def open(cls, root: Path) -> "ProjectRepository":
        root = Path(root)
        if not is_project_dir(root):
            raise ProjectError(f"프로젝트 폴더가 아닙니다 (project.db 없음): {root}")
        try:
            conn = sqlite3.connect(ProjectPaths(root).db)
            conn.execute("PRAGMA foreign_keys = ON")
            migrate(conn)
            repo = cls(root, conn)
            repo.paths.ensure_layout()
            project = repo.get_project()
        except sqlite3.Error as exc:
            raise ProjectError(f"프로젝트 DB를 열 수 없습니다 (손상되었을 수 있음): {exc}") from exc
        if project.status.is_running:
            # 이전 실행이 작업 도중 종료됨 -> 재시도 가능 상태로 표시
            repo.set_status(AnalysisStatus.INTERRUPTED, "이전 실행에서 작업이 끝나기 전에 종료되었습니다")
        return repo

    def close(self) -> None:
        try:
            self._conn.close()
        except sqlite3.Error:
            pass

    # ---------- 프로젝트 ----------
    def _project_row(self) -> sqlite3.Row:
        row = self._conn.execute("SELECT * FROM projects LIMIT 1").fetchone()
        if row is None:
            raise ProjectError("프로젝트 정보가 DB에 없습니다")
        return row

    def get_project(self) -> Project:
        row = self._project_row()
        try:
            status = AnalysisStatus(row["status"])
        except ValueError:
            status = AnalysisStatus.FAILED
        return Project(
            id=row["id"],
            name=row["name"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            timeline=TimelineSettings(**json.loads(row["timeline_json"])),
            status=status,
            last_error=row["last_error"],
            detect_params=DetectParams.from_dict(json.loads(row["detect_params_json"])),
            schema_version=row["schema_version"],
        )

    def _touch(self) -> None:
        self._conn.execute("UPDATE projects SET updated_at = ?", (now_iso(),))

    def set_status(self, status: AnalysisStatus, error: str | None = None) -> None:
        with self._conn:
            self._conn.execute(
                "UPDATE projects SET status = ?, last_error = ?", (status.value, error)
            )
            self._touch()
        self.write_json_mirror()

    def set_detect_params(self, params: DetectParams) -> None:
        with self._conn:
            self._conn.execute(
                "UPDATE projects SET detect_params_json = ?", (json.dumps(params.to_dict()),)
            )
            self._touch()

    def rename(self, name: str) -> None:
        with self._conn:
            self._conn.execute("UPDATE projects SET name = ?", (name,))
            self._touch()
        self.write_json_mirror()

    def allocate_shot_id(self) -> str:
        """프로젝트 내에서 재사용되지 않는 쇼트 id (s001, s002, ...)."""
        with self._conn:
            seq = self._project_row()["next_shot_seq"]
            self._conn.execute("UPDATE projects SET next_shot_seq = ?", (seq + 1,))
        return f"s{seq:03d}"

    # ---------- 레퍼런스 ----------
    def get_reference(self) -> ReferenceMedia | None:
        row = self._conn.execute(
            "SELECT * FROM reference_media ORDER BY id DESC LIMIT 1"
        ).fetchone()
        if row is None:
            return None
        cuts = json.loads(row["detected_cuts_json"]) if row["detected_cuts_json"] else None
        return ReferenceMedia(
            path=row["path"],
            storage=row["storage"],
            original_name=row["original_name"],
            sha256=row["sha256"],
            info=VideoInfo.from_dict(json.loads(row["video_info_json"])),
            detected_cuts_ms=cuts,
            detected_at=row["detected_at"],
            warnings=json.loads(row["warnings_json"] or "[]"),
        )

    def set_reference(self, ref: ReferenceMedia) -> list[str]:
        """레퍼런스를 교체한다. 기존 쇼트는 모두 지우고 지워진 id를 돌려준다."""
        project_id = self._project_row()["id"]
        with self._conn:
            removed = [r["id"] for r in self._conn.execute("SELECT id FROM shots")]
            self._conn.execute("DELETE FROM shots")
            self._conn.execute("DELETE FROM reference_media")
            self._conn.execute(
                "INSERT INTO reference_media (project_id, path, storage, original_name, sha256,"
                " duration_ms, video_info_json, warnings_json) VALUES (?,?,?,?,?,?,?,?)",
                (
                    project_id,
                    ref.path,
                    ref.storage,
                    ref.original_name,
                    ref.sha256,
                    ref.info.duration_ms,
                    json.dumps(ref.info.to_dict()),
                    json.dumps(ref.warnings, ensure_ascii=False),
                ),
            )
            self._conn.execute(
                "UPDATE projects SET status = ?, last_error = NULL",
                (AnalysisStatus.IMPORTED.value,),
            )
            self._touch()
        for shot_id in removed:
            self.paths.remove_shot_dir(shot_id)
        self.write_json_mirror()
        return removed

    def set_detected_cuts(self, cuts_ms: list[int]) -> None:
        with self._conn:
            self._conn.execute(
                "UPDATE reference_media SET detected_cuts_json = ?, detected_at = ?",
                (json.dumps(cuts_ms), now_iso()),
            )
            self._touch()

    def reference_path(self) -> Path | None:
        ref = self.get_reference()
        return self.paths.from_stored_path(ref.path) if ref else None

    # ---------- 쇼트 ----------
    def list_shots(self) -> list[Shot]:
        rows = self._conn.execute("SELECT * FROM shots ORDER BY ordinal").fetchall()
        shots = []
        for row in rows:
            analysis = json.loads(row["analysis_json"] or "{}")
            shots.append(
                Shot(
                    id=row["id"],
                    ordinal=row["ordinal"],
                    start_ms=row["start_ms"],
                    end_ms=row["end_ms"],
                    source=row["source"],
                    keyframes=analysis.get("keyframes", {}),
                    edited_at=row["edited_at"],
                )
            )
        return shots

    def replace_shots(self, shots: list[Shot], mark_edited: set[str] | None = None) -> None:
        """쇼트 목록 전체를 한 트랜잭션으로 교체한다. 사라진 쇼트의 폴더는 지운다."""
        project_id = self._project_row()["id"]
        stamp = now_iso()
        for shot in shots:
            if mark_edited and shot.id in mark_edited:
                shot.edited_at = stamp
        with self._conn:
            old_ids = {r["id"] for r in self._conn.execute("SELECT id FROM shots")}
            self._conn.execute("DELETE FROM shots")
            self._conn.executemany(
                "INSERT INTO shots (id, project_id, ordinal, start_ms, end_ms, source,"
                " analysis_json, edited_at) VALUES (?,?,?,?,?,?,?,?)",
                [
                    (
                        s.id,
                        project_id,
                        s.ordinal,
                        s.start_ms,
                        s.end_ms,
                        s.source,
                        json.dumps({"keyframes": s.keyframes}),
                        s.edited_at,
                    )
                    for s in shots
                ],
            )
            self._touch()
        for gone in old_ids - {s.id for s in shots}:
            self.paths.remove_shot_dir(gone)
        self.write_json_mirror()
        self.write_shot_json(shots)

    def set_shot_keyframes(self, shot_id: str, keyframes: dict[str, dict[str, Any]]) -> None:
        with self._conn:
            cur = self._conn.execute(
                "UPDATE shots SET analysis_json = ? WHERE id = ?",
                (json.dumps({"keyframes": keyframes}), shot_id),
            )
        if cur.rowcount:
            shots = self.list_shots()
            self.write_shot_json([s for s in shots if s.id == shot_id], all_shots=shots)

    # ---------- JSON 미러 ----------
    def shot_document(self, shot: Shot, frames: tuple[int, int]) -> dict[str, Any]:
        return {
            "shot_id": shot.id,
            "ordinal": shot.ordinal + 1,
            "reference_interval": {"start_ms": shot.start_ms, "end_ms": shot.end_ms},
            "duration_ms": shot.duration_ms,
            "display_frames": {"start": frames[0], "end_exclusive": frames[1]},
            "keyframes": shot.keyframes,
            "boundary_source": shot.source,
            "manual_override": {
                "edited": shot.source == "manual",
                "fields": ["reference_interval"] if shot.source == "manual" else [],
                "edited_at": shot.edited_at,
            },
        }

    def frame_ranges(self, shots: list[Shot]) -> dict[str, tuple[int, int]]:
        if not shots:
            return {}
        tb = self.get_project().timeline.timebase
        bounds = boundaries_to_frames([shots[0].start_ms, *[s.end_ms for s in shots]], tb)
        return {s.id: (bounds[i], bounds[i + 1]) for i, s in enumerate(shots)}

    def write_shot_json(self, shots: list[Shot], all_shots: list[Shot] | None = None) -> None:
        ranges = self.frame_ranges(all_shots if all_shots is not None else shots)
        for shot in shots:
            try:
                atomic_write_json(
                    self.paths.shot_dir(shot.id) / "analysis.json",
                    self.shot_document(shot, ranges[shot.id]),
                )
            except OSError as exc:  # 미러 실패는 DB 데이터를 잃지 않는다
                log.warning("analysis.json 저장 실패 (%s): %s", shot.id, exc)

    def project_document(self) -> dict[str, Any]:
        project = self.get_project()
        ref = self.get_reference()
        shots = self.list_shots()
        doc: dict[str, Any] = {
            "schema_version": project.schema_version,
            "project_id": project.id,
            "title": project.name,
            "created_at": project.created_at,
            "updated_at": project.updated_at,
            "timeline": dict(project.timeline.__dict__),
            "analysis": {
                "status": project.status.value,
                "last_error": project.last_error,
                "detect_params": project.detect_params.to_dict(),
            },
            "reference": None,
            "shot_ids": [s.id for s in shots],
            "assets": [],
        }
        if ref:
            doc["reference"] = {
                "path": ref.path,
                "storage": ref.storage,
                "original_name": ref.original_name,
                "sha256": ref.sha256,
                "duration_ms": ref.info.duration_ms,
                "video_info": ref.info.to_dict(),
                "warnings": ref.warnings,
                "detected_cuts_ms": ref.detected_cuts_ms,
                "detected_at": ref.detected_at,
            }
        return doc

    def write_json_mirror(self) -> None:
        try:
            atomic_write_json(self.paths.project_json, self.project_document())
        except OSError as exc:
            log.warning("project.json 저장 실패: %s", exc)

    def export_document(self) -> dict[str, Any]:
        """분석 JSON 내보내기용: 프로젝트 + 모든 쇼트."""
        shots = self.list_shots()
        ranges = self.frame_ranges(shots)
        doc = self.project_document()
        doc["shots"] = [self.shot_document(s, ranges[s.id]) for s in shots]
        return doc
