/* Kinema engine — templates plug in here; the engine owns time, drawing and overlays.

   A template registers:
     Kinema.template(id, {
       duration(p)            -> seconds of motion (0 for static explorers)
       init(p)                -> {q:[...], qd:[...], flags:{}}          generalized coordinates
       accel(p, q, qd, t, flags) -> [qdd...]                            equations of motion (RK4 integrates)
       transition(p, s, t)    -> null | {q, qd, flags, event:"label"}  optional discrete events (slip→roll, leaves surface)
       stateAt(p, t)          -> state                                  optional closed form instead of accel
       bounds(p)              -> {xmin,xmax,ymin,ymax}                  world box (metres, y up)
       render(g, p, s, ov, hl)                                          draw the scene (g = drawing helper)
       fbd(p, s)              -> [{at:[x,y], vec:[fx,fy], label, key}]  force arrows for the FBD overlay (N units)
       vectors(p, s)          -> [{at, vec, label, key, color}]          kinematic arrows (v, ω, L, τ …)
       quantities(p, s)       -> [{key, label, value, unit, graph:true}] live numbers (graphed when graph)
       energy(p, s)           -> [{label, value, color}]                 energy bars
       answers(p)             -> {key: number}                          the template's own truth (closed form)
       measure(p, frames)     -> {key: number}                           optional: answers read off the simulation
     })
   State s = {t, q, qd, flags}. World is metres with y UP; the view maps to the canvas. */
