"""화면 B. 원본 분석: 플레이어, 메타데이터, 쇼트 타임라인/목록, 경계 편집."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Callable

from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QKeySequence, QPixmap, QShortcut
from PySide6.QtWidgets import (
    QDoubleSpinBox,
    QFileDialog,
    QFormLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QMessageBox,
    QPushButton,
    QScrollArea,
    QSpinBox,
    QSplitter,
    QVBoxLayout,
    QWidget,
)

from ..analysis import pipeline
from ..domain import events
from ..domain.errors import AdCloneError
from ..domain.models import STATUS_LABELS_KO, AnalysisStatus, DetectParams, Shot
from ..domain.shot_ops import index_at
from ..domain.timebase import format_ms, format_timecode
from ..ingest.ffmpeg import FFmpegTools
from ..jobs.worker import JobRunner
from ..project.service import SHORT_SHOT_MS, ProjectService
from ..project.storage import atomic_write_json
from .widgets.shot_strip import ShotStrip
from .widgets.timeline import TimelineWidget
from .widgets.video_player import VideoPlayer

log = logging.getLogger(__name__)
_KEYFRAME_LABELS = (("start", "시작"), ("middle", "중간"), ("end", "끝"))


def _human_size(size: int | None) -> str:
    if not size:
        return "-"
    value = float(size)
    for unit in ("B", "KB", "MB", "GB"):
        if value < 1024 or unit == "GB":
            return f"{value:.1f} {unit}" if unit != "B" else f"{int(value)} B"
        value /= 1024
    return "-"


class AnalysisPage(QWidget):
    statusMessage = Signal(str)
    projectChanged = Signal()  # 제목/상태 표시 갱신용

    def __init__(self, runner: JobRunner, get_tools: Callable[[], FFmpegTools], parent: QWidget | None = None):
        super().__init__(parent)
        self.runner = runner
        self._get_tools = get_tools
        self.service: ProjectService | None = None
        self._selected = -1
        self._loaded_video: Path | None = None

        # ---- 도구 모음 ----
        self.import_btn = QPushButton("영상 가져오기…")
        self.analyze_btn = QPushButton("분석 시작")
        self.split_btn = QPushButton("현재 위치에서 분할 (S)")
        self.merge_btn = QPushButton("다음 쇼트와 병합 (M)")
        self.restore_btn = QPushButton("자동 감지 결과로 되돌리기")
        self.export_btn = QPushButton("분석 JSON 내보내기…")
        self.threshold_spin = QDoubleSpinBox()
        self.threshold_spin.setRange(0.5, 20.0)
        self.threshold_spin.setSingleStep(0.5)
        self.threshold_spin.setDecimals(1)
        self.threshold_spin.setToolTip("AdaptiveDetector 임계값. 낮출수록 컷을 더 많이 찾습니다(오검출 증가).")
        self.minlen_spin = QSpinBox()
        self.minlen_spin.setRange(1, 120)
        self.minlen_spin.setSuffix(" f")
        self.minlen_spin.setToolTip("감지할 쇼트의 최소 길이(프레임). 빠른 컷이 많은 광고는 낮게 설정하세요.")
        bar = QHBoxLayout()
        for widget in (self.import_btn, self.analyze_btn):
            bar.addWidget(widget)
        bar.addSpacing(8)
        bar.addWidget(QLabel("감도"))
        bar.addWidget(self.threshold_spin)
        bar.addWidget(QLabel("최소 길이"))
        bar.addWidget(self.minlen_spin)
        bar.addSpacing(16)
        for widget in (self.split_btn, self.merge_btn, self.restore_btn):
            bar.addWidget(widget)
        bar.addStretch(1)
        bar.addWidget(self.export_btn)

        # ---- 플레이어 ----
        self.player = VideoPlayer()

        # ---- 우측 정보 ----
        self.status_label = QLabel()
        self.status_label.setWordWrap(True)
        self.status_label.setObjectName("statusBanner")
        self.meta_box = QGroupBox("원본 메타데이터")
        self.meta_form = QFormLayout(self.meta_box)
        self.meta_form.setLabelAlignment(Qt.AlignmentFlag.AlignRight)
        self._meta_values: dict[str, QLabel] = {}
        for key in ("파일", "컨테이너", "길이", "해상도", "회전", "프레임레이트", "프레임 수", "영상 코덱", "오디오", "비트레이트", "파일 크기", "SHA-256", "보관 방식"):
            label = QLabel("-")
            label.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
            label.setWordWrap(True)
            self._meta_values[key] = label
            self.meta_form.addRow(key, label)
        self.warning_label = QLabel()
        self.warning_label.setWordWrap(True)
        self.warning_label.setObjectName("warning")
        self.meta_form.addRow(self.warning_label)

        self.shot_box = QGroupBox("선택한 쇼트")
        self.shot_title = QLabel("쇼트를 선택하세요")
        self.start_spin = QDoubleSpinBox()
        self.end_spin = QDoubleSpinBox()
        for spin in (self.start_spin, self.end_spin):
            spin.setDecimals(3)
            spin.setSuffix(" s")
            spin.setKeyboardTracking(False)
        self.apply_btn = QPushButton("경계 적용")
        self.start_from_player = QPushButton("← 현재 위치")
        self.start_from_player.setToolTip("플레이어의 현재 위치를 시작 시각으로 입력")
        self.end_from_player = QPushButton("← 현재 위치")
        self.end_from_player.setToolTip("플레이어의 현재 위치를 끝 시각으로 입력")
        self.shot_info = QLabel("-")
        self.shot_info.setWordWrap(True)
        start_row = QHBoxLayout()
        start_row.addWidget(self.start_spin, 1)
        start_row.addWidget(self.start_from_player)
        end_row = QHBoxLayout()
        end_row.addWidget(self.end_spin, 1)
        end_row.addWidget(self.end_from_player)
        shot_form = QFormLayout()
        shot_form.addRow("시작", start_row)
        shot_form.addRow("끝", end_row)
        shot_form.addRow("", self.apply_btn)
        self._keyframe_labels: dict[str, QLabel] = {}
        frames_row = QHBoxLayout()
        for key, caption in _KEYFRAME_LABELS:
            column = QVBoxLayout()
            image = QLabel("—")
            image.setAlignment(Qt.AlignmentFlag.AlignCenter)
            image.setFixedSize(112, 112)
            image.setObjectName("keyframe")
            text = QLabel(caption)
            text.setAlignment(Qt.AlignmentFlag.AlignCenter)
            column.addWidget(image)
            column.addWidget(text)
            frames_row.addLayout(column)
            self._keyframe_labels[key] = image
        frames_row.addStretch(1)
        shot_layout = QVBoxLayout(self.shot_box)
        shot_layout.addWidget(self.shot_title)
        shot_layout.addLayout(shot_form)
        shot_layout.addWidget(self.shot_info)
        shot_layout.addLayout(frames_row)

        side = QWidget()
        side_layout = QVBoxLayout(side)
        side_layout.setContentsMargins(4, 0, 4, 0)
        side_layout.addWidget(self.status_label)
        side_layout.addWidget(self.shot_box)
        side_layout.addWidget(self.meta_box)
        side_layout.addStretch(1)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setWidget(side)
        scroll.setMinimumWidth(390)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)

        splitter = QSplitter(Qt.Orientation.Horizontal)
        splitter.addWidget(self.player)
        splitter.addWidget(scroll)
        splitter.setStretchFactor(0, 3)
        splitter.setStretchFactor(1, 2)

        # ---- 하단 ----
        self.timeline = TimelineWidget()
        self.strip = ShotStrip()

        layout = QVBoxLayout(self)
        layout.addLayout(bar)
        layout.addWidget(splitter, 1)
        layout.addWidget(self.timeline)
        layout.addWidget(self.strip)

        # ---- 연결 ----
        self.import_btn.clicked.connect(self.choose_and_import)
        self.analyze_btn.clicked.connect(lambda: self.start_detection(confirm=True))
        self.split_btn.clicked.connect(self.split_at_playhead)
        self.merge_btn.clicked.connect(self.merge_selected)
        self.restore_btn.clicked.connect(self.restore_detected)
        self.export_btn.clicked.connect(self.export_json)
        self.apply_btn.clicked.connect(self.apply_spin_bounds)
        self.start_from_player.clicked.connect(lambda: self.start_spin.setValue(self.player.position() / 1000))
        self.end_from_player.clicked.connect(lambda: self.end_spin.setValue(self.player.position() / 1000))
        self.player.positionChanged.connect(self._on_player_position)
        self.timeline.seekRequested.connect(lambda ms: self.player.seek(ms))
        self.timeline.shotClicked.connect(self.select_shot)
        self.timeline.boundaryDragging.connect(lambda ms: self.player.seek(ms))
        self.timeline.boundaryMoved.connect(self.move_boundary)
        self.strip.shotActivated.connect(self._on_strip_activated)
        self.runner.ended.connect(lambda _kind: self._update_enabled())
        self.runner.started.connect(lambda _title: self._update_enabled())
        for key, slot in (("S", self.split_at_playhead), ("M", self.merge_selected), ("Space", self.player.toggle),
                          ("Left", lambda: self.player.step(-1)), ("Right", lambda: self.player.step(1))):
            shortcut = QShortcut(QKeySequence(key), self)
            shortcut.setContext(Qt.ShortcutContext.WidgetWithChildrenShortcut)
            shortcut.activated.connect(slot)
        self._update_enabled()

    # ================= 프로젝트 연결 =================
    def set_service(self, service: ProjectService | None) -> None:
        self.player.unload()
        self._loaded_video = None
        self.service = service
        self._selected = -1
        if service is not None:
            params = service.project.detect_params
            self.threshold_spin.setValue(params.adaptive_threshold)
            self.minlen_spin.setValue(params.min_scene_len_frames)
        self.refresh_all()
        if service is not None and service.shots and service.keyframe_jobs():
            # 이전에 중단되었거나 파일이 지워진 키프레임을 다시 만든다
            self.start_keyframes()

    def refresh_all(self) -> None:
        self._refresh_meta()
        self._refresh_shots()
        self._refresh_status()
        self._load_player()
        self._update_enabled()

    # ================= 표시 갱신 =================
    def _refresh_status(self) -> None:
        if not self.service:
            self.status_label.setText("")
            return
        project = self.service.project
        text = f"<b>{STATUS_LABELS_KO[project.status]}</b>"
        if self.service.shots:
            manual = sum(1 for s in self.service.shots if s.source == "manual")
            short = sum(1 for s in self.service.shots if self.service.is_short(s))
            text += f" · 쇼트 {len(self.service.shots)}개"
            if manual:
                text += f" · 수동 편집 {manual}개"
            if short:
                text += f" · <span style='color:#ff9d7a'>⚠ 짧은 쇼트 {short}개 (검토 필요)</span>"
        if project.last_error:
            text += f"<br><span style='color:#ff9d7a'>{project.last_error}</span>"
        self.status_label.setText(text)
        self.analyze_btn.setText("분석 재실행" if self.service.shots else "분석 시작")
        self.projectChanged.emit()

    def _refresh_meta(self) -> None:
        ref = self.service.reference if self.service else None
        if not ref:
            for label in self._meta_values.values():
                label.setText("-")
            self.warning_label.setText("")
            return
        info = ref.info
        values = {
            "파일": ref.original_name,
            "컨테이너": info.format_name,
            "길이": f"{format_ms(info.duration_ms)}  ({info.duration_ms / 1000:.3f}초)",
            "해상도": f"{info.display_width}×{info.display_height}"
            + (f"  (인코딩 {info.width}×{info.height})" if info.rotation in (90, 270) else ""),
            "회전": f"{info.rotation}°" if info.rotation else "없음",
            "프레임레이트": f"{info.fps:.3f} fps  (avg {info.avg_frame_rate}, r {info.r_frame_rate})"
            + ("  · VFR 의심" if info.is_vfr_suspected else ""),
            "프레임 수": str(info.nb_frames) if info.nb_frames else "-",
            "영상 코덱": f"{info.video_codec}" + (f" / {info.pix_fmt}" if info.pix_fmt else ""),
            "오디오": f"{info.audio_codec}, {info.audio_sample_rate} Hz, {info.audio_channels}ch" if info.has_audio else "없음",
            "비트레이트": f"{info.bit_rate / 1000:.0f} kb/s" if info.bit_rate else "-",
            "파일 크기": _human_size(info.size_bytes),
            "SHA-256": ref.sha256[:16] + "…",
            "보관 방식": "프로젝트에 복사" if ref.storage == "copy" else f"원본 위치 참조: {ref.path}",
        }
        for key, value in values.items():
            self._meta_values[key].setText(value)
        self._meta_values["SHA-256"].setToolTip(ref.sha256)
        self.warning_label.setText("\n".join("⚠ " + w for w in ref.warnings))

    def _refresh_shots(self) -> None:
        service = self.service
        shots = service.shots if service else []
        if service and service.reference:
            self.timeline.set_data(
                shots, service.duration_ms, service.reference.info.frame_duration_ms, service.min_shot_ms, SHORT_SHOT_MS
            )
        else:
            self.timeline.set_data([], 0, 1000 / 30, 1, SHORT_SHOT_MS)
        if self._selected >= len(shots):
            self._selected = len(shots) - 1
        if shots and self._selected < 0:
            self._selected = 0
        self.strip.set_shots(
            shots,
            lambda s: service.keyframe_path(s, "middle") if service else None,
            lambda s: service.is_short(s) if service else False,
            self._selected,
        )
        self.timeline.set_selected(self._selected)
        self._refresh_detail()

    def _refresh_detail(self) -> None:
        service = self.service
        shot = self.current_shot()
        for label in self._keyframe_labels.values():
            label.setPixmap(QPixmap())
            label.setText("—")
        if not service or shot is None:
            self.shot_title.setText("쇼트를 선택하세요")
            self.shot_info.setText("-")
            for spin in (self.start_spin, self.end_spin):
                spin.blockSignals(True)
                spin.setRange(0, 0)
                spin.setValue(0)
                spin.blockSignals(False)
            return
        tb = service.project.timeline.timebase
        frames = service.repo.frame_ranges(service.shots)[shot.id]
        source = "수동 편집" if shot.source == "manual" else "자동 감지"
        self.shot_title.setText(f"<b>쇼트 {shot.ordinal + 1}</b> / {len(service.shots)}  ·  {shot.id}  ·  {source}")
        step = service.reference.info.frame_duration_ms / 1000
        for spin, value in ((self.start_spin, shot.start_ms), (self.end_spin, shot.end_ms)):
            spin.blockSignals(True)
            spin.setRange(0, service.duration_ms / 1000)
            spin.setSingleStep(step)
            spin.setValue(value / 1000)
            spin.blockSignals(False)
        text = (
            f"길이 {shot.duration_ms / 1000:.3f}초  ·  타임코드 {format_timecode(shot.start_ms, tb)} – "
            f"{format_timecode(shot.end_ms, tb)}\n출력 프레임 {frames[0]} – {frames[1]} "
            f"({frames[1] - frames[0]}f @ {float(tb.fps):.2f}fps)"
        )
        if service.is_short(shot):
            text += "\n⚠ 매우 짧은 쇼트: 플래시/오검출 여부를 확인하세요"
        self.shot_info.setText(text)
        for key, _caption in _KEYFRAME_LABELS:
            path = service.keyframe_path(shot, key)
            label = self._keyframe_labels[key]
            if path:
                pixmap = QPixmap(str(path)).scaled(
                    label.size(), Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation
                )
                label.setPixmap(pixmap)
                label.setToolTip(f"{format_ms(shot.keyframes[key]['time_ms'])}\n{path}")
        self._update_enabled()

    def _load_player(self) -> None:
        service = self.service
        path = service.reference_path() if service else None
        if not service or not path:
            if self._loaded_video is not None:
                self.player.unload()
                self._loaded_video = None
            return
        if path == self._loaded_video:
            return
        if not path.is_file():
            self.player.unload()
            self._loaded_video = None
            self.statusMessage.emit(f"원본 영상 파일을 찾을 수 없습니다: {path}")
            return
        self.player.load(path, service.reference.info.frame_duration_ms, service.duration_ms)
        self._loaded_video = path

    def _update_enabled(self) -> None:
        service = self.service
        busy = self.runner.busy
        has_ref = bool(service and service.reference)
        shots = service.shots if service else []
        shot = self.current_shot()
        self.import_btn.setEnabled(bool(service) and not busy)
        self.analyze_btn.setEnabled(has_ref and not busy)
        self.threshold_spin.setEnabled(has_ref and not busy)
        self.minlen_spin.setEnabled(has_ref and not busy)
        self.split_btn.setEnabled(bool(shots) and not busy)
        self.merge_btn.setEnabled(shot is not None and self._selected < len(shots) - 1 and not busy)
        self.restore_btn.setEnabled(
            has_ref and service.reference.detected_cuts_ms is not None and not busy
            and any(s.source == "manual" for s in shots)
        )
        self.export_btn.setEnabled(bool(shots))
        self.timeline.set_editable(not busy)
        editable = shot is not None and not busy
        self.start_spin.setEnabled(editable and self._selected > 0)
        self.start_from_player.setEnabled(editable and self._selected > 0)
        self.end_spin.setEnabled(editable and self._selected < len(shots) - 1)
        self.end_from_player.setEnabled(editable and self._selected < len(shots) - 1)
        self.apply_btn.setEnabled(editable and len(shots) > 1)

    # ================= 선택/재생 =================
    def current_shot(self) -> Shot | None:
        if self.service and 0 <= self._selected < len(self.service.shots):
            return self.service.shots[self._selected]
        return None

    def select_shot(self, index: int) -> None:
        if not self.service or not (0 <= index < len(self.service.shots)):
            return
        if index != self._selected:
            self._selected = index
            self.strip.select(index)
            self.timeline.set_selected(index)
            self._refresh_detail()

    def _on_strip_activated(self, index: int) -> None:
        """쇼트를 누르면 그 위치부터 재생한다."""
        self.select_shot(index)
        shot = self.current_shot()
        if shot:
            self.player.seek(shot.start_ms, play=True)

    def _on_player_position(self, ms: int) -> None:
        self.timeline.set_playhead(ms)
        if self.service and self.service.shots and not self.runner.busy:
            index = index_at(self.service.shots, ms)
            if index != self._selected:
                self.select_shot(index)

    # ================= 오류/확인 =================
    def _error(self, message: str, title: str = "오류") -> None:
        log.warning("%s: %s", title, message)
        self.statusMessage.emit(message.splitlines()[0])
        QMessageBox.warning(self, title, message)

    def _tools(self) -> FFmpegTools | None:
        try:
            return self._get_tools()
        except AdCloneError as exc:
            self._error(str(exc), "FFmpeg를 찾을 수 없음")
            return None

    def _guard_busy(self) -> bool:
        if self.runner.busy:
            self.statusMessage.emit("다른 작업이 진행 중입니다. 끝나거나 취소한 뒤 다시 시도하세요.")
            return True
        return False

    # ================= 가져오기 =================
    def choose_and_import(self) -> None:
        if not self.service or self._guard_busy():
            return
        path_text, _ = QFileDialog.getOpenFileName(
            self, "원본 광고 영상 선택", "", "영상 파일 (*.mp4 *.mov *.m4v);;모든 파일 (*)"
        )
        if not path_text:
            return
        if self.service.shots:
            answer = QMessageBox.question(
                self, "영상 교체",
                "새 영상을 가져오면 현재 쇼트 목록과 수동 편집 내용이 모두 삭제됩니다.\n계속할까요?",
            )
            if answer != QMessageBox.StandardButton.Yes:
                return
        box = QMessageBox(self)
        box.setWindowTitle("원본 보관 방식")
        box.setText("원본 영상을 어떻게 보관할까요?")
        box.setInformativeText(
            "프로젝트에 복사: 프로젝트 폴더를 옮겨도 열립니다 (권장).\n"
            "원본 위치 참조: 복사하지 않습니다. 원본 파일을 옮기거나 지우면 열 수 없습니다.\n\n"
            "어느 쪽이든 원본 파일은 수정하지 않습니다."
        )
        copy_btn = box.addButton("프로젝트에 복사", QMessageBox.ButtonRole.AcceptRole)
        link_btn = box.addButton("원본 위치 참조", QMessageBox.ButtonRole.ActionRole)
        box.addButton(QMessageBox.StandardButton.Cancel)
        box.exec()
        if box.clickedButton() not in (copy_btn, link_btn):
            return
        self.import_video(Path(path_text), "copy" if box.clickedButton() is copy_btn else "link")

    def import_video(self, source: Path, storage: str = "copy") -> bool:
        """검증 -> 해시/복사 -> (성공 시) 자동으로 쇼트 감지까지 이어서 실행한다."""
        service = self.service
        if not service or self._guard_busy():
            return False
        tools = self._tools()
        if tools is None:
            return False
        previous = service.project.status
        previous_error = service.project.last_error
        # Windows는 열려 있는 파일을 교체할 수 없으므로 플레이어를 먼저 닫는다
        self.player.unload()
        self._loaded_video = None
        service.set_status(AnalysisStatus.PROBING)
        self._refresh_status()
        service.log_job(f"import start: {source} ({storage})")

        def restore(message: str | None) -> None:
            # 가져오기에 실패/취소해도 기존 프로젝트 데이터는 그대로 유지한다
            service.set_status(previous, previous_error)
            self.refresh_all()
            if message:
                service.log_job(f"import failed: {message}", error=True)
                self._error(message, "영상을 가져올 수 없습니다")
            else:
                self.statusMessage.emit("가져오기를 취소했습니다")

        def done(ref) -> None:
            service.apply_reference(ref)
            self._selected = -1
            self.refresh_all()
            self.start_detection(confirm=False)

        return self.runner.start(
            "영상 가져오는 중",
            lambda ctx: pipeline.import_reference(source, service.paths, storage, tools, ctx),
            on_done=done,
            on_failed=restore,
            on_cancelled=lambda: restore(None),
        )

    # ================= 쇼트 감지 =================
    def start_detection(self, confirm: bool = True) -> bool:
        service = self.service
        if not service or self._guard_busy():
            return False
        try:
            video = service.require_reference_file()
        except AdCloneError as exc:
            self._error(str(exc))
            return False
        if confirm and any(s.source == "manual" for s in service.shots):
            answer = QMessageBox.question(
                self, "분석 재실행",
                "분석을 다시 실행하면 수동으로 편집한 쇼트 경계가 자동 감지 결과로 바뀝니다.\n계속할까요?",
            )
            if answer != QMessageBox.StandardButton.Yes:
                return False
        params = DetectParams.from_dict(service.project.detect_params.to_dict())
        params.adaptive_threshold = self.threshold_spin.value()
        params.min_scene_len_frames = self.minlen_spin.value()
        service.set_detect_params(params)
        info = service.reference.info
        service.set_status(AnalysisStatus.DETECTING)
        self._refresh_status()

        def done(cuts) -> None:
            service.apply_detection(cuts)
            self._selected = 0
            self._refresh_shots()
            self.start_keyframes()

        return self.runner.start(
            "쇼트 감지 중",
            lambda ctx: pipeline.detect(video, info, params, ctx),
            on_done=done,
            on_failed=self._analysis_failed,
            on_cancelled=self._analysis_cancelled,
        )

    def _analysis_failed(self, message: str) -> None:
        if self.service:
            self.service.set_status(AnalysisStatus.FAILED, message)
        self._refresh_status()
        self._error(message + "\n\n기존 프로젝트 데이터는 유지됩니다. [분석 재실행]으로 다시 시도할 수 있습니다.", "분석 실패")

    def _analysis_cancelled(self) -> None:
        if self.service:
            self.service.set_status(AnalysisStatus.CANCELLED)
        self._refresh_status()
        self.statusMessage.emit("작업을 취소했습니다. [분석 재실행]으로 다시 시작할 수 있습니다.")

    # ================= 키프레임 =================
    def start_keyframes(self) -> bool:
        service = self.service
        if not service or self.runner.busy:
            return False
        jobs = service.keyframe_jobs(only_missing=True)
        if not jobs:
            if service.shots and service.project.status != AnalysisStatus.READY:
                service.set_status(AnalysisStatus.READY)
            self._refresh_status()
            return False
        try:
            video = service.require_reference_file()
            tools = self._get_tools()
        except AdCloneError as exc:
            service.set_status(AnalysisStatus.FAILED, str(exc))
            self._refresh_status()
            self.statusMessage.emit(str(exc).splitlines()[0])
            return False
        frame_ms = service.reference.info.frame_duration_ms
        service.set_status(AnalysisStatus.ANALYZING)
        self._refresh_status()

        def on_event(name: str, payload: dict) -> None:
            if name != events.ANALYZE_SHOT_DONE or self.service is not service:
                return
            if service.apply_keyframes(payload["shot_id"], payload["start_ms"], payload["end_ms"], payload["keyframes"]):
                for index, shot in enumerate(service.shots):
                    if shot.id == payload["shot_id"]:
                        self.strip.update_shot(index, shot, service.keyframe_path(shot), service.is_short(shot))
                        if index == self._selected:
                            self._refresh_detail()

        def done(_result) -> None:
            service.set_status(AnalysisStatus.READY)
            self._refresh_status()
            self.statusMessage.emit(f"분석 완료: 쇼트 {len(service.shots)}개")

        return self.runner.start(
            "키프레임 생성 중",
            lambda ctx: pipeline.make_keyframes(video, jobs, service.paths, frame_ms, tools, ctx),
            on_done=done,
            on_failed=self._analysis_failed,
            on_cancelled=self._analysis_cancelled,
            on_event=on_event,
        )

    # ================= 수동 편집 =================
    def _edit(self, action: Callable[[], object], select: int | None = None) -> bool:
        if not self.service or self._guard_busy():
            return False
        try:
            action()
        except AdCloneError as exc:
            self._error(str(exc), "경계를 편집할 수 없습니다")
            self._refresh_shots()  # 일부만 적용됐을 수 있으므로 저장된 상태로 다시 그린다
            return False
        if select is not None:
            self._selected = select
        self._refresh_shots()
        self._refresh_status()
        self.start_keyframes()
        return True

    def split_at_playhead(self) -> bool:
        if not self.service or not self.service.shots:
            return False
        frame = self.service.reference.info.frame_duration_ms
        ms = int(round(round(self.player.position() / frame) * frame))
        index = index_at(self.service.shots, ms)
        return self._edit(lambda: self.service.split(ms), select=index + 1)

    def merge_selected(self) -> bool:
        index = self._selected
        return self._edit(lambda: self.service.merge(index), select=index)

    def move_boundary(self, index: int, new_ms: int) -> bool:
        return self._edit(lambda: self.service.move_boundary(index, new_ms))

    def apply_spin_bounds(self) -> bool:
        shot = self.current_shot()
        if shot is None:
            return False
        index = self._selected
        start, end = int(round(self.start_spin.value() * 1000)), int(round(self.end_spin.value() * 1000))

        def action() -> None:
            if start != shot.start_ms and index > 0:
                self.service.move_boundary(index - 1, start)
            if end != shot.end_ms and index < len(self.service.shots) - 1:
                self.service.move_boundary(index, end)

        return self._edit(action)

    def restore_detected(self) -> bool:
        if not self.service:
            return False
        answer = QMessageBox.question(
            self, "자동 감지 결과로 되돌리기", "수동으로 편집한 경계를 모두 버리고 마지막 자동 감지 결과로 되돌립니다.\n계속할까요?"
        )
        if answer != QMessageBox.StandardButton.Yes:
            return False
        return self._edit(self.service.restore_detected, select=0)

    # ================= 내보내기 =================
    def export_json(self) -> None:
        if not self.service:
            return
        default = self.service.paths.exports_dir / "shot_list.json"
        path_text, _ = QFileDialog.getSaveFileName(self, "분석 JSON 내보내기", str(default), "JSON (*.json)")
        if not path_text:
            return
        try:
            atomic_write_json(Path(path_text), self.service.repo.export_document())
        except OSError as exc:
            self._error(f"파일을 저장할 수 없습니다: {exc}")
            return
        self.statusMessage.emit(f"내보냄: {path_text}")
