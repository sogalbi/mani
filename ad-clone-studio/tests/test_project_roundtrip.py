import json
import sqlite3

import pytest

from adclone.config import Settings
from adclone.domain.errors import ProjectError, ShotEditError
from adclone.domain.models import AnalysisStatus, DetectParams, ReferenceMedia, TimelineSettings, VideoInfo
from adclone.project.repository import ProjectRepository
from adclone.project.service import ProjectService
from adclone.project.storage import atomic_write_json


def fake_info(duration_ms=10_000):
    return VideoInfo(
        format_name="mov", duration_ms=duration_ms, size_bytes=1234, bit_rate=1000, video_codec="h264",
        width=1280, height=720, rotation=0, display_width=1280, display_height=720,
        avg_frame_rate="30/1", r_frame_rate="30/1", fps=30.0, nb_frames=300, is_vfr_suspected=False,
        pix_fmt="yuv420p", has_audio=True, audio_codec="aac", audio_sample_rate=48000, audio_channels=2,
    )


def new_service(root, name="테스트 광고"):
    repo = ProjectRepository.create(root, name, TimelineSettings(1080, 1920, 30000, 1001))
    service = ProjectService(repo)
    service.apply_reference(
        ReferenceMedia("reference/original.mp4", "copy", "광고.mp4", "ab" * 32, fake_info(), warnings=["경고 1"])
    )
    return service


def snapshot(service):
    return [(s.id, s.ordinal, s.start_ms, s.end_ms, s.source, s.keyframes) for s in service.shots]


def test_create_and_reopen_empty(tmp_path):
    repo = ProjectRepository.create(tmp_path / "p", "빈 프로젝트", TimelineSettings())
    project = repo.get_project()
    repo.close()
    reopened = ProjectRepository.open(tmp_path / "p")
    again = reopened.get_project()
    assert (again.id, again.name, again.status) == (project.id, "빈 프로젝트", AnalysisStatus.NOT_IMPORTED)
    assert again.timeline.height == 1920 and reopened.get_reference() is None and reopened.list_shots() == []
    for sub in ("reference", "shots", "assets", "exports", "logs"):
        assert (tmp_path / "p" / sub).is_dir()
    reopened.close()


def test_full_roundtrip_with_edits(tmp_path):
    """분석 결과 + 수동 편집(분할/병합/이동) + 설정이 재열기 후 100% 복원된다."""
    root = tmp_path / "프로젝트 폴더"
    service = new_service(root)
    service.apply_detection([2000, 3500, 6000])
    for shot in list(service.shots):
        assert service.apply_keyframes(
            shot.id, shot.start_ms, shot.end_ms, {"start": {"file": "keyframe_start.jpg", "time_ms": shot.start_ms}}
        )
    service.split(5000)
    service.merge(0)
    service.move_boundary(1, 5500)
    service.set_detect_params(DetectParams(adaptive_threshold=4.5, min_scene_len_frames=12))
    service.set_status(AnalysisStatus.READY)
    before, project_id = snapshot(service), service.project.id
    assert [(s[2], s[3]) for s in before] == [(0, 3500), (3500, 5500), (5500, 6000), (6000, 10_000)]
    service.close()

    reopened = ProjectService(ProjectRepository.open(root))
    assert snapshot(reopened) == before
    assert reopened.project.id == project_id and reopened.project.name == "테스트 광고"
    assert reopened.project.status == AnalysisStatus.READY
    assert reopened.project.detect_params.adaptive_threshold == 4.5
    assert reopened.project.detect_params.min_scene_len_frames == 12
    assert reopened.project.timeline.fps_num == 30000
    ref = reopened.reference
    assert ref.sha256 == "ab" * 32 and ref.original_name == "광고.mp4" and ref.warnings == ["경고 1"]
    assert ref.info == fake_info()
    assert ref.detected_cuts_ms == [2000, 3500, 6000]  # 자동 감지 원본은 수동 편집과 별도로 보존
    # 새 쇼트 id가 기존 id와 겹치지 않는다(재열기 후에도 시퀀스 유지)
    assert reopened.repo.allocate_shot_id() not in {s[0] for s in before}
    reopened.close()


