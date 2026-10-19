# Connect an AI account

Prepared references and reusable simulations work without an account. Choose
**Explore without AI** during the welcome to use them. AI chat and newly generated
visuals need a connection; you can add one later in **Settings ? Accounts**.

## Choose an account

| Account | Connection | Images in chat |
| --- | --- | --- |
| ChatGPT | Official Codex CLI | Supported |
| Claude | Official Claude Code CLI | Supported |
| Kimi | Official Kimi Code CLI | Text only |
| Google | Browser account sign-in unavailable | ? |

Use **Sign in** and complete the provider's own browser or device-code flow.
If the command-line tool is missing, the account screen provides setup help.
Installation and sign-in require your action; Kinema does not accept provider
terms, switch accounts or install another provider automatically.

After signing in, choose the account to use for Kinema. Its available models
appear in the composer. A saved connection does not guarantee current quota or
access to every model; the provider can still reject a request. Kinema reports
that error instead of silently changing the account or model.

### Google

Google account sign-in is disabled in this preview. The consumer Gemini CLI route
used by the earlier build was discontinued. No Antigravity replacement is offered.
Existing local records are preserved, but Google account login, checks,
installation and model execution are disabled.

### Images and permissions

ChatGPT and Claude support attached homework images through the native runners.
Kimi is text only in this integration. Kinema's tutor runners disable tool access;
they are intended to explain the study material, not operate your computer.
Kimi refuses incompatible hooks, plugins or MCP configuration rather than
changing your settings.

## Account and data boundaries

Kinema calls the provider's original CLI and uses its own authentication flow.
It does not copy subscription OAuth tokens into an API client. The CLI retains
its own login. Signing that CLI out can affect other apps that use it; Kinema
asks before performing a supported sign-out.

Each installation keeps its own chats, uploads and account selections. Questions,
relevant context and supported attachments go to the selected provider when you
ask the tutor. Your provider's plan, permissions, privacy terms and usage limits
apply. Real account availability can differ from the isolated checks in this repo.

## Optional API connections

Advanced API connections support OpenAI, Anthropic, Gemini, Moonshot and
OpenRouter. They use separate API credentials and can incur separate charges;
a subscription login does not automatically provide API credit.

On Windows, saved keys use current-user DPAPI. Other platforms require a trusted
system keyring. When secure storage is unavailable, Kinema can use an explicitly
chosen session-only connection; it does not silently save a plaintext key.
Environment credentials are opt-in. Disconnecting never edits environment
variables or revokes a provider key.

Keep the app on localhost. Its local connection guards are not a login system for
a publicly hosted server. Do not put account files, credentials, uploads or your
runtime data folder in a repository or shared archive.

[Back to setup](PUBLIC-SETUP.md)
