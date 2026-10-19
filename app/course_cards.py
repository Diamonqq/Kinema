"""Native course cards (Kinema 1.13): lesson → check → cards → exam practice for reviewed course decks.

Decks are read-only reviewed content (app/content/course_cards/*.json, plus the 2301 methods deck built
from the study guide's methods_cards). The learner's state is one versioned JSON document per deck in
SQLite; every change goes through POST /act with the revision it was based on and a request id, inside
an IMMEDIATE transaction, so a stale tab or a retried request can never double-grade or rewind.

The scheduler mirrors static/js/course_cards.js (makeSched): the browser uses its copy only to pick the
next card and label buttons; the server's result is the one stored. tests/test_course_cards.py checks
that the two give identical results.
"""
from __future__ import annotations

import hashlib
import json
import math
import random
import re
import sqlite3
import time
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter()
_db = None
_data = None

CONTENT_DIR = Path(__file__).parent / "content" / "course_cards"
GUIDE_2301 = Path(__file__).parent / "content" / "study_guides" / "2301.json"
MIN, HOUR = 60000, 3600000
BATCHES = (5, 8, 12, 16)
MODES = ("path", "lesson", "check", "card", "quiz", "mock", "diagnostic", "progress", "practice", "wait", "exam")
METHOD_KINDS = {"setup": "Setup", "axis": "Axis", "concept": "Concept", "recall": "Recall"}
LOG_KEEP = 20000


def now_ms() -> float:
    return time.time() * 1000


def setup(db_factory, data_dir=None) -> None:
    """Called once from main.py: db_factory() returns a sqlite3 connection (row_factory Row)."""
    global _db, _data
    _db, _data = db_factory, data_dir


def ensure_tables(conn: sqlite3.Connection) -> None:
    conn.execute("""CREATE TABLE IF NOT EXISTS cc_state(
        deck_id TEXT PRIMARY KEY, course_id TEXT NOT NULL, revision INTEGER NOT NULL, state TEXT NOT NULL,
        created_ts REAL NOT NULL, updated_ts REAL NOT NULL)""")
    conn.execute("""CREATE TABLE IF NOT EXISTS cc_log(
        id INTEGER PRIMARY KEY AUTOINCREMENT, deck_id TEXT NOT NULL, ts REAL NOT NULL, kind TEXT NOT NULL,
        item_id TEXT, g INTEGER, ms INTEGER, review INTEGER, data TEXT, revision INTEGER)""")
    conn.execute("CREATE INDEX IF NOT EXISTS cc_log_deck ON cc_log(deck_id, id)")
    conn.execute("""CREATE TABLE IF NOT EXISTS cc_requests(
        deck_id TEXT NOT NULL, request_id TEXT NOT NULL, action TEXT NOT NULL, body_hash TEXT NOT NULL,
        response TEXT NOT NULL, ts REAL NOT NULL, PRIMARY KEY(deck_id, request_id))""")
    conn.execute("""CREATE TABLE IF NOT EXISTS cc_imports(
        import_hash TEXT PRIMARY KEY, deck_id TEXT NOT NULL, ts REAL NOT NULL, summary TEXT NOT NULL, raw TEXT NOT NULL)""")


# ── scheduler (mirror of makeSched in static/js/course_cards.js) ────────────────────────────────────────────────
def _local(t: float) -> datetime:
    return datetime.fromtimestamp(t / 1000)


def _ms(d: datetime) -> float:
    return d.timestamp() * 1000


def exam_ms(iso: str | None) -> float | None:
    if not iso:
        return None
    return datetime.fromisoformat(iso).timestamp() * 1000


def sched_config(exam: float | None) -> dict:
    """Deadline settings for one deck. Capped cards land in a 'last morning' slot before the exam."""
    if exam is None:
        return {"exam": None, "cutoff": None, "slot_start": None, "slot_span": None}
    cutoff = exam - 15 * MIN
    day8 = _ms(_local(exam).replace(hour=8, minute=0, second=0, microsecond=0))
    span = min(2 * HOUR, cutoff - 15 * MIN - day8)
    if span < 20 * MIN:   # an early exam: use the evening before
        day8 = _ms(_local(exam).replace(hour=19, minute=0, second=0, microsecond=0) - timedelta(days=1))
        span = 2 * HOUR
    return {"exam": exam, "cutoff": cutoff, "slot_start": day8, "slot_span": span}


class Sched:
    steps = (1 * MIN, 10 * MIN)
    relearn = (1 * MIN, 10 * MIN)
    grad, easy_grad = 4 * HOUR, 12 * HOUR
    start_ease, min_ease = 2.5, 1.3
    hard_mul, easy_mul = 1.2, 1.4
    lapse_drop, hard_drop, easy_rise = 0.2, 0.15, 0.15
    leech, wake_hour = 3, 8
    learn_ahead, ahead_frac = 20 * MIN, 0.7

    def __init__(self, cfg: dict):
        self.exam, self.cutoff = cfg["exam"], cfg["cutoff"]
        self.slot_start, self.slot_span = cfg["slot_start"], cfg["slot_span"]

    @staticmethod
    def fresh() -> dict:
        return {"s": "new", "step": 0, "due": 0, "ivl": 0, "ease": Sched.start_ease, "lapses": 0, "reps": 0, "last": 0}

    def _copy(self, c):
        n = self.fresh()
        if c:
            n.update(c)
        return n

    @staticmethod
    def _hash(s: str) -> float:
        h = 2166136261
        for ch in s:
            h ^= ord(ch)
            h = (h * 16777619) & 0xFFFFFFFF
        return h / 4294967296

    def slot(self, item_id: str) -> float:
        return self.slot_start + math.floor(self._hash(item_id or "") * self.slot_span / MIN) * MIN

    def wake(self, t: float) -> float:
        d = _local(t)
        if d.hour < self.wake_hour:
            return _ms(d.replace(hour=self.wake_hour, minute=0, second=0, microsecond=0))
        return t

    def fit(self, item_id: str, now: float, raw: float) -> tuple[float, bool]:
        t = self.wake(raw)
        if self.exam is not None:
            if self.cutoff <= now < self.exam:
                t = self.exam
            elif now < self.exam:
                if now < self.slot_start:
                    cap = self.slot(item_id)
                else:
                    cap = self.cutoff
                    if cap <= now:
                        cap = self.exam
                if t > cap:
                    t = cap
        return t, t != raw

    def grade(self, c, g: int, now: float, item_id: str) -> dict:
        n = self._copy(c)
        prev = n["last"]
        n["reps"] += 1
        n["last"] = now
        if n["s"] == "new":
            n["s"], n["step"] = "learning", 0
        if n["s"] in ("learning", "relearning"):
            relearning = n["s"] == "relearning"
            steps = self.relearn if relearning else self.steps
            if g == 1:
                n["step"] = 0
                raw = now + steps[0]
            elif g == 2:
                raw = now + ((steps[0] + steps[1]) / 2 if n["step"] == 0 and len(steps) > 1 else steps[n["step"]])
            elif g == 3:
                n["step"] += 1
                if n["step"] >= len(steps):
                    n["s"], n["step"] = "review", 0
                    if not relearning:
                        n["ivl"] = self.grad
                    raw = now + n["ivl"]
                else:
                    raw = now + steps[n["step"]]
            else:
                n["s"], n["step"] = "review", 0
                n["ivl"] = n["ivl"] * 1.5 if relearning else self.easy_grad
                raw = now + n["ivl"]
        else:
            elapsed = max(0, now - prev)
            ivl = n["ivl"] or self.grad
            base = ivl + (elapsed - ivl) / 2 if elapsed >= ivl else (ivl + elapsed) / 2
            if g == 1:
                n["lapses"] += 1
                n["ease"] = max(self.min_ease, n["ease"] - self.lapse_drop)
                n["s"], n["step"] = "relearning", 0
                n["ivl"] = max(self.grad, ivl * 0.5)
                raw = now + self.relearn[0]
                if n["lapses"] >= self.leech:
                    n["leech"], n["leechSeen"] = True, False
            elif g == 2:
                n["ivl"] = max(base * self.hard_mul, 10 * MIN)
                n["ease"] = max(self.min_ease, n["ease"] - self.hard_drop)
                raw = now + n["ivl"]
            elif g == 3:
                n["ivl"] = base * n["ease"]
                raw = now + n["ivl"]
            else:
                n["ivl"] = base * n["ease"] * self.easy_mul
                n["ease"] += self.easy_rise
                raw = now + n["ivl"]
        n["due"], n["moved"] = self.fit(item_id, now, raw)
        return n

    def introduce(self, c, now: float, item_id: str) -> dict:
        """First sight of a new card: read with its answer, tested at the first learning step. Not recall."""
        n = self._copy(c)
        n.update(s="learning", step=0, last=now, intro=1)
        n["reps"] += 1
        n["due"], n["moved"] = self.fit(item_id, now, now + self.steps[0])
        return n

    def first_recall(self, c, g: int, now: float, item_id: str) -> dict:
        """First sight of a card a read lesson already taught: a self-rated recall from new, scheduled like a grade.
        Easy graduates at the normal interval, not the easy one, so reading alone never buys longer spacing."""
        n = self.grade(c, g, now, item_id)
        if g == 4:
            n["ivl"] = self.grad
            n["due"], n["moved"] = self.fit(item_id, now, now + self.grad)
        return n

    def recall(self, c, t: float) -> float:
        """Predicted recall at t: 90% when the natural interval has just elapsed. An estimate, not a grade."""
        if not c or c.get("s") == "new" or not c.get("last"):
            return 0.0
        if c["s"] == "review":
            s = c["ivl"]
        elif c["s"] == "relearning":
            s = min(c["ivl"], 10 * MIN)
        else:
            s = self.steps[min(c.get("step", 0), len(self.steps) - 1)]
        if t <= c["last"]:
            return 1.0
        return 0.9 ** ((t - c["last"]) / s)


