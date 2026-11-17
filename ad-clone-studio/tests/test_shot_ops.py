import itertools

import pytest

from adclone.domain import shot_ops
from adclone.domain.errors import ShotEditError


def ids():
    counter = itertools.count(1)
    return lambda: f"s{next(counter):03d}"


def make(cuts=(2000, 3500, 6000), duration=10_000, new_id=None):
    return shot_ops.shots_from_cuts(list(cuts), duration, new_id or ids())


def bounds(shots):
    return [(s.start_ms, s.end_ms) for s in shots]


def test_shots_from_cuts_filters_invalid():
    shots = shot_ops.shots_from_cuts([3500, 0, 2000, 2000, 10_000, 99_999, -5], 10_000, ids())
    assert bounds(shots) == [(0, 2000), (2000, 3500), (3500, 10_000)]
    shot_ops.validate(shots, 10_000)


def test_no_cuts_single_shot():
    shots = shot_ops.shots_from_cuts([], 5000, ids())
    assert bounds(shots) == [(0, 5000)]


def test_split():
    new_id = ids()
    shots = make(new_id=new_id)
    shots[1].keyframes = {"start": {"file": "x.jpg", "time_ms": 1}}
    result, touched = shot_ops.split(shots, 3000, 33, new_id)
    assert bounds(result) == [(0, 2000), (2000, 3000), (3000, 3500), (3500, 6000), (6000, 10_000)]
    assert [s.ordinal for s in result] == [0, 1, 2, 3, 4]
    assert result[1].id == "s002" and result[2].id == "s005"  # 앞쪽은 id 유지, 뒤쪽은 새 id
    assert touched == ["s002", "s005"]
    assert result[1].source == result[2].source == "manual"
    assert result[1].keyframes == {}  # 키프레임은 다시 만들어야 함
    assert result[0].source == "auto"
    assert bounds(shots) == [(0, 2000), (2000, 3500), (3500, 6000), (6000, 10_000)]  # 원본 불변
    shot_ops.validate(result, 10_000)


@pytest.mark.parametrize("at", [0, 10_000, -1, 2000, 2010, 3490, 20_000])
def test_split_rejects_bad_positions(at):
    with pytest.raises(ShotEditError):
        shot_ops.split(make(), at, 33, ids())


def test_merge():
    result, touched, removed = shot_ops.merge(make(), 1)
    assert bounds(result) == [(0, 2000), (2000, 6000), (6000, 10_000)]
    assert touched == ["s002"] and removed == ["s003"]
    assert [s.ordinal for s in result] == [0, 1, 2]
    shot_ops.validate(result, 10_000)
    with pytest.raises(ShotEditError):
        shot_ops.merge(make(), 3)  # 마지막 쇼트는 다음이 없음


def test_move_boundary():
    result, touched = shot_ops.move_boundary(make(), 0, 1500, 33)
    assert bounds(result)[:2] == [(0, 1500), (1500, 3500)]
    assert touched == ["s001", "s002"]
    shot_ops.validate(result, 10_000)
    same, touched = shot_ops.move_boundary(make(), 0, 2000, 33)
    assert touched == [] and same[0].source == "auto"


@pytest.mark.parametrize("index,ms", [(0, 0), (0, 10), (0, 3500), (0, 3480), (3, 9000), (-1, 100)])
def test_move_boundary_rejects(index, ms):
    with pytest.raises(ShotEditError):
        shot_ops.move_boundary(make(), index, ms, 33)


def test_split_then_merge_restores_bounds():
    new_id = ids()
    shots = make(new_id=new_id)
    split, _ = shot_ops.split(shots, 5000, 33, new_id)
    merged, _, _ = shot_ops.merge(split, 2)
    assert bounds(merged) == bounds(shots)


def test_validate_detects_gap():
    shots = make()
    shots[1].start_ms = 2100
    with pytest.raises(ShotEditError):
        shot_ops.validate(shots, 10_000)


def test_index_at():
    shots = make()
    assert shot_ops.index_at(shots, 0) == 0
    assert shot_ops.index_at(shots, 1999) == 0
    assert shot_ops.index_at(shots, 2000) == 1
    assert shot_ops.index_at(shots, 10_000) == 3
