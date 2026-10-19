/* Kinema rigid3d — 3D rigid-body physics for Morin ch. 9 (and any rotation that is not planar).
   The model writes the setup (parts + one motion); everything physical is computed here:
   mass, centre of mass, the inertia tensor about the CM and about the pivot, principal axes, the motion
   (exact for fixed-axis rotation and steady precession, RK4-integrated Euler equations for heavy tops and free
   bodies), ω, L, the torque the motion requires (dL/dt), the torque gravity and the support supply, the support
   force, the contact point and its velocity, energy. No rendering here; static/js/rigid3d_view.js draws it.
   World frame: z up, gravity −g ẑ. Angles in the spec are degrees; rates rad/s. */

// ── tiny linear algebra: vectors [x,y,z], matrices row-major arrays of 9 ─────────────────────────────────────────
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = a => Math.hypot(a[0], a[1], a[2]);
export const unit = a => { const n = norm(a); return n > 0 ? scale(a, 1 / n) : [0, 0, 0]; };
const I3 = () => [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const mv = (A, v) => [A[0] * v[0] + A[1] * v[1] + A[2] * v[2], A[3] * v[0] + A[4] * v[1] + A[5] * v[2], A[6] * v[0] + A[7] * v[1] + A[8] * v[2]];
export const mtv = (A, v) => [A[0] * v[0] + A[3] * v[1] + A[6] * v[2], A[1] * v[0] + A[4] * v[1] + A[7] * v[2], A[2] * v[0] + A[5] * v[1] + A[8] * v[2]];
export function mm(A, B) {
  const C = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[3 * i + j] = A[3 * i] * B[j] + A[3 * i + 1] * B[3 + j] + A[3 * i + 2] * B[6 + j];
  return C;
}
export const tr = A => [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];
const madd = (A, B) => A.map((x, i) => x + B[i]);
const mscale = (A, k) => A.map(x => x * k);
function minv(A) {
  const [a, b, c, d, e, f, g, h, i] = A;
  const co = [e * i - f * h, -(d * i - f * g), d * h - e * g, -(b * i - c * h), a * i - c * g, -(a * h - b * g), b * f - c * e, -(a * f - c * d), a * e - b * d];
  const det = a * co[0] + b * co[1] + c * co[2];
  if (!(Math.abs(det) > 0)) throw new Error('singular inertia');
  return [co[0] / det, co[3] / det, co[6] / det, co[1] / det, co[4] / det, co[7] / det, co[2] / det, co[5] / det, co[8] / det];
}
export function axisAngle(axis, ang) {
  const [x, y, z] = unit(axis), c = Math.cos(ang), s = Math.sin(ang), C = 1 - c;
  return [c + x * x * C, x * y * C - z * s, x * z * C + y * s, y * x * C + z * s, c + y * y * C, y * z * C - x * s, z * x * C - y * s, z * y * C + x * s, c + z * z * C];
}
const Rz = a => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
const Rx = a => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
/* the rotation taking unit vector a onto unit vector b (minimal) */
export function alignRotation(a, b) {
  a = unit(a); b = unit(b);
  const c = dot(a, b);
  if (c > 1 - 1e-12) return I3();
  if (c < -1 + 1e-12) { const p = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; return axisAngle(cross(a, p), Math.PI); }
  return axisAngle(cross(a, b), Math.acos(Math.max(-1, Math.min(1, c))));
}
// quaternions [w,x,y,z] (body → world)
const qmul = (a, b) => [a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3], a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1], a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]];
const qnorm = q => { const n = Math.hypot(q[0], q[1], q[2], q[3]); return q.map(x => x / n); };
export function quatToMat(q) {
  const [w, x, y, z] = q;
  return [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y), 2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)];
}
export function matToQuat(m) {
  const t = m[0] + m[4] + m[8];
  let q;
  if (t > 0) { const s = Math.sqrt(t + 1) * 2; q = [0.25 * s, (m[7] - m[5]) / s, (m[2] - m[6]) / s, (m[3] - m[1]) / s]; }
  else if (m[0] > m[4] && m[0] > m[8]) { const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2; q = [(m[7] - m[5]) / s, 0.25 * s, (m[1] + m[3]) / s, (m[2] + m[6]) / s]; }
  else if (m[4] > m[8]) { const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2; q = [(m[2] - m[6]) / s, (m[1] + m[3]) / s, 0.25 * s, (m[5] + m[7]) / s]; }
  else { const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2; q = [(m[3] - m[1]) / s, (m[2] + m[6]) / s, (m[5] + m[7]) / s, 0.25 * s]; }
  return qnorm(q);
}
export function slerp(a, b, u) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  if (d < 0) { b = b.map(x => -x); d = -d; }
  if (d > 0.9995) return qnorm(a.map((x, i) => x + (b[i] - x) * u));
  const th = Math.acos(d), s = Math.sin(th);
  return a.map((x, i) => (Math.sin((1 - u) * th) * x + Math.sin(u * th) * b[i]) / s);
}

