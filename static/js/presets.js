/* The chapter-8 scenes as GENERAL specs (no template physics): the model's examples, and the oracle tests.
   Each returns a spec for Kinema2D from the same params the closed-form templates use. */
(function () {
  const P = {};
  const beta = s => ({ solid_cylinder: 0.5, solid_sphere: 0.4, hoop: 1.0, spherical_shell: 2 / 3 })[s];

  P.rolling_incline = p => {
    const th = p.angle * Math.PI / 180, L = p.length, R = p.radius, h = L * Math.sin(th), w = L * Math.cos(th);
    const shapeI = p.shape === 'custom' ? p.beta * p.mass * R * R : { solid_cylinder: 'solid_cylinder', solid_sphere: 'solid_sphere', hoop: 'hoop', spherical_shell: 'shell' }[p.shape];
    const mu = Math.min(3, p.mu);
    return {
      gravity: p.g, duration: Math.sqrt(2 * L / (p.g * Math.sin(th) / (1 + (p.shape === 'custom' ? p.beta : beta(p.shape))))) + 0.5,
      bodies: [
        { id: 'ramp', type: 'static', shape: 'polygon', points: [[0, 0], [w, 0], [0, h]], friction: mu, render: { kind: 'slab' } },
        { id: 'floor', type: 'static', shape: 'edge', points: [[-2, 0], [w + 20, 0]], friction: mu, render: { kind: 'floor' } },
        { id: 'ball', shape: 'circle', r: R, mass: p.mass, inertia: shapeI, pos: [R * Math.sin(th), h + R * Math.cos(th)], friction: mu, restitution: 0,
          render: { kind: p.shape === 'solid_sphere' || p.shape === 'spherical_shell' ? 'sphere' : 'disk' }, label: 'ball' },
      ],
      focus: 'ball', facts: { angle: th, w, h },
    };
  };

  P.atwood_pulley = p => {
    const R = p.radius, top = p.drop + 1.2 + 4 * R;
    const boxes = m => 0.35 + 0.05 * Math.sqrt(m);
    return {
      gravity: p.g, duration: Math.sqrt(2 * p.drop / Math.max(1e-3, Math.abs((p.m1 - p.m2) * p.g / (p.m1 + p.m2 + p.pulley_beta * p.pulley_mass)))) + 0.4,
      bodies: [
        { id: 'pulley', shape: 'circle', r: R, mass: Math.max(1e-6, p.pulley_mass), inertia: p.pulley_beta * Math.max(1e-6, p.pulley_mass) * R * R, pos: [0, top], render: { kind: 'disk' }, label: 'pulley' },
        { id: 'm1', shape: 'box', w: boxes(p.m1), h: 0.45, mass: p.m1, inertia: 'plate', pos: [-R, top - 3 * R], render: { kind: 'box' }, label: 'm₁' },
        { id: 'm2', shape: 'box', w: boxes(p.m2), h: 0.45, mass: p.m2, inertia: 'plate', pos: [R, top - 3 * R - p.drop], render: { kind: 'box' }, label: 'm₂' },
        { id: 'floor', type: 'static', shape: 'edge', points: [[-3, -0.001], [3, -0.001]], render: { kind: 'floor' } },
      ],
      joints: [
        { id: 'axle', type: 'pivot', a: 'world', b: 'pulley', anchor: [0, top], label: 'axle' },
        { id: 'rail1', type: 'slider', a: 'world', b: 'm1', anchor: [-R, top - 3 * R], axis: [0, 1] },
        { id: 'rail2', type: 'slider', a: 'world', b: 'm2', anchor: [R, top - 3 * R - p.drop], axis: [0, 1] },
        // the string does not slip on the pulley: translation + ratio*angle = const  (m1 down ↔ pulley CCW ↔ m2 up)
        { id: 'string1', type: 'gear', a: 'm1', b: 'pulley', joint1: 'rail1', joint2: 'axle', ratio: R, label: 'T₁' },
        { id: 'string2', type: 'gear', a: 'm2', b: 'pulley', joint1: 'rail2', joint2: 'axle', ratio: -R, label: 'T₂' },
      ],
      ropes: [['m1', [-R, top]], ['m2', [R, top]]],
      // one string: up from m₁'s top, over the pulley (clockwise from the left side), down to m₂; each side carries its own tension
      strings: [{ id: 'string', via: [{ body: 'm1', attach: 'top' }, { wrap: 'pulley', ccw: false }, { body: 'm2', attach: 'top' }], tension: ['string1', 'string2'], labels: ['T₁', 'T₂'] }],
      nocollide: [['m1', 'm2'], ['m1', 'pulley'], ['m2', 'pulley']],      // the boxes pass each other beside the pulley
      focus: 'm1',
    };
  };

  P.falling_rod = p => {
    const L = p.length, th0 = p.theta0 * Math.PI / 180;
    return {
      gravity: p.g, duration: Math.min(20, 2.2 * Math.PI * Math.sqrt(2 * L / (3 * p.g))),
      bodies: [{ id: 'rod', shape: 'box', w: L, h: Math.max(0.02, L * 0.035), mass: p.mass, inertia: 'rod', pos: [L / 2 * Math.cos(th0), L / 2 * Math.sin(th0)], angle: th0, render: { kind: 'rod' }, label: 'rod' }],
      joints: [{ id: 'pivot', type: 'pivot', a: 'world', b: 'rod', anchor: [0, 0], label: 'F_pivot' }],
      focus: 'rod',
    };
  };

  P.physical_pendulum = p => {
    const th = p.theta0 * Math.PI / 180;
    if (p.body === 'disk_rim') { const R = p.size; return { gravity: p.g, duration: Math.min(30, 2.5 * 2 * Math.PI * Math.sqrt(1.5 * R / p.g)),
      bodies: [{ id: 'disk', shape: 'circle', r: R, mass: p.mass, inertia: 'solid_cylinder', pos: [R * Math.sin(th), -R * Math.cos(th)], render: { kind: 'disk' }, label: 'disk' }],
      joints: [{ id: 'pivot', type: 'pivot', a: 'world', b: 'disk', anchor: [0, 0], label: 'F_pivot' }], focus: 'disk' }; }
    const L = p.size, d = p.body === 'rod_end' ? L / 2 : p.d;
    const I = p.body === 'rod_end' ? p.mass * L * L / 3 : p.mass * L * L / 12 + p.mass * d * d;
    return { gravity: p.g, duration: Math.min(30, 2.5 * 2 * Math.PI * Math.sqrt(I / (p.mass * p.g * d))),
      bodies: [{ id: 'rod', shape: 'box', w: Math.max(0.02, L * 0.035), h: L, mass: p.mass, inertia: 'rod', pos: [d * Math.sin(th), -d * Math.cos(th)], angle: th, render: { kind: 'rod' }, label: 'rod' }],
      // the rod's centre sits d below the pivot along the rod; the box is L tall centred on its CM, so the pivot is at local (0, +d)
      joints: [{ id: 'pivot', type: 'pivot', a: 'world', b: 'rod', anchor: [0, 0], label: 'F_pivot' }], focus: 'rod' };
  };

  P.ball_stick = p => {
    // the closed form treats the ball as a POINT on the stick's line; a drawn ball of radius rb sits rb + half the stick's
    // thickness beside that line, which raises the stuck pair's inertia by a few % — the oracle passes a tiny ball_radius
    const D0 = Math.max(0.8, 0.6 * p.ball_speed), rb = p.ball_radius ?? (0.07 + 0.02 * Math.sqrt(p.ball_mass));
    return { gravity: 0, duration: D0 / p.ball_speed + 2.0,
      bodies: [
        { id: 'stick', shape: 'box', w: 0.04, h: p.stick_length, mass: p.stick_mass, inertia: 'rod', pos: [0, 0], friction: 0, restitution: p.collision === 'elastic' ? 1 : 0, render: { kind: 'rod' }, label: 'stick' },
        { id: 'ball', shape: 'circle', r: rb, mass: p.ball_mass, inertia: 'solid_sphere', pos: [-D0 - rb - 0.02, p.hit_offset], vel: [p.ball_speed, 0], friction: 0, restitution: p.collision === 'elastic' ? 1 : 0, bullet: true, render: { kind: 'sphere' }, label: 'ball' },
      ],
      topdown: true, focus: 'stick', stick: p.collision === 'sticks' ? [['ball', 'stick']] : [] };
  };

  P.struck_ball = p => {
    const R = p.radius, v0 = p.impulse / p.mass, w0 = p.impulse * p.h / (0.4 * p.mass * R * R);
    const slip = v0 - w0 * R, tR = p.mu > 0 ? Math.abs(slip) / (3.5 * p.mu * p.g) : 4;
    return { gravity: p.g, duration: Math.min(20, tR + 1.5),
      bodies: [
        { id: 'table', type: 'static', shape: 'edge', points: [[-1, 0], [200, 0]], friction: p.mu, render: { kind: 'floor' } },
        { id: 'ball', shape: 'circle', r: R, mass: p.mass, inertia: 'solid_sphere', pos: [0, R], friction: p.mu, restitution: 0, render: { kind: 'sphere' }, label: 'ball' },
      ],
      impulses: [{ body: 'ball', at: [0, R + p.h], J: [p.impulse, 0], t: 0 }],
      focus: 'ball' };
  };

  P.disk_on_disk = p => {
    const r1 = 0.6, r2 = 0.95, wf = (p.I1 * p.omega1 + p.I2 * p.omega2) / (p.I1 + p.I2);
    const tau = Math.abs(p.I1 * (wf - p.omega1)) / p.coupling_time;                  // constant friction torque that locks them at t = coupling_time
    return { gravity: 0, duration: p.coupling_time + 2,
      bodies: [
        { id: 'top', shape: 'circle', r: r1, mass: p.I1 / (0.5 * r1 * r1), inertia: p.I1, pos: [0, 0], omega: p.omega1, friction: 0, render: { kind: 'disk', z: 0.32 }, label: 'I₁' },   // drawn above the bottom disk
        { id: 'bottom', shape: 'circle', r: r2, mass: p.I2 / (0.5 * r2 * r2), inertia: p.I2, pos: [0, 0], omega: p.omega2, friction: 0, render: { kind: 'disk' }, label: 'I₂' },
      ],
      joints: [
        { id: 'axle1', type: 'pivot', a: 'world', b: 'top', anchor: [0, 0] }, { id: 'axle2', type: 'pivot', a: 'world', b: 'bottom', anchor: [0, 0] },
        { id: 'rub', type: 'friction', a: 'top', b: 'bottom', anchor: [0, 0], maxForce: 0, maxTorque: tau, label: 'friction torque' },
      ],
      topdown: true, focus: 'top', nocollide: [['top', 'bottom']] };
  };

  P.ball_leaves_sphere = p => {
    const Rs = p.R, r = p.r, rho = Rs + r, th0 = 0.02;
    // the closed form assumes rolling WITHOUT slipping all the way down; with a realistic μ the ball slips near the top of
    // its run (f needed = 2/7 mg sinθ while N → 0) and leaves ~2° early, so the no-slip statement gets a no-slip μ
    const mu = p.mu ?? 30;
    // ends shortly after the landing: a long roll-out along the floor would drag the camera's scene box with it
    return { gravity: p.g, duration: Math.min(8, 1.9 * Math.sqrt(2 * (Rs + r) / p.g) + 2.0 * Math.sqrt(Rs / 1.2)),
      bodies: [
        { id: 'sphere', type: 'static', shape: 'circle', r: Rs, pos: [0, Rs], friction: mu, render: { kind: 'sphere', color: 'slab' } },
        { id: 'floor', type: 'static', shape: 'edge', points: [[-4, 0], [8, 0]], friction: 0.6, render: { kind: 'floor' } },
        { id: 'ball', shape: 'circle', r, mass: 1, inertia: Math.max(1e-6, p.beta) * r * r, pos: [rho * Math.sin(th0), Rs + rho * Math.cos(th0)], vel: [p.nudge * Math.cos(th0), -p.nudge * Math.sin(th0)], omega: -p.nudge / r, friction: mu, restitution: 0, render: { kind: 'sphere' }, label: 'ball' },
      ],
      focus: 'ball' };
  };

  P.spool_pull = p => {
    const R = p.R, r = p.r, phi = p.phi * Math.PI / 180;
    return { gravity: p.g, duration: 4,
      bodies: [
        { id: 'floor', type: 'static', shape: 'edge', points: [[-20, 0], [40, 0]], friction: p.mu, render: { kind: 'floor' } },
        { id: 'spool', shape: 'circle', r: R, mass: p.mass, inertia: p.beta * p.mass * R * R, pos: [0, R], friction: p.mu, restitution: 0, render: { kind: 'disk', inner: r }, label: 'spool' },
      ],
      // the string leaves the inner drum tangentially at angle φ: it pulls at the world offset r·(sinφ, −cosφ) from the centre
      forces: [{ body: 'spool', F: [p.tension * Math.cos(phi), p.tension * Math.sin(phi)], offset: [r * Math.sin(phi), -r * Math.cos(phi)], label: 'T' }],
      // the drawn string: from the drum's tangent point out along the pull, to a hand well off-screen; its tension is the applied force 'T'
      strings: [{ id: 'string', via: [{ body: 'spool', attach: [r * Math.sin(phi), -r * Math.cos(phi)] }, { world: [12 * Math.cos(phi), R + 12 * Math.sin(phi) - r * Math.cos(phi)] }], tension: ['T'], labels: ['T'] }],
      focus: 'spool' };
  };

  window.KinemaPresets = P;
  // one shared set of defaults + titles: sim.html renders them, tools/dump_presets.js turns them into the model's examples
  window.KinemaPresetDefaults = {
    rolling_incline: { shape: 'solid_sphere', beta: 0.4, mass: 1, radius: 0.35, angle: 30, length: 5, mu: 1, g: 9.8 },
    atwood_pulley: { m1: 3, m2: 2, pulley_mass: 2, pulley_beta: 0.5, radius: 0.25, drop: 2, g: 9.8 },
    falling_rod: { mass: 1, length: 1.2, theta0: 0, g: 9.8 },
    physical_pendulum: { body: 'rod_end', mass: 1, size: 1.2, d: 0.6, I_pivot: 0.48, theta0: 40, g: 9.8 },
    ball_stick: { ball_mass: 0.5, ball_speed: 4, stick_mass: 1, stick_length: 1, hit_offset: 0.3, collision: 'elastic' },
    struck_ball: { mass: 0.17, radius: 0.06, impulse: 0.5, h: 0, mu: 0.2, g: 9.8 },
    disk_on_disk: { I1: 0.5, omega1: 10, I2: 1.0, omega2: 0, coupling_time: 1.5 },
    ball_leaves_sphere: { R: 1.2, r: 0.16, beta: 0.4, nudge: 0.02, g: 9.8 },
    spool_pull: { mass: 1, R: 0.3, r: 0.15, beta: 0.5, tension: 3, phi: 20, mu: 1, g: 9.8 },
  };
  window.KinemaPresetTitles = {
    rolling_incline: ['Solid ball on a 30° incline', 'rolling emerges from friction'], atwood_pulley: ['Atwood machine, massive pulley', 'string constraint on a pulley with inertia'],
    falling_rod: ['Rod released from horizontal', 'pivot'], physical_pendulum: ['Physical pendulum', 'pivot'], ball_stick: ['Ball hits a free stick', 'contact impulse, top view'],
    struck_ball: ['Cue ball, struck at the centre', 'slip then roll'], disk_on_disk: ['Disk dropped onto a disk', 'friction torque, top view'],
    ball_leaves_sphere: ['Ball rolling off a sphere', 'leaves when the contact force vanishes'], spool_pull: ['Spool pulled by its string', 'which way does it roll'],
  };
})();
