"""Kinema 1.0 learning endpoints: the Atlas, skill pages, diagnostic questions, evidence (incl. silent chat logging),
and quick questions answered by GPT-6 Luna from confirmed notes."""
from __future__ import annotations

import json
import random
import re
import sqlite3
import time
from pathlib import Path
from typing import Callable

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from . import learning_plan, learning_progress, model_choices, curriculum, jobs, learner, notes, providers, study, tasks

router = APIRouter()
_db: Callable[[], sqlite3.Connection] | None = None
_data: Path | None = None
_lesson_digest: Callable[[dict], str] | None = None


def setup(db_factory, data_dir: Path, lesson_digest) -> None:
    global _db, _data, _lesson_digest
    _db, _data, _lesson_digest = db_factory, data_dir, lesson_digest


def _bad(msg: str, code: int = 400) -> JSONResponse:
    return JSONResponse({"error": msg}, status_code=code)


def _note_status(conn) -> dict[str, str]:
    """skill -> 'confirmed' | 'writing' | 'queued' | 'failed' (latest known)."""
    out: dict[str, str] = {}
    for r in conn.execute("SELECT key, status FROM tasks WHERE kind='note' ORDER BY updated_ts"):
        sid = (r[0] or "").split(":", 1)[-1]
        out[sid] = {"running": "writing", "queued": "queued", "failed": "failed", "done": "confirmed"}.get(r[1], r[1])
    for r in conn.execute("SELECT DISTINCT skill_id FROM notes WHERE status='confirmed'"):
        out[r[0]] = "confirmed"
    return out


# ── the Atlas ────────────────────────────────────────────────────────────────────────────────────────────────────
@router.get("/api/atlas")
def atlas() -> dict:
    cur = curriculum.load()
    conn = _db()
    st = learner.states(conn)
    nstat = _note_status(conn)
    conn.close()
    route = set(curriculum.class_route())
    chapters = []
    for ch in cur["chapters"]:
        secs = []
        for s in ch["sections"]:
            skills = [{"id": k, "title": cur["skills"][k]["title"], "state": st[k]["state"], "due": st[k]["due"],
                       "route": k in route, "note": nstat.get(k),
                       **learning_progress.skill_fields(cur['skills'][k], st[k])} for k in s["skills"]]
            secs.append({"id": s["id"], "title": s["title"], "page": s["page"], "mapped": s["mapped"], "skills": skills})
        chapters.append({"n": ch["n"], "title": ch["title"], "page": ch["page"], "sections": secs})
    states = [v["state"] for v in st.values()]
    return {"version": cur["version"], "class_now": cur["class_now"], "chapters": chapters,
            "counts": {"skills": len(st), "with_evidence": sum(1 for v in st.values() if v["state"] != "not_checked"),
                       "confirmed": sum(1 for s in states if s in ("confirmed", "mastered")),
                       "gaps": sum(1 for s in states if s == "gap"), "due": sum(1 for v in st.values() if v["due"]),
                       "route": len(route), "route_confirmed": sum(1 for k in route if st[k]["state"] in ("confirmed", "mastered")),
                       "route_gaps": sum(1 for k in route if st[k]["state"] == "gap"),
                       "route_checked": sum(1 for k in route if st[k]["state"] not in ("not_checked", "seen")),
                       "notes_confirmed": sum(1 for v in nstat.values() if v == "confirmed"),
                       "notes_route": sum(1 for k in route if nstat.get(k) == "confirmed"),
                       "notes_writing": sum(1 for v in nstat.values() if v in ("writing", "queued"))}}


@router.get("/api/path/summary")
def path_summary() -> dict:
    """Study path page: chapters 1-10 as known / shaky / weak / not checked from real evidence, plus one next thing."""
    a = atlas()
    chapters, pool = [], []
    for ch in a["chapters"]:
        if not isinstance(ch["n"], int) or ch["n"] > 10:
            continue
        skills = [k for s in ch["sections"] for k in s["skills"]]
        n = {"gap": 0, "learning": 0, "seen": 0, "confirmed": 0}
        for k in skills:
            key = "confirmed" if k["state"] in ("confirmed", "mastered") else k["state"]
            if key in n:
                n[key] += 1
        checked = n["gap"] + n["learning"] + n["confirmed"]
        if not checked:
            state = "unchecked"
        elif n["gap"] and n["gap"] * 2 >= checked:
            state = "weak"
        elif not n["gap"] and not n["learning"] and n["confirmed"] >= max(1, round(checked * 0.7)):
            state = "known"
        else:
            state = "shaky"
        chapters.append({"n": ch["n"], "title": ch["title"], "state": state, "skills": len(skills), "confirmed": n["confirmed"],
                         "shaky": n["learning"], "weak": n["gap"]})
        pool += [{**k, "chapter": ch["n"], "chapter_title": ch["title"]} for k in skills]
    pick = None
    for name, test in (("a gap on your class route", lambda k: k["state"] == "gap" and k["route"]), ("a gap to refresh", lambda k: k["state"] == "gap"),
                       ("due for a quick recheck", lambda k: k["due"]), ("on your class route and not checked yet", lambda k: k["route"] and k["state"] in ("not_checked", "seen"))):
        pick = next((k for k in pool if test(k)), None)
        if pick:
            reason = name
            break
    nxt = None
    if pick:
        nxt = {"skill_id": pick["id"], "title": pick["title"], "chapter": pick["chapter"], "reason": reason,
               "prompt": f"Let's work on {pick['title']} (chapter {pick['chapter']}). Check what I already know first, then give me one problem."}
    return {"chapters": chapters, "next": nxt}


