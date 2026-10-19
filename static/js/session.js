/* Kinema 1.0 — the 30-minute session: placement while the map is unknown, refreshers on the lowest gaps, due checks
   and cards. The server decides the next item from your evidence, so closing the tab or coming back tomorrow simply
   continues. Keys: 1-5 answer, 0 = "I don't know yet", Enter = next. */
import { esc, txt, mdlite, math } from './md.js';
import { STATE_LABEL } from './atlas.js';
import { LessonWorkspace } from './workspace.js';

const KIND = { placement: 'Placement', check: 'Check', refresh: 'Refresher', card: 'Card', example: 'Example', turn: 'Your turn', rung: 'Example', sheet: 'Formulas' };

/* one multiple-choice question; "I don't know yet" is a first-class answer */
export class QuestionCard {
  constructor(host, q, { label, onAnswer, onNext, nextLabel }) {
    this.host = host; this.q = q; this.label = label; this.onAnswer = onAnswer; this.onNext = onNext; this.nextLabel = nextLabel || 'Next';
    this.answered = null; this.t0 = performance.now(); this.render();
  }
  render() {
    const q = this.q, a = this.answered;
    const opts = q.choices.map((c, i) => {
      let cls = 'opt';
      if (a) cls += i === a.answer_index ? ' right' : (i === a.picked ? ' wrong' : ' faded');
      return `<button class="${cls}" data-i="${i}" ${a ? 'disabled' : ''}><kbd>${i + 1}</kbd><span>${txt(c)}</span></button>`;
    }).join('') + `<button class="opt idk${a && a.dont_know ? ' wrong' : ''}${a && !a.dont_know ? ' faded' : ''}" data-i="-1" ${a ? 'disabled' : ''}><kbd>0</kbd><span>I don't know yet</span></button>`;
    const why = a ? `<div class="why ${a.correct ? 'ok' : 'no'}">${a.correct ? '<b>Right.</b> ' : a.dont_know ? '<b>Fine — that tells Kinema what to refresh.</b> ' : '<b>Not quite.</b> '}${txt(a.why || '')}
      ${a.state ? `<div class="muted" style="margin-top:4px">This skill is now: ${esc(STATE_LABEL[a.state] || a.state)}</div>` : ''}</div>
      <div class="acts"><button class="btn p" data-act="next">${esc(this.nextLabel)} <kbd>Enter</kbd></button></div>` : '';
    this.host.innerHTML = `<div class="panel qcard"><div class="qk"><span class="muted">${this.label || ''}</span></div>
      <div class="qs">${txt(q.stem)}</div><div class="opts">${opts}</div>${why}</div>`;
    this.host.querySelectorAll('[data-i]').forEach(b => b.addEventListener('click', () => this.pick(+b.dataset.i)));
    this.host.querySelector('[data-act=next]')?.addEventListener('click', () => this.onNext?.());
    math(this.host);
  }
  secs() { return Math.round((performance.now() - this.t0) / 1000); }
  async pick(i) {
    if (this.answered || this.busy) return;
    this.busy = true;
    const dontKnow = i < 0;
    try {
      const r = await this.onAnswer({ picked: dontKnow ? null : i, dont_know: dontKnow, order: this.q.order, secs: this.secs() });
      this.answered = { ...r, picked: i, dont_know: dontKnow, answer_index: r.answer_index ?? this.q.order.indexOf(0) };
    } catch (e) { this.busy = false; throw e; }
    this.busy = false; this.render();
  }
  key(e) {
    if (this.answered) { if (e.key === 'Enter') { this.onNext?.(); return true; } return false; }
    if (e.key === '0') { this.pick(-1); return true; }
    const n = +e.key; if (n >= 1 && n <= this.q.choices.length) { this.pick(n - 1); return true; }
    return false;
  }
}

