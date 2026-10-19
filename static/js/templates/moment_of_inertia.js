/* Moment of inertia explorer — Morin 8.3. No motion: the shape, the axis, the theorems, the numbers. */
(function () {
  const K = window.Kinema;
  function table(p) {
    const m = p.mass, a = p.a, b = p.b;
    switch (p.shape) {
      case 'rod': return { Icm_perp: m * a * a / 12, Icm_in: 0, Iend: m * a * a / 3, endOffset: a / 2, name: 'thin rod, length a' };
      case 'disk': return { Icm_perp: 0.5 * m * a * a, Icm_in: 0.25 * m * a * a, Iend: 1.5 * m * a * a, endOffset: a, name: 'uniform disk, radius a' };
      case 'ring': return { Icm_perp: m * a * a, Icm_in: 0.5 * m * a * a, Iend: 2 * m * a * a, endOffset: a, name: 'thin ring, radius a' };
      case 'rectangle': return { Icm_perp: m * (a * a + b * b) / 12, Icm_in: m * b * b / 12, Iend: m * (a * a + b * b) / 12 + m * a * a / 4, endOffset: a / 2, name: 'thin plate a × b' };
      case 'solid_sphere': return { Icm_perp: 0.4 * m * a * a, Icm_in: 0.4 * m * a * a, Iend: 1.4 * m * a * a, endOffset: a, name: 'solid sphere, radius a' };
      default: return { Icm_perp: 2 / 3 * m * a * a, Icm_in: 2 / 3 * m * a * a, Iend: 5 / 3 * m * a * a, endOffset: a, name: 'thin spherical shell, radius a' };
    }
  }
  function Iaxis(p) {
    const t = table(p);
    if (p.axis === 'centre_perp') return { I: t.Icm_perp, h: 0, label: 'through the centre, perpendicular' };
    if (p.axis === 'centre_inplane') return { I: t.Icm_in, h: 0, label: 'through the centre, in the plane' };
    if (p.axis === 'end_perp') return { I: t.Iend, h: t.endOffset, label: 'through the end/rim, perpendicular' };
    return { I: t.Icm_perp + p.mass * p.offset * p.offset, h: p.offset, label: `perpendicular, offset h = ${K.fmt(p.offset, 2)} m` };
  }
  K.template('moment_of_inertia', {
    duration() { return 0; },
    stateAt(p, t) { return { t: 0, q: [], qd: [], flags: {} }; },
    bounds(p) { const s = Math.max(p.a, p.shape === 'rectangle' ? p.b : 0, p.offset || 0) ; return { xmin: -s - 0.4, xmax: s + 0.4, ymin: -s - 0.5, ymax: s + 0.5 }; },
    render(g, p, s, ov, hl) {
      const a = p.a, ax = Iaxis(p), t = table(p);
      const stroke = '#9DB8FF', fill = 'rgba(86,134,254,.15)';
      if (p.shape === 'rod') g.line(-a / 2, 0, a / 2, 0, stroke, 8);
      else if (p.shape === 'disk') g.circle(0, 0, a, { fill, stroke, width: 2.5 });
      else if (p.shape === 'ring') g.circle(0, 0, a, { fill: null, stroke, width: 5 });
      else if (p.shape === 'rectangle') g.poly([[-a / 2, -p.b / 2], [a / 2, -p.b / 2], [a / 2, p.b / 2], [-a / 2, p.b / 2]], { fill, stroke, width: 2.5 });
      else { g.circle(0, 0, a, { fill: p.shape === 'solid_sphere' ? fill : null, stroke, width: p.shape === 'solid_sphere' ? 2.5 : 4 }); g.circle(0, 0, a * 0.6, { stroke: 'rgba(157,184,255,.35)', width: 1 }); }
      g.dot(0, 0, 4, '#F9FAFB'); g.text('CM', 0, 0, { color: '#9B9CA3', dyPx: 16, size: 12 });
      const h = ax.h;
      if (p.axis === 'centre_inplane') { g.line(0, -a - 0.3, 0, a + 0.3, '#F5B95F', 2, [6, 5]); g.text('axis (in plane)', 0, a + 0.3, { color: '#F5B95F', dyPx: -12, size: 12 }); }
      else { g.circle(h, 0, 0.06, { fill: '#F5B95F', stroke: null }); g.text('axis ⊙ ' + (h ? '' : '(centre)'), h, 0, { color: '#F5B95F', dyPx: -16, size: 12 }); if (h) { g.line(0, -0.25, h, -0.25, '#F5B95F', 1.5); g.text(`h = ${K.fmt(h, 2)} m`, h / 2, -0.25, { color: '#F5B95F', dyPx: 14, size: 12 }); } }
      g.text(t.name + ' · m = ' + K.fmt(p.mass, 2) + ' kg', 0, -Math.max(a, p.shape === 'rectangle' ? p.b : 0) - 0.4, { color: '#9B9CA3', size: 12 });
    },
    fbd() { return []; }, vectors() { return []; },
    quantities(p) { const t = table(p), ax = Iaxis(p); return [{ key: 'I_cm', label: 'I_cm (⊥ through centre)', value: t.Icm_perp, unit: 'kg·m²' }, { key: 'I_axis', label: 'I about the chosen axis', value: ax.I, unit: 'kg·m²' }, { key: 'I_end', label: 'I at end/rim (⊥)', value: t.Iend, unit: 'kg·m²' }, { key: 'I_inplane', label: 'I in-plane through centre', value: t.Icm_in, unit: 'kg·m²' }, { key: 'parallel', label: 'parallel axis: I_cm + m h²', value: t.Icm_perp + p.mass * ax.h * ax.h, unit: 'kg·m²' }]; },
    energy() { return []; },
    answers(p) { const t = table(p), ax = Iaxis(p); return { I_cm: t.Icm_perp, I_axis: ax.I, I_end: t.Iend }; },
  });
})();
