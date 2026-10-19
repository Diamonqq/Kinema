"""Prepared Morin setups for the visual library (app/visual_library.py).

Each builder returns an unvalidated tutor lesson. The app's own engines simulate it (planar planck engine,
rigid3d integrator) or draw it (plot, diagram); checks are physics predictions computed here from the stated
values, never numbers read back from an engine. Restatements are generic setups with illustrative values,
not the book's wording.
"""
from __future__ import annotations

import copy
import json
import math

from . import rigid3d, scenes, tutor

G = 9.8
S = tutor._step
BUILDERS: dict = {}


def recipe(rid: str):
    def register(fn):
        BUILDERS[rid] = fn
        return fn
    return register


def _sig(x: float) -> float:
    """Six significant figures: small moments of inertia keep their precision."""
    return 0.0 if abs(x) < 1e-12 else float(f"{x:.6g}")


def _ans(label: str, expression: str, value=None, units: str = "", note: str = "") -> dict:
    return {"label": label, "expression": expression, "value": None if value is None else _sig(value), "units": units, "note": note}


def _chk(label: str, quantity: str, expect: float, *, at=None, body=None, joint=None, tol: float = 3) -> dict:
    return {"label": label, "quantity": quantity, "body": body, "joint": joint, "at": at, "expect": _sig(expect), "tol_pct": tol}


def _rchk(label: str, quantity: str, expect: float, *, at=None, tol: float = 2) -> dict:
    return {"label": label, "quantity": quantity, "at": at, "expect": _sig(expect), "tol_pct": tol}


def _scene(title: str, steps: list[dict], *, bodies: list, duration: float, focus: str, gravity: float = G, joints=(),
           forces=(), impulses=(), strings=(), ropes=(), nocollide=(), checks=(), topdown=False, camera=None) -> dict:
    """A planar scene in the engine format. Every body carries an explicit position; scene steps mirror the lesson."""
    shows = set(scenes.STEP_SHOWS)
    return {"title": title, "gravity": gravity, "duration": duration, "topdown": topdown, "focus": focus, "camera": camera,
            "bodies": bodies, "joints": list(joints), "forces": list(forces), "impulses": list(impulses),
            "strings": list(strings), "ropes": list(ropes), "nocollide": list(nocollide), "checks": list(checks),
            "steps": [{"title": s["title"], "body": s["body"], "at": s["at"], "show": [x for x in s["show"] if x in shows],
                       "camera": s["camera"], "highlight": [], "actions": []} for s in steps]}


def _floor(x0: float, x1: float, y: float = 0.0, mu: float = 0.5, bid: str = "floor") -> dict:
    return {"id": bid, "type": "static", "shape": "edge", "pos": [0, 0], "points": [[x0, y], [x1, y]], "friction": mu, "render": {"kind": "floor"}}


def _part(pid: str, shape: str, mass: float, center, *, axis=None, radius=None, length=None, size=None, color="steel", prop=None) -> dict:
    return {"id": pid, "shape": shape, "mass": mass, "center": list(center), "axis": None if axis is None else list(axis),
            "radius": radius, "length": length, "size": None if size is None else list(size), "color": color, "prop": prop}


def _motion(mtype: str, *, pivot=None, pivot_world=(0, 0, 0), support="none", theta=0.0, phi=0.0, prec=None, spin=None,
            nut=None, axis=None, omega=None, impulse=None) -> dict:
    return {"type": mtype, "pivot": None if pivot is None else list(pivot), "pivot_world": list(pivot_world), "support": support,
            "theta_deg": theta, "phi_deg": phi, "precession_rate": prec, "spin_rate": spin, "nutation_rate": nut,
            "axis": None if axis is None else list(axis), "omega": omega, "impulse": impulse}


def _r3(label: str, parts: list, sym, motion: dict, *, duration: float, show: list, checks=(), references=None,
        ground=False, gravity: float = G) -> dict:
    return {"gravity": gravity, "duration": duration, "ground": ground,
            "body": {"label": label, "symmetry_axis": list(sym), "parts": parts}, "motion": motion,
            "show": list(show), "references": references, "checks": list(checks)}


def _rotated(cx: float, cy: float, deg: float, pts):
    a = math.radians(deg)
    return [[round(cx + x * math.cos(a) - y * math.sin(a), 6), round(cy + x * math.sin(a) + y * math.cos(a), 6)] for x, y in pts]


def _experiment(title, question, givens, steps, scene, answers, assumptions):
    return tutor._lesson("Mechanics · illustrative experiment", title, question, givens,
        answers, steps, "mechanics", scene,
        "Illustrative planar experiment; x right, y up. Not an exact numbered book problem.",
        assumptions, plan="Identify the constraint, predict the motion, then play and compare.")


def _bob(bid, pos, mass=1, vel=None):
    b = {"id": bid, "shape": "circle", "r": 0.12, "mass": mass,
         "inertia": "point", "pos": pos, "friction": 0, "restitution": 0,
         "label": bid, "render": {"kind": "sphere"}}
    if vel is not None:
        b["vel"] = vel
    return b


# ---------------------------------------------------------------- ch. 3: forces and F = ma

@recipe("block_on_incline")
def block_on_incline():
    th, L, mu, m = 30.0, 3.0, 0.2, 1.0
    t = math.radians(th)
    w, h = L * math.cos(t), L * math.sin(t)
    a = G * (math.sin(t) - mu * math.cos(t))
    # illustrative sizes (the answers do not depend on them): a block a fifth of the slope, so the forces on it read;
    # it slides 1.9 m in 1.1 s and stays on the 3 m slope
    bw, bh, s = 0.6, 0.45, 0.3
    cx = s * math.cos(t) + bh / 2 * math.sin(t)
    cy = h - s * math.sin(t) + bh / 2 * math.cos(t) + 0.002
    steps = [S("Axes along the slope", r"The arrows drawn are the fixed axes: $x$ right, $y$ up. For the algebra, tilt them: $x'$ down the slope, "
               r"$y'$ along the outward normal. Then only gravity has two components: $mg\sin\theta$ along $x'$ and $mg\cos\theta$ into the slope.",
               at=0, show=["forces", "labels", "axes"], camera="side"),
             S("Normal force and friction", r"No motion along $y'$: $N=mg\cos\theta=%.2f$ N. Kinetic friction opposes sliding: $f=\mu N=%.2f$ N." % (m * G * math.cos(t), mu * m * G * math.cos(t)),
               at=0.3, show=["forces", "labels"], camera="side"),
             S("Acceleration", r"$ma=mg\sin\theta-\mu mg\cos\theta$, so $a=g(\sin\theta-\mu\cos\theta)=%.2f$ m/s², independent of $m$. "
               r"In the fixed x/y axes that is $a_x=a\cos\theta$, $a_y=-a\sin\theta$." % a, show=["velocity", "labels", "trail"], camera="side")]
    scene = _scene("Block sliding down a rough incline", steps, duration=1.1, focus="block", bodies=[
        {"id": "ramp", "type": "static", "shape": "polygon", "pos": [0, 0], "points": [[0, 0], [w, 0], [0, h]], "friction": mu, "render": {"kind": "slab", "prop": "ramp"}},
        _floor(-0.4, w + 0.8, mu=mu),
        {"id": "block", "shape": "box", "w": bw, "h": bh, "mass": m, "inertia": "plate", "pos": [round(cx, 5), round(cy, 5)], "angle_deg": -th,
         "friction": mu, "restitution": 0, "label": "m", "render": {"kind": "box", "prop": "block"}}],
        checks=[_chk("acceleration a_x = a cos θ", "ax", a * math.cos(t), at=0.6, body="block"),
                _chk("acceleration a_y = −a sin θ", "ay", -a * math.sin(t), at=0.6, body="block"),
                _chk("normal force mg cos θ", "normal", m * G * math.cos(t), at=0.6, body="block"),
                _chk("speed after 1 s = a·t", "speed", a * 1.0, at=1.0, body="block")])
    return tutor._lesson("Mechanics · F = ma on an incline (Morin ch. 3)", "Block on a rough incline",
        "A block of mass m slides down a fixed incline of angle θ with kinetic friction coefficient μ, starting from rest. Find the normal force and the acceleration.",
        ["θ = 30°", "μ = 0.2 (kinetic)", "m = 1 kg", "starts from rest", "g = 9.8 m/s²"],
        [_ans("Normal force", r"N=mg\cos\theta", m * G * math.cos(t), "N"),
         _ans("Acceleration", r"a=g(\sin\theta-\mu\cos\theta)", a, "m/s²", "Down the slope; needs tan θ > μ to start.")],
        steps, "mechanics", scene, "Planar simulation: block sliding on a fixed 30° ramp with μ = 0.2. x right, y up.",
        ["Rigid block, uniform kinetic friction, no air drag."], plan="Choose slope axes, balance forces normal to the slope, then apply F = ma along it.")


@recipe("block_on_free_wedge")
def block_on_free_wedge():
    th, M, m = 30.0, 2.0, 1.0
    t = math.radians(th)
    L = 3.0
    w, h = L * math.cos(t), L * math.sin(t)
    den = M + m * math.sin(t) ** 2
    A = m * G * math.sin(t) * math.cos(t) / den
    arel = (M + m) * G * math.sin(t) / den
    N = M * m * G * math.cos(t) / den
    # illustrative sizes (the answers do not depend on them): the block slides 1.8 m along the slope in 0.75 s and stays on it
    bw, bh, s = 0.56, 0.42, 0.3
    cx = s * math.cos(t) + bh / 2 * math.sin(t)
    cy = h - s * math.sin(t) + bh / 2 * math.cos(t) + 0.002
    steps = [S("Two bodies, one contact", r"Everything is frictionless. The block pushes the wedge with $N$ perpendicular to the slope; "
               r"its horizontal part $N\sin\theta$ drives the wedge left.", at=0, show=["forces", "labels"], camera="side"),
             S("Constraint", r"Relative to the wedge the block moves along the slope. With wedge acceleration $A$ (left) and relative "
               r"acceleration $a'$: $a_x=a'\cos\theta-A$, $a_y=-a'\sin\theta$.", at=0.2, show=["velocity", "labels"], camera="side"),
             S("Solve", r"$A=\dfrac{mg\sin\theta\cos\theta}{M+m\sin^2\theta}=%.3f$ m/s² and $N=\dfrac{Mmg\cos\theta}{M+m\sin^2\theta}=%.2f$ N, "
               r"smaller than $mg\cos\theta$ because the wedge gives way." % (A, N), show=["velocity", "trail", "labels"], camera="side")]
    scene = _scene("Block on a free wedge", steps, duration=0.75, focus="block", bodies=[
        _floor(-3, 4.5, mu=0),
        {"id": "wedge", "shape": "polygon", "pos": [0, 0.001], "points": [[0, 0], [w, 0], [0, h]], "mass": M, "friction": 0, "restitution": 0,
         "label": "M", "render": {"kind": "slab"}},
        {"id": "block", "shape": "box", "w": bw, "h": bh, "mass": m, "inertia": "plate", "pos": [round(cx, 5), round(cy, 5)], "angle_deg": -th,
         "friction": 0, "restitution": 0, "label": "m", "render": {"kind": "box", "prop": "block"}}],
        checks=[_chk("wedge acceleration (left)", "ax", -A, at=0.3, body="wedge"),
                _chk("block horizontal acceleration", "ax", arel * math.cos(t) - A, at=0.3, body="block"),
                _chk("block vertical acceleration", "ay", -arel * math.sin(t), at=0.3, body="block")])
    return tutor._lesson("Mechanics · F = ma, moving wedge (Morin ch. 3)", "Block on a free wedge",
        "A block of mass m is released on the frictionless slope (angle θ) of a wedge of mass M that can slide freely on a frictionless floor. Find the wedge's acceleration and the normal force.",
        ["θ = 30°", "M = 2 kg (wedge)", "m = 1 kg (block)", "all surfaces frictionless", "released from rest"],
        [_ans("Wedge acceleration", r"A=\dfrac{mg\sin\theta\cos\theta}{M+m\sin^2\theta}", A, "m/s²", "Leftward, away from the block."),
         _ans("Normal force", r"N=\dfrac{Mmg\cos\theta}{M+m\sin^2\theta}", N, "N")],
        steps, "mechanics", scene, "Planar simulation: both bodies are free; frictionless floor and slope. x right, y up.",
        ["Frictionless contacts; the wedge does not tip."], plan="Write F = ma for each body, add the constraint that the block stays on the slope, solve.")


@recipe("atwood_massive_pulley")
def atwood_massive_pulley():
    m1, m2, Mp, R = 3.0, 2.0, 2.0, 0.25
    I = 0.5 * Mp * R ** 2
    a = (m1 - m2) * G / (m1 + m2 + I / R ** 2)
    T1, T2 = m1 * (G - a), m2 * (G + a)
    pulley_y, y1, y2, mass_h, floor_y = 4.2, 3.45, 1.45, 0.45, -0.001
    # End the free-running clip before either finite-sized mass reaches an obstacle.
    # A 0.15 m gap below the physical rim also clears the decorative pulley flanges.
    # Round DOWN, leaving a natural playback end rather than inventing an impact/stop.
    clearance = 0.15
    travel = min(pulley_y - R - (y2 + mass_h / 2) - clearance,
                 y1 - mass_h / 2 - floor_y - clearance)
    duration = math.floor(100 * math.sqrt(2 * travel / a)) / 100
    steps = [S("Three equations", r"Down for $m_1$, up for $m_2$: $m_1g-T_1=m_1a$, $T_2-m_2g=m_2a$. The pulley: $(T_1-T_2)R=I\alpha$ with $a=R\alpha$.",
               at=0, show=["forces", "tensions", "labels"], camera="side"),
             S("Why the tensions differ", r"A massive pulley needs a net torque to spin up, so $T_1>T_2$. With $I=\tfrac12MR^2$: "
               r"$a=\dfrac{(m_1-m_2)g}{m_1+m_2+I/R^2}=%.3f$ m/s²." % a, at=0.5, show=["tensions", "labels"], camera="side"),
             S("Watch it run", r"$T_1=%.2f$ N, $T_2=%.2f$ N. Setting $I=0$ recovers the ideal Atwood result $(m_1-m_2)g/(m_1+m_2)$." % (T1, T2),
               show=["velocity", "tensions", "labels"], camera="side")]
    scene = _scene("Atwood machine with a massive pulley", steps, duration=duration, focus="m1", bodies=[
        {"id": "pulley", "shape": "circle", "r": R, "mass": Mp, "inertia": I, "pos": [0, pulley_y], "label": "pulley", "render": {"kind": "disk", "prop": "pulley"}},
        {"id": "m1", "shape": "box", "w": 0.44, "h": mass_h, "mass": m1, "inertia": "plate", "pos": [-R, y1], "label": "m₁", "render": {"kind": "box", "prop": "block"}},
        {"id": "m2", "shape": "box", "w": 0.42, "h": mass_h, "mass": m2, "inertia": "plate", "pos": [R, y2], "label": "m₂", "render": {"kind": "box", "prop": "block"}},
        _floor(-3, 3, y=floor_y)],
        joints=[{"id": "axle", "type": "pivot", "a": "world", "b": "pulley", "anchor": [0, pulley_y], "label": "axle"},
                {"id": "rail1", "type": "slider", "a": "world", "b": "m1", "anchor": [-R, y1], "axis": [0, 1]},
                {"id": "rail2", "type": "slider", "a": "world", "b": "m2", "anchor": [R, y2], "axis": [0, 1]},
                {"id": "string1", "type": "gear", "a": "m1", "b": "pulley", "joint1": "rail1", "joint2": "axle", "ratio": R, "label": "T₁"},
                {"id": "string2", "type": "gear", "a": "m2", "b": "pulley", "joint1": "rail2", "joint2": "axle", "ratio": -R, "label": "T₂"}],
        strings=[{"id": "string", "via": [{"body": "m1", "attach": "top"}, {"wrap": "pulley", "ccw": False}, {"body": "m2", "attach": "top"}],
                  "tension": ["string1", "string2"], "labels": ["T₁", "T₂"]}],
        nocollide=[["m1", "m2"], ["m1", "pulley"], ["m2", "pulley"]],
        checks=[_chk("m₁ accelerates down", "ay", -a, at=0.5, body="m1"), _chk("m₂ accelerates up", "ay", a, at=0.5, body="m2"),
                _chk("pulley spin rate a·t/R", "omega", a * 1.0 / R, at=1.0, body="pulley")])
    return tutor._lesson("Mechanics · Atwood with pulley inertia (Morin ch. 8)", "Atwood machine with a massive pulley",
        "Two masses hang from a string over a uniform disk pulley of mass M and radius R that turns without friction; the string does not slip. Find the acceleration and both tensions.",
        ["m₁ = 3 kg, m₂ = 2 kg", "pulley: uniform disk, M = 2 kg, R = 0.25 m", "string does not slip", "released from rest"],
        [_ans("Acceleration", r"a=\dfrac{(m_1-m_2)g}{m_1+m_2+I/R^2}", a, "m/s²"),
         _ans("Tension on the m₁ side", r"T_1=m_1(g-a)", T1, "N"), _ans("Tension on the m₂ side", r"T_2=m_2(g+a)", T2, "N")],
        steps, "mechanics", scene, "Planar simulation: the string is a no-slip constraint on a pulley with inertia. x right, y up. Playback ends before either mass reaches the pulley or floor; replay to watch again.",
        ["Massless, inextensible string that does not slip; frictionless axle."], plan="Newton's law for each mass, τ = Iα for the pulley, no-slip a = Rα.")


