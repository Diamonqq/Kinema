"""Official CLI processes, with native credentials and no shell interpolation.

Catalog reads never launch a process. Explicit Check probes only local help,
version and Codex's bundled (offline) model catalog. No credentials are read here.
Gemini controls are verified against official v0.64.0 source; Kimi against 2.2.0.
Account model lists come from authenticated ACP session discovery.
"""
from __future__ import annotations

import copy
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import tempfile
import threading
import time
from pathlib import Path

from .providers import ProviderError

MAX_OUTPUT = 8 * 1024 * 1024
MAX_INPUT = 4 * 1024 * 1024
NO_WINDOW = 0x08000000 if os.name == "nt" else 0
_CHECKS: dict[tuple, dict] = {}
_LOCK = threading.RLock()
_COMMANDS = {"codex": "codex", "claude": "claude", "gemini-cli": "gemini", "kimi-cli": "kimi"}
_PACKAGES = {"codex": "@openai/codex", "claude": "@anthropic-ai/claude-code",
             "gemini-cli": "@google/gemini-cli", "kimi-cli": "@moonshot-ai/kimi-code"}
# Stable concrete IDs only. Preview aliases can be silently downgraded by Gemini.
GEMINI_MODELS = ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-3.5-flash", "gemini-3.8-flash"]
KIMI_MODELS = ["kimi-code/kimi-for-coding"]
PUBLIC_CODEX_MODELS = ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.2"]


def official_env(provider):
    """Keep native CLI OAuth; inherited API keys must not choose another account."""
    env = os.environ.copy()
    keys = ('GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_USE_VERTEXAI', 'GOOGLE_APPLICATION_CREDENTIALS') if provider == 'gemini-cli' else ('KIMI_API_KEY', 'MOONSHOT_API_KEY', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'KIMI_BASE_URL')
    for key in keys: env.pop(key, None)
    return env


def _argv_for_path(path: Path, provider: str) -> list[str] | None:
    """Unwrap official npm launchers; never run .cmd/.bat through a shell."""
    if not path.is_file():
        return None
    if path.suffix.lower() in {".cmd", ".bat", ".ps1"}:
        if provider not in _PACKAGES:
            return None
        package = path.parent / "node_modules" / _PACKAGES[provider]
        try:
            meta = json.loads((package / "package.json").read_text(encoding="utf-8"))
            if meta.get("name") != _PACKAGES[provider]:
                return None
            entries = meta.get("bin")
            entry = entries.get(_COMMANDS[provider]) if isinstance(entries, dict) else entries
            if not isinstance(entry, str):
                return None
            script = (package / entry).resolve()
            if not script.is_relative_to(package.resolve()) or not script.is_file():
                return None
            node = path.parent / "node.exe"
            node_path = str(node) if node.is_file() else shutil.which("node")
            return [node_path, str(script)] if node_path else None
        except (OSError, ValueError, TypeError):
            return None
    return [str(path.resolve())]


def resolve_binary(provider: str) -> list[str] | None:
    """Filesystem-only discovery shared by login checks and generation."""
    if provider not in _COMMANDS:
        return None
    override = os.environ.get("KINEMA_" + provider.replace("-cli", "").upper())
    if override:
        return _argv_for_path(Path(override), provider)
    if provider == "codex":
        from . import providers
        # Preserve the owner's bundled-runtime preference without running --version
        # during catalog reads. Explicit Check obtains the actual runtime metadata.
        base = providers.CODEX_BIN_ROOT
        if base.is_dir():
            bins = [p / "codex.exe" for p in base.iterdir()
                    if p.is_dir() and re.fullmatch(r"[0-9a-f]{16}", p.name) and (p / "codex.exe").is_file()]
            if bins:
                return [str(max(bins, key=lambda p: p.stat().st_mtime).resolve())]
    found = shutil.which(_COMMANDS[provider])
    return _argv_for_path(Path(found), provider) if found else None


def _identity(provider: str, argv: list[str] | None = None) -> tuple:
    argv = argv or resolve_binary(provider) or []
    def stamp(path):
        try: return Path(path).stat().st_mtime_ns
        except OSError: return 0
    return (provider, *[(p, stamp(p)) for p in argv])


