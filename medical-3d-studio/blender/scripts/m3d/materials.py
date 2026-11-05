"""Materials from config/style.yaml (passed in the build spec as hex colours)."""
import bpy


def hex_rgba(h, a=1.0):
    h = h.lstrip("#")
    srgb = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
    return (*lin, a)


def _principled(name, color, rough=0.5, metal=0.0, coat=0.0, sheen=0.0, spec=0.5):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = hex_rgba(color)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    b.inputs["Coat Weight"].default_value = coat
    b.inputs["Sheen Weight"].default_value = sheen
    b.inputs["Specular IOR Level"].default_value = spec
    return m


def _noise_tint(m, color2, scale=6.0, amount=1.0):
    """Mix a second colour in with procedural noise (organic look)."""
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    base = tuple(b.inputs["Base Color"].default_value)
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = scale
    noise.inputs["Detail"].default_value = 3.0
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[0].color = base
    ramp.color_ramp.elements[1].position = 0.75
    ramp.color_ramp.elements[1].color = hex_rgba(color2)
    nt.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])


def _layered_cut(name, colors, radii):
    """Cut face of the vessel wall: colour bands by distance from the axis
    (intima / media / adventitia, simplified)."""
    m = _principled(name, colors[0], rough=0.6)
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    tr = nt.nodes.new("ShaderNodeVectorTransform")
    tr.vector_type = "POINT"
    tr.convert_from = "WORLD"
    tr.convert_to = "OBJECT"
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Position"], tr.inputs["Vector"])
    nt.links.new(tr.outputs["Vector"], sep.inputs["Vector"])
    # radius in the cut plane: |x| (cut faces lie in y = 0)
    absx = nt.nodes.new("ShaderNodeMath")
    absx.operation = "ABSOLUTE"
    nt.links.new(sep.outputs["X"], absx.inputs[0])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    mp = nt.nodes.new("ShaderNodeMapRange")
    mp.inputs["From Min"].default_value = radii[0]
    mp.inputs["From Max"].default_value = radii[-1]
    nt.links.new(absx.outputs["Value"], mp.inputs["Value"])
    nt.links.new(mp.outputs["Result"], ramp.inputs["Fac"])
    els = ramp.color_ramp.elements
    els[0].position = 0.0
    els[0].color = hex_rgba(colors[0])
    els[1].position = (radii[1] - radii[0]) / (radii[-1] - radii[0])
    els[1].color = hex_rgba(colors[1])
    e = els.new((radii[2] - radii[0]) / (radii[-1] - radii[0]))
    e.color = hex_rgba(colors[2])
    nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    return m


def _fade(m, key="Alpha"):
    """Expose alpha so it can be animated (front wall reveal)."""
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Alpha"].default_value = 1.0
    return b.inputs["Alpha"]


def _emission(name, color, strength=1.0, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = hex_rgba(color)
    em.inputs["Strength"].default_value = strength
    if alpha < 1.0:
        tr = nt.nodes.new("ShaderNodeBsdfTransparent")
        mix = nt.nodes.new("ShaderNodeMixShader")
        mix.inputs["Fac"].default_value = alpha
        nt.links.new(tr.outputs[0], mix.inputs[1])
        nt.links.new(em.outputs[0], mix.inputs[2])
        nt.links.new(mix.outputs[0], out.inputs["Surface"])
    else:
        nt.links.new(em.outputs[0], out.inputs["Surface"])
    return m


def build_materials(style, model):
    c = style["colors"]
    mats = {
        "vessel_inner": _principled("vessel_inner", c["vessel_inner"], rough=0.38, coat=0.35, sheen=0.2),
        "vessel_outer": _principled("vessel_outer", c["vessel_outer"], rough=0.55, sheen=0.3),
        "vessel_cut": _layered_cut("vessel_cut", [c["cut_intima"], c["cut_media"], c["cut_adventitia"]],
                                   [model.R - 0.02, model.R + 0.05, model.R + model.W * 0.62, model.R + model.W + 0.2]),
        "plaque": _principled("plaque", c["plaque"], rough=0.55, sheen=0.25),
        "plaque_cut": _principled("plaque_cut", c["plaque_cut"], rough=0.7),
        "front_inner": _principled("front_inner", c["vessel_inner"], rough=0.4),
        "front_outer": _principled("front_outer", c["vessel_outer"], rough=0.5, sheen=0.3, coat=0.2),
        "blood": _principled("blood_cell", c["blood"], rough=0.32, coat=0.4),
        "stent": _principled("stent", c["stent"], rough=0.22, metal=1.0),
        "balloon": _principled("balloon", c["balloon"], rough=0.18, coat=0.8),
        "shaft": _principled("shaft", c["shaft"], rough=0.3, coat=0.5),
        "wire": _principled("wire", c["wire"], rough=0.3, metal=1.0),
        "label_text": _emission("label_text", c["label_text"], strength=1.6),
        "label_plate": _emission("label_plate", c["label_plate"], strength=1.0, alpha=0.72),
        "label_line": _emission("label_line", c["label_text"], strength=1.3),
    }
    _noise_tint(mats["plaque"], c["plaque_2"], scale=7.0)
    _noise_tint(mats["plaque_cut"], c["plaque_cut_2"], scale=9.0)
    _noise_tint(mats["vessel_inner"], c["vessel_inner_2"], scale=4.0)
    mats["balloon"].node_tree.nodes["Principled BSDF"].inputs["Alpha"].default_value = c.get("balloon_alpha", 1.0)
    mats["_front_alpha"] = [_fade(mats["front_inner"]), _fade(mats["front_outer"])]
    return mats


def build_world(style):
    w = bpy.data.worlds.new("bg")
    w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes["Background"]
    bg.inputs["Color"].default_value = hex_rgba(style["colors"]["background"])
    bg.inputs["Strength"].default_value = 1.0
    bpy.context.scene.world = w
    return w
