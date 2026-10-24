"""Compact tutor context and the appliesWhen contract. Fixture manifests; no accounts, no provider."""
import json
import os
import tempfile
import threading
from pathlib import Path
from types import SimpleNamespace

import pytest

os.environ.setdefault('KINEMA_DATA', tempfile.mkdtemp())
os.environ.update(KINEMA_TASKS='off', KINEMA_REMINDER='off')
from app import experiments, model_choices

MANIFEST = {
    'id': 'demo', 'title': 'Demo', 'group': 'Mechanics', 'description': 'A demo.',
    'params': [
        {'key': 'reaction', 'label': 'Reaction', 'unit': '', 'value': 'decay', 'group': 'Setup',
         'options': [{'value': 'decay', 'label': 'Decay'}, {'value': 'collision', 'label': 'Collision'}, {'value': 'plain', 'label': 'plain'}]},
        {'key': 'mode', 'label': 'Input', 'unit': '', 'value': 'kinetic', 'options': [{'value': 'kinetic', 'label': 'kinetic'}, {'value': 'momentum', 'label': 'Momentum'}]},
        {'key': 'parentMass', 'label': 'Parent mass', 'symbol': 'M', 'unit': 'MeV', 'min': 1, 'max': 1000, 'step': 1, 'value': 135, 'appliesWhen': {'reaction': ['decay']}},
        {'key': 'beta', 'label': 'Speed', 'symbol': 'v/c', 'unit': '', 'min': 0, 'max': 0.9, 'step': 0.1, 'value': 0.5,
         'appliesWhen': {'reaction': ['decay', 'collision'], 'mode': ['kinetic']}},
        {'key': 'free', 'label': 'Free', 'unit': 'm', 'min': 0, 'max': 10, 'step': 1, 'value': 2},
    ],
    'presets': [{'id': 'p1', 'label': 'Preset one', 'note': 'Why it matters.', 'values': {'reaction': 'collision', 'free': 3}}],
    'closeups': [{'id': 'c1', 'label': 'Zoom'}], 'graphs': [{'id': 'g1', 'label': 'Graph', 'series': [{'key': 'x'}], 'window': 10}],
    'observables': [{'key': 'x', 'label': 'Position', 'symbol': 'x', 'unit': 'm', 'extra': 1}],
}


def params(**over):
    return {**{p['key']: p['value'] for p in MANIFEST['params']}, **over}


def test_is_inert_ands_across_keys_and_ors_within_a_list():
    beta = next(p for p in MANIFEST['params'] if p['key'] == 'beta')
    assert not experiments.is_inert(beta, params())
    assert not experiments.is_inert(beta, params(reaction='collision'))
    assert experiments.is_inert(beta, params(reaction='plain'))
    assert experiments.is_inert(beta, params(mode='momentum'))
    assert not experiments.is_inert(next(p for p in MANIFEST['params'] if p['key'] == 'free'), params(reaction='plain'))


def test_check_applies_rejects_unknown_self_and_empty_rules():
    experiments.check_applies(MANIFEST)
    for rule in ({'nope': ['a']}, {'parentMass': [1]}, {'reaction': []}, {}, ['reaction']):
        bad = json.loads(json.dumps(MANIFEST))
        bad['params'][2]['appliesWhen'] = rule
        with pytest.raises(ValueError):
            experiments.check_applies(bad)


def test_compact_context_is_small_and_marks_inert_params():
    state = experiments.initial(MANIFEST)
    assert 'inert' not in json.dumps(experiments.compact(MANIFEST, state['params']))
    c = experiments.compact(MANIFEST, params(reaction='collision'))
    by = {p['key']: p for p in c['params']}
    assert by['parentMass']['inert'] is True and by['parentMass']['appliesWhen'] == {'reaction': ['decay']}
    assert 'inert' not in by['beta'] and 'inert' not in by['free']
    assert by['reaction']['options'] == [{'value': 'decay', 'label': 'Decay'}, {'value': 'collision', 'label': 'Collision'}, 'plain']
    assert by['parentMass'] == {'key': 'parentMass', 'label': 'Parent mass', 'symbol': 'M', 'unit': 'MeV', 'min': 1, 'max': 1000, 'step': 1,
                                'appliesWhen': {'reaction': ['decay']}, 'inert': True}
    assert c['presets'] == [{'id': 'p1', 'label': 'Preset one', 'note': 'Why it matters.', 'sets': {'Reaction': 'Collision', 'Free': '3 m'}}]
    assert c['graphs'] == [{'id': 'g1', 'label': 'Graph'}] and c['closeups'] == [{'id': 'c1', 'label': 'Zoom'}]
    assert c['observables'] == [{'key': 'x', 'label': 'Position', 'symbol': 'x', 'unit': 'm'}]


@pytest.mark.parametrize('eid,ratio', [('minkowski', .4), ('orbits', .5), ('rel-kinematics', .7), ('pendulum', .7)])
def test_real_manifests_compact_well_below_their_size(eid, ratio):
    manifest = experiments.get(eid)
    compact = experiments.compact(manifest, experiments.initial(manifest)['params'])
    assert len(json.dumps(compact)) < len(json.dumps(manifest)) * ratio
    assert {p['key'] for p in manifest['params']} == {q['key'] for q in compact['params']}


