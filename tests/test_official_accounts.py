"""Official account contracts with mocked ACP pipes; no auth, credentials or network."""
import io
import json
import queue
import threading
from unittest import mock

from provider_fixture import Base
from app import cli_connections as cli, cli_runners as cr, cli_updates, model_choices, main, provider_connections as pc


class Pipe:
    def __init__(self): self.q=queue.Queue(); self.closed=False
    def readline(self, limit): return self.q.get(timeout=3)
    def close(self): self.closed=True


class Acp:
    def __init__(self, error=None, permission=False):
        self.stdout, self.stderr=Pipe(), Pipe()
        self.stdin=self; self.closed=False; self.pid=987654321; self.returncode=None
        self.calls=[]; self.error=error; self.permission=permission
    def write(self, raw):
        value=json.loads(raw); self.calls.append(value)
        if 'method' not in value: return
        method=value['method']
        if self.permission and method=='initialize':
            self.stdout.q.put(json.dumps({'id':'tool','method':'session/request_permission','params':{}}).encode())
        reply={'id':value['id'],'result':{}}
        if method=='session/new':
            reply={'id':value['id'],'error':self.error} if self.error else {'id':value['id'],'result':{'models':{'availableModels':[{'modelId':'gemini-3.8-flash','name':'Flash'},{'modelId':'gemini-2.5-pro','name':'Pro'}]}}}
        self.stdout.q.put(json.dumps(reply).encode())
    def flush(self): pass
    def close(self): self.closed=True
    def poll(self): return self.returncode
    def terminate(self): self.returncode=-15; self.stdout.q.put(b''); self.stderr.q.put(b'')
    def wait(self,timeout=None): return self.returncode


