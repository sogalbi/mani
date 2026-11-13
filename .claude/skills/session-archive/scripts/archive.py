#!/usr/bin/env python3
"""Claude 대화 보관함 - helper script for the session-archive skill.

Claude fetches data with tools (list_sessions, list_events, Google Drive).
Every tool result lands in this session's transcripts on disk (big ones in a
tool-results/*.txt file beside them, sub-agents in subagents/*.jsonl), so this
script reads the results back from disk instead of Claude retyping them.
It makes no network calls and never needs secrets.

Typical order (see SKILL.md):
  init    -> state.json from the Drive state file (or empty) + folder ids
  select  -> which sessions need work, in batches for sub-agents
  todo    -> the next list_events calls still needed
  build   -> one Markdown file per session + upload.json
  refs    -> upload references for files not uploaded yet
  ids     -> record Drive doc ids, update state
  index   -> 00_목차.md + digest.md (with links) for the idea map
  state   -> _보관상태.json to upload
  status  -> short progress report
"""
import argparse
import datetime as dt
import glob
import hashlib
import json
import os
import re

STATE_FORMAT = "claude-session-archive/v1"
KST = dt.timezone(dt.timedelta(hours=9))
EVENTS_TOOL = "mcp__claude-code-remote__list_events"
SESSIONS_TOOL = "mcp__claude-code-remote__list_sessions"
DRIVE_CREATE = "mcp__Google_Drive__create_file"
DRIVE_READ = ("mcp__Google_Drive__read_file_content", "mcp__Google_Drive__download_file_content")
PAGE_LIMIT = 100
KINDS = ["user", "assistant"]


# --------------------------------------------------------------------------
# reading tool results back from the transcripts
# --------------------------------------------------------------------------

def transcript_files(extra_roots):
    roots = [os.path.expanduser("~/.claude/projects")] + list(extra_roots or [])
    files = []
    for r in roots:
        files += glob.glob(os.path.join(r, "**", "*.jsonl"), recursive=True)
    seen, out = set(), []
    for f in files:
        rp = os.path.realpath(f)
        if rp not in seen and os.path.isfile(rp):
            seen.add(rp)
            out.append(rp)
    return sorted(out, key=os.path.getmtime)


SAVED_RE = re.compile(r"saved to (/[^\s{]+?\.txt)")


def result_text(content):
    if isinstance(content, str):
        text = content
    elif isinstance(content, list):
        text = "\n".join(b.get("text", "") for b in content if isinstance(b, dict))
    else:
        text = ""
    m = SAVED_RE.search(text[:3000])
    if m and os.path.isfile(m.group(1)):
        with open(m.group(1), encoding="utf-8", errors="replace") as fh:
            return fh.read()
    return text


def harvest(extra_roots, names):
    """Yield (order, tool_name, input, result_text) for finished tool calls."""
    calls, order = {}, 0
    for f in transcript_files(extra_roots):
        try:
            fh = open(f, encoding="utf-8", errors="replace")
        except OSError:
            continue
        with fh:
            for line in fh:
                if '"tool_' not in line:
                    continue
                try:
                    o = json.loads(line)
                except ValueError:
                    continue
                msg = o.get("message") if isinstance(o, dict) else None
                content = msg.get("content") if isinstance(msg, dict) else None
                if not isinstance(content, list):
                    continue
                for b in content:
                    if not isinstance(b, dict):
                        continue
                    if b.get("type") == "tool_use" and b.get("name") in names:
                        calls[b.get("id")] = (b.get("name"), b.get("input") or {})
                    elif b.get("type") == "tool_result" and b.get("tool_use_id") in calls:
                        name, inp = calls.pop(b["tool_use_id"])
                        if b.get("is_error"):
                            continue
                        order += 1
                        yield order, name, inp, result_text(b.get("content"))


def ccr_payload(text):
    """JSON inside an <other-session> wrapper -> the 'ccr' object."""
    i = text.find('{"ccr"')
    if i < 0:
        return None
    j = text.rfind("</other-session")
    blob = text[i:j] if j > i else text[i:]
    try:
        return json.loads(blob.strip()).get("ccr")
    except ValueError:
        return None


