import { controlIcon } from './icons.js';
import { preparedChrome, nextView, labelView } from './viewer_controls.js';
/* Daily prepared 3D scenes: one authored scene per Daily problem (descriptor from app/daily_visuals.py).
   mountDailyVisual(el, descriptor, {compact}) → { update(descriptor), replay(), resize(), focus(id), applyFocus(binding), destroy() }.
   Natural motion is available during thinking time. Daily answer marks require `dynamics.answer`;
   ordinary book practice can explicitly request its answer-specific Breakdown.
   the physics is in daily_visuals_physics.js.
   Focus states (descriptor.focus, from app/content/focus_states.json) are authored close-ups: a builder returns
   `focus: { anchors, planes, overlays, hide }` and the viewer frames, draws and acknowledges one state at a time.
   Coordinates: three's y up; planar problems lie in the x–y plane, depth z. Lengths are the descriptor's metres. */
import * as THREE from 'three';
import { makeStudio, PALETTE as P, clay, steel, graphite, edges, Arrow3D, dimension, Trail, inkLine, darken } from './studio.js';
import { createProp, disposeProp } from './prop_library.js';
import * as PH from './daily_visuals_physics.js';
import { registerFocusSource, focusDisplayed, bindingFits } from './focus_registry.js';
import { createForceIntent } from './visual_force_intent.js';
import { LabelSpots } from './stage_labels.js';

const TAU = Math.PI * 2, DEG = Math.PI / 180, V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const COLORS = { blue: P.body, sand: P.body2, teal: P.body3, rose: P.body4, steel: P.steel, clay: P.static };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let cssDone = false;
function injectCss() {
  if (cssDone || typeof document === 'undefined') return; cssDone = true;
  if (document.querySelector('link[data-daily-visuals]')) return;
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.dataset.dailyVisuals = '1';
  l.href = new URL('../daily_visuals.css', import.meta.url).href; document.head.appendChild(l);
}

// ── small drawing helpers (everything added goes into ctx.root so destroy frees it) ────────────────────────────
function mesh(parent, geo, mat, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; parent.add(m); return m; }
function bar(parent, a, b, r, mat, segs = 14) {
  const d = b.clone().sub(a), L = d.length(), m = mesh(parent, new THREE.CylinderGeometry(r, r, Math.max(L, 1e-5), segs), mat);
  m.position.copy(a).addScaledVector(d, 0.5); if (L > 1e-9) m.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize()); return m;
}
function setBar(m, a, b) { const d = b.clone().sub(a), L = Math.max(d.length(), 1e-5); m.position.copy(a).addScaledVector(d, 0.5); m.scale.set(1, L / m.geometry.parameters.height, 1); m.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize()); }
const stringMat = () => new THREE.MeshStandardMaterial({ color: 0xD9DDE3, roughness: 0.6, metalness: 0 });
function polyline(parent, pts, mat) { const g = new THREE.BufferGeometry().setFromPoints(pts), l = new THREE.Line(g, mat); if (mat.isLineDashedMaterial) l.computeLineDistances(); l.renderOrder = 26; parent.add(l); return l; }
function dashed(parent, pts, opacity = 0.55, dash = 0.03) { const m = inkLine(opacity, true); m.dashSize = dash; m.gapSize = dash * 0.7; return polyline(parent, pts, m); }
function circlePts(c, r, a0, a1, n, plane = 'xy') { const out = []; for (let i = 0; i <= n; i++) { const t = a0 + (a1 - a0) * i / n, u = Math.cos(t) * r, v = Math.sin(t) * r; out.push(plane === 'xz' ? V(c.x + u, c.y, c.z - v) : V(c.x + u, c.y + v, c.z)); } return out; }
/* an angle arc in the x–y plane at `c` from angle a0 to a1; returns the label point on the bisector */
function arc(parent, c, r, a0, a1, opacity = 0.7) { polyline(parent, circlePts(c, r, a0, a1, 40), inkLine(opacity)); const m = (a0 + a1) / 2; return V(c.x + Math.cos(m) * r * 1.45, c.y + Math.sin(m) * r * 1.45, c.z); }
/* a curved arrow (rotation sense) about axis `axis` through `c`, radius r, sweeping `span` from start angle; ribbon + head */
function curlArrow(parent, c, axis, r, start, span, color, tube) {
  const g = new THREE.Group(); parent.add(g); const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.2, roughness: 0.5 });
  const tor = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, 48, Math.abs(span)), mat); tor.rotation.z = span > 0 ? start : start + span; g.add(tor);
  const end = start + span, head = new THREE.Mesh(new THREE.ConeGeometry(tube * 2.8, tube * 8, 16), mat);
  head.position.set(Math.cos(end) * r, Math.sin(end) * r, 0); head.rotation.z = end + (span > 0 ? 0 : Math.PI); g.add(head);
  g.position.copy(c); g.quaternion.setFromUnitVectors(V(0, 0, 1), axis.clone().normalize()); return g;
}
function floor(parent, x0, x1, depth = 0.7, z = 0) { const f = createProp('support', { kind: 'floor', w: x1 - x0, t: 0.05, d: depth }); f.position.set((x0 + x1) / 2, 0, z); parent.add(f); return f; }
function wall(parent, x, h, depth = 0.7, z = 0) { const w = createProp('support', { kind: 'wall', w: h, t: 0.05, d: depth }); w.position.set(x, h / 2, z); parent.add(w); return w; }
function hingeAt(parent, p, len = 0.12) { const h = createProp('hinge', { L: len, r: 0.016, leaf: false }); h.rotation.x = Math.PI / 2; h.position.copy(p); parent.add(h);
  const plate = mesh(parent, new THREE.BoxGeometry(0.09, 0.012, len * 1.2), graphite(), p.x, 0.006, p.z); edges(plate, 0.2); return h; }
const box3 = (...pts) => new THREE.Box3().setFromPoints(pts);
// a box whose content is round about the vertical axis (a turntable, a cone, a circular path): the camera fits the inscribed
// cylinder, not the square's corners, which would waste about 30 % of the frame around a round scene
const roundBox = (a, b) => Object.assign(box3(a, b), { round: true });

// Body/contact anchors stay physical. A common scale within each diagram preserves force ratios.
// Fixed semantic label columns avoid sorting labels past one another during motion or orbit.
function forceDiagram(ctx, labels, entries, maxLength, radius = maxLength * 0.022) {
  const group = new THREE.Group(); group.name = 'real-forces'; ctx.root.add(group);
  const arrows = entries.map((e, i) => {
    const a = new Arrow3D(group, P[e.color] ?? P.normal, radius); a.g.name = e.name; ctx.arrows.push(a);
    labels.push({text: e.name, at: () => a.tip.clone(), cls: 'sym', c: e.color, group:a.g,
      col: e.side === 'left' ? 'force-left' : 'force-right', colSide: e.side, colOrder: e.order ?? i});
    return a;
  });
  const vec = e => typeof e.vector === 'function' ? e.vector() : e.vector, atOf = e => typeof e.at === 'function' ? e.at() : e.at;
  let scale = 1, breakdown = null; const splits = [];
  const update = () => {
    const forces = entries.map(vec);
    scale = maxLength / Math.max(1e-12, ...forces.map(f => f.length()));
    arrows.forEach((a, i) => a.update(atOf(entries[i]), forces[i], forces[i].length() * scale));
    splits.forEach(f => f());
  };
  /* Breakdown: one force resolved along two perpendicular axes, head to tail from its tail at this diagram's scale
     (thinner, lighter). The group sits inside the force group, so it shows only with Forces and only when Breakdown is on. */
  const split = (name, axes) => {
    const e = entries.find(x => x.name === name); if (!e) return;
    if (!breakdown) { breakdown = new THREE.Group(); breakdown.name = 'breakdown'; breakdown.visible = false; group.add(breakdown); }
    const parts = axes.map(ax => { const a = new Arrow3D(breakdown, P[e.color] ?? P.normal, radius * 0.7, { opacity: 0.85 }), mid = V(); ctx.arrows.push(a);
      labels.push({ text: ax.text, at: () => mid.clone(), cls: 'sym', c: e.color, group: a.g, px: ax.px }); return { a, ax, mid }; });
    const place = () => { const f = vec(e), from = atOf(e).clone();
      for (const q of parts) { const u = (typeof q.ax.dir === 'function' ? q.ax.dir() : q.ax.dir).clone().normalize(), c = f.dot(u);
        q.a.update(from, u.clone().multiplyScalar(c < 0 ? -1 : 1), Math.abs(c) * scale); q.mid.copy(from).addScaledVector(u, c * scale / 2); from.addScaledVector(u, c * scale); } };
    splits.push(place); place();
  };
  update();
  return {group, update, split, get breakdown() { return breakdown; }, key: entries.map(e => ({sym:e.name, text:e.text, c:e.color, k:'arrow'})),
    snapshot: () => entries.map((e, i) => ({name:e.name, at:(typeof e.at === 'function' ? e.at() : e.at).toArray(),
      vector:(typeof e.vector === 'function' ? e.vector() : e.vector).toArray(), tip:arrows[i].tip.toArray()}))};
}

/* a basketball: orange body, dark seams (equator, one meridian and two side curves) */
function basketball(parent, r) {
  const g = new THREE.Group(); parent.add(g); mesh(g, new THREE.SphereGeometry(r, 48, 32), clay(0xD9783F, { roughness: 0.85 }));
  const seam = clay(0x1E1B19, { roughness: 0.7 }), t = r * 0.022;
  mesh(g, new THREE.TorusGeometry(r * 1.001, t, 6, 96), seam).rotation.x = Math.PI / 2;
  mesh(g, new THREE.TorusGeometry(r * 1.001, t, 6, 96), seam);
  for (const s of [1, -1]) { const k = mesh(g, new THREE.TorusGeometry(r * 0.78, t, 6, 96), seam); k.position.x = s * r * 0.627; k.rotation.y = Math.PI / 2; }
  g.rotation.set(0.35, 0.5, 0.15); return g;
}
/* a tennis ball: felt yellow-green with the curved white seam */
function tennisBall(parent, r) {
  const g = new THREE.Group(); parent.add(g); mesh(g, new THREE.SphereGeometry(r, 40, 28), clay(0xC9DB57, { roughness: 0.95 }));
  const pts = []; for (let i = 0; i <= 160; i++) { const t = i / 160 * TAU, a = 0.75, b = 0.25, v = V(a * Math.cos(t) + b * Math.cos(3 * t), a * Math.sin(t) - b * Math.sin(3 * t), 2 * Math.sqrt(a * b) * Math.sin(2 * t)); pts.push(v.normalize().multiplyScalar(r * 1.003)); }
  mesh(g, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 160, r * 0.045, 6, true), clay(0xF2F2EA)); g.rotation.set(0.6, 0.2, 0.4); return g;
}
/* a slotted lab weight: cylinder whose height ∝ mass, with a hook eye on top; origin at its bottom centre */
function labWeight(parent, mass, color, rad = 0.05) {
  const g = new THREE.Group(); parent.add(g); const h = 0.06 + 0.045 * mass;
  edges(mesh(g, new THREE.CylinderGeometry(rad, rad, h, 48), clay(color), 0, h / 2, 0), 0.25, 30);
  mesh(g, new THREE.CylinderGeometry(rad * 0.97, rad * 0.97, 0.004, 48), clay(darken(color, 0.25)), 0, h * 0.62, 0);
  const eye = mesh(g, new THREE.TorusGeometry(0.011, 0.0028, 8, 24), steel()); eye.position.y = h + 0.011;
  g.userData.h = h + 0.022; return g;
}

let haloTex = null;
function haloTexture() {
  if (haloTex) return haloTex; const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  x.strokeStyle = '#fff'; x.lineWidth = 5; x.globalAlpha = 0.9; x.beginPath(); x.arc(32, 32, 26, 0, TAU); x.stroke();
  haloTex = new THREE.CanvasTexture(c); haloTex.colorSpace = THREE.SRGBColorSpace; return haloTex;
}

// ── scene builders: (ctx, params, variant) → { box, views, labels, dyn? } ──────────────────────────────────────
const B = {};

