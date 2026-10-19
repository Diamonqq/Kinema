"""Morin visual library: reusable props, problem families and prepared, validated setups.

GET /api/visual-library             → {version, props, families, recipes, coverage}
GET /api/visual-library/recipes/{id} → {recipe, lesson}; unknown id → 404
The teacher opens a recipe as problem_id "library:<id>" (app/teacher.py). Lessons come from deterministic builders
(app/visual_library_recipes.py) and pass tutor.validate without repairs; no provider is called. Responses carry no paths.
"""
from __future__ import annotations

import copy
import functools
import json
from contextlib import closing
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from . import tutor, visual_library_recipes

CATALOG_PATH = Path(__file__).resolve().parent / "content" / "visual_library.json"
PREFIX = "library:"
PUBLIC_KEYS = ("version", "props", "families", "recipes", "coverage")


class UnknownRecipe(ValueError):
    pass


@functools.lru_cache(maxsize=1)
def _catalog() -> dict:
    return json.loads(CATALOG_PATH.read_text(encoding="utf-8"))


def catalog() -> dict:
    """The public catalog (the per-problem index stays server-side)."""
    return copy.deepcopy({k: _catalog()[k] for k in PUBLIC_KEYS})


def recipe_ids() -> list[str]:
    return [r["id"] for r in _catalog()["recipes"]]


def recipe(rid: str) -> dict:
    for r in _catalog()["recipes"]:
        if r["id"] == rid and rid in visual_library_recipes.BUILDERS:
            return copy.deepcopy(r)
    raise UnknownRecipe(f"Unknown visual library recipe: {rid}")


@functools.lru_cache(maxsize=64)
def _built(rid: str) -> tuple[dict, tuple[str, ...]]:
    lesson, warnings = tutor.validate(copy.deepcopy(visual_library_recipes.BUILDERS[rid]()))
    return lesson, tuple(warnings)


def build(rid: str) -> dict:
    """The validated lesson for an exact registered id (a fresh copy)."""
    recipe(rid)
    return copy.deepcopy(_built(rid)[0])


def build_checked(rid: str) -> tuple[dict, list[str]]:
    recipe(rid)
    lesson, warnings = _built(rid)
    return copy.deepcopy(lesson), list(warnings)


def parse_problem_id(problem_id: str | None) -> str | None:
    """'library:<id>' → '<id>' (exact registered ids only); anything else → None."""
    if not isinstance(problem_id, str) or not problem_id.startswith(PREFIX):
        return None
    rid = problem_id[len(PREFIX):]
    recipe(rid)
    return rid


def context_list(course_id: str | None = None) -> list[dict]:
    """Compact listing for the teacher: what it can open without a fresh build."""
    out = []
    for r in _catalog()["recipes"]:
        if course_id and r.get("course_id") != course_id:
            continue
        out.append({"problem_id": PREFIX + r["id"], "title": r["title"], "chapters": r["chapters"], "kind": r["kind"],
                    "physics_status": r["physics_status"], "in_exam_scope": r["in_exam_scope"],
                    "refs": [s["problem"] for s in r["source_refs"][:3]]})
    return out


def describe_recipe(rid: str) -> dict:
    r = recipe(rid)
    return {k: r[k] for k in ("id", "title", "chapters", "kind", "physics_status", "motion", "coordinate_frame", "in_exam_scope", "source_refs")}


router = APIRouter()


@router.get("/api/visual-library")
def api_catalog():
    return catalog()


@router.get("/api/visual-library/recipes/{rid}")
def api_recipe(rid: str):
    try:
        return {"recipe": recipe(rid), "lesson": build(rid)}
    except UnknownRecipe as e:
        return JSONResponse({"error": str(e)}, status_code=404)


@router.get("/api/visual-library/graphs/{tid}")
def saved_graph(tid: str):
    """Read only a saved graph's drawing data; browsing never opens its thread."""
    from . import learn_api

    with closing(learn_api._db()) as conn:
        row = conn.execute("SELECT state FROM teacher_threads WHERE id=?", (tid,)).fetchone()
    try:
        state = json.loads(row[0]) if row else {}
    except (ValueError, TypeError):
        state = {}
    if not isinstance(state, dict):
        state = {}
    for key in ("artifact", "previous_artifact"):
        artifact = state.get(key) or {}
        if not isinstance(artifact, dict):
            continue
        scene = artifact.get("scene") or {}
        if not isinstance(scene, dict):
            continue
        visual = scene.get("visualization") or {}
        if not isinstance(visual, dict):
            continue
        if artifact.get("status") != "ready" or visual.get("kind") != "plot":
            continue
        plot = visual.get("plot") or {}
        if not isinstance(plot, dict):
            continue
        parameters = plot.get("parameters", [])
        curves = plot.get("curves", [])
        # No chat messages, attachments, private source context or local paths.
        public = {k: plot[k] for k in ("x_label", "y_label", "x_min", "x_max", "y_min", "y_max") if k in plot}
        public["parameters"] = [{k: p[k] for k in ("name", "label", "value", "min", "max", "unit", "units") if k in p}
                                for p in (parameters if isinstance(parameters, list) else [])[:32] if isinstance(p, dict)]
        public["curves"] = [{k: c[k] for k in ("id", "label", "expression", "color") if k in c}
                            for c in (curves if isinstance(curves, list) else [])[:24] if isinstance(c, dict)]
        return {"plot": public}
    return JSONResponse({"error": "This saved graph is no longer available."}, status_code=404)
