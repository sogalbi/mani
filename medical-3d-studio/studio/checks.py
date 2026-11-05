"""AI 사전 검증 (automatic pre-check). Finds problems before a person reviews.

Levels: BLOCK (gate cannot PASS), WARN (reviewer should look), INFO.
Areas map to gates: claims/sources/script → G1, assets → G2, publishing/policy → G4.
"""
import datetime as dt
import json
import re
from dataclasses import asdict, dataclass


AREAS = ["topic", "claims", "sources", "script", "shots", "assets", "publishing", "policy"]


@dataclass
class Finding:
    level: str
    area: str
    code: str
    message: str
    where: str = ""

    def as_dict(self):
        return asdict(self)


def _norm(s):
    return re.sub(r"[\s\.,!?·…~\-\"'()]", "", s or "")


def syllables(s):
    return len(re.findall(r"[가-힣]", s or "")) + len(re.findall(r"[A-Za-z0-9]+", s or ""))


def _lint_text(text, where, area, lint, out):
    for rule in lint.get("banned_phrases", []):
        if re.search(rule["pattern"], text):
            out.append(Finding("BLOCK", area, "BANNED_PHRASE", f"과장·단정·유인 표현: '{re.search(rule['pattern'], text).group(0)}' ({rule['reason']})", where))
    for rule in lint.get("misconception_phrases", []):
        m = re.search(rule["pattern"], text)
        if m and not (rule.get("unless") and re.search(rule["unless"], text)):
            out.append(Finding("BLOCK", area, "MISCONCEPTION", f"오해 소지: '{m.group(0)}' ({rule['reason']})", where))
    for rule in lint.get("procedural_detail_patterns", []):
        m = re.search(rule["pattern"], text)
        if m:
            out.append(Finding("WARN", area, "PROCEDURAL_DETAIL", f"수행 세부값처럼 보임: '{m.group(0)}' ({rule['reason']})", where))


def _known_motion_presets(root):
    names = set()
    for p in (root / "assets" / "motion_presets").glob("*.json"):
        names |= set(json.loads(p.read_text(encoding="utf-8")).get("presets", {}).keys())
    return names


def _camera_presets(topic):
    p = topic.studio.root / topic.shots_doc.get("scene", {}).get("camera_presets", "")
    return set(json.loads(p.read_text(encoding="utf-8")).keys()) if p.is_file() else set()