def test_restore_detected_discards_manual_edits(tmp_path):
    service = new_service(tmp_path / "p")
    service.apply_detection([2000, 6000])
    service.split(4000)
    assert len(service.shots) == 4
    service.restore_detected()
    assert [(s.start_ms, s.end_ms, s.source) for s in service.shots] == [
        (0, 2000, "auto"), (2000, 6000, "auto"), (6000, 10_000, "auto")
    ]
    service.close()


def test_json_mirrors_written(tmp_path):
    root = tmp_path / "p"
    service = new_service(root)
    service.apply_detection([1850])
    doc = json.loads((root / "project.json").read_text(encoding="utf-8"))
    assert doc["schema_version"] == "1.0" and doc["title"] == "테스트 광고"
    assert doc["shot_ids"] == [s.id for s in service.shots]
    assert doc["reference"]["sha256"] == "ab" * 32
    shot_doc = json.loads((root / "shots" / f"shot_{service.shots[0].id}" / "analysis.json").read_text(encoding="utf-8"))
    assert shot_doc["reference_interval"] == {"start_ms": 0, "end_ms": 1850}
    assert shot_doc["display_frames"] == {"start": 0, "end_exclusive": 55}  # 29.97fps 타임라인
    export = service.repo.export_document()
    assert len(export["shots"]) == 2
    assert export["shots"][-1]["display_frames"]["end_exclusive"] == 300  # 10초 @ 29.97 = 300프레임
    service.close()


def test_merge_removes_shot_folder_and_split_marks_manual(tmp_path):
    root = tmp_path / "p"
    service = new_service(root)
    service.apply_detection([2000, 6000])
    second = service.shots[1].id
    assert (root / "shots" / f"shot_{second}").is_dir()
    service.merge(0)
    assert not (root / "shots" / f"shot_{second}").exists()
    doc = json.loads((root / "shots" / f"shot_{service.shots[0].id}" / "analysis.json").read_text(encoding="utf-8"))
    assert doc["manual_override"]["edited"] is True and doc["manual_override"]["edited_at"]
    service.close()


def test_invalid_edit_leaves_project_untouched(tmp_path):
    service = new_service(tmp_path / "p")
    service.apply_detection([2000, 6000])
    before = snapshot(service)
    with pytest.raises(ShotEditError):
        service.split(2001)  # 경계에서 1ms: 한 프레임보다 짧은 쇼트가 생김
    with pytest.raises(ShotEditError):
        service.move_boundary(0, 9000)
    with pytest.raises(ShotEditError):
        service.merge(2)
    assert snapshot(service) == before
    service.close()
    reopened = ProjectService(ProjectRepository.open(tmp_path / "p"))
    assert snapshot(reopened) == before
    reopened.close()


def test_stale_keyframe_result_is_ignored(tmp_path):
    service = new_service(tmp_path / "p")
    service.apply_detection([2000])
    first = service.shots[0]
    service.move_boundary(0, 2500)  # 키프레임 작업 도중 경계가 바뀐 상황
    assert not service.apply_keyframes(first.id, 0, 2000, {"start": {"file": "x.jpg", "time_ms": 0}})
    assert service.shots[0].keyframes == {}
    service.close()


@pytest.mark.parametrize("running", [AnalysisStatus.PROBING, AnalysisStatus.DETECTING, AnalysisStatus.ANALYZING])
def test_unfinished_job_marked_interrupted_on_reopen(tmp_path, running):
    service = new_service(tmp_path / "p")
    service.apply_detection([2000])
    before = snapshot(service)
    service.set_status(running)
    service.repo._conn.close()  # 앱이 작업 도중 강제 종료된 상황
    reopened = ProjectService(ProjectRepository.open(tmp_path / "p"))
    assert reopened.project.status == AnalysisStatus.INTERRUPTED
    assert reopened.project.last_error
    assert snapshot(reopened) == before  # 데이터는 보존
    reopened.close()


