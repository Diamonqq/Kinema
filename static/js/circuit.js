/* Kinema circuit — a textbook schematic from a validated circuit spec (app/circuit.py): standard symbols along each
   component's segment, junction dots, labels on the outside of the loop, and — when the server solved the DC
   circuit — current arrows with values. The solution is the server's independent calculation, not the model's. */
const esc = s => String(s ?? '').normalize('NFC').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => !Number.isFinite(v) ? '—' : Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : Math.abs(v) >= 0.01 ? v.toFixed(2) : v === 0 ? '0' : v.toExponential(1);
const INK = '#3e485f', ACCENT = '#ad6942', CURRENT = '#3B54C4';
/* labels as printed in a textbook: R_1 → R₁ (an SVG subscript), \Omega → Ω, \varepsilon → ε */
const SYMBOLS = { '\\varepsilon': 'ε', '\\epsilon': 'ε', '\\Omega': 'Ω', '\\omega': 'ω', '\\mu': 'μ', '\\tau': 'τ', '\\Delta': 'Δ', '\\cdot': '·', '\\,': ' ', '\\ ': ' ' };
export function svgLabel(s) {
  let v = String(s ?? '').replace(/\$/g, '');
  for (const [k, r] of Object.entries(SYMBOLS)) v = v.split(k).join(r);
  v = v.replace(/\\(?:text|mathrm)\{([^}]*)\}/g, '$1');
  return esc(v).replace(/([_^])(?:\{([^}]*)\}|([0-9A-Za-z]))/g, (m, op, a, b) => `<tspan baseline-shift="${op === '_' ? 'sub' : 'super'}" font-size="75%">${a ?? b}</tspan>`);
}

/* symbol path in a local frame: along +x from -S/2 to S/2, centred at the origin */
function symbol(type, S) {
  const h = S / 2;
  switch (type) {
    case 'resistor': case 'lamp': {
      if (type === 'lamp') return `<circle r="${S * 0.3}" fill="#fcfbf8"/><path d="M${-S * 0.21},${-S * 0.21}L${S * 0.21},${S * 0.21}M${-S * 0.21},${S * 0.21}L${S * 0.21},${-S * 0.21}"/><path d="M${-h},0H${-S * 0.3}M${S * 0.3},0H${h}"/>`;
      const n = 6, w = S / n, a = Math.max(5, S * 0.11);
      let d = `M${-h},0`;
      for (let i = 0; i < n; i++) d += `L${-h + w * (i + 0.5)},${i % 2 ? a : -a}`;
      return `<path d="${d}L${h},0" fill="none"/>`;
    }
    case 'capacitor': { const g = Math.max(4, S * 0.08), p = Math.max(12, S * 0.36);
      return `<path d="M${-h},0H${-g}M${g},0H${h}"/><path d="M${-g},${-p}V${p}M${g},${-p}V${p}" stroke-width="3"/>`; }
    case 'inductor': { const n = 4, w = S * 0.8 / n; let d = `M${-h},0H${-S * 0.4}`;
      for (let i = 0; i < n; i++) d += `a${w / 2},${w / 2} 0 0 1 ${w},0`;
      return `<path d="${d}H${h}" fill="none"/>`; }
    case 'battery': { const g = Math.max(4, S * 0.08), big = Math.max(13, S * 0.36), small = big * 0.55;
      // terminal a (−) on the left, b (+) on the right: long thin plate is +
      return `<path d="M${-h},0H${-g}M${g},0H${h}"/><path d="M${-g},${-small}V${small}" stroke-width="4"/><path d="M${g},${-big}V${big}" stroke-width="2"/>` +
        `<text x="${g + 6}" y="${-big - 4}" class="cz-pm">+</text><text x="${-g - 12}" y="${-big - 4}" class="cz-pm">−</text>`; }
    case 'ac_source': { const r = S * 0.3; return `<path d="M${-h},0H${-r}M${r},0H${h}"/><circle r="${r}" fill="#fcfbf8"/><path d="M${-r * 0.6},0 C${-r * 0.3},${-r * 0.7} 0,${-r * 0.7} 0,0 S${r * 0.3},${r * 0.7} ${r * 0.6},0" fill="none"/>`; }
    case 'current_source': { const r = S * 0.3; return `<path d="M${-h},0H${-r}M${r},0H${h}"/><circle r="${r}" fill="#fcfbf8"/><path d="M${-r * 0.55},0H${r * 0.5}M${r * 0.15},${-r * 0.35}L${r * 0.55},0L${r * 0.15},${r * 0.35}" fill="none"/>`; }
    case 'ammeter': case 'voltmeter': { const r = S * 0.3; return `<path d="M${-h},0H${-r}M${r},0H${h}"/><circle r="${r}" fill="#fcfbf8"/><text y="${r * 0.36}" text-anchor="middle" class="cz-meter">${type === 'ammeter' ? 'A' : 'V'}</text>`; }
    case 'switch_open': case 'switch_closed': { const g = S * 0.3, ang = type === 'switch_open' ? -28 : -2, rad = ang * Math.PI / 180, len = 2 * g;
      return `<path d="M${-h},0H${-g}M${g},0H${h}"/><circle cx="${-g}" r="3" fill="${INK}"/><circle cx="${g}" r="3" fill="${INK}"/><path d="M${-g},0L${-g + len * Math.cos(rad)},${len * Math.sin(rad)}"/>`; }
    case 'diode': { const t = S * 0.22; return `<path d="M${-h},0H${h}"/><path d="M${-t},${-t}L${t},0L${-t},${t}Z" fill="#fcfbf8"/><path d="M${t},${-t}V${t}" stroke-width="2.5"/>`; }
    default: return `<path d="M${-h},0H${h}"/>`;
  }
}

