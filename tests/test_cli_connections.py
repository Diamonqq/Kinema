"""Official CLI connection lifecycle with fake processes only; never real auth."""
import io
import json
import subprocess
import threading
import time
from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from provider_fixture import Base
from app import cli_connections as cli, main, model_choices, provider_connections as pc

SECRET = 'fake-secret-do-not-expose'
SPAWN = cli._spawn
TERMINATE = cli._terminate
CAPS = {
    'codex': {'supported':True, 'images':True, 'efforts':['low','medium','high'], 'models':['gpt-5.4']},
    'claude': {'supported':True, 'images':True, 'efforts':['low','medium','high'], 'models':['haiku','opus','sonnet']},
    'gemini-cli': {'supported':True, 'images':False, 'efforts':['default'], 'models':['gemini-2.5-flash']},
    'kimi-cli': {'supported':True, 'images':False, 'efforts':['default'], 'models':['kimi-code/kimi-for-coding']},

}


class FakeStream:
    def __init__(self, process, text):
        self.process, self.buffer, self.closed = process, io.BytesIO(text.encode()), False
    def read1(self, size):
        raw = self.buffer.read(size)
        if raw: return raw
        self.process.done.wait(5)
        return b''
    def close(self): self.closed = True


class FakeProcess:
    def __init__(self, text='', code=0, hold=False):
        self.done, self.pid, self.returncode = threading.Event(), 987654321, code
        self.stdout = FakeStream(self, text)
        if not hold: self.done.set()
    def poll(self): return self.returncode if self.done.is_set() else None
    def wait(self, timeout=None):
        if not self.done.wait(timeout): raise subprocess.TimeoutExpired(['fake'], timeout)
        return self.returncode
    def kill(self): self.returncode = -9; self.done.set()
    def terminate(self): self.returncode = -15; self.done.set()


