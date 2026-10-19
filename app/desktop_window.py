"""Kinema as its own Windows app (1.28): one window, its own taskbar identity, one canonical server.

Run through Kinema.pyw (the Start-menu shortcut target). The launcher
- sets AppUserModelID "Kiwi.Kinema" before any window exists, so the window, the Start-menu
  shortcut and a taskbar pin share one identity and icon;
- keeps a single instance: a second launch asks the first window to come forward and exits;
- reuses the canonical Kinema server (exact root, uvicorn app.main:app on the port, KINEMA_DATA
  = <root>/data, healthy) or starts it with the same command Panel uses, so Panel adopts it too;
- replaces a server whose version is older than the installed files only when it reports no
  running tutor jobs or background tasks; otherwise it keeps it and says so;
- on close hides the window instead of quitting. A server this launcher started is stopped once
  it has been idle after a short grace; a server someone else started (Panel, by hand) is left alone.

Nothing here imports app.main, so it never opens Kinema's database for writing.
"""
from __future__ import annotations

import argparse
import html
import json
import os
import re
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

APP_ID = "Kiwi.Kinema"
HOST, PORT = "127.0.0.1", 8790
ROOT = Path(__file__).resolve().parents[1]
BACKGROUND = "#0f1114"                       # app.css --bg
DEFAULT_SIZE, MIN_SIZE = (1440, 920), (960, 640)
CLOSE_GRACE = float(os.environ.get("KINEMA_WINDOW_GRACE") or 120)   # seconds hidden before an owned idle server stops
IDLE_POLL = float(os.environ.get("KINEMA_WINDOW_POLL") or 15)
WINDOW_MUTEX = "Local\\Kiwi.Kinema.Window"
SERVICE_MUTEX = "Local\\Kiwi.Kinema.Service"
ACTIVATE_EVENT = "Local\\Kiwi.Kinema.Activate"
ACK_EVENT = "Local\\Kiwi.Kinema.ActivateAck"
_NO_WINDOW = 0x08000000 if os.name == "nt" else 0
_DETACHED = 0x00000008 if os.name == "nt" else 0
_NEW_GROUP = 0x00000200 if os.name == "nt" else 0
_SAFE_PATH = re.compile(r"^/[A-Za-z0-9/_\-.?=&%#]*$")


class ServiceError(RuntimeError):
    """Kinema could not be reused or started; the message is shown in the window."""


@dataclass
class Config:
    root: Path = ROOT
    port: int = PORT
    data: Path | None = None
    python: Path | None = None
    suffix: str = ""                         # isolates mutex/event names for tests and smoke runs

    def __post_init__(self):
        self.root = Path(self.root).resolve()
        self.data = Path(self.data).resolve() if self.data else self.root / "data"
        self.python = Path(self.python) if self.python else self.root / ".venv" / "Scripts" / "pythonw.exe"

    @classmethod
    def from_env(cls, env=os.environ) -> "Config":
        return cls(root=Path(env.get("KINEMA_WINDOW_ROOT") or ROOT), port=int(env.get("KINEMA_WINDOW_PORT") or PORT),
                   data=env.get("KINEMA_WINDOW_DATA") or None, python=env.get("KINEMA_WINDOW_PYTHON") or None,
                   suffix=env.get("KINEMA_WINDOW_INSTANCE", ""))

    @property
    def url(self) -> str:
        return f"http://{HOST}:{self.port}"

    @property
    def state_dir(self) -> Path:
        return self.data / "desktop"

    def name(self, base: str) -> str:
        return base + (("." + self.suffix) if self.suffix else "")


# ── server facts (read-only) ──────────────────────────────────────────────────────────────────────

def source_version(root: Path) -> str | None:
    try:
        m = re.search(r'^VERSION\s*=\s*["\']([^"\']+)', (Path(root) / "app" / "main.py").read_text(encoding="utf-8"), re.M)
        return m.group(1) if m else None
    except OSError:
        return None


def version_key(v: str | None) -> tuple:
    return tuple(int(p) if p.isdigit() else 0 for p in re.split(r"[.\-+]", v or "0"))


_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def _get_json(url: str, timeout: float = 1.5):
    with _OPENER.open(url, timeout=timeout) as r:
        return json.load(r)


