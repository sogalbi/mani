"""Assemble a full scene from a build spec (see studio/render.py: build_spec)."""
import math

import bpy

from . import actions, anatomy, blood, camera, devices, labels, materials
from .util import Timeline, bake, bake_visibility, bulk_keys, sec_to_frame


def _clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    try:
        import addon_utils
        addon_utils.enable("cycles", default_set=True)
    except Exception:  # running inside the Blender app: already enabled
        pass


def _windows(tl, name, total):
    out, start = [], None
    for f in range(1, total + 1):
        on = tl.value(name, f) >= 0.5
        if on and start is None:
            start = f
        if not on and start is not None:
            out.append((start, f - 1))
            start = None
    if start is not None:
        out.append((start, total))
    return out


def _stage_weights(u, n):
    """Piecewise-linear blend between stage shapes u = k/n (tent weights)."""
    x = u * n
    return [max(0.0, 1.0 - abs(x - k)) for k in range(1, n + 1)]


def _lights(style):
    def area(name, loc, rot, size, power, color=(1, 1, 1)):
        d = bpy.data.lights.new(name, "AREA")
        d.size = size
        d.energy = power
        d.color = color
        o = bpy.data.objects.new(name, d)
        o.location = loc
        o.rotation_euler = [math.radians(a) for a in rot]
        bpy.context.scene.collection.objects.link(o)
    area("key", (-6, -8, 7), (55, 0, -35), 6, 1400)
    area("fill", (7, -7, -2), (95, 0, 45), 8, 500, (0.85, 0.9, 1.0))
    area("rim", (0, 9, 4), (-65, 0, 0), 8, 900, (0.8, 0.88, 1.0))
    area("inner", (0, -5, 0.5), (90, 0, 0), 3, 60)


def build(spec):
    _clear()
    sc = bpy.context.scene
    fps = spec["fps"]
    total = int(round(spec["duration_sec"] * fps))
    sc.render.fps = fps
    sc.frame_start, sc.frame_end = 1, total

    tpl = spec["scene"]["params"]
    model = anatomy.LesionModel(tpl)
    mats = materials.build_materials(spec["style"], model)
    materials.build_world(spec["style"])
    _lights(spec["style"])
    font = bpy.data.fonts.load(spec["font_path"])

    # ---- timeline from motion presets
    tl = Timeline(fps, total)
    for k, v in actions.DEFAULTS.items():
        tl.channel(k, v)
    for s in spec["shots"]:
        f0 = sec_to_frame(s["start_sec"], fps)
        f1 = sec_to_frame(s["end_sec"], fps) - 1
        preset = actions.PRESETS[s["action"]]
        preset(tl, f0, f1, s.get("action_params", {}))

    # ---- anatomy (main vessel with expansion stages, 'before' copy, front half)
    n_stages = tpl.get("expansion_stages", 10)
    stages = [(k, k / n_stages) for k in range(1, n_stages + 1)]
    wall, plaque = anatomy.build_vessel(model, mats, "artery_cutaway_v1", stages)
    bx = tpl.get("compare_offset_x", -3.0)
    b_wall, b_plaque = anatomy.build_vessel(model, mats, "artery_before", [], offset=(bx, 0, 0))
    front = anatomy.build_front_wall(model, mats, "artery_front_v1")

    def u(f):
        return tl.value("stent_u", f)

    for ob in (wall, plaque):
        key = ob.data.shape_keys
        for k in range(1, n_stages + 1):
            bake(key, f'key_blocks["u{k:02d}"].value', -1,
                 lambda f, k=k: _stage_weights(u(f), n_stages)[k - 1], 1, total)

    for sock in mats["_front_alpha"]:
        bake(sock, "default_value", -1, lambda f: tl.value("front_alpha", f), 1, total)
    bake_visibility(front, lambda f: tl.value("front_alpha", f) > 0.001, 1, total)
    for ob in (b_wall, b_plaque):
        bake_visibility(ob, lambda f: tl.value("before_vis", f) >= 0.5, 1, total)

    # ---- devices
    stent = devices.build_stent(model, mats["stent"])
    balloon, balloon_half = devices.build_balloon(model, mats["balloon"])
    shaft = devices.build_shaft(mats["shaft"], z_top=-balloon_half + 0.02)
    wire = devices.build_wire(mats["wire"])
    carrier = bpy.data.objects.new("device_carrier", None)
    sc.collection.objects.link(carrier)
    for ob in (balloon, shaft):
        ob.parent = carrier

    lock = tl.first_change("stent_u") or total
    bake(carrier, "location", 2, lambda f: tl.value("carrier_z", f), 1, total)
    bake(stent, "location", 2, lambda f: tl.value("carrier_z", min(f, lock)), 1, total)
    bake(wire, "location", 2, lambda f: tl.value("wire_tip_z", f), 1, total)
    bake(balloon.data.shape_keys, 'key_blocks["inflated"].value', -1, lambda f: tl.value("balloon_v", f), 1, total)
    bake(stent.data.shape_keys, 'key_blocks["expanded"].value', -1, u, 1, total)
    for ob in (balloon, shaft, wire):
        bake_visibility(ob, lambda f: tl.value("devices_vis", f) >= 0.5, 1, total)
    bake_visibility(stent, lambda f: tl.value("devices_vis", f) >= 0.5 or tl.value("stent_u", f) > 0.5, 1, total)

    # ---- blood cells (concept)
    cell = blood.cell_mesh(mats["blood"])
    blood.build_cells(model, cell, tpl.get("cells_main", 70), "cell", 0.0, _windows(tl, "cells_main", total),
                      u, fps, seed=7, total_frames=total)
    blood.build_cells(model, cell, tpl.get("cells_before", 45), "cell_before", bx, _windows(tl, "cells_before", total),
                      lambda f: 0.0, fps, seed=11, total_frames=total)

    # ---- camera and labels
    cam, target = camera.build_camera()
    camera.animate_camera(cam, target, spec["shots"], spec["camera_presets"], fps, total, sec_to_frame)
    for s in spec["shots"]:
        f0 = sec_to_frame(s["start_sec"], fps)
        for i, lab in enumerate(s.get("labels", [])):
            fi = sec_to_frame(s["start_sec"] + lab.get("in", 0.3), fps)
            fo = sec_to_frame(min(s["end_sec"], s["start_sec"] + lab.get("out", s["end_sec"] - s["start_sec"])), fps) - 1
            follow = {"carrier": carrier, "stent": stent}.get(lab.get("follow"))
            labels.build_label(lab, font, mats, cam, fi, fo, name=f"label_{s['shot_id']}_{i}", follow=follow)

    _render_settings(spec)
    return {"frames": total, "timeline_channels": sorted(tl.channels)}


def _render_settings(spec):
    sc = bpy.context.scene
    r = spec["render"]
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = r.get("samples", 32)
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.adaptive_threshold = r.get("noise_threshold", 0.03)
    sc.cycles.use_denoising = True
    sc.cycles.denoiser = "OPENIMAGEDENOISE"
    sc.cycles.max_bounces = 4
    sc.cycles.diffuse_bounces = 2
    sc.cycles.glossy_bounces = 2
    sc.cycles.transmission_bounces = 2
    sc.cycles.transparent_max_bounces = 8
    sc.cycles.caustics_reflective = False
    sc.cycles.caustics_refractive = False
    sc.render.use_persistent_data = True
    sc.render.resolution_x, sc.render.resolution_y = r["resolution"]
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGB"
    sc.view_settings.view_transform = "AgX"
    try:
        sc.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass
