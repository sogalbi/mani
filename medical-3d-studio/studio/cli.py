"""python -m studio <command>

  status [TOPIC]                 게이트 G0~G5 상태 (주제 생략 시 전체)
  check TOPIC                    AI 사전 검증 (근거·대본·자막·장면·자산·게시 문구·정책)
  validate                       모든 데이터 파일 스키마 검사
  render TOPIC [--final]         3D 장면 조립 + 렌더 + 자막 + 매니페스트 (최종본은 G0~G3 PASS 후)
  packet TOPIC [--gate G1]       전문가 검수용 HTML 패킷 (폰에서 열람)
  approve TOPIC GATE ...         승인 기록 (PASS/REVISE/BLOCK/UNKNOWN)
  publish-check TOPIC            Publishing QA: 게시 가능/보류 판정 + 설명란 생성
  published TOPIC --url URL      수동 업로드 후 게시 기록
  correction open|resolve ...    게시 후 오류 제보·정정 티켓 (G5)
  dashboard                      index.html 현황판 갱신
  new-topic ID SLUG --subject S  새 주제 패키지 뼈대
"""
import argparse
import sys

from . import checks, gates, packet, render
from .data import Studio, dump_yaml, load_yaml, now_iso, today

ICON = {"PASS": "✅", "REVISE": "✏️", "BLOCK": "⛔", "UNKNOWN": "❔", "PENDING": "⏳", "STALE": "♻️", "WAITING": "⏸️",
        "N/A": "·", "MONITORING": "👀", "WATCH": "⚠️", "HOLD": "⛔"}


def cmd_status(st, a):
    topics = [st.topic(a.topic)] if a.topic else [st.topic(d.name) for d in st.topic_dirs()]
    for t in topics:
        fs = checks.summarize(checks.run(t))
        print(f"\n{t.id} {t.meta.get('subject')}  [자동 점검 BLOCK {fs['BLOCK']} · WARN {fs['WARN']} · INFO {fs['INFO']}]")
        for r in gates.status(t):
            print(f"  {ICON.get(r['state'], '?')} {r['gate']} {r['name']:<8} {r['state']:<10} {r['reason'] or ''}")
        ng = gates.next_gate(t)
        if ng:
            print(f"  → 다음 할 일: {ng} ({st.policy['gates'][ng]['name']})")
    return 0


def cmd_check(st, a):
    t = st.topic(a.topic)
    fs = checks.run(t)
    order = {"BLOCK": 0, "WARN": 1, "INFO": 2}
    for f in sorted(fs, key=lambda f: (order[f.level], checks.AREAS.index(f.area), f.where)):
        if f.level == "INFO" and not a.all:
            continue
        print(f"{f.level:<5} {f.area:<10} [{f.code}] {f.message}  ({f.where})")
    s = checks.summarize(fs)
    print(f"\n합계: BLOCK {s['BLOCK']} · WARN {s['WARN']} · INFO {s['INFO']}" + ("" if a.all else "  (INFO는 --all)"))
    return 1 if s["BLOCK"] and a.strict else 0


def cmd_validate(st, a):
    from .schema import validate_all
    errors = validate_all(st)
    for e in errors:
        print(f"✗ {e}")
    print("스키마 검사: " + ("문제 없음" if not errors else f"{len(errors)}건"))
    return 1 if errors else 0


def cmd_render(st, a):
    t = st.topic(a.topic)
    quality = "final" if a.final else "preview"
    if a.final:
        rows = {r["gate"]: r for r in gates.status(t)}
        bad = [g for g in ("G0", "G1", "G2", "G3") if not rows[g]["effective"]]
        if bad:
            print(f"최종 렌더 불가: {', '.join(bad)} 가 아직 PASS가 아니에요 (프리뷰 승인 후 1080×1920 최종 렌더)")
            return 1
    m = render.render(t, quality)
    print(f"매니페스트: renders/{quality}/{t.id}_v{m['version']:03d}.manifest.json")
    return 0


def cmd_packet(st, a):
    t = st.topic(a.topic)
    g = a.gate or gates.next_gate(t) or "G4"
    p = packet.write_packet(t, g, embed=a.embed)
    print(f"검수 패킷: {p.relative_to(st.root)}")
    return 0


