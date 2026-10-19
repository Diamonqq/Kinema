/* Daily scene physics: pure functions (no three, no DOM), Node-tested in tests/test_daily_visuals.mjs.
   Each model returns { duration, at(t) } where at(t) gives the state the renderer draws. The motion itself is
   observable before the solution; only answer annotations wait for it. Units SI; g defaults to 9.81 m/s². */

const G = 9.81;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/* Piecewise-ballistic event sampler: segments [{t0, y:[...], v:[...]}] with every body under the same accel a. */
function sampler(segs, accel) {
  return t => {
    let i = segs.length - 1; while (i > 0 && segs[i].t0 > t) i--;
    const s = segs[i], dt = Math.max(0, t - s.t0);
    return { y: s.y.map((y, k) => y + s.v[k] * dt + 0.5 * accel[k] * dt * dt), v: s.v.map((v, k) => v + accel[k] * dt) };
  };
}
const elastic = (m1, v1, m2, v2) => [((m1 - m2) * v1 + 2 * m2 * v2) / (m1 + m2), ((m2 - m1) * v2 + 2 * m1 * v1) / (m1 + m2)];

/* A vertical stack of balls dropped from rest (Morin 5.23). y = bottom heights; elastic, instantaneous bounces with
   the ground and between neighbours; every ball falls with the same g, so neighbour gaps change linearly.
   model 'book' is Morin's m1 ≫ m2 ≫ … limit: the lower ball keeps its velocity and the upper one leaves at
   2v_lower − v_upper (relative speed reversed). model 'elastic' uses the finite masses. */
export function elasticStack({ balls, h, gap, g = G, duration = 4, model = 'book' }) {
  const n = balls.length, r = balls.map(b => b.r), m = balls.map(b => b.m);
  let y = [], acc = h; for (let i = 0; i < n; i++) { y.push(acc); acc += 2 * r[i] + gap; }
  let v = new Array(n).fill(0), t = 0; const segs = [{ t0: 0, y: y.slice(), v: v.slice() }], events = [];
  const a = new Array(n).fill(-g);
  for (let guard = 0; guard < 4000 && t < duration; guard++) {
    let best = Infinity, kind = null, idx = -1;
    // ground: y0 + v0 τ − g τ²/2 = 0, the positive root (falling or rising)
    { const disc = v[0] * v[0] + 2 * g * y[0]; const tau = (v[0] + Math.sqrt(Math.max(0, disc))) / g; if (tau > 1e-12 && tau < best) { best = tau; kind = 'ground'; idx = 0; } }
    for (let i = 0; i + 1 < n; i++) {
      const sep = y[i + 1] - (y[i] + 2 * r[i]), rel = v[i + 1] - v[i];
      if (rel < -1e-12) { const tau = sep / -rel; if (tau > 1e-12 && tau < best) { best = tau; kind = 'pair'; idx = i; } }
    }
    if (!(best < Infinity) || t + best > duration) break;
    y = y.map((yy, k) => yy + v[k] * best - 0.5 * g * best * best); v = v.map(vv => vv - g * best); t += best;
    if (kind === 'ground') { y[0] = 0; v[0] = Math.abs(v[0]); }
    else { const i = idx; y[i + 1] = y[i] + 2 * r[i]; if (model === 'book') v[i + 1] = 2 * v[i] - v[i + 1]; else [v[i], v[i + 1]] = elastic(m[i], v[i], m[i + 1], v[i + 1]); }
    events.push({ t, kind, idx }); segs.push({ t0: t, y: y.slice(), v: v.slice() });
  }
  const at = sampler(segs, a);
  return { duration, events, at: t => { const s = at(clamp(t, 0, duration)); return { y: s.y.map(y => Math.max(0, y)), v: s.v }; } };
}

/* Atwood machine with an optional uniform-disk pulley (Morin 3.1, 8.1). s = how far m1 has moved DOWN; the pulley
   turns by s / r (no slip). Stops when a mass reaches the floor or comes within `clear` of the pulley. */
