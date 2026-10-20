/* Kinema scene3d — ANY Kinema2D spec + its frames → studio meshes (DESIGN-3.0 §2, §5).
   Bodies in clay/steel, hairline edges, strings that wrap pulleys with the tension of the joint that carries them,
   force arrows keyed by body|kind|other, drafting annotations for the givens, picking (bodies, strings, pivots),
   focus + fade, trails, cameras from the apparatus envelope. Nothing scene-specific lives here. */
import * as THREE from 'three';
import { PALETTE, FORCE_COLOR, clay, steel, graphite, edges, darken, Arrow3D, Trail, angleArc, dimension, clamp, hex } from '/js/studio.js';
import { planTeaching, createTeaching } from '/js/teaching_views.js';
import { tangentStringPath, incompletePulleyReactions, jointTensionForSegment } from '/js/teaching_math.js';
import { createProp, createAxesTriad } from '/js/prop_library.js';
import { reserveFit, curlArrow } from '/js/rigid3d_view.js';

const LADDER_K = 0.16;
const FORCE_PREF = { gravity: 25, normal: -70, friction: 170, joint: -110, applied: 40, tension: 0 };
const reach = b => b.shape === 'circle' ? b.r : b.shape === 'box' ? Math.hypot(b.w, b.h) / 2 : 0;
const sizeOf = b => b.shape === 'circle' ? b.r : b.shape === 'box' ? Math.max(b.w, b.h) / 2 : 0.3;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z || 0);
/* A bar or block pinned to the world away from its own centre (a rod about one end) is held by a small hatched bracket on the side
   its swing never reaches: above the pin when the body stays below it through the whole run, below when it stays above; none when
   it goes round. Sized to the body, drawing only, never in the solver; the framed box holds it (envelope). */
export function pinMount(spec, sim, j) {
  if (j.type !== 'pivot' || !j.anchor) return null;
  const id = j.a === 'world' ? j.b : j.b === 'world' ? j.a : null, b = spec.bodies.find(o => o.id === id);
  if (!b || b.type === 'static' || b.shape !== 'box') return null;
  const [ax, ay] = j.anchor, L = Math.max(b.w, b.h); if (Math.hypot((b.pos?.[0] ?? ax) - ax, (b.pos?.[1] ?? ay) - ay) < 0.2 * L) return null;
  let lo = Infinity, hi = -Infinity; const poses = [{ cx: b.pos?.[0] || 0, cy: b.pos?.[1] || 0, a: b.angle || 0 }, ...((sim?.frames) || []).map(f => f.bodies?.[id]).filter(Boolean)];
  for (const s of poses) { const c = Math.cos(s.a || 0), n = Math.sin(s.a || 0);
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const y = s.cy + n * u * b.w / 2 + c * v * b.h / 2 - ay; lo = Math.min(lo, y); hi = Math.max(hi, y); } }
  const clear = 0.06 * L, dir = hi < clear ? 1 : lo > -clear ? -1 : 0; if (!dir) return null;
  const w = Math.min(0.5, Math.max(0.12, 0.3 * L)), gap = Math.max(clear, (dir > 0 ? hi : -lo) + 0.02 * L), t = 0.12 * w;
  return { dir, w, t, plate: ay + dir * (gap + 0.06 * L), tip: [ax, ay + dir * (gap + 0.06 * L + t)] };
}
/* the library prop that dresses a planar body: render.prop (the schema's allowed pairs), else inferred from the id or
   label. The physics outline stays exact: a pulley's groove, a wheel's tyre and a spool's flange sit at r; box props
   fill w × h; a ramp keeps its own extrusion and gains a running strip on the slope. */
const PLANAR_PROPS = { circle: ['pulley', 'wheel', 'spool'], box: ['block', 'cart', 'beam', 'ladder'], polygon: ['ramp', 'wedge'] };
export function planarProp(b) {
  const want = (b.render || {}).prop, ok = PLANAR_PROPS[b.shape] || [];
  if (want !== undefined) return ok.includes(want) ? want : null;
  const t = (b.id + ' ' + (b.label || '')).toLowerCase(), kind = (b.render || {}).kind;
  if (b.shape === 'circle' && kind !== 'sphere') return /pulley/.test(t) ? 'pulley' : /wheel/.test(t) ? 'wheel' : /spool|yo-?yo/.test(t) ? 'spool' : null;
  if (b.shape === 'box' && kind !== 'rod' && !b.lambda) return /cart|trolley/.test(t) ? 'cart' : /ladder/.test(t) ? 'ladder' : /plank|beam|board/.test(t) ? 'beam' : /block|crate/.test(t) ? 'block' : null;
  if (b.shape === 'polygon' && b.type === 'static' && (b.points || []).length === 3) return 'ramp';
  return null;
}

class Box2 {
  constructor() { this.min = new THREE.Vector2(Infinity, Infinity); this.max = new THREE.Vector2(-Infinity, -Infinity); }
  get ok() { return isFinite(this.min.x); } get w() { return this.max.x - this.min.x; } get h() { return this.max.y - this.min.y; }
  grow(x, y, r) { r = r || 0; this.min.x = Math.min(this.min.x, x - r); this.min.y = Math.min(this.min.y, y - r); this.max.x = Math.max(this.max.x, x + r); this.max.y = Math.max(this.max.y, y + r); return this; }
  union(o) { if (o && o.ok) { this.grow(o.min.x, o.min.y); this.grow(o.max.x, o.max.y); } return this; }
  clampTo(o) { if (!this.ok || !o.ok) return this; this.min.x = Math.max(this.min.x, o.min.x); this.min.y = Math.max(this.min.y, o.min.y); this.max.x = Math.min(this.max.x, o.max.x); this.max.y = Math.min(this.max.y, o.max.y); if (this.min.x > this.max.x || this.min.y > this.max.y) { this.min.set(Infinity, Infinity); this.max.set(-Infinity, -Infinity); } return this; }
  scaled(k) { const b = new Box2(); if (!this.ok) return b; const cx = (this.min.x + this.max.x) / 2, cy = (this.min.y + this.max.y) / 2, hw = this.w / 2 * k, hh = this.h / 2 * k; return b.grow(cx - hw, cy - hh).grow(cx + hw, cy + hh); }
  pad(p) { if (this.ok) { this.min.x -= p; this.min.y -= p; this.max.x += p; this.max.y += p; } return this; }
}
const byIdPos = (spec, id) => { const b = spec.bodies.find(x => x.id === id); return b ? [b.pos?.[0] || 0, b.pos?.[1] || 0] : null; };
/* A string that only names an applied pull (no joint carries it) draws that constant force: its body end is where the engine
   applies it, the body's centre plus the force's fixed world offset (it does not turn with the body), and its free world end is
   carried along with the body, so a rolled spool keeps its string and pull arrow attached instead of rolling past a fixed hand. */
function carriedPulls(spec) {
  const out = [], jointIds = new Set((spec.joints || []).map(j => j.id));
  for (const s of spec.strings || []) { const via = s.via || []; if (via.length !== 2) continue;
    const bi = via.findIndex(v => v.body && !v.wrap), wi = via.findIndex(v => v.world); if (bi < 0 || wi < 0) continue;
    const f = (spec.forces || []).find(x => x.body === via[bi].body && (s.tension || []).includes(x.label) && !jointIds.has(x.label)); const P = byIdPos(spec, via[bi].body); if (!f || !P) continue;
    out.push({ string: s, body: via[bi].body, bi, wi, offset: f.offset || [0, 0], hand: [via[wi].world[0] - P[0], via[wi].world[1] - P[1]] }); }
  return out;
}
/* the scene box = the apparatus (static geometry, start poses, joint anchors, string ends) + motion up to 2× it */
export function envelope(spec, sim, focusId, pad) {
  const app = new Box2(), motion = new Box2(), focusMotion = new Box2();
  for (const b of spec.bodies) { if (b.shape === 'edge') continue; if (b.shape === 'polygon') for (const p of b.points) app.grow((b.pos?.[0] || 0) + p[0], (b.pos?.[1] || 0) + p[1]); else app.grow(b.pos?.[0] || 0, b.pos?.[1] || 0, reach(b)); }
  for (const j of spec.joints || []) { for (const a of [j.anchor, j.anchorA, j.anchorB, j.groundA, j.groundB]) if (a) app.grow(a[0], a[1]); const pm = pinMount(spec, sim, j); if (pm) app.grow(...pm.tip); }
  for (const [, top] of spec.ropes || []) app.grow(top[0], top[1]);
  for (const p of spec.frame || []) app.grow(p[0], p[1]);   // drawing only: extra points the view must hold (a projectile's whole path, a struck ball's arrows)
  // a free pull (a string whose tension is only an applied force, not a joint) ends wherever the hand is; its terminal world point
  // frames at most 1.5x the apparatus from the point it pulls, so a 12 m lead does not shrink the spool (the whole string is still drawn)
  const forceLabels = new Set((spec.forces || []).map(f => f.label).filter(Boolean)), jointIds = new Set((spec.joints || []).map(j => j.id));
  const freePull = s => (s.tension || []).length > 0 && s.tension.every(r => forceLabels.has(r) && !jointIds.has(r));
  const pulls = [], hands = carriedPulls(spec);
  for (const s of spec.strings || []) { const via = s.via || [], free = freePull(s); via.forEach((v, i) => { if (!v.world) return; const end = i === 0 || i === via.length - 1, prev = via[i === 0 ? 1 : i - 1];
    if (free && end && prev) pulls.push([v.world, prev]); else app.grow(v.world[0], v.world[1]); }); }
  if (pulls.length && app.ok) { const k = 1.5 * Math.max(app.w, app.h, 0.5);
    for (const [P, prev] of pulls) { const A = prev.world || byIdPos(spec, prev.body); if (!A) { app.grow(P[0], P[1]); continue; } const dx = P[0] - A[0], dy = P[1] - A[1], L = Math.hypot(dx, dy), s = L > k ? k / L : 1; app.grow(A[0] + dx * s, A[1] + dy * s); } }
  if (sim) { const step = Math.max(1, Math.floor(sim.frames.length / 400)); for (let i = 0; i < sim.frames.length; i += step) { const fr = sim.frames[i]; for (const b of spec.bodies) { const s = fr.bodies[b.id]; if (b.type === 'static' || b.shape === 'edge' || !s) continue;
    // a moving polygon (a recoiling wedge) frames its own corners at each pose, not just its centre of mass
    const pts = b.shape === 'polygon' ? b.points.map(p => [s.x + Math.cos(s.a || 0) * p[0] - Math.sin(s.a || 0) * p[1], s.y + Math.sin(s.a || 0) * p[0] + Math.cos(s.a || 0) * p[1]]) : [[s.cx, s.cy]];
    for (const [x, y] of pts) { motion.grow(x, y, reach(b)); if (b.id === focusId) focusMotion.grow(x, y, reach(b)); }
    for (const h of hands) if (h.body === b.id) motion.grow(s.cx + h.hand[0], s.cy + h.hand[1]); } } }
  if (!app.ok) app.grow(0, 0, 1);
  // a lesson that shows the planar axes frames their origin (0, 0) and the x, y arrows with the apparatus
  if ((spec.steps || []).some(st => (st.show || []).includes('axes'))) { const k = 0.18 * Math.max(app.w, app.h, 0.5); app.grow(0, 0).grow(k, k); }
  // force arrows hang off the focus body only: its path gets the arrow pad, the rest of the apparatus a thin margin (padding every
  // side by an arrow length shrank a small block on a long ramp further)
  // a lone body held to a fixed point (rod, spring, rope or pivot to the world or a static body) has a bounded path: frame all of it
  // instead of clamping it and letting the full-setup view chase the bob away from its support
  const fixedEnd = id => id === 'world' || spec.bodies.some(b => b.id === id && b.type === 'static'), moving = spec.bodies.filter(b => b.type !== 'static' && b.shape !== 'edge');
  const tethered = moving.length === 1 && (spec.joints || []).some(j => ['rod', 'spring', 'rope', 'pivot'].includes(j.type) && [[j.a, j.b], [j.b, j.a]].some(([m, o]) => m === moving[0].id && fixedEnd(o)));
  const limit = tethered ? new Box2() : app.scaled(spec.frame_motion ?? 2);   // an empty box clamps nothing
  const box = new Box2().union(app).union(new Box2().union(motion).clampTo(limit)); box.pad(0.04 * Math.max(box.w, box.h));
  const fb = spec.bodies.find(b => b.id === focusId), fbox = new Box2().union(focusMotion);
  if (fb) fbox.grow(fb.pos?.[0] || 0, fb.pos?.[1] || 0, reach(fb));   // a still (no frames) keeps the pad round the start pose
  if (fbox.ok) box.union(fbox.clampTo(limit).pad(pad || 0));
  // reach: everywhere a body goes, unclamped, plus a quarter (wall and ledge slabs are drawn there, so a body followed past the framed box still
  // rolls on its drawn surface; nothing is fitted to it)
  const reachBox = new Box2().union(box).union(motion); reachBox.pad(0.25 * Math.max(reachBox.w, reachBox.h));
  return { box, reach: reachBox, appSize: Math.max(app.w, app.h), motionSize: focusMotion.ok ? Math.max(focusMotion.w, focusMotion.h) : 0 };
}
/* edge points are local to the body: the engine places them at pos, turned by angle. The floor plane sits at the lowest world
   edge point; only a horizontal edge lying there is the floor itself, an inclined or raised edge keeps its own slab */
export function edgeWorld(b) { const o = b.pos || [0, 0], c = Math.cos(b.angle || 0), s = Math.sin(b.angle || 0); return b.points.map(p => [o[0] + c * p[0] - s * p[1], o[1] + s * p[0] + c * p[1]]); }
export const flatEdge = ([a, c]) => Math.abs(a[1] - c[1]) <= 1e-6 * Math.max(1, Math.hypot(c[0] - a[0], c[1] - a[1]));
export function floorLineOf(spec) { const ys = spec.bodies.filter(b => b.shape === 'edge').flatMap(b => edgeWorld(b).map(p => p[1])); return ys.length ? Math.min(...ys) : null; }
/* the static edges drawn as slabs: every one but a horizontal edge on the floor line */
export function slabEdges(spec) { const f = floorLineOf(spec); return spec.bodies.filter(b => b.shape === 'edge' && b.type === 'static').map(b => [b, edgeWorld(b)]).filter(([, w]) => !(flatEdge(w) && Math.abs(w[0][1] - f) < 1e-6)); }