def cmd_approve(st, a):
    t = st.topic(a.topic)
    checked = []
    if a.checked:
        if a.checked == "all":
            gp = st.policy["gates"][a.gate]
            checked = [i["id"] for i in st.policy["checklists"].get(gp.get("checklist"), [])] if gp.get("checklist") else []
        else:
            checked = [c.strip() for c in a.checked.split(",") if c.strip()]
    try:
        rec = gates.approve(t, a.gate, a.reviewer, a.decision, checked, a.comment or "")
    except gates.GateError as e:
        print(f"기록하지 않았어요: {e}")
        return 1
    print(f"{ICON.get(rec['decision'])} {a.gate} {rec['decision']} 기록 (버전 {rec['version_hash']}, {rec['reviewer_name']})")
    return 0


def _description(t):
    st = t.studio
    pub = t.publishing
    srcs = []
    for sid in sorted({s for c in t.claims for s in c.get("source_ids") or []}):
        s = st.sources.get(sid, {})
        srcs.append(f"- {s.get('authors') or ''}, {s.get('title')}" + (f" ({s.get('year')})" if s.get("year") else "") + f" {s.get('url')}")
    return str(pub.get("description", "")).format(
        reviewer_display=pub.get("reviewer_display") or "(검수 표기 필요)",
        sources_list="\n".join(srcs),
        correction_contact=pub.get("correction_contact") or "(연락처 필요)")


def cmd_publish_check(st, a):
    t = st.topic(a.topic)
    reasons = []
    for r in gates.status(t):
        if r["gate"] == "G5":
            if r["state"] in ("HOLD", "WATCH"):
                reasons.append(f"G5 {r['state']}: {r['reason']}")
        elif not r["effective"]:
            reasons.append(f"{r['gate']} {r['name']}: {r['state']} {r['reason']}".strip())
    if t.latest_manifest("final") and not gates.verify_artifact(t, "final"):
        reasons.append("최종 영상 파일이 매니페스트 해시와 달라요 (바뀐 파일)")
    bl = checks.blockers(checks.run(t), ["publishing", "policy"])
    reasons += [f"[{b.code}] {b.message}" for b in bl]
    out = st.root / "publishing" / "out"
    out.mkdir(parents=True, exist_ok=True)
    (out / f"{t.slug}_description.txt").write_text(_description(t), encoding="utf-8")
    if reasons:
        print("⛔ 게시 보류")
        for r in dict.fromkeys(reasons):
            print(f"  - {r}")
        print(f"\n설명란 초안: publishing/out/{t.slug}_description.txt")
        return 1
    m = t.latest_manifest("final")
    print("✅ 게시 가능 (수동 업로드)")
    print(f"  영상: renders/final/{m['video']}  자막: renders/final/{m['captions_srt']}")
    print(f"  설명란: publishing/out/{t.slug}_description.txt")
    print(f"  합성 콘텐츠 공개: {t.publishing.get('synthetic_content_disclosure')} · 업로드 후: python -m studio published {t.id} --url <주소>")
    return 0


def cmd_published(st, a):
    t = st.topic(a.topic)
    m = t.latest_manifest("final")
    if not m:
        print("최종본 매니페스트가 없어요")
        return 1
    path = st.root / "publishing" / "videos.yaml"
    doc = load_yaml(path, {}) or {}
    vids = doc.get("videos") or []
    vids.append({"video_id": f"V{len(vids) + 1:04d}", "topic_id": t.id, "script_version": t.script.get("script_version"),
                 "render_version": f"final v{m['version']:03d}", "video_sha256": m["video_sha256"],
                 "gate_hashes": {r["gate"]: r["hash"] for r in gates.status(t) if r["hash"]},
                 "upload_status": "published", "published_url": a.url, "published_at": now_iso()})
    doc["videos"] = vids
    dump_yaml(path, doc)
    print(f"게시 기록: {vids[-1]['video_id']} {a.url}")
    return 0


def cmd_correction(st, a):
    path = st.root / "analytics" / "corrections.yaml"
    doc = load_yaml(path, {}) or {}
    tickets = doc.get("tickets") or []
    if a.action == "open":
        t = st.topic(a.topic)
        tk = {"ticket_id": f"TK{len(tickets) + 1:04d}", "topic_id": t.id, "severity": a.severity, "report": a.report,
              "received_at": now_iso(), "status": "open", "action": None, "reviewer": None, "resolved_at": None}
        tickets.append(tk)
        print(f"정정 티켓 {tk['ticket_id']} ({a.severity}) 열림")
        if a.severity == "critical":
            print("  ⛔ 중대한 오류 제보: 영상을 임시 비공개로 돌릴지 검토하고, G1·G3 전문가 재검증을 받으세요.")
        elif a.severity == "major":
            print("  ⚠️ G1·G3 재검증 전까지 게시 점검이 보류돼요.")
    else:
        tk = next((x for x in tickets if x["ticket_id"] == a.ticket), None)
        if not tk:
            print(f"없는 티켓: {a.ticket}")
            return 1
        if tk["severity"] in ("critical", "major") and not st.reviewer(a.reviewer or ""):
            print("중대/주요 티켓은 검수자 명부에 있는 --reviewer 가 필요해요")
            return 1
        tk.update({"status": "resolved", "action": a.fix, "reviewer": a.reviewer, "resolved_at": now_iso(), "note": a.note})
        print(f"{tk['ticket_id']} 해결 기록 ({a.fix})")
    doc["tickets"] = tickets
    dump_yaml(path, doc)
    return 0


