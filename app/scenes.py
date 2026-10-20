"""Kinema — the general SCENE language (any planar rigid-body problem), its strict JSON schema, its validator and the
model prompt. The template registry (registry.py) stays as the closed-form oracle; the model now writes a scene for
the general engine (static/js/engine2d.js, planck/Box2D) instead of picking a template.

Owner (2026-09-04): "it has to work for literally any unique problem, not these super optimized scenarios".

A scene = bodies (circle/box/polygon/edge; static or dynamic with mass + inertia), joints (pivot, rod, spring, rope,
pulley, slider, gear, weld, friction), impulses, applied forces, drawn strings, no-collide pairs, a focus body, a
duration — plus the tutor fields: steps (pause times, overlays, camera), checks (numbers the app measures in its own
simulation and compares with the model's), the answer.

STRICT structured-output rules (OpenAI rejects anything else — live 2026-09-04): every object lists ALL its properties
in `required` and has additionalProperties:false; optional fields are nullable via type arrays; no free-form maps.
"""
from __future__ import annotations

import copy
import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXAMPLES_PATH = ROOT / "app" / "content" / "scene_examples.json"

INERTIA_WORDS = ["solid_sphere", "solid_cylinder", "hoop", "shell", "rod", "plate", "point"]
SHAPES = ["circle", "box", "polygon", "edge"]
JOINT_TYPES = ["pivot", "rod", "spring", "rope", "pulley", "slider", "gear", "weld", "friction"]
RENDER_KINDS = ["sphere", "disk", "box", "rod", "slab", "floor"]
CAMERAS = ["hero", "follow", "side", "top", "closeup"]
STEP_SHOWS = ["forces", "velocity", "labels", "all_forces", "trail", "tensions", "energy", "axes"]
# Presentation-only prop art (static/js/prop_library.js) per body shape; never mass, size or contact.
RENDER_PROPS = {"circle": ["pulley", "wheel", "spool"], "box": ["block", "cart", "beam", "ladder"], "polygon": ["ramp", "wedge"]}
CHECK_QUANTITIES = ["speed", "omega", "vx", "vy", "x", "y", "angle_deg", "ax", "ay", "ke", "normal", "friction", "joint_force", "mass", "inertia"]
LAMBDA_OK = re.compile(r"^[0-9a-zA-Z_+\-*/^().,\s]{1,200}$")

LIMITS = {"mass": (1e-4, 1e5), "r": (1e-3, 100.0), "w": (1e-3, 100.0), "h": (1e-3, 100.0), "friction": (0.0, 50.0),
          "restitution": (0.0, 1.0), "gravity": (0.0, 100.0), "duration": (0.1, 60.0), "coord": (-1e4, 1e4),
          "vel": (-1e4, 1e4), "omega": (-1e4, 1e4), "inertia": (1e-9, 1e6)}
MAX_BODIES, MAX_JOINTS, MAX_IMPULSES, MAX_FORCES, MAX_STEPS, MAX_CHECKS = 40, 40, 20, 20, 14, 12


def _num(desc: str = "") -> dict:
    d: dict = {"type": ["number", "null"]}
    if desc:
        d["description"] = desc
    return d


def _vec(desc: str, nullable: bool = True) -> dict:
    return {"type": ["array", "null"] if nullable else "array", "items": {"type": "number"}, "description": desc + " — [x, y]"}


def _str(desc: str = "", nullable: bool = True) -> dict:
    d: dict = {"type": ["string", "null"] if nullable else "string"}
    if desc:
        d["description"] = desc
    return d


def _obj(props: dict, desc: str = "") -> dict:
    d: dict = {"type": "object", "additionalProperties": False, "required": list(props), "properties": props}
    if desc:
        d["description"] = desc
    return d


BODY = _obj({
    "id": _str("short unique name, e.g. ball, rod, m1, ramp", False),
    "type": {"type": "string", "enum": ["dynamic", "static"]},
    "shape": {"type": "string", "enum": SHAPES},
    "r": _num("circle radius (m)"),
    "w": _num("box width along its own x (m)"),
    "h": _num("box height along its own y (m)"),
    "points": {"type": ["array", "null"], "items": {"type": "array", "items": {"type": "number"}},
               "description": "polygon: 3-8 vertices counter-clockwise, relative to pos; edge: exactly 2 points (a ground line) in metres, relative to pos and turned by angle_deg like a polygon (pos [0,0] and angle 0 make them world coordinates)"},
    "pos": _vec("centre (circle/box) or origin (polygon/edge) in world metres, y up", False),
    "angle_deg": _num("initial rotation, degrees counter-clockwise"),
    "vel": _vec("initial velocity m/s"),
    "omega": _num("initial angular velocity rad/s, counter-clockwise positive"),
    "mass": _num("kg (dynamic bodies)"),
    "inertia": {"type": ["number", "string", "null"],
                "description": "moment of inertia about the centre: a number in kg·m², or a word: solid_sphere (2/5 mr²), "
                               "solid_cylinder (1/2 mr²), hoop (mr²), shell (2/3 mr²), rod (mL²/12 along the long side), "
                               "plate ((w²+h²)m/12), point (0)"},
    "lambda": _str("a NON-UNIFORM rod (box only): its mass per unit length as an expression in x (metres from the centre along its "
                   "length) and l (its length), e.g. \"2*(1-2*x/l)^3\" for m0 = 2 kg — the engine integrates it for the mass, the centre "
                   "of mass and the inertia (then mass/inertia fields are ignored)"),
    "friction": _num("friction coefficient of this body's surface (default 0.5); use 30 for 'rolls without slipping'"),
    "restitution": _num("0 = perfectly inelastic contact (default), 1 = elastic"),
    "bullet": {"type": ["boolean", "null"], "description": "true for a small fast body that must not tunnel"},
    "label": _str("what the student sees, e.g. m₁"),
    "render_kind": {"type": ["string", "null"], "enum": RENDER_KINDS + [None],
                    "description": "how to draw it: sphere or disk for circles, box or rod for boxes, slab for polygons, floor for edges"},
    "render_inner": _num("a spool's inner drum radius (drawn only)"),
    "render_z": _num("draw offset toward the viewer, for stacked disks in a top view"),
})

