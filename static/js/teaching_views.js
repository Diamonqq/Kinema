/* Kinema teaching views (1.44): explanatory overlays a planar scene earns from its own physical structure, not from
   per-scene code. planTeaching(spec, sim) recognises
   - an incline: one body resting on the slope face of a fixed triangular ramp. Slope axes x′ (down the slope) and y′ (out
     of it) through the body, the weight's components mg sinθ and mg cosθ completing a rectangle whose diagonal is mg, θ
     between mg and the into-slope axis, and a card with ma = mg sinθ − f, Iα = fR and a = αR (clockwise +) read off the run;
   - a spring chain: two or more bodies on sliders along one axis, joined to each other and to fixed points by springs.
     Equilibrium positions (solved from the springs' own k and rest lengths), each displacement x from its equilibrium, the
     middle springs' stretch xⱼ − xᵢ, every Hooke force as a signed term (−kx₁, k(x₂ − x₁) …) and m ẍ for each body. The
     vertical pair (weight, rail) cancels and is left out of this horizontal explanation; the card says so.
   Both are bounded to the class they explain and checked against the run before anything is drawn (docs/TEACHING-VIEWS.md);
   any other scene gets no overlay. Overlays follow the Forces layer (the help gate). Arrow scales are fixed for the whole run and labels sit at fixed offsets
   from their bodies, so nothing rescales, jitters or chases another label. Numbers come from the simulated frames. */

const SUB = '₀₁₂₃₄₅₆₇₈₉';
const sub = i => String(i).split('').map(d => SUB[+d]).join('');
const fmt = (v, d = 2) => (Math.abs(v) < 0.5 * 10 ** -d ? 0 : v).toFixed(d);
const sgn = (v, d = 2) => (v >= 0 ? '+' : '−') + fmt(Math.abs(v), d);
const minus = s => s.replace(/-/g, '−');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/* ── recognition ─────────────────────────────────────────────────────────────────────────────────────────────────── */
export function planTeaching(spec, sim) { return inclinePlan(spec, sim) || springChainPlan(spec, sim) || circularPlan(spec, sim) || axialPlan(spec, sim) || pullPlan(spec, sim) || projectilePlan(spec, sim); }

/* the slope face of each fixed triangle (its longest edge that is neither horizontal nor vertical), with its outward normal */
function slopeFaces(spec) {
  const out = [];
  for (const b of spec.bodies || []) {
    if (b.type !== 'static' || b.shape !== 'polygon' || (b.points || []).length !== 3) continue;
    const P = b.points.map(p => [p[0] + (b.pos?.[0] || 0), p[1] + (b.pos?.[1] || 0)]), C = [(P[0][0] + P[1][0] + P[2][0]) / 3, (P[0][1] + P[1][1] + P[2][1]) / 3];
    let best = null;
    for (let i = 0; i < 3; i++) { const a = P[i], c = P[(i + 1) % 3], dx = c[0] - a[0], dy = c[1] - a[1], L = Math.hypot(dx, dy);
      if (Math.abs(dx) > 1e-6 && Math.abs(dy) > 1e-6 && (!best || L > best.L)) best = { a, c, L }; }
    if (!best) continue;
    const t = [(best.c[0] - best.a[0]) / best.L, (best.c[1] - best.a[1]) / best.L]; let n = [-t[1], t[0]];
    if ((C[0] - best.a[0]) * n[0] + (C[1] - best.a[1]) * n[1] > 0) n = [-n[0], -n[1]];   // outward, away from the ramp's inside
    const down = t[1] < 0 ? t : [-t[0], -t[1]], theta = Math.atan2(Math.abs(down[1]), Math.abs(down[0]));
    out.push({ id: b.id, a: best.a, c: best.c, L: best.L, n, down, theta });
  }
  return out;
}

/* nothing else acts on these bodies: no applied force, impulse, string, rope or stick, and no joint but the allowed ones */
function isolated(spec, ids, allow = []) {
  const on = x => ids.includes(x), named = o => ids.some(id => JSON.stringify(o).includes(`"${id}"`));
  if ((spec.forces || []).some(f => on(f.body)) || (spec.impulses || []).some(f => on(f.body))) return false;
  if ([...(spec.strings || []), ...(spec.ropes || []), ...(spec.stick || [])].some(named)) return false;
  return !(spec.joints || []).some(j => (on(j.a) || on(j.b)) && !allow.includes(j.id));
}
/* frames a plan is checked over: every few, away from the run's two ends (where a rate is one-sided) */
const sample = (sim, keep = () => true) => { const fr = sim.frames || [], st = Math.max(1, Math.floor(fr.length / 60)), out = [];
  for (let i = 3; i < fr.length - 3; i += st) if (keep(fr[i])) out.push(fr[i]); return out; };

export function inclinePlan(spec, sim) {
  const f0 = sim?.frames?.[0]; if (!f0) return null;
  const movers = (spec.bodies || []).filter(b => b.type !== 'static' && b.shape !== 'edge'); if (movers.length !== 1) return null;
  const body = movers[0], s = f0.bodies[body.id], reach = body.shape === 'circle' ? body.r : body.shape === 'box' ? body.h / 2 : null;
  if (!s || !(reach > 0) || Math.abs(spec.gravity ?? 9.8) < 1e-9) return null;
  for (const F of slopeFaces(spec)) {
    if (F.theta < 3 * Math.PI / 180 || F.theta > 80 * Math.PI / 180) continue;
    const dist = (s.cx - F.a[0]) * F.n[0] + (s.cy - F.a[1]) * F.n[1], along = ((s.cx - F.a[0]) * (F.c[0] - F.a[0]) + (s.cy - F.a[1]) * (F.c[1] - F.a[1])) / F.L;
    if (Math.abs(dist - reach) > 0.05 * reach + 1e-3 || along < 0 || along > F.L) continue;
    // supported: a lone body acted on by gravity and the slope alone, explained only while it sits on the face (a box lying flat on
    // it); after it leaves the ramp the overlay is simply not drawn
    if (!isolated(spec, [body.id])) return null;
    const phi = Math.atan2(F.down[1], F.down[0]);
    const on = fr => { const q = fr.bodies[body.id]; if (!q) return false; const d = (q.cx - F.a[0]) * F.n[0] + (q.cy - F.a[1]) * F.n[1], al = ((q.cx - F.a[0]) * (F.c[0] - F.a[0]) + (q.cy - F.a[1]) * (F.c[1] - F.a[1])) / F.L;
      if (Math.abs(d - reach) > 0.05 * reach + 1e-3 || al < 0 || al > F.L) return false;
      // touching the ramp alone (a contact with the floor at its foot ends the explanation)
      if ((fr.forces || []).some(f => f.body === body.id && (f.kind === 'normal' || f.kind === 'friction') && f.other !== F.id)) return false;
      if (body.shape === 'box') { const r = ((q.a || 0) - phi) / (Math.PI / 2); if (Math.abs(r - Math.round(r)) * 90 > 3) return false; }
      return true; };
    // shown only while it is on the face across the whole window its rates are read over (no reading straddles a landing)
    const fr = sim.frames, h = 8 * (fr.length > 1 ? fr[1].t - fr[0].t : 1 / 240), T = fr[fr.length - 1].t;
    const applies = q => on(q) && on(nearest(sim, Math.max(0, q.t - h))) && on(nearest(sim, Math.min(T, q.t + h)));
    const plan = { kind: 'incline', body: body.id, ramp: F.id, theta: F.theta, down: F.down, n: F.n, R: reach, rolls: false, g: Math.abs(spec.gravity ?? 9.8), applies };
    const shown = sample(sim, applies); if (!shown.length) return null;
    // the card's a = αR and Iα = fR rows only for a circle that rolls without slipping on every frame shown
    const cw = F.down[0] >= 0 ? -1 : 1;
    plan.rolls = body.shape === 'circle' && shown.every(fr => { const q = fr.bodies[body.id], v = q.vx * F.down[0] + q.vy * F.down[1]; return Math.abs(v - cw * q.w * reach) <= 0.02 * Math.abs(v) + 2e-3; });
    // and the equations must hold in the run: along the slope ma = mg sinθ − f, across it N = mg cosθ
    const mg0 = s.m * plan.g;
    if (!shown.every(fr => { const N = teachingNumbers(plan, sim, fr); return Math.abs(N.m * N.a - (N.mgSin - N.f)) <= 0.05 * mg0 && Math.abs(N.N - N.mgCos) <= 0.05 * mg0; })) return null;
    return plan;
  }
  return null;
}

