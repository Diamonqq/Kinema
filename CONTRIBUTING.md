# Contributing

Thanks for helping make physics easier to understand. A useful report names the
problem you were studying, what you expected and the exact step that went wrong.
Include the app version and browser. Remove account details and personal material
from screenshots. Do not post a whole textbook or private homework pack.

## Project layout

- `app/`: FastAPI routes, provider adapters, content and physics preparation.
- `static/js/`: chat, Study pane, Library and visual rendering.
- `app/content/`: public prepared references and visual recipes.
- `tests/`: isolated provider, account, localization and export checks.
- `tools/package_public.py`: creates a source export with private data excluded.

## Run focused checks

Install `requirements-dev.txt` in your environment. Run checks with disposable
app data and background tasks disabled. For example, in PowerShell:

```powershell
$env:KINEMA_DATA = "$env:TEMP/kinema-test-data"
$env:KINEMA_TASKS = "off"
$env:KINEMA_REMINDER = "off"
.venv\Scripts\python -m unittest discover -s tests -q
node tests/test_account_welcome.mjs
```

Tests use fake accounts and local fixtures. Never sign into a real provider or
use your study data as part of a test. For UI changes, check the ordinary entry
and return path at desktop and narrow sizes, including a failure state.

Keep changes focused and explain how you checked them. Label untested account
or device behavior honestly. Physics changes should include the assumptions,
units and a numerical or analytical check.

A project-wide license is still pending. Please discuss substantial contributions
before sending them so expectations about reuse are clear.