// ── symmetric 3×3 eigen-decomposition (Jacobi) ─────────────────────────────────────────────────────────────────
export function eigenSym(A) {
  const a = [[A[0], A[1], A[2]], [A[3], A[4], A[5]], [A[6], A[7], A[8]]];
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 60; sweep++) {
    const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    if (off < 1e-15 * (Math.abs(a[0][0]) + Math.abs(a[1][1]) + Math.abs(a[2][2]) + 1e-300)) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
      for (let k = 0; k < 3; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < 3; k++) { const vkp = v[k][p], vkq = v[k][q]; v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq; }
    }
  }
  const pairs = [0, 1, 2].map(i => ({ value: a[i][i], vector: unit([v[0][i], v[1][i], v[2][i]]) })).sort((x, y) => x.value - y.value);
  return { values: pairs.map(p => p.value), vectors: pairs.map(p => p.vector) };
}

// ── parts and the body ──────────────────────────────────────────────────────────────────────────────────────────
const AXIAL = new Set(['cylinder', 'tube', 'disk', 'ring', 'rod', 'cone']);
/* principal moments of a part about its own CM, in its local frame (local z = the part's axis) */
export function partInertia(p) {
  const m = p.mass, r = p.radius || 0, L = p.length || 0;
  switch (p.shape) {
    case 'sphere': { const i = 0.4 * m * r * r; return [i, i, i]; }
    case 'shell': { const i = (2 / 3) * m * r * r; return [i, i, i]; }
    case 'cylinder': { const perp = m * (3 * r * r + L * L) / 12; return [perp, perp, 0.5 * m * r * r]; }
    case 'tube': { const perp = m * r * r / 2 + m * L * L / 12; return [perp, perp, m * r * r]; }
    case 'disk': return [0.25 * m * r * r, 0.25 * m * r * r, 0.5 * m * r * r];
    case 'ring': return [0.5 * m * r * r, 0.5 * m * r * r, m * r * r];
    case 'rod': { const perp = m * L * L / 12; return [perp, perp, 0]; }
    case 'box': { const [a, b, c] = p.size; return [m * (b * b + c * c) / 12, m * (a * a + c * c) / 12, m * (a * a + b * b) / 12]; }
    case 'cone': { const perp = (3 / 20) * m * r * r + (3 / 80) * m * L * L; return [perp, perp, 0.3 * m * r * r]; }
    case 'point': return [0, 0, 0];
  }
  throw new Error('unknown shape ' + p.shape);
}
/* part-local → body rotation: local z onto the part's axis (boxes keep the body axes unless an axis is given) */
export function partRotation(p) { return p.axis && (AXIAL.has(p.shape) || p.shape === 'box') ? alignRotation([0, 0, 1], p.axis) : I3(); }
/* where the part's mass centre is, in the body frame (a cone's `center` is the centre of its base) */
export function partCM(p) { return p.shape === 'cone' ? add(p.center, scale(unit(p.axis), p.length / 4)) : p.center.slice(); }

