# Rigid body rotation — physics and renderer handoff

Headless model version 1.1.0. This pass adds no gallery entry or rendered view.
The public/installed app version belongs to the integrator; no shared version file
is changed by this lane. Morin chapters 8–9 are the teaching context.

## CUPS baseline and provenance

Original sources: [ROTATE.HLP](https://github.com/palazzol/cups/blob/master/DOS/CUPS/CUPSCM/ROTATE/ROTATE.HLP)
and [ROTATE.PAS](https://github.com/palazzol/cups/blob/master/DOS/CUPS/CUPSCM/ROTATE/ROTATE.PAS).
The original help and Pascal source (including inertia, torque, Euler/RK4,
initialization and display routines) were inspected through the GitHub connector,
then both complete local references were read during the coverage pass:
`../cups-src/CUPSCM_ROTATE_ROTATE.HLP` (491 lines) and
`../cups-src/CUPSCM_ROTATE_ROTATE.PAS` (1386 lines), relative to the stage.
No original code or prose was copied, and no original DOS executable was run.

CUPS offered fixed-axis rotation, rotation with constant applied torque, and a
spinning-top torque proportional to tilt sine. The help describes adjustable
initial orientation, angular velocity and torque directions; changing rectangular
dimensions recomputes moments for eight corner point masses. It offered space and
body views, independently scaled body/ω/L/torque vectors and stereoscopic pairs.
The help also contains generic window-layout, variable-selection and saved-
configuration screens; these are not established as implemented ROTATE features
by its Pascal (its Configuration menu delegates to the shared CUPS library).
The source implements run/pause, single-step, reverse and speed controls, Euler
angles plus body rates in RK4, with special handling at the polar singularity.
Torque was drawn relative to L to explain its derivative.

This core implements all three motion types using a single consistent attitude
representation. Improvements are uniform solid-box/cylinder and thin-plate inertia
from actual SI dimensions, independently supplied physically admissible principal
moments, gravity with an explicit mass/lever arm/pivot, stable slow and fast
steady-precession initialization, genuine intermediate-axis flips, and energy/work
and frame-resolved data suitable for linked plots. Renderer quality, stereoscopy,
saved configurations and UI integration are outside this pass.

## CUPS coverage

Status describes tested headless capability, not a completed view. All drawing
rows still require the planned renderer. Source anchors refer to the preserved
local PAS/HLP above; the HLP includes boilerplate for other CUPS programs, which
must not be mistaken for ROTATE-specific time-series plots or integrator menus.

| Original physics capability, example or plot | Evidence in original | Kinema | Coverage / deliberate difference |
| --- | --- | --- | --- |
| Rotate about any fixed space axis, including a nonprincipal axis | PAS CalcTorque 523, ConstantOmega 968 | Improved | `fixed-axis`, all three initial rates and all orientation angles; calculates support torque and its zero power |
| Free CM rotation under a constant vector torque of any direction/magnitude | PAS GetInitConds 773, CalcTorque 523 | Yes | `free` plus Cartesian space torque; same vector choices without spherical-input ambiguity |
| Torque-free CM motion, fixed space L with changing ω | HLP FixedTorHelp; PAS ConstantTorque 909 | Improved | `free`, zero external torque; conservation tests, polhode/herpolhode data |
| CM torque of magnitude T₀ sinθ, with amplitude independent of inertia; transverse asymmetry allowed | HLP SpinTopHelp 81; PAS CalcTorque 523 | Yes | Added `tilt-torque`, κ, `τ=κ ẑ×e₃`; uses CM inertia and no fictitious pivot or parallel-axis term; supports all principal moments |
| Change all three principal moments through rectangular dimensions | PAS CalcMomentofInertia 504; HLP ChangeObjectDimensionsHelp 164 | Improved | All dimensions editable; solid-box, point-corner, plate/cylinder and independent physical moments |
| Eight equal point masses at the rectangular corners | PAS CalcMomentofInertia 504 / SetUpObject; HLP ChangeObjectDimensionsHelp | Yes | Added `corner-masses`: `I₁=M(b²+c²)/4` etc. M is clearly total mass. PAS Mass=1 corresponds to each corner, so the legacy normalization is not reused |
| Arbitrary initial attitude: three Euler angles | PAS GetInitConds 773 / GenRotMat | Improved | ZYZ azimuth/tilt/phase span the same orientations using a documented standard convention; q evolves without pole singularities |
| Arbitrary initial angular-velocity magnitude and direction in space | PAS ResetSystem 556 / GetInitConds 773 | Yes | Any body components represent the same vector through inverse q. `omegaSpace` verifies the resulting direction; renderer must label the input frame |
| Choose torque direction independently of angular velocity | PAS GetInitConds 773 | Yes | Three independent space torque components; gravity/tilt torque may also be combined with them |
| Default fixed-axis example: tilted long rectangular body, space-vertical spin | PAS ProblemInit 1150, FixedRotation | Yes | Added `tilted-fixed` corner-body preset near 30° and near space-vertical; scaled apparatus and documented rounded angle/rates, not bitwise DOS reproduction |
| Default free example: long body, tilted orientation and off-axis initial spin, zero torque | PAS ProblemInit 1150, FixedTorque | Yes | `corner-body` is the corresponding long-body wobble; `free-top` additionally contrasts a squat body's free precession. Exact legacy values/normalization deliberately not reproduced |
| Default top example: long symmetric body near horizontal, spinning and precessing | PAS ProblemInit 1150, SpinningTop; HLP SpinTopHelp | Improved | Added `cm-top` near horizontal, with exact steady initialization for its chosen angle instead of a merely approximate steady release; `asymmetric-top` exposes the general CM torque case |
| Fixed-frame 3D plot of body plus coordinate axes | PAS DrawScreen 449 / OpenPlot 653 | Yes | Quaternion and principal axes/dimensions support the planned space view; no view authored yet |
| Body-centred 3D plot with transformed space coordinate axes | PAS DrawScreen 449 / ChangeDisplays 697 | Yes | Inverse q and body-frame vectors support the planned frame comparison |
| Independently show/hide body, ω, L, torque in each frame | PAS ChangeDisplays 697 | Yes | All vectors are supplied in each frame; renderer toggles remain follow-up |
| Draw torque starting at L tip to convey dL/dt | PAS CalcTorque 523 / GenVector; HLP ChangeDisplaysHelp | Improved | Correct space/body torque vectors, finite-difference derivative test, planned L-tip inset with units and fixed scales |
| Independent vector display scale factors | PAS ChangeDisplays 697 | Yes | Physical vectors stay in SI; renderer can scale each without modifying physics |
| Numerical t, φ, θ, ψ readouts | PAS PrintData 423 | Improved | Added live `phi`, `psi`, existing theta/time, plus `eulerRegular` pole-uniqueness flag; signed standard ZYZ radians rather than legacy absolute-angle display |
| Numerical moments while changing dimensions | PAS PrintMomentofInertia 1037 | Improved | Geometry supplies CM and pivot moments separately; tested point-mass and solid formulas |
| Euler equations with RK4, including constant-axis attitude integration | PAS CalcRK4P 852 / ConstantOmega 969 | Improved | Quaternion RK4 with bounded substeps, normalization and explicit analytic/conservation tolerances |
| Step, pause, speed and physical-history reversal | PAS HandleHotKey 1251 / SetUpHotKeys | Yes | `step/reset` support single-step/playback; reverse time is reset/replay through the same dynamics. Negative dt integration is deliberately omitted to avoid cumulative reverse numerical error |
| Stereoscopic copies of the same two 3D plots | PAS DrawScreen / ChangeDisplays | Deliberately omitted | Does not add another physical observable. Interactive depth/orbit viewing is the modern renderer plan; no claim of stereo support |
| Generic HLP time-series or arbitrary-function plots, selectable numerical variables, Euler/RK2 selector | HLP GetPlotVariableHelp 327 / GetNumericalParametersHelp 435 | Deliberately omitted as legacy generic features | ROTATE.PAS registers no such function list or selector and draws no scalar history plot. New linked histories for actual sample fields improve coverage without pretending these existed in ROTATE |

No other built-in physics examples or plot types occur in the complete PAS.
HLP generic configuration/window/text-editor mechanics are excluded from the
physics inventory. Modern data persistence remains a kit responsibility, not a
claim that the original configuration loader was reproduced.

## Physics conventions and API

`model` exports the EXPERIMENTS.md contract: parameter descriptors with units,
ranges and enum options, complete preset values, observables, and `create(values)`.
Instances expose `t`, `step(dt)`, `reset()`, `sample()`, `invariants()`, `geometry()`.
Unknown/out-of-range/nonfinite input, nonphysical principal moments, asymmetric
**steady-precession initialization** and nonexistent steady roots fail with RangeError; the shell must
show the error while retaining the previous valid scene. Numeric step is the UI
increment; direct model calls may use arbitrary finite in-range values.

- Right-handed space coordinates: z up, gravity down. Body axes are principal
  axes. `quaternion` is **[w,x,y,z]**, body → space; three.js requires conversion
  to `(x,y,z,w)`. Initial attitude is `Rz(azimuth) Ry(tilt) Rz(phase)`;
  all three input angles are radians. Quaternion integration has no Euler pole.
- `w1,w2,w3` are initial **body-frame** angular velocity components in rad/s.
  At zero azimuth, positive initial tilt puts body z in the positive space
  x–z half-plane. Phase rotates the transverse principal axes about that body z.
- `free`: rotation about the CM, with optional constant **space-frame** torque.
  `fixed-axis`: constant ω in space; the support supplies `ω × L`. Entered
  external torque must be zero in this constrained mode.
- `tilt-torque`: rotation about the CM under `τ=κ ẑ×e₃`. The independently
  adjustable coefficient `tiltTorque` is in N m; potential is `κ cosθ`. This
  recreates the CUPS top physics, including unequal transverse moments. It is a
  prescribed aligning/overturning torque, not gravity acting at an invented CM
  lever arm. Its geometry reports a zero gravity force and zero CM position.
- `heavy-top`: fixed pivot, CM at `distance` along body z; gravity torque is
  `r × (−mg ẑ)`. Custom and shape moments are always about the CM. The model adds
  `md²` to the two transverse moments to obtain the pivot moments. General dynamics
  allow unequal transverse moments; slow/fast steady initialization requires
  equal transverse moments. `geometry.principalMoments` are about the pivot in
  this mode; `centreMoments` are always CM moments. External torque can be added.
- A `box` has full widths `(a,b,c)`. A `corner-masses` body has the same full
  dimensions with total mass distributed equally at its eight vertices. A `plate` is a zero-thickness rectangular
  lamina in body x–y with widths `(a,b)`; c is unused. A `rod` is a slender solid
  cylinder along z (diameter a, length c); `symmetric-top` uses that same exact
  cylinder formula with squat defaults in its presets. b is unused for cylinders.
  `custom` uses I1–I3; dimensions do **not** determine that mass distribution.
  Draw it as a neutral inertia glyph, never a falsely uniform solid box.
- Euler equations: `I ω̇ = τ_body − ω × (Iω)`.
  Attitude: `q̇ = ½ q ⊗ (0,ω_body)`. Deterministic RK4 substeps are at most
  0.002 s and bounded by angular speed/torque acceleration. Normalize q at every
  substep; no energy or momentum projection conceals drift. This is not a
  symplectic integrator and conservation is numerical, not exact.
- `step(dt)` advances the requested dt, subdividing internally; accepts 0–60 s.
  Rewind uses reset plus replay. Snapshots return fresh arrays, never internal state.
- Kinetic energy is `½ ω·Iω`; top potential is `mgd cosθ`, zero at pivot height.
  CM tilt-torque potential is `κ cosθ`. `work` integrates the constant **external**
  torque power only (gravity/tilt torque already have potential).
  `energyMinusWork` is the energy balance diagnostic.

For a symmetric body, body wobble has signed frequency
`Ω_body=(I3−I1)ω3/I1`; the body axis revolves about fixed space L at `|L|/I1`.
Heavy-top steady rates solve
`I1 cosθ Ω² − I3 ω3 Ω + mgd = 0` using **pivot** inertia and the **total** axial
component ω3. Thus Euler spin rate is `ψ̇=ω3−Ω cosθ`. The smaller-magnitude
root is evaluated without subtractive cancellation. Negative spin produces
signed rates; an exactly horizontal top has only the finite slow branch.
`initial=slow/fast` prepares the complete required initial transverse velocity,
not just a decorative cone; any applied external torque subsequently changes it.
The same quadratic applies to symmetric CM tilt-torque motion with `mgd` replaced
by κ and CM moments replacing pivot moments.

`sample.phi/theta/psi` are the instantaneous standard ZYZ attitude angles in
radians, with φ/ψ wrapped to [−π,π]. At either pole φ and ψ cease to be unique;
`eulerRegular=0` flags a finite reconstructing gauge (φ=0), not an observable
precession rate. Hide the two separate angle labels there. The attitude itself
remains valid. Renderer plots must unwrap discontinuities or break the trace;
never draw a false angular-velocity spike at the wrap.

`geometry()` contains quaternion, ω/L in both frames, torque in both frames,
principal moments, axes, CM, gravity, shape and dimensions, plus:

- `inertiaEllipsoidRadii[i]=sqrt(2T/Ii)` in angular-velocity space (rad/s).
  The energy ellipsoid is `Σ Ii ωi²=2T`. This is an angular-velocity-space
  construction, not the literal body's surface or dimensions.
- `polhodePoint=omegaBody`, `herpolhodePoint=omegaSpace`. The renderer records
  bounded time histories; the core does not accumulate unbounded trace arrays.
  In torque-free motion, the space trace lies on `ω·L=2T`, a fixed plane normal
  to L. Only use the name “herpolhode” in that conservative context. Hide both
  explanatory constructions during driven/gravitating motion unless explicitly
  presenting instantaneous rather than invariant surfaces.
- `tiltTorqueCoefficient` and `tiltTorqueSpace` distinguish CM torque from actual
  pivot gravity; only heavy-top mode displays a physical gravitational lever arm.
- `steadyPrecession` has slow/fast/discriminant for symmetric top initial data, or
  null where inapplicable. It is an **initial analytic prediction**, not a live
  fit to a nutating trajectory.

`invariants()` reports energy, space angular-momentum vector and magnitude,
vertical and body-axial angular momentum, external work and energy minus work.
These names are diagnostics, not a promise that all are conserved: free/no-torque
conserves E and space L; undriven heavy/CM top conserves E and Lz, and body L3
only when the transverse moments are equal; driven
motion obeys torque/work balances; fixed-axis support changes L direction.

## Kit integration: safe updates and incremental graphs

Two optional named exports in the owned model module address these concerns
without changing `model.create` or any required instance method:

1. `prepareUpdate(currentValues, patch)` creates a candidate **before** changing
   anything live. Success returns `{ok:true, values, instance}`; failure returns
   `{ok:false,error:{name:'RangeError',code:'INVALID_ROTATION_SETUP',message}}`.
   Both input objects and the current instance stay untouched. Unknown,
   nonfinite, null, nonphysical and incompatible steady initializations fail
   explicitly; no clamping or quiet replacement of physics is permitted.
2. `sampleBatches(values, {duration:60, interval:1/30, batchSize:8})` returns an
   iterator whose construction does **no** integration. Each `next()` supplies
   at most batchSize samples (first at t=0, last exactly at duration). It owns
   an independent probe; live time/state remain unchanged. Samples match direct
   integration at those times. `return()` cancels further work. Options bound
   duration to 0–60 s, interval to .001–1 s and batchSize to 1–120; no arrays
   of the full forecast, timers, background jobs or global caches are retained.

Required kit work (not implemented by changing shared files here):

- Catch candidate creation errors **before** assigning shell params/instance.
  Commit the pair only after success; on failure retain scene, time, controls,
  graph samples and saved values, display the message, and restore input values.
  This may use prepareUpdate or an equivalent generic try/catch around create.
  Restored invalid values at initial entry need an explicit error/recovery screen.
- Remove resetModel's unconditional 3,600-step forecast loop. Start with only
  the current sample; compute graph batches on demand and yield an event-loop
  turn between batches. A synchronous `for...of` over the iterator would still
  block and is **not** a fix. Do not offer play against an incompletely replaced
  instance or pretend a partial graph covers the full duration.
- Cancel the previous iterator with `return()` on parameter change, destroy or
  superseding graph request, and use a generation ID before accepting each
  batch. Bound retained graph data (the default is at most 1,801 samples).
  Render the valid scene immediately; graph progress/error is local and quiet.
  Seek/replay should likewise be chunked for responsiveness on numerical tops.

The tests prove candidate-update isolation, bounded/lazy work per iterator pull,
cancel behavior and sample correctness. They do not prove a responsive browser:
the kit has not adopted these helpers in this pass, and real timing varies with
moments, torque and hardware. There is no managed background waiter or job.

## Exact renderer plan (next pass)

Use the shared shell and three.js mount hook. Default preset is the flip. Start
paused, centered on the body, with a solid softly lit rectangular slab and one
asymmetric corner mark that makes orientation legible. Show only the body and
compact fixed key “L · angular momentum / ω · spin”; selecting a vector in the
key reveals it. Use blue ω, mint L, peach τ, matching all graphs. Never let
arrow scaling imply ω and L have the same units. Keep their scales fixed during
play and show units in the key. Reset restores the fixed camera and trace buffers.

| View / close-up | What appears | Equation / purpose |
| --- | --- | --- |
| Space view (default) | Rotating solid, restrained axes on demand; fixed camera sized from the complete body bounding sphere | L stays fixed during the free flip even while the body turns |
| Body frame | Body held still, space triad and vectors transformed by inverse q; a clear fixed “Body frame” caption | `L_i=I_i ω_i`; ω and L generally differ in direction |
| Compare frames | Two linked equal-scale stages only after explicit selection; stack at narrow width | `L_space=R(q)L_body`, `ω_space=R(q)ω_body` |
| Zoom · middle axis | Magnified slab with transverse rate components and body y highlighted; fixed labels outside the stage | `λ=|ω₂|√[(I₃−I₂)(I₂−I₁)/(I₁I₃)]`; compare measured growth with the linear regime |
| Zoom · inertia | Dimension arrows on the real shape, CM dot; selecting an axis highlights its lever distances | Box example `I₁=m(b²+c²)/12`; plate `I₃=I₁+I₂`; custom shows entered I only |
| Zoom · gravity | Pivot, fixed vertical, CM, actual lever arm r and mg; angle at pivot; perpendicular arm `d sinθ` | `τ=r×mg`, `|τ|=mgd sinθ`, `τ=dL/dt`; draw τ at the tip of L in a small inset |
| Zoom · CM tilt torque | CM anchor, body z and fixed vertical; no gravitational force or pivot glyph | `τ=κ ẑ×e₃`, `|τ|=|κ| sinθ`, `U=κ cosθ`; torque acts about the CM |
| Zoom · precession | Constant-tilt cone for steady presets, actual nodding path for release; live θ and φ̇ | `I₁ cosθ Ω²−I₃ω₃Ω+mgd=0`; slow approximation `Ω≈mgd/(I₃ω₃)` only when valid |
| Zoom · energy geometry | Translucent angular-velocity ellipsoid and body polhode, separate space plane/herpolhode inset | `Σ I_iω_i²=2T`, `ω·L=2T`; traces share the scene time cursor |
| Zoom · support | Fixed axis through CM, ω arrow, off-axis L, required support torque | `τ_support=ω×L`; nonzero torque with zero instantaneous power |

No close-up opens itself, no trailing body labels, and no decorative trajectories
on the first view. Zoom targets sit near the relevant axis/pivot and animate to
a purposeful camera; Back restores the main fixed frame. Bound the top camera
using both pivot distance and body radius. The thin plate gets a tiny explicitly
visual thickness without changing its moments. At 320 px show one frame at a
time; frame selection, Setup, Graphs and Breakdown remain reachable.

Graphs (shared cursor, selected on demand): body ω1/ω2/ω3 in rad/s; space
Lx/Ly/Lz in kg m²/s; kinetic/potential/total energy in J; external work and
E−work in J; φ/θ/ψ(t) and φ̇(t) in their separate rad / rad/s scales; body ω1 vs ω3
phase portrait; normalized energy and |L| drift in a diagnostic graph. Avoid
overlaying different units on a shared unexplained axis.

Breakdown order: (1) select the actual rotation axis and its moment; (2) compare
ω and L; (3) Euler cross-product terms with live signed values; (4) space torque
and lever arm if present; (5) precession/nutation or flip growth for the selected
preset. Reveal one short equation plus its plain-language meaning at a time.
Show conservation claims only for the active mode/torque conditions.

Preset chips, each with one purpose: **Intermediate-axis flip**, **Smallest
moment**, **Largest moment**, **Free precession**, **Slow precession**, **Fast
precession**, **Release a gyroscope**, **Turn angular momentum**, **Constrained
rotation**, **Thin plate**, **Long rod**, **Eight corner masses**, **Horizontal CM
top**, **Unequal top moments**, **Tilted long-body constraint**. All preset values are complete snapshots
so switching from a driven top cannot leak gravity/torque/initialization choices.
Setup hides irrelevant shape dimensions and custom moments but retains their
saved values; incompatible steady initialization gives a clear error. Show κ only
for CM tilt torque and a physical distance/gravity pair only for pivot-top mode.

## Verification and limits

Command on installed Node 22.23.2 in this sandbox:

```
node --test --experimental-test-isolation=none tests/experiments/rigid-rotation.test.mjs
```

The default isolated runner is blocked at child spawn (`EPERM`); this supported
flag runs actual node:test tests in the current process. No service is started.
Tests state explicit tolerances and cover the browser source unchanged, analytic
body/space free-precession rates, 120 s free conservation, stable extrema,
intermediate-axis eigenmode growth and subsequent sign reversal, slow/fast steady
gravity precession, nutating-top invariants, quaternion normalization, applied
torque/work, support torque, shape inertia, and contract/reset/error behavior.
The coverage pass adds point-corner inertia from an explicit eight-mass sum,
CM torque direction and dL/dt, unequal-inertia CM/pivot top invariants,
near-horizontal steady CM precession, Euler pole/readout reconstruction,
transactional setup handling and lazy/cancellable graph-batch checks.

The guarantee is those tested conditions, not every combination of extreme
slider limits. Very small moments with large torques can be expensive; the
renderer should constrain ordinary setup choices and show invalid states cleanly.
The current kit eagerly computes a full 60 s graph timeline during reset and
does not catch model.create errors in setParams. Integration must address these
behaviors before exposing dependent heavy-top/custom-moment controls; this lane
does not edit shared shell files. At zero kinetic energy hide the collapsed
ellipsoid instead of dividing by its zero radii.
UI, real-device speed, appearance, shared shell error handling, saved experiments,
bounded trace replay and tutor actions await renderer/integration follow-up.
