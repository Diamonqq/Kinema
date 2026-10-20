"""Exact-question experiments. Selection is a plan, never a readiness claim.

Packs contain authored teaching only. Canonical source statements and solutions
remain in the private catalog. No save, provider or Daily registration side effects.
"""
from __future__ import annotations
import copy
import hashlib
import json
from functools import lru_cache
from pathlib import Path

PACKS = Path(__file__).parent / 'content/chapter_experiments'


@lru_cache(maxsize=32)
def _read(path, stamp, size):
    return json.loads(Path(path).read_text(encoding='utf8'))


def _json(path):
    from .book_library import content_path
    path = content_path('chapter_experiments/' + path.name, path)
    stat = path.stat()
    return _read(str(path), stat.st_mtime_ns, stat.st_size)


def selection():
    return copy.deepcopy(_json(PACKS / 'selection.json'))


def identity(row, source_sha):
    keys = ('id', 'kind', 'chapter', 'number', 'title', 'section_id')
    result = {k: row[k] for k in keys}
    result.update(content_sha256=row['content_sha'], source_sha256=source_sha,
                  statement_sha256=hashlib.sha256((row['statement_md'] or '').encode()).hexdigest())
    return result


def valid_native_integration(value):
    """Authored chapter-only precision; never part of model scene schemas."""
    return (isinstance(value, dict) and set(value) == {'integration_hz', 'sample_hz'}
            and type(value['integration_hz']) is int and type(value['sample_hz']) is int
            and value['integration_hz'] in (1200, 2400, 4800, 9600)
            and value['sample_hz'] in (120, 240, 600, 1200)
            and value['integration_hz'] % value['sample_hz'] == 0)


def get(row, source_sha):
    """Return only an implemented, fully source-matched pack entry; fail closed."""
    try:
        chapter = row['chapter']
        if isinstance(chapter, bool) or chapter not in range(1, 15):
            return None
        canonical = identity(row, source_sha)
        chosen = [e for e in _json(PACKS / 'selection.json')['entries'] if e['id'] == row['id']]
        if len(chosen) != 1 or chosen[0]['source'] != canonical:
            return None
        pack = _json(PACKS / f'ch{chapter:02}.json')
        if pack.get('schema') != 1 or pack.get('chapter') != chapter:
            return None
        matches = [e for e in pack['experiments'] if e.get('id') == row['id']]
        if len(matches) != 1:
            return None
        entry = matches[0]
        if entry.get('status') != 'implemented' or entry.get('source') != canonical:
            return None
        if entry.get('title') != row['title'] or entry.get('renderer') != f'ch{chapter:02}':
            return None
        result = copy.deepcopy(entry)
        result.update(kind='chapter_experiment', problem=row['id'], schema=1)
        # A nearby generic recipe is not an exact-problem implementation.
        # Mechanical authors bind reviewed constraints and numerical evidence to
        # the actual validated lesson bytes, as well as the question identity.
        if result.get('native_recipe') or result.get('native_lesson'):
            if recipe := result.get('native_recipe'):
                from . import visual_library
                lesson, warnings = visual_library.build_checked(recipe)
            else:
                from . import tutor
                raw_scene = result['native_lesson'].get('visualization', {}).get('scene')
                if isinstance(raw_scene, dict) and {'dt', 'sample_hz'} & raw_scene.keys():
                    return None  # runtime hints belong only to checked chapter metadata
                lesson, warnings = tutor.validate(copy.deepcopy(result['native_lesson']))
            if warnings[1:]:
                return None
            contract = result.get('native_verification') or {}
            fingerprint = hashlib.sha256(json.dumps(lesson, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
            if (contract.get('lesson_sha256') != fingerprint or
                    contract.get('statement_sha256') != canonical['statement_sha256'] or
                    not contract.get('constraint_checks') or not contract.get('numeric_checks')):
                return None
            # Validate precision only after the original lesson/source fingerprint.
            # The lesson remains byte-identical; runtime fields are added only at mount.
            if 'native_integration' in result and (lesson['visualization']['kind'] != 'mechanics'
                    or not valid_native_integration(result['native_integration'])):
                return None
            result['native_lesson'] = lesson
        elif 'native_integration' in result:
            return None
        elif not (PACKS.parents[2] / 'static/js/chapter_experiments' / f'ch{chapter:02}.js').is_file():
            return None
        return result
    except (OSError, ValueError, KeyError, TypeError):
        return None


def coverage(rows, source_sha):
    by_id = {r['id']: r for r in rows}
    entries = []
    for target in selection()['entries']:
        row = by_id.get(target['id'])
        entries.append({**target, 'status': 'implemented' if row and get(row, source_sha) else 'selected'})
    return {'selected': len(entries), 'implemented': sum(e['status'] == 'implemented' for e in entries), 'entries': entries}
