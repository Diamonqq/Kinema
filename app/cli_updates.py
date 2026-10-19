"""Install/Update for the official AI apps Kinema uses.

Nothing installs by itself: an installer runs only after the learner clicks its
button, and only the provider's official command is used. Latest versions come
from the official npm registry.
"""
from __future__ import annotations

import json
import os
import shutil
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

PACKAGES = {'codex': '@openai/codex', 'claude': '@anthropic-ai/claude-code', 'kimi-cli': '@moonshot-ai/kimi-code'}
NAMES = {'codex': ('ChatGPT', 'Codex'), 'claude': ('Claude', 'Claude Code'),
         'kimi-cli': ('Kimi', 'Kimi Code')}
SOURCES = {'codex': 'https://www.npmjs.com/package/@openai/codex',
           'claude': 'https://code.claude.com/docs/en/setup',
           'kimi-cli': 'https://www.npmjs.com/package/@moonshot-ai/kimi-code'}
LATEST_TTL = 6 * 3600
_LOCK = threading.Lock()
_LATEST: dict[str, tuple[float, str | None]] = {}
_FETCHING = set()
_JOBS: dict[str, dict] = {}


def _npm():
    """npm's own entry script through node, never a .cmd through a shell."""
    found = shutil.which('npm')
    if not found:
        return None
    path = Path(found)
    if path.suffix.lower() in ('.cmd', '.bat', '.ps1') or os.name == 'nt':
        script = path.parent / 'node_modules' / 'npm' / 'bin' / 'npm-cli.js'
        node = path.parent / 'node.exe'
        node = str(node) if node.is_file() else shutil.which('node')
        return [node, str(script)] if node and script.is_file() else None
    return [str(path)]


def _kind(pid, argv):
    if not argv:
        return 'missing'
    joined = ' '.join(argv).replace('\\', '/').lower()
    if 'node_modules' in joined:
        return 'npm'
    if pid == 'codex':
        return 'app'  # The Codex/ChatGPT desktop app updates its own bundled CLI.
    if pid == 'claude':
        return 'winget' if '/winget/' in joined else 'native'
    return 'native'


def installer(pid, argv):
    """(argv, label) for the official route, or (None, reason)."""
    kind = _kind(pid, argv)
    if pid == 'claude' and kind == 'native':
        return argv + ['update'], 'claude update'
    if pid == 'claude' and kind == 'winget':
        return ['winget', 'upgrade', '--id', 'Anthropic.ClaudeCode', '-e'], 'winget'
    if pid == 'claude' and kind == 'missing' and os.name == 'nt':
        return ['winget', 'install', '--id', 'Anthropic.ClaudeCode', '-e'], 'winget'
    if pid == 'codex' and kind == 'app':
        return None, 'Updated by the Codex app'
    if pid in PACKAGES:
        npm = _npm()
        if not npm:
            return None, 'Install Node.js first'
        return npm + ['install', '-g', PACKAGES[pid] + '@latest'], 'npm'
    return None, 'Unavailable'


def _fetch_latest(pid):
    url = 'https://registry.npmjs.org/' + PACKAGES[pid].replace('/', '%2F') + '/latest'
    with urllib.request.urlopen(urllib.request.Request(url, headers={'Accept': 'application/json'}), timeout=8) as r:
        version = json.loads(r.read(200000)).get('version')
    return version if isinstance(version, str) and len(version) < 40 else None


def _refresh_latest(pid):
    try:
        version = _fetch_latest(pid)
    except Exception:  # noqa: BLE001 - offline is normal; keep the last reading
        version = _LATEST.get(pid, (0, None))[1]
    with _LOCK:
        _LATEST[pid] = (time.time(), version)
        _FETCHING.discard(pid)


def latest(pid):
    if pid not in PACKAGES:
        return None
    with _LOCK:
        at, value = _LATEST.get(pid, (0, None))
        start = time.time() - at > LATEST_TTL and pid not in _FETCHING
        if start: _FETCHING.add(pid)
    if start:
        threading.Thread(target=_refresh_latest, args=(pid,), daemon=True, name='kinema-latest').start()
    return value


def _newer(a, b):
    try:
        return tuple(int(x) for x in b.split('-')[0].split('.')) > tuple(int(x) for x in a.split('-')[0].split('.'))
    except (AttributeError, ValueError):
        return False


def view():
    from . import cli_runners
    rows = []
    for pid, (name, tool) in NAMES.items():
        argv = cli_runners.resolve_binary(pid)
        installed = cli_runners.capabilities(pid).get('version') if argv else None
        newest = latest(pid)
        command, route = installer(pid, argv)
        job = dict(_JOBS.get(pid) or {'state': 'idle'})
        rows.append({'id': pid, 'name': name, 'tool': tool, 'installed': bool(argv), 'version': installed,
                     'latest': newest, 'update_available': bool(argv and installed and newest and _newer(installed, newest)),
                     'action': None if not command else 'install' if not argv else 'update', 'route': route,
                     'source': SOURCES[pid], 'job': {k: job.get(k) for k in ('state', 'error', 'finished_at')}})
    return {'apps': rows, 'checking': bool(_FETCHING)}


def _execute(argv):
    from . import cli_runners
    with tempfile.TemporaryDirectory(prefix='kinema-install-') as temp:
        return cli_runners.capture(argv, cwd=Path(temp), timeout=900, limit=2 * 1024 * 1024).returncode


def start(pid):
    """Runs the official installer for one app after the learner's click."""
    from . import cli_runners
    if pid not in NAMES:
        raise ValueError('Choose a supported app.')
    command, route = installer(pid, cli_runners.resolve_binary(pid))
    if not command:
        raise ValueError(route + '.')
    with _LOCK:
        if (_JOBS.get(pid) or {}).get('state') == 'running':
            return
        _JOBS[pid] = {'state': 'running', 'error': None}
    def work():
        try:
            code = _execute(command)
            error = None if code == 0 else 'The official installer did not finish. Try again or use its setup guide.'
        except Exception:  # noqa: BLE001 - no installer output is returned to the page
            error = 'The official installer could not run. Use its setup guide.'
        if not error:
            try: cli_runners.check_installation(pid)
            except Exception: pass  # noqa: BLE001
            from .cli_connections import manager
            try: manager().check(pid)
            except Exception: pass  # noqa: BLE001
        with _LOCK:
            _JOBS[pid] = {'state': 'failed' if error else 'succeeded', 'error': error, 'finished_at': time.time()}
    threading.Thread(target=work, daemon=True, name='kinema-install').start()
