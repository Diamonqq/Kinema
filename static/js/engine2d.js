/* Kinema general engine — ANY planar rigid-body scene, not a template.
   A scene SPEC (bodies, joints, impulses, applied forces) → a Box2D world (planck.js) → frames that carry
   every body's pose/velocity AND every force acting on it (gravity, contact normal + friction from the
   solver's impulses, joint reactions). The renderer and the tutor read frames; nothing downstream knows Box2D.

   spec = {
     gravity: 9.8, duration: 3,
     bodies: [{ id, type:'dynamic'|'static', shape:'circle'|'box'|'polygon'|'edge', r, w, h, points:[[x,y]..],
                pos:[x,y], angle, vel:[vx,vy], omega, mass, inertia: number|'solid_sphere'|'solid_cylinder'|'hoop'|
                'shell'|'rod'|'plate'|'point', lambda: 'λ(x) along a box, e.g. "(1-2*x/l)^3"' (mass, CM and I integrated),
                friction, restitution, label, render:{kind:'sphere'|'disk'|'box'|'rod'|'slab', color} }],
     joints:  [{ id, type:'pivot'|'rope'|'rod'|'pulley'|'slider'|'gear'|'spring'|'weld'|'friction', a, b:'world'|id,
                anchor|anchorA|anchorB (world coords), length, groundA, groundB, ratio, axis, k, rest, maxTorque, label }],
     impulses:[{ body, at:[x,y]|'center', J:[jx,jy], t }],
     forces:  [{ body, F:[fx,fy], offset:[dx,dy] (world offset from the body centre), from, to, label }],
     ropes: [[bodyId, [x,y]]] (drawn strings), nocollide: [[a,b]] (pass through each other), stick: [[a,b]] (weld at first contact),
     focus: bodyId, topdown: bool, camera: 'hero'|'follow'|'side'|'top'|'closeup'
   }
   Needs the global `planck` (UMD build). Units: metres, kilograms, seconds, newtons. y is UP. */
