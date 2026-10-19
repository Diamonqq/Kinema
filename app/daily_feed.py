"""Class Daily feed: a static JSON file a physics department could publish so a whole class gets the same Daily.

Format (documented in docs/TEACHER-API.md):
    {"course": "2301", "days": {"2026-10-17": "8.3", "2026-10-18": {"id": "9.4"}}}

No server is involved: Kinema fetches the URL in the background with a short timeout, keeps only entries whose
problem id exists in the Daily catalog, caches the result in the data folder and falls back to Kinema's own pick on
any error, missing day or unknown id. The fetch itself never blocks a page.
"""
from __future__ import annotations

import json
import re
import threading
import time
import urllib.request
from pathlib import Path

MAX_BYTES = 256 * 1024
TIMEOUT = 6.0
STALE = 6 * 3600
DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_lock = threading.Lock()
_running: set[str] = set()


class FeedError(ValueError):
    """A plain-words reason the feed was not used."""


def _cache_path() -> Path:
    from .main import DATA
    return Path(DATA) / "daily_feed.json"


def _read_cache() -> dict:
    try:
        d = json.loads(_cache_path().read_text(encoding="utf-8"))
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def _write_cache(d: dict) -> None:
    p = _cache_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
    tmp.replace(p)


def _open(url: str, timeout: float) -> bytes:
    """Fetch at most MAX_BYTES (tests replace this or point it at a local server)."""
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "Kinema-daily-feed"})
    with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 - scheme checked in learner_profile.clean
        data = r.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise FeedError("The feed file is larger than 256 KB.")
    return data


def validate(doc, course: str = "") -> tuple[dict[str, str], int]:
    """Return ({day: problem_id}, rejected_count). Raises FeedError when the file is not a usable feed."""
    from . import daily
    if not isinstance(doc, dict) or not isinstance(doc.get("days"), dict):
        raise FeedError("The feed is not in Kinema's format (it needs a \"days\" list).")
    fc = str(doc.get("course") or "")
    if course and course != "other" and fc and fc != course:
        raise FeedError(f"This feed is for {fc}, but your profile says {course}.")
    cat = daily.catalog()
    days, rejected = {}, 0
    for day, val in list(doc["days"].items())[:2000]:
        pid = val.get("id") if isinstance(val, dict) else val
        if isinstance(day, str) and DAY.match(day) and isinstance(pid, (str, int)) and str(pid) in cat:
            days[day] = str(pid)
        else:
            rejected += 1
    if not days:
        raise FeedError("The feed has no problems Kinema knows.")
    return days, rejected


def refresh(url: str) -> dict:
    """Fetch, validate and cache now. Never raises: the cache records the error and the old good days are kept."""
    from . import learner_profile
    course = learner_profile.load().get("course", "")
    old = _read_cache()
    keep = old.get("days") if old.get("url") == url and isinstance(old.get("days"), dict) else {}
    entry = {"url": url, "fetched_ts": time.time(), "days": keep, "ok": False, "error": "", "rejected": 0, "course": old.get("course", "")}
    try:
        raw = _open(url, TIMEOUT)
        try:
            doc = json.loads(raw.decode("utf-8-sig"))
        except (UnicodeDecodeError, ValueError):
            raise FeedError("The feed is not valid JSON.") from None
        days, rejected = validate(doc, course)
        entry.update(days=days, ok=True, rejected=rejected, course=str(doc.get("course") or ""))
    except FeedError as exc:
        entry["error"] = str(exc)
    except Exception as exc:  # noqa: BLE001 - network, TLS, timeouts: the plain fallback is Kinema's own pick
        entry["error"] = "Could not reach the feed (" + (type(exc).__name__) + "). Kinema's own pick is used."
    with _lock:
        _write_cache(entry)
    return entry


def refresh_async(url: str) -> None:
    with _lock:
        if not url or url in _running:
            return
        _running.add(url)

    def run():
        try:
            refresh(url)
        finally:
            with _lock:
                _running.discard(url)
    threading.Thread(target=run, name="kinema-daily-feed", daemon=True).start()


def choice(day: str, profile: dict | None = None) -> str | None:
    """The feed's problem for this day, if the feed is chosen, cached for this URL and lists a known id."""
    from . import daily, learner_profile
    prof = profile or learner_profile.load()
    if prof.get("daily_source") != "feed" or not prof.get("feed_url"):
        return None
    c = _read_cache()
    if c.get("url") != prof["feed_url"]:
        refresh_async(prof["feed_url"])
        return None
    if time.time() - float(c.get("fetched_ts") or 0) > STALE:
        refresh_async(prof["feed_url"])
    pid = (c.get("days") or {}).get(day)
    return pid if isinstance(pid, str) and pid in daily.catalog() else None


def status() -> dict:
    from . import learner_profile
    prof = learner_profile.load()
    if prof.get("daily_source") != "feed" or not prof.get("feed_url"):
        return {"state": "off"}
    c = _read_cache()
    if c.get("url") != prof["feed_url"]:
        return {"state": "checking", "url": prof["feed_url"]}
    from . import daily
    today = daily.day_key()
    days = c.get("days") or {}
    return {"state": "ok" if c.get("ok") else "error", "url": c["url"], "fetched_ts": c.get("fetched_ts"), "error": c.get("error", ""),
            "days": len(days), "today": today in days, "rejected": c.get("rejected", 0), "course": c.get("course", ""),
            "checking": prof["feed_url"] in _running}


def warm() -> None:
    """Refresh a chosen feed in the background when its cache is missing or older than six hours."""
    from . import learner_profile
    prof = learner_profile.load()
    if prof.get("daily_source") == "feed" and prof.get("feed_url"):
        c = _read_cache()
        if c.get("url") != prof["feed_url"] or time.time() - float(c.get("fetched_ts") or 0) > STALE:
            refresh_async(prof["feed_url"])