# ---------------------------------------------------------------- ch. 2–3: kinematics, drag

@recipe("projectile_launch")
def projectile_launch():
    v, th, y0 = 6.0, 45.0, 0.2   # a 6 m/s launch keeps the 3.7 m arc readable beside a 0.2 m ball
    t = math.radians(th)
    vx, vy = v * math.cos(t), v * math.sin(t)
    T, R, H = 2 * vy / G, v * v * math.sin(2 * t) / G, vy * vy / (2 * G)
    steps = [S("Split the motion", r"Horizontally nothing acts: $v_x=v_0\cos\theta$ stays %.2f m/s. Vertically $a_y=-g$." % vx,
               at=0, show=["velocity", "labels", "axes"], camera="side"),
             S("Top of the path", r"At the top $v_y=0$: $t=v_0\sin\theta/g=%.3f$ s, height $h=\dfrac{v_0^2\sin^2\theta}{2g}=%.2f$ m." % (vy / G, H),
               at=round(vy / G, 3), show=["velocity", "forces", "labels"], camera="side"),
             S("Range", r"Back to launch height after $T=2v_0\sin\theta/g=%.3f$ s, so $R=\dfrac{v_0^2\sin2\theta}{g}=%.2f$ m." % (T, R),
               at=round(T, 3), show=["trail", "velocity", "labels"], camera="side")]
    scene = _scene("Projectile launched at 45°", steps, duration=round(T + 0.2, 2), focus="ball", bodies=[
        _floor(-1, 6, y=0, mu=0),
        {"id": "ball", "shape": "circle", "r": y0, "mass": 0.5, "inertia": "solid_sphere", "pos": [0, y0], "vel": [round(vx, 5), round(vy, 5)],
         "friction": 0, "restitution": 0, "label": "ball", "render": {"kind": "sphere", "path": True, "launch_arc": True}}],   # the route and the launch angle are drawn in every step (no drag, so the ball radius does not touch the physics)
        checks=[_chk("v_x unchanged", "vx", vx, at=1.0, body="ball"), _chk("v_y = v₀ sin θ − g t", "vy", vy - G, at=1.0, body="ball"),
                _chk("height at the top", "y", y0 + H, at=round(vy / G, 4), body="ball", tol=1),
                _chk("x after 1 s", "x", vx, at=1.0, body="ball", tol=1)])
    scene["camera"] = "side"
    scene["frame"] = [[0, 0], [R, 0], [R / 2, H]]   # drawing only: the view holds the whole path (launch, top, landing)
    return tutor._lesson("Mechanics · projectile motion (Morin ch. 3)", "Projectile launched at 45°",
        "A ball is launched at speed v₀ and angle θ above the horizontal over level ground. Find the time of flight, the maximum height and the range (no air drag).",
        ["v₀ = 6 m/s", "θ = 45°", "no air drag", "g = 9.8 m/s²"],
        [_ans("Time of flight", r"T=\dfrac{2v_0\sin\theta}{g}", T, "s"), _ans("Maximum height", r"h=\dfrac{v_0^2\sin^2\theta}{2g}", H, "m"),
         _ans("Range", r"R=\dfrac{v_0^2\sin2\theta}{g}", R, "m", "Largest at 45° for fixed v₀.")],
        steps, "mechanics", scene, "Planar simulation without drag; the ball (radius 0.2 m) starts on the ground. x right, y up.",
        ["Point-like ball, no air resistance, uniform g."], plan="Treat x and y separately: constant v_x, uniformly accelerated y.")


# ---------------------------------------------------------------- ch. 4: oscillations

@recipe("spring_damped")
def spring_damped():
    k, m, z, x0 = 40.0, 1.0, 0.1, 0.3
    w0 = math.sqrt(k / m)
    wd = w0 * math.sqrt(1 - z * z)
    Td = 2 * math.pi / wd

    def x(t):
        return x0 * math.exp(-z * w0 * t) * (math.cos(wd * t) + z / math.sqrt(1 - z * z) * math.sin(wd * t))
    steps = [S("Equation of motion", r"$m\ddot x=-kx-b\dot x$. Write $\omega_0=\sqrt{k/m}=%.3f$ rad/s and damping ratio $\zeta=b/(2m\omega_0)=%.1f$." % (w0, z),
               at=0, show=["forces", "labels", "axes"], camera="side"),
             S("Underdamped solution", r"For $\zeta<1$: $x=Ae^{-\zeta\omega_0t}\cos(\omega_dt-\phi)$ with $\omega_d=\omega_0\sqrt{1-\zeta^2}=%.3f$ rad/s." % wd,
               at=round(Td / 2, 3), show=["velocity", "labels"], camera="side"),
             S("Decay per period", r"After one period $T_d=%.3f$ s the amplitude is multiplied by $e^{-\zeta\omega_0T_d}=%.3f$: %.3f m → %.3f m." % (Td, math.exp(-z * w0 * Td), x0, x(Td)),
               at=round(Td, 3), show=["trail", "labels"], camera="side")]
    scene = _scene("Damped spring oscillator", steps, duration=4.0, focus="block", bodies=[
        {"id": "wall", "type": "static", "shape": "box", "w": 0.1, "h": 1.0, "pos": [-1.05, 0.5], "render": {"kind": "box"}},
        _floor(-1.1, 1.5, y=0.29, mu=0),   # illustrative 0.4 m block (a third of the spring) riding just above the floor
        {"id": "block", "shape": "box", "w": 0.4, "h": 0.4, "mass": m, "inertia": "plate", "pos": [x0, 0.5], "friction": 0, "label": "m",
         "render": {"kind": "box", "prop": "block"}}],
        joints=[{"id": "rail", "type": "slider", "a": "world", "b": "block", "anchor": [0, 0.5], "axis": [1, 0]},
                {"id": "spring", "type": "spring", "a": "world", "b": "block", "anchorA": [-1.0, 0.5], "anchorB": [x0, 0.5], "k": k, "rest": 1.0,
                 "damping": z, "label": "F_spring"}],
        checks=[_chk("half a period later", "x", x(Td / 2), at=round(Td / 2, 4), body="block"),
                _chk("one period later", "x", x(Td), at=round(Td, 4), body="block")])
    return tutor._lesson("Mechanics · damped oscillator (Morin ch. 4)", "Damped mass on a spring",
        "A mass on a spring (stiffness k) with linear damping is pulled x₀ from equilibrium and released. Find the oscillation frequency and how much the amplitude shrinks in one period.",
        ["k = 40 N/m", "m = 1 kg", "damping ratio ζ = 0.1", "x₀ = 0.3 m, released from rest"],
        [_ans("Damped angular frequency", r"\omega_d=\omega_0\sqrt{1-\zeta^2}", wd, "rad/s"),
         _ans("Amplitude after one period", r"x_0e^{-\zeta\omega_0T_d}", x0 * math.exp(-z * w0 * Td), "m")],
        steps, "mechanics", scene, "Planar simulation: block on a frictionless rail, spring to the wall, x = 0 at equilibrium.",
        ["Linear spring and linear (viscous) damping."], plan="Write the ODE, use the underdamped solution, evaluate the decay over one period.")


@recipe("coupled_springs")
def coupled_springs():
    k, m, d = 40.0, 1.0, 0.2
    w1, w2 = math.sqrt(k / m), math.sqrt(3 * k / m)
    t1 = 0.5
    x1 = d / 2 * (math.cos(w1 * t1) + math.cos(w2 * t1))
    v1 = -d / 2 * (w1 * math.sin(w1 * t1) + w2 * math.sin(w2 * t1))
    v2 = -d / 2 * (w1 * math.sin(w1 * t1) - w2 * math.sin(w2 * t1))
    steps = [S("Two coupled equations", r"$m\ddot x_1=-kx_1-k(x_1-x_2)$ and $m\ddot x_2=-kx_2-k(x_2-x_1)$, with $x_1,x_2$ measured from equilibrium.",
               at=0, show=["forces", "labels"], camera="side"),   # the teaching view draws x from equilibrium; no x/y/z triad clutter
             S("Normal modes", r"Add and subtract: $x_1+x_2$ oscillates at $\omega_1=\sqrt{k/m}=%.3f$ (in phase, middle spring idle) and "
               r"$x_1-x_2$ at $\omega_2=\sqrt{3k/m}=%.3f$ (opposite)." % (w1, w2), at=0.5, show=["velocity", "labels"], camera="side"),
             S("Superpose", r"Start: $x_1=%.1f$ m, $x_2=0$, at rest. Then $x_1=\tfrac{%.1f}{2}(\cos\omega_1t+\cos\omega_2t)$ and "
               r"$x_2=\tfrac{%.1f}{2}(\cos\omega_1t-\cos\omega_2t)$: energy moves back and forth between the masses." % (d, d, d),
               show=["trail", "labels"], camera="side")]
    scene = _scene("Two masses, three springs", steps, duration=6.0, focus="m1", bodies=[
        {"id": "wall_left", "type": "static", "shape": "box", "w": 0.1, "h": 0.8, "pos": [-1.55, 0.5], "render": {"kind": "box"}},
        {"id": "wall_right", "type": "static", "shape": "box", "w": 0.1, "h": 0.8, "pos": [1.55, 0.5], "render": {"kind": "box"}},
        # illustrative 0.42 m blocks; centres stay ≥ 0.8 m apart, so they never touch
        {"id": "m1", "shape": "box", "w": 0.42, "h": 0.42, "mass": m, "inertia": "plate", "pos": [-0.5 + d, 0.5], "friction": 0, "label": "m₁", "render": {"kind": "box", "prop": "block"}},
        {"id": "m2", "shape": "box", "w": 0.42, "h": 0.42, "mass": m, "inertia": "plate", "pos": [0.5, 0.5], "friction": 0, "label": "m₂", "render": {"kind": "box", "prop": "block"}}],
        joints=[{"id": "rail1", "type": "slider", "a": "world", "b": "m1", "anchor": [-0.5, 0.5], "axis": [1, 0]},
                {"id": "rail2", "type": "slider", "a": "world", "b": "m2", "anchor": [0.5, 0.5], "axis": [1, 0]},
                {"id": "s1", "type": "spring", "a": "world", "b": "m1", "anchorA": [-1.5, 0.5], "anchorB": [-0.5 + d, 0.5], "k": k, "rest": 1.0, "damping": 0, "label": "F₁"},
                {"id": "s2", "type": "spring", "a": "m1", "b": "m2", "anchorA": [-0.5 + d, 0.5], "anchorB": [0.5, 0.5], "k": k, "rest": 1.0, "damping": 0, "label": "F₂"},
                {"id": "s3", "type": "spring", "a": "world", "b": "m2", "anchorA": [1.5, 0.5], "anchorB": [0.5, 0.5], "k": k, "rest": 1.0, "damping": 0, "label": "F₃"}],
        nocollide=[["m1", "m2"]],
        checks=[_chk("m₁ velocity at 0.5 s", "vx", v1, at=t1, body="m1"), _chk("m₂ velocity at 0.5 s", "vx", v2, at=t1, body="m2"),
                _chk("m₁ position at 0.5 s", "x", -0.5 + x1, at=t1, body="m1", tol=1)])
    return tutor._lesson("Mechanics · coupled oscillators (Morin ch. 4)", "Two masses between three springs",
        "Two equal masses on a frictionless line are joined to each other and to two walls by three identical springs. One mass is displaced and both are released from rest. Find the normal-mode frequencies and the motion.",
        ["k = 40 N/m for each spring", "m = 1 kg each", "x₁(0) = 0.2 m, x₂(0) = 0, both at rest"],
        [_ans("Slow (in-phase) mode", r"\omega_1=\sqrt{k/m}", w1, "rad/s"), _ans("Fast (opposite) mode", r"\omega_2=\sqrt{3k/m}", w2, "rad/s"),
         _ans("Motion of m₁", r"x_1=\tfrac{d}{2}(\cos\omega_1t+\cos\omega_2t)", None, "m")],
        steps, "mechanics", scene, "Planar simulation: both blocks on frictionless rails, springs at their centres; positions measured from equilibrium.",
        ["Ideal massless springs; no friction."], plan="Write both equations, decouple with sum and difference coordinates, superpose the modes.")


def _agm(a: float, b: float) -> float:
    for _ in range(30):
        a, b = (a + b) / 2, math.sqrt(a * b)
    return a


def _quarter_period(omega0: float, amplitude_deg: float) -> float:
    """Exact time from release at amplitude to the lowest point: K(k)/ω₀ with k = sin(θ₀/2)."""
    k = math.sin(math.radians(amplitude_deg) / 2)
    return math.pi / 2 / _agm(1.0, math.sqrt(1 - k * k)) / omega0


@recipe("simple_pendulum")
def simple_pendulum():
    L, th0, m = 1.0, 60.0, 1.0
    t_bottom = _quarter_period(math.sqrt(G / L), th0)
    v = math.sqrt(2 * G * L * (1 - math.cos(math.radians(th0))))
    Tn = m * G + m * v * v / L
    px = [0, 2.2]
    bob = [round(px[0] + L * math.sin(math.radians(th0)), 5), round(px[1] - L * math.cos(math.radians(th0)), 5)]
    steps = [S("Forces and axes", r"Only gravity and the rod's tension act. Use radial/tangential axes: tangentially $mL\ddot\theta=-mg\sin\theta$.",
               at=0, show=["forces", "labels"], camera="side"),
             S("Speed at the bottom", r"Energy: $\tfrac12mv^2=mgL(1-\cos\theta_0)$ gives $v=%.3f$ m/s." % v, at=round(t_bottom, 3),
               show=["velocity", "labels"], camera="side"),
             S("Tension at the bottom", r"Radially $T-mg=mv^2/L$, so $T=mg(3-2\cos\theta_0)=%.1f$ N, twice the weight for 60°." % Tn,
               at=round(t_bottom, 3), show=["forces", "tensions", "labels"], camera="side"),
             S("Not quite small-angle", r"From 60° the quarter period is $%.3f$ s, longer than the small-angle $\tfrac\pi2\sqrt{L/g}=%.3f$ s." % (t_bottom, math.pi / 2 * math.sqrt(L / G)),
               show=["trail", "labels"], camera="side")]
    scene = _scene("Pendulum released from 60°", steps, duration=4.5, focus="bob", bodies=[
        {"id": "bob", "shape": "circle", "r": 0.08, "mass": m, "inertia": "solid_sphere", "pos": bob, "friction": 0, "label": "m", "render": {"kind": "sphere"}}],
        joints=[{"id": "rod", "type": "rod", "a": "world", "b": "bob", "anchorA": px, "anchorB": bob, "length": L, "label": "T"}],
        checks=[_chk("speed at the bottom", "speed", v, at=round(t_bottom, 4), body="bob"),
                _chk("rod tension at the bottom", "joint_force", Tn, at=round(t_bottom, 4), joint="rod")])
    return tutor._lesson("Mechanics · pendulum (Morin ch. 4–5)", "Pendulum released from a large angle",
        "A small bob on a light rigid rod of length L is released from rest at angle θ₀ from the vertical. Find its speed and the rod tension at the lowest point.",
        ["L = 1 m", "θ₀ = 60°", "m = 1 kg", "released from rest"],
        [_ans("Speed at the bottom", r"v=\sqrt{2gL(1-\cos\theta_0)}", v, "m/s"), _ans("Tension at the bottom", r"T=mg(3-2\cos\theta_0)", Tn, "N")],
        steps, "mechanics", scene, "Planar simulation: point-like bob on a rigid massless rod pinned above it.",
        ["Massless rod, frictionless pivot, small bob."], plan="Energy for the speed, then the radial F = ma for the tension.")


