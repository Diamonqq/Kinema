# Motion generator: physics core and renderer plan

Headless implementation only. No rendered UI, installed build or real-device check
is claimed. The kit author owns registry/version/UI integration.

## Original and new scope

Read the complete local GENMOT.HLP, GMGENER.PAS and GM1DGRAV.PAS copies,
not just the earlier capped web excerpts. No original code or prose is incorporated.
The source inventory is recorded in the worker scratch cups-source-coverage.json.

The core now supports three independent spatial coordinates, all the original
built-in force terms, softened central attraction and a magnetic-like force.
Parameters have declared SI units/ranges. Arbitrary executable expressions are
excluded. Coverage below means headless physics/data; renderer work is pending.

## CUPS coverage

| Original capability/example/plot | Kinema status and evidence |
|---|---|
| Up to three dynamical coordinates | Improved: 1D/2D/3D; spatial preset and constant-acceleration regression. |
| Editable starting positions, velocities, masses and force coefficients | Yes: bounded schema and complete preset values. |
| Free motion and gravity/falling-body specialization | Improved: gravity plus free-fall and spatial examples; analytic trajectories. |
| Linear and quadratic air resistance, terminal speed | Improved: separate drag presets and analytic terminal-speed/trajectory tests. |
| Constant-magnitude sign restoring force | Yes: constant-restoring preset; piecewise analytic cusp trajectory test. |
| Signed linear spring | Yes: restoring and unstable signed coefficients; Hooke and softening examples. |
| Signed cubic restoring force | Yes: polynomial force/potential pair; nonlinear and softening presets. |
| Force increasing linearly with time | Improved: force-ramp preset and analytic cubic-in-time trajectory test. |
| Periodic cosine driving force | Yes: driven-spring preset; work/energy balance tests. |
| Combined enabled force terms | Improved: per-force vector output plus energy/work/heat accounting. |
| User-supplied Pascal force laws and functions | Deliberately omitted: arbitrary executable code is outside the bounded action contract. Named force composition replaces compilation; no eval/Function. |
| Change coefficients during an existing trajectory without restarting | Deliberately omitted: this requires explicit quench-work accounting and reproducible action history. Create/reset defines a fresh, testable experiment. |
| Multiple retained runs for comparison | Yes (data): independent instances and caller-collected samples; overlay drawing awaits the kit. |
| Any variable against any other, including t/x/v/a | Yes (data): all coordinate/velocity/acceleration/time observables; linked plots await the kit. |
| User energy functions and kinetic/potential/total energy plots | Improved for supported forces: K/U/E/W/Q and balance residual. Arbitrary executable readout functions deliberately omitted for the same bounded-code reason. |
| Numerical value readout | Yes (data): sample() exposes observables in SI units. |
| Euler, second-order Runge-Kutta and fourth-order Runge-Kutta | Improved: selectable Euler/RK2/RK4 plus automatic Verlet/RK4; convergence regression demonstrates their different errors. |
| Numerical step independent of display/sample interval | Yes: timeStep controls solver substeps; caller chooses sampling. |
| Save last 500 numerical samples and parameter values | Yes (data): samples and schema/preset values are serializable; caller may retain/export more than 500. File/download UI awaits the kit. |
| Saved parameter/example configurations | Improved: complete named preset values and teaching notes; legacy DOS file format deliberately omitted as interface mechanics. |

## Equations and numerical choices

State is `[x,vx,y,vy,z,vz,driveWork,heat]`; positive y points upward. In 1D gravity
acts along negative x and y/vy/z/vz remain zero. All forces are in newtons:

`m r_ddot = -k r - alpha (x^3,y^3,z^3) - s(sign x,sign y,sign z)
            - mg e_up - (b+c|v|)v - m mu r/(r^2+epsilon^2)^(3/2)
            + qB(vy,-vx,0) + (Fx+a t+Fd cos(Omega t),Fy,Fz)`.

Inactive coordinates and their forces are zero in lower-dimensional modes.

