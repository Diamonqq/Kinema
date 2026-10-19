/* Kinema prop library — reusable, parametric native meshes for the stage (three's y-up).
   createProp(id, options) → THREE.Group with userData {prop, physics:false, role, axis, bounds, anchors, animate?}.
   Drawing only: a prop never carries mass, inertia, contact or force attachment; the engines stay the authority.
   Rotor props are built about +Y; options.axis 'z' turns them so the rotor axis is +Z (planar stage: plane XY,
   depth Z). options.envelope (rigid parts) keeps every surface inside the physics shape's size: radius r and
   height h centred on the origin, or the box size — no stubs, frames or stands that would read as contact.
   Anchors are named local points [x,y,z] in the prop's final frame. disposeProp frees geometry and materials. */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { PALETTE, clay, steel, graphite, darken, edges } from './studio.js';

const TAU = Math.PI * 2, P = PALETTE;
const lighten = (c, k) => new THREE.Color(c).lerp(new THREE.Color(0xffffff), k ?? 0.3).getHex();
const pos = v => Math.max(+v || 0, 1e-4);

/* physics z-up → three y-up, the same proper rotation the engines' views use: (x, y, z) → (x, z, −y) */
export const physicsToThree = v => new THREE.Vector3(v[0], v[2], -v[1]);

function add(parent, geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
/* the spin cue around +Y: one smooth body in a with two narrow stripes in b half a turn apart (n > 1; n ≤ 1 plain).
   Alternating wedges read as a faceted pinwheel and a two-tone checker on a sphere; a stripe pair shows the turning and
   its rate without breaking the solid's surface. make(t0, dt, segs) builds the piece from angle t0 spanning dt. */
const SEGS = 64, STRIPE = TAU / 16, segsOf = dt => Math.max(1, Math.round((SEGS * dt) / TAU));
function sectors(parent, n, make, a, b, accent) {
  const g = new THREE.Group(); parent.add(g);
  if (!(n > 1)) { add(g, make(0, TAU, SEGS), a); return g; }
  for (const [i, m] of [0, Math.PI].entries()) {
    add(g, make(m - STRIPE / 2, STRIPE, segsOf(STRIPE)), i === 0 && accent ? accent : b);
    add(g, make(m + STRIPE / 2, Math.PI - STRIPE, segsOf(Math.PI - STRIPE)), a);
  }
  return g;
}
const cylSectors = (parent, r, h, n, a, b, accent, y = 0) => { const s = sectors(parent, n, (t0, dt, k) => new THREE.CylinderGeometry(r, r, h, k, 1, false, t0, dt), a, b, accent); s.position.y = y; return s; };
const lathe = (pts, segs = 64, t0 = 0, dt = TAU) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), segs, t0, dt);
/* a straight bar between two points (three space) */
function bar(parent, a, b, r, mat, segs = 12) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), L = d.length();
  const m = add(parent, new THREE.CylinderGeometry(r, r, Math.max(L, 1e-4), segs), mat);
  m.position.copy(A).addScaledVector(d, 0.5); if (L > 1e-9) m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); return m;
}
/* hatch strokes on a face (support slabs): short diagonal ink lines, the drafting convention for "fixed" */
function hatch(parent, w, d, y, n, len, color) {
  const pts = []; for (let i = 0; i <= n; i++) { const x = -w / 2 + (w * i) / n; pts.push(x, y, d / 2 + 1e-3, x - len, y - len, d / 2 + 1e-3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: color ?? P.ink2, transparent: true, opacity: 0.55 })); parent.add(l); return l;
}

export function disposeProp(group) {
  if (!group) return;
  const seen = new Set(); group.traverse(o => { for (const x of [o.geometry, ...[].concat(o.material || [])]) if (x && !seen.has(x)) { seen.add(x); x.dispose?.(); } });
  group.parent?.remove(group);
}

/* Axis triad. basis 'physics' maps the problem's x,y,z (z up) through physicsToThree; 'three' uses three's X,Y,Z
   directly (planar stage: x right, y up, z out of the screen). style 'world' = solid problem axes; 'body' = thinner,
   lighter axes that turn with the body. userData.tips/dirs are local three vectors keyed by label. */
export function createAxesTriad(o = {}) {
  const L = pos(o.length ?? 1), body = o.style === 'body', r = o.radius ?? L * (body ? 0.012 : 0.018);
  const names = o.names ?? ['x', 'y', 'z'], cols = o.colors ?? P.axes;
  const basis = o.basis === 'three' ? [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(v => new THREE.Vector3(...v)) : [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(physicsToThree);
  const g = new THREE.Group(), tips = {}, dirs = {}, colors = {}, only = o.only ? new Set(o.only) : null;
  basis.forEach((d, i) => {
    if (only && !only.has(names[i])) return;
    const c = body ? lighten(cols[i], 0.32) : cols[i], mat = new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0, emissive: c, emissiveIntensity: 0.15 });
    const head = L * (body ? 0.09 : 0.11), hr = r * (body ? 2.6 : 2.8);
    const shaft = bar(g, [0, 0, 0], d.clone().multiplyScalar(L - head).toArray(), r, mat, 10);
    const cone = add(g, new THREE.ConeGeometry(hr, head, 18), mat); cone.position.copy(d).multiplyScalar(L - head / 2); cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    shaft.castShadow = cone.castShadow = false;
    tips[names[i]] = d.clone().multiplyScalar(L).toArray(); dirs[names[i]] = d.toArray(); colors[names[i]] = c;
  });
  add(g, new THREE.SphereGeometry(r * (body ? 2 : 2.4), 14, 10), new THREE.MeshStandardMaterial({ color: body ? P.ink2 : P.ink, roughness: 0.5 })).castShadow = false;
  g.userData = { prop: 'reference_frame', physics: false, role: 'reference', style: body ? 'body' : 'world', tips, dirs, colors, names };
  return g;
}

// ── builders: each returns { g, anchors, animate? } in the +Y-axis build frame ─────────────────────────────────────
const two = (c, k = 0.3) => [clay(c), clay(darken(c, k))];
const B = {};

