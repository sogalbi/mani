"""Motion presets (assets/motion_presets/vessel_device_v1.json documents them).

Each preset writes eased segments onto timeline channels, using times
relative to the shot (0 = shot start, 1 = shot end). Channels:

  front_alpha   front half of the vessel (1 opaque → 0 removed)
  cells_main    blood cells in the main vessel visible (0/1)
  cells_before  blood cells in the 'before' comparison vessel visible (0/1)
  before_vis    'before' comparison vessel visible (0/1)
  devices_vis   guidewire + balloon catheter visible (0/1)
  wire_tip_z    guidewire tip height
  carrier_z     balloon centre height (stent rides on it until expansion)
  balloon_v     balloon inflation 0..1
  stent_u       stent expansion 0..1 (also drives plaque compression)
"""

DEFAULTS = {
    "front_alpha": 1.0,
    "cells_main": 1.0,
    "cells_before": 0.0,
    "before_vis": 0.0,
    "devices_vis": 0.0,
    "wire_tip_z": -9.5,
    "carrier_z": -13.0,
    "balloon_v": 0.0,
    "stent_u": 0.0,
}

PARKED_CARRIER_Z = DEFAULTS["carrier_z"]


def _rel(f0, f1):
    return lambda t: int(round(f0 + (f1 - f0) * t))


def reveal_cutaway(tl, f0, f1, p):
    r = _rel(f0, f1)
    tl.add("front_alpha", r(p.get("fade_start", 0.45)), r(p.get("fade_end", 0.95)), 1.0, 0.0)
    tl.set("cells_main", f0, 1.0)


def flow_through_stenosis(tl, f0, f1, p):
    tl.set("front_alpha", f0, 0.0)
    tl.set("cells_main", f0, 1.0)


def device_approach(tl, f0, f1, p):
    r = _rel(f0, f1)
    tl.set("front_alpha", f0, 0.0)
    tl.set("cells_main", r(0.06), 0.0)
    tl.set("devices_vis", f0, 1.0)
    tl.add("wire_tip_z", r(0.02), r(0.36), DEFAULTS["wire_tip_z"], p.get("wire_tip_z", 5.0))
    tl.add("carrier_z", r(0.34), r(0.95), -10.0, 0.0)
    tl.set("carrier_z", r(0.33), -10.0)


def balloon_stent_expansion(tl, f0, f1, p):
    r = _rel(f0, f1)
    a, b = p.get("inflate", [0.06, 0.36])
    tl.add("balloon_v", r(a), r(b), 0.0, 1.0)
    tl.add("stent_u", r(a), r(b), 0.0, 1.0)


def balloon_withdrawal(tl, f0, f1, p):
    r = _rel(f0, f1)
    tl.add("balloon_v", r(0.03), r(0.24), 1.0, 0.0)
    tl.add("carrier_z", r(0.30), r(0.92), 0.0, -11.0, "in")
    tl.add("wire_tip_z", r(0.36), r(0.97), 5.0, -9.5, "in")
    tl.set("devices_vis", f1, 0.0)


def before_after_compare(tl, f0, f1, p):
    tl.set("before_vis", f0, 1.0)
    tl.set("before_vis", f1 + 1, 0.0)
    tl.set("cells_before", f0, 1.0)
    tl.set("cells_before", f1 + 1, 0.0)
    tl.set("cells_main", f0, 1.0)


def summary_orbit(tl, f0, f1, p):
    tl.set("cells_main", f0, 1.0)


PRESETS = {
    "reveal_cutaway": reveal_cutaway,
    "flow_through_stenosis": flow_through_stenosis,
    "device_approach": device_approach,
    "educational_expansion_visualization": balloon_stent_expansion,
    "balloon_withdrawal": balloon_withdrawal,
    "before_after_compare": before_after_compare,
    "summary_orbit": summary_orbit,
}
