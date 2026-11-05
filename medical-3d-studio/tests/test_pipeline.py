"""Gate rules, pre-check rules and caption output. Run: python -m pytest -q"""
import json
import shutil
from pathlib import Path

import pytest
import yaml

from studio import captions, checks, gates
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
