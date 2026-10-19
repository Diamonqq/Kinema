/* Kinema stage labels (1.13): one controller, keyed by each label's stable `key`, with no easing or ranking; overlap
   avoidance is sticky per key (LabelSpots), so a brief brush between two labels never makes either jump. Three slots:
   - glyph: a short symbol (r, F, τ …) drawn beside its arrow tip in the same frame the arrow moves;
   - pin:   drafting text fixed at its world `pin` point (θ, distances, axis names);
   - key:   a row in the stage key only.
   A fixed screenOffset may separate coincident glyphs without moving their physical arrows.
   Full names live in the key (top-left), whose rows keep their order for the whole scene; a quantity missing
   this frame dims its row instead of removing it. Optional label fields from the scene: glyph, dir, legend, slot,
   order, row (labels sharing one key row, e.g. the x/y/z of one frame), group (key section: vectors, axes,
   reference). Labels without them keep working: plain/pinned/formula labels pin, others get a glyph and a key row.
   1.12: each key row is a coloured symbol column and a short description; on a small stage (or when the student
   folds it) the key collapses to the symbols alone, so it never covers the body. */
import * as THREE from 'three';
import { hex, PALETTE } from './studio.js';

const NAMES = { 'ω': 'angular velocity', 'L': 'angular momentum', 'τ': 'torque', 'Mg': 'weight', 'mg': 'weight', 'N': 'normal force', 'f': 'friction',
  'F_pivot': 'pivot force', 'v_CM': 'centre-of-mass velocity', 'v': 'velocity', 'r': 'pivot to point', 'F': 'force', 'T': 'tension' };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const subs = s => /\$/.test(s) ? esc(s) : esc(s).replace(/_([A-Za-z0-9]+)/g, '<sub>$1</sub>');   // F_pivot → F with a subscript; $…$ is left whole for KaTeX
const GAP = 5;   // px between an arrow tip and its glyph box

