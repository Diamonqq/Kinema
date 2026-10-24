# Rigid body rotation — physics and renderer handoff

Headless model version 1.0.0. This pass adds no gallery entry or rendered view.
The public/installed app version belongs to the integrator; no shared version file
is changed by this lane. Morin chapters 8–9 are the teaching context.

## CUPS baseline and provenance

Original sources: [ROTATE.HLP](https://github.com/palazzol/cups/blob/master/DOS/CUPS/CUPSCM/ROTATE/ROTATE.HLP)
and [ROTATE.PAS](https://github.com/palazzol/cups/blob/master/DOS/CUPS/CUPSCM/ROTATE/ROTATE.PAS).
The original help and Pascal source (including inertia, torque, Euler/RK4,
initialization and display routines) were inspected through the GitHub connector.
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

## Physics conventions and API

`model` exports the EXPERIMENTS.md contract: parameter descriptors with units,
ranges and enum options, complete preset values, observables, and `create(values)`.
Instances expose `t`, `step(dt)`, `reset()`, `sample()`, `invariants()`, `geometry()`.
Unknown/out-of-range/nonfinite input, nonphysical principal moments, asymmetric
heavy tops and nonexistent steady roots fail with RangeError; the shell must
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
- `heavy-top`: fixed pivot, CM at `distance` along body z; gravity torque is
  `r × (−mg ẑ)`. Custom and shape moments are always about the CM. The model adds
  `md²` to the two transverse moments to obtain the pivot moments. It requires
  equal transverse moments. `geometry.principalMoments` are about the pivot in
  this mode; `centreMoments` are always CM moments. External torque can be added.
- A `box` has full widths `(a,b,c)`. A `plate` is a zero-thickness rectangular
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
  `work` integrates **external** torque power only (gravity already has potential).
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
- `steadyPrecession` has slow/fast/discriminant for heavy-top initial data, or
  null where inapplicable. It is an **initial analytic prediction**, not a live
  fit to a nutating trajectory.

`invariants()` reports energy, space angular-momentum vector and magnitude,
vertical and body-axial angular momentum, external work and energy minus work.
These names are diagnostics, not a promise that all are conserved: free/no-torque
conserves E and space L; undriven heavy top conserves E, Lz and body L3; driven
motion obeys torque/work balances; fixed-axis support changes L direction.

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
E−work in J; θ(t) and φ̇(t) in their separate rad / rad/s scales; body ω1 vs ω3
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
rotation**, **Thin plate**, **Long rod**. All preset values are complete snapshots
so switching from a driven top cannot leak gravity/torque/initialization choices.
Setup hides irrelevant shape dimensions and custom moments but retains their
saved values; changing to an incompatible heavy-top shape gives a clear error.

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