export function buildBody(spec) {
  const parts = spec.body.parts.map(p => ({ ...p, R: partRotation(p), cm: partCM(p), Ilocal: partInertia(p) }));
  const M = parts.reduce((s, p) => s + p.mass, 0);
  const cm = scale(parts.reduce((s, p) => add(s, scale(p.cm, p.mass)), [0, 0, 0]), 1 / M);
  let Icm = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of parts) {
    const own = mm(mm(p.R, [p.Ilocal[0], 0, 0, 0, p.Ilocal[1], 0, 0, 0, p.Ilocal[2]]), tr(p.R));
    Icm = madd(Icm, madd(own, shiftTensor(p.mass, sub(p.cm, cm))));
  }
  const sym = unit(spec.body.symmetry_axis);
  const principal = eigenSym(Icm);
  const Isym = dot(sym, mv(Icm, sym));
  const trace = Icm[0] + Icm[4] + Icm[8];
  let size = 0;
  for (const p of parts) size = Math.max(size, norm(sub(p.center, cm)) + Math.max(p.radius || 0, (p.length || 0) / (p.shape === 'cone' ? 1 : 2), ...(p.size || [0]).map(x => x / 2)));
  return { parts, M, cm, Icm, sym, principal, Isym, Iperp: (trace - Isym) / 2, size: Math.max(size, 1e-3) };
}
/* M (d² 1 − d dᵀ): the parallel-axis shift of an inertia tensor */
export function shiftTensor(m, d) {
  const d2 = dot(d, d);
  return [m * (d2 - d[0] * d[0]), -m * d[0] * d[1], -m * d[0] * d[2], -m * d[1] * d[0], m * (d2 - d[1] * d[1]), -m * d[1] * d[2], -m * d[2] * d[0], -m * d[2] * d[1], m * (d2 - d[2] * d[2])];
}

// ── the lowest point of the body (the floor contact) ────────────────────────────────────────────────────────────
function circleLowest(c, n, r) {
  const down = [0, 0, -1], t = sub(down, scale(n, dot(down, n))), tn = norm(t);
  return tn < 1e-9 ? c.slice() : add(c, scale(t, r / tn));
}
export function lowestPoint(body, R, place) { return floorContact(body, R, place).point; }
// Generated dimensions are often rounded to five decimal places. Keep the exact
// geometry, but recognise contacts within 0.01% of body size (not visible gaps).
export const contactTolerance = body => 1e-4 * body.size + 1e-9;
/* the lowest point, and whether the lowest level is touched at more than one place (a cone or cylinder lying on its
   side touches along a line, a flat disk or box face along a face): then one contact force cannot be located */
export function floorContact(body, R, place) {
  const cands = [];
  let flat = false;
  const consider = (q, isFlat) => { cands.push({ q, flat: !!isFlat }); };
  const circle = (c, n, r) => {
    const flat = r > 0 && Math.abs(Math.abs(n[2]) - 1) < 1e-9;
    consider(circleLowest(c, n, r), flat);
    // A face touching the floor can still slide while its centre is stationary.
    if (flat) { const u = unit(cross(n, [1, 0, 0])), v = cross(n, u);
      for (const a of [u, v]) for (const sign of [-1, 1]) consider(add(c, scale(a, sign * r)), true); }
  };
  for (const p of body.parts) {
    const c = place(p.center), n = unit(mv(R, mv(p.R, [0, 0, 1])));
    const r = p.radius || 0, L = p.length || 0;
    switch (p.shape) {
      case 'sphere': case 'shell': consider(sub(c, [0, 0, r])); break;
      case 'disk': case 'ring': circle(c, n, r); break;
      case 'cylinder': case 'tube': circle(add(c, scale(n, L / 2)), n, r); circle(sub(c, scale(n, L / 2)), n, r); break;
      case 'rod': consider(add(c, scale(n, L / 2))); consider(sub(c, scale(n, L / 2))); break;
      case 'cone': consider(add(c, scale(n, L))); circle(c, n, r); break;
      case 'box': { const [a, b, h] = p.size; const RR = mm(R, p.R);
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) consider(add(c, mv(RR, [sx * a / 2, sy * b / 2, sz * h / 2]))); break; }
      default: consider(c);
    }
  }
  let best = cands[0];
  for (const k of cands) if (k.q[2] < best.q[2]) best = k;
  const tol = 1e-6 * body.size + 1e-9;
  const low = cands.filter(k => k.q[2] <= best.q[2] + tol);
  flat = low.some(k => k.flat);
  const spread = low.some(k => norm(sub(k.q, best.q)) > 0.02 * body.size);
  const floor = cands.filter(k => Math.abs(k.q[2]) <= contactTolerance(body));
  const floorAmbiguous = floor.some(k => k.flat || norm(sub(k.q, floor[0].q)) > 0.02 * body.size);
  return { point: best.q, ambiguous: flat || spread, points: low.map(k => k.q),
    floorPoints: floor.map(k => k.q), floorAmbiguous };
}

// ── orientation from the spec's angles ──────────────────────────────────────────────────────────────────────────
const RAD = Math.PI / 180;
/* Euler z-x-z with the symmetry axis as the 3-axis; phi is the azimuth of e3's tilt (from +x toward +y) */
export function eulerMatrix(phiAz, theta, psi, C) { return mm(mm(mm(Rz(phiAz + Math.PI / 2), Rx(theta)), Rz(psi)), C); }