(function () {
  const INERTIA = { solid_sphere: 0.4, solid_cylinder: 0.5, hoop: 1.0, shell: 2 / 3, point: 0.0 };
  // 1200 Hz: Box2D's sequential-impulse joints bleed energy from a body rotating about an off-centre pivot in proportion
  // to the step (measured 2026-09-04 on a stick with its CM 0.3 m from the pivot at 3 rad/s: −2.8 % of ω in 2 s at
  // 240 Hz, −1.4 % at 480, −0.7 % at 960, −0.36 % at 1920; the falling rod's ω_bottom error 0.72 % → 0.18 %). A 2-s
  // scene costs ~10 ms to simulate at this rate, so the finer step is free.
  const DT = 1 / 1200, VEL_IT = 16, POS_IT = 8;

  function V(x, y) { return new planck.Vec2(x, y); }

  function inertiaFor(spec, mass) {
    const i = spec.inertia;
    if (typeof i === 'number') return i;
    if (spec.shape === 'circle') { const b = INERTIA[i] ?? 0.5; return b * mass * spec.r * spec.r; }
    if (spec.shape === 'box') { const w = spec.w, h = spec.h; if (i === 'rod') return mass * Math.max(w, h) ** 2 / 12; return mass * (w * w + h * h) / 12; }
    return null;   // polygon: keep planck's own about the centroid
  }

  /* A tiny SAFE expression compiler for density profiles λ(x): numbers, x, l (the body's length), pi, e; + - * / ^,
     parentheses, unary minus, implicit products like 2x or 3(1-x); functions sin cos tan exp sqrt abs ln log. No eval. */
  function compileExpr(src) {
    const s = String(src || '').replace(/\s+/g, ''); let i = 0;
    const FN = { sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp, sqrt: Math.sqrt, abs: Math.abs, ln: Math.log, log: Math.log10 };
    const CONST = { pi: Math.PI, e: Math.E };
    const fail = m => { throw new Error('bad expression "' + src + '": ' + m + ' at ' + i); };
    function expr() { let v = term(); while (s[i] === '+' || s[i] === '-') { const op = s[i++]; const r = term(); const a = v; v = op === '+' ? (env => a(env) + r(env)) : (env => a(env) - r(env)); } return v; }
    function term() { let v = unary(); for (;;) { if (s[i] === '*' || s[i] === '/') { const op = s[i++]; const r = unary(); const a = v; v = op === '*' ? (env => a(env) * r(env)) : (env => a(env) / r(env)); }
      else if (i < s.length && (/[a-zA-Z(]/.test(s[i]))) { const r = unary(); const a = v; v = env => a(env) * r(env); }   // implicit product
      else return v; } }
    function unary() { if (s[i] === '-') { i++; const r = unary(); return env => -r(env); } if (s[i] === '+') { i++; return unary(); } return power(); }
    function power() { const b = atom(); if (s[i] === '^') { i++; const e = unary(); return env => Math.pow(b(env), e(env)); } return b; }
    function atom() {
      if (s[i] === '(') { i++; const v = expr(); if (s[i] !== ')') fail('missing )'); i++; return v; }
      const num = /^(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(s.slice(i)); if (num) { i += num[0].length; const c = parseFloat(num[0]); return () => c; }
      const id = /^[a-zA-Z_]\w*/.exec(s.slice(i)); if (!id) fail('unexpected "' + (s[i] || 'end') + '"'); i += id[0].length; const name = id[0];
      if (s[i] === '(' && FN[name]) { i++; const a = expr(); if (s[i] !== ')') fail('missing )'); i++; const f = FN[name]; return env => f(a(env)); }
      if (Object.prototype.hasOwnProperty.call(CONST, name)) { const c = CONST[name]; return () => c; }
      if (name === 'L') return env => typeof env.L === 'number' ? env.L : env.l;
      // any other name is looked up in the evaluation environment (x, l, lambda, theta, r …) — data, never code
      return env => { const v = env[name]; if (typeof v !== 'number') throw new Error('unknown name ' + name + ' in "' + src + '"'); return v; };
    }
    const f = expr(); if (i < s.length) fail('trailing "' + s.slice(i) + '"');
    return f;
  }
  /* ∫ over the body's length of a line density λ(x), x from the centre: mass, centre-of-mass offset, inertia about the CM. */
  function integrateProfile(src, l, n) {
    const f = compileExpr(src); n = n || 4000; const h = l / n; let m = 0, mx = 0, mxx = 0;
    for (let k = 0; k <= n; k++) {
      const x = -l / 2 + k * h, w = (k === 0 || k === n) ? 0.5 : 1, lam = f({ x, l });
      if (!Number.isFinite(lam)) throw new Error('density is not finite at x = ' + x);
      if (lam < 0) throw new Error('density is negative at x = ' + x + '; check the expression and coordinate interval');
      m += w * lam * h; mx += w * lam * x * h; mxx += w * lam * x * x * h;
    }
    const cm = m > 0 ? mx / m : 0; return { mass: m, cm, I: Math.max(0, mxx - m * cm * cm) };
  }

  function build(spec) {
    if (typeof planck === 'undefined') throw new Error('planck.js is not loaded');
    planck.Settings.linearSlop = 0.0005; planck.Settings.angularSlop = 0.5 * Math.PI / 180; planck.Settings.velocityThreshold = 0.05;
    const world = new planck.World({ gravity: V(0, -(spec.gravity ?? 9.8)), allowSleep: false });
    const ground = world.createBody();                                            // 'world' for joints
    const bodies = {}, meta = {};
    // Exclusions are exact unordered pairs, not a transitive collision group.
    const pairKey = (a, b) => JSON.stringify(a < b ? [a, b] : [b, a]);
    const noc = new Set((spec.nocollide || []).map(([a, b]) => pairKey(a, b)));
    for (const b of spec.bodies) {
      const data = { ...b };
      const type = b.type === 'static' ? 'static' : 'dynamic';
      const body = world.createBody({ type, position: V(b.pos?.[0] ?? 0, b.pos?.[1] ?? 0), angle: b.angle ?? 0,
        linearVelocity: V(b.vel?.[0] ?? 0, b.vel?.[1] ?? 0), angularVelocity: b.omega ?? 0, bullet: !!b.bullet });
      let shape;
      if (b.shape === 'circle') shape = new planck.Circle(b.r);
      else if (b.shape === 'box') shape = new planck.Box(b.w / 2, b.h / 2);
      else if (b.shape === 'polygon') shape = new planck.Polygon(b.points.map(p => V(p[0], p[1])));
      else if (b.shape === 'edge') shape = new planck.Edge(V(b.points[0][0], b.points[0][1]), V(b.points[1][0], b.points[1][1]));
      else throw new Error('unknown shape ' + b.shape);
      const fixture = body.createFixture(shape, { density: 1, friction: b.friction ?? 0.5, restitution: b.restitution ?? 0 });
      if (noc.size) {
        const baseShouldCollide = fixture.shouldCollide;
        fixture.shouldCollide = function (other) {
          const otherId = other.getBody().getUserData()?.id;
          return !noc.has(pairKey(b.id, otherId)) && baseShouldCollide.call(this, other);
        };
      }
      if (type === 'dynamic') {
        if (b.lambda && b.shape === 'box') {
          // a non-uniform rod: mass, centre of mass and inertia come from ∫λ(x)dx along its length (its own x axis)
          const prof = integrateProfile(b.lambda, b.w); if (!(prof.mass > 0)) throw new Error(b.id + ': the density profile integrates to zero mass');
          body.setMassData({ mass: prof.mass, center: V(prof.cm, 0), I: prof.I + prof.mass * prof.cm * prof.cm });   // Box2D wants I about the ORIGIN
          data.profile = prof;
        } else {
          const m = b.mass ?? body.getMass(); const I = inertiaFor(b, m);
          const c = body.getLocalCenter();
          body.setMassData({ mass: m, center: c, I: I == null ? body.getInertia() * (m / Math.max(1e-9, body.getMass())) : I });
        }
      }
      bodies[b.id] = body; meta[b.id] = data; body.setUserData({ id: b.id });
    }
    const joints = {}; const jmeta = {};
    const B = id => id === 'world' || id == null ? ground : bodies[id];
    for (const j of spec.joints || []) {
      let joint; const a = B(j.a), b = B(j.b);
      const anchor = j.anchor ? V(j.anchor[0], j.anchor[1]) : null;
      const anchorA = j.anchorA ? V(j.anchorA[0], j.anchorA[1]) : (anchor || a.getPosition());
      const anchorB = j.anchorB ? V(j.anchorB[0], j.anchorB[1]) : (anchor || b.getPosition());
      switch (j.type) {
        case 'pivot': joint = new planck.RevoluteJoint({ collideConnected: false }, a, b, anchor); break;
        case 'rod': joint = new planck.DistanceJoint({ collideConnected: !!j.collide, length: j.length }, a, b, anchorA, anchorB); break;
        case 'spring': {
          const stiffness = j.k ?? 10;
          if (j.frequencyHz == null && (!(stiffness > 0) || !Number.isFinite(stiffness))) throw new Error(j.id + ': spring stiffness must be positive and finite');
          if (j.frequencyHz != null && (!(j.frequencyHz > 0) || !Number.isFinite(j.frequencyHz))) throw new Error(j.id + ': spring frequency must be positive and finite');
          joint = new planck.DistanceJoint({ frequencyHz: j.frequencyHz ?? 1, dampingRatio: j.damping ?? 0, length: j.rest }, a, b, anchorA, anchorB);
          if (j.frequencyHz == null) {
            // Planck converts frequency to k using the constraint's effective mass.
            // Include both masses and the rotating anchor offsets, then refresh as
            // the geometry changes so a specified k stays constant in N/m.
            const spring = joint;
            const updateFrequency = () => {
              const pA = spring.getAnchorA(), pB = spring.getAnchorB(), dx = pB.x - pA.x, dy = pB.y - pA.y, len = Math.hypot(dx, dy);
              const ux = len > planck.Settings.linearSlop ? dx / len : 0, uy = len > planck.Settings.linearSlop ? dy / len : 0;
              const inverseMass = (body, anchor) => {
                if (!body.isDynamic()) return 0;
                const m = body.getMass(), c = body.getWorldCenter(), lc = body.getLocalCenter();
                const I = body.getInertia() - m * (lc.x * lc.x + lc.y * lc.y);
                const lever = (anchor.x - c.x) * uy - (anchor.y - c.y) * ux;
                return 1 / m + (I > 0 ? lever * lever / I : 0);
              };
              const inverse = inverseMass(a, pA) + inverseMass(b, pB);
              if (inverse > 0) spring.setFrequency(Math.sqrt(stiffness * inverse) / (2 * Math.PI));
            };
            updateFrequency(); world.on('pre-step', updateFrequency);
          }
          break;
        }
        case 'rope': joint = new planck.RopeJoint({ maxLength: j.length }, a, b, anchorA); joint.m_localAnchorB = b.getLocalPoint(anchorB); break;
        case 'pulley': joint = new planck.PulleyJoint({}, a, b, V(j.groundA[0], j.groundA[1]), V(j.groundB[0], j.groundB[1]), anchorA, anchorB, j.ratio ?? 1); break;
        case 'slider': joint = new planck.PrismaticJoint({}, a, b, anchor, V(j.axis?.[0] ?? 0, j.axis?.[1] ?? 1)); break;
        case 'gear': joint = new planck.GearJoint({ ratio: j.ratio ?? 1 }, a, b, joints[j.joint1], joints[j.joint2], j.ratio ?? 1); break;
        case 'weld': joint = new planck.WeldJoint({}, a, b, anchor); break;
        case 'friction': joint = new planck.FrictionJoint({ maxForce: j.maxForce ?? 0, maxTorque: j.maxTorque ?? 0 }, a, b, anchor); break;
        default: throw new Error('unknown joint ' + j.type);
      }
      world.createJoint(joint); joints[j.id || `${j.type}_${Object.keys(joints).length}`] = joint; jmeta[j.id || Object.keys(joints).slice(-1)[0]] = j;
    }
    return { world, ground, bodies, meta, joints, jmeta };
  }

  /* Default 1200 Hz; authored precision may retain fewer uniformly spaced snapshots. */
  function simulate(spec, opts) {
    opts = opts || {};
    const W = build(spec); const { world, bodies, meta, joints, jmeta } = W;
    const dt = opts.dt || spec.dt || DT, steps = Math.round((spec.duration ?? 3) / dt);
    const sampleHz = opts.sample_hz ?? spec.sample_hz;
    let stride = 1;
    if (sampleHz !== undefined) {
      const hz = 1 / dt;
      if (![1200, 2400, 4800, 9600].some(n => Math.abs(hz - n) < 1e-7) || ![120, 240, 600, 1200].includes(sampleHz) || Math.abs(hz / sampleHz - Math.round(hz / sampleHz)) > 1e-9) throw new Error('Unsupported native snapshot rate');
      stride = Math.round(hz / sampleHz);
    }
    const sampleDt = dt * stride;
    const frames = []; const events = []; let firstStep = null;
    let contactSamples = 0; const contactBucket = new Map();
    // contact impulses → forces (post-solve fires per contact per step, after the solver)
    let contactForces = [];
    world.on('post-solve', (contact, impulse) => {
      const wm = contact.getWorldManifold(null); if (!wm) return;
      const fa = contact.getFixtureA(), fb = contact.getFixtureB(); const ba = fa.getBody(), bb = fb.getBody();
      const nx = wm.normal.x, ny = wm.normal.y, tx = ny, ty = -nx;                      // tangent = cross(normal, 1)
      const n = wm.pointCount; if (!n) return;
      let Nn = 0, Tt = 0, px = 0, py = 0;
      for (let i = 0; i < n; i++) { Nn += impulse.normalImpulses[i] / dt; Tt += impulse.tangentImpulses[i] / dt; px += wm.points[i].x / n; py += wm.points[i].y / n; }
      const ida = (ba.getUserData() || {}).id || 'world', idb = (bb.getUserData() || {}).id || 'world';
      // force ON B = +(N n + T t); ON A = the opposite
      contactForces.push({ body: idb, other: ida, kind: 'normal', at: [px, py], vec: [Nn * nx, Nn * ny] }, { body: idb, other: ida, kind: 'friction', at: [px, py], vec: [Tt * tx, Tt * ty] },
                         { body: ida, other: idb, kind: 'normal', at: [px, py], vec: [-Nn * nx, -Nn * ny] }, { body: ida, other: idb, kind: 'friction', at: [px, py], vec: [-Tt * tx, -Tt * ty] });
    });
    const g = spec.gravity ?? 9.8;
    const pending = (spec.impulses || []).map(x => ({ ...x, done: false }));
    const bodyIds = Object.keys(bodies);
    // Convex curved contacts: a circle rolling on the OUTSIDE of a static circle loses its manifold every few steps — the
    // straight step along the tangent lifts it off by v²dt²/2ρ and Box2D never pushes a body back in. The readout chatters
    // and the ball lets go when N is still ~8 % of mv²/ρ, independent of dt (measured 2026-09-04: cosθ 0.607 vs 10/17).
    // Cure: a ball that touched the surface within the last step and now floats less than two lifts above it is set back
    // onto the surface (position only, 0.1 mm inside, below linearSlop so the position solver leaves it alone).
    const curved = [];
    for (const [ida, A] of Object.entries(meta)) if (A.type === 'static' && A.shape === 'circle') for (const [idb, B] of Object.entries(meta)) if (B.type !== 'static' && B.shape === 'circle') curved.push({ a: ida, b: idb, rho: A.r + B.r, key: ida + '|' + idb });
    const lastTouch = {}; let stepNow = -1;
    if (curved.length) world.on('post-solve', (contact) => { const ida = (contact.getFixtureA().getBody().getUserData() || {}).id, idb = (contact.getFixtureB().getBody().getUserData() || {}).id; lastTouch[ida + '|' + idb] = stepNow; lastTouch[idb + '|' + ida] = stepNow; });
    // stick: [[a, b], ...] — the pair becomes ONE body at first contact (putty, a ball that sticks to a stick): a perfectly
    // inelastic collision. Momentum and angular momentum are conserved (the weld is an internal constraint); energy is not.
    const stickKeys = new Set([].concat(...(spec.stick || []).map(p => [p[0] + '|' + p[1], p[1] + '|' + p[0]])));
    const stuck = new Set(); const pendingWelds = [];
    if (stickKeys.size) world.on('post-solve', (contact) => {
      const ida = (contact.getFixtureA().getBody().getUserData() || {}).id, idb = (contact.getFixtureB().getBody().getUserData() || {}).id; const k = ida + '|' + idb;
      if (!stickKeys.has(k) || stuck.has(k)) return; stuck.add(k); stuck.add(idb + '|' + ida);
      const wm = contact.getWorldManifold(null); const p = wm && wm.pointCount ? wm.points[0] : bodies[idb].getWorldCenter();
      pendingWelds.push({ a: ida, b: idb, x: p.x, y: p.y });
    });
    // Box2D reads a zero moment of inertia as "never rotates" (infinite inertia). A point-mass ball welded to a rod
    // would then lock the rod's rotation (0.5 regression: ball hits a hanging rod, rod stayed still). At the weld a
    // point body gets a negligible inertia so the pair turns together; its own spin before the hit is unchanged.
    function freeToTurn(body) {
      if (body.getType() !== 'dynamic' || body.getInertia() > 0) return;
      const m = body.getMass(), c = body.getLocalCenter(), f = body.getFixtureList();
      const s = Math.max(1e-3, f && f.getShape().getRadius ? f.getShape().getRadius() : 0.05);
      body.setMassData({ mass: m, center: c, I: m * (c.x * c.x + c.y * c.y) + 1e-4 * m * s * s });
    }
    function weldPending(t) {
      while (pendingWelds.length) { const w = pendingWelds.shift(); const jid = `stick_${w.a}_${w.b}`; freeToTurn(bodies[w.a]); freeToTurn(bodies[w.b]); const j = new planck.WeldJoint({}, bodies[w.a], bodies[w.b], V(w.x, w.y)); world.createJoint(j); joints[jid] = j; jmeta[jid] = { type: 'weld', label: 'F_stick' }; events.push({ t, label: `${w.a} sticks to ${w.b}` }); }
    }
    function keepOnCurves() {
      for (const c of curved) {
        if (stepNow - (lastTouch[c.key] ?? -99) > 1) continue;
        const A = bodies[c.a].getPosition(), B = bodies[c.b], P = B.getPosition(); const dx = P.x - A.x, dy = P.y - A.y, dist = Math.hypot(dx, dy), d = dist - c.rho;
        const v = B.getLinearVelocity(); const lift = (v.x * v.x + v.y * v.y) * dt * dt / c.rho + 1e-7;
        if (d > 0 && d < 2 * lift) { const k = (c.rho - 0.2 * planck.Settings.linearSlop) / dist; B.setTransform(V(A.x + dx * k, A.y + dy * k), B.getAngle()); }
      }
    }
    function snapshot(t) {
      const fr = { t, bodies: {}, forces: [], joints: {} };
      for (const id of bodyIds) {
        const b = bodies[id]; const p = b.getPosition(), v = b.getLinearVelocity(); const c = b.getWorldCenter(); const lc = b.getLocalCenter();
        // Box2D's getInertia() is about the body ORIGIN; I here is about the centre of mass (the one in ½Iω² and L = Iω)
        fr.bodies[id] = { x: p.x, y: p.y, a: b.getAngle(), vx: v.x, vy: v.y, w: b.getAngularVelocity(), cx: c.x, cy: c.y, m: b.getMass(), I: b.getInertia() - b.getMass() * (lc.x * lc.x + lc.y * lc.y) };
        if (meta[id].type !== 'static' && g) fr.forces.push({ body: id, kind: 'gravity', at: [c.x, c.y], vec: [0, -b.getMass() * g], label: 'mg' });
      }
      // merge contact forces per (body, other, kind) — a box on a plane has two manifold points, one resultant
      const acc = {};
      for (const f of contactForces) { if (!(f.body in bodies)) continue; const k = f.body + '|' + f.other + '|' + f.kind; const e = acc[k] || (acc[k] = { ...f, vec: [0, 0], at: [0, 0], n: 0 }); e.vec[0] += f.vec[0]; e.vec[1] += f.vec[1]; e.at[0] += f.at[0]; e.at[1] += f.at[1]; e.n++; }
      for (const e of Object.values(acc)) { e.at = [e.at[0] / e.n, e.at[1] / e.n]; delete e.n; if (Math.hypot(e.vec[0], e.vec[1]) > 1e-6) fr.forces.push({ ...e, label: e.kind === 'normal' ? 'N' : 'f' }); }
      contactForces = [];
      for (const [jid, j] of Object.entries(joints)) {
        const jm = jmeta[jid] || {}; let F; try { F = j.getReactionForce(1 / dt); } catch (e) { F = { x: 0, y: 0 }; }   // gear joints have no reaction before the first solve
        const aA = j.getAnchorA(), aB = j.getAnchorB();
        const idA = (j.getBodyA().getUserData() || {}).id || 'world', idB = (j.getBodyB().getUserData() || {}).id || 'world';
        const label = jm.label || ({ pivot: 'F_pivot', rope: 'T', rod: 'T', pulley: 'T', spring: 'F_spring', gear: 'T', slider: 'F_rail', weld: 'F', friction: 'f' }[jm.type] || jm.type);
        let tq = 0; try { tq = j.getReactionTorque(1 / dt); } catch (e) { }
        if (jm.type === 'pulley') {
          // Planck 1.5's pulley getter returns lambda*uB, whereas its solver
          // applies -lambda*uA to A and -ratio*lambda*uB to B. The two
          // ground anchors redirect the rope, so these are not opposite vectors.
          const gA = j.getGroundAnchorA(), gB = j.getGroundAnchorB();
          const ax = aA.x - gA.x, ay = aA.y - gA.y, bx = aB.x - gB.x, by = aB.y - gB.y;
          const lenA = Math.hypot(ax, ay), lenB = Math.hypot(bx, by);
          const load = lenB > 0 ? (F.x * bx + F.y * by) / lenB : 0;
          const forceA = lenA > 0 ? [-load * ax / lenA, -load * ay / lenA] : [0, 0];
          const forceB = [-j.getRatio() * F.x, -j.getRatio() * F.y];
          fr.joints[jid] = { type: jm.type, force: forceB, forceA, forceB, torque: tq, anchorA: [aA.x, aA.y], anchorB: [aB.x, aB.y], a: idA, b: idB };
          if (idA in bodies && meta[idA].type !== 'static') fr.forces.push({ body: idA, kind: 'joint', joint: jid, at: [aA.x, aA.y], vec: forceA, label });
          if (idB in bodies && meta[idB].type !== 'static') fr.forces.push({ body: idB, kind: 'joint', joint: jid, at: [aB.x, aB.y], vec: forceB, label });
          continue;
        }
        fr.joints[jid] = { type: jm.type, force: [F.x, F.y], torque: tq, anchorA: [aA.x, aA.y], anchorB: [aB.x, aB.y], a: idA, b: idB };
        if (jm.type === 'gear') {
          // Box2D's gear reaction is impulse·J_AC: the force ON ITS BODY A (joint1's moving body). Body B (joint2's) feels a torque, not a force.
          if (idA in bodies && meta[idA].type !== 'static') fr.forces.push({ body: idA, kind: 'joint', joint: jid, at: [aA.x, aA.y], vec: [F.x, F.y], label });
          continue;
        }
        // every other Box2D joint: the reaction force is the force ON BODY B
        if (idB in bodies && meta[idB].type !== 'static') fr.forces.push({ body: idB, kind: 'joint', joint: jid, at: [aB.x, aB.y], vec: [F.x, F.y], label });
        if (idA in bodies && meta[idA].type !== 'static') fr.forces.push({ body: idA, kind: 'joint', joint: jid, at: [aA.x, aA.y], vec: [-F.x, -F.y], label });
      }
      for (const f of spec.forces || []) {
        if (t < (f.from ?? 0) || t > (f.to ?? Infinity)) continue;
        const b = fr.bodies[f.body];
        fr.forces.push({ body: f.body, kind: 'applied', at: [b.cx + (f.offset?.[0] || 0), b.cy + (f.offset?.[1] || 0)], vec: [f.F[0], f.F[1]], label: f.label || 'F' });
      }
      return fr;
    }
    frames.push(snapshot(0));
    for (let i = 0; i < steps; i++) {
      const t = i * dt;
      for (const imp of pending) if (!imp.done && t >= (imp.t || 0) - 1e-9) { const b = bodies[imp.body]; const at = imp.at === 'center' || !imp.at ? b.getWorldCenter() : V(imp.at[0], imp.at[1]); b.applyLinearImpulse(V(imp.J[0], imp.J[1]), at, true); imp.done = true; events.push({ t, label: 'impulse on ' + imp.body }); }
      for (const f of spec.forces || []) { if (t < (f.from ?? 0) || t > (f.to ?? Infinity)) continue; const b = bodies[f.body]; const c = b.getWorldCenter(); b.applyForce(V(f.F[0], f.F[1]), V(c.x + (f.offset?.[0] || 0), c.y + (f.offset?.[1] || 0)), true); }
      stepNow = i; world.step(dt, VEL_IT, POS_IT); keepOnCurves(); weldPending((i + 1) * dt);
      // Capture every solver-step contact before clearing it. Values are already
      // impulse / integration dt; averaging later preserves their total impulse.
      if (stride > 1) {
        contactSamples++;
        for (const f of contactForces) if (f.body in bodies) {
          const key = f.body + '|' + f.other + '|' + f.kind;
          const sum = contactBucket.get(key) || { ...f, vec: [0, 0], at: [0, 0], n: 0, label: f.kind === 'normal' ? 'N' : 'f' };
          sum.vec[0] += f.vec[0]; sum.vec[1] += f.vec[1]; sum.at[0] += f.at[0]; sum.at[1] += f.at[1]; sum.n++; contactBucket.set(key, sum);
        }
      }
      const boundary = (i + 1) % stride === 0 || i + 1 === steps;
      // stopWhen still receives every real solver state. Otherwise avoid building
      // body/joint objects for snapshots that will not be retained on the phone.
      let fr = null;
      if (stride === 1 || boundary || i === 0 || opts.stopWhen) fr = snapshot((i + 1) * dt);
      else contactForces = [];
      if (stride > 1 && i === 0) firstStep = fr;
      const stopped = !!(opts.stopWhen && opts.stopWhen(fr));
      if (boundary || stopped) {
        if (stride > 1) {
          const averaged = [...contactBucket.values()].filter(f => Math.hypot(...f.vec) / contactSamples > 1e-6).map(f => {
            const out = { ...f, vec: f.vec.map(x => x / contactSamples), at: f.at.map(x => x / f.n) }; delete out.n; return out;
          });
          fr.forces = fr.forces.filter(f => f.kind !== 'normal' && f.kind !== 'friction').concat(averaged);
          contactBucket.clear(); contactSamples = 0;
        }
        frames.push(fr);
      }
      if (stopped) { events.push({ t: fr.t, label: 'stop' }); break; }
    }
    const retainedDt = stride > 1 && frames.length === 2 ? frames[1].t : sampleDt;
    cleanContacts(frames, Math.max(1, Math.round(0.0125 / retainedDt)), Math.max(1, Math.round(0.0085 / retainedDt)));   // 12.5 ms gaps, ±8.5 ms smoothing, whatever the rate
    // frame 0 is taken before any solve, so it carries no contact or joint forces; at t = 0 they equal the first step's
    if (frames.length > 1) { const first = firstStep || frames[1]; frames[0].forces = frames[0].forces.filter(f => f.kind === 'gravity' || f.kind === 'applied').concat(first.forces.filter(f => f.kind !== 'gravity' && f.kind !== 'applied').map(f => ({ ...f }))); frames[0].joints = JSON.parse(JSON.stringify(first.joints)); }
    if (stride === 1) return { frames, events, dt, duration: frames[frames.length - 1].t, spec };
    // The normal grid is uniform. An off-grid duration/early stop retains its exact
    // terminal state as one shorter final interval; frameAt handles that interval.
    const terminalStep = frames.length > 1 && Math.abs(frames.at(-1).t - frames.at(-2).t - retainedDt) > 1e-10;
    return { frames, events, dt: retainedDt, duration: frames[frames.length - 1].t, spec, integrationDt: dt, retentionStride: stride, terminalStep };
  }

  /* Box2D contacts chatter: a resting or rolling contact skips its impulse for a step now and then, and the next step
     catches up with a double one. Fill gaps of up to GAP steps between two live readings, then smooth each contact
     force over a short centred window. The physics is untouched — this cleans the FORCE READOUT only. */
  function cleanContacts(frames, GAP, WIN) {
    GAP = GAP ?? 3; WIN = WIN ?? 2;
    const isC = f => f.kind === 'normal' || f.kind === 'friction';
    const key = f => f.body + '|' + f.other + '|' + f.kind;
    const keys = new Set(); for (const fr of frames) for (const f of fr.forces) if (isC(f)) keys.add(key(f));
    for (const k of keys) {
      const at = frames.map(fr => fr.forces.find(f => isC(f) && key(f) === k) || null);
      for (let i = 1; i < frames.length; i++) {
        if (at[i] || !at[i - 1]) continue;
        let j = i; while (j < frames.length && !at[j]) j++;
        if (j >= frames.length || j - i > GAP) { i = j; continue; }
        const a = at[i - 1], b = at[j];
        for (let m = i; m < j; m++) { const s = (m - i + 1) / (j - i + 1); const g = { ...a, at: [a.at[0] + (b.at[0] - a.at[0]) * s, a.at[1] + (b.at[1] - a.at[1]) * s], vec: [a.vec[0] + (b.vec[0] - a.vec[0]) * s, a.vec[1] + (b.vec[1] - a.vec[1]) * s], filled: true }; frames[m].forces.push(g); at[m] = g; }
        i = j;
      }
      if (WIN > 0) {
        const raw = at.map(f => f && [f.vec[0], f.vec[1]]);
        for (let i = 0; i < at.length; i++) {
          if (!at[i]) continue; let sx = 0, sy = 0, n = 0;
          for (let m = Math.max(0, i - WIN); m <= Math.min(at.length - 1, i + WIN); m++) { if (!raw[m]) { n = 0; break; } sx += raw[m][0]; sy += raw[m][1]; n++; }
          if (n) at[i].vec = [sx / n, sy / n];
        }
      }
    }
  }
  function frameAt(sim, t) {
    if (sim.terminalStep && sim.frames.length > 1) {
      const last = sim.frames.length - 1, before = sim.frames[last - 1].t;
      if (t >= before) return sim.frames[t < (before + sim.frames[last].t) / 2 ? last - 1 : last];
    }
    const i = Math.min(sim.frames.length - 1, Math.max(0, Math.round(t / sim.dt))); return sim.frames[i];
  }

  window.Kinema2D = { build, simulate, frameAt, compileExpr, integrateProfile, DT, INERTIA };
})();
