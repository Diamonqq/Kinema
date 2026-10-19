"""Kinema — the scene template registry (the ONLY things the model may build).

The model never invents physics: it picks a template, fills its parameters,
and writes the narrated walk-through. The simulation is the template's own
code (static/js/templates/*.js), verified by tests. This registry is the single
source of truth for parameter names, ranges and defaults; the browser reads it
from /api/templates for sliders, the solver prompt is generated from it, and
validate() clamps/repairs what the model returns.

Built around Morin, Introduction to Classical Mechanics, ch. 8 — Angular
momentum, Part I (constant L-hat): planar rigid bodies, moments of inertia,
torque, rolling, collisions, angular impulse.
"""
from __future__ import annotations

import copy
import json
import re

NUM = "number"
ENUM = "enum"

SHAPES = {
    # beta = I / (m R^2) about the centre for the common round bodies
    "solid_cylinder": 0.5, "solid_sphere": 0.4, "hoop": 1.0, "spherical_shell": 2.0 / 3.0,
}

TEMPLATES: dict[str, dict] = {
    "rolling_incline": {
        "title": "Rolling down an incline",
        "section": "8.4 torque · rolling without slipping",
        "summary": "A round body (cylinder, sphere, hoop, shell, or custom I/mR²) rolls without slipping "
                   "down an incline of angle θ. Shows the FBD (mg, N, static friction), a = g sinθ/(1+β), "
                   "the translational/rotational energy split, and the slipping condition μ ≥ tanθ·β/(1+β).",
        "params": {
            "shape": {"type": ENUM, "values": list(SHAPES) + ["custom"], "default": "solid_cylinder", "label": "Shape"},
            "beta": {"type": NUM, "min": 0.0, "max": 2.0, "default": 0.5, "label": "I/(mR²) — custom shape only"},
            "mass": {"type": NUM, "min": 0.01, "max": 200, "default": 1.0, "unit": "kg", "label": "Mass"},
            "radius": {"type": NUM, "min": 0.01, "max": 3, "default": 0.2, "unit": "m", "label": "Radius"},
            "angle": {"type": NUM, "min": 1, "max": 85, "default": 30, "unit": "°", "label": "Incline angle θ"},
            "length": {"type": NUM, "min": 0.5, "max": 50, "default": 4, "unit": "m", "label": "Incline length"},
            "mu": {"type": NUM, "min": 0, "max": 3, "default": 1.0, "label": "Static friction μ (1 = plenty)"},
            "g": {"type": NUM, "min": 0.1, "max": 30, "default": 9.8, "unit": "m/s²", "label": "g"},
        },
        "answers": {"acceleration": "m/s²", "time_to_bottom": "s", "v_bottom": "m/s", "omega_bottom": "rad/s",
                    "friction_force": "N", "ke_rot_fraction": "", "min_mu": ""},
    },
    "atwood_pulley": {
        "title": "Atwood machine with a massive pulley",
        "section": "8.4 torque · pulley with rotational inertia",
        "summary": "Two hanging masses over a pulley of moment of inertia I = β·M_p R² (no slipping of the "
                   "string). The two tensions differ; a = (m1−m2) g / (m1+m2+β M_p). Shows T1, T2, the "
                   "pulley's angular acceleration and L about the axle.",
        "params": {
            "m1": {"type": NUM, "min": 0.01, "max": 200, "default": 3.0, "unit": "kg", "label": "m₁ (left)"},
            "m2": {"type": NUM, "min": 0.01, "max": 200, "default": 2.0, "unit": "kg", "label": "m₂ (right)"},
            "pulley_mass": {"type": NUM, "min": 0.0, "max": 200, "default": 2.0, "unit": "kg", "label": "Pulley mass"},
            "pulley_beta": {"type": NUM, "min": 0.0, "max": 1.0, "default": 0.5, "label": "Pulley I/(MR²) (disk = ½)"},
            "radius": {"type": NUM, "min": 0.02, "max": 2, "default": 0.15, "unit": "m", "label": "Pulley radius"},
            "drop": {"type": NUM, "min": 0.1, "max": 20, "default": 2.0, "unit": "m", "label": "Distance to fall"},
            "g": {"type": NUM, "min": 0.1, "max": 30, "default": 9.8, "unit": "m/s²", "label": "g"},
        },
        "answers": {"acceleration": "m/s²", "T1": "N", "T2": "N", "alpha": "rad/s²", "time_to_drop": "s",
                    "v_after_drop": "m/s"},
    },
    "spool_pull": {
        "title": "Spool pulled by a string (yo-yo on a table)",
        "section": "8.4 torque · which way does it roll",
        "summary": "A spool (outer radius R, string wound on inner radius r, I = β m R²) rests on a rough "
                   "floor and is pulled with tension T at angle φ above horizontal. Rolling without slipping, "
                   "a = T (R cosφ − r) / (m R (1+β)) — it rolls TOWARD the pull when cosφ > r/R and away "
                   "when cosφ < r/R (the string 'winds up'); the critical angle has cosφ = r/R.",
        "params": {
            "mass": {"type": NUM, "min": 0.01, "max": 100, "default": 1.0, "unit": "kg", "label": "Mass"},
            "R": {"type": NUM, "min": 0.02, "max": 2, "default": 0.3, "unit": "m", "label": "Outer radius R"},
            "r": {"type": NUM, "min": 0.01, "max": 2, "default": 0.15, "unit": "m", "label": "Inner (string) radius r"},
            "beta": {"type": NUM, "min": 0.05, "max": 1.0, "default": 0.5, "label": "I/(mR²)"},
            "tension": {"type": NUM, "min": 0, "max": 500, "default": 2.0, "unit": "N", "label": "Tension T"},
            "phi": {"type": NUM, "min": 0, "max": 90, "default": 20, "unit": "°", "label": "String angle φ above floor"},
            "mu": {"type": NUM, "min": 0, "max": 3, "default": 1.0, "label": "Static friction μ"},
            "g": {"type": NUM, "min": 0.1, "max": 30, "default": 9.8, "unit": "m/s²", "label": "g"},
        },
        "answers": {"acceleration": "m/s²", "friction_force": "N", "critical_angle": "°", "direction": ""},
    },
    "falling_rod": {
        "title": "Rod pivoted at one end, released",
        "section": "8.4 torque · rotation about a fixed pivot",
        "summary": "A uniform rod of length L pivoted at one end is released from rest at angle θ₀ above "
                   "horizontal (or vertical) and swings down. α = (3g/2L) cosθ, ω(θ) from energy, the "
                   "pivot force components, and the point beyond 2L/3 whose acceleration exceeds g at the "
                   "horizontal position.",
        "params": {
            "mass": {"type": NUM, "min": 0.01, "max": 100, "default": 1.0, "unit": "kg", "label": "Mass"},
            "length": {"type": NUM, "min": 0.05, "max": 10, "default": 1.0, "unit": "m", "label": "Length L"},
            "theta0": {"type": NUM, "min": -89, "max": 89, "default": 0, "unit": "°", "label": "Release angle above horizontal"},
            "g": {"type": NUM, "min": 0.1, "max": 30, "default": 9.8, "unit": "m/s²", "label": "g"},
        },
        "answers": {"alpha_release": "rad/s²", "omega_bottom": "rad/s", "tip_speed_bottom": "m/s",
                    "pivot_force_bottom": "N", "a_tip_release": "m/s²", "free_fall_point": "m"},
    },
    "ball_stick": {
        "title": "Ball hits a free stick on a frictionless table",
        "section": "8.5 collisions · linear + angular momentum",
        "summary": "A ball (mass m, speed v) hits a free uniform stick (mass M, length L) at distance d from "
                   "its centre, perpendicular to it — elastic, or the ball sticks. Conserves p, L about the "
                   "stick's CM (and energy if elastic); afterwards the stick translates AND rotates. Shows "
                   "the instantaneous centre and where the stick's end moves.",
        "params": {
            "ball_mass": {"type": NUM, "min": 0.01, "max": 100, "default": 0.5, "unit": "kg", "label": "Ball mass m"},
            "ball_speed": {"type": NUM, "min": 0.01, "max": 100, "default": 4.0, "unit": "m/s", "label": "Ball speed v"},
            "stick_mass": {"type": NUM, "min": 0.01, "max": 100, "default": 1.0, "unit": "kg", "label": "Stick mass M"},
            "stick_length": {"type": NUM, "min": 0.05, "max": 10, "default": 1.0, "unit": "m", "label": "Stick length L"},
            "hit_offset": {"type": NUM, "min": -5, "max": 5, "default": 0.3, "unit": "m", "label": "Hit distance d from centre"},
            "collision": {"type": ENUM, "values": ["elastic", "sticks"], "default": "elastic", "label": "Collision"},
        },
        "answers": {"ball_v_after": "m/s", "stick_vcm": "m/s", "stick_omega": "rad/s", "ke_lost_fraction": "",
                    "instant_centre": "m"},
    },
    "struck_ball": {
        "title": "Cue ball struck: slip, then roll",
        "section": "8.6 angular impulse · friction brings rolling",
        "summary": "A solid ball on a rough table receives a horizontal impulse P at height h above the "
                   "centre. Immediately v₀ = P/m and ω₀ = 5Ph/(2mR²); it rolls without slipping at once "
                   "only if h = 2R/5 (7R/5 above the table). Otherwise kinetic friction acts until v = ωR; "
                   "shows the transition time, the final speed and the energy lost.",
        "params": {
            "mass": {"type": NUM, "min": 0.01, "max": 10, "default": 0.17, "unit": "kg", "label": "Mass"},
            "radius": {"type": NUM, "min": 0.005, "max": 1, "default": 0.03, "unit": "m", "label": "Radius R"},
            "impulse": {"type": NUM, "min": 0.001, "max": 100, "default": 0.5, "unit": "N·s", "label": "Impulse P"},
            "h": {"type": NUM, "min": -1, "max": 1, "default": 0.0, "unit": "m", "label": "Height of blow above centre"},
            "mu": {"type": NUM, "min": 0.0, "max": 2, "default": 0.2, "label": "Kinetic friction μ"},
            "g": {"type": NUM, "min": 0.1, "max": 30, "default": 9.8, "unit": "m/s²", "label": "g"},
        },
        "answers": {"v0": "m/s", "omega0": "rad/s", "t_roll": "s", "v_final": "m/s", "ke_lost_fraction": "",
                    "h_for_pure_roll": "m"},
    },
    "disk_on_disk": {
        "title": "Spinning disk dropped onto a disk",
        "section": "8.5 collisions · angular momentum about a fixed axis",
        "summary": "A disk with I₁ spinning at ω₁ is dropped onto a coaxial disk with I₂ (at rest, or spinning "
                   "at ω₂). Friction between them brings a common ω = (I₁ω₁ + I₂ω₂)/(I₁+I₂); angular momentum "
                   "about the axle is conserved, kinetic energy is not.",
        "params": {
            "I1": {"type": NUM, "min": 0.001, "max": 100, "default": 0.5, "unit": "kg·m²", "label": "I₁ (top)"},
            "omega1": {"type": NUM, "min": -200, "max": 200, "default": 10, "unit": "rad/s", "label": "ω₁"},
            "I2": {"type": NUM, "min": 0.001, "max": 100, "default": 1.0, "unit": "kg·m²", "label": "I₂ (bottom)"},
            "omega2": {"type": NUM, "min": -200, "max": 200, "default": 0, "unit": "rad/s", "label": "ω₂"},
            "coupling_time": {"type": NUM, "min": 0.05, "max": 10, "default": 1.5, "unit": "s", "label": "Time to lock together"},
        },
        "answers": {"omega_final": "rad/s", "ke_lost": "J", "ke_lost_fraction": "", "L_total": "kg·m²/s"},
    },
    "physical_pendulum": {
        "title": "Physical pendulum",
        "section": "8.4 torque · small oscillations of a rigid body",
        "summary": "A rigid body (rod, disk, or custom I about the pivot) swings about a pivot a distance d "
                   "from its centre of mass. τ = −m g d sinθ, small-angle period T = 2π√(I/(m g d)), plus the "
                   "full nonlinear motion from any release angle.",
        "params": {
            "body": {"type": ENUM, "values": ["rod_end", "rod_custom", "disk_rim", "custom"], "default": "rod_end", "label": "Body"},
            "mass": {"type": NUM, "min": 0.01, "max": 100, "default": 1.0, "unit": "kg", "label": "Mass"},
            "size": {"type": NUM, "min": 0.05, "max": 10, "default": 1.0, "unit": "m", "label": "Length (rod) or radius (disk)"},
            "d": {"type": NUM, "min": 0.001, "max": 10, "default": 0.5, "unit": "m", "label": "Pivot to CM (rod_custom/custom)"},
            "I_pivot": {"type": NUM, "min": 0.0001, "max": 1000, "default": 0.333, "unit": "kg·m²", "label": "I about pivot (custom)"},
            "theta0": {"type": NUM, "min": 1, "max": 175, "default": 30, "unit": "°", "label": "Release angle"},
            "g": {"type": NUM, "min": 0.1, "max": 30, "default": 9.8, "unit": "m/s²", "label": "g"},
        },
        "answers": {"period_small": "s", "omega_bottom": "rad/s", "I_pivot": "kg·m²", "equivalent_length": "m"},
    },
    "ball_leaves_sphere": {
        "title": "Ball rolling off a fixed sphere",
        "section": "8.7 problems · leaving the sphere",
        "summary": "A small ball (radius r, I = β m r²) starts at rest at the top of a fixed sphere of radius R "
                   "and rolls without slipping. It leaves the surface where N = 0: cosθ = 2/(3+β)... for a "
                   "point mass 2/3, for a solid ball 10/17. Shows N(θ), the energy split and the launch.",
        "params": {
            "R": {"type": NUM, "min": 0.1, "max": 10, "default": 1.0, "unit": "m", "label": "Sphere radius R"},
            "r": {"type": NUM, "min": 0.005, "max": 1, "default": 0.1, "unit": "m", "label": "Ball radius r"},
            "beta": {"type": NUM, "min": 0.0, "max": 1.0, "default": 0.4, "label": "I/(mr²) (0 = point mass)"},
            "nudge": {"type": NUM, "min": 0.001, "max": 1, "default": 0.02, "unit": "m/s", "label": "Initial nudge"},
            "g": {"type": NUM, "min": 0.1, "max": 30, "default": 9.8, "unit": "m/s²", "label": "g"},
        },
        "answers": {"cos_theta_leave": "", "theta_leave": "°", "v_leave": "m/s", "height_leave": "m"},
    },
    "moment_of_inertia": {
        "title": "Moment of inertia explorer",
        "section": "8.3 calculating moments of inertia · parallel & perpendicular axis",
        "summary": "A rod, disk, ring, rectangle, sphere or shell with a movable axis: shows I about the "
                   "centre, the parallel-axis theorem I = I_cm + m h², and for flat bodies the "
                   "perpendicular-axis theorem I_z = I_x + I_y. No motion — a calculator with a picture.",
        "params": {
            "shape": {"type": ENUM, "values": ["rod", "disk", "ring", "rectangle", "solid_sphere", "spherical_shell"],
                      "default": "rod", "label": "Shape"},
            "mass": {"type": NUM, "min": 0.01, "max": 1000, "default": 2.0, "unit": "kg", "label": "Mass"},
            "a": {"type": NUM, "min": 0.01, "max": 10, "default": 1.0, "unit": "m", "label": "Length / radius / width a"},
            "b": {"type": NUM, "min": 0.01, "max": 10, "default": 0.5, "unit": "m", "label": "Height b (rectangle)"},
            "axis": {"type": ENUM, "values": ["centre_perp", "end_perp", "centre_inplane", "custom_offset"],
                     "default": "centre_perp", "label": "Axis"},
            "offset": {"type": NUM, "min": 0, "max": 10, "default": 0.0, "unit": "m", "label": "Axis offset h from CM"},
        },
        "answers": {"I_cm": "kg·m²", "I_axis": "kg·m²", "I_end": "kg·m²"},
    },
    "static_diagram": {
        "title": "Static labelled diagram (no simulation)",
        "section": "fallback",
        "summary": "When no template fits: the model supplies a labelled SVG (viewBox 0 0 800 500) of the "
                   "setup with vectors and given quantities. Clearly marked as not simulated.",
        "params": {},
        "answers": {"value": ""},
        "svg": True,
    },
}