class Harvest:
    def __init__(self, extra_roots=None):
        self.sessions = {}      # id -> session record (latest seen)
        self.pages = {}         # (sid, mode, cursor) -> page
        self.creates = []       # dicts: title, id, url, parent
        self.state_reads = []   # parsed state dicts read from Drive
        names = {EVENTS_TOOL, SESSIONS_TOOL, DRIVE_CREATE, *DRIVE_READ}
        for order, name, inp, text in harvest(extra_roots, names):
            if name == SESSIONS_TOOL:
                p = ccr_payload(text)
                for s in (p or {}).get("data", []):
                    if isinstance(s, dict) and s.get("id"):
                        self.sessions[s["id"]] = s
            elif name == EVENTS_TOOL:
                p = ccr_payload(text)
                sid = inp.get("session_id")
                if p is None or not sid:
                    continue
                p.setdefault("data", [])
                if inp.get("after_id"):
                    key = (sid, "after", inp["after_id"])
                elif inp.get("before_id"):
                    key = (sid, "before", inp["before_id"])
                else:
                    key = (sid, "start", None)
                p["_order"] = order
                self.pages[key] = p  # a later fetch of the same cursor wins
            elif name == DRIVE_CREATE:
                try:
                    r = json.loads(text)
                except ValueError:
                    continue
                if isinstance(r, dict) and r.get("id"):
                    self.creates.append({"title": r.get("title") or inp.get("title"), "id": r["id"],
                                         "url": r.get("viewUrl"), "parent": r.get("parentId") or inp.get("parentId")})
            elif name in DRIVE_READ:
                st = parse_state_text(text)
                if st:
                    self.state_reads.append(st)


def parse_state_text(text):
    if STATE_FORMAT not in text:
        return None
    candidates = [text]
    try:
        r = json.loads(text)
        if isinstance(r, dict):
            for k in ("fileContent", "content", "text"):
                if isinstance(r.get(k), str):
                    candidates.insert(0, r[k])
    except ValueError:
        pass
    for c in candidates:
        i, j = c.find("{"), c.rfind("}")
        if i < 0 or j < i:
            continue
        try:
            st = json.loads(c[i:j + 1])
        except ValueError:
            continue
        if isinstance(st, dict) and st.get("format") == STATE_FORMAT:
            return st
    return None


# --------------------------------------------------------------------------
# state
# --------------------------------------------------------------------------

def empty_state():
    return {"format": STATE_FORMAT, "folder_id": None, "sessions_folder_id": None, "sessions": {}}


def state_path(work):
    return os.path.join(work, "state.json")


def load_state(work):
    if not os.path.isfile(state_path(work)):
        raise SystemExit("state.json이 없어요. 먼저 `archive.py init --work %s ...`를 실행하세요." % work)
    with open(state_path(work), encoding="utf-8") as fh:
        return json.load(fh)


def save_state(work, st):
    os.makedirs(work, exist_ok=True)
    tmp = state_path(work) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(st, fh, ensure_ascii=False, indent=1)
    os.replace(tmp, state_path(work))


# --------------------------------------------------------------------------
# which sessions, and which list_events call comes next
# --------------------------------------------------------------------------

def current_session_id():
    sid = os.environ.get("CLAUDE_CODE_REMOTE_SESSION_ID") or ""
    return re.sub(r"^cse_", "session_", sid)


def select_sessions(h, st, args):
    rows = list(h.sessions.values())
    me = current_session_id()
    rows = [s for s in rows if s["id"] != me or args.include_current]
    if args.ids:
        want = set(x.strip() for x in args.ids.split(",") if x.strip())
        rows = [s for s in rows if s["id"] in want]
    if args.since:
        rows = [s for s in rows if (s.get("updated_at") or "") >= args.since]
    if args.query:
        q = args.query.lower()
        rows = [s for s in rows if q in (s.get("title") or "").lower()]
    rows.sort(key=lambda s: s.get("updated_at") or "", reverse=True)
    if not args.all_again:
        def changed(s):
            prev = st["sessions"].get(s["id"])
            return not prev or (s.get("updated_at") or "") > (prev.get("updated_at") or "")
        rows = [s for s in rows if changed(s)]
    if args.limit:
        rows = rows[: args.limit]
    return rows


