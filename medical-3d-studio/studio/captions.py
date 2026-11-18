"""Caption files from script.yaml: ASS (burned into the review preview) and SRT
(kept as a separate source, e.g. for YouTube upload)."""

PLAY_W, PLAY_H = 1080, 1920


def caption_events(topic):
    """[(start, end, text, line_id)] – a line may split into several captions."""
    ev = []
    for line in topic.lines():
        caps = line.get("captions") or [{"start": line["start"], "end": line["end"], "text": line["narration"]}]
        for c in caps:
            ev.append((float(c["start"]), float(c["end"]), str(c["text"]).strip(), line["line_id"]))
    return sorted(ev)


def _ass_time(t):
    cs = int(round(t * 100))
    h, cs = divmod(cs, 360000)
    m, cs = divmod(cs, 6000)
    s, cs = divmod(cs, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _srt_time(t):
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _ass_text(s):
    return s.replace("{", "(").replace("}", ")").replace("\n", r"\N")


def build_ass(topic, style):
    cap = style.get("captions", {})
    font = cap.get("font_name", "Pretendard")
    size = int(PLAY_H * cap.get("size_ratio", 0.045))
    outline = cap.get("outline", 3) * 2
    y = int(PLAY_H * cap.get("center_y_ratio", 0.66))
    duration = float(topic.shots_doc.get("duration_sec", 0))
    disclaimer = style.get("disclaimer_overlay", "교육용 3D 개념도")
    end_text = (topic.shots[-1].get("disclaimer") if topic.shots else "") or ""

    out = [
        "[Script Info]",
        "ScriptType: v4.00+",
        f"PlayResX: {PLAY_W}",
        f"PlayResY: {PLAY_H}",
        "WrapStyle: 0",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, "
        "Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        f"Style: Caption,{font},{size},&H00FFFFFF,&H00FFFFFF,&H00101010,&H64000000,-1,0,0,0,100,100,0,0,1,{outline},2,5,90,90,0,1",
        f"Style: Disclaimer,{font},{int(size * 0.42)},&H30FFFFFF,&H00FFFFFF,&H00000000,&H90000000,-1,0,0,0,100,100,0,0,1,3,0,7,60,60,0,1",
        f"Style: EndCard,{font},{int(size * 0.62)},&H00FFFFFF,&H00FFFFFF,&H00000000,&H50101828,-1,0,0,0,100,100,0,0,3,18,0,5,90,90,0,1",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
        f"Dialogue: 2,{_ass_time(0)},{_ass_time(duration)},Disclaimer,,0,0,0,,{{\\pos(60,120)}}{_ass_text(disclaimer)}",
    ]
    for start, end, text, line_id in caption_events(topic):
        out.append(f"Dialogue: 1,{_ass_time(start)},{_ass_time(end)},Caption,{line_id},0,0,0,,"
                   f"{{\\pos({PLAY_W // 2},{y})\\fad(80,80)}}{_ass_text(text)}")
    if end_text and topic.shots:
        last = topic.shots[-1]
        s = float(last["start_sec"]) + 0.6
        out.append(f"Dialogue: 3,{_ass_time(s)},{_ass_time(duration)},EndCard,,0,0,0,,"
                   f"{{\\pos({PLAY_W // 2},{int(PLAY_H * 0.2)})\\fad(250,0)}}{_ass_text(end_text.replace('. ', '.' + chr(10)))}")
    return "\n".join(out) + "\n"


def build_srt(topic):
    out = []
    for i, (start, end, text, _) in enumerate(caption_events(topic), 1):
        out += [str(i), f"{_srt_time(start)} --> {_srt_time(end)}", text, ""]
    return "\n".join(out)