JOINT = _obj({
    "id": _str("unique name", False),
    "type": {"type": "string", "enum": JOINT_TYPES,
             "description": "pivot = hinge at anchor; rod = fixed distance between anchorA and anchorB; spring = spring of stiffness k and "
                            "rest length; rope = max length between anchorA and anchorB; pulley = massless rope over two fixed ground "
                            "points; slider = body b slides along axis through anchor; gear = coordinateA + ratio·coordinateB is constant "
                            "between joint1 (a slider or pivot on a) and joint2 (on b) — a string that does not slip on a massive pulley; "
                            "weld = rigid; friction = a friction pad between a and b with maxForce/maxTorque"},
    "a": _str("body id or 'world'", False),
    "b": _str("body id", False),
    "anchor": _vec("world point for pivot/slider/weld/friction"),
    "anchorA": _vec("world point on a (rod/spring/rope/pulley)"),
    "anchorB": _vec("world point on b (rod/spring/rope/pulley)"),
    "length": _num("rod length / rope max length (m); default = initial distance"),
    "groundA": _vec("pulley: fixed point above a"),
    "groundB": _vec("pulley: fixed point above b"),
    "ratio": _num("pulley ratio or gear ratio (gear: metres of travel per radian, e.g. +R or -R)"),
    "axis": _vec("slider axis"),
    "joint1": _str("gear: id of the joint on body a"),
    "joint2": _str("gear: id of the joint on body b"),
    "k": _num("spring stiffness N/m"),
    "rest": _num("spring rest length m"),
    "damping": _num("spring damping ratio 0..1"),
    "maxForce": _num("friction joint: maximum force N"),
    "maxTorque": _num("friction joint: maximum torque N·m"),
    "label": _str("force label shown on the body, e.g. T₁ or F_pivot"),
})

IMPULSE = _obj({
    "body": _str("", False), "at": _vec("world point of the blow; null = centre"), "J": _vec("impulse N·s", False),
    "t": {"type": "number", "description": "seconds"},
}, "an instantaneous blow")

FORCE = _obj({
    "body": _str("", False), "F": _vec("force N", False), "offset": _vec("point of application relative to the body centre (world axes); null = centre"),
    "from": _num("start time s (default 0)"), "to": _num("end time s (default forever)"), "label": _str("e.g. T"),
}, "a constant applied force (a pulled string, a push)")

ROPE = _obj({"body": _str("", False), "top": _vec("fixed world point the drawn string runs to", False)},
            "a string drawn from a body to a fixed point (drawing only — the joints carry the physics)")

VIA = _obj({
    "body": _str("a body the string is tied to"),
    "attach": _str("where on that body: top, bottom, left, right, center"),
    "local": _vec("or an exact point in the body's own frame (metres from its centre)"),
    "wrap": _str("a circle body (pulley, peg, drum) the string wraps around"),
    "ccw": {"type": ["boolean", "null"], "description": "wrap direction of travel from the previous point: true = counter-clockwise, false = clockwise (over the top from left to right is false)"},
    "world": _vec("or a fixed world point (a hook, a hand, a wall)"),
}, "one waypoint of a string: exactly one of body / wrap / world")
STRING = _obj({
    "id": _str("", False),
    "via": {"type": "array", "items": VIA, "description": "the path of the string in order, e.g. [{body:m1, attach:top}, {wrap:pulley, ccw:false}, {body:m2, attach:top}]"},
    "tension": {"type": "array", "items": {"type": "string"}, "description": "per straight segment, the joint (or applied-force label) whose force IS that segment's tension, e.g. [\"string1\", \"string2\"]"},
    "labels": {"type": "array", "items": {"type": "string"}, "description": "per segment, what to call the tension: T₁, T₂ …"},
}, "a drawn string that follows bodies and wraps pulleys; click it in the app to see its tension")