def health(cfg: Config) -> dict | None:
    try:
        h = _get_json(cfg.url + "/api/health")
        return h if isinstance(h, dict) and h.get("ok") is True else None
    except Exception:
        return None


def running_jobs(cfg: Config) -> list | None:
    """Tutor/build jobs the server reports as running; None when it cannot say (treated as busy)."""
    try:
        jobs = _get_json(cfg.url + "/api/jobs", timeout=3)
        return jobs if isinstance(jobs, list) else None
    except Exception:
        return None


def running_tasks(cfg: Config) -> int | None:
    """Background note tasks marked running in kinema.db, read-only; None when unreadable (treated as busy)."""
    db = cfg.data / "kinema.db"
    if not db.is_file():
        return 0
    try:
        conn = sqlite3.connect(db.as_uri() + "?mode=ro", uri=True, timeout=2)
        try:
            if not conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tasks'").fetchone():
                return 0
            return int(conn.execute("SELECT COUNT(*) FROM tasks WHERE status='running'").fetchone()[0])
        finally:
            conn.close()
    except Exception:
        return None


def is_idle(cfg: Config, jobs=running_jobs, tasks=running_tasks) -> bool:
    return jobs(cfg) == [] and tasks(cfg) == 0


def _psutil():
    import psutil
    return psutil


def listener_pid(port: int, ps=None) -> int | None:
    ps = ps or _psutil()
    try:
        for row in ps.net_connections(kind="tcp"):
            if (row.status == ps.CONN_LISTEN and row.laddr and int(row.laddr.port) == port and row.pid
                    and str(row.laddr.ip) in {HOST, "0.0.0.0", "::", "::1"}):
                return int(row.pid)
    except Exception:
        return None
    return None


def is_canonical(process, cfg: Config) -> bool:
    """Same identity rule as Panel's kinema_integration: exact cwd, uvicorn app.main:app on the port and
    the canonical KINEMA_DATA. Anything unreadable fails closed."""
    try:
        args = process.cmdline()
        joined = " ".join(args).lower()
        if not (process.is_running() and Path(process.cwd()).resolve() == cfg.root
                and "uvicorn" in joined and "app.main:app" in joined and str(cfg.port) in args):
            return False
        data = process.environ().get("KINEMA_DATA")
        return bool(data) and Path(data).resolve() == cfg.data
    except Exception:
        return False


# ── service ───────────────────────────────────────────────────────────────────────────────────────