// ── simulation ──────────────────────────────────────────────────────────────────────────────────────────────────
export const FRAME_HZ = 240;

export function simulate(spec) {
  const body = buildBody(spec);
  const m = spec.motion, g = spec.gravity || 0;
  const warnings = [];
  const C = alignRotation(body.sym, [0, 0, 1]);
  const pb = m.pivot ? m.pivot.slice() : body.cm.slice();
  const pw0 = m.pivot_world.slice();
  const d = sub(body.cm, pb);                                   // pivot → CM, body frame
  const IP = madd(body.Icm, shiftTensor(body.M, d));           // about the pivot, body frame
  const theta0 = (m.theta_deg || 0) * RAD, phi0 = (m.phi_deg || 0) * RAD;
  const R0 = eulerMatrix(phi0, theta0, 0, C);
  const Omega = m.precession_rate || 0, spin = m.spin_rate || 0, nut = m.nutation_rate || 0;
  const duration = spec.duration || 0;
  const n = Math.max(1, Math.round(duration * FRAME_HZ));
  const frames = [];
  const mode = m.type;
  const ctx = { body, g, pb, d, IP, C, R0, support: m.support, mode, warnings, spec, pivotGiven: m.pivot ? m.pivot.slice() : null };

  // analytic motions are evaluated exactly at any time (frames are only for traces); rotating vectors must not be
  // interpolated between frames (at 48 rad/s they turn 0.2 rad per frame)
  let analytic = null;
  if (mode === 'static' || duration === 0) {
    analytic = t => ({ t, q: matToQuat(R0), pw: pw0, w: [0, 0, 0], alpha: [0, 0, 0], vpw: [0, 0, 0], apw: [0, 0, 0] });
  } else if (mode === 'steady_precession') {
    analytic = t => {
      const R = eulerMatrix(phi0 + Omega * t, theta0, spin * t, C);
      const e3 = mv(R, body.sym);
      const w = add([0, 0, Omega], scale(e3, spin));
      const alpha = scale(cross([0, 0, Omega], e3), spin);   // d/dt (spin e3) with e3' = Omega z × e3
      return { t, q: matToQuat(R), pw: pw0, w, alpha, vpw: [0, 0, 0], apw: [0, 0, 0] };
    };
  } else if (mode === 'fixed_axis') {
    const axis = unit(m.axis), om = m.omega || 0;
    analytic = t => ({ t, q: matToQuat(mm(axisAngle(axis, om * t), R0)), pw: pw0, w: scale(axis, om), alpha: [0, 0, 0], vpw: [0, 0, 0], apw: [0, 0, 0] });
  }
  if (analytic) {
    const count = duration === 0 ? 0 : n;
    for (let k = 0; k <= count; k++) frames.push(analytic(duration === 0 ? 0 : duration * k / n));
  } else if (mode === 'heavy_top' || mode === 'free') {
    integrate(ctx, frames, n, duration, { R0, phi0, theta0, Omega, spin, nut, pw0 });
  } else throw new Error('unknown motion ' + mode);

  const sim = { spec, body, ctx, frames, duration, warnings, mode, analytic };
  // does the body really touch the floor where it should?
  if (m.support === 'ground' || spec.ground) {
    const f0 = derive(sim, frames[0]);
    const gap = f0.lowest[2];
    if (m.support === 'ground' && Math.abs(gap) > 0.01 * body.size + 1e-4)
      warnings.push(`The body's lowest point is ${(gap * 1000).toFixed(1)} mm ${gap > 0 ? 'above' : 'below'} the floor at t = 0, so it is not resting on it.`);
    if (m.support === 'pivot' && f0.lowest[2] < -0.01 * body.size && spec.ground) warnings.push('The body passes below the floor.');
  }
  if (m.support === 'pivot' && spec.ground && mode !== 'free') {
    // any touching point away from the pivot is a second support (the lowest point may be the pivot itself)
    const R0f = quatToMat(frames[0].q), fc0 = floorContact(body, R0f, b => add(frames[0].pw, mv(R0f, sub(b, ctx.pb))));
    const touching = fc0.floorPoints.some(q => norm(sub(q, pw0)) > 0.02 * body.size);
    if (touching) { ctx.twoSupports = true; warnings.push('The pivot and the floor both support this body. Their individual reaction forces are not solved; the displayed torque is the total torque the prescribed motion requires.'); }
  }
  // a nutating top may dip later even if it starts clear of the floor (review 0.5)
  if (spec.ground && m.support !== 'ground' && mode !== 'free' && frames.length > 2) {
    let worst = Infinity, at = 0;
    for (let k = 0; k < frames.length; k += Math.max(1, Math.floor(frames.length / 400))) {
      const fk = frames[k], Rk = quatToMat(fk.q), fc = floorContact(body, Rk, b => add(fk.pw, mv(Rk, sub(b, ctx.pb))));
      const pivotHere = norm(sub(fc.point, pw0)) < 0.02 * body.size;
      if (!pivotHere && fc.point[2] < worst) { worst = fc.point[2]; at = fk.t; }
    }
    if (worst < -0.01 * body.size) warnings.push(`The body dips ${(-worst * 1000).toFixed(1)} mm below the floor around t = ${at.toFixed(2)} s; the model has no floor there.`);
  }
  // energy bookkeeping for integrated motion
  if (mode === 'heavy_top' || mode === 'free') {
    const e0 = derive(sim, frames[0]).energy, e1 = derive(sim, frames[frames.length - 1]).energy;
    const drift = Math.abs(e1 - e0) / Math.max(Math.abs(e0), 1e-12);
    sim.energyDrift = drift;
    if (drift > 2e-3) warnings.push(`Numerical energy drift ${(drift * 100).toFixed(2)}% over the run.`);
  }
  // a line or face on the floor: the floor's force has no single point, so torque balance cannot be judged
  if (m.support === 'ground' && !ctx.twoSupports) {
    const f0 = frames[0], R0f = quatToMat(f0.q);
    const fc = floorContact(body, R0f, b => add(f0.pw, mv(R0f, sub(b, ctx.pb))));
    if (fc.floorAmbiguous) { ctx.twoSupports = true; warnings.push('The body rests on the floor along a line or a face, so the floor\'s force has no single point: the app shows the torque the motion needs, but does not judge the torque balance or the normal force.'); }
  }
  sim.traces = traces(sim);
  return sim;
}