B.point_mass = o => {
  const g = new THREE.Group(), r = pos(o.r ?? 0.06), [a, b] = two(o.color ?? P.body, 0.22);
  add(g, new THREE.SphereGeometry(r, 24, 8, 0, TAU, 0, Math.PI / 2), a); add(g, new THREE.SphereGeometry(r, 24, 8, 0, TAU, Math.PI / 2, Math.PI / 2), b);
  return { g, anchors: { center: [0, 0, 0], top: [0, r, 0], bottom: [0, -r, 0] } };
};
B.sphere = o => {
  const g = new THREE.Group(), r = pos(o.r ?? 0.5), [a, b] = two(o.color ?? P.body);
  sectors(g, o.sectors ?? 8, (t0, dt, k) => new THREE.SphereGeometry(r, k, 32, t0, dt), a, b);
  return { g, anchors: { center: [0, 0, 0], top: [0, r, 0], bottom: [0, -r, 0] } };
};
/* thin spherical shell drawn as a cutaway: the missing wedge shows it is hollow, the inner face is darker */
B.shell = o => {
  const g = new THREE.Group(), r = pos(o.r ?? 0.5), t = Math.min(o.t ?? r * 0.045, r * 0.3), c = o.color ?? P.body, [a, b] = two(c);
  // the missing wedge faces the usual three-quarter view (+x, +z): phi 2.16 is that direction for SphereGeometry
  const cut = o.cutaway === false ? 0 : TAU * 0.26, span = TAU - cut, n = o.sectors ?? 8, p0 = (o.cutAt ?? 2.16) + cut / 2;
  add(g, new THREE.SphereGeometry(r, 56, 32, p0, span), a);   // one smooth shell: the cut faces already show it turning
  if (cut) {
    add(g, new THREE.SphereGeometry(r - t, 40, 24, p0, span), clay(darken(c, 0.55), { side: THREE.BackSide }));
    const face = clay(lighten(c, 0.4), { side: THREE.DoubleSide });
    for (const phi of [p0, p0 + span]) add(g, new THREE.RingGeometry(r - t, r, 40, 1, -Math.PI / 2, Math.PI), face).rotation.y = Math.PI + phi;
  }
  return { g, anchors: { center: [0, 0, 0], top: [0, r, 0], bottom: [0, -r, 0] } };
};
function axial(o, rDef, hDef, hollow) {
  const g = new THREE.Group(), r = pos(o.r ?? rDef), h = pos(o.h ?? hDef(r)), c = o.color ?? P.body, [a, b] = two(c), n = o.sectors ?? 8;
  if (hollow) {
    const ri = Math.min(o.ri ?? r * 0.86, r * 0.98), prof = [[ri, -h / 2], [r, -h / 2], [r, h / 2], [ri, h / 2], [ri, -h / 2]];
    sectors(g, n, (t0, dt, k) => lathe(prof, k, t0, dt), a, b);
  } else {
    cylSectors(g, r, h, n, a, b);
    const hub = clay(darken(c, 0.45)); add(g, new THREE.CylinderGeometry(r * 0.1, r * 0.1, h * 1.004, 24), hub);
  }
  return { g, anchors: { center: [0, 0, 0], top: [0, h / 2, 0], bottom: [0, -h / 2, 0], rim: [r, 0, 0] } };
}
B.disk = o => axial(o, 0.5, r => r * 0.12);
B.cylinder = o => axial(o, 0.35, () => 1);
B.tube = o => axial(o, 0.35, () => 1, true);
B.ring = o => {
  const g = new THREE.Group(), r = pos(o.r ?? 0.5), tr = Math.min(o.tube ?? r * 0.05, r * 0.4), [a, b] = two(o.color ?? P.body, 0.25), n = o.sectors ?? 8;
  const s = new THREE.Group(); s.rotation.x = Math.PI / 2; g.add(s);
  sectors(s, n, (t0, dt, k) => { const q = new THREE.TorusGeometry(r, tr, 12, Math.max(2, Math.ceil(1.5 * k)), dt); q.rotateZ(t0); return q; }, a, b);
  return { g, anchors: { center: [0, 0, 0], rim: [r, 0, 0] } };
};
B.rod = o => {
  const g = new THREE.Group(), L = pos(o.L ?? 1), r = pos(o.r ?? L * 0.02), c = o.color ?? P.steel;
  cylSectors(g, r, L, 6, steel(c), steel(darken(c, 0.14)));
  return { g, anchors: { center: [0, 0, 0], end_top: [0, L / 2, 0], end_bottom: [0, -L / 2, 0] } };
};
const boxSize = o => (o.size ?? [0.6, 0.4, 0.4]).map(pos);
B.box = o => {
  const g = new THREE.Group(), [sx, sy, sz] = boxSize(o);
  edges(add(g, new THREE.BoxGeometry(sx, sy, sz), clay(o.color ?? P.body)), 0.28);
  return { g, anchors: boxAnchors(sx, sy, sz) };
};
const boxAnchors = (sx, sy, sz) => ({ center: [0, 0, 0], top: [0, sy / 2, 0], bottom: [0, -sy / 2, 0], left: [-sx / 2, 0, 0], right: [sx / 2, 0, 0], front: [0, 0, sz / 2] });
/* solid cone: base centred at the origin, apex at +h (the engine's cone convention) */
B.cone = o => {
  const g = new THREE.Group(), r = pos(o.r ?? 0.35), h = pos(o.h ?? 0.9), [a, b] = two(o.color ?? P.body, 0.2);
  const s = sectors(g, o.sectors ?? 8, (t0, dt, k) => new THREE.ConeGeometry(r, h, k, 1, false, t0, dt), a, b); s.position.y = h / 2;
  return { g, anchors: { base_center: [0, 0, 0], apex: [0, h, 0], rim: [r, 0, 0] } };
};

// ── rotor assemblies (built about +Y; axis 'z' turns them for the planar stage) ─────────────────────────────────
/* spoked wheel: rubber tyre, steel rim, spokes, hub; one body-coloured spoke reads the turning */
function wheelRotor(r, w, o = {}) {
  const g = new THREE.Group(), tt = r * 0.13, rub = clay(darken(P.graphite, 0.35), { roughness: 0.92 }), st = steel(o.rim ?? P.steel), n = o.spokes ?? 6;
  const tyre = add(g, new THREE.TorusGeometry(r - tt, tt, 14, 72), rub); tyre.rotation.x = Math.PI / 2; tyre.scale.z = Math.min(1.6, (w / 2) / tt);
  add(g, lathe([[r * 0.70, -w * 0.36], [r - tt * 1.2, -w * 0.4], [r - tt * 1.2, w * 0.4], [r * 0.70, w * 0.36], [r * 0.70, -w * 0.36]], 72), st);
  const hubR = r * 0.17; add(g, new THREE.CylinderGeometry(hubR, hubR, w * 0.86, 28), steel(darken(o.rim ?? P.steel, 0.25)));
  add(g, new THREE.CylinderGeometry(hubR * 0.42, hubR * 0.42, w * 0.9, 18), graphite());
  const mark = clay(o.color ?? P.body), sr = o.solid ? Math.min(r * 0.03, w * 0.1) : 0, ys = o.solid ? [w * 0.25 + sr, -w * 0.25 - sr] : [0];
  // solid: a full web (the engine's disk is solid), with the spokes as ribs on both faces
  if (o.solid) { const [a, b] = two(o.color ?? P.body); cylSectors(g, r * 0.72, w * 0.5, 8, a, b); }
  for (let i = 0; i < n; i++) { const a = (i * TAU) / n, c = Math.cos(a), s = Math.sin(a); for (const y of ys) bar(g, [hubR * 0.9 * c, y, hubR * 0.9 * s], [r * 0.71 * c, y, r * 0.71 * s], o.solid ? sr * (i ? 1 : 1.2) : Math.min(r * (i ? 0.03 : 0.045), w * 0.4), i ? st : (o.solid ? st : mark), 10); }
  return g;
}
B.wheel = o => {
  const r = pos(o.r ?? 0.5), w = pos(o.envelope ? (o.h ?? r * 0.3) : (o.w ?? o.h ?? r * 0.3)), g = new THREE.Group(), rotor = wheelRotor(r, w, { ...o, solid: o.solid ?? o.envelope }); g.add(rotor);
  return { g, anchors: { axle: [0, 0, 0], contact: [0, 0, r], rim_top: [0, 0, -r] }, animate: { spin: a => { rotor.rotation.y = a; } } };
};
/* grooved pulley: U-groove where the rope seats (groove radius = the physics radius on the planar stage), flanges,
   web with lightening holes, hub and axle. envelope: flange at the part radius instead. mount 'ceiling' adds a
   two-cheek bracket above the axle (planar orientation only). */
