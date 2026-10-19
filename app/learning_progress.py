"""Read-only progress presentation and explicitly reviewed assessment coverage.

Learner states remain the evidence authority. Authored lesson presence or a few
mapped skills never imply that the whole section has been assessed.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from . import curriculum

COVERAGE = Path(__file__).parent / 'content' / 'assessment_coverage.json'
CONFIDENT = {'confirmed', 'mastered'}


def scope_sha(section, skills, lesson):
    """Invalidate a coverage review when scope, checks or authored teaching change."""
    cur = curriculum.load()
    rows = {s: {'skill': cur['skills'][s],
                'questions': [cur['questions'][q] for q in cur['skills'][s]['questions']]}
            for s in skills if s in cur['skills']}
    value = {'section': section, 'skills': rows, 'lesson': lesson}
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def coverage_records():
    try:
        data = json.loads(COVERAGE.read_text(encoding='utf-8'))
        rows = data.get('sections', {}) if isinstance(data, dict) else {}
        return rows if isinstance(rows, dict) else {}
    except (OSError, ValueError, TypeError):
        return {}


def skill_fields(skill, state):
    questions = len(skill.get('questions', []))
    name = state.get('state', 'not_checked')
    reason = {
        'not_checked': 'No recorded checks yet.',
        'seen': 'Seen in teaching or revealed help; no graded answer yet.',
        'gap': 'The latest graded answer was incorrect or not known.',
        'learning': 'A correct answer is recorded; confirmation needs different checks on different days.',
        'confirmed': 'Unhinted correct checks are recorded on different days for different questions.',
        'mastered': 'Confirmed checks include a transfer success over at least 21 days.',
    }.get(name, 'No recorded checks yet.')
    if name == 'learning' and state.get('last_graded') == 'correct_hint':
        reason = 'The latest correct answer used help; unhinted checks are still needed.'
    if name == 'learning' and questions < 2:
        reason += ' Fewer than two diagnostic questions are prepared.'
    support = state.get('support', {})
    strength = 'Not yet measured'
    if support.get('checks'):
        strength = 'Needs a fresh check' if state.get('due') or name == 'gap' else 'Repeated checks' if name in CONFIDENT else 'Limited evidence'
    elif support.get('tutor_observations'):
        strength = 'Tutor impression only'
    return {'due': bool(state.get('due')), 'question_count': questions,
            'evidence_strength': strength, 'support': support,
            'reason': reason, 'last_ts': state.get('last_ts')}


def evidence_support(rows):
    """Presentation only: chat assessments never become independent checks here."""
    checked = [r for r in rows if r.get('source') != 'chat'
               and r.get('kind') in {'check', 'review', 'transfer'}
               and r.get('outcome') != 'revealed']
    clean = [r for r in checked if r.get('outcome') == 'correct']
    return {'checks': len(checked), 'unhinted_correct': len(clean),
            'helped': sum(r.get('outcome') == 'correct_hint' for r in checked),
            'last_check': checked[-1]['ts'] if checked else None,
            'tutor_observations': sum(r.get('source') == 'chat' for r in rows),
            'exposures': sum(r.get('kind') in {'taught', 'asked', 'self'} or r.get('outcome') == 'revealed' for r in rows)}


def section_progress(section, skills, lesson=None):
    """Coverage is an authored claim checked against the entire current scope."""
    cur = curriculum.load()
    ids = [s['id'] for s in skills]
    n = sum(s.get('state') in CONFIDENT for s in skills)
    count = sum(int(s.get('question_count', len(cur['skills'].get(s['id'], {}).get('questions', [])))) for s in skills)
    complete_coverage = False
    label = 'Some checks are prepared; full section coverage is not confirmed.' if skills else 'No skill checks are prepared for this section.'
    record = coverage_records().get(section['id'])
    if isinstance(record, dict):
        bound = record.get('scope_sha256') == scope_sha(section, ids, lesson)
        mapped = set(record.get('skills', [])) == set(ids)
        if not bound or not mapped:
            label = 'The assessment scope changed; coverage needs review.'
        else:
            label = str(record.get('label') or label)
            objectives = record.get('objectives', [])
            checked = bool(objectives) and all(
                isinstance(o, dict) and o.get('assessed') is True and o.get('questions')
                and all(q in cur['questions'] and cur['questions'][q]['skill'] in ids for q in o['questions'])
                for o in objectives)
            if checked:
                assessed_skills = {cur['questions'][q]['skill']
                                   for o in objectives for q in o['questions']}
                checked = assessed_skills == set(ids)
            # A diagnostic route must permit the learner's existing two-question rule.
            repeatable = bool(ids) and all(len(cur['skills'].get(s, {}).get('questions', [])) >= 2 for s in ids)
            complete_coverage = record.get('complete') is True and checked and repeatable
    return {'complete': complete_coverage and bool(skills) and n == len(skills),
            'coverage_complete': complete_coverage, 'coverage_label': label,
            'confident_skills': n, 'total_skills': len(skills), 'question_count': count,
            'due': any(s.get('due', False) for s in skills)}


def chapter_progress(sections):
    sections = [s for s in sections if s.get('kind') == 'concept']
    confirmed = sum(s.get('progress', {}).get('complete', False) for s in sections)
    return {'complete': bool(sections) and confirmed == len(sections),
            'confirmed_sections': confirmed, 'total_sections': len(sections),
            'due': any(s.get('progress', {}).get('due', False) for s in sections)}