@recipe("double_pendulum")
def double_pendulum():
    L1 = L2 = 0.8
    top = [0, 2.4]
    b1 = [top[0] + L1, top[1]]
    b2 = [round(b1[0] + L2 * math.sin(math.radians(150)), 5), round(b1[1] - L2 * math.cos(math.radians(150)), 5)]
    steps = [S("Two angles", r"Two coordinates, $\theta_1$ and $\theta_2$, both from the downward vertical. The Lagrangian couples them through "
               r"$\cos(\theta_1-\theta_2)$.", at=0, show=["forces", "labels"], camera="side"),
             S("Small swings", r"For small angles the motion is a sum of two normal modes (equal masses and lengths: $\omega^2=(2\mp\sqrt2)g/L$).",
               show=["trail", "labels"], camera="side"),
             S("Large swings", r"Released from here the motion is not periodic: tiny changes in the start give different paths after a few seconds. "
               r"Only energy is conserved.", at=2.0, show=["trail", "velocity", "labels"], camera="side")]
    scene = _scene("Double pendulum", steps, duration=10.0, focus="bob2", bodies=[
        {"id": "bob1", "shape": "circle", "r": 0.07, "mass": 1, "inertia": "solid_sphere", "pos": b1, "friction": 0, "label": "m₁", "render": {"kind": "sphere"}},
        {"id": "bob2", "shape": "circle", "r": 0.07, "mass": 1, "inertia": "solid_sphere", "pos": b2, "friction": 0, "label": "m₂", "render": {"kind": "sphere"}}],
        joints=[{"id": "rod1", "type": "rod", "a": "world", "b": "bob1", "anchorA": top, "anchorB": b1, "length": L1, "label": "T₁"},
                {"id": "rod2", "type": "rod", "a": "bob1", "b": "bob2", "anchorA": b1, "anchorB": b2, "length": L2, "label": "T₂"}],
        nocollide=[["bob1", "bob2"]])
    return tutor._lesson("Mechanics · Lagrangian systems (Morin ch. 4, 6)", "Double pendulum",
        "Two equal point masses hang in series on two light rods of equal length. Describe the coordinates, the small-oscillation modes and what happens for large swings.",
        ["L₁ = L₂ = 0.8 m", "m₁ = m₂ = 1 kg", "start: θ₁ = 90°, θ₂ = 150°, at rest"],
        [_ans("Small-oscillation frequencies", r"\omega^2=(2\mp\sqrt2)\,g/L", None, "rad²/s²", "Equal masses and lengths.")],
        steps, "mechanics", scene, "Planar simulation of a large-amplitude (chaotic) double pendulum; no numerical checks.",
        ["Massless rods, frictionless pins."], plan="Choose θ₁ and θ₂, write T and V, linearise for the modes; large swings need the full equations.")


# ---------------------------------------------------------------- ch. 2: statics

@recipe("ladder_wall_static")
def ladder_wall_static():
    Ld, wd, th, m, mu = 3.0, 0.08, 60.0, 10.0, 0.5
    t = math.radians(th)
    # long axis along body y, turned (90° − θ) counter-clockwise so it leans left onto the wall at x = 0
    cx = Ld / 2 * math.cos(t) + wd / 2 * math.sin(t)
    cy = Ld / 2 * math.sin(t) + wd / 2 * math.cos(t)
    f = m * G / (2 * math.tan(t))
    # The model's ladder has thickness: it touches at its corners, foot at x = cx + L/2 cos θ − w/2 sin θ and the wall at
    # height L sin θ, so the torque balance about the foot gives a slightly smaller friction than the thin-ladder answer.
    f_model = m * G * (Ld / 2 * math.cos(t) - wd / 2 * math.sin(t)) / (Ld * math.sin(t))
    steps = [S("Three forces, one torque", r"Weight $mg$ at the centre, a horizontal push $N_w$ from the smooth wall, and from the floor $N_f$ up plus friction $f$ toward the wall.",
               at=0, show=["forces", "labels", "axes"], camera="side"),
             S("Force balance", r"Vertical: $N_f=mg$. Horizontal: $f=N_w$.", at=0.5, show=["all_forces", "labels"], camera="side"),
             S("Torque about the foot", r"$N_wL\sin\theta=mg\tfrac L2\cos\theta$, so $f=N_w=\dfrac{mg}{2\tan\theta}=%.2f$ N. It stays put if $\mu\ge\dfrac{1}{2\tan\theta}=%.3f$." % (f, 1 / (2 * math.tan(t))),
               at=1.0, show=["all_forces", "labels"], camera="side")]
    scene = _scene("Ladder against a smooth wall", steps, duration=2.0, focus="ladder", bodies=[
        {"id": "wall", "type": "static", "shape": "edge", "pos": [0, 0], "points": [[0, 0], [0, 3.0]], "friction": 0, "render": {"kind": "floor"}},
        _floor(-0.2, 2.2, mu=mu),   # wall and floor run a little past the contacts (2.6 m up, 1.5 m out); their extent is illustrative
        {"id": "ladder", "shape": "box", "w": wd, "h": Ld, "mass": m, "inertia": "rod", "pos": [round(cx, 5), round(cy, 5)], "angle_deg": 90 - th,
         "friction": mu, "restitution": 0, "label": "ladder", "render": {"kind": "rod", "prop": "ladder"}}],
        checks=[_chk("floor friction (torque about the foot, 8 cm thick ladder)", "friction", f_model, at=1.0, body="ladder"),
                _chk("centre height stays", "y", cy, at=2.0, body="ladder", tol=1)])
    return tutor._lesson("Mechanics · statics (Morin ch. 2)", "Ladder against a smooth wall",
        "A uniform ladder leans at angle θ to the floor against a frictionless wall. Find the friction force the floor must supply and the smallest coefficient of friction that keeps it in place.",
        ["L = 3 m", "θ = 60° from the floor", "m = 10 kg", "wall frictionless; floor μ = 0.5"],
        [_ans("Floor friction", r"f=\dfrac{mg}{2\tan\theta}", f, "N"), _ans("Minimum μ", r"\mu_{\min}=\dfrac{1}{2\tan\theta}", 1 / (2 * math.tan(t)), "")],
        steps, "mechanics", scene, "Planar simulation of a ladder at rest; the engine supplies the contact forces.",
        ["Uniform ladder; wall contact is frictionless."], plan="Balance forces in x and y, then torques about the foot to remove two unknowns.")


# ---------------------------------------------------------------- ch. 5 and 8: planar rigid bodies (from the app's engine examples)

def _example(eid: str) -> dict:
    """An engine example as a lesson scene: static bodies get their explicit origin, engine-only facts are dropped."""
    spec = copy.deepcopy(json.loads(scenes.EXAMPLES_PATH.read_text(encoding="utf-8"))[eid]["spec"])
    spec.pop("facts", None)
    for b in spec["bodies"]:
        b.setdefault("pos", [0, 0])
    return spec


def _with(spec: dict, title: str, steps: list[dict], checks: list[dict], **props) -> dict:
    """Attach title, mirrored steps, checks and drawing-only props {body id: prop} to an engine example."""
    for b in spec["bodies"]:
        if b["id"] in props:
            b.setdefault("render", {})["prop"] = props[b["id"]]
    base = _scene(title, steps, bodies=[], duration=spec["duration"], focus=spec.get("focus", ""))
    spec.update({"title": title, "steps": base["steps"], "checks": checks})
    return spec


@recipe("rolling_incline")
def rolling_incline():
    th, r = 30.0, 0.25
    a = 5 / 7 * G * math.sin(math.radians(th))
    steps = [S("Friction makes it roll", r"Gravity along the slope $mg\sin\theta$, static friction $f$ up the slope at the contact. Without friction the ball would slide, not turn.",
               at=0, show=["forces", "labels"], camera="side"),
             S("Two equations and a constraint", r"$ma=mg\sin\theta-f$, $I\alpha=fr$, rolling $a=r\alpha$. With $I=\tfrac25mr^2$: $a=\tfrac57g\sin\theta=%.2f$ m/s²." % a,
               at=0.5, show=["forces", "velocity", "labels"], camera="side"),
             S("Energy check", r"No work by static friction: $mgh=\tfrac12mv^2+\tfrac12I\omega^2=\tfrac7{10}mv^2$.", show=["velocity", "energy", "labels"], camera="side")]
    # illustrative sizes (the answers do not depend on them): a 2.6 m slope under a 0.5 m ball, so the ramp reads as a long slope; the ball
    # starts 0.5 m down it (not on the top corner) and rolls 1.75 m in 1.0 s, ending clear of the foot
    ex, L = _example("rolling_incline"), 2.6
    t_ = math.radians(th)
    w, h = L * math.cos(t_), L * math.sin(t_)
    s0 = 0.5
    for b in ex["bodies"]:
        if b["id"] == "ramp":
            b["points"] = [[0, 0], [w, 0], [0, h]]
        elif b["id"] == "floor":
            b["points"] = [[-0.5, 0], [w + 1, 0]]
        elif b["id"] == "ball":
            b["r"] = r
            b["pos"] = [round(s0 * math.cos(t_) + r * math.sin(t_), 5), round(h - s0 * math.sin(t_) + r * math.cos(t_), 5)]
            b.setdefault("render", {})["gauge_k"] = 1.7   # drawing only: longer arrows, so friction (1/7 of the weight along the slope) still reads
    ex["duration"] = 1.0
    ex["frame_motion"] = 1.0   # the roll stays in the view; the frame is not widened to 2x the ramp
    ex["frame"] = [[-0.25, -0.1], [w + 0.2, h + 0.5]]   # drawing only: the whole slope and the ball
    ex["frame_fit"] = 1.0
    spec = _with(ex, "Ball rolling down an incline", steps,
                 [_chk("speed after 1 s = (5/7) g sin θ · t", "speed", a, at=1.0, body="ball"),
                  _chk("rolling: ω = −v/r", "omega", -a / r, at=1.0, body="ball")], ramp="ramp")
    return tutor._lesson("Mechanics · rolling (Morin ch. 8)", "Solid ball rolling down an incline",
        "A uniform solid ball rolls without slipping from rest down a fixed incline of angle θ. Find its acceleration and the friction it needs.",
        ["θ = 30°", "solid ball, r = 0.25 m, m = 1 kg", "rolls without slipping", "starts from rest"],
        [_ans("Acceleration", r"a=\tfrac57g\sin\theta", a, "m/s²"), _ans("Friction needed", r"f=\tfrac27mg\sin\theta", 2 / 7 * G * 0.5, "N")],
        steps, "mechanics", spec, "Planar simulation: the engine's friction produces the rolling; the app compares a and ω.",
        ["Uniform solid sphere; enough friction to roll."], plan="F = ma for the centre, τ = Iα about the centre, rolling constraint.")


@recipe("falling_rod")
def falling_rod():
    m, L = 1.0, 1.2
    I = m * L * L / 3
    w = math.sqrt(2 * m * G * L / 2 / I)
    tv = _quarter_period(math.sqrt(m * G * L / 2 / I), 90)
    steps = [S("Torque at release", r"About the pivot only gravity has a torque: $\tau=mg\tfrac L2$, so $\alpha=\tau/I=\tfrac{3g}{2L}$.", at=0, show=["forces", "labels"], camera="side"),
             S("Pivot force", r"The centre accelerates down at $\tfrac L2\alpha=\tfrac34g$, so the pivot pushes up with only $\tfrac14mg=%.2f$ N." % (m * G / 4),
               at=0, show=["all_forces", "labels"], camera="side"),
             S("At the bottom", r"Energy: $mg\tfrac L2=\tfrac12I\omega^2$ gives $\omega=\sqrt{3g/L}=%.2f$ rad/s." % w, at=round(tv, 3), show=["velocity", "labels"], camera="side")]
    spec = _with(_example("falling_rod"), "Rod pivoted at one end, released horizontal", steps,
                 [_chk("pivot force at release = mg/4", "joint_force", m * G / 4, at=0, joint="pivot", tol=3),
                  _chk("ω when vertical (clockwise)", "omega", -w, at=round(tv, 4), body="rod")], rod="beam")
    return tutor._lesson("Mechanics · fixed-axis rotation (Morin ch. 8)", "Falling rod about a pivot",
        "A uniform rod is pinned at one end and released from rest horizontal. Find the pivot force just after release and the angular speed when it hangs vertically.",
        ["m = 1 kg", "L = 1.2 m", "frictionless pin at one end", "released horizontal"],
        [_ans("Pivot force at release", r"F=\tfrac14mg", m * G / 4, "N"), _ans("ω when vertical", r"\omega=\sqrt{3g/L}", w, "rad/s")],
        steps, "mechanics", spec, "Planar simulation of the swinging rod; the app measures the pin force.",
        ["Thin uniform rod."], plan="τ = Iα at release, then F = ma for the centre; energy for the bottom.")


@recipe("physical_pendulum")
def physical_pendulum():
    m, L, th0 = 1.0, 1.2, 40.0
    I = m * L * L / 3
    w0 = math.sqrt(m * G * L / 2 / I)
    wb = math.sqrt(2 * m * G * L / 2 * (1 - math.cos(math.radians(th0))) / I)
    tb = _quarter_period(w0, th0)
    steps = [S("Equation of motion", r"About the pivot: $I\ddot\theta=-mgd\sin\theta$ with $d=L/2$ and $I=\tfrac13mL^2$.", at=0, show=["forces", "labels"], camera="side"),
             S("Small-angle period", r"$\omega_0=\sqrt{mgd/I}=\sqrt{3g/2L}=%.2f$ rad/s, so $T\approx2\pi/\omega_0=%.2f$ s; from 40° it is slightly longer." % (w0, 2 * math.pi / w0),
               show=["trail", "labels"], camera="side"),
             S("Bottom of the swing", r"Energy gives $\omega=%.3f$ rad/s at the bottom, reached after %.3f s." % (wb, tb), at=round(tb, 3), show=["velocity", "labels"], camera="side")]
    spec = _with(_example("physical_pendulum"), "Rod swinging about one end", steps,
                 [_chk("ω at the bottom", "omega", -wb, at=round(tb, 4), body="rod")], rod="beam")
    return tutor._lesson("Mechanics · physical pendulum (Morin ch. 8)", "Physical pendulum",
        "A uniform rod hangs from a pin at one end and is released at angle θ₀ from vertical. Find the small-oscillation period and the angular speed at the bottom.",
        ["m = 1 kg", "L = 1.2 m", "θ₀ = 40°"],
        [_ans("Small-angle period", r"T=2\pi\sqrt{\dfrac{2L}{3g}}", 2 * math.pi / w0, "s"), _ans("ω at the bottom", r"\omega=\sqrt{\dfrac{3g(1-\cos\theta_0)}{L}}", wb, "rad/s")],
        steps, "mechanics", spec, "Planar simulation; the period depends on I about the pivot, not on the mass alone.",
        ["Thin uniform rod, frictionless pin."], plan="τ = Iα about the pivot; linearise for the period; energy for ω.")


