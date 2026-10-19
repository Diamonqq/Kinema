/* Kinema 1.0 — one skill: its confirmed note, what you've shown about it, what it needs and what builds on it. */
import { esc, txt, mdlite, math } from './md.js';
import { STATE_LABEL, cell } from './atlas.js';
import { QuestionCard, noteHTML } from './session.js';

const KIND_LABEL = { check: 'check', review: 'card review', transfer: 'problem solved', taught: 'explained', asked: 'asked about', self: 'marked' };
const OUT_LABEL = { correct: 'right', correct_hint: 'right after a hint', wrong: 'missed', dont_know: "didn't know yet", revealed: 'revealed', exposure: '' };
const SRC_LABEL = { placement: 'placement', session: 'session', coach: 'homework', quick: 'quick question', chat: 'Physics chat', review: 'cards', note: 'note' };

export class SkillPage {
  constructor(host, deps) { this.host = host; this.d = deps; this.k = null; this.qc = null; this.poll = null; }

  async open(id) {
    clearTimeout(this.poll);
    this.host.innerHTML = '<div class="panel pad"><span class="spin"></span> Loading…</div>';
    try { this.k = await this.d.api(this.d.url('/api/skills/' + encodeURIComponent(id))); }
    catch (e) { this.host.innerHTML = `<div class="panel pad">Could not load this skill: ${esc(e.message)}</div>`; return; }
    this.render();
  }

