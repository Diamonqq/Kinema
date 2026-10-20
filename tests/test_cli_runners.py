"""Official CLI contract tests: fake local programs only, no accounts/network."""
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
from unittest import mock

import inspect
import tempfile
import unittest
from contextlib import ExitStack


def cases(names, values):
    def decorate(fn):
        fn._cases = (names.split(","), values)
        return fn
    return decorate


class Patches:
    def __init__(self): self.stack = ExitStack()
    def setattr(self, obj, name, value): self.stack.enter_context(mock.patch.object(obj, name, value))
    def setenv(self, name, value): self.stack.enter_context(mock.patch.dict(os.environ, {name:value}))
    def close(self): self.stack.close()


def raises(exception, match=None):
    check = unittest.TestCase()
    return check.assertRaisesRegex(exception, match) if match else check.assertRaises(exception)

from app import cli_runners as cr, providers


def clean_runtime(tmp_path, monkeypatch):
    cr._CHECKS.clear()
    # Adapter regressions use a verified mocked account; disconnected gates have
    # dedicated tests in test_official_accounts.
    monkeypatch.setattr(cr, 'require_account', lambda provider: None)
    monkeypatch.setattr(cr, 'account_models', lambda provider: [{'id':x} for x in (cr.GEMINI_MODELS if provider=='gemini-cli' else cr.KIMI_MODELS)])
    monkeypatch.setenv("KINEMA_DATA", str(tmp_path / "data"))
    monkeypatch.setenv("KINEMA_TASKS", "off")
    monkeypatch.setenv("KIMI_CODE_HOME", str(tmp_path / "kimi-home"))
    # None of these tests may discover or launch a real account-connected CLI.
    monkeypatch.setattr(cr, "resolve_binary", lambda p: None)


def script(tmp_path, source):
    path = tmp_path / "fake.py"
    path.write_text(source, encoding="utf-8")
    return [sys.executable, str(path)]


def checked(monkeypatch, provider, prefix):
    monkeypatch.setattr(cr, "resolve_binary", lambda p: prefix if p == provider else None)
    cr._CHECKS[cr._identity(provider, prefix)] = {"supported": True, "version": "test"}


def test_catalog_reads_never_spawn(monkeypatch):
    monkeypatch.setattr(subprocess, "Popen", mock.Mock(side_effect=AssertionError("No process in catalog")))
    for provider in ("codex", "claude", "gemini-cli", "kimi-cli"):
        caps = cr.capabilities(provider)
        assert caps["installed"] is False
    assert "gpt-5.4" in cr.capabilities("codex")["models"]
    assert "gpt-6-luna" in cr.capabilities("codex")["models"]
    assert all("gpt-6" not in r["id"] for r in cr.capabilities("codex")["model_rows"])
    assert cr.capabilities("claude")["model_rows"][-1]["efforts"] == ["medium"]


def test_official_npm_shim_unwrapped_without_shell(tmp_path, monkeypatch):
    package = tmp_path / "node_modules" / "@google/gemini-cli"
    package.mkdir(parents=True)
    entry = package / "dist/index.js"; entry.parent.mkdir(); entry.write_text("", encoding="utf-8")
    (package / "package.json").write_text(json.dumps({"name": "@google/gemini-cli", "bin": {"gemini": "dist/index.js"}}))
    shim = tmp_path / "gemini.cmd"; shim.write_text("malicious shell text is never executed")
    node = tmp_path / "node.exe"; node.write_text("")
    assert cr._argv_for_path(shim, "gemini-cli") == [str(node), str(entry.resolve())]
    (package / "package.json").write_text(json.dumps({"name": "@google/gemini-cli", "bin": {"gemini": "../../../outside.js"}}))
    assert cr._argv_for_path(shim, "gemini-cli") is None
    (package / "package.json").write_text(json.dumps({"name": "unknown/package", "bin": "dist/index.js"}))
    assert cr._argv_for_path(shim, "gemini-cli") is None