@dataclass
class Service:
    cfg: Config
    ps: object = None
    popen: object = subprocess.Popen
    sleep: object = time.sleep
    clock: object = time.monotonic
    health: object = health
    idle: object = None
    owned_pid: int | None = field(default=None, init=False)

    def __post_init__(self):
        self.ps = self.ps or _psutil()
        self.idle = self.idle or (lambda: is_idle(self.cfg))

    # marker: which server this launcher started (so only that one is ever stopped by the window)
    @property
    def marker(self) -> Path:
        return self.cfg.state_dir / "service.json"

    def _write_marker(self, pid: int, version: str | None) -> None:
        self.cfg.state_dir.mkdir(parents=True, exist_ok=True)
        tmp = self.marker.with_suffix(".tmp")
        tmp.write_text(json.dumps({"root": str(self.cfg.root), "port": self.cfg.port, "pid": pid,
                                   "created_ts": self.ps.Process(pid).create_time(), "version": version}), encoding="utf-8")
        os.replace(tmp, self.marker)

    def owned(self) -> int | None:
        """The listener PID when it is the exact process this launcher started (PID-reuse safe)."""
        try:
            m = json.loads(self.marker.read_text(encoding="utf-8"))
            pid = listener_pid(self.cfg.port, self.ps)
            if not pid or int(m["pid"]) != pid or Path(m["root"]).resolve() != self.cfg.root or int(m["port"]) != self.cfg.port:
                return None
            p = self.ps.Process(pid)
            return pid if abs(p.create_time() - float(m["created_ts"])) < 0.01 and is_canonical(p, self.cfg) else None
        except Exception:
            return None

    def _family(self, pid: int) -> set[int]:
        try:
            p = self.ps.Process(pid)
            return {pid} | {c.pid for c in p.children(recursive=True)}
        except Exception:
            return {pid}

    def _wait_health(self, deadline: float, *, process=None) -> dict | None:
        while self.clock() < deadline:
            h = self.health(self.cfg)
            if h:
                return h
            if process is not None and process.poll() is not None:
                return None
            self.sleep(0.2)
        return None

    def ensure(self, *, deadline_seconds: float = 40.0) -> dict:
        _require_user_launch()
        expected = source_version(self.cfg.root)
        if not expected:
            raise ServiceError(f"Kinema's files are missing from {self.cfg.root}.")
        for attempt in range(2):
            pid = listener_pid(self.cfg.port, self.ps)
            if pid:
                result = self._reuse(pid, expected, deadline_seconds)
                if result:
                    return result
                continue                        # stopped an outdated server; start the installed one
            try:
                return self._start(expected, deadline_seconds)
            except _PortTaken:
                if attempt:
                    raise ServiceError(f"Port {self.cfg.port} became busy while Kinema was starting.")
        raise ServiceError("Kinema could not be started.")

    def _reuse(self, pid: int, expected: str, deadline_seconds: float) -> dict | None:
        try:
            process = self.ps.Process(pid)
        except Exception:
            raise ServiceError(f"Port {self.cfg.port} is in use by a process that went away; try again.")
        if not is_canonical(process, self.cfg):
            raise ServiceError(f"Kinema could not verify the program using port {self.cfg.port}. "
                               "It may belong to another app or have administrator permissions. "
                               "Kinema left it running.")
        h = self._wait_health(self.clock() + deadline_seconds)
        if not h:
            raise ServiceError("Kinema is running but not answering. It was left alone; try again in a moment.")
        running = h.get("version")
        owned = self.owned() == pid
        if running == expected:
            return {"state": "reused", "url": self.cfg.url, "pid": pid, "version": running, "owned": owned, "note": ""}
        if version_key(running) > version_key(expected):
            return {"state": "reused", "url": self.cfg.url, "pid": pid, "version": running, "owned": owned,
                    "note": f"The running Kinema ({running}) is newer than the installed files ({expected})."}
        if not self.idle():
            return {"state": "kept_outdated", "url": self.cfg.url, "pid": pid, "version": running, "owned": owned,
                    "note": f"Kinema {expected} is installed, but {running} is finishing work, so it was kept. "
                            "Close and reopen Kinema when it is done to update."}
        self.stop(pid)
        return None

    def stop(self, pid: int) -> None:
        """Stop one verified canonical server (and its venv launcher parent), then wait for the port to free."""
        process = self.ps.Process(pid)
        if not is_canonical(process, self.cfg):
            raise ServiceError("Refused to stop a process that is not this Kinema.")
        targets = [process]
        try:
            parent = process.parent()
            if parent is not None and is_canonical(parent, self.cfg):
                targets.append(parent)
        except Exception:
            pass
        for p in targets:
            try:
                p.terminate()
            except Exception:
                pass
        deadline = self.clock() + 15
        while self.clock() < deadline and listener_pid(self.cfg.port, self.ps):
            self.sleep(0.2)
        if listener_pid(self.cfg.port, self.ps):
            raise ServiceError("The previous Kinema did not stop; it was left running.")
        try:
            self.marker.unlink()
        except OSError:
            pass

    def stop_owned_if_idle(self) -> bool:
        pid = self.owned()
        if not pid or not self.idle():
            return False
        self.stop(pid)
        return True

    def _start(self, expected: str, deadline_seconds: float) -> dict:
        if not self.cfg.python.is_file():
            raise ServiceError(f"Kinema's Python environment is missing: {self.cfg.python}")
        env = {k: v for k, v in os.environ.items()
               if k not in ("PYTHONHOME", "PYTHONPATH", "VIRTUAL_ENV", "CONDA_PREFIX") and not k.startswith("KINEMA_WINDOW_")}
        env["KINEMA_DATA"] = str(self.cfg.data)
        self.cfg.state_dir.mkdir(parents=True, exist_ok=True)
        log_path = self.cfg.state_dir / "server.log"
        with log_path.open("wb") as log:
            # Exactly Panel's command line, so Panel's identity check adopts this server and vice versa.
            proc = self.popen([str(self.cfg.python), "-m", "uvicorn", "app.main:app", "--host", HOST,
                               "--port", str(self.cfg.port), "--no-access-log"],
                              cwd=str(self.cfg.root), env=env, creationflags=_DETACHED | _NEW_GROUP | _NO_WINDOW,
                              stdin=subprocess.DEVNULL, stdout=log, stderr=log, close_fds=True)
        h = self._wait_health(self.clock() + deadline_seconds, process=proc)
        pid = listener_pid(self.cfg.port, self.ps)
        if h and pid and pid in self._family(proc.pid) and h.get("version") == expected:
            self._write_marker(pid, expected)
            self.owned_pid = pid
            return {"state": "started", "url": self.cfg.url, "pid": pid, "version": expected, "owned": True, "note": ""}
        exited = proc.poll() is not None
        if not exited:
            try:
                proc.terminate()
            except OSError:
                pass
        if h or (pid and pid not in self._family(proc.pid)):
            raise _PortTaken()                  # another launcher (e.g. Panel) won the port; reuse it
        tail = ""
        try:
            tail = log_path.read_bytes()[-900:].decode("utf-8", "replace").strip()
        except OSError:
            pass
        raise ServiceError("Kinema did not become ready. " + (tail[-600:] or "The server exited or took too long."))


