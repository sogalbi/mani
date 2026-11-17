import pytest

from adclone.domain.errors import FFmpegNotFoundError, MediaProbeError
from adclone.ingest import ffmpeg as ffmpeg_mod
from adclone.ingest.probe import import_warnings, parse_probe_json, probe


def test_probe_landscape(samples, tools):
    info = probe(samples["hardcuts"], tools)
    assert (info.width, info.height) == (1280, 720)
    assert (info.display_width, info.display_height) == (1280, 720)
    assert info.rotation == 0
    assert info.fps == pytest.approx(30.0)
    assert info.duration_ms == pytest.approx(12_000, abs=50)
    assert info.video_codec == "h264"
    assert info.has_audio and info.audio_codec == "aac" and info.audio_sample_rate == 48000
    assert info.nb_frames == 360
    assert not info.is_vfr_suspected
    assert import_warnings(info) == []


def test_probe_portrait_ntsc(samples, tools):
    info = probe(samples["portrait"], tools)
    assert (info.display_width, info.display_height) == (720, 1280)
    assert info.avg_frame_rate == "30000/1001"
    assert info.fps == pytest.approx(29.97, abs=0.001)


def test_probe_rotated_mov(samples, tools):
    info = probe(samples["rotated"], tools)
    assert (info.width, info.height) == (640, 360)
    assert info.rotation in (90, 270)
    assert (info.display_width, info.display_height) == (360, 640)
    assert any("회전" in w for w in import_warnings(info))


def test_probe_no_audio_and_short_warning(samples, tools):
    info = probe(samples["single"], tools)
    assert not info.has_audio and info.audio_codec is None
    assert any("5~60초" in w for w in import_warnings(info))


@pytest.mark.parametrize("kind", ["text", "empty", "missing"])
def test_probe_rejects_bad_input(bad_files, tools, kind):
    with pytest.raises(MediaProbeError):
        probe(bad_files[kind], tools)


def test_probe_rejects_audio_only(tools, tmp_path):
    audio = tmp_path / "audio_only.mp4"
    ffmpeg_mod.run_tool(
        [str(tools.ffmpeg), "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=duration=1", "-c:a", "aac", str(audio)]
    )
    with pytest.raises(MediaProbeError, match="영상 스트림"):
        probe(audio, tools)


def _stream(**overrides):
    base = {
        "codec_type": "video", "codec_name": "h264", "width": 1920, "height": 1080,
        "avg_frame_rate": "30/1", "r_frame_rate": "30/1", "duration": "10.0",
    }
    base.update(overrides)
    return base


def test_parse_rotation_variants():
    matrix = parse_probe_json({"streams": [_stream(side_data_list=[{"rotation": -90}])], "format": {}})
    assert matrix.rotation == 90 and (matrix.display_width, matrix.display_height) == (1080, 1920)
    tag = parse_probe_json({"streams": [_stream(tags={"rotate": "180"})], "format": {}})
    assert tag.rotation == 180 and tag.display_width == 1920


def test_parse_vfr_and_format_duration_fallback():
    info = parse_probe_json(
        {"streams": [_stream(avg_frame_rate="24000/1001", r_frame_rate="60/1", duration=None)],
         "format": {"duration": "7.5", "format_name": "mov,mp4"}}
    )
    assert info.is_vfr_suspected and info.duration_ms == 7500


@pytest.mark.parametrize(
    "data",
    [
        {"streams": [], "format": {}},
        {"streams": [{"codec_type": "audio"}], "format": {"duration": "3"}},
        {"streams": [_stream(disposition={"attached_pic": 1})], "format": {}},  # 앨범 아트만 있는 파일
        {"streams": [_stream(duration=None)], "format": {}},
        {"streams": [_stream(width=0)], "format": {}},
        {"streams": [_stream(avg_frame_rate="0/0", r_frame_rate="0/0")], "format": {}},
    ],
)
def test_parse_rejects_unusable(data):
    with pytest.raises(MediaProbeError):
        parse_probe_json(data)


def test_ffmpeg_not_found(monkeypatch, tmp_path):
    monkeypatch.setattr(ffmpeg_mod.shutil, "which", lambda _name: None)
    monkeypatch.delenv(ffmpeg_mod.ENV_FFMPEG_DIR, raising=False)
    with pytest.raises(FFmpegNotFoundError):
        ffmpeg_mod.locate_ffmpeg(str(tmp_path))


def test_ffmpeg_configured_dir_wins(tools, tmp_path, monkeypatch):
    monkeypatch.setattr(ffmpeg_mod.shutil, "which", lambda _name: None)
    monkeypatch.setenv(ffmpeg_mod.ENV_FFMPEG_DIR, str(tools.ffmpeg.parent))
    found = ffmpeg_mod.locate_ffmpeg(None)
    assert found.ffmpeg.is_file() and found.ffprobe.is_file()
