"""Kinema self-update from GitHub Releases: check, one-click download, checksum, swap the code, restart.

Owner (2026-10-16): Kinema may run on a whole class's laptops and nobody will push updates by hand, so the app updates
itself. Rules:
- Off until a repo is configured (content/update_config.json or KINEMA_UPDATE_REPO).
- Only the user's click downloads or installs; Settings may check for a new version in the background (once a day).
- A release must carry a kinema-<version>.zip and its SHA-256 (a <zip>.sha256 or SHA256SUMS asset); no checksum, no
  install.
- Only code is replaced. data/, the virtualenv, .git and backups are never touched; the replaced code is kept in
  .kinema-update/backup-<old version>/ and every move is rolled back if one fails.
- Network and restart go through _http_json/_download/_restart so tests never touch the network or the process.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

ROOT = Path(__file__).resolve().parents[1]
CONTENT = Path(__file__).resolve().parent / "content"
router = APIRouter()
PROTECTED = {"data", ".venv", "venv", ".git", "backups", ".kinema-update", "__pycache__"}
REPO_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
MAX_ZIP = 300 * 1024 * 1024
CHECK_EVERY = 24 * 3600
_lock = threading.RLock()
_job: dict = {"state": "idle"}


class UpdateError(RuntimeError):
    """A plain-words reason the update stopped; nothing was changed unless it says so."""


# ── configuration and state ─────────────────────────────────────────────────────────────────────────────────────
def repo() -> str:
    env = os.environ.get("KINEMA_UPDATE_REPO")
    if env is not None:
        r = env.strip()
    else:
        try:
            r = str(json.loads((CONTENT / "update_config.json").read_text(encoding="utf-8")).get("repo") or "").strip()
        except (OSError, ValueError):
            r = ""
    return r if REPO_RE.match(r) else ""


def current_version() -> str:
    from .main import VERSION
    return VERSION


def vtuple(v: str) -> tuple[int, ...]:
    m = re.match(r"^v?(\d+(?:\.\d+){0,3})", str(v or "").strip())
    return tuple(int(x) for x in m.group(1).split(".")) if m else ()


def _state_path() -> Path:
    from .main import DATA
    return Path(DATA) / "update_state.json"


def _read_state() -> dict:
    try:
        d = json.loads(_state_path().read_text(encoding="utf-8"))
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def _write_state(d: dict) -> None:
    p = _state_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(d), encoding="utf-8")
    tmp.replace(p)


# ── network seams (tests replace these) ─────────────────────────────────────────────────────────────────────────
def _http_json(url: str, timeout: float = 10.0) -> dict:
    req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json", "User-Agent": "Kinema-self-update"})
    with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 - fixed https GitHub API URL
        return json.loads(r.read(2 * 1024 * 1024).decode("utf-8"))


def _download(url: str, dest: Path, progress=None, timeout: float = 30.0) -> None:
    req = urllib.request.Request(url, headers={"Accept": "application/octet-stream", "User-Agent": "Kinema-self-update"})
    with urllib.request.urlopen(req, timeout=timeout) as r, dest.open("wb") as f:  # noqa: S310
        total = int(r.headers.get("Content-Length") or 0) or None
        done = 0
        while chunk := r.read(1 << 16):
            done += len(chunk)
            if done > MAX_ZIP:
                raise UpdateError("The update file is unexpectedly large, so it was not installed.")
            f.write(chunk)
            if progress:
                progress(done, total)


def _download_text(url: str) -> str:
    req = urllib.request.Request(url, headers={"Accept": "application/octet-stream", "User-Agent": "Kinema-self-update"})
    with urllib.request.urlopen(req, timeout=15) as r:  # noqa: S310
        return r.read(64 * 1024).decode("utf-8", "replace")


# ── check ───────────────────────────────────────────────────────────────────────────────────────────────────────
def _assets(rel: dict) -> tuple[dict | None, dict | None]:
    assets = [a for a in rel.get("assets") or [] if isinstance(a, dict) and a.get("name") and a.get("browser_download_url")]
    zips = [a for a in assets if re.match(r"^kinema[-_].*\.zip$", a["name"], re.I)]
    z = zips[0] if zips else None
    if not z:
        return None, None
    sums = [a for a in assets if a["name"] in (z["name"] + ".sha256", "SHA256SUMS", "SHA256SUMS.txt", "checksums.txt")]
    return z, (sums[0] if sums else None)


def check() -> dict:
    """Ask GitHub for the latest release. Records the result; never installs."""
    r = repo()
    if not r:
        return status()
    st = _read_state()
    try:
        rel = _http_json(f"https://api.github.com/repos/{r}/releases/latest")
        if not isinstance(rel, dict) or rel.get("draft") or rel.get("prerelease"):
            raise UpdateError("No published release yet.")
        latest = str(rel.get("tag_name") or "").lstrip("v")
        if not vtuple(latest):
            raise UpdateError("The latest release has no version number.")
        z, s = _assets(rel)
        st["latest"] = {"version": latest, "name": str(rel.get("name") or "")[:120], "notes": str(rel.get("body") or "")[:4000],
                        "published": str(rel.get("published_at") or ""), "url": str(rel.get("html_url") or ""),
                        "zip": z and {"name": z["name"], "url": z["browser_download_url"], "size": int(z.get("size") or 0)},
                        "sums": s and {"name": s["name"], "url": s["browser_download_url"]}}
        st["error"] = ""
    except UpdateError as exc:
        st["error"] = str(exc)
    except Exception as exc:  # noqa: BLE001 - offline, rate limited, bad JSON: say so, change nothing
        st["error"] = f"Could not check for updates ({type(exc).__name__})."
    st["checked_ts"] = time.time()
    st["repo"] = r
    _write_state(st)
    return status()


def check_if_due() -> None:
    """Settings opens: check in the background at most once a day."""
    if not repo() or _job.get("state") in ("checking", "downloading", "verifying", "installing", "restarting"):
        return
    st = _read_state()
    if st.get("repo") == repo() and time.time() - float(st.get("checked_ts") or 0) < CHECK_EVERY:
        return

    def run():
        with _lock:
            if _job.get("state") not in ("idle", "done", "error"):
                return
            _job.update(state="checking")
        try:
            check()
        finally:
            with _lock:
                if _job.get("state") == "checking":
                    _job.update(state="idle")
    threading.Thread(target=run, name="kinema-update-check", daemon=True).start()


def status() -> dict:
    r = repo()
    cur = current_version()
    out = {"enabled": bool(r), "repo": r, "current": cur, "job": dict(_job)}
    if not r:
        out["state"] = "off"
        return out
    st = _read_state()
    if st.get("repo") != r:
        st = {}
    latest = st.get("latest") or {}
    out.update(checked_ts=st.get("checked_ts"), error=st.get("error", ""), installed_from=st.get("installed_from"))
    if latest:
        out["latest"] = {k: latest.get(k) for k in ("version", "name", "notes", "published", "url")}
        out["installable"] = bool(latest.get("zip") and latest.get("sums"))
    if _job.get("state") not in (None, "idle", "done", "error", "checking"):
        out["state"] = "working"
    elif latest and vtuple(latest.get("version")) > vtuple(cur):
        out["state"] = "available"
    elif st.get("error") and not latest:
        out["state"] = "error"
    elif st.get("checked_ts"):
        out["state"] = "current"
    else:
        out["state"] = "unchecked"
    return out


# ── install ─────────────────────────────────────────────────────────────────────────────────────────────────────
def _expected_sha(sums_text: str, zip_name: str) -> str:
    for line in sums_text.splitlines():
        parts = line.strip().split()
        if not parts:
            continue
        h = parts[0].lower()
        if re.fullmatch(r"[0-9a-f]{64}", h) and (len(parts) == 1 or parts[-1].lstrip("*") == zip_name):
            return h
    raise UpdateError("The release checksum file does not list this download, so it was not installed.")


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()


def _extract(zpath: Path, dest: Path) -> Path:
    """Unpack safely and return the folder that holds app/main.py (GitHub zips may wrap everything in one folder)."""
    with zipfile.ZipFile(zpath) as z:
        names = z.namelist()
        for n in names:
            pp = PurePosixPath(n.replace("\\", "/"))
            if pp.is_absolute() or ".." in pp.parts or (pp.parts and ":" in pp.parts[0]):
                raise UpdateError("The update file has unsafe paths, so it was not installed.")
        z.extractall(dest)
    roots = [dest] + [p for p in dest.iterdir() if p.is_dir()]
    for r in roots:
        if (r / "app" / "main.py").is_file() and (r / "static").is_dir():
            return r
    raise UpdateError("The update file is not a Kinema build, so it was not installed.")


def _swap(new_root: Path, backup: Path) -> list[str]:
    """Move each top-level code entry aside and the new one into place; undo everything if any move fails."""
    moved: list[tuple[Path, Path | None]] = []
    names = sorted(p.name for p in new_root.iterdir() if p.name not in PROTECTED)
    backup.mkdir(parents=True, exist_ok=True)
    try:
        for name in names:
            target, old = ROOT / name, None
            if target.exists():
                old = backup / name
                if old.exists():
                    shutil.rmtree(old) if old.is_dir() else old.unlink()
                os.replace(target, old)
            moved.append((target, old))
            os.replace(new_root / name, target)
    except OSError as exc:
        for target, old in reversed(moved):
            try:
                if target.exists():
                    shutil.rmtree(target) if target.is_dir() else target.unlink()
                if old is not None and old.exists():
                    os.replace(old, target)
            except OSError:
                pass
        raise UpdateError(f"A file was in use, so the update was undone ({exc.__class__.__name__}). Close Kinema elsewhere and try again.") from None
    return names


def _set(**kw) -> None:
    with _lock:
        _job.update(kw)


def install() -> dict:
    """Download, verify, swap. Runs in the update thread; returns the result written to the state file."""
    st = _read_state()
    latest = st.get("latest") or {}
    if st.get("repo") != repo() or not latest:
        raise UpdateError("Check for updates first.")
    cur = current_version()
    if vtuple(latest.get("version")) <= vtuple(cur):
        raise UpdateError("Kinema is already up to date.")
    if not latest.get("zip") or not latest.get("sums"):
        raise UpdateError("This release has no checksum, so Kinema won't install it.")
    work = ROOT / ".kinema-update"
    work.mkdir(exist_ok=True)
    ver = re.sub(r"[^0-9A-Za-z.]", "", latest["version"])
    zpath, unpack = work / f"kinema-{ver}.zip", work / f"new-{ver}"
    if unpack.exists():
        shutil.rmtree(unpack)
    _set(state="downloading", progress=0)
    _download(latest["zip"]["url"], zpath, lambda done, total: _set(progress=round(done / total, 3) if total else None))
    _set(state="verifying", progress=None)
    want = _expected_sha(_download_text(latest["sums"]["url"]), latest["zip"]["name"])
    got = _sha256(zpath)
    if got != want:
        zpath.unlink(missing_ok=True)
        raise UpdateError("The download did not match its checksum, so it was not installed.")
    _set(state="installing")
    new_root = _extract(zpath, unpack)
    old_reqs = (ROOT / "requirements.txt").read_bytes() if (ROOT / "requirements.txt").is_file() else b""
    names = _swap(new_root, work / f"backup-{re.sub(r'[^0-9A-Za-z.]', '', cur)}")
    new_reqs = (ROOT / "requirements.txt").read_bytes() if (ROOT / "requirements.txt").is_file() else b""
    shutil.rmtree(unpack, ignore_errors=True)
    zpath.unlink(missing_ok=True)
    st.update(installed_from=cur, installed=ver, installed_ts=time.time(), replaced=names)
    _write_state(st)
    return {"version": ver, "replaced": names, "requirements_changed": old_reqs != new_reqs}


def _restart(requirements_changed: bool) -> None:
    """Start a detached helper that waits for this process to end, refreshes requirements if they changed, then starts
    Kinema again with the same command; then this process exits."""
    helper = r'''
import os, subprocess, sys, time, json
pid, cwd, argv, reqs = int(sys.argv[1]), sys.argv[2], json.loads(sys.argv[3]), sys.argv[4] == "1"
deadline = time.time() + 60
if os.name == "nt":
    import ctypes
    h = ctypes.windll.kernel32.OpenProcess(0x00100000, False, pid)
    if h:
        ctypes.windll.kernel32.WaitForSingleObject(h, 60000); ctypes.windll.kernel32.CloseHandle(h)
else:
    while time.time() < deadline:
        try: os.kill(pid, 0); time.sleep(0.3)
        except OSError: break
if reqs:
    subprocess.call([argv[0], "-m", "pip", "install", "--quiet", "--disable-pip-version-check", "-r", "requirements.txt"], cwd=cwd)
flags = 0x00000008 | 0x00000200 | 0x08000000 if os.name == "nt" else 0
subprocess.Popen(argv, cwd=cwd, creationflags=flags, close_fds=True)
'''
    argv = [sys.executable] + list(getattr(sys, "orig_argv", sys.argv)[1:])
    flags = 0x00000008 | 0x00000200 | 0x08000000 if os.name == "nt" else 0
    subprocess.Popen([sys.executable, "-c", helper, str(os.getpid()), str(Path.cwd()), json.dumps(argv), "1" if requirements_changed else "0"],
                     cwd=str(ROOT), creationflags=flags, close_fds=True)
    threading.Timer(1.0, lambda: os._exit(0)).start()


def start_install() -> dict:
    with _lock:
        if _job.get("state") in ("checking", "downloading", "verifying", "installing", "restarting"):
            return status()
        _job.clear()
        _job.update(state="downloading", progress=0, error="")

    def run():
        try:
            res = install()
            _set(state="restarting", version=res["version"])
            _restart(res["requirements_changed"])
        except UpdateError as exc:
            _set(state="error", error=str(exc))
        except Exception as exc:  # noqa: BLE001 - network or disk: nothing was swapped unless _swap said so
            _set(state="error", error=f"The update stopped ({type(exc).__name__}). Kinema is unchanged.")
    threading.Thread(target=run, name="kinema-update", daemon=True).start()
    return status()


# ── API ─────────────────────────────────────────────────────────────────────────────────────────────────────────
@router.get("/api/update")
def api_status(request: Request):
    from .provider_connections import guard
    guard(request)
    check_if_due()
    return JSONResponse(status(), headers={"Cache-Control": "no-store"})


@router.post("/api/update/check")
async def api_check(request: Request):
    from .provider_connections import _connection_body
    try:
        await _connection_body(request)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    return status() if not repo() else check()


@router.post("/api/update/install")
async def api_install(request: Request):
    from .provider_connections import _connection_body
    try:
        await _connection_body(request)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    if status().get("state") != "available":
        return JSONResponse({"error": "There is no update to install.", **status()}, status_code=400)
    return start_install()
