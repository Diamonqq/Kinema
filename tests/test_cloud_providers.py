"""Recorded HTTP contracts only; MockTransport never connects to a provider."""
import asyncio
import json
import threading
import time
from unittest import mock

import httpx

from provider_fixture import Base
from test_provider_connections import KEY, MemorySecrets
from app import cloud_providers as cloud, main, model_choices, provider_connections as pc
from app.providers import ProviderError

ROWS = {
    'openai': [{'id':'gpt-4.1-mini'}, {'id':'whisper-1'}],
    'anthropic': [{'id':'claude-haiku-5-5','display_name':'Claude Haiku 5.5','lifecycle':'active',
                   'capabilities':{'image_input':{'supported':True},'structured_outputs':{'supported':True},
                                   'effort':{'supported':True,'low':{'supported':True},'medium':{'supported':True},'high':{'supported':True}}}}],
    'gemini': [{'name':'models/gemini-3.8-flash','displayName':'Gemini Flash','supportedGenerationMethods':['generateContent'],'outputTokenLimit':8192}],
    'kimi': [{'id':'kimi-k3'}, {'id':'kimi-k2.6'}],
    'openrouter': [{'id':'openai/gpt-4.1-mini','name':'OpenAI Mini','architecture':{'input_modalities':['text','image'],'output_modalities':['text']},'supported_parameters':['response_format','structured_outputs']}],
}
ANSWER = '{"answer":"A clear explanation."}'
SCHEMA = json.dumps({'type':'object','properties':{'answer':{'type':'string','maxLength':100}},'required':['answer'],'additionalProperties':False})