def _state_label(s: str) -> str:
    return {"not_checked": "not checked", "gap": "gap", "seen": "seen, not tested", "learning": "learning",
            "confirmed": "confirmed", "mastered": "mastered"}[s]


# ── a skill page ─────────────────────────────────────────────────────────────────────────────────────────────────
_SUFFIXES = ("ations", "ation", "ings", "ing", "ions", "ion", "ically", "ical", "ics", "ic", "ies", "ied", "es", "ed", "y", "s", "e")


def stem(w: str) -> str:
    """Crude suffix stripping so symmetric/symmetry, rotating/rotation/rotate and torque/torques meet."""
    if w == "axes":
        return "axis"
    for suf in _SUFFIXES:
        if w.endswith(suf) and len(w) - len(suf) >= 4 and not (suf == "s" and w.endswith("ss")):
            return w[:-len(suf)]
    return w


SEARCH_STOP = set("a an the of to in on at by is are be it its as or and for with from into about how do does i what why "
                  "when which that this can find get my me we you your".split())


@router.get("/api/skills/search")
def skills_search(q: str = "", limit: int = 8) -> list:
    cur = curriculum.load()["skills"]
    words = {stem(w) for w in re.findall(r"[a-z0-9]+", q.lower()) if w not in SEARCH_STOP}
    if not words:
        return []
    scored = []
    for sid, k in cur.items():
        title = {stem(w) for w in re.findall(r"[a-z0-9]+", (k["title"] + " " + sid).lower())}
        task = {stem(w) for w in re.findall(r"[a-z0-9]+", k["task"].lower())}
        score = 2 * len(words & title) + len((words & task) - title) + (3 if q.lower() in k["title"].lower() else 0)
        if score:
            scored.append((score, sid))
    scored.sort(key=lambda x: (-x[0], x[1]))
    return [{"id": sid, "title": cur[sid]["title"], "score": sc} for sc, sid in scored[:limit]]


@router.get("/api/skills/states")
def skills_states(ids: str = ""):
    cur = curriculum.load()["skills"]
    want = [s for s in ids.split(",") if s in cur][:20]
    if not want:
        return []
    conn = _db()
    st = learner.states(conn)
    conn.close()
    return [{"id": s, "title": cur[s]["title"], "state": st[s]["state"], "questions": len(cur[s]["questions"]),
             **learning_progress.skill_fields(cur[s], st[s])} for s in want]


@router.get("/api/skills/{sid}")
def skill_page(sid: str):
    cur = curriculum.load()
    k = cur["skills"].get(sid)
    if not k:
        return _bad("no such skill", 404)
    conn = _db()
    st = learner.states(conn)
    note = notes.latest(conn, sid)
    task = conn.execute("SELECT status, progress, error FROM tasks WHERE key=?", (f"note:{sid}",)).fetchone()
    evid = learner.evidence_for(conn, sid)
    conn.close()
    sec = cur["sections"][k["section"]]
    out = {"id": sid, "title": k["title"], "task": k["task"], "chapter": k["chapter"], "section": {"id": sec["id"], "title": sec["title"]},
           "page": k["page"], "pdf_page": curriculum.page_pdf(k["page"]), "state": st[sid], "state_label": _state_label(st[sid]["state"]),
           "route": sid in set(curriculum.class_route()),
           "prereqs": [{"id": p["id"], "title": cur["skills"][p["id"]]["title"], "type": p["type"], "why": p["why"],
                        "state": st[p["id"]]["state"]} for p in k["prereqs"]],
           "used_by": [{"id": u, "title": cur["skills"][u]["title"], "state": st[u]["state"]} for u in k["used_by"]],
           "evidence": evid, "questions": len(k["questions"]), "example": sid in cur["examples"],
           "takeaway": (cur["examples"].get(sid) or {}).get("takeaway"),
           **learning_progress.skill_fields(k, st[sid])}
    if note:
        out["note"] = {"version": note["version"], "body": note["body"], "confirmed_ts": note["confirmed_ts"],
                       "writer": note["writer"], "pages": (note["sources"] or {}).get("pages_sent"),
                       "reviewer": ((note["review"] or {}).get("reviewer") or {}).get("model"),
                       "checks": {k2: (note["checks"] or {}).get(k2) for k2 in ("arithmetic_ok", "independent_ok")}}
    elif task:
        out["note_task"] = {"status": task[0], "progress": task[1], "error": (task[2] or "")[:300]}
    return out


