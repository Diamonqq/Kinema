import { controlIcon } from './icons.js';
/* Declarative mathematical visualizations. Expressions are data, compiled by Kinema's parser;
   rendering a model's formula is never presented as independent physics verification. */
import { drawCircuit, circuitStatus } from './circuit.js';
const esc =s => String(s ?? '').normalize('NFC').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const PLOT_THEME = Object.freeze({background:'#171b22',grid:'#ffffff12',axis:'#78899e',text:'#b8c7d9',probe:'#cad9ec'});
const palette = ['#a7cafa', '#e0b980', '#85c6b8', '#cf9bc9'];
const num = v => !Number.isFinite(v) ? 'unavailable' : v === 0 ? '0' : Math.abs(v) < .001 || Math.abs(v) >= 1e5 ? v.toExponential(2) : Number(v.toPrecision(4)).toString();
export const plotColor = (c, i) => {
  if(!/^#[0-9a-f]{6}$/i.test(c||''))return palette[i%palette.length];
  const rgb=[1,3,5].map(n=>parseInt(c.slice(n,n+2),16));
  if(rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722>=145)return c;
  return '#'+rgb.map(v=>Math.round(v+(255-v)*.5).toString(16).padStart(2,'0')).join('');
};
export function plotRange(range,{scale=1,anchorX=.5,anchorY=.5,dx=0,dy=0}={}) {
  const width=range.x_max-range.x_min,height=range.y_max-range.y_min;
  if(![...Object.values(range),scale,anchorX,anchorY,dx,dy].every(Number.isFinite) || !(width>0&&height>0&&scale>0))throw new Error('Invalid plot view');
  const ax=range.x_min+width*clamp(anchorX,0,1),ay=range.y_min+height*clamp(anchorY,0,1);
  const next={x_min:ax+(range.x_min-ax)*scale+dx*width,x_max:ax+(range.x_max-ax)*scale+dx*width,
    y_min:ay+(range.y_min-ay)*scale+dy*height,y_max:ay+(range.y_max-ay)*scale+dy*height};
  if(Object.values(next).some(v=>!Number.isFinite(v)) || next.x_max-next.x_min<1e-12 || next.y_max-next.y_min<1e-12) return range;
  return next;
}

export function checkResult(c, got) {
  if (!Number.isFinite(got) || !Number.isFinite(c.expect)) return {...c, got, status:'na'};
  // The model cannot set its own passing threshold above 3%.
  const tolerance = Math.max(0, Math.min(3, Number.isFinite(c.tol_pct) ? c.tol_pct : 3)) / 100;
  const allowed = tolerance * Math.max(Math.abs(c.expect), 1e-6);
  const status = Math.abs(got - c.expect) <= allowed ? 'ok' : Math.abs(Math.abs(got) - Math.abs(c.expect)) <= allowed ? 'sign' : 'bad';
  return {...c, got, status};
}

export function checkSummary(checks) {
  const count = status => checks.filter(c => c.status === status).length;
  const ok = count('ok'), sign = count('sign'), bad = count('bad'), na = count('na');
  return {allMatch: checks.length > 0 && ok === checks.length,
    text: `${ok}/${checks.length} simulation comparisons match` +
      (sign ? ` · ${sign} wrong sign` : '') + (bad ? ` · ${bad} differ` : '') + (na ? ` · ${na} unavailable` : '')};
}

export function sampleCurve(fn, plot, parameters, t, count = 480) {
  const points = [];
  for (let i = 0; i <= count; i++) {
    const x = plot.x_min + (plot.x_max - plot.x_min) * i / count;
    const y = fn({...parameters, x, t});
    points.push([x, Number.isFinite(y) ? y : null]);
  }
  return points;
}


/* ── layout: the figure is drawn at its real pixel size, so 12px text is 12px on screen at any pane width ── */
const TEXT = 12, LABEL = 13, GAP = 8;   // tick text and axis/diagram labels in px; keep in step with study.css
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const textWidth = (s, px = TEXT) => [...String(s)].length * px * .6;   // a deliberately generous estimate
const SUB = /_(\{([^}]*)\}|([A-Za-z0-9]+))/g;   // U_eff, v_{rel}
const plain = s => String(s ?? '').replace(SUB, '$2$3');
const richHTML = s => esc(s).replace(SUB, (m, g, a, b) => `<sub>${a ?? b}</sub>`);
const richSVG = s => esc(s).replace(SUB, (m, g, a, b) => `<tspan baseline-shift="sub" font-size="80%">${a ?? b}</tspan>`);
const fit = (s, px, room) => { const t = String(s ?? ''); if (textWidth(plain(t), px) <= room) return t; const n = Math.max(4, Math.floor(room / (px * .6)) - 1); return [...t].slice(0, n).join('') + '…'; };
const svgLabel = (s, px, room, attrs) => { const t = fit(s, px, room); return `<text ${attrs}>${t !== String(s) ? `<title>${esc(plain(s))}</title>` : ''}${richSVG(t)}</text>`; };