B.ball_stack = (ctx, p) => {
  const { root } = ctx, balls = p.balls, xs = 0, n = balls.length;
  const R1 = balls[0].r, poleX = -R1 - 0.3;
  floor(root, poleX - 0.15, R1 + 0.3, 0.45);
  let y = p.h; const meshes = balls.map(b => {
    const g = b.color === 'basketball' ? basketball(root, b.r) : b.color === 'tennis' ? tennisBall(root, b.r)
      : (() => { const s = createProp('sphere', { r: b.r, color: COLORS[b.color] ?? P.body, sectors: 8 }); root.add(s); return s; })();
    g.traverse(o => { o.castShadow = false; });   // a high ball's shadow would land off the floor slab, on the bare ground plane
    g.position.set(xs, y + b.r, 0); const bottom = y; y += 2 * b.r + p.gap; return { g, b, bottom };
  });
  const top = y;
  // measuring pole: 0.25 m ticks give the drop a real scale
  const poleTop = Math.max(top, p.h + 0.4) + 0.08;
  bar(root, V(poleX, 0, -0.12), V(poleX, poleTop, -0.12), 0.007, steel(darken(P.steel, 0.2))).castShadow = false;
  for (let k = 0; k * 0.25 <= poleTop; k++) bar(root, V(poleX, k * 0.25, -0.12), V(poleX + (k % 4 ? 0.025 : 0.05), k * 0.25, -0.12), 0.0028, steel());
  const hd = dimension(root, V(-R1 - 0.02, 0, 0), V(-R1 - 0.02, p.h, 0), V(-0.11, 0, 0));
  const last = meshes[n - 1];
  const labels = [{ text: 'h', at: hd.mid, px: [-9, 0], cls: 'sym', group: hd.group }];
  // d (or ℓ) continues the h dimension on the left, so the right side stays free for the ball names
  const dd = dimension(root, V(-R1 - 0.02, p.h, 0), V(-R1 - 0.02, last.bottom, 0), V(-0.11, 0, 0)); labels.push({ text: n === 2 ? 'd' : 'ℓ', at: dd.mid, px: [-9, 0], cls: 'sym', group: dd.group });
  // ball names: one column right of the stack, spread to a legible spacing, each with a short leader to its ball
  meshes.forEach(({ g, b }) => labels.push({ text: b.name, at: () => g.position.clone().add(V(b.r, 0, 0)), col: 'balls', c: b.color }));
  labels.push({ text: '1 m', at: V(poleX - 0.06, 1, -0.12), cls: 'dim' });
  const gravity = forceDiagram(ctx, labels, meshes.map(({g,b},i)=>({name:b.name+'g',color:'weight',text:'Weight during free flight; collisions are instantaneous impulses',
    at:()=>g.position.clone(),vector:V(0,-b.m*9.81,0),side:'left',order:n-1-i})),0.2,0.004);
  const box = box3(V(poleX - 0.1, 0, -0.3), V(R1 + 0.2, top + 0.05, 0.3));
  /* Breakdown (velocity, after the solution): at the collision that launches the top ball, its speed is the speed of the
     ball below plus their relative speed, reversed by the elastic bounce: 3v = v + 2v for two balls, (2ⁿ − 1)v =
     (2ⁿ⁻¹ − 1)v + 2ⁿ⁻¹v for n (book limit). Head to tail beside the stack at the collision height, with the total beside it. */
  const vsplit = new THREE.Group(); vsplit.name = 'breakdown'; vsplit.visible = false; root.add(vsplit);
  const kv = k => k === 1 ? 'v' : k + 'v', kb = 2 ** (n - 1) - 1, kr = 2 ** (n - 1);
  const vParts = [kb ? kv(kb) : null, kv(kr), kv(kb + kr)].map((text, i) => { if (!text) return null; const a = new Arrow3D(vsplit, P.velocity, i === 2 ? 0.006 : 0.0045, { opacity: i === 2 ? 1 : 0.85 }), mid = V(); ctx.arrows.push(a);
    labels.push({ text, at: () => mid.clone(), px: [i === 2 ? 16 : -16, 0], cls: 'sym', c: 'velocity', group: a.g }); return { a, mid }; });
  const breakdown = { groups: [vsplit], kinematic: true, answer: true, title: n === 2 ? 'Launch speed of B2: 3v = v (B1 rising) + 2v (their closing speed, reversed by the bounce)' : `Launch speed of the top ball: (2ⁿ − 1)v = (2ⁿ⁻¹ − 1)v (the ball below) + 2ⁿ⁻¹v (their closing speed, reversed)` };
  const dyn = (d, answer) => {
    const sim = PH.elasticStack({ balls, h: p.h, gap: p.gap, g: d.params.g, duration: d.params.duration, model: d.params.model });
    const topBall = meshes[n - 1], topR = topBall.b.r;
    let maxTop = 0, tPeak = 0; for (let t = 0; t <= sim.duration; t += 0.005) { const yt = sim.at(t).y[n - 1] + 2 * topR; if (yt > maxTop) { maxTop = yt; tPeak = t; } }
    // where the top ball is launched: the collision that sends it up fastest (its bottom's height then)
    let tLaunch = 0, vLaunch = -Infinity; for (const e of sim.events) { const v = sim.at(e.t + 1e-7).v[n - 1]; if (v > vLaunch) { vLaunch = v; tLaunch = e.t; } }
    const yStart = last.bottom, yLaunch = sim.at(tLaunch + 1e-7).y[n - 1], yPeak = maxTop - 2 * topR;
    { const after = sim.at(tLaunch + 1e-7).v, vb = n > 1 ? after[n - 2] : 0, vt = after[n - 1], k = 0.5 * p.h / Math.max(1e-9, Math.abs(vt)), x = R1 + 0.09, base = V(x, yLaunch, 0.02);
      const [pb, pr, pt] = vParts, up = V(0, 1, 0);
      if (pb) { pb.a.update(base, up.clone().multiplyScalar(Math.sign(vb) || 1), Math.abs(vb) * k); pb.mid.copy(base).add(V(0, vb * k / 2, 0)); }
      const from = base.clone().add(V(0, vb * k, 0)); pr.a.update(from, up.clone().multiplyScalar(Math.sign(vt - vb) || 1), Math.abs(vt - vb) * k); pr.mid.copy(from).add(V(0, (vt - vb) * k / 2, 0));
      const tb = V(x + 0.07, yLaunch, 0.02); pt.a.update(tb, up.clone().multiplyScalar(Math.sign(vt) || 1), Math.abs(vt) * k); pt.mid.copy(tb).add(V(0, vt * k / 2, 0));
      breakdown.off = d.params.model !== 'book'; }
    const trail = new Trail(root, COLORS[topBall.b.color] ?? (topBall.b.color === 'tennis' ? 0xC9DB57 : P.body3), 400); trail.visible = false;
    // the book's answer height for the top ball's bottom, ℓ + (2ⁿ − 1)²h (d + 9h for two balls): after the solution only
    const k2 = (2 ** n - 1) ** 2, Hb = (last.bottom - p.h) + k2 * p.h, mark = new THREE.Group(); root.add(mark); mark.visible = false;
    if (answer && d.params.model === 'book') { dashed(mark, [V(-0.35, Hb, 0), V(0.35, Hb, 0)], 0.7, Math.max(0.06, Hb / 150)); labels.push({ text: n === 2 ? 'd + 9h' : `ℓ + ${k2}h`, at: V(-0.35, Hb, 0), px: [-34, 0], cls: 'sym', group: mark }); }
    // the measuring pole continues up during the motion: hairline ticks at a step that keeps about eight labels
    const poleUp = new THREE.Group(); root.add(poleUp); poleUp.visible = false; const upTo = Math.max(2, maxTop * 1.05);
    const step = [1, 2, 5, 10, 20, 25, 50, 100].find(s => upTo / s <= 9) || 100, tickM = new THREE.LineBasicMaterial({ color: P.steel, transparent: true, opacity: 0.8 });
    polyline(poleUp, [V(poleX, poleTop, -0.12), V(poleX, upTo, -0.12)], tickM);
    for (let k = step; k <= upTo; k += step) { polyline(poleUp, [V(poleX, k, -0.12), V(poleX + 0.09 * Math.max(1, step / 2), k, -0.12)], tickM); if (!(answer && Math.abs(k - Hb) < 0.07 * upTo)) labels.push({ text: k + ' m', at: V(poleX, k, -0.12), px: [-20, 0], cls: 'dim', height: true, group: poleUp }); }
    // a screen-sized halo keeps the small top ball findable when the frame is metres tall
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture(), color: topBall.b.color === 'tennis' ? 0xC9DB57 : COLORS[topBall.b.color] ?? P.body3, sizeAttenuation: false, depthTest: false, transparent: true })); halo.scale.set(0.024, 0.024, 1); halo.renderOrder = 40; root.add(halo); halo.visible = false;
    // Whole flight is the reading frame: one fixed box from the ground to the peak (it does not grow as the ball climbs), a ground
    // wide enough to read as the ground at that scale, and the top ball's start, launch and peak heights on the pole. The peak
    // height appears once the ball has reached it; the book's formula mark stays behind the solution.
    const half = Math.max(R1 + 0.3, 0.32 * maxTop), wide = box3(V(-half, 0, -0.3), V(half, maxTop * 1.04 + 0.1, 0.3));
    const ground = new THREE.Group(); root.add(ground); ground.visible = false; floor(ground, -2.2 * half, 2.2 * half, Math.min(2 * half, 6)).position.y = -0.002;
    // height marks read off the pole on its far side: the line crosses the ball's path, the value sits right-aligned left of
    // the pole's tick numbers and of the weight-label column, so no ball, ball name or weight label ever passes over it
    const marks = [], heightMark = (y, text, gate) => { const g = new THREE.Group(); root.add(g); g.visible = false; const x1 = poleX + 0.35 * half;
      dashed(g, [V(poleX - 0.25 * half, y, -0.12), V(x1, y, -0.12)], 0.6, Math.max(0.03, maxTop / 160)); labels.push({ text, at: V(poleX, y, -0.12), px: [-42, 0], align: 'right', clearOf: 'force-left', cls: 'dim', height: true, group: g }); marks.push({ g, gate }); };
    heightMark(yStart, `released ${yStart.toFixed(2)} m`, () => true);
    // at this scale a launch just above the ground would crowd the ball names: it is marked only where it reads on its own
    if (Math.min(yLaunch, Math.abs(yLaunch - yStart)) > 0.08 * maxTop) heightMark(yLaunch, `launch ${yLaunch.toFixed(2)} m`, t => t >= tLaunch);
    heightMark(yPeak, `peak ${yPeak.toFixed(1)} m`, t => t >= tPeak - 1e-3);
    let wholeFlight = false, now = 0;
    const showFlight = () => { ground.visible = wholeFlight && now > 0; for (const m of marks) m.g.visible = wholeFlight && now > 0 && m.gate(now); };
    return { duration: sim.duration, defaultCameraMode: 'overview', flight: { yStart, yLaunch, yPeak, tLaunch, tPeak, box: wide },
      cameraMode(mode) { wholeFlight = mode === 'overview'; halo.visible = wholeFlight && topBall.g.position.y > last.bottom + topR; showFlight(); },
      set(t) { now = t; const s = sim.at(t); meshes.forEach(({ g, b }, i) => g.position.set(xs, s.y[i] + b.r, 0)); gravity.update(); trail.visible = poleUp.visible = t > 0; halo.visible = wholeFlight && t > 0; mark.visible = t > 0 && answer; halo.position.copy(topBall.g.position); showFlight();
        trail.clear(); if (t > 0) for (let k = 0; k <= 160; k++) { const u = t * k / 160, q = sim.at(u); trail.push(V(xs, q.y[n - 1] + topR, 0)); } },
      readout: t => `${topBall.b.name} at ${(sim.at(t).y[n - 1]).toFixed(1)} m`,
      // Track the top ball without changing physical scale. Fitting 225 m into a small pane makes a real ball
      // subpixel-sized; Whole flight is available explicitly when the ground-to-peak comparison is useful.
      followLabel: topBall.b.name,
      follow: t => {
        const s = sim.at(t), y = s.y[n - 1] + topR, lift = Math.max(0, s.y[n - 1] - last.bottom);
        const b = box.clone().translate(V(0, lift, 0)), u = Math.min(1, lift / (top * 3)), smooth = u * u * (3 - 2 * u);
        const span = Math.max(0.18, topR * 7), close = box3(V(-span, y - span, -topR * 2), V(span, y + span, topR * 2));
        b.min.lerp(close.min, smooth); b.max.lerp(close.max, smooth); return b;
      },
      // one short ease from the held setup to the fixed whole-flight frame as play begins, then no camera motion at all
      overview: t => { const u = Math.min(1, t / 0.3), k = u * u * (3 - 2 * u), b = box.clone(); b.min.lerp(wide.min, k); b.max.lerp(wide.max, k); return b; },
      hide: [hd.group, dd.group] };
  };
  return { box, views: { setup: [10, 8], side: [0, 3] }, labels, dyn, forceGroups:[gravity.group],forceKey:gravity.key, breakdown,
    forceNote:'Weights during free flight. Ideal impacts are instantaneous impulses, not finite contact forces. At t = 0 the balls are just released.',snapshot:()=>({forces:gravity.snapshot()}) };
};

B.atwood = (ctx, p) => {
  const { root } = ctx, r = p.pulley_r, cy = p.support_y - 0.22, massive = p.pulley_mass > 0, w = Math.max(0.035, r * 0.42);
  floor(root, -0.75, 0.55, 0.7);
  // retort stand: base plate, post, arm; a hanger rod to the pulley's yoke
  const post = -0.35; edges(mesh(root, new THREE.BoxGeometry(0.22, 0.025, 0.28), graphite(), post + 0.05, 0.0125, 0), 0.2);
  bar(root, V(post, 0, 0), V(post, p.support_y + 0.04, 0), 0.01, steel());
  edges(mesh(root, new THREE.BoxGeometry(-post + 0.1, 0.04, 0.05), steel(darken(P.steel, 0.15)), (post + 0.1) / 2, p.support_y, 0), 0.25);
  mesh(root, new THREE.CylinderGeometry(0.03, 0.03, 0.06, 24), steel(darken(P.steel, 0.3)), post, p.support_y, 0);
  bar(root, V(0, p.support_y - 0.02, 0), V(0, cy + r * 1.25 + 0.012, 0), 0.006, steel());
  const yokeTop = cy + r * 1.25, zw = w / 2 + 0.008;
  edges(mesh(root, new THREE.BoxGeometry(0.03, 0.012, 2 * zw + 0.01), steel(darken(P.steel, 0.25)), 0, yokeTop + 0.006, 0), 0.2);
  for (const s of [1, -1]) edges(mesh(root, new THREE.BoxGeometry(0.026, yokeTop - cy + 0.02, 0.006), steel(darken(P.steel, 0.25)), 0, (yokeTop + cy - 0.02) / 2, s * zw), 0.2);
  mesh(root, new THREE.CylinderGeometry(0.005, 0.005, 2 * zw + 0.016, 12), graphite(), 0, cy, 0).rotation.x = Math.PI / 2;
  // pulley: massless → a light steel sheave; massive → a solid uniform disk (spin sectors show it turning)
  const wheel = massive ? createProp('disk', { r, h: w, color: P.body, sectors: 8 }) : createProp('pulley', { r, w, axis: 'z' });
  if (massive) wheel.rotation.x = Math.PI / 2; const spin = new THREE.Group(); spin.position.set(0, cy, 0); spin.add(wheel); root.add(spin);
  // string over the top: a half ring of radius r and two straight runs
  const sm = stringMat(), sr = 0.0028; const over = mesh(root, new THREE.TorusGeometry(r, sr, 6, 48, Math.PI), sm, 0, cy, 0);
  const w1 = labWeight(root, p.m1, P.body2, 0.078), w2 = labWeight(root, p.m2, P.body3, 0.078);
  const s1 = bar(root, V(-r, cy, 0), V(-r, p.y1 + w1.userData.h, 0), sr, sm), s2 = bar(root, V(r, cy, 0), V(r, p.y2 + w2.userData.h, 0), sr, sm);
  const place = (y1, y2) => { w1.position.set(-r, y1, 0); w2.position.set(r, y2, 0); setBar(s1, V(-r, cy, 0), V(-r, y1 + w1.userData.h, 0)); setBar(s2, V(r, cy, 0), V(r, y2 + w2.userData.h, 0)); };
  place(p.y1, p.y2); void over;
  const [l1, l2] = p.labels || ['m1', 'm2'];
  const labels = [{ text: l1, at: () => w1.position.clone().add(V(0, w1.userData.h / 2, 0)), c: 'sand', col:'force-left', colSide:'left', colOrder:1 }, { text: l2, at: () => w2.position.clone().add(V(0, w2.userData.h / 2, 0)), c: 'teal', col:'force-right', colOrder:1 }];
  const release = PH.atwood({...p, pulley_y:cy, clear:Math.max(w1.userData.h,w2.userData.h) + 0.03});
  const fg = forceDiagram(ctx, labels, [
    {name:'T₁', color:'tension', at:()=>w1.position.clone().add(V(0,w1.userData.h,0)), vector:V(0,release.T1,0),side:'left',order:0,text:'String tension on the left mass'},
    {name:l1+'g', color:'weight', at:()=>w1.position.clone().add(V(0,(w1.userData.h-0.022)/2,0)),vector:V(0,-p.m1*9.81,0),side:'left',order:2,text:'Left mass weight'},
    {name:'T₂', color:'tension', at:()=>w2.position.clone().add(V(0,w2.userData.h,0)),vector:V(0,release.T2,0),order:0,text:'String tension on the right mass'},
    {name:l2+'g', color:'weight', at:()=>w2.position.clone().add(V(0,(w2.userData.h-0.022)/2,0)),vector:V(0,-p.m2*9.81,0),order:2,text:'Right mass weight'}
  ],0.28,0.006);
  if (p.pulley_label) labels.push({ text: p.pulley_label, at: V(r + 0.07, cy + r * 0.6, 0) });
  /* Breakdown: each mass's net force, tension minus weight = mass × a, at the block's outer side on the diagram's own scale
     (the native Atwood Breakdown's reading); with a massive pulley T₁ ≠ T₂, and the difference turns it */
  const net = new THREE.Group(); net.name = 'breakdown'; net.visible = false; fg.group.add(net); const fs = 0.28 / Math.max(release.T1, release.T2, p.m1 * 9.81, p.m2 * 9.81);
  const nets = [[w1, release.T1 - p.m1 * 9.81, -1, l1], [w2, release.T2 - p.m2 * 9.81, 1, l2]].map(([w, F, side, l]) => { const a = new Arrow3D(net, P.ink, 0.006, { opacity: 0.9 }), mid = V(); ctx.arrows.push(a);
    labels.push({ text: `${l} a`, at: () => mid.clone(), px: [side * 18, 0], cls: 'sym', c: 'ink', group: a.g }); return { w, F, side, a, mid }; });
  const netUpdate = () => { for (const q of nets) { const from = q.w.position.clone().add(V(q.side * (0.078 + 0.035), q.w.userData.h / 2, 0.02));
    q.a.update(from, V(0, Math.sign(q.F) || 1, 0), Math.abs(q.F) * fs); q.mid.copy(from).add(V(0, q.F * fs / 2, 0)); } };
  netUpdate();
  const box = box3(V(post - 0.17, 0, -0.25), V(0.3, p.support_y + 0.08, 0.25));
  const dyn = d => {
    const sim = PH.atwood({ m1: p.m1, m2: p.m2, pulley_mass: p.pulley_mass || 0, pulley_r: r, y1: p.y1, y2: p.y2, pulley_y: cy, clear:Math.max(w1.userData.h,w2.userData.h)+0.03, floor_y: d.params.floor_y, g: d.params.g });
    return { duration: sim.duration, set(t) { const s = sim.at(t); place(s.y1, s.y2); spin.rotation.z = s.phi; fg.update(); netUpdate(); } };
  };
  return { box, views: { setup: [8, 8], side: [0, 3] }, labels, dyn, forceGroups:[fg.group],forceKey:fg.key,
    breakdown: { groups: [net], title: massive ? `Net force on each mass = mass × a: T₁ − ${l1}g up, ${l2}g − T₂ down; T₁ ≠ T₂, and the difference turns the pulley` : `Net force on each mass = mass × a: T − ${l1}g up, ${l2}g − T down` },
    forceNote: massive ? 'Uniform disk pulley: T₁ and T₂ differ. Free motion ends at the travel limit.' : 'Massless frictionless pulley: T₁ = T₂. Free motion ends at the travel limit.', snapshot:()=>({a:release.a,T1:release.T1,T2:release.T2,forces:fg.snapshot()}) };
};

B.leaning_sticks = (ctx, p) => {
  const { root } = ctx, t = p.theta * DEG, w = p.width, Lr = p.right_len, Ll = Lr * Math.tan(t);
  const top = V(-Lr * Math.cos(t), Lr * Math.sin(t), 0), footR = V(0, 0, 0), footL = V(top.x - Ll * Math.sin(t), 0, 0);
  floor(root, footL.x - 0.3, 0.35, 0.7);
  const uR = top.clone().sub(footR).normalize(), uL = top.clone().sub(footL).normalize();
  const stick = (a, b, color) => { const d = b.clone().sub(a), L = d.length(), s = createProp('beam', { size: [w, L, 0.05], color }); s.position.copy(a).addScaledVector(d, 0.5); s.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize()); root.add(s); return s; };
  // the right stick's end presses on the side of the left stick, which runs on a hair past the corner
  stick(footR.clone().addScaledVector(uR, 0.012), top.clone().addScaledVector(uR, -w / 2), P.body2);
  stick(footL.clone().addScaledVector(uL, 0.012), top.clone().addScaledVector(uL, w * 0.9), darken(P.body2, -0.15));
  hingeAt(root, V(footR.x, 0.016, 0)); hingeAt(root, V(footL.x, 0.016, 0));
  const ang = arc(root, V(0, 0, 0.03), 0.2, Math.PI - t, Math.PI);
  const ra = polyline(root, [top.clone().addScaledVector(V(-uR.x, -uR.y, 0), 0.07), top.clone().addScaledVector(V(-uR.x, -uR.y, 0), 0.07).addScaledVector(V(-uL.x, -uL.y, 0), 0.07), top.clone().addScaledVector(V(-uL.x, -uL.y, 0), 0.07)].map(v => v.setZ(0.03)), inkLine(0.7)); void ra;
  const labels = [{ text: 'θ', at: ang, cls: 'sym' }, { text: 'µ', at: top.clone().add(V(0.02, 0.09, 0)), cls: 'sym' }, { text: 'hinge', at: V(footR.x + 0.05, -0.05, 0), cls: 'dim', avoidForces:true,px:[0,12] }, { text: 'hinge', at: V(footL.x - 0.05, -0.05, 0), cls: 'dim',avoidForces:true,px:[0,12] }];
  const f = PH.leaningSticksForces({theta:t,L:Lr});
  const right = forceDiagram(ctx,labels,[
    {name:'Wᵣ',text:'Right rod weight λgL at its midpoint',color:'weight',at:top.clone().multiplyScalar(0.5),vector:V(0,-f.rightWeight,0),side:'left',order:3},
    {name:'N',text:'Contact normal on the right rod',color:'normal',at:top,vector:V(Math.cos(t),-Math.sin(t),0).multiplyScalar(f.N),order:0},
    {name:'f',text:'Static contact friction on the right rod',color:'friction',at:top,vector:uL.clone().multiplyScalar(f.f),order:1},
    {name:'Hᵣ',text:'Resultant ground hinge reaction on the right rod',color:'normal',at:footR,vector:V(...f.rightHinge),order:4}
  ],Math.min(Lr,Ll)*0.42);
  const left = forceDiagram(ctx,labels,[
    {name:'Wₗ',text:'Left rod weight λgL tan θ at its midpoint',color:'weight',at:top.clone().add(footL).multiplyScalar(0.5),vector:V(0,-f.leftWeight,0),side:'left',order:3},
    {name:'−N',text:'Equal opposite normal on the left rod',color:'normal',at:top,vector:V(-Math.cos(t),Math.sin(t),0).multiplyScalar(f.N),order:0},
    {name:'−f',text:'Equal opposite friction on the left rod',color:'friction',at:top,vector:uL.clone().multiplyScalar(-f.f),order:1},
    {name:'Hₗ',text:'Resultant ground hinge reaction on the left rod',color:'normal',at:footL,vector:V(...f.leftHinge),side:'left',order:4}
  ],Math.min(Lr,Ll)*0.42);
  right.split('N',[{dir:V(1,0,0),text:'N cos θ',px:[0,12]},{dir:V(0,1,0),text:'N sin θ',px:[14,0]}]);
  left.split('−N',[{dir:V(1,0,0),text:'N cos θ',px:[0,-12]},{dir:V(0,1,0),text:'N sin θ',px:[-14,0]}]);
  return { box: box3(V(footL.x - 0.3, -0.25, -0.28), V(0.35, top.y + 0.35, 0.28)), views: { setup: [12, 8], side: [0, 3] }, labels,
    forceGroups:[right.group,left.group],forceTargets:[{label:'Right stick',group:right.group},{label:'Left stick',group:left.group}],forceKey:[...right.key,...left.key],
    breakdown:{ groups:[right.breakdown,left.breakdown], title:'Contact normal split into horizontal N cos θ and vertical N sin θ' },
    forceNote:`Static equilibrium, equal linear density (unequal masses). Requires μ ≥ cot² θ = ${f.muMin.toFixed(2)} at this angle; slipping is not simulated. Select a stick to inspect its forces.`,
    forceCaption:`Equilibrium requires μ ≥ ${f.muMin.toFixed(2)}. Equal density; unequal masses.`,snapshot:()=>({...f,theta:t,rightLength:Lr,leftLength:Ll,rightForces:right.snapshot(),leftForces:left.snapshot()}) };
};

