"""Guided worked-example lessons (Kinema 1.13): one persistent session per started unit, resumed at its exact position.

GET  /api/study-guides?course_id=2301                → units with their latest session and the session to resume
POST /api/study-guides/{unit_id}/start               {request_id, course_id?, restart?} → session (resumes an unfinished one)
GET  /api/study-guide-sessions/{id}                  → session
POST /api/study-guide-sessions/{id}/act              {action, revision, request_id, ...} → session
     next | back | hint | reveal | finish, answer {check_id, choice}
A wrong revision is a 409 carrying the current session; a repeated request_id (receipts are durable) returns the current session unchanged, and one already used for another
lesson is refused;
unknown sessions, units, actions or check ids change nothing.

Content: app/content/study_guides/<course>.json (guide content author). Visuals: app/guide_visuals.py build_visual.
Checks are graded here from their stored key. Evidence (learner.record, source "session"):
* working through the worked example is exposure ("taught"), never recall;
* a worked-step check is helped (correct_hint) or wrong: the worked solution is on screen;
* a practice check is independent ("correct") only on the first attempt with no scaffold, hint, solution or tutor
  question about the open practice (teacher.py marks it); otherwise helped. Revealing the solution records unanswered checks as "revealed".
"""
from __future__ import annotations

import copy
import functools
import json
import time
import uuid
from contextlib import closing
from pathlib import Path

from fastapi import APIRouter, Request

from . import curriculum, learn_api, learner, visual_controls

GUIDES_DIR = Path(__file__).resolve().parent / "content" / "study_guides"
PRACTICE = "practice"
router = APIRouter()


class GuideError(ValueError):
    pass


# ── content ───────────────────────────────────────────────────────────────────────────────────────────────────────
@functools.lru_cache(maxsize=8)
def _load(path: str, mtime: float) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def guide(course_id: str) -> dict | None:
    if not isinstance(course_id, str) or not course_id.replace("-", "").isalnum():
        return None
    path = GUIDES_DIR / f"{course_id}.json"
    if not path.is_file():
        return None
    return _load(str(path), path.stat().st_mtime)


def courses() -> list[str]:
    return sorted(p.stem for p in GUIDES_DIR.glob("*.json")) if GUIDES_DIR.is_dir() else []


def find_unit(unit_id: str, course_id: str | None = None) -> tuple[str, dict] | None:
    for cid in ([course_id] if course_id else courses()):
        g = guide(cid)
        for u in (g or {}).get("units") or []:
            if u.get("id") == unit_id:
                return cid, u
    return None


def _steps(unit: dict) -> list[dict]:
    return ((unit.get("worked") or {}).get("steps")) or []


def _practice(unit: dict) -> dict:
    return unit.get("practice") or {}


def _checks(unit: dict) -> dict[str, tuple[str, dict]]:
    """check id -> (where, check) with where = a worked step id or PRACTICE."""
    out = {}
    for s in _steps(unit):
        if s.get("check") and s["check"].get("id"):
            out[s["check"]["id"]] = (s["id"], s["check"])
    for c in _practice(unit).get("checks") or []:
        if c.get("id"):
            out[c["id"]] = (PRACTICE, c)
    return out


# ── visuals ───────────────────────────────────────────────────────────────────────────────────────────────────────
def visual_ref(unit: dict, phase: str, index: int) -> dict | None:
    """The prepared visual of the current position: a worked step's, or the practice's own (else the last step's)."""
    steps = _steps(unit)
    if phase == "worked" and 0 <= index < len(steps):
        return steps[index].get("visual")
    if phase == PRACTICE and _practice(unit).get("visual_note") and not _practice(unit).get("visual"):
        return None   # authored intentional absence, not permission to reuse the old problem's picture
    pv = _practice(unit).get("visual")
    return pv or (steps[-1].get("visual") if steps else None)


