"""Prepared 3D scenes for Daily problems: one authored, exact-source scene per Morin problem.

`content/daily_visuals.json` lists the scenes. A scene is *ready* only when its problem id, catalog title and figure
labels match `daily_problems.json` exactly and its geometry passes the checks below; nothing generic stands in for a
missing scene. `dynamics` is the natural motion of the setup and is always served, so it can be played during the
thinking time; its `answer` part (answer notes and marks) is served only once the book solution has been opened.
Static setups may carry `explore`, a slider over one illustrative value; the scene check must hold across its range.

Integration (other modules own these files):
- daily.candidates(): `p["id"] in daily_visuals.ready_ids()`
- daily.view(): `problem["visual"] = daily_visuals.payload(pid, solution_open)`
- main.py: `app.include_router(daily_visuals.router)`
The browser side is `static/js/daily_visuals.js` (`mountDailyVisual`).

Focus states (`content/focus_states.json`): authored close-up views of one scene (camera framing on named anchors,
overlays such as force arrows and axes, playback). A solution step stores a binding
{step_id, scene_id, scene_revision, focus_state_id} made by bind_focus(); only ids the scene advertises bind, and an
unknown id or a stale revision binds nothing, so the visual stays as it is.
"""
from __future__ import annotations

import copy
import json
import math
import re
from contextlib import closing
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import JSONResponse

CONTENT = Path(__file__).resolve().parent / "content"
router = APIRouter()

SCENES = {"ball_stack", "atwood", "leaning_sticks", "propped_ladder", "spool_thread", "pole_wrap", "ball_wall_block",
          "bead_hoop", "rail_pendulum", "rolling_cone", "ring_in_cone"}
DYNAMICS = {"ball_stack": "elastic_stack", "atwood": "atwood", "ball_wall_block": "ball_wall_block", "bead_hoop": "bead_hoop",
            "rail_pendulum": "rail_pendulum", "rolling_cone": "rolling_cone", "pole_wrap": "pole_wrap", "ring_in_cone": "ring_in_cone"}
# legend swatches: the colour names daily_visuals.js maps to the drawn objects, and the swatch shapes
KEY_COLORS = {"basketball", "tennis", "blue", "sand", "teal", "rose", "steel", "clay", "graphite", "string", "hand", "rough", "glass",
              "velocity", "omega", "applied", "highlight", "weight", "normal", "friction"}
KEY_KINDS = {"body", "dim", "angle", "arrow", "spin", "line", "point"}
KEY_TEXT_MAX = 32
G = 9.81


class SceneError(ValueError):
    pass


def _need(cond: bool, msg: str) -> None:
    if not cond:
        raise SceneError(msg)


def _pos(p: dict, *names: str) -> None:
    for n in names:
        v = p.get(n)
        _need(isinstance(v, (int, float)) and math.isfinite(v) and v > 0, f"{n} must be a positive number")


# ── geometry/physics checks per scene: each returns derived facts the browser and tests can rely on ──────────────────
def _ball_stack(p: dict) -> dict:
    balls = p.get("balls") or []
    _need(len(balls) >= 2, "a stack needs at least two balls")
    _pos(p, "h", "gap")
    for b in balls:
        _pos(b, "r", "m")
    _need(all(a["m"] > b["m"] for a, b in zip(balls, balls[1:])), "masses must decrease up the stack (m1 > m2 > ...)")
    _need(p["gap"] < 0.15 * balls[-1]["r"], "the separating gap must stay small next to the balls")
    bottoms, y = [], p["h"]
    for b in balls:
        bottoms.append(round(y, 6))
        y += 2 * b["r"] + p["gap"]
    return {"bottoms": bottoms, "d": round(bottoms[1] - bottoms[0], 6)}


def _atwood(p: dict) -> dict:
    _pos(p, "support_y", "pulley_r", "m1", "m2", "y1", "y2")
    _need(p.get("pulley_mass", 0) >= 0, "pulley mass cannot be negative")
    cy = p["support_y"] - 0.22
    _need(max(p["y1"], p["y2"]) < cy - 0.2, "masses hang well below the pulley")
    m1, m2, M = p["m1"], p["m2"], p.get("pulley_mass", 0)
    return {"pulley_y": round(cy, 6)}