@recipe("struck_ball")
def struck_ball():
    m, r, J, mu = 0.17, 0.06, 0.5, 0.2
    v0 = J / m
    vf = 5 / 7 * v0
    ts = 2 * v0 / (7 * mu * G)
    steps = [S("Struck at centre height", r"The blow gives $v_0=J/m=%.2f$ m/s and no spin. The ball slides, so kinetic friction $\mu mg$ acts backwards." % v0,
               at=0.03, show=["forces", "velocity", "labels"], camera="side"),
             S("Friction does two jobs", r"It slows the centre ($\dot v=-\mu g$) and spins the ball up ($I\dot\omega=\mu mgr$).", at=0.2, show=["forces", "velocity", "labels"], camera="follow"),
             S("Rolling begins", r"When $v=r\omega$: $t=\dfrac{2v_0}{7\mu g}=%.3f$ s and $v=\tfrac57v_0=%.2f$ m/s. Angular momentum about the contact line is conserved." % (ts, vf),
               at=round(ts + 0.1, 3), show=["velocity", "labels"], camera="follow")]
    spec = _with(_example("struck_ball"), "Struck ball: slip, then roll", steps,
                 [_chk("speed while slipping", "speed", v0 - mu * G * 0.2, at=0.2, body="ball"),
                  _chk("rolling speed = (5/7) v₀", "speed", vf, at=1.0, body="ball"),
                  _chk("rolling: ω = −v/r", "omega", -vf / r, at=1.0, body="ball")])
    spec["frame"] = [[-3 * r, 0], [3 * r, 0], [0, 3 * r]]   # drawing only: room for the velocity and friction arrows beside the ball
    return tutor._lesson("Mechanics · slipping to rolling (Morin ch. 8)", "Struck ball: slipping, then rolling",
        "A billiard ball at rest is struck horizontally through its centre. Kinetic friction acts until it rolls. Find the final speed and how long the slipping lasts.",
        ["m = 0.17 kg, r = 6 cm", "impulse J = 0.5 N·s at centre height", "μ = 0.2"],
        [_ans("Final speed", r"v=\tfrac57v_0", vf, "m/s"), _ans("Slipping time", r"t=\dfrac{2v_0}{7\mu g}", ts, "s")],
        steps, "mechanics", spec, "Planar simulation; friction from the engine's contact produces the spin-up.",
        ["Uniform solid ball; constant kinetic friction while slipping."], plan="F = ma and τ = Iα while slipping, stop when v = rω; or L about the contact line.")


@recipe("disk_on_disk")
def disk_on_disk():
    I1, I2, w2, tau = 0.5, 1.0, 10.0, 20 / 9
    T = 0.6                                   # the disk is let go above the platter and lands at T (the fall is drawn, not simulated)
    wf = I2 * w2 / (I1 + I2)
    ts = wf * I1 / tau
    lost = 0.5 * I2 * w2 ** 2 - 0.5 * (I1 + I2) * wf ** 2
    steps = [S("Dropping", r"The turntable spins freely at $\omega_2$ on its axle. The disk, not turning, falls straight down onto it; until they touch nothing twists either one.",
               at=0.2, show=["velocity", "labels"], camera="hero"),
             S("It lands and slips", r"Where they touch, the disk moves backward relative to the platter ($v_{rel}$), so kinetic friction $f$ on the disk points forward.",
               at=round(T + 0.15, 3), show=["forces", "velocity", "labels"], camera="hero"),
             S("Friction torque", r"While they slip, friction gives equal and opposite torques $\tau_f$: the disk speeds up and the turntable slows down.",
               at=round(T + 0.75, 3), show=["forces", "velocity", "labels"], camera="hero"),
             S("Turning together", r"Slipping stops at $t_s=I_1\omega_f/\tau_f=%.2f$ s after landing. Nothing external twists the axle: $I_2\omega_2=(I_1+I_2)\omega_f$, so $\omega_f=%.2f$ rad/s." % (ts, wf),
               at=round(T + ts + 0.5, 3), show=["forces", "velocity", "labels"], camera="hero"),
             S("Energy lost", r"$\Delta E=\tfrac12I_2\omega_2^2-\tfrac12(I_1+I_2)\omega_f^2=%.2f$ J, the same however strong the friction is." % lost,
               show=["energy", "velocity", "labels"], camera="hero")]
    ex = _example("disk_on_disk")
    plate, platter = 0.05, 0.07
    for bd in ex["bodies"]:
        if bd["id"] == "top":     # a thin plate resting on the platter once it lands
            bd.update(omega=0, inertia=I1, label="disk", render={"kind": "disk", "z": platter / 2 + plate / 2, "thick": plate, "drop_h": 0.9, "drop_t": T})
        elif bd["id"] == "bottom":  # a thin platter on a spindle and base
            bd.update(omega=w2, inertia=I2, label="turntable", render={"kind": "disk", "thick": platter, "stand": 1})
    for j in ex["joints"]:
        if j["id"] == "rub":
            j["maxTorque"] = tau
    # Before landing they do not touch: the friction pad (always on in the engine) is cancelled exactly by equal and opposite
    # couples, so the disk stays still and the turntable keeps omega_2; these bookkeeping forces are never drawn.
    d, F = 0.3, tau / (2 * 0.3)
    ex["forces"] = [{"body": "top", "F": [0, -F], "offset": [d, 0], "from": 0, "to": T - 1e-3, "label": "no contact yet"},
                    {"body": "top", "F": [0, F], "offset": [-d, 0], "from": 0, "to": T - 1e-3, "label": "no contact yet"},
                    {"body": "bottom", "F": [0, F], "offset": [d, 0], "from": 0, "to": T - 1e-3, "label": "no contact yet"},
                    {"body": "bottom", "F": [0, -F], "offset": [-d, 0], "from": 0, "to": T - 1e-3, "label": "no contact yet"}]
    ex["duration"] = round(T + 3.5, 3)
    spec = _with(ex, "Disk dropped onto a spinning turntable", steps,
                 [_chk("disk still while falling", "omega", 0, at=round(T - 0.1, 3), body="top", tol=5),
                  _chk("disk while slipping", "omega", tau / I1 * 0.75, at=round(T + 0.75, 3), body="top"),
                  _chk("common rate (disk)", "omega", wf, at=round(T + 3.0, 3), body="top"), _chk("common rate (turntable)", "omega", wf, at=round(T + 3.0, 3), body="bottom")])
    return tutor._lesson("Mechanics · angular momentum (Morin ch. 8)", "Disk dropped onto a turntable",
        "A disk at rest is dropped onto a coaxial turntable spinning freely at ω₂; friction between them acts until they turn together. Find the final rate, how long they slip and the energy lost.",
        ["disk I₁ = 0.5 kg·m², at rest", "turntable I₂ = 1 kg·m², ω₂ = 10 rad/s, free axle", "friction torque τ_f = 2.22 N·m while slipping"],
        [_ans("Final rate", r"\omega_f=\dfrac{I_2\omega_2}{I_1+I_2}", wf, "rad/s"),
         _ans("Slipping time", r"t_s=\dfrac{I_1\omega_f}{\tau_f}", ts, "s"),
         _ans("Energy lost", r"\Delta E=\dfrac{I_1I_2\omega_2^2}{2(I_1+I_2)}", lost, "J")],
        steps, "mechanics", spec, "Seen across the table at a slant; the disk's fall is drawn (it lands at t = %.1f s) and a friction pad gives a constant torque while they slip." % T,
        ["Free (unpowered) turntable on a frictionless axle; constant friction torque while slipping."], plan="Conserve L about the axle; the friction torque sets how long they slip.")


@recipe("ball_hits_stick")
def ball_hits_stick():
    m, v, M, l, b = 0.5, 4.0, 1.0, 1.0, 0.3
    I = M * l * l / 12
    J = 2 * v / (1 / m + 1 / M + b * b / I)
    V, w, vb = J / M, -J * b / I, v - J / m
    r, gap = 0.11, 0.4                        # a ball you can see, starting 0.4 m from the stick
    th = (gap - 0.02) / v                     # it reaches the stick's face (half-width 0.02 m) at th
    steps = [S("Before the hit", r"Top view on a frictionless table: the ball moves at $v$ toward the stick at rest, aimed a distance $b$ from its centre of mass.",
               at=round(0.4 * th, 3), show=["velocity", "labels"], camera="top"),
             S("The impulse", r"During the brief contact the only horizontal force is the push $J$ at the hit point: $MV=J$, $I\omega=-bJ$, $mv'=mv-J$. Momentum, angular momentum and (elastic) energy are conserved.",
               at=round(th + 0.03, 3), show=["forces", "velocity", "labels"], camera="top"),
             S("After", r"$J=\dfrac{2v}{1/m+1/M+b^2/I}=%.3f$ N·s, so the stick's centre moves at $V=%.2f$ m/s while it turns at $|\omega|=%.2f$ rad/s, and the ball keeps only $v'=%.2f$ m/s." % (J, V, abs(w), vb),
               at=round(th + 0.16, 3), show=["forces", "velocity", "trail", "labels"], camera="top")]
    # illustrative start and run (the answers do not depend on them; the engine example starts 2.5 m out and runs 2.6 s). Turned a
    # quarter turn from the example so it suits a tall pane: the stick lies along x, the ball comes up from below, left of centre.
    ex = _example("ball_stick")
    for bd in ex["bodies"]:
        if bd["id"] == "ball":
            bd.update(r=r, pos=[-b, -gap - r], vel=[0, v])
        elif bd["id"] == "stick":
            bd.update(w=bd["h"], h=bd["w"])
            bd.setdefault("render", {})["cm"] = 1
    ex["duration"] = round(th + 0.19, 3)
    spec = _with(ex, "Ball hits a free stick off-centre", steps,
                 [_chk("stick centre velocity", "vy", V, body="stick"), _chk("stick spin (clockwise)", "omega", w, body="stick")])
    return tutor._lesson("Mechanics · collisions with rotation (Morin ch. 8)", "Ball hits a free stick",
        "On a frictionless table, a ball strikes a free uniform stick at rest, perpendicular to it and a distance b from its centre; the collision is elastic. Find the stick's motion and the ball's final velocity.",
        ["ball m = 0.5 kg, v = 4 m/s", "stick M = 1 kg, ℓ = 1 m, I = Mℓ²/12", "b = 0.3 m", "elastic, frictionless"],
        [_ans("Stick velocity", r"V=J/M", V, "m/s"), _ans("Stick angular velocity", r"\omega=-bJ/I", w, "rad/s", "Clockwise here: the ball hits left of the centre, moving up the page."),
         _ans("Ball velocity", r"v'=v-J/m", vb, "m/s")],
        steps, "mechanics", spec, "Top view on a frictionless table; the engine resolves the elastic contact.",
        ["Point-like ball; rigid stick; perfectly elastic contact."], plan="Impulse equations for each body plus the elastic condition at the contact point.")


@recipe("spool_pull")
def spool_pull():
    m, R, r, I, T, phi = 1.0, 0.3, 0.15, 0.045, 3.0, 20.0
    p = math.radians(phi)
    tau = T * (r - R * math.cos(p))
    alpha = tau / (I + m * R * R)
    a = -alpha * R
    steps = [S("Torque about the contact point", r"The string leaves the inner drum (radius $r$) at angle $\phi$. About the contact point its lever arm is $R\cos\phi-r$.",
               at=0, show=["forces", "labels"], camera="side"),
             S("Which way?", r"$R\cos\phi>r$ here, so the torque about the contact point turns the spool toward the pull: it rolls right and winds the string up.",
               at=0.5, show=["forces", "velocity", "labels"], camera="side"),
             S("Acceleration", r"$I_P\alpha=T(R\cos\phi-r)$ with $I_P=I+mR^2$: $a=%.3f$ m/s². At $\cos\phi=r/R$ it would not accelerate." % a,
               show=["forces", "velocity", "trail", "labels"], camera="side")]
    ex = _example("spool_pull")   # the drawn string ends 0.7 m out on the same line (the engine's pull is the constant force, not the length)
    sb = next(b for b in ex["bodies"] if b["id"] == "spool"); via = ex["strings"][0]["via"]
    a0 = [sb["pos"][0] + via[0]["attach"][0], sb["pos"][1] + via[0]["attach"][1]]; w0 = via[1]["world"]
    dx, dy = w0[0] - a0[0], w0[1] - a0[1]; k = 0.85 / math.hypot(dx, dy)
    via[1]["world"] = [round(a0[0] + k * dx, 5), round(a0[1] + k * dy, 5)]
    spec = _with(ex, "Pulling a spool by its string", steps,
                 [_chk("acceleration to the right", "ax", a, at=1.0, body="spool"), _chk("rolling spin", "omega", alpha * 1.0, at=1.0, body="spool")],
                 spool="spool")
    spec["frame"] = [[-0.5, -0.2], [0.95, 0.85]]   # drawing only: frame the spool and its string, not the floor
    spec["camera"] = "side"   # open in the side view: the follow view shows the spool prop at a slant, both flanges like a second disk
    spec["frame_motion"] = 0.5
    spec["frame_fit"] = 0.8   # the spool fills about half the pane   # the spool's roll widens the view only a little (its motion is still drawn)
    return tutor._lesson("Mechanics · rolling with an applied force (Morin ch. 8)", "Pulling a spool",
        "A spool (outer radius R, drum radius r) rests on a rough floor. A string unwinding from the bottom of the drum is pulled with tension T at angle φ above horizontal. Which way does it roll, and with what acceleration?",
        ["m = 1 kg, R = 0.3 m, r = 0.15 m, I = 0.045 kg·m²", "T = 3 N at φ = 20°", "rolls without slipping"],
        [_ans("Acceleration", r"a=\dfrac{TR(R\cos\phi-r)}{I+mR^2}", a, "m/s²", "Toward the pull when R cos φ > r.")],
        steps, "mechanics", spec, "Planar simulation: a constant pull at the drum's tangent point; friction from the floor makes it roll.",
        ["Rolls without slipping; massless string."], plan="Torque about the contact point avoids the unknown friction.")


@recipe("ball_leaves_sphere")
def ball_leaves_sphere():
    c = 10 / 17
    steps = [S("Normal force shrinks", r"Radially $mg\cos\theta-N=\dfrac{mv^2}{R+r}$: as $v$ grows and $\theta$ grows, $N$ falls.", at=0.3, show=["forces", "labels"], camera="side"),
             S("Rolling energy", r"Rolling without slipping: $\tfrac7{10}mv^2=mg(R+r)(1-\cos\theta)$.", show=["velocity", "labels"], camera="side"),
             S("Leaves the surface", r"$N=0$ when $\cos\theta=\tfrac{10}{17}$, i.e. $\theta=%.1f°$ (a sliding particle leaves at $\cos\theta=\tfrac23$)." % math.degrees(math.acos(c)),
               show=["trail", "labels"], camera="side")]
    spec = _with(_example("ball_leaves_sphere"), "Ball rolling off a big sphere", steps, [])
    for b in spec["bodies"]:
        if b.get("type") != "static":
            b.setdefault("render", {})["gauge_k"] = 2.0   # drawing only: a 0.16 m ball on a 1.2 m sphere needs arrows longer than its own size
    return tutor._lesson("Mechanics · leaving a surface (Morin ch. 5, 8)", "Ball rolling off a sphere",
        "A small solid ball starts almost at rest on top of a large fixed sphere and rolls without slipping. At what angle does it leave the surface?",
        ["big sphere R = 1.2 m (fixed)", "small solid ball r = 0.16 m", "rolls without slipping from a tiny nudge"],
        [_ans("Leaving angle", r"\cos\theta=\tfrac{10}{17}", math.degrees(math.acos(c)), "°")],
        steps, "mechanics", spec, "Planar simulation; the small starting nudge means the leaving angle is approximate, so no numeric check.",
        ["Enough friction to roll; small initial speed."], plan="Radial F = ma with N, energy with rolling, set N = 0.")


