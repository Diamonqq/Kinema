/* Kinema lesson runtime — the step ACTIONS the model directs and the stage executes (DESIGN-3.0 §4).
   focus · camera · pause_at · play · show · highlight · decompose · angle · dimension · sweep_integral · torque · ghost · zoom.
   The model never draws: it names a force, a body, an integrand; everything here is computed from the engine's frames. */
import * as THREE from 'three';
import { PALETTE, FORCE_COLOR, hex, clay, Arrow3D, angleArc, dimension, projectionLine, clamp } from '/js/studio.js';
import { integralSweep } from '/js/teaching_math.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z || 0);
const sub = { 1: '₁', 2: '₂', 3: '₃', 4: '₄' };

export class Lesson {
  /* ctx: { studio, world, spec, sim, E, getT(), setT(t), setPlaying(on, stopAt, speed), setOverlays(o), setHighlight(labels), setFocus(id), setSelected(sel), cams() } */
  constructor(ctx) { this.ctx = ctx; this.live = []; this.extraLabels = []; this.anim = []; this.formula = null; this.warnings = []; }

  warn(message) { if (!this.warnings.includes(message)) { this.warnings.push(message); (window.__errs = window.__errs || []).push(message); } }

  /* leave the previous step's drawings behind */
  clear() {
    for (const o of this.live) { try { o.dispose ? o.dispose() : (o.parent && o.parent.remove(o)); } catch (e) { /* already gone */ } }
    this.live = []; this.extraLabels = []; this.anim = []; this.formula = null; this.warnings = [];
    this.ctx.world.setFade(false);
  }

  apply(step) {
    this.clear();
    const { world, studio } = this.ctx;
    const acts = (step.actions || []).slice();
    // the legacy fields still work: at → pause_at, show → show, camera → camera, highlight → highlight
    if (step.at != null && !acts.some(a => a.type === 'pause_at' || a.type === 'play')) acts.unshift({ type: 'pause_at', t: step.at });
    if (step.show && step.show.length && !acts.some(a => a.type === 'show')) acts.unshift({ type: 'show', overlays: step.show });
    if (step.camera && !acts.some(a => a.type === 'camera' || a.type === 'zoom')) acts.unshift({ type: 'camera', view: step.camera });
    if (step.highlight && step.highlight.length && !acts.some(a => a.type === 'highlight')) acts.push({ type: 'highlight', items: step.highlight });
    for (const a of acts) { try { this.run(a); } catch (e) { this.warn('Step action ' + a.type + ' unavailable: ' + (e.message || e)); } }
  }

  run(a) {
    const c = this.ctx; const { world, studio } = c;
    switch (a.type) {
      case 'focus': if (a.body) { c.setFocus(a.body); world.setFade(a.fade !== false); } break;
      case 'camera': { const cams = c.cams(); if (a.view && cams[a.view]) { const [eye, tg] = cams[a.view](); studio.moveCamera(eye, tg, 700); } break; }
      case 'zoom': { const fr = c.E.frameAt(c.sim, c.getT()); const bid = a.body || world.focusId; const b = fr.bodies[bid]; if (!b) break; const bs = c.spec.bodies.find(x => x.id === bid); const half = bs ? (bs.shape === 'circle' ? bs.r : Math.max(bs.w || 0, bs.h || 0) / 2) : world.focusSize;
        const s = half * 2 * 2.6 / clamp(a.factor || 2, 1, 3) * 1.6;   // the body fills at most ~60 % of the view even at the tightest zoom
        const tg = V3(b.cx, b.cy); const dir = studio.camera.position.clone().sub(studio.controls.target).normalize(); const t = Math.tan(studio.camera.fov * Math.PI / 360); studio.moveCamera(tg.clone().addScaledVector(dir, s / 2 / t), tg, 700); break; }
      case 'pause_at': c.setPlaying(false); c.setT(a.t || 0); break;
      case 'play': c.setT(a.from || 0); c.setPlaying(true, a.to ?? null, a.speed || 1); break;
      case 'show': c.setOverlays(a.overlays || []); break;
      case 'highlight': c.setHighlight(a.items || []); break;
      case 'decompose': this.decompose(a); break;
      case 'angle': { const pts = a.points || []; if (pts.length >= 3) { const v = V3(pts[0][0], pts[0][1], 0.02), p1 = V3(pts[1][0], pts[1][1]), p2 = V3(pts[2][0], pts[2][1]); const a0 = Math.atan2(p1.y - v.y, p1.x - v.x), a1 = Math.atan2(p2.y - v.y, p2.x - v.x); const r = clamp(0.12 * world.bounds.size, 0.1, 0.8); const arc = angleArc(studio.scene, v, r, a0, a1 < a0 ? a1 + 2 * Math.PI : a1); this.live.push(arc); this.extraLabels.push({ key: 'act|angle|' + this.live.length, label: a.label || 'θ', plain: true, tip: arc.label, pin: arc.label, color: PALETTE.ink2 }); } break; }
      case 'dimension': { const pts = a.points || []; if (pts.length >= 2) { const p1 = V3(pts[0][0], pts[0][1], 0.02), p2 = V3(pts[1][0], pts[1][1], 0.02); const d = p2.clone().sub(p1); const n = V3(-d.y, d.x).normalize().multiplyScalar(0.08 * Math.max(d.length(), 0.5)); const dim = dimension(studio.scene, p1, p2, n, { tick: clamp(0.02 * d.length(), 0.03, 0.08) }); this.live.push(dim); this.extraLabels.push({ key: 'act|dim|' + this.live.length, label: a.label || (d.length().toFixed(2) + ' m'), plain: true, tip: dim.mid, pin: dim.mid, color: PALETTE.ink2 }); } break; }
      case 'sweep_integral': this.sweep(a); break;
      case 'torque': this.torque(a); break;
      case 'ghost': this.ghost(a); break;
      case 'energy_bars': c.setOverlays(['energy']); break;
      default: this.warn('Unsupported lesson action: ' + a.type); break;
    }
  }