class _PortTaken(Exception):
    pass


# ── Windows helpers ───────────────────────────────────────────────────────────────────────────────

def set_app_identity(app_id: str = APP_ID) -> bool:
    if os.name != "nt":
        return False
    import ctypes
    setter = ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID
    setter.argtypes = [ctypes.c_wchar_p]
    setter.restype = ctypes.c_long
    return setter(app_id) == 0


class Instance:
    """Named-mutex single instance with a named activation event (no ports, no files needed)."""
    WAIT_OBJECT_0, WAIT_ABANDONED, WAIT_TIMEOUT = 0, 0x80, 0x102

    def __init__(self, cfg: Config):
        import ctypes
        from ctypes import wintypes
        self.k = ctypes.WinDLL("kernel32", use_last_error=True)
        self.k.CreateMutexW.restype = wintypes.HANDLE
        self.k.CreateEventW.restype = wintypes.HANDLE
        self.k.CreateMutexW.argtypes = [wintypes.LPVOID, wintypes.BOOL, wintypes.LPCWSTR]
        self.k.CreateEventW.argtypes = [wintypes.LPVOID, wintypes.BOOL, wintypes.BOOL, wintypes.LPCWSTR]
        self.k.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        self.k.SetEvent.argtypes = self.k.ReleaseMutex.argtypes = self.k.CloseHandle.argtypes = [wintypes.HANDLE]
        self.cfg = cfg
        self.mutex = self.k.CreateMutexW(None, False, cfg.name(WINDOW_MUTEX))
        self.activate = self.k.CreateEventW(None, False, False, cfg.name(ACTIVATE_EVENT))
        self.ack = self.k.CreateEventW(None, False, False, cfg.name(ACK_EVENT))
        self.request = cfg.state_dir / "activate.json"
        self.owner = False

    def claim(self, timeout_ms: int = 0) -> bool:
        self.owner = self.k.WaitForSingleObject(self.mutex, timeout_ms) in (self.WAIT_OBJECT_0, self.WAIT_ABANDONED)
        return self.owner

    def hand_over(self, path: str) -> bool:
        """Ask the running window to come forward (optionally at path). True when it acknowledged."""
        import ctypes
        try:
            ctypes.windll.user32.AllowSetForegroundWindow(-1)   # ASFW_ANY: this launch may pass focus on
            self.cfg.state_dir.mkdir(parents=True, exist_ok=True)
            self.request.write_text(json.dumps({"path": path, "ts": time.time()}), encoding="utf-8")
        except Exception:
            pass
        self.k.SetEvent(self.activate)
        return self.k.WaitForSingleObject(self.ack, 5000) == self.WAIT_OBJECT_0

    def wait_activation(self, timeout_ms: int = 1000) -> bool:
        return self.k.WaitForSingleObject(self.activate, timeout_ms) == self.WAIT_OBJECT_0

    def acknowledge(self) -> None:
        self.k.SetEvent(self.ack)

    def requested_path(self) -> str:
        try:
            req = json.loads(self.request.read_text(encoding="utf-8"))
            self.request.unlink()
            return safe_path(req.get("path")) if time.time() - float(req.get("ts", 0)) < 30 else "/"
        except Exception:
            return "/"


def safe_path(path: str | None) -> str:
    return path if isinstance(path, str) and _SAFE_PATH.match(path) and ".." not in path and "//" not in path else "/"


