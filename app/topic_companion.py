"""Immediate, source-linked references for every teachable Morin scope.

The versioned catalog is prepared offline. Opening a sheet never requests provider
work or reads a PDF. Legacy saved sheets receive current references at read time,
without rewriting messages, historical notes, learning evidence or mastery.
"""
from __future__ import annotations

import copy
import json
from functools import lru_cache
from pathlib import Path

from . import chapter_scope, prepared_lessons


NOTE_SCHEMA = {"type": "array", "items": {"type": "object", "additionalProperties": False,
    "required": ["id", "summary", "notes"], "properties": {
        "id": {"type": "string"}, "summary": {"type": "string"}, "notes": {"type": "string"}}}}

# Exact section mapping only. A subsection must be mapped explicitly, never inherit
# a vaguely related whole-section setup. All are representative teaching examples.
VISUALS = {"2.2": "ladder_wall_static", "3.1": "block_on_incline", "3.2": "block_on_incline", "3.4": "projectile_launch",
           "4.3": "spring_damped", "4.5": "coupled_springs",
           "5.1": "potential_well", "5.2": "potential_well",
           "7.2": "effective_potential", "8.3": "rod_about_end", "8.4": "falling_rod",
           "9.2": "cube_inertia", "9.3": "tilted_rod_axle", "9.6": "free_disk_wobble",
           "9.7": "heavy_top_nutation", "10.2.3": "coriolis_free_particle",
           "11.5": "velocity_addition_graph", "11.7": "minkowski_train"}

_FILE = Path(__file__).parent / "content" / "topic_references.json"


@lru_cache(maxsize=1)
def catalog() -> dict:
    """Load ready references once; malformed shipped content is a real error, never pending work."""
    data = json.loads(_FILE.read_text(encoding="utf-8"))
    refs = data.get("references", {})
    expected = {row["id"] for n in range(1, 15)
                for sec in chapter_scope.concept_sections(chapter_scope.chapter(n))
                for row in [sec, *chapter_scope.subsections(sec)]}
    if set(refs) != expected or any(not r.get("summary") or not r.get("notes") for r in refs.values()):
        raise ValueError("Prepared study references do not cover the complete chapter map.")
    return data




def key(ref: dict | None) -> str | None:
    ref = chapter_scope.canonical(ref)
    return json.dumps([ref["chapter"], ref["section_ids"], ref["topic_id"]], separators=(",", ":")) if ref else None


def targets(ref: dict) -> list[dict]:
    """A broad scope has one note per section; a subsection has only its own note."""
    outline = chapter_scope.outline(ref)
    if ref.get("topic_id"):
        return [dict(t, subsections=[], examples=[], named_ideas=[]) for s in outline["sections"]
                for t in s["subsections"] if t["id"] == ref["topic_id"]]
    return copy.deepcopy(outline["sections"])


def prepared_visual(ref: dict | None) -> str | None:
    ref = chapter_scope.canonical(ref)
    return VISUALS.get(ref["topic_id"] or ref["section_ids"][0]) if ref else None


def reader_visual(section_id: str) -> dict | None:
    """Exact reviewed teaching associations; never substitute the chapter's first demo."""
    if section_id == '11.2':
        return {'kind': 'light_pulse', 'id': '11.2-light-pulse', 'title': 'Light and the moving receiver',
                'description': 'The same ground-frame events as the authored worked examples.'}
    rid = VISUALS.get(section_id)
    if not rid:
        return None
    from . import visual_library
    try:
        recipe = visual_library.recipe(rid)
    except visual_library.UnknownRecipe:
        return None
    return {'kind': 'recipe', 'id': rid, 'title': recipe['title'],
            'description': 'Representative teaching setup for this section; example givens remain authoritative.'}


@lru_cache(maxsize=1)
def lesson_order() -> list[dict]:
    rows = []
    for n in range(1, 15):
        for section in chapter_scope.concept_sections(chapter_scope.chapter(n)):
            for row in [section, *chapter_scope.subsections(section)]:
                rows.append({"id": row["id"], "title": row["title"],
                    "study_context": chapter_scope.launch(n, [section["id"]], row["id"] if row is not section else None)})
    return rows

def navigation(section_id: str) -> dict:
    rows = lesson_order()
    index = next(i for i, row in enumerate(rows) if row["id"] == section_id)
    return {"previous": copy.deepcopy(rows[index-1]) if index else None,
            "next": copy.deepcopy(rows[index+1]) if index+1 < len(rows) else None}

