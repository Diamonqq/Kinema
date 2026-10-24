# Pendulum: physics core and renderer plan

Headless core only; no UI or device checks yet. Read the motion-generator note
for shared integration boundaries and the sandbox test-runner workaround.

## Original and improvements

Inspected the original [GMPEND force/energy source](https://github.com/palazzol/cups/blob/master/DOS/CUPS/CUPSCM/GENMOT/GMPEND.PAS)
and GENMOT help/interfaces. Panel's reader caps each excerpt at 6000 characters;
later source sections were unavailable in that read. CUPS already had the exact
sine restoring torque, adjustable mass/gravity/length, linear damping torque,
periodic torque, and kinetic/total energy and bob coordinates, using GENMOT's
configurable graph/initial-condition infrastructure. ANHARM additionally offered
pendulum phase/Poincaré tools. These are existing CUPS capabilities, not claimed
as new inventions.

New core provides unit-checked schema, named teaching presets, exact large-angle
period evaluation, a selectable small-angle comparison model, two genuinely
integrated nearby starts, exact drive-cycle sampling, drive work and dissipated
energy. The tested Period doubling preset has two distinct alternating strobe
states after transients. Sensitivity preset demonstrates positive finite-time
divergence; it is not a proof of an asymptotic Lyapunov exponent or universal chaos.
Double pendulum is intentionally not offered in this pass.

## Equations and model semantics

`I=mL²`, `θ̇=ω`, `Iω̇=−mgL sinθ − bω + τd cos(Ωt+φ)`.
Angles are radians from vertically down toward positive x; y points up.
K=`Iω²/2`, U=`mgL(1−cosθ)`. In explicit small-angle mode, sinθ becomes θ
and U becomes `mgL θ²/2`. Physical bob geometry still uses the true angle.

`T=4 sqrt(L/g) K(sin(θmax/2))`, with complete elliptic integral K evaluated
by the arithmetic-geometric mean. `exactPeriod(amplitude,L,g)` is exported.
The `linear` enum is `exact` or `linear`. The near-resonance preset uses 3.13 rad/s;
drive-frequency controls use a 1/300 rad/s grid so the exact 2/3 chaos drive is
representable. Instance `period()` computes the libration period from current energy only when
undamped/undriven; it returns Infinity at/above the separatrix and null for driven
or damped runs. Above-separatrix rotation periods are not offered as librations.

Verlet for conservative motion; RK4 for driven/damped motion; maximum internal
step 1 ms, reduced for high frequency or damping. Nearby starts use identical
substeps/drive phase. Separation is `sqrt(wrap(δθ)²+(δω/ω0)²)`; it is an
angular-state norm, not a physical distance between bobs. `section()` supplies
wrapped θ and ω at `t=n 2π/Ω` with exact event boundaries, capped at 4096 points.
First sample is after a full drive cycle; there are no sections when drive=0.

`E−W+Q−E0` is the energy-balance residual. Angular momentum is instantaneous,
not conserved under gravitational/damping/driving torque. This is a rigid rod,
not a string: negative radial tension means compression, with no fake taut string.

## Exact renderer plan

- Quiet first view: anchored pivot, visibly proportioned rod/bob, faint equilibrium
  reference and a fixed small caption (θ, ω). Frame the entire circle for rotations;
  otherwise frame the complete swing arc. Reset recenters. No floating formula wall.
- Setup chips: Small angle, Large angle, Damped, Driven resonance, Period doubling,
  Sensitivity. Show radians/degrees together in angle controls while passing radians.
  Keep small-angle approximation explicit in Setup and the compact key when active.
- Graphs: θ(t) (unwrapped for rotations), ω(t), K/U/E, W/Q, θ–ω phase portrait;
  driven cases add Poincaré section and drive-phase marker. Default graph is θ(t).
  Fade transients when requested, never silently delete them from the experiment.
- Sensitivity is opt-in: second bob/trail muted violet, identical drive, initial
  offset shown, graph `ln(δ(t)/δ0)`; explain that apparent divergence saturates.
- Close-up target by bob: `τg=−mgL sinθ`; show mg split into tangential `−mg sinθ`
  and radial `mg cosθ` with θ correctly placed at pivot, and the signed torque arm.
- Close-up target at pivot/drive: `Iα=τg−bω+τd cos(Ωt+φ)` with the three signed
  torque contributions and actual phase, visually distinct from angle θ.
- Large-angle comparison close-up: actual arc vs small-angle tangent, `sinθ` vs θ,
  then `T/T0=2K(sin(θmax/2))/π`, showing why a wider swing is slower.
- Breakdown adds those force/torque components one step at a time, followed by
  the governing equation. Use a caption band, not labels bouncing with motion.
- On 320px use one graph/close-up at a time; Back returns to the whole apparatus.

## Verification

`tests/experiments/pendulum.test.mjs`: small-angle period, independent elliptic
quadrature at four amplitudes, measured large-angle period, 100 s conservation,
exact damped linear envelope, driven linear steady-state amplitude AND phase,
exact Poincaré timestamps, 60 s positive nearby-state divergence, and a 700 s
period-two attractor check. Tolerances are explicit in each test name.
Driven analytic tests intentionally enable the linear comparison model; they do
not falsely claim nonlinear resonance has the linear analytic amplitude.
