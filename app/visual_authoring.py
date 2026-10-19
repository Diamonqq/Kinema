"""Visual-craft rules the tutor's scene builder reads (docs/KINEMA-VISUAL-AUTHORING.md is the longer human guide).

Only fields the schemas accept are named: the planar render props come from scenes.RENDER_PROPS, the rigid part props
and colours from rigid3d.PART_PROPS / COLORS, cameras and overlays from the schema lists, so the text cannot drift from
what the app draws. REFERENCES names the library setups (app/visual_library_recipes.py) that show each rule rendered.
This is guidance, not a validator: taste is judged in renders, and the schemas still enforce the data contract.
"""
from __future__ import annotations

from . import rigid3d, scenes

# rule -> library setup ids that show it rendered, for the guide and render checks (the model never sees these ids;
# tests/test_visual_authoring.py checks every id exists)
REFERENCES = {
    "true_size": ["block_on_incline", "rolling_incline", "atwood_massive_pulley"],
    "planar_props": ["atwood_massive_pulley", "spool_pull", "ladder_wall_static", "block_on_free_wedge"],
    "walls": ["ladder_wall_static"],
    "free_pull": ["spool_pull"],
    "light_rod": ["conical_pendulum"],
    "rigid_props": ["heavy_top_nutation", "tilted_rod_axle"],
    "layers": ["block_on_incline", "heavy_top_nutation"],
}


def _pairs(d: dict) -> str:
    return "; ".join(f"{k}: {'|'.join(v)}" for k, v in d.items())


PROMPT = f"""VISUAL CRAFT (how the drawing reads; physics fields never change for looks):
- Sizes. A dimension, position or mass the problem GIVES is fixed: use it exactly; never enlarge a body, thicken a
  string or shorten a ramp to make it visible. One it leaves unspecified (a block's size, a pulley's radius, a ramp's
  length) gets a sensible compact illustrative value, named as illustrative in the caption. The scene numbers are the
  ones the app simulates and reports, so never draw or quote other sizes than the engine's. The app fits the camera to
  the apparatus and its motion. Keep it compact: fixed points, pulleys and walls where the problem has them, not metres away.
- Planar art (mechanics body.render, drawing only): prop by shape {_pairs(scenes.RENDER_PROPS)} (ramp/wedge only
  on a static 3-point polygon); kind {'|'.join(scenes.RENDER_KINDS)}; inner = a spool's axle radius; z = out-of-plane offset for layering.
  The physics outline stays exact: a pulley's groove, a wheel's tyre and a spool's flange sit at r.
- A hoop (inertia hoop) is drawn as an open ring; a uniform disk or ball as solid. Do not choose wheel/pulley/spool art
  to decorate a body whose inertia number says otherwise; set inertia to match the object.
- Walls and ledges: a static edge that is not the floor is drawn as a hatched slab behind its contact line, on the
  side away from the moving bodies.
- A string pulled by hand (its tension names only a force label) ends at a world point along the force; any distance is fine, the camera frames
  at most 1.5x the apparatus of it. A string held by a joint keeps its real fixed end.
- rigid3d: a rod part with at most 3% of the body's mass is drawn as a thin line (a string, a light stem); give a
  real stem its real mass. Part art by shape: {_pairs(rigid3d.PART_PROPS)}; colours {'|'.join(rigid3d.COLORS)}.
- Mechanics bodies take their colours from the app (focus body blue, others sand/teal/rose, fixed parts grey, pulleys and axles steel) and
  arrows from the force colours above; there is no colour, dash or line-style field, so do not ask for one.
- Cameras {'|'.join(scenes.CAMERAS)}: a planar scene plays in its own x/y plane (side) for setup, forces and answer;
  hero only when a prop's depth teaches something; top only for topdown scenes. Full setup always frames the whole
  motion; the app picks follow by itself when the focus body travels far. closeup frames the focus body (rigid3d:
  its heaviest part) larger and moves with it; the rest of the apparatus may be off screen.
- Composition: the working body must read clearly, never as a dot; unspecified walls, floors and supports
  end a little past their contacts, not metres beyond. The app keeps labels apart and arrows readable.
- Layers: each step shows only what it explains (about 3-6 labelled arrows): setup, then forces, then components
  as separate steps. When labels would crowd, split the step or use focus on one body; never overlay everything.
  An overlay the problem asks for must be in the FIRST step's show (scene-level show alone does not display it).
- Labels: a distance or reference label is a short quantity ("1.00 m"); full givens (mass, shape, size) belong in
  the caption or key, not on the drawing.
"""