/* solve A x = b (small, dense) by Gaussian elimination with partial pivoting; null if singular */
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null; [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const k = M[r][c] / M[c][c]; for (let q = c; q <= n; q++) M[r][q] -= k * M[c][q]; } }
  return M.map((r, i) => r[n] / r[i]);
}

export function springChainPlan(spec, sim) {
  const f0 = sim?.frames?.[0]; if (!f0) return null;
  const joints = spec.joints || [], byId = Object.fromEntries((spec.bodies || []).map(b => [b.id, b]));
  const sliders = joints.filter(j => j.type === 'slider' && (j.a === 'world' || byId[j.a]?.type === 'static'));
  const movers = (spec.bodies || []).filter(b => b.type !== 'static' && b.shape !== 'edge');
  if (movers.length < 2 || !movers.every(b => sliders.some(j => j.b === b.id))) return null;
  const ax0 = sliders.find(j => j.b === movers[0].id).axis || [1, 0], m = Math.hypot(ax0[0], ax0[1]), u = [ax0[0] / m, ax0[1] / m];
  if (!sliders.filter(j => movers.some(b => b.id === j.b)).every(j => { const a = j.axis || [1, 0], q = Math.hypot(a[0], a[1]); return Math.abs(Math.abs((a[0] * u[0] + a[1] * u[1]) / q) - 1) < 1e-6; })) return null;
  const fixed = id => id === 'world' || byId[id]?.type === 'static';
  const springs = joints.filter(j => j.type === 'spring' && !(j.damping > 0) && j.anchorA && j.anchorB && [j.a, j.b].every(id => fixed(id) || movers.some(b => b.id === id)) && [j.a, j.b].some(id => !fixed(id)));
  if (!springs.length || !movers.every(b => springs.some(j => j.a === b.id || j.b === b.id))) return null;
  const proj = p => p[0] * u[0] + p[1] * u[1], idx = Object.fromEntries(movers.map((b, i) => [b.id, i]));
  // each spring along the axis: endpoint coordinates s (a fixed end is a constant), its start orientation σ, k and rest length
  const S = springs.map(j => { const sa = proj(j.anchorA), sb = proj(j.anchorB); const sg = Math.sign(sb - sa) || 1;
    // a spring attached off a body's centre keeps that offset along the axis (it moves rigidly with the slider)
    const off = (id, p) => fixed(id) ? null : proj(p) - proj([f0.bodies[id].cx, f0.bodies[id].cy]);
    return { id: j.id, a: j.a, b: j.b, k: j.k, rest: j.rest ?? Math.abs(sb - sa), sg, sa, sb, oa: off(j.a, j.anchorA), ob: off(j.b, j.anchorB) }; });
  // equilibrium: the net axial force on every body is zero. With anchor coordinates p (a body's centre c plus its fixed offset,
  // or a fixed end's own coordinate) and extension e = σ(p_b − p_a) − rest, a spring pulls its b end by −kσe = −k(p_b − p_a) + kσ·rest
  // and its a end by the opposite: linear in the centres c, so A c = rhs
  const n = movers.length, A = movers.map(() => new Array(n).fill(0)), rhs = new Array(n).fill(0);
  for (const s of S) {
    const ia = fixed(s.a) ? null : idx[s.a], ib = fixed(s.b) ? null : idx[s.b];
    const ca = ia == null ? s.sa : s.oa, cb = ib == null ? s.sb : s.ob;   // constant part of each end's coordinate
    const c0 = -s.k * (cb - ca) + s.k * s.sg * s.rest;                       // constant part of the force on the b end
    if (ib != null) { A[ib][ib] -= s.k; if (ia != null) A[ib][ia] += s.k; rhs[ib] -= c0; }
    if (ia != null) { A[ia][ia] -= s.k; if (ib != null) A[ia][ib] += s.k; rhs[ia] += c0; }
  }
  const eq = solve(A, rhs); if (!eq) return null;
  // supported: identical springs and masses on a rail across gravity (weight and rail cancel), nothing else attached, and no
  // spring preloaded at equilibrium (so each term is the spring's whole force, not a change about a preload)
  if (Math.abs(spec.gravity ?? 9.8) > 1e-9 && Math.abs(u[1]) > 1e-6) return null;
  if (!isolated(spec, movers.map(b => b.id), [...sliders.map(j => j.id), ...S.map(q => q.id)])) return null;
  if (!S.every(q => Math.abs(q.k - S[0].k) <= 1e-9 * S[0].k) || !movers.every(b => Math.abs(f0.bodies[b.id].m - f0.bodies[movers[0].id].m) <= 1e-9 * f0.bodies[movers[0].id].m)) return null;
  const at = (id, c, off) => fixed(id) ? c : eq[idx[id]] + off;
  if (!S.every(q => Math.abs(q.sg * (at(q.b, q.sb, q.ob) - at(q.a, q.sa, q.oa)) - q.rest) <= 1e-6 * q.rest + 1e-9)) return null;
  const order = movers.map(b => b.id).sort((p, q) => eq[idx[p]] - eq[idx[q]]), num = Object.fromEntries(order.map((id, i) => [id, i + 1]));
  const name = id => byId[id]?.label || id;
  // the symbolic Hooke term for each (spring, body) pair: a fixed end gives −kxᵢ; a spring between i (left) and j (right)
  // pulls i by k(xⱼ − xᵢ) and j by −k(xⱼ − xᵢ)
  const terms = [];
  for (const s of S) for (const end of ['a', 'b']) { const id = s[end]; if (fixed(id)) continue;
    const other = s[end === 'a' ? 'b' : 'a'], i = num[id];
    let expr;
    if (fixed(other)) expr = `−kx${sub(i)}`;
    else { const j = num[other], lo = Math.min(i, j), hi = Math.max(i, j), d = `(x${sub(hi)} − x${sub(lo)})`; expr = i === lo ? `k${d}` : `−k${d}`; }
    // its value from the displacements: −k xᵢ, or ±k(x_hi − x_lo)
    const coef = fixed(other) ? [[id, -s.k]] : (() => { const j = num[other], [lo, hi] = i < j ? [id, other] : [other, id], sg = i < j ? 1 : -1; return [[hi, sg * s.k], [lo, -sg * s.k]]; })();
    terms.push({ spring: s.id, body: id, expr, coef }); }
  const middle = S.filter(s => !fixed(s.a) && !fixed(s.b)).map(s => { const [i, j] = [num[s.a], num[s.b]].sort((p, q) => p - q); return { spring: s.id, a: order[i - 1], b: order[j - 1], expr: `x${sub(j)} − x${sub(i)}` }; });
  // a fixed arrow scale for the run: the largest Hooke force any spring reaches
  let maxF = 1e-9; for (const fr of sim.frames || []) for (const s of S) { const J = fr.joints?.[s.id]; if (J?.force) maxF = Math.max(maxF, Math.hypot(J.force[0], J.force[1])); }
  const plan = { kind: 'spring_chain', axis: u, bodies: order, eq: Object.fromEntries(movers.map(b => [b.id, eq[idx[b.id]]])), num, names: Object.fromEntries(order.map(id => [id, name(id)])),
    springs: S.map(s => ({ id: s.id, a: s.a, b: s.b, k: s.k, sa: s.sa, sb: s.sb })), sliders: sliders.map(j => j.id), terms, middle, maxF, applies: () => true };
  // every term must be the spring force the run applies, and m ẍ their sum, on every frame checked (a collision, a stop or
  // anything unmodelled rejects the whole explanation rather than switching it on and off)
  const tol = 0.03 * maxF + 1e-6;
  if (!sample(sim).every(fr => { const N = teachingNumbers(plan, sim, fr);
    return Object.values(N.force).flat().every(t => Math.abs(t.F - t.coef.reduce((q, [id, c]) => q + c * N.x[id], 0)) <= tol) &&
      order.every(id => Math.abs(N.m[id] * N.acc[id] - (N.force[id] || []).reduce((q, t) => q + t.F, 0)) <= 2 * tol); })) return null;
  return plan;
}

/* ── the numbers a plan explains at one frame (pure: the tests check them against the run) ───────────────────────── */
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
function rate(sim, t, f) { const fr = sim.frames, dt = fr.length > 1 ? fr[1].t - fr[0].t : 1 / 240, h = 4 * dt, T = fr[fr.length - 1].t;
  const t0 = Math.max(0, Math.min(T - 2 * h, t - h)), at = x => globalThis.Kinema2D ? globalThis.Kinema2D.frameAt(sim, x) : nearest(sim, x);
  return (f(at(t0 + 2 * h)) - f(at(t0))) / (2 * h); }
function nearest(sim, t) { let lo = 0, hi = sim.frames.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (sim.frames[m].t <= t) lo = m; else hi = m; } return sim.frames[lo]; }

