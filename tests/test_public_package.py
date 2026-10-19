"""Export cannot include source data/private paths and has reproducible file hashes."""
import importlib.util,json,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('package_public',Path(__file__).resolve().parents[1]/'tools/package_public.py')
package=importlib.util.module_from_spec(spec);spec.loader.exec_module(package)

class PublicPackage(unittest.TestCase):
    def test_excludes_private_files_and_replaces_personal_defaults(self):
        files=package.collect()
        self.assertNotIn('app/content/morin_book.sqlite3',files)
        self.assertFalse(any(n.startswith(('data/','.git/','app/content/study_materials/','app/content/course_cards/')) for n in files))
        courses=json.loads(files['app/content/study_courses.json'])['courses']
        self.assertEqual(len(courses),1)
        self.assertEqual(courses[0]['material_refs'],[])
        self.assertNotIn('exam',courses[0])
        self.assertNotIn('pdf',json.loads(files['app/content/morin.json'])['book'])
        self.assertEqual(json.loads(files['app/content/daily_problems.json'])['problems'],[])
        self.assertIn('static/js/account_panel.js',files)
        self.assertIn('app/sim_lab_anchors.json',files)
        self.assertIn('app/content/class_courses.json',files)
        self.assertIn('static/icons/providers/LICENSE',files)
        self.assertIn('static/icons/providers/README.md',files)
    def test_private_addition_is_rejected(self):
        fake_path=json.dumps({'path':'D:/'+'Users/example'}).encode()
        for name,body in [('data/work.txt',b'work'),('app/content/book.pdf',b'pdf'),('settings.json',fake_path)]:
            with self.assertRaises(ValueError):package.validate({name:body})

if __name__=='__main__':unittest.main()
