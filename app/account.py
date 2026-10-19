"""The account Kinema tutors with, its recommended models and each account's remembered choices.

The chosen account is the setting `account_provider` in settings.json, stored with the other
settings. `account.json` keeps, per account, only the model choices the learner made while that
account was in use (`remembered`), so switching back restores them. A role with no remembered
choice gets the account's recommended default. Signing in never changes the account in use
once that account is still connected. Existing installs are migrated once: the account already
in use keeps its exact models and remembered choices.
"""
from __future__ import annotations

import json
import os
import re
import threading
from pathlib import Path

_LOCK = threading.RLock()
ROLES = ('chat', 'build', 'notes')
FIELD = 'account_provider'


def _path() -> Path:
    from .main import DATA
    return Path(DATA) / 'account.json'


def read() -> dict:
    try:
        data = json.loads(_path().read_text(encoding='utf-8'))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _write(data: dict):
    path = _path(); path.parent.mkdir(parents=True, exist_ok=True)
    pending = path.with_suffix('.pending')
    pending.write_text(json.dumps(data), encoding='utf-8'); os.replace(pending, path)


def _accounts() -> set[str]:
    """Every provider Kinema can sign in to: official CLIs and API-key connections."""
    from .cli_connections import PROVIDERS as CLI
    from .provider_connections import PROVIDERS as API
    return set(CLI) | set(API)


def _version(slug: str) -> tuple:
    match = re.search(r'(\d+(?:\.\d+)*)', slug)
    return tuple(int(x) for x in match.group(1).split('.')) if match else ()


def _pick(ids, *preferred):
    return next((p for p in preferred if p in ids), None)


def recommend(pid: str, models: list[dict]) -> dict:
    """{role: (model id, effort)} from the provider's verified live catalog."""
    ids = [m['id'] for m in models if m.get('provider') == pid or m['id'].startswith(pid + ':')]
    efforts = {m['id']: m.get('efforts') or ['default'] for m in models}
    eff = lambda mid, want: want if want in efforts.get(mid, []) else 'default' if 'default' in efforts.get(mid, []) else (efforts.get(mid) or ['default'])[0]
    if not ids:
        return {}
    if pid == 'claude':
        # Owner direction: Haiku tutors from prepared references; Opus builds visuals and notes.
        tutor = _pick(ids, 'claude:claude-haiku-5-5', 'claude:haiku') or ids[0]
        builder = _pick(ids, 'claude:claude-opus-5-5', 'claude:opus') or tutor
    elif pid == 'codex':
        # The bundled Codex catalog is ordered by OpenAI's priority: the first listed
        # model is the flagship builder; its small "-luna"/"-mini" sibling tutors quickly.
        builder = next((i for i in ids if not re.search(r'mini|nano|-luna$', i)), ids[0])
        family = re.sub(r'-(sol|terra|luna)$', '', builder)
        tutor = _pick(ids, family + '-luna', family + '-mini') or next((i for i in ids if re.search(r'-luna$|mini', i)), builder)
    elif pid == 'antigravity':
        # Slugs carry the thinking level, e.g. gemini-3.8-flash-medium. Flash tutors;
        # the strongest listed model (Argon when the account has it, else Pro) builds.
        flash = sorted((i for i in ids if 'flash' in i), key=lambda i: (_version(i), i.endswith('-medium')), reverse=True)
        strong = [i for i in ids if 'argon' in i] or sorted((i for i in ids if '-pro' in i), key=_version, reverse=True)
        tutor = flash[0] if flash else ids[0]
        builder = next((i for i in strong if i.endswith('-medium')), strong[0] if strong else tutor)
    elif pid == 'gemini-cli':
        tutor = _pick(ids, 'gemini-cli:gemini-3.8-flash', 'gemini-cli:gemini-3.5-flash') or ids[0]
        builder = _pick(ids, 'gemini-cli:gemini-2.5-pro') or tutor
    else:
        tutor = builder = ids[0]
    return {'chat': (tutor, eff(tutor, 'medium')), 'build': (builder, eff(builder, 'medium')),
            'notes': (builder, eff(builder, 'medium'))}


