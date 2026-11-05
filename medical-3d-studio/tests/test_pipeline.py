"""Gate rules, pre-check rules and caption output. Run: python -m pytest -q"""
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

from studio import captions, checks, gates, narration, render
from studio.data import Studio, file_sha256

REPO = Path(__file__).resolve().parent.parent
COPY = ["config", "schemas", "topics", "research", "assets/registry.yaml", "assets/camera_presets", "assets/motion_presets",
        "publishing", "reviews", "analytics"]


@pytest.fixture()
def root(tmp_path):
    for item in COPY:
        src = REPO / item
        dst = tmp_path / item
        if src.is_dir():
            shutil.copytree(src, dst, ignore=shutil.ignore_patterns("packets", "out"))
        else:
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(src, dst)
    for k in ("medical", "legal_policy"):
        (tmp_path / "reviews" / k / "T0001_coronary_stent.yaml").write_text("topic_id: T0001\nrecords: []\n", encoding="utf-8")
    (tmp_path / "analytics" / "corrections.yaml").write_text("tickets: []\n", encoding="utf-8")
    (tmp_path / "publishing" / "videos.yaml").write_text("videos: []\n", encoding="utf-8")
    yaml.safe_dump({"reviewers": [
        {"reviewer_id": "ED", "name": "편집자", "role": "editor", "specialty": None, "active": True},
        {"reviewer_id": "MD", "name": "심장내과 의사", "role": "medical_expert", "specialty": "순환기내과", "active": True},
        {"reviewer_id": "DERM", "name": "피부과 의사", "role": "medical_expert", "specialty": "피부과", "active": True},
        {"reviewer_id": "OFF", "name": "비활성", "role": "medical_expert", "specialty": "순환기내과", "active": False},
        {"reviewer_id": "RM", "name": "권리 담당", "role": "rights_manager", "specialty": None, "active": True},
        {"reviewer_id": "PL", "name": "정책 담당", "role": "policy_legal", "specialty": None, "active": True},
    ]}, open(tmp_path / "config" / "reviewers.yaml", "w", encoding="utf-8"), allow_unicode=True)
    return tmp_path


def topic(root):
    return Studio(root).topic("T0001")


def edit_yaml(path, fn):
    data = yaml.safe_load(open(path, encoding="utf-8"))
    fn(data)
    yaml.safe_dump(data, open(path, "w", encoding="utf-8"), allow_unicode=True, sort_keys=False)


def verify_all_sources(root):
    def f(d):
        for s in d["sources"]:
            s["verification"] = "VERIFIED"
            s["checked_at"] = "2026-11-05"
    edit_yaml(root / "research" / "sources.yaml", f)


MED = "M01,M02,M03,M04,M05,M06,M07,M08,M09,M10".split(",")


def state(t, gate):
    return next(r for r in gates.status(t) if r["gate"] == gate)


# ---------------------------------------------------------------- pre-check
def test_unverified_sources_block_g1(root):
    t = topic(root)
    codes = {f.code for f in checks.run(t) if f.level == "BLOCK"}
    assert "UNVERIFIED_EVIDENCE" in codes
    gates.approve(t, "G0", "ED", "PASS")
    with pytest.raises(gates.GateError, match="BLOCK"):
        gates.approve(topic(root), "G1", "MD", "PASS", MED)


def test_script_has_no_blockers_of_its_own(root):
    fs = checks.run(topic(root))
    assert not [f for f in fs if f.level == "BLOCK" and f.area in ("script", "shots", "assets", "claims", "topic")]


@pytest.mark.parametrize("text,code", [
    ("스텐트가 플라크를 제거합니다", "MISCONCEPTION"),
    ("모든 협착은 스텐트로 치료합니다", "MISCONCEPTION"),
    ("이 시술로 완치됩니다", "BANNED_PHRASE"),
    ("성공률 100%", "BANNED_PHRASE"),
    ("병원에 방문해 시술을 받으세요", "BANNED_PHRASE"),
])
def test_lint_blocks(root, text, code):
    st = Studio(root)
    out = []
    checks._lint_text(text, "x", "script", st.policy["lint"], out)
    assert code in {f.code for f in out}


def test_lint_allows_negated_misconception(root):
    st = Studio(root)
    out = []
    checks._lint_text("플라크를 없애는 것이 아니라, 통로를 넓혀 받쳐 주는 원리입니다", "x", "script", st.policy["lint"], out)
    checks._lint_text("좁아진 혈관이 모두 스텐트 대상은 아닙니다", "x", "script", st.policy["lint"], out)
    assert not out


