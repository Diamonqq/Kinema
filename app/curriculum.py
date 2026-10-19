"""The skill map: Morin's chapters and sections, the skills under them, their prerequisites, and diagnostic questions.

Content lives in app/content/*.json (versioned with the code). Sections without any written skills are "outline":
the book section exists on the map but hasn't been broken into skills yet. That is a statement about the map, not about
the student, and the UI must show it differently from "not checked".
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

DIR = Path(__file__).resolve().parent / "content"
PREREQ_TYPES = {"n": "necessary", "h": "helpful"}


class CurriculumError(ValueError):
    pass


def _read(name: str) -> dict:
    return json.loads((DIR / name).read_text(encoding="utf-8"))


def validate(raw: dict, questions: list[dict]) -> list[str]:
    errs: list[str] = []
    sections = {}
    for ch in raw.get("chapters", []):
        for s in ch.get("sections", []):
            if s["id"] in sections:
                errs.append(f"duplicate section {s['id']}")
            sections[s["id"]] = ch["n"]
    ids = [k["id"] for k in raw.get("skills", [])]
    seen = set()
    for i in ids:
        if i in seen:
            errs.append(f"duplicate skill id {i}")
        seen.add(i)
    for k in raw.get("skills", []):
        if k.get("sec") not in sections:
            errs.append(f"{k['id']}: unknown section {k.get('sec')}")
        if not str(k.get("title", "")).strip() or not str(k.get("task", "")).strip():
            errs.append(f"{k['id']}: needs a title and an observable task")
        for p in k.get("prereqs", []):
            if len(p) != 3:
                errs.append(f"{k['id']}: prerequisite entries are [id, type, reason]")
                continue
            pid, typ, why = p
            if pid not in seen:
                errs.append(f"{k['id']}: unknown prerequisite {pid}")
            if pid == k["id"]:
                errs.append(f"{k['id']}: lists itself as a prerequisite")
            if typ not in PREREQ_TYPES:
                errs.append(f"{k['id']}: prerequisite {pid} has type {typ!r}, expected n or h")
            if not str(why).strip():
                errs.append(f"{k['id']}: prerequisite {pid} has no reason")
    # cycles over all edges (helpful edges must not create loops either)
    graph = {k["id"]: [p[0] for p in k.get("prereqs", []) if len(p) == 3] for k in raw.get("skills", [])}
    state: dict[str, int] = {}

    def visit(n: str, path: list[str]) -> None:
        state[n] = 1
        for m in graph.get(n, []):
            if state.get(m) == 1:
                errs.append("prerequisite cycle: " + " -> ".join(path + [n, m]))
            elif not state.get(m) and m in graph:
                visit(m, path + [n])
        state[n] = 2

    for n in graph:
        if not state.get(n):
            visit(n, [])
    qids = set()
    for q in questions:
        if q["id"] in qids:
            errs.append(f"duplicate question {q['id']}")
        qids.add(q["id"])
        if q.get("skill") not in seen:
            errs.append(f"{q['id']}: unknown skill {q.get('skill')}")
        ch = q.get("choices") or []
        if not (2 <= len(ch) <= 5) or len(set(ch)) != len(ch):
            errs.append(f"{q['id']}: needs 2-5 distinct choices (the first is correct)")
        if not str(q.get("stem", "")).strip() or not str(q.get("why", "")).strip():
            errs.append(f"{q['id']}: needs a stem and an explanation")
    return errs


def validate_examples(examples: list[dict], skills: set[str], questions: set[str]) -> list[str]:
    errs, seen = [], set()
    for e in examples:
        if e.get("skill") not in skills:
            errs.append(f"{e.get('id')}: unknown skill {e.get('skill')}")
        if e.get("skill") in seen:
            errs.append(f"{e.get('id')}: a second example for {e.get('skill')}")
        seen.add(e.get("skill"))
        steps = e.get("steps") or []
        if not (2 <= len(steps) <= 8) or not all(str(s.get("do", "")).strip() for s in steps):
            errs.append(f"{e.get('id')}: needs 2-8 steps, each with something to do")
        if not str(e.get("problem", "")).strip() or not str((e.get("answer") or {}).get("latex", "")).strip():
            errs.append(f"{e.get('id')}: needs a problem and an answer")
        if e.get("turn") and e["turn"] not in questions:
            errs.append(f"{e.get('id')}: its turn question {e['turn']} doesn't exist")
    return errs


def validate_lesson(ls: dict, skills: set[str], questions: set[str]) -> list[str]:
    lid, errs = ls.get("id", "?"), []
    fids = [f.get("id") for g in ls.get("groups", []) for f in g.get("formulas", [])]
    if not fids or len(fids) != len(set(fids)):
        errs.append(f"lesson {lid}: needs formulas with unique ids")
    for g in ls.get("groups", []):
        for f in g.get("formulas", []):
            if not str(f.get("latex", "")).strip():
                errs.append(f"lesson {lid}: formula {f.get('id')} has no formula")
    ns = [r.get("n") for r in ls.get("rungs", [])]
    if not ns or ns != sorted(ns) or len(set(ns)) != len(ns):
        errs.append(f"lesson {lid}: rungs must be numbered in order")
    keys = [r.get("progress_key", f"{lid}:{r.get('n')}") for r in ls.get("rungs", [])]
    if len(keys) != len(set(keys)):
        errs.append(f"lesson {lid}: duplicate progress keys")
    for r in ls.get("rungs", []):
        if not r.get("skills") or any(s not in skills for s in r["skills"]):
            errs.append(f"lesson {lid} rung {r.get('n')}: unknown skills {r.get('skills')}")
        if not (2 <= len(r.get("steps") or []) <= 8):
            errs.append(f"lesson {lid} rung {r.get('n')}: needs 2-8 steps")
        if r.get("turn") and r["turn"] not in questions:
            errs.append(f"lesson {lid} rung {r.get('n')}: turn question {r['turn']} doesn't exist")
        if any(u not in set(fids) for u in r.get("uses", [])):
            errs.append(f"lesson {lid} rung {r.get('n')}: uses a formula that isn't on the sheet")
    return errs


@lru_cache(maxsize=1)
def load() -> dict:
    raw = _read("morin.json")
    qraw = _read("questions.json")
    questions = qraw.get("questions", [])
    eraw = _read("examples.json") if (DIR / "examples.json").is_file() else {"examples": []}
    errs = validate(raw, questions)
    if not errs:
        errs = validate_examples(eraw.get("examples", []), {k["id"] for k in raw["skills"]}, {q["id"] for q in questions})
    lessons = {}
    for lp in sorted((DIR / "lessons").glob("*.json")) if (DIR / "lessons").is_dir() else []:
        ls = json.loads(lp.read_text(encoding="utf-8"))
        errs += validate_lesson(ls, {k["id"] for k in raw["skills"]}, {q["id"] for q in questions})
        lessons[ls["id"]] = ls
    for ls in lessons.values():
        for rung in ls["rungs"]:
            if not rung.get("progress_key"):
                continue
            lid, _, n = rung["progress_key"].rpartition(":")
            source = next((r for r in lessons.get(lid, {}).get("rungs", []) if str(r["n"]) == n), None)
            if not source or source.get("turn") != rung.get("turn") or source.get("answer") != rung.get("answer"):
                errs.append(f"lesson {ls['id']} rung {rung['n']}: progress key must reference the same example and turn")
    if errs:
        raise CurriculumError("; ".join(errs[:12]))
    chapters, sections, skills = [], {}, {}
    for ch in raw["chapters"]:
        c = {"n": ch["n"], "title": ch["title"], "page": ch.get("page"), "problems_page": ch.get("problems_page"), "sections": []}
        for s in ch["sections"]:
            sec = {"id": s["id"], "title": s["title"], "page": s.get("page"), "chapter": ch["n"], "ref": s.get("ref", ""), "skills": []}
            sections[s["id"]] = sec
            c["sections"].append(sec)
        chapters.append(c)
    for k in raw["skills"]:
        sec = sections[k["sec"]]
        sk = {"id": k["id"], "title": k["title"], "task": k["task"], "section": sec["id"], "chapter": sec["chapter"],
              "page": sec["page"], "prereqs": [{"id": p[0], "type": PREREQ_TYPES[p[1]], "why": p[2]} for p in k.get("prereqs", [])],
              "questions": []}
        skills[k["id"]] = sk
        sec["skills"].append(k["id"])
    for q in questions:
        skills[q["skill"]]["questions"].append(q["id"])
    used_by: dict[str, list[str]] = {k: [] for k in skills}
    for k in skills.values():
        for p in k["prereqs"]:
            used_by[p["id"]].append(k["id"])
    for k in skills.values():
        k["used_by"] = used_by[k["id"]]
    for sec in sections.values():
        sec["mapped"] = bool(sec["skills"])
    book = raw.get("book", {})
    return {"version": raw.get("version"), "questions_version": qraw.get("version"), "book": book,
            "class_now": raw.get("class_now", {}), "chapters": chapters, "sections": sections, "skills": skills,
            "questions": {q["id"]: q for q in questions}, "examples_version": eraw.get("version"),
            "examples": {e["skill"]: e for e in eraw.get("examples", [])}, "lessons": lessons}


def ancestors(skill_ids, *, include_helpful: bool = False) -> set[str]:
    """Every prerequisite under the given skills (necessary edges only unless asked)."""
    cur = load()["skills"]
    out, stack = set(), list(skill_ids)
    while stack:
        s = stack.pop()
        for p in cur[s]["prereqs"]:
            if (include_helpful or p["type"] == "necessary") and p["id"] not in out:
                out.add(p["id"])
                stack.append(p["id"])
    return out


def route(targets) -> list[str]:
    """The targets and all their necessary prerequisites, ordered so that every skill comes after what it needs."""
    cur = load()["skills"]
    want = set(targets) | ancestors(targets)
    order, done = [], set()

    def visit(s: str) -> None:
        if s in done:
            return
        done.add(s)
        for p in cur[s]["prereqs"]:
            if p["type"] == "necessary" and p["id"] in want:
                visit(p["id"])
        order.append(s)

    for s in sorted(want, key=lambda x: (str(cur[x]["chapter"]), x)):
        visit(s)
    return order


def class_route() -> list[str]:
    """The route under what class is on right now (all of the current chapter plus its necessary prerequisites)."""
    c = load()
    ch = c["class_now"].get("chapter")
    targets = [k for k, v in c["skills"].items() if v["chapter"] == ch]
    return route(targets)


def page_pdf(book_page: int | None) -> int | None:
    if book_page is None:
        return None
    return int(book_page) + int(load()["book"].get("pdf_offset", 0))