STEP_SHOWS = ["diagram", "fbd", "components", "vectors", "energy", "graphs", "trail", "labels"]

# The JSON the model must return (used for --output-schema and for validate()).
# STRICT structured-output rules (OpenAI rejects anything else — live 2026-09-04): every object lists
# ALL its properties in `required` and has additionalProperties:false, so free-form maps are not
# allowed — params is therefore a LIST of {name, value} pairs (validate() folds it into a dict).
_STEP = {
    "type": "object", "additionalProperties": False,
    "required": ["title", "body", "show", "at", "highlight"],
    "properties": {
        "title": {"type": "string"},
        "body": {"type": "string", "description": "markdown with $...$ / $$...$$ LaTeX"},
        "show": {"type": "array", "items": {"type": "string", "enum": STEP_SHOWS}},
        "at": {"type": ["number", "null"], "description": "seconds into the motion to pause at, or null"},
        "highlight": {"type": "array", "items": {"type": "string"},
                      "description": "quantity keys to glow in the diagram, e.g. friction, N, L, omega"}}}
_PARAM = {
    "type": "object", "additionalProperties": False, "required": ["name", "value"],
    "properties": {"name": {"type": "string", "description": "a parameter name of the chosen template"},
                   "value": {"type": ["number", "string"], "description": "number (SI) or the enum word"}}}
