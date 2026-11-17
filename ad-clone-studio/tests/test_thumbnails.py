import cv2
import pytest

from adclone.domain.errors import JobCancelled
from adclone.ingest.thumbnails import extract_frame, generate_shot_keyframes, keyframe_times
from adclone.jobs.progress import CancelToken


def test_keyframe_times_inside_shot():
    times = keyframe_times(2000, 3500, 1000 / 30)
    assert 2000 <= times["start"] < times["middle"] < times["end"] < 3500


def test_keyframe_times_one_frame_shot():
    times = keyframe_times(1000, 1033, 1000 / 30)
    assert all(1000 <= t < 1033 for t in times.values())


def test_generate_three_keyframes(samples, tools, tmp_path):
    result = generate_shot_keyframes(tools, samples["hardcuts"], tmp_path / "shot", 2000, 3500, 1000 / 30)
    assert set(result) == {"start", "middle", "end"}
    for entry in result.values():
        image = cv2.imread(str(tmp_path / "shot" / entry["file"]))
        assert image is not None and image.shape[1] == 480
    assert not list((tmp_path / "shot").glob("*.tmp.jpg"))  # 임시 파일이 남지 않는다


def test_keyframes_come_from_correct_shot(samples, tools, tmp_path):
    """컷(2.0초) 양쪽의 끝/시작 프레임이 서로 다른 장면이어야 한다 = 타임코드가 맞는다."""
    before = generate_shot_keyframes(tools, samples["hardcuts"], tmp_path / "a", 0, 2000, 1000 / 30)
    after = generate_shot_keyframes(tools, samples["hardcuts"], tmp_path / "b", 2000, 3500, 1000 / 30)
    end_a = cv2.imread(str(tmp_path / "a" / before["end"]["file"])).astype("float32")
    start_b = cv2.imread(str(tmp_path / "b" / after["start"]["file"])).astype("float32")
    mid_b = cv2.imread(str(tmp_path / "b" / after["middle"]["file"])).astype("float32")
    assert abs(end_a - start_b).mean() > 30  # 다른 장면
    assert abs(mid_b - start_b).mean() < 15  # 같은 장면


def test_last_frame_of_video(samples, tools, tmp_path):
    used = extract_frame(tools, samples["hardcuts"], 11_990, tmp_path / "last.jpg")
    assert (tmp_path / "last.jpg").stat().st_size > 0 and used <= 11_990


def test_rotated_video_thumbnail_is_portrait(samples, tools, tmp_path):
    extract_frame(tools, samples["rotated"], 500, tmp_path / "r.jpg")
    image = cv2.imread(str(tmp_path / "r.jpg"))
    assert image.shape[0] > image.shape[1]


def test_cancelled_before_start(samples, tools, tmp_path):
    token = CancelToken()
    token.cancel()
    with pytest.raises(JobCancelled):
        extract_frame(tools, samples["ad15"], 500, tmp_path / "c.jpg", cancel=token)
    assert not (tmp_path / "c.jpg").exists()
