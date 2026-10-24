"""Isolated experiment lifecycle and mocked selected-provider actions. No accounts."""
import json
import os
import shutil
import time
import uuid
from contextlib import closing, contextmanager
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

KIT = Path(__file__).resolve().parents[2] / 'kit'
KIT.mkdir(exist_ok=True)
_IMPORT = KIT / 'test-import'
_IMPORT.mkdir(exist_ok=True)
os.environ.update(KINEMA_DATA=str(_IMPORT), KINEMA_TASKS='off', KINEMA_REMINDER='off')
from app import experiments, jobs, learn_api, main, model_choices, teacher, teacher_content


class LocalPeer:
    def __init__(self, app): self.app = app
    async def __call__(self, scope, receive, send):
        await self.app({**scope, 'client': ('127.0.0.1', 12345)}, receive, send)


@pytest.fixture
def fixture(monkeypatch):
    with disposable() as directory:
        data = Path(directory)
        monkeypatch.setenv('KINEMA_DATA', directory)
        monkeypatch.setattr(main, 'DATA', data)
        monkeypatch.setattr(main, 'DB_PATH', data / 'kinema.db')
        monkeypatch.setattr(main, 'SETTINGS_PATH', data / 'settings.json')
        learn_api.setup(main.db, data, lambda lesson: main._lesson_digest(lesson))
        monkeypatch.setattr(teacher_content, 'course', lambda cid: {'id': 'fixture', 'title': 'Fixture physics'})
        monkeypatch.setattr(model_choices, 'validate_selection', lambda *args, **kwargs: {'model': 'claude:haiku', 'effort': 'medium', 'speed': 'standard'})
        monkeypatch.setattr(model_choices, 'profile', lambda *args, **kwargs: {'model': 'claude:haiku', 'effort': 'medium', 'speed': 'standard'})
        # Any unintended ordinary tutoring or learner writes are a test failure.
        monkeypatch.setattr(teacher, '_mark_assisted', lambda *a, **kw: pytest.fail('Experiment wrote learner evidence'))
        monkeypatch.setattr(teacher, '_apply_reply', lambda *a, **kw: pytest.fail('Experiment used ordinary tutor writer'))
        with TestClient(LocalPeer(main.app), base_url='http://127.0.0.1:8790') as client:
            owned = []
            yield client, owned
            for jid in owned:
                job = jobs.get(jid)
                if job and job.status == 'running':
                    job.cancel.set()
                with jobs._LOCK:
                    jobs._JOBS.pop(jid, None)


@contextmanager
def disposable():
    # Normal inherited Windows ACLs; Python's mode-0700 temp directories cannot
    # be reopened by this restricted runner on this PC.
    path = KIT / ('test-data-' + uuid.uuid4().hex)
    path.mkdir()
    try:
        yield str(path)
    finally:
        assert path.resolve().is_relative_to(KIT.resolve())
        shutil.rmtree(path)


def create(client, **extra):
    r = client.post('/api/teacher/threads', json={'course_id': 'fixture', 'mode': 'experiment',
        'experiment_id': 'coupled-oscillators', 'fresh': True, 'request_id': uuid.uuid4().hex, **extra})
    assert r.status_code == 200, r.text
    return r.json()


def finish(client, owned, thread):
    owned.append(thread['pending'])
    deadline = time.monotonic() + 5
    while jobs.get(thread['pending']).status == 'running' and time.monotonic() < deadline:
        time.sleep(.005)
    job = jobs.get(thread['pending'])
    assert job.status == 'done', job.__dict__
    return client.get('/api/teacher/threads/' + thread['id']).json()


def test_catalog_and_local_open_resume_save(fixture, monkeypatch):
    client, _ = fixture
    monkeypatch.setattr(model_choices, 'run', lambda *a, **kw: pytest.fail('Opening called a provider'))
    catalog = client.get('/api/experiments').json()['experiments']
    assert any(m['id'] == 'coupled-oscillators' for m in catalog)
    assert all((experiments.ROOT / m['id'] / f).exists() for m in catalog for f in ('model.js', 'view.js'))
    t = create(client)
    assert t['mode'] == 'experiment' and t['messages'] == [] and t['pending'] is None
    assert t['label'] == 'Coupled oscillators' and t['experiment']['state']['params']['n'] == 2
    state = t['experiment']['state'];state['params']['k2'] = 40
    r = client.put('/api/teacher/threads/' + t['id'] + '/experiment', json={'revision': t['revision'], 'state': state})
    assert r.status_code == 200, r.text
    again = create(client, resume=True)
    assert again['id'] == t['id'] and again['experiment']['state']['params']['k2'] == 40
    assert client.put('/api/teacher/threads/' + t['id'] + '/experiment', json={'revision': -1, 'state': state}).status_code == 409
    with closing(main.db()) as conn:
        assert json.loads(conn.execute('SELECT state FROM teacher_threads WHERE id=?', (t['id'],)).fetchone()[0])['evidence'] == []


