"""사용자에게 설명 가능한 오류 계층."""

from __future__ import annotations


class AdCloneError(Exception):
    """앱이 의도적으로 발생시키는 오류. 메시지는 UI에 그대로 표시된다."""


class FFmpegNotFoundError(AdCloneError):
    pass


class FFmpegError(AdCloneError):
    """ffmpeg/ffprobe 프로세스가 0이 아닌 코드로 끝났다."""

    def __init__(self, message: str, returncode: int | None = None, stderr: str = ""):
        super().__init__(message)
        self.returncode = returncode
        self.stderr = stderr


class MediaProbeError(AdCloneError):
    """파일을 영상으로 읽을 수 없다(손상, 영상 스트림 없음, 미지원 코덱 등)."""


class SceneDetectionError(AdCloneError):
    pass


class ProjectError(AdCloneError):
    pass


class ShotEditError(AdCloneError):
    """쇼트 경계 편집이 타임라인 일관성을 깨뜨린다."""


class JobCancelled(Exception):
    """사용자 취소. 오류가 아니므로 AdCloneError를 상속하지 않는다."""
