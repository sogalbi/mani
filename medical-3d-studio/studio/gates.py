"""Approval gates G0–G5.

Every approval is stored with a version hash of exactly what the reviewer saw.
If that content changes later (script, claims, sources, preview, metadata …)
the hash no longer matches and the gate falls back to STALE: the change must
pass the gate again. UNKNOWN is never treated as PASS.
"""
from . import checks
from .data import canonical_hash, dump_yaml, file_sha256, load_yaml, now_iso

ORDER = ["G0", "G1", "G2", "G3", "G4"]


# ------------------------------------------------------------------ content hashes
def content_hashes(topic):
    st = topic.studio
    claims = [{k: c.get(k) for k in ("claim_id", "statement", "source_ids", "limitations")} for c in topic.claims]
    used_sources = sorted({s for c in topic.claims for s in c.get("source_ids") or []})
    script = {
        "duration": topic.script.get("duration_sec"),
        "voice": topic.script.get("voice"),
        "lines": [{k: ln.get(k) for k in ("line_id", "shot_id", "start", "end", "claim_ids", "narration", "captions")}
                  for ln in topic.lines()],
    }
    shots = [{k: v for k, v in s.items() if k != "medical_review"} for s in topic.shots]
    asset_ids = sorted({a for s in topic.shots for a in s.get("assets") or []} | {"font_pretendard_bold"}
                       | ({topic.script["voice"]["asset_id"]} if (topic.script.get("voice") or {}).get("asset_id") else set()))
    return {
        "topic": canonical_hash(topic.meta),
        "claims": canonical_hash(claims),
        "sources": canonical_hash([st.sources.get(s) for s in used_sources]),
        "script": canonical_hash(script),
        "shots": canonical_hash({"scene": topic.shots_doc.get("scene"), "shots": shots}),
        "assets": canonical_hash([st.assets.get(a) for a in asset_ids]),
        "publishing": canonical_hash(topic.publishing),
        "policy_refs": canonical_hash(st.policy_refs),
    }


def _artifact(topic, quality):
    """Latest render manifest of a quality if it matches the current content."""
    m = topic.latest_manifest(quality)
    if not m:
        return None, "아직 렌더 없음"
    h = content_hashes(topic)
    stale = [k for k in ("script", "claims", "shots") if m.get(f"{k}_hash") != h[k]]
    if stale:
        return None, f"렌더 이후 {', '.join(stale)} 이(가) 바뀜 → 다시 렌더 필요"
    video = topic.studio.root / "renders" / quality / m["video"]
    if not video.exists():
        return None, f"영상 파일 없음: {m['video']}"
    return m, ""


def gate_components(topic, gate):
    """What a gate's approval covers. Returns (components dict or None, reason)."""
    h = content_hashes(topic)
    if gate == "G0":
        return {"topic": h["topic"]}, ""
    if gate == "G1":
        return {k: h[k] for k in ("topic", "claims", "sources", "script")}, ""
    if gate == "G2":
        return {"assets": h["assets"], "shots": h["shots"]}, ""
    if gate == "G3":
        m, why = _artifact(topic, "preview")
        if not m:
            return None, why
        return {"script": h["script"], "claims": h["claims"], "shots": h["shots"],
                "preview_video": m["video_sha256"][:16], "preview_version": m["version"]}, ""
    if gate == "G4":
        m, why = _artifact(topic, "final")
        if not m:
            return None, "최종본: " + why
        return {"final_video": m["video_sha256"][:16], "final_version": m["version"], "spec": m["spec_hash"],
                "publishing": h["publishing"], "policy_refs": h["policy_refs"], "script": h["script"]}, ""
    raise ValueError(gate)


def gate_hash(topic, gate):
    comp, why = gate_components(topic, gate)
    return (canonical_hash(comp) if comp is not None else None), why


# ------------------------------------------------------------------ status
def _open_serious_tickets(topic):
    return [t for t in topic.corrections() if t.get("status") != "resolved" and t.get("severity") in ("critical", "major")]


def status(topic):
    """List of dicts: gate, name, state, effective (bool), reason, record."""
    pol = topic.studio.policy.get("gates", {})
    recs = topic.approvals()
    serious = _open_serious_tickets(topic)
    reset_after = max((t.get("received_at", "") for t in serious), default="")
    rows, prev_ok = [], True
    for g in ORDER:
        h, why = gate_hash(topic, g)
        mine = all_mine = [r for r in recs if r.get("gate") == g]
        if g in ("G1", "G3") and reset_after:
            mine = [r for r in mine if r.get("timestamp", "") > reset_after]
        cur = [r for r in mine if r.get("version_hash") == h] if h else []
        if h is None:
            state, reason = "WAITING", why
        elif cur:
            state, reason = cur[-1]["decision"], cur[-1].get("comments", "")
        elif all_mine:
            state, reason = "STALE", "승인 이후 내용이 바뀜 → 다시 검수"
        else:
            state, reason = "PENDING", ""
        if g in ("G1", "G3") and reset_after and state != "PASS":
            reason = (reason + " / " if reason else "") + "정정 티켓 이후 전문가 재검증 필요"
        effective = prev_ok and state == "PASS"
        if state == "PASS" and not prev_ok:
            reason = "앞 단계가 PASS가 아니라서 아직 효력 없음"
        rows.append({"gate": g, "name": pol.get(g, {}).get("name", g), "state": state, "effective": effective,
                     "reason": reason, "hash": h, "record": cur[-1] if cur else None})
        prev_ok = effective
    # G5: post-publication monitoring
    published = [v for v in (load_yaml(topic.studio.root / "publishing/videos.yaml", {}) or {}).get("videos", []) or []
                 if v.get("topic_id") == topic.id and v.get("upload_status") == "published"]
    open_t = [t for t in topic.corrections() if t.get("status") != "resolved"]
    if any(t.get("severity") == "critical" for t in open_t):
        g5 = ("HOLD", "중대한 오류 제보 → 임시 비공개 검토·전문가 재검증")
    elif open_t:
        g5 = ("WATCH", f"열린 정정 티켓 {len(open_t)}건")
    elif published:
        g5 = ("MONITORING", "게시 후 감시 중")
    else:
        g5 = ("N/A", "아직 게시 전")
    rows.append({"gate": "G5", "name": "게시 후 감시", "state": g5[0], "effective": g5[0] in ("MONITORING", "N/A"),
                 "reason": g5[1], "hash": None, "record": None})
    return rows