def test_replacing_reference_clears_shots(tmp_path):
    root = tmp_path / "p"
    service = new_service(root)
    service.apply_detection([2000])
    old_ids = [s.id for s in service.shots]
    service.apply_reference(ReferenceMedia("reference/original.mov", "copy", "b.mov", "cd" * 32, fake_info(5000)))
    assert service.shots == [] and service.duration_ms == 5000
    assert service.project.status == AnalysisStatus.IMPORTED
    assert not any((root / "shots" / f"shot_{i}").exists() for i in old_ids)
    service.close()


def test_linked_reference_keeps_absolute_path(tmp_path):
    service = new_service(tmp_path / "p")
    outside = tmp_path / "elsewhere" / "ad.mp4"
    assert service.paths.to_stored_path(outside) == str(outside.resolve())
    assert service.paths.to_stored_path(tmp_path / "p" / "reference" / "original.mp4") == "reference/original.mp4"
    assert service.paths.from_stored_path("reference/original.mp4") == tmp_path / "p" / "reference" / "original.mp4"
    service.close()


def test_project_folder_can_be_moved(tmp_path):
    service = new_service(tmp_path / "before")
    service.apply_detection([2000])
    before = snapshot(service)
    service.close()
    (tmp_path / "before").rename(tmp_path / "after")
    moved = ProjectService(ProjectRepository.open(tmp_path / "after"))
    assert snapshot(moved) == before
    assert moved.reference_path() == tmp_path / "after" / "reference" / "original.mp4"
    moved.close()


def test_open_errors(tmp_path):
    with pytest.raises(ProjectError):
        ProjectRepository.open(tmp_path / "nope")
    (tmp_path / "broken").mkdir()
    (tmp_path / "broken" / "project.db").write_bytes(b"this is not sqlite" * 100)
    with pytest.raises(ProjectError):
        ProjectRepository.open(tmp_path / "broken")
    ProjectRepository.create(tmp_path / "ok", "a", TimelineSettings()).close()
    with pytest.raises(ProjectError):
        ProjectRepository.create(tmp_path / "ok", "b", TimelineSettings())  # 덮어쓰기 금지
    (tmp_path / "busy").mkdir()
    (tmp_path / "busy" / "file.txt").write_text("x")
    with pytest.raises(ProjectError):
        ProjectRepository.create(tmp_path / "busy", "c", TimelineSettings())
    with pytest.raises(ProjectError):
        ProjectRepository.create(tmp_path / "noname", "   ", TimelineSettings())


def test_newer_db_version_rejected(tmp_path):
    ProjectRepository.create(tmp_path / "p", "a", TimelineSettings()).close()
    conn = sqlite3.connect(tmp_path / "p" / "project.db")
    conn.execute("PRAGMA user_version = 99")
    conn.commit()
    conn.close()
    with pytest.raises(ProjectError, match="새로운 버전"):
        ProjectRepository.open(tmp_path / "p")


def test_atomic_write_keeps_old_file_on_failure(tmp_path):
    target = tmp_path / "data.json"
    atomic_write_json(target, {"v": 1})
    with pytest.raises(TypeError):
        atomic_write_json(target, {"v": object()})  # 직렬화 실패
    assert json.loads(target.read_text(encoding="utf-8")) == {"v": 1}
    assert [p.name for p in tmp_path.iterdir()] == ["data.json"]  # 임시 파일 없음


def test_settings_recent_projects(tmp_path):
    settings = Settings(tmp_path / "home")
    for i in range(12):
        settings.add_recent(tmp_path / f"p{i}")
    settings.add_recent(tmp_path / "p5")
    again = Settings(tmp_path / "home")
    assert len(again.recent_projects) == 10
    assert again.recent_projects[0] == str((tmp_path / "p5").resolve())
    (tmp_path / "home" / "settings.json").write_text("{broken", encoding="utf-8")
    assert Settings(tmp_path / "home").recent_projects == []  # 깨진 설정 파일로 앱이 죽지 않는다
