/* Physical pendulum — Morin 8.4. θ from the downward vertical (CCW +), pivot at the origin.
   θ'' = −(m g d / I) sinθ;  T_small = 2π √(I/(m g d));  equivalent simple-pendulum length l = I/(m d). */
(function () {
  const K = window.Kinema;
  function body(p) {
    if (p.body === 'rod_end') return { I: p.mass * p.size * p.size / 3, d: p.size / 2, kind: 'rod', L: p.size };
    if (p.body === 'rod_custom') return { I: p.mass * p.size * p.size / 12 + p.mass * p.d * p.d, d: p.d, kind: 'rod', L: p.size };
    if (p.body === 'disk_rim') return { I: 1.5 * p.mass * p.size * p.size, d: p.size, kind: 'disk', R: p.size };
    return { I: p.I_pivot, d: p.d, kind: 'custom' };
  }
  const period = p => { const b = body(p); return 2 * Math.PI * Math.sqrt(b.I / (p.mass * p.g * b.d)); };
  K.template('physical_pendulum', {
    duration(p) { return Math.min(30, 2.5 * period(p)); },
    init(p) { return { q: [K.rad(p.theta0)], qd: [0], flags: {} }; },
    accel(p, q) { const b = body(p); return [-(p.mass * p.g * b.d / b.I) * Math.sin(q[0])]; },
    bounds(p) { const b = body(p), ext = b.kind === 'rod' ? Math.max(b.L - b.d, b.d) + b.L / 2 : b.kind === 'disk' ? 2 * b.R : b.d * 1.4; return { xmin: -ext - 0.2, xmax: ext + 0.2, ymin: -ext - 0.2, ymax: 0.4 }; },
    cm(p, s) { const b = body(p); return [b.d * Math.sin(s.q[0]), -b.d * Math.cos(s.q[0])]; },
    render(g, p, s, ov, hl) {
      const b = body(p), th = s.q[0], ux = Math.sin(th), uy = -Math.cos(th);
      g.line(-0.3, 0, 0.3, 0, '#6C6D75', 3);
      if (b.kind === 'rod') { const top = -(b.L / 2 - b.d), bot = b.d + b.L / 2; g.line(top * ux, top * uy, bot * ux, bot * uy, '#9DB8FF', 7); }
      else if (b.kind === 'disk') { g.circle(b.R * ux, b.R * uy, b.R, { fill: 'rgba(86,134,254,.18)', stroke: '#9DB8FF', width: 2.5 }); g.spokes(b.R * ux, b.R * uy, b.R, th + Math.PI / 2, 4); }
      else { g.line(0, 0, b.d * ux, b.d * uy, '#9DB8FF', 4); g.circle(b.d * ux, b.d * uy, 0.12, { fill: 'rgba(86,134,254,.18)', stroke: '#9DB8FF' }); }
      const [cx, cy] = this.cm(p, s); g.dot(cx, cy, 5, '#F9FAFB');
      g.circle(0, 0, 0.03, { fill: '#151517', stroke: '#9B9CA3', width: 2 });
      g.line(0, 0, 0, -b.d * 1.15, '#6C6D75', 1, [4, 4]);
      if (ov.labels !== false) { g.angleArc(0, 0, b.d * 0.5, -Math.PI / 2, -Math.PI / 2 + th, '#9B9CA3', 'θ'); g.text('CM', cx, cy, { color: '#9B9CA3', dxPx: 18, size: 12 }); }
      if (ov.trail) { const pts = []; for (let a = -Math.abs(K.rad(p.theta0)); a <= Math.abs(K.rad(p.theta0)); a += 0.05) pts.push([b.d * Math.sin(a), -b.d * Math.cos(a)]); g.trail(pts); }
    },
    fbd(p, s) {
      const b = body(p), m = p.mass, th = s.q[0], w = s.qd[0], al = -(m * p.g * b.d / b.I) * Math.sin(th);
      const rx = b.d * Math.sin(th), ry = -b.d * Math.cos(th);
      const ax = -al * ry - w * w * rx, ay = al * rx - w * w * ry;
      return [{ at: [rx, ry], vec: [0, -m * p.g], label: 'mg', key: 'mg' }, { at: [0, 0], vec: [m * ax, m * ay + m * p.g], label: 'F pivot', key: 'pivot', color: '#4ADE80' }];
    },
    vectors(p, s) { const [cx, cy] = this.cm(p, s), w = s.qd[0]; return [{ at: [cx, cy], vec: [-w * cy, w * cx], label: 'v cm', key: 'v' }, { at: [0, 0], kind: 'omega', omega: w, r: 0.2, label: 'ω', key: 'omega' }]; },
    quantities(p, s) {
      const b = body(p), th = s.q[0], w = s.qd[0];
      return [
        { key: 'theta', label: 'θ', value: K.deg(th), unit: '°', graph: true },
        { key: 'omega', label: 'ω', value: w, unit: 'rad/s', graph: true },
        { key: 'torque', label: 'τ about pivot', value: -p.mass * p.g * b.d * Math.sin(th), unit: 'N·m', graph: true },
        { key: 'L', label: 'L about pivot', value: b.I * w, unit: 'kg·m²/s' },
        { key: 'T', label: 'small-angle period', value: period(p), unit: 's' },
        { key: 'I', label: 'I about pivot', value: b.I, unit: 'kg·m²' },
      ];
    },
    energy(p, s) { const b = body(p), w = s.qd[0]; return [{ label: 'KE', value: 0.5 * b.I * w * w, color: '#A78BFA' }, { label: 'PE', value: p.mass * p.g * b.d * (1 - Math.cos(s.q[0])), color: '#4ADE80' }]; },
    answers(p) { const b = body(p), th0 = K.rad(p.theta0); return { period_small: period(p), omega_bottom: Math.sqrt(2 * p.mass * p.g * b.d * (1 - Math.cos(th0)) / b.I), I_pivot: b.I, equivalent_length: b.I / (p.mass * b.d) }; },
    measure(p, sim) {
      let wmax = 0, t1 = null, t2 = null;            // period from the first two downward zero crossings of θ
      for (let i = 1; i < sim.frames.length; i++) { const a = sim.frames[i - 1], c = sim.frames[i]; wmax = Math.max(wmax, Math.abs(c.qd[0])); if (a.q[0] > 0 && c.q[0] <= 0) { if (t1 == null) t1 = c.t; else if (t2 == null) t2 = c.t; } }
      return { omega_bottom: wmax, period_measured: t1 != null && t2 != null ? t2 - t1 : NaN };
    },
  });
})();