B.pulley = o => {
  const lip = Math.min(Math.max(o.lip ?? 0.12, 0), 0.3), R = pos(o.r ?? 0.4), rg = o.envelope ? R / (1 + lip) : R, rf = rg * (1 + lip);
  const w = pos(o.envelope ? (o.h ?? rg * 0.34) : (o.w ?? o.h ?? rg * 0.34)), f = w * 0.16, gw = w / 2 - f, g = new THREE.Group(), rotor = new THREE.Group(); g.add(rotor);
  const prof = [[rg * 0.8, -w / 2], [rf, -w / 2], [rf, -gw]]; for (let k = 1; k < 12; k++) { const t = -Math.PI / 2 + (k * Math.PI) / 12; prof.push([rg + (rf - rg) * (1 - Math.cos(t)), gw * Math.sin(t)]); }
  prof.push([rf, gw], [rf, w / 2], [rg * 0.8, w / 2], [rg * 0.8, -w / 2]);
  const c = o.color ?? P.steel; add(rotor, lathe(prof, 80), steel(c));
  add(rotor, new THREE.CylinderGeometry(rg * 0.81, rg * 0.81, w * 0.34, 64), steel(lighten(c, 0.12)));
  add(rotor, new THREE.CylinderGeometry(rg * 0.2, rg * 0.2, w * 0.92, 32), steel(darken(c, 0.2)));
  add(rotor, new THREE.CylinderGeometry(rg * 0.075, rg * 0.075, o.envelope ? w : w * 1.5, 16), graphite());
  const hole = clay(darken(P.graphite, 0.45)), paint = clay(o.accent ?? P.body);
  if (!o.envelope) for (let i = 0; i < 4; i++) { const a = (i * TAU) / 4 + Math.PI / 4; for (const y of [w * 0.172, -w * 0.172]) add(rotor, new THREE.CylinderGeometry(rg * 0.13, rg * 0.13, 0.002 * rg, 24), hole, Math.cos(a) * rg * 0.5, y, Math.sin(a) * rg * 0.5); }
  for (const y of [w * 0.174, -w * 0.174]) add(rotor, new THREE.BoxGeometry(rg * 0.4, 0.003 * rg, rg * 0.07), paint, rg * 0.53, y, 0);
  const anchors = { axle: [0, 0, 0], groove_top: [0, 0, -rg], groove_left: [-rg, 0, 0], groove_right: [rg, 0, 0], groove_bottom: [0, 0, rg] };
  let fixed = null, fixedAnchors = {};
  if (o.mount === 'ceiling' && !o.envelope && (o.axis ?? 'z') === 'z') {
    fixed = new THREE.Group(); const cm = steel(darken(P.steel, 0.3)), top = rf + rg * 0.32, cw = rg * 0.3, ct = rg * 0.06, z = w / 2 + ct;
    for (const s of [1, -1]) edges(add(fixed, new THREE.BoxGeometry(cw, top, ct), cm, 0, top / 2, s * z), 0.2);
    edges(add(fixed, new THREE.BoxGeometry(cw * 1.5, rg * 0.1, 2 * z + ct), cm, 0, top + rg * 0.05, 0), 0.2);
    add(fixed, new THREE.CylinderGeometry(rg * 0.075, rg * 0.075, 2 * z + ct * 1.6, 16), graphite()).rotation.x = Math.PI / 2;
    fixedAnchors = { mount_top: [0, top + rg * 0.1, 0] };
  }
  return { g, anchors, fixed, fixedAnchors, animate: { spin: a => { rotor.rotation.y = a; } } };
};
/* spool / yo-yo: two flanges, core and a wound thread band; thread leaves tangentially at thread_top/bottom */
B.spool = o => {
  const r = pos(o.r ?? 0.45), w = pos(o.envelope ? (o.h ?? r * 0.8) : (o.w ?? o.h ?? r * 0.8)), ri = Math.min(o.ri ?? r * 0.38, r * 0.9), rt = Math.min(Math.max(o.rt ?? r * 0.6, ri), r * 0.95);
  const g = new THREE.Group(), rotor = new THREE.Group(); g.add(rotor);
  const col = o.color ?? P.body2, fl = clay(col), ft = w * 0.14, core = w - 2 * ft;
  for (const s of [1, -1]) edges(add(rotor, new THREE.CylinderGeometry(r, r, ft, 64), fl, 0, s * (w / 2 - ft / 2), 0), 0.25, 30);
  add(rotor, new THREE.CylinderGeometry(ri, ri, core, 40), clay(lighten(col, 0.25)));
  const thread = o.thread ?? 0xC8CFD9; add(rotor, new THREE.CylinderGeometry(rt, rt, core * 0.96, 64), clay(thread, { roughness: 0.9 }));
  const lines = clay(darken(thread, 0.3)); for (let k = 1; k < 6; k++) add(rotor, new THREE.TorusGeometry(rt, rt * 0.012, 6, 64), lines, 0, (-core / 2 + (core * k) / 6) * 0.96, 0).rotation.x = Math.PI / 2;
  const mk = clay(darken(col, 0.45)); for (const s of [1, -1]) add(rotor, new THREE.BoxGeometry(r * 0.5, 0.004 * r, r * 0.08), mk, r * 0.62, s * (w / 2 + 0.002 * r), 0);
  // the flange hides the wound drum, so each outer face carries a thin ring at the thread radius: where the thread leaves
  const ring = clay(darken(col, 0.45), { side: THREE.DoubleSide }); for (const s of [1, -1]) add(rotor, new THREE.RingGeometry(rt - r * 0.012, rt + r * 0.012, 72), ring, 0, s * (w / 2 + 0.002 * r), 0).rotation.x = -Math.PI / 2;   // flat, so it stays on the face
  return { g, anchors: { axle: [0, 0, 0], thread_top: [0, 0, -rt], thread_bottom: [0, 0, rt], rim_bottom: [0, 0, r] }, animate: { spin: a => { rotor.rotation.y = a; } } };
};
/* flywheel rotor: thick rim, thin web, hub; stripe paint on the rim. matte (a rigid part's dressing, seen face-on): the
   part is a uniform solid disk, so it is drawn as one: full thickness to the hub with softly chamfered edges, one matte
   colour with the stripe pair, and a small steel hub. A heavy rim on a thin web would read as a ring-like flywheel with
   more of its mass at the rim than the physics has. */
function flywheel(parent, rr, t, c, web = 0.34, matte = false) {
  const rot = new THREE.Group(); parent.add(rot);
  if (matte) {
    const ch = Math.min(t * 0.18, rr * 0.04), prof = [[0, -t / 2], [rr - ch, -t / 2], [rr, -t / 2 + ch], [rr, t / 2 - ch], [rr - ch, t / 2], [0, t / 2]];
    const base = darken(c, 0.1), mat = o => clay(o, { roughness: 0.86, envMapIntensity: 0.22 });
    sectors(rot, 8, (t0, dt, k) => lathe(prof, k, t0, dt), mat(base), mat(darken(base, 0.3)));
    add(rot, new THREE.CylinderGeometry(rr * 0.15, rr * 0.15, t * 1.002, 32), steel(darken(P.steel, 0.25), { roughness: 0.6, envMapIntensity: 0.3 }));
    return rot;
  }
  const [a, b] = two(c, 0.22);
  sectors(rot, 8, (t0, dt, k) => lathe([[rr * 0.78, -t / 2], [rr, -t / 2], [rr, t / 2], [rr * 0.78, t / 2], [rr * 0.78, -t / 2]], k, t0, dt), a, b);
  add(rot, new THREE.CylinderGeometry(rr * 0.79, rr * 0.79, t * web, 64), steel(P.steel));
  add(rot, new THREE.CylinderGeometry(rr * 0.17, rr * 0.17, t, 28), steel(darken(P.steel, 0.2)));
  return rot;
}
B.gyroscope = o => {
  const r = pos(o.r ?? 0.45), g = new THREE.Group();
  if (o.envelope) { const h = pos(o.h ?? r * 0.25), rot = flywheel(g, r, h, o.color ?? P.body2, 0.56, true); return { g, anchors: { center: [0, 0, 0], top: [0, h / 2, 0] }, animate: { spin: a => { rot.rotation.y = a; } } }; }
  const rot = flywheel(g, r * 0.74, r * 0.2, o.color ?? P.body2), st = steel(P.steel);
  bar(rot, [0, -r, 0], [0, r, 0], r * 0.035, st, 14);
  add(g, new THREE.TorusGeometry(r, r * 0.028, 10, 96), st); // gimbal ring in the plane that holds the axle
  for (const s of [1, -1]) add(g, new THREE.SphereGeometry(r * 0.055, 16, 12), steel(darken(P.steel, 0.25)), 0, s * r, 0);
  return { g, anchors: { center: [0, 0, 0], axle_top: [0, r, 0], foot: [0, -r, 0] }, animate: { spin: a => { rot.rotation.y = a; } } };
};
B.turntable = o => {
  const r = pos(o.r ?? 0.6), h = pos(o.h ?? r * 0.08), g = new THREE.Group(), rot = new THREE.Group(), c = o.color ?? P.static; g.add(rot);
  cylSectors(rot, r, h, 12, clay(c), clay(darken(c, 0.12)));
  add(rot, new THREE.BoxGeometry(r * 0.86, 0.004 * r, r * 0.05), clay(o.accent ?? P.body), r * 0.5, h / 2 + 0.002 * r, 0);
  if (!o.envelope) {
    add(rot, new THREE.CylinderGeometry(r * 0.05, r * 0.05, h + r * 0.1, 18), steel(P.steel), 0, r * 0.05, 0);
    add(g, new THREE.CylinderGeometry(r * 0.14, r * 0.2, r * 0.3, 32), steel(darken(P.steel, 0.25)), 0, -h / 2 - r * 0.15, 0);
    add(g, new THREE.CylinderGeometry(r * 0.5, r * 0.55, r * 0.06, 48), graphite(), 0, -h / 2 - r * 0.33, 0);
  }
  return { g, anchors: { center: [0, 0, 0], center_top: [0, h / 2, 0], rim_top: [r, h / 2, 0] }, animate: { spin: a => { rot.rotation.y = a; } } };
};