SCENE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["template", "title", "restatement", "params", "givens", "unknowns", "steps", "answer", "svg", "notes"],
    "properties": {
        "template": {"type": "string", "enum": list(TEMPLATES)},
        "title": {"type": "string"},
        "restatement": {"type": "string", "description": "the problem in one or two plain sentences"},
        "params": {"type": "array", "items": _PARAM},
        "givens": {"type": "array", "items": {"type": "string"}},
        "unknowns": {"type": "array", "items": {"type": "string"}},
        "steps": {"type": "array", "items": _STEP},
        "answer": {"type": "object", "additionalProperties": False,
                   "required": ["key", "value", "units", "expression", "note"],
                   "properties": {"key": {"type": "string"}, "value": {"type": ["number", "null"]},
                                  "units": {"type": "string"}, "expression": {"type": "string"},
                                  "note": {"type": "string"}}},
        "svg": {"type": "string", "description": "static_diagram only; empty string otherwise"},
        "notes": {"type": "string"},
    },
}


def params_to_dict(raw) -> dict:
    """Accept the strict list form [{name, value}] or a plain dict."""
    if isinstance(raw, dict):
        return dict(raw)
    out: dict = {}
    if isinstance(raw, list):
        for item in raw:
            if isinstance(item, dict) and "name" in item:
                out[str(item["name"])] = item.get("value")
    return out


