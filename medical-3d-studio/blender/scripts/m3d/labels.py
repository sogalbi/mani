"""On-screen labels placed in 3D: text on a dark plate that always faces the
camera, with an optional leader line to the structure it names."""
import bpy

from .util import bulk_keys


def _plate_mesh(w, h, r):
    """Rounded rectangle in the XY plane."""
    import math
    pts = []
    for cx, cy, a0 in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for k in range(7):
            a = math.radians(a0 + k * 15)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a), 0.0))
    me = bpy.data.meshes.new("label_plate")
    me.from_pydata(pts, [], [tuple(range(len(pts)))])
    return me


def build_label(spec, font, mats, camera, frame_in, frame_out, size=0.24, name="label", follow=None):
    """follow: optional object; pos/anchor are then relative to it and the label moves with it."""
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    root.location = spec["pos"]
    if follow is not None:
        root.parent = follow
    c = root.constraints.new("COPY_ROTATION")
    c.target = camera

    cu = bpy.data.curves.new(name + "_txt", "FONT")
    cu.body = spec["text"]
    cu.font = font
    cu.size = spec.get("size", size)
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    txt = bpy.data.objects.new(name + "_txt", cu)
    txt.data.materials.append(mats["label_text"])
    bpy.context.scene.collection.objects.link(txt)
    txt.parent = root
    txt.location = (0, 0, 0.004)
    bpy.context.view_layer.update()
    w, h = txt.dimensions.x, cu.size
    pad = cu.size * 0.45
    plate = bpy.data.objects.new(name + "_plate", _plate_mesh(w + 2 * pad, h + pad * 1.3, min(0.08, (h + pad) / 2.2)))
    plate.data.materials.append(mats["label_plate"])
    bpy.context.scene.collection.objects.link(plate)
    plate.parent = root

    objs = [root]
    if spec.get("anchor"):
        line = _leader(name, spec["pos"], spec["anchor"], mats["label_line"])
        if follow is not None:
            line.parent = follow
        objs.append(line)

    pop = 6
    frames = [1, frame_in, frame_in + pop, frame_out - pop, frame_out]
    vals = [0.0, 0.0, 1.0, 1.0, 0.0]
    frames, vals = zip(*sorted({f: v for f, v in zip(frames, vals)}.items()))
    for ob in objs:
        for i in range(3):
            bulk_keys(ob, "scale", i, list(frames), list(vals))
    return root


def _leader(name, start, end, mat):
    cu = bpy.data.curves.new(name + "_line", "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = 0.008
    sp = cu.splines.new("POLY")
    sp.points.add(1)
    # curve local coords relative to the label (object origin = label)
    sp.points[0].co = (0.0, 0.0, 0.0, 1.0)
    sp.points[1].co = (end[0] - start[0], end[1] - start[1], end[2] - start[2], 1.0)
    ob = bpy.data.objects.new(name + "_line", cu)
    ob.location = start
    ob.data.materials.append(mat)
    bpy.context.scene.collection.objects.link(ob)
    dot = bpy.data.meshes.new(name + "_dot")
    import bmesh
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.035)
    bm.to_mesh(dot)
    bm.free()
    dob = bpy.data.objects.new(name + "_dot", dot)
    dob.data.materials.append(mat)
    bpy.context.scene.collection.objects.link(dob)
    dob.parent = ob
    dob.location = sp.points[1].co[:3]
    return ob