B.propped_ladder = (ctx, p) => {
  const { root } = ctx, t = p.theta * DEG, L = p.L, u = V(Math.cos(t), Math.sin(t), 0), cd = p.l / Math.tan(t), foot = p.l / Math.sin(t);
  const C = u.clone().multiplyScalar(cd), F = V(foot, 0, 0), depth = 0.42, bx = 0.05;
  floor(root, -0.4, Math.max(foot, L * Math.cos(t)) + 0.4, 0.9);
  const lad = createProp('ladder', { size: [bx, L, depth], color: P.body2 });
  // the ladder's underside face rests on the stick: its centre line sits half a rail above the line through the pivot
  const n = V(-Math.sin(t), Math.cos(t), 0); lad.position.copy(u.clone().multiplyScalar(L / 2)).addScaledVector(n, bx / 2); lad.rotation.z = t - Math.PI / 2; root.add(lad);
  // stick: a slim bar from its ground pivot to the ladder, ending in a cross pad under both rails
  const stickMat = steel(P.steel); bar(root, F.clone().setY(0.02), C, 0.012, stickMat);
  const pad = mesh(root, new THREE.CylinderGeometry(0.012, 0.012, depth, 14), stickMat, C.x, C.y, 0); pad.rotation.x = Math.PI / 2;
  hingeAt(root, V(0, 0.016, 0), depth); hingeAt(root, V(F.x, 0.016, 0), 0.1);
  const ang = arc(root, V(0, 0, depth / 2 + 0.02), 0.28, 0, t);
  const dn = V(-u.x, -u.y, 0), sd = F.clone().sub(C).normalize(), q = 0.07, z = depth / 2 + 0.02;
  polyline(root, [C.clone().addScaledVector(dn, q), C.clone().addScaledVector(dn, q).addScaledVector(sd, q), C.clone().addScaledVector(sd, q)].map(v => v.setZ(z)), inkLine(0.7));
  const labels = [{ text: 'θ', at: ang.setZ(depth / 2 + 0.02), cls: 'sym' }, { text: 'L, M', at: u.clone().multiplyScalar(L * 0.62).add(V(-0.14, 0.05, depth / 2)), cls: 'sym' },
    { text: 'ℓ', at: C.clone().add(F).multiplyScalar(0.5).add(V(0.07, 0.06, 0)), cls: 'sym' }, { text: 'pivot', at: V(-0.06, -0.06, depth / 2), cls: 'dim',avoidForces:true,px:[0,12] }, { text: 'pivot', at: V(F.x + 0.05, -0.06, 0), cls: 'dim',avoidForces:true,px:[0,12] }];
  const top = u.clone().multiplyScalar(L);
  const f = PH.proppedLadderForces({theta:t,L,l:p.l});
  const fg = forceDiagram(ctx,labels,[
    {name:'Mg',color:'weight',text:'Uniform ladder weight at its midpoint',at:u.clone().multiplyScalar(L/2),vector:V(0,-f.weight,0),side:'left',order:1},
    {name:'F',color:'normal',text:'Perpendicular force from the massless support stick',at:C,vector:V(...f.support),order:0},
    {name:'H',color:'normal',text:'Resultant reaction at the ladder ground pivot',at:V(),vector:V(...f.hinge),order:2}
  ],L*0.24);
  fg.split('H',[{dir:V(1,0,0),text:'Hx',px:[0,12]},{dir:V(0,1,0),text:'Hy',px:[14,0]}]);
  return { box: box3(V(-0.5, -0.3, -depth / 2 - 0.1), V(Math.max(top.x, F.x) + 0.5, top.y + 0.15, depth / 2 + 0.1)), views: { setup: [12, 10], side: [0, 3] }, labels,forceGroups:[fg.group],forceKey:fg.key,
    breakdown:{ groups:[fg.breakdown], title:'Hinge reaction split into horizontal Hx and vertical Hy' },
    forceNote:'Forces on the ladder in static equilibrium. The massless support transmits force along its length; H is the full hinge reaction.',snapshot:()=>({...f,forces:fg.snapshot()}) };
};

B.spool_thread = (ctx, p) => {
  const { root } = ctx, R = p.R, r = p.r, t = p.theta * DEG;
  floor(root, -0.35, 0.65, 0.5);
  const sp = createProp('spool', { r: R, w: p.width, ri: r * 0.92, rt: r, axis: 'z' }); sp.position.set(0, R, 0); root.add(sp);
  const C = V(0, R, 0), leave = V(r * Math.sin(t), R - r * Math.cos(t), 0), dir = V(Math.cos(t), Math.sin(t), 0), end = leave.clone().addScaledVector(dir, p.pull);
  bar(root, leave, end, 0.0022, stringMat());
  const z = p.width / 2 + 0.004;
  dashed(root, [V(leave.x, leave.y, 0), V(leave.x + 0.2, leave.y, 0)], 0.55, 0.012);
  const ang = arc(root, leave, 0.09, 0, t);
  const rd = V(Math.cos(118 * DEG), Math.sin(118 * DEG), 0), rr = V(Math.cos(70 * DEG), Math.sin(70 * DEG), 0);
  dashed(root, [C.clone().setZ(z), C.clone().addScaledVector(rd, R).setZ(z)], 0.7, 0.012); dashed(root, [C.clone().setZ(z + 0.001), C.clone().addScaledVector(rr, r).setZ(z + 0.001)], 0.7, 0.008);
  const labels = [{ text: 'R', at: C.clone().addScaledVector(rd, R * 0.62).add(V(-0.025, 0, z)), cls: 'sym',col:'force-left',colSide:'left',colOrder:2 }, { text: 'r', at: C.clone().addScaledVector(rr, r * 0.6).add(V(0.02, 0.012, z)), cls: 'sym',col:'force-left',colSide:'left',colOrder:3 },
    { text: 'θ', at: ang, cls: 'sym',col:'force-right',colOrder:1 }];
  const fg = forceDiagram(ctx,labels,[
    {name:'T',color:'tension',text:'String tension at the inner-hub tangent',at:leave,vector:dir,order:0},
    {name:'mg',color:'weight',text:'Weight at spool centre',at:C,vector:V(0,-1,0),side:'left',order:1},
    {name:'N',color:'normal',text:'Upward ground normal; magnitude to be solved',at:V(),vector:V(0,1,0),side:'left',order:0},
    {name:'±f',color:'friction',text:'Unknown static friction sign; opposing arrowheads show both possible directions',at:V(),vector:V(1,0,0),order:2}
  ],R*1.1,0.005);
  const opposite = new Arrow3D(fg.group,P.friction,0.005); opposite.update(V(),V(-1,0,0),R*1.1);ctx.arrows.push(opposite);
  fg.split('T',[{dir:V(1,0,0),text:'T cos θ',px:[0,14]},{dir:V(0,1,0),text:'T sin θ',px:[16,0]}]);
  return { box: box3(V(-R*2, -R*1.3, -0.18), V(end.x+0.05,Math.max(2.6*R,end.y+0.03),0.18)), views: { setup: [12, 9], side: [0, 3] }, labels, forceGroups:[fg.group],forceKey:fg.key,
    detail:{label:'Spool close-up',box:()=>box3(V(-R*2,-R*1.3,-0.18),V(R*2.4,R*3,0.18))},
    breakdown:{ groups:[fg.breakdown], title:'Thread pull split into horizontal T cos θ and vertical T sin θ' },
    forceNote:'Directions only; arrow lengths do not compare magnitudes. Friction can point either way and must be solved. Balance is possible at cos θ = r/R; other slider angles are setup exploration, not equilibrium.',forceCaption:'Directions only · ±f is an unknown sign',snapshot:()=>({tangent:leave.toArray(),forces:fg.snapshot()}) };
};

B.pole_wrap = (ctx, p) => {
  const { root } = ctx, r = p.r, R = p.R, ys = 0.018, at2 = (a, d, y = ys) => V(d * Math.cos(a), y, -d * Math.sin(a));
  // ice: a broad dark disc that the pole stands on
  const iceR = Math.max(R, p.hand_dist + 0.08) + 0.1, ice = mesh(root, new THREE.CylinderGeometry(iceR, iceR, 0.02, 96), new THREE.MeshStandardMaterial({ color: 0x23303C, roughness: 1, metalness: 0, envMapIntensity: 0 }), 0, -0.01, 0); ice.castShadow = false;
  // the pole is translucent: from the book's top-view side the wrap and both tangent points lie behind it, and they are the problem
  const pole = mesh(root, new THREE.CylinderGeometry(r, r, p.pole_h, 64), clay(P.static), 0, p.pole_h / 2, 0); edges(pole, 0.18, 40);
  const cap = mesh(root, new THREE.CylinderGeometry(r * 1.02, r * 1.02, 0.008, 64), clay(darken(P.static, 0.2)), 0, p.pole_h, 0);
  for (const m of [pole, cap]) { m.material.transparent = true; m.material.opacity = m === pole ? 0.42 : 0.6; m.material.depthWrite = false; m.renderOrder = 6; }
  dashed(root, circlePts(V(0, 0.003, 0), R, 0, TAU, 160, 'xz'), 0.55, 0.035);
  // the rig turns rigidly about the pole: the wrap stays the same while the mass speeds up
  const rig = new THREE.Group(); root.add(rig);
  const am = p.mass_angle * DEG, ah = p.hand_angle * DEG, M = at2(am, R), H = at2(ah, p.hand_dist);
  const tm = am - Math.acos(r / R), th = ah + Math.acos(r / p.hand_dist);   // string wraps clockwise from tm down to th
  const sm = stringMat(), sr = 0.0035, wrap = []; for (let i = 0; i <= 40; i++) wrap.push(at2(tm + (th - tm) * i / 40, r + sr));
  bar(rig, M, at2(tm, r + sr), sr, sm); bar(rig, at2(th, r + sr), H, sr, sm);
  mesh(rig, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(wrap), 40, sr, 6), sm);
  const puck = mesh(rig, new THREE.CylinderGeometry(0.06, 0.06, 0.035, 40), clay(P.body), M.x, 0.0175, M.z); edges(puck, 0.25, 30);   // illustrative size: the book's mass is a point
  const grip = mesh(rig, new THREE.CapsuleGeometry(0.022, 0.05, 6, 16), clay(0xC9A27E), H.x, ys, H.z); grip.rotation.z = Math.PI / 2; grip.rotation.y = ah;
  const tan = a => V(Math.sin(a), 0, Math.cos(a));   // clockwise seen from above (the figure's sense)
  const vA = new Arrow3D(rig, P.velocity, 0.006); vA.update(M.clone().setY(0.03), tan(am), p.v0_len); ctx.arrows.push(vA);
  const hand = curlArrow(rig, V(0, 0.01, 0), V(0, 1, 0), p.hand_dist + 0.07, -ah - 0.05, -0.45, P.ink2, 0.004); void hand;
  const radii = new THREE.Group(); root.add(radii);
  dashed(radii, [V(0, 0.004, 0), at2(-135 * DEG, R, 0.004)], 0.7, 0.02); dashed(root, [V(0, p.pole_h + 0.005, 0), at2(195 * DEG, r, p.pole_h + 0.005)], 0.8, 0.012);
  const W = v => { rig.updateMatrixWorld(true); return rig.localToWorld(v.clone()); };
  const v0lab = new THREE.Group(), vlab = new THREE.Group(); root.add(v0lab, vlab); vlab.visible = false;
  const labels = [{ text: 'R', at: at2(-135 * DEG, R * 0.55, 0.01).add(V(-0.03, 0, 0)), cls: 'sym', group: radii }, { text: 'r', at: at2(195 * DEG, r, p.pole_h + 0.01), px: [-12, 0], cls: 'sym' },   // at the rim, clear of T on the far side
    { text: 'v0', at: () => W(vA.tip).add(V(0, 0.03, 0)), px: [8, 0], cls: 'sym', c: 'velocity', group: v0lab }, { text: 'v', at: () => W(vA.tip).add(V(0, 0.03, 0)), px: [8, 0], cls: 'sym', c: 'velocity', group: vlab },
    { text: 'm', at: () => W(M.clone().multiplyScalar(1 + 0.13 / R)), c: 'blue' }, { text: 'hand', at: () => W(H), px: [30, 6], cls: 'dim' }];
  const e = iceR + 0.02;
  // T runs along the string: drawn just above it, a little thicker, its label on the pole side (v keeps the outer side)
  const tension = forceDiagram(ctx,labels,[{name:'T',color:'tension',text:'In-plane string tension toward the tangent point on the pole',at:()=>W(M).setY(0.045),
    vector:()=>W(at2(tm,r)).sub(W(M)),order:0,side:'left'}],R*0.4,0.011);
  // Breakdown: the string leaves the mass tangent to the pole, at asin(r/R) to the radius, so its pull splits into
  // m v²/R toward the centre (it keeps the circle) and T r/R along the path (it speeds the mass up)
  tension.split('T', [{ dir: () => W(V(0, 0, 0)).sub(W(M)).setY(0), text: 'm v²/R' }, { dir: () => W(M.clone().add(tan(am))).sub(W(M)).setY(0), text: 'T r/R' }]);
  const dyn = d => {
    const v0 = d.params.v0, sim = PH.poleWrap({ R, r, v0, until: d.params.until || 3 }), vMax = sim.at(sim.moving).v / v0, eD = Math.max(e, Math.hypot(R, p.v0_len * vMax) + 0.06);
    return { duration: sim.duration, hide: [v0lab, radii], show: [vlab],
      set(t) { const s = sim.at(t); rig.rotation.y = -s.phi; vA.update(M.clone().setY(0.03), tan(am), p.v0_len * s.v / v0); tension.update(); },
      readout: t => `v = ${(sim.at(t).v / v0).toFixed(2)} v0`,
      box: roundBox(V(-eD, 0, -eD), V(eD, 0.04, eD)) };
  };
  // the fit is the flat ice (the pole's top projects inside it from any setup or top view)
  return { box: roundBox(V(-e, 0, -e), V(e, 0.04, e)), views: { setup: [8, 60], top: [0, 89] }, labels, dyn,forceGroups:[tension.group],forceKey:tension.key,
    breakdown:{ groups:[tension.breakdown], title:'String pull split toward the pole centre (m v²/R keeps the circle) and along the path (T r/R speeds the mass up)' },
    forceNote:'In-plane tension direction only; its magnitude grows with speed. Weight and ice normal cancel vertically and are omitted from this horizontal view.',forceCaption:'In-plane T direction · vertical forces cancel',snapshot:()=>({forces:tension.snapshot()}) };
};

