"""30-minute sessions (owner, 2026-09-23): placement while the map is mostly unknown, refreshers on the lowest gaps first,
due checks and cards in reserved time, and nothing that piles up after missed days.

The next item is derived from the evidence every time, so a closed tab, a restart or the next morning resumes where
the knowledge actually is (Astra review: "close/reopen mid-session, return next day"). Placement follows the review's
correction: a correct answer defers probing what lies beneath it but never marks it known; a miss or "I don't know
yet" probes the prerequisites; and now and then a skipped prerequisite is sampled to catch lucky answers.
"""
from __future__ import annotations

import json
import random
import sqlite3
import time
import uuid

from . import curriculum, learner, notes, practice, study

BUDGET_S = 30 * 60
COST = {"placement": 45, "refresh": 360, "check": 60, "card": 25, "example": 150, "turn": 60, "sheet": 90, "rung": 150}
REVIEW_SHARE = 0.4              # due checks and cards may use at most this share; refreshers can't eat all of it either
PLACEMENT_MAX = 8               # questions per session while the map is mostly unknown (5-8 minutes)
MAX_DUE_ITEMS = 12              # after missed days, cap what comes back in one session
SAMPLE_EVERY = 4                # every 4th placement question samples a prerequisite beneath a correct answer
NEW_CARDS_PER_SESSION = 4       # the starter deck trickles in; review can't grow into a pile
UNTESTED = ("not_checked", "seen")  # asked about or taught is exposure, not recall: still to be checked


def ensure_tables(conn: sqlite3.Connection) -> None:
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS sessions(
        id TEXT PRIMARY KEY, started_ts REAL NOT NULL, ended_ts REAL, budget_s INTEGER NOT NULL, items TEXT NOT NULL DEFAULT '[]');
    """)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(sessions)")}
    if "mode" not in cols:                       # 1.1: example-first practice sessions carry their scope
        conn.execute("ALTER TABLE sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'daily'")
    if "scope" not in cols:
        conn.execute("ALTER TABLE sessions ADD COLUMN scope TEXT")


def _route_targets() -> list[str]:
    cur = curriculum.load()
    hw = [s for s in cur["class_now"].get("homework", []) if s in cur["skills"]]
    return hw or [k for k, v in cur["skills"].items() if v["chapter"] == cur["class_now"].get("chapter")]


def _nec(sid: str) -> list[str]:
    return [p["id"] for p in curriculum.load()["skills"][sid]["prereqs"] if p["type"] == "necessary"]


def placement_next(states: dict, asked_today: set[str], n_placed: int, rnd: random.Random) -> str | None:
    """The next skill to probe, or None when placement has nothing useful left to ask right now."""
    route = curriculum.class_route()
    on_route = set(route)
    # 1. below a gap: its unchecked necessary prerequisites (probe downward to find the floor)
    for sid in reversed(route):
        if states[sid]["state"] == "gap":
            for p in _nec(sid):
                if states[p]["state"] in UNTESTED and p not in asked_today:
                    return p
    # 2. every SAMPLE_EVERY-th question: a prerequisite beneath a correct answer (catch lucky guesses)
    if n_placed and n_placed % SAMPLE_EVERY == SAMPLE_EVERY - 1:
        hidden = sorted({p for sid in route if states[sid]["state"] in ("learning", "confirmed") for p in _nec(sid)
                         if states[p]["state"] in UNTESTED and p not in asked_today})
        if hidden:
            return rnd.choice(hidden)
    # 3. top-down from what class needs now: the highest unchecked skill whose dependents aren't already understood
    order = [s for s in reversed(route) if s in on_route]
    targets = _route_targets()
    order.sort(key=lambda s: (0 if s in targets else 1, -route.index(s)))
    for sid in order:
        if states[sid]["state"] not in UNTESTED or sid in asked_today:
            continue
        above = [u for u in curriculum.load()["skills"][sid]["used_by"] if u in on_route]
        # skip a skill whose every dependent was answered correctly: probing it is deferred, not assumed known
        if above and all(states[u]["state"] in ("learning", "confirmed", "mastered") for u in above):
            continue
        return sid
    return None


OK_STATES = ("learning", "confirmed", "mastered")


def refresh_next(states: dict, done_today: set[str], *, strict: bool = True) -> str | None:
    """The lowest gap on the route (rebuild from the floor). Strict: every necessary prerequisite has been checked and
    passed, so placement first finds out whether the floor lies deeper. Not strict: no prerequisite is a known gap."""
    for sid in curriculum.class_route():
        if states[sid]["state"] != "gap" or sid in done_today:
            continue
        pre = [states[p]["state"] for p in _nec(sid)]
        if (all(x in OK_STATES for x in pre) if strict else not any(x == "gap" for x in pre)):
            return sid
    return None


def _day_start(now: float) -> float:
    lt = time.localtime(now)
    return time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, 0, 0, 0, 0, 0, -1))


def get_or_start(conn, now: float | None = None, budget: int = BUDGET_S) -> dict:
    """Today's open session, or a new one."""
    now = now or time.time()
    row = conn.execute("SELECT * FROM sessions WHERE ended_ts IS NULL AND started_ts>=? ORDER BY started_ts DESC LIMIT 1",
                       (_day_start(now),)).fetchone()
    if row:
        return _session(row)
    sid = uuid.uuid4().hex[:10]
    conn.execute("INSERT INTO sessions(id, started_ts, budget_s) VALUES(?,?,?)", (sid, now, budget))
    return {"id": sid, "started_ts": now, "ended_ts": None, "budget_s": budget, "items": []}


