/* Kinema rigid3d view — draws a rigid3d spec in the paper studio (studio.js) and keeps it in step with the
   transport. Physics comes from rigid3d.js; this file only turns its numbers into meshes, arrows and chips.
   Physics z-up maps to three.js y-up: (x, y, z) → (x, z, −y), a proper rotation. */
import * as THREE from 'three';
import { PALETTE, clay, steel, edges, Arrow3D } from './studio.js';
import { simulate, derive, frameAt, check, norm, quatToMat, sub, add, scale, mv, dot } from './rigid3d.js';
import { PROP_DEFS, createProp, createAxesTriad, disposeProp } from './prop_library.js';

const T3 = v => new THREE.Vector3(v[0], v[2], -v[1]);
const COLOR = { blue: PALETTE.body, sand: PALETTE.body2, teal: PALETTE.body3, rose: PALETTE.body4, steel: PALETTE.steel, clay: 0xB9B3A8 };
const OMEGA = PALETTE.omega, LCOL = PALETTE.tension, TAU = PALETTE.applied, WEIGHT = PALETTE.weight, NORMAL = PALETTE.normal, FRICTION = PALETTE.friction;
// the gravity-torque construction (layer gravity_torque): r cyan, F = Mg coral, tau = r x F violet
export const TEACH = { r: 0x5CC8E4, F: 0xF0866C, tau: 0xA387FF };
export const OVERLAY_GROUPS = { omega: ['omega', 'precession'], L: ['L'], torque: ['torque'], gravity_torque: ['gravity_torque'], forces: ['weight', 'contact'], trace: ['trace', 'trace_contact', 'trace_omega'], axes: ['axis', 'vertical', 'principal_axes', 'half_angle'], world_axes: ['world_axes'], body_axes: ['body_axes'] };
const PROP_SHAPES = Object.fromEntries(PROP_DEFS.map(d => [d.id, d.shapes]));
const fmt = v => !Number.isFinite(v) ? '—' : Math.abs(v) >= 1000 ? v.toFixed(0) : Math.abs(v) >= 100 ? v.toFixed(1) : Math.abs(v) >= 10 ? v.toFixed(2) : Math.abs(v) >= 0.01 ? v.toFixed(3) : v === 0 ? '0' : v.toExponential(2);

/* physics rotation (row-major 3×3) → three Matrix4 with the axis remap */
function matrix4(R, p) {
  const M = [[1, 0, 0], [0, 0, 1], [0, -1, 0]];
  const r = [[R[0], R[1], R[2]], [R[3], R[4], R[5]], [R[6], R[7], R[8]]];
  const out = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  // M R Mᵀ
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { let s = 0; for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) s += M[i][a] * r[a][b] * M[j][b]; out[i][j] = s; }
  const t = T3(p);
  return new THREE.Matrix4().set(out[0][0], out[0][1], out[0][2], t.x, out[1][0], out[1][1], out[1][2], t.y, out[2][0], out[2][1], out[2][2], t.z, 0, 0, 0, 1);
}

/* Spin paint shared by the rigid bodies: one smooth colour with two narrow darker stripes half a turn apart around the
   part axis (three y). Alternating wedges read as a pinwheel or a beach ball and broad light wedges flared to white;
   a stripe pair still shows the turning, its rate and sense. Per-triangle colour from the centroid angle. */
const STRIPE_W = 1 / 16;
function stripePaint(g, base, dark = 0.62) {
  g = g.toNonIndexed();
  const pos = g.attributes.position, colors = new Float32Array(pos.count * 3);
  const a = new THREE.Color(base), b = new THREE.Color(base).multiplyScalar(dark);
  for (let i = 0; i < pos.count; i += 3) {
    const x = pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2), z = pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2);
    const u = (Math.atan2(z, x) / Math.PI + 2) % 1, c = Math.hypot(x, z) > 1e-9 && Math.min(u, 1 - u) < STRIPE_W ? b : a;
    for (let k = 0; k < 3; k++) { colors[3 * (i + k)] = c.r; colors[3 * (i + k) + 1] = c.g; colors[3 * (i + k) + 2] = c.b; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}
/* a sphere: three-sphere poles on y, the part-local axis z maps to three y, so the stripes turn about y */
function wedgeSphere(r, base) {
  return new THREE.Mesh(stripePaint(new THREE.SphereGeometry(r, 64, 36), base), clay(0xffffff, { vertexColors: true }));
}
/* a cylinder or disk: stripes run across the caps and down the side, so spin reads at any angle */
function sectoredCylinder(r, h, base, open) {
  return new THREE.Mesh(stripePaint(new THREE.CylinderGeometry(r, r, h, 64, 1, open), base), clay(0xffffff, { vertexColors: true, side: THREE.DoubleSide }));
}
/* a cone (apex on local +y), base cap included */
function sectoredCone(r, L, base) {
  return new THREE.Mesh(stripePaint(new THREE.ConeGeometry(r, L, 64, 1), base), clay(0xffffff, { vertexColors: true }));
}

/* A curled arrow (about 300° of a circle and a head) showing a rotation sense about `axis`: update(center, axis, radius,
   sense) with sense +1 counter-clockwise seen from the axis tip; radius 0 hides it. Overlay, never hidden by a body. */
export function curlArrow(parent, color, thick) {
  const N = 48, SPAN = Math.PI * 1.65, g = new THREE.Group(); g.renderOrder = 30;
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false, side: THREE.DoubleSide });
  const arc = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(Array.from({ length: N + 1 }, (_, k) => new THREE.Vector3(Math.cos(SPAN * k / N), 0, -Math.sin(SPAN * k / N)))), N, 1, 8, false), mat);
  const head = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 18), mat);
  arc.renderOrder = head.renderOrder = 30; g.add(arc, head); g.visible = false; parent.add(g);
  const tip = new THREE.Vector3();
  return {
    g, tip,
    update(center, axis, radius, sense = 1) {
      if (!(radius > 1e-6) || !axis || axis.lengthSq() < 1e-12) { g.visible = false; return; }
      g.visible = true; const t = (thick || radius * 0.05) / radius;
      // the tube is built at unit radius with tube radius 1: rebuild only when the thickness ratio changes
      if (arc.userData.t !== t) { arc.geometry.dispose(); arc.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(Array.from({ length: N + 1 }, (_, k) => new THREE.Vector3(Math.cos(SPAN * k / N), 0, -Math.sin(SPAN * k / N)))), N, t, 8, false); arc.userData.t = t; }
      const end = new THREE.Vector3(Math.cos(SPAN), 0, -Math.sin(SPAN)), tan = new THREE.Vector3(-Math.sin(SPAN), 0, -Math.cos(SPAN));
      const hl = Math.min(0.32, t * 7); head.scale.set(t * 2.8, hl, t * 2.8); head.position.copy(end).addScaledVector(tan, hl / 2);
      head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan);
      g.position.copy(center); g.scale.set(radius, radius, radius * (sense < 0 ? -1 : 1));
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.clone().normalize());
      tip.copy(end).multiplyScalar(radius); tip.z *= sense < 0 ? -1 : 1; tip.applyQuaternion(g.quaternion).add(center);
    },
    dispose() { g.parent && g.parent.remove(g); },
  };
}

/* Glyph sizes for idealised parts, which have no physical size: a point mass is drawn as a bead of 0.1·size radius
   and an ideal rod on such a body as a thin wire, so two masses read as masses joined by a light rod rather than
   end caps on a baton. Visual only: mass and inertia come from the spec. Bodies without point parts keep the
   rod's 0.02·L radius and real spheres and cylinders keep their spec radius. */
export function partGlyphs(body) {
  const pointy = body.parts.some(p => p.shape === 'point'), M = body.parts.reduce((s, p) => s + (p.mass || 0), 0);
  // a nearly massless rod on a heavier body (a string, a light stem) is a thin line, never a bar thicker than its bob
  return { point: body.size * 0.1, rod: pointy ? body.size * 0.012 : null, light: p => body.parts.length > 1 && (p.mass || 0) <= 0.03 * M ? body.size * 0.006 : null };
}

/* e3 is a symmetry axis only when it is principal and the two inertias across it are equal; otherwise it is just
   the body axis the spec chose (a tilted dumbbell about z), and calling it symmetry would teach a false fact. */
/* keep a unit view direction v about 63-70° off a symmetry axis e3 (low <= |v·e3| <= lim) and ~15° above the floor (v.y >= 0.25):
   nearer the axis the face hides the stem, pin and tilt; nearer 90° a top's disk is seen edge-on as a thin rod (measured on
   9.17 at 320 px). Moves v to the nearest direction on the bounding cone that stays above the floor (the highest one when e3
   is nearly vertical and no direction satisfies both). Mutates and returns v. */
export function heroClear(v, e3, lim = 0.45, low = 0.34) {
  const d = Math.abs(v.dot(e3));
  if (d <= lim && d >= low && v.y >= 0.25) return v;
  const a = Math.abs(e3.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0), u = a.sub(e3.clone().multiplyScalar(a.dot(e3))).normalize(), w = e3.clone().cross(u);
  const sg = Math.sign(v.dot(e3)) || 1, ring = d < low ? low : lim, k = Math.sqrt(1 - ring * ring);
  let best = null, bestScore = -Infinity, high = null;
  for (let i = 0; i < 180; i++) {
    const t = (i / 180) * Math.PI * 2, c = e3.clone().multiplyScalar(sg * ring).addScaledVector(u, k * Math.cos(t)).addScaledVector(w, k * Math.sin(t));
    if (!high || c.y > high.y) high = c;
    if (c.y >= 0.25 && c.dot(v) > bestScore) { bestScore = c.dot(v); best = c; }
  }
  return v.copy(best || high).normalize();
}
export function e3IsSymmetry(body) {
  const Ie = mv(body.Icm, body.sym), along = dot(Ie, body.sym), vals = body.principal.values, big = Math.max(...vals, 1e-12);
  if (norm(sub(Ie, scale(body.sym, along))) > 1e-6 * big) return false;
  const k = vals.reduce((b, v, i) => Math.abs(v - along) < Math.abs(vals[b] - along) ? i : b, 0), [p, q] = vals.filter((_, i) => i !== k);
  return Math.abs(p - q) <= 1e-3 * big;
}

