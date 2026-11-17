"""메인 윈도우: 홈/분석 화면 전환, 메뉴, 진행률·취소, 환경 진단."""

from __future__ import annotations

import logging
import platform
import sys
from pathlib import Path

from PySide6.QtCore import Qt, QUrl
from PySide6.QtGui import QAction, QCloseEvent, QDesktopServices, QKeySequence
from PySide6.QtWidgets import (
    QDialog,
    QDialogButtonBox,
    QFileDialog,
    QLabel,
    QMainWindow,
    QMessageBox,
    QPlainTextEdit,
    QProgressBar,
    QPushButton,
    QStackedWidget,
    QVBoxLayout,
)

from .. import APP_NAME, __version__
from ..config import Settings, app_home
from ..domain import events
from ..domain.errors import AdCloneError
from ..domain.models import STATUS_LABELS_KO, AnalysisStatus, TimelineSettings
from ..ingest.ffmpeg import FFmpegTools, locate_ffmpeg, tool_version
from ..jobs.worker import JobRunner
from ..project.repository import ProjectRepository
from ..project.service import ProjectService
from .analysis_page import AnalysisPage
from .home_page import HomePage, unique_dir

log = logging.getLogger(__name__)


def diagnostics_text(settings: Settings) -> str:
    """환경 진단 내용. FFmpeg가 없어도 예외 없이 문자열을 만든다."""
    lines = [f"{APP_NAME} {__version__}", f"OS: {platform.platform()}", f"Python: {sys.version.split()[0]} ({sys.executable})"]
    for label, module, attr in (("PySide6", "PySide6", "__version__"), ("OpenCV", "cv2", "__version__"),
                                ("PySceneDetect", "scenedetect", "__version__"), ("NumPy", "numpy", "__version__")):
        try:
            mod = __import__(module)
            lines.append(f"{label}: {getattr(mod, attr, '?')}")
        except Exception as exc:  # noqa: BLE001
            lines.append(f"{label}: 불러오기 실패 ({exc})")
    lines.append("")
    try:
        tools = locate_ffmpeg(settings.ffmpeg_dir)
        lines.append(f"[정상] ffmpeg : {tools.ffmpeg}\n        {tool_version(tools.ffmpeg)}")
        lines.append(f"[정상] ffprobe: {tools.ffprobe}\n        {tool_version(tools.ffprobe)}")
    except AdCloneError as exc:
        lines.append(f"[문제] {exc}")
    lines.append("")
    lines.append(f"FFmpeg 폴더 설정: {settings.ffmpeg_dir or '(지정 안 함 - PATH에서 찾음)'}")
    lines.append(f"설정/로그 폴더: {app_home()}")
    lines.append(f"기본 프로젝트 폴더: {settings.projects_root}")
    return "\n".join(lines)


class DiagnosticsDialog(QDialog):
    def __init__(self, settings: Settings, parent=None):
        super().__init__(parent)
        self._settings = settings
        self.setWindowTitle("환경 진단")
        self.resize(720, 420)
        self.text = QPlainTextEdit()
        self.text.setReadOnly(True)
        pick = QPushButton("FFmpeg 폴더 지정…")
        pick.clicked.connect(self._pick)
        clear = QPushButton("폴더 지정 해제")
        clear.clicked.connect(self._clear)
        logs = QPushButton("로그 폴더 열기")
        logs.clicked.connect(lambda: QDesktopServices.openUrl(QUrl.fromLocalFile(str(app_home() / "logs"))))
        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Close)
        buttons.addButton(pick, QDialogButtonBox.ButtonRole.ActionRole)
        buttons.addButton(clear, QDialogButtonBox.ButtonRole.ActionRole)
        buttons.addButton(logs, QDialogButtonBox.ButtonRole.ActionRole)
        buttons.rejected.connect(self.reject)
        layout = QVBoxLayout(self)
        layout.addWidget(self.text)
        layout.addWidget(buttons)
        self.reload()

    def reload(self) -> None:
        self.text.setPlainText(diagnostics_text(self._settings))

    def _pick(self) -> None:
        chosen = QFileDialog.getExistingDirectory(self, "ffmpeg.exe / ffprobe.exe 가 있는 폴더")
        if chosen:
            self._settings.ffmpeg_dir = chosen
            self.reload()

    def _clear(self) -> None:
        self._settings.ffmpeg_dir = None
        self.reload()


