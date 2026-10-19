"""Teacher artifacts: one validated native visual per thread, its view, and what the student actually sees.

An artifact's scene is always a lesson that passed tutor.validate (the same contract the native renderers draw).
The teacher may switch layers/camera that exist for that visual kind and play, pause or seek a moving scene; it never
edits physics. Every teacher view command gets a sequence number; what the tutor is told comes from the browser's
report for that artifact, revision and view sequence (rendered, open, playing, time), so it cannot say a scene is
moving while it is preparing, paused, or before the student's view has applied the command.
"""
from __future__ import annotations

import copy
import math
import uuid

from . import rigid3d, scenes, tutor, visual_controls

CAMERAS = ["hero", "side", "top", "follow", "closeup"]
LAYERS = {"rigid3d": list(rigid3d.OVERLAYS), "mechanics": list(scenes.STEP_SHOWS)}
# What each rigid3d layer draws, so the teacher never presents one axis as another.
LAYER_MEANINGS = {"axis": "the body's own symmetry axis e3 (along a rod's length); not the pin/rotation axis unless they coincide",
                  "vertical": "the upward vertical +z through the pivot", "principal_axes": "principal axes e1 e2 e3 at the centre of mass",
                  "omega": "angular velocity vector (lies along the instantaneous rotation axis; zero length when at rest)",
                  "L": "angular momentum vector", "torque": "net torque vector about the pivot/CM", "weight": "gravity at the CM",
                  "contact": "support/contact force",
                  "gravity_torque": "gravity torque about the pivot as a cross product: r (cyan, pivot to CM), F = Mg (coral, at the CM), "
                                    "tau = r x F (violet, drawn from the pivot) on a faint r-F plane with its rotation sense; "
                                    "not the net torque (that is the 'torque' layer); tau = 0 when gravity's line passes through the pivot",
                  "trace": "path of the body tip", "cm_velocity": "CM velocity", "labels": "text labels",
                  "references": "the labelled teaching geometry in model.references (e.g. the pin axis, origin, x, a slice dm)",
                  "world_axes": "the problem's fixed world x, y, z (z up), labelled x y z, at model.frames.origin; they do not turn",
                  "body_axes": "body-attached axes x' y' z' (the body frame the parts are given in), turning with the body, same origin "
                               "as world_axes; NOT necessarily principal axes (that is the separate principal_axes layer)",
                  "axes": "in-plane x (right) and y (up) at the world origin (0, 0); z points out of the screen"}


def _id() -> str:
    return "v" + uuid.uuid4().hex[:10]


def default_view(scene: dict | None) -> dict:
    v = (scene or {}).get("visualization") or {}
    show = []
    if v.get("kind") == "rigid3d":
        show = list((v.get("rigid3d") or {}).get("show") or [])
    first = ((scene or {}).get("steps") or [{}])[0]
    return {"show": [s for s in (first.get("show") or show) if s in LAYERS.get(v.get("kind"), [])][:8],
            "focus": "", "playing": False, "time": 0.0, "seek": False, "seq": 0,
            "camera": first.get("camera") if first.get("camera") in CAMERAS else "hero", "focus_state_id": ""}


def focus_ids(artifact: dict | None) -> list[str]:
    """Focus states a native visual advertises (visualization.focus_states: [{id, label, ...}]). The same contract as
    prepared scenes (daily_visuals.bind_focus): a teacher may only pick one of these ids; anything else changes nothing."""
    v = ((artifact or {}).get("scene") or {}).get("visualization") or {}
    states = v.get("focus_states") if isinstance(v.get("focus_states"), list) else []
    return [s["id"] for s in states if isinstance(s, dict) and isinstance(s.get("id"), str)][:24]


def make(scene: dict, *, title: str, caption: str, revision: int, problem_id: str | None = None,
         view: dict | None = None) -> dict:
    """A ready artifact around an already validated lesson."""
    return {"id": _id(), "revision": revision, "title": title[:120], "problem_id": problem_id, "scene": scene,
            "caption": caption[:600], "view": view or default_view(scene), "status": "ready", "error": None}


