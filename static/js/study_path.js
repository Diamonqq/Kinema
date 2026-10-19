import { controlIcon } from './icons.js';
import { esc, math } from './md.js';
/* The mechanics study path and guided step view. The tutor owns chat and the visual pane.
   Flashcard study lives in Recall. Existing card and guide records are retained. */

const rid = () => (crypto.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/-/g, '');
const KEY = 'kinema.teacher.path';
const remember = v => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { } };
export const recalled = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };
/* prose with \( \) math: escaped text, KaTeX renders it afterwards */
const prose = s => esc(s || '');
/* the step's equations: one display line per "\n" line */
const given = g => {
  if (typeof g === 'string') return g;
  const sym = g.symbol || g.name || '', unit = g.unit || g.units || '';
  const head = sym ? (/[\\^_{}]/.test(sym) || /^[A-Za-z]\w*$/.test(sym) ? `\\(${sym}${g.value != null ? ' = ' + g.value : ''}\\)` : sym + (g.value != null ? ' = ' + g.value : '')) : '';
  return [head, g.meaning ? '— ' + g.meaning : '', unit ? `(${unit})` : ''].filter(Boolean).join(' ');
};
const lines = s => String(s || '').split('\n').map(x => x.trim()).filter(Boolean).map(x => `<div class="sp-eq" data-tex="${esc(x)}">$$${esc(x)}$$</div>`).join('');
/* top-level pieces of a TeX line split at `sep` (outside braces/brackets; escaped characters skipped) */
const pieces = (tex, sep) => {
  const out = []; let depth = 0, last = 0;
  for (let i = 0; i < tex.length; i++) {
    const ch = tex[i];
    if (ch === '\\') { if (depth === 0 && sep !== '=' && tex.startsWith(sep, i)) { out.push(tex.slice(last, i)); last = i + sep.length; i = last - 1; } else i++; continue; }
    if ('{(['.includes(ch)) depth++; else if ('})]'.includes(ch)) depth--;
    else if (ch === sep && depth === 0) { out.push(tex.slice(last, i)); last = i + 1; }
  }
  out.push(tex.slice(last)); return out.map(x => x.trim().replace(/^,|,$/g, '').trim()).filter(Boolean);
};
/* a side's top-level terms: split before + or − that is not a sign (start, or after = ( , ^ _) */
const terms = x => {
  const out = []; let depth = 0, last = 0;
  for (let i = 0; i < x.length; i++) {
    const ch = x[i];
    if (ch === '\\') { i++; continue; }
    if ('{(['.includes(ch)) depth++; else if ('})]'.includes(ch)) depth--;
    else if ((ch === '+' || ch === '-') && depth === 0 && x.slice(last, i).trim() && !/[=(,^_{]\s*$/.test(x.slice(0, i))) { out.push(x.slice(last, i).trim()); last = i; }
  }
  out.push(x.slice(last).trim()); return out.filter(Boolean);
};
/* an equation wider than its box: separate \quad-joined equations, then break a chain at its "=" signs (level 1) and,
   if still too wide, each side at its + / − terms (level 2), aligned under the first "=" */
const wrapTex = (tex, level) => { const eqs = pieces(tex, '\\quad'); return eqs.map(eq => {
  const p = pieces(eq, '='), side = x => level < 2 ? [x] : terms(x);
  if (p.length < 2) return level < 2 ? eq : `\\begin{aligned}&${side(eq).join(' \\\\ &\\quad ')}\\end{aligned}`;
  const rows = [];
  p.slice(1).forEach((x, k) => side(x).forEach((t, n) => rows.push(`${k === 0 && n === 0 ? p[0] + ' ' : ''}&${n === 0 ? '= ' : '\\quad '}${t}`)));
  if (p.length === 2 && level < 2 && eqs.length === 1) return `\\begin{aligned}&${p[0]} = \\\\ &\\qquad ${p[1]}\\end{aligned}`;   // one long a = b: b on its own line
  return `\\begin{aligned}${rows.join(' \\\\ ')}\\end{aligned}`;
}).join(' \\\\[4pt] '); };
const wide = el => { const d = el.querySelector('.katex-display') || el; return d.scrollWidth > d.clientWidth + 1 || el.scrollWidth > el.clientWidth + 1; };   // KaTeX's display box scrolls by itself
const typesetAt = (el, level) => {
  const tex = el.dataset.tex, w = level ? wrapTex(tex, level) : tex;
  el.dataset.level = level; el.textContent = `$$${w.includes('\\\\[4pt]') ? `\\begin{gathered}${w}\\end{gathered}` : w}$$`; math(el);
};
const fitEquations = host => host.querySelectorAll('.sp-eq[data-tex]').forEach(el => {
  if (!el.clientWidth) return;
  let level = +(el.dataset.level || 0);
  if (level && el.clientWidth > +(el.dataset.width || 0) + 80) { typesetAt(el, 0); level = 0; }   // wider again: try the line whole
  while (level < 2 && wide(el)) typesetAt(el, ++level);
  el.dataset.width = el.clientWidth;
});

const CSS = `
.sp{max-width:760px;margin:0 auto;padding:6px 22px 28px;color:var(--tv-ink);font-size:14px;line-height:1.6}
.sp h2{margin:4px 0 2px;font-size:19px;font-weight:600;letter-spacing:-.01em;line-height:1.3}
.sp h3{margin:0 0 6px;font-size:15.5px;font-weight:600;line-height:1.35}
.sp p{margin:0 0 8px}
.sp-sub{color:var(--tv-dim);font-size:12.5px}
.sp-note{color:var(--tv-dim);font-size:12.5px;margin:6px 0 0}
.sp-alert{margin:10px 0;padding:8px 12px;border-radius:10px;background:#3a2f1c;color:#f1d7a6;font-size:12.5px}
.sp-sec{margin:18px 0 0}
.sp-sec>h4{margin:0 0 8px;color:var(--tv-faint);font-size:11.5px;font-weight:500;text-transform:none}
.sp-row{display:flex;align-items:center;gap:12px;width:100%;margin:0 0 6px;padding:10px 12px;border:1px solid #ffffff14;border-radius:12px;background:#222;color:var(--tv-ink);text-align:left;font:inherit;font-size:13px;line-height:1.4}
button.sp-row{cursor:pointer}button.sp-row:hover{background:#292929}
.sp-row>span{flex:1;min-width:0}
.sp-row b{display:block;font-weight:500}
.sp-row small{display:block;color:var(--tv-dim);font-size:12px}
.sp-row em{flex:none;font-style:normal;color:var(--tv-accent);font-size:12px}
.sp-row.is-break{background:transparent;border-style:dashed}
.sp-row.is-done em{color:var(--tv-dim)}
.sp-row>.sp-n{flex:0 0 24px;display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:#2c3646;color:var(--tv-accent);font-size:11.5px;font-weight:600}
.sp-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 6px;color:var(--tv-faint);font-size:12px}
.sp-top .sp-grow{flex:1}
.sp-link{padding:2px 6px;margin-left:-6px;border-radius:6px;color:var(--tv-dim);font:inherit;font-size:12px;cursor:pointer}
.sp-link:hover{background:var(--tv-wash);color:var(--tv-ink)}
.sp-bar{height:3px;margin:0 0 14px;border-radius:2px;background:#ffffff12;overflow:hidden}
.sp-bar i{display:block;height:100%;background:var(--tv-accent)}
.sp-card{padding:14px 16px;border:1px solid #ffffff12;border-radius:14px;background:#202020}
.sp-what{color:#e4e4e6}
.sp-math{margin:10px 0;padding:6px 10px;border-radius:10px;background:#181818;overflow-x:auto}
.sp-eq{min-width:0}.sp-eq .katex-display{margin:6px 0}
.sp-why{color:var(--tv-dim);font-size:13px}
.sp-why b{color:var(--tv-ink);font-weight:500}
.sp-problem{margin:0 0 10px;padding:8px 12px;border-radius:12px;background:#1d1d1d;border:1px solid #ffffff10}
.sp-problem summary{cursor:pointer;color:var(--tv-dim);font-size:12.5px}
.sp-problem p{margin:6px 0 4px}
.sp-givens{margin:6px 0 8px;padding-left:18px;color:#d8d8da}
.sp-check{margin:12px 0 0;padding:10px 12px;border-radius:12px;background:#1a2230}
.sp-check p{margin:0 0 8px}
.sp-choices{display:flex;flex-direction:column;gap:6px}
.sp-choice{width:100%;padding:8px 12px;border:1px solid #ffffff1c;border-radius:10px;background:#232a36;color:var(--tv-ink);text-align:left;font:inherit;font-size:13.5px;cursor:pointer}
.sp-choice:hover:not(:disabled){background:#2b3442}
.sp-choice:disabled{cursor:default}
.sp-choice.is-right{border-color:#5fbf8a;background:#1f3328}
.sp-choice.is-wrong{border-color:#d9776b;background:#3a2422}
.sp-result{margin:8px 0 0;font-size:13px}
.sp-result b{font-weight:600}
.sp-hints{margin:10px 0 0;padding-left:18px;color:#e6dcc2}
.sp-solution{margin:12px 0 0;padding:10px 12px;border-radius:12px;border:1px dashed #ffffff26}
.sp-solution h4{margin:0 0 4px;font-size:12px;font-weight:500;color:var(--tv-faint)}
.sp-nav{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:14px 0 0}
.sp-nav .sp-grow{flex:1}
.sp-btn{height:32px;padding:0 14px;border-radius:999px;border:1px solid var(--tv-hair2);color:var(--tv-ink);font:inherit;font-size:12.5px;font-weight:500;cursor:pointer;background:transparent}
.sp-btn:hover:not(:disabled){background:var(--tv-wash)}
.sp-btn:disabled{color:var(--tv-faint);cursor:default}
.sp-btn.is-main{background:var(--tv-fill);border-color:var(--tv-fill);color:#151515}
.sp-btn.is-main:hover:not(:disabled){background:#fff}
.sp-sum{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin:10px 0}
.sp-sum div{padding:8px 10px;border-radius:10px;background:#222}
.sp-sum b{display:block;font-size:17px}
.sp-sum small{color:var(--tv-dim);font-size:11.5px}
.sp-explore{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin:0 0 12px;padding:10px 12px;border-radius:12px;border:1px solid #e0b25a66;background:#2e2717;font-size:13px;line-height:1.45}
.sp-card .sp-explore{margin:12px 0 0}
.sp-explore p{flex:1 1 220px;margin:0}
.sp-gated{margin:8px 0 0;font-size:12.5px;color:#e6dcc2}
@media(max-width:720px){.sp{padding:4px 0 24px}.sp-card{padding:12px}.sp-nav .sp-btn{flex:1 1 auto}.sp-row{display:block}.sp-row>.sp-n{display:none}.sp-row em{display:block;margin-top:6px}}
`;

export class StudyPath {
  /* d: {api, url, post, onAsk(), onVisual(), onPlace(), onRestore() → bool} */
  constructor(host, d) {
    this.host = host; this.d = d; this.session = null; this.busy = false; this.exploring = false;
    if (!document.getElementById('sp-css')) { const s = document.createElement('style'); s.id = 'sp-css'; s.textContent = CSS; document.head.appendChild(s); }
    new ResizeObserver(() => fitEquations(host)).observe(host);   // a pane shown again or resized refits its equations
    host.addEventListener('click', e => { const b = e.target.closest('[data-sp]'); if (b && host.contains(b) && !b.disabled) this.act(b.dataset.sp, b); });
  }
  /* the server-validated place the tutor should know about; null on the overview */
  context() {
    const s = this.session; if (!this.showing || !s || s.position?.phase === 'done') return null;
    return { kind: 'guide', session_id: s.id, step_id: s.step?.id || null };
  }
  /* the tutor's diagram shows values other than this step's prepared ones: the authored text, checks and solution are
     for the prepared values, so answering waits until the student returns to the lesson setup */
  setExploring(on) { this.exploring = !!on; this.rerender(); }
  rerender() {
    if (!this.showing || !this.session || this.busy || this.shownExploring === this.exploring) return;
    const top = this.host.scrollTop; this.show(this.session, null, { quiet: true }); this.host.scrollTop = top;
  }
  label() { const s = this.session; return s?.step?.title ? s.step.title : s?.unit?.title || s?.unit_title || 'this step'; }
  set(html) { this.host.innerHTML = `<div class="sp">${html}</div>`; math(this.host); fitEquations(this.host); }
  async get(path) { return this.d.api(this.d.url(path)); }

  // ── this morning's order ──────────────────────────────────────────────────────────────────────────────────────
  async showPath() {
    this.showing = false; this.session = null; remember({ view: 'path' }); this.d.onPlace?.();
    if (!this.host.firstChild) this.set('<p class="sp-sub">Loading the study path…</p>');
    const guides = await this.get('/api/study-guides?course_id=2301').catch(error => ({ error }));
    if (this.showing) return;   // a step was opened meanwhile
    const units = guides.units || (Array.isArray(guides) ? guides : []);
    const unitRow = (u, i) => {
      const st = u.session || {}, phase = st.phase, sum = st.summary, done = phase === 'done';
      const where = done ? (sum ? `Done · ${sum.independent_correct ?? 0} of ${sum.total ?? 0} checks on your own` : 'Done') : phase === 'practice' ? 'Similar problem in progress' : phase === 'worked' ? `Worked example · step ${(st.index ?? 0) + 1} of ${u.steps ?? '?'}` : (u.objective || '');
      const detail = !phase && where === u.title ? '' : where;
      return `<button type="button" class="sp-row${done ? ' is-done' : ''}" data-sp="unit" data-id="${esc(u.id)}"><span class="sp-n">${i + 1}</span><span><b>${u.chapter ? `Ch ${esc(u.chapter)} · ` : ''}${esc(u.title)}</b>${detail ? `<small>${prose(detail)}</small>` : ''}</span><em>${done ? 'Review' : phase ? 'Continue' : 'Start'}</em></button>`;
    };
    const plan = guides.post_quiz_plan;
    const coreIds = [...new Set([plan?.first_new_topic, ...(plan?.next_core_units || [])].filter(Boolean))];
    const core = coreIds.map(id => units.find(u => u.id === id)).filter(Boolean);
    const remaining = units.filter(u => !u.legacy_path && !coreIds.includes(u.id));
    const saved = units.filter(u => u.legacy_path && u.session);
    const section = (title, rows) => rows.length ? `<section class="sp-sec"><h4>${title}</h4>${rows.map(unitRow).join('')}</section>` : '';
    if (core.length) {
      this.set(`<h2>Study path</h2><div class="sp-where" data-where></div><p class="sp-sub">After your quiz retry, start one Chapter 10 idea. Return to the step that stalled when you are ready.</p>
        ${section('Chapter 10 · first pass', core)}${section('Revisit a method', remaining)}${section('Your saved earlier lessons', saved)}`);
    } else {
      const ladder = units.length ? units.map(unitRow).join('') : `<p class="sp-sub">${guides.error ? 'The chapter 8–10 guides could not be loaded: ' + esc(guides.error.message) : 'No chapter 8–10 guides are installed yet.'}</p>`;
      this.set(`<h2>Study path</h2><div class="sp-where" data-where></div><p class="sp-sub">Pick one idea to work through. Ask the tutor whenever a step needs explaining.</p>
        <section class="sp-sec"><h4>Mechanics · chapters 8–10</h4>${ladder}</section>`);
    }
    this.mountMap();
  }
  /* the know / don't-know map and a one-line "where you are" live on the same page */
  mountMap() {
    const sp = this.host.querySelector('.sp'); if (!sp || !this.d.renderMap) return;
    sp.insertAdjacentHTML('beforeend', '<details class="sp-sec sp-map"><summary>Your physics map <span>What you know, what to refresh</span></summary><div data-map><p class="sp-sub">Loading…</p></div></details>');
    this.d.renderMap(sp.querySelector('[data-map]'), sp.querySelector('[data-where]'));
  }

  // ── one guided unit ───────────────────────────────────────────────────────────────────────────────────────────
  async openUnit(unitId, { restart = false } = {}) {
    if (this.busy) return; this.busy = true;
    try { this.show(await this.d.post(`/api/study-guides/${encodeURIComponent(unitId)}/start`, { request_id: rid(), ...(restart ? { restart: true } : {}) })); }
    catch (e) { this.alert('Could not open this guide: ' + e.message); }
    finally { this.busy = false; }
  }
  async openSession(id) {
    try { this.show(await this.get('/api/study-guide-sessions/' + encodeURIComponent(id))); return true; }
    catch (e) { if (e.status === 404) { remember({ view: 'path' }); return false; } this.alert('Could not reopen the lesson: ' + e.message); return true; }
  }
  /* back from a question: the tutor may have changed the evidence (helped) or the step; same position unless it moved */
  async refresh() {
    const s = this.session; if (!s || !this.showing || this.busy) return;
    try { const fresh = await this.get('/api/study-guide-sessions/' + encodeURIComponent(s.id)); if (this.session?.id === fresh.id && (fresh.revision !== this.session.revision || fresh.help_used !== this.session.help_used)) { const top = this.host.scrollTop; this.show(fresh); if (fresh.step?.id === s.step?.id) this.host.scrollTop = top; } }
    catch { /* keep what is on screen */ }
  }
  alert(text) { const a = this.host.querySelector('.sp-alert'); if (a) a.textContent = text; else this.host.querySelector('.sp')?.insertAdjacentHTML('afterbegin', `<p class="sp-alert" role="alert">${esc(text)}</p>`); }
  async act(name, b) {
    if (name === 'path') return this.showPath();
    if (name === 'unit') return this.openUnit(b.dataset.id);
    if (name === 'ask') return this.d.onAsk();
    if (name === 'visual') return this.d.onVisual?.();
    if (name === 'restore') return this.restore(b);
    if (name === 'restart') return this.openUnit(this.session.unit_id || this.session.unit?.id, { restart: true });
    if (name === 'next-unit') return b.dataset.id ? this.openUnit(b.dataset.id) : this.showPath();
    if (name === 'choice') return this.send('answer', { check_id: b.dataset.check, choice: +b.dataset.i });
    if (['next', 'back', 'hint', 'reveal', 'finish'].includes(name)) return this.send(name);
  }
  /* a session action; a stale revision shows the server's current state and changes nothing here */
  async restore(b) {
    if (this.busy) return; this.busy = true; b.disabled = true; b.textContent = 'Returning…';
    let ok = false; try { ok = await this.d.onRestore?.(); } finally { this.busy = false; this.rerender(); }
    if (!ok && b.isConnected) { b.disabled = false; b.textContent = 'Return to lesson setup'; }
  }
  async send(action, extra = {}) {
    const s = this.session; if (!s || this.busy) return;
    if (action === 'answer' && this.exploring) return this.alert('Return to the lesson setup first: this check is for the original values.');
    this.busy = true;
    this.host.querySelectorAll('[data-sp]').forEach(x => { x.dataset.wasDisabled = x.disabled ? '1' : ''; x.disabled = true; });
    try { this.show(await this.d.post(`/api/study-guide-sessions/${encodeURIComponent(s.id)}/act`, { action, revision: s.revision, request_id: rid(), ...extra }), action); }
    catch (e) {
      if (e.status === 409 && e.body?.session) { this.show(e.body.session); this.alert('This lesson changed in another window; this is where it is now.'); }
      else { this.host.querySelectorAll('[data-sp]').forEach(x => { x.disabled = x.dataset.wasDisabled === '1'; }); this.alert('Not done: ' + e.message); }
    } finally { this.busy = false; this.rerender(); }
  }
  show(s, action = null, { quiet = false } = {}) {
    const prev = this.session; this.session = s; this.showing = true;
    remember({ view: 'guide', session_id: s.id });
    const pos = s.position || {}, phase = pos.phase, unit = s.unit || { title: s.unit_title, id: s.unit_id };
    const stepMoved = !prev || prev.id !== s.id || prev.step?.id !== s.step?.id || prev.position?.phase !== phase;
    const can = s.can || {};
    const head = `<div class="sp-top"><button type="button" class="sp-link" data-sp="path">${controlIcon('left')} Study path</button><span class="sp-grow"></span><span>${phase === 'practice' ? 'Similar problem' : phase === 'done' ? 'Finished' : `Worked example · step ${(pos.index ?? 0) + 1} of ${Math.max(1, (pos.total || 1) - 1)}`}</span></div>
      <h2>${unit.chapter ? `Ch ${esc(unit.chapter)} · ` : ''}${esc(unit.title || 'Guide')}</h2>
      <div class="sp-bar" aria-hidden="true"><i style="width:${phase === 'done' ? 100 : phase === 'practice' ? 90 : Math.round(80 * ((pos.index ?? 0) + 1) / Math.max(1, pos.total || 1))}%"></i></div>`;
    let body;
    this.noticeShown = false;
    if (phase === 'done') body = this.summaryHTML(s);
    else if (phase === 'practice') body = this.practiceHTML(s, can);
    else body = this.stepHTML(s, can);
    const explore = this.exploring && phase !== 'done' && !this.noticeShown ? this.exploreHTML() : '';
    this.set(head + explore + body); this.shownExploring = this.exploring;
    if (stepMoved) this.host.scrollTop = 0;
    if (!quiet) this.d.onPlace?.(s, { moved: stepMoved, action });
  }
  exploreHTML() { this.noticeShown = true; return `<div class="sp-explore" role="status"><p><b>Exploring a changed setup.</b> The diagram shows other values; this step’s text, answers and checks are still for the original ones.</p><button type="button" class="sp-btn" data-sp="restore">Return to lesson setup</button></div>`; }
  checkHTML(c) {
    if (!c) return '';
    const r = c.result, gated = !r && this.exploring, notice = gated && !this.noticeShown ? this.exploreHTML() : '';
    const choices = (c.choices || []).map((t, i) => `<button type="button" class="sp-choice${r ? (i === r.answer ? ' is-right' : i === r.picked ? ' is-wrong' : '') : ''}" data-sp="choice" data-check="${esc(c.id)}" data-i="${i}"${r || gated ? ' disabled' : ''}>${prose(t)}</button>`).join('');
    const result = gated ? (notice ? '' : '<p class="sp-gated">Answering is paused while the diagram shows a changed setup.</p>') : r ? `<p class="sp-result" role="status"><b>${r.correct ? 'Right.' : 'Not quite.'}</b> ${prose(r.explain || '')}</p>` : '';
    return `${notice}<div class="sp-check"><p>${prose(c.prompt)}</p><div class="sp-choices">${choices}</div>${result}</div>`;
  }
  stepHTML(s, can) {
    const st = s.step || {}, idx = s.position?.index ?? 0;
    const w = s.worked || {};
    const problem = w.problem ? `<details class="sp-problem"${idx === 0 ? ' open' : ''}><summary>What we’re solving</summary><p>${prose(w.problem)}</p>${w.givens?.length ? `<ul class="sp-givens">${w.givens.map(g => `<li>${prose(given(g))}</li>`).join('')}</ul>` : ''}</details>` : '';
    return `${problem}${s.visual_error ? `<p class="sp-note">The diagram for this step could not be built: ${esc(s.visual_error)}</p>` : ''}<article class="sp-card"><h3>${prose(st.title)}</h3>${st.what ? `<p class="sp-what">${prose(st.what)}</p>` : ''}${st.math ? `<div class="sp-math">${lines(st.math)}</div>` : ''}${st.why ? `<p class="sp-why"><b>Why:</b> ${prose(st.why)}</p>` : ''}${this.checkHTML(st.check)}</article>
      <div class="sp-nav"><button type="button" class="sp-btn" data-sp="back"${can.back === false || idx === 0 ? ' disabled' : ''}>Back</button>${this.visualButton(s)}<button type="button" class="sp-btn" data-sp="ask">Ask about this step</button><span class="sp-grow"></span><button type="button" class="sp-btn is-main" data-sp="next"${can.next === false ? ' disabled' : ''}>${idx + 2 >= (s.position?.total || 0) ? 'Try a similar problem' : 'Next step'}</button></div>`;
  }
  practiceHTML(s, can) {
    const st = s.step || {}, hints = s.hints_shown || [], sol = s.solution_steps;
    const solHTML = sol?.length ? `<div class="sp-solution"><h4>Solution — revealed, so this one counts as helped</h4>${sol.map(x => typeof x === 'string' ? `<p>${prose(x)}</p>` : `<p><b>${prose(x.title || '')}</b> ${prose(x.what || '')}</p>${x.math ? `<div class="sp-math">${lines(x.math)}</div>` : ''}`).join('')}</div>` : '';
    return `<article class="sp-card"><h3>${prose(st.title || 'Your turn')}</h3><p class="sp-what">${prose(st.what)}</p>
      ${st.givens?.length ? `<ul class="sp-givens">${st.givens.map(g => `<li>${prose(given(g))}</li>`).join('')}</ul>` : ''}
      ${st.scaffold ? `<p class="sp-why"><b>Set-up:</b> ${prose(st.scaffold)}</p>` : ''}
      ${hints.length ? `<ol class="sp-hints">${hints.map(h => `<li>${prose(h)}</li>`).join('')}</ol>` : ''}
      ${(st.checks || []).map(c => this.checkHTML(c)).join('')}${solHTML}</article>
      <p class="sp-note">${s.help_used ? 'You’ve had help on this one (a hint, the set-up, the solution or the tutor), so answers count as helped, not independent.' : 'Work it on paper first. A hint, the solution or asking the tutor marks this attempt as helped, not independent.'}</p>
      <div class="sp-nav"><button type="button" class="sp-btn" data-sp="back"${can.back === false ? ' disabled' : ''}>Back to the example</button><button type="button" class="sp-btn" data-sp="hint"${can.hint === false ? ' disabled' : ''}>Hint</button>${this.visualButton(s)}<button type="button" class="sp-btn" data-sp="ask">Ask</button><span class="sp-grow"></span>${sol?.length ? '' : `<button type="button" class="sp-btn" data-sp="reveal"${can.reveal === false ? ' disabled' : ''}>Show solution</button>`}<button type="button" class="sp-btn is-main" data-sp="finish"${can.finish === false ? ' disabled' : ''}>Finish</button></div>`;
  }
  summaryHTML(s) {
    const m = s.summary || {}, next = m.next || {};
    const cell = (n, t) => `<div><b>${n ?? 0}</b><small>${t}</small></div>`;
    const nextBtn = next.kind === 'cards' ? '<button type="button" class="sp-btn is-main" data-sp="path">Back to study path</button>'
      : next.kind === 'retry_practice' ? `<button type="button" class="sp-btn is-main" data-sp="restart">${esc(next.label || 'Try the problem again')}</button>`
      : `<button type="button" class="sp-btn is-main" data-sp="next-unit" data-id="${esc(next.unit_id || '')}">${esc(next.label || 'Next example')}</button>`;
    return `<article class="sp-card"><h3>What this shows</h3><div class="sp-sum">${cell(m.independent_correct, 'right on your own')}${cell(m.helped_correct, 'right with help')}${cell(m.missed, 'missed')}${cell(m.revealed, 'revealed')}</div>
      <p class="sp-why">Only answers you picked without a hint or the solution count as independent. Reading the example is exposure, not recall.</p></article>
      <div class="sp-nav"><button type="button" class="sp-btn" data-sp="path">Study path</button><span class="sp-grow"></span>${nextBtn}</div>`;
  }
  visualButton(s) { return s.visual || s.visual_key ? '<button type="button" class="sp-btn" data-sp="visual">Diagram</button>' : ''; }
}
