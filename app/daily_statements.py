"""Reviewed, readable Daily statements bound to their exact catalog source.

`get(pid, problem=None)` returns a copied {statement_md, source} entry, or None
when no reviewed entry exists or the current source differs. Pass the current
daily.catalog() problem when it is already available. Callers retain raw catalog
text and original book images as the fallback/reference; this module never edits
catalogs, picks, attempts or learning records and makes no model calls.
"""
from __future__ import annotations

import copy
import hashlib
import json
import re
from functools import lru_cache
from pathlib import Path

CONTENT = Path(__file__).resolve().parent / "content"
SOURCE_FIELDS = ("id", "chapter", "number", "section", "stars", "title", "text", "crops", "figs", "context")


def source_fingerprint(problem: dict) -> str:
    """Hash statement text, givens/geometry references and identity, not UI hooks."""
    source = {key: problem.get(key) for key in SOURCE_FIELDS}
    source["title"] = re.sub(r"\s*[*∗]+\s*$", "", str(source.get("title") or "")).strip()
    return hashlib.sha256(json.dumps(source, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


@lru_cache(maxsize=8)
def _read_revision(path: str, size: int, modified_ns: int) -> dict:
    value = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("A statement source must be a JSON object.")
    return value


def _read(path: Path) -> dict:
    st = path.stat()
    return _read_revision(str(path.resolve()), st.st_size, st.st_mtime_ns)


def get(pid: str, problem: dict | None = None) -> dict | None:
    """Return authored text only while it still matches the exact current source.

    Missing or malformed authored content is an unavailable enhancement, never
    permission to hide the original problem or to serve a different problem.
    """
    try:
        if not isinstance(pid, str):
            return None
        entry = _read(CONTENT / "daily_statements.json").get(pid)
        if not isinstance(entry, dict):
            return None
        if problem is None:
            rows = _read(CONTENT / "daily_problems.json").get("problems")
            if not isinstance(rows, list):
                return None
            problem = next((p for p in rows if isinstance(p, dict) and p.get("id") == pid), None)
        if not isinstance(problem, dict) or problem.get("id") != pid:
            return None
        text, source = entry.get("statement_md"), entry.get("source")
        if not isinstance(text, str) or not text.strip() or not isinstance(source, dict):
            return None
        if source.get("catalog_sha256") != source_fingerprint(problem):
            return None
        if source.get("statement_sha256") != hashlib.sha256(text.encode("utf-8")).hexdigest():
            return None
        return copy.deepcopy(entry)
    except (OSError, ValueError, TypeError):
        return None
