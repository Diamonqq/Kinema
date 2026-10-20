"""Confirmed notes: one per skill, written by Opus 5.5 from the book's own pages, checked by Fable 5.1, and only then
available to the quick tutor (GPT-6 Luna).

Owner (2026-09-23): Opus "does the work in the background and just has like 100% confirmed notes" that Luna reads.
Nothing is literally 100 %, so "confirmed" means this documented procedure passed (Astra review, 2026-09-23):
  1. Opus 5.5 (high) writes the note from rendered pages of Morin, with claims (key results posed as questions) and a
     worked example given as numeric givens + a Python expression + the value.
  2. Fable 5.1 answers the claim questions and computes the example BLIND, from the same pages, before it sees the
     note's answers (so the two models can't simply agree on the same slip).
  3. Our own evaluator recomputes the example from its expression; Fable's independent number must match too.
  4. Fable compares the note with its own committed answers, checks units, limits and Morin's notation, and returns
     confirm / fix / reject. One fix round; otherwise the note is rejected and Luna never sees it.
Every version is kept (immutable body); revoking a version also flags quick answers that cited it.
"""
from __future__ import annotations

import ast
import json
import math
import re
import sqlite3
import tempfile
import threading
import time
from pathlib import Path

from . import curriculum, providers

WRITER_MODEL, WRITER_EFFORT = "claude-opus-5-5", "high"
REVIEWER_MODEL, REVIEWER_EFFORT = "claude-fable-5-1", "high"
MAX_PAGES = 7
RENDER_SCALE = 1.5
PACK_DIR = Path(__file__).resolve().parent / "content" / "notes"
_pdf_lock = threading.Lock()


class NoteError(RuntimeError):
    retryable = True


def ensure_tables(conn: sqlite3.Connection) -> None:
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS notes(
        id INTEGER PRIMARY KEY AUTOINCREMENT, skill_id TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL,
        body TEXT NOT NULL, sources TEXT NOT NULL, writer TEXT NOT NULL, review TEXT, checks TEXT,
        created_ts REAL NOT NULL, updated_ts REAL NOT NULL, confirmed_ts REAL, revoked_reason TEXT,
        UNIQUE(skill_id, version));
    CREATE INDEX IF NOT EXISTS notes_skill ON notes(skill_id, status, version);
    """)


# ── the book ────────────────────────────────────────────────────────────────────────────────────────────────────
def _pdf():
    import pypdfium2 as pdfium          # imported lazily: only the background writer needs it
    book = curriculum.load()["book"]
    from . import book_library
    path = book_library.source_pdf() or Path(book.get("pdf") or "")
    if not path.is_file():
        raise NoteError(f"Morin PDF not found at {path}")
    return pdfium.PdfDocument(str(path))


def section_pages(skill_id: str) -> list[int]:
    """Book pages of the skill's section: from its first page to the page before the next section starts."""
    cur = curriculum.load()
    sk = cur["skills"][skill_id]
    ch = next(c for c in cur["chapters"] if c["n"] == sk["chapter"])
    start = sk["page"]
    later = [s["page"] for s in ch["sections"] if s.get("page") and s["page"] > start]
    stop = [ch["problems_page"]] if ch.get("problems_page") and ch["problems_page"] > start else []
    end = min(later + stop) if (later or stop) else start + 4     # the next section may begin mid-page: keep that page
    return list(range(start, end + 1))


def _words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z]{4,}", text.lower())}


def select_pages(skill_id: str) -> list[int]:
    """Up to MAX_PAGES book pages: the whole section when short, else the pages that best match the skill."""
    pages = section_pages(skill_id)
    if len(pages) <= MAX_PAGES:
        return pages
    sk = curriculum.load()["skills"][skill_id]
    want = _words(sk["title"] + " " + sk["task"])
    off = curriculum.load()["book"]["pdf_offset"]
    with _pdf_lock:
        pdf = _pdf()
        scored = []
        for bp in pages:
            txt = pdf[bp + off - 1].get_textpage().get_text_range()
            scored.append((len(want & _words(txt)), bp))
    keep = {pages[0]} | {bp for _, bp in sorted(scored, reverse=True)[:MAX_PAGES - 1]}
    return sorted(keep)