def build(ref: dict | None) -> tuple[dict | None, str | None]:
    """(validated lesson, error) for a {visual_id, parameters} reference."""
    if not ref or not ref.get("visual_id"):
        return None, None
    gv = visual_controls.guide_module()
    if gv is None:
        return None, "Guide visuals are not available in this build."
    try:
        params = gv.validate_parameters(ref["visual_id"], ref.get("parameters") or {})
        return copy.deepcopy(gv.build_visual(ref["visual_id"], params)), None
    except (KeyError, ValueError) as exc:
        return None, f"This step's visual could not be built: {str(exc)[:200]}"


def visual_key(ref: dict | None) -> str | None:
    return None if not ref else ref["visual_id"] + "|" + json.dumps(ref.get("parameters") or {}, sort_keys=True)


# ── storage ───────────────────────────────────────────────────────────────────────────────────────────────────────
def ensure_tables(conn) -> None:
    conn.execute("""CREATE TABLE IF NOT EXISTS study_guide_sessions(
        id TEXT PRIMARY KEY, course_id TEXT NOT NULL, unit_id TEXT NOT NULL, state TEXT NOT NULL,
        created_ts REAL NOT NULL, updated_ts REAL NOT NULL)""")
    conn.execute("CREATE INDEX IF NOT EXISTS study_guide_sessions_unit ON study_guide_sessions(course_id, unit_id, updated_ts)")
    conn.execute("CREATE TABLE IF NOT EXISTS study_guide_requests(request_id TEXT PRIMARY KEY, session_id TEXT NOT NULL)")


def _db():
    conn = learn_api._db()
    ensure_tables(conn)
    return conn


def load(conn, sid: str) -> dict | None:
    row = conn.execute("SELECT state FROM study_guide_sessions WHERE id=?", (str(sid),)).fetchone()
    return json.loads(row[0]) if row else None


def _save(conn, s: dict) -> None:
    s["revision"] += 1
    s["updated_ts"] = time.time()
    conn.execute("UPDATE study_guide_sessions SET state=?, updated_ts=? WHERE id=?", (json.dumps(s), s["updated_ts"], s["id"]))


def _new(course_id: str, unit: dict) -> dict:
    now = time.time()
    return {"v": 1, "id": "g" + uuid.uuid4().hex[:11], "course_id": course_id, "unit_id": unit["id"], "revision": 1,
            "phase": "worked" if _steps(unit) else "practice", "index": 0, "checks": {}, "scaffold_shown": False,
            "hints_shown": 0, "revealed": False, "summary": None, "created_ts": now, "updated_ts": now}


# ── evidence ──────────────────────────────────────────────────────────────────────────────────────────────────────
def _skills(unit: dict, check: dict | None = None) -> list[str]:
    known = curriculum.load()["skills"]
    if check and check.get("skill_id") in known:
        return [check["skill_id"]]
    ids = [k for k in unit.get("skill_ids") or [] if k in known]
    return ids[:1] if check else ids


def _record(conn, s: dict, skills: list[str], kind: str, outcome: str, key: str, detail: dict) -> None:
    for skill in skills:
        learner.record(conn, skill, kind, outcome, "session", ref=f"guide:{s['id']}", dedup=f"guide:{s['id']}:{key}:{skill}",
                       detail={"by": "study guide", "session": s["id"], "unit": s["unit_id"], **detail})


def _helped(s: dict) -> bool:
    return bool(s["scaffold_shown"] or s["hints_shown"] or s["revealed"] or s.get("tutor_help"))


def mark_tutor_help(conn, sid: str, ref: str) -> bool:
    """A question to the tutor from this lesson while its practice is open: later practice answers count as helped.
    Idempotent and position-neutral: the revision is not bumped, so the student's next lesson action is not refused;
    the session view shows it as help_used. Returns True when it newly marked the session."""
    s = load(conn, sid)
    if not s or s["phase"] != "practice" or s["revealed"] or s.get("tutor_help"):
        return False
    s["tutor_help"] = {"ref": str(ref)[:120], "ts": time.time()}
    conn.execute("UPDATE study_guide_sessions SET state=? WHERE id=?", (json.dumps(s), s["id"]))
    return True


# ── the session view ──────────────────────────────────────────────────────────────────────────────────────────────
def _public_check(c: dict, result: dict | None) -> dict:
    out = {"id": c["id"], "prompt": c.get("prompt") or "", "choices": list(c.get("choices") or [])}
    if result:
        out["result"] = result
    return out


