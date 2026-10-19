"""Course packs, owner-approved teaching profile, whitelisted study sources and safe uploads for the teacher.

Only sources named in app/content/study_courses.json (by id) and the learner's own uploads can be read. Paths never
leave the server: every source is addressed by id (+ page) and every reply source is re-checked against what was
actually read for that turn. Uploaded text is reference data for the tutor, never instructions.
"""
from __future__ import annotations

import atexit
import hashlib
import json
import re
import time
import uuid
from functools import lru_cache
from pathlib import Path

from . import curriculum, notes

ROOT = Path(__file__).resolve().parents[1]
CONTENT = Path(__file__).resolve().parent / "content"
PATH_OVERRIDES: dict[str, Path] = {}       # tests point whitelisted ids at fixtures; never used for arbitrary paths
PAGE_TEXT_LIMIT = 6000
ATTACH_TEXT_LIMIT = 20000
MAX_UPLOAD = 20_000_000
MAX_FILES = 6
IMAGE_EXT = {".png": b"\x89PNG", ".jpg": b"\xff\xd8", ".jpeg": b"\xff\xd8", ".gif": b"GIF8", ".webp": b"RIFF"}
TEXT_EXT = {".txt", ".md"}
_pdf_cache: dict[tuple, object] = {}
_search_cache: dict[tuple, list[str]] = {}


class SourceError(ValueError):
    pass


