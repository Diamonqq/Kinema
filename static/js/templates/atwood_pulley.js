/* Atwood machine with a massive pulley — Morin 8.4. DOF: y = how far m1 has dropped.
   a = (m1 − m2) g / (m1 + m2 + β M_p),  T1 = m1 (g − a),  T2 = m2 (g + a),  α = a/R,  τ = (T1 − T2) R = I α. */
(function () {
  const K = window.Kinema;
  const Ieff = p => p.pulley_beta * p.pulley_mass;
  const accel = p => (p.m1 - p.m2) * p.g / (p.m1 + p.m2 + Ieff(p));
  K.template('atwood_pulley', {
    duration(p) { const a = Math.abs(accel(p)); return a < 1e-9 ? 4 : Math.min(30, Math.sqrt(2 * p.drop / a) + 0.5); },
    init() { return { q: [0, 0], qd: [0, 0], flags: {} }; },          // q = [y1 dropped (down +), pulley angle]
    accel(p, q) { if (Math.abs(q[0]) >= p.drop) return [0, 0]; const a = accel(p); return [a, a / p.radius]; },
    transition(p, s) { if (Math.abs(s.q[0]) >= p.drop && !s.flags.done) return { flags: { ...s.flags, done: true, stop: true }, event: 'm₁ reaches the floor' }; return null; },
    bounds(p) { const H = p.drop + 1.2 + 6 * p.radius; return { xmin: -3 * p.radius - 0.8, xmax: 3 * p.radius + 0.8, ymin: -0.2, ymax: H }; },
    geom(p, s) {
      const R = p.radius, top = p.drop + 1.2 + 4 * R, y1 = top - 3 * R - s.q[0], y2 = top - 3 * R - p.drop + s.q[0];
      return { R, top, x1: -R, x2: R, y1, y2 };
    },
    render(g, p, s, ov, hl) {
      const { R, top, x1, x2, y1, y2 } = this.geom(p, s);
      g.line(-0.4, top + R + 0.15, 0.4, top + R + 0.15, '#6C6D75', 3);
      g.line(0, top + R + 0.15, 0, top, '#6C6D75', 2);
      g.circle(0, top, R, { fill: 'rgba(255,255,255,.06)', stroke: '#9B9CA3', width: 2.5 });
      g.spokes(0, top, R, s.q[1], 6, 'rgba(255,255,255,.3)');
      g.dot(0, top, 4, '#9B9CA3');
      g.line(x1, top, x1, y1 + 0.25, '#E6E7EA', 1.5);
      g.line(x2, top, x2, y2 + 0.25, '#E6E7EA', 1.5);
      const box = (x, y, m, label) => { const w = 0.35 + 0.05 * Math.sqrt(m), h = 0.45; g.poly([[x - w / 2, y + 0.25], [x + w / 2, y + 0.25], [x + w / 2, y + 0.25 - h], [x - w / 2, y + 0.25 - h]], { fill: 'rgba(86,134,254,.18)', stroke: '#9DB8FF' }); g.text(label, x, y + 0.02, { bold: true }); };
      box(x1, y1, p.m1, 'm₁'); box(x2, y2, p.m2, 'm₂');
      g.line(-3 * R - 0.6, -0.05, 3 * R + 0.6, -0.05, '#6C6D75', 2);
      if (ov.labels !== false) g.text(`${K.fmt(s.q[0], 2)} m`, x1 - 0.55, y1, { color: '#9B9CA3', size: 12 });
    },
    fbd(p, s) {
      const a = accel(p), T1 = p.m1 * (p.g - a), T2 = p.m2 * (p.g + a);
      const { top, x1, x2, y1, y2 } = this.geom(p, s);
      return [
        { at: [x1, y1], vec: [0, -p.m1 * p.g], label: 'm₁g', key: 'mg' },
        { at: [x1, y1 + 0.25], vec: [0, T1], label: 'T₁', key: 'T1', color: '#F5B95F' },
        { at: [x2, y2], vec: [0, -p.m2 * p.g], label: 'm₂g', key: 'mg' },
        { at: [x2, y2 + 0.25], vec: [0, T2], label: 'T₂', key: 'T2', color: '#FBBF24' },
      ];
    },
    vectors(p, s) {
      const { top, x1, x2, y1, y2 } = this.geom(p, s);
      return [
        { at: [x1, y1 - 0.3], vec: [0, -s.qd[0]], label: 'v', key: 'v' },
        { at: [x2, y2 - 0.3], vec: [0, s.qd[0]], label: 'v', key: 'v' },
        { at: [0, top], kind: 'omega', omega: s.qd[1], r: p.radius, label: 'ω', key: 'omega' },
      ];
    },
    quantities(p, s) {
      const a = accel(p), I = Ieff(p) * p.radius * p.radius;
      return [
        { key: 'y', label: 'm₁ dropped', value: s.q[0], unit: 'm', graph: true },
        { key: 'v', label: 'speed', value: s.qd[0], unit: 'm/s', graph: true },
        { key: 'omega', label: 'ω pulley', value: s.qd[1], unit: 'rad/s', graph: true },
        { key: 'a', label: 'a', value: s.flags.done ? 0 : a, unit: 'm/s²' },
        { key: 'T1', label: 'T₁', value: p.m1 * (p.g - a), unit: 'N' },
        { key: 'T2', label: 'T₂', value: p.m2 * (p.g + a), unit: 'N' },
        { key: 'torque', label: 'τ on pulley', value: (p.m1 * (p.g - a) - p.m2 * (p.g + a)) * p.radius, unit: 'N·m' },
        { key: 'L', label: 'L pulley', value: I * s.qd[1], unit: 'kg·m²/s' },
      ];
    },
    energy(p, s) {
      const I = Ieff(p) * p.radius * p.radius, v = s.qd[0];
      return [
        { label: 'KE masses', value: 0.5 * (p.m1 + p.m2) * v * v, color: '#5686FE' },
        { label: 'KE pulley', value: 0.5 * I * s.qd[1] * s.qd[1], color: '#A78BFA' },
        { label: 'PE (lost by m₁ − gained by m₂)', value: (p.m1 - p.m2) * p.g * (p.drop - s.q[0]), color: '#4ADE80' },
      ];
    },
    answers(p) {
      const a = accel(p), t = a > 0 ? Math.sqrt(2 * p.drop / a) : NaN;
      return { acceleration: a, T1: p.m1 * (p.g - a), T2: p.m2 * (p.g + a), alpha: a / p.radius, time_to_drop: t, v_after_drop: a * t };
    },
    measure(p, sim) { const last = sim.frames[sim.frames.length - 1]; return { time_to_drop: last.t, v_after_drop: last.qd[0] }; },
  });
})();
