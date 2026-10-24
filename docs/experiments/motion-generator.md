# Motion generator: physics core and renderer plan

Headless implementation only. No rendered UI, installed build or real-device check
is claimed. The kit author owns registry/version/UI integration.

## Original and new scope

Inspected original [GENMOT help](https://github.com/palazzol/cups/blob/master/DOS/CUPS/CUPSCM/GENMOT/GENMOT.HLP),
[GMGENER](https://github.com/palazzol/cups/blob/master/DOS/CUPS/CUPSCM/GENMOT/GMGENER.PAS),
[GM1DGRAV](https://github.com/palazzol/cups/blob/master/DOS/CUPS/CUPSCM/GENMOT/GM1DGRAV.PAS),
and GMUTIL1/GMUTIL2 interfaces through Panel's reader. Retrieved excerpts are capped
at 6000 characters per file; later implementation sections were not inspected.
No original code or prose is incorporated.

CUPS provided up to three dynamical coordinates, editable initial conditions and
force parameters, configurable graph/numerical windows, trajectory comparisons,
parameter/layout saving, and custom forces by recompiling Pascal. GMGENER had
gravity, linear/quadratic drag, constant/linear/cubic restoring forces, a force
ramp and sinusoidal forcing. GM1DGRAV specialized gravity plus drag.

This core supports 1D and 2D, all those named force terms, softened central
attraction, and a magnetic-like velocity-cross-field force. Coefficients carry
SI units/ranges; no expression strings, parser, eval or Function are used.
Compared with the original workflow, built-in composition needs no compilation;
energy balance and per-force vectors are directly available to teaching views.
Arbitrary 3D/custom compiled forces and CUPS window/layout persistence are not
recreated by this headless pass.

## Equations and numerical choices

State is `[x,vx,y,vy,driveWork,heat]`; positive y points upward. In 1D gravity
acts along negative x and y/vy remain zero. All forces are in newtons:

`m r̈ = −k r − α(x³,y³) − s(sign x,sign y) − mg e_up
        − (b+c|v|)v − m μ r/(r²+ε²)^(3/2)
        + qB(vy,−vx) + (Fx+a t+Fd cos Ωt,Fy)`.

Constant forces are included in U. W counts ramp/periodic-drive work, Q counts
drag dissipation; `E − W + Q = E0`. Central potential is
`−m μ / sqrt(r²+ε²)`, explicitly a softened attraction rather than exact
inverse-square gravity at small r. The magnetic term does no work.

Smooth position-only forces use velocity Verlet. Drag, magnetic velocity forces,
driving and cusp restoring use RK4, with internal steps at most 1 ms and smaller
for stiff parameters. The cusp is not regularized; crossing it has lower accuracy.
All step/reset/sample/invariants/geometry methods follow EXPERIMENTS.md.
`forces()` adds named live vectors. Momentum/angularMomentum are instantaneous;
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