def _catalog_path():
    return Path(os.environ.get("KINEMA_DATA") or Path(__file__).resolve().parents[1] / "data") / "cli-runtime-models.json"


def _account_models_path():
    return _catalog_path().with_name("cli-account-models.json")


def account_models(provider: str) -> list[dict]:
    """Model rows the signed-in CLI listed for this account (no auth data)."""
    try:
        path = _account_models_path()
        if path.stat().st_size > 128000:
            return []
        rows = json.loads(path.read_text(encoding="utf-8")).get(provider) or []
        return [_row(r["id"], ["default"], False) | {"label": r.get("label") or r["id"]} for r in rows[:100]
                if isinstance(r, dict) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/-]{0,120}", str(r.get("id", "")))]
    except (OSError, ValueError, TypeError, AttributeError):
        return []


def save_account_models(provider: str, rows: list[dict]):
    path = _account_models_path()
    with _LOCK:
        try: data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError): data = {}
        data = data if isinstance(data, dict) else {}
        data[provider] = [{"id": r["id"], "label": str(r.get("label") or r["id"])[:80]} for r in rows[:100]]
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            pending = path.with_suffix(".pending")
            pending.write_text(json.dumps(data), encoding="utf-8"); os.replace(pending, path)
        except OSError:
            pass



def _catalog_key(identity):
    return hashlib.sha256(json.dumps(identity).encode()).hexdigest()


def _saved_codex_catalog(identity):
    path = _catalog_path()
    try:
        if path.stat().st_size > 128000:
            return {}
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("runtime") != _catalog_key(identity):
            return {}
        rows = data.get("model_rows")
        if not isinstance(rows, list) or not rows or len(rows) > 100:
            return {}
        valid = []
        for row in rows:
            if not isinstance(row, dict) or not re.fullmatch(r"gpt-[a-zA-Z0-9._-]{1,80}", str(row.get("id", ""))):
                return {}
            if not row.get("efforts") or any(x not in {"minimal", "low", "medium", "high", "xhigh", "max", "ultra"} for x in row["efforts"]):
                return {}
            valid.append(_row(row["id"], row["efforts"], bool(row.get("images")),
                              [x for x in row.get("speeds", []) if x in {"standard", "fast"}]))
        return {"supported": True, "reason": "", "model_rows": valid, "version": data.get("version")}
    except (OSError, ValueError, TypeError, KeyError):
        return {}


def _row(model, efforts, images=True, speeds=None):
    return {"id": model, "label": model, "efforts": list(efforts), "images": images,
            "speeds": list(speeds or ["standard"])}


def capabilities(provider: str) -> dict:
    """Cheap snapshot; does not invoke a CLI or inspect credential files."""
    from . import providers
    argv = resolve_binary(provider)
    identity = _identity(provider, argv)
    checked = copy.deepcopy(_CHECKS.get(identity, {})) if argv else {}
    if argv and provider == "codex" and not checked:
        checked = _saved_codex_catalog(identity)
    if provider == "codex":
        rows = copy.deepcopy(checked.get("model_rows") or [_row(x, ["low", "medium", "high", "xhigh"]) for x in PUBLIC_CODEX_MODELS])
        models = list(dict.fromkeys([r["id"] for r in rows] + providers.CODEX_MODELS))
        efforts, images = ["low", "medium", "high", "xhigh", "max", "ultra"], True
    elif provider == "claude":
        # The CLI's flag parser is broader than each model's supported effort.
        rows = [_row("opus", ["low", "medium", "high", "max"]),
                _row("sonnet", ["low", "medium", "high"]), _row("haiku", ["medium"])]
        models, efforts, images = list(providers.CLAUDE_MODELS), providers.CLAUDE_EFFORTS, True
    else:
        models = GEMINI_MODELS if provider == "gemini-cli" else KIMI_MODELS if provider == "kimi-cli" else []
        efforts, images = ["default"], False
        rows = [_row(x, efforts, images) for x in models]
    supported = bool(argv) and (checked.get("supported", provider in {"codex", "claude"}))
    reason = checked.get("reason", "" if supported else "Check this CLI installation before using it." if argv else "Install the official CLI, then check the connection.")
    return {"supported": supported, "reason": reason, "images": images, "efforts": list(efforts),
            "models": list(models), "model_rows": rows, "checked": bool(checked),
            "version": checked.get("version"), "installed": bool(argv)}