class CLIConnections(Base):
    def setUp(self):
        super().setUp()
        from app import cli_runners
        self.manager = cli.Manager(main.DATA)
        self.installed, self.caps = set(CAPS), {k: dict(v) for k,v in CAPS.items()}
        self.spawned, self.procs, self.stopped, self.stop_modes = [], [], [], []
        self.outputs = []
        for patch in (
            mock.patch.object(cli, 'manager', return_value=self.manager),
            mock.patch.object(cli, '_runtime', side_effect=self.runtime),
            mock.patch.object(cli, 'acp_account', side_effect=lambda pid,*a,**kw:[{'id':x} for x in CAPS[pid]['models']]),
            mock.patch.object(cli_runners, 'account_models', side_effect=lambda pid:[{'id':x} for x in CAPS[pid]['models']]),
            mock.patch.object(cli, '_spawn', side_effect=self.spawn),
            mock.patch.object(cli, '_terminate', side_effect=self.terminate),
            mock.patch.object(cli_runners, 'check_installation', side_effect=lambda pid:self.caps[pid]),
            mock.patch.dict('os.environ', {'KINEMA_DISTRIBUTION':'public'}),
        ):
            patch.start(); self.addCleanup(patch.stop)
        app = FastAPI()
        @app.middleware('http')
        async def local(request, call_next):
            request.scope['client'] = ('127.0.0.1', 12345)
            return await call_next(request)
        app.include_router(pc.router)
        self.client = TestClient(app, base_url='http://127.0.0.1:8790')
        self.addCleanup(self.client.close)
        self.addCleanup(self.cleanup_jobs)

    def runtime(self, pid):
        return ([pid + '.exe'] if pid in self.installed else None, self.caps[pid])

    def spawn(self, argv, cwd):
        self.spawned.append(argv)
        self.assertTrue(str(cwd).startswith(str(main.DATA)))
        self.assertTrue(self.outputs, 'Every auth subprocess must be explicitly mocked.')
        proc = self.outputs.pop(0)
        self.procs.append(proc)
        return proc

    def terminate(self, proc, *, tree=True):
        self.stopped.append(proc)
        self.stop_modes.append(tree)
        proc.kill()
        return True

    def cleanup_jobs(self):
        self.manager.close()
        for attempt in self.manager.logins.values():
            if attempt.thread:
                attempt.thread.join(5)
                self.assertFalse(attempt.thread.is_alive())
        for proc in self.procs:
            self.assertIsNotNone(proc.poll())
            self.assertTrue(proc.stdout.closed)

    def post(self, pid, action, body=None, expect=200):
        response = self.client.post(f'/api/connections/cli/{pid}/{action}', json=body or {},
            headers={'X-Kinema-Connection-Token': pc.store().token})
        self.assertEqual(response.status_code, expect, response.text)
        self.assertNotIn(SECRET, response.text)
        return response.json()

    def row(self, pid):
        response = self.client.get('/api/connections')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotIn(SECRET, response.text)
        return next(x for x in response.json()['cli']['providers'] if x['id'] == pid)

    def wait_state(self, pid, states):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            row = self.row(pid)
            if row['login']['state'] in states: return row
            time.sleep(.01)
        self.fail('Owned login did not reach the expected state.')

    def test_snapshot_and_catalog_never_probe_or_login_and_public_cli_is_available(self):
        for pid in CAPS:
            row = self.row(pid)
            if pid == 'gemini-cli':
                self.assertEqual(row['state'], 'unavailable')
                self.assertEqual(row['allowed_actions'], [])
                continue
            self.assertTrue(row['installed'])
            self.assertFalse(row['connected'])
            self.assertEqual(row['state'], 'unchecked')
        catalog = model_choices.catalog()
        self.assertIn('claude:haiku', [m['id'] for m in catalog])
        self.assertIn('codex:gpt-5.4', [m['id'] for m in catalog])
        self.assertNotIn('codex:gpt-6-luna', [m['id'] for m in catalog])
        self.assertEqual(self.spawned, [])
        self.assertFalse(main.SETTINGS_PATH.exists())

    def test_proxy_body_nonce_runs_explicit_cli_flow_and_is_stripped_before_select(self):
        def proxied(action, body=None):
            response = self.client.post('/api/connections/cli/codex/' + action,
                json={**(body or {}), '_connection_token':pc.store().token})
            self.assertEqual(response.status_code, 200, response.text)
            return response.json()
        self.outputs = [FakeProcess('https://auth.openai.com/codex/device\nABCD-1234\n', hold=True)]
        proxied('login')
        self.wait_state('codex', {'waiting'})
        proxied('cancel')
        self.wait_state('codex', {'cancelled'})
        self.outputs = [FakeProcess('Logged in using ChatGPT')]
        proxied('check')
        self.assertTrue(self.row('codex')['connected'])
        choice = {'model':'codex:gpt-5.4', 'effort':'medium', 'role':'chat'}
        with mock.patch.object(self.manager, 'select', wraps=self.manager.select) as select:
            proxied('select', choice)
        select.assert_called_once_with('codex', choice)
        settings = json.loads(main.SETTINGS_PATH.read_text())
        self.assertEqual(settings['chat_model'], 'codex:gpt-5.4')
        self.assertNotIn('_connection_token', settings)
        self.assertNotIn(pc.store().token, main.SETTINGS_PATH.read_text())

    def test_check_saved_auth_uses_native_status_and_discards_personal_fields(self):
        self.outputs = [FakeProcess('Logged in using ChatGPT\n' + SECRET),
            FakeProcess(json.dumps({'loggedIn':True, 'authMethod':'claude.ai', 'email':SECRET, 'configDirectory':SECRET}))]
        self.post('codex', 'check')
        self.post('claude', 'check')
        for pid in ('codex','claude'):
            row = self.row(pid)
            self.assertEqual(row['state'], 'signed_in')
            self.assertTrue(row['connected'])
            self.assertIn('when you send', row['detail'])
        self.assertEqual(self.spawned, [['codex.exe','login','status'], ['claude.exe','auth','status']])
        # The first confirmed account gets recommended defaults; a later background check does not swap them.
        saved = json.loads(main.SETTINGS_PATH.read_text())
        self.assertEqual(saved['chat_model'], 'codex:gpt-5.4')

    def test_status_errors_and_credential_files_do_not_create_false_signed_in(self):
        # Neither a cache-looking file nor a successful-but-unrecognized JSON payload proves sign-in.
        (main.DATA / 'auth.json').write_text(json.dumps({'token':SECRET}))
        for output, code, expected in [('garbage '+SECRET,0,'check_failed'),
            ('{"loggedIn":"true"}',0,'check_failed'), ('{"loggedIn":false}',0,'check_failed'),
            ('{"loggedIn":false}',1,'signed_out'), ('{"loggedIn":true}',1,'check_failed')]:
            self.outputs = [FakeProcess(output,code)]
            self.post('claude','check')
            self.assertEqual(self.row('claude')['state'], expected)
            self.assertFalse(self.row('claude')['connected'])
        self.outputs = [FakeProcess('Not logged in',1)]
        self.post('codex','check')
        self.assertEqual(self.row('codex')['state'],'signed_out')

    def test_installation_probe_failure_is_safe_retryable_and_clears_ready(self):
        from app import cli_runners
        from app.providers import ProviderError
        for pid in ('claude', 'codex'):
            for error in (PermissionError(SECRET), ProviderError(SECRET), ValueError(SECRET)):
                with self.subTest(provider=pid, error=type(error).__name__):
                    self.manager.states[pid] = {'state': 'signed_in'}
                    with mock.patch.object(cli_runners, 'check_installation', side_effect=error):
                        result = self.post(pid, 'check')
                    row = next(r for r in result['cli']['providers'] if r['id'] == pid)
                    self.assertEqual(row['state'], 'check_failed')
                    self.assertFalse(row['connected'])
                    self.assertIn('check', row['allowed_actions'])
                    self.assertIn('permissions', row['error'])
                    self.assertNotIn(SECRET, self.manager._status_path().read_text())
        self.assertEqual(self.spawned, [])
        self.assertFalse(main.SETTINGS_PATH.exists())

    def test_late_installation_failure_preserves_newer_account_check(self):
        from app import cli_runners
        entered, release = threading.Event(), threading.Event()
        def denied(pid):
            entered.set()
            release.wait(3)
            raise PermissionError(SECRET)
        with mock.patch.object(cli_runners, 'check_installation', side_effect=denied):
            checking = threading.Thread(target=lambda: self.manager.check('claude'))
            checking.start()
            self.assertTrue(entered.wait(2))
            self.manager.logins['claude'] = cli.Login()
            self.manager.states['claude'] = {'state': 'signed_in'}
            release.set()
            checking.join(3)
            self.assertFalse(checking.is_alive())
        self.assertTrue(self.row('claude')['connected'])

    def test_late_status_cannot_restore_previous_account_after_new_login_failure(self):
        entered, release = threading.Event(), threading.Event()
        def status(*args):
            entered.set(); release.wait(3)
            return 0, 'Logged in using ChatGPT'
        with mock.patch.object(cli,'_command',side_effect=status):
            checking = threading.Thread(target=lambda:self.manager.check('codex'))
            checking.start()
            self.assertTrue(entered.wait(2))
            self.outputs = [FakeProcess('Login failed '+SECRET,code=1)]
            self.post('codex','login')
            self.wait_state('codex',{'failed'})
            release.set(); checking.join(3)
            self.assertFalse(checking.is_alive())
        self.assertFalse(self.row('codex')['connected'])

    def test_codex_device_login_pending_duplicate_success_and_clear_code(self):
        proc = FakeProcess('\x1b[32mhttps://auth.openai.com/codex/device\x1b[0m\nEnter code: ABCD-1234\n'+SECRET, hold=True)
        self.outputs = [proc]
        self.post('codex','login')
        waiting = self.wait_state('codex', {'waiting'})
        self.assertEqual(waiting['login']['url'], 'https://auth.openai.com/codex/device')
        self.assertEqual(waiting['login']['code'], 'ABCD-1234')
        self.post('codex','login')
        self.post('codex','check')
        self.assertEqual(self.spawned, [['codex.exe','login','--device-auth']])
        proc.done.set()
        final = self.wait_state('codex', {'succeeded'})
        self.assertTrue(final['connected'])
        self.assertIsNone(final['login']['code'])
        self.assertIsNone(final['login']['url'])
        saved = json.loads(main.SETTINGS_PATH.read_text())
        self.assertEqual((saved['chat_model'], saved['chat_effort']), ('codex:gpt-5.4', 'medium'), 'Sign-in sets the recommended tutor.')

    def test_only_official_device_url_and_human_code_are_exposed(self):
        for url in ('http://auth.openai.com/codex/device','https://auth.openai.com.evil.test/codex/device',
            'https://auth.openai.com@evil.test/codex/device','https://auth.openai.com/codex/device?token='+SECRET,
            'https://auth.openai.com/codex/device#'+SECRET,'https://auth.openai.com:444/codex/device',
            'https://evil.test/?next=https://auth.openai.com/codex/device'):
            self.assertEqual(cli.device_prompt(url+'\nABCD-1234'),(None,None))
        self.assertEqual(cli.device_prompt('https://auth.openai.com/codex/device\n'+SECRET),(None,None))

    def test_explicit_browser_signin_uses_official_subcommands_and_no_raw_url(self):
        for pid, args in [('claude',['auth','login']), ('kimi-cli',['login'])]:
            proc = FakeProcess('https://untrusted.test/?token='+SECRET, hold=True)
            self.outputs = [proc]
            self.post(pid,'login')
            pending = self.wait_state(pid, {'waiting'})
            self.assertEqual(pending['login_mode'],'device' if pid=='kimi-cli' else 'browser')
            self.assertIsNone(pending['login']['url'])
            self.assertFalse(pending['connected'])
            proc.done.set()
            self.assertTrue(self.wait_state(pid, {'succeeded'})['connected'])
            self.assertEqual(self.spawned[-1], [pid+'.exe',*args])

    def test_cancel_waits_for_owned_process_and_never_logs_out(self):
        proc = FakeProcess('https://auth.openai.com/codex/device\nABCD-1234', hold=True)
        self.outputs = [proc]
        self.post('codex','login')
        self.wait_state('codex',{'waiting'})
        self.post('codex','cancel')
        final = self.wait_state('codex',{'cancelled'})
        self.assertIn(proc,self.stopped)
        self.assertIsNone(final['login']['url'])
        self.assertIsNone(final['login']['code'])
        self.assertFalse(final['connected'])
        self.assertFalse(any('logout' in args for args in self.spawned))
        self.assertTrue(self.stop_modes[-1], 'Codex device flow owns its no-browser process tree.')

    def test_browser_cancel_and_timeout_never_request_tree_cleanup(self):
        for pid in ('claude','kimi-cli'):
            for ending in ('cancel','timeout'):
                with self.subTest(provider=pid,ending=ending):
                    proc = FakeProcess('Official sign-in browser is open.',hold=True)
                    self.outputs = [proc]
                    with mock.patch.object(cli,'LOGIN_TIMEOUT',.04 if ending == 'timeout' else 900):
                        self.post(pid,'login')
                        if ending == 'cancel':
                            self.wait_state(pid,{'waiting'})
                            self.post(pid,'cancel')
                        final = self.wait_state(pid,{'cancelled' if ending == 'cancel' else 'failed'})
                    self.assertFalse(final['connected'])
                    self.assertIn(proc,self.stopped)
                    self.assertFalse(self.stop_modes[-1])

    def test_browser_termination_signals_only_cli_pid_on_windows_and_posix(self):
        for system in ('nt','posix'):
            proc = FakeProcess(hold=True)
            browser = FakeProcess(hold=True)
            with self.subTest(system=system), mock.patch.object(cli.os,'name',system), \
                    mock.patch.object(cli.subprocess,'run') as taskkill, \
                    mock.patch.object(cli.os,'killpg',create=True) as killgroup:
                self.assertTrue(TERMINATE(proc,tree=False))
                taskkill.assert_not_called()
                killgroup.assert_not_called()
                self.assertIsNone(browser.poll(), 'The fictional browser descendant stays open.')
            browser.kill()

    def test_browser_termination_failure_keeps_unknown_and_never_escalates_to_tree(self):
        proc = mock.Mock()
        proc.poll.return_value = None
        proc.wait.side_effect = subprocess.TimeoutExpired(['fake-cli'],3)
        with mock.patch.object(cli.subprocess,'run') as taskkill, \
                mock.patch.object(cli.os,'killpg',create=True) as killgroup:
            self.assertFalse(TERMINATE(proc,tree=False))
            proc.terminate.assert_called_once_with()
            proc.kill.assert_called_once_with()
            taskkill.assert_not_called()
            killgroup.assert_not_called()

    def test_router_lifespan_stops_pending_signin_without_atexit(self):
        cli._MANAGERS['fixture'] = self.manager
        self.outputs = [FakeProcess('Official browser sign-in',hold=True)]
        with self.client:
            self.post('claude','login')
            self.wait_state('claude',{'waiting'})
        attempt = self.manager.logins['claude']
        self.assertEqual(attempt.state,'cancelled')
        self.assertFalse(attempt.thread.is_alive())
        self.assertIsNotNone(attempt.proc.poll())
        self.assertFalse(self.stop_modes[-1])

    def test_router_shutdown_reports_unconfirmed_cleanup(self):
        cli._MANAGERS['fixture'] = self.manager
        proc = FakeProcess('Official browser sign-in',hold=True)
        self.outputs = [proc]
        with mock.patch.object(cli,'_terminate',return_value=False):
            with self.assertRaisesRegex(RuntimeError,'unconfirmed cleanup'):
                with self.client:
                    self.post('kimi-cli','login')
                    self.wait_state('kimi-cli',{'waiting'})
        self.assertEqual(self.manager.logins['kimi-cli'].state,'cancelling')
        self.assertIsNone(proc.poll())
        proc.kill()
        proc._kinema_output_reader.join(2)

    def test_inherited_output_pipe_cannot_hang_shutdown_or_claim_cleanup(self):
        release = threading.Event()
        proc = FakeProcess(code=0)
        def inherited_read(_size):
            release.wait(5)
            return b''
        proc.stdout.read1 = inherited_read
        self.outputs = [proc]
        started = time.monotonic()
        try:
            with mock.patch.object(cli,'LOGIN_TIMEOUT',.02):
                self.post('claude','login')
                self.wait_state('claude',{'cancelling'})
            self.assertLess(time.monotonic()-started,3)
            self.assertFalse(self.manager.close())
            self.assertEqual(self.manager.logins['claude'].state,'cancelling')
            self.assertEqual(self.stopped,[], 'An inherited browser pipe never justifies a tree kill.')
        finally:
            release.set()
            proc._kinema_output_reader.join(2)

    def test_unconfirmed_process_cleanup_never_claims_cancelled(self):
        proc = FakeProcess('https://auth.openai.com/codex/device\nABCD-1234', hold=True)
        self.outputs = [proc]
        with mock.patch.object(cli,'_terminate',return_value=False):
            self.post('codex','login')
            self.wait_state('codex',{'waiting'})
            self.post('codex','cancel')
            self.manager.logins['codex'].thread.join(2)
            final = self.row('codex')
            self.assertEqual(final['login']['state'],'cancelling')
            self.assertIn('has not stopped',final['login']['error'])
            self.post('codex','login')
            self.assertEqual(len(self.spawned),1)
        # Simulate the user closing this fictional terminal; no real PID is touched.
        proc.kill(); proc.stdout.close()

    def test_process_launch_uses_argv_hidden_windows_and_no_shell(self):
        with mock.patch.object(cli.subprocess,'Popen') as popen:
            SPAWN(['official.exe','login','--device-auth'],main.DATA)
        self.assertEqual(popen.call_args.args[0],['official.exe','login','--device-auth'])
        self.assertFalse(popen.call_args.kwargs.get('shell',False))
        self.assertEqual(popen.call_args.kwargs['creationflags'],cli.NO_WINDOW)
        self.assertEqual(popen.call_args.kwargs['stdin'],subprocess.DEVNULL)

    def test_login_failure_timeout_and_excess_output_are_sanitized(self):
        self.manager.states['codex'] = {'state':'signed_in'}
        self.outputs = [FakeProcess('Token '+SECRET, code=1)]
        self.post('codex','login')
        self.assertFalse(self.wait_state('codex',{'failed'})['connected'])
        self.outputs = [FakeProcess(SECRET,hold=True)]
        with mock.patch.object(cli,'LOGIN_TIMEOUT',.02):
            self.post('codex','login')
            self.wait_state('codex',{'failed'})
        self.outputs = [FakeProcess('x'*(cli.MAX_OUTPUT+1))]
        self.post('codex','login')
        self.wait_state('codex',{'failed'})

    def test_public_model_routing_keeps_exact_cli_model_effort_and_language(self):
        from app import cli_runners, providers
        for pid in ('codex','claude','gemini-cli','kimi-cli'): self.manager.states[pid]={'state':'signed_in'}
        for pid in ('kimi-cli',):
            choice = {'model':pid+':'+CAPS[pid]['models'][0], 'effort':'default', 'speed':'standard', 'language':'es'}
            with mock.patch.object(cli_runners,'run',return_value=('A reply.',{'model':choice['model']})) as run:
                result, _ = model_choices.run(choice,'Explain.',system='Teach carefully.')
                self.assertEqual(result,'A reply.')
                self.assertEqual(run.call_args.args[0],choice)
                self.assertIn('Spanish',run.call_args.kwargs['system'])
        with mock.patch.object(cli_runners,'capabilities',return_value=CAPS['codex']), \
                mock.patch.object(providers,'run_codex',return_value=('{"answer":"Saved."}',{})) as run:
            choice={'model':'codex:gpt-5.4','effort':'medium','speed':'standard'}
            cancel, emit = threading.Event(), mock.Mock()
            self.assertEqual(model_choices.run(choice,'Explain.',cancel=cancel,on_event=emit)[0],'Saved.')
            self.assertEqual(run.call_args.args[2:4],('gpt-5.4','medium'))
            self.assertIs(run.call_args.kwargs['cancel'],cancel)
            self.assertIs(run.call_args.kwargs['on_event'],emit)
            self.assertFalse(list(providers.SANDBOX.glob('*.json')))
        with mock.patch.object(providers,'run_luna',return_value=('{"answer":"Saved."}',{})) as run:
            choice={'model':'codex:gpt-6-luna','effort':'medium','speed':'fast'}
            model_choices.run(choice,'Explain.',cancel=cancel,on_event=emit)
            self.assertIs(run.call_args.kwargs['cancel'],cancel)
            self.assertIs(run.call_args.kwargs['on_event'],emit)

    def test_missing_and_unsupported_install_cannot_login_or_select(self):
        self.installed.remove('claude')
        self.assertEqual(self.row('claude')['state'],'missing')
        self.post('claude','login',expect=400)
        self.post('claude','select',{'model':'claude:haiku'},expect=400)
        self.caps['kimi-cli'] = {'supported':False,'reason':'Install the current Kimi Code CLI.','models':[]}
        self.assertEqual(self.row('kimi-cli')['state'],'unsupported')
        self.post('kimi-cli','login',expect=400)
        self.assertEqual(self.spawned,[])

    def test_explicit_selection_preserves_roles_and_rejects_wrong_model_effort(self):
        self.manager.states['claude']={'state':'signed_in'}
        before = main._settings()
        self.post('claude','select',{'model':'claude:haiku','role':'chat','effort':'medium'})
        after = main._settings()
        self.assertEqual(after['chat_model'],'claude:haiku')
        self.assertEqual(after['build_model'],before['build_model'])
        self.assertEqual(after['notes_model'],before['notes_model'])
        original = main.SETTINGS_PATH.read_bytes()
        self.post('claude','select',{'model':'codex:gpt-5.4'},expect=400)
        self.post('claude','select',{'model':'claude:haiku','effort':'default'},expect=400)
        self.post('claude','select',{'model':'claude:haiku','speed':'fast'},expect=400)
        self.assertEqual(main.SETTINGS_PATH.read_bytes(),original)
        self.assertEqual(self.spawned,[])

    def test_existing_owner_catalog_and_choices_survive_unknown_auth(self):
        with mock.patch.dict('os.environ',{'KINEMA_DISTRIBUTION':''}):
            chosen = {'chat_model':'codex:gpt-6-luna','chat_effort':'high','chat_speed':'fast'}
            main._save_settings(chosen)
            catalog = {m['id']:m for m in model_choices.catalog()}
            self.assertIn('codex:gpt-6-luna',catalog)
            self.assertIn('fast',catalog['codex:gpt-6-luna']['speeds'])
            self.assertEqual({k:main._settings()[k] for k in chosen},chosen)

    def test_loopback_token_body_and_action_guards(self):
        path='/api/connections/cli/codex/login'
        self.assertEqual(self.client.post(path,json={}).status_code,403)
        token={'X-Kinema-Connection-Token':pc.store().token}
        self.assertEqual(self.client.post(path,json={},headers={**token,'Origin':'https://evil.test'}).status_code,403)
        self.assertEqual(self.client.post(path,json={},headers={**token,'Host':'evil.test'}).status_code,403)
        self.post('codex','login',{'junk':'x'*5000},expect=413)
        self.post('madeup','login',expect=400)
        self.post('codex','logout',expect=400)
        self.assertEqual(self.spawned,[])