function integrate(ctx, frames, n, duration, init) {
  const { body, g, d, IP, mode } = ctx;
  const Iuse = mode === 'heavy_top' ? IP : body.Icm;
  // a thin rod has no axial moment: regularize so Euler's equations stay well posed
  const big = Math.max(Iuse[0], Iuse[4], Iuse[8], 1e-12);
  let Ireg = Iuse.slice();
  if (Math.abs(det3(Iuse)) < 1e-9 * big * big * big) { Ireg = madd(Iuse, mscale(I3(), 1e-6 * big)); ctx.warnings.push('The body has a zero moment of inertia about one axis (a thin rod); spin about that axis is not represented.'); }
  const Iinv = minv(Ireg);
  const R0 = init.R0;
  const e30 = mv(R0, body.sym);
  const phiE = init.phi0 + Math.PI / 2;
  const nodes = [Math.cos(phiE), Math.sin(phiE), 0];
  let wWorld = add(add([0, 0, init.Omega], scale(nodes, init.nut)), scale(e30, init.spin));
  let xcm0, vcm0 = [0, 0, 0];
  const place0 = b => add(init.pw0, mv(R0, sub(b, ctx.pb)));
  xcm0 = place0(body.cm);
  const imp = ctx.spec.motion.impulse;
  if (mode === 'free' && imp) {
    const J = imp.J, r = sub(place0(imp.point), xcm0);
    vcm0 = scale(J, 1 / body.M);
    const Iw = mm(mm(R0, Ireg), tr(R0));
    wWorld = add(wWorld, mv(minv(Iw), cross(r, J)));
  }
  let q = matToQuat(R0), wb = mtv(R0, wWorld);
  const wmax = norm(wWorld) + Math.sqrt(body.M * g * Math.max(norm(d), 1e-9) / Math.max(Math.min(Ireg[0], Ireg[4], Ireg[8]), 1e-12));
  const dtFrame = duration / n;
  const sub_ = Math.max(1, Math.ceil(dtFrame / Math.min(1e-3, 0.02 / Math.max(wmax, 1e-6))));
  const h = dtFrame / sub_;
  const accel = (q, wb) => {
    const R = quatToMat(q);
    let tau = [0, 0, 0];
    if (mode === 'heavy_top' && g) tau = cross(d, mtv(R, [0, 0, -body.M * g]));
    const wdot = mv(Iinv, sub(tau, cross(wb, mv(Ireg, wb))));
    return wdot;
  };
  const qdot = (q, wb) => qmul(q, [0, wb[0], wb[1], wb[2]]).map(x => 0.5 * x);
  const record = (t) => {
    const R = quatToMat(q);
    const wdot = accel(q, wb);
    const w = mv(R, wb), alpha = mv(R, wdot);
    // wb/ab (body frame) are what frameAt interpolates: they change slowly even when w itself swings around
    if (mode === 'heavy_top') frames.push({ t, q: q.slice(), pw: init.pw0, w, alpha, wb: wb.slice(), ab: wdot, vpw: [0, 0, 0], apw: [0, 0, 0] });
    else { const xcm = add(add(xcm0, scale(vcm0, t)), [0, 0, -0.5 * g * t * t]);
      frames.push({ t, q: q.slice(), pw: xcm, w, alpha, wb: wb.slice(), ab: wdot, vpw: add(vcm0, [0, 0, -g * t]), apw: [0, 0, -g] }); }
  };
  if (mode === 'free') { ctx.pb = body.cm.slice(); ctx.d = [0, 0, 0]; }
  record(0);
  for (let k = 1; k <= n; k++) {
    for (let s = 0; s < sub_; s++) {
      const k1q = qdot(q, wb), k1w = accel(q, wb);
      const q2 = q.map((x, i) => x + 0.5 * h * k1q[i]), w2 = add(wb, scale(k1w, 0.5 * h));
      const k2q = qdot(q2, w2), k2w = accel(q2, w2);
      const q3 = q.map((x, i) => x + 0.5 * h * k2q[i]), w3 = add(wb, scale(k2w, 0.5 * h));
      const k3q = qdot(q3, w3), k3w = accel(q3, w3);
      const q4 = q.map((x, i) => x + h * k3q[i]), w4 = add(wb, scale(k3w, h));
      const k4q = qdot(q4, w4), k4w = accel(q4, w4);
      q = qnorm(q.map((x, i) => x + h / 6 * (k1q[i] + 2 * k2q[i] + 2 * k3q[i] + k4q[i])));
      wb = add(wb, scale(add(add(k1w, scale(k2w, 2)), add(scale(k3w, 2), k4w)), h / 6));
    }
    record(duration * k / n);
  }
  ctx.Iused = Ireg;
}
function det3(A) { return A[0] * (A[4] * A[8] - A[5] * A[7]) - A[1] * (A[3] * A[8] - A[5] * A[6]) + A[2] * (A[3] * A[7] - A[4] * A[6]); }

