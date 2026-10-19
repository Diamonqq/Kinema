import { esc } from './md.js';

/* Panel's Recent screenshots popover, in Kinema's chat. A small non-dimming panel sits above the
   composer button: one click attaches that screenshot, the corner control opens the image viewer.
   Nothing captures or sends the screen. A second click on the same button, Escape, an outside click
   or a chat change dismisses it and returns focus; the promise then resolves null. */
const WIDTH = 370;
const ZOOM = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 2H2v4M10 2h4v4M14 10v4h-4M6 14H2v-4"/></svg>';
let current = null;

const ago = s => {
  const sec = Math.max(0, Date.now() / 1000 - Number(s.modified_ts || 0));
  return sec < 60 ? `${Math.floor(sec)}s ago` : sec < 3600 ? `${Math.floor(sec / 60)}m ago` : `${Math.floor(sec / 3600)}h ago`;
};

/** True while the popover is open for this anchor (the composer button that opened it). */
export function isShotPickerOpen(anchor) { return !!current && current.anchor === anchor; }
/** Dismisses any open popover; its promise resolves null, so nothing is attached. */
export function closeScreenshotPicker() { current?.finish(null); }

export function pickScreenshot({ url = p => p, anchor = null } = {}) {
  if (isShotPickerOpen(anchor)) { current.finish(null); return Promise.resolve(null); }
  current?.finish(null);
  return new Promise(resolve => {
    const previous = anchor?.isConnected ? anchor : document.activeElement;
    const pop = document.createElement('div');
    pop.className = 'kinema-shots';
    pop.tabIndex = -1;
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Recent screenshots');
    pop.innerHTML = '<div class="shot-body"><p class="shot-notice" role="alert" hidden></p><div class="shot-grid" hidden></div><p class="shot-status" role="status"></p></div><footer><button type="button" data-shot="browse">Choose a file</button></footer><input type="file" accept="image/png,image/jpeg,image/webp" hidden>';
    document.body.append(pop);
    const grid = pop.querySelector('.shot-grid'), status = pop.querySelector('.shot-status'), notice = pop.querySelector('.shot-notice');
    let alive = true, items = [], ticket = 0, busy = false, lastIndex = -1;

    const get = async path => {
      const r = await fetch(url(path), { cache: 'no-store' });
      if (!r.ok) { let msg; try { msg = (await r.json()).detail; } catch {} throw Object.assign(new Error(msg || 'Could not read screenshots.'), { status: r.status }); }
      return r;
    };
    function place() {
      const vw = innerWidth, vh = innerHeight;
      const r = anchor?.isConnected ? anchor.getBoundingClientRect() : { left: vw / 2, top: vh, width: 0 };
      const width = Math.min(WIDTH, vw - 24);
      pop.style.width = width + 'px';
      pop.style.left = Math.max(12, Math.min(r.left, vw - width - 12)) + 'px';
      pop.style.bottom = Math.max(8, vh - r.top + 10) + 'px';
      pop.style.maxHeight = Math.max(160, r.top - 24) + 'px';
    }
    function say(text, { retry = false, role = 'status' } = {}) {
      grid.hidden = true; status.hidden = false; status.setAttribute('role', role);
      status.innerHTML = `${esc(text)}${retry ? ' <button type="button" data-shot="retry">Try again</button>' : ''}`;
    }
    // A failed attach stays visible above the thumbnails, with Try again; the grid is not replaced.
    function note(text, { retry = false } = {}) {
      notice.hidden = false;
      notice.innerHTML = `${esc(text)}${retry ? ' <button type="button" data-shot="retry">Try again</button>' : ''}`;
    }
    function render() {
      status.hidden = true; grid.hidden = false;
      grid.innerHTML = items.map((s, i) => `<div class="shot-tile-wrap"><button type="button" class="shot-tile" data-shot="pick" data-index="${i}" title="${esc(s.name)}" aria-label="Attach ${esc(s.name)}, ${esc(ago(s))}"><img src="${esc(url('/api/screenshots/' + s.id + '/thumbnail'))}" alt="" loading="lazy" decoding="async"><span class="shot-age">${esc(ago(s))}</span></button><button type="button" class="shot-zoom" data-shot="preview" data-index="${i}" aria-label="Preview ${esc(s.name)}" title="Preview">${ZOOM}</button></div>`).join('');
      const first = grid.querySelector('.shot-tile');
      if (first && (!pop.contains(document.activeElement) || document.activeElement === pop)) first.focus({ preventScroll: true });
    }
    async function load() {
      const mine = ++ticket;
      say('Reading screenshots…');
      try {
        const v = await (await get('/api/screenshots/recent')).json();
        if (!alive || mine !== ticket) return;
        items = v.items || [];
        if (items.length) render();
        else say('No screenshots in the last 24 hours. Take one with Win + Shift + S, then paste it here.');
      } catch (e) {
        if (alive && mine === ticket) say(e.message, { retry: true, role: 'alert' });
      }
    }
    function setBusy(index, on) {
      const tile = grid.querySelectorAll('.shot-tile')[index];
      if (tile) { tile.classList.toggle('is-busy', on); tile.setAttribute('aria-busy', String(on)); }
    }
    function finish(file) {
      if (!alive) return;
      alive = false;
      if (current?.pop === pop) current = null;
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', keys, true);
      removeEventListener('resize', place);
      pop.remove();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
      resolve(file || null);
    }
    async function attach(index) {
      const s = items[index];
      if (!s || busy || !alive) return;
      busy = true; lastIndex = index; notice.hidden = true; setBusy(index, true);
      try {
        const blob = await (await get('/api/screenshots/' + s.id + '/file')).blob();
        if (alive) finish(new File([blob], s.name, { type: blob.type || s.type || 'image/png' }));
      } catch (e) {
        if (!alive) return;
        if (e.status === 404) { await load(); if (alive) note('That screenshot is no longer on the PC.'); }
        else note(e.message || 'The screenshot could not be read.', { retry: true });
      } finally {
        busy = false;
        if (alive) setBusy(index, false);
      }
    }
    function preview(index, tile) {
      const s = items[index];
      if (!s || !window.KinemaImageViewer) return;
      window.KinemaImageViewer.open(url('/api/screenshots/' + s.id + '/file'), s.name, { returnFocus: () => (tile?.isConnected ? tile : previous) });
    }
    const viewerOpen = () => !!document.getElementById('lightbox') && !document.getElementById('lightbox').hidden;
    function outside(e) {
      const t = e.target;
      if (pop.contains(t) || (anchor && anchor.contains(t)) || t.closest?.('#lightbox')) return;
      finish(null);
    }
    function keys(e) {
      if (e.key === 'Escape') {
        if (viewerOpen()) return;
        e.preventDefault(); e.stopPropagation(); finish(null); return;
      }
      const tiles = [...grid.querySelectorAll('.shot-tile')], i = tiles.indexOf(document.activeElement);
      if (i < 0 || viewerOpen()) return;
      const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 3, ArrowUp: -3 }[e.key];
      const n = e.key === 'Home' ? 0 : e.key === 'End' ? tiles.length - 1 : step === undefined ? null : i + step;
      if (n === null) return;
      e.preventDefault(); tiles[Math.max(0, Math.min(tiles.length - 1, n))].focus();
    }
    pop.addEventListener('click', e => {
      const b = e.target.closest('[data-shot]');
      if (!b) return;
      const index = Number(b.dataset.index);
      if (b.dataset.shot === 'pick') attach(index);
      else if (b.dataset.shot === 'preview') { e.stopPropagation(); preview(index, b.closest('.shot-tile-wrap')?.querySelector('.shot-tile')); }
      else if (b.dataset.shot === 'retry') (notice.hidden === false && lastIndex >= 0 && items[lastIndex] ? attach(lastIndex) : load());
      else if (b.dataset.shot === 'browse') pop.querySelector('input').click();
    });
    // A thumbnail that fails to load shows a plain label; the tile stays usable for the file read.
    pop.addEventListener('error',e=>{if(e.target.tagName==='IMG')e.target.closest('.shot-tile')?.classList.add('is-broken');},true);
    pop.querySelector('input').addEventListener('change', e => { const f = e.target.files[0]; if (f) finish(f); });
    current = { anchor, pop, finish };
    place();
    addEventListener('resize', place);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', keys, true);
    pop.focus({ preventScroll: true });
    load();
  });
}
