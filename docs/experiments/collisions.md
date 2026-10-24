# Two-body collisions — physics core and renderer brief

This pass supplies headless physics and tests. Views/manifests are for the shared
kit follow-up; no browser or real-device verification has happened yet. CUPS was
read for capability research; neither source code nor help prose was copied.

## What CUPS had

Read [COLISION.HLP](https://github.com/palazzol/cups/blob/master/DOS/CUPS/CUPSCM/COLISION/COLISION.HLP),
COLPHY.PAS and COLMENUS.PAS beside it. Original interactions: Coulomb, screened
Coulomb, finite-core/truncated Coulomb, arbitrary force exponent, hard spheres,
spring/soft contact, Yukawa, Woods–Saxon and an unimplemented user-code hook.
Coulomb could be combined with another interaction. Lab and CM trajectories and
momentum-vector windows could appear separately or together. Parameter sweeps
covered impact parameter, energy, mass ratio, strength, range and steepness.
Differential cross sections could be graphed, overlaid (up to ten), logged and
saved/restored. Mouse launch, effective potential, replay-style paths and zoom
supported exploration. The actual finite-charge source uses linear restoring
force inside R0, despite an inconsistent simplified help description.

## Implemented core and improvements

Two finite masses, SI units, exact separation/velocity reconstruction in lab and
CM frames. Initially body 1 is (-distance,b), body 2 (0,0); their velocities are
(speed,0) and (targetSpeed,0). `b` is the **initial geometric** impact offset, not
an asserted asymptotic impact parameter for a finite-start long-range encounter.
CM translates freely. Restitution applies to Hard spheres only; no friction/spin.

Hard spheres use an exact quadratic time-of-contact, normal impulse
`J=−(1+e)m_red u_n` and free flight for the remaining time. This avoids tunnelling
and does not assume that either body's y velocity remains zero after impact.
Tangential relative velocity stays unchanged; deformation energy records
`Q=(1−e²)m_red u_n²/2`. e=0 stops normal separation, without merging bodies.

Smooth interactions use velocity Verlet with close-encounter refinement. Every
displayed force is analytically `−dU/dr`, verified by finite differences:

| choice | Potential U(r) and force convention |
|---|---|
| `coulomb` | `KR0/r`; positive K repels, negative K attracts. |
| `shielded`, `yukawa` | `KR0 exp(−r/R0)/r`; same mathematical form, distinct physical labels/presets. |
| `truncated` | Above R0: `KR0/r`; below R0: `K(3−r²/R0²)/2`. U and F continuous. |
| `power` | `−K(r/R0)^(n+1)/(n+1)`; at n=−1 use `−K ln(r/R0)`. Force `K/R0 (r/R0)^n`. |
| `soft` | `k max(0,R−r)²/2`; outward spring force, finite compression. |
| `woods-saxon` | `K/(1+exp((r−R0)/a))`; K<0 gives a finite attractive well. |

K always has units J, R/R0/a metres, k N/m. Inverse-square coupling is KR0 in
J m. Nuclear-force presets are educational classical central potentials; they do
not describe quantum scattering or infer actual nuclear measurements.

`sample` exposes separate laboratory velocity components, CM speeds, relative
deflection, K/U/E/Q and total momentum/L. `invariants.accountedEnergy=E+Q` checks
inelastic energy accounting. Geometry supplies both frames, relative state, force
and contact normal/impulse/time. `interactionAt(completeParams,r)` exports U,F.
K and E remain laboratory energies when the drawing frame changes; for CM energy
bars subtract `M V_CM²/2`, or keep the bars explicitly labelled Laboratory.
`rutherfordAngle` is the analytic CM angle at asymptotic incident speed and b;
tests separately integrate actual trajectories. `scatteringCurve` numerically
runs independent instances and marks each point complete/unfinished explicitly.

Preset chips: Swap velocities; Glancing collision; Heavy target; Energy into
deformation; Rutherford; Screening; Spring contact; Short-range attraction;
Finite-depth well. Each gives one comparison and resets all parameters.

## Renderer plan — first view stays quiet

First view: two equal-radius disks (R/2 each), blue projectile and pale target,
their actual trajectories, a fixed small legend and a faint launch-offset bracket
b. Avoid momentum arrows, moving text and potential graphs until requested.
Lab/CM is a Setup selector; choose a fixed frame bound from the actual precomputed
finite replay segment, with no camera chasing. Mass differences appear as m₁/m₂
in the fixed legend, rather than inventing a density/radius relationship. For
smooth central forces render point markers with an unobtrusive interaction-range
ring; contact radii only have physical meaning in hard/soft modes.

Obvious scene targets: “Zoom · contact” on the collision location for sphere
modes; “Zoom · closest approach” for force modes; “Zoom · momentum” beside CM.
At 320 px the stage and single compact caption stay visible above the composer;
Setup, Graphs and Breakdown use the existing kit drawers, with no second toolbar.

| close-up id | Exact view/equation |
|---|---|
| `contact` | Enlarged disks, common normal and tangent; `u'_n=−e u_n`, `u'_t=u_t`, `J=−(1+e)m_red u_n`. For soft mode show `F=k(R−r)` and compression. |
| `momentum` | Before/after vector triangles, consistent scale; `p₁+p₂=P`, `v_i*=v_i−V_CM`. Switch frame without restarting physics. |
| `potential` | U(r), `U_eff=U+L²/(2m_red r²)`, initial relative energy line and current r; `m_red r_dot²/2=E_rel−U_eff`. For hard spheres draw a wall at R, never a finite artificial potential. |

Optional linked graphs: `motion` shows separation vs time (m); `energy` shows
K,U,Q and E+Q (J), with before/after bars at the shared cursor; `momentum` shows
px,py (kg m/s); `scattering` plots completed numerical θ_CM vs b, with current
b/θ marker. The latter is a parameter plot, not a time series: author it as a
close-up if the initial kit only supports time graphs. Do not freeze the UI by
computing long curves in draw(); batch once off the animation path and cancel
stale work. Label finite-start curves as such, distinguish lab scattering angles
from CM angles, omit unfinished points. No differential cross section is claimed.

Breakdown order: contact/central-force direction; normal/tangent decomposition;
impulse and momentum; then energy. Show the current signed equation, plus
`V_CM=(m₁v₁+m₂v₂)/(m₁+m₂)`, `K=MV_CM²/2+m_red v_rel²/2`.
Inverse square: `θ_CM=2 atan(|KR0|/(m_red v_∞² |b_∞|))`. Explain the infinity
subscripts when comparing a finite launch; use measured numerical deflection as
the live result, and never silently substitute the analytic curve.

## Checks, integration limits and remaining work

`node --test --experimental-test-isolation=none tests/experiments/collisions.test.mjs`
checks exact 1D/2D velocities, CM speeds, restitution energy loss, momentum,
tangential motion and tunnelling (1e-12 to 2e-11); potential gradients (2e-6
relative); three numerical Rutherford trajectories (0.003 rad), conservation
(3e-6 inverse square, 2e-5 smooth encounters), resets, incomplete curves and guards.

Finite-start Rutherford test uses distance=1000 m and a 1100 s integration; the
0.003 rad allowance includes the remaining asymptotic tails, rather than claiming
an infinite launch. Adaptive Verlet does not promise globally symplectic long-term
behaviour; this lane tests finite encounters. No dissipative smooth-force model.
The power-law energy reference is arbitrary, especially for nondecaying forces.

`create` rejects unknown/nonfinite/out-of-range values. Numeric step alignment is
the server/UI's job; continuous in-range inputs are useful to analytic tests.
dt=0..60 s, at most 2 million substeps per call. Below 1e-5 m the relative state
freezes with `status='close-encounter'`; transport time still advances. Renderer
must pause and explain the unresolved central encounter, never imply capture or
merger. Curves expose `complete=false` on this path or when duration is exhausted.
High-energy soft spheres can interpenetrate; reaching the centre is guarded too.
Curves are bounded to 100 points/100000 caller steps; use a worker for large jobs.

Deferred: force superposition, user-defined code, arbitrary 2D launch velocity
editing, differential cross-section extraction/overlays and persisted curve sets.
UI integration and rendered desktop/320 px checks belong to the follow-up.
Shared integration friction and sandbox test-runner workaround are recorded in
orbits.md; no shared app/kit/version/registry file is owned by this lane.
