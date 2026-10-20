"""Local import transaction contracts, using a synthetic source and recipe only."""
import gzip,hashlib,json,sqlite3,tempfile,unittest
from pathlib import Path
from unittest import mock
from fastapi.testclient import TestClient
from provider_fixture import Base,main
from app import book_library as lib,book_catalog,daily,daily_visuals

class BookImports(Base):
    def setUp(self):
        super().setUp()
        self.data=main.DATA
        self.patch=mock.patch.object(lib,'_data',self.data);self.patch.start();self.addCleanup(self.patch.stop)
        self.recipe=self.data/'recipe.gz'
        patch=mock.patch.object(lib,'RECIPE',self.recipe);patch.start();self.addCleanup(patch.stop)
        self.pdf=self.data/'source.pdf';self.pdf.write_bytes(b'%PDF-test synthetic bytes')
        self.pages=['A synthetic source.']
        self.payload={'catalog':{'metadata':[['source_sha256',json.dumps(hashlib.sha256(self.pdf.read_bytes()).hexdigest())]],
            'items':[[str(i),'checked'] for i in range(635)],'solutions':[]},
            'files':{'daily_problems.json':{'problems':[]},'daily_config.json':{'chapters':[1]},
                     'daily_visuals.json':{'version':2,'scenes':[]}}}
        self.write_recipe()
        patch=mock.patch.object(lib,'pdf_texts',return_value=self.pages);patch.start();self.addCleanup(patch.stop)
        self.sentinel=self.data/'learner-work.txt';self.sentinel.write_text('preserve work')
    def write_recipe(self,payload_sha=None):
        recipe={'source_sha256':hashlib.sha256(self.pdf.read_bytes()).hexdigest(),'pages':1,
            'text_sha256':lib._digest(self.pages),'payload_sha256':payload_sha or lib._digest(self.payload),
            'schema':'CREATE TABLE metadata(key TEXT,value TEXT); CREATE TABLE items(id TEXT,statement_status TEXT); CREATE TABLE solutions(item_id TEXT);',
            'columns':{'metadata':['key','value'],'items':['id','statement_status'],'solutions':['item_id']},'payload':self.payload}
        self.recipe.write_bytes(gzip.compress(json.dumps(recipe).encode()))
    def test_commits_complete_pack_and_reimport_preserves_generation_and_work(self):
        result=lib.import_pdf(self.pdf);self.assertEqual(result['questions'],635)
        folder=lib.active();self.assertIsNotNone(folder)
        with sqlite3.connect(folder/'morin_book.sqlite3') as db:self.assertEqual(db.execute('select count(*) from items').fetchone()[0],635)
        self.assertEqual(lib.source_pdf().read_bytes(),self.pdf.read_bytes())
        self.assertTrue(lib.import_pdf(self.pdf)['already_imported']);self.assertEqual(lib.active(),folder)
        self.assertEqual(self.sentinel.read_text(),'preserve work')
        self.assertEqual(list((self.data/'books/morin').glob('.import-*')),[])
    def test_wrong_pdf_rejected_before_reader_and_does_not_change_active(self):
        lib.import_pdf(self.pdf);old=lib.active()
        wrong=self.data/'other.pdf';wrong.write_bytes(b'%PDF-different')
        with mock.patch.object(lib,'pdf_texts',side_effect=AssertionError('Must hash before parsing')):
            with self.assertRaisesRegex(ValueError,'does not match'):lib.import_pdf(wrong)
        self.assertEqual(lib.active(),old)
    def test_failed_verification_keeps_previous_generation(self):
        lib.import_pdf(self.pdf);old=lib.active();self.write_recipe('0'*64)
        with self.assertRaisesRegex(ValueError,'did not verify'):lib.import_pdf(self.pdf)
        self.assertEqual(lib.active(),old)
    def test_missing_files_are_not_an_active_book(self):
        lib.import_pdf(self.pdf);(lib.active()/'source.pdf').unlink()
        self.assertIsNone(lib.active())
    def test_decoder_preserves_math_and_json_formatting(self):
        self.assertEqual(lib._decode({'$pdf':[[0,2,9],[' $x^2$']]},self.pages),'synthetic $x^2$')
        self.assertEqual(lib._decode({'$json':{'s':{'$pdf':[[0,0,1]]}},'compact':True},self.pages),'{"s":"A"}')
        with self.assertRaises(ValueError):lib._decode({'$pdf':[[0,0,999]]},self.pages)
    def test_upload_route_checks_type_and_cleans_temp(self):
        with TestClient(main.app) as client:
            self.assertEqual(client.post('/api/books/import',files={'file':('bad.txt',b'no','text/plain')}).status_code,400)
            r=client.post('/api/books/import',files={'file':('book.pdf',self.pdf.read_bytes(),'application/pdf')})
            self.assertEqual(r.status_code,200);self.assertEqual(r.json()['questions'],635)
        self.assertEqual(list((self.data/'book-imports').iterdir()),[])
    def test_decoder_rejects_escaping_file_before_switch(self):
        self.payload['files']['../outside.json']={};self.write_recipe()
        with self.assertRaisesRegex(ValueError,'Invalid prepared content'):lib.import_pdf(self.pdf)
        self.assertIsNone(lib.active());self.assertFalse((self.data/'outside.json').exists())

if __name__=='__main__':unittest.main()
