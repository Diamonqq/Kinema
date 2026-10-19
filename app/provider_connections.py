"""Per-install API connections. Secrets never enter learner settings or public payloads.

This is a local single-user installation, not authentication for a shared hosted server.
"""
from __future__ import annotations

import ctypes
import hashlib
import ipaddress
import json
import os
import secrets
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from .providers import ProviderError

@asynccontextmanager
async def connection_lifespan(app):
    try:
        yield
    finally:
        from .cli_connections import _cleanup
        if not await run_in_threadpool(_cleanup):
            # ASGI reports shutdown.failed rather than claiming owned auth work
            # stopped. The message contains no credential, command output or PID.
            raise RuntimeError('A Kinema sign-in process has unconfirmed cleanup. Close the official sign-in terminal.')


router = APIRouter(lifespan=connection_lifespan)
PROVIDERS = {
    'openai': {'label': 'OpenAI', 'env': 'OPENAI_API_KEY', 'url': 'https://platform.openai.com/api-keys'},
    'anthropic': {'label': 'Claude', 'env': 'ANTHROPIC_API_KEY', 'url': 'https://platform.claude.com/settings/keys'},
    'gemini': {'label': 'Gemini', 'env': 'GEMINI_API_KEY', 'url': 'https://aistudio.google.com/apikey'},
    'kimi': {'label': 'Kimi', 'env': 'MOONSHOT_API_KEY', 'url': 'https://platform.kimi.ai/console/api-keys'},
    'openrouter': {'label': 'OpenRouter', 'env': 'OPENROUTER_API_KEY', 'url': 'https://openrouter.ai/settings/keys'},
}
_STORES: dict[str, 'ConnectionStore'] = {}
_STORES_LOCK = threading.Lock()


def _provider(pid):
    if not isinstance(pid, str) or pid not in PROVIDERS:
        raise ValueError('Choose a supported provider.')
    return pid


class SecretStorage:
    """Windows user-bound DPAPI or an explicitly trusted OS keyring; never a file fallback."""
    def __init__(self, data: Path):
        self.data = data
        self.service = 'Kinema-' + hashlib.sha256(str(data.resolve()).encode()).hexdigest()[:24]
        self.backend = None
        self.kind = 'unavailable'
        if os.name == 'nt':
            self.kind = 'windows-dpapi'
        else:
            try:
                import keyring
                candidate = keyring.get_keyring()
                if type(candidate).__module__ in ('keyring.backends.SecretService', 'keyring.backends.macOS') and candidate.priority > 0:
                    self.backend = candidate
                    self.kind = 'os-keyring'
            except Exception:
                pass

    def _path(self, pid):
        return self.data / 'connections' / (_provider(pid) + '.dpapi')

    def _crypt(self, raw: bytes, pid: str, decrypt=False) -> bytes:
        from ctypes import wintypes
        class Blob(ctypes.Structure):
            _fields_ = [('cbData', wintypes.DWORD), ('pbData', ctypes.POINTER(ctypes.c_ubyte))]
        def blob(value):
            buf = ctypes.create_string_buffer(value)
            return Blob(len(value), ctypes.cast(buf, ctypes.POINTER(ctypes.c_ubyte))), buf
        incoming, keep_in = blob(raw)
        entropy, keep_entropy = blob((self.service + ':' + pid).encode())
        outgoing = Blob()
        crypt32 = ctypes.WinDLL('crypt32', use_last_error=True)
        kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
        protect = crypt32.CryptUnprotectData if decrypt else crypt32.CryptProtectData
        protect.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.POINTER(Blob), ctypes.c_void_p,
                            ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
        protect.restype = wintypes.BOOL
        kernel32.LocalFree.argtypes = [ctypes.c_void_p]
        kernel32.LocalFree.restype = ctypes.c_void_p
        if not protect(ctypes.byref(incoming), None, ctypes.byref(entropy), None, None, 1, ctypes.byref(outgoing)):
            raise ProviderError('Secure storage is unavailable for this OS account. Use session-only storage or an environment key.')
        try:
            return ctypes.string_at(outgoing.pbData, outgoing.cbData)
        finally:
            kernel32.LocalFree(outgoing.pbData)

    def set(self, pid, value):
        try:
            if self.kind == 'windows-dpapi':
                encrypted = self._crypt(value.encode(), pid)
                target = self._path(pid)
                target.parent.mkdir(parents=True, exist_ok=True)
                tmp = target.with_suffix('.pending')
                tmp.write_bytes(encrypted)
                tmp.replace(target)
            elif self.backend:
                self.backend.set_password(self.service, _provider(pid), value)
            else:
                raise ProviderError('Secure storage is unavailable. Choose session-only storage or an environment key.')
        except ProviderError:
            raise
        except Exception:
            raise ProviderError('The OS could not save this credential securely.') from None

    def get(self, pid):
        try:
            if self.kind == 'windows-dpapi':
                path = self._path(pid)
                return self._crypt(path.read_bytes(), pid, True).decode() if path.exists() else None
            if self.backend:
                return self.backend.get_password(self.service, _provider(pid))
        except Exception:
            raise ProviderError('The saved credential could not be opened by this OS account. Reconnect the provider.') from None
        return None

    def delete(self, pid):
        try:
            if self.kind == 'windows-dpapi':
                self._path(pid).unlink(missing_ok=True)
            elif self.backend and self.backend.get_password(self.service, _provider(pid)) is not None:
                self.backend.delete_password(self.service, pid)
        except Exception:
            raise ProviderError('The saved Kinema credential could not be removed. Try disconnecting again.') from None


