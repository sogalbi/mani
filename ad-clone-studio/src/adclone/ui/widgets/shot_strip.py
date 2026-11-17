"""쇼트 목록 스트립: 썸네일 + 시작/끝/길이."""

from __future__ import annotations

from pathlib import Path
from typing import Callable

from PySide6.QtCore import QSize, Qt, Signal
from PySide6.QtGui import QColor, QIcon, QPixmap
from PySide6.QtWidgets import QListView, QListWidget, QListWidgetItem, QWidget

from ...domain.models import Shot
from ...domain.timebase import format_ms

_ICON = QSize(160, 90)


class ShotStrip(QListWidget):
    shotActivated = Signal(int)  # 사용자가 클릭한 쇼트 index

    def __init__(self, parent: QWidget | None = None):
        super().__init__(parent)
        self.setViewMode(QListView.ViewMode.IconMode)
        self.setFlow(QListView.Flow.LeftToRight)
        self.setWrapping(False)
        self.setMovement(QListView.Movement.Static)
        self.setResizeMode(QListView.ResizeMode.Adjust)
        self.setIconSize(_ICON)
        self.setSpacing(6)
        self.setUniformItemSizes(True)
        self.setHorizontalScrollMode(QListView.ScrollMode.ScrollPerPixel)
        self.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.setFixedHeight(_ICON.height() + 92)
        self.itemClicked.connect(lambda item: self.shotActivated.emit(self.row(item)))
        self._placeholder = QPixmap(_ICON)
        self._placeholder.fill(QColor("#2a2d33"))

    def set_shots(
        self,
        shots: list[Shot],
        thumb_path: Callable[[Shot], Path | None],
        is_short: Callable[[Shot], bool],
        selected: int = -1,
    ) -> None:
        self.blockSignals(True)
        self.clear()
        for shot in shots:
            item = QListWidgetItem()
            self._fill(item, shot, thumb_path(shot), is_short(shot))
            self.addItem(item)
        if 0 <= selected < self.count():
            self.setCurrentRow(selected)
        self.blockSignals(False)

    def update_shot(self, index: int, shot: Shot, thumb: Path | None, short: bool) -> None:
        item = self.item(index)
        if item is not None:
            self._fill(item, shot, thumb, short)

    def select(self, index: int) -> None:
        if index != self.currentRow() and 0 <= index < self.count():
            self.blockSignals(True)
            self.setCurrentRow(index)
            self.blockSignals(False)
            self.scrollToItem(self.item(index))

    def _fill(self, item: QListWidgetItem, shot: Shot, thumb: Path | None, short: bool) -> None:
        pixmap = QPixmap(str(thumb)) if thumb else QPixmap()
        if pixmap.isNull():
            pixmap = self._placeholder
        else:
            # 세로 영상도 같은 칸 크기를 쓰도록 레터박스
            canvas = QPixmap(_ICON)
            canvas.fill(QColor("#101114"))
            scaled = pixmap.scaled(_ICON, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
            from PySide6.QtGui import QPainter

            painter = QPainter(canvas)
            painter.drawPixmap((_ICON.width() - scaled.width()) // 2, (_ICON.height() - scaled.height()) // 2, scaled)
            painter.end()
            pixmap = canvas
        item.setIcon(QIcon(pixmap))
        flags = ("  ⚠ 짧음" if short else "") + ("  ✎" if shot.source == "manual" else "")
        item.setText(
            f"#{shot.ordinal + 1}{flags}\n{format_ms(shot.start_ms)} → {format_ms(shot.end_ms)}\n"
            f"{shot.duration_ms / 1000:.3f}s"
        )
        tip = f"쇼트 {shot.ordinal + 1} ({shot.id})"
        if short:
            tip += "\n매우 짧은 쇼트입니다. 플래시/오검출일 수 있으니 확인하세요 (자동 병합하지 않음)."
        if shot.source == "manual":
            tip += "\n경계를 수동으로 편집함"
        item.setToolTip(tip)
        item.setTextAlignment(Qt.AlignmentFlag.AlignHCenter)
        item.setSizeHint(QSize(_ICON.width() + 14, _ICON.height() + 66))