class MainWindow(QMainWindow):
    def __init__(self, settings: Settings | None = None):
        super().__init__()
        self.settings = settings or Settings()
        self.service: ProjectService | None = None
        self.runner = JobRunner(self)
        self.resize(1360, 860)

        self.home = HomePage(self.settings)
        self.analysis = AnalysisPage(self.runner, self.get_tools)
        self.stack = QStackedWidget()
        self.stack.addWidget(self.home)
        self.stack.addWidget(self.analysis)
        self.setCentralWidget(self.stack)

        # 상태 표시줄: 메시지 + 진행률 + 취소
        self.progress = QProgressBar()
        self.progress.setFixedWidth(240)
        self.progress.setTextVisible(True)
        self.progress.hide()
        self.job_label = QLabel()
        self.cancel_btn = QPushButton("취소")
        self.cancel_btn.hide()
        self.cancel_btn.clicked.connect(self._cancel_job)
        self.statusBar().addPermanentWidget(self.job_label)
        self.statusBar().addPermanentWidget(self.progress)
        self.statusBar().addPermanentWidget(self.cancel_btn)

        self._build_menu()
        self.home.createRequested.connect(self.create_project)
        self.home.openRequested.connect(self.open_project)
        self.analysis.statusMessage.connect(lambda text: self.statusBar().showMessage(text, 8000))
        self.analysis.projectChanged.connect(self._update_title)
        self.runner.started.connect(self._job_started)
        self.runner.event.connect(self._job_event)
        self.runner.ended.connect(self._job_ended)
        self._update_title()

    # ---------- 메뉴 ----------
    def _build_menu(self) -> None:
        file_menu = self.menuBar().addMenu("파일(&F)")
        self.act_home = QAction("프로젝트 홈", self, shortcut=QKeySequence("Ctrl+H"), triggered=self.show_home)
        self.act_open = QAction("프로젝트 열기…", self, shortcut=QKeySequence.StandardKey.Open, triggered=self._open_dialog)
        self.act_save = QAction("저장", self, shortcut=QKeySequence.StandardKey.Save, triggered=self.save_project)
        self.act_folder = QAction("프로젝트 폴더 열기", self, triggered=self._open_project_folder)
        self.act_close = QAction("프로젝트 닫기", self, triggered=self.close_project)
        act_quit = QAction("끝내기", self, shortcut=QKeySequence.StandardKey.Quit, triggered=self.close)
        for action in (self.act_home, self.act_open, self.act_save, self.act_folder, self.act_close):
            file_menu.addAction(action)
        file_menu.addSeparator()
        file_menu.addAction(act_quit)
        tools_menu = self.menuBar().addMenu("도구(&T)")
        tools_menu.addAction(QAction("환경 진단…", self, triggered=self.show_diagnostics))

    # ---------- 공통 ----------
    def get_tools(self) -> FFmpegTools:
        return locate_ffmpeg(self.settings.ffmpeg_dir)

    def _update_title(self) -> None:
        has_project = self.service is not None
        for action in (self.act_save, self.act_folder, self.act_close):
            action.setEnabled(has_project)
        if has_project:
            project = self.service.project
            self.setWindowTitle(f"{project.name} — {STATUS_LABELS_KO[project.status]} — {APP_NAME}")
        else:
            self.setWindowTitle(APP_NAME)

    def _error(self, message: str, title: str = "오류") -> None:
        log.warning("%s: %s", title, message)
        QMessageBox.warning(self, title, message)

    # ---------- 프로젝트 ----------
    def create_project(self, name: str, parent_dir: Path, timeline: TimelineSettings) -> bool:
        if not name.strip():
            self._error("프로젝트 이름을 입력하세요.")
            return False
        if not self.close_project():
            return False
        try:
            parent_dir = Path(parent_dir)
            parent_dir.mkdir(parents=True, exist_ok=True)
            repo = ProjectRepository.create(unique_dir(parent_dir, name), name, timeline)
        except (AdCloneError, OSError) as exc:
            self._error(f"프로젝트를 만들 수 없습니다.\n{exc}")
            return False
        self.settings.projects_root = parent_dir
        self._attach(repo)
        return True

    def open_project(self, root: Path) -> bool:
        if self.service is not None and Path(root).resolve() == self.service.root.resolve():
            self.stack.setCurrentWidget(self.analysis)
            return True
        if not self.close_project():
            return False
        try:
            repo = ProjectRepository.open(Path(root))
        except AdCloneError as exc:
            self._error(f"프로젝트를 열 수 없습니다.\n{exc}")
            self.home.refresh()
            return False
        self._attach(repo)
        return True

    def _attach(self, repo: ProjectRepository) -> None:
        self.service = ProjectService(repo)
        self.settings.add_recent(repo.paths.root)
        self.stack.setCurrentWidget(self.analysis)
        self.analysis.set_service(self.service)
        self._update_title()
        if self.service.project.status == AnalysisStatus.INTERRUPTED:
            self.statusBar().showMessage("이전 작업이 중단되었습니다. [분석 재실행]으로 다시 시도할 수 있습니다.", 10000)
        ref_path = self.service.reference_path()
        if ref_path is not None and not ref_path.is_file():
            self._error(
                f"원본 영상 파일을 찾을 수 없습니다:\n{ref_path}\n\n쇼트 정보는 그대로 열립니다. "
                "파일을 원래 위치로 되돌리거나 [영상 가져오기]로 다시 연결하세요.",
                "원본 영상 없음",
            )

    def close_project(self) -> bool:
        """열린 프로젝트를 닫는다. 진행 중인 작업이 있으면 취소 여부를 묻는다."""
        if self.service is None:
            return True
        if self.runner.busy:
            answer = QMessageBox.question(self, "작업 진행 중", "진행 중인 작업을 취소하고 프로젝트를 닫을까요?")
            if answer != QMessageBox.StandardButton.Yes:
                return False
            self._abort_job()
        self.analysis.set_service(None)
        self.service.close()
        self.service = None
        self.home.refresh()
        self.stack.setCurrentWidget(self.home)
        self._update_title()
        return True

    def _abort_job(self) -> None:
        """작업을 취소하고 워커가 끝날 때까지 기다린 뒤 상태를 '중단됨'으로 남긴다."""
        self.runner.cancel()
        self.runner.wait(10000)
        if self.service is not None:
            try:
                self.service.set_status(AnalysisStatus.INTERRUPTED, "작업이 끝나기 전에 프로젝트를 닫았습니다")
            except Exception:  # noqa: BLE001
                log.exception("failed to mark interrupted")

    def save_project(self) -> None:
        """변경 사항은 편집 즉시 DB에 저장된다. 여기서는 JSON 미러를 다시 쓴다."""
        if self.service is None:
            return
        self.service.repo.write_json_mirror()
        self.service.repo.write_shot_json(self.service.shots)
        self.statusBar().showMessage(f"저장됨: {self.service.root}", 5000)

    def show_home(self) -> None:
        self.home.refresh()
        self.stack.setCurrentWidget(self.home)

    def _open_dialog(self) -> None:
        chosen = QFileDialog.getExistingDirectory(self, "프로젝트 폴더 선택", str(self.settings.projects_root))
        if chosen:
            self.open_project(Path(chosen))

    def _open_project_folder(self) -> None:
        if self.service is not None:
            QDesktopServices.openUrl(QUrl.fromLocalFile(str(self.service.root)))

    def show_diagnostics(self) -> None:
        DiagnosticsDialog(self.settings, self).exec()

    # ---------- 작업 진행 표시 ----------
    def _job_started(self, title: str) -> None:
        self.job_label.setText(title)
        self.progress.setRange(0, 0)  # 진행률을 알기 전까지는 불확정 표시
        self.progress.show()
        self.cancel_btn.setEnabled(True)
        self.cancel_btn.show()

    def _job_event(self, name: str, payload: object) -> None:
        data = payload if isinstance(payload, dict) else {}
        if name in (events.IMPORT_PROGRESS, events.DETECT_PROGRESS):
            self.progress.setRange(0, 100)
            self.progress.setValue(int(data.get("fraction", 0) * 100))
        elif name == events.ANALYZE_SHOT_DONE:
            self.progress.setRange(0, int(data.get("total", 1)))
            self.progress.setValue(int(data.get("index", 0)) + 1)
        elif name == events.PROBE_STARTED:
            self.job_label.setText("메타데이터 읽는 중")
        elif name == events.IMPORT_STARTED:
            self.job_label.setText("원본 복사/해시 계산 중")

    def _job_ended(self, _kind: str) -> None:
        if not self.runner.busy:  # 콜백이 다음 작업을 바로 시작했을 수 있다
            self.job_label.setText("")
            self.progress.hide()
            self.cancel_btn.hide()

    def _cancel_job(self) -> None:
        self.cancel_btn.setEnabled(False)
        self.job_label.setText("취소하는 중…")
        self.runner.cancel()

    def closeEvent(self, event: QCloseEvent) -> None:
        if self.runner.busy:
            answer = QMessageBox.question(self, "작업 진행 중", "진행 중인 작업을 취소하고 종료할까요?")
            if answer != QMessageBox.StandardButton.Yes:
                event.ignore()
                return
            self._abort_job()
        if self.service is not None:
            self.analysis.set_service(None)
            self.service.close()
            self.service = None
        event.accept()