def active_context(ref, visible, selected):
    """Resolve the visible location against authored material; client text is only screen context."""
    sid = reference_id(ref, (visible or {}).get("section_id")) or reference_id(ref, selected)
    if not sid: return None
    lesson = prepared_lessons.get(sid)
    if not lesson: return None
    kind = (visible or {}).get("part_kind", "prepared_lesson")
    index = (visible or {}).get("part_index") or 0
    out = {"section_id": sid, "kind": kind, "title": lesson.get("title"),
           "screen": visible, "instruction": "Answer the student's current question using this authored material. Hidden solutions are private grounding, not permission to reveal them. Do not confuse worked examples with independent practice or infer mastery from viewing."}
    if kind == "prepared_example":
        examples = lesson.get("examples", [])
        if 0 <= index < len(examples):
            out["worked_example"] = examples[index]
            step = (visible or {}).get("step_index")
            steps = examples[index].get("steps", [])
            if isinstance(step, int) and not isinstance(step, bool) and 0 <= step < len(steps):
                out["selected_step"] = {"number": step+1, **steps[step]}
                out["instruction"] += " The student explicitly attached selected_step to this question; address that step first."
    elif kind == "prepared_practice": out["practice_with_private_solution"] = lesson.get("practice")
    else: out["lesson"] = lesson
    return out


def new(ref: dict) -> dict:
    ref = chapter_scope.canonical(ref)
    rows = targets(ref)
    prepared = catalog()
    for row in rows:
        row.update(copy.deepcopy(prepared["references"][row["id"]]), origin="prepared")
        row["lesson"] = prepared_lessons.get(row["id"])
        row["reader_visual"] = reader_visual(row["id"])
        row["navigation"] = navigation(row["id"])
        if row["lesson"]: row["summary"] = row["lesson"]["summary"]
        for subsection in row.get("subsections", []):
            subsection.update(copy.deepcopy(prepared["references"][subsection["id"]]), origin="prepared")
            subsection["lesson"] = prepared_lessons.get(subsection["id"])
            subsection["reader_visual"] = reader_visual(subsection["id"])
            subsection["navigation"] = navigation(subsection["id"])
            if subsection["lesson"]: subsection["summary"] = subsection["lesson"]["summary"]
    return {"scope_key": key(ref), "title": ref["label"], "sections": rows,
            "revision": prepared["version"], "reference_version": prepared["version"], "ready": True}


def public(sheet: dict | None, ref: dict | None) -> dict | None:
    """An old saved thread can acquire a read-only sheet without rewriting any record."""
    if not chapter_scope.canonical(ref):
        return None
    # Always rebind to the current catalog and requested scope. A matching old sheet
    # can still contain blank/generated notes, so scope_key alone is not a readiness check.
    return new(ref)


def apply(t: dict, proposed) -> None:
    """Compatibility with old reply schemas: model prose never overwrites curated references."""
    ref = chapter_scope.canonical(t.get("study_context"))
    if not ref:
        return
    t["topic_companion"] = new(ref)


def reference_id(ref, proposed):
    if not isinstance(proposed,str) or not chapter_scope.canonical(ref): return None
    return proposed if any(proposed == row["id"] for section in targets(ref)
                           for row in [section,*section.get("subsections",[])]) else None


def context(ref: dict, sheet: dict | None, read_page, visible_reference=None) -> dict:
    sheet = public(sheet, ref)
    selected = reference_id(ref,visible_reference) or sheet["sections"][0]["id"]
    def bounded(row):
        result=copy.deepcopy(row)
        if result["id"] != selected:
            result.pop("lesson",None)
        result["subsections"]=[bounded(s) for s in result.get("subsections",[])]
        return result
    return {"title": sheet["title"], "sections": [bounded(s) for s in sheet["sections"]], "source_excerpts": [],
        "visible_reference_id":selected,
        "reference_version": sheet["reference_version"], "notes_requested": [],
        "instruction": "The student already has these complete prepared references in the lesson pane. "
            "Use this SAME material to teach; do not generate, rewrite, promise or wait for study notes. "
            "Return topic_notes as an empty array if the reply schema includes it. The notes are a compact "
            "reference, not proof that the student has learned the topic or a complete textbook solution. "
            "The lesson field contains prepared worked examples with each step's reason and independent practice. "
            "When a matching prepared visual is already open, use that physical setup for the opening idea. "
            "Otherwise start from the easiest worked example, preserving its symbols and assumptions. "
            "If the student asks about a specific worked example, use that exact example and never describe "
            "an unrelated open visual as representing it; adapt or replace the visual when needed. "
            "These authored examples are not automatically Morin's exact examples; "
            "do not attribute their wording or givens to the book without reading the cited source. "
            "visible_reference_id names the notes currently selected by the student; use that lesson when they "
            "ask about these notes. Its examples are teaching examples, not answers to a numbered book problem. "
            "Chat teaches ONE idea and checks one prerequisite at a time. The opening_question is an optional "
            "starting check, not a script to repeat. A chapter/group starts with its first section; keep all "
            "selected sections and numbered subsections in scope. Each reference identifies source pages: "
            "read the actual source before discussing a named book example beyond these prepared relations. "
            "Prepared examples have explicit assumptions; never swap in coefficients from a different setup. "
            "In particular the three-identical-spring oscillator differs from Morin's opening algebra example. "
            "The rough incline is paused before release, NOT in force-balanced equilibrium. "
            "Use net force with vectors or signed components. Derive string constraints from actual total "
            "length; do not assume all connected objects have equal accelerations. Equal tension requires "
            "the appropriate ideal string/pulley assumptions. If an error is discovered in a reference, "
            "explain the correction in chat rather than silently changing the saved sheet."}