def chain(h, sid, after=None):
    """Follow the fetched pages of one session.

    Without `after` the whole history is read newest -> oldest
    (no cursor, then before_id=first_id ...).  With `after` (the newest event
    id archived last time) only newer events are read (after_id=last_id ...).
    Returns (status, pages, next_call, newest_event_id)."""
    base = {"session_id": sid, "limit": PAGE_LIMIT, "kinds": KINDS}
    pages = []
    if after:
        newest, cur = after, h.pages.get((sid, "after", after))
        if cur is None:
            return "need", pages, dict(base, after_id=after), newest
        while True:
            pages.append(cur)
            if cur.get("last_id"):
                newest = cur["last_id"]
            if not cur.get("has_more") or not cur.get("last_id"):
                return "done", pages, None, newest
            nxt = h.pages.get((sid, "after", cur["last_id"]))
            if nxt is None:
                return "need", pages, dict(base, after_id=cur["last_id"]), newest
            cur = nxt
    cur = h.pages.get((sid, "start", None))
    if cur is None:
        return "need", pages, base, None
    newest = cur.get("last_id")
    while True:
        pages.append(cur)
        if not cur.get("has_more") or not cur.get("first_id"):
            return "done", pages, None, newest
        nxt = h.pages.get((sid, "before", cur["first_id"]))
        if nxt is None:
            return "need", pages, dict(base, before_id=cur["first_id"]), newest
        cur = nxt


def plan_for(h, st, args):
    plan = []
    for s in select_sessions(h, st, args):
        prev = st["sessions"].get(s["id"])
        after = None if (args.all_again or not prev) else prev.get("cursor")
        status, pages, call, newest = chain(h, s["id"], after)
        plan.append({"s": s, "status": status, "pages": pages, "call": call, "after": after, "newest": newest})
    return plan


# --------------------------------------------------------------------------
# events -> dialogue
# --------------------------------------------------------------------------

NOISE_PREFIXES = (
    "<system-reminder", "<command-", "<local-command", "<task-notification",
    "<user-prompt-submit-hook", "Caveat:", "[Request interrupted", "<bash-",
    "<other-session", "This session is being continued", "<wake", "<webhook",
    "<child-session-event", "<event ", "<scheduled", "<tick", "Base directory for this skill",
    "<session-start-hook", "<untrusted_external_data", "<agent-message", "[SYSTEM NOTIFICATION",
)
TAG_STRIP = re.compile(r"<(system-reminder)[^>]*>.*?</\1[^>]*>", re.S)
PASTE_RE = re.compile(r"<pasted_content[^>]*>(.*?)</pasted_content[^>]*>", re.S)

SECRET_PATTERNS = [
    (re.compile(r"sk-ant-[A-Za-z0-9_\-]{20,}"), "[가림:API키]"),
    (re.compile(r"sk-(?:proj-)?[A-Za-z0-9_\-]{20,}"), "[가림:API키]"),
    (re.compile(r"AIza[0-9A-Za-z_\-]{35}"), "[가림:API키]"),
    (re.compile(r"(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}"), "[가림:토큰]"),
    (re.compile(r"xox[abprs]-[A-Za-z0-9\-]{10,}"), "[가림:토큰]"),
    (re.compile(r"AKIA[0-9A-Z]{16}"), "[가림:키]"),
    (re.compile(r"\b\d{8,10}:AA[A-Za-z0-9_\-]{30,}\b"), "[가림:봇토큰]"),
    (re.compile(r"\b(?:EAA|IGQV|IGAA|THAA)[A-Za-z0-9_\-]{40,}"), "[가림:토큰]"),
    (re.compile(r"(?i)bearer\s+[A-Za-z0-9._\-]{20,}"), "Bearer [가림]"),
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----", re.S), "[가림:개인키]"),
    (re.compile(r"(?i)((?:api[_\- ]?key|access[_\- ]?token|secret|password|passwd|비밀번호|토큰)\s*[:=]\s*[\"']?)([^\s\"'`]{8,})"),
     lambda m: m.group(1) + "[가림]"),
]


def redact(text):
    for pat, rep in SECRET_PATTERNS:
        text = pat.sub(rep, text)
    return text


