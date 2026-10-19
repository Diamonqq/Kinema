"""Disposable local connections; fake credentials, official calls mocked, no account changes."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.requests import Request

from provider_fixture import Base
from app import account, cloud_providers as cloud, main, model_choices, provider_connections as pc
from app.providers import ProviderError

KEY = 'fictional-test-key-never-real'
MODELS = cloud.normalize_models('openai', [{'id': 'gpt-4.1-mini'}])


class MemorySecrets:
    kind = 'os-keyring'
    def __init__(self): self.values = {}
    def set(self, p, v): self.values[p] = v
    def get(self, p): return self.values.get(p)
    def delete(self, p): self.values.pop(p, None)


class Connections(Base):
    def setUp(self):
        super().setUp()
        self.secret = MemorySecrets()
        self.store = pc.ConnectionStore(main.DATA, self.secret)
        patch = mock.patch.object(pc, 'store', return_value=self.store)
        patch.start(); self.addCleanup(patch.stop)
        app = FastAPI()
        @app.middleware('http')
        async def local_peer(request, call_next):
            request.scope['client'] = ('127.0.0.1', 1234)
            return await call_next(request)
        app.include_router(pc.router)
        self.client = TestClient(app, base_url='http://127.0.0.1:8790')
        self.addCleanup(self.client.close)

    def post(self, path, body):
        return self.client.post('/api/connections/' + path, json=body,
                                headers={'X-Kinema-Connection-Token': self.store.token})

    def test_secure_connect_is_verified_before_save_and_never_selects(self):
        with mock.patch.object(cloud, 'verify', return_value=MODELS) as verify:
            result = self.post('openai/connect', {'api_key': KEY, 'storage': 'secure'})
        self.assertEqual(result.status_code, 200, result.text)
        verify.assert_called_once_with('openai', KEY)
        self.assertEqual(self.secret.get('openai'), KEY)
        self.assertEqual(self.store.key('openai'), KEY)
        self.assertFalse(main.SETTINGS_PATH.exists())
        self.assertNotIn(KEY, result.text)
        self.assertNotIn(KEY, self.store.path.read_text())
        self.assertTrue(result.json()['onboarding_required'])

    def test_failed_replacement_leaves_prior_connection(self):
        with mock.patch.object(cloud, 'verify', return_value=MODELS):
            self.store.connect('openai', KEY)
        before = self.store.path.read_bytes()
        with mock.patch.object(cloud, 'verify', side_effect=ProviderError('Key rejected.')):
            result = self.post('openai/connect', {'api_key': 'another-fictional-key'})
        self.assertEqual(result.status_code, 400)
        self.assertEqual(self.secret.get('openai'), KEY)
        self.assertEqual(self.store.path.read_bytes(), before)

    def test_no_secure_backend_fails_closed_and_session_is_explicit(self):
        self.secret.kind = 'unavailable'
        with mock.patch.object(cloud, 'verify', return_value=MODELS) as verify:
            refused = self.post('openai/connect', {'api_key': KEY})
            self.assertEqual(refused.status_code, 400)
            verify.assert_not_called()
            accepted = self.post('openai/connect', {'api_key': KEY, 'storage': 'session'})
        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(self.store.key('openai'), KEY)
        self.assertNotIn(KEY, self.store.path.read_text())
        restarted = pc.ConnectionStore(main.DATA, self.secret)
        self.assertFalse(restarted.public('openai')['connected'])
        with self.assertRaises(ProviderError): restarted.key('openai')

    def test_environment_is_opt_in_and_disconnect_does_not_change_it(self):
        with mock.patch.dict(os.environ, {'OPENAI_API_KEY': KEY}), mock.patch.object(cloud, 'verify', return_value=MODELS):
            self.assertTrue(self.store.public('openai')['environment_available'])
            self.assertFalse(self.store.public('openai')['connected'])
            self.store.connect('openai', mode='environment')
            self.assertEqual(self.store.key('openai'), KEY)
            self.store.disconnect('openai')
            self.assertEqual(os.environ['OPENAI_API_KEY'], KEY)
            self.assertFalse(self.store.public('openai')['connected'])

    def test_failed_verify_keeps_connection_and_exposes_only_safe_error(self):
        with mock.patch.object(cloud, 'verify', return_value=MODELS): self.store.connect('openai', KEY)
        with mock.patch.object(cloud, 'verify', side_effect=ProviderError('The provider rejected this API key.')):
            result = self.post('openai/verify', {})
        self.assertEqual(result.status_code, 400)
        view = self.store.public('openai')
        self.assertTrue(view['connected'])
        self.assertIn('rejected', view['error'])
        self.assertNotIn(KEY, json.dumps(view))

    def test_disconnect_removes_only_this_install_credential_and_keeps_selection(self):
        with mock.patch.object(cloud, 'verify', return_value=MODELS): self.store.connect('openai', KEY)
        self.secret.set('anthropic', 'other-provider-key')
        main.SETTINGS_PATH.write_text('{"chat_model":"openai:gpt-4.1-mini"}')
        result = self.post('openai/disconnect', {})
        self.assertEqual(result.status_code, 200)
        self.assertIsNone(self.secret.get('openai'))
        self.assertEqual(self.secret.get('anthropic'), 'other-provider-key')
        saved = json.loads(main.SETTINGS_PATH.read_text(encoding='utf-8'))
        self.assertEqual(saved['chat_model'], 'openai:gpt-4.1-mini')
        self.assertEqual(saved[account.FIELD], '')

    def test_selection_is_explicit_and_rejects_unsupported_effort(self):
        with mock.patch.object(cloud, 'verify', return_value=MODELS): self.store.connect('openai', KEY)
        with mock.patch.object(main, '_save_settings') as save:
            invalid = self.post('openai/select', {'model':'openai:gpt-4.1-mini','effort':'high'})
            self.assertEqual(invalid.status_code, 400)
            save.assert_not_called()
            valid = self.post('openai/select', {'model':'openai:gpt-4.1-mini','effort':'default'})
            self.assertEqual(valid.status_code, 200, valid.text)
            save.assert_called_once_with({'chat_model':'openai:gpt-4.1-mini','chat_effort':'default','chat_speed':'standard'})
        self.assertFalse(valid.json()['onboarding_required'])

    def test_explicit_skip_persists_without_changing_settings(self):
        self.assertTrue(self.client.get('/api/connections').json()['onboarding_required'])
        response = self.post('onboarding', {'complete': True})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()['onboarding_required'])
        self.assertTrue(pc.ConnectionStore(main.DATA, self.secret).install['onboarding_complete'])
        self.assertFalse(main.SETTINGS_PATH.exists())

    def test_long_dynamic_model_id_is_saved_without_truncation(self):
        model = 'openrouter:vendor/' + 'm' * 130
        rows = [{'id':model,'label':'Long model','provider':'openrouter','efforts':['default'],'speeds':['standard']}]
        with mock.patch.object(cloud,'verify',return_value=rows): self.store.connect('openrouter',KEY)
        result = self.post('openrouter/select', {'model':model,'effort':'default'})
        self.assertEqual(result.status_code,200,result.text)
        self.assertEqual(json.loads(main.SETTINGS_PATH.read_text())['chat_model'],model)

    def test_csrf_origin_host_size_and_unknown_provider_refused(self):
        self.assertEqual(self.client.post('/api/connections/openai/connect', json={'api_key':KEY}).status_code, 403)
        token = {'X-Kinema-Connection-Token': self.store.token}
        self.assertEqual(self.client.post('/api/connections/openai/connect', json={'api_key':KEY}, headers={**token,'Origin':'https://untrusted.test'}).status_code, 403)
        self.assertEqual(self.client.get('/api/connections', headers={'Host':'untrusted.test'}).status_code, 403)
        self.assertEqual(self.post('openai/connect', {'api_key':'x' * 9000}).status_code, 413)
        self.assertEqual(self.post('madeup/connect', {'api_key':KEY}).status_code, 400)
        req = Request({'type':'http','method':'GET','scheme':'http','path':'/api/connections','headers':[(b'host',b'127.0.0.1')], 'client':('192.168.1.4',3000)})
        with self.assertRaises(Exception) as error: pc.guard(req)
        self.assertEqual(error.exception.status_code, 403)

    def test_proxy_body_nonce_supports_complete_api_flow_without_header(self):
        def proxied(action, body=None):
            return self.client.post('/api/connections/openai/' + action,
                json={**(body or {}), '_connection_token': self.store.token})
        with mock.patch.object(cloud, 'verify', return_value=MODELS) as verify:
            self.assertEqual(proxied('connect', {'api_key':KEY, 'storage':'session'}).status_code, 200)
            self.assertEqual(proxied('verify').status_code, 200)
        self.assertEqual(verify.call_count, 2)
        self.assertEqual(proxied('select', {'model':'openai:gpt-4.1-mini', 'effort':'default'}).status_code, 200)
        settings = json.loads(main.SETTINGS_PATH.read_text())
        self.assertEqual(settings['chat_model'], 'openai:gpt-4.1-mini')
        self.assertNotIn('_connection_token', settings)
        self.assertEqual(proxied('disconnect').status_code, 200)
        self.assertFalse(self.store.public('openai')['connected'])
        self.assertNotIn(self.store.token, self.store.path.read_text())

    def test_proxy_body_nonce_supports_onboarding_and_header_remains_authoritative(self):
        response = self.client.post('/api/connections/onboarding',
            json={'complete':True, '_connection_token':self.store.token})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(response.json()['onboarding_required'])
        self.assertNotIn(self.store.token, self.store.install_path.read_text())
        refused = self.client.post('/api/connections/onboarding',
            json={'complete':True, '_connection_token':self.store.token},
            headers={'X-Kinema-Connection-Token':'stale-header'})
        self.assertEqual(refused.status_code, 403)
        # Existing callers can keep the header; unrelated body data cannot
        # override the explicitly supplied, valid nonce.
        self.assertEqual(self.post('onboarding', {'complete':True, '_connection_token':'ignored'}).status_code, 200)

    def test_invalid_body_nonce_cannot_reach_api_cli_or_onboarding_mutations(self):
        from app import cli_connections
        with mock.patch.object(self.store, 'verify') as verify, \
             mock.patch.object(self.store, 'complete_onboarding') as complete, \
             mock.patch.object(cli_connections, 'manager') as cli_manager:
            for path in ('openai/verify', 'cli/codex/login', 'onboarding'):
                for token in (None, 'wrong', {}, 12, '\u2022' * 40, 'x' * 257):
                    with self.subTest(path=path, token_type=type(token).__name__):
                        response = self.client.post('/api/connections/' + path,
                            json={'complete':True, '_connection_token':token})
                        self.assertEqual(response.status_code, 403, response.text)
            verify.assert_not_called()
            complete.assert_not_called()
            cli_manager.assert_not_called()

    def test_body_nonce_keeps_preparse_origin_json_and_route_size_guards(self):
        headers = {'Content-Type':'application/json'}
        body = json.dumps({'complete':True, '_connection_token':self.store.token})
        # Parsing cannot run before these guards, even with a valid body nonce.
        cases = [('openai/verify', body, {**headers, 'Origin':'https://untrusted.test'}, 403),
                 ('onboarding', body, {'Content-Type':'text/plain'}, 415),
                 ('openai/verify', 'x' * 8193, headers, 413),
                 ('cli/codex/check', 'x' * 4097, headers, 413),
                 ('onboarding', 'x' * 1001, headers, 413)]
        for path, raw, request_headers, expected in cases:
            with self.subTest(path=path, expected=expected):
                with mock.patch.object(pc.json, 'loads', side_effect=AssertionError('Must reject before JSON parsing')):
                    response = self.client.post('/api/connections/' + path, content=raw, headers=request_headers)
                self.assertEqual(response.status_code, expected)
        for raw in ('[1,2]', '{invalid', '[' * 1200 + ']' * 1200):
            response = self.client.post('/api/connections/openai/verify', content=raw, headers=headers)
            self.assertEqual(response.status_code, 400, response.text)

    def test_connection_data_is_scoped_to_install_and_public_catalog_has_only_available_connections(self):
        with mock.patch.object(cloud, 'verify', return_value=MODELS): self.store.connect('openai', KEY)
        with tempfile.TemporaryDirectory() as other:
            separate = pc.ConnectionStore(Path(other), self.secret)
            self.assertEqual(separate.models(), [])
        with mock.patch.dict(os.environ, {'KINEMA_DISTRIBUTION':'public'}):
            self.assertEqual([m['id'] for m in model_choices.catalog()], ['openai:gpt-4.1-mini'])


@unittest.skipUnless(os.name == 'nt', 'Windows DPAPI only')
class DPAPI(unittest.TestCase):
    def test_fake_credential_roundtrip_ciphertext_and_install_binding(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            secret = pc.SecretStorage(root)
            secret.set('openai', KEY)
            self.assertNotIn(KEY.encode(), secret._path('openai').read_bytes())
            self.assertEqual(secret.get('openai'), KEY)
            different = pc.SecretStorage(root / 'different')
            different._path('openai').parent.mkdir(parents=True)
            different._path('openai').write_bytes(secret._path('openai').read_bytes())
            with self.assertRaises(ProviderError): different.get('openai')
            secret.delete('openai')
            self.assertIsNone(secret.get('openai'))