ACTION_TYPES = ["focus", "camera", "zoom", "pause_at", "play", "show", "highlight", "decompose", "angle", "dimension", "sweep_integral", "torque", "ghost", "energy_bars"]
ACTION = _obj({
    "type": {"type": "string", "enum": ACTION_TYPES,
             "description": "focus(body) fades the others and shows that body's forces; camera(view) / zoom(body, factor); pause_at(t); "
                            "play(from, to, speed) runs the motion slowly; show(overlays: forces, velocity, trail, labels, all_forces, tensions); "
                            "highlight(items: force labels or body ids); decompose(force, along: surface | velocity | x | y | [ux,uy]) splits a "
                            "force into components with dotted projections — the sin/cos picture; angle(points: [vertex, p1, p2], label); "
                            "dimension(points: [p1, p2], label); sweep_integral(body, integrand: lambda | x*lambda | x^2*lambda | any "
                            "expression in x, l, lambda; from, to, duration, label, units) sweeps a slice along a non-uniform rod while "
                            "the integral accumulates; torque(force, about: joint id or [x,y]) draws the lever arm and r×F; ghost(body, at: "
                            "[times]) leaves translucent copies; energy_bars"},
    "body": _str("body id"),
    "force": _str("a force label on the focus body: mg, N, f, T, T₁, F_pivot, F …"),
    "along": {"type": ["string", "array", "null"], "items": {"type": "number"}, "description": "decompose: surface | velocity | x | y | [ux, uy]"},
    "view": {"type": ["string", "null"], "enum": CAMERAS + [None]},
    "t": _num("pause_at: seconds"),
    "from": _num("play / sweep_integral: start (s or m)"),
    "to": _num("play / sweep_integral: end (s or m)"),
    "speed": _num("play: 0.1 – 2"),
    "factor": _num("zoom: 1.5 – 6"),
    "integrand": _str("sweep_integral: lambda, x*lambda, x^2*lambda, or an expression in x, l, lambda"),
    "duration": _num("sweep_integral: seconds the sweep takes (3 – 8)"),
    "label": _str("what the drawn thing is called"),
    "units": _str("sweep_integral: units of the accumulated value, e.g. kg, kg·m²"),
    "about": {"type": ["string", "array", "null"], "items": {"type": "number"}, "description": "torque: a pivot joint id or a world point [x, y]"},
    "points": {"type": ["array", "null"], "items": {"type": "array", "items": {"type": "number"}}, "description": "angle: [vertex, p1, p2]; dimension: [p1, p2] — world metres"},
    "at": {"type": ["array", "null"], "items": {"type": "number"}, "description": "ghost: times in seconds"},
    "overlays": {"type": ["array", "null"], "items": {"type": "string"}, "description": "show: forces, velocity, trail, labels, all_forces, tensions"},
    "items": {"type": ["array", "null"], "items": {"type": "string"}, "description": "highlight: force labels or body ids"},
})
STEP = _obj({
    "title": _str("", False),
    "body": {"type": "string", "description": "markdown with $...$ / $$...$$ LaTeX — one idea, 2–6 sentences"},
    "at": _num("seconds into the motion to pause at, or null"),
    "show": {"type": "array", "items": {"type": "string", "enum": STEP_SHOWS}},
    "camera": {"type": ["string", "null"], "enum": CAMERAS + [None]},
    "highlight": {"type": "array", "items": {"type": "string"}, "description": "force labels to glow, e.g. N, f, mg, T₁"},
    "actions": {"type": "array", "items": ACTION, "description": "what the stage does while this step is read, in order"},
})

CHECK = _obj({
    "label": _str("what this number is, e.g. speed at the bottom", False),
    "quantity": {"type": "string", "enum": CHECK_QUANTITIES,
                 "description": "what the app measures in its own simulation: speed/omega/vx/vy/x/y/angle_deg/ax/ay/ke of a body, "
                                "normal or friction force magnitude on a body, joint_force magnitude of a joint, mass or inertia "
                                "(about its centre of mass) of a body — the engine integrates a lambda density profile itself"},
    "body": _str("body id (or null for joint_force)"),
    "joint": _str("joint id for joint_force"),
    "at": _num("time in seconds, or null for the end of the motion"),
    "expect": {"type": "number", "description": "your predicted value, SI"},
    "tol_pct": {"type": "number", "description": "acceptable disagreement in percent, e.g. 3"},
})

SCENE_SCHEMA = _obj({
    "title": _str("", False),
    "restatement": {"type": "string", "description": "the problem in one or two plain sentences, with the numbers you chose"},
    "gravity": {"type": "number", "description": "m/s², 0 for a frictionless-table top view"},
    "duration": {"type": "number", "description": "seconds to simulate — just past the interesting motion"},
    "topdown": {"type": "boolean", "description": "true = the plane is a table seen from above (gravity 0)"},
    "focus": _str("id of the body the free-body diagram and camera follow", False),
    "camera": {"type": ["string", "null"], "enum": CAMERAS + [None]},
    "bodies": {"type": "array", "items": BODY},
    "joints": {"type": "array", "items": JOINT},
    "impulses": {"type": "array", "items": IMPULSE},
    "forces": {"type": "array", "items": FORCE},
    "ropes": {"type": "array", "items": ROPE},
    "strings": {"type": "array", "items": STRING},
    "nocollide": {"type": "array", "items": {"type": "array", "items": {"type": "string"}},
                  "description": "pairs of body ids that must pass through each other"},
    "stick": {"type": "array", "items": {"type": "array", "items": {"type": "string"}},
              "description": "pairs of body ids that become one body at their first contact (putty, a ball that sticks to a rod): a perfectly inelastic collision"},
    "givens": {"type": "array", "items": {"type": "string"}},
    "unknowns": {"type": "array", "items": {"type": "string"}},
    "steps": {"type": "array", "items": STEP},
    "checks": {"type": "array", "items": CHECK},
    "answer": _obj({"label": _str("", False), "value": _num(), "units": _str("", False),
                    "expression": _str("symbolic answer in LaTeX", False), "note": _str("", False)}),
    "notes": {"type": "string"},
})


def schema_file_text() -> str:
    return json.dumps(SCENE_SCHEMA, indent=1)


# ── validation / repair ────────────────────────────────────────────────────────

def _f(v, default=None):
    try:
        x = float(v)
        return x if math.isfinite(x) else default
    except (TypeError, ValueError):
        return default


def _clamp(name: str, v: float, key: str, warnings: list[str]) -> float:
    lo, hi = LIMITS[key]
    if v < lo or v > hi:
        c = min(max(v, lo), hi)
        warnings.append(f"{name}: {v:g} clamped to {c:g}")
        return c
    return v


