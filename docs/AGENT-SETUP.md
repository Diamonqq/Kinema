# Install Kinema on another computer

Give your setup agent this instruction:

> Install the latest stable release of https://github.com/Diamonqq/Kinema on
> this computer. Follow docs/PUBLIC-SETUP.md. Preserve any existing Kinema data;
> do not modify the app. Create its Python environment, launch it on localhost,
> and verify Welcome, Chapters and a Library visual. Let me complete my own AI
> sign-in. Tell me how to reopen it and where my data is saved.

## For the setup agent

The release audited for this guide is **v1.49.0**. Use its tag or source ZIP;
do not assume an unreleased `main` commit is a tested release.
Windows with Python **3.12.5** was checked in a fresh environment. Python 3.11+
is supported by the source, but other Python/platform combinations were not
checked on real devices.

1. Check for an existing installation and data first. Keep its data folder.
   Choose an ordinary user-owned install directory, not a system directory.
2. Install Python and Git if needed using their official distributions. Clone
   with `git clone --branch v1.49.0 https://github.com/Diamonqq/Kinema.git`, or
   extract the release's public ZIP. This creates a version-pinned checkout.
3. Follow the environment and launch commands in [Setup](PUBLIC-SETUP.md).
   Do not enable PowerShell scripts; call `.venv\Scripts\python.exe` directly.
4. Use a free localhost port. If 8790 is busy, use `--port 8791`; do not stop
   an unrelated service. Keep the launched terminal running while studying.
5. Verify the welcome loads, **Explore without AI** opens Chapters, a prepared
   formula renders, and a Library visual plays and resets. These features need
   no AI sign-in and work without a CDN connection once Python is installed.
6. Install only the AI helper the person chooses in Settings. Codex and Kimi's
   npm installation needs Node.js; Claude's Windows installation uses winget.
   Kimi also needs Git for Windows. Let the person complete the provider's own
   sign-in. Google account sign-in is unavailable in this release.
7. Reopen with `.venv\Scripts\python.exe start.py` from this directory. The
   browser opens at the selected port. `--no-browser` supports quiet checks.
   Confirm the release version through `/api/health` on that exact server.

Default Windows data is `%LOCALAPPDATA%\Kinema`. It is separate from the source
checkout. Never reset it, commit it, or include it in bug reports. No provider
credentials are included; each computer signs in separately.

## What a GitHub install brings over

The public repository supplies the app, authored references, reusable visuals
and 635 original practice variants from 112 setups. They are different questions
from the corresponding textbook numbers.

If the owner supplies their matching Morin PDF, use **Add textbook PDF** in
Chapters or Library → Problems. This restores all 635 prepared textbook questions
and exercises locally, with source figures and existing help/simulation bindings,
without AI extraction. Verify its book count and a source figure after import.
Read [Book imports](BOOKS.md) for the exact supported PDF fingerprint. Do not
download a textbook for the owner or publish the imported content.

The owner's existing saved progress and course assessments need a separate
private transfer with their instruction. Reimporting the PDF restores prepared
content, not their chats or progress. Do not copy provider credential stores.

macOS and Linux have source launch commands and per-user data paths. Their
complete device and provider setup have not been verified. This is a local
single-user app, not a public server or a packaged desktop installer.