def registry_json() -> dict:
    return {"templates": TEMPLATES, "step_shows": STEP_SHOWS, "shapes": SHAPES}


_ASCII = str.maketrans({"°": " deg", "²": "^2", "³": "^3", "β": "beta", "θ": "theta", "φ": "phi", "ω": "omega",
                        "μ": "mu", "τ": "tau", "α": "alpha", "ρ": "rho", "√": "sqrt", "−": "-", "·": ".", "×": "x",
                        "≥": ">=", "≤": "<=", "→": "->", "…": "...", "₁": "1", "₂": "2", "—": "-", "–": "-", "’": "'"})


def ascii_safe(s: str) -> str:
    """The model's prompt goes through the CLI's stdin pipe; non-ASCII arrived mojibake'd and the model echoed
    it back into titles (live 2026-09-04: '30Â°'). Everything the model reads is plain ASCII."""
    return s.translate(_ASCII).encode("ascii", "ignore").decode("ascii")


def prompt_catalog() -> str:
    """The template catalogue as the model sees it (generated, never hand-copied). ASCII only."""
    return ascii_safe(_prompt_catalog())


def _prompt_catalog() -> str:
    out = []
    for tid, t in TEMPLATES.items():
        out.append(f"### {tid} — {t['title']}  [{t['section']}]\n{t['summary']}")
        if t["params"]:
            ps = []
            for k, p in t["params"].items():
                if p["type"] == ENUM:
                    ps.append(f"  - {k}: one of {p['values']} (default {p['default']}) — {p.get('label', '')}")
                else:
                    ps.append(f"  - {k}: number {p['min']}..{p['max']} {p.get('unit', '')} (default {p['default']}) — {p.get('label', '')}")
            out.append("params:\n" + "\n".join(ps))
        out.append("answer keys: " + ", ".join(f"{k} [{u}]" if u else k for k, u in t["answers"].items()))
        out.append("")
    return "\n".join(out)


