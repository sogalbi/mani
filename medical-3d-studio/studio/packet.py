"""Phone-friendly HTML pages: review packets for experts and a status dashboard.

A packet shows exactly what a gate covers (claims + sources + script for G1,
the preview video + script + shots for G3, the final metadata for G4), the
checklist, and builds the `studio approve` command for the reviewer to send back.
"""
import base64
import html
import os

from . import checks, gates

CSS = """
:root{--bg:#f6f7f9;--card:#fff;--ink:#14181f;--mute:#5b6472;--line:#e3e6eb;--accent:#2457c5;
--pass:#1f7a3f;--warn:#a15c00;--block:#b42318;--chip:#eef1f6}
@media (prefers-color-scheme:dark){:root{--bg:#0f1319;--card:#171c24;--ink:#e8ebf0;--mute:#9aa4b2;--line:#2a313c;
--accent:#7aa2ff;--pass:#5cc98a;--warn:#f0b35a;--block:#ff7a6e;--chip:#222a35}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 -apple-system,BlinkMacSystemFont,
"Apple SD Gothic Neo","Pretendard","Noto Sans KR",sans-serif}
main{max-width:760px;margin:0 auto;padding:16px}
h1{font-size:21px;margin:8px 0 2px}h2{font-size:17px;margin:22px 0 8px}
.mute{color:var(--mute);font-size:13px}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin:10px 0}
.chip{display:inline-block;background:var(--chip);border-radius:999px;padding:1px 9px;font-size:12px;margin:2px 4px 2px 0}
.PASS{color:var(--pass)}.REVISE,.WARN,.STALE,.WAITING,.WATCH{color:var(--warn)}.BLOCK,.HOLD{color:var(--block)}.UNKNOWN,.PENDING,.INFO{color:var(--mute)}
video{width:100%;max-height:78vh;border-radius:12px;background:#000}
table{width:100%;border-collapse:collapse;font-size:14px}td,th{border-bottom:1px solid var(--line);padding:6px 4px;text-align:left;vertical-align:top}
label{display:block;padding:6px 0;border-bottom:1px solid var(--line)}input[type=checkbox]{transform:scale(1.2);margin-right:8px}
textarea,input[type=text]{width:100%;font:inherit;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink)}
.row{display:flex;gap:8px;flex-wrap:wrap}.row label{border:0;flex:1;min-width:120px;background:var(--chip);border-radius:8px;padding:8px;text-align:center}
pre{white-space:pre-wrap;word-break:break-all;background:var(--chip);padding:10px;border-radius:8px;font-size:12.5px}
button{font:inherit;padding:10px 14px;border-radius:10px;border:0;background:var(--accent);color:#fff;width:100%}
a{color:var(--accent)}.small{font-size:13px}
"""


def _e(s):
    return html.escape(str(s if s is not None else ""))


def _page(title, body):
    return (f"<!doctype html><html lang='ko'><head><meta charset='utf-8'>"
            f"<meta name='viewport' content='width=device-width,initial-scale=1'><title>{_e(title)}</title>"
            f"<style>{CSS}</style></head><body><main>{body}</main></body></html>")


def _findings_html(findings, areas):
    fs = [f for f in findings if f.area in areas and f.level != "INFO"]
    if not fs:
        return "<p class='PASS'>자동 점검: 이 단계 관련 문제 없음</p>"
    rows = "".join(f"<tr><td class='{f.level}'>{f.level}</td><td>{_e(f.message)}<br><span class='mute'>{_e(f.where)}</span></td></tr>" for f in fs)
    return f"<table>{rows}</table>"