# ── content ─────────────────────────────────────────────────────────────────────────────────────────────────────
_CACHE: dict = {}


def validate_content(d: dict) -> list[str]:
    """Problems in a reviewed deck file; an empty list means it can be served."""
    p = []
    for k in ("deck_id", "course_id", "title", "modules", "cards"):
        if k not in d:
            p.append("missing " + k)
    if p:
        return p
    mods = {m.get("n") for m in d["modules"]}
    if sorted(mods) != list(range(1, len(d["modules"]) + 1)):
        p.append("modules must be numbered 1..N")
    qs = {q["id"]: q for q in d.get("questions", []) if isinstance(q, dict) and "id" in q}
    if len(qs) != len(d.get("questions", [])):
        p.append("duplicate or missing question ids")
    for q in qs.values():
        opts = q.get("options")
        if q.get("module") not in mods or not isinstance(opts, list) or not 2 <= len(opts) <= 6 or not isinstance(q.get("answer"), int) or not 0 <= q["answer"] < len(opts):
            p.append("bad question " + q["id"])
        if not q.get("stem") or not q.get("why"):
            p.append("question without stem/why " + q["id"])
    ids, orders = set(), set()
    for c in d["cards"]:
        cid = c.get("id")
        if not cid or cid in ids:
            p.append(f"duplicate or missing card id {cid}")
        ids.add(cid)
        if c.get("order") in orders:
            p.append(f"duplicate order {c.get('order')}")
        orders.add(c.get("order"))
        if c.get("module") not in mods or not c.get("front") or not c.get("back"):
            p.append("bad card " + str(cid))
        for b in c.get("covers", []):
            if b not in qs:
                p.append(f"{cid} covers unknown {b}")
        if c.get("choices") is not None:
            ch, ai = c.get("choices"), c.get("answer_index")
            if not isinstance(ch, list) or not 2 <= len(ch) <= 5 or not isinstance(ai, int) or not 0 <= ai < len(ch):
                p.append("bad choices " + str(cid))
    optional = {c["id"] for c in d["cards"] if c.get("optional")}
    for c in d["cards"]:
        if c.get("pair") and c["pair"] not in ids:
            p.append(f"{c['id']} pair missing")
        if c.get("optional"):
            into = c.get("merged_into")
            if not isinstance(into, list) or not into or any(t not in ids or t in optional for t in into):
                p.append(f"{c['id']} optional without a studied card to merge into")
    heads = {m["n"]: {s.get("h") for s in m.get("sections", [])} for m in d["modules"]}
    for c in d["cards"]:
        tw = c.get("taught")
        if tw is not None and (not isinstance(tw, dict) or tw.get("lesson") not in heads.get(c.get("module"), ())
                               or not isinstance(tw.get("since"), int) or tw["since"] < 0):
            p.append(f"{c['id']} taught by an unknown lesson section")
    for m in d["modules"]:
        for q in m.get("check", []):
            if q not in qs:
                p.append(f"M{m['n']} check unknown {q}")
            elif qs[q].get("reserve"):
                p.append(f"M{m['n']} check uses held-back {q}")
    checks = {q for m in d["modules"] for q in m.get("check", [])}
    for q in d.get("diagnostic", []):
        if q not in qs or qs[q].get("reserve") or q in checks:
            p.append("bad diagnostic question " + q)
    return p


def _guide_deck(path: Path) -> dict | None:
    """The 2301 methods deck, built from the study guide's methods_cards (content author owns the wording)."""
    if not path.exists():
        return None
    g = json.loads(path.read_text(encoding="utf-8"))
    modules, cards, warnings, seen = [], [], [], set()
    order = 0
    for unit in g.get("units", []):
        good = []
        for c in unit.get("methods_cards") or []:
            why = _bad_method_card(c, seen)
            if why:
                warnings.append(f"{c.get('id') if isinstance(c, dict) else '?'}: {why}")
                continue
            seen.add(c["id"])
            good.append(c)
        if not good:
            continue
        n = len(modules) + 1
        sections = [{"h": "What this unit is for", "body": str(unit.get("objective") or "")}]
        if unit.get("pattern"):
            pat = unit["pattern"]
            sections.append({"h": "The pattern", "body": pat if isinstance(pat, str) else "\n".join("• " + str(x) for x in pat)})
        modules.append({"n": n, "title": str(unit.get("title") or unit.get("id")), "short": str(unit.get("title") or unit.get("id")),
                        "unit_id": unit.get("id"), "chapter": unit.get("chapter"), "minutes": 2, "intro": str(unit.get("objective") or ""),
                        "sections": sections, "check": [], "overview_only": True})
        for c in good:
            order += 1
            card = {"id": c["id"], "module": n, "order": order, "front": c["front"], "back": c["back"], "explain": c["why"],
                    "kind": c.get("kind") or "concept", "source_refs": c.get("source_refs") or []}
            if c.get("choices") is not None:
                card["choices"], card["answer_index"] = c["choices"], c["answer_index"]
            if c.get("visual"):
                card["visual"] = c["visual"]
            cards.append(card)
    if not cards:
        return None
    exam = None
    try:
        courses = json.loads((Path(__file__).parent / "content" / "study_courses.json").read_text(encoding="utf-8"))
        exam = next((c.get("exam", {}).get("at") for c in courses.get("courses", []) if c.get("id") == "2301"), None)
    except (OSError, ValueError, AttributeError):
        pass
    return {"format": 1, "deck_id": "2301-methods", "course_id": "2301", "title": "2301 methods", "exam_at": exam,
            "exam_label": "Wed 9:00" if exam else None, "kinds": METHOD_KINDS, "modules": modules, "cards": cards,
            "questions": [], "diagnostic": [], "weights": {}, "real_quiz_total": 0, "warnings": warnings,
            "note": "Methods and recognition cards from the worked lessons; not complete exam coverage."}


_ID_2301 = re.compile(r"^2301\.[a-z0-9_-]+\.[a-z0-9_-]+$")


def _bad_method_card(c, seen) -> str | None:
    if not isinstance(c, dict):
        return "not an object"
    if not isinstance(c.get("id"), str) or not _ID_2301.match(c["id"]):
        return "id must look like 2301.<unit>.<slug>"
    if c["id"] in seen:
        return "duplicate id"
    for k, n in (("front", 200), ("back", 400), ("why", 300)):
        if not isinstance(c.get(k), str) or not c[k].strip():
            return "missing " + k
        if len(c[k]) > n:
            return f"{k} longer than {n}"
    if c.get("kind") is not None and c["kind"] not in METHOD_KINDS:
        return "unknown kind"
    ch, ai = c.get("choices"), c.get("answer_index")
    if (ch is None) != (ai is None):
        return "choices and answer_index come together"
    if ch is not None:
        if not isinstance(ch, list) or not 2 <= len(ch) <= 5 or not all(isinstance(x, str) and x.strip() for x in ch) or len(set(ch)) != len(ch):
            return "choices must be 2-5 distinct strings"
        if not isinstance(ai, int) or isinstance(ai, bool) or not 0 <= ai < len(ch):
            return "answer_index out of range"
    return None


