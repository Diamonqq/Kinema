"""Background model work the browser polls.

A solve takes 20-90 s. Streaming it over one long request does not survive Panel's embedding proxy (it buffers
whole responses) or a closed tab, so every model call runs as a job: POST starts it and returns an id at once,
GET /api/jobs/{id} returns what is known so far (phase, thinking tokens, the lesson parsed so far, the final
result or the error). Jobs live in memory; finished results are also saved to the database by their runners.
"""
from __future__ import annotations

import threading
import time
import traceback
import uuid

from .partial_json import parse_prefix

MAX_JOBS = 60
# Jobs whose answer is the "answer" field of a structured (schema) reply. Their provider may write a plain-text draft
# before the structured output starts; that draft is never published as the answer.
STRUCTURED = {"teacher-reply", "teacher-build", "daily-ask"}
_LOCK = threading.Lock()
_JOBS: dict[str, "Job"] = {}


class Job:
    def __init__(self, kind: str, info: dict | None = None):
        self.id = uuid.uuid4().hex[:12]
        self.kind = kind
        self.info = info or {}
        self.status = "running"            # running | done | error | cancelled
        self.phase = "starting"
        self.created = time.time()
        self.updated = self.created
        self.thinking = 0
        self.retry = None
        self.partial = None                # parsed structured answer so far
        self.text = ""                     # plain-text answer so far (ask)
        self.result = None
        self.error = None
        self.error_raw = None
        self.cancel = threading.Event()
        self._json_text = ""
        self._parsed_len = 0
        self._parsed_at = 0.0
        # The answer stream the browser shows: one provider call is one pass (a reply that first asks to read the book
        # makes a second call that starts its structured output again). seq rises whenever pass or answer changes, so
        # a late or out-of-order poll is recognisable and the answer shown never runs backwards within a pass.
        self.pass_no = 0
        self.seq = 0
        self.answer = ""
        self.reading_done = False          # the runner discarded a pass to read: later passes answer, never ask to read
        self.hold_answer = False           # short teaching turns are checked before any draft is published

    # provider callback ---------------------------------------------------------------------------
    def on_event(self, ev: dict) -> None:
        kind = ev.get("type")
        self.updated = time.time()
        if kind == "status":
            if ev.get("phase") == "connecting":
                self._next_pass()
            self.phase = {"connecting": "connecting", "responding": "thinking", "writing": "writing"}.get(ev.get("phase"), self.phase)
        elif kind == "retry":
            self.retry = {k: ev.get(k) for k in ("attempt", "max", "error_status")}
        elif kind == "thinking":
            self.thinking = int(ev.get("tokens") or 0)
            self.retry = None
            if self.phase in ("starting", "connecting"):
                self.phase = "thinking"
        elif kind == "json":
            text = ev.get("text") or ""
            if self._json_text and not text.startswith(self._json_text):
                self._next_pass()               # a provider that restarted without a status event
            if not self.pass_no:
                self._next_pass()
            self._json_text = text
            self.retry = None
            self.phase = "writing"
            now = time.time()
            # parsing a 30 KB prefix costs ~1 ms; still, do it at most ~6x a second
            if now - self._parsed_at > 0.15 and len(self._json_text) != self._parsed_len:
                self._reparse(now)
        elif kind == "text":
            self.text = ev.get("text") or ""
            if self.kind == "daily-ask" and self.text != self.answer:
                if self.answer and not self.text.startswith(self.answer):
                    self._next_pass()
                    self.text = ev.get("text") or ""
                if not self.pass_no:
                    self.pass_no = 1
                self.answer = self.text
                self.seq += 1
            self.retry = None
            if self.kind != "solve":
                self.phase = "writing"

    def new_pass(self) -> None:
        """The runner discards what streamed so far to read the book or earlier sessions; the next call answers."""
        self.reading_done = True
        self._next_pass()

    def _next_pass(self) -> None:
        """A new provider call: nothing of the previous pass stays published."""
        self.pass_no += 1
        self.seq += 1
        self.answer = ""
        self.partial = None
        self.text = ""
        self._json_text = ""
        self._parsed_len = 0

    def _reparse(self, now: float) -> None:
        parsed = parse_prefix(self._json_text)
        if isinstance(parsed, dict):
            self.partial = parsed
            answer = parsed.get("answer") if self._answers(parsed) else None
            # a prefix parse can drop an unfinished escape at the end; keep what was already shown in this pass
            if isinstance(answer, str) and len(answer) > len(self.answer) and answer != self.answer:
                self.answer = answer
                self.seq += 1
        self._parsed_len = len(self._json_text)
        self._parsed_at = now

    def _answers(self, parsed: dict) -> bool:
        """A tutor reply's answer is published only once its routing fields are complete and ask for no reading: a
        pass that asks to read is discarded, whatever answer the model wrote in it."""
        if self.hold_answer:
            return False
        if self.kind != "teacher-reply" or self.reading_done:
            return True
        if not all(k in parsed for k in ("read_sources", "read_history", "reply_kind", "answer")):
            return False
        hist = parsed["read_history"] if isinstance(parsed["read_history"], dict) else {}
        wants = any(isinstance(w, dict) for w in parsed["read_sources"] or []) or bool(hist.get("ids") or str(hist.get("query") or "").strip())
        return not wants

    def snapshot(self) -> dict:
        if self.status == "running" and len(self._json_text) != self._parsed_len:
            self._reparse(time.time())
        out = {"id": self.id, "kind": self.kind, "status": self.status, "phase": self.phase,
               "secs": round((self.updated if self.status != "running" else time.time()) - self.created, 1),
               "thinking_tokens": self.thinking, "retry": self.retry, "info": self.info}
        if self.status == "running":
            out["partial"] = {**self.partial, "answer": ""} if self.hold_answer and isinstance(self.partial, dict) else self.partial
            if self.kind in STRUCTURED:
                out["stream"] = {"pass": self.pass_no, "seq": self.seq, "answer": self.answer}
            else:
                out["text"] = self.text
        if self.result is not None:
            out["result"] = self.result
        if self.error is not None:
            out["error"] = self.error
            if self.error_raw:
                out["raw"] = self.error_raw
        return out


