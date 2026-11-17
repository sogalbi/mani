from fractions import Fraction

import pytest

from adclone.domain.timebase import Timebase, boundaries_to_frames, format_ms, format_timecode, parse_rate


def test_parse_rate():
    assert parse_rate("30000/1001") == Fraction(30000, 1001)
    assert parse_rate("25") == Fraction(25)
    assert parse_rate("0/0") is None
    assert parse_rate("") is None
    assert parse_rate("abc") is None


def test_ms_to_frame_rounding():
    tb = Timebase(30, 1)
    assert tb.ms_to_frame(0) == 0
    assert tb.ms_to_frame(1850) == 56  # 55.5 -> 올림 (설계서 예시와 동일)
    assert tb.ms_to_frame(1000) == 30
    assert tb.ms_to_frame(16) == 0
    assert tb.ms_to_frame(17) == 1


def test_frame_roundtrip_ntsc():
    tb = Timebase(30000, 1001)
    for frame in (0, 1, 29, 30, 899, 1800):
        assert tb.ms_to_frame(tb.frame_to_ms(frame)) == frame


@pytest.mark.parametrize("fps", [(30, 1), (30000, 1001), (25, 1), (24, 1), (60, 1)])
def test_shot_frames_sum_to_total(fps):
    """쇼트별 프레임 수의 합 == 전체 프레임 수 (누적 오차 없음)."""
    tb = Timebase(*fps)
    bounds = [0, 333, 1850, 1851, 4999, 7777, 12345, 29970]
    frames = boundaries_to_frames(bounds, tb)
    assert frames[0] == 0
    assert frames[-1] == tb.ms_to_frame(bounds[-1])
    durations = [b - a for a, b in zip(frames, frames[1:])]
    assert sum(durations) == tb.ms_to_frame(bounds[-1])
    assert all(d >= 1 for d in durations)  # 1ms짜리 쇼트도 최소 1프레임


def test_boundaries_not_enough_frames():
    # 프레임 수보다 쇼트가 많으면 보정하지 않고 그대로 둔다(예외 없음)
    frames = boundaries_to_frames([0, 10, 20, 30, 40], Timebase(30, 1))
    assert frames[0] == 0 and frames[-1] == 1


def test_formatting():
    assert format_ms(0) == "00:00.000"
    assert format_ms(61_234) == "01:01.234"
    assert format_timecode(1850, Timebase(30, 1)) == "00:01:26"
    assert format_timecode(60_000, Timebase(30, 1)) == "01:00:00"
    assert format_timecode(1001, Timebase(30000, 1001)) == "00:01:00"


def test_invalid_timebase():
    with pytest.raises(ValueError):
        Timebase(0, 1)