export function noteHTML(b, meta) {
  if (!b) return '';
  const eqs = (b.key_equations || []).map(e => `<div class="eqbox">$$${esc(e.latex)}$$<div class="em">${txt(e.meaning)}</div></div>`).join('');
  const ex = b.worked_example || {};
  return `<div class="panel note"><div class="hd"><b>Note</b><span class="conf"><i></i>Confirmed</span>${meta ? `<span class="muted">${esc(meta)}</span>` : ''}</div>
    ${b.use_when ? `<p class="use"><b>Use it when</b> ${txt(b.use_when)}</p>` : ''}
    <div class="md">${mdlite(b.explanation || '')}</div>${eqs}
    ${(b.steps || []).length ? `<h3>Steps</h3><ol>${b.steps.map(s => `<li>${txt(s)}</li>`).join('')}</ol>` : ''}
    ${ex.problem ? `<div class="ex"><b>Worked example.</b> ${txt(ex.problem)}<div class="md" style="margin-top:6px">${mdlite(ex.solution || '')}</div>
      <div class="muted" style="margin-top:4px">Result: ${esc(ex.value)} ${esc(ex.unit || '')} (recomputed from the givens)</div></div>` : ''}
    ${(b.mistakes || []).length ? `<div class="mist"><b>Common mistakes</b><ul>${b.mistakes.map(m => `<li>${txt(m)}</li>`).join('')}</ul></div>` : ''}
    ${(b.limits || []).length ? `<details style="margin-top:10px"><summary class="muted" style="cursor:pointer">Unit and limit checks</summary><ul>${b.limits.map(m => `<li>${txt(m)}</li>`).join('')}</ul></details>` : ''}
  </div>`;
}

export class SessionView {
  constructor(host, deps) { this.host = host; this.d = deps; this.s = null; this.item = null; this.log = []; this.qc = null; }