B.ball_wall_block = (ctx, p) => {
  const { root } = ctx, s = p.block_size, d = 0.5;
  floor(root, -0.08, 2.0, d); wall(root, 0, 0.5, d);
  // rough ground under the block: a matte strip with a fine grain (the ball's lane in front is smooth)
  const rough = mesh(root, new THREE.BoxGeometry(2.0 - (p.ball_x + 0.35), 0.003, d * 0.8), clay(0x3A3530, { roughness: 1 }), (2.0 + p.ball_x + 0.35) / 2, 0.0015, 0); rough.castShadow = false;
  for (let x = p.ball_x + 0.37; x < 1.98; x += 0.035) polyline(root, [V(x, 0.0035, -d * 0.38), V(x + 0.012, 0.0035, d * 0.38)], new THREE.LineBasicMaterial({ color: 0x6B635A, transparent: true, opacity: 0.35 }));
  const ball = mesh(root, new THREE.SphereGeometry(p.ball_r, 32, 20), clay(P.body), p.ball_x, p.ball_r, 0);
  const blk = createProp('block', { size: [s, s, s * 1.2], color: P.body2 }); blk.position.set(p.block_x, s / 2, 0); root.add(blk);
  const v0 = new Arrow3D(root, P.velocity, 0.006); v0.update(V(p.ball_x + p.ball_r + 0.02, p.ball_r, 0), V(1, 0, 0), 0.2); ctx.arrows.push(v0);
  const labels = [{ text: 'm', at: () => ball.position.clone().add(V(-0.02, 0.07, 0)), c: 'blue' }, { text: 'v0', at: V(p.ball_x + 0.16, p.ball_r + 0.06, 0), cls: 'sym', group: v0.g },
    { text: 'M', at: () => blk.position.clone().add(V(0, s / 2 + 0.06, 0)), c: 'sand' }, { text: 'µ', at: () => blk.position.clone().add(V(s / 2 + 0.07, 0.02, 0)), cls: 'sym' }, { text: 'wall', at: V(-0.06, 0.55, 0), cls: 'dim' }];
  let sliding = false;
  const fg=forceDiagram(ctx,labels,[
    {name:'Mg',color:'weight',text:'Block weight at centre',at:()=>blk.position.clone(),vector:V(0,-p.M*9.81,0),order:2},
    {name:'N',color:'normal',text:'Ground normal on the block',at:()=>blk.position.clone().setY(0),vector:V(0,p.M*9.81,0),order:0},
    {name:'f',color:'friction',text:'Kinetic friction μMg, only while the block slides right',at:()=>blk.position.clone().setY(0),vector:()=>V(sliding?-p.mu*p.M*9.81:0,0,0),side:'left',order:1}
  ],s*1.05,0.006);
  const dyn = (dd, answer) => {
    const sim = PH.ballWallBlock({ ...p, g: dd.params.g, bounces: dd.params.bounces, model: dd.params.model });
    // book total slide d = m v0²/(2µMg): a tick where the block's front face ends up in the limit
    const dB = p.m * p.v0 ** 2 / (2 * p.mu * p.M * dd.params.g), fx = p.block_x + s / 2 + dB, mark = new THREE.Group(); root.add(mark); mark.visible = false;
    dashed(mark, [V(fx, 0.004, -d * 0.4), V(fx, 0.004, d * 0.4)], 0.8, 0.02); dashed(mark, [V(fx, 0.004, d * 0.4), V(fx, s + 0.05, d * 0.4)], 0.5, 0.02);
    if (answer) labels.push({ text: 'd', at: V(fx + 0.05, 0.04, d * 0.42), cls: 'sym', group: mark });
    return { duration: sim.duration, hide: [v0.g], set(t) { const st = sim.at(t); ball.position.x = st.x; blk.position.x = st.X; sliding=st.V>1e-8; fg.update(); mark.visible = t > 0 && answer; },
      readout: t => `block moved ${((sim.at(t).X - p.block_x) * 100).toFixed(1)} cm` };
  };
  return { box: box3(V(-0.1, -s*0.7, -d / 2), V(1.85, 0.58, d / 2)), views: { setup: [5, 9], side: [0, 3] }, labels, dyn,forceGroups:[fg.group],forceKey:fg.key,
    detail:{label:'Block close-up',box:()=>box3(V(blk.position.x-s*1.2,-s*.8,-s*.65),V(blk.position.x+s*1.2,s*1.6,s*.65))},
    forceNote:'Forces shown on the block. Kinetic friction appears only during sliding. Ball weight and normal cancel vertically; instantaneous collision impulses are not drawn as finite forces.',snapshot:()=>({sliding,forces:fg.snapshot()}) };
};

export function buildBeadHoop(ctx, p) {
  const { root } = ctx, R = p.R, cy = R + 0.35;
  floor(root, -0.6, 0.6, 0.7);
  const hoop = createProp('bead_hoop', { r: R, angle: (p.theta0 ?? 35) * DEG }); hoop.position.set(0, cy, 0); root.add(hoop);
  // motor housing under the spindle and a bearing cap on top: the spin is driven, the axis is fixed
  edges(mesh(root, new THREE.CylinderGeometry(0.08, 0.095, 0.1, 40), graphite(), 0, 0.05, 0), 0.2, 30);
  bar(root, V(0, 0.1, 0), V(0, cy - 1.25 * R, 0), R * 0.03, steel(darken(P.steel, 0.3)));
  mesh(root, new THREE.CylinderGeometry(R * 0.06, R * 0.06, 0.03, 20), steel(darken(P.steel, 0.4)), 0, cy + 1.25 * R, 0);
  const om = curlArrow(root, V(0, cy + 1.12 * R, 0), V(0, 1, 0), 0.07, 0.4, 4.6, P.omega, 0.0045); void om;
  // Radius and θ belong to the current hoop plane, including during motion.
  const frame = new THREE.Group(); frame.name = 'hoop-marks'; frame.position.set(0, cy, 0); root.add(frame);
  const radial = dashed(frame, [V(), V(0, -R, 0)], 0.7, R * 0.05); radial.name = 'bead-radius';
  dashed(frame, [V(), V(0, -R * 0.5, 0)], 0.45, R * 0.05);
  const angleR = R * 0.3, angle = polyline(frame, circlePts(V(), angleR, -Math.PI / 2, -Math.PI / 2, 40), inkLine(0.8));
  angle.name = 'bead-theta';
  const forceGroup = new THREE.Group(); forceGroup.name = 'hoop-real-forces'; root.add(forceGroup);
  const weight = new Arrow3D(forceGroup, P.weight, R * 0.014), normal = new Arrow3D(forceGroup, P.normal, R * 0.014);
  weight.g.name = 'bead-weight'; normal.g.name = 'bead-reaction'; ctx.arrows.push(weight, normal);
  // Breakdown: mg along the hoop (mg sin θ, toward the bottom) and along the radius (mg cos θ, outward), head to tail
  const split = new THREE.Group(); split.name = 'breakdown'; split.visible = false; forceGroup.add(split);
  const mgT = new Arrow3D(split, P.weight, R * 0.01, { opacity: 0.85 }), mgR = new Arrow3D(split, P.weight, R * 0.01, { opacity: 0.85 }), midT = V(), midR = V(); ctx.arrows.push(mgT, mgR);
  let state;
  const localLabel = (r, t) => { frame.updateWorldMatrix(true, false); return frame.localToWorld(V(r * Math.sin(t), -r * Math.cos(t), 0)); };
  const place = s => {
    state = s; hoop.userData.animate.spin(s.spin); hoop.userData.animate.setAngle(s.theta); frame.rotation.y = s.spin;
    const r = radial.geometry.attributes.position; r.setXYZ(1, R * Math.sin(s.theta), -R * Math.cos(s.theta), 0); r.needsUpdate = true; radial.computeLineDistances();
    const a = angle.geometry.attributes.position;
    for (let i = 0; i < a.count; i++) { const t = s.theta * i / (a.count - 1); a.setXYZ(i, angleR * Math.sin(t), -angleR * Math.cos(t), 0); } a.needsUpdate = true;
    const at = new THREE.Vector3(...s.position).add(V(0, cy, 0)), N = new THREE.Vector3(...s.reaction), mg = new THREE.Vector3(...s.weight);
    // One common drawing scale preserves |N|/mg; no invented radial-only reaction.
    const scale = R * 0.72 / Math.max(mg.length(), N.length(), 1e-9);
    weight.update(at, mg, mg.length() * scale); normal.update(at, N, N.length() * scale);
    frame.updateWorldMatrix(true, false);
    const rad = V(Math.sin(s.theta), -Math.cos(s.theta), 0).transformDirection(frame.matrixWorld), tng = V(Math.cos(s.theta), Math.sin(s.theta), 0).transformDirection(frame.matrixWorld);
    const ct = mg.dot(tng), cr = mg.dot(rad), end = at.clone().addScaledVector(tng, ct * scale);
    mgT.update(at, tng.clone().multiplyScalar(ct < 0 ? -1 : 1), Math.abs(ct) * scale); midT.copy(at).addScaledVector(tng, ct * scale / 2);
    mgR.update(end, rad.clone().multiplyScalar(cr < 0 ? -1 : 1), Math.abs(cr) * scale); midR.copy(end).addScaledVector(rad, cr * scale / 2);
  };
  place(PH.beadHoopState({ R, omega: 0, theta: (p.theta0 ?? 35) * DEG }));
  const labels = [{ text: 'ω', at: V(0.1, cy + 1.2 * R, 0), cls: 'sym', c: 'omega' },
    // Two short leader columns keep symbols off the spindle and force arrows.
    // Fixed semantic order avoids swapping labels when their moving anchors cross.
    { text: 'θ', at: () => localLabel(angleR * 1.55, state.theta / 2), cls: 'sym', group: frame, col: 'hoop-marks', colSide: 'left', colOrder: 0 },
    { text: 'R', at: () => localLabel(R * 0.58, state.theta).add(V(0, R * 0.04, 0)), cls: 'sym', group: frame, col: 'hoop-marks', colSide: 'left', colOrder: 1 },
    { text: 'mg', at: () => weight.tip.clone(), cls: 'sym', c: 'weight', group: forceGroup, col: 'hoop-forces', colOrder: 1 },
    { text: 'N', at: () => normal.tip.clone(), cls: 'sym', c: 'normal', group: forceGroup, col: 'hoop-forces', colOrder: 0 },
    { text: 'mg sin θ', at: () => midT.clone(), cls: 'sym', c: 'weight', group: mgT.g, px: [-18, 0] }, { text: 'mg cos θ', at: () => midR.clone(), cls: 'sym', c: 'weight', group: mgR.g, px: [18, 0] }];
  const dyn = d => {
    const omega = d.params.omega_ratio * Math.sqrt(d.params.g / R), sim = PH.beadHoop({ R, omega, theta0: d.params.theta0 * DEG, g: d.params.g, duration: d.params.duration });
    return { duration: sim.duration, set(t) { place(sim.at(t)); } };
  };
  return { box: box3(V(-R * 1.8, -0.05, -R * 1.8), V(R * 1.8, cy + 1.3 * R, R * 1.8)), views: { setup: [12, 10], side: [0, 3] }, labels, dyn, forceGroups: [forceGroup],
    breakdown: { groups: [split], title: 'Weight split along the hoop (mg sin θ) and along its radius (mg cos θ)' },
    snapshot: () => { frame.updateWorldMatrix(true, false); return { ...state, center: [0, cy, 0], weightTip: weight.tip.toArray(), reactionTip: normal.tip.toArray(), radiusEnd: frame.localToWorld(V(R * Math.sin(state.theta), -R * Math.cos(state.theta), 0)).toArray() }; } };
}
B.bead_hoop = buildBeadHoop;

B.rail_pendulum = (ctx, p) => {
  const { root } = ctx, yr = p.rail_y, hx = p.rail_half, d = 0.42;
  floor(root, -hx - 0.2, hx + 0.2, d);
  for (const s of [1, -1]) { const c = createProp('support', { kind: 'wall', w: yr + 0.18, t: 0.05, d: 0.16 }); c.position.set(s * (hx + (s > 0 ? 0.05 : 0)), (yr + 0.18) / 2, 0); if (s > 0) c.position.x = hx + 0.05; root.add(c); }
  bar(root, V(-hx, yr, 0), V(hx, yr, 0), 0.01, steel());
  const bw = 0.2, bh = 0.12, block = createProp('block', { size: [bw, bh, 0.12], color: P.body2 }); root.add(block);
  const arm = bar(root, V(0, yr, 0.065), V(0, yr - p.l, 0.065), 0.005, steel(darken(P.steel, 0.1)));
  const br = 0.035 + 0.02 * Math.cbrt(p.m), bob = mesh(root, new THREE.SphereGeometry(br, 32, 20), clay(P.body));
  const pin = mesh(root, new THREE.CylinderGeometry(0.009, 0.009, 0.02, 16), graphite()); pin.rotation.x = Math.PI / 2;
  const place = (x, th) => { block.position.set(x, yr, 0); pin.position.set(x, yr, 0.068); const b = V(x + p.l * Math.sin(th), yr - p.l * Math.cos(th), 0.065); setBar(arm, V(x, yr, 0.065), b); bob.position.copy(b); };
  place(0, (p.theta0 || 0) * DEG);
  const labels = [{ text: 'M', at: () => block.position.clone().add(V(0, bh / 2 + 0.05, 0)), c: 'sand' }, { text: 'ℓ', at: () => block.position.clone().add(bob.position).multiplyScalar(0.5).add(V(0.05, 0, 0.07)), cls: 'sym' },
    { text: 'm', at: () => bob.position.clone().add(V(br + 0.04, 0, 0)), c: 'blue' }];
  let tension=p.m*9.81;
  const fg=forceDiagram(ctx,labels,[
    {name:'mg',color:'weight',text:'Pendulum bob weight at its centre',at:()=>bob.position.clone(),vector:V(0,-p.m*9.81,0),side:'left',order:1},
    {name:'T',color:'tension',text:'Constraint force along the pendulum toward its free support',at:()=>bob.position.clone(),vector:()=>block.position.clone().setZ(0.065).sub(bob.position).normalize().multiplyScalar(tension),order:0}
  ],p.l*0.45,0.006);
  fg.split('T',[{dir:V(1,0,0),text:'T sin θ',px:[0,14]},{dir:V(0,1,0),text:'T cos θ',px:[16,0]}]);
  const dyn = dd => {
    const sim = PH.railPendulum({ M: p.M, m: p.m, l: p.l, theta0: dd.params.theta0 * DEG, g: dd.params.g, duration: dd.params.duration });
    return { duration: sim.duration, set(t) { const s = sim.at(t); place(s.x, s.theta); tension=s.tension; fg.update(); } };
  };
  return { box: box3(V(-hx - 0.12, 0, -d / 2), V(hx + 0.12, yr + 0.2, d / 2)), views: { setup: [10, 9], side: [0, 3] }, labels, dyn,forceGroups:[fg.group],forceKey:fg.key,
    breakdown:{ groups:[fg.breakdown], title:'String tension split: T sin θ pulls the cart sideways, T cos θ holds the bob up' },
    forceNote:'Forces on the bob, including support acceleration in the tension calculation. No centrifugal or ma arrows are added.',snapshot:()=>({tension,forces:fg.snapshot()}) };
};

/* physics z-up rotation → three y-up: M3 = C R Cᵀ with C (x, y, z) → (x, z, −y) */
function threeQuat(R) {
  const C = [[1, 0, 0], [0, 0, 1], [0, -1, 0]], Ct = [[1, 0, 0], [0, 0, -1], [0, 1, 0]];
  const mul = (A, Bm) => A.map((row, i) => [0, 1, 2].map(j => row[0] * Bm[0][j] + row[1] * Bm[1][j] + row[2] * Bm[2][j]));
  const M = mul(mul(C, R), Ct), m4 = new THREE.Matrix4().set(M[0][0], M[0][1], M[0][2], 0, M[1][0], M[1][1], M[1][2], 0, M[2][0], M[2][1], M[2][2], 0, 0, 0, 0, 1);
  return new THREE.Quaternion().setFromRotationMatrix(m4);
}
B.rolling_cone = (ctx, p) => {
  const { root } = ctx, a = p.alpha * DEG, h = p.h, rb = h * Math.tan(a), slant = h / Math.cos(a);
  const table = mesh(root, new THREE.CylinderGeometry(slant + 0.07, slant + 0.07, 0.025, 96), clay(0x454B55, { roughness: 0.85 }), 0, -0.0125, 0); edges(table, 0.15, 40);
  // the cone in its body frame: apex at the origin, axis +x, base centre P at (h, 0, 0)
  const body = new THREE.Group(); root.add(body);
  const cone = createProp('cone', { r: rb, h, color: P.body, sectors: 10 }); cone.rotation.z = Math.PI / 2; cone.position.x = h; body.add(cone);
  const Pm = mesh(body, new THREE.SphereGeometry(0.012, 16, 10), clay(P.highlight), h + 0.002, 0, 0); void Pm;
  const axis = dashed(body, [V(0, 0, 0), V(h, 0, 0)], 0.75, 0.02); axis.material.depthTest = true;
  const arcs = new THREE.Group(); body.add(arcs);
  const l1 = arc(arcs, V(0, 0, 0), 0.16, 0, a, 0.8), l2 = arc(arcs, V(0, 0, 0), 0.2, -a, 0, 0.8);
  const sim = PH.rollingCone({ alpha: a, h, v: 0.25 });
  const pose = t => body.quaternion.copy(threeQuat(sim.pose(t).R)); pose(0);
  const vArrow = new Arrow3D(root, P.velocity, 0.005); const Pw = () => body.localToWorld(V(h, 0, 0));
  const setV = t => { const p0 = sim.P(t), p1 = sim.P(t + 1e-3); const d = V(p1[0] - p0[0], p1[2] - p0[2], -(p1[1] - p0[1])); vArrow.update(Pw(), d, 0.13); };
  body.updateMatrixWorld(true); setV(0); ctx.arrows.push(vArrow);
  const labels = [{ text: 'P', at: () => Pw(), cls: 'sym', c: 'highlight', col:'cone-right',colOrder:0 }, { text: 'h', at: () => body.localToWorld(V(h * 0.72, 0, 0)).add(V(0, 0.04, 0)), cls: 'sym', group: arcs,col:'cone-left',colSide:'left',colOrder:0 },
    { text: 'α', at: () => body.localToWorld(l2.clone()), cls: 'sym', group: arcs,col:'cone-left',colSide:'left',colOrder:1 }, { text: 'v', at: () => vArrow.tip.clone(), cls: 'sym', c: 'velocity',col:'cone-right',colOrder:1 }];
  // Frame the object being explained, rather than the mostly empty circular table.
  // Its real contact stays in frame; Whole path restores the complete floor/route.
  const closeBox=()=>{root.updateMatrixWorld(true);return new THREE.Box3().setFromObject(body).expandByPoint(vArrow.tip).expandByScalar(h*0.1);};
  const wholeBox=box3(V(-slant-0.07,-0.025,-slant-0.07),V(slant+0.07,2*rb*Math.cos(a)+0.06,slant+0.07));
  /* Breakdown (angular velocity, after the solution): ω is the turn about the vertical, Ω, plus the spin about the cone's own
     axis, ψ̇ = −Ω / sin α. Their vertical parts cancel, so ω lies along the contact line, the instantaneous axis. Drawn head to
     tail from a point on the contact line, ω back along it toward the tip; a direction diagram (|ω| = Ω cot α). */
  const wspin = new THREE.Group(); wspin.name = 'breakdown'; wspin.visible = false; root.add(wspin);
  const wParts = ['Ω', 'spin', 'ω'].map((text, i) => { const a = new Arrow3D(wspin, P.omega, i === 2 ? 0.006 : 0.0045, { opacity: i === 2 ? 1 : 0.85 }), mid = V(); ctx.arrows.push(a);
    labels.push({ text, at: () => mid.clone(), px: [i === 1 ? 18 : -14, 0], cls: 'sym', c: 'omega', group: a.g }); return { a, mid }; });
  let omSign = 1;
  const placeW = () => { body.updateMatrixWorld(true); const apex = body.localToWorld(V(0, 0, 0)), ax = body.localToWorld(V(1, 0, 0)).sub(apex).normalize();
    const d = V(ax.x, 0, ax.z).normalize(), Q = apex.clone().addScaledVector(d, 0.85 * slant), k = 0.55 * h * Math.tan(a), om = V(0, omSign * k, 0), sp = ax.clone().multiplyScalar(-omSign * k / Math.sin(a)), tot = om.clone().add(sp);
    const [o, s1, w] = wParts; o.a.update(Q, om, om.length()); o.mid.copy(Q).addScaledVector(om, 0.5); const q2 = Q.clone().add(om); s1.a.update(q2, sp, sp.length()); s1.mid.copy(q2).addScaledVector(sp, 0.5);
    w.a.update(Q, tot, tot.length()); w.mid.copy(Q).addScaledVector(tot, 0.5); };
  placeW();
  const dyn = d => {
    const s2 = PH.rollingCone({ alpha: a, h, v: d.params.v }), path = dashed(root, circlePts(V(0, h * Math.sin(a), 0), h * Math.cos(a), 0, TAU, 120, 'xz'), 0.35, 0.03); path.visible = false;
    omSign = Math.sign(s2.Omega) || 1;
    return { duration: d.params.duration, hide: [arcs], set(t) { body.quaternion.copy(threeQuat(s2.pose(t).R)); body.updateMatrixWorld(true); placeW(); path.visible = t > 0; const p0 = s2.P(t), p1 = s2.P(t + 1e-3); vArrow.update(Pw(), V(p1[0] - p0[0], p1[2] - p0[2], -(p1[1] - p0[1])), 0.13); },
      follow:closeBox, views: { setup: [28, 30], side: [0, 8], top: [0, 89] } };
  };
  void pose;
  return { box: closeBox(), views: { setup: [28, 30], side: [0, 8], top: [0, 89] }, labels, dyn,detail:{label:'Whole path',returnLabel:'Cone close-up',box:()=>wholeBox},
    breakdown:{ groups:[wspin], kinematic:true, answer:true, title:'Angular velocity ω = Ω (turning about the vertical) + spin about the cone axis; the vertical parts cancel, so ω lies along the contact line' },
    forceNote:'Kinematic rolling construction, not a force solution: the mass distribution and contact-force distribution are unspecified. Velocity is not a force.',forceCaption:'Rolling geometry · contact forces not determined' };
};

