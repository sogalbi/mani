"""Camera presets (assets/camera_presets/*.json): dolly and orbit moves.
The camera tracks an empty; both are baked per frame so cuts are exact."""
import math

import bpy

from .util import bake, bake_vec, ease, lerp, lerp3


def build_camera(sensor_height=36.0):
    cam_data = bpy.data.cameras.new("camera")
    cam_data.sensor_fit = "VERTICAL"
    cam_data.sensor_height = sensor_height
    cam_data.clip_start = 0.05
    cam_data.clip_end = 200.0
    cam = bpy.data.objects.new("camera", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    target = bpy.data.objects.new("camera_target", None)
    bpy.context.scene.collection.objects.link(target)
    c = cam.constraints.new("TRACK_TO")
    c.target = target
    c.track_axis = "TRACK_NEGATIVE_Z"
    c.up_axis = "UP_Y"
    bpy.context.scene.camera = cam
    return cam, target


def _pose(preset, t):
    """Return (location, target, lens) for normalised time t in [0, 1]."""
    k = ease(t, preset.get("ease", "smooth"))
    if preset["type"] == "dolly":
        a, b = preset["from"], preset["to"]
        return lerp3(a["loc"], b["loc"], k), lerp3(a["target"], b["target"], k), lerp(a["lens"], b["lens"], k)
    if preset["type"] == "orbit":
        tg = preset["target"]
        az = math.radians(lerp(*preset["azim_deg"], k))
        el = math.radians(lerp(*preset["elev_deg"], k))
        dist = lerp(*preset["distance"], k)
        loc = [tg[0] + dist * math.cos(el) * math.sin(az),
               tg[1] - dist * math.cos(el) * math.cos(az),
               tg[2] + dist * math.sin(el)]
        return loc, list(tg), preset.get("lens", 50.0)
    raise ValueError(f"unknown camera preset type {preset['type']}")


def animate_camera(cam, target, shots, presets, fps, total_frames, sec_to_frame):
    spans = []
    for s in shots:
        p = presets[s["camera"]]
        f0 = sec_to_frame(s["start_sec"], fps)
        f1 = sec_to_frame(s["end_sec"], fps) - 1
        spans.append((f0, f1, p))

    def pose(f):
        for f0, f1, p in spans:
            if f0 <= f <= f1:
                return _pose(p, (f - f0) / max(1, f1 - f0))
        return _pose(spans[-1][2], 1.0)

    bake_vec(cam, "location", lambda f: pose(f)[0], 1, total_frames)
    bake_vec(target, "location", lambda f: pose(f)[1], 1, total_frames)
    bake(cam.data, "lens", -1, lambda f: pose(f)[2], 1, total_frames)