def test_capture_unicode_input_and_streaming(tmp_path):
    prefix = script(tmp_path, "import sys,time\nvalue=sys.stdin.buffer.read()\nsys.stdout.buffer.write(value+b'\\n');sys.stdout.buffer.flush()\ntime.sleep(.3)\nprint('second',flush=True)")
    received = []
    result = cr.capture(prefix, cwd=tmp_path, stdin="東京 café", on_line=lambda s: received.append((s, time.monotonic())), timeout=4)
    assert result.returncode == 0
    assert "東京 café" in result.stdout
    assert received[-1][1] - received[0][1] >= .2


@cases("kind", ["timeout", "cancel", "output"])
def test_capture_limits_and_process_cleanup(tmp_path, kind):
    source = "import os,sys,time\nopen('pid.txt','w').write(str(os.getpid()))\n"
    source += "print('x'*100000,flush=True)\ntime.sleep(8)" if kind == "output" else "time.sleep(8)"
    prefix = script(tmp_path, source)
    cancel = threading.Event()
    timer = threading.Timer(.2, cancel.set) if kind == "cancel" else None
    if timer: timer.start()
    start = time.monotonic()
    with raises(providers.ProviderError, match={"timeout": "timed out", "cancel": "Cancelled", "output": "output limit"}[kind]):
        cr.capture(prefix, cwd=tmp_path, timeout=.2 if kind == "timeout" else 5, cancel=cancel, limit=1000)
    if timer: timer.join()
    assert time.monotonic() - start < 4
    pid = int((tmp_path / "pid.txt").read_text())
    if os.name == "nt":
        import ctypes
        handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)
        if handle:
            code = ctypes.c_ulong(); ctypes.windll.kernel32.GetExitCodeProcess(handle, ctypes.byref(code)); ctypes.windll.kernel32.CloseHandle(handle)
            assert code.value != 259
    else:
        with raises(ProcessLookupError): os.kill(pid, 0)


def test_capture_child_is_cleaned_when_parent_exits(tmp_path):
    prefix = script(tmp_path, "import sys,subprocess\np=subprocess.Popen([sys.executable,'-c',\"import time;time.sleep(15)\"])\nprint(p.pid,flush=True)")
    result = cr.capture(prefix, cwd=tmp_path, timeout=5)
    child = int(result.stdout.strip())
    assert result.returncode == 0
    if os.name == "nt":
        import ctypes
        handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, child)
        if handle:
            code = ctypes.c_ulong(); ctypes.windll.kernel32.GetExitCodeProcess(handle, ctypes.byref(code)); ctypes.windll.kernel32.CloseHandle(handle)
            assert code.value != 259


def test_cancel_before_launch(tmp_path, monkeypatch):
    event = threading.Event(); event.set()
    monkeypatch.setattr(subprocess, "Popen", mock.Mock(side_effect=AssertionError("Do not launch")))
    with raises(providers.ProviderError, match="Cancelled"):
        cr.capture(["missing"], cwd=tmp_path, cancel=event)


