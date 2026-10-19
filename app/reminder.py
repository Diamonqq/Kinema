"""The daily reminder: a Windows scheduled task that runs tools/remind.py (pythonw, no window) at the owner's time.

The owner sets the time on the Daily problem page (owner, 2026-09-23: "just let me set it"). Clearing the time deletes the
task. Tests and dev servers use KINEMA_REMINDER=off, which records the wish without touching Task Scheduler.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TASK = os.environ.get("KINEMA_REMINDER_TASK", r"Kinema\Daily session")
NO_WINDOW = 0x08000000


def valid_time(t: str) -> bool:
    return bool(re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", t or ""))


def _pythonw() -> str:
    venv = ROOT / ".venv" / "Scripts" / "pythonw.exe"
    if venv.is_file():
        return str(venv)
    exe = Path(sys.executable)
    w = exe.with_name("pythonw.exe")
    return str(w if w.is_file() else exe)


def _enabled() -> bool:
    return os.name == "nt" and os.environ.get("KINEMA_REMINDER", "on") != "off"


def _run(args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(["schtasks.exe"] + args, capture_output=True, text=True, timeout=20, creationflags=NO_WINDOW)


def apply(time_str: str) -> dict:
    """Create, move or delete the daily task. Returns what Task Scheduler now holds."""
    if not _enabled():
        return {"ok": True, "time": time_str or None, "scheduled": False, "note": "reminders are off in this environment"}
    if not time_str:
        r = _run(["/Delete", "/TN", TASK, "/F"])
        return {"ok": True, "time": None, "scheduled": False, "removed": r.returncode == 0}
    if not valid_time(time_str):
        return {"ok": False, "error": "time must look like 08:30"}
    action = f'"{_pythonw()}" "{ROOT / "tools" / "remind.py"}"'
    r = _run(["/Create", "/SC", "DAILY", "/TN", TASK, "/TR", action, "/ST", time_str, "/F"])
    if r.returncode != 0:
        return {"ok": False, "error": (r.stderr or r.stdout or "schtasks failed").strip()[:300]}
    return {"ok": True, "time": time_str, "scheduled": True, **status()}


def status() -> dict:
    if not _enabled():
        return {"scheduled": False}
    r = _run(["/Query", "/TN", TASK, "/FO", "LIST", "/V"])
    if r.returncode != 0:
        return {"scheduled": False}
    out = {}
    for line in r.stdout.splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            out[k.strip().lower()] = v.strip()
    return {"scheduled": True, "next_run": out.get("next run time"), "last_result": out.get("last result"),
            "status": out.get("status")}