def _load(path: Path, builder) -> dict | None:
    try:
        st = path.stat()
    except OSError:
        return None
    key = (str(path), st.st_mtime_ns, st.st_size)
    hit = _CACHE.get(str(path))
    if hit and hit[0] == key:
        return hit[1]
    try:
        d = builder(path)
    except (OSError, ValueError, KeyError, TypeError):
        d = None   # unreadable content is skipped, never served half-valid
    if d is not None:
        problems = validate_content(d)
        if problems:
            d = None
        else:
            _index(d)
    _CACHE[str(path)] = (key, d)
    return d


def _index(d: dict) -> None:
    d["_cards"] = {c["id"]: c for c in d["cards"]}
    d["_qs"] = {q["id"]: q for q in d.get("questions", [])}
    d["_mods"] = {m["n"]: m for m in d["modules"]}
    d["_lessons"] = {f"lesson:{m['n']}:{i}": (m, s) for m in d["modules"] for i, s in enumerate(m.get("sections", []))}
    d["_sched"] = sched_config(exam_ms(d.get("exam_at")))
    d["_ordered"] = sorted(d["cards"], key=lambda c: c["order"])
    d["_hash"] = hashlib.sha256(json.dumps([d["cards"], d.get("questions", []), d["modules"]], sort_keys=True).encode()).hexdigest()[:16]


def decks() -> dict:
    out = {}
    for f in sorted(CONTENT_DIR.glob("*.json")):
        d = _load(f, lambda p: json.loads(p.read_text(encoding="utf-8")))
        if d:
            out[d["deck_id"]] = d
    g = _load(GUIDE_2301, _guide_deck)
    if g:
        out[g["deck_id"]] = g
    return out


def deck(deck_id: str) -> dict | None:
    return decks().get(deck_id)


# ── state ───────────────────────────────────────────────────────────────────────────────────────────────────────
def blank_state() -> dict:
    return {"cards": {}, "read": {}, "checks": {}, "batch": 8, "h": {}, "missed": [], "resUsed": 0, "mock": None,
            "mock1": None, "diag": None, "diag1": None, "run": None, "pos": None, "time": {}, "imports": [], "assisted": {}}


def _norm_state(s: dict) -> dict:
    b = blank_state()
    b.update({k: v for k, v in (s or {}).items()})
    return b


PRACTICE_MODES = ("practice", "quiz", "missed", "mock")   # independent answers that count as practice accuracy
PRACTICE_MIN = 20   # fewer independent answers than this: shown as not enough yet


def _read(conn, deck_id: str) -> tuple[int, dict]:
    r = conn.execute("SELECT revision, state FROM cc_state WHERE deck_id=?", (deck_id,)).fetchone()
    if not r:
        return 0, blank_state()
    st = _norm_state(json.loads(r[1]))
    if "acc" not in st or "hard" not in st:
        _backfill(conn, deck_id, st)
    return r[0], st


def _backfill(conn, deck_id, st) -> None:
    """Derived counters for states saved before they existed, read from the log; history itself is not touched.
    Practice accuracy counts only answers logged as independent practice or mock; legacy answers have no mode,
    so they are unknown rather than independent. Hard: cards whose latest rating was Hard."""
    acc, last = {"ok": 0, "n": 0}, {}
    for kind, item, g, data in conn.execute("SELECT kind, item_id, g, data FROM cc_log WHERE deck_id=? AND kind IN ('mc', 'card') ORDER BY id",
                                            (deck_id,)):
        x = json.loads(data or "null") or {}
        if kind == "mc" and x.get("mode") in PRACTICE_MODES and x.get("independent") is True:
            acc["n"] += 1
            acc["ok"] += 1 if g else 0
        elif kind == "card" and g:
            last[item] = g
    st.setdefault("acc", acc)
    st.setdefault("hard", sorted(i for i, g in last.items() if g == 2))


def _write(conn, d: dict, revision: int, state: dict) -> None:
    t = time.time()
    conn.execute("""INSERT INTO cc_state(deck_id, course_id, revision, state, created_ts, updated_ts) VALUES(?,?,?,?,?,?)
        ON CONFLICT(deck_id) DO UPDATE SET revision=excluded.revision, state=excluded.state, updated_ts=excluded.updated_ts""",
                 (d["deck_id"], d["course_id"], revision, json.dumps(state, separators=(",", ":")), t, t))


def _log(conn, deck_id, kind, item_id=None, g=None, ms=None, review=None, data=None, revision=None, ts=None):
    conn.execute("INSERT INTO cc_log(deck_id, ts, kind, item_id, g, ms, review, data, revision) VALUES(?,?,?,?,?,?,?,?,?)",
                 (deck_id, ts if ts is not None else now_ms(), kind, item_id, g, ms, review,
                  json.dumps(data, separators=(",", ":")) if data is not None else None, revision))


def _day(t: float) -> str:
    return _local(t).strftime("%Y-%m-%d")


def _tables_exist(conn) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cc_state'").fetchone() is not None


# ── public views ────────────────────────────────────────────────────────────────────────────────────────────────
def public_questions(d: dict, state: dict) -> list[dict]:
    """Question text without keys; held-back items stay out until the first mock exam has used them."""
    out = []
    for q in d.get("questions", []):
        if q.get("reserve") and not state.get("resUsed"):
            continue
        out.append({"id": q["id"], "module": q["module"], "source": q["source"], "stem": q["stem"], "options": q["options"],
                    "reserve": bool(q.get("reserve"))})
    return out


def pool_ids(d: dict, state: dict) -> list[str]:
    return [q["id"] for q in d.get("questions", []) if not q.get("reserve") or state.get("resUsed")]


def deck_payload(d: dict, revision: int, state: dict) -> dict:
    return {"deck_id": d["deck_id"], "course_id": d["course_id"], "title": d["title"], "exam_at": d.get("exam_at"),
            "exam_label": d.get("exam_label"), "sched": d["_sched"], "kinds": d.get("kinds", {}), "weights": d.get("weights", {}),
            "real_quiz_total": d.get("real_quiz_total", 0), "note": d.get("note"),
            "modules": [{k: v for k, v in m.items()} for m in d["modules"]], "cards": d["cards"],
            "questions": public_questions(d, state), "diagnostic": d.get("diagnostic", []),
            "quiz_ids": [q["id"] for q in d.get("questions", []) if q["source"].startswith("quiz") and not q.get("reserve")],
            "content_hash": d["_hash"], "warnings": d.get("warnings", []),
            "revision": revision, "state": client_state(state), "summary": summary(d, state), "now": now_ms(),
            "caps": ["first_recall"]}


def client_state(state: dict) -> dict:
    s = dict(state)
    s.pop("imports", None)
    return s


def _resting(c: dict, state: dict) -> bool:
    """An optional card (it repeats another card) is not introduced; once seen it rests after a clean graduation."""
    if not c.get("optional"):
        return False
    cs = state["cards"].get(c["id"])
    return not cs or cs.get("s") == "new" or (cs.get("s") == "review" and not cs.get("lapses"))


def study_cards(d: dict, state: dict) -> list[dict]:
    return [c for c in d["cards"] if not _resting(c, state)]


def _est_recall(d, state, sc, c, at) -> float:
    """Recall for the estimate. A resting card counts its own recall, capped by the card(s) it was merged into,
    so curation can only lower the estimate: an unseen optional card stays 0 however well its target is known."""
    own = sc.recall(state["cards"].get(c["id"]), at)
    if _resting(c, state):
        return min([own] + [sc.recall(state["cards"].get(t), at) for t in c["merged_into"]])
    return own


def counts(d: dict, state: dict, now: float) -> dict:
    cards = study_cards(d, state)
    o = {"learn": 0, "review": 0, "newLeft": 0, "seen": 0, "total": len(cards)}
    for c in cards:
        cs = state["cards"].get(c["id"])
        if not cs or cs.get("s") == "new":
            o["newLeft"] += 1
            continue
        o["seen"] += 1
        if cs["due"] <= now:
            o["review" if cs["s"] == "review" else "learn"] += 1
    o["due"] = o["learn"] + o["review"]
    return o


def next_step(d: dict, state: dict) -> dict | None:
    for m in d["modules"]:
        n = m["n"]
        if m.get("sections") and not state["read"].get(str(n)):
            return {"module": n, "step": "lesson"}
        if _check_ids(d, n) and not state["checks"].get(str(n)):
            return {"module": n, "step": "check"}
        if any(_is_new(state, c["id"]) for c in study_cards(d, state) if c["module"] == n):
            return {"module": n, "step": "cards"}
    return None