class CloudProviders(Base):
    def setUp(self):
        super().setUp()
        self.store = pc.ConnectionStore(main.DATA, MemorySecrets())
        state = {}
        for pid, rows in ROWS.items():
            self.store.session[pid] = KEY
            state[pid] = {'source':'session','models':cloud.normalize_models(pid, rows),'verified_at':1}
        self.store._write(state)
        patch = mock.patch.object(pc, 'store', return_value=self.store)
        patch.start(); self.addCleanup(patch.stop)
        self.calls = []

    def choice(self, pid, effort='default'):
        return {'model': self.store.public(pid)['models'][0]['id'], 'effort': effort, 'speed':'standard'}

    def success(self, pid):
        if pid == 'openai': return {'status':'completed','output':[{'content':[{'type':'output_text','text':ANSWER}]}], 'usage':{'input_tokens':12,'output_tokens':7,'input_tokens_details':{'cached_tokens':2}}}
        if pid == 'anthropic': return {'stop_reason':'end_turn','content':[{'type':'text','text':ANSWER}], 'usage':{'input_tokens':10,'output_tokens':7,'cache_read_input_tokens':2}}
        if pid == 'gemini': return {'candidates':[{'finishReason':'STOP','content':{'parts':[{'thought':True,'text':'PRIVATE THOUGHT'},{'text':ANSWER}]}}], 'usageMetadata':{'promptTokenCount':12,'candidatesTokenCount':5,'thoughtsTokenCount':2}}
        return {'choices':[{'finish_reason':'stop','message':{'content':ANSWER,'reasoning_content':'PRIVATE THOUGHT'}}], 'usage':{'prompt_tokens':12,'completion_tokens':7}}

    def handler(self, pid):
        def request(req):
            self.calls.append(req)
            return httpx.Response(200, json=self.success(pid))
        return httpx.MockTransport(request)

    def test_each_adapter_exact_host_auth_schema_image_and_usage(self):
        picture = main.DATA / 'fake.png'; picture.write_bytes(b'\x89PNGfake-image')
        for pid in ROWS:
            with self.subTest(provider=pid), mock.patch.object(cloud, '_TRANSPORT', self.handler(pid)):
                text, meta = model_choices.run(self.choice(pid), 'Explain this picture.', images=[str(picture)], schema_text=SCHEMA, system='Teach briefly.')
                req = self.calls[-1]; body = json.loads(req.content)
                self.assertEqual(text, ANSWER)
                self.assertEqual(req.url.host, httpx.URL(cloud.BASES[pid]).host)
                self.assertEqual(req.method, 'POST')
                self.assertEqual(meta['model'], self.choice(pid)['model'])
                self.assertEqual(meta['usage']['input_tokens'], 12)
                self.assertEqual(meta['usage']['output_tokens'], 7)
                self.assertNotIn('PRIVATE THOUGHT', text)
                self.assertNotIn(KEY, json.dumps(meta))
                self.assertIn('base64', req.content.decode() if pid != 'gemini' else json.dumps({'base64':body['contents'][0]['parts'][1]['inlineData']['data']}))
                if pid == 'openai':
                    self.assertFalse(body['store'])
                    self.assertTrue(body['text']['format']['strict'])
                    self.assertEqual(req.headers['authorization'], 'Bearer '+KEY)
                elif pid == 'anthropic':
                    self.assertEqual(req.headers['x-api-key'], KEY)
                    self.assertEqual(body['output_config']['format']['type'], 'json_schema')
                    self.assertNotIn('thinking', body)
                elif pid == 'gemini':
                    self.assertEqual(req.headers['x-goog-api-key'], KEY)
                    self.assertNotIn(KEY, str(req.url))
                    self.assertEqual(body['generationConfig']['responseMimeType'], 'application/json')
                    self.assertIn('responseJsonSchema', body['generationConfig'])
                elif pid == 'kimi': self.assertEqual(body['response_format'], {'type':'json_object'})
                elif pid == 'openrouter': self.assertEqual(body['provider'], {'require_parameters':True,'allow_fallbacks':False})

    def test_verify_never_generates_and_openrouter_auth_is_not_public_model_list(self):
        for pid in ROWS:
            calls = []
            def transport(req):
                calls.append(req)
                if req.url.path.endswith('/key'): return httpx.Response(200, json={'data':{'is_free_tier':False}})
                return httpx.Response(200, json={'models' if pid == 'gemini' else 'data':ROWS[pid]})
            with self.subTest(provider=pid), mock.patch.object(cloud, '_TRANSPORT', httpx.MockTransport(transport)):
                got = cloud.verify(pid, KEY)
                self.assertTrue(got)
                self.assertTrue(all(r.method == 'GET' for r in calls))
                self.assertEqual(len(calls), 2 if pid == 'openrouter' else 1)
                if pid == 'openrouter': self.assertTrue(calls[0].url.path.endswith('/key'))
        with mock.patch.object(cloud, '_TRANSPORT', httpx.MockTransport(lambda r:httpx.Response(401,json={'error':KEY}))) as transport:
            with self.assertRaises(ProviderError): cloud.verify('openrouter', KEY)

    def test_capabilities_come_from_catalog_and_unknown_controls_stay_default(self):
        self.assertEqual(self.store.public('openai')['models'][0]['efforts'], ['default'])
        self.assertEqual(self.store.public('anthropic')['models'][0]['efforts'], ['default','low','medium','high'])
        kimi = {m['id']:m for m in self.store.public('kimi')['models']}
        self.assertEqual(kimi['kimi:kimi-k3']['efforts'], ['default','low','high','max'])
        self.assertEqual(kimi['kimi:kimi-k2.6']['efforts'], ['default'])
        self.assertEqual(cloud.normalize_models('openrouter',[{'id':'openrouter/auto','architecture':{'output_modalities':['text']},'supported_parameters':['structured_outputs']}]), [])
        self.assertEqual(cloud.normalize_models('openai',[{'id':'gpt-4o-realtime-preview'},{'id':'gpt-image-1'},{'id':'../evil'}]), [])
        unknown = cloud.normalize_models('anthropic',[{'id':'claude-new','capabilities':{}}])[0]
        self.assertFalse(unknown['image_input'])
        self.assertEqual(unknown['efforts'], ['default'])

    def test_schema_preserves_nested_choices_and_makes_optional_properties_strict(self):
        nested = {'type':'object','properties':{'x':{'type':['number','null']}}}
        source = {'type':'object','properties':{'optional':{'type':'boolean'},
                    'items':{'type':'array','items':{'anyOf':[{'type':'string'},nested]}}}, 'required':['items']}
        strict = cloud._schema(source,True)
        self.assertEqual(strict['required'],['optional','items'])
        nested = strict['properties']['items']['items']['anyOf'][1]
        self.assertEqual(nested['required'],['x'])
        self.assertFalse(nested['additionalProperties'])
        self.assertEqual(nested['properties']['x']['type'],['number','null'])
        self.assertEqual(source['required'],['items'])

    def test_actual_teacher_and_visual_schemas_keep_all_properties_and_choices(self):
        from app import teacher, tutor
        for original in (teacher.REPLY_SCHEMA, json.loads(tutor.schema_file_text())):
            transformed = cloud._schema(original,True)
            def compare(before, after):
                if isinstance(before,list):
                    self.assertEqual(len(before),len(after))
                    for old,new in zip(before,after): compare(old,new)
                elif isinstance(before,dict):
                    if 'properties' in before:
                        self.assertEqual(set(before['properties']),set(after['properties']))
                        self.assertEqual(set(after['required']),set(before['properties']))
                        self.assertFalse(after['additionalProperties'])
                    for key in ('type','enum'): 
                        if key in before:self.assertEqual(before[key],after[key])
                    for key in ('properties','items','anyOf','$defs'):
                        if key in before:compare(before[key],after[key])
                    if 'properties' not in before:
                        for key in set(before)&set(after)-{'properties','items','anyOf','$defs'}:
                            if isinstance(before[key],(dict,list)):compare(before[key],after[key])
            compare(original,transformed)

    def test_selected_effort_is_sent_exactly_and_unsupported_effort_refused(self):
        with mock.patch.object(cloud, '_TRANSPORT', self.handler('anthropic')):
            cloud.run(self.choice('anthropic','medium'), 'Explain.', schema_text=SCHEMA)
            self.assertEqual(json.loads(self.calls[-1].content)['output_config']['effort'], 'medium')
        choice = {'model':'kimi:kimi-k3','effort':'high','speed':'standard'}
        with mock.patch.object(cloud, '_TRANSPORT', self.handler('kimi')):
            cloud.run(choice, 'Explain.', schema_text=SCHEMA)
            self.assertEqual(json.loads(self.calls[-1].content)['reasoning_effort'], 'high')
            with self.assertRaises(ProviderError): cloud.run({**choice,'effort':'medium'}, 'Explain.')
        with mock.patch.object(cloud, '_request', side_effect=AssertionError('must not send')):
            with self.assertRaises(ProviderError): cloud.run({**self.choice('openai'),'speed':'fast'}, 'Explain.')

    def test_errors_never_leak_headers_body_or_key_and_never_retry(self):
        for status in (400,401,402,403,404,429,500,302):
            calls = []
            def failure(req):
                calls.append(req)
                return httpx.Response(status, json={'error':KEY,'prompt':'private'}, headers={'Location':'https://untrusted.test/key'})
            with self.subTest(status=status), mock.patch.object(cloud,'_TRANSPORT',httpx.MockTransport(failure)):
                with self.assertRaises(ProviderError) as error: cloud.run(self.choice('openai'), 'Explain.')
                self.assertNotIn(KEY,str(error.exception))
                self.assertNotIn('private',str(error.exception))
                self.assertEqual(len(calls), 1)

    def test_refusal_invalid_json_and_incomplete_answer_do_not_retry(self):
        bad = [{'status':'incomplete'}, {'status':'completed','output':[{'content':[{'type':'refusal','refusal':KEY}]}]},
               {'status':'completed','output':[{'content':[{'type':'output_text','text':'not JSON'}]}]}]
        for value in bad:
            calls=[]
            def transport(req): calls.append(req); return httpx.Response(200,json=value)
            with mock.patch.object(cloud,'_TRANSPORT',httpx.MockTransport(transport)):
                with self.assertRaises(ProviderError) as error: cloud.run(self.choice('openai'),'Explain.',schema_text=SCHEMA)
                self.assertNotIn(KEY,str(error.exception)); self.assertEqual(len(calls),1)

    def test_cancel_before_send_and_during_request_closes_owned_work(self):
        cancel=threading.Event(); cancel.set()
        with mock.patch.object(cloud,'_request',side_effect=AssertionError('no send')):
            with self.assertRaises(ProviderError): cloud.run(self.choice('openai'),'Explain.',cancel=cancel)
        cancel.clear(); entered=threading.Event(); cleaned=threading.Event()
        async def slow(req):
            entered.set()
            try: await asyncio.sleep(5)
            finally: cleaned.set()
            return httpx.Response(200,json=self.success('openai'))
        timer=threading.Timer(.1,cancel.set); timer.start()
        try:
            with mock.patch.object(cloud,'_TRANSPORT',httpx.MockTransport(slow)):
                with self.assertRaises(ProviderError) as error: cloud.run(self.choice('openai'),'Explain.',cancel=cancel)
                self.assertIn('Stopped',str(error.exception))
            self.assertTrue(entered.is_set()); self.assertTrue(cleaned.is_set())
        finally: timer.cancel(); timer.join()

    def test_timeout_cleanup_and_no_environment_proxy(self):
        cleaned=threading.Event()
        async def slow(req):
            try: await asyncio.sleep(5)
            finally: cleaned.set()
            return httpx.Response(200,json={})
        started=time.monotonic()
        with mock.patch.object(cloud,'_TRANSPORT',httpx.MockTransport(slow)):
            with self.assertRaises(ProviderError): cloud._request('openai','/models',KEY,timeout=.1)
        self.assertLess(time.monotonic()-started,1); self.assertTrue(cleaned.is_set())

    def test_invalid_model_or_image_never_sends(self):
        with mock.patch.object(cloud,'_request',side_effect=AssertionError('no request')):
            with self.assertRaises(ProviderError): cloud.run({'model':'openai:invented','effort':'default','speed':'standard'},'Explain.')
            with self.assertRaises(ProviderError): cloud.run(self.choice('openai'),'Explain.',images=['missing.png'])

    def test_public_distribution_dispatches_explicit_official_cli_choice(self):
        from app import providers, cli_connections
        with mock.patch.dict('os.environ', {'KINEMA_DISTRIBUTION':'public'}), \
             mock.patch.object(cli_connections.manager(), 'snapshot', return_value={'connected':True,'supported':True,'state':'signed_in'}), \
             mock.patch.object(providers,'run_claude') as cli:
            cli.return_value = ('A clear explanation.', {'model':'claude-haiku-5-5'})
            answer, _meta = model_choices.run({'model':'claude:claude-haiku-5-5','effort':'medium','speed':'standard'},'Explain.')
            self.assertEqual(answer, 'A clear explanation.')
            self.assertEqual(cli.call_args.args[1:3], ('claude-haiku-5-5', 'medium'))

    def test_malformed_success_is_sanitized_without_repeating_request(self):
        with mock.patch.object(cloud,'_TRANSPORT',httpx.MockTransport(lambda req:httpx.Response(200,json={'output':[{'content':[KEY]}]}))):
            with self.assertRaises(ProviderError) as error: cloud.run(self.choice('openai'),'Explain.')
            self.assertNotIn(KEY,str(error.exception))

    def test_language_choice_is_captured_before_dispatch(self):
        from app import localization
        with mock.patch.object(localization,'languages',return_value=[{'id':'en','name':'English'},{'id':'es','name':'Spanish'}]):
            choice=model_choices.profile({'chat_model':'openai:gpt-4.1-mini','chat_effort':'default','ui_language':'es'},'chat')
            self.assertEqual(choice['language'],'es')
            with mock.patch.object(cloud,'_TRANSPORT',self.handler('openai')):
                model_choices.run(choice,'Explain.')
            self.assertIn('Spanish',json.loads(self.calls[-1].content)['instructions'])
