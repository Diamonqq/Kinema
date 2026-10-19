import { esc } from './md.js';
import {PLOT_THEME,plotColor} from './study.js';

const finite = Number.isFinite;

/* The same safe expression parser and parameter defaults as the editable viewer.
   A failed expression gets an honest fallback, never a decorative invented curve. */
export function graphThumbnail(plot, compile = globalThis.Kinema2D?.compileExpr) {
  if (!plot || !compile || !finite(plot.x_min) || !finite(plot.x_max) || plot.x_max <= plot.x_min) return null;
  try {
    const env = Object.fromEntries((plot.parameters || []).map(p => [p.name, p.value]));
    const rows = (plot.curves || []).slice(0, 24).map(c => {
      const fn = compile(c.expression);
      return { ...c, points: Array.from({ length: 121 }, (_, i) => {
        const x = plot.x_min + (plot.x_max - plot.x_min) * i / 120;
        const y = fn({ ...env, x, t: 0 }); return [x, finite(y) ? y : null];
      }) };
    });
    const values = rows.flatMap(c => c.points.map(p => p[1]).filter(finite)).sort((a,b) => a-b);
    if (!values.length) return null;
    const lo = values[Math.floor((values.length-1)*.005)], hi = values[Math.floor((values.length-1)*.995)];
    const pad = Math.max((hi-lo)*.12, Math.abs(hi)*.04, 1e-6);
    const ymin = finite(plot.y_min) ? plot.y_min : lo-pad, ymax = finite(plot.y_max) ? plot.y_max : hi+pad;
    if (!(ymax > ymin)) return null;
    const X = x => 30 + (x-plot.x_min)/(plot.x_max-plot.x_min)*270;
    const Y = y => 166-(y-ymin)/(ymax-ymin)*144;
    const paths = rows.map((c,i) => {
      let pen = false;
      const d = c.points.map(([x,y]) => { if (y === null || y < ymin || y > ymax) { pen = false; return ''; }
        const part = `${pen ? 'L' : 'M'}${X(x).toFixed(2)},${Y(y).toFixed(2)}`; pen = true; return part;
      }).join(' ');
      return `<path data-curve="${esc(c.id || i)}" d="${d}" fill="none" stroke="${plotColor(c.color,i)}" stroke-width="2.2" stroke-linejoin="round"/>`;
    }).join('');
    return `<svg viewBox="0 0 320 200" role="img" aria-label="${esc((plot.y_label || 'y') + ' versus ' + (plot.x_label || 'x'))}">
      <rect width="320" height="200" fill="${PLOT_THEME.background}"/><path d="M30 22V166H300M30 58H300M30 94H300M30 130H300M97.5 22V166M165 22V166M232.5 22V166" fill="none" stroke="${PLOT_THEME.grid}"/>
      <path d="M30 ${Math.max(22,Math.min(166,Y(0))).toFixed(2)}H300M${Math.max(30,Math.min(300,X(0))).toFixed(2)} 22V166" fill="none" stroke="${PLOT_THEME.axis}" stroke-width="1"/>
      ${paths}<text x="30" y="14" fill="${PLOT_THEME.text}" font-size="10">${esc(plot.y_label || 'y')}</text><text x="300" y="187" text-anchor="end" fill="${PLOT_THEME.text}" font-size="10">${esc(plot.x_label || 'x')}</text></svg>`;
  } catch { return null; }
}

const parameters = plot => (plot?.parameters || []).map(p => p.label || p.name).join(', ');
const fallback = message => `<span class="lg-fallback">${esc(message)}</span>`;

export async function mountLibraryGraphs(box, teacher) {
  if (!document.querySelector('link[data-library-style]')) {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.dataset.libraryStyle = '1';
    css.href = new URL('../visual_library.css', import.meta.url).href; document.head.append(css);
  }
  const token = teacher.grSeq = (teacher.grSeq || 0) + 1;
  const live = () => token === teacher.grSeq && box.isConnected;
  box.innerHTML = '<p class="mt-empty" role="status">Loading graphs…</p>';
  const get = path => teacher.d.api(teacher.d.url(path));
  const [mine, lib] = await Promise.all([
    get('/api/teacher/graphs?course_id=' + encodeURIComponent(teacher.courseId || '')).catch(e => ({ error:e.message })),
    get('/api/visual-library').catch(e => ({ error:e.message })),
  ]);
  if (!live()) return;
  const saved = mine.graphs || [], prepared = (lib.recipes || []).filter(r => r.kind === 'plot');
  const card = (r, saved) => `<button type="button" class="lg-card${!saved && teacher.grShown === r.id ? ' on' : ''}" data-act="${saved ? 'gr-chat' : 'gr-preview'}" ${saved ? `data-thread="${esc(r.thread_id)}"` : `data-id="${esc(r.id)}" aria-pressed="${teacher.grShown === r.id}"`}>
    <span class="lg-preview" data-graph-thumb>${fallback('Loading curve…')}</span><b>${esc(r.title)}</b>
    <p>${esc(saved ? [r.chat, r.axes?.filter(Boolean).join(' vs ')].filter(Boolean).join(' · ') : r.purpose || r.description)}</p>
    <small data-graph-parameters>${saved ? 'Open chat to edit this graph' : 'Open graph to adjust its values'}</small></button>`;
  const empty = (error, text) => `<p class="mt-empty" ${error ? 'role="alert"' : ''}>${esc(error || text)}</p>`;
  box.innerHTML = `<p class="mt-sub">Compare the curves, then open a graph to change its parameters, pan or zoom.</p>
    <h3 class="mt-h">From your chats</h3>${saved.length ? `<div class="lg-grid">${saved.map(r => card(r,true)).join('')}</div>` : empty(mine.error && 'Could not load your graphs: ' + mine.error, 'Graphs you make in a tutor chat appear here.')}
    <h3 class="mt-h">Concept graphs</h3>${prepared.length ? `<div class="lg-grid">${prepared.map(r => card(r,false)).join('')}</div>` : empty(lib.error && 'Could not load the graph library: ' + lib.error, 'No prepared graphs in this build.')}
    ${mine.error || lib.error ? '<button type="button" class="lg-retry">Try again</button>' : ''}`;
  box.querySelector('.lg-retry')?.addEventListener('click', () => mountLibraryGraphs(box,teacher));
  // Four bounded concurrent reads. A superseded mount may finish I/O but never paints over a newer list.
  const queue = [...box.querySelectorAll('.lg-card')];
  await Promise.all(Array.from({length:Math.min(4,queue.length)}, async () => {
    while (queue.length && live()) {
      const node = queue.shift();
      try {
        const payload = await get(node.dataset.thread ? '/api/visual-library/graphs/' + encodeURIComponent(node.dataset.thread) : '/api/visual-library/recipes/' + encodeURIComponent(node.dataset.id));
        if (!live() || !node.isConnected) return;
        const plot = payload.plot || payload.lesson?.visualization?.plot;
        const svg = graphThumbnail(plot);
        node.querySelector('[data-graph-thumb]').innerHTML = svg || fallback('Curve preview unavailable · open graph');
        const controls = parameters(plot);
        node.querySelector('[data-graph-parameters]').textContent = controls ? 'Adjust: ' + controls : 'Pan and zoom this graph';
      } catch {
        if (live() && node.isConnected) node.querySelector('[data-graph-thumb]').innerHTML = fallback('Preview could not load · open to retry');
      }
    }
  }));
}