def clean_user_text(text):
    text = TAG_STRIP.sub("", text)
    text = PASTE_RE.sub(lambda m: "\n[붙여넣은 글]\n" + m.group(1).strip()[:3000] + "\n", text)
    return text.strip()


def is_noise(text):
    t = text.lstrip()
    return not t or t.startswith(NOISE_PREFIXES)


def tool_label(b):
    name = b.get("name") or "도구"
    inp = b.get("input") or {}
    short = name.split("__")[-1]
    desc = inp.get("description") or inp.get("title") or inp.get("query") or ""
    if isinstance(desc, str) and desc.strip():
        return "%s(%s)" % (short, desc.strip().splitlines()[0][:60])
    return short


def to_kst(ts):
    if not ts:
        return None
    try:
        t = dt.datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None
    return t.astimezone(KST)


def events_of(pages):
    """Pages (any order) -> chronological unique events."""
    def page_key(p):
        first = p["data"][0].get("created_at", "") if p.get("data") else ""
        return (first, p.get("_order", 0))
    seen, out = set(), []
    for p in sorted(pages, key=page_key):
        for e in p.get("data", []):
            kind = "user" if "user" in e else ("assistant" if "assistant" in e else None)
            if not kind:
                continue
            inner = e[kind] or {}
            uid = inner.get("uuid")
            if uid and uid in seen:
                continue
            seen.add(uid)
            out.append((e.get("created_at") or "", len(out), kind, inner.get("internal_anthropic_catchall") or inner))
    out.sort(key=lambda x: (x[0], x[1]))
    return out


def dialogue(pages):
    """-> list of turns {who, time, text, tools:[...]}."""
    turns = []
    for created, _, kind, cat in events_of(pages):
        if cat.get("parent_tool_use_id"):
            continue  # sub-agent internals
        if cat.get("isSynthetic") or cat.get("is_synthetic") or cat.get("isMeta"):
            continue
        msg = cat.get("message") or {}
        content = msg.get("content")
        if isinstance(content, str):
            content = [{"type": "text", "text": content}]
        if not isinstance(content, list):
            continue
        t = to_kst(created or cat.get("timestamp"))
        if kind == "user":
            parts, images = [], 0
            for b in content:
                if not isinstance(b, dict):
                    continue
                if b.get("type") == "text" and not is_noise(b.get("text", "")):
                    txt = clean_user_text(b["text"])
                    if txt and not is_noise(txt):
                        parts.append(txt)
                elif b.get("type") == "image":
                    images += 1
            if images:
                parts.append("[사진 %d장 첨부]" % images)
            if parts:
                turns.append({"who": "나", "time": t, "text": "\n\n".join(parts), "tools": []})
        else:
            for b in content:
                if not isinstance(b, dict):
                    continue
                if b.get("type") == "text" and b.get("text", "").strip():
                    if turns and turns[-1]["who"] == "Claude" and not turns[-1]["tools"]:
                        turns[-1]["text"] = (turns[-1]["text"] + "\n\n" + b["text"].strip()).strip()
                    else:
                        turns.append({"who": "Claude", "time": t, "text": b["text"].strip(), "tools": []})
                elif b.get("type") == "tool_use":
                    if not turns or turns[-1]["who"] != "Claude":
                        turns.append({"who": "Claude", "time": t, "text": "", "tools": []})
                    turns[-1]["tools"].append(tool_label(b))
    return turns


# --------------------------------------------------------------------------
# Markdown (Drive turns it into a Google Doc)
# --------------------------------------------------------------------------

ORIGIN = {"android": "폰 앱", "ios": "폰 앱", "claude_code_cli": "PC", "desktop_app": "PC 앱",
          "web": "웹", "claude_code_mcp_seed": "PC(하위 세션)"}
BUCKET = {"SESSION_STATUS_BUCKET_COMPLETED": "완료", "SESSION_STATUS_BUCKET_BLOCKED": "내 답 기다림",
          "SESSION_STATUS_BUCKET_REVIEW_READY": "확인 필요", "SESSION_STATUS_BUCKET_WORKING": "진행 중",
          "SESSION_STATUS_BUCKET_FAILED": "오류로 멈춤"}
NON_BMP = re.compile("[\U00010000-\U0010FFFF]️?|‍")
URL_RE = re.compile(r"https?://([^/\s)]+)[^\s)]*")