export function atwood({ m1, m2, pulley_mass = 0, pulley_r, y1, y2, pulley_y, floor_y = 0.25, clear = 0.12, g = G }) {
  const a = (m1 - m2) * g / (m1 + m2 + pulley_mass / 2);
  const low = pulley_y - pulley_r - clear;   // highest a mass may rise
  // s > 0 lowers m1 and raises m2
  const sMax = a >= 0 ? Math.min(y1 - floor_y, low - y2) : -Math.min(y2 - floor_y, low - y1);
  const tEnd = a === 0 ? 0 : Math.sqrt(2 * Math.abs(sMax) / Math.abs(a));
  const at = t => { const tt = clamp(t, 0, tEnd), s = 0.5 * a * tt * tt; return { s, y1: y1 - s, y2: y2 + s, phi: s / pulley_r, v: a * tt }; };
  // End at the travel limit: a held pose is not a new equilibrium with the release tensions.
  return { a, T1: m1 * (g - a), T2: m2 * (g + a), duration: Math.max(tEnd, 0.01), moving: tEnd, at };
}

/* Equal linear density rods, perpendicular, both hinged (Morin 2.14).
   Right rod length L, angle theta above the leftward horizontal; left length L tan(theta).
   Contact force on right: N(c,-s) + f(s,c). Hinges exert the balancing vector.
   Static equilibrium requires mu >= cot(theta)^2. This is not a slip simulation. */
export function leaningSticksForces({theta, L, density = 1, g = G}) {
  const s = Math.sin(theta), c = Math.cos(theta), rightWeight = density * L * g, leftWeight = rightWeight * Math.tan(theta);
  const N = leftWeight * s / 2, f = rightWeight * c / 2;
  const contact = [N * c + f * s, -N * s + f * c, 0];
  return {rightWeight, leftWeight, N, f, muMin: f / N, contact,
    rightHinge: [-contact[0], rightWeight - contact[1], 0], leftHinge: [contact[0], leftWeight + contact[1], 0]};
}

/* Uniform ladder hinged at ground, massless perpendicular support of length l (2.15).
   F acts at distance l/tan(theta) up the ladder. Unit mass fixes a common display scale. */
export function proppedLadderForces({theta, L, l, mass = 1, g = G}) {
  const weight = mass * g, F = weight * L * Math.sin(theta) / (2 * l);
  const support = [-F * Math.sin(theta), F * Math.cos(theta), 0];
  return {weight, F, support, hinge: [-support[0], weight - support[1], 0]};
}

/* Ball between a fixed wall (x = 0) and a block on rough ground (Morin 5.20). Ball frictionless; block decelerates
   at µg while sliding. Instantaneous collisions; positions are the ball centre and the block centre. model 'book' is
   Morin's first-order M ≫ m rule (ε = m/M): ball leaves at (1 − 2ε)u, block at 2εu; 'elastic' uses exact masses. */
