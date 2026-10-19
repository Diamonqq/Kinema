"""Local interface/tutor preference; never rewrites prior student work."""
import json
from pathlib import Path

CATALOG = Path(__file__).resolve().parents[1] / 'static/locales/catalog.json'

def languages():
    if not CATALOG.is_file():
        return [{'id':'en','name':'English','native':'English','direction':'ltr'}]
    raw=json.loads(CATALOG.read_text(encoding='utf8'))
    return raw if isinstance(raw,list) else raw['languages']

def validate_patch(patch):
    allowed={x['id'] for x in languages()}
    for key in ('ui_language','tutor_language'):
        if key in patch and (not isinstance(patch[key],str) or patch[key] not in allowed | ({'auto'} if key=='tutor_language' else set())):
            raise ValueError('Choose one of the available languages.')

def instruction(settings):
    language=settings.get('tutor_language','auto')
    if language=='auto':
        language=settings.get('ui_language','en')
    row=next((r for r in languages() if r['id']==language),None)
    if not row:return ''
    return ('\n\nLANGUAGE PREFERENCE: Explain and ask questions in '+row['name']+
            '. If the student explicitly asks for a different language, follow that request. '+
            'Keep JSON field names and enum values exactly as required by the schema. '+
            'Keep mathematical notation, units, problem identities and the original meaning unchanged. '+
            'Translate only student-facing prose and visual labels; never translate code or internal IDs.')
