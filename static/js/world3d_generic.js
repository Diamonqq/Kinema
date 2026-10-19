/* Generic 3D builder: renders ANY Kinema2D spec + its frames. Nothing scene-specific lives here.
   Rules, each learned from a bad render:
   · frame the SCENE: static geometry + the focus body's motion (a long run-out or flight is clamped to 1.5× the static
     box; other bodies to 1.5× the scene box), padded so the longest arrow never leaves the frame;
   · the studio floor sits at the scene's lowest point — a rod swinging below y = 0 vanished under the old fixed floor;
   · arrow thickness scales with the focus body AND the scene; the gauge (longest arrow) with the focus body;
   · strings and their tensions meet a box at its top face, not its centre;
   · a focus body smaller than 2.5 % of the scene opens in the follow camera (a cue ball on a 5 m table is a dot). */
import * as THREE from 'three';
import { PALETTE, matte, satin, Arrow, slab, ball as ballMesh } from '/js/world3d.js';

const FORCE_COLOR = { gravity: PALETTE.mg, normal: PALETTE.N, friction: PALETTE.f, joint: 0x4fd8c4, applied: 0xff7ab6 };
const FORCE_PREF = { gravity: 25, normal: -70, friction: 170, joint: -110, applied: 40 };
const STATIC_MAT = () => matte(0x2b3241, { roughness: 0.78, envMapIntensity: 0.25 });
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const reach = b => b.shape === 'circle' ? b.r : b.shape === 'box' ? Math.hypot(b.w, b.h) / 2 : 0;
const sizeOf = b => b.shape === 'circle' ? b.r : b.shape === 'box' ? Math.max(b.w, b.h) / 2 : 0.3;

class Box2 {
  constructor() { this.min = new THREE.Vector2(Infinity, Infinity); this.max = new THREE.Vector2(-Infinity, -Infinity); }
  get ok() { return isFinite(this.min.x); } get w() { return this.max.x - this.min.x; } get h() { return this.max.y - this.min.y; }
  grow(x, y, r) { r = r || 0; this.min.x = Math.min(this.min.x, x - r); this.min.y = Math.min(this.min.y, y - r); this.max.x = Math.max(this.max.x, x + r); this.max.y = Math.max(this.max.y, y + r); return this; }
  union(o) { if (o && o.ok) { this.grow(o.min.x, o.min.y); this.grow(o.max.x, o.max.y); } return this; }
  clampTo(o) { if (!this.ok || !o.ok) return this; this.min.x = Math.max(this.min.x, o.min.x); this.min.y = Math.max(this.min.y, o.min.y); this.max.x = Math.min(this.max.x, o.max.x); this.max.y = Math.min(this.max.y, o.max.y); if (this.min.x > this.max.x || this.min.y > this.max.y) { this.min.set(Infinity, Infinity); this.max.set(-Infinity, -Infinity); } return this; }
  scaled(k) { const b = new Box2(); if (!this.ok) return b; const cx = (this.min.x + this.max.x) / 2, cy = (this.min.y + this.max.y) / 2, hw = this.w / 2 * k, hh = this.h / 2 * k; return b.grow(cx - hw, cy - hh).grow(cx + hw, cy + hh); }
  pad(p) { if (this.ok) { this.min.x -= p; this.min.y -= p; this.max.x += p; this.max.y += p; } return this; }
}

/* The scene box = the APPARATUS (static geometry, every body's starting pose, joint anchors, string ends) plus as much
   of the motion as fits in 2× the apparatus. A body that travels more than 3× the apparatus (a cue ball on a table,
   a spool on a floor) is followed instead of framed. */