def _result(c: dict, rec: dict | None) -> dict | None:
    if not rec:
        return None
    fb = c.get("feedback") or []
    picked = rec["picked"]
    return {"picked": picked, "correct": rec["correct"], "answer": c.get("answer"), "attempts": rec["attempts"],
            "explain": (fb[picked] if not rec["correct"] and isinstance(fb, list) and picked < len(fb) and fb[picked] else c.get("explain") or "")}


def _total(unit: dict) -> int:
    return len(_steps(unit)) + (1 if _practice(unit) else 0)


def view(s: dict, unit: dict, *, with_visual: bool = True) -> dict:
    steps, pr = _steps(unit), _practice(unit)
    phase = s["phase"]
    if phase == "worked" and steps:
        st = steps[min(s["index"], len(steps) - 1)]
        step = {k: st.get(k) for k in ("id", "title", "what", "math", "why")}
        if st.get("check"):
            step["check"] = _public_check(st["check"], _result(st["check"], s["checks"].get(st["check"]["id"])))
        index = min(s["index"], len(steps) - 1)
    else:
        checks = [_public_check(c, _result(c, s["checks"].get(c["id"]))) for c in pr.get("checks") or []]
        step = {"id": PRACTICE, "title": pr.get("title") or "Your turn", "what": pr.get("problem") or "", "givens": pr.get("givens") or [],
                "scaffold": pr.get("scaffold") if (s["scaffold_shown"] or s["revealed"]) else None, "checks": checks, "math": "", "why": ""}
        index = len(steps)
    ref = visual_ref(unit, "worked" if phase == "worked" else PRACTICE, index)
    hints = pr.get("hints") or []
    unanswered = [c for c in _checks(unit).values()
                  if (c[0] == step["id"]) and not (s["checks"].get(c[1]["id"]) or {}).get("correct")]
    in_practice = phase == "practice"
    out = {"id": s["id"], "revision": s["revision"], "course_id": s["course_id"], "unit_id": unit["id"], "unit_title": unit.get("title") or "",
           "unit": {k: unit.get(k) for k in ("id", "title", "chapter", "objective", "pattern", "source_refs", "prerequisite_ids")},
           "worked": {"problem": (unit.get("worked") or {}).get("problem") or "", "givens": (unit.get("worked") or {}).get("givens") or []},
           "help_used": _helped(s),
           "position": {"phase": "done" if phase == "done" else phase, "index": index, "total": _total(unit)},
           "step": step, "visual_ref": ref, "visual_key": visual_key(ref),
           "hints_shown": hints[:s["hints_shown"]] if in_practice or phase == "done" else [],
           "solution_steps": pr.get("solution_steps") if s["revealed"] else None,
           "can": {"next": phase == "worked", "back": (phase == "worked" and index > 0) or (in_practice and bool(steps)),
                   "hint": in_practice and not s["revealed"] and (not s["scaffold_shown"] or s["hints_shown"] < len(hints)),
                   "answer": phase != "done" and bool(unanswered) and not (in_practice and s["revealed"]),
                   "reveal": in_practice and not s["revealed"], "finish": phase != "done"},
           "summary": s.get("summary"), "updated_ts": s["updated_ts"]}
    if with_visual:
        lesson, err = build(ref)
        out["visual"] = lesson
        if err:
            out["visual_error"] = err
    return out


