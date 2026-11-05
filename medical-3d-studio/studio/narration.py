"""Narration: script.yaml lines → AI voice → one audio track timed to the captions.

Each script line is spoken inside its own time window (line start → end), so voice,
captions and 3D stay in step. A line that runs longer than its window is read faster,
only that line, up to voice.max_speed. If it still does not fit, the next line starts a
little late and `check` warns.

The voice engine runs on this computer: Supertonic 3 by Supertone (code MIT, model
OpenRAIL-M; rights and conditions in assets/registry.yaml). Audio is written under
build/narration/<topic>/<hash>/, like render frames: not committed (public repo), and
made again with `python -m studio narrate`. The hash covers the spoken text, the timing
and the voice settings, so any change to them needs a new track before rendering.
"""
import json
import subprocess
import wave
from pathlib import Path

from .data import canonical_hash, file_sha256, now_iso

DEFAULTS = {
    "engine": "supertonic-3",
    "voice_name": "F1",      # built-in voices: F1–F5, M1–M5
    "speed": 1.05,           # normal reading speed
    "max_speed": 1.35,       # a line that does not fit its window may be read up to this fast
    "steps": 10,             # quality, 5 (low) to 12 (high)
    "lead_in": 0.12,         # seconds of quiet after a caption appears, before the voice starts
    "tail": 0.18,            # seconds kept free before the next line
    "loudness_lufs": -16,
    "pronunciation": {},     # replacements for the voice only, e.g. {"X선": "엑스선"}; captions keep the original
}
VOICES = ["F1", "F2", "F3", "F4", "F5", "M1", "M2", "M3", "M4", "M5"]
OUT_RATE = 48000
MIN_GAP = 0.08               # shortest pause between two lines when one runs late
END_TAIL = 0.06              # quiet kept at the very end of the video


# ------------------------------------------------------------------ settings & identity
def settings(topic):
    v = topic.script.get("voice") or {}
    return {k: v.get(k, d) for k, d in DEFAULTS.items()}


def enabled(topic):
    return (topic.script.get("voice") or {}).get("status") == "ai_voice"


def spoken_text(line, cfg):
    """What the voice reads: the narration with pronunciation replacements applied."""
    text = line["narration"]
    for a, b in (cfg.get("pronunciation") or {}).items():
        text = text.replace(a, b)
    return text


def duration(topic):
    return float(topic.script.get("duration_sec") or topic.shots_doc.get("duration_sec"))


def track_hash(topic):
    cfg = settings(topic)
    return canonical_hash({"duration": duration(topic), "voice": cfg,
                           "lines": [[ln["line_id"], ln["start"], ln["end"], spoken_text(ln, cfg)] for ln in topic.lines()]})


def track_dir(topic):
    return topic.studio.root / "build" / "narration" / topic.id / track_hash(topic)


def current(topic):
    """(wav path, plan) of the track made for the current script and voice settings, else (None, None)."""
    d = track_dir(topic)
    wav, plan = d / "narration.wav", d / "plan.json"
    if wav.exists() and plan.exists():
        return wav, json.loads(plan.read_text(encoding="utf-8"))
    return None, None


# ------------------------------------------------------------------ timing (pure, no audio)
def next_speed(speed, length, avail, max_speed):
    """Speed that should bring a clip of `length` seconds (read at `speed`) down to `avail` seconds."""
    return min(max_speed, round(speed * length / avail + 0.005, 2))


def layout(lengths, windows, cfg):
    """Where each clip goes. A clip starts lead_in after its line starts, but never before the
    previous clip has ended (+MIN_GAP), so a line that runs long pushes the next one late."""
    out, prev_end = [], None
    for (s, e), length in zip(windows, lengths):
        planned = float(s) + cfg["lead_in"]
        start = planned if prev_end is None else max(planned, prev_end + MIN_GAP)
        end = start + length
        out.append({"start": round(start, 3), "end": round(end, 3),
                    "late": round(start - planned, 3), "overflow": round(max(0.0, end - float(e)), 3)})
        prev_end = end
    return out


