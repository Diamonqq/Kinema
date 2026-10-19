import { modelButton, updateModelContext } from './model_menu.js';
/* Kinema coach pane — a lesson as something you work through, not something you read.
   Worked example (default): one explanation at a time, with a matching artifact when available.
   Try it myself: one step at a time shows its question; try it (typed attempts are
   graded), take a hint, then reveal the explanation and move on. The final answers stay hidden until the end.
   Solution mode: the whole worked solution, every step clickable. Follow-up questions go to the tutor with the
   lesson as context. State (mode, how far you got, attempts) is kept per problem in localStorage. */
import { esc, txt, mdlite, math, texExpr, fmt } from './md.js';
import { cell, STATE_LABEL } from './atlas.js';
import { QuestionCard } from './session.js';

const VISUAL = { rigid3d: '3D model', mechanics: 'simulation', circuit: 'circuit', plot: 'graph', diagram: 'diagram', none: 'worked solution' };
const PHASE = { starting: 'Starting', connecting: 'Sending your problem to the tutor', thinking: 'Thinking it through', writing: 'Writing the lesson', saving: 'Saving', done: 'Done' };
const VERDICT = { correct: ['✓', 'Correct'], partly: ['~', 'Partly right'], incorrect: ['✗', 'Not yet'], unclear: ['?', 'Unclear'] };
const sleep = ms => new Promise(r => setTimeout(r, ms));

export class Coach {
  constructor(host, deps) {
    this.host = host; this.deps = deps;           // deps: api(url, opts), url(path), onStep(i), onNextPart(), onClarify(), toast(msg), openProblem(id)
    this.lesson = null; this.ctx = {}; this.st = null; this.active = 0; this.token = 0; this.checks = null; this.drafts = new Map();
  }
  get mode() { return this.st?.mode || 'walkthrough'; }
  shown(i) { return this.mode === 'walkthrough' || !!this.st.shown[i]; }
  stepView(i = this.currentStep()) { return this.ctx.presentation?.steps?.[i] || null; }

  // ── state ────────────────────────────────────────────────────────────────────────────────────────────────────
  loadState() {
    const base = { mode: 'walkthrough', flow_version:2, revealed: 1, shown: {}, hints: {}, open: {}, plan: false, answers: false, attempts: {}, answerAttempts: {} };
    let saved = null;
    try { saved = this.ctx.id ? JSON.parse(localStorage.getItem('kinema.coach.' + this.ctx.id) || 'null') : null; } catch { saved = null; }
    this.st = { ...base, ...(saved || {}) };
    if (!saved?.flow_version && this.st.mode === 'coach') { this.st.mode = 'walkthrough'; this.st.lastView='step'; }
    this.st.flow_version = 2;
    this.active=Math.max(0,Math.min(this.steps().length-1,Number(this.st.active)||0));
  }
  save() { if (this.ctx.id) try { localStorage.setItem('kinema.coach.' + this.ctx.id, JSON.stringify(this.st)); } catch { /* storage full */ } }
  // The choice belongs to this problem; new lessons start with a worked example.
  setMode(mode) { if (this.asking) return; this.st.mode = mode; this.st.lastView='step'; this.save(); this.render(); this.deps.onStep(this.currentStep()); }
  currentStep() { return this.mode !== 'solution' ? Math.max(0, Math.min(this.st.revealed, this.steps().length) - 1) : this.active; }
  steps() { return (this.lesson?.steps || []).map((step,i)=>{const view=this.stepView(i);return {...step,...(view?.body?{body:view.body}:{}),...(view?.result?{result:view.result}:{})};}); }
  complete() { const n = this.steps().length; return n > 0 && this.st.revealed >= n && this.shown(n - 1); }

  // ── entry points ─────────────────────────────────────────────────────────────────────────────────────────────
  /* a finished lesson (fresh solve or reopened) */
  setLesson(lesson, ctx) {
    this.token++; this.lesson = lesson; this.ctx = ctx || {}; this.partial = false; this.checks = null; this.active = 0;
    this.asking = false;
    this.deps.configureVisual?.(lesson?.visualization?.kind, lesson?.title);
    this.loadState();
    // lessons written before coaching existed (0.4) have no step questions: show them as worked solutions
    const hasSaved = this.ctx.id && localStorage.getItem('kinema.coach.' + this.ctx.id);
    if (!hasSaved && lesson?.steps?.length && !lesson.steps.some(s => s.prompt)) this.st.mode = 'solution';
    this.render();
  }
  /* the lesson while it streams in: show what exists, keep interaction for later */
  setPartial(partial, job) {
    this.partial = true; this.job = job;
    const p = partial || {};
    this.lesson = { title: p.title || '', domain: p.domain || '', restatement: p.restatement || '', givens: p.givens || [], assumptions: p.assumptions || [],
      questions: p.questions || [], plan: p.plan || '', steps: (p.steps || []).filter(s => s && (s.title || s.prompt)), answers: [], key_ideas: [],
      status: p.status || 'solved', visualization: { kind: p.visualization?.kind || '' } };
    if (!this.st) this.loadState();
    this.renderPartial();
  }
  setChecks(checks, summary) { this.checks = checks && checks.length ? { rows: checks, summary } : null; this.renderAnswers(); }