def test_offline_codex_check_extracts_only_model_metadata(tmp_path, monkeypatch):
    prefix = script(tmp_path, '''import json,sys
if '--version' in sys.argv: print('codex-cli 1.0.0')
elif '--help' in sys.argv: print('--ignore-user-config --ignore-rules --output-schema')
elif sys.argv[-3:]==['debug','models','--bundled']:
 print(json.dumps({'models':[{'slug':'gpt-5.4','display_name':'GPT 5.4','visibility':'list','base_instructions':'DO NOT COPY','supported_reasoning_levels':[{'effort':'high'}],'input_modalities':['text','image'],'additional_speed_tiers':['fast']},{'slug':'codex-auto-review','supported_reasoning_levels':[{'effort':'high'}]}]}))
else: raise RuntimeError('This test must not generate or authenticate')
''')
    monkeypatch.setattr(cr, "resolve_binary", lambda p: prefix)
    result = cr.check_installation("codex")
    assert result["supported"]
    assert result["model_rows"] == [cr._row("gpt-5.4", ["high"], True, ["standard", "fast"])]
    assert "DO NOT COPY" not in json.dumps(result)
    assert "gpt-6-luna" in result["models"]
    saved = cr._catalog_path().read_text()
    assert "DO NOT COPY" not in saved and "base_instructions" not in saved
    cr._CHECKS.clear()
    # Adapter regressions use a verified mocked account; disconnected gates have
    # dedicated tests in test_official_accounts.
    monkeypatch.setattr(cr, 'require_account', lambda provider: None)
    monkeypatch.setattr(cr, 'account_models', lambda provider: [{'id':x} for x in (cr.GEMINI_MODELS if provider=='gemini-cli' else cr.KIMI_MODELS)])
    monkeypatch.setattr(cr, "capture", mock.Mock(side_effect=AssertionError("Reload never probes")))
    assert cr.capabilities("codex")["model_rows"] == result["model_rows"]


@cases("provider,version,help_text,supported", [
    ("gemini-cli", "0.64.0", "--prompt --output-format", True),
    ("gemini-cli", "0.30.0", "--prompt --output-format", False),
    ("kimi-cli", "2.2.0", "--prompt --agent-file --output-format provider", True),
    ("kimi-cli", "1.4.0", "--print --agent-file --output-format", False),
])
def test_version_and_legacy_gates(tmp_path, monkeypatch, provider, version, help_text, supported):
    prefix = script(tmp_path, f"import sys\nprint({version!r} if '--version' in sys.argv else {help_text!r})")
    monkeypatch.setattr(cr, "resolve_binary", lambda p: prefix)
    assert cr.check_installation(provider)["supported"] is supported


def test_gemini_exact_model_suppression_and_stdin(tmp_path, monkeypatch):
    prefix = script(tmp_path, '''import sys,json,os,pathlib
settings=json.loads((pathlib.Path.cwd()/'.gemini'/'settings.json').read_text())
assert os.environ['GOOGLE_GENAI_USE_GCA']=='true' and os.environ['NO_BROWSER']=='true'
assert '--skip-trust' in sys.argv and sys.argv[sys.argv.index('-e')+1]=='none'
assert sys.argv[sys.argv.index('--allowed-mcp-server-names')+1]=='kinema-none'
assert settings['tools']['core']==[]
assert settings['tools']['discoveryCommand']==''
assert settings['hooksConfig']['enabled'] is False
assert all(settings['admin'][x]['enabled'] is False for x in ['extensions','mcp','skills'])
assert settings['security']['auth']['selectedType']=='oauth-personal'
model=sys.argv[sys.argv.index('--model')+1]
assert all(len(v)==1 and v[0]['model']==model for v in settings['modelConfigs']['modelChains'].values())
assert settings['modelConfigs']['modelIdResolutions'][model]=={'default':model,'contexts':[]}
assert not any(pathlib.Path.cwd().glob('*.db'))
request=sys.stdin.read()
assert '@' not in request and '\\\\u0040' in request
assert '--prompt' not in sys.argv
print(json.dumps({'response':json.dumps({'answer':'ok'}),'stats':{'models':{model:{}}}}))
''')
    checked(monkeypatch, "gemini-cli", prefix)
    result, meta = cr.run({"model": "gemini-cli:gemini-3.5-flash"}, "Read @secret", '{"type":"object"}', [], system="Tutor")
    assert json.loads(result) == {"answer": "ok"}
    assert meta["model"] == "gemini-3.5-flash"