B.ring_in_cone = (ctx, p) => {
  const { root } = ctx, th = p.theta * DEG, H = p.cone_h, tipY = 0.32, rho = p.h * Math.tan(th), top = H * Math.tan(th);
  const base = floor(root, -0.32, 0.32, 0.64);   // drawing-only support; the working cone owns the composition
  const stand = createProp('pivot_stand', { h: tipY }); stand.position.set(0, tipY, 0); root.add(stand);
  // the overview's reading marks; a close-up hides them so only the focused geometry is drawn
  const marks = new THREE.Group(); root.add(marks);
  // glass cone: open top, apex down at the stand; a steel rim and a few generators keep its shape readable
  const glass = new THREE.MeshStandardMaterial({ color: 0x9FB7D6, roughness: 0.72, metalness: 0, transparent: true, opacity: 0.105, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 0.25 });
  const cone = mesh(root, new THREE.ConeGeometry(top, H, 96, 1, true), glass, 0, tipY + H / 2, 0); cone.rotation.x = Math.PI; cone.castShadow = false; cone.renderOrder = 2;
  const rim = mesh(root, new THREE.TorusGeometry(top, 0.0038, 8, 120), steel(0x8092A9, {roughness:0.72,envMapIntensity:0.25}), 0, tipY + H, 0); rim.rotation.x = Math.PI / 2; rim.castShadow = false;
  for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; polyline(marks, [V(0, tipY, 0), V(top * Math.cos(a), tipY + H, top * Math.sin(a))], new THREE.LineBasicMaterial({ color: 0x9FB7D6, transparent: true, opacity: 0.16 })); }
  dashed(marks, circlePts(V(0, tipY + p.h, 0), rho, 0, TAU, 120, 'xz'), 0.6, 0.03);
  // the ring: touches the cone at C, plane ⟂ to the line tip→C, centre one radius in along the inward surface normal
  const ph = p.ring_angle * DEG, Cp = V(rho * Math.cos(ph), tipY + p.h, -rho * Math.sin(ph)), tip = V(0, tipY, 0), s = Cp.clone().sub(tip).normalize();
  const radial = V(Math.cos(ph), 0, -Math.sin(ph)), nIn = radial.clone().multiplyScalar(-Math.cos(th)).add(V(0, Math.sin(th), 0)).normalize();
  // The outer surface, not the tube centreline, reaches the specified radius r.
  // The old tube and ball marker visibly penetrated the wall beyond that contact.
  const ring = new THREE.Group(); root.add(ring);
  const ringGeo = new THREE.TorusGeometry(p.r * 0.945, p.r * 0.055, 12, 96);
  // A second material on the SAME surface gives a spin cue without coplanar flicker.
  ringGeo.clearGroups();
  for(let row=0;row<12;row++) { ringGeo.addGroup(row*96*6,8*6,1);ringGeo.addGroup((row*96+8)*6,88*6,0); }
  mesh(ring, ringGeo, [clay(P.body, {roughness:0.82}),clay(P.body2, {roughness:0.82})]);
  ring.position.copy(Cp).addScaledVector(nIn, p.r); ring.quaternion.setFromUnitVectors(V(0, 0, 1), s);
  ring.traverse(o => { o.castShadow = false; });   // its shadow would fall past the base onto the bare ground
  const cMark = mesh(root, new THREE.SphereGeometry(0.006, 12, 8), clay(P.highlight), Cp.x, Cp.y, Cp.z);
  const tipLine = new THREE.Group(); root.add(tipLine); dashed(tipLine, [tip, Cp.clone().addScaledVector(s, 0.06)], 0.5, 0.02);
  dashed(marks, [V(0, tipY, 0), V(0, tipY + H + 0.05, 0)], 0.45, 0.025);
  const Om = curlArrow(marks, V(0, tipY + p.h + 0.02, 0), V(0, 1, 0), rho + 0.05, -ph + Math.PI - 0.45, 0.9, P.omega, 0.005); void Om;
  const angLab = (() => { const pts = []; for (let i = 0; i <= 30; i++) { const a = th * i / 30; pts.push(tip.clone().add(V(Math.sin(a) * 0.12, Math.cos(a) * 0.12, 0))); } polyline(marks, pts, inkLine(0.75)); return tip.clone().add(V(Math.sin(th / 2) * 0.17, Math.cos(th / 2) * 0.17, 0)); })();
  const hd = dimension(root, V(-0.004, tipY, 0), V(-0.004, tipY + p.h, 0), V(-rho - 0.12, 0, 0));
  const ringLab = new THREE.Group();   // not drawn: carries the overview's "ring" label visibility
  const labels = [{ text: 'θ', at: angLab, cls: 'sym', group: marks }, { text: 'h', at: hd.mid, cls: 'sym', group: hd.group }, { text: 'r', at: ring.position.clone().add(V(0.02, p.r + 0.035, 0)), cls: 'sym', group: tipLine },
    { text: 'Ω', at: V((rho + 0.08) * Math.cos(-ph + Math.PI), tipY + p.h + 0.02, -(rho + 0.08) * Math.sin(-ph + Math.PI)), px: [0, -14], cls: 'sym', c: 'omega', group: marks }, { text: 'ring', at: () => ring.position.clone(), px: [18, -14], c: 'blue', group: ringLab }];

  /* Close-up overlays at the pictured instant (t = 0), in the vertical plane through the axis and C. The forces are the
     book solution's (9.13): gravity mg at the centre, the normal force N at C along the inward normal (its line passes
     through the centre), friction F at C up along the wall. With Ω² = g/(2h tan²θ) the centripetal acceleration is
     a = g/(2 tan θ), so F = mg cos θ − ma sin θ = ½ mg cos θ and N = mg sin θ + ma cos θ; the arrows use those ratios.
     Axes: +x1 up along the wall (s), +x2 along the inward normal (n). Gravity −mg ŷ splits into −mg cos θ on x1 and
     −mg sin θ on x2 (ŷ·s = cos θ, ŷ·n = sin θ). There is no centripetal force arrow: ma is what N and F produce. */
  const fo = new THREE.Group(); root.add(fo);   // turns with the contact point when the motion plays
  const Cc = Cp.clone().addScaledVector(nIn, p.r), up = V(0, 1, 0), r = p.r, k = 1.9 * r;
  const kF = k * Math.cos(th) / 2, kN = k * (Math.sin(th) + Math.cos(th) ** 2 / (2 * Math.sin(th)));
  const ov = {}, group = (name, frame = true) => { const g = new THREE.Group(); g.visible = false; g.userData.frame = frame; fo.add(g); ov[name] = g; return g; };
  const W = v => { fo.updateMatrixWorld(true); return fo.localToWorld(v.clone()); };
  const arrow = (g, color, from, dir, len, rad = 0.0018, opacity) => { const a = new Arrow3D(g, color, rad, opacity ? { opacity } : undefined); a.update(from, dir, len); a.g.visible = true; ctx.arrows.push(a); return a; };
  /* an arc at c from unit u toward unit v (both in the plane), radius rr; returns its label point at rr·lab on the bisector */
  const arcUV = (g, c, u, v, rr, lab = 1.55) => { const ang = u.angleTo(v), ax = u.clone().cross(v).normalize(), pts = [];
    for (let i = 0; i <= 32; i++) pts.push(c.clone().add(u.clone().applyAxisAngle(ax, ang * i / 32).multiplyScalar(rr)));
    polyline(g, pts, inkLine(0.85)); return c.clone().add(u.clone().applyAxisAngle(ax, ang / 2).multiplyScalar(rr * lab)); };
  // the wall in section: the generator through C with the usual hatching on the solid (outer) side
  const wall = group('wall', false), wallMat = new THREE.LineBasicMaterial({ color: 0xB9CBE4, transparent: true, opacity: 0.9 });
  polyline(wall, [Cp.clone().addScaledVector(s, -2.2 * r), Cp.clone().addScaledVector(s, 3.2 * r)], wallMat);
  for (let a = -2.0; a <= 3.0; a += 0.32) { const o = Cp.clone().addScaledVector(s, a * r);
    polyline(wall, [o, o.clone().addScaledVector(nIn, -0.26 * r).addScaledVector(s, -0.2 * r)], new THREE.LineBasicMaterial({ color: 0xB9CBE4, transparent: true, opacity: 0.45 })); }
  const vert = group('vertical', false); dashed(vert, [Cp.clone(), Cp.clone().addScaledVector(up, 2.6 * r)], 0.75, r * 0.12);
  const tw = group('theta_wall'), thW = arcUV(tw, Cp, up, s, 1.5 * r, 1.45);
  const rad = group('radius'); dashed(rad, [Cp.clone(), Cc.clone()], 0.85, r * 0.08); mesh(rad, new THREE.SphereGeometry(r * 0.07, 12, 8), clay(P.ink), Cc.x, Cc.y, Cc.z).castShadow = false;
  const cl = group('contact_label');
  const fmg = group('force_mg'); arrow(fmg, P.weight, Cc, up.clone().negate(), k);
  const fN = group('force_N'); arrow(fN, P.normal, Cp, nIn, kN);
  const fF = group('force_F'); arrow(fF, P.friction, Cp, s, kF);
  const axes = group('axes'), axC = new THREE.LineDashedMaterial({ color: P.ink2, transparent: true, opacity: 0.8, dashSize: r * 0.1, gapSize: r * 0.07, depthTest: false });
  polyline(axes, [Cc.clone().addScaledVector(s, -1.25 * k), Cc.clone()], axC); polyline(axes, [Cc.clone().addScaledVector(nIn, -0.75 * k), Cc.clone()], axC);
  arrow(axes, P.ink2, Cc, s, 1.35 * k, 0.0016); arrow(axes, P.ink2, Cc, nIn, 1.35 * k, 0.0016);
  // the split as a closed triangle, head to tail: −mg cos θ along x₁, then −mg sin θ along x₂, ending at the tip of mg
  const comp = group('gravity_components'), cDown = s.clone().negate(), cIn = nIn.clone().negate();
  const mgTip = Cc.clone().addScaledVector(up, -k), tipDown = Cc.clone().addScaledVector(cDown, k * Math.cos(th));
  arrow(comp, P.weight, Cc, cDown, k * Math.cos(th), 0.0026, 0.9); arrow(comp, P.weight, tipDown, cIn, k * Math.sin(th), 0.0026, 0.9);
  const q = r * 0.2; polyline(comp, [tipDown.clone().addScaledVector(s, q), tipDown.clone().addScaledVector(s, q).addScaledVector(cIn, q), tipDown.clone().addScaledVector(cIn, q)], inkLine(0.7));
  const tc = group('theta_components'), thC = arcUV(tc, Cc, up.clone().negate(), cDown, 0.55 * k, 1.38);
  const L = (text, at, grp, extra = {}) => labels.push({ text, at: () => W(at), group: grp, focus: true, ...extra });
  L('θ', thW, tw, { cls: 'sym' }); L('r', Cp.clone().add(Cc).multiplyScalar(0.5).addScaledVector(s, 0.26 * r), rad, { cls: 'sym' });
  L('C', Cp.clone().addScaledVector(s, -0.5 * r).addScaledVector(nIn, -0.35 * r), cl, { cls: 'sym', c: 'highlight' });
  L('mg', mgTip.clone().addScaledVector(up, -0.3 * r), fmg, { cls: 'sym', c: 'weight', px: [-16, 0] });
  L('N', Cp.clone().addScaledVector(nIn, kN - 0.15 * r).addScaledVector(s, -0.42 * r), fN, { cls: 'sym', c: 'normal' });   // beside its tip, off the x₂ line
  L('F', Cp.clone().addScaledVector(s, kF + 0.3 * r).addScaledVector(nIn, 0.3 * r), fF, { cls: 'sym', c: 'friction' });   // inside the cone, off the wall line
  L('x₁', Cc.clone().addScaledVector(s, 1.35 * k + 0.3 * r), axes, { cls: 'sym' }); L('x₂', Cc.clone().addScaledVector(nIn, 1.35 * k + 0.3 * r), axes, { cls: 'sym' });
  L('mg cos θ', Cc.clone().addScaledVector(cDown, 0.55 * k * Math.cos(th)).addScaledVector(nIn, 0.62 * r), comp, { cls: 'sym', c: 'weight' });
  L('mg sin θ', tipDown.clone().addScaledVector(cDown, 0.4 * r).addScaledVector(nIn, 0.2 * r), comp, { cls: 'sym', c: 'weight', px: [-22, 4] });   // at its leg's tail, clear of mg
  L('θ', thC, tc, { cls: 'sym' });
  const focus = {
    anchors: { ring: () => { const c = W(Cc); return new THREE.Box3(c.clone().subScalar(r * 1.15), c.clone().addScalar(r * 1.15)); },
      contact: () => { const c = W(Cp); return new THREE.Box3(c.clone().subScalar(r * 0.2), c.clone().addScalar(r * 0.2)); },
      tip: () => new THREE.Box3(tip.clone().subScalar(0.02), tip.clone().addScalar(0.02)) },
    // the contact plane: horizontal outward through C (screen right) and up; the camera looks along its normal
    planes: { contact: () => ({ right: radial.clone().applyQuaternion(fo.quaternion), up: up.clone() }) },
    // the glass shell and rim would fill a close-up taken from inside the cone: the hatched wall line replaces them
    overlays: ov, hide: [marks, hd.group, tipLine, ringLab, cone, rim, base, stand], ghost: [],
  };
  const dyn = d => {
    const sim = PH.ringInCone({ theta: th, h: p.h, r: p.r, g: d.params.g, phi0: ph, duration: d.params.duration }), m4 = new THREE.Matrix4();
    return { duration: sim.duration, hide: [tipLine],
      set(t) { const q = sim.pose(t), F = q.R; ring.position.set(q.centre[0], q.centre[1] + tipY, q.centre[2]);
        m4.set(F[0][0], F[0][1], F[0][2], 0, F[1][0], F[1][1], F[1][2], 0, F[2][0], F[2][1], F[2][2], 0, 0, 0, 0, 1); ring.quaternion.setFromRotationMatrix(m4);
        cMark.position.set(q.C[0], q.C[1] + tipY, q.C[2]); fo.rotation.y = sim.Omega * t; },
      readout: t => `${(sim.Omega * t / TAU).toFixed(2)} turns` };
  };
  return { box: box3(V(-top - 0.05, 0, -top - 0.05), V(top + 0.05, tipY + H + 0.03, top + 0.05)), views: { setup: [18, 26], side: [0, 4], top: [0, 89] }, labels, dyn, focus,
    detailFocus:{geometry:'ring_geometry',forces:'ring_forces',label:'Ring contact'},
    breakdown:{ focus:'ring_components', title:'Gravity split along the wall (mg cos θ) and into it (mg sin θ)' },
    forceGroups: [fmg, fN, fF], forceKey: [{sym:'mg',text:'gravity at centre',c:'weight',k:'arrow'}, {sym:'N',text:'normal force at contact',c:'normal',k:'arrow'}, {sym:'F',text:'friction along the wall',c:'friction',k:'arrow'}] };
};