def _claims_html(topic):
    st = topic.studio
    out = []
    for c in topic.claims:
        srcs = []
        for ev in c.get("evidence") or []:
            s = st.sources.get(ev["source_id"], {})
            ver = s.get("verification", "UNVERIFIED")
            srcs.append(f"<li><b>{_e(ev['source_id'])}</b> <span class='{ 'PASS' if ver == 'VERIFIED' else 'WARN'}'>{_e(ver)}</span> "
                        f"<a href='{_e(s.get('url'))}'>{_e(s.get('title'))}</a> <span class='mute'>({_e(s.get('source_type'))}{', ' + _e(s.get('year')) if s.get('year') else ''})</span>"
                        f"<br><span class='mute'>위치: {_e(ev.get('locator'))}</span>"
                        + (f"<br>“{_e(ev['quote'])}”" if ev.get("quote") else "<br><span class='WARN'>원문 인용 없음</span>") + "</li>")
        out.append(f"<div class='card'><b>{_e(c['claim_id'])}</b> {_e(c['statement'])}"
                   f"<div class='mute small'>한계: {_e(c.get('limitations'))}</div>"
                   f"<div class='mute small'>AI 메모: {_e(c.get('ai_precheck_note'))}</div><ul class='small'>{''.join(srcs)}</ul></div>")
    return "".join(out)


def _script_html(topic):
    from . import narration
    cfg = narration.settings(topic) if narration.enabled(topic) else None

    def voice_note(ln):
        spoken = narration.spoken_text(ln, cfg) if cfg else ln["narration"]
        return f"<br><span class='mute small'>음성은 이렇게 읽어요: {_e(spoken)}</span>" if spoken != ln["narration"] else ""

    rows = "".join(f"<tr><td class='mute'>{ln['start']:g}–{ln['end']:g}초<br>{_e(ln.get('shot_id'))}</td><td>{_e(ln['narration'])}"
                   f"{voice_note(ln)}<br><span class='chip'>{' '.join(ln.get('claim_ids') or [])}</span></td></tr>" for ln in topic.lines())
    return f"<table>{rows}</table>"


def _shots_html(topic):
    rows = []
    for s in topic.shots:
        labels = ", ".join(l["text"] for l in s.get("labels") or [])
        rows.append(f"<tr><td class='mute'>{s['start_sec']}–{s['end_sec']}초<br>{_e(s['shot_id'])}</td><td>{_e(s.get('description'))}"
                    f"<br><span class='mute small'>동작 {_e(s['action'])} · 카메라 {_e(s['camera'])} · 라벨: {_e(labels or '없음')}</span>"
                    f"<br><span class='chip'>{' '.join(s.get('claim_ids') or [])}</span></td></tr>")
    return f"<table>{''.join(rows)}</table>"


def _checklist_form(topic, gate, h):
    st = topic.studio
    gp = st.policy["gates"][gate]
    items = st.policy.get("checklists", {}).get(gp.get("checklist"), []) if gp.get("checklist") else []
    boxes = "".join(f"<label><input type='checkbox' value='{i['id']}'>{_e(i['id'])} {_e(i['text'])}</label>" for i in items)
    radios = "".join(f"<label><input type='radio' name='d' value='{d}'{' checked' if d == 'UNKNOWN' else ''}> {d}</label>"
                     for d in ["PASS", "REVISE", "BLOCK", "UNKNOWN"])
    return f"""
<h2>체크리스트와 판정</h2>
<div class='card'>{boxes or '<p class=mute>이 단계는 체크리스트가 없어요.</p>'}
<p class='small mute'>확인하지 못한 항목이 있으면 PASS 대신 REVISE 또는 UNKNOWN을 고르세요. UNKNOWN은 통과로 처리되지 않아요.</p>
<div class='row'>{radios}</div>
<p><input type='text' id='rid' placeholder='검수자 ID (예: MD-01)'></p>
<p><textarea id='cm' rows='4' placeholder='의견 (PASS가 아니면 필수: 무엇을 고쳐야 하는지)'></textarea></p>
<button onclick='mk()'>판정 기록 만들기</button>
<pre id='out' class='small'>버튼을 누르면 운영자에게 보낼 기록이 여기에 나와요.</pre>
</div>
<script>
function mk(){{
 var c=[...document.querySelectorAll("input[type=checkbox]:checked")].map(x=>x.value).join(",");
 var d=(document.querySelector("input[name=d]:checked")||{{}}).value||"UNKNOWN";
 var r=document.getElementById("rid").value.trim()||"(검수자ID)";
 var m=document.getElementById("cm").value.trim().replace(/"/g,"'");
 var cmd='python -m studio approve {topic.id} {gate} --reviewer '+r+' --decision '+d+(c?' --checked '+c:'')+(m?' --comment "'+m+'"':'');
 var t="[{topic.id} {gate} 검수 결과]\\n판정: "+d+"\\n검수 대상 버전: {h}\\n확인 항목: "+(c||"없음")+"\\n의견: "+(m||"-")+"\\n\\n운영자 실행 명령:\\n"+cmd;
 document.getElementById("out").textContent=t;
 if(navigator.clipboard)navigator.clipboard.writeText(t).catch(function(){{}});
}}
</script>"""


