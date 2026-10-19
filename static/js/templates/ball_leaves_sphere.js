/* Ball rolling off a fixed sphere — Morin ch. 8 problems ("leaving the sphere").
   Ball (radius r, I = β m r²) on a sphere (radius R); its centre moves on ρ = R + r. θ from the top.
   Rolling: ρ θ'' = g sinθ / (1+β).  N = m g cosθ − m v²/ρ, with v² = v₀² + 2 g ρ (1−cosθ)/(1+β).
   From rest (v₀→0) it leaves at cosθ = 2/(3+β): 2/3 for a point mass, 10/17 for a solid ball. */
(function () {
  const K = window.Kinema;
  const rho = p => p.R + p.r;
  K.template('ball_leaves_sphere', {
    duration(p) { return 6; },
    init(p) { return { q: [0.0, 0], qd: [p.nudge / rho(p), 0], flags: { mode: 'roll' } }; },     // roll: q=[θ, spin] ; fly: q=[x, y]
    accel(p, q, qd, t, flags) {
      if (flags.mode === 'fly') return [0, -p.g];
      const a_t = p.g * Math.sin(q[0]) / (1 + p.beta);                       // tangential accel of the centre
      return [a_t / rho(p), a_t / p.r];                                       // θ'' , spin''
    },
    transition(p, s) {
      if (s.flags.mode === 'fly') { if (s.q[1] - p.r <= 0 && !s.flags.stop) return { flags: { ...s.flags, stop: true }, event: 'lands' }; return null; }
      const th = s.q[0], v = s.qd[0] * rho(p);
      const N = p.g * Math.cos(th) - v * v / rho(p);
      if (N <= 0 && th > 0.01) {
        const x = rho(p) * Math.sin(th), y = p.R + rho(p) * Math.cos(th);
        return { q: [x, y], qd: [v * Math.cos(th), -v * Math.sin(th)], flags: { mode: 'fly', theta_leave: th, v_leave: v, spin: s.qd[1] }, event: 'leaves the sphere' };
      }
      return null;
    },
    bounds(p) { const R = p.R; return { xmin: -R - 0.3, xmax: 2.6 * R + 0.5, ymin: -0.2, ymax: 2 * R + 2 * p.r + 0.4 }; },
    centre(p, s) { if (s.flags.mode === 'fly') return [s.q[0], s.q[1]]; return [rho(p) * Math.sin(s.q[0]), p.R + rho(p) * Math.cos(s.q[0])]; },
    render(g, p, s, ov, hl) {
      const R = p.R; g.line(-R - 0.3, 0, 3 * R + 0.5, 0, '#6C6D75', 2);
      g.circle(0, R, R, { fill: 'rgba(255,255,255,.04)', stroke: '#9B9CA3', width: 2 });
      const [cx, cy] = this.centre(p, s);
      if (ov.trail) { const pts = []; const th1 = s.flags.mode === 'fly' ? s.flags.theta_leave : s.q[0]; for (let a = 0; a <= th1; a += 0.04) pts.push([rho(p) * Math.sin(a), R + rho(p) * Math.cos(a)]); g.trail(pts); }
      g.circle(cx, cy, p.r, { fill: 'rgba(86,134,254,.2)', stroke: '#9DB8FF', width: 2 });
      const spin = s.flags.mode === 'fly' ? s.flags.spin * (s.t) : s.q[1]; g.spokes(cx, cy, p.r, -spin, 4);
      const th = s.flags.mode === 'fly' ? s.flags.theta_leave : s.q[0];
      if (ov.labels !== false) { g.line(0, R, 0, 2 * R + 0.1, '#6C6D75', 1, [4, 4]); g.angleArc(0, R, R * 0.45, Math.PI / 2 - th, Math.PI / 2, '#9B9CA3', 'θ'); g.text(s.flags.mode === 'fly' ? 'in flight' : 'rolling on the sphere', cx, cy + p.r + 0.05, { color: s.flags.mode === 'fly' ? '#F5B95F' : '#9B9CA3', dyPx: -12, size: 12 }); }
    },
    fbd(p, s) {
      const [cx, cy] = this.centre(p, s), m = 1;    // shown per unit mass
      if (s.flags.mode === 'fly') return [{ at: [cx, cy], vec: [0, -p.g], label: 'g (per kg)', key: 'mg' }];
      const th = s.q[0], v = s.qd[0] * rho(p), N = Math.max(0, p.g * Math.cos(th) - v * v / rho(p));
      const f = p.beta * p.g * Math.sin(th) / (1 + p.beta);
      return [{ at: [cx, cy], vec: [0, -p.g], label: 'g (per kg)', key: 'mg' }, { at: [cx - p.r * Math.sin(th), cy - p.r * Math.cos(th)], vec: [N * Math.sin(th), N * Math.cos(th)], label: 'N', key: 'N' }, { at: [cx - p.r * Math.sin(th), cy - p.r * Math.cos(th)], vec: [-f * Math.cos(th), f * Math.sin(th)], label: 'f', key: 'friction' }];
    },
    vectors(p, s) { const [cx, cy] = this.centre(p, s); if (s.flags.mode === 'fly') return [{ at: [cx, cy], vec: [s.qd[0], s.qd[1]], label: 'v', key: 'v' }]; const th = s.q[0], v = s.qd[0] * rho(p); return [{ at: [cx, cy], vec: [v * Math.cos(th), -v * Math.sin(th)], label: 'v', key: 'v' }, { at: [cx, cy], kind: 'omega', omega: -s.qd[1], r: p.r, label: 'ω', key: 'omega' }]; },
    quantities(p, s) {
      const th = s.flags.mode === 'fly' ? s.flags.theta_leave : s.q[0], v = s.flags.mode === 'fly' ? Math.hypot(s.qd[0], s.qd[1]) : s.qd[0] * rho(p);
      const N = s.flags.mode === 'fly' ? 0 : Math.max(0, p.g * Math.cos(th) - v * v / rho(p));
      return [
        { key: 'theta', label: 'θ from top', value: K.deg(th), unit: '°', graph: true },
        { key: 'v', label: 'speed', value: v, unit: 'm/s', graph: true },
        { key: 'N', label: 'N (per kg)', value: N, unit: 'N/kg', graph: true },
        { key: 'cos', label: 'cosθ', value: Math.cos(th), unit: '' },
      ];
    },
    energy(p, s) { const [cx, cy] = this.centre(p, s); const v = s.flags.mode === 'fly' ? Math.hypot(s.qd[0], s.qd[1]) : s.qd[0] * rho(p); const rot = s.flags.mode === 'fly' ? 0.5 * p.beta * (s.flags.v_leave) ** 2 : 0.5 * p.beta * v * v; return [{ label: 'KE trans (per kg)', value: 0.5 * v * v, color: '#5686FE' }, { label: 'KE rot (per kg)', value: rot, color: '#A78BFA' }, { label: 'PE (per kg, from ground)', value: p.g * cy, color: '#4ADE80' }]; },
    answers(p) {
      const b = p.beta, k = p.nudge * p.nudge / (p.g * rho(p));
      const c = (2 / (1 + b) - k) / (1 + 2 / (1 + b));                     // cosθ at N = 0 including the nudge
      const c0 = 2 / (3 + b);
      const th = Math.acos(K.clamp(c, -1, 1));
      const v2 = p.nudge * p.nudge + 2 * p.g * rho(p) * (1 - c) / (1 + b);
      return { cos_theta_leave: c0, theta_leave: K.deg(Math.acos(c0)), v_leave: Math.sqrt(Math.max(0, v2)), height_leave: p.R + rho(p) * c, cos_theta_leave_with_nudge: c };
    },
    measure(p, sim) { const ev = sim.events.find(e => /leaves/.test(e.label)); if (!ev) return {}; const f = K.frameAt(sim, ev.t); return { theta_leave: K.deg(f.flags.theta_leave), cos_theta_leave: Math.cos(f.flags.theta_leave), v_leave: f.flags.v_leave, height_leave: f.q[1] }; },
  });
})();
