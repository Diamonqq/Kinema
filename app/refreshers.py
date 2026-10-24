"""Thirty-second refreshers (Kinema 1.28, lane E).

A lesson step or tutor reply that leans on a prerequisite the learner has not shown they know (trig on a right
triangle, components on an incline, the right-hand rule, ...) earns one small card beside the chat composer. The
card is prepared content from app/content/refreshers.json: a formula with symbols and units, one tiny worked line and
one quick check. Nothing here calls a model.

Choosing: the browser sends the text on screen; every refresher whose patterns hit is a candidate, kept only when
one of its skills is still weak in the learner's evidence (not_checked, seen, gap, or due for review). The learner's
own session excludes cards already shown. Answering records evidence the ordinary way (learner.record and the
per-item review schedule), so the Study path and the tutor see it. The correct choice index never leaves the server.
"""
from __future__ import annotations

import json
import random
import re
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from . import book_catalog, curriculum, learn_api, learner

router = APIRouter()
CONTENT = Path(__file__).resolve().parent / "content" / "refreshers.json"
WEAK = {"not_checked", "seen", "gap"}
MAX_TEXT = 4000


def _content() -> dict:
    """The authored cards; a package without them (the public source zip) has no refreshers rather than an error."""
    try:
        return json.loads(CONTENT.read_text(encoding="utf8"))
    except FileNotFoundError:
        return {}


@lru_cache(maxsize=1)
def load() -> list[dict]:
    data = _content()
    out = []
    for r in data.get("refreshers", []):
        r = dict(r)
        r["_patterns"] = [re.compile(p, re.I) for p in r["match"]]
        out.append(r)
    return out


@lru_cache(maxsize=1)
def load_context() -> list[dict]:
    """Server-authored variants for one book problem each: the setup in the problem's own words and geometry."""
    data = _content()
    out = []
    for r in data.get("contextual", []):
        r = dict(r)
        r["_patterns"] = [re.compile(p, re.I) for p in r["match"]]
        out.append(r)
    return out


def canonical(problem_id: str) -> dict | None:
    """The problem's canonical record from the textbook catalog (content_sha, statement_md), or None if unavailable."""
    try:
        return book_catalog.item(problem_id)
    except Exception:
        return None


def has_setup(problem_id: str | None) -> bool:
    """True when a verified variant exists for this problem ID, whether or not it passes the gate right now."""
    return bool(problem_id) and any(str(problem_id) in r["problem_ids"] for r in load_context())


def context_for(problem_id: str | None, revision: str | None = None) -> dict | None:
    """The variant for this exact problem ID when the canonical record still matches what it was authored against.

    Gate: the catalog's content_sha equals the variant's source_revision; a client-sent revision, when given, equals it
    too; and the canonical statement matches the variant's patterns. Matching never reads tutor prose.
    """
    if not problem_id:
        return None
    card = next((r for r in load_context() if str(problem_id) in r["problem_ids"]), None)
    if not card:
        return None
    item = canonical(str(problem_id))
    if not item or item.get("content_sha") != card["source_revision"]:
        return None
    if revision and revision != card["source_revision"]:
        return None
    statement = item.get("statement_md") or ""
    if not any(p.search(statement) for p in card["_patterns"]):
        return None
    return card


def find(rid: str) -> dict | None:
    return next((r for r in load() + load_context() if r["id"] == rid), None)


def score(card: dict, text: str) -> int:
    """How many distinct patterns of this card the text hits."""
    return sum(1 for p in card["_patterns"] if p.search(text))


def weak_skills(states: dict, card: dict) -> list[str]:
    return [s for s in card["skills"] if states.get(s, {}).get("state", "not_checked") in WEAK or states.get(s, {}).get("due")]


def choose(states: dict, text: str, exclude: set[str] | None = None) -> dict | None:
    """Best weak candidate for this text, or None. Ties keep file order (weakest-known-habits first)."""
    text = (text or "")[:MAX_TEXT]
    best, best_score = None, 0
    for card in load():
        if exclude and card["id"] in exclude:
            continue
        s = score(card, text)
        if s > best_score and weak_skills(states, card):
            best, best_score = card, s
    return best


def choose_context(states: dict, problem_id: str | None, exclude: set[str] | None = None, revision: str | None = None) -> dict | None:
    """The problem's own variant when the gate passes and its skill is still weak; never a generic card in its place."""
    card = context_for(problem_id, revision)
    if not card or (exclude and card["id"] in exclude) or not weak_skills(states, card):
        return None
    return card


def public(card: dict, order: list[int]) -> dict:
    """What the browser gets: no answer index; choices in the shown order. 'problem' scope means this exact setup."""
    check = card["check"]
    return {"id": card["id"], "title": card["title"], "symbol": card["symbol"], "skills": list(card["skills"]),
            "formula_md": card["formula_md"], "worked_md": card["worked_md"], "scope": "problem" if "problem_ids" in card else "general",
            "check": {"question_md": check["question_md"], "choices": [check["choices"][i] for i in order]}, "order": order}


def shuffled(card: dict, session: str) -> list[int]:
    """Stable per card and session so a reload shows the same order."""
    order = list(range(len(card["check"]["choices"])))
    random.Random(f"{card['id']}:{session}").shuffle(order)
    return order


