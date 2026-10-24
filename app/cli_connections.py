"""Account setup through the user's unmodified official CLIs.

An explicit sign-in starts the official CLI's own device or browser flow.
Kinema never reads auth tokens. Snapshots do no probes: they return the last
saved status at once, and a background refresh re-checks installed CLIs.
Checks report local CLI auth state, not quota or successful model access.
"""
from __future__ import annotations

import atexit
import json
import os
from pathlib import Path
import queue
import re
import subprocess
import threading
import time
from urllib.parse import urlsplit

from .providers import ProviderError

PROVIDERS = {
    'codex': {'label': 'ChatGPT', 'tool': 'Codex', 'tier': 'primary', 'setup_url': 'https://learn.chatgpt.com/docs/cli',
        'install_command': 'npm install -g @openai/codex', 'login_command': 'codex login --device-auth',
        'login_mode': 'device', 'detail': 'Sign in through Codex with your own ChatGPT account.'},
    'claude': {'label': 'Claude', 'tool': 'Claude Code', 'tier': 'primary', 'setup_url': 'https://code.claude.com/docs/en/setup',
        'install_command': 'winget install Anthropic.ClaudeCode' if os.name == 'nt' else 'curl -fsSL https://claude.ai/install.sh | bash',
        'login_command': 'claude auth login', 'login_mode': 'browser',
        'detail': 'Sign in through Claude Code. Its official sign-in opens your browser.'},
    'gemini-cli': {'label': 'Google Gemini', 'tool': 'Gemini CLI', 'tier': 'primary',
        'setup_url': 'https://geminicli.com/docs/get-started/authentication/',
        'install_command': 'npm install -g @google/gemini-cli', 'login_command': 'gemini', 'login_mode': 'browser',
        'detail': 'Google sign-in is unavailable in Kinema.'},
    'kimi-cli': {'label': 'Kimi', 'tool': 'Kimi Code', 'tier': 'primary', 'setup_url': 'https://moonshotai.github.io/kimi-code/en/',
        'install_command': 'npm install -g @moonshot-ai/kimi-code', 'login_command': 'kimi login', 'login_mode': 'device',
        'detail': 'Sign in through Kimi Code using its official verification page and device code.'},
}
UNAVAILABLE = {'gemini-cli': 'Google sign-in is unavailable in Kinema. Google ended personal-account access through Gemini CLI. Choose ChatGPT, Claude or Kimi.'}

GEMINI_ENV = {'GOOGLE_GENAI_USE_GCA': 'true', 'GEMINI_CLI_NO_RELAUNCH': 'true'}
STALE_AFTER = 10 * 60
WINDOW_POLL = 4
_MANAGERS = {}
_LOCK = threading.Lock()
NO_WINDOW = 0x08000000 if os.name == 'nt' else 0
LOGIN_TIMEOUT = 15 * 60
STATUS_TIMEOUT = 10
MAX_OUTPUT = 64 * 1024
ACTIVE = {'starting', 'waiting', 'cancelling'}


def _provider(pid):
    if not isinstance(pid, str) or pid not in PROVIDERS:
        raise ValueError('Choose a supported account connection.')
    return pid


def _runtime(pid):
    from . import cli_runners
    return cli_runners.resolve_binary(pid), cli_runners.capabilities(pid)


_ALIAS_NAMES = {'opus': 'Claude Opus 5.5', 'sonnet': 'Claude Sonnet 5.5', 'haiku': 'Claude Haiku 5.5', 'fable': 'Claude Fable 5.1'}


def display_name(slug, label=None):
    """A student-facing model name: a CLI row that only repeats its own id ("haiku", "gpt-5.5") gets a proper name."""
    if label and label.strip().lower() != slug.lower(): return label
    if slug in _ALIAS_NAMES: return _ALIAS_NAMES[slug]
    m = re.fullmatch(r'claude-(fable|opus|sonnet|haiku)-(\d+)(?:-(\d{1,2}))?', slug)
    if m: return f'Claude {m[1].title()} {m[2]}' + (f'.{m[3]}' if m[3] else '')
    m = re.fullmatch(r'gpt-(\d[\w.]*)((?:-[a-z][a-z0-9]*)*)', slug, re.I)
    if m: return 'GPT-' + m[1] + ''.join(' ' + w.title() for w in m[2].split('-') if w)
    return label or slug


