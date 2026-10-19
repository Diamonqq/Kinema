"""Study path chapter map: each chapter's real Morin sections, printed sub-headings and worked examples, grouped,
joined to the evidence Kinema already holds. Book structure only: no schedule, no suggested next, no new mastery."""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter

from . import chapter_scope, learn_api, learning_progress, prepared_lessons

router = APIRouter()
_FILE = Path(__file__).parent / "content" / "chapter_map.json"
_LABEL = {"gap": "weak", "learning": "shaky", "confirmed": "known", "mastered": "known", "seen": "seen", "not_checked": "unchecked"}


def _map() -> dict:
    return json.loads(_FILE.read_text(encoding="utf-8"))


COVER = 0.5      # share of skills that must be checked before a chapter or section gets a verdict
KNOWN_AT = 0.7   # share of ALL skills that must be known before it reads "known"


def _rollup(skills: list[dict]) -> dict:
    """known/shaky/weak describe only skills actually checked; with a thin sample the state is 'partial' and `lean`
    gives the direction of what little evidence exists. `checked` and `skills` always travel with it."""
    n = {"known": 0, "shaky": 0, "weak": 0, "seen": 0, "unchecked": 0}
    for k in skills:
        n[_LABEL[k["state"]]] += 1
    total = len(skills)
    checked = n["known"] + n["shaky"] + n["weak"]
    lean = "weak" if n["weak"] and n["weak"] * 2 >= checked else "known" if not n["weak"] and not n["shaky"] else "shaky"
    if not checked:
        state = "unchecked"
    elif checked < total * COVER:
        state = "partial"
    elif lean == "known" and n["known"] < total * KNOWN_AT:
        state = "partial"
    else:
        state = lean
    return {"state": state, "lean": lean if checked else None, **n, "checked": checked, "skills": total}


def build(atlas: dict) -> dict:
    book = _map()
    pdf_off = book["page_offset"] + 1
    by_ch = {c["n"]: c for c in atlas["chapters"]}
    chapters = []
    for ch in book["chapters"]:
        a = by_ch.get(ch["n"], {"sections": []})
        ev = {s["id"]: s["skills"] for s in a["sections"]}
        secs = {}
        for s in ch["sections"]:
            skills = ev.get(s["id"], [])
            teachable = s["kind"] == "concept"
            secs[s["id"]] = {**s, "pdf_page": s["page"] + pdf_off, "pdf_end": s["end"] + pdf_off, "teachable": teachable,
                             "launch": chapter_scope.launch(ch["n"], [s["id"]]) if teachable else None,
                             "topics": [{**t, "pdf_page": t["page"] + pdf_off, **({"pdf_end": t["end"] + pdf_off, "launch": chapter_scope.launch(ch["n"], [s["id"]], t["id"])} if t["kind"] == "sub" else {})}
                                        for t in s.get("topics", [])],
                             "skills": [_skill_row(k) for k in skills],
                             "evidence": _rollup(skills) if skills else None}
            if teachable:
                lesson = prepared_lessons.get(s['id'])
                secs[s['id']]['progress'] = learning_progress.section_progress(s, skills, lesson)
                secs[s['id']]['example_count'] = len((lesson or {}).get('examples', []))
        groups = [{"title": g["title"], "launch": chapter_scope.launch(ch["n"], g["sections"]), "sections": [secs[i] for i in g["sections"] if i in secs]}
                  for g in ch["groups"]]
        practice = [secs[s["id"]] for s in ch["sections"] if s["kind"] == "practice"]
        all_skills = [k for s in secs.values() for k in s["skills"]]
        chapters.append({"n": ch["n"], "title": ch["title"], "page": ch["page"], "end": ch["end"], "pdf_page": ch["page"] + pdf_off,
                         "pdf_end": ch["end"] + pdf_off, "primary": True, "launch": chapter_scope.launch(ch["n"]), "groups": groups, "practice": practice, "evidence": _rollup(all_skills),
                         "progress": learning_progress.chapter_progress(list(secs.values()))})
    extra = [c for c in atlas["chapters"] if not isinstance(c["n"], int)]
    for c in extra:
        sk = [k for s in c["sections"] for k in s["skills"]]
        chapters.append({"n": c["n"], "title": c["title"], "page": None, "pdf_page": None, "primary": False, "math": True,
                         "groups": [{"title": "Skills", "sections": [{"id": s["id"], "title": s["title"], "page": s["page"], "kind": "concept", "topics": [],
                                  "skills": [_skill_row(k) for k in s["skills"]],
                                  "progress": learning_progress.section_progress(s, s['skills']),
                                  "evidence": _rollup(s["skills"]) if s["skills"] else None} for s in c["sections"]]}],
                         "practice": [], "evidence": _rollup(sk)})
        chapters[-1]['progress'] = learning_progress.chapter_progress([s for g in chapters[-1]['groups'] for s in g['sections']])
    return {"source": book["source"], "chapters": chapters}


def _skill_row(skill):
    return {k: skill.get(k, default) for k, default in (
        ('id', ''), ('title', ''), ('state', 'not_checked'), ('due', False),
        ('question_count', 0), ('reason', 'No recorded checks yet.'), ('last_ts', None),
        ('support', {}), ('evidence_strength', 'Not yet measured'))}


@router.get("/api/chapter-map")
def chapter_map() -> dict:
    return build(learn_api.atlas())
