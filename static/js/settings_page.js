// Settings (1.28): the bottom-left profile chip, its small menu, the full Settings page and the optional class step.
// Owner 2026-10-16: "bottom left is ur profile … settings under it … account connections logins … check for update".
// Lane D's account and harness-update panels mount into [data-mount] slots through window.KinemaAccount when present;
// otherwise each slot shows a plain fallback that still works with the existing AccountPanel.
import { esc } from './md.js';
import { controlIcon } from './icons.js';
import { LearningProgress } from './learning_progress.js';

const SECTIONS = [['profile','Profile'],['progress','Learning progress'],['account','Accounts'],['reading','Reading & language'],['daily','Daily problem'],['updates','Updates']];
const PROVIDER = { codex: 'ChatGPT', claude: 'Claude', 'gemini-cli': 'Google Gemini', 'kimi-cli': 'Kimi' };
const ICON = {
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  key: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="M10.8 12.2 20 3M16 7l3 3M14 9l2 2"/></svg>',
};

const json = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const initial = name => (String(name || '').trim()[0] || 'Y').toUpperCase();
const when = ts => ts ? new Date(ts * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

export class SettingsPage {
  constructor({ teacher, api, url, toast, languages, accountPanel, models, readSizes, version }) {
    Object.assign(this, { teacher, api, url, toast, languages, accountPanel, models, readSizes: readSizes || [], version });
    this.data = null; this.update = null; this.section='profile'; this.reminder=null; this.reminderError='';
    this.progress = new LearningProgress({ api, url, onChange: map => { if (Array.isArray(map?.chapters)) teacher.chMap = map.chapters; } });
    this.page = document.querySelector('#settings');
    this.page.addEventListener('click', e => this.click(e));
    this.page.addEventListener('change', e => this.change(e));
    this.chipHost = document.createElement('div'); this.chipHost.className = 'kp-me';
    this.chipHost.innerHTML = '<button type="button" class="kp-chip" aria-haspopup="menu" aria-expanded="false"><span class="kp-av" aria-hidden="true">Y</span><span class="kp-who"><span class="kp-name">You</span><small class="kp-sub"></small></span></button>';
    teacher.host.querySelector('.tv-side')?.append(this.chipHost);
    this.chip = this.chipHost.querySelector('button');
    this.chip.addEventListener('click', () => this.toggleMenu());
    window.KinemaProfile = { askCourse: opts => this.askCourse(opts), get: () => this.data?.profile || null, openSettings: section => this.open(section) };
  }
  async init() { await this.load().catch(() => {}); this.paintChip(); return this; }
  async load() { this.data = await this.api(this.url('/api/profile')); this.paintChip(); return this.data; }
  get profile() { return this.data?.profile || {}; }
  classOf(id) { return this.data?.classes?.find(c => c.id === id); }
  courseLine(p = this.profile) {
    const c = this.classOf(p.course); if (!c) return '';
    return [c.id === 'other' ? '' : c.id, p.chapter ? 'Ch ' + p.chapter : ''].filter(Boolean).join(' · ');
  }
  paintChip() {
    const p = this.profile, name = p.name || 'You';
    this.chip.querySelector('.kp-av').textContent = initial(p.name);
    this.chip.querySelector('.kp-name').textContent = name;
    const sub = this.chip.querySelector('.kp-sub'); sub.textContent = this.courseLine(); sub.hidden = !sub.textContent;
    this.chip.setAttribute('aria-label', `${name}: profile and settings`);
  }

  // ── chip menu ───────────────────────────────────────────────────────────────────────────────────────────────
  connected() { const d = this.accountPanel?.data; return [...(d?.cli?.providers || []), ...(d?.providers || [])].filter(p => p.connected); }
  signedIn() {
    const all = this.connected(), model = this.models?.current?.roles?.chat?.model;
    return all.find(p => p.models?.some(m => m.id === model)) || all[0];
  }
  toggleMenu() {
    if (this.pop) return this.closeMenu();
    const pop = document.createElement('div'); this.pop = pop;
    pop.className = 'kp-menu'; pop.setAttribute('popover', 'auto'); pop.setAttribute('role', 'menu');
    const who = this.signedIn();
    pop.innerHTML = `<div class="kp-menu-head"><span class="kp-av" aria-hidden="true">${esc(initial(this.profile.name))}</span><span><b>${esc(this.profile.name || 'You')}</b><small>${esc(who ? PROVIDER[who.id] || who.label || 'Signed in' : 'Not signed in')}</small></span></div>
      <button type="button" role="menuitem" data-kp="settings">${ICON.gear}<span>Settings</span></button>
      <button type="button" role="menuitem" data-kp="account">${ICON.key}<span>${who ? 'Account' : 'Sign in'}</span></button>`;
    document.body.append(pop);
    pop.addEventListener('click', e => { const a = e.target.closest('[data-kp]')?.dataset.kp; if (!a) return; this.closeMenu(); if (a === 'progress') this.open('progress'); else if (a === 'settings') this.open(); else if (who) this.open('account'); else this.signIn(); });
    pop.addEventListener('toggle', e => { if (e.newState === 'closed' && this.pop === pop) this.closeMenu(); });
    pop.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); this.closeMenu(true); }
      if (['ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); const rows = [...pop.querySelectorAll('button')], i = rows.indexOf(document.activeElement); rows[(i + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus(); }
    });
    pop.showPopover?.(); this.chip.setAttribute('aria-expanded', 'true');
    const r = this.chip.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8)) + 'px';
    pop.style.top = Math.max(8, r.top - pop.offsetHeight - 6) + 'px';
    pop.querySelector('button').focus();
  }
  closeMenu(focus = false) { this.pop?.remove(); this.pop = null; this.chip.setAttribute('aria-expanded', 'false'); if (focus) this.chip.focus(); }
  signIn() {
    if (window.KinemaAccount?.openSignIn) return window.KinemaAccount.openSignIn();
    return this.accountPanel?.open('connections');
  }

  // ── page ────────────────────────────────────────────────────────────────────────────────────────────────────
  open(section) {
    this.section = ({language:'reading',about:'updates'}[section]||section||this.section);if(!SECTIONS.some(([id])=>id===this.section))this.section='profile';
    this.teacher.closeDrawer?.();
    if (this.teacher.page === 'settings') { if (section === 'progress') this.progress.leave(); this.render(); if (section === 'progress' && !this.progress.loading) this.progress.load(); return; }
    this.teacher.openPage('settings');   // app.js onPage('settings') calls enter()
  }
  async enter() {
    this.render();
    const jobs = [this.progress.loading ? null : this.progress.load(), this.load(), this.loadReminder(), this.api(this.url('/api/update')).then(d => { this.update = d; }),
      this.accountPanel?.data ? null : this.accountPanel?.refresh?.()].filter(Boolean);
    await Promise.allSettled(jobs);
    if (this.teacher.page === 'settings') this.render();
  }
  leave() { clearTimeout(this.pollT); this.feedDraft = null; this.progress.leave(); }
  render() {
    const keep = this.teacher.el.page.scrollTop;
    const a = document.activeElement?.closest?.('#settings') ? document.activeElement : null, active = a?.dataset.st ? `[data-st="${a.dataset.st}"]${a.dataset.v != null ? `[data-v="${CSS.escape(a.dataset.v)}"]` : ''}${a.dataset.role ? `[data-role="${a.dataset.role}"]` : ''}` : null;
    const [id,label]=SECTIONS.find(([id])=>id===this.section)||SECTIONS[0];
    const content=this[id+'HTML']()+(id==='reading'?this.languageHTML():id==='updates'?this.aboutHTML():'');
    this.page.innerHTML=`<div class="st-wrap"><h1 class="pg-h">Settings</h1><nav class="st-index" aria-label="Settings categories">${SECTIONS.map(([key,name])=>`<button type="button" data-st-go="${key}" aria-current="${key===id?'page':'false'}">${name}</button>`).join('')}</nav><div class="st-col"><section class="st-sec" id="st-${id}" aria-labelledby="st-h-${id}"><h2 id="st-h-${id}">${label}</h2>${content}</section></div></div>`;
    this.mount('account'); this.mount('updates');
    const progress=this.page.querySelector('[data-learning-progress]');
    if(progress)this.progress.mount(progress);else this.progress.host=null;
    if(active)this.page.querySelector(active)?.focus({preventScroll:true});
    this.teacher.el.page.scrollTop=keep;
  }

  /* lane D: window.KinemaAccount.mountAccount(el) / mountUpdates(el) render into these slots and may return a cleanup */
  mount(kind) {
    const el = this.page.querySelector(`[data-mount="${kind}"]`); if (!el) return;
    const fn = kind === 'account' ? window.KinemaAccount?.mountAccount : window.KinemaAccount?.mountUpdates;
    if (typeof fn !== 'function') return;
    try { el.innerHTML = ''; el.classList.add('is-mounted'); fn.call(window.KinemaAccount, el); }
    catch (e) { el.classList.remove('is-mounted'); el.innerHTML = this.fallback(kind); }
  }
  row(label, help, control, cls = '') { return `<div class="st-row ${cls}"><div class="st-label"><span>${label}</span>${help ? `<small>${help}</small>` : ''}</div><div class="st-ctl">${control}</div></div>`; }
  seg(name, items, on) { return `<div class="pg-seg st-seg" role="radiogroup">${items.map(([v, l]) => `<button type="button" role="radio" data-st="${name}" data-v="${esc(v)}" aria-checked="${String(String(v) === String(on))}">${esc(l)}</button>`).join('')}</div>`; }

  profileHTML() {
    if (!this.data) return '<p class="st-quiet">Loading your profile…</p>';
    const p = this.profile, c = this.classOf(p.course);
    const classes = [...this.data.classes.map(x => [x.id, x.id === 'other' ? 'Other' : x.id]), ['', 'Not set']];
    const chapters = c ? `<select data-st="chapter" aria-label="Current chapter"><option value="">Not set</option>${c.chapters.map(ch => `<option value="${ch.n}"${ch.n === p.chapter ? ' selected' : ''}>${ch.n} · ${esc(ch.title)}</option>`).join('')}</select>` : '<span class="st-quiet">Choose a class first</span>';
    const guess = c && c.id !== 'other' && !this.data.verified ? ' Chapter ranges are a best guess until your course confirms them.' : '';
    return this.row('Name', 'Shown at the bottom left. Stays on this computer.', `<input type="text" data-st="name" maxlength="40" placeholder="You" value="${esc(p.name || '')}" autocomplete="nickname">`)
      + this.row('Class', 'Choose your course, or study on your own.', this.seg('course', classes, p.course || ''))
      + this.row('Current chapter', 'The Daily problem comes from chapters up to this one.' + guess, chapters);
  }
  progressHTML() { return '<div data-learning-progress></div>'; }
  accountHTML() { return `<div class="st-mount" data-mount="account">${this.fallback('account')}</div>`; }
  fallback(kind) {
    if (kind === 'updates') return '<p class="st-quiet">Install and update Codex, Claude Code and Kimi Code from Accounts.</p>';
    const all = this.connected(), tutor = this.signedIn();
    if (!all.length) return this.row('Not signed in', 'Sign in with ChatGPT, Claude or Kimi to use the tutor.', '<button type="button" class="st-btn st-primary" data-st="connections">Sign in</button>');
    return all.map((p, i) => this.row(esc(PROVIDER[p.id] || p.label || p.id), p === tutor ? 'Signed in · runs your tutor' : 'Signed in on this computer', i === 0 ? '<button type="button" class="st-btn" data-st="connections">Manage</button>' : '')).join('');
  }
  languageHTML() {
    const L = this.languages; if (!L?.catalog?.length) return '<p class="st-quiet">Languages are not available.</p>';
    const opt = (id, on) => L.catalog.map(x => `<option value="${esc(x.id)}"${x.id === on ? ' selected' : ''}>${esc(x.native)}${x.native !== x.name ? ' · ' + esc(x.name) : ''}</option>`).join('');
    return this.row('App language', 'Buttons, menus and pages.', `<select data-st="ui-lang" aria-label="App language">${opt('ui', L.language)}</select>`)
      + this.row('Tutor replies', 'The tutor can answer in another language.', `<select data-st="tutor-lang" aria-label="Tutor language"><option value="auto"${L.tutorLanguage === 'auto' ? ' selected' : ''}>Same as the app</option>${opt('tutor', L.tutorLanguage)}</select>`);
  }
  readingHTML() {
    const cur = Number(getComputedStyle(document.documentElement).getPropertyValue('--read')) || 1.2;
    return this.row('Text size', 'Makes chat, notes and formulas larger for reading from further away.', this.seg('read', this.readSizes.map(([v, l]) => [v, l]), cur))
      + `<p class="st-sample" style="font-size:calc(15px * ${cur})">A block slides down a ramp at angle θ. Gravity along the slope is <i>mg</i> sin θ.</p>`;
  }
  dailyHTML() {
    if (!this.data) return '';
    const p = this.profile, f = this.data.feed || {};
    let status = '';
    if (p.daily_source === 'feed') {
      status = f.state === 'ok' ? `Feed loaded ${when(f.fetched_ts)} · ${f.days} day${f.days === 1 ? '' : 's'}${f.today ? ', including today' : ', not today: Kinema picks today'}${f.rejected ? ` · ${f.rejected} skipped` : ''}`
        : f.state === 'error' ? `${esc(f.error || 'The feed could not be used.')} Kinema's own pick is used meanwhile.` : 'Checking the feed…';
    }
    return this.reminderHTML() + this.row('Source', 'Kinema picks from your chapters, or your class can publish one problem a day for everyone.', this.seg('source', [['kinema', 'Kinema'], ['feed', 'Class feed']], this.feedDraft != null ? 'feed' : p.daily_source || 'kinema'))
      + (p.daily_source === 'feed' || this.feedDraft != null ? this.row('Feed address', 'A link your instructor or department gives you.', `<form class="st-inline" data-st-form="feed"><input type="url" data-st="feed-url" placeholder="https://…/daily.json" value="${esc(this.feedDraft ?? p.feed_url ?? '')}" required><button type="submit" class="st-btn">${p.daily_source === 'feed' ? 'Save' : 'Use feed'}</button></form>${status ? `<small class="st-note${f.state === 'error' ? ' is-bad' : ''}" role="status">${status}${p.daily_source === 'feed' ? ' <button type="button" class="st-link" data-st="feed-check">Check now</button>' : ''}</small>` : ''}`) : '');
  }
  async loadReminder(){
    try{this.reminder=await this.api(this.url('/api/reminder'));this.reminderError='';}
    catch(e){this.reminderError='Could not load the reminder. '+(e.message||'');}
  }
  reminderHTML(){
    const r=this.reminder;
    if(!r)return `<p class="st-quiet" role="status">${esc(this.reminderError||'Loading reminder...')} ${this.reminderError?'<button class="st-btn" data-st="reminder-retry">Retry</button>':''}</p>`;
    const help=r.time?(r.scheduled?'Windows notification at '+r.time+'.': 'Time saved, but Windows has not scheduled it. Save again to schedule.'):'Off. An optional Windows notification on this computer.';
    return this.row('Daily reminder',help,`<div class="st-inline"><input type="time" data-st="reminder-time" aria-label="Reminder time" value="${esc(this.reminderDraft??r.time??'')}"><button type="button" class="st-btn" data-st="reminder-save" ${this.reminderSaving?'disabled':''}>Save</button>${r.time?`<button type="button" class="st-btn" data-st="reminder-off" ${this.reminderSaving?'disabled':''}>Turn off</button>`:''}</div>${this.reminderError?`<small role="alert" class="st-note is-bad">${esc(this.reminderError)}</small>`:''}`);
  }
  async saveReminder(time){
    if(this.reminderSaving)return;
    this.reminderSaving=true;this.reminderDraft=time;this.reminderError='';this.render();
    try{this.reminder={...await this.api(this.url('/api/reminder'),json({time})),time:time||null};this.reminderDraft=null;}
    catch(e){this.reminderError='Could not save the reminder. '+(e.message||'Try again.');}
    finally{this.reminderSaving=false;if(this.teacher.page==='settings')this.render();}
  }
  updatesHTML() {
    const u = this.update;
    let kinema;
    if (!u) kinema = this.row('Kinema', 'Checking…', '');
    else if (u.state === 'off') kinema = this.row('Kinema ' + esc(u.current), 'Install new releases using the setup guide. Your study data stays in its own folder.', '<a class="st-btn" href="https://github.com/Diamonqq/Kinema/releases/latest" target="_blank" rel="noopener">Latest release</a><a class="st-btn" href="https://github.com/Diamonqq/Kinema/blob/main/docs/PUBLIC-SETUP.md" target="_blank" rel="noopener">Setup guide</a>');
    else {
      const j = u.job || {}, busy = u.state === 'working' || j.state === 'checking';
      const line = busy ? ({ checking: 'Checking…', downloading: `Downloading${j.progress ? ' ' + Math.round(j.progress * 100) + '%' : '…'}`, verifying: 'Checking the download…', installing: 'Installing…', restarting: 'Restarting Kinema…' }[j.state] || 'Working…')
        : j.state === 'error' ? esc(j.error) : u.state === 'available' ? `Version ${esc(u.latest.version)} is ready${u.installable ? '' : ', but it has no checksum, so it can’t be installed'}.`
          : u.state === 'current' ? `Up to date · checked ${when(u.checked_ts)}` : u.state === 'error' ? esc(u.error) : 'Not checked yet';
      const btn = busy ? '' : u.state === 'available' && u.installable ? '<button type="button" class="st-btn st-primary" data-st="update-install">Update and restart</button>' : '<button type="button" class="st-btn" data-st="update-check">Check for updates</button>';
      kinema = this.row('Kinema ' + esc(u.current), line + (u.state === 'available' && u.latest?.notes && !busy ? `<details class="st-notes"><summary>What’s new</summary><p>${esc(u.latest.notes)}</p></details>` : ''), btn, j.state === 'error' ? 'is-bad' : '');
    }
    return kinema + '<h3 class="st-sub">AI helpers</h3><div class="st-mount" data-mount="updates">' + this.fallback('updates') + '</div>';
  }
  aboutHTML() {
    return this.row('Kinema ' + esc(this.update?.current || this.version || ''), 'A mechanics tutor with simulations. Your study work and saved problems stay on this computer.', '')
      + (this.update?.repo ? this.row('Source', esc(this.update.repo), `<a class="st-btn" href="https://github.com/${esc(this.update.repo)}" target="_blank" rel="noopener">GitHub</a>`) : '');
  }

  // ── actions ─────────────────────────────────────────────────────────────────────────────────────────────────
  async saveProfile(patch, quiet = false) {
    try { this.data = await this.api(this.url('/api/profile'), json(patch)); this.paintChip(); if (!quiet) this.flash('Saved'); return true; }
    catch (e) { this.toast?.(e.message || 'Could not save.', 6000); return false; }
    finally { if (this.teacher.page === 'settings') this.render(); }
  }
  flash(text) { const n = document.createElement('div'); n.className = 'st-flash'; n.setAttribute('role', 'status'); n.textContent = text; this.page.append(n); setTimeout(() => n.remove(), 1400); }
  async token() { if (!this.accountPanel?.data?.token) await this.accountPanel?.refresh?.(); return this.accountPanel?.data?.token || ''; }
  async updateAction(path) {
    try {
      const t = await this.token();
      this.update = await this.api(this.url('/api/update/' + path), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Kinema-Connection-Token': t }, body: '{}' });
    } catch (e) { this.toast?.(e.message || 'Could not reach the update service.', 6000); }
    this.render(); this.pollUpdate();
  }
  pollUpdate() {
    clearTimeout(this.pollT);
    const j = this.update?.job?.state;
    if (!['checking', 'downloading', 'verifying', 'installing', 'restarting'].includes(j)) return;
    this.pollT = setTimeout(async () => {
      try { this.update = await this.api(this.url('/api/update')); } catch { if (j === 'restarting') { this.pollT = setTimeout(() => location.reload(), 3000); return; } }
      if (this.teacher.page === 'settings') this.render(); this.pollUpdate();
    }, 900);
  }
  click(e) {
    const go = e.target.closest('[data-st-go]');
    if(go){e.preventDefault();this.section=go.dataset.stGo;this.teacher.el.page.scrollTop=0;this.render();this.page.querySelector(`[data-st-go="${this.section}"]`)?.focus({preventScroll:true});return;}
    const b = e.target.closest('button[data-st]'); if (!b) return;
    const k = b.dataset.st, v = b.dataset.v;
    if(k==='reminder-retry')return this.loadReminder().then(()=>this.render());
    if(k==='reminder-save'||k==='reminder-off'){const value=k==='reminder-off'?'':this.page.querySelector('[data-st=reminder-time]')?.value;if(k==='reminder-save'&&!value)return;return this.saveReminder(value);}
    if (k === 'course') return this.saveProfile({ course: v, asked: true });
    if (k === 'read') { this.teacher.setRead(Number(v)); return this.render(); }
    if (k === 'source') { if (v === 'kinema') { this.feedDraft = null; return this.saveProfile({ daily_source: 'kinema' }); } if (this.profile.feed_url) return this.saveProfile({ daily_source: 'feed' }); this.feedDraft = ''; this.render(); return this.page.querySelector('[data-st="feed-url"]')?.focus(); }
    if (k === 'feed-check') return this.api(this.url('/api/profile/feed/refresh'), { method: 'POST' }).then(d => { this.data = d; this.render(); }, err => this.toast?.(err.message, 6000));
    if (k === 'connections') return this.signIn();
    if (k === 'update-check') return this.updateAction('check');
    if (k === 'update-install') return this.updateAction('install');
  }
  async change(e) {
    const el = e.target, k = el.dataset.st;
    if(k==='reminder-time'){this.reminderDraft=el.value;return;}
    if (k === 'name') return this.saveProfile({ name: el.value });
    if (k === 'chapter') return this.saveProfile({ chapter: el.value ? Number(el.value) : null });
    if (k === 'ui-lang' || k === 'tutor-lang') {
      const L = this.languages, ok = await L.save(k === 'ui-lang' ? el.value : L.language, k === 'tutor-lang' ? el.value : L.tutorLanguage);
      if (!ok) this.toast?.('Could not change the language.', 5000); return this.render();
    }
  }
  // ── optional class step (lane D's welcome calls window.KinemaProfile.askCourse()) ───────────────────────────
  /* Resolves {course, chapter} once saved, or null when skipped. With {host} it renders inside that element (the
     welcome screen); otherwise it opens its own small dialog. Skipping still records asked:true so it never nags. */
  async askCourse({ host = null } = {}) {
    if (!this.data) await this.load().catch(() => null);
    if (!this.data) return null;
    const dlg = host ? null : Object.assign(document.createElement('dialog'), { className: 'kp-dialog' });
    const box = host || dlg;
    if (dlg) { dlg.setAttribute('aria-labelledby', 'kp-ask-h'); document.body.append(dlg); dlg.showModal(); }
    let course = null;
    return await new Promise(resolve => {
      const done = async result => {
        await this.saveProfile(result ? { ...result, asked: true } : { asked: true }, true);
        box.removeEventListener('click', onClick); if (dlg) { dlg.close(); dlg.remove(); } else box.innerHTML = '';
        resolve(result);
      };
      const paint = () => {
        const c = course && this.classOf(course);
        box.innerHTML = !c ? `<div class="kp-ask"><h2 id="kp-ask-h">Which class are you in?</h2><p>Kinema uses it to start you at the right chapters. You can change it any time in Settings.</p>
          <div class="kp-choices">${this.data.classes.map(x => `<button type="button" class="kp-choice" data-kp-course="${esc(x.id)}"><b>${esc(x.id === 'other' ? 'Other' : x.id)}</b><small>${esc(x.id === 'other' ? 'Another class or on my own' : x.subtitle)}</small></button>`).join('')}</div>
          <button type="button" class="kp-skip" data-kp-skip>Skip</button></div>`
          : `<div class="kp-ask"><button type="button" class="kp-back" data-kp-back aria-label="Back to classes">${controlIcon('left')} ${esc(c.id === 'other' ? 'Other' : c.id)}</button><h2 id="kp-ask-h">Which chapter are you on?</h2><p>Morin, <i>Introduction to Classical Mechanics</i>.</p>
          <div class="kp-chapters">${c.chapters.map(ch => `<button type="button" class="kp-ch" data-kp-ch="${ch.n}"><b>${ch.n}</b><span>${esc(ch.title)}</span></button>`).join('')}</div>
          <button type="button" class="kp-skip" data-kp-nochapter>Not sure yet</button></div>`;
        box.querySelector('button')?.focus();
      };
      const onClick = e => {
        const t = e.target.closest('button'); if (!t) return;
        if (t.dataset.kpCourse) { course = t.dataset.kpCourse; return paint(); }
        if ('kpBack' in t.dataset) { course = null; return paint(); }
        if ('kpSkip' in t.dataset) return done(null);
        if ('kpNochapter' in t.dataset) return done({ course, chapter: null });
        if (t.dataset.kpCh) return done({ course, chapter: Number(t.dataset.kpCh) });
      };
      box.addEventListener('click', onClick);
      dlg?.addEventListener('cancel', e => { e.preventDefault(); done(null); });
      paint();
    });
  }
}

/* the feed address form: Enter or the button saves and switches the source to the feed */
document.addEventListener('submit', e => {
  const f = e.target.closest?.('[data-st-form="feed"]'); if (!f) return;
  e.preventDefault();
  const page = window.__app?.settings; if (!page) return;
  const url = f.querySelector('[data-st="feed-url"]').value.trim();
  page.feedDraft = null;
  page.saveProfile({ daily_source: 'feed', feed_url: url });
});