@pytest.mark.parametrize('action,expected', [
    ({'type': 'set_params', 'values': {'k2': 40}}, 40),
    ({'type': 'set_params', 'values': {'k2': 1000}}, 2),
    ({'type': 'set_params', 'values': {'unknown': 40}}, 2),
    ({'type': 'set_params', 'values': {'k2': 40, 'unknown': 3}}, 2),
    ({'type': 'set_params', 'values': {'k2': 40.05}}, 2),
])
def test_mocked_provider_action(fixture, monkeypatch, action, expected):
    client, owned = fixture
    calls = []
    def run(choice, prompt, **kwargs):
        calls.append((choice, json.loads(prompt)))
        return json.dumps({'reply': 'The middle spring now sets the coupling.', 'action': action}), {'usage': {'input_tokens': 10, 'output_tokens': 20}}
    monkeypatch.setattr(model_choices, 'run', run)
    t = create(client)
    state = t['experiment']['state'];state.update(t=1.25, observables={'x1': .1, 'x2': -.08, 'energy': .4})
    r = client.post('/api/teacher/threads/' + t['id'] + '/act', json={'action': 'message', 'revision': t['revision'],
        'request_id': uuid.uuid4().hex, 'text': 'Change the middle spring to 40 N/m.', 'experiment_state': state})
    assert r.status_code == 200, r.text
    done = finish(client, owned, r.json())
    assert done['pending'] is None and not done['error'], done
    assert calls[0][0]['model'] == 'claude:haiku'
    assert calls[0][1]['current_state']['t'] == 1.25
    assert calls[0][1]['current_state']['observables']['x2'] == -.08
    assert done['experiment']['state']['params']['k2'] == expected
    reply = done['messages'][-1]
    assert reply['text'] == 'The middle spring now sets the coupling.'
    assert bool(reply['experiment_action']) == (expected == 40)
    assert bool(reply['experiment_chip']) == (expected == 40)
    with closing(main.db()) as conn:
        assert json.loads(conn.execute('SELECT state FROM teacher_threads WHERE id=?', (t['id'],)).fetchone()[0])['evidence'] == []


@pytest.mark.parametrize('action', [
    {'type': 'set_params', 'values': {'k2': True}},
    {'type': 'set_params', 'values': {'k2': float('nan')}},
    {'type': 'set_params', 'values': {'k2': float('inf')}},
    {'type': 'pause', 'values': {}}, {'type': 'preset', 'id': 'unknown'},
    {'type': 'closeup', 'id': '../other'}, {'type': 'graph', 'id': 'motion', 'enabled': 'yes'},
    {'type': 'breakdown', 'enabled': 1}, {'type': 'eval', 'code': 'alert(1)'},
])
def test_invalid_action_drops_whole_action(action):
    assert experiments.validate_action(experiments.get('coupled-oscillators'), action) is None


@pytest.mark.parametrize('action', [
    {'type': 'preset', 'id': 'mode1'}, {'type': 'play'}, {'type': 'pause'}, {'type': 'reset'},
    {'type': 'closeup', 'id': 'spring'}, {'type': 'closeup', 'id': ''},
    {'type': 'graph', 'id': 'motion', 'enabled': True}, {'type': 'breakdown', 'enabled': False},
])
def test_valid_view_actions(action):
    manifest = experiments.get('coupled-oscillators')
    assert experiments.validate_action(manifest, action) == action
    assert isinstance(experiments.apply(manifest, experiments.initial(manifest), action), dict)
    assert experiments.chip(manifest, action)


def test_snapshot_rejects_unknown_params_and_targets():
    m = experiments.get('coupled-oscillators')
    for patch in ({'params': {'bad': 1}}, {'params': {'k2': 40}, 'closeup': 'bad'}, {'params': {'k2': 40}, 'graphs': ['bad']}):
        with pytest.raises(ValueError):
            experiments.snapshot(m, patch)


def test_enum_and_numeric_option_actions():
    manifest = experiments.get('coupled-oscillators')
    for values in ({'method': 'numerical'}, {'modeA': 2}):
        action = {'type': 'set_params', 'values': values}
        assert experiments.validate_action(manifest, action) == action
    for values in ({'method': 'unknown'}, {'modeA': '2'}, {'modeA': True}):
        assert experiments.validate_action(manifest, {'type': 'set_params', 'values': values}) is None
    assert experiments.chip(manifest, {'type': 'set_params', 'values': {'k2': 40}}) == 'k₂ → 40 N/m'


def test_experiment_rejects_lesson_scope_without_writing(fixture, monkeypatch):
    client, _ = fixture
    monkeypatch.setattr(model_choices, 'run', lambda *a, **kw: pytest.fail('Rejected message called provider'))
    t = create(client)
    result = client.post('/api/teacher/threads/' + t['id'] + '/act', json={'action': 'message',
        'revision': t['revision'], 'request_id': uuid.uuid4().hex, 'text': 'Teach this.',
        'experiment_state': t['experiment']['state'], 'study_context': {'kind': 'guide', 'session_id': 'fake'}})
    assert result.status_code == 400
    assert client.get('/api/teacher/threads/' + t['id']).json()['messages'] == []


def test_chip_formats_numbers_and_option_labels():
    orbits = experiments.get('orbits')
    assert experiments.chip(orbits, {'type': 'set_params', 'values': {'m2': 2e12, 'launch': 'circular'}}) == 'm₂ → 2×10¹² kg · launch → Circular'
    projectile = experiments.get('projectile-air')
    assert experiments.chip(projectile, {'type': 'set_params', 'values': {'angle': 60, 'speed': 40.0}}) == 'angle → 60° · speed → 40 m/s'


def test_reply_instructions_limit_actions_and_length(monkeypatch):
    import threading
    from types import SimpleNamespace
    seen = {}

    def fake_run(choice, prompt, system='', **kwargs):
        seen['system'] = system
        return '{"reply": "A short answer.", "action": null}', {}
    monkeypatch.setattr(model_choices, 'run', fake_run)
    job = SimpleNamespace(on_event=None, cancel=threading.Event())
    manifest = experiments.get('coupled-oscillators')
    result, _ = experiments.run_reply({'model': 'claude:haiku'}, manifest, experiments.initial(manifest), [], job)
    assert result == {'reply': 'A short answer.', 'action': None}
    system = seen['system']
    for rule in ('about 80 words', 'a question gets an explanation with action=null', 'use the preset action',
                 'Never clamp or substitute a value silently', 'never mention JSON', 'what to look for'):
        assert rule.lower() in system.lower(), rule
