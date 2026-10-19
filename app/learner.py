"""What the student knows: an append-only evidence log, per-question review scheduling, and skill states derived from
explicit rules.

Owner (2026-09-23): "I'm basically a lobotomite on all topics till I refresh them" — nothing counts as known until
it is checked. Rules (DESIGN-1.0 §3, revised after the Astra review):
  not_checked  no evidence at all
  seen         only exposure (teaching, discussion or revealed help) — never counts as recall
  gap          the latest graded answer is a miss / "I don't know yet"
  learning     at least one correct check, latest graded is correct
  confirmed    >= 2 unhinted correct checks on different days using >= 2 different questions, latest correct
  mastered     confirmed + a transfer success (an unseen problem solved) + >= 21 days between first and latest success
Due: a retrieval item (question or card) of the skill is due in its FSRS schedule.
A correct placement answer only marks that skill; its prerequisites stay as they were.
"""
from __future__ import annotations

import json
import sqlite3
import time
from datetime import datetime, timedelta, timezone

from fsrs import Card, Rating, Scheduler

from . import curriculum

GRADED = {"check", "review", "transfer"}
MISS = {"wrong", "dont_know", "revealed"}
HIT = {"correct", "correct_hint"}
EXPOSURE = {"taught", "asked", "self"}
KINDS = GRADED | EXPOSURE
OUTCOMES = MISS | HIT | {"exposure"}
SOURCES = {"placement", "session", "coach", "quick", "chat", "review", "note", "daily"}
STATES = ["not_checked", "gap", "seen", "learning", "confirmed", "mastered"]
MASTERY_DAYS = 21

SCHEDULER = Scheduler(desired_retention=0.9, learning_steps=(timedelta(minutes=10),),
                      relearning_steps=(timedelta(minutes=10),), enable_fuzzing=False)


def ensure_tables(conn: sqlite3.Connection) -> None:
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS evidence(
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL NOT NULL, skill_id TEXT NOT NULL, kind TEXT NOT NULL,
        outcome TEXT NOT NULL, source TEXT NOT NULL, ref TEXT, detail TEXT, dedup TEXT UNIQUE);
    CREATE INDEX IF NOT EXISTS evidence_skill ON evidence(skill_id, ts);
    CREATE TABLE IF NOT EXISTS attempts(
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL NOT NULL, question_id TEXT NOT NULL, qversion TEXT NOT NULL,
        choice_order TEXT, picked INTEGER, correct INTEGER NOT NULL, dont_know INTEGER NOT NULL DEFAULT 0,
        hinted INTEGER NOT NULL DEFAULT 0, grader TEXT NOT NULL, source TEXT NOT NULL, session_id TEXT, dedup TEXT UNIQUE);
    CREATE INDEX IF NOT EXISTS attempts_q ON attempts(question_id, ts);
    CREATE TABLE IF NOT EXISTS item_state(
        item_id TEXT PRIMARY KEY, skill_id TEXT, card TEXT NOT NULL, updated_ts REAL NOT NULL);
    CREATE INDEX IF NOT EXISTS item_state_skill ON item_state(skill_id);
    """)


def _utc(ts: float) -> datetime:
    return datetime.fromtimestamp(ts, tz=timezone.utc)


def record(conn, skill_id: str, kind: str, outcome: str, source: str, *, ref: str = "", detail: dict | None = None,
           dedup: str | None = None, now: float | None = None) -> bool:
    """Append one piece of evidence. Returns False if this exact event (dedup key) was already recorded."""
    if skill_id not in curriculum.load()["skills"]:
        raise KeyError(f"unknown skill {skill_id}")
    if kind not in KINDS or outcome not in OUTCOMES or source not in SOURCES:
        raise ValueError(f"bad evidence {kind}/{outcome}/{source}")
    if kind in EXPOSURE and outcome != "exposure":
        raise ValueError("exposure evidence must have outcome 'exposure'")
    if kind in GRADED and outcome == "exposure":
        raise ValueError("graded evidence needs a graded outcome")
    try:
        conn.execute("INSERT INTO evidence(ts, skill_id, kind, outcome, source, ref, detail, dedup) VALUES(?,?,?,?,?,?,?,?)",
                     (now or time.time(), skill_id, kind, outcome, source, ref[:200], json.dumps(detail or {})[:4000], dedup))
    except sqlite3.IntegrityError:
        return False
    return True


def _rating(outcome: str) -> Rating:
    return Rating.Good if outcome == "correct" else Rating.Hard if outcome == "correct_hint" else Rating.Again


def review_item(conn, item_id: str, skill_id: str | None, outcome: str, now: float | None = None, rating: Rating | None = None) -> dict:
    """Advance one retrieval item's FSRS schedule (a question by outcome, or a card by its own 4-grade rating)."""
    now = now or time.time()
    row = conn.execute("SELECT card FROM item_state WHERE item_id=?", (item_id,)).fetchone()
    card = Card.from_dict(json.loads(row[0])) if row else Card()
    card, _log = SCHEDULER.review_card(card, rating or _rating(outcome), review_datetime=_utc(now))
    conn.execute("INSERT INTO item_state(item_id, skill_id, card, updated_ts) VALUES(?,?,?,?) "
                 "ON CONFLICT(item_id) DO UPDATE SET card=excluded.card, updated_ts=excluded.updated_ts, skill_id=excluded.skill_id",
                 (item_id, skill_id, json.dumps(card.to_dict()), now))
    return {"item_id": item_id, "due_ts": card.due.timestamp(), "stability": card.stability}


