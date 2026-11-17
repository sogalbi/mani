"""테스트/데모용 합성 영상 생성기. 상업 광고를 저장소에 넣지 않기 위해 FFmpeg로 직접 만든다.

    python -m adclone.devtools.make_sample sample.mp4 --profile hardcuts
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path

from ..domain.errors import AdCloneError
from ..ingest.ffmpeg import FFmpegTools, locate_ffmpeg, run_tool

# 서로 뚜렷이 구분되는 lavfi 소스(움직임 포함). {s}=WxH, {r}=fps, {d}=초
_SOURCES = [
    "testsrc2=s={s}:r={r}:d={d}",
    "color=c=0x1e3a8a:s={s}:r={r}:d={d},drawbox=x='mod(t*200,iw)':y=ih/3:w=iw/6:h=ih/4:c=0xfbbf24:t=fill",
    "smptebars=s={s}:r={r}:d={d}",
    "mandelbrot=s={s}:r={r}:start_scale=1.5:end_scale=0.3,trim=duration={d}",
    "color=c=0xf8fafc:s={s}:r={r}:d={d},drawbox=x=iw/4:y='mod(t*150,ih)':w=iw/2:h=ih/8:c=0xdc2626:t=fill",
    "rgbtestsrc=s={s}:r={r}:d={d}",
    "color=c=0x064e3b:s={s}:r={r}:d={d},drawgrid=w=iw/8:h=ih/8:t=4:c=0xa7f3d0",
    "yuvtestsrc=s={s}:r={r}:d={d}",
]


@dataclass(frozen=True)
class SampleProfile:
    width: int
    height: int
    fps: str
    durations: tuple[float, ...]  # 쇼트 길이(초)
    audio: bool = True
    rotate: int = 0

    @property
    def cut_times(self) -> list[float]:
        total, cuts = 0.0, []
        for d in self.durations[:-1]:
            total += d
            cuts.append(total)
        return cuts

    @property
    def duration(self) -> float:
        return sum(self.durations)


PROFILES = {
    # 1. 하드컷이 뚜렷한 가로 영상
    "hardcuts": SampleProfile(1280, 720, "30", (2.0, 1.5, 2.5, 1.0, 2.0, 3.0)),
    # 4. 세로 9:16 + 음성, 29.97fps
    "portrait": SampleProfile(720, 1280, "30000/1001", (1.5, 2.0, 1.0, 2.5, 2.0)),
    # 15초 광고 길이
    "ad15": SampleProfile(1280, 720, "30", (2.0, 1.5, 2.5, 1.0, 2.0, 1.5, 2.5, 2.0)),
    # 컷이 없는 단일 쇼트
    "single": SampleProfile(640, 360, "25", (3.0,), audio=False),
    # 회전 메타데이터가 있는 MOV(휴대폰 세로 촬영 형태)
    "rotated": SampleProfile(640, 360, "30", (1.5, 1.5, 2.0), rotate=90),
}


def make_sample(out: Path, profile: str = "hardcuts", tools: FFmpegTools | None = None) -> SampleProfile:
    if profile not in PROFILES:
        raise AdCloneError(f"알 수 없는 프로필: {profile} (가능: {', '.join(PROFILES)})")
    spec = PROFILES[profile]
    tools = tools or locate_ffmpeg()
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    size = f"{spec.width}x{spec.height}"
    args = [str(tools.ffmpeg), "-hide_banner", "-loglevel", "error", "-nostdin", "-y"]
    if spec.rotate:
        args += ["-display_rotation", str(spec.rotate)]
        # 회전 메타데이터는 아래 concat 출력에는 붙지 않으므로 2단계로 만든다
    for i, d in enumerate(spec.durations):
        src = _SOURCES[i % len(_SOURCES)].format(s=size, r=spec.fps, d=d)
        args += ["-f", "lavfi", "-i", src]
    n = len(spec.durations)
    if spec.audio:
        args += ["-f", "lavfi", "-i", f"sine=frequency=440:sample_rate=48000:duration={spec.duration}"]
    chain = "".join(f"[{i}:v]" for i in range(n)) + f"concat=n={n}:v=1:a=0,format=yuv420p[v]"
    args += ["-filter_complex", chain, "-map", "[v]"]
    if spec.audio:
        args += ["-map", f"{n}:a", "-c:a", "aac", "-b:a", "96k"]
    args += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-r", spec.fps, "-t", f"{spec.duration}"]
    if not spec.rotate:
        run_tool([*args, str(out)], timeout=180)
        return spec
    # 회전: 먼저 일반 파일을 만들고, 스트림 복사로 display matrix만 붙인다
    args = [a for a in args]
    idx = args.index("-display_rotation")
    del args[idx : idx + 2]
    plain = out.with_name(out.stem + ".plain.mp4")
    try:
        run_tool([*args, str(plain)], timeout=180)
        run_tool(
            [
                str(tools.ffmpeg), "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
                "-display_rotation", str(spec.rotate), "-i", str(plain), "-c", "copy", str(out),
            ],
            timeout=60,
        )
    finally:
        plain.unlink(missing_ok=True)
    return spec


def main(argv: list[str] | None = None) -> int:
    from .. import safe_stdio

    safe_stdio()
    parser = argparse.ArgumentParser(description="AD CLONE STUDIO 테스트용 합성 영상 생성")
    parser.add_argument("output", type=Path)
    parser.add_argument("--profile", default="hardcuts", choices=sorted(PROFILES))
    ns = parser.parse_args(argv)
    try:
        spec = make_sample(ns.output, ns.profile)
    except AdCloneError as exc:
        print(f"오류: {exc}", file=sys.stderr)
        return 1
    print(f"생성됨: {ns.output} ({spec.width}x{spec.height}, {spec.fps}fps, {spec.duration:.1f}s)")
    print("컷 위치(초):", ", ".join(f"{t:.2f}" for t in spec.cut_times) or "(없음)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
