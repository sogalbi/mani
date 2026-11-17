"""쇼트 타임라인: 쇼트 블록, 경계 드래그, 재생 위치 표시."""

from __future__ import annotations

from PySide6.QtCore import QPointF, QRectF, QSize, Qt, Signal
from PySide6.QtGui import QColor, QFont, QMouseEvent, QPainter, QPen, QPolygonF
from PySide6.QtWidgets import QSizePolicy, QWidget

from ...domain.models import Shot
from ...domain.timebase import format_ms

_RULER_H = 20
_HANDLE_PX = 6
_COLORS = (QColor("#3b6ea8"), QColor("#4d8a6a"))
_SHORT = QColor("#b4533c")
_SELECTED = QColor("#f5c542")
_PLAYHEAD = QColor("#ff4d4d")


class TimelineWidget(QWidget):
    seekRequested = Signal(int)  # ms
    shotClicked = Signal(int)  # index
    boundaryDragging = Signal(int)  # 드래그 중 ms (플레이어 미리보기용)
    boundaryMoved = Signal(int, int)  # (왼쪽 쇼트 index, 새 ms)

    def __init__(self, parent: QWidget | None = None):
        super().__init__(parent)
        self._shots: list[Shot] = []
        self._duration = 0
        self._frame_ms = 1000 / 30
        self._min_len = 1
        self._short_ms = 300
        self._selected = -1
        self._playhead = 0
        self._drag_index: int | None = None
        self._drag_ms = 0
        self._editable = True
        self.setMouseTracking(True)
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)

    def sizeHint(self) -> QSize:
        return QSize(600, 78)

    def minimumSizeHint(self) -> QSize:
        return QSize(200, 78)

    # ---------- 데이터 ----------
    def set_data(self, shots: list[Shot], duration_ms: int, frame_ms: float, min_len_ms: int, short_ms: int) -> None:
        self._shots = shots
        self._duration = duration_ms
        self._frame_ms = frame_ms or 1000 / 30
        self._min_len = min_len_ms
        self._short_ms = short_ms
        self._drag_index = None
        self._selected = min(self._selected, len(shots) - 1)
        self.update()

    def set_selected(self, index: int) -> None:
        if index != self._selected:
            self._selected = index
            self.update()

    def set_playhead(self, ms: int) -> None:
        if ms != self._playhead:
            self._playhead = ms
            self.update()

    def set_editable(self, editable: bool) -> None:
        self._editable = editable
        if not editable:
            self._drag_index = None
            self.unsetCursor()

    # ---------- 좌표 ----------
    def _x(self, ms: float) -> float:
        return (ms / self._duration) * (self.width() - 1) if self._duration else 0.0

    def _ms(self, x: float) -> int:
        if not self._duration or self.width() <= 1:
            return 0
        ms = max(0.0, min(1.0, x / (self.width() - 1))) * self._duration
        snapped = round(round(ms / self._frame_ms) * self._frame_ms)  # 원본 프레임 격자에 스냅
        return int(max(0, min(self._duration, snapped)))

    def _boundary_at(self, x: float) -> int | None:
        best, best_dist = None, _HANDLE_PX + 1
        for i in range(len(self._shots) - 1):
            dist = abs(self._x(self._shots[i].end_ms) - x)
            if dist < best_dist:
                best, best_dist = i, dist
        return best

    def _clamp_drag(self, index: int, ms: int) -> int:
        low = self._shots[index].start_ms + self._min_len
        high = self._shots[index + 1].end_ms - self._min_len
        return max(low, min(high, ms)) if low <= high else self._shots[index].end_ms

    # ---------- 마우스 ----------
    def mousePressEvent(self, event: QMouseEvent) -> None:
        if event.button() != Qt.MouseButton.LeftButton or not self._duration:
            return
        x = event.position().x()
        boundary = self._boundary_at(x) if self._editable and event.position().y() > _RULER_H else None
        if boundary is not None:
            self._drag_index = boundary
            self._drag_ms = self._shots[boundary].end_ms
            return
        ms = self._ms(x)
        for i, shot in enumerate(self._shots):
            if shot.start_ms <= ms < shot.end_ms:
                self.shotClicked.emit(i)
                break
        self.seekRequested.emit(min(ms, self._duration - 1))

    def mouseMoveEvent(self, event: QMouseEvent) -> None:
        x = event.position().x()
        if self._drag_index is not None:
            self._drag_ms = self._clamp_drag(self._drag_index, self._ms(x))
            self.boundaryDragging.emit(self._drag_ms)
            self.update()
            return
        over = self._editable and event.position().y() > _RULER_H and self._boundary_at(x) is not None
        self.setCursor(Qt.CursorShape.SizeHorCursor if over else Qt.CursorShape.ArrowCursor)

    def mouseReleaseEvent(self, event: QMouseEvent) -> None:
        if self._drag_index is None:
            return
        index, ms = self._drag_index, self._drag_ms
        self._drag_index = None
        self.update()
        if ms != self._shots[index].end_ms:
            self.boundaryMoved.emit(index, ms)

    # ---------- 그리기 ----------
    def paintEvent(self, _event) -> None:
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, False)
        w, h = self.width(), self.height()
        painter.fillRect(self.rect(), QColor("#1b1d21"))
        if not self._duration:
            painter.setPen(QColor("#8a8f98"))
            painter.drawText(self.rect(), Qt.AlignmentFlag.AlignCenter, "분석 후 쇼트 타임라인이 표시됩니다")
            return

        # 눈금
        font = QFont(self.font())
        font.setPointSizeF(max(7.0, font.pointSizeF() - 1.5))
        painter.setFont(font)
        seconds = self._duration / 1000
        step = next((s for s in (0.5, 1, 2, 5, 10, 30) if w / max(seconds / s, 1e-9) >= 55), 60)
        t = 0.0
        while t <= seconds + 1e-9:
            x = int(self._x(t * 1000))
            painter.setPen(QColor("#5a606b"))
            painter.drawLine(x, _RULER_H - 6, x, _RULER_H)
            painter.setPen(QColor("#aab0ba"))
            label = f"{t:g}s"
            painter.drawText(min(x + 3, w - 30), _RULER_H - 7, label)
            t += step

        # 쇼트 블록
        top, bottom = _RULER_H + 2, h - 4
        for i, shot in enumerate(self._shots):
            start, end = shot.start_ms, shot.end_ms
            if self._drag_index is not None:
                if i == self._drag_index:
                    end = self._drag_ms
                elif i == self._drag_index + 1:
                    start = self._drag_ms
            x0, x1 = self._x(start), self._x(end)
            rect = QRectF(x0 + 1, top, max(1.0, x1 - x0 - 1), bottom - top)
            color = _SHORT if shot.duration_ms < self._short_ms else _COLORS[i % 2]
            painter.fillRect(rect, color)
            if shot.source == "manual":  # 수동 편집 표시(왼쪽 위 삼각형)
                painter.setPen(Qt.PenStyle.NoPen)
                painter.setBrush(QColor("#ffd27a"))
                painter.drawPolygon(
                    QPolygonF([rect.topLeft(), rect.topLeft() + QPointF(9, 0), rect.topLeft() + QPointF(0, 9)])
                )
            if i == self._selected:
                painter.setPen(QPen(_SELECTED, 2))
                painter.setBrush(Qt.BrushStyle.NoBrush)
                painter.drawRect(rect.adjusted(1, 1, -1, -1))
            if rect.width() > 22:
                painter.setPen(QColor("#ffffff"))
                painter.drawText(rect.adjusted(5, 2, -2, -2), Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter, str(i + 1))

        if self._drag_index is not None:
            x = int(self._x(self._drag_ms))
            painter.setPen(QPen(_SELECTED, 2))
            painter.drawLine(x, top - 2, x, bottom + 2)
            painter.setPen(QColor("#ffffff"))
            painter.drawText(min(x + 6, w - 70), top + 12, format_ms(self._drag_ms))

        # 재생 위치
        x = int(self._x(self._playhead))
        painter.setPen(QPen(_PLAYHEAD, 1))
        painter.drawLine(x, 0, x, h)
