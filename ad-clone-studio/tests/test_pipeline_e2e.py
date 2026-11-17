"""실제 영상으로 가져오기 -> 감지 -> 키프레임 -> 저장 -> 재열기 전체 과정을 검증한다."""

import hashlib
import json

import pytest

from adclone import cli
from adclone.analysis import pipeline
from adclone.devtools.make_sample import PROFILES
from adclone.domain.errors import JobCancelled, MediaProbeError
from adclone.domain.models import AnalysisStatus, TimelineSettings
from adclone.jobs.progress import JobContext
from adclone.project.repository import ProjectRepository
from adclone.project.service import ProjectService


def test_cli_analyze_and_reopen(samples, tmp_path, capsys):
    root = tmp_path / "프로젝트"
    assert cli.main(["analyze", str(samples["hardcuts"]), "--project", str(root)]) == 0
    assert "READY" in capsys.readouterr().out

    service = ProjectService(ProjectRepository.open(root))
    spec = PROFILES["hardcuts"]
    assert service.project.status == AnalysisStatus.READY
    assert len(service.shots) == len(spec.durations)
    for shot, expected_start in zip(service.shots, [0, *[int(t * 1000) for t in spec.cut_times]]):
        assert abs(shot.start_ms - expected_start) <= 40
        for name in ("start", "middle", "end"):
            path = service.keyframe_path(shot, name)
            assert path is not None and path.stat().st_size > 0
            assert shot.start_ms <= shot.keyframes[name]["time_ms"] < shot.end_ms
    assert service.shots[-1].end_ms == service.duration_ms
    # 원본은 프로젝트로 복사되고 해시가 일치한다
    copied = service.require_reference_file()
    assert copied == root / "reference" / "original.mp4"
    digest = hashlib.sha256(samples["hardcuts"].read_bytes()).hexdigest()
    assert service.reference.sha256 == digest == hashlib.sha256(copied.read_bytes()).hexdigest()
    assert service.keyframe_jobs() == []
    assert (root / "logs" / "jobs.log").read_text(encoding="utf-8").count("status ->") >= 4
    service.close()

    assert cli.main(["show", str(root), "--json"]) == 0
    doc = json.loads(capsys.readouterr().out)
    assert len(doc["shots"]) == len(spec.durations) and doc["analysis"]["status"] == "READY"


def test_cli_link_mode_does_not_copy(samples, tmp_path):
    root = tmp_path / "linked"
    assert cli.main(["analyze", str(samples["portrait"]), "--project", str(root), "--link"]) == 0
    service = ProjectService(ProjectRepository.open(root))
    assert service.reference.storage == "link"
    assert service.reference_path() == samples["portrait"].resolve()
    assert list((root / "reference").iterdir()) == []
    assert len(service.shots) == len(PROFILES["portrait"].durations)
    service.close()


def test_cli_bad_input_reports_error_and_keeps_project(bad_files, samples, tmp_path, capsys):
    root = tmp_path / "p"
    assert cli.main(["analyze", str(samples["rotated"]), "--project", str(root)]) == 0
    capsys.readouterr()
    assert cli.main(["analyze", str(bad_files["text"]), "--project", str(root)]) == 1
    assert "영상 파일로 읽을 수 없습니다" in capsys.readouterr().err
    service = ProjectService(ProjectRepository.open(root))
    # 실패는 기록되지만 이전 분석 결과(영상, 쇼트)는 그대로 남는다
    assert service.project.status == AnalysisStatus.FAILED and service.project.last_error
    assert service.reference.original_name == "rotated.mov"
    assert len(service.shots) == len(PROFILES["rotated"].durations)
    assert service.require_reference_file().is_file()
    service.close()


def test_cli_missing_project_and_file(tmp_path, capsys):
    assert cli.main(["show", str(tmp_path / "none")]) == 1
    assert cli.main(["analyze", str(tmp_path / "none.mp4"), "--project", str(tmp_path / "p")]) == 1
    assert "찾을 수 없습니다" in capsys.readouterr().err


def test_import_failure_leaves_reference_dir_clean(bad_files, tools, tmp_path):
    repo = ProjectRepository.create(tmp_path / "p", "a", TimelineSettings())
    with pytest.raises(MediaProbeError):
        pipeline.import_reference(bad_files["text"], repo.paths, "copy", tools, JobContext())
    assert list(repo.paths.reference_dir.iterdir()) == []
    repo.close()


def test_import_cancel_leaves_no_partial_copy(samples, tools, tmp_path):
    repo = ProjectRepository.create(tmp_path / "p", "a", TimelineSettings())
    ctx = JobContext()
    ctx._emit = lambda name, payload: ctx.cancel.cancel() if name == "IMPORT_STARTED" else None
    with pytest.raises(JobCancelled):
        pipeline.import_reference(samples["hardcuts"], repo.paths, "copy", tools, ctx)
    assert list(repo.paths.reference_dir.iterdir()) == []
    repo.close()


def test_missing_keyframes_are_requeued(samples, tmp_path):
    root = tmp_path / "p"
    assert cli.main(["analyze", str(samples["rotated"]), "--project", str(root)]) == 0
    service = ProjectService(ProjectRepository.open(root))
    victim = service.shots[1]
    service.keyframe_path(victim, "middle").unlink()  # 사용자가 파일을 지운 상황
    jobs = service.keyframe_jobs()
    assert [j.shot_id for j in jobs] == [victim.id]
    service.close()


def test_reference_file_missing_is_explained(samples, tmp_path):
    root = tmp_path / "p"
    assert cli.main(["analyze", str(samples["single"]), "--project", str(root)]) == 0
    (root / "reference" / "original.mp4").unlink()
    service = ProjectService(ProjectRepository.open(root))
    assert len(service.shots) == 1  # 쇼트 정보는 열린다
    with pytest.raises(Exception, match="원본 영상 파일을 찾을 수 없습니다"):
        service.require_reference_file()
    service.close()


def test_cli_survives_console_that_cannot_print_korean(samples, tmp_path):
    """Windows에서 출력이 cp1252 같은 인코딩으로 연결돼도 한글 메시지 때문에 죽지 않는다."""
    import os
    import subprocess
    import sys

    from pathlib import Path

    src = str(Path(__file__).resolve().parents[1] / "src")  # 패키지를 설치하지 않은 환경에서도 실행되게
    env = {**os.environ, "PYTHONIOENCODING": "ascii", "PYTHONUTF8": "0"}
    env["PYTHONPATH"] = os.pathsep.join(filter(None, [src, env.get("PYTHONPATH")]))
    result = subprocess.run(
        [sys.executable, "-m", "adclone.cli", "analyze", str(samples["single"]), "--project", str(tmp_path / "p")],
        capture_output=True, env=env, timeout=120,
    )
    assert result.returncode == 0, result.stderr.decode("ascii", "replace")
    assert b"READY" in result.stdout