export function ballWallBlock({ ball_r, ball_x, block_x, block_size, m, M, mu, v0, g = G, bounces = 7, model = 'book' }) {
  const half = block_size / 2, dec = mu * g;
  let t = 0, x = ball_x, u = v0, X = block_x, V = 0, hits = 0; const segs = [{ t0: 0, x, u, X, V }], events = [];
  const blockAt = (X0, V0, dt) => { if (V0 <= 0) return [X0, 0]; const ts = V0 / dec; const d = Math.min(dt, ts); return [X0 + V0 * d - 0.5 * dec * d * d, Math.max(0, V0 - dec * d)]; };
  for (let guard = 0; guard < 200 && hits < bounces; guard++) {
    if (u < 0) { // to the wall
      const tau = (x - ball_r) / -u; [X, V] = blockAt(X, V, tau); x = ball_r; u = -u; t += tau; events.push({ t, kind: 'wall' });
    } else {     // to the block: solve x + u τ + r = X(τ) − half, block possibly decelerating; bisection on a monotone gap
      const gapAt = tau => { const [Xb] = blockAt(X, V, tau); return Xb - half - (x + u * tau + ball_r); };
      let lo = 0, hi = 1; while (gapAt(hi) > 0 && hi < 1e4) hi *= 2;
      for (let k = 0; k < 80; k++) { const mid = (lo + hi) / 2; if (gapAt(mid) > 0) lo = mid; else hi = mid; }
      const tau = hi; [X, V] = blockAt(X, V, tau); x = X - half - ball_r; t += tau;
      if (model === 'book') { const e = m / M; V = V + 2 * e * u; u = -(1 - 2 * e) * u; } else [u, V] = elastic(m, u, M, V); hits++; events.push({ t, kind: 'block', ball: u, block: V });
    }
    segs.push({ t0: t, x, u, X, V });
  }
  const last = segs[segs.length - 1];
  const tail = Math.min(((last.x - ball_r) / Math.max(1e-9, -last.u)) || 1, 1.5);
  const duration = t + (last.u < 0 ? tail : 1.5);
  const at = tt => {
    tt = clamp(tt, 0, duration); let i = segs.length - 1; while (i > 0 && segs[i].t0 > tt) i--;
    const s = segs[i], dt = tt - s.t0, [Xb, Vb] = blockAt(s.X, s.V, dt);
    return { x: Math.max(ball_r, s.x + s.u * dt), u: s.u, X: Xb, V: Vb };
  };
  return { duration, events, at };
}

const rk4 = (f, y, h) => { const k1 = f(y), k2 = f(y.map((v, i) => v + h / 2 * k1[i])), k3 = f(y.map((v, i) => v + h / 2 * k2[i])), k4 = f(y.map((v, i) => v + h * k3[i])); return y.map((v, i) => v + h / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i])); };
/* Integrate once at fixed step; the hoop opts into cubic Hermite dense output. */
function tabulate(f, y0, duration, h = 1 / 480, smooth = false) {
  const n = Math.ceil(duration / h), rows = [y0]; let y = y0; for (let i = 0; i < n; i++) { y = rk4(f, y, h); rows.push(y); }
  return t => { const u = clamp(t, 0, duration) / h, i = Math.min(n - 1, Math.floor(u)), w = u - i;
    if (!smooth) return rows[i].map((v, k) => v + (rows[i + 1][k] - v) * w);
    // Hermite dense output for the hoop: linear state blending caused artificial
    // Jacobi dips between RK4 steps, despite the undamped integration conserving it.
    const a = f(rows[i]), b = f(rows[i + 1]), w2 = w*w, w3 = w2*w;
    return rows[i].map((v,k)=>(2*w3-3*w2+1)*v+(w3-2*w2+w)*h*a[k]+(-2*w3+3*w2)*rows[i+1][k]+(w3-w2)*h*b[k]);
  };
}

/* Three coordinates, y vertical. Positive spin is rotation.y: +x turns toward −z.
   r = R sinθ eρ − R cosθ ey, eρ=(cosφ,0,−sinφ), eφ=(−sinφ,0,−cosφ).
   Differentiate in the inertial frame; the full frictionless reaction is m(a+g ey).
   Its azimuthal component 2mRωθ'cosθ is real constraint loading, not a fictitious force. */
