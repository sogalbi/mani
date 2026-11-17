"""UI 스레드를 막지 않는 작업 실행기 (QThreadPool 기반, 한 번에 한 작업)."""

from __future__ import annotations

import logging
from typing import Any, Callable

from PySide6.QtCore import QObject, QRunnable, QThreadPool, Signal, Slot

from ..domain.errors import AdCloneError, JobCancelled
from .progress import CancelToken, JobContext

log = logging.getLogger(__name__)


class _Signals(QObject):
    event = Signal(int, str, object)
    done = Signal(int, object)
    failed = Signal(int, str)
    cancelled = Signal(int)


class _Task(QRunnable):
    def __init__(self, job_id: int, fn: Callable[[JobContext], Any], token: CancelToken):
        super().__init__()
        self.job_id = job_id
        self.fn = fn
        self.token = token
        self.signals = _Signals()
        self.setAutoDelete(False)

    def run(self) -> None:  # 워커 스레드
        ctx = JobContext(
            emit=lambda name, payload: self.signals.event.emit(self.job_id, name, payload),
            cancel=self.token,
        )
        try:
            result = self.fn(ctx)
            ctx.check()  # 마지막 순간의 취소도 취소로 처리
        except JobCancelled:
            self.signals.cancelled.emit(self.job_id)
        except AdCloneError as exc:
            log.warning("job failed: %s", exc)
            self.signals.failed.emit(self.job_id, str(exc))
        except Exception as exc:  # noqa: BLE001 - 워커 예외로 앱이 죽지 않게 한다
            log.exception("unexpected job error")
            self.signals.failed.emit(self.job_id, f"예상하지 못한 오류: {type(exc).__name__}: {exc}")
        else:
            self.signals.done.emit(self.job_id, result)


class JobRunner(QObject):
    """작업 하나를 백그라운드에서 실행하고 결과를 UI 스레드의 콜백으로 전달한다."""

    started = Signal(str)  # 작업 제목
    event = Signal(str, object)  # (이벤트 이름, payload)
    ended = Signal(str)  # "done" | "failed" | "cancelled"

    def __init__(self, parent: QObject | None = None):
        super().__init__(parent)
        self._pool = QThreadPool(self)
        self._pool.setMaxThreadCount(1)
        self._task: _Task | None = None
        self._next_id = 1
        self._callbacks: dict[str, Callable | None] = {}
        self.title = ""

    @property
    def busy(self) -> bool:
        return self._task is not None

    def start(
        self,
        title: str,
        fn: Callable[[JobContext], Any],
        on_done: Callable[[Any], None],
        on_failed: Callable[[str], None] | None = None,
        on_cancelled: Callable[[], None] | None = None,
        on_event: Callable[[str, dict], None] | None = None,
    ) -> bool:
        if self.busy:
            return False
        task = _Task(self._next_id, fn, CancelToken())
        self._next_id += 1
        task.signals.event.connect(self._on_event)
        task.signals.done.connect(self._on_done)
        task.signals.failed.connect(self._on_failed)
        task.signals.cancelled.connect(self._on_cancelled)
        self._task = task
        self._callbacks = {
            "done": on_done, "failed": on_failed, "cancelled": on_cancelled, "event": on_event,
        }
        self.title = title
        self.started.emit(title)
        self._pool.start(task)
        return True

    def cancel(self) -> None:
        if self._task is not None:
            self._task.token.cancel()

    def wait(self, msecs: int = 5000) -> bool:
        return self._pool.waitForDone(msecs)

    def _is_current(self, job_id: int) -> bool:
        return self._task is not None and self._task.job_id == job_id

    def _finish(self, kind: str, *args: Any) -> None:
        callback = self._callbacks.get(kind)
        self._task = None
        self._callbacks = {}
        try:
            if callback is not None:
                callback(*args)
        finally:
            self.ended.emit(kind)

    @Slot(int, str, object)
    def _on_event(self, job_id: int, name: str, payload: object) -> None:
        if not self._is_current(job_id):
            return
        callback = self._callbacks.get("event")
        if callback is not None:
            callback(name, payload)
        self.event.emit(name, payload)

    @Slot(int, object)
    def _on_done(self, job_id: int, result: object) -> None:
        if self._is_current(job_id):
            self._finish("done", result)

    @Slot(int, str)
    def _on_failed(self, job_id: int, message: str) -> None:
        if self._is_current(job_id):
            self._finish("failed", message)

    @Slot(int)
    def _on_cancelled(self, job_id: int) -> None:
        if self._is_current(job_id):
            self._finish("cancelled")