export function envelope(spec, sim, focusId, pad) {
  const app = new Box2(), motion = new Box2(), focusMotion = new Box2();
  for (const b of spec.bodies) {
    if (b.shape === 'edge') continue;
    if (b.shape === 'polygon') for (const p of b.points) app.grow((b.pos?.[0] || 0) + p[0], (b.pos?.[1] || 0) + p[1]);
    else app.grow(b.pos?.[0] || 0, b.pos?.[1] || 0, reach(b));
  }
  for (const j of spec.joints || []) for (const a of [j.anchor, j.anchorA, j.anchorB, j.groundA, j.groundB]) if (a) app.grow(a[0], a[1]);
  for (const [, top] of spec.ropes || []) app.grow(top[0], top[1]);
  for (const p of spec.frame || []) app.grow(p[0], p[1]);   // drawing only: extra points the view must hold (a projectile's whole path)
  if (sim) { const step = Math.max(1, Math.floor(sim.frames.length / 400)); for (let i = 0; i < sim.frames.length; i += step) { const fr = sim.frames[i]; for (const b of spec.bodies) { const s = fr.bodies[b.id]; if (b.type === 'static' || b.shape === 'edge' || !s) continue; motion.grow(s.cx, s.cy, reach(b)); if (b.id === focusId) focusMotion.grow(s.cx, s.cy, reach(b)); } } }
  if (!app.ok) app.grow(0, 0, 1);
  const box = new Box2().union(app).union(new Box2().union(motion).clampTo(app.scaled(spec.frame_motion ?? 2)));
  return { box: box.pad(pad || 0), appSize: Math.max(app.w, app.h), motionSize: focusMotion.ok ? Math.max(focusMotion.w, focusMotion.h) : 0 };
}

/* Distance at which a w × h rectangle facing the camera fills the view, with a margin. */
export function fitDistance(camera, w, h, margin) {
  const t = Math.tan((camera.fov || 30) * Math.PI / 360), a = camera.aspect || 1.6;
  return Math.max(h / 2 / t, w / 2 / (a * t), 1e-3) * (margin || 1.25);
}

