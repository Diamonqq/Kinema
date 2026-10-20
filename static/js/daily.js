import { bindVisualResize } from './viewer_controls.js';
/* Daily problem: one Morin puzzle a day. Ten visible minutes alone first (work on paper); then conversational hints and teaching.
   One composer both asks the tutor and carries photos of your work. The server owns the clock (heartbeat ticks while this page is
   visible), so reload and sleep cannot skip the wait. Every request names the day and puzzle this page shows, so a tab left open
   across midnight cannot write onto another one. Reading or chatting never marks a problem solved. */
import { esc, math, mdlite } from './md.js';
import { presentText, flushText } from './reply_reveal.js';
import { LiveDictation, actionMode, captureScreen, screenSupported, ICON_MIC, ICON_SHOT, ICON_STOP, ICON_SEND } from './composer_tools.js';
import { tileHTML, paintProgress, upload, settleIn } from './attach_tiles.js';
import { modelButton, updateModelContext } from './model_menu.js';
import { assistantMark } from './model_identity.js';
import { closeScreenshotPicker, isShotPickerOpen } from './screenshot_picker.js';

const TICK_MS = 5000;
const TUTOR_FAILED = 'The tutor could not finish that reply. Your question was saved, so you can send it again.';
const PHASE = { starting: 'Starting', connecting: 'Connecting', thinking: 'Thinking', writing: 'Writing' };
const uuid = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Math.random().toString(36).slice(2) + Date.now().toString(36)).padEnd(16, '0');
const MAX_EXTRAPOLATE = 12;       // seconds the display may run ahead of the last confirmed server tick
const clock = s => { s = Math.max(0, Math.ceil(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode: the saved copy on the server still works */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* nothing to remove */ } },
};