/* spinning top: tip at the origin, crown up (+Y). envelope (cone part): tip at the cone apex, crown at the base */
B.top = o => {
  const R = pos(o.r ?? 0.35), H = pos(o.h ?? 0.8), g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const prof = o.envelope ? [[0, 0], [R * 0.04, H * 0.03], [R * 0.97, H * 0.9], [R, H * 0.93], [R * 0.9, H * 0.96], [R * 0.2, H * 0.97], [R * 0.12, H * 0.975], [R * 0.12, H], [0, H]]
    : [[0, 0], [R * 0.05, H * 0.025], [R * 0.16, H * 0.08], [R * 0.98, H * 0.5], [R, H * 0.55], [R * 0.9, H * 0.61], [R * 0.34, H * 0.7], [R * 0.12, H * 0.73], [R * 0.12, H * 0.98], [R * 0.08, H], [0, H]];
  const [a, b] = two(o.color ?? P.body4, 0.22); sectors(body, 8, (t0, dt, k) => lathe(prof, k, t0, dt), a, b);
  add(body, new THREE.TorusGeometry(R * 0.975 * (o.envelope ? 0.93 : 1), R * 0.025, 8, 64), clay(o.accent ?? P.highlight), 0, H * (o.envelope ? 0.88 : 0.55), 0).rotation.x = Math.PI / 2;
  if (o.envelope) { body.rotation.x = Math.PI; body.position.y = H; return { g, anchors: { tip: [0, H, 0], crown: [0, 0, 0] }, animate: { spin: t => { body.rotation.y = -t; } } }; }
  return { g, anchors: { tip: [0, 0, 0], crown: [0, H, 0] }, animate: { spin: t => { body.rotation.y = t; } } };
};
/* planet / moon / star: latitude bands, equator line and spin axis; a single storm spot shows the turning */
B.planet = o => {
  const r = pos(o.r ?? 0.5), kind = o.kind ?? 'planet', g = new THREE.Group(), rot = new THREE.Group(); g.add(rot);
  if (kind === 'star') {
    const c = o.color ?? 0xF2C46A; add(rot, new THREE.SphereGeometry(r, 48, 32), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.55, roughness: 0.8 }));
  } else if (kind === 'moon') {
    const c = o.color ?? 0xA9ADB4; add(rot, new THREE.SphereGeometry(r, 40, 24, 0, Math.PI), clay(c)); add(rot, new THREE.SphereGeometry(r, 40, 24, Math.PI, Math.PI), clay(darken(c, 0.55)));
  } else {
    const c = o.color ?? P.body, bands = [0, 0.16, 0.3, 0.42, 0.5, 0.58, 0.7, 0.84, 1], tint = [0, 0.14, -0.1, 0.2, 0.08, -0.06, 0.16, 0];
    for (let i = 0; i < bands.length - 1; i++) add(rot, new THREE.SphereGeometry(r, 48, 6, 0, TAU, bands[i] * Math.PI, (bands[i + 1] - bands[i]) * Math.PI), clay(tint[i] < 0 ? lighten(c, -tint[i]) : darken(c, tint[i])));
    if (!o.envelope) { const spot = add(rot, new THREE.SphereGeometry(r * 0.13, 20, 12), clay(o.accent ?? P.body2), r * 0.94, -r * 0.24, 0); spot.lookAt(0, 0, 0); spot.scale.set(1.3, 0.75, 0.4); }
  }
  if (!o.envelope && kind !== 'star') {
    bar(g, [0, -r * 1.3, 0], [0, r * 1.3, 0], r * 0.018, steel(P.ink2), 10);
    add(g, new THREE.TorusGeometry(r * 1.004, r * 0.01, 6, 96), clay(P.ink2)).rotation.x = Math.PI / 2;
  }
  return { g, anchors: { center: [0, 0, 0], north: [0, r, 0], south: [0, -r, 0] }, animate: { spin: a => { rot.rotation.y = a; } } };
};
/* projectile: a ball with a two-tone seam at the origin (the launch point); launcher (free mode) behind it at the
   launch angle in the XY plane — barrel, carriage and wheels resting on y = ground */
B.projectile = o => {
  const r = pos(o.r ?? 0.08), g = new THREE.Group(), ball = new THREE.Group(); g.add(ball);
  const c = o.color ?? P.body4; add(ball, new THREE.SphereGeometry(r, 24, 16, 0, Math.PI), clay(c)); add(ball, new THREE.SphereGeometry(r, 24, 16, Math.PI, Math.PI), clay(darken(c, 0.3)));
  const anchors = { center: [0, 0, 0] };
  if (!o.envelope && o.launcher !== false) {
    const th = o.angle ?? (40 * Math.PI) / 180, d = new THREE.Vector3(Math.cos(th), Math.sin(th), 0), Lb = r * 7, rb = r * 1.25, st = steel(darken(P.steel, 0.15));
    const barrel = add(g, lathe([[r * 1.05, 0], [rb, 0], [rb * 1.1, Lb * 0.06], [rb * 1.35, Lb * 0.86], [rb * 1.5, Lb], [r * 1.05, Lb], [r * 1.05, 0]], 40), st);
    barrel.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().negate()); barrel.position.copy(d).multiplyScalar(-r * 0.2);
    const breech = d.clone().multiplyScalar(-Lb * 0.8), wr = r * 2.6, ground = breech.y - wr * 1.05;
    const wood = clay(P.body2); edges(add(g, new THREE.BoxGeometry(Lb * 0.75, wr * 0.7, rb * 2.4), wood, breech.x + Lb * 0.12, breech.y - wr * 0.25, 0), 0.25);
    for (const s of [1, -1]) { const w = wheelRotor(wr, r * 0.9, { spokes: 8, color: P.body2, rim: P.body2 }); w.rotation.x = Math.PI / 2; w.position.set(breech.x + Lb * 0.18, ground + wr, s * rb * 1.6); g.add(w); }
    Object.assign(anchors, { launch_dir: d.toArray(), muzzle: [0, 0, 0], ground: [breech.x, ground, 0] });
  }
  return { g, anchors, animate: { spin: a => { ball.rotation.z = a; } } };
};
/* rocket: base at y = 0, nose up; nozzle, fins and a window band */
B.rocket = o => {
  const R = pos(o.r ?? 0.12), H = pos(o.h ?? 1), g = new THREE.Group();
  const prof = [[0, H * 0.06], [R * 0.9, H * 0.08], [R, H * 0.12], [R, H * 0.68]]; for (let k = 1; k <= 10; k++) { const t = k / 10; prof.push([R * Math.sqrt(1 - t * t) * (1 - 0.15 * t), H * (0.68 + 0.32 * t)]); }
  add(g, lathe(prof, 48), clay(o.color ?? 0xC9CED6));
  add(g, lathe([[R * 0.3, H * 0.075], [R * 0.42, H * 0.05], [R * 0.62, 0], [R * 0.56, 0], [R * 0.36, H * 0.05], [R * 0.24, H * 0.075]], 32), steel(darken(P.steel, 0.3), { side: THREE.DoubleSide }));
  add(g, new THREE.CylinderGeometry(R * 1.004, R * 1.004, H * 0.05, 48), clay(o.accent ?? P.weight), 0, H * 0.6, 0);
  const fin = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(R * 0.9, -H * 0.04), new THREE.Vector2(R * 0.9, H * 0.04), new THREE.Vector2(0, H * 0.26)]);
  const fm = clay(o.accent ?? P.weight); for (let i = 0; i < 4; i++) { const m = add(g, new THREE.ExtrudeGeometry(fin, { depth: R * 0.08, bevelEnabled: false }), fm); m.geometry.translate(R * 0.95, H * 0.09, -R * 0.04); m.rotation.y = (i * TAU) / 4; }
  add(g, new THREE.CircleGeometry(R * 0.28, 24), clay(darken(P.paper, -1.2)), 0, H * 0.74, R * 0.985);
  return { g, anchors: { base: [0, 0, 0], nose: [0, H, 0] } };
};
/* bead on a rotating hoop: vertical hoop in its XY plane, spindle along +Y; spin turns the hoop, setAngle moves
   the bead (angle from the bottom, toward +x) */
B.bead_hoop = o => {
  const r = pos(o.r ?? 0.5), g = new THREE.Group(), hoop = new THREE.Group(); g.add(hoop);
  add(hoop, new THREE.TorusGeometry(r, r * 0.022, 10, 120), steel(P.steel));
  bar(g, [0, -r * 1.25, 0], [0, r * 1.25, 0], r * 0.03, steel(darken(P.steel, 0.3)), 14);
  for (const s of [1, -1]) add(hoop, new THREE.SphereGeometry(r * 0.04, 12, 8), steel(darken(P.steel, 0.2)), 0, s * r, 0);
  const bead = add(hoop, new THREE.SphereGeometry(r * 0.075, 24, 16), clay(o.color ?? P.body4));
  const setAngle = t => bead.position.set(r * Math.sin(t), -r * Math.cos(t), 0); setAngle(o.angle ?? 0.7);
  return { g, anchors: { center: [0, 0, 0], spindle_top: [0, r * 1.25, 0], bead: bead.position.toArray() }, animate: { spin: a => { hoop.rotation.y = a; }, setAngle } };
};
/* pendulum: pivot at the origin (pin along +Z), arm 'string' or 'rod', bob at length L; setAngle from straight down
   (+ = counter-clockwise about +Z). mount (default) adds a hatched ceiling block above the pin. */