def _safe_error(provider: str, output: str, code=None) -> ProviderError:
    """Classify failures without returning CLI stderr, prompts or credentials."""
    message = output.lower()
    if any(x in message for x in ("rate limit", "quota", "429", "usage limit")):
        detail = "The account's usage limit was reached. No other model was tried."
    elif any(x in message for x in ("unauthorized", "authentication", "not logged", "login", "401", "oauth")):
        detail = "Sign in through the official CLI, then check the connection."
    elif any(x in message for x in ("unknown argument", "unexpected argument", "unknown option", "unrecognized")):
        detail = "Update the official CLI; this installation does not support the required controls."
    elif any(x in message for x in ("model", "not found", "404")):
        detail = "This exact model is unavailable. Choose a supported model; no replacement was tried."
    else:
        detail = "The official CLI could not complete this request. Check its connection and try again."
    return ProviderError(f"{_COMMANDS.get(provider, provider)}: {detail}")


class _WindowsJob:
    """Kill-on-close owns descendants, including npm's native runtime child."""
    def __init__(self, proc):
        import ctypes
        from ctypes import wintypes as w
        class Basic(ctypes.Structure):
            _fields_ = [("process_time", ctypes.c_longlong), ("job_time", ctypes.c_longlong),
                        ("flags", w.DWORD), ("min_working", ctypes.c_size_t), ("max_working", ctypes.c_size_t),
                        ("active", w.DWORD), ("affinity", ctypes.c_size_t), ("priority", w.DWORD), ("scheduling", w.DWORD)]
        class IO(ctypes.Structure):
            _fields_ = [(x, ctypes.c_ulonglong) for x in ("read_ops", "write_ops", "other_ops", "read_bytes", "write_bytes", "other_bytes")]
        class Extended(ctypes.Structure):
            _fields_ = [("basic", Basic), ("io", IO), ("process_memory", ctypes.c_size_t),
                        ("job_memory", ctypes.c_size_t), ("peak_process", ctypes.c_size_t), ("peak_job", ctypes.c_size_t)]
        self.api = ctypes.WinDLL("kernel32", use_last_error=True)
        self.api.CreateJobObjectW.restype = w.HANDLE
        self.api.CreateJobObjectW.argtypes = [ctypes.c_void_p, w.LPCWSTR]
        self.api.SetInformationJobObject.argtypes = [w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD]
        self.api.AssignProcessToJobObject.argtypes = [w.HANDLE, w.HANDLE]
        self.api.CloseHandle.argtypes = [w.HANDLE]
        self.handle = self.api.CreateJobObjectW(None, None)
        limits = Extended(); limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not self.handle or not self.api.SetInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)) or not self.api.AssignProcessToJobObject(self.handle, w.HANDLE(int(proc._handle))):
            self.close()
            raise ProviderError("The CLI process could not be isolated safely.")
        # Popen starts suspended so descendants cannot escape before assignment.
        nt = ctypes.WinDLL("ntdll")
        nt.NtResumeProcess.argtypes = [w.HANDLE]
        if nt.NtResumeProcess(w.HANDLE(int(proc._handle))) != 0:
            self.close()
            raise ProviderError("The CLI process could not be started safely.")

    def close(self):
        if self.handle:
            self.api.CloseHandle(self.handle)
            self.handle = None