const CSS = `
#callouts .sl{position:absolute;left:0;top:0;pointer-events:none;white-space:nowrap;will-change:transform;contain:layout style}
#callouts .sl-glyph{font:600 12px/1.25 var(--sans,system-ui);background:rgba(27,27,27,.8);padding:0 3px;border-radius:4px}
#callouts .sl-glyph sub{font-size:.74em;font-weight:600;vertical-align:-.28em;line-height:0}
#callouts .sl-pin{font:500 11px/1.35 var(--sans,system-ui);color:#b2b2b2;background:rgba(27,27,27,.78);padding:1px 4px;border-radius:4px;font-variant-numeric:tabular-nums}
#callouts .sl-pin b{font-weight:600;color:#d5dae1;margin-left:4px}
#callouts .sl-pin i{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:5px;vertical-align:1px}
#callouts .sl.hl{box-shadow:0 0 0 2px rgba(245,214,122,.55)}
#callouts .sl .katex{font-size:1.02em}
.stage>.stage-key{position:absolute;left:10px;top:10px;z-index:3;display:grid;grid-template-columns:auto minmax(0,1fr) auto;column-gap:9px;row-gap:2px;align-items:baseline;
  padding:6px 8px 6px 9px;border-radius:9px;background:rgba(14,16,20,.9);box-shadow:0 0 0 1px rgba(255,255,255,.07);
  font:450 12px/1.4 var(--sans,system-ui);color:#cdd3db;pointer-events:none;max-width:min(320px,calc(100% - 20px))}
.stage>.stage-key[hidden]{display:none}
.stage-key .r{display:contents}
.stage-key .s{white-space:nowrap;font:650 13px/1.4 var(--sans,system-ui);letter-spacing:.01em}
.stage-key .s b{font-weight:inherit}.stage-key .s sub{font-size:.72em;font-weight:600;vertical-align:-.25em;line-height:0}.stage-key .s b+b{margin-left:5px}
.stage-key .s i{display:inline-block;width:12px;height:3px;border-radius:2px;vertical-align:3px}
.stage-key .n{min-width:0;overflow-wrap:anywhere}
.stage-key .v{padding-left:6px;font-variant-numeric:tabular-nums;color:#9aa3ae}
.stage-key .r.off>*{opacity:.42}
.stage-key .r.hl .n{color:#f2e3b0}
.stage-key .r.gs>*{margin-top:4px}
.stage-key .kt{grid-column:1/-1;justify-self:start;pointer-events:auto;cursor:pointer;margin:2px 0 0 -3px;padding:1px 5px;border:0;border-radius:6px;background:none;
  color:#8f98a3;font:500 11px/1.4 var(--sans,system-ui)}
.stage-key .kt:hover{color:#dfe4ea;background:rgba(255,255,255,.06)}.stage-key .kt:focus-visible{outline:2px solid #6aa6ff;outline-offset:1px}
.stage>.stage-key.compact{display:flex;flex-wrap:wrap;align-items:center;gap:2px 10px;padding:4px 6px 4px 9px}
.stage-key.compact .r{display:inline}.stage-key.compact .n,.stage-key.compact .v{display:none}.stage-key.compact .r.gs>*{margin-top:0}
.stage-key.compact .kt{margin:0 0 0 -2px}
.stage>.stage-key.symbolic{left:10px;right:10px;top:8px;max-width:none;display:flex;flex-wrap:wrap;gap:4px 13px;padding:0;background:none;box-shadow:none;font-size:11px;line-height:1.4}
.stage-key.symbolic .r{display:inline-flex;align-items:baseline;gap:5px;min-width:0}
.stage-key.symbolic .r.gs>*{margin-top:0}
.stage-key.symbolic .n{font-size:11px;color:#b7b7b7}
.stage-key.symbolic .s{font-size:12px}
.stage-key.symbolic .v:empty,.stage-key.symbolic .kt{display:none}
.stage-key.symbolic .v{font-size:11px;padding-left:2px}
.stage-key.symbolic.tight .n{display:none}
body.math-view .stage>.stage-key{display:none}
.stage>.stage-card{position:absolute;left:10px;bottom:64px;z-index:3;max-width:min(470px,calc(100% - 20px));padding:6px 10px 7px;border-radius:9px;background:rgba(14,16,20,.9);
  box-shadow:0 0 0 1px rgba(255,255,255,.07);font:450 12px/1.5 var(--sans,system-ui);color:#cdd3db;pointer-events:none}
.stage>.stage-card[hidden]{display:none}
.stage-card .t{font:600 11px/1.4 var(--sans,system-ui);color:#8f98a3;margin-bottom:2px}
.stage-card .l{white-space:nowrap}
.stage-card .l b{display:inline-block;min-width:2.4em;color:#e8ecf1;font-weight:650}
.stage-card .n{color:#9aa3ae;font-variant-numeric:tabular-nums;margin-left:8px}
.stage-card .l i{color:#8f98a3;font-style:normal;font-size:11px}
.stage-card .off{opacity:.42}
.stage>.stage-card.tight .n,.stage>.stage-card.tight .l>i{display:none}
/* Compact views keep their symbolic equations in the Breakdown popup; the full live card is available expanded. */
.stage>.stage-card.tight{display:none}
@media(max-width:420px){.stage>.stage-card{font-size:11px;padding:5px 8px}.stage-card .l{white-space:normal}}
body.math-view .stage>.stage-card{display:none}
@media(max-width:600px){#callouts .sl-glyph{font-size:12px}}`;
const DENSITY = 'kinema.key.';   // the student's own fold choice, per stage size class
const density = { get(c) { try { return localStorage.getItem(DENSITY + c); } catch { return null; } }, set(c, v) { try { localStorage.setItem(DENSITY + c, v); } catch {} } };
/* Split a key name into its symbol and description: "τ = r × F  gravity torque…" → ["τ = r × F", "gravity torque…"]. */
export function splitName(name) {
  const s = String(name ?? ''), m = s.match(/^(\S(?:.*?\S)?)\s{2,}(\S.*)$/);
  return m ? [m[1], m[2]] : [null, s];
}
const RESERVE = Object.freeze({ left: 150, top: 60 });   // CSS px the folded key may cover (camera.userData.reserve)
/* Whether the key starts folded to its symbols: small stages, many rows in a short one, or more than a few rows in a
   side-pane width (an open key there covers the pivot and the top of the body). */