@recipe("billiard_right_angle")
def billiard_right_angle():
    v, r = 3.0, 0.15   # illustrative radius: only the impact parameter / r ratio (s) sets the angles
    s = 0.5
    c = math.sqrt(1 - s * s)
    steps = [S("Glancing hit", r"Equal masses, elastic, frictionless. The impulse acts along the line of centres at contact, here $30°$ from the motion.",
               at=0, show=["velocity", "labels"], camera="top"),
             S("Right angle", r"Momentum $\vec v=\vec v_1+\vec v_2$ and energy $v^2=v_1^2+v_2^2$ together force $\vec v_1\perp\vec v_2$.", at=0.5, show=["forces", "velocity", "trail", "labels"], camera="top"),
             S("Speeds", r"The struck ball takes $v\cos30°=%.2f$ m/s along the line of centres; the other keeps $v\sin30°=%.2f$ m/s." % (v * c, v * s),
               at=0.45, show=["velocity", "trail", "labels"], camera="top")]
    scene = _scene("Elastic glancing collision", steps, duration=0.9, gravity=0, topdown=True, focus="b2", camera="top", bodies=[
        {"id": "b1", "shape": "circle", "r": r, "mass": 0.17, "inertia": "solid_sphere", "pos": [-0.8, r * 2 * s], "vel": [v, 0], "friction": 0,
         "restitution": 1, "bullet": True, "label": "1", "render": {"kind": "sphere"}},
        {"id": "b2", "shape": "circle", "r": r, "mass": 0.17, "inertia": "solid_sphere", "pos": [0, 0], "friction": 0, "restitution": 1,
         "bullet": True, "label": "2", "render": {"kind": "sphere"}}],
        checks=[_chk("ball 2 v_x", "vx", v * c * c, body="b2"), _chk("ball 2 v_y", "vy", -v * c * s, body="b2"),
                _chk("ball 1 v_x", "vx", v - v * c * c, body="b1"), _chk("ball 1 v_y", "vy", v * c * s, body="b1")])
    return tutor._lesson("Mechanics · collisions (Morin ch. 5)", "Billiard balls separate at 90°",
        "A ball moving at speed v strikes an identical ball at rest off-centre; the collision is elastic and frictionless. Show the balls leave at right angles and find their speeds.",
        ["equal masses", "v = 3 m/s", "impact parameter = one radius (line of centres at 30°)", "elastic, frictionless"],
        [_ans("Struck ball", r"v_2=v\cos30^\circ", v * c, "m/s"), _ans("Incoming ball", r"v_1=v\sin30^\circ", v * s, "m/s"),
         _ans("Angle between them", r"90^\circ", 90, "°")],
        steps, "mechanics", scene, "Top view on a frictionless table; elastic contact in the engine.",
        ["Smooth spheres (no spin transfer); perfectly elastic."], plan="Conserve momentum (vector) and energy; dot the momentum equation with itself.")


# ---------------------------------------------------------------- ch. 8–9: 3D rigid bodies (rigid3d engine)

@recipe("rod_about_end")
def rod_about_end():
    from . import teacher_visuals
    return teacher_visuals.rod_lesson()


@recipe("hurricane_balls")
def hurricane_balls():
    lesson = copy.deepcopy(tutor.examples()["hurricane_balls"]["spec"])
    # the opening view names the motion: the precession Ω about the vertical, not only the tilted axis
    lesson["steps"][0]["show"] = ["axis", "vertical", "precession", "trace", "labels"]
    return lesson


@recipe("conical_pendulum")
def conical_pendulum():
    m, r, L, mr, alpha = 1.0, 0.05, 1.0, 0.01, 30.0
    theta = 180 - alpha                                   # e3 points from the pivot down to the bob
    i3 = 0.4 * m * r * r
    i_perp = 0.4 * m * r * r + m * L * L + mr * L * L / 3
    ml = m * L + mr * L / 2
    rate = math.sqrt(ml * G / ((i_perp - i3) * math.cos(math.radians(alpha))))
    spec = _r3("conical pendulum", [
        _part("bob", "sphere", m, [0, 0, L], radius=r, color="rose"),
        _part("string", "rod", mr, [0, 0, L / 2], axis=[0, 0, 1], length=L, color="steel")], [0, 0, 1],
        _motion("steady_precession", pivot=[0, 0, 0], pivot_world=[0, 0, 1.4], support="pivot", theta=theta, prec=rate, spin=0, nut=0),
        duration=4.0, show=["weight", "contact", "precession", "vertical", "trace", "labels"],
        checks=[_rchk("dL/dt matches gravity's torque", "torque_residual", 0, at=1.0, tol=3),
                _rchk("I about the pivot ⟂ the string", "I_pivot_perp", i_perp, tol=1),
                _rchk("precession rate Ω", "precession_rate", rate, at=1.0, tol=2)])
    steps = [S("Frame", r"Fixed $x,y,z$ at the pivot, $z$ up. The string makes angle $\alpha$ with $-z$ and sweeps a cone about $z$ at rate $\Omega$.",
               show=["vertical", "axis", "precession", "trace", "labels"], camera="hero"),
             S("Newton's way", r"The bob moves in a horizontal circle of radius $L\sin\alpha$: $T\cos\alpha=mg$ and $T\sin\alpha=m\Omega^2L\sin\alpha$, "
               r"so $\Omega^2=g/(L\cos\alpha)$.", show=["weight", "contact", "precession", "trace", "labels"], camera="hero"),
             S("Angular momentum way", r"About the pivot $\vec L$ swings around $z$; $d\vec L/dt=\Omega\hat z\times\vec L$ must equal gravity's torque. "
               r"The same condition, $\Omega=%.3f$ rad/s here (the light string adds a tiny correction)." % rate,
               show=["L", "torque", "omega", "labels"], camera="hero")]
    return tutor._lesson("Mechanics · conical pendulum (Morin ch. 3, 9)", "Conical pendulum",
        "A bob on a light string of length L moves in a horizontal circle with the string at a constant angle α from the vertical. Find the rate Ω.",
        ["L = 1 m", "α = 30° from the downward vertical", "bob m = 1 kg (small sphere)", "string nearly massless (10 g in the model)"],
        [_ans("Rate", r"\Omega=\sqrt{\dfrac{g}{L\cos\alpha}}", math.sqrt(G / (L * math.cos(math.radians(alpha)))), "rad/s", "Point-bob value; the model's checks include the string and bob size.")],
        steps, "rigid3d", spec, "3D model: steady precession about the vertical; the app checks dL/dt against gravity's torque.",
        ["Light inextensible string; the bob is a small sphere."], plan="Horizontal circle with F = ma, or dL/dt = τ about the pivot.")


def _top_theta_max(i_perp: float, i3: float, w3: float, mgl: float, theta0: float) -> float:
    """Released with no precession or nutation rate: L₃²(u₀ − u) = 2 I⊥ Mgl (1 − u²) for u = cos θ."""
    l3, u0 = i3 * w3, math.cos(math.radians(theta0))
    a, b, c = 2 * i_perp * mgl, -l3 * l3, l3 * l3 * u0 - 2 * i_perp * mgl
    roots = [(-b - s * math.sqrt(b * b - 4 * a * c)) / (2 * a) for s in (1, -1)]
    u = max(x for x in roots if -1 <= x < u0 - 1e-12)
    return math.degrees(math.acos(u))


@recipe("heavy_top_nutation")
def heavy_top_nutation():
    m, r, l, mr, spin, th = 1.0, 0.1, 0.1, 0.01, 60.0, 30.0
    i3 = 0.5 * m * r * r
    i_perp = 0.25 * m * r * r + m * l * l + mr * l * l / 3
    mgl = (m * l + mr * l / 2) * G
    th_max = _top_theta_max(i_perp, i3, spin, mgl, th)
    spec = _r3("spinning top", [
        _part("disk", "disk", m, [0, 0, l], axis=[0, 0, 1], radius=r, color="teal", prop="gyroscope"),
        _part("stem", "rod", mr, [0, 0, l / 2], axis=[0, 0, 1], length=l, color="steel")], [0, 0, 1],
        _motion("heavy_top", pivot=[0, 0, 0], pivot_world=[0, 0, 0], support="pivot", theta=th, prec=0, spin=spin, nut=0),
        duration=3.0, ground=True, show=["omega", "L", "torque", "axis", "vertical", "trace", "labels"],
        checks=[_rchk("highest point: starting tilt", "theta_min_deg", th, tol=1),
                _rchk("lowest point of the nutation", "theta_max_deg", th_max, tol=2),
                _rchk("ω₃ is conserved", "omega_sym", spin, tol=1)])
    steps = [S("Released without precessing", r"The top spins at $\omega_3=%g$ rad/s with its axis $%g°$ from vertical and is let go with $\dot\phi=\dot\theta=0$." % (spin, th),
               at=0, show=["axis", "vertical", "omega", "L", "labels"], camera="hero"),
             S("Conserved quantities", r"$\omega_3$, $L_z$ and the energy are conserved. Gravity's torque is horizontal, so the axis dips and starts to precess.",
               show=["L", "torque", "trace", "labels"], camera="hero"),
             S("Nutation", r"The axis bobs between $\theta=%g°$ and $%.1f°$ (from $L_3^2(\cos\theta_0-\cos\theta)=2I_\perp Mgl\sin^2\theta$), tracing cusps." % (th, th_max),
               show=["trace", "axis", "labels"], camera="hero")]
    return tutor._lesson("Mechanics · heavy top (Morin ch. 9)", "Top released without precession: nutation",
        "A symmetric top spins fast about its axis, tilted θ₀ from the vertical with its tip fixed, and is released with no precession. Describe the motion and find the range of θ.",
        ["disk m = 1 kg, r = 0.1 m, 0.1 m from the tip", "ω₃ = 60 rad/s", "θ₀ = 30°", "released with dφ/dt = dθ/dt = 0"],
        [_ans("Range of the tilt", r"\theta_0\le\theta\le\theta_{\max}", th_max, "°", "θ_max from conservation of energy and L_z."),
         _ans("Average precession (fast top)", r"\bar\Omega\approx\dfrac{Mgl}{I_3\omega_3}", mgl / (i3 * spin), "rad/s")],
        steps, "rigid3d", spec, "3D model: Euler's equations integrated from rest in θ and φ; the app checks the nutation range.",
        ["Frictionless tip; rigid symmetric top."], plan="Use conserved ω₃, L_z and E; find the turning points of θ.")


@recipe("tennis_racket")
def tennis_racket():
    m, a, b, c = 0.4, 0.15, 0.3, 0.03
    ix, iy, iz = m * (b * b + c * c) / 12, m * (a * a + c * c) / 12, m * (a * a + b * b) / 12
    th, prec, spin = 2.0, 0.5, 8.0
    w = spin + prec * math.cos(math.radians(th))
    spec = _r3("box spun about its middle axis", [
        _part("plate", "box", m, [0, 0, 0], size=[a, b, c], color="sand", prop="block")], [1, 0, 0],
        _motion("free", pivot=None, pivot_world=[0, 0, 0.6], support="none", theta=th, prec=prec, spin=spin, nut=0),
        duration=6.0, gravity=0, show=["omega", "L", "body_axes", "principal_axes", "labels"],
        checks=[_rchk("smallest moment", "I1", iy, tol=1), _rchk("middle moment (the spin axis)", "I2", ix, tol=1), _rchk("largest moment", "I3", iz, tol=1),
                _rchk("energy conserved through the flip", "ke", 0.5 * ix * w * w, tol=1),
                _rchk("|L| conserved through the flip", "L_mag", ix * w, tol=1)])
    steps = [S("Principal axes", r"For the box, $I_1<I_2<I_3$ belong to the long, middle and thin directions. It is spun almost exactly about the middle axis $e_3$ here "
               r"(body axes $x',y',z'$ shown; here they are also principal).", at=0, show=["body_axes", "principal_axes", "labels"], camera="hero"),
             S("Euler's equations", r"Perturb a spin about axis 2: the small components grow like $e^{\lambda t}$ with "
               r"$\lambda^2=\omega^2\dfrac{(I_2-I_1)(I_3-I_2)}{I_1I_3}>0$. About axes 1 or 3 they only oscillate.", show=["omega", "L", "labels"], camera="hero"),
             S("The flip", r"$\vec L$ and the energy stay fixed while $\vec\omega$ wanders: the box flips over and back again and again.",
               show=["omega", "L", "body_axes", "labels"], camera="hero")]
    return tutor._lesson("Mechanics · torque-free rotation (Morin ch. 9)", "Tennis racket theorem",
        "A rigid box with three different principal moments is thrown spinning about its intermediate axis, with a tiny wobble. Show that this rotation is unstable while rotation about the other two axes is stable.",
        ["box 0.15 × 0.3 × 0.03 m, m = 0.4 kg", "spin ≈ 8.5 rad/s about the middle axis", "starting tilt 2° (tiny perturbation)", "no torque (gravity off)"],
        [_ans("Growth rate of the wobble", r"\lambda=\omega\sqrt{\dfrac{(I_2-I_1)(I_3-I_2)}{I_1I_3}}", w * math.sqrt((ix - iy) * (iz - ix) / (iy * iz)), "1/s")],
        steps, "rigid3d", spec, "3D model integrated with Euler's equations, gravity switched off; energy and |L| are checked.",
        ["Rigid uniform box; no torque."], plan="Linearise Euler's equations about each principal axis.")


@recipe("free_disk_wobble")
def free_disk_wobble():
    m, r, th, prec, spin = 0.5, 0.15, 20.0, 3.0, 2.0
    i3, ip = 0.5 * m * r * r, 0.25 * m * r * r
    w3 = spin + prec * math.cos(math.radians(th))
    wp = prec * math.sin(math.radians(th))
    Lm = math.hypot(i3 * w3, ip * wp)
    ang = math.degrees(math.atan2(wp, w3) - math.atan2(ip * wp, i3 * w3))
    spec = _r3("free coin", [_part("coin", "disk", m, [0, 0, 0], axis=[0, 0, 1], radius=r, color="sand")], [0, 0, 1],
        _motion("free", pivot=None, pivot_world=[0, 0, 0.6], support="none", theta=th, prec=prec, spin=spin, nut=0),
        duration=5.0, gravity=0, show=["omega", "L", "axis", "trace", "labels"],
        checks=[_rchk("ω₃ is constant", "omega_sym", w3, tol=1), _rchk("|L| is constant", "L_mag", Lm, tol=1),
                _rchk("angle between L and ω", "angle_L_omega_deg", ang, tol=2)])
    steps = [S("Body frame", r"For a symmetric body with no torque, $\omega_3$ is constant and $\omega_\perp$ turns about $e_3$ at $\Omega_b=\dfrac{I_3-I_\perp}{I_\perp}\omega_3$.",
               at=0, show=["omega", "axis", "labels"], camera="hero"),
             S("Space frame", r"$\vec L$ is fixed. $e_3$ and $\vec\omega$ both circle $\vec L$ at $L/I_\perp$; all three stay in one plane.", show=["L", "omega", "trace", "labels"], camera="hero"),
             S("Disk numbers", r"For a thin disk $I_3=2I_\perp$, so the body-frame rate equals $\omega_3=%.2f$ rad/s." % w3, show=["L", "omega", "axis", "labels"], camera="hero")]
    return tutor._lesson("Mechanics · torque-free symmetric top (Morin ch. 9)", "Wobbling coin in free flight",
        "A thin uniform disk is thrown spinning about an axis slightly off its symmetry axis, with no torque. Describe the wobble in the body frame and in space.",
        ["disk m = 0.5 kg, r = 0.15 m", "axis tilted 20° from the fixed L-ish direction at start", "precession rate 3 rad/s, spin 2 rad/s", "no torque (gravity off)"],
        [_ans("ω₃", r"\omega_3=\dot\psi+\dot\phi\cos\theta", w3, "rad/s"), _ans("Body-frame rate", r"\Omega_b=\dfrac{I_3-I_\perp}{I_\perp}\omega_3", w3, "rad/s"),
         _ans("|L|", r"L=\sqrt{(I_3\omega_3)^2+(I_\perp\omega_\perp)^2}", Lm, "kg·m²/s")],
        steps, "rigid3d", spec, "3D model of a torque-free disk (gravity off); ω₃, |L| and the L–ω angle are checked.",
        ["Thin uniform disk; no torque."], plan="Euler's equations with I₁ = I₂; then view the same motion from the fixed L.")