# ── course packs and profile ──────────────────────────────────────────────────────────────────────────────────────
@lru_cache(maxsize=1)
def _courses_raw() -> dict:
    return json.loads((CONTENT / "study_courses.json").read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def profile() -> dict:
    return json.loads((CONTENT / "learning_profile.json").read_text(encoding="utf-8"))


def courses() -> list[dict]:
    return _courses_raw()["courses"]


def course(course_id: str) -> dict:
    c = next((c for c in courses() if c["id"] == course_id), None)
    if not c:
        raise SourceError("Choose one of your courses.")
    return c


def course_public(c: dict) -> dict:
    """What the browser may see: no file paths or saved-app ids."""
    out = {k: c.get(k) for k in ("id", "title", "goal", "next_step")}
    exam = c.get("exam") or {}
    out["exam"] = {k: exam.get(k) for k in ("at", "scope")} if exam else None
    out["has_cards"] = bool(c.get("cards"))
    return out


def course_context(c: dict, now: float | None = None) -> dict:
    """Compact course pack for the tutor. Past exams stay history, never 'tomorrow'."""
    now = now or time.time()
    exam = dict(c.get("exam") or {})
    if exam.get("at"):
        try:
            from datetime import datetime
            when = datetime.fromisoformat(exam["at"]).timestamp()
            exam["status"] = "past" if when < now else f"in {max(0.0, (when - now) / 86400):.1f} days"
        except ValueError:
            exam["status"] = "unknown"
    out = {"id": c["id"], "title": c["title"], "goal": c.get("goal"), "exam": exam or None,
           "suggested_next_step": c.get("next_step"), "homework_scope": c.get("homework_scope") or [],
           "prior_assessment_topics": c.get("prior_assessment_topics") or [], "date_policy": _courses_raw().get("date_policy")}
    out["study_plan"] = c.get("study_plan") or ""
    if c.get("materials_note"):
        out["materials_note"] = c["materials_note"]
    if _book_ref(c):
        out["book_sections"] = book_sections(c)
    return out


def _role(ref: dict) -> str:
    """book (printed page numbers), assessment (quiz/homework scans or papers) or notes."""
    if ref.get("kind") == "json":
        return "notes"
    return ref.get("role") or ("book" if ref.get("kind") == "pdf" else "assessment")


def _book_ref(c: dict) -> dict | None:
    return next((r for r in c.get("material_refs") or [] if r.get("kind") == "pdf" and _role(r) == "book"), None)


def _json_ref(c: dict) -> dict | None:
    return next((r for r in c.get("material_refs") or [] if r.get("kind") == "json"), None)


def _chapters_in_scope(c: dict) -> list[int]:
    # Ongoing learning scope is independent of a historical exam's coverage.
    explicit = c.get("learning_chapters")
    if isinstance(explicit, list) and explicit:
        known = {ch["n"] for ch in curriculum.load()["chapters"] if isinstance(ch["n"], int)}
        if all(isinstance(n, int) and not isinstance(n, bool) and n in known for n in explicit):
            return sorted(set(explicit))
    scope = " ".join([(c.get("exam") or {}).get("scope") or "", *(c.get("homework_scope") or [])])
    nums = {int(m) for m in re.findall(r"\b(?:[Cc]hapters?|ch\.?|HW\d+:)?\s*(\d{1,2})\.\d+", scope)}
    nums |= {int(m) for m in re.findall(r"[Cc]hapters?\s+(\d{1,2})", scope)}
    nums |= {int(m) for m in re.findall(r"through chapter\s+(\d{1,2})", scope)}
    if nums:
        lo, hi = min(nums), max(nums)
        return list(range(lo, hi + 1))
    return []


def book_sections(c: dict) -> list[dict]:
    want = set(_chapters_in_scope(c))
    out = []
    for ch in curriculum.load()["chapters"]:
        if ch["n"] in want:
            out.append({"chapter": ch["n"], "title": ch["title"], "page": ch.get("page"), "problems_page": ch.get("problems_page"),
                        "sections": [{"id": s.get("id"), "title": s.get("title"), "page": s.get("page")} for s in ch.get("sections", [])]})
    return out


def course_skills(c: dict) -> list[dict]:
    """Curriculum skills the tutor may cite for this course (2301 → Morin chapters in scope)."""
    want = set(_chapters_in_scope(c)) if _book_ref(c) else set()
    if not want:
        return []
    return [{"id": sid, "title": s["title"]} for sid, s in curriculum.load()["skills"].items() if s.get("chapter") in want]


# ── whitelisted materials ─────────────────────────────────────────────────────────────────────────────────────────
def _ref_path(ref: dict) -> Path:
    if ref["id"] in PATH_OVERRIDES:
        return PATH_OVERRIDES[ref["id"]]
    p = Path(ref["path"])
    return p if p.is_absolute() else ROOT / p


# A document is a private pages manifest beside its original scans:
# {version, title, caution, provenance, pages:[{page, text (verified printed text), image (file name in that folder)}]}.
def _manifest(ref: dict) -> dict:
    path = _ref_path(ref)
    if not path.is_file():
        raise SourceError("That material is not available on this computer.")
    try:
        m = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise SourceError("That material could not be read.") from exc
    pages = m.get("pages") if isinstance(m, dict) else None
    if not isinstance(pages, list) or not pages or [p.get("page") if isinstance(p, dict) else None for p in pages] != list(range(1, len(pages) + 1)):
        raise SourceError("That material could not be read.")
    return m


def _doc_page(ref: dict, page) -> dict:
    pages = _manifest(ref)["pages"]
    if not isinstance(page, int) or isinstance(page, bool) or not 1 <= page <= len(pages):
        raise SourceError(f"Choose a scan page from 1 to {len(pages)}.")
    return pages[page - 1]


def _doc_image(ref: dict, entry: dict) -> Path | None:
    """The page's original image, only as a plain file name inside the manifest's own folder."""
    name = str(entry.get("image") or "")
    if not name:
        return None
    folder = _ref_path(ref).parent.resolve()
    p = (folder / name).resolve()
    if Path(name).name != name or p.parent != folder or p.suffix.lower() not in IMAGE_EXT or not p.is_file():
        raise SourceError("That page's image is not available on this computer.")
    return p


def available(ref: dict) -> bool:
    if ref.get("kind") == "document":
        try:
            return all(_doc_image(ref, e) is not None or e.get("text") for e in _manifest(ref)["pages"])
        except SourceError:
            return False
    return _ref_path(ref).is_file()


def page_count(ref: dict) -> int | None:
    """Pages a reader may ask for (document scan pages, PDF pages or note modules); None when it is missing."""
    try:
        if ref.get("kind") == "document":
            return len(_manifest(ref)["pages"])
        if not _ref_path(ref).is_file():
            return None
        if ref.get("kind") == "json":
            return len(_lessons(ref))
        with notes._pdf_lock:
            return len(_pdf(_ref_path(ref)))
    except SourceError:
        return None


def _ref(c: dict, source_id: str) -> dict:
    ref = next((r for r in c.get("material_refs") or [] if r["id"] == source_id), None)
    if not ref:
        raise SourceError("That source is not part of this course.")
    return ref


def source_identity(path: Path) -> tuple:
    """Identity of the actual source, not just a course id or page number.

    Stat before every cache lookup: a missing/replaced source must never silently
    reuse an earlier fixture or an older edition's rendered pages.
    """
    path = Path(path).resolve()
    try:
        st = path.stat()
        if not path.is_file():
            raise OSError("not a file")
    except OSError as exc:
        raise SourceError("That material is not available on this computer.") from exc
    return str(path), st.st_size, st.st_mtime_ns, st.st_ctime_ns


def source_revision(ref: dict) -> str:
    identity = [source_identity(_ref_path(ref)), _role(ref), ref.get("pdf_page_offset", 0)]
    return hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()[:20]


def _pdf(path: Path):
    import pypdfium2 as pdfium
    key = source_identity(path)
    if key not in _pdf_cache:
        if not _pdf_cache:
            # Registered after pypdfium2's own exit hook so it runs first and closes the cached books cleanly.
            atexit.register(_close_pdfs)
        for stale in [k for k in _pdf_cache if k[0] == key[0]]:
            _pdf_cache.pop(stale).close()
        _pdf_cache[key] = pdfium.PdfDocument(key[0])
    return _pdf_cache[key]


def _close_pdfs() -> None:
    for doc in _pdf_cache.values():
        doc.close()
    _pdf_cache.clear()


def _page_text(doc, idx: int) -> str:
    """Text of one page; the page and text-page handles are closed at once (callers hold notes._pdf_lock)."""
    page = doc[idx]
    try:
        tp = page.get_textpage()
        try:
            return tp.get_text_range()
        finally:
            tp.close()
    finally:
        page.close()


def _page_png(doc, idx: int, path: Path) -> None:
    page = doc[idx]
    try:
        bitmap = page.render(scale=notes.RENDER_SCALE)
        try:
            bitmap.to_pil().save(path)
        finally:
            bitmap.close()
    finally:
        page.close()


def _book_index(ref: dict, page: int) -> int:
    """PDF index: printed page + offset for the book; for any other PDF the page is its own 1-based PDF page."""
    book = _role(ref) == "book"
    if not isinstance(page, int) or isinstance(page, bool) or page < 1:
        raise SourceError("Choose a book page number." if book else "Choose a page number.")
    idx = page + (int(ref.get("pdf_page_offset") or 0) if book else 0) - 1
    with notes._pdf_lock:
        total = len(_pdf(_ref_path(ref)))
    if not 0 <= idx < total:
        raise SourceError("That page is outside the book." if book else f"That page is outside this file (pages 1-{total}).")
    return idx


def _lessons(ref: dict) -> list[dict]:
    return json.loads(_ref_path(ref).read_text(encoding="utf-8"))["lessons"]


def source_url(source_id: str, page: int | None, course_id: str) -> str:
    return f"/api/teacher/sources/{source_id}?course_id={course_id}" + (f"&page={page}" if page is not None else "")


def _kind_label(ref: dict) -> str:
    if ref.get("kind") == "json":
        return "notes"
    if ref.get("kind") == "document":
        return "document"
    return "book" if _role(ref) == "book" else "pdf"


PAGE_MEANING = {
    "book": "printed book page number (the numbers in course.book_sections); or page null with a query",
    "pdf": "page number within this file, 1 to pages (not a book page); or page null with a query",
    "document": "scan page number, 1 to pages; or page null with a query",
    "notes": "module number (NOTES.modules); or page null with a query",
}


def _doc_meta(ref: dict) -> dict:
    """Caution and provenance of a document manifest; {} when it cannot be read."""
    try:
        m = _manifest(ref)
    except SourceError:
        return {}
    return {k: str(m.get(k))[:400] for k in ("caution", "provenance") if m.get(k)}


def source_catalog(c: dict) -> list[dict]:
    """Every whitelisted course source the teacher may read: exact id, title, kind, role, whether it is on this
    computer, page count and what 'page' means. No paths."""
    out = []
    for ref in c.get("material_refs") or []:
        kind = _kind_label(ref)
        item = {"id": ref["id"], "title": ref["title"], "kind": kind, "role": _role(ref), "available": available(ref),
                "page": PAGE_MEANING[kind]}
        if kind in ("pdf", "document"):
            item["pages"] = page_count(ref)
        if ref.get("description"):
            item["description"] = str(ref["description"])[:300]
        if kind == "document":
            item.update(_doc_meta(ref))
        out.append(item)
    return out


def materials(c: dict, attachments: list[dict]) -> list[dict]:
    out = []
    for ref in c.get("material_refs") or []:
        kind = _kind_label(ref)
        out.append({"id": ref["id"], "title": ref["title"], "kind": kind, "role": _role(ref),
                    "pages": page_count(ref) if kind in ("pdf", "document") else None,
                    "description": str(ref.get("description") or "")[:300], "url": source_url(ref["id"], None, c["id"])})
    for a in attachments:
        out.append({"id": a["id"], "title": a["name"], "kind": a["kind"], "url": attachment_url(a["id"]),
                    "created_ts": a.get("created_ts"), "size": a.get("size"), "material_type": a.get("material_type"), "uploaded": True})
    return out


def read_source(c: dict, source_id: str, page: int | None, *, render: Path | None = None) -> dict:
    """{id,title,kind,page,text,image?} from a whitelisted course source. image is a server-side render path."""
    ref = _ref(c, source_id)
    kind = _kind_label(ref)
    if kind == "document":
        if page is None:
            return {"id": ref["id"], "title": ref["title"], "kind": kind, "page": None, "text": "", "pages": page_count(ref), **_doc_meta(ref)}
        entry = _doc_page(ref, page)
        img = _doc_image(ref, entry)
        # The verified printed text is the question; a scan may also show a student's attempt, which is not a key.
        out = {"id": ref["id"], "title": f"{ref['title']}, scan page {page}", "kind": kind, "page": page,
               "text": str(entry.get("text") or "")[:PAGE_TEXT_LIMIT], **_doc_meta(ref)}
        if img is not None:
            out["image_url"] = f"/api/teacher/sources/{ref['id']}/pages/{page}.png?course_id={c['id']}"
            if render is not None:
                out["image"] = str(img)
        return out
    if ref.get("kind") == "pdf":
        if page is None:
            if kind == "book":
                return {"id": ref["id"], "title": ref["title"], "kind": "book", "page": None, "text": "",
                        "sections": book_sections(c)}
            return {"id": ref["id"], "title": ref["title"], "kind": kind, "page": None, "text": "", "pages": page_count(ref)}
        idx = _book_index(ref, page)
        with notes._pdf_lock:
            text = _page_text(_pdf(_ref_path(ref)), idx)
        out = {"id": ref["id"], "title": f"{ref['title']} p. {page}", "kind": kind, "page": page,
               "text": text[:PAGE_TEXT_LIMIT], "image_url": f"/api/teacher/sources/{ref['id']}/pages/{page}.png?course_id={c['id']}&v={source_revision(ref)}"}
        if render is not None:
            out["image"] = str(render_page(c, source_id, page, render))
        return out
    lessons = _lessons(ref)
    if page is None:
        return {"id": ref["id"], "title": ref["title"], "kind": "notes", "page": None, "text": "",
                "modules": [{"page": i + 1, "title": l.get("title")} for i, l in enumerate(lessons)]}
    if not isinstance(page, int) or isinstance(page, bool) or not 1 <= page <= len(lessons):
        raise SourceError("No such module in these notes.")
    l = lessons[page - 1]
    body = "\n\n".join(f"{s.get('h', '')}\n{s.get('body', '')}\nKey: {s.get('key', '')}" for s in l.get("sections") or [])
    return {"id": ref["id"], "title": f"{ref['title']}: module {l.get('module', page)} {l.get('title', '')}".strip(), "kind": "notes",
            "page": page, "text": (l.get("intro", "") + "\n\n" + body)[:PAGE_TEXT_LIMIT]}


def render_page(c: dict, source_id: str, page: int, out_dir: Path) -> Path:
    ref = _ref(c, source_id)
    if ref.get("kind") == "document":
        img = _doc_image(ref, _doc_page(ref, page))
        if img is None:
            raise SourceError("That page has no image.")
        return img                     # the original scan, served unchanged
    if ref.get("kind") != "pdf":
        raise SourceError("Only book pages have images.")
    idx = _book_index(ref, page)
    out_dir.mkdir(parents=True, exist_ok=True)
    p = out_dir / f"{re.sub(r'[^A-Za-z0-9_-]', '_', ref['id'])}-pdf{idx + 1}-{source_revision(ref)}.png"
    if not p.exists():
        with notes._pdf_lock:
            _page_png(_pdf(_ref_path(ref)), idx, p)
    return p


def _terms(text: str) -> set[str]:
    return {t for t in re.findall(r"\d+\.\d+|[a-z]{4,}", text.lower())}


def search(c: dict, source_id: str, query: str, k: int = 2) -> list[int]:
    """Best book pages (in course scope) or modules for a short query; plain term overlap, bounded."""
    ref = _ref(c, source_id)
    want = _terms(query)
    if not want:
        return []
    if ref.get("kind") == "document":
        entries = _manifest(ref)["pages"]
        pages = [e["page"] for e in entries]
        texts = [str(e.get("text") or "").lower() for e in entries]
    elif ref.get("kind") == "pdf" and _role(ref) != "book":
        n = page_count(ref) or 0
        pages = list(range(1, n + 1))
        key = (source_revision(ref), "file", n)
        if key not in _search_cache:
            with notes._pdf_lock:
                doc = _pdf(_ref_path(ref))
                _search_cache[key] = [_page_text(doc, i).lower() for i in range(n)]
        texts = _search_cache[key]
    elif ref.get("kind") == "pdf":
        numbered = sorted((ch for ch in curriculum.load()["chapters"] if isinstance(ch["n"], int)), key=lambda ch: ch["n"])
        ends = {a["n"]: b["page"] for a, b in zip(numbered, numbered[1:])}
        scope = set(_chapters_in_scope(c))
        pages = [p for ch in numbered if ch["n"] in scope for p in range(ch["page"], ends.get(ch["n"], ch["page"] + 40))]
        key = (source_revision(ref), tuple(pages[:1]), len(pages))
        if key not in _search_cache:
            texts = []
            for p in pages:
                try:
                    idx = _book_index(ref, p)
                except SourceError:
                    texts.append("")
                    continue
                with notes._pdf_lock:
                    texts.append(_page_text(_pdf(_ref_path(ref)), idx).lower())
            _search_cache[key] = texts
        texts = _search_cache[key]
    else:
        lessons = _lessons(ref)
        pages = list(range(1, len(lessons) + 1))
        texts = [json.dumps(l, ensure_ascii=False).lower() for l in lessons]
    scored = sorted(((sum(1 for t in want if t in txt), -i) for i, txt in enumerate(texts)), reverse=True)
    return [pages[-i] for s, i in scored[:k] if s > 0]


# ── uploads ───────────────────────────────────────────────────────────────────────────────────────────────────────
def ensure_tables(conn) -> None:
    conn.execute("""CREATE TABLE IF NOT EXISTS teacher_attachments(
        id TEXT PRIMARY KEY, course_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, file TEXT NOT NULL,
        size INTEGER NOT NULL, text TEXT, created_ts REAL NOT NULL)""")
    # Library > Materials uploads (quizzes, homework): the same stored attachment, marked with what it is.
    conn.execute("""CREATE TABLE IF NOT EXISTS teacher_material_uploads(
        attachment_id TEXT PRIMARY KEY, mtype TEXT NOT NULL, created_ts REAL NOT NULL)""")


MATERIAL_TYPES = ("quiz", "homework", "other")


def mark_material(conn, aid: str, mtype: str) -> str:
    mtype = mtype if mtype in MATERIAL_TYPES else "other"
    conn.execute("INSERT OR REPLACE INTO teacher_material_uploads VALUES(?,?,?)", (aid, mtype, time.time()))
    return mtype


def material_marks(conn) -> dict[str, str]:
    return dict(conn.execute("SELECT attachment_id, mtype FROM teacher_material_uploads").fetchall())


def attachment_url(aid: str) -> str:
    return f"/api/teacher/attachments/{aid}"


def _kind(name: str, raw: bytes) -> tuple[str, str]:
    ext = Path(name).suffix.lower()
    if ext in IMAGE_EXT and raw.startswith(IMAGE_EXT[ext]) and (ext != ".webp" or raw[8:12] == b"WEBP"):
        return "image", ext
    if ext == ".pdf" and raw.startswith(b"%PDF-"):
        return "pdf", ext
    if ext in TEXT_EXT:
        try:
            raw.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise SourceError(f"{name}: text files must be UTF-8.") from exc
        return "text", ext
    raise SourceError(f"{name}: attach an image (PNG, JPEG, GIF, WebP), a PDF or a text file.")


def _pdf_text(path: Path, pages: int = 10) -> str:
    import pypdfium2 as pdfium
    with notes._pdf_lock:
        doc = pdfium.PdfDocument(str(path))
        try:
            parts = [_page_text(doc, i) for i in range(min(pages, len(doc)))]
        finally:
            doc.close()
    return "\n\n".join(parts)[:ATTACH_TEXT_LIMIT]


def save_upload(conn, data_dir: Path, course_id: str, name: str, raw: bytes) -> dict:
    course(course_id)
    name = (Path(str(name or "file")).name or "file")[:120]
    if not raw:
        raise SourceError(f"{name}: the file is empty.")
    if len(raw) > MAX_UPLOAD:
        raise SourceError(f"{name}: files are limited to 20 MB.")
    kind, ext = _kind(name, raw)
    aid = "a" + uuid.uuid4().hex[:12]
    folder = data_dir / "uploads" / "teacher"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{aid}{ext}"
    path.write_bytes(raw)
    text = ""
    if kind == "text":
        text = raw.decode("utf-8")[:ATTACH_TEXT_LIMIT]
    elif kind == "pdf":
        try:
            text = _pdf_text(path)
        except Exception:  # noqa: BLE001 — an unreadable PDF is still stored; the tutor is told it has no text
            text = ""
    conn.execute("INSERT INTO teacher_attachments VALUES(?,?,?,?,?,?,?,?)",
                 (aid, course_id, name, kind, path.name, len(raw), text, time.time()))
    return {"id": aid, "name": name, "kind": kind, "url": attachment_url(aid)}


def attachment(conn, aid: str) -> dict | None:
    r = conn.execute("SELECT id, course_id, name, kind, file, size, text, created_ts FROM teacher_attachments WHERE id=?", (str(aid),)).fetchone()
    return dict(zip(("id", "course_id", "name", "kind", "file", "size", "text", "created_ts"), r)) if r else None


def attachments(conn, course_id: str) -> list[dict]:
    rows = conn.execute("SELECT id FROM teacher_attachments WHERE course_id=? ORDER BY created_ts", (course_id,)).fetchall()
    return [attachment(conn, r[0]) for r in rows]


def attachment_file(data_dir: Path, a: dict) -> Path:
    return data_dir / "uploads" / "teacher" / Path(a["file"]).name