# ── actions ───────────────────────────────────────────────────────────────────────────────────────────────────────
def _summary(s: dict, unit: dict, course_id: str) -> dict:
    checks = _checks(unit)
    ind = helped = missed = revealed = 0
    for cid, (where, _c) in checks.items():
        rec = s["checks"].get(cid)
        if not rec:
            revealed += where == PRACTICE and s["revealed"]
            continue
        if rec["correct"] and rec["independent"]:
            ind += 1
        elif rec["correct"]:
            helped += 1
        else:
            missed += 1
    practice_ok = all((s["checks"].get(c["id"]) or {}).get("correct") and s["checks"][c["id"]]["independent"]
                      for c in _practice(unit).get("checks") or []) and not s["revealed"]
    if not practice_ok and _practice(unit):
        nxt = {"kind": "retry_practice", "unit_id": unit["id"], "label": "Redo this practice on your own, without hints, next session"}
    else:
        units = (guide(course_id) or {}).get("units") or []
        ids = [u["id"] for u in units]
        later = ids[ids.index(unit["id"]) + 1:] if unit["id"] in ids else []
        nxt = ({"kind": "unit", "unit_id": later[0], "label": "Start: " + next(u.get("title") or "" for u in units if u["id"] == later[0])}
               if later else {"kind": "cards", "label": "Review your due cards"})
    return {"independent_correct": ind, "helped_correct": helped, "missed": missed, "revealed": int(revealed), "total": len(checks),
            "note": "Only practice answered on the first try without hints or the solution counts as independent.", "next": nxt}


def act(conn, s: dict, unit: dict, action: str, body: dict) -> None:
    steps, pr = _steps(unit), _practice(unit)
    if s["phase"] == "done" and action != "back":
        raise GuideError("This lesson is finished. Start it again for a fresh run.")
    if action == "next":
        if s["phase"] != "worked":
            raise GuideError("There is no next step; answer the practice, ask for a hint, or finish.")
        if not s.get("taught"):
            _record(conn, s, _skills(unit), "taught", "exposure", "taught", {"what": "worked example"})
            s["taught"] = True
        if s["index"] + 1 < len(steps):
            s["index"] += 1
        elif pr:
            s["phase"], s["index"] = "practice", len(steps)
        else:
            raise GuideError("This is the last step; finish when ready.")
    elif action == "back":
        if s["phase"] == "worked" and s["index"] > 0:
            s["index"] -= 1
        elif s["phase"] in ("practice", "done") and steps:
            s["phase"], s["index"] = "worked", len(steps) - 1
        else:
            raise GuideError("This is the first step.")
    elif action == "hint":
        if s["phase"] != "practice" or s["revealed"]:
            raise GuideError("Hints are for the practice problem.")
        if not s["scaffold_shown"] and pr.get("scaffold"):
            s["scaffold_shown"] = True
        elif s["hints_shown"] < len(pr.get("hints") or []):
            s["hints_shown"] += 1
        else:
            raise GuideError("No more hints; reveal the solution or ask the tutor.")
    elif action == "reveal":
        if s["phase"] != "practice" or s["revealed"]:
            raise GuideError("Nothing to reveal here.")
        s["revealed"] = True
        for c in pr.get("checks") or []:
            if c["id"] not in s["checks"]:
                _record(conn, s, _skills(unit, c), "check", "revealed", f"reveal:{c['id']}", {"check": c["id"]})
        if not pr.get("checks"):
            _record(conn, s, _skills(unit)[:1], "check", "revealed", "reveal", {})
    elif action == "answer":
        cid, choice = body.get("check_id"), body.get("choice")
        where_check = _checks(unit).get(cid) if isinstance(cid, str) else None
        if not where_check:
            raise GuideError("That check is not part of this lesson.")
        where, c = where_check
        current = steps[s["index"]]["id"] if s["phase"] == "worked" and s["index"] < len(steps) else PRACTICE
        if where != current:
            raise GuideError("That check belongs to another step.")
        if where == PRACTICE and s["revealed"]:
            raise GuideError("The solution is shown, so this check can no longer be answered.")
        if not isinstance(choice, int) or isinstance(choice, bool) or not 0 <= choice < len(c.get("choices") or []):
            raise GuideError("Pick one of the choices.")
        prev = s["checks"].get(cid)
        if prev and prev["correct"]:
            raise GuideError("Already answered correctly.")
        correct = choice == c.get("answer")
        independent = where == PRACTICE and not prev and not _helped(s)
        n = (prev or {}).get("attempts", 0) + 1
        s["checks"][cid] = {"picked": choice, "correct": correct, "attempts": n, "independent": independent and correct}
        outcome = ("correct" if independent else "correct_hint") if correct else "wrong"
        _record(conn, s, _skills(unit, c), "check", outcome, f"check:{cid}:{n}",
                {"check": cid, "picked": choice, "attempt": n, "worked_step": where != PRACTICE, "helped": _helped(s)})
    elif action == "finish":
        s["phase"] = "done"
        s["summary"] = _summary(s, unit, s["course_id"])
    else:
        raise GuideError("Unknown action.")


