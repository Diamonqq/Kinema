"""3D rigid-body models (Morin ch. 9 and any rotation that is not planar).

The model writes the SETUP: a body built from primitive parts, and one motion. The browser engine
(static/js/rigid3d.js) computes everything physical itself — mass, centre of mass, the inertia tensor and
principal axes, the motion (analytic for fixed-axis and steady precession, Euler's equations integrated for
tops and free bodies), angular velocity, angular momentum, the torque the motion requires, the torque
gravity and the support supply, contact-point velocity — and measures the model's predictions against it.
This module only checks that the setup is well formed and renderable; it computes no physics.
"""
from __future__ import annotations

import math
import re

SHAPES = ["sphere", "shell", "cylinder", "tube", "disk", "ring", "rod", "box", "cone", "point"]
COLORS = ["blue", "sand", "teal", "rose", "steel", "clay"]
MOTIONS = ["fixed_axis", "steady_precession", "heavy_top", "free", "static"]
SUPPORTS = ["pivot", "ground", "none"]
OVERLAYS = ["omega", "L", "torque", "weight", "contact", "axis", "vertical", "trace", "trace_contact", "trace_omega",
            "principal_axes", "cm_velocity", "references", "gravity_torque", "labels", "world_axes", "body_axes",
            "precession", "half_angle"]
# Presentation-only prop art a part may be drawn as (static/js/prop_library.js); it never changes mass, inertia or contact.
PART_PROPS = {"disk": ["wheel", "pulley", "spool", "gyroscope", "turntable"],
              "cylinder": ["wheel", "pulley", "spool", "gyroscope", "turntable"],
              "cone": ["top"], "sphere": ["planet", "projectile"], "box": ["block", "beam", "ladder", "cart"]}
REFERENCE_KINDS = ["axis", "origin", "coordinate", "slice", "distance"]
QUANTITIES = ["mass", "I1", "I2", "I3", "I_sym", "I_perp", "I_pivot_sym", "I_pivot_perp", "cm_distance",
              "omega_mag", "omega_z", "omega_sym", "L_mag", "L_z", "L_sym", "L_perp", "angle_L_omega_deg",
              "torque_mag", "gravity_torque_mag", "torque_residual", "contact_speed", "normal_force", "friction_force",
              "ke", "cm_speed", "precession_rate", "spin_rate", "theta_deg", "theta_min_deg", "theta_max_deg"]

N = {"type": "number"}
NN = {"type": ["number", "null"]}
S = {"type": "string"}
VEC = {"type": "array", "items": {"type": "number"}}
NVEC = {"type": ["array", "null"], "items": {"type": "number"}}


def _obj(props: dict) -> dict:
    return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}


PART = _obj({"id": S, "shape": {"type": "string", "enum": SHAPES}, "mass": N, "center": VEC, "axis": NVEC,
             "radius": NN, "length": NN, "size": NVEC, "color": {"type": "string", "enum": COLORS},
             "prop": {"type": ["string", "null"], "enum": sorted({x for v in PART_PROPS.values() for x in v}) + [None]}})
IMPULSE = _obj({"point": VEC, "J": VEC})
MOTION = _obj({
    "type": {"type": "string", "enum": MOTIONS},
    "pivot": NVEC, "pivot_world": VEC, "support": {"type": "string", "enum": SUPPORTS},
    "theta_deg": N, "phi_deg": N, "precession_rate": NN, "spin_rate": NN, "nutation_rate": NN,
    "axis": NVEC, "omega": NN, "impulse": {**IMPULSE, "type": ["object", "null"]},
})
REFERENCE = _obj({"kind": {"type": "string", "enum": REFERENCE_KINDS}, "label": S, "point": VEC, "direction": NVEC,
                  "frame": {"type": "string", "enum": ["body", "world"]}, "length": NN})
CHECK = _obj({"label": S, "quantity": {"type": "string", "enum": QUANTITIES}, "at": NN, "expect": N, "tol_pct": N})
RIGID3D_SCHEMA = _obj({
    "gravity": N, "duration": N, "ground": {"type": "boolean"},
    "body": _obj({"label": S, "parts": {"type": "array", "items": PART}, "symmetry_axis": VEC}),
    "motion": MOTION,
    "show": {"type": "array", "items": {"type": "string", "enum": OVERLAYS}},
    "references": {"type": ["array", "null"], "items": REFERENCE},
    "checks": {"type": "array", "items": CHECK},
})

