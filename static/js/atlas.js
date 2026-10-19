/* Kinema 1.0 — the Atlas (home): every skill in Morin and the math it uses, one cell each, coloured by what you have
   actually shown you know. Nothing counts until it is checked (owner, 2026-09-23: "I'm basically a lobotomite on all
   topics till I refresh them"). Sections not yet broken into skills are dashed outlines: a fact about the map, not a
   gap in you. */
import { esc, txt } from './md.js';

export const STATE_LABEL = { not_checked: 'not checked', gap: 'gap', seen: 'seen, not tested', learning: 'learning', confirmed: 'confirmed', mastered: 'mastered' };
const GOOD = new Set(['learning', 'confirmed', 'mastered']);

export function cell(k, extra) {
  const tip = `${k.title} — ${STATE_LABEL[k.state]}${k.route ? ' · needed for class now' : ''}${k.note === 'confirmed' ? ' · note ready' : ''}`;
  return `<i class="c s-${k.state}${k.route ? ' r' : ''}${k.due ? ' due' : ''}${extra || ''}" data-skill="${esc(k.id)}" data-tip="${esc(tip)}"></i>`;
}

export class Atlas {
  constructor(deps) { this.d = deps; }

  /* the study path page: a short "where you are" line and the know / don't-know map, in the tutor's own look */
  async loadMap(box, where) {
    let a;
    try { a = await this.d.api(this.d.url('/api/atlas')); }
    catch (e) { box.innerHTML = '<p class="sp-sub">Could not load your map.</p>'; return null; }
    this.a = a;
    const c = a.counts, next = this.nextOnRoute(a);
    if (where) where.innerHTML = `<div class="pm-where"><div><b>${c.confirmed}</b><span>confirmed</span></div><div><b>${c.gaps}</b><span>to refresh</span></div><div><b>${c.skills}</b><span>skills mapped</span></div></div>`
      + (next.length ? `<p class="sp-sub">Next on your route: ${next.slice(0, 3).map(k => `<button type="button" class="pm-link" data-skill="${esc(k.id)}">${txt(k.title)}</button>`).join(', ')}</p>` : '');
    const cls = a.class_now?.chapter;
    const legend = [['not_checked', 'Not checked'], ['gap', 'Gap'], ['seen', 'Seen'], ['learning', 'Learning'], ['confirmed', 'Confirmed'], ['mastered', 'Mastered']].map(([k, t]) => `<span><i class="c s-${k}"></i>${t}</span>`).join('');
    const tiles = a.chapters.map(ch => {
      const skills = ch.sections.flatMap(s => s.skills);
      const conf = skills.filter(k => k.state === 'confirmed' || k.state === 'mastered').length;
      const cnt = !ch.sections.some(s => s.mapped) ? 'not mapped in detail yet' : `${skills.length} skills · ${conf ? conf + ' confirmed' : 'none confirmed'}`;
      const rows = ch.sections.filter(s => s.mapped).map(s => `<div class="secrow"><span class="sn">${ch.n === 'M' ? '' : esc(s.id)}</span><div class="cells">${s.skills.map(k => cell(k)).join('')}</div></div>`).join('');
      return `<div class="tile${ch.n === cls ? ' cls' : ''}"><div class="th"><span class="n">${ch.n === 'M' ? '\u2211' : ch.n}</span><span>${txt(ch.title)}</span>${ch.n === cls ? '<span class="badge2">class now</span>' : ''}</div><div class="cnt num">${cnt}</div>${rows}</div>`;
    }).join('');
    box.innerHTML = `<div class="legend">${legend}</div><div class="pm-tiles">${tiles}</div>`;
    for (const el of [box, where]) el?.querySelectorAll('[data-skill]').forEach(x => x.addEventListener('click', () => this.d.openSkill(x.dataset.skill)));
    return a;
  }

  nextOnRoute(a) {
    const all = a.chapters.flatMap(ch => ch.sections.flatMap(s => s.skills)).filter(k => k.route);
    const gaps = all.filter(k => k.state === 'gap');
    const open = all.filter(k => k.state === 'not_checked' || k.state === 'seen');
    return [...gaps, ...open].slice(0, 5);
  }

}

/* one tooltip for every [data-tip] element */
export function installTips() {
  const tip = document.querySelector('#tip');
  document.addEventListener('mouseover', e => {
    const t = e.target.closest?.('[data-tip]');
    if (!t) { tip.style.display = 'none'; return; }
    tip.textContent = t.dataset.tip; tip.style.display = 'block';
    const r = t.getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min(innerWidth - 290, r.left)) + 'px'; tip.style.top = (r.bottom + 6) + 'px';
  });
  document.addEventListener('scroll', () => { tip.style.display = 'none'; }, true);
  document.addEventListener('pointerdown', () => { tip.style.display = 'none'; }, true);
}