def preparing(*, title: str, request: str, revision: int, problem_id: str | None = None) -> dict:
    return {"id": _id(), "revision": revision, "title": title[:120], "problem_id": problem_id, "scene": None,
            "caption": request[:600], "view": default_view(None), "status": "preparing", "error": None}


def kind(artifact: dict | None) -> str:
    return (((artifact or {}).get("scene") or {}).get("visualization") or {}).get("kind") or "none"


def duration(artifact: dict | None) -> float | None:
    """Seconds of motion the native view can play, or None for a still visual."""
    v = ((artifact or {}).get("scene") or {}).get("visualization") or {}
    if v.get("kind") == "rigid3d":
        spec = v.get("rigid3d") or {}
        return float(spec["duration"]) if (spec.get("motion") or {}).get("type") != "static" and spec.get("duration") else None
    if v.get("kind") == "mechanics":
        d = (v.get("scene") or {}).get("duration")
        return float(d) if d else None
    return None


def apply_view(artifact: dict, proposed: dict, state: dict | None = None) -> tuple[dict | None, str | None]:
    """A teacher view command validated against this artifact's real layers, cameras and motion.

    Returns (view, note). Unchanged playback is kept, so a layer change never pauses a playing scene. "play" is refused
    for a still visual or when the student uses reduced motion; time seeks within the scene. Each command bumps seq so
    the browser's acknowledgement can be matched to it."""
    if not artifact or artifact.get("status") != "ready":
        return None, None
    allowed = LAYERS.get(kind(artifact), [])
    view = {**default_view(artifact.get("scene")), **(artifact.get("view") or {})}
    # "show" is the complete layer list: [] clears every overlay; a list of only unknown names changes nothing.
    raw_show = proposed.get("show")
    if isinstance(raw_show, list):
        show = [s for s in raw_show if isinstance(s, str) and s in allowed]
        if show or not raw_show:
            view["show"] = list(dict.fromkeys(show))[:8]
    fid = proposed.get("focus_state_id")
    if isinstance(fid, str) and fid in focus_ids(artifact):
        view["focus_state_id"] = fid
    if proposed.get("camera") in CAMERAS and kind(artifact) in ("rigid3d", "mechanics"):
        view["camera"] = proposed["camera"]
    focus = proposed.get("focus")
    if isinstance(focus, str):
        view["focus"] = focus.strip()[:80]
    note = None
    dur = duration(artifact)
    playback = proposed.get("playback")
    if playback == "play":
        if dur is None:
            note = "This view is a still picture; there is no motion to play."
        elif (state or {}).get("reduced_motion"):
            note = "The student uses reduced motion, so the view stays paused; describe still frames."
            view["playing"] = False
        else:
            view["playing"] = True
    elif playback == "pause":
        view["playing"] = False
    t = proposed.get("time")
    view["seek"] = False
    if dur is not None and isinstance(t, (int, float)) and not isinstance(t, bool) and math.isfinite(t):
        view["time"], view["seek"] = round(min(dur, max(0.0, float(t))), 3), True
    view["seq"] = int(view.get("seq") or 0) + 1
    return view, note


def sanitize_state(raw, artifact: dict | None) -> dict | None:
    """The browser's report of the visual. Ignored unless it names the current artifact and revision."""
    if not isinstance(raw, dict) or not artifact:
        return None
    if raw.get("artifact_id") != artifact["id"] or raw.get("revision") != artifact["revision"]:
        return None
    def num(key, lo, hi):
        v = raw.get(key)
        return float(min(hi, max(lo, v))) if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) else None
    allowed = LAYERS.get(kind(artifact), [])
    return {"artifact_id": artifact["id"], "revision": artifact["revision"],
            "rendered": raw.get("rendered") is True, "open": raw.get("open") is True,
            "closed_by_user": raw.get("closed_by_user") is True, "playing": raw.get("playing") is True,
            "time": num("time", 0.0, 3600.0), "speed": num("speed", 0.0, 10.0),
            "camera": raw.get("camera") if raw.get("camera") in CAMERAS and (raw.get("camera") != "closeup" or kind(artifact) in ("rigid3d", "mechanics")) else None,
            "show": [s for s in (raw.get("show") or []) if isinstance(s, str) and s in allowed][:13],
            "reduced_motion": raw.get("reduced_motion") is True,
            # The actual slider/choice values on screen (declared editable names only, clamped).
            "parameters": visual_controls.sanitize(raw.get("parameters"), artifact),
            "parameters_changed": raw.get("parameters_changed") is True,
            # the focus state the browser reports as displayed (window.KinemaFocus.current()), advertised ids only
            "focus_state_id": raw.get("focus_state_id") if raw.get("focus_state_id") in focus_ids(artifact) else None,
            "view_seq": raw.get("view_seq") if isinstance(raw.get("view_seq"), int) and not isinstance(raw.get("view_seq"), bool) else None}


