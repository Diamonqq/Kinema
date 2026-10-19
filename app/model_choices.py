"""Explicit model choices shared by every tutoring entry point. No provider fallback."""
from __future__ import annotations

import json
import os
import tempfile
import time
from pathlib import Path

from . import providers

# Current connected catalog checked 2026-09-28. Only runners Kinema actually supports.
MODELS = [
    ("codex:gpt-6-luna", "GPT-6 Luna"), ("codex:gpt-6-astra", "GPT-6 Astra"),
    ("codex:gpt-6-sol", "GPT-6 Sol"), ("claude:claude-opus-5-5", "Opus 5.5"),
    ("claude:claude-sonnet-5-5", "Sonnet 5.5"), ("claude:claude-haiku-5-5", "Haiku 5.5"), ("claude:claude-fable-5-1", "Fable 5.1"),
    ("codex:gpt-5.6-sol", "GPT-5.6 Sol"), ("codex:gpt-5.6-terra", "GPT-5.6 Terra"),
    ("codex:gpt-5.6-luna", "GPT-5.6 Luna"),
]
ROLES = ("chat", "build", "notes")
# Owner 2026-10-15: Haiku teaches from prepared references; Opus builds visuals.
# Saved explicit choices are kept; a saved empty build_model still reads legacy settings.
DEFAULTS = {"chat_model": "claude:claude-haiku-5-5", "chat_effort": "medium", "chat_speed": "standard",
            "build_model": "claude:claude-opus-5-5", "build_effort": "medium", "build_speed": "standard",
            "notes_model": "claude:claude-opus-5-5", "notes_effort": "high", "notes_speed": "standard"}


def catalog():
    from .provider_connections import store
    from .cli_connections import manager
    legacy = [] if os.environ.get('KINEMA_DISTRIBUTION') == 'public' else [
        {"id": mid, "label": name, "provider": mid.split(':', 1)[0],
         "efforts": ["low", "medium", "high", "xhigh"], "default_effort": "medium", "image_input": True,
         "speeds": ["standard", "fast"] if mid.startswith("codex:") else ["standard"]} for mid, name in MODELS]
    # Existing private-install choices stay exactly as saved. Public installations
    # show the supported official CLIs installed on this computer, plus API models.
    combined = legacy + manager().models() + store().models()
    return list({m['id']: m for m in reversed(combined)}.values())[::-1]


def label(mid):
    if mid in dict(MODELS):
        return dict(MODELS)[mid]
    return next((m['label'] for m in catalog() if m['id'] == mid), mid.split(":", 1)[-1])


def profile(settings, role="chat"):
    s = {**DEFAULTS, **settings}
    mid = s[role + "_model"]
    effort = s[role + "_effort"]
    if role == "build" and not effort:
        effort = s.get("effort", "high")
    if role == "build" and not mid:
        prov = s.get("provider", "claude")
        mid = prov + ":" + str(s.get({"claude": "claude_model", "codex": "model", "ollama": "ollama_model"}.get(prov, "model"), ""))
    choice = {"model": mid, "effort": effort, "speed": s[role + "_speed"], "label": label(mid)}
    language = s.get('tutor_language', 'auto')
    if language == 'auto':
        language = s.get('ui_language', 'en')
    if language != 'en':
        choice['language'] = language
    return choice


def current(role="chat"):
    from .main import _settings
    return profile(_settings(), role)


def context_usage(choice, meta):
    """Reported request totals only; these are not persistent window occupancy."""
    usage = meta.get("usage") or {}
    def count(key):
        value = usage.get(key)
        return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None
    incoming, outgoing = count("input_tokens"), count("output_tokens")
    cached = count("cached_input_tokens")
    if choice["model"].startswith("claude:"):
        # Claude reports uncached input separately; Codex input already includes cache.
        cached = (count("cache_creation_input_tokens") or 0) + (count("cache_read_input_tokens") or 0)
        if incoming is not None:
            incoming += cached
    return {"model": choice["model"], "input_tokens": incoming, "output_tokens": outgoing,
            "cached_tokens": cached, "recorded_at": time.time()}


def validate_patch(patch):
    choices = {m["id"]: m for m in catalog()}
    for role in ROLES:
        for key in ("model", "effort", "speed"):
            field = role + "_" + key
            if field in patch and not isinstance(patch[field], str):
                raise ValueError(f"{field} must be text")
        if role + "_model" in patch and patch[role + "_model"] not in choices:
            raise ValueError("Choose a supported model; the selection was not changed.")
        if role + "_effort" in patch and patch[role + "_effort"] not in ("default", "low", "medium", "high", "xhigh", "max", "ultra"):
            raise ValueError("Choose a supported thinking effort.")
        if role + "_speed" in patch and patch[role + "_speed"] not in ("standard", "fast"):
            raise ValueError("Choose Standard or Fast.")