def render(pages: list[int], out_dir: Path) -> list[str]:
    off = curriculum.load()["book"]["pdf_offset"]
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    with _pdf_lock:
        pdf = _pdf()
        for bp in pages:
            p = out_dir / f"morin-p{bp}.png"
            if not p.exists():
                pdf[bp + off - 1].render(scale=RENDER_SCALE).to_pil().save(p)
            paths.append(str(p))
    return paths


# ── safe recomputation of the worked example ────────────────────────────────────────────────────────────────────
_FUNCS = {"sqrt": math.sqrt, "sin": math.sin, "cos": math.cos, "tan": math.tan, "asin": math.asin, "acos": math.acos,
          "atan": math.atan, "atan2": math.atan2, "exp": math.exp, "log": math.log, "abs": abs, "radians": math.radians,
          "degrees": math.degrees}
_CONSTS = {"pi": math.pi, "e": math.e, "g": 9.8}
_BIN = {ast.Add: lambda a, b: a + b, ast.Sub: lambda a, b: a - b, ast.Mult: lambda a, b: a * b, ast.Div: lambda a, b: a / b,
        ast.Pow: lambda a, b: a ** b}


def safe_eval(expr: str, names: dict[str, float]) -> float:
    """Evaluate a small arithmetic expression: numbers, the given names, + - * / **, and math functions only."""
    tree = ast.parse(str(expr).replace("^", "**"), mode="eval")

    def ev(n):
        if isinstance(n, ast.Expression):
            return ev(n.body)
        if isinstance(n, ast.Constant) and isinstance(n.value, (int, float)) and not isinstance(n.value, bool):
            return float(n.value)
        if isinstance(n, ast.Name):
            if n.id in names:
                return float(names[n.id])
            if n.id in _CONSTS:
                return _CONSTS[n.id]
            raise ValueError(f"unknown name {n.id}")
        if isinstance(n, ast.BinOp) and type(n.op) in _BIN:
            return _BIN[type(n.op)](ev(n.left), ev(n.right))
        if isinstance(n, ast.UnaryOp) and isinstance(n.op, (ast.USub, ast.UAdd)):
            v = ev(n.operand)
            return -v if isinstance(n.op, ast.USub) else v
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id in _FUNCS and not n.keywords:
            return float(_FUNCS[n.func.id](*[ev(a) for a in n.args]))
        raise ValueError(f"not allowed in an expression: {type(n).__name__}")

    return ev(tree)


def _close(a: float, b: float, rel: float) -> bool:
    return math.isfinite(a) and math.isfinite(b) and abs(a - b) <= rel * max(abs(a), abs(b), 1e-12)


def recompute(body: dict, blind_value: float | None) -> dict:
    ex = body.get("worked_example") or {}
    givens = {g["name"]: g["value"] for g in ex.get("givens", []) if isinstance(g.get("value"), (int, float))}
    out = {"expression": ex.get("expression"), "stated": ex.get("value"), "blind": blind_value}
    try:
        val = safe_eval(ex.get("expression", ""), givens)
        out["recomputed"] = val
        out["arithmetic_ok"] = isinstance(ex.get("value"), (int, float)) and _close(val, float(ex["value"]), 2e-3)
    except Exception as exc:  # noqa: BLE001
        out["recomputed"] = None
        out["arithmetic_ok"] = False
        out["error"] = str(exc)[:200]
    out["independent_ok"] = (blind_value is not None and out.get("recomputed") is not None
                             and _close(float(out["recomputed"]), float(blind_value), 1e-2))
    return out