def window_handle(title: str = "Kinema", pid: int | None = None) -> int | None:
    """The top-level window with this title owned by this process (works from any thread)."""
    if os.name != "nt":
        return None
    import ctypes
    from ctypes import wintypes
    user32, pid, found = ctypes.windll.user32, pid or os.getpid(), []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def visit(hwnd, _):
        owner = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if owner.value == pid:
            buf = ctypes.create_unicode_buffer(256)
            user32.GetWindowTextW(hwnd, buf, 256)
            if buf.value == title:
                found.append(hwnd)
                return False
        return True
    user32.EnumWindows(visit, 0)
    return found[0] if found else None


def dark_title_bar(hwnd: int, color: str = BACKGROUND) -> None:
    import ctypes
    r, g, b = (int(color[i:i + 2], 16) for i in (1, 3, 5))
    for attribute, value in ((20, 1), (35, r | g << 8 | b << 16), (36, 0x00E8E2DA)):
        v = ctypes.c_int(value)
        ctypes.windll.dwmapi.DwmSetWindowAttribute(hwnd, attribute, ctypes.byref(v), ctypes.sizeof(v))


def bring_forward(hwnd: int) -> None:
    import ctypes
    user32 = ctypes.windll.user32
    if user32.IsIconic(hwnd):
        user32.ShowWindow(hwnd, 9)                 # SW_RESTORE
    user32.SetForegroundWindow(hwnd)


def virtual_screen() -> tuple[int, int, int, int]:
    if os.name != "nt":
        return (0, 0, 1920, 1080)
    import ctypes
    m = ctypes.windll.user32.GetSystemMetrics
    return (m(76), m(77), m(78), m(79))          # SM_X/YVIRTUALSCREEN, SM_CX/CYVIRTUALSCREEN


# ── placement ─────────────────────────────────────────────────────────────────────────────────────

def load_placement(state_dir: Path, screen=None) -> dict:
    """Saved size/position, clamped to the minimum size and dropped when it would be off every screen."""
    sx, sy, sw, sh = screen or virtual_screen()
    out = {"width": DEFAULT_SIZE[0], "height": DEFAULT_SIZE[1], "x": None, "y": None, "maximized": False}
    try:
        saved = json.loads((Path(state_dir) / "window.json").read_text(encoding="utf-8"))
    except Exception:
        return out
    try:
        w, h = max(MIN_SIZE[0], int(saved["width"])), max(MIN_SIZE[1], int(saved["height"]))
        out.update(width=min(w, max(MIN_SIZE[0], sw)), height=min(h, max(MIN_SIZE[1], sh)),
                   maximized=bool(saved.get("maximized")))
        x, y = saved.get("x"), saved.get("y")
        if x is not None and y is not None:
            x, y = int(x), int(y)
            # keep at least the title bar reachable on the virtual screen
            if sx - out["width"] + 120 <= x <= sx + sw - 120 and sy <= y <= sy + sh - 60:
                out.update(x=x, y=y)
    except (TypeError, ValueError, KeyError):
        pass
    return out


def save_placement(state_dir: Path, placement: dict) -> None:
    state_dir = Path(state_dir)
    state_dir.mkdir(parents=True, exist_ok=True)
    tmp = state_dir / "window.tmp"
    tmp.write_text(json.dumps(placement), encoding="utf-8")
    os.replace(tmp, state_dir / "window.json")


# ── the window ────────────────────────────────────────────────────────────────────────────────────

def status_html(title: str, body: str = "", retry: bool = False) -> str:
    button = ('<button onclick="this.disabled=true;window.pywebview.api.retry()">Try again</button>' if retry else "")
    return f"""<!doctype html><meta charset="utf-8"><title>Kinema</title>
<style>html,body{{margin:0;height:100%;background:{BACKGROUND};color:#e6e9ee;font:15px/1.5 "Segoe UI",system-ui,sans-serif}}
main{{height:100%;display:grid;place-content:center;justify-items:center;gap:10px;text-align:center;padding:0 24px}}
h1{{margin:0;font-size:17px;font-weight:600}}p{{margin:0;max-width:520px;color:#9aa3ae}}
.dot{{width:9px;height:9px;border-radius:50%;background:#a8cbfb;animation:p 1.1s ease-in-out infinite}}
@keyframes p{{50%{{opacity:.25}}}}button{{margin-top:6px;background:#a8cbfb;color:#0b0d10;border:0;border-radius:8px;
padding:8px 16px;font:inherit;font-weight:600;cursor:pointer}}button:disabled{{opacity:.5}}</style>
<main>{'' if retry else '<div class="dot"></div>'}<h1>{html.escape(title)}</h1><p>{html.escape(body)}</p>{button}</main>"""


