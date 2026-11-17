"""실제 MainWindow를 창 없이(offscreen) 구동하는 GUI 테스트.

위젯/시그널/워커 스레드 경로를 검증한다. 화면에 그려진 모습과 Windows 고유 동작은 검증하지 않는다.
"""

import time

import pytest

pytest.importorskip("PySide6.QtWidgets", exc_type=ImportError)

from PySide6.QtCore import QPoint, QPointF, Qt
from PySide6.QtGui import QMouseEvent
from PySide6.QtWidgets import QApplication, QMessageBox

from adclone.config import Settings
from adclone.devtools.make_sample import PROFILES
from adclone.domain.errors import AdCloneError
from adclone.domain.models import AnalysisStatus, TimelineSettings
from adclone.jobs.worker import JobRunner
from adclone.ui.home_page import safe_folder_name, unique_dir
from adclone.ui.main_window import MainWindow, diagnostics_text


@pytest.fixture(scope="session")
def qapp():
    try:
        app = QApplication.instance() or QApplication([])
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"Qt를 시작할 수 없습니다: {exc}")
    return app


def pump(qapp, condition=lambda: True, timeout=90.0, settle=0.15):
    deadline = time.time() + timeout
    while not condition():
        qapp.processEvents()
        time.sleep(0.005)
        assert time.time() < deadline, "시간 초과"
    end = time.time() + settle
    while time.time() < end:
        qapp.processEvents()
        time.sleep(0.005)


@pytest.fixture
def dialogs(monkeypatch):
    """모달 대화상자를 자동 응답으로 바꾸고 표시된 경고를 기록한다."""
    shown = []
    monkeypatch.setattr(QMessageBox, "question", staticmethod(lambda *a, **k: QMessageBox.StandardButton.Yes))
    monkeypatch.setattr(
        QMessageBox, "warning", staticmethod(lambda _p, title, text, *a, **k: shown.append((title, text)))
    )
    return shown


@pytest.fixture
def window(qapp, tmp_path, dialogs):
    win = MainWindow(Settings(tmp_path / "home"))
    win.show()
    pump(qapp)
    yield win
    if win.runner.busy:
        win.runner.cancel()
        win.runner.wait(10000)
    win.close()
    pump(qapp)


def idle(win):
    return lambda: not win.runner.busy


def bounds(win):
    return [(s.id, s.start_ms, s.end_ms, s.source) for s in win.service.shots]


def analyzed(qapp, win, tmp_path, sample):
    assert win.create_project("UI 테스트", tmp_path / "projects", TimelineSettings())
    assert win.analysis.import_video(sample, "copy")
    pump(qapp, lambda: not win.runner.busy and win.service.project.status == AnalysisStatus.READY)


def test_job_runner_done_failed_cancelled(qapp):
    runner, log = JobRunner(), []
    assert runner.start("ok", lambda ctx: 42, on_done=lambda r: log.append(("done", r)))
    assert not runner.start("busy", lambda ctx: 0, on_done=lambda r: log.append("second"))  # 동시에 하나만
    pump(qapp, lambda: not runner.busy)

    def boom(ctx):
        raise AdCloneError("설명 가능한 오류")

    runner.start("fail", boom, on_done=lambda r: log.append("x"), on_failed=lambda m: log.append(("failed", m)))
    pump(qapp, lambda: not runner.busy)
    runner.start("crash", lambda ctx: 1 / 0, on_done=lambda r: log.append("x"), on_failed=lambda m: log.append(("crash", m)))
    pump(qapp, lambda: not runner.busy)

    def loop(ctx):
        while True:
            ctx.check()
            time.sleep(0.01)

    runner.start("long", loop, on_done=lambda r: log.append("x"), on_cancelled=lambda: log.append("cancelled"))
    pump(qapp, settle=0.1)
    assert runner.busy
    runner.cancel()
    pump(qapp, lambda: not runner.busy)
    assert log[0] == ("done", 42) and log[1] == ("failed", "설명 가능한 오류")
    assert log[2][0] == "crash" and "ZeroDivisionError" in log[2][1]
    assert log[3] == "cancelled" and "second" not in log and "x" not in log


