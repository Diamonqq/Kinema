"""Example-first practice (owner, 2026-09-23): "I should just be able to tell an agent 'I wanna practice chapter 9 and
get good before my next class'", "not these paragraphs of Morin text", "I learn the best following examples".

A goal in plain words becomes a scope: chapters, sections or skills, or by default what class is on now. Each
skill in it gets a worked example the student follows step by step, then a similar problem ("your turn"). A miss
backs up to the untested skills it builds on (example + turn each), then the missed skill gets another problem.
Skills already shown before get just a quick turn; confirmed ones are skipped. Like the daily planner, the next item
is derived from the session log and the evidence each time, so closing the tab simply resumes.
"""
from __future__ import annotations

import json
import re

from . import curriculum, learner

PRACTICE = re.compile(
    r"\b(practi[cs]e|practi[cs]ing|study|studying|review|revise|revision|drill|prep|prepare|preparing|quiz me|test me|"
    r"get good|get better|learn|learning|work on|go over|go through|refresh|brush up|teach me|walk me through|train|"
    r"help me (?:with|get|understand)|improve|master|ready for|catch up)\b", re.I)
CHAPTER = re.compile(r"\b(?:ch(?:apter)?s?\.?\s*)(\d{1,2}(?:\s*(?:[,/&+\-–]|and|to)\s*\d{1,2})*)\b", re.I)
SECTION = re.compile(r"(?<![\d.])(\d{1,2})\.(\d{1,2})(?![\d.])")
CLASS = re.compile(r"\b(class|classes|homework|hw|lecture|test|exam|quiz|midterm|final|problem set|pset)\b", re.I)
MATH = re.compile(r"\bmath\b", re.I)
FILLER = set("wanna want wants gonna need needs next before after good better really some stuff things thing today tonight "
             "tomorrow week please bit little more again all everything topic topics section sections chapter chapters ch "
             "problems problem examples example questions question skills skill basics me my i and the to for on in of with "
             "get got so like just".split())
OK = ("learning", "confirmed", "mastered")
MAX_DEPTH = 3                      # how far a miss backs up through prerequisites in one session


def _ordered(targets: list[str], focus: list[str]) -> list[str]:
    """Prerequisite order; with a focus (class homework), its chain inside the scope comes first."""
    tset = set(targets)
    first = [s for s in curriculum.route(focus) if s in tset] if focus else []
    return first + [s for s in curriculum.route(targets) if s in tset and s not in first]


def scope_for(targets: list[str], title: str, focus: list[str] | None = None, text: str = "") -> dict:
    focus = [s for s in (focus or []) if s in targets]
    return {"title": title, "targets": targets, "focus": focus, "order": _ordered(targets, focus), "text": text}


def class_scope(text: str = "") -> dict:
    """Skill practice on what class is on now (the homework chain first)."""
    cur = curriculum.load()
    ch = cur["class_now"].get("chapter")
    targets = [k for k, v in cur["skills"].items() if v["chapter"] == ch]
    return scope_for(targets, f"What class is on now (ch. {ch})", cur["class_now"].get("homework", []), text)


def lesson_for(chapter) -> str | None:
    return next((lid for lid, ls in curriculum.load()["lessons"].items() if ls.get("chapter") == chapter), None)


def chapter_numbers(text: str) -> list[int]:
    out = []
    for group in CHAPTER.findall(text):
        nums = [int(n) for n in re.findall(r"\d+", group)]
        if len(nums) == 2 and re.search(r"[-–]|\bto\b", group):
            nums = list(range(min(nums), max(nums) + 1))
        out.extend(nums)
    return list(dict.fromkeys(out))


def lesson_scope(lesson_id: str, text: str = "") -> dict:
    ls = curriculum.load()["lessons"][lesson_id]
    targets = list(dict.fromkeys(s for r in ls["rungs"] for s in r["skills"]))
    return {"title": ls["title"], "lesson": lesson_id, "targets": targets, "focus": [], "order": targets, "text": text}


def default_scope(text: str = "") -> dict:
    """The Start button: the chapter lesson for what class is on, else skill practice."""
    cur = curriculum.load()
    lid = cur["class_now"].get("lesson")
    if lid not in cur["lessons"]:
        lid = lesson_for(cur["class_now"].get("chapter"))
    return lesson_scope(lid, text) if lid else class_scope(text)