class _Api:
    """The only thing the status page can call. pywebview exposes every public attribute of js_api."""
    def __init__(self, retry):
        self._retry = retry

    def retry(self):
        self._retry()


class WindowApp:
    def __init__(self, cfg: Config, service: Service, webview, instance: Instance | None, path: str = "/"):
        self.cfg, self.service, self.webview, self.instance = cfg, service, webview, instance
        self.path = safe_path(path)
        self.window = None
        self.lock = threading.Lock()
        self.connect_lock = threading.Lock()
        self.browser_ready = threading.Event()
        self.initial_connect_started = False
        self.hidden_since: float | None = None
        self.blank = False
        self.stopping = self.quitting = False
        self.maximized = False
        self.placement = load_placement(cfg.state_dir)
        self.note = ""

    def retry(self):
        threading.Thread(target=self._connect, daemon=True).start()

    def _startup_state(self, state: str):
        # Small diagnostics survive pythonw (which has no console); never store URLs or account data.
        try:
            self.cfg.state_dir.mkdir(parents=True, exist_ok=True)
            (self.cfg.state_dir / "startup.json").write_text(json.dumps({
                "pid": os.getpid(), "ts": time.time(), "state": state,
                "version": source_version(self.cfg.root)}), encoding="utf-8")
        except OSError:
            pass

    def _on_loaded(self):
        self.browser_ready.set()
        with self.lock:
            first = not self.initial_connect_started
            self.initial_connect_started = True
        if first:
            self.retry()
        elif self.window.get_current_url() == self.cfg.url + self.path:
            self._startup_state("ready")

    def _connect(self):
        if not self.browser_ready.is_set() or not self.connect_lock.acquire(blocking=False):
            return
        try:
            self._startup_state("connecting")
            result = self.service.ensure()
            self.note = result.get("note", "")
            if result.get("state") == "kept_outdated":
                self.window.load_html(status_html("Kinema is finishing a reply", self.note))
                time.sleep(3)
            self._startup_state("navigating")
            self.window.load_url(self.cfg.url + self.path)
        except Exception as exc:                                    # shown, never silently retried
            self._startup_state("error")
            self.window.load_html(status_html("Kinema could not start", str(exc)[-500:], retry=True))
        finally:
            self.connect_lock.release()

    def _remember(self):
        try:
            if self.maximized:
                saved = dict(self.placement, maximized=True)
            else:
                saved = {"x": self.window.x, "y": self.window.y, "width": self.window.width,
                         "height": self.window.height, "maximized": False}
            self.placement = saved
            save_placement(self.cfg.state_dir, saved)
        except Exception:
            pass

    def on_closing(self):
        if self.quitting:
            return True
        self._remember()
        threading.Thread(target=self._hide, daemon=True).start()
        return False                                                # cancel: hide, keep jobs and server

    def _hide(self):
        with self.lock:
            self.window.hide()
            self.hidden_since = time.monotonic()
            self.window.load_url("about:blank")                     # stop page polling while closed
            self.blank = True

    def show(self, path: str = "/"):
        with self.lock:
            if self.stopping or self.quitting:
                return False
            self.hidden_since = None
            if self.blank or path != "/":
                self.blank = False
                threading.Thread(target=self._reopen, args=(path,), daemon=True).start()
            self.window.show()
            if self.maximized:
                self.window.maximize()
        hwnd = window_handle()
        if hwnd:
            bring_forward(hwnd)
        return True

    def _reopen(self, path: str):
        # A reopen picks up the newest installed version (replace-when-idle runs again).
        self.path = safe_path(path)
        self._connect()

    def _activation_loop(self):
        while not self.quitting:
            if self.instance.wait_activation(1000):
                path = self.instance.requested_path()
                if self.show(path):
                    self.instance.acknowledge()

    def idle_tick(self, now: float | None = None) -> bool:
        """One shutdown check while hidden. Returns True when the app should quit."""
        now = time.monotonic() if now is None else now
        with self.lock:
            if self.hidden_since is None or now - self.hidden_since < CLOSE_GRACE:
                return False
            if not self.service.owned():
                return True                                         # not ours to stop: just leave
            if not self.service.idle():
                return False                                        # a tutor reply is still running
            self.stopping = True
        try:
            done = self.service.stop_owned_if_idle() or self.service.owned() is None
        except Exception:
            done = True                                             # never kill harder; leave it running
        if not done:
            with self.lock:
                self.stopping = False                               # still busy: stay reopenable
        return done

    def _idle_loop(self):
        while not self.quitting:
            time.sleep(IDLE_POLL)
            if self.idle_tick():
                self.quit()

    def quit(self):
        with self.lock:
            self.quitting = True
        try:
            self.window.destroy()
        except Exception:
            pass

    def _on_shown(self):
        hwnd = window_handle()
        if hwnd:
            try:
                dark_title_bar(hwnd)
            except Exception:
                pass

    def run(self, *, hidden: bool = False, debug: bool = False):
        wv, p = self.webview, self.placement
        try:
            wv.settings["ALLOW_DOWNLOADS"] = True
            if os.environ.get("KINEMA_WINDOW_DEBUG_PORT"):          # hidden smoke checks only
                wv.settings["REMOTE_DEBUGGING_PORT"] = int(os.environ["KINEMA_WINDOW_DEBUG_PORT"])
        except Exception:
            pass
        self.window = wv.create_window("Kinema", html=status_html("Opening Kinema"), js_api=_Api(self.retry),
                                       width=p["width"], height=p["height"], x=p["x"], y=p["y"],
                                       maximized=p["maximized"], min_size=MIN_SIZE, hidden=hidden,
                                       background_color=BACKGROUND, text_select=True)
        self.maximized = p["maximized"]
        self.window.events.closing += self.on_closing
        self.window.events.shown += self._on_shown
        # 'shown' is only the native form. Wait for the splash's actual browser
        # load before navigating; starting before wv.start races GUI initialization
        # and its fixed API timeout can strand a later-created splash forever.
        self.window.events.loaded += self._on_loaded
        self.window.events.maximized += lambda: setattr(self, "maximized", True)
        self.window.events.restored += lambda: setattr(self, "maximized", False)
        if self.instance:
            threading.Thread(target=self._activation_loop, daemon=True).start()
        threading.Thread(target=self._idle_loop, daemon=True).start()
        self._startup_state("waiting_for_browser")
        self.cfg.state_dir.mkdir(parents=True, exist_ok=True)
        icon = self.cfg.root / "static" / "icons" / "kinema.ico"
        wv.start(private_mode=False, storage_path=str(self.cfg.state_dir / "webview"),
                 icon=str(icon) if icon.is_file() else None, debug=debug)
        self.quitting = True