PROMPT = r"""rigid3d SPEC (z is up; gravity points along -z; SI units; angles in degrees; rates in rad/s):
- body.parts (1-12): {id, shape, mass, center [x,y,z], axis [x,y,z] or null, radius, length, size, color, prop} in ONE
  body frame you choose (put the origin somewhere natural: the CM, the pivot, the contact point). Shapes:
  sphere (solid; radius), shell (thin spherical shell; radius), cylinder (solid; radius, length along axis),
  tube (thin-walled cylinder; radius, length), disk (thin; radius; axis = its normal), ring (thin hoop; radius;
  axis = normal), rod (thin; length along axis), box (size [a,b,c] along the body x,y,z; axis null), cone (solid;
  radius of the base, length = height; center = centre of the BASE, apex at center + length*axis), point (point
  mass). Unused fields are null. prop (optional art, else null; drawing only, never mass, size or contact):
  disk/cylinder wheel|pulley|spool|gyroscope|turntable, cone top, sphere planet|projectile, box block|beam|ladder|cart.
  The app computes the CM, the inertia tensor and the principal axes itself.
- body.symmetry_axis: body-frame direction of the axis e3 used for tilt, spin and display (the symmetry axis
  of a top/coin/wheel, the line through fused spheres, a rod's length).
- motion.type:
  fixed_axis: the body turns at constant omega (rad/s) about the WORLD direction motion.axis through the
    fixed point; theta_deg/phi_deg give e3's initial direction (e.g. a tilted rod on a vertical axle).
  steady_precession: e3 keeps angle theta_deg from +z and circles +z at precession_rate (dphi/dt), while the
    body spins at spin_rate (dpsi/dt) about e3 relative to the precessing frame; angular velocity =
    precession_rate*z + spin_rate*e3. Tops, gyroscopes, hurricane balls, rolling cones/coins/wheels in circles.
    Careful: Morin's omega_3 (the component of omega along e3) = spin_rate + precession_rate*cos(theta); when a
    problem gives omega_3, convert it to spin_rate.
  heavy_top: Euler's equations are integrated from theta_deg, phi_deg and the initial rates (precession_rate,
    nutation_rate, spin_rate) with gravity about the fixed pivot: precession, nutation, sleeping, falling tops.
  free: torque-free motion about the CM (gravity only moves the CM): free tops, wobbling plates, the tennis
    racket theorem. Initial rates as above, or impulse {point (body frame), J (world, N s)} applied at t=0.
  static: no motion (inertia tensor / principal axes questions). duration may be 0.
- motion.pivot: the body-frame point that stays fixed in space (a top's tip, the CM of hurricane balls, the
  apex of a rolling cone, the point where a coin's axis meets the vertical axis); null = the CM.
  motion.pivot_world: where that point is in the world. A body touching the floor must actually touch z=0
  (ground=true): place it so its lowest point is at z=0 given theta_deg.
- motion.support: pivot (the fixed point is a physical support: tip, hinge, bearing), ground (the lowest point
  rolls on the floor and the CM is not held), none (free). A rolling cone or lollipop has two supports (the fixed
  apex/end and the floor): use pivot; the app then shows the required torque but does not judge the balance. The app computes the force and torque that support
  must supply and whether the motion is consistent with Newton and dL/dt = torque (check torque_residual).
- phi_deg is the azimuth of e3's horizontal direction measured from +x toward +y.
- show: default overlays: omega, L, torque, weight, contact, axis, vertical, trace (e3 tip path), trace_contact,
  trace_omega, principal_axes, cm_velocity, labels, world_axes (the problem's fixed x/y/z at the pivot, or at the starting
  CM when there is no pivot), body_axes (body-frame x/y/z = e1/e2/e3 turning with the body, same origin; NOT necessarily
  principal axes, which are the separate principal_axes layer), gravity_torque (the cross product for gravity alone about the
  pivot: r from pivot to CM, F = Mg at the CM, tau = r x F from the pivot, their plane and the turning sense; it is
  not the net torque, which the 'torque' layer draws as dL/dt). Show only what the step explains.
- references (optional teaching geometry, shown by the 'references' overlay; null when not needed): {kind, label,
  point (body frame), direction, frame ('body' = turns with the body, 'world' = fixed in space), length}. The body
  is turned by theta_deg/phi_deg (with symmetry_axis z and theta = phi = 0, body +x lies along world +y), so axes
  and coordinates in the problem's own body coordinates (x toward a mass) use frame body. kind axis: the
  axis a question is about (e.g. a pin through a rod's end: point = that end, direction perpendicular to the rod,
  frame world); it is drawn in addition to e3, never instead of it. origin: a labelled point (x = 0). coordinate:
  an arrow from point along direction (length) naming a coordinate such as x. slice: a thin slab dm at point with
  normal direction and thickness length. distance: from point perpendicular to the first axis reference; the app
  measures and labels the distance itself. Unused fields are null.
- checks: your numbers the app measures in its model. quantity: mass, I1<=I2<=I3 (principal moments about the
  CM), I_sym / I_perp (about e3 / a perpendicular axis through the CM), I_pivot_sym / I_pivot_perp (about the
  pivot), cm_distance (pivot to CM), omega_mag, omega_z, omega_sym (omega along e3), L_mag, L_z, L_sym, L_perp
  (angular momentum about the pivot; I_perp and I_pivot_perp only for bodies symmetric about e3), angle_L_omega_deg, torque_mag (|dL/dt| required), gravity_torque_mag,
  torque_residual (should be 0 when your rates are dynamically right), contact_speed (0 when rolling without
  slipping), normal_force, friction_force, ke, cm_speed, precession_rate and spin_rate (measured), theta_deg,
  theta_min_deg / theta_max_deg (nutation range). at = time in seconds or null (end). tol_pct <= 3. For a vertical
  axis (theta 0, a sleeping top) precession and spin rates are undefined: check omega_sym instead.
- In the model the colours are fixed: omega violet, L blue, torque dL/dt magenta (drawn from the tip of L),
  weight red, normal force green, friction orange, CM velocity slate; e3 and the vertical are dashed lines. Refer to
  arrows by these colours in step text, never by other colours.
- Symbolic problems: choose illustrative values (e.g. R = 0.1 m, m = 1 kg, Omega from your formula), state them
  in assumptions and the caption, and make the checks test your formula with those values.
"""

