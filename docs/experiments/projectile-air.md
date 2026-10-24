# Projectile in air — physics and renderer brief

## Original capability research

Read the original [GENMOT help](https://github.com/palazzol/cups/blob/master/DOS/CUPS/CUPSCM/GENMOT/GENMOT.HLP),
[GMGENER](https://github.com/palazzol/cups/blob/master/DOS/CUPS/CUPSCM/GENMOT/GMGENER.PAS)
and GMUTIL1/GMUTIL2, both DOS and SDL copies, plus DOS GM1DGRAV (2026-10-23).
The supplied GENMOT.HLP has no dedicated “Projectile Motion in Air” or “Race
Track” sections. It documents a generic up-to-three-coordinate dynamics engine,
editable initial conditions/force/numerical parameters, configurable graphs,
trajectory overlays, and saved configurations. GMGENER itself is **one-dimensional**:
gravity, linear/quadratic damping, constant/linear/cubic restoring forces, ramp
and periodic drives; kinetic/potential/total energy. GM1DGRAV is specifically
vertical motion under gravity plus linear/quadratic air resistance. GMUTIL1 offers
Euler, RK2 and RK4. These sources do not establish a dedicated 2-D
projectile implementation; do not attribute the new features below to CUPS.
No source code or help prose has been reused.

## CUPS coverage

“Improved” below describes implemented headless physics; views remain the brief
below, not a claim of rendered completion. Full supplied local HLP/GMGENER/GMRACE
copies were read, including generic configuration and graph help.

| Capability | Kinema | Evidence / reason |
|---|---|---|
| Gravity and linear/quadratic air resistance | improved | Full 2-D relative-air velocity; analytic vacuum and linear checks |
| Initial position/velocity, mass and force parameters | yes | Bounded parameter schema, launch angle/speed/release height |
| Kinetic, potential and total energy | improved | Adds dissipated heat and wind-work ledger |
| RK4 and adjustable numerical step | improved / omitted | Internal stability-limited RK4; manual step selection omitted to avoid inaccurate user states |
| Euler/RK2 pedagogical solver comparison | omitted | This experiment teaches projectile mechanics; numerical-method lab belongs in Motion Generator |
| General restoring forces, ramp/periodic drive | omitted | Separate general-force/oscillator experiments, not a projectile force law |
| Continue after changing force parameters | omitted | Deterministic reset on setup change for clean comparisons |
| Multiple retained trajectories | improved / omitted | Analytic vacuum ghost implemented; arbitrary saved overlays deferred to kit |
| Arbitrary graph windows/scales/variable choice | omitted | Curated linked graph design below; no renderer in this pass |
| Save/load parameters, window layout and custom help | omitted | Shared app persistence/UI responsibility; no core file I/O |
| Export last 500 numerical time steps with parameters | omitted | Snapshot API supplies data; export UI/file format deferred to shared kit |
| Wind, spin, altitude-dependent density, Reynolds drag | improved | New independently implemented physics, absent from inspected original force laws |
| Terminal-speed diagnostic and range-angle sweep | improved | Tested headless helpers with stated assumptions and landing status |

## New model

Headless `model.js` exports the required `model` and helpers `flight`,
`rangeCurve`, `terminalVelocity`, `airDensity`, `sphereCd`, `resolve`.
SI throughout; launch angle alone is degrees. Every editable parameter carries
units, bounds, steps, initial value and group. Inputs outside physical bounds
throw; descriptors supply the UI/server step validation.

- Vacuum, linear drag, constant-Cd quadratic drag, their additive combination,
  or Reynolds-dependent smooth
  sphere drag. Sphere correlation combines Stokes, intermediate-Re correction
  and high-Re plateau; no drag-crisis/roughness/compressibility claims.
- Constant density or rho = rho0 exp[-(altitude+y)/H]; constant gravity. Horizontal
  wind is air velocity. Force uses **relative** velocity u = v - w.
- Optional signed backspin: Cl = clamp(1.2 omega radius/|u|, -0.6, 0.6),
  F_lift = rho A Cl |u| (-u_y,u_x)/2. Illustrative, not a calibrated sports-ball
  trajectory predictor; lift vanishes at rest and in vacuum.
- RK4 with <=0.01 s substeps, shortened by both drag and lift relaxation rates.
  Bisection locates ground impact and apex within a substep. Impact retains
  just-before-contact velocity/energy and freezes the trajectory; no bounce.
  `t` always advances exactly dt; `flightTime` stops at impact. Reset is exact.
- Energy ledger: E = m v²/2 + mgy; D' = -F_drag dot u >= 0;
  W_w' = (F_drag+F_lift) dot w; **E + D - W_w = E_initial**.
  Lift is perpendicular to u, not necessarily to ground-frame v.
- `terminalSpeed` is the local **still-air, no-spin drag-only** descent speed;
  it is not the terminal state with wind/spin. `hasTerminal=false` with numeric
  sentinel 0 for vacuum / zero linear coefficient. Renderer must show a dash then.
- `rangeCurve` accepts a list of launch angles. Its default is 5°..90° at 5°;
  a teaching close-up should refine to 1° near the best angle. Every row carries
  `landed`; omit/mark unfinished runs, never treat a capped flight as a range.

## Views to wire to the shared kit

First view: a grounded side view with the real projectile diameter, quiet blue
trajectory, faint vacuum ghost, and fixed bottom key “air / vacuum”. Keep full
trajectory bounds fixed from a cached headless preview, including wind-driven
negative x; do not track/recenter the flying object. Use genuine world scaling,
with a halo hit target for tiny objects instead of inflating their radius. Ground
occupies a small stable band. No force arrows, grids or floating labels initially.
Ghost uses its own analytic ground-impact time and stays at its landing point.

Setup chips (model.preset ids): **Vacuum parabola**, **Baseball**, **Golf ball**,
**Shot put**, **Ping-pong ball**, **Cannonball**, **Linear drag**. Each resets the
experiment, and each model note names the single comparison. Object masses and
Cd values are illustrative rounded presets (ping-pong mass 3 g); golf uses a
constant effective Cd and does not model dimples. Do not label them measured.

Graphs behind Graphs; share scene time cursor:

| id | axes / series | teaches |
|---|---|---|
| motion | t (s): x,y (m), separate velocity pane vx,vy (m/s) | vx is not constant in air |
| energy | t (s): energy,dissipatedWork,windWork,accountedEnergy (J) | air heating vs wind energy |
| range-angle | angle (degrees): range (m), air and vacuum | optimum below 45° for this still-air drag case |
| descent | t (s): -vy, terminalSpeed (m/s) | local terminal speed under stated assumptions |

The angle curve is a separate parameter-sweep graph, not a time-series pretending
to share a time cursor; display current launch angle as its linked cursor.

Close-ups, obvious scene chips; all return with Back:

- `air-force` / “Zoom · air”: magnified projectile, fixed caption bands; arrows
  u, drag and lift, plus small wind inset. Equation **F_D = -b u** or
  **F_D = -(rho Cd A/2)|u|u**, or their sum in combined mode, with current signed
  components and units.
- `apex` / “Zoom · apex”: local trajectory tangent, horizontal vx and zero vy
  at stored apex. **v_y = 0; a_y generally != 0**. Use actual integrated apex;
  do not imply the speed vanishes.
- `angle` / “Zoom · launch”: vx0 = v0 cos(alpha), vy0 = v0 sin(alpha), alpha
  visibly between launch vector and horizontal. **R_vac = v0² sin(2alpha)/g**
  only when release/landing heights match.

Breakdown adds gravity/drag/lift at the projectile, fixed color key and
**m ax = F_Dx + F_Lx; m ay = -mg + F_Dy + F_Ly**, then relative velocity,
rho profile, Re = rho |u| d / eta and energy accounting. Keep the applicable law
only, use actual SI values, and flag the approximate lift/sphere assumptions.
At 320 px, preserve the whole arc; one close-up/graph at a time, with captions
outside the moving world and controls above the composer.

## Verification and integration limits

`node --experimental-test-isolation=none --test tests/experiments/projectile-air.test.mjs`
tests vacuum range/apex/time, wind+linear closed form, three terminal laws,
quadratic optimum, Reynolds/density/zero-speed behavior, wind/lift energy,
impact frame independence, ghost, finite presets and bad inputs. Each analytic
test states its tolerance. This pass has no view.js/manifest and no rendered UI
claim. Lead owns shared version bump/registration when integrating views.

Workflow friction: ordinary `node --test` cannot spawn test workers in this
restricted Windows runtime (EPERM); single-process Node test isolation runs the
same suites. Shared public stage omits ARCHITECTURE/HANDOFF; installed copies
were read for boundaries only. Record these in existing project work_records
at coordination integration, without changing shared files from this lane.
