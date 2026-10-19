/* Rod pivoted at one end, released from rest at angle θ₀ above horizontal — Morin 8.4.
   θ measured from the +x axis (CCW +), pivot at the origin, rod swings down through −90°.
   I = mL²/3 about the pivot;  α = −(3g/2L) cosθ;  ω² = (3g/L)(sinθ₀ − sinθ).
   The point beyond 2L/3 accelerates faster than g when released horizontally (tip a = 3g/2). */
(function () {
  const K = window.Kinema;
  K.template('falling_rod', {
    duration(p) { return Math.min(20, 2.2 * Math.PI * Math.sqrt(2 * p.length / (3 * p.g))); },   // a couple of swings
    init(p) { return { q: [K.rad(p.theta0)], qd: [0], flags: {} }; },
    accel(p, q) { return [-(3 * p.g / (2 * p.length)) * Math.cos(q[0])]; },
    bounds(p) { const L = p.length; return { xmin: -L - 0.3, xmax: L + 0.3, ymin: -L - 0.3, ymax: L * Math.max(0.3, Math.sin(K.rad(Math.max(p.theta0, 0)))) + 0.5 }; },
    tip(p, s) { return [p.length * Math.cos(s.q[0]), p.length * Math.sin(s.q[0])]; },
    cm(p, s) { return [p.length / 2 * Math.cos(s.q[0]), p.length / 2 * Math.sin(s.q[0])]; },
    render(g, p, s, ov, hl) {
      const L = p.length, th = s.q[0];
      g.line(-0.35, 0, 0.35, 0, '#6C6D75', 3);                          // wall stub
      if (ov.trail) { const pts = []; for (let a = K.rad(p.theta0); a >= th - 1e-9; a -= 0.05) pts.push([L * Math.cos(a), L * Math.sin(a)]); g.trail(pts); }
      const [tx, ty] = this.tip(p, s);
      g.line(0, 0, tx, ty, '#9DB8FF', 7);
      const [cx, cy] = this.cm(p, s);
      g.dot(cx, cy, 5, '#F9FAFB');
      g.circle(0, 0, 0.04 * L + 0.02, { fill: '#151517', stroke: '#9B9CA3', width: 2 });
      if (ov.labels !== false) { g.text('CM', cx, cy, { color: '#9B9CA3', dyPx: 16, size: 12 }); g.text(`θ = ${K.fmt(K.deg(th), 1)}°`, 0, 0, { color: '#9B9CA3', dxPx: 10, dyPx: -18, size: 12, align: 'left' }); }
      const pt = 2 * L / 3; g.dot(pt * Math.cos(th), pt * Math.sin(th), 3, '#F5B95F'); if (ov.labels !== false) g.text('2L/3', pt * Math.cos(th), pt * Math.sin(th), { color: '#F5B95F', dyPx: -14, size: 11 });
    },
    fbd(p, s) {
      const L = p.length, m = p.mass, th = s.q[0], w = s.qd[0], al = -(3 * p.g / (2 * L)) * Math.cos(th);
      // CM acceleration: a = α × r − ω² r  with r = (L/2)(cosθ, sinθ)
      const rx = L / 2 * Math.cos(th), ry = L / 2 * Math.sin(th);
      const ax = -al * ry - w * w * rx, ay = al * rx - w * w * ry;
      const Fx = m * ax, Fy = m * ay + m * p.g;                          // pivot force = m a − m g(vec)
      const [cx, cy] = this.cm(p, s);
      return [
        { at: [cx, cy], vec: [0, -m * p.g], label: 'mg', key: 'mg' },
        { at: [0, 0], vec: [Fx, Fy], label: 'F pivot', key: 'pivot', color: '#4ADE80' },
      ];
    },
    vectors(p, s) {
      const [tx, ty] = this.tip(p, s), w = s.qd[0], L = p.length;
      return [
        { at: [tx, ty], vec: [-w * ty, w * tx], label: 'v tip', key: 'v' },
        { at: [0, 0], kind: 'omega', omega: w, r: 0.25 * L, label: 'ω', key: 'omega' },
      ];
    },
    quantities(p, s) {
      const L = p.length, m = p.mass, th = s.q[0], w = s.qd[0], I = m * L * L / 3;
      const al = -(3 * p.g / (2 * L)) * Math.cos(th);
      return [
        { key: 'theta', label: 'θ', value: K.deg(th), unit: '°', graph: true },
        { key: 'omega', label: 'ω', value: w, unit: 'rad/s', graph: true },
        { key: 'alpha', label: 'α', value: al, unit: 'rad/s²', graph: true },
        { key: 'torque', label: 'τ about pivot', value: I * al, unit: 'N·m' },
        { key: 'L', label: 'L about pivot', value: I * w, unit: 'kg·m²/s' },
        { key: 'a_tip', label: 'tip acceleration', value: Math.hypot(al * L, w * w * L), unit: 'm/s²' },
      ];
    },
    energy(p, s) {
      const L = p.length, m = p.mass, w = s.qd[0], I = m * L * L / 3, [cx, cy] = this.cm(p, s);
      return [{ label: 'KE rot', value: 0.5 * I * w * w, color: '#A78BFA' }, { label: 'PE (from bottom)', value: m * p.g * (cy + L / 2), color: '#4ADE80' }];
    },
    answers(p) {
      const L = p.length, m = p.mass, th0 = K.rad(p.theta0);
      const wb = Math.sqrt(Math.max(0, 3 * p.g / L * (Math.sin(th0) + 1)));           // at θ = −90°
      const al0 = (3 * p.g / (2 * L)) * Math.cos(th0);
      return {
        alpha_release: al0, omega_bottom: wb, tip_speed_bottom: wb * L,
        pivot_force_bottom: m * p.g + m * wb * wb * L / 2,                                 // straight down: F − mg = m ω² L/2
        a_tip_release: al0 * L, free_fall_point: 2 * L / 3,
      };
    },
    measure(p, sim) {
      let wmax = 0; for (const f of sim.frames) wmax = Math.max(wmax, Math.abs(f.qd[0]));
      return { omega_bottom: wmax, tip_speed_bottom: wmax * p.length };
    },
  });
})();