def capture(argv: list[str], *, cwd: Path, stdin: str = "", timeout: float = 30,
            env: dict | None = None, cancel=None, limit: int = MAX_OUTPUT,
            on_line=None, stop_reason=None) -> subprocess.CompletedProcess:
    """Bounded pipes, wall time and complete owned process-tree cleanup."""
    if cancel and cancel.is_set():
        raise ProviderError("Cancelled")
    payload = stdin.encode("utf-8")
    if len(payload) > MAX_INPUT:
        raise ProviderError("The CLI request is too large.")
    if on_line:
        # Claude Code reports plan limits in its own stream; record them in passing.
        reply_line = on_line
        def on_line(line):
            if '"rate_limit_event"' in line:
                from . import account_usage
                account_usage.observe_claude_line(line)
            reply_line(line)
    timeout = max(.05, min(float(timeout), 1800))
    proc = None; job = None
    chunks = {"out": bytearray(), "err": bytearray()}
    exceeded = threading.Event()
    callback_errors = []
    readers = []
    def read(stream, name):
        pending = b""
        try:
            while data := stream.read1(8192):
                room = limit - len(chunks[name])
                chunks[name].extend(data[:max(0, room)])
                if len(data) > room:
                    exceeded.set(); return
                if name == "out" and on_line:
                    pending += data
                    while b"\n" in pending:
                        line, pending = pending.split(b"\n", 1)
                        on_line(line.decode("utf-8", "replace"))
            if pending and on_line:
                on_line(pending.decode("utf-8", "replace"))
        except (OSError, ValueError):
            pass
        except Exception as exc:
            callback_errors.append(exc)
    def write():
        try:
            proc.stdin.write(payload); proc.stdin.close()
        except (OSError, ValueError):
            pass
    try:
        proc = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                cwd=str(cwd), env=env, creationflags=(NO_WINDOW | 0x4) if os.name == "nt" else 0,
                                start_new_session=os.name != "nt", shell=False)
        if os.name == "nt":
            job = _WindowsJob(proc)
        for name, stream in (("out", proc.stdout), ("err", proc.stderr)):
            thread = threading.Thread(target=read, args=(stream, name), daemon=True)
            thread.start(); readers.append(thread)
        writer = threading.Thread(target=write, daemon=True); writer.start()
        deadline = time.monotonic() + timeout
        while True:
            if cancel and cancel.is_set():
                raise ProviderError("Cancelled")
            if exceeded.is_set():
                raise ProviderError("The CLI exceeded its output limit.")
            if callback_errors:
                raise ProviderError("The CLI response could not be processed.") from callback_errors[0]
            reason = stop_reason() if stop_reason else None
            if reason:
                raise ProviderError(reason)
            if time.monotonic() >= deadline:
                raise ProviderError("The CLI request timed out.")
            if proc.poll() is not None:
                break
            time.sleep(.03)
        # A process that exits can leave a child holding its pipes open.
        if job:
            job.close()
        elif os.name != "nt":
            try: os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError: pass
        for thread in readers:
            thread.join(2)
        writer.join(2)
        if exceeded.is_set():
            raise ProviderError("The CLI exceeded its output limit.")
        if callback_errors:
            raise ProviderError("The CLI response could not be processed.") from callback_errors[0]
        return subprocess.CompletedProcess(argv, proc.returncode, bytes(chunks["out"]).decode("utf-8", "replace"), bytes(chunks["err"]).decode("utf-8", "replace"))
    except OSError as exc:
        raise ProviderError("The official CLI could not be started. Check its installation.") from exc
    finally:
        if job:
            job.close()
        if proc is not None:
            if proc.poll() is None:
                if os.name != "nt":
                    try: os.killpg(proc.pid, signal.SIGKILL)
                    except ProcessLookupError: pass
                proc.kill()
            try: proc.wait(timeout=5)
            except subprocess.TimeoutExpired: raise ProviderError("CLI cleanup could not be confirmed.")
            for thread in readers:
                thread.join(2)
            for pipe in (proc.stdin, proc.stdout, proc.stderr):
                try: pipe.close()
                except (OSError, ValueError): pass


def _codex_rows(data: dict) -> list[dict]:
    rows = []
    for item in data.get("models", [])[:100]:
        model = item.get("slug", "")
        if not isinstance(model, str) or not re.fullmatch(r"gpt-[a-zA-Z0-9._-]{1,80}", model) or item.get("visibility") not in {None, "list"}:
            continue
        levels = [r.get("effort") for r in item.get("supported_reasoning_levels", []) if isinstance(r, dict)]
        levels = [x for x in levels if x in {"minimal", "low", "medium", "high", "xhigh", "max", "ultra"}]
        if not levels:
            continue
        speeds = ["standard"] + (["fast"] if "fast" in item.get("additional_speed_tiers", []) else [])
        rows.append(_row(model, levels, "image" in item.get("input_modalities", []), speeds))
    return rows


