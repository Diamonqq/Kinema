# Anharmonic oscillator: physics core and renderer plan

Physics core and kit-based canvas view. The kit integrator
owns shared UI/registry/version changes. See motion-generator.md for runner friction.

## Original and improvements

Read the complete local ANHARM.HLP and ANHPHY.PAS copies (including all physics,
FFT, resonance, parameter-search and period-table routines), alongside GENMOT
and GMPEND. Earlier capped excerpts are superseded. No code or prose is copied.
Coverage statuses below describe headless physics/data; graph rendering is pending.

## CUPS coverage

| Original capability/example/plot | Kinema status and evidence |
|---|---|
| Asymmetric quadratic/cubic/quartic potential and editable coefficients | Improved: signed bounded polynomial coefficients, Asymmetric example and DC-offset spectrum test. |
| Duffing signed cubic restoring term, hardening and softening | Improved: both signs supported; Hardening/Softening/Driven Duffing/Hysteresis examples. |
| Simple harmonic reference | Yes: Harmonic example and analytic trajectories/periods/driven response tests. |
| Two exact wall springs, variable separation/rest length/stiffness | Improved: exact geometric energy/force and Buckling springs example. |
| Quartic approximation to wall springs | Improved: walls-series selector and wallApproximation() exact/series comparison; coefficient and sixth-order remainder tests. |
| Pendulum exact and approximate sine | Routed to pendulum experiment: exact/linear/cubic comparisons, corrected negative cubic sine correction, exact libration/rotation periods. No duplicate pendulum model here. |
| Van der Pol self-excitation, damping, drive and amplitude limit scale | Improved: active reservoir separate from ordinary damping; energy transfer and Self-sustained example. |
| Ordinary damping and periodic drive with phase | Yes: all appropriate force laws; explicit work/heat balance and signed reservoir transfer. |
| Pick energy or x/v starting point; either direction or either well | Improved: energyState(E,x,direction) returns a validated initial-state patch; connected-well roots tested. |
| Potential with horizontal energy line/current point | Yes (data): potential(), sample energies, turningPoints(); graph pending. |
| Buckling, symmetry breaking, two minima and critical wall spacing tutorial | Improved: equilibria(), Buckling/At the threshold/Both wells examples, both-well and stability tests. |
| Motion below/equal/above barrier, trapped-well versus crossing motion | Improved: connected allowed interval, exact saddle Infinity detection and Both wells example. |
| Displacement/time and velocity/time plots; linked phase portrait | Yes (data): shared t/x/v observables; renderer pending. |
| Energy diagram selection / linked familiar x(t) and phase-space demonstration | Yes (data): energyState and timestamped samples; interaction/rendering pending. |
| Multiple saved maps / two-map comparison | Yes (data): independent instances plus serializable section points; comparison drawing pending. |
| Poincare maps at up to 32 drive phases | Improved: exact event times, phaseCount and sections() frames; tested phase timestamps. |
| Poincare phase movies, transient trimming and marked phase-plot samples | Yes (data): phase-indexed frames and timestamps; caller filters transients and animates. |
| Velocity return v_n versus v_(n-1), phase movies | Yes (data): returnMap(phase); tested adjacent-cycle pairs. |
| Conservative period versus energy; up to multiple coefficient curves | Improved: periodCurve / periodTable (up to 8 parameter sets and 64 energies); independent quadrature/analytic checks. |
| Period dependence on wall spacing, stiffness, cubic/asymmetric coefficients | Yes: parameterSets vary these coefficients; equilibria choose an allowed well rather than blindly using an inaccessible x0. |
| Pendulum period versus energy and g/L | Routed to pendulum exactPeriod/period/rotationPeriod; explicit exact elliptic-integral tests. |
| Van der Pol period versus active damping/limit scale | Yes: periodTable selects active axis and measures post-transient periods/spread; weak-active analytic-limit test. |
| Resonance amplitude versus drive frequency, multiple damping curves | Improved: resonanceSweep per parameter set; fitted fundamental amplitude/phase and peak amplitude, with convergence flag; three-frequency analytic test. |
| Up/down frequency continuation and hysteresis | Improved: integer-cycle state continuation; Hysteresis example and settled up/down branch separation regression. |
| Unstable middle resonance branch (rough line or basin-boundary search) | Deliberately omitted: a guessed line is misleading; rigorous unstable periodic-orbit continuation needs a separate shooting/Floquet solver. Never present the stable sweep as the missing branch. |
| Fourier transform of x; omega for rotating pendulum | Improved: frequencyAnalysis defaults x here, omega in pendulum. |
| Spectrum magnitude/phase or real/imaginary components | Yes: all four plus calibrated one-sided amplitude; DC/amplitude/phase/complex regressions. |
| Flat, sine, sine-squared and triangular windows | Yes: four windows; leakage and normalization tests. |
| Variable sample count, power-of-two padded analysis | Improved: 2..4096 samples, radix-2 zero padding, explicit sample interval and optional mean removal. |
| Sine/square/triangle test signals and phase shifts | Yes: testSignal(); fundamental/odd-harmonic ratio tests. |
| Parameter-space exploration with 30-point post-transient strobe sets | Improved: parameterSearch bounded to 16 patches, configurable transients and 1..64 cycles; 30-point regression. |
| Interesting Parameters menu's external numerical preset catalog | Deliberately not claimed: the actual external parameter files are absent from these six sources. Independent complete-value teaching presets cover the available force laws and phenomena. |