@router.post("/api/skills/{sid}/note")
def skill_note_request(sid: str):
    if sid not in curriculum.load()["skills"]:
        return _bad("no such skill", 404)
    conn = _db()
    t = tasks.enqueue(conn, "note", {"skill": sid}, key=f"note:{sid}", priority=5, retry_failed=True)
    conn.commit()
    conn.close()
    return {"status": t["status"], "task": t["id"]}


# ── diagnostic questions ─────────────────────────────────────────────────────────────────────────────────────────
def pick_question(conn, sid: str, rnd: random.Random | None = None) -> dict | None:
    """A question for the skill: one never asked first, else the one asked longest ago."""
    cur = curriculum.load()
    qids = cur["skills"][sid]["questions"]
    if not qids:
        return None
    last = {r[0]: r[1] for r in conn.execute("SELECT question_id, MAX(ts) FROM attempts WHERE question_id IN (%s) GROUP BY question_id"
                                                % ",".join("?" * len(qids)), qids)}
    qid = sorted(qids, key=lambda q: (last.get(q, -1), q))[0]
    q = cur["questions"][qid]
    order = list(range(len(q["choices"])))
    (rnd or random.Random()).shuffle(order)
    return {"question_id": qid, "skill": sid, "skill_title": cur["skills"][sid]["title"], "stem": q["stem"],
            "choices": [q["choices"][i] for i in order], "order": order, "version": cur["questions_version"]}


@router.get("/api/skills/{sid}/question")
def skill_question(sid: str):
    if sid not in curriculum.load()["skills"]:
        return _bad("no such skill", 404)
    conn = _db()
    q = pick_question(conn, sid)
    conn.close()
    return q or _bad("this skill has no questions yet", 404)


@router.post("/api/questions/{qid}/answer")
async def question_answer(qid: str, request: Request):
    body = await request.json()
    if qid not in curriculum.load()["questions"]:
        return _bad("no such question", 404)
    source = body.get("source") if body.get("source") in ("placement", "session", "review", "note") else "session"
    conn = _db()
    try:
        r = learner.answer_question(conn, qid, picked=body.get("picked"), dont_know=bool(body.get("dont_know")),
                                    choice_order=body.get("order"), source=source, session_id=body.get("session_id"),
                                    hinted=bool(body.get("hinted")), dedup=body.get("dedup"))
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        conn.close()
        return _bad(str(exc))
    conn.commit()
    r["state"] = learner.states(conn)[r.get("skill") or curriculum.load()["questions"][qid]["skill"]]
    conn.close()
    return r


# ── evidence, including the Physics chat logging silently ────────────────────────────────────────────────────────
@router.post("/api/evidence")
async def evidence_add(request: Request):
    body = await request.json()
    items = body.get("items") if isinstance(body.get("items"), list) else [body]
    cur = curriculum.load()["skills"]
    conn = _db()
    out = []
    for it in items[:50]:
        sid = it.get("skill")
        if sid not in cur:
            hits = skills_search(str(sid or it.get("skill_title") or ""), limit=1)
            if not hits or not it.get("allow_title_match"):
                out.append({"skill": sid, "error": "unknown skill"})
                continue
            sid = hits[0]["id"]
        try:
            ok = learner.record(conn, sid, it.get("kind", "taught"), it.get("outcome", "exposure"),
                                it.get("source", "chat") if it.get("source") in learner.SOURCES else "chat",
                                ref=str(it.get("ref", ""))[:200], detail={"note": str(it.get("note", ""))[:500]},
                                dedup=it.get("dedup"), now=it.get("ts"))
            out.append({"skill": sid, "recorded": ok, "duplicate": not ok})
        except (ValueError, KeyError) as exc:
            out.append({"skill": sid, "error": str(exc)})
    conn.commit()
    st = learner.states(conn)
    conn.close()
    for o in out:
        if o.get("skill") in st:
            o["state"] = st[o["skill"]]["state"]
    return {"results": out}


# ── quick questions: GPT-6 Luna answers from confirmed notes ────────────────────────────────────────────────────
STRONG_MATCH = 4          # e.g. two words of a skill's title (stopwords ignored): only then is a skill suggested without Luna
QUICK_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["covered", "answer", "sources", "skills", "missing"],
                "properties": {"covered": {"type": "boolean"}, "answer": {"type": "string"},
                               "sources": {"type": "array", "items": {"type": "string"}},
                               "skills": {"type": "array", "items": {"type": "string"}},
                               "missing": {"type": "string"}}}

