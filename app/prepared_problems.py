"""Authored local problem help. Reads never launch jobs, tutors or providers.

The private edition and exact item revision must both match. Authority metadata
stays private; the public payload contains only authored teaching, never OCR.
"""
from __future__ import annotations

import copy
import hashlib
import json
from functools import lru_cache
from pathlib import Path

CONTENT = Path(__file__).parent / 'content' / 'prepared_problems.json'


def unavailable():
    return {'available': False, 'revision': '', 'hints': [], 'steps': [], 'checked': False}


@lru_cache(maxsize=4)
def _read(path, size, modified):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def records():
    try:
        stat = CONTENT.stat()
        value = _read(str(CONTENT.resolve()), stat.st_size, stat.st_mtime_ns)
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError, TypeError):
        return {}


def get(row, source_sha256):
    """Return a fresh enhancement only for a checked, source-bound record.

    Callers supply the current private database's edition hash. A missing pack
    therefore supplies no row/hash and can never unlock this authored content.
    """
    empty = {'prepared_help': unavailable()}
    try:
        pack = records()
        record = pack.get('items', {}).get(row['id'])
        if not isinstance(record, dict):
            return empty
        if not source_sha256 or pack.get('source_sha256') != source_sha256:
            return empty
        if row['source_sha'] != source_sha256 or record.get('content_sha256') != row['content_sha']:
            return empty
        if record.get('kind') != row['kind'] or record.get('checked') is not True:
            return empty
        review = record.get('review', {})
        expected = 'printed_solution' if row['kind'] == 'problem' else 'independent_derivation'
        if review.get('authority') != expected or not review.get('question_pages') or not review.get('checks'):
            return empty
        if expected == 'printed_solution' and not review.get('solution_pages'):
            return empty
        hints, steps = record.get('hints'), record.get('steps')
        if not isinstance(hints, list) or not hints or not isinstance(steps, list) or not steps:
            return empty
        for rows, keys in ((hints, ('id', 'text_md')), (steps, ('id', 'title', 'body_md'))):
            if any(not isinstance(r, dict) or any(not isinstance(r.get(k), str) or not r[k].strip() for k in keys) for r in rows):
                return empty
            if len({r['id'] for r in rows}) != len(rows):
                return empty
        revision = hashlib.sha256(json.dumps(record, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:20]
        # Bind only after edition/item/review checks. Raw authored choices are not
        # public bindings: the current scene validates the state and supplies its revision.
        from . import daily_visuals
        public_steps = copy.deepcopy(steps)
        for step in public_steps:
            choice = step.pop('focus_state_id', None)
            step.pop('focus', None)
            try:
                binding = daily_visuals.bind_focus(row['id'], choice, f"prepared:{row['id']}:{step['id']}") if choice is not None else None
            except (OSError, ValueError, TypeError):
                binding = None  # Optional scene metadata cannot remove checked text help.
            if binding:
                step['focus'] = binding
        result = {'prepared_help': {'available': True, 'revision': revision,
                  'hints': copy.deepcopy(hints), 'steps': public_steps, 'checked': True}}
        interaction = record.get('interaction')
        if interaction is not None:
            think = record.get('think_first_md')
            if interaction != 'conceptual' or not isinstance(think, str) or not think.strip():
                return empty
            result['prepared_help'].update(interaction='conceptual', think_first_md=think)
        statement = record.get('display_statement_md')
        if isinstance(statement, str) and statement.strip():
            result['display_statement_md'] = statement
        return result
    except (KeyError, TypeError, AttributeError):
        return empty