def cmd_dashboard(st, a):
    p = packet.build_dashboard(st)
    print(f"현황판: {p.relative_to(st.root)}")
    return 0


def cmd_new_topic(st, a):
    d = st.root / "topics" / f"{a.id}_{a.slug}"
    if d.exists():
        print(f"이미 있어요: {d}")
        return 1
    d.mkdir(parents=True)
    dump_yaml(d / "topic.yaml", {
        "topic_id": a.id, "subject": a.subject, "status": "idea", "risk_level": "medium", "duplicate_score": 0.0,
        "audience": "한국어 일반 시청자", "educational_purpose": "", "scope": {"includes": [], "excludes": []},
        "required_specialties": [], "sponsorship": "none", "mentions_institution": False, "uses_patient_data": False,
        "created_at": today()})
    dump_yaml(d / "claims.yaml", {"topic_id": a.id, "claims_version": "v1", "claims": []})
    dump_yaml(d / "script.yaml", {"topic_id": a.id, "script_version": "v1", "language": "ko", "duration_sec": 40,
                                  "voice": {"status": "TODO", "asset_id": None}, "lines": []})
    for k in ("medical", "legal_policy"):
        dump_yaml(st.root / "reviews" / k / f"{d.name}.yaml", {"topic_id": a.id, "records": []})
    print(f"새 주제: topics/{d.name}/ (shots.json 은 3D Director 단계에서 작성)")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m studio", description="Medical 3D Shorts Studio")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("status"); p.add_argument("topic", nargs="?"); p.set_defaults(fn=cmd_status)
    p = sub.add_parser("check"); p.add_argument("topic"); p.add_argument("--all", action="store_true"); p.add_argument("--strict", action="store_true"); p.set_defaults(fn=cmd_check)
    p = sub.add_parser("validate"); p.set_defaults(fn=cmd_validate)
    p = sub.add_parser("render"); p.add_argument("topic"); p.add_argument("--final", action="store_true"); p.set_defaults(fn=cmd_render)
    p = sub.add_parser("packet"); p.add_argument("topic"); p.add_argument("--gate", choices=gates.ORDER)
    p.add_argument("--embed", action="store_true", help="영상을 HTML 안에 넣어 파일 하나로 보낼 수 있게"); p.set_defaults(fn=cmd_packet)
    p = sub.add_parser("approve"); p.add_argument("topic"); p.add_argument("gate", choices=gates.ORDER)
    p.add_argument("--reviewer", required=True); p.add_argument("--decision", required=True)
    p.add_argument("--checked", help="M01,M02,... 또는 all"); p.add_argument("--comment"); p.set_defaults(fn=cmd_approve)
    p = sub.add_parser("publish-check"); p.add_argument("topic"); p.set_defaults(fn=cmd_publish_check)
    p = sub.add_parser("published"); p.add_argument("topic"); p.add_argument("--url", required=True); p.set_defaults(fn=cmd_published)
    p = sub.add_parser("correction"); csub = p.add_subparsers(dest="action", required=True)
    q = csub.add_parser("open"); q.add_argument("topic"); q.add_argument("--severity", choices=["critical", "major", "minor"], required=True)
    q.add_argument("--report", required=True); q.set_defaults(fn=cmd_correction)
    q = csub.add_parser("resolve"); q.add_argument("ticket"); q.add_argument("--fix", required=True,
                                                                             choices=["none", "caption_fix", "re-edit", "unlist", "delete", "pinned_comment"])
    q.add_argument("--reviewer"); q.add_argument("--note", default=""); q.set_defaults(fn=cmd_correction)
    p = sub.add_parser("dashboard"); p.set_defaults(fn=cmd_dashboard)
    p = sub.add_parser("new-topic"); p.add_argument("id"); p.add_argument("slug"); p.add_argument("--subject", required=True); p.set_defaults(fn=cmd_new_topic)
    a = ap.parse_args(argv)
    return a.fn(Studio(), a)


if __name__ == "__main__":
    sys.exit(main())