B.pendulum = o => {
  const L = pos(o.L ?? 1), br = pos(o.r ?? L * 0.08), g = new THREE.Group(), arm = new THREE.Group(); g.add(arm);
  const rod = o.arm === 'rod', st = steel(P.steel);
  bar(arm, [0, 0, 0], [0, -(L - br * 0.6), 0], rod ? L * 0.014 : L * 0.005, rod ? st : clay(P.ink2), 10);
  const [a, b] = two(o.color ?? P.body, 0.25); add(arm, new THREE.SphereGeometry(br, 28, 10, 0, TAU, 0, Math.PI / 2), a, 0, -L, 0); add(arm, new THREE.SphereGeometry(br, 28, 10, 0, TAU, Math.PI / 2, Math.PI / 2), b, 0, -L, 0);
  add(g, new THREE.CylinderGeometry(L * 0.022, L * 0.022, L * 0.08, 18), steel(darken(P.steel, 0.25))).rotation.x = Math.PI / 2;
  if (o.mount !== false) {
    const w = L * 0.36, t = L * 0.05, d = L * 0.16, sl = new THREE.Group(); g.add(sl); sl.position.y = L * 0.06;
    edges(add(sl, new THREE.BoxGeometry(w, t, d), clay(P.support, { roughness: 0.9 }), 0, t / 2, 0), 0.25); hatch(sl, w, d, t, 8, t * 0.9);
    bar(g, [0, 0, 0], [0, L * 0.06, 0], L * 0.012, st, 10);
  }
  const setAngle = t => { arm.rotation.z = t; }; setAngle(o.angle ?? 0.45);
  const th = o.angle ?? 0.45;
  return { g, anchors: { pivot: [0, 0, 0], bob: [L * Math.sin(th), -L * Math.cos(th), 0] }, animate: { setAngle } };
};
/* orbit: ellipse (semi-major a, eccentricity e) in the XY plane with the attracting body at the focus (origin) and
   periapsis on +x; setAnomaly(ν) moves the orbiting body. A diagram: no orbital dynamics implied. */
B.orbit = o => {
  const a = pos(o.a ?? 1), e = Math.min(Math.max(o.e ?? 0.45, 0), 0.95), g = new THREE.Group(), rOf = nu => (a * (1 - e * e)) / (1 + e * Math.cos(nu));
  const pts = []; for (let i = 0; i <= 160; i++) { const nu = (i * TAU) / 160, r = rOf(nu); pts.push(new THREE.Vector3(r * Math.cos(nu), r * Math.sin(nu), 0)); }
  add(g, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 200, a * 0.009, 6, true), clay(P.ink2));
  add(g, new THREE.SphereGeometry(a * 0.09, 32, 20), new THREE.MeshStandardMaterial({ color: 0xF2C46A, emissive: 0xF2C46A, emissiveIntensity: 0.5, roughness: 0.8 }));
  const body = add(g, new THREE.SphereGeometry(a * 0.045, 24, 16), clay(o.color ?? P.body));
  for (const nu of [0, Math.PI]) { const r = rOf(nu); add(g, new THREE.SphereGeometry(a * 0.012, 10, 8), clay(P.ink), r * Math.cos(nu), 0, 0); }
  const setAnomaly = nu => { const r = rOf(nu); body.position.set(r * Math.cos(nu), r * Math.sin(nu), 0); }; setAnomaly(o.nu ?? 2.1);
  return { g, anchors: { focus: [0, 0, 0], periapsis: [rOf(0), 0, 0], apoapsis: [-rOf(Math.PI), 0, 0], center: [-a * e, 0, 0], body: body.position.toArray() }, animate: { setAnomaly } };
};

