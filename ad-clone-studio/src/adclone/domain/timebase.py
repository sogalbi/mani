"""시간(ms) <-> 출력 프레임 변환.

저장·편집은 원본 시간(ms) 기준으로 하고, 프레임은 표시/렌더 경계용으로만 양자화한다.
누적 경계를 반올림하므로 쇼트별 프레임 수의 합은 항상 전체 프레임 수와 일치한다.
"""

from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction


def parse_rate(text: str | None) -> Fraction | None:
    """ffprobe의 '30000/1001' 같은 비율 문자열을 Fraction으로. 0/0, 빈 값은 None."""
    if not text:
        return None
    try:
        if "/" in text:
            num, den = text.split("/", 1)
            num_i, den_i = int(num), int(den)
            if num_i <= 0 or den_i <= 0:
                return None
            return Fraction(num_i, den_i)
        value = Fraction(text)
        return value if value > 0 else None
    except (ValueError, ZeroDivisionError):
        return None


@dataclass(frozen=True)
class Timebase:
    fps_num: int
    fps_den: int = 1

    def __post_init__(self) -> None:
        if self.fps_num <= 0 or self.fps_den <= 0:
            raise ValueError("fps는 양수여야 합니다")

    @property
    def fps(self) -> Fraction:
        return Fraction(self.fps_num, self.fps_den)

    @property
    def frame_duration_ms(self) -> float:
        return float(1000 / self.fps)

    def ms_to_frame(self, ms: int) -> int:
        """가장 가까운 프레임 번호(0.5는 올림). 정수 연산만 사용한다."""
        num = ms * self.fps_num
        den = 1000 * self.fps_den
        return (2 * num + den) // (2 * den)

    def frame_to_ms(self, frame: int) -> int:
        num = frame * 1000 * self.fps_den
        return (2 * num + self.fps_num) // (2 * self.fps_num)


def boundaries_to_frames(boundaries_ms: list[int], tb: Timebase) -> list[int]:
    """오름차순 경계 목록(0 ... duration)을 프레임 경계로 변환한다.

    한 프레임보다 짧은 쇼트가 0프레임이 되지 않도록, 전체 길이가 허용하는 한
    각 구간에 최소 1프레임을 보장한다. 첫/마지막 경계는 바꾸지 않는다.
    """
    frames = [tb.ms_to_frame(ms) for ms in boundaries_ms]
    if len(frames) < 2:
        return frames
    total = frames[-1] - frames[0]
    segments = len(frames) - 1
    if total < segments:
        return frames  # 프레임이 모자라면 보정 불가: 그대로 둔다
    for i in range(1, len(frames) - 1):
        if frames[i] <= frames[i - 1]:
            frames[i] = frames[i - 1] + 1
    for i in range(len(frames) - 2, 0, -1):
        if frames[i] >= frames[i + 1]:
            frames[i] = frames[i + 1] - 1
    return frames


def format_ms(ms: int) -> str:
    """MM:SS.mmm"""
    ms = max(0, int(ms))
    minutes, rest = divmod(ms, 60_000)
    seconds, millis = divmod(rest, 1000)
    return f"{minutes:02d}:{seconds:02d}.{millis:03d}"


def format_timecode(ms: int, tb: Timebase) -> str:
    """MM:SS:FF (프로젝트 타임베이스의 프레임 번호 기준, non-drop)."""
    frame = tb.ms_to_frame(max(0, int(ms)))
    # 프레임 번호를 '초 + 초 내 프레임'으로 분해 (분수 fps 대응)
    whole_seconds = (frame * tb.fps_den) // tb.fps_num
    first_frame_of_second = -((-whole_seconds * tb.fps_num) // tb.fps_den)  # ceil
    if first_frame_of_second > frame:
        whole_seconds -= 1
        first_frame_of_second = -((-whole_seconds * tb.fps_num) // tb.fps_den)
    ff = frame - first_frame_of_second
    minutes, seconds = divmod(whole_seconds, 60)
    return f"{minutes:02d}:{seconds:02d}:{ff:02d}"
