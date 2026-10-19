"""Recent screenshots taken on this PC, offered as one-click chat attachments.

Read-only. Listing returns opaque per-process IDs; a thumbnail or the file is
served only for an ID this process listed, and only while that file is
unchanged and still inside a current screenshot folder. Paths never leave the
server and nothing from the client is ever used as a path.

Folders: Windows known folders (Screenshots, which follows a redirected
Pictures; Pictures\\Screenshots; OneDrive Screenshots; Game Bar Captures).
KINEMA_SCREENSHOT_DIRS (os.pathsep-separated) replaces discovery, e.g. for tests.
Access is restricted to the local app, with same-origin browser requests.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
import stat as stat_mod
import sys
import threading
import time
from collections import OrderedDict
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, Response

from io import BytesIO
from PIL import Image, UnidentifiedImageError
from urllib.parse import urlsplit
import ipaddress
import warnings

def local_request(request: Request):
    host = request.url.hostname or ""
    try: local_host = host == "localhost" or ipaddress.ip_address(host).is_loopback
    except ValueError: local_host = False
    try: local_peer = ipaddress.ip_address(request.client.host).is_loopback
    except (ValueError, AttributeError): local_peer = False
    origin = request.headers.get("origin")
    same_origin = not origin or origin.rstrip("/") == str(request.base_url).rstrip("/")
    if not local_host or not local_peer or not same_origin or request.headers.get("sec-fetch-site") == "cross-site":
        raise HTTPException(403, "Open screenshots in the Kinema app on this computer.")

router = APIRouter(prefix="/api/screenshots", tags=["screenshots"], dependencies=[Depends(local_request)])
_decode_lock = threading.Lock()

def _thumbnail(data):
    try:
        with _decode_lock, warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as picture:
                if picture.width * picture.height > 40_000_000:
                    raise ValueError("oversized")
                picture.thumbnail((480, 300))
                out = BytesIO()
                picture.convert("RGB").save(out, format="PNG")
                return out.getvalue()
    except (OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise HTTPException(415, "This image could not be previewed.") from None


ENV_DIRS = "KINEMA_SCREENSHOT_DIRS"
IMAGE_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}
MAX_ITEMS = 12
WINDOW_S = 24 * 3600
FUTURE_SKEW_S = 300           # a file stamped slightly ahead of this clock still counts
MAX_FILE_BYTES = 20_000_000   # the /api/chat/upload limit
MAX_SCAN_ENTRIES = 200_000    # per folder; names sort by date, so the cap is only a runaway guard
DIRS_TTL_S = 60
INDEX_ENTRIES = 96
THUMB_ENTRIES = 48
THUMB_BYTES = 8 * 1024 * 1024
ID_RE = re.compile(r"[0-9a-f]{32}")

# Known folders. Screenshots follows the user's redirected Pictures folder.
FOLDERID_SCREENSHOTS = "{B7BEDE81-DF94-4682-A7D8-57A52620B86F}"
FOLDERID_PICTURES = "{33E28130-4E1E-4676-835A-98395C3BC3BB}"
FOLDERID_CAPTURES = "{EDC0FE71-98D8-4F4A-B920-C8DC133CB165}"
KF_FLAG_DONT_VERIFY = 0x00004000

# Hidden/system files and cloud placeholders (reading one would start a download).
_SKIP_ATTRIBUTES = 0x2 | 0x4 | 0x1000 | 0x40000 | 0x400000

_KEY = secrets.token_bytes(32)
_lock = threading.Lock()
_index: OrderedDict[str, tuple] = OrderedDict()      # id -> (path, folder, name, stamp)
_thumbs: OrderedDict[str, tuple[bytes, str]] = OrderedDict()
_thumb_bytes = 0
_dirs_cache: tuple[float, list[str]] = (0.0, [])


def _known_folder(guid: str) -> str | None:
    if sys.platform != "win32":
        return None
    try:
        import ctypes
        import uuid
        from ctypes import wintypes

        class GUID(ctypes.Structure):
            _fields_ = [("Data1", wintypes.DWORD), ("Data2", wintypes.WORD),
                        ("Data3", wintypes.WORD), ("Data4", ctypes.c_ubyte * 8)]

        value = uuid.UUID(guid)
        folder_id = GUID(value.fields[0], value.fields[1], value.fields[2],
                         (ctypes.c_ubyte * 8)(*value.bytes[8:]))
        # Private prototypes: never mutate the shared windll function objects.
        get_path = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.POINTER(GUID), wintypes.DWORD,
                                      wintypes.HANDLE, ctypes.POINTER(ctypes.c_void_p))(
            ("SHGetKnownFolderPath", ctypes.windll.shell32))
        free = ctypes.WINFUNCTYPE(None, ctypes.c_void_p)(("CoTaskMemFree", ctypes.windll.ole32))
        out = ctypes.c_void_p()
        result = get_path(ctypes.byref(folder_id), KF_FLAG_DONT_VERIFY, None, ctypes.byref(out))
        try:
            return ctypes.wstring_at(out.value) if result == 0 and out.value else None
        finally:
            if out.value:
                free(out)
    except Exception:  # noqa: BLE001 - discovery is best effort
        return None


def _shell_folder(name: str) -> str | None:
    if sys.platform != "win32":
        return None
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                            r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders") as key:
            value, _ = winreg.QueryValueEx(key, name)
        return os.path.expandvars(str(value)) if value else None
    except OSError:
        return None


def _discover() -> list[str]:
    if sys.platform != "win32":
        return [os.path.join(os.path.expanduser("~"), "Pictures", "Screenshots")]
    candidates = [_known_folder(FOLDERID_SCREENSHOTS), _shell_folder(FOLDERID_SCREENSHOTS)]
    for pictures in (_known_folder(FOLDERID_PICTURES), _shell_folder("My Pictures")):
        if pictures:
            candidates.append(os.path.join(pictures, "Screenshots"))
    for variable in ("OneDrive", "OneDriveConsumer", "OneDriveCommercial"):
        root = os.environ.get(variable)
        if root:
            candidates += [os.path.join(root, "Pictures", "Screenshots"), os.path.join(root, "Screenshots")]
    candidates.append(_known_folder(FOLDERID_CAPTURES))
    return [c for c in candidates if c]


def _existing(candidates) -> list[str]:
    folders, seen = [], set()
    for candidate in candidates:
        try:
            folder = os.path.realpath(candidate, strict=True)
        except (OSError, ValueError):
            continue
        key = os.path.normcase(folder)
        if key not in seen and os.path.isdir(folder):
            seen.add(key)
            folders.append(folder)
    return folders


def screenshot_dirs() -> list[str]:
    """Existing screenshot folders, env override first, else cached discovery."""
    global _dirs_cache
    override = os.environ.get(ENV_DIRS)
    if override is not None:
        return _existing(part.strip() for part in override.split(os.pathsep) if part.strip())
    with _lock:
        expires, folders = _dirs_cache
        if time.monotonic() < expires:
            return list(folders)
    folders = _existing(_discover())
    with _lock:
        _dirs_cache = (time.monotonic() + DIRS_TTL_S, folders)
    return list(folders)


def _stamp(st) -> tuple:
    return (st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns)


def _make_id(path: str, stamp: tuple) -> str:
    message = "\0".join([os.path.normcase(path), *map(str, stamp)]).encode("utf-8", "surrogatepass")
    return hmac.new(_KEY, message, hashlib.sha256).hexdigest()[:32]


def _candidates(folders: list[str], now: float) -> list[tuple[int, str, str]]:
    found = []
    for folder in folders:
        try:
            with os.scandir(folder) as entries:
                for count, entry in enumerate(entries):
                    if count >= MAX_SCAN_ENTRIES:
                        break
                    name = entry.name
                    if name.startswith(".") or os.path.splitext(name)[1].lower() not in IMAGE_TYPES:
                        continue
                    try:
                        if not entry.is_file(follow_symlinks=False):
                            continue
                        st = entry.stat(follow_symlinks=False)
                    except OSError:
                        continue
                    if getattr(st, "st_file_attributes", 0) & _SKIP_ATTRIBUTES:
                        continue
                    age = now - st.st_mtime
                    if 0 < st.st_size <= MAX_FILE_BYTES and -FUTURE_SKEW_S <= age <= WINDOW_S:
                        found.append((st.st_mtime_ns, folder, name))
        except OSError:
            continue
    found.sort(reverse=True)
    return found


def recent(limit: int = MAX_ITEMS) -> dict:
    limit = max(1, min(MAX_ITEMS, int(limit)))
    folders = screenshot_dirs()
    now = time.time()
    items = []
    for _, folder, name in _candidates(folders, now):
        if len(items) >= limit:
            break
        path = os.path.join(folder, name)
        try:
            st = os.stat(path, follow_symlinks=False)   # authoritative; directory data can lag a writer
        except OSError:
            continue
        if not stat_mod.S_ISREG(st.st_mode) or not 0 < st.st_size <= MAX_FILE_BYTES:
            continue
        stamp = _stamp(st)
        shot_id = _make_id(path, stamp)
        with _lock:
            _index[shot_id] = (path, folder, name, stamp)
            _index.move_to_end(shot_id)
            while len(_index) > INDEX_ENTRIES:
                _index.popitem(last=False)
        items.append({"id": shot_id, "name": name, "modified_ts": st.st_mtime_ns / 1e9,
                      "age_s": max(0, int(now - st.st_mtime)), "size": st.st_size,
                      "type": IMAGE_TYPES[os.path.splitext(name)[1].lower()]})
    items.sort(key=lambda item: item["modified_ts"], reverse=True)
    return {"items": items, "now": now, "window_hours": WINDOW_S // 3600, "limit": limit,
            "available": bool(folders)}


def _entry(shot_id: str) -> tuple:
    missing = HTTPException(404, "That screenshot is no longer available.")
    if not ID_RE.fullmatch(shot_id or ""):
        raise missing
    with _lock:
        entry = _index.get(shot_id)
    if entry is None:
        raise missing
    path, folder, _, _ = entry
    current = {os.path.normcase(f) for f in screenshot_dirs()}
    if os.path.normcase(folder) not in current or os.path.normcase(os.path.dirname(path)) != os.path.normcase(folder):
        raise missing
    return entry


def _check(entry: tuple) -> None:
    """The listed file is still there, still a regular file and unchanged."""
    path, _, _, stamp = entry
    missing = HTTPException(404, "That screenshot changed or is no longer available.")
    try:
        st = os.stat(path, follow_symlinks=False)
    except OSError:
        raise missing from None
    if not stat_mod.S_ISREG(st.st_mode) or _stamp(st) != stamp or getattr(st, "st_file_attributes", 0) & _SKIP_ATTRIBUTES:
        raise missing


def _read(entry: tuple) -> bytes:
    path, _, _, stamp = entry
    missing = HTTPException(404, "That screenshot changed or is no longer available.")
    _check(entry)
    try:
        with open(path, "rb") as source:
            # The opened handle must be the very file that was listed.
            if _stamp(os.fstat(source.fileno())) != stamp:
                raise missing
            data = source.read(MAX_FILE_BYTES + 1)
            if len(data) != stamp[2] or _stamp(os.fstat(source.fileno())) != stamp:
                raise missing
    except PermissionError:
        raise HTTPException(403, "Access denied to that screenshot.") from None
    except OSError:
        raise missing from None
    return data


def _sniff(data: bytes) -> str | None:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def _matches(request: Request, etag: str) -> bool:
    return etag in [v.strip().removeprefix("W/") for v in request.headers.get("if-none-match", "").split(",")]


@router.get("/recent")
def list_recent(limit: int = MAX_ITEMS):
    return JSONResponse(recent(limit), headers={"Cache-Control": "no-store, private"})


@router.get("/{shot_id}/thumbnail")
def thumbnail(shot_id: str, request: Request):
    global _thumb_bytes
    entry = _entry(shot_id)
    _check(entry)
    etag = '"' + shot_id + '"'
    headers = {"X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-cache", "ETag": etag}
    if _matches(request, etag):
        return Response(status_code=304, headers=headers)
    with _lock:
        cached = _thumbs.get(shot_id)
        if cached:
            _thumbs.move_to_end(shot_id)
    if cached is None:
        data = _read(entry)
        media = _sniff(data)
        if media is None:
            raise HTTPException(415, "This file is not a supported image.")
        cached = (_thumbnail(data), "image/png")
        with _lock:
            _thumbs[shot_id] = cached
            _thumb_bytes += len(cached[0])
            while len(_thumbs) > THUMB_ENTRIES or _thumb_bytes > THUMB_BYTES:
                _, old = _thumbs.popitem(last=False)
                _thumb_bytes -= len(old[0])
    content, media = cached
    return Response(content, media_type=media, headers=headers)


@router.get("/{shot_id}/file")
def screenshot_file(shot_id: str):
    entry = _entry(shot_id)
    data = _read(entry)
    media = _sniff(data)
    if media is None:
        raise HTTPException(415, "This file is not a supported image.")
    return Response(data, media_type=media, headers={
        "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store, private",
        "Content-Disposition": "inline; filename*=UTF-8''" + quote(entry[2])})
