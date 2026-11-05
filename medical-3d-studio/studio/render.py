"""Blender Builder: shots.json → build spec → frames (Blender/Cycles) → MP4 + captions + manifest.

Frames are cached under build/frames/<topic>/<quality>_<spec_hash>/ so caption-only
changes re-encode in seconds, and an interrupted render resumes where it stopped.
"""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from . import captions
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


def ffmpeg(args):
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"] + args
    subprocess.run(cmd, check=True)


def render(topic, quality="preview", log=print, frames_only=False):
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

    if not _frames_complete(frames, total):
        log(f"[render] 장면 조립 + 렌더: {total}프레임 → {frames.relative_to(root)}")
        cmd = blender_command(root / BLENDER_SCRIPTS / "build_scene.py",
                              ["--spec", str(spec_path), "--blend", str(blend), "--frames-dir", str(frames)])
        subprocess.run(cmd, check=True, cwd=root)
        if not _frames_complete(frames, total):
            raise SystemExit("렌더가 끝났지만 빠진 프레임이 있어요. 같은 명령을 다시 실행하면 이어서 렌더해요.")
    else:
        log(f"[render] 같은 장면의 프레임이 이미 있어요 → 다시 렌더하지 않고 인코딩만 해요 ({sh})")
    if frames_only:
        return None

    out_dir = root / "renders" / quality
    out_dir.mkdir(parents=True, exist_ok=True)
    ver = _next_version(topic, quality)
    base = out_dir / f"{topic.id}_v{ver:03d}"
    ass = base.with_suffix(".ass")
    srt = base.with_suffix(".srt")
    ass.write_text(captions.build_ass(topic, st.style), encoding="utf-8")
    srt.write_text(captions.build_srt(topic), encoding="utf-8")

    fps = spec["fps"]
    crf = "20" if quality == "preview" else "16"
    clean = Path(str(base) + "_clean.mp4")
    captioned = Path(str(base) + ".mp4")
    audio = ["-f", "lavfi", "-t", str(spec["duration_sec"]), "-i", "anullsrc=channel_layout=stereo:sample_rate=48000"]
    common = ["-c:v", "libx264", "-preset", "slow", "-crf", crf, "-pix_fmt", "yuv420p", "-r", str(fps),
              "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart"]
    ffmpeg(["-framerate", str(fps), "-i", str(frames / "%04d.png")] + audio + common + [str(clean)])
    fonts_dir = (root / st.style["captions"]["font_file"]).parent
    vf = f"subtitles=filename='{ass}':fontsdir='{fonts_dir}'"
    ffmpeg(["-framerate", str(fps), "-i", str(frames / "%04d.png")] + audio + ["-vf", vf] + common + [str(captioned)])

    from .gates import content_hashes  # local import: avoid a cycle
    hashes = content_hashes(topic)
    manifest = {
        "topic_id": topic.id,
        "quality": quality,
        "version": ver,
        "rendered_at": now_iso(),
        "spec_hash": sh,
        "script_hash": hashes["script"],
        "claims_hash": hashes["claims"],
        "shots_hash": hashes["shots"],
        "captions_sha256": file_sha256(ass)[:16],
        "video": captioned.name,
        "video_sha256": file_sha256(captioned),
        "video_clean": clean.name,
        "video_clean_sha256": file_sha256(clean),
        "captions_ass": ass.name,
        "captions_srt": srt.name,
        "resolution": spec["render"]["resolution"],
        "fps": fps,
        "duration_sec": spec["duration_sec"],
        "audio": "silent (narration not recorded yet)" if not topic.script.get("voice", {}).get("asset_id") else topic.script["voice"]["asset_id"],
        "engine": "Blender Cycles (CPU) via " + ("M3D_BPY_PYTHON" if os.environ.get("M3D_BPY_PYTHON") else "blender"),
        "render_settings": spec["render"],
        "provenance": spec["provenance"],
        "assets": sorted({a for s in topic.shots for a in s.get("assets", [])}),
        "blend_file": str(blend.relative_to(root)),
        "python": sys.version.split()[0],
    }
    mpath = Path(str(base) + ".manifest.json")
    mpath.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"[render] 완료: {captioned.relative_to(root)} (자막 포함), {clean.relative_to(root)} (자막 없음)")
    return manifest
