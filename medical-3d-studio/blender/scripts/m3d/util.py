"""Small helpers shared by the scene builder: easing, timeline channels, bulk keyframes."""
import math

import bpy
from bpy_extras import anim_utils


def clamp01(x):
    return 0.0 if x < 0.0 else 1.0 if x > 1.0 else x


def ease(x, kind="smooth"):
    x = clamp01(x)
    if kind == "linear":
        return x
    if kind == "in":
        return x * x
    if kind == "out":
        return 1.0 - (1.0 - x) * (1.0 - x)
    # smootherstep
    return x * x * x * (x * (x * 6.0 - 15.0) + 10.0)


def lerp(a, b, t):
    return a + (b - a) * t


def lerp3(a, b, t):
    return [lerp(a[i], b[i], t) for i in range(3)]


class Timeline:
    """Named scalar channels made of eased segments.

    A channel starts at its default. Each segment (f0, f1, v0, v1) takes over
    from frame f0; after f1 the channel holds v1 until the next segment.
    Motion presets add segments; the builder bakes channels into keyframes.
    """

    def __init__(self, fps, total_frames):
        self.fps = fps
        self.total = total_frames
        self.channels = {}
        self.marks = {}

    def channel(self, name, default):
        self.channels.setdefault(name, {"default": default, "segs": []})

    def add(self, name, f0, f1, v0, v1, kind="smooth"):
        self.channels[name]["segs"].append((f0, max(f1, f0), v0, v1, kind))
        self.channels[name]["segs"].sort(key=lambda s: s[0])

    def set(self, name, f, v):
        self.add(name, f, f, v, v, "linear")

    def value(self, name, f):
        ch = self.channels[name]
        v = ch["default"]
        for f0, f1, v0, v1, kind in ch["segs"]:
            if f < f0:
                break
            if f >= f1:
                v = v1
            else:
                v = lerp(v0, v1, ease((f - f0) / (f1 - f0), kind))
        return v

    def first_change(self, name):
        segs = self.channels[name]["segs"]
        return segs[0][0] if segs else None


def _channelbag(id_data):
    ad = id_data.animation_data
    if hasattr(anim_utils, "animdata_get_channelbag_for_assigned_slot"):
        return anim_utils.animdata_get_channelbag_for_assigned_slot(ad)
    return ad.action  # Blender < 4.4 keeps fcurves on the action


def bulk_keys(id_data, data_path, index, frames, values, interpolation="LINEAR"):
    """Write many keyframes at once (fast, works with slotted actions in Blender 4.4+)."""
    if not frames:
        return None
    owner = id_data.id_data  # node sockets etc. are animated on their ID
    if not isinstance(id_data, bpy.types.ID):
        data_path = id_data.path_from_id(data_path)
    owner.keyframe_insert(data_path, index=index, frame=frames[0])
    cb = _channelbag(owner)
    fc = cb.fcurves.find(data_path, index=max(index, 0))
    fc.keyframe_points.clear()
    n = len(frames)
    fc.keyframe_points.add(n)
    co = [0.0] * (2 * n)
    co[0::2] = [float(f) for f in frames]
    co[1::2] = [float(v) for v in values]
    fc.keyframe_points.foreach_set("co", co)
    enum = fc.keyframe_points[0].bl_rna.properties["interpolation"].enum_items
    fc.keyframe_points.foreach_set("interpolation", [enum[interpolation].value] * n)
    fc.update()
    return fc


def bake(id_data, data_path, index, func, f_start, f_end, interpolation="LINEAR"):
    """Sample func(frame) on every frame and keep only the keys that matter."""
    frames, values = [], []
    prev = None
    samples = [(f, func(f)) for f in range(f_start, f_end + 1)]
    for i, (f, v) in enumerate(samples):
        nxt = samples[i + 1][1] if i + 1 < len(samples) else None
        if prev is not None and nxt is not None and abs(v - prev) < 1e-7 and abs(v - nxt) < 1e-7:
            continue
        frames.append(f)
        values.append(v)
        prev = v
    return bulk_keys(id_data, data_path, index, frames, values, interpolation)


def bake_vec(obj, data_path, func3, f_start, f_end):
    for i in range(3):
        bake(obj, data_path, i, lambda f, i=i: func3(f)[i], f_start, f_end)


def bake_visibility(obj, func_visible, f_start, f_end):
    """Keyframe hide_render/hide_viewport from a boolean function."""
    frames, values = [], []
    prev = None
    for f in range(f_start, f_end + 1):
        hidden = 0.0 if func_visible(f) else 1.0
        if hidden != prev:
            frames.append(f)
            values.append(hidden)
            prev = hidden
    bulk_keys(obj, "hide_render", -1, frames, values, "CONSTANT")
    bulk_keys(obj, "hide_viewport", -1, frames, values, "CONSTANT")


def sec_to_frame(sec, fps):
    return int(round(sec * fps)) + 1


def deg(x):
    return math.radians(x)