def _session(row) -> dict:
    return {"id": row[0], "started_ts": row[1], "ended_ts": row[2], "budget_s": row[3], "items": json.loads(row[4] or "[]"),
            "mode": row[5] if len(row) > 5 and row[5] else "daily", "scope": json.loads(row[6]) if len(row) > 6 and row[6] else None}


def start_practice(conn, scope: dict, now: float | None = None, budget: int = BUDGET_S) -> dict:
    """A new practice session for this scope; today's other open sessions end (one thing at a time)."""
    now = now or time.time()
    conn.execute("UPDATE sessions SET ended_ts=? WHERE ended_ts IS NULL", (now,))
    sid = uuid.uuid4().hex[:10]
    conn.execute("INSERT INTO sessions(id, started_ts, budget_s, mode, scope) VALUES(?,?,?,?,?)",
                 (sid, now, budget, "lesson" if scope.get("lesson") else "practice", json.dumps(scope)))
    return get(conn, sid)


def resume_or_practice(conn, now: float | None = None) -> dict:
    """The Start button: today's open session if there is one, else practice on what class needs now."""
    now = now or time.time()
    row = conn.execute("SELECT * FROM sessions WHERE ended_ts IS NULL AND started_ts>=? ORDER BY started_ts DESC LIMIT 1",
                       (_day_start(now),)).fetchone()
    return _session(row) if row else start_practice(conn, practice.default_scope(), now)


def extend(conn, sid: str, secs: int = BUDGET_S) -> None:
    conn.execute("UPDATE sessions SET budget_s=budget_s+?, ended_ts=NULL WHERE id=?", (secs, sid))


def get(conn, sid: str) -> dict | None:
    row = conn.execute("SELECT * FROM sessions WHERE id=?", (sid,)).fetchone()
    return _session(row) if row else None


def log_item(conn, sid: str, item: dict) -> None:
    s = get(conn, sid)
    if not s:
        return
    keys = ("type", "skill", "question_id", "card_id", "outcome", "ts", "secs", "new", "retry", "rung", "start_at", "lesson")
    items = s["items"] + [{k: item.get(k) for k in keys if item.get(k) is not None}]
    conn.execute("UPDATE sessions SET items=? WHERE id=?", (json.dumps(items[-200:]), sid))


def end(conn, sid: str, now: float | None = None) -> None:
    conn.execute("UPDATE sessions SET ended_ts=? WHERE id=? AND ended_ts IS NULL", (now or time.time(), sid))


def _spent(s: dict) -> dict:
    out = {"placement": 0, "refresh": 0, "check": 0, "card": 0}
    for it in s["items"]:
        out[it.get("type") or "check"] = out.get(it.get("type") or "check", 0) + (it.get("secs") or COST.get(it.get("type"), 60))
    return out