/* 1, 2, 2.5 or 5 × 10^k: the smallest such step giving at most maxCount intervals */
export function niceStep(range, maxCount) {
  const raw = range / Math.max(1, maxCount), mag = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * mag >= raw * (1 - 1e-9)) return m * mag;
  return 10 * mag;
}
const digitsFor = step => { const e = Math.floor(Math.log10(step) + 1e-9); return Math.max(0, -e + (Math.abs(step / 10 ** e - 2.5) < 1e-9 ? 1 : 0)); };
export function niceTicks(min, max, maxCount) {
  if (!(max > min)) return {step: 1, digits: 0, ticks: [min]};
  const step = niceStep(max - min, maxCount), digits = digitsFor(step), ticks = [];
  for (let i = Math.ceil(min / step - 1e-9); i <= Math.floor(max / step + 1e-9); i++) ticks.push(Number((i * step).toFixed(digits)));
  return {step, digits, ticks};
}
export const tickText = (v, digits) => { if (Math.abs(v) < 10 ** -(digits + 1)) v = 0; return Math.abs(v) >= 1e5 || (v !== 0 && Math.abs(v) < 1e-4) ? num(v) : v.toFixed(digits).replace('-', '−'); };

/* A range input moves over whole indices 0..n so both ends are exact; a float step can stop short of max (3.987 of 4). */
export function sliderScale(p) {
  const span = p.max - p.min;
  if (!(span > 0)) return {n: 0, value: () => p.min, index: () => 0};
  const step = niceStep(span, 250), n = Math.round(span / step);
  if (Math.abs(n * step - span) <= span * 1e-9) { const d = digitsFor(step) + 2;
    return {n, value: i => i >= n ? p.max : i <= 0 ? p.min : Number((p.min + i * step).toFixed(d)), index: v => clamp(Math.round((v - p.min) / step), 0, n)}; }
  return {n: 300, value: i => i >= 300 ? p.max : i <= 0 ? p.min : Number((p.min + span * i / 300).toPrecision(6)), index: v => clamp(Math.round((v - p.min) / span * 300), 0, 300)};
}

/* Equal units on both axes: one scale k (px per unit), centred in the box, so a 45° light line stays at 45°. */
export function diagramFit(d, box) {
  const dx = d.x_max - d.x_min, dy = d.y_max - d.y_min, k = Math.min((box.R - box.L) / dx, (box.B - box.U) / dy);
  const ox = (box.L + box.R) / 2 - (d.x_min + dx / 2) * k, oy = (box.U + box.B) / 2 + (d.y_min + dy / 2) * k;
  return {k, X: x => ox + x * k, Y: y => oy - y * k};
}

/* Greedy label placement: each label takes the first candidate spot (in preference order) that is clear of earlier
   labels and marks (shapes, and lines at half weight) and needs no pulling in from the figure's edge; otherwise the
   spot with the least overlap and pull. Fixed author labels (spots of length 1) are placed first. */
export function placeLabels(items, W, H, marks = []) {
  const placed = [], area = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const order = items.map((item, i) => i).sort((a, b) => (items[a].spots.length > 1) - (items[b].spots.length > 1)), out = [];
  for (const i of order) { const item = items[i];
    const w = textWidth(plain(item.text), LABEL); let best = null;
    for (const [cx0, by0] of item.spots) {
      const cx = clamp(cx0, w / 2 + 3, W - w / 2 - 3), by = clamp(by0, LABEL + 2, H - 4);
      const box = {x0: cx - w / 2, y0: by - LABEL, x1: cx + w / 2, y1: by + 4};
      // two labels touching edge to edge read as one ("L mg"): a little clearance round each placed label also costs
      const score = placed.reduce((s, b) => s + 20 * area(box, b) + 8 * area(box, {x0: b.x0 - GAP, y0: b.y0 - GAP / 2, x1: b.x1 + GAP, y1: b.y1 + GAP / 2}), 0) + marks.reduce((s, b) => s + (b.w ?? .5) * area(box, b), 0) + 4 * (Math.abs(cx - cx0) + Math.abs(by - by0));
      if (!best || score < best.score) best = {x: cx, y: by, box, score};
      if (!score) break;
    }
    placed.push(best.box); out[i] = {...item, ...best};
  }
  return out;
}