def build_packet(topic, gate, out_dir=None, embed=False):
    st = topic.studio
    findings = checks.run(topic)
    h, why = gates.gate_hash(topic, gate)
    gp = st.policy["gates"][gate]
    head = (f"<p class='mute'>Medical 3D Shorts Studio · 검수 패킷</p><h1>{_e(topic.id)} {_e(topic.meta.get('subject'))}</h1>"
            f"<p><span class='chip'>{gate} {_e(gp.get('name'))}</span><span class='chip'>검수 대상 버전 {_e(h or '없음')}</span></p>"
            f"<p class='small'>이 단계에서 보는 것: {_e(gp.get('covers'))}. 이 페이지는 개별 환자 진단·치료 권고가 아닌 교육용 영상의 검수 자료예요. "
            f"검수 후 내용이 바뀌면 버전이 달라져 다시 검수해야 해요.</p>")
    if h is None:
        body = head + f"<div class='card BLOCK'>아직 검수할 대상이 없어요: {_e(why)}</div>"
    else:
        body = head
        if gate in ("G3", "G4"):
            q = "preview" if gate == "G3" else "final"
            m = topic.latest_manifest(q)
            vpath = st.root / "renders" / q / m["video"]
            if embed and vpath.exists():
                src = "data:video/mp4;base64," + base64.b64encode(vpath.read_bytes()).decode()
            else:
                src = os.path.relpath(vpath, out_dir) if out_dir else m["video"]
            body += (f"<h2>영상</h2><video controls playsinline preload='metadata' src='{_e(src)}'></video>"
                     f"<p class='mute small'>v{m['version']:03d} · {m['resolution'][0]}×{m['resolution'][1]} · {m['fps']}fps · {m['duration_sec']}초 · "
                     f"소리: {_e(m['audio'])} · SHA-256 {m['video_sha256'][:16]}…</p>")
        scope = topic.meta.get("scope", {})
        body += ("<h2>범위</h2><div class='card small'><b>다룸</b><ul>" + "".join(f"<li>{_e(x)}</li>" for x in scope.get("includes", []))
                 + "</ul><b>다루지 않음</b><ul>" + "".join(f"<li>{_e(x)}</li>" for x in scope.get("excludes", [])) + "</ul></div>")
        if gate in ("G1", "G3"):
            body += "<h2>대본</h2>" + _script_html(topic)
        if gate == "G3":
            body += "<h2>장면</h2>" + _shots_html(topic)
            body += ("<div class='card small'>3D 확인 포인트: 플라크가 사라지지 않고 눌리기만 하는지 · 스텐트가 플라크를 제거하는 것처럼 보이지 않는지 · "
                     "풍선이 빠진 뒤 스텐트가 남는지 · 혈구 크기·속도와 혈관 비율은 개념 표현(실제 비율 아님)으로 충분히 표시되는지 · 자막과 화면이 같은 내용인지</div>")
        if gate == "G1":
            body += "<h2>주장과 근거</h2>" + _claims_html(topic)
        if gate == "G4":
            pub = topic.publishing
            body += (f"<h2>게시 문구</h2><div class='card'><b>{_e(pub.get('title'))}</b><pre>{_e(pub.get('description'))}</pre>"
                     f"<span class='mute small'>합성 콘텐츠 공개: {_e(pub.get('synthetic_content_disclosure'))} · 유료 광고: {_e(pub.get('paid_promotion'))}</span></div>")
            refs = st.policy_refs.get("references", [])
            body += "<h2>정책·법령 참고처</h2><table>" + "".join(
                f"<tr><td class='{'PASS' if r.get('verification') == 'VERIFIED' else 'WARN'}'>{_e(r.get('verification'))}</td>"
                f"<td><a href='{_e(r.get('url'))}'>{_e(r.get('title'))}</a><br><span class='small'>{_e(r.get('implication_ko'))}</span></td></tr>" for r in refs) + "</table>"
        areas = {"G0": ["topic"], "G1": ["topic", "claims", "sources", "script"], "G2": ["assets"],
                 "G3": ["shots", "script"], "G4": ["publishing", "policy"]}[gate]
        body += "<h2>자동 점검 (AI 사전 검증)</h2>" + _findings_html(findings, areas)
        body += _checklist_form(topic, gate, h)
    return _page(f"{topic.id} {gate} 검수", body)