def _vec2(v, name: str, warnings: list[str], key: str = "coord"):
    if not isinstance(v, (list, tuple)) or len(v) < 2:
        return None
    x, y = _f(v[0]), _f(v[1])
    if x is None or y is None:
        warnings.append(f"{name}: not a number pair — ignored")
        return None
    return [_clamp(name + ".x", x, key, warnings), _clamp(name + ".y", y, key, warnings)]


def _body(raw: dict, warnings: list[str]) -> dict | None:
    bid = str(raw.get("id") or "").strip()[:40]
    if not bid:
        warnings.append("a body without an id was dropped")
        return None
    shape = raw.get("shape")
    if shape not in SHAPES:
        warnings.append(f"{bid}: unknown shape {shape!r} — dropped")
        return None
    static = raw.get("type") == "static" or shape == "edge"
    b: dict = {"id": bid, "shape": shape}
    if static:
        b["type"] = "static"
    pos = _vec2(raw.get("pos"), f"{bid}.pos", warnings) or [0.0, 0.0]
    b["pos"] = pos
    if shape == "circle":
        r = _f(raw.get("r"))
        if r is None:
            warnings.append(f"{bid}: circle without r — r = 0.1")
            r = 0.1
        b["r"] = _clamp(f"{bid}.r", r, "r", warnings)
    elif shape == "box":
        w, h = _f(raw.get("w")), _f(raw.get("h"))
        if w is None or h is None:
            warnings.append(f"{bid}: box needs w and h — using 0.2 x 0.2")
            w, h = w or 0.2, h or 0.2
        b["w"] = _clamp(f"{bid}.w", w, "w", warnings)
        b["h"] = _clamp(f"{bid}.h", h, "h", warnings)
    else:
        pts = [p for p in (raw.get("points") or []) if isinstance(p, (list, tuple)) and len(p) >= 2]
        pts = [[_clamp(f"{bid}.points", _f(p[0], 0.0), "coord", warnings), _clamp(f"{bid}.points", _f(p[1], 0.0), "coord", warnings)] for p in pts]
        if shape == "edge":
            if len(pts) < 2:
                warnings.append(f"{bid}: edge needs 2 points — dropped")
                return None
            b["points"] = pts[:2]
        else:
            if len(pts) < 3:
                warnings.append(f"{bid}: polygon needs 3-8 points — dropped")
                return None
            if len(pts) > 8:
                warnings.append(f"{bid}: polygon trimmed to 8 points")
                pts = pts[:8]
            # counter-clockwise (Box2D requires it): flip if the signed area is negative
            area = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))
            if area < 0:
                pts = pts[::-1]
            if abs(area) < 1e-9:
                warnings.append(f"{bid}: degenerate polygon — dropped")
                return None
            b["points"] = pts
    ang = raw.get("angle_deg")
    if ang is not None and _f(ang) is not None:
        b["angle"] = math.radians(_f(ang))
    elif _f(raw.get("angle")) is not None:                    # engine format (radians) — the examples come this way
        b["angle"] = _f(raw.get("angle"))
    if not static:
        lam = raw.get("lambda")
        if isinstance(lam, str) and lam.strip():
            if shape == "box" and LAMBDA_OK.match(lam.strip()):
                b["lambda"] = lam.strip()
            else:
                warnings.append(f"{bid}: density profile {lam!r} is not allowed (box only; numbers, x, l, + - * / ^, sin cos exp sqrt abs ln log) — ignored")
        m = _f(raw.get("mass"))
        if m is None:
            if "lambda" not in b:
                warnings.append(f"{bid}: dynamic body without mass — 1 kg")
            m = 1.0
        b["mass"] = _clamp(f"{bid}.mass", m, "mass", warnings)
        inr = raw.get("inertia")
        if isinstance(inr, str):
            if inr in INERTIA_WORDS:
                b["inertia"] = inr
            else:
                warnings.append(f"{bid}: inertia word {inr!r} unknown — using the shape's own")
        elif _f(inr) is not None:
            b["inertia"] = _clamp(f"{bid}.inertia", _f(inr), "inertia", warnings)
        v = _vec2(raw.get("vel"), f"{bid}.vel", warnings, "vel")
        if v:
            b["vel"] = v
        om = _f(raw.get("omega"))
        if om is not None:
            b["omega"] = _clamp(f"{bid}.omega", om, "omega", warnings)
        if raw.get("bullet"):
            b["bullet"] = True
    fr = _f(raw.get("friction"))
    if fr is not None:
        b["friction"] = _clamp(f"{bid}.friction", fr, "friction", warnings)
    re_ = _f(raw.get("restitution"))
    if re_ is not None:
        b["restitution"] = _clamp(f"{bid}.restitution", re_, "restitution", warnings)
    if raw.get("label"):
        b["label"] = str(raw["label"])[:24]
    render = dict(raw.get("render") or {})
    for k_src, k_dst in (("render_kind", "kind"), ("render_inner", "inner"), ("render_z", "z")):
        if raw.get(k_src) is not None:
            render[k_dst] = raw[k_src]
    if render.get("kind") not in RENDER_KINDS:
        render.pop("kind", None)
    if "prop" in render and (render["prop"] not in RENDER_PROPS.get(shape, []) or (shape == "polygon" and (not static or len(b.get("points") or []) != 3))):
        render.pop("prop")                                      # drawing only: an unsupported prop falls back to the plain shape
    for k in ("inner", "z"):
        if k in render and _f(render[k]) is None:
            render.pop(k)
    if render:
        b["render"] = render
    return b


