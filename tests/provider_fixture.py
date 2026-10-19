"""Standalone disposable API-provider fixture; no book, owner data, auth or live network."""
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import httpx

_IMPORT_DATA = tempfile.TemporaryDirectory(prefix='kinema-provider-import-', ignore_cleanup_errors=True)
os.environ['KINEMA_DATA'] = _IMPORT_DATA.name
os.environ['KINEMA_TASKS'] = 'off'
os.environ['KINEMA_REMINDER'] = 'off'

from app import cli_connections, cloud_providers, learn_api, main, providers


def _no_network(request):
    raise AssertionError('Provider tests must explicitly mock every HTTP request.')


class Base(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix='kinema-provider-test-', ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        data = Path(directory.name)
        patches = [mock.patch.object(main, 'DATA', data), mock.patch.object(main, 'DB_PATH', data / 'kinema.db'),
                   mock.patch.object(main, 'SETTINGS_PATH', data / 'settings.json'),
                   mock.patch.object(providers, 'SANDBOX', data / 'sandbox'),
                   mock.patch.object(providers, 'run_codex', side_effect=AssertionError('No CLI auth or model runs in provider tests')),
                   mock.patch.object(providers, 'run_claude', side_effect=AssertionError('No CLI auth or model runs in provider tests')),
                   mock.patch.object(cloud_providers, '_TRANSPORT', httpx.MockTransport(_no_network)),
                   mock.patch.object(cli_connections, '_MANAGERS', {}),
                   mock.patch.object(cli_connections, '_runtime', return_value=(None, {'supported':False, 'models':[]})),
                   mock.patch.dict(os.environ, {'KINEMA_DISTRIBUTION':'', 'OPENAI_API_KEY':'', 'ANTHROPIC_API_KEY':'',
                                                'GEMINI_API_KEY':'', 'MOONSHOT_API_KEY':'', 'OPENROUTER_API_KEY':''})]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)
        learn_api.setup(main.db, data, lambda lesson: main._lesson_digest(lesson))
