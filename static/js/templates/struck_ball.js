/* Cue ball struck at height h above the centre — Morin 8.6 (angular impulse).
   Solid ball: I = (2/5) m R². Impulse P → v₀ = P/m, ω₀ = P h / I (forward spin for h > 0).
   Contact-point speed v − ωR decides the friction direction; kinetic friction μ m g acts until v = ωR.
   L about the contact point on the table (I ω + m v R) is conserved throughout. Pure roll at once iff h = 2R/5. */
(function () {
  const K = window.Kinema;
  const I = p => 0.4 * p.mass * p.radius * p.radius;
  const v0 = p => p.impulse / p.mass;
  const w0 = p => p.impulse * p.h / I(p);
  function tRoll(p) { const s = v0(p) - w0(p) * p.radius; if (Math.abs(s) < 1e-12) return 0; if (p.mu <= 0) return Infinity; return Math.abs(s) / (3.5 * p.mu * p.g); }
  function vFinal(p) { const t = tRoll(p); if (!isFinite(t)) return NaN; const s = Math.sign(v0(p) - w0(p) * p.radius); return v0(p) - s * p.mu * p.g * t; }
  K.template('struck_ball', {
    duration(p) { const t = tRoll(p); return Math.min(20, (isFinite(t) ? t : 4) + 1.5); },
    init(p) { return { q: [0, 0], qd: [v0(p), w0(p)], flags: { rolling: Math.abs(v0(p) - w0(p) * p.radius) < 1e-12 } }; },   // q = [x, φ]
    accel(p, q, qd, t, flags) {
      if (flags.rolling) return [0, 0];
      const slip = qd[0] - qd[1] * p.radius, s = Math.sign(slip);
      return [-s * p.mu * p.g, s * p.mu * p.g / (0.4 * p.radius)];
    },
    transition(p, s) {
      if (s.flags.rolling) return null;
      const slip = s.qd[0] - s.qd[1] * p.radius, slip0 = v0(p) - w0(p) * p.radius, s0 = Math.sign(slip0);
      // lock when the contact point (nearly) stops: RK4 chatters around zero slip inside a step, so a pure sign test can stall
      if (Math.sign(slip) !== s0 || Math.abs(slip) <= 0.01 * Math.abs(slip0) + 1e-9) {
        const v = (0.4 * s.qd[1] * p.radius + s.qd[0]) / 1.4;          // lock exactly via L about the contact point
        return { qd: [v, v / p.radius], flags: { ...s.flags, rolling: true }, event: 'rolling without slipping' };
      }
      return null;
    },
    bounds(p) { const R = p.radius, vf = vFinal(p); const xr = Math.max(0.3, (isFinite(vf) ? vf : v0(p)) * this.duration(p) + 4 * R); return { xmin: -3 * R - 0.05, xmax: xr, ymin: -2 * R - 0.05, ymax: 4 * R + 0.1 }; },
    render(g, p, s, ov, hl) {
      const R = p.radius, x = s.q[0];
      g.line(g.scale ? -3 * R - 0.05 : 0, 0, 1e3, 0, '#6C6D75', 2);
      g.circle(x, R, R, { fill: 'rgba(86,134,254,.18)', stroke: '#9DB8FF', width: 2.5 });
      g.spokes(x, R, R, -s.q[1], 4);
      g.dot(x, R, 3, '#F9FAFB');
      if (s.t < 0.12) { g.arrow(x - 3 * R, R + p.h, 2.2 * R, 0, '#F472B6', { width: 4, label: 'P' }); g.dot(x, R + p.h, 4, '#F472B6'); }
      if (ov.labels !== false) g.text(s.flags.rolling ? 'rolling' : 'slipping', x, R * 2 + 0.02, { color: s.flags.rolling ? '#4ADE80' : '#F5B95F', dyPx: -14, size: 12 });
      if (ov.vectors && !s.flags.rolling) { const slip = s.qd[0] - s.qd[1] * R; g.arrow(x, 0, slip, 0, '#F5B95F', { lenPx: Math.min(60, 10 + 40 * Math.abs(slip)), width: 2, label: 'contact point v' }); }
    },
    fbd(p, s) {
      const R = p.radius, x = s.q[0], m = p.mass, N = m * p.g;
      const out = [{ at: [x, R], vec: [0, -m * p.g], label: 'mg', key: 'mg' }, { at: [x, 0], vec: [0, N], label: 'N', key: 'N' }];
      if (!s.flags.rolling && p.mu > 0) { const sgn = Math.sign(s.qd[0] - s.qd[1] * R); out.push({ at: [x, 0], vec: [-sgn * p.mu * N, 0], label: 'f (kinetic)', key: 'friction' }); }
      return out;
    },
    vectors(p, s) { const R = p.radius; return [{ at: [s.q[0], R], vec: [s.qd[0], 0], label: 'v', key: 'v' }, { at: [s.q[0], R], kind: 'omega', omega: -s.qd[1], r: R, label: 'ω', key: 'omega' }]; },
    quantities(p, s) {
      const R = p.radius, m = p.mass, v = s.qd[0], w = s.qd[1];
      return [
        { key: 'v', label: 'v', value: v, unit: 'm/s', graph: true },
        { key: 'omega', label: 'ω', value: w, unit: 'rad/s', graph: true },
        { key: 'slip', label: 'contact-point speed v − ωR', value: v - w * R, unit: 'm/s', graph: true },
        { key: 'friction', label: 'friction', value: s.flags.rolling ? 0 : p.mu * m * p.g, unit: 'N' },
        { key: 'L_contact', label: 'L about contact point', value: I(p) * w + m * v * R, unit: 'kg·m²/s' },
        { key: 'KE', label: 'KE', value: 0.5 * m * v * v + 0.5 * I(p) * w * w, unit: 'J' },
      ];
    },
    energy(p, s) { const m = p.mass, v = s.qd[0], w = s.qd[1]; return [{ label: 'KE trans', value: 0.5 * m * v * v, color: '#5686FE' }, { label: 'KE rot', value: 0.5 * I(p) * w * w, color: '#A78BFA' }]; },
    answers(p) {
      const t = tRoll(p), vf = vFinal(p), m = p.mass, R = p.radius;
      const ke0 = 0.5 * m * v0(p) ** 2 + 0.5 * I(p) * w0(p) ** 2, ke1 = isFinite(vf) ? 0.5 * m * vf * vf + 0.5 * I(p) * (vf / R) ** 2 : NaN;
      return { v0: v0(p), omega0: w0(p), t_roll: t, v_final: vf, ke_lost_fraction: 1 - ke1 / ke0, h_for_pure_roll: 0.4 * R };
    },
    measure(p, sim) { const ev = sim.events.find(e => /rolling/.test(e.label)); const last = sim.frames[sim.frames.length - 1]; return { t_roll: ev ? ev.t : (sim.frames[0].flags.rolling ? 0 : NaN), v_final: last.flags.rolling ? last.qd[0] : NaN }; },
  });
})();
