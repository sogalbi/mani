"""Procedural mesh builders (numpy). Every builder can add shape keys with the
same topology, so the scene animates by blending keys instead of re-meshing."""
import math

import bmesh
import bpy
import numpy as np


def _new_mesh_object(name, verts, faces, mat_idx=None, materials=(), smooth=True, sharp_angle=40.0):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.update()
    for m in materials:
        me.materials.append(m)
    if mat_idx is not None:
        me.polygons.foreach_set("material_index", list(mat_idx))
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        me.shade_smooth()
        if hasattr(me, "set_sharp_from_angle"):
            me.set_sharp_from_angle(angle=math.radians(sharp_angle))
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def add_shape_keys(obj, keyed_verts):
    """keyed_verts: list of (key_name, (N,3) array). Basis = current mesh."""
    if obj.data.shape_keys is None:
        obj.shape_key_add(name="Basis", from_mix=False)
    for name, verts in keyed_verts:
        kb = obj.shape_key_add(name=name, from_mix=False)
        kb.data.foreach_set("co", np.asarray(verts, dtype=np.float32).ravel())
        kb.value = 0.0
    obj.data.update()


# ---------------------------------------------------------------- half shells
def shell_topology(nz, nth, closed_theta=False):
    """Faces for a shell made of an inner grid and an outer grid (nz x nth each).

    Material index: 0 inner surface, 1 outer surface, 2 cut faces (theta ends),
    3 end caps (z ends)."""
    N = nz * nth
    faces, mats = [], []

    def I(i, j):
        return i * nth + (j % nth)

    def O(i, j):
        return N + i * nth + (j % nth)

    jmax = nth if closed_theta else nth - 1
    for i in range(nz - 1):
        for j in range(jmax):
            faces.append((I(i, j), I(i + 1, j), I(i + 1, j + 1), I(i, j + 1)))
            mats.append(0)
            faces.append((O(i, j), O(i, j + 1), O(i + 1, j + 1), O(i + 1, j)))
            mats.append(1)
    if not closed_theta:
        for i in range(nz - 1):
            for j in (0, nth - 1):
                faces.append((I(i, j), O(i, j), O(i + 1, j), I(i + 1, j)))
                mats.append(2)
    for i in (0, nz - 1):
        for j in range(jmax):
            faces.append((I(i, j), I(i, j + 1), O(i, j + 1), O(i, j)))
            mats.append(3)
    return faces, mats


def shell_verts(z, th, r_in, r_out, offset=(0.0, 0.0, 0.0)):
    """z: (nz,), th: (nth,), r_in/r_out: (nz, nth) radii → (2*nz*nth, 3)."""
    Z, TH = np.meshgrid(z, th, indexing="ij")
    out = []
    for R in (r_in, r_out):
        x = R * np.cos(TH) + offset[0]
        y = R * np.sin(TH) + offset[1]
        out.append(np.stack([x, y, Z + offset[2]], axis=-1).reshape(-1, 3))
    return np.concatenate(out, axis=0)


# ---------------------------------------------------------------- tubes
def _frames_along(points, closed):
    P = np.asarray(points, dtype=float)
    if closed:
        T = np.roll(P, -1, axis=0) - np.roll(P, 1, axis=0)
    else:
        T = np.gradient(P, axis=0)
    T /= np.linalg.norm(T, axis=1, keepdims=True) + 1e-12
    return P, T


def tube_ring_verts(points, radial, radius, sides, closed):
    """Cross-section circles around a polyline. radial: (N,3) preferred normal
    direction (e.g. cylinder normal) so the twist is stable."""
    P, T = _frames_along(points, closed)
    Nrm = np.asarray(radial, dtype=float)
    Nrm = Nrm - (Nrm * T).sum(1, keepdims=True) * T
    Nrm /= np.linalg.norm(Nrm, axis=1, keepdims=True) + 1e-12
    B = np.cross(T, Nrm)
    ang = np.linspace(0, 2 * math.pi, sides, endpoint=False)
    V = P[:, None, :] + radius * (np.cos(ang)[None, :, None] * Nrm[:, None, :] + np.sin(ang)[None, :, None] * B[:, None, :])
    return V.reshape(-1, 3)


def tube_faces(n_points, sides, closed, base=0, caps=False):
    faces = []
    segs = n_points if closed else n_points - 1
    for i in range(segs):
        i2 = (i + 1) % n_points
        for k in range(sides):
            k2 = (k + 1) % sides
            faces.append((base + i * sides + k, base + i2 * sides + k, base + i2 * sides + k2, base + i * sides + k2))
    if caps and not closed:
        faces.append(tuple(base + k for k in reversed(range(sides))))
        faces.append(tuple(base + (n_points - 1) * sides + k for k in range(sides)))
    return faces


# ---------------------------------------------------------------- revolve
def revolve_verts(z, r, segments, offset=(0.0, 0.0, 0.0)):
    ang = np.linspace(0, 2 * math.pi, segments, endpoint=False)
    Z, A = np.meshgrid(z, ang, indexing="ij")
    R = np.asarray(r)[:, None] * np.ones_like(A)
    V = np.stack([R * np.cos(A) + offset[0], R * np.sin(A) + offset[1], Z + offset[2]], axis=-1)
    return V.reshape(-1, 3)


def revolve_faces(nz, segments, caps=True):
    faces = tube_faces(nz, segments, closed=False, caps=caps)
    return faces


def cylinder(name, radius, z0, z1, segments, material, rounded_top=False):
    nz = 2
    z = np.array([z0, z1])
    r = np.array([radius, radius])
    if rounded_top:
        cap = np.linspace(0, math.pi / 2, 6)[1:]
        z = np.concatenate([z, z1 + radius * np.sin(cap)])
        r = np.concatenate([r, np.maximum(radius * np.cos(cap), radius * 0.05)])
        nz = len(z)
    V = revolve_verts(z, r, segments)
    F = revolve_faces(nz, segments, caps=True)
    return _new_mesh_object(name, V, F, materials=[material], sharp_angle=60)


def new_mesh_object(*a, **k):
    return _new_mesh_object(*a, **k)
