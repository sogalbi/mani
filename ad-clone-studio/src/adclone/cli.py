"""GUI 없이 분석 파이프라인을 실행하는 CLI (자동화/검증용).

    python -m adclone.cli analyze reference.mp4 --project ./my_project
    python -m adclone.cli show ./my_project
    python -m adclone.cli doctor
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .analysis import pipeline
from .domain.errors import AdCloneError
from .domain.models import AnalysisStatus, TimelineSettings
from .domain.timebase import format_ms
from .ingest.ffmpeg import locate_ffmpeg, tool_version
from .jobs.progress import JobContext
from .project.repository import ProjectRepository
from .project.service import ProjectService
from .project.storage import is_project_dir


def analyze_into(service: ProjectService, source: Path | None, storage: str, tools, ctx: JobContext) -> None:
    """가져오기(선택) -> 감지 -> 키프레임 전체 과정을 동기 실행한다."""
    try:
        if source is not None:
            service.set_status(AnalysisStatus.PROBING)
            service.apply_reference(pipeline.import_reference(source, service.paths, storage, tools, ctx))
        video = service.require_reference_file()
        service.set_status(AnalysisStatus.DETECTING)
        cuts = pipeline.detect(video, service.reference.info, service.project.detect_params, ctx)
        service.apply_detection(cuts)
        service.set_status(AnalysisStatus.ANALYZING)
        jobs = service.keyframe_jobs(only_missing=False)
        done = pipeline.make_keyframes(
            video, jobs, service.paths, service.reference.info.frame_duration_ms, tools, ctx
        )
        for job in jobs:
            service.apply_keyframes(job.shot_id, job.start_ms, job.end_ms, done[job.shot_id])
        service.set_status(AnalysisStatus.READY)
    except AdCloneError as exc:
        service.set_status(AnalysisStatus.FAILED, str(exc))
        raise


def _print_summary(service: ProjectService) -> None:
    print(f"프로젝트: {service.project.name}  [{service.project.status.value}]  {service.root}")
    ref = service.reference
    if not ref:
        print("  (원본 영상 없음)")
        return
    info = ref.info
    print(
        f"  원본: {ref.original_name}  {info.display_width}x{info.display_height} "
        f"{info.fps:.3f}fps  {info.duration_ms / 1000:.3f}s  {info.video_codec}"
        f"{' +' + info.audio_codec if info.has_audio else ' (오디오 없음)'}"
    )
    for warning in ref.warnings:
        print(f"  ! {warning}")
    for shot in service.shots:
        mark = " (수동)" if shot.source == "manual" else ""
        print(
            f"  #{shot.ordinal + 1:02d} {shot.id}  {format_ms(shot.start_ms)} - {format_ms(shot.end_ms)}"
            f"  {shot.duration_ms / 1000:6.3f}s  키프레임 {len(shot.keyframes)}/3{mark}"
        )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="adclone.cli", description="AD CLONE STUDIO CLI")
    sub = parser.add_subparsers(dest="command", required=True)
    p_an = sub.add_parser("analyze", help="영상을 가져와 쇼트를 분석")
    p_an.add_argument("video", type=Path)
    p_an.add_argument("--project", type=Path, required=True, help="프로젝트 폴더(없으면 생성)")
    p_an.add_argument("--name", default=None)
    p_an.add_argument("--link", action="store_true", help="복사하지 않고 원본 위치를 참조")
    p_an.add_argument("--threshold", type=float, default=None)
    p_show = sub.add_parser("show", help="프로젝트 요약 출력")
    p_show.add_argument("project", type=Path)
    p_show.add_argument("--json", action="store_true")
    sub.add_parser("doctor", help="환경 진단")
    ns = parser.parse_args(argv)

    try:
        if ns.command == "doctor":
            tools = locate_ffmpeg()
            print("ffmpeg :", tools.ffmpeg, "|", tool_version(tools.ffmpeg))
            print("ffprobe:", tools.ffprobe, "|", tool_version(tools.ffprobe))
            return 0
        if ns.command == "show":
            service = ProjectService(ProjectRepository.open(ns.project))
            try:
                if ns.json:
                    print(json.dumps(service.repo.export_document(), ensure_ascii=False, indent=2))
                else:
                    _print_summary(service)
            finally:
                service.close()
            return 0
        tools = locate_ffmpeg()
        if is_project_dir(ns.project):
            repo = ProjectRepository.open(ns.project)
        else:
            repo = ProjectRepository.create(ns.project, ns.name or ns.project.name, TimelineSettings())
        service = ProjectService(repo)
        try:
            if ns.threshold is not None:
                params = service.project.detect_params
                params.adaptive_threshold = ns.threshold
                service.set_detect_params(params)
            analyze_into(service, ns.video, "link" if ns.link else "copy", tools, JobContext())
            _print_summary(service)
        finally:
            service.close()
        return 0
    except AdCloneError as exc:
        print(f"오류: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
