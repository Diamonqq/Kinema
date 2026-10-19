import { esc, txt } from './md.js';

export function openCourseBrowser({ title, ladder, modules, current, plan, onChoose }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'kinema-dialog course-dialog';
  let group = Math.max(0, modules.findIndex(m => m.problems.includes(current))), page = 0;
  dialog.innerHTML = `<header><div><small>Your course</small><h2>${txt(title)}</h2></div><button type="button" data-close aria-label="Close problems">×</button></header>
    <p class="course-approach">${esc(plan?.approach || 'Follow a worked example, then try a similar problem. Each section builds on the last.')}</p>
    <label class="course-search"><span class="sr-only">Find a problem</span><input type="search" placeholder="Find a problem…" autocomplete="off"></label>
    <div class="course-grid"><nav class="course-modules" aria-label="Course sections"></nav><div class="course-problems"><label class="course-mobile-section">Section<select aria-label="Course section">${modules.map((m,i) => `<option value="${i}">${i+1}. ${esc(m.title)}</option>`).join('')}</select></label><div class="course-results"></div><div class="course-pages"></div></div></div>`;
  document.body.append(dialog);
  const search = dialog.querySelector('input'), select = dialog.querySelector('select');
  function render() {
    const q = search.value.trim().toLowerCase(), mod = modules[group];
    const hits = ladder.filter(r => q ? `${r.n} ${r.title} ${r.level}`.toLowerCase().includes(q) : mod.problems.includes(r.n));
    const count = Math.max(1, Math.ceil(hits.length / 5)); page = Math.min(page, count - 1);
    dialog.querySelector('.course-modules').innerHTML = modules.map((m,i) => `<button type="button" data-group="${i}" ${!q && i === group ? 'aria-current="true"' : ''}><span>${i+1}</span><span>${txt(m.title)}<small>Problems ${m.problems[0]}–${m.problems.at(-1)}</small></span></button>`).join('');
    dialog.querySelectorAll('[data-group]').forEach(b => b.onclick = () => { group = +b.dataset.group; page = 0; search.value = ''; render(); });
    select.value = group;
    dialog.querySelector('.course-results').innerHTML = hits.slice(page*5, page*5+5).map(r => `<button type="button" data-problem="${r.n}" ${r.n === current ? 'aria-current="true"' : ''}><span class="problem-number">${String(r.n).padStart(2,'0')}</span><span><b>${txt(r.title)}</b><small>${r.n === current ? 'Current problem' : r.outcome && !['correct','correct_hint'].includes(r.outcome) ? 'Ready to revisit' : r.done ? 'Previously practised' : 'Worked example + your turn'}</small></span><span aria-hidden="true">${r.n === current ? '→' : r.done ? '✓' : ''}</span></button>`).join('') || '<p class="course-empty">No matching problem. Try a topic or number.</p>';
    dialog.querySelectorAll('[data-problem]').forEach(b => b.onclick = () => { dialog.close(); onChoose(+b.dataset.problem); });
    dialog.querySelector('.course-pages').innerHTML = count > 1 ? `<button type="button" data-page="-1" ${page === 0 ? 'disabled' : ''}>Previous</button><span>${page+1} / ${count}</span><button type="button" data-page="1" ${page+1 === count ? 'disabled' : ''}>Next</button>` : `<span>${hits.length} problem${hits.length === 1 ? '' : 's'}</span>`;
    dialog.querySelectorAll('[data-page]').forEach(b => b.onclick = () => { page += +b.dataset.page; render(); });
  }
  search.oninput = () => { page = 0; render(); };
  select.onchange = () => { group = +select.value; page = 0; search.value = ''; render(); };
  dialog.querySelector('[data-close]').onclick = () => dialog.close();
  dialog.addEventListener('close', () => dialog.remove());
  render(); dialog.showModal(); dialog.querySelector('.course-results [aria-current]')?.focus();
  return dialog;
}