def validate_selection(settings, role='chat'):
    selected = profile(settings, role)
    model = next((m for m in catalog() if m['id'] == selected['model']), None)
    if not model:
        raise ValueError('Choose a model from an available connection.')
    if selected['effort'] not in model['efforts']:
        raise ValueError('Choose one of this model’s supported effort levels.')
    if selected['speed'] not in model['speeds']:
        raise ValueError('This model supports Standard speed only.')
    return selected


def run(choice, prompt, *, schema_text=None, images=None, system=None, timeout=300, on_event=None, cancel=None):
    """Run exactly the requested provider/model; normalize plain answers across runners."""
    from . import localization
    system = (system or '') + localization.instruction({'tutor_language': choice.get('language', 'en')})
    mid, effort, speed = choice["model"], choice["effort"], choice["speed"]
    prov, _, model = mid.partition(":")
    from .main import _settings
    from . import account
    active = str(_settings().get('account_provider') or '')
    if active == 'antigravity':
        raise providers.ProviderError('Antigravity is no longer offered. Sign in with Google in Accounts and choose Gemini CLI.')
    if active and not account.connected(active):
        raise providers.ProviderError('Sign in to the selected account in Accounts before sending.')
    if active in ('openai', 'anthropic', 'gemini', 'kimi', 'openrouter'):
        from .provider_connections import store
        saved = store().public(active)
        if not saved.get('verified_at') or saved.get('error'):
            raise providers.ProviderError('Verify the selected account in Accounts before sending.')
    if prov not in ('codex', 'claude', 'gemini-cli', 'kimi-cli', 'antigravity', 'openai', 'anthropic', 'gemini', 'kimi', 'openrouter'):
        raise providers.ProviderError('Choose a signed-in account in Accounts before sending.')
    if prov in ('codex', 'claude', 'gemini-cli', 'kimi-cli', 'antigravity'):
        from . import cli_runners
        cli_runners.require_account(prov)
    elif prov in ('openai', 'anthropic', 'gemini', 'kimi', 'openrouter'):
        from .provider_connections import store
        row = store().public(prov)
        if not row.get('connected') or not row.get('verified_at') or row.get('error'):
            raise providers.ProviderError('Connect and verify this account in Accounts before sending.')
    if prov in ('gemini-cli', 'kimi-cli'):
        from . import cli_runners
        return cli_runners.run(choice, prompt, schema_text=schema_text, images=images, system=system,
                               timeout=timeout, on_event=on_event, cancel=cancel)
    if prov in ('openai', 'anthropic', 'gemini', 'kimi', 'openrouter'):
        from . import cloud_providers
        return cloud_providers.run(choice, prompt, schema_text=schema_text, images=images, system=system,
                                   timeout=timeout, on_event=on_event, cancel=cancel)
    if speed not in ("standard", "fast") or (prov != "codex" and speed != "standard"):
        raise providers.ProviderError("Fast is available for Codex models only. Choose Standard for this model.")
    if prov == "claude":
        if effort not in providers.CLAUDE_EFFORTS:
            raise providers.ProviderError("Unsupported thinking effort")
        return providers.run_claude(prompt, model, effort, images=images or [], schema_text=schema_text,
                                    system=system, timeout=timeout, on_event=on_event, cancel=cancel)
    full = ((system + "\n\n") if system else "") + prompt
    from . import cli_runners
    supported_codex = set(providers.CODEX_MODELS) | set(cli_runners.capabilities('codex').get('models', []))
    if prov != "codex" or model not in supported_codex or effort not in providers.CODEX_EFFORTS:
        raise providers.ProviderError(f"Unsupported model or effort: {mid}. Select a model in Models.")
    wrapped = schema_text is None
    schema = schema_text or json.dumps({"type": "object", "properties": {"answer": {"type": "string"}},
                                        "required": ["answer"], "additionalProperties": False})
    if wrapped:
        full += "\nReturn your complete answer in the JSON answer field."
    providers.SANDBOX.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", suffix=".json", encoding="utf-8", delete=False, dir=providers.SANDBOX) as handle:
        handle.write(schema)
        path = Path(handle.name)
    try:
        if model == providers.LUNA_MODEL and speed == "fast" and not images:
            text, meta = providers.run_luna(full, path, effort=effort, timeout=timeout, on_event=on_event, cancel=cancel)
        else:
            text, meta = providers.run_codex(full, images or [], model, effort, path, timeout=timeout, tier=speed,
                                           on_event=on_event, cancel=cancel)
        if wrapped:
            text = str(providers.extract_json(text).get("answer") or "")
            if not text.strip():
                raise providers.ProviderError("The selected model returned an empty answer.")
        return text, meta
    finally:
        path.unlink(missing_ok=True)
