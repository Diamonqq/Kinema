import { openCourseBrowser } from './course_browser.js';
import { modelButton, updateModelContext } from './model_menu.js';
import { esc, txt, mdlite, math } from './md.js';
import { Calculator } from './calculator.js';
import { CircleVisual } from './circle_visual.js';

const icon = (paths) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
const icons = {
  visual: icon('<circle cx="12" cy="12" r="8"/><path d="m12 12 6-5"/><circle cx="18" cy="7" r="2"/>'),
  formulas: icon('<path d="M15 4h-2a3 3 0 0 0-3 3v10a3 3 0 0 1-3 3H5m2-10h9"/>'),
  calculator: icon('<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M8 7h8M8 11h1m6 0h1m-8 4h1m6 0h1m-8 3h1m6 0h1"/>'),
  expand: icon('<path d="M14 4h6v6M10 20H4v-6M20 4l-6 6M4 20l6-6"/>'),
  restore: icon('<path d="M20 10h-6V4M4 14h6v6M14 10l6-6M10 14l-6 6"/>'),
  close: icon('<path d="m6 6 12 12M6 18 18 6"/>'),
  send: icon('<path d="M12 19V5m-6 6 6-6 6 6"/>'),
};

export class LessonWorkspace {
  constructor(host, deps, session, end) {
    this.host = host; this.d = deps; this.s = session; this.end = end;
    this.calc = new Calculator(); this.tab = 'formulas'; this.seq = 0; this.dead = false; this.drafts = new Map();
    this.artifactOpen = false; this.expanded = false;
    this.narrow = matchMedia('(max-width:900px)');
    this.onResize = () => { this.syncModal(); this.resizeComposer(); };
    this.narrow.addEventListener('change', this.onResize);
    this.escape = e => {
      if (document.querySelector('dialog[open]')) return;
      if (!this.host.getClientRects().length) return;
      if (e.key === 'Escape') {
        if (this.host.classList.contains('tools-open')) { this.closeTools(); return; }
        if (this.artifactOpen) { this.setArtifactOpen(false); return; }
        const menu = this.host.querySelector('.problem-menu');
        if (menu && !menu.hidden) { menu.hidden = true; const b = this.host.querySelector('.problem-select'); b.setAttribute('aria-expanded', 'false'); b.focus(); }
      }
      const modal = this.modal();
      if (e.key === 'Tab' && modal) {
        const nodes = [...modal.querySelectorAll('button, input, select, textarea, summary, [tabindex="0"]')].filter(x => x.getClientRects().length && !x.disabled);
        const first = nodes[0], last = nodes.at(-1);
        if (!first) return;
        if (e.shiftKey && (document.activeElement === first || !nodes.includes(document.activeElement))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !nodes.includes(document.activeElement))) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', this.escape);
  }
  dispose() { this.dead = true; this.visual?.dispose(); clearTimeout(this.timer); document.removeEventListener('keydown', this.escape); this.narrow.removeEventListener('change', this.onResize); if (this.header) this.header.inert = this.headerWasInert; }
  post(path, body = {}) { return this.d.api(this.d.url(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  path(n = this.state?.problem.n) { return `/api/session/${this.s.id}/workspace${n ? '/' + n : ''}`; }
  async open(n) {
    this.saveDraft(); const seq = ++this.seq; clearTimeout(this.timer);
    this.host.classList.add('lesson-workspace');
    if (!this.state) this.host.innerHTML = '<div class="workspace-loading" role="status">Opening your problem…</div>';
    try {
      const state = await this.post(this.path(null), n ? { rung: n } : {});
      if (seq !== this.seq || this.dead) return;
      this.state = state; this.busy = false; this.shell();
      const firstPlan = this.s.plan && state.problem.n === this.s.plan.start && !state.step && !state.messages.some(m => m.kind === 'chat');
      this.update(!firstPlan); this.follow();
    } catch (e) {
      if (seq !== this.seq || this.dead) return;
      if (this.state) this.d.toast(e.message);
      else { this.host.innerHTML = `<div class="workspace-loading">${esc(e.message)}<button class="btn" data-reload>Try again</button></div>`;
        this.host.querySelector('[data-reload]').onclick = () => this.open(n); }
    }
  }
  saveDraft() { const input = this.host.querySelector('#lesson-message'); if (input && this.state) this.drafts.set(this.state.problem.n, input.value); }
  shell() {
    const st = this.state, p = st.problem;
    this.visual?.dispose(); this.visual = null; this.lastVisualRevision = st.revision;
    this.host.classList.toggle('has-visual', !!st.visual); this.host.classList.remove('tools-open');
    if (!st.visual) { this.artifactOpen = false; this.expanded = false; }
    this.host.innerHTML = `<div class="work-top">
      <div class="problem-heading"><button type="button" class="problem-select course-open" aria-haspopup="dialog">Problems & plan <span>${p.n} / ${st.ladder.length}</span></button><strong>${txt(p.title)}</strong></div>
      <button class="work-end" data-end>Finish</button></div>
      <div class="work-grid"><section class="conversation" aria-label="Problem conversation">
        <div class="conversation-scroll" tabindex="0"><div class="conversation-inner">
          ${this.s.plan && p.n === this.s.plan.start ? `<section class="learning-intro"><small>Your learning plan</small><p>${esc(this.s.plan.approach)}</p><div>${(st.lesson.modules || []).slice(0,3).map((m,i) => `<span>${i+1}. ${txt(m.title)}</span>`).join('')}<button type="button" data-plan>See the full plan →</button></div></section>` : ''}
          <article class="open-problem">${mdlite(p.problem)}</article>
          <div class="conversation-messages"></div><div class="practice-question"></div>
          <div class="conversation-status" role="status" aria-live="polite"></div>
        </div></div>
        <div class="conversation-bottom"><div class="conversation-actions" aria-label="Suggested replies"></div><form class="conversation-compose">
          <label class="sr-only" for="lesson-message">Message your tutor about this problem</label>
          <textarea id="lesson-message" rows="1" maxlength="2000" placeholder="Ask a question, or say continue…"></textarea>
          <div class="compose-row">
            ${st.visual ? `<button type="button" class="compose-tool" data-open-visual aria-controls="physics-artifact" aria-expanded="false">${icons.visual}<span>Visual</span></button>` : ''}
            <button type="button" class="compose-tool" data-open-tool="formulas" aria-label="Open formulas">${icons.formulas}<span>Formulas</span></button>
            <button type="button" class="compose-tool" data-open-tool="calculator" aria-label="Open calculator">${icons.calculator}<span class="calculator-label">Calculator</span></button>
            ${modelButton()}<button class="send-message" type="submit" aria-label="Send message">${icons.send}</button>
          </div>
        </form></div>
      </section>${st.visual ? `<aside class="visual-desk" id="physics-artifact" aria-label="Interactive physics visual" hidden>
        <div class="artifact-toolbar"><h2>Ball in a circle</h2><button class="artifact-expand" aria-label="Expand visual" title="Expand visual">${icons.expand}</button><button class="artifact-close" aria-label="Close visual" title="Close visual">${icons.close}</button></div>
        <div class="artifact-body"><div class="lesson-artifact"></div><p class="visual-footnote">Drag the ball to inspect a moment.</p></div>
      </aside>` : ''}</div>
      <button class="tools-shade" aria-label="Close study tools" tabindex="-1"></button><aside class="work-tools" aria-label="Study tools"><div class="tools-tabs"><button data-tab="formulas" aria-pressed="${this.tab === 'formulas'}">Formulas</button><button data-tab="calculator" aria-pressed="${this.tab === 'calculator'}">Calculator</button><button class="tools-close" aria-label="Close study tools">${icons.close}</button></div><div class="tools-content"></div></aside>`;
    this.host.querySelector('[data-end]').onclick = () => this.end();
    const browse = () => {
      if (this.artifactOpen && (this.expanded || this.narrow.matches)) this.setArtifactOpen(false);
      openCourseBrowser({title:st.lesson.title, ladder:this.state.ladder, modules:st.lesson.modules, current:p.n, plan:this.s.plan, onChoose:n => this.open(n)});
    };
    this.host.querySelector('.problem-select').onclick = browse;
    this.host.querySelector('[data-plan]')?.addEventListener('click', browse);
    this.host.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { this.tab = b.dataset.tab; this.renderTools(); });
    this.host.querySelectorAll('[data-open-tool]').forEach(b => b.onclick = () => { this.toolOpener = b; this.openTools(b.dataset.openTool); });
    this.host.querySelector('.tools-shade').onclick = () => this.closeTools();
    this.host.querySelector('.tools-close').onclick = () => this.closeTools();
    this.host.querySelector('[data-open-visual]')?.addEventListener('click', e => { this.visualOpener = e.currentTarget; this.setArtifactOpen(!this.artifactOpen); });
    this.host.querySelector('.artifact-close')?.addEventListener('click', () => this.setArtifactOpen(false));
    this.host.querySelector('.artifact-expand')?.addEventListener('click', () => { this.expanded = !this.expanded; this.syncModal(); });
    const input = this.host.querySelector('textarea'); input.value = this.drafts.get(p.n) || '';
    input.oninput = () => { this.saveDraft(); this.resizeComposer(); };
    input.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.send(); } };
    this.host.querySelector('form').onsubmit = e => { e.preventDefault(); this.send(); };
    if (st.visual) this.visual = new CircleVisual(this.host.querySelector('.lesson-artifact'), st.visual);
    this.lastVisualMessage = st.messages.filter(m => m.visual_focus).length;
    this.renderTools(); math(this.host); this.syncModal(); this.resizeComposer();
  }
  resizeComposer() {
    const input = this.host.querySelector('#lesson-message'); if (!input) return;
    input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 220) + 'px';
    this.host.querySelector('.send-message').disabled = !!(this.busy || this.state.pending || !input.value.trim());
  }
  visualCard() {
    return `<button class="artifact-card" data-open-artifact aria-controls="physics-artifact" aria-expanded="${this.artifactOpen}"><span class="artifact-card-icon">${icons.visual}</span><span><b>Ball in a circle</b><small>Interactive visual</small></span><span class="artifact-card-open">${icons.expand}</span></button>`;
  }
  setArtifactOpen(open, focus = true) {
    if (!this.visual) return;
    this.artifactOpen = open;
    if (!open) { this.expanded = false; this.visual.snapshot(); }
    this.syncModal();
    if (focus) {
      const opener = this.visualOpener?.isConnected ? this.visualOpener : this.host.querySelector('[data-open-visual]');
      (open ? this.host.querySelector('.artifact-close') : opener)?.focus({preventScroll:true});
    }
  }
  modal() {
    if (this.host.classList.contains('tools-open')) return this.host.querySelector('.work-tools');
    if (this.artifactOpen && (this.expanded || this.narrow.matches)) return this.host.querySelector('.visual-desk');
    return null;
  }
  syncModal() {
    const toolsOpen = this.host.classList.contains('tools-open'), visualModal = this.artifactOpen && (this.expanded || this.narrow.matches);
    this.host.classList.toggle('artifact-open', this.artifactOpen);
    this.host.classList.toggle('artifact-expanded', this.artifactOpen && this.expanded);
    const aside = this.host.querySelector('.visual-desk');
    if (aside) {
      aside.hidden = !this.artifactOpen;
      if (visualModal) { aside.setAttribute('role','dialog'); aside.setAttribute('aria-modal','true'); }
      else { aside.removeAttribute('role'); aside.removeAttribute('aria-modal'); }
      const expand = aside.querySelector('.artifact-expand');
      expand.innerHTML = this.expanded ? icons.restore : icons.expand;
      expand.setAttribute('aria-label', this.expanded ? 'Restore visual size' : 'Expand visual');
      expand.title = this.expanded ? 'Restore visual size' : 'Expand visual';
    }
    this.host.querySelectorAll('[data-open-visual], [data-open-artifact]').forEach(b => b.setAttribute('aria-expanded', String(this.artifactOpen)));
    const grid = this.host.querySelector('.work-grid'), top = this.host.querySelector('.work-top'), chat = this.host.querySelector('.conversation');
    if (grid) grid.inert = toolsOpen;
    if (top) top.inert = toolsOpen || visualModal;
    if (chat) chat.inert = visualModal;
    if (!this.header) { this.header = document.querySelector('body>header'); this.headerWasInert = this.header?.inert; }
    if (this.header) this.header.inert = toolsOpen || visualModal || this.headerWasInert;
    if (visualModal && !toolsOpen && !aside.contains(document.activeElement)) aside.querySelector('.artifact-close').focus({preventScroll:true});
  }
  openTools(tab, formula) {
    this.tab = tab; this.renderTools(); this.host.classList.add('tools-open');
    const aside = this.host.querySelector('.work-tools'); aside.setAttribute('role','dialog'); aside.setAttribute('aria-modal','true');
    this.syncModal();
    this.host.querySelector(`[data-tab=${tab}]`).focus();
    if (formula) {
      let node = this.host.querySelector(`[data-formula="${CSS.escape(formula)}"]`);
      if (!node) { const all = this.host.querySelector('.all-formulas'); all.open = true; all.dispatchEvent(new Event('toggle')); node = this.host.querySelector(`[data-formula="${CSS.escape(formula)}"]`); }
      if (node) { node.open = true; node.scrollIntoView({block:'nearest'}); }
    }
  }
  closeTools() {
    const wasOpen = this.host.classList.contains('tools-open'); this.host.classList.remove('tools-open');
    const aside = this.host.querySelector('.work-tools'); aside?.removeAttribute('role'); aside?.removeAttribute('aria-modal');
    this.syncModal();
    if (wasOpen) { const opener = this.toolOpener?.isConnected ? this.toolOpener : this.host.querySelector('[data-open-tool]'); (this.modal()?.querySelector('button') || opener)?.focus({preventScroll:true}); }
  }
  update(scroll = true) {
    const st = this.state, blocked = this.busy || st.pending;
    updateModelContext(this.host, {kind:'course', messages:st.messages});
    this.host.querySelector('#lesson-message').placeholder = st.phase === 'example' ? 'Ask a question, or say continue…' : 'Ask anything about this problem…';
    const forms = new Map(st.lesson.groups.flatMap(g => g.formulas).map(f => [f.id, f]));
    // Button clicks are controls, not pretend user chat. Their saved history is retained.
    this.host.querySelector('.conversation-messages').innerHTML = st.messages.filter(m => !(m.role === 'user' && m.kind === 'guide')).map((m, i) => `<article class="conversation-message ${m.role}">${m.kind === 'step' ? `<div class="message-label">Step ${m.step} of ${st.steps}</div>` : m.kind === 'practice' ? '<div class="message-label">Your turn</div>' : ''}<div class="message-body">${mdlite(m.text)}</div>${(m.formula_ids || []).filter(id => forms.has(id)).map(id => { const f = forms.get(id); return `<button class="chat-formula" data-show-formula="${esc(id)}"><span>$${esc(f.latex)}$</span><small>${txt(f.name)} ↗</small></button>`; }).join('')}${m.visual_focus && st.visual ? `<button class="visual-replay" data-show-visual="${esc(m.visual_focus)}">Show in the visual ↗</button>` : ''}</article>${i === 0 && st.visual ? this.visualCard() : ''}`).join('');
    this.host.querySelectorAll('[data-show-formula]').forEach(b => b.onclick = () => { this.toolOpener = b; this.openTools('formulas', b.dataset.showFormula); });
    this.host.querySelectorAll('[data-show-visual]').forEach(b => b.onclick = () => { this.visualOpener = b; this.visual?.focus(b.dataset.showVisual); this.setArtifactOpen(true); });
    this.host.querySelectorAll('[data-open-artifact]').forEach(b => b.onclick = () => { this.visualOpener = b; this.setArtifactOpen(true); });
    const question = this.host.querySelector('.practice-question');
    question.innerHTML = st.question && st.phase === 'turn' ? `<div class="practice-choices">${st.question.choices.map((c, i) => `<button data-answer="${i}" ${blocked ? 'disabled' : ''}>${txt(c)}</button>`).join('')}<button data-answer="-1" ${blocked ? 'disabled' : ''}>I don't know yet</button></div>` : '';
    question.querySelectorAll('[data-answer]').forEach(b => b.onclick = () => this.act('answer', { picked: +b.dataset.answer }));
    let buttons = '';
    if (st.phase === 'example') buttons = st.step < st.steps
      ? `<button class="btn" data-action="step">${st.step ? 'Continue the example' : 'Walk me through it'} <span aria-hidden="true">↗</span></button>`
      : st.has_turn ? `<button class="btn" data-action="turn">Try it myself <span aria-hidden="true">↗</span></button>` : st.problem.n < st.ladder.length ? '<button class="btn" data-next>Next problem ↗</button>' : '<button class="btn" data-end-course>Finish for now</button>';
    if (st.phase === 'review') buttons = `${!['correct','correct_hint'].includes(st.outcome) ? '<button class="btn" data-help>Help me understand</button><button class="btn ghost" data-action="retry_question">Try again</button>' : ''}${st.problem.n < st.ladder.length ? `<button class="btn ${['correct','correct_hint'].includes(st.outcome) ? 'p' : 'ghost'}" data-next>Next problem →</button>` : '<button class="btn p" data-end-course>Finish for now</button>'}`;
    this.host.querySelector('.conversation-actions').innerHTML = buttons;
    if (st.session.spent_s >= st.session.budget_s) {
      const notice = document.createElement('div'); notice.className = 'work-break';
      notice.innerHTML = `Time for a break? Your place is saved. <button class="link" data-more-time>Keep going for 30 minutes</button>`;
      this.host.querySelector('.conversation-actions').appendChild(notice);
      notice.querySelector('button').onclick = async () => { try { await this.post(`/api/session/${this.s.id}/extend`); await this.refresh(false); } catch(e) { this.d.toast(e.message); } };
    }
    this.host.querySelectorAll('[data-action]').forEach(b => { b.disabled = !!blocked; b.onclick = () => this.act(b.dataset.action); });
    const next = this.host.querySelector('[data-next]'); if (next) { next.disabled = !!blocked; next.onclick = () => this.open(st.problem.n + 1); }
    this.host.querySelector('[data-end-course]')?.addEventListener('click', () => this.end());
    const help = this.host.querySelector('[data-help]'); if (help) { help.disabled = !!blocked; help.onclick = () => this.send('Help me understand where I went wrong, one step at a time.'); }
    this.host.querySelector('.conversation-status').innerHTML = st.pending ? '<span class="spin"></span> Thinking about this step…' : st.error ? `${esc(st.error)} <button class="link" data-retry-reply>Retry reply</button>` : '';
    this.host.querySelector('[data-retry-reply]')?.addEventListener('click', () => this.act('retry'));
    this.resizeComposer();
    if (st.visual && this.visual) {
      if (st.visual.scenario !== this.visual.spec.scenario) {
        this.visual.dispose(); this.visual = new CircleVisual(this.host.querySelector('.lesson-artifact'), st.visual);
      } else this.visual.sync(st.visual, st.revision !== this.lastVisualRevision);
      this.lastVisualRevision = st.revision; this.visual.lock(blocked);
      const visualMessages = st.messages.filter(m => m.visual_focus).length;
      if (visualMessages > this.lastVisualMessage && !this.narrow.matches) this.setArtifactOpen(true, false);
      this.lastVisualMessage = visualMessages;
    }
    math(this.host.querySelector('.conversation-scroll'));
    if (scroll) { const box = this.host.querySelector('.conversation-scroll'); box.scrollTop = box.scrollHeight; }
  }
  async send(text) {
    if (window.KinemaAccount && !window.KinemaAccount.signedIn) { window.KinemaAccount.promptSignIn(); return; }
    const input = this.host.querySelector('textarea'), q = text || input.value.trim();
    if (!q || this.busy || this.state.pending) return;
    const saved = input.value; input.value = ''; this.saveDraft(); this.resizeComposer();
    let ok;
    const planning = /from scratch|start over|start again|from (?:the )?(?:very )?(?:beginning|basics)|^(?:i (?:want|wanna|need) to |let'?s |lets )?(?:learn|study|practice|practise|get started)/i.test(q);
    if (planning && this.d.goal) {
      this.busy = true; this.update(false);
      this.host.querySelector('.conversation-status').textContent = 'Planning your next steps…';
      try { ok = await this.d.goal(q, {lesson:this.state.lesson.id, fromChat:true}); }
      finally { if (!this.dead) { this.busy = false; this.update(false); } }
      if (ok === 'blocked' && !this.dead) { input.value = saved || q; this.saveDraft(); this.resizeComposer(); return; }
      if (ok) return;
    }
    ok = await this.act('chat', { text: q, visual_state: this.visual?.snapshot() });
    if (!ok && !this.dead && this.host.contains(input) && !input.value) { input.value = saved || q; this.saveDraft(); this.resizeComposer(); }
  }
  async act(action, extra = {}) {
    if (this.busy || this.state.pending) return false;
    const seq = this.seq, n = this.state.problem.n, token = crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint32Array(4)), x => x.toString(16)).join('-');
    this.busy = true; this.update(false);
    try {
      const state = await this.post(this.path(n) + '/act', { action, ...(action === 'answer' ? {visual_state:this.visual?.snapshot()} : {}), ...extra, revision: this.state.revision, request_id: token });
      if (seq !== this.seq || this.dead) return true;
      this.state = state; this.busy = false; this.update(); this.follow(); this.d.onChange?.(); return true;
    } catch (e) {
      if (seq === this.seq && !this.dead) { this.busy = false; this.d.toast(e.message); await this.refresh(false); }
      return this.state?.last_request === token;
    }
  }
  async refresh(scroll = true) {
    const seq = this.seq;
    try { const state = await this.d.api(this.d.url(this.path()));
      if (this.dead || seq !== this.seq) return;
      this.state = state; this.update(scroll); this.follow();
    } catch (e) {
      if (!this.dead && seq === this.seq) {
        this.host.querySelector('.conversation-status').textContent = 'Connection interrupted. Your conversation is saved; trying again…';
        clearTimeout(this.timer); this.timer = setTimeout(() => this.refresh(false), 5000);
      }
    }
  }
  follow() { clearTimeout(this.timer); if (this.state.pending && !this.dead) this.timer = setTimeout(() => this.refresh(), 1000); }
  renderTools() {
    this.host.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-pressed', String(this.tab === b.dataset.tab)));
    const host = this.host.querySelector('.tools-content');
    if (this.tab === 'calculator') return this.calc.mount(host, esc, text => {
      const input = this.host.querySelector('textarea'); input.value = (input.value ? input.value + '\n' : '') + text;
      this.saveDraft(); this.closeTools(); this.resizeComposer(); input.focus();
    });
    const forms = this.state.lesson.groups.flatMap(g => g.formulas.map(f => ({ ...f, group: g.title })));
    const used = forms.filter(f => this.state.problem.uses.includes(f.id));
    const card = f => `<details class="reference-formula" data-formula="${esc(f.id)}"><summary><span>${txt(f.name)}</span><span class="reference-equation">$${esc(f.latex)}$</span></summary><div class="reference-meaning"><p>${txt(f.words)}</p><dl>${(f.symbols || []).map(s => `<dt>$${esc(s.sym)}$</dt><dd>${txt(s.meaning)}</dd>`).join('')}</dl><p class="formula-condition"><b>Use when</b> ${txt(f.use_when || '')}</p><button class="link" data-ask-formula="${esc(f.name)}">Explain this in our problem ↗</button></div></details>`;
    host.innerHTML = `<div class="reference-top"><h2>For this problem</h2><p>Open a formula for its meaning, symbols and units.</p></div><div class="reference-used">${used.map(card).join('') || '<p>No new formulas here.</p>'}</div><details class="all-formulas"><summary>Browse all ${forms.length} formulas</summary><label class="sr-only" for="formula-search">Search formulas</label><input id="formula-search" placeholder="Search names, symbols or meanings…" autocomplete="off"><div class="reference-results"></div></details>`;
    const all = host.querySelector('.all-formulas'), search = host.querySelector('input'), results = host.querySelector('.reference-results');
    const bind = root => { root.querySelectorAll('[data-ask-formula]').forEach(b => b.onclick = () => { this.closeTools(); this.send('Explain ' + b.dataset.askFormula + ' in this problem, including the symbols and units.'); }); math(root); };
    const filter = () => { const q = search.value.toLowerCase().trim(); const hits = forms.filter(f => !q || JSON.stringify(f).toLowerCase().includes(q));
      results.innerHTML = hits.map(card).join('') || '<p>No matching formulas.</p>'; bind(results); };
    all.ontoggle = () => { if (all.open && !results.childElementCount) filter(); };
    search.oninput = filter; bind(host);
  }
}
