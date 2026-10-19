"""Remembering: flashcards with spaced repetition, and the follow-up conversation of each problem.

The owner (2026-09-22): "I don't study and wait till the last minute and basically forget everything prior."
Every solved lesson contributes its key ideas as cards; a starter deck covers Morin ch. 8-9 essentials.
Scheduling is a small SM-2 variant: again (10 min), hard, good, easy. Everything lives in kinema.db beside
the saved problems, in tables that 0.4 never touches.
"""
from __future__ import annotations

import json
import sqlite3
import time
import uuid
from datetime import datetime, timedelta

DAY = 86400.0
NEW_PER_DAY = 12
SEED_KEY = "seed_morin_8_9_v1"


def ensure_tables(conn: sqlite3.Connection) -> None:
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS cards(
        id TEXT PRIMARY KEY, problem_id TEXT, front TEXT NOT NULL, back TEXT NOT NULL, topic TEXT, source TEXT,
        created_ts REAL NOT NULL, due_ts REAL NOT NULL, interval_days REAL NOT NULL DEFAULT 0,
        ease REAL NOT NULL DEFAULT 2.5, reps INTEGER NOT NULL DEFAULT 0, lapses INTEGER NOT NULL DEFAULT 0,
        last_ts REAL, suspended INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS cards_due ON cards(suspended, due_ts);
    CREATE TABLE IF NOT EXISTS reviews(id INTEGER PRIMARY KEY AUTOINCREMENT, card_id TEXT NOT NULL, ts REAL NOT NULL,
        grade TEXT NOT NULL, was_new INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT, problem_id TEXT NOT NULL,
        role TEXT NOT NULL, content TEXT NOT NULL, ts REAL NOT NULL, meta TEXT);
    CREATE INDEX IF NOT EXISTS messages_problem ON messages(problem_id, id);
    CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT);
    """)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(cards)")}
    if "skill_id" not in cols:                                   # 1.0: cards can point at a skill on the map
        conn.execute("ALTER TABLE cards ADD COLUMN skill_id TEXT")


def _row(r: sqlite3.Row) -> dict:
    return {k: r[k] for k in r.keys()}


def add_card(conn, front: str, back: str, *, topic: str = "", source: str = "lesson", problem_id: str | None = None,
             now: float | None = None) -> str | None:
    front, back = (front or "").strip()[:2000], (back or "").strip()[:4000]
    if not front or not back:
        return None
    if conn.execute("SELECT 1 FROM cards WHERE front=? AND back=?", (front, back)).fetchone():
        return None
    cid = uuid.uuid4().hex[:12]
    now = now or time.time()
    conn.execute("INSERT INTO cards(id,problem_id,front,back,topic,source,created_ts,due_ts) VALUES(?,?,?,?,?,?,?,?)",
                 (cid, problem_id, front, back, topic[:80], source[:40], now, now))
    return cid


def add_lesson_cards(conn, lesson: dict, problem_id: str) -> list[str]:
    topic = str(lesson.get("domain") or "")[:80]
    ids = []
    for idea in lesson.get("key_ideas") or []:
        cid = add_card(conn, idea.get("front", ""), idea.get("back", ""), topic=topic, source="lesson", problem_id=problem_id)
        if cid:
            ids.append(cid)
    return ids


def schedule(card: dict, grade: str, now: float) -> dict:
    """SM-2 variant. Returns the new scheduling fields."""
    ease, interval, reps, lapses = card["ease"], card["interval_days"], card["reps"], card["lapses"]
    if grade == "again":
        return {"ease": max(1.3, ease - 0.2), "interval_days": 0.0, "reps": 0, "lapses": lapses + 1, "due_ts": now + 600}
    if grade == "hard":
        ease = max(1.3, ease - 0.15)
        interval = 1.0 if reps == 0 else max(1.0, interval * 1.2)
    elif grade == "good":
        interval = 1.0 if reps == 0 else 3.0 if reps == 1 else max(interval + 1, interval * ease)
    elif grade == "easy":
        interval = 4.0 if reps == 0 else max(interval + 1, interval * ease * 1.3)
        ease = ease + 0.15
    else:
        raise ValueError("grade must be again, hard, good or easy")
    return {"ease": round(ease, 3), "interval_days": round(interval, 3), "reps": reps + 1, "lapses": lapses,
            "due_ts": now + interval * DAY}


def _day_start(now: float) -> float:
    d = datetime.fromtimestamp(now)
    return datetime(d.year, d.month, d.day).timestamp()


def queue(conn, now: float | None = None, limit: int = 50) -> list[dict]:
    """Due review cards first (oldest due first), then new cards within today's allowance."""
    now = now or time.time()
    due = [_row(r) for r in conn.execute(
        "SELECT * FROM cards WHERE suspended=0 AND (reps>0 OR lapses>0 OR last_ts IS NOT NULL) AND due_ts<=? ORDER BY due_ts LIMIT ?",
        (now, limit))]
    new_seen = conn.execute("SELECT COUNT(*) FROM reviews WHERE was_new=1 AND ts>=?", (_day_start(now),)).fetchone()[0]
    room = max(0, min(limit - len(due), NEW_PER_DAY - new_seen))
    new = [_row(r) for r in conn.execute(
        "SELECT * FROM cards WHERE suspended=0 AND last_ts IS NULL ORDER BY (source='seed'), created_ts LIMIT ?", (room,))] if room else []
    return due + new