# ── teacher integration ───────────────────────────────────────────────────────────────────────────────────────────
def session_and_unit(conn, sid: str) -> tuple[dict, dict] | None:
    s = load(conn, sid) if isinstance(sid, str) and sid else None
    found = find_unit(s["unit_id"], s["course_id"]) if s else None
    return (s, found[1]) if found else None


def step_ids(unit: dict) -> list[str]:
    return [st["id"] for st in _steps(unit)] + ([PRACTICE] if _practice(unit) else [])


def teacher_context(conn, sid: str, step_id: str | None) -> dict | None:
    """The validated guide reference for the teacher (None when unknown). Includes the answer key and solution, flagged
    with what the student has seen, so the tutor can help without handing over unseen answers."""
    su = session_and_unit(conn, sid)
    if not su:
        return None
    s, unit = su
    v = view(s, unit, with_visual=False)
    current = v["step"]["id"]
    if step_id not in step_ids(unit):
        step_id = current
    out = {"kind": "guide", "session_id": s["id"], "step_id": step_id, "is_current_step": step_id == current,
           "unit": v["unit"], "position": v["position"], "lesson_problem": (unit.get("worked") or {}).get("problem"),
           "lesson_givens": (unit.get("worked") or {}).get("givens")}
    if step_id == PRACTICE:
        pr = _practice(unit)
        out["practice"] = {"problem": pr.get("problem"), "givens": pr.get("givens"),
                           "scaffold": pr.get("scaffold"), "scaffold_shown": s["scaffold_shown"],
                           "hints": pr.get("hints") or [], "hints_shown": s["hints_shown"],
                           "solution_steps": pr.get("solution_steps"), "solution_revealed_to_student": s["revealed"],
                           "practice_answers_count_as_helped": _helped(s),
                           "checks": [{**{k: c.get(k) for k in ("id", "prompt", "choices", "answer", "explain")},
                                       "student": s["checks"].get(c["id"])} for c in pr.get("checks") or []]}
    else:
        st = next(x for x in _steps(unit) if x["id"] == step_id)
        out["step"] = {k: st.get(k) for k in ("id", "title", "what", "math", "why")}
        if st.get("check"):
            c = st["check"]
            out["step"]["check"] = {**{k: c.get(k) for k in ("id", "prompt", "choices", "answer", "explain")},
                                    "student": s["checks"].get(c["id"])}
    ref = visual_ref(unit, "worked" if step_id != PRACTICE else PRACTICE,
                     step_ids(unit).index(step_id) if step_id != PRACTICE else len(_steps(unit)))
    out["visual_ref"] = ref
    gv = visual_controls.guide_module()
    if ref and gv is not None and hasattr(gv, "describe"):
        try:
            out["visual_description"] = gv.describe(ref["visual_id"], gv.validate_parameters(ref["visual_id"], ref.get("parameters") or {}))
        except (KeyError, ValueError):
            pass
    return out


# ── routes ────────────────────────────────────────────────────────────────────────────────────────────────────────
def _units_view(conn, course_id: str) -> dict:
    g = guide(course_id)
    if not g:
        raise GuideError("No guided lessons for this course yet.")
    rows = conn.execute("SELECT id, unit_id, state FROM study_guide_sessions WHERE course_id=? ORDER BY updated_ts", (course_id,)).fetchall()
    latest, resume = {}, None
    for sid, uid, state in rows:
        s = json.loads(state)
        latest[uid] = s
        if s["phase"] != "done":
            resume = sid
    units = []
    for u in g.get("units") or []:
        s = latest.get(u["id"])
        units.append({**{k: u.get(k) for k in ("id", "title", "chapter", "objective", "pattern", "source_refs", "prerequisite_ids", "legacy_path")},
                      "steps": len(_steps(u)), "has_practice": bool(_practice(u)),
                      "session": {"id": s["id"], "phase": s["phase"], "index": s["index"], "total": _total(u), "updated_ts": s["updated_ts"],
                                  "summary": s.get("summary")} if s else None})
    return {"course_id": course_id, "version": g.get("version"), "scope": g.get("scope"), "units": units,
            "resume_session_id": resume, "first_unit_id": (g.get("post_quiz_plan") or {}).get("first_new_topic") or (units[0]["id"] if units else None),
            "post_quiz_plan": g.get("post_quiz_plan")}