def next_gate(topic):
    for r in status(topic):
        if r["gate"] != "G5" and not r["effective"]:
            return r["gate"]
    return None


# ------------------------------------------------------------------ approve
class GateError(Exception):
    pass


def approve(topic, gate, reviewer_id, decision, checked=(), comment="", findings=None, timestamp=None):
    st = topic.studio
    if gate not in ORDER:
        raise GateError(f"{gate}: 승인 기록은 G0~G4만 가능해요 (G5는 정정 티켓으로 관리)")
    decision = decision.upper()
    if decision not in st.policy.get("decisions", ["PASS", "REVISE", "BLOCK", "UNKNOWN"]):
        raise GateError(f"판정은 PASS / REVISE / BLOCK / UNKNOWN 중 하나: {decision}")
    gp = st.policy["gates"][gate]
    rv = st.reviewer(reviewer_id)
    if not rv:
        raise GateError(f"검수자 명부(config/reviewers.yaml)에 없는 ID: {reviewer_id}")
    if not rv.get("active"):
        raise GateError(f"{reviewer_id} 는 active: false 예요 (계약·자격 확인 후 true 로)")
    roles = list(gp.get("roles", []))
    flags = [f for f in gp.get("lawyer_required_if", []) if topic.meta.get(f) not in (None, False, "none")]
    if flags:
        roles = ["lawyer"]
    if rv.get("role") not in roles:
        need = "법률 전문가(lawyer) — " + ", ".join(flags) if flags else ", ".join(roles)
        raise GateError(f"{gate} 승인 권한이 없는 역할: {rv.get('role')} (필요: {need})")
    if gp.get("specialty_must_match") and rv.get("specialty") not in (topic.meta.get("required_specialties") or []):
        raise GateError(f"전문과목 불일치: {rv.get('specialty')} (필요: {topic.meta.get('required_specialties')})")
    h, why = gate_hash(topic, gate)
    if h is None:
        raise GateError(f"{gate} 를 검수할 대상이 아직 없어요: {why}")
    comp, _ = gate_components(topic, gate)

    checklist = st.policy.get("checklists", {}).get(gp.get("checklist"), []) if gp.get("checklist") else []
    checked = sorted(set(checked))
    if decision == "PASS":
        prev = [r for r in status(topic) if r["gate"] in ORDER[:ORDER.index(gate)]]
        not_ok = [r["gate"] for r in prev if not r["effective"]]
        if not_ok:
            raise GateError(f"앞 단계가 아직 PASS가 아니에요: {', '.join(not_ok)}")
        areas = gp.get("requires_no_blockers", [])
        if areas:
            fs = findings if findings is not None else checks.run(topic)
            bl = checks.blockers(fs, areas + (["policy"] if gate == "G4" else []))
            if bl:
                raise GateError("자동 점검에 BLOCK 항목이 남아 있어 PASS 불가:\n" + "\n".join(f"  - [{b.code}] {b.message} ({b.where})" for b in bl[:12]))
        missing = [c["id"] for c in checklist if c["id"] not in checked]
        if missing:
            raise GateError(f"체크리스트 미확인 항목: {', '.join(missing)} → PASS 대신 REVISE 또는 UNKNOWN")
    if decision != "PASS" and not comment:
        raise GateError("PASS가 아닌 판정에는 이유(--comment)가 필요해요")

    rec = {
        "gate": gate,
        "decision": decision,
        "reviewer_id": reviewer_id,
        "reviewer_name": rv.get("name"),
        "role": rv.get("role"),
        "specialty": rv.get("specialty"),
        "timestamp": timestamp or now_iso(),
        "version_hash": h,
        "components": comp,
        "scope": gp.get("covers"),
        "checked_items": checked,
        "comments": comment,
    }
    log_path = topic.review_log_paths()[gp.get("log", "medical")]
    log = load_yaml(log_path, {}) or {}
    log.setdefault("topic_id", topic.id)
    log.setdefault("records", [])
    log["records"] = (log["records"] or []) + [rec]
    dump_yaml(log_path, log)
    return rec


def verify_artifact(topic, quality):
    """True if the latest manifest's video file still has the recorded hash."""
    m = topic.latest_manifest(quality)
    if not m:
        return False
    p = topic.studio.root / "renders" / quality / m["video"]
    return p.exists() and file_sha256(p) == m["video_sha256"]