export function teachingNumbers(plan, sim, frame) {
  if (plan.kind === 'incline') {
    const s = frame.bodies[plan.body], m = s.m, g = plan.g, th = plan.theta;
    const fr = frame.forces.filter(f => f.body === plan.body);
    const up = [-plan.down[0], -plan.down[1]], from = k => fr.filter(f => f.kind === k && (!plan.ramp || f.other === plan.ramp));
    const f = from('friction').reduce((q, x) => q + dot(x.vec, up), 0), N = from('normal').reduce((q, x) => q + dot(x.vec, plan.n), 0);
    // clockwise is + for the spin when the slope descends to the right (the roll is then clockwise), anticlockwise otherwise
    const cw = plan.down[0] >= 0 ? -1 : 1;
    const a = rate(sim, frame.t, q => dot([q.bodies[plan.body].vx, q.bodies[plan.body].vy], plan.down)), alpha = cw * rate(sim, frame.t, q => q.bodies[plan.body].w);
    const mgV = [0, -m * g];
    return { m, g, theta: th, mg: m * g, mgSin: dot(mgV, plan.down), mgCos: dot(mgV, [-plan.n[0], -plan.n[1]]), f, N, a, alpha, I: s.I, R: plan.R,
      comps: { down: plan.down.map(x => x * dot(mgV, plan.down)), into: plan.n.map(x => -x * dot(mgV, [-plan.n[0], -plan.n[1]])) }, cw: cw < 0 ? 'clockwise' : 'anticlockwise' };
  }
  if (plan.kind === 'spring_chain') {
    const x = Object.fromEntries(plan.bodies.map(id => { const b = frame.bodies[id]; return [id, dot([b.cx, b.cy], plan.axis) - plan.eq[id]]; }));
    const force = {}; for (const t of plan.terms) { const J = frame.joints?.[t.spring], sp = plan.springs.find(s => s.id === t.spring);
      // the engine reports a spring's force on its b end; its a end gets the opposite
      const F = J?.force ? dot(J.force, plan.axis) * (sp.b === t.body ? 1 : -1) : 0; (force[t.body] ||= []).push({ ...t, F }); }
    const acc = Object.fromEntries(plan.bodies.map(id => [id, rate(sim, frame.t, q => dot([q.bodies[id].vx, q.bodies[id].vy], plan.axis))]));
    const ext = Object.fromEntries(plan.middle.map(s => [s.spring, x[s.b] - x[s.a]]));
    return { x, force, acc, ext, m: Object.fromEntries(plan.bodies.map(id => [id, frame.bodies[id].m])) };
  }
  return null;
}

/* ── 1.45: Breakdown views beyond the incline and the spring chain ──────────────────────────────────────────────────
   Each is bounded to the structure it explains and checked against the run (Newton's law with the run's own forces and
   accelerations on every sampled frame) before anything is drawn; a scene that fails the check simply has no Breakdown.
   - circular: a ball on a rod or rope from a fixed point (a pendulum), or riding the outside of a fixed sphere. Radial and
     tangential axes at the ball, the weight split into mg sinθ (along the path) and mg cosθ (radial), θ at the centre, and
     a card with m a = mg sinθ … along the path and the radial equation with m v²/r, read off the run;
   - axial: blocks on rails (an Atwood machine, a movable pulley): each block's m a as the signed sum of the forces along
     its rail, and the net force drawn at the block's side at the scene's own force scale;
   - pull: one body on a level floor pulled by a fixed force at an angle (a spool's thread): the pull split into F cosφ and
     F sinφ, φ at the pull, and the horizontal and vertical equations;
   - projectile: one free body under gravity alone: its velocity split into v_x = v₀ cosθ (constant) and
     v_y = v₀ sinθ − g t, read off the run. This one is about velocity, so it does not need the Forces layer. */
const unit2 = (x, y) => { const m = Math.hypot(x, y); return m > 1e-12 ? [x / m, y / m] : [0, 0]; };
const accel = (sim, t, id) => [rate(sim, t, q => q.bodies[id].vx), rate(sim, t, q => q.bodies[id].vy)];
const near0 = (v, tol) => Math.abs(v) <= tol;
/* a signed sum written symbolically: [['T', +1], ['mg cosθ', −1]] → "T − mg cosθ" */
const sumText = ts => ts.length ? ts.map(([s, sg], i) => (i === 0 ? (sg < 0 ? '−' : '') : sg < 0 ? ' − ' : ' + ') + s).join('') : '0';
const sumVals = vs => vs.length ? vs.map((v, i) => (i === 0 ? minus(fmt(v)) : (v < 0 ? ' − ' : ' + ') + fmt(Math.abs(v)))).join('') : '0';
/* the fixed sign each named force takes along an axis over the run (majority of the sampled frames) */
function termSigns(frames, id, axisAt, skip) {
  const acc = {};
  for (const fr of frames) { const e = axisAt(fr); for (const f of fr.forces || []) { if (f.body !== id || skip(f)) continue; const k = f.label || f.kind; acc[k] = (acc[k] || 0) + Math.sign(dot(f.vec, e)); } }
  return Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, v < 0 ? -1 : 1]));
}
const bodyName = b => { const l = String(b?.label || '').trim(); return l || b?.id || 'body'; };
const massSym = b => { const l = String(b?.label || '').trim(); return /^m[₀-₉]*$/.test(l) ? l : 'm'; };

export function circularPlan(spec, sim) {
  const fr0 = sim?.frames?.[0], g = Math.abs(spec.gravity ?? 9.8); if (!fr0 || g < 1e-9 || !(sim.frames.length > 12)) return null;
  const byId = Object.fromEntries((spec.bodies || []).map(b => [b.id, b])), joints = spec.joints || [], items = {};
  for (const b of spec.bodies || []) {
    if (b.type === 'static' || b.shape !== 'circle' || !fr0.bodies[b.id]) continue;
    if ((spec.forces || []).some(f => f.body === b.id) || (spec.impulses || []).some(f => f.body === b.id)) continue;
    if ([...(spec.strings || []), ...(spec.ropes || [])].some(s => JSON.stringify(s).includes(`"${b.id}"`))) continue;
    const links = joints.filter(j => j.a === b.id || j.b === b.id);
    const hang = links.filter(j => (j.type === 'rod' || j.type === 'rope') && (j.a === 'world' || j.b === 'world' || byId[j.a === b.id ? j.b : j.a]?.type === 'static'));
    let it = null;
    if (hang.length === 1 && links.every(j => j === hang[0] || j.type === 'spring')) {
      const j = hang[0], c = j.a === b.id ? j.anchorB : j.anchorA; if (!c) continue;
      it = { id: b.id, mode: 'pendulum', c, rest: [0, -1], joint: j.id, on: () => true };
    } else if (!links.length) {
      // a ball on the outside of a fixed sphere: explained while it touches it
      const sph = (spec.bodies || []).find(s => s.type === 'static' && s.shape === 'circle' && sim.frames.some(q => q.forces.some(f => f.body === b.id && f.kind === 'normal' && f.other === s.id)));
      if (!sph) continue;
      it = { id: b.id, mode: 'sphere', c: sph.pos || [0, 0], rest: [0, 1], other: sph.id, on: q => (q.forces || []).some(f => f.body === b.id && f.kind === 'normal' && f.other === sph.id) };
    }
    if (!it) continue;
    const fr = sim.frames, h = 8 * (fr[1].t - fr[0].t), T = fr[fr.length - 1].t;
    it.applies = q => it.on(q) && it.on(nearest(sim, Math.max(0, q.t - h))) && it.on(nearest(sim, Math.min(T, q.t + h)));
    const shown = sample(sim, it.applies); if (shown.length < 6) continue;
    const m0 = fr0.bodies[b.id].m, tol = 0.06 * m0 * g;
    if (!shown.every(q => { const N = circularNumbers(it, g, sim, q); return near0(N.m * N.at - N.sumT, tol) && near0(N.sumR - N.m * N.v * N.v / N.r, tol); })) continue;
    const skip = f => f.kind === 'gravity';
    it.signT = termSigns(shown, b.id, q => circularNumbers(it, g, sim, q, true).et, skip);
    it.signR = termSigns(shown, b.id, q => circularNumbers(it, g, sim, q, true).in, skip);
    it.name = bodyName(b); it.R = b.r; it.L = Math.hypot(fr0.bodies[b.id].cx - it.c[0], fr0.bodies[b.id].cy - it.c[1]);
    items[b.id] = it;
  }
  const bodies = Object.keys(items); if (!bodies.length) return null;
  return { kind: 'circular', bodies, items, g, applies: fr => bodies.some(id => items[id].applies(fr)), needsForces: true };
}
/* geometry and Newton's law in the radial/tangential frame of one body at one frame (geomOnly skips the rates) */
function circularNumbers(it, g, sim, frame, geomOnly = false) {
  const s = frame.bodies[it.id], rv = [s.cx - it.c[0], s.cy - it.c[1]], r = Math.hypot(...rv), rh = unit2(...rv), inw = [-rh[0], -rh[1]];
  const theta = Math.atan2(it.rest[0] * rh[1] - it.rest[1] * rh[0], dot(it.rest, rh));   // signed, from the rest direction
  // e_t: along the path, the way gravity's tangential component pushes (toward the bottom of a swing, away from a sphere's top)
  const t = [-rh[1], rh[0]], gt = dot([0, -1], t), et = Math.abs(gt) > 1e-9 ? (gt > 0 ? t : [-t[0], -t[1]]) : t;
  if (geomOnly) return { et, in: inw, rh, r, theta };
  const m = s.m, mg = m * g, fs = (frame.forces || []).filter(f => f.body === it.id);
  const others = fs.filter(f => f.kind !== 'gravity').map(f => ({ label: f.label || f.kind, kind: f.kind, t: dot(f.vec, et), r: dot(f.vec, inw) }));
  const a = accel(sim, frame.t, it.id), v = Math.hypot(s.vx, s.vy);
  const mgSin = mg * Math.abs(Math.sin(theta)), mgCos = mg * Math.cos(theta);   // mg·e_t ≥ 0; mg cosθ signed (past 90° it flips)
  const gR = dot([0, -mg], inw);   // gravity toward the centre: −mg cosθ for a pendulum, +mg cosθ on a sphere
  return { m, g, mg, theta, r, v, at: dot(a, et), mgSin, mgCos, gR, others, et, in: inw, rh,
    sumT: mgSin + others.reduce((q, o) => q + o.t, 0), sumR: gR + others.reduce((q, o) => q + o.r, 0) };
}