def answer_question(conn, question_id: str, *, picked: int | None, dont_know: bool, choice_order: list[int] | None,
                    source: str, session_id: str | None = None, hinted: bool = False, dedup: str | None = None,
                    now: float | None = None) -> dict:
    """Grade a multiple-choice answer from the answer key (choice 0 of the stored question is correct), then record the
    attempt, the evidence and the item schedule. `picked` indexes the shown order; `choice_order` maps shown -> stored."""
    cur = curriculum.load()
    q = cur["questions"].get(question_id)
    if not q:
        raise KeyError(question_id)
    now = now or time.time()
    order = choice_order if choice_order else list(range(len(q["choices"])))
    if sorted(order) != list(range(len(q["choices"]))):
        raise ValueError("choice_order must be a permutation of the question's choices")
    stored = None if dont_know or picked is None else order[int(picked)]
    correct = stored == 0
    outcome = "dont_know" if dont_know else ("correct_hint" if (correct and hinted) else "correct" if correct else "wrong")
    qv = cur["questions_version"] or "1"
    dk = dedup or f"attempt:{question_id}:{now:.3f}"
    try:
        conn.execute("INSERT INTO attempts(ts, question_id, qversion, choice_order, picked, correct, dont_know, hinted, grader,"
                     " source, session_id, dedup) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                     (now, question_id, qv, json.dumps(order), picked, int(correct), int(dont_know), int(hinted), "answer-key",
                      source, session_id, dk))
    except sqlite3.IntegrityError:
        return {"duplicate": True, "correct": correct, "outcome": outcome}
    record(conn, q["skill"], "check", outcome, source, ref=f"{question_id}@{qv}", detail={"picked": stored}, dedup=dk, now=now)
    sched = review_item(conn, "q:" + question_id, q["skill"], outcome, now)
    return {"correct": correct, "outcome": outcome, "skill": q["skill"], "answer_index": order.index(0),
            "why": q["why"], "due_ts": sched["due_ts"]}


def _day(ts: float) -> str:
    return datetime.fromtimestamp(ts).strftime("%Y-%m-%d")


def skill_state(rows: list[dict], due_items: int = 0) -> dict:
    """Derive one skill's state from its evidence rows (oldest first)."""
    if not rows:
        return {"state": "not_checked", "due": False, "evidence": 0}
    # Old reveal rows remain intact, but reading help is neither a graded miss
    # nor a successful check. It cannot erase earlier answer evidence.
    graded = [r for r in rows if r["kind"] in GRADED and r['outcome'] != 'revealed']
    if not graded:
        return {"state": "seen", "due": False, "evidence": len(rows), "last_ts": rows[-1]["ts"]}
    last = graded[-1]
    base = {"due": due_items > 0, "evidence": len(rows), "last_ts": rows[-1]["ts"], "last_graded": last["outcome"]}
    if last["outcome"] in MISS:
        return {"state": "gap", **base}
    clean = [r for r in graded if r["outcome"] == "correct"]
    days = {_day(r["ts"]) for r in clean}
    items = {r["kind"] + ":" + (r["ref"] or "").split("@")[0] for r in clean}   # different questions/cards/problems
    if len(days) >= 2 and len(items) >= 2:
        hits = [r for r in graded if r["outcome"] in HIT]
        transfer = any(r["kind"] == "transfer" and r["outcome"] == "correct" for r in graded)
        if transfer and hits and (hits[-1]["ts"] - hits[0]["ts"]) >= MASTERY_DAYS * 86400:
            return {"state": "mastered", **base}
        return {"state": "confirmed", **base}
    return {"state": "learning", **base}


def states(conn, now: float | None = None) -> dict[str, dict]:
    """State of every skill in the map."""
    now = now or time.time()
    by: dict[str, list[dict]] = {}
    for r in conn.execute("SELECT ts, skill_id, kind, outcome, source, ref FROM evidence ORDER BY ts, id"):
        by.setdefault(r[1], []).append({"ts": r[0], "kind": r[2], "outcome": r[3], "source": r[4], "ref": r[5]})
    due: dict[str, int] = {}
    for item_id, skill_id, card in conn.execute("SELECT item_id, skill_id, card FROM item_state"):
        c = json.loads(card)
        try:
            due_ts = datetime.fromisoformat(c["due"]).timestamp()
        except Exception:  # noqa: BLE001
            continue
        if skill_id and due_ts <= now:
            due[skill_id] = due.get(skill_id, 0) + 1
    out = {}
    from .learning_progress import evidence_support
    for sid in curriculum.load()["skills"]:
        out[sid] = skill_state(by.get(sid, []), due.get(sid, 0))
        out[sid]['support'] = evidence_support(by.get(sid, []))
    return out


def evidence_for(conn, skill_id: str, limit: int = 30) -> list[dict]:
    return [{"ts": r[0], "kind": r[1], "outcome": r[2], "source": r[3], "ref": r[4], "detail": json.loads(r[5] or "{}")}
            for r in conn.execute("SELECT ts, kind, outcome, source, ref, detail FROM evidence WHERE skill_id=? ORDER BY ts DESC, id DESC LIMIT ?",
                                  (skill_id, limit))]


def due_items(conn, now: float | None = None, limit: int = 50) -> list[dict]:
    now = now or time.time()
    out = []
    for item_id, skill_id, card in conn.execute("SELECT item_id, skill_id, card FROM item_state"):
        due_ts = datetime.fromisoformat(json.loads(card)["due"]).timestamp()
        if due_ts <= now:
            out.append({"item_id": item_id, "skill_id": skill_id, "due_ts": due_ts})
    out.sort(key=lambda x: x["due_ts"])
    return out[:limit]