QUICK_RULES = """You are Kinema's quick tutor for one university physics student (Morin, Introduction to Classical Mechanics).
Answer the question using ONLY the numbered passages below. They are the student's confirmed notes (and possibly the
lesson of the homework problem they have open). Rules:
- If the passages contain what is needed, set covered=true and answer in at most 4 short sentences plus at most one
  equation ($...$ LaTeX). Cite the passage ids you used in "sources".
- If they do not fully cover the question, set covered=false, answer with one sentence saying what is missing, and
  do not guess or fill the gap from memory.
- If the question assumes something the passages contradict, say so in the first sentence and give the correct
  statement from the passages. Never go along with a false premise.
- If the question could mean more than one thing and the passages cover one reading, answer that reading and name
  it in a few words (covered=true). Only when no reasonable reading is covered, set covered=false.
- Decide "covered" from the passages alone; the NOT YET WRITTEN list below matters only when covered=false.
- "skills": the skill ids (given with each passage) that the question is about.
- "missing": when covered=false and the question is about one of the NOT YET WRITTEN skills listed after the
  passages, that skill's id; otherwise "".
- Put every symbol and equation inside $...$, for example $\\mathbf L$. In the JSON output each LaTeX backslash
  is written twice ("$\\\\mathbf L$").
- Match the notation of the passages. No preamble, and no passage ids in the answer text (they go in "sources")."""


_BS = chr(92)
_JSON_ESC = {"\b": "b", "\f": "f", "\t": "t", "\r": "r"}
_NL_TEX = re.compile(r"\n(?=(?:abla|eq|ot|eg)(?![a-z]))")
_CMD = re.compile(r"\\[A-Za-z]+")


def clean_tex(s: str) -> str:
    """Put back LaTeX backslashes that came through as JSON escapes or stray control characters (Luna, 2026-09-23:
    \\x04mathbf, \\x06omega, \\x03frac), then wrap bare LaTeX in $...$ so it renders."""
    s = _NL_TEX.sub(lambda m: _BS + "n", s or "")
    s = "".join(_BS + _JSON_ESC[ch] if ch in _JSON_ESC else _BS if ord(ch) < 32 and ch != "\n" else ch for ch in s)
    if "$" in s or not _CMD.search(s):
        return s
    toks, out, i = re.split(r"(\s+)", s), [], 0
    sym = re.compile(r"^[A-Za-z0-9=+\-*/^_(){}\[\],|']$|^[=+\-*/<>]+$")
    while i < len(toks):
        t = toks[i]
        if not _CMD.search(t):
            out.append(t); i += 1
            continue
        run = [t]; j = i + 1
        while j + 1 < len(toks) and (_CMD.search(toks[j + 1]) or sym.match(toks[j + 1].rstrip(".,;:"))):
            run += [toks[j], toks[j + 1]]; j += 2
        text = "".join(run)
        tail = text[len(text.rstrip(".,;:")):]
        out.append("$" + text[:len(text) - len(tail)] + "$" + tail); i = j
    return "".join(out)


def _note_text(n: dict) -> str:
    b = n["body"]
    eqs = "; ".join(e["latex"] + " (" + e["meaning"] + ")" for e in b.get("key_equations", []))
    claims = " ".join(f"Q: {c['question']} A: {c['answer']}" for c in b.get("claims", []))
    ex = b.get("worked_example") or {}
    return (f"{b.get('title')}. Use when: {b.get('use_when')}\n{b.get('explanation')}\nKey equations: {eqs}\n"
            f"Steps: {' / '.join(b.get('steps', []))}\nMistakes: {' / '.join(b.get('mistakes', []))}\n{claims}\n"
            f"Example: {ex.get('problem')} Result: {ex.get('value')} {ex.get('unit')}. Notation: {b.get('notation')}")


STOP = set("the and for are what which how why when with from that this does into about than then there their has have its "
           "can you your use using does not all any one two".split())


def retrieve(conn, question: str, skill_hint: str | None = None, k: int = 3) -> list[dict]:
    """BM25-style ranking over confirmed notes, titles weighted up; the open skill always comes first."""
    import math
    words = list(dict.fromkeys(stem(w) for w in re.findall(r"[a-z]{3,}", question.lower()) if w not in STOP))
    docs = []
    for sid, n in notes.confirmed_map(conn).items():
        text = _note_text(n)
        title = curriculum.load()["skills"][sid]["title"] + " " + (n["body"].get("title") or "")
        toks = [stem(w) for w in re.findall(r"[a-z]{3,}", (text + " " + title + " " + title).lower())]
        docs.append((sid, n, text, toks))
    if not docs:
        return []
    avg = sum(len(d[3]) for d in docs) / len(docs)
    df = {w: sum(1 for d in docs if w in set(d[3])) for w in set(words)}
    cands = []
    for sid, n, text, toks in docs:
        tf: dict[str, int] = {}
        for t in toks:
            tf[t] = tf.get(t, 0) + 1
        score = 0.0
        for w in words:
            if not tf.get(w):
                continue
            idf = math.log(1 + (len(docs) - df[w] + 0.5) / (df[w] + 0.5))
            score += idf * tf[w] * 2.2 / (tf[w] + 1.2 * (0.25 + 0.75 * len(toks) / avg))
        if sid == skill_hint:
            score += 1000
        if score > 0:
            cands.append((score, sid, n, text))
    cands.sort(key=lambda x: -x[0])
    top = cands[:k]
    # the skill the question names (skill-map search over titles and tasks) joins even when longer notes outscore it
    by_sid = {sid: (n, text) for sid, n, text, _ in docs}
    hit = next((h for h in skills_search(question, limit=3) if h["score"] >= STRONG_MATCH and h["id"] in by_sid), None)
    if hit and hit["id"] not in {sid for _, sid, _, _ in top}:
        top.append((0.0, hit["id"], *by_sid[hit["id"]]))
    return [{"id": f"n{i + 1}", "skill": sid, "version": n["version"], "text": text[:3500]} for i, (sc, sid, n, text) in enumerate(top)]


