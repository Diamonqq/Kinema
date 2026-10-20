"""Question identities, scope, formatting, source separation and physical invariants."""
import math,re,unittest
from unittest import mock
from app import companion_questions as q,book_catalog

class CompanionQuestions(unittest.TestCase):
    def test_all_slots_are_distinct_and_have_valid_help(self):
        rows=q.items();self.assertEqual(len(rows),635)
        self.assertEqual(len({r['family'] for r in rows.values()}),112)
        self.assertEqual({r['chapter'] for r in rows.values()},set(range(1,15)))
        for row in rows.values():
            with self.subTest(id=row['id']):
                self.assertTrue(math.isfinite(row['answer']))
                self.assertFalse(re.search(r'[\x00-\x08\x0b-\x1f]',row['statement_md']))
                self.assertEqual(row['statement_md'].count('$')%2,0)
                item=q.public_item(row['id']);self.assertEqual(item['book_id'],'kinema')
                self.assertEqual(item['guidance']['source']['question_id'],row['id'])
                self.assertEqual(item['source_revision'],item['guidance']['source']['content_sha256'])
                self.assertEqual(len(item['prepared_help']['steps']),2)
                self.assertIsNone(item['visual']);self.assertEqual(item['images']['figure'],[])
    def test_never_fetches_same_numbered_textbook_question(self):
        with mock.patch.object(book_catalog,'_db',side_effect=AssertionError('Original practice must not access book DB')):
            for pid in ('k:1.1','k:8.30','k:14.24'):
                self.assertEqual(book_catalog.public_item(pid)['id'],pid)
                self.assertIn('original',book_catalog.private_context(pid)['solution_origin'])
                self.assertIsNone(book_catalog.notes_scope(pid))
                self.assertIsNone(book_catalog.visual_state(pid,{}))
                with self.assertRaises(ValueError):book_catalog.crop_file(pid,'question',0)
    def test_search_paging_and_book_selection(self):
        first=book_catalog.search(book='kinema',limit=100)
        self.assertEqual(first['total'],635);self.assertEqual(first['next_offset'],100)
        self.assertEqual(q.search(chapter=1)['total'],18)
        self.assertEqual(q.search(chapter=1,kind='exercise')['total'],11)
        self.assertEqual(q.search(visual=True)['total'],0)
        self.assertEqual(q.search(prepared=False)['total'],0)
        self.assertTrue(q.search(query='torque')['total']>0)
        for bad in ('other','../morin'):
            with self.assertRaises(ValueError):book_catalog.search(book=bad)
    def test_answers_obey_independent_conservation_checks(self):
        # Reconstruct conserved quantities rather than re-copying every answer formula.
        for r in q.items().values():
            f=r['facts'];y=r['answer'];ch,family=map(int,r['family'].split(':'))
            if (ch,family)==(5,0):self.assertAlmostEqual(.5*f['m']*y*y,.5*f['k']*f['x']**2)
            if (ch,family)==(5,5):self.assertAlmostEqual(f['m1']*f['u']+f['m2']*y,0)
            if (ch,family)==(8,4):self.assertAlmostEqual((f['I1']+f['I2'])*y,f['I1']*f['w'])
            if (ch,family)==(10,2):self.assertAlmostEqual(f['k']*(y-f['L']),f['m']*f['Omega']**2*y)
            if (ch,family)==(11,3):self.assertTrue(0<y<1)
            if (ch,family)==(11,4):self.assertAlmostEqual(y*y,f['ct']**2-f['x']**2)
            if (ch,family)==(12,3):self.assertAlmostEqual(y*y,(1+f['ratio'])**2-f['ratio']**2)
            if (ch,family)==(13,6):self.assertAlmostEqual(1/(1-y*y),math.cosh(f['eta'])**2)
            if (ch,family)==(14,1):self.assertAlmostEqual(y*y,1-f['compact'])

if __name__=='__main__':unittest.main()