export class Daily {
  constructor(el, d) {
    this.el = el; this.d = d; this.v = null; this.active = false; this.timer = null; this.hb = null; this.tick0 = 0;
    this.pending = []; this.live = null; this.mic = new LiveDictation({ api: d.api, url: d.url, say: t => this.say(t) }); this.sceneToken = 0; this.scene = null; this.busy = false; this.offline = false; this.stale = false; this.beating = false; this.starting = false; this.blurred = false;
    document.addEventListener('visibilitychange', () => { if (this.active) this.beat(); });
    addEventListener('blur', () => { this.blurred = true; if (this.active && this.v?.think.started && !this.stale) this.beacon(false); });
    addEventListener('focus', () => { this.blurred = false; if (this.active) this.beat(); });
    document.addEventListener('paste', e => {
      if (!this.active) return;
      const f = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'))?.getAsFile();
      if (!f) return;
      e.preventDefault();
      if (this.el.querySelector('#dp-photo')) this.photo(f);
    });
    el.addEventListener('dragover', e => e.preventDefault());
    el.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f && f.type.startsWith('image/') && this.el.querySelector('#dp-photo')) this.photo(f); });
    el.addEventListener('click', e => {
      const z = e.target.closest?.('img[data-zoom]'); if (z) this.zoom(z);
      if (e.target.closest?.('#dp-start')) this.start();
      if (e.target.closest?.('[data-dp-retry]')) this.enter();
      const action = e.target.closest?.('[data-dp-explore]')?.dataset.dpExplore;
      if (action) this.el.closest('.teacher')?.querySelector(`.tv-nav [data-act="${action}"]`)?.click();
    });
    el.addEventListener('keydown', e => { const z = e.target.closest?.('img[data-zoom]'); if (z && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); this.zoom(z); } });
    el.addEventListener('error', e => { const i = e.target; if (i?.classList?.contains('dp-page')) this.badImage(i); }, true);
    el.addEventListener('load', e => { const i = e.target; if (i?.classList?.contains('dp-page') && (i.naturalWidth < 120 || i.naturalHeight < 60)) this.badImage(i); }, true);
    this.lightbox = null; this.followLive = false;
    const stopFollow = () => { this.followLive = false; };
    for (const ev of ['wheel', 'touchstart', 'pointerdown']) el.addEventListener(ev, stopFollow, { passive: true });
    el.addEventListener('keydown', e => { if (['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End', ' '].includes(e.key) && !e.target.closest?.('textarea,input')) stopFollow(); });
    addEventListener('pagehide', () => { if (this.active && this.v?.think.started && !this.stale) this.beacon(false); });
  }
  get uploading() { return this.pending.some(f => !f.id && !f.error); }
  get failedPhoto() { return this.pending.some(f => f.error); }
  badImage(i) {
    const n = document.createElement('p'); n.className = 'dp-quiet dp-badimg';
    n.textContent = `This picture did not load properly. Morin ${this.v?.problem.id || ''} is in the book${this.v?.problem.chapter ? ' (chapter ' + this.v.problem.chapter + ')' : ''}.`;
    i.replaceWith(n);
  }
  key(kind) { return `kinema.daily.${kind}.${this.v.day}.${this.v.problem.id}`; }
  bind(body) { return JSON.stringify({ ...(body || {}), day: this.v.day, problem: this.v.problem.id }); }
  async enter() {
    const visit = this.visit = (this.visit || 0) + 1;
    this.active = true; this.stale = false;
    if (!this.v) this.el.innerHTML = '<div class="dp-wrap"><p class="dp-quiet">Finding today’s puzzle…</p></div>';
    try {
      const value = await this.d.api(this.d.url('/api/daily/today'));
      if (!this.active || this.visit !== visit) return;
      if (value.state === 'unavailable') {
        this.v = null; clearInterval(this.timer); clearInterval(this.hb);
        this.el.innerHTML = '<div class="dp-empty"><h1>Daily problem</h1><p>A Daily puzzle needs a prepared local problem pack. You can explore the chapters or bring your own question meanwhile.</p><div class="dp-row"><button type="button" class="dp-btn" data-dp-explore="path">Explore chapters</button><button type="button" class="dp-btn" data-dp-explore="new-chat">Bring a problem</button></div></div>';
        return;
      }
      this.set(value); this.offline = false;
    }
    catch (e) { if (!this.active || this.visit !== visit) return; if (!this.v) { this.el.innerHTML = `<div class="dp-empty"><h1>Daily problem</h1><p role="alert">Could not load today's puzzle. ${esc(e.message)}</p><button type="button" class="dp-btn" data-dp-retry>Try again</button></div>`; return; } this.offline = true; }
    this.beat();
    clearInterval(this.timer); this.timer = setInterval(() => this.frame(), 500);
    clearInterval(this.hb); this.hb = setInterval(() => this.beat(), TICK_MS);
  }
  leave() { this.closeIdeas(); this.resizeObserver?.disconnect();this.inputObserver?.disconnect();cancelAnimationFrame(this.inputFitFrame);this.inputFitFrame=null;this.mic.cancel(true); this.active = false; clearInterval(this.timer); clearInterval(this.hb); if (this.v?.think.started && !this.stale) this.beacon(false); }
  visible() { return document.visibilityState === 'visible' && !this.blurred && this.active; }
  beacon(vis) { try { fetch(this.d.url('/api/daily/tick'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: this.bind({ visible: vis }), keepalive: true }); } catch (e) { /* the next heartbeat settles it */ } }
  async beat() {
    if (!this.v || !this.v.think.started || this.v.think.unlocked || this.stale || this.beating) return;
    this.beating = true;
    try {
      const nv = await this.d.api(this.d.url('/api/daily/tick'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: this.bind({ visible: this.visible() }) }, 8000);
      const wasLocked = !this.v.think.unlocked;
      this.offline = false; this.v.think = nv.think; this.tick0 = performance.now();
      if (wasLocked && nv.think.unlocked) this.set(nv); else this.frame();
    } catch (e) {
      if (e.body?.code === 'day_changed') this.conflict(e.message);
      else { this.offline = true; this.frame(); }       // not connected: the display stops and nothing unlocks from here
    } finally { this.beating = false; }
  }
  // The clock is a display of server time only once started; before that the full period is shown, unchanged.
  async start() {
    const v = this.v;
    if (!v || v.think.started || v.think.unlocked || this.starting || this.stale) return;
    this.starting = true; this.err('');
    try {
      const nv = await this.d.api(this.d.url('/api/daily/start'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: this.bind({ visible: this.visible() }) }, 8000);
      if (!this.v || this.v.day !== v.day || this.v.problem.id !== v.problem.id) return;   // another puzzle is showing: nothing to update
      this.offline = false; this.v.think = nv.think; this.tick0 = performance.now();
      if (!this.active) { this.beacon(false); return; }   // left while the request was in flight: the start stands, no time is credited
      this.patchSolo(); this.beat();
    } catch (e) {
      if (e.body?.code === 'day_changed') this.conflict(e.message);
      else this.err(e.message || 'The clock did not start. Try again.');
    } finally { this.starting = false; }
  }
  patchSolo() { const s = this.el.querySelector('.dp-solo'); if (!s) { this.render(); return; } s.outerHTML = this.soloHTML(); this.frame(); }
  soloHTML() {
    const t = this.v.think;
    if (t.unlocked) return `<section class="dp-solo done" aria-label="Solo time complete"><span class="dp-solo-label">Solo time complete</span><span class="dp-solo-sep" aria-hidden="true">·</span><span class="dp-solo-time num">${clock(t.total)}</span><span class="dp-sr">The solution is available. Keep exploring, or ask for help.</span><span class="dp-track"><i style="width:100%"></i></span></section>`;
    if (!t.started) return `<section class="dp-solo" aria-label="Try it yourself"><span class="dp-solo-label">Try it yourself</span><span class="dp-solo-sep" aria-hidden="true">·</span><span class="dp-solo-time dp-solo-time-lead num" id="dp-clock">${clock(t.total)}</span><button type="button" class="dp-solo-start" id="dp-start">Start</button><span class="dp-sr">Work it out on paper or in your own words. Hints are available now. The solution opens after ten minutes.</span><span class="dp-track"><i id="dp-bar" style="width:0%"></i></span></section>`;
    return `<section class="dp-solo" aria-label="Try it yourself"><span class="dp-solo-label">Try it yourself</span><span class="dp-solo-time num" id="dp-clock">${clock(this.remaining())}</span><span class="dp-sr">Work it out on paper or in your own words. Hints are available now. The solution opens after ten minutes.</span><span class="dp-track"><i id="dp-bar" style="width:${100 * (1 - this.remaining() / t.total)}%"></i></span></section>`;
  }
  remaining() {
    const t = this.v.think;
    if (t.unlocked) return 0;
    if (!t.started) return t.total;
    const ahead = this.visible() && !this.offline && !this.stale ? Math.min(MAX_EXTRAPOLATE, (performance.now() - this.tick0) / 1000) : 0;
    return Math.max(0, t.remaining - ahead);
  }
  frame() {
    if (!this.v) return;
    const r = this.remaining(), t = this.v.think, c = this.el.querySelector('#dp-clock');
    if (c && !t.unlocked) {
      c.textContent = clock(r);
      const bar = this.el.querySelector('#dp-bar'); if (bar) bar.style.width = (100 * (1 - r / t.total)) + '%';
      const net = this.el.querySelector('#dp-net');
      if (net) {
        net.hidden = !(this.offline || r <= 0);
        net.textContent = this.offline ? 'Paused: Kinema can’t be reached, so the clock is not running. It continues when the connection is back.' : 'Checking with Kinema…';
      }
      if (r <= 0 && !this.offline) this.beat();
    }
  }
  conflict(msg) {
    this.stale = true;
    const draft = this.el.querySelector('#dp-q')?.value || '';
    if (draft && this.v) store.set(this.key('ask'), draft);
    const box = this.el.querySelector('#dp-conflict');
    if (!box) return;
    box.hidden = false;
    box.innerHTML = `<p>${esc(msg || 'A new day has started.')}</p>${draft ? `<p class="dp-quiet">Your unsent question, kept:</p><pre class="dp-keep">${esc(draft)}</pre>` : ''}<div class="dp-row"><button class="dp-btn" id="dp-today">Open today’s puzzle</button></div>`;
    box.querySelector('#dp-today').addEventListener('click', () => { this.v = null; this.stale = false; this.pending = []; this.enter(); });
  }
  set(v) {
    this.v = v; this.tick0 = performance.now();
    this.render();
  }
  render() {
    const sc = this.scroller(); if (!sc._dpf) { sc._dpf = true; for (const ev of ['wheel', 'touchstart', 'pointerdown']) sc.addEventListener(ev, () => { this.followLive = false; }, { passive: true }); }
    const v0 = this.v, el0 = this.el;
    const keepSlot = this.scene && this.sceneKey === `${v0.day}:${v0.problem.id}` ? el0.querySelector('.dp-scene-box') : null;
    const v = this.v, p = v.problem, t = v.think, u = t.unlocked, el = this.el, frozen = v.attempt.frozen;
    if (this.pendingFor !== this.photoKey()) { this.pendingFor = this.photoKey(); this.pending = this.readPhotos(this.pendingFor).map(f => ({ ...f, progress: 1 })); }
    const oldQ = el.querySelector('#dp-q'), hadFocus = oldQ && document.activeElement === oldQ;
    const keepQ = oldQ && this.qKey === `${v0.day}:${v0.problem.id}` ? oldQ : null;
    const draft = oldQ ? oldQ.value : (store.get(this.key('ask')) || '');
    const keep = el.querySelector('.dp-prior')?.open;
    const stars = '★'.repeat(p.stars);
    const q = `?p=${encodeURIComponent(p.id)}&d=${encodeURIComponent(v.day)}&v=${encodeURIComponent(p.image_revision || '')}`;
    const img = (kind, i, alt, cls) => `<img ${cls ? `class="${cls}" ` : ''}data-zoom tabindex="0" role="button" src="${esc(this.d.url(`/api/daily/image/${kind}/${i}.png${q}`))}" alt="${esc(alt)} (tap to enlarge)">`;
    const thumb = (id, label) => `<img class="dp-thumb" data-zoom tabindex="0" role="button" src="${esc(this.d.url(`/api/daily/attempt-image/${encodeURIComponent(id)}${q}`))}" alt="${esc(label)} (tap to enlarge)">`;
    const imgs = Array.from({ length: p.problem_images }, (_, i) => img('problem', i, `Problem ${p.id} page ${i + 1}`, 'dp-page')).join('');
    const figs = p.figures.map((f, i) => `<figure>${img('fig', i, f)}</figure>`).join('');
    const native = !!(p.statement_source && p.statement_md);
    const statement = native ? `<section class="dp-statement" aria-label="Problem statement"><div class="dp-md">${mdlite(p.statement_md)}</div></section>` : '';
    const pages = !imgs ? '' : native ? `<details class="dp-ref"><summary>Original reference</summary><div class="dp-pages">${imgs}</div></details>` : `<div class="dp-pages">${imgs}</div>`;
    // The book solution appears here only after the thinking time and an explicit Show solution; the server enforces both.
    const solShown = !!v.solution;
    const solImgs = solShown ? Array.from({ length: v.solution.images }, (_, i) => img('solution', i, `Solution ${p.id} page ${i + 1}`, 'dp-page')).join('') : '';
    const solFigs = solShown ? (v.solution.figures || []).map((f, i) => `<figure>${img('solfig', i, f)}</figure>`).join('') : '';
    const solution = solShown ? `<section class="dp-solution-ref" aria-label="Book solution"><h2>Book solution</h2>${solFigs ? `<div class="dp-figs dp-big" role="group" aria-label="Solution figures, tap one to enlarge">${solFigs}</div>` : ''}${solImgs ? `<div class="dp-pages">${solImgs}</div>` : ''}</section>` : '';
    const live = this.live;
    const earlier = v.hints.length ? `<details class="dp-earlier"><summary>Earlier hints</summary>${v.hints.map(h => this.messageHTML({role:'assistant', text:h})).join('')}</details>` : '';
    const chat = earlier + v.messages.map(m => this.messageHTML(m)).join('') + (live ? this.liveHTML() : '');
    const a = v.attempt, nFiles = a.files.length + (a.notes_files || []).length;
    const stored = frozen ? '' : (store.get(this.key('draft')) || '');
    const oldText = (a.text || stored || '').trim();
    const priorBits = [oldText && 'written attempt', nFiles && nFiles + (nFiles > 1 ? ' photos' : ' photo'), a.notes && 'notes', a.worked_on_paper && 'tried on paper'].filter(Boolean);
    const prior = priorBits.length ? `<details class="dp-prior"${keep ? ' open' : ''}><summary>Your saved work <span>${esc(priorBits.join(' · '))}</span></summary>
        ${a.worked_on_paper ? '<p class="dp-quiet">You said you tried it on paper' + (frozen ? ' before opening the solution.' : '.') + '</p>' : ''}
        ${oldText ? `<div class="dp-old">${esc(oldText)}</div>` : ''}
        ${a.files.length ? `<p class="dp-quiet">${frozen ? 'Photos from before the solution' : 'Photos'}</p><div class="dp-thumbs">${a.files.map((id, i) => thumb(id, `Your photo ${i + 1}`)).join('')}</div>` : ''}
        ${(a.notes_files || []).length ? `<p class="dp-quiet">Photos added after reading the solution (review, not counted as your attempt)</p><div class="dp-thumbs">${a.notes_files.map((id, i) => thumb(id, `Review photo ${i + 1}`)).join('')}</div>` : ''}
        ${a.notes ? `<p class="dp-quiet">Notes after reading</p><div class="dp-old">${esc(a.notes)}</div>` : ''}</details>` : '';
    const pend = this.pending.map(f => tileHTML(f, this.d.url)).join('');
    const scene = p.visual ? `<aside class="dp-side" aria-label="Simulation"><section class="dp-scene" id="dp-scene"><div class="dp-scene-box" data-scene-slot="${esc(p.id)}"><span>${esc(p.visual.title || '3D scene')}</span></div></section></aside>` : '';
    // The ten-minute strip stays after unlock as the completed attempt; the server owns the clock and the help payload.
    // One compact line: the visible label and time, with the full status kept for screen readers.
    const solo = this.soloHTML();
    // Ideas come only from the server's source-bound guidance; a missing match shows no button at all.
    const ideaKey = `${v.day}:${p.id}`, ideasOn = !!v.ideas && this.ideasOpen === ideaKey, showIdeas = !!v.ideas_available;
    const ideasPanel = v.ideas ? `<section class="dp-ideas" id="dp-ideas-panel" role="dialog" aria-label="Ideas and formulas for this problem"${ideasOn ? '' : ' hidden'}>
          <div class="dp-ideas-head"><b>Ideas &amp; formulas</b><button type="button" class="dp-ideas-close" id="dp-ideas-close" aria-label="Close ideas and formulas">Close</button></div>${v.ideas.topic ? `<p class="dp-ideas-topic">${esc(v.ideas.topic)}</p>` : ''}
          ${v.ideas.method_md ? `<h3>First steps</h3><div class="dp-md">${mdlite(v.ideas.method_md)}</div>` : ''}${v.ideas.relations_md ? `<h3>Formulas and relations</h3><div class="dp-md">${mdlite(v.ideas.relations_md)}</div>` : ''}
        </section>` : '';
    const help = `<div class="dp-help-actions" role="group" aria-label="Help with this problem">
          <button type="button" class="dp-chat-action" id="dp-hint">Hint</button>${showIdeas ? `<button type="button" class="dp-chat-action" id="dp-ideas" aria-expanded="${ideasOn}">Ideas &amp; formulas</button>` : ''}${u && !v.solution ? '<button type="button" class="dp-chat-action dp-quiet-action" id="dp-solution">Show solution</button>' : ''}
        </div>${ideasPanel}`;
    el.innerHTML = `<div class="dp-wrap dp-workspace"><div class="dp-center">
      <div class="dp-head">
        ${native ? '' : `<p class="dp-hook">${esc(p.hook)}</p>`}${u ? '' : '<p class="dp-err" id="dp-net" role="status" hidden></p>'}</div>
      <div class="dp-main"><div class="dp-topbar">${solo}${help}</div><div class="dp-stage-chat">
      <div class="dp-conflict" id="dp-conflict" role="alert" hidden></div>${scene}
      <section class="dp-work" aria-label="Tutor conversation"><div class="dp-chat" id="dp-chat" role="log" aria-label="Conversation about this problem">${chat}</div>
        <p class="dp-quiet dp-say" id="dp-say" role="status" aria-live="polite"${this.sayText ? '' : ' hidden'}>${esc(this.sayText || '')}</p>
        <p class="dp-err" id="dp-err" role="alert" hidden></p></section>${prior}</div>
        <div class="dp-composer">
          <div class="dp-pending at-row" id="dp-pending"${pend ? '' : ' hidden'}>${pend}</div>
          <textarea id="dp-q" rows="1" autocomplete="off" aria-label="Ask about this problem" placeholder="${u ? 'Ask about any step, or tell me where you got stuck…' : 'Ask about the question or a label…'}"></textarea>
          <div class="dp-tools"><label class="dp-attach" title="Add a photo of your work" aria-label="Add a photo of your work"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.5l-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8l9-9a3.7 3.7 0 0 1 5.2 5.2l-9 9a1.8 1.8 0 0 1-2.6-2.6l8.3-8.3"/></svg><input id="dp-photo" type="file" accept="image/*" hidden></label>
          ${!screenSupported() ? '' : `<button type="button" class="dp-tool" id="dp-shot" title="Recent screenshots" aria-label="Recent screenshots">${ICON_SHOT}</button>`}
          <span class="dp-tool-space"></span>${modelButton('chat', true, true)}<span class="pn-comrow-sep" aria-hidden="true"></span>
          <button type="button" class="dp-tool tool-secondary" id="dp-mic" aria-pressed="false" hidden>${ICON_MIC}</button><button type="button" class="dp-send act-btn" id="dp-send" data-action="dictate" aria-label="Dictate" title="Dictate">${ICON_MIC}</button></div>

        </div>
    </div></div><div class="dp-divider" role="separator" tabindex="0" aria-label="Resize problem pane" aria-orientation="vertical"></div><aside class="dp-reference" aria-label="Problem artifact"><header><span>Problem ${esc(p.id)}</span></header><div class="dp-reference-scroll"><h1>${esc(p.title)}</h1><section class="dp-document" aria-label="Problem and figures">${statement}${figs ? `<div class="dp-figs dp-big" role="group" aria-label="Figures from the problem, tap one to enlarge">${figs}</div>` : ''}${pages}${solution}</section></div></aside></div>`;
    if (keepSlot) el.querySelector('.dp-scene-box')?.replaceWith(keepSlot);
    if (keepQ) el.querySelector('#dp-q').replaceWith(keepQ);
    const ta = el.querySelector('#dp-q'); if (!keepQ) ta.value = draft; this.qKey = `${v.day}:${p.id}`;
    ta.placeholder = u ? 'Ask about any step, or tell me where you got stuck…' : 'Ask about the question or a label…'; ta.disabled = false;
    if (!ta._dp) { ta._dp = true;
      ta.addEventListener('input', () => { store.set(this.key('ask'), ta.value); this.fitBox(ta); this.syncAction(); });
      ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (this.hasDraft()) this.ask(); } });
    }
    this.fitBox(ta);
    this.inputObserver?.disconnect();this.inputFitWidth=null;
    this.inputObserver=new ResizeObserver(()=>this.queueInputFit(ta));this.inputObserver.observe(ta);
    if (hadFocus) ta.focus({ preventScroll: true });
    const on = (s, ev, fn) => el.querySelector(s)?.addEventListener(ev, fn);
    on('#dp-photo', 'change', e => { this.photo(e.target.files[0]); e.target.value = ''; });
    on('#dp-hint', 'click', () => this.ask('hint'));
    on('#dp-ideas', 'click', () => this.toggleIdeas());
    on('#dp-ideas-close', 'click', () => this.toggleIdeas(false));
    on('#dp-solution', 'click', () => this.openSolution());
    on('#dp-teach', 'click', () => this.ask('teach'));
    el.querySelector('#dp-pending')?.addEventListener('click', e => this.tileAct(e));
    on('#dp-send', 'click', () => this.primary());
    on('#dp-shot', 'click', () => this.shot());
    this.mic.bind({ box: ta, button: el.querySelector('#dp-mic'), identity: () => `${this.v?.day}:${this.v?.problem.id}`, say: t => this.say(t), onState: () => this.syncAction() });
    math(el.querySelector('.dp-hints')); math(el.querySelector('.dp-head')); math(el.querySelector('#dp-ideas-panel')); math(el.querySelector('.dp-statement')); el.querySelectorAll('.dp-chat .dp-m:not(.dp-live) > div').forEach(n => math(n));
    const ln = this.liveNode(); if (ln && this.live) presentText(ln, this.live.text, t => { ln.textContent = t; }, { force: true });
    this.syncAction();
    if (ideasOn) this.placeIdeas();
    this.watchIdeas(ideasOn);
    updateModelContext(el, {kind:'daily', messages:v.messages});
    this.mountScene(p);
    const chatScroll=this.scroller();chatScroll.addEventListener('scroll',()=>{if(chatScroll.scrollHeight-chatScroll.scrollTop-chatScroll.clientHeight<80)this.followLive=true;},{passive:true});
    if (v.pending && !this.live) this.resume(v.pending);
    if (this.stale) this.conflict();

    this.bindDivider();this.frame();
  }
  bindDivider() {
    const wrap=this.el.querySelector('.dp-workspace'),bar=wrap?.querySelector('.dp-divider');if(!bar)return;
    let ratio=Number(store.get('kinema.daily.pane-ratio.v2'))||.3;
    const apply=(value,save=false)=>{const width=wrap.clientWidth;if(width<=800)return;const low=Math.min(.4,300/width),high=1-Math.min(.5,360/width);ratio=Math.max(low,Math.min(high,value));wrap.style.setProperty('--dp-pane',`${ratio*100}%`);bar.style.right=`calc(${ratio*100}% - 6px)`;bar.setAttribute('aria-valuenow',Math.round(ratio*100));if(save)store.set('kinema.daily.pane-ratio.v2',ratio);};
    apply(ratio);bar.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();bar.setPointerCapture(e.pointerId);wrap.classList.add('dp-resizing');});
    bar.addEventListener('pointermove',e=>{if(bar.hasPointerCapture(e.pointerId)){const r=wrap.getBoundingClientRect();apply((r.right-e.clientX)/r.width);}});
    const stop=e=>{if(bar.hasPointerCapture(e.pointerId))bar.releasePointerCapture(e.pointerId);wrap.classList.remove('dp-resizing');apply(ratio,true);};
    bar.addEventListener('pointerup',stop);bar.addEventListener('pointercancel',stop);
    bar.addEventListener('dblclick',()=>apply(.3,true));bar.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();apply(e.key==='Home'?.3:e.key==='End'?.65:ratio+(e.key==='ArrowLeft'?.03:-.03),true);}});
    this.resizeObserver?.disconnect();this.resizeObserver=new ResizeObserver(()=>apply(ratio));this.resizeObserver.observe(wrap);
  }
  /* the prepared 3D scene (own module, loaded on demand); without it the slot just names the scene */
  async mountScene(p) {
    const slot = this.el.querySelector('[data-scene-slot]');
    const day=this.v.day, problem=p.id, key = `${day}:${problem}`;
    this.visualHelpSaves ||= new Map();
    if (this.v.visual_help?.used) {
      store.del('kinema.daily.visual-help.'+key);
      this.visualHelpSaves.set(key,{pair:{day,problem},state:'saved'});
    }
    else if (store.get('kinema.daily.visual-help.'+key) && !this.visualHelpSaves.has(key))
      this.visualHelpSaves.set(key,{pair:{day,problem},state:'error'});
    const signature = JSON.stringify(p.visual);
    if (this.scene && this.sceneSlot === slot && this.sceneKey === key) {
      if (this.sceneSignature !== signature) { this.scene.update(p.visual); this.sceneSignature = signature; }
      this.paintVisualHelp(slot,key);
      return;
    }
    try { this.scene?.destroy?.(); } catch (e) { /* the old canvas is already gone */ }
    this.scene = null; this.sceneSlot = slot; this.sceneKey = key;
    const mine = ++this.sceneToken;
    if (!slot || !p.visual) return;
    try {
      const { mountDailyVisual } = await import('./daily_visuals.js');
      if (mine !== this.sceneToken || !slot.isConnected) return;
      slot.textContent = '';
      const h = await mountDailyVisual(slot, p.visual, { compact: false, intent:'practice',
        onHelpReveal:()=>this.saveVisualHelp({day,problem},slot,key) });
      if (mine !== this.sceneToken || !slot.isConnected) { h?.destroy?.(); return; }
      this.scene = h; this.sceneSignature = signature;bindVisualResize(slot,'kinema.visual-height.daily',{ratio:()=>innerWidth>=1100&&innerHeight>=1000?Math.min(.5,560/innerHeight):innerWidth<=520?Math.min(330,Math.max(260,innerHeight-400))/innerHeight:.38});
      this.paintVisualHelp(slot,key);
    } catch (e) { if (mine !== this.sceneToken || !slot.isConnected) return; slot.dataset.unavailable = '1'; slot.innerHTML = `<span>${esc(p.visual.title || '3D scene')} · the viewer is not available</span>`; }
  }
  // This small save never rebuilds the scene/chat, opens a tutor, or changes the written-help clock.
  // The viewer captures its pair before importing; a late result cannot mark a different day/problem.
  async saveVisualHelp(pair,slot,key) {
    this.visualHelpSaves ||= new Map();
    let record=this.visualHelpSaves.get(key);
    if (record?.state==='saving' || record?.state==='saved') return;
    record={pair:{...pair},state:'saving'}; this.visualHelpSaves.set(key,record);store.set('kinema.daily.visual-help.'+key,'pending');this.paintVisualHelp(slot,key);
    try {
      const result=await this.d.api(this.d.url('/api/daily/visual-help'),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(record.pair)});
      if (!result?.ok || !result.used) throw new Error('Force help was not saved.');
      record.state='saved';
      store.del('kinema.daily.visual-help.'+key);
      if (`${this.v?.day}:${this.v?.problem.id}`===key) this.v.visual_help={used:true};
    } catch(e) { record.state='error'; record.error=e.message || 'Could not save force help.'; }
    this.paintVisualHelp(slot,key);
  }
  paintVisualHelp(slot,key) {
    if (!slot?.isConnected || this.sceneKey!==key) return;
    let note=slot.parentElement.querySelector('.dp-visual-help');
    const record=this.visualHelpSaves?.get(key);
    if (!record || record.state==='saved') { note?.remove(); return; }
    if (!note) { note=document.createElement('p'); note.className='dp-visual-help';note.setAttribute('role','status');slot.after(note); }
    note.textContent=record.state==='saving'?'Saving force help…':'Force help could not be saved. Retry before recording your result.';
    if (record.state==='error') {
      const b=document.createElement('button');b.type='button';b.textContent='Retry save';
      b.onclick=()=>this.saveVisualHelp(record.pair,slot,key);note.append(b);
    }
  }
  // Uploaded photos are kept per puzzle in this browser: attachment ids, names and URLs, six at most. Leaving,
  // returning or reloading brings them back, and the server still checks every id when a message is sent.
  photoKey() { return `kinema.daily.photos.${this.v.day}.${this.v.problem.id}`; }
  readPhotos(pk) {
    try { const a = JSON.parse(store.get(pk) || '[]'); return Array.isArray(a) ? a.filter(f => f && typeof f.id === 'string' && f.id).slice(0, 6) : []; }
    catch (e) { return []; }
  }
  savePhotos() {
    const pk = this.photoKey(), kept = this.pending.filter(f => f.id).slice(0, 6).map(({ key, id, name, kind, url }) => ({ key, id, name, kind, url }));
    if (kept.length) store.set(pk, JSON.stringify(kept)); else store.del(pk);
  }
  // A photo that finished uploading after the learner moved to another puzzle is kept for its own puzzle.
  keepPhoto(f) {
    const list = [...this.readPhotos(f.pk).filter(x => x.id !== f.id), { key: f.key, id: f.id, name: f.name, kind: f.kind, url: f.url }].slice(-6);
    store.set(f.pk, JSON.stringify(list));
  }
  err(msg) { const e = this.el.querySelector('#dp-err'); if (e) { e.textContent = msg || ''; e.hidden = !msg; if(msg)requestAnimationFrame(()=>{if(!e.isConnected)return;const sc=this.scroller(),need=e.getBoundingClientRect().bottom-sc.getBoundingClientRect().bottom+12;if(need>0)sc.scrollTop+=need;}); } }
  fail(e) {
    if (e.body?.code === 'day_changed') this.conflict(e.message);
    else this.err(e.message || 'Something went wrong.');
  }
  async post(path, body) {
    if (this.busy) return; if (this.live) { this.err('Wait for the tutor to finish answering first.'); return; }
    const forceSave=this.visualHelpSaves?.get(`${this.v?.day}:${this.v?.problem.id}`);
    if (['/api/daily/finish','/api/daily/solution'].includes(path) && forceSave && forceSave.state!=='saved') { this.err('Save force help with Retry save before recording your result.');return false; }
    this.busy = true; this.err('');
    const btns = this.el.querySelectorAll('.dp-main button'); btns.forEach(b => b.disabled = true);
    try { this.set(await this.d.api(this.d.url(path), { method: 'POST', headers: { 'content-type': 'application/json' }, body: this.bind(body) }, 240000)); return true; }
    catch (e) { btns.forEach(b => b.disabled = false); this.fail(e); return false; }
    finally { this.busy = false; this.syncAction(); }
  }
  zoom(src, opener = src) {
    window.KinemaImageViewer.open(src.currentSrc||src.src,src.alt||'Problem reference',{returnFocus:()=>opener?.isConnected?opener:this.el.querySelector('.dp-ref summary')});
    this.imageOpen=true;
  }
  closeZoom() { if(this.imageOpen){window.KinemaImageViewer.close();this.imageOpen=false;} }
  async openSolution() {
    this.err('');
    if (this.live) { this.err('Wait for the tutor to finish answering first.'); return; }
    if (this.uploading) { this.err('Your photo is still uploading. Wait a moment, then open the solution.'); return; }
    if (this.failedPhoto) { this.err('Your photo has not uploaded yet. Retry the upload first.'); return; }
    if (this.opening) return; this.opening = true;
    try {
      if (this.pending.length && !(await this.sendPending())) return;      // photos reach the server before the solution freezes your attempt
      await this.post('/api/daily/solution');
    } finally { this.opening = false; }
  }
  async setPaper(on) {
    try { const nv = await this.d.api(this.d.url('/api/daily/attempt'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: this.bind({ worked_on_paper: !!on }) }); this.v.attempt = nv.attempt; this.err(''); }
    catch (e) { if (e.body?.code === 'day_changed') this.conflict(e.message); else this.err('Could not save that (' + (e.message || 'no connection') + ').'); const b = this.el.querySelector('#dp-paper'); if (b) b.checked = !on; }
  }
  async sendPending() {            // photos with no question: the server keeps them as part of your work
    const ids = this.pending.filter(f => f.id).map(f => f.id);
    try { const nv = await this.d.api(this.d.url('/api/daily/attempt'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: this.bind({ attachment_ids: ids }) }); this.pending = []; this.savePhotos(); this.v.attempt = nv.attempt; return true; }
    catch (e) { if (e.body?.code === 'day_changed') this.conflict(e.message); else this.err('Your photo was not saved (' + (e.message || 'no connection') + '). It is still attached; try again.'); return false; }
  }
  async finish(matched) { if (!this.busy) this.post('/api/daily/finish', { matched }); }
  async photo(file) {
    if (!file) return;
    this.err('');
    if (this.opening) { this.err('The solution is opening, so no more photos can be added.'); return; }
    if (this.pending.length >= 6) { this.err('Up to 6 photos per message.'); return; }
    const f = { key: uuid().slice(0, 12), name: file.name || 'work.png', kind: 'image', preview: URL.createObjectURL(file), file, progress: 0, pk: this.photoKey() };
    this.pending.push(f); this.renderPending(); this.syncAction();
    await this.uploadOne(f);
  }
  async uploadOne(f) {
    const fd = new FormData(); fd.append('course_id', '2301'); fd.append('files', f.file, f.name);
    f.error = null; f.progress = 0;
    this.renderPending();
    try {
      const r = await upload(this.d.url('/api/teacher/attachments'), fd, { onProgress: p => { f.progress = p; paintProgress(this.el.querySelector('#dp-pending'), f); } });
      const a = r.attachments?.[0]; if (!a?.id) throw new Error('The photo was not accepted');
      f.id = a.id; f.url = a.url || null; f.file = null;
    } catch (e) { f.error = e.message || 'no connection'; }
    if (f.id) { if (f.pk === this.photoKey()) this.savePhotos(); else this.keepPhoto(f); }
    if (this.pending.includes(f)) { this.renderPending(); this.syncAction(); }
    if (f.error) this.err('The photo was not uploaded (' + f.error + '). Retry it or remove it; nothing was lost.');
  }
  renderPending() {
    const box = this.el.querySelector('#dp-pending'); if (!box) return;
    box.innerHTML = this.pending.map(f => tileHTML(f, this.d.url)).join(''); box.hidden = !this.pending.length;
  }
  tileAct(e) {
    const b = e.target.closest?.('[data-act]'); if (!b) return; const f = this.pending.find(x => x.key === b.dataset.key); if (!f) return;
    if (b.dataset.act === 'unattach') { this.pending = this.pending.filter(x => x !== f); this.savePhotos(); this.err(''); this.renderPending(); this.syncAction(); }
    else if (b.dataset.act === 'retry-upload' && f.file) { this.err(''); this.uploadOne(f); this.syncAction(); }
  }
  hasDraft() { return !!(this.el.querySelector('#dp-q')?.value.trim() || this.pending.some(f => f.id)); }
  queueInputFit(ta) {
    const width=ta.getBoundingClientRect().width;
    if(Math.abs(width-(this.inputFitWidth||0))<=.5)return;
    this.inputFitWidth=width;cancelAnimationFrame(this.inputFitFrame);
    // Resize only after delivery; height changes alone must not start a loop.
    this.inputFitFrame=requestAnimationFrame(()=>{
      this.inputFitFrame=null;
      if(this.active&&ta.isConnected&&this.el.querySelector('#dp-q')===ta)this.fitBox(ta);
    });
  }
  fitBox(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; }
  /* mic when empty, stop while recording, working while finishing, send with a draft; stop for a live reply */
  syncAction() {
    const b = this.el.querySelector('#dp-send'); if (!b) return;
    const m = this.mic, live = this.live, has = this.hasDraft(), up = this.uploading, bad = this.failedPhoto;
    const mode = actionMode({ pending: !!live, hasDraft: has, dictating: m.active, finishing: m.finishing });
    b.innerHTML = mode === 'dictate' ? ICON_MIC : mode === 'dictating' ? ICON_STOP : mode === 'transcribing' ? '<span class="act-dots"><i></i><i></i><i></i></span>' : mode === 'stop' ? ICON_STOP : ICON_SEND;
    const label = { dictate: m.ready ? 'Dictate' : m.reason, dictating: 'Stop dictation and review', transcribing: 'Finishing your words…', stop: live?.stopping ? 'Stopping…' : 'Stop',
      send: up ? 'Waiting for the photo upload' : bad ? 'Remove or retry the failed photo to send' : live ? 'Wait for the reply to finish' : this.pending.length && !this.el.querySelector('#dp-q').value.trim() ? 'Send photo' : 'Ask' }[mode];
    b.setAttribute('aria-label', label); b.title = label; b.dataset.action = mode; b.classList.toggle('rec', mode === 'dictating');
    b.disabled = mode === 'transcribing' || (mode === 'stop' && (!live.job || live.stopping)) || (mode === 'send' && (!!live || up || bad || this.busy));
    b.setAttribute('aria-disabled', String(b.disabled || (mode === 'dictate' && !m.ready)));
    const sec = this.el.querySelector('#dp-mic'); if (sec) sec.hidden = !m.ready || (!live && (!has || m.active));
    this.el.querySelectorAll('.dp-chat-action').forEach(a => { if (a.id !== 'dp-ideas') a.disabled = !!live || up || bad || this.busy || m.finishing; });
  }
  // Ideas & formulas only read the saved guidance; they stay open during a reply and never change the clock.
  toggleIdeas(force) {
    const key = `${this.v.day}:${this.v.problem.id}`, open = force ?? this.ideasOpen !== key;
    if (!open) return this.closeIdeas();
    this.ideasOpen = key;
    const panel = this.el.querySelector('#dp-ideas-panel'), btn = this.el.querySelector('#dp-ideas');
    if (panel) panel.hidden = false;
    if (btn) btn.setAttribute('aria-expanded', 'true');
    this.placeIdeas(); this.watchIdeas(true);
    panel?.querySelector('#dp-ideas-close')?.focus({ preventScroll: true });
  }
  // Closing keeps the draft, photos and clock untouched; focus returns to the button when focus was inside the popup.
  closeIdeas() {
    this.ideasOpen = '';
    const panel = this.el.querySelector('#dp-ideas-panel'), btn = this.el.querySelector('#dp-ideas');
    const had = panel && !panel.hidden;
    if (panel) panel.hidden = true;
    if (btn) btn.setAttribute('aria-expanded', 'false');
    this.watchIdeas(false);
    // focus is inside the popup, or was lost when the chat re-rendered: return it to the button
    const lost = !document.activeElement || document.activeElement === document.body || (panel && panel.contains(document.activeElement));
    if (had && lost) btn?.focus({ preventScroll: true });
  }
  // A compact popup beside its button, on whichever side of it has more room (the button sits in the top bar, so
  // below is usual). Its height is capped to that space and the body scrolls past it; it never covers the button.
  placeIdeas() {
    const panel = this.el.querySelector('#dp-ideas-panel'), btn = this.el.querySelector('#dp-ideas');
    if (!panel || !btn || panel.hidden) return;
    const vw = innerWidth, vh = innerHeight, r = btn.getBoundingClientRect();
    const below = vh - r.bottom - 20, above = r.top - 20;
    const useBelow = below >= 240 || below >= above;
    const room = useBelow ? below : above;
    panel.style.width = Math.min(380, vw - 24) + 'px';
    panel.style.maxHeight = Math.max(120, Math.min(420, vh - 24, room)) + 'px';
    const h = panel.offsetHeight, w = panel.offsetWidth;
    panel.style.left = Math.max(12, Math.min(r.right - w, vw - w - 12)) + 'px';
    panel.style.top = (useBelow ? Math.max(12, Math.min(r.bottom + 8, vh - h - 12)) : Math.max(12, r.top - h - 8)) + 'px';
  }
  watchIdeas(on) {
    if (on && !this.ideasWatch) {
      this.ideasWatch = {
        down: e => { const p = this.el.querySelector('#dp-ideas-panel'), b = this.el.querySelector('#dp-ideas');
          if (p && !p.hidden && !p.contains(e.target) && !(b && b.contains(e.target))) this.closeIdeas(); },
        move: () => this.placeIdeas(),
        // Escape closes only this open popup: the panel is looked up each time, so a chat re-render cannot drop it,
        // and a photo viewer or screenshot picker that is open keeps its own Escape.
        key: e => {
          if (e.key !== 'Escape') return;
          const p = this.el.querySelector('#dp-ideas-panel');
          if (!p || p.hidden || document.querySelector('.kinema-shots') || document.getElementById('lightbox')?.hidden === false) return;
          e.preventDefault(); e.stopPropagation(); this.closeIdeas();
        },
      };
      document.addEventListener('pointerdown', this.ideasWatch.down, true);
      document.addEventListener('keydown', this.ideasWatch.key, true);
      addEventListener('resize', this.ideasWatch.move);
      document.addEventListener('scroll', this.ideasWatch.move, true);
    } else if (!on && this.ideasWatch) {
      document.removeEventListener('pointerdown', this.ideasWatch.down, true);
      document.removeEventListener('keydown', this.ideasWatch.key, true);
      removeEventListener('resize', this.ideasWatch.move);
      document.removeEventListener('scroll', this.ideasWatch.move, true);
      this.ideasWatch = null;
    }
  }
  primary() {
    const mode = this.el.querySelector('#dp-send')?.dataset.action;
    if (mode === 'dictate') return this.mic.toggle();
    if (mode === 'dictating') return this.mic.finish();
    if (mode === 'stop') return this.stop();
    if (mode === 'send') return this.ask();
  }
  say(t) { this.sayText = t || ''; const n = this.el.querySelector('#dp-say'); if (n) { n.textContent = this.sayText; n.hidden = !this.sayText; } }
  async shot() {
    const anchor = this.el.querySelector('#dp-shot');
    if (isShotPickerOpen(anchor)) return closeScreenshotPicker();
    if (this.capturing || this.opening) return;
    this.capturing = true; this.err('');
    const key=this.qKey;
    try { const f = await captureScreen({url:this.d.url, anchor}); if (f && this.active && this.qKey===key) await this.photo(f); }
    catch (e) { this.err('The screenshot could not be attached (' + (e.message || e.name) + ').'); }
    finally { this.capturing = false; }
  }
  /* ── the tutor's reply: one request at a time, polled from the job, revealed smoothly as plain text ── */
  messageHTML(m) {
    return `<div class="dp-m ${m.role === 'user' ? 'user' : 'assistant'}">${m.role === 'user' ? '' : `<span class="dp-avatar">${assistantMark}</span>`}<div class="dp-bubble">${m.role === 'user' ? esc(m.text) : mdlite(m.text)}</div></div>`;
  }
  liveHTML() {
    const l = this.live;
    return `<div class="dp-m assistant dp-live" role="status" aria-label="The tutor is answering"><span class="dp-avatar">${assistantMark}</span><div class="dp-bubble"><span class="dp-phase"><i class="dp-dot" aria-hidden="true"></i><span class="dp-ph">${esc(l.phase)}</span></span><span class="dp-lt">${esc(l.text)}</span></div></div>`;
  }
  liveNode() { return this.el.querySelector('.dp-live .dp-lt'); }
  paintLive(text, phase, { force = false } = {}) {
    const l = this.live, node = this.liveNode(); if (!l) return;
    l.text = text; if (phase) l.phase = phase;
    if (!node) return;
    const ph = this.el.querySelector('.dp-live .dp-ph'); if (ph && phase) ph.textContent = phase;
    presentText(node, text, t => { node.textContent = t; this.keepLiveInView(); }, { force });
  }
  /* the page scrolls as one; a reply keeps itself in view only until you scroll yourself */
  scroller() { return this.el.querySelector('.dp-stage-chat') || this.el; }
  keepLiveInView() {
    if (!this.followLive) return;
    const row = this.el.querySelector('.dp-live'); if (!row) return;
    const r = row.getBoundingClientRect(), e = this.scroller().getBoundingClientRect();
    const need = r.bottom - e.bottom + 16;
    if (need > 0) this.scroller().scrollTop += need;   // follow the bottom of a long reply while it streams
  }
  async resume(job) {
    this.live = { rid: null, job, text: '', phase: 'Thinking', fails: 0, pass: -1, seq: -1 };
    this.render(); this.follow();
  }
  async follow() {
    const live = this.live; if (!live || live.polling) return; live.polling = true;
    const wait = ms => new Promise(r => setTimeout(r, ms));
    while (this.live === live) {
      let j;
      try { j = await this.d.api(this.d.url('/api/jobs/' + encodeURIComponent(live.job)), undefined, 15000); live.fails = 0; }
      catch (e) {
        if (this.live !== live) return;
        if (e.status === 404) return this.settleLive(live, 'The tutor\u2019s reply was lost (Kinema may have restarted). Your question was saved; ask again.');
        if (++live.fails > 10) return this.settleLive(live, 'Kinema could not be reached, so the reply was not shown. Your question was saved; reload to check.');
        await wait(2000); continue;
      }
      if (this.live !== live) return;
      if (j.status === 'running') {
        const st = j.stream; let text = live.text;
        if (st) {
          const newer = st.pass > live.pass || (st.pass === live.pass && st.seq > live.seq);
          if (newer) { live.pass = st.pass; live.seq = st.seq; const t = String(st.answer || ''); text = t.length < text.length && text.startsWith(t) ? text : t; }
        }
        this.paintLive(text, PHASE[j.phase] || (j.phase ? j.phase.charAt(0).toUpperCase() + j.phase.slice(1) : 'Thinking'));
        await wait(500); continue;
      }
      if (j.result) return this.finishLive(live, j.result);
      if (j.error && !live.stopping) console.warn('Daily reply failed:', j.error);
      return this.settleLive(live, j.error ? (live.stopping ? '' : TUTOR_FAILED) : '');
    }
  }
  finishLive(live, result) {
    const last = (result.messages || []).at(-1), text = last && last.role === 'assistant' ? last.text : live.text;
    this.paintLive(text, null, { force: true });
    this.live = null;
    // Leaving Daily mid-reply: the saved reply loads on return, so nothing is drawn into another page.
    if (!this.active) return;
    const top = this.scroller().scrollTop, follow = this.followLive;
    this.set(result);                                  // re-renders the chat, so the scroller is a new element
    if (follow) this.revealReply(); else this.scroller().scrollTop = top;
  }
  // The finished reply's bottom comes into view even when it is taller than the window.
  revealReply() {
    const row = [...this.el.querySelectorAll('.dp-m.assistant')].at(-1); if (!row) return;
    const sc = this.scroller(), r = row.getBoundingClientRect(), e = sc.getBoundingClientRect();
    const need = r.bottom - e.bottom + 16; if (need > 0) sc.scrollTop += need;
    this.followLive = true;
  }
  async settleLive(live, msg) {
    if (this.live !== live) return;
    flushText(this.liveNode()); this.live = null;
    try { this.set(await this.d.api(this.d.url('/api/daily/today'))); } catch (e) { this.render(); }
    this.err(msg || (live.stopping ? '' : 'The reply stopped before it finished. Your question was saved; ask again.'));
    if (live.stopping) this.say('Stopped. Your question was saved.');
  }
  async stop() {
    const l = this.live; if (!l || !l.job || l.stopping) return;
    l.stopping = true; this.syncAction();
    try { await this.d.api(this.d.url('/api/jobs/' + encodeURIComponent(l.job) + '/cancel'), { method: 'POST' }, 10000); }
    catch (e) { l.stopping = false; this.syncAction(); this.err('Could not stop the reply: ' + (e.message || 'no connection')); }
  }
  async ask(mode = 'question') {
    if (window.KinemaAccount && !window.KinemaAccount.signedIn) { window.KinemaAccount.promptSignIn(); return; }
    if (this.mic.active && !(await this.mic.finish())) return;
    const q = this.el.querySelector('#dp-q'); if (!q || this.busy || this.live || this.stale) return;
    const draft = q.value.trim(), help = {hint:'Give me a small hint.', teach:"I'm stuck. Walk me through this, one step at a time."}[mode];
    // Hint and walk-through send only their own line: the unsent draft and attached photos stay put for an ordinary Send.
    const m = help || draft;
    const sent = help ? [] : this.pending.slice(), ids = sent.filter(f => f.id).map(f => f.id);
    if (!m && !ids.length) return;
    if (!help && this.uploading) { this.err('Your photo is still uploading. Send again in a moment.'); return; }
    if (!help && this.failedPhoto) { this.err('Remove or retry the failed photo first.'); return; }
    this.err(''); this.say('');
    // the same text and photos always reuse one request id, so a retry after a dropped connection never creates a second turn
    const sig = JSON.stringify([m, ids, mode]); let kept = null; try { kept = JSON.parse(store.get(this.key('req')) || 'null'); } catch (e) { /* new id */ }
    const retry=kept&&kept.sig===sig;
    const rid=retry?kept.id:uuid(),visual_state=retry?kept.visual_state:JSON.parse(JSON.stringify(this.scene?.state||null));
    store.set(this.key('req'),JSON.stringify({sig,id:rid,visual_state}));
    this.live = { rid, job: null, text: '', phase: 'Starting', fails: 0, pass: -1, seq: -1 };
    const work = this.el.querySelector('.dp-work');
    const chat = this.el.querySelector('#dp-chat') || (() => { const c = document.createElement('div'); c.className = 'dp-chat'; c.id = 'dp-chat'; work.prepend(c); return c; })();
    chat.insertAdjacentHTML('beforeend', this.messageHTML({role:'user', text:m || 'Sent a photo of my work'}) + this.liveHTML());
    const rows = chat.querySelectorAll('.dp-m'); settleIn(rows[rows.length - 2]); settleIn(rows[rows.length - 1]);
    this.followLive = true; this.keepLiveInView();
    if (!help) { q.value = ''; this.fitBox(q); store.del(this.key('ask')); }
    this.syncAction();
    let r;
    try { r = await this.d.api(this.d.url('/api/daily/ask/start'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: this.bind({ message: m, attachment_ids: ids, request_id: rid, mode, visual_state }) }, 30000); }
    catch (e) {
      this.live = null; const q2 = this.el.querySelector('#dp-q'); if (q2 && !help) { q2.value = [draft, q2.value].filter(Boolean).join('\n\n'); store.set(this.key('ask'), q2.value); }
      this.render(); this.fail(e); return;
    }
    store.del(this.key('req'));
    this.pending = this.pending.filter(f => !sent.includes(f));
    this.savePhotos();
    if (!r.job_id) { this.live = null; this.set(r.result); return; }
    this.live.job = r.job_id; this.renderPending(); this.syncAction();
    this.follow();
  }
}