@cases("response,match", [
    ({"response": "bad-json"}, "JSON object"),
    ({"response": ""}, "empty answer"),
    ({"response": '{"ok":true}', "stats": {"models": {"different-model": {}}}}, "different model"),
    ({"error": {"message": "401 token secret-password"}}, "Sign in"),
])
def test_gemini_bad_reply_and_sanitized_error(tmp_path, monkeypatch, response, match):
    prefix = script(tmp_path, "import sys\nsys.stdin.read()\nprint(" + repr(json.dumps(response)) + ")")
    checked(monkeypatch, "gemini-cli", prefix)
    with raises(providers.ProviderError, match=match) as err:
        cr.run({"model": "gemini-cli:gemini-2.5-pro"}, "p", None, [])
    assert "secret-password" not in str(err.exception)


def test_kimi_tool_free_agent_no_shell_and_exact_prompt(tmp_path, monkeypatch):
    prefix = script(tmp_path, '''import sys,json,pathlib,os
args=sys.argv
agent=pathlib.Path(args[args.index('--agent-file')+1]).read_text()
assert 'tools: []' in agent and 'subagents: []' in agent
assert list(pathlib.Path(args[args.index('--skills-dir')+1]).iterdir())==[]
assert args[args.index('--model')+1]=='kimi-code/kimi-for-coding'
assert os.environ['KIMI_CODE_WATCH']=='false'
assert 'touch bad' in agent and '$(touch bad)' not in agent
assert '$(touch bad) & echo secret' not in args[args.index('--prompt')+1]
print(json.dumps({'role':'assistant','content':'{"answer":"safe"}'}))
''')
    checked(monkeypatch, "kimi-cli", prefix)
    text, meta = cr.run({"model": "kimi-cli:kimi-code/kimi-for-coding"}, "$(touch bad) & echo secret", '{"type":"object"}', [])
    assert json.loads(text)["answer"] == "safe"
    assert not (tmp_path / "bad").exists()


def test_plain_answer_wrapper_and_large_kimi_prompt(tmp_path, monkeypatch):
    prefix = script(tmp_path, '''import sys,json,pathlib
agent=pathlib.Path(sys.argv[sys.argv.index('--agent-file')+1]).read_text()
assert len(agent)>35000
assert sum(map(len,sys.argv))<2000
print(json.dumps({'role':'assistant','content':'{"answer":"A plain explanation"}'}))
''')
    checked(monkeypatch, "kimi-cli", prefix)
    text, meta = cr.run({"model": "kimi-cli:kimi-code/kimi-for-coding"}, "long lesson " * 4000, None, [])
    assert text == "A plain explanation"


@cases("file,content", [("config.toml", '[[hooks]]\nevent="SessionStart"\ncommand="bad"'),
                                        ("mcp.json", '{"mcpServers":{"bad":{"command":"bad"}}}'),
                                        ("plugins/installed.json", '{"plugins":["bad"]}')])
def test_kimi_existing_integrations_refused_unchanged(tmp_path, monkeypatch, file, content):
    home = tmp_path / "kimi-home"
    target = home / file; target.parent.mkdir(parents=True, exist_ok=True); target.write_text(content)
    monkeypatch.setattr(cr, "capture", mock.Mock(side_effect=AssertionError("Do not launch")))
    with raises(providers.ProviderError, match="cannot be isolated"):
        cr._kimi_config_guard()
    assert target.read_text() == content


def test_images_and_effort_rejected_before_launch(monkeypatch):
    monkeypatch.setattr(cr, "check_installation", mock.Mock(side_effect=AssertionError("Do not probe")))
    with raises(providers.ProviderError, match="cannot receive images"):
        cr.run({"model": "gemini-cli:gemini-2.5-pro"}, "p", None, ["image.png"])
    with raises(providers.ProviderError, match="default thinking"):
        cr.run({"model": "kimi-cli:kimi-code/kimi-for-coding", "effort": "high"}, "p", None, [])


