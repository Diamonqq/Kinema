"""Parameterised visuals for the guided 2301 method ladder (app/content/study_guides/2301.json).

VISUALS[id] declares each view: title, kind, summary, parameters {name: spec} and the names a slider or the teacher
may change live (editable). A number spec is {type: "number", label, symbol, unit, min, max, step, default}; a choice
spec is {type: "choice", label, options: [{value, label}], default}.

build_visual(id, parameters) returns a fresh lesson in the existing tutor format, already passed through
tutor.validate: precise equal-scale diagrams (trig, cross products, principal axes, rolling coin, frames) drawn from
the stated geometry, or a planar simulation the app's engine runs. Givens and answers are recomputed for the exact
parameters; a value outside its declared range raises InvalidParameters instead of being clamped. Library setups are
reused by id through visual_library. Nothing here calls a provider.
"""
from __future__ import annotations

import copy
import functools
import json
import math
import re

from . import tutor, visual_library

G = 9.8
S = tutor._step


class UnknownVisual(KeyError):
    pass


class InvalidParameters(ValueError):
    pass


def _num(label, symbol, unit, lo, hi, step, default):
    return {"type": "number", "label": label, "symbol": symbol, "unit": unit, "min": lo, "max": hi, "step": step, "default": default}


def _choice(label, options, default):
    return {"type": "choice", "label": label, "options": [{"value": v, "label": t} for v, t in options], "default": default}


THETA = _num("angle θ", r"\theta", "deg", 10, 80, 5, 30)
SHAPES_2D = [("rod", "uniform rod"), ("disk", "uniform disk")]
SHAPES_3D = [("disk", "uniform disk (I₃ = ½mr²)"), ("ring", "ring (I₃ = mr²)"), ("rod", "thin rod along x̂₃")]
ROLLERS = [("solid_sphere", "solid ball (2/5 mr²)"), ("solid_cylinder", "solid cylinder (1/2 mr²)"), ("hoop", "hoop (mr²)")]
BETA = {"solid_sphere": 0.4, "solid_cylinder": 0.5, "hoop": 1.0}
POINTS = [("bottom", "contact point (bottom)"), ("top", "top of the wheel"), ("right", "front edge")]
FORCES = [("-x", "along −x̂"), ("+x", "along +x̂"), ("+y", "along +ŷ"), ("-y", "along −ŷ")]

VISUALS: dict[str, dict] = {
    "trig_components": {
        "title": "Splitting a vector into components", "kind": "diagram",
        "summary": "A vector F at angle θ from a stated reference axis, its x and y components, the right angle and which side is cos/sin.",
        "parameters": {"theta": THETA, "reference": _choice("θ measured from", [("horizontal", "the horizontal (+x)"), ("vertical", "the vertical (+y)")], "horizontal")},
        "editable": ["theta", "reference"]},
    "incline_gravity": {
        "title": "Gravity on a slope", "kind": "diagram",
        "summary": "mg on a block on a slope split along and into the slope; the angle between mg and the normal equals the slope angle.",
        "parameters": {"theta": THETA, "reference": _choice("slope angle measured from", [("base", "the horizontal ground"), ("wall", "the vertical wall")], "base")},
        "editable": ["theta", "reference"]},
    "rod_axis": {
        "title": "Moment of inertia about a shifted axis", "kind": "diagram",
        "summary": "A rod or disk, its centre of mass and a parallel axis at distance d; I = I_cm + Md².",
        "parameters": {"shape": _choice("body", SHAPES_2D, "rod"),
                       "d_frac": _num("axis position (0 = centre, 1 = end of the rod or rim of the disk)", "d", "", 0, 1, 0.05, 1)},
        "editable": ["shape", "d_frac"]},
    "beam_release": {
        "title": "Beam: one support removed", "kind": "diagram",
        "summary": "A uniform beam on two supports at distance a from each end; the right support is removed and the beam pivots on the left one.",
        "parameters": {"a_frac": _num("support distance a from each end (fraction of L)", "a", "", 0, 0.4, 0.05, 0)},
        "editable": ["a_frac"]},
    "rolling_shapes": {
        "title": "Rolling down a slope", "kind": "mechanics",
        "summary": "A round body rolling without slipping down a fixed 30° slope; its shape sets I = βmr² and so the acceleration.",
        "parameters": {"shape": _choice("body", ROLLERS, "solid_sphere")},
        "editable": ["shape"]},
    "contact_torque": {
        "title": "Torque r × F with unit vectors", "kind": "diagram",
        "summary": "A wheel of radius R, a force applied at a chosen point and direction, the lever arm r from the centre and τ = r × F along ±ẑ.",
        "parameters": {"point": _choice("force applied at", POINTS, "bottom"), "force": _choice("force direction", FORCES, "-x")},
        "editable": ["point", "force"]},
    "tilted_body_L": {
        "title": "ω and L of a tilted symmetric body", "kind": "diagram",
        "summary": "Side view: the symmetry axis x̂₃ tilted θ from the vertical ω; ω split along the principal axes and L = I₂ω₂x̂₂ + I₃ω₃x̂₃.",
        "parameters": {"theta": _num("tilt θ of x̂₃ from the vertical", r"\theta", "deg", 10, 80, 5, 30),
                       "shape": _choice("body", SHAPES_3D, "disk"),
                       "mode": _choice("show", [("L", "ω components and L"), ("dLdt", "L, its horizontal part and dL/dt")], "L")},
        "editable": ["theta", "shape", "mode"]},
    "rolling_coin": {
        "title": "Coin rolling in a circle", "kind": "diagram",
        "summary": "Side view at one instant (Morin 9.23): coin tilted θ from the ground, contact point on a circle of radius R, principal axes, ω, L and the contact forces.",
        "parameters": {"theta": _num("coin angle θ with the ground", r"\theta", "deg", 20, 80, 5, 60),
                       "R_over_r": _num("contact-circle radius R / coin radius r", "R/r", "", 0.5, 6, 0.25, 3),
                       "motion": _choice("motion", [("circle", "rolls round a circle of radius R"), ("wobble", "wobbles in place (CM fixed, R = r cos θ)")], "circle"),
                       "shape": _choice("body", [("coin", "uniform coin (β = ½)"), ("ring", "ring (β = 1)")], "coin")},
        "editable": ["theta", "R_over_r", "motion", "shape"]},
    "tensor_rotation": {
        "title": "Body axes and fixed lab axes", "kind": "diagram", "summary": "x-z view of an active body rotation about +y. Lab axes stay fixed; body e1 and e3 rotate. No matrix entries or answers are drawn.",
        "parameters": {"theta": _num("active angle about +y", "θ", "deg", -75,75,5,45)}, "editable": ["theta"]},
    "sphere_capture": {
        "title": "Two masses stick to a spinning sphere", "kind": "diagram", "summary": "Side view of Morin 9.37. The pair axis is tilted from vertical; L remains vertical in the collision. θ is illustrated at 45 degrees; the problem remains symbolic.",
        "parameters": {"view": _choice("show", [("before","before capture"),("after","new principal axes")],"before")},"editable":["view"]},
    "free_top_axes": {
        "title": "Free-top axis around fixed L", "kind": "diagram", "summary": "Schematic meridian of the body-axis cone around fixed angular momentum. It is geometry, not a simulated trajectory. The angle is illustrative.",
        "parameters": {},"editable":[]},
    "heavy_top_horizontal": {
        "title": "A top hangs below its pivot", "kind": "diagram", "summary": "Morin 9.52 geometry: symmetry axis from pivot down to CM, θ from downward vertical, and total angular velocity horizontal. Lengths and angle are illustrative.",
        "parameters": {},"editable":[]},
    "massive_pulley": {
        "title": "A pulley has rotational inertia", "kind": "diagram", "summary": "Two hanging masses and distinct string tensions around a massive pulley. Symbolic F=ma and torque setup, not a numerical simulation.",
        "parameters": {},"editable":[]},
    "sliding_coin": {
        "title": "A translating coin with counterspin", "kind": "diagram", "summary": "Coin moves right with counterclockwise spin; the bottom slips right and kinetic friction acts left. Direction diagram for simultaneous stopping.",
        "parameters": {},"editable":[]},
    "corner_cube": {
        "title": "Cube: origin at a corner", "kind": "diagram", "summary": "Oblique projection of a cube from a corner; all three coordinates run from zero to ell. Body diagonal shown as a candidate principal direction. It is a projection, not a 2D distance calculation.",
        "parameters": {},"editable":[]},
    "tensor_point": {
        "title": "A mass away from the spin axis", "kind": "diagram",
        "summary": "Symbolic snapshot in the x-z plane: point mass at (a,0,b), +y into the page, spin about +z; geometry, spin, or angular momentum.",
        "parameters": {"view": _choice("show", [("geometry", "position"), ("spin", "spin and velocity"), ("momentum", "angular momentum")], "geometry")},
        "editable": ["view"]},
    "coriolis_direction": {
        "title": "Coriolis direction, one cross product", "kind": "diagram",
        "summary": "Top view: x right, y up page, z out of page. Separate relative motion, Omega cross v, and the reversed Coriolis-force direction. Arrows give directions, not a trajectory.",
        "parameters": {"view": _choice("show", [("motion", "spin axis and velocity"), ("cross", "Omega cross v"), ("force", "Coriolis force")], "motion"),
                       "sense": _choice("spin", [("ccw", "counterclockwise"), ("cw", "clockwise")], "ccw"),
                       "travel": _choice("relative motion", [("out", "outward"), ("in", "inward")], "out")},
        "editable": ["view", "sense", "travel"]},
    "azimuthal_direction": {
        "title": "A spinning frame speeds up", "kind": "diagram",
        "summary": "Top view: angular acceleration points out of the page; at +x the azimuthal (Euler) force points -y. This is distinct from the radial centrifugal force.",
        "parameters": {"view": _choice("show", [("motion", "angular acceleration and position"), ("force", "azimuthal force")], "motion"),
                       "change": _choice("CCW rotation", [("faster", "speeding up"), ("slower", "slowing down")], "faster")},
        "editable": ["view", "change"]},
    "pendulum_car": {
        "title": "Pendulum in an accelerating car", "kind": "diagram",
        "summary": "Three separate teaching views of a symbolic problem: setup, three forces in the car frame, or tension triangle from vertical. a_over_g controls illustrative drawing geometry only, never a supplied problem value. Open setup first; change view only when the learner is ready.",
        "parameters": {"a_over_g": _num("drawing tilt (illustrative a / g)", "a/g", "", 0, 1.5, 0.05, 0.5),
                       "view": _choice("show", [("setup", "the setup"), ("forces", "forces on the bob"), ("components", "split the tension")], "setup")},
        "editable": ["a_over_g", "view"]},
    "accelerating_frame": {
        "title": "Pendulum in an accelerating frame", "kind": "diagram",
        "summary": "A pendulum in a car or lift accelerating at a; in that frame a fictitious force −ma adds to gravity: g_eff = g − a.",
        "parameters": {"a_over_g": _num("acceleration a / g", "a/g", "", 0, 1.5, 0.05, 0.5),
                       "direction": _choice("frame accelerates", [("horizontal", "horizontally (car)"), ("up", "upward (lift)")], "horizontal")},
        "editable": ["a_over_g", "direction"]},
    "rotating_frame": {
        "title": "Forces in a rotating frame", "kind": "diagram",
        "summary": "Top view of a rod turning at ω with a bead at r: centrifugal mω²r outward and, when the bead moves along the rod, Coriolis −2mω×v.",
        "parameters": {"v": _num("bead speed along the rod (rotating frame)", "v", "m/s", 0, 2, 0.25, 1),
                       "sense": _choice("rotation seen from above", [("ccw", "counterclockwise (ω = +ωẑ)"), ("cw", "clockwise (ω = −ωẑ)")], "ccw")},
        "editable": ["v", "sense"]},
    "conical_pendulum_frame": {
        "title": "Conical pendulum in the rotating frame", "kind": "diagram",
        "summary": "A mass on a string of length ℓ at angle θ, swinging in a horizontal circle (Morin 10.19); lab frame or rotating frame with the centrifugal force.",
        "parameters": {"theta": _num("string angle θ from the vertical", r"\theta", "deg", 10, 75, 5, 30),
                       "frame": _choice("frame", [("lab", "lab frame (net force is centripetal)"), ("rotating", "rotating frame (forces balance)")], "rotating")},
        "editable": ["theta", "frame"]},
}
# Diagrams show the highlight of their first lesson step; stage n (not a student control) moves stage n's highlight there,
# so each guide step can point at the part it explains. A stage past the last one shows the last.
STAGE = _num("highlighted stage of the explanation", "", "", 1, 6, 1, 1)
# A practice view (not a student control) keeps the givens, geometry and neutral labels but leaves out the derived
# components, forces, directions and results the practice asks for; its lesson text names no answer either.
PRESENTATION = _choice("presentation", [("worked", "worked example: full breakdown"), ("practice", "practice: givens and geometry only")], "worked")
HIDDEN = ("stage", "presentation")
for _spec in VISUALS.values():
    if _spec["kind"] == "diagram":
        _spec["parameters"]["stage"] = STAGE
    _spec["parameters"]["presentation"] = PRESENTATION
