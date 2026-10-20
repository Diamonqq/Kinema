"""Public-install contracts: no private files, native programs or AI services."""
import hashlib,json,re,unittest
from pathlib import Path
from unittest import mock
from fastapi.testclient import TestClient
from provider_fixture import Base,main
from app import daily,self_update,teacher_content,visual_library

ROOT=Path(__file__).resolve().parents[1]

class PublicReadiness(Base):
    def test_empty_daily_is_a_normal_empty_state(self):
        with mock.patch.object(daily,'pick',side_effect=daily.NoPreparedProblem('No prepared puzzle.')):
            with TestClient(main.app) as client:
                for path in ('/api/daily/today','/api/daily/peek'):
                    r=client.get(path)
                    self.assertEqual(r.status_code,200)
                    self.assertEqual(r.json()['state'],'unavailable')

    def test_daily_source_failure_stays_an_error(self):
        with mock.patch.object(daily,'view',side_effect=teacher_content.SourceError('Temporary load failure.')):
            with TestClient(main.app) as client:
                self.assertEqual(client.get('/api/daily/today').status_code,503)

    def test_available_daily_response_is_preserved(self):
        value={'day':'2030-01-01','problem':{'id':'local-test'},'think':{'started':False}}
        with mock.patch.object(daily,'view',return_value=value):
            self.assertEqual(daily.api_today(),value)

    def test_every_listed_visual_builds_without_private_files(self):
        for rid in visual_library.recipe_ids():
            with self.subTest(recipe=rid):
                result=visual_library.build(rid)
                self.assertTrue(result.get('title'))
                self.assertTrue(result.get('visualization'))

    def test_no_update_network_when_unconfigured(self):
        with mock.patch.object(self_update,'repo',return_value=''),mock.patch.object(self_update,'_http_json',side_effect=AssertionError('No update network')):
            self.assertEqual(self_update.check()['state'],'off')
            self_update.check_if_due()

class BundledBrowserRuntime(unittest.TestCase):
    def test_runtime_hashes_licenses_fonts_and_module_dependencies(self):
        vendor=ROOT/'static/vendor'
        manifest=json.loads((vendor/'MANIFEST.json').read_text())
        self.assertEqual({p['name'] for p in manifest['packages']},{'three','planck','katex'})
        for name,digest in manifest['files'].items():
            path=vendor/name
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),digest,name)
            if path.suffix=='.js' and name.startswith('three/'):
                for dep in re.findall(r'(?:from\s*|import\s*\()\s*[\'\"]([^\'\"]+)[\'\"]',path.read_text(encoding='utf8')):
                    if dep.startswith('.'):self.assertTrue((path.parent/dep).is_file(),name+': '+dep)
        for name in ('three/LICENSE','planck/LICENSE.txt','katex/LICENSE'):
            self.assertTrue((vendor/name).is_file(),name)
        css=(vendor/'katex/dist/katex.min.css').read_text()
        for target in re.findall(r'url\(([^)]+)\)',css):
            self.assertTrue((vendor/'katex/dist'/target.strip('\'\"')).is_file(),target)

    def test_html_uses_only_local_browser_runtime(self):
        html=(ROOT/'static/app.html').read_text(encoding='utf8')
        self.assertNotRegex(html,r'(?:src|href)=[\'\"]https?://')
        mapping=json.loads(re.search(r'<script type="importmap">(.*?)</script>',html,re.S)[1])
        for target in mapping['imports'].values():self.assertTrue((ROOT/'static'/target.lstrip('/')).exists(),target)

if __name__=='__main__':unittest.main()