def problems(plan):
    """[(line_id, message)] for lines a reviewer should listen to closely."""
    out = []
    base = plan["voice"]["speed"]
    for ln in plan["lines"]:
        if ln["speed"] > base * 1.15 + 1e-9:
            out.append((ln["line_id"], f"시간 칸에 맞추려고 빠르게 읽어요 (x{ln['speed']:.2f}, 기본 x{base:.2f})"))
        if ln["late"] > 0.05:
            out.append((ln["line_id"], f"앞 줄이 길어 {ln['late']:.2f}초 늦게 시작해요 (자막보다 늦음)"))
        if ln["overflow"] > 0.05:
            out.append((ln["line_id"], f"자막이 바뀐 뒤에도 {ln['overflow']:.2f}초 더 읽어요"))
        if ln["end"] > plan["duration_sec"] + 1e-6:
            out.append((ln["line_id"], f"영상 끝({plan['duration_sec']:g}초)을 넘어 잘려요"))
    return out


# ------------------------------------------------------------------ engine
class Supertonic:
    """Supertonic 3 on this computer (ONNX). First use downloads the model (~400MB)."""

    name = "supertonic-3"

    def __init__(self, cfg):
        try:
            import supertonic
            from supertonic import TTS
        except ImportError:
            raise SystemExit("AI 음성 엔진이 없어요: pip install supertonic  (처음 실행 때 모델 약 400MB를 받아요)")
        self.tts = TTS(auto_download=True)
        self.sample_rate = self.tts.sample_rate
        self.steps = int(cfg["steps"])
        self.version = f"supertonic {getattr(supertonic, '__version__', '?')} (Supertone/supertonic-3)"
        self.use_voice(cfg["voice_name"])

    def use_voice(self, name):
        if name not in VOICES:
            raise SystemExit(f"없는 목소리: {name} (가능: {', '.join(VOICES)})")
        self.voice_name = name
        self.style = self.tts.get_voice_style(voice_name=name)

    def __call__(self, text, speed):
        wav, _ = self.tts.synthesize(text, voice_style=self.style, lang="ko", total_steps=self.steps,
                                     speed=float(speed), silence_duration=0.15)
        return wav.reshape(-1).astype("float32")


ENGINES = {"supertonic-3": Supertonic}


def engine_for(cfg):
    if cfg["engine"] not in ENGINES:
        raise SystemExit(f"모르는 음성 엔진: {cfg['engine']} (가능: {', '.join(ENGINES)})")
    return ENGINES[cfg["engine"]](cfg)


# ------------------------------------------------------------------ audio helpers (numpy)
def _trim(x, rate, threshold=0.01, pad=0.04):
    import numpy as np
    idx = np.flatnonzero(np.abs(x) > threshold)
    if not len(idx):
        return x[:0]
    p = int(pad * rate)
    return x[max(0, idx[0] - p): idx[-1] + p]


def _fade(x, rate, sec=0.01):
    import numpy as np
    n = min(len(x) // 2, int(sec * rate))
    if n:
        x = x.copy()
        ramp = np.linspace(0.0, 1.0, n, dtype=x.dtype)
        x[:n] *= ramp
        x[-n:] *= ramp[::-1]
    return x


def write_wav(path, x, rate):
    import numpy as np
    pcm = (np.clip(x, -1.0, 1.0) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())


def read_wav(path):
    import numpy as np
    with wave.open(str(path), "rb") as w:
        rate = w.getframerate()
        data = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype("float32") / 32767
    return data, rate


def mix(clips, starts, rate, total_sec):
    import numpy as np
    n = int(round(total_sec * rate))
    out = np.zeros(n, dtype="float32")
    for c, s in zip(clips, starts):
        i = int(round(s * rate))
        c = _fade(c[: max(0, n - i)], rate)
        out[i: i + len(c)] += c
    return out


def _loudnorm(src, dst, lufs, total_sec):
    """Two-pass loudness normalisation (linear, so pauses do not pump), 48 kHz stereo, exact length."""
    target = f"I={lufs}:TP=-1.5:LRA=11"
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(src), "-af", f"loudnorm={target}:print_format=json",
                        "-f", "null", "-"], capture_output=True, text=True, encoding="utf-8", errors="replace", check=True)
    m = json.loads(r.stderr[r.stderr.rindex("{"): r.stderr.rindex("}") + 1])
    second = (f"loudnorm={target}:measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}"
              f":measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true,"
              f"aresample={OUT_RATE},apad=whole_dur={total_sec}")
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(src), "-af", second,
                    "-ar", str(OUT_RATE), "-ac", "2", "-t", str(total_sec), "-c:a", "pcm_s16le", str(dst)], check=True)