def connected(pid: str) -> bool:
    """Signed in (official CLI) or connected with a verified key (API)."""
    from .cli_connections import manager, PROVIDERS as CLI
    from .provider_connections import store
    if pid in CLI:
        return manager().snapshot(pid)['state'] == 'signed_in'
    return pid in _accounts() and bool(store().public(pid)['connected'])


def _raw_settings() -> dict:
    from .main import SETTINGS_PATH
    try:
        data = json.loads(Path(SETTINGS_PATH).read_text(encoding='utf-8'))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _owner(model_id: str) -> str:
    return str(model_id).split(':', 1)[0]


def migrate():
    """Once, for installs from before the account choice: the account already in use keeps
    its exact three choices and remembered choices. Models are never rewritten here.
    The marker lives in account.json, because every settings save writes the new key too."""
    from .main import _settings, _save_settings
    with _LOCK:
        state = read()
        if state.get('migrated'):
            return
        raw = _raw_settings()
        chat = str(raw.get('chat_model') or '')
        pid = _owner(chat) if ':' in chat else state.get('provider')
        if pid in _accounts():
            cur = _settings()
            memory = state.setdefault('remembered', {}).setdefault(pid, {})
            for role in ROLES:
                model = str(cur.get(role + '_model') or '')
                if model.startswith(pid + ':') and role not in memory:
                    memory[role] = {'model': model, 'effort': cur.get(role + '_effort'), 'speed': cur.get(role + '_speed') or 'standard'}
            _save_settings({FIELD: pid})
        state.pop('provider', None); state.pop('auto', None)
        state['migrated'] = True
        _write(state)


def active_provider() -> str | None:
    """The account Kinema tutors with, or None before one is chosen."""
    from .main import _settings
    migrate()
    pid = str(_settings().get(FIELD) or '')
    return pid if pid in _accounts() else None


def choose(pid: str) -> dict:
    """Use this account for the tutor, visuals and notes. Each role takes the account's
    remembered choice when it still exists in the verified catalog, else its recommended
    default. Returns {role: [model, effort, speed]} for all three roles."""
    from . import model_choices
    from .main import _save_settings
    if pid not in _accounts():
        raise ValueError('Choose a supported account.')
    if not connected(pid):
        raise ValueError('Sign in to this account first.')
    from .cli_connections import manager
    from .provider_connections import store
    own = [m for m in manager().models() + store().models() if _owner(m['id']) == pid]
    plan = recommend(pid, own or model_choices.catalog())
    if not plan:
        raise ValueError('This account has no models yet. Check its connection.')
    with _LOCK:
        state = read()
        memory = (state.get('remembered') or {}).get(pid) or {}
        listed = {m['id'] for m in model_choices.catalog()}
        patch, applied = {FIELD: pid}, {}
        for role in ROLES:
            kept = memory.get(role)
            if isinstance(kept, dict) and str(kept.get('model') or '') in listed and _owner(kept['model']) == pid:
                model, effort, speed = kept['model'], kept.get('effort'), kept.get('speed') or 'standard'
            else:
                model, effort = plan[role]; speed = 'standard'
            patch.update({role + '_model': model, role + '_effort': effort, role + '_speed': speed})
            applied[role] = [model, effort, speed]
        _save_settings(patch)
    return applied


def adopt(pid: str):
    """A new sign-in becomes the account in use only when no connected account is in use."""
    current = active_provider()
    if current and connected(current):
        return {}
    return choose(pid)


def remember(patch: dict):
    """Record model choices the learner made while an account is in use. Call after saving."""
    from .main import _settings
    if not any(str(key).split('_', 1)[0] in ROLES for key in patch):
        return
    pid = active_provider()
    if not pid:
        return
    cur = _settings()
    with _LOCK:
        state = read()
        memory = state.setdefault('remembered', {}).setdefault(pid, {})
        for role in ROLES:
            if not any(role + '_' + key in patch for key in ('model', 'effort', 'speed')):
                continue
            model = str(cur.get(role + '_model') or '')
            if model.startswith(pid + ':'):
                memory[role] = {'model': model, 'effort': cur.get(role + '_effort'), 'speed': cur.get(role + '_speed') or 'standard'}
        _write(state)


def forget(pid: str):
    """After signing out of the account in use, no account is chosen; remembered choices are kept."""
    from .main import _save_settings
    with _LOCK:
        if active_provider() == pid:
            _save_settings({FIELD: ''})