def _joint(raw: dict, ids: set[str], jids: set[str], warnings: list[str]) -> dict | None:
    jid = str(raw.get("id") or "").strip()[:40] or f"joint_{len(jids) + 1}"
    jt = raw.get("type")
    if jt not in JOINT_TYPES:
        warnings.append(f"{jid}: unknown joint type {jt!r} — dropped")
        return None
    a, b = str(raw.get("a") or "world"), str(raw.get("b") or "")
    if a != "world" and a not in ids:
        warnings.append(f"{jid}: body {a!r} does not exist — dropped")
        return None
    if b not in ids:
        warnings.append(f"{jid}: body {b!r} does not exist — dropped")
        return None
    j: dict = {"id": jid, "type": jt, "a": a, "b": b}
    for k in ("anchor", "anchorA", "anchorB", "groundA", "groundB", "axis"):
        v = _vec2(raw.get(k), f"{jid}.{k}", warnings)
        if v:
            j[k] = v
    for k in ("length", "ratio", "k", "rest", "damping", "maxForce", "maxTorque", "frequencyHz"):
        v = _f(raw.get(k))
        if v is not None:
            j[k] = v
    if jt in ("pivot", "slider", "weld", "friction") and "anchor" not in j:
        if "anchorA" in j:
            j["anchor"] = j["anchorA"]
        elif jt != "friction":
            warnings.append(f"{jid}: {jt} needs an anchor — dropped")
            return None
    if jt in ("rod", "spring", "rope") and ("anchorA" not in j or "anchorB" not in j):
        if "anchor" in j and "anchorA" not in j:
            j["anchorA"] = j["anchor"]
        if "anchorB" not in j or "anchorA" not in j:
            warnings.append(f"{jid}: {jt} needs anchorA and anchorB — dropped")
            return None
    if jt == "rope" and "length" not in j:
        j["length"] = math.dist(j["anchorA"], j["anchorB"])
    if jt == "pulley" and not all(k in j for k in ("groundA", "groundB", "anchorA", "anchorB")):
        warnings.append(f"{jid}: pulley needs groundA, groundB, anchorA, anchorB — dropped")
        return None
    if jt == "slider":
        j.setdefault("axis", [0.0, 1.0])
    if jt == "gear":
        j1, j2 = str(raw.get("joint1") or ""), str(raw.get("joint2") or "")
        if j1 not in jids or j2 not in jids:
            warnings.append(f"{jid}: gear needs existing joint1/joint2 ({j1!r}, {j2!r}) — dropped")
            return None
        j["joint1"], j["joint2"] = j1, j2
        j.setdefault("ratio", 1.0)
    if raw.get("label"):
        j["label"] = str(raw["label"])[:24]
    return j