def in_sync(artifact: dict | None, state: dict | None) -> bool:
    """The browser has applied the artifact's latest view command (a report without view_seq counts only for seq 0)."""
    if not artifact or not state:
        return False
    return int(state.get("view_seq") or 0) == int((artifact.get("view") or {}).get("seq") or 0)


def describe(artifact: dict | None, state: dict | None, problem_key: str | None = None) -> dict | None:
    """Compact, factual description of the visual for the tutor: status, what is actually visible, its givens."""
    if not artifact:
        return None
    out = {"artifact_id": artifact["id"], "revision": artifact["revision"], "title": artifact["title"],
           "status": artifact["status"], "caption": artifact.get("caption"), "kind": kind(artifact),
           "matches_current_problem": artifact.get("problem_id") == problem_key}
    if artifact["status"] != "ready":
        out["note"] = ("The visual is still being prepared; do not describe it as visible." if artifact["status"] == "preparing"
                       else "The visual failed: " + str(artifact.get("error") or "unknown error"))
        return out
    scene = artifact["scene"] or {}
    out["givens"] = scene.get("givens") or []
    out["assumptions"] = scene.get("assumptions") or []
    out["allowed_layers"] = LAYERS.get(kind(artifact), [])
    out["allowed_cameras"] = CAMERAS if kind(artifact) in ("rigid3d", "mechanics") else []
    out["motion_seconds"] = duration(artifact)
    fids = focus_ids(artifact)
    if fids:
        out["allowed_focus_states"] = fids
    if kind(artifact) == "rigid3d":
        out["layer_meanings"] = {k: v for k, v in LAYER_MEANINGS.items() if k in out["allowed_layers"]}
    if kind(artifact) == "rigid3d":
        spec = scene["visualization"]["rigid3d"]
        out["model"] = {"parts": [{k: p.get(k) for k in ("id", "shape", "mass", "center", "axis", "radius", "length", "size", "prop")} for p in spec["body"]["parts"]],
                        "motion": {k: spec["motion"].get(k) for k in ("type", "pivot", "pivot_world", "support", "theta_deg", "phi_deg", "precession_rate", "spin_rate", "omega")},
                        "angle_convention": "motion.theta_deg is the tilt of the body symmetry axis from upward vertical +z (the renderer's theta arc "
                                            "when axis and vertical layers show). Convert a problem angle measured another way; do not reuse its label.",
                        "duration_s": spec["duration"], "colours": "omega violet, L blue, net torque magenta, weight red, normal green, friction orange; gravity_torque layer: r cyan, F coral, tau = r x F violet"}
        # The validated teaching geometry the "references" layer draws, so the teacher can name what is on screen.
        refs = [{k: r.get(k) for k in ("kind", "label", "point", "direction", "frame", "length")} for r in (spec.get("references") or [])]
        if refs:
            out["model"]["references"] = refs
            out["model"]["reference_meanings"] = {
                "axis": "a labelled axis line through point along direction (frame world = fixed, body = turns with the body)",
                "origin": "the origin point used for the coordinates (drawn only while the view is still)",
                "coordinate": "a coordinate direction from point, of this length (drawn only while the view is still)",
                "slice": "a thin slice dm of the body at point (drawn only while the view is still)",
                "distance": "the perpendicular distance from point to the first axis reference, measured by the app; drawn with its "
                            "symbol only (no number), only while the view is still"}
        out["model"]["frames"] = frames(spec)
        gt = gravity_torque_start(spec)
        if gt and "gravity_torque" in out["allowed_layers"]:
            out["model"]["gravity_torque"] = gt
        if spec["motion"].get("support") == "pivot" and spec["motion"].get("type") != "free":
            out["model"]["framing"] = ("While the view is still, a body swinging below its pivot is framed at its current pose; the first "
                                       "time it plays, the camera widens once to the whole swing. A camera the student moved stays put.")
    if state:
        seq = int((artifact.get("view") or {}).get("seq") or 0)
        out["student_view"] = {"rendered": state["rendered"], "open": state["open"], "closed_by_user": state["closed_by_user"],
                               "motion": ("playing" if state["playing"] else "paused") + (f" at t = {state['time']:.2f} s" if state["time"] is not None else ""),
                               "camera": state["camera"], "visible_layers": state["show"], "reduced_motion": state["reduced_motion"],
                               "applied_latest_command": in_sync(artifact, state)}
        if state.get("focus_state_id"):
            out["student_view"]["focus_state_id"] = state["focus_state_id"]
        if state.get("camera") == "closeup":
            out["student_view"]["framing_note"] = "Close-up of the focus body. Other apparatus may be outside the pane; do not claim the whole setup is visible. Full setup framing remains available."
        refs_drawn = ((scene.get("visualization") or {}).get("rigid3d") or {}).get("references") or []
        if state["playing"] and "references" in state["show"]:
            hidden = [r.get("label") for r in refs_drawn if r.get("kind") in STILL_ONLY_REFERENCES and r.get("label")]
            if hidden:
                out["student_view"]["hidden_while_playing"] = hidden
        if not in_sync(artifact, state):
            out["student_view"]["note"] = (f"Your latest view command (#{seq}) is not confirmed on screen yet: say what you are "
                                           "switching to, but do not describe its resulting motion or layers as seen.")
    else:
        out["student_view"] = {"rendered": False, "note": "No rendering acknowledgement yet: say the view is opening; do not say 'look at'."}
    params = visual_controls.describe(artifact, state, in_sync(artifact, state))
    if params:
        out.update(params)
    if artifact.get("guide"):
        g = artifact["guide"]
        out["guide_visual"] = {"session_id": g.get("session_id"), "step_id": g.get("step_id"), "visual_id": g.get("visual_id"),
                               "parameters": g.get("parameters")}
    out["teacher_view"] = artifact.get("view")
    return out


