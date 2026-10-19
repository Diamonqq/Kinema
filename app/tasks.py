"""Background work that survives restarts: a SQLite-backed queue with a small pool of worker threads.

Interactive model calls (solving a screenshot, a quick question) stay in app/jobs.py, which the page polls. Slow
content work (writing and checking notes) goes here: a restart re-queues whatever was running, a task key stops the
same work being queued twice, and every attempt's error is kept (Astra review, 2026-09-23).
"""
from __future__ import annotations

import json
import sqlite3
import threading
import time
import traceback
import uuid
from pathlib import Path
from typing import Callable

MAX_ATTEMPTS = 3
HANDLERS: dict[str, Callable[[dict, Callable[[str], None]], dict]] = {}
_threads: list[threading.Thread] = []
_stop = threading.Event()
_wake = threading.Event()
_db_path: Path | None = None
_claim_lock = threading.Lock()


def ensure_tables(conn: sqlite3.Connection) -> None:
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS tasks(
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, key TEXT UNIQUE, payload TEXT NOT NULL, status TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, progress TEXT,
        created_ts REAL NOT NULL, updated_ts REAL NOT NULL, started_ts REAL, finished_ts REAL, error TEXT, result TEXT);
    CREATE INDEX IF NOT EXISTS tasks_status ON tasks(status, priority DESC, created_ts);
    """)


def register(kind: str, fn: Callable[[dict, Callable[[str], None]], dict]) -> None:
    HANDLERS[kind] = fn


def _connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path, timeout=30)
    conn.row_factory = sqlite3.Row
    return conn


def enqueue(conn, kind: str, payload: dict, *, key: str | None = None, priority: int = 0, retry_failed: bool = False) -> dict:
    """Queue work once per key. A finished or running task with the same key is returned as is."""
    now = time.time()
    if key:
        row = conn.execute("SELECT * FROM tasks WHERE key=?", (key,)).fetchone()
        if row:
            if retry_failed and row["status"] in ("failed", "cancelled"):
                conn.execute("UPDATE tasks SET status='queued', attempts=0, error=NULL, updated_ts=?, priority=MAX(priority, ?) WHERE id=?",
                             (now, priority, row["id"]))
                _wake.set()
            elif row["status"] == "queued" and priority > row["priority"]:
                conn.execute("UPDATE tasks SET priority=?, updated_ts=? WHERE id=?", (priority, now, row["id"]))
            return dict(conn.execute("SELECT * FROM tasks WHERE id=?", (row["id"],)).fetchone())
    tid = uuid.uuid4().hex[:12]
    conn.execute("INSERT INTO tasks(id, kind, key, payload, status, priority, created_ts, updated_ts) VALUES(?,?,?,?,?,?,?,?)",
                 (tid, kind, key, json.dumps(payload), "queued", priority, now, now))
    _wake.set()
    return dict(conn.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone())


def recover(conn) -> int:
    """After a restart, work that was running is queued again (or failed after too many attempts)."""
    now = time.time()
    n = conn.execute("UPDATE tasks SET status='queued', updated_ts=?, progress='restarted' WHERE status='running' AND attempts<?",
                     (now, MAX_ATTEMPTS)).rowcount
    conn.execute("UPDATE tasks SET status='failed', updated_ts=?, error=COALESCE(error,'')||' [gave up after restarts]' "
                 "WHERE status='running'", (now,))
    return n


def get(conn, *, key: str | None = None, task_id: str | None = None) -> dict | None:
    row = conn.execute("SELECT * FROM tasks WHERE key=?" if key else "SELECT * FROM tasks WHERE id=?", (key or task_id,)).fetchone()
    return dict(row) if row else None


def _claim(conn) -> dict | None:
    with _claim_lock:
        row = conn.execute("SELECT * FROM tasks WHERE status='queued' AND kind IN (%s) ORDER BY priority DESC, created_ts LIMIT 1"
                           % ",".join("?" * len(HANDLERS)), tuple(HANDLERS)).fetchone() if HANDLERS else None
        if not row:
            return None
        now = time.time()
        conn.execute("UPDATE tasks SET status='running', attempts=attempts+1, started_ts=?, updated_ts=?, progress=NULL WHERE id=?",
                     (now, now, row["id"]))
        conn.commit()
        return dict(row)


def run_one(path: Path) -> bool:
    """Claim and run one queued task. Returns False when there was nothing to do."""
    conn = _connect(path)
    try:
        task = _claim(conn)
        if not task:
            return False
        fn = HANDLERS[task["kind"]]

        def progress(msg: str) -> None:
            c2 = _connect(path)
            try:
                c2.execute("UPDATE tasks SET progress=?, updated_ts=? WHERE id=?", (msg[:300], time.time(), task["id"]))
                c2.commit()
            finally:
                c2.close()

        try:
            result = fn(json.loads(task["payload"]), progress)
            conn.execute("UPDATE tasks SET status='done', result=?, finished_ts=?, updated_ts=?, error=NULL WHERE id=?",
                         (json.dumps(result)[:20000], time.time(), time.time(), task["id"]))
        except Exception as exc:  # noqa: BLE001 - keep the error with the task
            attempts = task["attempts"] + 1
            status = "queued" if attempts < MAX_ATTEMPTS and getattr(exc, "retryable", True) else "failed"
            conn.execute("UPDATE tasks SET status=?, error=?, updated_ts=? WHERE id=?",
                         (status, (str(exc) + "\n" + traceback.format_exc(limit=3))[-2000:], time.time(), task["id"]))
        conn.commit()
        return True
    finally:
        conn.close()


def _loop(path: Path) -> None:
    while not _stop.is_set():
        try:
            busy = run_one(path)
        except Exception:  # noqa: BLE001 - the worker must not die
            busy = False
        if not busy:
            _wake.wait(5.0)
            _wake.clear()


def start(path: Path, workers: int = 2) -> None:
    global _db_path
    if _threads:
        return
    _db_path = path
    conn = _connect(path)
    try:
        ensure_tables(conn)
        recover(conn)
        conn.commit()
    finally:
        conn.close()
    for i in range(workers):
        t = threading.Thread(target=_loop, args=(path,), name=f"kinema-task-{i}", daemon=True)
        t.start()
        _threads.append(t)


def stop() -> None:
    _stop.set()
    _wake.set()