for _rid in ("hurricane_balls", "conical_pendulum", "tilted_rod_axle", "cube_inertia", "rod_about_end", "falling_rod", "coriolis_free_particle"):
    VISUALS["library:" + _rid] = {"title": "", "kind": "library", "summary": "Prepared library setup " + _rid + " (fixed illustrative values).",
                                  "parameters": {}, "editable": []}


# ---------------------------------------------------------------- parameters

def validate_parameters(visual_id: str, parameters: dict | None = None) -> dict:
    """The full normalised parameter set; unknown names, wrong types and out-of-range values raise, never clamp."""
    if visual_id not in VISUALS:
        raise UnknownVisual(visual_id)
    specs, given = VISUALS[visual_id]["parameters"], dict(parameters or {})
    unknown = sorted(set(given) - set(specs))
    if unknown:
        raise InvalidParameters(f"{visual_id}: unknown parameter(s) {', '.join(unknown)}")
    out = {}
    for name, spec in specs.items():
        value = given.get(name, spec["default"])
        if spec["type"] == "choice":
            allowed = [o["value"] for o in spec["options"]]
            if value not in allowed:
                raise InvalidParameters(f"{visual_id}: {name} must be one of {', '.join(allowed)}")
        else:
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise InvalidParameters(f"{visual_id}: {name} must be a number")
            if not spec["min"] - 1e-9 <= value <= spec["max"] + 1e-9:
                raise InvalidParameters(f"{visual_id}: {name} = {value} is outside {spec['min']}–{spec['max']} {spec['unit']}".rstrip())
            k = round((value - spec["min"]) / spec["step"])
            value = round(spec["min"] + k * spec["step"], 6)
            value = min(spec["max"], max(spec["min"], value))
            value = int(value) if float(value).is_integer() else value
        out[name] = value
    return out


# ---------------------------------------------------------------- equal-scale diagram helper

class _Dia:
    """Nodes and edges in drawing units. Invisible 'label' nodes with no text anchor arcs, markers and arrow ends."""

    def __init__(self):
        self.nodes, self.edges, self._n = [], [], 0

    def pt(self, x, y, label="", kind="label", nid=None, w=0.0, h=0.0):
        self._n += 1
        nid = nid or f"p{self._n}"
        self.nodes.append({"id": nid, "kind": kind, "label": label, "x": round(x, 4), "y": round(y, 4), "width": w, "height": h})
        return nid

    def edge(self, a, b, kind="line", label="", eid=None):
        self._n += 1
        self.edges.append({"id": eid or f"e{self._n}", "from": a, "to": b, "label": label, "kind": kind})
        return self.edges[-1]["id"]

    def seg(self, p, q, kind="line", label="", eid=None):
        return self.edge(self.pt(*p), self.pt(*q), kind, label, eid)

    def arrow(self, p, q, label="", eid=None):
        return self.seg(p, q, "arrow", label, eid)

    def poly(self, pts, eid=None, closed=False, arrow=False):
        ids = [self.pt(*p) for p in pts]
        if closed:
            ids.append(ids[0])
        for i, (a, b) in enumerate(zip(ids, ids[1:])):
            self.edge(a, b, "arrow" if arrow and i == len(ids) - 2 else "line", "", f"{eid}{i}" if eid else None)

    def arc(self, c, r, a0, a1, label="", eid=None, label_r=None, arrow=False):
        """An arc of radius r round c from angle a0 to a1 (degrees); its label sits just outside the middle."""
        n = max(3, int(abs(a1 - a0) / 8))
        pts = [(c[0] + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)), c[1] + r * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]
        self.poly(pts, eid, arrow=arrow)
        if label:
            m, lr = math.radians((a0 + a1) / 2), label_r or r + 0.32
            self.pt(c[0] + lr * math.cos(m), c[1] + lr * math.sin(m), label, nid=eid and eid + "_label")

    def right_angle(self, corner, u, v, s=0.22):
        a = (corner[0] + s * u[0], corner[1] + s * u[1])
        b = (a[0] + s * v[0], a[1] + s * v[1])
        c = (corner[0] + s * v[0], corner[1] + s * v[1])
        self.poly([a, b, c])

    def diagram(self, pad=0.7):
        # Fit the whole body, not only its centre (a circle at the edge used to clip).
        xs = [n["x"] + sign*n.get("width",0)/2 for n in self.nodes for sign in (-1,1)]
        ys = [n["y"] + sign*n.get("height",0)/2 for n in self.nodes for sign in (-1,1)]
        return {"x_min": round(min(xs) - pad, 3), "x_max": round(max(xs) + pad, 3), "y_min": round(min(ys) - pad, 3), "y_max": round(max(ys) + pad, 3),
                "nodes": self.nodes, "edges": self.edges}


def _pr(p) -> bool:
    return p.get("presentation") == "practice"


def _u(deg):
    return (math.cos(math.radians(deg)), math.sin(math.radians(deg)))


def _add(p, v, k=1.0):
    return (p[0] + k * v[0], p[1] + k * v[1])


def _ang(v):
    return math.degrees(math.atan2(v[1], v[0]))


def _ans(label, expression, value=None, units="", note=""):
    return {"label": label, "expression": expression, "value": None if value is None else float(f"{value:.6g}"), "units": units, "note": note}


def _hl(step: dict, *ids) -> dict:
    step["highlight"] = [i for i in ids if i]
    return step


def _expand_highlights(steps, diagram):
    """A highlight name covers the edge or node with that id, an arc/outline drawn as name0, name1, … and its label node."""
    edges, nodes = [e["id"] for e in diagram["edges"]], {n["id"] for n in diagram["nodes"]}
    for step in steps:
        out = []
        for name in step.get("highlight") or []:
            group = [e for e in edges if e == name or re.fullmatch(re.escape(name) + r"\d+", e)]
            group += [n for n in (name, name + "_label") if n in nodes]
            out += [g for g in group if g not in out]
        step["highlight"] = out


def _lesson(vid, title, restatement, givens, answers, steps, kind, payload, caption, assumptions, plan=""):
    if kind == "diagram":
        _expand_highlights(steps, payload)
    raw = tutor._lesson("Mechanics · guided method (Morin ch. 8–10)", title, restatement, givens, answers, steps, kind, payload, caption, assumptions, plan=plan)
    lesson, _ = tutor.validate(raw)
    return lesson


# ---------------------------------------------------------------- builders

def _trig_components(p):
    th, ref = p["theta"], p["reference"]
    phi = th if ref == "horizontal" else 90 - th
    F = 3.6
    d = _Dia()
    O = (0.0, 0.0)
    T = _add(O, _u(phi), F)
    adj_x = ref == "horizontal"
    d.pt(*O, "O", kind="point", nid="O")
    d.arrow(O, (4.6, 0), "x", "x_axis")
    d.arrow(O, (0, 4.2), "y", "y_axis")
    d.arrow(O, T, "F", "F")
    # the triangle's adjacent side lies along θ's reference axis, so it always touches θ at O; right angle at A
    if adj_x:
        A = (T[0], 0.0)
        d.arrow(O, A, "F_x" if _pr(p) else "F cos θ (adjacent)", "Fx")
        d.arrow(A, T, "F_y" if _pr(p) else "F sin θ (opposite)", "Fy")
        d.right_angle(A, (-1, 0), (0, 1))
    else:
        A = (0.0, T[1])
        d.arrow(O, A, "F_y" if _pr(p) else "F cos θ (adjacent)", "Fy")
        d.arrow(A, T, "F_x" if _pr(p) else "F sin θ (opposite)", "Fx")
        d.right_angle(A, (0, -1), (1, 0))
    if adj_x:
        d.arc(O, 1.1, 0, phi, "θ", "theta")
    else:
        d.arc(O, 1.1, 90, phi, "θ", "theta")
    if adj_x:
        fx, fy = r"F_x=F\cos\theta", r"F_y=F\sin\theta"
    else:
        fx, fy = r"F_x=F\sin\theta", r"F_y=F\cos\theta"
    adjacent, opposite = ("Fx", "Fy") if adj_x else ("Fy", "Fx")
    ref_text = "the horizontal (+x axis)" if adj_x else "the vertical (+y axis)"
    steps = [_hl(S("Mark θ at its reference", rf"θ = {th}° is measured from {ref_text}. Draw it there first.", show=["labels"]), "theta"),
             _hl(S("Adjacent side → cos", r"The component along the side that touches θ is $F\cos\theta$.", show=["labels"]), adjacent, "theta"),
             _hl(S("Opposite side → sin", r"The component across from θ is $F\sin\theta$.", show=["labels"]), opposite),
             _hl(S("Check", r"$F_x^2+F_y^2=F^2(\cos^2\theta+\sin^2\theta)=F^2$, and θ → 0 leaves the whole of F along the reference axis.", show=["labels"]), "F")]
    return _lesson("trig_components", "Components of a vector",
                   f"A vector of magnitude F makes angle θ = {th}° with {ref_text}. Write F_x and F_y.",
                   [f"θ = {th}° from {ref_text}", "magnitude F"],
                   [_ans("x component", fx), _ans("y component", fy)], steps, "diagram", d.diagram(),
                   f"Equal-scale diagram; θ = {th}° measured from {ref_text}.", ["θ is measured from the stated axis."])


