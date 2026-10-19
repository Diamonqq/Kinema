import { esc } from './md.js';
/* Kinema Library — the Library's Visuals grid (Library → Visuals; teacher.js mounts it in #libvisuals).
   One grid of prepared setups (GET /api/visual-library, planar and 3D) and prepared Daily scenes (GET /api/daily/visuals),
   with search, a chapter filter and an honest Moving / Still badge. Graphs belong to Library → Graphs,
   which previews them through act('preview', id); props stay loadable through act('prop', id) but are not browsed here.
   Opening is instant: a card's descriptor and modules are fetched on hover or focus and kept, its thumbnail covers the
   stage at once and stays until the stage has drawn the live setup. The shared stage is the only renderer (a Daily
   scene mounts one viewer in the pane and the pane disposes it on the next open); nothing is warmed off screen.

   API (teacher.js / lane A):
     new VisualLibrary(host, {api, url, stage, artifact, study(recipe) → Promise, close?(), onPreview?()})
     load(force = false)  fetch the catalog once (force: again) and draw the grid; keeps search, chapter and scroll
     act(what, id, button) what: 'preview' (a setup or graph), 'scene' (a Daily scene), 'prop', 'study', 'goto'
     prefetch(key)        warm a card ('setups:<id>' or 'scenes:<problem id>'); hover and focus already do this
     cancel()             drop any preview still loading (closing or leaving the Library)
     data / error / previewed / msg  as before */

const STATUS = {
  simulated: ['Simulated', 'The app computes this motion'],
  prescribed: ['Prescribed motion', 'Motion is set by the setup, not computed'],
  illustration: ['Diagram', 'Static geometry; inspect its views and parameters'],
};
const S = (body) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
/* small outline glyphs chosen from a card's ids; shown when its thumbnail is missing */
const GLYPHS = [
  [/graph|diagram|plot/, S('<path d="M4 3v17h17"/><path d="M6 16c3-9 6-9 9-3s3 2 5-2"/>')],
  [/gyro|top|spin/, S('<circle cx="12" cy="13" r="6"/><path d="M12 3v20M6 13h12"/>')],
  [/pulley|spool|atwood/, S('<circle cx="12" cy="7" r="4"/><path d="M8 7v11M16 7v6"/><rect x="5.5" y="17" width="5" height="4"/><rect x="13.5" y="13" width="5" height="4"/>')],
  [/wheel|disk|disc|ring|cylinder|tube|roll|turntable/, S('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="1.5"/><path d="M12 4v6"/>')],
  [/ramp|wedge|incline/, S('<path d="M3 19h18L3 8z"/><rect x="8" y="9.5" width="4" height="4" transform="rotate(31 10 11.5)"/>')],
  [/spring|oscillat/, S('<path d="M3 12h3l2-5 3 10 3-10 3 10 2-5h2"/>')],
  [/pendulum|swing|ladder/, S('<path d="M6 3h12M12 3l4 13"/><circle cx="16.5" cy="17.5" r="2.5"/>')],
  [/planet|orbit|satellite|kepler|gravit/, S('<circle cx="12" cy="12" r="3"/><ellipse cx="12" cy="12" rx="9" ry="5"/>')],
  [/rod|beam|stick|bar/, S('<path d="M4 18 20 6"/><circle cx="4" cy="18" r="1.6"/>')],
  [/projectile|ball|sphere|shell|point/, S('<path d="M3 19c4-12 12-12 18 0" stroke-dasharray="2 2.4"/><circle cx="12" cy="10" r="2.4"/>')],
  [/cart|train|car|elevator|block|box/, S('<rect x="4" y="7" width="16" height="9" rx="1.5"/><circle cx="8" cy="18" r="1.6"/><circle cx="16" cy="18" r="1.6"/>')],
  [/collision|impulse|momentum/, S('<circle cx="7" cy="12" r="3"/><circle cx="17" cy="12" r="3"/><path d="M10.5 12h3"/>')],
];
const BLOCK = S('<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>');
const glyph = (...ids) => { const s = ids.flat().filter(Boolean).join(' ').toLowerCase(); return (GLYPHS.find(([re]) => re.test(s)) || [0, BLOCK])[1]; };
const chapters = list => (list || []).length ? 'Ch ' + [...new Set(list)].sort((a, b) => a - b).join(', ') : '';
const refText = r => [r.kind === 'text' ? 'Text' : (r.kind === 'exercise' ? 'Exercise ' : 'Problem ') + (r.problem ?? ''), r.page != null ? 'p. ' + r.page : '', r.label || ''].filter(Boolean).join(' · ');
const GRAPH_KINDS = new Set(['plot']);   // Library → Graphs shows these
const SCENE_PURPOSE = {
  '5.23': 'Compare the heights reached when a light ball rebounds from a heavier ball.',
  '3.1': 'Relate the acceleration of two hanging masses to their shared string tension.',
  '8.1': 'Connect pulley rotation to the unequal tensions on the two hanging masses.',
  '2.14': 'Explore the right-angle contact geometry of two hinged sticks.',
  '2.15': 'Locate the ladder pivots and the perpendicular support before balancing torques.',
  '2.17': 'Change the pull angle and compare the thread line with the spool contact point.',
  '3.22': 'Follow how a wrapping string changes the radius and direction of a circling mass.',
  '5.20': 'Compare a bouncing ball with the recoil of the block it hits.',
  '6.11': 'Compare gravity with the effect of hoop rotation on a sliding bead.',
  '6.14': 'See how a swinging pendulum moves its free support along the rail.',
  '9.3': 'Identify the contact line and angular velocity of a rolling cone.',
  '9.13': 'Explore the geometry and precession of a ring rolling inside a cone.'
};