(function () {
  const T = {};
  const Kinema = { templates: T };
  Kinema.template = (id, impl) => { impl.id = id; T[id] = impl; };

  // ── numerics ──────────────────────────────────────────────────────────────
  function rk4(impl, p, q, qd, t, dt, flags) {
    const n = q.length;
    const f = (q1, qd1, t1) => impl.accel(p, q1, qd1, t1, flags);
    const k1v = f(q, qd, t), k1x = qd;
    const q2 = q.map((x, i) => x + 0.5 * dt * k1x[i]), qd2 = qd.map((v, i) => v + 0.5 * dt * k1v[i]);
    const k2v = f(q2, qd2, t + dt / 2), k2x = qd2;
    const q3 = q.map((x, i) => x + 0.5 * dt * k2x[i]), qd3 = qd.map((v, i) => v + 0.5 * dt * k2v[i]);
    const k3v = f(q3, qd3, t + dt / 2), k3x = qd3;
    const q4 = q.map((x, i) => x + dt * k3x[i]), qd4 = qd.map((v, i) => v + dt * k3v[i]);
    const k4v = f(q4, qd4, t + dt), k4x = qd4;
    const nq = new Array(n), nqd = new Array(n);
    for (let i = 0; i < n; i++) {
      nq[i] = q[i] + dt / 6 * (k1x[i] + 2 * k2x[i] + 2 * k3x[i] + k4x[i]);
      nqd[i] = qd[i] + dt / 6 * (k1v[i] + 2 * k2v[i] + 2 * k3v[i] + k4v[i]);
    }
    return [nq, nqd];
  }

  /* Precompute the whole motion once (dt = 1/240 s) so scrubbing is instant and deterministic. */
  Kinema.simulate = function (impl, p) {
    const dur = Math.max(0, impl.duration(p));
    const dt = 1 / 240;
    const frames = [];
    const events = [];
    if (impl.stateAt) {
      for (let t = 0; t <= dur + 1e-9; t += dt) frames.push(impl.stateAt(p, t));
      return { frames, events, dt, duration: dur };
    }
    let { q, qd, flags } = impl.init(p);
    flags = flags || {};
    let t = 0;
    frames.push({ t, q: q.slice(), qd: qd.slice(), flags: { ...flags } });
    const steps = Math.round(dur / dt);
    for (let i = 0; i < steps; i++) {
      [q, qd] = rk4(impl, p, q, qd, t, dt, flags);
      t = (i + 1) * dt;
      if (impl.transition) {
        const tr = impl.transition(p, { t, q, qd, flags }, t);
        if (tr) { q = tr.q || q; qd = tr.qd || qd; flags = tr.flags || flags; if (tr.event) events.push({ t, label: tr.event }); }
      }
      frames.push({ t, q: q.slice(), qd: qd.slice(), flags: { ...flags } });
      if (flags.stop) break;
    }
    return { frames, events, dt, duration: (frames.length - 1) * dt };
  };

  Kinema.frameAt = function (sim, t) {
    if (!sim.frames.length) return null;
    const i = Math.min(sim.frames.length - 1, Math.max(0, Math.round(t / sim.dt)));
    return sim.frames[i];
  };

  // ── drawing helper (world metres, y up → canvas px) ───────────────────────
  function G(ctx, W, H, bounds, pad) {
    pad = pad == null ? 40 : pad;
    const bw = bounds.xmax - bounds.xmin || 1, bh = bounds.ymax - bounds.ymin || 1;
    const scale = Math.min((W - 2 * pad) / bw, (H - 2 * pad) / bh);
    const ox = (W - scale * bw) / 2 - bounds.xmin * scale;
    const oy = H - (H - scale * bh) / 2 + bounds.ymin * scale;
    const g = {
      ctx, W, H, scale,
      x: wx => ox + wx * scale,
      y: wy => oy - wy * scale,
      px: v => v * scale,
      clear() { ctx.clearRect(0, 0, W, H); },
      line(x1, y1, x2, y2, color, width, dash) {
        ctx.save(); ctx.strokeStyle = color || '#9B9CA3'; ctx.lineWidth = width || 2; if (dash) ctx.setLineDash(dash);
        ctx.beginPath(); ctx.moveTo(g.x(x1), g.y(y1)); ctx.lineTo(g.x(x2), g.y(y2)); ctx.stroke(); ctx.restore();
      },
      poly(pts, opts) {
        opts = opts || {}; ctx.save(); ctx.beginPath();
        pts.forEach((pt, i) => i ? ctx.lineTo(g.x(pt[0]), g.y(pt[1])) : ctx.moveTo(g.x(pt[0]), g.y(pt[1])));
        if (opts.close !== false) ctx.closePath();
        if (opts.fill) { ctx.fillStyle = opts.fill; ctx.fill(); }
        if (opts.stroke !== null) { ctx.strokeStyle = opts.stroke || '#E6E7EA'; ctx.lineWidth = opts.width || 2; ctx.stroke(); }
        ctx.restore();
      },
      circle(x, y, r, opts) {
        opts = opts || {}; ctx.save(); ctx.beginPath(); ctx.arc(g.x(x), g.y(y), g.px(r), 0, Math.PI * 2);
        if (opts.fill) { ctx.fillStyle = opts.fill; ctx.fill(); }
        if (opts.stroke !== null) { ctx.strokeStyle = opts.stroke || '#E6E7EA'; ctx.lineWidth = opts.width || 2; ctx.stroke(); }
        ctx.restore();
      },
      dot(x, y, rpx, color) { ctx.save(); ctx.fillStyle = color || '#F9FAFB'; ctx.beginPath(); ctx.arc(g.x(x), g.y(y), rpx || 4, 0, Math.PI * 2); ctx.fill(); ctx.restore(); },
      /* an arrow in world coords; `len` in px overrides the world length (for force arrows scaled by a gauge) */
      arrow(x, y, dx, dy, color, opts) {
        opts = opts || {}; const sx = g.x(x), sy = g.y(y);
        let ex = g.x(x + dx), ey = g.y(y + dy);
        if (opts.lenPx != null) { const m = Math.hypot(dx, dy) || 1; ex = sx + dx / m * opts.lenPx; ey = sy - dy / m * opts.lenPx; }
        const L = Math.hypot(ex - sx, ey - sy); if (L < 1) return;
        const w = opts.width || 3, head = Math.min(14, 6 + w * 2);
        ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round';
        if (opts.glow) { ctx.shadowColor = color; ctx.shadowBlur = 14; }
        const ux = (ex - sx) / L, uy = (ey - sy) / L;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex - ux * head * 0.7, ey - uy * head * 0.7); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex - ux * head - uy * head * 0.5, ey - uy * head + ux * head * 0.5);
        ctx.lineTo(ex - ux * head + uy * head * 0.5, ey - uy * head - ux * head * 0.5); ctx.closePath(); ctx.fill();
        if (opts.label) g.text(opts.label, x + dx, y + dy, { color, dxPx: ux * 14 + (opts.ldx || 0), dyPx: uy * 14 + (opts.ldy || 0), size: opts.size || 13, px: opts.lenPx != null ? [ex, ey] : null });
        ctx.restore();
      },
      text(s, x, y, opts) {
        opts = opts || {}; ctx.save(); ctx.font = `${opts.bold ? '600 ' : ''}${opts.size || 13}px -apple-system,Inter,"Segoe UI",system-ui,sans-serif`;
        ctx.fillStyle = opts.color || '#E6E7EA'; ctx.textAlign = opts.align || 'center'; ctx.textBaseline = 'middle';
        const px = opts.px ? opts.px[0] : g.x(x), py = opts.px ? opts.px[1] : g.y(y);
        if (opts.bg) { const m = ctx.measureText(s); ctx.fillStyle = opts.bg; ctx.fillRect(px + (opts.dxPx || 0) - m.width / 2 - 4, py + (opts.dyPx || 0) - 9, m.width + 8, 18); ctx.fillStyle = opts.color || '#E6E7EA'; }
        ctx.fillText(s, px + (opts.dxPx || 0), py + (opts.dyPx || 0)); ctx.restore();
      },
      /* hatched ground/incline: a filled polygon with hatch lines under the surface */
      ground(pts, color) {
        g.poly(pts, { fill: 'rgba(255,255,255,.04)', stroke: color || '#6C6D75', width: 2 });
      },
      angleArc(x, y, r, a0, a1, color, label) {
        ctx.save(); ctx.strokeStyle = color || '#9B9CA3'; ctx.lineWidth = 1.5; ctx.beginPath();
        ctx.arc(g.x(x), g.y(y), g.px(r), -a1, -a0); ctx.stroke(); ctx.restore();
        if (label) { const am = (a0 + a1) / 2; g.text(label, x + r * 1.35 * Math.cos(am), y + r * 1.35 * Math.sin(am), { color: color || '#9B9CA3' }); }
      },
      /* a rotating body's spokes so spin is visible */
      spokes(x, y, r, angle, n, color) {
        ctx.save(); ctx.strokeStyle = color || 'rgba(255,255,255,.35)'; ctx.lineWidth = 1.5;
        for (let i = 0; i < (n || 4); i++) { const a = angle + i * Math.PI * 2 / (n || 4); ctx.beginPath(); ctx.moveTo(g.x(x), g.y(y)); ctx.lineTo(g.x(x + r * Math.cos(a)), g.y(y + r * Math.sin(a))); ctx.stroke(); }
        ctx.restore();
      },
      trail(pts, color) {
        if (pts.length < 2) return; ctx.save(); ctx.strokeStyle = color || 'rgba(86,134,254,.5)'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 4]);
        ctx.beginPath(); pts.forEach((pt, i) => i ? ctx.lineTo(g.x(pt[0]), g.y(pt[1])) : ctx.moveTo(g.x(pt[0]), g.y(pt[1]))); ctx.stroke(); ctx.restore();
      },
      omegaArc(x, y, r, omega, color) {   // a curved arrow showing the sense of rotation
        if (Math.abs(omega) < 1e-6) return; ctx.save(); ctx.strokeStyle = color || '#A78BFA'; ctx.fillStyle = color || '#A78BFA'; ctx.lineWidth = 2.5;
        const cx = g.x(x), cy = g.y(y), R = g.px(r) + 16, ccw = omega > 0;
        const a0 = -Math.PI / 2 + (ccw ? 0.3 : -0.3), a1 = a0 + (ccw ? -1.9 : 1.9);
        ctx.beginPath(); ctx.arc(cx, cy, R, a0, a1, ccw); ctx.stroke();
        const hx = cx + R * Math.cos(a1), hy = cy + R * Math.sin(a1), tx = ccw ? Math.sin(a1) : -Math.sin(a1), ty = ccw ? -Math.cos(a1) : Math.cos(a1);
        ctx.beginPath(); ctx.moveTo(hx + tx * 8, hy + ty * 8); ctx.lineTo(hx - ty * 5, hy + tx * 5); ctx.lineTo(hx + ty * 5, hy - tx * 5); ctx.closePath(); ctx.fill();
        ctx.restore();
      },
    };
    return g;
  }
  Kinema.G = G;

  const COLORS = { mg: '#F87171', N: '#4ADE80', f: '#F5B95F', T: '#F5B95F', v: '#5686FE', omega: '#A78BFA', L: '#A78BFA', tau: '#FB923C', a: '#22D3EE', P: '#F472B6' };
  Kinema.COLORS = COLORS;

  /* Draw FBD arrows with a common gauge (largest force → 90 px). */
  Kinema.drawForces = function (g, forces, hl, opts) {
    opts = opts || {};
    const maxF = Math.max(1e-9, ...forces.map(f => Math.hypot(f.vec[0], f.vec[1])));
    for (const f of forces) {
      const m = Math.hypot(f.vec[0], f.vec[1]); if (m < 1e-9) continue;
      const len = 30 + 70 * (m / maxF);
      const glow = hl && (hl.includes(f.key) || hl.includes(f.label));
      g.arrow(f.at[0], f.at[1], f.vec[0], f.vec[1], f.color || COLORS[f.key] || '#E6E7EA', { lenPx: len, width: glow ? 4 : 3, glow, label: opts.labels === false ? '' : (f.label + (opts.values ? ' ' + m.toFixed(2) + ' N' : '')) });
    }
  };
  Kinema.drawVectors = function (g, vecs, hl) {
    for (const v of vecs) {
      const glow = hl && (hl.includes(v.key) || hl.includes(v.label));
      const m = v.vec ? Math.hypot(v.vec[0], v.vec[1]) : 0;
      if (v.kind === 'omega') { g.omegaArc(v.at[0], v.at[1], v.r || 0.2, v.omega, glow ? '#C4B5FD' : (v.color || COLORS.omega)); g.text(v.label, v.at[0], v.at[1] + (v.r || 0.2) + 0.12, { color: v.color || COLORS.omega, dyPx: -18 }); continue; }
      if (m < 1e-6) continue;
      g.arrow(v.at[0], v.at[1], v.vec[0], v.vec[1], v.color || COLORS[v.key] || '#5686FE', { lenPx: v.lenPx != null ? v.lenPx : Math.min(140, 20 + 30 * m), width: glow ? 4 : 2.5, glow, label: v.label });
    }
  };

  // ── small physics helpers shared by templates ────────────────────────────
  Kinema.rad = d => d * Math.PI / 180;
  Kinema.deg = r => r * 180 / Math.PI;
  Kinema.fmt = (v, d) => (v == null || isNaN(v)) ? '—' : (Math.abs(v) >= 1000 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(d == null ? 2 : d) : v.toFixed(d == null ? 3 : d));
  Kinema.clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  window.Kinema = Kinema;
})();