def _quick_job(question: str, problem_id: str | None, skill_id: str | None):
    choice = model_choices.current("chat")
    def run(job):
        job.phase = "finding your notes"
        conn = _db()
        passages = retrieve(conn, question, skill_id)
        lesson = None
        if problem_id:
            row = conn.execute("SELECT scene, title FROM problems WHERE id=?", (problem_id,)).fetchone()
            if row:
                try:
                    lesson = {"id": "lesson", "text": _lesson_digest(json.loads(row[0]))[:5000], "title": row[1]}
                except Exception:  # noqa: BLE001
                    lesson = None
        # skills on the map without a confirmed note that look related; Luna decides whether the question is about one
        unwritten = [h for h in skills_search(question, limit=6) if not notes.latest(conn, h["id"])][:4]
        st = learner.states(conn)
        conn.close()
        if not passages and not lesson and not unwritten:
            return {"covered": False, "answer": "", "sources": [], "reason": "nothing on your map matches this question yet",
                    "suggest": [], "skills": []}
        blocks = [f"[{p['id']}] (skill {p['skill']}, confirmed note v{p['version']}, student: {st[p['skill']]['state']})\n{p['text']}"
                  for p in passages]
        if lesson:
            blocks.append(f"[lesson] (the homework lesson '{lesson['title']}': from your selected builder, numbers engine-checked where "
                          f"supported; NOT a confirmed note)\n{lesson['text']}")
        todo = "\n".join(f"{h['id']}: {h['title']}" for h in unwritten) or "(none)"
        prompt = (QUICK_RULES + "\n\nPASSAGES\n" + ("\n\n".join(blocks) or "(none)") + "\n\nNOT YET WRITTEN (on the student's map, no confirmed note yet)\n"
                  + todo + f"\n\nQUESTION: {question}")
        job.phase = "asking " + choice["label"]
        schema_path = (_data or Path(".")) / "quick.schema.json"
        schema_path.write_text(json.dumps(QUICK_SCHEMA), encoding="utf-8")
        try:
            text, meta = model_choices.run(choice, prompt, schema_text=json.dumps(QUICK_SCHEMA))
        except providers.ProviderError as exc:
            return {"covered": False, "answer": "", "sources": [], "error": f"{choice['label']} is unavailable: {exc}"[:400],
                    "suggest": skills_search(question, limit=3)}
        try:
            out = json.loads(text)
        except ValueError:
            out = providers.extract_json(text)
        by_id = {p["id"]: p for p in passages}
        cited = [s for s in out.get("sources", []) if s in by_id or s == "lesson"]
        src = [{"id": s, "skill": by_id[s]["skill"], "title": curriculum.load()["skills"][by_id[s]["skill"]]["title"],
                "version": by_id[s]["version"], "kind": "note"} if s in by_id else {"id": "lesson", "kind": "lesson", "title": lesson["title"]}
               for s in cited]
        covered = bool(out.get("covered")) and bool(cited)
        out["answer"] = re.sub(r"\s*\[(?:n\d+|lesson)\](?=[\s.,;:]|$)", "", clean_tex(out.get("answer", ""))).strip()
        conn = _db()
        skills = ([s for s in out.get("skills", []) if s in curriculum.load()["skills"]]
                  or list(dict.fromkeys(x["skill"] for x in src if x["kind"] == "note")))
        for s in skills[:3]:
            learner.record(conn, s, "asked", "exposure", "quick", ref=question[:120], dedup=f"quick:{job.id}:{s}")
        tags = [f"note:{x['skill']}@{x['version']}" for x in src if x["kind"] == "note"]
        study.add_message(conn, problem_id or "quick", "user", question, {"kind": "quick"})
        study.add_message(conn, problem_id or "quick", "assistant", out.get("answer", ""),
                          {"kind": "quick", "sources": tags, "covered": covered, "model": meta.get("model"), "tier": meta.get("tier"),
                           "secs": meta.get("secs")})
        writing, suggest = None, []
        miss = next((h for h in unwritten if h["id"] == out.get("missing")), None) if not covered else None
        if miss:
            tasks.enqueue(conn, "note", {"skill": miss["id"]}, key=f"note:{miss['id']}", priority=3)
            writing, suggest = {"id": miss["id"], "title": miss["title"]}, [miss]
        conn.commit()
        conn.close()
        return {"covered": covered, "answer": out.get("answer", ""), "sources": src, "skills": skills, "writing": writing,
                "model": choice["label"], "tier": meta.get("tier"), "secs": meta.get("secs"), "suggest": suggest}
    return run