def test_codex_public_and_legacy_exact_models(tmp_path, monkeypatch):
    prefix = script(tmp_path, '''import sys,pathlib,json
args=sys.argv
assert '--ignore-user-config' in args and '--ignore-rules' in args
assert 'features.shell_tool=false' in args and 'features.hooks=false' in args
assert 'web_search="disabled"' in args and args[args.index('-s')+1]=='read-only'
assert sys.stdin.read()=='tutor prompt'
pathlib.Path(args[args.index('-o')+1]).write_text('{"answer":"ok"}')
print(json.dumps({'type':'turn.completed','usage':{'input_tokens':4}}))
''')
    checked(monkeypatch, "codex", prefix)
    schema = tmp_path / "schema.json"; schema.write_text('{"type":"object"}')
    for model in ("gpt-5.4", "gpt-6-luna"):
        text, meta = providers.run_codex("tutor prompt", [], model, "medium", schema)
        assert json.loads(text)["answer"] == "ok"
        assert meta["model"] == model
    with raises(providers.ProviderError, match="thinking effort"):
        providers.run_codex("tutor prompt", [], "gpt-5.4", "ultra", schema)


def test_claude_streaming_and_native_alias(tmp_path, monkeypatch):
    prefix = script(tmp_path, '''import json,sys,time,pathlib
args=sys.argv
assert args[args.index('--tools')+1]==''
assert args[args.index('--setting-sources')+1]==''
assert '--strict-mcp-config' in args
assert pathlib.Path(args[args.index('--system-prompt-file')+1]).read_text()=='Tutor'
assert json.loads(sys.stdin.read())['message']['content'][-1]['text']=='p'
print(json.dumps({'type':'stream_event','event':{'type':'content_block_delta','delta':{'type':'text_delta','text':'hello'}}}),flush=True)
time.sleep(.2)
print(json.dumps({'type':'result','structured_output':{'answer':'hello'},'usage':{'input_tokens':3}}),flush=True)
''')
    checked(monkeypatch, "claude", prefix)
    events = []
    text, meta = providers.run_claude("p", "haiku", "medium", system="Tutor", on_event=events.append)
    assert json.loads(text)["answer"] == "hello"
    assert any(e.get("type") == "text" and e.get("text") == "hello" for e in events)
    assert meta["model"] == "haiku"


def test_nonzero_exit_never_returns_partial_answer(tmp_path, monkeypatch):
    prefix = script(tmp_path, "import sys\nsys.stdin.read()\nprint('token=super-secret authentication failed',file=sys.stderr)\nprint('{\"response\":\"{\\\"ok\\\":true}\"}')\nsys.exit(1)")
    checked(monkeypatch, "gemini-cli", prefix)
    with raises(providers.ProviderError, match="Sign in") as error:
        cr.run({"model": "gemini-cli:gemini-2.5-pro"}, "p", None, [])
    assert "super-secret" not in str(error.exception)


class RunnerContracts(unittest.TestCase):
    """Materialized cases are collected identically by unittest and pytest."""


def _materialize():
    for name, fn in list(globals().items()):
        if not name.startswith("test_") or not callable(fn):
            continue
        fn.__test__ = False  # These are helper bodies; collect the isolated cases below.
        params, values = getattr(fn, "_cases", ([], [()]))
        for index, value in enumerate(values):
            kwargs = dict(zip(params, value if isinstance(value, tuple) else (value,)))
            def run_case(self, fn=fn, kwargs=kwargs):
                patches = Patches()
                try:
                    with tempfile.TemporaryDirectory(prefix="kinema-runner-test-") as temp:
                        args = {"tmp_path": Path(temp), "monkeypatch": patches, **kwargs}
                        clean_runtime(args["tmp_path"], patches)
                        fn(**{k: args[k] for k in inspect.signature(fn).parameters})
                finally:
                    patches.close()
            setattr(RunnerContracts, f"{name}_{index}", run_case)


_materialize()


if __name__ == "__main__":
    unittest.main()
