"""Build (and optionally render) a scene from a build spec JSON.

Runs either with the Blender app:
    blender -b -P build_scene.py -- --spec build/T0001.spec.json --blend out.blend
or with the `bpy` Python module (pip install bpy):
    python build_scene.py --spec ... --blend ... [--frames-dir DIR] [--still 300 --still-out a.png]

Called by `python -m studio render`, which also records hashes in a manifest.
"""
import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402

from m3d import scene  # noqa: E402


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", required=True)
    ap.add_argument("--blend", help="save the built scene here")
    ap.add_argument("--frames-dir", help="render the animation as PNG frames into this folder")
    ap.add_argument("--frame-range", help="e.g. 1-300 (default: all)")
    ap.add_argument("--still", type=int, action="append", default=[], help="render a single frame (repeatable)")
    ap.add_argument("--still-dir", help="folder for --still images")
    a = ap.parse_args(argv)

    spec = json.load(open(a.spec, encoding="utf-8"))
    t0 = time.time()
    info = scene.build(spec)
    print(f"[m3d] built scene: {info['frames']} frames in {time.time() - t0:.1f}s", flush=True)
    sc = bpy.context.scene
    if a.blend:
        os.makedirs(os.path.dirname(os.path.abspath(a.blend)), exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(a.blend), compress=True)
        print(f"[m3d] saved {a.blend}", flush=True)
    for f in a.still:
        sc.frame_set(f)
        sc.render.filepath = os.path.join(os.path.abspath(a.still_dir or "."), f"still_{f:04d}.png")
        t = time.time()
        bpy.ops.render.render(write_still=True)
        print(f"[m3d] still {f} in {time.time() - t:.1f}s", flush=True)
    if a.frames_dir:
        os.makedirs(a.frames_dir, exist_ok=True)
        if a.frame_range:
            s, e = (int(x) for x in a.frame_range.split("-"))
            sc.frame_start, sc.frame_end = s, e
        sc.render.filepath = os.path.join(os.path.abspath(a.frames_dir), "")
        sc.render.use_overwrite = False  # resume: keep frames that already exist
        t = time.time()
        bpy.ops.render.render(animation=True)
        print(f"[m3d] rendered frames {sc.frame_start}-{sc.frame_end} in {time.time() - t:.1f}s", flush=True)


if __name__ == "__main__":
    main()
