# Race track — physics and renderer brief

## Original capability research

Read [GMRACE.PAS](https://github.com/palazzol/cups/blob/master/DOS/CUPS/CUPSCM/GENMOT/GMRACE.PAS),
[GENMOT.HLP](https://github.com/palazzol/cups/blob/master/DOS/CUPS/CUPSCM/GENMOT/GENMOT.HLP)
and GMUTIL1/2, both DOS and SDL (2026-10-23). Original race physics is a free
2-D particle driven by independently adjustable Cartesian forces, linear damping,
and mass. Arrow keys increment the applied force components; kinetic energy is
available. The drawn course has two straight sections and semicircular ends;
the implementation stops outside broad rectangular bounds and on a finish-line
crossing. It is not a tire-friction or banked-road model. Generic help offers
editable state/forces/numerics, linked configurable plots and saved configurations;
it contains no dedicated Race Track section. No code or prose is copied.

## CUPS coverage

Full supplied local HLP/GMGENER/GMRACE copies were read. “Improved” refers to
implemented physics and the shared-kit views described below.

| Capability | Kinema | Evidence / reason |
|---|---|---|
| Straight-plus-semicircle oval course | improved | Editable radius/straight length; continuous SI position and tangent |
| Editable mass, initial speed and applied force | improved | Drive/braking demand constrained by actual tire grip |
| Arrow-controlled independent x/y thrust | omitted | Deliberate guided-lap cornering lab; no free-force steering game in this pass |
| Free off-course trajectory / broad boundary stop | omitted | Valid rolling model ends at grip failure; no post-slip simulation claimed |
| Linear velocity damping | omitted | Replaced by explicit quadratic air resistance and rolling loss, not the original damping law |
| Kinetic energy | improved | Signed drive/brake work and dissipated-energy bookkeeping |
| Applied-force vector display | improved | Live signed normal/friction/weight arrows and a bank cross-section |
| Finish-line crossing | improved | Route-distance validated lap count and first lap time, not any x crossing |
| Banking, corner speed limits and shared tire budget | improved | New tested force decomposition and friction-circle model |
| Editable state/forces while continuing | omitted | Setup resets deterministically; in-run steering and recovery not authored |
| RK4/Euler/RK2 and numerical step controls | improved / omitted | RK4 with event location; solver selection omitted from product controls |
| Arbitrary graphs / movable duplicate windows | omitted | Curated linked graph design below; shared renderer responsibility |
| Save/load configuration and user help text | omitted | Shared app persistence and tutor, no core file I/O |
| Export last 500 numerical time steps with parameters | omitted | Snapshot API supplies data; export UI/file format deferred to shared kit |
| Arbitrary trajectory retention | omitted | No history overlay in this core pass; shared kit may add comparisons later |

## New model and explicit boundary

The new experiment is a **guided-lap cornering laboratory**, not the original
Cartesian thrust game. Track is a stadium with corner radius r and half straight
length L; circumference is 4L+2 pi r. L=0 makes a circle. Position/tangent are
continuous at joins; curvature changes instantly (an idealized track).

- Car follows the centerline only while the demanded lateral tire force is
  physically possible. First loss of grip **ends valid motion**. State and energy
  freeze there; `lostGrip=true`, `validLap=false`; clock t still advances exactly
  dt, while `activeTime` stops. This pass deliberately has no invented skid,
  steering/recovery, rollover, road width, wheel or suspension dynamics. The view
  must say “Grip exceeded · reset or change setup”, not draw a completed corner.
- Banking applies to curved sections; centerline height is constant. Normal
  force N and signed slope-tangent friction f satisfy both Newton components:
  **N sin(theta)+f cos(theta)=mv²/r**, **N cos(theta)-f sin(theta)=mg**.
  Thus N=m(g cos(theta)+(v²/r)sin(theta));
  f=m((v²/r)cos(theta)-g sin(theta)). Positive f is downhill/inward; slow cars on
  steep banks need negative uphill/outward friction. Show its reversal.
- Tire budget: **sqrt(f_lateral²+f_longitudinal²) <= mu N**. Requested drive
  or braking force is clipped to the remaining circle radius. Show actual and
  requested force separately; excess lateral demand is never silently capped
  while pretending the car remains on its route.
- Coast losses: air = c v² and rolling = c_r N for forward motion; no reversal
  under braking. Signed drive/braking work W and dissipated work D are integrated
  alongside speed and route distance: **K + D - W = K_initial**. No extra loss
  from static cornering friction. Translational point-mass energy only.
- RK4 <=0.005 s, bisection for stop/grip/lap events. First valid lap time is
  recorded, zero before completion (renderer displays a dash). Lap count is
  distance / circumference. Reset restores exact initial state.
- Pure helpers `curveForces`, `speedLimits`, `trackPoint`, `resolve` support
  close-ups and analytic checks. Speed limits assume zero longitudinal force:
  **v_max²=rg(tan(theta)+mu)/(1-mu tan(theta))**;
  **v_min²=max(0,rg(tan(theta)-mu)/(1+mu tan(theta)))**.
  Ideal no-friction speed: **v_ideal²=rg tan(theta)**. UI parameter limits keep
  denominators positive. Static coefficients, no downforce/tire heating/load transfer.

## Implemented shared-kit views

`manifest.json` mirrors every model parameter/preset and all view graphs/close-ups.
Quiet first view: fixed proportional stadium centerline, car heading and one
compact key. Physical car dimensions are 4.5 x 1.8 m, with an explicit minimum
14 x 6 px locator glyph on large tracks to remain visible. World scale stays
fixed while running; Reset and setup changes re-center. Speed/lap caption is
fixed at the top. At grip failure motion freezes at the actual limit and the
caption says "Grip exceeded - change setup".

Preset chips: Flat corner, Banked corner, Ice loses grip, Brake while turning,
Tighter curve, Coast to a stop. Each demonstrates a physical change; no scoring.
The bank-force chip is beside the curve; the tire-grip chip is beside the car,
on a separate row clear of the key.

| close-up id | exact view and equations |
|---|---|
| corner | Looking forward across the configured next corner: road angle theta from horizontal, N toward center/up, mg down, signed f down/up slope; contact-rooted dashed N sin(theta), N cos(theta), f cos(theta), -f sin(theta) projections. N=m(g cos(theta)+(v^2/r)sin(theta)), f=m((v^2/r)cos(theta)-g sin(theta)), signed values and vmax |
| grip | Friction circle radius mu N, lateral/longitudinal axes, actual force as solid dot and requested drive hollow; fparallel^2+fperp^2 <= (mu N)^2 with signed forces and capacity in N |

Breakdown combines the bank cross-section and friction circle, stacked at narrow
width. The label "Corner cross-section" explicitly previews the configured next
curve even when the top-down car is on a flat straight. Blue N, amber mg, green f
stay consistent. Equations show N sin(theta)+f cos(theta)=mv^2/r and
N cos(theta)-f sin(theta)=mg, both symbolic and substituted, then the circle law.
Negligible arrows are omitted rather than printing coincident tip labels.

Graphs share the scene time cursor:

| id | series, units |
|---|---|
| speed | speed, next-corner maximum/minimum limits, m/s |
| grip | lateral friction, actual longitudinal friction, capacity, N |
| energy | K, dissipated work, drive work, J |
| distance | route distance, m |

The bank and grip diagrams are quiet until opened. At 320 px, a 440 px minimum
scene keeps separate projection rows and grip diagram clear of controls. All
long equations remain reachable above opaque transport. A dedicated radius
magnifier and active-time plot are deferred; this manifest advertises only the
two authored close-ups and four implemented graphs. Lap time remains in model
samples, not a claim of an additional UI panel.

## Verification and integration limits

`node --experimental-test-isolation=none --test tests/experiments/race-track.test.mjs`
checks speed-limit equations, both force balances, friction circle clipping,
oval continuity, exact coasting lap, initial/entry loss of grip, quadratic drag
closed form, energy ledgers, braking stop, finite presets/reset and rejection.
Numeric checks state tolerances. The companion race-track-view suite checks exact
manifest parity, next-corner force balance and positive gallery-thumbnail scale.
Rendered evidence is in round-156/proj-views/browser.json and its PNG captures.
Lead owns shared registration/version and final merged-build review.

Workflow suggestions for coordinator: preserve explicit source-vs-new-model
distinction (the referenced HLP has no named projectile/race chapters), and use
single-process Node tests where child spawn is EPERM. These are lane-scoped notes;
coordinator can reconcile them with existing work_records.

Polish: component arrows share the car contact origin and the force scale; faint
dashed rectangle guides connect their tips to the resultant. Tip labels use
collision avoidance and short leaders when needed. The friction-circle capacity
label is attached to a diagonal radius. Gallery rendering uses frame.thumbnail
and contains apparatus only, independent of canvas height.

Merged polish: default bank is 20 degrees. Flat presets remain available;
coincident components are hidden below 1 degree. Force labels avoid the car;
compact force equations use N/kN and three significant figures. A fixed corner
chip sits above the oval, and the contact close-up magnifies the real 4.5 m car.
The narrow Breakdown retains the Friction circle title. Time graphs use one
initial lap as their scrolling window and the complete forecast for their range.
