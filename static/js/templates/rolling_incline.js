/* Rolling without slipping down an incline — Morin 8.4 (and the classic race of shapes).
   DOF: s = distance rolled along the incline (down = +). a = g sinθ / (1+β), f = β m a (up the slope),
   rolling requires μ ≥ β tanθ /(1+β). If μ is too small the body slips: a = g(sinθ − μ cosθ), α = μ g cosθ/(βR). */
(function () {
  const K = window.Kinema;
  const beta = p => p.shape === 'custom' ? p.beta : ({ solid_cylinder: 0.5, solid_sphere: 0.4, hoop: 1.0, spherical_shell: 2 / 3 })[p.shape];
  const th = p => K.rad(p.angle);
  const slips = p => p.mu < beta(p) * Math.tan(th(p)) / (1 + beta(p)) * (1 - 1e-3);   // a μ quoted AT the minimum still rolls
  const accel = p => slips(p) ? p.g * (Math.sin(th(p)) - p.mu * Math.cos(th(p))) : p.g * Math.sin(th(p)) / (1 + beta(p));
  const alphaSlip = p => p.mu * p.g * Math.cos(th(p)) / (beta(p) * p.radius);   // angular accel while slipping (kinetic friction)

  K.template('rolling_incline', {
    duration(p) { const a = Math.max(1e-6, accel(p)); return Math.min(30, Math.sqrt(2 * p.length / a) + 0.6); },
    init() { return { q: [0, 0], qd: [0, 0], flags: {} }; },      // q = [s (along slope), φ (rotation, +ve = rolling downhill)]
    accel(p, q, qd) {
      if (q[0] >= p.length) return [0, 0];
      const a = accel(p);
      return slips(p) ? [a, alphaSlip(p)] : [a, a / p.radius];
    },
    transition(p, s) {
      if (s.q[0] >= p.length && !s.flags.done) return { flags: { ...s.flags, done: true, stop: true }, event: 'reached the bottom' };
      return null;
    },
    bounds(p) { const L = p.length, h = L * Math.sin(th(p)); return { xmin: -0.6 * p.radius - 0.2, xmax: L * Math.cos(th(p)) + 3 * p.radius + 0.3, ymin: -0.5, ymax: h + 2.5 * p.radius + 0.3 }; },
    // world: incline from top-left (0, h) down to (Lcosθ, 0); the body centre sits R above the surface
    centre(p, s) {
      const t = th(p), L = p.length, h = L * Math.sin(t), d = Math.min(s.q[0], L);
      const sx = d * Math.cos(t), sy = h - d * Math.sin(t);        // contact point
      return [sx + p.radius * Math.sin(t), sy + p.radius * Math.cos(t), sx, sy];   // centre = contact + R * outward normal (sin t, cos t)
    },
    render(g, p, s, ov, hl) {
      const t = th(p), L = p.length, h = L * Math.sin(t);
      g.ground([[0, h], [L * Math.cos(t), 0], [L * Math.cos(t) + 3 * p.radius, 0], [L * Math.cos(t) + 3 * p.radius, -0.4], [-0.2, -0.4], [-0.2, h]]);
      g.angleArc(L * Math.cos(t), 0, Math.min(0.6, L * 0.18), Math.PI - t, Math.PI, '#9B9CA3', 'θ');
      const [cx, cy, sx, sy] = this.centre(p, s);
      const fill = p.shape === 'hoop' ? null : 'rgba(86,134,254,.18)';
      g.circle(cx, cy, p.radius, { fill, stroke: '#9DB8FF', width: 2.5 });
      if (p.shape === 'spherical_shell' || p.shape === 'hoop') g.circle(cx, cy, p.radius * 0.86, { stroke: 'rgba(157,184,255,.5)', width: 1 });
      g.spokes(cx, cy, p.radius, -s.q[1], 4);
      g.dot(cx, cy, 3, '#F9FAFB');
      if (ov.labels !== false) g.text(`${K.fmt(s.q[0], 2)} m`, cx, cy + p.radius + 0.15, { color: '#9B9CA3', dyPx: -6, size: 12 });
      if (ov.trail) g.line(p.radius * Math.sin(t), h + p.radius * Math.cos(t), cx, cy, 'rgba(86,134,254,.35)', 1.5, [3, 4]);
      if (s.flags.done) g.text('bottom', L * Math.cos(t), 0, { color: '#4ADE80', dyPx: 14, size: 12 });
    },
    fbd(p, s) {
      const t = th(p), b = beta(p), a = accel(p), m = p.mass;
      const [cx, cy, sx, sy] = this.centre(p, s);
      const N = m * p.g * Math.cos(t);
      const f = slips(p) ? p.mu * N : b * m * a;                   // static friction needed to roll (up the slope)
      return [
        { at: [cx, cy], vec: [0, -m * p.g], label: 'mg', key: 'mg' },
        { at: [sx, sy], vec: [N * Math.sin(t), N * Math.cos(t)], label: 'N', key: 'N' },
        { at: [sx, sy], vec: [-f * Math.cos(t), f * Math.sin(t)], label: slips(p) ? 'f (kinetic)' : 'f (static)', key: 'friction' },
      ];
    },
    vectors(p, s) {
      const t = th(p); const [cx, cy] = this.centre(p, s);
      return [
        { at: [cx, cy], vec: [s.qd[0] * Math.cos(t), -s.qd[0] * Math.sin(t)], label: 'v', key: 'v' },
        { at: [cx, cy], kind: 'omega', omega: -s.qd[1], r: p.radius, label: 'ω', key: 'omega' },
      ];
    },
    quantities(p, s) {
      const b = beta(p), m = p.mass, R = p.radius, v = s.qd[0], w = s.qd[1];
      const keT = 0.5 * m * v * v, keR = 0.5 * b * m * R * R * w * w;
      const [cx, cy] = this.centre(p, s);
      return [
        { key: 's', label: 'distance s', value: s.q[0], unit: 'm', graph: true },
        { key: 'v', label: 'speed v', value: v, unit: 'm/s', graph: true },
        { key: 'omega', label: 'ω', value: w, unit: 'rad/s', graph: true },
        { key: 'a', label: 'a', value: s.flags.done ? 0 : accel(p), unit: 'm/s²' },
        { key: 'friction', label: slips(p) ? 'kinetic friction' : 'static friction', value: slips(p) ? p.mu * m * p.g * Math.cos(th(p)) : b * m * accel(p), unit: 'N' },
        { key: 'L', label: 'L about centre', value: b * m * R * R * w, unit: 'kg·m²/s' },
        { key: 'ke_rot_fraction', label: 'rotational share of KE', value: (keT + keR) > 0 ? keR / (keT + keR) : b / (1 + b), unit: '' },
        { key: 'slip', label: 'slipping?', value: slips(p) ? 1 : 0, unit: '' },
      ];
    },
    energy(p, s) {
      const b = beta(p), m = p.mass, R = p.radius, v = s.qd[0], w = s.qd[1];
      const [cx, cy] = this.centre(p, s);
      return [
        { label: 'KE trans', value: 0.5 * m * v * v, color: '#5686FE' },
        { label: 'KE rot', value: 0.5 * b * m * R * R * w * w, color: '#A78BFA' },
        { label: 'PE', value: m * p.g * (cy - p.radius * Math.cos(th(p))), color: '#4ADE80' },
      ];
    },
    answers(p) {
      const b = beta(p), a = accel(p), t = th(p);
      const time = Math.sqrt(2 * p.length / a), v = a * time;
      return {
        acceleration: a, time_to_bottom: time, v_bottom: v, omega_bottom: slips(p) ? alphaSlip(p) * time : v / p.radius,
        friction_force: slips(p) ? p.mu * p.mass * p.g * Math.cos(t) : b * p.mass * a,
        ke_rot_fraction: slips(p) ? NaN : b / (1 + b), min_mu: b * Math.tan(t) / (1 + b),
      };
    },
    measure(p, sim) {
      const last = sim.frames[sim.frames.length - 1];
      return { time_to_bottom: last.t, v_bottom: last.qd[0], omega_bottom: last.qd[1] };
    },
  });
})();