def _models(pid, caps):
    efforts = list(caps.get('efforts') or ['default'])
    default = 'medium' if 'medium' in efforts else 'default' if 'default' in efforts else efforts[0]
    rows = caps.get('model_rows')
    if rows:
        return [{'id': pid + ':' + row['id'], 'label': display_name(row['id'], row.get('label')),
                 'provider': pid, 'connection': 'cli', 'efforts': row.get('efforts') or efforts,
                 'default_effort': row.get('default_effort') or ('medium' if 'medium' in (row.get('efforts') or efforts) else (row.get('efforts') or efforts)[0]),
                 'speeds': row.get('speeds') or ['standard'], 'image_input': row.get('images') is True,
                 'availability': 'CLI-supported model; account access is checked when used.'}
                for row in rows if isinstance(row, dict) and isinstance(row.get('id'), str)
                and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._/-]{0,190}', row['id'])]
    return [{'id': pid + ':' + slug, 'label': display_name(slug), 'provider': pid,
             'connection': 'cli', 'efforts': efforts, 'default_effort': default,
             'speeds': ['standard'], 'image_input': caps.get('images') is True,
             'availability': 'CLI-supported model; account access is checked when used.'}
            for slug in caps.get('models', [])
            if isinstance(slug, str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._/-]{0,190}', slug)]


def _terminate(proc, *, tree=True):
    """Browser sign-in stops only its direct CLI; browsers are never owned work.

    The shared resolver unwraps shell/npm launchers to the actual binary or Node
    entry point. Tree cleanup is reserved for no-browser device/status commands.
    """
    if proc.poll() is not None:
        return True
    try:
        if not tree:
            proc.terminate()
        elif os.name == 'nt':
            subprocess.run(['taskkill', '/PID', str(proc.pid), '/T', '/F'],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5, creationflags=NO_WINDOW)
        else:
            # Every owned process starts a separate session; a Node CLI may own a child.
            import signal
            os.killpg(proc.pid, signal.SIGTERM)
        proc.wait(timeout=3)
    except (OSError, subprocess.TimeoutExpired):
        try:
            proc.kill()
            proc.wait(timeout=3)
        except (OSError, subprocess.TimeoutExpired):
            return False
    return proc.poll() is not None


def _spawn(argv, cwd):
    return subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT, cwd=str(cwd), creationflags=NO_WINDOW,
        start_new_session=os.name != 'nt')


def _spawn_io(argv, cwd, env):
    """Gemini CLI asks for consent on stdin before its own browser sign-in."""
    return subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT, cwd=str(cwd), env={**os.environ, **env}, creationflags=NO_WINDOW,
        start_new_session=os.name != 'nt')



def _collect(proc, cancel, timeout, on_chunk, *, kill_tree=True):
    """Bounded memory/time; consume output without ever logging it."""
    chunks = queue.Queue(maxsize=16)
    finished = threading.Event()
    def put(value):
        while not finished.is_set():
            try:
                chunks.put(value, timeout=.1)
                return
            except queue.Full:
                pass
    def read():
        try:
            stream = proc.stdout
            while not finished.is_set():
                chunk = stream.read1(1024) if hasattr(stream, 'read1') else stream.read(1)
                if not chunk: break
                put(chunk)
        except (OSError, ValueError):
            pass
        finally:
            put(None)
    reader = threading.Thread(target=read, name='kinema-login-output', daemon=True)
    proc._kinema_output_reader = reader
    proc._kinema_cleanup_confirmed = False
    reader.start()
    deadline, size, eof = time.monotonic() + timeout, 0, False
    try:
        while True:
            if cancel.is_set(): raise ProviderError('Sign-in was cancelled.')
            if time.monotonic() >= deadline: raise ProviderError('The sign-in command timed out. Try again from the official terminal.')
            try:
                chunk = chunks.get(timeout=.05)
                if chunk is None: eof = True
                else:
                    size += len(chunk)
                    if size > MAX_OUTPUT: raise ProviderError('The sign-in command returned unexpected output. Use the official terminal.')
                    on_chunk(chunk)
            except queue.Empty:
                pass
            if eof and proc.poll() is not None:
                return proc.wait(timeout=1)
    finally:
        finished.set()
        if proc.poll() is None and not _terminate(proc, tree=kill_tree):
            raise ProviderError('The sign-in command has not stopped. Close it in the official terminal before trying again.')
        # Never block closing a pipe whose reader still owns its lock. A browser
        # or launcher inheriting an output handle must not force a tree kill.
        reader.join(timeout=1)
        if reader.is_alive():
            raise ProviderError('Sign-in output cleanup is not confirmed. Close the official sign-in terminal before trying again.')
        if proc.stdout: proc.stdout.close()
        proc._kinema_cleanup_confirmed = True