# ── gravity torque as a cross product (the rigid3d "gravity_torque" layer), described from the model itself ──────────
STILL_ONLY_REFERENCES = {"slice", "distance", "coordinate", "origin"}   # rigid3d_view.js STILL_ONLY
SIDE_FROM = (0.12, -1.0, 0.4)        # where the side camera looks from, world z up (rigid3d_view.js cams.side)
HERO_FROM = (0.8, -1.3, 0.65)        # the usual hero direction (rigid3d_view.js heroDir default)


def _mm(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]


def _mv(a, v):
    return [sum(a[i][k] * v[k] for k in range(3)) for i in range(3)]


def _cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def _unit(v):
    n = math.sqrt(sum(x * x for x in v))
    return [x / n for x in v] if n > 0 else [0.0, 0.0, 0.0]


def _align(a, b):
    """The minimal rotation taking unit a onto unit b (rigid3d.js alignRotation)."""
    a, b = _unit(a), _unit(b)
    c = sum(x * y for x, y in zip(a, b))
    if c > 1 - 1e-12:
        return [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
    if c < -1 + 1e-12:
        axis, ang = _cross(a, [1, 0, 0] if abs(a[0]) < 0.9 else [0, 1, 0]), math.pi
    else:
        axis, ang = _cross(a, b), math.acos(max(-1.0, min(1.0, c)))
    x, y, z = _unit(axis)
    co, si, C = math.cos(ang), math.sin(ang), 1 - math.cos(ang)
    return [[co + x * x * C, x * y * C - z * si, x * z * C + y * si], [y * x * C + z * si, co + y * y * C, y * z * C - x * si],
            [z * x * C - y * si, z * y * C + x * si, co + z * z * C]]


def gravity_torque_start(spec: dict) -> dict | None:
    """r, F = Mg and tau = r x F about the pivot at the start, in world axes, as the gravity_torque layer draws them.

    The same start orientation as rigid3d.js simulate: R0 = Rz(phi + 90°)·Rx(theta)·align(symmetry axis → z). Only for a
    body on a pivot (a ground contact point moves; a free body has no pivot to take the torque about)."""
    m, body = spec.get("motion") or {}, spec.get("body") or {}
    parts = body.get("parts") or []
    if m.get("support") != "pivot" or m.get("type") == "free" or not parts:
        return None
    M = sum(float(p["mass"]) for p in parts)
    cm = [sum(float(p["mass"]) * float(p["center"][i]) for p in parts) / M for i in range(3)]
    pb = list(m.get("pivot") or cm)
    th, ph = math.radians(m.get("theta_deg") or 0), math.radians(m.get("phi_deg") or 0)
    a = ph + math.pi / 2
    Rz = [[math.cos(a), -math.sin(a), 0], [math.sin(a), math.cos(a), 0], [0, 0, 1]]
    Rx = [[1, 0, 0], [0, math.cos(th), -math.sin(th)], [0, math.sin(th), math.cos(th)]]
    R0 = _mm(_mm(Rz, Rx), _align(body.get("symmetry_axis") or [0, 0, 1], [0, 0, 1]))
    r = _mv(R0, [cm[i] - pb[i] for i in range(3)])
    g = float(spec.get("gravity") or 0)
    F = [0.0, 0.0, -M * g]
    tau = _cross(r, F)
    mag = math.sqrt(sum(x * x for x in tau))
    zero = mag <= 1e-6 * max(1e-9, M * g * math.sqrt(sum(x * x for x in r)))

    def rnd(v):
        return [round(x, 4) + 0.0 for x in v]

    def facing(frm):
        if zero:
            return "none: no arrow is drawn; the glyph at the pivot reads 'τ = 0'"
        c = sum(x * y for x, y in zip(_unit(frm), _unit(tau)))
        return "toward the viewer" if c > 0.3 else "away from the viewer" if c < -0.3 else "across the screen"
    level = [r[0], r[1], 0.0]
    if zero or math.hypot(level[0], level[1]) < 1e-9:
        hero = HERO_FROM
    else:   # rigid3d_view.js heroDir: 0.55 level r + 0.6 up + 0.7 tau (three's y-up written here in z-up world axes)
        hero = [0.55 * u + 0.7 * t for u, t in zip(_unit(level), _unit(tau))]
        hero[2] += 0.6
    return {"frame": "world axes, right-handed: x and y horizontal, z up. r starts at the pivot (motion.pivot_world).",
            "r": "pivot → centre of mass (cyan arrow, true length)",
            "F": "F = Mg: weight, straight down (−z), applied at the centre of mass (coral arrow, fixed display length)",
            "tau": "τ = r × F, gravity's torque about the pivot (violet arrow from the pivot, length ∝ |τ|). Not the net torque: "
                   "that is the 'torque' layer (dL/dt). The shaded parallelogram spans r and F (its area is |τ|); a curved arrow "
                   "shows the turning sense when the body starts from rest.",
            "at_start": {"r_m": rnd(r), "F_N": rnd(F), "tau_Nm": rnd(tau), "tau_mag_Nm": round(mag, 4), "zero": zero},
            "on_screen_text": {"key": ["r  pivot → centre of mass", "F = Mg  weight, at the centre of mass", "τ = r × F  gravity torque about the pivot"],
                               "glyphs": "r, F and τ beside their arrow tips; 'τ ⊙ toward you' or 'τ ⊗ away from you' when the camera looks "
                                         "along τ; 'τ = 0' at the pivot when gravity's line passes through it"},
            "tau_at_start_in_view": {"hero": facing(hero), "side": facing(SIDE_FROM)}}


# ── native starter: uniform rod pivoting about one end (the 2301 beam quiz) ──────────────────────────────────────
ROD_L, ROD_M, ROD_R, G = 1.0, 1.0, 0.02, 9.8
# Presentation version of the native starters. Bump it when a starter's views change but its physics does not, so a thread
# already holding the older starter artifact is upgraded in place (upgrade_starter) instead of keeping the old drawing.
STARTER_VERSION = 2


def frames(spec: dict) -> dict:
    """Where the world_axes / body_axes layers are drawn, as the renderer draws them (no physics)."""
    m = spec.get("motion") or {}
    held = "the pivot" if m.get("support") == "pivot" else "the reference point"
    held = held.removeprefix("the ")
    point = f"the {held} (body point motion.pivot)" if m.get("pivot") is not None else "the centre of mass"
    return {"origin": list(m.get("pivot_world") or [0, 0, 0]),
            "origin_is": f"{point} at its starting position motion.pivot_world" if m.get("pivot") is None
                         else f"{point} at motion.pivot_world",
            "world_axes": "fixed x, y horizontal and z up (right-handed), labelled x y z, at origin: the problem's own frame; "
                          "they neither turn nor move",
            "body_axes": f"x' y' z' along the body-frame x, y, z in which the parts are given, drawn at {point.replace('the ', 'the moving ', 1)} "
                         "(it coincides with the world origin while that point stays fixed, e.g. a fixed pivot); they turn and travel "
                         "with the body. Not necessarily principal axes; e3 (the 'axis' layer) is body.symmetry_axis, which may differ from z'"}


def rod_lesson() -> dict:
    """Illustrative M = 1 kg, ell = 1 m. The browser engine integrates the swing itself (heavy_top about the end)."""
    i_end = ROD_M * ROD_L ** 2 / 3 + ROD_M * ROD_R ** 2 / 4
    spec = {"gravity": G, "duration": 2.0, "ground": False,
            "body": {"label": "uniform rod", "symmetry_axis": [0, 0, 1], "parts": [
                {"id": "rod", "shape": "cylinder", "mass": ROD_M, "center": [0, 0, ROD_L / 2], "axis": [0, 0, 1],
                 "radius": ROD_R, "length": ROD_L, "size": None, "color": "steel"}]},
            "motion": {"type": "heavy_top", "pivot": [0, 0, 0], "pivot_world": [0, 0, 1.2], "support": "pivot",
                       "theta_deg": 90, "phi_deg": 0, "precession_rate": 0, "spin_rate": 0, "nutation_rate": 0,
                       "axis": None, "omega": None, "impulse": None},
            "show": ["references", "labels"],
            # Teaching geometry (rigid3d.py references): the real rotation axis is the pin (world y, perpendicular to
            # the rod); one slice dm at x along the rod, whose distance the app measures itself. Drawn only while still.
            "references": [
                {"kind": "axis", "label": "pin axis", "point": [0, 0, 0], "direction": [0, 1, 0], "frame": "world", "length": 0.4},
                {"kind": "slice", "label": "dm", "point": [0, 0, round(ROD_L * 0.7, 3)], "direction": [0, 0, 1], "frame": "body", "length": 0.04},
                {"kind": "distance", "label": "x", "point": [0, 0, round(ROD_L * 0.7, 3)], "direction": None, "frame": "body", "length": None}],
            "checks": [{"label": "I about the end = Mℓ²/3 (+ tiny thickness term)", "quantity": "I_pivot_perp", "at": None, "expect": i_end, "tol_pct": 1},
                       {"label": "pivot to CM = ℓ/2", "quantity": "cm_distance", "at": None, "expect": ROD_L / 2, "tol_pct": 1},
                       {"label": "gravity torque at release = Mgℓ/2", "quantity": "gravity_torque_mag", "at": 0, "expect": ROD_M * G * ROD_L / 2, "tol_pct": 2}]}
    S = tutor._step
    lesson = tutor._lesson(
        "Mechanics · fixed-axis rotation (Morin ch. 8)", "Uniform rod released about one end",
        "A uniform rod of mass M and length ℓ rests horizontally on supports at both ends. The right support is removed. "
        "Find (a) the moment of inertia about the left end, (b) the force from the left support just after release, "
        "and (c) the angular momentum L about the left end when the rod hangs vertically.",
        ["Uniform rod, mass M, length ℓ", "Pivots freely about its left end", "Released from rest, horizontal", "Gravity g downward"],
        [{"label": "(a) Moment of inertia about the end", "expression": r"I_{\text{end}}=\tfrac13 M\ell^2", "value": None, "units": "kg·m²", "note": "Four times the centre value Mℓ²/12."},
         {"label": "(b) Left support force just after release", "expression": r"F=\tfrac14 Mg\ \text{(upward)}", "value": None, "units": "N", "note": "From α = 3g/(2ℓ) and Mg − F = M·(ℓ/2)α."},
         {"label": "(c) Angular momentum when vertical", "expression": r"L=I\omega=\tfrac13M\ell^2\sqrt{3g/\ell}", "value": None, "units": "kg·m²/s", "note": "ω from energy: Mgℓ/2 = ½Iω²."}],
        # Three distinct teaching views: Inertia (still: pin axis, one dm and its distance x), Torque direction (still:
        # r, F and r × F with the r-F plane and rotation sense) and Motion (the same vectors while the rod swings; the
        # still-only geometry hides itself while moving). The "axis" layer is the rod's own long axis e3, so it stays off.
        [S("Inertia: axis, dm and x", r"The rotation axis is the pin: horizontal, through the left end, perpendicular to the rod and to the "
           r"plane it swings in. It is not the rod's own long axis. Measure $x$ along the rod from the pin. A slice of length $dx$ "
           r"has $dm=\tfrac{M}{\ell}\,dx$ and is a distance $x$ from the pin axis.",
           show=["references", "labels"], camera="side"),
         S("Integrate", r"About the pin axis: $I=\int_0^\ell x^2\,\tfrac{M}{\ell}\,dx=\tfrac{M}{\ell}\cdot\tfrac{\ell^3}{3}=\tfrac13M\ell^2$.",
           show=["references", "labels"], camera="side"),
         S("Torque direction: r × F", r"Gravity $\vec F=M\vec g$ acts at the centre; $\vec r$ runs from the pin to the centre, $|\vec r|=\ell/2$. "
           r"$\vec\tau=\vec r\times\vec F$ is perpendicular to both (the shaded plane), along the pin axis, with size $Mg\tfrac\ell2$ "
           r"because $\vec r\perp\vec F$ at release. Curl the fingers of your right hand from $\vec r$ to $\vec F$: the thumb gives $\vec\tau$, "
           r"and the rod turns the way the fingers curl.",
           at=0, show=["gravity_torque", "labels"], camera="hero"),
         S("Motion: τ as it swings", r"While the rod swings, $\vec r$ turns with it but $\vec F$ stays straight down, so $|\vec\tau|=Mg\tfrac\ell2\sin\theta$ "
           r"shrinks and reaches $0$ when the rod hangs straight down: then gravity's line passes through the pin.",
           show=["gravity_torque", "labels"], camera="hero"),
         S("Support force", r"At release $\alpha=\tau/I=\tfrac{3g}{2\ell}$. The centre accelerates down at $a=\tfrac\ell2\alpha=\tfrac34g$, "
           r"so $Mg-F=\tfrac34Mg$ and $F=\tfrac14Mg$.",
           at=0, show=["weight", "contact", "labels"], camera="side"),
         S("Swing to vertical", r"Energy: $Mg\tfrac\ell2=\tfrac12I\omega^2$ gives $\omega=\sqrt{3g/\ell}$; then $L=I\omega$.",
           at=0.48, show=["omega", "L", "labels"], camera="side")],
        "rigid3d", spec,
        "Rod pinned at its left end (pin axis horizontal, perpendicular to the rod and its swing plane), held horizontal at the moment the right support is removed. Illustrative M = 1 kg, ℓ = 1 m; the app integrates the swing.",
        ["Thin uniform rod (drawn with a 2 cm radius); frictionless pivot.", "Illustrative values for the model: M = 1 kg, ℓ = 1 m."],
        plan="Find I about the end by integrating, use τ = r × F and τ = Iα at release for the support force, then energy for ω at the bottom.")
    validated, _ = tutor.validate(copy.deepcopy(lesson))
    return validated


STARTERS = {"starter:rod": {"title": "Rod about one end", "course": "2301", "lesson": rod_lesson, "version": STARTER_VERSION,
                            "opening": (
                                "**Problem.** A uniform rod (mass $M$, length $\\ell$) lies on supports at both ends. "
                                "The right support is removed.\n\n"
                                "**What we find, and why**\n\n"
                                "- $I$ about the left end: every later part uses it.\n"
                                "- The left support's force just after release: the torque $\\vec\\tau=\\vec r\\times\\vec F$ gives $\\alpha$, then Newton's law for the centre.\n"
                                "- The angular momentum $L$ when the rod hangs straight down: energy gives $\\omega$, then $L=I\\omega$.\n\n"
                                "**Recipe for $I$**\n\n"
                                "1. Choose the rotation axis and put the origin on it (here: the pin at the left end, "
                                "perpendicular to the rod, not along it).\n"
                                "2. Write $dm$ for a thin slice.\n"
                                "3. Find that slice's distance from the axis.\n"
                                "4. Integrate $r^2\\,dm$ over the body.\n\n"
                                "The rod view is held still at the release position (paused). "
                                "Tell me if you want the whole worked example, or try steps 2 and 3 in words first.")}}
COURSE_STARTER = {"2301": "starter:rod"}


def starter_artifact(problem_id: str, revision: int) -> dict:
    """A native starter's artifact, stamped with the starter identity and presentation version (see upgrade_starter)."""
    st = STARTERS[problem_id]
    lesson = st["lesson"]()
    art = make(lesson, title=st["title"], caption=lesson["visualization"]["caption"], revision=revision, problem_id=problem_id)
    art["starter"] = {"id": problem_id, "version": st["version"]}
    return art


def _physics(scene: dict | None) -> dict | None:
    """The physical model of a rigid3d scene, without presentation (colours, layers, teaching references, checks)."""
    spec = ((scene or {}).get("visualization") or {}).get("rigid3d")
    if not spec:
        return None
    parts = [{k: v for k, v in p.items() if k != "color"} for p in spec["body"]["parts"]]
    return {"gravity": spec.get("gravity"), "duration": spec.get("duration"), "ground": spec.get("ground"),
            "parts": parts, "motion": spec.get("motion"), "symmetry_axis": spec["body"].get("symmetry_axis")}


def upgrade_starter(t: dict) -> bool:
    """Presentation-only upgrade of a thread's native starter artifact to the current STARTER_VERSION.

    Only the artifact the starter's own opening message showed (its visual_action.artifact_id), still current and still
    bound to that starter, with an identical physical model, is replaced; a later generated artifact never is. Messages,
    evidence, the current step and the problem stay as they are. The artifact keeps its id, gets a new revision (so the
    browser reloads the scene and re-acknowledges) and the same view with the next view seq; a student's closed pane stays
    closed. Returns whether anything changed."""
    art = t.get("artifact")
    if not art or art.get("status") != "ready":
        return False
    pid = art.get("problem_id")
    st = STARTERS.get(pid or "")
    if not st or t.get("problem_id") != pid or int((art.get("starter") or {}).get("version") or 1) >= st["version"]:
        return False
    opening = next((m for m in t.get("messages") or [] if m.get("kind") == "opening"
                    and (m.get("visual_action") or {}).get("artifact_id") == art["id"]), None)
    if not opening or (art.get("starter") or {}).get("id", pid) != pid or art.get("title") != st["title"]:
        return False
    lesson = st["lesson"]()
    if _physics(lesson) != _physics(art.get("scene")):
        return False
    old_view = dict(art.get("view") or default_view(lesson))
    allowed = LAYERS.get(kind({"scene": lesson}), [])
    view = {**old_view, "show": [s for s in old_view.get("show") or [] if s in allowed][:8], "seq": int(old_view.get("seq") or 0) + 1}
    art.update(scene=lesson, caption=lesson["visualization"]["caption"][:600], view=view, revision=int(art["revision"]) + 1,
               starter={"id": pid, "version": st["version"]})
    vs = t.get("visual_state")
    if vs and vs.get("artifact_id") == art["id"]:
        # Not rendered yet at the new revision; the student's closed choice carries over to it.
        t["visual_state"] = {**vs, "revision": art["revision"], "view_seq": view["seq"], "rendered": False,
                             "open": bool(vs.get("open")) and not vs.get("closed_by_user")}
    return True