def _leaning_sticks(p: dict) -> dict:
    _pos(p, "theta", "right_len", "width")
    t = math.radians(p["theta"])
    _need(0 < p["theta"] < 90, "θ must be between 0 and 90 degrees")
    top = (-p["right_len"] * math.cos(t), p["right_len"] * math.sin(t))   # right hinge at x = 0, stick runs up-left
    left_len = p["right_len"] * math.tan(t)
    left_foot = (top[0] - left_len * math.sin(t), 0.0)
    u = (top[0], top[1])
    v = (top[0] - left_foot[0], top[1] - left_foot[1])
    _need(abs(u[0] * v[0] + u[1] * v[1]) < 1e-9, "the sticks must meet at a right angle")
    return {"top": [round(x, 6) for x in top], "left_len": round(left_len, 6), "left_foot": [round(x, 6) for x in left_foot]}


def _propped_ladder(p: dict) -> dict:
    _pos(p, "theta", "L", "l")
    t = math.radians(p["theta"])
    _need(0 < p["theta"] < 90, "θ must be between 0 and 90 degrees")
    contact = p["l"] / math.tan(t)
    _need(0.1 * p["L"] < contact < 0.9 * p["L"], "the stick must meet the ladder between its ends")
    foot = p["l"] / math.sin(t)
    c = (contact * math.cos(t), contact * math.sin(t))
    s = (c[0] - foot, c[1])
    _need(abs(c[0] * s[0] + c[1] * s[1]) < 1e-9, "the stick must be perpendicular to the ladder")
    return {"contact_dist": round(contact, 6), "stick_foot_x": round(foot, 6)}


def _spool_thread(p: dict) -> dict:
    _pos(p, "R", "r", "theta", "width", "pull")
    _need(p["r"] < 0.8 * p["R"], "the axle must be clearly smaller than the rim")
    _need(0 < p["theta"] < 90, "θ must be between 0 and 90 degrees")
    balance = math.degrees(math.acos(p["r"] / p["R"]))
    # the pictured pull must not sit at the equilibrium angle, which would show the answer to (a)
    _need(abs(p["theta"] - balance) > 10, "the illustrative θ is too close to the balancing angle")
    t = math.radians(p["theta"])
    leave = (p["r"] * math.sin(t), p["R"] - p["r"] * math.cos(t))   # tangent point under the axle, centre at (0, R)
    return {"leave": [round(x, 6) for x in leave]}


def _pole_wrap(p: dict) -> dict:
    _pos(p, "r", "R", "hand_dist", "pole_h", "v0_len")
    _need(p["r"] < 0.4 * p["R"], "the pole must be well inside the circle")
    _need(p["hand_dist"] > 1.05 * p["r"], "the hand must be outside the pole")
    # tangent from the mass (on the circle) to the pole: the string touches where radius ⟂ string
    alpha = math.degrees(math.acos(p["r"] / p["R"]))
    beta = math.degrees(math.acos(p["r"] / p["hand_dist"]))
    return {"mass_tangent_offset": round(alpha, 6), "hand_tangent_offset": round(beta, 6)}


def _ball_wall_block(p: dict) -> dict:
    _pos(p, "ball_r", "ball_x", "block_x", "block_size", "m", "M", "mu", "v0")
    _need(p["M"] >= 10 * p["m"], "the book works with M ≫ m; keep M ≥ 10 m")
    _need(p["ball_x"] + p["ball_r"] < p["block_x"] - p["block_size"] / 2, "the ball starts between wall and block")
    # Morin's assumption: the block stops before the ball's next return. Book rule (ε = m/M): the ball leaves at
    # (1 − 2ε)v and the block at 2εv. Check the first bounce, the fastest one.
    eps, v = p["m"] / p["M"], p["v0"]
    stop_t = 2 * eps * v / (p["mu"] * G)
    gap = p["block_x"] - p["block_size"] / 2 - p["ball_r"]
    round_trip = 2 * (gap - p["ball_r"]) / (v * (1 - 2 * eps))
    _need(stop_t < round_trip, "the block must come to rest before the ball returns")
    return {}


def _bead_hoop(p: dict) -> dict:
    _pos(p, "R")
    _need(0 <= p.get("theta0", 0) < 180, "θ0 must be on the hoop")
    return {}