def _command(argv, cwd, env=None):
    output = bytearray()
    proc = _spawn_io(argv, cwd, env) if env else _spawn(argv, cwd)
    if env and proc.stdin: proc.stdin.close()  # Empty stdin: Gemini exits before any model call.
    code = _collect(proc, threading.Event(), 25 if env else STATUS_TIMEOUT, output.extend)
    return code, output.decode('utf8', errors='replace')


class AccountSignedOut(ProviderError):
    pass


def _acp_models(result):
    models = result.get('models') if isinstance(result.get('models'), dict) else {}
    available = models.get('availableModels') if isinstance(models.get('availableModels'), list) else []
    pairs = [(r.get('modelId'), r.get('name')) for r in available[:100] if isinstance(r, dict)]
    options = result.get('configOptions') if isinstance(result.get('configOptions'), list) else []
    for option in options[:100]:
        if isinstance(option, dict) and option.get('id') == 'model':
            choices = option.get('options') if isinstance(option.get('options'), list) else []
            pairs += [(r.get('value'), r.get('name')) for r in choices[:100] if isinstance(r, dict)]
    rows, seen = [], set()
    for mid, name in pairs:
        if isinstance(mid, str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._/-]{0,120}', mid) and mid not in seen:
            seen.add(mid)
            rows.append({'id': mid, 'label': str(name or mid)[:80]})
    if not rows:
        raise ProviderError('The official CLI did not report account models. Update it and check again.')
    return rows[:100]