export function fitDistance(camera, w, h, margin) { const t = Math.tan((camera.fov || 26) * Math.PI / 360), a = camera.aspect || 1.6; return Math.max(h / 2 / t, w / 2 / (a * t), 1e-3) * (margin || 1.25); }

export function buildScene(studio, spec, sim) {
  const { scene, camera } = studio;
  const incompleteReactionJoints = incompletePulleyReactions(spec);
  const byId = {}; for (const b of spec.bodies) byId[b.id] = b;
  const dyn = spec.bodies.filter(b => b.type !== 'static' && b.shape !== 'edge');
  // a turntable on a stand (render.stand) makes the top view an upright tabletop: z is up, so the camera can look across the
  // table at a slant and orbit about the vertical axle; the studio applies it when it frames this scene
  const upright = !!spec.topdown && spec.bodies.some(b => (b.render || {}).stand);
  if (upright) studio.setUp?.(V3(0, 0, 1));
  // a body dropped onto another (render.drop_h above its resting height, landing at render.drop_t s) falls in the drawing only
  const dropOf = (id, t) => { const r = (byId[id] || {}).render || {}, h = +r.drop_h || 0, T = +r.drop_t || 0; return h && T && t < T ? h * (1 - (Math.max(0, t) / T) ** 2) : 0; };
  const inAir = (id, t) => { const r = (byId[id] || {}).render || {}; return !!(+r.drop_h && +r.drop_t && t < +r.drop_t - 1e-9); };
  // a static body that the scene loads explicitly (spec.forces on it: a rope element or a held spool in equilibrium) is a
  // force-bearing subject; an unloaded support (floor, wall, pivot) never is
  const loadedIds = new Set((spec.forces || []).map(f => f.body));
  const loadedStatic = spec.bodies.filter(b => b.type === 'static' && b.shape !== 'edge' && loadedIds.has(b.id));
  const forceSubjects = [...dyn, ...loadedStatic], isSubject = id => forceSubjects.some(b => b.id === id);
  let focusId = spec.focus || (dyn[0] || {}).id;
  // a discretised chain or rope (many identical elements) would draw a blur of tiny arrows on every bead: its All-bodies
  // force view shows the named focus element alone, with any other distinct body; a chosen body is unaffected
  const twinKey = b => [b.shape, b.r, b.w, b.h, b.mass].join('|'), twins = {};
  for (const b of dyn) twins[twinKey(b)] = (twins[twinKey(b)] || 0) + 1;
  const elementOf = id => { const b = byId[id]; return !!b && b.type !== 'static' && twins[twinKey(b)] > 8; };
  const allTargets = () => forceSubjects.filter(b => b.id === focusId || !elementOf(b.id)).map(b => b.id);
  const focusBody = byId[focusId]; const focusSize = focusBody ? sizeOf(focusBody) : 0.3; const focusIsBox = (focusBody || {}).shape === 'box';
  // force scale: a compact block's largest force reaches 1.3× its short side, so mg and N clear its faces; a long rod keeps 0.6× its length
  const gaugeK = Math.min(4, Math.max(0.5, +((focusBody || {}).render || {}).gauge_k || 1));   // drawing only: a small body on a long setup gets longer arrows
  const gaugeOwn = gaugeK * (focusIsBox ? Math.max(0.6 * focusSize, 1.3 * Math.min(focusBody.w, focusBody.h)) : 1.35 * focusSize);
  const { box: env, reach: travel, appSize, motionSize } = envelope(spec, sim, focusId, 0);
  // a point bob or a small ball on a large apparatus still gets arrows a reader can see in the full setup: at least a tenth of
  // the apparatus (drawing only; every arrow keeps its true proportion to the others)
  const gauge = Math.max(gaugeOwn, 0.1 * Math.max(appSize, 0.5));
  // A multi-body setup cannot follow just one mass without losing its partner.
  // Its full-setup presets must hold their actual swept extent (e.g. the lower
  // bob of a double pendulum), even when the initial pose is tightly folded.
  if(dyn.length>1) {
    const swept=new Box2();for(const fr of sim.frames||[])for(const b of dyn){const p=fr.bodies[b.id];if(p)swept.grow(p.cx,p.cy,reach(b));}
    env.union(swept.pad(0.04*Math.max(swept.w,swept.h)));
  }
  // Fit the arrows actually drawn along the motion, rather than a full arrow-radius halo
  // on every side of every pose. That halo made a shallow spring scene needlessly tiny.
  const forceFit = new Box2(), frameStride = Math.max(1, Math.floor((sim.frames?.length || 1) / 400));
  for (let i = 0; i < (sim.frames?.length || 0); i += frameStride) {
    const forces = (sim.frames[i].forces || []).filter(f => f.body === focusId && !incompleteReactionJoints.has(f.joint));
    const peak = Math.max(1e-9, ...forces.map(f => Math.hypot(...f.vec)));
    for (const f of forces) {
      if (f.at[0] < env.min.x || f.at[0] > env.max.x || f.at[1] < env.min.y || f.at[1] > env.max.y) continue;
      forceFit.grow(f.at[0] + f.vec[0] * gauge / peak, f.at[1] + f.vec[1] * gauge / peak);
    }
  }
  env.union(forceFit.pad(0.03 * Math.max(env.w, env.h)));
  const size = Math.max(env.w, env.h, 0.5);
  const arrowR = clamp(0.0032 * size, 0.005, 0.024), ropeR = clamp(0.0028 * size, 0.003, 0.012);
  const isSteel = b => /pulley|axle|spool|wheel/i.test(b.id + ' ' + (b.label || '')) || (b.render || {}).material === 'steel';
  const others = [PALETTE.body2, PALETTE.body3, PALETTE.body4]; let oi = 0;
  const colorOf = b => b.type === 'static' ? PALETTE.support : isSteel(b) && !((b.render || {}).material !== 'steel' && /wheel|spool/.test(planarProp(b) || '')) ? PALETTE.steel : b.id === focusId ? PALETTE.body : others[(oi++) % others.length];
  const depthOf = b => +(b.render || {}).thick > 0 ? +b.render.thick : b.shape === 'circle' ? Math.max(0.1, b.r * 0.42) : Math.max(0.08, Math.min(b.w || 1, b.h || 1) * 0.85);   // a block a little shallower than it is wide: at 1.2 its depth dominated the three-quarter view
  // a ladder's out-of-plane width is illustrative (its in-plane outline w x h stays exact): about a sixth of its length, so the
  // rails and rungs read as a ladder from the hero view instead of a bar
  const ladderDepth = b => Math.max(0.03, Math.min(b.w, b.h) * 0.16, LADDER_K * Math.max(b.w, b.h));
  const meshes = {}, zOf = {}, mats = {}, pickables = [];
  const tag = (obj, data) => { obj.traverse(o => { o.userData = { ...o.userData, ...data }; }); pickables.push(obj); };

  for (const b of spec.bodies) {
    if (b.shape === 'edge') continue;
    const kind = (b.render || {}).kind || (b.shape === 'circle' ? 'disk' : b.shape === 'box' ? 'box' : 'slab');
    zOf[b.id] = (b.render || {}).z || 0; const col = colorOf(b); let g = new THREE.Group(); const ms = []; const prop = planarProp(b);
    if (b.shape === 'circle' && kind === 'sphere') {
      const m = new THREE.Mesh(new THREE.SphereGeometry(b.r, 64, 48), clay(col)); m.castShadow = true; m.receiveShadow = true; g.add(m); ms.push(m.material);
      if (b.type !== 'static') { const ringM = clay(darken(col, 0.4), { transparent: true, opacity: 0.9 }); const r1 = new THREE.Mesh(new THREE.TorusGeometry(b.r * 1.002, b.r * 0.011, 8, 96), ringM); const r2 = r1.clone(); r2.rotation.x = Math.PI / 2; g.add(r1, r2); const dot = new THREE.Mesh(new THREE.SphereGeometry(b.r * 0.06, 12, 12), clay(darken(col, 0.5))); dot.position.set(0, b.r * 0.985, 0); g.add(dot); }
    } else if (b.shape === 'circle' && (prop === 'pulley' || prop === 'wheel' || prop === 'spool')) {
      // pulley: groove radius = r so the string (wrapped at r + rope radius) seats in it; wheel/spool stay inside r
      const p = createProp(prop, prop === 'pulley' ? { r: b.r, w: depthOf(b), axis: 'z' } : { r: b.r, h: Math.max(depthOf(b), b.r * (prop === 'spool' ? 0.8 : 0.3)), axis: 'z', envelope: true, color: col, ...(prop === 'spool' && (b.render || {}).inner ? { rt: b.render.inner, ri: b.render.inner * 0.8 } : {}) });
      g.add(p); p.traverse(o => { if (o.material && !ms.includes(o.material)) ms.push(o.material); });
    } else if (b.shape === 'circle' && b.inertia === 'hoop' && !isSteel(b)) {
      // a hoop's mass sits at its rim, so it is drawn as an open ring: outer radius exactly r (the contact), a thin band
      // and an empty centre; one dark block on the band shows the rotation without spokes implying mass inside
      const d = depthOf(b), t = b.r * 0.12, mat = clay(col);
      const ring = new THREE.Shape(); ring.absarc(0, 0, b.r, 0, Math.PI * 2, false);
      const hole = new THREE.Path(); hole.absarc(0, 0, b.r - t, 0, Math.PI * 2, true); ring.holes.push(hole);
      const band = new THREE.Mesh(new THREE.ExtrudeGeometry(ring, { depth: d, bevelEnabled: false, curveSegments: 96 }), mat);
      band.position.z = -d / 2; band.castShadow = true; band.receiveShadow = true; g.add(band); ms.push(mat); edges(band, 0.22, 30);
      if (b.type !== 'static') { const mark = new THREE.Mesh(new THREE.BoxGeometry(t * 1.1, t * 1.02, d * 1.04), clay(darken(col, 0.45))); mark.position.set(0, b.r - t / 2, 0); g.add(mark); }
    } else if (b.shape === 'circle') {
      const d = depthOf(b); const mat = isSteel(b) ? steel() : clay(col); const cyl = new THREE.Mesh(new THREE.CylinderGeometry(b.r, b.r, d, 96), mat); cyl.rotation.x = Math.PI / 2; cyl.castShadow = true; cyl.receiveShadow = true; g.add(cyl); ms.push(mat); edges(cyl, 0.22, 30);
      if (isSteel(b)) { const sp = steel(0xC3C8D2); for (let k = 0; k < 4; k++) { const spoke = new THREE.Mesh(new THREE.BoxGeometry(b.r * 1.9, b.r * 0.055, d * 0.2), sp); spoke.rotation.z = k * Math.PI / 4; spoke.position.z = d / 2 + 0.002; g.add(spoke); }
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(b.r * 0.16, b.r * 0.16, d * 1.35, 32), steel(0x6F7787)); hub.rotation.x = Math.PI / 2; g.add(hub); }
      else if (b.type !== 'static') { for (let k = 0; k < 2; k++) { const mark = new THREE.Mesh(new THREE.BoxGeometry(b.r * 1.9, b.r * 0.035, 0.003), clay(darken(col, 0.45))); mark.rotation.z = k * Math.PI / 2; mark.position.z = d / 2 + 0.002; g.add(mark); } }
      if ((b.render || {}).stand) {   // spindle and base down to the backdrop floor (round, so they look still while the platter turns)
        const zb = -0.35 * size - zOf[b.id], top = -d / 2, hS = top - zb - 0.06 * b.r, sm = steel(0x8A92A2), bm = clay(PALETTE.support);
        const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.07 * b.r, 0.07 * b.r, hS, 32), sm); spindle.rotation.x = Math.PI / 2; spindle.position.z = top - hS / 2; spindle.castShadow = true; g.add(spindle);
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.42 * b.r, 0.5 * b.r, 0.06 * b.r, 64), bm); base.rotation.x = Math.PI / 2; base.position.z = zb + 0.03 * b.r; base.castShadow = true; base.receiveShadow = true; g.add(base); ms.push(bm); edges(base, 0.2, 30);
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06 * b.r, 0.06 * b.r, d + 0.02 * b.r, 24), sm); hub.rotation.x = Math.PI / 2; hub.position.z = 0.01 * b.r; g.add(hub);
      }
      if ((b.render || {}).inner) { const inner = new THREE.Mesh(new THREE.CylinderGeometry(b.render.inner, b.render.inner, d * 1.6, 64), steel(0x6F7787)); inner.rotation.x = Math.PI / 2; inner.castShadow = true; g.add(inner); edges(inner, 0.25, 30); }
    } else if (b.shape === 'box' && prop) {
      const p = createProp(prop, { size: [b.w, b.h, prop === 'ladder' ? ladderDepth(b) : depthOf(b)], color: col, envelope: true });
      g.add(p); p.traverse(o => { if (o.material && !ms.includes(o.material)) ms.push(o.material); });
    } else if (b.shape === 'box') {
      const d = kind === 'rod' ? Math.max(Math.max(b.w, b.h) * 0.035, Math.min(b.w, b.h)) : depthOf(b);
      const mat = clay(col);
      if (b.lambda && window.Kinema2D && window.Kinema2D.compileExpr) {   // non-uniform rod: heavy = darker, light = paler, along its length
        try { const f = window.Kinema2D.compileExpr(b.lambda); const N = 256, vals = []; let mx = 1e-12; for (let k = 0; k < N; k++) { const x = (k / (N - 1) - 0.5) * b.w; const v = Math.max(0, f({ x, l: b.w })); vals.push(v); mx = Math.max(mx, v); }
          const c = document.createElement('canvas'); c.width = N; c.height = 1; const cx = c.getContext('2d'); const lo = new THREE.Color(col).lerp(new THREE.Color(0xF2EEE6), 0.38), hi = new THREE.Color(col).multiplyScalar(0.5);
          for (let k = 0; k < N; k++) { const t = Math.pow(vals[k] / mx, 0.65); const cc = lo.clone().lerp(hi, t); cx.fillStyle = '#' + cc.getHexString(); cx.fillRect(k, 0, 1, 1); }
          const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; mat.map = tex; mat.color.set(0xffffff); } catch (e) { /* stays plain */ }
      }
      const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, d), mat); m.castShadow = true; m.receiveShadow = true; g.add(m); ms.push(mat); edges(m, 0.22);
    } else if (b.shape === 'polygon') {
      // a ramp or wedge is a track sized to what rides on it (twice a ball's diameter, about twice a block's depth), not a fixed
      // 1.2 m slab that dwarfs a small block; with nothing riding it keeps the old 1.2 m
      const riders = dyn.filter(x => x.shape !== 'polygon').map(x => x.shape === 'circle' ? 4 * x.r : 1.8 * depthOf(x));
      const width = riders.length ? Math.max(0.3, ...riders) : 1.2;
      const shape = new THREE.Shape(); b.points.forEach((p, i) => i ? shape.lineTo(p[0], p[1]) : shape.moveTo(p[0], p[1])); shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 3 });
      // a ramp's triangular cross-section (front and back caps) is a shade darker than its sloped and base faces, so the
      // profile and the running surface read as separate faces in every view
      const incl = prop === 'ramp' || prop === 'wedge', sideM = clay(col), capM = incl ? clay(darken(col, 0.12)) : sideM;
      const m = new THREE.Mesh(geo, incl ? [capM, sideM] : sideM); m.position.z = -width / 2; m.castShadow = true; m.receiveShadow = true; g.add(m); ms.push(...new Set([capM, sideM])); edges(m, 0.22, 40);
      // ramp: a paler running strip laid flush on the sloped face (it rises 0.2 % of the face length, nothing more)
      if (prop === 'ramp' || prop === 'wedge') { let best = null; for (let i = 0; i < b.points.length; i++) { const a = b.points[i], c = b.points[(i + 1) % b.points.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (Math.abs(c[0] - a[0]) > 1e-6 && Math.abs(c[1] - a[1]) > 1e-6 && (!best || L > best.L)) best = { a, c, L }; }
        if (best) { const cx = b.points.reduce((s, q) => s + q[0], 0) / b.points.length, cy = b.points.reduce((s, q) => s + q[1], 0) / b.points.length, mx = (best.a[0] + best.c[0]) / 2, my = (best.a[1] + best.c[1]) / 2;
          let nx = -(best.c[1] - best.a[1]) / best.L, ny = (best.c[0] - best.a[0]) / best.L; if (nx * (cx - mx) + ny * (cy - my) > 0) { nx = -nx; ny = -ny; }
          const t = 0.002 * best.L, sm = clay(new THREE.Color(col).lerp(new THREE.Color(0xffffff), 0.16).getHex()); ms.push(sm);
          const strip = new THREE.Mesh(new THREE.BoxGeometry(best.L * 0.97, t, width * 0.62), sm); strip.position.set(mx + nx * (t / 2 + 0.01), my + ny * (t / 2 + 0.01), 0); strip.rotation.z = Math.atan2(best.c[1] - best.a[1], best.c[0] - best.a[0]); strip.receiveShadow = true; g.add(strip); } }
    }
    if ((b.render || {}).cm && b.shape === 'box') {
      const rr = Math.max(1.7 * Math.min(b.w, b.h), 0.035 * Math.max(b.w, b.h)), top = (kind === 'rod' ? Math.max(Math.max(b.w, b.h) * 0.035, Math.min(b.w, b.h)) : depthOf(b)) / 2 + 0.003;
      for (let k = 0; k < 4; k++) { const q = new THREE.Mesh(new THREE.CircleGeometry(rr, 16, k * Math.PI / 2, Math.PI / 2), new THREE.MeshBasicMaterial({ color: k % 2 ? 0x15171C : 0xF4F1EA })); q.position.z = top; g.add(q); }
      const ring = new THREE.Mesh(new THREE.RingGeometry(rr, rr * 1.12, 32), new THREE.MeshBasicMaterial({ color: 0x15171C })); ring.position.z = top; g.add(ring);
    }
    g.position.set(b.pos?.[0] || 0, b.pos?.[1] || 0, zOf[b.id]); g.rotation.z = b.angle || 0; scene.add(g); meshes[b.id] = g; mats[b.id] = ms; tag(g, { type: 'body', id: b.id });
  }
  // a static edge other than the floor (a wall, a raised ledge) is a thin hatched slab behind its exact contact line, on the side
  // away from the moving bodies, clipped to where the bodies travel (a long edge never widens the fit: slabs are not fitted)
  const floorLine = floorLineOf(spec);
  const dynC = dyn.length ? dyn.reduce((c, b) => [c[0] + (b.pos?.[0] || 0) / dyn.length, c[1] + (b.pos?.[1] || 0) / dyn.length], [0, 0]) : [(env.min.x + env.max.x) / 2, (env.min.y + env.max.y) / 2];
  const edgeDepth = Math.max(0.3, ...dyn.map(b => b.shape === 'box' && planarProp(b) === 'ladder' ? 1.4 * ladderDepth(b) : 2 * depthOf(b)));
  // The studio floor is only a shadow catcher. A real, load-bearing finite edge
  // needs its own visible surface: otherwise N/friction appear to act in empty air.
  // Only edges with recorded physical contact get a strip; free-space backdrops stay empty.
  const contacts = new Map();
  for (const fr of sim.frames || []) for (const f of fr.forces || []) if (f.kind === 'normal' && f.other && Math.hypot(...f.vec) > 1e-6 && byId[f.body]?.type !== 'static') {
    if (!contacts.has(f.other)) contacts.set(f.other, new Set()); contacts.get(f.other).add(f.body);
  }
  for (const b of spec.bodies) {
    if (b.type !== 'static' || b.shape !== 'edge' || !contacts.has(b.id)) continue;
    const [a, c] = edgeWorld(b); if (!flatEdge([a,c]) || Math.abs(a[1]-floorLine)>1e-6) continue;
    // Keep both the physical finite endpoints and the full travelled region. The
    // strip is drawing only and never enlarges the fit or follows the camera.
    const lo = Math.max(Math.min(a[0],c[0]),travel.min.x), hi = Math.min(Math.max(a[0],c[0]),travel.max.x);
    if (!(hi>lo)) continue;
    const riders = dyn.filter(d=>contacts.get(b.id).has(d.id));
    const thickness = clamp(0.04*Math.max(...riders.map(d=>2*sizeOf(d))),0.008,0.06);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(hi-lo,thickness,edgeDepth),clay(darken(PALETTE.support,0.28),{roughness:0.96}));
    slab.position.set((lo+hi)/2,a[1]-thickness/2,0);slab.receiveShadow=true;
    slab.userData.contactSurface={body:b.id,from:[lo,a[1]],to:[hi,a[1]]};
    edges(slab,0.35,30);scene.add(slab);
  }
  // a ramp or wedge standing on the floor line stands on a visible ground plate a little larger than its base, so the
  // incline reads as resting on something rather than hovering over the shadow catcher (drawing only, never fitted); it
  // overhangs the depth by only half a pad each side, since its front edge drops lowest on screen, toward the transport
  if (floorLine != null) for (const b of spec.bodies) {
    if (b.type !== 'static' || b.shape !== 'polygon' || !meshes[b.id]) continue;
    const xs = b.points.map(p => p[0] + (b.pos?.[0] || 0)), ys = b.points.map(p => p[1] + (b.pos?.[1] || 0));
    if (Math.abs(Math.min(...ys) - floorLine) > 1e-3 * Math.max(1, size)) continue;
    const depth = meshes[b.id].children[0]?.geometry?.parameters?.options?.depth || 1, span = Math.max(...xs) - Math.min(...xs), pad = clamp(0.06 * span, 0.04, 0.4);
    const thickness = clamp(0.012 * span, 0.008, 0.05), plate = new THREE.Mesh(new THREE.BoxGeometry(span + 2 * pad, thickness, depth + pad), clay(darken(PALETTE.support, 0.3), { roughness: 0.96 }));
    plate.position.set((Math.min(...xs) + Math.max(...xs)) / 2, floorLine - thickness / 2 - 1e-4, 0); plate.receiveShadow = true; plate.userData.groundPlate = { body: b.id };
    edges(plate, 0.35, 30); scene.add(plate);
  }
  for (const [, [a, c]] of slabEdges(spec)) {
    let t0 = 0, t1 = 1; const dx = c[0] - a[0], dy = c[1] - a[1];   // clip the segment to the travel box (Liang–Barsky)
    for (const [p, q] of [[-dx, a[0] - travel.min.x], [dx, travel.max.x - a[0]], [-dy, a[1] - travel.min.y], [dy, travel.max.y - a[1]]]) { if (Math.abs(p) < 1e-12) { if (q < 0) t1 = -1; continue; } const r = q / p; if (p < 0) t0 = Math.max(t0, r); else t1 = Math.min(t1, r); }
    const L = Math.hypot(dx, dy) * (t1 - t0); if (!(L > 1e-6)) continue;
    let nx = -dy, ny = dx; const nl = Math.hypot(nx, ny); nx /= nl; ny /= nl; const mx = a[0] + dx * (t0 + t1) / 2, my = a[1] + dy * (t0 + t1) / 2;
    if (nx * (dynC[0] - mx) + ny * (dynC[1] - my) > 0) { nx = -nx; ny = -ny; }
    const w = createProp('support', { kind: 'ceiling', w: L, t: clamp(0.03 * size, 0.02, 0.15), d: edgeDepth });
    w.position.set(mx, my, 0); w.rotation.z = Math.atan2(ny, nx) - Math.PI / 2; w.traverse(o => { if (o.isMesh) o.receiveShadow = true; }); scene.add(w);
  }
  const rampFront = Math.max(0, ...spec.bodies.filter(b => b.shape === 'polygon' && b.type === 'static' && meshes[b.id]).map(b => (meshes[b.id].children[0]?.geometry?.parameters?.options?.depth || 0) / 2 + 0.012));
  // pivots: a steel axle through the anchor
  const axR = clamp(0.012 * size, 0.008, 0.03), axL = clamp(0.1 * size, 0.06, 0.4); const pivots = {}, hangers = []; let castShadows = true;
  for (const j of spec.joints || []) if (j.type === 'pivot' && j.anchor) { const mk = new THREE.Mesh(new THREE.CylinderGeometry(axR, axR, axL, 24), steel(0x6F7787)); mk.rotation.x = Math.PI / 2; mk.position.set(j.anchor[0], j.anchor[1], 0); mk.castShadow = true; scene.add(mk); pivots[j.id] = mk; tag(mk, { type: 'pivot', id: j.id });
    const pm = !axleHanger(j) && pinMount(spec, sim, j); if (pm) { const g = barBracket(j, pm); scene.add(g); hangers.push(g); }
    const hanger = axleHanger(j); if (hanger) { scene.add(hanger.group); hangers.push(hanger.group); mk.geometry.dispose(); mk.geometry = new THREE.CylinderGeometry(axR, axR, hanger.axle.len, 24); mk.position.z = hanger.axle.z; } }
  /* A wheel pinned to the world at its own centre (a fixed pulley) hangs from a hatched ceiling by a steel strap behind it:
     the strap runs from the axle up past the rim, so the string still runs over the top in front of it, and a nut caps the
     axle in front. Drawing only, never fitted, and only when nothing else travels through the space above the wheel. */
  // the bracket for pinMount: a hatched block on the far side, a steel strap from it to a lug round the pin behind the bar, and a nut in front
  function barBracket(j, pm) {
    const b = byId[j.a === 'world' ? j.b : j.a], d = depthOf(b), [ax, ay] = j.anchor, pt = clamp(0.25 * pm.t, 0.006, 0.03), half = Math.max(axR * 2.2, 0.08 * pm.w);
    const group = new THREE.Group(), zb = -(d / 2 + 0.01 + pt / 2), sm = steel(0x7B8392), y1 = pm.plate;
    const lug = new THREE.Mesh(new THREE.CylinderGeometry(half, half, pt, 40), sm); lug.rotation.x = Math.PI / 2; lug.position.set(ax, ay, zb);
    const strap = new THREE.Mesh(new THREE.BoxGeometry(2 * half, Math.abs(y1 - ay), pt), sm); strap.position.set(ax, (ay + y1) / 2, zb);
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(axR * 1.9, axR * 1.9, pt, 6), steel(0x5E6573)); nut.rotation.x = Math.PI / 2; nut.position.set(ax, ay, d / 2 + 0.01 + pt / 2);
    for (const m of [lug, strap, nut]) { m.castShadow = true; m.receiveShadow = true; group.add(m); }
    edges(strap, 0.22, 30); edges(lug, 0.22, 30);
    const block = createProp('support', { kind: 'ceiling', w: pm.w, t: pm.t, d: Math.max(2 * d, 0.6 * pm.w) }); block.position.set(ax, y1, zb / 2); if (pm.dir < 0) block.rotation.z = Math.PI;   // origin on its working face
    block.traverse(o => { if (o.isMesh) o.receiveShadow = true; }); group.add(block);
    group.userData.support = { joint: j.id, body: b.id, top: y1 };
    return group;
  }
  function axleHanger(j) {
    const id = j.a === 'world' ? j.b : j.b === 'world' ? j.a : null, b = byId[id];
    if (!b || b.type === 'static' || b.shape !== 'circle' || !(b.r > 0)) return null;
    const [ax, ay] = j.anchor; if (Math.hypot((b.pos?.[0] ?? ax) - ax, (b.pos?.[1] ?? ay) - ay) > 1e-6 * Math.max(1, b.r)) return null;
    const r = b.r, d = depthOf(b), rim = r * 1.12, top = ay + rim + 0.62 * r, t = clamp(0.3 * r, 0.03, 0.2), half = 0.32 * r;
    for (const o of spec.bodies) {
      if (o.id === id || o.shape === 'edge') continue; const rr = reach(o);
      for (const fr of [{ bodies: { [o.id]: { cx: o.pos?.[0] || 0, cy: o.pos?.[1] || 0 } } }, ...(o.type === 'static' ? [] : sim.frames || [])]) {
        const p = fr.bodies[o.id]; if (!p) continue;
        if (Math.abs(p.cx - ax) < half + rr && p.cy + rr > ay + r * 0.5 && p.cy - rr < top + t) return null;
      }
    }
    for (const s of spec.strings || []) for (const v of s.via || []) if (v.world && v.world[1] > ay + r * 0.5 && Math.abs(v.world[0] - ax) < rim + half) return null;
    const group = new THREE.Group(), gap = 0.05 * r, pt = clamp(0.1 * r, 0.006, 0.05), zb = -(d / 2 + gap + pt / 2), sm = steel(0x7B8392);
    // the strap: a lug round the axle and a flat bar to the ceiling, behind the wheel
    const lug = new THREE.Mesh(new THREE.CylinderGeometry(half, half, pt, 40), sm); lug.rotation.x = Math.PI / 2; lug.position.set(ax, ay, zb);
    const strap = new THREE.Mesh(new THREE.BoxGeometry(2 * half, top - ay, pt), sm); strap.position.set(ax, (ay + top) / 2, zb);
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(axR * 1.9, axR * 1.9, 0.6 * pt, 6), steel(0x5E6573)); nut.rotation.x = Math.PI / 2; nut.position.set(ax, ay, d / 2 + gap + 0.3 * pt);
    for (const m of [lug, strap, nut]) { m.castShadow = true; m.receiveShadow = true; group.add(m); }
    edges(strap, 0.22, 30); edges(lug, 0.22, 30);
    const ceil = createProp('support', { kind: 'ceiling', w: clamp(4.2 * r, 0.3, 3), t, d: Math.max(2.2 * d, 4 * half) });
    ceil.position.set(ax, top, zb / 2); ceil.traverse(o => { if (o.isMesh) o.receiveShadow = true; }); group.add(ceil);
    group.userData.support = { joint: j.id, body: id, top };
    const back = zb - pt / 2, front = d / 2 + gap + 0.6 * pt;
    return { group, axle: { len: front - back, z: (front + back) / 2 } };
  }

  // ── strings ────────────────────────────────────────────────────────────────
  const legacy = (spec.ropes || []).map(([id, top], i) => { const jid = (spec.joints || []).find(j => (j.type === 'gear' || j.type === 'rope' || j.type === 'pulley') && (j.a === id || j.b === id)); return { id: 'rope_' + id, via: [{ body: id, attach: 'top' }, { world: top }], tension: jid ? [jid.id] : [] }; });
  const strings = (spec.strings && spec.strings.length ? spec.strings : legacy).map(s => ({ ...s, group: new THREE.Group(), tubes: [], arcs: [], segs: [], ferrules: [] }));
  for (const s of strings) { scene.add(s.group); tag(s.group, { type: 'string', id: s.id }); }
  const gMat = graphite();
  function attachPoint(desc, frame) {
    if (desc.world) return V3(desc.world[0], desc.world[1]);
    const b = byId[desc.body], st = frame.bodies[desc.body]; if (!b || !st) return null;
    let lx = 0, ly = 0; const a = desc.attach ?? desc.local ?? 'center';
    if (Array.isArray(a)) { lx = a[0]; ly = a[1]; } else { const hw = b.shape === 'box' ? b.w / 2 : (b.r || 0), hh = b.shape === 'box' ? b.h / 2 : (b.r || 0); if (a === 'top') ly = hh; else if (a === 'bottom') ly = -hh; else if (a === 'left') lx = -hw; else if (a === 'right') lx = hw; }
    const ca = Math.cos(st.a), sa = Math.sin(st.a); return V3(st.x + lx * ca - ly * sa, st.y + lx * sa + ly * ca);
  }
  function tensionOf(ref, frame, bodyIds) { if (!ref) return null; const j = frame.joints[ref]; if (j) return jointTensionForSegment(j, bodyIds); const f = frame.forces.find(x => x.kind === 'applied' && x.label === ref); return f ? Math.hypot(f.vec[0], f.vec[1]) : null; }
  const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  function tube(s, i, a, b) {
    let t = s.tubes[i];
    if (!t) { t = new THREE.Mesh(new THREE.CylinderGeometry(ropeR, ropeR, 1, 10), gMat); t.castShadow = castShadows; s.group.add(t); s.tubes[i] = t; t.userData = { type: 'string', id: s.id };
      const hit = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 8), hitMat); hit.userData = { type: 'string', id: s.id }; hit.renderOrder = -1; t.add(hit); t.userData.hit = hit; }   // a fat invisible sleeve so a 2-px string is clickable
    const len = a.distanceTo(b); t.visible = len > 1e-5; t.scale.set(1, Math.max(len, 1e-5), 1); t.position.copy(a).add(b).multiplyScalar(0.5); t.quaternion.setFromUnitVectors(V3(0, 1, 0), b.clone().sub(a).normalize());
    // The sleeve has unit-radius geometry; its parent only scales the length.
    const hr = Math.max(5 * ropeR, 0.012 * size); t.userData.hit.scale.set(hr, 1, hr); return t;
  }
  function arcMesh(s, i, arc) { let m = s.arcs[i]; const span = Math.abs(arc.a1 - arc.a0); if (!m || Math.abs(m.userData.span - span) > 2e-3 || Math.abs(m.userData.R - arc.R) > 1e-6) { if (m) { s.group.remove(m); m.geometry.dispose(); } m = new THREE.Mesh(new THREE.TorusGeometry(arc.R, ropeR, 8, Math.max(12, Math.round(span * 24)), span), gMat); m.castShadow = castShadows; m.userData = { type: 'string', id: s.id, span, R: arc.R }; s.group.add(m); s.arcs[i] = m; } m.position.set(arc.C.x, arc.C.y, 0); m.rotation.z = arc.dir > 0 ? arc.a0 : arc.a1; return m; }
  const ferruleMat = graphite(); ferruleMat.color.multiplyScalar(0.7);
  function ferrule(s, i, p, q) {
    let m = s.ferrules[i]; const L = 7 * ropeR;
    if (!m) { m = new THREE.Mesh(new THREE.CylinderGeometry(2.1 * ropeR, 2.4 * ropeR, L, 14), ferruleMat); m.castShadow = castShadows; m.userData = { type: 'string', id: s.id }; s.group.add(m); s.ferrules[i] = m; }
    const d = q.clone().sub(p), len = d.length(); m.visible = len > 2 * L; if (!m.visible) return;
    d.divideScalar(len); m.position.copy(p).addScaledVector(d, L / 2); m.quaternion.setFromUnitVectors(V3(0, 1, 0), d);
  }
  let stringFrame = null; const carriedOf = new Map(carriedPulls(spec).map(c => [c.string.id, c]));
  function updateStrings(frame) {
    if (stringFrame === frame) return;
    stringFrame = frame;
    for (const s of strings) {
      let path;
      try {
        const carried = carriedOf.get(s.id);
        const nodes = (s.via || []).map((it, k) => {
          if (carried && (k === carried.bi || k === carried.wi)) { const st = frame.bodies[carried.body]; if (!st) throw new Error('Missing string attachment.'); const o = k === carried.bi ? carried.offset : carried.hand; return { p: [st.cx + o[0], st.cy + o[1]] }; }
          if (!it.wrap) { const p = attachPoint(it, frame); if (!p) throw new Error('Missing string attachment.'); return { p: [p.x, p.y] }; }
          const st = frame.bodies[it.wrap], b = byId[it.wrap];
          if (!st || !b || !(b.r > 0)) throw new Error('A pulley wrap needs a circular body.');
          return { id: it.wrap, c: [st.cx, st.cy], r: b.r + ropeR * 1.05, ccw: it.ccw };
        });
        path = tangentStringPath(nodes); s.geometryError = null;
      } catch (e) {
        const message = 'String ' + s.id + ': ' + (e.message || e);
        const disclosed=s.via.some(v=>v.wrap&&(spec.joints||[]).some(j=>incompleteReactionJoints.has(j.id)&&(j.a===v.wrap||j.b===v.wrap)));
        if (s.geometryError !== message&&!disclosed) (window.__errs = window.__errs || []).push(message);
        s.geometryError = message; path = { segments: [], arcs: [] };
      }
      s.segs = []; s.tensionError = null; let ti = 0, ai = 0;
      for (const seg of path.segments) {
        const a = V3(...seg.a), b = V3(...seg.b), index = s.segs.length;
        tube(s, ti++, a, b);
        const ref = (s.tension || [])[index], bodyIds = [s.via[index]?.body, s.via[index + 1]?.body].filter(Boolean);
        const tension = tensionOf(ref, frame, bodyIds);
        if (tension == null && frame.joints[ref]?.type === 'pulley') s.tensionError = 'String ' + s.id + ': a segment tension is unavailable because its pulley endpoint is ambiguous.';
        s.segs.push({ ...seg, a, b, tension, label: (s.labels || [])[index] || ((s.tension || []).length > 1 ? 'T' + (['₁', '₂', '₃', '₄', '₅', '₆'][index] || (index + 1)) : 'T') });
      }
      for (const arc of path.arcs) arcMesh(s, ai++, { ...arc, C: new THREE.Vector2(...arc.C) });
      // where the string meets a body it ends in a short dark ferrule on the string itself, so the load reads as fastened
      let fi = 0;
      s.segs.forEach((seg, i) => { for (const [v, p, q] of [[s.via[i], seg.a, seg.b], [s.via[i + 1], seg.b, seg.a]]) if (v?.body && !v.wrap) ferrule(s, fi++, p, q); });
      for (let k = fi; k < s.ferrules.length; k++) s.ferrules[k].visible = false;
      for (let k = ti; k < s.tubes.length; k++) s.tubes[k].visible = false;
      for (let k = ai; k < s.arcs.length; k++) s.arcs[k].visible = false;
      for (let k = 0; k < ai; k++) s.arcs[k].visible = true;
    }
  }
  // ── links: rod / rope / spring joints no string draws (a pendulum's string, a spring's coil). Endpoints are the engine's own
  // per-frame joint anchors, so what is drawn is exactly what is solved; a world end gets a small steel pin.
  const strung = new Set(strings.flatMap(s => s.tension || []));
  const links = (spec.joints || []).filter(j => ['rod', 'rope', 'spring'].includes(j.type) && !strung.has(j.id) && j.anchorA && j.anchorB).map(j => {
    const g = new THREE.Group(); scene.add(g);
    const end = byId[j.b !== 'world' ? j.b : j.a] || {}, bodySize = end.shape === 'box' ? Math.min(end.w, end.h) : 2 * (end.r || 0.1);
    let mesh, L0 = Math.max(1e-3, Math.hypot(j.anchorB[0] - j.anchorA[0], j.anchorB[1] - j.anchorA[1]));
    if (j.type === 'spring') {   // a helix of fixed turns, built at the start length and stretched along its axis as the spring moves
      const cr = clamp(0.3 * bodySize, 0.03, 0.2), wr = Math.max(ropeR * 1.2, cr * 0.08), turns = 11, N = turns * 24, pts = [];
      for (let i = 0; i <= N; i++) { const t = i / N, a = t * turns * 2 * Math.PI, lead = Math.min(1, t / 0.05, (1 - t) / 0.05); pts.push(V3(Math.cos(a) * cr * lead, t * L0, Math.sin(a) * cr * lead)); }
      mesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), N, wr, 8, false), steel(0xB4BCC8));
    } else mesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12).translate(0, 0.5, 0), j.type === 'rod' ? steel(0x8C94A2) : gMat), mesh.userData.r = j.type === 'rod' ? ropeR * 1.6 : ropeR;
    mesh.castShadow = true; g.add(mesh);
    const pins = ['a', 'b'].filter(k => j[k] === 'world').map(k => { const p = new THREE.Mesh(new THREE.SphereGeometry(Math.max(axR * 0.8, ropeR * 3), 16, 12), steel(0x6F7787)); p.position.set(...(k === 'a' ? j.anchorA : j.anchorB), 0); g.add(p); return p; });
    // a fixed end hangs from a small hatched mount just behind the pin: above it for a rod or rope (below it when the body starts well
    // above, as for an inverted pendulum), on the side away from the body (snapped to a ceiling, wall or floor) for a spring; drawing only, sized to the pendulum, never moved by the solver
    for (const k of ['a', 'b'].filter(k => j[k] === 'world')) {
      const P = k === 'a' ? j.anchorA : j.anchorB, Q = k === 'a' ? j.anchorB : j.anchorA, dx = Q[0] - P[0], dy = Q[1] - P[1];
      const up = j.type !== 'spring' ? [0, dy > 0.5 * L0 ? -1 : 1] : Math.abs(dx) > Math.abs(dy) ? [-Math.sign(dx), 0] : [0, -Math.sign(dy) || 1];
      const w = clamp(Math.max(2 * bodySize, 0.2 * L0), 0.12, 0.5), pr = pins[0].geometry.parameters.radius;
      const m = createProp('support', { kind: 'ceiling', w, t: 0.12 * w, d: 0.6 * w }); m.position.set(P[0] + up[0] * pr, P[1] + up[1] * pr, 0); m.rotation.z = Math.atan2(up[1], up[0]) - Math.PI / 2;
      m.traverse(o => { if (o.isMesh) o.receiveShadow = true; }); g.add(m);
    }
    return { j, mesh, L0, pins };
  });
  // a Breakdown the setup's own structure supports (an incline, a spring chain, a pendulum or a ball on a sphere, blocks on
  // rails, an angled pull, a projectile): verified against the run in teaching_views.js, drawn only while ov.breakdown is on
  const teachPlan = planTeaching(spec, sim), teaching = teachPlan ? createTeaching(teachPlan, sim, { THREE, scene, Arrow3D, PALETTE, FORCE_COLOR, hex, arrowR, z: 0, byId, size }) : null;
  const teachBodies = teachPlan ? teachPlan.bodies || [teachPlan.body] : [];
  if (teaching) for (const k of links) if (teaching.targets.some(t => t.id === k.j.id)) tag(k.mesh, { type: 'spring', id: k.j.id });   // a middle spring can be picked and explained alone
  let lastFrame = null;
  function updateLinks(frame) {
    for (const k of links) {
      const fj = frame.joints[k.j.id] || {}, a = V3(...(fj.anchorA || k.j.anchorA)), b = V3(...(fj.anchorB || k.j.anchorB)), len = a.distanceTo(b);
      k.mesh.visible = len > 1e-5; if (!k.mesh.visible) continue;
      k.mesh.position.copy(a); k.mesh.quaternion.setFromUnitVectors(V3(0, 1, 0), b.clone().sub(a).normalize());
      if (k.j.type === 'spring') k.mesh.scale.set(1, len / k.L0, 1); else k.mesh.scale.set(k.mesh.userData.r, len, k.mesh.userData.r);
    }
  }
  const attachOf = {}; for (const s of strings) for (const v of s.via || []) if (v.body) attachOf[v.body] = v;   // where a string meets each body
  // Only a circular pulley pinned to the world AT ITS CM has zero translational
  // acceleration. Gear loads omit the rope's net load at that axle; reconstruct
  // its reaction from known real forces, never from the incomplete raw reaction.
  const fixedAxles=new Map(), unavailableReactionJoints=new Set(incompleteReactionJoints);
  for(const jid of incompleteReactionJoints) {
    const j=(spec.joints||[]).find(j=>j.id===jid),id=j?.a==='world'?j.b:j?.b==='world'?j.a:null,b=byId[id];
    if(!id||!b||b.type==='static'||b.shape!=='circle'||!j.anchor)continue;
    const attached=(spec.joints||[]).filter(q=>q.a===id||q.b===id);
    const refs=new Set(strings.filter(s=>s.via.some(v=>v.wrap===id)).flatMap(s=>s.tension||[]));
    if(attached.some(q=>q.id!==jid&&(q.type!=='gear'||q.b!==id||q.joint2!==jid||!refs.has(q.id))))continue;
    const centered=(sim.frames||[]).length&&(sim.frames||[]).every(fr=>{const p=fr.bodies[id];return p&&[p.cx,p.cy,p.vx,p.vy].every(Number.isFinite)&&Math.hypot(p.cx-j.anchor[0],p.cy-j.anchor[1],p.vx,p.vy)<1e-7*Math.max(1,b.r);});
    if(centered)fixedAxles.set(id,j);
  }
  /* the pulls a string exerts on a body it WRAPS (the engine's gear joint loads the blocks, not the pulley's rim): one force per
     segment, at the tangent point, along the segment, of that segment's tension — what a free-body diagram of the pulley shows */
  function stringForces(frame, bodyId) {
    updateStrings(frame); // Lesson actions can seek before the next rendered frame.
    const out = [];
    const axle=fixedAxles.get(bodyId);
    if(axle) {
      // Rebuild the PHYSICAL tangent at r, not the visual rope's enlarged groove.
      // A gear's measured force on its hanging endpoint supplies the equal and
      // opposite real pull. Accept it only when that pull agrees with the path.
      let complete=true;const wrapped=strings.filter(s=>s.via.some(v=>v.wrap===bodyId));
      for(const s of wrapped) {
        if(s.geometryError||s.tensionError){complete=false;break;}
        let physical;try{physical=tangentStringPath(s.via.map(v=>{
          if(v.wrap){const b=byId[v.wrap],p=frame.bodies[v.wrap];return{id:v.wrap,c:[p.cx,p.cy],r:b.r,ccw:v.ccw};}
          const p=attachPoint(v,frame);return{p:[p.x,p.y]};
        }));}catch{complete=false;break;}
        let count=0;
        for(const [i,seg] of physical.segments.entries()) {
          const start=seg.aWrap===bodyId,end=seg.bWrap===bodyId;if(!start&&!end)continue;
          const ref=s.tension?.[i],coupling=(spec.joints||[]).find(j=>j.id===ref);
          const mate=frame.forces.find(f=>f.joint===ref&&f.body===coupling?.a);
          if(!coupling||coupling.b!==bodyId||coupling.joint2!==axle.id||!mate||!mate.vec.every(Number.isFinite)){complete=false;break;}
          const from=start?seg.a:seg.b,to=start?seg.b:seg.a,d=new THREE.Vector2(to[0]-from[0],to[1]-from[1]).normalize(),force=mate.vec.map(v=>-v),mag=Math.hypot(...force);
          if(mag>1e-8&&Math.hypot(force[0]/mag-d.x,force[1]/mag-d.y)>1e-6){complete=false;break;}
          out.push({body:bodyId,kind:'joint',label:s.segs[i].label,at:[...from],vec:force,synthetic:true,string:s.id});count++;
        }
        if(count!==2*s.via.filter(v=>v.wrap===bodyId).length)complete=false;
      }
      if(complete&&wrapped.length) {
        const known=frame.forces.filter(f=>f.body===bodyId&&!incompleteReactionJoints.has(f.joint));
        const sum=known.concat(out).reduce((s,f)=>[s[0]+f.vec[0],s[1]+f.vec[1]],[0,0]);
        if(sum.every(Number.isFinite)) {
          out.push({body:bodyId,kind:'joint',joint:axle.id,label:'R_axle',at:[...axle.anchor],vec:sum.map(v=>-v),supportReaction:true});
          unavailableReactionJoints.delete(axle.id);return out;
        }
      }
      // Inconsistent/overrun geometry cannot justify even an attractive FBD.
      unavailableReactionJoints.add(axle.id);return [];
    }
    const physicalPoint = p => { const b = byId[bodyId], st = frame.bodies[bodyId]; const d = new THREE.Vector2(p.x - st.cx, p.y - st.cy).normalize().multiplyScalar(b.r); return [st.cx + d.x, st.cy + d.y]; };
    for (const s of strings) for (const seg of s.segs) {
      if (seg.tension == null || seg.tension < 1e-6) continue;
      // Rope thickness is decorative: torque uses the pulley radius from the physics spec.
      if (seg.aWrap === bodyId) { const d = seg.b.clone().sub(seg.a).normalize(); out.push({ body: bodyId, kind: 'joint', label: seg.label, at: physicalPoint(seg.a), vec: [d.x * seg.tension, d.y * seg.tension], synthetic: true, string: s.id }); }
      if (seg.bWrap === bodyId) { const d = seg.a.clone().sub(seg.b).normalize(); out.push({ body: bodyId, kind: 'joint', label: seg.label, at: physicalPoint(seg.b), vec: [d.x * seg.tension, d.y * seg.tension], synthetic: true, string: s.id }); }
    }
    return out;
  }
  for(const id of fixedAxles.keys())if(sim.frames?.[0])stringForces(sim.frames[0],id);
  const supportWarning=()=>unavailableReactionJoints.size?'Axle support is unavailable: the rope path or tension is not supported at this position. The partial raw reaction is omitted.':'';

  // ── drafting for the givens: a ramp's angle and length ────────────────────
  const drafting = [];
  for (const b of spec.bodies) if (b.shape === 'polygon' && b.type === 'static' && b.points.length === 3) {
    const P = b.points.map(p => new THREE.Vector2(p[0] + (b.pos?.[0] || 0), p[1] + (b.pos?.[1] || 0)));
    let best = null; for (let i = 0; i < 3; i++) { const a = P[i], c = P[(i + 1) % 3]; const dx = Math.abs(a.x - c.x), dy = Math.abs(a.y - c.y); if (dx > 1e-6 && dy > 1e-6) { const L = a.distanceTo(c); if (!best || L > best.L) best = { a, c, L }; } }
    if (best) { const lo = best.a.y < best.c.y ? best.a : best.c, hi = lo === best.a ? best.c : best.a; const th = Math.atan2(hi.y - lo.y, Math.abs(hi.x - lo.x)); const dirx = Math.sign(hi.x - lo.x) || 1;
      const r = clamp(0.14 * best.L, 0.2, 0.8); const width = meshes[b.id] ? meshes[b.id].children[0].geometry.parameters.options.depth : 1.2; const zf = width / 2 + 0.01;
      const arc = angleArc(scene, V3(lo.x, lo.y, zf), r, dirx > 0 ? 0 : Math.PI - th, dirx > 0 ? th : Math.PI, { opacity: 0.6 });
      // its name sits just under the base line below the arc, outside the incline: the block slides down to the toe, and a
      // name inside the angle met the weight arrow there
      drafting.push({ kind: 'angle', label: 'θ = ' + (th * 180 / Math.PI).toFixed(0) + '°', at: V3(lo.x + dirx * r * 0.62, lo.y - 0.16 * r, zf), drawing: arc, pref: dirx > 0 ? -20 : 200 });
      // the length dimension sits INSIDE the front face, parallel to the slope, so it never crosses the body's path
      const n = new THREE.Vector2(-(hi.y - lo.y), hi.x - lo.x).normalize(); const inward = n.dot(new THREE.Vector2(P.reduce((s, q) => s + q.x, 0) / 3 - lo.x, P.reduce((s, q) => s + q.y, 0) / 3 - lo.y)) > 0 ? 1 : -1;
      const off = V3(n.x * inward * 0.1 * best.L, n.y * inward * 0.1 * best.L, 0);
      const dim = dimension(scene, V3(lo.x, lo.y, zf), V3(hi.x, hi.y, zf), off, { opacity: 0.55, tick: clamp(0.02 * best.L, 0.03, 0.08) });
      drafting.push({ kind: 'length', label: 'L = ' + best.L.toFixed(best.L >= 10 ? 0 : 1) + ' m', at: dim.mid, drawing: dim, pref: 90 }); }
  }

  // ── drawing-only guides from a body's render: `path` draws its whole route (read off the simulation) as a faint dashed curve in every
  // step, so a projectile's parabola is there before it flies; `launch_arc` marks the launch angle at the start, from the horizontal to
  // the initial velocity, with a short dotted horizontal reference. Physics, framing and fades are untouched.
  for (const b of dyn) {
    const rr = b.render || {}, f0 = (sim.frames || [])[0] && sim.frames[0].bodies[b.id];
    if (rr.path && sim.frames?.length > 1) {
      const stride = Math.max(1, Math.floor(sim.frames.length / 240)), pts = [];
      for (let i = 0; i < sim.frames.length; i += stride) { const s = sim.frames[i].bodies[b.id]; if (s) pts.push(V3(s.cx, s.cy, (zOf[b.id] || 0) - 0.001)); }
      const s = sim.frames[sim.frames.length - 1].bodies[b.id]; if (s) pts.push(V3(s.cx, s.cy, (zOf[b.id] || 0) - 0.001));
      const mat = new THREE.LineDashedMaterial({ color: PALETTE.ink, transparent: true, opacity: 0.55, dashSize: 0.03 * size, gapSize: 0.022 * size, depthTest: false });
      const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat); ln.computeLineDistances(); ln.renderOrder = 22; scene.add(ln);
    }
    if (rr.launch_arc && f0 && Math.hypot(f0.vx, f0.vy) > 1e-6) {
      const th = Math.atan2(f0.vy, f0.vx), r0 = clamp(0.12 * size, 3 * b.r, 0.3 * size), C = V3(f0.cx, f0.cy, (zOf[b.id] || 0) + 0.01);
      const arc = angleArc(scene, C, r0, 0, th, { opacity: 0.75 });
      const ref = new THREE.Line(new THREE.BufferGeometry().setFromPoints([C, C.clone().add(V3(1.35 * r0, 0, 0))]), new THREE.LineDashedMaterial({ color: PALETTE.ink, transparent: true, opacity: 0.5, dashSize: 0.02 * size, gapSize: 0.015 * size, depthTest: false })); ref.computeLineDistances(); ref.renderOrder = 22; scene.add(ref);
      drafting.push({ kind: 'angle', label: 'θ = ' + (th * 180 / Math.PI).toFixed(0) + '°', at: arc.label, drawing: arc, pref: -20 });
    }
  }

  /* ── planar axes (ov.axes): the problem's own x (right) and y (up) at the world origin (0, 0), and z out of the screen
     (right-handed; drawn short and labelled "z ⊙"). Fixed in the world; over the bodies so a ramp never hides them. */
  const axLen = clamp(0.17 * size, 0.25, 3), triR = clamp(0.0035 * size, 0.004, 0.03), planeAxes = new THREE.Group();
  const xy = createAxesTriad({ basis: 'three', length: axLen, radius: triR, only: ['x', 'y'] }), zt = createAxesTriad({ basis: 'three', length: axLen * 0.45, radius: triR, only: ['z'] });
  planeAxes.add(xy, zt); planeAxes.userData = { names: ['x', 'y', 'z'], tips: { ...xy.userData.tips, ...zt.userData.tips }, dirs: { ...xy.userData.dirs, ...zt.userData.dirs }, colors: { ...xy.userData.colors, ...zt.userData.colors } };
  planeAxes.visible = false; planeAxes.traverse(o => { if (o.material) { o.material.depthTest = false; o.material.transparent = true; o.renderOrder = 24; } o.castShadow = false; });
  scene.add(planeAxes);
  const PLANE_LEGEND = 'x y z  fixed axes';

  // ── motion read off the simulation (no scene-specific code): a name per moving body, impacts between two moving bodies
  // (impulse J = m Δv of the struck body, where it acts and its lever arm b about the CM) and friction pads between two
  // turning circles. Drawn by motionOverlays() under the velocity and forces layers. ──
  const frames = sim.frames || [];
  const movers = dyn.filter(b => frames.some(fr => { const s = fr.bodies[b.id]; return s && (Math.hypot(s.vx, s.vy) > 0.02 || Math.abs(s.w) > 0.05); }));
  const plainName = b => { const l = (b.label || '').trim().replace(/[₀-₉]/g, c => String(c.charCodeAt(0) - 0x2080)); return /^[A-Za-z0-9][A-Za-z0-9]{0,9}$/.test(l) ? l : (b.id.replace(/[^A-Za-z0-9]/g, '').slice(0, 10) || 'body'); };
  const nameOf = id => movers.length > 1 && byId[id] ? '_' + plainName(byId[id]) : '';
  const impacts = [];
  { const open = {};
    frames.forEach((fr, i) => {
      const touching = new Set();
      for (const f of fr.forces || []) {
        if (f.kind !== 'normal' || !f.other || !byId[f.other] || byId[f.other].type === 'static' || !byId[f.body] || byId[f.body].type === 'static') continue;
        const k = [f.body, f.other].sort().join('|'); touching.add(k);
        const e = open[k] || (open[k] = { i0: i, pts: {} }); e.i1 = i; (e.pts[f.body] = e.pts[f.body] || []).push(f.at);
      }
      for (const k of Object.keys(open)) if (!touching.has(k) && i > open[k].i1) { impacts.push({ key: k, ...open[k] }); delete open[k]; }
    });
    for (const k of Object.keys(open)) impacts.push({ key: k, ...open[k] }); }
  // a long resting contact between two moving bodies (stacked blocks) is not an impact
  for (let n = impacts.length - 1; n >= 0; n--) if ((frames[impacts[n].i1].t - frames[impacts[n].i0].t) > 0.08) impacts.splice(n, 1);
  for (const im of impacts) {
    const [a, b] = im.key.split('|'), pre = frames[Math.max(0, im.i0 - 1)], post = frames[Math.min(frames.length - 1, im.i1 + 2)];
    const sp = id => Math.hypot(pre.bodies[id].vx, pre.bodies[id].vy);
    im.on = a === focusId || b === focusId ? (a === focusId ? a : b) : (sp(a) <= sp(b) ? a : b); im.by = im.on === a ? b : a;
    const B0 = pre.bodies[im.on], B1 = post.bodies[im.on], m = B1.m || byId[im.on].mass || 1;
    im.J = V3(m * (B1.vx - B0.vx), m * (B1.vy - B0.vy)); im.t0 = frames[im.i0].t;
    const pts = im.pts[im.on] || im.pts[im.by] || [[B0.cx, B0.cy]];
    im.P = V3(pts.reduce((s, q) => s + q[0], 0) / pts.length, pts.reduce((s, q) => s + q[1], 0) / pts.length, zOf[im.on] || 0);
    const at = frames[im.i0].bodies[im.on]; im.C = V3(at.cx, at.cy, zOf[im.on] || 0);
    const u = im.J.lengthSq() > 1e-12 ? im.J.clone().normalize() : V3(1, 0), n = V3(-u.y, u.x), off = im.P.clone().sub(im.C).dot(n);
    im.b = Math.abs(off); im.F = im.C.clone().addScaledVector(n, off);
    const A0 = pre.bodies[im.by]; im.vBy = V3(A0.vx, A0.vy); im.atBy = V3(frames[im.i0].bodies[im.by].cx, frames[im.i0].bodies[im.by].cy, zOf[im.by] || 0);
    // the struck body's pose at the hit, as a faint outline that stays where the hit happened
    const src = meshes[im.on];
    if (src) {
      im.ghost = src.clone(true);
      im.ghost.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.12; o.material.color = new THREE.Color(o.material.color).lerp(new THREE.Color(0xffffff), 0.6); o.material.depthWrite = false; o.castShadow = false; } if (o.isLineSegments) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.3; } o.userData = {}; });
      im.ghost.position.set(at.x, at.y, zOf[im.on] || 0); im.ghost.rotation.z = at.a; im.ghost.visible = false; scene.add(im.ghost);
    }
    if (im.b > 0.02 * focusSize) { im.dim = dimension(scene, im.C, im.F, u.clone().multiplyScalar(-0.12 * Math.max(focusSize, im.b)), { opacity: 0.6, tick: clamp(0.03 * im.b, 0.01, 0.05) }); im.dim.group.visible = false; }
  }
  const hitBy = (id, frame) => impacts.some(im => frame.t >= im.t0 - 1e-9 && (im.on === id || im.by === id));
  // a friction pad (friction joint) between two turning circles: where they rub, the top's velocity relative to the bottom
  // and the friction on the top, which opposes it, until they turn together
  const pads = (spec.joints || []).filter(j => j.type === 'friction' && byId[j.a]?.shape === 'circle' && byId[j.b]?.shape === 'circle' && byId[j.a].type !== 'static' && byId[j.b].type !== 'static').map(j => {
    const [up, lo] = (zOf[j.a] || 0) >= (zOf[j.b] || 0) ? [j.a, j.b] : [j.b, j.a];
    return { j, up, lo, r: Math.min(byId[up].r, byId[lo].r), ang: Math.PI * 0.3 };   // at the top's rim: its arrows run tangent, clear of the top's face
  });
  // a curl radius per turning body: a circle under a smaller coaxial circle drawn in front of it curls in the ring left visible
  const curlR = b => {
    if (b.shape !== 'circle') return (b.render || {}).kind === 'rod' ? 0.36 * sizeOf(b) : Math.max(0.12 * sizeOf(b), Math.min(0.4 * sizeOf(b), 0.06 * size));
    const cover = dyn.filter(o => o !== b && o.shape === 'circle' && o.r < b.r && (zOf[o.id] || 0) > (zOf[b.id] || 0) && Math.hypot((o.pos?.[0] || 0) - (b.pos?.[0] || 0), (o.pos?.[1] || 0) - (b.pos?.[1] || 0)) < 0.05 * b.r);
    return cover.length ? (Math.max(...cover.map(o => o.r)) + b.r) / 2 : 0.55 * b.r;
  };
  const curls = {}, curlOf = id => curls[id] || (curls[id] = curlArrow(scene, PALETTE.omega, arrowR * 0.8));
  const faint = {}, faintFor = (key, color) => { if (!faint[key]) { faint[key] = new Arrow3D(scene, color, arrowR * 0.7); faint[key].setOpacity(0.45); } return faint[key]; };

  // ── per-frame state ────────────────────────────────────────────────────────
  const arrows = {}; const state = { centre: V3(0, 0), labels: [], focusId, selected: null };
  const trail = new Trail(scene, PALETTE.ink, 300); trail.visible = false;
  // an applied load named for what it is (weight, a tension, a normal push, friction) takes that force's colour, so a rope
  // element's T above, T below and weight read as three different forces; any other applied load keeps the applied colour
  const LOAD_KIND = [[/^(weight|mg|m\s*g|W)(\b|_|$)/i, 'gravity'], [/^(\d*\s*T|tension)(\b|_|$)/, 'joint'], [/^(N|normal)(\b|_|$)/, 'normal'], [/^(f|friction|F_?f)(\b|_|$)/, 'friction']];
  const loadColor = f => FORCE_COLOR[f.kind === 'applied' ? (LOAD_KIND.find(([re]) => re.test(String(f.label || '').trim()))?.[1] || 'applied') : f.kind] || PALETTE.ink;
  function arrowFor(key, kind) { if (!arrows[key]) arrows[key] = new Arrow3D(scene, FORCE_COLOR[kind] || PALETTE.ink, kind === 'vel' || kind === 'omega' ? arrowR * 0.7 : arrowR); return arrows[key]; }
  let faded = false;
  function applyFade() { for (const b of dyn) for (const m of mats[b.id] || []) { const on = faded && b.id !== focusId; m.transparent = on; m.opacity = on ? 0.42 : 1; m.needsUpdate = true; } }
  function setFocus(id) { if (isSubject(id)) { focusId = id; state.focusId = id; applyFade(); trail.clear(); } }
  function setFade(on) { faded = !!on; applyFade(); }
  function select(sel) { state.selected = sel; }

  const firstFocus=sim.frames?.[0]?.bodies[focusId],initialFocus=firstFocus?V3(firstFocus.cx,firstFocus.cy):V3(...(focusBody?.pos||[0,0]));
  // A single body may travel far beyond the intentionally local apparatus fit.
  // Track that translation in Setup/Side too, keeping its readable initial scale
  // and any orbit/pan offset, rather than losing it or fitting a tiny whole flight.
  const localTravel=dyn.length===1&&(sim.frames||[]).some(fr=>{const p=fr.bodies[focusId],r=reach(focusBody);return p&&(p.cx-r<env.min.x||p.cx+r>env.max.x||p.cy-r<env.min.y||p.cy+r>env.max.y);});
  let heroDist = null, tracked = null, trackedPreset=false;
  function update(frame, ov) {
    ov = ov || {};
    for (const id of Object.keys(meshes)) { const b = frame.bodies[id]; if (!b) continue; meshes[id].position.set(b.x, b.y, zOf[id] + dropOf(id, frame.t)); meshes[id].rotation.z = b.a; }
    const fb = frame.bodies[focusId]; if (fb) state.centre.set(fb.cx, fb.cy, 0);
  // tracking views follow the body's real motion by translation only, preserving manual orbit, pan and zoom
    if (tracked && !tracked.equals(state.centre)) { studio.translateCamera(state.centre.clone().sub(tracked)); tracked.copy(state.centre); }
    // arrows keep a near-constant on-screen thickness: thinner as the camera comes closer (a zoomed pulley must not grow fat arrows)
    if (heroDist == null) heroDist = fitDistance(camera, env.w * 1.1, env.h, 1.18);
    const thick = clamp(camera.position.distanceTo(state.centre) / heroDist, 0.3, 1.15);
    for (const k of Object.keys(arrows)) arrows[k].r = (arrows[k].baseR || (arrows[k].baseR = arrows[k].r)) * thick;
    updateStrings(frame); updateLinks(frame);
    const used = new Set(); state.labels = []; lastFrame = frame;
    const showF = ov.forces !== false; const targets = ov.forceBody ? [ov.forceBody] : ov.allForces ? allTargets() : [focusId];
    // Breakdown is its own layer: off by default (a clean setup), and a force breakdown still needs the Forces layer (the help gate)
    const teachOn = !!teaching && !!ov.breakdown && (showF || teachPlan.needsForces === false) && ov.labels !== false && teachPlan.applies(frame) && teachBodies.some(id => targets.includes(id));
    // Validate support even while another body's FBD is selected, so the visible note
    // follows scrub/replay and cannot retain a stale warning from a different time.
    for(const id of fixedAxles.keys())if(!targets.includes(id))stringForces(frame,id);
    const forces = frame.forces.filter(f => targets.includes(f.body) && !(teachOn && teaching.hides(f)) && !incompleteReactionJoints.has(f.joint) && !(f.kind === 'applied' && f.label === 'no contact yet') && !(f.joint && inAir(f.body, frame.t) && (spec.joints || []).some(j => j.id === f.joint && j.type === 'friction'))); for (const id of targets) forces.push(...stringForces(frame, id));
    const maxF = Math.max(1e-9, ...forces.map(f => Math.hypot(f.vec[0], f.vec[1])));
    // two forces on one body with one name (a ladder's floor and wall normals) are told apart by what pushes
    const forceName = f => { const l = f.label || f.kind; return f.other && forces.some(g => g !== f && g.body === f.body && (g.label || g.kind) === l && g.other && g.other !== f.other) ? l + ' ' + (byId[f.other]?.label || f.other) : l; };
    for (const f of forces) {
      const m = Math.hypot(f.vec[0], f.vec[1]); if (m < 1e-4 * maxF) continue;
      if (ov.loads && f.kind === 'applied' && !ov.loads.includes(f.label)) continue;   // a chosen subset of authored loads, kept on the full set's scale
      const key = f.body + '|' + f.kind + '|' + (f.other || f.joint || (f.synthetic ? 'str:' + f.label : f.kind === 'applied' && f.label ? 'load:' + f.label : '')); used.add(key);
      let at = V3(f.at[0], f.at[1], zOf[f.body] || 0);
      if (f.kind === 'friction' && rampFront > 0 && byId[f.body]?.shape === 'circle') at.z = Math.max(at.z, rampFront);   // a ramp's face is in front of a ball's centre plane: the friction arrow at the contact rides on that face, not inside the ramp
      if (f.kind === 'joint' && !f.synthetic && attachOf[f.body] && strings.some(s => (s.tension || []).includes(f.joint))) at = attachPoint(attachOf[f.body], frame) || at;
      // a ball's normal force and its weight lie on one vertical line and would overdraw each other: N is drawn a little to the
      // side of its contact (still at the contact height) so both arrows and both labels read
      if (f.kind === 'normal' && byId[f.body]?.shape === 'circle') { const g = forces.find(x => x.body === f.body && x.kind === 'gravity'), u = V3(f.vec[0], f.vec[1]).normalize();
        if (g && u.dot(V3(g.vec[0], g.vec[1]).normalize()) < -0.97) at.addScaledVector(V3(-u.y, u.x), -0.32 * byId[f.body].r); }
      // a free pull (an applied force named by a string that ends in the world) is drawn along the string, from where it leaves the body
      // to just short of the hand, so it reads as the string's own tension and never lies inside the body; the string chip names it
      const pull = f.kind === 'applied' ? strings.find(s => (s.tension || []).includes(f.label) && s.segs.length && (s.via || []).some(v => v.body === f.body)) : null;
      if (pull) {
        const seg = (pull.via[0] || {}).body === f.body ? pull.segs[0] : pull.segs[pull.segs.length - 1], st = frame.bodies[f.body], b0 = byId[f.body];
        const d = seg.b.clone().sub(seg.a), L = d.length(); d.normalize();
        let t0 = 0; if (b0.shape === 'circle' && st) { const px = seg.a.x - st.cx, py = seg.a.y - st.cy, bq = px * d.x + py * d.y, cq = px * px + py * py - b0.r * b0.r; if (cq < 0) t0 = -bq + Math.sqrt(bq * bq - cq); }
        const from = seg.a.clone().addScaledVector(d, t0).setZ((zOf[f.body] || 0) + (b0.shape === 'circle' ? depthOf(b0) / 2 + 0.01 : 0.02));
        arrowFor(key, f.kind).update(from, d, showF ? Math.max(0, (L - t0) * 0.92) : 0);
        continue;
      }
      const minLen = gaugeK !== 1 && m >= 0.02 * maxF ? 0.5 * gauge : 0;   // opt-in with render.gauge_k: a small force (friction on a rolling ball) keeps a readable arrow; its chip carries the value
      const a = arrowFor(key, f.kind), color = f.supportReaction ? FORCE_COLOR.normal : loadColor(f); a.setColor(color);
      // a load along a thin body's long axis (a rope element's tensions, a near-upright ladder's weight and floor push) would lie
      // inside the body and vanish: it is drawn just beside it, weight on one side and the other loads on the other; the shift
      // is half the body's thickness plus the arrow head, small beside its length
      const bb = byId[f.body], sb = frame.bodies[f.body];
      if (bb?.shape === 'box' && Math.max(bb.w, bb.h) > 3 * Math.min(bb.w, bb.h)) {
        const ang = (sb ? sb.a : bb.angle || 0) + (bb.w >= bb.h ? 0 : Math.PI / 2), ax = V3(Math.cos(ang), Math.sin(ang));
        if (Math.abs(V3(f.vec[0], f.vec[1]).normalize().dot(ax)) > 0.97) at.addScaledVector(V3(-ax.y, ax.x), (color === FORCE_COLOR.gravity ? -1 : 1) * (Math.min(bb.w, bb.h) / 2 + 3 * a.r));
      }
      a.update(at, V3(f.vec[0], f.vec[1]), showF ? Math.max(minLen, gauge * m / maxF) : 0);
      const onString = f.kind === 'joint' && ov.tensions !== false && (f.synthetic || strings.some(s => (s.tension || []).includes(f.joint)));   // the string's own chip names this tension
      // a wheel's weight drawn from its axle ends inside or just past the rim, and its name, pushed away from the scene
      // centre, landed on the hub of a pulley at the top: the name sits just past the rim, on the arrow's own line
      const bf = byId[f.body], sf = frame.bodies[f.body], tipR = sf ? Math.hypot(a.tip.x - sf.cx, a.tip.y - sf.cy) : Infinity, inRim = bf?.shape === 'circle' && f.kind === 'gravity' && tipR < 1.3 * bf.r;
      const rimPin = inRim ? V3(sf.cx, sf.cy).addScaledVector(V3(f.vec[0], f.vec[1]).normalize(), Math.max(tipR, 1.08 * bf.r)).setZ(a.tip.z) : undefined;   // pushed on along the arrow, not away from the scene centre (up into the hub)
      if (showF && !onString) state.labels.push({ key, label: forceName(f), value: m, unit: 'N', color: color || PALETTE.ink, legend:f.supportReaction?'R_axle  axle support reaction':undefined, pref: FORCE_PREF[f.kind] || 0, tip: rimPin || a.tip, ...(rimPin && { dir: V3(f.vec[0], f.vec[1]).normalize() }) });
    }
    // strings: tension chips at the segment middles; a selected string also shows its pull at both ends of every segment
    for (const s of strings) s.segs.forEach((seg, i) => {
      if (seg.tension == null || seg.tension < 1e-6) return;
      const mid = seg.a.clone().add(seg.b).multiplyScalar(0.5);
      const far = s.via?.[i + 1]?.world ? seg.b : mid;   // a string that ends in the world (a pull): its tension label sits at the far end, off the line's middle
      const sel = state.selected && state.selected.type === 'string' && state.selected.id === s.id;
      const color=frame.forces.some(f=>f.kind==='applied'&&f.label===s.tension?.[i])?FORCE_COLOR.applied:PALETTE.tension;
      if (ov.tensions !== false && !sel) state.labels.push({ key: 'string|' + s.id + '|' + i, label: seg.label, legend:seg.label+'  string tension', value: seg.tension, unit: 'N', color, pref: 0, tip: far, pin: far });   // a selected string's card carries its tensions
      // Pinned rope chips deliberately do not enter StageLabels' key. Supply a
      // genuine key-only semantic row; individual segment values are never added.
      if (showF && ov.tensions !== false) state.labels.push({key:'string-key|'+s.id+'|'+i,row:'string-tension',slot:'key',label:seg.label,glyph:seg.label,legend:'T  string tension',value:null,color,tip:far});
      const k1 = 'str|' + s.id + '|' + i + '|a', k2 = 'str|' + s.id + '|' + i + '|b';
      if (sel && showF) { used.add(k1); used.add(k2); const d = seg.b.clone().sub(seg.a).normalize(); const L = Math.max(gauge, 0.9 * focusSize) * Math.min(1.6, seg.tension / maxF); arrowFor(k1, 'joint').update(seg.a, d, L); arrowFor(k2, 'joint').update(seg.b, d.clone().negate(), L); }
    });
    if (teaching) teaching.update(frame, { active: teachOn, labels: state.labels, mgArrow: teachPlan.kind === 'incline' ? arrows[teachPlan.body + '|gravity|'] : null, arrowOf: (id, kind) => arrows[id + '|' + kind + '|'] || Object.entries(arrows).find(([k]) => used.has(k) && k.startsWith(id + '|' + kind + '|'))?.[1], targets: ov.forceBody ? [ov.forceBody] : null, selected: state.selected });
    for (const k of Object.keys(arrows)) if (!used.has(k)) arrows[k].update(state.centre, V3(0, 1), 0);
    if (ov.velocity && fb && movers.length < 2) { const a = arrowFor('__v', 'vel'); a.setColor(PALETTE.velocity); const v = Math.hypot(fb.vx, fb.vy); const from = focusIsBox ? state.centre.clone() : state.centre.clone().add(V3(0, focusSize * 1.15)); a.update(from, V3(fb.vx, fb.vy), v > 0.02 ? Math.min(focusIsBox ? 0.8 * focusSize : 2 * focusSize, focusSize * (0.3 + 0.35 * v)) : 0); if (v > 0.02) state.labels.push({ key: '__v', label: 'v' + (hitBy(focusId, frame) ? '′' : '') + nameOf(focusId), value: v, unit: 'm/s', color: PALETTE.velocity, pref: 60, tip: a.tip }); }
    motionOverlays(frame, ov);
    if (ov.labels !== false) for (const b of dyn) { if (!(b.render || {}).cm) continue; const st = frame.bodies[b.id]; if (!st) continue;
      // beside the marker, across the body on the side away from whatever strikes it
      const long = b.w >= b.h ? V3(Math.cos(st.a), Math.sin(st.a)) : V3(-Math.sin(st.a), Math.cos(st.a)), across = V3(-long.y, long.x), C = V3(st.cx, st.cy);
      const im = impacts.find(x => x.on === b.id); if (im && across.dot(im.atBy.clone().setZ(0).sub(C)) > 0) across.negate();
      const Q = C.clone().setZ((zOf[b.id] || 0) + 0.01).addScaledVector(across, 0.09 * Math.max(b.w, b.h)); state.labels.push({ key: '__cm|' + b.id, label: 'CM', value: null, color: PALETTE.ink2, plain: true, pref: 270, tip: Q, pin: Q }); }
    if (ov.trail && fb) { trail.visible = true; trail.push(state.centre); } else trail.visible = false;
    planeAxes.visible = !!ov.axes;
    if (ov.axes && ov.labels !== false) { const u = planeAxes.userData; u.names.forEach((k, i) => state.labels.push({ key: 'plane_axes|' + k, label: k === 'z' ? 'z ⊙' : k, glyph: k === 'z' ? 'z ⊙' : k, value: null, color: u.colors[k], plain: true, slot: 'glyph', row: 'plane_axes', group: 'axes', order: 20 + i, legend: PLANE_LEGEND, pref: 0,
      tip: new THREE.Vector3(...u.tips[k]), pin: new THREE.Vector3(...u.tips[k]), dir: new THREE.Vector3(...u.dirs[k]) })); }
    for (const d of drafting) {
      const visible = d.kind === 'angle' || !!ov.values;
      if (d.drawing?.group) d.drawing.group.visible = visible;
      if (visible) state.labels.push({ key: 'draft|' + d.label, label: d.label, value: null, color: PALETTE.ink2, pref: d.pref, tip: d.at, pin: d.at, plain: true });
    }
    return state;
  }
  /* the other moving bodies' velocities and every turning body's ω curl (layer velocity); per impact the impulse J at the
     contact, its lever arm b and the struck body's pose at the hit (layer forces) and the striker's velocity before (layer
     velocity); per friction pad the slip velocity and the friction opposing it, until the two turn together */
  const vmax = Math.max(1e-6, ...frames.filter((_, i) => i % 4 === 0).map(fr => Math.max(0, ...movers.map(b => Math.hypot(fr.bodies[b.id]?.vx || 0, fr.bodies[b.id]?.vy || 0)))));
  const cmR = b => (b.render || {}).cm && b.shape === 'box' ? 1.12 * Math.max(1.7 * Math.min(b.w, b.h), 0.035 * Math.max(b.w, b.h)) : 0;
  // a turning rod seen from above: its ω label goes round the curl to the direction farthest from the rod itself, its own
  // velocity arrow and whatever struck it
  const clearPin = (b, st, cc, R, frame) => {
    const a0 = st.a + (b.w >= b.h ? 0 : Math.PI / 2), avoid = [a0, a0 + Math.PI];
    if (Math.hypot(st.vx, st.vy) > 0.02) avoid.push(Math.atan2(st.vy, st.vx));
    const im = impacts.find(x => x.on === b.id); if (im) { const S = frame.bodies[im.by]; if (S) avoid.push(Math.atan2(S.cy - st.cy, S.cx - st.cx)); }
    let best = -Math.PI / 2, gap = -1;
    for (let k = 0; k < 16; k++) { const t = k * Math.PI / 8, g = Math.min(...avoid.map(x => Math.abs(Math.atan2(Math.sin(t - x), Math.cos(t - x))))); if (g > gap + 1e-6) { gap = g; best = t; } }
    return cc.clone().add(V3(1.3 * R * Math.cos(best), 1.3 * R * Math.sin(best), 0));
  };
  function motionOverlays(frame, ov) {
    const L = ov.labels !== false, showF = ov.forces !== false, used = new Set();
    const vg = Math.max(gauge, 0.12 * size), vlen = v => Math.max(0.3 * vg, 1.2 * vg * v / vmax);
    // arrows ride just in front of a body's face (over a sphere's top in a top view) so the body never hides them
    const liftOf = id => { const b = byId[id]; if (!b) return 0.004; return (b.shape === 'circle' ? (b.render?.kind === 'sphere' ? b.r : depthOf(b) / 2) : 0.02) + 0.004 + dropOf(id, frame.t); };
    for (const b of movers) {
      const st = frame.bodies[b.id]; if (!st) continue;
      const v = Math.hypot(st.vx, st.vy);
      if (b.id !== focusId || movers.length > 1) {   // with several movers the focus is drawn like the rest, from its centre
        const vk = '__v|' + b.id, a = arrowFor(vk, 'vel'); a.setColor(PALETTE.velocity);
        const on = ov.velocity && v > Math.max(0.02, 0.04 * vmax);   // a body all but stopped (a ball after an equal-mass hit) gets no stub arrow
        a.update(V3(st.cx, st.cy, (zOf[b.id] || 0) + liftOf(b.id)), on ? V3(st.vx, st.vy) : V3(1, 0), on ? vlen(v) + (b.shape === 'circle' ? b.r : cmR(b)) : 0);   // measured from the rim (or the CM marker), so the body never swallows it
        if (on && L) state.labels.push({ key: vk, label: 'v' + (hitBy(b.id, frame) ? '′' : '') + nameOf(b.id), value: v, unit: 'm/s', color: PALETTE.velocity, pref: 60, tip: a.tip });
      }
      const c = curlOf(b.id), w = st.w || 0;
      if (ov.velocity && Math.abs(w) > 0.05) {
        const cc = V3(st.cx, st.cy, (zOf[b.id] || 0) + liftOf(b.id)), R = curlR(b);
        c.update(cc, V3(0, 0, 1), R, Math.sign(w));
        // named just below its own curl, clear of the arrows that leave the body sideways (J, v′)
        // upright tabletop: a body under a smaller one is named just off its near rim, front left (clear of the falling disk and the pad); the top one inside its own curl
        const under = upright && b.shape === 'circle' && dyn.some(o => o !== b && o.shape === 'circle' && o.r < b.r && (zOf[o.id] || 0) > (zOf[b.id] || 0));
        const pin = !spec.topdown ? cc.clone().add(V3(-1.5 * R, 0.25 * R, 0)) : b.shape === 'box' ? clearPin(b, st, cc, R, frame) : !upright ? cc.clone().add(V3(0, -1.3 * R, 0)) : under ? cc.clone().add(V3(-0.75 * b.r, -1.7 * b.r, 0)) : cc.clone().add(V3(0, -0.4 * R, 0));
        if (L) state.labels.push({ key: '__w|' + b.id, label: 'ω' + (hitBy(b.id, frame) ? '′' : '') + nameOf(b.id), value: Math.abs(w), unit: 'rad/s', color: PALETTE.omega, pref: 120, tip: c.tip.clone(), pin });
      } else c.update(V3(0, 0), V3(0, 0, 1), 0);
    }
    for (const im of impacts) {
      const after = frame.t >= im.t0 - 1e-9, Jm = im.J.length(), aJ = arrowFor('__J|' + im.key, 'applied'), onJ = showF && after && Jm > 1e-6;
      aJ.update(im.P.clone().setZ(im.P.z + liftOf(im.on)), onJ ? im.J.clone() : V3(1, 0), onJ ? 1.1 * vg : 0);
      if (onJ && L) state.labels.push({ key: '__J|' + im.key, label: 'J', value: Jm, unit: 'N·s', color: FORCE_COLOR.applied, pref: 200, tip: aJ.tip });
      if (im.ghost) im.ghost.visible = showF && after;
      if (im.dim) { im.dim.group.visible = showF && after; if (im.dim.group.visible && L) state.labels.push({ key: '__b|' + im.key, label: 'b = ' + im.b.toFixed(2) + ' m', value: null, color: PALETTE.ink2, plain: true, pref: 180, tip: im.dim.mid, pin: im.dim.mid.clone().addScaledVector(im.C.clone().sub(im.F), 0.3) }); }   // toward the CM end, clear of the striker
      // the striking body's velocity just before the hit, faint, where it struck
      const fv = faintFor('__vb|' + im.key, PALETTE.velocity), vb = im.vBy.length(), onB = ov.velocity && after && vb > 0.02;
      // drawn arriving at the hit point (its tip on the contact), so it does not sit on top of J, which leaves from there
      const lb = onB ? vlen(vb) : 0, ub = vb ? im.vBy.clone().normalize() : V3(1, 0);
      fv.update(im.P.clone().addScaledVector(ub, -lb - 0.6 * (byId[im.by].r || 0)).setZ(im.P.z + liftOf(im.by)), ub, lb);
      if (onB && L) state.labels.push({ key: '__vb|' + im.key, label: 'v' + nameOf(im.by) + ' before', value: vb, unit: 'm/s', color: PALETTE.velocity, pref: 180, tip: fv.from.clone() });
    }
    for (const pd of pads) {
      const U = frame.bodies[pd.up], D = frame.bodies[pd.lo]; if (!U || !D) continue;
      if (inAir(pd.up, frame.t)) {
        arrowFor('__vrel|' + pd.j.id, 'joint').update(V3(U.cx, U.cy), V3(1, 0), 0); arrowFor('__fpad|' + pd.j.id, 'friction').update(V3(U.cx, U.cy), V3(1, 0), 0);
        if (L) { const Q = V3(U.cx, U.cy + 0.3 * byId[pd.up].r, (zOf[pd.up] || 0) + dropOf(pd.up, frame.t) + depthOf(byId[pd.up]) / 2 + 0.22 * size); state.labels.push({ key: '__air|' + pd.j.id, label: 'falling: not touching yet', value: null, color: PALETTE.ink2, plain: true, pref: 210, tip: Q, pin: Q }); }
        continue;
      }
      const P = V3(U.cx + pd.r * Math.cos(pd.ang), U.cy + pd.r * Math.sin(pd.ang), (zOf[pd.up] || 0) + depthOf(byId[pd.up]) / 2 + 0.006);
      const vAt = s => V3(s.vx - s.w * (P.y - s.cy), s.vy + s.w * (P.x - s.cx));
      const rel = vAt(U).sub(vAt(D)), m = rel.length(), slip = m > 0.01 * Math.max(0.05, pd.r * Math.max(Math.abs(U.w), Math.abs(D.w)));
      const av = arrowFor('__vrel|' + pd.j.id, 'joint'), af = arrowFor('__fpad|' + pd.j.id, 'friction');
      av.setColor(PALETTE.velocity);
      av.update(P, slip ? rel.clone() : V3(1, 0), ov.velocity && slip ? 0.65 * gauge : 0);
      af.update(P, slip ? rel.clone().negate() : V3(1, 0), showF && slip ? 0.85 * gauge : 0);
      if (!L) continue;
      if (ov.velocity && slip) state.labels.push({ key: '__vrel|' + pd.j.id, label: 'v_rel', value: m, unit: 'm/s', color: PALETTE.velocity, pref: 30, tip: av.tip });
      const tq = Math.abs(frame.joints?.[pd.j.id]?.torque || 0);
      if (showF && slip) state.labels.push({ key: '__fpad|' + pd.j.id, label: tq ? 'f  (τ_f)' : 'f', value: tq || null, unit: tq ? 'N·m' : '', color: FORCE_COLOR.friction, pref: 210, tip: af.tip });
      const Pn = upright ? V3(U.cx, U.cy + 0.3 * byId[pd.up].r, (zOf[pd.up] || 0) + depthOf(byId[pd.up]) / 2 + 0.22 * size) : P;   // upright: above the disk, off its rim
      if (!slip && (ov.velocity || showF)) state.labels.push({ key: '__nos|' + pd.j.id, label: 'no slip: turning together', value: null, color: PALETTE.ink2, plain: true, pref: 30, tip: Pn, pin: Pn });
    }
  }
  function hit(obj) { let o = obj; while (o) { if (o.userData && o.userData.type) return o.userData; o = o.parent; } return null; }

  const center = V3((env.min.x + env.max.x) / 2, (env.min.y + env.max.y) / 2);
  const floorY = floorLine ?? env.min.y - 0.02 * size;
  // Shadows on the floor plane are a contact cue, so a side-view setup casts them only when it actually stands on the floor:
  // a body touching a floor edge, or a support (ramp, wedge, fixed ball) with recorded contact whose base lies on the floor
  // line. Hanging, swinging, sprung and ballistic setups otherwise drop loose dark blobs on the catcher far beside them.
  // Drawing only; the floor itself is untouched.
  const baseY = b => b.shape === 'edge' ? Math.min(...edgeWorld(b).map(p => p[1])) : b.shape === 'polygon' ? Math.min(...b.points.map(p => p[1])) + (b.pos?.[1] || 0) : (b.pos?.[1] || 0) - (b.shape === 'box' ? b.h / 2 : reach(b));
  const grounded = floorLine != null && spec.bodies.some(b => b.type === 'static' && contacts.has(b.id) && Math.abs(baseY(b) - floorLine) < 1e-3 * Math.max(1, size));
  castShadows = !dyn.length || !!spec.topdown || grounded;
  // everything this setup has drawn so far: bodies, strings, links, hangers, pivots and the ceiling or wall slabs (a slab's
  // own shadow was the blob under a hanging pendulum); the studio floor only receives
  if (!castShadows) scene.traverse(m => { if (m.isMesh) m.castShadow = false; });
  const heroDir = upright ? V3(0.3, -1.25, 0.95).normalize() : V3(0.55, 0.24, 1).normalize(), followDir = upright ? heroDir.clone() : V3(0.45, 0.26, 1).normalize(); const flat = 1.12;
  // A planar setup is played in its physical x/y plane: x right, y up, z toward the viewer.
  // Hero remains available for inspecting the three-dimensional props.
  // upright: side looks across the table edge-on (slightly above), top straight down (nudged off the up axis)
  const sideDir = upright ? V3(0, -1, 0.14).normalize() : V3(0, 0, 1), topDir = upright ? V3(0, -0.02, 1).normalize() : V3(0, 0, 1);
  // fits keep a collapsed key clear (camera.userData.reserve, set by the key owner); follow tracks the body as before
  // while the plane axes show (a step's 'axes' or the Layers chip), the fitted box also holds their origin, both arrows and the
  // glyph room around them: the origin can lie well outside the apparatus (an Atwood's (0, 0) is a metre below its blocks)
  const envAx = new Box2().union(env).grow(0, 0, 0.3 * axLen).grow(1.15 * axLen, 1.15 * axLen);
  const zHalf = 0.15 * Math.max(env.w, env.h);
  // upright: from the stand's base on the backdrop to the top of the highest drop
  const zLo = upright ? -0.35 * size : -zHalf, zHi = upright ? Math.max(zHalf, ...dyn.map(b => (zOf[b.id] || 0) + depthOf(b) / 2 + (+(b.render || {}).drop_h || 0))) : zHalf;
  const boxPts = E => [E.min.x, E.max.x].flatMap(x => [E.min.y, E.max.y].flatMap(y => [zLo, zHi].map(z => V3(x, y, z))));
  const frameInsets = () => {
    const reserve = camera.userData.reserve, insets = camera.userData.insets;
    const canvas = studio.renderer?.domElement, stage = canvas?.closest?.('.stage');
    // Controls reflow with the live host before resize() updates the canvas's
    // inline pixel size. Mixing those two frames corrupts manual zoom on restore.
    const rect = canvas?.parentElement?.getBoundingClientRect?.() || stage?.getBoundingClientRect?.(); let bottom = 0;
    if (rect?.width > 0 && rect?.height > 0 && [rect.top, rect.bottom, rect.width, rect.height].every(Number.isFinite) && stage) for (const el of stage.querySelectorAll('.transport, .overlays, .stagehint, .stage-card')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && [r.top, r.bottom, r.width, r.height].every(Number.isFinite) && r.top >= rect.top && r.bottom > rect.top + rect.height * .4) bottom = Math.max(bottom, rect.bottom - r.top + 8);
    }
    return { ...insets, top: Math.max(insets?.top || 0, reserve?.top || 0), bottom: Math.max(insets?.bottom || 0, bottom) };
  };
  const fitView = (dir, target, distance, points) => {
    // The planar key is a slim full-width line, never a corner panel.
    const reserve = camera.userData.reserve, insets = camera.userData.insets;
    camera.userData.insets = frameInsets();
    camera.userData.reserve = null;
    try { return reserveFit(camera, studio, dir, target, distance, points); }
    finally { camera.userData.reserve = reserve; camera.userData.insets = insets; }
  };
  const resizeFrame = () => {
    // Follow/close-up intentionally exclude the rest of the apparatus. Compensate around
    // the moving focus, rather than pulling the camera out to a distant full trajectory.
    const r = focusSize + 1.15 * gauge;
    if (region) return { points: regionPts(region), insets: frameInsets() };
    const points = trackedPreset ? boxPts(planeAxes.visible ? envAx : env).map(p=>p.add(state.centre.clone().sub(initialFocus))) : tracked ? [-r, r].flatMap(x => [-r, r].flatMap(y => [-.4 * r, .4 * r].map(z => V3(state.centre.x + x, state.centre.y + y, z)))) : boxPts(planeAxes.visible ? envAx : env);
    return { points, insets: frameInsets() };
  };
  const fit = (dir, wk, m) => { const E = planeAxes.visible ? envAx : env; return fitView(dir, V3((E.min.x + E.max.x) / 2, (E.min.y + E.max.y) / 2), fitDistance(camera, E.w * wk, E.h, m * (spec.frame_fit ?? 1)), boxPts(E)); };
  // close-up: the focus body with room for its own force arrows, at the hero angle, tracking the body; the rest of the
  // apparatus may be off screen on purpose (the view menu says so). Never wider than the full setup.
  // a teaching view reads its components, angles and signs in the motion plane: its overview and close-up look at it side-on
  // (a slight angle keeps the props solid); a selected middle spring is the close-up's subject
  const teachDir = V3(0.1, 0.07, 1).normalize(), wideDir = teaching ? teachDir : heroDir;
  const closeFit = () => {
    const fp = teaching && lastFrame ? teaching.focusPoint(lastFrame, state.selected || null) : null;
    const r = fp?.[2] ? 1.12 * fp[2] : focusSize + 1.15 * gauge, c = fp ? V3(fp[0], fp[1]) : state.centre;
    if (2 * r >= Math.max(env.w, env.h)) return fit(wideDir, 1.1, 1.18);
    const pts = [-r, r].flatMap(x => [-r, r].flatMap(y => [-0.4 * r, 0.4 * r].map(z => V3(c.x + x, c.y + y, z))));
    return fitView(wideDir, c.clone(), fitDistance(camera, 2.2 * r, 2 * r, 1.18), pts);
  };
  // a teaching view that names its own frame (a spring chain: walls, blocks' reach, term rows and x labels) is fitted to that
  // frame alone, face-on and tight, instead of the padded 3D envelope that left a thin chain small in a wide pane
  const teachFit = () => { const B = teaching?.fitBox; if (!B) return null; const u = V3(B.u[0], B.u[1]), n = V3(B.n[0], B.n[1]), at = (x, y, z = 0) => u.clone().multiplyScalar(x).addScaledVector(n, y).setZ(z);
    const w = B.x[1] - B.x[0], h = B.y[1] - B.y[0], c = at((B.x[0] + B.x[1]) / 2, (B.y[0] + B.y[1]) / 2), dz = 0.06 * w;
    return fitView(teachDir, c, fitDistance(camera, w * 1.02, h, 1.05), B.x.flatMap(x => B.y.flatMap(y => [-dz, dz].map(z => at(x, y, z))))); };
  // region: a still close-up on a named place in the setup (point [x, y] in metres, size = the span to show), bounded to the
  // setup's own envelope; it does not follow a body, and any other view or a manual orbit leaves it
  let region = null;
  const regionPts = R => { const r = R.size / 2; return [-r, r].flatMap(x => [-r, r].flatMap(y => [-0.4 * r, 0.4 * r].map(z => V3(R.point[0] + x, R.point[1] + y, z)))); };
  const setRegion = (point, size) => {
    const x = +point?.[0], y = +point?.[1], E = planeAxes.visible ? envAx : env, span = Math.max(E.w, E.h), m = 0.25 * span;
    if (![x, y, +size].every(Number.isFinite) || !(size > 0) || x < E.min.x - m || x > E.max.x + m || y < E.min.y - m || y > E.max.y + m) return false;
    region = { point: [x, y], size: Math.min(Math.max(+size, 2 * focusSize, 0.05 * span), 1.1 * span) }; return true;
  };
  const regionFit = () => { const c = V3(region.point[0], region.point[1]), s = region.size;
    return fitView(wideDir, c, fitDistance(camera, 1.1 * s, s, 1.12), regionPts(region)); };
  const preset = f => () => { region = null; trackedPreset=localTravel;tracked=localTravel?state.centre.clone():null;const pose=f();if(localTravel){const delta=state.centre.clone().sub(initialFocus);pose.forEach(p=>p.add(delta));}return pose; };
  const cams = {
    hero: preset(() => teachFit() || fit(wideDir, 1.1, 1.18)),
    follow: () => { region = null; trackedPreset=false;tracked = state.centre.clone(); return [state.centre.clone().addScaledVector(followDir, fitDistance(camera, 7 * focusSize, 7 * focusSize, 1)), state.centre.clone().add(V3(0.2 * focusSize, -0.15 * focusSize))]; },
    side: preset(() => fit(sideDir, 1.05, flat)),
    top: preset(() => fit(topDir, 1.05, flat)),
    closeup: () => { region = null; trackedPreset=false;tracked = state.centre.clone(); return closeFit(); },
  };
  // not enumerable, so view menus that list cams never offer an empty region; app.js calls it after setRegion succeeds
  Object.defineProperty(cams, 'region', { enumerable: false, value: () => { if (!region) return cams.closeup(); trackedPreset = false; tracked = null; return regionFit(); } });
  const defaultView = upright ? 'hero' : spec.topdown ? 'top' : motionSize > 3 * appSize ? 'follow' : 'side';
  // named subjects for the close-up buttons: the focus body (what the close-up camera follows) and any part a Breakdown can explain alone
  const hung = id => (spec.joints || []).some(j => (j.a === id || j.b === id) && (j.type === 'rod' || j.type === 'rope'));
  const subjectName = id => { const b = byId[id] || {}, l = String(b.label || '').trim();
    if (/^[A-Za-z][a-z]{2,}$/.test(l)) return l[0].toUpperCase() + l.slice(1);
    const base = b.shape === 'circle' ? (hung(id) ? 'Bob' : 'Ball') : b.shape === 'box' ? (Math.max(b.w, b.h) > 4 * Math.min(b.w, b.h) ? 'Rod' : 'Block') : 'Body';
    return l ? base + ' ' + l : base; };
  const breakdown = teaching ? { kind: teachPlan.kind, needsForces: teachPlan.needsForces !== false } : null;
  return { update, hit, pickables, setFocus, setFade, select, breakdown, setRegion, get region() { return region && { point: [...region.point], size: region.size }; }, forceSubjects: forceSubjects.map(b => b.id), get forceChoices() { return allTargets(); }, get closeups() { return [{ type: 'body', id: focusId, name: subjectName(focusId) + ' close-up' }, ...(teaching?.targets || [])]; }, stringForces, incompleteReactionJoints, unavailableReactionJoints, get forceNote(){return supportWarning();},get warnings(){return supportWarning()?[supportWarning()]:[];}, focus: () => state.centre, get focusId() { return focusId; }, focusSize, gauge, bounds: { center, size, floorY, env }, cams, defaultView, resizeFrame, meshes, strings, teaching, teachTargets: teaching?.targets || [], pivots, state, frames: { plane: true }, props: Object.fromEntries(spec.bodies.map(b => [b.id, planarProp(b)]).filter(e => e[1])) };
}