def _rail_pendulum(p: dict) -> dict:
    _pos(p, "M", "m", "l", "rail_half", "rail_y")
    _need(p["rail_y"] - p["l"] > 0.15, "the bob must clear the floor")
    return {}


def _rolling_cone(p: dict) -> dict:
    _pos(p, "alpha", "h")
    _need(0 < p["alpha"] < 60, "α must be between 0 and 60 degrees")
    return {"slant": round(p["h"] / math.cos(math.radians(p["alpha"])), 6)}


def _ring_in_cone(p: dict) -> dict:
    _pos(p, "theta", "h", "r", "cone_h")
    _need(0 < p["theta"] < 70, "θ must be between 0 and 70 degrees")
    _need(p["h"] < 0.9 * p["cone_h"], "the contact circle must lie inside the cone")
    rho = p["h"] * math.tan(math.radians(p["theta"]))
    _need(p["r"] < 0.2 * rho, "the ring must be small next to the circle it rolls on (r ≪ h tan θ)")
    return {"circle_radius": round(rho, 6)}


CHECKS = {"ball_stack": _ball_stack, "atwood": _atwood, "leaning_sticks": _leaning_sticks, "propped_ladder": _propped_ladder,
          "spool_thread": _spool_thread, "pole_wrap": _pole_wrap, "ball_wall_block": _ball_wall_block, "bead_hoop": _bead_hoop,
          "rail_pendulum": _rail_pendulum, "rolling_cone": _rolling_cone, "ring_in_cone": _ring_in_cone}


# What each scene builder can draw in a focus state (static/js/daily_visuals.js must provide the same names).
FOCUS_VOCAB = {"ring_in_cone": {"anchors": {"ring", "contact", "tip"}, "planes": {"contact"},
                                "overlays": {"wall", "vertical", "theta_wall", "radius", "contact_label", "force_mg", "force_N",
                                             "force_F", "axes", "gravity_components", "theta_components"}}}
FOCUS_ID = re.compile(r"^[a-z][a-z0-9_]{1,40}$")
PLAYBACK = {"keep", "frozen", "playing"}


def _check_focus(pid: str, entry: dict, scene: dict) -> dict:
    """One scene's focus registry entry, checked against what its builder can draw."""
    kind = scene["scene"]
    vocab = FOCUS_VOCAB.get(kind)
    _need(vocab is not None, f"{pid}: scene {kind!r} has no focus states")
    _need(entry.get("scene") == kind, f"{pid}: focus states are for {entry.get('scene')!r}, not {kind!r}")
    rev = entry.get("revision")
    _need(type(rev) is int and rev >= 1, f"{pid}: focus revision must be a positive integer")
    states = entry.get("states") or []
    _need(bool(states) and states[0].get("id") == "overview", f"{pid}: the first focus state must be the overview")
    seen, out = set(), []
    for st in states:
        sid = st.get("id")
        _need(isinstance(sid, str) and bool(FOCUS_ID.match(sid)) and sid not in seen, f"{pid}: bad or duplicate focus id {sid!r}")
        seen.add(sid)
        _need(isinstance(st.get("label"), str) and 0 < len(st["label"]) <= 40, f"{pid}/{sid}: label needs 1-40 characters")
        for f in ("shows", "caption"):
            _need(isinstance(st.get(f), str) and 0 < len(st[f]) <= 400, f"{pid}/{sid}: {f} needs 1-400 characters")
        overlays = st.get("overlays")
        _need(isinstance(overlays, list) and set(overlays) <= vocab["overlays"], f"{pid}/{sid}: unknown overlays {overlays}")
        anchors = st.get("anchors") or []
        _need(set(anchors) <= vocab["anchors"], f"{pid}/{sid}: unknown anchors {anchors}")
        cam = st.get("camera") or {}
        if "view" in cam:
            _need(cam["view"] in scene["views"] and set(cam) == {"view"}, f"{pid}/{sid}: camera view must be one of the scene's views")
        else:
            _need(cam.get("plane") in vocab["planes"], f"{pid}/{sid}: camera plane {cam.get('plane')!r} unknown")
            _need(all(isinstance(cam.get(k), (int, float)) for k in ("yaw", "elevation", "margin")), f"{pid}/{sid}: camera needs yaw, elevation, margin")
            _need(-60 <= cam["yaw"] <= 60 and -30 <= cam["elevation"] <= 45 and 1 <= cam["margin"] <= 2, f"{pid}/{sid}: camera angles out of range")
            frame = cam.get("frame") or []
            _need(bool(frame) and set(frame) <= set(anchors) | {"overlays"}, f"{pid}/{sid}: camera frames named anchors and overlays only")
        pb = st.get("playback") or {}
        _need(pb.get("mode") in PLAYBACK, f"{pid}/{sid}: playback mode must be one of {sorted(PLAYBACK)}")
        if pb["mode"] == "frozen":
            _need(isinstance(pb.get("t"), (int, float)) and pb["t"] >= 0, f"{pid}/{sid}: a frozen instant needs t >= 0")
        if st.get("key") is not None:
            _check_key(f"{pid}/{sid}", st["key"])
        out.append({k: copy.deepcopy(st[k]) for k in ("id", "label", "shows", "caption", "anchors", "camera", "overlays", "playback", "key") if k in st})
    return {"scene_id": pid, "scene": kind, "revision": rev, "states": out}