function partMesh(p, glyph = { point: 0.02, rod: null }) {
  const col = COLOR[p.color] ?? PALETTE.body;
  const group = new THREE.Group();
  let mesh;
  const r = p.radius || 0, L = p.length || 0;
  // part.prop (drawing only): the library prop drawn inside this part's own size, solid where the part is solid; mass,
  // inertia and contact still come from the shape. A thin disk is drawn 0.24 r thick so a wheel or pulley reads.
  if (p.prop && PROP_SHAPES[p.prop]?.includes(p.shape)) {
    const env = p.shape === 'box' ? { size: [p.size[0], p.size[2], p.size[1]] } : p.shape === 'sphere' ? { r } : { r, h: p.shape === 'disk' ? (p.prop === 'turntable' ? 0.08 : 0.24) * r : L };
    mesh = createProp(p.prop, { ...env, axis: 'y', envelope: true, color: col });
  } else switch (p.shape) {
    case 'sphere': mesh = wedgeSphere(r, col); break;
    case 'shell': mesh = wedgeSphere(r, col); break;
    case 'cylinder': case 'tube': case 'disk': {
      const h = p.shape === 'disk' ? Math.max(0.06 * r, 1e-4) : L;
      mesh = sectoredCylinder(r, h, col, p.shape === 'tube');
      edges(mesh, 0.3, 30);
      break;
    }
    case 'ring': {
      mesh = new THREE.Mesh(new THREE.TorusGeometry(r, Math.max(0.05 * r, 1e-4), 16, 96), clay(col)); mesh.rotation.x = Math.PI / 2;
      const bead = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.09 * r, 1e-4), 16, 12), clay(PALETTE.ink2)); bead.position.x = r; mesh.add(bead);
      const wrap = new THREE.Group(); wrap.add(mesh); mesh = wrap; break;
    }
    case 'rod': {
      const thin = glyph.light?.(p), rad = Math.max(thin ?? glyph.rod ?? L * 0.02, 1e-4);
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, L, 20), thin && /string|thread|cord|rope/i.test(p.id) ? clay(PALETTE.ink2) : steel(col)); break;
    }
    case 'box': {
      const [a, b, c] = p.size; mesh = new THREE.Mesh(new THREE.BoxGeometry(a, c, b), clay(col)); edges(mesh, 0.25); break;
    }
    case 'cone': {
      // painted stripes (nothing loose): the spin about e3 reads at any angle and nothing pokes out of the surface
      mesh = sectoredCone(r, L, col); mesh.position.y = L / 2; edges(mesh, 0.18, 30);
      const wrap = new THREE.Group(); wrap.add(mesh); mesh = wrap; break;
    }
    default: mesh = new THREE.Mesh(new THREE.SphereGeometry(Math.max(glyph.point, 1e-4), 24, 16), clay(col));
  }
  mesh.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  group.add(mesh);
  // part-local z (the part axis) is three's y inside `mesh`; orient the group: body-frame rotation p.R, then remap
  const R = p.R, c = p.center;
  const m = matrix4(R, c);
  group.matrixAutoUpdate = false; group.matrix.copy(m);
  // the mesh geometry is built around three's y = local z; matrix4 remaps local (x,y,z) → three (x, z, -y), so rotate
  // the mesh so its y axis lies along three's (local z → three y) — that is the remap's image of local z: already y.
  return group;
}

function dashed(color, opacity) { return new THREE.LineDashedMaterial({ color, transparent: true, opacity: opacity ?? 0.5, dashSize: 1, gapSize: 0.6, depthTest: false }); }
function segment(scene, mat) { const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]); const l = new THREE.Line(g, mat); l.renderOrder = 26; l.frustumCulled = false; scene.add(l); return l; }
function setSegment(line, a, b, dash) {
  const pos = line.geometry.attributes.position; pos.setXYZ(0, a.x, a.y, a.z); pos.setXYZ(1, b.x, b.y, b.z); pos.needsUpdate = true;
  if (dash) { line.material.dashSize = dash; line.material.gapSize = dash * 0.6; line.computeLineDistances(); }
  line.geometry.computeBoundingSphere();
}
function polyline(scene, points, color, opacity) {
  const arr = new Float32Array(points.length * 3);
  points.forEach((p, i) => { const v = T3(p); arr[3 * i] = v.x; arr[3 * i + 1] = v.y; arr[3 * i + 2] = v.z; });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(arr, 3)); g.setDrawRange(0, 0);
  const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: opacity ?? 0.45, depthTest: false }));
  l.renderOrder = 24; l.frustumCulled = false; scene.add(l); return l;
}

/* Where the vertical through P meets the symmetry axis through CM (direction e3), or null when the lines are
   parallel or skew by more than a hair (1% of the body size). Three.js coordinates, y up. */
export function thetaVertex(P, CM, e3, size) {
  const up = new THREE.Vector3(0, 1, 0), w = P.clone().sub(CM), b = up.dot(e3), den = 1 - b * b;
  if (den < 1e-6) return null;
  const s = (b * w.dot(e3) - w.dot(up)) / den, u = (w.dot(e3) - b * w.dot(up)) / den;
  const A = P.clone().addScaledVector(up, s), B = CM.clone().addScaledVector(e3, u);
  return A.distanceTo(B) <= 0.01 * size ? A.add(B).multiplyScalar(0.5) : null;
}

// Perspective fit in the camera's own axes, including the horizontal field of
// view. Using only vertical FOV made narrow artifacts crop or shrink the model.
export function rigidCameraDistance(box, camera, direction, aspect = camera.aspect, points = null) {
  const center = box.getCenter(new THREE.Vector3()), z = direction.clone().normalize();
  const x = new THREE.Vector3().crossVectors(camera.up, z).normalize(), y = new THREE.Vector3().crossVectors(z, x);
  const tanY = Math.tan(camera.fov * Math.PI / 360) * 0.70, tanX = tanY * Math.max(aspect, 0.1);
  let distance = 0;
  const cloud = points || [];
  if (!points) for (const a of [box.min.x, box.max.x]) for (const b of [box.min.y, box.max.y]) for (const c of [box.min.z, box.max.z]) cloud.push(new THREE.Vector3(a, b, c));
  for (const point of cloud) {
    const dx = point.x - center.x, dy = point.y - center.y, dz = point.z - center.z;
    const depth = dx * z.x + dy * z.y + dz * z.z;
    distance = Math.max(distance, Math.abs(dx * x.x + dy * x.y + dz * x.z) / tanX + depth, Math.abs(dx * y.x + dy * y.y + dz * y.z) / tanY + depth);
  }
  return Math.max(distance, 1e-4);
}

/* Fit inside the stage's free area. Two inputs, in stage CSS px:
   - camera.userData.insets = {top, right, bottom, left}: persistent stage chrome (the transport and hint). Set by the
     app; when absent, measured from the .transport / .stagehint / .overlays elements anchored in the canvas's .stage's
     lower 60 % (an open Layers panel on a short stage can reach far above the middle and still counts), plus room for a
     label chip (the x / y / z ⊙ glyphs hang up to ~16 px below the geometry they name).
   - camera.userData.reserve = {left, top}: the folded key's corner (stage_labels.js); the cheaper of its two strips.
   The view backs off just enough for the free rectangle and slides so the fitted centre lands in its middle. Given the
   fitted points (pts, world) it backs off per axis from their projected extent: a tall pane short only in height keeps
   its width rather than shrinking both ways. Only the
   initial / chosen-view fit uses this; nothing re-fits while the user orbits. Exported for the planar stage too. */
function stageInsets(el, H) {
  const st = el?.closest?.('.stage'); if (!st) return {};
  const r0 = el.getBoundingClientRect(); let bottom = 0;
  for (const e of st.querySelectorAll('.transport, .stagehint, .overlays')) { const r = e.getBoundingClientRect(); if (r.width && r.height && r.bottom - r0.top > H * 0.4 && r.top - r0.top > H * 0.1) bottom = Math.max(bottom, r0.bottom - r.top + 22); }
  return { bottom };
}
function reserveFit(cam, studio, dir, target, dist, pts) {
  const el = studio?.renderer?.domElement, W = el?.clientWidth, H = el?.clientHeight;
  const eye = () => [target.clone().addScaledVector(dir, dist), target.clone()];
  if (!(W > 0 && H > 0)) return eye();
  const ins = cam.userData?.insets || stageInsets(el, H), rs = cam.userData?.reserve || {}, cl = (v, n, k) => Math.min(k || 0.45, Math.max(0, (v || 0) / n));
  // bottom chrome may take up to 80 % of a short stage (open Layers at 380 × 340): the setup shrinks into what is left rather than sit under it
  const T = cl(ins.top, H), B = cl(ins.bottom, H, 0.8), L = cl(ins.left, W), Rt = cl(ins.right, W), kt = cl(rs.top, H), kl = cl(rs.left, W);
  const opts = [[T, L]]; if (kt || kl) { opts[0] = [Math.max(T, kt), L]; opts.push([T, Math.max(L, kl)]); }
  const tn = Math.tan((cam.fov || 26) * Math.PI / 360), aspect = Math.max(cam.aspect || 1, 0.1);
  // the content's half-extent about the target at the plain fit, per axis, in device units (no points: tight both ways)
  let fw = 1, fh = 1;
  if (pts?.length) { const c = cam.clone(); c.aspect = aspect; c.position.copy(target).addScaledVector(dir, dist); c.lookAt(target); c.updateMatrixWorld(); c.updateProjectionMatrix();
    fw = fh = 1e-3; for (const p of pts) { const q = p.clone().project(c); fw = Math.max(fw, Math.abs(q.x)); fh = Math.max(fh, Math.abs(q.y)); } }
  // a short free area (the 380 × 340 pane leaves under ~240 px) spends less of it on the plain fit's spare margin: the content
  // fills up to 92 % of the free rectangle instead of the 70-85 % a roomy stage keeps (the fit points already hold arrows and pads)
  const f0 = H * (1 - Math.max(T, kt) - B) < 240 ? Math.max(fw, fh, 0.92) : Math.max(fw, fh);
  let best = null; for (const [t, l] of opts) { const g = Math.max(fw / Math.max(0.12, 1 - l - Rt), fh / Math.max(0.12, 1 - t - B)) / f0; if (!best || g < best.g) best = { g, t, l }; }
  if (!(best.t || best.l || B || Rt)) return eye();
  dist *= Math.max(1, best.g);   // what fitted the whole frame now fits the free rectangle (scale about its centre)
  const half = dist * tn;
  const right = new THREE.Vector3().crossVectors(cam.up, dir).normalize(), up = new THREE.Vector3().crossVectors(dir, right).normalize();
  const cx = best.l - Rt, cy = B - best.t;   // the free rectangle's centre in normalised device coordinates
  const t = target.clone().addScaledVector(right, -cx * half * aspect).addScaledVector(up, -cy * half);
  return [t.clone().addScaledVector(dir, dist), t];
}

