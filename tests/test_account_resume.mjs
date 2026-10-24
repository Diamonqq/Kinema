// Reload during the class step resumes at that step; it does not replay the whole welcome. Fake DOM and API, no provider.
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
globalThis.CSS = { escape: s => String(s) };
globalThis.window = globalThis;
const host = { innerHTML: '' };
class El {
  constructor(tag) { this.tagName = tag; this.innerHTML = ''; this.dataset = {}; this.open = false; this.isConnected = true; this.classList = { add() {}, remove() {} }; }
  addEventListener() {} setAttribute() {} append() {} remove() { this.isConnected = false; }
  querySelector(sel) { return sel === '.kw-inner' ? host : sel === '.ka-account-status' || sel === 'button' ? new El('span') : null; }
  querySelectorAll() { return []; } showModal() { this.open = true; } close() { this.open = false; }
}
globalThis.document = { createElement: t => new El(t), body: { append() {} }, documentElement: { classList: { add() {}, remove() {} } }, activeElement: null };
const { AccountPanel } = await import('../static/js/account_panel.js');

const backend = onboarding => async () => ({ token: 't', onboarding_required: onboarding, storage: { available: true }, providers: [], cli: { providers: [] }, account: { provider: 'claude' } });
const make = onboarding => new AccountPanel({ teacher: { host: { querySelector: () => null }, d: { toast() {} } }, api: backend(onboarding), url: p => p, models: null });

// Start already finished (server onboarding saved), welcome flag not yet written, class step open when the page reloaded.
store.clear(); store.set('kinema.welcome.classStep', '1');
let asked = 0;
window.KinemaProfile = { get: () => ({ asked: false }), askCourse: async () => { asked++; } };
let panel = await make(false).init();
assert.ok(!panel.welcome, 'no full welcome replay on reload');
await panel.resumeClassStep();
assert.equal(asked, 1, 'the class step is shown again');
assert.ok(!panel.welcome, 'welcome closes once the class step is answered');
assert.equal(store.has('kinema.welcome.classStep'), false, 'the resume flag is cleared');
assert.equal(store.get('kinema.welcome.v2'), '1', 'the welcome is marked seen');

// Already answered: nothing is shown.
store.clear(); store.set('kinema.welcome.classStep', '1'); asked = 0;
window.KinemaProfile = { get: () => ({ asked: true }), askCourse: async () => { asked++; } };
panel = await make(false).init();
await panel.resumeClassStep();
assert.equal(asked, 0); assert.equal(store.get('kinema.welcome.v2'), '1');

// An existing install without the resume flag still sees the new welcome once.
store.clear();
panel = await make(false).init();
assert.equal(panel.welcome?.open, true, 'upgrade shows the welcome once');
panel.welcome.close();

// A true first run still opens the full welcome.
store.clear();
panel = await make(true).init();
assert.equal(panel.welcome?.open, true, 'first run opens the welcome');
await panel.resumeClassStep();
assert.equal(panel.welcome?.open, true, 'resume does nothing for a first run');
panel.welcome.close();
console.log('account resume: 9 checks passed');