def _catalog() -> dict[str, dict]:
    from .book_library import content_path
    probs = json.loads(content_path('daily_problems.json', CONTENT / 'daily_problems.json').read_text(encoding='utf8'))['problems']
    return {p["id"]: {**p, "title": re.sub(r"\s*[*∗]+\s*$", "", p["title"]).strip()} for p in probs}


def _check_key(pid: str, key) -> None:
    _need(isinstance(key, list) and 1 <= len(key) <= 6, f"{pid}: key needs 1-6 entries")
    for k in key:
        _need(k.get("sym") and k.get("text") and len(k["text"]) <= KEY_TEXT_MAX, f"{pid}: key entry needs sym and a short text: {k}")
        _need(k.get("c") is None or k["c"] in KEY_COLORS, f"{pid}: key colour {k.get('c')!r} unknown")
        _need(k.get("k") is None or k["k"] in KEY_KINDS, f"{pid}: key swatch {k.get('k')!r} unknown")


def _check_explore(e: dict, params: dict, check) -> None:
    _need(isinstance(e.get("param"), str) and e.get("label"), "needs param and label")
    lo, hi, step = e.get("min"), e.get("max"), e.get("step")
    _need(all(isinstance(x, (int, float)) for x in (lo, hi, step)) and lo < hi and 0 < step <= hi - lo, "needs min < max and a step")
    _need(lo <= params.get(e["param"], lo - 1) <= hi, "the authored value must lie in the range")
    n = round((hi - lo) / step)
    for i in range(n + 1):          # every reachable slider value is a valid setup
        check({**params, e["param"]: min(hi, lo + i * step)})