def test_ui_stays_responsive_during_job(qapp):
    """워커가 도는 동안 UI 이벤트 루프가 계속 돈다(프리징 없음)."""
    runner, ticks = JobRunner(), []
    runner.start("sleep", lambda ctx: time.sleep(0.5), on_done=lambda r: None)
    while runner.busy:
        qapp.processEvents()
        ticks.append(time.time())
        time.sleep(0.005)
    gaps = [b - a for a, b in zip(ticks, ticks[1:])]
    assert len(ticks) > 20 and max(gaps) < 0.25


def test_create_import_analyze_shows_shots(qapp, window, tmp_path, samples, dialogs):
    analyzed(qapp, window, tmp_path, samples["hardcuts"])
    page, service = window.analysis, window.service
    expected = len(PROFILES["hardcuts"].durations)
    assert len(service.shots) == expected and page.strip.count() == expected
    assert window.stack.currentWidget() is page
    assert "분석 완료" in window.windowTitle() and "UI 테스트" in window.windowTitle()
    assert all(not page.strip.item(i).icon().isNull() for i in range(expected))
    assert "00:02.000" in page.strip.item(1).text()
    assert page._meta_values["해상도"].text().startswith("1280×720")
    assert "h264" in page._meta_values["영상 코덱"].text()
    assert not window.progress.isVisible() and not window.cancel_btn.isVisible()
    assert dialogs == []
    # 쇼트 클릭 -> 해당 위치로 이동 + 선택
    page._on_strip_activated(3)
    pump(qapp, settle=0.4)
    page.player.pause()
    assert page._selected == 3 and "쇼트 4" in page.shot_title.text()
    assert page.player.position() >= service.shots[3].start_ms - 50
    assert all(label.pixmap() and not label.pixmap().isNull() for label in page._keyframe_labels.values())


def test_edit_split_merge_move_and_reopen(qapp, window, tmp_path, samples, dialogs):
    analyzed(qapp, window, tmp_path, samples["hardcuts"])
    page = window.analysis
    count = len(window.service.shots)

    page.player.seek(4500)
    pump(qapp, lambda: abs(page.player.position() - 4500) < 5, settle=0.3)
    assert page.split_at_playhead()
    pump(qapp, idle(window))
    assert len(window.service.shots) == count + 1 and page.strip.count() == count + 1
    assert (window.service.shots[2].end_ms, window.service.shots[3].start_ms) == (4500, 4500)

    page.select_shot(4)
    assert page.merge_selected()
    pump(qapp, idle(window))
    assert len(window.service.shots) == count

    assert page.move_boundary(0, 1800)
    pump(qapp, idle(window))
    assert window.service.shots[0].end_ms == 1800

    # 숫자 입력으로 경계 편집
    page.select_shot(1)
    page.end_spin.setValue(3.4)
    assert page.apply_spin_bounds()
    pump(qapp, idle(window))
    assert (window.service.shots[1].end_ms, window.service.shots[2].start_ms) == (3400, 3400)

    # 편집 후 모든 쇼트의 키프레임이 다시 채워지고 상태는 READY
    assert window.service.keyframe_jobs() == []
    assert window.service.project.status == AnalysisStatus.READY
    assert "수동 편집" in page.status_label.text()

    # 잘못된 편집은 거부되고 데이터는 그대로
    before = bounds(window)
    assert not page.move_boundary(0, 11_000)
    assert dialogs and dialogs[-1][0] == "경계를 편집할 수 없습니다"
    assert bounds(window) == before

    root = window.service.root
    assert window.close_project()
    assert window.stack.currentWidget() is window.home
    assert window.home.recent_list.count() == 1 and "UI 테스트" in window.home.recent_list.item(0).text()
    assert window.open_project(root)
    pump(qapp, idle(window))
    assert bounds(window) == before
    assert window.analysis.strip.count() == len(before)
    assert window.service.project.status == AnalysisStatus.READY

    # 자동 감지 결과로 되돌리기
    assert window.analysis.restore_detected()
    pump(qapp, idle(window))
    assert all(s.source == "auto" for s in window.service.shots)
    assert [s.start_ms for s in window.service.shots[1:]] == window.service.reference.detected_cuts_ms