  // ── rendering ────────────────────────────────────────────────────────────────────────────────────────────────
  header() {
    const L = this.lesson, v = L.visualization?.kind;
    const thread = (this.ctx.thread || []).length > 1 ? `<div class="parts">${this.ctx.thread.map((p, i) => `<button class="part ${p.id === this.ctx.id ? 'on' : ''}" data-part="${esc(p.id)}">Part ${i + 1}</button>`).join('')}</div>` : '';
    return `${thread}<div class="kicker">${esc(L.domain || 'Physics')}${v ? ' · ' + esc(VISUAL[v] || v) : ''}</div><h2 class="ctitle">${txt(L.title || 'Reading your problem…')}</h2>`;
  }
  problemBlock() {
    const L = this.lesson, ctx = this.ctx;
    const img = ctx.image ? `<img src="${esc(ctx.image)}" alt="Your screenshot" class="shot" data-zoom="1">` : '';
    const list = (name, items) => items?.length ? `<div class="kv"><b>${name}</b><ul>${items.map(i => `<li>${txt(i)}</li>`).join('')}</ul></div>` : '';
    const clar = L.status === 'needs_clarification' && L.questions?.length ? `<div class="clarify"><b>I need a detail before solving</b><ul>${L.questions.map(q => `<li>${esc(q)}</li>`).join('')}</ul>${this.partial ? '' : '<button class="btn sm" data-act="clarify">Add the missing information</button>'}</div>` : '';
    const more = img || L.givens?.length || L.assumptions?.length;
    return `${clar}<div class="problem"><p class="restate">${txt(L.restatement)}</p>${more ? `<details ${this.partial && img ? 'open' : ''}><summary>${[img ? 'screenshot' : '', L.givens?.length ? 'givens' : '', L.assumptions?.length ? 'assumptions' : ''].filter(Boolean).join(' · ')}</summary>${img}${list('Given', L.givens)}${list('Assumptions', L.assumptions)}</details>` : ''}</div>`;
  }
  planBlock() {
    const L = this.lesson;
    if (!L.plan) return '';
    if (this.mode === 'coach' && !this.st.plan && !this.partial) return `<div class="plan lesson hidden"><div><b>Plan</b><span>Try to name the key idea first. How would you attack it?</span></div><button class="btn sm ghost" data-act="plan">Show plan</button></div>`;
    if (this.mode === 'coach' && this.partial) return '';
    return `<div class="plan lesson"><b>Plan</b><div class="md">${mdlite(L.plan)}</div></div>`;
  }
  render() {
    if (!this.lesson) { this.host.innerHTML = ''; return; }
    const L = this.lesson;
    const modeBar = L.steps?.length ? `<div class="modes" role="tablist"><button role="tab" data-mode="walkthrough" class="${this.mode === 'walkthrough' ? 'on' : ''}">Worked example</button><button role="tab" data-mode="coach" class="${this.mode === 'coach' ? 'on' : ''}">Try it myself</button><button role="tab" data-mode="solution" class="${this.mode === 'solution' ? 'on' : ''}" title="The whole worked solution">Full solution</button></div>` : '';
    const visual = L.visualization?.kind && L.visualization.kind !== 'none';
    this.host.innerHTML = `<div class="coach-scroll" tabindex="0"><div class="coach-reading"><div class="chead">${this.header()}</div><details class="problem-overview" ${L.status==='needs_clarification'?'open':''}><summary>Problem & givens</summary>${this.problemBlock()}</details>
      <details class="lesson-options"><summary>Lesson options</summary>${modeBar}<div id="cpre"></div>${this.planBlock()}</details>
      <div class="steps" id="csteps"></div>${visual ? `<button class="artifact-card" data-visual aria-controls="problem-artifact" aria-expanded="false"><span class="artifact-card-icon">◇</span><span><b>${esc(VISUAL[L.visualization.kind] || 'Visual')}</b><small>Explore this step</small></span><span class="artifact-card-open">↗</span></button>` : ''}<div class="answers" id="canswers"></div><div class="ideas" id="cideas"></div>
      <div class="msgs" id="cmsgs" aria-live="polite"></div><div class="next" id="cnext"></div><details class="lesson-options"><summary>About this lesson</summary><div class="cfoot" id="cfoot"></div></details></div></div><div class="coach-bottom"><div class="coach-suggestions" aria-label="Suggested replies"></div><div class="chat" id="cchat"></div></div>`;
    this.bindTop();
    this.renderPreflight();
    this.renderSteps(); this.renderAnswers(); this.renderIdeas(); this.renderNext(); this.renderChat(); this.renderFoot();
    math(this.host.querySelector('.chead')); math(this.host.querySelector('.plan'));
    const token = this.token;
    requestAnimationFrame(() => { if (token === this.token) { const reply=this.st.lastView==='step'?null:this.host.querySelector('#cmsgs .msg:last-child'); this.scrollToElement(reply || this.host.querySelector('.coachcard,.step.cur'),!!reply); } });
  }
  /* 1.0 pre-flight: the skills this problem uses and what you've shown about each; check the unknown ones first,
     or just start (a refresher is one click away on each chip) */
  async renderPreflight() {
    const box = this.host.querySelector('#cpre'); const ids = this.lesson?.skills || [];
    if (!box || !ids.length || this.st?.preflight === 'dismissed') { if (box) box.innerHTML = ''; return; }
    let rows = [];
    try { rows = await this.deps.api(this.deps.url('/api/skills/states?ids=' + encodeURIComponent(ids.join(',')))); } catch { return; }
    if (!rows.length) return;
    const unknown = rows.filter(r => !['learning', 'confirmed', 'mastered'].includes(r.state) && r.questions);
    const n = st => rows.filter(r => st.includes(r.state)).length;
    const ok = n(['learning', 'confirmed', 'mastered']), gaps = n(['gap']), open = n(['not_checked', 'seen']);
    const parts = [ok && `${ok} you've shown`, gaps && `${gaps} ${gaps === 1 ? 'gap' : 'gaps'}`, open && `${open} not checked yet`].filter(Boolean);
    box.innerHTML = `<div class="preflight"><b>This problem uses ${rows.length} skill${rows.length === 1 ? '' : 's'}:</b> ${parts.join(', ')}.
      <div class="chips">${rows.map(r => `<button class="chipk" data-skill="${esc(r.id)}" title="${esc(STATE_LABEL[r.state])}">${cell({ ...r, route: false })}${txt(r.title)}</button>`).join('')}</div>
      <div class="acts">${unknown.length ? `<button class="btn sm p" data-act="precheck">Check ${unknown.length === 1 ? 'it' : 'those ' + unknown.length} first · about ${Math.max(1, Math.round(unknown.length * 0.8))} min</button>` : ''}<button class="btn sm ghost" data-act="predismiss">${unknown.length ? 'Just start' : 'Hide'}</button></div>
      <div id="preq" style="margin-top:8px"></div></div>`;
    box.querySelectorAll('[data-skill]').forEach(b => b.addEventListener('click', () => this.deps.openSkill?.(b.dataset.skill)));
    box.querySelector('[data-act=predismiss]').addEventListener('click', () => { this.st.preflight = 'dismissed'; this.save(); box.innerHTML = ''; });
    box.querySelector('[data-act=precheck]')?.addEventListener('click', () => this.precheck(unknown, box.querySelector('#preq')));
  }
  async precheck(list, host) {
    for (const r of list) {
      let q; try { q = await this.deps.api(this.deps.url('/api/skills/' + encodeURIComponent(r.id) + '/question')); } catch { continue; }
      await new Promise(done => {
        new QuestionCard(host, q, { label: 'Before you start · ' + esc(r.title), nextLabel: list.indexOf(r) === list.length - 1 ? 'Start the problem' : 'Next',
          onAnswer: a => this.deps.api(this.deps.url('/api/questions/' + encodeURIComponent(q.question_id) + '/answer'), { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...a, source: 'session' }) }).then(res => ({ ...res, state: res.state?.state })),
          onNext: done });
      });
    }
    this.st.preflight = 'dismissed'; this.save(); this.renderPreflight();
  }
  renderPartial() {
    const L = this.lesson, j = this.job || {};
    const phase = j.retry ? `Can't reach the tutor yet — retrying (${j.retry.attempt}/${j.retry.max})` : PHASE[j.phase] || 'Working';
    const extra = j.phase === 'thinking' && j.thinking_tokens ? ` · ${j.thinking_tokens >= 1000 ? (j.thinking_tokens / 1000).toFixed(1) + 'k' : j.thinking_tokens} tokens of reasoning` : j.phase === 'writing' && L.steps.length ? ` · step ${L.steps.length}` : '';
    const live = `<div class="live"><i class="spin"></i><div><b>${esc(phase)}</b><small>${Math.round(j.secs || 0)} s${esc(extra)}</small></div><button class="btn sm ghost" data-act="cancel">Cancel</button></div>`;
    let steps = '';
    if (L.steps.length) {
      if (this.mode === 'coach') {
        const s = L.steps[0];
        steps = `<div class="step cur"><div class="sh"><span class="n">1</span><span class="t">${esc(s.title)}</span></div>${s.prompt ? `<div class="q">${mdlite(s.prompt)}</div><p class="wait">Think about it while the rest of the lesson is written.</p>` : ''}</div>` +
          L.steps.slice(1).map((x, i) => `<div class="step locked"><span class="n">${i + 2}</span><span class="t">Step ${i + 2}</span></div>`).join('');
      } else steps = L.steps.map((s, i) => `<div class="step open"><div class="sh"><span class="n">${i + 1}</span><span class="t">${esc(s.title)}</span></div>${s.body ? `<div class="md">${mdlite(s.body)}</div>` : ''}</div>`).join('');
    }
    this.host.innerHTML = `<div class="coach-scroll"><div class="coach-reading"><div class="chead">${this.header()}</div>${live}${L.restatement || this.ctx.image ? this.problemBlock() : ''}${this.planBlock()}<div class="steps">${steps}</div></div></div>`;
    this.host.querySelector('[data-act=cancel]')?.addEventListener('click', () => this.deps.onCancel?.());
    this.host.querySelectorAll('img[data-zoom]').forEach(im => im.addEventListener('click', () => this.deps.zoom?.(im.src)));
    math(this.host);
  }
  bindTop() {
    const h = this.host;
    h.querySelectorAll('[data-visual]').forEach(b => b.onclick = () => this.deps.openVisual?.());
    h.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => this.setMode(b.dataset.mode)));
    h.querySelector('[data-act=plan]')?.addEventListener('click', () => { if (this.asking) return; this.st.plan = true; this.save(); this.render(); });
    h.querySelector('[data-act=clarify]')?.addEventListener('click', () => this.deps.onClarify?.(this.ctx));
    h.querySelectorAll('[data-part]').forEach(b => b.addEventListener('click', () => this.deps.openProblem(b.dataset.part)));
    h.querySelectorAll('img[data-zoom]').forEach(im => im.addEventListener('click', () => this.deps.zoom?.(im.src)));
  }

  // ── steps ────────────────────────────────────────────────────────────────────────────────────────────────────
  renderSteps() {
    const box = this.host.querySelector('#csteps'); if (!box) return;
    const S = this.steps(), st = this.st;
    if (!S.length) { box.innerHTML = ''; return; }
    if (this.mode === 'solution') {
      box.innerHTML = S.map((s, i) => `<div class="step open ${i === this.active ? 'cur' : ''}" data-i="${i}" tabindex="0"><div class="sh"><span class="n">${i + 1}</span><span class="t">${esc(s.title)}</span>${s.at != null ? `<span class="at">${Number(s.at).toFixed(1)} s</span>` : ''}</div>
        ${s.prompt ? `<div class="q dim">${mdlite(s.prompt)}</div>` : ''}<div class="md">${mdlite(s.body)}</div>${s.result ? `<div class="res">${texExpr(s.result, true)}</div>` : ''}<div class="formula" hidden></div></div>`).join('');
      box.querySelectorAll('.step').forEach(el => el.addEventListener('click', e => { if (e.target.closest('a,button,input,textarea')) return; this.goto(+el.dataset.i); }));
      this.renderSuggestions(); math(box); return;
    }
    const cur = this.currentStep();
    const upcoming = S.length - 1 - cur;
    box.innerHTML = S.map((s, i) => {
      if (i > cur) return '';
      if (i < cur) {
        const open = !!st.open[i];
        return `<div class="step done ${open ? 'open' : ''}" data-i="${i}"><div class="sh" data-toggle="${i}"><span class="n ok">✓</span><span class="t">${esc(s.title)}</span>${s.result && !open ? `<span class="mini">${texExpr(s.result)}</span>` : ''}</div>
          ${open ? `<div class="q dim">${mdlite(s.prompt || '')}</div><div class="md">${mdlite(s.body)}</div>${s.result ? `<div class="res">${texExpr(s.result, true)}</div>` : ''}` : ''}</div>`;
      }
      const shown = this.shown(i), hinted = !!st.hints[i], att = st.attempts[i];
      const view = this.stepView(i); s = {...s, ...(view?.body ? {body:view.body} : {}), ...(view?.result ? {result:view.result} : {})};
      const last = i === S.length - 1;
      return `<div class="step cur coachcard" data-i="${i}"><div class="sh"><span class="n">${i + 1}</span><span class="t">${esc(s.title)}</span><span class="of">${i + 1} / ${S.length}</span></div>
        ${this.mode === 'walkthrough' ? '' : `<div class="q">${mdlite(s.prompt || 'Work out this step: ' + s.title)}</div>`}
        ${shown ? '' : `<div class="try"><textarea rows="1" placeholder="Your answer — an equation, a number or a sentence" data-attempt="${i}">${esc(att?.text || '')}</textarea><button class="btn sm" data-check="${i}">Check</button></div>`}
        ${att?.verdict ? this.verdictHTML(att) : ''}
        ${hinted && s.hint ? `<div class="hint"><b>Hint</b> ${mdlite(s.hint)}</div>` : ''}
        ${shown ? `<div class="md">${mdlite(s.body)}</div>${s.result ? `<div class="res">${texExpr(s.result, true)}</div>` : ''}<div class="formula" hidden></div>` : ''}
        </div>`;
    }).join('');
    box.querySelectorAll('[data-toggle]').forEach(el => el.addEventListener('click', () => { const i = +el.dataset.toggle; st.open[i] = !st.open[i]; this.save(); this.renderSteps(); }));
    const card = box.querySelector('.coachcard');
    if (card) {
      const i = +card.dataset.i;
      const ta = card.querySelector('textarea');
      if (ta) {
        const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(160, ta.scrollHeight) + 'px'; }; grow();
        ta.addEventListener('input', () => { grow(); st.attempts[i] = { ...(st.attempts[i] || {}), text: ta.value }; this.save(); });
        ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.checkAttempt('step', i, ta.value); } });
        card.querySelector('[data-check]')?.addEventListener('click', () => this.checkAttempt('step', i, ta.value));
      }
    }
    this.renderSuggestions(); this.placeMessages(); math(box);
  }
  verdictHTML(att) {
    if (att.verdict === 'pending') return `<div class="verdict pending"><i class="spin"></i> Checking…</div>`;
    const [icon, word] = VERDICT[att.verdict] || VERDICT.unclear;
    return `<div class="verdict ${esc(att.verdict)}"><b>${icon} ${word}</b> <span class="md">${mdlite(att.feedback || '')}</span></div>`;
  }
  scrollToElement(el, end = false) { const scroll = this.host.querySelector('.coach-scroll'); if (!el || !scroll) return; const r=scroll.getBoundingClientRect(), q=el.getBoundingClientRect(); scroll.scrollTo({top:Math.max(0,scroll.scrollTop + (end ? q.bottom-r.bottom+18 : q.top-r.top-18)),behavior:'instant'}); }
  scrollToCurrent() { this.scrollToElement(this.host.querySelector('.coachcard,.step.cur')); }
  goto(i) {
    const n = this.steps().length; if (!n) return;
    i = Math.max(0, Math.min(n - 1, i));
    if (this.mode !== 'solution') return;
    this.active = i;
    this.st.active=i;this.st.lastView='step';this.save();
    this.host.querySelectorAll('#csteps .step').forEach((el, j) => el.classList.toggle('cur', j === i));
    this.scrollToElement(this.host.querySelector(`#csteps .step[data-i="${i}"]`));
    this.deps.onStep(i);
  }
  /* keyboard: next/previous step in solution mode, next/show in coach mode */
  key(dir) {
    if (this.asking || !this.steps().length) return;
    this.st.lastView='step';
    if (this.mode === 'solution') return this.goto(this.active + dir);
    if (dir > 0) {
      const i = this.currentStep();
      if (!this.shown(i)) { this.st.shown[i] = true; if (i === this.steps().length - 1) this.st.answers = true; this.save(); this.renderSteps(); this.renderAnswers(); this.renderIdeas(); this.deps.onStep(i); }
      else if (i < this.steps().length - 1) { this.st.revealed++; this.save(); this.renderSteps(); this.renderAnswers(); this.renderIdeas(); this.deps.onStep(this.currentStep()); this.scrollToCurrent(); }
    }
  }

  // ── answers, checks, ideas ─────────────────────────────────────────────────────────────────────────────────────
  answersVisible() { return this.mode === 'solution' || this.st.answers || this.complete(); }
  renderAnswers() {
    const box = this.host.querySelector('#canswers'); if (!box || !this.lesson) return;
    const A = this.lesson.answers || [];
    if (!A.length) { box.innerHTML = ''; return; }
    const vis = this.answersVisible();
    if (!vis) { box.innerHTML = ''; return; }
    const receipt = vis && this.checks ? `<div class="receipt"><div class="sum ${this.checks.summary.allMatch ? 'ok' : 'warn'}"><i></i>${esc(this.checks.summary.text)}</div>
      <div class="rows">${this.checks.rows.map(c => `<div class="crow ${esc(c.status)}"><span>${esc(c.label)}${c.at != null ? ' @ ' + Number(c.at).toFixed(2) + ' s' : ''}</span><b>model ${fmt(c.expect)} · app ${fmt(c.got)}${c.status === 'sign' ? ' (sign)' : ''}</b></div>`).join('')}</div>
      <div class="cnote">The app measured these in its own model. They test the setup and numbers, not the reading of the screenshot.</div></div>` : '';
    box.innerHTML = `<div class="ahead"><b>${A.length > 1 ? 'Final answers' : 'Final answer'}</b>${vis ? '' : '<button class="btn sm ghost" data-act="answers">Show</button>'}</div>` +
      A.map((a, i) => {
        const att = this.st.answerAttempts[i];
        return `<div class="ans" data-a="${i}"><div class="alabel">${txt(a.label)}</div>${vis ? `<div class="aval">${texExpr(a.expression)}${a.value != null ? ` <span class="num">= ${fmt(a.value)} ${esc(a.units || '')}</span>` : ''}</div>${a.note ? `<div class="anote">${txt(a.note)}</div>` : ''}` : ''}
          ${vis && att?.verdict === 'correct' ? '' : `<div class="try"><textarea rows="1" placeholder="${vis ? 'Check your own answer' : 'Your final answer'}" data-answer="${i}">${esc(att?.text || '')}</textarea><button class="btn sm" data-acheck="${i}">Check</button></div>`}
          ${att?.verdict ? this.verdictHTML(att) : ''}</div>`;
      }).join('') + receipt + `<div class="cnote">${this.ctx.meta?.provider === 'example' ? 'Built-in example.' : 'Written by the tutor model; check it against your course.'}</div>`;
    box.querySelector('[data-act=answers]')?.addEventListener('click', () => { this.st.answers = true; this.save(); this.renderAnswers(); this.renderIdeas(); });
    box.querySelectorAll('textarea[data-answer]').forEach(ta => {
      const i = +ta.dataset.answer;
      ta.addEventListener('input', () => { this.st.answerAttempts[i] = { ...(this.st.answerAttempts[i] || {}), text: ta.value }; this.save(); });
      ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.checkAttempt('answer', i, ta.value); } });
    });
    box.querySelectorAll('[data-acheck]').forEach(b => b.addEventListener('click', () => this.checkAttempt('answer', +b.dataset.acheck, box.querySelector(`textarea[data-answer="${b.dataset.acheck}"]`).value)));
    math(box);
  }
  renderIdeas() {
    const box = this.host.querySelector('#cideas'); if (!box) return;
    const K = this.lesson.key_ideas || [];
    if (!K.length || !this.answersVisible()) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="ihead"><b>Remember this</b></div>` +
      K.map(k => `<div class="idea"><div class="front">${mdlite(k.front)}</div><div class="back">${mdlite(k.back)}</div></div>`).join('');
    math(box);
  }
  renderNext() {
    const box = this.host.querySelector('#cnext'); if (!box) return;
    box.innerHTML = this.ctx.id ? `<button class="btn ghost" data-act="nextpart">＋ Next part of this problem</button>` : '';
    box.querySelector('[data-act=nextpart]')?.addEventListener('click', () => this.deps.onNextPart(this.ctx, this.lesson));
  }
  renderFoot() {
    const box = this.host.querySelector('#cfoot'); if (!box) return;
    const m = this.ctx.meta || {}, w = this.ctx.warnings || [];
    const who = m.provider === 'example' ? 'Built-in example' : [m.label || m.model, m.effort, m.secs ? Math.round(m.secs) + ' s' : ''].filter(Boolean).join(' · ');
    box.innerHTML = (w.length ? `<details class="warnings"><summary>Notes (${w.length})</summary>${w.map(x => `<p>${esc(x)}</p>`).join('')}</details>` : '') + (who ? `<div class="who">${esc(who)}</div>` : '');
  }

  // ── talking to the tutor ───────────────────────────────────────────────────────────────────────────────────────
  async poll(jobId, onUpdate) {
    const token = this.token;
    for (;;) {
      await sleep(650);
      if (token !== this.token) return null;
      let j;
      try { j = await this.deps.api('/api/jobs/' + jobId); } catch (e) { return { status: 'error', error: e.message }; }
      if (j.status !== 'running') return j;
      onUpdate?.(j);
    }
  }
  async checkAttempt(target, index, text) {
    text = String(text || '').trim();
    if (!text) { this.deps.toast('Type your attempt first.'); return; }
    if (!this.ctx.id) { this.deps.toast('This lesson is not saved yet.'); return; }
    const bucket = target === 'step' ? this.st.attempts : this.st.answerAttempts;
    if (bucket[index]?.verdict === 'pending') return;
    const token = this.token;
    bucket[index] = { text, verdict: 'pending' };
    const rerender = () => target === 'step' ? this.renderSteps() : this.renderAnswers();
    rerender();
    let res;
    try {
      const r = await this.deps.api(this.deps.url('/api/problems/' + this.ctx.id + '/check'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target, index, attempt: text }) });
      if (r.result) res = r.result;
      else { const j = await this.poll(r.job_id); if (!j) return; res = j.status === 'done' ? j.result : { verdict: 'unclear', feedback: 'Could not check right now: ' + (j.error || 'no answer') }; }
    } catch (e) { res = { verdict: 'unclear', feedback: 'Could not check right now: ' + e.message }; }
    if (token !== this.token) return;
    bucket[index] = { text, verdict: res.verdict, feedback: res.feedback };
    if (target === 'step' && res.verdict === 'correct' && !this.st.shown[index]) { /* earned: the explanation opens on request */ }
    this.save(); rerender();
  }
  renderSuggestions() {
    const host = this.host.querySelector('.coach-suggestions'); if (!host) return;
    const i = this.currentStep(), step = this.steps()[i];
    const input = this.host.querySelector('#homework-message');
    if (input && this.ctx.id) input.placeholder = this.mode !== 'solution' && !this.complete() ? 'Ask about this step, or say continue…' : 'Ask anything about this problem…';
    if (!step || this.mode === 'solution' || this.complete()) { host.innerHTML = ''; return; }
    const shown = this.shown(i);
    host.innerHTML = `${!shown && step.hint && !this.st.hints[i] ? '<button class="btn" data-suggest="hint">Give me a hint</button>' : ''}<button class="btn" data-suggest="continue">${shown ? 'Continue the example' : 'Walk me through this'} <span aria-hidden="true">↗</span></button>`;
    host.querySelectorAll('button').forEach(b => { b.disabled = !!this.asking; b.onclick = () => {
      if (this.asking) return;
      if (b.dataset.suggest === 'hint') { this.st.hints[i] = true; this.save(); this.renderSteps(); }
      else this.key(1);
      this.scrollToCurrent();
    }; });
  }
  placeMessages() {
    const messages=this.host.querySelector('#cmsgs'), steps=this.host.querySelector('#csteps');
    if(!messages||!steps) return;
    let earlier=this.host.querySelector('.earlier-questions');
    if(this.st.lastView==='step' && messages.children.length) {
      if(!earlier){earlier=document.createElement('details');earlier.className='earlier-questions';earlier.innerHTML='<summary>Earlier questions</summary>';steps.before(earlier);}
      earlier.append(messages);
    } else if(earlier) {
      (this.host.querySelector('.artifact-card')||steps).after(messages);earlier.remove();
    }
  }
  renderChat() {
    const box = this.host.querySelector('#cchat'); if (!box) return;
    const messages = this.host.querySelector('#cmsgs');
    messages.innerHTML = (this.ctx.messages || []).map(m => `<div class="msg ${m.role === 'user' ? 'me' : 'tutor'}">${m.role === 'user' ? esc(m.content) : `<div class="md">${mdlite(m.content)}</div>`}</div>`).join('');
    this.placeMessages();
    const visual = this.lesson.visualization?.kind && this.lesson.visualization.kind !== 'none';
    box.innerHTML = `<form class="askbox"><label class="sr-only" for="homework-message">Message your tutor about this problem</label><textarea id="homework-message" rows="1" maxlength="4000" placeholder="${this.ctx.id ? 'Ask about this problem, or say continue…' : 'Follow the worked example below…'}" ${this.ctx.id ? '' : 'disabled'}></textarea><div class="homework-compose-row">${visual ? '<button type="button" class="compose-tool" data-visual aria-controls="problem-artifact" aria-expanded="false">◇ <span>Visual</span></button>' : ''}<button class="send-message" type="submit" aria-label="Send message" disabled><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6"/></svg></button></div></form>`;
    box.querySelector('.homework-compose-row').insertAdjacentHTML('afterbegin', modelButton());
    updateModelContext(this.host, {kind:'homework', messages:this.ctx.messages});
    const ta = box.querySelector('textarea'), btn = box.querySelector('[type=submit]');
    ta.value = this.drafts.get(this.ctx.id) || '';
    const resize = () => { ta.style.height = 'auto'; ta.style.height = Math.min(200, ta.scrollHeight) + 'px'; btn.disabled = !this.ctx.id || !!this.asking || !ta.value.trim(); };
    ta.oninput = () => { this.drafts.set(this.ctx.id, ta.value); resize(); }; resize();
    box.querySelector('form').onsubmit = e => { e.preventDefault(); this.ask(ta.value); };
    ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.ask(ta.value); } };
    box.querySelector('[data-visual]')?.addEventListener('click', () => this.deps.openVisual?.());
    this.host.querySelectorAll('[data-visual]').forEach(b => b.setAttribute('aria-expanded', String(!!this.deps.visualOpen?.())));
    this.renderSuggestions(); math(messages);
  }
  async ask(q) {
    q = String(q || '').trim();
    if (!q || !this.ctx.id || this.asking) return;
    const ta = this.host.querySelector('#cchat textarea');
    if (this.mode !== 'solution' && !this.complete() && /^(continue|next|next step|keep going|walk me through this)[.!?]*$/i.test(q)) {
      ta.value = ''; this.drafts.delete(this.ctx.id); ta.dispatchEvent(new Event('input')); this.key(1); this.scrollToCurrent(); return;
    }
    this.asking = true; this.st.lastView='chat';this.save(); this.placeMessages(); this.renderSuggestions(); const token = this.token;
    const box = this.host.querySelector('#cmsgs');
    ta.value = ''; this.drafts.delete(this.ctx.id); ta.dispatchEvent(new Event('input')); ta.disabled = true;
    box.insertAdjacentHTML('beforeend', `<div class="msg me">${esc(q)}</div><div class="msg tutor pending"><div class="md"><i class="spin"></i> Thinking…</div></div>`);
    const pend = box.lastElementChild; this.scrollToElement(pend, true);
    const revealed = this.mode === 'solution' || this.complete() ? this.steps().length : this.mode === 'walkthrough' ? this.currentStep()+1 : Object.keys(this.st.shown).filter(k => this.st.shown[k]).length;
    const teaching_visual = this.deps.visualContext?.(); this.deps.lockVisual?.(true);
    try {
      const r = await this.deps.api(this.deps.url('/api/problems/' + this.ctx.id + '/ask'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q, revealed, teaching_visual }) });
      const j = await this.poll(r.job_id, jj => { if (jj.text) { pend.querySelector('.md').innerHTML = mdlite(jj.text); } });
      if (!j || token !== this.token) return;
      if (j.status === 'done') { pend.classList.remove('pending'); pend.querySelector('.md').innerHTML = mdlite(j.result.answer); math(pend); (this.ctx.messages = this.ctx.messages || []).push({ role: 'user', content: q }, { role: 'assistant', content: j.result.answer, context_usage:j.result.context_usage }); updateModelContext(this.host, {kind:'homework', messages:this.ctx.messages}); this.scrollToElement(pend, true); }
      else { pend.classList.add('err'); pend.querySelector('.md').textContent = 'No answer: ' + (j.error || 'the tutor did not respond'); }
    } catch (e) { pend.classList.add('err'); pend.querySelector('.md').textContent = 'No answer: ' + e.message; }
    finally { if (token === this.token) { this.asking = false; this.deps.lockVisual?.(false); this.renderSuggestions(); ta.disabled = false; ta.dispatchEvent(new Event('input')); if (ta.isConnected && !this.host.closest('[inert]')) ta.focus({preventScroll:true}); } }
  }
}