def validate_scene(s: dict, catalog: dict[str, dict]) -> dict:
    """The served descriptor for one manifest entry, or SceneError naming the first mismatch."""
    pid = s.get("problem_id")
    p = catalog.get(pid)
    _need(p is not None, f"{pid}: no such catalog problem")
    _need(s.get("title") == p["title"], f"{pid}: title {s.get('title')!r} does not match the catalog {p['title']!r}")
    figs = {f["label"] for f in p.get("figs", [])}
    _need(set(s.get("figures") or []) <= figs, f"{pid}: figure labels {s.get('figures')} not in the catalog {sorted(figs)}")
    kind = s.get("scene")
    _need(kind in SCENES, f"{pid}: unknown scene {kind!r}")
    _need(isinstance(s.get("caption"), str) and s["caption"].strip(), f"{pid}: caption missing")
    for key in [s.get("key")] + [v.get("key") for v in s.get("variants") or [] if v.get("key")]:
        _check_key(pid, key)
    views = s.get("views") or ["setup"]
    _need(views[0] == "setup" and set(views) <= {"setup", "side", "top"}, f"{pid}: views must start with setup")
    variants = s.get("variants") or []
    try:
        derived = CHECKS[kind](s.get("params") or {})
        for v in variants:
            _need(v.get("id") and v.get("label") and isinstance(v.get("params"), dict), "variant needs id, label and params")
            v["derived"] = CHECKS[kind](v["params"])
    except SceneError as e:
        raise SceneError(f"{pid}: {e}") from None
    _need(len({v["id"] for v in variants}) == len(variants), f"{pid}: duplicate variant ids")
    dyn = s.get("dynamics")
    if dyn is not None:
        _need(DYNAMICS.get(kind) == dyn.get("kind"), f"{pid}: dynamics {dyn.get('kind')!r} is not validated for {kind}")
        _need(isinstance(dyn.get("caption"), str) and dyn["caption"].strip(), f"{pid}: dynamics caption missing")
        _need(0 < dyn.get("speed", 1) <= 2, f"{pid}: playback speed must be in (0, 2]")
        ans = dyn.get("answer")
        _need(ans is None or (isinstance(ans, dict) and isinstance(ans.get("caption"), str) and ans["caption"].strip()),
              f"{pid}: dynamics answer needs a caption")
    for v in variants:
        over = v.get("dynamics_params") or {}
        _need(set(over) <= {"duration"} and all(isinstance(x, (int, float)) and 0 < x <= 30 for x in over.values()),
              f"{pid}/{v['id']}: variant dynamics_params may only set a duration (0-30 s)")
    explore = s.get("explore")
    if explore is not None:
        _need(dyn is None, f"{pid}: explore is for static setups")
        try:
            _check_explore(explore, s.get("params") or {}, CHECKS[kind])
        except SceneError as e:
            raise SceneError(f"{pid}: explore: {e}") from None
    return {"problem_id": pid, "title": p["title"], "chapter": p["chapter"], "section": p["section"],
            "figures": list(s.get("figures") or []), "scene": kind, "caption": s["caption"], "params": s.get("params") or {},
            "illustrative": list(s.get("illustrative") or []), "key": s["key"], "views": views, "derived": derived,
            "variants": [{"id": v["id"], "label": v["label"], "params": v["params"], "derived": v["derived"],
                          "dynamics": bool(v.get("dynamics", dyn is not None)), **({"key": v["key"]} if v.get("key") else {}),
                          **({"dynamics_params": v["dynamics_params"]} if v.get("dynamics_params") else {}),
                          **({"caption": str(v["caption"])} if v.get("caption") else {})}
                         for v in variants],
            **({"explore": explore} if explore else {}), "has_dynamics": dyn is not None, "_dynamics": dyn}


@lru_cache(maxsize=1)
def _load() -> tuple[dict[str, dict], dict[str, str]]:
    from .book_library import content_path
    manifest = json.loads(content_path('daily_visuals.json', CONTENT / 'daily_visuals.json').read_text(encoding='utf8'))
    catalog = _catalog()
    ready, rejected = {}, {}
    for s in manifest.get("scenes", []):
        pid = str(s.get("problem_id"))
        try:
            _need(pid not in ready, f"{pid}: duplicate scene")
            ready[pid] = validate_scene(s, catalog)
        except SceneError as e:
            rejected[pid] = str(e)
    focus_path = content_path('focus_states.json', CONTENT / 'focus_states.json')
    registry = json.loads(focus_path.read_text(encoding="utf-8")).get("scenes", {}) if focus_path.is_file() else {}
    for pid, entry in registry.items():
        if pid not in ready:
            rejected[f"{pid}#focus"] = f"{pid}: focus states for a scene that is not ready"
            continue
        try:
            ready[pid]["focus"] = _check_focus(pid, entry, ready[pid])
        except SceneError as e:
            rejected[f"{pid}#focus"] = str(e)   # the scene itself stays ready, without close-ups
    return ready, rejected


def ready_ids() -> frozenset[str]:
    return frozenset(_load()[0])


def rejected() -> dict[str, str]:
    """Manifest entries that failed validation, with the reason (for tests and diagnostics)."""
    return dict(_load()[1])


def get(pid: str) -> dict | None:
    """The descriptor before the solution: setup, givens and the playable motion, without answer notes."""
    return payload(pid, False)


def payload(pid: str, solution_open: bool) -> dict | None:
    """Always includes the motion needed by Play; `stage` is "answer" (and `dynamics.answer` is present) only once
    the book solution has been opened."""
    s = _load()[0].get(str(pid))
    if s is None:
        return None
    out = copy.deepcopy({k: v for k, v in s.items() if k != "_dynamics"})
    out["stage"] = "answer" if solution_open else "setup"
    if s["_dynamics"] is not None:
        out["dynamics"] = copy.deepcopy({k: v for k, v in s["_dynamics"].items() if solution_open or k != "answer"})
    return out