export class StudyView {
  constructor(host, compileExpr, onChange) {
    this.host = host; this.compileExpr = compileExpr; this.onChange = onChange;
    this.parameters = {}; this.highlight = []; this.lastT = null; this.version = 0;
    // the pane can be resized, expanded or narrowed at any time: redraw at the new pixel size
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { if (this.svg && !this.host.hidden && this.boxKey() !== this.drawnBox) this.draw(this.lastT || 0, true); }).observe(host);
  }
  load(tutor) {
    this.tutor = tutor; this.visual = tutor.visualization; this.parameters = {};
    this.curves = []; this.error = null; this.fixedRange=null; this.clipped=false; this.mapping=null; this.plotViewport=null; this.plotDrag=null; this.panPlot=false;
    this.host.classList.toggle('is-prepared', !!this.prepared && this.visual.kind === 'diagram');   // a guide's authored figure: dark paper, short caption
    this.host.classList.toggle('is-diagram', this.visual.kind === 'diagram');
    this.host.classList.toggle('is-plot', this.visual.kind === 'plot');
    this.host.classList.remove('is-plot-panning');
    const plot = this.visual.plot;
    if (this.visual.kind === 'plot' && plot) {
      for (const p of plot.parameters) this.parameters[p.name] = p.value;
      try { this.curves = plot.curves.map((c,i) => ({...c, color:plotColor(c.color,i), fn:this.compileExpr(c.expression)}));
        const values=[];
        for(let timeIndex=0;timeIndex<=(plot.duration>0?16:0);timeIndex++)for(const curve of this.curves)for(const point of sampleCurve(curve.fn,plot,this.parameters,plot.duration*timeIndex/16,240))if(Number.isFinite(point[1]))values.push(point[1]);
        values.sort((a,b)=>a-b);if(values.length){const low=values[Math.floor((values.length-1)*.005)],high=values[Math.floor((values.length-1)*.995)],pad=Math.max((high-low)*.12,Math.abs(high)*.04,1e-6);this.fixedRange=[plot.y_min??low-pad,plot.y_max??high+pad];}
      }
      catch (e) { this.error = e.message; }
    }
    this.host.hidden = false;
    this.host.innerHTML = `<div class="study-head"><span class="study-type">${esc(tutor.domain)} · ${this.visual.kind === 'plot' ? 'equation view' : this.visual.kind === 'diagram' ? 'schematic' : this.visual.kind === 'circuit' ? (this.visual.circuit?.solution ? 'circuit · solved by the app' : 'circuit') : 'explanation'}</span><h1>${esc(tutor.title)}</h1><p>${esc(this.visual.caption || tutor.restatement)}</p></div>` +
      `<div class="study-paper"><svg class="study-svg" role="img" aria-label="${esc(this.visual.caption || tutor.title)}"></svg><div class="study-axis-details" role="note" aria-label="Full axis labels" hidden></div><div class="study-empty" hidden></div></div>` +
      `<div class="study-controls"></div><div class="study-status" aria-live="polite"></div>`;
    this.svg = this.host.querySelector('svg');
    const controls = this.host.querySelector('.study-controls');
    if (this.visual.kind === 'plot' && plot) {
      // the default legend names each curve in words; the parser expressions stay available, folded away
      if (this.curves.length) this.host.querySelector('.study-paper').insertAdjacentHTML('beforeend', `<div class="study-legend">${this.curves.map(c => `<div title="${esc('Plotted as ' + c.expression)}"><i style="background:${c.color}"></i><span>${richHTML(c.label)}</span></div>`).join('')}` +
        `<details class="study-expr"><summary>Plotted expressions</summary>${this.curves.map(c => `<div><i style="background:${c.color}"></i><code>${esc(c.expression)}</code></div>`).join('')}</details></div>`);
      this.scales = plot.parameters.map(sliderScale);
      controls.innerHTML = plot.parameters.map((p,i) => { const s = this.scales[i], fixed = !(p.max > p.min);
        return `<label class="study-param"><span>${esc(p.label || p.name)} <output>${num(p.value)} ${esc(p.units)}${fixed?' · fixed':''}</output></span><input type="range" data-param="${i}" min="0" max="${s.n}" step="1" value="${s.index(p.value)}" ${fixed?'disabled':''} aria-label="${esc(p.label || p.name)}" aria-valuetext="${esc(num(p.value)+' '+(p.units||''))}"></label>`; }).join('') + (plot.parameters.some(p=>p.max>p.min) ? `<button class="hbtn" data-reset>${controlIcon('reset')} Reset values</button>` : '');
      controls.querySelectorAll('input').forEach(input => input.addEventListener('input', () => {
        const i = +input.dataset.param, p = plot.parameters[i], value = this.scales[i].value(+input.value);
        this.parameters[p.name] = value;
        input.parentNode.querySelector('output').textContent = num(value)+' '+p.units; input.setAttribute('aria-valuetext', num(value)+' '+(p.units||''));
        this.version++; this.onChange(true); this.draw(this.lastT || 0, true);
      }));
      controls.querySelector('[data-reset]')?.addEventListener('click', () => {this.load(tutor); this.version++; this.onChange(false);});
      controls.insertAdjacentHTML('beforeend', `<div class="study-plot-tools" role="group" aria-label="Graph view"><button type="button" data-plot-action="pan" aria-pressed="false">Pan</button><button type="button" data-plot-action="in" aria-label="Zoom in graph">+</button><button type="button" data-plot-action="out" aria-label="Zoom out graph">−</button><button type="button" data-plot-action="reset">${controlIcon('reset')} Reset view</button><small>Pan to move · focus graph to scroll-zoom</small></div>`);
      controls.querySelectorAll('[data-plot-action]').forEach(b=>b.addEventListener('click',()=>this.plotAction(b.dataset.plotAction)));
      this.svg.setAttribute('tabindex','0');
      this.svg.addEventListener('keydown', e=>{
        const pan={ArrowLeft:{dx:-.1},ArrowRight:{dx:.1},ArrowUp:{dy:.1},ArrowDown:{dy:-.1}}[e.key];
        if(pan){e.preventDefault();e.stopPropagation();this.movePlot(pan);}
        else if(['+','=','-','Home'].includes(e.key)){e.preventDefault();e.stopPropagation();this.plotAction(e.key==='Home'?'reset':e.key==='-'?'out':'in');}
      });
      this.svg.addEventListener('pointerdown', e=>{
        if(e.button!==0)return;this.svg.focus({preventScroll:true});
        if(!this.panPlot || !this.mapping)return;
        this.plotDrag={id:e.pointerId,x:e.clientX,y:e.clientY,range:this.plotBounds(),box:this.svg.getBoundingClientRect(),mapping:this.mapping};
        this.svg.setPointerCapture(e.pointerId);this.svg.querySelector('.probe')?.remove();e.preventDefault();
      });
      const stop=e=>{if(this.plotDrag?.id===e.pointerId)this.plotDrag=null;};
      this.svg.addEventListener('pointerup',stop);this.svg.addEventListener('pointercancel',stop);this.svg.addEventListener('lostpointercapture',stop);
      this.svg.addEventListener('pointermove', e => {
        const drag=this.plotDrag;
        if(drag?.id===e.pointerId){const m=drag.mapping;
          this.plotViewport=plotRange(drag.range,{dx:-(e.clientX-drag.x)/drag.box.width*m.W/(m.R-m.L),dy:(e.clientY-drag.y)/drag.box.height*m.H/(m.B-m.U)});
          this.draw(this.lastT||0,true);
        } else if(!this.panPlot)this.probe(e);
      });
      this.svg.addEventListener('wheel',e=>{
        if(!this.mapping || !(this.panPlot || this.svg.matches(':focus') || e.ctrlKey || e.metaKey))return;
        e.preventDefault();const m=this.mapping,b=this.svg.getBoundingClientRect();
        this.movePlot({scale:Math.exp(clamp(e.deltaY,-200,200)*.002),anchorX:((e.clientX-b.left)/b.width*m.W-m.L)/(m.R-m.L),anchorY:1-((e.clientY-b.top)/b.height*m.H-m.U)/(m.B-m.U)});
      },{passive:false});
      this.svg.addEventListener('pointerleave', () => this.svg.querySelector('.probe')?.remove());
    }
    this.draw(0, true);
  }
  plotBounds() {
    const p=this.visual.plot,m=this.mapping;
    return {x_min:this.plotViewport?.x_min??p.x_min,x_max:this.plotViewport?.x_max??p.x_max,y_min:m.ymin,y_max:m.ymax};
  }
  movePlot(options) {if(!this.mapping)return;this.plotViewport=plotRange(this.plotBounds(),options);this.draw(this.lastT||0,true);}
  plotAction(action) {
    if(action==='pan'){
      this.panPlot=!this.panPlot;this.host.classList.toggle('is-plot-panning',this.panPlot);
      this.host.querySelector('[data-plot-action=pan]')?.setAttribute('aria-pressed',String(this.panPlot));return;
    }
    if(action==='reset'){
      this.plotViewport=null;this.plotDrag=null;this.panPlot=false;this.host.classList.remove('is-plot-panning');
      this.host.querySelector('[data-plot-action=pan]')?.setAttribute('aria-pressed','false');this.draw(this.lastT||0,true);
    }
    else if(action==='in'||action==='out')this.movePlot({scale:action==='in'?.8:1.25});
  }
  /* the values actually drawn now (not the lesson's starting values), for the tutor; null without a plot */
  paramState() {
    const plot = this.visual?.kind === 'plot' ? this.visual.plot : null; if (!plot) return null;
    const parameters = {}; for (const p of plot.parameters) parameters[p.name] = this.parameters[p.name];
    return { parameters, parameters_changed: plot.parameters.some(p => this.parameters[p.name] !== p.value) };
  }
  /* a tutor's bounded edit: known names only, clamped to the slider's range; returns what was applied */
  setParameters(values = {}) {
    const plot = this.visual?.kind === 'plot' ? this.visual.plot : null, applied = {}; if (!plot || !this.svg) return applied;
    plot.parameters.forEach((p, i) => {
      const v = values[p.name]; if (typeof v !== 'number' || !Number.isFinite(v) || !(p.max > p.min)) return;
      const value = Math.min(p.max, Math.max(p.min, v)); this.parameters[p.name] = applied[p.name] = value;
      const input = this.host.querySelector(`input[data-param="${i}"]`); if (!input) return;
      input.value = this.scales[i].index(value); input.parentNode.querySelector('output').textContent = num(value) + ' ' + p.units; input.setAttribute('aria-valuetext', num(value) + ' ' + (p.units || ''));
    });
    if (Object.keys(applied).length) { this.version++; this.draw(this.lastT || 0, true); }
    return applied;
  }
  setStep(step) {
    this.highlight = step.highlight || [];
    for (const action of step.actions || []) if (action.type === 'highlight') this.highlight = action.items || [];
    this.draw(this.lastT || 0, true);
  }
  hide() { this.host.hidden = true; }
  /* the paper's inner width in px and the tallest figure that still leaves room for the legend and controls */
  boxKey() { return (this.svg?.parentNode?.clientWidth || 0) + 'x' + (this.host.clientHeight || 0); }
  measure() {
    const paper = this.svg.parentNode, cs = getComputedStyle(paper), W = Math.floor(paper.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
    // Inline static figures flow with the chat. Their own rendered height must
    // not feed back into the next resize measurement and shrink the image.
    const framedDiagram=this.visual?.kind==='diagram'&&this.host.closest?.('.lr-visual');
    const room = framedDiagram ? this.host.clientHeight-12 : this.host.classList.contains('is-inline-static') ? W * .62 : this.host.clientHeight ? this.host.clientHeight - 130 : 460;
    this.drawnBox = this.boxKey();
    return {W: W > 120 ? W : 900, maxH: clamp(room, 220, 520)};
  }
  size(W, H, viewBox = `0 0 ${W} ${H}`) { this.svg.setAttribute('viewBox', viewBox); this.svg.style.height = H + 'px'; }
  draw(t, force = false) {
    if (!this.visual || this.host.hidden || (!force && t === this.lastT)) return;
    this.lastT = t;
    const status = this.host.querySelector('.study-status');
    try {
      if (this.error) throw new Error(this.error);
      if (this.visual.kind === 'plot') this.drawPlot(t);
      else if (this.visual.kind === 'diagram') this.drawDiagram();
      else if (this.visual.kind === 'circuit') { this.svg.hidden = false; const {W, maxH} = this.measure(); this.size(W, Math.round(Math.min(maxH, W * .6)), '0 0 900 540'); drawCircuit(this.svg, this.visual.circuit, { highlight: this.highlight }); }
      else {
        this.svg.hidden = true;
        const empty = this.host.querySelector('.study-empty'); empty.hidden = false;
        empty.innerHTML = `<span class="study-type">${this.tutor.status === 'needs_clarification' ? 'Clarification needed' : 'Reason it through'}</span><h2>${this.tutor.status === 'needs_clarification' ? 'A detail is missing.' : 'Some questions are best explained in words.'}</h2><p>${esc(this.visual.caption || 'Read the worked solution alongside this view.')}</p>`;
      }
      // The diagram's caption already explains its frame and subject. A second
      // generic implementation disclosure underneath only distracts from it.
      status.textContent = this.visual.kind === 'plot' ? 'Curves are evaluated from the displayed equations. The solution itself has not been independently verified.' : this.visual.kind === 'circuit' ? circuitStatus(this.visual.circuit) : '';
      if(this.clipped)status.textContent+=' Some values are outside the fixed vertical range.';
      status.classList.remove('error');
    } catch (e) {
      this.svg.innerHTML = '';
      status.textContent = `Visualization unavailable: ${e.message}. The written solution remains available.`;
      status.classList.add('error');
    }
  }
  drawPlot(t) {
    const p = {...this.visual.plot,...this.plotViewport};
    if (!p || !(p.x_max > p.x_min)) throw new Error('the horizontal range is invalid');
    const samples = this.curves.map(c => sampleCurve(c.fn,p,this.parameters,t));
    const ys = samples.flat().map(pt => pt[1]).filter(Number.isFinite).sort((a,b)=>a-b);
    if (!ys.length) throw new Error('the equations have no finite values in this range');
    // Trim extreme samples for automatic range selection around poles; do not connect across them.
    const lo = ys[Math.floor((ys.length-1)*.01)], hi = ys[Math.floor((ys.length-1)*.99)];
    const pad = Math.max((hi-lo)*.12, Math.abs(hi)*.04, 1e-6);
    let ymin = this.plotViewport?.y_min ?? this.fixedRange?.[0] ?? p.y_min ?? lo-pad, ymax = this.plotViewport?.y_max ?? this.fixedRange?.[1] ?? p.y_max ?? hi+pad;
    if (!(ymax > ymin)) {ymin-=1; ymax+=1;}
    this.clipped=ys[0]<ymin || ys[ys.length-1]>ymax;
    const {W, maxH} = this.measure(), H = Math.round(clamp(W * .62, 220, maxH)); this.size(W, H);
    // margins come from the labels actually drawn; tick density from the pixels available
    const U = p.duration > 0 ? 28 : 14, B = H - (p.x_label ? 46 : 26);
    const yt = niceTicks(ymin, ymax, Math.max(2, Math.floor((B - U) / 34))), ytext = yt.ticks.map(v => tickText(v, yt.digits));
    const L = Math.round(6 + (p.y_label ? LABEL + 12 : 0) + Math.max(...ytext.map(s => textWidth(s))) + 8), R = W - 16;
    let xt;
    for (let count = Math.max(2, Math.floor((R - L) / 46)); ; count--) {
      xt = niceTicks(p.x_min, p.x_max, count);
      const widest = Math.max(...xt.ticks.map(v => textWidth(tickText(v, xt.digits))));
      if (xt.step / (p.x_max - p.x_min) * (R - L) >= widest + 14 || count <= 2) break;
    }
    const X = x => L+(x-p.x_min)/(p.x_max-p.x_min)*(R-L), Y = y => B-(y-ymin)/(ymax-ymin)*(B-U);
    this.mapping={L,R,U,B,X,Y,ymin,ymax,W,H};
    let html=`<rect class="plot-background" width="${W}" height="${H}" fill="${PLOT_THEME.background}"/><defs><clipPath id="study-clip"><rect x="${L}" y="${U}" width="${R-L}" height="${B-U}"/></clipPath></defs>`;
    xt.ticks.forEach(v => { const x = X(v), s = tickText(v, xt.digits), w = textWidth(s);
      html+=`<path d="M${x},${U}V${B}" stroke="${PLOT_THEME.grid}" fill="none"/><text class="tick" x="${clamp(x, w/2+2, W-w/2-2)}" y="${B+18}" text-anchor="middle">${s}</text>`; });
    yt.ticks.forEach((v, i) => { const y = Y(v);
      html+=`<path d="M${L},${y}H${R}" stroke="${PLOT_THEME.grid}" fill="none"/><text class="tick" x="${L-8}" y="${y+4}" text-anchor="end">${ytext[i]}</text>`; });
    html+=`<path d="M${L},${U}V${B}H${R}" stroke="${PLOT_THEME.axis}" fill="none"/>`;
    const xFits = !p.x_label || fit(p.x_label, LABEL, R-L) === String(p.x_label), yFits = !p.y_label || fit(p.y_label, LABEL, B-U) === String(p.y_label);
    if (p.x_label && xFits) html += svgLabel(p.x_label, LABEL, R-L, `x="${(L+R)/2}" y="${H-10}" text-anchor="middle" class="axis-label"`);
    if (p.y_label && yFits) html += svgLabel(p.y_label, LABEL, B-U, `transform="translate(${6+LABEL} ${(U+B)/2}) rotate(-90)" text-anchor="middle" class="axis-label"`);
    // Phones cannot hover an ellipsis. Keep the full angle reference and units visible below a narrow plot.
    const axisDetails = this.host.querySelector('.study-axis-details'), extra = [!xFits && `<div>Horizontal: ${richHTML(p.x_label)}</div>`, !yFits && `<div>Vertical: ${richHTML(p.y_label)}</div>`].filter(Boolean).join('');
    if (axisDetails) { axisDetails.hidden = !extra; if (axisDetails.innerHTML !== extra) axisDetails.innerHTML = extra; }
    if(ymin<0 && ymax>0) html+=`<path d="M${L},${Y(0)}H${R}" stroke="${PLOT_THEME.axis}" stroke-dasharray="4 5"/>`;
    if(p.x_min<0 && p.x_max>0) html+=`<path d="M${X(0)},${U}V${B}" stroke="${PLOT_THEME.axis}" stroke-dasharray="4 5"/>`;
    samples.forEach((points,i)=>{
      const c=this.curves[i]; let d='',last=null;
      for(const [x,y] of points) {
        if(y==null || y<ymin-(ymax-ymin) || y>ymax+(ymax-ymin)) {last=null;continue;}
        const yy=Y(y),jump=last!==null && Math.abs(yy-last)>B-U;
        d+=(last===null||jump?'M':'L')+X(x).toFixed(2)+','+yy.toFixed(2);last=yy;
      }
      const selected=this.highlight.includes(c.id)||this.highlight.includes(c.label);
      html+=`<path class="curve" data-curve="${esc(c.id)}" clip-path="url(#study-clip)" d="${d}" fill="none" stroke="${c.color}" stroke-width="${selected?4:2.6}" stroke-linecap="round"/>`;
    });
    if(p.duration>0) html+=`<text x="${R}" y="${U-10}" text-anchor="end">t = ${num(t)} s</text>`;
    this.svg.innerHTML=html;
  }
  probe(e) {
    if(!this.mapping)return;
    const point=this.svg.createSVGPoint();point.x=e.clientX;point.y=e.clientY;
    const local=point.matrixTransform(this.svg.getScreenCTM().inverse()),m=this.mapping,p={...this.visual.plot,...this.plotViewport};
    const x=p.x_min+(local.x-m.L)/(m.R-m.L)*(p.x_max-p.x_min);
    this.svg.querySelector('.probe')?.remove();
    if(local.x<m.L || local.x>m.R || local.y<m.U || local.y>m.B)return;
    const lines=[`x = ${num(x)}`];
    for(const c of this.curves) {try {const y=c.fn({...this.parameters,x,t:this.lastT||0});lines.push(`${fit(String(c.label).split(/\s+[=:]\s+/)[0], TEXT, 150)}: ${num(y)}`);} catch {} }
    // one value per line, on the side away from the pointer
    const right=local.x<(m.L+m.R)/2, tx=right?m.R-8:m.L+8;
    const g=document.createElementNS('http://www.w3.org/2000/svg','g');g.setAttribute('class','probe');
    g.innerHTML=`<path d="M${local.x},${m.U}V${m.B}" stroke="${PLOT_THEME.probe}" stroke-dasharray="3 4"/><text y="${m.U+16}" text-anchor="${right?'end':'start'}" class="probe-value">${lines.map((s,i)=>`<tspan x="${tx}" dy="${i?16:0}">${richSVG(s)}</tspan>`).join('')}</text>`;
    this.svg.appendChild(g);
  }
  drawDiagram() {
    const d=this.visual.diagram;
    if(!d)throw new Error('no diagram was supplied');
    if(!(d.x_max>d.x_min && d.y_max>d.y_min))throw new Error('the diagram range is invalid');
    // equal units across and up: the height follows the diagram's own aspect within the pane's room
    const {W, maxH} = this.measure(), px = 18, py = 24;
    const H = Math.round(clamp((W - 2*px) * (d.y_max-d.y_min) / (d.x_max-d.x_min) + 2*py, 220, maxH)); this.size(W, H);
    const {k, X, Y} = diagramFit(d, {L: px, R: W - px, U: py, B: H - py});
    this.diagramMap = {k, X, Y, W, H};
    const nodes=Object.fromEntries(d.nodes.map(n=>[n.id,n])), labels=[], marks=[];
    // Filled apparatus belongs behind the vectors. Drawing the car after its
    // forces used to erase every arrow and leave only the labels visible.
    let edgeHTML='', bodyHTML='', pointHTML='';
    let html='<defs><marker id="study-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1L9 5L1 9" fill="none" stroke="context-stroke" stroke-width="1.5"/></marker></defs>';
    for(const edge of d.edges) {
      const a=nodes[edge.from],b=nodes[edge.to];if(!a||!b)continue;
      const selected=this.highlight.includes(edge.id)||this.highlight.includes(edge.label);
      const col=selected?'#ad6942':edge.kind==='ray'?'#5266a6':'#51565f';
      const ax=X(a.x),ay=Y(a.y),bx=X(b.x),by=Y(b.y);
      const path=edge.kind==='wire' && ax!==bx && ay!==by?`M${ax},${ay}H${bx}V${by}`:`M${ax},${ay}L${bx},${by}`;
      edgeHTML+=`<path data-edge="${esc(edge.id)}" d="${path}" fill="none" stroke="${col}" stroke-width="${selected?3:1.7}" stroke-linecap="round" ${['ray','arrow'].includes(edge.kind)?'marker-end="url(#study-arrow)"':''}/>`;
      for(let i=0,n=Math.ceil(Math.hypot(bx-ax,by-ay)/8);i<=n;i++){const x=ax+(bx-ax)*i/(n||1),y=ay+(by-ay)*i/(n||1);marks.push({x0:x-2,y0:y-2,x1:x+2,y1:y+2,w:2});}
      if(edge.label) { const len=Math.hypot(bx-ax,by-ay)||1; let nx=(by-ay)/len, ny=-(bx-ax)/len; if(ny>0){nx=-nx;ny=-ny;}   // the normal pointing up the screen
        const clearance=Math.abs(nx)*textWidth(plain(edge.label),LABEL)/2+Math.abs(ny)*LABEL/2+9;
        const spots=[.5,.35,.65,.2,.8].flatMap(t=>{const x=ax+(bx-ax)*t,y=ay+(by-ay)*t;return [[x+nx*clearance,y+ny*clearance+4],[x-nx*clearance,y-ny*clearance+4]];});
        if(edge.kind==='arrow'){const ux=(bx-ax)/len,uy=(by-ay)/len,lw=textWidth(plain(edge.label),LABEL)/2;   // a short vector's label can sit just past its head
          spots.push([bx+ux*(lw+8),by+uy*(LABEL/2+8)+4]);}
        labels.push({text:edge.label, of:'edge:'+edge.id, spots}); }
    }
    for(const n of d.nodes) {
      const x=X(n.x),y=Y(n.y),w=Math.max(8,(n.width||.3)*k),h=Math.max(8,(n.height||.3)*k);
      const selected=this.highlight.includes(n.id)||this.highlight.includes(n.label),ink=selected?'#ad6942':'#3e485f';
      let shape='';
      if(n.kind==='resistor')shape=`<rect x="${-w/2}" y="${-h/2}" width="${w}" height="${h}" rx="2" fill="#f7f4ee" stroke="${ink}" stroke-width="2"/>`;
      else if(n.kind==='capacitor'||n.kind==='battery')shape=`<rect x="${-w/2}" y="${-h/2-2}" width="${w}" height="${h+4}" fill="#f7f4ee"/><path d="M${-w/5},${-h/2}V${h/2}M${w/5},${n.kind==='battery'?-h/3:-h/2}V${n.kind==='battery'?h/3:h/2}" stroke="${ink}" stroke-width="2.5"/>`;
      else if(n.kind==='lens')shape=`<ellipse rx="${w/2}" ry="${h/2}" fill="#d7e2e5" fill-opacity=".8" stroke="${ink}" stroke-width="1.7"/>`;
      else if(n.kind==='object'||n.kind==='image')shape=`<path d="M0,${h/2}V${-h/2}" stroke="${ink}" stroke-width="3" marker-end="url(#study-arrow)"/>`;
      else if(n.kind==='point'||n.kind==='junction')shape=`<circle r="${n.kind==='junction'?3.5:2.5}" fill="${ink}"/>`;
      else if(n.kind==='circle')shape=`<ellipse rx="${w/2}" ry="${h/2}" fill="#e4e7ef" stroke="${ink}" stroke-width="1.7"/>`;
      else if(n.kind!=='label')shape=`<rect x="${-w/2}" y="${-h/2}" width="${w}" height="${h}" rx="5" fill="#e4e7ef" stroke="${ink}" stroke-width="1.7"/>`;
      const nodeHTML=`<g data-node="${esc(n.id)}" transform="translate(${x} ${y})">${shape}</g>`;
      if(['label','point','junction'].includes(n.kind))pointHTML+=nodeHTML;else bodyHTML+=nodeHTML;
      const point=n.kind==='point'||n.kind==='junction', hw=n.kind==='label'?0:point?4:w/2, hh=n.kind==='label'?0:point?4:h/2;
      const container=n.kind==='block'&&d.nodes.filter(a=>a.id!==n.id&&Math.abs(a.x-n.x)<n.width/2&&Math.abs(a.y-n.y)<n.height/2).length>2;
      if(container){ // a car or room's empty interior is usable label space
        marks.push({x0:x-hw,y0:y-hh,x1:x+hw,y1:y-hh+2},{x0:x-hw,y0:y+hh-2,x1:x+hw,y1:y+hh});
      }else if(n.kind!=='label') marks.push({x0:x-hw,y0:y-hh,x1:x+hw,y1:y+hh});
      // Models often label both an arrow and its endpoint. Keep the arrow's
      // label once; never discard a distinct point name or a different quantity.
      const endpointDuplicate=d.edges.some(e=>e.to===n.id&&e.label&&(n.label===e.label||n.label.startsWith(e.label+':')));
      if(n.label&&!endpointDuplicate) { const lw=textWidth(plain(n.label),LABEL)/2;
        labels.push({text:n.label, of:'node:'+n.id, spots:[[x,n.kind==='label'?y+4:y-hh-8],[x,y+hh+LABEL+4],[x+hw+6+lw,y+4],[x-hw-6-lw,y+4],[x+hw+lw,y-hh-6],[x-hw-lw,y-hh-6],[x+hw+lw,y+hh+LABEL+2],[x-hw-lw,y+hh+LABEL+2]]}); }
    }
    html+=`<g data-diagram-layer="bodies">${bodyHTML}</g><g data-diagram-layer="edges">${edgeHTML}</g><g data-diagram-layer="points">${pointHTML}</g>`;
    for(const l of placeLabels(labels, W, H, marks)) html+=`<text x="${l.x.toFixed(1)}" y="${l.y.toFixed(1)}" text-anchor="middle" class="diagram-label" data-label-for="${esc(l.of)}">${richSVG(l.text)}</text>`;
    this.svg.innerHTML=html;
  }
}