@router.post("/api/quick")
async def quick(request: Request):
    body = await request.json()
    q = str(body.get("q") or "").strip()
    if not q:
        return _bad("ask something")
    job = jobs.start("quick", _quick_job(q[:1200], body.get("problem_id"), body.get("skill_id")), {"q": q[:200]})
    return {"job": job.id}


ASK_OPUS_SYSTEM = """You are Kinema's tutor for one university physics student (Morin, Introduction to Classical Mechanics).
Answer the question directly and correctly in at most 6 sentences with at most two equations ($...$ LaTeX), in
Morin's notation. This answer has NOT been through Kinema's note checking, so be careful and say so if unsure."""


def _opus_job(question: str):
    choice = model_choices.current("chat")
    def run(job):
        job.phase = "asking " + choice["label"]
        text, meta = model_choices.run(choice, question, system=ASK_OPUS_SYSTEM, timeout=300)
        conn = _db()
        study.add_message(conn, "quick", "user", question, {"kind": "quick-opus"})
        study.add_message(conn, "quick", "assistant", text, {"kind": "quick-opus", "verified": False, "model": meta.get("model")})
        conn.commit()
        conn.close()
        return {"answer": text.strip(), "verified": False, "model": choice["label"], "secs": meta.get("secs")}
    return run


@router.post("/api/quick/opus")
async def quick_opus(request: Request):
    body = await request.json()
    q = str(body.get("q") or "").strip()
    if not q:
        return _bad("ask something")
    job = jobs.start("quick-opus", _opus_job(q[:1200]), {"q": q[:200]})
    return {"job": job.id}


# ── 30-minute sessions ──────────────────────────────────────────────────────────────────────────────────────────
from . import practice  # noqa: E402
from . import session as sess  # noqa: E402


def _question_payload(conn, skill_id: str, question_id: str | None = None) -> dict | None:
    if not question_id:
        return pick_question(conn, skill_id)
    cur = curriculum.load()
    q = cur["questions"].get(question_id)
    if not q:
        return pick_question(conn, skill_id)
    order = list(range(len(q["choices"])))
    random.shuffle(order)
    return {"question_id": question_id, "skill": skill_id, "skill_title": cur["skills"][skill_id]["title"], "stem": q["stem"],
            "choices": [q["choices"][i] for i in order], "order": order, "version": cur["questions_version"]}


def _hydrate(conn, item: dict) -> dict:
    cur = curriculum.load()
    sid = item.get("skill")
    if sid:
        k = cur["skills"][sid]
        sec = cur["sections"][k["section"]]
        where = (f"Morin, {sec['title']} ({sec['ref']})" if k["section"].startswith("M.") else f"Morin §{sec['id']} {sec['title']}")
        item.update({"skill_title": k["title"], "chapter": k["chapter"], "section": k["section"], "task": k["task"],
                     "page": k["page"], "pdf_page": curriculum.page_pdf(k["page"]), "where": where})
    if item["type"] in ("placement", "check"):
        item["question"] = _question_payload(conn, sid, item.get("question_id"))
    elif item["type"] == "example":
        item["example"] = cur["examples"].get(sid)
    elif item["type"] == "turn":
        item["question"] = _question_payload(conn, sid, item.get("question_id"))
        item["example"] = cur["examples"].get(sid)
        if item.get("lesson"):
            r = _rung(item["lesson"], item["rung"])
            item["example"] = {"problem": r["problem"], "steps": r["steps"], "answer": r["answer"], "takeaway": r["takeaway"]}
            item["rung_info"] = {"n": r["n"], "title": r["title"], "level": r["level"], "new": r["new"],
                                 "total": len(cur["lessons"][item["lesson"]]["rungs"])}
    elif item["type"] == "sheet":
        item.update(lesson_sheet(item["lesson"]))
        item["progress"] = practice.lesson_progress(conn, item["lesson"])
    elif item["type"] == "rung":
        ls = cur["lessons"][item["lesson"]]
        r = _rung(item["lesson"], item["rung"])
        item["example"] = {"problem": r["problem"], "steps": r["steps"], "answer": r["answer"], "takeaway": r["takeaway"]}
        item["rung_info"] = {"n": r["n"], "title": r["title"], "level": r["level"], "new": r["new"], "total": len(ls["rungs"]),
                             "has_turn": bool(r.get("turn"))}
        fmap = {f["id"]: f for g in ls["groups"] for f in g["formulas"]}
        item["formulas"] = [fmap[u] for u in r.get("uses", []) if u in fmap]
    elif item["type"] == "refresh":
        n = notes.latest(conn, sid)
        item["note"] = n["body"] if n else None
        item["note_version"] = n["version"] if n else None
        item["question"] = pick_question(conn, sid)
        if not n:
            t = tasks.enqueue(conn, "note", {"skill": sid}, key=f"note:{sid}", priority=4)
            item["note_status"] = t["status"]
    return item