/* everything physical at one frame, from the state (R, pivot position, ω, α and the pivot's motion) */
export function derive(sim, f) {
  const { body, ctx } = sim;
  const R = quatToMat(f.q);
  const pb = ctx.pb, M = body.M, g = ctx.g;
  const place = b => add(f.pw, mv(R, sub(b, pb)));
  const xcm = place(body.cm);
  const r = sub(xcm, f.pw);                                    // pivot → CM (world)
  const vcm = add(f.vpw, cross(f.w, r));
  const acm = add(add(f.apw, cross(f.alpha, r)), cross(f.w, cross(f.w, r)));
  const Iw = mm(mm(R, body.Icm), tr(R));
  const Lcm = mv(Iw, f.w);
  const L = add(Lcm, scale(cross(r, vcm), M));                 // about the pivot
  const dLcm = add(mv(Iw, f.alpha), cross(f.w, Lcm));
  const dL = add(dLcm, scale(cross(r, acm), M));               // pivot fixed (or r = 0 when the pivot is the CM)
  const weight = [0, 0, -M * g];
  const tauG = cross(r, weight);
  const Fsup = sub(scale(acm, M), weight);                     // what the support must supply
  const fc = floorContact(body, R, place), lowest = fc.point;
  const unresolvedSupports = !!ctx.twoSupports || ctx.support === 'ground' && fc.floorAmbiguous ||
    ctx.support === 'pivot' && sim.spec.ground && fc.floorPoints.some(q => norm(sub(q, f.pw)) > 0.02 * body.size);
  const e3 = mv(R, body.sym);
  let tauSup = [0, 0, 0], contact = null, vContact = null;
  if (ctx.support === 'ground' || sim.spec.ground) {
    // Test the wheel/face contacts, never certify rolling from a fixed pivot.
    const contacts = ctx.support === 'pivot'
      ? fc.floorPoints.filter(q => norm(sub(q, f.pw)) > 0.02 * body.size) : fc.floorPoints;
    const vAt = q => add(vcm, cross(f.w, sub(q, xcm)));
    for (const q of contacts) { const v = vAt(q); if (!vContact || norm(v) > norm(vContact)) { contact = q; vContact = v; } }
    if (ctx.support === 'ground' && contact) tauSup = cross(sub(contact, f.pw), Fsup);
  }
  const tauExt = add(tauG, tauSup);
  const residual = sub(dL, tauExt);
  // Euler-angle rates from ê3's motion: ė3 = ω × e3
  const e3dot = cross(f.w, e3);
  const rho2 = e3[0] * e3[0] + e3[1] * e3[1];
  const phidot = rho2 > 1e-12 ? (e3[0] * e3dot[1] - e3[1] * e3dot[0]) / rho2 : NaN;
  const theta = Math.acos(Math.max(-1, Math.min(1, e3[2])));
  const psidot = Number.isFinite(phidot) ? dot(f.w, e3) - phidot * Math.cos(theta) : NaN;
  const energy = 0.5 * M * dot(vcm, vcm) + 0.5 * dot(f.w, Lcm) + M * g * xcm[2];
  return { t: f.t, R, place, xcm, vcm, acm, Iw, Lcm, L, dL, tauG, tauSup, tauExt, residual, Fsup, weight, contact, vContact, lowest, e3, unresolvedSupports,
    theta, phi: Math.atan2(e3[1], e3[0]), phidot, psidot, energy, ke: 0.5 * M * dot(vcm, vcm) + 0.5 * dot(f.w, Lcm), w: f.w, pw: f.pw };
}

