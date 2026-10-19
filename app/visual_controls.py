"""Bounded live visual parameters: which values of the current teacher artifact may change, the values the student
actually sees, and the teacher's typed edits.

Only two kinds of artifact are editable:
* a plot, by its declared plot.parameters (a numeric range with max > min). An edit is a view command:
  view.parameters + a new view.seq; the browser sets the sliders, redraws and acknowledges that seq.
* a registered guide visual (artifact.guide, app/guide_visuals.py), by the names its metadata lists as editable. An
  edit rebuilds the validated lesson for the new values, so givens and answers are recomputed (new revision).
Anything else (unknown names, wrong types, values out of bounds, non-finite numbers) is refused as a whole and the
previous view stays. The student's own slider values come back in visual_state.parameters and are sanitised here.
"""
from __future__ import annotations

import copy
import math


MAX_EDITS = 8


class EditRefused(ValueError):
    pass


def guide_module():
    """app/guide_visuals.py (owned by the guide content author), or None until it exists."""
    try:
        from . import guide_visuals
    except ImportError:
        return None
    return guide_visuals


def _finite(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _kind(artifact: dict | None) -> str:
    return (((artifact or {}).get("scene") or {}).get("visualization") or {}).get("kind") or "none"


def editable(artifact: dict | None) -> dict[str, dict]:
    """name -> {type, label, symbol, unit, min, max, step, options, initial} for the parameters that may change."""
    if not artifact or artifact.get("status") != "ready":
        return {}
    g = artifact.get("guide")
    if g:
        gv = guide_module()
        meta = (getattr(gv, "VISUALS", {}) or {}).get(g.get("visual_id")) if gv else None
        if not meta:
            return {}
        out = {}
        for name in meta.get("editable") or []:
            spec = (meta.get("parameters") or {}).get(name)
            if not spec:
                continue
            item = {"type": spec.get("type"), "label": spec.get("label") or name, "symbol": spec.get("symbol"),
                    "unit": spec.get("unit") or "", "initial": (g.get("prepared") or g.get("parameters") or {}).get(name, spec.get("default"))}
            if spec.get("type") == "number":
                item.update(min=spec.get("min"), max=spec.get("max"), step=spec.get("step"))
            elif spec.get("type") == "choice":
                item["options"] = [o.get("value") for o in spec.get("options") or []]
            else:
                continue
            out[name] = item
        return out
    if _kind(artifact) == "plot":
        plot = artifact["scene"]["visualization"].get("plot") or {}
        return {p["name"]: {"type": "number", "label": p.get("label") or p["name"], "symbol": None, "unit": p.get("units") or "",
                            "min": p["min"], "max": p["max"], "step": None, "initial": p["value"]}
                for p in plot.get("parameters") or [] if _finite(p.get("min")) and _finite(p.get("max")) and p["max"] > p["min"]}
    return {}


def sanitize(raw, artifact: dict | None) -> dict:
    """The browser's actual values: declared editable names only; numbers finite and clamped; choices from the options."""
    specs = editable(artifact)
    out = {}
    if not isinstance(raw, dict):
        return out
    for name, v in raw.items():
        s = specs.get(name)
        if not s:
            continue
        if s["type"] == "number" and _finite(v):
            out[name] = float(min(s["max"], max(s["min"], v)))
        elif s["type"] == "choice" and isinstance(v, str) and v in s["options"]:
            out[name] = v
    return out


def commanded(artifact: dict | None) -> dict:
    """The values the latest view command (or the prepared scene) puts on screen."""
    specs = editable(artifact)
    vals = {n: s["initial"] for n, s in specs.items()}
    vals.update({k: v for k, v in (((artifact or {}).get("view") or {}).get("parameters") or {}).items() if k in specs})
    return vals


def describe(artifact: dict | None, state: dict | None, in_sync: bool) -> dict | None:
    """For the teacher: each editable parameter with its initial and current (what the student sees) value."""
    specs = editable(artifact)
    if not specs:
        return None
    cmd = commanded(artifact)
    seen = (state or {}).get("parameters") or {}
    rows, changed = [], False
    for name, s in specs.items():
        cur, src = (seen[name], "student's screen") if name in seen else (cmd.get(name), "latest command" if name in ((artifact.get("view") or {}).get("parameters") or {}) else "prepared")
        differs = cur != s["initial"]
        changed |= differs
        rows.append({"name": name, "label": s["label"], "symbol": s.get("symbol"), "unit": s["unit"], "type": s["type"],
                     **({"min": s["min"], "max": s["max"]} if s["type"] == "number" else {"options": s.get("options")}),
                     "prepared": s["initial"], "current": cur, "current_from": src})
    out = {"editable_parameters": rows, "student_moved_sliders": bool((state or {}).get("parameters_changed"))}
    if changed:
        if artifact.get("guide"):
            out["parameters_note"] = ("Values differ from the prepared step: givens and answers in this visual were recomputed for "
                                      "the values the server built; describe the change as an exploration of the same problem.")
        else:
            out["parameters_note"] = ("The student is looking at values other than the prepared ones. Any numeric answer for this "
                                      "problem was worked out for the prepared values and does NOT hold now: reason from the "
                                      "current values or say what changes; never quote the old result as the current one.")
    if not in_sync:
        out["parameters_pending"] = "Your latest parameter command is not confirmed on screen yet."
    return out


def apply_edit(artifact: dict, edits, state: dict | None = None) -> tuple[dict, dict | None]:
    """Validate a teacher edit [{name, value}] and return (view, rebuilt) where rebuilt is None for a plot (view command
    only) or {"scene", "guide"} for a rebuilt guide visual. Raises EditRefused; the artifact itself is never mutated."""
    specs = editable(artifact)
    if not specs:
        raise EditRefused("This view has no adjustable values; the view is unchanged.")
    if not isinstance(edits, list) or not edits:
        raise EditRefused("No values were given; the view is unchanged.")
    if len(edits) > MAX_EDITS:
        raise EditRefused(f"At most {MAX_EDITS} values can change at once; the view is unchanged.")
    wanted = {}
    for e in edits:
        if not isinstance(e, dict) or set(e) != {"name", "value"} or not isinstance(e["name"], str):
            raise EditRefused("Each change must be exactly {name, value}; the view is unchanged.")
        name, value = e["name"], e["value"]
        if name in wanted:
            raise EditRefused(f"'{name}' was given twice; the view is unchanged.")
        s = specs.get(name)
        if not s:
            raise EditRefused(f"'{name}' is not an adjustable value of this view (adjustable: {', '.join(specs)}); the view is unchanged.")
        if s["type"] == "number":
            if isinstance(value, str):
                try:
                    value = float(value)
                except ValueError:
                    pass
            if not _finite(value) or not (s["min"] <= value <= s["max"]):
                raise EditRefused(f"{s['label']} must be a number from {s['min']} to {s['max']}; the view is unchanged.")
            value = float(value)
        elif value not in (s.get("options") or []):
            raise EditRefused(f"{s['label']} must be one of {', '.join(map(str, s.get('options') or []))}; the view is unchanged.")
        wanted[name] = value
    base = commanded(artifact)
    base.update(sanitize((state or {}).get("parameters"), artifact) if state and state.get("artifact_id") == artifact.get("id") else {})
    view = copy.deepcopy(artifact.get("view") or {})
    view["seq"] = int(view.get("seq") or 0) + 1
    view["seek"] = False
    view["parameters_seq"] = view["seq"]     # the browser sets its sliders only for the command that changed them
    if not artifact.get("guide"):
        view["parameters"] = {**base, **wanted}
        return view, None
    g = artifact["guide"]
    gv = guide_module()
    params = {**(g.get("parameters") or {}), **wanted}
    try:
        params = gv.validate_parameters(g["visual_id"], params)
        lesson = gv.build_visual(g["visual_id"], params)
    except (KeyError, ValueError) as exc:
        raise EditRefused(f"That change could not be built ({str(exc)[:160]}); the view is unchanged.") from exc
    view["parameters"] = {k: v for k, v in params.items() if k in specs}
    view["playing"] = False
    view["time"] = 0.0
    return view, {"scene": lesson, "guide": {**g, "parameters": params}}
