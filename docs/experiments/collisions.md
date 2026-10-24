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

## CUPS coverage

Coverage is from a complete read of local COLISION.HLP and COLPHY.PAS (1546
source lines), including force initialization, force sums, histories and
DrawXSection. **Yes/improved below refers to tested headless physics/data.** No
table row is evidence of an implemented plot on screen; views remain unassigned.

| Original physics, example or plot | Kinema status and evidence / omission reason |
|---|---|
| Single finite-mass two-body collisions; edit impact parameter, mass ratio, speed/energy | **Yes:** independent m1/m2 and finite-start launch; target motion additionally supported. Kinetic energy maps to speed via sqrt(2K/m1). |
| Repulsive/attractive Coulomb | **Yes:** signed potential strength and numerical Rutherford tests, not an analytic animation. |
| Screened Coulomb | **Yes:** consistent exponential potential/force; Screening example. |
| Truncated Coulomb inside the charge distribution | **Improved:** continuous potential and linear interior force match the physics source rather than the inconsistent help simplification. |
| Arbitrary negative power law (source entry range −100..−1) | **Yes** for tested exponents −4..2, including the logarithmic n=−1 potential. **Deliberately omitted:** −100..−4 stiffness range, which has no verified accuracy/performance bound in this real-time integrator. Positive exponents are an extra, with no claim of asymptotic scattering. |
| Elastic hard spheres | **Improved:** exact time-of-contact and finite-mass normal impulse, no assumption that y velocity stays zero. Restitution and tracked deformation energy are additional. |
| Soft spring spheres | **Improved:** F=−dU/dr with the correct 1/2 in spring energy; Spring contact example. |
| Yukawa | **Yes:** signed short-range potential and force; Short-range attraction example. |
| Woods–Saxon | **Improved:** bounded well and radial unit-vector force consistent with the potential; Finite-depth well example. |
| User-defined compiled force hook | **Deliberately omitted:** the original hook only reports that user code is missing; arbitrary code execution is outside the bounded model/action contract. No implemented original interaction is lost. |
| Coulomb combined with Woods–Saxon, Yukawa, hard sphere or soft sphere; separate secondary strength/range/steepness | **Improved:** all four combinations, independent secondary descriptors and preset chips, consistent summed U/F. Hard-core contact uses exact drift impulse within split force steps; work/energy tested. Invalid non-Coulomb combinations reject. |
| Original default Coulomb, shielding, finite-core, power, hard, soft, Yukawa and Woods–Saxon examples | **Yes:** all eight force choices have tested configurations. Human-labelled chips focus on one effect rather than reproducing the original numerical constants. |
| Lab and CM trajectories (separately/together) | **Yes:** every geometry/trace row supplies both frames, including translating CM. No displayed panes yet. |
| Lab momentum vectors and their sum; CM momentum vectors | **Yes:** masses/velocities and total P are explicit, plus velocity-component observables. Vector rendering remains pending. |
| Potential function and effective-potential overlay | **Improved:** interactionAt gives U and F, including sums; exact U_eff=U+L²/(2m_red r²) is specified in the view note, rather than the original inconsistent barrier coefficient. Hard core is a wall, not a finite fake U. |
| Instantaneous positions, dot histories, paths, CM marker and impact-offset bracket | **Yes:** collisionTrace supplies bounded frame histories/time and configuration metadata, suitable for each display. Rendering styles remain pending. |
| Single-step, slow/continuous motion, reset | **Yes:** exact requested dt, deterministic reset and finite samples; transport presentation remains the shared kit's job. |
| Sweep impact parameter with uniform / concentrated / strongly concentrated spacing | **Yes:** sweepValues with concentration 1/2/3, scatteringCurve with explicit completeness flags. |
| Sweep projectile energy, force type, mass ratio, strength, range, steepness, combined-force parameters | **Yes:** collisionSweep, explicit choices and linear/geometric grids; all source sweep dimensions tested. Energy choices convert to speed before calling the helper. |
| Repeat previous force/parameter set for comparison | **Yes:** immutable complete configs and trace arrays allow comparisons; tests serialize two independent histories without cross-contamination. A remembered-previous UI control is deliberately omitted until views. |
| Differential cross section vs scattering angle; relative probability and logarithmic display | **Improved:** numerical local branch Jacobian dσ/dΩ in physical m²/sr, plus logSigma; lab/CM and initial/asymptotic impact-coordinate choices are explicit. Tested against hard-sphere and Rutherford results. The help's claim of plotting against impact parameter is inconsistent with the actual angle-axis source; rows expose both b and θ. |
| Nonmonotonic/multivalued scattering and singular forward directions | **Improved:** mark turning/forward singularities and incomplete encounters unavailable instead of dividing blindly. **Deliberately omitted:** combining multiple b branches into one angular bin until convergence/error rules are defined; local branch curves remain usable. |
| Save/restore/overlay up to ten cross-section sets, linear/log toggle, discard selected/all | **Yes:** returned section arrays/configs are JSON data and independent sets can be overlaid by the future renderer. **Deliberately omitted:** persistent-set UI, filesystem I/O and legacy ASCII format; no pure core owns storage. |
| Save/restore collision histories with force, parameters, mass ratio, angle, times, x/y/vx/vy; overlay paths/dots | **Yes:** collisionTrace includes full parameter snapshots, measured angle, samples and both frame histories, round-tripped through JSON in tests. **Deliberately omitted:** actual disk writes and a saved-history viewer in this pass. |
| Relativistic scattering | **Deliberately omitted:** despite dormant variable declarations, the read COLPHY acceleration/run path is Newtonian and initialization disables Relativistic; no working relativistic collision capability is demonstrated by this original. |

