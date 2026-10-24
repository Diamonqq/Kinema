"""App-side polish from the 1.50 tutor stress audit: class list, model names and the signed-in-only picker, Daily gating, tutor wording."""
import os
import tempfile
from pathlib import Path

os.environ['KINEMA_DATA'] = tempfile.mkdtemp()
os.environ.update(KINEMA_TASKS='off', KINEMA_REMINDER='off', KINEMA_DISTRIBUTION='public')
from fastapi.testclient import TestClient

from app import cli_connections, learner_profile, main, model_choices, teacher

ROOT = Path(__file__).resolve().parents[1]


def test_class_step_offers_the_real_classes_and_other():
    ids = [c['id'] for c in learner_profile.classes()['classes']]
    assert ids == ['2300', '2301', 'other']
    assert learner_profile.class_of('2300')['chapters'] == list(range(1, 8))
    assert learner_profile.class_of('2301')['chapters'] == list(range(8, 15))
    assert learner_profile.clean({'course': '2301', 'chapter': 9})['chapter'] == 9
    try:
        learner_profile.clean({'course': '2301', 'chapter': 3})
    except ValueError:
        pass
    else:
        raise AssertionError('chapter 3 is not part of 2301')


def test_cli_models_get_readable_names_not_raw_aliases():
    assert cli_connections.display_name('haiku', 'haiku') == 'Claude Haiku 5.5'
    assert cli_connections.display_name('opus') == 'Claude Opus 5.5'
    assert cli_connections.display_name('claude-sonnet-5-5') == 'Claude Sonnet 5.5'
    assert cli_connections.display_name('gpt-5.4-mini', 'gpt-5.4-mini') == 'GPT-5.4 Mini'
    assert cli_connections.display_name('gpt-5.5') == 'GPT-5.5'
    assert cli_connections.display_name('x-model', 'Chosen by the CLI') == 'Chosen by the CLI'
    rows = cli_connections._models('claude', {'model_rows': [{'id': 'haiku', 'label': 'haiku', 'efforts': ['medium']}], 'efforts': ['medium']})
    assert rows[0]['label'] == 'Claude Haiku 5.5'


def test_picker_lists_cli_models_only_for_signed_in_accounts(monkeypatch):
    rows = [{'id': 'claude:haiku', 'provider': 'claude', 'connection': 'cli'}, {'id': 'codex:gpt-5.5', 'provider': 'codex', 'connection': 'cli'},
            {'id': 'openrouter:x', 'provider': 'openrouter', 'connection': 'api'}]
    monkeypatch.setattr(model_choices, 'catalog', lambda: rows)
    manager = cli_connections.manager()
    monkeypatch.setattr(manager, 'states', {'claude': {'state': 'unchecked'}, 'codex': {'state': 'ready'}})
    assert [m['id'] for m in model_choices.signed_in_catalog()] == ['openrouter:x']
    monkeypatch.setattr(manager, 'states', {'claude': {'state': 'signed_in'}, 'codex': {'state': 'ready'}})
    assert [m['id'] for m in model_choices.signed_in_catalog()] == ['claude:haiku', 'openrouter:x']
    assert [m['id'] for m in TestClient(main.app).get('/api/models').json()['models']] == ['claude:haiku', 'openrouter:x']


def test_daily_has_no_nav_entry_until_a_book_exists():
    shell = (ROOT / 'static' / 'js' / 'teacher.js').read_text(encoding='utf-8')
    assert 'data-act="daily" hidden>' in shell and 'refreshDaily' in shell
    assert '.tv-row[hidden]{display:none}' in (ROOT / 'static' / 'teacher.css').read_text(encoding='utf-8')
    peek = TestClient(main.app).get('/api/daily/peek').json()
    assert 'id' not in peek          # fresh install, no matching book: the shell keeps the Daily row hidden


def test_teacher_does_not_announce_problem_switches():
    assert 'never announce it' in teacher.TEACHER_RULES and 'Switching to the X problem' in teacher.TEACHER_RULES