def _next(conn, s: dict) -> dict:
    """The next item, hydrated; lesson items also carry the ladder for the side panel."""
    nxt = _hydrate(conn, sess.next_item(conn, s))
    if s.get("mode") == "lesson":
        nxt["ladder"] = practice.ladder(conn, s, nxt.get("rung"))
    return nxt


def _rung(lid: str, n: int) -> dict:
    return next(r for r in curriculum.load()["lessons"][lid]["rungs"] if r["n"] == n)


@router.get("/api/lessons/{lid}")
def lesson_sheet(lid: str):
    ls = curriculum.load()["lessons"].get(lid)
    if not ls:
        return _bad("no such lesson", 404)
    return {"id": ls["id"], "title": ls["title"], "groups": ls["groups"], "chapters": ls.get("chapters", [ls.get("chapter")]),
            "rungs": [{"n": r["n"], "title": r["title"], "level": r["level"], "new": r["new"]} for r in ls["rungs"]]}


def _sess_view(s: dict) -> dict:
    spent = sum(it.get("secs") or sess.COST.get(it.get("type"), 60) for it in s["items"])
    counts: dict[str, int] = {}
    for it in s["items"]:
        counts[it.get("type") or "?"] = counts.get(it.get("type") or "?", 0) + 1
    return {"id": s["id"], "started_ts": s["started_ts"], "budget_s": s["budget_s"], "spent_s": spent, "items": len(s["items"]),
            "counts": counts, "ended": bool(s.get("ended_ts")), "mode": s.get("mode", "daily"), "lesson": (s.get("scope") or {}).get("lesson"),
            "plan": (s.get("scope") or {}).get("learning_plan"), "title": (s.get("scope") or {}).get("title"), "skills": len((s.get("scope") or {}).get("targets") or [])}


@router.get("/api/session/plan")
def session_plan():
    conn = _db()
    p = sess.plan(conn)
    conn.close()
    return p


def _begin(conn, s: dict) -> dict:
    nxt = _next(conn, s)
    conn.commit()
    return {"session": _sess_view(s), "next": nxt}


@router.post("/api/goal")
async def goal(request: Request):
    """Plain words from the owner ("practise chapter 9 before my next class"): a practice session, or a question for Luna."""
    body = await request.json()
    from starlette.concurrency import run_in_threadpool
    text = str(body.get("text") or "").strip()[:1200]
    if not text:
        return _bad("Tell me what you want to learn.")
    try:
        g = await run_in_threadpool(learning_plan.interpret, text, lambda q, n: skills_search(q, limit=n), body.get('lesson'))
    except (providers.ProviderError, ValueError, TypeError) as exc:
        return _bad(f"I couldn't plan that yet: {exc}", 503)
    if g["kind"] != "practice" or g.get("error"):
        return g
    conn = _db()
    try:
        scope = learning_plan.prepare(conn, g['scope'])
        n = body.get('rung')
        if n is not None:
            ls = curriculum.load()['lessons'].get(scope.get('lesson'), {})
            if isinstance(n, bool) or not isinstance(n, int) or n not in [r['n'] for r in ls.get('rungs', [])]:
                return _bad('No such problem in this course.')
            scope['workspace_rung'] = n
        out = {"kind": "practice", **_begin(conn, sess.start_practice(conn, scope))}
        return out
    finally:
        conn.close()


@router.post("/api/practice/skill")
async def practice_skill(request: Request):
    """"Walk me through an example" on a skill page: practice scoped to that skill."""
    body = await request.json()
    sid = body.get("skill")
    if sid not in curriculum.load()["skills"]:
        return _bad("no such skill", 404)
    conn = _db()
    out = _begin(conn, sess.start_practice(conn, practice.scope_for([sid], curriculum.load()["skills"][sid]["title"])))
    conn.close()
    return out


@router.post("/api/session/{session_id}/extend")
def session_extend(session_id: str):
    conn = _db()
    if not sess.get(conn, session_id):
        conn.close()
        return _bad("no such session", 404)
    sess.extend(conn, session_id)
    out = _begin(conn, sess.get(conn, session_id))
    conn.close()
    return out