@recipe("cube_inertia")
def cube_inertia():
    m, a = 1.0, 0.2
    i = m * a * a / 6
    spec = _r3("uniform cube", [_part("cube", "box", m, [0, 0, 0], size=[a, a, a], color="clay", prop="block")], [1, 1, 1],
        _motion("static", pivot=None, pivot_world=[0, 0, 0.3]), duration=0, gravity=0, show=["principal_axes", "body_axes", "references", "labels"],
        references=[{"kind": "axis", "label": "body diagonal", "point": [-a / 2, -a / 2, -a / 2], "direction": [1, 1, 1], "frame": "body", "length": 0.42},
                    {"kind": "axis", "label": "edge", "point": [a / 2, a / 2, 0], "direction": [0, 0, 1], "frame": "body", "length": 0.3}],
        checks=[_rchk("I₁ = ma²/6", "I1", i, tol=1), _rchk("I₂ = ma²/6", "I2", i, tol=1), _rchk("I₃ = ma²/6", "I3", i, tol=1),
                _rchk("about the body diagonal", "I_sym", i, tol=1)])
    steps = [S("Tensor in edge axes", r"With $x',y',z'$ along the edges through the centre, $I_{xx}=\int(y^2+z^2)dm=\tfrac16ma^2$ and products of inertia vanish by symmetry.",
               show=["body_axes", "labels"], camera="hero"),
             S("Every axis is principal", r"All three moments are equal, so $I=\tfrac16ma^2\,\mathbb 1$: every axis through the centre, including the body diagonal, is principal "
               r"with the same moment.", show=["principal_axes", "references", "labels"], camera="hero"),
             S("Parallel axes", r"About an edge: $\tfrac16ma^2+m\left(\tfrac{a}{\sqrt2}\right)^2=\tfrac23ma^2$. About a corner the tensor is no longer a multiple of $\mathbb 1$.",
               show=["references", "labels"], camera="hero")]
    return tutor._lesson("Mechanics · inertia tensor (Morin ch. 9)", "Inertia tensor of a cube",
        "Find the inertia tensor of a uniform cube of side a about its centre, the moment about a body diagonal, and the moment about an edge.",
        ["uniform cube, m = 1 kg, a = 0.2 m"],
        [_ans("About the centre", r"I=\tfrac16ma^2\,\mathbb 1", i, "kg·m²"), _ans("About a body diagonal", r"\tfrac16ma^2", i, "kg·m²"),
         _ans("About an edge", r"\tfrac23ma^2", 2 / 3 * m * a * a, "kg·m²")],
        steps, "rigid3d", spec, "Still 3D model: the app computes the tensor and principal axes itself; the body axes are the cube's edges.",
        ["Uniform density."], plan="Integrate the diagonal elements, use symmetry for the products, then the parallel-axis theorem.")


@recipe("tilted_rod_axle")
def tilted_rod_axle():
    m, l, th, w = 1.0, 1.0, 30.0, 3.0
    ip = m * l * l / 12
    Lm = ip * w * math.sin(math.radians(th))
    tau = w * Lm * math.sin(math.radians(90 - th))
    spec = _r3("rod on a vertical axle", [_part("rod", "rod", m, [0, 0, 0], axis=[0, 0, 1], length=l, color="steel")], [0, 0, 1],
        _motion("fixed_axis", pivot=[0, 0, 0], pivot_world=[0, 0, 0.8], support="pivot", theta=th, axis=[0, 0, 1], omega=w),
        duration=4.0, show=["omega", "L", "torque", "axis", "vertical", "world_axes", "labels"],
        checks=[_rchk("|L| = I⊥ ω sin θ", "L_mag", Lm, tol=1), _rchk("L is 90° − θ from ω", "angle_L_omega_deg", 90 - th, tol=1),
                _rchk("torque the bearing must supply", "torque_mag", tau, tol=2)])
    steps = [S("ω is not along a principal axis", r"$\vec\omega=\omega\hat z$ is $%g°$ from the rod. Split it along the rod and perpendicular to it." % th,
               at=0, show=["omega", "axis", "world_axes", "labels"], camera="hero"),
             S("L is tilted", r"Along the thin rod $I_3\approx0$, so only $\omega\sin\theta$ counts: $\vec L=I_\perp\omega\sin\theta$ perpendicular to the rod, "
               r"$90°-\theta$ from $\vec\omega$.", show=["omega", "L", "labels"], camera="hero"),
             S("Torque", r"$\vec L$ sweeps around $z$: $|d\vec L/dt|=\omega L\cos\theta=%.3f$ N·m. The bearings must supply it; it rotates with the rod." % tau,
               show=["L", "torque", "labels"], camera="hero")]
    return tutor._lesson("Mechanics · L not parallel to ω (Morin ch. 9)", "Tilted rod on a vertical axle",
        "A uniform thin rod is fixed at its centre to a vertical axle at angle θ to it and turns at constant ω. Find L and the torque the axle must supply.",
        ["m = 1 kg, ℓ = 1 m", "θ = 30° between rod and axle", "ω = 3 rad/s, constant"],
        [_ans("|L|", r"L=\tfrac1{12}m\ell^2\,\omega\sin\theta", Lm, "kg·m²/s"), _ans("Torque", r"\tau=\omega L\cos\theta", tau, "N·m")],
        steps, "rigid3d", spec, "3D model turning at a prescribed rate about the axle; the app computes L and the required torque.",
        ["Thin rod; no gravity torque about the centre."], plan="Decompose ω on the rod's principal axes, build L, then dL/dt = ω × L.")


@recipe("rolling_cone")
def rolling_cone():
    m, alpha, h, prec = 1.0, 20.0, 0.3, 2.0
    th = 90 - alpha
    R = h * math.tan(math.radians(alpha))
    spin = -prec / math.cos(math.radians(th))
    i3 = 0.3 * m * R * R
    ip = 0.6 * m * (R * R / 4 + h * h)
    w3 = spin + prec * math.cos(math.radians(th))
    wp = prec * math.sin(math.radians(th))
    spec = _r3("rolling cone", [_part("cone", "cone", m, [0, 0, h], axis=[0, 0, -1], radius=R, length=h, color="sand")], [0, 0, 1],
        _motion("steady_precession", pivot=[0, 0, 0], pivot_world=[0, 0, 0], support="pivot", theta=th, prec=prec, spin=spin, nut=0),
        duration=4.0, ground=True, show=["omega", "precession", "half_angle", "trace_contact", "labels"],
        checks=[_rchk("ω is horizontal (contact line at rest)", "omega_z", 0, tol=2),
                _rchk("|ω| along the contact line", "omega_mag", math.hypot(w3, wp), tol=1),
                _rchk("|L| about the apex", "L_mag", math.hypot(i3 * w3, ip * wp), tol=2)])
    steps = [S("The setup", r"The cone lies on its side with its apex fixed on the table. Its axis is tilted $\alpha$ above the table, and it goes around the vertical at rate $\Omega$.",
               at=0, show=["precession", "half_angle", "trace_contact", "labels"], camera="hero"),
             S("Contact line at rest", r"Rolling without slipping: every point of the cone touching the table is at rest, so $\vec\omega$ lies along that contact line.",
               at=0, show=["omega", "trace_contact", "labels"], camera="hero"),
             S("Rates", r"$\vec\omega=\Omega\hat z+\dot\psi\,e_3$ is horizontal, so $\dot\psi=-\Omega/\cos\theta$ and $|\omega|=\Omega\tan\theta=\Omega/\tan\alpha$ "
               r"(θ = tilt of $e_3$ from $+z$, here $90°-\alpha$).", show=["omega", "precession", "half_angle", "labels"], camera="hero"),
             S("L about the apex", r"$\vec L=I_3\omega_3e_3+I_\perp\omega_\perp e_\perp$ is not along $\vec\omega$; it sweeps around $z$, and the table's normal force supplies the torque.",
               show=["L", "omega", "trace_contact", "labels"], camera="hero")]
    return tutor._lesson("Mechanics · rolling cone (Morin ch. 9)", "Cone rolling on its side",
        "A solid cone of half-angle α rolls without slipping on a table with its apex fixed, going around at rate Ω. Find ω and L about the apex.",
        ["half-angle α = 20°, height h = 0.3 m, m = 1 kg", "apex fixed on the floor", "Ω = 2 rad/s about the vertical"],
        [_ans("|ω|", r"\omega=\Omega/\tan\alpha", prec / math.tan(math.radians(alpha)), "rad/s"),
         _ans("|L| about the apex", r"\sqrt{(I_3\omega_3)^2+(I_\perp\omega_\perp)^2}", math.hypot(i3 * w3, ip * wp), "kg·m²/s")],
        steps, "rigid3d", spec, "Prescribed 3D motion (steady precession with the rolling condition); the app checks that ω lies along the contact line.",
        ["Rolls without slipping; apex held in place."], plan="Instantaneous axis = contact line; decompose ω on principal axes for L.")


# ---------------------------------------------------------------- analytic curves and diagrams (illustration only)

def _par(name: str, label: str, value: float, lo: float, hi: float, units: str = "") -> dict:
    return {"name": name, "label": label, "value": value, "min": lo, "max": hi, "units": units}


def _curve(cid: str, label: str, expression: str, color: str = "#c5a56c") -> dict:
    return {"id": cid, "label": label, "expression": expression, "color": color}


def _plot(xl: str, yl: str, x0: float, x1: float, y0, y1, params: list, curves: list) -> dict:
    return {"x_label": xl, "y_label": yl, "x_min": x0, "x_max": x1, "y_min": y0, "y_max": y1, "duration": 0,
            "parameters": params, "curves": curves}


GREY = "#8995a3"
TEAL = "#6fb3a8"


def _plain(title: str, body: str) -> dict:
    return S(title, body)


@recipe("catenary_shape")
def catenary_shape():
    a = 1.0
    plot = _plot("x (m)", "height y (m)", -3, 3, 0, 8, [_par("c", "a = T₀ / (λg)", a, 0.3, 3, "m")],
                 [_curve("chain", "hanging chain y = a cosh(x/a) − a", "c*(exp(x/c)+exp(-x/c))/2-c"),
                  _curve("parabola", "small-slope parabola x²/(2a)", "x^2/(2*c)", GREY)])
    steps = [_plain("Forces on a piece", r"For a piece of chain, the horizontal tension $T_0$ is the same everywhere; the vertical part grows with the weight below: $T_0\,y'=\lambda g\,s$."),
             _plain("Differential equation", r"Differentiate: $y''=\dfrac{1}{a}\sqrt{1+y'^2}$ with $a=T_0/(\lambda g)$."),
             _plain("Solution", r"$y=a\cosh(x/a)+\text{const}$. Near the bottom it matches the parabola $x^2/(2a)$; further out it rises faster.")]
    return tutor._lesson("Mechanics · hanging chain (Morin ch. 2)", "Shape of a hanging chain",
        "A uniform flexible chain hangs between two supports. Find the curve it hangs in.", ["uniform chain, mass per length λ", "tension at the lowest point T₀"],
        [_ans("Shape", r"y=a\cosh(x/a)-a,\ a=\dfrac{T_0}{\lambda g}", None, "m")], steps, "plot", plot,
        "Analytic curve; the slider changes a = T₀/(λg). Not a simulation.", ["Perfectly flexible, inextensible chain."],
        plan="Balance a small piece; the horizontal tension is constant.")


@recipe("drag_terminal_velocity")
def drag_terminal_velocity():
    plot = _plot("time t (s)", "speed v (m/s)", 0, 6, 0, 30,
                 [_par("vt", "terminal speed", 20, 5, 30, "m/s")],
                 [_curve("linear", "linear drag: v_t(1 − e^{−gt/v_t})", "vt*(1-exp(-9.8*x/vt))"),
                  _curve("quadratic", "quadratic drag: v_t tanh(gt/v_t)", "vt*(1-exp(-2*9.8*x/vt))/(1+exp(-2*9.8*x/vt))", TEAL),
                  _curve("free", "no drag: gt", "9.8*x", GREY)])
    steps = [_plain("Two drag laws", r"Falling from rest: $m\dot v=mg-bv$ (slow, small objects) or $m\dot v=mg-cv^2$ (fast, large objects)."),
             _plain("Terminal speed", r"Acceleration stops when drag balances weight: $v_t=mg/b$ or $v_t=\sqrt{mg/c}$."),
             _plain("Solutions", r"Linear: $v=v_t(1-e^{-gt/v_t})$. Quadratic: separate variables to get $v=v_t\tanh(gt/v_t)$, which reaches $v_t$ sooner. Both start along $v=gt$.")]
    return tutor._lesson("Mechanics · drag (Morin ch. 3)", "Falling with air drag",
        "An object falls from rest with drag proportional to v or to v². Find v(t) and the terminal speed in each case.",
        ["starts from rest", "same terminal speed v_t for comparison"],
        [_ans("Linear drag", r"v=v_t(1-e^{-gt/v_t})", None, "m/s"), _ans("Quadratic drag", r"v=v_t\tanh(gt/v_t)", None, "m/s")],
        steps, "plot", plot, "Analytic curves for the same terminal speed; not a simulation.", ["Constant g; drag laws as stated."],
        plan="Separate variables in m dv/dt = mg − drag.")


@recipe("potential_well")
def potential_well():
    plot = _plot("x (m)", "energy (J)", -2.5, 2.5, -0.5, 4,
                 [_par("V0", "barrier height", 1, 0.2, 3, "J"), _par("b", "well position", 1, 0.5, 2, "m"), _par("E", "total energy", 0.6, -0.2, 3.5, "J")],
                 [_curve("V", "V(x) = V₀((x/b)² − 1)²", "V0*((x/b)^2-1)^2"), _curve("E", "total energy E", "E", TEAL)])
    steps = [_plain("Read the graph", r"$F=-dV/dx$: the force points downhill. The particle can only be where $V(x)\le E$; turning points are where $E=V$."),
             _plain("Equilibria", r"Minima at $x=\pm b$ are stable, the maximum at $x=0$ is unstable. Near a minimum $V\approx\tfrac12V''(\pm b)(x\mp b)^2$."),
             _plain("Small oscillations", r"$V''(\pm b)=8V_0/b^2$, so $\omega=\sqrt{8V_0/(mb^2)}$. Raise $E$ above $V_0$ and the motion spans both wells.")]
    return tutor._lesson("Mechanics · energy diagrams (Morin ch. 5)", "Motion in a double-well potential",
        "A particle moves in the potential V(x) = V₀((x/b)² − 1)². Find the equilibria, the small-oscillation frequency and the allowed regions for energy E.",
        ["V(x) = V₀((x/b)² − 1)²", "mass m"],
        [_ans("Equilibria", r"x=0\ (\text{unstable}),\ x=\pm b\ (\text{stable})", None, "m"), _ans("Small-oscillation frequency", r"\omega=\sqrt{8V_0/(mb^2)}", None, "rad/s")],
        steps, "plot", plot, "Energy diagram; move E to see the allowed regions. Not a simulation.", ["One-dimensional conservative motion."],
        plan="F = −dV/dx; expand about each minimum.")


