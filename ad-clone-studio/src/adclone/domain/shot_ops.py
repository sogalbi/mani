"""쇼트 경계 편집(분할/병합/경계 이동). 순수 함수이며 항상 연속 타임라인을 유지한다.

불변식: shots[0].start_ms == 0, shots[i].end_ms == shots[i+1].start_ms,
        shots[-1].end_ms == duration_ms, 모든 쇼트 길이 >= min_len_ms.
"""

from __future__ import annotations

from typing import Callable

from .errors import ShotEditError
from .models import Shot
from .timebase import format_ms


def shots_from_cuts(cuts_ms: list[int], duration_ms: int, new_id: Callable[[], str]) -> list[Shot]:
    """내부 컷 시각 목록으로 쇼트 목록을 만든다. 범위를 벗어나거나 중복된 컷은 버린다."""
    if duration_ms <= 0:
        raise ShotEditError("영상 길이가 0입니다")
    cuts = sorted({int(c) for c in cuts_ms if 0 < int(c) < duration_ms})
    bounds = [0, *cuts, duration_ms]
    return [
        Shot(id=new_id(), ordinal=i, start_ms=bounds[i], end_ms=bounds[i + 1], source="auto")
        for i in range(len(bounds) - 1)
    ]


def validate(shots: list[Shot], duration_ms: int) -> None:
    if not shots:
        raise ShotEditError("쇼트가 없습니다")
    if shots[0].start_ms != 0:
        raise ShotEditError("첫 쇼트는 0에서 시작해야 합니다")
    if shots[-1].end_ms != duration_ms:
        raise ShotEditError("마지막 쇼트는 영상 끝에서 끝나야 합니다")
    for i, shot in enumerate(shots):
        if shot.ordinal != i:
            raise ShotEditError("쇼트 순번이 어긋났습니다")
        if shot.end_ms <= shot.start_ms:
            raise ShotEditError(f"쇼트 {i + 1}의 길이가 0 이하입니다")
        if i and shots[i - 1].end_ms != shot.start_ms:
            raise ShotEditError(f"쇼트 {i}과 {i + 1} 사이에 틈/겹침이 있습니다")


def _renumber(shots: list[Shot]) -> list[Shot]:
    for i, shot in enumerate(shots):
        shot.ordinal = i
    return shots


def _touch(shot: Shot) -> None:
    shot.source = "manual"
    shot.keyframes = {}


def index_at(shots: list[Shot], ms: int) -> int:
    """ms 위치를 포함하는 쇼트의 인덱스."""
    for i, shot in enumerate(shots):
        if shot.start_ms <= ms < shot.end_ms:
            return i
    return len(shots) - 1 if shots and ms >= shots[-1].end_ms else 0


def split(
    shots: list[Shot], at_ms: int, min_len_ms: int, new_id: Callable[[], str]
) -> tuple[list[Shot], list[str]]:
    """at_ms 위치에서 쇼트를 둘로 나눈다. (새 목록, 키프레임 재생성이 필요한 쇼트 id)"""
    if not shots or not (shots[0].start_ms < at_ms < shots[-1].end_ms):
        raise ShotEditError("분할 위치가 영상 범위를 벗어났습니다")
    idx = index_at(shots, at_ms)
    target = shots[idx]
    if at_ms - target.start_ms < min_len_ms or target.end_ms - at_ms < min_len_ms:
        raise ShotEditError(
            f"분할 위치({format_ms(at_ms)})가 쇼트 경계와 너무 가깝습니다 (최소 {min_len_ms}ms)"
        )
    result = [s.copy() for s in shots]
    first = result[idx]
    second = Shot(id=new_id(), ordinal=idx + 1, start_ms=at_ms, end_ms=first.end_ms)
    first.end_ms = at_ms
    _touch(first)
    _touch(second)
    result.insert(idx + 1, second)
    return _renumber(result), [first.id, second.id]


def merge(shots: list[Shot], index: int) -> tuple[list[Shot], list[str], list[str]]:
    """index 쇼트와 다음 쇼트를 합친다. (새 목록, 재생성 id, 삭제된 id)"""
    if index < 0 or index >= len(shots) - 1:
        raise ShotEditError("합칠 다음 쇼트가 없습니다")
    result = [s.copy() for s in shots]
    keep, drop = result[index], result[index + 1]
    keep.end_ms = drop.end_ms
    _touch(keep)
    del result[index + 1]
    return _renumber(result), [keep.id], [drop.id]


def move_boundary(
    shots: list[Shot], index: int, new_ms: int, min_len_ms: int
) -> tuple[list[Shot], list[str]]:
    """index 쇼트와 index+1 쇼트 사이의 경계를 new_ms로 옮긴다."""
    if index < 0 or index >= len(shots) - 1:
        raise ShotEditError("첫 쇼트의 시작과 마지막 쇼트의 끝은 옮길 수 없습니다")
    left, right = shots[index], shots[index + 1]
    low, high = left.start_ms + min_len_ms, right.end_ms - min_len_ms
    if low > high or not (low <= new_ms <= high):
        raise ShotEditError(
            f"경계는 {format_ms(low)} ~ {format_ms(high)} 사이여야 합니다 (요청: {format_ms(new_ms)})"
        )
    if new_ms == left.end_ms:
        return [s.copy() for s in shots], []
    result = [s.copy() for s in shots]
    result[index].end_ms = new_ms
    result[index + 1].start_ms = new_ms
    _touch(result[index])
    _touch(result[index + 1])
    return result, [result[index].id, result[index + 1].id]