_SVG_BAD = re.compile(r"<\s*(script|foreignObject|iframe|object|embed)[^>]*>.*?<\s*/\s*\1\s*>|on\w+\s*=\s*(\"[^\"]*\"|'[^']*')|javascript:",
                      re.I | re.S)


def sanitize_svg(svg: str) -> str:
    s = _SVG_BAD.sub("", svg or "")
    return s[:60000]


def validate(scene: dict) -> tuple[dict, list[str]]:
    """Repair what the model returned into something the templates will run:
    unknown template → static_diagram; unknown params dropped; numbers clamped
    into range (each clamp is a warning the UI shows); enums coerced to default;
    steps trimmed; the answer key checked against the template's keys."""
    warnings: list[str] = []
    s = copy.deepcopy(scene) if isinstance(scene, dict) else {}
    tid = str(s.get("template") or "")
    if tid not in TEMPLATES:
        warnings.append(f"unknown template {tid!r} — showing a static diagram")
        tid = "static_diagram"
    t = TEMPLATES[tid]
    s["template"] = tid
    s["title"] = str(s.get("title") or t["title"])[:160]
    raw = params_to_dict(s.get("params"))
    params: dict = {}
    for k, spec in t["params"].items():
        v = raw.get(k, spec["default"])
        if spec["type"] == ENUM:
            if v not in spec["values"]:
                if k in raw:
                    warnings.append(f"{k}: {v!r} is not one of {spec['values']} — using {spec['default']}")
                v = spec["default"]
            params[k] = v
        else:
            try:
                fv = float(v)
            except (TypeError, ValueError):
                warnings.append(f"{k}: {v!r} is not a number — using {spec['default']}")
                fv = float(spec["default"])
            if fv < spec["min"] or fv > spec["max"]:
                cl = min(max(fv, spec["min"]), spec["max"])
                warnings.append(f"{k}: {fv:g} clamped to {cl:g} (allowed {spec['min']}..{spec['max']})")
                fv = cl
            params[k] = fv
    for k in raw:
        if k not in t["params"]:
            warnings.append(f"{k}: not a parameter of {tid} — dropped")
    s["params"] = params
    s["givens"] = [str(x)[:200] for x in (s.get("givens") or [])][:20]
    s["unknowns"] = [str(x)[:200] for x in (s.get("unknowns") or [])][:10]
    s["restatement"] = str(s.get("restatement") or "")[:600]
    steps = []
    for st in (s.get("steps") or [])[:14]:
        if not isinstance(st, dict):
            continue
        show = [x for x in (st.get("show") or []) if x in STEP_SHOWS]
        at = st.get("at")
        try:
            at = None if at is None else max(0.0, float(at))
        except (TypeError, ValueError):
            at = None
        steps.append({"title": str(st.get("title") or "Step")[:120], "body": str(st.get("body") or "")[:4000],
                      "show": show, "at": at,
                      "highlight": [str(x)[:40] for x in (st.get("highlight") or [])][:6]})
    if not steps:
        warnings.append("no steps returned — a single 'Setup' step was added")
        steps = [{"title": "Setup", "body": s.get("restatement") or "", "show": ["diagram"], "at": None, "highlight": []}]
    s["steps"] = steps
    ans = s.get("answer") if isinstance(s.get("answer"), dict) else {}
    key = str(ans.get("key") or "")
    if key not in t["answers"] and key != "other":
        warnings.append(f"answer key {key!r} is not one of {list(t['answers'])} — treated as 'other'")
        key = "other"
    try:
        val = None if ans.get("value") is None else float(ans.get("value"))
    except (TypeError, ValueError):
        val = None
    s["answer"] = {"key": key, "value": val, "units": str(ans.get("units") or t["answers"].get(key, ""))[:30],
                   "expression": str(ans.get("expression") or "")[:400], "note": str(ans.get("note") or "")[:400]}
    if t.get("svg"):
        s["svg"] = sanitize_svg(str(s.get("svg") or ""))
        if not s["svg"].strip():
            warnings.append("static_diagram without an svg")
    else:
        s.pop("svg", None)
    s["notes"] = str(s.get("notes") or "")[:2000]
    return s, warnings


def schema_file_text() -> str:
    return json.dumps(SCENE_SCHEMA, indent=1)