export function buildGeneric(stage, spec, sim) {
  const { scene, camera } = stage;
  const byId = {}; for (const b of spec.bodies) byId[b.id] = b;
  const focusId = spec.focus || (spec.bodies.find(b => b.type !== 'static') || {}).id;
  const focusBody = byId[focusId]; const focusSize = focusBody ? sizeOf(focusBody) : 0.3; const focusIsBox = (focusBody || {}).shape === 'box';
  const gauge = focusIsBox ? 0.6 * focusSize : 1.35 * focusSize;          // the largest force draws this long
  const { box: env, appSize, motionSize } = envelope(spec, sim, focusId, gauge * 1.15); const size = Math.max(env.w, env.h, 0.5);
  const depthOf = b => b.shape === 'circle' ? Math.max(0.12, b.r * 0.5) : Math.max(0.08, Math.min(b.w || 1, b.h || 1) * 1.2);
  const meshes = {}, zOf = {}, liftOf = {};
  for (const b of spec.bodies) {
    if (b.shape === 'edge') continue;   // ground lines are the studio floor
    const kind = (b.render || {}).kind || (b.shape === 'circle' ? 'disk' : b.shape === 'box' ? 'box' : 'slab');
    zOf[b.id] = (b.render || {}).z || 0;
    let g;
    if (b.shape === 'circle') {
      if (kind === 'sphere') { const dr = (b.render || {}).display_r || b.r; liftOf[b.id] = dr - b.r; g = ballMesh(scene, dr, b.type === 'static' ? PALETTE.slab : PALETTE.body); if (b.type === 'static') { g.children[0].material = STATIC_MAT(); g.children.slice(1).forEach(c => c.visible = false); } }
      else {
        g = new THREE.Group(); const d = depthOf(b);
        const cyl = new THREE.Mesh(new THREE.CylinderGeometry(b.r, b.r, d, 96), b.type === 'static' ? STATIC_MAT() : satin(PALETTE.body)); cyl.rotation.x = Math.PI / 2; cyl.castShadow = true; cyl.receiveShadow = true; g.add(cyl);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(b.r * 0.999, b.r * 0.012, 10, 128), matte(0xf4f5f7)); rim.position.z = d / 2 + 0.001; g.add(rim);
        for (let k = 0; k < 2; k++) { const spoke = new THREE.Mesh(new THREE.BoxGeometry(b.r * 1.96, b.r * 0.03, 0.004), matte(0xf4f5f7, { transparent: true, opacity: 0.8 })); spoke.position.z = d / 2 + 0.003; spoke.rotation.z = k * Math.PI / 2; g.add(spoke); }
        if ((b.render || {}).inner) { const inner = new THREE.Mesh(new THREE.CylinderGeometry(b.render.inner, b.render.inner, d * 1.6, 64), matte(0x3a4152)); inner.rotation.x = Math.PI / 2; inner.castShadow = true; g.add(inner); }
        scene.add(g);
      }
    } else if (b.shape === 'box') {
      const d = kind === 'rod' ? Math.max(b.w, b.h) * 0.035 : depthOf(b);
      const mat = satin(PALETTE.body, { roughness: 0.5 });
      if (b.lambda && window.Kinema2D && window.Kinema2D.compileExpr) {   // a non-uniform rod: paint its density along its length (dark = light, bright = heavy)
        try { const f = window.Kinema2D.compileExpr(b.lambda); const N = 256, vals = []; let mx = 1e-12; for (let k = 0; k < N; k++) { const x = (k / (N - 1) - 0.5) * b.w; const v = Math.max(0, f({ x, l: b.w })); vals.push(v); mx = Math.max(mx, v); }
          const c = document.createElement('canvas'); c.width = N; c.height = 1; const cx = c.getContext('2d'); for (let k = 0; k < N; k++) { const t = Math.pow(vals[k] / mx, 0.6); const L = Math.round(40 + 215 * t); cx.fillStyle = `rgb(${L},${L},${L})`; cx.fillRect(k, 0, 1, 1); }
          const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; mat.map = tex; mat.color.set(0x8fa4ff); } catch (e) { /* an unreadable profile stays plain */ }
      }
      const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, kind === 'rod' ? Math.max(d, Math.min(b.w, b.h)) : d), mat); m.castShadow = true; m.receiveShadow = true;
      g = new THREE.Group(); g.add(m); scene.add(g);
    } else if (b.shape === 'polygon') {
      const width = Math.max(1.2, 4 * Math.max(...spec.bodies.filter(x => x.shape === 'circle' && x.type !== 'static').map(x => x.r), 0.3));
      const m = slab(scene, b.points, width);
      if (b.type !== 'static') { g = new THREE.Group(); scene.add(g); g.add(m); }
      else { m.position.x = b.pos?.[0] || 0; m.position.y = b.pos?.[1] || 0; m.rotation.z = b.angle || 0; continue; }
    }
    if (g) { g.position.set(b.pos?.[0] || 0, (b.pos?.[1] || 0) + (liftOf[b.id] || 0), zOf[b.id]); g.rotation.z = b.angle || 0; meshes[b.id] = g; }
  }
  // strings (drawn, not simulated — the joints carry the physics): thin tubes from a body's attach point to a fixed world point
  const ropeR = clamp(0.0025 * size, 0.003, 0.012);
  const ropes = (spec.ropes || []).map(([id, top]) => { const t = new THREE.Mesh(new THREE.CylinderGeometry(ropeR, ropeR, 1, 8), matte(0xe6e7ea)); t.castShadow = true; scene.add(t); return { id, top: new THREE.Vector3(top[0], top[1], 0), mesh: t }; });
  const hasRope = new Set(ropes.map(r => r.id));
  function attach(id, s) { const b = byId[id]; if (!b || b.shape !== 'box') return new THREE.Vector3(s.cx, s.cy, 0); return new THREE.Vector3(s.cx - Math.sin(s.a) * b.h / 2, s.cy + Math.cos(s.a) * b.h / 2, 0); }
  // pivots: a short axle through the anchor, sized to the scene
  const axR = clamp(0.012 * size, 0.008, 0.03), axL = clamp(0.1 * size, 0.06, 0.4);
  for (const j of spec.joints || []) if (j.type === 'pivot' && j.anchor) { const mk = new THREE.Mesh(new THREE.CylinderGeometry(axR, axR, axL, 24), matte(0x9aa3b8)); mk.rotation.x = Math.PI / 2; mk.position.set(j.anchor[0], j.anchor[1], 0); mk.castShadow = true; scene.add(mk); }
  const arrowR = Math.max(0.003, Math.min(0.03 * focusSize, 0.005 * size));
  const arrows = {}; const state = { centre: new THREE.Vector3(), tips: {}, labels: [] };
  const dynIds = spec.bodies.filter(b => b.type !== 'static').map(b => b.id);
  function arrowFor(key, kind) { if (!arrows[key]) arrows[key] = new Arrow(scene, FORCE_COLOR[kind] || 0xffffff, arrowR); return arrows[key]; }
  function update(frame, ov) {
    for (const id of Object.keys(meshes)) { const b = frame.bodies[id]; if (!b) continue; meshes[id].position.set(b.x, b.y + (liftOf[id] || 0), zOf[id]); meshes[id].rotation.z = b.a; }
    const fb = frame.bodies[focusId]; if (fb) state.centre.set(fb.cx, fb.cy, 0);
    for (const r of ropes) { const s = frame.bodies[r.id]; if (!s) continue; const a = attach(r.id, s); const len = a.distanceTo(r.top); r.mesh.scale.set(1, len, 1); r.mesh.position.copy(a.clone().add(r.top).multiplyScalar(0.5)); r.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), r.top.clone().sub(a).normalize()); }
    // forces on the focus body (or on every dynamic body when ov.allForces)
    const used = new Set(); state.tips = {}; state.labels = [];
    const show = ov.forces !== false; const targets = ov.allForces ? dynIds : [focusId];
    const forces = frame.forces.filter(f => targets.includes(f.body));
    const maxF = Math.max(1e-9, ...forces.map(f => Math.hypot(f.vec[0], f.vec[1])));
    for (const f of forces) {
      const m = Math.hypot(f.vec[0], f.vec[1]); if (m < 1e-4 * maxF) continue;
      const key = f.body + '|' + f.kind + '|' + (f.other || f.joint || ''); used.add(key);
      const at = f.kind === 'joint' && hasRope.has(f.body) ? attach(f.body, frame.bodies[f.body]) : new THREE.Vector3(f.at[0], f.at[1], zOf[f.body] || 0);
      const a = arrowFor(key, f.kind); a.update(at, new THREE.Vector3(f.vec[0], f.vec[1], 0), show ? gauge * m / maxF : 0);
      state.tips[key] = a.tip; state.labels.push({ key, label: f.label || f.kind, value: m, color: FORCE_COLOR[f.kind] || 0xffffff, pref: FORCE_PREF[f.kind] || 0, tip: a.tip });
    }
    for (const k of Object.keys(arrows)) if (!used.has(k)) arrows[k].update(state.centre, new THREE.Vector3(0, 1, 0), 0);
    if (ov.velocity && fb) {
      const a = arrowFor('__v', 'vel'); a.g.children.forEach(c => c.material.color.set(PALETTE.v)); const v = Math.hypot(fb.vx, fb.vy);
      const from = focusIsBox ? state.centre.clone() : state.centre.clone().add(new THREE.Vector3(0, focusSize * 1.15, 0));
      a.update(from, new THREE.Vector3(fb.vx, fb.vy, 0), v > 0.02 ? Math.min(focusIsBox ? 0.8 * focusSize : 2 * focusSize, focusSize * (0.3 + 0.35 * v)) : 0);
    }
    return state;
  }
  const center = new THREE.Vector3((env.min.x + env.max.x) / 2, (env.min.y + env.max.y) / 2, 0);
  const edgeYs = spec.bodies.filter(b => b.shape === 'edge').map(b => Math.min(b.points[0][1], b.points[1][1]));
  const floorY = edgeYs.length ? Math.min(...edgeYs) : env.min.y - 0.02 * size;
  const heroDir = new THREE.Vector3(0.5, 0.26, 1).normalize(), followDir = new THREE.Vector3(0.45, 0.28, 1).normalize();
  const flatMargin = spec.topdown ? 1.4 : 1.22;
  const cams = {
    hero: () => [center.clone().addScaledVector(heroDir, fitDistance(camera, env.w * 1.1, env.h, 1.2)), center.clone()],
    follow: () => [state.centre.clone().addScaledVector(followDir, fitDistance(camera, 7 * focusSize, 7 * focusSize, 1)), state.centre.clone().add(new THREE.Vector3(0.2 * focusSize, -0.15 * focusSize, 0))],
    side: () => [center.clone().add(new THREE.Vector3(0, 0.02 * size, fitDistance(camera, env.w, env.h, flatMargin))), center.clone()],
    top: () => [center.clone().add(new THREE.Vector3(0, 0, fitDistance(camera, env.w, env.h, flatMargin))), center.clone()],
  };
  const defaultView = spec.topdown ? 'top' : motionSize > 3 * appSize ? 'follow' : 'hero';
  return { update, focus: () => state.centre, focusSize, bounds: { center, size, floorY, env }, cams, defaultView, meshes, check: () => ({}) };
}
