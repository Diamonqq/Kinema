"""Kinema — model runners. Three ways to get a scene JSON back:

* codex  — `codex exec` (the owner's ChatGPT subscription), with --output-schema so the final message IS the JSON;
           images ride via --image=<path>. Uses an explicit override, the owner's bundled runtime or the installed
           CLI, matching connection checks. Exact model IDs are never silently substituted.
* claude — `claude -p` streamed (the owner's Claude subscription; Opus 5.5 by default since 0.5.0), screenshots as
           image blocks in the first message, our own system prompt, structured output via --json-schema.
* ollama — the local Ollama (qwen3.8:27b …) with format=json; images as base64 when given.

Each returns (text, meta). extract_json() digs the object out of whatever came back.
Coding tools are disabled. Each invocation has an isolated working directory and bounded process-tree cleanup.
"""
from __future__ import annotations

import base64
import json
import os
import re
import subprocess
import tempfile
import threading
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
SANDBOX = Path(os.environ.get("KINEMA_DATA", ROOT / "data")) / "sandbox"
NO_WINDOW = 0x08000000 if os.name == "nt" else 0

CODEX_MODELS = ["gpt-6-luna", "gpt-6-sol", "gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]
CODEX_EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"]
CODEX_TIERS = {"fast": "priority", "standard": "default"}
LUNA_MODEL = "gpt-6-luna"
CODEX_BIN_ROOT = Path(os.environ.get("KINEMA_CODEX_BIN_ROOT") or Path(os.environ.get("LOCALAPPDATA", "")) / "OpenAI" / "Codex" / "bin")
_RUNTIME: dict = {}
# Owner, 2026-09-22 (Physics project): "i want you to become the ai model on kinema" -> Opus 5.5 is the default
# tutor. Full ids pin the version; the aliases stay for saved settings and API callers.
CLAUDE_MODELS = ["claude-opus-5-5", "claude-haiku-5-5", "claude-fable-5-1", "claude-sonnet-5-5", "claude-sonnet-5", "opus", "fable", "sonnet", "haiku"]
CLAUDE_LABELS = {"claude-sonnet-5-5": "Sonnet 5.5", "claude-opus-5-5": "Opus 5.5", "claude-haiku-5-5": "Haiku 5.5", "claude-fable-5-1": "Fable 5.1", "claude-sonnet-5": "Sonnet 5",
                 "opus": "Opus (latest)", "fable": "Fable (latest)", "sonnet": "Sonnet (latest)", "haiku": "Haiku (latest)"}
DEFAULT_CLAUDE_MODEL = "claude-opus-5-5"
CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"]      # `claude --help` 2.1.280
IMAGE_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif"}
MAX_IMAGE_BYTES = 3_700_000          # the API takes 5 MB of base64
NETWORK_GIVEUP_S = 20.0              # consecutive network retries before we say so
STALL_S = 150.0                      # no event at all for this long = stalled
OLLAMA = os.environ.get("KINEMA_OLLAMA", "http://127.0.0.1:11434")


class ProviderError(RuntimeError):
    pass


def _run(cmd: list[str], stdin_text: str, timeout: int, *, cancel=None) -> subprocess.CompletedProcess:
    from .cli_runners import capture, MAX_OUTPUT
    cwd = Path(cmd[cmd.index("-C") + 1])
    output = Path(cmd[cmd.index("-o") + 1])
    def output_limit():
        try:
            return "The CLI exceeded its output limit." if output.stat().st_size > MAX_OUTPUT else None
        except FileNotFoundError:
            return None
    result = capture(cmd, cwd=cwd, stdin=stdin_text, timeout=timeout, cancel=cancel, stop_reason=output_limit)
    return subprocess.CompletedProcess(cmd, result.returncode, result.stdout.encode(), result.stderr.encode())


def codex_runtime(*, refresh: bool = False) -> dict:
    """Same exact discovery as connection checks; no subprocess on catalog reads."""
    from .cli_runners import resolve_binary, capabilities, check_installation
    argv = resolve_binary("codex")
    caps = check_installation("codex") if refresh else capabilities("codex")
    return {"exe": argv[0] if argv else "codex", "argv": argv or ["codex"],
            "version": caps.get("version") or "installed", "bundled": bool(argv and CODEX_BIN_ROOT in Path(argv[0]).parents)}


def _version_key(text: str) -> tuple:
    """Semantic ordering retained for callers comparing runtime metadata."""
    match = re.search(r"(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z]+)[.-]([\d.]+))?", text)
    if not match:
        return (0, 0, 0, 0, ())
    major, minor, patch, tag, suffix = match.groups()
    return (int(major), int(minor), int(patch), 0 if tag else 1,
            tuple(int(x) for x in suffix.split(".")) if suffix else ())


def run_codex(prompt: str, images: list[str], model: str, effort: str, schema_path: Path,
              timeout: int = 480, tier: str | None = None, *, on_event=None, cancel=None) -> tuple[str, dict]:
    from .cli_runners import capabilities, _safe_error, MAX_OUTPUT
    caps = capabilities("codex")
    if model not in set(CODEX_MODELS) | set(caps["models"]):
        raise ProviderError("This exact Codex model is not supported; no replacement was tried.")
    row = next((r for r in caps["model_rows"] if r["id"] == model), None)
    if effort not in (row["efforts"] if row else CODEX_EFFORTS):
        raise ProviderError("This thinking effort is not supported by the selected Codex model.")
    if images and row and not row["images"]:
        raise ProviderError("The selected Codex model does not support images.")
    if tier is not None and tier not in CODEX_TIERS:
        raise ProviderError("Unknown Codex speed. Choose Standard or Fast.")
    if tier == "fast" and row and "fast" not in row["speeds"]:
        raise ProviderError("Fast is not supported by the selected Codex model.")
    if cancel and cancel.is_set():
        raise ProviderError("Cancelled")
    rt = codex_runtime()
    t0 = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="kinema-codex-") as temp:
        cwd = Path(temp)
        out_path = cwd / "answer.txt"
        cmd = list(rt.get("argv") or [rt["exe"]]) + ["exec", "--skip-git-repo-check", "--json", "--ephemeral",
               "--ignore-user-config", "--ignore-rules", "-s", "read-only", "-C", str(cwd), "-m", model,
               "-c", f'model_reasoning_effort="{effort}"', "-c", "project_doc_max_bytes=0",
               "-c", 'web_search="disabled"', "-c", "features.shell_tool=false", "-c", "features.hooks=false",
               "-c", "features.multi_agent=false", "-c", "features.apps=false", "-c", "features.remote_plugin=false",
               "-c", "features.memories=false", "-c", "features.skill_mcp_dependency_install=false"]
        if tier:
            cmd += ["-c", f'service_tier="{CODEX_TIERS[tier]}"']
        cmd += ["--output-schema", str(schema_path.resolve()), "-o", str(out_path), "-"]
        cmd += [f"--image={p}" for p in images]
        if on_event:
            on_event({"type": "status", "phase": "responding"})
        result = _run(cmd, prompt, timeout, cancel=cancel) if cancel is not None else _run(cmd, prompt, timeout)
        if out_path.exists() and out_path.stat().st_size > MAX_OUTPUT:
            raise ProviderError("The CLI exceeded its output limit.")
        text = out_path.read_text(encoding="utf-8") if out_path.exists() else ""
        usage, errors = {}, []
        for line in result.stdout.decode("utf-8", "replace").splitlines():
            try: event = json.loads(line)
            except ValueError: continue
            if event.get("type") == "turn.completed":
                usage = event.get("usage", {})
            if event.get("type") in ("error", "turn.failed"):
                errors.append(str(event))
            if event.get("type") == "item.completed" and (event.get("item") or {}).get("type") == "agent_message" and not text:
                text = event["item"].get("text") or ""
        if (isinstance(result.returncode, int) and result.returncode != 0) or errors or not text.strip():
            raise _safe_error("codex", result.stderr.decode("utf-8", "replace") + " ".join(errors))
        if on_event:
            on_event({"type": "json", "text": text})
        return text, {"provider": "codex", "model": model, "effort": effort, "tier": tier or "standard",
                      "runtime": rt["version"], "secs": round(time.monotonic() - t0, 1), "usage": usage}