@router.post("/api/session/start")
def session_start():
    conn = _db()
    s = sess.resume_or_practice(conn)
    nxt = _next(conn, s)
    conn.commit()
    conn.close()
    return {"session": _sess_view(s), "next": nxt}


@router.get("/api/skills/{sid}/note")
def skill_note(sid: str):
    """Poll target for a refresher waiting on its note."""
    conn = _db()
    n = notes.latest(conn, sid)
    t = conn.execute("SELECT status, progress FROM tasks WHERE key=?", (f"note:{sid}",)).fetchone()
    conn.close()
    return {"note": n["body"] if n else None, "version": n["version"] if n else None, "task": dict(zip(("status", "progress"), t)) if t else None}


@router.get("/api/session/{session_id}/next")
def session_next(session_id: str):
    conn = _db()
    s = sess.get(conn, session_id)
    if not s:
        conn.close()
        return _bad("no such session", 404)
    nxt = _next(conn, s)
    conn.commit()
    conn.close()
    return {"session": _sess_view(s), "next": nxt}


@router.post("/api/session/{session_id}/answer")
async def session_answer(session_id: str, request: Request):
    body = await request.json()
    conn = _db()
    s = sess.get(conn, session_id)
    if not s:
        conn.close()
        return _bad("no such session", 404)
    typ = body.get("type")
    secs = max(1, min(1800, int(body.get("secs") or 0))) if body.get("secs") else None
    result: dict = {}
    try:
        if typ == "sheet":
            sess.log_item(conn, session_id, {"type": "sheet", "lesson": body.get("lesson"), "start_at": max(1, int(body.get("start_at") or 1)),
                                             "outcome": "read", "ts": time.time(), "secs": secs})
            result = {"outcome": "read"}
        elif typ == "rung":
            lid, n = body.get("lesson"), int(body.get("rung"))
            r = _rung(lid, n)
            done = body.get("outcome") != "skipped"
            if done:     # followed to the end: exposure (seen), never recall
                for sk in r["skills"]:
                    learner.record(conn, sk, "taught", "exposure", "session", ref=f"lesson:{lid}:{n}", dedup=f"sess:{session_id}:rung:{n}:{sk}")
            sess.log_item(conn, session_id, {"type": "rung", "lesson": lid, "rung": n, "skill": r["skills"][0],
                                             "outcome": "done" if done else "skipped", "ts": time.time(), "secs": secs})
            result = {"skill": r["skills"][0], "outcome": "done" if done else "skipped"}
        elif typ == "example":
            sid = body.get("skill")
            if sid not in curriculum.load()["skills"]:
                raise ValueError("unknown skill")
            done = body.get("outcome") != "skipped"
            if done:     # followed to the end: exposure (seen), never recall
                learner.record(conn, sid, "taught", "exposure", "session", ref=f"example:{sid}", dedup=f"sess:{session_id}:ex:{sid}")
            sess.log_item(conn, session_id, {"type": "example", "skill": sid, "outcome": "done" if done else "skipped", "ts": time.time(), "secs": secs})
            result = {"skill": sid, "outcome": "done" if done else "skipped"}
        elif typ in ("placement", "check", "refresh", "turn"):
            qid = body.get("question_id")
            if qid:
                result = learner.answer_question(conn, qid, picked=body.get("picked"), dont_know=bool(body.get("dont_know")),
                                                 choice_order=body.get("order"), source="placement" if typ == "placement" else "session",
                                                 session_id=session_id, dedup=f"sess:{session_id}:{qid}:{len(s['items'])}")
            sess.log_item(conn, session_id, {"type": typ, "skill": body.get("skill") or result.get("skill"), "question_id": qid,
                                             "outcome": result.get("outcome", "read"), "ts": time.time(), "secs": secs,
                                             "retry": bool(body.get("retry")) or None, "rung": body.get("rung"), "lesson": body.get("lesson")})
        elif typ == "card":
            result = study.review(conn, body["card_id"], body.get("grade", "good"))
            sess.log_item(conn, session_id, {"type": "card", "card_id": body["card_id"], "outcome": body.get("grade"), "ts": time.time(),
                                             "secs": secs, "new": bool(body.get("new"))})
        else:
            conn.close()
            return _bad("unknown item type")
    except (KeyError, ValueError, TypeError) as exc:
        conn.close()
        return _bad(str(exc))
    s = sess.get(conn, session_id)
    nxt = _next(conn, s)
    conn.commit()
    st = learner.states(conn)
    conn.close()
    if result.get("skill"):
        result["state"] = st[result["skill"]]["state"]
    return {"result": result, "session": _sess_view(s), "next": nxt}


@router.post("/api/session/{session_id}/end")
def session_end(session_id: str):
    conn = _db()
    sess.end(conn, session_id)
    s = sess.get(conn, session_id)
    conn.commit()
    conn.close()
    return {"session": _sess_view(s) if s else None}