def run(topic, today=None):
    st = topic.studio
    lint = st.policy.get("lint", {})
    today = today or dt.date.today()
    out = []
    claims = topic.claim_map
    dur = float(topic.shots_doc.get("duration_sec", 0))
    fmt = st.channel.get("format", {})

    # ---------------------------------------------------------------- topic
    if not topic.meta.get("scope", {}).get("excludes"):
        out.append(Finding("WARN", "topic", "SCOPE_EXCLUDES", "제외 범위(scope.excludes)가 비어 있어요 (M01)", "topic.yaml"))
    if not topic.meta.get("required_specialties"):
        out.append(Finding("BLOCK", "topic", "NO_SPECIALTY", "검수 전문과목(required_specialties)이 없어요", "topic.yaml"))
    if topic.meta.get("sponsorship", "none") != "none" or topic.meta.get("mentions_institution"):
        out.append(Finding("WARN", "policy", "AD_LAW_REVIEW", "협찬 또는 의료기관 언급 → G4에 법률 전문가 검토 필요 (의료광고 해당 여부)", "topic.yaml"))
    if topic.meta.get("uses_patient_data"):
        out.append(Finding("WARN", "policy", "PATIENT_DATA", "환자 자료 사용 → 개인정보·동의 별도 검토 필요 (L08)", "topic.yaml"))

    # ---------------------------------------------------------------- claims & sources
    if not claims:
        out.append(Finding("BLOCK", "claims", "NO_CLAIMS", "주장 표(claims.yaml)가 비어 있어요", "claims.yaml"))
    for cid, c in claims.items():
        w = f"claims.yaml:{cid}"
        _lint_text(c.get("statement", ""), w, "claims", lint, out)
        srcs = c.get("source_ids") or []
        if not srcs:
            out.append(Finding("BLOCK", "claims", "NO_SOURCE", "출처가 없는 주장", w))
        missing = [s for s in srcs if s not in st.sources]
        if missing:
            out.append(Finding("BLOCK", "sources", "UNKNOWN_SOURCE", f"출처 목록에 없는 ID: {', '.join(missing)}", w))
        verified = [s for s in srcs if st.sources.get(s, {}).get("verification") == "VERIFIED" and st.sources[s].get("checked_at")]
        if srcs and not verified:
            out.append(Finding("BLOCK", "sources", "UNVERIFIED_EVIDENCE",
                               "원문을 직접 확인한 출처가 하나도 없어요 → 연구 단계 보류 (사람이 원문 확인 후 VERIFIED·checked_at 기록)", w))
        if not any(e.get("quote") for e in c.get("evidence", []) or []):
            out.append(Finding("WARN", "claims", "NO_QUOTE", "원문 인용(quote)이 없어 근거 위치 확인이 어려워요", w))
        if c.get("confidence") == "low":
            out.append(Finding("WARN", "claims", "LOW_CONFIDENCE", "AI 사전 검증 신뢰도 낮음 → 전문가가 특히 확인", w))
        if c.get("reviewer_status") in ("REVISE", "BLOCK"):
            out.append(Finding("BLOCK", "claims", "REVIEWER_REJECTED", f"검수자 판정 {c['reviewer_status']} → 수정 후 재검수", w))
        if not c.get("limitations"):
            out.append(Finding("WARN", "claims", "NO_LIMITATIONS", "적용 범위·한계(limitations)가 비어 있어요", w))
    for sid in {s for c in claims.values() for s in c.get("source_ids") or []}:
        s = st.sources.get(sid)
        if s and s.get("verification") == "VERIFIED" and s.get("checked_at"):
            age = (today - dt.date.fromisoformat(str(s["checked_at"]))).days
            if age > 365:
                out.append(Finding("WARN", "sources", "STALE_SOURCE", f"{sid} 확인한 지 {age}일 → 최신 가이드라인 재확인 (M03)", "research/sources.yaml"))

    # ---------------------------------------------------------------- script
    lines = topic.lines()
    if not (fmt.get("min_sec", 30) <= dur <= fmt.get("max_sec", 60)):
        out.append(Finding("BLOCK", "script", "DURATION", f"길이 {dur}초 (허용 {fmt.get('min_sec')}~{fmt.get('max_sec')}초)", "shots.json"))
    if float(topic.script.get("duration_sec", dur)) != dur:
        out.append(Finding("BLOCK", "script", "DURATION_MISMATCH", "script.yaml 과 shots.json 의 길이가 달라요", "script.yaml"))
    t = 0.0
    shot_by_id = {s["shot_id"]: s for s in topic.shots}
    for ln in lines:
        w = f"script.yaml:{ln['line_id']}"
        if abs(float(ln["start"]) - t) > 1e-6:
            out.append(Finding("BLOCK", "script", "TIMING_GAP", f"이전 줄 끝({t})과 시작({ln['start']})이 맞지 않아요", w))
        t = float(ln["end"])
        if not ln.get("claim_ids") and ln.get("type") != "non_claim":
            out.append(Finding("BLOCK", "script", "UNSUPPORTED_LINE", "주장 ID가 없는 대본 줄 (근거 없는 주장 추가 금지)", w))
        for cid in ln.get("claim_ids") or []:
            if cid not in claims:
                out.append(Finding("BLOCK", "script", "UNKNOWN_CLAIM", f"없는 주장 ID {cid}", w))
        text = ln.get("narration", "")
        _lint_text(text, w, "script", lint, out)
        sps = syllables(text) / max(0.1, float(ln["end"]) - float(ln["start"]))
        rs = lint.get("reading_speed", {})
        if sps > rs.get("block_syllables_per_sec", 9.0):
            out.append(Finding("BLOCK", "script", "TOO_FAST", f"초당 {sps:.1f}음절 → 읽기 어려움", w))
        elif sps > rs.get("warn_syllables_per_sec", 7.5):
            out.append(Finding("WARN", "script", "FAST", f"초당 {sps:.1f}음절 → 빠른 편", w))
        caps = ln.get("captions") or []
        if caps:
            cap_text = "".join(c["text"] for c in caps)
            if _norm(cap_text) != _norm(text):
                out.append(Finding("WARN", "script", "CAPTION_MISMATCH", "자막과 내레이션 글자가 달라요 (M08)", w))
            ct = float(ln["start"])
            for c in caps:
                if abs(float(c["start"]) - ct) > 1e-6:
                    out.append(Finding("WARN", "script", "CAPTION_GAP", f"자막 시간 빈틈/겹침 ({c['start']})", w))
                ct = float(c["end"])
                rows = str(c["text"]).split("\n")
                cl = lint.get("caption", {})
                if len(rows) > cl.get("max_lines", 2):
                    out.append(Finding("WARN", "script", "CAPTION_LINES", f"자막 {len(rows)}줄", w))
                for r in rows:
                    if len(r) > cl.get("max_chars_per_line", 18):
                        out.append(Finding("WARN", "script", "CAPTION_LONG", f"자막 한 줄 {len(r)}자: '{r}'", w))
            if abs(ct - float(ln["end"])) > 1e-6:
                out.append(Finding("WARN", "script", "CAPTION_END", "마지막 자막이 줄 끝 시간과 맞지 않아요", w))
        sh = shot_by_id.get(ln.get("shot_id"))
        if not sh:
            out.append(Finding("BLOCK", "script", "UNKNOWN_SHOT", f"없는 장면 {ln.get('shot_id')}", w))
        else:
            if not (sh["start_sec"] <= ln["start"] and ln["end"] <= sh["end_sec"]):
                out.append(Finding("WARN", "script", "SHOT_TIMING", f"대본 줄이 장면 {sh['shot_id']} 시간 밖으로 나가요", w))
            extra = set(ln.get("claim_ids") or []) - set(sh.get("claim_ids") or [])
            if extra:
                out.append(Finding("WARN", "script", "SHOT_CLAIM_MISMATCH", f"장면 {sh['shot_id']}에 없는 주장 {sorted(extra)} → 3D와 대본 불일치 (M08)", w))
    if lines and abs(t - dur) > 1e-6:
        out.append(Finding("BLOCK", "script", "TIMING_END", f"대본이 {t}초에 끝나요 (영상 {dur}초)", "script.yaml"))

    # ---------------------------------------------------------------- shots
    known_actions = _known_motion_presets(st.root)
    cams = _camera_presets(topic)
    t = 0.0
    used_assets = set()
    for s in topic.shots:
        w = f"shots.json:{s['shot_id']}"
        if abs(float(s["start_sec"]) - t) > 1e-6:
            out.append(Finding("BLOCK", "shots", "SHOT_GAP", f"장면 시작 {s['start_sec']} ≠ 이전 끝 {t}", w))
        t = float(s["end_sec"])
        if not s.get("disclaimer"):
            out.append(Finding("BLOCK", "shots", "NO_DISCLAIMER", "장면에 '교육용 개념도' 표시가 없어요", w))
        for cid in s.get("claim_ids") or []:
            if cid not in claims:
                out.append(Finding("BLOCK", "shots", "UNKNOWN_CLAIM", f"없는 주장 ID {cid}", w))
        if known_actions and s.get("action") not in known_actions:
            out.append(Finding("BLOCK", "shots", "UNKNOWN_ACTION", f"모션 프리셋에 없는 동작 {s.get('action')}", w))
        if cams and s.get("camera") not in cams:
            out.append(Finding("BLOCK", "shots", "UNKNOWN_CAMERA", f"카메라 프리셋에 없는 이름 {s.get('camera')}", w))
        for lab in s.get("labels", []) or []:
            _lint_text(lab.get("text", ""), w, "shots", lint, out)
        _lint_text(s.get("description", ""), w, "shots", lint, out)
        used_assets |= set(s.get("assets") or [])
    if topic.shots and abs(t - dur) > 1e-6:
        out.append(Finding("BLOCK", "shots", "SHOTS_END", f"장면이 {t}초에 끝나요 (영상 {dur}초)", "shots.json"))

    # ---------------------------------------------------------------- assets
    used_assets.add("font_pretendard_bold")
    voice = topic.script.get("voice", {}) or {}
    if voice.get("asset_id"):
        used_assets.add(voice["asset_id"])
    for aid in sorted(used_assets):
        a = st.assets.get(aid)
        w = f"assets/registry.yaml:{aid}"
        if not a:
            out.append(Finding("BLOCK", "assets", "UNREGISTERED_ASSET", "레지스트리에 없는 자산 → 권리 확인 전 사용 금지", w))
            continue
        if a.get("commercial_use") is not True:
            out.append(Finding("BLOCK", "assets", "NO_COMMERCIAL_RIGHT", "상업적 이용 허가 불명 → 대체하거나 권리 확인", w))
        if not a.get("license"):
            out.append(Finding("BLOCK", "assets", "NO_LICENSE", "라이선스 기록 없음", w))
        if a.get("attribution") in (None, ""):
            out.append(Finding("WARN", "assets", "NO_ATTRIBUTION_NOTE", "저작자 표시 조건이 비어 있어요", w))
        if a.get("accuracy_status") == "PENDING_MEDICAL_REVIEW":
            out.append(Finding("INFO", "assets", "ACCURACY_PENDING", "모양·위치 정확도는 G3 프리뷰 검수에서 확인", w))
    if voice.get("status") in (None, "TODO"):
        out.append(Finding("INFO", "assets", "NO_VOICE", "내레이션 음성이 아직 없어요 (프리뷰는 무음 + 자막)", "script.yaml:voice"))
    elif not voice.get("asset_id"):
        out.append(Finding("BLOCK", "assets", "NO_VOICE_ASSET", "음성을 쓰는데 voice.asset_id 가 없어요 → 레지스트리에 권리와 함께 등록", "script.yaml:voice"))
    if voice.get("status") == "ai_voice":
        from . import narration  # local import: keeps the pre-check free of audio code
        cfg = narration.settings(topic)
        for ln in lines:
            spoken = narration.spoken_text(ln, cfg)
            if spoken != ln.get("narration"):
                out.append(Finding("INFO", "script", "VOICE_PRONUNCIATION", f"음성은 자막과 다르게 읽어요: '{spoken}'", f"script.yaml:{ln['line_id']}"))
        _, plan = narration.current(topic)
        if not plan:
            out.append(Finding("INFO", "script", "NARRATION_NOT_BUILT",
                               f"이 대본·음성 설정의 내레이션 트랙이 이 컴퓨터에 없어요 → python -m studio narrate {topic.id}", "script.yaml:voice"))
        else:
            for lid, msg in narration.problems(plan):
                out.append(Finding("WARN", "script", "NARRATION_TIMING", f"내레이션: {msg}", f"script.yaml:{lid}"))

    # ---------------------------------------------------------------- publishing
    pub = topic.publishing
    if not pub:
        out.append(Finding("BLOCK", "publishing", "NO_PUBLISHING", "게시 메타데이터 파일이 없어요", f"publishing/{topic.slug}.yaml"))
    else:
        w = f"publishing/{topic.slug}.yaml"
        if not pub.get("title") or len(pub["title"]) > 100:
            out.append(Finding("BLOCK", "publishing", "TITLE", "제목이 없거나 100자를 넘어요", w))
        for k in ("title", "description"):
            _lint_text(str(pub.get(k, "")), w, "publishing", lint, out)
        for t_ in pub.get("tags", []) or []:
            _lint_text(str(t_), w, "publishing", lint, out)
        if not pub.get("correction_contact"):
            out.append(Finding("BLOCK", "publishing", "NO_CORRECTION_CONTACT", "오류 제보·정정 요청 연락처가 없어요 (L10)", w))
        if not pub.get("reviewer_display"):
            out.append(Finding("BLOCK", "publishing", "NO_REVIEWER_DISPLAY", "검수 표기(실제 검수 범위만)가 비어 있어요 (M10)", w))
        if pub.get("synthetic_content_disclosure") not in ("YES", "NO"):
            out.append(Finding("BLOCK", "publishing", "SYNTHETIC_UNDECIDED", "합성·변형 콘텐츠 공개 여부를 정하지 않았어요 (정책 원문 확인 후 YES/NO)", w))
        if "교육" not in str(pub.get("description", "")):
            out.append(Finding("BLOCK", "publishing", "NO_EDU_DISCLAIMER", "설명란에 교육용·개인 진단 아님 안내가 없어요 (L09)", w))
        if topic.meta.get("sponsorship", "none") != "none" and not pub.get("paid_promotion"):
            out.append(Finding("BLOCK", "publishing", "SPONSOR_NOT_DISCLOSED", "협찬이 있는데 유료 광고 표시가 꺼져 있어요", w))
        if voice.get("status") == "ai_voice":
            if pub.get("ai_voice_used") is not True:
                out.append(Finding("BLOCK", "publishing", "AI_VOICE_FLAG", "AI 음성을 쓰는데 ai_voice_used 가 true 가 아니에요", w))
            va = st.assets.get(voice.get("asset_id")) or {}
            if va.get("ai_disclosure_required") and "AI 음성" not in str(pub.get("description", "")):
                out.append(Finding("BLOCK", "publishing", "AI_VOICE_NOT_DISCLOSED",
                                   f"설명란에 'AI 음성' 표기가 없어요 (음성 모델 라이선스 조건: {voice.get('asset_id')})", w))

    # ---------------------------------------------------------------- policy references
    refs = st.policy_refs.get("references", []) or []
    days = st.policy.get("policy_recheck_days", 30)
    if not refs:
        out.append(Finding("BLOCK", "policy", "NO_POLICY_REFS", "정책·법령 참고처가 없어요", "research/policy_refs.yaml"))
    for r in refs:
        w = f"research/policy_refs.yaml:{r.get('ref_id')}"
        if r.get("verification") != "VERIFIED":
            out.append(Finding("BLOCK", "policy", "POLICY_UNVERIFIED", f"정책 원문 미확인: {r.get('title')}", w))
        else:
            checked = r.get("checked_at") or st.policy_refs.get("checked_at")
            if not checked or (today - dt.date.fromisoformat(str(checked))).days > days:
                out.append(Finding("BLOCK", "policy", "POLICY_STALE", f"{days}일 안에 다시 확인해야 해요: {r.get('title')}", w))
    return out


def summarize(findings):
    counts = {"BLOCK": 0, "WARN": 0, "INFO": 0}
    for f in findings:
        counts[f.level] += 1
    return counts


def blockers(findings, areas):
    return [f for f in findings if f.level == "BLOCK" and f.area in areas]