Constant forces are included in U. W counts ramp/periodic-drive work, Q counts
drag dissipation; `E − W + Q = E0`. Central potential is
`−m μ / sqrt(r²+ε²)`, explicitly a softened attraction rather than exact
inverse-square gravity at small r. The magnetic term does no work.

Smooth position-only forces use velocity Verlet. Drag, magnetic velocity forces,
driving and cusp restoring use RK4, with internal steps at most 1 ms and smaller
for stiff parameters. The cusp is not regularized; crossing it has lower accuracy.
Explicit Euler/RK2/RK4 use the chosen timeStep instead; these are teaching methods,
not a promise of stability for every stiff combination. The 3D force law applies
restoring/drag terms componentwise to z, adds Fz, and uses a z-directed magnetic
field, whose z force is zero. All step/reset/sample/invariants/geometry methods follow EXPERIMENTS.md.
`forces()` adds named live vectors. Momentum/angularMomentum and angularMomentumVector are instantaneous;
they are conserved only when the applied force symmetries allow it.

## Exact renderer plan

- Quiet first view: a correctly scaled blue puck, short faint trail, fixed x/y
  basis and one caption band (x, v). 1D is a vertical track for gravity or a
  horizontal track for a spring; physical coordinates remain those above. Frame
  a complete predicted motion envelope; free motion may expand framing smoothly.
- Setup: Dimensions first, then Initial conditions and enabled force coefficients.
  Hide unused y parameters in 1D. An explicit force toggle controls the coefficient;
  never leave a hidden nonzero force. Show softened-core ε beside attraction.
- Preset chips: Hooke’s law, Free fall, Terminal speed, Quadratic drag, Magnetic
  circle, Softened attraction. Notes and complete reset values are in model.presets.
- Graphs: x/y(t), vx/vy(t), x–vx/y–vy phase plots, trajectory, E/K/U and W/Q.
  Shared scene time cursor; graph history belongs to the renderer and clears on reset.
- Close-up targets: spring (`F=−kx−αx³`), drag (`F_d=−(b+c|v|)v`), central core
  (`F=−mμr/(r²+ε²)^(3/2)`), magnetic turn (`F=q v×B`, `F·v=0`). Use fixed bands
  with signed live values; no labels chasing the puck.
- Breakdown: color-coded force arrows, then x/y component sums `ΣFx=m ax`,
  `ΣFy=m ay`; show drag opposite velocity and magnetic force perpendicular to it.
  Pair each arrow with its actual signed coefficient and units, then energy balance.
- Back closes a close-up; narrow layout keeps one graph at a time. Geometry is SI
  and contains no camera/UI assumptions. Do not rotate the math basis silently.

## Checks and integration friction

`tests/experiments/motion-generator.test.mjs` covers constant acceleration, both drag
laws, magnetic radius/handedness, harmonic motion, softened-force conservation,
combined-force work/heat, force/potential consistency, parameter validation and reset.
Each numeric test names its tolerance.

The Windows managed shell denies Node test-runner child spawning (`spawn EPERM`).
Use `node --test --experimental-test-isolation=none` with explicit test filenames here;
these tests have no live data or services. Default isolation remains preferred
where spawning is available. Repo-wide version bump is reserved to the integrator.
Node 22's isolation-none route also refuses directory imports: expand *.test.mjs
to filenames in PowerShell before passing them. String enums match the kit's
select values. A test checks every default/preset against the kit's numeric grids.
PowerShell-to-Python stdin can misencode non-ASCII literals: use apply_patch or
ASCII-only matches when editing formulas/labels. No damaged formula text was kept.

## Additional renderer requirements from full coverage

Setup must expose solver and internal time step only under a numerical-comparison
extra. Label deliberate Euler drift. The quiet default uses automatic integration.
3D needs a fixed x/y/z key and a spatial trajectory view; offer each coordinate
against time and arbitrary observable pairs. Add preset chips: Spatial motion,
Constant restoring, Force ramp, Softening and Driven spring. Keep retained-run
comparison, numerical tables and export behind Graphs rather than crowding entry.