def run_luna(prompt: str, schema_path: Path, *, effort: str = "low", timeout: int = 60,
             on_event=None, cancel=None) -> tuple[str, dict]:
    return run_codex(prompt, [], LUNA_MODEL, effort, schema_path, timeout=timeout, tier="fast",
                     on_event=on_event, cancel=cancel)


def _image_block(path: str) -> dict:
    """A screenshot as an API image block: it rides in the first message, no Read-tool round trip."""
    p = Path(path)
    media = IMAGE_TYPES.get(p.suffix.lower())
    if not media:
        raise ProviderError(f"{p.suffix or 'this'} images are not supported; use PNG, JPEG, WebP or GIF")
    raw = p.read_bytes()
    if len(raw) > MAX_IMAGE_BYTES:
        raise ProviderError("the image is larger than the model accepts (about 3.7 MB); crop or resize the screenshot")
    return {"type": "image", "source": {"type": "base64", "media_type": media, "data": base64.b64encode(raw).decode()}}


def claude_argv(model: str, effort: str, system_path: Path, schema_text: str | None) -> list[str]:
    """The CLI as a focused tutor: our system prompt only, no tools except structured output, no MCP servers, no
    user/project settings or CLAUDE.md files, streamed events so partial lessons and retries are visible."""
    from .cli_runners import resolve_binary
    prefix = resolve_binary("claude")
    if not prefix:
        raise ProviderError("Install the official Claude Code CLI, then check its connection.")
    cmd = prefix + ["-p", "--model", model, "--effort", effort,
           "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
           "--no-session-persistence", "--tools", "", "--strict-mcp-config", "--setting-sources", "",
           "--disable-slash-commands", "--system-prompt-file", str(system_path)]
    if schema_text:
        cmd += ["--json-schema", json.dumps(json.loads(schema_text), separators=(",", ":"))]
    return cmd