export function beadHoopState({ R, omega, theta, thetaDot = 0, spin = 0, g = G, mass = 1 }) {
  const s = Math.sin(theta), c = Math.cos(theta), cp = Math.cos(spin), sp = Math.sin(spin);
  const eRho = [cp, 0, -sp], ePhi = [-sp, 0, -cp];
  const thetaDD = s * (omega * omega * c - g / R);
  const aRho = R * thetaDD * c - R * thetaDot * thetaDot * s - R * omega * omega * s;
  const aPhi = 2 * R * omega * thetaDot * c;
  const aY = R * thetaDD * s + R * thetaDot * thetaDot * c;
  const position = eRho.map((v, i) => R * s * v - (i === 1 ? R * c : 0));
  const tangent = eRho.map((v, i) => c * v + (i === 1 ? s : 0));
  const velocity = eRho.map((v, i) => R * thetaDot * c * v + R * omega * s * ePhi[i] + (i === 1 ? R * thetaDot * s : 0));
  const acceleration = eRho.map((v, i) => aRho * v + aPhi * ePhi[i] + (i === 1 ? aY : 0));
  const weight = [0, -mass * g, 0], reaction = acceleration.map((v, i) => mass * v - weight[i]);
  return { theta, thetaDot, thetaDD, spin, position, velocity, acceleration, weight, reaction, tangent, eRho, ePhi };
}

/* Bead on a hoop spinning at constant ω about its vertical diameter (Morin 6.11); θ from the bottom.
   θ'' = sin θ (ω² cos θ − g/R). Jacobi integral E = ½R²θ'² − ½ω²R² sin²θ − gR cos θ is conserved.
   There is no damping: a released bead oscillates rather than settling. */
export function beadHoop({ R, omega, theta0, thetaDot0 = 0, phase0 = 0, mass = 1, g = G, duration = 14 }) {
  const f = ([th, w]) => [w, Math.sin(th) * (omega * omega * Math.cos(th) - g / R)];
  const s = tabulate(f, [theta0, thetaDot0], duration, 1 / 480, true);
  const jacobi = (th, w) => 0.5 * R * R * w * w - 0.5 * omega * omega * R * R * Math.sin(th) ** 2 - g * R * Math.cos(th);
  return { duration, omega, jacobi, at: t => { const [theta, thetaDot] = s(t); return beadHoopState({ R, omega, theta, thetaDot, spin: phase0 + omega * clamp(t, 0, duration), mass, g }); } };
}

/* Pendulum hanging from a block that slides freely on a horizontal rail (Morin 6.14). x = block position, θ from
   the vertical. (M+m)ẍ + mℓ(θ̈ cos θ − θ̇² sin θ) = 0 and ℓθ̈ + ẍ cos θ + g sin θ = 0.
   Conserved: horizontal momentum P = (M+m)ẋ + mℓθ̇ cos θ and energy. */
export function railPendulum({ M, m, l, theta0, g = G, duration = 12 }) {
  const f = ([x, th, vx, w]) => {
    const c = Math.cos(th), s = Math.sin(th);
    // [M+m, m l c; c, l] [ẍ; θ̈] = [m l w² s; −g s]
    const a11 = M + m, a12 = m * l * c, a21 = c, a22 = l, b1 = m * l * w * w * s, b2 = -g * s, det = a11 * a22 - a12 * a21;
    return [vx, w, (b1 * a22 - a12 * b2) / det, (a11 * b2 - a21 * b1) / det];
  };
  // released from rest with the CM above the rail origin: x0 chosen so the system's horizontal CM is at 0
  const x0 = -m * l * Math.sin(theta0) / (M + m);
  const s = tabulate(f, [x0, theta0, 0, 0], duration);
  const momentum = ([, th, vx, w]) => (M + m) * vx + m * l * w * Math.cos(th);
  const energy = ([, th, vx, w]) => 0.5 * M * vx * vx + 0.5 * m * ((vx + l * w * Math.cos(th)) ** 2 + (l * w * Math.sin(th)) ** 2) - m * g * l * Math.cos(th);
  return { duration, momentum, energy, at: t => { const y = s(t), dy = f(y);
    const tension = m * (l * y[3] ** 2 + g * Math.cos(y[1]) - dy[2] * Math.sin(y[1]));
    return { x: y[0], theta: y[1], vx: y[2], thetaDot: y[3], xDD: dy[2], thetaDD: dy[3], tension, raw: y }; } };
}