def next_item(conn, s: dict, now: float | None = None, rnd: random.Random | None = None) -> dict:
    """What the session shows next. Types: refresh | check | card | placement | done."""
    now = now or time.time()
    rnd = rnd or random.Random()
    states = learner.states(conn, now)
    spent = _spent(s)
    used = sum(spent.values())
    budget = s["budget_s"]
    if used >= budget:
        return {"type": "done", "reason": "time"}
    if s.get("mode") == "practice":
        return practice.next_item(conn, s, states)
    if s.get("mode") == "lesson":
        return practice.lesson_next(conn, s)
    today = _day_start(now)
    asked_today = {r[0] for r in conn.execute("SELECT DISTINCT e.skill_id FROM evidence e WHERE e.ts>=? AND e.kind='check'", (today,))}
    placed = sum(1 for it in s["items"] if it.get("type") == "placement")
    review_room = REVIEW_SHARE * budget - (spent["check"] + spent["card"])
    items_done = {(it.get("type"), it.get("skill") or it.get("card_id") or it.get("question_id")) for it in s["items"]}

    # 1. due checks (FSRS) and due cards, in reserved time, capped after missed days
    if review_room > 0:
        n_review = sum(1 for it in s["items"] if it.get("type") in ("check", "card"))
        if n_review < MAX_DUE_ITEMS:
            for d in learner.due_items(conn, now):
                if not d["item_id"].startswith("q:"):
                    continue
                qid = d["item_id"][2:]
                if ("check", d["skill_id"]) in items_done or qid not in curriculum.load()["questions"]:
                    continue
                return {"type": "check", "skill": d["skill_id"], "question_id": qid, "reason": "due for a check"}
            for c in study.queue(conn, now, limit=12):
                if c.get("last_ts") is not None and ("card", c["id"]) not in items_done:
                    return {"type": "card", "card_id": c["id"], "front": c["front"], "back": c["back"], "topic": c.get("topic"),
                            "new": False, "reason": "due card"}
    # 2. refresh the lowest gap (rebuild from the floor)
    done_today = {it.get("skill") for it in s["items"] if it.get("type") == "refresh"}
    gap = refresh_next(states, done_today)
    if gap and used + COST["refresh"] <= budget + 120:
        n = notes.latest(conn, gap)
        return {"type": "refresh", "skill": gap, "has_note": bool(n), "reason": "lowest gap under what class needs"}
    # 3. placement while much of the route is unchecked
    route = curriculum.class_route()
    unchecked = sum(1 for k in route if states[k]["state"] in UNTESTED)
    if placed < PLACEMENT_MAX and unchecked:
        sk = placement_next(states, asked_today, placed, rnd)
        if sk:
            return {"type": "placement", "skill": sk, "reason": "finding where your knowledge starts"}
    # 4. learning skills that haven't been re-checked on a later day (towards "confirmed")
    for sid in route:
        st = states[sid]
        if st["state"] == "learning" and sid not in asked_today:
            return {"type": "check", "skill": sid, "reason": "second check on another day"}
    # 5. a few new cards from the starter deck, after the knowledge work
    new_shown = sum(1 for it in s["items"] if it.get("type") == "card" and it.get("new"))
    if new_shown < NEW_CARDS_PER_SESSION:
        for c in study.queue(conn, now, limit=12):
            if c.get("last_ts") is None and ("card", c["id"]) not in items_done:
                return {"type": "card", "card_id": c["id"], "front": c["front"], "back": c["back"], "topic": c.get("topic"),
                        "new": True, "reason": "new card"}
    # 6. more placement beyond the per-session cap if time remains
    if unchecked:
        sk = placement_next(states, asked_today, placed, rnd)
        if sk:
            return {"type": "placement", "skill": sk, "reason": "finding where your knowledge starts"}
    # 7. nothing left to probe today: refresh the lowest gap even if what's beneath it isn't checked yet
    loose = refresh_next(states, done_today, strict=False)
    if loose:
        return {"type": "refresh", "skill": loose, "has_note": bool(notes.latest(conn, loose)), "reason": "lowest gap found so far"}
    return {"type": "done", "reason": "nothing left for now"}


