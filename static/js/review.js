/* Kinema review — spaced repetition of the key ideas from your problems plus the Morin ch. 8-9 starter deck.
   Space shows the answer; 1-4 grade it (again, hard, good, easy). */
import { esc, mdlite, math } from './md.js';

export class Review {
  constructor(host, deps) { this.host = host; this.deps = deps; this.queue = []; this.i = 0; this.showing = false; this.done = 0; }
  async start() {
    this.host.innerHTML = '<div class="rv"><div class="rvcard"><p class="dim">Loading your cards…</p></div></div>';
    try { this.queue = await this.deps.api('/api/review/queue?limit=40'); } catch (e) { this.host.innerHTML = `<div class="rv"><div class="rvcard"><p>Could not load cards: ${esc(e.message)}</p></div></div>`; return; }
    this.i = 0; this.done = 0; this.showing = false; this.render();
  }
  card() { return this.queue[this.i]; }
  render() {
    const c = this.card();
    if (!c) {
      this.host.innerHTML = `<div class="rv"><div class="rvcard end"><div class="kicker">Review</div><h2>${this.done ? 'Done for now.' : 'Nothing due.'}</h2>
        <p>${this.done ? `You reviewed ${this.done} card${this.done === 1 ? '' : 's'}. Cards you knew come back in days; the ones you missed come back soon.` : 'New cards arrive as you solve problems; the starter deck releases a few each day.'}</p>
        <button class="btn p" data-act="home">Back to problems</button></div></div>`;
      this.host.querySelector('[data-act=home]').addEventListener('click', () => this.deps.home());
      this.deps.onChange?.();
      return;
    }
    const isNew = c.last_ts == null;
    this.host.innerHTML = `<div class="rv"><div class="rvtop"><span>${this.i + 1} / ${this.queue.length}</span><span class="tag">${esc(c.topic || '')}${isNew ? ' · new' : ''}</span></div>
      <div class="rvcard"><div class="front">${mdlite(c.front)}</div>
      ${this.showing ? `<div class="back">${mdlite(c.back)}</div>` : ''}
      <div class="rvacts">${this.showing ? ['again', 'hard', 'good', 'easy'].map((g, k) => `<button class="btn grade ${g}" data-grade="${g}"><b>${k + 1}</b> ${g[0].toUpperCase() + g.slice(1)}</button>`).join('') : '<button class="btn p" data-act="show">Show answer <kbd>space</kbd></button>'}</div></div>
      ${c.problem_id ? `<button class="link" data-act="source">From one of your problems — open it</button>` : ''}</div>`;
    this.host.querySelector('[data-act=show]')?.addEventListener('click', () => { this.showing = true; this.render(); });
    this.host.querySelectorAll('[data-grade]').forEach(b => b.addEventListener('click', () => this.grade(b.dataset.grade)));
    this.host.querySelector('[data-act=source]')?.addEventListener('click', () => this.deps.openProblem(c.problem_id));
    math(this.host);
  }
  async grade(g) {
    const c = this.card(); if (!c || this.busy) return;
    this.busy = true;
    try { await this.deps.api(this.deps.url('/api/review/' + c.id), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grade: g }) }); }
    catch (e) { this.deps.toast('Could not save: ' + e.message); this.busy = false; return; }
    this.busy = false; this.done++;
    if (g === 'again') this.queue.push({ ...c, last_ts: Date.now() / 1000 });      // see it again this session
    this.i++; this.showing = false; this.render(); this.deps.onChange?.();
  }
  key(e) {
    if (!this.card()) return false;
    if (e.key === ' ' || e.key === 'Enter') { if (!this.showing) { this.showing = true; this.render(); return true; } }
    if (this.showing && ['1', '2', '3', '4'].includes(e.key)) { this.grade(['again', 'hard', 'good', 'easy'][+e.key - 1]); return true; }
    return false;
  }
}