def _kimi_config_guard():
    """Native OAuth stays in its home; do not copy or parse credential stores.

    Kimi 2.2 has no per-process switch for global hooks/MCP/plugins. Refuse such
    setups rather than starting their programs or changing the owner's settings.
    """
    import tomllib
    home = Path(os.environ.get("KIMI_CODE_HOME") or Path.home() / ".kimi-code")
    config = home / "config.toml"
    if config.is_file():
        if config.stat().st_size > 1024 * 1024:
            raise ProviderError("Kimi configuration is too large to verify safely.")
        try:
            data = tomllib.loads(config.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            raise ProviderError("Kimi configuration could not be verified. Use the advanced API connection.") from None
        if data.get("hooks") or data.get("extra_agent_dirs") or data.get("plugins"):
            raise ProviderError("Kimi's configured hooks or plugins cannot be isolated by this CLI. Use the advanced API connection.")
    for path in (home / "mcp.json", home / "plugins" / "installed.json"):
        if path.is_file():
            if path.stat().st_size > 1024 * 1024:
                raise ProviderError("Kimi integrations could not be verified safely.")
            try: data = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                raise ProviderError("Kimi integrations could not be verified. Use the advanced API connection.") from None
            active = data.get("mcpServers") if path.name == "mcp.json" and isinstance(data, dict) else data
            if active:
                raise ProviderError("Kimi's configured MCP servers or plugins cannot be isolated by this CLI. Use the advanced API connection.")


def check_installation(provider: str) -> dict:
    """Explicit, offline installation check. Never authenticates or generates."""
    argv = resolve_binary(provider)
    if not argv:
        return capabilities(provider)
    checked = {"supported": False, "reason": "Update the official CLI to use this connection."}
    try:
        with tempfile.TemporaryDirectory(prefix="kinema-cli-check-") as temp:
            cwd = Path(temp)
            version = capture(argv + ["--version"], cwd=cwd, timeout=8, limit=32768)
            help_result = capture(argv + (["exec", "--help"] if provider == "codex" else ["--help"]), cwd=cwd, timeout=8, limit=256000)
            if version.returncode or help_result.returncode:
                raise ProviderError("The official CLI installation check failed.")
            match = re.search(r"\b(\d+)\.(\d+)\.(\d+)", version.stdout)
            checked["version"] = match.group(0) if match else None
            hv = help_result.stdout
            if provider == "codex":
                if not all(flag in hv for flag in ("--ignore-user-config", "--ignore-rules", "--output-schema")):
                    raise ProviderError("Update Codex to a version with isolated configuration support.")
                result = capture(argv + ["debug", "models", "--bundled"], cwd=cwd, timeout=8)
                rows = _codex_rows(json.loads(result.stdout)) if result.returncode == 0 else []
                if rows:
                    checked["model_rows"] = rows
            elif provider == "gemini-cli":
                if not match or tuple(map(int, match.groups())) < (0, 64, 0) or not all(flag in hv for flag in ("--output-format", "--prompt")):
                    raise ProviderError("Gemini CLI 0.64.0 or newer is required for isolated tool settings.")
            elif provider == "kimi-cli":
                if not match or tuple(map(int, match.groups())) < (2, 2, 0) or not all(flag in hv for flag in ("--agent-file", "--output-format", "--prompt", "provider")):
                    raise ProviderError("Install current Kimi Code 2.2.0 or newer; the archived kimi-cli is not supported.")
                _kimi_config_guard()
            elif provider == "claude":
                if not all(flag in hv for flag in ("--tools", "--setting-sources", "--strict-mcp-config")):
                    raise ProviderError("Update Claude Code to a version with isolated tool settings.")
            checked.update(supported=True, reason="")
    except (ProviderError, ValueError, TypeError) as exc:
        checked["reason"] = str(exc) if isinstance(exc, ProviderError) else "The CLI's offline metadata could not be read."
    with _LOCK:
        _CHECKS[_identity(provider, argv)] = checked
        if provider == "codex" and checked.get("supported") and checked.get("model_rows"):
            # Retain only safe catalog fields so a restart preserves exact choices.
            path = _catalog_path()
            data = {"runtime": _catalog_key(_identity(provider, argv)), "version": checked.get("version"), "model_rows": checked["model_rows"]}
            try:
                path.parent.mkdir(parents=True, exist_ok=True)
                with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, suffix=".tmp", delete=False) as handle:
                    handle.write(json.dumps(data)); pending = Path(handle.name)
                try: os.replace(pending, path)
                finally: pending.unlink(missing_ok=True)
            except OSError:
                pass  # A read-only install still has this process's checked catalog.
    return capabilities(provider)


