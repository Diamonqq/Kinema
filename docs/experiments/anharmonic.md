# Anharmonic oscillator: physics core and renderer plan

Headless physics and tests only; views are a later follow-up. The kit integrator
owns shared UI/registry/version changes. See motion-generator.md for runner friction.

## Original and improvements

Inspected original [ANHARM help](https://github.com/palazzol/cups/blob/master/DOS/CUPS/CUPSCM/ANHARM/ANHARM.HLP),
[ANHPHY source/interfaces](https://github.com/palazzol/cups/blob/master/DOS/CUPS/CUPSCM/ANHARM/ANHPHY.PAS),
and [ANHTUTOR](https://github.com/palazzol/cups/blob/master/DOS/CUPS/CUPSCM/ANHARM/ANHTUTOR.PAS).
The reader truncates each file to 6000 characters; later implementation bodies
were not inspected. No source code, tutorial prose or images were copied.

CUPS had asymmetric and Duffing force laws, harmonic and pendulum comparisons,
exact/approximate two-wall springs, Van der Pol, damping/driving, phase portraits,
energy selection by clicking a plot, Poincaré maps/movies and saved maps, period
and resonance tables, and Fourier analysis interfaces. Its tutorial developed
spring buckling, two minima and symmetry breaking by moving the walls.

The new core offers selectable polynomial coefficients, exact two-wall springs,
Van der Pol, new Morse/Lennard–Jones potentials, connected-well turning points,
period quadrature, exact-cycle Poincaré samples and explicit work/reservoir balance.
FFT/resonance-table UI, map movies, approximate-wall comparison and click-to-set
energy are not implemented here. Do not describe the full CUPS feature set as
already rebuilt. The renderer can use the period API for an amplitude graph.

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
all five force/potential gradients, conservative energy across presets,
well-specific turning roots, separatrix/equilibrium periods, driven linear
amplitude and phase, active reservoir balance, Poincaré timing, and schema/reset.
Every numeric tolerance is stated in the test name. No double pendulum or
asymptotic chaos classification is claimed.