  /* the force named by the model at the current frame: {vec, at, label, kind} */
  forceNamed(name, frame) {
    const c = this.ctx; const id = c.world.focusId; const fs = frame.forces.filter(f => f.body === id && !c.world.incompleteReactionJoints?.has(f.joint)).concat(c.world.stringForces ? c.world.stringForces(frame, id) : []);
    const norm = s => String(s || '').toLowerCase().replace(/[_\s]/g, '').replace(/[₁₂₃₄]/g, m => ({ '₁': '1', '₂': '2', '₃': '3', '₄': '4' })[m]);
    const want = norm(name);
    let f = fs.find(x => norm(x.label) === want) || fs.find(x => norm(x.kind) === want) || fs.find(x => (want === 'weight' || want === 'w' || want === 'mg') && x.kind === 'gravity') || fs.find(x => (want === 'n' || want === 'normal') && x.kind === 'normal') || fs.find(x => (want === 'f' || want === 'friction') && x.kind === 'friction')
      || fs.find(x => (want === 't' || want === 'tension') && x.kind === 'joint' && (x.synthetic || /^t/i.test(x.label || '')));
    return f || null;
  }
  /* split a force into components along a direction; dotted projections from the tip — the trig, drawn */
  decompose(a) {
    const c = this.ctx; const frame = c.E.frameAt(c.sim, c.getT()); const f = this.forceNamed(a.force || 'mg', frame); if (!f) { this.warn('Force decomposition unavailable: ' + (a.force || 'mg') + ' has no usable force measurement for this body.'); return; }
    let u = null; const along = a.along;
    if (Array.isArray(along)) u = new THREE.Vector2(along[0], along[1]).normalize();
    else if (along === 'x' || along === 'horizontal') u = new THREE.Vector2(1, 0);
    else if (along === 'y' || along === 'vertical') u = new THREE.Vector2(0, 1);
    else { const n = frame.forces.find(x => x.body === c.world.focusId && x.kind === 'normal'); if (n) { const nv = new THREE.Vector2(n.vec[0], n.vec[1]).normalize(); u = new THREE.Vector2(nv.y, -nv.x); } else if (a.along === 'velocity') { const b = frame.bodies[c.world.focusId]; u = new THREE.Vector2(b.vx, b.vy).normalize(); } else u = new THREE.Vector2(1, 0); }
    if (u.dot(new THREE.Vector2(f.vec[0], f.vec[1])) < 0 && along !== 'x' && along !== 'y') u.negate();   // point the along-axis the way the force leans
    const F = new THREE.Vector2(f.vec[0], f.vec[1]); const par = u.clone().multiplyScalar(F.dot(u)); const perp = F.clone().sub(par);
    const world = c.world; const gauge = world.gauge; const forces = frame.forces.filter(x => x.body === world.focusId); const maxF = Math.max(1e-9, ...forces.map(x => Math.hypot(x.vec[0], x.vec[1])));
    const origin = V3(f.at[0], f.at[1], 0.01); const col = FORCE_COLOR[f.kind] || PALETTE.ink; const scale = gauge / maxF;
    const tip = origin.clone().add(V3(F.x, F.y).multiplyScalar(scale));
    const a1 = new Arrow3D(c.studio.scene, col, world.gauge * 0.012, { opacity: 0.85 }), a2 = new Arrow3D(c.studio.scene, col, world.gauge * 0.012, { opacity: 0.85 });
    const parTip = origin.clone().add(V3(par.x, par.y).multiplyScalar(scale)), perpTip = origin.clone().add(V3(perp.x, perp.y).multiplyScalar(scale));
    const p1 = projectionLine(c.studio.scene, tip, parTip), p2 = projectionLine(c.studio.scene, tip, perpTip);
    this.live.push(a1, a2, p1, p2);
    const t0 = performance.now(); const ms = 650;
    this.anim.push(now => { const k = clamp((now - t0) / ms, 0, 1), e = 1 - Math.pow(1 - k, 3); a1.update(origin, V3(par.x, par.y), par.length() * scale * e); a2.update(origin, V3(perp.x, perp.y), perp.length() * scale * e); return k < 1; });
    const nm = (f.label || f.kind).replace(/^gravity$/, 'mg');
    // θ is the angle between the force and its PERPENDICULAR component (for the weight on a slope: the incline angle)
    const ang = perp.length() > 1e-9 ? Math.acos(clamp(F.dot(perp) / (F.length() * perp.length()), -1, 1)) : 0;
    const th = a.angle_label || 'θ'; const trig = a.along && (a.along === 'surface' || a.along === 'velocity' || Array.isArray(a.along)) && f.kind === 'gravity';
    this.extraLabels.push({ key: 'act|dec|par', label: trig ? `${nm}·sin ${th}` : `${nm}∥`, value: par.length(), unit: 'N', color: col, pref: 150, tip: parTip });
    this.extraLabels.push({ key: 'act|dec|perp', label: trig ? `${nm}·cos ${th}` : `${nm}⊥`, value: perp.length(), unit: 'N', color: col, pref: -30, tip: perpTip });
    if (trig && ang > 0.02) { const aF = Math.atan2(F.y, F.x); let aP = Math.atan2(perp.y, perp.x); while (aP - aF > Math.PI) aP -= 2 * Math.PI; while (aP - aF < -Math.PI) aP += 2 * Math.PI;
      const arc = angleArc(c.studio.scene, origin.clone(), gauge * 0.42, aF, aP); this.live.push(arc); this.extraLabels.push({ key: 'act|dec|ang', label: `${th} = ${(ang * 180 / Math.PI).toFixed(0)}°`, plain: true, tip: arc.label, color: PALETTE.ink2, pref: 120 }); }
  }
  /* a slice sweeps a non-uniform body while the integral accumulates — the integration, seen */
  sweep(a) {
    const c = this.ctx; const bid = a.body || c.world.focusId; const b = c.spec.bodies.find(x => x.id === bid); if (!b || b.shape !== 'box') { this.warn('Integral animation unavailable: this action requires a rod or box body.'); return; }
    const lam = b.lambda ? c.E.compileExpr(b.lambda) : (() => (b.mass || 1) / b.w);
    const expr = a.integrand && a.integrand !== 'lambda' ? c.E.compileExpr(a.integrand) : null;
    const g = (x) => { const l = b.w, L = lam({ x, l }); return expr ? expr({ x, l, lambda: L, m: b.mass || 1, r: 0 }) : L; };
    const x0 = a.from ?? -b.w / 2, x1 = a.to ?? b.w / 2;
    const dur = clamp(Number.isFinite(a.duration) ? a.duration : 4, 0.1, 30) * 1000;
    const integral = integralSweep(g, x0, x1), peak = Math.max(1e-9, integral.peak);
    const mesh = c.world.meshes[bid]; const H = Math.max(b.h * 3, 0.12 * b.w);   // strip height at the peak
    const slice = new THREE.Mesh(new THREE.BoxGeometry(1, 1, b.h * 1.4), clay(PALETTE.highlight, { transparent: true, opacity: 0.95, emissive: PALETTE.highlight, emissiveIntensity: 0.25 })); slice.renderOrder = 8; mesh.add(slice);
    const area = new THREE.Group(); mesh.add(area); const strips = []; this.live.push(slice, area);
    const units = a.units || (expr ? '' : 'kg'); const symbol = a.label || (expr ? (a.integrand.includes('x^2') || a.integrand.includes('x*x') ? 'I' : a.integrand.includes('x') ? 'M·x̄' : '∫') : 'M');
    const t0 = performance.now(); let shownStrips = 0;
    const label = { key: 'act|sweep', label: symbol, value: 0, unit: units, color: PALETTE.ink, pref: 80, tip: V3(0, 0), plain: false, formula: true }; this.extraLabels.push(label);
    this.anim.push(now => {
      const k = clamp((now - t0) / dur, 0, 1); const { x, value, acc } = integral.at(k);
      const h = H * Math.abs(value) / peak, sign = Math.sign(value) || 1;
      slice.visible = x0 !== x1 && h > 1e-12;
      slice.scale.set(Math.max(b.w * 0.012, 0.006), Math.max(h, 1e-12), 1); slice.position.set(x, sign * h / 2 + b.h / 2, 0);
      // An integer count bounds this work even for reversed or zero-width intervals.
      const targetStrips = x0 === x1 ? 0 : Math.floor(k * 48);
      for (; shownStrips < targetStrips; shownStrips++) {
        const sample = integral.at((shownStrips + 0.5) / 48), hs = H * Math.abs(sample.value) / peak;
        if (hs < 1e-12) continue;
        const s = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(x1 - x0) / 48, hs, b.h * 1.2), clay(PALETTE.body, { transparent: true, opacity: 0.35 }));
        s.position.set(sample.x, Math.sign(sample.value) * hs / 2 + b.h / 2, 0); area.add(s); strips.push(s);
      }
      const w = mesh.matrixWorld; label.tip.copy(V3(x, H + b.h, 0)).applyMatrix4(w); label.value = acc; label.extra = `x = ${x.toFixed(2)} m`;
      this.formula = { symbol, acc, x, x0, x1, units, integrand: a.integrand || 'λ(x)', done: k >= 1 };
      return k < 1;
    });
  }
  torque(a) {
    const c = this.ctx; const frame = c.E.frameAt(c.sim, c.getT()); const f = this.forceNamed(a.force || 'mg', frame); if (!f) { this.warn('Torque annotation unavailable: ' + (a.force || 'mg') + ' has no usable force measurement for this body.'); return; }
    let about = null; if (Array.isArray(a.about)) about = new THREE.Vector2(a.about[0], a.about[1]); else { const j = (c.spec.joints || []).find(x => x.id === a.about || x.type === 'pivot'); if (j && j.anchor) about = new THREE.Vector2(j.anchor[0], j.anchor[1]); else { const b = frame.bodies[c.world.focusId]; about = new THREE.Vector2(b.cx, b.cy); } }
    const r = new THREE.Vector2(f.at[0] - about.x, f.at[1] - about.y); const tau = r.x * f.vec[1] - r.y * f.vec[0];
    const lever = projectionLine(c.studio.scene, V3(about.x, about.y, 0.02), V3(f.at[0], f.at[1], 0.02), { opacity: 0.7 }); this.live.push(lever);
    const rad = clamp(0.35 * r.length(), 0.05, 0.6); const a0 = Math.atan2(r.y, r.x); const arc = angleArc(c.studio.scene, V3(about.x, about.y, 0.02), rad, a0, a0 + Math.sign(tau || 1) * 1.6); this.live.push(arc);
    this.extraLabels.push({ key: 'act|torque', label: 'τ = r × ' + (f.label || f.kind).replace(/^gravity$/, 'mg'), value: Math.abs(tau), unit: 'N·m' + (tau >= 0 ? ' ↺' : ' ↻'), color: PALETTE.omega, pref: -60, tip: arc.label });
    this.extraLabels.push({ key: 'act|lever', label: 'r', value: r.length(), unit: 'm', plain: false, color: PALETTE.ink2, pref: 100, tip: V3(about.x + r.x / 2, about.y + r.y / 2, 0.02), pin: V3(about.x + r.x / 2, about.y + r.y / 2, 0.02) });
  }
  ghost(a) {
    const c = this.ctx; const bid = a.body || c.world.focusId; const src = c.world.meshes[bid]; if (!src) return;
    for (const t of (a.at || [])) { const fr = c.E.frameAt(c.sim, t); const b = fr.bodies[bid]; if (!b) continue; const g = src.clone(true); g.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.28; o.castShadow = false; } if (o.isLineSegments) o.material = o.material.clone(), o.material.opacity = 0.1; }); g.position.set(b.x, b.y, src.position.z); g.rotation.z = b.a; c.studio.scene.add(g); this.live.push(g); this.extraLabels.push({ key: 'act|ghost|' + t, label: 't = ' + t.toFixed(2) + ' s', plain: true, tip: V3(b.cx, b.cy + c.world.focusSize * 1.1), pin: V3(b.cx, b.cy + c.world.focusSize * 1.1), color: PALETTE.ink2 }); }
  }
  /* per frame: advance animations; return the labels the step adds */
  tick(now) { this.anim = this.anim.filter(fn => { try { return fn(now); } catch (e) { this.warn('Lesson animation unavailable: ' + (e.message || e)); return false; } }); return this.extraLabels; }
}