// ── box-like bodies (size [x, y, z] in three-local axes; every surface inside the size) ─────────────────────────
const rbox = (sx, sy, sz, k = 0.07) => new RoundedBoxGeometry(sx, sy, sz, 3, Math.min(sx, sy, sz) * k);
B.block = o => {
  const g = new THREE.Group(), [sx, sy, sz] = boxSize(o), c = o.color ?? P.body;
  add(g, rbox(sx, sy, sz), clay(c)); add(g, new THREE.BoxGeometry(sx * 0.86, 0.004 * sy, sz * 0.86), clay(lighten(c, 0.1)), 0, sy / 2 - 0.0015 * sy, 0);
  return { g, anchors: boxAnchors(sx, sy, sz) };
};
/* long props are built along +Y and turned onto the size's longest axis */
function alongLong(size, build) {
  const i = size.indexOf(Math.max(...size)), g = new THREE.Group(), inner = new THREE.Group(); g.add(inner);
  const L = size[i], [bx, bz] = i === 0 ? [size[1], size[2]] : i === 2 ? [size[0], size[1]] : [size[0], size[2]];
  build(inner, bx, L, bz); if (i === 0) inner.rotation.z = -Math.PI / 2; else if (i === 2) inner.rotation.x = Math.PI / 2;
  return g;
}
/* plank / beam: wood tone, grain lines along the length, darker end grain */
B.beam = o => {
  const size = (o.size ?? [1.6, 0.08, 0.2]).map(pos), c = o.color ?? P.body2;
  const g = alongLong(size, (p, bx, L, bz) => {
    add(p, rbox(bx, L, bz, 0.12), clay(c));
    const gm = clay(darken(c, 0.28)); for (const s of [1, -1]) for (const f of [-0.25, 0.1, 0.32]) { add(p, new THREE.BoxGeometry(0.003 * bz, L * 0.9, bz * 0.035), gm, s * (bx / 2 + 0.0002 * bz), 0, f * bz); add(p, new THREE.BoxGeometry(bx * 0.035, L * 0.9, 0.003 * bx), gm, f * bx, 0, s * (bz / 2 + 0.0002 * bx)); }
    for (const s of [1, -1]) add(p, new THREE.BoxGeometry(bx * 0.86, 0.004 * L, bz * 0.86), clay(darken(c, 0.2)), 0, s * (L / 2 - 0.0015 * L), 0);
  });
  return { g, anchors: boxAnchors(...size) };
};
B.ladder = o => {
  const size = (o.size ?? [0.45, 1.6, 0.06]).map(pos), c = o.color ?? P.body2;
  const g = alongLong(size, (p, bx, L, bz) => {
    // deeper than it is thick in the drawing plane (a planar ladder seen from the side): the rails sit at ±z and the rungs cross
    // in z, so its in-plane outline is just the rail thickness bx, exactly the physics box
    if (bz > 1.5 * bx) {
      const rw = Math.min(bz * 0.1, bx), wood = clay(c), rm = clay(darken(c, 0.15)), rr = Math.min(bx * 0.3, rw * 0.4), n = Math.max(3, Math.round(L / (bz * 0.75)));
      for (const s of [1, -1]) add(p, rbox(bx, L, rw, 0.2), wood, 0, 0, s * (bz / 2 - rw / 2));
      for (let k = 0; k < n; k++) add(p, new THREE.CylinderGeometry(rr, rr, bz - rw, 12), rm, 0, -L / 2 + (L * (k + 0.5)) / n, 0).rotation.x = Math.PI / 2;
      return;
    }
    const rw = bx * 0.12, wood = clay(c); for (const s of [1, -1]) add(p, rbox(rw, L, bz, 0.2), wood, s * (bx / 2 - rw / 2), 0, 0);
    const n = Math.max(3, Math.round(L / (bx * 0.7))), rr = o.envelope ? bz * 0.06 : Math.min(bz * 0.3, rw * 0.35), rm = clay(darken(c, 0.15)), zs = o.envelope ? [bz * 0.44, -bz * 0.44] : [0];
    if (o.envelope) add(p, new THREE.BoxGeometry(bx - 2 * rw, L * 0.99, bz * 0.88), clay(darken(c, 0.32)));
    for (let k = 0; k < n; k++) for (const z of zs) { const y = -L / 2 + (L * (k + 0.5)) / n; add(p, new THREE.CylinderGeometry(rr, rr, bx - rw, 12), rm, 0, y, z).rotation.z = Math.PI / 2; }
  });
  return { g, anchors: boxAnchors(...size) };
};
/* wheels for carts and trains: axis +Z, resting on y = -sy/2; roll(dx) turns them for a translation dx along +x */
function axleWheels(g, list, wr, ww, o) {
  const ws = list.map(([x, z]) => { const wrap = new THREE.Group(), w = wheelRotor(wr, ww, { spokes: o.spokes ?? 5, color: o.wheelColor ?? P.body, rim: o.rim }); wrap.rotation.x = Math.PI / 2; wrap.add(w); wrap.position.set(x, 0, z); g.add(wrap); return w; });
  return { spin: a => ws.forEach(w => { w.rotation.y = a; }), roll: dx => ws.forEach(w => { w.rotation.y = -dx / wr; }) };
}
B.cart = o => {
  const g = new THREE.Group(), [sx, sy, sz] = boxSize({ size: o.size ?? [0.9, 0.42, 0.5] }), c = o.color ?? P.body;
  const wr = Math.min(sy * 0.3, sx * 0.15), ww = sz * 0.14, tubH = o.envelope ? sy : sy - wr * 1.2, ty = o.envelope ? 0 : -sy / 2 + wr * 1.2 + tubH / 2;
  add(g, rbox(sx, tubH, sz * (o.envelope ? 0.72 : 0.8), 0.08), clay(c), 0, ty, 0);
  add(g, new THREE.BoxGeometry(sx * 0.9, 0.006 * sy, sz * 0.7), clay(darken(c, 0.35)), 0, sy / 2 - 0.002 * sy, 0);
  const wl = axleWheels(g, [[sx / 2 - wr * 1.25, sz / 2 - ww / 2], [sx / 2 - wr * 1.25, -sz / 2 + ww / 2], [-sx / 2 + wr * 1.25, sz / 2 - ww / 2], [-sx / 2 + wr * 1.25, -sz / 2 + ww / 2]], wr, ww, o);
  g.children.slice(-4).forEach(w => { w.position.y = -sy / 2 + wr; });
  for (const s of [1, -1]) add(g, new THREE.CylinderGeometry(wr * 0.12, wr * 0.12, sz * 0.9, 10), steel(darken(P.steel, 0.3)), s * (sx / 2 - wr * 1.25), -sy / 2 + wr, 0).rotation.x = Math.PI / 2;
  return { g, anchors: { ...boxAnchors(sx, sy, sz), contact_front: [sx / 2 - wr * 1.25, -sy / 2, 0], contact_back: [-sx / 2 + wr * 1.25, -sy / 2, 0], deck: [0, sy / 2, 0] }, animate: wl };
};
B.train = o => {
  const g = new THREE.Group(), [sx, sy, sz] = boxSize({ size: o.size ?? [1.6, 0.5, 0.42] }), c = o.color ?? P.body;
  const wr = sy * 0.12, ww = sz * 0.1, chH = sy * 0.1, base = -sy / 2 + wr * 1.6, bodyH = sy / 2 - base - chH;
  add(g, new THREE.BoxGeometry(sx * 0.96, chH, sz * 0.82), graphite(), 0, base + chH / 2, 0);
  add(g, rbox(sx, bodyH, sz * 0.94, 0.12), clay(c), 0, base + chH + bodyH / 2, 0);
  add(g, new THREE.BoxGeometry(sx * 0.98, bodyH * 0.08, sz * 0.95), clay(darken(c, 0.3)), 0, base + chH + bodyH * 0.28, 0);
  const win = clay(darken(P.paper, -1.0), { roughness: 0.3 }), nw = Math.max(3, Math.round(sx / (sy * 0.55)));
  for (let k = 0; k < nw; k++) for (const s of [1, -1]) add(g, new THREE.BoxGeometry((sx * 0.7) / nw, bodyH * 0.3, 0.004 * sz), win, -sx * 0.4 + (sx * 0.8 * (k + 0.5)) / nw, base + chH + bodyH * 0.62, s * (sz * 0.47 + 0.002 * sz));
  const xs = [sx * 0.36, sx * 0.24, -sx * 0.24, -sx * 0.36], list = []; xs.forEach(x => list.push([x, sz * 0.36], [x, -sz * 0.36]));
  const wl = axleWheels(g, list, wr, ww, { ...o, spokes: 4, wheelColor: P.graphite }); g.children.slice(-list.length).forEach(w => { w.position.y = -sy / 2 + wr; });
  for (const s of [1, -1]) add(g, new THREE.BoxGeometry(sx * 0.2, wr * 0.8, sz * 0.6), graphite(), s * sx * 0.3, -sy / 2 + wr * 1.2, 0);
  return { g, anchors: { ...boxAnchors(sx, sy, sz), contact_front: [xs[0], -sy / 2, 0], contact_back: [xs[3], -sy / 2, 0] }, animate: wl };
};
/* elevator car: open cage (floor, roof, corner posts, translucent back and sides) hung from a cable above the roof */
B.elevator = o => {
  const g = new THREE.Group(), [sx, sy, sz] = boxSize({ size: o.size ?? [0.7, 0.9, 0.6] }), c = o.color ?? P.steel, ft = sy * 0.06, st = steel(c);
  edges(add(g, new THREE.BoxGeometry(sx, ft, sz), steel(darken(c, 0.2)), 0, -sy / 2 + ft / 2, 0), 0.25); edges(add(g, new THREE.BoxGeometry(sx, ft * 0.8, sz), st, 0, sy / 2 - ft * 0.4, 0), 0.25);
  const pr = Math.min(sx, sz) * 0.035; for (const x of [1, -1]) for (const z of [1, -1]) add(g, new THREE.BoxGeometry(pr * 2, sy - ft * 1.8, pr * 2), st, x * (sx / 2 - pr), -ft * 0.1, z * (sz / 2 - pr));
  const glass = clay(o.panel ?? P.body, { transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
  add(g, new THREE.PlaneGeometry(sx - 4 * pr, sy - ft * 1.8), glass, 0, -ft * 0.1, -sz / 2 + pr);
  for (const s of [1, -1]) add(g, new THREE.PlaneGeometry(sz - 4 * pr, sy - ft * 1.8), glass, s * (sx / 2 - pr), -ft * 0.1, 0).rotation.y = Math.PI / 2;
  const cable = o.cable ?? sy * 0.7; if (cable > 0) { bar(g, [0, sy / 2, 0], [0, sy / 2 + cable, 0], sx * 0.012, steel(P.ink2), 8); add(g, new THREE.CylinderGeometry(sx * 0.05, sx * 0.07, sy * 0.05, 16), st, 0, sy / 2 + sy * 0.025, 0); }
  return { g, anchors: { ...boxAnchors(sx, sy, sz), floor_top: [0, -sy / 2 + ft, 0], cable_top: [0, sy / 2 + Math.max(cable, 0), 0] } };
};

// ── fixtures and inclines ────────────────────────────────────────────────────────────────────────────────────
/* right-triangle prism in the XY plane, depth along Z: high end at −x, low end at +x (flip mirrors). Origin at the
   bounding-box centre. Slope angle from options.angle (rad) or base/height. */
function incline(o, fixed) {
  const b = pos(o.base ?? 1.2), h = pos(o.angle != null ? b * Math.tan(o.angle) : (o.height ?? 0.55)), d = pos(o.depth ?? 0.5), s = o.flip ? -1 : 1, c = o.color ?? (fixed ? P.support : P.body3);
  const sh = new THREE.Shape([new THREE.Vector2(-s * b / 2, -h / 2), new THREE.Vector2(s * b / 2, -h / 2), new THREE.Vector2(-s * b / 2, h / 2)]);
  const geo = new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: false }); geo.translate(0, 0, -d / 2);
  const g = new THREE.Group(), m = add(g, geo, clay(c, { side: THREE.DoubleSide })); edges(m, 0.3, 20);
  const len = Math.hypot(b, h), dir = [s * b / len, -h / len, 0], n = [s * h / len, b / len, 0], ang = Math.atan2(h, b);
  if (fixed) {
    const strip = add(g, new THREE.BoxGeometry(len * 0.98, 0.006 * h, d * 0.62), clay(lighten(c, 0.16)), 0, 0, 0); strip.rotation.z = -s * ang; strip.position.set(n[0] * 0.003 * h, n[1] * 0.003 * h, 0);
    hatch(g, b * 0.7, d, -h / 2 + 0.12 * h, 8, 0.1 * h).position.x = -s * b * 0.12;
  }
  return { g, anchors: { low: [s * b / 2, -h / 2, 0], high: [-s * b / 2, h / 2, 0], slope_mid: [0, 0, 0], corner: [-s * b / 2, -h / 2, 0], slope_dir: dir, slope_normal: n }, angle: ang };
}
B.wedge = o => incline(o, false);
B.ramp = o => incline(o, true);
/* support slab with drafting hatch: ceiling (face at y = 0, slab above), floor (slab below), wall (slab at −x) */
B.support = o => {
  const kind = o.kind ?? 'ceiling', w = pos(o.w ?? 1.2), t = pos(o.t ?? 0.08), d = pos(o.d ?? 0.4), g = new THREE.Group(), slab = new THREE.Group(); g.add(slab);
  edges(add(slab, new THREE.BoxGeometry(w, t, d), clay(o.color ?? P.support, { roughness: 0.9 }), 0, t / 2, 0), 0.25); hatch(slab, w, d, t * 0.92, Math.max(6, Math.round(w / t / 1.3)), t * 0.8);
  if (kind === 'floor') slab.rotation.z = Math.PI; else if (kind === 'wall') slab.rotation.z = Math.PI / 2;
  return { g, anchors: { face: [0, 0, 0], face_left: kind === 'wall' ? [0, w / 2, 0] : [-w / 2, 0, 0], face_right: kind === 'wall' ? [0, -w / 2, 0] : [w / 2, 0, 0] } };
};
/* hinge: knuckled barrel along +Y on the axis, pin caps, a leaf toward −x with screw heads */
B.hinge = o => {
  const L = pos(o.L ?? 0.3), r = pos(o.r ?? L * 0.12), g = new THREE.Group(), a = steel(P.steel), b = steel(darken(P.steel, 0.22)), n = 5;
  for (let k = 0; k < n; k++) add(g, new THREE.CylinderGeometry(r, r, (L / n) * 0.96, 24), k % 2 ? b : a, 0, -L / 2 + (L * (k + 0.5)) / n, 0);
  for (const s of [1, -1]) add(g, new THREE.CylinderGeometry(r * 0.55, r * 0.7, r * 0.3, 18), b, 0, s * (L / 2 + r * 0.15), 0).rotation.x = s > 0 ? 0 : Math.PI;
  if (o.leaf !== false) {
    const lw = o.leaf ?? L * 0.8, lt = r * 0.4; edges(add(g, new THREE.BoxGeometry(lw, L * 0.92, lt), clay(o.color ?? P.support, { roughness: 0.9 }), -lw / 2 - r * 0.6, 0, 0), 0.25);
    for (const y of [-0.3, 0, 0.3]) add(g, new THREE.CylinderGeometry(r * 0.28, r * 0.28, lt * 1.1, 14), b, -r * 0.6 - lw * 0.55, y * L, 0).rotation.x = Math.PI / 2;
  }
  return { g, anchors: { center: [0, 0, 0], axis_top: [0, L / 2, 0], axis_bottom: [0, -L / 2, 0], leaf_end: [-(o.leaf ?? L * 0.8) - r * 0.6, 0, 0] } };
};
/* pedestal stand with a socket cup; origin at the pivot point on top */
B.pivot_stand = o => {
  const h = pos(o.h ?? 1), b = pos(o.base ?? h * 0.26), pr = pos(o.post ?? h * 0.03), k = pos(o.cup ?? h * 0.06) / 0.06, g = new THREE.Group(), st = steel(P.steel);
  add(g, new THREE.CylinderGeometry(b * 0.86, b, b * 0.2, 48), graphite(), 0, -h + b * 0.1, 0);
  add(g, new THREE.CylinderGeometry(pr * 0.7, pr * 1.2, h - b * 0.2 - k * 0.03, 20), st, 0, -h / 2 + b * 0.1 - k * 0.015, 0);
  add(g, lathe([[k * 0.012, -k * 0.04], [k * 0.05, -k * 0.035], [k * 0.06, -k * 0.005], [k * 0.045, 0], [k * 0.03, -k * 0.02], [0, -k * 0.025]], 32), steel(darken(P.steel, 0.2), { side: THREE.DoubleSide }));
  return { g, anchors: { pivot: [0, 0, 0], base: [0, -h, 0] } };
};
/* rail: I-profile along x, running surface at y = 0; optional end buffers (stops: true) */
B.rail = o => {
  const L = pos(o.L ?? 2), s = pos(o.s ?? 0.03), g = new THREE.Group();
  const sh = new THREE.Shape(); [[-1.2, -2.6], [1.2, -2.6], [1.2, -2.2], [0.3, -1.9], [0.3, -0.7], [0.9, -0.5], [0.9, 0], [-0.9, 0], [-0.9, -0.5], [-0.3, -0.7], [-0.3, -1.9], [-1.2, -2.2]].forEach(([x, y], i) => i ? sh.lineTo(x * s, y * s) : sh.moveTo(x * s, y * s));
  const geo = new THREE.ExtrudeGeometry(sh, { depth: L, bevelEnabled: false }); geo.translate(0, 0, -L / 2); const m = add(g, geo, steel(P.steel)); m.rotation.y = Math.PI / 2; edges(m, 0.2, 30);
  if (o.stops) for (const e of [1, -1]) edges(add(g, new THREE.BoxGeometry(s * 1.4, s * 3, s * 3), clay(P.weight), e * (L / 2 - s * 0.7), s * 1.5, 0), 0.25);
  return { g, anchors: { start: [-L / 2, 0, 0], end: [L / 2, 0, 0], top: [0, 0, 0] } };
};
/* track: twin steel rails with ties along a centre curve — 'loop' (loop-the-loop, exit shifted sideways so it
   never crosses itself), 'arc' (quarter bowl), 'halfpipe', or explicit options.points [[x,y,z]…] */