// ── the mounted viewer ──────────────────────────────────────────────────────────────────────────────────────
const VIEW_NAMES = { setup: 'Setup', side: 'Side', top: 'Top' };
const RM = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
const SPEEDS = [0.25, 0.5, 1];
const SPEED_TEXT = { 0.25: '¼×', 0.5: '½×', 1: '1×' };
/* legend/label colours: the same hex values the scene's objects are drawn with */
const SWATCH = { ...COLORS, basketball: 0xD9783F, tennis: 0xC9DB57, graphite: P.graphite, string: 0xD9DDE3, hand: 0xC9A27E, rough: 0x8A8178, glass: 0x9FB7D6,
  velocity: P.velocity, omega: P.omega, applied: P.applied, highlight: P.highlight, ink: P.ink, weight: P.weight, normal: P.normal, friction: P.friction, tension:P.tension };
const cssColor = c => '#' + (SWATCH[c] ?? P.ink).toString(16).padStart(6, '0');
function swatch(k) {
  const c = cssColor(k.c || 'ink'), kind = k.k || (k.c ? 'body' : 'dim'), s = `stroke="${c}" stroke-width="1.6" fill="none" stroke-linecap="round"`;
  const g = { body: `<circle cx="8" cy="8" r="5.5" fill="${c}"/>`, point: `<circle cx="8" cy="8" r="5" ${s}/><circle cx="8" cy="8" r="2.2" fill="${c}"/>`,
    dim: `<path d="M3 3h10M3 13h10M8 3v10" ${s}/>`, angle: `<path d="M2 13h12M2 13L12 4" ${s}/><path d="M8 13a6 6 0 0 0-1.4-3.9" ${s}/>`,
    arrow: `<path d="M2 8h9" ${s}/><path d="M10 4l4 4-4 4z" fill="${c}"/>`, spin: `<path d="M12.5 6.5A5 5 0 1 0 13 9.5" ${s}/><path d="M10.5 4.8l3.4 1.2-1.2 3.4z" fill="${c}"/>`,
    line: `<path d="M1.5 8h13" stroke="${c}" stroke-width="2.2" stroke-linecap="round"/>` }[kind] || '';
  return `<svg class="dv-sw" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">${g}</svg>`;
}

/* mountDailyVisual(el, descriptor, opts) → { update, replay, resize, setView, setTime, state, destroy }.
   The canvas fills its host; a small symbolic key stays on it and full descriptions live in the info popover.
   opts.compact is accepted for older consumers but the measured size decides. */
