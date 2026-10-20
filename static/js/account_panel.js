import { esc } from './md.js';
import { modelName, effortLabel, setModelCatalog } from './model_identity.js';
import { kinemaMark, providerMark } from './brand.js';
import { loadUsage, usageHTML } from './account_usage.js';

const svg = body => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const icon = {
  settings: svg('<path d="M9 4h6l1 3 3 1v7l-3 1-1 3H9l-1-3-3-1V8l3-1Z"/><circle cx="12" cy="11.5" r="3"/>'),
  user: svg('<circle cx="12" cy="8.5" r="3.5"/><path d="M5 19.5c1.4-3.6 4-5 7-5s5.6 1.4 7 5"/>'),
  arrow: svg('<path d="m9 6 6 6-6 6"/>'),
  back: svg('<path d="m14 6-6 6 6 6"/>'),
  close: svg('<path d="m6 6 12 12M6 18 18 6"/>'),
  globe: svg('<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c5 5 5 11 0 16-5-5-5-11 0-16Z"/>'),
  orbit: svg('<path d="M4 16c3-7 13-7 16 0" /><path d="M4 16h16" stroke-dasharray="1.5 2.5"/><circle cx="12" cy="8" r="2.2"/>'),
  chat: svg('<path d="M5 6.5h14v9H11l-4 3v-3H5Z"/><path d="M8.5 10.5h7"/>'),
  notes: svg('<rect x="6" y="4.5" width="12" height="15" rx="2"/><path d="M9 9h6M9 12.5h6M9 16h3.5"/>'),
};
// Only keys the locale files already carry are bound; new copy stays in English until they are added.
let known = () => false;
const copy = (key, text) => known(key) ? `<span data-i18n="${key}">${esc(text)}</span>` : `<span>${esc(text)}</span>`;
const names = {codex:'ChatGPT',claude:'Claude','gemini-cli':'Google Gemini','kimi-cli':'Kimi'};
const tools = {codex:'Codex',claude:'Claude Code','gemini-cli':'Gemini CLI','kimi-cli':'Kimi Code'};
// The four tutor accounts in the welcome, in calm equal order.
const TUTORS = ['codex','claude','gemini-cli','kimi-cli'];
const mark = id => providerMark(id);
const brand = id => id;
const ACTIVE = ['starting','waiting','cancelling'];
const safeLink = value => {try {const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:'';}catch{return '';}};
const cleanError = (error, fallback) => {
  const message = typeof error?.message === 'string' ? error.message.trim() : '';
  return !message || message.length > 350 || /(?:sk-[\w-]{8}|AIza[\w-]{8}|bearer\s|api[_ -]?key\s*[:=]|https?:\/\/[^\s]+[?&](?:key|token)=)/i.test(message) ? fallback : message;
};
const defaultEffort = model => model?.efforts?.includes(model.default_effort) ? model.default_effort : model?.efforts?.[0] || 'default';
const choiceText = c => c?.model ? (c.label || modelName(c.model)) + (c.effort && c.effort !== 'default' ? ' · ' + effortLabel(c.effort, c.model) : '') : '';
const ONBOARDED = 'kinema.onboarded';
// 1.48 welcome: shown once per installed app; older installs see it once on their next open.
const WELCOME = 'kinema.welcome.v2';
// Explicit "Explore without AI" choice; cleared when an account is used or signed in.
const BROWSE = 'kinema.browseOnly';
const readFlag = key => { try { return localStorage.getItem(key) === '1'; } catch { return false; } };
const writeFlag = (key, on) => { try { if (on) localStorage.setItem(key, '1'); else localStorage.removeItem(key); } catch {} };
// Official CLI rows and API-key rows (which carry key_url) share one account list.
const nameOf = p => names[p?.id] || p?.label || p?.id || '';
const toolOf = p => p?.key_url ? 'API key' : tools[p?.id] || p?.tool || '';

/** Installed / latest versions of the official apps, with Install/Update on click only. */
export function mountUpdates(el, {api, url, token}) {
  let data = null, error = '', timer = null, busy = '';
  const render = () => {
    if (!el.isConnected) { clearTimeout(timer); return; }
    const apps = data?.apps || [];
    el.innerHTML = `<div class="ka-updates">${!data ? '<p class="ka-field-note">Checking versions…</p>' : apps.map(a => {
      const running = a.job?.state === 'running' || busy === a.id;
      const version = a.installed ? (a.version ? 'v' + a.version : 'Installed') : 'Not installed';
      const latest = a.latest ? (a.update_available ? ' · v' + a.latest + ' available' : a.version === a.latest ? ' · up to date' : ' · latest v' + a.latest) : a.installed && data.checking ? ' · checking for updates…' : '';
      const button = running ? `<span class="ka-update-state" role="status">${a.installed ? 'Updating…' : 'Installing…'}</span>`
        : a.action === 'install' ? `<button type="button" data-update="${esc(a.id)}">Install</button>`
        : a.action === 'update' && (a.update_available || (!a.latest && !data.checking)) ? `<button type="button" data-update="${esc(a.id)}">Update</button>`
        : a.action ? '' : `<small>${esc(a.route || '')}</small>`;
      const note = a.job?.state === 'failed' ? `<small class="ka-update-error">${esc(a.job.error || 'The installer did not finish.')}</small>` : a.job?.state === 'succeeded' ? '<small class="ka-update-done">Done</small>' : '';
      return `<div class="ka-update-row"><span class="ka-provider-icon" data-provider-brand="${esc(brand(a.id))}">${mark(a.id)}</span><span class="ka-update-name">${esc(a.tool)}<small>${esc(version + latest)}</small>${note}</span>${button}</div>`;
    }).join('')}${error ? `<p class="ka-error" role="alert">${esc(error)}</p>` : ''}<p class="ka-field-note ka-update-foot">Install and Update run each provider’s official installer on this computer.</p></div>`;
  };
  const load = async () => {
    try { data = await api(url('/api/connections/updates')); error = ''; }
    catch (e) { error = cleanError(e, 'Versions are unavailable right now.'); }
    render();
    clearTimeout(timer);
    if (el.isConnected && (data?.checking || data?.apps?.some(a => a.job?.state === 'running'))) timer = setTimeout(load, 1500);
  };
  el.addEventListener('click', async e => {
    const id = e.target.closest('[data-update]')?.dataset.update; if (!id || busy) return;
    busy = id; render();
    try { const t = await token(); data = await api(url('/api/connections/updates/' + encodeURIComponent(id)), {method:'POST', headers:{'Content-Type':'application/json','X-Kinema-Connection-Token':t}, body:JSON.stringify({confirm:true,_connection_token:t})}); error = ''; }
    catch (err) { error = cleanError(err, 'The installer could not start.'); }
    busy = ''; load();
  });
  render(); load();
  return {refresh: load, stop: () => clearTimeout(timer)};
}