B.track = o => {
  const r = pos(o.r ?? 0.5), gauge = pos(o.gauge ?? r * 0.16), kind = o.kind ?? 'loop', pts = [];
  if (o.points) o.points.forEach(p => pts.push(new THREE.Vector3(...p)));
  else if (kind === 'loop') { const lat = gauge * 3; for (let i = 0; i <= 8; i++) pts.push(new THREE.Vector3(-2 * r + (2 * r * i) / 8, 0, 0)); for (let i = 1; i < 48; i++) { const t = -Math.PI / 2 + (i * TAU) / 48; pts.push(new THREE.Vector3(r * Math.cos(t), r + r * Math.sin(t), (lat * i) / 48)); } for (let i = 0; i <= 8; i++) pts.push(new THREE.Vector3((2 * r * i) / 8, 0, lat)); }
  else { const t1 = kind === 'arc' ? 1.5 * Math.PI : 2 * Math.PI; for (let i = 0; i <= 40; i++) { const t = Math.PI + ((t1 - Math.PI) * i) / 40; pts.push(new THREE.Vector3(r * Math.cos(t), r + r * Math.sin(t), 0)); } if (kind === 'arc') for (let i = 1; i <= 6; i++) pts.push(new THREE.Vector3((r * i) / 6, 0, 0)); }
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal'), g = new THREE.Group(), st = steel(P.steel), rr = gauge * 0.17;
  for (const s of [1, -1]) { const off = pts.map(p => p.clone().add(new THREE.Vector3(0, 0, (s * gauge) / 2))); add(g, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(off, false, 'centripetal'), Math.max(64, pts.length * 4), rr, 8, false), st); }
  const ties = Math.round(curve.getLength() / (gauge * 0.9)), tm = clay(darken(P.static, 0.25));
  for (let i = 0; i <= ties; i++) { const p = curve.getPointAt(i / ties), t = curve.getTangentAt(i / ties); const m = add(g, new THREE.BoxGeometry(gauge * 0.22, gauge * 1.4, rr * 1.4), tm, p.x + t.y * rr * 1.6, p.y - t.x * rr * 1.6, p.z); m.rotation.z = Math.atan2(t.y, t.x); m.rotation.x = Math.PI / 2; m.rotation.order = 'ZXY'; }
  return { g, anchors: { start: pts[0].toArray(), end: pts[pts.length - 1].toArray(), bottom: [0, 0, 0] } };
};
/* coil spring along +Y from 0 to L with closed end turns; setLength(L) rewinds it (same coil count) */
B.spring = o => {
  const R = pos(o.r ?? 0.08), coils = Math.max(2, o.coils ?? 9), wire = pos(o.wire ?? R * 0.14), g = new THREE.Group(), mat = steel(o.color ?? lighten(P.steel, 0.1));
  const m = add(g, new THREE.BufferGeometry(), mat);
  const wind = L => { const e = 0.6 / coils, c = new THREE.Curve(); c.getPoint = (s, out = new THREE.Vector3()) => { const y = wire + Math.min(Math.max((s - e) / (1 - 2 * e), 0), 1) * Math.max(L - 2 * wire, 0); return out.set(R * Math.cos(TAU * coils * s), y, R * Math.sin(TAU * coils * s)); }; m.geometry.dispose(); m.geometry = new THREE.TubeGeometry(c, Math.round(coils * 28), wire, 8, false); };
  wind(pos(o.L ?? 0.8));
  return { g, anchors: { bottom: [0, 0, 0], top: [0, pos(o.L ?? 0.8), 0] }, animate: { setLength: L => wind(pos(L)) } };
};
/* rope / string segment between two local points; setEnds(a, b) moves it */
B.rope = o => {
  const r = pos(o.r ?? 0.012), g = new THREE.Group(), m = add(g, new THREE.CylinderGeometry(r, r, 1, 10), clay(o.color ?? 0xCDBB98, { roughness: 0.95 })), up = new THREE.Vector3(0, 1, 0);
  const setEnds = (a, b) => { const A = new THREE.Vector3(...a), d = new THREE.Vector3(...b).sub(A), L = Math.max(d.length(), 1e-4); m.scale.set(1, L, 1); m.position.copy(A).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(up, d.normalize()); };
  const a = o.from ?? [0, 0, 0], b = o.to ?? [0, -1, 0]; setEnds(a, b);
  return { g, anchors: { from: [...a], to: [...b] }, animate: { setEnds } };
};