DEFAULT_SYSTEM = ("You are Kinema, a careful physics tutor. Follow the instructions in the user's message exactly "
                  "and return exactly what they ask for.")


def run_claude(prompt: str, model: str, effort: str, images: list[str] | None = None, schema_text: str | None = None,
               timeout: int = 900, *, system: str | None = None, on_event=None, cancel: threading.Event | None = None,
               network_giveup: float = NETWORK_GIVEUP_S, stall: float = STALL_S) -> tuple[str, dict]:
    """Stream one official Claude CLI turn, with tools/settings disabled."""
    from .cli_runners import capture, _safe_error
    if model not in CLAUDE_MODELS:
        raise ProviderError("This exact Claude model is not supported; no replacement was tried.")
    if effort not in CLAUDE_EFFORTS:
        raise ProviderError("This thinking effort is not supported by Claude Code.")
    if cancel and cancel.is_set():
        raise ProviderError("Cancelled")
    emit = on_event or (lambda ev: None)
    content = [_image_block(p) for p in (images or [])]
    content.append({"type": "text", "text": prompt})
    message = json.dumps({"type": "user", "message": {"role": "user", "content": content}}) + "\n"
    t0 = time.time()
    state = {"last": t0, "first_retry": None, "network": False}
    json_buf: list[str] = []
    text_buf: list[str] = []
    tool_index = None
    result = None
    thinking = 0
    def handle_line(line):
        nonlocal tool_index, result, thinking
        state["last"] = time.time()
        line = line.strip()
        if not line.startswith("{"):
            return
        try:
            ev = json.loads(line)
        except ValueError:
            return
        kind = ev.get("type")
        if kind == "system":
            sub = ev.get("subtype")
            if sub == "api_retry":
                if state["first_retry"] is None:
                    state["first_retry"] = time.time()
                state["network"] = not ev.get("error_status")
                emit({"type": "retry", "attempt": ev.get("attempt"), "max": ev.get("max_retries"),
                      "error_status": ev.get("error_status")})
            elif sub == "thinking_tokens":
                thinking = int(ev.get("estimated_tokens") or thinking)
                emit({"type": "thinking", "tokens": thinking})
            return
        if kind == "stream_event":
            state["first_retry"] = None
            event = ev.get("event") or {}
            etype = event.get("type")
            if etype == "message_start":
                emit({"type": "status", "phase": "responding"})
            elif etype == "content_block_start":
                block = event.get("content_block") or {}
                if block.get("type") == "tool_use" and block.get("name") == "StructuredOutput":
                    tool_index = event.get("index")
                    emit({"type": "status", "phase": "writing"})
            elif etype == "content_block_delta":
                delta = event.get("delta") or {}
                if delta.get("type") == "input_json_delta" and (tool_index is None or event.get("index") == tool_index):
                    json_buf.append(delta.get("partial_json") or "")
                    emit({"type": "json", "text": "".join(json_buf)})
                elif delta.get("type") == "text_delta":
                    text_buf.append(delta.get("text") or "")
                    emit({"type": "text", "text": "".join(text_buf)})
            return
        if kind == "result":
            result = ev
    def stop_reason():
        now = time.time()
        if state["first_retry"] is not None and state["network"] and now - state["first_retry"] > network_giveup:
            return "Can't reach Claude's servers. Check the connection and try again."
        if now - state["last"] > stall:
            return "Claude stopped responding. Check the connection and try again."
        return None
    with tempfile.TemporaryDirectory(prefix="kinema-claude-") as temp:
        cwd = Path(temp)
        system_path = cwd / "system.txt"
        system_path.write_text(system or DEFAULT_SYSTEM, encoding="utf-8")
        cmd = claude_argv(model, effort, system_path, schema_text)
        emit({"type": "status", "phase": "connecting"})
        completed = capture(cmd, cwd=cwd, stdin=message, timeout=timeout, cancel=cancel,
                            on_line=handle_line, stop_reason=stop_reason)
    if completed.returncode != 0 or result is None:
        raise _safe_error("claude", completed.stderr)
    if result.get("is_error"):
        raise _safe_error("claude", str(result.get("result") or result.get("error") or result.get("subtype")))
    so = result.get("structured_output")
    text = json.dumps(so) if isinstance(so, (dict, list)) else (result.get("result") or "".join(json_buf) or "".join(text_buf))
    if not str(text).strip():
        raise ProviderError("Claude returned an empty answer.")
    usage = result.get("usage") or {}
    used = list((result.get("modelUsage") or {}).keys())
    meta = {"provider": "claude", "model": used[0] if used else model, "label": CLAUDE_LABELS.get(model, model),
            "effort": effort, "secs": round(time.time() - t0, 1), "cost_usd_list": result.get("total_cost_usd"),
            "usage": {k: usage.get(k) for k in ("input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")},
            "thinking_tokens": thinking}
    return str(text), meta