/** One account place: first-run welcome, Settings › Account and sign-in. No model choice before sign-in. */
export class AccountPanel {
  constructor({teacher, api, url, models, openLanguage, translate}) {
    this.t = teacher; this.api = api; this.url = url; this.models = models;
    this.openLanguage = openLanguage; this.translate = translate || ((key, fallback) => fallback || key);
    known = key => { const value = this.translate(key, '\u0001'); return value !== '\u0001' && value !== key; };
    this.data = null; this.busy = false; this.view = 'account'; this.keyMode = 'secure';
    this.step = 'welcome'; this.flow = null; this.optional = false; this.browseOnly = readFlag(BROWSE);
    this.footer = document.createElement('div'); this.footer.className = 'ka-account'; this.footer.dataset.localize = 'account';
    this.footer.innerHTML = `<button type="button" class="ka-account-button" data-ka="menu" aria-haspopup="menu" aria-expanded="false">${icon.settings}<span>Settings</span><small class="ka-account-status"></small><span class="ka-account-caret" aria-hidden="true">⌃</span></button>`;
    teacher.host.querySelector('.tv-side')?.append(this.footer);
    this.footer.addEventListener('click', () => this.toggleMenu());
    // Settings page slots (settings_page.js) mount these; the dialog stays the place for sign-in steps.
    const panel = this;
    window.KinemaAccount = {
      mountAccount: el => this.mountAccount(el),
      mountUpdates: el => mountUpdates(el, {api, url, token: () => this.token()}),
      openSignIn: () => this.open('account'),
      openWelcome: opts => this.openWelcome(opts),
      promptSignIn: () => this.promptSignIn(),
      get signedIn() { return panel.signedIn; },
    };
    // Hide the app behind a possible first-run welcome until setup state is known.
    if (!readFlag(WELCOME)) { try { document.documentElement.classList.add('ka-first-run-check'); } catch {} }
  }
  async init() {
    if (this.initialized) return this;
    this.initialized = true;
    try { await this.refresh(); if (this.data.onboarding_required || !readFlag(WELCOME)) this.openWelcome(); else this.markOnboarded(); }
    catch {
      // Account details did not load. A first run keeps its walkthrough with a retry and Explore without AI; an installed app keeps working.
      this.loadFailed = true; if (!readFlag(WELCOME)) this.openWelcome();
    }
    finally { document.documentElement.classList.remove('ka-first-run-check'); this.syncFooter(); }
    this.refresh(true).then(() => this.watch()).catch(() => {});
    return this;
  }
  async token() { if (!this.data) await this.refresh(); return this.data.token; }
  markOnboarded() { try { localStorage.setItem(ONBOARDED, '1'); } catch {} }
  /** True only for a verified, connected account that Kinema uses and no explicit browse-only choice. Unknown or checking is not signed in. */
  get signedIn() { return !this.browseOnly && !!this.active(); }
  /** Explore without AI: remembered until an account is used or signed in. */
  browse(on) { this.browseOnly = on; writeFlag(BROWSE, on); }
  async refresh(background = false) {
    const data = await this.api(this.url('/api/connections' + (background ? '?refresh=1' : '')));
    this.accept(data); return data;
  }
  accept(data) {
    if (!data || !Array.isArray(data.providers) || typeof data.token !== 'string') throw new Error('Account details are unavailable. Try again.');
    this.data = data; setModelCatalog([...data.providers,...(data.cli?.providers || [])].flatMap(p=>p.models || [])); this.syncFooter();
  }
  cli() { return this.data?.cli?.providers || []; }
  find(pid) { return this.cli().find(p => p.id === pid); }
  /** The account Kinema uses (set in Settings › Account), when it is still connected. */
  active() {
    const pid = this.data?.account?.provider, row = this.find(pid) || this.data?.providers?.find(p => p.id === pid);
    return row?.connected ? row : null;
  }
  syncFooter() {
    const status = this.footer.querySelector('.ka-account-status'), active = this.active();
    status.textContent = active ? nameOf(active) : '';
  }
  /** Poll while a sign-in or background check is running; repaint whatever is open. */
  watch() {
    clearTimeout(this.pollTimer);
    const live = this.cli().some(p => p.checking || ACTIVE.includes(p.login?.state));
    this.paint();
    if (!live) return;
    if (!this.pollUntil) this.pollUntil = Date.now() + 15 * 60000;
    if (Date.now() > this.pollUntil) { this.pollUntil = 0; this.notice = this.translate('signin_auto_paused','Automatic checks paused. Use Check sign-in to try again.'); this.paint(); return; }
    this.pollTimer = setTimeout(async () => {
      const before = this.cli().map(p => p.id + p.state + p.login?.state).join();
      try { await this.refresh(); } catch { this.pollUntil = 0; return; }
      const finished = this.flow && this.find(this.flow)?.login?.state === 'succeeded' && this.step !== 'ready';
      if (finished) await this.finishSignIn(this.flow);
      if (before !== this.cli().map(p => p.id + p.state + p.login?.state).join()) await this.models?.load?.();
      this.watch();
    }, 900);
    if (!live) this.pollUntil = 0;
  }
  paint() { if (this.welcome?.open) this.renderWelcome(); if (this.dialog?.open) this.render(); if (this.mounted?.isConnected) this.renderMounted(); }

  /** Settings › Account: who is signed in, plan usage and the models in use; steps open in the Account dialog. */
  mountAccount(el) {
    this.mounted = el; el.classList.add('ka-mounted');
    if (!el.dataset.kaBound) {
      el.dataset.kaBound = '1';
      el.addEventListener('click', e => {
        const b = e.target.closest('[data-kam]'); if (!b) return; const a = b.dataset.kam;
        if (a === 'use') return this.useAccount(b.dataset.provider, b.dataset.kind);
        if (a === 'signin') { this.open('account'); if (b.dataset.provider) { this.providerId = b.dataset.provider; this.connectionKind = 'cli'; this.render(); } return; }
        this.open('account'); if (a === 'switch') { this.switching = true; this.render(); } if (a === 'signout') { this.confirmSignout = b.dataset.provider; this.render(); }
      });
    }
    this.renderMounted();
    const load = this.data ? Promise.resolve() : this.refresh().catch(() => {});
    load.then(() => { this.renderMounted(); if (this.active()) this.readUsage(false, 3); });
  }
  renderMounted() {
    const el = this.mounted; if (!el?.isConnected) return;
    if (!this.data) { el.innerHTML = `<p class="ka-field-note">${copy('loading','Loading…')}</p>`; return; }
    const active = this.active(), signedIn = [...this.cli(), ...(this.data.providers || [])].filter(p => p.connected);
    if (!signedIn.length) {
      const rows = this.cli().filter(p => p.tier === 'primary' && p.available !== false);
      el.innerHTML = `<div class="ka-mount-card"><p class="ka-intro">${copy('signin_prompt','Sign in with one account to use the tutor, worked lessons and visuals.')}</p><div class="ka-mount-signin">${rows.map(p => `<button type="button" data-kam="signin" data-provider="${esc(p.id)}"><span class="ka-provider-icon" data-provider-brand="${esc(brand(p.id))}">${mark(p.id)}</span>${esc(names[p.id])}</button>`).join('')}</div><button type="button" class="ka-subtle" data-kam="open">${copy('more_options','More sign-in options')}</button></div>`;
      return;
    }
    // One list: the account Kinema uses is marked; every other signed-in account can be switched to.
    const list = signedIn.map(p => this.accountItemHTML(p, p.id === active?.id)).join('');
    const notIn = this.cli().filter(p => p.tier === 'primary' && p.available !== false && !p.connected);
    el.innerHTML = `<div class="ka-mount-card"><div class="ka-account-list" role="list">${list}</div>${notIn.length ? `<div class="ka-mount-signin">${notIn.map(p => `<button type="button" data-kam="signin" data-provider="${esc(p.id)}"><span class="ka-provider-icon" data-provider-brand="${esc(brand(p.id))}">${mark(p.id)}</span>${copy('sign_in_with','Sign in with')} ${esc(names[p.id])}</button>`).join('')}</div>` : ''}<div class="ka-connection-actions"><button type="button" data-kam="switch">${copy('switch_account','Switch account')}</button>${active && (active.allowed_actions || []).includes('signout') ? `<button type="button" data-kam="signout" data-provider="${esc(active.id)}">${copy('sign_out','Sign out')}</button>` : ''}<button type="button" data-kam="open">${copy('manage_connections','Connections and API keys')}</button></div></div>`;
  }
  accountItemHTML(p, using) {
    const kind = p.key_url ? 'api' : 'cli';
    // While browse-only is on, the account is not in use: its button turns AI back on.
    const action = using && !this.browseOnly ? `<span class="ka-using"><i></i>${copy('using_for_kinema','Using for Kinema')}</span>`
      : `<button type="button" class="ka-use-btn" data-kam="use" data-provider="${esc(p.id)}" data-kind="${kind}">${using ? 'Turn AI back on' : copy('use_for_kinema','Use for Kinema')}</button>`;
    return `<div class="ka-account-item${using ? ' is-using' : ''}" role="listitem"><div class="ka-account-row"><span class="ka-provider-icon" data-provider-brand="${esc(brand(p.id))}">${mark(p.id)}</span><div class="ka-account-text"><b>${esc(nameOf(p))}</b><small>${esc(toolOf(p))} · ${copy('signed_in','Signed in')}</small></div>${action}</div>${using ? usageHTML(this.usage) : ''}</div>`;
  }
  /** Settings › Account: make a signed-in account the one Kinema uses. The composer's models follow it. */
  async useAccount(pid, kind) {
    return this.run(async () => {
      const data = await this.write((kind === 'cli' ? 'cli/' : '') + encodeURIComponent(pid) + '/use');
      this.browse(false); this.applied = data.applied; await this.models?.load?.(); this.syncFooter();
    }, this.translate('use_failed', 'Could not switch accounts. Try again.'));
  }