# ── the three model steps ───────────────────────────────────────────────────────────────────────────────────────
NOTE_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["title", "use_when", "explanation", "key_equations", "steps", "mistakes", "limits", "worked_example",
                 "claims", "pages_used", "notation"],
    "properties": {
        "title": {"type": "string"},
        "use_when": {"type": "string"},
        "explanation": {"type": "string", "description": "Markdown with $...$ math; at most ~220 words."},
        "key_equations": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["latex", "meaning"],
                                                      "properties": {"latex": {"type": "string"}, "meaning": {"type": "string"}}}},
        "steps": {"type": "array", "items": {"type": "string"}},
        "mistakes": {"type": "array", "items": {"type": "string"}},
        "limits": {"type": "array", "items": {"type": "string"}, "description": "Unit and limiting-case checks of the key results."},
        "worked_example": {"type": "object", "additionalProperties": False,
                           "required": ["problem", "givens", "find", "expression", "value", "unit", "solution"],
                           "properties": {"problem": {"type": "string"},
                                          "givens": {"type": "array", "items": {"type": "object", "additionalProperties": False,
                                                                               "required": ["name", "value", "unit"],
                                                                               "properties": {"name": {"type": "string"}, "value": {"type": "number"},
                                                                                              "unit": {"type": "string"}}}},
                                          "find": {"type": "string"},
                                          "expression": {"type": "string", "description": "Python arithmetic in the given names."},
                                          "value": {"type": "number"}, "unit": {"type": "string"}, "solution": {"type": "string"}}},
        "claims": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["id", "question", "answer"],
                                              "properties": {"id": {"type": "string"}, "question": {"type": "string"}, "answer": {"type": "string"}}}},
        "pages_used": {"type": "array", "items": {"type": "integer"}},
        "notation": {"type": "string", "description": "Morin's symbols used and their meaning."}}}

BLIND_SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["answers", "example"],
    "properties": {
        "answers": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["id", "answer", "derivation"],
                                               "properties": {"id": {"type": "string"}, "answer": {"type": "string"}, "derivation": {"type": "string"}}}},
        "example": {"type": "object", "additionalProperties": False, "required": ["value", "unit", "method"],
                    "properties": {"value": {"type": "number"}, "unit": {"type": "string"}, "method": {"type": "string"}}}}}

REVIEW_SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["claims", "issues", "verdict", "summary"],
    "properties": {
        "claims": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["id", "agrees", "correct", "comment"],
                                              "properties": {"id": {"type": "string"}, "agrees": {"type": "boolean"}, "correct": {"type": "boolean"},
                                                             "comment": {"type": "string"}}}},
        "issues": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["severity", "text"],
                                              "properties": {"severity": {"type": "string", "enum": ["error", "warning"]}, "text": {"type": "string"}}}},
        "verdict": {"type": "string", "enum": ["confirm", "fix", "reject"]},
        "summary": {"type": "string"}}}

WRITER_SYSTEM = """You write one study note for one skill from David Morin's "Introduction to Classical Mechanics". The attached
images are the relevant pages of the book; they are the source of truth, and you must use Morin's notation and sign
conventions. A student who is refreshing forgotten material will read it in about five minutes, and a fast tutor
model will answer the student's questions using ONLY this note, so every formula must be exactly right and complete
enough to answer common questions about the skill.

Rules:
- Be exact. No result may appear that does not follow from the pages or from standard physics you can derive.
- Keep the explanation short (at most about 220 words) and concrete; math in $...$ LaTeX.
- claims: 3 to 6 key results of this skill, each posed as a question whose answer is a formula or short statement
  (a reviewer will derive the answers independently without seeing yours, so questions must be self-contained and
  must not reveal the answer).
- worked_example: one short numeric example in SI units. givens are named numbers; expression is plain Python
  arithmetic using only those names, numbers, + - * / **, sqrt, sin, cos, tan, pi (angles in radians); value is its
  numeric result.
- limits: checks of units and of limiting cases for the key results.
- pages_used: the book page numbers (as printed in the book) you relied on.
Reply with the JSON object only."""