No DOS menu/hotkey, printer, palette, memory or file-dialog mechanic is counted
as physics parity. New evidence lives in `collisions-coverage.test.mjs` beside
the original analytic/regression suite.

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
from CM angles, omit unfinished points. The optional cross-section graph uses
the tested local-branch Jacobian described below; it does not invent missing data.

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

## Coverage-pass additions and limits

`secondInteraction` is none / woods-saxon / yukawa / hard / soft, valid only with
Coulomb, matching the original combinations. secondStrength, secondRange,
secondDiffuseness and secondStiffness are independent. A combined hard core uses
secondRange as its contact separation. Restitution still applies at that contact;
smooth potentials contribute continuously, with deformation energy accounted.
The four combination presets use deliberately instructional SI scales, not actual
nuclear measurements. The constructor rejects initially overlapping hard cores.

`differentialCrossSection(points,{frame:'cm'|'lab',coordinate:'initial'|'asymptotic'})`
computes `abs(b/(sin(theta) dtheta/db))` using a nonuniform-grid quadratic derivative.
Inputs need >=3 complete local neighbours and strictly increasing nonnegative b.
Output sigma is m²/sr (solid angle is dimensionless), logSigma is its natural log
in those chosen units, and available/reason flags protect incomplete and singular
results. Nonmonotonic branches remain separate; this is neither a quantum cross
section nor an automatically converged total angular distribution. Refine b grids
and starting distance before treating the curve as converged. Tests use actual
integrated hard-sphere angles (sigma=R²/4 within 0.001 m²) and independently supplied
Rutherford angles on a finer nonuniform grid (relative error <1e-4). Existing tests
still compare three numerical Coulomb trajectories to the analytic angle.

`scatteringCurve` now also returns labAngle/availability and Coulomb bInfinity
derived from energy/angular momentum, when a positive-energy pure inverse-square
asymptote exists. Finite-start numerical deflection still has finite-tail error;
requesting an asymptotic coordinate does not remove that error. Inelastic/combined/
power-law trajectories never claim a Coulomb asymptote. Default curves retain
initial b so comparisons do not silently mix coordinate conventions.

`sweepValues` generates <=100 linear/geometric or concentrated grid values;
`collisionSweep` supports <=32 explicit parameter choices and bounded runtime.
`collisionTrace` retains <=10001 timestamped lab/CM snapshots plus configuration,
without writing files. Independent arrays can be stored/overlaid by their eventual
UI owner. Add parameter graph `cross-section` with b/angle coordinates and a log
toggle, filtering `available=false`; never show those sentinel zeros as data.
Setup must expose secondary controls only when combined Coulomb is selected.
Trace `complete` means the requested finite recording window completed without
a close-encounter guard; only scatteringCurve's `complete` checks outgoing return
to the launch separation. A completed trace is not necessarily a finished encounter.

User-defined code, arbitrary 2D initial-velocity editing, extremely stiff exponents,
branch-summed cross sections and persisted-set UI remain deliberately omitted.
UI integration and rendered desktop/320 px checks belong to the follow-up.
Shared integration friction and sandbox test-runner workaround are recorded in
orbits.md; no shared app/kit/version/registry file is owned by this lane.