def focus_menu(pid: str) -> dict | None:
    """What a tutor may choose for a solution step: the scene's advertised focus ids and what each shows."""
    f = (_load()[0].get(str(pid)) or {}).get("focus")
    if not f:
        return None
    return {"scene_id": f["scene_id"], "scene_revision": f["revision"],
            "states": [{"id": s["id"], "label": s["label"], "shows": s["shows"]} for s in f["states"]],
            "instruction": "Set focus_state_id to one of these ids only: the state that pictures what this step teaches "
                           "(usually the geometry first, then the real forces, then the tilted axes, then one component split). "
                           "Use an empty string to leave the visual as it is. The prepared scene changes after your reply."}


def bind_focus(pid: str, focus_state_id, step_id) -> dict | None:
    """The binding persisted with a solution step, or None (unknown id, no focus states, empty choice)."""
    f = (_load()[0].get(str(pid)) or {}).get("focus")
    if not f or not isinstance(focus_state_id, str) or not isinstance(step_id, str) or not step_id:
        return None
    if focus_state_id not in {s["id"] for s in f["states"]}:
        return None
    return {"step_id": step_id[:80], "scene_id": f["scene_id"], "scene_revision": f["revision"], "focus_state_id": focus_state_id}


def valid_binding(pid: str, binding) -> dict | None:
    """A saved binding that still names this scene's current revision and an advertised id."""
    if not isinstance(binding, dict) or binding.get("scene_id") != str(pid):
        return None
    f = (_load()[0].get(str(pid)) or {}).get("focus")
    if not f or binding.get("scene_revision") != f["revision"]:
        return None
    return bind_focus(pid, binding.get("focus_state_id"), binding.get("step_id"))


def focus_report(pid: str, raw) -> dict | None:
    """The browser's report of the focus state actually on screen (window.KinemaFocus.current()), bounded."""
    if not isinstance(raw, dict) or raw.get("displayed") is not True:
        return None
    f = (_load()[0].get(str(pid)) or {}).get("focus")
    if not f or raw.get("scene_id") != str(pid) or raw.get("scene_revision") != f["revision"]:
        return None
    state = next((s for s in f["states"] if s["id"] == raw.get("focus_state_id")), None)
    if state is None:
        return None
    step = raw.get("step_id")
    return {"scene_id": f["scene_id"], "scene_revision": f["revision"], "focus_state_id": state["id"], "label": state["label"],
            "shows": state["shows"], "step_id": step[:80] if isinstance(step, str) else None,
            "manual_camera": raw.get("manual_camera") is True}


def summary() -> list[dict]:
    return [{k: s[k] for k in ("problem_id", "title", "chapter", "section", "figures", "has_dynamics")}
            for s in sorted(_load()[0].values(), key=lambda s: (s["chapter"], s["problem_id"]))]


def _solution_opened(pid: str) -> bool:
    """Answer notes for a Library view. Today's pick follows today's reveal only (a repeat pick must not inherit an
    older day's reveal); any other problem needs its book solution opened on some day. Unreadable state means no."""
    from . import daily
    if daily._db is None:
        return False
    try:
        with closing(daily._db()) as conn:
            today = conn.execute("SELECT problem_id FROM daily_pick WHERE day=?", (daily.day_key(),)).fetchone()
            if today and today[0] == pid:
                row = conn.execute("SELECT 1 FROM daily_state WHERE day=? AND problem_id=? AND solution_ts IS NOT NULL",
                                   (daily.day_key(), pid)).fetchone()
            else:
                row = conn.execute("SELECT 1 FROM daily_state WHERE problem_id=? AND solution_ts IS NOT NULL LIMIT 1", (pid,)).fetchone()
            return row is not None
    except Exception:  # noqa: BLE001 — an unreadable state never unlocks answer notes
        return False


@router.get("/api/daily/visuals")
def api_list():
    return {"scenes": summary()}


@router.get("/api/daily/visuals/{pid}")
def api_scene(pid: str):
    out = payload(pid, _solution_opened(pid))
    if out is None:
        return JSONResponse({"error": "No prepared scene for this problem."}, status_code=404)
    return out
