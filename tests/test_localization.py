"""Language validation and queued-choice behavior; no provider calls."""
import json
import unittest
from pathlib import Path
from app import localization

class LanguagePreferences(unittest.TestCase):
    def test_catalog_and_translations_have_equal_keys(self):
        rows=localization.languages()
        self.assertGreaterEqual(len(rows),13)
        self.assertEqual(len({r['id'] for r in rows}),len(rows))
        root=localization.CATALOG.parent
        en=json.loads((root/'en.json').read_text(encoding='utf8'))
        for r in rows:
            data=json.loads((root/(r['id']+'.json')).read_text(encoding='utf8'))
            self.assertEqual(set(data),set(en),r['id'])
            self.assertTrue(all(isinstance(v,str) and v.strip() for v in data.values()),r['id'])
            self.assertIn(r['direction'],('ltr','rtl'))
    def test_invalid_language_is_refused(self):
        for patch in ({'ui_language':'../en'},{'ui_language':'auto'},{'tutor_language':None}):
            with self.assertRaises(ValueError):localization.validate_patch(patch)
        localization.validate_patch({'ui_language':'en','tutor_language':'auto'})
    def test_instruction_keeps_equations_and_schema_stable(self):
        text=localization.instruction({'ui_language':'es','tutor_language':'auto'})
        self.assertIn('Spanish',text)
        self.assertIn('JSON field names',text)
        self.assertIn('mathematical notation',text)
        self.assertIn('English',localization.instruction({'ui_language':'es','tutor_language':'en'}))

if __name__=='__main__':unittest.main()