@recipe("gravity_inside_planet")
def gravity_inside_planet():
    inner, outer = "g0*x/R", "g0*R^2/x^2"
    plot = _plot("distance from the centre r (km)", "g (m/s²)", 1, 20000, 0, 11,
                 [_par("g0", "surface gravity", 9.8, 1, 10, "m/s²"), _par("R", "planet radius", 6400, 1000, 10000, "km")],
                 [_curve("g", "g(r): ∝ r inside, ∝ 1/r² outside", f"(({inner})+({outer})-abs(({inner})-({outer})))/2")])
    steps = [_plain("Shell theorem", r"Outside a spherical mass, $g=GM/r^2$. Inside a uniform sphere only the mass within $r$ pulls: $M(r)=M r^3/R^3$."),
             _plain("Inside", r"So $g(r)=GMr/R^3=g_0\,r/R$, growing linearly from zero at the centre to $g_0$ at the surface."),
             _plain("Tunnel through the Earth", r"Along a tunnel $\ddot x=-(g_0/R)x$: simple harmonic motion with period $2\pi\sqrt{R/g_0}\approx84$ min for the Earth.")]
    return tutor._lesson("Mechanics · gravity (Morin ch. 5)", "Gravity inside and outside a planet",
        "Find the gravitational field g(r) of a uniform spherical planet, inside and outside, and the motion through a tunnel along a diameter.",
        ["uniform density", "surface gravity g₀, radius R"],
        [_ans("Inside", r"g=g_0\,r/R", None, "m/s²"), _ans("Outside", r"g=g_0R^2/r^2", None, "m/s²"), _ans("Tunnel period", r"T=2\pi\sqrt{R/g_0}", 2 * math.pi * math.sqrt(6.4e6 / G) / 60, "min")],
        steps, "plot", plot, "Analytic field of a uniform sphere; not a simulation.", ["Uniform density; non-rotating planet."],
        plan="Shell theorem for M(r), then F = ma along the tunnel.")


@recipe("effective_potential")
def effective_potential():
    plot = _plot("r (m)", "energy (J)", 0.2, 6, -1.5, 2,
                 [_par("ell", "angular momentum", 1, 0.3, 2, "kg·m²/s"), _par("k", "strength GMm", 1, 0.3, 2, "J·m"), _par("E", "total energy", -0.3, -1.5, 1.5, "J")],
                 [_curve("Ueff", "U_eff = ℓ²/(2mr²) − k/r", "ell^2/(2*x^2)-k/x"), _curve("E", "total energy E", "E", TEAL),
                  _curve("U", "−k/r alone", "-k/x", GREY)])
    steps = [_plain("Reduce to one dimension", r"With $\ell=mr^2\dot\theta$ conserved, $E=\tfrac12m\dot r^2+U_{\text{eff}}(r)$, where $U_{\text{eff}}=\dfrac{\ell^2}{2mr^2}-\dfrac kr$ (m = 1 kg here)."),
             _plain("Orbit types", r"$E<0$: bound between two turning points (ellipse). $E=U_{\min}$: circle at $r=\ell^2/(mk)$. $E\ge0$: unbound."),
             _plain("Centrifugal barrier", r"The $\ell^2/(2mr^2)$ term keeps the particle away from $r=0$ unless $\ell=0$.")]
    return tutor._lesson("Mechanics · central forces (Morin ch. 7)", "Effective potential for a Kepler orbit",
        "A mass moves under the attractive force F = −k/r². Use the effective potential to classify the orbits and find the circular-orbit radius.",
        ["F = −k/r² (attractive)", "angular momentum ℓ", "m = 1 kg for the plot"],
        [_ans("Circular orbit", r"r_0=\dfrac{\ell^2}{mk}", None, "m"), _ans("Bound if", r"E<0", None, "")],
        steps, "plot", plot, "Effective-potential diagram; move E to see turning points. Not an orbit simulation.", ["Point masses; the central body does not move."],
        plan="Use ℓ to remove θ, then read the 1D energy diagram.")


@recipe("bead_hoop_potential")
def bead_hoop_potential():
    # Dimensionless so one fixed y-range shows every case: u = U_eff/(mgR), q = ω²R/g in [0, 4].
    # u(0) = −1 and u(±π) = +1 always; the off-bottom minima u = −(q + 1/q)/2 bottom out at −2.125 when q = 4.
    plot = _plot("angle from the bottom θ (rad)", "U_eff / (mgR)", -3.1416, 3.1416, -2.5, 1.5,
                 [_par("q", "spin ratio ω²R/g", 2, 0, 4, "")],
                 [_curve("U", "U_eff/(mgR) = −cos θ − ½ (ω²R/g) sin² θ", "-cos(x)-q*sin(x)^2/2")])
    steps = [_plain("Rotating frame", r"In the hoop's frame a bead feels gravity and the centrifugal force: $U_{\text{eff}}=-mgR\cos\theta-\tfrac12mR^2\omega^2\sin^2\theta$. Divide by $mgR$ and write $q=\omega^2R/g$: $u=-\cos\theta-\tfrac q2\sin^2\theta$."),
             _plain("Equilibria", r"$du/d\theta=\sin\theta\,(1-q\cos\theta)=0$: the bottom $\theta=0$ and the top $\theta=\pi$ always, plus $\pm\theta_0$ with $\cos\theta_0=1/q=g/(R\omega^2)$ when $q>1$."),
             _plain("Stability", r"The top is always a maximum (unstable). For $q<1$ the bottom is the only minimum. Past $q=1$, i.e. $\omega>\sqrt{g/R}$, the bottom becomes a maximum and $\pm\theta_0$ are the stable minima. Slide $q$ across 1 to watch the switch.")]
    return tutor._lesson("Mechanics · rotating frames (Morin ch. 6, 10)", "Bead on a spinning hoop",
        "A bead slides without friction on a vertical hoop of radius R spinning at ω about its vertical diameter. Find the equilibrium angles and their stability.",
        ["hoop radius R, spin ω about the vertical diameter", "frictionless bead"],
        [_ans("Equilibria", r"\theta=0,\ \theta=\pi,\ \cos\theta_0=\dfrac{g}{R\omega^2}", None, "", "θ = π is always unstable; ±θ₀ exist (and are stable) only for ω² > g/R."),
         _ans("Critical rate", r"\omega_c=\sqrt{g/R}", None, "rad/s")],
        steps, "plot", plot, "Dimensionless effective-potential curve; the slider changes q = ω²R/g from 0 to 4. Not a simulation.",
        ["Frictionless bead; hoop forced at constant ω."],
        plan="Write U_eff in the rotating frame (or the Lagrangian), find every stationary point, check the second derivative.")


@recipe("velocity_addition_graph")
def velocity_addition_graph():
    plot = _plot("u (units of c)", "w (units of c)", -0.99, 0.99, -2, 2,
                 [_par("v", "frame speed v (units of c)", 0.6, -0.95, 0.95, "c")],
                 [_curve("rel", "relativistic w = (u + v)/(1 + uv)", "(x+v)/(1+x*v)"), _curve("gal", "Galilean w = u + v", "x+v", GREY),
                  _curve("c", "speed of light", "1", TEAL)])
    steps = [_plain("Composing speeds", r"An object moves at $u$ in frame $S'$, which moves at $v$ in $S$. Galileo says $w=u+v$, which can exceed $c$."),
             _plain("Lorentz result", r"$w=\dfrac{u+v}{1+uv/c^2}$. It never exceeds $c$, and $u=c$ gives $w=c$ for every $v$."),
             _plain("Rapidities add", r"Write $v=c\tanh\phi$: then $\phi_w=\phi_u+\phi_v$. Velocity addition is just adding angles of a hyperbolic rotation.")]
    return tutor._lesson("Relativity · velocity addition (Morin ch. 11)", "Relativistic velocity addition",
        "A ball moves at u relative to a train moving at v. Find its speed in the ground frame and compare with the Galilean result.",
        ["speeds in units of c", "collinear motion"],
        [_ans("Ground speed", r"w=\dfrac{u+v}{1+uv/c^2}", None, "c")], steps, "plot", plot,
        "Analytic curves in units of c; diagram only, no simulation.", ["Special relativity, collinear velocities."],
        plan="Lorentz-transform the worldline x′ = ut′, or add rapidities.")


@recipe("hyperbolic_worldline")
def hyperbolic_worldline():
    plot = _plot("ground time t (units of c/g)", "distance x (units of c²/g)", 0, 4, 0, 4,
                 [_par("gp", "proper acceleration", 1, 0.3, 2, "g")],
                 [_curve("rel", "constant proper acceleration", "(sqrt(1+(gp*x)^2)-1)/gp"), _curve("newton", "Newtonian ½gt²", "gp*x^2/2", GREY),
                  _curve("light", "light ray x = ct", "x", TEAL)])
    steps = [_plain("Constant proper acceleration", r"The rocket feels a constant $g$ in its instantaneous rest frame. The ground sees $\gamma^3\,dv/dt=g$."),
             _plain("Worldline", r"Integrating: $x=\dfrac{c^2}{g}\left(\sqrt{1+(gt/c)^2}-1\right)$, a hyperbola in spacetime that approaches the light line but never crosses it."),
             _plain("Early times", r"For $gt\ll c$ it matches $\tfrac12gt^2$; later the speed saturates below $c$.")]
    return tutor._lesson("Relativity · acceleration (Morin ch. 12, 14)", "Hyperbolic motion",
        "A rocket starts from rest and keeps a constant proper acceleration g. Find its position as a function of ground time.",
        ["constant proper acceleration g", "starts from rest at x = 0"],
        [_ans("Position", r"x=\dfrac{c^2}{g}\left(\sqrt{1+(gt/c)^2}-1\right)", None, "m"), _ans("Speed", r"v=\dfrac{gt}{\sqrt{1+(gt/c)^2}}", None, "m/s")],
        steps, "plot", plot, "Analytic worldline in units of c and g; diagram only.", ["Special relativity; straight-line motion."],
        plan="Transform the acceleration to the ground frame and integrate.")


def _node(nid: str, x: float, y: float, label: str = "", kind: str = "point") -> dict:
    return {"id": nid, "kind": kind, "label": label, "x": round(x, 4), "y": round(y, 4), "width": 0, "height": 0}


def _edge(eid: str, a: str, b: str, label: str = "", kind: str = "line") -> dict:
    return {"id": eid, "from": a, "to": b, "label": label, "kind": kind}


@recipe("coriolis_free_particle")
def coriolis_free_particle():
    v, w, n, T = 1.0, 1.0, 24, 2.5
    nodes = [_node("o", 0, 0, "centre O")]
    edges = []
    for i in range(1, n + 1):
        t = T * i / n
        nodes.append(_node(f"p{i}", v * t * math.cos(-w * t), v * t * math.sin(-w * t), "seen on the disk" if i == n else ""))
        edges.append(_edge(f"e{i}", "o" if i == 1 else f"p{i - 1}", f"p{i}"))
    nodes += [_node("s", v * T, 0, "straight path (inertial)"), _node("xa", 2.8, 0.0, "x′", "label"), _node("ya", 0.0, 2.8, "y′", "label")]
    edges.append(_edge("inertial", "o", "s", "", "arrow"))
    diagram = {"x_min": -3, "x_max": 3, "y_min": -3, "y_max": 3, "nodes": nodes, "edges": edges}
    steps = [_plain("Inertial view", r"A puck slides from the centre of a turntable with no friction: in the ground frame it moves in a straight line at constant speed."),
             _plain("Rotating view", r"On the disk (turning counter-clockwise at $\omega$) the same motion curls clockwise: $\vec r'=vt(\cos\omega t,-\sin\omega t)$."),
             _plain("Fictitious forces", r"In the rotating frame the curvature is produced by the Coriolis force $-2m\vec\omega\times\vec v'$ together with the centrifugal force $m\omega^2r$.")]
    return tutor._lesson("Mechanics · rotating frames (Morin ch. 10)", "Free particle seen from a turntable",
        "A puck slides outward from the centre of a frictionless turntable that spins at ω. Describe its path in the ground frame and in the turntable's frame.",
        ["v = 1 m/s outward", "ω = 1 rad/s counter-clockwise", "frictionless"],
        [_ans("Path on the disk", r"\vec r'(t)=vt(\cos\omega t,\,-\sin\omega t)", None, "m", "An Archimedean spiral.")],
        steps, "diagram", diagram, "Sampled path in the rotating frame against the inertial straight line; computed from the formula, not simulated.",
        ["Frictionless puck; constant ω."], plan="Write the inertial motion, then rotate coordinates by −ωt.")


@recipe("minkowski_train")
def minkowski_train():
    b, s = 0.6, 4.0
    nodes = [_node("o", 0, 0, "O"), _node("x", s, 0, "x"), _node("ct", 0, s, "ct"), _node("xp", s, b * s, "x′"), _node("ctp", b * s, s, "ct′"),
             _node("light", s, s, "light: x = ct"), _node("a", -2, 0, "rear flash", "point"), _node("b2", 2, 0, "front flash", "point"),
             _node("sim1", -2, -2 * b, ""), _node("sim2", 2, 2 * b, "simultaneous in the train")]
    edges = [_edge("ax", "o", "x", "", "arrow"), _edge("act", "o", "ct", "", "arrow"), _edge("axp", "o", "xp", "", "arrow"),
             _edge("actp", "o", "ctp", "", "arrow"), _edge("ray", "o", "light", "", "ray"), _edge("simline", "sim1", "sim2", "t′ = 0")]
    diagram = {"x_min": -3, "x_max": 4.5, "y_min": -2, "y_max": 4.5, "nodes": nodes, "edges": edges}
    steps = [_plain("Ground axes", r"Space $x$ to the right, time $ct$ up; light travels at 45°."),
             _plain("Train axes", r"For the train at $v=%.1fc$ the $ct'$ axis is its worldline $x=vt$ (slope $1/\beta$ from the $x$ axis), and the $x'$ axis has slope $\beta$." % b),
             _plain("Relativity of simultaneity", r"Lines parallel to $x'$ are 'now' for the train. Two flashes simultaneous on the ground (on the $x$ axis) are not on one $x'$ line: the front happens first for the train.")]
    return tutor._lesson("Relativity · Minkowski diagrams (Morin ch. 11)", "Minkowski diagram for a moving train",
        "Draw the ground and train axes on one spacetime diagram for a train moving at v = 0.6c, and use it to compare which events are simultaneous.",
        ["β = v/c = 0.6", "c = 1 units"],
        [_ans("Train axes", r"ct'\text{ axis: }x=\beta ct;\quad x'\text{ axis: }ct=\beta x", None, ""), _ans("γ", r"\gamma=1/\sqrt{1-\beta^2}", 1 / math.sqrt(1 - b * b), "")],
        steps, "diagram", diagram, "Spacetime diagram; geometry only, no simulation.", ["Special relativity; one space dimension."],
        plan="Set x′ = 0 and t′ = 0 in the Lorentz transformation to find the primed axes.")

