/* Ball hits a free stick on a frictionless table — Morin 8.5 (collisions).
   Stick (mass M, length L) lies along y, centre at the origin; ball (mass m) moves along +x at speed v
   and hits the stick at (0, d). Elastic: Δ = v − v' = 2v / (1 + m/M + m d²/I) with I = ML²/12,
   V = mΔ/M, ω = −m d Δ / I (clockwise for d > 0). Sticks: p and L about the combined CM are conserved. */
(function () {
  const K = window.Kinema;
  const D0 = p => Math.max(0.8, 0.6 * p.ball_speed);            // approach distance (s.t. the approach lasts ~0.6 s)
  const t0 = p => D0(p) / p.ball_speed;
  const after = 2.0;
  function outcome(p) {
    const m = p.ball_mass, M = p.stick_mass, L = p.stick_length, d = p.hit_offset, v = p.ball_speed, I = M * L * L / 12;
    if (p.collision === 'elastic') {
      const delta = 2 * v / (1 + m / M + m * d * d / I);
      return { vb: v - delta, V: m * delta / M, omega: -m * d * delta / I, yc: 0, Itot: I, stuck: false };
    }
    const yc = m * d / (m + M);                                     // combined CM (stick CM at 0)
    const Itot = I + M * yc * yc + m * (d - yc) * (d - yc);
    const V = m * v / (m + M);
    const omega = -(d - yc) * m * v / Itot;
    return { vb: V, V, omega, yc, Itot, stuck: true };
  }
  K.template('ball_stick', {
    duration(p) { return t0(p) + after; },
    stateAt(p, t) {
      const o = outcome(p), T = t0(p);
      if (t < T) return { t, q: [-D0(p) + p.ball_speed * t, 0, 0], qd: [p.ball_speed, 0, 0], flags: { hit: false } };
      const dt = t - T;
      if (o.stuck) {
        // the combined body: CM at (V dt, yc) rotating at ω; the stick's own centre orbits the combined CM
        const th = o.omega * dt;
        const X = o.V * dt - (-o.yc) * Math.sin(th) * 0 + (0 - 0);   // stick centre relative to CM: r = (0, −yc) rotated
        const sx = o.V * dt + o.yc * Math.sin(th), sy = o.yc - o.yc * Math.cos(th);
        const bx = o.V * dt - (p.hit_offset - o.yc) * Math.sin(th), by = o.yc + (p.hit_offset - o.yc) * Math.cos(th);
        return { t, q: [bx, sx, th], qd: [o.V, o.V, o.omega], flags: { hit: true, stuck: true, by, sy } };
      }
      return { t, q: [o.vb * dt, o.V * dt, o.omega * dt], qd: [o.vb, o.V, o.omega], flags: { hit: true, stuck: false, by: p.hit_offset, sy: 0 } };
    },
    bounds(p) { const o = outcome(p), L = p.stick_length; const xr = Math.max(o.V, o.vb, 0.2) * after + L / 2 + 0.4; return { xmin: -D0(p) - 0.4, xmax: xr, ymin: -L / 2 - 0.5, ymax: L / 2 + 0.5 }; },
    render(g, p, s, ov, hl) {
      const L = p.stick_length, th = s.q[2], sx = s.q[1], sy = s.flags.sy || 0;
      const ex = -L / 2 * Math.sin(th), ey = L / 2 * Math.cos(th);      // half-vector along the stick (starts along +y)
      if (ov.trail && s.flags.hit) { const pts = []; const o = outcome(p), T = t0(p); for (let tt = T; tt <= s.t; tt += 0.03) { const st = this.stateAt(p, tt); const a = st.q[2]; pts.push([st.q[1] - L / 2 * Math.sin(a), (st.flags.sy || 0) + L / 2 * Math.cos(a)]); } g.trail(pts, 'rgba(167,139,250,.5)'); }
      g.line(sx - ex, sy - ey, sx + ex, sy + ey, '#9DB8FF', 7);
      g.dot(sx, sy, 4, '#F9FAFB');
      const bx = s.q[0], by = s.flags.hit ? s.flags.by : p.hit_offset;
      g.circle(bx, by, 0.07 + 0.02 * Math.sqrt(p.ball_mass), { fill: 'rgba(248,113,113,.3)', stroke: '#F87171', width: 2 });
      if (!s.flags.hit) g.dot(0, p.hit_offset, 3, '#F5B95F');
      if (ov.labels !== false) { g.text('M, L', sx + ex, sy + ey, { color: '#9B9CA3', dyPx: -14, size: 12 }); g.text('m', bx, by, { color: '#F87171', dyPx: -18, size: 12 }); if (!s.flags.hit) g.text(`d = ${K.fmt(p.hit_offset, 2)} m`, 0.25, p.hit_offset / 2, { color: '#F5B95F', size: 11, align: 'left' }); }
      if (ov.vectors && s.flags.hit && !s.flags.stuck && Math.abs(s.qd[2]) > 1e-6) { const ic = s.qd[1] / s.qd[2]; const icx = sx - ic * Math.sin(th), icy = sy + ic * Math.cos(th); g.dot(icx, icy, 4, '#22D3EE'); g.text('instantaneous centre', icx, icy, { color: '#22D3EE', dyPx: 14, size: 11 }); }
    },
    fbd(p, s) {
      const T = t0(p); if (s.t < T || s.t > T + 0.08) return [];
      const o = outcome(p), J = p.ball_mass * (p.ball_speed - o.vb);
      return [{ at: [0, p.hit_offset], vec: [J, 0], label: 'J on stick', key: 'J', color: '#F5B95F' }, { at: [0, p.hit_offset], vec: [-J, 0], label: 'J on ball', key: 'J', color: '#FBBF24' }];
    },
    vectors(p, s) {
      const L = p.stick_length, th = s.q[2];
      const out = [{ at: [s.q[0], s.flags.hit ? s.flags.by : p.hit_offset], vec: [s.qd[0], 0], label: 'v', key: 'v', color: '#F87171' }];
      if (s.flags.hit) { out.push({ at: [s.q[1], s.flags.sy || 0], vec: [s.qd[1], 0], label: 'V', key: 'V' }); out.push({ at: [s.q[1], s.flags.sy || 0], kind: 'omega', omega: s.qd[2], r: 0.18, label: 'ω', key: 'omega' }); }
      return out;
    },
    quantities(p, s) {
      const m = p.ball_mass, M = p.stick_mass, L = p.stick_length, I = M * L * L / 12, o = outcome(p);
      const vb = s.qd[0], V = s.flags.hit ? s.qd[1] : 0, w = s.flags.hit ? s.qd[2] : 0;
      const by = s.flags.hit ? s.flags.by : p.hit_offset;
      // L about the origin: stuck → the combined CM (moving along y = yc) carries (m+M)V, plus I_tot ω about it
      const Lz = s.flags.stuck ? (-o.yc * (m + M) * V + o.Itot * w) : (-by * m * vb - (s.flags.sy || 0) * M * V + I * w);
      const ke = s.flags.stuck ? 0.5 * (m + M) * V * V + 0.5 * o.Itot * w * w : 0.5 * m * vb * vb + 0.5 * M * V * V + 0.5 * I * w * w;
      return [
        { key: 'v', label: 'ball v', value: vb, unit: 'm/s', graph: true },
        { key: 'V', label: 'stick V_cm', value: V, unit: 'm/s', graph: true },
        { key: 'omega', label: 'stick ω', value: w, unit: 'rad/s', graph: true },
        { key: 'p', label: 'total p', value: s.flags.stuck ? (m + M) * V : m * vb + M * V, unit: 'kg·m/s' },
        { key: 'L', label: 'total L about O', value: Lz, unit: 'kg·m²/s' },
        { key: 'KE', label: 'total KE', value: ke, unit: 'J' },
      ];
    },
    energy(p, s) {
      const m = p.ball_mass, M = p.stick_mass, L = p.stick_length, I = M * L * L / 12, o = outcome(p);
      const vb = s.qd[0], V = s.flags.hit ? s.qd[1] : 0, w = s.flags.hit ? s.qd[2] : 0;
      if (s.flags.stuck) return [{ label: 'KE trans (all)', value: 0.5 * (m + M) * V * V, color: '#5686FE' }, { label: 'KE rot', value: 0.5 * o.Itot * w * w, color: '#A78BFA' }];
      return [{ label: 'KE ball', value: 0.5 * m * vb * vb, color: '#F87171' }, { label: 'KE stick trans', value: 0.5 * M * V * V, color: '#5686FE' }, { label: 'KE stick rot', value: 0.5 * I * w * w, color: '#A78BFA' }];
    },
    answers(p) {
      const o = outcome(p), m = p.ball_mass, M = p.stick_mass, L = p.stick_length, I = M * L * L / 12, v = p.ball_speed;
      const ke0 = 0.5 * m * v * v;
      const ke1 = o.stuck ? 0.5 * (m + M) * o.V * o.V + 0.5 * o.Itot * o.omega * o.omega : 0.5 * m * o.vb * o.vb + 0.5 * M * o.V * o.V + 0.5 * I * o.omega * o.omega;
      return { ball_v_after: o.vb, stick_vcm: o.V, stick_omega: Math.abs(o.omega), ke_lost_fraction: 1 - ke1 / ke0, instant_centre: Math.abs(o.omega) > 1e-9 ? o.V / Math.abs(o.omega) : NaN };
    },
    measure(p, sim) { const last = sim.frames[sim.frames.length - 1]; return { ball_v_after: last.qd[0], stick_vcm: last.qd[1], stick_omega: Math.abs(last.qd[2]) }; },
  });
})();
