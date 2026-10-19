"""First-run account: saved status, Google sign-in, defaults, usage and updates.

Fake processes only: no real CLI, login, network or installer ever runs.
"""
import json
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from provider_fixture import Base
from app import account, account_usage, cli_connections as cli, cli_runners, cli_updates, main, model_choices, provider_connections as pc

CAPS = {
    'codex': {'supported': True, 'model_rows': [
        {'id': x, 'label': x, 'efforts': ['low', 'medium', 'high'], 'images': True, 'speeds': ['standard', 'fast']}
        for x in ('gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.4-mini')]},
    'claude': {'supported': True, 'model_rows': [
        {'id': 'opus', 'efforts': ['low', 'medium', 'high', 'max'], 'images': True},
        {'id': 'sonnet', 'efforts': ['low', 'medium', 'high'], 'images': True},
        {'id': 'haiku', 'efforts': ['medium'], 'images': True}]},
    'antigravity': {'supported': True, 'model_rows': [
        {'id': x, 'label': x, 'efforts': ['default']} for x in
        ('gemini-3.6-flash-medium', 'gemini-3.8-flash-high', 'gemini-3.8-flash-medium', 'gemini-4-argon-high', 'gemini-4-argon-medium', 'gemini-3.1-pro-high')]},
    'gemini-cli': {'supported': True, 'models': ['gemini-2.5-pro', 'gemini-3.8-flash'], 'efforts': ['default']},
    'kimi-cli': {'supported': False, 'models': []},
}
AGY_MODELS = 'gemini-3.8-flash-medium   Gemini 3.8 Flash (Medium)\ngemini-4-argon-medium     Gemini 4 Argon (Medium)\n'


def fake_script(source):
    folder = Path(tempfile.mkdtemp(prefix='kinema-fake-cli-'))
    path = folder / 'fake.py'
    path.write_text(source, encoding='utf-8')
    return [sys.executable, str(path)]