BLIND_SYSTEM = """You are an independent physics checker for study notes based on David Morin's "Introduction to Classical Mechanics".
The attached images are pages of that book. Answer each question from the pages and your own derivation, using
Morin's notation. Do not assume any particular answer is expected; derive it. Then solve the numeric example from the
givens (SI units) and report the numeric value. Reply with the JSON object only."""

REVIEW_SYSTEM = """You are the final checker for a study note based on David Morin's "Introduction to Classical Mechanics" (pages
attached). You already answered the note's claim questions independently; your committed answers are included. Now:
- For each claim, say whether the note's answer agrees with yours (equivalent forms count) and whether it is correct.
- Check every formula in the note against the book pages and Morin's notation, and check units and limiting cases.
- Flag anything wrong, misleading, or missing that a student asking questions about this skill would need.
Verdict: "confirm" only if everything is correct and nothing is misleading; "fix" if there are specific fixable
errors (say exactly what); "reject" if the note is fundamentally wrong. Reply with the JSON object only."""


def _skill_brief(skill_id: str) -> str:
    cur = curriculum.load()
    sk = cur["skills"][skill_id]
    sec = cur["sections"][sk["section"]]
    pre = "; ".join(cur["skills"][p["id"]]["title"] for p in sk["prereqs"]) or "none"
    return (f"Skill: {sk['title']}\nWhat the student must be able to do: {sk['task']}\n"
            f"Book section: {sec['id']} {sec['title']} (starts on book page {sec['page']}).\nPrerequisites: {pre}")


def _call(model: str, effort: str, system: str, prompt: str, images: list[str], schema: dict, timeout: int = 900) -> tuple[dict, dict]:
    from . import model_choices
    text, meta = model_choices.run(model_choices.current("notes"), prompt, images=images,
                                  schema_text=json.dumps(schema), timeout=timeout, system=system)
    try:
        return providers.extract_json(text), meta
    except Exception as exc:  # noqa: BLE001
        raise NoteError(f"{model} returned no readable JSON: {exc}") from exc


def _meta_brief(meta: dict) -> dict:
    return {k: meta.get(k) for k in ("model", "label", "effort", "secs", "cost_usd_list") if k in meta}


def write(skill_id: str, images: list[str], pages: list[int], fix_issues: list[str] | None = None,
          previous: dict | None = None) -> tuple[dict, dict]:
    prompt = _skill_brief(skill_id) + f"\nAttached: book pages {', '.join(map(str, pages))}."
    if previous and fix_issues:
        prompt += ("\n\nA checker found these problems in the previous draft (shown below). Fix them all and return the "
                   "whole corrected note:\n- " + "\n- ".join(fix_issues) + "\n\nPrevious draft:\n" + json.dumps(previous)[:12000])
    return _call(WRITER_MODEL, WRITER_EFFORT, WRITER_SYSTEM, prompt, images, NOTE_SCHEMA)


def blind(skill_id: str, body: dict, images: list[str]) -> tuple[dict, dict]:
    ex = body.get("worked_example") or {}
    qs = "\n".join(f"{c['id']}: {c['question']}" for c in body.get("claims", []))
    givens = ", ".join(f"{g['name']} = {g['value']} {g['unit']}" for g in ex.get("givens", []))
    prompt = (_skill_brief(skill_id) + "\n\nQuestions:\n" + qs + "\n\nNumeric example: " + str(ex.get("problem", "")) +
              f"\nGivens: {givens}\nFind: {ex.get('find', '')} (give the value in {ex.get('unit', 'SI units')}).")
    return _call(REVIEWER_MODEL, REVIEWER_EFFORT, BLIND_SYSTEM, prompt, images, BLIND_SCHEMA)


def compare(skill_id: str, body: dict, blind_out: dict, images: list[str]) -> tuple[dict, dict]:
    prompt = (_skill_brief(skill_id) + "\n\nYour committed independent answers:\n" + json.dumps(blind_out)[:8000] +
              "\n\nThe note to check:\n" + json.dumps(body)[:16000])
    return _call(REVIEWER_MODEL, REVIEWER_EFFORT, REVIEW_SYSTEM, prompt, images, REVIEW_SCHEMA)