class OfficialAccounts(Base):
    def setUp(self):
        super().setUp()
        self.manager=cli.Manager(main.DATA)
        patch=mock.patch.dict('os.environ',{'KINEMA_DATA':str(main.DATA)}); patch.start(); self.addCleanup(patch.stop)
        self.caps={'supported':True,'checked':True,'efforts':['default'],'models':[]}
        for patch in (mock.patch.object(cli,'manager',return_value=self.manager),
                      mock.patch.object(cli,'_runtime',return_value=(['fake-cli'],self.caps)),
                      mock.patch.object(cr,'check_installation',return_value=self.caps),
                      mock.patch.object(cr,'_kimi_config_guard')):
            patch.start(); self.addCleanup(patch.stop)
        self.addCleanup(self.manager.close)

    def test_primary_official_accounts_no_antigravity(self):
        self.assertEqual(set(cli.PROVIDERS),{'codex','claude','gemini-cli','kimi-cli'})
        for pid in ('gemini-cli','kimi-cli'): self.assertEqual(cli.PROVIDERS[pid]['tier'],'primary')
        with mock.patch.object(cr,'resolve_binary',side_effect=AssertionError('must not resolve')):
            for action in ('check','login','cancel','use'):
                with self.assertRaises(ValueError): getattr(self.manager,action)('antigravity')
        self.assertNotIn('antigravity',cli_updates.NAMES)
        self.assertIn('kimi-cli',cli_updates.PACKAGES)
        with mock.patch.object(cli_updates,'_npm',return_value=['node','npm.js']):
            self.assertEqual(cli_updates.installer('kimi-cli',None)[0][-1],'@moonshot-ai/kimi-code@latest')

    def test_acp_google_login_catalog_and_refuse_permission(self):
        proc=Acp(permission=True)
        attempt=cli.Login()
        with mock.patch.object(cli.subprocess,'Popen',return_value=proc) as spawn:
            rows=cli.acp_account('gemini-cli',['fake-cli'],main.DATA/'acp',attempt=attempt,login=True)
        methods=[v.get('method') for v in proc.calls]
        self.assertEqual([m for m in methods if m],['initialize','authenticate','session/new'])
        self.assertEqual(proc.calls[2]['params'],{'methodId':'oauth-personal'})
        self.assertIn({'jsonrpc':'2.0','id':'tool','result':{'outcome':{'outcome':'cancelled'}}},proc.calls)
        self.assertEqual(rows[0]['id'],'gemini-3.8-flash')
        self.assertNotIn('NO_BROWSER', {k:v for k,v in spawn.call_args.kwargs['env'].items() if k=='NO_BROWSER' and v=='true'})
        self.assertTrue(proc._kinema_cleanup_confirmed)
        self.assertIsNotNone(proc.poll())
        self.assertTrue(proc.stdout.closed and proc.stderr.closed)

    def test_checks_do_not_authenticate_or_prompt(self):
        for pid in ('gemini-cli','kimi-cli'):
            proc=Acp()
            with mock.patch.object(cli.subprocess,'Popen',return_value=proc) as spawn:
                rows=cli.acp_account(pid,['fake-cli'],main.DATA/pid)
            self.assertEqual([v['method'] for v in proc.calls],['initialize','session/new'])
            self.assertEqual(spawn.call_args.kwargs['env']['NO_BROWSER'],'true')
            self.assertTrue(rows and proc._kinema_cleanup_confirmed)

    def test_acp_auth_error_sanitized_and_cleanup(self):
        proc=Acp(error={'code':-32000,'message':'secret-token auth required'})
        with mock.patch.object(cli.subprocess,'Popen',return_value=proc):
            with self.assertRaises(cli.AccountSignedOut) as caught:
                cli.acp_account('gemini-cli',['fake-cli'],main.DATA/'failure')
        self.assertNotIn('secret',str(caught.exception)); self.assertTrue(proc._kinema_cleanup_confirmed)

    def test_cancel_does_not_claim_success(self):
        proc=Acp(); attempt=cli.Login(); attempt.cancel.set()
        with mock.patch.object(cli.subprocess,'Popen',return_value=proc):
            with self.assertRaisesRegex(cli.ProviderError,'Cancelled'):
                cli.acp_account('gemini-cli',['fake-cli'],main.DATA/'cancel',attempt=attempt,login=True)
        self.assertTrue(proc._kinema_cleanup_confirmed)

    def test_disconnected_gate_rejects_before_all_runners(self):
        for pid in ('codex','claude','gemini-cli','kimi-cli','antigravity'):
            with mock.patch.object(cr,'run',side_effect=AssertionError('No runner')):
                with self.assertRaisesRegex(cli.ProviderError,'Sign in|unavailable'):
                    model_choices.run({'model':pid+':model','effort':'default','speed':'standard'},'hello')
        with mock.patch.object(cr,'capture',side_effect=AssertionError('No runner')):
            with self.assertRaisesRegex(cli.ProviderError,'Sign in|unavailable'):
                cr.run({'model':'kimi-cli:model'},'hello',None,[])

    def test_catalog_only_after_verified_check_and_revocation(self):
        rows=[{'id':'kimi-code/kimi-for-coding','label':'Kimi'}]
        with mock.patch.object(cli,'acp_account',return_value=rows):
            self.assertEqual(self.manager.snapshot('kimi-cli')['models'],[])
            self.manager.check('kimi-cli')
            snapshot=self.manager.snapshot('kimi-cli')
            self.assertTrue(snapshot['connected'])
            self.assertEqual(snapshot['models'][0]['id'],'kimi-cli:kimi-code/kimi-for-coding')
            self.assertIn('use',snapshot['allowed_actions'])
        with mock.patch.object(cli,'acp_account',side_effect=cli.AccountSignedOut('Sign in')):
            self.manager.check('kimi-cli')
            self.assertFalse(self.manager.snapshot('kimi-cli')['connected'])
            self.assertEqual(self.manager.snapshot('kimi-cli')['models'],[])

    def test_failed_check_retry_and_stale_models_hidden(self):
        for outcome,expected in [(cli.ProviderError('secret'),'check_failed'),([{'id':'flash'}],'signed_in')]:
            with mock.patch.object(cli,'acp_account',**({'side_effect':outcome} if isinstance(outcome,Exception) else {'return_value':outcome})):
                result=self.manager.check('kimi-cli')
            self.assertEqual(result['state'],expected)
            self.assertNotIn('secret',str(result))

    def test_removed_saved_record_and_unrelated_selection_preserved(self):
        path=main.DATA/'cli-status.json'
        path.write_text(json.dumps({'antigravity':{'state':'signed_in','checked_at':1}}))
        manager=cli.Manager(main.DATA); manager._save()
        self.assertIn('antigravity',json.loads(path.read_text()))
        main.SETTINGS_PATH.write_text(json.dumps({'account_provider':'antigravity','chat_model':'antigravity:old'}))
        with mock.patch('app.account.adopt',side_effect=AssertionError('must not switch')):
            manager._signed_in('gemini-cli')
        self.assertEqual(main._settings()['account_provider'],'antigravity')
        notice=pc._account()
        self.assertNotIn('requires_sign_in',notice)
        self.assertIn('unavailable',notice['message'])
        self.assertIsNone(notice['provider'])

    def test_models_are_account_listed_and_preserve_slash_id(self):
        rows=cli._acp_models({'configOptions':[{'id':'model','options':[{'value':'kimi-code/kimi-for-coding','name':'Kimi'},{'value':'../bad id'}]}]})
        cr.save_account_models('kimi-cli',rows)
        self.assertEqual(cr.account_models('kimi-cli')[0]['id'],'kimi-code/kimi-for-coding')
        with self.assertRaises(cli.ProviderError): cli._acp_models({})

    def test_unverified_active_account_blocks_another_verified_runner(self):
        self.manager.states['claude']={'state':'signed_in'}
        main._save_settings({'account_provider':'gemini-cli'})
        with mock.patch('app.providers.run_claude',side_effect=AssertionError('No fallback')):
            with self.assertRaisesRegex(cli.ProviderError,'selected account'):
                model_choices.run({'model':'claude:haiku','effort':'medium','speed':'standard'},'Hello')

    def test_kimi_device_link_is_official_and_query_is_not_exposed(self):
        self.assertEqual(cli.device_prompt('https://auth.kimi.com/device?user_code=ABCD-1234 ABCD-1234','kimi-cli'),('https://auth.kimi.com/device','ABCD-1234'))
        for url in ('https://auth.kimi.com.evil/device','https://user:secret@auth.kimi.com/device','https://evil.test/device'):
            self.assertEqual(cli.device_prompt(url+' ABCD-1234','kimi-cli'),(None,None))

    def test_acp_timeout_and_malformed_models_are_fixed_errors(self):
        proc=Acp(); proc.write=lambda raw: None
        with mock.patch.object(cli.subprocess,'Popen',return_value=proc), mock.patch.object(cli,'STATUS_TIMEOUT',.01):
            with self.assertRaisesRegex(cli.ProviderError,'in time'):
                cli.acp_account('gemini-cli',['fake-cli'],main.DATA/'timeout')
        self.assertTrue(proc._kinema_cleanup_confirmed)
        for payload in ({'models':'secret'}, {'models':{'availableModels':'secret'}}, {'configOptions':[{'id':'model','options':42}]}):
            with self.assertRaises(cli.ProviderError): cli._acp_models(payload)

    def test_kimi_login_verifies_via_acp_after_native_device_success(self):
        from test_cli_connections import FakeProcess
        proc=FakeProcess('https://auth.kimi.com/device ABCD-1234')
        with mock.patch.object(cli,'_spawn',return_value=proc), mock.patch.object(cli,'acp_account',return_value=[{'id':'kimi-code/kimi-for-coding'}]) as verify:
            self.manager.login('kimi-cli')
            self.manager.logins['kimi-cli'].thread.join(3)
        self.assertEqual(self.manager.logins['kimi-cli'].state,'succeeded')
        self.assertTrue(verify.call_args.kwargs['login'])
        self.assertTrue(self.manager.snapshot('kimi-cli')['connected'])
        self.assertTrue(proc._kinema_cleanup_confirmed)

    def test_google_unavailable_preserves_records_without_runtime_or_installer(self):
        self.manager.states['gemini-cli']={'state':'signed_in','checked_at':123}
        self.manager._save(); before=(main.DATA/'cli-status.json').read_bytes()
        with mock.patch.object(cli,'_runtime',side_effect=AssertionError('No runtime')), mock.patch.object(cr,'capture',side_effect=AssertionError('No process')):
            row=self.manager.check('gemini-cli')
            self.assertFalse(row['connected']); self.assertFalse(row['supported'])
            self.assertFalse(row['available']); self.assertEqual(row['allowed_actions'],[])
            self.assertEqual(row['models'],[])
            for action in ('login','use'):
                with self.assertRaisesRegex(ValueError,'unavailable'): getattr(self.manager,action)('gemini-cli')
            with self.assertRaisesRegex(cli.ProviderError,'unavailable'): cr.require_account('gemini-cli')
        self.assertEqual((main.DATA/'cli-status.json').read_bytes(),before)
        self.assertNotIn('gemini-cli',cli_updates.NAMES)
        self.assertIsNone(cli_updates.installer('gemini-cli',None)[0])
        with self.assertRaises(ValueError): cli_updates.start('gemini-cli')

    def test_unknown_and_legacy_local_choices_cannot_bypass_account_gate(self):
        with mock.patch('app.providers.run_ollama',side_effect=AssertionError('No legacy call')):
            for model in ('ollama:old','unknown:old'):
                with self.assertRaisesRegex(cli.ProviderError,'signed-in account'):
                    model_choices.run({'model':model,'effort':'default','speed':'standard'},'Hi')

    def test_old_google_restriction_is_actionable_without_rewriting_records(self):
        self.manager.states['gemini-cli']={'state':'unsupported_account','detail':'Use Antigravity'}
        row=self.manager.snapshot('gemini-cli')
        self.assertEqual(row['state'],'unavailable')
        self.assertNotIn('Antigravity',row['detail'])
        self.assertEqual(row['allowed_actions'],[])
        self.assertEqual(self.manager.states['gemini-cli']['state'],'unsupported_account')

    def test_native_oauth_does_not_inherit_api_account_overrides(self):
        with mock.patch.dict('os.environ',{'GEMINI_API_KEY':'fake-key','GOOGLE_GENAI_USE_VERTEXAI':'true','OPENAI_API_KEY':'fake-other','MOONSHOT_API_KEY':'fake-kimi'}):
            self.assertNotIn('GEMINI_API_KEY',cr.official_env('gemini-cli'))
            self.assertNotIn('GOOGLE_GENAI_USE_VERTEXAI',cr.official_env('gemini-cli'))
            self.assertNotIn('OPENAI_API_KEY',cr.official_env('kimi-cli'))
            self.assertNotIn('MOONSHOT_API_KEY',cr.official_env('kimi-cli'))

    def test_account_defaults_use_discovered_models_and_native_effort(self):
        from app import account
        gemini=cli._models('gemini-cli',{'models':['gemini-3.8-flash','gemini-2.5-pro'],'efforts':['default']})
        plan=account.recommend('gemini-cli',gemini)
        self.assertEqual(plan['chat'],('gemini-cli:gemini-3.8-flash','default'))
        self.assertEqual(plan['build'],('gemini-cli:gemini-2.5-pro','default'))
        kimi=cli._models('kimi-cli',{'models':['kimi-code/kimi-for-coding'],'efforts':['default']})
        self.assertEqual(account.recommend('kimi-cli',kimi)['chat'],('kimi-cli:kimi-code/kimi-for-coding','default'))

    def test_unverified_active_api_cannot_use_a_verified_cli_as_fallback(self):
        main._save_settings({'account_provider':'openai'})
        self.manager.states['claude']={'state':'signed_in'}
        with mock.patch.object(pc.store(),'public',return_value={'connected':True,'verified_at':None,'error':None}), \
             mock.patch('app.providers.run_claude',side_effect=AssertionError('No fallback')):
            with self.assertRaisesRegex(cli.ProviderError,'Verify the selected account'):
                model_choices.run({'model':'claude:haiku','effort':'medium','speed':'standard'},'Hi')

    def test_new_signin_keeps_pre_account_picker_explicit_model_choices(self):
        main.SETTINGS_PATH.write_text(json.dumps({'chat_model':'claude:haiku','chat_effort':'medium','settings_rev':'2'}))
        with mock.patch('app.account.adopt',side_effect=AssertionError('must not replace legacy choice')):
            self.manager._signed_in('gemini-cli')
        self.assertEqual(main._settings()['account_provider'],'claude')
        self.assertEqual(main._settings()['chat_model'],'claude:haiku')
