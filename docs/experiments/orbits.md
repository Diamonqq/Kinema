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

Deferred CUPS coverage: N-body, test particles, rotating frames, Poincaré maps,
continuous thrust, arbitrary orbital-element editing and full system presets.
These are not implied by the two-body frame selector or precession preset.

Integration friction: ordinary Node test workers cannot spawn in this sandbox
(`spawn EPERM`); Node 22's isolation-disabled runner executes the same assertions.
Raw downloads through inherited proxy settings failed; a standard Python urllib
reader reached the public sources. Research copies remain outside the stage in
conversation scratch. No app or shared registration file was changed by this lane.