export function axialPlan(spec, sim) {
  const fr0 = sim?.frames?.[0]; if (!fr0 || !(sim.frames.length > 12)) return null;
  const byId = Object.fromEntries((spec.bodies || []).map(b => [b.id, b]));
  const sliders = (spec.joints || []).filter(j => j.type === 'slider' && (j.a === 'world' || byId[j.a]?.type === 'static') && byId[j.b] && byId[j.b].type !== 'static');
  if (!sliders.length) return null;
  const shown = sample(sim); if (shown.length < 6) return null;
  const items = {};
  for (const j of sliders) {
    const id = j.b; if (items[id] || !fr0.bodies[id]) continue;
    let u = unit2(...(j.axis || [1, 0])); if (u[1] < -1e-9 || (Math.abs(u[1]) <= 1e-9 && u[0] < 0)) u = [-u[0], -u[1]];
    const m = fr0.bodies[id].m; let maxF = 1e-9;
    for (const q of shown) for (const f of q.forces) if (f.body === id) maxF = Math.max(maxF, Math.abs(dot(f.vec, u)));
    const tol = 0.04 * maxF + 1e-6;
    if (!shown.every(q => { const a = dot(accel(sim, q.t, id), u), F = q.forces.filter(f => f.body === id).reduce((s, f) => s + dot(f.vec, u), 0); return near0(m * a - F, tol); })) return null;
    // the terms that act along the rail at all (the rail's own force is across it)
    const along = {}; for (const q of shown) for (const f of q.forces) if (f.body === id) { const k = f.label || f.kind; along[k] = Math.max(along[k] || 0, Math.abs(dot(f.vec, u))); }
    const keep = Object.keys(along).filter(k => along[k] > 1e-3 * maxF);
    items[id] = { id, u, maxF, keep, sign: termSigns(shown, id, () => u, f => !keep.includes(f.label || f.kind)), name: bodyName(byId[id]), msym: massSym(byId[id]) };
  }
  const bodies = Object.keys(items); if (!bodies.length) return null;
  return { kind: 'axial', bodies, items, applies: () => true, needsForces: true, g: Math.abs(spec.gravity ?? 9.8) };
}
function axialNumbers(it, sim, frame) {
  const s = frame.bodies[it.id], terms = {};
  for (const f of frame.forces) if (f.body === it.id) { const k = f.label || f.kind; if (it.keep.includes(k)) terms[k] = (terms[k] || 0) + dot(f.vec, it.u); }
  const a = dot(accel(sim, frame.t, it.id), it.u);
  return { m: s.m, a, terms, sum: Object.values(terms).reduce((q, v) => q + v, 0) };
}

export function pullPlan(spec, sim) {
  const fr0 = sim?.frames?.[0], g = Math.abs(spec.gravity ?? 9.8); if (!fr0 || g < 1e-9 || !(sim.frames.length > 12)) return null;
  const movers = (spec.bodies || []).filter(b => b.type !== 'static' && b.shape !== 'edge'); if (movers.length !== 1) return null;
  const b = movers[0], pulls = (spec.forces || []).filter(f => f.body === b.id); if (pulls.length !== 1 || (spec.impulses || []).length) return null;
  if ((spec.joints || []).some(j => j.a === b.id || j.b === b.id)) return null;
  const F = pulls[0].F || pulls[0].vec; if (!F) return null;
  const phi = Math.atan2(Math.abs(F[1]), Math.abs(F[0])); if (phi < 6 * Math.PI / 180 || phi > 84 * Math.PI / 180) return null;
  const ex = [Math.sign(F[0]) || 1, 0], ey = [0, 1];
  const floorOf = q => (q.forces || []).find(f => f.body === b.id && f.kind === 'normal' && Math.abs(unit2(...f.vec)[1] - 1) < 1e-3);
  const on = q => !!floorOf(q) && (q.forces || []).every(f => f.body !== b.id || ['gravity', 'normal', 'friction', 'applied'].includes(f.kind));
  const fr = sim.frames, h = 8 * (fr[1].t - fr[0].t), T = fr[fr.length - 1].t;
  const applies = q => on(q) && on(nearest(sim, Math.max(0, q.t - h))) && on(nearest(sim, Math.min(T, q.t + h)));
  const shown = sample(sim, applies); if (shown.length < 6) return null;
  const m = fr0.bodies[b.id].m, tol = 0.05 * Math.max(m * g, Math.hypot(...F));
  const plan = { kind: 'pull', bodies: [b.id], body: b.id, F, phi, ex, ey, label: pulls[0].label || 'F', applies, needsForces: true, g, R: b.shape === 'circle' ? b.r : Math.max(b.w || 0.1, b.h || 0.1) / 2, name: bodyName(b) };
  if (!shown.every(q => { const N = pullNumbers(plan, sim, q); return near0(N.m * N.ax - N.sumX, tol) && near0(N.m * N.ay - N.sumY, tol); })) return null;
  plan.signF = Math.sign(shown.reduce((q, fr2) => q + Math.sign(pullNumbers(plan, sim, fr2, true).fx), 0)) || -1;
  return plan;
}
function pullNumbers(plan, sim, frame, geomOnly = false) {
  const s = frame.bodies[plan.body], fs = frame.forces.filter(f => f.body === plan.body), Fm = Math.hypot(...plan.F);
  const fx = fs.filter(f => f.kind === 'friction').reduce((q, f) => q + dot(f.vec, plan.ex), 0), N = fs.filter(f => f.kind === 'normal').reduce((q, f) => q + f.vec[1], 0);
  if (geomOnly) return { fx };
  const a = accel(sim, frame.t, plan.body), mg = s.m * plan.g, Fc = Fm * Math.cos(plan.phi), Fs = Fm * Math.sin(plan.phi) * (Math.sign(plan.F[1]) || 1);
  return { m: s.m, mg, F: Fm, Fc, Fs, fx, N, ax: dot(a, plan.ex), ay: a[1], sumX: Fc + fx, sumY: N + Fs - mg };
}

