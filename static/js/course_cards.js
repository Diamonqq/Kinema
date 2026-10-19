// Native course cards (Kinema 1.13): lesson → check → cards → exam practice, served by app/course_cards.py.
// The server stores every grade and answer (revision + request id); this view only picks the next card and draws.
// Mount: new CourseCards(host, {api, url, onAsk, onExit, onState}); open(deckId?), close(), context().
import { math } from './md.js';

const MIN = 60000, HOUR = 3600000;
const QUIET = new Set(['position', 'time']);

// ── scheduler: mirror of app/course_cards.py Sched (tests/test_course_cards.py checks they agree) ──────────────
export function makeSched(cfg) {
  const C = {
    steps: [MIN, 10 * MIN], relearn: [MIN, 10 * MIN], grad: 4 * HOUR, easyGrad: 12 * HOUR, startEase: 2.5, minEase: 1.3,
    hardMul: 1.2, easyMul: 1.4, lapseDrop: 0.2, hardDrop: 0.15, easyRise: 0.15, leech: 3, wakeHour: 8, learnAhead: 20 * MIN, aheadFrac: 0.7,
  };
  const EXAM = cfg.exam ?? null, CUTOFF = cfg.cutoff ?? null, SLOT0 = cfg.slot_start, SPAN = cfg.slot_span;
  const fresh = () => ({ s: 'new', step: 0, due: 0, ivl: 0, ease: C.startEase, lapses: 0, reps: 0, last: 0 });
  const copy = c => Object.assign(fresh(), c || {});
  function hash(id) { let h = 2166136261; for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }
  const slot = id => SLOT0 + Math.floor(hash(id || '') * SPAN / MIN) * MIN;
  function wake(t) { const d = new Date(t); if (d.getHours() < C.wakeHour) { d.setHours(C.wakeHour, 0, 0, 0); return d.getTime(); } return t; }
  function fit(id, now, raw) {
    let t = wake(raw);
    if (EXAM !== null) {
      if (now >= CUTOFF && now < EXAM) t = EXAM;
      else if (now < EXAM) { let cap; if (now < SLOT0) cap = slot(id); else { cap = CUTOFF; if (cap <= now) cap = EXAM; } if (t > cap) t = cap; }
    }
    return { due: t, moved: t !== raw };
  }
  function grade(c, g, now, id) {
    const n = copy(c), prev = n.last; let raw;
    n.reps++; n.last = now;
    if (n.s === 'new') { n.s = 'learning'; n.step = 0; }
    if (n.s === 'learning' || n.s === 'relearning') {
      const relearning = n.s === 'relearning', steps = relearning ? C.relearn : C.steps;
      if (g === 1) { n.step = 0; raw = now + steps[0]; }
      else if (g === 2) raw = now + (n.step === 0 && steps.length > 1 ? (steps[0] + steps[1]) / 2 : steps[n.step]);
      else if (g === 3) { n.step++; if (n.step >= steps.length) { n.s = 'review'; n.step = 0; if (!relearning) n.ivl = C.grad; raw = now + n.ivl; } else raw = now + steps[n.step]; }
      else { n.s = 'review'; n.step = 0; n.ivl = relearning ? n.ivl * 1.5 : C.easyGrad; raw = now + n.ivl; }
    } else {
      const elapsed = Math.max(0, now - prev), ivl = n.ivl || C.grad;
      const base = elapsed >= ivl ? ivl + (elapsed - ivl) / 2 : (ivl + elapsed) / 2;
      if (g === 1) { n.lapses++; n.ease = Math.max(C.minEase, n.ease - C.lapseDrop); n.s = 'relearning'; n.step = 0; n.ivl = Math.max(C.grad, ivl * 0.5); raw = now + C.relearn[0]; if (n.lapses >= C.leech) { n.leech = true; n.leechSeen = false; } }
      else if (g === 2) { n.ivl = Math.max(base * C.hardMul, 10 * MIN); n.ease = Math.max(C.minEase, n.ease - C.hardDrop); raw = now + n.ivl; }
      else if (g === 3) { n.ivl = base * n.ease; raw = now + n.ivl; }
      else { n.ivl = base * n.ease * C.easyMul; n.ease += C.easyRise; raw = now + n.ivl; }
    }
    const f = fit(id, now, raw); n.due = f.due; n.moved = f.moved; return n;
  }
  function introduce(c, now, id) { const n = copy(c); n.s = 'learning'; n.step = 0; n.reps++; n.last = now; n.intro = 1; const f = fit(id, now, now + C.steps[0]); n.due = f.due; n.moved = f.moved; return n; }
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const clock = t => { const d = new Date(t); return DAYS[d.getDay()] + ' ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); };
  function label(now, n) { const d = n.due - now; if (n.moved) return clock(n.due); if (d < HOUR) return Math.max(1, Math.round(d / MIN)) + 'm'; if (d < 24 * HOUR) return Math.round(d / HOUR) + 'h'; return Math.round(d / (24 * HOUR)) + 'd'; }
  // First sight of a card a read lesson taught: a self-rated recall from new; Easy graduates at the normal interval.
  function firstRecall(c, g, now, id) { const n = grade(c, g, now, id); if (g === 4) { n.ivl = C.grad; const f = fit(id, now, now + C.grad); n.due = f.due; n.moved = f.moved; } return n; }
  function preview(c, now, id, first) { const o = {}; for (let g = 1; g <= 4; g++) { const n = (first ? firstRecall : grade)(c, g, now, id); o[g] = { due: n.due, label: label(now, n) }; } return o; }
  function recall(c, t) {
    if (!c || c.s === 'new' || !c.last) return 0;
    const S = c.s === 'review' ? c.ivl : c.s === 'relearning' ? Math.min(c.ivl, 10 * MIN) : C.steps[Math.min(c.step, C.steps.length - 1)];
    return t <= c.last ? 1 : Math.pow(0.9, (t - c.last) / S);
  }
  const readyAt = c => c.last ? c.last + Math.ceil(C.aheadFrac * Math.max(0, c.due - c.last)) : c.due;
  const beforeCut = now => CUTOFF === null || now < CUTOFF;
  const aheadOK = (c, now) => beforeCut(now) && c.due <= now + C.learnAhead && now >= readyAt(c);
  function nextReady(deck, cards, now) {
    let best = null;
    for (const d of deck) {
      const c = cards[d.id];
      if (!c || (c.s !== 'learning' && c.s !== 'relearning') || (EXAM !== null && c.due >= EXAM)) continue;
      const r = Math.min(c.due, beforeCut(now) ? Math.max(readyAt(c), c.due - C.learnAhead) : c.due);
      if (best === null || r < best) best = r;
    }
    return best;
  }
  const isNew = (cards, id) => { const c = cards[id]; return !c || c.s === 'new'; };
  function newBatch(deck, cards, n, exclude = {}) {
    const out = [], ids = {};
    for (const d of [...deck].sort((a, b) => a.order - b.order)) {
      if (out.length >= n) break;
      if (!isNew(cards, d.id) || exclude[d.id] || (d.pair && ids[d.pair])) continue;
      out.push(d.id); ids[d.id] = 1;
    }
    return out;
  }
  function pickNext(deck, cards, now, sess = {}) {
    const lastId = sess.lastId, learn = [], rev = [], ahead = [];
    for (const d of deck) {
      const c = cards[d.id]; if (!c || c.s === 'new') continue;
      if (c.s === 'learning' || c.s === 'relearning') { if (c.due <= now) learn.push(d.id); else if (aheadOK(c, now)) ahead.push(d.id); }
      else if (c.due <= now) rev.push(d.id);
    }
    const byDue = (a, b) => cards[a].due - cards[b].due;
    const first = l => !l.length ? null : (l.length > 1 && l[0] === lastId ? l[1] : l[0]);
    const nextNew = () => (sess.batch || []).find(id => isNew(cards, id)) || null;
    const nextExtra = () => (sess.extra || []).find(id => !(sess.extraDone || {})[id] && id !== lastId) || null;
    learn.sort(byDue); rev.sort(byDue); ahead.sort(byDue);
    let pick = null, kind = null, o;
    if (learn.length && !(learn.length === 1 && learn[0] === lastId && (rev.length || nextNew()))) { pick = first(learn); kind = 'learn'; }
    else if (rev.length) { pick = first(rev); kind = 'review'; }
    else if ((o = nextNew())) { pick = o; kind = 'new'; }
    else if (sess.extra && (o = nextExtra())) { pick = o; kind = 'ahead'; }
    else if (learn.length) { pick = learn[0]; kind = 'learn'; }
    else if (ahead.length) { pick = first(ahead); kind = 'learn-ahead'; }
    return pick ? { id: pick, kind } : null;
  }
  function counts(deck, cards, now, batch) {
    const o = { learn: 0, review: 0, fresh: 0, newLeft: 0, seen: 0 };
    for (const d of deck) { const c = cards[d.id]; if (!c || c.s === 'new') { o.newLeft++; continue; } o.seen++; if (c.due <= now) { if (c.s === 'review') o.review++; else o.learn++; } }
    for (const id of batch || []) if (isNew(cards, id)) o.fresh++;
    return o;
  }
  const at = () => EXAM !== null ? EXAM : Date.now() + 86400000;
  const weakest = (deck, cards, n) => deck.filter(d => !isNew(cards, d.id)).map(d => ({ id: d.id, r: recall(cards[d.id], at()) })).sort((a, b) => a.r - b.r).slice(0, n).map(x => x.id);
  const leeches = (deck, cards) => deck.filter(d => { const c = cards[d.id]; return c && c.leech && !c.leechSeen; }).map(d => d.id);
  return { CFG: C, EXAM, CUTOFF, fresh, grade, introduce, firstRecall, preview, fit, wake, slot, label, clock, recall, readyAt, aheadOK, nextReady, newBatch, pickNext, counts, weakest, leeches };
}

// ── small DOM helpers ───────────────────────────────────────────────────────────────────────────────────────────
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function btn(cls, text, fn) { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', ev => { fn(ev); }); return b; }
function kbd(b, k) { b.appendChild(el('kbd', null, k)); return b; }
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const fmtMin = m => m < 60 ? m + 'm' : Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
const fmtMs = ms => ms > 0 && ms < 60000 ? '<1m' : fmtMin(Math.round(ms / 60000));
const pct = x => x == null ? '—' : Math.round(100 * x) + '%';
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const rid = () => (globalThis.crypto?.randomUUID?.() || 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
const dayKey = t => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const LETTERS = 'ABCDEF';

async function defaultApi(u, opts) {
  const r = await fetch(u, opts); const body = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(body.error || 'HTTP ' + r.status); e.status = r.status; e.body = body; throw e; }
  return body;
}

export class CourseCards {
  constructor(host, opts = {}) {
    this.host = host; this.o = opts;
    this.api = opts.api || defaultApi; this.url = opts.url || (p => p);
    this.root = el('div', 'cc'); host.appendChild(this.root);
    this.D = null; this.S = null; this.rev = 0; this.sum = null; this.off = 0;
    this.view = null; this.sess = null; this.cur = null; this.mode = 'path';
    this.timers = []; this.queue = Promise.resolve(); this.opened = false; this.lastAct = 0; this.pendingMs = 0;
    this.decks = []; this.deckId = null; this.note = '';
    this.gen = 0; this.revs = {}; this.latest = {};   // load generation; newest known revision/state per deck
    this.onKey = e => this._key(e);
    this.onAct = () => this._activity();
  }

  // ── lifecycle ──
  async open(deckId) {
    this.opened = true;
    const g = ++this.gen;   // a later open() wins; a slow earlier one never replaces its view
    document.removeEventListener('keydown', this.onKey); this.root.removeEventListener('pointerdown', this.onAct);
    document.addEventListener('keydown', this.onKey);
    this.root.addEventListener('pointerdown', this.onAct);
    try {
      if (!this.decks.length || (deckId && !this.decks.some(d => d.deck_id === deckId))) {
        const ds = (await this.api(this.url('/api/course-cards'))).decks || [];
        if (g !== this.gen) return;
        this.decks = ds;
      }
      const want = deckId || this.deckId || (this.decks.find(d => d.deck_id === '5680') || this.decks[0] || {}).deck_id;
      if (!want) { this._clear(); this.root.appendChild(el('p', 'cc-sub', 'No card decks are installed.')); return; }
      if (!(await this._load(want, g))) return;
      this.render();
    } catch (e) { if (g === this.gen) this._fail(e); }
  }
  close() {
    this._flushTime();
    this.opened = false;
    document.removeEventListener('keydown', this.onKey);
    this.root.removeEventListener('pointerdown', this.onAct);
    this._stopTimers();
  }
  context() {
    if (!this.D) return null;
    return { kind: 'card', course_id: this.D.course_id, deck_id: this.D.deck_id, item_id: this.cur || null, mode: this.mode };
  }

  async _load(deckId, g) {
    const p = await this.api(this.url('/api/course-cards/' + encodeURIComponent(deckId)));
    if (g !== this.gen) return false;
    const L = this.latest[deckId];   // an action answered after this read started carries newer state
    if (L && typeof p.revision === 'number' && L.revision > p.revision) Object.assign(p, L);
    const fresh = deckId !== this.deckId;
    if (fresh) { this._flushTime(); this.view = null; this.sess = null; this.rev = -1; }
    this.deckId = deckId; this.D = p;
    this.sch = makeSched(p.sched || {});
    this.card = {}; p.cards.forEach(c => { this.card[c.id] = c; });
    this.allCards = p.cards;
    this.Q = {}; p.questions.forEach(q => { this.Q[q.id] = q; });
    this.mods = p.modules; this.M = {}; p.modules.forEach(m => { this.M[m.n] = m; });
    this.tex = p.course_id === '2301';
    this._take(p, deckId);
    if (fresh) this._resume();
    return true;
  }
  // After a page reload, reopen where the server last saw the learner (the card session itself restarts by picking).
  _resume() {
    const pos = this.S.pos, S = this.S; if (!pos || !pos.mode) return;
    const id = pos.item_id || '', lm = /^lesson:(\d+):/.exec(id);
    if (pos.mode === 'lesson' && lm && this.M[+lm[1]]) this.view = { name: 'lesson', m: +lm[1] };
    else if (pos.mode === 'check' && S.run) this.view = { name: 'q', mode: 'check', m: S.run.module, ids: S.run.ids, i: this._firstOpen(S.run), res: [], right: 0, orders: {} };
    else if (pos.mode === 'diagnostic' && S.diag && !S.diag.done) this.view = { name: 'q', mode: 'diagnostic', ids: S.diag.ids, i: this._firstOpen(S.diag), res: [], right: 0, orders: {} };
    else if (pos.mode === 'mock' && S.mock && !S.mock.done) this.view = { name: 'mock' };
    else if (pos.mode === 'card' || pos.mode === 'wait') {
      const ss = pos.sess, c = this.card[id];
      if (!ss && !c) return;
      const opt = ss ? { module: ss.m || 0, ahead: ss.ahead, review: ss.review, xd: ss.xd } : { module: c.module };
      // an unfinished card reopens exactly as it was; a finished one (pos.done, or old saves without a phase) never does
      if (pos.mode === 'card' && c && !pos.done && pos.phase && this._canResume(id, pos)) opt.resume = { id, kind: pos.kind, phase: pos.phase };
      this.startSession(opt);
    }
  }
  _canResume(id, pos) {
    if (pos.phase === 'intro') return this.isNew(id) && !this._firstRecall(id);
    if (this.isNew(id)) return this._firstRecall(id) && ['front', 'back'].includes(pos.phase);
    return ['front', 'back', 'again'].includes(pos.phase);
  }
  // A new card whose lesson section (as it stood when read) states its answer opens as a recall check, not
  // answer-first. Only offered when the server says it supports the first-recall grade.
  _firstRecall(id) {
    const d = this.card[id], tw = d && d.taught;
    if (!tw || !(this.D.caps || []).includes('first_recall') || !this.isNew(id)) return false;
    const r = (this.S.read || {})[String(d.module)];
    return typeof r === 'number' && r >= tw.since;
  }
  _sessPos() { const s = this.sess; return s ? { m: s.m || 0, ahead: !!s.ahead, review: !!s.review, xd: Object.keys(s.extraDone || {}).slice(-60) } : undefined; }
  _firstOpen(run) { let i = 0; while (i < run.ids.length && run.ans[run.ids[i]] !== undefined) i++; return i; }
  // Adopts a server answer for deck; answers for another deck or older than what is shown only update the per-deck record.
  _take(p, deck) {
    if (typeof p.revision === 'number' && p.state) {
      const L = this.latest[deck];
      if (!L || p.revision >= L.revision) this.latest[deck] = { revision: p.revision, state: p.state, summary: p.summary };
      this.revs[deck] = Math.max(this.revs[deck] ?? -1, p.revision);
    }
    if (deck !== this.deckId || (typeof p.revision === 'number' && p.revision < this.rev)) return false;
    if (p.state) { this.S = p.state; this.D.cards = this.allCards.filter(c => !this._resting(c)); }
    if (typeof p.revision === 'number') this.rev = p.revision;
    if (p.summary) this.sum = p.summary;
    if (typeof p.now === 'number') this.off = p.now - Date.now();
    this._emit();
    return true;
  }
  // Optional cards repeat another card: never introduced; once seen they rest after a clean graduation.
  _resting(d) { const c = this.S.cards[d.id]; return !!d.optional && (!c || c.s === 'new' || (c.s === 'review' && !c.lapses)); }
  now() { return Date.now() + this.off; }
  _emit() {
    if (!this.o.onState || !this.D || !this.S) return;
    const c = this.sch.counts(this.D.cards, this.S.cards, this.now());
    try { this.o.onState({ deck_id: this.D.deck_id, due: c.learn + c.review, new: c.newLeft, mode: this.mode }); } catch (e) { /* the badge is optional */ }
  }

  // Every change goes through the server in order; a stale revision reloads state and redraws, never applies.
  act(action, extra = {}) {
    // Bound to the deck it was made on: switching decks never redirects a queued grade, time or position.
    const deck = this.D.deck_id;
    const body = { action, revision: this.revs[deck] ?? this.rev, request_id: rid(), ...extra };
    const gone = () => Object.assign(new Error('deck changed'), { stale: true, superseded: true });
    const run = async () => {
      body.revision = this.revs[deck] ?? body.revision;
      const send = () => this.api(this.url('/api/course-cards/' + encodeURIComponent(deck) + '/act'),
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      let r;
      try { r = await send(); }
      catch (e) {
        if (e.status === 409 && e.body && e.body.error === 'stale') {
          if (!this._take(e.body, deck)) throw gone();
          this.note = 'Updated from another window. Nothing was graded twice.'; this.render(); throw Object.assign(new Error('stale'), { stale: true });
        }
        if (e.status) throw e;
        r = await send();   // network blip: the same request id can only apply once
      }
      // position/time never move the revision; adopting their state here would silently skip a stale check
      if (QUIET.has(action)) { if (deck === this.deckId && typeof r.now === 'number') this.off = r.now - Date.now(); }
      else if (this._take(r, deck)) this.note = '';
      else if (deck !== this.deckId) throw gone();   // committed on its own deck; this view has moved on
      return r.result || {};
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }
  _soft(action, extra) { return this.act(action, extra).catch(() => {}); }
  _activity() {
    const t = Date.now();
    if (this.lastAct && t - this.lastAct <= 60000) this.pendingMs += t - this.lastAct;
    this.lastAct = t;
    if (this.pendingMs >= 30000) this._flushTime();
  }
  _flushTime() { const ms = Math.min(120000, Math.round(this.pendingMs)); this.pendingMs = 0; if (ms > 0 && this.D) this._soft('time', { ms }); }
  _fail(e) {
    if (e && e.stale) return;
    this._clear();
    const b = el('div', 'cc-done');
    b.appendChild(el('h2', 'cc-title', 'Cards could not load'));
    b.appendChild(el('p', 'cc-sub', String(e && e.message || e)));
    b.appendChild(btn('cc-btn', 'Try again', () => this.open(this.deckId)));
    this.root.appendChild(b);
  }
  _stopTimers() { this.timers.forEach(clearInterval); this.timers = []; }
  _clear(mode, item) {
    this._stopTimers(); this.keys = null;
    this.root.textContent = ''; this.root.className = 'cc';
    if (mode) this._pos(mode, item || null, false);
    if (this.host.scrollTo) this.host.scrollTo(0, 0);
  }
  // Where the learner is, so the teacher sees the same item; never grades or advances anything.
  _pos(mode, item, revealed, module, ex) {
    const key = JSON.stringify(ex || null);
    const changed = this.mode !== mode || this.cur !== item || this._revealed !== revealed || this._posKey !== key;
    this.mode = mode; this.cur = item; this._revealed = revealed; this._posKey = key;
    if (changed && this.D) this._soft('position', { mode, item_id: item, revealed: !!revealed, ...(module ? { module } : {}), ...(ex || {}) });
    this._emit();
  }
  _key(e) {
    if (!this.opened || !this.keys) return;
    const t = e.target, tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
    if (t && t !== document.body && !this.root.contains(t)) return;
    if (!this.root.isConnected || !this.root.offsetParent) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    this._activity();
    this.keys(e);
  }
  render() {
    if (!this.opened || !this.D) return;
    const v = this.view;
    if (!v) return this.home();
    const fn = this['v_' + v.name];
    if (fn) fn.call(this, v); else this.home();
  }
  _go(name, args = {}) { this.view = { name, ...args }; this.render(); }
  _tx(node) { if (this.tex) math(node); return node; }

  // ── shared chrome ──
  _top(back, label, mod) {
    const top = el('div', 'cc-top');
    top.appendChild(btn('cc-btn cc-ghost', '← ' + (back === 'exam' ? 'Exam' : 'Path'), () => back === 'exam' ? this._go('exam') : this.home()));
    if (mod) top.appendChild(el('span', 'cc-tag m' + mod, this._mtag(mod)));
    if (label) top.appendChild(el('span', 'cc-mode', label));
    if (this.note) { const msg = el('p', 'cc-note', this.note); this.note = ''; queueMicrotask(() => { if (top.isConnected) top.after(msg); }); }
    return top;
  }
  _mtag(m) { return this.tex ? 'U' + m : 'M' + m; }
  // before() points the position at a sub-item (lesson section, mock review row) first.
  _ask(label = 'Ask about this', before) {
    const b = btn('cc-btn cc-ask', label, async () => {
      if (before) before();
      try { await this.queue; } catch (e) { /* position is best effort */ }
      if (this.o.onAsk) this.o.onAsk(this.context());
    });
    b.title = 'Ask the tutor about this item. It does not grade or move on.';
    return b;
  }
  _deckTabs() {
    if (this.decks.length < 2) return null;
    const t = el('div', 'cc-decks');
    this.decks.forEach(d => {
      const b = btn('cc-deck' + (d.deck_id === this.D.deck_id ? ' on' : ''), d.title, () => { if (d.deck_id !== this.D.deck_id) this.open(d.deck_id); });
      if (d.due) b.appendChild(el('span', 'cc-due', String(d.due)));
      t.appendChild(b);
    });
    return t;
  }
  _countdown() {
    const ex = this.D.sched && this.D.sched.exam; if (!ex) return '';
    const d = ex - this.now(); if (d <= 0) return 'The exam time has passed. ';
    const h = Math.floor(d / 3600000), days = Math.floor(h / 24);
    return 'Exam ' + (this.D.exam_label || '') + ' · in ' + (days ? plural(days, 'day') + ' ' : '') + plural(h % 24, 'hour') + '. ';
  }

  // ── path (home) ──
  modCards(m) { return this.D.cards.filter(c => c.module === m); }
  isNew(id) { const c = this.S.cards[id]; return !c || c.s === 'new'; }
  checkIds(m) { return (this.M[m]?.check || []).filter(id => this.Q[id]); }
  stepOf(m) {
    const M = this.M[m];
    if (M.sections && M.sections.length && !this.S.read[m]) return 'lesson';
    if (this.checkIds(m).length && !this.S.checks[m]) return 'check';
    if (this.modCards(m).some(c => this.isNew(c.id))) return 'cards';
    return null;
  }
  nextStep() { for (const m of this.mods) { const s = this.stepOf(m.n); if (s) return { m: m.n, s }; } return null; }
  openStep(m, s) { if (s === 'lesson') this._go('lesson', { m }); else if (s === 'check') this.startCheck(m); else this.startSession({ module: m }); }
  modStats(m) {
    const ex = this.sch.EXAM ?? this.now() + 86400000; let seen = 0, solid = 0; const ds = this.modCards(m);
    ds.forEach(d => { const c = this.S.cards[d.id]; if (c && c.s !== 'new') { seen++; if (this.sch.recall(c, ex) >= 0.9) solid++; } });
    return { total: ds.length, seen, solid };
  }

  home() {
    this.view = null; this.sess = null;
    this._clear('path');
    const S = this.S, D = this.D, t = this.now(), o = this.sch.counts(D.cards, S.cards, t), due = o.learn + o.review;
    const tabs = this._deckTabs(); if (tabs) this.root.appendChild(tabs);
    const head = el('div', 'cc-head');
    head.appendChild(el('h1', 'cc-title', D.title));
    if (this.o.onExit) head.appendChild(btn('cc-btn cc-ghost cc-exit', 'Close', () => this.o.onExit()));
    this.root.appendChild(head);
    this.root.appendChild(el('p', 'cc-sub', this._countdown() + (this.tex
      ? 'Method cards from the worked lessons: read the overview, then learn the cards. ' + (D.note || '')
      : 'Each module: read a short lesson, answer a quick check, then learn its cards.')));
    if (this.note) this.root.appendChild(el('p', 'cc-note', this.note));
    if (due) {
      const bn = el('div', 'cc-due-banner'), bt = el('div');
      bt.appendChild(el('b', null, plural(due, 'card') + ' due')); bt.appendChild(el('span', null, ' · from earlier sessions'));
      bn.appendChild(bt);
      const secRev = this.sum?.time_left?.sec_rev || 8;
      bn.appendChild(kbd(btn('cc-btn cc-primary', 'Review (≈ ' + fmtMin(Math.max(1, Math.ceil(due * secRev / 60))) + ')', () => this.startSession({ review: true })), 'r'));
      this.root.appendChild(bn);
    }
    // resume what was left open
    const res = [];
    if (S.run) res.push(['Resume ' + this._mtag(S.run.module) + ' check · ' + Object.keys(S.run.ans).length + '/' + S.run.ids.length + ' answered', () => this.runQs({ mode: 'check', m: S.run.module, ids: S.run.ids })]);
    if (S.diag && !S.diag.done) res.push(['Resume the diagnostic · ' + Object.keys(S.diag.ans).length + '/' + S.diag.ids.length + ' answered', () => this.runQs({ mode: 'diagnostic', ids: S.diag.ids })]);
    if (S.mock && !S.mock.done) res.push(['Resume mock exam · ' + S.mock.ans.filter(a => a >= 0).length + '/' + S.mock.ids.length + ' answered', () => this._go('mock')]);
    res.forEach(([l, f]) => { const r = btn('cc-resume', l, f); this.root.appendChild(r); });

    const ns = this.nextStep(), diagFirst = D.diagnostic && D.diagnostic.length && !S.diag1 && !S.diag && !(S.cards && Object.keys(S.cards).length);
    const cont = el('button', 'cc-cont'); cont.type = 'button';
    let title, small, go;
    if (diagFirst) {
      title = 'Start · quick diagnostic'; small = D.diagnostic.length + ' real quiz questions, about 5 minutes. Shows which module needs you most. Not graded.';
      go = () => this.startDiag();
    } else if (ns) {
      cont.classList.add('m' + ns.m);
      const L = this.M[ns.m], st = this.modStats(ns.m);
      title = 'Continue · ' + this._mtag(ns.m) + ' ' + ({ lesson: this.tex ? 'overview' : 'lesson', check: 'check', cards: 'cards' })[ns.s];
      small = ns.s === 'lesson' ? L.title + ' · ' + L.minutes + ' min read' : ns.s === 'check' ? this.checkIds(ns.m).length + ' quick questions on the lesson' : (st.total - st.seen) + ' of ' + st.total + ' cards still new';
      go = () => this.openStep(ns.m, ns.s);
    } else if (due) { title = 'Review due cards'; small = 'Every card has been introduced'; go = () => this.startSession({ review: true }); }
    else { const w = this.idle(); title = w.title; small = w.small; go = w.go; }
    cont.appendChild(el('span', 'cc-cdot'));
    const ct = el('span', 'cc-ct'); ct.appendChild(el('b', null, title)); ct.appendChild(el('small', null, small)); cont.appendChild(ct);
    cont.appendChild(kbd(el('span', 'cc-go', '→'), 'space'));
    cont.addEventListener('click', go);
    this.root.appendChild(cont);
    if (diagFirst && ns) this.root.appendChild(btn('cc-link', 'Skip it and start ' + this._mtag(ns.m) + ' ' + ns.s, () => this.openStep(ns.m, ns.s)));

    const pms = el('div', 'cc-pms');
    this.mods.forEach(M => {
      const m = M.n, st = this.modStats(m), ids = this.checkIds(m), ck = S.checks[m];
      const row = el('section', 'cc-pm m' + m + (ns && ns.m === m ? ' next' : '')), h = el('div', 'cc-pm-head');
      h.appendChild(el('span', 'cc-mt', this._mtag(m))); h.appendChild(el('span', 'cc-nm', M.title)); row.appendChild(h);
      const chips = el('div', 'cc-chips');
      const chip = (label, value, cls, fn) => {
        const c = el('button', 'cc-chip ' + (cls || '')); c.type = 'button'; c.dataset.step = label.toLowerCase();
        c.appendChild(el('span', 'cl', label)); c.appendChild(el('span', 'cv', value));
        if (fn) c.addEventListener('click', fn); else c.disabled = true;
        chips.appendChild(c); return c;
      };
      if (M.sections && M.sections.length) chip(this.tex ? 'Overview' : 'Lesson', S.read[m] ? 'Read' : M.minutes + ' min', S.read[m] ? 'ok' : '', () => this._go('lesson', { m }));
      if (ids.length) chip('Check', ck ? 'Best ' + ck.best + '/' + ck.n : 'Not taken', ck ? 'ok' : '', () => this.startCheck(m));
      else if (!this.tex) chip('Check', '—', 'soon');
      const cc = chip('Cards', st.seen + '/' + st.total + ' · ' + st.solid + ' solid', '', () => this.startSession({ module: m }));
      const cb = el('span', 'cc-cbar'), ci = el('i'); ci.style.width = (st.total ? 100 * st.seen / st.total : 0) + '%'; cb.appendChild(ci); cc.appendChild(cb);
      row.appendChild(chips); pms.appendChild(row);
    });
    this.root.appendChild(pms);
    this.root.appendChild(this._tiles());
    const nav = el('div', 'cc-row-btns');
    if (D.questions.length) nav.appendChild(btn('cc-btn', 'Exam practice', () => this._go('exam')));
    nav.appendChild(btn('cc-btn', 'Progress', () => this._go('progress')));
    if (D.diagnostic && D.diagnostic.length && (S.diag1 || S.diag)) nav.appendChild(btn('cc-btn cc-ghost', S.diag1 ? 'Diagnostic: ' + S.diag1.right + '/' + S.diag1.n : 'Diagnostic', () => S.diag && S.diag.done ? this._go('diagdone') : S.diag ? this.runQs({ mode: 'diagnostic', ids: S.diag.ids }) : this.startDiag()));
    this.root.appendChild(nav);
    const lee = D.cards.filter(d => { const c = S.cards[d.id]; return c && c.leech; });
    if (lee.length) {
      this.root.appendChild(el('h2', 'cc-h3', 'Keeps slipping'));
      lee.forEach(d => { const x = el('div', 'cc-leech'); x.appendChild(this._tx(el('div', 'f', d.front))); x.appendChild(this._tx(el('div', 'b', d.hook || d.back))); this.root.appendChild(x); });
    }
    this.root.appendChild(this._settings());
    this.keys = e => {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); cont.click(); }
      else if ((e.key === 'r' || e.key === 'R') && due) this.startSession({ review: true });
    };
  }
  // Nothing due and every card introduced: a real next activity, never a fake "done".
  idle() {
    const D = this.D, S = this.S;
    const r = this.sch.nextReady(D.cards, S.cards, this.now());
    if (D.questions.length && S.missed.length) return { title: 'Clear your missed pile', small: plural(S.missed.length, 'question') + ' you got wrong last time', go: () => this.startPractice('missed') };
    if (D.questions.length && !S.mock1) return { title: 'Take the first mock exam', small: '50 questions, scored at the end. Includes 12 questions you have never seen.', go: () => this._go('exam') };
    if (D.questions.length) return { title: 'Real quiz questions', small: 'Nothing due' + (r ? ' until ' + this.sch.clock(r) : '') + '. Practise the ' + D.quiz_ids.length + ' real quiz questions meanwhile.', go: () => this.startPractice('quiz') };
    return { title: 'Extra practice', small: 'Nothing due right now. Run your 20 weakest cards; ratings are saved as practice and do not move when cards come due.', go: () => this.startSession({ ahead: true }) };
  }
  _tiles() {
    const S = this.S, sum = this.sum || {}, mini = el('div', 'cc-mini');
    const tile = (n, l, cls, rng) => { const x = el('div', 'cc-tile ' + (cls || '')), nn = el('div', 'n', n); if (rng) nn.appendChild(el('span', 'rng', rng)); x.appendChild(nn); x.appendChild(el('div', 'l', l)); mini.appendChild(x); return x; };
    tile(pct(sum.card_memory || 0), 'Card memory, from your own ratings: cards likely recalled at ' + (this.D.exam_label || 'the exam') +
      (sum.hard ? ' (' + plural(sum.hard, 'card') + ' last rated Hard)' : ''));
    const pr = sum.practice;   // independent practice and mock answers only: no checks, no helped answers
    if (pr) {
      if (!pr.enough) tile('—', 'Practice accuracy: not enough independent answers yet (' + pr.n + ' of 20)', 'dim');
      else tile(pr.ok + '/' + pr.n, 'Practice accuracy: independent practice and mock answers');
    }
    if (S.mock1) tile(pct(S.mock1.right / S.mock1.n), 'First mock exam, first try: ' + S.mock1.right + '/' + S.mock1.n, 'mock1');
    const tl = sum.time_left;
    if (tl) tile('≈' + fmtMin(tl.min), tl.cards_only ? 'Card time left (if every answer is Good)' : 'Est. study time left');
    const box = el('div'); box.appendChild(mini);
    if (tl && tl.cards_only) box.appendChild(el('p', 'cc-est', 'Card time only: lessons' + (tl.lessons_min ? ' (about ' + fmtMin(tl.lessons_min) + ' left)' : '') +
      ', checks, the mock exam and breaks are not included, and Again or Hard answers add time.' +
      (tl.rev_samples ? '' : ' Review pace is not measured yet, so it uses a default of 8 s per review.')));
    box.appendChild(el('p', 'cc-est', 'Rough estimates from your own answers and pace. Card ratings are your self-rating, not an exam grade.'));
    return box;
  }
  _settings() {
    const d = el('details', 'cc-settings'); d.appendChild(el('summary', null, 'Settings'));
    const lab = el('label', null, 'New cards per batch '), sel = el('select');
    [5, 8, 12, 16].forEach(n => { const o = el('option', null, String(n)); o.value = n; if (n === this.S.batch) o.selected = true; sel.appendChild(o); });
    const msg = el('span', 'cc-set-msg');
    sel.addEventListener('change', () => this.act('batch', { n: +sel.value }).then(() => { msg.textContent = 'Saved.'; }, e => { msg.textContent = e.message; }));
    lab.appendChild(sel); d.appendChild(lab); d.appendChild(msg);
    return d;
  }

  // ── lesson ──
  v_lesson({ m }) {
    const L = this.M[m]; this._clear('lesson', 'lesson:' + m + ':0'); this.root.classList.add('m' + m);
    const wrap = el('article', 'cc-lesson'), top = this._top('path', (this.tex ? 'Overview' : 'Lesson') + ' · ' + L.minutes + ' min', m);
    wrap.appendChild(top);
    wrap.appendChild(this._tx(el('h1', null, L.title)));
    if (L.intro && !this.tex) wrap.appendChild(el('p', 'cc-intro', L.intro));
    L.sections.forEach((s, i) => {
      const sec = el('section', 'cc-sec'), h = el('h2'); h.appendChild(el('span', 'sn', String(i + 1))); h.appendChild(document.createTextNode(s.h)); sec.appendChild(h);
      renderBody(s.body, sec);
      if (s.svg) { const f = el('figure', 'cc-dia'); f.dataset.dia = s.diagram || ''; f.innerHTML = s.svg; sec.appendChild(f); }
      if (s.key) { const k = el('div', 'cc-keyline'); k.appendChild(el('b', null, 'Key takeaway')); k.appendChild(document.createTextNode(s.key)); sec.appendChild(k); }
      sec.appendChild(this._ask('Ask about this section', () => this._pos('lesson', 'lesson:' + m + ':' + i, true)));
      wrap.appendChild(this._tx(sec));
    });
    const n = this.checkIds(m).length, end = el('div', 'cc-lesson-end');
    end.appendChild(el('p', null, n ? 'Next: ' + n + ' quick questions on this lesson, then the module\'s cards.' : 'Next: this module\'s cards.'));
    end.appendChild(el('p', 'cc-fine', 'Reading counts as exposure, not as remembering.'));
    const done = btn('cc-btn cc-primary cc-lg', n ? 'I\'ve read it → Start the check' : 'I\'ve read it → Start the cards', async () => {
      done.disabled = true;
      try { await this.act('read', { module: m }); } catch (e) { done.disabled = false; return; }
      if (n) this.startCheck(m); else this.startSession({ module: m });
    });
    end.appendChild(done); wrap.appendChild(end);
    this.root.appendChild(wrap);
    this.keys = e => { if (e.key === 'Escape') this.home(); };
  }

  // ── questions: lesson check, diagnostic and practice share one runner ──
  async startCheck(m) {
    if (!this.checkIds(m).length) return this.startSession({ module: m });
    try { const r = await this.act('check_start', { module: m }); this.runQs({ mode: 'check', m, ids: r.ids }); } catch (e) { this._fail(e); }
  }
  async startDiag() {
    try { const r = await this.act('diag_start'); this.runQs({ mode: 'diagnostic', ids: r.ids }); } catch (e) { this._fail(e); }
  }
  startPractice(mode) {
    const S = this.S, pool = this.D.questions;
    let ids;
    if (mode === 'missed') ids = S.missed.filter(id => this.Q[id]);
    else if (mode === 'all') ids = pool.map(q => q.id);
    else if (mode === 'quiz') ids = this.D.quiz_ids.slice();
    else ids = pool.filter(q => q.module === mode).map(q => q.id);
    if (!ids.length) return this._go('exam');
    this.runQs({ mode, ids: shuffle(ids) });
  }
  runQs({ mode, m, ids }) {
    const answered = mode === 'check' ? this.S.run?.ans : mode === 'diagnostic' ? this.S.diag?.ans : null;
    const res = [];
    let i = 0;
    if (answered) { while (i < ids.length && answered[ids[i]] !== undefined) i++; }
    this._go('q', { mode, m, ids, i, res, right: 0, orders: {} });
  }
  _qTitle(mode) { return mode === 'check' ? 'check' : mode === 'diagnostic' ? 'Diagnostic' : mode === 'missed' ? 'Missed pile' : mode === 'all' ? 'All shuffled' : mode === 'quiz' ? 'Real quiz questions' : 'Module ' + mode; }
  v_q(v) {
    const back = v.mode === 'check' || v.mode === 'diagnostic' ? 'path' : 'exam';
    if (v.i >= v.ids.length) return this._qDone(v);
    const q = this.Q[v.ids[v.i]];
    if (!q) { v.i++; return this.v_q(v); }
    const r = v.res[v.i];
    this._clear(); this.root.classList.add('m' + q.module);
    this._pos(v.mode === 'check' ? 'check' : v.mode === 'diagnostic' ? 'diagnostic' : 'quiz', q.id, !!r);
    const top = this._top(back, v.mode === 'check' ? this._mtag(v.m) + ' check' : this._qTitle(v.mode), q.module);
    top.appendChild(el('span', 'cc-cnt', (v.i + 1) + ' / ' + v.ids.length));
    this.root.appendChild(top);
    const p = el('div', 'cc-progress'), pi = el('i'); pi.style.width = (100 * v.i / v.ids.length) + '%'; p.appendChild(pi); this.root.appendChild(p);
    this.root.appendChild(el('p', 'cc-stem', q.stem));
    const order = v.orders[q.id] || (v.orders[q.id] = shuffle(q.options.map((_, k) => k)));
    const opts = el('div', 'cc-opts'), btns = [];
    order.forEach((oi, k) => {
      const b = el('button', 'cc-opt'); b.type = 'button';
      b.appendChild(el('span', 'k', LETTERS[k])); b.appendChild(el('span', 'x', q.options[oi]));
      b.addEventListener('click', () => answer(k)); btns.push(b); opts.appendChild(b);
    });
    this.root.appendChild(opts);
    const after = el('div'); this.root.appendChild(after);
    const tail = el('div', 'cc-qtail'); tail.appendChild(el('span', 'cc-keys', 'Keys 1–4 or A–D · Enter for next')); this.root.appendChild(tail);
    let busy = false;
    const show = r => {
      btns.forEach((b, j) => { b.disabled = true; const oi = order[j]; if (oi === r.answer) b.classList.add('right'); else if (oi === r.pick) b.classList.add('wrong'); else b.classList.add('dim'); });
      const w = el('div', 'cc-why'); w.appendChild(el('span', 'v ' + (r.ok ? 'ok' : 'bad'), r.ok ? 'Correct.' : 'Not quite.'));
      if (r.helped) w.appendChild(el('div', 'cc-helped', 'You had help on this one, so it counts as practice, not as known.'));
      if (!r.ok) { w.appendChild(el('div', 'cc-yours', 'Your answer: ' + q.options[r.pick])); w.appendChild(el('div', 'cc-right', 'Correct: ' + q.options[r.answer])); }
      w.appendChild(el('div', 'cc-whytext', r.why));
      w.appendChild(el('div', 'cc-src', q.source));
      if (!r.ok) (r.related || []).forEach(id => { const d = this.card[id]; if (!d) return; const x = el('div', 'cc-rel'); x.appendChild(el('b', null, d.front)); x.appendChild(document.createTextNode(' — ' + d.back)); w.appendChild(x); });
      after.appendChild(w);
      const a = el('div', 'cc-actions');
      const nb = btn('cc-btn cc-primary', v.i + 1 < v.ids.length ? 'Next' : 'Finish', next); a.appendChild(nb); a.appendChild(this._ask());
      after.appendChild(a);
      nb.focus({ preventScroll: true });
    };
    const answer = async k => {
      if (busy || v.res[v.i]) return; busy = true;
      btns.forEach(b => { b.disabled = true; });
      try {
        const out = await this.act('answer', { item_id: q.id, pick: order[k], mode: v.mode === 'check' || v.mode === 'diagnostic' ? v.mode : (v.mode === 'quiz' || v.mode === 'missed' ? v.mode : 'practice') });
        v.res[v.i] = out; if (out.ok && !out.helped) v.right++; else if (out.ok) v.helped = (v.helped || 0) + 1;
        if (out.check_done) v.checkDone = out.check_done;
        if (out.diag_done) v.diagDone = out.diag_done;
        this._pos(this.mode, q.id, true);
        show(out);
      } catch (e) { busy = false; if (e.stale) return; if (e.status === 409) { this.note = e.message; this.home(); return; } btns.forEach(b => { b.disabled = false; }); after.appendChild(el('p', 'cc-err', e.message)); }
    };
    const next = () => { v.i++; this.v_q(v); };
    if (r) show(r);
    this.keys = e => {
      const k = e.key.toLowerCase(); let n = '1234'.indexOf(k); if (n < 0) n = 'abcd'.indexOf(k);
      if (!v.res[v.i] && n >= 0 && n < order.length && k.length === 1) { e.preventDefault(); answer(n); }
      else if (v.res[v.i] && (e.key === 'Enter' || e.key === ' ') && document.activeElement?.tagName !== 'BUTTON') { e.preventDefault(); next(); }
      else if (e.key === 'Escape') back === 'exam' ? this._go('exam') : this.home();
    };
  }
  _qDone(v) {
    if (v.mode === 'check') return this._checkDone(v);
    if (v.mode === 'diagnostic') return this._go('diagdone');
    this._clear('exam');
    this.root.appendChild(el('span', 'cc-kicker', 'Round done'));
    this.root.appendChild(el('h1', 'cc-title', this._qTitle(v.mode)));
    this.root.appendChild(el('p', 'cc-sub', v.right + ' of ' + v.ids.length + ' right on your own' + (v.helped ? ' (+' + v.helped + ' with help)' : '') + '. Missed pile: ' + this.S.missed.length + '.'));
    const a = el('div', 'cc-row-btns');
    a.appendChild(btn('cc-btn', 'Exam practice', () => this._go('exam')));
    if (this.S.missed.length) a.appendChild(btn('cc-btn', 'Missed pile', () => this.startPractice('missed')));
    if (v.mode !== 'missed') a.appendChild(btn('cc-btn cc-primary', 'Go again', () => this.startPractice(v.mode)));
    this.root.appendChild(a);
    this.keys = e => { if (e.key === 'Escape') this._go('exam'); };
  }
  _checkDone(v) {
    const m = v.m, ck = v.checkDone || this.S.checks[m] || { best: v.right, last: v.right, n: v.ids.length, missed: [] };
    this._clear('path'); this.root.classList.add('m' + m);
    this.root.appendChild(el('span', 'cc-kicker', 'Module ' + m + ' check'));
    this.root.appendChild(el('div', 'cc-score', ck.last + ' / ' + ck.n));
    const miss = ck.missed || [];
    const hr = ck.helped || 0;
    this.root.appendChild(el('p', 'cc-sub', (miss.length ? (miss.length === 1 ? '1 miss' : miss.length + ' misses') + ' added to your missed pile. ' : hr ? '' : 'All right. ') +
      (hr ? hr + ' right with help, which the score leaves out. ' : '') + 'Best so far ' + ck.best + '/' + ck.n + '.'));
    const a = el('div', 'cc-row-btns');
    a.appendChild(kbd(btn('cc-btn cc-primary cc-lg', 'Start ' + this._mtag(m) + ' cards', () => this.startSession({ module: m })), 'space'));
    a.appendChild(btn('cc-btn', 'Retake check', () => this.startCheck(m)));
    a.appendChild(btn('cc-btn cc-ghost', 'Path', () => this.home()));
    this.root.appendChild(a);
    if (miss.length) {
      this.root.appendChild(el('h2', 'cc-h3', 'What you missed'));
      miss.forEach(r => {
        const q = this.Q[r.id]; if (!q) return; const box = el('div', 'cc-rev');
        box.appendChild(el('div', 'q', q.stem)); box.appendChild(el('div', 'a y', 'Yours: ' + q.options[r.pick])); box.appendChild(el('div', 'a c', 'Correct: ' + q.options[r.answer])); box.appendChild(el('div', 'w', r.why));
        this.root.appendChild(box);
      });
    }
    this.keys = e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); this.startSession({ module: m }); } else if (e.key === 'Escape') this.home(); };
  }
  v_diagdone() {
    const dg = this.S.diag && this.S.diag.done ? this.S.diag : null;
    this._clear('path');
    if (!dg) return this.home();
    this.root.appendChild(el('span', 'cc-kicker', 'Diagnostic'));
    this.root.appendChild(el('div', 'cc-score', dg.right + ' / ' + dg.ids.length));
    this.root.appendChild(el('p', 'cc-sub', 'A quick read of where you stand, not a grade. Two questions per module is too few for a score; it only points at where to start.' +
      (dg.helped_right ? ' ' + dg.helped_right + ' right with help ' + (dg.helped_right === 1 ? 'is' : 'are') + ' left out of the count.' : '')));
    const rows = el('div', 'cc-res-rows');
    let weak = null, wv = 2;
    this.mods.forEach(M => {
      const p = dg.per[M.n] || [0, 0]; if (!p[1]) return;
      const r = el('div', 'cc-res-row m' + M.n), nm = el('div', 'n'); nm.appendChild(el('span', 'cc-tag m' + M.n, this._mtag(M.n))); nm.appendChild(el('span', 'nm', M.short || M.title));
      r.appendChild(nm); const b = el('div', 'bar'), i = el('i'); i.style.width = (100 * p[0] / p[1]) + '%'; b.appendChild(i); r.appendChild(b);
      r.appendChild(el('div', 'p', p[0] + '/' + p[1])); rows.appendChild(r);
      const f = p[0] / p[1] - (this.stepOf(M.n) ? 0 : 1); if (f < wv) { wv = f; weak = M.n; }
    });
    this.root.appendChild(rows);
    const a = el('div', 'cc-row-btns'), ns = this.nextStep();
    if (weak && this.stepOf(weak)) a.appendChild(kbd(btn('cc-btn cc-primary cc-lg', 'Start ' + this._mtag(weak) + ' ' + this.stepOf(weak), () => this.openStep(weak, this.stepOf(weak))), 'space'));
    if (ns && ns.m !== weak) a.appendChild(btn('cc-btn', 'Follow the path · ' + this._mtag(ns.m) + ' ' + ns.s, () => this.openStep(ns.m, ns.s)));
    a.appendChild(btn('cc-btn cc-ghost', 'Path', () => this.home()));
    this.root.appendChild(a);
    this.keys = e => { if ((e.key === ' ' || e.key === 'Enter') && a.firstChild) { e.preventDefault(); a.firstChild.click(); } else if (e.key === 'Escape') this.home(); };
  }

  // ── card session ──
  startSession(opt) {
    const deck = opt.module ? this.modCards(opt.module) : this.D.cards;
    const s = { deck, m: opt.module || 0, review: !!opt.review, ahead: !!opt.ahead, batch: [], lastId: null, reviewed: 0, again: 0, undo: null, extra: null, extraDone: {}, cur: null, phase: null };
    (opt.xd || []).forEach(id => { s.extraDone[id] = 1; });
    if (opt.ids) s.extra = opt.ids.slice();
    else if (opt.ahead) s.extra = this.sch.weakest(deck, this.S.cards, 20);
    else if (!opt.review) s.batch = this.sch.newBatch(deck, this.S.cards, this.S.batch);
    this.sess = s;
    const rs = opt.resume;
    if (rs && this.card[rs.id]) {
      const d = this.card[rs.id];
      if (this.isNew(rs.id) && !s.batch.includes(rs.id)) s.batch.unshift(rs.id);
      s.cur = { id: rs.id, kind: rs.kind || (this.isNew(rs.id) ? 'new' : 'review') }; s.phase = rs.phase; s.shownAt = Date.now(); s.pickWrong = null;
      if (rs.phase === 'back' && d.choices) s.choiceRight = d.answer_index;   // the right pick was what revealed it
      return this._go('card');
    }
    const lee = this.sch.leeches(deck, this.S.cards);
    if (lee.length) this._go('leech', { ids: lee }); else this.nextCard();
  }
  v_leech({ ids }) {
    this._clear('card');
    this.root.appendChild(el('span', 'cc-kicker', 'Keeps slipping'));
    this.root.appendChild(el('h1', 'cc-title', 'Look at these first'));
    this.root.appendChild(el('p', 'cc-sub', 'You\'ve missed ' + (ids.length === 1 ? 'this card' : 'these cards') + ' three times or more. Read them, then they come up again in the session.'));
    ids.forEach(id => { const d = this.card[id], c = el('div', 'cc-card m' + d.module); c.appendChild(el('div', 'front', d.front)); c.appendChild(el('div', 'back', d.back)); this._extras(c, d, false); this.root.appendChild(this._tx(c)); });
    const go = async () => { try { await this.act('leech_seen', { item_ids: ids }); } catch (e) { /* shown again next time */ } this.nextCard(); };
    const a = el('div', 'cc-actions'); a.appendChild(kbd(btn('cc-btn cc-primary cc-lg', 'Start', go), 'space')); this.root.appendChild(a);
    this.keys = e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); go(); } else if (e.key === 'Escape') this.home(); };
  }
  nextCard() {
    const s = this.sess; if (!s) return this.home();
    const t = this.now(), p = this.sch.pickNext(s.deck, this.S.cards, t, s);
    if (p) { s.cur = p; s.phase = p.kind === 'new' && !this._firstRecall(p.id) ? 'intro' : 'front'; s.shownAt = Date.now(); s.pickWrong = null; return this._go('card'); }
    const r = this.sch.nextReady(s.deck, this.S.cards, t);
    if (r !== null && r - t <= this.sch.CFG.learnAhead) this._go('wait', { at: r }); else this._go('sessdone');
  }
  _studyTop() {
    const s = this.sess, top = this._top('path', null, s.m || null);
    const o = this.sch.counts(s.deck, this.S.cards, this.now(), s.batch), cn = el('span', 'cc-counts');
    cn.title = 'new in this batch · learning due · reviews due';
    const cur = s.cur && s.cur.kind;
    [['cnt-new', o.fresh, 'new'], ['cnt-learn', o.learn, 'learn'], ['cnt-rev', o.review, 'review']].forEach(x => {
      const e = el('span', x[0], String(x[1])); if (cur === x[2] || (x[2] === 'learn' && cur === 'learn-ahead')) e.classList.add('on'); cn.appendChild(e);
    });
    top.appendChild(cn);
    const u = kbd(btn('cc-btn cc-ghost cc-undo', 'Undo', () => this.undo()), 'u'); u.disabled = !s.undo; top.appendChild(u);
    return top;
  }
  v_wait({ at }) {
    const s = this.sess; if (!s) return this.home();
    this._clear(); s.cur = null; this._pos('wait', null, false, null, { sess: this._sessPos() });
    this.root.appendChild(this._studyTop());
    const box = el('div', 'cc-done cc-wait' + (s.m ? ' m' + s.m : ''));
    box.appendChild(el('span', 'cc-kicker', 'Short wait'));
    const h = el('h1', 'cc-title'); box.appendChild(h);
    box.appendChild(el('p', 'cc-sub', 'Cards you just saw come back after a short gap, because answering them straight away doesn\'t build memory. This page carries on by itself.'));
    const rb = el('div', 'cc-row-btns'), inBatch = {};
    s.batch.forEach(id => { inBatch[id] = 1; });
    const more = s.review ? [] : this.sch.newBatch(s.deck, this.S.cards, this.S.batch, inBatch), ns = this.nextStep();
    if (more.length) rb.appendChild(btn('cc-btn cc-primary cc-lg', 'Learn ' + plural(more.length, 'new card') + ' meanwhile', () => { s.batch = s.batch.concat(more); this.nextCard(); }));
    else if (ns && ns.m !== s.m && ns.s !== 'cards') rb.appendChild(btn('cc-btn cc-primary cc-lg', this._mtag(ns.m) + ' ' + ns.s + ' meanwhile', () => this.openStep(ns.m, ns.s)));
    if (this.D.questions.length) rb.appendChild(btn('cc-btn cc-lg' + (rb.firstChild ? '' : ' cc-primary'), 'Practice questions', () => this.startPractice(s.m || 'all')));
    rb.appendChild(btn('cc-btn cc-ghost cc-lg', 'Back to path', () => this.home()));
    box.appendChild(rb);
    this.root.appendChild(box);
    const tick = () => {
      const left = at - this.now();
      if (left <= 0) { this._stopTimers(); if (this.view && this.view.name === 'wait') this.nextCard(); return; }
      const sec = Math.ceil(left / 1000);
      h.textContent = 'Next card in ' + Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
    };
    this.timers.push(setInterval(tick, 500)); tick();
    this.keys = e => { if (e.key === 'Escape') this.home(); else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); rb.firstChild.click(); } };
  }
  _extras(card, d, soft) {
    if (d.explain) { const ex = el('div', 'explain'); ex.appendChild(el('b', null, this.tex ? 'Why' : 'Explanation')); ex.appendChild(document.createTextNode(d.explain)); card.appendChild(ex); }
    if (d.hook) { const h = el('div', 'hook' + (soft ? ' soft' : '')); h.appendChild(el('b', null, 'Remember it by')); h.appendChild(document.createTextNode(d.hook)); card.appendChild(h); }
    if (d.source_refs && d.source_refs.length) card.appendChild(el('div', 'cc-src', d.source_refs.join(' · ')));
  }
  closest(d) {
    if (!d.group) return null;
    let best = null, score = 1e9;
    this.D.cards.forEach(x => {
      if (x.id === d.id || x.group !== d.group || x.id === d.pair || x.pair === d.id) return;
      const s = Math.abs(x.order - d.order) + (x.module === d.module ? 0 : 1000);
      if (s < score) { score = s; best = x; }
    });
    return best;
  }
  v_card() {
    const s = this.sess; if (!s || !s.cur) return this.home();
    const p = s.cur, d = this.card[p.id], c = this.S.cards[p.id];
    if (!d) return this.nextCard();
    const ph = s.phase, shown = ph !== 'front', first = ph !== 'intro' && this._firstRecall(d.id);
    this._clear(); this.root.classList.add('m' + d.module);
    this._pos('card', d.id, shown, null, { phase: ph, kind: p.kind, last: c ? (c.last ?? null) : null, sess: this._sessPos() });
    this.root.appendChild(this._studyTop());
    const card = el('div', 'cc-card m' + d.module), meta = el('div', 'cc-card-meta');
    if (!s.m) meta.appendChild(el('span', 'cc-tag m' + d.module, this._mtag(d.module)));
    meta.appendChild(el('span', 'kind', (this.D.kinds || {})[d.kind] || d.kind || ''));
    if (ph === 'intro') meta.appendChild(el('span', 'lbl-new', '· New'));
    if (first) meta.appendChild(el('span', 'lbl-new', '· First recall'));
    if (p.kind === 'ahead') meta.appendChild(el('span', 'lbl-extra', '· Extra practice'));
    card.appendChild(meta);
    if (ph === 'intro') card.insertBefore(el('div', 'cc-intro-tag', 'New card · read the answer'), card.firstChild);
    if (first) card.insertBefore(el('div', 'cc-intro-tag', 'Recall check · from the lesson'), card.firstChild);
    if (ph === 'again') card.insertBefore(el('div', 'cc-missed-tag', p.kind === 'ahead' ? 'Again · read it once more' : 'Again · back in 1 minute'), card.firstChild);
    card.appendChild(el('div', 'front', d.front));
    const acts = el('div', 'cc-actions'), hint = el('div', 'cc-hint');
    const choice = d.choices && ph === 'front';
    if (ph === 'front' && !choice) card.appendChild(el('div', 'cc-tip', first ? 'You read this in the lesson. Answer it in your head, then show the answer.' : 'Answer it in your head before you flip.'));
    if (choice) {
      const opts = el('div', 'cc-opts');
      d.choices.forEach((t, k) => { const b = el('button', 'cc-opt'); b.type = 'button'; b.appendChild(el('span', 'k', LETTERS[k])); b.appendChild(el('span', 'x', t)); b.addEventListener('click', () => this._pickChoice(k)); opts.appendChild(b); });
      card.appendChild(opts);
    }
    if (shown) {
      if (d.choices) {
        const ch = el('div', 'cc-choice-res');
        if (s.pickWrong != null) ch.appendChild(el('div', 'cc-yours', 'Your answer: ' + d.choices[s.pickWrong]));
        ch.appendChild(el('div', 'cc-right', 'Correct: ' + d.choices[d.answer_index]));
        card.appendChild(ch);
      }
      card.appendChild(el('div', 'back', d.back));
      this._extras(card, d, ph === 'back');
      if (ph === 'again') { const cf = this.closest(d); if (cf) { const x = el('div', 'cc-confuse'); x.appendChild(el('b', null, 'Don\'t confuse with')); x.appendChild(el('span', 'cf', cf.front)); x.appendChild(document.createTextNode(' — ' + cf.back)); card.appendChild(x); } }
    }
    this.root.appendChild(this._tx(card));
    this.root.appendChild(acts); this.root.appendChild(hint);
    if (ph === 'intro') {
      acts.appendChild(kbd(btn('cc-btn cc-primary cc-lg', 'Got it', () => this._gotIt()), 'space'));
      hint.textContent = 'Read it once. It comes back as a question in about a minute.';
    } else if (ph === 'front') {
      if (!choice) acts.appendChild(kbd(btn('cc-btn cc-primary cc-lg', 'Show answer', () => { s.phase = 'back'; this.v_card(); }), 'space'));
      hint.textContent = choice ? 'Pick an answer (1–' + d.choices.length + ').' : 'Space shows the answer.';
    } else if (ph === 'back') {
      const pv = this.sch.preview(c, this.now(), d.id, first), g = el('div', 'cc-grades'), extraP = p.kind === 'ahead';
      const allowed = d.choices ? [2, 3, 4] : [1, 2, 3, 4];
      [[1, 'Again'], [2, 'Hard'], [3, 'Good'], [4, 'Easy']].filter(x => allowed.includes(x[0])).forEach(x => {
        const b = btn('cc-btn g' + x[0] + (x[0] === 3 ? ' cc-primary' : ''), null, () => this._grade(x[0]));
        b.dataset.g = x[0]; b.appendChild(el('span', 'ivl', extraP ? 'practice' : pv[x[0]].label));
        const nm = el('span', 'nm', x[1]); nm.appendChild(el('kbd', null, String(x[0]))); b.appendChild(nm); g.appendChild(b);
      });
      acts.appendChild(g);
      hint.textContent = (d.choices ? 'You picked right. Hard: unsure or slow · Good: knew it · Easy: instant' : 'Again: a key fact wrong or missing · Hard: right idea, shaky wording or slow · Good: right · Easy: instant') +
        (extraP ? '. Extra practice: when this card is due stays the same.' : first ? '. First recall: if you did not know it, choose Again.' : '');
    } else if (ph === 'again') {
      acts.appendChild(kbd(btn('cc-btn cc-primary cc-lg', 'Continue', () => this.nextCard()), 'space'));
      hint.textContent = 'Space to continue.';
    }
    if (ph !== 'front') acts.appendChild(this._ask());
    else { const a = this._ask('Ask for a hint'); a.title = 'Ask the tutor. The card stays unanswered and nothing is graded.'; acts.appendChild(a); }
    this.keys = e => {
      const k = e.key;
      if (k === 'Escape') return this.home();
      if (k === 'u' || k === 'U') { if (s.undo) { e.preventDefault(); this.undo(); } return; }
      if (ph === 'intro' && (k === ' ' || k === 'Enter')) { e.preventDefault(); this._gotIt(); }
      else if (ph === 'front' && choice && k.length === 1 && '123456'.indexOf(k) >= 0 && +k <= d.choices.length) { e.preventDefault(); this._pickChoice(+k - 1); }
      else if (ph === 'front' && !choice && (k === ' ' || k === 'Enter')) { e.preventDefault(); s.phase = 'back'; this.v_card(); }
      else if (ph === 'back') {
        if (k === ' ' || k === 'Enter') { e.preventDefault(); this._grade(3); }
        else if ('1234'.indexOf(k) >= 0 && k.length === 1 && (!d.choices || k !== '1')) { e.preventDefault(); this._grade(+k); }
      } else if (ph === 'again' && (k === ' ' || k === 'Enter')) { e.preventDefault(); this.nextCard(); }
    };
  }
  _remember(id) { const s = this.sess; s.undo = { id, lastId: s.lastId, cur: s.cur, extraDone: s.extra && s.extraDone[id], reviewed: s.reviewed }; }
  async _gotIt() {
    const s = this.sess; if (!s || s.phase !== 'intro' || s.busy) return;
    s.busy = true; const id = s.cur.id;
    try {
      await this.act('introduce', { item_id: id, ms: Math.min(3600000, Date.now() - s.shownAt) });
      this._remember(id); s.undo.phase = 'intro'; s.lastId = id; s.reviewed++;
      s.busy = false; this.nextCard();
    } catch (e) { s.busy = false; if (!e.stale) this._fail(e); }
  }
  async _pickChoice(k) {
    const s = this.sess, d = this.card[s.cur.id];
    if (s.phase !== 'front' || s.busy) return;
    if (k === d.answer_index) { s.phase = 'back'; s.pickWrong = null; s.choiceRight = k; this.v_card(); return; }
    s.pickWrong = k; await this._grade(1, k);
  }
  async _grade(g, choice) {
    const s = this.sess; if (!s || s.busy || (s.phase !== 'back' && !(choice != null && s.phase === 'front'))) return;
    s.busy = true; const id = s.cur.id, prevPhase = s.phase, practice = s.cur.kind === 'ahead', first = this._firstRecall(id);
    const extra = { item_id: id, g, ms: Math.min(3600000, Date.now() - s.shownAt) };
    if (choice != null) extra.choice = choice; else if (s.choiceRight != null) extra.choice = s.choiceRight;
    try {
      // extra practice is logged only; the schedule, recall and undo history stay as they were
      if (first) extra.revealed = prevPhase === 'back';
      await this.act(practice ? 'practice' : first ? 'recall_first' : 'grade', extra);
      if (practice) s.undo = null; else { this._remember(id); s.undo.phase = prevPhase === 'front' ? 'front' : 'back'; }
      s.lastId = id; s.reviewed++; s.choiceRight = null; if (s.extra) s.extraDone[id] = 1;
      s.busy = false;
      if (g !== 1) return this.nextCard();
      s.again++; s.phase = 'again'; this.v_card();
    } catch (e) { s.busy = false; if (!e.stale) this._fail(e); }
  }
  async undo() {
    const s = this.sess, u = s && s.undo; if (!u || s.busy) return;
    s.busy = true;
    try {
      await this.act('undo', { item_id: u.id });
      s.lastId = u.lastId; s.reviewed = u.reviewed;
      if (s.extra && !u.extraDone) delete s.extraDone[u.id];
      s.cur = u.cur; s.phase = u.phase === 'intro' ? 'intro' : 'front'; s.pickWrong = null; s.undo = null; s.shownAt = Date.now();
      s.busy = false; this._go('card');
    } catch (e) { s.busy = false; s.undo = null; if (!e.stale) { this.note = 'Nothing to undo.'; this.render(); } }
  }
  v_sessdone() {
    const s = this.sess; if (!s) return this.home();
    this._clear('path');
    const t = this.now(), m = s.m, deck = s.deck; let nextDue = Infinity;
    deck.forEach(d => { const c = this.S.cards[d.id]; if (c && c.s !== 'new' && c.due < nextDue) nextDue = c.due; });
    const newLeft = deck.filter(d => this.isNew(d.id)).length, seen = deck.length - newLeft;
    const box = el('div', 'cc-done' + (m ? ' m' + m : ''));
    box.appendChild(el('span', 'cc-kicker', s.reviewed ? 'Session done' : 'All caught up'));
    box.appendChild(el('h1', 'cc-title', m && !newLeft ? this._mtag(m) + ' cards all introduced' : 'Nothing due right now'));
    let sub = s.reviewed ? 'You went through ' + plural(s.reviewed, 'card') + '. ' : '';
    if (nextDue < Infinity) sub += 'Next card due ' + this.sch.clock(nextDue) + ' (' + this.sch.label(t, { due: nextDue, moved: false }) + ').';
    box.appendChild(el('p', 'cc-sub', sub));
    const rb = el('div', 'cc-row-btns');
    if (newLeft && !s.review) rb.appendChild(kbd(btn('cc-btn cc-primary cc-lg', 'Learn ' + Math.min(this.S.batch, newLeft) + ' more new', () => this.startSession(m ? { module: m } : {})), 'space'));
    const ns = this.nextStep();
    if (ns && ns.m !== m) rb.appendChild(btn('cc-btn cc-lg' + (rb.firstChild ? '' : ' cc-primary'), 'Continue · ' + this._mtag(ns.m) + ' ' + ns.s, () => this.openStep(ns.m, ns.s)));
    else if (!rb.firstChild) { const w = this.idle(); rb.appendChild(btn('cc-btn cc-primary cc-lg', w.title, w.go)); }
    rb.appendChild(btn('cc-btn cc-ghost cc-lg', 'Back to path', () => this.home()));
    if (seen) rb.appendChild(btn('cc-btn cc-ghost cc-lg', 'Extra practice', () => this.startSession(m ? { module: m, ahead: true } : { ahead: true })));
    box.appendChild(rb);
    if (seen) box.appendChild(el('p', 'cc-fine', 'Extra practice runs the 20 weakest cards by predicted recall at exam time. It does not change when cards come due.'));
    this.root.appendChild(box);
    this.keys = e => { if (e.key === 'Escape') this.home(); else if ((e.key === ' ' || e.key === 'Enter') && rb.firstChild) { e.preventDefault(); rb.firstChild.click(); } };
  }

  // ── exam practice ──
  mastered(id) { const h = this.S.h[id]; return !!(h && h.length === 2 && h[0] && h[1]); }
  v_exam() {
    this._clear('exam');
    const S = this.S, PQ = this.D.questions;
    this.root.appendChild(this._top('path', 'Exam practice'));
    this.root.appendChild(el('p', 'cc-sub', 'Same style as the quizzes and the midterm: four options, no hints. ' + PQ.length + ' questions open for practice' + (S.resUsed ? '.' : '; 12 more are kept for your first mock exam.')));
    const g = el('div', 'cc-grid');
    const card = (t, d, fn, primary) => { const c = el('button', 'cc-gcard' + (primary ? ' primary' : '')); c.type = 'button'; c.appendChild(el('div', 't', t)); c.appendChild(el('div', 'd', d)); c.addEventListener('click', fn); g.appendChild(c); return c; };
    const mock = S.mock && !S.mock.done;
    card('Mock exam', mock ? 'Resume · ' + S.mock.ans.filter(a => a >= 0).length + ' of ' + S.mock.ids.length + ' answered' : S.mock1 ? '50 questions, scored at the end' : 'First try: 50 questions including 12 you have never seen', () => this.startMock(), true);
    card('Missed pile', S.missed.length ? S.missed.length + ' to clear' : 'Empty', () => { if (S.missed.length) this.startPractice('missed'); });
    card('Real quiz questions', this.D.quiz_ids.length + ' from quizzes 1–6', () => this.startPractice('quiz'));
    card('All shuffled', PQ.length + ' questions, every module', () => this.startPractice('all'));
    this.root.appendChild(g);
    this.root.appendChild(el('h2', 'cc-h3', 'Practice a module'));
    this.mods.forEach(M => {
      const qs = PQ.filter(q => q.module === M.n), done = qs.filter(q => this.mastered(q.id)).length;
      const c = el('button', 'cc-mod m' + M.n); c.type = 'button';
      c.appendChild(el('span', 'cc-tag m' + M.n, this._mtag(M.n)));
      const b = el('div', 'body'); b.appendChild(el('div', 't', M.short || M.title));
      const bar = el('div', 'bar'), i = el('i'); i.style.width = (qs.length ? Math.round(100 * done / qs.length) : 0) + '%'; bar.appendChild(i); b.appendChild(bar);
      b.appendChild(el('div', 'd', done + ' of ' + qs.length + ' mastered (last two answers right)'));
      c.appendChild(b); c.addEventListener('click', () => this.startPractice(M.n)); this.root.appendChild(c);
    });
    this.keys = e => { if (e.key === 'Escape') this.home(); };
  }
  async startMock() {
    try {
      const r = await this.act('mock_start');
      (r.questions || []).forEach(q => { if (!this.Q[q.id]) this.Q[q.id] = q; });
      this._go('mock');
    } catch (e) { if (!e.stale) this._fail(e); }
  }
  v_mock() {
    const m = this.S.mock; if (!m) return this.v_exam();
    if (m.done) return this._go('results');
    const n = m.ids.length, q = this.Q[m.ids[m.i]];
    if (!q) return this._fail(new Error('Mock exam questions are missing; reload the page.'));
    this._clear(); this._pos('mock', q.id, false);
    this.root.classList.add('m' + q.module);
    const top = this._top('exam', 'Mock exam', q.module);
    const answered = () => m.ans.filter(a => a >= 0).length;
    const cnt = el('span', 'cc-cnt', 'Q ' + (m.i + 1) + ' of ' + n + ' · ' + answered() + ' answered'); top.appendChild(cnt);
    this.root.appendChild(top);
    const p = el('div', 'cc-progress'), pi = el('i'); pi.style.width = (100 * answered() / n) + '%'; p.appendChild(pi); this.root.appendChild(p);
    this.root.appendChild(el('p', 'cc-stem', q.stem));
    const order = m.orders[m.i], opts = el('div', 'cc-opts');
    order.forEach((oi, k) => {
      const b = el('button', 'cc-opt' + (m.ans[m.i] === oi ? ' sel' : '')); b.type = 'button';
      b.appendChild(el('span', 'k', LETTERS[k])); b.appendChild(el('span', 'x', q.options[oi]));
      b.addEventListener('click', () => choose(k)); opts.appendChild(b);
    });
    this.root.appendChild(opts);
    const a = el('div', 'cc-actions');
    const pb = btn('cc-btn', 'Back', () => go(m.i - 1)); pb.disabled = m.i === 0; a.appendChild(pb);
    if (m.i < n - 1) a.appendChild(btn('cc-btn cc-primary', m.ans[m.i] >= 0 ? 'Next' : 'Skip', () => go(m.i + 1)));
    else a.appendChild(btn('cc-btn cc-primary', 'Submit', () => this._submitAsk()));
    this.root.appendChild(a);
    const dots = el('div', 'cc-dots');
    m.ids.forEach((id, j) => { const d = btn('cc-dot' + (m.ans[j] >= 0 ? ' done' : '') + (j === m.i ? ' cur' : ''), String(j + 1), () => go(j)); d.setAttribute('aria-label', 'Question ' + (j + 1)); dots.appendChild(d); });
    this.root.appendChild(dots);
    const f = el('div', 'cc-foot');
    f.appendChild(el('span', null, 'No feedback and no tutor until you submit. Unanswered counts as wrong.'));
    if (m.i < n - 1) f.appendChild(btn('cc-link', 'Submit now', () => this._submitAsk()));
    this.root.appendChild(f);
    const choose = async k => {
      const pick = m.ans[m.i] === order[k] ? -1 : order[k];
      try { await this.act('mock_answer', { index: m.i, pick }); } catch (e) { if (!e.stale) this._fail(e); return; }
      this.v_mock();
    };
    const go = async j => {
      if (j < 0 || j >= n) return;
      try { await this.act('mock_answer', { index: m.i, goto: j }); } catch (e) { if (!e.stale) this._fail(e); return; }
      this.v_mock();
    };
    this.keys = e => {
      const k = e.key.toLowerCase(); let c = '1234'.indexOf(k); if (c < 0) c = 'abcd'.indexOf(k);
      if (c >= 0 && c < order.length && k.length === 1) { e.preventDefault(); choose(c); }
      else if (e.key === 'ArrowRight') go(m.i + 1);
      else if (e.key === 'ArrowLeft') go(m.i - 1);
      else if (e.key === 'Escape') this._go('exam');
    };
  }
  _submitAsk() {
    const m = this.S.mock, left = m.ids.length - m.ans.filter(a => a >= 0).length;
    if (left > 0) {
      const box = el('div', 'cc-confirm'); box.appendChild(el('p', null, left + ' question' + (left > 1 ? 's are' : ' is') + ' unanswered and will count as wrong. Submit anyway?'));
      box.appendChild(btn('cc-btn cc-primary', 'Submit', () => this._submit())); box.appendChild(btn('cc-btn cc-ghost', 'Keep going', () => box.remove()));
      this.root.appendChild(box); box.scrollIntoView?.({ block: 'nearest' });
    } else this._submit();
  }
  async _submit() {
    try { const r = await this.act('mock_submit'); this.results = r; (r.questions || []).forEach(q => { this.Q[q.id] = this.Q[q.id] || q; }); this._go('results'); }
    catch (e) { if (!e.stale) this._fail(e); }
  }
  v_results() {
    const r = this.results, m = this.S.mock;
    if (!r && !(m && m.done)) return this.v_exam();
    this._clear('mock');
    const right = r ? r.right : m.right, n = r ? r.n : m.ids.length, per = r ? r.per : m.per || {};
    this.root.appendChild(el('span', 'cc-kicker', 'Mock exam result'));
    this.root.appendChild(el('div', 'cc-score', right + ' / ' + n));
    const first = this.S.mock1 && this.S.mock1.t === (m && m.t1);
    this.root.appendChild(el('p', 'cc-sub', Math.round(100 * right / n) + '%' + (first ? ' · your first try, kept as the first-mock score' : '') + ' · wrong or skipped questions go to the missed pile.'));
    const rows = el('div', 'cc-res-rows');
    this.mods.forEach(M => {
      const p = per[M.n] || [0, 0]; if (!p[1]) return;
      const row = el('div', 'cc-res-row m' + M.n), nm = el('div', 'n'); nm.appendChild(el('span', 'cc-tag m' + M.n, this._mtag(M.n))); nm.appendChild(el('span', 'nm', (M.short || M.title).split(',')[0]));
      row.appendChild(nm); const b = el('div', 'bar'), i = el('i'); i.style.width = (100 * p[0] / p[1]) + '%'; b.appendChild(i); row.appendChild(b);
      row.appendChild(el('div', 'p', p[0] + '/' + p[1])); rows.appendChild(row);
    });
    this.root.appendChild(rows);
    const a = el('div', 'cc-row-btns');
    a.appendChild(btn('cc-btn', 'Exam practice', () => this._go('exam')));
    if (this.S.missed.length) a.appendChild(btn('cc-btn cc-primary', 'Practice missed', () => this.startPractice('missed')));
    this.root.appendChild(a);
    if (r && r.items) {
      const wrong = r.items.filter(x => !x.ok);
      if (wrong.length) this.root.appendChild(el('h2', 'cc-h3', 'Review: ' + plural(wrong.length, 'wrong or skipped question')));
      wrong.forEach(x => {
        const q = this.Q[x.id]; if (!q) return; const box = el('div', 'cc-rev');
        box.appendChild(el('div', 'q', q.stem));
        box.appendChild(el('div', 'a y', x.pick >= 0 ? 'Yours: ' + q.options[x.pick] : 'Skipped'));
        box.appendChild(el('div', 'a c', 'Correct: ' + q.options[x.answer])); box.appendChild(el('div', 'w', x.why));
        box.appendChild(this._ask('Ask about this question', () => this._pos('mock', x.id, true)));
        this.root.appendChild(box);
      });
    }
    this.keys = e => { if (e.key === 'Escape') this._go('exam'); };
  }

  // ── progress ──
  v_progress() {
    this._clear('progress');
    const sum = this.sum || {}, S = this.S, ty = sum.tally || {}, time = S.time || {}, today = dayKey(this.now());
    let total = 0; Object.values(time).forEach(v => { total += v; });
    this.root.appendChild(this._top('path', 'Progress'));
    this.root.appendChild(el('p', 'cc-sub', 'Study time counts only while you\'re active. Reading and “Got it” are exposure; only answers you produced count as recall.'));
    const stats = el('div', 'cc-pstats');
    const reviewed = Object.values(ty.days || {}).reduce((a, b) => a + b, 0);
    [[fmtMs(time[today] || 0), 'Studied today'], [fmtMs(total), 'Studied in total'], [reviewed, 'Cards answered (self-rated)']].forEach(x => {
      const e = el('div', 'cc-stat'); e.appendChild(el('div', 'n', String(x[0]))); e.appendChild(el('div', 'l', x[1])); stats.appendChild(e);
    });
    this.root.appendChild(stats);
    this.root.appendChild(this._tiles());
    this.root.appendChild(el('h2', 'cc-h3', 'By module'));
    const mstat = {};
    (sum.modules || []).forEach(x => {
      const M = this.M[x.n], gr = (ty.graded || {})[x.n] || 0, gd = (ty.good || {})[x.n] || 0;
      const qs = this.D.questions.filter(q => q.module === x.n), hist = qs.map(q => S.h[q.id] || []).flat();
      const acc = hist.length ? hist.reduce((a, b) => a + b, 0) / hist.length : null;
      mstat[x.n] = { rec: gr ? gd / gr : null, acc, n: hist.length };
      const row = el('div', 'cc-mrow m' + x.n); row.appendChild(el('span', 'cc-tag m' + x.n, this._mtag(x.n)));
      const nm = el('div', 'nm'); nm.appendChild(el('div', null, M.short || M.title));
      const f = el('div', 'figs');
      const figs = [[x.seen + '/' + x.total, 'seen'], [x.learned, 'learned'], [x.solid, 'solid (est.)'], [pct(mstat[x.n].rec), 'rated Good+']];
      if (this.D.questions.length) figs.push([pct(acc), 'practice' + (hist.length ? ' (' + hist.length + ')' : '')]);
      if (x.check) figs.push([x.check.best + '/' + x.check.n, 'check best']);
      figs.forEach(y => { const sp = el('span'); sp.appendChild(el('b', null, String(y[0]))); sp.appendChild(document.createTextNode(' ' + y[1])); f.appendChild(sp); });
      nm.appendChild(f); row.appendChild(nm); this.root.appendChild(row);
    });
    // notes: most-missed cards (Again presses) with a direct study action
    const again = ty.again || {}, top = Object.keys(again).filter(id => this.card[id]).sort((a, b) => again[b] - again[a] || this.card[a].order - this.card[b].order).slice(0, 3);
    const box = el('section', 'cc-notes'); box.appendChild(el('h2', 'cc-h3', 'Notes'));
    if (!reviewed && !Object.keys(S.h).length) box.appendChild(el('p', 'cc-fine', 'Notes appear once you\'ve answered some cards or questions.'));
    else if (!top.length) box.appendChild(el('p', null, 'No card has needed Again yet.'));
    else {
      box.appendChild(el('p', null, top.length === 1 ? 'The card you miss most:' : 'The ' + top.length + ' cards you miss most:'));
      top.forEach(id => { const d = this.card[id], x = el('div', 'cc-miss'); x.appendChild(el('div', 'c', 'Again × ' + again[id])); x.appendChild(this._tx(el('div', 'f', d.front))); x.appendChild(this._tx(el('div', 'b', d.back))); box.appendChild(x); });
      box.appendChild(btn('cc-btn cc-primary', 'Study these ' + plural(top.length, 'card'), () => this.startSession({ ids: top })));
    }
    this.root.appendChild(box);
    this.keys = e => { if (e.key === 'Escape') this.home(); };
  }
}

// Lesson text: blank-line paragraphs, "•" bullet lines.
function renderBody(text, into) {
  String(text || '').split(/\n\s*\n/).forEach(block => {
    let ul = null, para = [];
    const flush = () => { if (para.length) { into.appendChild(el('p', null, para.join(' '))); para = []; } };
    block.split('\n').forEach(line => {
      if (/^\s*•/.test(line)) { flush(); if (!ul) { ul = el('ul'); into.appendChild(ul); } ul.appendChild(el('li', null, line.replace(/^\s*•\s*/, ''))); }
      else if (line.trim()) { ul = null; para.push(line.trim()); }
    });
    flush();
  });
}
