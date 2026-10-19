"""Full local API-to-saved-tutor flow; fake keys and recorded HTTP shapes only.

No tutor/router/model dispatch is mocked. A disposable, source-free course keeps
this suite runnable in the public package without the owner's course or PDFs.
"""
import asyncio
import base64
import json
import threading
import time
import uuid
from unittest import mock

import httpx
from fastapi.testclient import TestClient

from provider_fixture import Base
from test_provider_connections import KEY, MemorySecrets
from test_cloud_providers import ROWS
from app import cloud_providers as cloud, jobs, main, provider_connections as pc, teacher_content


COURSE = 'provider-fixture'
QUESTION = 'What is force? Please explain in Spanish.'
ANSWER = 'Una fuerza es un empuje o un tirón. Se mide en newtons (N) y puede cambiar la velocidad de un objeto.'
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9uoAAAAASUVORK5CYII=')


def reply_json():
    return json.dumps({'read_sources': [], 'read_history': {'query': '', 'ids': []},
        'reply_kind': 'focused', 'answer': ANSWER, 'details': '', 'current_step': 'Qué significa fuerza',
        'problem_switch': '', 'sources': [], 'book_solution_complete': False,
        'visual': {'action': 'none', 'show': [], 'focus': '', 'camera': '', 'playback': 'keep',
                   'time': None, 'then_explain': False, 'request': '', 'subject': 'current_problem',
                   'library': '', 'diagram': '', 'parameters': []}, 'evidence': [], 'topic_notes': []})


class LocalPeer:
    """Supply the real loopback peer that TestClient's in-process transport lacks."""
    def __init__(self, app): self.app = app
    async def __call__(self, scope, receive, send):
        scope = {**scope, 'client': ('127.0.0.1', 12345)}
        await self.app(scope, receive, send)


