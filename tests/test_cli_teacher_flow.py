"""Public-install CLI selection reaches saved tutoring; native account/model I/O is fake."""
import json
import os
import sys
from unittest import mock

from fastapi.testclient import TestClient

from provider_fixture import Base
import test_provider_teacher_flow as flow
from test_provider_connections import MemorySecrets
from app import cli_connections as cc, cli_runners, main, provider_connections as pc, providers, teacher_content


class CLITeacherFlow(Base):
    post = flow.ProviderTeacherFlow.post
    create = flow.ProviderTeacherFlow.create
    act = flow.ProviderTeacherFlow.act
    reload = flow.ProviderTeacherFlow.reload
    wait = flow.ProviderTeacherFlow.wait
    finish_owned_jobs = flow.ProviderTeacherFlow.finish_owned_jobs
    assert_saved_answer = flow.ProviderTeacherFlow.assert_saved_answer

    def setUp(self):
        super().setUp()
        import threading
        self.release = threading.Event(); self.release.set()
        self.owned_jobs, self.calls = [], []
        self.store = pc.ConnectionStore(main.DATA, MemorySecrets())
        self.manager = cc.Manager(main.DATA)
        directory = main.DATA / 'course'; directory.mkdir()
        (directory/'study_courses.json').write_text(json.dumps({'courses':[
            {'id':flow.COURSE,'title':'Fixture mechanics','material_refs':[]}]}),encoding='utf8')
        (directory/'learning_profile.json').write_text(json.dumps({'version':1,'style':'One idea at a time.'}),encoding='utf8')
        def caps(pid):
            return {'supported':True,'models':['gpt-6-sol' if pid=='codex' else 'haiku' if pid=='claude' else 'fixture-model'],
                    'efforts':['medium'] if pid in ('codex','claude') else ['default'],'images':False}
        for patch in (mock.patch.object(pc,'store',return_value=self.store),
                      mock.patch.object(cc,'manager',return_value=self.manager),
                      mock.patch.object(cc,'_runtime',side_effect=lambda pid:([sys.executable],caps(pid))),
                      mock.patch.object(cli_runners,'account_models',return_value=[{'id':'fixture-model'}]),
                      mock.patch.object(cli_runners,'resolve_binary',return_value=[sys.executable]),
                      mock.patch.object(cli_runners,'capabilities',side_effect=caps),
                      mock.patch.object(teacher_content,'CONTENT',directory),
                      mock.patch.dict(os.environ,{'KINEMA_DISTRIBUTION':'public'}),
                      mock.patch.object(providers,'run_codex',side_effect=self.codex),
                      mock.patch.object(providers,'run_claude',side_effect=self.claude),
                      mock.patch.object(cli_runners,'run',side_effect=self.other)):
            patch.start(); self.addCleanup(patch.stop)
        teacher_content._courses_raw.cache_clear(); teacher_content.profile.cache_clear()
        self.addCleanup(teacher_content._courses_raw.cache_clear); self.addCleanup(teacher_content.profile.cache_clear)
        self.client=TestClient(flow.LocalPeer(main.app),base_url='http://127.0.0.1:8790')
        self.addCleanup(self.client.close); self.addCleanup(self.manager.close); self.addCleanup(self.finish_owned_jobs)
        self.failure=False

    def answer(self,pid,model,effort,prompt,system=''):
        self.calls.append({'provider':pid,'model':model,'effort':effort,'prompt':prompt,'system':system})
        if self.failure: raise providers.ProviderError('This account has reached its usage limit. Try again later.')
        return flow.reply_json(),{'model':model,'usage':{'input_tokens':42,'output_tokens':25}}

    def codex(self,prompt,images,model,effort,schema_path,**kwargs):
        self.assertTrue(schema_path.exists())
        return self.answer('codex',model,effort,prompt)

    def claude(self,prompt,model,effort,**kwargs):
        return self.answer('claude',model,effort,prompt,kwargs.get('system',''))

    def other(self,choice,prompt,**kwargs):
        pid,model=choice['model'].split(':',1)
        return self.answer(pid,model,choice['effort'],prompt,kwargs.get('system',''))

    def select(self,pid):
        self.manager.states[pid]={'state':'signed_in','checked_at':1}
        status=self.client.get('/api/connections').json()
        main._save_settings({'account_provider':pid})
        row=next(p for p in status['cli']['providers'] if p['id']==pid)
        self.assertTrue(row['installed']); self.assertTrue(row['connected'])
        model=row['models'][0]
        self.assertFalse(main.SETTINGS_PATH.exists() and json.loads(main.SETTINGS_PATH.read_text()).get('chat_model')==model['id'])
        self.post('/api/connections/cli/'+pid+'/select',{'role':'chat','model':model['id'],'effort':model['default_effort'],'speed':'standard'})
        self.post('/api/settings',{'tutor_language':'es'})
        self.assertEqual(self.client.get('/api/models').json()['roles']['chat']['model'],model['id'])
        return model

    def test_available_explicit_cli_choices_reach_saved_spanish_tutor(self):
        for pid in ('codex','claude','kimi-cli'):
            with self.subTest(provider=pid):
                self.calls.clear(); model=self.select(pid); thread=self.create()
                self.assertEqual(self.calls,[])
                pending=self.act(thread,text=flow.QUESTION)
                job=self.wait(pending['pending']); self.assertEqual(job.status,'done',job.snapshot())
                self.assert_saved_answer(thread,model,model['default_effort'])
                self.assertEqual(len(self.calls),1)
                call=self.calls[0]
                self.assertEqual((call['provider'],call['model']),(pid,model['id'].split(':',1)[1]))
                self.assertIn('Explain and ask questions in Spanish.',call['prompt']+call['system'])
                self.assertIn('TEACHING CONTEXT:',call['prompt'])

    def test_cli_failure_preserves_question_and_explicit_retry_uses_same_choice(self):
        model=self.select('kimi-cli'); thread=self.create(); self.failure=True
        pending=self.act(thread,text=flow.QUESTION)
        self.assertEqual(self.wait(pending['pending']).status,'error')
        failed=self.reload(thread)
        self.assertEqual([m['role'] for m in failed['messages']],['user'])
        self.assertEqual(failed['messages'][0]['text'],flow.QUESTION)
        self.assertIsNone(failed['pending']); self.assertTrue(failed['error'])
        self.failure=False; retried=self.act(failed,'retry')
        self.assertEqual(self.wait(retried['pending']).status,'done')
        saved=self.assert_saved_answer(thread,model,model['default_effort'])
        self.assertEqual(saved['messages'][0]['id'],failed['messages'][0]['id'])
        self.assertEqual([c['provider'] for c in self.calls],['kimi-cli','kimi-cli'])


if __name__=='__main__':
    import unittest
    unittest.main()