def test_timeline_drag_moves_boundary(qapp, window, tmp_path, samples):
    analyzed(qapp, window, tmp_path, samples["hardcuts"])
    timeline = window.analysis.timeline
    y = timeline.height() - 20

    def mouse(kind, x, buttons=Qt.MouseButton.LeftButton):
        pos = QPointF(x, y)
        button = Qt.MouseButton.NoButton if kind == QMouseEvent.Type.MouseMove else Qt.MouseButton.LeftButton
        event = QMouseEvent(kind, pos, timeline.mapToGlobal(QPoint(int(x), y)).toPointF(), button, buttons, Qt.KeyboardModifier.NoModifier)
        QApplication.sendEvent(timeline, event)

    x_from, x_to = timeline._x(2000), timeline._x(2600)
    mouse(QMouseEvent.Type.MouseButtonPress, x_from)
    mouse(QMouseEvent.Type.MouseMove, x_to)
    mouse(QMouseEvent.Type.MouseButtonRelease, x_to, Qt.MouseButton.NoButton)
    pump(qapp, idle(window))
    moved = window.service.shots[0].end_ms
    assert abs(moved - 2600) <= 40 and window.service.shots[1].start_ms == moved
    assert window.service.shots[0].source == "manual"
    # 블록 클릭은 탐색 + 선택
    mouse(QMouseEvent.Type.MouseButtonPress, timeline._x(8000))
    mouse(QMouseEvent.Type.MouseButtonRelease, timeline._x(8000), Qt.MouseButton.NoButton)
    pump(qapp, settle=0.3)
    assert window.analysis._selected == 4


def test_bad_import_keeps_existing_project(qapp, window, tmp_path, samples, bad_files, dialogs):
    analyzed(qapp, window, tmp_path, samples["rotated"])
    before = bounds(window)
    assert window.analysis.import_video(bad_files["text"], "copy")
    pump(qapp, idle(window))
    assert dialogs and dialogs[-1][0] == "영상을 가져올 수 없습니다"
    assert bounds(window) == before
    assert window.service.project.status == AnalysisStatus.READY
    assert window.service.require_reference_file().is_file()
    assert window.analysis.strip.count() == len(before)


def test_cancel_analysis_then_retry(qapp, window, tmp_path, samples):
    assert window.create_project("취소 테스트", tmp_path / "projects", TimelineSettings())
    assert window.analysis.import_video(samples["ad15"], "copy")
    pump(qapp, lambda: window.service.project.status == AnalysisStatus.DETECTING, settle=0)
    assert window.cancel_btn.isVisible() and window.progress.isVisible()
    window.cancel_btn.click()
    pump(qapp, idle(window))
    assert window.service.project.status == AnalysisStatus.CANCELLED
    assert window.service.reference is not None and window.service.shots == []
    assert window.analysis.start_detection(confirm=False)  # 재시도
    pump(qapp, lambda: not window.runner.busy and window.service.project.status == AnalysisStatus.READY)
    assert len(window.service.shots) == len(PROFILES["ad15"].durations)