def refresh_codex_models():
    return check_installation("codex")["model_rows"]


def _gemini_settings(model: str) -> dict:
    # Override all built-in fallback families with the exact chosen model.
    chain = [{"model": model, "actions": {x: "prompt" for x in ("terminal", "transient", "not_found", "unknown")}, "stateTransitions": {x: "terminal" for x in ("terminal", "transient", "not_found", "unknown")}}]
    return {"tools": {"core": [], "discoveryCommand": "", "callCommand": ""},
            "hooksConfig": {"enabled": False}, "skills": {"enabled": False},
            "admin": {"extensions": {"enabled": False}, "mcp": {"enabled": False}, "skills": {"enabled": False}},
            "general": {"enableAutoUpdate": False, "checkpointing": {"enabled": False}},
            "telemetry": {"enabled": False, "logPrompts": False}, "privacy": {"usageStatisticsEnabled": False},
            "advanced": {"ignoreLocalEnv": True}, "context": {"fileName": "KINEMA_NO_CONTEXT", "includeDirectoryTree": False},
            "security": {"auth": {"selectedType": "oauth-personal"}},
            "experimental": {"dynamicModelConfiguration": True, "autoMemory": False, "enableAgents": False},
            "model": {"name": model},
            "modelConfigs": {"overrides": [], "modelIdResolutions": {model: {"default": model, "contexts": []}},
                             "modelChains": {x: chain for x in ("default", "preview", "auto-default", "auto-preview", "lite", model)}}}


def require_account(provider):
    from .cli_connections import manager, UNAVAILABLE
    if provider in UNAVAILABLE: raise ProviderError(UNAVAILABLE[provider])
    if provider == 'antigravity':
        raise ProviderError('This Google connection is unavailable. Choose another account in Accounts.')
    row = manager().snapshot(provider)
    if not row.get('connected') or not row.get('supported'):
        raise ProviderError('Sign in to this account in Accounts and check its connection before sending.')