def plan(conn, now: float | None = None) -> dict:
    """A short forecast for the Atlas side panel."""
    now = now or time.time()
    states = learner.states(conn, now)
    route = curriculum.class_route()
    due_checks = len([d for d in learner.due_items(conn, now) if d["item_id"].startswith("q:")])
    due_cards = sum(1 for c in study.queue(conn, now, limit=200) if c.get("last_ts") is not None)
    gaps = [k for k in route if states[k]["state"] == "gap"]
    unchecked = [k for k in route if states[k]["state"] in UNTESTED]
    lines = []
    review_n = min(MAX_DUE_ITEMS, due_checks + due_cards)
    if review_n:
        lines.append({"text": f"{review_n} due checks and cards", "min": max(1, round(review_n * 50 / 60))})
    if gaps:
        low = refresh_next(states, set())
        lines.append({"text": f"Refresh: {curriculum.load()['skills'][low]['title']}" if low else f"Refresh {len(gaps)} gaps", "min": 6, "skill": low})
    if unchecked:
        n = min(PLACEMENT_MAX, len(unchecked))
        lines.append({"text": f"Placement: {n} questions on what ch. {curriculum.load()['class_now'].get('chapter')} needs", "min": max(4, round(n * 45 / 60))})
    resume = conn.execute("SELECT * FROM sessions WHERE ended_ts IS NULL AND started_ts>=? ORDER BY started_ts DESC LIMIT 1",
                          (_day_start(now),)).fetchone()
    active = _session(resume) if resume else None
    # Match the Start button exactly, including a session opened but not yet answered.
    # This is a read-only preview: no grading, note work or evidence is triggered.
    continuation = None
    if active:
        scope = active.get("scope") or {}
        remaining = max(0, active["budget_s"] - sum(_spent(active).values()))
        continuation = {"mode": active["mode"], "lesson": scope.get("lesson"),
                        "budget_min": round(active["budget_s"] / 60),
                        "remaining_min": int((remaining + 59) // 60)}
        if active["mode"] == "lesson":
            nxt = practice.lesson_next(conn, active)
            continuation["step"] = nxt["type"] if continuation["remaining_min"] else "done"
            if nxt.get("rung"):
                ls = curriculum.load()["lessons"][scope["lesson"]]
                rung = next(r for r in ls["rungs"] if r["n"] == nxt["rung"])
                continuation["next"] = {"n": rung["n"], "title": rung["title"]}
    return {"lines": lines, "route": len(route), "unchecked": len(unchecked), "gaps": len(gaps), "due_checks": due_checks, "due_cards": due_cards,
            "first": not conn.execute("SELECT 1 FROM sessions LIMIT 1").fetchone(), "resume": bool(resume),
            "resume_title": (active.get("scope") or {}).get("title") if active else None,
            "continuation": continuation, "budget_min": BUDGET_S // 60,
            "practice": practice.default_scope()["title"], "examples": len(curriculum.load()["examples"]),
            "lesson": _lesson_plan(conn),
            "active_lesson": _lesson_plan(conn, continuation["lesson"]) if continuation and continuation.get("lesson") else None}


def _lesson_plan(conn, lid: str | None = None) -> dict | None:
    lid = lid or practice.default_scope().get("lesson")
    if not lid:
        return None
    ls = curriculum.load()["lessons"][lid]
    progress = practice.lesson_progress(conn, lid)
    focus = practice.workspace_position(conn, lid)
    if focus:
        r = next(r for r in ls["rungs"] if r["n"] == focus)
        progress["next"] = {"n": focus, "title": r["title"]}
    from . import learning_plan
    return {"modules": learning_plan.modules(lid), "ladder": practice.ladder(conn, {"scope": {"lesson": lid}, "items": []}, focus), "id": lid, "title": ls["title"], "chapters": ls.get("chapters", [ls.get("chapter")]),
            "stages": ls.get("stages", []), "formulas": sum(len(g["formulas"]) for g in ls["groups"]), **progress}