/* the frame at time t: slerped orientation, linear everything else */
export function frameAt(sim, t) {
  const F = sim.frames;
  t = Math.max(0, Math.min(sim.duration, t));
  if (sim.analytic) return sim.analytic(t);
  if (F.length === 1 || t <= 0) return F[0];
  if (t >= sim.duration) return F[F.length - 1];
  const x = t / sim.duration * (F.length - 1), i = Math.min(F.length - 2, Math.floor(x)), u = x - i;
  const a = F[i], b = F[i + 1], lerp = (p, q) => p.map((v, k) => v + (q[k] - v) * u);
  const q = slerp(a.q, b.q, u), R = quatToMat(q);
  const w = a.wb ? mv(R, lerp(a.wb, b.wb)) : lerp(a.w, b.w), alpha = a.ab ? mv(R, lerp(a.ab, b.ab)) : lerp(a.alpha, b.alpha);
  return { t, q, pw: lerp(a.pw, b.pw), w, alpha, vpw: lerp(a.vpw, b.vpw), apw: lerp(a.apw, b.apw) };
}

function traces(sim) {
  const axisLen = sim.body.size * 1.25;
  const tip = [], contact = [], omega = [], phi = [], theta = [];
  let unwrap = 0, last = null;
  const wmax = Math.max(1e-12, ...sim.frames.map(f => norm(f.w)));
  for (const f of sim.frames) {
    const s = derive(sim, f);
    tip.push(add(s.xcm, scale(s.e3, axisLen)));
    contact.push(s.contact ? s.contact : null);
    omega.push(add(f.pw, scale(f.w, sim.body.size * 1.3 / wmax)));
    const ph = s.phi;
    if (last !== null) { let dp = ph - last; while (dp > Math.PI) dp -= 2 * Math.PI; while (dp < -Math.PI) dp += 2 * Math.PI; unwrap += dp; }
    last = ph; phi.push(unwrap); theta.push(s.theta);
  }
  return { tip, contact, omega, phi, theta };
}