/* Cone rolling without slipping on a table, tip fixed at the origin (Morin 9.3). Physics frame z up.
   The axis turns about z at Ω = v / (h cos α) (P moves on a circle of radius h cos α); the spin about the axis is
   ψ̇ = −Ω / sin α, which makes the total ω lie along the contact line. pose(t) → { R (3×3, body→world), phi }. */
const mul = (A, B) => A.map((row, i) => [0, 1, 2].map(j => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]));
const rotZ = a => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];
const rotY = a => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]];
const rotX = a => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
export const apply = (R, v) => [0, 1, 2].map(i => R[i][0] * v[0] + R[i][1] * v[1] + R[i][2] * v[2]);
export function rollingCone({ alpha, h, v, duration = 16 }) {
  const Om = v / (h * Math.cos(alpha)), psiDot = -Om / Math.sin(alpha);
  // body frame: axis along +x (tip at origin, base centre P at (h,0,0)); tilt the axis up by α about −y so the
  // lowest generator lies on the table (z = 0), then turn about z by φ.
  const pose = t => { const phi = Om * t, psi = psiDot * t; return { phi, psi, R: mul(rotZ(phi), mul(rotY(-alpha), rotX(psi))) }; };
  return { duration, Omega: Om, psiDot, pose, P: t => apply(pose(t).R, [h, 0, 0]) };
}

/* Mass kept on a circle of radius R by a string that leaves it tangent to a frictionless pole of radius r
   (Morin 3.22, solution 3.139–3.141). The string makes θ = asin(r/R) with the radius, so F cos θ = mv²/R and
   F sin θ = m dv/dt give v(t) = (1/v0 − t tan θ/R)⁻¹, which diverges at T = R/(v0 tan θ). The angle travelled is
   φ(t) = ln(v/v0)/tan θ. The clip stops when v reaches `until`·v0 (then holds). */
export function poleWrap({ R, r, v0, until = 3, hold = 0.8 }) {
  const th = Math.asin(r / R), k = Math.tan(th), T = R / (v0 * k), tEnd = T * (1 - 1 / until);
  const at = t => { const tt = clamp(t, 0, tEnd), v = 1 / (1 / v0 - tt * k / R); return { v, phi: Math.log(v / v0) / k, dv: v * v * k / R }; };
  return { duration: tEnd + hold, moving: tEnd, T, theta: th, at };
}

/* Small ring rolling without slipping inside a fixed cone, tip at the origin, axis +y (three's y-up), half-angle θ
   (Morin 9.13, solution 9.127–9.133). The contact point C circles at height h, radius ρ = h tan θ, at the book's
   Ω = √(g/2h)/tan θ; the ring's plane is ⟂ to the line tip→C and its centre is r in from C along the inward normal.
   Spin about that line ψ̇ = −ρΩ/r makes the ring's material point at C exactly at rest (Ω ŷ × C = r ψ̇ (s × n)).
   pose(t) → { C, centre, R } with R's columns (x toward C, y, z = s) times the spin Rz(ψ): body → world. */
export function ringInCone({ theta, h, r, g = G, phi0 = 0, duration = 8 }) {
  const rho = h * Math.tan(theta), Om = Math.sqrt(g / (2 * h)) / Math.tan(theta), psiDot = -rho * Om / r;
  const pose = t => {
    const ph = phi0 + Om * t, c = Math.cos(ph), s = Math.sin(ph), ps = psiDot * t;
    const C = [rho * c, h, -rho * s], radial = [c, 0, -s], n = radial.map((x, i) => -Math.cos(theta) * x + (i === 1 ? Math.sin(theta) : 0));
    const z = [Math.sin(theta) * c, Math.cos(theta), -Math.sin(theta) * s], x = n.map(v => -v);
    const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    const F = [[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]], cz = Math.cos(ps), sz = Math.sin(ps);
    return { phi: ph, psi: ps, C, centre: C.map((v, i) => v + r * n[i]), R: mul(F, [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]]) };
  };
  return { duration, Omega: Om, psiDot, rho, pose };
}
