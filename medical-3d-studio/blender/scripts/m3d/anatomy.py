"""Educational vessel model: artery wall cutaway + plaque (concept model).

One numeric model (LesionModel) defines the lumen, the plaque and the wall for
any stent expansion state u in [0, 1]. Blood cells and devices use the same
functions, so nothing passes through tissue by accident.

Concept rules (see topic claims C04/C05/C07):
- the balloon/stent pushes plaque outward; plaque is compressed, never removed;
- the wall stretches a little only after the plaque is fully compressed.
"""
import math

import numpy as np

from . import geometry as G


class LesionModel:
    def __init__(self, p):
        self.R = p.get("lumen_radius", 1.0)
        self.W = p.get("wall_thickness", 0.28)
        self.z_min, self.z_max = p.get("vessel_z", [-9.0, 9.0])
        self.L = p.get("plaque_length", 3.0)
        self.t_max = p.get("plaque_max_thickness", 0.62)
        self.asym = p.get("plaque_asymmetry", 0.5)  # 0 = concentric
        self.t_comp = p.get("compressed_thickness", 0.17)
        self.stent_half = p.get("stent_half_length", 1.55)
        self.stent_r = p.get("stent_radius", 0.975)  # strut centre line, expanded
        self.crimp_r = p.get("crimp_radius", 0.20)
        self.strut = p.get("strut_radius", 0.022)

    # profiles ------------------------------------------------------------
    def p(self, z):
        z = np.asarray(z, dtype=float)
        x = np.clip(np.abs(z) / (self.L / 2.0), 0.0, 1.0)
        return np.cos(x * math.pi / 2.0) ** 2

    def thickness0(self, z, th):
        z = np.asarray(z, dtype=float)
        th = np.asarray(th, dtype=float)
        # 1.0 on the left cut edge (theta = pi), (1 - asym) on the right edge
        a = (1.0 - self.asym) + self.asym * 0.5 * (1.0 - np.cos(th))
        bumps = 1.0 + 0.07 * np.sin(5.3 * z + 2.0 * th) + 0.05 * np.sin(11.0 * z - 3.0 * th + 1.0)
        return self.t_max * self.p(z) * a * bumps

    def stent_profile(self, z):
        z = np.abs(np.asarray(z, dtype=float))
        x = np.clip((z - self.stent_half) / 0.2, 0.0, 1.0)
        return 1.0 - x * x * (3 - 2 * x)

    def stent_outer(self, u):
        return self.crimp_r + u * (self.stent_r - self.crimp_r) + self.strut

    # surfaces --------------------------------------------------------------
    def narrow(self, z, th):
        return self.R - self.thickness0(z, th)

    def lumen(self, z, th, u):
        return np.maximum(self.narrow(z, th), self.stent_outer(u) * self.stent_profile(z) if u > 0 else 0.0)

    def wall_inner(self, z, th, u):
        tmin = self.t_comp * self.p(z)
        return np.maximum(self.R, self.lumen(z, th, u) + tmin)


def _z_samples(model, dense=0.04, coarse=0.22, dense_span=2.6):
    zs = list(np.arange(model.z_min, -dense_span, coarse))
    zs += list(np.arange(-dense_span, dense_span, dense))
    zs += list(np.arange(dense_span, model.z_max, coarse)) + [model.z_max]
    return np.array(sorted(set(round(z, 5) for z in zs)))


def build_vessel(model, mats, name, stages, offset=(0.0, 0.0, 0.0), theta_res=64):
    """Back half of the artery wall + plaque, with one shape key per stage u."""
    z = _z_samples(model)
    th = np.linspace(0.0, math.pi, theta_res + 1)
    Z, TH = np.meshgrid(z, th, indexing="ij")

    def wall_verts(u):
        wi = model.wall_inner(Z, TH, u)
        return G.shell_verts(z, th, wi, wi + model.W, offset)

    faces, mi = G.shell_topology(len(z), len(th))
    wall = G.new_mesh_object(name + "_wall", wall_verts(0.0), faces, mi,
                             [mats["vessel_inner"], mats["vessel_outer"], mats["vessel_cut"], mats["vessel_cut"]])
    if stages:
        G.add_shape_keys(wall, [(f"u{k:02d}", wall_verts(u)) for k, u in stages])

    # plaque: only where it exists (plus margin), slightly wider than the cut
    zp = np.array([v for v in z if abs(v) <= model.L / 2 + 0.06])
    d = 0.004
    thp = np.linspace(-d, math.pi + d, theta_res + 1)
    ZP, THP = np.meshgrid(zp, thp, indexing="ij")

    def plaque_verts(u):
        inner = model.lumen(ZP, np.clip(THP, 0, math.pi), u)
        # where the plaque thins out, tuck its surface just behind the wall so
        # the two surfaces never coincide (avoids a jagged seam)
        inner = inner + 0.02 * (1.0 - np.clip(model.p(ZP) * 15.0, 0.0, 1.0))
        outer = model.wall_inner(ZP, np.clip(THP, 0, math.pi), u) + 0.03
        inner = np.minimum(inner, outer - 0.004)
        return G.shell_verts(zp, thp, inner, outer, offset)

    pf, pmi = G.shell_topology(len(zp), len(thp))
    plaque = G.new_mesh_object(name + "_plaque", plaque_verts(0.0), pf, pmi,
                               [mats["plaque"], mats["plaque"], mats["plaque_cut"], mats["plaque"]], sharp_angle=50)
    if stages:
        G.add_shape_keys(plaque, [(f"u{k:02d}", plaque_verts(u)) for k, u in stages])
    return wall, plaque


def build_front_wall(model, mats, name, offset=(0.0, 0.0, 0.0), theta_res=64):
    """Front half (removed in the cutaway) – used for the opening reveal."""
    z = _z_samples(model, dense=0.08, coarse=0.3)
    # a hair larger than the back half and not touching its cut edges:
    # shared edges made see-through rays leak and draw dark lines during the fade
    gap = 0.006
    th = np.linspace(math.pi + gap, 2 * math.pi - gap, theta_res + 1)
    Z, TH = np.meshgrid(z, th, indexing="ij")
    wi = np.full(Z.shape, model.R + gap)
    V = G.shell_verts(z, th, wi, wi + model.W, offset)
    faces, mi = G.shell_topology(len(z), len(th))
    # its cut faces would sit exactly on the back half's cut faces (flicker), so they are invisible
    return G.new_mesh_object(name, V, faces, mi, [mats["front_inner"], mats["front_outer"], mats["hidden"], mats["hidden"]])