LIMITS = {"gravity": (0.0, 100.0), "duration": (0.0, 60.0), "mass": (1e-6, 1e6), "length": (1e-4, 1e3),
          "coord": (-1e3, 1e3), "rate": (-5000.0, 5000.0)}


class Rigid3DError(ValueError):
    pass


def _vec(value, name: str, *, nonzero: bool = False) -> list[float]:
    if not isinstance(value, list) or len(value) != 3 or any(isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x) for x in value):
        raise Rigid3DError(f"{name}: expected three finite numbers")
    if any(abs(x) > LIMITS["coord"][1] for x in value):
        raise Rigid3DError(f"{name}: coordinates must be within 1000 m")
    if nonzero and math.hypot(*value) < 1e-9:
        raise Rigid3DError(f"{name}: direction must not be zero")
    return [float(x) for x in value]


def _num(value, name: str, lo: float, hi: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise Rigid3DError(f"{name}: expected a finite number")
    if not lo <= value <= hi:
        raise Rigid3DError(f"{name}: {value:g} is outside {lo:g}..{hi:g}")
    return float(value)


REQUIRED = {"sphere": ("radius",), "shell": ("radius",), "cylinder": ("radius", "length"), "tube": ("radius", "length"),
            "disk": ("radius",), "ring": ("radius",), "rod": ("length",), "box": ("size",), "cone": ("radius", "length"),
            "point": ()}
AXIAL = {"cylinder", "tube", "disk", "ring", "rod", "cone"}


def validate(spec: dict) -> tuple[dict, list[str]]:
    """Check a rigid3d setup. Never changes physics: anything out of contract raises Rigid3DError."""
    warnings: list[str] = []
    if not isinstance(spec, dict):
        raise Rigid3DError("rigid3d: expected an object")
    gravity = _num(spec.get("gravity"), "gravity", *LIMITS["gravity"])
    duration = _num(spec.get("duration"), "duration", *LIMITS["duration"])
    body = spec.get("body") or {}
    parts = body.get("parts")
    if not isinstance(parts, list) or not 1 <= len(parts) <= 12:
        raise Rigid3DError("body.parts: 1 to 12 parts are required")
    ids = set()
    total = 0.0
    for i, part in enumerate(parts):
        name = f"part {part.get('id') or i}"
        pid = part.get("id")
        if not isinstance(pid, str) or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,39}", pid) or pid in ids:
            raise Rigid3DError(f"{name}: invalid or duplicate id")
        ids.add(pid)
        shape = part.get("shape")
        if shape not in SHAPES:
            raise Rigid3DError(f"{name}: unknown shape {shape!r}")
        total += _num(part.get("mass"), f"{name}.mass", *LIMITS["mass"])
        _vec(part.get("center"), f"{name}.center")
        for key in REQUIRED[shape]:
            if key == "size":
                size = part.get("size")
                if not isinstance(size, list) or len(size) != 3:
                    raise Rigid3DError(f"{name}: box needs size [a,b,c]")
                for k, v in enumerate(size):
                    _num(v, f"{name}.size[{k}]", *LIMITS["length"])
            else:
                _num(part.get(key), f"{name}.{key}", *LIMITS["length"])
        if shape in AXIAL:
            if part.get("axis") is None:
                raise Rigid3DError(f"{name}: a {shape} needs its axis direction")
            _vec(part.get("axis"), f"{name}.axis", nonzero=True)
        elif part.get("axis") is not None:
            _vec(part.get("axis"), f"{name}.axis", nonzero=True)
        prop = part.get("prop")
        if prop is not None and prop not in PART_PROPS.get(shape, []):
            raise Rigid3DError(f"{name}: prop {prop!r} is not drawn for a {shape}"
                               + (f" (allowed: {', '.join(PART_PROPS[shape])})" if shape in PART_PROPS else " (no prop art for this shape)"))
    _vec(body.get("symmetry_axis"), "body.symmetry_axis", nonzero=True)
    motion = spec.get("motion") or {}
    mtype = motion.get("type")
    if mtype not in MOTIONS:
        raise Rigid3DError(f"motion.type: unknown {mtype!r}")
    if motion.get("support") not in SUPPORTS:
        raise Rigid3DError("motion.support: pivot, ground or none")
    if motion.get("pivot") is not None:
        _vec(motion.get("pivot"), "motion.pivot")
    _vec(motion.get("pivot_world"), "motion.pivot_world")
    _num(motion.get("theta_deg"), "motion.theta_deg", 0.0, 180.0)
    _num(motion.get("phi_deg"), "motion.phi_deg", -720.0, 720.0)
    for key in ("precession_rate", "spin_rate", "nutation_rate", "omega"):
        if motion.get(key) is not None:
            _num(motion.get(key), f"motion.{key}", *LIMITS["rate"])
    if mtype == "fixed_axis":
        if motion.get("axis") is None or motion.get("omega") is None:
            raise Rigid3DError("fixed_axis needs motion.axis and motion.omega")
        _vec(motion.get("axis"), "motion.axis", nonzero=True)
    if mtype == "steady_precession" and (motion.get("precession_rate") is None or motion.get("spin_rate") is None):
        raise Rigid3DError("steady_precession needs precession_rate and spin_rate")
    if mtype == "heavy_top":
        if motion.get("pivot") is None:
            raise Rigid3DError("heavy_top needs a body-frame pivot (the fixed tip)")
        if gravity <= 0:
            warnings.append("heavy_top with zero gravity is a free top about a fixed point.")
    imp = motion.get("impulse")
    if imp is not None:
        if mtype != "free":
            raise Rigid3DError("an impulse is only supported for free motion")
        _vec(imp.get("point"), "impulse.point")
        _vec(imp.get("J"), "impulse.J")
    if mtype != "static" and duration < 0.2:
        raise Rigid3DError("duration: moving scenes need at least 0.2 s")
    if motion.get("support") == "ground" and not spec.get("ground"):
        warnings.append("support is 'ground' but the floor is not drawn; it is drawn anyway.")
    for key in ("show",):
        for item in spec.get(key) or []:
            if item not in OVERLAYS:
                raise Rigid3DError(f"show: unknown overlay {item!r}")
    refs = spec.get("references") or []
    if not isinstance(refs, list) or len(refs) > 8:
        raise Rigid3DError("references: at most 8")
    for i, ref in enumerate(refs):
        name = f"references[{i}]"
        if not isinstance(ref, dict) or ref.get("kind") not in REFERENCE_KINDS:
            raise Rigid3DError(f"{name}: kind must be one of {', '.join(REFERENCE_KINDS)}")
        if not isinstance(ref.get("label"), str) or len(ref["label"]) > 40:
            raise Rigid3DError(f"{name}: label must be text of at most 40 characters")
        _vec(ref.get("point"), f"{name}.point")
        if ref["kind"] in ("axis", "coordinate", "slice"):
            _vec(ref.get("direction"), f"{name}.direction", nonzero=True)
        elif ref.get("direction") is not None:
            _vec(ref.get("direction"), f"{name}.direction", nonzero=True)
        if ref.get("frame", "body") not in ("body", "world"):
            raise Rigid3DError(f"{name}: frame is body or world")
        if ref.get("length") is not None:
            _num(ref.get("length"), f"{name}.length", *LIMITS["length"])
    if any(r.get("kind") == "distance" for r in refs) and not any(r.get("kind") == "axis" for r in refs):
        raise Rigid3DError("references: a distance is measured to an axis reference; add the axis")
    checks = spec.get("checks") or []
    if len(checks) > 12:
        raise Rigid3DError("checks: at most 12")
    for i, c in enumerate(checks):
        if c.get("quantity") not in QUANTITIES:
            raise Rigid3DError(f"checks[{i}]: unknown quantity")
        _num(c.get("expect"), f"checks[{i}].expect", -1e12, 1e12)
        if c.get("at") is not None:
            _num(c.get("at"), f"checks[{i}].at", 0.0, duration)
    return spec, warnings