export function autoCompact(W, H, rows) { return W < 340 || H < 400 || (rows > 5 && H < 560) || (rows > 3 && W < 560); }

function typeset(el) { if (window.renderMathInElement && el.innerHTML.includes('$')) renderMathInElement(el, { delimiters: [{ left: '$', right: '$', display: false }], throwOnError: false }); }
const fmtValue = (v, unit) => v == null || !Number.isFinite(v) ? '' : (Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2)) + (unit ? ' ' + unit : '');

/* What a label shows and where, from its own fields; legacy labels resolve to the slot they always meant. */
export function resolveLabel(L) {
  const label = String(L.label ?? ''), short = label.split(' = ')[0].trim() || label;
  const slot = L.slot || (L.plain || L.formula || L.pin ? 'pin' : 'glyph');
  const glyph = slot === 'glyph' ? String(L.glyph ?? short) : null;
  const name = L.legend ?? (NAMES[short] ? `${short}  ${NAMES[short]}` + (short !== label ? ` (${label.slice(short.length).replace(/^\s*=\s*/, '= ')})` : '') : label);
  return { slot, glyph, name, label };
}

/* Screen placement of a glyph box (w × h) beside the tip p, along the screen direction u (unit), clamped inside W × H. */
export function glyphCentre(p, u, w, h, W, H, screenOffset = [0, 0]) {
  const reach = GAP + Math.abs(u[0]) * w / 2 + Math.abs(u[1]) * h / 2;
  const dx = Number.isFinite(screenOffset?.[0]) ? screenOffset[0] : 0, dy = Number.isFinite(screenOffset?.[1]) ? screenOffset[1] : 0;
  return [Math.max(w / 2 + 2, Math.min(W - w / 2 - 2, p[0] + u[0] * reach + dx)), Math.max(h / 2 + 2, Math.min(H - h / 2 - 2, p[1] + u[1] * reach + dy))];
}

/* Never on top of a label already placed this frame: step the box on along its own direction d, then across it, kept
   inside the W x H stage; the first free spot wins (deterministic, no state). placed holds [cx, cy, w, h] boxes. */
const OFFSETS = [[0, 0], [1, 0], [0, 1], [0, -1], [2, 0], [1, 1], [1, -1], [-1, 0], [0, 2], [0, -2], [3, 0], [-2, 0]];
const overlaps = (placed, q, w, h, pad = 0) => placed.some(b => Math.abs(b[0] - q[0]) < (b[2] + w) / 2 + 2 + pad && Math.abs(b[1] - q[1]) < (b[3] + h) / 2 + 1 + pad);
/* The candidate spot k (0 = the label's own place) for a box at c pushed along d: one box on, by its width or height. */
export function spotAt(k, c, d, w, h, W, H) {
  const [a, b] = OFFSETS[k] || OFFSETS[0], n = [-d[1], d[0]], step = u => Math.abs(u[0]) * (w + 4) + Math.abs(u[1]) * (h + 3), sd = step(d), sn = step(n);
  return [Math.max(w / 2 + 2, Math.min(W - w / 2 - 2, c[0] + a * d[0] * sd + b * n[0] * sn)), Math.max(h / 2 + 2, Math.min(H - h / 2 - 2, c[1] + a * d[1] * sd + b * n[1] * sn))];
}
function freeSpot(c, d, w, h, W, H, placed) {
  if (!overlaps(placed, c, w, h)) return 0;
  for (let k = 1; k < OFFSETS.length; k++) if (!overlaps(placed, spotAt(k, c, d, w, h, W, H), w, h)) return k;
  // nowhere fully free (many loads at once): stay home as before, unless home is on a fixed obstacle (the key strip); then
  // the first candidate clear of fixed obstacles, a deterministic choice so a crowded label does not flicker between spots
  const fixed = placed.filter(b => b[4]);
  for (let k = 0; k < OFFSETS.length; k++) if (!overlaps(fixed, spotAt(k, c, d, w, h, W, H), w, h)) return k;
  return 0;
}
export function clearSpot(c, d, w, h, W, H, placed) { const k = freeSpot(c, d, w, h, W, H, placed); return k ? spotAt(k, c, d, w, h, W, H) : c; }