class _Cache:
    """Engine output per (voice, quality, text, speed), so a rerun only makes the lines that changed."""

    def __init__(self, engine, folder):
        self.engine, self.folder = engine, Path(folder)
        self.folder.mkdir(parents=True, exist_ok=True)
        self.sample_rate = engine.sample_rate

    def __call__(self, text, speed):
        key = canonical_hash([getattr(self.engine, "name", "?"), getattr(self.engine, "voice_name", "?"),
                              getattr(self.engine, "steps", "?"), text, round(float(speed), 2)])
        p = self.folder / f"{key}.wav"
        if p.exists():
            return read_wav(p)[0]
        x = self.engine(text, speed)
        write_wav(p, x, self.sample_rate)
        return x


def fit_line(synth, text, avail, cfg, rate):
    """Read at the normal speed; if that is longer than `avail` seconds, read faster (up to max_speed)."""
    speed = float(cfg["speed"])
    clip = _trim(synth(text, speed), rate)
    for _ in range(4):
        length = len(clip) / rate
        if length <= avail or speed >= cfg["max_speed"]:
            break
        speed = next_speed(speed, length, avail, cfg["max_speed"])
        clip = _trim(synth(text, speed), rate)
    return speed, clip


# ------------------------------------------------------------------ build
def build(topic, engine=None, log=print):
    """Make the narration track for the current script. Returns (wav path, plan)."""
    if not enabled(topic):
        raise SystemExit("script.yaml 의 voice.status 가 ai_voice 가 아니에요 (AI 음성을 쓰려면 ai_voice 로)")
    cfg = settings(topic)
    engine = engine or engine_for(cfg)
    rate = engine.sample_rate
    synth = _Cache(engine, topic.studio.root / "build" / "narration" / topic.id / "cache")
    total = duration(topic)
    lines = topic.lines()
    d = track_dir(topic)
    (d / "lines").mkdir(parents=True, exist_ok=True)

    clips, speeds = [], []
    for i, ln in enumerate(lines):
        text = spoken_text(ln, cfg)
        tail = cfg["tail"] if i < len(lines) - 1 else END_TAIL  # no next line to keep free after the last one
        avail = float(ln["end"]) - float(ln["start"]) - cfg["lead_in"] - tail
        speed, clip = fit_line(synth, text, avail, cfg, rate)
        log(f"[narrate] {ln['line_id']} {len(clip) / rate:4.2f}초 / 칸 {avail:4.2f}초  x{speed:.2f}  {text}")
        clips.append(clip)
        speeds.append(speed)
        write_wav(d / "lines" / f"{ln['line_id']}.wav", clip, rate)

    windows = [(float(ln["start"]), float(ln["end"])) for ln in lines]
    places = layout([len(c) / rate for c in clips], windows, cfg)
    raw = d / "narration_raw.wav"
    write_wav(raw, mix(clips, [p["start"] for p in places], rate, total), rate)
    wav = d / "narration.wav"
    _loudnorm(raw, wav, cfg["loudness_lufs"], total)

    plan = {
        "topic_id": topic.id,
        "hash": track_hash(topic),
        "made_at": now_iso(),
        "engine": getattr(engine, "version", cfg["engine"]),
        "voice": cfg,
        "asset_id": (topic.script.get("voice") or {}).get("asset_id"),
        "duration_sec": total,
        "sample_rate": OUT_RATE,
        "track_sha256": file_sha256(wav),
        "lines": [dict({"line_id": ln["line_id"], "window": [w[0], w[1]], "speech_sec": round(len(c) / rate, 3),
                        "speed": s, "spoken_text": spoken_text(ln, cfg)}, **p)
                  for ln, w, c, s, p in zip(lines, windows, clips, speeds, places)],
    }
    (d / "plan.json").write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")
    return wav, plan


def samples(topic, text=None, log=print):
    """One sentence in every built-in voice, to pick a voice by ear. Returns the folder."""
    cfg = settings(topic)
    engine = engine_for(cfg)
    text = text or (topic.lines()[0]["narration"] if topic.lines() else "안녕하세요. 목소리 비교용 문장입니다.")
    text = spoken_text({"narration": text}, cfg)
    out = topic.studio.root / "build" / "narration" / "samples"
    out.mkdir(parents=True, exist_ok=True)
    for v in VOICES:
        engine.use_voice(v)
        write_wav(out / f"{v}.wav", _trim(engine(text, cfg["speed"]), engine.sample_rate), engine.sample_rate)
        log(f"[narrate] 샘플 {v}: {(out / f'{v}.wav').relative_to(topic.studio.root)}")
    return out
