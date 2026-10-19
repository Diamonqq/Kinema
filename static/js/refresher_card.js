// Refresher card (Kinema 1.28, popup 1.43). A small nudge above the chat composer when the lesson step on screen or the
// tutor's reply leans on a prerequisite the learner has not shown they know. Opening it shows a compact centred popup:
// formula, one tiny worked line and one quick check together. Nothing opens by itself; a click, Escape or an outside
// pointer closes the popup and keeps the nudge.
// Problem context comes from the open chat's book_problem (its canonical id), never from tutor prose. A problem with a
// verified setup gets only its own variant; other cards are labelled as general examples.
// Answering records evidence through /api/refreshers (learner.record), the same log the Study path reads.
// One card at a time, a few steps apart, never the same card twice in a browser session. No model call.
import { esc, math, mdlite } from './md.js';

const GAP = 3;                       // consider() calls between two cards
const KEY = 'kinema.refresher';
const chevron = '<svg class="kr-chev" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 8l5 5 5-5"/></svg>';

function ensureStyle() {
  if (document.querySelector('link[href$="/refresher_card.css"]')) return;
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/refresher_card.css';
  document.head.append(link);
}

export class RefresherCard {
  constructor(teacher) {
    this.t = teacher;
    this.steps = 0; this.shownAt = -GAP; this.card = null; this.token = 0; this.timer = null; this.outside = null;
    this.visit = null; this.watch = null; this.esc = null;
    this.session = sessionStorage.getItem(KEY + '.session') || Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem(KEY + '.session', this.session);
    try { this.seen = new Set(JSON.parse(sessionStorage.getItem(KEY + '.seen') || '[]')); } catch { this.seen = new Set(); }
    ensureStyle();
    this.el = document.createElement('aside');
    this.el.className = 'kr-card'; this.el.hidden = true; this.el.setAttribute('aria-label', 'Refresher');
    const box = teacher.host?.querySelector('#tv-combox') || document.querySelector('#tv-combox');
    if (box) { this.box = box; box.before(this.el); } else return;
    this.el.addEventListener('click', e => this.click(e));
    this.el.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || !this.card) return;
      e.stopPropagation();
      if (this.popupOpen()) this.fold(); else this.dismiss();
    });
    document.addEventListener('kinema:companion-step', e => this.consider({ source: 'lesson', ...(e.detail || {}) }));
    window.KinemaRefresher = {
      consider: ctx => this.consider(ctx),
      dismiss: () => this.dismiss(),
      current: () => this.card ? { id: this.card.id, title: this.card.title, open: this.popupOpen(), answered: !!this.answered, scope: this.card.scope } : null,
    };
  }
  url(path) { try { return this.t.d?.url ? this.t.d.url(path) : path; } catch { return path; } }
  async post(path, body) {
    const r = await fetch(this.url(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, session: this.session }) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  // The open problem right now, if any. Read at request time and again when the answer comes back.
  currentProblemId() { const id = this.t.thread?.book_problem?.id; return id ? String(id) : null; }
  // What the card belongs to: the teacher's navigation epoch, the open chat, its problem and that problem's canonical revision.
  // Any change means the learner has moved on, so the card and any popup for the old visit go away.
  visitKey() {
    const t = this.t, p = t.thread?.book_problem;
    return [t.navigationEpoch || 0, t.thread?.id || '', p?.id ? String(p.id) : '', p?.source_revision || ''].join('|');
  }
  /* Something new is on screen (a revealed lesson part, a tutor reply). Maybe show one card for it. */
  async consider(ctx = {}) {
    if (!ctx || typeof ctx !== 'object') return null;
    this.steps++;
    if (this.card && this.visitKey() !== this.visit) this.dismiss();
    if (this.card || this.steps - this.shownAt < GAP) return null;
    const text = [ctx.title, ctx.text].filter(Boolean).join(' ').trim();
    if (text.length < 16) return null;
    const token = ++this.token, visit = this.visitKey(), problemId = this.currentProblemId();
    try {
      const p = this.t.thread?.book_problem;
      const { card, problem_id: answeredFor } = await this.post('/api/refreshers/consider', { title: String(ctx.title || '').slice(0, 200), text: text.slice(0, 4000), source: String(ctx.source || ''), exclude: [...this.seen], problem_id: problemId, source_revision: p?.source_revision || '' });
      // A reply for another problem, or for a visit the learner has left (before or during the request), must never show here.
      if (!card || token !== this.token || this.card || (answeredFor || null) !== problemId || this.visitKey() !== visit) return null;
      this.show(card);
      return card.id;
    } catch { return null; }
  }
  show(card) {
    clearTimeout(this.timer);
    this.card = card; this.answered = null; this.shownAt = this.steps; this.visit = this.visitKey();
    this.watchVisit(true);
    this.seen.add(card.id); sessionStorage.setItem(KEY + '.seen', JSON.stringify([...this.seen]));
    this.el.innerHTML = this.html(card);
    math(this.el);
    this.el.hidden = false; this.el.className = 'kr-card';
    requestAnimationFrame(() => this.el.classList.add('is-in'));
    document.dispatchEvent(new CustomEvent('kinema:refresher', { detail: { id: card.id, title: card.title, state: 'shown' } }));
  }
  html(card) {
    const c = card.check;
    const example = card.scope === 'problem' ? 'Worked for this setup' : 'Tiny example, general';
    return `<div class="kr-top"><button type="button" class="kr-head" data-kr="toggle" aria-expanded="false"><span class="kr-sym" aria-hidden="true">${esc(card.symbol)}</span><span class="kr-label"><small>Refresher</small><b>${esc(card.title)}</b></span>${chevron}</button><button type="button" class="kr-x" data-kr="dismiss" aria-label="Dismiss refresher">×</button></div>` +
      `<div class="kr-body" hidden><div class="kr-formula mdb">${mdlite(card.formula_md)}</div><p class="kr-kicker">${esc(example)}</p><div class="kr-worked mdb">${mdlite(card.worked_md)}</div><p class="kr-kicker">Quick check</p><div class="kr-q mdb">${mdlite(c.question_md)}</div>` +
      `<div class="kr-choices" role="group" aria-label="Your answer">${c.choices.map((ch, i) => `<button type="button" class="kr-choice mdb" data-kr="answer" data-i="${i}">${mdlite(ch)}</button>`).join('')}</div><div class="kr-result" role="status" aria-live="polite"></div></div>`;
  }
  popupOpen() { return this.el.classList.contains('is-popup'); }
  // The expanded form lives in a centred popup on the page, so the chat and the composer keep their size and draft.
  popup(on) {
    if (on) {
      if (this.popupOpen()) return;
      document.body.append(this.el);
      this.el.classList.add('is-popup'); this.el.setAttribute('role', 'dialog');
      this.outside = e => { if (!this.el.contains(e.target)) this.fold(false); };
      document.addEventListener('pointerdown', this.outside, true);
      // Document level, so Escape works after the popup has left the nudge's own focus scope.
      this.esc = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.fold(true); } };
      document.addEventListener('keydown', this.esc, true);
    } else {
      if (!this.popupOpen()) return;
      this.el.classList.remove('is-popup'); this.el.removeAttribute('role');
      if (this.box) this.box.before(this.el);
      document.removeEventListener('pointerdown', this.outside, true); this.outside = null;
      document.removeEventListener('keydown', this.esc, true); this.esc = null;
    }
  }
  // While a card is up, a visit change (another chat, a lesson page, a new chat) removes it, with no consider() call needed.
  watchVisit(on) {
    clearInterval(this.watch); this.watch = null;
    if (on) this.watch = setInterval(() => { if (this.card && this.visitKey() !== this.visit) this.dismiss(); }, 250);
  }
  async open() {
    if (!this.card || this.popupOpen()) return;
    const visit = this.visit;
    this.popup(true);
    this.el.classList.add('is-open');
    const head = this.el.querySelector('.kr-head'); head.setAttribute('aria-expanded', 'true');
    this.el.querySelector('.kr-body').hidden = false;
    head.focus({ preventScroll: true });
    this.post(`/api/refreshers/${encodeURIComponent(this.card.id)}/opened`, {}).catch(() => {});   // exposure only, never recall
    if (this.visit === visit) document.dispatchEvent(new CustomEvent('kinema:refresher', { detail: { id: this.card.id, title: this.card.title, state: 'open' } }));
  }
  // refocus: put focus back on the nudge's toggle when the learner closed the popup from inside it (Escape or the toggle).
  fold(refocus = false) {
    const inside = this.popupOpen() && this.el.contains(document.activeElement);
    this.el.classList.remove('is-open');
    this.el.querySelector('.kr-head')?.setAttribute('aria-expanded', 'false');
    const body = this.el.querySelector('.kr-body'); if (body) body.hidden = true;
    this.popup(false);
    if ((refocus || inside) && this.card) this.el.querySelector('.kr-head')?.focus({ preventScroll: true });
  }
  async answer(picked) {
    if (!this.card || this.answered) return;
    const card = this.card, buttons = [...this.el.querySelectorAll('.kr-choice')];
    buttons.forEach(b => { b.disabled = true; });
    const result = this.el.querySelector('.kr-result');
    try {
      const out = await this.post(`/api/refreshers/${encodeURIComponent(card.id)}/answer`, { picked, order: card.order });
      if (this.card !== card) return;   // dismissed while the answer was saved: the evidence is kept on the server
      this.answered = out;
      buttons[out.answer_index]?.classList.add('is-right');
      if (!out.correct) buttons[picked]?.classList.add('is-wrong');
      result.innerHTML = `<p class="kr-why mdb"><b>${out.correct ? 'Right.' : 'Not quite.'}</b> ${mdlite(out.why).replace(/^<p>|<\/p>$/g, '')}</p><button type="button" class="kr-done" data-kr="dismiss">Got it</button>`;
      math(result);
      document.dispatchEvent(new CustomEvent('kinema:refresher', { detail: { id: card.id, title: card.title, state: 'answered', correct: out.correct } }));
    } catch {
      if (this.card !== card) return;
      // The question and its choices stay on screen so the learner can pick again.
      buttons.forEach(b => { b.disabled = false; });
      result.innerHTML = '<p class="kr-why">Could not save that answer. Pick again to retry.</p>';
    }
  }
  dismiss() {
    if (!this.card) return;
    const id = this.card.id, title = this.card.title;
    // Anything still in flight for this card (a consider, an answer) is stale now and must not show or change it.
    this.token++;
    // Focus was on the card being removed: hand it back to the composer. Focus elsewhere (a click in another chat) stays put.
    const hadFocus = this.el.contains(document.activeElement);
    this.popup(false);
    this.watchVisit(false);
    this.card = null; this.answered = null; this.visit = null;
    if (hadFocus) this.t.el.input?.focus({ preventScroll: true });
    this.el.classList.remove('is-in'); this.el.classList.add('is-out');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.el.hidden = true; this.el.className = 'kr-card'; this.el.innerHTML = ''; }, 220);
    document.dispatchEvent(new CustomEvent('kinema:refresher', { detail: { id, title, state: 'dismissed' } }));
  }
  click(e) {
    const b = e.target.closest('[data-kr]'); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    if (b.dataset.kr === 'toggle') { if (this.popupOpen()) this.fold(); else this.open(); }
    else if (b.dataset.kr === 'dismiss') this.dismiss();
    else if (b.dataset.kr === 'answer') this.answer(Number(b.dataset.i));
  }
}