def parse(text: str, search) -> dict:
    """{"kind": "question"} or {"kind": "practice", "scope": {...}} or {"kind": "practice", "error": "..."}.
    search(q, limit) is the skill-map search (title and task words)."""
    t = " ".join((text or "").split())
    low = t.lower()
    cur = curriculum.load()
    chapters = chapter_numbers(low)
    sections = [f"{a}.{b}" for a, b in SECTION.findall(low) if f"{a}.{b}" in cur["sections"]]
    practice = bool(PRACTICE.search(low)) or (bool(chapters or sections) and len(low.split()) <= 8 and "?" not in low)
    if not practice:
        return {"kind": "question"}
    class_ch = cur["class_now"].get("chapter")
    targets, title = [], ""
    if sections:
        targets = [k for k, v in cur["skills"].items() if v["section"] in sections]
        title = ", ".join(f"§{s} {cur['sections'][s]['title']}" for s in sections)
    elif len(chapters) > 1 and not MATH.search(low) and (lid := next((lid for lid, ls in cur["lessons"].items() if set(ls.get("chapters", [])) == set(chapters)), None)):
        return {"kind": "practice", "scope": lesson_scope(lid, t)}
    elif len(chapters) == 1 and not MATH.search(low) and lesson_for(chapters[0]):
        return {"kind": "practice", "scope": lesson_scope(lesson_for(chapters[0]), t)}
    elif chapters or MATH.search(low):
        chs = chapters + (["M"] if MATH.search(low) else [])
        targets = [k for k, v in cur["skills"].items() if v["chapter"] in chs]
        title = " and ".join("the math physics uses" if c == "M" else f"chapter {c}" for c in chs)
        title = title[0].upper() + title[1:]
        if not targets:
            return {"kind": "practice", "error": f"{title} isn't broken into skills yet, so there's nothing to practise there yet."}
    else:
        topic = " ".join(w for w in re.findall(r"[a-z0-9'\-]+", CLASS.sub(" ", PRACTICE.sub(" ", low))) if w not in FILLER)
        hits = [h for h in search(topic, 8) if h["score"] >= 2] if topic.strip() else []
        if hits:
            top = hits[0]["score"]
            targets = [h["id"] for h in hits if h["score"] >= top - 1][:6]
            names = [cur["skills"][s]["title"] for s in targets]
            title = names[0] if len(names) == 1 else f"{names[0]} and {len(names) - 1} related skill{'s' if len(names) > 2 else ''}"
    if not targets:
        sc = default_scope(t)
        return {"kind": "practice", "scope": sc, "default": True}
    focus = []
    if class_ch in {cur["skills"][s]["chapter"] for s in targets} and CLASS.search(PRACTICE.sub(" ", low)):  # "quiz me" isn't a class quiz
        focus = [s for s in cur["class_now"].get("homework", []) if s in targets]
        if focus:
            title += ", starting with what your class is on"
    return {"kind": "practice", "scope": scope_for(targets, title, focus, t)}


def lesson_progress(conn, lesson_id: str) -> dict:
    """Rungs finished in any session of this lesson: turn answered, or example followed when a rung has no turn."""
    lessons = curriculum.load()["lessons"]
    ls = lessons[lesson_id]
    # Stable keys let combined courses recognize the same example without rewriting
    # any old session, grade or evidence. Numbering remains local to each lesson.
    keys = {lid: {r["n"]: (r.get("progress_key", f"{lid}:{r['n']}"), bool(r.get("turn"))) for r in lesson["rungs"]}
            for lid, lesson in lessons.items()}
    completed = set()
    for items_json, scope_json in conn.execute("SELECT items, scope FROM sessions WHERE mode='lesson'"):
        source_id = (json.loads(scope_json or "{}") or {}).get("lesson")
        source_keys = keys.get(source_id, {})
        for it in json.loads(items_json or "[]"):
            key, has_turn = source_keys.get(it.get("rung"), (None, False))
            if key and (it.get("type") == "turn" or (it.get("type") == "rung" and not has_turn)):
                completed.add(key)
    done = {n for n, (key, _) in keys[lesson_id].items() if key in completed}
    nxt = next((r for r in ls["rungs"] if r["n"] not in done), None)
    return {"done": sorted(done), "reached": max(done) if done else 0, "total": len(ls["rungs"]),
            "next": {"n": nxt["n"], "title": nxt["title"]} if nxt else None}


def workspace_position(conn, lid):
    """Retain the last opened conversation across days; older test/data stores may lack the additive table."""
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='lesson_threads'").fetchone():
        return None
    rows = [(n, json.loads(state)) for n, state in conn.execute("SELECT rung,state FROM lesson_threads WHERE lesson=?", (lid,))]
    return max(rows, key=lambda x: x[1].get("last_opened", 0))[0] if rows else None