B.reference_frame = o => {
  const g = new THREE.Group(), t = createAxesTriad(o); g.add(t);
  return { g, anchors: { origin: [0, 0, 0], ...t.userData.tips }, triad: t.userData };
};

// ── catalogue ────────────────────────────────────────────────────────────────────────────────────────────────
/* role: body = a rigid-body shape the engines simulate (dresses a part of that shape); assembly = a body with
   mechanism detail (still drawn inside the part's envelope when dressing a part); fixture = fixed support, never a
   body; illustration = diagram only; reference = coordinate axes. axis = rotor axis in the default orientation. */
export const PROP_DEFS = [
  ['point_mass', 'Point mass', 'bodies', 'Small two-tone bead for a particle or point mass.', 'body', null, ['point']],
  ['sphere', 'Solid sphere', 'bodies', 'Solid ball with spin sectors.', 'body', 'y', ['sphere']],
  ['shell', 'Spherical shell', 'bodies', 'Thin hollow sphere, cut away to show it is hollow.', 'body', 'y', ['shell']],
  ['rod', 'Thin rod', 'bodies', 'Slender steel rod along its axis.', 'body', 'y', ['rod']],
  ['disk', 'Disk', 'bodies', 'Thin uniform disk with spin sectors and a centre mark.', 'body', 'y', ['disk']],
  ['ring', 'Ring / hoop', 'bodies', 'Thin hoop; all mass at the radius.', 'body', 'y', ['ring']],
  ['cylinder', 'Solid cylinder', 'bodies', 'Solid cylinder with spin sectors.', 'body', 'y', ['cylinder']],
  ['tube', 'Thin-walled tube', 'bodies', 'Hollow cylinder; the open ends show the wall.', 'body', 'y', ['tube']],
  ['box', 'Box', 'bodies', 'Rectangular solid with crisp edges (exact physics size).', 'body', null, ['box']],
  ['cone', 'Solid cone', 'bodies', 'Solid cone: base centred at the origin, apex up the axis.', 'body', 'y', ['cone']],
  ['block', 'Block', 'bodies', 'Sliding block with softened edges.', 'body', null, ['box']],
  ['beam', 'Beam / plank', 'bodies', 'Wooden plank along its longest side.', 'body', null, ['box']],
  ['ladder', 'Ladder', 'bodies', 'Two rails and rungs along its longest side.', 'body', null, ['box']],
  ['wheel', 'Wheel', 'rotors', 'Tyre, rim, spokes and hub; one coloured spoke shows the turning.', 'assembly', 'z', ['disk', 'cylinder']],
  ['pulley', 'Pulley', 'rotors', 'Grooved pulley: rope seats at the groove radius; flanges, hub, axle, optional ceiling bracket.', 'assembly', 'z', ['disk', 'cylinder']],
  ['spool', 'Spool / yo-yo', 'rotors', 'Flanges, core and wound thread; thread leaves at the wound radius.', 'assembly', 'z', ['disk', 'cylinder']],
  ['gyroscope', 'Gyroscope', 'rotors', 'Flywheel rotor on an axle in a gimbal ring.', 'assembly', 'y', ['disk', 'cylinder']],
  ['turntable', 'Turntable', 'rotors', 'Rotating platform with a reference stripe, spindle and pedestal.', 'assembly', 'y', ['disk', 'cylinder']],
  ['top', 'Spinning top', 'rotors', 'Top with its tip at the pivot.', 'assembly', 'y', ['cone']],
  ['bead_hoop', 'Bead on a rotating hoop', 'rotors', 'Vertical hoop turning about a spindle, with a bead on it.', 'assembly', 'y', []],
  ['cart', 'Cart', 'motion', 'Wheeled cart; wheels roll on the base of its size.', 'assembly', null, ['box']],
  ['train', 'Train car', 'motion', 'Rail car with window band and bogies (frames, relativity, momentum).', 'illustration', null, []],
  ['elevator', 'Elevator car', 'motion', 'Cage hung on a cable (accelerating frames, apparent weight).', 'illustration', null, []],
  ['projectile', 'Projectile + launcher', 'motion', 'Ball at the launch point with a cannon at the launch angle.', 'body', null, ['sphere']],
  ['rocket', 'Rocket', 'motion', 'Rocket body, nozzle and fins (variable mass, thrust).', 'illustration', 'y', []],
  ['pendulum', 'Pendulum', 'mechanisms', 'Pivot pin, string or rod and bob; ceiling block above the pin.', 'assembly', null, []],
  ['spring', 'Spring', 'mechanisms', 'Coil spring along +y with closed ends; length can change.', 'illustration', 'y', []],
  ['rope', 'Rope / string', 'mechanisms', 'Rope segment between two points.', 'illustration', null, []],
  ['hinge', 'Hinge', 'supports', 'Knuckled barrel on the axis with a fixed leaf.', 'fixture', 'y', []],
  ['pivot_stand', 'Pivot stand', 'supports', 'Pedestal and socket; origin at the pivot point.', 'fixture', null, []],
  ['support', 'Support', 'supports', 'Hatched ceiling, floor or wall slab; origin on its working face.', 'fixture', null, []],
  ['wedge', 'Wedge', 'supports', 'Movable right-triangle wedge (slope from base/height or angle).', 'body', null, []],
  ['ramp', 'Ramp', 'supports', 'Fixed incline with a running strip and hatch.', 'fixture', null, []],
  ['rail', 'Rail', 'supports', 'I-profile rail along x; running surface at y = 0.', 'fixture', null, []],
  ['track', 'Track', 'supports', 'Twin-rail track: loop-the-loop, quarter bowl, half-pipe or custom path.', 'fixture', null, []],
  ['planet', 'Planet / moon / star', 'astro', 'Banded planet with axis and equator; moon (lit half) or star.', 'body', 'y', ['sphere']],
  ['orbit', 'Orbit', 'astro', 'Ellipse with the attracting body at a focus; diagram only.', 'illustration', null, []],
  ['reference_frame', 'Reference frame', 'reference', 'x y z axis triad (problem axes or body axes).', 'reference', null, []],
].map(([id, title, category, description, role, axis, shapes]) => ({ id, title, category, description, role, axis, shapes }));
const DEF = Object.fromEntries(PROP_DEFS.map(d => [d.id, d]));

/* createProp(id, options): options.axis 'y'|'z' re-orients rotor props; options.envelope draws only inside the
   physics shape (dressing a rigid part). Unknown ids throw. */
export function createProp(id, options = {}) {
  const def = DEF[id]; if (!def || !B[id]) throw new Error('unknown prop: ' + id);
  const o = { ...options }; if (def.axis && !o.axis) o.axis = def.axis;
  const built = B[id](o), root = new THREE.Group(), inner = built.g; root.add(inner);
  if (def.axis && o.axis === 'z') inner.rotation.x = Math.PI / 2; // built about +Y; +Y → +Z
  if (built.fixed) root.add(built.fixed);
  inner.updateMatrix(); const anchors = {};
  for (const [k, v] of Object.entries(built.anchors || {})) anchors[k] = /_dir$|_normal$/.test(k) ? new THREE.Vector3(...v).transformDirection(inner.matrix).toArray() : new THREE.Vector3(...v).applyMatrix4(inner.matrix).toArray();
  Object.assign(anchors, built.fixedAnchors || {});
  root.updateMatrixWorld(true); const box = new THREE.Box3().setFromObject(root, true), c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
  root.name = 'prop:' + id;
  root.userData = { prop: id, physics: false, role: def.role, axis: def.axis ? o.axis : null, envelope: !!o.envelope, bounds: { center: c.toArray(), size: s.toArray(), radius: s.length() / 2 }, anchors, ...(built.animate ? { animate: built.animate } : {}), ...(built.triad ? { triad: built.triad } : {}) };
  return root;
}