def _incline_gravity(p):
    th, ref = p["theta"], p["reference"]
    slope = th if ref == "base" else 90 - th   # the slope's angle with the ground
    Ls = 5.0
    W, H = Ls * math.cos(math.radians(slope)), Ls * math.sin(math.radians(slope))
    d = _Dia()
    B, Rt, Tp = (0.0, 0.0), (W, 0.0), (0.0, H)
    d.poly([B, Rt, Tp], "ramp", closed=True)
    u = (math.cos(math.radians(slope)), -math.sin(math.radians(slope)))          # down the slope
    n = (math.sin(math.radians(slope)), math.cos(math.radians(slope)))           # outward normal
    s0, half = 1.9, 0.45
    foot = _add(Tp, u, s0)
    C = _add(foot, n, half)
    corners = [_add(_add(C, u, sx * half), n, sy * half) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    d.poly(corners, "block", closed=True)
    g = 2.3
    d.pt(*C, "", kind="point", nid="C")
    d.arrow(C, (C[0], C[1] - g), "mg", "mg")
    along = math.sin(math.radians(slope)) * g
    into = math.cos(math.radians(slope)) * g
    A1 = _add(C, u, along)
    A2 = _add(C, n, -into)
    sin_or_cos = ("sin", "cos") if ref == "base" else ("cos", "sin")
    if not _pr(p):
        d.arrow(C, A1, f"mg {sin_or_cos[0]} θ (along)", "along")
        d.arrow(C, A2, f"mg {sin_or_cos[1]} θ (into)", "into")
        d.seg(A1, (C[0], C[1] - g))
        d.seg(A2, (C[0], C[1] - g))
        d.right_angle(C, u, (-n[0], -n[1]))
        # the angle between mg and the inward normal equals the slope angle
        d.arc(C, 0.8, _ang((-n[0], -n[1])), -90, "θ" if ref == "base" else "90°−θ", "theta_at_block")
    if ref == "base":
        d.arc(Rt, 1.0, 180 - slope, 180, "θ", "theta_slope")
    else:
        d.arc(Tp, 1.0, -90, -90 + (90 - slope), "θ", "theta_slope")
    if ref == "base":
        a_along, a_into = r"mg\sin\theta", r"mg\cos\theta"
    else:
        a_along, a_into = r"mg\cos\theta", r"mg\sin\theta"
    where = "the horizontal ground" if ref == "base" else "the vertical wall"
    steps = [_hl(S("Where is θ?", f"Here θ = {th}° is measured from {where}. The slope makes {slope}° with the ground.", show=["labels"]), "theta_slope"),
             _hl(S("Same angle at the block", "mg is perpendicular to the ground and the normal is perpendicular to the slope, so the angle between them equals the slope's angle with the ground.", show=["labels"]), "theta_at_block", "mg"),
             _hl(S("Along the slope", rf"The side opposite that angle runs along the slope: ${a_along}$.", show=["labels"]), "along"),
             _hl(S("Into the slope", rf"The side adjacent to it points into the slope: ${a_into}$, which N balances.", show=["labels"]), "into")]
    return _lesson("incline_gravity", "Gravity components on a slope",
                   f"A block rests on a slope; θ = {th}° is measured from {where}. Split mg along and perpendicular to the slope.",
                   [f"θ = {th}° from {where}", "mass m, gravity g"],
                   [_ans("Along the slope", a_along), _ans("Into the slope", a_into)], steps, "diagram", d.diagram(),
                   f"Equal-scale diagram; slope angle with the ground {slope}°.", ["Fixed frictionless slope; only the split of mg is asked."])


def _rod_axis(p):
    shape, f = p["shape"], p["d_frac"]
    d = _Dia()
    if shape == "rod":
        L = 5.0
        d.poly([(-L / 2, 0.08), (L / 2, 0.08), (L / 2, -0.08), (-L / 2, -0.08)], "rod", closed=True)
        dist = f * L / 2
        f = f / 2                                # d as a fraction of L from here on
        icm, icm_tex = 1 / 12, r"\tfrac1{12}ML^2"
        unit = "ML²"
        dtex = rf"d={f:g}L"
    else:
        R = 2.4
        d.arc((0, 0), R, 0, 360, "", "disk")
        dist = f * R
        icm, icm_tex = 1 / 2, r"\tfrac12MR^2"
        unit = "MR²"
        dtex = rf"d={f:g}R"
    d.pt(0, 0, "CM", kind="point", nid="CM")
    if dist > 1e-9:
        d.pt(dist, 0, "axis ⊙", kind="junction", nid="axis")
        d.seg((0, -0.75), (dist, -0.75), "line", "d", "d")
        d.seg((0, -0.6), (0, -0.9))
        d.seg((dist, -0.6), (dist, -0.9))
    else:
        d.pt(0, 0.5, "axis ⊙ through CM", nid="axis")
    total = icm + f * f
    name = "rod of length L" if shape == "rod" else "uniform disk of radius R"
    steps = [_hl(S("Known I about the CM", rf"For a {name}: $I_{{cm}}={icm_tex}$ about an axis through the CM, perpendicular to the page.", show=["labels"]), "CM"),
             _hl(S("Parallel axis", rf"The axis is moved a distance ${dtex}$, parallel to the first: $I=I_{{cm}}+Md^2$.", show=["labels"]), "d", "axis"),
             _hl(S("Add", rf"$I=({icm:.4g}+{f * f:.4g})\,{unit.replace('²', '^2')}={total:.4g}\,{unit.replace('²', '^2')}$.", show=["labels"]), "axis")]
    return _lesson("rod_axis", "Moment of inertia about a parallel axis",
                   f"Find the moment of inertia of a {name}, mass M, about an axis perpendicular to the page at distance d = {f:g}{'L' if shape == 'rod' else 'R'} from its centre.",
                   [f"{name}, mass M", f"axis ⊥ page at d = {f:g}{'L' if shape == 'rod' else 'R'} from the CM"],
                   [_ans("Moment of inertia", rf"I={icm_tex}+M d^2", total, unit)], steps, "diagram", d.diagram(),
                   "Equal-scale diagram; the axis points out of the page (⊙).", ["Uniform body; axis perpendicular to the page."])


def _beam_release(p):
    a = p["a_frac"]
    L = 6.0
    dd = 0.5 - a                        # pivot to CM, in units of L
    ip = 1 / 12 + dd * dd               # pivot moment, units mL²
    alpha = dd / ip                     # units g/L
    acm = alpha * dd                    # units g
    N = 1 - acm                         # units mg
    omega2 = 2 * dd / ip                # ω² after swinging to vertical, units g/L
    Lmom = ip * math.sqrt(omega2)       # units m L² √(g/L)
    d = _Dia()
    d.poly([(0, 0.12), (L, 0.12), (L, -0.12), (0, -0.12)], "beam", closed=True)
    px, rx = a * L, L - a * L
    d.poly([(px, -0.12), (px - 0.35, -0.7), (px + 0.35, -0.7)], "pivot", closed=True)
    d.pt(px, -0.12, "", kind="junction", nid="P")
    d.pt(px, -1.05, "pivot", nid="pivot_label")
    d.poly([(rx, -0.12), (rx - 0.35, -0.7), (rx + 0.35, -0.7)], "gone", closed=True)
    d.pt(rx, -1.05, "removed", nid="removed")
    d.pt(L / 2, 0, "", kind="point", nid="CM")
    d.arrow((L / 2, 0), (L / 2, -1.9), "mg", "mg")
    if not _pr(p):
        if N > 1e-6:
            d.arrow((px, -0.7), (px, -0.7 + 1.9 * N), "N", "N")
        d.arrow((L / 2 + 0.35, 0), (L / 2 + 0.35, -1.9 * acm), "a_cm", "acm")
    if dd > 1e-9:
        d.seg((px, 1.0), (L / 2, 1.0), "line", "d", "d")
        d.seg((px, 0.85), (px, 1.15))
        d.seg((L / 2, 0.85), (L / 2, 1.15))
    d.arc((px, 0), 1.2, 40, -5, "α", "alpha", arrow=True)
    steps = [_hl(S("Before: two supports", r"Each support carries $\tfrac12mg$: equal by symmetry, together they balance $mg$.", show=["labels"]), "mg"),
             _hl(S("Torque about the pivot", rf"Right after release nothing moves yet, so only $\alpha$ is new. About the pivot only $mg$ has a lever arm $d={dd:g}L$: $mgd=I_P\alpha$.", show=["labels"]), "d", "alpha"),
             _hl(S("I about the pivot", rf"Parallel axis: $I_P=\tfrac1{{12}}mL^2+md^2={ip:.4g}\,mL^2$, so $\alpha=\dfrac{{gd}}{{I_P/m}}={alpha:.4g}\,g/L$.", show=["labels"]), "alpha"),
             _hl(S("Support force", rf"The CM accelerates down at $a_{{cm}}=\alpha d={acm:.4g}\,g$. Vertically: $mg-N=ma_{{cm}}$, so $N={N:.4g}\,mg$.", show=["labels"]), "N", "acm"),
             _hl(S("L after swinging down", rf"Energy from horizontal to vertical: $mgd=\tfrac12I_P\omega^2$, then $L=I_P\omega={Lmom:.4g}\,mL^2\sqrt{{g/L}}$.", show=["labels"]), "P")]
    return _lesson("beam_release", "Beam released from one support",
                   f"A uniform beam (mass m, length L) rests on two supports, each a distance a = {a:g}L from an end. The right support is suddenly removed. "
                   "Find the angular acceleration and the force from the remaining support right after release, and the beam's angular momentum about the pivot when it hangs vertically.",
                   ["uniform beam, mass m, length L", f"supports at a = {a:g}L from each end", "right support removed at t = 0"],
                   [_ans("Angular acceleration", rf"\alpha=\dfrac{{g d}}{{L^2/12+d^2}}", alpha, "g/L"),
                    _ans("Support force just after", r"N=m(g-\alpha d)", N, "mg"),
                    _ans("L when vertical", r"L=I_P\omega=\sqrt{2mgd\,I_P}", Lmom, "mL²√(g/L)")],
                   steps, "diagram", d.diagram(), "Equal-scale diagram; arrows show directions, mg and N to the same scale.",
                   ["Uniform rigid beam; frictionless pivot."])


def _rolling_shapes(p):
    shape = p["shape"]
    beta = BETA[shape]
    th, r, L = 30.0, 0.35, 3.0
    t = math.radians(th)
    a = G * math.sin(t) / (1 + beta)
    w, h = L * math.cos(t), L * math.sin(t)
    name = dict(ROLLERS)[shape]
    steps = [S("Forces", r"Gravity along the slope $mg\sin\theta$; static friction $f$ up the slope at the contact point.", at=0, show=["forces", "labels"], camera="side"),
             S("Two equations, one constraint", rf"$ma=mg\sin\theta-f$, $I\alpha=fr$ with $I=\beta mr^2$, $\beta={beta:g}$, and rolling $a=r\alpha$.", at=0.4, show=["forces", "velocity", "labels"], camera="side"),
             S("Solve", rf"$a=\dfrac{{g\sin\theta}}{{1+\beta}}={a:.3g}$ m/s²; a bigger β (mass further out) rolls slower.", show=["velocity", "labels", "trail"], camera="side")]
    scene = {"title": "Rolling down a slope", "gravity": G, "duration": 1.2, "topdown": False, "focus": "ball", "camera": None,
             "bodies": [{"id": "ramp", "type": "static", "shape": "polygon", "pos": [0, 0], "points": [[0, 0], [w, 0], [0, h]], "friction": 1, "render": {"kind": "slab", "prop": "ramp"}},
                        {"id": "floor", "type": "static", "shape": "edge", "pos": [0, 0], "points": [[-0.5, 0], [w + 1, 0]], "friction": 1, "render": {"kind": "floor"}},
                        {"id": "ball", "shape": "circle", "r": r, "mass": 1, "inertia": shape, "pos": [r * math.sin(t), h + r * math.cos(t)],
                         "friction": 1, "restitution": 0, "label": "m", "render": {"kind": "sphere" if shape == "solid_sphere" else "disk"}}],
             "joints": [], "forces": [], "impulses": [], "strings": [], "ropes": [], "nocollide": [],
             "checks": [{"label": "speed after 1 s = g sin θ t/(1+β)", "quantity": "speed", "body": "ball", "joint": None, "at": 1.0, "expect": round(a, 6), "tol_pct": 3},
                        {"label": "rolling: ω = −v/r", "quantity": "omega", "body": "ball", "joint": None, "at": 1.0, "expect": round(-a / r, 6), "tol_pct": 3}],
             "steps": [{"title": s["title"], "body": s["body"], "at": s["at"], "show": s["show"], "camera": s["camera"], "highlight": [], "actions": []} for s in steps]}
    return _lesson("rolling_shapes", f"Rolling: {name}",
                   f"A {name} of mass m and radius r rolls without slipping from rest down a fixed slope of angle θ. Find its acceleration and the friction it needs.",
                   ["θ = 30° (drawn)", f"{name}: I = {beta:g} mr²", "rolls without slipping", "starts from rest"],
                   [_ans("Acceleration", r"a=\dfrac{g\sin\theta}{1+\beta}", a, "m/s²", "Value for θ = 30°."),
                    _ans("Friction needed", r"f=\dfrac{\beta}{1+\beta}mg\sin\theta")],
                   steps, "mechanics", scene, "Planar simulation; illustrative 3 m slope and r = 0.35 m (the answer does not depend on them).",
                   ["Enough static friction to roll without slipping."])


def _vec_text(v, sym):
    names = {(1, 0): f"+{sym}x̂", (-1, 0): f"−{sym}x̂", (0, 1): f"+{sym}ŷ", (0, -1): f"−{sym}ŷ"}
    return names[(round(v[0]), round(v[1]))]


def _contact_torque(p):
    R = 1.6
    rv = {"bottom": (0, -1), "top": (0, 1), "right": (1, 0)}[p["point"]]
    fv = {"-x": (-1, 0), "+x": (1, 0), "+y": (0, 1), "-y": (0, -1)}[p["force"]]
    tz = rv[0] * fv[1] - rv[1] * fv[0]          # in units of R·F
    d = _Dia()
    d.arc((0, 0), R, 0, 360, "", "wheel")
    P = (R * rv[0], R * rv[1])
    d.pt(0, 0, "O", kind="point", nid="O")
    d.arrow((0, 0), P, "r" if _pr(p) else "r = " + _vec_text(rv, "R"), "r")
    d.arrow(P, _add(P, fv, 1.5), "F = " + _vec_text(fv, "F"), "F")
    d.pt(*P, "", kind="junction", nid="P")
    d.arrow((-2.9, -2.4), (-2.0, -2.4), "x", "x_axis")
    d.arrow((-2.9, -2.4), (-2.9, -1.5), "y", "y_axis")
    d.pt(-2.9, -2.4, "z ⊙", kind="point", nid="z")
    if tz > 0:
        result, sense, tlabel = r"+RF\,\hat z", "out of the page: counterclockwise", "τ = +RF ẑ ⊙"
    elif tz < 0:
        result, sense, tlabel = r"-RF\,\hat z", "into the page: clockwise", "τ = −RF ẑ ⊗"
    else:
        result, sense, tlabel = "0", "zero: r and F are parallel", "τ = 0"
    if not _pr(p):
        if tz:
            d.arc((0, 0), 0.7, 200, 340, "", "turn", arrow=True) if tz > 0 else d.arc((0, 0), 0.7, 340, 200, "", "turn", arrow=True)
        d.pt(-2.3, 2.2, tlabel, nid="tau")
    rt = {"bottom": r"-R\,\hat y", "top": r"R\,\hat y", "right": r"R\,\hat x"}[p["point"]]
    ft = {"-x": r"-F\,\hat x", "+x": r"F\,\hat x", "+y": r"F\,\hat y", "-y": r"-F\,\hat y"}[p["force"]]
    steps = [_hl(S("Lever arm from the centre", rf"$\vec r$ runs from the point you take torques about (O) to where the force acts: $\vec r={rt}$.", show=["labels"]), "r"),
             _hl(S("Force with a unit vector", rf"$\vec F={ft}$.", show=["labels"]), "F"),
             _hl(S("Cross the unit vectors", r"$\hat x\times\hat y=\hat z$, $\hat y\times\hat x=-\hat z$, and any unit vector crossed with itself is 0.", show=["labels"]), "z"),
             _hl(S("Result", rf"$\vec\tau=\vec r\times\vec F={result}$: {sense}.", show=["labels"]), "tau", "turn")]
    return _lesson("contact_torque", "Torque from a contact force",
                   f"A force of magnitude F acts on a wheel of radius R at the {p['point']} point, directed {dict(FORCES)[p['force']]}. Find the torque about the centre O as a vector.",
                   [f"point of application: {dict(POINTS)[p['point']]}", f"force {dict(FORCES)[p['force']]}", "x right, y up, z out of the page"],
                   [_ans("Torque about O", rf"\vec\tau={result}", note=sense)], steps, "diagram", d.diagram(),
                   "Equal-scale diagram; ⊙ is out of the page, ⊗ into it.", ["Torque about the wheel's centre O."])


SHAPE_I = {"disk": (0.25, 0.5), "ring": (0.5, 1.0), "rod": (1 / 3, 0.0)}   # (I₂, I₃) in m r²; the rod has length 2r


def _tilted_body_L(p):
    th, shape, mode = p["theta"], p["shape"], p["mode"]
    I2, I3 = SHAPE_I[shape]
    c, s = math.cos(math.radians(th)), math.sin(math.radians(th))
    e3, e2 = (s, c), (-c, s)                       # ẑ = cos θ x̂₃ + sin θ x̂₂
    w = 2.6
    d = _Dia()
    O = (0.0, 0.0)
    if shape == "rod":
        d.seg(_add(O, e3, -1.7), _add(O, e3, 1.7), "line", "rod", "body")
    else:
        d.poly([_add(_add(O, e2, k * 1.7), e3, j * 0.06) for k, j in ((-1, -1), (1, -1), (1, 1), (-1, 1))], "body", closed=True)
    d.seg(_add(O, e3, -3.0), _add(O, e3, 3.0), "line", "", "x3_line")
    d.pt(*_add(O, e3, 3.25), "x̂_3", nid="x3")
    d.seg(_add(O, e2, -3.0), _add(O, e2, 3.0), "line", "", "x2_line")
    d.pt(*_add(O, e2, 3.25), "x̂_2", nid="x2")
    d.pt(*O, "CM", kind="point", nid="O")
    d.arrow(O, (0, w), "ω", "omega")
    d.arc(O, 1.0, 90, _ang(e3), "θ", "theta")
    w3, w2 = w * c, w * s
    Lx = I2 * s * e2[0] + I3 * c * e3[0]
    Lz = I2 * s * e2[1] + I3 * c * e3[1]
    Lm = math.hypot(Lx, Lz)
    if mode == "L":
        d.arrow(O, _add(O, e3, w3), "ω_3" if _pr(p) else "ω cos θ", "w3")
        d.arrow(O, _add(O, e2, w2), "ω_2" if _pr(p) else "ω sin θ", "w2")
        d.seg(_add(O, e3, w3), (0, w))
        d.seg(_add(O, e2, w2), (0, w))
    scale = w / max(I2, I3)
    tip = (Lx * scale, Lz * scale)
    if Lm > 1e-9 and not _pr(p):
        d.arrow(O, tip, "L", "L")
    angle = math.degrees(math.acos(max(-1, min(1, Lz / Lm)))) if Lm else 0
    sgn = Lx  # horizontal part of L, + to the right
    if mode == "dLdt" and not _pr(p):
        d.arrow((0, tip[1]), tip, "L_x (horizontal)", "Lperp")
        d.seg(O, (0, tip[1]))
        if abs(sgn) < 1e-9:
            d.pt(-1.8, -1.6, "dL/dt = 0", nid="dLdt")
        else:
            d.pt(tip[0], tip[1] - 0.6 if tip[1] > 0 else tip[1] + 0.6, "dL/dt ⊗ (into page)" if sgn > 0 else "dL/dt ⊙ (out of page)", nid="dLdt")
    name = {"disk": "uniform disk", "ring": "ring", "rod": "thin rod of length 2r"}[shape]
    i2t = {"disk": r"\tfrac14mr^2", "ring": r"\tfrac12mr^2", "rod": r"\tfrac13mr^2"}[shape]
    i3t = {"disk": r"\tfrac12mr^2", "ring": r"mr^2", "rod": "0"}[shape]
    Lperp = (I3 - I2) * s * c
    steps = [_hl(S("Principal axes", rf"Symmetry gives the principal axes: $\hat x_3$ along the symmetry axis, $\hat x_2$ in the page across it ({name}: $I_3={i3t}$, $I_2={i2t}$).", show=["labels"]), "x3_line", "x2_line"),
             _hl(S("Write ω in that basis", r"$\hat z=\cos\theta\,\hat x_3+\sin\theta\,\hat x_2$, so $\omega_3=\omega\cos\theta$ (adjacent to θ) and $\omega_2=\omega\sin\theta$.", show=["labels"]), "w3", "w2", "theta"),
             _hl(S("L = I ω, axis by axis", r"$\vec L=I_2\omega_2\hat x_2+I_3\omega_3\hat x_3$. Different moments scale the parts differently, so $\vec L$ tilts away from $\vec\omega$.", show=["labels"]), "L")]
    if mode == "dLdt":
        steps.append(_hl(S("Which part of L turns", rf"As the body turns about $\hat z$ at $\omega$, the vertical part of $\vec L$ stays and the horizontal part goes round. Signed: $L_x=(I_3-I_2)\omega\sin\theta\cos\theta$; size: $|d\vec L/dt|=\omega|L_x|$, direction $\omega L_x\,\hat y$ ($\hat y$ into the page).", show=["labels"]), "Lperp", "dLdt"))
        steps.append(_hl(S("Torque needed", r"$\vec\tau=d\vec L/dt$: the axle bearings must supply it. Its direction flips when $I_3<I_2$ (then $L_x<0$).", show=["labels"]), "dLdt"))
    answers = [_ans("ω along x̂₃", r"\omega_3=\omega\cos\theta"), _ans("ω along x̂₂", r"\omega_2=\omega\sin\theta"),
               _ans("L", rf"\vec L={i2t}\,\omega\sin\theta\,\hat x_2+{i3t}\,\omega\cos\theta\,\hat x_3".replace("+0\\,\\omega\\cos\\theta\\,\\hat x_3", "")),
               _ans("angle between L and ω", r"\cos^{-1}(L_z/|\vec L|)", angle, "deg", "unsigned; L leans toward x̂₃ when I₃ > I₂, toward x̂₂ when I₃ < I₂")]
    if mode == "dLdt":
        answers.append(_ans("signed horizontal L", r"L_x=(I_3-I_2)\,\omega\sin\theta\cos\theta", Lperp, "mr²ω"))
        answers.append(_ans("|dL/dt| = |τ|", r"\omega^2\,|I_3-I_2|\sin\theta\cos\theta", abs(Lperp), "mr²ω²",
                            "into the page (ŷ) when I₃ > I₂" if Lperp > 0 else ("out of the page when I₃ < I₂" if Lperp < 0 else "zero")))
    return _lesson("tilted_body_L", "ω and L of a tilted body",
                   f"A {name} spins with ω = ω ẑ (vertical) about its CM, its symmetry axis tilted θ = {th}° from the vertical. Find ω and L in principal axes"
                   + (" and the torque needed to keep this going." if mode == "dLdt" else "."),
                   [f"{name}", f"θ = {th}° between x̂₃ and ẑ", "ω = ω ẑ, constant"], answers, steps, "diagram", d.diagram(),
                   "Equal-scale side view; L's direction is exact, its length is scaled to fit.", ["Rigid symmetric body; ω fixed in direction."])


def _rolling_coin(p):
    th, k, motion, shape = p["theta"], p["R_over_r"], p["motion"], p["shape"]
    beta = 0.5 if shape == "coin" else 1.0
    t = math.radians(th)
    c, s = math.cos(t), math.sin(t)
    if motion == "wobble":
        k = c                                   # the CM stays above the circle's centre
    bound = (1 + beta / 2) / (1 + beta) * c
    if k <= bound + 1e-9:
        raise InvalidParameters(f"rolling_coin: this motion needs R > {bound:.3f} r for θ = {th}° (Morin 9.23)")
    den = (1 + beta) * k * math.tan(t) - (1 + beta / 2) * s        # Ω² = g / (r·den)
    W2 = 1 / den                                                     # Ω² in units g/r
    r = 2.2
    R = k * r
    d = _Dia()
    P = (R, 0.0)
    dirc = (-c, s)                                                   # x̂₂: up the coin from the contact point
    e3 = (s, c)
    CM = _add(P, dirc, r)
    top = _add(P, dirc, 2 * r)
    d.seg((-0.6, 0), (R + 2.2, 0), "line", "", "ground")
    d.seg((0, 0), (0, max(2 * r * s, 2.2) + 0.4), "line", "", "axis")
    d.pt(0, max(2 * r * s, 2.2) + 0.7, "Ω ↺ (seen from above)", nid="Omega")
    d.poly([_add(P, e3, 0.05), _add(top, e3, 0.05), _add(top, e3, -0.05), _add(P, e3, -0.05)], "coin", closed=True)
    d.pt(*P, "P", kind="junction", nid="P")
    d.pt(*CM, "CM", kind="point", nid="CM")
    d.arc(P, 0.7, 180 - th, 180, "θ", "theta")
    d.arrow(CM, _add(CM, dirc, 1.1), "x̂_2", "x2")
    d.arrow(CM, _add(CM, e3, 1.1), "x̂_3", "x3")
    d.seg((0, -0.45), (R, -0.45), "line", "R", "R")
    d.seg((0, -0.3), (0, -0.6))
    d.seg((R, -0.3), (R, -0.6))
    if abs(CM[0]) > 0.05 and not _pr(p):
        d.seg((0, CM[1]), (CM[0], CM[1]), "line", "R − r cos θ", "Rcm")
    if not _pr(p):
        d.arrow(P, (P[0], 1.4), "N = mg", "N")
        d.arrow(CM, (CM[0], CM[1] - 1.4), "mg", "mg")
    fric = (k - c) * W2                                               # friction in units of mg, toward the axis if > 0
    if abs(fric) > 1e-3 and not _pr(p):
        d.arrow(P, (P[0] - math.copysign(min(1.6, 0.4 + abs(fric)), fric), 0.0), "F_f", "F")
    # L in the page: ω₂ = Ω sin θ, ω₃ = −Ω (R/r − cos θ); I₂ = β/2, I₃ = β (units m r²)
    w2, w3 = s, -(k - c)
    L2, L3 = beta / 2 * w2, beta * w3
    Lv = (L2 * dirc[0] + L3 * e3[0], L2 * dirc[1] + L3 * e3[1])
    Lm = math.hypot(*Lv)
    if Lm > 1e-9 and not _pr(p):
        d.arrow(CM, _add(CM, Lv, 1.3 / Lm), "L", "L")
    Lperp = -Lv[0]                                                    # leftward positive (Morin)
    tau = c - fric * s                                                # out-of-page torque / (m g r)
    check = W2 * Lperp - tau                                          # dL/dt = τ in units m g r
    if abs(check) > 1e-9:
        raise AssertionError("rolling coin: dL/dt and τ disagree")
    i_text = r"I_3=\tfrac12mr^2,\ I_2=\tfrac14mr^2" if beta == 0.5 else r"I_3=mr^2,\ I_2=\tfrac12mr^2"
    steps = [_hl(S("Principal axes and ω", r"$\hat x_3$ ⊥ coin, $\hat x_2$ along it. Rolling: $\omega'r=\Omega R$, so $\vec\omega=\Omega\hat z-\Omega\tfrac Rr\hat x_3$.", show=["labels"]), "x2", "x3"),
             _hl(S("ẑ in the principal basis", r"$\hat z=\sin\theta\,\hat x_2+\cos\theta\,\hat x_3$, so $\omega_2=\Omega\sin\theta$, $\omega_3=-\Omega(R/r-\cos\theta)$.", show=["labels"]), "theta"),
             _hl(S("L and its turning part", rf"${i_text}$; $\vec L=I_2\omega_2\hat x_2+I_3\omega_3\hat x_3$. Only the horizontal part goes round: $|d\vec L/dt|=\Omega L_\perp$.", show=["labels"]), "L"),
             _hl(S("Torque about the CM", r"Contact force: $N=mg$ up and friction $m(R-r\cos\theta)\Omega^2$ toward the axis. $\tau=mgr\cos\theta-m(R-r\cos\theta)\Omega^2r\sin\theta$.", show=["labels"]), "N", "F"),
             _hl(S("Solve for Ω", rf"$\tau=\Omega L_\perp$ gives $\Omega^2=\dfrac{{g}}{{(1+\beta)R\tan\theta-(1+\beta/2)r\sin\theta}}={W2:.4g}\,g/r$.", show=["labels"]), "Omega")]
    if motion == "wobble":
        steps.insert(0, _hl(S("Changed constraint", r"The CM stays put, so the contact circle has radius $R=r\cos\theta$ and there is no sideways friction.", show=["labels"]), "R"))
    return _lesson("rolling_coin", "Coin rolling in a circle" if motion == "circle" else "Coin wobbling in place",
                   ("A coin of radius r rolls without slipping so that its contact point traces a circle of radius R, the coin at a constant angle θ to the ground. Find Ω."
                    if motion == "circle" else "A coin of radius r wobbles in place: its CM stays still and it rolls without slipping at a constant angle θ to the table. Find Ω."),
                   [f"θ = {th}° with the ground", f"R = {k:.3g} r" + (" (= r cos θ)" if motion == "wobble" else ""), f"{shape}: I₃ = βmr², β = {beta:g}", "rolls without slipping"],
                   [_ans("Ω²", r"\Omega^2=\dfrac{g}{(1+\beta)R\tan\theta-(1+\beta/2)r\sin\theta}", W2, "g/r"),
                    _ans("Exists only if", r"R>\dfrac{1+\beta/2}{1+\beta}\,r\cos\theta", bound, "r")],
                   steps, "diagram", d.diagram(), "Equal-scale side view at one instant; L's direction is exact, its length scaled.",
                   ["Thin coin, enough friction, steady motion."])


def _prepared_drawing(vid,title,problem,givens,d,caption,highlight=()):
    return _lesson(vid,title,problem,givens,[_ans('Use the worked example',r'\text{see the current worked step}')],
       [_hl(S(title,'Use the named geometry and coordinate directions; all unspecified lengths in this diagram are illustrative.'),*highlight)],
       'diagram',d.diagram(),caption,['This is a geometry/direction diagram, not a computed trajectory.'])


def _tensor_rotation(p):
    d=_Dia();O=(0,0);t=math.radians(p['theta']);s,c=math.sin(t),math.cos(t)
    d.arrow(O,(3.4,0),'x','x');d.arrow(O,(0,3.4),'z','z')
    d.arrow(O,(2.7*c,-2.7*s),'e_1','e1');d.arrow(O,(2.7*s,2.7*c),'e_3','e3')
    d.pt(-.5,-.5,'+y ⊗')
    if abs(p['theta'])>0:d.arc(O,.85,90-p['theta'],90,'θ','theta')
    return _prepared_drawing('tensor_rotation','Body axes move; lab axes stay','Actively rotate the body about +y while lab x,y,z remain fixed.',
       ['R maps body components to lab components'],d,'x-z view: +y into the page. θ is the active body rotation.',('e1','e3'))


def _sphere_capture(p):
    d=_Dia();O=(0,0);q=math.sqrt(2)/2
    d.pt(*O,kind='circle',nid='sphere',w=3.4,h=3.4)
    d.arrow(O,(0,2.7),'L','L')
    r=2.0 if p['view']=='before' else 1.7
    for sg in (1,-1):d.pt(sg*r*q,sg*r*q,'m/2',kind='circle',nid='massp' if sg>0 else 'massn',w=.22,h=.22)
    d.seg((-1.7*q,-1.7*q),(1.7*q,1.7*q),eid='pair')
    d.arc(O,.7,45,90,'θ','theta')
    if p['view']=='after':d.arrow(O,(2.4*q,2.4*q),'e_3','e3')
    return _prepared_drawing('sphere_capture','The mass-pair axis is tilted','A spinning sphere captures two opposite initially stationary masses.',
       ['sphere mass m, radius R','two masses m/2; θ from vertical'],d,'Side view. L stays vertical; the illustrated θ is not a supplied numerical value.',('L',))


def _free_top_axes(p):
    d=_Dia();O=(0,0);theta=math.radians(25);tip=(2.8*math.sin(theta),2.8*math.cos(theta))
    # A thin ghosted disk centred at the pivot makes e3 recognizable as a face
    # normal. Its 3D plane is perpendicular to e3=(sin(beta),0,cos(beta)).
    # Use the same shallow depth projection as the horizontal precession ellipse;
    # this is a body at ONE orientation, not another orbit or a spin trajectory.
    depth=.22/tip[0];radius=.86;rim=[]
    for i in range(21):
        t=i*2*math.pi/20
        x=radius*math.cos(theta)*math.cos(t)
        z=-radius*math.sin(theta)*math.cos(t)
        y=radius*math.sin(t)
        rim.append((x,z+depth*y))
    d.poly(rim,'bodyrim')
    d.pt(-.8,-.57,'coin',nid='body_label')
    d.arrow(O,(0,3.4),'L','L');d.arrow(O,tip,'e_3','axis')
    d.seg(O,(-tip[0],tip[1]),eid='cone')
    d.arc(O,.9,65,90,'β','beta')
    # A horizontal precession circle projects to a flat ellipse; a circular arc
    # in this meridian would falsely suggest rotation about the page normal.
    orbit=[(tip[0]*math.cos(t),tip[1]+.22*math.sin(t)) for t in [i*2*math.pi/40 for i in range(41)]]
    d.poly(orbit,'precession',arrow=True);d.pt(0,tip[1]+.5,'Ω_p')
    return _prepared_drawing('free_top_axes','The body axis circles fixed L','After a brief kick a torque-free symmetric body has a fixed L while its symmetry axis precesses.',
       ['I1=I2=I; axial moment I3','no external torque after the impulse'],d,'Meridian of the cone. β is the angle between the body axis and fixed L; illustrative geometry.',('axis',))


def _heavy_top_horizontal(p):
    d=_Dia();O=(0,3);C=(1.7,1.1)
    d.pt(*O,'O',kind='junction',nid='pivot');d.arrow(O,C,'e_3','axis')
    d.pt(*C,'CM',kind='circle',nid='body',w=.35,h=.35)
    d.seg(O,(0,.4),eid='down');d.arc(O,.8,-90,_ang((C[0],C[1]-O[1])),'θ','theta')
    d.arrow(C,(C[0],-.5),'mg','weight')
    if not _pr(p):d.arrow((.3,3.7),(2.4,3.7),'ω','omega')
    return _prepared_drawing('heavy_top_horizontal','θ is measured from downward vertical','A heavy symmetric top has horizontal total spin and steady precession.',
       ['CM distance ℓ below the fixed pivot','I and I3 measured about the pivot'],d,'Side view. e3 points from pivot toward CM. The total spin axis ω is horizontal.',('omega',))


def _massive_pulley(p):
    d=_Dia();d.pt(0,3,'I',kind='circle',nid='pulley',w=1.6,h=1.6)
    d.seg((-.8,3),(-.8,.4),eid='rope1');d.seg((.8,3),(.8,.1),eid='rope2')
    d.pt(-.8,.1,'m_1',kind='block',nid='m1',w=.65,h=.6)
    d.pt(.8,-.3,'m_2',kind='block',nid='m2',w=.8,h=.8)
    if not _pr(p):
        d.arrow((-1.3,.3),(-1.3,1.7),'T_1','T1');d.arrow((1.4,0),(1.4,1.4),'T_2','T2')
    d.seg((0,3),(.8,3),label='R',eid='radius')
    return _prepared_drawing('massive_pulley','Tensions need not match','Find acceleration of two masses linked by a non-slip string over a pulley of inertia I.',
       ['m2>m1','same string acceleration; fixed pulley axle'],d,'Side view. The two hanging masses share the rope acceleration; pulley inertia requires unequal tensions.',('T1','T2'))


def _sliding_coin(p):
    d=_Dia();d.pt(0,1.2,kind='circle',nid='coin',w=2.4,h=2.4);d.seg((-1.45,0),(1.7,0),eid='table')
    d.arrow((0,1.2),(1.75,1.2),'v_0','v');d.arc((0,1.2),.75,-30,210,'ω_0','spin',arrow=True)
    if not _pr(p):d.arrow((0,0),(-1.4,0),'f','friction')
    return _prepared_drawing('sliding_coin','Forward travel, opposite spin','Choose speed and counterclockwise spin so a sliding coin stops both at distance d.',
       ['kinetic friction μ','I=mR²/2; initial counterclockwise spin'],d,'Side view. The contact point slips right, so friction points left. This is not no-slip rolling.',('spin','friction'))


def _corner_cube(p):
    d=_Dia();project=lambda x,y,z:(x+.62*y,z+.42*y)
    for x in (0,2):
        for y in (0,2):d.seg(project(x,y,0),project(x,y,2),eid=f'z{x}{y}')
    for y in (0,2):
        for z in (0,2):d.seg(project(0,y,z),project(2,y,z),eid=f'x{y}{z}')
    for x in (0,2):
        for z in (0,2):d.seg(project(x,0,z),project(x,2,z),eid=f'y{x}{z}')
    O=project(0,0,0);d.pt(*O,'O',kind='point',nid='origin')
    d.arrow(O,project(3,0,0),'x','ax');d.arrow(O,project(0,3,0),'y','ay');d.arrow(O,project(0,0,3),'z','az')
    if not _pr(p):d.arrow(O,project(2,2,2),'(1,1,1)','diagonal')
    return _prepared_drawing('corner_cube','Origin at the corner','Find the principal moments of a uniform cube about a corner.',
       ['each edge has length ℓ; total mass M','0≤x,y,z≤ℓ'],d,'Oblique projection. The body diagonal is a candidate principal axis; do not measure angles from this projection.',('diagonal',))


def _tensor_point(p):
    d = _Dia(); O, P = (0,0), (2.3,1.9)
    d.arrow(O,(3.5,0),"x","axis_x");d.arrow(O,(0,3.6),"z","axis_z")
    d.pt(-.45,-.45,"+y ⊗",nid="axis_y")
    d.pt(*P,"m",kind="circle",nid="mass",w=.28,h=.28)
    d.seg(O,P,eid="position");d.seg((0,1.9),P,eid="height")
    d.seg((2.3,0),P,eid="width")
    d.pt(1.15,-.45,"a");d.pt(-.45,.95,"b")
    if p['view']=='spin' and not _pr(p):
        d.arrow((-.7,1.5),(-.7,3.3),"ω","omega")
        d.pt(2.9,2.4,"v ⊗",nid="velocity")
    if p['view']=='momentum' and not _pr(p):
        d.arrow(O,(-1.9*.95,2.3*.95),"L","L")
    title={'geometry':'Where the mass sits','spin':'Spin about z; motion along y','momentum':'L need not follow the spin axis'}[p['view']]
    step=_hl(S(title,'The page shows x to the right and z upward, so +y points into the page. The mass position is (a,0,b).'), 'omega' if p['view']=='spin' else 'L' if p['view']=='momentum' else 'position')
    return _lesson('tensor_point',title,'A point mass m at (a,0,b) rotates about +z at angular speed ω. Find L about the origin.',
       ['m, a, b, ω are symbolic; positive a and b','a massless support enforces rotation about z'],
       [_ans('Angular momentum',r'\vec L=-mab\omega\hat x+ma^2\omega\hat z')],[step], 'diagram',d.diagram(),
       'Side view: x right, z up; +y is into the page (⊗). Lengths are illustrative.', ['Snapshot at y=0; origin fixed.'])


def _coriolis_direction(p):
    d=_Dia();O=(0,0);P=(2.5,0)
    sg=1 if p['sense']=='ccw' else -1;sv=1 if p['travel']=='out' else -1
    d.arc(O,2.5,0,360,eid='rim')
    d.pt(*O,'Ω ⊙' if sg>0 else 'Ω ⊗',nid='spin')
    d.pt(*P,kind='circle',nid='puck',w=.18,h=.18)
    d.arrow(P,(P[0]+1.2*sv,0),'v','v')
    d.arrow((-2.5,-3.2),(-1.5,-3.2),'x','x_axis');d.arrow((-2.5,-3.2),(-2.5,-2.3),'y','y_axis')
    show=p['view']
    if show!='motion' and not _pr(p):
        sign=sg*sv*(1 if show=='cross' else -1)
        d.arrow(P,(P[0],sign*1.7),'Ω × v' if show=='cross' else 'F_cor','cross' if show=='cross' else 'coriolis')
    title={'motion':'Spin axis and relative velocity','cross':'First: Ω × v','force':'Then reverse it for Coriolis'}[show]
    sgn='-' if sg*sv>0 else '+'
    step=_hl(S(title,'The circle is seen from above. A dot means out of the page; a cross means into it. The velocity is relative to the platform.'),'v' if show=='motion' else 'cross' if show=='cross' else 'coriolis')
    return _lesson('coriolis_direction',title,'Find the Coriolis force for the shown spin and radial relative velocity.',
       ['Ω and v are symbolic magnitudes','top view: x right, y up page, +z out of page'],
       [_ans('Coriolis force',rf'\vec F_{{cor}}={sgn}2m\Omega v\hat y')],[step], 'diagram',d.diagram(),
       'Top view. v is motion relative to the platform; Ω marks the spin axis.', ['Only instantaneous directions are drawn; no simulated trajectory.'])


def _azimuthal_direction(p):
    d=_Dia();O=(0,0);P=(2.4,0);sg=1 if p['change']=='faster' else -1
    d.arc(O,2.4,0,360,eid='rim');d.pt(*O,'α ⊙' if sg>0 else 'α ⊗',nid='alpha')
    d.pt(*P,kind='circle',nid='block',w=.2,h=.2)
    d.seg(O,P,label='ρ',eid='radius')
    d.arrow((-2.5,-3.1),(-1.5,-3.1),'x','x_axis');d.arrow((-2.5,-3.1),(-2.5,-2.2),'y','y_axis')
    if p['view']=='force' and not _pr(p):d.arrow(P,(2.4,-sg*1.6),'F_az','azimuthal')
    title='The platform speeds up' if sg>0 else 'The platform slows down'
    step=_hl(S(title,'α is angular acceleration. At the right-hand point, -mα × r points opposite the platform tangential acceleration.'),'azimuthal' if p['view']=='force' else 'radius')
    return _lesson('azimuthal_direction',title,'Find the azimuthal force on a block fixed at +x on a CCW platform whose spin rate changes.',
       ['r = ρ x̂; ρ symbolic','angular acceleration points '+('out of' if sg>0 else 'into')+' the page','v relative to platform is zero'],
       [_ans('Azimuthal force',rf'\vec F_{{az}}={"-" if sg>0 else "+"}m|\alpha|\rho\hat y')],[step],'diagram',d.diagram(),
       'Top view. α is angular acceleration. F_az is the fictitious azimuthal force.', ['Position and force lengths are illustrative; this is not a trajectory.'])


def _pendulum_car(p):
    """One visual idea per turn, with exact geometry and no generated layout."""
    k, view = p["a_over_g"], p["view"]
    angle = math.degrees(math.atan(k))
    d = _Dia()
    if view == "setup" or _pr(p):
        # The context is intentionally quiet: the string and angle do the work.
        pivot, length = (0.65, 3.4), 2.7
        bob = (pivot[0] - length * math.sin(math.atan(k)), pivot[1] - length * math.cos(math.atan(k)))
        d.poly([(-2.1, 0), (-2.1, 3.4), (2.1, 3.4), (2.1, 0)], "car")
        d.seg((-2.1, 0), (2.1, 0), eid="floor")
        d.pt(*pivot, kind="junction", nid="pivot")
        if not _pr(p):
            d.seg(pivot, bob, eid="string")
            d.pt(*bob, "m", kind="circle", nid="bob", w=.24, h=.24)
            if k:
                d.seg(pivot, (pivot[0], bob[1]-.15), eid="vertical")
                d.arc(pivot, .7, -90, -90-angle, "θ", "theta", label_r=.97)
        if k:
            d.arrow((.45, 4.0), (1.65, 4.0), "a", "car_acceleration")
        title, caption = "The car accelerates right", f"Car frame · illustrative tilt {angle:.1f}°. θ is measured from vertical."
        step = S("Look at the setup", "The car speeds up to the right. The bob rests to the left of its ceiling attachment. θ is the angle between the string and vertical.")
    elif view == "forces":
        # All arrows use one force scale: T = mg(k, 1), mg = mg(0, -1), Ff = mg(-k, 0).
        bob, scale = (0, 0), 1.7
        d.pt(*bob, kind="circle", nid="bob", w=.22, h=.22)
        d.arrow(bob, (scale*k, scale), "T", "T")
        d.arrow(bob, (0, -scale), "mg", "mg")
        if k:
            d.arrow(bob, (-scale*k, 0), "ma", "fict")
        title, caption = "Three forces on the bob", "Car frame: ma is fictitious and points left. Arrow lengths are illustrative."
        step = S("Name the forces", "Tension pulls up and right along the string; weight pulls down. In the car frame add the fictitious force ma to the left. The bob is at rest in this frame.")
    else:
        # Head-to-tail component triangle, angle at the shared origin between T
        # and its vertical component. Only tension appears; no unrelated forces.
        O, height = (0, 0), 2.8
        A, B = (0, height), (height*k, height)
        d.pt(*O, kind="point", nid="bob")
        if k:
            d.arrow(O, B, "T", "T")
            d.arrow(O, A, "T cos θ", "Ty")
            d.arrow(A, B, "T sin θ", "Tx")
            d.right_angle(A, (0, -1), (1, 0), .18)
            d.arc(O, .72, 90-angle, 90, "θ", "theta", label_r=1.01)
        else:
            d.arrow(O, A, "T = T_y", "T")
            d.pt(1.1, 1.4, "T_x = 0")
        title, caption = "Split T from the vertical", "Illustrative triangle. Vertical touches θ: cos. Horizontal is opposite θ: sin."
        step = S("Which side touches θ?", "The angle is between T and vertical. The vertical component is adjacent, so Ty = T cos θ. The horizontal component is opposite, so Tx = T sin θ.")
    payload = d.diagram(pad=.9)
    return _lesson("pendulum_car", title,
                   "A bob of mass m rests on a string in a car accelerating right at a. Find its angle from vertical.",
                   ["a to the right, gravitational acceleration g, mass m (all symbolic)", "steady acceleration; bob at rest in the car frame"],
                   [_ans("Angle from vertical", r"\theta=\arctan(a/g)", units="rad"),
                    _ans("Tension", r"T=m\sqrt{g^2+a^2}", units="N")],
                   [_hl(step, "string" if view == "setup" else "T")], "diagram", payload, caption,
                   ["Massless string; angle follows tan θ = a/g.",
                    f"Drawing only: a/g = {k:g}, tilt {angle:.1f}°. Neither is a supplied problem value.",
                    "Illustrative forces use a common scale in the force view."])


def _accelerating_frame(p):
    k, direction = p["a_over_g"], p["direction"]
    d = _Dia()
    W, H = 5.0, 3.6
    d.poly([(-W / 2, 0), (W / 2, 0), (W / 2, H), (-W / 2, H)], "car", closed=True)
    pivot = (0, H)
    ell = 2.4
    if direction == "horizontal":
        ang = math.degrees(math.atan(k))
        geff = math.hypot(1, k)
        bob = (-ell * math.sin(math.radians(ang)), H - ell * math.cos(math.radians(ang)))
    else:
        ang, geff = 0.0, 1 + k
        bob = (0, H - ell)
    hide_string = _pr(p) and direction == "horizontal"
    d.pt(*pivot, "pendulum hangs here" if hide_string else "", kind="junction", nid="pivot")
    gl = 1.1
    if not hide_string:
        d.seg(pivot, bob, "line", "", "string")
        d.pt(*bob, "m", kind="point", nid="bob")
        d.arrow(bob, (bob[0], bob[1] - gl), "mg", "mg")
    if k > 1e-9 and _pr(p):
        if direction == "horizontal":
            d.arrow((W / 2 + 0.3, H / 2), (W / 2 + 0.3 + 1.1, H / 2), "a", "a")
        else:
            d.arrow((W / 2 + 0.4, H / 2 - 0.5), (W / 2 + 0.4, H / 2 + 0.6), "a", "a")
    elif k > 1e-9:
        if direction == "horizontal":
            d.arrow(bob, (bob[0] - gl * k, bob[1]), "−ma", "fict")
            d.arrow((W / 2 + 0.3, H / 2), (W / 2 + 0.3 + 1.1, H / 2), "a", "a")
        else:
            d.arrow(_add(bob, (0.3, 0)), (bob[0] + 0.3, bob[1] - gl * k), "−ma", "fict")
            d.arrow((W / 2 + 0.4, H / 2 - 0.5), (W / 2 + 0.4, H / 2 + 0.6), "a", "a")
    T = (pivot[0] - bob[0], pivot[1] - bob[1])
    Tm = math.hypot(*T)
    if not _pr(p):
        d.arrow(bob, _add(bob, T, gl * geff / Tm), "T", "T")
    if direction == "horizontal" and ang > 0.5 and not _pr(p):
        d.seg(pivot, (0, H - ell - 0.2), "line", "", "vertical")
        d.arc(pivot, 1.0, -90, -90 - ang, "θ", "theta")
    if direction == "horizontal":
        steps = [_hl(S("Go into the car's frame", r"In the car nothing moves, but the car accelerates at $a$: add a fictitious force $-m\vec a$ to every mass.", show=["labels"]), "fict", "a"),
                 _hl(S("Effective gravity", r"$\vec g_{eff}=\vec g-\vec a$ points down and backward, $g_{eff}=\sqrt{g^2+a^2}$.", show=["labels"]), "mg", "fict"),
                 _hl(S("The string lines up with g_eff", rf"Balance along and across the string: $\tan\theta=a/g$, so θ = {ang:.3g}° here; $T=m\sqrt{{g^2+a^2}}$.", show=["labels"]), "theta", "T")]
        answers = [_ans("Hanging angle", r"\tan\theta=a/g", ang, "deg"), _ans("Tension", r"T=m\sqrt{g^2+a^2}", geff, "mg"),
                   _ans("Small-oscillation period", r"2\pi\sqrt{\ell/g_{eff}}")]
        problem = f"A pendulum hangs in a car accelerating horizontally at a = {k:g}g. Find the angle the string makes with the vertical and the tension."
    else:
        steps = [_hl(S("Go into the lift's frame", r"The lift accelerates up at $a$: the fictitious force $-m\vec a$ points down.", show=["labels"]), "fict", "a"),
                 _hl(S("Effective gravity", r"$g_{eff}=g+a$, straight down: the string stays vertical.", show=["labels"]), "mg", "fict"),
                 _hl(S("Same formulas, new g", r"$T=m(g+a)$ at rest; small swings have period $2\pi\sqrt{\ell/(g+a)}$, shorter than at rest.", show=["labels"]), "T")]
        answers = [_ans("Hanging angle", r"\theta=0", 0, "deg"), _ans("Tension", r"T=m(g+a)", geff, "mg"),
                   _ans("Small-oscillation period", r"2\pi\sqrt{\ell/(g+a)}")]
        problem = f"A pendulum of length ℓ hangs in a lift accelerating upward at a = {k:g}g. Find the tension at rest and the period of small swings."
    return _lesson("accelerating_frame", "Pendulum in an accelerating frame", problem,
                   [f"a = {k:g} g " + ("horizontal" if direction == "horizontal" else "upward"), "string length ℓ, mass m"],
                   answers, steps, "diagram", d.diagram(), "Equal-scale diagram in the accelerating frame; forces on one scale.",
                   ["Massless string; steady acceleration."])


def _rotating_frame(p):
    v, sense = p["v"], p["sense"]
    w, r = 1.0, 2.4
    d = _Dia()
    d.seg((-3.2, 0), (3.6, 0), "line", "", "rod")
    d.pt(-2.6, 0.35, "rod")
    d.pt(0, 0, "axis", kind="junction", nid="O")
    d.arc((0, 0), 0.8, 20, 150, "ω", "spin", arrow=True) if sense == "ccw" else d.arc((0, 0), 0.8, 150, 20, "ω", "spin", arrow=True)
    d.pt(r, 0, "", kind="point", nid="bead")
    if not _pr(p):
        d.arrow((r, 0), (r + 1.1, 0), "mω²r", "centrifugal")
    sgn = 1 if sense == "ccw" else -1
    cor = 2 * w * v                                                  # per unit mass; −2ω×v
    if v > 1e-9:
        d.arrow((r - 1.4, 0.5), (r - 0.5, 0.5), "v (outward)", "v")
        if not _pr(p):
            d.arrow((r, 0), (r, -sgn * min(2.0, 0.6 * cor)), "Coriolis −2mω×v", "coriolis")
            d.arrow((r, 0), (r, sgn * min(2.0, 0.6 * cor)), "N from rod", "N")
    d.arrow((-3.0, -2.2), (-2.2, -2.2), "x", "x_axis")
    d.arrow((-3.0, -2.2), (-3.0, -1.4), "y", "y_axis")
    d.pt(-3.0, -2.2, "z ⊙", kind="point", nid="z")
    side = "−ŷ (to the right of the motion)" if sense == "ccw" else "+ŷ (to the left of the motion)"
    steps = [_hl(S("Fictitious forces in a rotating frame", r"$\vec F_{cf}=-m\vec\omega\times(\vec\omega\times\vec r)$ (outward, $m\omega^2r$) and $\vec F_{cor}=-2m\vec\omega\times\vec v$.", show=["labels"]), "centrifugal"),
             _hl(S("Coriolis by unit vectors", ("$\\vec\\omega=" + ("+" if sgn > 0 else "-") + r"\omega\hat z$, $\vec v=v\hat x$: $-2m\vec\omega\times\vec v=" + ("-" if sgn > 0 else "+") + r"2m\omega v\,\hat y$" + f": along {side}."), show=["labels"]), "coriolis", "v"),
             _hl(S("What the rod does", r"The bead cannot leave the rod sideways, so the rod pushes back with $N=2m\omega v$. Along the rod: $m\ddot r=m\omega^2r$.", show=["labels"]), "N")]
    return _lesson("rotating_frame", "Bead on a rotating rod",
                   f"A frictionless rod turns {('counterclockwise' if sense == 'ccw' else 'clockwise')} at constant ω in a horizontal plane. A bead of mass m slides outward along it at speed v = {v:g} m/s (relative to the rod). In the rod's frame, find the fictitious forces and the sideways force from the rod.",
                   [f"ω = {'+' if sgn > 0 else '−'}ω ẑ", f"v = {v:g} m/s outward along the rod", "no gravity in the plane"],
                   [_ans("Centrifugal", r"m\omega^2 r\ \text{outward}"), _ans("Coriolis", r"-2m\vec\omega\times\vec v", note="along " + side),
                    _ans("Sideways force from the rod", r"N=2m\omega v", cor, "m·ω (per unit mass, ω = 1 s⁻¹)")],
                   steps, "diagram", d.diagram(), "Top view in the rotating frame; z out of the page.", ["Frictionless rod in a horizontal plane."])


def _conical_pendulum_frame(p):
    th, frame = p["theta"], p["frame"]
    t = math.radians(th)
    ell = 3.6
    d = _Dia()
    top = (0, ell * math.cos(t) + 0.3)
    bob = (ell * math.sin(t), 0.3)
    d.seg((-0.8, top[1]), (0.8, top[1]), "line", "", "ceiling")
    d.seg(top, (0, -0.3), "line", "", "axis")
    d.seg(top, bob, "line", "ℓ", "string")
    d.pt(*bob, "m", kind="point", nid="bob")
    d.arc(top, 1.0, -90, -90 + th, "θ", "theta")
    g = 1.4
    d.arrow(bob, (bob[0], bob[1] - g), "mg", "mg")
    Tl = g / math.cos(t)
    if not _pr(p):
        d.arrow(bob, _add(bob, (-math.sin(t), math.cos(t)), Tl), "T", "T")
    d.seg((0, bob[1]), bob, "line", "ℓ sin θ", "radius")
    if _pr(p):
        pass
    elif frame == "rotating":
        d.arrow(bob, (bob[0] + g * math.tan(t), bob[1]), "mω²ℓ sin θ", "cf")
    else:
        d.arrow((bob[0], bob[1] + 0.25), (bob[0] - g * math.tan(t), bob[1] + 0.25), "ma (centripetal)", "ma")
    w2 = 1 / math.cos(t)   # ω² in units g/ℓ
    if frame == "rotating":
        steps = [_hl(S("Rotating frame: the mass is at rest", r"Add the centrifugal force $m\omega^2(\ell\sin\theta)$ outward; then the forces balance.", show=["labels"]), "cf"),
                 _hl(S("Vertical", r"$T\cos\theta=mg$.", show=["labels"]), "T", "mg"),
                 _hl(S("Horizontal", r"$T\sin\theta=m\omega^2\ell\sin\theta$, so $T=m\omega^2\ell$ and $\omega^2=\dfrac{g}{\ell\cos\theta}$.", show=["labels"]), "cf", "T")]
    else:
        steps = [_hl(S("Lab frame: circular motion", r"The mass accelerates toward the axis at $\omega^2\ell\sin\theta$; no fictitious force.", show=["labels"]), "ma"),
                 _hl(S("Vertical", r"$T\cos\theta=mg$.", show=["labels"]), "T", "mg"),
                 _hl(S("Horizontal", r"$T\sin\theta=m\omega^2\ell\sin\theta$, so $\omega^2=\dfrac{g}{\ell\cos\theta}$.", show=["labels"]), "ma", "T")]
    return _lesson("conical_pendulum_frame", "Conical pendulum",
                   "A mass m on a string of length ℓ swings in a horizontal circle with the string at constant angle θ from the vertical. Find ω.",
                   [f"θ = {th}°", "string length ℓ, mass m"],
                   [_ans("ω²", r"\omega^2=\dfrac{g}{\ell\cos\theta}", w2, "g/ℓ"), _ans("Tension", r"T=\dfrac{mg}{\cos\theta}=m\omega^2\ell", 1 / math.cos(t), "mg")],
                   steps, "diagram", d.diagram(), "Equal-scale side view at one instant.", ["Massless string, steady motion."])


BUILDERS = {"trig_components": _trig_components, "incline_gravity": _incline_gravity, "rod_axis": _rod_axis, "beam_release": _beam_release,
            "rolling_shapes": _rolling_shapes, "contact_torque": _contact_torque, "tilted_body_L": _tilted_body_L, "rolling_coin": _rolling_coin,
            "tensor_rotation": _tensor_rotation, "sphere_capture": _sphere_capture, "free_top_axes": _free_top_axes,
            "heavy_top_horizontal": _heavy_top_horizontal, "massive_pulley": _massive_pulley, "sliding_coin": _sliding_coin, "corner_cube": _corner_cube,
            "tensor_point": _tensor_point, "coriolis_direction": _coriolis_direction, "azimuthal_direction": _azimuthal_direction,
            "pendulum_car": _pendulum_car, "accelerating_frame": _accelerating_frame, "rotating_frame": _rotating_frame, "conical_pendulum_frame": _conical_pendulum_frame}


@functools.lru_cache(maxsize=256)
def _built(visual_id: str, frozen: str) -> dict:
    if visual_id.startswith("library:"):
        return visual_library.build(visual_id[len("library:"):])
    params = json.loads(frozen)
    lesson = BUILDERS[visual_id](params)
    steps = lesson["steps"]
    if _pr(params):
        return _practice_view(lesson)
    if params.get("stage", 1) > 1 and steps:
        steps[0]["highlight"] = list(steps[min(params["stage"], len(steps)) - 1]["highlight"])
    return lesson


PRACTICE_STEP = ("Your turn", "The diagram shows the givens and the geometry only. Find the components, forces, directions and results yourself.")


def _practice_view(lesson: dict) -> dict:
    """Keep the problem, givens and drawing; replace the derivation with one neutral step and each result with its name."""
    step = dict(lesson["steps"][0], title=PRACTICE_STEP[0], body=PRACTICE_STEP[1], highlight=[])
    for key in ("prompt", "hint", "result"):
        if key in step:
            step[key] = ""
    lesson["steps"] = [step]
    lesson["answers"] = [dict(a, expression=r"\text{not shown in practice}", value=None, note="") for a in lesson["answers"]]
    lesson["key_ideas"] = []
    if lesson["visualization"]["kind"] == "diagram":
        lesson["visualization"]["caption"] = "Equal-scale diagram of the givens and geometry; the forces, components and results are yours to find."
    scene = lesson["visualization"].get("scene")
    if scene:
        # no force arrows or readouts at the start: the contact forces are part of what the practice asks for
        lesson["steps"][0]["show"] = ["labels"]
        scene["steps"] = [dict(scene["steps"][0], title=PRACTICE_STEP[0], body=PRACTICE_STEP[1], show=["labels"])] if scene.get("steps") else []
        scene["checks"] = [dict(c, label="simulation check") for c in scene.get("checks") or []]
    return lesson


def build_visual(visual_id: str, parameters: dict | None = None) -> dict:
    """A fresh validated tutor lesson for exact registered parameters (InvalidParameters/UnknownVisual otherwise)."""
    params = validate_parameters(visual_id, parameters)
    return copy.deepcopy(_built(visual_id, json.dumps(params, sort_keys=True)))


def describe(visual_id: str, parameters: dict | None = None) -> str:
    """One line for the teacher: the view and its exact parameters."""
    params = validate_parameters(visual_id, parameters)
    spec = VISUALS[visual_id]
    if spec["kind"] == "library":
        return f"Library setup {visual_id[len('library:'):]} (fixed illustrative values)"
    parts = []
    for name, value in params.items():
        ps = spec["parameters"][name]
        if ps["type"] == "choice":
            parts.append(f"{ps['label']}: {next(o['label'] for o in ps['options'] if o['value'] == value)}")
        else:
            parts.append(f"{ps['label']} ={value:g}{(' ' + ps['unit']) if ps['unit'] and ps['unit'] != 'deg' else ('°' if ps['unit'] == 'deg' else '')}")
    return f"{spec['title']}: " + "; ".join(parts)


for _vid, _spec in VISUALS.items():
    if _spec["kind"] == "library":
        _spec["title"] = visual_library.recipe(_vid[len("library:"):])["title"]