def drive_safe(s):
    """Drive's Markdown import garbles, and can cut the text after, characters
    outside the Basic Multilingual Plane (most emoji). Drop them."""
    return NON_BMP.sub("", s)


def md_body(s):
    """Headings inside a reply would clash with the document outline: make them bold lines."""
    s = re.sub(r"^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$", r"**\1**", s, flags=re.M)
    return re.sub(r"^(\s*)(---+|===+)\s*$", r"\1", s, flags=re.M)


def one_line(s, n):
    s = URL_RE.sub(lambda m: m.group(0) if len(m.group(0)) <= 50 else "[링크:%s]" % m.group(1), s or "")
    s = re.sub(r"\s+", " ", s).strip()
    return s if len(s) <= n else s[: n - 1] + "…"


def fmt_time(t):
    return t.strftime("%Y-%m-%d %H:%M") if t else ""


def safe_name(s, n=40):
    s = re.sub(r"[\\/:*?\"<>|\n\r\t]+", " ", s or "제목 없음").strip()
    return s[:n].strip() or "제목 없음"


def tools_line(tools):
    more = " 외" if len(tools) > 5 else ""
    return "_(작업 %d건: %s%s)_" % (len(tools), ", ".join(tools[:5]), more)


def session_markdown(s, turns, part_label, first_time, last_time):
    pts = s.get("post_turn_summary") or {}
    L = ["# %s%s" % (s.get("title") or "제목 없음", (" " + part_label) if part_label else ""), ""]
    L.append("- 기간: %s ~ %s (한국 시간)" % (fmt_time(first_time), fmt_time(last_time)))
    L.append("- 어디서: %s" % ORIGIN.get(s.get("origin"), s.get("origin") or "-"))
    L.append("- 상태: %s" % BUCKET.get(s.get("status_bucket"), "-"))
    if pts.get("recent_action"):
        L.append("- 마지막 상황: %s" % pts["recent_action"])
    if pts.get("needs_action"):
        L.append("- 남은 일: %s" % pts["needs_action"])
    L.append("- 세션 열기: [claude.ai에서 보기](https://claude.ai/code/%s)" % s["id"])
    L.append("- 세션 ID: %s" % s["id"])
    L.append("")
    mine = [t for t in turns if t["who"] == "나"]
    L += ["## 내가 한 말 모음 (%d개)" % len(mine), ""]
    for i, t in enumerate(mine, 1):
        L.append("%d. (%s) %s" % (i, fmt_time(t["time"]), one_line(t["text"], 220)))
    L += ["", "## 대화 전문", ""]
    for t in turns:
        if t["who"] == "Claude" and not t["text"]:
            L += [tools_line(t["tools"]), ""]
            continue
        L += ["### %s · %s" % (t["who"], fmt_time(t["time"])), "", md_body(t["text"]), ""]
        if t["tools"]:
            L += [tools_line(t["tools"]), ""]
    return drive_safe(redact("\n".join(L).rstrip() + "\n"))


def file_ref(path):
    with open(path, "rb") as fh:
        h = hashlib.sha256(fh.read()).hexdigest()
    return "sha256:%s:%s" % (h, os.path.abspath(path))