def validate_spec(raw: dict) -> tuple[dict, list[str]]:
    """Repair what the model returned into a scene the engine will run (engine format), keeping the tutor fields."""
    warnings: list[str] = []
    s = copy.deepcopy(raw) if isinstance(raw, dict) else {}
    out: dict = {"title": str(s.get("title") or "Scene")[:160], "restatement": str(s.get("restatement") or "")[:800]}
    out["gravity"] = _clamp("gravity", _f(s.get("gravity"), 9.8), "gravity", warnings)
    out["duration"] = _clamp("duration", _f(s.get("duration"), 3.0), "duration", warnings)
    out["topdown"] = bool(s.get("topdown"))
    bodies: list[dict] = []
    ids: set[str] = set()
    for rb in (s.get("bodies") or [])[:MAX_BODIES]:
        if not isinstance(rb, dict):
            continue
        b = _body(rb, warnings)
        if not b:
            continue
        if b["id"] in ids:
            warnings.append(f"{b['id']}: duplicate id — dropped")
            continue
        ids.add(b["id"])
        bodies.append(b)
    if not bodies:
        warnings.append("no usable bodies")
    out["bodies"] = bodies
    joints: list[dict] = []
    jids: set[str] = set()
    raw_joints = [j for j in (s.get("joints") or [])[:MAX_JOINTS] if isinstance(j, dict)]
    raw_joints.sort(key=lambda j: 1 if j.get("type") == "gear" else 0)      # gears reference other joints: build them last
    for rj in raw_joints:
        j = _joint(rj, ids, jids, warnings)
        if not j:
            continue
        if j["id"] in jids:
            warnings.append(f"{j['id']}: duplicate joint id — dropped")
            continue
        jids.add(j["id"])
        joints.append(j)
    out["joints"] = joints
    imps = []
    for ri in (s.get("impulses") or [])[:MAX_IMPULSES]:
        if not isinstance(ri, dict) or str(ri.get("body")) not in ids:
            warnings.append("an impulse on a missing body was dropped")
            continue
        J = _vec2(ri.get("J"), "impulse.J", warnings, "vel")
        if not J:
            continue
        imp = {"body": str(ri["body"]), "J": J, "t": max(0.0, _f(ri.get("t"), 0.0))}
        at = _vec2(ri.get("at"), "impulse.at", warnings)
        imp["at"] = at if at else "center"
        imps.append(imp)
    out["impulses"] = imps
    forces = []
    for rf in (s.get("forces") or [])[:MAX_FORCES]:
        if not isinstance(rf, dict) or str(rf.get("body")) not in ids:
            warnings.append("a force on a missing body was dropped")
            continue
        F = _vec2(rf.get("F"), "force.F", warnings, "vel")
        if not F:
            continue
        f: dict = {"body": str(rf["body"]), "F": F}
        off = _vec2(rf.get("offset"), "force.offset", warnings)
        if off:
            f["offset"] = off
        for k in ("from", "to"):
            v = _f(rf.get(k))
            if v is not None:
                f[k] = max(0.0, v)
        if rf.get("label"):
            f["label"] = str(rf["label"])[:24]
        forces.append(f)
    out["forces"] = forces
    ropes = []
    for rr in (s.get("ropes") or [])[:MAX_JOINTS]:
        if isinstance(rr, (list, tuple)) and len(rr) == 2:                  # engine format [id, [x, y]]
            rr = {"body": rr[0], "top": rr[1]}
        if not isinstance(rr, dict) or str(rr.get("body")) not in ids:
            continue
        top = _vec2(rr.get("top"), "rope.top", warnings)
        if top:
            ropes.append([str(rr["body"]), top])
    out["ropes"] = ropes
    frame = [v for v in (_vec2(p, "frame.point", warnings) for p in (s.get("frame") or [])[:8]) if v]   # drawing only: points the view must hold
    out["frame"] = frame
    out["frame_fit"] = min(1.5, max(0.5, _f(s.get("frame_fit"), 1.0)))   # scales how far the view backs off (1 = default)
    out["frame_motion"] = min(3.0, max(0.0, _f(s.get("frame_motion"), 2.0)))   # how far motion may widen the drawn box (x apparatus); 2 = default
    strings = []
    for rs in (s.get("strings") or [])[:MAX_JOINTS]:
        if not isinstance(rs, dict):
            continue
        via = []
        for v in (rs.get("via") or [])[:12]:
            if not isinstance(v, dict):
                continue
            if v.get("wrap"):
                if str(v["wrap"]) in ids:
                    via.append({"wrap": str(v["wrap"]), **({"ccw": bool(v["ccw"])} if v.get("ccw") is not None else {})})
                else:
                    warnings.append(f"string {rs.get('id')!r}: wraps unknown body {v['wrap']!r} — skipped")
            elif v.get("body"):
                if str(v["body"]) not in ids:
                    warnings.append(f"string {rs.get('id')!r}: tied to unknown body {v['body']!r} — skipped")
                    continue
                item: dict = {"body": str(v["body"])}
                loc = _vec2(v.get("local"), "string.local", warnings)
                if loc is None and isinstance(v.get("attach"), (list, tuple)):
                    # Saved engine-format scenes store explicit local anchors in
                    # attach; preserve them when validating a saved lesson again.
                    loc = _vec2(v["attach"], "string.attach", warnings)
                if loc:
                    item["attach"] = loc
                elif v.get("attach") in ("top", "bottom", "left", "right", "center"):
                    item["attach"] = v["attach"]
                via.append(item)
            elif v.get("world"):
                w = _vec2(v.get("world"), "string.world", warnings)
                if w:
                    via.append({"world": w})
        if len(via) < 2:
            continue
        strings.append({"id": str(rs.get("id") or f"string_{len(strings) + 1}")[:40], "via": via,
                        "tension": [str(x)[:40] for x in (rs.get("tension") or [])][:8],
                        "labels": [str(x)[:12] for x in (rs.get("labels") or [])][:8]})
    out["strings"] = strings
    pairs = lambda key: [[str(p[0]), str(p[1])] for p in (s.get(key) or []) if isinstance(p, (list, tuple)) and len(p) == 2 and str(p[0]) in ids and str(p[1]) in ids][:MAX_JOINTS]  # noqa: E731
    out["nocollide"] = pairs("nocollide")
    out["stick"] = pairs("stick")
    focus = str(s.get("focus") or "")
    dyn = [b["id"] for b in bodies if b.get("type") != "static"]
    if focus not in ids:
        if focus:
            warnings.append(f"focus {focus!r} is not a body — using {dyn[0] if dyn else bodies[0]['id'] if bodies else ''!r}")
        focus = dyn[0] if dyn else (bodies[0]["id"] if bodies else "")
    out["focus"] = focus
    out["camera"] = s.get("camera") if s.get("camera") in CAMERAS else None
    out["givens"] = [str(x)[:200] for x in (s.get("givens") or [])][:20]
    out["unknowns"] = [str(x)[:200] for x in (s.get("unknowns") or [])][:10]
    steps = []
    for st in (s.get("steps") or [])[:MAX_STEPS]:
        if not isinstance(st, dict):
            continue
        at = _f(st.get("at"))
        actions = []
        for ac in (st.get("actions") or [])[:12]:
            if not isinstance(ac, dict) or ac.get("type") not in ACTION_TYPES:
                continue
            a: dict = {"type": ac["type"]}
            for k in ("body", "force", "view", "integrand", "label", "units"):
                if isinstance(ac.get(k), str) and ac[k].strip():
                    a[k] = ac[k].strip()[:80]
            for k in ("t", "from", "to", "speed", "factor", "duration"):
                if _f(ac.get(k)) is not None:
                    a[k] = _f(ac.get(k))
            for k in ("along", "about"):
                v = ac.get(k)
                if isinstance(v, str) and v.strip():
                    a[k] = v.strip()[:40]
                elif isinstance(v, (list, tuple)) and len(v) >= 2 and _f(v[0]) is not None and _f(v[1]) is not None:
                    a[k] = [_f(v[0]), _f(v[1])]
            if isinstance(ac.get("points"), list):
                pts = [[_f(p[0]), _f(p[1])] for p in ac["points"] if isinstance(p, (list, tuple)) and len(p) >= 2 and _f(p[0]) is not None and _f(p[1]) is not None]
                if pts:
                    a["points"] = pts[:6]
            if isinstance(ac.get("at"), list):
                a["at"] = [max(0.0, min(out["duration"], _f(x))) for x in ac["at"] if _f(x) is not None][:6]
            for k in ("overlays", "items"):
                if isinstance(ac.get(k), list):
                    a[k] = [str(x)[:40] for x in ac[k] if isinstance(x, (str, int, float))][:8]
            if a["type"] in ("camera",) and a.get("view") not in CAMERAS:
                continue
            if a["type"] == "decompose" and a.get("integrand"):
                a.pop("integrand")
            actions.append(a)
        steps.append({"title": str(st.get("title") or "Step")[:120], "body": str(st.get("body") or "")[:4000],
                      "at": None if at is None else min(max(0.0, at), out["duration"]),
                      "show": [x for x in (st.get("show") or []) if x in STEP_SHOWS],
                      "camera": st.get("camera") if st.get("camera") in CAMERAS else None,
                      "highlight": [str(x)[:24] for x in (st.get("highlight") or [])][:6],
                      "actions": actions})
    if not steps:
        warnings.append("no steps returned — a single 'Setup' step was added")
        steps = [{"title": "Setup", "body": out["restatement"], "at": 0.0, "show": ["forces", "labels"], "camera": None, "highlight": [], "actions": []}]
    out["steps"] = steps
    checks = []
    for c in (s.get("checks") or [])[:MAX_CHECKS]:
        if not isinstance(c, dict) or c.get("quantity") not in CHECK_QUANTITIES:
            continue
        exp = _f(c.get("expect"))
        if exp is None:
            continue
        body, joint = str(c.get("body") or ""), str(c.get("joint") or "")
        if c["quantity"] == "joint_force":
            if joint not in jids:
                warnings.append(f"check {c.get('label')!r}: joint {joint!r} does not exist — dropped")
                continue
        elif body not in ids:
            warnings.append(f"check {c.get('label')!r}: body {body!r} does not exist — dropped")
            continue
        at = _f(c.get("at"))
        checks.append({"label": str(c.get("label") or c["quantity"])[:120], "quantity": c["quantity"], "body": body or None,
                       "joint": joint or None, "at": None if at is None else min(max(0.0, at), out["duration"]),
                       "expect": exp, "tol_pct": min(50.0, max(0.1, _f(c.get("tol_pct"), 3.0)))})
    out["checks"] = checks
    ans = s.get("answer") if isinstance(s.get("answer"), dict) else {}
    out["answer"] = {"label": str(ans.get("label") or "")[:120], "value": _f(ans.get("value")), "units": str(ans.get("units") or "")[:30],
                     "expression": str(ans.get("expression") or "")[:400], "note": str(ans.get("note") or "")[:400]}
    out["notes"] = str(s.get("notes") or "")[:2000]
    return out, warnings