/* Temporal stability for overlap avoidance (1.13). The stateless search above re-decided every frame, so a label two boxes
   brushed for one frame jumped a row and back: the label "spazz". Here each keyed label remembers which candidate it
   holds. The candidate is relative to the label's own physical place, so a label still follows its body exactly; only
   the step-aside choice is sticky:
   - a label holds its step-aside while that spot stays free, and returns home only after its own place has been clear by
     a margin for `settle` frames (hysteresis);
   - labels claim spots in first-seen order, so a newcomer steps aside rather than displacing a label already on screen.
   stats separates body motion (anchor travel) from allocation jumps (the label moving relative to its anchor). */
export class LabelSpots {
  constructor({ settle = 10, margin = 6 } = {}) { this.mem = new Map(); this.settle = settle; this.margin = margin; this.frame = 0; this.resetStats(); this.begin(); }
  /* jumps: a label changing its allocated spot (home ↔ step-aside); kinks: any other frame-to-frame discontinuity of its
     offset from the anchor (a second difference above 8 px), so smooth drift as a vector turns is not counted */
  resetStats() { this.stats = { frames: 0, samples: 0, jumps: 0, maxJump: 0, kinks: 0, maxKink: 0, maxAnchorMove: 0, recent: [] }; }
  begin() { this.placed = []; this.frame++; this.stats.frames++; }
  fix(box) { this.placed.push([box[0], box[1], box[2], box[3], true]); }   // a fixed obstacle (the key strip): never stepped onto
  place(id, anchor, c, d, w, h, W, H) {
    let m = this.mem.get(id);
    if (!m) { m = { k: 0, clear: 0 }; this.mem.set(id, m); }
    if (m.k) {
      m.clear = overlaps(this.placed, c, w, h, this.margin) ? 0 : m.clear + 1;
      if (m.clear >= this.settle) m.k = 0;
      else if (overlaps(this.placed, spotAt(m.k, c, d, w, h, W, H), w, h)) m.k = freeSpot(c, d, w, h, W, H, this.placed);
    } else if (overlaps(this.placed, c, w, h)) { m.k = freeSpot(c, d, w, h, W, H, this.placed); m.clear = 0; }
    let q = m.k ? spotAt(m.k, c, d, w, h, W, H) : c;
    // a fixed obstacle taller than the step-aside reach (a key wrapped to three rows) is a hard edge: a label still on it
    // moves just past its nearer side that fits the stage, a pure function of position, so it cannot flicker
    for (const b of this.placed) if (b[4] && overlaps([b], q, w, h)) {
      const below = b[1] + b[3] / 2 + h / 2 + 2, above = b[1] - b[3] / 2 - h / 2 - 2;
      q = [q[0], below + h / 2 <= H && (q[1] >= b[1] || above - h / 2 < 0) ? below : above];
    }
    const flipped = m.seen === this.frame - 1 && m.k !== m.pk;
    this.placed.push([q[0], q[1], w, h]);
    this.measure(id, m, anchor || c, q, flipped); m.pk = m.k;
    m.seen = this.frame;
    return q;
  }
  measure(id, m, a, q, flipped) {
    const off = [q[0] - a[0], q[1] - a[1]], S = this.stats, live = m.a && m.seen === this.frame - 1;
    if (live) {
      const jump = Math.hypot(off[0] - m.off[0], off[1] - m.off[1]), move = Math.hypot(a[0] - m.a[0], a[1] - m.a[1]);
      S.samples++; S.maxAnchorMove = Math.max(S.maxAnchorMove, move);
      const note = (type, v) => { S.recent.push({ id: String(id).slice(0, 60), type, frame: this.frame, jump: +v.toFixed(1), move: +move.toFixed(1) }); if (S.recent.length > 40) S.recent.shift(); };
      if (flipped) { S.jumps++; S.maxJump = Math.max(S.maxJump, jump); note('flip', jump); }
      else if (m.off2) { const k = Math.hypot(off[0] - 2 * m.off[0] + m.off2[0], off[1] - 2 * m.off[1] + m.off2[1]); if (k > 8) { S.kinks++; S.maxKink = Math.max(S.maxKink, k); note('kink', k); } }
    }
    m.off2 = live ? m.off : null; m.a = a; m.off = off;
  }
  end() { for (const [id, m] of this.mem) if (this.frame - (m.seen || 0) > 120) this.mem.delete(id); }
}

