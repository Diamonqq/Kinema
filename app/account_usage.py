"""Plan usage for the signed-in account, read only from what official CLIs expose.

Never spends a model call and never reads credential files.
- ChatGPT (Codex): `codex app-server` stdio JSON-RPC, `account/rateLimits/read`.
- Claude (Claude Code): `rate_limit_event` lines that Claude Code already prints in
  the stream-json output of ordinary tutor replies.
- Gemini/Kimi: no supported plan-usage read is available, so nothing is shown.
"""
from __future__ import annotations

import json
import os
import queue
import subprocess
import threading
import time
from pathlib import Path

NO_WINDOW = 0x08000000 if os.name == 'nt' else 0
CODEX_TTL = 120          # seconds between background reads
READ_TIMEOUT = 12
_LOCK = threading.Lock()
_REFRESHING: set[str] = set()
_LAST_TRY: dict[str, float] = {}


def _path() -> Path:
    from .main import DATA
    return Path(DATA) / 'account-usage.json'


def _read() -> dict:
    try:
        data = json.loads(_path().read_text(encoding='utf-8'))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _write(provider: str, value: dict):
    with _LOCK:
        data = _read()
        data[provider] = value
        try:
            path = _path(); path.parent.mkdir(parents=True, exist_ok=True)
            pending = path.with_suffix('.pending')
            pending.write_text(json.dumps(data), encoding='utf-8'); os.replace(pending, path)
        except OSError:
            pass


def _num(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _label(mins=None, key=''):
    if key == 'five_hour' or mins == 300: return '5h limit'
    if key.startswith('seven_day') or mins == 10080: return 'Weekly limit'
    if isinstance(mins, int) and mins > 0:
        return f'{mins // 1440}-day limit' if mins % 1440 == 0 else f'{round(mins / 60)}h limit'
    return 'Usage limit'


def _window(used, resets_at, label):
    used = _num(used)
    if used is None: return None
    reset = _num(resets_at)
    return {'label': label, 'used_percent': round(max(0.0, min(100.0, float(used))), 1),
            'resets_at': int(reset) if reset and reset > 0 else None}


# ── Claude: passive capture ─────────────────────────────────────────────────────
def parse_claude(info: dict) -> list[dict]:
    """`rate_limit_info.unifiedWindows` utilization is a 0–1 fraction (Claude Code 2.1)."""
    def pct(u):
        u = _num(u)
        return None if u is None else u * 100 if u <= 1.5 else u
    windows, unified = [], info.get('unifiedWindows')
    if isinstance(unified, dict):
        for key in ('five_hour', 'seven_day'):
            w = unified.get(key)
            if isinstance(w, dict):
                row = _window(pct(w.get('utilization')), w.get('resetsAt'), _label(key=key))
                if row: windows.append(row)
    if not windows and isinstance(info.get('rateLimitType'), str):
        row = _window(pct(info.get('utilization')), info.get('resetsAt'), _label(key=info['rateLimitType']))
        if row: windows.append(row)
    return windows


def observe_claude_line(line: str):
    """Called for stream lines of real Claude runs. Failures are ignored."""
    try:
        event = json.loads(line)
        info = event.get('rate_limit_info') if event.get('type') == 'rate_limit_event' else None
        if not isinstance(info, dict): return
        windows = parse_claude(info)
        if not windows: return
        status = info.get('status') if info.get('status') in ('allowed', 'allowed_warning', 'rejected') else None
        _write('claude', {'windows': windows, 'status': status, 'checked_at': time.time(),
                          'source': 'Claude Code rate_limit_event'})
    except Exception:  # noqa: BLE001 - usage display must never break a reply
        pass


# ── Codex: official app-server ──────────────────────────────────────────────────
def parse_codex(result: dict) -> dict:
    snap = result.get('rateLimits') if isinstance(result, dict) else None
    if not isinstance(snap, dict): return {}
    windows = []
    for key in ('primary', 'secondary'):
        w = snap.get(key)
        if isinstance(w, dict):
            mins = w.get('windowDurationMins') if isinstance(w.get('windowDurationMins'), int) else None
            row = _window(w.get('usedPercent'), w.get('resetsAt'), _label(mins))
            if row: windows.append(row)
    plan = snap.get('planType') if isinstance(snap.get('planType'), str) and len(snap['planType']) < 40 else None
    return {'windows': windows, 'plan': plan}


def _spawn_app_server(argv, env):
    return subprocess.Popen(argv + ['app-server'], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, env=env, creationflags=NO_WINDOW,
                            start_new_session=os.name != 'nt')


def read_codex(argv) -> dict:
    """initialize → account/rateLimits/read. Returns {} when signed out or unavailable."""
    from .cli_connections import _terminate
    proc = _spawn_app_server(argv, os.environ.copy())
    lines: queue.Queue = queue.Queue()
    def pump():
        try:
            for raw in iter(proc.stdout.readline, b''):
                if len(raw) > 256000: break
                lines.put(raw)
        except (OSError, ValueError):
            pass
        lines.put(None)
    threading.Thread(target=pump, daemon=True, name='kinema-usage-read').start()
    try:
        def send(message):
            proc.stdin.write((json.dumps(message) + '\n').encode()); proc.stdin.flush()
        send({'id': 1, 'method': 'initialize', 'params': {'clientInfo': {'name': 'kinema', 'title': 'Kinema', 'version': '1'}}})
        send({'method': 'initialized'})
        send({'id': 2, 'method': 'account/rateLimits/read', 'params': None})
        deadline = time.monotonic() + READ_TIMEOUT
        while time.monotonic() < deadline:
            try: raw = lines.get(timeout=.2)
            except queue.Empty: continue
            if raw is None: break
            try: message = json.loads(raw)
            except ValueError: continue
            if isinstance(message, dict) and message.get('id') == 2:
                return parse_codex(message.get('result')) if 'result' in message else {}
        return {}
    except OSError:
        return {}
    finally:
        try: proc.stdin.close()
        except OSError: pass
        _terminate(proc)
        try: proc.stdout.close()
        except (OSError, ValueError): pass


def _refresh_codex():
    from . import cli_runners
    try:
        argv = cli_runners.resolve_binary('codex')
        reading = read_codex(argv) if argv else {}
        if reading.get('windows'):
            _write('codex', {**reading, 'checked_at': time.time(), 'source': 'codex app-server account/rateLimits/read'})
    finally:
        with _LOCK: _REFRESHING.discard('codex')


def view(provider: str | None, refresh: bool = True) -> dict:
    """Cached reading for the active provider; starts a background read when stale."""
    if provider not in ('codex', 'claude'):
        return {'provider': provider, 'windows': [], 'supported': False}
    saved = _read().get(provider) or {}
    checked = _num(saved.get('checked_at')) or 0
    now = time.time()
    if refresh and provider == 'codex':
        with _LOCK:
            start = 'codex' not in _REFRESHING and now - checked > CODEX_TTL and now - _LAST_TRY.get('codex', 0) > CODEX_TTL
            if start:
                _REFRESHING.add('codex'); _LAST_TRY['codex'] = now
        if start:
            threading.Thread(target=_refresh_codex, daemon=True, name='kinema-usage').start()
    windows = [w for w in saved.get('windows') or [] if isinstance(w, dict)]
    return {'provider': provider, 'supported': True, 'windows': windows, 'plan': saved.get('plan'),
            'status': saved.get('status'), 'checked_at': checked or None,
            'refreshing': provider in _REFRESHING, 'source': saved.get('source')}
