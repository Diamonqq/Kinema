"""Tolerant parsing of an incomplete JSON prefix — the lesson as it streams in.

The model writes the lesson as one JSON object. While it is still arriving we want to show the
restatement, the plan and the first steps. parse_prefix() closes whatever is open (a string, an
array, an object), drops a dangling key or a half-written literal, and returns the object so far.
It never invents content: an unfinished string is shown as far as it has been written.
"""
from __future__ import annotations

import json


def _close(text: str) -> str | None:
    """Return text + the closers needed to make it parse, or None if the prefix is unusable."""
    stack: list[str] = []
    in_str = False
    esc = False
    for ch in text:
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch in "{[":
            stack.append(ch)
        elif ch in "}]":
            if not stack:
                return None
            stack.pop()
    out = text
    if in_str:
        if esc:                       # a lone backslash at the very end
            out = out[:-1]
        # a half-written \uXXXX escape would make the string invalid
        tail = out[-6:]
        k = tail.rfind("\\u")
        if k >= 0 and len(tail) - k < 6:
            out = out[: len(out) - (len(tail) - k)]
        out += '"'
    return out + "".join("}" if c == "{" else "]" for c in reversed(stack))


def _trim_dangling(text: str) -> str:
    """Remove a trailing comma, a key without its value, or a partial literal/number."""
    t = text.rstrip()
    while t:
        last = t[-1]
        if last in ",:":
            t = t[:-1].rstrip()
            if last == ":":
                # drop the key string that preceded the colon
                if t.endswith('"'):
                    i = len(t) - 2
                    while i >= 0:
                        if t[i] == '"' and (i == 0 or t[i - 1] != "\\"):
                            break
                        i -= 1
                    t = t[:i].rstrip()
                    continue
            continue
        # a partial bare literal or number at the end (true/false/null/-1.2e)
        j = len(t)
        while j > 0 and (t[j - 1].isalnum() or t[j - 1] in "+-."):
            j -= 1
        if j < len(t):
            word = t[j:]
            if word in ("true", "false", "null"):
                return t
            try:
                float(word)
                if not word.endswith((".", "e", "E", "-", "+")):
                    return t
            except ValueError:
                pass
            t = t[:j].rstrip()
            continue
        return t
    return t


def parse_prefix(text: str):
    """Best-effort object from a JSON prefix; None when nothing usable has arrived yet."""
    if not text:
        return None
    start = text.find("{")
    if start < 0:
        return None
    body = text[start:]
    try:
        return json.loads(body)
    except ValueError:
        pass
    # Try the prefix as is (an open string is kept, shown as far as written), then with the
    # trailing fragment trimmed, then backing off to the last structural boundary.
    cut = body
    for _ in range(6):
        closed = _close(cut)
        if closed is not None:
            try:
                return json.loads(closed)
            except ValueError:
                pass
        trimmed = _trim_dangling(cut)
        if trimmed != cut:
            cut = trimmed
            continue
        # back off to the last comma or opening bracket outside strings
        k = max(cut.rfind(","), cut.rfind("["), cut.rfind("{"))
        if k < 0 or (k == 0 and cut == "{"):
            break
        cut = cut[: k + (1 if cut[k] in "[{" else 0)]
    return None