export function buildRigid(studio, spec) {
  const sim = simulate(spec);
  const { body } = sim;
  const size = body.size;
  const scene = studio.scene;
  const root = new THREE.Group(); scene.add(root);
  const bodyGroup = new THREE.Group(); bodyGroup.matrixAutoUpdate = false; root.add(bodyGroup);
  const pickables = [], glyphs = partGlyphs(body), pointParts = body.parts.filter(p => p.shape === 'point');
  for (const p of body.parts) { const m = partMesh(p, glyphs); m.traverse(o => { o.userData = { type: 'body', part: p.id }; }); bodyGroup.add(m); pickables.push(m); }
  // ── magnitudes for display scales ──
  const derived = sim.frames.map(f => derive(sim, f));
  const maxOf = fn => Math.max(1e-12, ...derived.map(fn));
  const sW = maxOf(d => norm(d.w)), sL = maxOf(d => norm(d.L)), sTau = maxOf(d => norm(d.dL)),
    sF = maxOf(d => Math.max(norm(d.weight), norm(d.Fsup))), sV = maxOf(d => norm(d.vcm));
  const r = Math.max(size * 0.009, 1e-5);
  const arrow = (color, k) => new Arrow3D(root, color, r * (k || 1));
  const A = { omega: arrow(OMEGA), L: arrow(LCOL), torque: arrow(TAU), weight: arrow(WEIGHT), normal: arrow(NORMAL), friction: arrow(FRICTION), vcm: arrow(PALETTE.velocity, 0.8) };
  const axisLine = segment(root, dashed(PALETTE.ink, 0.45)), vertLine = segment(root, dashed(PALETTE.ink2, 0.35)), instLine = segment(root, dashed(OMEGA, 0.4));
  const principal = [0, 1, 2].map(i => segment(root, new THREE.LineBasicMaterial({ color: PALETTE.axes[i], transparent: true, opacity: 0.7, depthTest: false })));
  // pivot marker and stand, contact marker
  const pivot = new THREE.Mesh(new THREE.SphereGeometry(size * 0.027, 20, 14), steel(PALETTE.steel)); pivot.castShadow = true; root.add(pivot);
  const m0 = sim.spec.motion;
  // A body that swings below its pivot (a pendulum, a rod about one end) hangs from a short post above the pin: a floor
  // stand would stand in its swing and push the useful object into a corner of the frame. When the swing is planar
  // (gravity's torque keeps one line, the pin axis) that plane is drawn as a faint grid through the pivot.
  const hangs = m0.support === 'pivot' && sim.mode !== 'free' && derived.some(d => d.xcm[2] < d.pw[2] - 0.2 * size);
  const swingNormal = (() => {
    const g = derived.find(d => norm(d.tauG) > 1e-9 * Math.max(1, body.M));
    if (g) return T3(g.tauG).normalize();
    const ax = (spec.references || []).find(r => r.kind === 'axis' && r.frame === 'world' && r.direction);
    return (ax ? T3(ax.direction) : new THREE.Vector3(0, 0, -1)).normalize();
  })();
  const planarSwing = derived.every(d => { const l = norm(d.tauG); return !(l > 1e-6 * Math.max(1, body.M)) || Math.abs(T3(d.tauG).dot(swingNormal)) > 0.995 * l; });
  // gravity's torque about a pivot is drawn only where there is a pivot or contact point to take it about
  const hasPivot = sim.mode !== 'free' && m0.support !== 'none';
  // a body floating with no ground and no support has nothing below it: its shadow on the catcher far beneath the
  // frame read as a second, dark baton at the stage edge
  const floor = studio.floor, floorWas = floor?.visible;
  if (floor && !spec.ground && (m0.support === 'none' || hangs)) floor.visible = false;
  let stand = null;
  if (m0.support === 'pivot' && m0.pivot_world[2] > 0.05 * size && sim.mode !== 'free' && !hangs) {
    const h = m0.pivot_world[2];
    stand = createProp('pivot_stand', { h, base: size * 0.13, post: size * 0.026, cup: size * 0.05 }); stand.position.copy(T3(m0.pivot_world)); root.add(stand);
  }
  // ── coordinate frames (layers world_axes, body_axes), both through the same z-up → y-up map as the body. World x y z:
  // the problem's fixed axes at its chosen origin motion.pivot_world (the pivot, or the start CM of a free body). Body
  // x′ y′ z′: the body-frame axes the parts are given in (not necessarily principal; e3 may differ from z′), at the
  // body's moving reference point (the pivot, or the CM of a free body) and turning with it. Drawn over the body.
  // The body triad is about a third of the world triad's length: from a normal view the world axes project longer than any body axis can, so at a shared pivot their glyphs sit at different radii.
  const frameOrigin = m0.pivot ? 'pivot' : 'start CM';
  const worldAxes = createAxesTriad({ length: size * 1.0, radius: size * 0.011 }), bodyAxes = createAxesTriad({ length: size * 0.36, radius: size * 0.008, style: 'body', names: ['x′', 'y′', 'z′'] });
  worldAxes.position.copy(T3(m0.pivot_world)); bodyAxes.matrixAutoUpdate = false;
  const axisTips = Object.values(worldAxes.userData.tips).map(t => new THREE.Vector3(...t).multiplyScalar(1.15).add(worldAxes.position));   // with glyph room
  for (const t of [worldAxes, bodyAxes]) { t.visible = false; t.traverse(o => { if (o.material) { o.material.depthTest = false; o.material.transparent = true; o.renderOrder = 24; } o.castShadow = false; }); root.add(t); }
  // tops and gyroscopes: the pivot sits outside the parts on a light axle; draw that axle (visual only, massless)
  let axle = null;
  const hasAxle = body.parts.some(p => p.shape === 'rod' && norm(sub(p.center, scale(add(body.cm, sim.ctx.pb), 0.5))) < size * 0.1);
  // a cone held at its own apex (rolling on its side) needs no axle: one would poke out through its base
  const apexPivot = body.parts.some(p => p.shape === 'cone' && norm(sub(add(p.center, mv(p.R, [0, 0, p.length || 0])), sim.ctx.pb)) < 0.02 * size);
  const pivotOutside = !hasAxle && !apexPivot && sim.mode !== 'free' && norm(sub(body.cm, sim.ctx.pb)) > 0.25 * size;
  if (pivotOutside) { axle = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12), steel(0x9AA2AF)); axle.castShadow = true; root.add(axle); }
  // the tilt θ between the vertical and the symmetry axis, drawn where both lines meet
  const ARC_N = 32, arcLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: ARC_N + 1 }, () => new THREE.Vector3())),
    new THREE.LineBasicMaterial({ color: PALETTE.ink, transparent: true, opacity: 0.75, depthTest: false }));
  arcLine.renderOrder = 26; arcLine.frustumCulled = false; root.add(arcLine);
  // Only when the pivot lies on the symmetry axis in every stored frame; an off-axis pivot crosses the axis line
  // only for an instant, and a flashing arc would read as noise.
  const pivotOnAxis = sim.frames.every((f, i) => { const e = derived[i].e3, w = f.pw.map((x, k) => x - derived[i].xcm[k]);
    return Math.hypot(w[1] * e[2] - w[2] * e[1], w[2] * e[0] - w[0] * e[2], w[0] * e[1] - w[1] * e[0]) <= 0.01 * size; });
  // ── teaching references (spec.references): the axis a question is about, an origin, a coordinate, a slice dm and
  // its distance to that axis. They are drawn exactly where the spec puts them and never replace e3: a rod's
  // inertia axis through its end is not its symmetry axis. Distances are measured here, not taken from the spec.
  const REF = PALETTE.highlight, refs = (spec.references || []).map(ref => {
    const o = { ref, parts: [] }, add3 = obj => { obj.renderOrder = 27; obj.frustumCulled = false; root.add(obj); o.parts.push(obj); return obj; };
    if (ref.kind === 'axis') {
      o.line = add3(segment(root, new THREE.LineBasicMaterial({ color: REF, transparent: true, opacity: 0.9, depthTest: false })));
      // a ring around the axis: seen end-on (a pin into the screen) the line is a dot, the ring still reads as ⊙
      o.ring = add3(new THREE.Mesh(new THREE.TorusGeometry(size * 0.06, size * 0.006, 8, 48), new THREE.MeshBasicMaterial({ color: REF, transparent: true, opacity: 0.9, depthTest: false })));
    } else if (ref.kind === 'origin') {
      o.dot = add3(new THREE.Mesh(new THREE.SphereGeometry(size * 0.02, 16, 12), new THREE.MeshBasicMaterial({ color: PALETTE.ink, depthTest: false })));
    } else if (ref.kind === 'coordinate') {
      o.arrow = new Arrow3D(root, PALETTE.ink, r * 0.8);
    } else if (ref.kind === 'slice') {
      const near = body.parts.reduce((b, q) => norm(sub(q.center, ref.point)) < norm(sub(b.center, ref.point)) ? q : b, body.parts[0]);
      const rad = Math.max((near.radius || (near.length || size) * 0.02) * 1.6, size * 0.035), thick = ref.length || size * 0.03;
      o.slab = add3(new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, thick, 32), new THREE.MeshBasicMaterial({ color: REF, transparent: true, opacity: 0.55, depthTest: false })));
    } else if (ref.kind === 'distance') {
      // a drafting dimension: witness ticks at both ends and the measured line offset beside the body
      o.dim = add3(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 6 }, () => new THREE.Vector3())),
        new THREE.LineBasicMaterial({ color: PALETTE.ink, transparent: true, opacity: 0.85, depthTest: false })));
    }
    return o;
  });
  const refAxis = refs.find(o => o.ref.kind === 'axis');
  const STILL_ONLY = new Set(['slice', 'distance', 'coordinate', 'origin']);
  // where the references reach for a body pose (pw, R), so the camera fit keeps axis ends, arrow tips and measured
  // feet on stage; fitted for every step's layers so the view does not jump when the references are toggled
  const refReach = (pw, R) => {
    const pl = b => T3(add(pw, mv(R, sub(b, sim.ctx.pb)))), dr = ref => (ref.frame === 'world' ? T3(ref.direction) : T3(mv(R, ref.direction))).normalize();
    const ax = refAxis && { at: pl(refAxis.ref.point), u: dr(refAxis.ref) }, out = [];
    for (const { ref } of refs) {
      const at = pl(ref.point);
      if (ref.kind === 'axis') { const u = dr(ref), half = (ref.length || size * 1.2) / 2; out.push(at.clone().addScaledVector(u, -half), at.clone().addScaledVector(u, half)); }
      else if (ref.kind === 'coordinate') out.push(at, at.clone().addScaledVector(dr(ref), (ref.length || size * 0.5) * 1.08));
      else if (ref.kind === 'distance' && ax) out.push(at, ax.at.clone().addScaledVector(ax.u, at.clone().sub(ax.at).dot(ax.u)));
      else out.push(at);
    }
    return out;
  };
  const e3Symmetric = e3IsSymmetry(body);
  const Y = new THREE.Vector3(0, 1, 0);
  const contactMark = new THREE.Mesh(new THREE.RingGeometry(size * 0.03, size * 0.055, 32), new THREE.MeshBasicMaterial({ color: NORMAL, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide }));
  contactMark.rotation.x = -Math.PI / 2; contactMark.renderOrder = 27; root.add(contactMark);
  // traces
  const tr = sim.traces;
  const tipLine = polyline(root, tr.tip, PALETTE.ink2, 0.22);
  const hasContact = tr.contact.every(Boolean);
  const contactLine = hasContact ? polyline(root, tr.contact.map(p => [p[0], p[1], p[2] + 1e-4]), NORMAL, 0.6) : null;
  const omegaLine = polyline(root, tr.omega, OMEGA, 0.35);
  // ── bounds and cameras ──
  const fitLayer = k => !spec.show?.length || spec.show.includes(k);   // no show list: the app's default layers include ω, L and τ
  const box = new THREE.Box3(), cameraPoints = [];
  const include = p => { box.expandByPoint(p); cameraPoints.push(p); }, poses = [], bodyPts = [];
  for (let i = 0; i < derived.length; i += Math.max(1, Math.floor(derived.length / 60))) {
    const d = derived[i], pts = [], inc = p => { include(p); pts.push(p); };
    poses.push({ i, pts });
    bodyGroup.matrix.copy(matrix4(d.R, sub(d.pw, mv(d.R, sim.ctx.pb))));
    bodyGroup.updateMatrixWorld(true);
    // Fit actual swept surfaces. The corners of a world-axis box around a circle
    // add empty diagonal space and still make the wheel too small on a phone.
    bodyGroup.traverse(o => { if (!o.isMesh) return; const vertices = o.geometry.attributes.position;
      // Bound memory for multi-sphere bodies; the 30% framing margin covers the
      // small surface-sampling error without shrinking every view to a cube.
      const stride = Math.max(1, Math.ceil(vertices.count / 256));
      for (let k = 0; k < vertices.count; k += stride) { const v = new THREE.Vector3().fromBufferAttribute(vertices, k).applyMatrix4(o.matrixWorld); inc(v); bodyPts.push(v); } });
    if (sim.mode !== 'free') inc(T3(d.pw));
    refReach(d.pw, d.R).forEach(inc);
    // the teaching vectors the first view shows (ω, L, τ = dL/dt from the L tip), at the lengths update() draws them: an ω
    // arrow up a fixed vertical axle reaches well past a flat body and must stay in the Full setup frame too
    const P = T3(d.pw), tip = (from, vec, sc, len) => { const m = norm(vec); return m > sc * 1e-3 ? from.clone().addScaledVector(T3(vec).normalize(), Math.max(size * 0.12, len * m / sc) * 1.06) : null; };
    const wTip = fitLayer('omega') && tip(P, d.w, sW, size * 1.05), Ltip = tip(P, d.L, sL, size * 0.95), tTip = fitLayer('torque') && tip(Ltip || P, d.dL, sTau, size * 0.65);
    [wTip, fitLayer('L') && Ltip, tTip].filter(Boolean).forEach(inc);
    // the shown weight and pivot force too (Mg hangs below a pendulum's bob): the whole-swing view must not crop them after Play
    if (hasPivot) [fitLayer('weight') && tip(T3(d.xcm), d.weight, sF, size * 0.7), fitLayer('contact') && tip(P, d.Fsup, sF, size * 0.7)].filter(Boolean).forEach(inc);
  }
  // a shown e3-tip trace (the conical pendulum's cone rim) is part of the whole motion, so Full setup keeps all of it in view
  if (fitLayer('trace')) for (let i = 0; i < tr.tip.length; i += Math.max(1, Math.floor(tr.tip.length / 120))) include(T3(tr.tip[i]));
  const postH = size * 0.32;
  if (hangs) include(T3(derived[0].pw).add(new THREE.Vector3(0, postH, 0)));
  box.expandByScalar(size * 0.10);
  if (spec.ground || (m0.support !== 'none' && !hangs)) include(new THREE.Vector3(box.getCenter(new THREE.Vector3()).x, 0, box.getCenter(new THREE.Vector3()).z));
  const center = box.getCenter(new THREE.Vector3()), ext = box.getSize(new THREE.Vector3());
  const span = Math.max(ext.x, ext.y, ext.z, size);
  // ── a body on the ground stands on a visible tabletop (the studio floor only catches shadows, so a cone lying on its
  // side otherwise floats in the dark): a thin round slab centred under the pivot that holds everything it sweeps ──
  let table = null;
  if (spec.ground) {
    const c0 = T3(m0.pivot_world || derived[0].pw); c0.y = 0;
    let reach = 0; for (const p of bodyPts) reach = Math.max(reach, Math.hypot(p.x - c0.x, p.z - c0.z));
    const R0 = Math.max(reach, size * 0.32) + size * 0.14, th = size * 0.03;   // just past what the body sweeps: a stage, not a floor
    table = new THREE.Mesh(new THREE.CylinderGeometry(R0, R0, th, 96), clay(PALETTE.paperEdge, { roughness: 0.92 }));
    table.position.set(c0.x, -th / 2 - size * 0.002, c0.z); table.receiveShadow = true; edges(table, 0.22, 30);
    table.userData = { type: 'table' }; root.add(table);
    // a pivot at table height sits in a shallow steel socket (a fixed fitting, drawing only): the tip reads as seated, not
    // balanced on a painted dot
    if (m0.support === 'pivot' && sim.mode !== 'free' && Math.abs(m0.pivot_world[2]) < 0.02 * size) {
      const sr = size * 0.045, sh = size * 0.012, socket = new THREE.Mesh(new THREE.CylinderGeometry(sr * 0.8, sr, sh, 40), steel(0x6F7787, { roughness: 0.6 }));
      const pw = T3(m0.pivot_world); socket.position.set(pw.x, sh / 2 - size * 0.002, pw.z); socket.receiveShadow = true; socket.castShadow = true; edges(socket, 0.25, 30);
      socket.userData = { type: 'table' }; root.add(socket);
    }
  }
  // ── precession Ω about the vertical through the pivot (layer precession) and a cone's half-angle α (layer half_angle) ──
  const PREC = PALETTE.highlight, precArrow = new Arrow3D(root, PREC, r * 1.1), precCurl = curlArrow(root, PREC, r * 1.1);
  const sPrec = maxOf(d => Math.abs(d.phidot) || 0);
  const conePart = body.parts.find(p => p.shape === 'cone' && p.radius > 0 && p.length > 0);
  const alphaCone = conePart ? Math.atan2(conePart.radius, conePart.length) : 0;
  const alphaArc = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: ARC_N + 1 }, () => new THREE.Vector3())),
    new THREE.LineBasicMaterial({ color: PALETTE.ink, transparent: true, opacity: 0.85, depthTest: false }));
  alphaArc.renderOrder = 26; alphaArc.frustumCulled = false; alphaArc.visible = false; root.add(alphaArc);
  const coneAxisLine = segment(root, dashed(PALETTE.ink, 0.5));
  // ── hanger and swing plane for a hanging body: a faint grid in the plane the body swings in (the plane r and F span,
  // so tau = r × F pierces it at the pin), a short post from above and the pin itself along the rotation axis ──
  let mount = null;
  if (hangs) {
    const P0 = T3(derived[0].pw), n = swingNormal.clone();
    const up = new THREE.Vector3(0, 1, 0).addScaledVector(n, -n.y); if (up.lengthSq() < 1e-9) up.set(1, 0, 0); up.normalize();
    const across = new THREE.Vector3().crossVectors(up, n).normalize();
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of cameraPoints) { const q = p.clone().sub(P0); u0 = Math.min(u0, q.dot(across)); u1 = Math.max(u1, q.dot(across)); v0 = Math.min(v0, q.dot(up)); v1 = Math.max(v1, q.dot(up)); }
    const pad = size * 0.3; u0 -= pad; u1 += pad; v0 -= pad; v1 = Math.max(v1, postH) + pad;
    const w = u1 - u0, h = v1 - v0;
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uSize: { value: new THREE.Vector2(w, h) }, uPivot: { value: new THREE.Vector2(-u0, -v0) }, uCell: { value: size * 0.25 },
        uFade: { value: size * 0.35 }, uColor: { value: new THREE.Color(PALETTE.ink2) } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      // a faint panel with a fine grid through the pivot, fading out toward its edges (no hard rectangle in the frame)
      fragmentShader: `varying vec2 vUv; uniform vec2 uSize; uniform vec2 uPivot; uniform float uCell; uniform float uFade; uniform vec3 uColor;
        void main() { vec2 p = (vUv * uSize - uPivot) / uCell; vec2 g = abs(fract(p - 0.5) - 0.5) / fwidth(p);
          float line = 1.0 - min(min(g.x, g.y), 1.0); vec2 e = min(vUv, 1.0 - vUv) * uSize; float fade = smoothstep(0.0, uFade, min(e.x, e.y));
          gl_FragColor = vec4(uColor, (0.04 + 0.07 * line) * fade); }` }));
    wall.matrixAutoUpdate = false;
    wall.matrix.makeBasis(across, up, n).setPosition(P0.clone().addScaledVector(across, (u0 + u1) / 2).addScaledVector(up, (v0 + v1) / 2));
    wall.renderOrder = -1; wall.visible = planarSwing; root.add(wall);
    // the hanger: a graphite post from a ceiling block down to just above the pin, and the steel pin along the axis
    const postW = size * 0.07, post = new THREE.Mesh(new THREE.BoxGeometry(postW, postH - size * 0.05, postW), steel(PALETTE.graphite));
    post.matrixAutoUpdate = false; post.matrix.makeBasis(across, up, n).setPosition(P0.clone().addScaledVector(up, (postH + size * 0.05) / 2)); root.add(post);
    const plate = createProp('support', { kind: 'ceiling', w: size * 0.34, t: size * 0.05, d: size * 0.3 });
    plate.matrixAutoUpdate = false; plate.matrix.makeBasis(across, up, n).setPosition(P0.clone().addScaledVector(up, postH - size * 0.02)); root.add(plate);
    const pin = createProp('hinge', { L: size * 0.2, r: size * 0.03, leaf: false }); // knuckled pin along the rotation axis
    pin.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n); pin.position.copy(P0); root.add(pin);
    mount = { wall, post, plate, pin, normal: n };
    pivot.visible = false;
  }
  // ── gravity torque about the pivot, as a cross product: r (pivot → CM), F = Mg at the CM, tau = r × F from the
  // pivot, the r–F parallelogram (its area is |tau|) and the sense tau turns r. Every vector comes from the physics.
  const sTauG = maxOf(d => norm(d.tauG)), rRef = Math.max(maxOf(d => norm(sub(d.xcm, d.pw))), size * 0.2), gr = r * 1.7;
  const GT = { r: new Arrow3D(root, TEACH.r, gr), F: new Arrow3D(root, TEACH.F, gr), tau: new Arrow3D(root, TEACH.tau, gr * 1.15) };
  const para = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3)).setIndex([0, 1, 2, 0, 2, 3]),
    new THREE.MeshBasicMaterial({ color: TEACH.tau, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }));
  para.frustumCulled = false; para.renderOrder = 25; root.add(para);
  // the turning arrow says which way tau turns r; shown only for a body that starts from rest, where the motion begins
  // that way (a spinning gyroscope's L changes along tau instead: it precesses, it does not fall the way the arc curls)
  const fromRest = norm(derived[0].L) <= 1e-6 * Math.max(1, maxOf(d => norm(d.L)));
  const SENSE_A = 1.45, sense = new THREE.Group();
  {
    const arc = new THREE.Curve(); arc.getPoint = (u, o = new THREE.Vector3()) => o.set(Math.cos(u * SENSE_A), Math.sin(u * SENSE_A), 0);
    const mat = new THREE.MeshBasicMaterial({ color: TEACH.tau, transparent: true, opacity: 0.95, depthTest: false });
    const tube = new THREE.Mesh(new THREE.TubeGeometry(arc, 40, 0.035, 8, false), mat), head = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.24, 16), mat);
    head.position.set(Math.cos(SENSE_A), Math.sin(SENSE_A), 0); head.rotation.z = SENSE_A; tube.renderOrder = head.renderOrder = 30;
    sense.add(tube, head); sense.matrixAutoUpdate = false; sense.visible = false; root.add(sense);
  }
  // A pivoted body that gravity starts turning gets a hero view oblique to all three of r (level part), F and tau at the
  // start (about equal angles), from the side tau points to, so the rotation axis reads as depth instead of collapsing
  // to a dot. Bodies without a starting gravity torque about a pivot keep the usual view.
  const heroDir = (() => {
    const t0 = T3(derived[0].tauG), r0 = T3(sub(derived[0].xcm, derived[0].pw)); r0.y = 0;
    if (!hasPivot || !(norm(derived[0].tauG) > 1e-6 * sTauG) || r0.lengthSq() < 1e-12) return [0.8, 0.65, 1.3];
    const v = r0.normalize().multiplyScalar(0.55).add(new THREE.Vector3(0, 0.6, 0)).addScaledVector(t0.normalize(), 0.7).normalize();
    // A tilted top or disk seen within ~45° of its symmetry axis shows its face and hides the stem, pin and tilt
    // under it: keep the hero view at least ~78° off that axis (still from the tau side, still above the floor).
    if (e3Symmetric) heroClear(v, T3(derived[0].e3).normalize());
    return [v.x, v.y, v.z];
  })();
  const poseFraming = hangs;
  function poseBox(t) {
    const i = index(t), near = poses.reduce((a, b) => Math.abs(b.i - i) < Math.abs(a.i - i) ? b : a), d = derived[near.i], P = T3(d.pw);
    const b = new THREE.Box3(); near.pts.forEach(q => b.expandByPoint(q));
    if (hangs) b.expandByPoint(P.clone().add(new THREE.Vector3(0, postH, 0)));
    if (hasPivot) {
      b.expandByPoint(T3(d.xcm).addScaledVector(T3(d.weight).normalize(), rRef * 0.9));
      const l = norm(d.tauG); if (l > 1e-6 * sTauG) b.expandByPoint(P.clone().addScaledVector(T3(d.tauG).normalize(), Math.max(rRef * 0.25, rRef * 1.1 * l / sTauG)));
    }
    return b.expandByScalar(size * 0.12);
  }
  // close-up: the heaviest part (a pendulum's bob, a top's disk) with a little room around it, tracked through the motion
  const focusPart = body.parts.reduce((a, b) => b.mass > a.mass ? b : a, body.parts[0]);
  // never wider than 0.4 × the full framed box, so a one-part body (a top, a gyroscope) still comes nearer
  const closeR = Math.min(Math.max(2.5 * Math.max(focusPart.radius || 0, (focusPart.length || 0) / 2, ...(focusPart.size || [0]).map(x => x / 2)), 0.15 * size),
    0.4 * Math.max(...box.getSize(new THREE.Vector3()).toArray()));
  const cam = studio.camera;
  let fittedBox = box, fittedPoints = cameraPoints;
  let following = false, followedCenter = null, closeFollow = false;
  const fitView = (direction, target = center, fitBox = box) => {
    const dir = new THREE.Vector3(...direction).normalize();
    fittedBox = fitBox; fittedPoints = fitBox === box ? cameraPoints : null;
    // a pose box passes its corners: without points the reserve step assumed the content filled both axes and shrank a
    // narrow hanging pendulum for the key's side strip too (380 × 340: the conical pendulum at under half the stage)
    // A fixed view also keeps the world-axis tips and their glyphs inside the free area (the short-stage fill would cut z off)
    const pts = fittedPoints ? [...fittedPoints] : [fitBox.min.x, fitBox.max.x].flatMap(x => [fitBox.min.y, fitBox.max.y].flatMap(y => [fitBox.min.z, fitBox.max.z].map(z => new THREE.Vector3(x, y, z))));
    if (!following) pts.push(...axisTips);
    return reserveFit(cam, studio, dir, target, rigidCameraDistance(fitBox, cam, dir, cam.aspect, fittedPoints), pts);
  };
  // A swinging body is framed where it is while the view is still (its pose, pin and vectors fill the stage) and the
  // view widens once to the whole swing when motion starts; a camera the student moves is left alone.
  let autoDir = null, preset = null;
  const presetView = () => { if (!autoDir) return fitView(preset); const b = poseBox(state.t); return fitView(autoDir, b.getCenter(new THREE.Vector3()), b); };
  const fixedView = direction => {
    following = false; closeFollow = false; followedCenter = null; preset = direction;
    if (poseFraming && !isMoving()) { autoDir = direction; const b = poseBox(state.t); return fitView(direction, b.getCenter(new THREE.Vector3()), b); }
    autoDir = null; return fitView(direction);
  };
  const cams = {
    hero: () => fixedView(heroDir),
    // View the plane of a multi-mass construction face-on. A generic body close-up
    // would frame one bead and lose the geometry the question asks about.
    geometry: () => {
      const d = derive(sim, frameAt(sim, state.t)), maxMass = Math.max(...body.parts.map(p => p.mass)),
        ps = body.parts.filter(p => p.mass >= maxMass * 0.1).map(p => T3(d.place(p.center)));
      if (ps.length < 3) return fixedView(heroDir);
      for (let i = 1; i < ps.length - 1; i++) {
        const n = ps[i].clone().sub(ps[0]).cross(ps[i + 1].clone().sub(ps[0]));
        if (n.lengthSq() > 1e-12) return fixedView(n.normalize().toArray());
      }
      return fixedView(heroDir);
    },
    side: () => fixedView([0.12, 0.4, 1]),
    top: () => fixedView([0.05, 1, 0.12]),
    follow: () => { const c = T3(derive(sim, frameAt(sim, state.t)).xcm);
      following = true; closeFollow = false; preset = null; autoDir = null; followedCenter = c.clone();
      return fitView([0.8, 0.65, 1.3], c, new THREE.Box3().setFromCenterAndSize(c, new THREE.Vector3(2, 2, 2).multiplyScalar(size))); },
    // the rest of the apparatus may be off screen on purpose; translation only, so an orbit or zoom the student makes is kept
    closeup: () => { const c = T3(derive(sim, frameAt(sim, state.t)).place(focusPart.center));
      following = true; closeFollow = true; preset = null; autoDir = null; followedCenter = c.clone();
      return fitView(heroDir, c, new THREE.Box3().setFromCenterAndSize(c, new THREE.Vector3(2, 2, 2).multiplyScalar(closeR))); },
  };
  function followCenter(CM) {
    if (!following) return;
    if (closeFollow) CM = T3(state.d.place(focusPart.center));
    const delta = CM.clone().sub(followedCenter);
    studio.translateCamera(delta);
    fittedBox.translate(delta);
    followedCenter.copy(CM);
  }
  const stopResize = studio.onResize?.(previousAspect => {
    // A preset view the student has not moved is refitted to the new stage (the pane opening or expanding mid-move must
    // not freeze the camera part-way); otherwise preserve the user's orbit and zoom.
    if (preset) { const [eye, tg] = presetView(); studio.moveCamera(eye, tg, 0); return; }
    const target = studio.controls.target, delta = cam.position.clone().sub(target);
    if (delta.lengthSq() < 1e-12) return;
    const ratio = rigidCameraDistance(fittedBox, cam, delta, cam.aspect, fittedPoints) / rigidCameraDistance(fittedBox, cam, delta, previousAspect, fittedPoints);
    studio.moveCamera(target.clone().add(delta.multiplyScalar(ratio)), target, 0);
  });
  const state = { t: 0, labels: [], centre: T3(derived[0].xcm), d: derived[0] };
  const checks = (spec.checks || []).map(c => check(sim, c));

  /* r = CM − pivot, F = Mg, tau = r × F (d.tauG, the physics' own gravity torque about the pivot). r is drawn to
     scale; F at a fixed length (a force, not a distance); tau scaled to its largest value in the scene, so it shrinks
     to nothing when the force line passes through the pivot and reverses on the other side. A zero torque is said,
     never drawn with an invented direction. Short glyphs ride their arrows; the full names are for the fixed key. */
  function gravityTorque(d, P, CM, on, labels) {
    const vis = hasPivot && on('gravity_torque'), rv = T3(sub(d.xcm, d.pw)), rl = rv.length(), Fv = T3(d.weight), tv = T3(d.tauG), tl = norm(d.tauG);
    const zero = !(tl > 1e-6 * sTauG);
    GT.r.update(P, rl > 1e-9 ? rv.clone().normalize() : Y, vis && rl > 1e-9 ? rl : 0);
    const Fdir = Fv.clone().normalize(), Flen = rRef * 0.9;
    GT.F.update(CM, Fdir, vis ? Flen : 0);
    const tdir = zero ? Y : tv.clone().normalize(), tlen = Math.max(rRef * 0.25, rRef * 1.1 * tl / sTauG);
    GT.tau.update(P, tdir, vis && !zero ? tlen : 0);
    para.visible = vis && !zero; sense.visible = vis && !zero && rl > 1e-9 && fromRest;
    if (para.visible) {
      const pos = para.geometry.attributes.position, Fe = Fdir.clone().multiplyScalar(Flen);
      [P, CM, CM.clone().add(Fe), P.clone().add(Fe)].forEach((v, k) => pos.setXYZ(k, v.x, v.y, v.z));
      pos.needsUpdate = true; para.geometry.computeBoundingSphere();
    }
    if (sense.visible) {
      // an arc around tau starting along r and turning the way tau turns it (right-hand rule)
      const a = rv.clone().normalize(), b = new THREE.Vector3().crossVectors(tdir, a).normalize(), rad = Math.min(rl * 0.45, rRef * 0.4);
      sense.matrix.makeBasis(a.multiplyScalar(rad), b.multiplyScalar(rad), tdir.clone().multiplyScalar(rad)).setPosition(P);
    }
    if (!vis || !on('labels')) return;
    const perp = rl > 1e-9 ? new THREE.Vector3().crossVectors(zero ? swingNormal : tdir, rv).normalize() : Y;
    labels.push({ key: 'gt_r', label: 'r', value: null, color: TEACH.r, plain: true, glyph: 'r', slot: 'glyph', order: 1, dir: perp.lengthSq() ? perp.clone().negate() : Y,
      legend: 'r  pivot → centre of mass', tip: P.clone().lerp(CM, 0.5).addScaledVector(perp, -rRef * 0.1) });
    labels.push({ key: 'gt_F', label: 'F = Mg', value: null, color: TEACH.F, plain: true, glyph: 'F', slot: 'glyph', order: 2, dir: Fdir.clone(),
      legend: 'F = Mg  weight, at the centre of mass', tip: GT.F.tip.clone() });
    // face-on (looking along tau) the arrow is a dot or a cross: say which
    const look = cam.position.clone().sub(P).normalize(), c = zero ? 0 : look.dot(tdir);
    labels.push({ key: 'gt_tau', label: zero ? 'τ = 0' : Math.abs(c) > 0.85 ? (c > 0 ? 'τ ⊙ toward you' : 'τ ⊗ away from you') : 'τ = r × F', value: null, color: TEACH.tau, plain: true,
      glyph: zero ? 'τ = 0' : Math.abs(c) > 0.85 ? (c > 0 ? 'τ ⊙ toward you' : 'τ ⊗ away from you') : 'τ', slot: 'glyph', order: 3, dir: zero ? Y.clone() : tdir.clone(),
      legend: 'τ = r × F  gravity torque about the pivot', tip: zero ? P.clone() : GT.tau.tip.clone() });
  }
  // θ's pin: just past the vertical end of its arc on the side away from the tilt, or (when the pivot force's glyph sits
  // there in this view) the same distance below the arc's vertex; whichever is farther on screen from that glyph
  function thetaPin(X, up, v, rArc) {
    const a = X.clone().addScaledVector(up, rArc * 0.86).addScaledVector(v, -rArc * 1.05);
    if (!A.normal.g.visible) return a;
    const b = X.clone().addScaledVector(up, -rArc * 0.45).addScaledVector(v, -rArc * 1.05), f = A.normal.tip.clone().project(cam);
    const dist = p => { const q = p.clone().project(cam); return Math.hypot((q.x - f.x) * (cam.aspect || 1), q.y - f.y); };
    const da = dist(a), db = dist(b);   // switch sides only on a clear gain, so the chip does not flicker while it plays
    thetaLow = thetaLow ? !(da > 1.4 * db) : db > 1.4 * da; return thetaLow ? b : a;
  }
  let thetaLow = false;
  let lastT = null, movedAt = -1, updates = 0;
  const isMoving = () => lastT !== null && updates - movedAt <= 1;
  const stopAuto = () => { autoDir = null; preset = null; };
  studio.controls?.addEventListener?.('start', stopAuto);
  function index(t) { return sim.frames.length <= 1 ? 0 : Math.round(Math.max(0, Math.min(1, t / sim.duration)) * (sim.frames.length - 1)); }
  function update(t, ov) {
    // in motion when the time changed this update or the one before: still-only geometry (a slice, its distance, an
    // integration coordinate) is hidden while the body moves, so nothing is carried around the stage
    updates++; if (lastT !== null && t !== lastT) movedAt = updates; lastT = t;
    const moving = updates - movedAt <= 1;
    if (autoDir && moving) { const [eye, tg] = fitView(autoDir); autoDir = null; studio.moveCamera(eye, tg, 700); }
    state.t = t;
    const f = frameAt(sim, t);
    const d = derive(sim, f);
    state.d = d;
    const R = quatToMat(f.q);
    bodyGroup.matrix.copy(matrix4(R, sub(f.pw, mv(R, sim.ctx.pb))));
    bodyGroup.matrixWorldNeedsUpdate = true;
    const P = T3(f.pw), CM = T3(d.xcm), on = k => ov.has(k);
    followCenter(CM);
    const labels = [];
    const show = (a, key, from, vec, sc, len, label, value, unit, color, pref) => {
      const m = norm(vec);
      if (!on(key) || !(m > sc * 1e-3)) { a.update(from, new THREE.Vector3(0, 1, 0), 0); return null; }
      const dir = T3(vec).normalize();
      a.update(from, dir, Math.max(size * 0.12, len * m / sc));
      // A fixed screen offset keeps omega distinct from a coincident world-axis glyph, without label chasing.
      if (on('labels')) labels.push({ key, label, value, unit, color, pref, tip: a.tip.clone(), screenOffset: key === 'omega' && on('world_axes') ? [24, 0] : undefined });
      return a.tip.clone();
    };
    show(A.omega, 'omega', P, d.w, sW, size * 1.05, 'ω', norm(d.w), 'rad/s', OMEGA, 70);
    const Ltip = show(A.L, 'L', P, d.L, sL, size * 0.95, 'L', norm(d.L), 'kg·m²/s', LCOL, 20);
    show(A.torque, 'torque', Ltip || P, d.dL, sTau, size * 0.65, 'τ = dL/dt', norm(d.dL), 'N·m', TAU, -30);
    // the construction draws its own F = Mg at the CM; a second weight arrow on the same line would double it
    if (on('gravity_torque')) A.weight.update(CM, Y, 0); else show(A.weight, 'weight', CM, d.weight, sF, size * 0.7, 'Mg', norm(d.weight), 'N', WEIGHT, 110);
    gravityTorque(d, P, CM, on, labels);
    const sup = sim.ctx.support, at = sup === 'ground' && d.contact ? T3(d.contact) : P;
    const Fn = [0, 0, d.Fsup[2]], Ff = [d.Fsup[0], d.Fsup[1], 0];
    if (sup !== 'none' && !d.unresolvedSupports && (sup !== 'ground' || d.contact)) {
      if (sup === 'ground') {
        show(A.normal, 'contact', at, Fn, sF, size * 0.7, 'N', norm(Fn), 'N', NORMAL, -110);
        show(A.friction, 'contact', at, Ff, sF, size * 0.7, 'f', norm(Ff), 'N', FRICTION, 160);
      } else {
        show(A.normal, 'contact', P, d.Fsup, sF, size * 0.7, 'F_pivot', norm(d.Fsup), 'N', NORMAL, -110);
        A.friction.update(P, new THREE.Vector3(0, 1, 0), 0);
      }
    } else { A.normal.update(P, new THREE.Vector3(0, 1, 0), 0); A.friction.update(P, new THREE.Vector3(0, 1, 0), 0); }
    show(A.vcm, 'cm_velocity', CM, d.vcm, sV, size * 0.9, 'v_CM', norm(d.vcm), 'm/s', PALETTE.velocity, 140);
    // lines
    const e3 = T3(d.e3);
    axisLine.visible = on('axis');
    if (axisLine.visible) setSegment(axisLine, CM.clone().addScaledVector(e3, -size * 1.1), CM.clone().addScaledVector(e3, size * 0.8), size * 0.06);
    vertLine.visible = on('vertical');
    if (vertLine.visible) setSegment(vertLine, new THREE.Vector3(P.x, 0, P.z), new THREE.Vector3(P.x, Math.max(P.y, 0) + size * 1.3, P.z), size * 0.06);
    const wn = norm(d.w);
    instLine.visible = on('omega') && wn > 1e-9 && sim.mode !== 'free';
    if (instLine.visible) { const u = T3(d.w).normalize(); setSegment(instLine, P.clone().addScaledVector(u, -size * 0.9), P.clone().addScaledVector(u, size * 1.3), size * 0.05);
      // rolling without slipping on the table: the instantaneous axis is the line of contact, so name it once
      if (spec.ground && Math.abs(u.y) < 0.03 && Math.abs(P.y) < size * 0.02 && on('labels')) labels.push({ key: 'contact_line', label: 'contact line (ω axis)', value: null, color: OMEGA, plain: true, pref: 0,
        tip: P.clone().addScaledVector(u, -size * 0.9), pin: P.clone().addScaledVector(u, -size * 0.98).add(new THREE.Vector3(0, size * 0.06, 0)) }); }
    // precession: Ω along the vertical through the pivot, with its sense as a curl around that vertical
    const Om = d.phidot || 0;
    if (on('precession') && sim.mode !== 'free' && Math.abs(Om) > sPrec * 1e-3) {
      const base = new THREE.Vector3(P.x, Math.max(P.y, 0), P.z), up = new THREE.Vector3(0, Math.sign(Om), 0), len = Math.max(size * 0.3, size * 0.9 * Math.abs(Om) / sPrec);
      precArrow.update(base, up, len);
      precCurl.update(new THREE.Vector3(P.x, Math.max(P.y, 0) + len * 0.72, P.z), new THREE.Vector3(0, 1, 0), size * 0.16, Math.sign(Om));
      if (on('labels')) labels.push({ key: 'precession', label: 'Ω', legend: 'Ω  precession about the vertical', value: Math.abs(Om), unit: 'rad/s', color: PREC, pref: 100, tip: precArrow.tip.clone() });
    } else { precArrow.update(P, Y, 0); precCurl.update(P, Y, 0); }
    // a cone's half-angle α between its axis and its upper generator (the same angle as to the contact line below)
    alphaArc.visible = coneAxisLine.visible = false;
    if (conePart && on('half_angle')) {
      const pl = b => T3(add(f.pw, mv(R, sub(b, sim.ctx.pb)))), Lc = conePart.length;
      const apex = pl(add(conePart.center, mv(conePart.R, [0, 0, Lc]))), a = pl(conePart.center).sub(apex).normalize();
      const n = new THREE.Vector3(0, 1, 0).addScaledVector(a, -a.y);   // the upper generator: the arc and its name stay in view
      if (n.lengthSq() > 1e-8) {
        n.normalize(); const rA = size * 0.45, pos = alphaArc.geometry.attributes.position;
        for (let k = 0; k <= ARC_N; k++) { const q = alphaCone * k / ARC_N, v = a.clone().multiplyScalar(Math.cos(q)).addScaledVector(n, Math.sin(q)).multiplyScalar(rA).add(apex); pos.setXYZ(k, v.x, v.y, v.z); }
        pos.needsUpdate = true; alphaArc.geometry.computeBoundingSphere(); alphaArc.visible = true;
        if (!on('axis')) { coneAxisLine.visible = true; setSegment(coneAxisLine, apex, apex.clone().addScaledVector(a, Lc * 1.25), size * 0.05); }
        const mid = a.clone().multiplyScalar(Math.cos(alphaCone / 2)).addScaledVector(n, Math.sin(alphaCone / 2));
        if (on('labels')) labels.push({ key: 'alpha', label: `α = ${(alphaCone * 180 / Math.PI).toFixed(0)}°`, value: null, color: PALETTE.ink, plain: true, pref: 0,
          tip: apex.clone().addScaledVector(mid, rA), pin: apex.clone().addScaledVector(mid, rA * 1.1).add(new THREE.Vector3(0, size * 0.22, 0)) });
      }
    }
    // θ is the angle between world up and e3. Draw it only where the drawn vertical (through P) and the drawn
    // axis (through the CM along e3) really cross, with both rays inside their drawn segments; an off-axis pivot
    // or skew lines get no arc rather than an arc at a false vertex.
    const X = pivotOnAxis && vertLine.visible && axisLine.visible && sim.mode !== 'free' && d.theta > 2 * Math.PI / 180 ? thetaVertex(P, CM, e3, size) : null;
    const rArc = size * 0.32;
    const along = X ? X.clone().sub(CM).dot(e3) : 0;   // vertex position on the drawn axis segment [-1.1, 0.8]·size
    arcLine.visible = !!X && X.y >= -1e-9 && X.y + rArc <= Math.max(P.y, 0) + size * 1.3 && along >= -size * 1.1 && along + rArc <= size * 0.8;
    if (arcLine.visible) {
      // a hanging body (e3 below the horizontal) is measured from the downward vertical: α = 180° − θ
      const hang = d.theta > Math.PI / 2, ang = hang ? Math.PI - d.theta : d.theta;
      const up = new THREE.Vector3(0, hang ? -1 : 1, 0), v = e3.clone().addScaledVector(up, -e3.dot(up)).normalize(), pos = arcLine.geometry.attributes.position;
      for (let k = 0; k <= ARC_N; k++) { const a = ang * k / ARC_N; pos.setXYZ(k, X.x + rArc * (Math.cos(a) * up.x + Math.sin(a) * v.x), X.y + rArc * (Math.cos(a) * up.y + Math.sin(a) * v.y), X.z + rArc * (Math.cos(a) * up.z + Math.sin(a) * v.z)); }
      pos.needsUpdate = true; arcLine.geometry.computeBoundingSphere();
      const mid = up.clone().multiplyScalar(Math.cos(ang / 2)).addScaledVector(v, Math.sin(ang / 2));
      if (on('labels')) labels.push({ key: 'theta', label: `${hang ? 'α' : 'θ'} = ${(ang * 180 / Math.PI).toFixed(0)}°`, value: null, color: PALETTE.ink, plain: true, pref: 0,
        // pinned just past the vertical end of its arc, on the side away from the tilt: beside the angle it names, clear of the
        // body, the pivot and the arrows that leave the pivot along the tilt
        tip: X.clone().addScaledVector(mid, rArc), pin: thetaPin(X, up, v, rArc) });
    }
    principal.forEach((line, i) => {
      line.visible = on('principal_axes');
      if (!line.visible) return;
      const a = T3(mv(R, body.principal.vectors[i]));
      setSegment(line, CM.clone().addScaledVector(a, -size * 1.1), CM.clone().addScaledVector(a, size * 1.1));
      if (on('labels')) labels.push({ key: 'pa' + i, label: ['I₁', 'I₂', 'I₃'][i] + ' axis', value: null, color: PALETTE.axes[i], plain: true, pref: 0, tip: CM.clone().addScaledVector(a, size * 1.1), pin: CM.clone().addScaledVector(a, size * 1.18) });
    });
    worldAxes.visible = on('world_axes'); bodyAxes.visible = on('body_axes');
    if (bodyAxes.visible) { bodyAxes.matrix.copy(matrix4(R, f.pw)); bodyAxes.matrixWorldNeedsUpdate = true; }
    if (on('labels')) for (const [t, row, legend, base] of [[worldAxes, 'world_axes', `x y z  world axes, fixed in space (origin: ${frameOrigin})`, 20], [bodyAxes, 'body_axes', 'x′ y′ z′  body axes, turn with the body (not necessarily principal)', 23]]) {
      if (!t.visible) continue; if (t.matrixAutoUpdate) t.updateMatrix(); const M = t.matrix, u = t.userData;
      u.names.forEach((k, i) => labels.push({ key: row + '|' + 'xyz'[i], label: k, value: null, color: u.colors[k], plain: true, glyph: k, slot: 'glyph', row, group: 'axes', order: base + i, legend,
        tip: new THREE.Vector3(...u.tips[k]).applyMatrix4(M), dir: new THREE.Vector3(...u.dirs[k]).transformDirection(M) }));
    }
    // references, in world (three) coordinates: body points move with the body; directions are body or world
    const place3 = b => T3(add(f.pw, mv(R, sub(b, sim.ctx.pb))));
    const dir3 = ref => (ref.frame === 'world' ? T3(ref.direction) : T3(mv(R, ref.direction))).normalize();
    let axisAt = null, axisDir = null;
    if (refAxis) { axisAt = place3(refAxis.ref.point); axisDir = dir3(refAxis.ref); }
    // a reference name pinned beside its point on the side away from the body's centre (above or below it), so a pin
    // axis seen end-on and an origin on the same pivot do not both sit on the pivot, nor on the body
    const awayFromBody = (at, axis, upDown) => {
      const a = at.clone().sub(CM); if (axis) a.addScaledVector(axis, -a.dot(axis)); a.y = 0;
      if (a.lengthSq() < 1e-12) a.set(-1, 0, 0);
      return at.clone().addScaledVector(a.normalize(), size * 0.2).add(new THREE.Vector3(0, upDown * size * 0.12, 0));
    };
    for (const o of refs) {
      const vis = on('references') && !(moving && STILL_ONLY.has(o.ref.kind)); o.parts.forEach(m => { m.visible = vis; });
      if (o.arrow) o.arrow.update(P, Y, 0);
      if (!vis) continue;
      const ref = o.ref, at = place3(ref.point), lab = (tip, pin, extra) => { if (on('labels') && ref.label) labels.push({ key: 'ref' + refs.indexOf(o), label: ref.label, value: null, color: REF, plain: true, pref: 0, tip, pin,
        slot: 'pin', legend: ref.label, order: 10 + refs.indexOf(o), ...extra }); };
      if (ref.kind === 'axis') {
        const u = dir3(ref), half = (ref.length || size * 1.2) / 2;
        setSegment(o.line, at.clone().addScaledVector(u, -half), at.clone().addScaledVector(u, half));
        o.ring.position.copy(at); o.ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), u);
        lab(at.clone().addScaledVector(u, half), awayFromBody(at, u, -1));
      } else if (ref.kind === 'origin') {
        o.dot.position.copy(at); lab(at, awayFromBody(at, null, -1));
      } else if (ref.kind === 'coordinate') {
        const u = dir3(ref), len = ref.length || size * 0.5; o.arrow.update(at, u, len);
        lab(at.clone().addScaledVector(u, len), at.clone().addScaledVector(u, len * 1.08).add(new THREE.Vector3(0, size * 0.08, 0)));
      } else if (ref.kind === 'slice') {
        o.slab.position.copy(at); o.slab.quaternion.setFromUnitVectors(Y, dir3(ref));
        lab(at, at.clone().add(new THREE.Vector3(0, size * 0.16, 0)));
      } else if (ref.kind === 'distance') {
        o.dim.visible = !!refAxis;
        if (!refAxis) continue;
        const foot = axisAt.clone().addScaledVector(axisDir, at.clone().sub(axisAt).dot(axisDir)), along = at.clone().sub(foot), dist = along.length();
        // Drawn straight from the axis to the point with a right-angle mark, unless that segment would lie inside a
        // rod or cylinder (a rod's x from its pivot): then it becomes a drafting dimension offset beside the body.
        const u = along.clone().normalize(), alongPart = dist > 1e-9 && body.parts.some(p => p.axis && ['rod', 'cylinder', 'tube'].includes(p.shape)
          && Math.abs(u.dot(T3(mv(R, p.axis)).normalize())) > 0.95 && at.distanceTo(place3(p.center)) <= (p.length || 0) / 2 + size * 0.02);
        let n = new THREE.Vector3().crossVectors(axisDir, along);
        if (n.lengthSq() < 1e-12) n = new THREE.Vector3().crossVectors(axisDir, Y);
        n.normalize(); if (n.dot(cam.up) < 0) n.negate();
        const off = size * 0.12, pos = o.dim.geometry.attributes.position;
        let mid, pin;
        if (alongPart) {
          const a1 = foot.clone().addScaledVector(n, off), b1 = at.clone().addScaledVector(n, off);
          [foot.clone().addScaledVector(n, off * 0.25), foot.clone().addScaledVector(n, off * 1.25), at.clone().addScaledVector(n, off * 0.25), at.clone().addScaledVector(n, off * 1.25), a1, b1]
            .forEach((v, k) => pos.setXYZ(k, v.x, v.y, v.z));
          mid = a1.clone().lerp(b1, 0.5); pin = mid.clone().addScaledVector(n, off * 0.9);
        } else {
          // toward the point along the axis side it lies on, so the mark sits in the corner between axis and segment
          const q = Math.min(size * 0.06, dist * 0.3), ax = axisDir.clone().multiplyScalar(at.clone().sub(axisAt).dot(axisDir) >= 0 ? -1 : 1);
          const c1 = foot.clone().addScaledVector(u, q), c2 = c1.clone().addScaledVector(ax, q), c3 = foot.clone().addScaledVector(ax, q);
          [foot, at, c1, c2, c2, c3].forEach((v, k) => pos.setXYZ(k, v.x, v.y, v.z));
          mid = foot.clone().lerp(at, 0.5); pin = mid.clone().addScaledVector(ax.negate(), off * 0.9);
        }
        pos.needsUpdate = true; o.dim.geometry.computeBoundingSphere();
        // pinned: the measured distance is the point of the step, so it keeps its value on a crowded stage
        // a symbol at the dimension (the measured length stays in the model description, not as a badge)
        if (on('labels') && ref.label) labels.push({ key: 'ref' + refs.indexOf(o), label: ref.label, value: null, plain: true, color: PALETTE.ink, pref: 90, tip: mid, pin,
          slot: 'pin', legend: ref.label + '  distance from the ' + (refAxis.ref.label || 'axis'), order: 20 + refs.indexOf(o), measured: dist });
      }
    }
    // point-mass beads stay uncovered by labels (the callout layer reads this from the shared camera)
    cam.userData.keepClear = pointParts.map(p => ({ p: place3(p.center), r: glyphs.point }));
    // with a reference axis on stage, name the dashed e3 line so it is not read as the axis in question
    if (refAxis && on('references') && axisLine.visible && on('labels')) labels.push({ key: 'e3', label: e3Symmetric ? 'symmetry axis e₃' : 'body axis e₃', value: null, color: PALETTE.ink, plain: true, pref: 0,
      tip: CM.clone().addScaledVector(e3, size * 0.8), pin: CM.clone().addScaledVector(e3, size * 0.9).add(new THREE.Vector3(0, -size * 0.08, 0)) });
    pivot.position.copy(P); pivot.visible = sim.mode !== 'free' && !mount;
    if (axle) {
      // from the pivot along e3 through the body (to the far side of the CM by a little)
      const far = T3(add(f.pw, mv(R, add(sub(body.cm, sim.ctx.pb), scale(body.sym, 0.25 * size)))));
      const dirv = far.clone().sub(P), len = dirv.length();
      axle.scale.set(size * 0.02, len, size * 0.02); axle.position.copy(P).addScaledVector(dirv, 0.5);
      axle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dirv.normalize());
    }
    contactMark.visible = !!d.contact && (on('contact') || on('trace_contact'));
    if (d.contact) contactMark.position.copy(T3(d.contact)).add(new THREE.Vector3(0, 2e-4, 0));
    const k = index(t) + 1;
    tipLine.visible = on('trace'); tipLine.geometry.setDrawRange(0, k);
    if (contactLine) { contactLine.visible = on('trace_contact'); contactLine.geometry.setDrawRange(0, k); }
    omegaLine.visible = on('trace_omega'); omegaLine.geometry.setDrawRange(0, k);
    state.centre = CM; state.labels = labels;
    return state;
  }
  function readout() {
    const d = state.d, rows = [];
    rows.push(['|ω|', fmt(norm(d.w)), 'rad/s']);
    rows.push(['|L|', fmt(norm(d.L)), 'kg·m²/s']);
    if (sim.mode !== 'free' && sim.mode !== 'static') rows.push(['|dL/dt|', fmt(norm(d.dL)), 'N·m']);
    if (Number.isFinite(d.phidot) && sim.mode !== 'fixed_axis' && sim.mode !== 'static') rows.push(['precession φ̇', fmt(d.phidot), 'rad/s']);
    rows.push(['tilt θ', fmt(d.theta * 180 / Math.PI), '°']);
    if (d.vContact) rows.push(['contact speed', fmt(norm(d.vContact)), 'm/s']);
    if (!d.unresolvedSupports && (sim.ctx.support !== 'ground' || d.contact) && sim.mode !== 'fixed_axis' && sim.mode !== 'static') {
      const scaleT = Math.max(norm(d.dL), norm(d.tauG), norm(d.tauExt), 1e-12);
      const rel = norm(d.residual) / scaleT;
      rows.push(['dL/dt − τ', rel < 1e-6 ? '≈ 0' : fmt(norm(d.residual)), rel < 1e-6 ? '' : 'N·m', rel > 0.02 ? 'bad' : 'ok']);
    }
    return rows;
  }
  function inspector() {
    const d = state.d, pr = body.principal.values;
    return { title: spec.body.label || 'body', rows: [['mass', fmt(body.M), 'kg'], ['I₁, I₂, I₃ (CM)', pr.map(fmt).join(', '), 'kg·m²'], ['I about e₃', fmt(body.Isym), 'kg·m²'],
      ['|ω|', fmt(norm(d.w)), 'rad/s'], ['ω along e₃', fmt(d.w[0] * d.e3[0] + d.w[1] * d.e3[1] + d.w[2] * d.e3[2]), 'rad/s'], ['|L| (pivot)', fmt(norm(d.L)), 'kg·m²/s'],
      ['KE', fmt(d.ke), 'J'], ['CM speed', fmt(norm(d.vcm)), 'm/s']] };
  }
  function hit(obj) { let o = obj; while (o) { if (o.userData && o.userData.type) return o.userData; o = o.parent; } return null; }
  function dispose() { studio.controls?.removeEventListener?.('start', stopAuto); disposeProp(worldAxes); disposeProp(bodyAxes); delete cam.userData.keepClear; if (floor) floor.visible = floorWas; stopResize?.(); refs.forEach(o => o.arrow?.dispose?.()); Object.values(GT).forEach(a => a.dispose()); precArrow.dispose(); precCurl.dispose(); scene.remove(root); root.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
  const wFast = Math.max(sW, ...derived.map(d => Math.abs(d.phidot) || 0));
  const naturalSpeed = Math.min(1, 1.2 / Math.max(wFast, 1e-9));
  const defaultView = sim.mode === 'free' && norm(derived[derived.length - 1].xcm.map((x, i) => x - derived[0].xcm[i])) > 3 * size ? 'follow' : 'hero';
  return { sim, update, readout, inspector, hit, dispose, pickables, cams, defaultView, checks, warnings: sim.warnings, naturalSpeed, gravityTorque: hasPivot,
    // the close-up's subject, named on its button ("Disk close-up"): the heaviest part's own name
    closeupName: (n => n.charAt(0).toUpperCase() + n.slice(1))(String(focusPart.label || focusPart.id || 'Body').replace(/_/g, ' ')),
    forceNote: derived.some(d=>d.unresolvedSupports) ? 'Weight shown · contact reactions are not determined by this motion model' : '', frames: { world: true, body: true },
    focus: () => state.centre, focusSize: size, bounds: { center, size: span, floorY: 0 }, duration: sim.duration, state };
}
export { reserveFit };
