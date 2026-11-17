"""원본 영상 플레이어 (QMediaPlayer + 탐색/프레임 이동 컨트롤)."""

from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt, QTimer, QUrl, Signal
from PySide6.QtMultimedia import QAudioOutput, QMediaPlayer
from PySide6.QtMultimediaWidgets import QVideoWidget
from PySide6.QtWidgets import (
    QHBoxLayout,
    QLabel,
    QPushButton,
    QSizePolicy,
    QSlider,
    QStyle,
    QVBoxLayout,
    QWidget,
)

from ...domain.timebase import format_ms


class VideoPlayer(QWidget):
    positionChanged = Signal(int)  # ms

    def __init__(self, parent: QWidget | None = None):
        super().__init__(parent)
        self._frame_ms = 1000 / 30
        self._duration = 0
        self._pending_seek: int | None = None
        self._show_first_frame = False  # load() 직후 한 번만 첫 프레임을 띄운다

        self._player = QMediaPlayer(self)
        self._audio = QAudioOutput(self)
        self._player.setAudioOutput(self._audio)
        self._video = QVideoWidget(self)
        self._video.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        self._video.setMinimumSize(320, 180)
        self._player.setVideoOutput(self._video)

        self._message = QLabel("원본 영상을 가져오면 여기에 표시됩니다", self)
        self._message.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._message.setWordWrap(True)
        self._message.setObjectName("playerMessage")

        style = self.style()
        self._play_btn = QPushButton(style.standardIcon(QStyle.StandardPixmap.SP_MediaPlay), "")
        self._play_btn.setToolTip("재생/일시정지 (Space)")
        self._prev_btn = QPushButton("◀ 1f")
        self._prev_btn.setToolTip("한 프레임 뒤로 (←)")
        self._next_btn = QPushButton("1f ▶")
        self._next_btn.setToolTip("한 프레임 앞으로 (→)")
        self._slider = QSlider(Qt.Orientation.Horizontal)
        self._slider.setRange(0, 0)
        self._time = QLabel("00:00.000 / 00:00.000")
        self._time.setMinimumWidth(170)

        controls = QHBoxLayout()
        for widget in (self._play_btn, self._prev_btn, self._next_btn):
            widget.setFocusPolicy(Qt.FocusPolicy.NoFocus)
            controls.addWidget(widget)
        controls.addWidget(self._slider, 1)
        controls.addWidget(self._time)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.addWidget(self._video, 1)
        layout.addWidget(self._message)
        layout.addLayout(controls)

        self._play_btn.clicked.connect(self.toggle)
        self._prev_btn.clicked.connect(lambda: self.step(-1))
        self._next_btn.clicked.connect(lambda: self.step(1))
        self._slider.sliderMoved.connect(self._player.setPosition)
        self._player.positionChanged.connect(self._on_position)
        self._player.durationChanged.connect(self._on_duration)
        self._player.playbackStateChanged.connect(self._on_state)
        self._player.mediaStatusChanged.connect(self._on_media_status)
        self._player.errorOccurred.connect(self._on_error)
        self._set_enabled(False)

    # ---------- 공개 API ----------
    def load(self, path: Path, frame_ms: float, duration_ms: int) -> None:
        self._frame_ms = frame_ms or 1000 / 30
        self._duration = duration_ms
        self._message.hide()
        self._slider.setRange(0, duration_ms)
        self._show_first_frame = True
        self._player.setSource(QUrl.fromLocalFile(str(path)))
        self._set_enabled(True)
        self._update_time(0)

    def unload(self) -> None:
        """파일 핸들을 놓는다 (Windows에서 원본 교체 전에 필요)."""
        self._show_first_frame = False
        self._pending_seek = None
        self._player.stop()
        self._player.setSource(QUrl())
        self._set_enabled(False)
        self._slider.setRange(0, 0)
        self._message.setText("원본 영상을 가져오면 여기에 표시됩니다")
        self._message.show()

    def position(self) -> int:
        return int(self._player.position())

    def seek(self, ms: int, play: bool = False) -> None:
        ms = max(0, min(int(ms), max(0, self._duration - 1)))
        if self._player.mediaStatus() in (
            QMediaPlayer.MediaStatus.LoadingMedia,
            QMediaPlayer.MediaStatus.NoMedia,
        ):
            self._pending_seek = ms
        else:
            self._player.setPosition(ms)
        if play:
            self._player.play()

    def step(self, frames: int) -> None:
        self._player.pause()
        self.seek(int(round(self._player.position() + frames * self._frame_ms)))

    def toggle(self) -> None:
        if self._player.playbackState() == QMediaPlayer.PlaybackState.PlayingState:
            self._player.pause()
        else:
            self._player.play()

    def pause(self) -> None:
        self._player.pause()

    # ---------- 내부 ----------
    def _set_enabled(self, enabled: bool) -> None:
        for widget in (self._play_btn, self._prev_btn, self._next_btn, self._slider):
            widget.setEnabled(enabled)

    def _update_time(self, ms: int) -> None:
        self._time.setText(f"{format_ms(ms)} / {format_ms(self._duration)}")

    def _on_position(self, ms: int) -> None:
        if not self._slider.isSliderDown():
            self._slider.setValue(ms)
        self._update_time(ms)
        self.positionChanged.emit(int(ms))

    def _on_duration(self, ms: int) -> None:
        if ms > 0:
            self._slider.setRange(0, int(ms))

    def _on_state(self, state: QMediaPlayer.PlaybackState) -> None:
        playing = state == QMediaPlayer.PlaybackState.PlayingState
        icon = QStyle.StandardPixmap.SP_MediaPause if playing else QStyle.StandardPixmap.SP_MediaPlay
        self._play_btn.setIcon(self.style().standardIcon(icon))

    def _on_media_status(self, status: QMediaPlayer.MediaStatus) -> None:
        if status == QMediaPlayer.MediaStatus.LoadedMedia:
            # stop()/setSource() 도중에도 이 신호가 온다. 그 안에서 플레이어를 다시 호출하면
            # Qt 백엔드가 교착될 수 있으므로, 새로 불러온 직후에만 이벤트 루프로 미뤄서 처리한다.
            if self._show_first_frame:
                self._show_first_frame = False
                QTimer.singleShot(0, self._present_first_frame)
        elif status == QMediaPlayer.MediaStatus.InvalidMedia:
            self._show_error("이 영상을 재생할 수 없습니다 (코덱 미지원). 분석과 썸네일은 계속 사용할 수 있습니다.")

    def _present_first_frame(self) -> None:
        """첫 프레임을 보여 주기 위해 일시정지 상태로 전환하고 대기 중인 탐색을 적용한다."""
        if self._player.source().isEmpty():
            return  # 그 사이 unload됨
        if self._player.playbackState() == QMediaPlayer.PlaybackState.StoppedState:
            self._player.pause()
        if self._pending_seek is not None:
            self._player.setPosition(self._pending_seek)
            self._pending_seek = None

    def _on_error(self, error: QMediaPlayer.Error, text: str) -> None:
        if error != QMediaPlayer.Error.NoError:
            self._show_error(f"재생 오류: {text or error.name}")

    def _show_error(self, text: str) -> None:
        self._message.setText(text)
        self._message.show()