def test_procedural_numbers_warn(root):
    out = []
    checks._lint_text("풍선을 12기압으로 부풀립니다", "x", "script", Studio(root).policy["lint"], out)
    assert [f.code for f in out] == ["PROCEDURAL_DETAIL"]


def test_unregistered_asset_blocks(root):
    p = root / "topics" / "T0001_coronary_stent" / "shots.json"
    d = json.loads(p.read_text(encoding="utf-8"))
    d["shots"][0]["assets"].append("heart_from_internet_v1")
    p.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
    assert "UNREGISTERED_ASSET" in {f.code for f in checks.run(topic(root))}


def test_timing_gap_blocks(root):
    edit_yaml(root / "topics" / "T0001_coronary_stent" / "script.yaml", lambda d: d["lines"][1].update(start=3.5))
    assert "TIMING_GAP" in {f.code for f in checks.run(topic(root))}


# ---------------------------------------------------------------- gates
def test_full_g0_g1_flow_and_stale_after_edit(root):
    verify_all_sources(root)
    gates.approve(topic(root), "G0", "ED", "PASS")
    gates.approve(topic(root), "G1", "MD", "PASS", MED)
    t = topic(root)
    assert state(t, "G1")["effective"]
    # any script change invalidates G1
    edit_yaml(root / "topics" / "T0001_coronary_stent" / "script.yaml",
              lambda d: d["lines"][0].update(narration=d["lines"][0]["narration"] + " "))
    t = topic(root)
    assert state(t, "G1")["state"] == "STALE"
    assert not state(t, "G1")["effective"]


def test_unknown_is_not_pass(root):
    verify_all_sources(root)
    gates.approve(topic(root), "G0", "ED", "UNKNOWN", comment="대상 시청자 미정")
    t = topic(root)
    assert state(t, "G0")["state"] == "UNKNOWN" and not state(t, "G0")["effective"]
    with pytest.raises(gates.GateError, match="앞 단계"):
        gates.approve(t, "G1", "MD", "PASS", MED)


def test_pass_needs_full_checklist(root):
    verify_all_sources(root)
    gates.approve(topic(root), "G0", "ED", "PASS")
    with pytest.raises(gates.GateError, match="체크리스트"):
        gates.approve(topic(root), "G1", "MD", "PASS", MED[:-1])


def test_non_pass_needs_comment(root):
    with pytest.raises(gates.GateError, match="이유"):
        gates.approve(topic(root), "G0", "ED", "REVISE")


@pytest.mark.parametrize("rid,msg", [("ED", "역할"), ("DERM", "전문과목"), ("OFF", "active"), ("NOBODY", "명부")])
def test_reviewer_rules(root, rid, msg):
    verify_all_sources(root)
    gates.approve(topic(root), "G0", "ED", "PASS")
    with pytest.raises(gates.GateError, match=msg):
        gates.approve(topic(root), "G1", rid, "PASS", MED)


def test_sponsorship_requires_lawyer(root):
    edit_yaml(root / "topics" / "T0001_coronary_stent" / "topic.yaml", lambda d: d.update(sponsorship="disclosed:기기 회사"))
    with pytest.raises(gates.GateError, match="lawyer"):
        gates.approve(topic(root), "G4", "PL", "REVISE", comment="x")


def _fake_preview(root, t):
    from studio.gates import content_hashes
    d = root / "renders" / "preview"
    d.mkdir(parents=True, exist_ok=True)
    (d / "T0001_v001.mp4").write_bytes(b"fake video")
    h = content_hashes(t)
    (d / "T0001_v001.manifest.json").write_text(json.dumps({
        "topic_id": "T0001", "quality": "preview", "version": 1, "spec_hash": "x", "video": "T0001_v001.mp4",
        "video_sha256": file_sha256(d / "T0001_v001.mp4"), "script_hash": h["script"], "claims_hash": h["claims"],
        "shots_hash": h["shots"], "resolution": [540, 960], "fps": 30, "duration_sec": 43, "audio": "silent"}), encoding="utf-8")


def test_g3_waits_for_preview_and_goes_stale(root):
    t = topic(root)
    assert state(t, "G3")["state"] == "WAITING"
    _fake_preview(root, t)
    t = topic(root)
    assert state(t, "G3")["state"] == "PENDING"
    edit_yaml(root / "topics" / "T0001_coronary_stent" / "script.yaml",
              lambda d: d["lines"][2]["captions"][0].update(text="의료진은 X선 영상을 보면서"))
    t = topic(root)
    assert state(t, "G3")["state"] == "WAITING" and "다시 렌더" in state(t, "G3")["reason"]