def _check_ids(d, m: int) -> list[str]:
    mod = d["_mods"].get(m)
    return [q for q in (mod or {}).get("check", []) if q in d["_qs"] and not d["_qs"][q].get("reserve")]


def _is_new(state, cid) -> bool:
    c = state["cards"].get(cid)
    return not c or c.get("s") == "new"


def first_recall_ok(d, state, cid) -> bool:
    """A new card whose lesson section (as it stood when read) states its answer: its first sight is a recall check."""
    c = d["_cards"].get(cid)
    tw = (c or {}).get("taught")
    read = state["read"].get(str((c or {}).get("module")))
    return bool(tw) and _is_new(state, cid) and isinstance(read, (int, float)) and read >= tw["since"]


def summary(d: dict, state: dict) -> dict:
    """Progress figures. Card memory and the score are rough model estimates, not exam grades."""
    t = now_ms()
    sc = Sched(d["_sched"])
    exam = d["_sched"]["exam"]
    at = exam if exam and exam > t else t
    mods = []
    for m in d["modules"]:
        every = [c for c in d["cards"] if c["module"] == m["n"]]
        ids = [c["id"] for c in every if not _resting(c, state)]
        seen = solid = learned = 0
        rec = sum(_est_recall(d, state, sc, c, at) for c in every)   # all cards, so resting ones never lift the score
        for cid in ids:
            cs = state["cards"].get(cid)
            r = sc.recall(cs, at)
            if cs and cs.get("s") != "new":
                seen += 1
                learned += cs["s"] == "review"
                solid += r >= 0.9
        ck = state["checks"].get(str(m["n"]))
        mods.append({"n": m["n"], "total": len(ids), "seen": seen, "learned": learned, "solid": solid,
                     "recall": rec / len(every) if every else 0, "read": bool(state["read"].get(str(m["n"]))), "check": ck})
    o = counts(d, state, t)
    solid_all = sum(m["solid"] for m in mods)
    out = {"counts": o, "modules": mods, "next": next_step(d, state), "card_memory": solid_all / o["total"] if o["total"] else 0,
           "mock1": state.get("mock1"), "diag1": state.get("diag1"), "time": state.get("time", {}),
           "mastered": sum(1 for q in pool_ids(d, state) if _mastered(state, q)), "pool": len(pool_ids(d, state)),
           "missed": len(state["missed"]), "predict": None, "exam": exam,
           "hard": sum(1 for cid in state.get("hard") or [] if cid in d["_cards"] and not _resting(d["_cards"][cid], state))}
    acc = state.get("acc") or {"ok": 0, "n": 0}
    out["practice"] = {"ok": acc["ok"], "n": acc["n"], "enough": acc["n"] >= PRACTICE_MIN}
    out["time_left"] = _time_left(d, state, sc, t, o)
    out["tally"] = state.get("tally")
    return out


def _time_left(d, state, sc, t, o) -> dict:
    """Rough minutes still needed: measured seconds per new card and per review (pulled toward 40 s / 8 s)
    times the reviews left before the exam if every answer were Good."""
    ty = state.get("tally") or {}
    sec_new = (ty.get("newMs", 0) / 1000 + 40 * 5) / (ty.get("nNew", 0) + 5)
    sec_rev = (ty.get("revMs", 0) / 1000 + 8 * 5) / (ty.get("nRev", 0) + 5)
    exam = sc.exam
    rev = 0
    if exam and exam > t:
        for c in study_cards(d, state):
            cs = state["cards"].get(c["id"])
            if not cs or cs.get("s") == "new":
                cs = sc.grade(sc.grade(None, 3, t, c["id"]), 3, t, c["id"])
            at, n = max(cs["due"], t), 0
            while at < exam and n < 40:
                n += 1
                rev += 1
                nx = sc.grade(cs, 3, at, c["id"])
                if nx["due"] <= at:
                    break
                cs, at = nx, nx["due"]
    else:
        rev = o["due"]
    lessons = sum(m.get("minutes", 0) for m in d["modules"] if m.get("sections") and not state["read"].get(str(m["n"])))
    return {"min": math.ceil((o["newLeft"] * sec_new + rev * sec_rev) / 60), "reviews": rev, "sec_new": sec_new, "sec_rev": sec_rev,
            "cards_only": True, "if_all_good": True, "rev_samples": ty.get("nRev", 0), "lessons_min": lessons}


def _mastered(state, qid) -> bool:
    h = state["h"].get(qid)
    return bool(h and len(h) == 2 and h[0] and h[1])


# ── actions ─────────────────────────────────────────────────────────────────────────────────────────────────────
class ActError(Exception):
    def __init__(self, msg, code=400, extra=None):
        super().__init__(msg)
        self.code, self.extra = code, extra or {}


NO_REVISION = {"position", "time", "progress", "practice"}


def _int(v, lo, hi, name):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != int(v) or not lo <= int(v) <= hi:
        raise ActError(f"{name} must be a whole number {lo}-{hi}")
    return int(v)


def _card(d, item_id):
    c = d["_cards"].get(item_id) if isinstance(item_id, str) else None
    if not c:
        raise ActError("unknown card")
    return c


def _question(d, state, qid):
    q = d["_qs"].get(qid) if isinstance(qid, str) else None
    if not q:
        raise ActError("unknown question")
    if q.get("reserve") and not state.get("resUsed"):
        raise ActError("unknown question")   # held back for the first mock: not even its existence leaks
    return q


def _record_mc(d, state, q, ok: bool, helped: bool = False, mode: str | None = None):
    """Independent answers feed mastery and the accuracy estimate. A helped answer is practice: a miss still joins
    the missed pile, but neither outcome touches mastery or the estimate."""
    if helped:
        if not ok and q["id"] not in state["missed"]:
            state["missed"].append(q["id"])
        return
    if mode in PRACTICE_MODES:
        acc = state.setdefault("acc", {"ok": 0, "n": 0})
        acc["n"] += 1
        acc["ok"] += 1 if ok else 0
    h = (state["h"].get(q["id"]) or []) + [1 if ok else 0]
    state["h"][q["id"]] = h[-2:]
    hist = state.setdefault("mc_hist", {}).setdefault(str(q["module"]), [])
    hist.append(1 if ok else 0)
    del hist[:-60]
    if not ok:
        if q["id"] not in state["missed"]:
            state["missed"].append(q["id"])
    elif q["id"] in state["missed"] and _mastered(state, q["id"]):
        state["missed"].remove(q["id"])


def _tally(d, state, cid, g, ms, review, sign=1, first=False):
    """Running figures for Progress (kept in state so reading progress never scans the log)."""
    t = state.setdefault("tally", {"newMs": 0, "nNew": 0, "revMs": 0, "nRev": 0, "days": {}, "graded": {}, "good": {}, "again": {}})
    ms = ms or 0
    if review:
        t["revMs"] += sign * ms
        t["nRev"] += sign
    else:
        t["newMs"] += sign * ms
        if g == 0 or first:
            t["nNew"] += sign
    if g:
        day = _day(state.get("_t", now_ms()))
        t["days"][day] = t["days"].get(day, 0) + sign
        m = str(d["_cards"][cid]["module"]) if cid in d["_cards"] else "0"
        t["graded"][m] = t["graded"].get(m, 0) + sign
        if g >= 3:
            t["good"][m] = t["good"].get(m, 0) + sign
        if g == 1:
            t["again"][cid] = t["again"].get(cid, 0) + sign
            if t["again"][cid] <= 0:
                t["again"].pop(cid)


def _mark_hard(state, cid, g):
    h = set(state.get("hard") or [])
    (h.add if g == 2 else h.discard)(cid)
    state["hard"] = sorted(h)


def _card_done(state, cid, t):
    """The card's turn is finished (introduced, graded or practised): a reload picks the next card rather than
    reopening this one, and the session kind (module, extra practice) carries over."""
    sess = (state.get("pos") or {}).get("sess")
    state["pos"] = {"mode": "card", "item_id": cid, "revealed": True, "t": t, "done": True, "phase": "done", **({"sess": sess} if sess else {})}


CARD_PHASES = ("intro", "front", "back", "again")
PICK_KINDS = ("new", "learn", "review", "ahead", "learn-ahead")


