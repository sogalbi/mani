"""GUI 진입점."""

from __future__ import annotations

import logging
import sys

from . import APP_NAME, __version__
from .config import Settings, setup_logging

STYLE = """
QWidget { font-size: 10pt; }
QGroupBox { border: 1px solid #3a3d44; border-radius: 6px; margin-top: 12px; padding: 10px 8px 8px 8px; }
QGroupBox::title { subcontrol-origin: margin; left: 10px; padding: 0 4px; color: #c9ced6; }
QPushButton { padding: 5px 12px; }
#homeTitle { font-size: 22pt; font-weight: 600; }
#homeSubtitle, #hint { color: #9aa0aa; }
#warning { color: #ffb38a; }
#statusBanner { background: #26292f; border-radius: 6px; padding: 8px 10px; }
#keyframe { background: #101114; border: 1px solid #3a3d44; }
#playerMessage { color: #9aa0aa; padding: 6px; }
QListWidget::item:selected { background: #35507a; }
"""


def apply_dark_theme(app) -> None:
    from PySide6.QtGui import QColor, QPalette

    app.setStyle("Fusion")
    palette = QPalette()
    roles = {
        QPalette.ColorRole.Window: "#1f2126",
        QPalette.ColorRole.WindowText: "#e6e8eb",
        QPalette.ColorRole.Base: "#17181c",
        QPalette.ColorRole.AlternateBase: "#22252a",
        QPalette.ColorRole.Text: "#e6e8eb",
        QPalette.ColorRole.Button: "#2c2f36",
        QPalette.ColorRole.ButtonText: "#e6e8eb",
        QPalette.ColorRole.ToolTipBase: "#2c2f36",
        QPalette.ColorRole.ToolTipText: "#e6e8eb",
        QPalette.ColorRole.Highlight: "#3d6fb4",
        QPalette.ColorRole.HighlightedText: "#ffffff",
        QPalette.ColorRole.PlaceholderText: "#7d838d",
        QPalette.ColorRole.Link: "#7fb0f0",
    }
    for role, color in roles.items():
        palette.setColor(role, QColor(color))
    for role in (QPalette.ColorRole.Text, QPalette.ColorRole.ButtonText, QPalette.ColorRole.WindowText):
        palette.setColor(QPalette.ColorGroup.Disabled, role, QColor("#6b7078"))
    app.setPalette(palette)
    app.setStyleSheet(STYLE)


def main(argv: list[str] | None = None) -> int:
    log_path = setup_logging()
    log = logging.getLogger("adclone")
    log.info("%s %s starting (log: %s)", APP_NAME, __version__, log_path)
    try:
        from PySide6.QtWidgets import QApplication, QMessageBox
    except ImportError as exc:
        print(f"PySide6를 불러올 수 없습니다: {exc}\n'pip install -r requirements.lock' 을 실행하세요.", file=sys.stderr)
        return 1

    from .ui.main_window import MainWindow

    app = QApplication(sys.argv if argv is None else argv)
    app.setApplicationName(APP_NAME)
    app.setApplicationVersion(__version__)
    apply_dark_theme(app)

    def excepthook(exc_type, exc, tb) -> None:
        # 슬롯에서 난 예외로 앱이 조용히 죽지 않게 기록하고 알린다 (프로젝트 데이터는 DB에 이미 저장됨)
        log.error("unhandled exception", exc_info=(exc_type, exc, tb))
        QMessageBox.critical(None, "예상하지 못한 오류", f"{exc_type.__name__}: {exc}\n\n자세한 내용은 로그를 확인하세요:\n{log_path}")

    sys.excepthook = excepthook
    window = MainWindow(Settings())
    window.show()
    try:
        window.get_tools()
    except Exception as exc:  # noqa: BLE001 - FFmpeg가 없어도 앱은 뜬다
        QMessageBox.warning(window, "FFmpeg 필요", f"{exc}\n\n프로젝트는 열 수 있지만 영상 가져오기/분석은 FFmpeg가 있어야 합니다.")
    return app.exec()