def lesson_next(conn, s: dict) -> dict:
    """Formula sheet first, then each rung's worked example and its same-level turn, climbing the ladder."""
    lid = s["scope"]["lesson"]
    cur = curriculum.load()
    ls = cur["lessons"][lid]
    items = s["items"]
    # Conversation workspace sessions retain the selected problem; explicit Next
    # navigation owns advancement. Old formula-sheet sessions keep their format.
    focus = s["scope"].get("workspace_rung") or workspace_position(conn, lid)
    if focus:
        r = next(r for r in ls["rungs"] if r["n"] == focus)
        row = conn.execute("SELECT state FROM lesson_threads WHERE lesson=? AND rung=?", (lid, focus)).fetchone()
        phase = json.loads(row[0]).get("phase") if row else "example"
        typ = "turn" if phase in ("turn", "review") and r.get("turn") else "rung"
        return {"type": typ, "lesson": lid, "rung": focus, "skill": r["skills"][0], "question_id": r.get("turn")}
    sheet = next((it for it in items if it.get("type") == "sheet"), None)
    if not sheet:
        return {"type": "sheet", "lesson": lid}
    start = sheet.get("start_at") or 1
    shown = {it.get("rung") for it in items if it.get("type") == "rung"}
    answered = {it.get("rung") for it in items if it.get("type") == "turn"}
    for r in ls["rungs"]:
        if r["n"] < start:
            continue
        if r["n"] not in shown:
            return {"type": "rung", "lesson": lid, "rung": r["n"], "skill": r["skills"][0], "reason": r["level"]}
        if r.get("turn") and r["n"] not in answered:
            return {"type": "turn", "lesson": lid, "rung": r["n"], "skill": cur["questions"][r["turn"]]["skill"],
                    "question_id": r["turn"], "reason": "same level, your turn"}
    return {"type": "done", "reason": "top of the ladder"}


def ladder(conn, s: dict, current: int | None) -> list[dict]:
    ls = curriculum.load()["lessons"][s["scope"]["lesson"]]
    done = set(lesson_progress(conn, ls["id"])["done"])
    outcome = {it.get("rung"): it.get("outcome") for it in s["items"] if it.get("type") == "turn"}
    return [{"n": r["n"], "title": r["title"], "level": r["level"], "done": r["n"] in done, "outcome": outcome.get(r["n"]),
             "current": r["n"] == current} for r in ls["rungs"]]


def _nec(sid: str) -> list[str]:
    return [p["id"] for p in curriculum.load()["skills"][sid]["prereqs"] if p["type"] == "necessary"]


def next_item(conn, s: dict, states: dict) -> dict:
    """The next example, turn or done for a practice session."""
    cur = curriculum.load()
    items = s["items"]
    shown = {it.get("skill") for it in items if it.get("type") == "example"}
    turns: dict[str, list[str]] = {}
    for it in items:
        if it.get("type") == "turn":
            turns.setdefault(it.get("skill"), []).append(it.get("outcome"))
    title = lambda x: cur["skills"][x]["title"]  # noqa: E731

    def turn(sid: str, why: str, retry: bool = False) -> dict:
        qid = None
        ex = cur["examples"].get(sid)
        twin = ex and ex.get("turn")
        if twin and twin in cur["questions"] and not retry and not conn.execute(
                "SELECT 1 FROM attempts WHERE question_id=? LIMIT 1", (twin,)).fetchone():
            qid = twin
        return {"type": "turn", "skill": sid, "question_id": qid, "retry": retry, "reason": why}

    last = items[-1] if items else None
    if last and last.get("type") == "example":
        return turn(last["skill"], "a similar problem")

    def since_last_turn(sid: str) -> int:
        for n, it in enumerate(reversed(items)):
            if it.get("type") == "turn" and it.get("skill") == sid:
                return n
        return len(items)

    def settle(sid: str, depth: int, why: str | None) -> dict | str | None:
        outs = turns.get(sid, [])
        st = "not_checked" if s["scope"].get("from_scratch") else states[sid]["state"]
        if not outs:
            if st in ("confirmed", "mastered"):
                return None
            if st == "learning":
                return turn(sid, why or "a quick check: you've shown this before")
            if sid in cur["examples"] and sid not in shown:
                return {"type": "example", "skill": sid, "reason": why or "worked example"}
            return turn(sid, why or "try this one")
        if outs[-1] in learner.HIT:
            return None
        if len(outs) >= 2:
            return None                      # two tries today: it stays a gap and comes back next time
        if depth < MAX_DEPTH:
            for p in _nec(sid):
                if states[p]["state"] in OK and not turns.get(p):
                    continue
                r = settle(p, depth + 1, f"{title(sid)} builds on this")
                if r and r != "defer":
                    return r
            if depth == 0 and since_last_turn(sid) < 2:
                return "defer"               # nothing beneath it to rebuild: do the next skill first, then come back
        return turn(sid, "another problem on this, now that what it builds on is fresh" if _nec(sid) else "another try at this one",
                    retry=True)

    deferred = None
    for sid in s["scope"]["order"]:
        r = settle(sid, 0, None)
        if r == "defer":
            deferred = deferred or sid
        elif r:
            return r
    if deferred:
        return turn(deferred, "another try at this one", retry=True)
    return {"type": "done", "reason": "everything in this practice is done for now"}