  async start() {
    this.host.innerHTML = '<div class="panel pad"><span class="spin"></span> Getting your session…</div>';
    try { const r = await this.post('/api/session/start'); this.s = r.session; this.show(r.next); }
    catch (e) { this.host.innerHTML = `<div class="panel pad">Could not start: ${esc(e.message)}</div>`; }
  }
  begin(r) { this.log = []; this.s = r.session; this.show(r.next); }
  async startSkill(sid) {
    this.host.innerHTML = '<div class="panel pad"><span class="spin"></span> Getting an example…</div>';
    try { this.begin(await this.post('/api/practice/skill', { skill: sid })); }
    catch (e) { this.host.innerHTML = `<div class="panel pad">Could not start: ${esc(e.message)}</div>`; }
  }
  post(path, body) {
    return this.d.api(this.d.url(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  }
  head() {
    const s = this.s, used = Math.min(s.spent_s, s.budget_s), pct = Math.round(100 * used / s.budget_s);
    const kind = s.mode === 'lesson' ? 'Lesson · all the formulas, then examples from easy to hard' : s.mode === 'practice' ? 'Practice · examples first' : 'Session';
    return `<div class="sesshead"><div><div class="muted">${kind}</div><h1 class="h">${s.title ? txt(s.title) : 'Session'}</h1><div class="sub num">${Math.round(used / 60)} of ${Math.round(s.budget_s / 60)} minutes · ${s.items} done</div></div>
      <span class="grow"></span>${s.mode === 'lesson' ? '<button class="btn" data-act="formulas">Formulas</button>' : ''}<button class="btn" data-act="end">End for today</button></div><div class="meter" style="margin-top:10px"><i style="width:${pct}%"></i></div>`;
  }
  side() {
    const lad = this.item?.ladder;
    if (lad?.length) {
      let lvl = '';
      const rows = lad.map(r => {
        const head = r.level !== lvl ? `<div class="lvl">${txt(lvl = r.level)}</div>` : '';
        const right = r.outcome === 'correct' || r.outcome === 'correct_hint', missed = r.outcome && !right;
        const mark = r.current ? '<span class="lm cur">now</span>' : right || (r.done && !missed) ? '<span class="lm ok">✓</span>' : missed ? '<span class="lm no">missed</span>' : '';
        return head + `<div class="lr${r.current ? ' cur' : ''}${r.done ? ' done' : ''}"><span class="ln">${r.n}</span><span class="lt">${txt(r.title)}</span>${mark}</div>`;
      }).join('');
      return `<div class="panel pad ladder"><div class="ph">The ladder <small>easy → hard</small></div>${rows}</div>`;
    }
    const rows = this.log.slice(-12).reverse().map(l => `<div style="display:flex;gap:8px;align-items:center;font-size:12.5px;padding:3px 0">
      <i class="c s-${esc(l.state || 'not_checked')}" style="cursor:default"></i><span style="flex:1">${txt(l.title || '')}</span><span class="muted">${esc(l.what)}</span></div>`).join('');
    return `<div class="panel pad"><div class="ph">This session</div>${rows || '<div class="muted">Nothing yet.</div>'}</div>`;
  }
  layout(main) {
    this.host.innerHTML = this.head() + `<div class="sessgrid"><div id="sessmain">${main}</div><div class="side">${this.side()}</div></div>`;
    if (this.s.plan) {
      const plan = this.s.plan;
      this.host.querySelector('.sessgrid').insertAdjacentHTML('beforebegin', `<section class="learning-intro"><small>Your learning plan</small><p>${esc(plan.approach)}</p><div>${plan.modules.slice(0,3).map((m,i) => `<span>${i+1}. ${txt(m.title)}</span>`).join('')}</div>${plan.modules.length > 3 ? `<details><summary>Full progression</summary><ol>${plan.modules.map(m=>`<li>${txt(m.title)}</li>`).join('')}</ol></details>` : ''}</section>`);
    }
    this.host.querySelector('[data-act=end]').addEventListener('click', () => this.end());
    this.host.querySelector('[data-act=formulas]')?.addEventListener('click', () => this.openFormulas());
    return this.host.querySelector('#sessmain');
  }
  label(it) {
    if (it.rung_info && it.type === 'turn') return `Your turn · same level as example ${it.rung_info.n} of ${it.rung_info.total}`;
    const where = it.chapter != null ? `${it.chapter === 'M' ? 'Math' : 'Ch. ' + it.chapter} · ${esc(it.skill_title || '')}` : '';
    return `${KIND[it.type] || ''}${where ? ' · ' + where : ''}${it.reason ? ` <span class="muted">(${esc(it.reason)})</span>` : ''}`;
  }

  show(it) {
    this.item = it; this.qc = null; this.t0 = performance.now();
    // An old session can still point at a retained card. Leave it ungraded and return to the tutor.
    if (it?.type === 'card' && this.d.onLegacyCard) { this.d.onLegacyCard(); return; }
    if (this.s?.mode === 'lesson') {
      this.workspace?.dispose();
      this.workspace = new LessonWorkspace(this.host, this.d, this.s, () => this.end());
      this.workspace.open();
      return;
    }
    this.workspace?.dispose(); this.workspace = null; this.host.classList.remove('lesson-workspace');
    if (!it || it.type === 'done') return this.done(it);
    if (it.type === 'placement' || it.type === 'check') return this.question(it, this.layout(''));
    if (it.type === 'refresh') return this.refresh(it);
    if (it.type === 'example') return this.example(it);
    if (it.type === 'sheet') return this.sheet(it);
    if (it.type === 'rung') return this.rung(it);
    if (it.type === 'turn') return this.turn(it);
    if (it.type === 'card') return this.card(it);
  }
  question(it, host) {
    if (!it.question) { host.innerHTML = '<div class="panel pad">This skill has no question yet.</div>'; return; }
    this.qc = new QuestionCard(host, it.question, {
      label: this.label(it),
      onAnswer: async a => {
        const r = await this.post(`/api/session/${this.s.id}/answer`, { type: it.type, skill: it.skill, question_id: it.question.question_id, retry: !!it.retry,
          rung: it.rung, lesson: it.lesson, ...a });
        this.s = r.session; this.pending = r.next;
        this.log.push({ title: it.skill_title, state: r.result.state, what: r.result.correct ? 'right' : r.result.outcome === 'dont_know' ? "didn't know" : 'missed' });
        this.d.onChange?.();
        return r.result;
      },
      onNext: () => this.show(this.pending),
    });
  }
  /* the lesson's first page (owner, 2026-09-23): "lay everything out at the start, give me all the formulas, what they
     mean, what they represent" */
  sheet(it) {
    this.lessonSheet = { id: it.id, title: it.title, groups: it.groups };
    const p = it.progress || {}, cont = p.reached && p.next;
    const n = it.groups.reduce((a, g) => a + g.formulas.length, 0);
    const scope = it.chapters?.length > 1 ? `Chapters ${it.chapters.join(' + ')}` : 'This chapter';
    const actions = cont ? `<button class="btn p lg" data-start="${p.next.n}">Continue at example ${p.next.n}: ${txt(p.next.title)} <kbd>Enter</kbd></button><button class="btn ghost" data-start="1">Start from the easiest again</button>`
      : p.reached ? '<button class="btn p lg" data-start="1">Go through the examples again <kbd>Enter</kbd></button>' : '<button class="btn p lg" data-start="1">Start with the easiest example <kbd>Enter</kbd></button>';
    const main = this.layout(`<div class="panel fsheet"><div class="muted">${scope} · ${n} formulas with meanings and units</div>
      <h2 class="fsh">All the formulas</h2>
      <p class="fsub">Skim these at your own pace. You can bring them back with <b>Formulas</b> during any example.</p>
      <div class="acts">${actions}</div>
      ${this.formulaCards(it.groups)}
      <div class="acts">${actions}</div></div>`);
    math(main); this.widen(main);
    main.querySelectorAll('[data-start]').forEach(b => b.addEventListener('click', () => this.startLadder(+b.dataset.start)));
    this.sheetStart = cont ? p.next.n : 1;
  }
  formulaCards(groups, highlight) {
    const hl = new Set(highlight || []);
    return groups.map(g => `<div class="fgroup"><h3>${txt(g.title)}</h3><div class="fcards">${g.formulas.map(f => `
      <div class="fcard${hl.has(f.id) ? ' hl' : ''}" data-fid="${esc(f.id)}"><div class="fname">${txt(f.name)}</div>
        <div class="fx">$$${esc(f.latex)}$$</div><div class="fwords">${txt(f.words)}</div>
        ${f.symbols?.length ? `<div class="fsyms">${f.symbols.map(s => `<span class="fs"><b>$${esc(s.sym)}$</b>${txt(s.meaning)}</span>`).join('')}</div>` : ''}
        ${f.use_when ? `<div class="fuse"><span>Use when</span>${txt(f.use_when)}</div>` : ''}</div>`).join('')}</div></div>`).join('');
  }
  widen(host) {             // a formula too long for its card gets the full row (measured after KaTeX renders)
    host.querySelectorAll('.fcard').forEach(c => { const fx = c.querySelector('.fx'); if (fx && fx.scrollWidth > fx.clientWidth + 2) c.classList.add('wide'); });
  }
  async startLadder(n) {
    if (this.busy) return; this.busy = true;
    try {
      const r = await this.post(`/api/session/${this.s.id}/answer`, { type: 'sheet', lesson: this.item.lesson, start_at: n, secs: Math.round((performance.now() - this.t0) / 1000) });
      this.s = r.session; this.busy = false; this.show(r.next);
    } catch (e) { this.busy = false; this.d.toast('Could not save: ' + e.message); }
  }
  async openFormulas(focusId) {
    const lid = this.s?.lesson; if (!lid) return;
    if (!this.lessonSheet || this.lessonSheet.id !== lid) {
      try { this.lessonSheet = await this.d.api(this.d.url('/api/lessons/' + encodeURIComponent(lid))); } catch (e) { this.d.toast(e.message); return; }
    }
    let dr = document.querySelector('#fdrawer');
    if (!dr) { dr = document.createElement('div'); dr.id = 'fdrawer'; document.body.appendChild(dr); }
    dr.innerHTML = `<div class="fdshade" data-close></div><div class="fdpanel"><div class="fdhead"><b>All the formulas</b><span class="muted">${txt(this.lessonSheet.title)}</span><span class="grow"></span><button class="btn sm ghost" data-close>Close <kbd>Esc</kbd></button></div>
      <div class="fdbody">${this.formulaCards(this.lessonSheet.groups, (this.item?.formulas || []).map(f => f.id))}</div></div>`;
    dr.hidden = false; math(dr); this.widen(dr);
    dr.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => { dr.hidden = true; }));
    const target = focusId ? [...dr.querySelectorAll('.fcard')].find(c => c.dataset.fid === focusId) : dr.querySelector('.fcard.hl');
    if (target) { target.classList.add('focus'); target.scrollIntoView({ block: 'center' }); }
  }
  /* one rung of the ladder: the same step-by-step example, plus what's new here and the formulas it uses */
  rung(it) {
    const ri = it.rung_info;
    this.xstep = 0; this.xit = it;
    const uses = (it.formulas || []).map(f => `<button class="chipk fchip" data-f="${esc(f.id)}">${txt(f.name)}</button>`).join('');
    this.xmain = this.layout(`<div class="panel exwalk"><div class="rhead"><span class="rn">Example ${ri.n} of ${ri.total}</span><span class="muted">${txt(ri.level)}</span></div>
      <h2 class="exh">${txt(ri.title)}</h2>
      <div class="rnew"><b>New here</b>${txt(ri.new)}</div>
      ${uses ? `<div class="fuses"><span class="muted">Formulas it uses</span>${uses}</div>` : ''}
      <div class="xprob md">${mdlite(it.example.problem)}</div>
      <ol class="xsteps" id="xsteps"></ol><div id="xend"></div><div class="acts" id="xacts"></div></div>`);
    this.xmain.querySelectorAll('[data-f]').forEach(b => b.addEventListener('click', () => this.openFormulas(b.dataset.f)));
    this.renderSteps();
  }
  /* a worked example, revealed one step at a time: the owner learns best by following examples (2026-09-23) */
  example(it) {
    const ex = it.example;
    if (!ex) return this.turn({ ...it, type: 'turn' });
    this.xstep = 0; this.xit = it;
    this.xmain = this.layout(`<div class="panel exwalk"><div class="muted">${this.label(it)}</div>
      <div class="xprob md">${mdlite(ex.problem)}</div>
      <ol class="xsteps" id="xsteps"></ol><div id="xend"></div><div class="acts" id="xacts"></div></div>`);
    this.renderSteps();
  }
  renderSteps() {
    const it = this.xit, ex = it.example, n = ex.steps.length, k = this.xstep, main = this.xmain, a = ex.answer || {};
    main.querySelector('#xsteps').innerHTML = ex.steps.slice(0, k).map((s, i) => `<li class="xs${i === k - 1 ? ' new' : ''}">
        <div class="do"><span class="n">${i + 1}</span><span>${txt(s.do)}</span></div>${s.math ? `<div class="xm">$$${esc(s.math)}$$</div>` : ''}${s.why ? `<div class="xwhy">${txt(s.why)}</div>` : ''}</li>`).join('')
      + (k < n ? `<li class="xs next"><div class="do"><span class="n">${k + 1}</span><span class="muted">${k === 0 ? 'How would you start?' : 'What would you do next?'} Think, then reveal it.</span></div></li>` : '');
    const unitIn = (a.latex || '').replace(/\\[a-zA-Z]+|[{}\\\s]/g, '').includes((a.unit || '').replace(/\s/g, ''));
    main.querySelector('#xend').innerHTML = k < n ? '' : `<div class="xans"><span class="muted">Answer</span><span class="big">$${esc(a.latex || '')}$</span>${a.unit && !unitIn ? `<span>${txt(a.unit)}</span>` : ''}</div>
      ${ex.takeaway ? `<div class="take"><b>Remember</b>${txt(ex.takeaway)}</div>` : ''}`;
    main.querySelector('#xacts').innerHTML = k < n
      ? `<button class="btn p" data-act="step">${k === 0 ? 'Show step 1' : 'Next step'} <kbd>Enter</kbd></button><button class="btn ghost" data-act="all">Show all steps</button><span class="grow"></span><button class="btn ghost" data-act="skip">${it.rung_info && !it.rung_info.has_turn ? 'Skip to the next example' : 'I know this, give me one to try'}</button>`
      : `<button class="btn p lg" data-act="turn">${it.rung_info && !it.rung_info.has_turn ? 'Next example' : 'Your turn'} <kbd>Enter</kbd></button>`;
    math(main);
    main.querySelector('[data-act=step]')?.addEventListener('click', () => this.nextStep());
    main.querySelector('[data-act=all]')?.addEventListener('click', () => { this.xstep = n; this.renderSteps(); });
    main.querySelector('[data-act=skip]')?.addEventListener('click', () => this.finishExample('skipped'));
    main.querySelector('[data-act=turn]')?.addEventListener('click', () => this.finishExample('done'));
    (main.querySelector('.xs.new') || main.querySelector('[data-act=turn]'))?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  nextStep() { if (this.xstep < this.xit.example.steps.length) { this.xstep++; this.renderSteps(); } }
  async finishExample(outcome) {
    const it = this.xit; if (this.busy) return; this.busy = true;
    try {
      const secs = Math.round((performance.now() - this.t0) / 1000);
      const r = await this.post(`/api/session/${this.s.id}/answer`, it.rung_info ? { type: 'rung', lesson: it.lesson, rung: it.rung, outcome, secs }
        : { type: 'example', skill: it.skill, outcome, secs });
      this.s = r.session; this.busy = false;
      this.log.push({ title: it.skill_title, state: r.result?.state || 'seen', what: outcome === 'done' ? 'example' : 'skipped the example' });
      this.d.onChange?.(); this.show(r.next);
    } catch (e) { this.busy = false; this.d.toast('Could not save: ' + e.message); }
  }
  /* your turn: a similar problem, with the example one click away */
  turn(it) {
    const ex = it.example;
    const again = ex ? `<details class="panel xagain"><summary>Show the example again</summary><div class="xprob md" style="margin-top:10px">${mdlite(ex.problem)}</div>
      <ol class="xsteps">${ex.steps.map((s, i) => `<li class="xs"><div class="do"><span class="n">${i + 1}</span><span>${txt(s.do)}</span></div>${s.math ? `<div class="xm">$$${esc(s.math)}$$</div>` : ''}</li>`).join('')}</ol></details>` : '';
    const main = this.layout(`<div id="turnq"></div>${again}`);
    this.question(it, main.querySelector('#turnq'));
    math(main);
  }
  refresh(it) {
    const noNote = !it.note;
    const main = this.layout(`<div class="panel pad refresher"><div class="muted">${this.label(it)}</div>
      <h2 style="font-size:19px;margin:6px 0 4px">${txt(it.skill_title)}</h2><div class="sub md">${mdlite(it.task || '')}</div>
      ${noNote ? `<p class="muted" id="notewait" style="margin-top:10px"><span class="spin"></span> Opus 5.5 is writing the note for this skill and Fable 5.1 will check it (usually 2–4 minutes). Meanwhile: ${esc(it.where || '')}, book p. ${esc(it.page)} (PDF p. ${esc(it.pdf_page)}).</p>` : ''}
      </div><div id="notebox">${noNote ? '' : noteHTML(it.note, 'checked against the book before you see it')}</div>
      <div class="acts" style="margin-top:12px"><button class="btn p" data-act="check">Check yourself</button><button class="btn" data-act="open">Open the skill page</button></div>
      <div id="refq" style="margin-top:12px"></div>`);
    math(main);
    if (noNote) this.waitNote(it, main);
    main.querySelector('[data-act=open]').addEventListener('click', () => this.d.openSkill(it.skill));
    main.querySelector('[data-act=check]').addEventListener('click', e => {
      e.target.closest('.acts').hidden = true;
      this.question({ ...it, type: 'refresh' }, main.querySelector('#refq'));
      main.querySelector('#refq').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
  async waitNote(it, main) {
    for (let i = 0; i < 60 && this.item === it; i++) {
      await new Promise(r => setTimeout(r, 8000));
      if (this.item !== it) return;
      let r; try { r = await this.d.api(this.d.url(`/api/skills/${encodeURIComponent(it.skill)}/note`)); } catch { continue; }
      if (r.note) {
        main.querySelector('#notebox').innerHTML = noteHTML(r.note, 'just written and checked');
        main.querySelector('#notewait')?.remove(); math(main); return;
      }
      if (r.task?.status === 'failed') { const w = main.querySelector('#notewait'); if (w) w.textContent = "The note didn't pass its check this time; the book section above is the source for now."; return; }
    }
  }
  card(it) {
    const main = this.layout(`<div class="rvcard"><div class="muted">${it.new ? 'New card' : 'Due card'}${it.topic ? ' · ' + esc(it.topic) : ''}</div>
      <div class="front" style="margin-top:6px">${mdlite(it.front)}</div><div id="cardback"></div>
      <div class="rvacts" id="cardacts"><button class="btn p" data-act="show">Show answer <kbd>space</kbd></button></div></div>`);
    math(main);
    const reveal = () => {
      main.querySelector('#cardback').innerHTML = `<div class="back">${mdlite(it.back)}</div>`;
      main.querySelector('#cardacts').innerHTML = ['again', 'hard', 'good', 'easy'].map((g, k) => `<button class="btn grade ${g}" data-grade="${g}"><b>${k + 1}</b> ${g[0].toUpperCase() + g.slice(1)}</button>`).join('');
      main.querySelectorAll('[data-grade]').forEach(b => b.addEventListener('click', () => this.grade(b.dataset.grade)));
      math(main); this.revealed = true;
    };
    this.revealed = false; this.reveal = reveal;
    main.querySelector('[data-act=show]').addEventListener('click', reveal);
  }
  async grade(g) {
    const it = this.item; if (this.busy) return; this.busy = true;
    try {
      const r = await this.post(`/api/session/${this.s.id}/answer`, { type: 'card', card_id: it.card_id, grade: g, new: !!it.new,
        secs: Math.round((performance.now() - this.t0) / 1000) });
      this.s = r.session; this.log.push({ title: (it.front || '').replace(/\$[^$]*\$/g, '…').slice(0, 60), state: g === 'again' ? 'gap' : 'learning', what: g });
      this.busy = false; this.show(r.next);
    } catch (e) { this.busy = false; this.d.toast('Could not save: ' + e.message); }
  }
  async done(it) {
    const counts = this.s?.counts || {};
    const bits = [['example', 'examples'], ['turn', 'problems tried'], ['placement', 'placement questions'], ['refresh', 'refreshers'], ['check', 'checks'], ['card', 'cards']]
      .filter(([k]) => counts[k]).map(([k, n]) => `${counts[k]} ${n}`).join(', ');
    const more = it?.reason === 'time', top = it?.reason === 'top of the ladder';
    this.layout(`<div class="panel sessend"><div class="muted">Session</div><h2>${more ? "That's your 30 minutes." : top ? 'You made it to the top of the ladder.' : 'Nothing more in this practice for now.'}</h2>
      <p style="color:var(--ink2)">${bits ? 'Today: ' + esc(bits) + '.' : 'No items yet.'} Everything you answered is on your map.</p>
      <div class="acts">${more ? '<button class="btn p" data-act="more">Keep going, 30 more minutes</button>' : ''}<button class="btn${more ? '' : ' p'}" data-act="atlas">Back to the Atlas</button></div></div>`);
    this.host.querySelector('[data-act=atlas]').addEventListener('click', () => this.d.back());
    this.host.querySelector('[data-act=more]')?.addEventListener('click', async () => {
      try { const r = await this.post(`/api/session/${this.s.id}/extend`); this.s = r.session; this.show(r.next); } catch (e) { this.d.toast(e.message); }
    });
  }
  async end() {
    try { if (this.s) await this.post(`/api/session/${this.s.id}/end`); } catch { /* leaving anyway */ }
    this.d.back();
  }
  key(e) {
    if (this.s?.mode === 'lesson') return false;
    if (this.qc && this.qc.key(e)) return true;
    const dr = document.querySelector('#fdrawer');
    if (dr && !dr.hidden && e.key === 'Escape') { dr.hidden = true; return true; }
    if (this.item?.type === 'sheet' && e.key === 'Enter') { this.startLadder(this.sheetStart || 1); return true; }
    if ((this.item?.type === 'example' || this.item?.type === 'rung') && this.xit && e.key === 'Enter') {
      if (this.xstep < this.xit.example.steps.length) this.nextStep(); else this.finishExample('done');
      return true;
    }
    if (this.item?.type === 'card') {
      if (!this.revealed && (e.key === ' ' || e.key === 'Enter')) { this.reveal(); return true; }
      if (this.revealed && ['1', '2', '3', '4'].includes(e.key)) { this.grade(['again', 'hard', 'good', 'easy'][+e.key - 1]); return true; }
    }
    return false;
  }
}