def write_text(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


def out_dir(work):
    return os.path.join(work, "out")


def doc_url(doc_id):
    return "https://docs.google.com/document/d/%s" % doc_id


# --------------------------------------------------------------------------
# commands
# --------------------------------------------------------------------------

def cmd_init(args):
    h = Harvest(args.extra_root)
    if os.path.isfile(state_path(args.work)) and not args.reset:
        st = load_state(args.work)
        source = "local"
    elif h.state_reads:
        st = empty_state()
        st.update(h.state_reads[-1])
        source = "drive"
    else:
        st = empty_state()
        source = "new"
    if args.folder_id:
        st["folder_id"] = args.folder_id
    if args.sessions_folder_id:
        st["sessions_folder_id"] = args.sessions_folder_id
    save_state(args.work, st)
    print(json.dumps({"state_from": source, "archived_sessions": len(st["sessions"]),
                      "sessions_listed": len(h.sessions), "folder_id": st["folder_id"],
                      "sessions_folder_id": st["sessions_folder_id"]}, ensure_ascii=False))


def cmd_select(args):
    h = Harvest(args.extra_root)
    st = load_state(args.work)
    rows = select_sessions(h, st, args)
    if args.pending:
        rows = [p["s"] for p in plan_for(h, st, args) if p["status"] == "need"]
    print(json.dumps({"selected": len(rows), "new": sum(1 for s in rows if s["id"] not in st["sessions"]),
                      "updated": sum(1 for s in rows if s["id"] in st["sessions"])}, ensure_ascii=False))
    for i in range(0, len(rows), args.chunk):
        print(",".join(s["id"] for s in rows[i:i + args.chunk]))


def cmd_todo(args):
    h = Harvest(args.extra_root)
    if not h.sessions:
        raise SystemExit("세션 목록이 없어요. list_sessions(mine=true, limit=100)를 has_more가 없어질 때까지 불러 주세요.")
    st = load_state(args.work)
    plan = plan_for(h, st, args)
    need = [p for p in plan if p["status"] == "need"]
    print(json.dumps({"selected": len(plan), "done": len(plan) - len(need), "need": len(need),
                      "pages_fetched": sum(len(p["pages"]) for p in plan)}, ensure_ascii=False))
    for p in need[: args.batch]:
        print(json.dumps(p["call"], ensure_ascii=False))


def cmd_build(args):
    h = Harvest(args.extra_root)
    st = load_state(args.work)
    sess_dir = os.path.join(out_dir(args.work), "sessions")
    os.makedirs(sess_dir, exist_ok=True)
    used_titles = {d["title"] for rec in st["sessions"].values() for d in rec.get("docs", [])}
    manifest, not_done, no_change = [], [], 0
    for p in plan_for(h, st, args):
        s = p["s"]
        if p["status"] != "done":
            not_done.append(s["id"])
            continue
        turns = dialogue(p["pages"])
        if p["after"] and not turns:
            rec = st["sessions"].setdefault(s["id"], {"docs": []})
            rec.update(updated_at=s.get("updated_at"), cursor=p["newest"] or rec.get("cursor"))
            no_change += 1
            continue
        times = [t["time"] for t in turns if t["time"]]
        first_t = min(times) if times else to_kst(s.get("created_at"))
        last_t = max(times) if times else to_kst(s.get("updated_at"))
        day = (to_kst(s.get("created_at")) or first_t or dt.datetime.now(KST)).strftime("%Y-%m-%d")
        part = ("(이어서 %s~)" % first_t.strftime("%m-%d")) if p["after"] and first_t else ""
        title = "%s %s%s" % (day, safe_name(s.get("title")), (" " + part) if part else "")
        base, n = title, 2
        while title in used_titles:
            title = "%s #%d" % (base, n)
            n += 1
        used_titles.add(title)
        fname = re.sub(r"\s+", "_", title)[:80] + ".md"
        path = os.path.join(sess_dir, fname)
        write_text(path, session_markdown(s, turns, part, first_t, last_t))
        manifest.append({"session_id": s["id"], "title": title, "path": os.path.abspath(path),
                         "ref": file_ref(path), "cursor": p["newest"], "updated_at": s.get("updated_at"),
                         "first": fmt_time(first_t), "last": fmt_time(last_t), "turns": len(turns),
                         "part": bool(part)})
        # material for the idea map
        mine = [t for t in turns if t["who"] == "나"]
        pick = mine[:4] + (mine[-2:] if len(mine) > 6 else mine[4:6])
        last_claude = next((t["text"] for t in reversed(turns) if t["who"] == "Claude" and t["text"]), "")
        manifest[-1]["digest"] = {"mine": [one_line(t["text"], 110) for t in pick],
                                  "last": one_line(last_claude, 220)}
    write_text(os.path.join(out_dir(args.work), "upload.json"), json.dumps(manifest, ensure_ascii=False, indent=1))
    save_state(args.work, st)
    print(json.dumps({"written": len(manifest), "not_complete": len(not_done), "no_new_talk": no_change,
                      "manifest": os.path.join(out_dir(args.work), "upload.json")}, ensure_ascii=False))
    if not_done:
        print("아직 다 못 불러온 세션: " + ",".join(not_done[:30]))


def uploaded_titles(h, st):
    parent = st.get("sessions_folder_id")
    return {c["title"]: c for c in h.creates if parent and c["parent"] == parent}


def cmd_refs(args):
    h = Harvest(args.extra_root)
    st = load_state(args.work)
    if not st.get("sessions_folder_id"):
        raise SystemExit("세션 폴더 id가 없어요. init --sessions-folder-id 로 넣어 주세요.")
    with open(os.path.join(out_dir(args.work), "upload.json"), encoding="utf-8") as fh:
        manifest = json.load(fh)
    done = uploaded_titles(h, st)
    left = [m for m in manifest if m["title"] not in done]
    print(json.dumps({"total": len(manifest), "left": len(left), "parentId": st["sessions_folder_id"]}, ensure_ascii=False))
    for m in left[: args.batch]:
        print(json.dumps({"title": m["title"], "base64Content": m["ref"]}, ensure_ascii=False))


def cmd_ids(args):
    h = Harvest(args.extra_root)
    st = load_state(args.work)
    with open(os.path.join(out_dir(args.work), "upload.json"), encoding="utf-8") as fh:
        manifest = json.load(fh)
    done = uploaded_titles(h, st)
    recorded, missing = 0, []
    for m in manifest:
        c = done.get(m["title"])
        if not c:
            missing.append(m["title"])
            continue
        rec = st["sessions"].setdefault(m["session_id"], {"docs": []})
        rec.setdefault("docs", [])
        if c["id"] not in [d["id"] for d in rec["docs"]]:
            rec["docs"].append({"id": c["id"], "title": m["title"], "first": m["first"], "last": m["last"]})
        rec.update(updated_at=m["updated_at"], cursor=m["cursor"])
        recorded += 1
    save_state(args.work, st)
    print(json.dumps({"recorded": recorded, "missing": len(missing), "missing_titles": missing[:10]}, ensure_ascii=False))


def cmd_index(args):
    h = Harvest(args.extra_root)
    st = load_state(args.work)
    now = dt.datetime.now(KST).strftime("%Y-%m-%d %H:%M")
    rows = []
    for sid, rec in st["sessions"].items():
        docs = rec.get("docs") or []
        if docs:
            rows.append((docs[0].get("first") or "", sid, h.sessions.get(sid) or {}, docs))
    rows.sort(key=lambda r: r[0], reverse=True)
    L = ["# Claude 대화 보관함 - 목차", "",
         "세션 %d개 · 마지막 정리 %s (한국 시간)" % (len(rows), now), "",
         "주제별 묶음과 아이디어는 01_아이디어_연결맵 문서에 있어요. 제목을 누르면 그 세션의 대화 전문이 열려요.", ""]
    month = None
    for first, sid, s, docs in rows:
        if first[:7] != month:
            month = first[:7]
            if L[-1] != "":
                L.append("")
            L += ["## %s" % (month or "날짜 모름"), ""]
        title = s.get("title") or docs[0]["title"]
        more = "".join(" · [이어서 %d](%s)" % (i, doc_url(d["id"])) for i, d in enumerate(docs[1:], 1))
        pts = s.get("post_turn_summary") or {}
        summary = pts.get("recent_action") or pts.get("needs_action") or ""
        L.append("- %s [%s](%s)%s%s" % (first[5:10].replace("-", "/"), title, doc_url(docs[0]["id"]), more,
                                         (" - " + one_line(summary, 90)) if summary else ""))
    index_path = os.path.join(out_dir(args.work), "00_목차.md")
    write_text(index_path, drive_safe(redact("\n".join(L) + "\n")))

    # digest of this run's sessions, with links, for writing the idea map
    with open(os.path.join(out_dir(args.work), "upload.json"), encoding="utf-8") as fh:
        manifest = json.load(fh)
    links = {d["title"]: doc_url(d["id"]) for rec in st["sessions"].values() for d in rec.get("docs", [])}
    D = ["# 이번에 보관한 세션 요약 (연결맵 작성용)", "", "정리 시각: %s · 세션 %d개" % (now, len(manifest)), ""]
    for m in manifest:
        s = h.sessions.get(m["session_id"]) or {}
        pts = s.get("post_turn_summary") or {}
        D.append("## %s" % m["title"])
        D.append("- 링크: %s" % links.get(m["title"], "(아직 안 올림)"))
        D.append("- 상태: %s · 대화 %d턴 · %s ~ %s" % (BUCKET.get(s.get("status_bucket"), "-"), m["turns"], m["first"], m["last"]))
        if pts.get("recent_action") or pts.get("needs_action"):
            D.append("- 요약: %s" % one_line(" ".join(x for x in (pts.get("recent_action"), pts.get("needs_action")) if x), 220))
        for x in m.get("digest", {}).get("mine", []):
            D.append("- 나: %s" % x)
        if m.get("digest", {}).get("last"):
            D.append("- Claude 마지막: %s" % m["digest"]["last"])
        D.append("")
    digest_path = os.path.join(out_dir(args.work), "digest.md")
    write_text(digest_path, drive_safe(redact("\n".join(D))))
    print(json.dumps({"index": index_path, "index_ref": file_ref(index_path), "sessions_in_index": len(rows),
                      "digest": digest_path, "digest_chars": os.path.getsize(digest_path)}, ensure_ascii=False))


def cmd_ref(args):
    print(json.dumps({"base64Content": file_ref(args.path)}, ensure_ascii=False))


def cmd_state(args):
    st = load_state(args.work)
    path = os.path.join(out_dir(args.work), "_보관상태.json")
    write_text(path, json.dumps(st, ensure_ascii=False, separators=(",", ":")))
    print(json.dumps({"path": path, "base64Content": file_ref(path), "sessions": len(st["sessions"]),
                      "parentId": st.get("folder_id")}, ensure_ascii=False))


def cmd_status(args):
    h = Harvest(args.extra_root)
    st = load_state(args.work) if os.path.isfile(state_path(args.work)) else empty_state()
    print(json.dumps({"sessions_listed": len(h.sessions), "pages_harvested": len(h.pages),
                      "archived_sessions": len(st["sessions"]), "drive_uploads_seen": len(h.creates),
                      "state_read_from_drive": bool(h.state_reads), "folder_id": st.get("folder_id"),
                      "sessions_folder_id": st.get("sessions_folder_id")}, ensure_ascii=False))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p):
        p.add_argument("--work", required=True, help="작업 폴더 (scratchpad 아래)")
        p.add_argument("--extra-root", action="append", default=[], help="추가로 훑을 기록 폴더")

    def selection(p):
        p.add_argument("--since", help="이 날짜(YYYY-MM-DD) 이후 갱신된 세션만")
        p.add_argument("--limit", type=int, help="최근 N개만")
        p.add_argument("--ids", help="세션 ID 쉼표 목록")
        p.add_argument("--query", help="제목에 이 글자가 든 세션만")
        p.add_argument("--all-again", action="store_true", help="이미 보관한 세션도 처음부터 다시")
        p.add_argument("--include-current", action="store_true", help="지금 이 세션도 포함")

    p = sub.add_parser("init")
    common(p)
    p.add_argument("--folder-id")
    p.add_argument("--sessions-folder-id")
    p.add_argument("--reset", action="store_true", help="로컬 state.json을 무시하고 다시 만들기")
    p.set_defaults(fn=cmd_init)
    p = sub.add_parser("select")
    common(p)
    selection(p)
    p.add_argument("--chunk", type=int, default=6)
    p.add_argument("--pending", action="store_true", help="아직 다 못 불러온 세션만")
    p.set_defaults(fn=cmd_select)
    p = sub.add_parser("todo")
    common(p)
    selection(p)
    p.add_argument("--batch", type=int, default=6)
    p.set_defaults(fn=cmd_todo)
    p = sub.add_parser("build")
    common(p)
    selection(p)
    p.set_defaults(fn=cmd_build)
    p = sub.add_parser("refs")
    common(p)
    p.add_argument("--batch", type=int, default=10)
    p.set_defaults(fn=cmd_refs)
    for name, fn in (("ids", cmd_ids), ("index", cmd_index), ("state", cmd_state), ("status", cmd_status)):
        p = sub.add_parser(name)
        common(p)
        p.set_defaults(fn=fn)
    p = sub.add_parser("ref", help="파일 하나의 업로드 참조")
    p.add_argument("path")
    p.set_defaults(fn=cmd_ref)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