def write_packet(topic, gate, embed=False):
    sub = "medical" if topic.studio.policy["gates"][gate].get("log") == "medical" else "legal_policy"
    out_dir = topic.studio.root / "reviews" / sub / "packets"
    out_dir.mkdir(parents=True, exist_ok=True)
    p = out_dir / f"{topic.id}_{gate}{'_single' if embed else ''}.html"
    p.write_text(build_packet(topic, gate, out_dir, embed), encoding="utf-8")
    return p


def build_dashboard(studio):
    cards = []
    for d in studio.topic_dirs():
        t = studio.topic(d.name)
        rows = gates.status(t)
        fs = checks.summarize(checks.run(t))
        m = t.latest_manifest("preview")
        chips = "".join(f"<span class='chip {r['state']}' title='{_e(r['reason'])}'>{r['gate']} {r['state']}</span>" for r in rows)
        reasons = "".join(f"<li><b>{r['gate']} {_e(r['name'])}</b>: <span class='{r['state']}'>{r['state']}</span> {_e(r['reason'])}</li>" for r in rows)
        packets = []
        for g in ("G1", "G3", "G4"):
            sub = "medical" if g in ("G1", "G3") else "legal_policy"
            if (studio.root / "reviews" / sub / "packets" / f"{t.id}_{g}.html").exists():
                packets.append(f"<a href='reviews/{sub}/packets/{t.id}_{g}.html'>{g} 검수 패킷</a>")
        video = (f"<p class='small'>최신 프리뷰: v{m['version']:03d} · {m['rendered_at'][:16]} · SHA-256 {m['video_sha256'][:12]}… "
                 f"(영상 파일은 공개 저장소에 올리지 않아요)</p>") if m else "<p class='small mute'>아직 프리뷰 없음</p>"
        cards.append(f"<div class='card'><h2>{_e(t.id)} {_e(t.meta.get('subject'))}</h2>{chips}"
                     f"<p class='small'>자동 점검: <span class='BLOCK'>BLOCK {fs['BLOCK']}</span> · <span class='WARN'>WARN {fs['WARN']}</span> · INFO {fs['INFO']}</p>"
                     f"{video}<ul class='small'>{reasons}</ul><p>{' · '.join(packets)}</p></div>")
    body = ("<p class='mute'>Medical 3D Shorts Studio</p><h1>제작 현황</h1>"
            "<p class='small mute'>교육용 3D 의학 쇼츠. 자동화는 조사·초안·렌더까지, 게시는 사람 승인 뒤에만. "
            "UNKNOWN은 통과가 아니에요. 이 페이지는 <code>python -m studio dashboard</code>로 다시 만들어요.</p>" + "".join(cards))
    p = studio.root / "index.html"
    p.write_text(_page("제작 현황 · Medical 3D Shorts", body), encoding="utf-8")
    return p