def _body_ok(body: dict) -> list[str]:
    errs = []
    if not body.get("claims"):
        errs.append("the note has no claims to check")
    ex = body.get("worked_example") or {}
    if not ex.get("givens") or not ex.get("expression"):
        errs.append("the worked example needs givens and an expression")
    return errs


# ── store ───────────────────────────────────────────────────────────────────────────────────────────────────────
def _row(r) -> dict:
    d = dict(r)
    for k in ("body", "sources", "writer", "review", "checks"):
        d[k] = json.loads(d[k]) if d.get(k) else None
    return d


def latest(conn, skill_id: str, *, confirmed_only: bool = True) -> dict | None:
    q = "SELECT * FROM notes WHERE skill_id=?" + (" AND status='confirmed'" if confirmed_only else "") + " ORDER BY version DESC LIMIT 1"
    conn.row_factory = sqlite3.Row
    r = conn.execute(q, (skill_id,)).fetchone()
    return _row(r) if r else None


def confirmed_map(conn) -> dict[str, dict]:
    conn.row_factory = sqlite3.Row
    out = {}
    for r in conn.execute("SELECT * FROM notes WHERE status='confirmed' ORDER BY skill_id, version"):
        out[r["skill_id"]] = _row(r)
    return out


def _next_version(conn, skill_id: str) -> int:
    return (conn.execute("SELECT MAX(version) FROM notes WHERE skill_id=?", (skill_id,)).fetchone()[0] or 0) + 1


def save(conn, skill_id: str, status: str, body: dict, sources: dict, writer: dict, review: dict | None, checks: dict | None,
         now: float | None = None) -> int:
    now = now or time.time()
    v = _next_version(conn, skill_id)
    conn.execute("INSERT INTO notes(skill_id, version, status, body, sources, writer, review, checks, created_ts, updated_ts, confirmed_ts)"
                 " VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                 (skill_id, v, status, json.dumps(body), json.dumps(sources), json.dumps(writer), json.dumps(review) if review else None,
                  json.dumps(checks) if checks else None, now, now, now if status == "confirmed" else None))
    return v


def revoke(conn, skill_id: str, version: int, reason: str) -> int:
    """Take a note version out of use. Quick answers that cited it are flagged too."""
    n = conn.execute("UPDATE notes SET status='revoked', revoked_reason=?, updated_ts=? WHERE skill_id=? AND version=?",
                     (reason[:500], time.time(), skill_id, version)).rowcount
    tag = f"note:{skill_id}@{version}"
    for mid, meta in conn.execute("SELECT id, meta FROM messages WHERE meta LIKE ?", (f"%{tag}%",)).fetchall():
        m = json.loads(meta or "{}")
        m["revoked_sources"] = sorted(set(m.get("revoked_sources", []) + [tag]))
        conn.execute("UPDATE messages SET meta=? WHERE id=?", (json.dumps(m), mid))
    return n