export function projectilePlan(spec, sim) {
  const fr0 = sim?.frames?.[0], g = Math.abs(spec.gravity ?? 9.8); if (!fr0 || g < 1e-9 || !(sim.frames.length > 12)) return null;
  const movers = (spec.bodies || []).filter(b => b.type !== 'static' && b.shape !== 'edge'); if (movers.length !== 1) return null;
  const b = movers[0]; if (!isolated(spec, [b.id])) return null;
  const free = q => (q.forces || []).every(f => f.body !== b.id || f.kind === 'gravity');
  const fr = sim.frames, i0 = fr.findIndex(q => free(q) && Math.hypot(q.bodies[b.id].vx, q.bodies[b.id].vy) > 1e-3); if (i0 < 0) return null;
  let i1 = i0; while (i1 + 1 < fr.length && free(fr[i1 + 1])) i1++;
  if (i1 - i0 < 10) return null;
  const s0 = fr[i0].bodies[b.id], t0 = fr[i0].t, v0 = [s0.vx, s0.vy], sp = Math.hypot(...v0);
  if (Math.abs(v0[0]) < 0.05 * sp) return null;   // straight up or down: nothing to split
  const t1 = fr[i1].t, applies = q => q.t >= t0 - 1e-9 && q.t <= t1 + 1e-9 && free(q);
  const ok = fr.slice(i0, i1 + 1).every(q => { const s = q.bodies[b.id]; return near0(s.vx - v0[0], 0.01 * sp + 1e-3) && near0(s.vy - (v0[1] - g * (q.t - t0)), 0.02 * sp + 1e-3); });
  if (!ok) return null;
  const vmax = Math.max(...fr.slice(i0, i1 + 1).map(q => Math.hypot(q.bodies[b.id].vx, q.bodies[b.id].vy)));
  return { kind: 'projectile', bodies: [b.id], body: b.id, v0, t0, theta: Math.atan2(v0[1], Math.abs(v0[0])), g, applies, needsForces: false, vmax, R: b.shape === 'circle' ? b.r : Math.max(b.w || 0.1, b.h || 0.1) / 2, name: bodyName(b) };
}