export async function mountDailyVisual(el, desc, opts = {}) {
  injectCss();
  if (!desc || !B[desc.scene]) throw new Error('No prepared scene for this problem.');
  const wrap = document.createElement('div'); wrap.className = 'dv'; wrap.setAttribute('role', 'figure'); el.appendChild(wrap);
  wrap.innerHTML = `<div class="dv-main"><div class="dv-view"><div class="dv-stage"></div><div class="dv-labels" aria-hidden="true"></div>
    <div class="dv-top"><div class="dv-seg dv-views" role="group" aria-label="View"></div><div class="dv-seg dv-force" hidden><button class="dv-forces" type="button" aria-pressed="true">Forces</button><button class="dv-breakdown" type="button" aria-pressed="false" hidden>Breakdown</button></div><button class="dv-detail" type="button" aria-pressed="false" hidden></button><div class="dv-seg dv-parts" role="group" aria-label="Part"></div><div class="dv-focus" hidden><button class="dv-focus-back" type="button" title="Back to the full setup"><span aria-hidden="true">${controlIcon('left')}</span> Full setup</button><span class="dv-focus-label" role="status"></span></div><span class="dv-grow"></span>
    <span class="dv-readout" hidden></span><button class="dv-btn dv-icon dv-info" type="button" aria-label="About this scene" title="About this scene" aria-expanded="false">i</button><button class="dv-btn dv-icon dv-exp" type="button" aria-label="Expand" title="Expand">⤢</button></div>
    <div class="dv-pop" hidden></div><div class="dv-camera" role="group" aria-label="Camera controls">
      <div class="dv-seg"><button class="dv-zoom-out dv-icon" type="button" aria-label="Zoom out" title="Zoom out">−</button><button class="dv-zoom-in dv-icon" type="button" aria-label="Zoom in" title="Zoom in">+</button><button class="dv-fit" type="button" title="Fit the current scene and resume following">Fit</button></div>
      <button class="dv-pan" type="button" aria-pressed="false" title="Drag to move the view">Move</button>
      <div class="dv-seg dv-tracking" role="group" aria-label="Motion framing" hidden><button class="dv-follow" type="button"></button><button class="dv-overview" type="button">Whole flight</button></div>
      <span class="dv-gesture">Drag to turn · Scroll or pinch to zoom</span></div><aside class="dv-legend" aria-label="Key"></aside></div></div><p class="dv-assumption" hidden></p><div class="dv-ctrl"></div>`;
  const q = s => wrap.querySelector(s), stageEl = q('.dv-stage'), labEl = q('.dv-labels'), legendEl = q('.dv-legend'), ctrlEl = q('.dv-ctrl'), popEl = q('.dv-pop'), cameraEl = q('.dv-camera');
  if (opts.embedded) q('.dv-exp').hidden = true;
  preparedChrome(wrap);
  const studio = await makeStudio(stageEl, { fov: 30 });
  studio.controls.enablePan = true; studio.controls.screenSpacePanning = true; studio.controls.enableDamping = true;
  studio.controls.touches.ONE = THREE.TOUCH.ROTATE; studio.controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
  studio.renderer.domElement.tabIndex = 0;
  studio.renderer.domElement.setAttribute('aria-label', 'Interactive 3D view. Drag to turn, scroll or pinch to zoom. Use Move to drag the view.');
  let D = desc, variant = null, built = null, ctx = null, view = 'setup', expanded = false, raf = 0, alive = true, visible = true, userOrbit = false, panMode = false, cameraMode = 'follow', cameraUI = '';
  const forceIntent = createForceIntent(opts);
  let forcesOn = forceIntent.on;
  let forceTarget = 0;
  let detailView = false, manualDetail = false, breakdownOn = false, answerBreakdownRequested = false;
  const canAnswerBreakdown = opts.allowAnswerBreakdown === true || opts.intent === 'library';
  let exploreVal = D.explore ? D.params[D.explore.param] : null;
  // focus: the state being shown (null = no close-up), the pending acknowledgement, and the last displayed report
  let focusId = null, focusStep = null, focusSeq = 0, focusAck = null, displayed = null;
  const player = { dyn: null, t: 0, playing: false, last: 0, speed: 1 };
  const side = () => wrap.clientWidth >= 600;
  const compact = () => wrap.clientWidth < 460;
  // wide and short (an inline band): the key moves to a left column and the fit reserves its width instead of its height
  const wide = () => { const v = q('.dv-view'); return !!v && v.clientWidth >= 640 && v.clientWidth >= 2.1 * v.clientHeight; };
  const snapSpeed = s => SPEEDS.reduce((a, b) => Math.abs(b - s) < Math.abs(a - s) ? b : a, 1);
  player.speed = snapSpeed(D.dynamics?.speed ?? 1);

  function clearScene() {
    if (ctx) { ctx.arrows.forEach(a => a.dispose()); disposeProp(ctx.root); }
    labEl.innerHTML = ''; built = null; ctx = null; player.dyn = null; player.playing = false; player.t = 0;
  }
  const currentVariant = () => (D.variants || []).find(x => x.id === variant) || (D.variants || [])[0] || null;
  /* keep.camera leaves the camera where it is; keep.ctrl leaves the control strip in place (a slider being dragged) */
  function build(keep = {}) {
    clearScene();
    const v = currentVariant(); variant = v ? v.id : null;
    let params = v ? v.params : D.params; if (D.explore && exploreVal != null) params = { ...params, [D.explore.param]: exploreVal };
    ctx = { root: new THREE.Group(), arrows: [] }; studio.scene.add(ctx.root);
    built = B[D.scene](ctx, params, v);
    const canMove = D.dynamics && built.dyn && (!v || v.dynamics !== false);
    // the natural motion is always playable; answer marks and notes come only with dynamics.answer (solution opened)
    const showAnswer = !!D.dynamics?.answer || (canAnswerBreakdown && answerBreakdownRequested);
    if (canMove) player.dyn = built.dyn({ ...D.dynamics, params: { ...D.dynamics.params, ...((v && v.dynamics_params) || {}) } }, showAnswer);
    // a Breakdown that states the result (5.23's 3v, 9.3's ω along the contact line) waits for the solution, like answer marks
    if (built.breakdown?.off) { for (const g of built.breakdown.groups || []) if (g) g.visible = false; built.breakdown = null; }
    if (built.breakdown?.answer && !(canMove && showAnswer)) { built.breakdown.locked = true; for (const g of built.breakdown.groups || []) if (g) g.visible = false; }
    built.labels.forEach(L => { const s = document.createElement('span'); s.className = 'dv-lab' + (L.cls ? ' dv-' + L.cls : '') + (L.c ? ' dv-c' : ''); s.textContent = L.text;
      if (L.c) s.style.setProperty('--c', cssColor(L.c)); if (L.height) s.classList.add('dv-height'); labEl.appendChild(s); L.el = s; });
    if (!keep.camera) { const size = built.box.getSize(V()).length(); studio.frame(built.box.getCenter(V()), Math.max(size * 0.6, 0.4)); clipBase = null; cameraMode = player.dyn?.defaultCameraMode || 'follow'; }
    q('.dv-readout').hidden=!player.dyn?.readout;
    renderLegend(); renderTop(); if (keep.ctrl) { const x = q('.dv-exv'); if (x) x.textContent = exploreVal + (D.explore.unit || ''); } else renderCtrl();
    syncCamera(); layout(); if (!keep.camera) fit(view, 0); setT(0);
    if (focusId && !built.focus) focusId = null;
    if (focusId) { applyFocusVisibility(); if (!userOrbit) focusCamera(0); }
  }

  /* Keep symbols and their actual object colours visible; descriptions and illustrative values are optional. */
  function renderLegend() {
    const v = currentVariant(), fs = focusSpec(focusId), key = (fs && fs.key) || [...((v && v.key) || D.key || []), ...(built?.forceKey || [])];
    const forceSymbols=new Set((built?.forceKey||[]).map(k=>k.sym));
    const help=k=>forceSymbols.has(k.sym)||['weight','normal','friction','tension','applied'].includes(k.c);
    // Reserve the same space off/on, while withholding force labels/explanations until Reveal.
    legendEl.innerHTML = `<ul>${key.map(k => `<li${!forcesOn&&help(k)?' style="visibility:hidden" aria-hidden="true"':''} title="${esc(k.text)}" aria-label="${esc(k.sym + ': ' + k.text)}">${swatch(k)}<b>${esc(k.sym)}</b></li>`).join('')}</ul>`;
    popEl.innerHTML = `<ul class="dv-key-details">${key.filter(k=>forcesOn||!help(k)).map(k => `<li>${swatch(k)}<b>${esc(k.sym)}</b><span>${esc(k.text)}</span></li>`).join('')}</ul>${notes()}`;
  }
  function notes() {
    const v = currentVariant(), dyn = player.dyn ? D.dynamics : null;
    const fs = focusSpec(focusId);
    return (fs ? `<p class="dv-note dv-focus-note">${esc(fs.caption)}</p>` : '') + `<p class="dv-note">${esc((v && v.caption) || D.caption)}</p>${dyn ? `<p class="dv-note dv-motion">${esc(dyn.caption)}</p>` : ''}`
      + (built?.forceNote && (forcesOn||!built.forceGroups?.length) ? `<p class="dv-note">${esc(built.forceNote)}</p>` : '')
      + (dyn && dyn.answer ? `<p class="dv-note dv-answer"><span>After the solution</span>${esc(dyn.answer.caption)}</p>` : '');
  }
  function renderTop() {
    const views = (D.views || ['setup']).filter(x => VIEW_NAMES[x] && built?.views?.[x]);
    const next=nextView(views,view);
    q('.dv-views').innerHTML=views.length>1?'<button type="button" class="dv-view-cycle"></button>':'';
    const cycle=q('.dv-view-cycle');if(cycle){cycle.dataset.view=next;labelView(cycle,VIEW_NAMES[view]||'Setup',VIEW_NAMES[next]);}
    const fs = focusSpec(focusId), chip = q('.dv-focus'); chip.hidden = !fs; q('.dv-focus-label').textContent = fs ? fs.label : '';
    q('.dv-force').hidden = (!built?.forceGroups?.length && !built?.breakdown) || (!!fs && !manualDetail); q('.dv-forces').hidden = !built?.forceGroups?.length;
    q('.dv-forces').setAttribute('aria-pressed', String(forcesOn));
    q('.dv-forces').textContent = forceIntent.label;
    q('.dv-forces').title = forcesOn ? built?.forceNote || 'Real forces acting on the bodies' : 'Reveal the real forces acting on the bodies';
    const bd=q('.dv-breakdown');bd.hidden=!built?.breakdown;bd.disabled=!!built?.breakdown?.locked&&!canAnswerBreakdown;bd.title=built?.breakdown?.locked?(canAnswerBreakdown?'Show the velocity breakdown':'Available after opening the solution'):built?.breakdown?.title||'';bd.setAttribute('aria-pressed',String(breakdownShown()));
    const detail=q('.dv-detail');
    detail.hidden=(!built.detail&&!built.detailFocus)||!!fs;
    detail.textContent=detailView?built.detail?.returnLabel||'Full setup':built.detail?.label||built.detailFocus?.label||'';
    detail.title=detailView?'Back to the full setup':'Close-up; Full setup returns';
    detail.setAttribute('aria-pressed',String(detailView));
    let targetSelect=q('.dv-force-target');
    if (built?.forceTargets) {
      const sel = targetSelect || document.createElement('select'); sel.className = 'dv-force-target'; sel.setAttribute('aria-label','Forces on body');
      const options=built.forceTargets.map((t,i)=>`<option value="${i}">${esc(t.label)}</option>`).join('');
      if(sel.innerHTML!==options)sel.innerHTML=options;
      sel.value=String(forceTarget);
      sel.style.visibility=forcesOn?'visible':'hidden';sel.disabled=!forcesOn;
      if(!targetSelect)q('.dv-force').append(sel);
    } else targetSelect?.remove();
    const note=q('.dv-assumption'); note.hidden=!built.forceCaption; note.textContent=built.forceCaption || '';
    note.style.visibility=!built.forceGroups?.length||forcesOn?'visible':'hidden';note.setAttribute('aria-hidden',String(!!built.forceGroups?.length&&!forcesOn));
    chip.querySelector('.dv-focus-back').setAttribute('aria-label', 'Back to the full setup');
    q('.dv-views').hidden = !!fs;
    q('.dv-parts').innerHTML = (D.variants || []).length > 1 ? D.variants.map(x => `<button type="button" data-part="${esc(x.id)}" aria-pressed="${x.id === variant}" title="${esc(x.label)}">${esc(compact() ? '(' + x.id + ')' : x.label)}</button>`).join('') : '';
  }
  /* the control strip: Play/Pause, Reset, speed and a timeline for motion; a value slider for a static setup */
  function renderCtrl() {
    lastTime = '';
    if (player.dyn) {
      ctrlEl.innerHTML = `<button class="dv-btn dv-play" type="button"></button><button class="dv-btn dv-icon dv-reset" type="button" aria-label="Reset to the start" title="Reset">${controlIcon('reset')}</button>
        <button class="dv-btn dv-speed" type="button" aria-label="Playback speed" title="Playback speed"></button><input class="dv-scrub" type="range" min="0" max="1000" step="1" value="0" aria-label="Time">
        <span class="dv-time" aria-live="off"></span>`;
    } else if (D.explore) {
      const e = D.explore;
      ctrlEl.innerHTML = `<label class="dv-exl" for="dv-ex-${esc(D.problem_id)}">${esc(e.label)}</label><input class="dv-explore" id="dv-ex-${esc(D.problem_id)}" type="range" min="${e.min}" max="${e.max}" step="${e.step}" value="${exploreVal}" aria-label="${esc(e.label)}">
        <span class="dv-time dv-exv">${exploreVal}${esc(e.unit || '')}</span><button class="dv-btn dv-icon dv-exreset" type="button" aria-label="Back to the pictured value" title="Back to the pictured value">${controlIcon('reset')}</button>`;
    } else ctrlEl.innerHTML = `<span class="dv-hint">Drag to turn the view</span><button class="dv-btn dv-icon dv-reset" type="button" aria-label="Reset view" title="Reset view">${controlIcon('reset')}</button>`;
    syncCtrl();
  }
  let lastTime = '';
  function syncCtrl() {
    if (!player.dyn) return;
    const d = player.dyn, end = player.t >= d.duration - 1e-9, pb = q('.dv-play');
    const label = player.playing ? 'Pause' : end ? 'Replay' : 'Play', icon = controlIcon(player.playing ? 'pause' : end ? 'reset' : 'play');
    if (pb.dataset.state !== label) { pb.dataset.state = label; pb.innerHTML = `<span aria-hidden="true">${icon}</span>`; pb.setAttribute('aria-label', label); pb.title = label; }
    q('.dv-speed').textContent = SPEED_TEXT[player.speed];
    q('.dv-scrub').value = String(Math.round(player.t / d.duration * 1000));
    const txt = `${player.t.toFixed(1)} / ${d.duration.toFixed(1)} s`;
    if (txt !== lastTime) { lastTime = txt; q('.dv-time').textContent = txt; q('.dv-time').title = `t = ${player.t.toFixed(2)} s${d.readout ? ' · ' + d.readout(player.t) : ''}`; }
    if(d.readout)q('.dv-readout').textContent=d.readout(player.t);
  }
  function layout() {
    wrap.classList.toggle('dv-side', side()); wrap.classList.toggle('dv-compact', compact()); wrap.classList.toggle('dv-wide', wide());
    // labels and key grow a little with a large stage, so they stay readable beside a scene drawn several hundred px across
    // a tiny stage (a 320 phone's inline scene) keeps its rows for the drawing: the key moves into the i panel, which lists
    // every entry with its full text, and labels shrink a little; nothing on the drawing is dropped
    const v = q('.dv-view'), tiny = !!v && v.clientWidth > 0 && (v.clientHeight < 240 || v.clientWidth < 300);
    const s = !v ? 1 : tiny ? 0.88 : Math.max(1, Math.min(1.3, Math.min(v.clientWidth / 1.6, v.clientHeight) / 440)); wrap.style.setProperty('--dv-s', s.toFixed(3));
    wrap.classList.toggle('dv-tiny', tiny); legendEl.hidden = tiny;
    q('.dv-info').hidden = false;
    legendEl.style.top = `${q('.dv-top').offsetHeight + (compact() ? 12 : 16)}px`;
    syncCamera();
  }
  function closePop() { popEl.hidden = true; q('.dv-info').setAttribute('aria-expanded', 'false'); }

  function syncCamera() {
    player.dyn?.cameraMode?.(cameraMode);
    const signature = `${!!player.dyn?.overview}:${player.dyn?.followLabel}:${cameraMode}:${userOrbit}:${panMode}:${compact()}`;
    if (signature === cameraUI) return; cameraUI = signature;
    q('.dv-tracking').hidden = !player.dyn?.overview;
    const subject = player.dyn?.followLabel || 'motion';
    q('.dv-follow').textContent = compact() ? subject : `Follow ${subject}`;
    q('.dv-follow').title = `Follow ${subject}`;
    q('.dv-follow').setAttribute('aria-label', `Follow ${subject}`);
    q('.dv-overview').textContent = compact() ? 'All' : 'Whole flight';
    q('.dv-overview').title = 'Whole flight'; q('.dv-overview').setAttribute('aria-label', 'Whole flight');
    q('.dv-follow').setAttribute('aria-pressed', String(cameraMode === 'follow' && !userOrbit));
    q('.dv-overview').setAttribute('aria-pressed', String(cameraMode === 'overview' && !userOrbit));
    q('.dv-pan').setAttribute('aria-pressed', String(panMode));
    q('.dv-gesture').textContent = panMode ? 'Drag to move · Scroll or pinch to zoom' : 'Drag to turn · Scroll or pinch to zoom';
    stageEl.classList.toggle('dv-moving', panMode);
  }
  // Cancel an eased preset before accepting input. Its unfinished transition must never pull the camera back.
  function manualCamera() { studio.moveCamera(studio.camera.position.clone(), studio.controls.target.clone(), 0); userOrbit = true; syncCamera(); }
  function zoom(factor) {
    manualCamera(); const offset = studio.camera.position.clone().sub(studio.controls.target);
    offset.setLength(Math.max(studio.controls.minDistance, Math.min(studio.controls.maxDistance, offset.length() * factor)));
    studio.moveCamera(studio.controls.target.clone().add(offset), studio.controls.target.clone(), 0); drawNow(); schedule();
  }

  let clipBase = null;
  /* camera: keep every box corner inside the view at the chosen direction (margin m) */
  function fit(name, ms, box) {
    const vs = box && player.dyn?.views ? player.dyn.views : built.views, [az, el] = (vs[name] || vs.setup || built.views.setup).map(x => x * DEG);
    fitDir(V(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize(), ms, box || built.box);
  }
  function fitDir(dir, ms, b, upHint) {
    const c = b.getCenter(V());
    const cam = studio.camera, H = Math.max(1, stageEl.clientHeight), W = Math.max(1, stageEl.clientWidth), aspect = Math.max(0.3, W / H), tv = Math.tan(cam.fov * DEG / 2), th = tv * aspect;
    const fwd = dir.clone().negate(), up0 = upHint || (Math.abs(dir.y) > 0.98 ? V(0, 0, -1) : V(0, 1, 0)), right = fwd.clone().cross(up0).normalize(), up = right.clone().cross(fwd);
    const isWide = !!stageEl.closest?.('.dv-wide'), keyW = isWide && !legendEl.hidden ? legendEl.offsetWidth + 24 : 0;
    const top = q('.dv-top').offsetHeight + (isWide ? 8 : legendEl.offsetHeight + 20), bottom = 12;
    const mx = 0.88 * (1 - keyW / W), my = Math.max(0.22, 1 - (top + bottom) / H) * 0.94; let dist = 0.1;
    const hs = b.getSize(V()).multiplyScalar(0.5), pts = [];
    if (b.round) for (let i = 0; i < 48; i++) { const a = i / 24 * Math.PI; for (const y of [-hs.y, hs.y]) pts.push(V(Math.cos(a) * hs.x, y, Math.sin(a) * hs.z)); }
    else for (let i = 0; i < 8; i++) pts.push(V(i & 1 ? hs.x : -hs.x, i & 2 ? hs.y : -hs.y, i & 4 ? hs.z : -hs.z));
    for (const k of pts) { const z = k.dot(fwd); dist = Math.max(dist, Math.abs(k.dot(right)) / (th * mx) - z, Math.abs(k.dot(up)) / (tv * my) - z); }
    cam.up.copy(up0);
    // clip planes, fog and the orbit limit follow the framed distance, so a box hundreds of metres tall (5.23 b) is drawn, not culled
    const previousDistance = cam.position.distanceTo(studio.controls.target);
    const need = Math.max(dist + b.getSize(V()).length(), ms ? previousDistance + c.distanceTo(studio.controls.target) : 0), fog = studio.scene.fog;
    if (!clipBase) clipBase = { near: cam.near, far: cam.far, fn: fog?.near, ff: fog?.far, maxD: studio.controls.maxDistance };
    studio.controls.maxDistance = Math.max(clipBase.maxD, dist * 1.5, ms ? previousDistance * 1.1 : 0);   // include the transition's starting camera too
    cam.near = Math.max(clipBase.near, dist * 2e-4); cam.far = Math.max(clipBase.far, need * 3); cam.updateProjectionMatrix();
    if (fog) { fog.near = Math.max(clipBase.fn, need * 1.5); fog.far = Math.max(clipBase.ff, need * 6); }
    // Shift the optical centre to leave room for both toolbars, without shrinking the apparatus unnecessarily.
    c.addScaledVector(up, (top - bottom) / H * dist * tv); if (keyW) c.addScaledVector(right, -keyW / W * dist * th);
    studio.moveCamera(c.clone().addScaledVector(dir, dist), c, RM.matches ? 0 : ms); userOrbit = false; syncCamera();
  }
  function setT(t) {
    player.t = t; if (player.dyn) { player.dyn.set(t);
      for (const g of player.dyn.hide || []) g.visible = t === 0;
      for (const g of player.dyn.show || []) g.visible = t > 0; }
    if (built?.focus) applyFocusVisibility();
    applyForces();
  }
  function applyForces() {
    // Authored cone close-ups deliberately isolate geometry or one force's components.
    // Keep that guidance; ordinary Setup/Side and manual orbit never change this toggle.
    if (focusId && built?.focus) return;
    for (const g of built?.forceGroups || []) g.visible = forcesOn && (!built.forceTargets || g === built.forceTargets[forceTarget]?.group);
    for (const g of built?.breakdown?.groups || []) if (g) g.visible = breakdownOn;
  }
  /* Breakdown: off by default (a clean setup); it needs the forces it splits, so turning it on reveals them explicitly.
     A scene with an authored components close-up (9.13) shows that state instead of a layer. */
  // a kinematic Breakdown (velocity, angular velocity) splits no force, so it neither needs nor reveals Forces
  const breakdownShown = () => !!built?.breakdown && (built.breakdown.focus ? focusId === built.breakdown.focus : breakdownOn && (built.breakdown.kinematic || forcesOn));
  function setBreakdown(on) {
    let b = built?.breakdown; if (!b) return false;
    if (b.locked) {
      if (!canAnswerBreakdown) return false;
      const t = player.t; answerBreakdownRequested = true; build({camera:true});
      if (player.dyn) setT(Math.min(t, player.dyn.duration));
      b = built?.breakdown; if (!b || b.locked) return false;
      opts.onHelpReveal?.({kind:'breakdown',assisted:true,intent:opts.intent||'learn'});
    }
    if (on && !forcesOn && !b.kinematic) setForces(true, { explicit: true });
    if (b.focus) { if (on) focus(b.focus, { manual: true, time: player.t, ms: 450 }); else if (focusId === b.focus) focus(built.detailFocus ? built.detailFocus.forces : 'overview', { manual: !!built.detailFocus, time: player.t, ms: 450 }); }
    else { breakdownOn = !!on; applyForces(); renderTop(); drawNow(); schedule(); }
    return breakdownShown();
  }
  function setForces(on = true, options = {}) {
    forcesOn = forceIntent.set(on, options); applyForces(); q('.dv-forces').setAttribute('aria-pressed', String(forcesOn));
    q('.dv-forces').textContent = forceIntent.label;
    if(manualDetail&&built.detailFocus) focus(forcesOn?built.detailFocus.forces:built.detailFocus.geometry,{manual:true,time:player.t,ms:250});
    renderTop();renderLegend();
    drawNow(); schedule(); return forcesOn;
  }

  // ── focus states: authored close-ups (descriptor.focus), applied once, framed by camera, acknowledged when drawn ──
  const focusSpec = id => (id && D.focus?.states?.find(s => s.id === id)) || null;
  const focusInfo = () => D.focus && built?.focus ? { scene_id: D.focus.scene_id, scene_revision: D.focus.revision, states: D.focus.states.map(s => ({ id: s.id, label: s.label })) } : null;
  function applyFocusVisibility() {
    const f = built.focus, fs = focusSpec(focusId), on = new Set(fs ? fs.overlays : []);
    for (const [name, g] of Object.entries(f.overlays)) g.visible = on.has(name);
    if (fs) for (const g of f.hide) g.visible = false;
    else for (const g of f.hide) if (!(player.dyn?.hide || []).includes(g) || player.t === 0) g.visible = true;
    for (const g of f.ghost || []) g.traverse(o => { if (!o.material) return; const m = o.material, u = m.userData;
      if (u.base === undefined) u.base = { transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite };
      m.transparent = fs ? true : u.base.transparent; m.opacity = fs ? 0.42 : u.base.opacity; m.depthWrite = fs ? false : u.base.depthWrite; m.needsUpdate = true; });
    applyForces();
  }
  /* the close-up camera: the state's plane seen along its normal, turned by yaw/elevation, framing anchors + overlays */
  function focusCamera(ms) {
    const fs = focusSpec(focusId), f = built.focus; if (!fs || !f) return;
    const c = fs.camera, pl = f.planes[c.plane](), up = pl.up.clone().normalize(), right = pl.right.clone().normalize();
    const normal = right.clone().cross(up).normalize(), yaw = c.yaw * DEG, el = c.elevation * DEG;
    const horiz = normal.clone().multiplyScalar(Math.cos(yaw)).addScaledVector(right, -Math.sin(yaw));
    const dir = horiz.multiplyScalar(Math.cos(el)).addScaledVector(up, Math.sin(el)).normalize();
    const box = new THREE.Box3();
    for (const a of c.frame) {
      if (a === 'overlays') { for (const n of fs.overlays) { const g = f.overlays[n]; if (g && g.userData.frame !== false) { g.updateMatrixWorld(true); box.union(new THREE.Box3().setFromObject(g)); } } }
      else if (f.anchors[a]) box.union(f.anchors[a]());
    }
    if (box.isEmpty()) return;
    const ctr = box.getCenter(V()), half = box.getSize(V()).multiplyScalar(0.5 * c.margin);
    fitDir(dir, RM.matches ? 0 : ms, new THREE.Box3(ctr.clone().sub(half), ctr.clone().add(half)), up);
  }
  /* show one authored state; resolves true once its camera move has finished and a frame with it has been drawn,
     false when the id is unknown or a newer request replaced it */
  function focus(id, opts = {}) {
    const fs = focusSpec(id);
    if (!fs || !built?.focus) return Promise.resolve(false);
    const seq = ++focusSeq; if (focusAck) { focusAck.res(false); focusAck = null; }
    const overview = id === 'overview', ms = RM.matches ? 0 : (opts.ms ?? 600);
    focusId = overview ? null : id; manualDetail = !overview && opts.manual === true;
    focusStep = typeof opts.step_id === 'string' ? opts.step_id : null; displayed = null;
    const pb = fs.playback || { mode: 'keep' };
    if (pb.mode === 'frozen' && player.dyn) { player.playing = false; setT(Math.max(0, Math.min(player.dyn.duration, manualDetail&&Number.isFinite(opts.time)?opts.time:pb.t || 0))); syncCtrl(); }
    else if (pb.mode === 'playing' && player.dyn && !player.playing) play();
    applyFocusVisibility(); closePop();
    if (overview) { view = fs.camera.view || 'setup'; followTarget = null; fit(view, ms, dynBox()); } else focusCamera(ms);
    renderLegend(); renderTop();
    return new Promise(res => { focusAck = { seq, id, due: performance.now() + ms, res }; drawNow(); schedule(); });
  }
  function ackFocus(now) {
    if (!focusAck || now < focusAck.due) return;
    const a = focusAck; focusAck = null; const fs = focusSpec(a.id);
    displayed = { scene_id: D.focus.scene_id, scene_revision: D.focus.revision, focus_state_id: a.id, step_id: focusStep, label: fs.label, caption: fs.caption, displayed: true };
    a.res(true); focusDisplayed(focusSource);
  }
  const focusSource = {
    focusInfo, isLive: () => alive,
    applyFocus: b => bindingFits(focusInfo(), b) ? focus(b.focus_state_id, { step_id: b.step_id }) : Promise.resolve(false),
    focusState: () => displayed ? { ...displayed, manual_camera: userOrbit, playing: player.playing, t: player.t } : null,
  };
  const unregisterFocus = registerFocusSource(focusSource);
  /* Labels sit at their projected anchor (+ a fixed pixel offset). Column labels (L.col) share one x beside their
     anchors and are spread top-to-bottom to a minimum gap, each with a straight leader; placement is a pure function
     of the current projection, so static scenes never move and moving bodies are tracked without easing. */
  const svgNS = 'http://www.w3.org/2000/svg', leaders = document.createElementNS(svgNS, 'svg'); leaders.setAttribute('class', 'dv-leaders'); labEl.before(leaders);
  const spots = new LabelSpots();   // sticky step-asides: a brief brush never makes a label jump a row and back
  function placeLabels() {
    spots.begin(); const fixed = { push: b => spots.fix(b) };
    const W = stageEl.clientWidth, H = stageEl.clientHeight, cam = studio.camera, cols = {}, supports=[], forceRects=[], clears=[], colRects={}, plains=[];
    const scr = L => { const p = (typeof L.at === 'function' ? L.at() : L.at.clone()).project(cam); return p.z > 1 || p.z < -1 || Math.abs(p.x) > 1.05 || Math.abs(p.y) > 1.05 ? null : [(p.x + 1) / 2 * W, (1 - p.y) / 2 * H]; };
    for (const L of built.labels) {
      let visible = true; for (let g=L.group; g; g=g.parent) if (!g.visible) { visible=false;break; }
      // Overview arrows are keyed by colour; labels belong to the readable detail.
      if(built.detailFocus && L.focus && !focusId) visible=false;
      const s = !visible ? null : scr(L);
      if (!s) { L.el.style.display = 'none'; continue; }
      L.el.style.display = '';
      if (L.col) { (cols[L.col] = cols[L.col] || []).push([L, s]); continue; }
      const [dx, dy] = L.px || [0, 0]; if (L.clearOf) { clears.push([L, s[0] + dx, s[1] + dy]); continue; }
      L.el.style.transform = `translate(${(s[0] + dx).toFixed(1)}px, ${(s[1] + dy).toFixed(1)}px) translate(-50%, -50%)`;
      if(L.avoidForces)supports.push([L,s,s[0]+dx,s[1]+dy]); else plains.push([L, s[0] + dx, s[1] + dy, Math.hypot(dx, dy) ? [dx / Math.hypot(dx, dy), dy / Math.hypot(dx, dy)] : [0, -1]]);
    }
    let lines = '';
    for (const items of Object.values(cols)) {
      const left = items[0][0].colSide === 'left', ordered = items.every(([L]) => Number.isFinite(L.colOrder));
      const rightX = Math.max(...items.map(([, s]) => s[0])) + (ordered ? 24 : 18);
      const x = left ? Math.max(28, Math.min(...items.map(([, s]) => s[0])) - 24) : ordered ? Math.min(W - 28, rightX) : rightX;
      const gap = ordered ? 24 : compact() ? 16 : 18;
      items.sort((a, b) => ordered ? a[0].colOrder - b[0].colOrder : a[1][1] - b[1][1]);
      const ys = []; items.forEach(([, s], i) => ys.push(i ? Math.max(s[1], ys[i - 1] + gap) : s[1]));
      const over = ys.length ? ys[ys.length - 1] - (H - 12) : 0; if (over > 0) for (let i = ys.length - 1; i >= 0; i--) ys[i] = Math.min(ys[i], (i === ys.length - 1 ? H - 12 : ys[i + 1] - gap));
      items.forEach(([L, s], i) => { L.el.style.transform = `translate(${x.toFixed(1)}px, ${ys[i].toFixed(1)}px) translate(${left ? '-100%' : '0'}, -50%)`;
        { const w = L.el.offsetWidth, h = L.el.offsetHeight; fixed.push([left ? x - w / 2 : x + w / 2, ys[i], w, h]); }
        if(L.col==='force-left'||L.col==='force-right') { const w=L.el.offsetWidth||Math.max(16,L.text.length*9+6),h=L.el.offsetHeight||20,r={x:x-(left?w:0),y:ys[i]-h/2,w,h};forceRects.push(r);(colRects[L.col]=colRects[L.col]||[]).push(r); }
        lines += `<line x1="${(s[0] + (left ? -2 : 2)).toFixed(1)}" y1="${s[1].toFixed(1)}" x2="${(x + (left ? 3 : -3)).toFixed(1)}" y2="${ys[i].toFixed(1)}"/>`; });
    }
    // A right-aligned annotation stays left of the whole column it names (every row, not only the current one), so its place
    // depends on the camera alone and does not shift as a body moves past it; where one line does not fit before the stage
    // edge (a narrow pane) the word goes above its value, in the same place, instead of sliding under the column.
    for (const [L, x0, y] of clears) {
      const s = L.el.style; if (!L.wrapped) L.w0 = L.el.offsetWidth || L.text.length * 7 + 8;
      const w = L.w0, rs = colRects[L.clearOf] || [], hit = rs.filter(r => r.x < x0 + 6 && r.x + r.w > x0 - w - 6);
      let x = hit.length ? Math.min(x0, Math.min(...hit.map(r => r.x)) - 6) : x0;
      const wrap = x - 4 < w; if (wrap !== !!L.wrapped) { L.wrapped = wrap; s.whiteSpace = wrap ? 'pre-line' : ''; s.textAlign = wrap ? 'right' : ''; L.el.textContent = wrap ? L.text.replace(/ (?=\S+ m$)/, '\n') : L.text; }
      x = Math.max(x, (wrap ? L.el.offsetWidth : w) + 4);
      L.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-100%, -50%)`;
      plains.push([L, x - L.el.offsetWidth / 2, y, [-1, 0]]);   // a height mark steps left along its row, off the ruler
    }
    // Ground annotations get a separate readable row below nearby force symbols.
    // Only presentation moves: force tips and support anchors remain physical, with a leader.
    for(const [L,s,x,startY] of supports) {
      const w=L.el.offsetWidth||L.text.length*7+8,h=L.el.offsetHeight||20;let y=startY;
      for(let pass=0;pass<=forceRects.length;pass++) {
        const hits=forceRects.filter(r=>x+w/2+6>r.x&&x-w/2-6<r.x+r.w&&y+h/2+6>r.y&&y-h/2-6<r.y+r.h);
        if(!hits.length)break;y=Math.max(...hits.map(r=>r.y+r.h+h/2+6));
      }
      y=Math.min(H-h/2-4,y);L.el.style.transform=`translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;fixed.push([x,y,w,h]);
      lines+=`<line x1="${s[0].toFixed(1)}" y1="${s[1].toFixed(1)}" x2="${x.toFixed(1)}" y2="${(y-h/2-2).toFixed(1)}"/>`;
    }
    // Last, a label that still lands on another (a moving ring passing its r, a height mark under a force) steps along its own
    // offset, then across it, as Library labels do; the step-aside is held per label until its own place has been clear for a
    // few frames, so a body passing a label moves it once, not every frame. Nothing is hidden.
    plains.sort((a, b) => built.labels.indexOf(a[0]) - built.labels.indexOf(b[0]));
    for (const [L, x, y, d] of plains) {
      const w = L.el.offsetWidth, h = L.el.offsetHeight; if (!w) continue;
      const c = spots.place(L, [x, y], [x, y], d, w, h, W, H);
      if (c[0] !== x || c[1] !== y) L.el.style.transform = `translate(${c[0].toFixed(1)}px, ${c[1].toFixed(1)}px) translate(-50%, -50%)`;
    }
    spots.end();
    if (leaders.innerHTML !== lines) leaders.innerHTML = lines;
  }
  function frameLoop(now) {
    raf = 0; if (!alive) return;
    if (player.playing && player.dyn) {
      const dt = Math.min(0.05, (now - player.last) / 1000) * player.speed; player.last = now;
      const t = Math.min(player.dyn.duration, player.t + dt); setT(t); follow(); if (focusId && !userOrbit) focusCamera(0);
      if (t >= player.dyn.duration) player.playing = false;
      syncCtrl();
    }
    studio.render(now); placeLabels(); ackFocus(now); schedule();
  }
  let followTarget = null;
  const dynBox = () => detailView && built.detail ? built.detail.box() : !player.dyn || player.t <= 0 ? null : cameraMode === 'overview' && player.dyn.overview ? player.dyn.overview(player.t) : player.dyn.follow ? player.dyn.follow(player.t) : player.dyn.box || null;
  function follow() {
    if (userOrbit || !player.dyn || focusId) return;
    if (detailView && built.detail) { fit(view,0,built.detail.box());return; }
    if (player.dyn.follow) fit(view, 0, dynBox());
    else if (player.dyn.box && player.t > 0 && followTarget !== player.dyn.box) { followTarget = player.dyn.box; fit(view, 900, player.dyn.box); }
  }
  function schedule() { if (!raf && alive && visible && !document.hidden) raf = requestAnimationFrame(frameLoop); }
  // a size change clears the WebGL canvas; draw at once (resize observers run before paint) instead of waiting for the frame loop,
  // which is idle while the scene is scrolled away, so a resized or re-entering scene never shows an empty canvas with stale labels
  function drawNow() { if (alive && built) { studio.render(performance.now()); placeLabels(); } }
  const io = typeof IntersectionObserver === 'function' ? new IntersectionObserver(es => { const was = visible; visible = es.some(e => e.isIntersecting); if (visible && !was) drawNow(); schedule(); }, { rootMargin: '200px' }) : null; io?.observe(wrap);
  const onVis = () => schedule(); document.addEventListener('visibilitychange', onVis);
  let wasSide = null, wasCompact = null, lastSize = null;
  // Preserve a manually chosen direction, focal point and zoom relative to the scene when notes/expansion
  // change the canvas shape. Keeping the raw distance would crop the scene when the canvas becomes narrow.
  function resizeCamera() {
    const W = stageEl.clientWidth, H = stageEl.clientHeight;
    if (W < 1 || H < 1) return;
    studio.resize();
    if (built && userOrbit && lastSize && (lastSize.W !== W || lastSize.H !== H)) {
      const cam = studio.camera, offset = cam.position.clone().sub(studio.controls.target), dir = offset.clone().normalize();
      const fwd = dir.clone().negate(), right = fwd.clone().cross(cam.up).normalize(), up = right.clone().cross(fwd);
      const b = dynBox() || built.box, c = b.getCenter(V()), tv = Math.tan(cam.fov * DEG / 2);
      const needed = (w, h) => {
        const top = q('.dv-top').offsetHeight + legendEl.offsetHeight + 20, bottom = 12;
        const th = tv * Math.max(0.3, w / h), my = Math.max(0.22, 1 - (top + bottom) / h) * 0.94;
        let d = 0.1;
        for (let i = 0; i < 8; i++) {
          const k = V(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).sub(c), z = k.dot(fwd);
          d = Math.max(d, Math.abs(k.dot(right)) / (th * 0.88) - z, Math.abs(k.dot(up)) / (tv * my) - z);
        }
        return d;
      };
      offset.multiplyScalar(needed(W, H) / needed(lastSize.W, lastSize.H));
      studio.controls.maxDistance = Math.max(studio.controls.maxDistance, offset.length() * 1.2);
      studio.moveCamera(studio.controls.target.clone().add(offset), studio.controls.target.clone(), 0);
    } else if (built && !userOrbit) { if (focusId) focusCamera(0); else fit(view, 0, dynBox()); }
    lastSize = { W, H };
  }
  const ro = new ResizeObserver(() => {
    if (side() !== wasSide || compact() !== wasCompact) { wasSide = side(); wasCompact = compact(); layout(); if (built) renderTop(); }
    layout(); resizeCamera(); drawNow(); schedule();
  });
  ro.observe(stageEl); ro.observe(wrap);
  studio.controls.addEventListener('start', manualCamera);
  // a host that disables its own buttons while it saves must not leave the scene's controls dead
  const guard = new MutationObserver(ms => { for (const m of ms) if (m.target.disabled && m.target.closest?.('.dv') === wrap && !(m.target.classList.contains('dv-breakdown') && built?.breakdown?.locked)) m.target.disabled = false; });
  guard.observe(wrap, { subtree: true, attributes: true, attributeFilter: ['disabled'] });

  function play() {
    if (!player.dyn) return;
    if (player.t >= player.dyn.duration - 1e-9) { setT(0); followTarget = null; if (focusId) focusCamera(0); else fit(view, 0); }
    if (RM.matches) { setT(player.dyn.duration); follow(); player.playing = false; }
    else { player.playing = true; player.last = performance.now(); }
    syncCtrl(); schedule();
  }
  function reset() {
    forcesOn=forceIntent.reset();breakdownOn=false;const wasDetail=detailView;detailView=false;
    if(answerBreakdownRequested){answerBreakdownRequested=false;build({camera:true});}
    if(!player.dyn){applyForces();renderTop();renderLegend();if(wasDetail)fit(view,400);drawNow();schedule();return;}
    player.playing=false;setT(0);followTarget=null;
    if(manualDetail&&built.detailFocus)focus(forcesOn?built.detailFocus.forces:built.detailFocus.geometry,{manual:true,time:0,ms:400});
    else if(focusId)focusCamera(400);else fit(view,400);
    renderTop();renderLegend();syncCtrl();schedule();
  }
  wrap.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || !wrap.contains(b)) { if (!popEl.hidden && !e.target.closest('.dv-pop')) closePop(); return; }
    if (b.classList.contains('dv-zoom-in')) zoom(0.8);
    else if (b.classList.contains('dv-zoom-out')) zoom(1.25);
    else if (b.classList.contains('dv-forces')) setForces(!forcesOn, {explicit:true});
    else if (b.classList.contains('dv-breakdown')) setBreakdown(!breakdownShown());
    else if (b.classList.contains('dv-fit')) { if (focusId) focusCamera(350); else fit(view, 350, dynBox()); drawNow(); schedule(); }
    else if (b.classList.contains('dv-focus-back')) focus('overview', { step_id: null, ms: 600 });
    else if (b.classList.contains('dv-pan')) { panMode = !panMode; studio.controls.mouseButtons.LEFT = panMode ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE; studio.controls.touches.ONE = panMode ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE; syncCamera(); }
    else if (b.classList.contains('dv-follow') || b.classList.contains('dv-overview')) { cameraMode = b.classList.contains('dv-overview') ? 'overview' : 'follow'; fit(view, 350, dynBox()); drawNow(); schedule(); }
    else if (b.classList.contains('dv-detail')) {
      if(built.detailFocus) focus(forcesOn?built.detailFocus.forces:built.detailFocus.geometry,{manual:true,time:player.t,ms:450});
      else { detailView=!detailView;fit(view,350,dynBox());renderTop();drawNow();schedule(); }
    }
    else if (b.dataset.view) { detailView=false;manualDetail=false;view = b.dataset.view; if (focusId) { focusId = null; displayed = null; applyFocusVisibility(); renderLegend(); } fit(view, 700, dynBox()); renderTop(); }
    else if (b.dataset.part) { variant = b.dataset.part; build(); }
    else if (b.classList.contains('dv-play')) { if (player.playing) { player.playing = false; syncCtrl(); } else play(); }
    else if (b.classList.contains('dv-reset')) reset();
    else if (b.classList.contains('dv-speed')) { player.speed = SPEEDS[(SPEEDS.indexOf(player.speed) + 1) % SPEEDS.length]; syncCtrl(); }
    else if (b.classList.contains('dv-exreset')) { forcesOn = forceIntent.reset(); exploreVal = D.params[D.explore.param]; build({ camera: true }); fit(view, 400); }
    else if (b.classList.contains('dv-info')) { const o = popEl.hidden; popEl.hidden = !o; b.setAttribute('aria-expanded', String(o)); }
    else if (b.classList.contains('dv-exp')) setExpanded(!expanded);
    if (!b.classList.contains('dv-info') && !popEl.hidden) closePop();
  });
  wrap.addEventListener('input', e => {
    if (e.target.classList.contains('dv-scrub') && player.dyn) { player.playing = false; setT(+e.target.value / 1000 * player.dyn.duration); if(focusId&&!userOrbit)focusCamera(0);else follow(); syncCtrl(); schedule(); }
    else if (e.target.classList.contains('dv-explore')) { exploreVal = +e.target.value; build({ camera: true, ctrl: true }); }
  });
  wrap.addEventListener('change', e => {
    if (e.target.classList.contains('dv-explore')) fit(view, 400);
    else if (e.target.classList.contains('dv-force-target')) { forceTarget=+e.target.value; applyForces(); drawNow(); schedule(); }
  });
  // capture on window so an enclosing pane's own Escape and Tab handlers do not act under the expanded scene
  const onKey = e => {
    if (e.target === studio.renderer.domElement) {
      if (['+', '=', '-', '_', '0'].includes(e.key)) { e.preventDefault(); if (e.key === '0') { if (focusId) focusCamera(350); else fit(view, 350, dynBox()); } else zoom(e.key === '+' || e.key === '=' ? 0.8 : 1.25); return; }
    }
    const viewMenu=q('.dv-view-menu');if(e.key==='Escape'&&viewMenu&&!viewMenu.hidden){e.preventDefault();e.stopImmediatePropagation();viewMenu.hidden=true;q('.dv-camera-more').setAttribute('aria-expanded','false');q('.dv-camera-more').focus();return;}
    if (!expanded) return;
    if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); setExpanded(false); return; }
    if (e.key !== 'Tab') return;
    e.stopImmediatePropagation();
    const nodes = [...wrap.querySelectorAll('button,input,canvas[tabindex]')].filter(x => x.getClientRects().length), i = nodes.indexOf(document.activeElement);
    if (i < 0 || (e.shiftKey && i === 0) || (!e.shiftKey && i === nodes.length - 1)) { e.preventDefault(); nodes[e.shiftKey ? nodes.length - 1 : 0]?.focus(); }
  };
  addEventListener('keydown', onKey, true);
  let holder = null;
  function setExpanded(on) {
    expanded = on; const ex = q('.dv-exp');
    if (on) { holder = document.createElement('div'); holder.className = 'dv-backdrop'; holder.addEventListener('click', e => { if (e.target === holder) setExpanded(false); }); document.body.appendChild(holder); holder.appendChild(wrap); }
    else { el.appendChild(wrap); holder?.remove(); holder = null; }
    wrap.classList.toggle('dv-expanded', on); ex.textContent = on ? '✕' : '⤢'; ex.setAttribute('aria-label', on ? 'Close' : 'Expand'); ex.title = on ? 'Close' : 'Expand';
    layout(); renderTop();
    requestAnimationFrame(() => { resizeCamera(); drawNow(); schedule(); ex.focus({ preventScroll: true }); });
  }

  wrap.setAttribute('aria-label', `3D scene: ${D.title}`);
  layout(); build(); schedule();

  const handle = {
    update(next) {
      if (!next || next.problem_id !== D.problem_id || next.scene !== D.scene) throw new Error('update() takes the same problem; remount for a new one');
      const t = player.t, was = player.playing; D = next; if (!D.explore) exploreVal = null; build({ camera: true });
      if (player.dyn) { setT(Math.min(t, player.dyn.duration)); player.playing = was; player.last = performance.now(); syncCtrl(); }
      schedule();
    },
    replay() { if (!player.dyn) return false; setT(player.dyn.duration); play(); return true; },
    /* focus states: focus(id) for prepared ids; applyFocus(binding) checks scene, revision and id first */
    focus: (id, opts) => focus(id, opts), applyFocus: b => focusSource.applyFocus(b), focusInfo,
    get focusState() { return focusSource.focusState(); },
    resize() { layout(); resizeCamera(); drawNow(); schedule(); },
    reset,
    setForces,
    setBreakdown,
    setView(name) { if (built.views[name]) { detailView=false;manualDetail=false;focusId=null;displayed=null;if(built.focus)applyFocusVisibility();view = name; fit(view, 0, dynBox()); renderLegend();renderTop(); schedule(); } },
    setTime(t) { if (player.dyn) { player.playing = false; setT(Math.max(0, Math.min(player.dyn.duration, t))); followTarget = null; if (!userOrbit) {if(focusId)focusCamera(0);else fit(view, 0, dynBox());} syncCtrl(); schedule(); } },
    get state() { return { problem: D.problem_id, stage: D.stage, view, variant, playing: player.playing, t: player.t, duration: player.dyn?.duration ?? 0, speed: player.speed,
      hasMotion: !!player.dyn, explore: exploreVal, expanded, layout: side() ? 'side' : 'stacked', labels: built.labels.filter(l => l.el && l.el.style.display !== 'none').map(l => l.text),
      forces: forcesOn, forcesSupported: !!built.forceGroups?.length, breakdown: breakdownShown(), breakdownSupported: !!built.breakdown, breakdownLocked: !!built.breakdown?.locked,
      closeup: built.detail || built.detailFocus ? { label: built.detail?.label || built.detailFocus?.label, on: detailView || manualDetail } : null, forceIntent: forceIntent.intent, helpRevealed: forceIntent.revealed, forceNote: built.forceNote || '', physics: built.snapshot?.() || null,
      focus: focusSource.focusState(), labelStats: { ...spots.stats, recent: spots.stats.recent.slice(-8) },
      camera: { mode: cameraMode, manual: userOrbit, pan: panMode, distance: studio.camera.position.distanceTo(studio.controls.target), target: studio.controls.target.toArray(), position: studio.camera.position.toArray() } }; },
    destroy() {
      alive = false; unregisterFocus(); if (focusAck) { focusAck.res(false); focusAck = null; } if (raf) cancelAnimationFrame(raf); io?.disconnect(); ro.disconnect(); guard.disconnect(); removeEventListener('resize', studio.resize); document.removeEventListener('visibilitychange', onVis); removeEventListener('keydown', onKey, true);
      clearScene(); studio.controls.dispose(); studio.scene.environment?.dispose?.(); studio.renderer.dispose(); studio.renderer.forceContextLoss?.(); holder?.remove(); wrap.remove();
    },
  };
  wrap.__dv = handle;   // read-only state for hosts and isolated browser checks (wrap.__dv.state)
  return handle;
}
export const SCENE_KINDS = Object.keys(B);
// Same authored geometry, available to the isolated catalog audit (no renderer or live data).
export function buildPreparedScene(ctx, descriptor) { return B[descriptor.scene](ctx, descriptor.params); }
