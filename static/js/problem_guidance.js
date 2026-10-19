// Question help stays in the normal chat header. Only reviewed exact entries display static physics.
// The reference is the problem's own method and relations. Its open reference is included in the visible tutor context; it never
// opens by itself: only the pill (or Escape/outside/close/navigation) changes it. The open state lives in the workspace
// view so each problem keeps its own choice, and the composer draft is never touched.
import { esc, mdlite, math } from './md.js';

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 3H9c0-1 0-2-1-3Z"/></svg>';
const PANEL_ID = 'pg-panel';

// The same canonical question/revision must own every displayed relation.
export function validatedGuidance(problem) {
  const g = problem?.guidance, source = g?.source;
  if (!g || !source || source.question_id !== problem.id || source.content_sha256 !== problem.source_revision
      || source.policy_revision !== 'exact-question-150-1'
      || !['authored_exact','statement_only'].includes(source.classification)
      || typeof g.method_md !== 'string' || typeof g.relations_md !== 'string'
      || (source.classification === 'authored_exact' && !g.method_md.trim())
      || (source.classification === 'statement_only' && (g.method_md || g.relations_md))) return null;
  return g;
}

function ensureStyle() {
  if (document.querySelector('link[href$="/problem_guidance.css"]')) return;
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/problem_guidance.css';
  document.head.append(link);
}

export class ProblemGuidance {
  constructor(t, { onToggle, onHelp }) {
    this.t = t; this.onToggle = onToggle; this.onHelp = onHelp; this.isOpen = false; this.sig = null;
    ensureStyle();
    const head = t.host.querySelector('.tv-head');
    this.pill = document.createElement('button');
    this.pill.type = 'button'; this.pill.className = 'pg-pill'; this.pill.hidden = true;
    this.pill.setAttribute('aria-controls', PANEL_ID); this.pill.setAttribute('aria-expanded', 'false');
    this.pill.innerHTML = `${ICON}<span>Ideas &amp; formulas</span>`;
    this.pill.addEventListener('click', () => {
      const next = !this.isOpen;
      this.onToggle(next);
      if (next) requestAnimationFrame(() => this.panel.focus({ preventScroll: true }));
    });
    this.hint = document.createElement('button'); this.hint.type = 'button';
    this.hint.className = 'pg-hint'; this.hint.hidden = true; this.hint.textContent = 'Hint';
    this.hint.addEventListener('click', () => this.onHelp('hint'));
    const readWrap = head?.querySelector('.tv-readwrap');
    if (head) { head.insertBefore(this.hint, readWrap || null); head.insertBefore(this.pill, readWrap || null); }

    this.panel = document.createElement('section');
    this.panel.id = PANEL_ID; this.panel.className = 'pg-panel'; this.panel.hidden = true; this.panel.tabIndex = -1;
    this.panel.setAttribute('aria-label', 'Ideas and formulas');
    t.host.append(this.panel);
    this.panel.addEventListener('click', e => {
      if (e.target.closest('[data-pg="close"]')) this.close(true);
      if (e.target.closest('[data-pg="ask"]')) { this.close(false); this.onHelp('ideas'); }
    });
    this.panel.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(true); } });
    document.addEventListener('keydown', e => { if (this.isOpen && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(true); } }, true);
    // Outside pointer closes the panel only; the composer and its draft keep their focus and text. A press in the composer
    // (typing, Send) keeps the reference open, because a Send then carries the reference the learner is looking at.
    document.addEventListener('pointerdown', e => { if (this.isOpen && !this.panel.contains(e.target) && !this.pill.contains(e.target) && !e.target.closest?.('.tv-composer')) this.close(false); }, true);
    window.addEventListener('resize', () => { if (this.isOpen) this.place(); });
  }

  close(refocus) {
    if (!this.isOpen) return;
    this.onToggle(false);
    if (refocus) this.pill.focus({ preventScroll: true });
  }

  // Called from the workspace's sync: `problem` is null when no problem is in view or the visit is loading/failed.
  paint(problem, open) {
    const g = validatedGuidance(problem);
    // Workspace sync paints this same problem object before a Send. Clear a
    // rejected legacy/stale payload so it cannot remain in visible tutor context.
    if (problem && !g) problem.guidance = null;
    this.pill.hidden = !g;
    if (this.hint) {
      this.hint.hidden = !problem;
      this.hint.disabled = !!(this.t.busy || this.t.creating || this.t.threadLoading || this.t.thread?.pending || this.t.mic?.active);
    }
    this.isOpen = !!(g && open);
    this.pill.setAttribute('aria-expanded', String(this.isOpen));
    this.panel.hidden = !this.isOpen;
    if (!this.isOpen) { this.sig = null; return; }
    const sig = JSON.stringify([problem.id, problem.source_revision, g]);
    if (sig !== this.sig) {
      this.sig = sig;
      this.panel.innerHTML = `<header><div><h3>A place to start</h3><small>${esc(g.topic)}</small></div><button type="button" class="pg-close" data-pg="close" aria-label="Close ideas and formulas">&times;</button></header>`
        + (g.source.classification === 'statement_only'
          ? '<div class="pg-body"><p>Ask the tutor to pick the useful ideas and explain the symbols for this question, one step at a time.</p><button type="button" class="pg-ask" data-pg="ask">Explain ideas &amp; formulas</button></div>'
          : `<div class="pg-body mdb">${mdlite(g.method_md)}</div>`)
        + (g.relations_md ? `<div class="pg-relations mdb"><span>Relations &amp; assumptions</span>${mdlite(g.relations_md)}</div>` : '');
      math(this.panel);
    }
    const ask = this.panel.querySelector?.('[data-pg="ask"]');
    if (ask) ask.disabled = !!(this.t.busy || this.t.creating || this.t.threadLoading || this.t.thread?.pending || this.t.mic?.active);
    this.place();
  }

  // Under the pill, right-aligned to it, and never wider than the window.
  place() {
    const r = this.pill.getBoundingClientRect();
    const width = Math.min(372, window.innerWidth - 24);
    const left = Math.max(12, Math.min(r.right - width, window.innerWidth - width - 12));
    const top = Math.min(r.bottom + 8, window.innerHeight - 160);
    // Stop above the composer so an outside click can still reach the draft; the panel scrolls within that room.
    const composer = this.t.el.input?.closest('.tv-composer')?.getBoundingClientRect();
    const limit = composer ? composer.top - 12 : window.innerHeight - 150;
    const room = Math.max(120, Math.min(420, limit - top));
    Object.assign(this.panel.style, { width: width + 'px', left: left + 'px', top: top + 'px', maxHeight: room + 'px' });
  }
}
