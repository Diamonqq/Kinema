/* A spinning disk dropped onto a coaxial disk — Morin 8.5. Friction between the faces is a constant
   torque that brings a common ω_f = (I₁ω₁ + I₂ω₂)/(I₁+I₂) after `coupling_time`; L about the axle is
   conserved, KE is not (the loss is friction heat). Closed form, top view. */
(function () {
  const K = window.Kinema;
  const wf = p => (p.I1 * p.omega1 + p.I2 * p.omega2) / (p.I1 + p.I2);
  K.template('disk_on_disk', {
    duration(p) { return p.coupling_time + 2.0; },
    stateAt(p, t) {
      const tc = p.coupling_time, f = wf(p), u = Math.min(1, t / tc);
      const w1 = p.omega1 + (f - p.omega1) * u, w2 = p.omega2 + (f - p.omega2) * u;
      const a1 = t < tc ? p.omega1 * t + 0.5 * (f - p.omega1) / tc * t * t : p.omega1 * tc + 0.5 * (f - p.omega1) * tc + f * (t - tc);
      const a2 = t < tc ? p.omega2 * t + 0.5 * (f - p.omega2) / tc * t * t : p.omega2 * tc + 0.5 * (f - p.omega2) * tc + f * (t - tc);
      return { t, q: [a1, a2], qd: [w1, w2], flags: { locked: t >= tc } };
    },
    bounds() { return { xmin: -1.3, xmax: 1.3, ymin: -1.1, ymax: 1.1 }; },
    render(g, p, s, ov, hl) {
      const r1 = 0.6, r2 = 0.95;
      g.circle(0, 0, r2, { fill: 'rgba(255,255,255,.05)', stroke: '#9B9CA3', width: 2.5 });
      g.spokes(0, 0, r2, s.q[1], 8, 'rgba(155,156,163,.45)');
      g.circle(0, 0, r1, { fill: 'rgba(86,134,254,.2)', stroke: '#9DB8FF', width: 2.5 });
      g.spokes(0, 0, r1, s.q[0], 4, 'rgba(157,184,255,.7)');
      g.dot(0, 0, 4, '#F9FAFB');
      if (ov.labels !== false) { g.text('I₁ (top)', 0, r1 + 0.02, { color: '#9DB8FF', dyPx: -12, size: 12 }); g.text('I₂ (bottom)', 0, -r2 - 0.02, { color: '#9B9CA3', dyPx: 14, size: 12 }); g.text(s.flags.locked ? 'locked together' : 'slipping — friction torque', 0, -1.05, { color: s.flags.locked ? '#4ADE80' : '#F5B95F', size: 12, dyPx: 6 }); }
    },
    fbd() { return []; },
    vectors(p, s) { return [{ at: [0, 0], kind: 'omega', omega: s.qd[0], r: 0.6, label: 'ω₁', key: 'omega' }, { at: [0, 0], kind: 'omega', omega: s.qd[1], r: 0.95, label: 'ω₂', key: 'omega2', color: '#9B9CA3' }]; },
    quantities(p, s) {
      const L = p.I1 * s.qd[0] + p.I2 * s.qd[1];
      return [
        { key: 'omega1', label: 'ω₁', value: s.qd[0], unit: 'rad/s', graph: true },
        { key: 'omega2', label: 'ω₂', value: s.qd[1], unit: 'rad/s', graph: true },
        { key: 'L', label: 'L total (conserved)', value: L, unit: 'kg·m²/s', graph: true },
        { key: 'torque', label: 'friction torque on top disk', value: s.flags.locked ? 0 : p.I1 * (wf(p) - p.omega1) / p.coupling_time, unit: 'N·m' },
        { key: 'KE', label: 'KE total', value: 0.5 * p.I1 * s.qd[0] ** 2 + 0.5 * p.I2 * s.qd[1] ** 2, unit: 'J', graph: true },
      ];
    },
    energy(p, s) { return [{ label: 'KE top', value: 0.5 * p.I1 * s.qd[0] ** 2, color: '#5686FE' }, { label: 'KE bottom', value: 0.5 * p.I2 * s.qd[1] ** 2, color: '#9B9CA3' }, { label: 'lost to friction', value: 0.5 * p.I1 * p.omega1 ** 2 + 0.5 * p.I2 * p.omega2 ** 2 - 0.5 * p.I1 * s.qd[0] ** 2 - 0.5 * p.I2 * s.qd[1] ** 2, color: '#F87171' }]; },
    answers(p) {
      const f = wf(p), ke0 = 0.5 * p.I1 * p.omega1 ** 2 + 0.5 * p.I2 * p.omega2 ** 2, ke1 = 0.5 * (p.I1 + p.I2) * f * f;
      return { omega_final: f, ke_lost: ke0 - ke1, ke_lost_fraction: ke0 > 0 ? (ke0 - ke1) / ke0 : 0, L_total: p.I1 * p.omega1 + p.I2 * p.omega2 };
    },
    measure(p, sim) { const last = sim.frames[sim.frames.length - 1]; return { omega_final: last.qd[0] }; },
  });
})();