export class StageLabels {
  constructor(host, stage, camera) {
    this.host = host; this.stage = stage; this.camera = camera; this.v = new THREE.Vector3(); this.w = new THREE.Vector3();
    this.items = new Map(); this.rows = new Map(); this.seq = 0; this.spots = new LabelSpots();
    if (!document.getElementById('stage-labels-css')) { const s = document.createElement('style'); s.id = 'stage-labels-css'; s.textContent = CSS; document.head.appendChild(s); }
    this.key = document.createElement('div'); this.key.className = 'stage-key'; this.key.hidden = true; this.key.setAttribute('aria-label', 'Key'); stage.appendChild(this.key);
    // the equation card: one fixed panel at the stage's lower left (above the transport) that never moves with the scene
    this.card = document.createElement('div'); this.card.className = 'stage-card'; this.card.hidden = true; this.card.setAttribute('aria-label', 'Equations'); stage.appendChild(this.card);
  }
  /* L: {slot:'card', title, lines:[html]} from a teaching view, or none. Rewrites only what changed; a change in the card's
     height (it appears, goes, or wraps) asks the stage to refit once, so the bodies stay clear of it. */
  updateCard(L, show) {
    const html = L && show ? (L.title ? `<div class="t">${esc(L.title)}</div>` : '') + (L.lines || []).map(x => `<div class="l">${x}</div>`).join('') : '';
    if (html !== this.cardHtml) { this.cardHtml = html; this.card.innerHTML = html; this.card.hidden = !html; }
    if (!html) { if (this.cardSignature) { this.cardSignature = ''; this.layoutChanged = true; } return; }
    const st = this.stage.getBoundingClientRect(); let bottom = 12;
    // a small stage (a 320 px phone column) keeps the equations only: the numbers and the note would wrap the card over the
    // whole scene; they return on a wider stage or the expanded view
    const tight = st.width < 400 || st.height < 300; if (this.card.classList.contains('tight') !== tight) this.card.classList.toggle('tight', tight);
    for (const el of this.stage.querySelectorAll('.transport, .overlays')) { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0 && r.top >= st.top + st.height * 0.4 && r.top < st.bottom) bottom = Math.max(bottom, Math.round(st.bottom - r.top + 8)); }
    if (this.cardBottom !== bottom) { this.cardBottom = bottom; this.card.style.bottom = bottom + 'px'; }
    const signature = `${Math.round(st.width)}:${Math.ceil(this.card.offsetHeight / 8)}:${bottom}`;
    if (signature !== this.cardSignature) { this.cardSignature = signature; this.layoutChanged = true; }
  }
  screen(p, W, H) { this.v.copy(p).project(this.camera); return [(this.v.x + 1) / 2 * W, (1 - this.v.y) / 2 * H]; }
  /* labels: this frame's list. opts: {show, values, highlight(L) → bool, W, H, center (world point)} */
  update(labels, opts) {
    const { W, H } = opts, show = opts.show !== false, seen = new Set(), present = new Map(), dup = new Map();
    this.symbolic = !!opts.compactKey;
    this.key.classList.toggle('symbolic', this.symbolic);
    const work = [];
    this.updateCard((labels || []).find(L => L && L.slot === 'card'), show);
    for (const L of labels || []) {
      if (!L || !L.tip) continue;
      const r = resolveLabel(L);
      // A stable identity: the scene's key, else the label text plus its occurrence (old producers without keys).
      let id = L.key; if (id == null) { const n = (dup.get(r.label) || 0) + 1; dup.set(r.label, n); id = r.label + '#' + n; }
      if (seen.has(id)) continue; seen.add(id);
      const color = hex(L.color ?? PALETTE.ink);
      if (r.slot !== 'pin') {
        const rowId = L.row ? 'row|' + L.row : L.legend ? 'k|' + id : r.name + '|' + color;
        const row = present.get(rowId) || { L, r, color, n: 0, hl: false, members: [] }; row.n++; row.hl = row.hl || !!opts.highlight?.(L);
        row.members.push([r.glyph ?? r.label.split(' = ')[0].trim(), color]); present.set(rowId, row);
      }
      if (r.slot === 'key' || (!show && r.slot === 'glyph') || (!show && !L.plain && !L.formula && r.slot === 'pin')) continue;
      let it = this.items.get(id);
      if (!it) { it = { el: document.createElement('div'), html: null, w: 0, h: 0, vis: false, hl: false, cls: '', seq: this.seq++ }; this.host.appendChild(it.el); this.items.set(id, it); }
      const html = r.slot === 'glyph' ? subs(r.glyph) : (L.plain || L.formula ? '' : `<i style="background:${color}"></i>`) + esc(r.label) + ((opts.values || L.formula) && L.value != null && Number.isFinite(L.value) ? '<b>' + esc(fmtValue(L.value, L.unit)) + '</b>' : '');
      const cls = 'sl sl-' + (r.slot === 'glyph' ? 'glyph' : 'pin');
      work.push({ id, it, L, r, html, cls, color });
    }
    // writes, then one read of any changed boxes, then transforms: at most one layout per frame, none when unchanged
    let measure = false;
    for (const w of work) {
      const { it } = w;
      if (it.cls !== w.cls) { it.el.className = w.cls; it.cls = w.cls; it.html = null; }
      if (it.html !== w.html) { it.el.innerHTML = w.html; typeset(it.el); it.html = w.html; it.dirty = true; measure = true; }
      if (w.r.slot === 'glyph' && it.color !== w.color) { it.el.style.color = w.color; it.color = w.color; }
      const hl = !!opts.highlight?.(w.L); if (hl !== it.hl) { it.el.classList.toggle('hl', hl); it.hl = hl; }
      if (!it.vis) { it.el.style.display = ''; it.vis = true; it.dirty = true; measure = true; }
    }
    if (measure) for (const { it } of work) if (it.dirty) { it.w = it.el.offsetWidth; it.h = it.el.offsetHeight; it.dirty = false; }
    // first-seen order, not this frame's list order: a label already on screen keeps its spot when another appears
    work.sort((a, b) => (b.r.slot === 'pin') - (a.r.slot === 'pin') || a.it.seq - b.it.seq);   // drafting pins hold their world point; glyphs step aside
    this.spots.begin();
    // the key strip is a fixed obstacle: a force label steps around it instead of printing over its rows (2.1 at 320 px,
    // 8.12 with every arc load). Read after this frame's writes and measures, so it adds no extra layout.
    for (const panel of [this.key, this.card]) if (!panel.hidden && work.length) { const k = panel.getBoundingClientRect(), o = this.host.getBoundingClientRect();
      if (k.width > 0 && k.height > 0) this.spots.fix([k.left - o.left + k.width / 2, k.top - o.top + k.height / 2, k.width + 4, k.height + 4]); }
    for (const w of work) {
      const { it, L, r, id } = w;
      this.v.copy(L.pin && r.slot === 'pin' ? L.pin : L.tip).project(this.camera);
      if (!(this.v.z < 1) || !Number.isFinite(this.v.x)) { it.el.style.display = 'none'; it.vis = false; continue; }
      const p = [(this.v.x + 1) / 2 * W, (1 - this.v.y) / 2 * H];
      let c, d = [0, -1]; it.anchor = p;
      // a pin marks a place (θ at a pivot, a point name): when that place is off the stage (a close-up) it is hidden, not
      // clamped to the edge where it would name nothing and slide along the border as the camera follows
      if (r.slot === 'pin' && (p[0] < -8 || p[0] > W + 8 || p[1] < -8 || p[1] > H + 8)) { it.el.style.display = 'none'; it.vis = false; continue; }
      if (r.slot === 'pin') c = [Math.max(it.w / 2 + 2, Math.min(W - it.w / 2 - 2, p[0])), Math.max(it.h / 2 + 2, Math.min(H - it.h / 2 - 2, p[1]))];
      else c = glyphCentre(p, d = this.direction(L, p, W, H, opts.center), it.w, it.h, W, H, L.screenOffset);
      c = this.spots.place(id, p, c, d, it.w, it.h, W, H);
      it.el.style.transform = `translate3d(${(c[0] - it.w / 2).toFixed(1)}px,${(c[1] - it.h / 2).toFixed(1)}px,0)`;
      it.at = c;
    }
    this.spots.end();
    const drawn = new Set(work.map(w => w.id));
    for (const [id, it] of this.items) if (!drawn.has(id) && it.vis) { it.el.style.display = 'none'; it.vis = false; }
    this.legend(present, show, opts.values, W, H);
  }
  /* Screen direction to push a glyph off its tip: along the arrow, else away from the scene centre, else up. */
  direction(L, p, W, H, center) {
    const unit = (dx, dy) => { const m = Math.hypot(dx, dy); return m > 0.5 ? [dx / m, dy / m] : null; };
    if (L.dir) {
      const reach = Math.max(1e-6, this.camera.position.distanceTo(L.tip) * 0.05);
      this.w.copy(L.dir).normalize().multiplyScalar(reach).add(L.tip).project(this.camera);
      const u = unit((this.w.x + 1) / 2 * W - p[0], (1 - this.w.y) / 2 * H - p[1]); if (u) return u;
    }
    if (center) { const c = this.screen(center, W, H); const u = unit(p[0] - c[0], p[1] - c[1]); if (u) return u; }
    return [0, -1];
  }
  /* the symbol column of a row: each member's glyph in its own colour (a frame's x y z), the legend's own symbol,
     or a colour swatch when the name has none */
  symbolHTML(x) {
    const [sym] = splitName(x.r.name);
    if (x.L.row) { const seen = new Set(); return x.members.filter(([g]) => !seen.has(g) && seen.add(g)).map(([g, c]) => `<b style="color:${c}">${subs(g)}</b>`).join(''); }
    return sym ? `<b style="color:${x.color}">${subs(sym)}</b>` : `<i style="background:${x.color}"></i>`;
  }
  legend(present, show, values, W, H) {
    let added = false;
    for (const [rowId, x] of present) {
      let row = this.rows.get(rowId);
      if (!row) {
        const el = document.createElement('div'); el.className = 'r';
        el.innerHTML = `<span class="s"></span><span class="n">${((n) => /^\S{1,14}$/.test(n) ? subs(n) : esc(n))(splitName(x.r.name)[1])}</span><span class="v"></span>`;
        typeset(el.children[1]);
        row = { el, order: Number.isFinite(x.L.order) ? x.L.order : Infinity, seq: this.seq++, group: x.L.group || '', on: true, hl: false, v: '', sym: null };
        this.rows.set(rowId, row); added = true;
      }
      const sym = this.symbolHTML(x);   // a frame row can gain a member (z appears later); never reorders
      if (sym !== row.sym) { row.el.firstChild.innerHTML = sym; typeset(row.el.firstChild); row.sym = sym; }
    }
    if (added) {
      let group = null;
      [...this.rows.values()].sort((a, b) => a.order - b.order || a.seq - b.seq).forEach((row, i) => { row.el.classList.toggle('gs', i > 0 && row.group !== group); group = row.group; this.key.appendChild(row.el); });
      this.key.appendChild(this.toggle());
    }
    for (const [rowId, row] of this.rows) {
      const x = present.get(rowId), on = !!x;
      if (on !== row.on) { row.el.classList.toggle('off', !on); row.on = on; }
      const hl = !!x?.hl; if (hl !== row.hl) { row.el.classList.toggle('hl', hl); row.hl = hl; }
      const v = values && x && x.n === 1 ? fmtValue(x.L.value, x.L.unit) : '';
      if (v !== row.v) { row.el.lastChild.textContent = v; row.v = v; }
    }
    // a deliberate change of what is drawn (another body, a chosen subset of loads) drops the rows it left behind once;
    // during motion an absent row only dims, so the key never jumps while forces come and go
    if (this.prune) { this.prune = false; for (const [rowId, row] of this.rows) if (!row.on) { row.el.remove(); this.rows.delete(rowId); } }
    if (W && H) this.size = [W, H];
    const hide = !show || !this.rows.size; if (this.key.hidden !== hide) this.key.hidden = hide;
    this.density();
  }
  /* folded (symbols only) on a small stage unless the student opened it there, and the reverse on a large one */
  density() {
    if (this.symbolic) {
      this.key.classList.remove('compact');
      // a key whose descriptions wrap over a fifth of a small stage (2.2's Breakdown at 320 px) folds to its coloured symbols;
      // decided only when the stage size or the rows change, so it never toggles while the scene runs
      const [kw, kh] = this.size || [800, 800], tsig = `${kw}:${kh}:${this.rows.size}:${this.key.hidden}`;
      if (tsig !== this.tightSignature) { this.tightSignature = tsig; this.key.classList.remove('tight');
        if (!this.key.hidden && this.key.getBoundingClientRect().height > 0.22 * kh) this.key.classList.add('tight'); }
      // Reserve the actual slim key, including a wrapped phone row, before fitting the apparatus.
      const height = this.key.hidden ? 0 : Math.ceil(this.key.getBoundingClientRect().height) + 18;
      const signature = this.key.hidden ? '' : `${this.size?.[0] || 0}:${height}`;
      if (signature !== this.reserveSignature) {
        this.reserveSignature = signature; this.layoutChanged = true;
        this.camera.userData.reserve = height ? { left: this.size?.[0] || 1000, top: height } : null;
      }
      return;
    }
    const [W, H] = this.size || [800, 800], auto = autoCompact(W, H, this.rows.size), cls = auto ? 'small' : 'large';
    const prefs = this.prefs ||= {}; if (!(cls in prefs)) prefs[cls] = density.get(cls);
    const compact = prefs[cls] ? prefs[cls] === 'compact' : auto;
    if (compact !== this.compact || cls !== this.cls) {
      this.compact = compact; this.cls = cls;
      this.key.classList.toggle('compact', compact);
      const b = this.toggle(); b.textContent = compact ? 'names' : 'hide names'; b.setAttribute('aria-expanded', String(!compact));
      b.title = compact ? 'Show what each symbol means' : 'Fold the key to its symbols';
    }
    // the camera fits (rigid, prop, planar) keep the key clear: the folded key's corner, and an open key (the default on a
    // roomy pane) at its measured size, after the fold above has taken effect; it had covered a conical pendulum's Ω ring
    let reserve = compact && this.rows.size ? RESERVE : null;
    if (!compact && this.rows.size && !this.key.hidden) { const r = this.key.getBoundingClientRect(); if (r.width > 0 && r.height > 0) reserve = { left: Math.ceil(r.width) + 16, top: Math.ceil(r.height) + 16 }; }
    const prev = this.camera.userData.reserve;
    if (prev !== reserve && !(prev && reserve && prev.left === reserve.left && prev.top === reserve.top)) { this.camera.userData.reserve = reserve; this.layoutChanged = true; }
  }
  toggle() {
    if (!this.kt) {
      this.kt = document.createElement('button'); this.kt.type = 'button'; this.kt.className = 'kt';
      this.kt.addEventListener('click', () => { const v = this.compact ? 'full' : 'compact'; density.set(this.cls, v); (this.prefs ||= {})[this.cls] = v; this.compact = null; this.density(); });
    }
    return this.kt;
  }
  /* the next update drops key rows that are no longer drawn (see legend) */
  pruneKey() { this.prune = true; }
  clear() { this.updateCard(null, false); for (const it of this.items.values()) it.el.remove(); this.items.clear(); this.spots = new LabelSpots(); for (const row of this.rows.values()) row.el.remove(); this.rows.clear(); this.seq = 0; this.compact = null; this.reserveSignature = null; this.layoutChanged = false; this.camera.userData.reserve = null; this.key.hidden = true; }
}
