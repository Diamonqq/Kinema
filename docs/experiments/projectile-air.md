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
| Arbitrary graph windows/scales/variable choice | omitted | Curated linked position, velocity and energy graphs replace arbitrary graph windows |
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
  Bisection locates ground impact and apex within a substep. Impact stops the projectile in a perfectly inelastic ground capture; no bounce.
  The lost kinetic energy is recorded separately as impactLoss, not air heating.
  `t` always advances exactly dt; `flightTime` stops at impact. Reset is exact.
- Energy ledger: E = m v²/2 + mgy; D' = -F_drag dot u >= 0;
  W_w' = (F_drag+F_lift) dot w; **E + D + impactLoss - W_w = E_initial**.
  Lift is perpendicular to u, not necessarily to ground-frame v.
- `terminalSpeed` is the local **still-air, no-spin drag-only** descent speed;
  it is not the terminal state with wind/spin. `hasTerminal=false` with numeric
  sentinel 0 for vacuum / zero linear coefficient. Renderer must show a dash then.
- `rangeCurve` accepts a list of launch angles. Its default is 5°..90° at 5°;
  a teaching close-up should refine to 1° near the best angle. Every row carries
  `landed`; omit/mark unfinished runs, never treat a capped flight as a range.

## Implemented shared-kit views

`manifest.json` mirrors every model parameter/preset and every view graph/close-up.
All controls use model descriptors, including named enum options. First view is a
quiet side elevation: actual diameter plus a locator halo, air trajectory, dashed
vacuum ghost and one key. Fixed bounds include the entire cached 60 s forecast
and ghost; every shipped preset lands within that horizon. No following camera.
Setup changes and Reset re-center. Forecast is cached across animation frames.

Preset chips: Vacuum parabola, Baseball, Golf ball, Shot put, Ping-pong ball,
Cannonball, Linear drag (labels in the model are authoritative).
Each changes one object or physical lesson; sports properties are illustrative,
not measured predictions. Smooth-sphere drag has no drag crisis; effective golf
Cd does not model dimples.

Close-ups sit on separate rows under their launch, early-flight and apex targets:

| id | view and signed equation |
|---|---|
| angle | Magnified launch triangle, angle from horizontal; v0x=v0 cos(theta), v0y=v0 sin(theta), both symbolic and substituted in m/s |
| air-force | Magnified ball, air-relative velocity u=v-wind, drag opposite u, gravity downward, optional lift; selected drag law plus signed FDx, FDy and mg in N |
| apex | Magnified actual integrated apex, horizontal vx, downward mg; vy=0, ymax in m, vx generally nonzero |

Breakdown adds launch and live velocity components, gravity, drag and optional
lift at their physical origins. Colors remain blue velocity, green vertical
velocity/drag, amber gravity, violet lift. Arrows label their tips. Equations show
v0 cos(theta), v0 sin(theta), vx=v cos(phi), vy=v sin(phi),
max=FDx+FLx and may=-mg+FDy+FLy with live substitutions.

Graphs are behind Graphs and share the scene's live time cursor:

| id | time-series, units |
|---|---|
| motion | x,y in m |
| velocity | vx,vy in m/s |
| energy | E, dissipated work, wind work in J |

At 320 px the scene keeps a 360 px minimum height so the gravity-tip label and
caption bands stay separated even with graphs open. Equation content scrolls
above opaque transport controls. No live physics labels follow the camera.
Range-angle sweeps and terminal speed remain tested headless diagnostics; their
extra parameter-sweep/descent graph UI is deferred, not claimed by this manifest.
The range sweep would require an angle cursor rather than the time cursor.

## Verification and integration limits

`node --experimental-test-isolation=none --test tests/experiments/projectile-air.test.mjs`
tests vacuum range/apex/time, wind+linear closed form, three terminal laws,
quadratic optimum, Reynolds/density/zero-speed behavior, wind/lift energy,
impact frame independence, ghost, finite presets and bad inputs. Each analytic
test states its tolerance. The companion projectile-air-view suite checks exact
manifest parity, fixed preview bounds and literal symbolic/numeric equations.
Rendered evidence is in round-156/proj-views/browser.json and its PNG captures.
Lead owns shared version bump/registration and final merged-build review.

Workflow friction: ordinary `node --test` cannot spawn test workers in this
restricted Windows runtime (EPERM); single-process Node test isolation runs the
same suites. Shared public stage omits ARCHITECTURE/HANDOFF; installed copies
were read for boundaries only. Record these in existing project work_records
at coordination integration, without changing shared files from this lane.

View-lane workflow friction: headless Edge launch is also EPERM in this sandbox.
The coordinator ran the unchanged lane harness against the identity-checked
isolated port-8843 fixture. Browser checks now wait for asynchronous seek, clear
restored panels before opening scenes and toggle graph chips through user clicks.
Text rectangles alone missed two adjacent labels touching at their boundary;
manual inspection of the 320 px Breakdown capture caught it. Keep both checks.

Merged polish: landing sets sample.ended, zero velocity and acceleration, and
adds an explicit inelastic-impact ledger. Shared graphs stop at that sample.
Main framing reserves side margins for arrows; labels clamp inside the canvas.
Chips use launch/apex/early-flight world targets, not a diagonal caption stack.
The complete blue forecast matches its key. Values use three significant figures.
