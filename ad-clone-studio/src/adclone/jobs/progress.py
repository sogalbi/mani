"""취소 토큰과 진행 보고. Qt에 의존하지 않아 워커/CLI/테스트가 공유한다."""

from __future__ import annotations

import threading
from typing import Any, Callable

from ..domain.errors import JobCancelled

# (이벤트 이름, payload dict)
ProgressCallback = Callable[[str, dict[str, Any]], None]


class CancelToken:
    def __init__(self) -> None:
        self._event = threading.Event()

    def cancel(self) -> None:
        self._event.set()

    @property
    def cancelled(self) -> bool:
        return self._event.is_set()

    def raise_if_cancelled(self) -> None:
        if self._event.is_set():
            raise JobCancelled()


class JobContext:
    """작업 함수에 전달되는 실행 컨텍스트."""

    def __init__(self, emit: ProgressCallback | None = None, cancel: CancelToken | None = None):
        self._emit = emit
        self.cancel = cancel or CancelToken()

    def emit(self, event: str, **payload: Any) -> None:
        if self._emit is not None:
            self._emit(event, payload)

    def check(self) -> None:
        self.cancel.raise_if_cancelled()