def grade(conn, card: dict, picked: int | None, order: list[int], session: str, now: float | None = None) -> dict:
    """Record the quick check as graded evidence on the card's skills; returns the verdict and the explanation."""
    choices = card["check"]["choices"]
    if sorted(order) != list(range(len(choices))):
        raise ValueError("order must be a permutation of the choices")
    stored = None if picked is None else order[int(picked)]
    correct = stored == card["check"]["answer"]
    outcome = "dont_know" if picked is None else ("correct" if correct else "wrong")
    recorded = []
    for skill in card["skills"]:
        ok = learner.record(conn, skill, "check", outcome, "chat", ref=f"refresher:{card['id']}", detail={"picked": stored},
                            dedup=f"refresher:{card['id']}:{session}:answer", now=now)
        if ok:
            learner.review_item(conn, f"refresher:{card['id']}", skill, outcome, now)
        recorded.append({"skill": skill, "recorded": ok})
    return {"correct": correct, "outcome": outcome, "answer_index": order.index(card["check"]["answer"]),
            "why": card["check"]["why"], "evidence": recorded}


def opened(conn, card: dict, session: str, now: float | None = None) -> list[dict]:
    """Opening the card is exposure only; it never counts as recall."""
    return [{"skill": skill, "recorded": learner.record(conn, skill, "taught", "exposure", "chat", ref=f"refresher:{card['id']}",
                                                      dedup=f"refresher:{card['id']}:{session}:opened", now=now)} for skill in card["skills"]]


def _bad(msg: str, code: int = 400) -> JSONResponse:
    return JSONResponse({"error": msg}, status_code=code)


def _session(body: dict) -> str:
    return re.sub(r"[^\w.-]", "", str(body.get("session") or "anon"))[:40] or "anon"


@router.post("/api/refreshers/consider")
async def consider(request: Request):
    body = await request.json()
    text = " ".join(str(body.get(k) or "") for k in ("title", "text"))
    exclude = {str(x) for x in body.get("exclude") or [] if isinstance(x, str)}
    problem_id = str(body.get("problem_id") or "")[:40] or None
    revision = str(body.get("source_revision") or "")[:80] or None
    conn = learn_api._db()
    try:
        states = learner.states(conn)
    finally:
        conn.close()
    if has_setup(problem_id):
        # A problem with a verified setup gets only its own variant (or none), never a generic card that may not match its geometry.
        card = choose_context(states, problem_id, exclude, revision)
    else:
        card = choose(states, text, exclude)
    if not card:
        return {"card": None, "problem_id": problem_id}
    return {"card": public(card, shuffled(card, _session(body))), "problem_id": problem_id}


@router.post("/api/refreshers/{rid}/opened")
async def mark_opened(rid: str, request: Request):
    card = find(rid)
    if not card:
        return _bad("no such refresher", 404)
    body = await request.json()
    conn = learn_api._db()
    try:
        out = opened(conn, card, _session(body))
        conn.commit()
    finally:
        conn.close()
    return {"evidence": out}


@router.post("/api/refreshers/{rid}/answer")
async def answer(rid: str, request: Request):
    card = find(rid)
    if not card:
        return _bad("no such refresher", 404)
    body = await request.json()
    order = body.get("order")
    picked = body.get("picked")
    if not isinstance(order, list) or sorted(order) != list(range(len(card["check"]["choices"]))):
        return _bad("order must be a list of choice indexes")
    if picked is not None and not (isinstance(picked, int) and 0 <= picked < len(order)):
        return _bad("picked is out of range")
    conn = learn_api._db()
    try:
        out = grade(conn, card, picked, order, _session(body))
        conn.commit()
        states = learner.states(conn)
    finally:
        conn.close()
    out["states"] = {s: states[s]["state"] for s in card["skills"] if s in states}
    return out


def validate() -> list[str]:
    """Content problems, for tests and the build: unknown skills, bad answers, unbalanced math."""
    problems = []
    skills = curriculum.load()["skills"]
    seen = set()
    for r in load():
        if r["id"] in seen:
            problems.append(f"{r['id']}: duplicate id")
        seen.add(r["id"])
        for s in r["skills"]:
            if s not in skills:
                problems.append(f"{r['id']}: unknown skill {s}")
        c = r["check"]
        if not (3 <= len(c["choices"]) <= 4) or c["answer"] != 0:
            problems.append(f"{r['id']}: check needs 3-4 choices with the correct one first")
        if len(set(c["choices"])) != len(c["choices"]):
            problems.append(f"{r['id']}: repeated choice")
        for key in ("formula_md", "worked_md"):
            if r[key].count("$") % 2:
                problems.append(f"{r['id']}: unbalanced $ in {key}")
        if not r["_patterns"]:
            problems.append(f"{r['id']}: no match patterns")
    context_ids = [r["id"] for r in load_context()]
    for r in load_context():
        if r["id"] in seen or context_ids.count(r["id"]) > 1:
            problems.append(f"{r['id']}: duplicate id")
        if not r.get("problem_ids"):
            problems.append(f"{r['id']}: no problem id")
        if not re.fullmatch(r"[0-9a-f]{64}", r.get("source_revision", "")):
            problems.append(f"{r['id']}: source_revision must be the canonical content_sha")
        if not r.get("match"):
            problems.append(f"{r['id']}: no statement patterns")
        for s in r["skills"]:
            if s not in skills:
                problems.append(f"{r['id']}: unknown skill {s}")
        c = r["check"]
        if not (3 <= len(c["choices"]) <= 4) or c["answer"] != 0 or len(set(c["choices"])) != len(c["choices"]):
            problems.append(f"{r['id']}: check needs 3-4 distinct choices with the correct one first")
        for key in ("formula_md", "worked_md"):
            if r[key].count("$") % 2:
                problems.append(f"{r['id']}: unbalanced $ in {key}")
    return problems