def test_critical_correction_holds_and_resets_medical_gates(root):
    verify_all_sources(root)
    gates.approve(topic(root), "G0", "ED", "PASS", timestamp="2026-11-05T10:00:00+09:00")
    gates.approve(topic(root), "G1", "MD", "PASS", MED, timestamp="2026-11-05T11:00:00+09:00")
    yaml.safe_dump({"tickets": [{"ticket_id": "TK0001", "topic_id": "T0001", "severity": "critical", "report": "잘못된 설명",
                                 "status": "open", "received_at": "2026-11-06T09:00:00+09:00"}]},
                   open(root / "analytics" / "corrections.yaml", "w", encoding="utf-8"), allow_unicode=True)
    t = topic(root)
    assert state(t, "G5")["state"] == "HOLD"
    assert state(t, "G1")["state"] == "STALE"


# ---------------------------------------------------------------- captions & schema
def test_captions_cover_script(root):
    t = topic(root)
    ass = captions.build_ass(t, Studio(root).style)
    srt = captions.build_srt(t)
    n = len(captions.caption_events(t))
    assert ass.count("Style: Caption") == 1 and ass.count(",Caption,") == n
    assert "교육용 3D 개념도" in ass
    assert srt.strip().split("\n\n")[-1].startswith(str(n))


def test_repo_data_matches_schemas():
    from studio.schema import validate_all
    assert validate_all(Studio(REPO)) == []


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg not installed")
def test_render_qa_flags_brightness_jump_inside_a_shot(tmp_path):
    import subprocess
    from studio.render import luma_qa
    video = tmp_path / "v.mp4"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=gray:s=64x64:d=1:r=30",
                    "-f", "lavfi", "-i", "color=c=black:s=64x64:d=1:r=30", "-filter_complex", "[0][1]concat=n=2:v=1",
                    "-pix_fmt", "yuv420p", str(video)], check=True)
    one_shot = {"fps": 30, "shots": [{"start_sec": 0}]}
    assert luma_qa(video, one_shot)["jumps_within_shots"] == [31]
    cut_at_jump = {"fps": 30, "shots": [{"start_sec": 0}, {"start_sec": 1}]}
    assert luma_qa(video, cut_at_jump)["status"] == "ok"


# ---------------------------------------------------------------- narration (AI voice)
def test_tree_hash_is_the_same_on_every_os(tmp_path):
    from studio.data import tree_hash
    for name, nl in (("lf", b"\n"), ("crlf", b"\r\n")):
        d = tmp_path / name / "m3d"
        d.mkdir(parents=True)
        (d / "x.py").write_bytes(b"x = 1" + nl + b"y = 2" + nl)
    expected = hashlib.sha256(b"m3d/x.py" + b"x = 1\ny = 2\n").hexdigest()[:12]  # "/" paths, LF content
    assert tree_hash(tmp_path / "lf") == tree_hash(tmp_path / "crlf") == expected


def test_narration_layout_pushes_a_late_line_and_flags_it():
    cfg = dict(narration.DEFAULTS)
    lay = narration.layout([2.0, 3.5, 1.0], [(0, 3), (3, 6), (6, 9)], cfg)
    assert lay[0] == {"start": 0.12, "end": 2.12, "late": 0.0, "overflow": 0.0}
    assert lay[1]["overflow"] == pytest.approx(0.62)            # 3.12 + 3.5 runs past the line end at 6
    assert lay[2]["late"] == pytest.approx(0.58)                # waits for the previous clip (+0.08)
    plan = {"voice": cfg, "duration_sec": 9,
            "lines": [dict(p, line_id=f"L0{i + 1}", speed=s) for i, (p, s) in enumerate(zip(lay, [1.05, 1.05, 1.4]))]}
    msgs = narration.problems(plan)
    assert [lid for lid, _ in msgs] == ["L02", "L03", "L03"]
    assert "넘" not in msgs[0][1] and "더 읽어요" in msgs[0][1] and "늦게" in "".join(m for _, m in msgs)


def test_fit_line_reads_faster_only_when_needed():
    np = pytest.importorskip("numpy")
    rate = 1000

    def synth(text, speed):  # 6 s of sound at speed 1.0
        return np.full(int(6.0 / speed * rate), 0.5, dtype="float32")

    cfg = dict(narration.DEFAULTS, speed=1.0, max_speed=1.35)
    assert narration.fit_line(synth, "x", 7.0, cfg, rate)[0] == 1.0          # fits: normal speed
    speed, clip = narration.fit_line(synth, "x", 5.0, cfg, rate)
    assert 1.0 < speed <= 1.35 and len(clip) / rate <= 5.0
    assert narration.fit_line(synth, "x", 3.0, cfg, rate)[0] == 1.35        # cannot fit: stops at max_speed