class Account(Base):
    def setUp(self):
        super().setUp()
        self.manager = cli.Manager(main.DATA)
        self.installed = {'codex', 'claude', 'antigravity', 'gemini-cli'}
        self.commands = []
        for patch in (
            mock.patch.object(cli, 'manager', return_value=self.manager),
            mock.patch.object(cli, '_runtime', side_effect=lambda pid: ([pid + '.exe'] if pid in self.installed else None, CAPS[pid])),
            mock.patch.object(cli, '_spawn', side_effect=AssertionError('unexpected auth process')),
            mock.patch.object(cli, 'acp_account', return_value=[{'id':'gemini-3.8-flash'},{'id':'gemini-2.5-pro'}]),
            mock.patch.object(cli_runners, 'check_installation', side_effect=lambda pid: CAPS[pid]),
            mock.patch.object(cli_runners, 'account_models', side_effect=lambda pid: [{'id':x} for x in CAPS['gemini-cli']['models']] if pid == 'gemini-cli' else []),
            mock.patch.dict('os.environ', {'KINEMA_DISTRIBUTION': 'public'}),
        ):
            patch.start(); self.addCleanup(patch.stop)
        app = FastAPI()
        @app.middleware('http')
        async def local(request, call_next):
            request.scope['client'] = ('127.0.0.1', 1)
            return await call_next(request)
        app.include_router(pc.router)
        self.client = TestClient(app, base_url='http://127.0.0.1:8815')
        self.addCleanup(self.client.close)
        self.addCleanup(self.manager.close)

    def post(self, path, body=None, expect=200):
        r = self.client.post(path, json=body or {}, headers={'X-Kinema-Connection-Token': pc.store().token})
        self.assertEqual(r.status_code, expect, r.text)
        return r.json()

    def settings(self):
        return json.loads(main.SETTINGS_PATH.read_text())

    # ── Speed: saved status, background refresh ────────────────────────────────
    def test_open_answers_from_saved_status_and_refresh_runs_in_background(self):
        release = threading.Event()
        def status(argv, cwd, env=None):
            self.commands.append(argv); release.wait(5)
            return (0, 'Logged in') if argv[0] == 'codex.exe' else (1, '{"loggedIn":false}') if argv[0] == 'claude.exe' else (1, 'authentication required')
        with mock.patch.object(cli, '_command', side_effect=status):
            started = time.perf_counter()
            body = self.client.get('/api/connections?refresh=1').json()
            self.assertLess(time.perf_counter() - started, 1.0, 'The screen must not wait for CLI checks.')
            self.assertTrue(any(p['checking'] for p in body['cli']['providers']))
            release.set(); self.manager.refresher.join(10)
        body = self.client.get('/api/connections').json()
        rows = {p['id']: p for p in body['cli']['providers']}
        self.assertTrue(rows['codex']['connected'])
        self.assertFalse(any(p['checking'] for p in rows.values()))
        # A restart shows the saved result at once, without probing.
        fresh = cli.Manager(main.DATA)
        self.assertEqual(fresh.snapshot('codex')['state'], 'signed_in')
        saved = json.loads((main.DATA / 'cli-status.json').read_text())
        self.assertEqual(set(saved['codex']), {'state', 'checked_at', 'detail', 'error'})
        count = len(self.commands)
        self.client.get('/api/connections?refresh=1')  # Fresh results are not re-checked.
        self.assertEqual(len(self.commands), count)

    # ── Defaults after sign-in ──────────────────────────────────────────────────
    def test_recommended_defaults_per_provider(self):
        catalog = model_choices.catalog()
        claude = account.recommend('claude', catalog)
        self.assertEqual(claude['chat'], ('claude:haiku', 'medium'))
        self.assertEqual(claude['build'], ('claude:opus', 'medium'))
        self.assertEqual(claude['notes'], ('claude:opus', 'medium'))
        codex = account.recommend('codex', catalog)
        self.assertEqual(codex['chat'], ('codex:gpt-5.6-luna', 'medium'))
        self.assertEqual(codex['build'], ('codex:gpt-5.6-sol', 'medium'))

    def test_first_sign_in_is_used_and_later_sign_ins_wait_for_a_choice(self):
        with mock.patch.object(cli, '_command', return_value=(0, '{"loggedIn": true}')):
            self.post('/api/connections/cli/claude/check')
        s = self.settings()
        self.assertEqual(s['account_provider'], 'claude')
        self.assertEqual((s['chat_model'], s['chat_effort'], s['build_model'], s['notes_effort']), ('claude:haiku', 'medium', 'claude:opus', 'medium'))
        main._save_settings({'build_model': 'claude:sonnet', 'build_effort': 'high'})  # The learner's own choice.
        account.remember({'build_model': 'claude:sonnet', 'build_effort': 'high'})
        with mock.patch.object(cli, '_command', return_value=(0, 'Logged in using ChatGPT')):
            self.post('/api/connections/cli/codex/check')
        self.assertEqual(account.active_provider(), 'claude')  # The second sign-in waits in Settings.
        account.choose('codex')
        s = self.settings()
        self.assertEqual(account.active_provider(), 'codex')
        self.assertEqual((s['chat_model'], s['notes_model'], s['build_model']), ('codex:gpt-5.6-luna', 'codex:gpt-5.6-sol', 'codex:gpt-5.6-sol'))
        account.choose('claude')  # Back to Claude: the remembered visuals choice returns, the rest is recommended.
        s = self.settings()
        self.assertEqual((s['build_model'], s['build_effort'], s['chat_model']), ('claude:sonnet', 'high', 'claude:haiku'))

    def test_choosing_applies_defaults_and_rejects_unknown_or_unsigned_accounts(self):
        with self.assertRaisesRegex(ValueError, 'supported account'):
            account.choose('nonsense')
        with self.assertRaisesRegex(ValueError, 'Sign in'):
            account.choose('claude')  # Known but not signed in.
        with mock.patch.object(cli, '_command', return_value=(0, '{"loggedIn": true}')):
            self.post('/api/connections/cli/claude/check')
        applied = account.choose('claude')
        self.assertEqual(applied['chat'], ['claude:haiku', 'medium', 'standard'])
        self.assertEqual(applied['build'], ['claude:opus', 'medium', 'standard'])
        self.assertEqual(applied['notes'], ['claude:opus', 'medium', 'standard'])
        self.assertEqual(account.active_provider(), 'claude')

    def test_signing_out_of_the_account_in_use_keeps_its_remembered_choices(self):
        with mock.patch.object(cli, '_command', return_value=(0, '{"loggedIn": true}')):
            self.post('/api/connections/cli/claude/check')
        main._save_settings({'build_effort': 'high'}); account.remember({'build_effort': 'high'})
        with mock.patch.object(cli, '_command', return_value=(0, '')):
            self.post('/api/connections/cli/claude/signout', {'confirm': True})
        self.assertIsNone(account.active_provider())
        self.assertEqual(account.read()['remembered']['claude']['build']['effort'], 'high')

    def test_existing_private_install_keeps_its_exact_choices(self):
        main.SETTINGS_PATH.write_text(json.dumps({'chat_model': 'claude:claude-haiku-5-5', 'chat_effort': 'medium', 'notes_effort': 'high'}))
        with mock.patch.dict('os.environ', {'KINEMA_DISTRIBUTION': ''}), mock.patch.object(pc, '_STORES', {}):
            self.assertTrue(pc.store().install['legacy_enabled'])
            self.assertEqual(account.active_provider(), 'claude')
            self.assertFalse(pc.store().install.get('onboarding_complete'))
        s = self.settings()
        self.assertEqual((s['chat_model'], s['chat_effort'], s['notes_effort']), ('claude:claude-haiku-5-5', 'medium', 'high'))

    def test_upgrade_makes_the_claude_account_in_use_and_keeps_its_three_choices(self):
        # The owner's install before 1.29: Claude signed in, Haiku tutor, Opus visuals, Opus notes at High.
        main.SETTINGS_PATH.write_text(json.dumps({'chat_model': 'claude:claude-haiku-5-5', 'chat_effort': 'medium',
            'build_model': 'claude:claude-opus-5-5', 'build_effort': 'medium', 'notes_model': 'claude:claude-opus-5-5',
            'notes_effort': 'high', 'settings_rev': '2'}))
        keys = ('chat_model', 'chat_effort', 'chat_speed', 'build_model', 'build_effort', 'build_speed', 'notes_model', 'notes_effort', 'notes_speed')
        before = {k: main._settings()[k] for k in keys}
        # The private catalog lists the owner's exact Claude ids; a remembered model must be in the catalog to be used.
        owner = [{'id': 'claude:claude-haiku-5-5', 'provider': 'claude', 'label': 'Haiku 5.5', 'efforts': ['medium'], 'speeds': ['standard']},
                 {'id': 'claude:claude-opus-5-5', 'provider': 'claude', 'label': 'Opus 5.5', 'efforts': ['low', 'medium', 'high'], 'speeds': ['standard']}]
        with mock.patch.object(model_choices, 'catalog', return_value=owner + model_choices.catalog()):
            main._save_settings({'ui_language': 'en'})  # Any settings save writes the new key before the upgrade runs.
            self.assertEqual(self.settings().get('account_provider', ''), '')
            with mock.patch.object(cli, '_command', return_value=(0, '{"loggedIn": true}')):
                self.post('/api/connections/cli/claude/check')  # Signed in on this computer, as the owner's install is.
            body = self.client.get('/api/connections').json()
            self.assertEqual(body['account']['provider'], 'claude')
            self.assertEqual(self.settings()['account_provider'], 'claude')
            self.assertEqual({k: main._settings()[k] for k in keys}, before)
            self.assertEqual(account.read()['remembered']['claude']['notes'], {'model': 'claude:claude-opus-5-5', 'effort': 'high', 'speed': 'standard'})
            # Switching away and back returns the owner's exact choices.
            with mock.patch.object(cli, '_command', return_value=(0, 'Logged in using ChatGPT')):
                self.post('/api/connections/cli/codex/check')
            account.choose('codex')
            account.choose('claude')
            self.assertEqual({k: main._settings()[k] for k in keys}, before)

    # ── Google ──────────────────────────────────────────────────────────────────
    def test_gemini_unavailable_rejects_signin_without_auth(self):
        with mock.patch.object(cli,'acp_account',side_effect=AssertionError('must not authenticate')):
            self.post('/api/connections/cli/gemini-cli/login',expect=400)
            self.post('/api/connections/cli/gemini-cli/use',expect=400)
            row=self.manager.check('gemini-cli')
        self.assertFalse(row['connected'])
        self.assertEqual(row['state'],'unavailable')

    def test_removed_antigravity_never_starts_auth_or_runner(self):
        with mock.patch.object(cli_runners,'capture',side_effect=AssertionError('must not run')):
            self.post('/api/connections/cli/antigravity/login',expect=400)
            with self.assertRaisesRegex(cli.ProviderError,'unavailable'):
                cli_runners.run({'model':'antigravity:old'},'Why?',None,[])

    def test_claude_usage_is_captured_from_reply_stream(self):
        line = json.dumps({'type': 'rate_limit_event', 'rate_limit_info': {'status': 'allowed', 'resetsAt': 1790000000,
            'rateLimitType': 'five_hour', 'unifiedWindows': {'five_hour': {'utilization': .42, 'resetsAt': 1790000000},
                                                             'seven_day': {'utilization': .1, 'resetsAt': 1790500000}}}})
        seen = []
        argv = fake_script('print(' + repr(line) + ')\nprint("{\\"type\\":\\"result\\"}")')
        cli_runners.capture(argv, cwd=main.DATA, on_line=seen.append, timeout=20)
        self.assertEqual(len(seen), 2, 'Reply lines still reach the runner.')
        main._save_settings({'chat_model': 'claude:haiku', 'chat_effort': 'medium'})
        usage = self.client.get('/api/connections/usage').json()
        self.assertEqual(usage['provider'], 'claude')
        self.assertEqual(usage['windows'], [{'label': '5h limit', 'used_percent': 42.0, 'resets_at': 1790000000},
                                            {'label': 'Weekly limit', 'used_percent': 10.0, 'resets_at': 1790500000}])

    def test_codex_usage_reads_official_app_server_without_a_model_call(self):
        # These are our fake Python children, so reap them directly without a
        # Windows taskkill helper (the test runner forbids unrelated commands).
        def stop_fake(proc, **kwargs):
            if proc.poll() is None: proc.terminate()
            proc.wait(timeout=5)
            return True
        patch = mock.patch.object(cli, '_terminate', side_effect=stop_fake)
        patch.start(); self.addCleanup(patch.stop)
        argv = fake_script(r'''import sys,json
seen=[]
for line in sys.stdin:
    m=json.loads(line); seen.append(m.get('method'))
    if m.get('id')==1: print(json.dumps({'id':1,'result':{}}),flush=True)
    if m.get('id')==2:
        assert seen==['initialize','initialized','account/rateLimits/read'], seen
        print(json.dumps({'id':2,'result':{'rateLimits':{'planType':'plus','primary':{'usedPercent':42,'resetsAt':1790000000,'windowDurationMins':300},
            'secondary':{'usedPercent':7,'resetsAt':1790500000,'windowDurationMins':10080}}}}),flush=True)
''')
        spawn = lambda base, env: subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        with mock.patch.object(account_usage, '_spawn_app_server', side_effect=spawn):
            reading = account_usage.read_codex(['codex.exe'])
        self.assertEqual(reading['plan'], 'plus')
        self.assertEqual([w['label'] for w in reading['windows']], ['5h limit', 'Weekly limit'])
        self.assertEqual(reading['windows'][0]['used_percent'], 42)
        signed_out = fake_script(r'''import sys,json
for line in sys.stdin:
    m=json.loads(line)
    if m.get('id')==2: print(json.dumps({'id':2,'error':{'code':-32600,'message':'codex account authentication required to read rate limits'}}),flush=True)
''')
        with mock.patch.object(account_usage, '_spawn_app_server', side_effect=lambda b, e: subprocess.Popen(signed_out, stdin=subprocess.PIPE, stdout=subprocess.PIPE)):
            self.assertEqual(account_usage.read_codex(['codex.exe']), {})

    def test_providers_without_usage_show_nothing(self):
        self.assertEqual(account_usage.view('antigravity')['windows'], [])
        self.assertFalse(account_usage.view('gemini-cli')['supported'])

    # ── Sign-out and updates ────────────────────────────────────────────────────
    def test_background_checks_keep_the_account_and_use_switches_it(self):
        self.post('/api/connections/cli/codex/use', expect=400)  # Not signed in yet.
        with mock.patch.object(cli, '_command', return_value=(0, '{"loggedIn": true}')):
            self.post('/api/connections/cli/claude/check')
        with mock.patch.object(cli, '_command', return_value=(0, 'Logged in using ChatGPT')):
            self.post('/api/connections/cli/codex/check')
        self.assertEqual(account.active_provider(), 'claude')  # A second signed-in CLI found later changes nothing.
        self.assertEqual(self.settings()['chat_model'], 'claude:haiku')
        body = self.post('/api/connections/cli/codex/use')
        self.assertEqual(body['account']['provider'], 'codex')
        self.assertEqual(body['applied']['chat'][0], 'codex:gpt-5.6-luna')
        self.assertEqual(self.settings()['chat_model'], 'codex:gpt-5.6-luna')

    def test_sign_out_needs_confirmation_and_uses_official_logout(self):
        with mock.patch.object(cli, '_command', return_value=(0, '{"loggedIn": true}')):
            self.post('/api/connections/cli/claude/check')
        with mock.patch.object(cli, '_command', return_value=(0, '')) as run:
            self.post('/api/connections/cli/claude/signout', expect=400)
            run.assert_not_called()
            body = self.post('/api/connections/cli/claude/signout', {'confirm': True})
        self.assertEqual(run.call_args[0][0], ['claude.exe', 'auth', 'logout'])
        self.assertFalse(next(p for p in body['cli']['providers'] if p['id'] == 'claude')['connected'])

    def test_updates_list_versions_and_run_official_installer_only_on_click(self):
        executed = []
        with mock.patch.object(cli_updates, '_fetch_latest', return_value='9.9.9'), \
             mock.patch.object(cli_updates, '_execute', side_effect=lambda argv: executed.append(argv) or 0), \
             mock.patch.object(cli_updates, '_npm', return_value=['node', 'npm-cli.js']), \
             mock.patch.object(cli_updates, '_LATEST', {}), mock.patch.object(cli_updates, '_JOBS', {}), \
             mock.patch.object(cli_runners, 'resolve_binary', side_effect=lambda pid: ['C:/n/node_modules/@moonshot-ai/kimi-code/index.js'] if pid == 'kimi-cli' else None), \
             mock.patch.object(cli_runners, 'capabilities', return_value={'version': '0.64.0'}):
            self.client.get('/api/connections/updates')
            time.sleep(.3)
            apps = {a['id']: a for a in self.client.get('/api/connections/updates').json()['apps']}
            self.assertEqual(executed, [], 'Listing never installs.')
            self.assertEqual(apps['kimi-cli']['latest'], '9.9.9')
            self.assertTrue(apps['kimi-cli']['update_available'])
            self.assertNotIn('antigravity', apps)
            self.assertNotIn('gemini-cli', apps)
            self.post('/api/connections/updates/gemini-cli', {'confirm': True}, expect=400)
            self.post('/api/connections/updates/kimi-cli', expect=400)
            self.post('/api/connections/updates/kimi-cli', {'confirm': True})
            deadline = time.monotonic() + 5
            while (cli_updates._JOBS.get('kimi-cli') or {}).get('state') == 'running' and time.monotonic() < deadline:
                time.sleep(.02)
            self.assertEqual(cli_updates._JOBS['kimi-cli']['state'], 'succeeded')
        self.assertEqual(executed, [['node', 'npm-cli.js', 'install', '-g', '@moonshot-ai/kimi-code@latest']])
        self.assertIsNone(cli_updates.installer('antigravity', None)[0])
        self.assertEqual(cli_updates.installer('claude', ['C:/Example/.local/bin/claude.exe'])[0][-1], 'update')
        self.assertIsNone(cli_updates.installer('codex', ['C:/Programs/OpenAI/Codex/bin/codex.exe'])[0])
