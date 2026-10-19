/* Spool / yo-yo on a rough floor pulled by its string at angle φ — Morin 8.4 ("which way does it roll").
   String wound on inner radius r, spool outer radius R, I = β m R². Rolling without slipping (x = distance
   the centre moves toward the pull, +):  a = T (R cosφ − r) / (m R (1+β)).  Friction f = T cosφ − m a (backward when +).
   Rolls toward the pull when cosφ > r/R, away when cosφ < r/R; the string is pulled from the BOTTOM of the inner drum. */
(function () {
  const K = window.Kinema;
  const ph = p => K.rad(p.phi);
  const accel = p => p.tension * (p.R * Math.cos(ph(p)) - p.r) / (p.mass * p.R * (1 + p.beta));
  const friction = p => p.tension * Math.cos(ph(p)) - p.mass * accel(p);     // +ve = points toward the pull
  const lifts = p => p.tension * Math.sin(ph(p)) >= p.mass * p.g;
  K.template('spool_pull', {
    duration() { return 4; },
    init() { return { q: [0, 0], qd: [0, 0], flags: {} }; },                  // q = [x, φ_spin]
    accel(p) { if (lifts(p)) return [0, 0]; const a = accel(p); return [a, -a / p.R]; },
    bounds(p) { const R = p.R, a = accel(p), xr = 0.5 * a * 16; return { xmin: Math.min(-0.6, xr - R) - 0.5, xmax: Math.max(0.6, xr + R) + 2.2, ymin: -0.15, ymax: 2 * R + 1.6 }; },
    render(g, p, s, ov, hl) {
      const R = p.R, r = p.r, x = s.q[0];
      g.line(-100, 0, 100, 0, '#6C6D75', 2);
      g.circle(x, R, R, { fill: 'rgba(86,134,254,.12)', stroke: '#9DB8FF', width: 2.5 });
      g.circle(x, R, r, { fill: 'rgba(86,134,254,.2)', stroke: '#9DB8FF', width: 1.5 });
      g.spokes(x, R, R, s.q[1], 4, 'rgba(157,184,255,.5)');
      g.dot(x, R, 3, '#F9FAFB');
      // string leaves the inner drum tangentially, from the bottom, at angle φ
      const a = ph(p), tx = x + r * Math.sin(a), ty = R - r * Math.cos(a);
      const L = 1.6; g.line(tx, ty, tx + L * Math.cos(a), ty + L * Math.sin(a), '#F5B95F', 2);
      g.arrow(tx + L * Math.cos(a), ty + L * Math.sin(a), Math.cos(a), Math.sin(a), '#F5B95F', { lenPx: 34, width: 3, label: 'T' });
      if (ov.labels !== false) { g.angleArc(tx, ty, 0.35, 0, a, '#9B9CA3', 'φ'); g.text(lifts(p) ? 'T sinφ ≥ mg — it lifts off' : (accel(p) > 0 ? '→ rolls toward the pull' : accel(p) < 0 ? '← rolls away (winds up)' : 'critical angle — no motion'), x, 2 * R + 0.35, { color: accel(p) > 0 ? '#4ADE80' : '#F5B95F', size: 12 }); }
    },
    fbd(p, s) {
      const R = p.R, r = p.r, x = s.q[0], a = ph(p), f = friction(p);
      const N = p.mass * p.g - p.tension * Math.sin(a);
      return [
        { at: [x, R], vec: [0, -p.mass * p.g], label: 'mg', key: 'mg' },
        { at: [x, 0], vec: [0, Math.max(0, N)], label: 'N', key: 'N' },
        { at: [x + r * Math.sin(a), R - r * Math.cos(a)], vec: [p.tension * Math.cos(a), p.tension * Math.sin(a)], label: 'T', key: 'T', color: '#F5B95F' },
        { at: [x, 0], vec: [-f, 0], label: 'f', key: 'friction', color: '#FB923C' },
      ];
    },
    vectors(p, s) { return [{ at: [s.q[0], p.R], vec: [s.qd[0], 0], label: 'v', key: 'v' }, { at: [s.q[0], p.R], kind: 'omega', omega: s.qd[1], r: p.R, label: 'ω', key: 'omega' }]; },
    quantities(p, s) {
      return [
        { key: 'x', label: 'x (toward the pull)', value: s.q[0], unit: 'm', graph: true },
        { key: 'v', label: 'v', value: s.qd[0], unit: 'm/s', graph: true },
        { key: 'a', label: 'a', value: lifts(p) ? 0 : accel(p), unit: 'm/s²' },
        { key: 'friction', label: 'friction (toward pull +)', value: friction(p), unit: 'N' },
        { key: 'torque', label: 'net torque about contact point', value: p.tension * (p.R * Math.cos(ph(p)) - p.r), unit: 'N·m' },
        { key: 'critical', label: 'critical angle (cosφ = r/R)', value: K.deg(Math.acos(K.clamp(p.r / p.R, -1, 1))), unit: '°' },
      ];
    },
    energy(p, s) { const v = s.qd[0]; return [{ label: 'KE trans', value: 0.5 * p.mass * v * v, color: '#5686FE' }, { label: 'KE rot', value: 0.5 * p.beta * p.mass * p.R * p.R * s.qd[1] * s.qd[1], color: '#A78BFA' }]; },
    answers(p) { const a = accel(p); return { acceleration: a, friction_force: friction(p), critical_angle: K.deg(Math.acos(K.clamp(p.r / p.R, -1, 1))), direction: a > 0 ? 1 : a < 0 ? -1 : 0 }; },
    measure(p, sim) { const last = sim.frames[sim.frames.length - 1]; return { acceleration: last.t > 0 ? 2 * last.q[0] / (last.t * last.t) : NaN }; },
  });
})();
