"""Generic educational device models (not any manufacturer's design):
stent lattice, balloon, catheter shaft, guidewire."""
import math

import numpy as np

from . import geometry as G


def build_stent(model, mat, name="stent_generic_v1", rings=8, crowns=9, samples_per_crown=14, sides=6):
    """Zig-zag rings joined by short links. Basis = crimped on the balloon,
    shape key 'expanded' = opened against the vessel wall."""
    half = model.stent_half
    amp = 0.15
    pitch = (2 * half - 2 * amp) / (rings - 1)
    n = crowns * samples_per_crown
    th = np.linspace(0, 2 * math.pi, n, endpoint=False)

    def wave(x):
        return (2 / math.pi) * np.arcsin(0.96 * np.sin(x)) / ((2 / math.pi) * math.asin(0.96))

    paths = []  # (theta array, z array, closed)
    for j in range(rings):
        zc = -half + amp + j * pitch
        phase = 0.0 if j % 2 == 0 else math.pi
        paths.append((th, zc + amp * wave(crowns * th + phase), True))
    # links: from a peak of ring j (wave=+1) to the valley of ring j+1 above it
    for j in range(rings - 1):
        zc = -half + amp + j * pitch
        phase = 0.0 if j % 2 == 0 else math.pi
        peaks = [((math.pi / 2 - phase) % (2 * math.pi) + 2 * math.pi * k) / crowns for k in range(crowns)]
        for k in range(j % 3, crowns, 3):
            t0 = peaks[k] % (2 * math.pi)
            zz = np.linspace(zc + amp, zc + pitch - amp, 5)
            paths.append((np.full(5, t0), zz, False))

    def verts_for(radius):
        V = []
        for t, z, closed in paths:
            P = np.stack([radius * np.cos(t), radius * np.sin(t), z], axis=1)
            radial = np.stack([np.cos(t), np.sin(t), np.zeros_like(t)], axis=1)
            V.append(G.tube_ring_verts(P, radial, model.strut, sides, closed))
        return np.concatenate(V, axis=0)

    faces, base = [], 0
    for t, z, closed in paths:
        faces += G.tube_faces(len(t), sides, closed, base=base)
        base += len(t) * sides
    obj = G.new_mesh_object(name, verts_for(model.crimp_r), faces, materials=[mat], sharp_angle=80)
    G.add_shape_keys(obj, [("expanded", verts_for(model.stent_r))])
    return obj


def balloon_radius_profile(z, r_body, r_shaft, body_half, cone):
    a = np.clip((np.abs(z) - body_half) / cone, 0.0, 1.0)
    s = a * a * (3 - 2 * a)
    return r_body + (r_shaft - r_body) * s


def build_balloon(model, mat, name="balloon_v1", deflated=0.16, inflated=None, segments=48):
    inflated = inflated if inflated is not None else model.stent_r - model.strut - 0.003
    body_half = model.stent_half + 0.15
    cone = 0.35
    shaft_r = 0.05
    z = np.linspace(-(body_half + cone), body_half + cone, 90)
    V0 = G.revolve_verts(z, balloon_radius_profile(z, deflated, shaft_r, body_half, cone), segments)
    V1 = G.revolve_verts(z, balloon_radius_profile(z, inflated, shaft_r, body_half, cone), segments)
    F = G.revolve_faces(len(z), segments, caps=True)
    obj = G.new_mesh_object(name, V0, F, materials=[mat], sharp_angle=89)
    G.add_shape_keys(obj, [("inflated", V1)])
    return obj, body_half + cone


def build_shaft(mat, z_top, length=40.0, radius=0.05, name="catheter_shaft_v1"):
    return G.cylinder(name, radius, z_top - length, z_top, 24, mat)


def build_wire(mat, length=40.0, radius=0.016, name="guidewire_v1"):
    """Tip at local z = 0, wire extends downward."""
    return G.cylinder(name, radius, -length, 0.0, 12, mat, rounded_top=True)