# ── the prompt ─────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are Kinema's scene writer for an intro classical-mechanics course (Morin, Introduction to Classical
Mechanics, chapter 8: angular momentum with a fixed L direction - moments of inertia, torque, rolling, collisions,
angular impulse). You turn ONE problem into ONE scene for Kinema's rigid-body engine (planar, Box2D-class: bodies,
contacts with friction, joints, impulses, forces), plus a narrated walk-through and numbers the app will check
against its own simulation. Return ONE JSON object matching the schema you were given - nothing else.

The scene language (units: metres, kilograms, seconds, newtons; y is UP; angles counter-clockwise):
- bodies: circle (r), box (w along its own x, h along its own y), polygon (3-8 vertices counter-clockwise, relative to
  pos), edge (a ground line: 2 points relative to pos, turned by angle_deg). type static or dynamic; dynamic bodies need mass and an inertia (a number
  in kg m^2 or a word: solid_sphere, solid_cylinder, hoop, shell, rod, plate, point). angle_deg, vel, omega set the
  start. friction is a coefficient (0.5 default; use 30 when the problem says 'rolls without slipping'); restitution 0
  (default, sticks/no bounce) to 1 (elastic). bullet true for a small fast body. label is what the student sees.
  render_kind chooses the look: sphere or disk for circles, box or rod for boxes, slab for polygons, floor for edges.
- CONTACT FORCES ARE NOT WRITTEN: normal force and friction EMERGE from the shapes touching. Put the body exactly on
  the surface (a ball of radius r on a floor at y=0 has pos y = r; on a ramp, centre = contact point + r * normal).
- joints: pivot (hinge at anchor; a = 'world' for a fixed pivot), rod (fixed distance anchorA-anchorB), spring (k,
  rest), rope (max length), pulley (massless rope over two fixed ground points), slider (b moves along axis through
  anchor), weld, friction (a rubbing pad: maxTorque N m locks two spinning disks), gear (coordinateA + ratio *
  coordinateB = constant between joint1 on body a and joint2 on body b: the way a string that does not slip couples a
  hanging mass on a vertical slider to a MASSIVE pulley on a pivot, ratio = +R for one side and -R for the other; see
  the Atwood example). A massless pulley is a 'pulley' joint.
- STRINGS are drawn objects the student can click: "strings": [{"id":"string","via":[{"body":"m1","attach":"top"},
  {"wrap":"pulley","ccw":false},{"body":"m2","attach":"top"}],"tension":["string1","string2"],"labels":["T1","T2"]}]
  - the path in order (a body attach point, a pulley it wraps, a fixed world point), and per straight segment the
  joint (or applied-force label) whose force is that segment's tension. Every string in the problem gets one.
  Unused waypoint fields are null.
- impulses: an instantaneous blow J at a point at time t (a cue hits a ball). forces: a constant applied force F at an
  offset from the centre between times from/to (a string pulled with tension T). nocollide: pairs that pass through
  each other (two masses beside a pulley). stick: pairs that become one body at first contact (putty hits a rod, a
  ball that sticks to a stick - a perfectly inelastic collision; give them restitution 0 too). focus: the body whose
  free-body diagram is shown and whose motion the camera
  follows. topdown true with gravity 0 for a frictionless table seen from above. duration: seconds, just past the
  interesting motion (a rod falling: about 2 s; a ball rolling 4 m down a ramp: its fall time + 0.5 s).