def start(kind: str, runner, info: dict | None = None) -> Job:
    """runner(job) does the work and returns the result dict; raising sets job.error (message only)."""
    job = Job(kind, info)
    with _LOCK:
        _JOBS[job.id] = job
        if len(_JOBS) > MAX_JOBS:
            finished = sorted((j for j in _JOBS.values() if j.status != "running"), key=lambda j: j.updated)
            for old in finished[: len(_JOBS) - MAX_JOBS]:
                _JOBS.pop(old.id, None)

    def run():
        try:
            result = runner(job)
            if job.cancel.is_set():
                job.status, job.error = "cancelled", "Cancelled."
            else:
                job.result, job.status, job.phase = result, "done", "done"
        except JobError as exc:
            job.status = "cancelled" if job.cancel.is_set() else "error"
            job.error = "Cancelled." if job.cancel.is_set() else str(exc)
            job.error_raw = exc.raw
        except Exception as exc:  # noqa: BLE001 — the browser must see a message, never a hung spinner
            job.status = "cancelled" if job.cancel.is_set() else "error"
            job.error = "Cancelled." if job.cancel.is_set() else f"{type(exc).__name__}: {exc}"
            job.info["trace"] = traceback.format_exc(limit=4)[-1200:]
        finally:
            job.updated = time.time()
    threading.Thread(target=run, name=f"kinema-{kind}-{job.id}", daemon=True).start()
    return job


class JobError(RuntimeError):
    """A failure with a message for the student and, optionally, the raw model output for diagnosis."""

    def __init__(self, message: str, raw: str | None = None):
        super().__init__(message)
        self.raw = raw


def get(job_id: str) -> Job | None:
    with _LOCK:
        return _JOBS.get(job_id)


def running(kind: str | None = None) -> list[Job]:
    with _LOCK:
        return [j for j in _JOBS.values() if j.status == "running" and (kind is None or j.kind == kind)]
