// Guided welcome (1.48): three steps, browse-only choice, signedIn gate, Settings link.
// Runs AccountPanel against a fake DOM and a fake connections API; no real provider, login or install.
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
globalThis.CSS = { escape: s => String(s) };
globalThis.window = globalThis;
class El {
  constructor(tag) { this.tagName = tag; this.innerHTML = ''; this.dataset = {}; this.open = false; this.isConnected = true; this.classList = { add() {}, remove() {} }; }
  addEventListener() {} setAttribute() {} append() {} remove() { this.isConnected = false; }
  querySelector(sel) { return sel === '.ka-account-status' || sel === 'button' ? new El('span') : null; } querySelectorAll() { return []; } showModal() { this.open = true; } close() { this.open = false; } focus() {}
}
globalThis.document = { createElement: t => new El(t), body: { append() {} }, documentElement: { classList: { add() {}, remove() {} } }, activeElement: null };

const { AccountPanel } = await import('../static/js/account_panel.js');

let checks = 0;
const ck = (value, name) => { assert.ok(value, name); checks++; };
const teacher = { host: { querySelector: () => null }, d: { toast() {} } };
const click = (dataset) => ({ target: { closest: () => ({ dataset, disabled: false }) } });

// Fake connections API: state lives in `state`; each route mirrors the real response shape the panel reads.
const cli = () => [
  { id: 'codex', label: 'Codex', tier: 'primary', installed: true, supported: true, connected: false, state: 'ready', login_mode: 'device', allowed_actions: ['login'], login: { state: 'idle' } },
  { id: 'claude', label: 'Claude', tier: 'primary', installed: false, supported: true, connected: false, state: 'missing', login_mode: 'browser', allowed_actions: [], login: { state: 'idle' } },
  { id: 'gemini-cli', label: 'Gemini', tier: 'primary', available: false, installed: false, supported: false, connected: false, state: 'unavailable', detail: 'Google sign-in is unavailable in Kinema.', allowed_actions: [], login: { state: 'idle' } },
  { id: 'kimi-cli', label: 'Kimi', tier: 'primary', installed: true, supported: true, connected: false, state: 'ready', login_mode: 'device', allowed_actions: ['login'], login: { state: 'idle' } },
];
function backend({ onboarding = true, connected = [], failLoads = 0, loginConnects = true, checkConnects = false } = {}) {
  const state = { onboarding_required: onboarding, account: { provider: null }, cli: cli(), failLoads };
  for (const p of state.cli) if (connected.includes(p.id)) p.connected = true;
  const snapshot = () => ({ token: 'tok', onboarding_required: state.onboarding_required, storage: { available: true }, providers: [], cli: { providers: state.cli }, account: state.account });
  const api = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    if (method === 'GET' && state.failLoads > 0) { state.failLoads--; throw new Error('Connection refused'); }
    const cliRow = url.match(/\/cli\/([^/]+)\/(login|use)$/);
    if (url.endsWith('/onboarding') && method === 'POST') state.onboarding_required = false;
    if (url.endsWith('/cli/codex/check') && checkConnects) state.cli.find(x => x.id === 'codex').connected = true;
    if (cliRow && cliRow[2] === 'login') { const p = state.cli.find(x => x.id === cliRow[1]); if (loginConnects) p.connected = true; p.login = { state: 'succeeded' }; }
    if (cliRow && cliRow[2] === 'use') state.account = { provider: cliRow[1] };
    return { ...snapshot(), applied: {} };
  };
  return { state, api };
}
const panels = [];
const panelFor = (api) => { const p = new AccountPanel({ teacher, api, url: p => p, models: null }); panels.push(p); return p; };
const cleanup = () => { for (const p of panels) { clearTimeout(p.pollTimer); p.pollUntil = 0; p.welcome?.close(); p.dialog?.close(); } };
const reset = () => { cleanup(); store.clear(); };

// 1. First run: full-screen welcome, three steps, nothing signed in.
reset();
let b = backend();
let panel = await panelFor(b.api).init();
ck(panel.welcome?.open === true, 'First run opens the welcome');
let html = panel.welcome.innerHTML;
ck(html.includes('Make physics click.') && html.includes('Get started') && html.includes('Explore without AI'), 'Step 1 has heading, Get started and Explore without AI');
ck(html.includes('viewBox="0 0 64 64"') && html.includes('kw-panes') && html.includes('See it move') && html.includes('Ask about a step') && html.includes('Keep what matters'), 'Step 1 shows the Kinema mark and the simulation, chat and notes panes');
ck(html.includes('aria-label="Setup progress"') && ['Welcome', 'Account', 'Ready'].every(s => html.includes(`>${s}</li>`)), 'Progress shows Welcome, Account and Ready');
ck(!/antigravity/i.test(html), 'Welcome copy has no Antigravity reference');
ck(window.KinemaAccount.signedIn === false, 'signedIn is false on first run before any account');