def summary(conn, now: float | None = None) -> dict:
    now = now or time.time()
    q = queue(conn, now, limit=500)
    total = conn.execute("SELECT COUNT(*) FROM cards WHERE suspended=0").fetchone()[0]
    today = conn.execute("SELECT COUNT(*) FROM reviews WHERE ts>=?", (_day_start(now),)).fetchone()[0]
    days = {datetime.fromtimestamp(r[0]).date() for r in conn.execute("SELECT ts FROM reviews WHERE ts>=?", (now - 400 * DAY,))}
    streak, day = 0, datetime.fromtimestamp(now).date()
    if day not in days:
        day -= timedelta(days=1)
    while day in days:
        streak += 1
        day -= timedelta(days=1)
    return {"due": sum(1 for c in q if c["last_ts"] is not None), "new": sum(1 for c in q if c["last_ts"] is None),
            "total": total, "reviewed_today": today, "streak_days": streak}


def review(conn, card_id: str, grade: str, now: float | None = None) -> dict:
    now = now or time.time()
    r = conn.execute("SELECT * FROM cards WHERE id=?", (card_id,)).fetchone()
    if not r:
        raise KeyError(card_id)
    card = _row(r)
    if grade not in ("again", "hard", "good", "easy"):
        raise ValueError("grade must be again, hard, good or easy")
    from fsrs import Rating                                    # 1.0: cards use the same FSRS scheduler as questions
    from . import learner
    rating = {"again": Rating.Again, "hard": Rating.Hard, "good": Rating.Good, "easy": Rating.Easy}[grade]
    sched = learner.review_item(conn, "c:" + card_id, card.get("skill_id"), "correct", now, rating=rating)
    interval = max(0.0, (sched["due_ts"] - now) / DAY)
    upd = {"ease": card["ease"], "interval_days": round(interval, 3), "reps": card["reps"] + (0 if grade == "again" else 1),
           "lapses": card["lapses"] + (1 if grade == "again" and card["reps"] else 0), "due_ts": sched["due_ts"]}
    conn.execute("UPDATE cards SET ease=?, interval_days=?, reps=?, lapses=?, due_ts=?, last_ts=? WHERE id=?",
                 (upd["ease"], upd["interval_days"], upd["reps"], upd["lapses"], upd["due_ts"], now, card_id))
    conn.execute("INSERT INTO reviews(card_id, ts, grade, was_new) VALUES(?,?,?,?)", (card_id, now, grade, 1 if card["last_ts"] is None else 0))
    return {**card, **upd, "last_ts": now}


def add_message(conn, problem_id: str, role: str, content: str, meta: dict | None = None) -> None:
    conn.execute("INSERT INTO messages(problem_id, role, content, ts, meta) VALUES(?,?,?,?,?)",
                 (problem_id, role, content[:20000], time.time(), json.dumps(meta or {})))


def messages(conn, problem_id: str) -> list[dict]:
    return [{"role": r["role"], "content": r["content"], "ts": r["ts"],
             "context_usage": json.loads(r["meta"] or "{}").get("context_usage")}
            for r in conn.execute("SELECT role, content, ts, meta FROM messages WHERE problem_id=? ORDER BY id", (problem_id,))]


