"""Book-grounded teaching scope for a chapter launch: ID-only references validated against the printed Morin map
(content/chapter_map.json), expanded for the tutor with the real outline, page bounds and a bounded source excerpt.
Concept sections only: Problems, Exercises and Solutions are never a launch scope; they stay reading pointers the tutor may use when asked. Nothing here
records progress or mastery."""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

_FILE = Path(__file__).parent / "content" / "chapter_map.json"
EXCERPT_CHARS = 3500
MAX_SECTIONS = 20


@lru_cache(maxsize=1)
def _book() -> dict:
    data = json.loads(_FILE.read_text(encoding="utf-8"))
    return {c["n"]: c for c in data["chapters"]}


def chapter(n) -> dict | None:
    return _book().get(n) if isinstance(n, int) and not isinstance(n, bool) else None


def concept_sections(ch: dict) -> list[dict]:
    return [s for s in ch["sections"] if s["kind"] == "concept"]


def subsections(sec: dict) -> list[dict]:
    return [t for t in sec.get("topics", []) if t["kind"] == "sub"]


def launch(n: int, section_ids: list[str] | None = None, topic_id: str | None = None) -> dict:
    """The exact study_context a launch control sends (section_ids omitted = every concept section)."""
    out: dict = {"kind": "chapter", "chapter": n}
    if section_ids:
        out["section_ids"] = list(section_ids)
    if topic_id:
        out["topic_id"] = topic_id
    return out


def canonical(raw) -> dict | None:
    """The validated reference, or None for anything that is not a real, teachable part of one Morin chapter.
    {kind, chapter, section_ids (explicit, book order), topic_id (str|None), label}; extra keys are dropped."""
    if not isinstance(raw, dict) or raw.get("kind") != "chapter":
        return None
    ch = chapter(raw.get("chapter"))
    if ch is None:
        return None
    teachable = {s["id"]: s for s in concept_sections(ch)}
    ids = raw.get("section_ids")
    topic_id = raw.get("topic_id")
    if topic_id is not None and not isinstance(topic_id, str):
        return None
    if ids is None:
        ids = [topic_id.rsplit(".", 1)[0]] if topic_id and topic_id.count(".") == 2 else list(teachable)
    if (not isinstance(ids, list) or not ids or len(ids) > MAX_SECTIONS
            or any(not isinstance(i, str) or i not in teachable for i in ids)):
        return None
    chosen = [s for s in concept_sections(ch) if s["id"] in set(ids)]
    topic = None
    if topic_id:
        topic = next((t for s in chosen for t in subsections(s) if t["id"] == topic_id), None)
        if topic is None:
            return None
    if topic:
        label = f'{topic["id"]} {topic["title"]}'
    elif len(chosen) == len(teachable) and len(teachable) > 1:
        label = f'Chapter {ch["n"]}: {ch["title"]}'
    else:
        label = " + ".join(f'{s["id"]} {s["title"]}' for s in chosen)
    return {"kind": "chapter", "chapter": ch["n"], "section_ids": [s["id"] for s in chosen],
            "topic_id": topic["id"] if topic else None, "label": label[:200]}


def _clean(topic: dict) -> dict:
    return {k: topic[k] for k in ("id", "title", "page", "end") if k in topic}


def outline(ref: dict) -> dict:
    """The full selected outline for the tutor: every selected section with its numbered subsections, named examples
    and printed page bounds, plus where the practice material lives (pointers only)."""
    ch = chapter(ref["chapter"])
    picked = set(ref["section_ids"])
    sections = []
    for s in concept_sections(ch):
        if s["id"] not in picked:
            continue
        subs = subsections(s)
        sections.append({"id": s["id"], "title": s["title"], "pages": [s["page"], s["end"]],
                         "subsections": [{"id": t["id"], "title": t["title"], "pages": [t["page"], t["end"]]} for t in subs],
                         "examples": [{"title": t["title"], "page": t["page"]} for t in s.get("topics", []) if t["kind"] == "example"],
                         "named_ideas": [{"title": t["title"], "page": t["page"]} for t in s.get("topics", []) if t["kind"] == "topic"]})
    return {"chapter": ch["n"], "chapter_title": ch["title"], "chapter_pages": [ch["page"], ch["end"]], "sections": sections,
            "practice_pointers": [{"id": s["id"], "title": s["title"], "pages": [s["page"], s["end"]]}
                                  for s in ch["sections"] if s["kind"] == "practice"]}


def first_page(ref: dict) -> tuple[int, int, str, str]:
    """(start page, last page allowed, heading id, heading title) of the selected topic, else of the first section."""
    ch = chapter(ref["chapter"])
    sec = next(s for s in concept_sections(ch) if s["id"] in set(ref["section_ids"]))
    if ref.get("topic_id"):
        for s in concept_sections(ch):
            for t in subsections(s):
                if t["id"] == ref["topic_id"]:
                    return t["page"], t["end"], t["id"], t["title"]
    return sec["page"], sec["end"], sec["id"], sec["title"]


def _heading_re(hid: str) -> str:
    return r"(?m)^[ 	]*" + re.escape(hid) + r"(?![\d.])[ 	]+[A-Z]"


def _later_headings(ref: dict) -> list[str]:
    """Heading ids after the selected start in book order. A topic stops at the next subsection or section; a section
    keeps its own subsections and stops at the next section."""
    ch = chapter(ref["chapter"])
    _, _, hid, _ = first_page(ref)
    flat = [x for s in ch["sections"] for x in [s["id"]] + [t["id"] for t in subsections(s)]]
    later = flat[flat.index(hid) + 1:]
    return later if hid.count(".") == 2 else [i for i in later if not i.startswith(hid + ".")]


def _plain(text: str, page: int) -> str:
    """Drops the book's running heads so they are not mistaken for headings."""
    keep = [ln for ln in text.replace("\r", "").split("\n")
            if not (ln.startswith("MORIN:") or re.match(rf"^{page} \S", ln.strip())
                    or re.match(rf"^\d{{1,2}}\.\d{{1,2}} .+ {page}$", ln.strip()))]
    return "\n".join(keep)


def excerpt(ref: dict, read_page) -> dict | None:
    """A bounded excerpt of the selected topic's (or first section's) opening printed pages. It starts at the selected
    heading (matched by number, so title cleaning cannot misplace it) and stops before the next genuine heading, so a
    neighbouring subsection on the same page is not taught as this one. read_page(page) returns the page text or raises;
    any failure leaves the tutor with the outline and the reading pointers only."""
    page, last, hid, title = first_page(ref)
    later = [(i, re.compile(_heading_re(i))) for i in _later_headings(ref)]
    parts, used, found, bound = [], [], False, None
    for p in range(page, min(last, page + 1) + 1):
        try:
            text = _plain(read_page(p), p)
        except Exception:
            break
        if p == page:
            m = re.search(_heading_re(hid), text)
            found = bool(m)
            if not m:
                return None  # keep source pointers; do not mislabel a preceding topic
            text = text[m.start():]
        hits = [(m.start(), i) for i, rx in later for m in [rx.search(text)] if m]
        if hits:
            cut, bound = min(hits)
            text = text[:cut]
        text = " ".join(text.split())
        if text:
            parts.append(text)
            used.append(p)
        if bound or sum(len(x) for x in parts) >= EXCERPT_CHARS:
            break
    if not parts:
        return None
    body = " ".join(parts)
    return {"from": f"{hid} {title}", "printed_pages": used, "text": body[:EXCERPT_CHARS], "truncated": len(body) > EXCERPT_CHARS,
            "heading_found": found, "stops_before": bound}