// 2. Get started â†’ Choose your tutor, four equal options.
await panel.welcomeAct(click({ kw: 'next' }));
html = panel.welcome.innerHTML;
ck(html.includes('Choose your tutor') && (html.match(/class="kw-card"/g) || []).length === 4, 'Step 2 shows exactly four tutor options');
for (const [name, tool] of [['ChatGPT', 'Codex'], ['Claude', 'Claude Code'], ['Google Gemini', 'Gemini CLI'], ['Kimi', 'Kimi Code']]) ck(html.includes(`<b>${name}</b><small class="kw-tool">${tool}</small>`), `Option ${name} shows tool ${tool}`);
ck(!/antigravity|fallback/i.test(html), 'Account step has no Antigravity or fallback copy');
ck(html.includes('Explore without AI') && html.includes('kw-back'), 'Account step keeps Explore without AI and Back');

ck(html.includes('disabled aria-label="Google Gemini unavailable"'), 'Google card is explicitly unavailable');
const priorFlow=panel.flow; await panel.welcomeAct(click({kw:'pick',provider:'gemini-cli'}));
ck(panel.flow===priorFlow, 'Unavailable Google cannot start a sign-in');
const unavailable=panel.signinHTML(b.state.cli.find(p=>p.id==='gemini-cli'),true);
ck(unavailable.includes('Unavailable') && !/data-ka="(?:cli-login|cli-check|install|use)"/.test(unavailable), 'Unavailable details offer no broken actions');

// 3. Explore without AI persists the browse-only choice and closes the welcome.
await panel.welcomeAct(click({ kw: 'skip' }));
ck(store.get('kinema.browseOnly') === '1', 'Skip stores the explicit browse-only flag');
ck(store.get('kinema.welcome.v2') === '1' && store.get('kinema.onboarded') === '1', 'Closing the welcome marks it seen');
ck(b.state.onboarding_required === false, 'Skip still completes onboarding on the server');
ck(panel.welcome === null && window.KinemaAccount.signedIn === false, 'Skipped welcome leaves signedIn false');

// 4. Later launch: no welcome again, browse-only still honoured.
b = backend({ onboarding: false });
panel = await panelFor(b.api).init();
ck(!panel.welcome?.open && panel.browseOnly === true && window.KinemaAccount.signedIn === false, 'Later launch skips the welcome and keeps browse-only');

// 5. Existing install that never saw the welcome gets it once.
store.delete('kinema.welcome.v2');
b = backend({ onboarding: false });
panel = await panelFor(b.api).init();
ck(panel.welcome?.open === true, 'Existing install sees the new welcome once');
await panel.welcomeAct(click({ kw: 'close' }));
ck(panel.welcome === null && store.get('kinema.welcome.v2') === '1', 'Closing once marks the welcome seen for the install');

// 6. Sign in, Ready, Start learning makes the account in use and signedIn true.
reset();
b = backend();
panel = await panelFor(b.api).init();
await panel.welcomeAct(click({ kw: 'next' }));
await panel.welcomeAct(click({ kw: 'pick', provider: 'codex' }));
html = panel.welcome.innerHTML;
ck(html.includes('Ready') && html.includes('Start learning') && html.includes('</span> ChatGPT</p>'), 'After sign-in the Ready step shows the account and Start learning');
ck(panel.step === 'ready' && window.KinemaAccount.signedIn === false, 'Ready alone does not count as signed in until the account is in use');
await panel.welcomeAct(click({ kw: 'start' }));
ck(b.state.account.provider === 'codex', 'Start learning makes the chosen account the one in use');
ck(window.KinemaAccount.signedIn === true && store.get('kinema.browseOnly') === undefined, 'Using an account clears browse-only and sets signedIn');
ck(panel.welcome === null, 'Start learning closes the welcome');

// 7. Back from Ready returns to the account step; Back from Account returns to Welcome.
reset();
b = backend();
panel = await panelFor(b.api).init();
await panel.welcomeAct(click({ kw: 'next' }));
await panel.welcomeAct(click({ kw: 'back' }));
ck(panel.step === 'welcome' && panel.welcome.innerHTML.includes('Make physics click.'), 'Back from Account returns to Welcome');