class ConnectionStore:
    def __init__(self, data: Path, secure=None):
        self.data = Path(data).resolve()
        self.path = self.data / 'connections.json'
        self.install_path = self.data / 'connections_install.json'
        self.secure = secure or SecretStorage(self.data)
        self.session = {}
        self.token = secrets.token_urlsafe(32)
        self.lock = threading.RLock()
        try:
            self.install = json.loads(self.install_path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            self.install = {'legacy_enabled': os.environ.get('KINEMA_DISTRIBUTION') != 'public' and (self.data / 'settings.json').exists(),
                            'onboarding_complete': False}

    def complete_onboarding(self):
        with self.lock:
            self.install['onboarding_complete'] = True
            self.data.mkdir(parents=True, exist_ok=True)
            tmp = self.install_path.with_suffix('.pending')
            tmp.write_text(json.dumps(self.install), encoding='utf-8')
            tmp.replace(self.install_path)

    def _read(self):
        try:
            value = json.loads(self.path.read_text(encoding='utf-8'))
            return {p: v for p, v in value.items() if p in PROVIDERS and isinstance(v, dict)} if isinstance(value, dict) else {}
        except (OSError, ValueError):
            return {}

    def _write(self, value):
        self.data.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix('.pending')
        tmp.write_text(json.dumps(value), encoding='utf-8')
        tmp.replace(self.path)

    def key(self, pid):
        _provider(pid)
        with self.lock:
            item = self._read().get(pid, {})
            mode = item.get('source')
            if mode == 'environment':
                value = os.environ.get(PROVIDERS[pid]['env'])
            elif mode == 'session':
                value = self.session.get(pid)
            elif mode == 'secure':
                value = self.secure.get(pid)
            else:
                value = None
            if not value:
                raise ProviderError(f"Connect {PROVIDERS[pid]['label']} in Connections before using this model.")
            return value

    def public(self, pid):
        _provider(pid)
        item = self._read().get(pid, {})
        source = item.get('source')
        connected = bool(source == 'secure' or source == 'session' and pid in self.session
                         or source == 'environment' and os.environ.get(PROVIDERS[pid]['env']))
        return {'id': pid, 'label': PROVIDERS[pid]['label'], 'connected': connected,
                'source': source if connected else None, 'verified_at': item.get('verified_at') if connected else None,
                'models': item.get('models', []) if connected else [], 'error': item.get('error'),
                'environment_available': bool(os.environ.get(PROVIDERS[pid]['env'])),
                'key_url': PROVIDERS[pid]['url'], 'environment_name': PROVIDERS[pid]['env']}

    def connect(self, pid, key=None, mode='secure'):
        from .cloud_providers import verify
        _provider(pid)
        if mode not in ('secure', 'session', 'environment'):
            raise ValueError('Choose secure, session-only, or environment storage.')
        if mode == 'environment':
            if key:
                raise ValueError('Environment connections read the named server environment variable.')
            key = os.environ.get(PROVIDERS[pid]['env'])
        if not isinstance(key, str) or not 10 <= len(key.strip()) <= 4096 or any(ord(c) < 33 for c in key.strip()):
            raise ValueError('Enter an API key, or configure the provider environment variable.')
        key = key.strip()
        if mode == 'secure' and self.secure.kind == 'unavailable':
            raise ProviderError('Secure storage is unavailable. Choose session-only storage or an environment key.')
        # Verify before replacing any working credential. GET only; no generation or fallback.
        with self.lock:
            models = verify(pid, key)
            before = self._read()
            old_source = before.get(pid, {}).get('source')
            if mode == 'secure':
                self.secure.set(pid, key)
            if old_source == 'secure' and mode != 'secure':
                self.secure.delete(pid)
            if mode == 'session':
                self.session[pid] = key
            else:
                self.session.pop(pid, None)
            before[pid] = {'source': mode, 'verified_at': time.time(), 'models': models, 'error': None}
            self._write(before)
            return self.public(pid)

    def verify(self, pid):
        from .cloud_providers import verify
        with self.lock:
            _provider(pid)
            try:
                models = verify(pid, self.key(pid))
            except ProviderError as exc:
                state = self._read()
                if pid in state:
                    state[pid]['error'] = str(exc)
                    self._write(state)
                raise
            state = self._read()
            state[pid].update(models=models, verified_at=time.time(), error=None)
            self._write(state)
            return self.public(pid)

    def disconnect(self, pid):
        _provider(pid)
        with self.lock:
            state = self._read()
            if state.get(pid, {}).get('source') == 'secure':
                self.secure.delete(pid)
            self.session.pop(pid, None)
            state.pop(pid, None)
            self._write(state)
            return self.public(pid)

    def models(self):
        return [m for pid in PROVIDERS for m in self.public(pid)['models']]


def store() -> ConnectionStore:
    from .main import DATA
    key = str(Path(DATA).resolve())
    with _STORES_LOCK:
        if key not in _STORES:
            _STORES[key] = ConnectionStore(Path(DATA))
        return _STORES[key]


def _loopback(value):
    if value == 'localhost':
        return True
    try:
        return ipaddress.ip_address(value).is_loopback
    except ValueError:
        return False


def guard(request: Request, mutate=False):
    # Fixed local deployment; don't trust forwarded headers as authentication.
    host = urlsplit('http://' + request.headers.get('host', '')).hostname or ''
    peer = request.client.host if request.client else ''
    if not _loopback(host) or not _loopback(peer):
        raise HTTPException(403, 'Connections are managed from this computer only.')
    origin = request.headers.get('origin')
    if origin and not _loopback(urlsplit(origin).hostname or ''):
        raise HTTPException(403, 'Open Connections in Kinema.')
    if mutate:
        if request.headers.get('content-type', '').split(';')[0].strip() != 'application/json':
            raise HTTPException(415, 'Send a JSON request.')


async def _connection_body(request: Request, limit=8192):
    # Panel's same-device proxy omits custom headers. The same per-process CSRF
    # nonce may travel in JSON, but local/origin/type/size checks still precede
    # parsing and every mutation must wait for constant-time nonce validation.
    guard(request, mutate=True)
    raw = bytearray()
    async for chunk in request.stream():
        if len(raw) + len(chunk) > limit:
            raise HTTPException(413, 'Connection request is too large.')
        raw.extend(chunk)
    try:
        body = json.loads(raw)
    except (ValueError, RecursionError):
        raise ValueError('Send a valid connection object.') from None
    if not isinstance(body, dict):
        raise ValueError('Use a connection object.')
    body_token = body.pop('_connection_token', None)
    header_token = request.headers.get('x-kinema-connection-token')
    token = header_token if header_token is not None else body_token
    if not isinstance(token, str) or len(token) > 256 or not secrets.compare_digest(
            token.encode('utf-8', errors='replace'), store().token.encode('utf-8')):
        raise HTTPException(403, 'Reopen Connections before changing an account.')
    return body


def status():
    from .cli_connections import manager
    saved = store()
    # Existing owner installs remain usable. Creating an explicit model selection writes settings.
    existing = saved.install.get('legacy_enabled') is True
    return {'onboarding_required': not existing and not saved.install.get('onboarding_complete'), 'storage': {'available': saved.secure.kind != 'unavailable', 'kind': saved.secure.kind},
            'providers': [saved.public(pid) for pid in PROVIDERS], 'legacy': {'enabled': existing},
            'cli': manager().snapshot_all(), 'account': _account(), 'token': saved.token}


def _account():
    from . import account
    from .main import _settings
    if _settings().get('account_provider') in ('antigravity', 'gemini-cli'):
        return {'provider': None, 'previous_provider': _settings()['account_provider'],
                'message': 'Google sign-in is unavailable. Choose another account in Accounts.'}
    try:
        provider = account.active_provider()
    except (OSError, ValueError):
        provider = None
    return {'provider': provider}


@router.get('/api/connections')
def connection_status(request: Request, refresh: bool = False):
    # Answers from saved status at once; refresh=1 re-checks old rows in the background.
    guard(request)
    if refresh:
        from .cli_connections import manager
        manager().refresh()
    return JSONResponse(status(), headers={'Cache-Control': 'no-store'})


@router.get('/api/connections/usage')
def account_usage_view(request: Request):
    guard(request)
    from . import account, account_usage
    return JSONResponse(account_usage.view(account.active_provider()), headers={'Cache-Control': 'no-store'})


@router.get('/api/connections/updates')
def updates_view(request: Request):
    guard(request)
    from . import cli_updates
    return JSONResponse(cli_updates.view(), headers={'Cache-Control': 'no-store'})


@router.post('/api/connections/updates/{pid}')
async def updates_start(pid: str, request: Request):
    from . import cli_updates
    try:
        body = await _connection_body(request, limit=1000)
        if body.get('confirm') is not True:
            raise ValueError('Choose Install or Update to run the official installer.')
        await run_in_threadpool(cli_updates.start, pid)
        return JSONResponse(cli_updates.view(), headers={'Cache-Control': 'no-store'})
    except ValueError as exc:
        return JSONResponse({'error': str(exc)}, status_code=400, headers={'Cache-Control': 'no-store'})


@router.post('/api/connections/{pid}/{action}')
async def connection_action(pid: str, action: str, request: Request):
    try:
        body = await _connection_body(request)
        _provider(pid)
        saved = store()
        if action == 'connect':
            await run_in_threadpool(saved.connect, pid, body.get('api_key'), body.get('storage', 'secure'))
        elif action == 'verify':
            await run_in_threadpool(saved.verify, pid)
        elif action == 'disconnect':
            await run_in_threadpool(saved.disconnect, pid)
            from . import account
            await run_in_threadpool(account.forget, pid)
        elif action == 'select':
            from .main import _save_settings
            from . import model_choices
            role = body.get('role', 'chat')
            if role not in model_choices.ROLES:
                raise ValueError('Choose Tutor, Visuals or Notes.')
            model = body.get('model')
            if not isinstance(model, str) or not model.startswith(pid + ':'):
                raise ValueError('Choose a model from this provider.')
            patch = {role + '_model': model, role + '_effort': body.get('effort', 'default'), role + '_speed': body.get('speed', 'standard')}
            model_choices.validate_selection({**patch}, role)
            await run_in_threadpool(_save_settings, patch)
            from . import account
            account.remember(patch)
            saved.complete_onboarding()
        elif action == 'use':
            from . import account
            changed = await run_in_threadpool(account.choose, pid)
            return JSONResponse({**status(), 'applied': changed}, headers={'Cache-Control': 'no-store'})
        else:
            raise ValueError('That connection action is unavailable.')
        return JSONResponse(status(), headers={'Cache-Control': 'no-store'})
    except (ValueError, ProviderError) as exc:
        return JSONResponse({'error': str(exc)}, status_code=400, headers={'Cache-Control': 'no-store'})


@router.post('/api/connections/onboarding')
async def finish_onboarding(request: Request):
    try:
        body = await _connection_body(request, limit=1000)
        if body.get('complete') is not True:
            raise ValueError('Choose Continue to finish setup.')
        store().complete_onboarding()
        return JSONResponse(status(), headers={'Cache-Control': 'no-store'})
    except ValueError as exc:
        return JSONResponse({'error': str(exc)}, status_code=400)


@router.post('/api/connections/cli/{pid}/{action}')
async def cli_action(pid: str, action: str, request: Request):
    from .cli_connections import manager
    try:
        body = await _connection_body(request, limit=4096)
        saved = manager()
        if action == 'check': await run_in_threadpool(saved.check, pid)
        elif action == 'login': await run_in_threadpool(saved.login, pid)
        elif action == 'cancel': await run_in_threadpool(saved.cancel, pid)
        elif action == 'select': await run_in_threadpool(saved.select, pid, body)
        elif action == 'use':
            changed = await run_in_threadpool(saved.use, pid)
            return JSONResponse({**status(), 'applied': changed}, headers={'Cache-Control': 'no-store'})
        elif action == 'signout':
            if body.get('confirm') is not True: raise ValueError('Confirm sign-out first.')
            await run_in_threadpool(saved.signout, pid)
        else: raise ValueError('That connection action is unavailable.')
        return JSONResponse(status(), headers={'Cache-Control': 'no-store'})
    except (ValueError, ProviderError) as exc:
        return JSONResponse({'error': str(exc)}, status_code=400, headers={'Cache-Control': 'no-store'})