def hurricane_omega(R: float, phi_deg: float, g: float = 9.8) -> float:
    """Steady hurricane balls (CM at rest, lower sphere rolling): Omega^2 = 10 g / (R (4 - 10 sin phi)).

    omega = Omega (z + e3) from rolling; L about the CM = I_perp Omega cos(phi) e1 + I_sym Omega (1 + sin phi) e3
    with I_sym = 4/5 m R^2, I_perp = 14/5 m R^2; dL/dt = Omega z x L must equal the torque of N = 2 m g at the
    contact point. Only phi < asin(0.4) = 23.6 degrees is possible.
    """
    s = math.sin(math.radians(phi_deg))
    if 4 - 10 * s <= 0:
        raise ValueError("no steady motion for phi >= asin(2/5)")
    return math.sqrt(10 * g / (R * (4 - 10 * s)))


def example_hurricane() -> dict:
    """Hurricane balls, the owner's 2026-09-18 homework: R = 3 cm, m = 50 g each, axis 15 deg above horizontal."""
    R, m, phi = 0.03, 0.05, 15.0
    rate = hurricane_omega(R, phi)
    return {"gravity": 9.8, "duration": 4.0, "ground": True,
            "body": {"label": "hurricane balls", "symmetry_axis": [0, 0, 1], "parts": [
                {"id": "upper", "shape": "sphere", "mass": m, "center": [0, 0, R], "axis": None, "radius": R, "length": None, "size": None, "color": "blue"},
                {"id": "lower", "shape": "sphere", "mass": m, "center": [0, 0, -R], "axis": None, "radius": R, "length": None, "size": None, "color": "sand"}]},
            "motion": {"type": "steady_precession", "pivot": [0, 0, 0], "pivot_world": [0, 0, R * (1 + math.sin(math.radians(phi)))],
                       "support": "ground", "theta_deg": 90 - phi, "phi_deg": 0, "precession_rate": rate, "spin_rate": rate,
                       "nutation_rate": 0, "axis": None, "omega": None, "impulse": None},
            "show": ["omega", "L", "torque", "contact", "axis", "vertical", "trace_contact", "labels"],
            "checks": [{"label": "contact point speed (rolling)", "quantity": "contact_speed", "at": 1.0, "expect": 0, "tol_pct": 3},
                       {"label": "|omega| = Omega sqrt(2 + 2 sin phi)", "quantity": "omega_mag", "at": 1.0,
                        "expect": rate * math.sqrt(2 + 2 * math.sin(math.radians(phi))), "tol_pct": 1},
                       {"label": "normal force = 2mg", "quantity": "normal_force", "at": 1.0, "expect": 2 * m * 9.8, "tol_pct": 2},
                       {"label": "dL/dt matches the torque of N", "quantity": "torque_residual", "at": 1.0, "expect": 0, "tol_pct": 3}]}