  // ── Settings menu ─────────────────────────────────────────────────────────────
  toggleMenu() {
    if (this.pop) { this.closeMenu(); return; }
    const anchor = this.footer.querySelector('button'), pop = document.createElement('div'); this.pop = pop;
    pop.className = 'ka-account-menu'; pop.dataset.localize='account'; pop.setAttribute('popover','auto'); pop.setAttribute('role','menu');
    pop.innerHTML = `<p>Kinema</p><button type="button" role="menuitem" data-ka="account">${icon.user}<span>${copy('account','Account')}</span></button><button type="button" role="menuitem" data-ka="language">${icon.globe}<span>${copy('language','Language')}</span></button>`;
    document.body.append(pop);
    pop.addEventListener('click', e=>{const action=e.target.closest('[data-ka]')?.dataset.ka;if(!action)return;this.closeMenu();if(action==='language')this.language();else this.open();});
    pop.addEventListener('toggle', e=>{if(e.newState==='closed'&&this.pop===pop)this.closeMenu();});
    pop.addEventListener('keydown', e=>{
      if(e.key==='Escape'){e.preventDefault();this.closeMenu(true);}
      if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
        e.preventDefault();const rows=[...pop.querySelectorAll('button')],i=rows.indexOf(document.activeElement);
        rows[e.key==='Home'?0:e.key==='End'?rows.length-1:(i+(e.key==='ArrowDown'?1:-1)+rows.length)%rows.length]?.focus();
      }
    });
    pop.showPopover({source:anchor});anchor.setAttribute('aria-expanded','true');
    const r=anchor.getBoundingClientRect();pop.style.left=Math.max(10,Math.min(r.left,innerWidth-pop.offsetWidth-10))+'px';pop.style.top=Math.max(10,r.top-pop.offsetHeight-8)+'px';
    pop.querySelector('button').focus();
  }
  closeMenu(focus = false) {
    this.pop?.remove();this.pop=null;const anchor=this.footer.querySelector('button');anchor.setAttribute('aria-expanded','false');if(focus)anchor.focus();
  }
  async language() {
    if(this.dialog)this.close();if(this.openLanguage)await this.openLanguage();else this.t.d.toast('Language settings are not available yet.');
  }

  // ── First-run welcome: full screen, nothing else behind it. Steps: Welcome, Account, Ready ──
  /** optional: opened from Settings; Esc and Close leave it without a browse-only choice. */
  openWelcome({optional = false} = {}) {
    if (this.welcome?.open) return;
    const dialog = document.createElement('dialog'); this.welcome = dialog; this.optional = optional;
    dialog.className = 'kw-screen'; dialog.dataset.localize = 'account'; dialog.setAttribute('aria-label', 'Welcome to Kinema');
    // First run needs a choice: Esc does not dismiss it. From Settings, Esc just closes.
    dialog.addEventListener('cancel', e => { e.preventDefault(); if (this.optional) this.closeWelcome(); });
    dialog.addEventListener('click', e => this.welcomeAct(e));
    document.body.append(dialog); this.step = 'welcome'; this.flow = null; this.error = ''; this.notice = '';
    dialog.showModal(); this.renderWelcome();
  }
  /** Closing the welcome marks it seen for this install; the browse-only choice is set by skip alone. */
  closeWelcome() {
    writeFlag(WELCOME, true); this.markOnboarded();
    this.welcome?.close(); this.welcome?.remove(); this.welcome = null; this.flow = null; this.step = 'welcome'; this.optional = false;
  }
  renderWelcome() {
    const d = this.welcome; if (!d || this.asking) return;
    const focus = document.activeElement?.dataset?.kw || document.activeElement?.dataset?.ka;
    const p = this.flow && this.find(this.flow);
    const body = this.step === 'welcome' ? this.introHTML() : this.step === 'ready' && p?.connected ? this.readyHTML(p) : this.accountStepHTML();
    const retry = this.loadFailed ? `<p class="ka-error" role="alert">${copy('account_load_failed','Account details could not load.')}</p><button type="button" class="ka-primary kw-primary" data-kw="retry">Try again</button>` : '';
    d.innerHTML = `<div class="kw-inner">${this.topHTML()}<div class="kw-body">${body}${retry}${this.error ? `<p class="ka-error" role="alert">${esc(this.error)}</p>` : ''}${this.notice ? `<p class="ka-notice" role="status">${esc(this.notice)}</p>` : ''}</div></div>`;
    if (this.busy) d.querySelectorAll('button').forEach(b => { if (b.dataset.kw !== 'skip') b.disabled = true; });
    if (focus) d.querySelector(`[data-kw="${CSS.escape(focus)}"],[data-ka="${CSS.escape(focus)}"]`)?.focus({preventScroll:true});
  }
  /** Small Welcome / Account / Ready progress, Back on later steps, and Close when opened from Settings. */
  topHTML() {
    const steps = [['welcome','Welcome'], ['account','Account'], ['ready','Ready']], at = steps.findIndex(([id]) => id === this.step);
    const back = this.step === 'welcome' ? '' : `<button type="button" class="kw-back" data-kw="back" aria-label="Back">${icon.back}<span>Back</span></button>`;
    const close = this.optional ? `<button type="button" class="ka-icon kw-close" data-kw="close" aria-label="Close">${icon.close}</button>` : '';
    return `<div class="kw-top"><div class="kw-top-side">${back}</div><ol class="kw-steps" aria-label="Setup progress">${steps.map(([id, label], i) => `<li class="${i < at ? 'is-done' : i === at ? 'is-current' : ''}"${i === at ? ' aria-current="step"' : ''}>${label}</li>`).join('')}</ol><div class="kw-top-side kw-end">${close}</div></div>`;
  }
  /** Step 1: what Kinema is, in one picture of the three panes. */
  introHTML() {
    const pane = (art, title, text) => `<div class="kw-pane"><span class="kw-pane-art" aria-hidden="true">${art}</span><div><b>${title}</b><small>${text}</small></div></div>`;
    return `<div class="kw-intro"><div class="kw-mark">${kinemaMark}</div><h1>Make physics click.</h1><p class="kw-lead">Watch the problem move, ask your tutor about any step, and keep notes beside it.</p><div class="kw-panes">${pane(icon.orbit, 'See it move', 'Play, pause and reset the simulation')}${pane(icon.chat, 'Ask about a step', 'Your tutor explains the same picture')}${pane(icon.notes, 'Keep what matters', 'Notes sit beside the problem')}</div><button type="button" class="ka-primary kw-primary" data-kw="next">Get started</button>${this.skipHTML()}</div>`;
  }
  /** Step 2: four equal tutor choices; picking one opens the existing sign-in steps in place. */
  accountStepHTML() {
    const p = this.flow && this.find(this.flow);
    // Explore without AI stays available unless a sign-in is actually running.
    if (p) return `<section class="kw-flow" aria-live="polite">${this.signinHTML(p, true)}</section>${ACTIVE.includes(p.login?.state) ? '' : this.skipHTML()}`;
    const cards = TUTORS.map(id => {
      const c = this.find(id) || {id};
      const status = c.available === false ? 'Unavailable' : c.checking ? copy('checking','Checking…') : c.connected ? copy('signed_in_here','Signed in on this computer') : !c.installed && c.state ? copy('needs_app','Needs the free official app') : copy('sign_in','Sign in');
      return `<button type="button" class="kw-card"${c.available === false ? ' disabled aria-label="Google Gemini unavailable"' : ''} data-kw="pick" data-provider="${esc(id)}"><span class="kw-card-mark" data-provider-brand="${esc(brand(id))}">${mark(id)}</span><b>${esc(names[id])}</b><small class="kw-tool">${esc(tools[id])}</small><em>${status}</em></button>`;
    }).join('');
    return `<h1>Choose your tutor</h1><p class="kw-lead">Sign in with one account. Kinema uses it for the tutor and for new visuals.</p><div class="kw-cards">${cards}</div>${this.find('gemini-cli')?.available === false ? '<p class="ka-field-note ka-center">Google sign-in is unavailable.</p>' : ''}${this.skipHTML()}`;
  }
  /** Step 3: the connected account and the models it will use. Start learning opens the course step. */
  readyHTML(p) {
    const roles = this.models?.current?.roles || {};
    return `<div class="kw-done"><h1>Ready</h1><p class="ka-account-ready"><i></i>${copy('signed_in_with','Signed in with')} ${esc(names[p.id])}</p><dl class="ka-models"><div><dt>${copy('tutor','Tutor')}</dt><dd>${esc(choiceText(roles.chat))}</dd></div><div><dt>${copy('visuals_notes','Visuals and notes')}</dt><dd>${esc(choiceText(roles.build))}</dd></div></dl><p class="kw-why">${esc(this.whyText(roles))}</p><button type="button" class="ka-primary kw-primary" data-kw="start">${copy('start_learning','Start learning')}</button></div>`;
  }
  /** Explore without AI. Hidden once an account is in use, so a signed-in user cannot switch AI off by accident. */
  skipHTML() {
    return `<div class="kw-quiet"><button type="button" class="kw-skip" data-kw="skip">Explore without AI</button><p>Prepared lessons, formulas, worked examples and simulations work without signing in. The AI tutor and new generated visuals need an account.</p></div>`;
  }
  whyText(roles) {
    const tutor = choiceText(roles.chat), builder = choiceText(roles.build);
    const how = tutor && builder && tutor !== builder ? `${roles.chat.label || modelName(roles.chat.model)} answers quickly while you work; ${roles.build.label || modelName(roles.build.model)} takes more care building visuals and notes.` : 'Picked from the models your account can use.';
    return how + ' Change them any time from the model button under the message box.';
  }
  async welcomeAct(e) {
    const b = e.target.closest('[data-kw],[data-ka]'); if (!b || b.disabled) return;
    const action = b.dataset.kw || b.dataset.ka;
    if (action === 'close') return this.closeWelcome();
    if (action === 'retry') return this.run(async () => { await this.refresh(); this.loadFailed = false; }, 'Account details could not load. Try again.');
    if (action === 'skip') return this.run(async () => {
      this.browse(true); await this.completeOnboarding(); await this.courseStep(); this.closeWelcome();
      // A fresh install may have prepared lessons but no local Daily pack.
      let landing = 'path';
      try { if ((await this.api(this.url('/api/daily/peek')))?.id) landing = 'daily'; } catch {}
      this.t.host.querySelector(`.tv-nav [data-act="${landing}"]`)?.click();
    }, 'Could not continue. Try again.');
    if (action === 'next') { this.error = ''; this.notice = ''; this.step = 'account'; return this.paint(); }
    if (action === 'back') {
      this.error = ''; this.notice = '';
      if (this.step === 'ready') { this.step = 'account'; return this.paint(); }
      if (ACTIVE.includes(this.find(this.flow)?.login?.state)) await this.cliAction('cancel', this.flow);
      this.flow = null; this.notice = ''; this.step = 'welcome'; return this.paint();
    }
    if (action === 'start') return this.start();
    if (action === 'pick') {
      this.error = ''; this.notice = ''; const p = this.find(b.dataset.provider);
      if (p?.available === false) return;
      if (!p) { this.error = 'This sign-in is unavailable right now. Try again.'; return this.paint(); }
      this.flow = p.id; this.step = 'account'; this.paint();
      if (p.installed && p.supported && !p.connected && !ACTIVE.includes(p.login?.state) && p.login_mode !== 'terminal') return this.cliAction('login', p.id);
      return;
    }
    if (action === 'flow-back') { if (ACTIVE.includes(this.find(this.flow)?.login?.state)) await this.cliAction('cancel', this.flow); this.flow = null; this.error = ''; this.notice = ''; this.paint(); return; }
    return this.flowAct(action, b);
  }
  /** Record the first-run answer on the server when it asked for one; idempotent. */
  async completeOnboarding() {
    if (this.data?.onboarding_required) { try { await this.write('onboarding', {complete:true}); } catch {} }
    this.markOnboarded();
  }
  /** Ready → Start learning: make the chosen account the one Kinema uses, then the optional class step. */
  async start() {
    const pid = this.flow;
    return this.run(async () => {
      if (pid && this.active()?.id !== pid) await this.write('cli/' + encodeURIComponent(pid) + '/use');
      this.browse(false); await this.completeOnboarding(); await this.models?.load?.(); this.syncFooter();
      await this.courseStep(); this.closeWelcome();
    }, 'Could not start. Try again.');
  }
  /** Optional class step from the Settings page (settings_page.js), shown once inside the welcome. */
  async courseStep() {
    const profile = window.KinemaProfile, host = this.welcome?.querySelector('.kw-inner');
    if (!host || typeof profile?.askCourse !== 'function' || !profile.get?.() || profile.get().asked) return;
    this.asking = true; host.innerHTML = '';
    try { await profile.askCourse({host}); } catch {} finally { this.asking = false; }
  }
  async finishSignIn(pid) {
    // Sign-in succeeded: the server already saved the recommended models. Signing in is a choice to use AI.
    this.browse(false);
    await this.models?.load?.(); this.notice = ''; this.syncFooter();
    // Ready means a connected account only; an unverified login stays on the account step.
    if (this.welcome?.open && this.find(pid)?.connected) this.step = 'ready';
    if (this.data?.onboarding_required) { try { await this.write('onboarding', {complete:true}); } catch {} }
  }

  // ── Shared sign-in steps for welcome and Account ──────────────────────────────
  signinHTML(p, inWelcome = false) {
    const login = p.login || {}, active = ACTIVE.includes(login.state), name = names[p.id] || p.label;
    const back = inWelcome ? `<button type="button" class="kw-back" data-kw="flow-back">${icon.back}<span>${copy('other_options','Other options')}</span></button>` : '';
    const head = `${back}<div class="ka-provider-heading"><span class="ka-provider-icon" data-provider-brand="${esc(brand(p.id))}">${mark(p.id)}</span><div><h2>${copy('signin_with','Sign in with')} ${esc(name)}</h2><p>${esc(tools[p.id] || p.tool || '')}</p></div></div>`;
    if (p.available === false) return `${back}<div class="ka-provider-heading"><span class="ka-provider-icon" data-provider-brand="${esc(brand(p.id))}">${mark(p.id)}</span><div><h2>${esc(name)}</h2><p>Unavailable</p></div></div><p class="ka-intro">${esc(p.detail)}</p>`;
    const statusError = login.error || p.error || (['unsupported','check_failed','unsupported_account'].includes(p.state) ? p.detail : null);
    const error = statusError ? `<p class="ka-error">${esc(cleanError({message:statusError},'Sign-in could not finish. Try again.'))}</p>` : '';
    const guide = safeLink(p.setup_url);
    if (p.checking && !p.installed) return head + `<p class="ka-intro">${copy('checking_app','Checking this computer for the official app…')}</p>`;
    if (!p.installed) return head + `<p class="ka-intro">${copy('install_needed','Kinema signs in through the provider’s free official app. It is not on this computer yet.')}</p><button type="button" class="ka-primary" data-ka="install" data-provider="${esc(p.id)}"${this.installing === p.id ? ' disabled' : ''}>${this.installing === p.id ? copy('installing','Installing…') : copy('install_app','Install')+' '+esc(tools[p.id] || '')}</button><p class="ka-field-note ka-after-command">${copy('install_consent','Runs the official installer. It may take a minute.')}${guide ? ` <a class="ka-guide" href="${esc(guide)}" target="_blank" rel="noopener noreferrer">${copy('install_guide','Setup guide')} ↗</a>` : ''}</p>${error}`;
    if (p.connected) {
      const using = this.data?.account?.provider === p.id;
      return head + `<p class="ka-account-ready"><i></i>${copy('signed_in_here','Signed in on this computer')}</p>${using && !inWelcome ? `<p class="ka-field-note">${copy('tutoring_with_this','Kinema is using this account.')}</p>` : `<button type="button" class="ka-primary" data-ka="use" data-provider="${esc(p.id)}">${copy('continue_with','Continue with')} ${esc(name)}</button>`}${error}`;
    }
    if (active) {
      const url = safeLink(login.url);
      const text = p.login_mode === 'window' ? copy('window_finish','Finish signing in on the Google page. Kinema continues by itself when Google confirms.')
        : p.login_mode === 'browser' ? copy('browser_finish','Finish signing in in the browser window that opened. Kinema continues by itself.')
        : login.code && url ? copy('device_finish','Open the sign-in page and enter this code. Kinema continues by itself.') : copy('device_preparing','Getting your sign-in code…');
      return head + `<p class="ka-intro">${text}</p>${login.code ? `<div class="ka-device-code" dir="ltr"><strong>${esc(login.code)}</strong><button type="button" data-ka="copy-code" data-provider="${esc(p.id)}">${copy('copy_command','Copy')}</button></div>` : ''}${url ? `<a class="ka-primary ka-login-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${copy('open_signin','Open sign-in page')} ↗</a>` : ''}<div class="ka-waiting" role="status"><span class="ka-spinner" aria-hidden="true"></span>${copy('waiting_signin','Waiting for sign-in…')}</div><div class="ka-connection-actions"><button type="button" data-ka="cli-check" data-provider="${esc(p.id)}">${copy('check_signin','Check now')}</button><button type="button" data-ka="cli-cancel" data-provider="${esc(p.id)}">${copy('cancel_signin','Cancel')}</button></div>`;
    }
    if (p.login_mode === 'terminal') return head + `<p class="ka-intro">${copy('terminal_signin','Open Terminal, run this command and follow the sign-in steps. Then come back here.')}</p><div class="ka-command" dir="ltr"><code>${esc(p.login_command || '')}</code><button type="button" data-ka="copy-command" data-provider="${esc(p.id)}">${copy('copy_command','Copy')}</button></div><button type="button" class="ka-primary" data-ka="cli-check" data-provider="${esc(p.id)}">${copy('check_signin','Check sign-in')}</button>${error}`;
    const lead = p.id === 'gemini-cli' && p.login_mode === 'window' ? copy('google_start','Google’s official sign-in window opens. Kinema never sees your password.') : p.login_mode === 'device' ? copy('device_start','You’ll get a short code to enter on the provider’s page. Kinema never sees your password.') : copy('browser_start','Your browser opens the provider’s sign-in page. Kinema never sees your password.');
    return head + `<p class="ka-intro">${lead}</p><button type="button" class="ka-primary" data-ka="cli-login" data-provider="${esc(p.id)}"${(p.allowed_actions || []).includes('login') ? '' : ' disabled'}>${copy('sign_in','Sign in')}</button>${p.checking ? `<p class="ka-field-note ka-center">${copy('checking','Checking…')}</p>` : `<button type="button" class="ka-subtle" data-ka="cli-check" data-provider="${esc(p.id)}">${copy('already_signin','Already signed in? Check')}</button>`}${error}`;
  }
  async cliAction(path, pid, body = {}) {
    return this.run(async () => {
      this.notice = ''; // a new login or check replaces any earlier cancellation or pending notice
      const data = await this.write('cli/' + encodeURIComponent(pid) + '/' + path, body);
      if (path === 'use') { this.browse(false); await this.models?.load?.(); this.applied = data.applied; }
      const p = this.find(pid);
      if (path === 'check' && !p?.connected) this.notice = this.translate('signin_pending','Sign-in is not confirmed yet. Finish the provider’s steps, then check again.');
      if (path === 'cancel') this.notice = this.translate('signin_cancelled','Sign-in cancelled.');
      // A verified connection from the welcome's own login or check moves to Ready now, not on a later background poll.
      const welcomeFlow = this.welcome?.open && this.flow === pid;
      if ((path === 'login' || path === 'check') && p?.connected && welcomeFlow) await this.finishSignIn(pid);
      else if (path === 'login' && p?.login?.state === 'succeeded') await this.finishSignIn(pid);
      this.pollUntil = 0; this.watch();
    }, this.translate('signin_failed','Could not complete sign-in. Try again.'));
  }
  async flowAct(action, b) {
    const pid = b.dataset.provider;
    if (action === 'cli-login') return this.cliAction('login', pid);
    if (action === 'cli-check') return this.cliAction('check', pid);
    if (action === 'cli-cancel') return this.cliAction('cancel', pid);
    if (action === 'use') {
      await this.cliAction('use', pid);
      if (this.welcome?.open) { await this.finishSignIn(pid); this.paint(); return; }
      else this.notice = this.applied && Object.keys(this.applied).length ? this.translate('using_account','Kinema now tutors with this account.') : this.translate('using_kept','Kinema uses this account. Your saved model choices are kept.');
      this.paint(); return;
    }
    if (action === 'install') {
      this.installing = pid; this.paint();
      try {
        await this.api(this.url('/api/connections/updates/' + encodeURIComponent(pid)), {method:'POST', headers:{'Content-Type':'application/json','X-Kinema-Connection-Token':this.data.token}, body:JSON.stringify({confirm:true,_connection_token:this.data.token})});
        const until = Date.now() + 15 * 60000;
        while (Date.now() < until) {
          await new Promise(r => setTimeout(r, 2000));
          const job = (await this.api(this.url('/api/connections/updates'))).apps.find(a => a.id === pid)?.job;
          if (job?.state !== 'running') { if (job?.state === 'failed') this.error = job.error; break; }
        }
        await this.refresh();
      } catch (e) { this.error = cleanError(e, 'The installer could not start. Use the setup guide.'); }
      this.installing = null; this.paint(); return;
    }
    if (action === 'copy-code' || action === 'copy-command') {
      const p = this.find(pid), value = action === 'copy-code' ? p?.login?.code : p?.login_command;
      if (!value) return;
      try { await navigator.clipboard.writeText(value); b.innerHTML = copy('copied','Copied'); }
      catch { this.error = this.translate('copy_failed','Copy is unavailable. Select the text and copy it manually.'); this.paint(); }
    }
  }

  // ── Settings › Account ────────────────────────────────────────────────────────
  async open(view = 'account', {more = false} = {}) {
    this.closeMenu(); this.clearKeys();
    this.view = view === 'welcome' ? 'account' : view; this.providerId = null; this.connectionKind = 'cli'; this.advanced = false; this.more = more; this.switching = false; this.error = ''; this.notice = ''; this.selection = null; this.confirmSignout = null;
    if (!this.dialog) {
      const dialog = document.createElement('dialog'); this.dialog = dialog; dialog.className = 'ka-dialog'; dialog.dataset.localize = 'account'; dialog.setAttribute('aria-label', 'Account'); document.body.append(dialog);
      dialog.addEventListener('click', e => this.act(e)); dialog.addEventListener('submit', e => { if (e.target.matches('[data-ka-connect]')) { e.preventDefault(); this.connect(e.target); } });
      dialog.addEventListener('input', e => { if (e.target.matches('[data-ka-model-search]')) { this.query = e.target.value; this.modelOptions(); } });
      dialog.addEventListener('change', e => this.change(e));
      dialog.addEventListener('close', () => { dialog.querySelectorAll('input[type=password]').forEach(input => { input.value = ''; }); if (this.dialog === dialog) { this.dialog = null; this.updates?.stop(); } dialog.remove(); });
      dialog.showModal();
    }
    // Opens at once from the last known status; rows update as background checks finish.
    this.render();
    if (!this.data) { try { await this.refresh(); } catch (e) { this.error = cleanError(e, 'Could not load your account. Try again.'); } this.render(); }
    this.refresh(true).then(() => this.watch()).catch(() => {});
    const active = this.active();
    if (active) this.readUsage(true, 3);
  }
  readUsage(force, tries) {
    loadUsage(this.api, this.url, force).then(u => {
      this.usage = u; this.paint();
      if (u?.refreshing && tries) setTimeout(() => this.readUsage(true, tries - 1), 2500);
    }).catch(() => {});
  }
  close() { this.clearKeys(); const dialog = this.dialog; this.dialog = null; this.updates?.stop(); dialog?.close(); dialog?.remove(); }
  clearKeys() { this.dialog?.querySelectorAll('input[type=password]').forEach(input => { input.value = ''; }); }
  provider() { return (this.connectionKind === 'cli' ? this.cli() : this.data?.providers)?.find(p => p.id === this.providerId); }
  render() {
    const dialog = this.dialog; if (!dialog?.open) return;
    const focus = document.activeElement?.dataset?.ka, scroll = dialog.scrollTop, updatesEl = dialog.querySelector('[data-updates]');
    const provider = this.provider();
    const body = !this.data ? `<div class="ka-loading" role="status">${copy('loading','Loading…')}</div>` : this.confirmSignout ? this.signoutHTML(this.find(this.confirmSignout)) : provider ? (this.connectionKind === 'cli' ? this.signinHTML(provider) : this.providerHTML(provider)) : this.accountHTML();
    dialog.innerHTML = `<header class="ka-top">${provider || this.confirmSignout ? `<button type="button" class="ka-icon" data-ka="back" aria-label="Back">${icon.back}</button>` : '<span class="ka-brand-label">KINEMA</span>'}<div class="ka-top-space"></div><button type="button" class="ka-icon" data-ka="close" aria-label="Close">${icon.close}</button></header><div class="ka-content">${body}<p class="ka-error" role="alert"${this.error ? '' : ' hidden'}>${esc(this.error || '')}</p><p class="ka-notice" role="status"${this.notice ? '' : ' hidden'}>${esc(this.notice || '')}</p></div>`;
    const slot = dialog.querySelector('[data-updates]');
    if (slot) { if (updatesEl) slot.replaceWith(updatesEl); else this.updates = mountUpdates(slot, {api:this.api, url:this.url, token:() => this.token()}); }
    if (this.busy) dialog.querySelectorAll('button,input,select').forEach(el => { if (el.dataset.ka !== 'close') el.disabled = true; });
    dialog.scrollTop = scroll;
    if (focus) dialog.querySelector(`[data-ka="${CSS.escape(focus)}"]`)?.focus({preventScroll:true});
  }
  rowHTML(p) {
    const status = p.available === false ? 'Unavailable' : p.checking ? copy('checking','Checking…') : p.connected ? copy('signed_in','Signed in') : ACTIVE.includes(p.login?.state) ? copy('signing_in','Signing in…') : p.installed ? copy('sign_in','Sign in') : copy('setup','Set up');
    return `<button type="button" class="ka-provider-row" data-ka="provider" data-kind="cli" data-provider="${esc(p.id)}"><span class="ka-provider-icon" data-provider-brand="${esc(brand(p.id))}">${mark(p.id)}</span><span class="ka-provider-name">${esc(names[p.id] || p.label)}<small>${esc(tools[p.id] || p.tool || '')}</small></span><span class="${p.connected ? 'ka-connected' : 'ka-connect-label'}">${p.connected ? '<i></i>' : ''}${status}</span>${icon.arrow}</button>`;
  }
  accountHTML() {
    const active = this.active(), roles = this.models?.current?.roles || {}, cli = this.cli();
    const primary = cli.filter(p => p.tier === 'primary' && p.id !== active?.id), more = cli.filter(p => p.tier === 'more');
    const current = active ? `<section class="ka-current-account"><div class="ka-current-head"><span class="ka-provider-icon" data-provider-brand="${esc(brand(active.id))}">${mark(active.id)}</span><div><b>${esc(nameOf(active))}</b><small>${esc(toolOf(active))}</small></div><span class="ka-connected"><i></i>${copy('signed_in','Signed in')}</span></div>${usageHTML(this.usage)}<dl class="ka-models"><div><dt>${copy('tutor','Tutor')}</dt><dd>${esc(choiceText(roles.chat))}</dd></div><div><dt>${copy('visuals_notes','Visuals and notes')}</dt><dd>${esc(choiceText(roles.build))}</dd></div></dl>${this.browseOnly ? `<p class="ka-field-note">Explore without AI is on. Kinema won’t use this account until AI is turned back on.</p><div class="ka-connection-actions"><button type="button" data-ka="use-ai">Turn AI back on</button></div>` : ''}<div class="ka-connection-actions"><button type="button" data-ka="models">${copy('change_models','Change models')}</button><button type="button" data-ka="switch" aria-expanded="${!!this.switching}">${copy('switch_account','Switch account')}</button>${(active.allowed_actions || []).includes('signout') ? `<button type="button" data-ka="signout" data-provider="${esc(active.id)}">${copy('sign_out','Sign out')}</button>` : ''}</div></section>` : `<p class="ka-intro">${copy('signin_prompt','Sign in with one account to use the tutor, worked lessons and visuals.')}</p>`;
    const list = !active || this.switching ? `<div class="ka-providers">${primary.map(p => this.rowHTML(p)).join('')}</div>` : '';
    const moreList = `<button type="button" class="ka-advanced-toggle" data-ka="more" aria-expanded="${!!this.more}">${copy('more_options','More sign-in options')}<span aria-hidden="true">${this.more ? '−' : '+'}</span></button>${this.more ? `<div class="ka-advanced"><div class="ka-providers">${more.map(p => this.rowHTML(p)).join('')}</div></div>` : ''}`;
    const api = this.data?.providers || [];
    const advanced = `<button type="button" class="ka-advanced-toggle" data-ka="advanced" aria-expanded="${!!this.advanced}">${copy('advanced_api','Advanced · API keys')}<span aria-hidden="true">${this.advanced ? '−' : '+'}</span></button>${this.advanced ? `<div class="ka-advanced"><p class="ka-billing">${copy('api_billing_intro','Connect with an API key. API access may be billed separately from your provider’s chat subscription.')}</p><div class="ka-providers">${api.map(p => `<button type="button" class="ka-provider-row" data-ka="provider" data-kind="api" data-provider="${esc(p.id)}"><span class="ka-provider-icon" data-provider-brand="${esc(p.id)}">${providerMark(p.id)}</span><span class="ka-provider-name">${esc(p.label)}</span><span class="${p.connected ? 'ka-connected' : 'ka-connect-label'}">${p.connected ? '<i></i>' + copy('account_ready','Ready') : copy('connect','Connect')}</span>${icon.arrow}</button>`).join('')}</div></div>` : ''}`;
    return `<h1>${copy('account','Account')}</h1>${current}${list}${moreList}<h2 class="ka-section">${copy('updates','Apps and updates')}</h2><div data-updates></div><h2 class="ka-section">${copy('language','Language')}</h2><button type="button" class="ka-provider-row ka-language-row" data-ka="language"><span class="ka-provider-icon">${icon.globe}</span><span class="ka-provider-name">${copy('language_choose','App and tutor language')}</span>${icon.arrow}</button>${advanced}<p class="ka-welcome-link"><button type="button" class="ka-subtle" data-ka="welcome">Show the welcome guide</button></p>`;
  }
  signoutHTML(p) {
    const name = tools[p?.id] || '';
    return `<h1>${copy('signout_title','Sign out of')} ${esc(name)}?</h1><p class="ka-intro">${copy('signout_body','This signs')} ${esc(name)} ${copy('signout_body2','out on this computer, including other apps that use it. Your Kinema work is kept.')}</p><button type="button" class="ka-primary ka-danger" data-ka="signout-confirm" data-provider="${esc(p?.id || '')}">${copy('sign_out','Sign out')}</button><button type="button" class="ka-subtle" data-ka="back">${copy('cancel','Cancel')}</button>`;
  }
  providerHTML(provider) {
    const statusError = provider.error ? `<p class="ka-error">${esc(cleanError({message:provider.error},'This connection needs to be checked.'))}</p>` : '';
    if (!provider.connected) {
      const secure = this.data?.storage?.available; if (!secure && this.keyMode === 'secure') this.keyMode = 'session';
      return `<div class="ka-provider-heading"><span class="ka-provider-icon">${providerMark(provider.id)}</span><div><h1>Connect ${esc(provider.label)}</h1><p>Use your ${esc(provider.label)} API key.</p></div></div>${statusError}<form data-ka-connect><label class="ka-field"${this.keyMode === 'environment' ? ' hidden' : ''}>API key<input type="password" name="api-key" autocomplete="new-password" autocapitalize="off" spellcheck="false" placeholder="Paste your API key"${this.keyMode === 'environment' ? '' : ' required'}></label><label class="ka-field">Keep this connection<select data-ka-storage name="storage">${secure ? `<option value="secure"${this.keyMode === 'secure' ? ' selected' : ''}>Securely on this device</option>` : ''}<option value="session"${this.keyMode === 'session' ? ' selected' : ''}>Until Kinema closes</option><option value="environment"${this.keyMode === 'environment' ? ' selected' : ''}>Use an environment key</option></select></label><p class="ka-field-note">${this.keyMode === 'environment' ? 'Kinema checks the provider key already configured on this device.' : this.keyMode === 'session' ? 'The key stays in memory for this app session.' : 'Your key is protected by this device’s secure storage.'}</p><button type="submit" class="ka-primary">${this.busy ? 'Checking connection…' : 'Connect ' + esc(provider.label)}</button></form><p class="ka-billing">Connecting checks access; it does not generate a reply. API usage may have separate provider billing.</p>`;
    }
    return `<div class="ka-provider-heading"><span class="ka-provider-icon" data-provider-brand="${esc(provider.id)}">${providerMark(provider.id)}</span><div><h1>${esc(provider.label)}</h1><p class="ka-connected"><i></i>Connected${provider.source === 'session' ? ' for this session' : ''}</p></div></div>${statusError}${this.modelFieldsHTML(provider)}<div class="ka-connection-actions"><button type="button" data-ka="verify">${this.busy ? 'Checking…' : 'Recheck connection'}</button><button type="button" data-ka="disconnect">Disconnect</button></div>`;
  }
  modelFieldsHTML(provider) {
    const models = provider.models || [], selected = models.find(m => m.id === this.selectedModel);
    return `<p class="ka-intro">Choose a model for tutoring.</p>${models.length ? `<div class="ka-model-fields"><label class="ka-field">Model${models.length > 8 ? `<input type="search" data-ka-model-search placeholder="Search models" aria-label="Search provider models" value="${esc(this.query || '')}">` : ''}<select data-ka-model aria-label="Tutoring model">${this.optionsHTML(models)}</select></label><div class="ka-effort-slot">${this.effortHTML(selected)}</div><button type="button" class="ka-primary" data-ka="select"${selected ? '' : ' disabled'}>${this.busy ? 'Saving…' : 'Use for tutoring'}</button></div>` : '<p class="ka-field-note">No supported models were returned. Recheck the connection to update the list.</p>'}`;
  }
  optionsHTML(models) {
    const q = (this.query || '').trim().toLocaleLowerCase(), matches = models.filter(m => !q || [m.label, m.id].join(' ').toLocaleLowerCase().includes(q)), rows = matches.slice(0, 60);
    const selected = models.find(m => m.id === this.selectedModel); if (selected && !rows.some(m => m.id === selected.id)) rows.unshift(selected);
    return '<option value="">Choose a model</option>' + rows.map(m => `<option value="${esc(m.id)}"${m.id === this.selectedModel ? ' selected' : ''}>${esc(m.label || modelName(m.id))}</option>`).join('') + (matches.length > 60 ? '<option disabled>Search to see more models</option>' : '');
  }
  modelOptions() { const select = this.dialog?.querySelector('[data-ka-model]'); if (select) select.innerHTML = this.optionsHTML(this.provider()?.models || []); }
  effortHTML(model) {
    if (!model) return '';
    const levels = model.efforts || ['default']; if (!levels.includes(this.effort)) this.effort = defaultEffort(model);
    return levels.length > 1 ? `<label class="ka-field">Thinking effort<select data-ka-effort>${levels.map(e => `<option value="${esc(e)}"${e === this.effort ? ' selected' : ''}>${esc(effortLabel(e, model.id))}</option>`).join('')}</select></label>` : `<p class="ka-field-note">${esc(effortLabel(levels[0], model.id))} effort</p>`;
  }
  change(event) {
    const el = event.target;
    if (el.matches('[data-ka-storage]')) { this.keyMode = el.value; this.render(); }
    if (el.matches('[data-ka-model]')) { this.selectedModel = el.value; this.effort = defaultEffort(this.provider()?.models.find(m => m.id === el.value)); this.dialog.querySelector('.ka-effort-slot').innerHTML = this.effortHTML(this.provider()?.models.find(m => m.id === el.value)); this.dialog.querySelector('[data-ka=select]').disabled = !el.value; }
    if (el.matches('[data-ka-effort]')) this.effort = el.value;
    if (el.matches('[data-ka-all-roles]')) this.allRoles = el.checked;
  }
  async write(path, body = {}) {
    const data = await this.api(this.url('/api/connections/' + path), {method:'POST', headers:{'Content-Type':'application/json','X-Kinema-Connection-Token':this.data.token}, body:JSON.stringify({...body,_connection_token:this.data.token})});
    this.accept(data); return data;
  }
  async run(action, fallback) {
    if (this.busy) return; this.busy = true; this.error = ''; this.notice = ''; this.paint();
    try { await action(); } catch (e) { this.error = cleanError(e, fallback); } finally { this.busy = false; this.paint(); }
  }
  async connect(form) {
    if (this.busy) return;
    const provider = this.provider(), key = form.querySelector('[name=api-key]').value, storage = form.querySelector('[name=storage]').value;
    this.clearKeys();
    await this.run(async () => { await this.write(encodeURIComponent(provider.id) + '/connect', {api_key:key, storage}); if (!this.data.providers.find(p => p.id === provider.id)?.connected) throw new Error('The connection was not verified. Please check your key and try again.'); this.notice = 'Connected. Choose a model when you are ready.'; await this.models?.load?.(); }, 'Could not connect. Check your API key and try again.');
  }
  async chooseModel() {
    const provider = this.provider(), model = provider?.models.find(m => m.id === this.selectedModel); if (!model) return;
    await this.run(async () => {
      for (const role of this.allRoles ? ['chat','build','notes'] : ['chat']) await this.write(encodeURIComponent(provider.id) + '/select', {model:model.id, role, effort:this.effort || defaultEffort(model), speed:'standard'});
      await this.models?.load?.(); this.syncFooter(); this.notice = 'Model selected.';
    }, 'Could not save the model selection. Try again.');
  }
  async act(event) {
    const button = event.target.closest('[data-ka]'); if (!button) return; const action = button.dataset.ka;
    if (action === 'close') return this.close();
    if (this.busy) return;
    if (action === 'language') return this.language();
    if (action === 'advanced') { this.advanced = !this.advanced; this.render(); return; }
    if (action === 'more') { this.more = !this.more; this.render(); return; }
    if (action === 'welcome') { this.close(); return this.openWelcome({optional:true}); }
    if (action === 'use-ai') { const a = this.active(); return a && this.useAccount(a.id, a.key_url ? 'api' : 'cli'); }
    if (action === 'switch') { this.switching = !this.switching; this.render(); return; }
    if (action === 'models') { this.close(); return this.models?.manage?.(); }
    if (action === 'provider') { this.clearKeys(); this.providerId = button.dataset.provider; this.connectionKind = button.dataset.kind || 'api'; this.selectedModel = ''; this.query = ''; this.allRoles = false; this.error = ''; this.notice = ''; this.render(); return; }
    if (action === 'back') { this.clearKeys(); this.providerId = null; this.confirmSignout = null; this.error = ''; this.notice = ''; this.render(); return; }
    if (action === 'signout') { this.confirmSignout = button.dataset.provider; this.render(); return; }
    if (action === 'signout-confirm') return this.run(async () => { await this.write('cli/' + encodeURIComponent(button.dataset.provider) + '/signout', {confirm:true}); this.confirmSignout = null; this.usage = null; await this.models?.load?.(); this.notice = this.translate('signed_out','Signed out. Your Kinema work is kept.'); }, 'Could not sign out. Try again.');
    if (action === 'select') return this.chooseModel();
    if (action === 'verify') return this.run(async () => { await this.write(encodeURIComponent(this.providerId) + '/verify'); await this.models?.load?.(); this.notice = this.provider()?.connected ? 'Connection checked.' : 'The connection is unavailable. Please connect again.'; }, 'Could not verify this connection. Try again.');
    if (action === 'disconnect') return this.run(async () => { await this.write(encodeURIComponent(this.providerId) + '/disconnect'); await this.models?.load?.(); this.notice = 'Disconnected. Your conversations are kept.'; this.selectedModel = ''; }, 'Could not disconnect. Try again.');
    return this.flowAct(action, button);
  }

  /** Gentle prompt for AI features when no account is signed in. Returns true when signed in. */
  promptSignIn() {
    if (this.signedIn) return true;
    this.open('account'); this.notice = this.translate('signin_for_ai','Sign in with one account to use this. Daily problems and notes work without it.'); this.render();
    return false;
  }
}