def identity(cfg: Config) -> dict:
    """Read-only status: what is on the port and whether it is this installation's Kinema."""
    pid = listener_pid(cfg.port)
    h = health(cfg)
    canonical = False
    if pid:
        try:
            canonical = is_canonical(_psutil().Process(pid), cfg)
        except Exception:
            pass
    return {"root": str(cfg.root), "port": cfg.port, "installed": source_version(cfg.root), "pid": pid,
            "canonical": canonical, "running": h.get("version") if h else None,
            "owned_by_window": Service(cfg).owned() is not None if pid else False}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Open Kinema in its own window.")
    ap.add_argument("--path", default="/", help="page to open, e.g. /?view=daily")
    ap.add_argument("--service", action="store_true", help="make sure the server runs, print JSON, no window")
    ap.add_argument("--status", action="store_true", help="read-only identity JSON")
    ap.add_argument("--hidden", action="store_true", help="create the window hidden (smoke checks)")
    args = ap.parse_args(argv)
    cfg = Config.from_env()
    if args.status:
        print(json.dumps(identity(cfg)))
        return 0
    if is_elevated():
        try:
            return _launch_as_desktop(cfg, list(argv) if argv is not None else sys.argv[1:], service=args.service)
        except (OSError, ValueError, TimeoutError, ServiceError) as exc:
            print(json.dumps({"state": "error", "error": str(exc)}))
            return 1
    if args.service:
        try:
            print(json.dumps(_service_locked(cfg)))
            return 0
        except ServiceError as exc:
            print(json.dumps({"state": "error", "error": str(exc)}))
            return 1
    identity_set = set_app_identity()                   # before any window exists
    instance = Instance(cfg)
    if not instance.claim():
        if instance.hand_over(safe_path(args.path)):
            return 0
        if not instance.claim(30000):                   # the old window was quitting; take over
            return 1
    try:
        cfg.state_dir.mkdir(parents=True, exist_ok=True)
        (cfg.state_dir / "launch.json").write_text(json.dumps({"pid": os.getpid(), "ts": time.time(), "app_id": APP_ID,
                                                              "app_id_set": identity_set}), encoding="utf-8")
    except OSError:
        pass
    import webview
    service = Service(cfg)
    WindowApp(cfg, _LockedService(service), webview, instance, args.path).run(hidden=args.hidden)
    return 0