# ── the starter deck: Morin ch. 8 (constant L-hat) and ch. 9 (general L-hat) ──────────────────────────────────
SEED = [
    ("Strategy", "Before plugging in numbers, what three checks catch most mistakes?",
     "Units (every term), limiting cases (e.g. $\\theta\\to0$, $m\\to\\infty$), and symmetry or sign sense. Solve symbolically first; numbers last."),
    ("Morin 8", "Angular momentum of a pancake object spinning about the $z$ axis?",
     "$L_z = I_z\\,\\omega$ with $I_z=\\int (x^2+y^2)\\,dm$ about that axis."),
    ("Morin 8", "Parallel-axis theorem?", "$I = I_{CM} + Md^2$, where $d$ is the distance between the axis and a parallel axis through the CM."),
    ("Morin 8", "Perpendicular-axis theorem (flat objects only)?", "$I_z = I_x + I_y$ for a pancake in the $x$-$y$ plane."),
    ("Morin 8", "Moments of inertia: rod about its centre and end; ring; disk; solid sphere; spherical shell?",
     "Rod $\\tfrac1{12}ML^2$ (centre), $\\tfrac13ML^2$ (end); ring $MR^2$; disk $\\tfrac12MR^2$; solid sphere $\\tfrac25MR^2$; shell $\\tfrac23MR^2$."),
    ("Morin 8", "About which points does $\\vec\\tau = d\\vec L/dt$ hold?",
     "About a fixed point, or about the CM (even when the CM accelerates). Not about an arbitrary accelerating point."),
    ("Morin 8", "Kinetic energy of a rigid body in terms of its CM?", "$KE = \\tfrac12 Mv_{CM}^2 + \\tfrac12 I_{CM}\\,\\omega^2$ (plane motion)."),
    ("Morin 8", "Angular momentum of a body about an origin, split into CM parts?",
     "$\\vec L = \\vec R_{CM}\\times M\\vec V_{CM} + \\vec L_{CM}$: orbital part plus spin about the CM."),
    ("Morin 8", "Rolling without slipping on flat ground: relation between $v$ and $\\omega$?",
     "$v_{CM} = \\omega R$ and $a = \\alpha R$; the contact point is instantaneously at rest."),
    ("Morin 8", "Acceleration of an object rolling without slipping down an incline?",
     "$a = \\dfrac{g\\sin\\theta}{1+I/MR^2}$; solid sphere $\\tfrac57 g\\sin\\theta$, cylinder $\\tfrac23 g\\sin\\theta$, hoop $\\tfrac12 g\\sin\\theta$."),
    ("Morin 8", "Angular impulse: what does a blow $J$ at distance $d$ from the CM do to a free body?",
     "$\\Delta P = J$ and $\\Delta L_{CM} = Jd$, so $\\Delta v_{CM}=J/M$ and $\\Delta\\omega = Jd/I_{CM}$."),
    ("Morin 8", "In a collision with a pivot, which angular momentum is conserved?",
     "Angular momentum about the pivot (the pivot's impulsive force has no torque about it). Linear momentum is not conserved."),
    ("Morin 8", "Physical pendulum: small-oscillation frequency?", "$\\omega = \\sqrt{\\dfrac{Mgd}{I_{pivot}}}$, $d$ = pivot-to-CM distance."),
    ("Morin 8", "Centre of percussion of a uniform stick held at one end?", "At $\\tfrac23L$ from the held end: a blow there gives no impulse at the hand."),
    ("Morin 9", "General motion of a rigid body?",
     "A translation of any chosen point plus a rotation about an axis through it; $\\vec\\omega$ is the same whichever point you choose."),
    ("Morin 9", "Velocity of a point of a rigid body?", "$\\vec v = \\vec v_O + \\vec\\omega\\times\\vec r$, with $\\vec r$ measured from the reference point $O$."),
    ("Morin 9", "The inertia tensor: diagonal and off-diagonal entries?",
     "$I_{xx}=\\int(y^2+z^2)dm$ etc.; $I_{xy}=-\\int xy\\,dm$ etc. Then $\\vec L = \\mathbf I\\,\\vec\\omega$."),
    ("Morin 9", "Kinetic energy with the inertia tensor?", "$KE = \\tfrac12\\,\\vec\\omega\\cdot\\vec L = \\tfrac12\\,\\vec\\omega^T\\mathbf I\\,\\vec\\omega$."),
    ("Morin 9", "What is a principal axis?", "An axis for which $\\vec L\\parallel\\vec\\omega$: $\\mathbf I\\vec\\omega=\\lambda\\vec\\omega$. Every body has three orthogonal principal axes (eigenvectors of $\\mathbf I$)."),
    ("Morin 9", "When is $\\vec L$ parallel to $\\vec\\omega$?", "Only when $\\vec\\omega$ lies along a principal axis (about the point you use). Otherwise $\\vec L$ tilts toward the axis with the larger moment."),
    ("Morin 9", "Symmetry shortcut for principal axes?",
     "A symmetry axis (rotational symmetry of order $\\ge 3$) is principal, and every perpendicular axis through that point is principal with equal moments."),
    ("Morin 9", "Moment of inertia of a uniform cube about any axis through its centre?", "$\\tfrac16 Ma^2$: the cube's symmetry makes every axis through the centre principal with the same moment."),
    ("Morin 9", "Parallel-axis theorem for the inertia tensor?",
     "$I_{ij} = I^{CM}_{ij} + M(R^2\\delta_{ij} - R_iR_j)$ for a shift $\\vec R$ from the CM."),
    ("Morin 9", "Type 1 problem: a body is struck. How do you find the motion right after?",
     "Angular impulse gives $\\vec L$ (about the CM or a fixed point); then solve $\\mathbf I\\vec\\omega = \\vec L$ for $\\vec\\omega$ (use principal axes)."),
    ("Morin 9", "Type 2 problem: what equation finds a precession frequency?",
     "$\\vec\\tau = d\\vec L/dt$ with $\\vec L$ changing direction; in steady motion $d\\vec L/dt = \\vec\\Omega\\times\\vec L$."),
    ("Morin 9", "Euler's equations?",
     "In the principal body frame: $I_1\\dot\\omega_1 + (I_3-I_2)\\,\\omega_2\\omega_3 = \\tau_1$ and cyclic permutations."),
    ("Morin 9", "Free symmetric top ($I_1=I_2=I$), seen from the body: what does $\\vec\\omega$ do?",
     "It precesses around the symmetry axis at $\\Omega_b = \\dfrac{I_3-I}{I}\\,\\omega_3$, with $\\omega_3$ constant."),
    ("Morin 9", "Free symmetric top seen from the fixed frame?",
     "$\\vec L$ is fixed; the symmetry axis and $\\vec\\omega$ precess around $\\vec L$ at $\\Omega_s = L/I$."),
    ("Morin 9", "Tennis racket theorem?", "Rotation about the axis with the largest or smallest principal moment is stable; about the intermediate one it is unstable."),
    ("Morin 9", "Euler angles in Morin's top analysis, and $\\vec\\omega$ in terms of them?",
     "$\\phi$ precession about $\\hat z$, $\\theta$ tilt from $\\hat z$, $\\psi$ spin about the symmetry axis: $\\vec\\omega = \\dot\\phi\\,\\hat z + \\dot\\theta\\,\\hat n + \\dot\\psi\\,\\hat x_3$, with $\\hat n$ the horizontal line of nodes."),
    ("Morin 9", "Heavy symmetric top in steady precession: the exact condition?",
     "$Mg\\ell = \\Omega\\,(I_3\\omega_3 - I\\,\\Omega\\cos\\theta)$ with $\\omega_3 = \\dot\\psi + \\Omega\\cos\\theta$ and $I$ about a perpendicular axis through the pivot."),
    ("Morin 9", "Fast top: approximate slow precession rate?", "$\\Omega \\approx \\dfrac{Mg\\ell}{I_3\\,\\omega_3}$: faster spin means slower precession."),
    ("Morin 9", "Which way does a gyroscope precess?", "$\\vec L$ moves toward the torque: $d\\vec L = \\vec\\tau\\,dt$. The axis swings sideways, it does not fall."),
    ("Morin 9", "A fast top released at rest with its axis tilted: what does the tip do?",
     "It nutates: it dips slightly and traces cusps while drifting at the average precession rate $\\approx Mg\\ell/(I_3\\omega_3)$; nutation frequency $\\approx I_3\\omega_3/I$."),
    ("Morin 9", "Stability of a vertical (sleeping) top?", "Stable when $I_3^2\\,\\omega_3^2 > 4\\,I\\,Mg\\ell$."),
    ("Morin 9", "Rolling cone or coin: where is the instantaneous axis of rotation?",
     "Along the line of points at rest: the contact line of a cone (through its fixed apex), or through a coin's contact point and the fixed point on its axis."),
    ("Morin 9", "How do angular velocities combine?", "They add as vectors: e.g. $\\vec\\omega = \\Omega\\hat z + \\omega'\\hat e_3$ for a spinning body whose axis precesses."),
]


def seed(conn, now: float | None = None) -> int:
    """Insert the starter deck once; deleting or suspending seed cards later is respected."""
    if conn.execute("SELECT value FROM kv WHERE key=?", (SEED_KEY,)).fetchone():
        return 0
    now = now or time.time()
    added = 0
    for i, (topic, front, back) in enumerate(SEED):
        if add_card(conn, front, back, topic=topic, source="seed", now=now + i * 1e-3):
            added += 1
    conn.execute("INSERT INTO kv(key, value) VALUES(?, ?)", (SEED_KEY, str(now)))
    return added