# ── the pipeline (a tasks.py handler) ───────────────────────────────────────────────────────────────────────────
def generate(db_path: Path, skill_id: str, progress=lambda m: None, work_dir: Path | None = None) -> dict:
    if skill_id not in curriculum.load()["skills"]:
        raise NoteError(f"unknown skill {skill_id}")
    pages = select_pages(skill_id)
    images = render(pages, (work_dir or Path(tempfile.gettempdir()) / "kinema-pages"))
    sources = {"book": curriculum.load()["book"].get("title"), "edition": curriculum.load()["book"].get("publisher"),
               "pages_sent": pages, "curriculum": curriculum.load()["version"]}
    history = []
    body, wmeta = None, {}
    issues: list[str] = []
    for round_no in (1, 2):
        progress(f"round {round_no}: Opus is writing the note")
        body, wmeta = write(skill_id, images, pages, fix_issues=issues if round_no == 2 else None, previous=body)
        problems = _body_ok(body)
        if problems:
            issues = problems
            history.append({"round": round_no, "structural": problems})
            continue
        progress(f"round {round_no}: Fable is answering the claims blind")
        blind_out, bmeta = blind(skill_id, body, images)
        checks = recompute(body, (blind_out.get("example") or {}).get("value"))
        progress(f"round {round_no}: Fable is comparing")
        review, rmeta = compare(skill_id, body, blind_out, images)
        review_rec = {"blind": blind_out, "compare": review, "reviewer": _meta_brief(bmeta) | {"compare": _meta_brief(rmeta)}}
        errors = [i["text"] for i in review.get("issues", []) if i.get("severity") == "error"]
        claim_bad = [f"claim {c['id']}: {c['comment']}" for c in review.get("claims", []) if not (c.get("agrees") and c.get("correct"))]
        numeric = []
        if not checks.get("arithmetic_ok"):
            numeric.append(f"worked example: the expression gives {checks.get('recomputed')} but the note states {checks.get('stated')}")
        if not checks.get("independent_ok"):
            numeric.append(f"worked example: an independent solution gives {checks.get('blind')}, the note's expression gives {checks.get('recomputed')}")
        warns = [i["text"] for i in review.get("issues", []) if i.get("severity") == "warning"]
        history.append({"round": round_no, "verdict": review.get("verdict"), "errors": errors, "claims": claim_bad, "numeric": numeric,
                        "warnings": warns})
        if review.get("verdict") == "confirm" and not errors and not claim_bad and not numeric:
            conn = sqlite3.connect(db_path, timeout=30)
            try:
                ensure_tables(conn)
                v = save(conn, skill_id, "confirmed", body, sources, _meta_brief(wmeta) | {"rounds": round_no},
                         review_rec | {"history": history}, checks)
                conn.commit()
            finally:
                conn.close()
            return {"skill_id": skill_id, "status": "confirmed", "version": v, "rounds": round_no}
        issues = errors + claim_bad + numeric + warns
        if review.get("verdict") == "reject":
            break
    conn = sqlite3.connect(db_path, timeout=30)
    try:
        ensure_tables(conn)
        v = save(conn, skill_id, "rejected", body or {}, sources, _meta_brief(wmeta), {"history": history}, None)
        conn.commit()
    finally:
        conn.close()
    err = NoteError(f"note for {skill_id} was not confirmed: " + "; ".join((issues or ["no verdict"])[:4])[:600])
    err.retryable = False
    raise err


# ── shipping confirmed notes with the app ───────────────────────────────────────────────────────────────────────
def export_pack(conn, skill_ids: list[str] | None = None, out_dir: Path = PACK_DIR) -> list[str]:
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for sid, n in confirmed_map(conn).items():
        if skill_ids and sid not in skill_ids:
            continue
        rec = {k: n[k] for k in ("skill_id", "version", "status", "body", "sources", "writer", "review", "checks", "confirmed_ts")}
        (out_dir / f"{sid}.v{n['version']}.json").write_text(json.dumps(rec, ensure_ascii=False, indent=1), encoding="utf-8")
        written.append(sid)
    return written


def import_pack(conn, pack_dir: Path = PACK_DIR) -> int:
    """Add shipped confirmed notes that this database doesn't have yet (matched by skill and body)."""
    if not pack_dir.is_dir():
        return 0
    added = 0
    for f in sorted(pack_dir.glob("*.json")):
        rec = json.loads(f.read_text(encoding="utf-8"))
        sid = rec.get("skill_id")
        if rec.get("status") != "confirmed" or sid not in curriculum.load()["skills"]:
            continue
        same = conn.execute("SELECT 1 FROM notes WHERE skill_id=? AND body=?", (sid, json.dumps(rec["body"]))).fetchone()
        if same:
            continue
        save(conn, sid, "confirmed", rec["body"], rec.get("sources") or {}, (rec.get("writer") or {}) | {"pack": f.name},
             rec.get("review"), rec.get("checks"), now=rec.get("confirmed_ts") or time.time())
        added += 1
    return added
