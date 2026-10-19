"""Source-bound starting ideas; never inherit section-level physics.
Unreviewed questions offer a source-bound tutor request, never inherited formulas.
Stale or malformed bindings fail closed without losing the question or help.
"""
from functools import lru_cache
from pathlib import Path
import hashlib
import json

CONTENT = Path(__file__).parent / 'content'

def statement_sha(row):
    return hashlib.sha256(row['statement_md'].encode('utf8')).hexdigest()

@lru_cache(maxsize=1)
def _pack():
    try:
        data=json.loads((CONTENT/'problem_guidance_exact.json').read_text(encoding='utf8'))
        return data if data.get('schema')==1 and isinstance(data.get('items'),dict) else {}
    except (OSError,ValueError,TypeError):
        return {}

def for_question(row, source_sha=None):
    try:
        pack=_pack()
        source=source_sha if source_sha is not None else row.get('source_sha')
        if not source or source!=pack.get('source_sha256') or row.get('source_sha')!=source:return None
        entry=pack['items'].get(row['id'])
        if not isinstance(entry,dict):return None
        if any(entry.get(k)!=row.get(field) for k,field in (
                ('content_sha256','content_sha'),('kind','kind'),('chapter','chapter'),
                ('section_id','section_id'),('topic','title'))):return None
        if entry.get('statement_sha256')!=statement_sha(row):return None
        method,relations=entry.get('method_md'),entry.get('relations_md')
        if not isinstance(method,str) or not isinstance(relations,str):return None
        policy=entry.get('classification')
        if policy=='authored_exact':
            if not method.strip() or not entry.get('review',{}).get('rationale'):return None
        elif policy=='statement_only':
            if method or relations:return None
        else:return None
        return {'topic':entry['topic'],'section_id':entry['section_id'],
                'method_md':method,'relations_md':relations,
                'prompt':'Help me choose one first step for this exact question without revealing the solution.',
                'source':{'question_id':row['id'],'content_sha256':row['content_sha'],
                          'source_sha256':source,'statement_sha256':entry['statement_sha256'],
                          'policy_revision':pack['revision'],'classification':policy}}
    except (KeyError,TypeError,ValueError,AttributeError):
        return None
