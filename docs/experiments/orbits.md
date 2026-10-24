# Gravitational orbits — physics core and renderer brief

This pass implements the headless model and analytic tests. No view, manifest,
gallery activation or rendered-screen approval is claimed. Source implementation
is independent of CUPS; original code and prose are not incorporated.

## Original capability research

Read the preserved [ORBITER help](https://github.com/palazzol/cups/blob/master/DOS/CUPS/CUPSCM/ORBITER/ORBITER.HLP),
ORBPHY.PAS, ORBPAR.PAS and ORBMENUS.PAS in the same directory. CUPS supported up to
five massive bodies plus test particles, body replication, arbitrary mass/position/
velocity/G changes, Cartesian and orbital-element entry, mouse placement, thrust,
adaptive error controls, replay and time reversal. Up to six linked windows covered
CM, body-centred, inertial and rotating frames; a third-body Poincaré section was
available. Built-ins included Solar System, Sun–Earth–Moon, shuttle docking,
Sun–Jupiter–comet, Jovian moons, Lagrange points, binary stars and retrograde motion.
Its force routine sums pairwise Newtonian attraction; perturbations there are
other gravitating bodies, rather than the toy inverse-cube force added here.

## CUPS coverage

Coverage checked by reading the complete local ORBITER.HLP and ORBPHY.PAS
(1292 source lines), including initialization, frame transforms, elements, energy
and section routines. Earlier ORBPAR/ORBMENUS research supplies the example list.
**Yes/improved below means tested headless physics/data, not a finished view.**
All rendering and controls remain for the separately assigned kit follow-up.

| Original physics, example or plot | Kinema status and evidence / omission reason |
|---|---|
| Pairwise gravity, up to five massive bodies, additional non-backreacting test bodies | **Improved:** `createNBody`, 5 massive / 32 total; custom 3–5 body setup. Equilateral three-body and regular five-body solutions, conservation and massless backreaction tests. |
| Create/add/reposition bodies; choose their mass, Cartesian position and speed/direction | **Yes:** custom scalar body 3–5 controls; `createNBody({bodies})` for arbitrary bounded initial states. Polar data can be converted to Cartesian. Live dragging/append controls are deliberately omitted in this core pass because the contract is reset-based and views are not assigned yet. |
| Change G and integration step | **Yes:** gravityScale, maxStep, bounded substeps. |
| User absolute/relative RKF error tolerances | **Deliberately omitted:** there is no RKF error estimator here; exposing tolerance knobs without enforcing them would be false. Step refinement and explicit analytic/conservation tolerances replace that control. |
| Circular velocities in either direction about a selected centre | **Yes:** launch presets and `stateFromElements({e:0,clockwise},primary)`. Multi-body results are labelled osculating. |
| Elements as inputs: a, e, initial true anomaly, apsidal orientation, clockwise/counterclockwise | **Yes:** tested `stateFromElements`; Cartesian descriptors remain the model's bounded edit interface. Parabolic *a* entry deliberately omitted because a is undefined; exact escape launch is available instead. |
| Replicate nearby trajectories, varying x/y or vx/vy; start at initial/current state | **Yes:** `replicateBodies` takes any captured inertial state and dx/dy/dvx/dvy. Probes have mass zero. Setup exposes initial x replicas; current-state continuation is a helper operation, not an implemented UI control. |
| Forward/backward physics and original/modified reset | **Improved:** physical timeDirection, deterministic reset per created state, tested forward/reverse retracing; transport time remains monotonically increasing. |
| Continuous thrust along motion and perpendicular, adjustable strength, stop burn | **Improved:** velocity-aligned or inertial acceleration on selected body; burnStart/burnDuration (0 = continuous). RK4 integrates velocity-dependent thrust and its work/impulse/torque; event boundaries enforce exact burn start/stop. Live keyboard changes deliberately omitted from the headless interface; a captured state can initialize a changed burn without inventing history. |
| CM, body 1, body 2, body 3 and inertial/universe trajectory views; CM marker | **Yes:** simultaneous frames and selected-frame CM geometry; inertial drift/boost controls. No rendered panes yet. |
| Two co-rotating views, independent origins/scales, magnified detail | **Yes:** rotating coordinates include the correct −ω×r velocity term. **Deliberately omitted:** multiple renderer origins/scales are view concerns and have not been built in this pass. |
| Poincaré vx vs x at a selected rotating-plane crossing | **Improved:** bounded, interpolated third-body upward y=0 crossings; geometry.poincare retains up to 2048. Arbitrary section coordinate/body selection deliberately omitted until an authored graph needs it; no claim of a generic chaos classifier. |
| Osculating e, semimajor axis, peri/apoapsis, period and orientation display | **Yes:** perBody elements, angle/anomaly, clear zero/unavailable sentinels. No fitted N-body period presented as a true period. |
| Total and selected-body energy, angular momentum diagnostics | **Improved:** real total energy/P/L, per-body energy and massless *specific* energy instead of assigning a fictitious test mass; thruster work and impulses account for nonconservation. |
| Tracks, discrete time marks, replay at physical speed, line of sight | **Yes:** snapshots and deterministic step/reset provide data; retrograde line-of-sight angle/rate are explicit. **Deliberately omitted:** recorded-track caching and display/replay styling belong to the unbuilt renderer. |
| Save/read a whole system and current body states | **Yes:** plain SI body arrays can be serialized and passed to createNBody, including captured current state. **Deliberately omitted:** CUPS ASCII compatibility, filesystem dialogs and clock/history persistence; a pure physics module performs no file I/O. |
| Sun–Earth–Moon (CM/Sun/Earth/rotating plots) | **Yes:** `sun-earth-moon` analogue with eccentric planet/moon and all frame data. |
| Solar System, inner/outer planets through Pluto, eccentric orbits | **Yes:** `solar-system` analogue with five gravitating masses; Mercury/Venus/Earth/Mars/Pluto as probes. All start at apocentre; these are not present-day ephemerides. |
| Earth/station/shuttle docking with thrust and relative frame | **Yes:** `docking` has two circular probes at distinct phases plus selectable body thrust. Docking/collision scoring deliberately omitted: no finite spacecraft/planet surfaces are modelled. |
| Sun/Jupiter/comet and replicated sensitivity, Poincaré view | **Yes:** `jupiter-comet`, replication, rotating section data. **Deliberately omitted:** reproducing CUPS's exact third-orbit encounter timing; the independent analogue uses its own initial state. |
| Sun/Jupiter and its moons, four frame comparisons | **Yes:** `jupiter-moons`, four moon probes with distinct radii/phases; all linked frame arrays. |
| Lagrange comparison at 60°, 90°, 180°, mass variation and replicas | **Improved:** `lagrange` has those three probes; L4 and Jacobi invariance tested. 90°/180° probes are comparisons, not falsely labelled exact Lagrange equilibria. Custom masses are supplied through createNBody; built-in illustrative masses stay fixed. |
| Equal-mass binary stars plus comet; drifting inertial frame | **Yes:** `binary-comet` plus boostX/boostY. |
| Earth/Jupiter apparent retrograde motion and sight line | **Improved:** `retrograde` supplies actual angle and signed angular rate; tested sign reversal. |
| Exact CUPS numerical preset constants / real-scale reproduction | **Deliberately omitted:** independently authored compact SI analogues make motion inspectable in seconds. They preserve the experimental setup, not exact astronomical ratios, CUPS encounter histories or an ephemeris claim. Full real-scale body arrays are accepted by the helper. |

Numerical evidence: `tests/experiments/orbits-coverage.test.mjs`; the earlier
two-body accuracy ladder remains in `orbits.test.mjs`. No DOS-only hotkey,
printer, colour/menu or memory-management control is counted as physics coverage.

## What is implemented and improved

- True finite-mass two-body reduction, with both bodies moving around their CM.
  `G=6.67430e-11 m³ kg⁻¹ s⁻²`; all other numbers are SI. The compact default uses
  pedagogical point masses, not a scaled depiction of actual stars or asteroids.
- Fixed-substep velocity Verlet for resolved non-capture orbits. Mesh is chosen
  from the *perturbed* periapsis timescale. Only trajectories predicted to reach
  the singularity guard refine their mesh locally; these are not presented as
  long-term symplectic solutions. Each successful `step(dt)` advances exactly dt.
- Geometry returns CM and primary-frame positions/velocities, relative state,
  force, CM marker and 160 effective-potential samples with energy and turning points.
  Energy/angular-momentum diagnostics always describe the CM system, regardless
  of the selected drawing frame; a primary-centred view is an accelerating frame.
- Signed swept area from actual integrated position wedges; eccentricity vector,
  semimajor axis, Kepler period, apsides, escape speed and conservation diagnostics.
- `F_rel = -μ(1/r² + α/r³) r_hat`, with μ=G(m1+m2). α is a length; this is a
  configurable conservative toy perturbation, explicitly **not** relativistic gravity.
  `U = -m_red μ/r - m_red μ α/(2r²)`, `m_red=m1 m2/(m1+m2)`.
- Preset chips: Circular; Equal areas; Binary stars; Hohmann first burn; Just
  escape; Precessing ellipse. Each supplies a complete reset configuration.
  Transfer launch uses `v=sqrt(μ(2/r0-2/(r0+r2)))`; it applies only the first burn.
  At α≠0 that Newtonian transfer prescription no longer reaches the specified r2.
  Circular and escape launch speeds include α; manual vx0/vy0 apply only to Custom.

## Exact view plan for the shared kit follow-up

First view: a quiet planar orbit, blue companion, pale primary, fixed CM cross,
faint recent trail and a fixed caption key “m₁ · m₂ · CM”. No vector forest or
equation cards until Breakdown. Primary/CM frame lives in Setup. Point markers
are symbolic; the separation and barycentric lever arms remain in exact proportion.
Show a small “Zoom · closest approach” chip near the periapsis and “Zoom · swept
area” beside the track. Use the kit's only transport and normal conversation.

Frame the union of the integrated trajectory over a declared finite replay window
before playback. For bound Newtonian motion, the apoapsis gives a guaranteed bound;
for escape and perturbed trajectories, precompute that actual window using a
separate instance. Keep camera bounds fixed until Reset/parameter change. Escape
is never cropped by a perpetually chasing camera; reaching the window end pauses.

Close-ups (stable ids for the later manifest):

| id | View and live equation |
|---|---|
| `periapsis` | Enlarged closest approach with radial and tangent arrows. `v²=μ(2/r−1/a)` at α=0; show actual force and energy instead at α≠0. |
| `area` | Two equal-duration sectors on the same trajectory, generated from retained positions rather than circles. `ΔA/Δt=L/(2m_red)` with signed values. |
| `barycentre` | Both bodies and stationary CM; aligned distance brackets. `m₁r₁=m₂r₂`, `r₁+r₂=r`. |
| `potential` | `U_eff(r)=L²/(2m_red r²)−Gm₁m₂/r−Gm₁m₂α/(2r²)`. Current E line, radius dot, roots at E=U_eff, radial KE band. |

Graphs, optional and linked to the same replay time:

- `radius`: r(t), metres, current cursor; use the actual trace, never an ellipse fit.
- `energy`: K(t), U(t), E(t), joules. Display the independently tested error envelope.
- `area`: A(t), m²; slope L/(2m_red), equal-time interval markers.
- `phase`: radial phase portrait (r, dr/dt) using `(x vx+y vy)/r` from geometry.
- `potential`: the radial U_eff curve above is a parameter plot, **not a time series**;
  render in the authored close-up if the shared graph kit only supports time series.

Breakdown adds one layer at a time: r_hat and inward force; tangent v; then radial
and tangential velocity components. Fixed caption band gives `F=−Gm₁m₂/r² r_hat`
(plus the α term when enabled), `m_red r_ddot=−dU_eff/dr`,
`e=|v×h/μ−r_hat|`, `a=−μ/(2ε_K)`, `T=2πsqrt(a³/μ)` for Kepler motion only.
At α≠0 call a,e,T *osculating Kepler values*, never an actual measured period.
At zero/positive Kepler energy, period 0 means unavailable, not a zero-second orbit;
semimajorAxis 0 denotes the parabolic limit. `bound` uses actual total potential.
Unbound apoapsis 0 means no outer turning point. Hide unavailable values cleanly.

## Verification and limits

`node --test --experimental-test-isolation=none tests/experiments/orbits.test.mjs`
checks measured Kepler periods across three radii (2e-5 relative), initial elements
(1e-11), 50 eccentric orbits (energy envelope <3e-6, angular momentum <2e-12),
equal-area wedges (2e-10), frame transforms (1e-12 m), escape, Hohmann arrival
(3e-5 m), and apsidal advance against Binet's exact result (0.002 rad).

Inputs reject unknown keys, nonfinite/out-of-range numbers and unknown enums.
Server/UI should enforce descriptor steps; headless create permits continuous
in-range numeric values for analytic tests. dt is 0..60 s, with a 2-million-substep
budget. Very stiff/extreme launches require shorter caller intervals. At separation
<0.02 m the physical state freezes with `status='close-encounter'`; transport time
continues, so the renderer must pause and explain the guard rather than draw a
completed collision/merger. Reset clears it. No masses merge or disappear.

## Multi-body integration details and renderer additions

`system='two-body'` preserves the original high-accuracy reduction unless an
N-body-only feature is selected. Other systems use `nbody.js`, retaining the same
create → t/step/reset/sample/invariants/geometry instance contract. Five massive
bodies and 32 total are bounded; test masses never exert force. Massive bodies
exchange forces symmetrically; finite-body energy counts each pair once.
Undriven integration uses kick–drift–kick with initial periapsis-based mesh limits
and additional local encounter refinement. It is symplectic on fixed meshes;
do not claim that encounter-dependent stepping is globally symplectic. Driven
motion uses RK4, integrating work, force impulse and torque impulse alongside
the state. Massive-system E−work, P−impulse and L−angularImpulse are diagnostics.

Scene selectors must hide inactive custom-body/thrust/probe controls rather than
show every descriptor at once. Add optional graph `poincare` (rotating x,vx),
close-up `rotating` (r*=R(−θ)(r−R_CM), v*=R(−θ)(v−V_CM−ω×r)),
and graph `sightline` (apparent angle and rate). Rotating velocities are genuine
derivatives, not merely rotated inertial velocities. geometry.relative/force/CM
are in the selected drawing frame; relativeInertial/forceInertial and
inertialCentreOfMass are explicitly separate. Frame arrays retain all views.
Sections are interpolated crossing data, not samples falsely forced onto a graph.

In N-body mode the displayed a/e/period/escapeSpeed/bound concern the instantaneous
body-1/body-2 *Kepler pair*, not membership/escape from the whole system. The radial
effectivePotential is explicitly unavailable; retain total energy and per-body
osculating diagnostics instead. Only applicable restricted circular systems expose
Jacobi as conserved. `jacobiApplicable` is false for driven, noncircular or fully
interacting systems. `areaLawApplicable` gates any claim of constant area rate.
Do not sum geometry.energyByBody.energy: each body's potential contains the full
shared pair interaction; sum kinetic + half potential to recover system E.

N-body singularity guard is 1e-5 m, separate from the legacy two-body guard
0.02 m. It freezes the last finite physical state and its accounting, with explicit
status; transport time still advances. PhysicalTime is separate and reverses
when requested. No collision/merger or claimed chaos diagnosis is synthesized.

Additional tests cover five periods of the equilateral three-body solution
(0.0004 m), five massive bodies (energy 1e-5, L 3e-12 relative), no massless
backreaction (1e-12 m), L4/Jacobi (3e-6), burn/work/impulse/torque and normal
steering (1e-8), element round trips (1e-10), reversing (2e-9), all eight examples,
Poincaré events, retrograde reversal, Galilean boosts and body-energy accounting.

Integration friction: ordinary Node test workers cannot spawn in this sandbox
(`spawn EPERM`); Node 22's isolation-disabled runner executes the same assertions.
Raw downloads through inherited proxy settings failed; a standard Python urllib
reader reached the public sources. Research copies remain outside the stage in
conversation scratch. No app or shared registration file was changed by this lane.