def test_set_params_on_an_inert_param_alone_drops_but_with_its_controller_passes():
    state = experiments.initial(MANIFEST)
    state['params'] = params(reaction='collision')
    alone = {'type': 'set_params', 'values': {'parentMass': 500}}
    assert experiments.validate_action(MANIFEST, alone, state) is None
    together = {'type': 'set_params', 'values': {'reaction': 'decay', 'parentMass': 500}}
    assert experiments.validate_action(MANIFEST, together, state) == together
    assert experiments.validate_action(MANIFEST, {'type': 'set_params', 'values': {'free': 4}}, state)
    assert experiments.validate_action(MANIFEST, alone) == alone      # no state: the old contract


def test_plain_symbols_and_chips_never_show_raw_keys():
    assert experiments.plain_symbol('m_2') == 'm₂' and experiments.plain_symbol('v_{3x}') == 'v₃ₓ' and experiments.plain_symbol('\\theta') == 'θ'
    assert experiments.plain_symbol('F_d') == 'F_d' and experiments.plain_symbol('') == ''
    chip = experiments.chip(MANIFEST, {'type': 'set_params', 'values': {'parentMass': 200, 'reaction': 'decay'}})
    assert chip == 'M → 200 MeV · Reaction → Decay'      # symbol wins, else the label
    assert 'parentMass' not in chip and 'reaction' not in chip
    rel = experiments.get('rel-kinematics')
    text = experiments.chip(rel, {'type': 'set_params', 'values': {'reaction': 'decay', 'parentMass': 200}})
    assert 'parentMass' not in text and text.startswith('Reaction → ') and 'M → 200 MeV/c²' in text
    for eid in [m['id'] for m in experiments.catalog()]:
        manifest = experiments.get(eid)
        for p in manifest['params']:
            value = p['options'][0]['value'] if p.get('options') else p['min']
            assert p['key'] not in experiments.chip(manifest, {'type': 'set_params', 'values': {p['key']: value}}) or p['key'] in (p.get('symbol') or '') + (p.get('label') or '')


def test_preset_values_are_listed_only_where_they_differ_from_defaults():
    manifest = {**MANIFEST, 'presets': [{'id': 'p2', 'label': 'Heavy', 'note': 'n', 'values': {'reaction': 'decay', 'mode': 'kinetic', 'parentMass': 500, 'free': 2}}]}
    assert experiments.compact(manifest, params())['presets'][0]['sets'] == {'M': '500 MeV'}
    pendulum = experiments.get('pendulum')
    sets = {p['id']: p['sets'] for p in experiments.compact(pendulum, experiments.initial(pendulum)['params'])['presets']}
    assert sets['rotation'] == {'ω₀': '7 rad/s', 'θ₀': '0 rad'}


def test_experiment_observables_all_carry_labels():
    for eid in [m['id'] for m in experiments.catalog()]:
        compact = experiments.compact(experiments.get(eid), experiments.initial(experiments.get(eid))['params'])
        assert all(o.get('label') for o in compact.get('observables', [])), eid


def test_applied_actions_are_recorded_in_the_conversation_and_never_corrected(monkeypatch):
    seen = {}
    monkeypatch.setattr(model_choices, 'run', lambda choice, prompt, system='', **k: (seen.update(prompt=prompt) or '{"reply": "Ok.", "action": null}', {}))
    job = SimpleNamespace(on_event=None, cancel=threading.Event())
    manifest = MANIFEST
    preset = {'type': 'preset', 'id': 'p1'}
    note = experiments.applied_text(manifest, preset)
    assert note == 'loaded preset "Preset one"'
    messages = [{'role': 'user', 'text': 'Show me preset one'}, {'role': 'assistant', 'text': 'Loaded.', 'applied': note}]
    experiments.run_reply({'model': 'claude:haiku'}, manifest, experiments.initial(manifest), messages, job)
    assert json.loads(seen['prompt'])['conversation'][1]['applied'] == 'loaded preset "Preset one"'


def test_experiment_reply_adds_applied_to_the_conversation_from_stored_actions():
    from app import teacher
    source = (Path(teacher.__file__)).read_text(encoding='utf-8')
    assert "experiments.applied_text(manifest, m['experiment_action'])" in source


def test_run_reply_sends_the_compact_manifest_and_the_inert_rule(monkeypatch):
    seen = {}

    def fake_run(choice, prompt, system='', **kwargs):
        seen.update(prompt=prompt, system=system)
        return '{"reply": "Ok.", "action": {"type": "set_params", "values": {"parentMass": 300}}}', {}
    monkeypatch.setattr(model_choices, 'run', fake_run)
    job = SimpleNamespace(on_event=None, cancel=threading.Event())
    state = experiments.initial(MANIFEST)
    state['params'] = params(reaction='collision')
    result, _ = experiments.run_reply({'model': 'claude:haiku'}, MANIFEST, state, [], job)
    assert result['action'] is None                               # inert on its own: dropped, explanation kept
    context = json.loads(seen['prompt'])
    assert 'values' not in json.dumps(context['experiment']['presets'])
    assert 'never quote an internal key or id' in seen['system'] and 'current_state is authoritative' in seen['system']
    assert 'never suggest or change it' in seen['system']