  render() {
    const k = this.k, st = k.state.state;
    const chip = p => `<button class="chipk" data-skill="${esc(p.id)}" title="${esc(p.why || '')}">${cell({ ...p, route: false })}${txt(p.title)}${p.type === 'helpful' ? ' <span class="muted">(helps)</span>' : ''}</button>`;
    const ev = (k.evidence || []).map(e => {
      const d = new Date(e.ts * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' });
      const what = [KIND_LABEL[e.kind] || e.kind, OUT_LABEL[e.outcome]].filter(Boolean).join(': ');
      const r = (e.ref || '').replace(/@.*$/, '');
      const ref = !r ? '' : /^q\./.test(r) ? ' · a question' : /^example:/.test(r) ? ' · worked example' : /^lesson:/.test(r) ? ' · lesson example' : ` · ${esc(r)}`;
      return `<div><span class="d">${esc(d)}</span><span>${esc(what)} <span class="muted">(${esc(SRC_LABEL[e.source] || e.source)}${ref})</span></span></div>`;
    }).join('');
    const meta = k.note ? `written by Opus 5.5 · checked by Fable 5.1 against Morin pp. ${esc((k.note.pages || []).join(', '))}${k.note.checks?.independent_ok ? ' · example recomputed' : ''}` : '';
    let noteBlock;
    if (k.note) noteBlock = `<div class="askbox" style="margin-bottom:10px"><input id="skask" placeholder="Ask Luna about this skill"><button class="btn" data-act="ask">Ask</button></div>
      <details class="notefold"><summary><b>Full note</b> <span class="muted">reference · ${meta}</span></summary>${noteHTML(k.note.body, '')}</details>`;
    else {
      const t = k.note_task;
      const status = !t ? 'No confirmed note for this skill yet.' : t.status === 'running' ? `Opus 5.5 is writing the note now (${esc(t.progress || 'starting')}).`
        : t.status === 'queued' ? 'The note is queued; Opus 5.5 will write it shortly.' : t.status === 'failed' ? `The last draft didn't pass the check: ${esc(t.error || '')}` : 'No confirmed note yet.';
      noteBlock = `<div class="panel nonote">${status}<div class="acts">${!t || t.status === 'failed' ? '<button class="btn" data-act="write">Write it now</button>' : ''}<span class="muted">Until then, Morin §${esc(k.section.id)} (book p. ${esc(k.page)}, PDF p. ${esc(k.pdf_page)}) is the source.</span></div></div>`;
    }
    this.host.innerHTML = `<div class="crumb"><button data-act="atlas">Atlas</button> › ${k.chapter === 'M' ? 'Math used in physics' : 'Ch. ' + esc(k.chapter)} › ${esc(k.section.id.startsWith('M.') ? '' : k.section.id)} ${txt(k.section.title)}</div>
      <div class="skillhead"><h1 class="h">${txt(k.title)}</h1><span class="state">${cell({ ...k, state: st, route: k.route, due: k.state.due })} ${esc(k.state_label)}</span>
        <span style="margin-left:auto;display:flex;gap:8px">${k.example ? '<button class="btn p" data-act="example">Walk me through an example</button>' : ''}${k.questions ? `<button class="btn${k.example ? '' : ' p'}" data-act="check">Check me</button>` : ''}</span></div>
      <div class="sub md">${mdlite(k.task)}</div>
      ${k.takeaway ? `<div class="skmove"><span class="muted">The move</span> ${txt(k.takeaway)}</div>` : ''}
      <div class="np"><div><div id="skq"></div>${noteBlock}</div>
        <div class="side">
          <div class="panel pad"><div class="ph">Needs</div><div class="chips">${k.prereqs.map(chip).join('') || '<span class="muted">Nothing before it on the map.</span>'}</div></div>
          <div class="panel pad"><div class="ph">Leads to</div><div class="chips">${k.used_by.map(chip).join('') || '<span class="muted">Nothing mapped builds on it yet.</span>'}</div></div>
          <div class="panel pad"><div class="ph">Your evidence</div><div class="evid">${ev || '<span class="muted">None yet. Until you answer a check, this counts as not known.</span>'}</div></div>
          <div class="panel pad"><div class="ph">In the book</div><div class="muted" style="font-size:13px">Morin §${esc(k.section.id)} ${txt(k.section.title)}<br>book p. ${esc(k.page)} · PDF p. ${esc(k.pdf_page)}</div></div>
        </div></div>`;
    math(this.host);
    this.host.querySelector('[data-act=atlas]').addEventListener('click', () => this.d.back());
    this.host.querySelectorAll('[data-skill]').forEach(b => b.addEventListener('click', () => this.open(b.dataset.skill)));
    this.host.querySelector('[data-act=check]')?.addEventListener('click', () => this.check());
    this.host.querySelector('[data-act=example]')?.addEventListener('click', () => this.d.practise(k.id));
    this.host.querySelector('[data-act=write]')?.addEventListener('click', () => this.write());
    const ask = () => { const v = this.host.querySelector('#skask')?.value.trim(); if (v) this.d.ask(v, { skill_id: k.id }); };
    this.host.querySelector('[data-act=ask]')?.addEventListener('click', ask);
    this.host.querySelector('#skask')?.addEventListener('keydown', e => { if (e.key === 'Enter') ask(); });
    if (!k.note && k.note_task && ['queued', 'running'].includes(k.note_task.status)) this.poll = setTimeout(() => this.refreshQuiet(), 8000);
  }

  async refreshQuiet() {
    if (!this.k || this.host.closest('[hidden]')) return;
    try { const k = await this.d.api(this.d.url('/api/skills/' + encodeURIComponent(this.k.id))); if (k.note || k.note_task?.status !== this.k.note_task?.status) { this.k = k; this.render(); return; } } catch { /* retry */ }
    this.poll = setTimeout(() => this.refreshQuiet(), 8000);
  }

  async write() {
    try { await this.d.api(this.d.url(`/api/skills/${encodeURIComponent(this.k.id)}/note`), { method: 'POST' }); this.d.toast('Opus 5.5 is writing the note; it appears here once Fable has checked it.'); this.open(this.k.id); }
    catch (e) { this.d.toast('Could not queue it: ' + e.message); }
  }

  async check() {
    const host = this.host.querySelector('#skq');
    let q;
    try { q = await this.d.api(this.d.url(`/api/skills/${encodeURIComponent(this.k.id)}/question`)); } catch (e) { this.d.toast(e.message); return; }
    host.style.marginBottom = '12px';
    this.qc = new QuestionCard(host, q, {
      label: 'Check · ' + esc(this.k.title), nextLabel: 'Done',
      onAnswer: async a => {
        const r = await this.d.api(this.d.url(`/api/questions/${encodeURIComponent(q.question_id)}/answer`), { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...a, source: 'session' }) });
        this.d.onChange?.();
        return { ...r, state: r.state?.state };
      },
      onNext: () => this.open(this.k.id),
    });
    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  key(e) { return this.qc ? this.qc.key(e) : false; }
}