// 8. Unknown or checking state never reads as signed in.
const unknown = panelFor(backend().api);
ck(unknown.signedIn === false, 'Before data loads signedIn is false');
const checking = backend();
checking.state.cli[0].checking = true;
const pending = panelFor(checking.api);
await pending.refresh();
ck(pending.signedIn === false, 'A checking provider without a connected account is not signed in');

// 9. Signing in clears an earlier browse-only choice when the account is used.
reset();
store.set('kinema.browseOnly', '1');
b = backend({ onboarding: false, connected: ['claude'] });
panel = panelFor(b.api);
await panel.init();
ck(panel.browseOnly === true && window.KinemaAccount.signedIn === false, 'Saved browse-only keeps signedIn false');
await panel.useAccount('claude', 'cli');
ck(store.get('kinema.browseOnly') === undefined && window.KinemaAccount.signedIn === true, 'Use for Kinema clears browse-only');

// 10. Settings has a small link back to the welcome; it opens with Close and Back.
const settings = panelFor(backend({ onboarding: false }).api);
await settings.refresh();
ck(settings.accountHTML().includes('data-ka="welcome"'), 'Settings account page links to the welcome');
await settings.act({ target: { closest: () => ({ dataset: { ka: 'welcome' } }) } });
ck(settings.welcome?.open === true && settings.optional === true && settings.welcome.innerHTML.includes('aria-label="Close"'), 'Settings link opens the welcome with Close');
await settings.welcomeAct(click({ kw: 'close' }));
ck(settings.welcome === null, 'Close from a Settings-opened welcome leaves it closed');

// 11. Explore without AI is offered even with a saved account in use, and persists browse-only gating signedIn.
reset();
b = backend({ onboarding: true, connected: ['codex'] });
b.state.account = { provider: 'codex' };
panel = await panelFor(b.api).init();
ck(panel.welcome?.open && panel.welcome.innerHTML.includes('Explore without AI'), 'Saved account in use still shows Explore without AI on the welcome');
ck(window.KinemaAccount.signedIn === true, 'Saved account in use is signed in before any browse-only choice');
await panel.welcomeAct(click({ kw: 'skip' }));
ck(store.get('kinema.browseOnly') === '1' && window.KinemaAccount.signedIn === false, 'Browse-only with a saved account persists and gates signedIn');
ck(panel.active()?.id === 'codex', 'The saved account stays connected while browse-only');
panel = await panelFor(b.api).init();
ck(!panel.welcome?.open && window.KinemaAccount.signedIn === false, 'Relaunch keeps browse-only with the saved account');
ck(panel.accountItemHTML(panel.find('codex'), true).includes('Turn AI back on') && panel.accountHTML().includes('data-ka="use-ai"'), 'Settings offers Turn AI back on while browse-only');
await panel.act({ target: { closest: () => ({ dataset: { ka: 'use-ai' } }) } });
ck(window.KinemaAccount.signedIn === true && store.get('kinema.browseOnly') === undefined, 'Turn AI back on uses the account and clears browse-only');

// 12. Explore without AI hides only while a sign-in is actually running.
reset();
b = backend({ onboarding: true });
panel = await panelFor(b.api).init();
panel.step = 'account'; panel.flow = 'codex';
panel.find('codex').login = { state: 'idle' };
ck(panel.accountStepHTML().includes('Explore without AI'), 'Explore without AI shows on an idle sign-in step');
panel.find('codex').login = { state: 'waiting' };
ck(!panel.accountStepHTML().includes('Explore without AI'), 'Explore without AI hides while a sign-in is waiting');

// 13. Ready only when the account is verified connected.
reset();
b = backend({ onboarding: true, loginConnects: false });
panel = await panelFor(b.api).init();
await panel.welcomeAct(click({ kw: 'next' }));
await panel.welcomeAct(click({ kw: 'pick', provider: 'codex' }));
ck(panel.step === 'account' && !panel.welcome.innerHTML.includes('Start learning'), 'An unverified login does not reach Ready');
ck(window.KinemaAccount.signedIn === false, 'Unverified login is not signed in');

// 14. Connection-load failure on first run keeps the walkthrough, Explore and a retry.
reset();
b = backend({ onboarding: true, failLoads: 1 });
panel = await panelFor(b.api).init();
html = panel.welcome?.innerHTML ?? '';
ck(panel.welcome?.open && html.includes('Make physics click.') && html.includes('Explore without AI') && html.includes('data-kw="retry"'), 'Load failure on first run shows the walkthrough, Explore without AI and Try again');
ck(window.KinemaAccount.signedIn === false, 'Failed load stays unknown, not signed in');
await panel.welcomeAct(click({ kw: 'retry' }));
ck(panel.loadFailed === false && !panel.welcome.innerHTML.includes('data-kw="retry"'), 'Try again reloads account details and clears the failure');