def test_interrupted_project_recovers_keyframes_on_open(qapp, window, tmp_path, samples):
    analyzed(qapp, window, tmp_path, samples["rotated"])
    root, service = window.service.root, window.service
    service.keyframe_path(service.shots[0], "start").unlink()
    service.set_status(AnalysisStatus.ANALYZING)  # 키프레임 생성 중 강제 종료된 상황
    window.analysis.set_service(None)
    service.repo._conn.close()
    window.service = None
    assert window.open_project(root)
    pump(qapp, lambda: not window.runner.busy and window.service.project.status == AnalysisStatus.READY)
    assert window.service.keyframe_jobs() == []


def test_open_invalid_folder_shows_error(qapp, window, tmp_path, dialogs):
    assert not window.open_project(tmp_path / "없는 폴더")
    assert dialogs and "프로젝트를 열 수 없습니다" in dialogs[-1][1]
    assert not window.create_project("  ", tmp_path / "projects", TimelineSettings())
    assert window.service is None and window.stack.currentWidget() is window.home


def test_ffmpeg_missing_is_reported_not_crashing(qapp, window, tmp_path, samples, dialogs, monkeypatch):
    assert window.create_project("ffmpeg 없음", tmp_path / "projects", TimelineSettings())

    def missing():
        raise AdCloneError("ffmpeg 실행 파일을 찾을 수 없습니다")

    monkeypatch.setattr(window.analysis, "_get_tools", missing)
    assert not window.analysis.import_video(samples["single"], "copy")
    assert dialogs[-1][0] == "FFmpeg를 찾을 수 없음"
    assert window.service.project.status == AnalysisStatus.NOT_IMPORTED


def test_diagnostics_and_folder_names(tmp_path):
    text = diagnostics_text(Settings(tmp_path / "home"))
    assert "PySide6" in text and "ffprobe" in text and "PySceneDetect" in text
    assert safe_folder_name('광고: "A/B" <최종>?') == "광고_ _A_B_ _최종__"
    assert safe_folder_name("...") == "project"
    (tmp_path / "x").mkdir()
    assert unique_dir(tmp_path, "x").name == "x_2"


_PLAYER_CYCLE = """
import sys, time
from PySide6.QtWidgets import QApplication
from adclone.ui.widgets.video_player import VideoPlayer
app = QApplication([])
player = VideoPlayer(); player.show()
def spin(seconds):
    end = time.time() + seconds
    while time.time() < end:
        app.processEvents(); time.sleep(0.002)
for i in range(40):
    player.load(sys.argv[1], 1000 / 30, 5000)
    spin(0.05 + (i % 5) * 0.04)   # 불러오는 중 / 불러온 직후 등 여러 시점에서 닫는다
    if i % 3 == 0:
        player.seek(1000, play=True); spin(0.05)
    player.unload()
print("cycles ok")
"""


def test_player_unload_never_deadlocks(samples, tmp_path):
    """영상을 닫을 때(프로젝트 닫기/영상 교체/앱 종료) 플레이어가 멈추지 않는다.

    닫는 도중 오는 상태 신호 안에서 플레이어를 다시 호출하면 Qt 백엔드가 간헐적으로 교착됐다.
    교착은 프로세스를 멈추므로 별도 프로세스에서 시간 제한을 두고 확인한다.
    """
    import os
    import subprocess
    import sys
    from pathlib import Path

    script = tmp_path / "cycle.py"
    script.write_text(_PLAYER_CYCLE, encoding="utf-8")
    src = str(Path(__file__).resolve().parents[1] / "src")
    env = {**os.environ, "QT_QPA_PLATFORM": "offscreen"}
    env["PYTHONPATH"] = os.pathsep.join(filter(None, [src, env.get("PYTHONPATH")]))
    try:
        result = subprocess.run(
            [sys.executable, str(script), str(samples["rotated"])], capture_output=True, env=env, timeout=120
        )
    except subprocess.TimeoutExpired:
        pytest.fail("플레이어 load/unload 반복이 120초 안에 끝나지 않았습니다 (교착)")
    assert b"cycles ok" in result.stdout, result.stderr.decode("utf-8", "replace")[-2000:]
