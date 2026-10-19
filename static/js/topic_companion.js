import { esc, mdlite, math, texExpr } from './md.js';
import { RefresherCard } from './refresher_card.js';

const notesHTML = src => mdlite(String(src).split(/(\$\$[\s\S]*?\$\$|\$[^$\n]*\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\])/).map((part, i) => i % 2 ? part : part.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1')).join(''));

// Preserve every word and mathematical expression while giving each idea breathing room.
// Display equations stay intact; unusual long paragraphs can still scroll at narrow sizes.
export function readingPages(value, limit = 430) {
  const source = String(value || '').trim();
  if (!source) return [];
  const math = [];
  const protectedText = source.replace(/\$\$[\s\S]*?\$\$|\$[^$\n]*\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g, m => `\u0001${math.push(m) - 1}\u0002`);
  const restore = s => s.replace(/\u0001(\d+)\u0002/g, (_, n) => math[n]);
  const pages = [];
  for (const paragraph of protectedText.split(/\n\s*\n/)) {
    const sentences = restore(paragraph).length > limit ? paragraph.split(/(?<=[.!?])\s+(?=[A-Z])/) : [paragraph];
    for (const sentence of sentences) {
      const text = restore(sentence).trim();
      if (!text) continue;
      const previous = pages.at(-1);
      if (previous && previous.length + text.length + 2 <= limit) pages[pages.length - 1] += '\n\n' + text;
      else pages.push(text);
    }
  }
  return pages;
}

export function conceptPages(lesson) {
  const pages = [];
  const add = (title, text, kind) => readingPages(text).forEach((body, i, all) => pages.push({ title, body, kind, continuation: all.length > 1 ? `${i + 1} of ${all.length}` : '' }));
  if (lesson.summary) add('The idea', lesson.summary, 'Concept');
  for (const part of lesson.parts || []) if (part.body_md?.trim() !== lesson.summary?.trim()) add(part.title, part.body_md, 'Concept');
  for (const item of lesson.prerequisites || []) add(item.idea, item.refresher_md, 'Basics');
  return pages;
}

/* One continuous lesson: ideas, then each worked example one step at a time, then a similar
   question. Every prepared sentence and equation is kept; only the order of appearance is
   decided here. `next` is the label of the control that reveals that part. */
export function lessonFlow(lesson) {
  const parts = [];
  const add = part => parts.push({ ...part, index: parts.length, key: `${part.kind}:${parts.length}` });
  const ideaNext = () => parts.length ? 'Next idea' : '';
  if (lesson.summary) add({ kind: 'idea', role: 'idea', title: 'The idea', body: lesson.summary, next: ideaNext() });
  for (const item of lesson.prerequisites || []) add({ kind: 'idea', role: 'refresh', title: item.idea, body: item.refresher_md, next: parts.length ? 'Basics' : '' });
  for (const part of lesson.parts || []) if (part.body_md?.trim() !== lesson.summary?.trim()) add({ kind: 'idea', role: 'idea', title: part.title, body: part.body_md, next: ideaNext() });
  (lesson.examples || []).forEach((example, e) => {
    const setup = parts.length;
    add({ kind: 'example_step', role: 'setup', example: e, title: example.title, body: example.setup_md, next: e ? 'Another example' : 'See an example', anchor: true });
    (example.steps || []).forEach((step, s) => add({ kind: 'example_step', role: 'step', example: e, step: s, setup, title: `Step ${s + 1}`, equation: step.math, body: step.why, next: s ? 'Reveal next step' : 'Start the solution' }));
    if (example.answer_md) add({ kind: 'example_step', role: 'answer', example: e, setup, title: 'The result', body: example.answer_md, next: 'See the result' });
    if (example.check_md) add({ kind: 'example_step', role: 'check', example: e, setup, title: 'Does it make sense?', body: example.check_md, next: 'Check it' });
  });
  const p = lesson.practice;
  if (p?.question_md) {
    const question = parts.length;
    add({ kind: 'try', role: 'question', title: 'Your turn', body: p.question_md, next: 'Try a similar question', anchor: true });
    (p.hints || []).forEach((hint, h) => add({ kind: 'try', role: 'hint', setup: question, title: `Hint ${h + 1}`, body: hint, next: 'Reveal a hint' }));
    if (p.answer_md) add({ kind: 'try', role: 'answer', setup: question, title: 'The answer', body: p.answer_md, next: 'Reveal the answer' });
  }
  return parts;
}

export function notesFlow(section) {
  return readingPages(section.notes || section.summary || '').map((body, i, all) => ({ kind: 'idea', role: 'idea', index: i, key: 'idea:' + i, title: i ? `${section.title} (continued)` : 'The idea', body, next: i ? 'Next' : '', last: i === all.length - 1 }));
}

export function sectionFlow(section) {
  return section.lesson ? lessonFlow(section.lesson) : notesFlow(section);
}

/* Which revealed parts may fold away when the pane runs out of room: never the newest two
   parts, never the question/setup the newest part belongs to. Oldest first. */
export function foldable(parts, revealed) {
  const newest = Math.min(revealed, parts.length) - 1, keep = new Set([newest, newest - 1]);
  const current = parts[newest];
  if (current?.setup !== undefined) keep.add(current.setup);
  return parts.slice(0, Math.max(0, newest + 1)).filter(p => !keep.has(p.index)).map(p => p.index);
}

export function partText(part) {
  return [part.title, part.equation ? `$$${part.equation}$$` : '', part.body].filter(Boolean).join('\n');
}

/* A problem's revealed solution as one continuous flow: every accepted tutor step is a numbered part. The saved
   text stays the authority; only a leading "Step n:" label is dropped because the number sits in the gutter. */
export function solutionFlow(steps) {
  return (steps || []).map((s, i) => ({
    kind: 'solution_step', role: 'solution', index: i, step: i, key: s.message_id || String(i), message_id: s.message_id, title: `Step ${i + 1}`,
    body: String(s.text || '').replace(/^\s*(\*\*)?\s*Step\s+\d+\s*[:.\-\u2013\u2014]?\s*(\*\*)?/i, (m, a, b) => (a && !b ? '**' : '')).trim(),
  }));
}

const clamp = (value, count) => Math.max(0, Math.min(Number(value) || 0, Math.max(0, count - 1)));
const arrow = direction => `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="${direction === 'back' ? 'M12 5l-5 5 5 5' : direction === 'down' ? 'M5 8l5 5 5-5' : 'M8 5l5 5-5 5'}"/></svg>`;

/* Browsing references never changes teaching scope, sends a message, or records progress. */
export class TopicCompanion {
  constructor(teacher) {
    this.t = teacher;
    this.host = document.createElement('aside');
    this.host.className = 'tv-topic'; this.host.hidden = true;
    this.host.setAttribute('aria-label', 'Study notes');
    this.dock = teacher.host.querySelector('#tv-visual'); this.dock.append(this.host);
    this.grip = document.createElement('div'); this.grip.className = 'tv-topic-resize'; this.grip.tabIndex = 0;
    this.grip.setAttribute('role', 'separator'); this.grip.setAttribute('aria-orientation', 'vertical'); this.grip.setAttribute('aria-label', 'Resize study notes');
    this.grip.title = 'Drag to resize notes. Arrow keys resize; double-click resets.'; this.dock.append(this.grip);
    this.button = document.createElement('button');
    this.button.type = 'button'; this.button.className = 'tv-topic-toggle';
    this.button.textContent = 'Study notes'; this.button.hidden = true;
    this.button.setAttribute('aria-expanded', 'false');
    teacher.el.read.closest('.tv-readwrap').before(this.button);
    this.button.onclick = () => this.toggle();
    this.media = matchMedia('(max-width:900px)');
    this.media.addEventListener('change', () => this.sync());
    this.closed = new Set(); this.selected = new Map(); this.lessonViews = new Map(); this.scrolls = new Map(); this.preferences = new Map();
    this.host.addEventListener('click', e => this.click(e));
    this.host.addEventListener('change', e => this.change(e));
    this.host.addEventListener('toggle', e => this.toggled(e), true);
    try { this.refresher = new RefresherCard(teacher); } catch (e) { /* no chat composer on this page: no refresher cards */ }
    this.grip.addEventListener('pointerdown', e => {
      if (e.button !== 0 || this.media.matches) return;
      e.preventDefault(); this.drag = { x: e.clientX, width: this.width(), thread: this.t.thread.id }; this.grip.setPointerCapture(e.pointerId); this.t.host.classList.add('topic-resizing');
    });
    this.grip.addEventListener('pointermove', e => { if (this.drag?.thread === this.t.thread?.id) this.setWidth(this.drag.width + this.drag.x - e.clientX); });
    const end = () => { this.drag = null; this.t.host.classList.remove('topic-resizing'); };
    this.grip.addEventListener('pointerup', end); this.grip.addEventListener('pointercancel', end); this.grip.addEventListener('lostpointercapture', end);
    this.grip.addEventListener('dblclick', () => { this.pref().width = null; this.savePref(); this.layout(); });
    this.grip.addEventListener('keydown', e => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
      e.preventDefault(); const bounds = this.bounds(); this.setWidth(e.key === 'Home' ? bounds.min : e.key === 'End' ? bounds.max : this.width() + (e.key === 'ArrowLeft' ? 1 : -1) * (e.shiftKey ? 80 : 24));
    });
    new ResizeObserver(() => requestAnimationFrame(() => this.layout())).observe(teacher.host);
    this.flowObserver = new ResizeObserver(() => this.queueFit());
    new MutationObserver(() => this.queueFit()).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });   // the Aa reading size changes content height, not the pane
    document.addEventListener('pointerdown', e => {
      for (const picker of document.querySelectorAll('.tv-section-picker[open]')) if (!picker.contains(e.target)) picker.open = false;
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        const picker = [...document.querySelectorAll('.tv-section-picker[open]')].find(x => x.getClientRects().length);
        if (picker) { e.preventDefault(); e.stopImmediatePropagation(); picker.open = false; picker.querySelector('summary').focus(); return; }
      }
      if (!this.expanded || this.t.el.dialog.open) return;
      if (e.key === 'Escape') { e.preventDefault(); this.expand(false); }
      else if (e.key === 'Tab') {
        const items = [...this.host.querySelectorAll('button,select,summary,[tabindex="0"]')].filter(x => x.getClientRects().length && !x.disabled), first = items[0], last = items.at(-1);
        if (e.shiftKey && (document.activeElement === first || !this.host.contains(document.activeElement))) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !this.host.contains(document.activeElement))) { e.preventDefault(); first?.focus(); }
      }
    });
    window.KinemaCompanion = { getVisibleContext: () => this.getVisibleContext() };
  }
  pref() {
    const id = this.t.thread?.id || '';
    if (!this.preferences.has(id)) { let saved; try { saved = JSON.parse(localStorage.getItem('kinema.notes.view.' + id)); } catch { } this.preferences.set(id, saved && typeof saved === 'object' ? saved : {}); }
    return this.preferences.get(id);
  }
  savePref() { try { localStorage.setItem('kinema.notes.view.' + this.t.thread.id, JSON.stringify(this.pref())); } catch { } }
  bounds() { const space = this.t.host.clientWidth - (this.t.host.classList.contains('tv-side-open') ? 200 : 0); return { min: 360, max: Math.max(360, Math.min(1200, space - 420)) }; }
  width() { const { min, max } = this.bounds(), saved = Number(this.pref().width), space = this.t.host.clientWidth - (this.t.host.classList.contains('tv-side-open') ? 200 : 0); return Math.round(Math.max(min, Math.min(max, saved > 0 ? saved : Math.min(820, space * .46)))); }
  setWidth(value) { const {min,max} = this.bounds(); this.pref().width = Math.round(Math.max(min, Math.min(max, value))); this.savePref(); this.layout(); }
  layout() {
    if (!this.t.thread || this.media.matches) return;
    const width = this.width(), bounds = this.bounds(); this.t.host.style.setProperty('--topic-width', width + 'px');
    this.grip.setAttribute('aria-valuenow', width); this.grip.setAttribute('aria-valuemin', bounds.min); this.grip.setAttribute('aria-valuemax', bounds.max);
  }
  expand(value) { this.pref().expanded = value; this.savePref(); this.sync(); this.host.querySelector('[data-topic=expand]')?.focus({preventScroll:true}); }
  active() { if (this.t.workspace?.manages()) return false; return !!(this.t.thread?.topic_companion || this.t.thread?.book_problem) && !this.t.page && !this.t.studyShown && !this.t.threadLoading && !this.t.creating; }
  isClosed() {
    const id = this.t.thread?.id;
    try { return localStorage.getItem('kinema.notes.closed.' + id) === '1'; } catch { return this.closed.has(id); }
  }
  close(value) {
    const id = this.t.thread?.id; if (!id) return;
    if (value) this.closed.add(id); else this.closed.delete(id);
    try { localStorage.setItem('kinema.notes.closed.' + id, value ? '1' : '0'); } catch { }
  }
  rows(sheet) { return (sheet?.sections || []).flatMap(s => [s, ...(s.subsections || []).filter(x => x.notes || x.lesson)]); }
  selection(sheet) { return this.rows(sheet).find(r => r.id === (this.selected.get(this.t.thread.id) || this.pref().section)) || this.rows(sheet)[0]; }
  lessonView(s) {
    const key = this.t.thread.id + ':' + s.id;
    if (!this.lessonViews.has(key)) { const saved = this.pref().views?.[s.id]; this.lessonViews.set(key, { revealed: Math.max(1, Number(saved?.revealed) || 1), idea: Math.max(0, Number(saved?.idea) || 0) }); }
    return this.lessonViews.get(key);
  }
  /* The newest visible lesson part, so a tutor question can refer to exactly what is on screen. */
  getVisibleContext() {
    const t = this.t.thread, sheet = t?.topic_companion;
    const mobileOpen = this.media.matches && this.t.el.dialog.open && !!this.t.el.dialog.querySelector('.tv-topic-mobile');
    if (!sheet || t.book_problem || !this.active() || (this.media.matches ? !mobileOpen : this.isClosed())) return null;
    const s = this.selection(sheet); if (!s) return null;
    const parts = sectionFlow(s); if (!parts.length) return null;
    const part = parts[clamp(this.lessonView(s).revealed - 1, parts.length)];
    return { section_id: s.id, part_kind: part.kind, part_index: part.index, title: part.title, text: partText(part) };
  }
  announce() {
    const ctx = this.getVisibleContext(), sig = JSON.stringify(ctx);
    if (!ctx || sig === this.announced) return;
    this.announced = sig; document.dispatchEvent(new CustomEvent('kinema:companion-step', { detail: ctx }));
  }
  render() {
    const sheet = this.t.thread?.topic_companion;
    if (this.t.workspace?.manages()) { this.signature = null; return this.sync(); }
    if (!sheet && !this.t.thread?.book_problem) { this.signature = null; return this.sync(); }
    if (this.solutionErrorThread && this.solutionErrorThread !== this.t.thread.id) this.solutionError = '';
    const selected = this.selection(sheet);
    const stepCount = this.t.thread.book_solution?.steps?.length || 0;
    if (this.solutionSeen?.thread === this.t.thread.id && stepCount > this.solutionSeen.count) { this.revealed = solutionFlow(this.t.thread.book_solution.steps).at(-1).key; queueMicrotask(() => { this.revealed = null; }); }   // a newly accepted step eases in
    this.solutionSeen = { thread: this.t.thread.id, count: stepCount };
    const sig = JSON.stringify([this.t.thread.id, sheet, this.selected.get(this.t.thread.id), selected && this.lessonView(selected), this.pref().problemTab, this.pref().related, this.t.thread.book_solution, this.t.thread.error, this.pending(), this.solutionError]);
    if (sig !== this.signature) {
      if (this.renderKey) this.scrolls.set(this.renderKey, this.host.querySelector('.tv-flow, .tv-topic-body')?.scrollTop || 0);
      const view = selected && this.lessonView(selected);
      this.renderKey = [this.t.thread.id, selected?.id, JSON.stringify(view), this.pref().problemTab, this.pref().related].join(':');
      this.signature = sig; this.flowObserver.disconnect();
      this.host.innerHTML = `<header><h2>Study notes</h2><button type="button" class="tv-icon" data-topic="expand" aria-label="Expand study notes">↗</button><button type="button" class="tv-icon" data-topic="close" aria-label="Hide study notes">×</button></header><div class="tv-topic-body">${this.content(sheet)}</div>`;
      math(this.host);
      this.settle(this.host, this.scrolls.get(this.renderKey));
      const mobile = this.t.el.dialog.querySelector('.tv-topic-mobile');
      if (mobile && this.t.el.dialog.open) { mobile.innerHTML = this.content(sheet); math(mobile); this.settle(mobile); }
    }
    this.sync(); this.announce();
  }
  /* After new HTML: fold overflow, then show the newest part (or the remembered reading position). */
  settle(root, scrollTop) {
    const flow = root.querySelector('.tv-flow');
    if (flow) { this.flowObserver.observe(flow); this.fit(root); flow.scrollTop = this.revealed || scrollTop === undefined ? flow.scrollHeight : scrollTop; }
    else { const body = root.querySelector('.tv-topic-body'); if (body) body.scrollTop = scrollTop || 0; }
  }
  queueFit() {
    if (this.fitQueued) return;
    this.fitQueued = true;
    requestAnimationFrame(() => { this.fitQueued = false; for (const root of [this.host, this.t.el.dialog]) if (root.querySelector('.tv-flow')) this.fit(root); });
  }
  /* Everything revealed stays on one surface. Only when the surface runs out of room do the
     oldest foldable parts move behind one quiet "Earlier steps" disclosure; opening it shows
     every part again with ordinary scrolling. Nothing is shrunk or clipped. */
  fit(root) {
    const flow = root.querySelector('.tv-flow'), list = flow?.querySelector('.tv-parts'), earlier = flow?.querySelector('.tv-earlier');
    if (!list || !earlier) return;
    const body = earlier.querySelector('.tv-earlier-body');
    if (earlier.open) return;
    for (const part of [...body.children]) list.insertBefore(part, [...list.children].find(c => Number(c.dataset.index) > Number(part.dataset.index)) || null);
    earlier.hidden = true;
    const candidates = [...list.children].filter(p => p.dataset.foldable === '1');
    let n = 0;
    while (n < candidates.length && flow.scrollHeight > flow.clientHeight + 1) { body.append(candidates[n++]); earlier.hidden = false; }
    const count = earlier.querySelector('.tv-earlier-count'); if (count) count.textContent = n > 1 ? `${n} parts` : '';
    // the anchored parts may still overflow (enlarged text, narrow pane): keep the newest in view rather than hiding it below the fold
    const newest = list.lastElementChild;
    if (newest && flow.scrollHeight > flow.clientHeight + 1 && newest.getBoundingClientRect().bottom > flow.getBoundingClientRect().bottom + 1) flow.scrollTop = flow.scrollHeight;
  }
  toggled(e) {
    const earlier = e.target.closest?.('.tv-earlier'); if (!earlier) return;
    const root = earlier.closest('.tv-topic-mobile') || this.host;
    if (earlier.open) { const flow = root.querySelector('.tv-flow'); flow.scrollTop = 0; }
    else this.fit(root);
  }
  content(sheet) {
    if (this.t.thread.book_problem) return this.problemHTML(sheet);
    return this.referenceHTML(sheet);
  }
  referenceHTML(sheet, related = false) {
    const rows = this.rows(sheet), s = this.selection(sheet);
    if (!s) return '<p class="tv-pane-muted">Ask in the chat about the idea you want to understand.</p>';
    const label = r => `${r.id} ${r.title}`;
    const pick = r => `<button type="button" data-topic="select" data-section="${esc(r.id)}" title="${esc(label(r))}"${r.id === s.id ? ' aria-current="page"' : ''}>${esc(label(r))}</button>`;
    const chooser = rows.length > 1 ? `<details class="tv-section-picker"><summary title="Choose a section" aria-label="Choose a section"><span class="tv-picker-closed">Sections</span>${arrow('down')}</summary><nav aria-label="Reference sections">${rows.map(pick).join('')}</nav></details>` : '';
    return `<article class="tv-topic-article" data-selected-section="${esc(s.id)}"><header><h3>${esc(label(s))}</h3>${chooser}</header>${this.flowHTML(s, rows, related)}</article>`;
  }
  partHTML(part, newest) {
    const kicker = part.role === 'setup' ? '<small class="tv-part-kicker">Worked example</small>' : part.role === 'refresh' ? '<small class="tv-part-kicker">Basics</small>' : '';
    const inner = part.role === 'step'
      ? `<span class="tv-step-n" aria-hidden="true">${part.step + 1}</span><div class="tv-step-math">${texExpr(part.equation, true)}</div><div class="tv-page-copy tv-step-why">${notesHTML(part.body || '')}</div>`
      : `<h4>${kicker}${esc(part.title || '')}</h4><div class="tv-page-copy">${notesHTML(part.body || '')}</div>${part.role === 'question' ? '<p class="tv-pane-help">Work it on paper. Reveal a hint only when you need one.</p>' : ''}`;
    return `<section class="tv-reading-page tv-part tv-part-${esc(part.role)}${newest ? ' is-newest' : ''}${newest && this.revealed === part.key ? ' is-new' : ''}" data-index="${part.index}" data-key="${esc(part.key)}" data-foldable="${part.foldable ? 1 : 0}" tabindex="-1" aria-label="${esc(part.title || 'Study note')}">${inner}</section>`;
  }
  flowHTML(s, rows, related) {
    const parts = sectionFlow(s), view = this.lessonView(s), revealed = Math.max(1, Math.min(view.revealed, parts.length));
    if (!parts.length) return '<p class="tv-pane-muted">Ask about this idea in the chat.</p>';
    const fold = new Set(foldable(parts, revealed));
    const shown = parts.slice(0, revealed).map(p => ({ ...p, foldable: fold.has(p.index) }));
    const upcoming = parts[revealed], after = rows[rows.findIndex(r => r.id === s.id) + 1];
    const firstExample = parts.find(p => p.role === 'setup');
    const help = related ? '<p class="tv-pane-help">A separate example to learn the method. Use Solution for your chosen problem.</p>' : '';
    const aside = upcoming && firstExample && revealed < firstExample.index ? `<button type="button" class="tv-flow-skip" data-topic="reveal" data-count="${firstExample.index + 1}">Skip to the example</button>`
      : !upcoming && revealed > 1 ? '<button type="button" class="tv-flow-skip" data-topic="reveal" data-count="1">Start over</button>' : '<span></span>';
    const next = upcoming ? `<button type="button" class="tv-page-next" data-topic="reveal" data-count="${revealed + 1}"><span>${esc(upcoming.next || 'Next')}</span>${arrow('next')}</button>`
      : after && !related ? `<button type="button" class="tv-page-next" data-topic="select" data-section="${esc(after.id)}"><span>Next: ${esc(after.id)} ${esc(after.title)}</span>${arrow('next')}</button>` : '<span class="tv-page-end">That’s all for this section.</span>';
    return `${help}<div class="tv-flow"><details class="tv-earlier" hidden><summary>${arrow('next')}<span>Earlier steps</span><small class="tv-earlier-count"></small></summary><div class="tv-earlier-body"></div></details><div class="tv-parts" aria-live="polite">${shown.map((p, i) => this.partHTML(p, i === shown.length - 1)).join('')}</div></div><nav class="tv-page-nav" aria-label="Lesson flow">${aside}${next}</nav>`;
  }
  tabs(tabs, active, action, label) {
    return `<nav class="tv-lesson-tabs" aria-label="${label}">${tabs.map(([id, title]) => `<button type="button" data-topic="${action}" data-tab="${id}" aria-current="${id === active ? 'page' : 'false'}">${title}</button>`).join('')}</nav>`;
  }
  pageHTML(page) {
    return `<section class="tv-reading-page tv-topic-note mdb" tabindex="-1" aria-label="${esc(page.title || 'Study note')}"><h4>${esc(page.title || '')}</h4>${page.equation ? `<div class="tv-step-math">${texExpr(page.equation, true)}</div>` : ''}<div class="tv-page-copy">${notesHTML(page.body || '')}</div></section>`;
  }
  pager(index, count, action, nextLabel = 'Next', ending = '') {
    return `<nav class="tv-page-nav" aria-label="Reading pages"><button type="button" data-topic="${action}" data-page="${index - 1}" ${index <= 0 ? 'disabled' : ''}>${arrow('back')}<span>Back</span></button>${index < count - 1 ? `<button type="button" data-topic="${action}" data-page="${index + 1}" class="tv-page-next"><span>${esc(nextLabel)}</span>${arrow('next')}</button>` : ending || '<span class="tv-page-end">End</span>'}</nav>`;
  }
  pending() { return !!(this.solutionWorking || this.t.busy || this.t.thread?.pending); }
  solutionMessageId() {
    if (!this.t.thread?.book_problem || this.pref().problemTab !== 'solution') return undefined;
    return (this.t.thread.book_solution?.steps || []).at(-1)?.message_id;
  }
  solutionPartHTML(part, newest) {
    return `<section class="tv-reading-page tv-part tv-part-solution${newest ? ' is-newest' : ''}${newest && this.revealed === part.key ? ' is-new' : ''}" data-index="${part.index}" data-key="${esc(part.key)}" data-foldable="${part.foldable ? 1 : 0}" tabindex="-1" aria-label="${esc(part.title)}"><span class="tv-step-n" aria-hidden="true">${part.step + 1}</span><div class="tv-page-copy">${notesHTML(part.body || '')}</div></section>`;
  }
  problemHTML(sheet) {
    return this.t.workspace?.helpHTML(this.t.thread?.book_problem) || '<p>No prepared solution yet.</p>';
  }
  sync() {
    const active = this.active(), open = active && !this.isClosed();
    this.button.hidden = !active; this.host.hidden = !open || this.media.matches;
    this.button.setAttribute('aria-expanded', String(open && !this.media.matches));
    const expanded = open && !this.media.matches && !!this.pref().expanded && !this.t.artifact.expanded;
    if (this.expanded !== expanded) {
      this.expanded = expanded; this.t.host.classList.toggle('topic-expanded', expanded);
      if (expanded || !this.t.artifact.expanded) this.t.el.main.inert = expanded;
      if (expanded) this.host.setAttribute('aria-modal', 'true'); else this.host.removeAttribute('aria-modal'); this.host.setAttribute('role', expanded ? 'dialog' : 'complementary');
      if (expanded) requestAnimationFrame(() => this.host.querySelector('[data-topic=expand]')?.focus({preventScroll:true}));
    }
    if (expanded) this.t.el.main.inert = true;
    const expand = this.host.querySelector('[data-topic=expand]'); if (expand) { expand.textContent = expanded ? '↙' : '↗'; expand.setAttribute('aria-label', expanded ? 'Restore study notes size' : 'Expand study notes'); }
    this.grip.hidden = !open || this.media.matches || expanded;
    this.t.host.classList.toggle('topic-open', open && !this.media.matches);
    this.t.host.classList.toggle('has-topic', active); this.t.syncSide(); this.layout();
    if (open && !this.media.matches && !this.wasOpen) this.queueFit();
    this.wasOpen = open && !this.media.matches;
  }
  centerNav(root) {
    // Sections use the existing reading scroll; no horizontal strip to recenter.
  }
  toggle() {
    if (!this.active()) return;
    if (this.media.matches) {
      this.t.dialog('Study notes', `<div class="tv-topic-mobile">${this.content(this.t.thread.topic_companion)}</div>`);
      const mobile = this.t.el.dialog.querySelector('.tv-topic-mobile');
      mobile.addEventListener('click', e => this.click(e));
      mobile.addEventListener('change', e => this.change(e));
      mobile.addEventListener('toggle', e => this.toggled(e), true);
      math(this.t.el.dialog); this.settle(mobile); this.announce(); return;
    }
    this.close(!this.isClosed());
    this.sync(); this.t.artifact.onResize?.(); this.announce();
  }
  refreshFromAction(mobile, focus = 'heading') {
    this.savePref(); this.render();
    const root = mobile || this.host;
    if (mobile) { mobile.innerHTML = this.content(this.t.thread.topic_companion); math(mobile); this.settle(mobile); }
    this.revealed = null;
    if (focus === 'next') { root.querySelector('.tv-page-nav .tv-page-next')?.focus({ preventScroll: true }); return; }
    const heading = root.querySelector('.tv-topic-article h3') || root.querySelector('.tv-reading-page');
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    const scroll = root.querySelector('.tv-topic-body'); if (scroll && !root.querySelector('.tv-flow')) scroll.scrollTop = 0;
  }
  change(e) { /* no selects remain in the lesson flow; kept for the mobile dialog binding */ }
  solutionAction(next) { return this.t.workspace?.reveal('step'); }
  click(e) {
    const b = e.target.closest('[data-topic]'); if (!b) return;
    if (b.dataset.topic === 'close') { this.close(true); this.sync(); this.button.focus(); }
    else if (b.dataset.topic === 'expand') this.expand(!this.expanded);
    else if (b.dataset.topic === 'solution-retry') { this.solutionError = ''; this.t.retry(); }
    else if (b.dataset.topic === 'solution-start' || b.dataset.topic === 'solution-next') this.solutionAction(b.dataset.topic === 'solution-next');
    else if (b.dataset.topic === 'reveal') this.reveal(b.dataset.count, b.closest('.tv-topic-mobile'));
    else if (['select','idea-page','problem-tab','related','problem-home'].includes(b.dataset.topic)) {
      const mobile = b.closest('.tv-topic-mobile');
      if (b.dataset.topic === 'select') { this.selected.set(this.t.thread.id, b.dataset.section); this.pref().section = b.dataset.section; b.closest('.tv-section-picker')?.removeAttribute('open'); }
      else if (b.dataset.topic === 'problem-tab') this.pref().problemTab = b.dataset.tab;
      else if (b.dataset.topic === 'related' || b.dataset.topic === 'problem-home') this.pref().related = b.dataset.topic === 'related';
      else {
        const s = this.selection(this.t.thread.topic_companion), view = this.lessonView(s);
        view.idea = Math.max(0, Number(b.dataset.page) || 0);
        (this.pref().views ||= {})[s.id] = { ...this.pref().views?.[s.id], idea: view.idea };
      }
      this.refreshFromAction(mobile);
    }
  }
}
