/* Kinema 1.0 — quick questions. GPT-6 Luna on Fast answers ONLY from your confirmed notes (and the open homework's
   lesson), cites them, and says so when they don't cover the question instead of guessing (owner, 2026-09-23).
   "Ask Opus now" answers anything straight away, labelled as not from your checked notes. Press / to ask. */
import { esc, txt, mdlite, math } from './md.js';

export class Quick {
  constructor(deps) {
    this.d = deps; this.input = document.querySelector('#askin'); this.box = document.querySelector('#qa'); this.shade = document.querySelector('#qa-shade');
    this.items = [];
    this.input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && this.input.value.trim()) {       // practice goals start practice; questions go to Luna
        e.preventDefault(); const v = this.input.value.trim(); this.input.value = '';
        if (this.d.goal) { this.input.blur(); this.d.goal(v); } else this.ask(v);
      }
      if (e.key === 'Escape') { this.close(); this.input.blur(); }
    });
    this.shade.addEventListener('click', () => this.close());
    document.addEventListener('keydown', e => {
      const tag = document.activeElement?.tagName;
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) {
        e.preventDefault();
        const goal = document.querySelector('#goalin');
        const lesson = document.querySelector('#lesson-message');
        if (lesson?.getClientRects().length) lesson.focus();
        else if (goal?.getClientRects().length) goal.focus();
        else { this.input.focus(); if (this.items.length) this.open(); }
      }
      if (e.key === 'Escape' && !this.box.hidden) this.close();
    });
  }
  open() { this.box.hidden = false; this.shade.hidden = false; }
  close() { this.box.hidden = true; this.shade.hidden = true; }

  async ask(q, ctx) {
    if (window.KinemaAccount && !window.KinemaAccount.signedIn) { window.KinemaAccount.promptSignIn(); return; }
    ctx = ctx || this.d.context();
    const it = { q, ctx, state: 'luna', t0: performance.now() };
    this.items.unshift(it); this.items = this.items.slice(0, 4);
    this.input.value = ''; this.render(); this.open();
    try {
      const { job } = await this.post('/api/quick', { q, problem_id: ctx.problem_id, skill_id: ctx.skill_id });
      it.res = await this.follow(job);
    } catch (e) { it.res = { error: e.message }; }
    it.state = 'done'; this.render(); this.d.onChange?.();
  }
  async askOpus(it) {
    if (window.KinemaAccount && !window.KinemaAccount.signedIn) { window.KinemaAccount.promptSignIn(); return; }
    it.opus = { state: 'asking' }; this.render();
    try { const { job } = await this.post('/api/quick/opus', { q: it.q }); it.opus = await this.follow(job); }
    catch (e) { it.opus = { error: e.message }; }
    this.render();
  }
  post(path, body) { return this.d.api(this.d.url(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  async follow(job) {
    for (let i = 0; i < 400; i++) {
      await new Promise(r => setTimeout(r, i < 20 ? 400 : 1000));
      const j = await this.d.api(this.d.url('/api/jobs/' + job));
      if (j.status === 'done') return j.result;
      if (j.status !== 'running') return { error: j.error || 'failed' };
    }
    return { error: 'no answer after several minutes' };
  }

  render() {
    this.box.innerHTML = this.items.map((it, n) => {
      const r = it.res;
      let body;
      if (it.state === 'luna') body = '<div class="a"><span class="spin"></span> <span class="muted">Your tutor is checking your notes…</span></div>';
      else if (r?.error && !r.answer) body = `<div class="a" style="font-size:13.5px;color:var(--ink2)">${esc(r.error)}</div>`;
      else if (r?.covered) body = `<div class="a md">${mdlite(r.answer)}</div>`;
      else body = `<div class="a" style="font-size:13.5px;color:var(--ink2)">${r?.answer ? txt(r.answer) + ' ' : ''}Not in your confirmed notes yet, so your tutor won’t guess.${r?.writing ? ` The note writer is preparing a reference for “${txt(r.writing.title)}”.` : r?.suggest?.length ? '' : r?.skills?.length ? ' Your selected tutor can answer it directly.' : " It isn't on your map yet; Your selected tutor can answer it directly."}</div>`;
      const src = r?.sources?.length ? `<div class="src">From ${r.sources.map(s => s.kind === 'note'
        ? `<button class="chipk" data-skill="${esc(s.skill)}"><i class="c s-confirmed" style="cursor:inherit"></i>Note: ${txt(s.title)} · confirmed</button>`
        : `<span class="chipk">Your homework lesson · engine-checked where supported</span>`).join('')}</div>` : '';
      const sug = !r?.covered && r?.suggest?.length ? `<div class="src">Related: ${r.suggest.map(s => `<button class="chipk" data-skill="${esc(s.id)}">${txt(s.title)}</button>`).join('')}</div>` : '';
      const who = it.state === 'done' ? `${r?.model || 'Tutor'}${r?.tier === 'fast' ? ' · Fast' : ''}${r?.secs ? ' · ' + r.secs + ' s' : ''}` : '';
      const opus = it.opus ? (it.opus.state === 'asking' ? '<div class="a"><span class="spin"></span> <span class="muted">Your tutor is answering…</span></div>'
        : it.opus.error ? `<div class="a" style="color:var(--bad);font-size:13.5px">${esc(it.opus.error)}</div>`
        : `<div class="a md">${mdlite(it.opus.answer)}</div><div class="unv">${esc(it.opus.model || 'Tutor')} · not from your checked notes, so treat it with care.</div>`) : '';
      const ask = it.state === 'done' && !it.opus ? `<button class="btn sm ${r?.covered ? '' : 'p'}" data-opus="${n}">${r?.covered ? 'Answer without notes' : 'Ask without notes'}</button>` : '';
      return `<div class="panel"><div class="q">${txt(it.q)}</div>${body}${src}${sug}${opus}
        <div class="ft"><span class="muted">${esc(who)}</span>${ask}<button class="btn sm ghost" data-close>Close</button></div></div>`;
    }).join('');
    math(this.box);
    this.box.querySelectorAll('[data-opus]').forEach(b => b.addEventListener('click', () => this.askOpus(this.items[+b.dataset.opus])));
    this.box.querySelectorAll('[data-skill]').forEach(b => b.addEventListener('click', () => { this.close(); this.d.openSkill(b.dataset.skill); }));
    this.box.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => this.close()));
  }
}