def test_ai_voice_must_be_disclosed(root):
    assert not [f for f in checks.run(topic(root)) if f.code.startswith("AI_VOICE")]
    edit_yaml(root / "publishing" / "T0001_coronary_stent.yaml",
              lambda d: d.update(description=d["description"].replace("AI 음성", "음성"), ai_voice_used=False))
    codes = {f.code for f in checks.run(topic(root)) if f.level == "BLOCK"}
    assert {"AI_VOICE_FLAG", "AI_VOICE_NOT_DISCLOSED"} <= codes


class FakeVoice:
    """Stands in for the voice engine: a tone about 0.06 s per character, shorter when faster."""
    name, voice_name, steps, sample_rate, version = "fake", "F1", 1, 16000, "fake 1"

    def __call__(self, text, speed):
        import numpy as np
        t = np.arange(int(len(text) * 0.06 / speed * self.sample_rate)) / self.sample_rate
        return (0.3 * np.sin(2 * np.pi * 220 * t)).astype("float32")


def _md5_video(p):
    return subprocess.run(["ffmpeg", "-v", "error", "-i", str(p), "-map", "0:v", "-c", "copy", "-f", "md5", "-"],
                          capture_output=True, text=True, check=True).stdout


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg not installed")
def test_narrate_then_keep_the_picture_and_replace_the_sound(root):
    pytest.importorskip("numpy")
    quiet = lambda *_: None
    for item in ("assets/fonts", "blender/scripts"):
        shutil.copytree(REPO / item, root / item)
    t = topic(root)
    d = root / "renders" / "preview"
    d.mkdir(parents=True, exist_ok=True)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=gray:s=64x64:d=43:r=30",
                    "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "43", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", str(d / "T0001_v001.mp4")], check=True)
    h = gates.content_hashes(t)
    (d / "T0001_v001.manifest.json").write_text(json.dumps({
        "topic_id": "T0001", "quality": "preview", "version": 1, "spec_hash": "old-spec", "video": "T0001_v001.mp4",
        "video_sha256": file_sha256(d / "T0001_v001.mp4"), "script_hash": h["script"], "claims_hash": h["claims"],
        "shots_hash": h["shots"], "captions_sha256": hashlib.sha256(captions.build_ass(t, t.studio.style).encode()).hexdigest()[:16],
        "resolution": [64, 64], "fps": 30, "duration_sec": 43, "audio": "silent", "provenance": {"builder_code": "old-code"},
        "qa": {"status": "ok"}}), encoding="utf-8")

    with pytest.raises(SystemExit, match="narrate"):            # AI voice in the script, but no track yet
        render.render(t, reuse_video=True, log=quiet)
    wav, plan = narration.build(t, engine=FakeVoice(), log=quiet)
    assert [ln["line_id"] for ln in plan["lines"]] == [ln["line_id"] for ln in t.lines()]
    assert all(ln["window"][0] < ln["start"] and ln["end"] <= ln["window"][1] for ln in plan["lines"])

    m = render.render(topic(root), reuse_video=True, log=quiet)
    assert m["version"] == 2 and m["video_stream_from"] == "T0001_v001.mp4"
    assert m["spec_hash"] == "old-spec" and m["provenance"] == {"builder_code": "old-code"}  # the picture's own record
    assert m["narration"]["hash"] == plan["hash"] and m["video_clean"] is None
    assert _md5_video(d / "T0001_v001.mp4") == _md5_video(d / "T0001_v002.mp4")
    vol = subprocess.run(["ffmpeg", "-i", str(d / "T0001_v002.mp4"), "-map", "0:a", "-af", "volumedetect", "-f", "null", "-"],
                         capture_output=True, text=True, encoding="utf-8", errors="replace").stderr
    assert float(vol.split("max_volume:")[1].split("dB")[0]) > -20     # there is sound now
    assert state(topic(root), "G3")["state"] == "PENDING"            # G3 reviews the narrated preview

    edit_yaml(root / "topics" / "T0001_coronary_stent" / "script.yaml",
              lambda doc: doc["voice"].update(voice_name="M1"))
    with pytest.raises(SystemExit, match="narrate"):            # voice changed: the old track is not used
        render.render(topic(root), reuse_video=True, log=quiet)


def test_reuse_refuses_a_picture_with_other_captions(root):
    for item in ("assets/fonts", "blender/scripts"):
        shutil.copytree(REPO / item, root / item)
    _fake_preview(root, topic(root))                                 # manifest without matching captions hash
    with pytest.raises(SystemExit, match="자막이 바뀜"):
        render.reusable_render(topic(root), "preview", "0" * 16)