def run_ollama(prompt: str, images: list[str], model: str, timeout: int = 600) -> tuple[str, dict]:
    msg = {"role": "user", "content": prompt}
    if images:
        msg["images"] = [base64.b64encode(Path(p).read_bytes()).decode() for p in images]
    t0 = time.time()
    try:
        r = httpx.post(f"{OLLAMA}/api/chat", json={"model": model, "messages": [msg], "stream": False,
                                                  "format": "json", "options": {"temperature": 0.2, "num_ctx": 16384}},
                       timeout=timeout)
    except httpx.HTTPError as exc:
        raise ProviderError(f"ollama unreachable: {exc}") from exc
    if r.status_code != 200:
        raise ProviderError(f"ollama HTTP {r.status_code}: {r.text[:200]}")
    text = ((r.json().get("message") or {}).get("content")) or ""
    if not text.strip():
        raise ProviderError("ollama returned nothing")
    return text, {"provider": "ollama", "model": model, "secs": round(time.time() - t0, 1)}


def ollama_models() -> list[str]:
    try:
        r = httpx.get(f"{OLLAMA}/api/tags", timeout=3)
        return [m["name"] for m in r.json().get("models", []) if "embed" not in m["name"]]
    except Exception:  # noqa: BLE001
        return []


_FENCE = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.S)


def extract_json(text: str) -> dict:
    """The first JSON object in the text — fenced, bare, or with prose around it."""
    text = text or ""
    m = _FENCE.search(text)
    if m:
        try:
            return json.loads(m.group(1))
        except ValueError:
            pass
    start = text.find("{")
    while start >= 0:
        depth = 0
        in_str = False
        esc = False
        for i in range(start, len(text)):
            c = text[i]
            if in_str:
                if esc:
                    esc = False
                elif c == "\\":
                    esc = True
                elif c == '"':
                    in_str = False
                continue
            if c == '"':
                in_str = True
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start:i + 1])
                    except ValueError:
                        break
        start = text.find("{", start + 1)
    raise ProviderError("No JSON object in the model's reply.")