The new Morse and Lennard-Jones potentials additionally teach dissociation and
repulsive/attractive competition. Double pendulum is outside this experiment.

## Equations and numerics

`m ẍ=−U′(x)−b ẋ+Fd cosΩt` (all coefficients have declared SI units).

- Polynomial: `U=kx²/2+a x³/3+βx⁴/4`; user coefficients are bounded numeric inputs.
  β>0 hardens; k<0 and β>0 form two wells; negative β can allow escape.
- Morse: `U=D(1−exp(−aM(x−re)))²`. Zero at equilibrium, dissociation at E=D.
- Lennard–Jones: `U=4ε[(σ/x)^12−(σ/x)^6]`, separation x>0. Never silently
  soften or clamp its repulsive core; invalid or unresolved trajectories throw.
- Two walls: `U=k(sqrt(x²+d²)−ℓ0)²`. This contains the energy of two identical
  springs, each stiffness k. Force `−2kx(1−ℓ0/sqrt(x²+d²))`.
- Van der Pol: harmonic U plus force `μ(A²−x²)v`; Q is signed reservoir
  transfer, which may be negative when the reservoir feeds the oscillator.

Conservative smooth polynomial/wall systems use velocity Verlet. Driven/damped
systems use RK4; steep Morse/LJ use step-doubled RK4 with normalized local error
<1e-10. Internal step <=1 ms, smaller for stiffness. Escapes can leave the finite
numerical domain; errors leave the last valid frame intact instead of making NaNs.

`potential(x)`, `restoringForce(x)`, `turningPoints(E,anchor)`, `periodAtEnergy(E,anchor)`
and `period()` supplement the standard contract. Turning points are the nearest
boundaries of the energy-allowed interval containing anchor, not the outer roots
of every well. A missing boundary is null. Period is
`sqrt(2m) ∫[x−,x+] dx/sqrt(E−U(x))`, using x=mid+halfWidth sin u and 4096 midpoint
samples. Interior saddle equality is detected so separatrix periods are Infinity.
Unbound motion has infinite period; driven/damped/active motion returns null.
Finite turning-point search/quad resolution is not certified for arbitrary
pathological coefficients or vanishingly small distances from a separatrix.

K=`mv²/2`, E=K+U, `Ẇ=Fd cosΩt v`, `Q̇=(b−μ(A²−x²))v²` in Van der Pol
(μ=0 otherwise). Balance is `E−W+Q=E0`. `section()` gives x/v at exact drive
cycles (up to 4096 points), and is empty without a drive. Momentum is instantaneous.

## Exact renderer plan

- Quiet first view: spring/block on a horizontal track for polynomial/Duffing;
  two visibly stretched/compressed springs between anchors for walls;
  two spheres at actual separation for molecular potentials. Small key (x, v),
  centered whole-motion framing. Do not draw a molecular pair for Duffing.
- Setup: potential selector; show only applicable coefficients with units;
  initial position/velocity and optional drive/damping. Van der Pol labels active
  reservoir separately from ordinary damping. Keep hidden values inactive by law.
- Preset chips: Harmonic, Hardening, Asymmetric, Double well, Molecular bond,
  Attraction & repulsion, Buckling springs, Driven Duffing, Self-sustained.
- Graphs: potential with current E line, K height and current x; mark both
  turning points only when present. Then x(t), phase x–v, E/K/U and W/Q.
  Poincaré enabled only when driven. Period-vs-amplitude/energy uses independent
  conservative instances and the period API; label null/unbound honestly.
- Close-up spring/block: `F=−kx−a x²−βx³`, break each contribution into signed
  live arrows; show polynomial curve and its local slope `F=−dU/dx`.
- Close-up on molecular gap: Morse exponential or LJ repulsion/attraction terms
  separately; show r=x in meters and equilibrium location, no arbitrary stretching.
- Close-up on wall springs: `ℓ=sqrt(x²+d²)`, `T=k(ℓ−ℓ0)` and `Fx=−2T x/ℓ`;
  resolve each spring's tension with the angle drawn at the mass. At x=0 the
  horizontal components cancel, including compressed configurations.
