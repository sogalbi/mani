"""화면 A. 프로젝트 홈: 새 프로젝트 / 기존 프로젝트 / 최근 10개."""

from __future__ import annotations

import json
import re
from pathlib import Path

from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QColor
from PySide6.QtWidgets import (
    QComboBox,
    QFileDialog,
    QFormLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from ..config import Settings
from ..domain.models import STATUS_LABELS_KO, AnalysisStatus, TimelineSettings
from ..project.storage import PROJECT_JSON, is_project_dir

_ASPECTS = [("9:16 세로 (1080×1920)", 1080, 1920), ("16:9 가로 (1920×1080)", 1920, 1080)]
_FPS = [("30", 30, 1), ("29.97", 30000, 1001), ("25", 25, 1), ("24", 24, 1), ("60", 60, 1)]
_INVALID = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def safe_folder_name(name: str) -> str:
    """Windows에서 쓸 수 없는 문자를 제거한 폴더 이름."""
    cleaned = _INVALID.sub("_", name).strip().rstrip(". ")
    return cleaned or "project"


def unique_dir(parent: Path, name: str) -> Path:
    base = safe_folder_name(name)
    candidate, n = parent / base, 2
    while candidate.exists():
        candidate = parent / f"{base}_{n}"
        n += 1
    return candidate


def read_project_summary(root: Path) -> tuple[str, str, int]:
    """project.json에서 (이름, 상태 라벨, 쇼트 수)를 읽는다. DB를 열지 않아 빠르다."""
    try:
        doc = json.loads((root / PROJECT_JSON).read_text(encoding="utf-8"))
        status = AnalysisStatus(doc.get("analysis", {}).get("status", "NOT_IMPORTED"))
        return str(doc.get("title") or root.name), STATUS_LABELS_KO[status], len(doc.get("shot_ids") or [])
    except (OSError, ValueError, KeyError):
        return root.name, "상태 알 수 없음", 0


class HomePage(QWidget):
    createRequested = Signal(str, object, object)  # name, Path(parent dir), TimelineSettings
    openRequested = Signal(object)  # Path

    def __init__(self, settings: Settings, parent: QWidget | None = None):
        super().__init__(parent)
        self._settings = settings

        title = QLabel("AD CLONE STUDIO")
        title.setObjectName("homeTitle")
        subtitle = QLabel("광고 레퍼런스의 쇼트 구성과 타이밍을 분석합니다 · M0–M1 (프로젝트 / 분석)")
        subtitle.setObjectName("homeSubtitle")

        # 새 프로젝트
        new_box = QGroupBox("새 프로젝트")
        self.name_edit = QLineEdit()
        self.name_edit.setPlaceholderText("예: 신발 광고 A")
        self.aspect_combo = QComboBox()
        for label, w, h in _ASPECTS:
            self.aspect_combo.addItem(label, (w, h))
        self.fps_combo = QComboBox()
        for label, num, den in _FPS:
            self.fps_combo.addItem(f"{label} fps", (num, den))
        self.location_edit = QLineEdit(str(settings.projects_root))
        browse = QPushButton("찾아보기…")
        browse.clicked.connect(self._browse_location)
        loc_row = QHBoxLayout()
        loc_row.addWidget(self.location_edit, 1)
        loc_row.addWidget(browse)
        self.create_btn = QPushButton("프로젝트 만들기")
        self.create_btn.setDefault(True)
        self.create_btn.clicked.connect(self._create)
        self.name_edit.returnPressed.connect(self._create)
        form = QFormLayout(new_box)
        form.addRow("프로젝트 이름", self.name_edit)
        form.addRow("결과물 형태", self.aspect_combo)
        form.addRow("결과물 fps", self.fps_combo)
        form.addRow("저장 위치", loc_row)
        form.addRow("", self.create_btn)
        note = QLabel("결과물 형태/fps는 타임코드의 프레임 표시와 이후 렌더링(M4) 기준으로 쓰입니다.")
        note.setWordWrap(True)
        note.setObjectName("hint")
        form.addRow(note)

        # 최근 프로젝트
        recent_box = QGroupBox("최근 프로젝트")
        self.recent_list = QListWidget()
        self.recent_list.itemActivated.connect(self._open_item)
        self.recent_list.itemDoubleClicked.connect(self._open_item)
        open_btn = QPushButton("선택한 프로젝트 열기")
        open_btn.clicked.connect(lambda: self._open_item(self.recent_list.currentItem()))
        open_other = QPushButton("기존 프로젝트 폴더 열기…")
        open_other.clicked.connect(self._open_other)
        remove_btn = QPushButton("목록에서 제거")
        remove_btn.clicked.connect(self._remove_recent)
        buttons = QHBoxLayout()
        buttons.addWidget(open_btn)
        buttons.addWidget(open_other)
        buttons.addStretch(1)
        buttons.addWidget(remove_btn)
        recent_layout = QVBoxLayout(recent_box)
        recent_layout.addWidget(self.recent_list, 1)
        recent_layout.addLayout(buttons)

        columns = QHBoxLayout()
        left = QVBoxLayout()
        left.addWidget(new_box)
        left.addStretch(1)
        columns.addLayout(left, 2)
        columns.addWidget(recent_box, 3)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(28, 24, 28, 24)
        layout.addWidget(title)
        layout.addWidget(subtitle)
        layout.addSpacing(12)
        layout.addLayout(columns, 1)
        self.refresh()

    def refresh(self) -> None:
        self.recent_list.clear()
        for path_text in self._settings.recent_projects:
            root = Path(path_text)
            item = QListWidgetItem()
            item.setData(Qt.ItemDataRole.UserRole, path_text)
            if is_project_dir(root):
                name, status, shots = read_project_summary(root)
                item.setText(f"{name}   ·   {status}   ·   쇼트 {shots}개\n{root}")
            else:
                item.setText(f"{root.name}   ·   찾을 수 없음\n{root}")
                item.setForeground(QColor("#8a8f98"))
            self.recent_list.addItem(item)
        if self.recent_list.count():
            self.recent_list.setCurrentRow(0)

    def _browse_location(self) -> None:
        chosen = QFileDialog.getExistingDirectory(self, "프로젝트 저장 위치", self.location_edit.text())
        if chosen:
            self.location_edit.setText(chosen)

    def _create(self) -> None:
        w, h = self.aspect_combo.currentData()
        num, den = self.fps_combo.currentData()
        self.createRequested.emit(
            self.name_edit.text(),
            Path(self.location_edit.text().strip() or str(self._settings.projects_root)),
            TimelineSettings(width=w, height=h, fps_num=num, fps_den=den),
        )

    def _open_item(self, item: QListWidgetItem | None) -> None:
        if item is not None:
            self.openRequested.emit(Path(item.data(Qt.ItemDataRole.UserRole)))

    def _open_other(self) -> None:
        chosen = QFileDialog.getExistingDirectory(self, "프로젝트 폴더 선택", str(self._settings.projects_root))
        if chosen:
            self.openRequested.emit(Path(chosen))

    def _remove_recent(self) -> None:
        item = self.recent_list.currentItem()
        if item is not None:
            self._settings.remove_recent(item.data(Qt.ItemDataRole.UserRole))
            self.refresh()
