# Set up Kinema

Kinema runs on your own computer. Each person uses their own data folder and AI
account. It is an early public preview; Windows is the primary tested platform.

## Install and launch

Install Python 3.11 or newer and Git, then follow the commands in the
[README](../README.md#get-started). `python start.py` starts a local server and
opens the browser. Keep that terminal running while you study; Ctrl+C stops it.

The app opens at **http://127.0.0.1:8790**. If it does not open automatically,
visit that address yourself. A browser with WebGL is needed for the 3D visuals.

## Welcome and accounts

Choose **Explore without AI** to browse prepared references and simulations.
Tutoring and new generated visuals require an account.

Settings → Account offers ChatGPT through Codex, Claude through Claude Code,
and Kimi through Kimi Code. Install the official CLI from the setup screen if
needed, then follow its own browser or device-code sign-in. Kinema does not ask
for your account password. The account's models appear in the composer.

Google sign-in is unavailable in this preview. No Antigravity replacement is
installed. Kimi currently accepts text only; choose ChatGPT or Claude for images.
Provider account access and usage limits still apply. Real provider availability
is separate from isolated protocol tests.

API keys are optional under **Advanced**. API access may be billed separately
from a chat subscription. Keys are stored server-side, using supported OS secure
storage or an explicitly selected session-only connection.

## Your data

The default data folder is:

| System | Folder |
| --- | --- |
| Windows | `%LOCALAPPDATA%/Kinema` |
| macOS | `~/Library/Application Support/Kinema` |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/kinema` |

Preserve this folder when updating. It holds your chats, uploads, saved work and
settings. Do not commit it or attach it to a public issue. AI requests send the
relevant question, attached material and context to your chosen provider.

## Launch options

Use the Python executable inside `.venv` for these commands:

```sh
python start.py --port 8791
python start.py --data /path/to/a/separate/data-folder
python start.py --no-browser
```

A different port avoids another local copy. A separate data directory keeps two
installations independent. The server binds to localhost. It has no multi-user
account isolation and should not be exposed as a public website.

## Included content

The source includes authored references, reusable physics visuals and Kinema
practice: 635 original questions built from 112 setups with parameter variants,
hints and worked answers. These are different questions from Morin.

Choose **Morin · your textbook** in Chapters or Library → Problems, then
**Add textbook PDF**. The exact prepared PDF restores the 635 checked textbook
questions and exercises, figures and existing simulation/help bindings locally.
There is no AI extraction or sign-in requirement. Other editions are rejected
without changing the library. [Supported PDF and details](BOOKS.md).

The public source excludes textbook prose/pages, course assessments, credentials
and personal study records. Daily requires the matching local book import.
Prepared references, original practice and Library visuals work before importing.

## Troubleshooting

- **Port in use:** use `--port 8791` and open that address.
- **AI is unavailable:** connect an account in Settings and verify it there.
  A provider may refuse a model because of permissions, quota or billing.
- **Blank 3D view:** enable hardware acceleration/WebGL in a current browser.
- **No textbook questions or Daily puzzle:** add the matching PDF through the book
  chooser. A different edition cannot use this prepared import. Kinema practice
  and prepared Library visuals remain available.

Prepared references, formulas and Library visuals work offline after installation;
the browser libraries and math fonts are bundled. AI, provider sign-in and
installing dependencies require internet access.

For a version-pinned installation on another computer, use the
[setup-agent guide](AGENT-SETUP.md). Windows with Python 3.12.5 was checked in a
fresh environment. This release provides a browser app, not a standalone installer.