- Double-well Breakdown: minima vs barrier; `E<Ubarrier` traps one well,
  `E=Ubarrier` approaches the saddle, `E>Ubarrier` permits crossing. Highlight the
  connected allowed interval, not both wells when the particle cannot cross.
- Duffing/Van der Pol Breakdown: drive/reservoir arrows and energy accounting,
  with energy gain/loss colors distinct. Quiet default; all extras opt-in.
- Graph cursor and body always share t. At 320px show one graph or close-up;
  Back restores apparatus with no nested scrolling/toolbars.

## Verification

Tests cover harmonic motion, amplitude-dependent quadrature vs measured periods,
pure-quartic inverse-amplitude scaling, analytic Morse period/dissociation,
all six force/potential gradients (wall series covered in the coverage suite), conservative energy across presets,
well-specific turning roots, separatrix/equilibrium periods, driven linear
amplitude and phase, active reservoir balance, Poincaré timing, and schema/reset.
Every numeric tolerance is stated in the test name. No double pendulum or
asymptotic chaos classification is claimed.

## Analysis APIs and renderer additions

All analysis is explicitly requested, synchronous and bounded; create/step/sample
do not launch background work. Exported resonanceSweep(values, frequencies,
options) accepts 1..64 frequencies and at most 256 settling/64 measurement cycles.
Continuation carries state at an integer drive cycle. periodOneSettled compares
last-cycle state/amplitude with a 0.1% threshold; it is a finite observation,
not proof of an asymptotic attractor. Display unsettled/period-multiple/chaotic
responses honestly, without joining them into a supposedly stable curve.
parameterSearch supports 1..16 patches, up to 256 transient cycles and 64 recorded
cycles. periodTable accepts 1..8 parameter sets and 1..64 energies; for Van der Pol
its horizontal axis is active coefficient, not conservative energy, and it reports
measured period, spread and cycle count. Frequency analysis accepts 2..4096 finite
uniformly spaced samples, zero pads to a power of two and reports frequency in Hz.
Complex coefficients use negative-exponent Fourier convention, normalized by window
sum; amplitude doubles positive bins except DC/Nyquist. Mean removal is explicit.

Add Softening, Wall series, Both wells, At the threshold and Hysteresis chips.
Graphs adds energy/phase launch, exact-vs-series wall comparison, phase-frame
movies, return maps, period tables, resonance up/down overlays and spectra.
Each is opt-in; first view remains the quiet apparatus. Wall close-up compares
U_exact=k(sqrt(x^2+d^2)-l0)^2 with its quartic expansion; show the approximation
breaking down at large x/d. Hysteresis shows A(Omega) with up/down arrows and
unsettled points visibly marked. Spectra show |X(f)|/arg(X) or Re/Im, window and
sampling rate; use omega for rotating pendulum and explain why wrapping theta
would inject artificial jumps. Time cursor and phase marks link back to motion.

Full local source availability removes the earlier 6000-character reader limit.
Future coverage passes should retain a byte/hash inventory and read complete
source chunks before deciding a capability is absent. No original bodies are
included in this repository.

## Kit renderer (wave-one implementation)

The first view pairs U(x), the actual energy line, position marker and connected
turning points with the moving apparatus. It uses springs with real wall spacing
for wall laws, a bonded pair for molecular laws and a track/spring for polynomial
laws. The restoring-force close-up magnifies that geometry and shows -dU/dx with
live signed values; wall-series equations use the series force rather than
misrepresenting it as exact spring geometry. Breakdown includes driving, ordinary
damping and the separately named active Van der Pol reservoir.

Graph chips expose displacement, unit-labelled phase space, energy, work/reservoir
transfer, conservative period vs energy, exact-event phase-zero Poincare points,
velocity return and displacement spectrum. Period quadrature is incremental,
one energy per visible frame. Time-dependent graphs share the shell cursor;
strobe and spectral data stop at current scene time. The molecular repulsive
curve is clipped at the plot boundary, not softened in the physics model.

The earlier CUPS coverage table describes the complete headless APIs. This view
does not yet expose resonance/parameter-scan controls, phase movies, arbitrary
strobe phase selection, complex-spectrum controls or table exports. They remain
explicit UI limits, not missing core physics or claimed rendered features.

## Delivered view verification

The owned Node suite passed 56/56. The parent ran the isolated hidden-Edge
harness on the final source: 327/327 browser checks, no browser exceptions,
110 captures at 1280 and 320 pixels, browser context closed. This covered gallery
entry, every preset, a setup edit, play/pause, numerical seek completion, fixed
camera/reset, every close-up and return, Breakdown equations/overlap checks,
every graph, and narrow fitting. Updated scene/close-up/Breakdown/graph captures
were inspected; no installed-build or real-device claim is made.
Evidence: round-156/osc-views/{browser.json,node.tap,verification.json,cleanup.json}.
