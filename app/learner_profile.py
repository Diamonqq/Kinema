"""The learner's profile: display name, class (2300 / 2301 / other) and current Morin chapter, plus the Daily source.

Owner (2026-10-16): Kinema may go to a whole class, so the start can ask which class and chapter; both stay editable
in Settings > Profile. The chapter bounds the Daily pool (app/daily.py). The class -> chapters map lives in
content/class_courses.json and is marked unverified until a syllabus confirms 2300's range.
"""
from __future__ import annotations

import json
import re
import threading
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

CONTENT = Path(__file__).resolve().parent / "content"
router = APIRouter()
_lock = threading.Lock()
SOURCES = ("kinema", "feed")
DEFAULT = {"name": "", "course": "", "chapter": None, "asked": False, "daily_source": "kinema", "feed_url": ""}


@lru_cache(maxsize=1)
def classes() -> dict:
    return json.loads((CONTENT / "class_courses.json").read_text(encoding="utf-8"))


def class_of(cid: str) -> dict | None:
    return next((c for c in classes()["classes"] if c["id"] == cid), None)


@lru_cache(maxsize=1)
def chapter_titles() -> dict[int, str]:
    doc = json.loads((CONTENT / "chapter_map.json").read_text(encoding="utf-8"))
    return {int(c["n"]): c["title"] for c in doc["chapters"]}


def _path() -> Path:
    from .main import DATA
    return Path(DATA) / "profile.json"


def load() -> dict:
    try:
        d = json.loads(_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        d = {}
    out = dict(DEFAULT)
    if isinstance(d, dict):
        try:
            out.update(clean(d, base=out))
        except ValueError:
            pass      # a hand-edited bad file reads as the defaults rather than breaking every page
    return out


def clean(patch: dict, base: dict | None = None) -> dict:
    """Validate a partial profile; raises ValueError with a plain message."""
    if not isinstance(patch, dict):
        raise ValueError("Send the profile as an object.")
    cur = dict(base or load())
    out: dict = {}
    if "name" in patch:
        name = re.sub(r"\s+", " ", str(patch["name"] or "")).strip()
        if len(name) > 40:
            raise ValueError("Keep the name under 40 characters.")
        out["name"] = name
    if "course" in patch:
        cid = str(patch["course"] or "")
        if cid and not class_of(cid):
            raise ValueError("Choose 2300, 2301 or another class.")
        out["course"] = cid
    course = out.get("course", cur.get("course", ""))
    if "chapter" in patch or "course" in patch:
        ch = patch.get("chapter", cur.get("chapter") if "course" not in patch or course == cur.get("course") else None)
        if ch in (None, ""):
            out["chapter"] = None
        else:
            try:
                ch = int(ch)
            except (TypeError, ValueError):
                raise ValueError("Choose a chapter number.") from None
            allowed = class_of(course)["chapters"] if course else list(chapter_titles())
            if ch not in allowed:
                raise ValueError(f"Chapter {ch} is not part of this class.")
            out["chapter"] = ch
    if "asked" in patch:
        out["asked"] = bool(patch["asked"])
    if "daily_source" in patch:
        src = str(patch["daily_source"] or "kinema")
        if src not in SOURCES:
            raise ValueError("Choose Kinema or a class feed.")
        out["daily_source"] = src
    if "feed_url" in patch:
        url = str(patch["feed_url"] or "").strip()
        if len(url) > 500:
            raise ValueError("That feed address is too long.")
        if url:
            parts = urlsplit(url)
            if parts.scheme not in ("https", "http") or not parts.hostname:
                raise ValueError("Use a full feed address starting with https://.")
        out["feed_url"] = url
    return out


def save(patch: dict) -> dict:
    with _lock:
        cur = load()
        cur.update(clean(patch, base=cur))
        if cur["daily_source"] == "feed" and not cur["feed_url"]:
            raise ValueError("Add the class feed address first.")
        p = _path()
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(cur, ensure_ascii=False), encoding="utf-8")
        tmp.replace(p)
        return cur


def payload() -> dict:
    from . import daily_feed
    titles = chapter_titles()
    cfg = classes()
    return {"profile": load(), "verified": bool(cfg.get("verified")),
            "classes": [{**c, "chapters": [{"n": n, "title": titles.get(n, f"Chapter {n}")} for n in c["chapters"]]} for c in cfg["classes"]],
            "feed": daily_feed.status()}


def _guard(request: Request) -> None:
    from .provider_connections import guard
    guard(request, mutate=True)


@router.get("/api/profile")
def api_profile():
    return JSONResponse(payload(), headers={"Cache-Control": "no-store"})


@router.post("/api/profile")
async def api_profile_save(request: Request):
    _guard(request)
    try:
        body = await request.json()
    except ValueError:
        raise HTTPException(400, "Send a valid profile.") from None
    before = load()
    try:
        after = save(body)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    from . import daily, daily_feed
    if any(before[k] != after[k] for k in ("course", "chapter", "daily_source", "feed_url")):
        daily.repick_if_untouched()
        if after["daily_source"] == "feed":
            daily_feed.refresh_async(after["feed_url"])
    return payload()


@router.post("/api/profile/feed/refresh")
def api_feed_refresh(request: Request):
    from . import daily_feed
    from .provider_connections import guard
    guard(request)
    prof = load()
    if prof["daily_source"] != "feed" or not prof["feed_url"]:
        return JSONResponse({"error": "Choose a class feed first."}, status_code=400)
    daily_feed.refresh(prof["feed_url"])
    from . import daily
    daily.repick_if_untouched()
    return payload()