def _named_mutex(name: str):
    import ctypes
    from ctypes import wintypes
    k = ctypes.WinDLL("kernel32")
    k.CreateMutexW.restype = wintypes.HANDLE
    k.CreateMutexW.argtypes = [wintypes.LPVOID, wintypes.BOOL, wintypes.LPCWSTR]
    k.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    k.ReleaseMutex.argtypes = k.CloseHandle.argtypes = [wintypes.HANDLE]
    return k, k.CreateMutexW(None, False, name)


def is_elevated() -> bool:
    if os.name != "nt":
        return False
    import ctypes
    return bool(ctypes.windll.shell32.IsUserAnAdmin())


def _launch_as_desktop(cfg: Config, argv: list[str], *, service: bool) -> int:
    """An elevated caller hands off before creating either a window or server."""
    from app.windows_user import spawn_limited
    env = os.environ.copy()
    for key in ("PYTHONHOME", "PYTHONPATH", "VIRTUAL_ENV", "CONDA_PREFIX", "__COMPAT_LAYER"):
        env.pop(key, None)
    env.update(KINEMA_WINDOW_ROOT=str(cfg.root), KINEMA_WINDOW_DATA=str(cfg.data),
               KINEMA_WINDOW_PORT=str(cfg.port), KINEMA_WINDOW_PYTHON=str(cfg.python),
               KINEMA_WINDOW_INSTANCE=cfg.suffix)
    child = spawn_limited([str(cfg.python), str(cfg.root / "Kinema.pyw"), *argv], cwd=cfg.root, env=env)
    try:
        try:
            code = child.wait(50 if service else 2)
        except TimeoutError:
            if service:
                raise
            return 0  # normal window is still running; never kill it after a timeout
    finally:
        child.close()
    if service and code == 0:
        state = identity(cfg)
        if not state["canonical"] or not state["running"]:
            raise ServiceError("Kinema's normal-user server did not become ready.")
        print(json.dumps({"state": "ready", "pid": state["pid"], "version": state["running"], "url": cfg.url}))
    return code


def _require_user_launch() -> None:
    # A normal taskbar window cannot inspect an administrator-started server.
    # Keep both at the desktop user's level; do not weaken process identity checks.
    if is_elevated():
        raise ServiceError("Open Kinema normally from the taskbar or Start menu, without Run as administrator. "
                           "Kinema's server was not started or changed.")


def _service_locked(cfg: Config, service: Service | None = None) -> dict:
    """Serialize start/replace across launcher processes (window, --service, reminder)."""
    _require_user_launch()  # before creating a mutex owned by an elevated process
    service = service or Service(cfg)
    if os.name != "nt":
        return service.ensure()
    k, h = _named_mutex(cfg.name(SERVICE_MUTEX))
    acquired = k.WaitForSingleObject(h, 60000)
    if acquired not in (Instance.WAIT_OBJECT_0, Instance.WAIT_ABANDONED):
        k.CloseHandle(h)
        raise ServiceError("Another Kinema launch is still starting. Try again in a moment.")
    try:
        return service.ensure()
    finally:
        k.ReleaseMutex(h)
        k.CloseHandle(h)


class _LockedService:
    """Service proxy whose ensure() holds the cross-process service mutex."""
    def __init__(self, service: Service):
        self._s = service

    def ensure(self, **kw):
        return _service_locked(self._s.cfg, self._s)

    def __getattr__(self, name):
        return getattr(self._s, name)


if __name__ == "__main__":
    raise SystemExit(main())