const split = key => [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];

/* Moving or Still, as the catalog states it: an illustration, or a setup whose motion reads "none: …", is still; a setup
   the stage loaded without motion is still from then on. The badge's title says whether the app computes the motion. */
function badge(x, still) {
  if (x.problem_id) return x.has_dynamics ? ['moving', 'Moving', 'Play the motion in this scene'] : ['still', 'Still', 'The setup only, no motion'];
  if (still || x.physics_status === 'illustration' || /^none:/.test(x.motion || '')) return ['still', 'Still', 'Nothing moves in this setup'];
  return ['moving', 'Moving', STATUS[x.physics_status]?.[1] || ''];
}



export class VisualLibrary {
  constructor(host, d) {
    this.host = host; this.d = d; this.q = ''; this.chapter = ''; this.group = ''; this.data = null;
    this.cache = new Map();      // 'setups:<id>' / 'scenes:<id>' → Promise of the descriptor, kept for this catalog version
    this.stills = new Set();     // setups the stage loaded without motion
    if (!document.querySelector('link[data-library-style]')) { const css = document.createElement('link'); css.rel = 'stylesheet'; css.dataset.libraryStyle = '1'; css.href = new URL('../visual_library.css', import.meta.url).href; document.head.append(css); }
    host.innerHTML = `<div class="vl">
      <div class="vl-top">
        <input class="vl-search" type="search" placeholder="Search visuals, chapters, problem numbers" aria-label="Search visuals">
        <div class="vl-bar"><select data-f="chapter" aria-label="Chapter"><option value="">All chapters</option></select>
          <button type="button" class="vl-filter" data-group="" aria-pressed="true">All visuals</button><button type="button" class="vl-filter" data-group="problems" aria-pressed="false">Problem setups</button><button type="button" class="vl-filter" data-group="concepts" aria-pressed="false">Concept demos</button><span class="vl-count" role="status"></span></div>
        <p class="vl-msg vl-note" hidden></p>
      </div>
      <div class="vl-list"></div></div>`;
    const $ = s => host.querySelector(s);
    this.el = { search: $('.vl-search'), list: $('.vl-list'), count: $('.vl-count'), chapter: $('[data-f=chapter]'), note: $('.vl-note') };
    this.el.search.addEventListener('input', () => { this.q = this.el.search.value.trim().toLowerCase(); this.render(); });
    this.el.chapter.addEventListener('change', () => { this.chapter = this.el.chapter.value; this.render(); });
    host.addEventListener('error', e => { const i = e.target; if (i.matches?.('img[data-fb]')) { i.replaceWith(Object.assign(document.createElement('span'), { innerHTML: glyph(i.closest('.vl-card')?.dataset.view) })); } }, true);
    // warm a card the moment the pointer or focus reaches it: its descriptor, its modules and its full-size thumbnail
    const warm = e => { const v = e.target.closest?.('[data-view]'); if (v) this.prefetch(v.dataset.view); };
    host.addEventListener('pointerover', warm); host.addEventListener('focusin', warm);
    host.addEventListener('click', e => {
      const filter = e.target.closest('[data-group]'); if (filter) { this.group = filter.dataset.group; host.querySelectorAll('[data-group]').forEach(b => b.setAttribute('aria-pressed', String(b === filter))); return this.render(); }
      if (e.target.closest('[data-library-chapter]')) { this.host.querySelector('.vl-pop')?.close(); this.host.closest('.teacher')?.querySelector('[data-act=path]')?.click(); }
      const ci = e.target.closest('[data-card-info]'); if (ci) return this.pop(ci.dataset.cardInfo);
      const v = e.target.closest('[data-view]'); if (v) { const [kind, id] = split(v.dataset.view); return this.act(kind === 'scenes' ? 'scene' : 'preview', id, v); }
      const a = e.target.closest('[data-do]'); if (a) return this.act(a.dataset.do, a.dataset.id, a);
      if (e.target.closest('[data-retry]')) return this.load(true);
    });
  }
  async load(force = false) {
    if (this.data && !force) return this.render(true);   // back to the grid: same search, chapter and scroll
    this.cancel();
    const catalogToken = this.catalogToken = (this.catalogToken || 0) + 1;
    this.data = null; this.error = null; this.cache.clear();
    this.el.list.innerHTML = '<p class="vl-empty" role="status">Loading the library…</p>'; this.el.count.textContent = '';
    const [lib, daily] = await Promise.allSettled([this.d.api(this.d.url('/api/visual-library')), this.d.api(this.d.url('/api/daily/visuals'))]);
    if (catalogToken !== this.catalogToken) return;
    if (lib.status === 'rejected') {
      const e = lib.reason || {};
      this.error = e.status === 404 ? 'The visual library is not available in this build of Kinema.' : 'Could not load the visual library: ' + (e.message || 'no answer');
      this.el.list.innerHTML = `<div class="vl-empty" role="alert"><p>${esc(this.error)}</p><p><button type="button" class="vl-btn" data-retry>Try again</button></p></div>`;
      return;
    }
    const r = lib.value, scenes = daily.status === 'fulfilled' ? daily.value.scenes || [] : [];   // an older or scene-less build just has no scenes
    this.data = { props: r.props || [], families: r.families || [], recipes: r.recipes || [], scenes, coverage: r.coverage || null, version: r.version };
    const ch = new Set(); for (const x of this.sims()) for (const c of x.chapters || []) ch.add(c);
    for (const x of scenes) if (x.chapter != null) ch.add(x.chapter);
    if (this.chapter && !ch.has(+this.chapter)) this.chapter = '';
    this.el.chapter.innerHTML = '<option value="">All chapters</option>' + [...ch].sort((a, b) => a - b).map(c => `<option value="${esc(c)}">Chapter ${esc(c)}</option>`).join('');
    this.el.chapter.value = this.chapter;
    this.render();
  }
  /* the setups this grid shows: planar and 3D simulations; graphs and diagrams live in Library → Graphs */
  sims() { return (this.data?.recipes || []).filter(r => !GRAPH_KINDS.has(r.kind)); }
  rows() {
    const D = this.data, q = this.q, ch = this.chapter ? +this.chapter : null;
    const text = x => [x.id, x.title, x.description, x.category, x.motion, ...(x.prop_ids || []), ...(x.chapters || []).map(c => 'ch' + c + ' chapter ' + c),
      ...(x.source_refs || []).map(r => `${r.problem ?? ''} ${r.label ?? ''} p${r.page ?? ''}`)].join(' ').toLowerCase();
    const match = x => !q || q.split(/\s+/).every(w => text(x).includes(w));
    const setups = this.sims().filter(r => match(r) && (ch == null || (r.chapters || []).includes(ch))).map(x => ({ key: 'setups:' + x.id, x, ch: Math.min(...(x.chapters?.length ? x.chapters : [99])) }));
    const scenes = D.scenes.filter(x => match({ id: x.problem_id, title: x.title, chapters: [x.chapter], description: (x.figures || []).join(' '), source_refs: [{ problem: x.problem_id }] }) && (ch == null || x.chapter === ch))
      .map(x => ({ key: 'scenes:' + x.problem_id, x, ch: x.chapter ?? 99 }));
    return [...setups, ...scenes].filter(r => !this.group || (this.group === 'problems' ? r.key.startsWith('scenes:') : r.key.startsWith('setups:'))).sort((a, b) => a.ch - b.ch);   // by chapter; within one, the prepared setups first, then the book's scenes
  }
  render(keepScroll = false) {
    if (!this.data) return;
    const top = this.el.list.scrollTop, rows = this.rows();
    this.el.count.textContent = rows.length + (rows.length === 1 ? ' visual' : ' visuals');
    const total = this.sims().length + this.data.scenes.length;
    this.el.list.innerHTML = rows.length ? `<div class="vl-grid">${rows.map(r => this.cardHTML(r)).join('')}</div>`
      : `<p class="vl-empty">${total ? 'Nothing matches. Clear the search or the chapter.' : 'No prepared visuals in this build yet.'}</p>`;
    if (keepScroll) this.el.list.scrollTop = top;
  }
  thumb(key) { const [kind, id] = split(key); return this.d.url(kind === 'scenes' ? '/daily-vthumbs/' + id + '.webp' : kind === 'props' ? '/vthumbs/prop-' + id + '.webp' : '/vthumbs/setup-' + id + '.webp'); }
  cardHTML({ key, x }) {
    const scene = key.startsWith('scenes:'), id = scene ? x.problem_id : x.id, on = this.previewed === id;
    const [cls, word, tip] = badge(x, this.stills.has(id));
    const sub = scene ? ['Problem ' + x.problem_id, chapters([x.chapter])].filter(Boolean).join(' · ') : chapters(x.chapters);
    const title = scene ? x.title : x.title || x.id;
    return `<div class="vl-cell"><button type="button" class="vl-card${on ? ' on' : ''}" data-view="${esc(key)}" aria-pressed="${on}"><span class="im"><img loading="lazy" decoding="async" src="${esc(this.thumb(key))}" alt="" data-fb></span><b>${esc(title)}</b><span class="vl-purpose">${esc(x.purpose || x.description || SCENE_PURPOSE[id] || (scene ? "Explore the geometry and directions for Morin " + x.problem_id + "." : ""))}</span><small><span class="vl-badge ${cls}" title="${esc(tip)}">${word}</span><span>${esc(sub)}</span></small></button><button type="button" class="vl-ci" data-card-info="${esc(key)}" aria-label="Details: ${esc(title)}" title="Details">i</button></div>`;
  }
  detailHTML(x) {
    const refs = (x.source_refs || []).length ? `<ul class="vl-refs">${x.source_refs.slice(0, 8).map(r => `<li>${esc(refText(r))}</li>`).join('')}${x.source_refs.length > 8 ? `<li>and ${x.source_refs.length - 8} more</li>` : ''}</ul>` : '';
    const dl = rows => { const r = rows.filter(([, v]) => v); return r.length ? `<dl>${r.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''; };
    const st = /^none:/.test(x.motion || '') ? ['Static setup', 'Static geometry; inspect its views and force directions'] : STATUS[x.physics_status];
    return `<div class="vl-detail">${x.purpose || x.description ? `<p>${esc(x.purpose || x.description)}</p>` : ''}
      ${dl([['Motion', x.motion], ['Frame', x.coordinate_frame], ['Status', st ? st[1] : x.physics_status], ['Exam', x.in_exam_scope ? 'In the current exam scope' : '']])}${refs}<div class="vl-context">${(x.chapters || []).map(c => `<button type="button" data-library-chapter data-act="pp-open" data-n="${esc(c)}" data-shut-after>Chapter ${esc(c)} lessons &amp; problems</button>`).join('')}</div></div>`;
  }
  dialog() {
    let dlg = this.host.querySelector('.vl-pop');
    if (!dlg) { dlg = document.createElement('dialog'); dlg.className = 'vl-pop'; this.host.appendChild(dlg); dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); }); }
    return dlg;
  }
  /* the info button: the picture and the facts, with Study and Open */
  pop(key) {
    const [kind, id] = split(key);
    if (kind === 'scenes') return this.popScene(id);
    const x = this.data.recipes.find(r => r.id === id); if (!x) return;
    const dlg = this.dialog();
    dlg.innerHTML = `<header><h2>${esc(x.title || x.id)}</h2><button type="button" class="vl-ib" data-info aria-pressed="true" aria-label="Details" title="Details">i</button><button type="button" class="vl-x" data-shut aria-label="Close">×</button></header>
      <div class="vl-big"><img src="${esc(this.thumb(key))}" alt="${esc(x.title || x.id)}"></div>
      <div class="vl-info">${this.detailHTML(x)}</div>
      <div class="vl-acts"><button type="button" class="vl-btn primary" data-do="preview" data-id="${esc(id)}" data-shut-after>Open visual</button></div>`;
    dlg.querySelector('[data-shut]').onclick = () => dlg.close();
    const ib = dlg.querySelector('[data-info]'); ib.onclick = () => { const w = dlg.querySelector('.vl-info'); w.hidden = !w.hidden; ib.setAttribute('aria-pressed', String(!w.hidden)); };
    dlg.querySelectorAll('[data-shut-after]').forEach(b => b.addEventListener('click', () => dlg.close()));
    if (!dlg.open) dlg.showModal();
    dlg.querySelector('[data-shut]').focus({ preventScroll: true });
  }
  popScene(id) {
    const x = this.data.scenes.find(r => r.problem_id === id); if (!x) return;
    const dlg = this.dialog();
    dlg.innerHTML = `<header><h2>${esc(x.title)}</h2><button type="button" class="vl-x" data-shut aria-label="Close">×</button></header>
      <div class="vl-big"><img src="${esc(this.thumb('scenes:' + id))}" alt="${esc(x.title)}"></div>
      <div class="vl-detail"><p>${esc(SCENE_PURPOSE[id] || "Explore the problem geometry.")}</p><dl><dt>Problem</dt><dd>Morin ${esc(x.problem_id)}</dd><dt>Where</dt><dd>${esc([x.chapter != null ? 'Chapter ' + x.chapter : '', x.section ? 'section ' + x.section : ''].filter(Boolean).join(', '))}</dd>${(x.figures || []).length ? `<dt>Figures</dt><dd>${esc(x.figures.join(', '))}</dd>` : ''}</dl>
      <p class="vl-msg">${x.has_dynamics ? 'Play the motion here; the worked answer notes and marks appear once you open that problem’s solution in Daily.' : 'This scene is the setup only.'}</p></div>
      <div class="vl-acts"><button type="button" class="vl-btn" data-book="open" data-id="${esc(id)}" data-shut-after>Read problem ${esc(id)}</button><button type="button" class="vl-btn primary" data-do="scene" data-id="${esc(id)}" data-shut-after>Open 3D scene</button></div>`;
    dlg.querySelector('[data-shut]').onclick = () => dlg.close();
    dlg.querySelectorAll('[data-shut-after]').forEach(b => b.addEventListener('click', () => dlg.close()));
    if (!dlg.open) dlg.showModal();
    dlg.querySelector('[data-shut]').focus({ preventScroll: true });
  }
  say(id, text, err = false) {
    this.msg = { id, text, err }; this.note();
    const dlg = this.host.querySelector('.vl-pop[open]'); if (!dlg) return;
    let m = dlg.querySelector('.pop-msg'); if (!m) { m = document.createElement('p'); m.className = 'vl-msg pop-msg'; m.style.padding = '0 20px'; dlg.querySelector('.vl-acts').before(m); }
    m.className = 'vl-msg pop-msg' + (err ? ' err' : ''); m.setAttribute('role', err ? 'alert' : 'status'); m.textContent = text;
  }
  /* the previewed card's outline, without redrawing the grid (its pictures stay decoded) */
  mark() {
    this.el.list.querySelectorAll('.vl-card').forEach(c => { const on = split(c.dataset.view)[1] === this.previewed; c.classList.toggle('on', on); c.setAttribute('aria-pressed', String(on)); });
  }
  /* the line under the filters: only a failure stays there (loading shows in the pane itself) */
  note() {
    const m = this.msg, n = this.el.note; n.hidden = !m?.err;
    if (m?.err) { n.className = 'vl-msg vl-note err'; n.setAttribute('role', 'alert'); n.textContent = m.text; }
  }
  /* a card's descriptor (one request per card per catalog version; a failed one is retried next time), its viewer module
     and its thumbnail at full size, so a click starts from memory */
  prefetch(key) {
    if (!this.data || !key) return null;
    const [kind, id] = split(key);
    let p = this.cache.get(key);
    if (!p) {
      const url = kind === 'scenes' ? '/api/daily/visuals/' : kind === 'setups' ? '/api/visual-library/recipes/' : null;
      if (!url) return null;
      p = this.d.api(this.d.url(url + encodeURIComponent(id)));
      p.catch(() => { if (this.cache.get(key) === p) this.cache.delete(key); });
      this.cache.set(key, p);
      if (kind === 'scenes') import('./daily_visuals.js').catch(() => { });
      const im = new Image(); im.decoding = 'async'; im.src = this.thumb(key);
    }
    return p;
  }
  async act(what, id, button) {
    if (what === 'goto') {   // show a setup's card: drop any search or chapter that would hide it
      const r = this.data.recipes.find(x => x.id === id);
      if (this.chapter && !(r?.chapters || []).includes(+this.chapter)) this.chapter = this.el.chapter.value = '';
      this.q = ''; this.el.search.value = ''; this.group = ''; this.host.querySelectorAll('[data-group]').forEach(b => b.setAttribute('aria-pressed', String(!b.dataset.group))); this.render();
      const card = this.el.list.querySelector(`[data-view="setups:${window.CSS.escape(id)}"]`); card?.scrollIntoView({ block: 'nearest' }); card?.focus({ preventScroll: true });
      return;
    }
    const recipe = this.data.recipes.find(r => r.id === id);
    if (what === 'scene') return this.openScene(id);
    if (what === 'prop') {
      const p = this.data.props.find(x => x.id === id);
      return this.preview(id, 'props:' + id, 'rigid3d', live => this.d.stage.loadProp(id, 'library-prop:' + id, { live }), 'Prop · ' + (p?.title || id), 'Static prop — decoration only, not simulated');
    }
    if (what === 'preview') {
      const key = 'setups:' + id;
      return this.preview(id, key, recipe?.kind, async live => {
        let r; try { r = await this.prefetch(key); } catch (e) { return { ok: false, error: e.status === 404 ? 'This setup is not in the library any more.' : e.message || 'no answer' }; }
        if (!live()) return { ok: false, cancelled: true };
        const res = await this.d.stage.load(r.lesson, 'library:' + id + '@' + (this.data.version ?? ''), { live, intent:'library' });
        if (res.ok && live()) this.d.stage.apply({ show: id === 'free_disk_wobble' ? ['omega','L','axis','trace','labels'] : r.lesson?.steps?.[0]?.show || [], playing: false });   // the setup's opening layers, as the tutor would open it
        if (res.ok && live() && (recipe?.physics_status === 'illustration' || /^none:/.test(recipe?.motion || '') || !res.motion)) this.d.stage.still();
        if (res.ok && live()) this.d.stage.libraryControls?.({ forces: r.lesson?.visualization?.kind === 'mechanics' });
        if (res.ok && !res.motion && !this.stills.has(id)) { this.stills.add(id); this.render(true); }
        return res;
      }, recipe?.title || id, '');
    }
    if (what === 'study') {
      button.disabled = true; this.say(id, 'Opening this setup with the tutor…');
      try { await this.d.study(recipe || { id }); this.msg = null; this.host.querySelector('.vl-pop')?.close(); }
      catch (e) { this.say(id, e.message || 'The tutor could not open this setup.', true); }
      finally { if (button.isConnected) button.disabled = false; }
    }
  }
  /* one preview at a time in the shared pane. load(live) must check live() before every stage change, so a
     slower earlier request never replaces a newer preview, the tutor's restored view or a studied thread. */
  cancel() { this.token = (this.token || 0) + 1; this.cover(null); this.d.artifact.pane.querySelector('[data-library-info]')?.remove?.(); }
  previewInfo(key) {
    const pane = this.d.artifact.pane;
    pane.querySelector('[data-library-info]')?.remove?.();
    const toolbar = pane.querySelector('.artifact-toolbar');
    if (!toolbar?.insertBefore) return;
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.libraryInfo = key;
    button.className = 'vl-preview-info'; button.textContent = 'i'; button.title = 'About this setup';
    button.setAttribute('aria-label', 'About this setup');
    button.onclick = () => key.startsWith('scenes:') ? this.popScene(key.slice(7)) : this.pop(key);
    toolbar.insertBefore(button, pane.querySelector('[data-artifact-details]'));
  }
  /* the card's picture over the stage while the live setup loads; it fades once the stage has drawn */
  cover(key) {
    const stage = document.getElementById('stage');
    stage?.querySelectorAll(':scope > .vl-ph').forEach(i => { i.classList.add('gone'); setTimeout(() => i.remove(), 200); });
    if (!key || !stage) return;
    const im = Object.assign(document.createElement('img'), { className: 'vl-ph', alt: '', decoding: 'sync', src: this.thumb(key) });
    im.onerror = () => im.remove();
    stage.appendChild(im);
  }
  /* A prepared Daily scene: the exact server payload (setup only until its solution was opened in Daily) mounted with the
     daily_visuals.js handle contract in the shared pane; switching, closing and leaving the gallery destroy the handle. */
  async openScene(id) {
    this.cancel(); const token = this.token, live = () => token === this.token;
    const x = this.data.scenes.find(r => r.problem_id === id);
    this.say(id, 'Loading the scene…'); this.d.onPreview?.();
    let desc;
    try { desc = await this.prefetch('scenes:' + id); }
    catch (e) { if (live()) this.say(id, e.status === 404 ? 'This scene is not available any more.' : 'Could not load the scene: ' + (e.message || 'no answer'), true); return; }
    if (!live()) return;
    const r = await this.d.artifact.showScene(x?.title || desc.title || id, async host => { if (!live()) return null; const module = await import('./daily_visuals.js'); if (!live()) return null; return module.mountDailyVisual(host, desc, { compact: false, embedded: true, intent:'library' }); });
    if (!live() || r.cancelled) return;
    if (!r.ok) { this.d.artifact.open(false, false); this.say(id, 'The 3D viewer is not available yet' + (r.error ? ' (' + r.error + ')' : '') + '.', true); return; }
    this.previewed = id; this.msg = null; this.note(); this.mark();
    // Prepared viewers already have a key/assumptions Info control inside the scene.
  }
  async preview(id, key, kind, load, title, caption) {
    this.cancel(); const token = this.token, live = () => token === this.token;
    this.say(id, 'Loading the preview…');
    this.d.onPreview?.();
    const a = this.d.artifact;
    // open the pane at once with the card's picture; the live setup replaces it when it has drawn
    if (kind) { a.configure(kind, title); a.setStep({ kind: 'native', caption, title }); a.open(true, false); this.cover(key); }
    if (kind) { await new Promise(r => requestAnimationFrame(() => setTimeout(r))); if (!live()) return; }   // let that picture paint before the stage's own work starts
    const r = await load(live);
    if (!live() || r?.cancelled) return;
    if (!r?.ok) { this.cover(null); if (kind) a.open(false, false); this.say(id, 'Could not show this preview: ' + (r?.error || 'unknown error'), true); return; }
    this.previewed = id; this.msg = null; this.note(); this.mark();
    this.previewInfo(key);
    const shown = r.kind === 'prop' ? 'rigid3d' : r.kind || 'diagram';
    if (shown !== kind) { a.configure(shown, title); a.setStep({ kind: 'native', caption, title }); }   // configure() closes the pane: only when the guess was wrong
    a.pane.querySelector('[data-artifact-details]').hidden = !['rigid3d', 'mechanics'].includes(r.kind);   // props, graphs and diagrams have no layers to choose
    if (!a.opened) a.open(true, false);
    requestAnimationFrame(() => { if (!live()) return; this.d.stage.refit?.(); requestAnimationFrame(() => { if (live()) this.cover(null); }); });   // fit again now the pane is laid out; uncover once drawn
  }
}
