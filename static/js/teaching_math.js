/* Bounded numerical helpers shared by the lesson and its apparatus drawing. */
export function integralSweep(integrand, from, to, samples = 600) {
  if (!Number.isFinite(from) || !Number.isFinite(to)) throw new Error('Integral bounds must be finite.');
  const n = Math.max(1, Math.min(4000, Math.trunc(samples) || 600));
  if (!Number.isFinite(to - from)) throw new Error('The integral interval is too large.');
  const dx = (to - from) / n, values = [], sums = [0];
  let peak = 0;
  for (let i = 0; i <= n; i++) {
    const value = integrand(from + i * dx);
    if (!Number.isFinite(value)) throw new Error('The integrand is undefined inside the selected interval.');
    values.push(value); peak = Math.max(peak, Math.abs(value));
    if (i) {
      const sum = sums[i - 1] + (values[i - 1] / 2 + value / 2) * dx;
      if (!Number.isFinite(sum)) throw new Error('The integral exceeds the supported numeric range.');
      sums.push(sum);
    }
  }
  return { peak, total: sums[n], at(progress) {
    const p = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
    const q = p * n, i = Math.min(n - 1, Math.floor(q)), f = q - i;
    const value = values[i] + f * (values[i + 1] - values[i]);
    return { x: from + (to - from) * p, value,
      acc: sums[i] + (values[i] / 2 + value / 2) * f * dx };
  } };
}

// Nodes are world points {p:[x,y]} or circular wraps {id,c:[x,y],r,ccw}.
// Every segment is tangent to BOTH neighbouring pulleys, including consecutive wraps.
export function tangentStringPath(nodes) {
  if (nodes.length < 2 || !nodes[0].p || !nodes[nodes.length - 1].p) throw new Error('A string must start and end at attachment points.');
  for (const node of nodes) {
    const p = node.p || node.c;
    if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite) || (!node.p && (!(node.r > 0) || !Number.isFinite(node.r)))) throw new Error('String geometry must use finite points and positive pulley radii.');
  }
  const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const mul = (a, k) => [a[0] * k, a[1] * k];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
  const length = a => Math.hypot(...a);
  const unit = a => mul(a, 1 / length(a));
  const turn = a => [-a[1], a[0]];
  const dir = a => a.ccw === true ? 1 : -1;
  function pointContact(point, circle, incoming) {
    const d = sub(point, circle.c), distance = length(d);
    if (!(distance > circle.r)) throw new Error('A string endpoint lies inside a pulley.');
    const phi = Math.atan2(d[1], d[0]), offset = Math.acos(circle.r / distance);
    for (const angle of [phi + offset, phi - offset]) {
      const radial = [Math.cos(angle), Math.sin(angle)], contact = add(circle.c, mul(radial, circle.r));
      const travel = unit(incoming ? sub(contact, point) : sub(point, contact));
      if (dot(travel, mul(turn(radial), dir(circle))) > 1 - 1e-8) return contact;
    }
    throw new Error('No tangent follows the requested pulley wrap direction.');
  }
  const segments = [];
  for (let i = 0; i + 1 < nodes.length; i++) {
    const a = nodes[i], b = nodes[i + 1]; let p, q;
    if (a.p && b.p) { p = a.p; q = b.p; }
    else if (a.p) { p = a.p; q = pointContact(p, b, true); }
    else if (b.p) { q = b.p; p = pointContact(q, a, false); }
    else {
      const delta = sub(b.c, a.c), distance = length(delta);
      const offset = dir(b) * b.r - dir(a) * a.r;
      if (!(distance > Math.abs(offset))) throw new Error('The selected pulley wraps have no common tangent.');
      const u = unit(delta), angle = -Math.asin(offset / distance);
      const travel = add(mul(u, Math.cos(angle)), mul(turn(u), Math.sin(angle)));
      p = add(a.c, mul(turn(travel), -dir(a) * a.r));
      q = add(b.c, mul(turn(travel), -dir(b) * b.r));
    }
    segments.push({ a: p, b: q, aWrap: a.p ? null : a.id, bWrap: b.p ? null : b.id });
  }
  const arcs = [];
  for (let i = 1; i + 1 < nodes.length; i++) {
    const c = nodes[i]; if (c.p) continue;
    const p = sub(segments[i - 1].b, c.c), q = sub(segments[i].a, c.c);
    const a0 = Math.atan2(p[1], p[0]); let a1 = Math.atan2(q[1], q[0]);
    if (dir(c) > 0 && a1 < a0) a1 += 2 * Math.PI;
    if (dir(c) < 0 && a1 > a0) a1 -= 2 * Math.PI;
    arcs.push({ C: c.c, R: c.r, a0, a1, dir: dir(c), wrapId: c.id });
  }
  return { segments, arcs };
}

// Gear constraints move the blocks and pulley but do not transmit the rope's
// net load into the axle's reported reaction. Those reactions are incomplete.
export function incompletePulleyReactions(spec) {
  const joints = new Map((spec.joints || []).map(j => [j.id, j]));
  const wrapped = new Set((spec.strings || []).flatMap(s => (s.via || []).map(v => v.wrap).filter(Boolean)));
  const tensions = new Set((spec.strings || []).flatMap(s => s.tension || []));
  const incomplete = new Set();
  for (const id of tensions) {
    const gear = joints.get(id); if (gear?.type !== 'gear') continue;
    for (const ref of [gear.joint1, gear.joint2]) {
      const pivot = joints.get(ref);
      if (pivot?.type === 'pivot' && (wrapped.has(pivot.a) || wrapped.has(pivot.b))) incomplete.add(pivot.id);
    }
  }
  return incomplete;
}

// A pulley ratio can produce different loads at its two endpoints. Only an
// explicit body attachment identifies which load belongs on a drawn leg.
export function jointTensionForSegment(joint, bodyIds = []) {
  const magnitude = force => Array.isArray(force) && force.length === 2 && force.every(Number.isFinite) ? Math.hypot(...force) : null;
  if (joint?.type !== 'pulley') return magnitude(joint?.force);
  const a = magnitude(joint.forceA), b = magnitude(joint.forceB);
  if (a == null || b == null) return null;
  const hasA = bodyIds.includes(joint.a), hasB = bodyIds.includes(joint.b);
  if (hasA && !hasB) return a;
  if (hasB && !hasA) return b;
  // No unique attachment: equal tensions are safe, unequal ones are unknown.
  return Math.abs(a - b) <= 1e-9 * Math.max(1, a, b) ? (a + b) / 2 : null;
}