class ProviderTeacherFlow(Base):
    def setUp(self):
        super().setUp()
        self.store = pc.ConnectionStore(main.DATA, MemorySecrets())
        self.calls, self.owned_jobs = [], []
        self.arrived, self.release = threading.Event(), threading.Event()
        self.release.set()
        self.quota = False
        course_dir = main.DATA / 'course'
        course_dir.mkdir()
        (course_dir / 'study_courses.json').write_text(json.dumps({'courses': [
            {'id': COURSE, 'title': 'Fixture physics', 'material_refs': []}]}), encoding='utf8')
        (course_dir / 'learning_profile.json').write_text(json.dumps({
            'version': 1, 'style': 'Explain one idea in plain language.'}), encoding='utf8')
        for patch in (mock.patch.object(pc, 'store', return_value=self.store),
                      mock.patch.object(teacher_content, 'CONTENT', course_dir),
                      mock.patch.object(cloud, '_TRANSPORT', httpx.MockTransport(self.http)),
                      mock.patch.dict('os.environ', {'KINEMA_DISTRIBUTION': 'public'})):
            patch.start()
            self.addCleanup(patch.stop)
        teacher_content._courses_raw.cache_clear()
        teacher_content.profile.cache_clear()
        self.addCleanup(teacher_content._courses_raw.cache_clear)
        self.addCleanup(teacher_content.profile.cache_clear)
        self.client = TestClient(LocalPeer(main.app), base_url='http://127.0.0.1:8790')
        self.addCleanup(self.client.close)
        # Job cleanup runs before the client, content and DATA patches are removed.
        self.addCleanup(self.finish_owned_jobs)

    def finish_owned_jobs(self):
        self.release.set()
        for jid in self.owned_jobs:
            self.wait(jid)
        for jid in self.owned_jobs:
            with jobs._LOCK:
                jobs._JOBS.pop(jid, None)

    def wait(self, jid):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            job = jobs.get(jid)
            if job and job.status != 'running': return job
            time.sleep(.01)
        if job: job.cancel.set()
        self.fail('Owned tutor job did not finish within ten seconds.')

    async def http(self, request):
        pid = next(p for p, url in cloud.BASES.items() if httpx.URL(url).host == request.url.host)
        self.calls.append((pid, request))
        if request.method == 'GET':
            if request.url.path.endswith('/key'):
                return httpx.Response(200, json={'data': {'is_free_tier': False}})
            return httpx.Response(200, json={'models' if pid == 'gemini' else 'data': ROWS[pid]})
        self.arrived.set()
        while not self.release.is_set(): await asyncio.sleep(.005)
        if self.quota:
            return httpx.Response(429, json={'error': {'message': 'Private provider error: ' + KEY}})
        answer = reply_json()
        if pid == 'openai':
            body = {'status': 'completed', 'output': [{'type': 'message', 'role': 'assistant',
                    'content': [{'type': 'output_text', 'text': answer}]}],
                    'usage': {'input_tokens': 42, 'output_tokens': 25}}
        elif pid == 'anthropic':
            body = {'type': 'message', 'role': 'assistant', 'stop_reason': 'end_turn',
                    'content': [{'type': 'text', 'text': answer}],
                    'usage': {'input_tokens': 42, 'output_tokens': 25}}
        elif pid == 'gemini':
            body = {'candidates': [{'finishReason': 'STOP', 'content': {'role': 'model',
                    'parts': [{'text': answer}]}}],
                    'usageMetadata': {'promptTokenCount': 42, 'candidatesTokenCount': 25}}
        else:
            body = {'choices': [{'finish_reason': 'stop', 'message': {'role': 'assistant', 'content': answer}}],
                    'usage': {'prompt_tokens': 42, 'completion_tokens': 25}}
        return httpx.Response(200, json=body)

    def post(self, path, body):
        response = self.client.post(path, json=body,
            headers={'X-Kinema-Connection-Token': self.store.token})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotIn(KEY, response.text)
        return response.json()

    def connect_select(self, pid):
        before = main.SETTINGS_PATH.read_bytes() if main.SETTINGS_PATH.exists() else None
        status = self.client.get('/api/connections')
        self.assertEqual(status.status_code, 200, status.text)
        self.assertEqual(status.json()['token'], self.store.token)
        connected = self.post('/api/connections/' + pid + '/connect', {'api_key': KEY, 'storage': 'secure'})
        self.assertEqual(main.SETTINGS_PATH.read_bytes() if main.SETTINGS_PATH.exists() else None, before)
        provider = next(p for p in connected['providers'] if p['id'] == pid)
        self.assertTrue(provider['connected'])
        self.assertTrue(provider['verified_at'])
        model = next(m for m in provider['models'] if m['id'] == 'kimi:kimi-k3') if pid == 'kimi' else provider['models'][0]
        effort = 'medium' if pid == 'anthropic' else 'high' if pid == 'kimi' else 'default'
        status = self.post('/api/connections/' + pid + '/select', {
            'model': model['id'], 'role': 'chat', 'effort': effort, 'speed': 'standard'})
        self.assertFalse(status['onboarding_required'])
        settings = json.loads(main.SETTINGS_PATH.read_text(encoding='utf8'))
        self.assertEqual(settings['chat_model'], model['id'])
        self.assertEqual(settings['chat_effort'], effort)
        self.assertNotIn(KEY, json.dumps(settings))
        models = self.client.get('/api/models').json()
        self.assertEqual(models['roles']['chat']['model'], model['id'])
        self.assertFalse(any(m['id'].startswith(('claude:', 'codex:')) for m in models['models']))
        self.post('/api/settings', {'tutor_language': 'es'})
        return model, effort

    def create(self):
        thread = self.post('/api/teacher/threads', {'course_id': COURSE, 'fresh': True, 'request_id': uuid.uuid4().hex})
        self.assertEqual(thread['messages'], [])
        self.assertIsNone(thread['pending'])
        return thread

    def act(self, thread, action='message', **extra):
        pending = self.post('/api/teacher/threads/' + thread['id'] + '/act', {
            'action': action, 'revision': thread['revision'], 'request_id': uuid.uuid4().hex, **extra})
        self.assertTrue(pending['pending'], pending)
        self.owned_jobs.append(pending['pending'])
        return pending

    def reload(self, thread):
        response = self.client.get('/api/teacher/threads/' + thread['id'])
        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotIn(KEY, response.text)
        return response.json()

    def generation_calls(self):
        return [(pid, req) for pid, req in self.calls if req.method == 'POST']

    def assert_dispatch(self, pid, model, expected_count):
        requests = self.generation_calls()
        self.assertEqual(len(requests), expected_count)
        self.assertEqual({p for p, req in self.calls}, {pid})
        raw_model = model['id'].split(':', 1)[1]
        for called_pid, req in requests:
            self.assertEqual(called_pid, pid)
            body = json.loads(req.content)
            if pid == 'gemini': self.assertTrue(req.url.path.endswith('/' + raw_model + ':generateContent'))
            else: self.assertEqual(body['model'], raw_model)
            if pid == 'anthropic': self.assertEqual(body['output_config']['effort'], 'medium')
            if pid == 'kimi': self.assertEqual(body['reasoning_effort'], 'high')
            if pid == 'openrouter': self.assertEqual(body['provider'], {'require_parameters': True, 'allow_fallbacks': False})
            self.assertIn('Explain and ask questions in Spanish.', req.content.decode())
            self.assertIn('TEACHING CONTEXT:', req.content.decode())
            self.assertNotIn(KEY, req.content.decode())

    def assert_saved_answer(self, thread, model, effort):
        final = self.reload(thread)
        self.assertIsNone(final['pending'])
        self.assertIsNone(final['error'], final['error'])
        self.assertEqual([m['role'] for m in final['messages']], ['user', 'assistant'])
        answer = final['messages'][-1]
        self.assertEqual(answer['text'], ANSWER)
        self.assertEqual((answer['model'], answer['effort'], answer['speed']), (model['id'], effort, 'standard'))
        self.assertEqual(answer['context_usage']['input_tokens'], 42)
        self.assertEqual(answer['context_usage']['output_tokens'], 25)
        # Reopen from SQLite through the normal read route: completion is durable.
        self.assertEqual(self.reload(thread)['messages'], final['messages'])
        return final

    def complete_flow(self, pid):
        model, effort = self.connect_select(pid)
        thread = self.create()
        self.assertEqual(len(self.generation_calls()), 0, 'Opening must never generate.')
        pending = self.act(thread, text=QUESTION)
        job = self.wait(pending['pending'])
        self.assertEqual(job.status, 'done', job.snapshot())
        self.assertEqual(job.info['language'], 'es')
        self.assert_saved_answer(thread, model, effort)
        self.assert_dispatch(pid, model, 1)
        # A quota failure keeps the exact user message, then an explicit retry
        # succeeds through the same selected provider without another user row.
        self.quota = True
        thread = self.create()
        failed = self.act(thread, text=QUESTION)
        job = self.wait(failed['pending'])
        self.assertEqual(job.status, 'error', job.snapshot())
        final = self.reload(thread)
        self.assertIsNone(final['pending'])
        self.assertEqual([m['role'] for m in final['messages']], ['user'])
        self.assertEqual(final['messages'][0]['text'], QUESTION)
        self.assertIn('retry', final['error'])
        self.assertNotIn(KEY, json.dumps(job.snapshot()))
        self.assertNotIn('Private provider error', final['error'])
        self.assert_dispatch(pid, model, 2)
        self.quota = False
        retried = self.act(final, 'retry')
        self.assertEqual(self.wait(retried['pending']).status, 'done')
        saved = self.assert_saved_answer(thread, model, effort)
        self.assertEqual(saved['messages'][0]['id'], final['messages'][0]['id'])
        self.assert_dispatch(pid, model, 3)

    def test_openai_connect_select_teach_quota_retry(self): self.complete_flow('openai')
    def test_anthropic_connect_select_teach_quota_retry(self): self.complete_flow('anthropic')
    def test_gemini_connect_select_teach_quota_retry(self): self.complete_flow('gemini')
    def test_kimi_connect_select_teach_quota_retry(self): self.complete_flow('kimi')
    def test_openrouter_connect_select_teach_quota_retry(self): self.complete_flow('openrouter')

    def test_uploaded_image_reaches_selected_vision_model_and_language_stays_captured(self):
        model, effort = self.connect_select('openai')
        self.assertTrue(model['image_input'])
        thread = self.create()
        uploaded = self.client.post('/api/teacher/attachments', data={'course_id': COURSE},
            files={'files': ('force.png', PNG, 'image/png')})
        self.assertEqual(uploaded.status_code, 200, uploaded.text)
        attachment = uploaded.json()['attachments'][0]
        self.release.clear()
        pending = self.act(thread, text=QUESTION, attachment_ids=[attachment['id']])
        self.assertTrue(self.arrived.wait(5), 'Provider request did not arrive.')
        job = jobs.get(pending['pending'])
        self.assertEqual(job.info['language'], 'es')
        self.post('/api/settings', {'tutor_language': 'en'})
        self.release.set()
        self.assertEqual(self.wait(job.id).status, 'done', job.snapshot())
        final = self.assert_saved_answer(thread, model, effort)
        self.assertEqual(final['messages'][0]['attachment_ids'], [attachment['id']])
        self.assert_dispatch('openai', model, 1)
        body = json.loads(self.generation_calls()[0][1].content)
        pictures = [p for item in body['input'] for p in item['content'] if p['type'] == 'input_image']
        self.assertEqual(len(pictures), 1)
        self.assertEqual(base64.b64decode(pictures[0]['image_url'].split(',', 1)[1]), PNG)
        served = self.client.get('/api/teacher/attachments/' + attachment['id'])
        self.assertEqual(served.content, PNG)
        self.assertEqual(main._settings()['tutor_language'], 'en')

