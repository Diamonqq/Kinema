# Pendulum: physics core and renderer plan

Physics core and kit-based canvas view; no device checks yet. Read the motion-generator note
for shared integration boundaries and the sandbox test-runner workaround.

## Original and improvements

Read the complete local GMPEND.PAS and GENMOT.HLP, plus all ANHARM.HLP and
ANHPHY.PAS sections relevant to pendulum comparisons and analysis. No original
code or prose is incorporated. Coverage means physics/data, not completed views.

## CUPS coverage

| Original capability/example/plot | Kinema status and evidence |
|---|---|
| Exact sine restoring torque, adjustable mass/length/gravity | Improved: unit/range schema, exact large-angle period via elliptic integral, independent quadrature checks. |
| Editable angle/angular velocity, librations and either rotation direction | Improved: Over the top/Reverse rotation presets and measured exact rotation-period checks. |
| Linear damping torque | Improved: Damped example, heat accounting and analytic small-angle decay test. |
| Periodic cosine torque with editable amplitude/frequency | Improved: drive phase, driven resonance, analytic linear amplitude AND phase checks. |
| Kinetic, potential and total energy | Improved: bottom-zero potential differs by harmless constant from GMPEND; drive work, dissipated heat and balance residual added. |
| Angle, angular velocity, acceleration, time and numerical readout | Yes (data): sample observables support arbitrary paired graphs. |
| Bob Cartesian coordinates and animated pendulum | Yes (geometry data): physically proportioned bob/pivot; rendering pending. |
| Moving driven actuator illustration | Yes (data): actual signed drive torque and phase; actuator rendering pending. |
| SHO / exact pendulum comparison in ANHARM | Improved: exact/linear restoring selector and comparison() energies/torques. |
| Higher-order sine/potential approximation in ANHARM | Improved: cubic restoring approximation uses theta - theta^3/6 and negative quartic potential correction. CUPS source has a positive correction; intentionally corrected, with gradient/conservation tests. |
| ANHARM energy-selected starts and well/direction choice | Yes via initial theta/omega and energy readout; rotation examples cover both signs. Energy-click UI awaits the kit. |
| Energy/period dependence on angle, energy, g/L | Improved: exactPeriod(amplitude,L,g), period() for libration, rotationPeriod() separately above barrier. |
| Phase portrait and linked position/time graphs | Yes (data): unwrapped theta/omega plus shared sample time; rendering pending. |
| Driven Poincaré maps with up to 32 drive phases, transient removal and movies | Improved (data): phaseCount, exact-event sections() grouped by phase and timestamps for caller filtering/animation. |
| Compare retained phase maps / mark section points on phase plot | Yes (data): independent instances and timestamped section points; plots pending. |
| One-drive-period velocity return map and phase movie | Yes (data): returnMap(phase), tested adjacency and timestamps. |
| Fourier analysis using angular velocity for full rotations | Improved: frequencyAnalysis defaults to omega, with complex/amplitude/phase output and four windows; shared analysis tests. |
| Nonlinear resonance sweeps / parameter-space search | Supplied for ANHARM force laws in the anharmonic experiment; deliberately not duplicated as pendulum-specific sweep APIs in this pass. The exact pendulum driven core and raw samples are available; adapting continuation to unwrapped rotations needs an explicit response convention. |
| Euler/RK2/RK4 comparison from GENMOT | Deliberately provided in motion-generator instead: pendulum keeps automatic Verlet/RK4 to keep its energy/period reference reliable. |
| Live coefficient edits without reset | Deliberately omitted: reproducible reset semantics and quench-work accounting required before mid-run parameter changes. |
| Retained trajectories, numeric sample export, parameter examples | Yes (data): caller-owned serializable histories/complete preset values. No DOS storage format needed. |
| External GMPEND parameter files / ANHARM Interesting Parameters catalog | Exact external values were not in the six supplied files. Independent documented Small/Large/Damped/Driven/Period doubling/Sensitivity/Rotation examples replace them; no claim to clone unseen values. |

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
The `linear` enum is `exact`, `linear` or `cubic`. Cubic uses the correct
local series and is not valid for full rotations. The near-resonance preset uses 3.13 rad/s;
drive-frequency controls use a 1/300 rad/s grid so the exact 2/3 chaos drive is
representable. Instance `period()` computes the libration period from current energy only when
undamped/undriven; it returns Infinity at/above the separatrix and null for driven
or damped runs. rotationPeriod() separately gives the exact conservative full-turn period above
the barrier; it returns Infinity at/below the barrier and null for non-exact,
driven or damped models. Cubic period() is null.

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