# Generic experiments appended to preserve the existing builder/catalog order.
@recipe("elastic_pendulum")
def elastic_pendulum():
    top, p, k, rest = [0, 3], [0.8, 1.6], 12.0, 1.0
    steps = [S("Two coordinates", r"The spring length $r$ and angle $\theta$ can both change. Start at rest; this is not a fixed-length pendulum.", at=0, show=["labels"], camera="side"),
             S("Radial force", r"$m(\ddot r-r\dot\theta^2)=mg\cos\theta-k(r-r_0)$. Tangentially, $r\ddot\theta+2\dot r\dot\theta=-g\sin\theta$.", at=0.4, show=["forces", "labels"], camera="side"),
             S("Energy moves between motions", r"$E=\frac12m(\dot r^2+r^2\dot\theta^2)+mgy+\frac12k(r-r_0)^2$. Watch stretching and swinging exchange energy; neither energy alone is constant.", at=1.2, show=["velocity", "trail", "labels"], camera="side")]
    scene = _scene("Elastic pendulum", steps, bodies=[_bob("bob", p)], duration=3, focus="bob",
        joints=[{"id": "elastic", "type": "spring", "a": "world", "b": "bob", "anchorA": top, "anchorB": p, "k": k, "rest": rest, "damping": 0, "label": "spring"}])
    return _experiment("Elastic pendulum", "How does stretching change a swinging pendulum?",
        ["m = 1 kg", "k = 12 N/m", "rest length = 1 m", "pivot (0, 3) m; bob (0.8, 1.6) m", "released from rest"], steps, scene,
        [_ans("Vertical equilibrium length", r"r_{eq}=r_0+mg/k", rest+G/k, "m")],
        ["Massless Hooke spring; point bob; no damping. Numerical spring integration has small energy loss."])


@recipe("coupled_pendulums")
def coupled_pendulums():
    L, d, k, a = 1.4, 1.5, 1.8, 0.12
    p1, p2 = [-d/2+L*math.sin(a), 2.8-L*math.cos(a)], [d/2, 2.8-L]
    w1, w2 = math.sqrt(G/L), math.sqrt(G/L+2*k)
    steps = [S("One bob starts", r"Both rods have length $L$. Only the left bob starts displaced; the spring joins their centres.", at=0, show=["labels"], camera="side"),
             S("Two small-angle modes", r"In phase, the spring barely stretches: $\omega_+=\sqrt{g/L}$. Out of phase: $\omega_-=\sqrt{g/L+2k/m}$. These are small-angle predictions.", at=1, show=["forces", "labels"], camera="side"),
             S("Beating", r"Superpose the modes: $x_1\simeq A(\cos\omega_+t+\cos\omega_-t)/2$, $x_2\simeq A(\cos\omega_+t-\cos\omega_-t)/2$. One swing fades as the other grows.", at=4, show=["velocity", "trail", "labels"], camera="side")]
    scene = _scene("Coupled pendulums", steps, bodies=[_bob("left", p1), _bob("right", p2)], duration=10, focus="left",
        joints=[{"id": "rod1", "type": "rod", "a": "world", "b": "left", "anchorA": [-d/2,2.8], "anchorB": p1, "length": L},
                {"id": "rod2", "type": "rod", "a": "world", "b": "right", "anchorA": [d/2,2.8], "anchorB": p2, "length": L},
                {"id": "coupling", "type": "spring", "a": "left", "b": "right", "anchorA": p1, "anchorB": p2, "k": k, "rest": d, "damping": 0}])
    return _experiment("Coupled pendulums", "Why does motion pass between two pendulums connected by a spring?",
        ["m = 1 kg each", "L = 1.4 m", "pivot separation = spring rest length = 1.5 m", "k = 1.8 N/m", "left starts at 0.12 rad; right at rest"], steps, scene,
        [_ans("In-phase frequency", r"\omega_+=\sqrt{g/L}", w1, "rad/s"), _ans("Out-of-phase frequency", r"\omega_-=\sqrt{g/L+2k/m}", w2, "rad/s")],
        ["Point bobs, massless rods and spring; full nonlinear simulated motion, approximate small-angle mode formulas."])


@recipe("pendulum_cradle_pair")
def pendulum_cradle_pair():
    L, theta, r = 1.5, math.radians(30), 0.12
    p1, p2 = [-r-L*math.sin(theta), 3-L*math.cos(theta)], [r,3-L]
    v = math.sqrt(2*G*L*(1-math.cos(theta)))
    b1, b2 = _bob("left",p1), _bob("right",p2)
    b1["restitution"] = b2["restitution"] = 1
    steps = [S("Release one bob", r"Two equal bobs hang on equal rods. Their surfaces touch when both rods are vertical. Release the left bob from $30^\circ$.", at=0, show=["labels"], camera="side"),
             S("A brief collision", r"Near the bottom, $u=\sqrt{2gL(1-\cos\theta_0)}$. Equal masses in an ideal elastic, head-on collision exchange horizontal velocities.", at=0.62, show=["velocity", "labels"], camera="side"),
             S("The other bob rises", r"After contact the right bob rises toward the release height. This two-bob cradle avoids ambiguous simultaneous multi-ball impacts. Contact is a rigid impulse, not resolved elastic compression.", at=1.2, show=["trail", "labels"], camera="side")]
    scene = _scene("Two-bob cradle", steps, bodies=[b1,b2], duration=3, focus="right",
        joints=[{"id":"rod1","type":"rod","a":"world","b":"left","anchorA":[-r,3],"anchorB":p1,"length":L},
                {"id":"rod2","type":"rod","a":"world","b":"right","anchorA":[r,3],"anchorB":p2,"length":L}])
    return _experiment("Two-bob cradle", "How does an elastic collision pass motion to the other pendulum?",
        ["m = 1 kg each", "L = 1.5 m", "bob radius = 0.12 m", "left release = 30 degrees", "restitution = 1; no friction"], steps, scene,
        [_ans("Ideal incoming bottom speed", r"u=\sqrt{2gL(1-\cos\theta_0)}",v,"m/s")],
        ["Point-mass rotational inertia; finite circular contact geometry; rigid restitution impulses and finite solver contact tolerance."])


@recipe("cart_pendulum")
def cart_pendulum():
    M,m,L,a = 3.0,1.0,1.3,math.radians(35)
    centre=[0,1.9]; pivot=[0,1.65]; p=[L*math.sin(a),pivot[1]-L*math.cos(a)]
    steps=[S("A support that recoils", r"The cart rolls along suspended frictionless rails. A rod attaches to its underside; the pendulum starts at $35^\circ$; both begin at rest.", at=0, show=["labels"], camera="side"),
           S("Horizontal momentum", r"No external horizontal force: $(M+m)\dot X+mL\cos\theta\,\dot\theta=0$. As the bob moves left, the cart moves right.", at=0.5, show=["velocity", "labels"], camera="side"),
           S("Energy and centre of mass", r"$MX+mx_b$ stays constant. Gravity trades potential energy for translation of both bodies; a fixed-pivot pendulum formula would miss the cart's kinetic energy.", at=1.4, show=["trail", "forces", "labels"], camera="side")]
    # Fixed support geometry is drawing-only: the slider supplies the entire guide reaction.
    # Cart prop wheel contacts lie at y = centre_y - h/2, z = +/-0.258 m.
    supports = [
        {"id":"rail_back","type":"static","shape":"box","w":3.0,"h":0.08,"pos":[0.2,1.61],"render":{"kind":"rod","z":-0.258}},
        {"id":"rail_front","type":"static","shape":"box","w":3.0,"h":0.08,"pos":[0.2,1.61],"render":{"kind":"rod","z":0.258}},
        {"id":"cross_left","type":"static","shape":"box","w":0.11,"h":0.08,"pos":[-1.3,1.61],"render":{"kind":"box","thick":0.62}},
        {"id":"cross_right","type":"static","shape":"box","w":0.11,"h":0.08,"pos":[1.7,1.61],"render":{"kind":"box","thick":0.62}},
        {"id":"hanger_left","type":"static","shape":"box","w":0.07,"h":0.9,"pos":[-1.3,2.1],"render":{"kind":"rod","z":-0.258}},
        {"id":"hanger_right","type":"static","shape":"box","w":0.07,"h":0.9,"pos":[1.7,2.1],"render":{"kind":"rod","z":-0.258}},
        {"id":"overhead","type":"static","shape":"box","w":3.2,"h":0.12,"pos":[0.2,2.55],"render":{"kind":"rod","z":-0.258}}]
    scene=_scene("Pendulum on a free cart", steps, bodies=[*supports,
        {"id":"cart","shape":"box","w":0.9,"h":0.5,"mass":M,"pos":centre,"friction":0,"label":"cart","render":{"kind":"box","prop":"cart"}}, _bob("bob",p,m)],
        duration=5,focus="bob", joints=[{"id":"guide","type":"slider","a":"world","b":"cart","anchor":centre,"axis":[1,0]},
            {"id":"rod","type":"rod","a":"cart","b":"bob","anchorA":pivot,"anchorB":p,"length":L}], nocollide=[["cart","bob"]]+[[b["id"],d] for b in supports for d in ("cart","bob")])
    return _experiment("Pendulum on a free cart", "How does a freely moving support change a pendulum?",
        ["cart M = 3 kg", "bob m = 1 kg", "L = 1.3 m", "release = 35 degrees", "horizontal frictionless guide"],steps,scene,
        [_ans("Cart shift at first vertical crossing", r"\Delta X=mL\sin\theta_0/(M+m)",m*L*math.sin(a)/(M+m),"m")],
        ["Slider supplies the frictionless guide reaction and prevents cart rotation. Visible rails and hangers are collision-free support illustrations. Rod attaches at the underside; bob passes in front without cart contact."])


@recipe("movable_pulley")
def movable_pulley():
    m,M,R=1.0,3.0,0.22
    A,B=[-1.4,2.0],[0.8,2.0]
    a=(M-2*m)*G/(M+4*m); T=m*(G+2*a)
    steps=[S("Two supporting strands", r"A light sheave carriage (0.05 kg) carries a 2.95 kg block: 3 kg moving together. The 1 kg free end rises twice as far as the load descends: $\Delta y_A+2\Delta y_B=0$.",at=0,show=["labels","tensions"],camera="side"),
           S("Force balance", r"Take the load's downward acceleration as $a$: $Mg-2T=Ma$ and $T-mg=2ma$. The two supporting strands each carry $T$.",at=0.2,show=["forces","tensions","labels"],camera="side"),
           S("Mechanical advantage", r"$a=(M-2m)g/(M+4m)=1.4$ m/s² downward; the free end accelerates upward at 2.8 m/s². Work is conserved because the free end travels twice as far.",at=0.5,show=["velocity","labels"],camera="side")]
    # Support/anchor shapes carry no extra dynamics; the world constraints carry their reactions.
    supports = [
        {"id":"header","type":"static","shape":"box","w":2.8,"h":0.14,"pos":[-0.1,4.43],"render":{"kind":"rod","z":-0.16}},
        {"id":"left_axle_support","type":"static","shape":"box","w":0.07,"h":0.43,"pos":[-1.18,4.215],"render":{"kind":"rod","z":-0.07}},
        {"id":"right_axle_support","type":"static","shape":"box","w":0.07,"h":0.43,"pos":[0.36,4.215],"render":{"kind":"rod","z":-0.07}},
        {"id":"rope_anchor","type":"static","shape":"box","w":0.09,"h":0.46,"pos":[1.02,4.2],"render":{"kind":"box","thick":0.2,"z":-0.06}}]
    carried=[B[0],B[1]-0.65]
    scene=_scene("Movable pulley: 2 to 1",steps,bodies=[*supports,
        {"id":"fixed","type":"static","shape":"circle","r":R,"pos":[-1.18,4],"render":{"kind":"disk","prop":"pulley"}},
        {"id":"redirect","type":"static","shape":"circle","r":R,"pos":[0.36,4],"render":{"kind":"disk","prop":"pulley"}},
        {"id":"load","shape":"circle","r":R,"mass":0.05,"inertia":"solid_cylinder","pos":B,"label":"sheave","render":{"kind":"disk","prop":"pulley"}},
        {"id":"carried","shape":"box","w":0.44,"h":0.46,"mass":M-0.05,"pos":carried,"label":"2.95 kg","render":{"kind":"box","prop":"block"}},
        {"id":"end","shape":"box","w":0.38,"h":0.42,"mass":m,"pos":A,"label":"1 kg","render":{"kind":"box","prop":"block"}}], duration=0.7,focus="load",
        joints=[{"id":"railA","type":"slider","a":"world","b":"end","anchor":A,"axis":[0,1]},
                {"id":"railB","type":"slider","a":"world","b":"load","anchor":B,"axis":[0,1]},
                {"id":"rope","type":"pulley","a":"end","b":"load","groundA":[-1.4,4],"groundB":[0.8,4],"anchorA":A,"anchorB":B,"ratio":2,"label":"rope force"},
                {"id":"load_guide","type":"slider","a":"world","b":"carried","anchor":carried,"axis":[0,1]},
                {"id":"hanger","type":"rod","a":"load","b":"carried","anchorA":B,"anchorB":carried,"length":0.65,"label":"load support"}],
        strings=[{"id":"path","via":[{"body":"end","attach":"top"},{"wrap":"fixed","ccw":False},{"wrap":"redirect","ccw":False},{"wrap":"load","ccw":True},{"world":[1.02,4]}],"tension":[],"labels":[]}],
        nocollide=[[b["id"],d] for b in supports for d in ("end","load","carried")]+[["load","carried"]],
        checks=[_chk("load acceleration", "ay",-a,at=0.35,body="load"),_chk("free-end acceleration","ay",2*a,at=0.35,body="end")])
    return _experiment("Movable pulley: 2 to 1", "Why do two rope strands halve the force but double the travel?",
        ["free mass = 1 kg", "sheave carriage 0.05 kg + block 2.95 kg = 3 kg", "ratio = 2", "released from rest"],steps,scene,
        [_ans("Load acceleration",r"a=(M-2m)g/(M+4m)",a,"m/s²"),_ans("Strand tension",r"T=m(g+2a)",T,"N")],
        ["Ideal frictionless rope redirection; sheave spin not modeled. Moving carriage 0.05 kg and carried block 2.95 kg translate together on vertical guides. The hanger transmits force; fixed header/axle brackets/anchor are collision-free support illustrations."])


@recipe("ballistic_pendulum")
def ballistic_pendulum():
    m,M,u,L=0.05,0.95,20.0,1.5
    v=m*u/(m+M); height=v*v/(2*G); angle=math.degrees(math.acos(1-height/L))
    p,top=[0,1.5],[0,3]
    steps=[S("Start just after impact", r"A 0.05 kg projectile at 20 m/s has already embedded in a 0.95 kg bob. Playback begins with the combined 1 kg mass moving horizontally at 1 m/s; the collision is not animated.",at=0,show=["velocity","labels"],camera="side"),
           S("Use momentum for impact", r"Over the short impact, horizontal momentum gives $mu=(M+m)v$. Kinetic energy is lost on embedding: $K_{before}=10$ J, $K_{after}=0.5$ J.",at=0,show=["labels"],camera="side"),
           S("Use energy for the swing", r"After impact, $\frac12(M+m)v^2=(M+m)gh$. Thus $h=0.0510$ m and $\theta_{max}=\cos^{-1}(1-h/L)=14.99^\circ$ approximately.",at=0.62,show=["trail","forces","labels"],camera="side")]
    scene=_scene("Ballistic pendulum: post-impact swing",steps,bodies=[_bob("combined",p,m+M,[v,0])],duration=4,focus="combined",
        joints=[{"id":"rod","type":"rod","a":"world","b":"combined","anchorA":top,"anchorB":p,"length":L}])
    return _experiment("Ballistic pendulum: after impact", "How can a swing reveal a projectile's incoming speed?",
        ["projectile m = 0.05 kg, u = 20 m/s", "bob M = 0.95 kg", "L = 1.5 m", "starts after embedding at v = 1 m/s"],steps,scene,
        [_ans("Post-impact speed",r"v=mu/(M+m)",v,"m/s"),_ans("Rise",r"h=v^2/(2g)",height,"m"),_ans("Maximum angle",r"\theta=\cos^{-1}(1-h/L)",angle,"degrees")],
        ["Impact is a stated initial condition, not simulated; point bob, massless rod, no drag during swing."])
