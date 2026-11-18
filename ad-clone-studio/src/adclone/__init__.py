"""AD CLONE STUDIO - 광고 레퍼런스 분석·재현 스튜디오 (M0~M1)."""

__version__ = "0.1.0"
APP_NAME = "AD CLONE STUDIO"
APP_DIR_NAME = "ADCloneStudio"


def safe_stdio() -> None:
    """콘솔 인코딩(cp1252 등)이 한글을 표현하지 못해도 출력 때문에 프로그램이 죽지 않게 한다."""
    import sys

    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            try:
                reconfigure(errors="replace")
            except (OSError, ValueError):
                pass
