"""Stylised red blood cells moving through the lumen (concept, not a flow
simulation: size and speed are not to scale)."""
import math
import random

import bpy
import numpy as np

from .util import bulk_keys


def cell_mesh(mat, radius=0.085):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=10, radius=1.0)
    obj = bpy.context.active_object
    me = obj.data
    co = np.zeros(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    rr = co[:, 0] ** 2 + co[:, 1] ** 2
    co[:, 2] *= 0.36 * (0.35 + 0.65 * rr)  # biconcave disc
    co *= radius
    me.vertices.foreach_set("co", co.ravel())
    me.update()
    me.shade_smooth()
    me.materials.append(mat)
    data = obj.data
    bpy.data.objects.remove(obj)
    data.name = "blood_cell_v1"
    return data


def build_cells(model, mesh, count, name, offset_x, windows, u_of_frame, fps, seed, total_frames,
                speed=2.3, z_span=None, collection=None):
    """windows: list of (f0, f1) where cells are visible (scale ramps at edges)."""
    rnd = random.Random(seed)
    z_lo, z_hi = z_span or (model.z_min + 0.3, model.z_max - 0.3)
    span = z_hi - z_lo
    objs = []
    ramp = 8
    for i in range(count):
        ob = bpy.data.objects.new(f"{name}_{i:03d}", mesh)
        (collection or bpy.context.scene.collection).objects.link(ob)
        th = rnd.uniform(0.17 * math.pi, 0.83 * math.pi)
        rho = math.sqrt(rnd.uniform(0.02, 1.0)) * 0.72
        z0 = rnd.uniform(z_lo, z_hi)
        v = speed * rnd.uniform(0.85, 1.15) / fps
        frames, xs, ys, zs = [], [], [], []
        for (f0, f1) in windows:
            for f in range(max(1, f0 - ramp), min(total_frames, f1 + ramp) + 1):
                z = z_lo + ((z0 - z_lo + v * f) % span)
                r = rho * float(model.lumen(z, th, u_of_frame(f)))
                frames.append(f)
                xs.append(r * math.cos(th) + offset_x)
                ys.append(r * math.sin(th))
                zs.append(z)
        for idx, vals in enumerate((xs, ys, zs)):
            bulk_keys(ob, "location", idx, frames, vals)
        # tumbling
        rot0 = [rnd.uniform(0, math.tau) for _ in range(3)]
        w = [rnd.uniform(-2.0, 2.0) / fps for _ in range(3)]
        for idx in range(3):
            fc = bulk_keys(ob, "rotation_euler", idx, [0, 100], [rot0[idx], rot0[idx] + 100 * w[idx]])
            fc.extrapolation = "LINEAR"
        # visibility via scale
        sf, sv = [1], [0.0]
        for (f0, f1) in windows:
            sf += [max(1, f0 - ramp), f0, f1, min(total_frames, f1 + ramp)]
            sv += [0.0, 1.0, 1.0, 0.0]
        order = sorted(set(sf))
        lookup = dict(zip(sf, sv))
        for idx in range(3):
            bulk_keys(ob, "scale", idx, order, [lookup[f] for f in order])
        objs.append(ob)
    return objs
