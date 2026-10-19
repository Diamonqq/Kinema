"""Versioned worked lessons; read-only content, never student progress."""
import copy,json
from functools import lru_cache
from pathlib import Path
from . import chapter_scope

FILE=Path(__file__).parent/'content/morin_lessons.json'
SOURCE_SHA='51fbce11159680fe2a529c1866e93f584278cf5d52b4cd6abcf9869c115ac991'

def scopes():
    return {row['id']:row for n in range(1,15)
            for section in chapter_scope.concept_sections(chapter_scope.chapter(n))
            for row in [section,*chapter_scope.subsections(section)]}

def validate(data,complete=False):
    expected=scopes();lessons=data.get('lessons',{})
    if not isinstance(lessons,dict) or not lessons or not set(lessons)<=set(expected):
        raise ValueError('Prepared lesson IDs do not match the book map.')
    if complete and set(lessons)!=set(expected):
        raise ValueError('Prepared lessons do not cover every concept and numbered subsection.')
    if data.get('source',{}).get('source_sha256')!=SOURCE_SHA:
        raise ValueError('Prepared lessons refer to a different edition.')
    for lid,lesson in lessons.items():
        src=lesson.get('source',{})
        if lesson.get('id')!=lid or src.get('section_id')!=lid or src.get('source_sha256')!=SOURCE_SHA:
            raise ValueError('Prepared lesson source identity differs: '+lid)
        if not lesson.get('title') or not lesson.get('summary') or not lesson.get('parts') or not lesson.get('prerequisites'):
            raise ValueError('Incomplete lesson orientation: '+lid)
        if any(not part.get('title') or not part.get('body_md') for part in lesson['parts']):
            raise ValueError('Empty lesson part: '+lid)
        examples=lesson.get('examples',[])
        if len(examples)<(2 if lid.count('.')==1 else 1):
            raise ValueError('Missing worked example progression: '+lid)
        if any(not e.get('setup_md') or not e.get('steps') or not e.get('answer_md') or not e.get('check_md')
               or any(not s.get('math') or not s.get('why') for s in e['steps']) for e in examples):
            raise ValueError('Incomplete worked example: '+lid)
        practice=lesson.get('practice',{})
        if not all(practice.get(k) for k in ('question_md','hints','answer_md')):
            raise ValueError('Missing independent practice: '+lid)
    return data

@lru_cache(maxsize=1)
def catalog():
    return validate(json.loads(FILE.read_text(encoding='utf-8')))

def get(lid):
    return copy.deepcopy(catalog()['lessons'].get(lid))