def acp_account(pid, argv, folder, *, attempt=None, login=False):
    """Official ACP auth/catalog only. Never sends session/prompt or grants tools.

    A check disables browser launch and only creates a session; an explicit Google
    login additionally requests oauth-personal. Kimi's own login runs separately.
    Readers are bounded and reaped with the exact child before returning success.
    """
    from . import cli_runners
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    env = {**cli_runners.official_env(pid), **GEMINI_ENV}
    if not login: env['NO_BROWSER'] = 'true'
    else: env.pop('NO_BROWSER', None)
    if pid == 'gemini-cli':
        settings = folder / '.gemini'
        settings.mkdir(exist_ok=True)
        (settings / 'settings.json').write_text(json.dumps(cli_runners._gemini_settings('auto')), encoding='utf8')
        args = ['--skip-trust', '-e', 'none', '--acp']
    else:
        cli_runners._kimi_config_guard()
        args = ['acp']
        env.update(KIMI_CODE_NO_AUTO_UPDATE='1', KIMI_DISABLE_TELEMETRY='1')
    proc = subprocess.Popen(argv + args, cwd=folder, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, env=env, creationflags=NO_WINDOW, start_new_session=os.name != 'nt')
    proc._kinema_cleanup_confirmed = False
    if attempt:
        attempt.proc, attempt.state = proc, 'waiting'
    cancel = attempt.cancel if attempt else threading.Event()
    reader_stop = threading.Event()
    messages = queue.Queue(maxsize=64)
    def reader(stream, protocol):
        try:
            while True:
                raw = stream.readline(MAX_OUTPUT + 1)
                if not raw: break
                if len(raw) > MAX_OUTPUT: raise ValueError()
                if protocol:
                    try: value = json.loads(raw)
                    except ValueError: continue
                    if isinstance(value, dict):
                        while not cancel.is_set() and not reader_stop.is_set():
                            try: messages.put(value, timeout=.1); break
                            except queue.Full: pass
        except (OSError, ValueError):
            pass
        finally:
            if protocol:
                try: messages.put_nowait(None)
                except queue.Full: pass
    readers = [threading.Thread(target=reader, args=(proc.stdout, True), daemon=True),
               threading.Thread(target=reader, args=(proc.stderr, False), daemon=True)]
    proc._kinema_output_readers = readers
    for thread in readers: thread.start()
    def send(value):
        proc.stdin.write((json.dumps(value) + '\n').encode()); proc.stdin.flush()
    def request(rid, method, params):
        send({'jsonrpc': '2.0', 'id': rid, 'method': method, 'params': params})
        deadline = time.monotonic() + (LOGIN_TIMEOUT if login else STATUS_TIMEOUT)
        while time.monotonic() < deadline:
            if cancel.is_set(): raise ProviderError('Cancelled')
            try: value = messages.get(timeout=.1)
            except queue.Empty: continue
            if value is None: raise ProviderError('The official CLI connection closed. Check or sign in again.')
            if 'method' in value and 'id' in value:
                # No filesystem, terminal or permission client capabilities.
                reply = {'jsonrpc': '2.0', 'id': value['id']}
                if value['method'] == 'session/request_permission':
                    reply['result'] = {'outcome': {'outcome': 'cancelled'}}
                else:
                    reply['error'] = {'code': -32601, 'message': 'Method unavailable.'}
                send(reply)
            elif value.get('id') == rid:
                if 'error' in value:
                    error = value['error'] if isinstance(value['error'], dict) else {}
                    if error.get('code') == -32000 or re.search(r'auth|sign.?in|log.?in', str(error.get('message') or ''), re.I):
                        raise AccountSignedOut('Sign in through the official CLI.')
                    raise ProviderError('The official CLI account request failed. Update it and try again.')
                result = value.get('result')
                if not isinstance(result, dict): raise ProviderError('The official CLI returned invalid account information.')
                return result
        raise ProviderError('The official CLI did not answer in time. Try again.')
    try:
        request(1, 'initialize', {'protocolVersion': 1, 'clientCapabilities': {}})
        if login: request(2, 'authenticate', {'methodId': 'oauth-personal' if pid == 'gemini-cli' else 'login'})
        return _acp_models(request(3, 'session/new', {'cwd': str(folder), 'mcpServers': []}))
    finally:
        reader_stop.set()
        stopped = proc.poll() is not None or _terminate(proc, tree=False)
        for thread in readers: thread.join(timeout=1)
        complete = stopped and not any(t.is_alive() for t in readers)
        streams = [proc.stdin] + [stream for stream, thread in zip((proc.stdout, proc.stderr), readers) if not thread.is_alive()]
        for stream in streams:
            try: stream.close()
            except (OSError, ValueError): pass
        proc._kinema_cleanup_confirmed = complete
        if not complete: raise ProviderError('The sign-in process cleanup is not confirmed. Close the official CLI before retrying.')


def device_prompt(text, pid='codex'):
    """Only a documented public URL and bounded human code may leave the server."""
    clean = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', text)
    urls = re.findall(r'https?://[^\s<>"\x00-\x20]+', clean)
    valid = None
    for raw in urls:
        raw = raw.rstrip('.,;)')
        try:
            url = urlsplit(raw)
            if (url.scheme == 'https' and url.hostname == 'auth.openai.com'
                    and url.path.rstrip('/') == '/codex/device' and url.port in (None, 443)
                    and not url.username and not url.password and not url.query and not url.fragment):
                if pid == 'codex': valid = 'https://auth.openai.com/codex/device'
            if (pid == 'kimi-cli' and url.scheme == 'https' and url.hostname == 'auth.kimi.com'
                    and url.port in (None, 443) and not url.username and not url.password
                    and not url.fragment):
                # Device code is displayed separately. Never expose query tokens.
                valid = url._replace(query='').geturl()
        except ValueError:
            pass
    code = re.search(r'(?<![A-Z0-9])[A-Z0-9]{4}-[A-Z0-9]{4}(?![A-Z0-9])', clean)
    return (valid, code.group()) if valid and code else (None, None)


