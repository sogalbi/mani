"""Blender Builder: shots.json → build spec → frames (Blender/Cycles) → MP4 + captions + manifest.

Frames are cached under build/frames/<topic>/<quality>_<spec_hash>/ so caption-only
changes re-encode in seconds, and an interrupted render resumes where it stopped.

Sound: the narration track from `studio narrate` when script.yaml has an AI voice, else silence.
With --reuse-video and no frames on this computer, the picture of the latest render is kept
as it is (stream copy) when the scene description and captions are unchanged; only the sound
is replaced, and the manifest keeps the picture's original spec and code hashes.
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from . import captions, narration
from .data import canonical_hash, file_sha256, load_json, now_iso, tree_hash

BLENDER_SCRIPTS = "blender/scripts"
VISUAL_SHOT_KEYS = ("shot_id", "start_sec", "end_sec", "action", "action_params", "camera", "labels", "assets")


def build_spec(topic, quality):
    st = topic.studio
    root = st.root
    doc = topic.shots_doc
    presets_path = root / doc["scene"]["camera_presets"]
    fmt = st.channel.get("format", {})
    res = fmt.get(f"{quality}_resolution", [540, 960])
    rq = st.channel.get("render", {}).get(quality, {})
    font = root / st.style["captions"]["font_file"]
    return {
        "topic_id": topic.id,
        "quality": quality,
        "fps": doc.get("fps", fmt.get("fps", 30)),
        "duration_sec": doc["duration_sec"],
        "scene": doc["scene"],
        # only what changes the picture: review status or descriptions must not force a re-render
        "shots": [{k: s[k] for k in VISUAL_SHOT_KEYS if k in s} for s in doc["shots"]],
        "camera_presets": load_json(presets_path),
        "style": {"colors": st.style["colors"]},
        "font_path": str(font),
        "render": {"resolution": res, "samples": rq.get("samples", 24), "noise_threshold": rq.get("noise_threshold", 0.04)},
        "provenance": {
            "builder_code": tree_hash(root / BLENDER_SCRIPTS),
            "font_sha256": file_sha256(font)[:12],
        },
    }


def spec_hash(spec):
    s = dict(spec)
    s.pop("font_path", None)
    return canonical_hash(s)


def blender_command(script, args):
    """Use the Blender app if configured, else a Python that has the bpy module."""
    blender = os.environ.get("M3D_BLENDER") or shutil.which("blender")
    bpy_python = os.environ.get("M3D_BPY_PYTHON")
    if bpy_python:
        return [bpy_python, str(script)] + args
    if blender:
        return [blender, "-b", "--factory-startup", "-P", str(script), "--"] + args
    raise SystemExit(
        "Blender를 찾지 못했어요. 둘 중 하나를 설정하세요:\n"
        "  export M3D_BLENDER=/path/to/blender        # Blender 4.4 이상 앱\n"
        "  export M3D_BPY_PYTHON=/path/to/python       # pip install bpy 한 파이썬")


def _frames_complete(folder, total):
    return all((folder / f"{f:04d}.png").exists() and (folder / f"{f:04d}.png").stat().st_size > 0 for f in range(1, total + 1))


def _next_version(topic, quality):
    ms = topic.manifests(quality)
    if not ms:
        return 1
    return int(ms[-1].name.split("_v")[1].split(".")[0]) + 1


def filter_path(p):
    """A file path written inside an ffmpeg filter: "/" separators and an escaped drive colon (Windows)."""
    return str(p).replace("\\", "/").replace(":", "\\:")


def ffmpeg(args):
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"] + args
    subprocess.run(cmd, check=True)


def luma_qa(video, spec, threshold=6.0):
    """Automatic render check: average brightness per frame. A big jump that is
    not at a shot cut usually means a broken frame (e.g. a renderer cache bug)."""
    out = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(video), "-vf",
                          "signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-", "-f", "null", "-"],
                         capture_output=True, text=True, check=True).stdout
    y = [float(line.split("=")[1]) for line in out.splitlines() if "YAVG=" in line]
    fps = spec["fps"]
    cuts = {int(round(s["start_sec"] * fps)) + 1 for s in spec["shots"]}
    jumps = [i + 1 for i in range(1, len(y)) if abs(y[i] - y[i - 1]) > threshold and (i + 1) not in cuts]
    return {"frames_checked": len(y), "luma_jump_threshold": threshold, "jumps_within_shots": jumps,
            "status": "ok" if not jumps else "check"}


def sound_for(topic):
    """(narration wav or None, plan or None). Stops if the script asks for an AI voice whose track is missing."""
    voice = topic.script.get("voice") or {}
    status = voice.get("status")
    if status in (None, "TODO"):
        return None, None
    if status != "ai_voice":
        raise SystemExit(f"voice.status '{status}' 는 아직 렌더에 연결돼 있지 않아요 (지원: ai_voice, TODO)")
    wav, plan = narration.current(topic)
    if not wav:
        raise SystemExit(f"내레이션 트랙이 없거나 대본·음성 설정이 바뀌었어요 → 먼저: python -m studio narrate {topic.id}")
    return wav, plan


def reusable_render(topic, quality, captions_hash):
    """Latest render whose picture can be kept as it is: same scene description (shots.json),
    same captions, and its video file still has the recorded hash. Stops with the reason if not."""
    from .gates import content_hashes  # local import: avoid a cycle
    m = topic.latest_manifest(quality)
    if not m:
        raise SystemExit("--reuse-video: 이전 렌더가 없어요 → --reuse-video 없이 렌더하세요")
    why = []
    if m.get("shots_hash") != content_hashes(topic)["shots"]:
        why.append("장면(shots.json)이 바뀜")
    if m.get("captions_sha256") != captions_hash:
        why.append("자막이 바뀜")
    src = topic.studio.root / "renders" / quality / m["video"]
    if not src.exists():
        why.append(f"영상 파일 없음: renders/{quality}/{m['video']}")
    elif file_sha256(src) != m["video_sha256"]:
        why.append(f"{m['video']} 가 매니페스트 해시와 달라요")
    if why:
        raise SystemExit("v{:03d} 화면을 다시 쓸 수 없어요: {} → 프레임을 렌더하세요 (--reuse-video 없이)".format(m["version"], ", ".join(why)))
    return m


def render(topic, quality="preview", log=print, frames_only=False, reuse_video=False):
    st = topic.studio
    root = st.root
    spec = build_spec(topic, quality)
    sh = spec_hash(spec)
    total = int(round(spec["duration_sec"] * spec["fps"]))
    frames = root / "build" / "frames" / topic.id / f"{quality}_{sh}"
    spec_path = root / "build" / f"{topic.id}_{quality}_{sh}.spec.json"
    blend = root / "blender" / "scenes" / f"{topic.id}_{sh}.blend"
    spec_path.parent.mkdir(parents=True, exist_ok=True)
    spec_path.write_text(json.dumps(spec, ensure_ascii=False, indent=1), encoding="utf-8")

    # captions are hashed as written (UTF-8, LF), so the hash is the same on every OS
    ass_text = captions.build_ass(topic, st.style)
    srt_text = captions.build_srt(topic)
    captions_hash = hashlib.sha256(ass_text.encode("utf-8")).hexdigest()[:16]
    # before a long render: stop early if the voice track is missing
    voice_wav, voice_plan = (None, None) if frames_only else sound_for(topic)

    source = None  # earlier render whose picture is kept (reuse_video)
    if _frames_complete(frames, total):
        log(f"[render] 같은 장면의 프레임이 이미 있어요 → 다시 렌더하지 않고 인코딩만 해요 ({sh})")
    elif reuse_video and not frames_only:
        source = reusable_render(topic, quality, captions_hash)
        log(f"[render] 프레임이 없어 v{source['version']:03d} 화면을 그대로 써요 (다시 인코딩 안 함), 소리만 바꿔요")
        if source.get("spec_hash") != sh:
            log(f"[render]   참고: 현재 장면 코드의 스펙({sh})이 v{source['version']:03d} 렌더 때({source.get('spec_hash')})와 달라요 → 매니페스트에 기록")
    else:
        log(f"[render] 장면 조립 + 렌더: {total}프레임 → {frames.relative_to(root)}")
        cmd = blender_command(root / BLENDER_SCRIPTS / "build_scene.py",
                              ["--spec", str(spec_path), "--blend", str(blend), "--frames-dir", str(frames)])
        subprocess.run(cmd, check=True, cwd=root)
        if not _frames_complete(frames, total):
            raise SystemExit("렌더가 끝났지만 빠진 프레임이 있어요. 같은 명령을 다시 실행하면 이어서 렌더해요.")
    if frames_only:
        return None

    out_dir = root / "renders" / quality
    out_dir.mkdir(parents=True, exist_ok=True)
    ver = _next_version(topic, quality)
    base = out_dir / f"{topic.id}_v{ver:03d}"
    ass = base.with_suffix(".ass")
    srt = base.with_suffix(".srt")
    ass.write_text(ass_text, encoding="utf-8", newline="\n")
    srt.write_text(srt_text, encoding="utf-8", newline="\n")

    fps = spec["fps"]
    dur = spec["duration_sec"]
    crf = "20" if quality == "preview" else "16"
    clean = Path(str(base) + "_clean.mp4")
    captioned = Path(str(base) + ".mp4")
    if voice_wav:
        audio = ["-i", str(voice_wav)]
        voice_copy = Path(str(base) + "_narration.wav")  # the voice kept as its own file next to the video
        shutil.copyfile(voice_wav, voice_copy)
    else:
        audio = ["-f", "lavfi", "-t", str(dur), "-i", "anullsrc=channel_layout=stereo:sample_rate=48000"]
        voice_copy = None
    aac = ["-c:a", "aac", "-b:a", "128k", "-t", str(dur), "-movflags", "+faststart"]

    if source:
        def remux(src_name, dst):
            ffmpeg(["-i", str(out_dir / src_name)] + audio + ["-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy"] + aac + [str(dst)])
        remux(source["video"], captioned)
        src_clean = out_dir / (source.get("video_clean") or "-")
        if source.get("video_clean") and src_clean.exists() and file_sha256(src_clean) == source.get("video_clean_sha256"):
            remux(source["video_clean"], clean)
        else:
            clean = None
            log(f"[render]   자막 없는 영상(v{source['version']:03d}_clean)이 이 컴퓨터에 없어 자막 있는 영상만 만들어요")
        qa = dict(source.get("qa") or {}, note=f"화면은 {source['video']}와 같은 스트림 (밝기 점검 결과를 이어받음)")
    else:
        common = ["-c:v", "libx264", "-preset", "slow", "-crf", crf, "-pix_fmt", "yuv420p", "-r", str(fps), "-shortest"] + aac
        ffmpeg(["-framerate", str(fps), "-i", str(frames / "%04d.png")] + audio + common + [str(clean)])
        fonts_dir = (root / st.style["captions"]["font_file"]).parent
        vf = f"subtitles=filename='{filter_path(ass)}':fontsdir='{filter_path(fonts_dir)}'"
        ffmpeg(["-framerate", str(fps), "-i", str(frames / "%04d.png")] + audio + ["-vf", vf] + common + [str(captioned)])
        qa = luma_qa(clean, spec)
        if qa["jumps_within_shots"]:
            log(f"[render] ⚠️ 장면 중간에 밝기가 갑자기 바뀌는 프레임: {qa['jumps_within_shots'][:5]} → 해당 프레임을 지우고 다시 렌더하세요")
    notes = frames / "NOTES.md"

    if voice_plan:
        v = voice_plan["voice"]
        audio_desc = f"AI 내레이션 · {voice_plan['engine']} · 목소리 {v['voice_name']} ({voice_plan.get('asset_id')})"
        voice_record = {"hash": voice_plan["hash"], "track": voice_copy.name, "track_sha256": voice_plan["track_sha256"],
                        "engine": voice_plan["engine"], "voice_name": v["voice_name"], "asset_id": voice_plan.get("asset_id"),
                        "made_at": voice_plan["made_at"],
                        "lines": [{k: ln[k] for k in ("line_id", "start", "end", "speed")} for ln in voice_plan["lines"]]}
    else:
        audio_desc, voice_record = "silent (narration not recorded yet)", None

    from .gates import content_hashes  # local import: avoid a cycle
    hashes = content_hashes(topic)
    picture = source or {}
    manifest = {
        "topic_id": topic.id,
        "quality": quality,
        "version": ver,
        "rendered_at": now_iso(),
        "spec_hash": picture.get("spec_hash", sh),
        "script_hash": hashes["script"],
        "claims_hash": hashes["claims"],
        "shots_hash": hashes["shots"],
        "captions_sha256": captions_hash,
        "video": captioned.name,
        "video_sha256": file_sha256(captioned),
        "video_clean": clean.name if clean else None,
        "video_clean_sha256": file_sha256(clean) if clean else None,
        "captions_ass": ass.name,
        "captions_srt": srt.name,
        "resolution": spec["render"]["resolution"],
        "fps": fps,
        "duration_sec": dur,
        "audio": audio_desc,
        "narration": voice_record,
        "engine": picture.get("engine") or "Blender Cycles (CPU) via " + ("M3D_BPY_PYTHON" if os.environ.get("M3D_BPY_PYTHON") else "blender"),
        "render_settings": picture.get("render_settings", spec["render"]),
        "provenance": picture.get("provenance", spec["provenance"]),
        "assets": sorted({a for s in topic.shots for a in s.get("assets", [])}),
        "blend_file": picture.get("blend_file", str(blend.relative_to(root)).replace(os.sep, "/")),
        "python": picture.get("python", sys.version.split()[0]),
        "qa": qa,
        "frame_notes": picture.get("frame_notes") if source else (notes.read_text(encoding="utf-8").strip() if notes.exists() else None),
    }
    if source:
        manifest["video_stream_from"] = source.get("video_stream_from") or source["video"]
        if source.get("spec_hash") != sh:
            manifest["current_code_spec_hash"] = sh
    mpath = Path(str(base) + ".manifest.json")
    mpath.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")
    made = f"{captioned.relative_to(root)} (자막 포함)" + (f", {clean.relative_to(root)} (자막 없음)" if clean else "")
    log(f"[render] 완료: {made}" + (" · 소리: AI 내레이션" if voice_plan else " · 소리: 무음"))
    return manifest