def _card_pos(d, state, item, body) -> dict:
    """Validated resume detail for a card position. An active phase is only kept if the card is still exactly as the
    client saw it (same last-graded time), so a grade that already landed can never be reopened and graded again."""
    out = {}
    ph = body.get("phase")
    if ph is not None:
        if ph not in CARD_PHASES:
            raise ActError("unknown phase")
        cs = state["cards"].get(item) if item else None
        seen = body.get("last")
        same = (cs or {}).get("last") == seen
        new = not cs or cs.get("s") == "new"
        phases = (("front", "back") if first_recall_ok(d, state, item) else ("intro",)) if new else ("front", "back", "again")
        ok = item in d["_cards"] and same and ph in phases
        out.update({"phase": ph if ok else "done", "done": not ok})
        if ok and body.get("kind") in PICK_KINDS:
            out["kind"] = body["kind"]
    sess = body.get("sess")
    if sess is not None:
        if not isinstance(sess, dict):
            raise ActError("sess must be an object")
        m = sess.get("m", 0)
        if isinstance(m, bool) or not isinstance(m, int) or not 0 <= m <= len(d["modules"]):
            raise ActError("bad session module")
        xd = sess.get("xd") or []
        if not isinstance(xd, list) or len(xd) > 60 or any(x not in d["_cards"] for x in xd):
            raise ActError("bad session list")
        out["sess"] = {"m": m, "ahead": bool(sess.get("ahead")), "review": bool(sess.get("review")), "xd": xd}
    return out


def _answer_payload(d, q, pick, ok):
    return {"item_id": q["id"], "ok": ok, "pick": pick, "answer": q["answer"], "why": q["why"],
            "related": [c["id"] for c in d["cards"] if q["id"] in c.get("covers", [])][:2]}


def apply(conn, d: dict, state: dict, revision: int, body: dict) -> dict:
    """Mutates state in place and returns the action result. Raises ActError for anything invalid."""
    a = body.get("action")
    t = now_ms()
    sc = Sched(d["_sched"])
    did = d["deck_id"]
    if a == "introduce":
        c = _card(d, body.get("item_id"))
        if not _is_new(state, c["id"]):
            raise ActError("card already introduced", 409)
        ms = _int(body.get("ms", 0), 0, 3600000, "ms")
        prev = state["cards"].get(c["id"])
        state["cards"][c["id"]] = sc.introduce(prev, t, c["id"])
        _log(conn, did, "card", c["id"], 0, min(ms, 60000), 0, {"prev": prev, "seen_answer": True}, revision + 1, t)
        _tally(d, state, c["id"], 0, min(ms, 60000), 0)
        _card_done(state, c["id"], t)
        return {"card": state["cards"][c["id"]]}
    if a == "grade":
        c = _card(d, body.get("item_id"))
        g = _int(body.get("g"), 1, 4, "g")
        ms = _int(body.get("ms", 0), 0, 3600000, "ms")
        prev = state["cards"].get(c["id"])
        if not prev or prev.get("s") == "new":
            raise ActError("introduce the card before grading it", 409)
        review = 1 if prev["s"] in ("review", "relearning") else 0
        state["cards"][c["id"]] = sc.grade(prev, g, t, c["id"])
        helped = state["assisted"].pop(c["id"], None)
        _log(conn, did, "card", c["id"], g, min(ms, 60000), review,
             {"prev": prev, "self_rated": not isinstance(body.get("choice"), int), "choice": body.get("choice") if isinstance(body.get("choice"), int) else None,
              "hinted": bool(body.get("hinted")) or bool(helped), "asked": bool(body.get("asked")) or bool(helped),
              "assisted": helped["ref"] if helped else None}, revision + 1, t)
        _tally(d, state, c["id"], g, min(ms, 60000), review)
        _mark_hard(state, c["id"], g)
        _card_done(state, c["id"], t)
        return {"card": state["cards"][c["id"]]}
    if a == "recall_first":
        # First sight of a card a read lesson taught: question first, self-rated. Only this grade schedules it.
        c = _card(d, body.get("item_id"))
        g = _int(body.get("g"), 1, 4, "g")
        ms = _int(body.get("ms", 0), 0, 3600000, "ms")
        if not _is_new(state, c["id"]):
            raise ActError("card already introduced", 409)
        if not first_recall_ok(d, state, c["id"]):
            raise ActError("this card is introduced with its answer first", 409)
        prev = state["cards"].get(c["id"])
        state["cards"][c["id"]] = sc.first_recall(prev, g, t, c["id"])
        helped = state["assisted"].pop(c["id"], None)
        _log(conn, did, "card", c["id"], g, min(ms, 60000), 0,
             {"prev": prev, "first_recall": True, "self_rated": True, "taught": c["taught"]["lesson"],
              "revealed": bool(body.get("revealed")), "hinted": bool(body.get("hinted")) or bool(helped),
              "asked": bool(body.get("asked")) or bool(helped), "assisted": helped["ref"] if helped else None}, revision + 1, t)
        _tally(d, state, c["id"], g, min(ms, 60000), 0, first=True)
        _mark_hard(state, c["id"], g)
        _card_done(state, c["id"], t)
        return {"card": state["cards"][c["id"]]}
    if a == "practice":
        # Study-ahead extra practice: the self-rating is logged, the schedule and recall estimates stay untouched.
        c = _card(d, body.get("item_id"))
        g = _int(body.get("g"), 1, 4, "g")
        ms = _int(body.get("ms", 0), 0, 3600000, "ms")
        if _is_new(state, c["id"]):
            raise ActError("introduce the card before practising it", 409)
        helped = state["assisted"].pop(c["id"], None)
        _log(conn, did, "card-practice", c["id"], g, min(ms, 60000), None,
             {"self_rated": not isinstance(body.get("choice"), int), "choice": body.get("choice") if isinstance(body.get("choice"), int) else None,
              "schedule_unchanged": True, "independent": False, "assisted": helped["ref"] if helped else None}, revision, t)
        _card_done(state, c["id"], t)
        return {"practice": True}
    if a == "undo":
        r = conn.execute("SELECT id, item_id, data, g, ms, review, ts FROM cc_log WHERE deck_id=? AND kind='card' ORDER BY id DESC LIMIT 1", (did,)).fetchone()
        if not r or not r[2]:
            raise ActError("nothing to undo", 409)
        data = json.loads(r[2])
        if "prev" not in data or (body.get("item_id") and body["item_id"] != r[1]):
            raise ActError("nothing to undo", 409)
        if data["prev"]:
            state["cards"][r[1]] = data["prev"]
        else:
            state["cards"].pop(r[1], None)
        conn.execute("UPDATE cc_log SET kind='card-undone' WHERE id=?", (r[0],))
        state["_t"] = r[6]
        _tally(d, state, r[1], r[3], r[4], r[5], -1, first=bool(data.get("first_recall")))
        state.pop("_t", None)
        pg = conn.execute("SELECT g FROM cc_log WHERE deck_id=? AND kind='card' AND item_id=? AND g > 0 ORDER BY id DESC LIMIT 1", (did, r[1])).fetchone()
        _mark_hard(state, r[1], pg[0] if pg else 0)
        return {"item_id": r[1], "card": state["cards"].get(r[1])}
    if a == "leech_seen":
        ids = body.get("item_ids")
        if not isinstance(ids, list) or not ids:
            raise ActError("item_ids required")
        for cid in ids:
            _card(d, cid)
            if cid in state["cards"]:
                state["cards"][cid]["leechSeen"] = True
        return {}
    if a == "read":
        m = _int(body.get("module"), 1, len(d["modules"]), "module")
        state["read"][str(m)] = t
        _log(conn, did, "read", f"lesson:{m}", data={"exposure": True}, revision=revision + 1, ts=t)
        return {}
    if a == "batch":
        n = body.get("n")
        if n not in BATCHES:
            raise ActError("batch must be 5, 8, 12 or 16")
        state["batch"] = n
        return {}
    if a in ("check_start", "diag_start"):
        if a == "check_start":
            m = _int(body.get("module"), 1, len(d["modules"]), "module")
            ids = _check_ids(d, m)
            if not ids:
                raise ActError("this module has no check")
            state["run"] = {"mode": "check", "module": m, "ids": ids, "ans": {}, "t": t}
            return {"ids": ids}
        ids = [q for q in d.get("diagnostic", []) if q in d["_qs"] and not d["_qs"][q].get("reserve")]
        if not ids:
            raise ActError("this deck has no diagnostic")
        state["diag"] = {"ids": ids, "ans": {}, "done": False, "t": t}
        return {"ids": ids}
    if a == "answer":
        q = _question(d, state, body.get("item_id"))
        mode = body.get("mode")
        if mode not in ("check", "diagnostic", "practice", "quiz", "missed"):
            raise ActError("unknown mode")
        pick = _int(body.get("pick"), 0, len(q["options"]) - 1, "pick")
        run = state["run"] if mode == "check" else state["diag"] if mode == "diagnostic" else None
        if mode in ("check", "diagnostic"):
            if not run or (mode == "diagnostic" and run.get("done")) or q["id"] not in run["ids"]:
                raise ActError("that question isn't part of the current " + mode, 409)
            if q["id"] in run["ans"]:
                raise ActError("already answered", 409)
            run["ans"][q["id"]] = pick
        ok = pick == q["answer"]
        ms = _int(body.get("ms", 0), 0, 3600000, "ms")
        helped = state["assisted"].pop(q["id"], None)
        hinted = bool(body.get("hinted")) or bool(helped)
        if run is not None and hinted:
            run.setdefault("helped", []).append(q["id"])
        _record_mc(d, state, q, ok, hinted, mode)
        _log(conn, did, "mc", q["id"], 1 if ok else 0, min(ms, 600000), None,
             {"mode": mode, "pick": pick, "hinted": hinted, "independent": not hinted, "assisted": helped["ref"] if helped else None}, revision + 1, t)
        state["pos"] = {"mode": "check" if mode == "check" else "diagnostic" if mode == "diagnostic" else "quiz", "item_id": q["id"], "revealed": True, "t": t}
        res = _answer_payload(d, q, pick, ok)
        res["helped"] = hinted
        if run is not None and len(run["ans"]) == len(run["ids"]):
            hs = set(run.get("helped", []))   # right-with-help is shown apart, never counted as known
            right = sum(1 for qid, p in run["ans"].items() if d["_qs"][qid]["answer"] == p and qid not in hs)
            helped_right = sum(1 for qid, p in run["ans"].items() if d["_qs"][qid]["answer"] == p and qid in hs)
            if mode == "check":
                m = str(run["module"])
                prev = state["checks"].get(m)
                state["checks"][m] = {"best": max(prev["best"] if prev else 0, right), "last": right, "n": len(run["ids"]), "t": t,
                                      "tries": (prev.get("tries", 1) if prev else 0) + 1, "helped": helped_right}
                res["check_done"] = {"module": run["module"], **state["checks"][m],
                                     "missed": [{"id": qid, "pick": p, "answer": d["_qs"][qid]["answer"], "why": d["_qs"][qid]["why"]}
                                                for qid, p in run["ans"].items() if d["_qs"][qid]["answer"] != p]}
                state["run"] = None
            else:
                run["done"], run["right"] = True, right
                per = {}
                for qid, p in run["ans"].items():
                    mm = str(d["_qs"][qid]["module"])
                    per.setdefault(mm, [0, 0])
                    per[mm][1] += 1
                    per[mm][0] += d["_qs"][qid]["answer"] == p and qid not in hs
                run["per"], run["helped_right"] = per, helped_right
                if not state.get("diag1"):
                    state["diag1"] = {"right": right, "n": len(run["ids"]), "per": per, "t": t, "helped": helped_right}
                res["diag_done"] = {"right": right, "n": len(run["ids"]), "per": per, "helped": helped_right}
        return res
    if a == "mock_start":
        m = state.get("mock")
        if m and not m.get("done"):
            return {"mock": m, "questions": _mock_questions(d, m), "resumed": True}
        if not d.get("questions"):
            raise ActError("this deck has no exam questions")
        state["mock"] = _build_mock(d, state)
        state["resUsed"] = 1
        return {"mock": state["mock"], "questions": _mock_questions(d, state["mock"])}
    if a == "mock_answer":
        m = state.get("mock")
        if not m or m.get("done"):
            raise ActError("no mock exam in progress", 409)
        i = _int(body.get("index"), 0, len(m["ids"]) - 1, "index")
        if "pick" in body:
            q = d["_qs"][m["ids"][i]]
            p = body["pick"]
            m["ans"][i] = -1 if p is None or p == -1 else _int(p, 0, len(q["options"]) - 1, "pick")
        if "goto" in body:
            m["i"] = _int(body["goto"], 0, len(m["ids"]) - 1, "goto")
        else:
            m["i"] = i
        return {"mock": m}
    if a == "mock_submit":
        m = state.get("mock")
        if not m or m.get("done"):
            raise ActError("no mock exam in progress", 409)
        right, per, items = 0, {}, []
        for j, qid in enumerate(m["ids"]):
            q = d["_qs"][qid]
            ok = m["ans"][j] >= 0 and m["ans"][j] == q["answer"]
            right += ok
            pm = per.setdefault(str(q["module"]), [0, 0])
            pm[1] += 1
            pm[0] += ok
            _record_mc(d, state, q, ok, mode="mock")
            _log(conn, did, "mc", qid, 1 if ok else 0, None, None, {"mode": "mock", "pick": m["ans"][j], "independent": True}, revision + 1, t)
            items.append({"id": qid, "pick": m["ans"][j], "answer": q["answer"], "ok": ok, "why": q["why"]})
        m.update(done=True, right=right, per=per, t1=t)
        if not state.get("mock1"):
            state["mock1"] = {"right": right, "n": len(m["ids"]), "t": t, "per": per}
        state["pos"] = {"mode": "mock", "item_id": None, "revealed": True, "t": t}
        return {"right": right, "n": len(m["ids"]), "per": per, "items": items, "questions": _mock_questions(d, m)}
    if a == "position":
        mode = body.get("mode")
        if mode not in MODES:
            raise ActError("unknown mode")
        item = body.get("item_id")
        if item is not None and not _known_item(d, state, item):
            raise ActError("unknown item")
        extra = _card_pos(d, state, item, body) if mode in ("card", "wait") else {}
        state["pos"] = {"mode": mode, "item_id": item, "revealed": bool(body.get("revealed")), "t": t,
                        "module": body.get("module") if isinstance(body.get("module"), int) else None, **extra}
        return {}
    if a == "time":
        ms = _int(body.get("ms"), 0, 120000, "ms")
        k = _day(t)
        state["time"][k] = state["time"].get(k, 0) + ms
        return {}
    if a == "progress":
        return {"summary": summary(d, state)}
    raise ActError("unknown action")