// 15. Load failure on an installed app does not force a welcome; Explore still works after a failed first run.
reset();
store.set('kinema.welcome.v2', '1');
b = backend({ onboarding: false, failLoads: 1 });
panel = await panelFor(b.api).init();
ck(!panel.welcome?.open && panel.loadFailed === true && window.KinemaAccount.signedIn === false, 'Failed load on an installed app opens no welcome and stays not signed in');
reset();
b = backend({ onboarding: true, failLoads: 1 });
panel = await panelFor(b.api).init();
await panel.welcomeAct(click({ kw: 'skip' }));
ck(store.get('kinema.browseOnly') === '1' && panel.welcome === null, 'Explore without AI works after a failed first load');

// 16. Immediate verified check from the welcome goes to Ready without waiting for a background poll.
reset();
b = backend({ onboarding: true, loginConnects: false, checkConnects: true });
panel = await panelFor(b.api).init();
await panel.welcomeAct(click({ kw: 'next' }));
await panel.welcomeAct(click({ kw: 'pick', provider: 'codex' }));
ck(panel.step === 'account' && !panel.welcome.innerHTML.includes('Start learning'), 'Before a verified check the welcome stays on the account step');
await panel.welcomeAct(click({ ka: 'cli-check', provider: 'codex' }));
ck(panel.step === 'ready' && panel.welcome.innerHTML.includes('Start learning') && panel.welcome.innerHTML.includes('</span> ChatGPT</p>'), 'A connected Check now result opens Ready immediately');
ck(window.KinemaAccount.signedIn === false, 'Ready from a check does not poll and is not signed in until the account is used');
ck(panel.notice === '', 'A verified check leaves no pending notice');

// 17. Unverified check keeps the account step with the not-confirmed notice; unknown stays false.
reset();
b = backend({ onboarding: true, loginConnects: false, checkConnects: false });
panel = await panelFor(b.api).init();
await panel.welcomeAct(click({ kw: 'next' }));
await panel.welcomeAct(click({ kw: 'pick', provider: 'codex' }));
await panel.welcomeAct(click({ ka: 'cli-check', provider: 'codex' }));
ck(panel.step === 'account' && !panel.welcome.innerHTML.includes('Start learning'), 'An unverified check does not reach Ready');
ck(panel.welcome.innerHTML.includes('Sign-in is not confirmed yet'), 'An unverified check shows the not-confirmed notice');
ck(window.KinemaAccount.signedIn === false, 'An unverified check is not signed in');

// 18. A cancellation notice does not survive a new login or check.
reset();
b = backend({ onboarding: true, loginConnects: false, checkConnects: true });
panel = await panelFor(b.api).init();
await panel.welcomeAct(click({ kw: 'next' }));
await panel.welcomeAct(click({ kw: 'pick', provider: 'codex' }));
await panel.welcomeAct(click({ ka: 'cli-cancel', provider: 'codex' }));
ck(panel.notice === 'Sign-in cancelled.', 'Cancel shows the cancellation notice');
await panel.welcomeAct(click({ ka: 'cli-check', provider: 'codex' }));
ck(panel.notice === '' && panel.step === 'ready', 'Check after a cancel clears the stale notice and reaches Ready');
reset();
b = backend({ onboarding: true, loginConnects: false });
panel = await panelFor(b.api).init();
await panel.welcomeAct(click({ kw: 'next' }));
await panel.welcomeAct(click({ kw: 'pick', provider: 'codex' }));
await panel.welcomeAct(click({ ka: 'cli-cancel', provider: 'codex' }));
await panel.welcomeAct(click({ kw: 'pick', provider: 'codex' }));
ck(!panel.notice.includes('cancelled'), 'A new login after a cancel clears the cancellation notice');

// 19. A verified check outside the welcome (Settings) does not clear browse-only.
reset();
store.set('kinema.browseOnly', '1');
store.set('kinema.welcome.v2', '1');
b = backend({ onboarding: false, checkConnects: true });
panel = await panelFor(b.api).init();
await panel.act({ target: { closest: () => ({ dataset: { ka: 'cli-check', provider: 'codex' } }) } });
ck(store.get('kinema.browseOnly') === '1' && window.KinemaAccount.signedIn === false && panel.find('codex')?.connected === true, 'Settings check confirms the account without ending browse-only');

cleanup();
console.log(`test_account_welcome.mjs: ${checks} checks passed`);
