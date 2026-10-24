"""A package without the authored refresher cards (the public source zip) offers none instead of failing."""
import tempfile, unittest
from pathlib import Path
from unittest import mock
from app import refreshers


class MissingRefresherContent(unittest.TestCase):
    def test_no_cards_and_no_error(self):
        missing = Path(tempfile.gettempdir()) / 'kinema-no-refreshers' / 'refreshers.json'
        refreshers.load.cache_clear(); refreshers.load_context.cache_clear()
        try:
            with mock.patch.object(refreshers, 'CONTENT', missing):
                self.assertEqual(refreshers.load(), [])
                self.assertEqual(refreshers.load_context(), [])
                self.assertIsNone(refreshers.choose({}, 'sin cos hypotenuse'))
                self.assertIsNone(refreshers.find('trig-right-triangle'))
                self.assertEqual(refreshers.validate(), [])
        finally:
            refreshers.load.cache_clear(); refreshers.load_context.cache_clear()


if __name__ == '__main__':
    unittest.main()