/* ── drawing ─────────────────────────────────────────────────────────────────────────────────────────────────────── */
/* env: { THREE, scene, Arrow3D, PALETTE, FORCE_COLOR, hex, arrowR, z (front plane of the moving body), size (scene size) } */
export function createTeaching(plan, sim, env) {
  const { THREE, scene, Arrow3D, PALETTE: P, FORCE_COLOR: FC, hex } = env, V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const group = new THREE.Group(); group.name = 'teaching'; group.visible = false; scene.add(group);
  const arrows = {}, arrow = (k, color, r, opacity) => arrows[k] ||= new Arrow3D(group, color, r, { opacity });
  const lineMat = (color, opacity, dashed, d) => dashed ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: d, gapSize: 0.7 * d, depthTest: false }) : new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false });
  const lines = {}; function line(k, pts, color, opacity = 0.6, dashed = false, d = 0.03) {
    let l = lines[k]; if (!l) { l = lines[k] = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat(color, opacity, dashed, d)); l.renderOrder = 27; group.add(l); }
    else l.geometry.setFromPoints(pts); if (dashed) l.computeLineDistances(); l.visible = true; return l; }
  const hideAll = () => { for (const a of Object.values(arrows)) a.update(V(), V(0, 1), 0); for (const l of Object.values(lines)) l.visible = false; };
  const ink = P.ink, wt = FC.gravity;
  const c = (t, col) => `<em style="color:${hex(col)};font-style:normal">${t}</em>`;
  const deg = a => Math.round(Math.abs(a) * 180 / Math.PI) + '°';
  const zf0 = env.z || 0, off = k => { if (arrows[k]) arrows[k].update(V(), V(0, 1), 0); };
  const offLines = ks => { for (const k of ks) if (lines[k]) lines[k].visible = false; };
  /* a force or velocity W drawn from `from`, split along e1 and e2 with the dashed rectangle closing on W's tip */
  function split(k, from, W, e1, e2, color, r) {
    const c1 = e1.clone().multiplyScalar(W.dot(e1)), c2 = e2.clone().multiplyScalar(W.dot(e2)), dl = 0.03 * W.length() + 1e-6;
    arrow(k + '1', color, r, 0.75).update(from, c1.lengthSq() > 1e-12 ? c1 : e1, c1.length()); arrow(k + '2', color, r, 0.75).update(from, c2.lengthSq() > 1e-12 ? c2 : e2, c2.length());
    line(k + 'r1', [from.clone().add(c1), from.clone().add(W)], color, 0.5, true, dl); line(k + 'r2', [from.clone().add(c2), from.clone().add(W)], color, 0.5, true, dl);
    return [arrows[k + '1'], arrows[k + '2'], c1, c2];
  }
  const arcPts = (C, r, a0, a1) => { const pts = []; for (let i = 0; i <= 24; i++) { const t = a0 + (a1 - a0) * i / 24; pts.push(C.clone().add(V(Math.cos(t) * r, Math.sin(t) * r, 0))); } return pts; };
  const angTo = (u, w) => { const a0 = Math.atan2(u.y, u.x); let d = Math.atan2(w.y, w.x) - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return [a0, a0 + d]; };

  if (plan.kind === 'circular') {
    const keys = [];
    return { group, plan, hides: () => false,
      update(frame, o) {
        group.visible = !!o.active; if (!o.active) { hideAll(); return; }
        const labels = o.labels, rows = [];
        for (const id of plan.bodies) {
          const it = plan.items[id], show = it.applies(frame) && (!o.targets || o.targets.includes(id)), K = id + '|';
          if (!show) { for (const k of ['mg1', 'mg2']) off(K + k); offLines(['ref', 'th', 'tan', 'rad', 'mgr1', 'mgr2'].map(k => K + k)); continue; }
          const N = circularNumbers(it, plan.g, sim, frame), s = frame.bodies[id], C = V(s.cx, s.cy, zf0), O = V(it.c[0], it.c[1], zf0);
          const rh = V(N.rh[0], N.rh[1]), et = V(N.et[0], N.et[1]), R = it.R, rest = V(it.rest[0], it.rest[1]);
          // the rest direction from the centre (straight down from a pivot, straight up from a sphere's centre) and θ from it
          const Lr = Math.max(N.r, 1e-6), rr = Math.min(0.32 * Lr, Math.max(2.2 * R, 0.18 * Lr));
          line(K + 'ref', [O, O.clone().addScaledVector(rest, it.mode === 'sphere' ? Lr + 1.6 * R : 0.55 * Lr)], ink, 0.45, true, 0.03 * Lr);
          const [a0, a1] = angTo(rest, rh); line(K + 'th', arcPts(O, rr, a0, a1), ink, 0.75);
          const mid = (a0 + a1) / 2, thAt = O.clone().add(V(Math.cos(mid) * rr * 1.32, Math.sin(mid) * rr * 1.32, 0));
          if (Math.abs(a1 - a0) > 0.04) labels.push({ key: 'teach|θ|' + id, label: 'θ', value: null, color: P.ink2, plain: true, tip: thAt, pin: thAt });
          // the path's tangent through the body and the radial line past it
          line(K + 'tan', [C.clone().addScaledVector(et, -2.4 * R), C.clone().addScaledVector(et, 2.4 * R)], ink, 0.45, true, 0.1 * R);
          line(K + 'rad', [it.mode === 'sphere' ? C.clone() : C.clone().addScaledVector(rh, -1.2 * R), C.clone().addScaledVector(rh, 2.4 * R)], ink, 0.45, true, 0.1 * R);
          const mgA = o.arrowOf?.(id, 'gravity'); if (mgA && mgA.g.visible) {
            const from = mgA.from.clone(), W = mgA.tip.clone().sub(from), [A1, A2] = split(K + 'mg', from, W, et, rh, wt, (mgA.r || env.arrowR) * 0.75);
            if (A1.g.visible) labels.push({ key: 'teach|mgsin|' + id, label: 'mg sinθ', glyph: 'mg sinθ', slot: 'glyph', color: wt, tip: A1.tip.clone(), dir: et.clone(), legend: 'mg sinθ  weight along the path', order: 31, value: N.mgSin, unit: 'N' });
            if (A2.g.visible) labels.push({ key: 'teach|mgcos|' + id, label: 'mg cosθ', glyph: 'mg cosθ', slot: 'glyph', color: wt, tip: A2.tip.clone(), dir: rh.clone().multiplyScalar(Math.sign(W.dot(rh)) || 1), legend: 'mg cosθ  weight along the radius', order: 32, value: Math.abs(N.mgCos), unit: 'N' });
          } else { off(K + 'mg1'); off(K + 'mg2'); offLines([K + 'mgr1', K + 'mgr2']); }
          const who = plan.bodies.length > 1 ? `<b>${esc(it.name)}</b> ` : '';
          const oT = N.others.filter(q => Math.abs(q.t) > 1e-3 * N.mg || it.signT[q.label]), oR = N.others.filter(q => Math.abs(q.r) > 1e-3 * N.mg || it.signR[q.label]);
          const tSym = [['mg sinθ', 1], ...oT.map(q => [esc(q.label), it.signT[q.label] || 1])], tVal = [N.mgSin, ...oT.map(q => q.t)];
          const gr = [it.mode === 'sphere' ? 'mg cosθ' : 'mg cosθ', it.mode === 'sphere' ? 1 : -1];
          const rSym = it.mode === 'sphere' ? [gr, ...oR.map(q => [esc(q.label), it.signR[q.label] || 1])] : [...oR.map(q => [esc(q.label), it.signR[q.label] || 1]), gr];
          const rVal = it.mode === 'sphere' ? [N.gR, ...oR.map(q => q.r)] : [...oR.map(q => q.r), N.gR];
          rows.push(`${who}<b>path</b>  m a = ${sumText(tSym)}   <span class="n">${fmt(N.m)}·${minus(fmt(N.at))} = ${sumVals(tVal)} N</span>`);
          rows.push(`${who}<b>radius</b>  ${sumText(rSym)} = m v²/r   <span class="n">${sumVals(rVal)} = ${fmt(N.m)}·${fmt(N.v)}²/${fmt(N.r)} N</span>`);
          rows.push(`<i>θ = ${deg(N.theta)} from ${it.mode === 'sphere' ? 'the top' : 'straight down'}; + along the path is the way mg sinθ pulls, + radially is toward the centre</i>`);
        }
        if (rows.length) labels.push({ key: 'teach|card', slot: 'card', title: 'Along the path and toward the centre', lines: rows });
      },
      focusPoint: () => null, targets: [] };
  }

  if (plan.kind === 'axial') {
    return { group, plan, hides: () => false,
      update(frame, o) {
        group.visible = !!o.active; if (!o.active) { hideAll(); return; }
        const labels = o.labels, rows = []; let horiz = false;
        for (const id of plan.bodies) {
          const it = plan.items[id], N = axialNumbers(it, sim, frame), s = frame.bodies[id], b = env.byId?.[id] || {}, u = V(it.u[0], it.u[1]); horiz ||= Math.abs(it.u[1]) < 1e-6;
          const show = !o.targets || o.targets.includes(id);
          // the net force along the rail, beside the block, at the scene's own force scale (from its drawn weight when there is one)
          const mgA = o.arrowOf?.(id, 'gravity'), sc = mgA && mgA.g.visible ? mgA.tip.distanceTo(mgA.from) / Math.max(1e-9, s.m * plan.g) : 0.9 * (b.h || 2 * (b.r || 0.2)) / it.maxF;
          const side = V(-u.y, u.x).multiplyScalar(-((b.shape === 'box' ? (Math.abs(u.y) > 0.5 ? b.w : b.h) / 2 : b.r || 0.1) + 0.06 * (b.w || 0.4))), from = V(s.cx, s.cy, zf0).add(side);
          const net = arrow('net|' + id, ink, env.arrowR * 0.8, 0.9); net.update(from, u.clone().multiplyScalar(Math.sign(N.sum) || 1), show && Math.abs(N.sum) > 1e-3 * it.maxF ? Math.abs(N.sum) * sc : 0);
          if (show && net.g.visible) labels.push({ key: 'teach|net|' + id, label: 'ΣF = ma', glyph: 'ΣF', slot: 'glyph', color: ink, tip: net.tip.clone(), dir: u.clone().multiplyScalar(Math.sign(N.sum) || 1), legend: 'ΣF  net force along the rail (= m a)', order: 33, value: Math.abs(N.sum), unit: 'N' });
          const ks = it.keep.filter(k => k in N.terms), sym = ks.map(k => [k === 'mg' ? it.msym + 'g' : esc(k), it.sign[k] || 1]), vals = ks.map(k => N.terms[k]);
          rows.push(`<span class="${show ? '' : 'off'}"><b>${esc(it.name)}</b>  ${it.msym} a = ${sumText(sym)}   <span class="n">${fmt(N.m)}·${minus(fmt(N.a))} = ${sumVals(vals)} N</span></span>`);
        }
        labels.push({ key: 'teach|card', slot: 'card', title: horiz ? 'Along each rail (+ to the right)' : 'Along each rail (up +)', lines: rows });
      },
      focusPoint: () => null, targets: [] };
  }

  if (plan.kind === 'pull') {
    const ex = V(plan.ex[0], plan.ex[1]), ey = V(0, 1), FC2 = FC.applied || P.ink;
    return { group, plan, hides: () => false,
      update(frame, o) {
        group.visible = !!o.active && plan.applies(frame); if (!group.visible) { hideAll(); return; }
        const labels = o.labels, N = pullNumbers(plan, sim, frame), A = o.arrowOf?.(plan.body, 'applied'), L = plan.label;
        if (A && A.g.visible) {
          const from = A.from.clone(), W = A.tip.clone().sub(from), [A1, A2] = split('F', from, W, ex, ey, FC2, (A.r || env.arrowR) * 0.75);
          labels.push({ key: 'teach|Fc', label: L + ' cosφ', glyph: L + ' cosφ', slot: 'glyph', color: FC2, tip: A1.tip.clone(), dir: ex.clone(), legend: L + ' cosφ  pull along the floor', order: 31, value: N.Fc, unit: 'N' });
          labels.push({ key: 'teach|Fs', label: L + ' sinφ', glyph: L + ' sinφ', slot: 'glyph', color: FC2, tip: A2.tip.clone(), dir: ey.clone(), legend: L + ' sinφ  pull upward', order: 32, value: Math.abs(N.Fs), unit: 'N' });
          const rr = 0.45 * W.length(), [a0, a1] = angTo(ex, W); line('phi', arcPts(from, rr, a0, a1), ink, 0.75);
          const at = from.clone().add(V(Math.cos((a0 + a1) / 2) * rr * 1.3, Math.sin((a0 + a1) / 2) * rr * 1.3, 0));
          labels.push({ key: 'teach|φ', label: 'φ', value: null, color: P.ink2, plain: true, tip: at, pin: at });
        } else { off('F1'); off('F2'); offLines(['Fr1', 'Fr2', 'phi']); }
        const ff = c('f', FC.friction), NN = c('N', FC.normal), Lc = c(L + ' cosφ', FC2), Ls = c(L + ' sinφ', FC2), fs = plan.signF < 0 ? ' − ' : ' + ';
        labels.push({ key: 'teach|card', slot: 'card', title: `Horizontal and vertical (φ = ${deg(plan.phi)})`, lines: [
          `<b>x</b>  m a = ${Lc}${fs}${ff}   <span class="n">${fmt(N.m)}·${minus(fmt(N.ax))} = ${fmt(N.Fc)}${fs}${fmt(Math.abs(N.fx))} N</span>`,
          `<b>y</b>  ${NN} ${N.Fs >= 0 ? '+' : '−'} ${Ls} − mg = 0   <span class="n">${fmt(N.N)} ${N.Fs >= 0 ? '+' : '−'} ${fmt(Math.abs(N.Fs))} − ${fmt(N.mg)} = ${minus(fmt(N.sumY))} N</span>`,
          `<i>+x is the pull's horizontal direction; f is the floor's friction on the ${esc(plan.name)}</i>`] });
      },
      focusPoint: () => null, targets: [] };
  }

  if (plan.kind === 'projectile') {
    const ex = V(Math.sign(plan.v0[0]) || 1, 0), ey = V(0, 1), VC = P.velocity, scale = 0.16 * (env.size || 4) / Math.max(1e-6, plan.vmax);
    return { group, plan, hides: () => false,
      update(frame, o) {
        group.visible = !!o.active && plan.applies(frame); if (!group.visible) { hideAll(); return; }
        const labels = o.labels, s = frame.bodies[plan.body], C = V(s.cx, s.cy, zf0 + 0.01), v = V(s.vx, s.vy), t = frame.t - plan.t0;
        const vA = arrow('v', VC, env.arrowR * 0.7, 0.55); vA.update(C, v, v.length() * scale);
        const [A1, A2] = split('v', C, v.clone().multiplyScalar(scale), ex, ey, VC, env.arrowR * 0.6);
        labels.push({ key: 'teach|vx', label: 'v_x', glyph: 'v_x', slot: 'glyph', color: VC, tip: A1.tip.clone(), dir: ex.clone(), legend: 'v_x  horizontal velocity (constant)', order: 31, value: Math.abs(s.vx), unit: 'm/s' });
        if (A2.g.visible) labels.push({ key: 'teach|vy', label: 'v_y', glyph: 'v_y', slot: 'glyph', color: VC, tip: A2.tip.clone(), dir: ey.clone().multiplyScalar(Math.sign(s.vy) || 1), legend: 'v_y  vertical velocity', order: 32, value: s.vy, unit: 'm/s' });
        const v0 = Math.hypot(...plan.v0), vx0 = Math.abs(plan.v0[0]), vy0 = plan.v0[1];
        labels.push({ key: 'teach|card', slot: 'card', title: `Velocity components (launched at θ = ${deg(plan.theta)}, v₀ = ${fmt(v0)} m/s)`, lines: [
          `<b>x</b>  v_x = v₀ cosθ   <span class="n">${fmt(Math.abs(s.vx))} = ${fmt(vx0)} m/s, constant: no horizontal force</span>`,
          `<b>y</b>  v_y = v₀ sinθ − g t   <span class="n">${minus(fmt(s.vy))} = ${minus(fmt(vy0))} − ${fmt(plan.g)}·${fmt(t)} m/s</span>`] });
      },
      focusPoint: () => null, targets: [] };
  }


  if (plan.kind === 'incline') {
    const d = V(plan.down[0], plan.down[1]), n = V(plan.n[0], plan.n[1]), R = plan.R, zf = env.z;
    const ccw = (u, v) => u.x * v.y - u.y * v.x;
    return {
      group, plan,
      hides: () => false,
      /* mgArrow: the drawn weight arrow (its from/tip carry the scene's own force scale) */
      update(frame, o) {
        group.visible = !!o.active; if (!o.active) { hideAll(); return; }
        const s = frame.bodies[plan.body], C = V(s.cx, s.cy, zf), N = teachingNumbers(plan, sim, frame), labels = o.labels;
        // slope axes through the body: hairlines past the rim, x′ down the slope, y′ out of it
        // (x′ runs further than the weight's downhill component so its glyph clears the mg sinθ label at the component's tip)
        const mgA = o.mgArrow && o.mgArrow.g.visible ? o.mgArrow : null, W0 = mgA ? Math.abs(mgA.tip.clone().sub(mgA.from).dot(d)) + Math.max(0, mgA.from.clone().sub(C).dot(d)) : 0;
        const A = 2.1 * R, AX = Math.max(A, 1.25 * W0 + 1.2 * R);
        line('xp', [C.clone().addScaledVector(d, -A), C.clone().addScaledVector(d, AX)], ink, 0.45, true, 0.04 * R);
        line('yp', [C.clone().addScaledVector(n, -1.2 * R), C.clone().addScaledVector(n, A)], ink, 0.45, true, 0.04 * R);
        const xTip = C.clone().addScaledVector(d, AX).addScaledVector(n, -0.5 * R), yTip = C.clone().addScaledVector(n, A);
        labels.push({ key: 'teach|x′', label: 'x′', glyph: 'x′', slot: 'glyph', color: ink, tip: xTip, dir: d.clone(), legend: 'x′ y′  slope axes: x′ down the slope, y′ out of it', row: 'teach-axes', order: 30, group: 'axes' });
        labels.push({ key: 'teach|y′', label: 'y′', glyph: 'y′', slot: 'glyph', color: ink, tip: yTip, dir: n.clone(), legend: 'x′ y′  slope axes: x′ down the slope, y′ out of it', row: 'teach-axes', order: 30, group: 'axes' });
        // the weight's components from the same point and at the same scale as the drawn mg: they complete its rectangle
        const mg = o.mgArrow && o.mgArrow.g.visible ? o.mgArrow : null;
        if (mg) {
          const from = mg.from.clone(), W = mg.tip.clone().sub(from), r = (mg.r || env.arrowR) * 0.75;
          const cd = d.clone().multiplyScalar(W.dot(d)), cn = n.clone().multiplyScalar(W.dot(n));
          arrow('down', wt, r, 0.7).update(from, cd, cd.length()); arrow('into', wt, r, 0.7).update(from, cn, cn.length());
          const dl = 0.03 * W.length();
          line('rect1', [from.clone().add(cd), from.clone().add(W)], wt, 0.55, true, dl); line('rect2', [from.clone().add(cn), from.clone().add(W)], wt, 0.55, true, dl);
          labels.push({ key: 'teach|mgsin', label: 'mg sinθ', glyph: 'mg sinθ', slot: 'glyph', color: wt, tip: arrows.down.tip.clone(), dir: d.clone(), legend: 'mg sinθ  weight along the slope (down x′)', order: 31, value: N.mgSin, unit: 'N' });
          labels.push({ key: 'teach|mgcos', label: 'mg cosθ', glyph: 'mg cosθ', slot: 'glyph', color: wt, tip: arrows.into.tip.clone(), dir: n.clone().negate(), legend: 'mg cosθ  weight into the slope (−y′)', order: 32, value: N.mgCos, unit: 'N' });
          // θ between the weight (straight down) and the into-slope axis: the same angle as the slope's
          const rr = 0.42 * W.length(), a0 = Math.atan2(-1, 0), a1 = Math.atan2(-n.y, -n.x), lo = ccw(V(0, -1), n.clone().negate()) > 0 ? a0 : a1, hi = lo === a0 ? a1 : a0;
          const pts = []; for (let i = 0; i <= 24; i++) { const t = lo + (hi - lo) * i / 24; pts.push(from.clone().add(V(Math.cos(t) * rr, Math.sin(t) * rr, 0))); }
          line('theta', pts, ink, 0.75);
          const mid = (lo + hi) / 2, at = from.clone().add(V(Math.cos(mid) * rr * 1.35, Math.sin(mid) * rr * 1.35, 0));
          labels.push({ key: 'teach|θ', label: 'θ', value: null, color: P.ink2, plain: true, tip: at, pin: at });
        } else { for (const k of ['down', 'into']) arrows[k]?.update(V(), V(0, 1), 0); for (const k of ['rect1', 'rect2', 'theta']) if (lines[k]) lines[k].visible = false; }
        // sliding when it moves or is already accelerating along the slope (released from rest it slides from t = 0: friction is
        // kinetic at once); only a body that stays put is held by static friction
        const sv = frame.bodies[plan.body], slides = !plan.rolls && (Math.abs(sv.vx * plan.down[0] + sv.vy * plan.down[1]) > 1e-3 || Math.abs(N.a) > 0.01);
        const c = (t, col) => `<em style="color:${hex(col)};font-style:normal">${t}</em>`, mgs = c('mg sinθ', wt), mgc = c('mg cosθ', wt), ff = c('f', FC.friction), NN = c('N', FC.normal);
        const roll = plan.rolls ? [`<b>τ</b>  Iα = ${ff}R  (${N.cw} +)   <span class="n">${fmt(N.I, 3)}·${fmt(N.alpha, 1)} = ${fmt(N.f)}·${fmt(N.R)}</span>`, `<b>roll</b>  a = αR   <span class="n">${fmt(N.a)} = ${fmt(N.alpha, 1)}·${fmt(N.R)}</span>`] : [];
        labels.push({ key: 'teach|card', slot: 'card', title: 'Along the slope', lines: [
          `<b>x′</b>  ma = ${mgs} − ${ff}   <span class="n">${fmt(N.m)}·${fmt(N.a)} = ${fmt(N.mgSin)} − ${fmt(N.f)} N</span>`,
          `<b>y′</b>  ${NN} = ${mgc}   <span class="n">${fmt(N.N)} = ${fmt(N.mgCos)} N</span>`, ...roll,
          slides ? `<i>f is kinetic friction, up the slope against the slide: f = μN</i>` : `<i>f is static friction, up the slope (+ here)</i>`] });
      },
      focusPoint: frame => { const s = frame.bodies[plan.body]; return [s.cx, s.cy]; },
      targets: [],
    };
  }

  // spring chain
  const u = V(plan.axis[0], plan.axis[1]), up = V(-u.y, u.x), byId = env.byId, zf = env.z;
  const half = id => { const b = byId[id]; return b.shape === 'box' ? b.h / 2 : (b.r || 0.1); };
  const width = id => { const b = byId[id]; return b.shape === 'box' ? b.w : 2 * (b.r || 0.1); };
  const H = Math.max(...plan.bodies.map(half)), Wmin = Math.min(...plan.bodies.map(width)), scale = 0.95 * Wmin / plan.maxF;
  const eqP = id => { const f0 = sim.frames[0].bodies[id], c0 = V(f0.cx, f0.cy), s0 = c0.dot(u); return c0.addScaledVector(u, plan.eq[id] - s0); };
  const springColor = FC.joint, rowGap = 0.42 * Wmin; let selSpring = null;
  // a block's terms in the card's order (a fixed end's −kx first, then the coupling) and written as one signed sum
  const order = ts => ts.slice().sort((p, q) => (p.expr.includes('(') ? 1 : 0) - (q.expr.includes('(') ? 1 : 0));
  const rhsOf = ts => ts.map((t, j) => j === 0 ? t.expr : t.expr.startsWith('−') ? '− ' + t.expr.slice(1) : '+ ' + t.expr).join(' ');
  // the explanation's own frame: the chain's walls and every place its blocks reach, with the rows above and the x labels below
  const fitBox = (() => { let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; const g = (x, y) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); };
    for (const f of sim.frames) for (const id of plan.bodies) { const b = f.bodies[id], c = dot([b.cx, b.cy], plan.axis), w = width(id) / 2; for (const e of [-w, w]) g(c + e, 0); }
    for (const q of plan.springs) { if (q.a === 'world') g(q.sa, 0); if (q.b === 'world') g(q.sb, 0); }
    // the walls the chain ends on: static boxes straddling its line at or just past its ends
    const f0 = sim.frames[0].bodies[plan.bodies[0]], h0 = dot([f0.cx, f0.cy], [up.x, up.y]); let wallH = H;
    for (const b of Object.values(byId)) if (b.type === 'static' && b.shape === 'box' && b.pos && Math.abs(dot(b.pos, [up.x, up.y]) - h0) < b.h / 2) {
      const c = dot(b.pos, plan.axis), w = b.w / 2; if (c + w >= x0 - 0.5 && c - w <= x1 + 0.5) { g(c - w, 0); g(c + w, 0); wallH = Math.max(wallH, b.h / 2); } }
    return { x: [x0, x1], y: [h0 - Math.max(wallH, H + 0.6 * Wmin), h0 + Math.max(wallH, H + 0.22 * Wmin + 2 * rowGap + 0.2 * Wmin)], u: [u.x, u.y], n: [up.x, up.y] }; })();
  return {
    group, plan,
    // in this horizontal explanation the springs' own arrows are redrawn as signed Hooke terms; weight and rail cancel
    hides: f => plan.bodies.includes(f.body) && (f.kind === 'gravity' || (f.kind === 'joint' && (plan.sliders.includes(f.joint) || plan.springs.some(s => s.id === f.joint)))),
    update(frame, o) {
      group.visible = !!o.active; if (!o.active) { hideAll(); return; }
      const N = teachingNumbers(plan, sim, frame), labels = o.labels, sel = selSpring = o.selected?.type === 'spring' && plan.middle.some(m => m.spring === o.selected.id) ? o.selected.id : null;
      const show = id => !sel && (!o.targets || o.targets.includes(id)), base = -H - 0.16 * Wmin;
      for (const id of plan.bodies) {
        const s = frame.bodies[id], C = V(s.cx, s.cy, zf), E = eqP(id).setZ(zf), i = plan.num[id], x = N.x[id];
        // equilibrium mark: a fine dashed line through the block's equilibrium centre and a tick on the baseline under it
        line('eq|' + id, [E.clone().addScaledVector(up, base - 0.06 * Wmin), E.clone().addScaledVector(up, H + 0.08 * Wmin)], ink, 0.5, true, 0.03 * Wmin);
        const B0 = E.clone().addScaledVector(up, base), B1 = C.clone().addScaledVector(up, base);
        labels.push({ key: 'teach|eq|' + id, slot: 'key', row: 'teach-eq', label: '┆', glyph: '┆', legend: '┆  equilibrium: x = 0 there', color: P.ink2, order: 30, tip: E });
        // displacement from equilibrium along the baseline, signed in its label
        const dx = B1.clone().sub(B0), len = dx.length();
        arrow('x|' + id, ink, env.arrowR * 0.55, 0.85).update(B0, len > 1e-6 ? dx : u.clone(), len > 0.004 ? len : 0);
        const xl = B0.clone().add(B1).multiplyScalar(0.5).addScaledVector(up, -0.09 * Wmin);
        labels.push({ key: 'teach|x|' + id, label: `x${sub(i)} = ${minus(sgn(x))} m`, value: null, color: ink, plain: true, tip: xl, pin: xl.clone().addScaledVector(u, 0) });
        // its Hooke terms: the left spring's at the upper half, the right spring's at the lower half, labels above / below the block
        for (const t of N.force[id] || []) {
          const sp = plan.springs.find(q => q.id === t.spring), other = sp.a === id ? sp.b : sp.a, oc = other === 'world' || !frame.bodies[other] ? null : frame.bodies[other];
          const fromLeft = oc ? dot([oc.cx, oc.cy], plan.axis) < dot([s.cx, s.cy], plan.axis) : (() => { const J = frame.joints?.[sp.id]; const p = J ? (sp.a === id ? J.anchorB : J.anchorA) : [s.cx, s.cy]; return dot(p, plan.axis) < dot([s.cx, s.cy], plan.axis); })();
          const lvl = fromLeft ? 0.42 * H : -0.42 * H, from = C.clone().addScaledVector(up, lvl), k = 'F|' + id + '|' + t.spring, on = show(id) || sel === t.spring;
          arrow(k, springColor, env.arrowR * 0.9, 1).update(from, u.clone().multiplyScalar(Math.sign(t.F) || 1), on && Math.abs(t.F) > 1e-3 ? Math.abs(t.F) * scale : 0);
        }
        // the block's net spring force as one fixed label above it, written as the card's right-hand side; neighbouring blocks
        // alternate between two rows so their labels never meet, whatever the zoom (a fixed place: no chasing, no jitter)
        const ts = order(N.force[id] || []).filter(t => show(id) || sel === t.spring);
        if (ts.length) { const at = C.clone().addScaledVector(up, H + 0.22 * Wmin + (i % 2 ? 0 : rowGap));
          labels.push({ key: id + '|spring|' + ts.map(t => t.spring).join('+'), label: rhsOf(ts), value: null, color: sel ? P.highlight : springColor, plain: true, tip: at, pin: at }); }
      }
      for (const id of Object.keys(arrows)) if (id.startsWith('F|') && !plan.terms.some(t => 'F|' + t.body + '|' + t.spring === id)) arrows[id].update(V(), V(0, 1), 0);
      // a selected middle spring's stretch from its equilibrium length, above it (otherwise the card carries it)
      for (const m of plan.middle) { if (sel !== m.spring) continue;
        const a = frame.bodies[m.a], b = frame.bodies[m.b], mid = V((a.cx + b.cx) / 2, (a.cy + b.cy) / 2, zf).addScaledVector(up, H + 0.22 * Wmin + 2 * rowGap);
        labels.push({ key: 'teach|ext|' + m.spring, label: `stretch ${m.expr} = ${minus(sgn(N.ext[m.spring]))} m`, value: null, color: sel === m.spring ? hex(P.highlight) : ink, plain: true, tip: mid, pin: mid });
      }
      const rows = plan.bodies.map(id => { const i = plan.num[id], ts = order(N.force[id] || []), sum = ts.reduce((q, t) => q + t.F, 0);
        const rhs = rhsOf(ts), vals = ts.map((t, j) => (j === 0 ? minus(fmt(t.F)) : (t.F < 0 ? '− ' : '+ ') + fmt(Math.abs(t.F)))).join(' ');
        const dim = sel ? !ts.some(t => t.spring === sel) : o.targets && !o.targets.includes(id);
        return `<span class="${dim ? 'off' : ''}"><b>${plan.names[id]}</b>  m ẍ${sub(i)} = ${rhs}   <span class="n">= ${vals} = ${minus(fmt(sum))} N</span></span>`; });
      labels.push({ key: 'teach|card', slot: 'card', title: 'x from equilibrium, + to the right', lines: [...rows, ...plan.middle.map(m => `<span class="${sel && sel !== m.spring ? 'off' : ''}"><b>stretch</b>  ${m.expr}   <span class="n">= ${minus(sgn(N.ext[m.spring]))} m</span></span>`), '<i>Weight and rail force cancel vertically; not drawn here.</i>'] });
    },
    // a selected middle spring is the close-up's subject: the point midway between its two bodies
    // (the camera may move before the next update has seen a new selection, so the current one is passed in)
    focusPoint: (frame, selected) => { const id = selected === undefined ? selSpring : selected?.type === 'spring' ? selected.id : null, m = id && plan.middle.find(q => q.spring === id); if (!m) return null;
      const a = frame.bodies[m.a], b = frame.bodies[m.b], half = Math.hypot(b.cx - a.cx, b.cy - a.cy) / 2 + Math.max(width(m.a), width(m.b)) / 2;
      return [(a.cx + b.cx) / 2, (a.cy + b.cy) / 2, half]; },
    fitBox,
    targets: plan.middle.map(m => ({ type: 'spring', id: m.spring, name: plan.middle.length > 1 ? `Spring ${m.expr}` : 'Middle spring' })),
  };
}