export function drawCircuit(svg, circuit, opts = {}) {
  const W = 900, H = 540, highlight = new Set(opts.highlight || []);
  const nodes = Object.fromEntries(circuit.nodes.map(n => [n.id, n]));
  const xs = circuit.nodes.map(n => n.x), ys = circuit.nodes.map(n => n.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const unit = Math.min(140, 700 / Math.max(maxX - minX, 1), 380 / Math.max(maxY - minY, 1));
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const X = x => W / 2 + (x - cx) * unit, Y = y => H / 2 - (y - cy) * unit + 10;
  const degree = {};
  for (const c of circuit.components) { degree[c.a] = (degree[c.a] || 0) + 1; if (c.b && c.b !== c.a) degree[c.b] = (degree[c.b] || 0) + 1; }
  const sol = circuit.solution && circuit.solution.components || null;
  let wires = '', parts = '', labels = '', dots = '', currents = '';
  for (const c of circuit.components) {
    const a = nodes[c.a];
    if (c.type === 'ground') {
      const x = X(a.x), y = Y(a.y);
      parts += `<g class="cz-part" data-component="${esc(c.id)}"><path d="M${x},${y}V${y + 16}M${x - 14},${y + 16}H${x + 14}M${x - 9},${y + 22}H${x + 9}M${x - 4},${y + 28}H${x + 4}"/><title>ground</title></g>`;
      continue;
    }
    const b = nodes[c.b];
    const x1 = X(a.x), y1 = Y(a.y), x2 = X(b.x), y2 = Y(b.y);
    const len = Math.hypot(x2 - x1, y2 - y1), ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const sel = highlight.has(c.id) || highlight.has(c.label);
    const stroke = sel ? ACCENT : INK;
    const info = sol && sol[c.id];
    const tip = info ? `${c.label || c.id}: I = ${num(Math.abs(info.current))} A, V = ${num(Math.abs(info.voltage))} V, P = ${num(Math.abs(info.power))} W` : (c.label || c.id);
    if (c.type === 'wire') { wires += `<path d="M${x1},${y1}L${x2},${y2}" stroke="${stroke}"><title>${esc(tip)}</title></path>`; continue; }
    const S = Math.min(len * 0.62, 74);
    // leads + symbol, rotated along the segment
    parts += `<g class="cz-part${sel ? ' sel' : ''}" data-component="${esc(c.id)}" stroke="${stroke}"><path d="M${x1},${y1}L${x2},${y2}" class="cz-lead" stroke-dasharray="${(len - S) / 2} ${S} ${(len - S) / 2}"/>` +
      `<g transform="translate(${mx} ${my}) rotate(${ang})">${symbol(c.type, S)}</g><title>${esc(tip)}</title></g>`;
    // label on the side away from the circuit's centre
    const ux = (x2 - x1) / (len || 1), uy = (y2 - y1) / (len || 1);
    let nx = -uy, ny = ux;
    if ((mx - X(cx)) * nx + (my - Y(cy)) * ny < 0) { nx = -nx; ny = -ny; }
    const off = c.type === 'capacitor' || c.type === 'battery' ? 34 : 26;
    const lx = mx + nx * off, ly = my + ny * off + 4;
    if (c.label) labels += `<text x="${lx}" y="${ly}" text-anchor="${Math.abs(nx) > 0.5 ? (nx > 0 ? 'start' : 'end') : 'middle'}" class="cz-label${sel ? ' sel' : ''}">${svgLabel(c.label)}</text>`;
    // current arrow on the lead nearest the start, with the value, inside the loop
    if (sol && opts.showCurrents !== false && circuit.show_currents && info && Math.abs(info.current) > 1e-12 && !['voltmeter', 'switch_open'].includes(c.type)) {
      const dir = info.current >= 0 ? 1 : -1;
      const along = (len - S) / 4;
      const px = x1 + ux * along, py = y1 + uy * along;
      const ax = ux * dir, ay = uy * dir, s = 7;
      currents += `<g class="cz-current"><path d="M${px - ax * s},${py - ay * s}L${px + ax * s},${py + ay * s}M${px + ax * s - (ax * 6 - ay * 5)},${py + ay * s - (ay * 6 + ax * 5)}L${px + ax * s},${py + ay * s}L${px + ax * s - (ax * 6 + ay * 5)},${py + ay * s - (ay * 6 - ax * 5)}" fill="none"/>` +
        // the value sits beside the arrow on the side away from the component's own label, clear of the wire
        `<text stroke="none" x="${px - nx * 12}" y="${py - ny * 12 + 4}" text-anchor="${Math.abs(nx) > 0.5 ? (nx > 0 ? 'end' : 'start') : 'middle'}">${num(Math.abs(info.current))} A</text></g>`;
    }
  }
  for (const [id, n] of Object.entries(nodes)) if ((degree[id] || 0) >= 3) dots += `<circle cx="${X(n.x)}" cy="${Y(n.y)}" r="4" fill="${INK}"><title>node ${esc(id)}${circuit.solution ? ': ' + num(circuit.solution.node_voltages[id]) + ' V' : ''}</title></circle>`;
  svg.innerHTML = `<g class="cz" fill="none" stroke="${INK}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${wires}${parts}</g>${dots}<g class="cz-currents" stroke="${CURRENT}" stroke-width="1.6" fill="${CURRENT}" font-size="12">${currents}</g><g class="cz-labels">${labels}</g>`;
  return { unit };
}

export function circuitStatus(circuit) {
  if (!circuit.solution) return circuit.analysis === 'none' ? 'Schematic only: this circuit is drawn, not solved (symbolic values, AC or a transient).' : 'The app could not solve this circuit independently; see the warning.';
  const kind = circuit.analysis === 'initial' ? 'just after the switch closes' : 'in the DC steady state';
  return `Currents are the app's own solution ${kind}, not the model's. Hover a component for its current, voltage and power.`;
}