class Login:
    def __init__(self):
        self.state, self.url, self.code, self.error = 'starting', None, None, None
        self.cancel = threading.Event()
        self.thread = None
        self.proc = None
    def view(self):
        return {k: getattr(self, k) for k in ('state', 'url', 'code', 'error')}


class Manager:
    def __init__(self, data):
        self.data = Path(data)
        self.lock = threading.RLock()
        self.states, self.logins = self._load(), {}
        self.checking, self.refresher = set(), None

    def _status_path(self):
        return self.data / 'cli-status.json'

    def _load(self):
        """The last checked state of each CLI, so the screen opens without probing."""
        try:
            data = json.loads(self._status_path().read_text(encoding='utf-8'))
        except (OSError, ValueError):
            return {}
        keep = {'state', 'checked_at', 'detail', 'error'}
        return {pid: {k: v for k, v in row.items() if k in keep} for pid, row in (data if isinstance(data, dict) else {}).items()
                if (pid in PROVIDERS or pid == 'antigravity') and isinstance(row, dict) and row.get('state') in ('signed_in', 'signed_out', 'setup_required', 'check_failed', 'unsupported_account')}

    def _save(self):
        try:
            self.data.mkdir(parents=True, exist_ok=True)
            pending = self._status_path().with_suffix('.pending')
            pending.write_text(json.dumps(self.states), encoding='utf-8'); os.replace(pending, self._status_path())
        except OSError:
            pass

    def _signed_in(self, pid):
        """A sign-in becomes the account in use only when no connected account is in use;
        otherwise it waits in Settings for the learner to choose it."""
        try:
            from . import account
            from .main import _settings
            current = account.active_provider()  # Preserve pre-account-picker choices during their one-time migration.
            if not current and not _settings().get('account_provider'):
                account.adopt(pid)
            if account.active_provider() == pid:
                from . import account_usage
                account_usage.view(pid)  # Warm the plan-usage reading in the background.
        except Exception:  # noqa: BLE001 - a defaults problem must never strand a sign-in
            pass

    def refresh(self, force=False):
        """Background re-check of CLIs whose saved status is old. Never blocks a read."""
        with self.lock:
            if self.refresher and self.refresher.is_alive(): return False
            now = time.time()
            due = [pid for pid in PROVIDERS if pid not in UNAVAILABLE and (force or now - (self.states.get(pid, {}).get('checked_at') or 0) > STALE_AFTER)]
            if not due: return False
            self.checking = set(due)
            def work():
                try:
                    for pid in due:
                        try: self.check(pid)
                        except (OSError, ValueError, ProviderError): pass
                        finally:
                            with self.lock: self.checking.discard(pid)
                finally:
                    with self.lock: self.checking = set()
            self.refresher = threading.Thread(target=work, name='kinema-cli-refresh', daemon=True)
            self.refresher.start()
            return True

    def snapshot(self, pid):
        _provider(pid)
        if pid in UNAVAILABLE:
            return {'id': pid, **PROVIDERS[pid], 'state': 'unavailable', 'available': False,
                    'installed': False, 'supported': False, 'connected': False, 'checking': False,
                    'version': None, 'checked_at': None, 'detail': UNAVAILABLE[pid], 'error': None,
                    'models': [], 'allowed_actions': [], 'login': {'state': 'idle'}}
        argv, caps = _runtime(pid)
        if pid in ('gemini-cli', 'kimi-cli'):
            from . import cli_runners
            rows = cli_runners.account_models(pid)
            caps = {**caps, 'model_rows': rows, 'models': [r['id'] for r in rows]}
        with self.lock:
            saved = dict(self.states.get(pid, {}))
            state = saved.get('state', 'unchecked') if argv else 'missing'
            if argv and not caps.get('supported'):
                state = 'unchecked' if str(caps.get('reason') or '').startswith('Check ') else 'unsupported'
            login = self.logins.get(pid)
            login_view = login.view() if login else {'state': 'idle', 'url': None, 'code': None, 'error': None}
        supported = bool(argv and caps.get('supported'))
        actions = ['check'] if argv else []
        if supported:
            actions += ['login']
            if state == 'signed_in': actions += ['select', 'use']
        if supported and state == 'signed_in' and pid in ('codex', 'claude'):
            actions.append('signout')
        if login and login.state in ACTIVE: actions.append('cancel')
        detail = saved.get('detail') or (caps.get('reason') if argv and not supported else PROVIDERS[pid]['detail'])
        return {'id': pid, **PROVIDERS[pid], 'installed': bool(argv), 'supported': supported, 'version': caps.get('version'),
            'state': state, 'connected': state == 'signed_in', 'checked_at': saved.get('checked_at'), 'checking': pid in self.checking,
            'detail': detail, 'error': saved.get('error'), 'models': _models(pid, caps) if supported and (state == 'signed_in' or pid in ('codex', 'claude')) else [],
            'allowed_actions': actions, 'login': login_view}

    def snapshot_all(self):
        return {'providers': [self.snapshot(pid) for pid in PROVIDERS]}

    def models(self):
        return [m for pid in PROVIDERS for m in self.snapshot(pid)['models']]

    def check(self, pid):
        _provider(pid)
        if pid in UNAVAILABLE: return self.snapshot(pid)
        with self.lock:
            active = self.logins.get(pid)
            if active and active.state in ACTIVE: return self.snapshot(pid)
            observed_login = active
        from . import cli_runners
        try:
            cli_runners.check_installation(pid)
        except (OSError, ValueError, ProviderError):
            # Installation probes also create/clean temporary folders. A local
            # permission failure must not become an HTTP 500 or retain Ready.
            with self.lock:
                if self.logins.get(pid) is observed_login:
                    self.states[pid] = {'checked_at': time.time(), 'state': 'check_failed',
                        'error': 'Could not check the CLI installation. Check local file permissions and try again.',
                        'detail': 'No account status was confirmed.'}
                    self._save()
            return self.snapshot(pid)
        argv, caps = _runtime(pid)
        if not argv: return self.snapshot(pid)
        if not caps.get('supported'): return self.snapshot(pid)
        before = self.states.get(pid, {}).get('state')
        saved = {'checked_at': time.time(), 'state': 'setup_required', 'error': None,
            'detail': 'This CLI has no supported read-only account check. Complete its official terminal sign-in; access is checked when you send.'}
        if pid in ('gemini-cli', 'kimi-cli'):
            folder = self.data / 'cli-setup' / pid
            folder.mkdir(parents=True, exist_ok=True)
            try:
                rows = acp_account(pid, argv, folder)
                cli_runners.save_account_models(pid, rows)
                saved.update(state='signed_in', detail='Official CLI account verified. Model access is checked when you send.')
            except AccountSignedOut:
                saved.update(state='signed_out', detail='Sign in through the official CLI to continue.')
            except (OSError, ValueError, ProviderError):
                saved.update(state='check_failed', error='The official CLI account could not be verified. Check or sign in again.', detail='No account status was confirmed.')
        if pid in ('codex', 'claude'):
            folder = self.data / 'cli-setup'
            folder.mkdir(parents=True, exist_ok=True)
            try:
                code, output = _command(argv + (['login', 'status'] if pid == 'codex' else ['auth', 'status']), folder)
                if pid == 'codex':
                    present = code == 0
                    absent = code == 1 and bool(re.search(r'not logged in|not signed in|no credentials', output, re.I))
                else:
                    parsed = json.loads(output)
                    present = code == 0 and isinstance(parsed, dict) and parsed.get('loggedIn') is True
                    absent = code == 1 and isinstance(parsed, dict) and parsed.get('loggedIn') is False
                if present:
                    saved.update(state='signed_in', detail='The official CLI reports a saved sign-in. Model access and usage limits are checked when you send.')
                elif absent:
                    saved.update(state='signed_out', detail='No saved sign-in was reported. Sign in through the official CLI.')
                else:
                    saved.update(state='check_failed', error='The CLI did not return a recognized account status.',
                        detail='Use the official terminal to check sign-in, then try again here.')
            except (OSError, ValueError, ProviderError):
                saved.update(state='check_failed', error='Could not check the CLI account. Use the official terminal.',
                    detail='No account status was confirmed.')
        with self.lock:
            # A status result that started before a new sign-in cannot restore
            # the prior account's Ready badge during/after that newer attempt.
            current = self.logins.get(pid) is observed_login
            if current:
                self.states[pid] = saved
                self._save()
        if current and saved['state'] == 'signed_in' and before != 'signed_in':
            self._signed_in(pid)
        return self.snapshot(pid)

    def use(self, pid):
        """Use this signed-in account for the tutor, visuals and notes (remembered choices, else defaults)."""
        _provider(pid)
        if pid in UNAVAILABLE: raise ValueError(UNAVAILABLE[pid])
        from . import account
        return account.choose(pid)

    def signout(self, pid):
        """Official sign-out on an explicit, confirmed click. It also signs that CLI
        out for other apps on this computer, which the confirmation states."""
        _provider(pid)
        if pid not in ('codex', 'claude'):
            raise ValueError('Sign out in the official app for this account.')
        argv, caps = _runtime(pid)
        if not argv: raise ValueError('The official CLI is not installed.')
        folder = self.data / 'cli-setup'
        folder.mkdir(parents=True, exist_ok=True)
        code, _ = _command(argv + (['logout'] if pid == 'codex' else ['auth', 'logout']), folder)
        if code != 0:
            raise ValueError('The official CLI did not confirm the sign-out. Try again.')
        with self.lock:
            self.states[pid] = {'state': 'signed_out', 'checked_at': time.time(), 'error': None,
                'detail': 'Signed out. Sign in again to use this account.'}
            self._save()
        from . import account
        account.forget(pid)
        return self.snapshot(pid)

    def login(self, pid):
        _provider(pid)
        if pid in UNAVAILABLE: raise ValueError(UNAVAILABLE[pid])
        argv, caps = _runtime(pid)
        if not argv: raise ValueError('Install the official CLI first using its setup guide.')
        if not caps.get('supported'): raise ValueError(caps.get('reason') or 'This CLI version is not supported.')
        with self.lock:
            prior = self.logins.get(pid)
            if prior and prior.state in ACTIVE: return self.snapshot(pid)
            attempt = Login()
            self.logins[pid] = attempt
            self.states[pid] = {'state': 'unchecked', 'checked_at': None, 'error': None,
                'detail': 'Complete the official sign-in before using this connection.'}
            self._save()
            if PROVIDERS[pid]['login_mode'] == 'terminal':
                attempt.state = 'manual'
                return self.snapshot(pid)
            folder = self.data / 'cli-setup'
            folder.mkdir(parents=True, exist_ok=True)
            def work():
                pending = ''
                def chunk(raw):
                    nonlocal pending
                    pending = (pending + raw.decode('utf8', errors='replace'))[-8192:]
                    url, code = device_prompt(pending, pid) if pid in ('codex', 'kimi-cli') else (None, None)
                    if url:
                        with self.lock:
                            if not attempt.cancel.is_set():
                                attempt.url, attempt.code, attempt.state = url, code, 'waiting'
                try:
                    if pid in ('gemini-cli', 'kimi-cli'):
                        from . import cli_runners
                        if pid == 'kimi-cli':
                            attempt.proc = _spawn(argv + ['login'], folder)
                            attempt.state = 'waiting'
                            result = _collect(attempt.proc, attempt.cancel, LOGIN_TIMEOUT, chunk, kill_tree=False)
                            if result != 0: raise ProviderError('Kimi sign-in did not complete.')
                        rows = acp_account(pid, argv, folder, attempt=attempt, login=True)
                        cli_runners.save_account_models(pid, rows)
                        result = 0
                    else:
                        args = ['login', '--device-auth'] if pid == 'codex' else ['auth', 'login']
                        attempt.proc = _spawn(argv + args, folder)
                        if PROVIDERS[pid]['login_mode'] == 'browser': attempt.state = 'waiting'
                        result = _collect(attempt.proc, attempt.cancel, LOGIN_TIMEOUT, chunk, kill_tree=pid == 'codex')
                    confirmed = False
                    with self.lock:
                        if attempt.cancel.is_set(): attempt.state = 'cancelled'
                        elif result == 0:
                            confirmed = True
                            attempt.url = attempt.code = None
                            self.states[pid] = {'state': 'signed_in', 'checked_at': time.time(),
                                'detail': 'Official CLI sign-in completed. Model access and usage limits are checked when you send.', 'error': None}
                            self._save()
                        else:
                            attempt.state, attempt.error = 'failed', 'Sign-in did not complete. Try again or use the official terminal.'
                    if confirmed:
                        # Defaults are saved before the page sees success, so it shows the final models.
                        self._signed_in(pid)
                        with self.lock: attempt.state = 'succeeded'
                except (OSError, ProviderError):
                    with self.lock:
                        incomplete = attempt.proc is not None and (attempt.proc.poll() is None or not getattr(attempt.proc, '_kinema_cleanup_confirmed', False))
                        attempt.state = 'cancelling' if incomplete else 'cancelled' if attempt.cancel.is_set() else 'failed'
                        attempt.error = ('The sign-in process or output cleanup has not stopped; close the official sign-in terminal.' if incomplete
                            else None if attempt.cancel.is_set() else 'Sign-in could not finish. Try again or use the official terminal.')
                finally:
                    pending = ''
                    with self.lock:
                        attempt.url = attempt.code = None
            attempt.thread = threading.Thread(target=work, name='kinema-account-signin', daemon=True)
            attempt.thread.start()
        return self.snapshot(pid)

    def cancel(self, pid):
        _provider(pid)
        with self.lock:
            attempt = self.logins.get(pid)
            if not attempt or attempt.state not in ACTIVE: return self.snapshot(pid)
            attempt.cancel.set()
            attempt.state = 'cancelling'
            attempt.url = attempt.code = None
        if attempt.thread: attempt.thread.join(timeout=1)
        return self.snapshot(pid)

    def select(self, pid, body):
        from .main import _save_settings
        from .provider_connections import store
        from . import model_choices
        current = self.snapshot(pid)
        if not current['connected']:
            raise ValueError('Sign in to this account first.')
        role, model = body.get('role', 'chat'), body.get('model')
        if role not in model_choices.ROLES: raise ValueError('Choose Tutor, Visuals or Notes.')
        row = next((m for m in current['models'] if m['id'] == model), None)
        if not row: raise ValueError('Choose a supported model from this installed CLI.')
        patch = {role + '_model': model, role + '_effort': body.get('effort', row['default_effort']),
                 role + '_speed': body.get('speed', 'standard')}
        model_choices.validate_selection(patch, role)
        _save_settings(patch)
        store().complete_onboarding()

    def close(self):
        with self.lock:
            attempts = list(self.logins.values())
            for attempt in attempts:
                if attempt.state in ACTIVE:
                    attempt.cancel.set()
                    attempt.state = 'cancelling'
                    attempt.url = attempt.code = None
        deadline = time.monotonic() + 15
        for attempt in attempts:
            if attempt.thread: attempt.thread.join(timeout=max(0, deadline - time.monotonic()))
        if self.refresher:
            self.refresher.join(timeout=max(0, deadline - time.monotonic()))
        complete = not (self.refresher and self.refresher.is_alive())
        with self.lock:
            for attempt in attempts:
                proc = attempt.proc
                reader = getattr(proc, '_kinema_output_reader', None) if proc else None
                readers = getattr(proc, '_kinema_output_readers', []) if proc else []
                pending = (attempt.thread and attempt.thread.is_alive()) or (proc and proc.poll() is None) or (reader and reader.is_alive()) or any(t.is_alive() for t in readers)
                if pending:
                    complete = False
                    attempt.state, attempt.error = 'cancelling', 'Sign-in cleanup is not confirmed. Close the official sign-in terminal.'
                elif attempt.state == 'cancelling':
                    if proc:
                        for name in ('stdin', 'stdout', 'stderr'):
                            stream = getattr(proc, name, None)
                            if stream:
                                try: stream.close()
                                except (OSError, ValueError): pass
                        proc._kinema_cleanup_confirmed = True
                    attempt.state, attempt.error = 'cancelled', None
        return complete


def manager():
    from .main import DATA
    key = str(Path(DATA).resolve())
    with _LOCK:
        if key not in _MANAGERS: _MANAGERS[key] = Manager(DATA)
        return _MANAGERS[key]


@atexit.register
def _cleanup():
    return all([saved.close() for saved in list(_MANAGERS.values())])