// ── measurements for the model's checks ─────────────────────────────────────────────────────────────────────────
export const ZERO_QUANTITIES = new Set(['contact_speed', 'torque_residual']);
export function measure(sim, c) {
  const { body, ctx } = sim;
  const at = c.at == null ? sim.duration : c.at;
  if (!(at >= 0 && at <= sim.duration + 1e-9)) return NaN;
  const s = derive(sim, frameAt(sim, at));
  const IPw = mm(mm(s.R, madd(body.Icm, shiftTensor(body.M, sub(body.cm, ctx.pivotGiven || ctx.pb)))), tr(s.R));
  const Lsym = dot(s.L, s.e3);
  switch (c.quantity) {
    case 'mass': return body.M;
    case 'I1': return body.principal.values[0];
    case 'I2': return body.principal.values[1];
    case 'I3': return body.principal.values[2];
    case 'I_sym': return body.Isym;
    case 'I_perp': return perpMoment(body.Icm, body.sym);
    case 'I_pivot_sym': return dot(s.e3, mv(IPw, s.e3));
    case 'I_pivot_perp': return perpMoment(IPw, s.e3);
    case 'cm_distance': return norm(sub(body.cm, ctx.pivotGiven || ctx.pb));
    case 'omega_mag': return norm(s.w);
    case 'omega_z': return s.w[2];
    case 'omega_sym': return dot(s.w, s.e3);
    case 'L_mag': return norm(s.L);
    case 'L_z': return s.L[2];
    case 'L_sym': return Lsym;
    case 'L_perp': return norm(sub(s.L, scale(s.e3, Lsym)));
    case 'angle_L_omega_deg': { const a = norm(s.L), b = norm(s.w); return a > 0 && b > 0 ? Math.acos(Math.max(-1, Math.min(1, dot(s.L, s.w) / (a * b)))) / RAD : NaN; }
    case 'torque_mag': return norm(s.dL);
    case 'gravity_torque_mag': return norm(s.tauG);
    case 'torque_residual': return s.unresolvedSupports || sim.mode === 'fixed_axis' || ctx.support === 'ground' && !s.contact ? NaN : norm(s.residual);
    case 'contact_speed': return s.vContact ? norm(s.vContact) : NaN;
    case 'normal_force': return ctx.support !== 'none' && !s.unresolvedSupports && (ctx.support !== 'ground' || s.contact) ? s.Fsup[2] : NaN;
    case 'friction_force': return ctx.support !== 'none' && !s.unresolvedSupports && (ctx.support !== 'ground' || s.contact) ? Math.hypot(s.Fsup[0], s.Fsup[1]) : NaN;
    case 'ke': return s.ke;
    case 'cm_speed': return norm(s.vcm);
    case 'precession_rate': return c.at == null ? (sim.traces.phi[sim.traces.phi.length - 1] - sim.traces.phi[0]) / Math.max(sim.duration, 1e-12) : s.phidot;
    case 'spin_rate': return s.psidot;
    case 'theta_deg': return s.theta / RAD;
    case 'theta_min_deg': return Math.min(...sim.traces.theta) / RAD;
    case 'theta_max_deg': return Math.max(...sim.traces.theta) / RAD;
  }
  return NaN;
}
/* the moment about any axis perpendicular to a (unit) symmetry axis: defined only when the two perpendicular
   principal moments agree (a symmetric top); otherwise unavailable rather than an average */
export function perpMoment(I, a) {
  const u = unit(Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0])), v = cross(a, u);
  const puu = dot(u, mv(I, u)), pvv = dot(v, mv(I, v)), puv = dot(u, mv(I, v));
  const mean = (puu + pvv) / 2, half = Math.hypot((puu - pvv) / 2, puv);
  return half <= 0.005 * Math.max(Math.abs(mean), 1e-300) ? mean : NaN;
}
/* the natural size of a quantity that should vanish, so "0" can be judged with a relative tolerance */
export function zeroScale(sim, c) {
  const at = c.at == null ? sim.duration : c.at;
  const s = derive(sim, frameAt(sim, at));
  if (c.quantity === 'contact_speed') return norm(s.w) * sim.body.size + norm(s.vcm);
  return Math.max(norm(s.dL), norm(s.tauG), norm(s.tauExt), 1e-12);
}
export function check(sim, c) {
  const got = measure(sim, c);
  const tol = Math.max(0, Math.min(3, Number.isFinite(c.tol_pct) ? c.tol_pct : 3)) / 100;
  if (!Number.isFinite(got) || !Number.isFinite(c.expect)) return { ...c, got, status: 'na' };
  if (ZERO_QUANTITIES.has(c.quantity) && Math.abs(c.expect) < 1e-12) {
    const scaleV = zeroScale(sim, c);
    return { ...c, got, scale: scaleV, status: Math.abs(got) <= Math.max(tol, 0.01) * scaleV ? 'ok' : 'bad' };
  }
  const allowed = tol * Math.max(Math.abs(c.expect), 1e-9);
  const status = Math.abs(got - c.expect) <= allowed ? 'ok' : Math.abs(Math.abs(got) - Math.abs(c.expect)) <= allowed ? 'sign' : 'bad';
  return { ...c, got, status };
}
