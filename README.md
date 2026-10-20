<p align="center"><img src="docs/images/kinema-banner.svg" alt="Kinema — Make physics click" width="100%"></p>

<p align="center">
  A quieter place to understand physics.<br>
  Interactive visuals, worked examples and a tutor beside your notes.
</p>

<p align="center">
  <a href="#get-started">Get started</a> ·
  <a href="docs/PUBLIC-SETUP.md">Setup guide</a> ·
  <a href="docs/AGENT-SETUP.md">Install on another computer</a> ·
  <a href="#what-this-preview-includes">Preview status</a> ·
  <a href="CONTRIBUTING.md">Contribute</a>
</p>

Kinema is a local study app for classical mechanics. Follow a worked example,
explore the motion, then ask about the step that doesn't make sense.
There are no streaks or points to keep up with.

## See the physics

Play a prepared simulation, move closer to the object, and reveal forces or
components when you need them. Keep the picture simple until it's time for more.

<img src="docs/images/visuals.png" alt="Kinema's incline simulation showing weight components, normal force, friction and the equation along the slope" width="100%">

## Keep the useful things beside you

A normal conversation on the left; a resizable Study pane on the right.
Browse notes, formulas and worked examples, or keep the current visual open
while you talk through it. Choose the model from the composer.

<img src="docs/images/study.png" alt="A new Kinema chat with chapter formulas open in the right-hand Study pane" width="100%">

- **Ask at your own pace.** Work through one idea or request a full explanation.
- **Bring your own problem.** Attach a question or homework image to a chat.
- **Explore before signing in.** Prepared references and reusable visuals work without AI.
- **Keep your work locally.** Each installation has its own chats, uploads and settings.

## Get started

**Early public preview · Python 3.11+ · Windows is the primary tested platform.**

Clone this repository, then create an environment:

```sh
git clone https://github.com/Diamonqq/Kinema.git
cd Kinema
python -m venv .venv
```

On **Windows**:

```powershell
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python start.py
```

On **macOS or Linux**:

```sh
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python start.py
```

Open **http://127.0.0.1:8790**. The welcome guide lets you connect an account
or choose **Explore without AI**. macOS and Linux installation paths are provided;
their complete device experience has not been verified.

### AI accounts

| Account | Official connection | Homework images |
| --- | --- | --- |
| ChatGPT | Codex | Supported |
| Claude | Claude Code | Supported |
| Kimi | Kimi Code | Text only |
| Google | Unavailable in this preview | — |

Sign in through the provider's own flow. Your account's permissions, plan and
usage limits apply. API keys are an optional advanced connection and can carry
separate charges. [Connection details →](docs/PROVIDERS.md)

### Your data

Chats, uploads and settings are saved on your computer. AI requests send the
relevant question and context to the account you select. Kinema does not provide
its own hosted AI service. Keep the server on localhost; this is a single-user app.
See [data locations and launch options](docs/PUBLIC-SETUP.md#your-data).

## What this preview includes

This is a starting point for a visual study app, with prepared mechanics
references, reusable simulations, normal chat and a guided account setup.

**Choose a book in Chapters or Library → Problems.** Kinema practice includes
635 original questions: 112 setups with parameter variants, hints and worked
answers across 14 chapters. Their familiar reference numbers help navigation;
they are different questions, rather than replacements for the corresponding
textbook problems, and do not reproduce their difficulty or full topic coverage.

For your exact Morin questions, use **Add textbook PDF**. The matching prepared
PDF restores all 635 checked questions and exercises with native math, source
figures, existing help and matched simulations. It reads and formats your PDF
locally, without another AI extraction. Other editions are rejected clearly.
[Book import details →](docs/BOOKS.md)

Textbook prose, page images, course assessments and personal study history are
not distributed in the repository. Your imported book stays in your local data.
Daily becomes available after the matching import; it still requires a prepared
simulation for the selected question. Not every question has a prepared solution
or simulation. AI help requires your own signed-in account.

Prepared simulations cover specific supported setups. Generated visuals and AI
explanations can need correction; arbitrary 3D assemblies do not all have physical
dynamics. The screenshots show the actual public app with prepared content and
no personal account or conversation data.

## Development

Python/FastAPI serves the app; the interface is browser JavaScript.
The app's data stays separate from the checkout. Start with the
[contributing guide](CONTRIBUTING.md) for layout, isolated checks and useful bug reports.

Prepared references, formulas and Library visuals work offline after installation.
The tutor and account setup need internet access. The browser runtime is bundled
with the release. [Laptop / setup-agent instructions →](docs/AGENT-SETUP.md)

Next priorities are easier installation, clearer teaching visuals and broader
checks on real devices and provider accounts. Feedback on an actual study flow
is especially useful.

## Credits and licensing

Built by [Conner](https://github.com/Diamonqq).
Provider marks retain their original licenses; see
[third-party notices](THIRD-PARTY-NOTICES.md).
No project-wide open-source license has been selected yet.