@router.get("/api/study-guides")
def api_units(course_id: str = "2301"):
    with closing(_db()) as conn:
        try:
            return _units_view(conn, course_id)
        except GuideError as e:
            return learn_api._bad(str(e), 404)


@router.post("/api/study-guides/{unit_id}/start")
async def api_start(unit_id: str, request: Request):
    body = await request.json()
    rid = str(body.get("request_id") or "")
    with closing(_db()) as conn:
        if not rid or len(rid) > 100:
            return learn_api._bad("Reload and try again.")
        found = find_unit(unit_id, body.get("course_id") or None)
        if not found:
            return learn_api._bad("That lesson does not exist.", 404)
        cid, unit = found
        conn.execute("BEGIN IMMEDIATE")
        done = conn.execute("SELECT session_id FROM study_guide_requests WHERE request_id=?", (rid,)).fetchone()
        if done:
            s = load(conn, done[0])
            conn.rollback()
            if not s or s["unit_id"] != unit_id or s["course_id"] != cid:
                return learn_api._bad("That request was already used for a different lesson. Reload and try again.")
            return view(s, unit)
        row = None if body.get("restart") is True else conn.execute(
            "SELECT state FROM study_guide_sessions WHERE course_id=? AND unit_id=? ORDER BY updated_ts DESC LIMIT 1", (cid, unit_id)).fetchone()
        s = json.loads(row[0]) if row else None
        if not s or s["phase"] == "done":
            s = _new(cid, unit)
            conn.execute("INSERT INTO study_guide_sessions VALUES(?,?,?,?,?,?)", (s["id"], cid, unit_id, json.dumps(s), s["created_ts"], s["updated_ts"]))
        else:
            conn.execute("UPDATE study_guide_sessions SET updated_ts=? WHERE id=?", (time.time(), s["id"]))   # the one to resume
        conn.execute("INSERT INTO study_guide_requests VALUES(?,?)", (rid, s["id"]))
        conn.commit()
        return view(s, unit)


@router.get("/api/study-guide-sessions/{sid}")
def api_session(sid: str):
    with closing(_db()) as conn:
        su = session_and_unit(conn, sid)
        if not su:
            return learn_api._bad("This lesson session no longer exists.", 404)
        return view(*su)


@router.post("/api/study-guide-sessions/{sid}/act")
async def api_act(sid: str, request: Request):
    body = await request.json()
    rid = str(body.get("request_id") or "")
    with closing(_db()) as conn:
        conn.execute("BEGIN IMMEDIATE")
        su = session_and_unit(conn, sid)
        if not su:
            conn.rollback()
            return learn_api._bad("This lesson session no longer exists.", 404)
        s, unit = su
        if not rid or len(rid) > 100:
            conn.rollback()
            return learn_api._bad("Reload and try again.")
        done = conn.execute("SELECT session_id FROM study_guide_requests WHERE request_id=?", (rid,)).fetchone()
        if done:                            # durable receipts: a replay of any age never changes anything
            conn.rollback()
            if done[0] != s["id"]:
                return learn_api._bad("That request was already used for a different lesson. Reload and try again.")
            return view(s, unit)
        if body.get("revision") != s["revision"]:
            conn.rollback()
            from fastapi.responses import JSONResponse
            return JSONResponse({"error": "This lesson changed in another window; showing its current step.", "session": view(s, unit)}, status_code=409)
        try:
            act(conn, s, unit, str(body.get("action") or ""), body)
        except GuideError as e:
            conn.rollback()
            return learn_api._bad(str(e))
        _save(conn, s)
        conn.execute("INSERT INTO study_guide_requests VALUES(?,?)", (rid, s["id"]))
        conn.commit()
        return view(s, unit)