def _known_item(d, state, item) -> bool:
    if not isinstance(item, str):
        return False
    if item in d["_cards"] or item in d["_lessons"]:
        return True
    q = d["_qs"].get(item)
    return bool(q and (not q.get("reserve") or state.get("resUsed")))


def _build_mock(d, state) -> dict:
    """50 questions; the first mock includes every held-back question, topped up to at least 8 per module."""
    qs = d["questions"]
    rnd = random.Random()
    res = [] if state.get("resUsed") else [q["id"] for q in qs if q.get("reserve")]
    mods = [m["n"] for m in d["modules"]]
    per = {}
    for m in mods:
        ids = [q["id"] for q in qs if q["module"] == m and q["id"] not in res]
        rnd.shuffle(ids)
        per[m] = ids
    pick = list(res)
    for m in mods:
        have = sum(1 for qid in res if d["_qs"][qid]["module"] == m)
        take = max(0, 8 - have)
        pick += per[m][:take]
        per[m] = per[m][take:]
    rest = [x for m in mods for x in per[m]]
    rnd.shuffle(rest)
    pick += rest[:max(0, 50 - len(pick))]
    rnd.shuffle(pick)
    orders = []
    for qid in pick:
        o = list(range(len(d["_qs"][qid]["options"])))
        rnd.shuffle(o)
        orders.append(o)
    return {"ids": pick, "orders": orders, "ans": [-1] * len(pick), "i": 0, "done": False, "t0": now_ms()}


def _mock_questions(d, m) -> list[dict]:
    return [{"id": qid, "module": d["_qs"][qid]["module"], "source": d["_qs"][qid]["source"], "stem": d["_qs"][qid]["stem"],
             "options": d["_qs"][qid]["options"]} for qid in m["ids"]]


