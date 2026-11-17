import pytest

from adclone.analysis.scene_detector import detect_cuts
from adclone.devtools.make_sample import PROFILES
from adclone.domain import events
from adclone.domain.errors import JobCancelled, SceneDetectionError
from adclone.domain.models import DetectParams
from adclone.jobs.progress import JobContext

TOLERANCE_MS = 200  # 설계서 12장: ±0.2초


def match(expected_ms, found_ms):
    """(정밀도, 재현율) - 허용 오차 안에서 1:1 매칭."""
    remaining = list(found_ms)
    hits = 0
    for exp in expected_ms:
        near = [f for f in remaining if abs(f - exp) <= TOLERANCE_MS]
        if near:
            remaining.remove(min(near, key=lambda f: abs(f - exp)))
            hits += 1
    precision = hits / len(found_ms) if found_ms else 1.0
    recall = hits / len(expected_ms) if expected_ms else 1.0
    return precision, recall


@pytest.mark.parametrize("profile", ["hardcuts", "portrait", "ad15", "rotated"])
def test_hard_cuts_detected(samples, profile):
    spec = PROFILES[profile]
    expected = [int(t * 1000) for t in spec.cut_times]
    result = detect_cuts(samples[profile], DetectParams(), int(spec.duration * 1000))
    precision, recall = match(expected, result.cuts_ms)
    assert precision >= 0.85 and recall >= 0.85, (expected, result.cuts_ms)
    assert result.cuts_ms == sorted(result.cuts_ms)
    assert result.frames_processed > 0
    # 합성 하드컷은 한 프레임 이내로 맞아야 한다
    assert all(min(abs(c - e) for e in expected) <= 40 for c in result.cuts_ms)


def test_single_shot_has_no_cuts(samples):
    assert detect_cuts(samples["single"], DetectParams(), 3000).cuts_ms == []


def test_progress_and_shot_events(samples):
    seen = []
    ctx = JobContext(emit=lambda name, payload: seen.append((name, payload)))
    result = detect_cuts(samples["hardcuts"], DetectParams(), 12_000, ctx)
    progress = [p["fraction"] for n, p in seen if n == events.DETECT_PROGRESS]
    assert progress and all(0 <= f <= 1 for f in progress) and progress == sorted(progress)
    assert len([1 for n, _ in seen if n == events.SHOT_DETECTED]) == len(result.cuts_ms)


def test_cancel_stops_detection(samples):
    ctx = JobContext()
    ctx._emit = lambda name, payload: ctx.cancel.cancel() if name == events.DETECT_PROGRESS else None
    with pytest.raises(JobCancelled):
        detect_cuts(samples["ad15"], DetectParams(), 15_000, ctx)


def test_unreadable_file_raises(bad_files):
    with pytest.raises(SceneDetectionError):
        detect_cuts(bad_files["text"], DetectParams(), 1000)