def run(choice: dict, prompt: str, schema_text: str | None, images: list[str],
        system: str | None = None, timeout: int = 900, on_event=None, cancel=None):
    provider, _, model = str(choice.get("model", "")).partition(":")
    if provider == 'antigravity':
        require_account(provider)
    if provider not in {"gemini-cli", "kimi-cli"}:
        raise ProviderError("This official CLI adapter is unavailable.")
    if cancel and cancel.is_set():
        raise ProviderError("Cancelled")
    if images:
        raise ProviderError("This CLI connection cannot receive images in Kinema. Choose an image-capable connection.")
    if choice.get("effort", "default") != "default" or choice.get("speed", "standard") != "standard":
        raise ProviderError("This CLI connection uses its own default thinking settings and standard speed.")
    require_account(provider)
    allowed = [r['id'] for r in account_models(provider)]
    if model not in allowed:
        raise ProviderError("This exact CLI model is not supported; no replacement was tried.")
    caps = capabilities(provider)
    if not caps.get("checked"):
        caps = check_installation(provider)
    if not caps["supported"]:
        raise ProviderError(caps["reason"])
    wrapped = schema_text is None
    try:
        schema = json.loads(schema_text) if schema_text else {"type": "object", "properties": {"answer": {"type": "string"}}, "required": ["answer"], "additionalProperties": False}
    except (ValueError, TypeError):
        raise ProviderError("The requested answer format is invalid.") from None
    if not isinstance(schema, dict):
        raise ProviderError("The requested answer format must be an object schema.")
    envelope = json.dumps({"instructions": system or "Answer the user's request.", "request": prompt,
                           "response_schema": schema}, ensure_ascii=False).replace("@", "\\u0040")
    request = "Treat the following JSON fields as instructions and request data. Return only the JSON object matching response_schema, with no tools or file references.\n" + envelope
    if len(request.encode("utf-8")) > MAX_INPUT:
        raise ProviderError("The CLI request is too large.")
    t0 = time.monotonic()
    if on_event:
        on_event({"type": "status", "phase": "responding"})
    with tempfile.TemporaryDirectory(prefix="kinema-cli-run-") as temp:
        cwd = Path(temp); env = official_env(provider); argv = resolve_binary(provider)
        if not argv:
            raise ProviderError("The official CLI is no longer installed.")
        if provider == "gemini-cli":
            # Windows skips system settings in user-writable folders as insecure, so the
            # isolation settings go in this temporary workspace, trusted for this run only.
            (cwd / ".gemini").mkdir()
            (cwd / ".gemini" / "settings.json").write_text(json.dumps(_gemini_settings(model)), encoding="utf-8")
            env.update(GEMINI_CLI_NO_RELAUNCH="true", NO_BROWSER="true", GOOGLE_GENAI_USE_GCA="true")
            # Non-TTY stdin is official headless input; the request is not a shell/argv string.
            result = capture(argv + ["--skip-trust", "-e", "none", "--allowed-mcp-server-names", "kinema-none",
                                     "--model", model, "--output-format", "json"], cwd=cwd, stdin=request,
                             timeout=timeout, env=env, cancel=cancel)
            if result.returncode:
                raise _safe_error(provider, result.stderr + result.stdout)
            try: payload = json.loads(result.stdout)
            except ValueError: raise ProviderError("Gemini CLI returned invalid JSON.") from None
            if payload.get("error"):
                raise _safe_error(provider, str(payload["error"]))
            answer = payload.get("response", "")
            usage = payload.get("stats", {})
            observed = set((usage.get("models") or {}).keys()) if isinstance(usage, dict) else set()
            if observed and observed != {model}:
                raise ProviderError("Gemini CLI reported a different model. Its answer was not used.")
        else:
            _kimi_config_guard()
            agent = cwd / "kinema.md"
            # The custom agent is an official file input. Put the complete JSON
            # request there, avoiding OS argv limits and exposing no prompt in
            # process listings. Escape template markers before Kimi renders it.
            agent.write_text("---\nname: kinema-tutor\ndescription: Kinema text-only tutor\ntools: []\nsubagents: []\n---\n" + request.replace("$", "\\u0024"), encoding="utf-8")
            skills = cwd / "empty-skills"; skills.mkdir()
            env.update(KIMI_CODE_NO_AUTO_UPDATE="1", KIMI_DISABLE_TELEMETRY="1", KIMI_CODE_WATCH="false",
                       KIMI_CODE_BACKGROUND_KEEP_ALIVE_ON_EXIT="false")
            result = capture(argv + ["--model", model, "--agent-file", str(agent), "--skills-dir", str(skills),
                                     "--output-format", "stream-json", "--prompt", "Answer the Kinema request supplied in your system instructions using its response schema."],
                             cwd=cwd, timeout=timeout, env=env, cancel=cancel)
            if result.returncode:
                raise _safe_error(provider, result.stderr + result.stdout)
            parts = []
            for line in result.stdout.splitlines():
                try: payload = json.loads(line)
                except ValueError: continue
                if payload.get("tool_calls") or payload.get("role") == "tool":
                    raise ProviderError("Kimi CLI attempted a tool call. Its answer was not used.")
                if payload.get("role") == "assistant" and isinstance(payload.get("content"), str):
                    parts.append(payload["content"])
            answer, usage = "\n".join(parts), {}
        if not isinstance(answer, str) or not answer.strip():
            raise ProviderError("The official CLI returned an empty answer.")
        from .providers import extract_json
        # Downstream tutor/scene validators validate the requested schema as usual.
        # This boundary additionally rejects malformed/non-object JSON immediately.
        value = extract_json(answer)
        if not isinstance(value, dict):
            raise ProviderError("The official CLI did not return a JSON object.")
        text = value.get("answer") if wrapped else json.dumps(value, ensure_ascii=False)
        if not isinstance(text, str) or not text.strip():
            raise ProviderError("The official CLI returned an invalid answer format.")
        if on_event:
            on_event({"type": "text" if wrapped else "json", "text": text})
        return text, {"provider": provider, "model": model, "effort": "default", "secs": round(time.monotonic() - t0, 1), "usage": usage}