def _body_hash(body: dict) -> str:
    b = {k: v for k, v in body.items() if k not in ("revision",)}
    return hashlib.sha256(json.dumps(b, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def act(conn, deck_id: str, body: dict) -> tuple[int, dict]:
    """One transaction: replay a known request, refuse a stale revision, else apply and bump the revision."""
    d = deck(deck_id)
    if not d:
        return 404, {"error": "unknown deck"}
    if not isinstance(body, dict):
        return 400, {"error": "body must be an object"}
    a, rid = body.get("action"), body.get("request_id")
    if not isinstance(a, str):
        return 400, {"error": "action required"}
    if not isinstance(rid, str) or not 1 <= len(rid) <= 80:
        return 400, {"error": "request_id required"}
    ensure_tables(conn)
    conn.execute("BEGIN IMMEDIATE")
    try:
        bh = _body_hash(body)
        old = conn.execute("SELECT body_hash, response FROM cc_requests WHERE deck_id=? AND request_id=?", (deck_id, rid)).fetchone()
        if old:
            conn.execute("ROLLBACK")
            if old[0] != bh:
                return 409, {"error": "request_id was already used for a different request"}
            resp = json.loads(old[1])
            resp["replayed"] = True
            return 200, resp
        revision, state = _read(conn, deck_id)
        mutates = a not in NO_REVISION
        if mutates and body.get("revision") != revision:
            conn.execute("ROLLBACK")
            return 409, {"error": "stale", "revision": revision, "state": client_state(state), "summary": summary(d, state), "now": now_ms()}
        try:
            result = apply(conn, d, state, revision, body)
        except ActError as e:
            conn.execute("ROLLBACK")
            return e.code, {"error": str(e), "revision": revision, **e.extra}
        new_rev = revision + 1 if mutates else revision
        if a != "progress":
            _write(conn, d, new_rev, state)
        resp = {"ok": True, "action": a, "revision": new_rev, "result": result, "state": client_state(state), "summary": summary(d, state), "now": now_ms()}
        if a != "progress":
            conn.execute("INSERT INTO cc_requests(deck_id, request_id, action, body_hash, response, ts) VALUES(?,?,?,?,?,?)",
                         (deck_id, rid, a, bh, json.dumps(resp, separators=(",", ":")), time.time()))
            conn.execute("DELETE FROM cc_requests WHERE deck_id=? AND ts < ?", (deck_id, time.time() - 7 * 86400))
            n = conn.execute("SELECT COUNT(*) FROM cc_log WHERE deck_id=?", (deck_id,)).fetchone()[0]
            if n > LOG_KEEP:
                conn.execute("DELETE FROM cc_log WHERE id IN (SELECT id FROM cc_log WHERE deck_id=? ORDER BY id LIMIT ?)", (deck_id, n - LOG_KEEP))
        conn.execute("COMMIT")
        return 200, resp
    except Exception:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        raise


# ── legacy 5680 import ──────────────────────────────────────────────────────────────────────────────────────────
def _num(x) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def parse_legacy(env) -> tuple[dict, list[str]]:
    """Accepts a 5680 export file, the Panel saved-app snapshot or its inner state. Returns (C, S) parts and problems."""
    p = []
    if not isinstance(env, dict):
        return {}, ["not a JSON object"]
    st = env.get("state") if isinstance(env.get("state"), dict) else env
    if st.get("app") != "p5680":
        return {}, ["not a 5680 progress export (app is not p5680)"]
    C, S = st.get("cards"), st.get("trainer") if st.get("trainer") is not None else {}
    if not isinstance(C, dict) or not isinstance(C.get("cards", {}), dict):
        return {}, ["cards section missing"]
    if not isinstance(S, dict):
        p.append("trainer section is not an object")
    return {"cards": C, "trainer": S if isinstance(S, dict) else {}}, p


def _valid_card_state(c) -> bool:
    return (isinstance(c, dict) and c.get("s") in ("new", "learning", "relearning", "review")
            and all(_num(c.get(k, 0)) for k in ("step", "due", "ivl", "ease", "lapses", "reps", "last")))


def plan_import(d: dict, env) -> tuple[dict | None, list[str], dict]:
    """Validate everything before any write. Returns (new state + log rows, problems, report)."""
    parts, problems = parse_legacy(env)
    if problems:
        return None, problems, {}
    C, S = parts["cards"], parts["trainer"]
    st = blank_state()
    rep = {"cards": 0, "unknown_cards": [], "log": 0, "mc": 0, "dropped": []}
    for cid, cs in (C.get("cards") or {}).items():
        if cid not in d["_cards"]:
            rep["unknown_cards"].append(cid)
            continue
        if not _valid_card_state(cs):
            problems.append(f"card {cid}: malformed state")
            continue
        st["cards"][cid] = cs
        rep["cards"] += 1
    rows, logged_cards = [], set()
    for r in C.get("log") or []:
        if isinstance(r, list) and len(r) >= 3 and _num(r[0]) and isinstance(r[1], str) and r[2] in (0, 1, 2, 3, 4):
            if r[1] not in d["_cards"]:
                rep["dropped"].append(r[1])
                continue
            data = {"legacy": True, "self_rated": r[2] > 0, "seen_answer": r[2] == 0}
            if r[2] > 0 and r[1] not in logged_cards:
                data["first_recall"] = True   # graded on first sight: a recall check, not an answer-first intro
            logged_cards.add(r[1])
            rows.append(("card", r[1], r[2], int(r[3]) if len(r) > 3 and _num(r[3]) else None, 1 if len(r) > 4 and r[4] else 0, data, r[0]))
        else:
            problems.append("malformed card log entry")
            break
    rep["log"] = len(rows)
    for r in C.get("mc") or []:
        if isinstance(r, list) and len(r) >= 3 and _num(r[0]) and isinstance(r[1], str) and r[2] in (0, 1, True, False):
            q = d["_qs"].get(r[1])
            if not q:
                rep["dropped"].append(r[1])
                continue
            rows.append(("mc", r[1], 1 if r[2] else 0, None, None, {"legacy": True, "mode": "legacy"}, r[0]))
            st.setdefault("mc_hist", {}).setdefault(str(q["module"]), []).append(1 if r[2] else 0)
            rep["mc"] += 1
        else:
            problems.append("malformed practice log entry")
            break
    if isinstance(C.get("time"), dict):
        st["time"] = {k: v for k, v in C["time"].items() if isinstance(k, str) and re.match(r"^\d{4}-\d\d-\d\d$", k) and _num(v) and v >= 0}
    if C.get("batch") in BATCHES:
        st["batch"] = C["batch"]
    for f in ("read", "checks"):
        v = C.get(f)
        if isinstance(v, dict):
            st[f] = {str(k): x for k, x in v.items() if str(k).isdigit() and int(k) in d["_mods"]}
    h = S.get("h")
    if isinstance(h, dict):
        for qid, arr in h.items():
            if qid in d["_qs"] and isinstance(arr, list) and all(x in (0, 1, True, False) for x in arr):
                st["h"][qid] = [1 if x else 0 for x in arr][-2:]
    logged = {r[1] for r in rows if r[0] == "mc"}
    for qid, arr in st["h"].items():   # older history without logged answers still informs the estimate
        if qid not in logged:
            st.setdefault("mc_hist", {}).setdefault(str(d["_qs"][qid]["module"]), []).extend(arr)
    if isinstance(S.get("missed"), list):
        st["missed"] = [q for q in S["missed"] if isinstance(q, str) and q in d["_qs"]]
    st["resUsed"] = 1 if S.get("resUsed") else 0
    m = S.get("mock")
    if isinstance(m, dict) and isinstance(m.get("ids"), list) and all(q in d["_qs"] for q in m["ids"]) \
            and isinstance(m.get("orders"), list) and isinstance(m.get("ans"), list) and len(m["ids"]) == len(m["ans"]) == len(m["orders"]):
        st["mock"] = {"ids": m["ids"], "orders": m["orders"], "ans": [a if isinstance(a, int) else -1 for a in m["ans"]],
                      "i": m.get("i", 0) if isinstance(m.get("i"), int) else 0, "done": bool(m.get("done")), "t0": None}
        # legacy answers are positions in the shuffled order; store the original option index
        st["mock"]["ans"] = [(o[a] if 0 <= a < len(o) else -1) for o, a in zip(m["orders"], st["mock"]["ans"])]
    elif m is not None:
        rep["dropped"].append("mock")
    if isinstance(S.get("mock1"), dict):
        st["mock1"] = S["mock1"]
    rep["dropped"] = sorted(set(rep["dropped"]))
    return ({"state": st, "rows": rows} if not problems else None), problems, rep


def import_hash(env) -> str:
    parts, _ = parse_legacy(env)
    return hashlib.sha256(json.dumps(parts, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def import_legacy(conn, env, dry_run=False, deck_id="5680") -> tuple[int, dict]:
    """Additive, idempotent import into an untouched native deck. The raw envelope is kept verbatim."""
    d = deck(deck_id)
    if not d:
        return 404, {"error": "unknown deck"}
    plan, problems, rep = plan_import(d, env)
    if problems:
        return 400, {"error": "import refused: " + "; ".join(problems[:5]), "problems": problems}
    h = import_hash(env)
    ensure_tables(conn)
    conn.execute("BEGIN IMMEDIATE")
    try:
        prev = conn.execute("SELECT deck_id, summary FROM cc_imports WHERE import_hash=?", (h,)).fetchone()
        if prev:
            conn.execute("ROLLBACK")
            return 200, {"ok": True, "already": True, "import_hash": h, "report": json.loads(prev[1])}
        revision, state = _read(conn, deck_id)
        other = conn.execute("SELECT import_hash FROM cc_imports WHERE deck_id=?", (deck_id,)).fetchone()
        busy = conn.execute("SELECT COUNT(*) FROM cc_log WHERE deck_id=?", (deck_id,)).fetchone()[0]
        # opening the native view before migration only records position and active time (revision stays 0)
        touched = any(state.get(k) for k in blank_state() if k not in ("pos", "time", "batch", "assisted"))
        if other or revision > 0 or busy or touched:
            conn.execute("ROLLBACK")
            return 409, {"error": "this deck already has native or imported progress; refusing to merge a different history",
                         "import_hash": h, "revision": revision, "existing_import": other[0] if other else None}
        if dry_run:
            conn.execute("ROLLBACK")
            return 200, {"ok": True, "dry_run": True, "import_hash": h, "report": rep}
        st = plan["state"]
        st["imports"] = [h]
        native_time = {k: v for k, v in (state.get("time") or {}).items() if _num(v) and v > 0}
        if native_time:   # active study time is additive; reported, never hidden
            for k, v in native_time.items():
                st["time"][k] = st["time"].get(k, 0) + v
            rep["added_native_time"] = native_time
        if state.get("pos"):
            st["pos"] = state["pos"]
        for kind, item, g, ms, review, data, ts in plan["rows"]:
            if kind == "card":
                st["_t"] = ts
                _tally(d, st, item, g, min(ms or 0, 60000), review, first=bool(data.get("first_recall")))
        st.pop("_t", None)
        for kind, item, g, ms, review, data, ts in plan["rows"]:
            _log(conn, deck_id, kind, item, g, ms, review, data, 1, ts)
        _write(conn, d, 1, st)
        conn.execute("INSERT INTO cc_imports(import_hash, deck_id, ts, summary, raw) VALUES(?,?,?,?,?)",
                     (h, deck_id, time.time(), json.dumps(rep), json.dumps(env, separators=(",", ":"))))
        conn.execute("COMMIT")
        return 200, {"ok": True, "import_hash": h, "revision": 1, "report": rep}
    except Exception:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        raise


# ── trusted context for the teacher ─────────────────────────────────────────────────────────────────────────────
def context_item(conn, deck_id: str, item_id: str, mode: str) -> dict | None:
    """Read-only: the exact item a quick question refers to, from validated ids. Never grades, advances or writes.
    None for unknown ids, held-back questions not yet used, and anything inside an unsubmitted mock exam."""
    d = deck(deck_id) if isinstance(deck_id, str) else None
    if not d or not isinstance(item_id, str) or mode not in MODES:
        return None
    if _tables_exist(conn):
        r = conn.execute("SELECT state FROM cc_state WHERE deck_id=?", (deck_id,)).fetchone()
        state = _norm_state(json.loads(r[0])) if r else blank_state()
    else:
        state = blank_state()
    pos = state.get("pos") or {}
    here = pos.get("item_id") == item_id
    base = {"course_id": d["course_id"], "deck_id": deck_id, "item_id": item_id, "mode": mode}
    if item_id in d["_lessons"]:
        m, s = d["_lessons"][item_id]
        text = s["body"] + ("\nKey takeaway: " + s["key"] if s.get("key") else "")
        return {**base, "module_title": m["title"], "prompt": s["h"], "answer": text[:1200], "explanation": "", "answer_visible": True}
    c = d["_cards"].get(item_id)
    if c:
        m = d["_mods"][c["module"]]
        prompt = c["front"] + ("\nChoices: " + " | ".join(c["choices"]) if c.get("choices") else "")
        expl = c.get("explain") or ""
        if c.get("hook"):
            expl += ("\n" if expl else "") + "Remember it by: " + c["hook"]
        return {**base, "module_title": m["title"], "prompt": prompt, "answer": c["back"], "explanation": expl,
                "answer_visible": bool(here and pos.get("revealed"))}
    q = d["_qs"].get(item_id)
    if not q:
        return None
    if q.get("reserve") and not state.get("resUsed"):
        return None
    mk = state.get("mock")
    if mk and not mk.get("done") and item_id in mk.get("ids", []):
        return None
    m = d["_mods"][q["module"]]
    prompt = q["stem"] + "\n" + "\n".join(f"{'ABCDEF'[i]}. {o}" for i, o in enumerate(q["options"]))
    done_mock = bool(mk and mk.get("done") and item_id in mk.get("ids", []) and mode == "mock")
    return {**base, "module_title": m["title"], "prompt": prompt, "answer": q["options"][q["answer"]], "explanation": q["why"],
            "answer_visible": bool((here and pos.get("revealed")) or done_mock)}


def mark_assisted(conn, deck_id: str, item_id: str, mode: str, ref: str) -> bool:
    """Called by the teacher inside its own transaction when a quick question is about this item: the next answer
    or grade for it is logged as helped (not independent). Never grades, schedules, advances, reveals or commits,
    and leaves the revision alone so the open view's next action is not stale. Idempotent per item until answered."""
    if not isinstance(ref, str) or not ref or len(ref) > 200:
        raise ValueError("ref required")
    d = deck(deck_id) if isinstance(deck_id, str) else None
    if not d or not isinstance(item_id, str) or (item_id not in d["_cards"] and item_id not in d["_qs"]):
        return False
    if not _tables_exist(conn) or context_item(conn, deck_id, item_id, mode) is None:
        return False   # unknown, held back or inside an unsubmitted mock
    r = conn.execute("SELECT revision, state FROM cc_state WHERE deck_id=?", (deck_id,)).fetchone()
    revision, state = (r[0], _norm_state(json.loads(r[1]))) if r else (0, blank_state())
    if item_id in state["assisted"]:
        return True
    state["assisted"][item_id] = {"ref": ref, "mode": mode, "t": now_ms()}
    if len(state["assisted"]) > 200:   # unanswered marks age out oldest first
        for k in sorted(state["assisted"], key=lambda k: state["assisted"][k]["t"])[:-200]:
            state["assisted"].pop(k)
    _write(conn, d, revision, state)
    return True


# ── routes ──────────────────────────────────────────────────────────────────────────────────────────────────────
def _bad(msg, code=400, **extra):
    return JSONResponse({"error": msg, **extra}, status_code=code)


def _conn():
    if _db is None:
        raise RuntimeError("course_cards.setup() was not called")
    c = _db()
    c.isolation_level = None   # explicit BEGIN IMMEDIATE / COMMIT
    ensure_tables(c)
    return c


@router.get("/api/course-cards")
def list_decks(course_id: str | None = None):
    conn = _conn()
    try:
        out = []
        for d in decks().values():
            if course_id and d["course_id"] != course_id:
                continue
            revision, state = _read(conn, d["deck_id"])
            o = counts(d, state, now_ms())
            out.append({"deck_id": d["deck_id"], "course_id": d["course_id"], "title": d["title"], "exam_at": d.get("exam_at"),
                        "due": o["due"], "new": o["newLeft"], "learn": o["learn"], "review": o["review"], "seen": o["seen"],
                        "total": o["total"], "next": next_step(d, state), "revision": revision, "warnings": len(d.get("warnings", []))})
        return {"decks": out, "now": now_ms()}
    finally:
        conn.close()


@router.get("/api/course-cards/{deck_id}")
def get_deck(deck_id: str):
    d = deck(deck_id)
    if not d:
        return _bad("unknown deck", 404)
    conn = _conn()
    try:
        revision, state = _read(conn, deck_id)
        return deck_payload(d, revision, state)
    finally:
        conn.close()


@router.post("/api/course-cards/import")
async def import_route(request: Request):
    try:
        body = await request.json()
    except ValueError:
        return _bad("body must be JSON")
    if not isinstance(body, dict):
        return _bad("body must be an object")
    env = body.get("envelope", body)
    conn = _conn()
    try:
        code, resp = import_legacy(conn, env, dry_run=bool(body.get("dry_run")), deck_id=body.get("deck_id") or "5680")
        return JSONResponse(resp, status_code=code)
    finally:
        conn.close()


@router.post("/api/course-cards/{deck_id}/act")
async def act_route(deck_id: str, request: Request):
    try:
        body = await request.json()
    except ValueError:
        return _bad("body must be JSON")
    conn = _conn()
    try:
        code, resp = act(conn, deck_id, body)
        return JSONResponse(resp, status_code=code)
    finally:
        conn.close()