- steps: 4-10 short teaching steps (setup, what to conserve / which torque, the free-body diagram, the key equations,
  solving, the answer with a sanity check). body is markdown with LaTeX ($..$ inline, $$..$$ display). at = the
  time to pause at (null for static steps). show picks overlays: forces, velocity, labels, all_forces, trail,
  tensions. camera: hero, follow, side, top, closeup. highlight names force labels to glow.
- ACTIONS: every step DIRECTS the stage with a short list of actions the app executes in order (the app draws,
  you only name things). Use them generously - they are what makes the lesson visual:
  * cameras: "hero" (three-quarter, shows depth) for the setup, the motion and the answer; "side" only for a
    free-body or trigonometry step where a flat projection helps; "follow" for a body that travels; "top" for
    table-top (topdown) scenes; "closeup" frames the focus body larger and moves with it, so the rest of the
    apparatus may be off screen on purpose (say so; return to "hero" to show the whole setup).
  * the free-body step: [{"type":"focus","body":"ball"}, {"type":"camera","view":"side"}, {"type":"pause_at","t":0.4},
    {"type":"show","overlays":["forces","labels"]}]
  * the trig step: {"type":"decompose","force":"mg","along":"surface"} splits the weight into mg sin(theta) along the
    slope and mg cos(theta) into it, with dotted projections and the angle arc - the cosine/sine picture.
  * an integral step for a non-uniform rod: {"type":"sweep_integral","body":"stick","integrand":"lambda","from":-0.5,
    "to":0.5,"duration":5,"label":"M","units":"kg"} sweeps a slice from one end to the other while the running
    integral is shown; use "x^2*lambda" with units "kg m^2" for a moment of inertia about the centre.
  * a torque step: {"type":"torque","force":"mg","about":"pivot"} draws the lever arm and r x F.
  * motion: {"type":"play","from":0,"to":1.2,"speed":0.3} plays that stretch slowly; {"type":"ghost","body":"ball",
    "at":[0,0.5,1.0]} leaves translucent copies; {"type":"zoom","body":"ball","factor":3}; {"type":"angle","points":
    [[vertex],[p1],[p2]],"label":"theta"}; {"type":"dimension","points":[[p1],[p2]],"label":"L = 4 m"}.
  Unused fields of an action are null.
- checks: 2-6 numbers the app measures in its simulation and compares with yours (the honesty gate): speed, omega,
  vx, vy, x, y, angle_deg, ax, ay, ke of a body, normal or friction magnitude on a body, joint_force of a joint - at
  a time (or null = the end). Compute them carefully from the physics; include the one the problem asks for.
- answer: the single number the problem asks for, with its units, the symbolic expression in LaTeX and a note.
- Symbols-only problems (m, R, theta): choose sensible SI values (a 1 kg, 0.2 m ball; a 1 m rod; 30 degrees), say so
  in restatement, and give the answer symbolically AND numerically for those values.
- NON-UNIFORM rods ("mass per unit length lambda(x) = ..."): give the box a "lambda" expression in x (metres from
  the centre along its length) and l (its length) with your chosen numbers, e.g. l = 1 m, m0 = 1 kg:
  "lambda": "1*(1-2*x/l)^3". The engine integrates it for the mass, the centre of mass and the inertia; the
  body's mass/inertia fields are then ignored. A problem that only asks for a mass or a moment of inertia still
  gets a scene: the body at rest or spinning as described (topdown true, gravity 0, a pivot at the axis, omega),
  duration about 2 s, and its answer as a "mass" or "inertia" check on that body (inertia = about its centre of
  mass; for the inertia about another axis use the parallel-axis theorem in the steps).
- Sizes: a real-looking scene - a ball is 0.1-0.4 m, a rod 1-2 m, a ramp 3-6 m long. Give every body a short id.

Worked examples of scenes (the engine already ran these and matched the closed-form answers to about 1 %):
"""


def examples_text(keys: list[str] | None = None) -> str:
    try:
        ex = json.loads(EXAMPLES_PATH.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return "(no examples available)"
    parts = []
    for k, e in ex.items():
        if keys and k not in keys:
            continue
        spec = copy.deepcopy(e["spec"])
        for b in spec.get("bodies", []):                      # show the model the format it must write
            if "angle" in b:
                b["angle_deg"] = round(math.degrees(b.pop("angle")), 4)
            r = b.pop("render", None) or {}
            if r.get("kind"):
                b["render_kind"] = r["kind"]
            if r.get("inner") is not None:
                b["render_inner"] = r["inner"]
            if r.get("z") is not None:
                b["render_z"] = r["z"]
        spec["ropes"] = [{"body": rr[0], "top": rr[1]} for rr in spec.get("ropes", [])]
        for st in spec.get("strings", []):
            for v in st.get("via", []):
                if isinstance(v.get("attach"), list):
                    v["local"] = v.pop("attach")
        spec.pop("facts", None)
        parts.append(f"### {e['title']} ({e['note']})\n" + json.dumps(spec, separators=(",", ":")))
    return "\n\n".join(parts)


def build_prompt(problem_text: str, has_image: bool) -> str:
    from .registry import ascii_safe
    head = SYSTEM_PROMPT + examples_text()
    body = "\n\nPROBLEM:\n" + (problem_text.strip() or "(see the attached photo of the problem)")
    if has_image:
        body += "\n\n(A photo of the problem is attached; read it carefully, it is the source of truth.)"
    body += "\n\nReturn the JSON object now."
    return ascii_safe(head + body)