## Additional renderer requirements from full coverage

Add Sine series, Over the top and Reverse rotation chips. The comparison close-up
shows sin(theta), theta and theta-theta^3/6 with their matching potentials, not the
incorrect original positive correction. Graphs adds phase selection (1..32),
one-period omega return maps and angular-velocity spectra; phase movies and
retained-run overlays remain opt-in. Keep rotations unwrapped on theta(t), wrapped
only on phase plots. Mark the barrier and label libration versus rotation periods.

## Kit renderer (wave-one implementation)

The quiet apparatus uses the actual rod length and angle, fixed energy-envelope world
bounds, an angle arc and one compact angle/velocity readout. Gravity close-up
magnifies the decomposition. Breakdown draws theta at the pivot and at the bob,
weight vertically downward, the radial projection mg cos(theta) along the outward
rod direction and -mg sin(theta) along the tangent. This radial gravity component
is not string tension. Signed torque and substitutions render in KaTeX; linear
and cubic comparison models name their approximate torque separately.

Graph chips show angle, phase space with unit-labelled axes, energy, nearby-start
separation, conservative period vs amplitude, an exact-event phase-zero Poincaré
section, one-period velocity return map and angular-velocity spectrum. The
period curve computes one point per visible animation frame. Spectra use the
available history only through the scene's current time, a sine-squared window
and explicit frequency in Hz. Empty histories say to collect samples; they do
not invent a spectrum. Phase movies/selection, complex-spectrum controls and
nonlinear response-sweep controls remain future UI work over the available APIs.

## Previous view verification

The owned Node suite passed 62/62. The parent ran the isolated hidden-Edge
harness on the final source: 335/335 browser checks, no browser exceptions,
110 captures at 1280 and 320 pixels, browser context closed. This covered gallery
entry, every preset, a setup edit, play/pause, numerical seek completion, fixed
camera/reset, every close-up and return, Breakdown equations/overlap checks,
every graph, and narrow fitting. Updated scene/close-up/Breakdown/graph captures
were inspected; no installed-build or real-device claim is made.
Evidence: round-156/osc-views/{browser.json,node.tap,verification.json,cleanup.json}.


## Shared polish conventions (current)

The Zoom chip is beside a fixed physical target, with a reserved text band.
Graph descriptors use a five-period time window (bounded by the 60-second
experiment), selected from the current force/potential/drive parameters. Custom
graphs leave titles to the shell. Legends use physics symbols, Poincaré is
accented, canvas minus signs are typeset, and the cubic restoring coefficient is
beta in both models. Node regressions cover descriptors, inactive terms,
energy wording, fixed target anchors and every preset/view's text bounds.

Breakdown uses a larger rod, with the chip by its pivot or fixed rest position. The redundant
along-rod caption is removed. Nearly coincident gravity components are hidden;
tip labels avoid force shafts and have no leader lines that could strike another
caption. Full-circle bounds remain for rotation, driven and approximate laws.
Workflow friction: text rectangles alone missed a caption struck by a rod or
leader. The harness now checks force shafts too, and rendered review remains
necessary for apparatus and label geometry.

Force arrows are drawn over the bob with a dark contrast stroke, using 80 px
for weight in Breakdown and at least 90 px in the gravity close-up. The default
tangential arrow extends at least 8 px outside the bob. The bob-side angle is
omitted at 320 and placed farther into the open wedge at desktop size. Equation
blocks omit inactive torques and end with numerical net torque in N m.
Workflow friction: shaft/text clearance alone did not detect a short force arrow
hidden inside its own bob. A visible-extent regression now checks that too.

## Shared polish verification

Owned Node tests: 70 passed, 0 failed. The guarded isolated browser run passed
337 checks with 114 captures, no browser errors or label overlaps, and unchanged
source bytes before/after. Desktop 1280 and narrow 320 states were inspected.
Evidence: round-156/osc-views/{node.tap,browser.json,verification.json},
round-156/lead/polish-osc3.log; captures in round-156/osc-views/*.png.
Fixture PID 22924 exited and port 8842 is free (cleanup.json); disposable data
is preserved. Installed-app and real-device behavior were not checked.
